"use client";

import * as THREE from "three";

/**
 * Mesh repair utilities.
 *
 * SVG extrusions regularly produce open shells: self-intersecting sub-paths,
 * duplicated vertices from independent bevel segments and non-manifold seams
 * between stacked layers. This module welds, cleans and closes those shells so
 * the result survives boolean ops and 3D printing.
 */

export interface RepairOptions {
  /** Vertex merge distance, in scene units. */
  weldTolerance: number;
  /** Drop triangles whose area is below this value. */
  degenerateArea: number;
  /** Recalculate vertex normals after repair. */
  recomputeNormals: boolean;
  /** Flip faces that point inward (uses signed volume voting). */
  unifyWinding: boolean;
  /** Close boundary loops by fan triangulation. */
  fillHoles: boolean;
  /** Skip loops whose perimeter exceeds this (guards against false loops). */
  maxHoleEdges: number;
  /** Remove duplicated triangles that share the same 3 vertices. */
  removeDuplicates: boolean;
}

export const DEFAULT_REPAIR_OPTIONS: RepairOptions = {
  weldTolerance: 0.0005,
  degenerateArea: 1e-9,
  recomputeNormals: true,
  unifyWinding: true,
  fillHoles: true,
  maxHoleEdges: 512,
  removeDuplicates: true,
};

export interface RepairReport {
  inputVertices: number;
  outputVertices: number;
  inputTriangles: number;
  outputTriangles: number;
  weldedVertices: number;
  degenerateRemoved: number;
  duplicateRemoved: number;
  flippedFaces: number;
  boundaryLoops: number;
  holesFilled: number;
  nonManifoldEdges: number;
  watertight: boolean;
}

const EPS = 1e-7;

function keyOf(x: number, y: number, z: number, tolerance: number): string {
  const q = 1 / Math.max(tolerance, EPS);
  return `${Math.round(x * q)}|${Math.round(y * q)}|${Math.round(z * q)}`;
}

interface Triangle {
  a: number;
  b: number;
  c: number;
}

function readTriangles(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute | undefined;
  if (!position) return { positions: [] as number[], triangles: [] as Triangle[] };

  const positions: number[] = [];
  const triangles: Triangle[] = [];
  const index = geometry.getIndex();

  if (index) {
    for (let i = 0; i < index.count; i += 1) {
      const vi = index.getX(i);
      positions.push(position.getX(vi), position.getY(vi), position.getZ(vi));
      if (i % 3 === 2) {
        const base = positions.length / 3;
        triangles.push({ a: base - 3, b: base - 2, c: base - 1 });
      }
    }
  } else {
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      if (i % 3 === 2) {
        const base = positions.length / 3;
        triangles.push({ a: base - 3, b: base - 2, c: base - 1 });
      }
    }
  }
  return { positions, triangles };
}

function triArea(p: number[], t: Triangle): number {
  const ax = p[t.a * 3], ay = p[t.a * 3 + 1], az = p[t.a * 3 + 2];
  const bx = p[t.b * 3], by = p[t.b * 3 + 1], bz = p[t.b * 3 + 2];
  const cx = p[t.c * 3], cy = p[t.c * 3 + 1], cz = p[t.c * 3 + 2];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  return Math.sqrt(nx * nx + ny * ny + nz * nz) / 2;
}

