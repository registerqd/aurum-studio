"use client";

import { useSyncExternalStore } from "react";
import {
  downloadBlob,
  getModelExportOption,
  type ModelExportFormat,
} from "@/lib/model-export-options";
import { getPresentationExportOption } from "@/lib/presentation-export-options";
import {
  type PresentationExportConfig,
  type PresentationExportFormat,
} from "@/lib/presentation-export";
import type {
  ExportProgressUpdate,
  ExportWorkerMessage,
  ExportWorkerRequest,
} from "@/lib/export-worker-types";
import type { MedalSettings } from "@/lib/types";

export type ExportQueueFormat = ModelExportFormat | PresentationExportFormat;

export type ExportQueueItemStatus =
  | "completed"
  | "failed"
  | "queued"
  | "running";

export interface ExportQueueItem {
  canDownload?: boolean;
  createdAt: number;
  error?: string;
  fileName: string;
  format: ExportQueueFormat;
  id: string;
  label: string;
  progress: number;
  sizeBytes?: number;
  status: ExportQueueItemStatus;
  statusText: string;
}

export interface ExportQueueSnapshot {
  activeId: string | null;
  items: ExportQueueItem[];
}

interface EnqueueExportOptions {
  fileName: string;
  format: ModelExportFormat;
  settings: MedalSettings;
  svgText: string;
}

interface EnqueuePresentationExportOptions {
  config: PresentationExportConfig;
  fileName: string;
  format: PresentationExportFormat;
  saveHandle?: ExportSaveFileHandle;
  settings: MedalSettings;
  svgText: string;
}

interface PendingModelExportPayload {
  fileName: string;
  format: ModelExportFormat;
  id: string;
  kind: "model";
  settings: MedalSettings;
  svgText: string;
}

interface PendingPresentationExportPayload {
  config: PresentationExportConfig;
  fileName: string;
  format: PresentationExportFormat;
  id: string;
  kind: "presentation";
  settings: MedalSettings;
  svgText: string;
}

type PendingExportPayload =
  | PendingModelExportPayload
  | PendingPresentationExportPayload;

interface CompletedExportDownload {
  blob: Blob;
  fileName: string;
}

export interface ExportWritableFileStream {
  close: () => Promise<void>;
  write: (data: Blob) => Promise<void>;
}

export interface ExportSaveFileHandle {
  createWritable: () => Promise<ExportWritableFileStream>;
}

const MAX_FINISHED_ITEMS = 6;
const MAX_COMPLETED_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const WORKER_IDLE_DISPOSE_MS = 30_000;

const subscribers = new Set<() => void>();
let snapshot: ExportQueueSnapshot = {
  activeId: null,
  items: [],
};
let worker: Worker | null = null;
let workerIdleDisposeTimer: ReturnType<typeof setTimeout> | null = null;
const pendingPayloads = new Map<string, PendingExportPayload>();
const completedDownloads = new Map<string, CompletedExportDownload>();
const saveHandles = new Map<string, ExportSaveFileHandle>();

function emitChange() {
  for (const subscriber of subscribers) {
    subscriber();
  }
}

function setSnapshot(
  updater: (current: ExportQueueSnapshot) => ExportQueueSnapshot,
) {
  const nextSnapshot = updater(snapshot);
  if (nextSnapshot === snapshot) {
    return;
  }

  const previousItems = snapshot.items;
  snapshot = nextSnapshot;
  releaseResourcesForRemovedItems(previousItems, snapshot.items);
  emitChange();
}

function subscribe(subscriber: () => void) {
  subscribers.add(subscriber);

  return () => {
    subscribers.delete(subscriber);
  };
}

function getSnapshot() {
  return snapshot;
}

function createExportWorker() {
  const nextWorker = new Worker(new URL("./export-worker.ts", import.meta.url), {
    type: "module",
  });

  nextWorker.onmessage = (event: MessageEvent<ExportWorkerMessage>) => {
    handleWorkerMessage(event.data);
  };
  nextWorker.onerror = () => {
    failActiveExport("Worker crashed");
  };

  return nextWorker;
}

function ensureWorker() {
  clearWorkerIdleDisposeTimer();
  worker ??= createExportWorker();

  return worker;
}

function disposeWorker() {
  clearWorkerIdleDisposeTimer();
  worker?.terminate();
  worker = null;
}

function clearWorkerIdleDisposeTimer() {
  if (workerIdleDisposeTimer === null) {
    return;
  }

  globalThis.clearTimeout(workerIdleDisposeTimer);
  workerIdleDisposeTimer = null;
}

