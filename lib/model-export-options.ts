export type ModelExportFormat = "glb" | "usdz";

export interface ModelExportOption {
  extension: string;
  format: ModelExportFormat;
  label: string;
  mimeType: string;
}

export const MODEL_EXPORT_OPTIONS: ModelExportOption[] = [
  { format: "glb", label: "GLB", extension: "glb", mimeType: "model/gltf-binary" },
  { format: "usdz", label: "USDZ", extension: "usdz", mimeType: "model/vnd.usdz+zip" },
];

export function getModelExportOption(format: ModelExportFormat): ModelExportOption {
  const option = MODEL_EXPORT_OPTIONS.find((candidate) => candidate.format === format);
  if (!option) throw new Error(`Unsupported model export format: ${format}`);
  return option;
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
