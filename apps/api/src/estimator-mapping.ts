import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { EstimatorMappingMetadata, EstimatorProvider } from "./estimator-types.js";
import { getWorkspaceRoot } from "./workspace-root.js";

export type MappingEntry = {
  matchPrefix: string;
  terraformType: string;
  rumEligible: boolean;
};

type MappingFileV2 = {
  mappingVersion: string;
  updatedAt: string;
  source?: string;
  providerVersionConstraint?: string;
  providerVersionResolved?: string;
  mappings: MappingEntry[];
};

function getStaleThresholdDays(): number {
  const raw = process.env.ESTIMATOR_MAPPING_STALE_DAYS;
  const value = raw ? Number(raw) : 30;
  return Number.isFinite(value) && value > 0 ? value : 30;
}

function calculateAgeDays(updatedAt: string): number {
  const updated = new Date(updatedAt).getTime();
  if (Number.isNaN(updated)) return 9999;
  const ageMs = Date.now() - updated;
  return Math.max(0, Math.floor(ageMs / (1000 * 60 * 60 * 24)));
}

const MAPPING_FILE_BY_PROVIDER: Record<EstimatorProvider, string> = {
  aws: "aws_resource_to_tf.json",
  azure: "azure_resource_to_tf.json",
  gcp: "gcp_resource_to_tf.json"
};

export async function loadMapping(provider: EstimatorProvider): Promise<{ entries: MappingEntry[]; metadata: EstimatorMappingMetadata }> {
  const workspaceRoot = getWorkspaceRoot();
  const filePath = join(workspaceRoot, "data", "mappings", MAPPING_FILE_BY_PROVIDER[provider]);
  const raw = await readFile(filePath, "utf-8");
  const parsed = JSON.parse(raw) as MappingFileV2 | MappingEntry[];

  let entries: MappingEntry[];
  let mappingVersion = "legacy";
  let updatedAt = "1970-01-01T00:00:00.000Z";
  let source: string | undefined;
  let providerVersionConstraint: string | undefined;
  let providerVersionResolved: string | undefined;

  if (Array.isArray(parsed)) {
    entries = parsed;
  } else {
    entries = parsed.mappings ?? [];
    mappingVersion = parsed.mappingVersion;
    updatedAt = parsed.updatedAt;
    source = parsed.source;
    providerVersionConstraint = parsed.providerVersionConstraint;
    providerVersionResolved = parsed.providerVersionResolved;
  }

  const staleThresholdDays = getStaleThresholdDays();
  const ageDays = calculateAgeDays(updatedAt);
  const metadata: EstimatorMappingMetadata = {
    provider,
    mappingVersion,
    updatedAt,
    source,
    providerVersionConstraint,
    providerVersionResolved,
    totalMappings: entries.length,
    staleThresholdDays,
    ageDays,
    isStale: ageDays > staleThresholdDays
  };

  return { entries, metadata };
}

export async function loadAwsMapping(): Promise<{ entries: MappingEntry[]; metadata: EstimatorMappingMetadata }> {
  return loadMapping("aws");
}
