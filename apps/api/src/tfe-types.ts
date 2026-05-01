export type TfeMigrationStatus = "queued" | "running" | "completed" | "failed";

export type TfeScopeLevel = "organization" | "project";

export type TfeMigrationRequest = {
  tfeHostname: string;
  tfeToken: string;
  organization: string;
  scopeLevel?: TfeScopeLevel;
  projectId?: string;
  projectName?: string;
  workspaceFilter?: string;
  tlsInsecure?: boolean;
  concurrency?: number;
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
  /** Aggregated module breakdown across all workspaces */
  modules: TfeModuleEntry[];
  /** Deepest nesting level across all workspaces */
  maxDepth: number;
  /** Total distinct module paths across all workspaces */
  totalModules: number;
};

export type TfeMigrationRecord = {
  id: string;
  status: TfeMigrationStatus;
  createdAt: string;
  updatedAt: string;
  request: Omit<TfeMigrationRequest, "tfeToken"> & { tfeToken: string };
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
