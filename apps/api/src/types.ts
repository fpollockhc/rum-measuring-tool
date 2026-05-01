export type ScanStatus = "queued" | "running" | "completed" | "failed";

export type ScanRequest = {
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
  options?: {
    dryRun?: boolean;
    maxObjects?: number;
    concurrency?: number;
  };
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

export type ScanRecord = {
  id: string;
  status: ScanStatus;
  createdAt: string;
  updatedAt: string;
  request: ScanRequest;
  errorMessage?: string;
  summary?: {
    bucketsScanned: number;
    stateFilesParsed: number;
    totalRum: number;
    excludedResources: number;
    parseErrors?: number;
  };
  byBucket?: Array<{
    bucketName: string;
    provider: string;
    rum: number;
    stateFiles: number;
    excludedResources?: number;
    parseErrors?: number;
  }>;
  managedResources?: ManagedResourceFinding[];
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
