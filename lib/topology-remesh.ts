"use client";

import * as THREE from "three";

/**
 * Topology reconstruction.
 *
 * Two passes, both dependency free:
 *  1. Vertex clustering — snap vertices to a 3D grid, merge cells, drop the
 *     resulting degenerate faces. Produces a cleaner, more uniform topology and
 *     removes slivers left behind by SVG bevels.
 *  2. Laplacian smoothing — relaxes vertex positions along the neighbourhood
 *     average, with optional shrinkage compensation.
 */

export interface RemeshOptions {
  /** Cluster cell size in scene units. Larger = coarser topology. */
  cellSize: number;
  /** Smoothing iterations applied after clustering (0 = off). */
  smoothIterations: number;
  /** Relaxation strength per iteration, 0..1. */
  smoothStrength: number;
  /** Preserve sharp edges by clamping displacement. */
  preserveFeatures: boolean;
  /** Recompute normals at the end. */
  recomputeNormals: boolean;
}

export const DEFAULT_REMESH_OPTIONS: RemeshOptions = {
  cellSize: 0.004,
  smoothIterations: 3,
  smoothStrength: 0.35,
  preserveFeatures: true,
  recomputeNormals: true,
};

export interface RemeshReport {
  beforeVertices: number;
  afterVertices: number;
  beforeTriangles: number;
  afterTriangles: number;
  mergedVertices: number;
  droppedFaces: number;
  smoothedIterations: number;
}

function readGeometry(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position") as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const positions: number[] = [];
  const faces: Array<[number, number, number]> = [];

  if (index) {
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
    }
    for (let i = 0; i < index.count; i += 3) {
      faces.push([index.getX(i), index.getX(i + 1), index.getX(i + 2)]);
    }
  } else {
    for (let i = 0; i < position.count; i += 1) {
      positions.push(position.getX(i), position.getY(i), position.getZ(i));
      if (i % 3 === 2) {
        const base = positions.length / 3;
        faces.push([base - 3, base - 2, base - 1]);
      }
    }
  }
  return { positions, faces };
}

/** Cluster vertices onto a grid and average the members of each cell. */
function cluster(positions: number[], faces: Array<[number, number, number]>, cellSize: number) {
  const size = Math.max(cellSize, 1e-6);
  const map = new Map<string, number>();
  const sums: number[][] = [];
  const counts: number[] = [];
  const remap = new Int32Array(positions.length / 3);

  for (let i = 0; i < positions.length / 3; i += 1) {
    const x = positions[i * 3];
    const y = positions[i * 3 + 1];
    const z = positions[i * 3 + 2];
    const key = `${Math.round(x / size)}|${Math.round(y / size)}|${Math.round(z / size)}`;
    let idx = map.get(key);
    if (idx === undefined) {
      idx = sums.length;
      map.set(key, idx);
      sums.push([0, 0, 0]);
      counts.push(0);
    }
    sums[idx][0] += x;
    sums[idx][1] += y;
    sums[idx][2] += z;
    counts[idx] += 1;
    remap[i] = idx;
  }

  const outPositions: number[] = [];
  for (let i = 0; i < sums.length; i += 1) {
    outPositions.push(sums[i][0] / counts[i], sums[i][1] / counts[i], sums[i][2] / counts[i]);
  }

  const remappedFaces: Array<[number, number, number]> = [];
  let dropped = 0;
  for (const [a, b, c] of faces) {
    const na = remap[a];
    const nb = remap[b];
    const nc = remap[c];
    if (na === nb || nb === nc || na === nc) {
      dropped += 1;
      continue;
    }
    remappedFaces.push([na, nb, nc]);
  }

  return {
    positions: outPositions,
    faces: remappedFaces,
    dropped,
    merged: positions.length / 3 - outPositions.length / 3,
  };
}

