export type TerraformState = {
  version?: number;
  serial?: number;
  resources?: TerraformResource[];
};

export type TerraformResource = {
  mode?: string;
  type?: string;
  name?: string;
  module?: string;
  instances?: unknown[];
};

export type ExclusionReason =
  | "mode_data"
  | "excluded_type_null_resource"
  | "excluded_type_terraform_data"
  | "invalid_or_unmanaged";

export type ResourceEvaluation = {
  address: string;
  type: string;
  mode: string;
  instanceCount: number;
  counted: boolean;
  rum: number;
  exclusionReason?: ExclusionReason;
};

export type RumResult = {
  totalRum: number;
  totalResources: number;
  countedResources: number;
  excludedResources: number;
  evaluations: ResourceEvaluation[];
};

const EXCLUDED_TYPES = new Set(["null_resource", "terraform_data"]);

function normalizeAddress(resource: TerraformResource): string {
  const modulePrefix = resource.module ? `${resource.module}.` : "";
  return `${modulePrefix}${resource.type ?? "unknown"}.${resource.name ?? "unknown"}`;
}

function getInstanceCount(resource: TerraformResource): number {
  if (!Array.isArray(resource.instances)) {
    return 0;
  }
  return resource.instances.length;
}

export function calculateRumFromState(state: TerraformState): RumResult {
  const resources = state.resources ?? [];
  const evaluations: ResourceEvaluation[] = [];

  for (const resource of resources) {
    const mode = resource.mode ?? "unknown";
    const type = resource.type ?? "unknown";
    const address = normalizeAddress(resource);
    const instanceCount = getInstanceCount(resource);

    if (mode !== "managed") {
      evaluations.push({
        address,
        type,
        mode,
        instanceCount,
        counted: false,
        rum: 0,
        exclusionReason: mode === "data" ? "mode_data" : "invalid_or_unmanaged"
      });
      continue;
    }

    if (EXCLUDED_TYPES.has(type)) {
      evaluations.push({
        address,
        type,
        mode,
        instanceCount,
        counted: false,
        rum: 0,
        exclusionReason:
          type === "null_resource"
            ? "excluded_type_null_resource"
            : "excluded_type_terraform_data"
      });
      continue;
    }

    evaluations.push({
      address,
      type,
      mode,
      instanceCount,
      counted: true,
      rum: instanceCount
    });
  }

  const totalRum = evaluations.reduce((sum, e) => sum + e.rum, 0);
  const countedResources = evaluations.filter((e) => e.counted).length;
  const excludedResources = evaluations.length - countedResources;

  return {
    totalRum,
    totalResources: evaluations.length,
    countedResources,
    excludedResources,
    evaluations
  };
}

export function parseTerraformState(raw: string): TerraformState {
  const parsed = JSON.parse(raw) as TerraformState;
  return parsed;
}

/* ---------- Module Structure Analysis ---------- */

export type ModuleEntry = {
  /** Module path, e.g. "module.env_1.module.stack_2" or "(root)" */
  path: string;
  /** Nesting depth: 0 = root, 1 = module.x, 2 = module.x.module.y, etc. */
  depth: number;
  /** Billable RUM contributed by this module */
  rum: number;
  /** Total resource blocks in this module (counted + excluded) */
  resourceCount: number;
  /** Distinct Terraform resource types in this module */
  resourceTypes: string[];
};

export type ModuleAnalysis = {
  /** Per-module breakdown sorted by RUM descending */
  modules: ModuleEntry[];
  /** Deepest nesting level found */
  maxDepth: number;
  /** Total distinct module paths (including root) */
  moduleCount: number;
};

function moduleDepth(modulePath: string | undefined): number {
  if (!modulePath) return 0;
  // Count occurrences of "module." prefix segments
  const matches = modulePath.match(/module\./g);
  return matches ? matches.length : 0;
}

/**
 * Analyze module structure from a RUM result's evaluations.
 * Pure function — no I/O or side effects.
 */
export function analyzeModuleStructure(evaluations: ResourceEvaluation[]): ModuleAnalysis {
  const moduleMap = new Map<string, { rum: number; resourceCount: number; types: Set<string> }>();

  for (const evaluation of evaluations) {
    // Extract module path from the address
    // Address format: "module.env_1.module.stack_2.aws_instance.web" or "aws_instance.web"
    const modulePath = extractModulePath(evaluation.address);

    const entry = moduleMap.get(modulePath) ?? { rum: 0, resourceCount: 0, types: new Set<string>() };
    entry.rum += evaluation.rum;
    entry.resourceCount += 1;
    entry.types.add(evaluation.type);
    moduleMap.set(modulePath, entry);
  }

  const modules: ModuleEntry[] = [];
  let maxDepth = 0;

  for (const [path, data] of moduleMap) {
    const depth = moduleDepth(path === "(root)" ? undefined : path);
    if (depth > maxDepth) maxDepth = depth;

    modules.push({
      path,
      depth,
      rum: data.rum,
      resourceCount: data.resourceCount,
      resourceTypes: [...data.types].sort()
    });
  }

  // Sort by RUM descending, then by path for stability
  modules.sort((a, b) => b.rum - a.rum || a.path.localeCompare(b.path));

  return {
    modules,
    maxDepth,
    moduleCount: modules.length
  };
}

/**
 * Extract the module path portion from a resource address.
 * "module.env_1.module.stack_2.aws_instance.web" → "module.env_1.module.stack_2"
 * "aws_instance.web" → "(root)"
 */
function extractModulePath(address: string): string {
  // Find the last "module.xxx." segment, then everything after is "type.name"
  // We split on segments: module paths consist of "module.<name>" pairs
  const parts = address.split(".");
  const moduleSegments: string[] = [];
  let i = 0;

  while (i < parts.length - 2) {
    // Need at least 2 remaining parts for "type.name"
    if (parts[i] === "module" && i + 1 < parts.length) {
      moduleSegments.push("module", parts[i + 1]);
      i += 2;
    } else {
      break;
    }
  }

  return moduleSegments.length > 0 ? moduleSegments.join(".") : "(root)";
}