function scheduleWorkerIdleDisposal() {
  clearWorkerIdleDisposeTimer();

  if (!worker) {
    return;
  }

  workerIdleDisposeTimer = globalThis.setTimeout(() => {
    workerIdleDisposeTimer = null;

    if (
      snapshot.activeId ||
      snapshot.items.some((item) => item.status === "queued")
    ) {
      return;
    }

    disposeWorker();
  }, WORKER_IDLE_DISPOSE_MS);
}

function updateQueueItem(
  id: string,
  updater: (item: ExportQueueItem) => ExportQueueItem,
) {
  setSnapshot((current) => {
    let didChange = false;
    const nextItems = current.items.map((item) => {
      if (item.id !== id) {
        return item;
      }

      const nextItem = updater(item);
      didChange ||= nextItem !== item;
      return nextItem;
    });

    if (!didChange) {
      return current;
    }

    return {
      ...current,
      items: trimFinishedItems(nextItems),
    };
  });
}

function trimFinishedItems(items: ExportQueueItem[]) {
  const unfinished = items.filter(
    (item) => item.status === "queued" || item.status === "running",
  );
  const finished = items.filter(
    (item) => item.status === "completed" || item.status === "failed",
  );

  return [...unfinished, ...finished.slice(-MAX_FINISHED_ITEMS)];
}

function releaseResourcesForRemovedItems(
  previousItems: ExportQueueItem[],
  nextItems: ExportQueueItem[],
) {
  const nextIds = new Set(nextItems.map((item) => item.id));

  for (const item of previousItems) {
    if (!nextIds.has(item.id)) {
      releaseExportResources(item.id);
    }
  }
}

function releaseExportResources(id: string) {
  pendingPayloads.delete(id);
  completedDownloads.delete(id);
  saveHandles.delete(id);
}

function startNextExport() {
  if (snapshot.activeId) {
    return;
  }

  const next = snapshot.items.find((item) => item.status === "queued");

  if (!next) {
    scheduleWorkerIdleDisposal();
    return;
  }

  setSnapshot((current) => ({
    activeId: next.id,
    items: current.items.map((item) =>
      item.id === next.id
        ? {
            ...item,
            progress: Math.max(item.progress, 1),
            status: "running",
            statusText: "Starting export",
          }
        : item,
    ),
  }));

  const payload = pendingPayloads.get(next.id);
  if (!payload) {
    failActiveExport("Missing export payload");
    return;
  }

  const request: ExportWorkerRequest = {
    ...(payload.kind === "presentation"
      ? {
          config: payload.config,
          fileName: payload.fileName,
          format: payload.format,
          id: payload.id,
          kind: payload.kind,
          settings: payload.settings,
          svgText: payload.svgText,
        }
      : {
          fileName: payload.fileName,
          format: payload.format,
          id: payload.id,
          kind: payload.kind,
          settings: payload.settings,
          svgText: payload.svgText,
        }),
  };

  try {
    ensureWorker().postMessage(request);
    pendingPayloads.delete(next.id);
  } catch (error) {
    completeWithError(
      next.id,
      error instanceof Error ? error.message : "Unable to start export worker",
    );
  }
}

function handleWorkerMessage(message: ExportWorkerMessage) {
  if (message.type === "progress") {
    applyProgress(message.id, message.progress);
    return;
  }

  if (message.type === "error") {
    completeWithError(message.id, message.error);
    return;
  }

  void completeWithResult(
    message.id,
    message.buffer,
    message.mimeType,
    message.sizeBytes,
  );
}

function applyProgress(id: string, progress: ExportProgressUpdate) {
  updateQueueItem(id, (item) => {
    const nextProgress = Math.max(
      item.progress,
      Math.round(progress.progress * 100),
    );

    if (
      nextProgress === item.progress &&
      progress.status === item.statusText
    ) {
      return item;
    }

    return {
      ...item,
      progress: nextProgress,
      statusText: progress.status,
    };
  });
}

function trimCompletedDownloadBytes() {
  let totalBytes = 0;
  const evictedIds = new Set<string>();

  for (const download of completedDownloads.values()) {
    totalBytes += download.blob.size;
  }

  for (const [id, download] of completedDownloads) {
    if (totalBytes <= MAX_COMPLETED_DOWNLOAD_BYTES) {
      break;
    }

    completedDownloads.delete(id);
    totalBytes -= download.blob.size;
    evictedIds.add(id);
  }

  return evictedIds;
}

