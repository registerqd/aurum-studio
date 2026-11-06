export type PresentationExportFormat = "gif" | "mov";

export interface PresentationExportOption {
  extension: string;
  format: PresentationExportFormat;
  label: string;
  mimeType: string;
}

export const PRESENTATION_EXPORT_OPTIONS: PresentationExportOption[] = [
  { extension: "mov", format: "mov", label: "MOV", mimeType: "video/quicktime" },
  { extension: "gif", format: "gif", label: "GIF", mimeType: "image/gif" },
];

export function getPresentationExportOption(
  format: PresentationExportFormat,
): PresentationExportOption {
  const option = PRESENTATION_EXPORT_OPTIONS.find(
    (candidate) => candidate.format === format,
  );
  if (!option) throw new Error(`Unsupported presentation export format: ${format}`);
  return option;
}
