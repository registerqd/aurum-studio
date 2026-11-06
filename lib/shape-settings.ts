import { DEFAULT_SHAPE_SETTINGS } from "@/lib/defaults";
import type { MedalSettings, ShapeSettings, SvgPathSummary } from "@/lib/types";

function isUsableColor(value: string | undefined) {
  return Boolean(value && value !== "none" && !value.startsWith("url("));
}

export function getSvgColor(summary: SvgPathSummary | undefined) {
  if (isUsableColor(summary?.fill)) {
    return summary?.fill ?? DEFAULT_SHAPE_SETTINGS.color;
  }

  if (isUsableColor(summary?.stroke)) {
    return summary?.stroke ?? DEFAULT_SHAPE_SETTINGS.color;
  }

  return DEFAULT_SHAPE_SETTINGS.color;
}

export function resolveShapeSettings(
  settings: MedalSettings,
  pathIndex: number,
  summary?: SvgPathSummary,
): ShapeSettings {
  const patch = settings.shapeSettings[String(pathIndex)] ?? {};

  return {
    ...DEFAULT_SHAPE_SETTINGS,
    color: getSvgColor(summary),
    ...patch,
  };
}

export function getShapeLabel(summary: SvgPathSummary | undefined) {
  return summary?.name || `Shape ${summary ? summary.pathIndex + 1 : "?"}`;
}
