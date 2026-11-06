"use client";

import * as THREE from "three";

/**
 * Normal reconstruction.
 *
 * Three modes:
 *  - smooth : single averaged normal per vertex (soft surface)
 *  - flat   : one normal per face (crisp machined look)
 *  - angle  : split vertices into smoothing groups by dihedral angle, so hard
 *             edges survive while curved regions stay smooth
 */

export type NormalMode = "smooth" | "flat" | "angle";

export interface NormalOptions {
  mode: NormalMode;
  /** Dihedral threshold in degrees, only used by the "angle" mode. */
  angleThreshold: number;
  /** Flip all normals (useful when a shell came out inside-out). */
  flip: boolean;
}

export const DEFAULT_NORMAL_OPTIONS: NormalOptions = {
  mode: "angle",
  angleThreshold: 35,
  flip: false,
};

export interface NormalReport {
  mode: NormalMode;
  inputVertices: number;
  outputVertices: number;
  hardEdges: number;
  triangles: number;
}

function positionsOf(geometry: THREE.BufferGeometry): number[] {
  const attr = geometry.getAttribute("position") as THREE.BufferAttribute;
  const index = geometry.getIndex();
  const out: number[] = [];
  if (index) {
    for (let i = 0; i < index.count; i += 1) {
      const vi = index.getX(i);
      out.push(attr.getX(vi), attr.getY(vi), attr.getZ(vi));
    }
  } else {
    for (let i = 0; i < attr.count; i += 1) {
      out.push(attr.getX(i), attr.getY(i), attr.getZ(i));
    }
  }
  return out;
}

function faceNormal(p: number[], i: number): [number, number, number] {
  const o = i * 9;
  const ax = p[o], ay = p[o + 1], az = p[o + 2];
  const bx = p[o + 3], by = p[o + 4], bz = p[o + 5];
  const cx = p[o + 6], cy = p[o + 7], cz = p[o + 8];
  const ux = bx - ax, uy = by - ay, uz = bz - az;
  const vx = cx - ax, vy = cy - ay, vz = cz - az;
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  return [nx, ny, nz];
}

const angleBetween = (a: number[], b: number[]): number =>
  (Math.acos(Math.max(-1, Math.min(1, a[0] * b[0] + a[1] * b[1] + a[2] * b[2]))) * 180) / Math.PI;

export function reconstructNormals(
  geometry: THREE.BufferGeometry,
  partial: Partial<NormalOptions> = {},
): { geometry: THREE.BufferGeometry; report: NormalReport } {
  const options = { ...DEFAULT_NORMAL_OPTIONS, ...partial };
  const p = positionsOf(geometry);
  const triangles = p.length / 9;
  const report: NormalReport = {
    mode: options.mode,
    inputVertices: geometry.getAttribute("position").count,
    outputVertices: 0,
    hardEdges: 0,
    triangles,
  };

  const outPositions: number[] = [];
  const outNormals: number[] = [];

  if (options.mode === "smooth") {
    for (let i = 0; i < p.length; i += 1) outPositions.push(p[i]);
    const tmp = new THREE.BufferGeometry();
    tmp.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    tmp.computeVertexNormals();
    const n = tmp.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < n.count; i += 1) {
      const s = options.flip ? -1 : 1;
      outNormals.push(n.getX(i) * s, n.getY(i) * s, n.getZ(i) * s);
    }
    tmp.dispose();
  } else if (options.mode === "flat") {
    for (let f = 0; f < triangles; f += 1) {
      const [nx, ny, nz] = faceNormal(p, f);
      const s = options.flip ? -1 : 1;
      for (let v = 0; v < 3; v += 1) {
        const o = f * 9 + v * 3;
        outPositions.push(p[o], p[o + 1], p[o + 2]);
        outNormals.push(nx * s, ny * s, nz * s);
      }
    }
  } else {
    // Angle mode: group incident faces per vertex by dihedral angle.
    const keyOf = (x: number, y: number, z: number) =>
      `${Math.round(x * 1e5)}|${Math.round(y * 1e5)}|${Math.round(z * 1e5)}`;
    const incident = new Map<string, number[]>();
    for (let f = 0; f < triangles; f += 1) {
      for (let v = 0; v < 3; v += 1) {
        const o = f * 9 + v * 3;
        const k = keyOf(p[o], p[o + 1], p[o + 2]);
        const list = incident.get(k);
        if (list) list.push(f);
        else incident.set(k, [f]);
      }
    }

    const threshold = Math.max(1, Math.min(179, options.angleThreshold));
    for (let f = 0; f < triangles; f += 1) {
      for (let v = 0; v < 3; v += 1) {
        const o = f * 9 + v * 3;
        const x = p[o], y = p[o + 1], z = p[o + 2];
        const faces = incident.get(keyOf(x, y, z)) ?? [f];
        const own = faceNormal(p, f);
        const group: number[][] = [];
        for (const other of faces) {
          const fn = faceNormal(p, other);
          const bucket = group.find((g) => angleBetween(g, fn) <= threshold);
          if (bucket) {
            bucket[0] += fn[0];
            bucket[1] += fn[1];
            bucket[2] += fn[2];
          } else {
            group.push([fn[0], fn[1], fn[2]]);
          }
        }
        if (group.length > 1) report.hardEdges += 1;
        const bucket = group.find((g) => angleBetween(g, own) <= threshold) ?? group[0];
        const len = Math.hypot(bucket[0], bucket[1], bucket[2]) || 1;
        const s = options.flip ? -1 : 1;
        outPositions.push(x, y, z);
        outNormals.push((bucket[0] / len) * s, (bucket[1] / len) * s, (bucket[2] / len) * s);
      }
    }
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(outPositions, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(outNormals, 3));
  out.computeBoundingBox();
  out.computeBoundingSphere();
  report.outputVertices = outPositions.length / 3;
  return { geometry: out, report };
}

export function reconstructNormalsInGroup(
  group: THREE.Object3D,
  partial: Partial<NormalOptions> = {},
): { report: NormalReport } {
  const total: NormalReport = {
    mode: partial.mode ?? DEFAULT_NORMAL_OPTIONS.mode,
    inputVertices: 0,
    outputVertices: 0,
    hardEdges: 0,
    triangles: 0,
  };
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const { geometry, report } = reconstructNormals(child.geometry, partial);
    child.geometry.dispose();
    child.geometry = geometry;
    total.inputVertices += report.inputVertices;
    total.outputVertices += report.outputVertices;
    total.hardEdges += report.hardEdges;
    total.triangles += report.triangles;
  });
  return { report: total };
}
