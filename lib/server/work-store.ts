import { promises as fs } from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/**
 * Minimal document store for the optional self-hosted backend.
 *
 * Works are stored as one JSON file per document under the data directory, so
 * the desktop build and a plain `next start` deployment behave identically and
 * no external database is required.
 */

export interface StoredWorkMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  bytes: number;
}

export interface StoredWork extends StoredWorkMeta {
  document: unknown;
}

function dataDir(): string {
  return process.env.AURUM_DATA_DIR || path.join(process.cwd(), ".aurum-data");
}

async function ensureDir(): Promise<string> {
  const dir = path.join(dataDir(), "works");
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

function safeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
}

export function newWorkId(): string {
  return `w_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export async function listWorks(): Promise<StoredWorkMeta[]> {
  const dir = await ensureDir();
  const entries = await fs.readdir(dir).catch(() => [] as string[]);
  const metas: StoredWorkMeta[] = [];

  for (const entry of entries) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = await fs.readFile(path.join(dir, entry), "utf-8");
      const parsed = JSON.parse(raw) as StoredWork;
      metas.push({
        id: parsed.id,
        title: parsed.title,
        createdAt: parsed.createdAt,
        updatedAt: parsed.updatedAt,
        bytes: raw.length,
      });
    } catch {
      // Corrupted file: skip rather than fail the whole listing.
    }
  }
  return metas.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
}

export async function readWork(id: string): Promise<StoredWork | null> {
  const dir = await ensureDir();
  try {
    const raw = await fs.readFile(path.join(dir, `${safeId(id)}.json`), "utf-8");
    return JSON.parse(raw) as StoredWork;
  } catch {
    return null;
  }
}

export async function writeWork(input: {
  id?: string;
  title?: string;
  document: unknown;
}): Promise<StoredWork> {
  const dir = await ensureDir();
  const id = input.id ? safeId(input.id) : newWorkId();
  const existing = await readWork(id);
  const now = new Date().toISOString();
  const record: StoredWork = {
    id,
    title: input.title || existing?.title || "未命名作品",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    bytes: 0,
    document: input.document,
  };
  const payload = JSON.stringify(record);
  record.bytes = payload.length;
  await fs.writeFile(path.join(dir, `${id}.json`), JSON.stringify(record), "utf-8");
  return record;
}

export async function deleteWork(id: string): Promise<boolean> {
  const dir = await ensureDir();
  try {
    await fs.unlink(path.join(dir, `${safeId(id)}.json`));
    return true;
  } catch {
    return false;
  }
}
