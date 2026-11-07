"use client";

import {
  Download,
  CircleDashed,
  Eye,
  EyeOff,
  FileJson,
  Home,
  Grid3X3,
  Layers3,
  LoaderCircle,
  Moon,
  Palette,
  PenTool,
  Play,
  RotateCcw,
  Redo2,
  Save,
  SlidersHorizontal,
  Sun,
  Undo2,
  Upload,
  Wrench,
} from "lucide-react";
import { PngImportDialog } from "@/components/png-import-dialog";
import { MeshRepairDialog } from "@/components/mesh-repair-dialog";
import {
  ChangeEvent,
  DragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
  PointerEvent,
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import { flushSync } from "react-dom";
import { ExportQueuePanel } from "@/components/export-queue-panel";
import { LanguageSwitcher } from "@/components/language-switcher";
import { SvgPathEditor } from "@/components/svg-path-editor";
import {
  Button,
  InspectorSection,
  InspectorStack,
  Select,
} from "@/components/ui/inspector";
import { MaterialSelect } from "@/components/ui/material-select";
import {
  NumberControl,
  RangeControl,
} from "@/components/ui/scrubbable-number-field";
import {
  DEFAULT_FILE_NAME,
  DEFAULT_SETTINGS,
  DEFAULT_SVG,
} from "@/lib/defaults";
import {
  MODEL_EXPORT_OPTIONS,
  downloadBlob,
  getModelExportOption,
  type ModelExportFormat,
} from "@/lib/model-export-options";
import { enqueueModelExport } from "@/lib/export-queue";
import { getShapeLabel, getSvgColor, resolveShapeSettings } from "@/lib/shape-settings";
import { summarizeSvgPaths } from "@/lib/svg-summary";
import {
  createWorkDocument,
  createWorkId,
  createWorkPayloadSignature,
  getPrimarySvgAsset,
} from "@/lib/work-document";
import { getWorkDocument, saveWorkDocument } from "@/lib/work-storage";
import { needsSnapshot } from "@/lib/snapshot-metadata";
import { requestIdleTask } from "@/lib/idle";
import { useI18n } from "@/lib/i18n";
import type {
  CanvasSettings,
  DomeSettings,
  MedalSettings,
  ModelQualitySettings,
  ShapeSettingsPatch,
  ShapeSvgAdjustments,
  ShapeWindingMode,
  SvgPathSummary,
  WorkDocument,
  WorkSnapshot,
} from "@/lib/types";

const PresentationModeDialog = lazy(() =>
  import("@/components/presentation-mode-dialog").then((module) => ({
    default: module.PresentationModeDialog,
  })),
);

const ModelPreview = lazy(() =>
  import("@/components/model-preview").then((module) => ({
    default: module.ModelPreview,
  })),
);

function getFileStem(fileName: string) {
  return fileName.replace(/\.svg$/i, "").replace(/[^\w.-]+/g, "-") || "medal";
}

function getSummaryByIndex(summaries: SvgPathSummary[], pathIndex: number) {
  return summaries.find((summary) => summary.pathIndex === pathIndex);
}

function getSummaryNumber(
  summary: SvgPathSummary | undefined,
  key: string,
  fallback = 0,
) {
  const parsed = Number.parseFloat(summary?.attributes[key] ?? "");
  return Number.isFinite(parsed) ? parsed : fallback;
}

function getRectCornerRadius(summary: SvgPathSummary | undefined) {
  return getSummaryNumber(
    summary,
    "rx",
    getSummaryNumber(summary, "ry", 0),
  );
}

const WINDING_OPTIONS: Array<{ label: string; value: ShapeWindingMode }> = [
  {
    label: "SVG",
    value: "svg",
  },
  {
    label: "CW",
    value: "solidCw",
  },
  {
    label: "CCW",
    value: "solidCcw",
  },
];

function createTimestamp() {
  return new Date().toISOString();
}

export function createWorkTitle(fileName: string) {
  return getFileStem(fileName);
}

interface MedalWorkbenchProps {
  initialWorkId?: string;
}

type EditorTheme = "light" | "dark";
type ViewportMode = "model" | "svg";

interface EditorHistorySnapshot {
  fileName: string;
  selectedPathIndexes: number[];
  settings: MedalSettings;
  svgText: string;
  title: string;
}

const EDITOR_HISTORY_LIMIT = 100;
const EDITOR_HISTORY_MERGE_WINDOW_MS = 1000;

function getEditorHistorySnapshotKey(snapshot: EditorHistorySnapshot) {
  return JSON.stringify({
    fileName: snapshot.fileName,
    settings: snapshot.settings,
    svgText: snapshot.svgText,
    title: snapshot.title,
  });
}

export function MedalWorkbench({ initialWorkId }: MedalWorkbenchProps) {
  const router = useRouter();
  const { t } = useI18n();
  const [editorTheme, setEditorTheme] = useState<EditorTheme>("light");
  const [viewportMode, setViewportMode] = useState<ViewportMode>("model");
  const [isViewportTransitioning, setIsViewportTransitioning] = useState(false);
  const [settings, setSettings] = useState<MedalSettings>(DEFAULT_SETTINGS);
  const [svgText, setSvgText] = useState(DEFAULT_SVG);
  const [svgTextPreview, setSvgTextPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState("未命名徽章.svg");
  const defaultTitle = createWorkTitle("未命名徽章.svg");
  const [workMeta, setWorkMeta] = useState(() => {
    const createdAt = createTimestamp();

    return {
      id: createWorkId(),
      title: defaultTitle,
      createdAt,
      snapshot: null as WorkSnapshot | null,
    };
  });
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(defaultTitle);
  const [selectedPathIndexes, setSelectedPathIndexes] = useState<number[]>([]);
  const [hoveredPathIndex, setHoveredPathIndex] = useState<number | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [isDocumentReady, setIsDocumentReady] = useState(!initialWorkId);
  const [status, setStatus] = useState(initialWorkId ? "Loading work" : "Ready");
  const [isBusy, setIsBusy] = useState(false);
  const [pendingRaster, setPendingRaster] = useState<File | null>(null);
  const [isRepairOpen, setIsRepairOpen] = useState(false);
  const [isAutoSaveAnimating, setIsAutoSaveAnimating] = useState(false);
  const [isPresentationOpen, setIsPresentationOpen] = useState(false);
  const [editingLayerPathIndex, setEditingLayerPathIndex] = useState<number | null>(
    null,
  );
  const [layerNameDraft, setLayerNameDraft] = useState("");
  const [hasPersistedWork, setHasPersistedWork] = useState(false);
  const selectionAnchorRef = useRef<number | null>(null);
  const suppressLayerClickRef = useRef(false);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const titleInputRef = useRef<HTMLInputElement>(null);
  const titleEditCancelledRef = useRef(false);
  const layerNameInputRef = useRef<HTMLInputElement>(null);
  const layerNameEditCancelledRef = useRef(false);
  const autoSaveSpinnerTimerRef = useRef<number | null>(null);
  const viewportTransitionTimerRef = useRef<number | null>(null);
  const isImportingSvgRef = useRef(false);
  const historyPastRef = useRef<EditorHistorySnapshot[]>([]);
  const historyFutureRef = useRef<EditorHistorySnapshot[]>([]);
  const historyMergeRef = useRef<string | null>(null);
  const historyMergeTimerRef = useRef<number | null>(null);
  const latestEditorSnapshotRef = useRef<EditorHistorySnapshot>({
    fileName: DEFAULT_FILE_NAME,
    selectedPathIndexes: [],
    settings: DEFAULT_SETTINGS,
    svgText: DEFAULT_SVG,
    title: defaultTitle,
  });
  const [historyAvailability, setHistoryAvailability] = useState({
    canRedo: false,
    canUndo: false,
  });
  const [lastSavedSignature, setLastSavedSignature] = useState(() =>
    createWorkPayloadSignature({
      title: defaultTitle,
      fileName: DEFAULT_FILE_NAME,
      svgText: DEFAULT_SVG,
      settings: DEFAULT_SETTINGS,
      selectedPathIndexes: [],
    }),
  );

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("medal-forge-editor-theme");
    const nextTheme: EditorTheme =
      savedTheme === "light" || savedTheme === "dark"
        ? savedTheme
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    const frame = window.requestAnimationFrame(() => setEditorTheme(nextTheme));

    return () => window.cancelAnimationFrame(frame);
  }, []);

  function toggleEditorTheme() {
    setEditorTheme((current) => {
      const nextTheme = current === "light" ? "dark" : "light";
      window.localStorage.setItem("medal-forge-editor-theme", nextTheme);
      return nextTheme;
    });
  }

  function changeViewportMode(nextMode: ViewportMode) {
    if (nextMode === viewportMode) return;
    if (viewportTransitionTimerRef.current !== null) {
      window.clearTimeout(viewportTransitionTimerRef.current);
    }
    setIsViewportTransitioning(true);
    setViewportMode(nextMode);
    viewportTransitionTimerRef.current = window.setTimeout(() => {
      setIsViewportTransitioning(false);
      viewportTransitionTimerRef.current = null;
    }, 420);
  }

  const pathSummaries = useMemo(() => summarizeSvgPaths(svgText), [svgText]);
  const activePathSummaries = useMemo(
    () =>
      pathSummaries.filter(
        (summary) =>
          !resolveShapeSettings(settings, summary.pathIndex, summary).deleted,
      ),
    [pathSummaries, settings],
  );
  const selectedSummaries = useMemo(
    () =>
      selectedPathIndexes
        .map((pathIndex) => getSummaryByIndex(activePathSummaries, pathIndex))
        .filter((summary): summary is SvgPathSummary => Boolean(summary)),
    [activePathSummaries, selectedPathIndexes],
  );
    // 当有可用图层且当前未选中任何图层时，自动选中第一个图层，防止右侧属性检查器显示为空
  useEffect(() => {
    if (activePathSummaries.length > 0 && selectedPathIndexes.length === 0) {
      setSelectedPathIndexes([activePathSummaries[0].pathIndex]);
    }
  }, [activePathSummaries, selectedPathIndexes.length]);

  const activeSummary = selectedSummaries[0];
  const activeShapeSettings = activeSummary
    ? resolveShapeSettings(settings, activeSummary.pathIndex, activeSummary)
    : null;
  const activeDomeSettings = settings.dome ?? DEFAULT_SETTINGS.dome;
  const activeQualitySettings = settings.quality ?? DEFAULT_SETTINGS.quality;
  const currentSignature = useMemo(
    () =>
      createWorkPayloadSignature({
        title: workMeta.title,
        fileName,
        svgText,
        settings,
        selectedPathIndexes,
      }),
    [fileName, selectedPathIndexes, settings, svgText, workMeta.title],
  );
  const currentEditorSnapshot = useMemo<EditorHistorySnapshot>(
    () => ({
      fileName,
      selectedPathIndexes: [...selectedPathIndexes],
      settings,
      svgText,
      title: workMeta.title,
    }),
    [fileName, selectedPathIndexes, settings, svgText, workMeta.title],
  );

  useEffect(() => {
    latestEditorSnapshotRef.current = currentEditorSnapshot;
  }, [currentEditorSnapshot]);

  const syncHistoryAvailability = useCallback(() => {
    setHistoryAvailability({
      canRedo: historyFutureRef.current.length > 0,
      canUndo: historyPastRef.current.length > 0,
    });
  }, []);

  const recordEditorHistory = useCallback((groupKey: string) => {
    const shouldMerge = historyMergeRef.current === groupKey;

    if (!shouldMerge) {
      historyPastRef.current.push(latestEditorSnapshotRef.current);
      if (historyPastRef.current.length > EDITOR_HISTORY_LIMIT) {
        historyPastRef.current.shift();
      }
    }

    historyFutureRef.current = [];
    historyMergeRef.current = groupKey;
    if (historyMergeTimerRef.current !== null) {
      window.clearTimeout(historyMergeTimerRef.current);
    }
    historyMergeTimerRef.current = window.setTimeout(() => {
      historyMergeRef.current = null;
      historyMergeTimerRef.current = null;
    }, EDITOR_HISTORY_MERGE_WINDOW_MS);
    syncHistoryAvailability();
  }, [syncHistoryAvailability]);

  const resetEditorHistory = useCallback((snapshot: EditorHistorySnapshot) => {
    historyPastRef.current = [];
    historyFutureRef.current = [];
    historyMergeRef.current = null;
    if (historyMergeTimerRef.current !== null) {
      window.clearTimeout(historyMergeTimerRef.current);
      historyMergeTimerRef.current = null;
    }
    latestEditorSnapshotRef.current = snapshot;
    syncHistoryAvailability();
  }, [syncHistoryAvailability]);

  const applyEditorHistorySnapshot = useCallback(
    (snapshot: EditorHistorySnapshot) => {
      latestEditorSnapshotRef.current = snapshot;
      setFileName(snapshot.fileName);
      setSettings(snapshot.settings);
      setSvgTextPreview(null);
      setSvgText(snapshot.svgText);
      setSelectedPathIndexes(snapshot.selectedPathIndexes);
      selectionAnchorRef.current = snapshot.selectedPathIndexes[0] ?? null;
      setHoveredPathIndex(null);
      setEditingLayerPathIndex(null);
      setLayerNameDraft("");
      setIsEditingTitle(false);
      setTitleDraft(snapshot.title);
      setWorkMeta((current) => ({
        ...current,
        title: snapshot.title,
      }));
    },
    [],
  );

  const undoEditor = useCallback(() => {
    const current = latestEditorSnapshotRef.current;
    const currentKey = getEditorHistorySnapshotKey(current);
    let previous = historyPastRef.current.pop();

    while (previous && getEditorHistorySnapshotKey(previous) === currentKey) {
      previous = historyPastRef.current.pop();
    }

    if (!previous) {
      syncHistoryAvailability();
      return;
    }

    historyFutureRef.current.push(current);
    historyMergeRef.current = null;
    if (historyMergeTimerRef.current !== null) {
      window.clearTimeout(historyMergeTimerRef.current);
      historyMergeTimerRef.current = null;
    }
    applyEditorHistorySnapshot(previous);
    syncHistoryAvailability();
    setStatus(t("Undid last edit"));
  }, [applyEditorHistorySnapshot, syncHistoryAvailability, t]);

  const redoEditor = useCallback(() => {
    const current = latestEditorSnapshotRef.current;
    const currentKey = getEditorHistorySnapshotKey(current);
    let next = historyFutureRef.current.pop();

    while (next && getEditorHistorySnapshotKey(next) === currentKey) {
      next = historyFutureRef.current.pop();
    }

    if (!next) {
      syncHistoryAvailability();
      return;
    }

    historyPastRef.current.push(current);
    historyMergeRef.current = null;
    if (historyMergeTimerRef.current !== null) {
      window.clearTimeout(historyMergeTimerRef.current);
      historyMergeTimerRef.current = null;
    }
    applyEditorHistorySnapshot(next);
    syncHistoryAvailability();
    setStatus(t("Redid last edit"));
  }, [applyEditorHistorySnapshot, syncHistoryAvailability, t]);

  const hasUnsavedChanges = useCallback(() => {
    return lastSavedSignature !== currentSignature;
  }, [currentSignature, lastSavedSignature]);

  const createCurrentWorkDocument = useCallback(
    (
      updatedAt = createTimestamp(),
      snapshot = workMeta.snapshot,
      titleOverride?: string,
    ): WorkDocument => {
      const title = titleOverride?.trim() || workMeta.title.trim() || createWorkTitle(fileName);

      return createWorkDocument({
        id: workMeta.id,
        title,
        createdAt: workMeta.createdAt,
        updatedAt,
        fileName,
        svgText,
        settings,
        selectedPathIndexes,
        snapshot,
      });
    },
    [
      fileName,
      selectedPathIndexes,
      settings,
      svgText,
      workMeta.createdAt,
      workMeta.id,
      workMeta.snapshot,
      workMeta.title,
    ],
  );

  const saveCurrentWork = useCallback(async (
    quiet = false,
    titleOverride?: string,
    refreshSnapshot = true,
  ) => {
    let document = createCurrentWorkDocument(
      createTimestamp(),
      workMeta.snapshot,
      titleOverride,
    );

    if (refreshSnapshot && needsSnapshot(document)) {
      try {
        const { generateWorkSnapshot } = await import("@/lib/snapshot");
        const snapshot = await generateWorkSnapshot(document);
        document = {
          ...document,
          preview: {
            snapshot,
          },
        };
      } catch {
        document = {
          ...document,
          preview: {
            snapshot: workMeta.snapshot,
          },
        };
      }
    }

    await saveWorkDocument(document);
    setLastSavedSignature(
      createWorkPayloadSignature({
        title: document.document.title,
        fileName,
        svgText,
        settings,
        selectedPathIndexes,
      }),
    );
    setWorkMeta({
      id: document.document.id,
      title: document.document.title,
      createdAt: document.document.createdAt,
      snapshot: document.preview.snapshot,
    });
    setHasPersistedWork(true);

    if (!quiet) {
      setStatus(`Saved ${document.document.title}`);
    }

    return document;
  }, [
    createCurrentWorkDocument,
    fileName,
    selectedPathIndexes,
    settings,
    svgText,
    workMeta.snapshot,
  ]);

  const applyWorkDocument = useCallback((document: WorkDocument) => {
    const asset = getPrimarySvgAsset(document);

    setSvgTextPreview(null);
    setSvgText(asset.text);
    setFileName(asset.fileName);
    setSettings(document.scene.settings);
    setSelectedPathIndexes(document.editorState.selectedPathIndexes);
    setHoveredPathIndex(null);
    setEditingLayerPathIndex(null);
    setLayerNameDraft("");
    selectionAnchorRef.current =
      document.editorState.selectedPathIndexes[0] ?? null;
    setWorkMeta({
      id: document.document.id,
      title: document.document.title,
      createdAt: document.document.createdAt,
      snapshot: document.preview.snapshot,
    });
    setHasPersistedWork(true);
    setTitleDraft(document.document.title);
    setLastSavedSignature(
      createWorkPayloadSignature({
        title: document.document.title,
        fileName: asset.fileName,
        svgText: asset.text,
        settings: document.scene.settings,
        selectedPathIndexes: document.editorState.selectedPathIndexes,
      }),
    );
    resetEditorHistory({
      fileName: asset.fileName,
      selectedPathIndexes: [...document.editorState.selectedPathIndexes],
      settings: document.scene.settings,
      svgText: asset.text,
      title: document.document.title,
    });
  }, [resetEditorHistory]);

  function normalizeTitleDraft() {
    return titleDraft.trim() || workMeta.title.trim() || createWorkTitle(fileName);
  }

  function beginTitleEdit() {
    titleEditCancelledRef.current = false;
    setTitleDraft(workMeta.title);
    setIsEditingTitle(true);
  }

  function commitTitleEdit() {
    if (titleEditCancelledRef.current) {
      titleEditCancelledRef.current = false;
      return;
    }

    const nextTitle = normalizeTitleDraft();
    setIsEditingTitle(false);
    setTitleDraft(nextTitle);

    if (nextTitle !== workMeta.title) {
      recordEditorHistory("work-title");
      setWorkMeta((current) => ({
        ...current,
        title: nextTitle,
      }));
      setStatus(`Renamed ${nextTitle}`);
    }
  }

  function cancelTitleEdit() {
    titleEditCancelledRef.current = true;
    setTitleDraft(workMeta.title);
    setIsEditingTitle(false);
  }

  function handleTitleKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      commitTitleEdit();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelTitleEdit();
    }
  }

  async function confirmBeforeReplacingWork(
    actionLabel: string,
    titleOverride?: string,
  ) {
    const hasTitleOverrideChange =
      Boolean(titleOverride) && titleOverride !== workMeta.title;

    if (!hasTitleOverrideChange && !hasUnsavedChanges()) {
      return true;
    }

    const shouldSave = window.confirm(
      `当前作品有未保存更改。${actionLabel} 会丢失当前编辑状态。是否先保存当前作品？`,
    );

    if (shouldSave) {
      try {
        await saveCurrentWork(true, titleOverride);
        return true;
      } catch {
        setStatus("Save failed");
        return false;
      }
    }

    return window.confirm(`不保存并继续${actionLabel}吗？当前编辑状态会丢失。`);
  }

  async function goHome() {
    const pendingTitle = isEditingTitle ? normalizeTitleDraft() : undefined;

    if (isEditingTitle) {
      commitTitleEdit();
    }

    const canLeave = await confirmBeforeReplacingWork("返回首页", pendingTitle);

    if (canLeave) {
      router.push("/");
    }
  }

  function updateCanvasSetting<K extends keyof CanvasSettings>(
    key: K,
    value: CanvasSettings[K],
  ) {
    recordEditorHistory(`canvas:${String(key)}`);
    setSettings((current) => ({
      ...current,
      canvas: {
        ...current.canvas,
        [key]: value,
      },
    }));
  }

  function updateSvgText(nextSvgText: string) {
    if (nextSvgText === svgText) {
      setSvgTextPreview(null);
      return;
    }

    recordEditorHistory("svg-path");
    setSvgTextPreview(null);
    setSvgText(nextSvgText);
  }

  function updateDomeSetting<K extends keyof DomeSettings>(
    key: K,
    value: DomeSettings[K],
  ) {
    recordEditorHistory(`dome:${String(key)}`);
    setSettings((current) => ({
      ...current,
      dome: {
        ...DEFAULT_SETTINGS.dome,
        ...current.dome,
        [key]: value,
      },
    }));
  }

  function updateQualitySetting<K extends keyof ModelQualitySettings>(
    key: K,
    value: ModelQualitySettings[K],
  ) {
    recordEditorHistory(`quality:${String(key)}`);
    setSettings((current) => ({
      ...current,
      quality: {
        ...DEFAULT_SETTINGS.quality,
        ...current.quality,
        [key]: value,
      },
    }));
  }

  function updateShapes(
    pathIndexes: number[],
    patchOrFactory:
      | ShapeSettingsPatch
      | ((summary: SvgPathSummary) => ShapeSettingsPatch),
  ) {
    if (pathIndexes.length === 0) {
      return;
    }

    const patchKey =
      typeof patchOrFactory === "function"
        ? "factory"
        : Object.keys(patchOrFactory).sort().join(",");
    recordEditorHistory(
      `shapes:${pathIndexes.slice().sort((left, right) => left - right).join(",")}:${patchKey}`,
    );

    setSettings((current) => {
      const nextShapeSettings = { ...current.shapeSettings };

      for (const pathIndex of pathIndexes) {
        const summary = getSummaryByIndex(pathSummaries, pathIndex);
        if (!summary) {
          continue;
        }

        const patch =
          typeof patchOrFactory === "function"
            ? patchOrFactory(summary)
            : patchOrFactory;

        nextShapeSettings[String(pathIndex)] = {
          ...nextShapeSettings[String(pathIndex)],
          ...patch,
        };
      }

      return {
        ...current,
        shapeSettings: nextShapeSettings,
      };
    });
  }

  function updateSelectedShapes(patch: ShapeSettingsPatch) {
    updateShapes(selectedPathIndexes, patch);
  }

  function getLayerLabel(
    summary: SvgPathSummary,
    shapeSettings?: { name?: string },
  ) {
    return shapeSettings?.name?.trim() || getShapeLabel(summary);
  }

  function beginLayerNameEdit(
    summary: SvgPathSummary,
    shapeSettings: { name?: string },
  ) {
    layerNameEditCancelledRef.current = false;
    setEditingLayerPathIndex(summary.pathIndex);
    setLayerNameDraft(getLayerLabel(summary, shapeSettings));
  }

  function commitLayerNameEdit(pathIndex: number, summary: SvgPathSummary) {
    if (layerNameEditCancelledRef.current) {
      layerNameEditCancelledRef.current = false;
      return;
    }

    const fallbackName = getShapeLabel(summary);
    const nextName = layerNameDraft.trim();

    setEditingLayerPathIndex(null);
    setLayerNameDraft("");
    updateShapes([pathIndex], {
      name: nextName && nextName !== fallbackName ? nextName : undefined,
    });
    setStatus(nextName ? `Renamed layer to ${nextName}` : "Reset layer name");
  }

  function cancelLayerNameEdit() {
    layerNameEditCancelledRef.current = true;
    setEditingLayerPathIndex(null);
    setLayerNameDraft("");
  }

  function handleLayerNameKeyDown(
    event: ReactKeyboardEvent<HTMLInputElement>,
  ) {
    if (event.key === "Enter") {
      event.preventDefault();
      event.currentTarget.blur();
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      cancelLayerNameEdit();
    }
  }

  function updateActiveSvgAdjustment<K extends keyof ShapeSvgAdjustments>(
    key: K,
    value: ShapeSvgAdjustments[K],
  ) {
    if (!activeSummary || !activeShapeSettings) {
      return;
    }

    updateShapes([activeSummary.pathIndex], {
      svgAdjustments: {
        ...activeShapeSettings.svgAdjustments,
        [key]: value,
      },
    });
  }

  function resetActiveSvgAdjustment<K extends keyof ShapeSvgAdjustments>(key: K) {
    if (!activeSummary || !activeShapeSettings) {
      return;
    }

    const nextAdjustments = {
      ...activeShapeSettings.svgAdjustments,
    };
    delete nextAdjustments[key];

    updateShapes([activeSummary.pathIndex], {
      svgAdjustments: nextAdjustments,
    });
  }

  function getPathOrder() {
    return activePathSummaries.map((summary) => summary.pathIndex);
  }

  function sortPathIndexes(pathIndexes: number[]) {
    const order = getPathOrder();
    return Array.from(new Set(pathIndexes)).sort(
      (left, right) => order.indexOf(left) - order.indexOf(right),
    );
  }

  function getRangePathIndexes(fromPathIndex: number, toPathIndex: number) {
    const order = getPathOrder();
    const from = order.indexOf(fromPathIndex);
    const to = order.indexOf(toPathIndex);

    if (from === -1 || to === -1) {
      return [toPathIndex];
    }

    const start = Math.min(from, to);
    const end = Math.max(from, to);
    return order.slice(start, end + 1);
  }

  function selectLayer(
    pathIndex: number,
    event: Pick<
      MouseEvent<HTMLButtonElement> | PointerEvent<HTMLButtonElement>,
      "ctrlKey" | "metaKey" | "preventDefault" | "shiftKey"
    >,
  ) {
    const summary = getSummaryByIndex(pathSummaries, pathIndex);
    const shapeSettings = summary
      ? resolveShapeSettings(settings, pathIndex, summary)
      : undefined;
    const additive = event.metaKey || event.ctrlKey;
    const ranged = event.shiftKey;

    event.preventDefault();

    setSelectedPathIndexes((current) => {
      if (ranged) {
        const anchor =
          selectionAnchorRef.current ?? current[0] ?? pathIndex;
        const range = getRangePathIndexes(anchor, pathIndex);
        return additive ? sortPathIndexes([...current, ...range]) : range;
      }

      selectionAnchorRef.current = pathIndex;

      if (!additive) {
        return [pathIndex];
      }

      return current.includes(pathIndex)
        ? current.filter((item) => item !== pathIndex)
        : sortPathIndexes([...current, pathIndex]);
    });

    setStatus(
      ranged
        ? "Selected layer range"
        : `${additive ? "Toggled" : "Selected"} ${summary ? getLayerLabel(summary, shapeSettings) : `#${pathIndex}`}`,
    );
  }

  function handleLayerPointerDown(
    pathIndex: number,
    event: PointerEvent<HTMLDivElement>,
  ) {
    if (event.button !== 0) {
      return;
    }

    suppressLayerClickRef.current = true;
    selectLayer(pathIndex, event);
  }

  function handleLayerClick(
    pathIndex: number,
    event: MouseEvent<HTMLDivElement>,
  ) {
    if (suppressLayerClickRef.current) {
      suppressLayerClickRef.current = false;
      return;
    }

    selectLayer(pathIndex, event);
  }

  function clearSelection() {
    selectionAnchorRef.current = null;
    setSelectedPathIndexes([]);
    setStatus("Selection cleared");
  }

  const deleteSelectedLayers = useCallback(() => {
    const pathIndexesToDelete = selectedPathIndexes.filter((pathIndex) =>
      activePathSummaries.some((summary) => summary.pathIndex === pathIndex),
    );

    if (pathIndexesToDelete.length === 0) {
      return;
    }

    recordEditorHistory(
      `delete-layers:${pathIndexesToDelete.slice().sort((left, right) => left - right).join(",")}`,
    );
    setSettings((current) => {
      const nextShapeSettings = { ...current.shapeSettings };

      for (const pathIndex of pathIndexesToDelete) {
        nextShapeSettings[String(pathIndex)] = {
          ...nextShapeSettings[String(pathIndex)],
          deleted: true,
        };
      }

      return {
        ...current,
        shapeSettings: nextShapeSettings,
      };
    });

    setHoveredPathIndex(null);
    selectionAnchorRef.current = null;
    setSelectedPathIndexes([]);
    setStatus(
      pathIndexesToDelete.length === 1
        ? "Deleted 1 layer"
        : `Deleted ${pathIndexesToDelete.length} layers`,
    );
  }, [activePathSummaries, recordEditorHistory, selectedPathIndexes]);

  useEffect(() => {
    const activePathIndexes = new Set(
      activePathSummaries.map((summary) => summary.pathIndex),
    );

    setSelectedPathIndexes((current) => {
      const next = current.filter((pathIndex) => activePathIndexes.has(pathIndex));

      if (next.length === current.length) {
        return current;
      }

      selectionAnchorRef.current = next[0] ?? null;
      return next;
    });

    setHoveredPathIndex((current) =>
      current !== null && !activePathIndexes.has(current) ? null : current,
    );

    setEditingLayerPathIndex((current) =>
      current !== null && !activePathIndexes.has(current) ? null : current,
    );
  }, [activePathSummaries]);

  useEffect(() => {
    function isTypingTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) {
        return false;
      }

      return (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLSelectElement ||
        target.isContentEditable
      );
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      const hasCommandModifier = event.metaKey || event.ctrlKey;
      const wantsUndo = hasCommandModifier && key === "z" && !event.shiftKey;
      const wantsRedo =
        hasCommandModifier &&
        ((key === "z" && event.shiftKey) || (key === "y" && !event.shiftKey));

      if (wantsUndo) {
        event.preventDefault();
        undoEditor();
        return;
      }

      if (wantsRedo) {
        event.preventDefault();
        redoEditor();
        return;
      }

      if (hasCommandModifier && key === "a") {
        event.preventDefault();
        const allPathIndexes = activePathSummaries.map(
          (summary) => summary.pathIndex,
        );
        selectionAnchorRef.current = allPathIndexes[0] ?? null;
        setSelectedPathIndexes(allPathIndexes);
        setStatus(
          allPathIndexes.length > 0
            ? `Selected ${allPathIndexes.length} layers`
            : "No layers to select",
        );
        return;
      }

      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectedPathIndexes.length > 0
      ) {
        event.preventDefault();
        deleteSelectedLayers();
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        selectionAnchorRef.current = null;
        setSelectedPathIndexes([]);
        setStatus("Selection cleared");
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [
    activePathSummaries,
    deleteSelectedLayers,
    redoEditor,
    selectedPathIndexes,
    undoEditor,
  ]);

  useEffect(() => {
    if (!initialWorkId) {
      return;
    }

    let active = true;

    getWorkDocument(initialWorkId)
      .then((document) => {
        if (!active) {
          return;
        }

        if (!document) {
          const createdAt = createTimestamp();
          const title = createWorkTitle("未命名徽章.svg");
          setWorkMeta({
            id: initialWorkId,
            title,
            createdAt,
            snapshot: null,
          });
          setTitleDraft(title);
          setHasPersistedWork(false);
          resetEditorHistory({
            fileName: DEFAULT_FILE_NAME,
            selectedPathIndexes: [],
            settings: DEFAULT_SETTINGS,
            svgText: DEFAULT_SVG,
            title,
          });
          setStatus("New unsaved work");
          setIsDocumentReady(true);
          return;
        }

        applyWorkDocument(document);
        setStatus(`Loaded ${document.document.title}`);
        setIsDocumentReady(true);
      })
      .catch(() => {
        if (active) {
          setStatus("Load failed");
          setIsDocumentReady(true);
        }
      });

    return () => {
      active = false;
    };
  }, [applyWorkDocument, initialWorkId, resetEditorHistory]);

  useEffect(() => {
    if (!isEditingTitle) {
      return;
    }

    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

  useEffect(() => {
    if (editingLayerPathIndex === null) {
      return;
    }

    layerNameInputRef.current?.focus();
    layerNameInputRef.current?.select();
  }, [editingLayerPathIndex]);

  const finishAutoSaveSpinner = useCallback((startedAt: number) => {
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, 1000 - elapsed);

    if (autoSaveSpinnerTimerRef.current !== null) {
      window.clearTimeout(autoSaveSpinnerTimerRef.current);
    }

    autoSaveSpinnerTimerRef.current = window.setTimeout(() => {
      setIsAutoSaveAnimating(false);
      autoSaveSpinnerTimerRef.current = null;
    }, remaining);
  }, []);

  const runAutoSave = useCallback(async () => {
    const startedAt = Date.now();

    if (autoSaveSpinnerTimerRef.current !== null) {
      window.clearTimeout(autoSaveSpinnerTimerRef.current);
      autoSaveSpinnerTimerRef.current = null;
    }

    setIsAutoSaveAnimating(true);

    try {
      await saveCurrentWork(true, undefined, false);
      setStatus("Auto saved");
    } catch {
      setStatus("Auto save failed");
    } finally {
      finishAutoSaveSpinner(startedAt);
    }
  }, [finishAutoSaveSpinner, saveCurrentWork]);

  useEffect(() => {
    if (!isDocumentReady || !hasUnsavedChanges()) {
      return;
    }

    let cancelIdle: () => void = () => undefined;
    const timer = window.setTimeout(() => {
      cancelIdle = requestIdleTask(() => {
        void runAutoSave();
      }, 2000);
    }, 2000);

    return () => {
      window.clearTimeout(timer);
      cancelIdle();
    };
  }, [hasUnsavedChanges, isDocumentReady, runAutoSave]);

  useEffect(() => {
    return () => {
      if (autoSaveSpinnerTimerRef.current !== null) {
        window.clearTimeout(autoSaveSpinnerTimerRef.current);
      }
      if (viewportTransitionTimerRef.current !== null) {
        window.clearTimeout(viewportTransitionTimerRef.current);
      }
      if (historyMergeTimerRef.current !== null) {
        window.clearTimeout(historyMergeTimerRef.current);
      }
    };
  }, []);

  function resetForNewWork(nextFileName: string, preserveCurrentDraft = false) {
    const createdAt = createTimestamp();
    const title = createWorkTitle(nextFileName);
    setWorkMeta({
      id: preserveCurrentDraft ? workMeta.id : createWorkId(),
      title,
      createdAt: preserveCurrentDraft ? workMeta.createdAt : createdAt,
      snapshot: null,
    });
    setIsEditingTitle(false);
    setTitleDraft(title);
    titleEditCancelledRef.current = false;
    setHasPersistedWork(false);
    setSelectedPathIndexes([]);
    setHoveredPathIndex(null);
    setEditingLayerPathIndex(null);
    setLayerNameDraft("");
    selectionAnchorRef.current = null;
    setLastSavedSignature("");
  }

  async function loadSvgFile(file: File) {
    if (isImportingSvgRef.current) {
      setStatus("Import already in progress");
      return;
    }

    if (!file.name.toLowerCase().endsWith(".svg")) {
      setStatus("Only SVG uploads are accepted");
      return;
    }

    const canReplace = await confirmBeforeReplacingWork("导入新的 SVG");
    if (!canReplace) {
      setStatus("Import cancelled");
      return;
    }

    isImportingSvgRef.current = true;
    setIsBusy(true);
    setStatus(`Loading ${file.name}`);

    try {
      const text = await file.text();
      const nextSettings = {
        ...settings,
        shapeSettings: {},
      };
      const nextTitle = createWorkTitle(file.name);

      flushSync(() => {
        resetForNewWork(file.name, !hasPersistedWork);
        setSvgTextPreview(null);
        setSvgText(text);
        setFileName(file.name);
        setSettings(nextSettings);
        resetEditorHistory({
          fileName: file.name,
          selectedPathIndexes: [],
          settings: nextSettings,
          svgText: text,
          title: nextTitle,
        });
      });

      setStatus(`Loaded ${file.name}`);
    } catch {
      setStatus("Import failed");
    } finally {
      isImportingSvgRef.current = false;
      setIsBusy(false);
    }
  }

  function isRasterFile(file: File) {
    return /image\/(png|jpeg|jpg|webp)/i.test(file.type) || /\.(png|jpe?g|webp)$/i.test(file.name);
  }

  async function handleIncomingFile(file: File) {
    if (isRasterFile(file)) {
      setPendingRaster(file);
      return;
    }
    await loadSvgFile(file);
  }

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";

    if (!file) {
      return;
    }

    await handleIncomingFile(file);
  }

  function handleDropzoneDragOver(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragActive(true);
  }

  function handleDropzoneDragLeave(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragActive(false);
  }

  async function handleDropzoneDrop(event: DragEvent<HTMLButtonElement>) {
    event.preventDefault();
    setIsDragActive(false);

    const file = event.dataTransfer.files[0];
    if (file) {
      await handleIncomingFile(file);
    }
  }

  function exportModel(format: ModelExportFormat) {
    if (isImportingSvgRef.current) {
      setStatus("Finish loading SVG before exporting");
      return;
    }

    const option = getModelExportOption(format);

    enqueueModelExport({
      fileName: `${getFileStem(fileName)}.${option.extension}`,
      format,
      settings,
      svgText,
    });
    setStatus(`${option.label} export queued`);
  }

  async function saveWork() {
    const titleOverride = isEditingTitle ? normalizeTitleDraft() : undefined;

    if (isEditingTitle) {
      commitTitleEdit();
    }

    setIsBusy(true);
    setStatus("Saving work");

    try {
      await saveCurrentWork(false, titleOverride);
    } catch {
      setStatus("Save failed");
    } finally {
      setIsBusy(false);
    }
  }

  async function exportWorkJson() {
    if (isImportingSvgRef.current) {
      setStatus("Finish loading SVG before exporting");
      return;
    }

    let document = createCurrentWorkDocument(
      createTimestamp(),
      workMeta.snapshot,
      isEditingTitle ? normalizeTitleDraft() : undefined,
    );

    if (needsSnapshot(document)) {
      try {
        const { generateWorkSnapshot } = await import("@/lib/snapshot");
        const snapshot = await generateWorkSnapshot(document);
        document = {
          ...document,
          preview: {
            snapshot,
          },
        };
      } catch {
        document = {
          ...document,
          preview: {
            snapshot: workMeta.snapshot,
          },
        };
      }
    }

    const blob = new Blob([JSON.stringify(document, null, 2)], {
      type: "application/json",
    });

    downloadBlob(blob, `${getFileStem(fileName)}.medal-forge.json`);
    setStatus("Work JSON exported");
  }

  const selectedCount = selectedPathIndexes.length;
  const hasPendingTitleDraft =
    isEditingTitle && normalizeTitleDraft() !== workMeta.title;
  const hasPendingChanges = hasUnsavedChanges() || hasPendingTitleDraft;
  const saveButtonStateClass = isAutoSaveAnimating
    ? "saving"
    : hasPendingChanges
      ? "primary"
      : "outline";
  const saveButtonLabel = isAutoSaveAnimating
    ? t("Saving")
    : hasPendingChanges
      ? t("Save")
      : t("Saved");

  if (!isDocumentReady) {
    return (
      <div className="app-shell loading-shell">
        <div className="loading-state">{t("Loading work…")}</div>
      </div>
    );
  }

  return (
    <div className="app-shell" data-theme={editorTheme}>
      <header className="topbar">
        <div className="brand" onClick={() => void goHome()} role="button" tabIndex={0}>
          <span className="brand-mark">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <path d="M3 20V6l6 7 3-4 3 4 6-7v14" stroke="currentColor" strokeWidth="2.2" strokeLinecap="square" />
            </svg>
          </span>
          <span>
            <span className="brand-name">MOLDA</span>
            <span className="brand-sub">模界</span>
          </span>
        </div>
        <div className="topbar-left">
          <Button
            aria-label={t("Back to home")}
            className="home-button"
            onClick={() => void goHome()}
            type="button"
            variant="icon"
          >
            <Home size={17} />
          </Button>
          <div className="history-controls">
            <Button
              aria-keyshortcuts="Meta+Z Control+Z"
              aria-label={t("Undo")}
              className="history-button"
              disabled={!historyAvailability.canUndo}
              onClick={undoEditor}
              title={t("Undo (⌘Z / Ctrl+Z)")}
              type="button"
              variant="ghost"
            >
              <Undo2 size={15} />
            </Button>
            <Button
              aria-keyshortcuts="Meta+Shift+Z Control+Shift+Z Control+Y"
              aria-label={t("Redo")}
              className="history-button"
              disabled={!historyAvailability.canRedo}
              onClick={redoEditor}
              title={t("Redo (⌘⇧Z / Ctrl+Shift+Z / Ctrl+Y)")}
              type="button"
              variant="ghost"
            >
              <Redo2 size={15} />
            </Button>
          </div>
          {isEditingTitle ? (
            <input
              aria-label={t("Work name")}
              className="work-title-input"
              onBlur={commitTitleEdit}
              onChange={(event) => setTitleDraft(event.target.value)}
              onKeyDown={handleTitleKeyDown}
              ref={titleInputRef}
              value={titleDraft}
            />
          ) : (
            <button
              className="work-title-button"
              onClick={beginTitleEdit}
              title={workMeta.title}
              type="button"
            >
              {workMeta.title}
            </button>
          )}
        </div>
        <div className="topbar-actions">
          <LanguageSwitcher />
          <Button
            aria-label={`Switch to ${editorTheme === "light" ? "dark" : "light"} mode`}
            className="theme-toggle"
            onClick={toggleEditorTheme}
            title={t(editorTheme === "light" ? "Switch to dark mode" : "Switch to light mode")}
            type="button"
            variant="icon"
          >
            {editorTheme === "light" ? <Moon size={15} /> : <Sun size={15} />}
          </Button>
          <Button
            aria-label={t("Open presentation mode")}
            className={
              isPresentationOpen
                ? "presentation-trigger active"
                : "presentation-trigger"
            }
            onClick={() => setIsPresentationOpen(true)}
            title={t("Presentation mode")}
            type="button"
            variant="icon"
          >
            <Play size={15} />
          </Button>
          <Button
            aria-label="Repair model"
            className="presentation-trigger"
            onClick={() => setIsRepairOpen(true)}
            title="模型修复 / 补破面"
            type="button"
            variant="icon"
          >
            <Wrench size={15} />
          </Button>
          <ExportQueuePanel variant="toolbar" />
          <Button
            aria-label={t("Save work")}
            className={`save-action ${saveButtonStateClass}`}
            disabled={isBusy}
            onClick={saveWork}
            title={t(status)}
            type="button"
            variant={hasPendingChanges ? "primary" : "secondary"}
          >
            {isAutoSaveAnimating ? (
              <LoaderCircle className="spin-icon" size={15} />
            ) : (
              <Save size={15} />
            )}
            {saveButtonLabel}
          </Button>
        </div>
      </header>

      {isPresentationOpen ? (
        <Suspense fallback={null}>
          <PresentationModeDialog
            disabled={isBusy}
            fileStem={getFileStem(fileName)}
            onClose={() => setIsPresentationOpen(false)}
            onStatus={setStatus}
            settings={settings}
            svgText={svgText}
          />
        </Suspense>
      ) : null}

      {pendingRaster ? (
        <PngImportDialog
          file={pendingRaster}
          onCancel={() => setPendingRaster(null)}
          onApply={async (svg, name) => {
            setPendingRaster(null);
            const next = new File([svg], name, { type: "image/svg+xml" });
            await loadSvgFile(next);
          }}
        />
      ) : null}

      {isRepairOpen ? (
        <MeshRepairDialog
          onApplied={(options) => {
            void options;
            setStatus("网格处理参数已保存，导出时自动应用");
          }}
          onClose={() => setIsRepairOpen(false)}
          settings={settings}
          svgText={svgText}
        />
      ) : null}

      <main className="workspace">
        
        <aside className="layers-sidebar">
          <div className="sidebar-header">
            <span className="sidebar-header-title">
              <Layers3 size={14} />
              Layers
            </span>
            <span className="sidebar-header-meta">{activePathSummaries.length}</span>
          </div>
          <div className="panel-scroll">
            <InspectorSection icon={<Upload size={14} />} title={t("Source")}>
              <InspectorStack>
                <button
                  className={
                    isDragActive
                      ? "upload-dropzone drag-active"
                      : "upload-dropzone"
                  }
                  disabled={isBusy}
                  onClick={() => uploadInputRef.current?.click()}
                  onDragLeave={handleDropzoneDragLeave}
                  onDragOver={handleDropzoneDragOver}
                  onDrop={handleDropzoneDrop}
                  type="button"
                >
                  <Upload size={18} />
                  <span>{t("Drop SVG / PNG here")}</span>
                  <small>{t("or click to upload")}</small>
                </button>
                <input
                  accept=".svg,image/svg+xml,image/png,image/jpeg,image/webp"
                  className="hidden-input"
                  disabled={isBusy}
                  onChange={handleFileChange}
                  ref={uploadInputRef}
                  type="file"
                />
              </InspectorStack>
            </InspectorSection>

            <InspectorSection icon={<Layers3 size={14} />} title={t("Objects")}>
              <div className="layer-list">
                {activePathSummaries.map((summary) => {
                  const shapeSettings = resolveShapeSettings(
                    settings,
                    summary.pathIndex,
                    summary,
                  );
                  const selected = selectedPathIndexes.includes(summary.pathIndex);
                  const layerLabel = getLayerLabel(summary, shapeSettings);
                  const isEditingLayerName =
                    editingLayerPathIndex === summary.pathIndex;

                  return (
                    <div
                      aria-label={layerLabel}
                      aria-selected={selected}
                      className={[
                        "layer-item",
                        selected ? "selected" : "",
                        hoveredPathIndex === summary.pathIndex ? "hovered" : "",
                        isEditingLayerName ? "editing" : "",
                      ]
                        .filter(Boolean)
                        .join(" ")}
                      key={summary.pathIndex}
                      onClick={(event) => handleLayerClick(summary.pathIndex, event)}
                      onContextMenu={(event) => event.preventDefault()}
                      onMouseEnter={() => setHoveredPathIndex(summary.pathIndex)}
                      onMouseLeave={() =>
                        setHoveredPathIndex((current) =>
                          current === summary.pathIndex ? null : current,
                        )
                      }
                      onKeyDown={(event) => {
                        if (event.target !== event.currentTarget) {
                          return;
                        }

                        if (event.key === "Enter" || event.key === " ") {
                          selectLayer(summary.pathIndex, event);
                        }
                      }}
                      onPointerDown={(event) =>
                        handleLayerPointerDown(summary.pathIndex, event)
                      }
                      role="option"
                      tabIndex={0}
                    >
                      <span
                        className="material-swatch"
                        style={{ background: shapeSettings.color }}
                      />
                      {isEditingLayerName ? (
                        <input
                          aria-label={`Rename ${layerLabel}`}
                          className="layer-name-input"
                          onBlur={() =>
                            commitLayerNameEdit(summary.pathIndex, summary)
                          }
                          onChange={(event) =>
                            setLayerNameDraft(event.target.value)
                          }
                          onClick={(event) => event.stopPropagation()}
                          onKeyDown={handleLayerNameKeyDown}
                          onPointerDown={(event) => event.stopPropagation()}
                          ref={layerNameInputRef}
                          value={layerNameDraft}
                        />
                      ) : (
                        <button
                          className="layer-name-button"
                          onClick={(event) => {
                            event.stopPropagation();

                            if (
                              event.metaKey ||
                              event.ctrlKey ||
                              event.shiftKey ||
                              !selected
                            ) {
                              selectLayer(summary.pathIndex, event);
                              return;
                            }

                            beginLayerNameEdit(summary, shapeSettings);
                          }}
                          onPointerDown={(event) => event.stopPropagation()}
                          title={layerLabel}
                          type="button"
                        >
                          {layerLabel}
                        </button>
                      )}
                      <Button
                        aria-label={
                          shapeSettings.visible
                            ? `Hide ${layerLabel}`
                            : `Show ${layerLabel}`
                        }
                        className="layer-eye"
                        onPointerDown={(event) => event.stopPropagation()}
                        onClick={(event) => {
                          event.stopPropagation();
                          updateShapes([summary.pathIndex], {
                            visible: !shapeSettings.visible,
                          });
                        }}
                        type="button"
                        variant="icon"
                      >
                        {shapeSettings.visible ? (
                          <Eye size={14} />
                        ) : (
                          <EyeOff size={14} />
                        )}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </InspectorSection>
          </div>
        </aside>

        <section className={`viewport-panel ${viewportMode === "svg" ? "svg-mode" : "model-mode"}`}>
          <div className="viewport-split">
            <div aria-hidden={viewportMode !== "svg"} className="svg-editor-slot">
              <SvgPathEditor
                activeSummary={activeSummary}
                backgroundColor={settings.canvas.backgroundColor}
                onSvgTextChange={updateSvgText}
                onSvgTextPreviewChange={setSvgTextPreview}
                selectedPathIndexes={selectedPathIndexes}
                svgText={svgText}
              />
            </div>
            <div className="model-preview-slot">
              <Suspense fallback={<div className="canvas-wrap" />}>
                <ModelPreview
                  highlightedPathIndex={hoveredPathIndex}
                  isLayoutTransitioning={isViewportTransitioning}
                  settings={settings}
                  svgText={svgTextPreview ?? svgText}
                />
              </Suspense>
            </div>
          </div>
          <div className="canvas-settings" aria-label={t("Viewport toolbar")}>
            <button
              aria-label={t("SVG editor")}
              aria-pressed={viewportMode === "svg"}
              className={viewportMode === "svg" ? "canvas-tool-button svg-mode-toggle active" : "canvas-tool-button svg-mode-toggle"}
              data-tooltip={t("SVG editor")}
              onClick={() => changeViewportMode(viewportMode === "svg" ? "model" : "svg")}
              type="button"
            >
              <PenTool size={15} />
              <span>SVG</span>
            </button>
            <span className="canvas-toolbar-divider" />
            <button
              aria-label={t("Toggle grid")}
              aria-pressed={settings.canvas.showGrid}
              className={settings.canvas.showGrid ? "canvas-tool-button active" : "canvas-tool-button"}
              data-tooltip={t("Grid")}
              onClick={() => updateCanvasSetting("showGrid", !settings.canvas.showGrid)}
              type="button"
            >
              <Grid3X3 size={15} />
            </button>
            <button
              aria-label={t("Toggle shadow")}
              aria-pressed={settings.canvas.showShadows}
              className={settings.canvas.showShadows ? "canvas-tool-button active" : "canvas-tool-button"}
              data-tooltip={t("Shadow")}
              onClick={() => updateCanvasSetting("showShadows", !settings.canvas.showShadows)}
              type="button"
            >
              <CircleDashed size={15} />
            </button>
            <label className="canvas-color" data-tooltip={t("Background color")}>
              <span
                aria-hidden="true"
                className="canvas-color-swatch"
                style={{ backgroundColor: settings.canvas.backgroundColor }}
              />
              <input
                aria-label={t("Canvas background")}
                onChange={(event) => updateCanvasSetting("backgroundColor", event.target.value)}
                type="color"
                value={settings.canvas.backgroundColor}
              />
            </label>
          </div>
        </section>

        <aside className="settings-panel">
          <div className="sidebar-header inspector-header">
            <span className="sidebar-header-title">
              <SlidersHorizontal size={14} />
              Design
            </span>
            <span className="sidebar-header-meta">{t("Inspector")}</span>
          </div>
          <div className="panel-scroll">
            <InspectorSection icon={<SlidersHorizontal size={14} />} title={t("Shape")}>
              {activeShapeSettings && activeSummary ? (
                <InspectorStack>
                  <label className="control-row inline">
                    <span className="label-line">
                      <span>{t("Path winding")}</span>
                    </span>
                    <Select
                      onChange={(event) =>
                        updateSelectedShapes({
                          windingMode: event.target.value as ShapeWindingMode,
                        })
                      }
                      value={activeShapeSettings.windingMode}
                    >
                      {WINDING_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </Select>
                  </label>
                  <RangeControl
                    label={t("Thickness")}
                    max={1.6}
                    min={0.02}
                    onChange={(value) => updateSelectedShapes({ thickness: value })}
                    step={0.01}
                    value={activeShapeSettings.thickness}
                  />
                  <RangeControl
                    label={t("Depth steps")}
                    max={12}
                    min={1}
                    onChange={(value) => updateSelectedShapes({ depthSteps: value })}
                    step={1}
                    value={activeShapeSettings.depthSteps}
                  />
                  <RangeControl
                    label={t("Bevel")}
                    max={0.22}
                    min={0}
                    onChange={(value) => updateSelectedShapes({ bevel: value })}
                    step={0.005}
                    value={activeShapeSettings.bevel}
                  />
                  <RangeControl
                    label={t("Bevel segments")}
                    max={12}
                    min={0}
                    onChange={(value) =>
                      updateSelectedShapes({ bevelSegments: value })
                    }
                    step={1}
                    value={activeShapeSettings.bevelSegments}
                  />
                  <RangeControl
                    label={t("Height offset")}
                    max={1.2}
                    min={-1.2}
                    onChange={(value) => updateSelectedShapes({ zOffset: value })}
                    step={0.01}
                    value={activeShapeSettings.zOffset}
                  />
                  <RangeControl
                    label={t("Curve segments")}
                    max={128}
                    min={4}
                    onChange={(value) =>
                      updateSelectedShapes({ curveSegments: value })
                    }
                    step={1}
                    value={activeShapeSettings.curveSegments}
                  />
                </InspectorStack>
              ) : (
                <div className="empty-panel">{t("Select a layer in the left sidebar.")}</div>
              )}
            </InspectorSection>

            {activeShapeSettings &&
            activeSummary &&
            selectedCount === 1 &&
            (activeSummary.tagName === "circle" ||
              activeSummary.tagName === "rect") ? (
              <InspectorSection icon={<SlidersHorizontal size={14} />} title="SVG">
                {activeSummary.tagName === "circle" ? (
                  <InspectorStack>
                    <NumberControl
                      label={t("Radius")}
                      min={0}
                      onChange={(value) =>
                        updateActiveSvgAdjustment("circleRadius", value)
                      }
                      onReset={() => resetActiveSvgAdjustment("circleRadius")}
                      step={0.1}
                      value={
                        activeShapeSettings.svgAdjustments.circleRadius ??
                        getSummaryNumber(activeSummary, "r")
                      }
                    />
                  </InspectorStack>
                ) : activeSummary.tagName === "rect" ? (
                  <InspectorStack>
                    <NumberControl
                      label={t("Width")}
                      min={0}
                      onChange={(value) =>
                        updateActiveSvgAdjustment("rectWidth", value)
                      }
                      onReset={() => resetActiveSvgAdjustment("rectWidth")}
                      step={0.1}
                      value={
                        activeShapeSettings.svgAdjustments.rectWidth ??
                        getSummaryNumber(activeSummary, "width")
                      }
                    />
                    <NumberControl
                      label={t("Height")}
                      min={0}
                      onChange={(value) =>
                        updateActiveSvgAdjustment("rectHeight", value)
                      }
                      onReset={() => resetActiveSvgAdjustment("rectHeight")}
                      step={0.1}
                      value={
                        activeShapeSettings.svgAdjustments.rectHeight ??
                        getSummaryNumber(activeSummary, "height")
                      }
                    />
                    <NumberControl
                      label={t("Corner radius")}
                      min={0}
                      onChange={(value) =>
                        updateActiveSvgAdjustment("rectCornerRadius", value)
                      }
                      onReset={() =>
                        resetActiveSvgAdjustment("rectCornerRadius")
                      }
                      step={0.1}
                      value={
                        activeShapeSettings.svgAdjustments.rectCornerRadius ??
                        getRectCornerRadius(activeSummary)
                      }
                    />
                  </InspectorStack>
                ) : null}
              </InspectorSection>
            ) : null}

            {activeShapeSettings && activeSummary ? (
              <InspectorSection icon={<Palette size={14} />} title={t("Material")}>
                <InspectorStack>
                  <MaterialSelect
                    label={t("Material")}
                    onChange={(value) => updateSelectedShapes({ material: value })}
                    value={activeShapeSettings.material}
                  />
                  <label className="control-row">
                    <span className="label-line">
                      <span>{t("Color")}</span>
                    </span>
                    <span className="color-field">
                      <label className="color-control">
                        <input
                          aria-label="Shape color"
                          className="color-input"
                          onChange={(event) =>
                            updateSelectedShapes({ color: event.target.value })
                          }
                          type="color"
                          value={activeShapeSettings.color}
                        />
                        <span
                          aria-hidden="true"
                          className="color-swatch"
                          style={{ backgroundColor: activeShapeSettings.color }}
                        />
                        <span className="color-value">
                          {activeShapeSettings.color.toUpperCase()}
                        </span>
                      </label>
                      <Button
                        aria-label={t("Reset to SVG color")}
                        onClick={() =>
                          updateShapes(selectedPathIndexes, (summary) => ({
                            color: getSvgColor(summary),
                          }))
                        }
                        type="button"
                        variant="icon"
                      >
                        <RotateCcw size={12} />
                      </Button>
                    </span>
                  </label>
                </InspectorStack>
              </InspectorSection>
            ) : null}

            <InspectorSection icon={<SlidersHorizontal size={14} />} title={t("Quality")}>
              <InspectorStack>
                <RangeControl
                  label={t("Curve segments")}
                  max={96}
                  min={4}
                  onChange={(value) =>
                    updateQualitySetting("curveSegments", value)
                  }
                  step={1}
                  value={activeQualitySettings.curveSegments}
                />
                <RangeControl
                  label={t("Curve precision")}
                  max={64}
                  min={2}
                  onChange={(value) =>
                    updateQualitySetting("curvePrecision", value)
                  }
                  step={1}
                  value={activeQualitySettings.curvePrecision}
                />
                <RangeControl
                  label={t("Bevel segments")}
                  max={12}
                  min={0}
                  onChange={(value) =>
                    updateQualitySetting("bevelSegments", value)
                  }
                  step={1}
                  value={activeQualitySettings.bevelSegments}
                />
              </InspectorStack>
            </InspectorSection>

            <InspectorSection
              action={
                <label className="title-switch">
                  <input
                    aria-label="Front convex / back concave"
                    checked={activeDomeSettings.enabled}
                    onChange={(event) =>
                      updateDomeSetting("enabled", event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span className="switch-track" />
                </label>
              }
              icon={<SlidersHorizontal size={14} />}
              title={t("Dome")}
            >
              {activeDomeSettings.enabled ? (
                <InspectorStack>
                  <RangeControl
                    label={t("Arc depth")}
                    max={1.2}
                    min={0.02}
                    onChange={(value) => updateDomeSetting("depth", value)}
                    step={0.01}
                    value={activeDomeSettings.depth}
                  />
                  <RangeControl
                    label={t("Arc radius")}
                    max={1.45}
                    min={0.65}
                    onChange={(value) => updateDomeSetting("radius", value)}
                    step={0.01}
                    value={activeDomeSettings.radius}
                  />
                  <RangeControl
                    label={t("Arc smoothness")}
                    max={128}
                    min={8}
                    onChange={(value) => updateDomeSetting("segments", value)}
                    step={1}
                    value={activeDomeSettings.segments}
                  />
                </InspectorStack>
              ) : null}
            </InspectorSection>

            <InspectorSection icon={<Download size={14} />} title={t("Export")}>
              <div className="export-actions">
                {MODEL_EXPORT_OPTIONS.map((option, index) => (
                  <Button
                    key={option.format}
                    disabled={isBusy}
                    fullWidth
                    onClick={() => exportModel(option.format)}
                    type="button"
                    variant={index === 0 ? "primary" : "secondary"}
                  >
                    <Download size={16} />
                    {t("Export")} {option.label}
                  </Button>
                ))}
                <Button
                  disabled={isBusy}
                  fullWidth
                  onClick={exportWorkJson}
                  type="button"
                >
                  <FileJson size={16} />
                  {t("Export JSON")}
                </Button>
              </div>
            </InspectorSection>
          </div>
        </aside>
      </main>
    </div>
  );
}
