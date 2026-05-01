import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AwsEstimatorRequest, AzureEstimatorRequest, EstimatorProvider, EstimatorRunRecord, GcpEstimatorRequest } from "./estimator-types.js";
import { atomicWriteFileSync } from "./atomic-write.js";
import { logger } from "./logger.js";

const runs = new Map<string, EstimatorRunRecord>();
const STORE_PATH = join(process.cwd(), "data", "estimator-runs.json");

type PersistedEstimatorStore = {
  version: number;
  runs: EstimatorRunRecord[];
};

function persistRuns(): void {
  const payload: PersistedEstimatorStore = {
    version: 1,
    runs: [...runs.values()]
  };
  atomicWriteFileSync(STORE_PATH, JSON.stringify(payload, null, 2));
}

function loadRunsFromDisk(): void {
  if (!existsSync(STORE_PATH)) return;
  try {
    const raw = readFileSync(STORE_PATH, "utf-8");
    const parsed = JSON.parse(raw) as PersistedEstimatorStore;
    for (const run of parsed.runs ?? []) {
      runs.set(run.id, run);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ err: message, path: STORE_PATH }, "Failed to load estimator runs");
  }
}

loadRunsFromDisk();

export function createEstimatorRun(
  provider: EstimatorProvider,
  request: AwsEstimatorRequest | AzureEstimatorRequest | GcpEstimatorRequest
): EstimatorRunRecord {
  const now = new Date().toISOString();
  const id = randomUUID();
  const run: EstimatorRunRecord = {
    id,
    provider,
    status: "queued",
    createdAt: now,
    updatedAt: now,
    request
  };
  runs.set(id, run);
  persistRuns();
  return run;
}

export function updateEstimatorRun(
  id: string,
  updater: (current: EstimatorRunRecord) => EstimatorRunRecord
): EstimatorRunRecord | null {
  const existing = runs.get(id);
  if (!existing) return null;
  const updated = updater(existing);
  runs.set(id, { ...updated, updatedAt: new Date().toISOString() });
  persistRuns();
  return runs.get(id) ?? null;
}

export function getEstimatorRun(id: string): EstimatorRunRecord | null {
  return runs.get(id) ?? null;
}

export function listEstimatorRuns(): EstimatorRunRecord[] {
  return [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