/** Laplacian relaxation with neighbour adjacency built from faces. */
function smooth(
  positions: number[],
  faces: Array<[number, number, number]>,
  iterations: number,
  strength: number,
  preserveFeatures: boolean,
) {
  if (iterations <= 0 || strength <= 0) return positions;
  const n = positions.length / 3;
  const adjacency: number[][] = Array.from({ length: n }, () => []);
  for (const [a, b, c] of faces) {
    adjacency[a].push(b, c);
    adjacency[b].push(a, c);
    adjacency[c].push(a, b);
  }

  let current = positions.slice();
  for (let iter = 0; iter < iterations; iter += 1) {
    const next = current.slice();
    for (let i = 0; i < n; i += 1) {
      const neighbours = adjacency[i];
      if (!neighbours || neighbours.length < 3) continue;
      let ax = 0, ay = 0, az = 0;
      for (const j of neighbours) {
        ax += current[j * 3];
        ay += current[j * 3 + 1];
        az += current[j * 3 + 2];
      }
      const k = neighbours.length;
      const tx = current[i * 3] + (ax / k - current[i * 3]) * strength;
      const ty = current[i * 3 + 1] + (ay / k - current[i * 3 + 1]) * strength;
      const tz = current[i * 3 + 2] + (az / k - current[i * 3 + 2]) * strength;

      if (preserveFeatures) {
        // Clamp movement so sharp corners keep their silhouette.
        const dx = tx - current[i * 3];
        const dy = ty - current[i * 3 + 1];
        const dz = tz - current[i * 3 + 2];
        const len = Math.hypot(dx, dy, dz);
        const limit = 0.02;
        if (len > limit) {
          next[i * 3] = current[i * 3] + (dx / len) * limit;
          next[i * 3 + 1] = current[i * 3 + 1] + (dy / len) * limit;
          next[i * 3 + 2] = current[i * 3 + 2] + (dz / len) * limit;
          continue;
        }
      }
      next[i * 3] = tx;
      next[i * 3 + 1] = ty;
      next[i * 3 + 2] = tz;
    }
    current = next;
  }
  return current;
}

export function remeshGeometry(
  geometry: THREE.BufferGeometry,
  partial: Partial<RemeshOptions> = {},
): { geometry: THREE.BufferGeometry; report: RemeshReport } {
  const options = { ...DEFAULT_REMESH_OPTIONS, ...partial };
  const { positions, faces } = readGeometry(geometry);

  const clustered = cluster(positions, faces, options.cellSize);
  const smoothed = smooth(
    clustered.positions,
    clustered.faces,
    Math.round(options.smoothIterations),
    options.smoothStrength,
    options.preserveFeatures,
  );

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(smoothed, 3));
  const index = new Uint32Array(clustered.faces.length * 3);
  clustered.faces.forEach(([a, b, c], i) => {
    index[i * 3] = a;
    index[i * 3 + 1] = b;
    index[i * 3 + 2] = c;
  });
  out.setIndex(new THREE.BufferAttribute(index, 1));
  if (options.recomputeNormals) out.computeVertexNormals();
  out.computeBoundingBox();
  out.computeBoundingSphere();

  return {
    geometry: out,
    report: {
      beforeVertices: positions.length / 3,
      afterVertices: smoothed.length / 3,
      beforeTriangles: faces.length,
      afterTriangles: clustered.faces.length,
      mergedVertices: clustered.merged,
      droppedFaces: clustered.dropped,
      smoothedIterations: Math.round(options.smoothIterations),
    },
  };
}

export function remeshGroup(
  group: THREE.Object3D,
  partial: Partial<RemeshOptions> = {},
): { total: RemeshReport } {
  const total: RemeshReport = {
    beforeVertices: 0, afterVertices: 0, beforeTriangles: 0, afterTriangles: 0,
    mergedVertices: 0, droppedFaces: 0, smoothedIterations: 0,
  };
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const { geometry, report } = remeshGeometry(child.geometry, partial);
    child.geometry.dispose();
    child.geometry = geometry;
    total.beforeVertices += report.beforeVertices;
    total.afterVertices += report.afterVertices;
    total.beforeTriangles += report.beforeTriangles;
    total.afterTriangles += report.afterTriangles;
    total.mergedVertices += report.mergedVertices;
    total.droppedFaces += report.droppedFaces;
    total.smoothedIterations = Math.max(total.smoothedIterations, report.smoothedIterations);
  });
  return { total };
}
