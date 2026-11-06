import type { MaterialPreset } from "@/lib/types";

export const MATERIAL_PRESETS: MaterialPreset[] = [
  {
    id: "brushedGold",
    name: "Brushed gold",
    color: "#d8a737",
    metalness: 1,
    roughness: 0.34,
    previewSrc: "/material-previews/brushed-gold.svg",
  },
  {
    id: "agedSilver",
    name: "Aged silver",
    color: "#b9bec2",
    metalness: 1,
    roughness: 0.42,
    previewSrc: "/material-previews/aged-silver.svg",
  },
  {
    id: "blackenedSteel",
    name: "Blackened steel",
    color: "#1f2327",
    metalness: 0.88,
    roughness: 0.48,
    previewSrc: "/material-previews/blackened-steel.svg",
  },
  {
    id: "copper",
    name: "Warm copper",
    color: "#b8693e",
    metalness: 1,
    roughness: 0.38,
    previewSrc: "/material-previews/copper.svg",
  },
  {
    id: "whiteCeramic",
    name: "White ceramic",
    color: "#f1eee6",
    metalness: 0.02,
    roughness: 0.26,
    previewSrc: "/material-previews/white-ceramic.svg",
  },
  {
    id: "mattePolymer",
    name: "Matte polymer",
    color: "#3b6a8f",
    metalness: 0,
    roughness: 0.72,
    previewSrc: "/material-previews/matte-polymer.svg",
  },
];

export function getMaterialPreset(id: string): MaterialPreset {
  return (
    MATERIAL_PRESETS.find((material) => material.id === id) ??
    MATERIAL_PRESETS[0]
  );
}
