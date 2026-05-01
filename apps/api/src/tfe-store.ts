import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { TfeMigrationRecord, TfeMigrationRequest } from "./tfe-types.js";
import { atomicWriteFileSync } from "./atomic-write.js";
import { logger } from "./logger.js";

const migrations = new Map<string, TfeMigrationRecord>();
const STORE_PATH = join(process.cwd(), "data", "tfe-migrations.json");

type PersistedTfeStore = {
  version: number;
  migrations: TfeMigrationRecord[];
};

function persistMigrations(): void {
  const payload: PersistedTfeStore = {
    version: 1,
    migrations: [...migrations.values()]
  };
  atomicWriteFileSync(STORE_PATH, JSON.stringify(payload, null, 2));
}

function loadMigrationsFromDisk(): void {
  if (!existsSync(STORE_PATH)) return;
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as PersistedTfeStore;
    for (const migration of parsed.migrations ?? []) {
      migrations.set(migration.id, migration);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: message, path: STORE_PATH }, "Failed to load TFE migrations");
  }
}

loadMigrationsFromDisk();

export function redactTfeRequest(
  request: TfeMigrationRequest
): Omit<TfeMigrationRequest, "tfeToken"> & { tfeToken: string } {
  return {
    ...request,
    tfeToken: request.tfeToken ? "***redacted***" : ""
  };
}

export function createTfeMigration(
  request: TfeMigrationRequest
): TfeMigrationRecord {
  const now = new Date().toISOString();
  const id = randomUUID();
  const record: TfeMigrationRecord = {
    id,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    request: redactTfeRequest(request)
  };
  migrations.set(id, record);
  persistMigrations();
  return record;
}

export function updateTfeMigration(
  id: string,
  updater: (current: TfeMigrationRecord) => TfeMigrationRecord
): TfeMigrationRecord | null {
  const existing = migrations.get(id);
  if (!existing) return null;
  const updated = updater(existing);
  migrations.set(id, { ...updated, updatedAt: new Date().toISOString() });
  persistMigrations();
  return migrations.get(id) ?? null;
}

export function getTfeMigration(id: string): TfeMigrationRecord | null {
  return migrations.get(id) ?? null;
}

export function listTfeMigrations(): TfeMigrationRecord[] {
  return [...migrations.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
