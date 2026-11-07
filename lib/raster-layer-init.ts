import type { ShapeSettingsPatch } from "@/lib/types";

/**
 * Raster imports arrive as dozens of stacked bands. Extruding them all at the
 * default thickness fuses them into one solid block, so we seed per-layer
 * settings: the background plate is hidden, gradient bands get thin shims that
 * step up in Z, and solid shapes get a moderate relief.
 */

interface LayerMeta {
  area: number;
  band: number;
  gradient: boolean;
  background: boolean;
}

const PATH_TAG = /<path\b[^>]*>/gi;

function attr(tag: string, name: string): string {
  const match = new RegExp(`${name}="([^"]*)"`, "i").exec(tag);
  return match ? match[1] : "";
}

export function parseRasterLayers(svgText: string): LayerMeta[] {
  const metas: LayerMeta[] = [];
  for (const match of svgText.matchAll(PATH_TAG)) {
    const tag = match[0];
    if (!attr(tag, "data-layer")) continue;
    metas.push({
      area: Number(attr(tag, "data-area") || 0),
      band: Number(attr(tag, "data-band") || 0),
      gradient: attr(tag, "data-gradient") === "1",
      background: attr(tag, "data-bg") === "1",
    });
  }
  return metas;
}

export function isRasterTrace(svgText: string): boolean {
  return /data-layer="/i.test(svgText) && /id="raster-trace"/i.test(svgText);
}

/** Build per-path overrides for a freshly traced bitmap. */
export function buildRasterShapeSettings(
  svgText: string,
): Record<string, ShapeSettingsPatch> {
  const layers = parseRasterLayers(svgText);
  if (!layers.length) return {};

  const result: Record<string, ShapeSettingsPatch> = {};
  layers.forEach((layer, index) => {
    if (layer.background) {
      result[String(index)] = { visible: false, deleted: false };
      return;
    }
    if (layer.gradient) {
      result[String(index)] = {
        thickness: 0.02 + layer.band * 0.004,
        bevel: 0.003,
        bevelSegments: 1,
        depthSteps: 1,
        zOffset: layer.band * 0.014,
        curveSegments: 16,
      };
      return;
    }
    result[String(index)] = {
      thickness: 0.06,
      bevel: 0.008,
      bevelSegments: 2,
      depthSteps: 1,
      zOffset: 0,
      curveSegments: 20,
    };
  });

  return result;
}
