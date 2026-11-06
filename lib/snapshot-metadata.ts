import type { WorkDocument } from "@/lib/types";
import {
  createWorkSnapshotSourceSignature,
  getPrimarySvgAsset,
} from "@/lib/work-document";

export const SNAPSHOT_WIDTH = 320;
export const SNAPSHOT_HEIGHT = 320;
export const SNAPSHOT_RENDER_VERSION = 16;

export function getSnapshotSourceSignature(document: WorkDocument) {
  const asset = getPrimarySvgAsset(document);

  return JSON.stringify({
    renderVersion: SNAPSHOT_RENDER_VERSION,
    source: createWorkSnapshotSourceSignature({
      svgText: asset.text,
      settings: document.scene.settings,
    }),
  });
}

export function needsSnapshot(document: WorkDocument) {
  const snapshot = document.preview.snapshot;

  return (
    !snapshot ||
    snapshot.width !== SNAPSHOT_WIDTH ||
    snapshot.height !== SNAPSHOT_HEIGHT ||
    snapshot.sourceSignature !== getSnapshotSourceSignature(document)
  );
}