/** Weld vertices by quantized position, keeping the first occurrence. */
function weld(positions: number[], tolerance: number) {
  const map = new Map<string, number>();
  const out: number[] = [];
  const remap = new Int32Array(positions.length / 3);
  for (let i = 0; i < positions.length / 3; i += 1) {
    const x = positions[i * 3], y = positions[i * 3 + 1], z = positions[i * 3 + 2];
    const key = keyOf(x, y, z, tolerance);
    const existing = map.get(key);
    if (existing !== undefined) {
      remap[i] = existing;
    } else {
      const next = out.length / 3;
      map.set(key, next);
      out.push(x, y, z);
      remap[i] = next;
    }
  }
  return { positions: out, remap, welded: positions.length / 3 - out.length / 3 };
}

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}_${b}` : `${b}_${a}`;
}

/** Collect boundary edges (used by exactly one triangle) into ordered loops. */
function findBoundaryLoops(triangles: Triangle[]) {
  const counts = new Map<string, number>();
  for (const t of triangles) {
    for (const [a, b] of [[t.a, t.b], [t.b, t.c], [t.c, t.a]] as Array<[number, number]>) {
      const k = edgeKey(a, b);
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }

  const boundary: Array<[number, number]> = [];
  let nonManifold = 0;
  for (const [key, count] of counts) {
    if (count === 1) {
      const [a, b] = key.split("_").map(Number);
      boundary.push([a, b]);
    } else if (count > 2) {
      nonManifold += 1;
    }
  }

  const adjacency = new Map<number, number[]>();
  for (const [a, b] of boundary) {
    if (!adjacency.has(a)) adjacency.set(a, []);
    if (!adjacency.has(b)) adjacency.set(b, []);
    adjacency.get(a)!.push(b);
    adjacency.get(b)!.push(a);
  }

  const used = new Set<string>();
  const loops: number[][] = [];
  for (const [a, b] of boundary) {
    const startKey = edgeKey(a, b);
    if (used.has(startKey)) continue;
    const loop: number[] = [a, b];
    used.add(startKey);
    let current = b;
    let previous = a;
    let guard = 0;
    while (guard < boundary.length + 4) {
      guard += 1;
      const neighbours = adjacency.get(current) ?? [];
      const next = neighbours.find((n) => n !== previous && !used.has(edgeKey(current, n)));
      if (next === undefined) break;
      used.add(edgeKey(current, next));
      if (next === loop[0]) break;
      loop.push(next);
      previous = current;
      current = next;
    }
    if (loop.length >= 3) loops.push(loop);
  }

  return { loops, nonManifold };
}

export function repairGeometry(
  geometry: THREE.BufferGeometry,
  partial: Partial<RepairOptions> = {},
): { geometry: THREE.BufferGeometry; report: RepairReport } {
  const options = { ...DEFAULT_REPAIR_OPTIONS, ...partial };
  const source = readTriangles(geometry);
  const report: RepairReport = {
    inputVertices: source.positions.length / 3,
    outputVertices: 0,
    inputTriangles: source.triangles.length,
    outputTriangles: 0,
    weldedVertices: 0,
    degenerateRemoved: 0,
    duplicateRemoved: 0,
    flippedFaces: 0,
    boundaryLoops: 0,
    holesFilled: 0,
    nonManifoldEdges: 0,
    watertight: false,
  };

  if (!source.triangles.length) {
    return { geometry: geometry.clone(), report };
  }

  const { positions, remap, welded } = weld(source.positions, options.weldTolerance);
  report.weldedVertices = welded;

  let triangles: Triangle[] = [];
  const seen = new Set<string>();
  for (const t of source.triangles) {
    const a = remap[t.a], b = remap[t.b], c = remap[t.c];
    if (a === b || b === c || a === c) {
      report.degenerateRemoved += 1;
      continue;
    }
    const tri = { a, b, c };
    if (triArea(positions, tri) <= options.degenerateArea) {
      report.degenerateRemoved += 1;
      continue;
    }
    if (options.removeDuplicates) {
      const sig = [a, b, c].sort((x, y) => x - y).join("_");
      if (seen.has(sig)) {
        report.duplicateRemoved += 1;
        continue;
      }
      seen.add(sig);
    }
    triangles.push(tri);
  }

  // Unify winding using signed volume: if the shell is mostly inside-out, flip.
  if (options.unifyWinding && triangles.length) {
    let volume = 0;
    for (const t of triangles) {
      const ax = positions[t.a * 3], ay = positions[t.a * 3 + 1], az = positions[t.a * 3 + 2];
      const bx = positions[t.b * 3], by = positions[t.b * 3 + 1], bz = positions[t.b * 3 + 2];
      const cx = positions[t.c * 3], cy = positions[t.c * 3 + 1], cz = positions[t.c * 3 + 2];
      volume +=
        ax * (by * cz - bz * cy) -
        ay * (bx * cz - bz * cx) +
        az * (bx * cy - by * cx);
    }
    if (volume < 0) {
      triangles = triangles.map((t) => ({ a: t.a, b: t.c, c: t.b }));
      report.flippedFaces = triangles.length;
    }
  }

  const { loops, nonManifold } = findBoundaryLoops(triangles);
  report.nonManifoldEdges = nonManifold;
  report.boundaryLoops = loops.length;

  if (options.fillHoles) {
    for (const loop of loops) {
      if (loop.length > options.maxHoleEdges || loop.length < 3) continue;
      // Centroid fan: robust for non-planar loops and cheap to compute.
      let cx = 0, cy = 0, cz = 0;
      for (const vi of loop) {
        cx += positions[vi * 3];
        cy += positions[vi * 3 + 1];
        cz += positions[vi * 3 + 2];
      }
      cx /= loop.length;
      cy /= loop.length;
      cz /= loop.length;
      const center = positions.length / 3;
      positions.push(cx, cy, cz);
      for (let i = 0; i < loop.length; i += 1) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        triangles.push({ a: center, b, c: a });
      }
      report.holesFilled += 1;
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const indices = new Uint32Array(triangles.length * 3);
  triangles.forEach((t, i) => {
    indices[i * 3] = t.a;
    indices[i * 3 + 1] = t.b;
    indices[i * 3 + 2] = t.c;
  });
  out.setIndex(new THREE.BufferAttribute(indices, 1));
  if (options.recomputeNormals) out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();

  report.outputVertices = positions.length / 3;
  report.outputTriangles = triangles.length;
  report.watertight = report.boundaryLoops === report.holesFilled && report.nonManifoldEdges === 0;

  return { geometry: out, report };
}

/** Repair every mesh under a group, in place. */
export function repairGroup(
  group: THREE.Object3D,
  partial: Partial<RepairOptions> = {},
): { reports: Array<{ name: string; report: RepairReport }>; total: RepairReport } {
  const reports: Array<{ name: string; report: RepairReport }> = [];
  const total: RepairReport = {
    inputVertices: 0, outputVertices: 0, inputTriangles: 0, outputTriangles: 0,
    weldedVertices: 0, degenerateRemoved: 0, duplicateRemoved: 0, flippedFaces: 0,
    boundaryLoops: 0, holesFilled: 0, nonManifoldEdges: 0, watertight: true,
  };

  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const { geometry, report } = repairGeometry(child.geometry, partial);
    child.geometry.dispose();
    child.geometry = geometry;
    reports.push({ name: child.name || "mesh", report });
    for (const key of Object.keys(total) as Array<keyof RepairReport>) {
      if (key === "watertight") {
        total.watertight = total.watertight && report.watertight;
      } else {
        total[key] = (total[key] as number) + (report[key] as number);
      }
    }
  });

  return { reports, total };
}