async function completeWithResult(
  id: string,
  buffer: ArrayBuffer,
  mimeType: string,
  sizeBytes: number,
) {
  const item = snapshot.items.find((candidate) => candidate.id === id);
  const blob = new Blob([buffer], { type: mimeType });
  let statusText = "Downloaded";

  if (item) {
    completedDownloads.set(id, {
      blob,
      fileName: item.fileName,
    });

    const saveHandle = saveHandles.get(id);

    if (saveHandle) {
      try {
        await writeBlobToSaveHandle(saveHandle, blob);
        statusText = "Saved";
      } catch {
        downloadBlob(blob, item.fileName);
      }
    } else {
      downloadBlob(blob, item.fileName);
    }
  }

  pendingPayloads.delete(id);
  saveHandles.delete(id);
  const evictedDownloadIds = trimCompletedDownloadBytes();
  setSnapshot((current) => ({
    activeId: current.activeId === id ? null : current.activeId,
    items: trimFinishedItems(
      current.items.map((candidate) =>
        candidate.id === id
          ? {
              ...candidate,
              canDownload: !evictedDownloadIds.has(id),
              progress: 100,
              sizeBytes,
              status: "completed",
              statusText,
            }
          : evictedDownloadIds.has(candidate.id)
            ? { ...candidate, canDownload: false }
            : candidate,
      ),
    ),
  }));
  startNextExport();
}

async function writeBlobToSaveHandle(
  saveHandle: ExportSaveFileHandle,
  blob: Blob,
) {
  const writable = await saveHandle.createWritable();

  try {
    await writable.write(blob);
  } finally {
    await writable.close();
  }
}

function completeWithError(id: string, error: string) {
  pendingPayloads.delete(id);
  saveHandles.delete(id);
  disposeWorker();
  setSnapshot((current) => ({
    activeId: current.activeId === id ? null : current.activeId,
    items: trimFinishedItems(
      current.items.map((item) =>
        item.id === id
          ? {
              ...item,
              canDownload: false,
              error,
              progress: 100,
              status: "failed",
              statusText: "Failed",
            }
          : item,
      ),
    ),
  }));
  startNextExport();
}

export function downloadCompletedExport(id: string) {
  const download = completedDownloads.get(id);

  if (!download) {
    return false;
  }

  downloadBlob(download.blob, download.fileName);

  return true;
}

export function removeExportQueueItem(id: string) {
  const item = snapshot.items.find((candidate) => candidate.id === id);

  if (!item || item.status === "queued" || item.status === "running") {
    return false;
  }

  setSnapshot((current) => ({
    ...current,
    items: current.items.filter((candidate) => candidate.id !== id),
  }));

  return true;
}

function failActiveExport(error: string) {
  const activeId = snapshot.activeId;
  disposeWorker();

  if (!activeId) {
    return;
  }

  completeWithError(activeId, error);
}

function createExportId() {
  return `export-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 8)}`;
}

export function enqueueModelExport({
  fileName,
  format,
  settings,
  svgText,
}: EnqueueExportOptions) {
  const option = getModelExportOption(format);
  const id = createExportId();

  pendingPayloads.set(id, {
    fileName,
    format,
    id,
    kind: "model",
    settings: cloneSettings(settings),
    svgText,
  });

  setSnapshot((current) => ({
    ...current,
    items: [
      ...current.items,
      {
        createdAt: Date.now(),
        fileName,
        format,
        id,
        label: option.label,
        progress: 0,
        status: "queued",
        statusText: "Queued",
      },
    ],
  }));
  startNextExport();

  return id;
}

export function enqueuePresentationExport({
  config,
  fileName,
  format,
  saveHandle,
  settings,
  svgText,
}: EnqueuePresentationExportOptions) {
  const option = getPresentationExportOption(format);
  const id = createExportId();

  pendingPayloads.set(id, {
    config: cloneConfig(config),
    fileName,
    format,
    id,
    kind: "presentation",
    settings: cloneSettings(settings),
    svgText,
  });

  if (saveHandle) {
    saveHandles.set(id, saveHandle);
  }

  setSnapshot((current) => ({
    ...current,
    items: [
      ...current.items,
      {
        createdAt: Date.now(),
        fileName,
        format,
        id,
        label: `${option.label} Presentation`,
        progress: 0,
        status: "queued",
        statusText: "Queued",
      },
    ],
  }));
  startNextExport();

  return id;
}

export function useExportQueueSnapshot() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

function cloneSettings(settings: MedalSettings) {
  if (typeof structuredClone === "function") {
    return structuredClone(settings);
  }

  return JSON.parse(JSON.stringify(settings)) as MedalSettings;
}

function cloneConfig(config: PresentationExportConfig) {
  if (typeof structuredClone === "function") {
    return structuredClone(config);
  }

  return JSON.parse(JSON.stringify(config)) as PresentationExportConfig;
}
