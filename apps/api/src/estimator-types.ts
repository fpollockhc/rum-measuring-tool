export type EstimatorRunStatus = "queued" | "running" | "completed" | "failed";
export type EstimatorProvider = "aws" | "azure" | "gcp";

export type AwsEstimatorRequest = {
  scope: {
    regions?: string[];
    tagFilters?: Array<{ key: string; values?: string[] }>;
  };
  executionEnv?: {
    awsRegion?: string;
    awsProfile?: string;
    awsAccessKeyId?: string;
    awsSecretAccessKey?: string;
    awsSessionToken?: string;
  };
};

export type AzureEstimatorRequest = {
  scope: {
    subscriptionId?: string;
    resourceGroup?: string;
  };
  executionEnv?: {
    azureSubscriptionId?: string;
    azureTenantId?: string;
  };
};

export type GcpEstimatorRequest = {
  scope: {
    projectId: string;
  };
  executionEnv?: {
    gcpProjectId?: string;
    googleApplicationCredentials?: string;
  };
};

export type EstimatorResourceRow = {
  resourceId: string;
  service: string;
  resourceType: string;
  region?: string;
  classification: "rum_candidate" | "excluded" | "not_manageable" | "unmapped";
  reasonCode:
    | "MAPPED_MANAGEABLE"
    | "MAPPED_EXCLUDED"
    | "NOT_SUPPORTED_BY_PROVIDER"
    | "UNMAPPED_TYPE"
    | "PERMISSION_DENIED";
  reasonDetail?: string;
  terraformResourceType?: string;
};

export type EstimatorMappingMetadata = {
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

export type EstimatorRunDiagnostics = {
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

export type EstimatorRunRecord = {
  id: string;
  provider: EstimatorProvider;
  status: EstimatorRunStatus;
  createdAt: string;
  updatedAt: string;
  request: AwsEstimatorRequest | AzureEstimatorRequest | GcpEstimatorRequest;
  errorMessage?: string;
  summary?: {
    discoveredResources: number;
    rumCandidates: number;
    nonManageable: number;
    unmapped: number;
  };
  diagnostics?: EstimatorRunDiagnostics;
  mapping?: EstimatorMappingMetadata;
  resources?: EstimatorResourceRow[];
};
