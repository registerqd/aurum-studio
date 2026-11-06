/**
 * Raster → vector tracing pipeline.
 *
 * A bitmap is quantized with median cut, gradient clusters are posterized into
 * luminance bands (so a smooth render becomes a stack of flat, extrudable
 * layers), then every band is contour-traced and simplified into SVG paths.
 */

export interface PngToSvgOptions {
  colors: number;
  smoothing: number;
  simplify: number;
  minArea: number;
  removeBackground: boolean;
  backgroundTolerance: number;
  gradientLayers: number;
  outline: number;
  maxSize: number;
}

export const DEFAULT_PNG_TO_SVG_OPTIONS: PngToSvgOptions = {
  colors: 10,
  smoothing: 1,
  simplify: 1.2,
  minArea: 24,
  removeBackground: true,
  backgroundTolerance: 26,
  gradientLayers: 3,
  outline: 0,
  maxSize: 512,
};

export interface SvgLayer {
  id: string;
  color: string;
  band: number;
  area: number;
  path: string;
  fromGradient: boolean;
}

export interface PngToSvgResult {
  svg: string;
  layers: SvgLayer[];
  width: number;
  height: number;
  stats: {
    sourceWidth: number;
    sourceHeight: number;
    paletteSize: number;
    gradientClusters: number;
    components: number;
    droppedComponents: number;
  };
}

type RGB = [number, number, number];

const toHex = (c: RGB): string =>
  "#" +
  c
    .map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0"))
    .join("");

const lum = (c: RGB): number => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const dist = (a: RGB, b: RGB): number =>
  Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);

function downscale(source: ImageData, maxSize: number) {
  const longEdge = Math.max(source.width, source.height);
  if (longEdge <= maxSize) {
    return { data: source.data, width: source.width, height: source.height };
  }
  const ratio = maxSize / longEdge;
  const width = Math.max(1, Math.round(source.width * ratio));
  const height = Math.max(1, Math.round(source.height * ratio));
  const out = new Uint8ClampedArray(width * height * 4);
  const sx = source.width / width;
  const sy = source.height / height;
  for (let y = 0; y < height; y += 1) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(source.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < width; x += 1) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(source.width, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        for (let xx = x0; xx < x1; xx += 1) {
          const i = (yy * source.width + xx) * 4;
          const alpha = source.data[i + 3] / 255;
          r += source.data[i] * alpha;
          g += source.data[i + 1] * alpha;
          b += source.data[i + 2] * alpha;
          a += source.data[i + 3];
          n += 1;
        }
      }
      const o = (y * width + x) * 4;
      if (!n) continue;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = a / n;
    }
  }
  return { data: out, width, height };
}

function boxBlur(data: Uint8ClampedArray, width: number, height: number, radius: number) {
  if (radius <= 0) return data;
  const r = Math.round(radius);
  const tmp = new Uint8ClampedArray(data.length);
  const out = new Uint8ClampedArray(data.length);
  const pass = (src: Uint8ClampedArray, dst: Uint8ClampedArray, horizontal: boolean) => {
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
        for (let d = -r; d <= r; d += 1) {
          const xx = horizontal ? Math.min(width - 1, Math.max(0, x + d)) : x;
          const yy = horizontal ? y : Math.min(height - 1, Math.max(0, y + d));
          const i = (yy * width + xx) * 4;
          sr += src[i];
          sg += src[i + 1];
          sb += src[i + 2];
          sa += src[i + 3];
          n += 1;
        }
        const o = (y * width + x) * 4;
        dst[o] = sr / n;
        dst[o + 1] = sg / n;
        dst[o + 2] = sb / n;
        dst[o + 3] = sa / n;
      }
    }
  };
  pass(data, tmp, true);
  pass(tmp, out, false);
  return out;
}

interface Box {
  px: number[];
  rMin: number; rMax: number; gMin: number; gMax: number; bMin: number; bMax: number;
}

