export type ScanPayload = {
  providers: Array<"aws" | "azure" | "gcp" | "local">;
  targets: Array<{
    provider: "aws" | "azure" | "gcp" | "local";
    bucketName?: string;
    storageAccountName?: string;
    containerName?: string;
    directoryPath?: string;
    recursive?: boolean;
    patterns?: string[];
    prefix?: string;
  }>;
  options?: { dryRun?: boolean; concurrency?: number; maxObjects?: number };
  executionEnv?: {
    awsRegion?: string;
    awsProfile?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsSessionToken?: string;
    azureSubscriptionId?: string;
    azureTenantId?: string;
    gcpProjectId?: string;
    googleApplicationCredentials?: string;
  };
};

export type EstimatorRunStatus = "queued" | "running" | "completed" | "failed";
export type EstimatorProvider = "aws" | "azure" | "gcp";

export type EstimatorRunRecord = {
  id: string;
  provider: EstimatorProvider;
  status: EstimatorRunStatus;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  mapping?: {
    provider: EstimatorProvider;
    mappingVersion: string;
    updatedAt: string;
    source?: string;
    providerVersionConstraint?: string;
    providerVersionResolved?: string;
    totalMappings: number;
    staleThresholdDays: number;
    ageDays: number;
    isStale: boolean;
  };
  summary?: {
    discoveredResources: number;
    rumCandidates: number;
    nonManageable: number;
    unmapped: number;
  };
  diagnostics?: {
    mappedResources: number;
    coveragePct: number;
    permissionDenied: number;
    topMissingPermissions: Array<{
      permission: string;
      count: number;
    }>;
    topUnmappedPrefixes: Array<{
      key: string;
      count: number;
      sampleResourceId: string;
    }>;
  };
};

export type EstimatorMappingMetadata = NonNullable<EstimatorRunRecord["mapping"]>;
export type EstimatorCategory = "candidates" | "non-manageable" | "unmapped";
export type EstimatorResourceRow = {
  resourceId: string;
  service: string;
  resourceType: string;
  region?: string;
  classification: "rum_candidate" | "excluded" | "not_manageable" | "unmapped";
  reasonCode: "MAPPED_MANAGEABLE" | "MAPPED_EXCLUDED" | "NOT_SUPPORTED_BY_PROVIDER" | "UNMAPPED_TYPE" | "PERMISSION_DENIED";
  reasonDetail?: string;
  terraformResourceType?: string;
};
export type EstimatorCategoryResponse = {
  runId: string;
  category: EstimatorCategory;
  total: number;
  rows: EstimatorResourceRow[];
};
export type EstimatorDiagnosticsResponse = {
  runId: string;
  diagnostics: {
    mappedResources: number;
    coveragePct: number;
    permissionDenied: number;
    topMissingPermissions: Array<{
      permission: string;
      count: number;
    }>;
    topUnmappedPrefixes: Array<{
      key: string;
      count: number;
      sampleResourceId: string;
    }>;
  };
};
export type EstimatorIamRemediationResponse = {
  runId: string;
  missingPermissions: Array<{ permission: string; count: number }>;
  suggestedActions: string[];
  policy: {
    Version: string;
    Statement: Array<{
      Sid: string;
      Effect: string;
      Action: string[];
      Resource: string;
    }>;
  };
};

export type ScanStatus = "queued" | "running" | "completed" | "failed";

export type ScanRecord = {
  id: string;
  status: ScanStatus;
  createdAt?: string;
  updatedAt?: string;
  errorMessage?: string;
  summary?: {
    bucketsScanned: number;
    stateFilesParsed: number;
    totalRum: number;
    excludedResources: number;
    parseErrors?: number;
  };
};

export type ManagedResourceFinding = {
  id: string;
  provider: "aws" | "azure" | "gcp" | "local";
  targetName: string;
  stateFile: string;
  resourceAddress: string;
  resourceType: string;
  mode: string;
  instanceCount: number;
  candidateStatus: "included" | "excluded";
  rumCount: number;
  ruleCode:
    | "INCLUDED_MANAGED_RESOURCE"
    | "EXCLUDED_DATA_SOURCE"
    | "EXCLUDED_NULL_RESOURCE"
    | "EXCLUDED_TERRAFORM_DATA"
    | "EXCLUDED_INVALID_OR_UNMANAGED";
  ruleReason: string;
};

export type ManagedScanResourcesResponse = {
  scanId: string;
  total: number;
  status: "all" | "included" | "excluded";
  rows: ManagedResourceFinding[];
};

const API_BASE = import.meta.env.VITE_API_BASE ?? "http://localhost:8080";

export async function startScan(payload: ScanPayload) {
  const response = await fetch(`${API_BASE}/scans`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Unable to start scan");
  }
  return response.json();
}

export async function getScan(scanId: string): Promise<ScanRecord> {
  const response = await fetch(`${API_BASE}/scans/${scanId}`);
  if (!response.ok) {
    throw new Error(`Unable to fetch scan ${scanId}`);
  }
  return response.json();
}

