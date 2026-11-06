"use client";

import type {
  SavedWorkSummary,
  WorkDocument,
  WorkSnapshot,
} from "@/lib/types";
import {
  getPrimarySvgAsset,
  isWorkDocument,
  normalizeWorkDocument,
} from "@/lib/work-document";

const DB_NAME = "medal-forge-workspace";
const DB_VERSION = 1;
const WORK_STORE = "works";

function openWorkspaceDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const database = request.result;

      if (!database.objectStoreNames.contains(WORK_STORE)) {
        const store = database.createObjectStore(WORK_STORE, {
          keyPath: "document.id",
        });
        store.createIndex("updatedAt", "document.updatedAt", { unique: false });
        store.createIndex("title", "document.title", { unique: false });
      }
    };
  });
}

async function withWorkStore<T>(
  mode: IDBTransactionMode,
  callback: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await openWorkspaceDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WORK_STORE, mode);
    const store = transaction.objectStore(WORK_STORE);
    const request = callback(store);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

function toSavedWorkSummary(document: WorkDocument): SavedWorkSummary {
  const normalized = normalizeWorkDocument(document);
  const asset = getPrimarySvgAsset(normalized);

  return {
    id: normalized.document.id,
    title: normalized.document.title,
    sourceFileName: asset.fileName,
    createdAt: normalized.document.createdAt,
    updatedAt: normalized.document.updatedAt,
    schemaVersion: normalized.schemaVersion,
    snapshotDataUrl: normalized.preview.snapshot?.dataUrl ?? null,
  };
}

export async function saveWorkDocument(document: WorkDocument): Promise<void> {
  await withWorkStore("readwrite", (store) => store.put(document));
}

export async function saveWorkSnapshotIfCurrent(
  id: string,
  expectedUpdatedAt: string,
  snapshot: WorkSnapshot,
): Promise<WorkDocument | null> {
  const database = await openWorkspaceDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(WORK_STORE, "readwrite");
    const store = transaction.objectStore(WORK_STORE);
    const request = store.get(id);
    let savedDocument: WorkDocument | null = null;

    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      if (!isWorkDocument(request.result)) {
        return;
      }

      const current = normalizeWorkDocument(request.result);
      if (current.document.updatedAt !== expectedUpdatedAt) {
        return;
      }

      savedDocument = {
        ...current,
        preview: {
          snapshot,
        },
      };
      store.put(savedDocument);
    };
    transaction.oncomplete = () => {
      database.close();
      resolve(savedDocument);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}

export async function deleteWorkDocument(id: string): Promise<void> {
  await withWorkStore("readwrite", (store) => store.delete(id));
}

export async function getWorkDocument(id: string): Promise<WorkDocument | null> {
  const result = await withWorkStore<WorkDocument | undefined>("readonly", (store) =>
    store.get(id),
  );

  return isWorkDocument(result) ? normalizeWorkDocument(result) : null;
}

export async function listSavedWorks(): Promise<SavedWorkSummary[]> {
  const result = await withWorkStore<unknown[]>("readonly", (store) =>
    store.getAll(),
  );

  return result
    .filter(isWorkDocument)
    .map(normalizeWorkDocument)
    .map(toSavedWorkSummary)
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

export async function listWorkDocuments(): Promise<WorkDocument[]> {
  const result = await withWorkStore<unknown[]>("readonly", (store) =>
    store.getAll(),
  );

  return result.filter(isWorkDocument).map(normalizeWorkDocument);
}