function makeBox(data: Uint8ClampedArray, px: number[]): Box {
  let rMin = 255, rMax = 0, gMin = 255, gMax = 0, bMin = 255, bMax = 0;
  for (const p of px) {
    const i = p * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    if (r < rMin) rMin = r;
    if (r > rMax) rMax = r;
    if (g < gMin) gMin = g;
    if (g > gMax) gMax = g;
    if (b < bMin) bMin = b;
    if (b > bMax) bMax = b;
  }
  return { px, rMin, rMax, gMin, gMax, bMin, bMax };
}

const boxScore = (b: Box): number =>
  (b.rMax - b.rMin + 1) * (b.gMax - b.gMin + 1) * (b.bMax - b.bMin + 1) * Math.log(b.px.length + 1);

function average(data: Uint8ClampedArray, px: number[]): RGB {
  let r = 0, g = 0, b = 0;
  for (const p of px) {
    const i = p * 4;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  const n = Math.max(1, px.length);
  return [r / n, g / n, b / n];
}

function medianCut(data: Uint8ClampedArray, px: number[], target: number): RGB[] {
  const boxes: Box[] = [makeBox(data, px)];
  while (boxes.length < target) {
    let best = -1;
    let bestScore = -1;
    boxes.forEach((box, i) => {
      if (box.px.length < 2) return;
      const s = boxScore(box);
      if (s > bestScore) {
        bestScore = s;
        best = i;
      }
    });
    if (best < 0) break;
    const box = boxes[best];
    const spans = [box.rMax - box.rMin, box.gMax - box.gMin, box.bMax - box.bMin];
    const axis = spans[0] >= spans[1] && spans[0] >= spans[2] ? 0 : spans[1] >= spans[2] ? 1 : 2;
    const sorted = [...box.px].sort((a, b) => data[a * 4 + axis] - data[b * 4 + axis]);
    const mid = Math.floor(sorted.length / 2);
    const left = sorted.slice(0, mid);
    const right = sorted.slice(mid);
    if (!left.length || !right.length) {
      boxes.splice(best, 1);
      continue;
    }
    boxes.splice(best, 1, makeBox(data, left), makeBox(data, right));
  }
  return boxes.map((box) => average(data, box.px));
}

/** Moore-neighbour boundary tracing on a binary mask. */
function traceMask(mask: Uint8Array, width: number, height: number) {
  const seen = new Uint8Array(width * height);
  const out: Array<{ points: Array<[number, number]>; area: number }> = [];
  const dirs: Array<[number, number]> = [
    [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  ];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (!mask[start] || seen[start]) continue;
      const contour: Array<[number, number]> = [];
      let cx = x, cy = y, dir = 0, guard = 0;
      const limit = width * height * 4;
      const key = `${x},${y}`;
      do {
        contour.push([cx, cy]);
        seen[cy * width + cx] = 1;
        let moved = false;
        for (let s = 0; s < 8; s += 1) {
          const d = (dir + 6 + s) % 8;
          const nx = cx + dirs[d][0];
          const ny = cy + dirs[d][1];
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          if (mask[ny * width + nx]) {
            cx = nx;
            cy = ny;
            dir = d;
            moved = true;
            break;
          }
        }
        if (!moved) break;
        guard += 1;
      } while (`${cx},${cy}` !== key && guard < limit);
      if (contour.length < 4) continue;
      let area = 0;
      for (let i = 0; i < contour.length; i += 1) {
        const [x1, y1] = contour[i];
        const [x2, y2] = contour[(i + 1) % contour.length];
        area += x1 * y2 - x2 * y1;
      }
      out.push({ points: contour, area: Math.abs(area) / 2 });
    }
  }
  return out;
}