export async function getSummary() {
  const response = await fetch(`${API_BASE}/metrics/summary`);
  return response.json();
}

export async function getCumulativeSummary() {
  const response = await fetch(`${API_BASE}/metrics/cumulative`);
  return response.json();
}

export async function getByBucket() {
  const response = await fetch(`${API_BASE}/metrics/by-bucket`);
  return response.json();
}

export async function getByBucketCumulative() {
  const response = await fetch(`${API_BASE}/metrics/by-bucket-cumulative`);
  return response.json();
}

export async function listScans() {
  const response = await fetch(`${API_BASE}/scans`);
  return response.json();
}

export async function getManagedScanResources(
  scanId: string,
  status: "all" | "included" | "excluded" = "all"
): Promise<ManagedScanResourcesResponse> {
  const response = await fetch(`${API_BASE}/scans/${scanId}/resources?status=${status}`);
  if (!response.ok) {
    throw new Error(`Unable to fetch managed scan resources for scan ${scanId}`);
  }
  return response.json();
}

export function getManagedScanResourcesExportUrl(
  scanId: string,
  status: "all" | "included" | "excluded",
  format: "json" | "csv"
): string {
  return `${API_BASE}/scans/${scanId}/resources?status=${status}&format=${format}`;
}

export async function terminalExec(command: string) {
  const response = await fetch(`${API_BASE}/terminal/exec`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command })
  });
  return response.json();
}

export async function startAwsEstimatorRun(payload: {
  scope: { regions?: string[]; tagFilters?: Array<{ key: string; values?: string[] }> };
  executionEnv?: {
    awsRegion?: string;
    awsProfile?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsSessionToken?: string;
  };
}) {
  const response = await fetch(`${API_BASE}/estimator/aws/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Unable to start AWS estimator run");
  }
  return response.json();
}

export async function startAzureEstimatorRun(payload: {
  scope: { subscriptionId?: string; resourceGroup?: string };
  executionEnv?: { azureSubscriptionId?: string; azureTenantId?: string };
}) {
  const response = await fetch(`${API_BASE}/estimator/azure/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Unable to start Azure estimator run");
  }
  return response.json();
}

export async function startGcpEstimatorRun(payload: {
  scope: { projectId: string };
  executionEnv?: { gcpProjectId?: string; googleApplicationCredentials?: string };
}) {
  const response = await fetch(`${API_BASE}/estimator/gcp/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    throw new Error("Unable to start GCP estimator run");
  }
  return response.json();
}

export async function listEstimatorRuns() {
  const response = await fetch(`${API_BASE}/estimator/runs`);
  return response.json();
}

export async function getEstimatorRun(runId: string): Promise<EstimatorRunRecord> {
  const response = await fetch(`${API_BASE}/estimator/runs/${runId}`);
  if (!response.ok) {
    throw new Error(`Unable to fetch estimator run ${runId}`);
  }
  return response.json();
}

export async function getAwsEstimatorMappingMetadata(): Promise<EstimatorMappingMetadata> {
  const response = await fetch(`${API_BASE}/estimator/mapping/aws`);
  if (!response.ok) {
    throw new Error("Unable to fetch estimator mapping metadata");
  }
  return response.json();
}

export async function getEstimatorMappingMetadata(provider: EstimatorProvider): Promise<EstimatorMappingMetadata> {
  const response = await fetch(`${API_BASE}/estimator/mapping/${provider}`);
  if (!response.ok) {
    throw new Error(`Unable to fetch ${provider} estimator mapping metadata`);
  }
  return response.json();
}

export async function getEstimatorCategoryRows(
  runId: string,
  category: EstimatorCategory
): Promise<EstimatorCategoryResponse> {
  const response = await fetch(`${API_BASE}/estimator/runs/${runId}/${category}`);
  if (!response.ok) {
    throw new Error(`Unable to fetch estimator ${category} for run ${runId}`);
  }
  return response.json();
}

export function getEstimatorCategoryExportUrl(
  runId: string,
  category: EstimatorCategory,
  format: "json" | "csv"
): string {
  return `${API_BASE}/estimator/runs/${runId}/${category}?format=${format}`;
}

export async function getEstimatorRunDiagnostics(runId: string): Promise<EstimatorDiagnosticsResponse> {
  const response = await fetch(`${API_BASE}/estimator/runs/${runId}/diagnostics`);
  if (!response.ok) {
    throw new Error(`Unable to fetch estimator diagnostics for run ${runId}`);
  }
  return response.json();
}

export async function getEstimatorIamRemediation(runId: string): Promise<EstimatorIamRemediationResponse> {
  const response = await fetch(`${API_BASE}/estimator/runs/${runId}/iam-remediation`);
  if (!response.ok) {
    throw new Error(`Unable to fetch IAM remediation for run ${runId}`);
  }
  return response.json();
}

export function getEstimatorIamRemediationPolicyExportUrl(runId: string): string {
  return `${API_BASE}/estimator/runs/${runId}/iam-remediation?format=policy`;
}

/* ------------------------------------------------------------------ */
/*  TFE Migration Estimator                                           */
/* ------------------------------------------------------------------ */

export type TfeMigrationStatus = "queued" | "running" | "completed" | "failed";

export type TfeProject = {
  id: string;
  name: string;
  description: string;
  workspaceCount: number;
};

export type TfeModuleEntry = {
  path: string;
  depth: number;
  rum: number;
  resourceCount: number;
  resourceTypes: string[];
};

export type TfeWorkspaceResult = {
  workspaceId: string;
  workspaceName: string;
  projectName?: string;
  stateVersionId?: string;
  rum: number;
  countedResources: number;
  excludedResources: number;
  totalResources: number;
  parseError?: string;
  modules?: TfeModuleEntry[];
  maxModuleDepth?: number;
};

export type TfeProjectSummary = {
  projectId: string;
  projectName: string;
  workspaceCount: number;
  rum: number;
  countedResources: number;
  excludedResources: number;
};

export type TfeMigrationSummary = {
  totalWorkspaces: number;
  workspacesWithState: number;
  workspacesScanned: number;
  totalRum: number;
  totalCountedResources: number;
  totalExcludedResources: number;
  parseErrors: number;
};

export type TfeModuleSummary = {
  modules: TfeModuleEntry[];
  maxDepth: number;
  totalModules: number;
};

export type TfeMigrationRecord = {
  id: string;
  status: TfeMigrationStatus;
  createdAt: string;
  updatedAt: string;
  errorMessage?: string;
  progress?: {
    phase: "connecting" | "listing_workspaces" | "downloading_states" | "calculating";
    workspacesFound?: number;
    workspacesProcessed?: number;
  };
  summary?: TfeMigrationSummary;
  byProject?: TfeProjectSummary[];
  byModule?: TfeModuleSummary;
  workspaces?: TfeWorkspaceResult[];
};

export async function listTfeProjects(payload: {
  tfeHostname: string;
  tfeToken: string;
  organization: string;
  tlsInsecure?: boolean;
}): Promise<TfeProject[]> {
  const response = await fetch(`${API_BASE}/tfe/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "Unable to list TFE projects");
  }
  const data = await response.json();
  return data.projects;
}

