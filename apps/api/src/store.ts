import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ScanRecord, ScanRequest } from "./types.js";
import { atomicWriteFileSync } from "./atomic-write.js";
import { logger } from "./logger.js";

const scans = new Map<string, ScanRecord>();
const STORE_PATH = join(process.cwd(), "data", "scans.json");

type PersistedStore = {
  version: number;
  scans: ScanRecord[];
};

function persistScans(): void {
  const payload: PersistedStore = {
    version: 1,
    scans: [...scans.values()]
  };
  atomicWriteFileSync(STORE_PATH, JSON.stringify(payload, null, 2));
}

function loadScansFromDisk(): void {
  if (!existsSync(STORE_PATH)) return;
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as PersistedStore;
    for (const scan of parsed.scans ?? []) {
      scans.set(scan.id, scan);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: message, path: STORE_PATH }, "Failed to load persisted scans");
  }
}

loadScansFromDisk();

export function createScan(request: ScanRequest): ScanRecord {
  const now = new Date().toISOString();
  const id = randomUUID();
  const record: ScanRecord = {
    id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    request
  };
  scans.set(id, record);
  persistScans();
  return record;
}

export function updateScan(id: string, updater: (current: ScanRecord) => ScanRecord): ScanRecord | null {
  const existing = scans.get(id);
  if (!existing) return null;
  const next = updater(existing);
  scans.set(id, { ...next, updatedAt: new Date().toISOString() });
  persistScans();
  return scans.get(id) ?? null;
}

export function getScan(id: string): ScanRecord | null {
  return scans.get(id) ?? null;
}

export function listScans(): ScanRecord[] {
  return [...scans.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
