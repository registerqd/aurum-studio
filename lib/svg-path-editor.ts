export interface PathPoint {
  x: number;
  y: number;
}

export interface EditablePathCommand {
  type: string;
  values: number[];
}

const PARAM_COUNTS: Record<string, number> = {
  M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0,
};

const NUMBER_PATTERN = /[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;
const TOKEN_PATTERN = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:e[-+]?\d+)?/gi;

export function formatPathNumber(value: number) {
  return Number(value.toFixed(3)).toString();
}

export function parsePathData(pathData: string): EditablePathCommand[] {
  const tokens = pathData.match(TOKEN_PATTERN) ?? [];
  const commands: EditablePathCommand[] = [];
  let cursor = 0;
  let activeType = "";

  while (cursor < tokens.length) {
    if (/^[a-z]$/i.test(tokens[cursor])) activeType = tokens[cursor++];
    if (!activeType) break;
    const upper = activeType.toUpperCase();
    const count = PARAM_COUNTS[upper];
    if (count === undefined) break;
    if (count === 0) {
      commands.push({ type: activeType, values: [] });
      activeType = "";
      continue;
    }
    if (cursor + count > tokens.length) break;
    const values = tokens.slice(cursor, cursor + count).map(Number);
    if (values.some((value) => !Number.isFinite(value))) break;
    commands.push({ type: activeType, values });
    cursor += count;
    if (upper === "M") activeType = activeType === "M" ? "L" : "l";
  }

  return commands;
}

export function serializePathData(commands: EditablePathCommand[]) {
  return commands
    .map(({ type, values }) => `${type}${values.map(formatPathNumber).join(" ")}`)
    .join(" ");
}

export function commandEndpoint(
  command: EditablePathCommand,
  previous: PathPoint,
): PathPoint | null {
  const type = command.type.toUpperCase();
  const relative = command.type !== type;
  const values = command.values;
  let point: PathPoint | null = null;
  if (["M", "L", "T"].includes(type)) point = { x: values[0], y: values[1] };
  else if (type === "H") point = { x: values[0], y: relative ? 0 : previous.y };
  else if (type === "V") point = { x: relative ? 0 : previous.x, y: values[0] };
  else if (type === "C") point = { x: values[4], y: values[5] };
  else if (["S", "Q"].includes(type)) point = { x: values[2], y: values[3] };
  else if (type === "A") point = { x: values[5], y: values[6] };
  if (!point) return null;
  return relative ? { x: previous.x + point.x, y: previous.y + point.y } : point;
}

export function replacePathData(svgText: string, pathIndex: number, nextD: string) {
  const document = new DOMParser().parseFromString(svgText, "image/svg+xml");
  const shapes = document.querySelectorAll("path, rect, circle, ellipse, polygon, polyline, line");
  const shape = shapes[pathIndex];
  if (!(shape instanceof SVGPathElement) && shape?.tagName.toLowerCase() !== "path") return svgText;
  shape.setAttribute("d", nextD);
  return new XMLSerializer().serializeToString(document.documentElement);
}

function distanceToLine(point: PathPoint, start: PathPoint, end: PathPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  const t = Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
}

function rdpIndexes(points: PathPoint[], tolerance: number): Set<number> {
  if (points.length <= 2) return new Set(points.map((_, index) => index));
  let maxDistance = 0;
  let maxIndex = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const distance = distanceToLine(points[index], points[0], points[points.length - 1]);
    if (distance > maxDistance) { maxDistance = distance; maxIndex = index; }
  }
  if (maxDistance <= tolerance) return new Set([0, points.length - 1]);
  const left = rdpIndexes(points.slice(0, maxIndex + 1), tolerance);
  const right = rdpIndexes(points.slice(maxIndex), tolerance);
  return new Set([...left, ...[...right].map((index) => index + maxIndex)]);
}

export function simplifyPathData(pathData: string, strength: number) {
  if (strength <= 0) return pathData;
  const commands = parsePathData(pathData);
  const endpoints: PathPoint[] = [];
  const commandIndexes: number[] = [];
  let current = { x: 0, y: 0 };
  commands.forEach((command, index) => {
    const endpoint = commandEndpoint(command, current);
    if (endpoint) { current = endpoint; endpoints.push(endpoint); commandIndexes.push(index); }
  });
  if (endpoints.length < 4) return pathData;
  const xs = endpoints.map((point) => point.x);
  const ys = endpoints.map((point) => point.y);
  const diagonal = Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const keep = rdpIndexes(endpoints, diagonal * Math.pow(strength / 100, 2) * 0.08);
  const removableCommands = new Set(
    commandIndexes.filter((commandIndex, pointIndex) => {
      const type = commands[commandIndex].type.toUpperCase();
      return !keep.has(pointIndex) && type !== "M";
    }),
  );
  return serializePathData(commands.filter((_, index) => !removableCommands.has(index)));
}

export function getPathNumberCount(pathData: string) {
  return pathData.match(NUMBER_PATTERN)?.length ?? 0;
}