function segDist(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  if (len === 0) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Douglas-Peucker simplification, iterative to avoid deep recursion. */
function simplify(points: Array<[number, number]>, tolerance: number) {
  if (points.length < 4 || tolerance <= 0) return points;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: Array<[number, number]> = [[0, points.length - 1]];
  while (stack.length) {
    const [first, last] = stack.pop() as [number, number];
    let maxD = -1, idx = -1;
    for (let i = first + 1; i < last; i += 1) {
      const d = segDist(points[i][0], points[i][1], points[first][0], points[first][1], points[last][0], points[last][1]);
      if (d > maxD) { maxD = d; idx = i; }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([first, idx], [idx, last]);
    }
  }
  const out: Array<[number, number]> = [];
  for (let i = 0; i < points.length; i += 1) if (keep[i]) out.push(points[i]);
  return out.length >= 3 ? out : points;
}

const toPath = (points: Array<[number, number]>) => {
  if (!points.length) return "";
  const [first, ...rest] = points;
  let d = `M${first[0].toFixed(2)} ${first[1].toFixed(2)}`;
  for (const [x, y] of rest) d += `L${x.toFixed(2)} ${y.toFixed(2)}`;
  return `${d}Z`;
};

function detectBackground(data: Uint8ClampedArray, width: number, height: number): RGB | null {
  let r = 0, g = 0, b = 0, n = 0;
  const take = (x: number, y: number) => {
    const i = (y * width + x) * 4;
    if (data[i + 3] < 24) return;
    r += data[i]; g += data[i + 1]; b += data[i + 2]; n += 1;
  };
  for (let x = 0; x < width; x += 1) { take(x, 0); take(x, height - 1); }
  for (let y = 0; y < height; y += 1) { take(0, y); take(width - 1, y); }
  return n ? [r / n, g / n, b / n] : null;
}

export function convertImageDataToSvg(
  source: ImageData,
  partial: Partial<PngToSvgOptions> = {},
): PngToSvgResult {
  const opt = { ...DEFAULT_PNG_TO_SVG_OPTIONS, ...partial };
  const { data, width, height } = downscale(source, opt.maxSize);
  const px = boxBlur(data, width, height, Math.round(opt.smoothing));

  const opaque: number[] = [];
  for (let p = 0; p < width * height; p += 1) if (px[p * 4 + 3] > 32) opaque.push(p);

  const bg = opt.removeBackground ? detectBackground(px, width, height) : null;
  const palette = medianCut(px, opaque, Math.max(2, Math.min(32, Math.round(opt.colors))));

  const label = new Int16Array(width * height).fill(-1);
  for (const p of opaque) {
    const i = p * 4;
    const rgb: RGB = [px[i], px[i + 1], px[i + 2]];
    if (bg && dist(rgb, bg) <= opt.backgroundTolerance) continue;
    let best = 0, bestD = Infinity;
    for (let c = 0; c < palette.length; c += 1) {
      const d = dist(rgb, palette[c]);
      if (d < bestD) { bestD = d; best = c; }
    }
    label[p] = best;
  }

  const spread = palette.map(() => ({ min: 255, max: 0 }));
  for (const p of opaque) {
    const c = label[p];
    if (c < 0) continue;
    const i = p * 4;
    const l = lum([px[i], px[i + 1], px[i + 2]]);
    if (l < spread[c].min) spread[c].min = l;
    if (l > spread[c].max) spread[c].max = l;
  }

  const bandCount = Math.max(1, Math.min(8, Math.round(opt.gradientLayers)));
  const clusterBands = spread.map((s) => (s.max - s.min > 18 ? bandCount : 1));
  const gradientClusters = clusterBands.filter((b) => b > 1).length;

  const layers: SvgLayer[] = [];
  let components = 0;
  let dropped = 0;

  const pushContours = (mask: Uint8Array, color: string, band: number, gradient: boolean) => {
    for (const contour of traceMask(mask, width, height)) {
      components += 1;
      if (contour.area < opt.minArea) { dropped += 1; continue; }
      layers.push({
        id: `l${layers.length}-${band}`,
        color,
        band,
        area: contour.area,
        path: toPath(simplify(contour.points, opt.simplify)),
        fromGradient: gradient,
      });
    }
  };

  for (let c = 0; c < palette.length; c += 1) {
    const bands = clusterBands[c];
    if (bands === 1) {
      const mask = new Uint8Array(width * height);
      for (let p = 0; p < width * height; p += 1) if (label[p] === c) mask[p] = 1;
      pushContours(mask, toHex(palette[c]), 0, false);
      continue;
    }
    const { min, max } = spread[c];
    const span = Math.max(1, max - min);
    const masks = Array.from({ length: bands }, () => new Uint8Array(width * height));
    for (let p = 0; p < width * height; p += 1) {
      if (label[p] !== c) continue;
      const i = p * 4;
      const l = lum([px[i], px[i + 1], px[i + 2]]);
      const b = Math.min(bands - 1, Math.floor(((l - min) / span) * bands));
      masks[b][p] = 1;
    }
    for (let b = 0; b < bands; b += 1) {
      const f = 1 + (b / Math.max(1, bands - 1)) * 0.55;
      const color: RGB = [
        Math.min(255, palette[c][0] * f),
        Math.min(255, palette[c][1] * f),
        Math.min(255, palette[c][2] * f),
      ];
      pushContours(masks[b], toHex(color), b, true);
    }
  }

  layers.sort((a, b) => b.area - a.area);

  const body = layers
    .map(
      (layer, i) =>
        `  <path id="${layer.id}" data-layer="${i}" data-band="${layer.band}" ` +
        `data-gradient="${layer.fromGradient ? 1 : 0}" fill="${layer.color}" ` +
        `${opt.outline > 0 ? `stroke="${layer.color}" stroke-width="${opt.outline}" stroke-linejoin="round" ` : ""}` +
        `fill-rule="evenodd" d="${layer.path}" />`,
    )
    .join("\n");

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">\n` +
    `  <g id="raster-trace">\n${body}\n  </g>\n</svg>`;

  return {
    svg,
    layers,
    width,
    height,
    stats: {
      sourceWidth: source.width,
      sourceHeight: source.height,
      paletteSize: palette.length,
      gradientClusters,
      components,
      droppedComponents: dropped,
    },
  };
}

export async function fileToImageData(file: File, maxSize = 1024): Promise<ImageData> {
  const bitmap = await createImageBitmap(file);
  const longEdge = Math.max(bitmap.width, bitmap.height);
  const ratio = longEdge > maxSize ? maxSize / longEdge : 1;
  const width = Math.max(1, Math.round(bitmap.width * ratio));
  const height = Math.max(1, Math.round(bitmap.height * ratio));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.drawImage(bitmap, 0, 0, width, height);
  const data = ctx.getImageData(0, 0, width, height);
  bitmap.close?.();
  return data;
}

export function renderLayersToDataUrl(layers: SvgLayer[], width: number, height: number): string {
  if (typeof document === "undefined") return "";
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  for (const layer of layers) {
    ctx.fillStyle = layer.color;
    ctx.fill(new Path2D(layer.path), "evenodd");
  }
  return canvas.toDataURL("image/png");
}

export const PNG_TO_SVG_PRESETS = [
  {
    id: "badge",
    label: "徽章 / 奖牌",
    description: "干净边缘、少量色阶，可直接挤出",
    values: { colors: 8, smoothing: 1, simplify: 1, minArea: 40, gradientLayers: 2, outline: 0 },
  },
  {
    id: "photo",
    label: "照片 / 渐变",
    description: "多色阶分层，把渐变拆成可堆叠薄层",
    values: { colors: 14, smoothing: 2, simplify: 1.6, minArea: 18, gradientLayers: 5, outline: 0 },
  },
  {
    id: "lineart",
    label: "线稿 / 图标",
    description: "保留细线，阈值更小",
    values: { colors: 4, smoothing: 0, simplify: 0.6, minArea: 6, gradientLayers: 1, outline: 1 },
  },
] as const;