export async function startTfeMigrationRun(payload: {
  tfeHostname: string;
  tfeToken: string;
  organization: string;
  scopeLevel?: "organization" | "project";
  projectId?: string;
  projectName?: string;
  workspaceFilter?: string;
  tlsInsecure?: boolean;
  concurrency?: number;
}): Promise<TfeMigrationRecord> {
  const response = await fetch(`${API_BASE}/tfe/migration/runs`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? "Unable to start TFE migration run");
  }
  return response.json();
}

export async function getTfeMigrationRun(runId: string): Promise<TfeMigrationRecord> {
  const response = await fetch(`${API_BASE}/tfe/migration/runs/${runId}`);
  if (!response.ok) {
    throw new Error(`Unable to fetch TFE migration run ${runId}`);
  }
  return response.json();
}

export async function listTfeMigrationRuns(): Promise<{ runs: TfeMigrationRecord[] }> {
  const response = await fetch(`${API_BASE}/tfe/migration/runs`);
  return response.json();
}

export async function getTfeMigrationWorkspaces(
  runId: string
): Promise<{ runId: string; total: number; workspaces: TfeWorkspaceResult[] }> {
  const response = await fetch(`${API_BASE}/tfe/migration/runs/${runId}/workspaces`);
  if (!response.ok) {
    throw new Error(`Unable to fetch TFE migration workspaces for run ${runId}`);
  }
  return response.json();
}

export function getTfeMigrationExportUrl(runId: string, format: "json" | "csv"): string {
  return `${API_BASE}/tfe/migration/runs/${runId}/export?format=${format}`;
}

/* ------------------------------------------------------------------ */
/*  Combined RUM Summary                                               */
/* ------------------------------------------------------------------ */

export type CombinedSourceManaged = {
  scanId: string;
  completedAt: string;
  billableRum: number;
  nonBillable: number;
  totalResources: number;
  stateFiles: number;
};

export type CombinedSourceUnmanaged = {
  runId: string;
  completedAt: string;
  provider: string;
  billableRum: number;
  nonBillable: number;
  totalResources: number;
};

export type CombinedSourceTfeMigration = {
  runId: string;
  completedAt: string;
  billableRum: number;
  nonBillable: number;
  totalResources: number;
  workspaces: number;
};

export type CombinedRumSummary = {
  totalBillableRum: number;
  totalNonBillable: number;
  totalResources: number;
  activeSources: number;
  sources: {
    managed?: CombinedSourceManaged;
    unmanaged?: CombinedSourceUnmanaged;
    tfeMigration?: CombinedSourceTfeMigration;
  };
};

export async function getCombinedRumSummary(): Promise<CombinedRumSummary> {
  const response = await fetch(`${API_BASE}/metrics/combined-summary`);
  if (!response.ok) {
    throw new Error("Unable to fetch combined RUM summary");
  }
  return response.json();
}
