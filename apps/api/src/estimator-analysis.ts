import type { EstimatorProvider, EstimatorResourceRow, EstimatorRunDiagnostics } from "./estimator-types.js";
import type { MappingEntry } from "./estimator-mapping.js";

function parseAwsArn(resourceId: string): { service: string; region?: string; resourceType: string } {
  const arnParts = resourceId.split(":");
  return {
    service: arnParts[2] ?? "unknown",
    region: arnParts[3] || undefined,
    resourceType: arnParts[5] ?? "unknown"
  };
}

function parseAzureResourceId(resourceId: string): { service: string; region?: string; resourceType: string } {
  const parts = resourceId.split("/").filter(Boolean);
  const providerIndex = parts.findIndex((part) => part.toLowerCase() === "providers");
  if (providerIndex >= 0 && parts[providerIndex + 1]) {
    const providerNs = parts[providerIndex + 1];
    const type = parts[providerIndex + 2] ?? "unknown";
    return { service: providerNs.toLowerCase(), resourceType: type };
  }
  return { service: "azure", resourceType: "unknown" };
}

function parseGcpResourceName(resourceId: string): { service: string; region?: string; resourceType: string } {
  const normalized = resourceId.replace(/^\/\//, "");
  const [host, ...rest] = normalized.split("/");
  const service = host.split(".")[0] || "gcp";
  const resourceType = rest[0] ?? "unknown";
  return { service, resourceType };
}

export function parseResourceIdentity(
  provider: EstimatorProvider,
  resourceId: string
): { service: string; region?: string; resourceType: string } {
  if (provider === "aws") return parseAwsArn(resourceId);
  if (provider === "azure") return parseAzureResourceId(resourceId);
  return parseGcpResourceName(resourceId);
}

function findMapping(resourceId: string, mapping: MappingEntry[]): MappingEntry | undefined {
  const matches = mapping.filter((entry) => resourceId.startsWith(entry.matchPrefix) || resourceId.includes(entry.matchPrefix));
  matches.sort((a, b) => b.matchPrefix.length - a.matchPrefix.length);
  return matches[0];
}

export function classifyWithMapping(
  provider: EstimatorProvider,
  resourceId: string,
  mapping: MappingEntry[]
): EstimatorResourceRow {
  const matched = findMapping(resourceId, mapping);
  const parsed = parseResourceIdentity(provider, resourceId);

  if (!matched) {
    return {
      resourceId,
      service: parsed.service,
      resourceType: parsed.resourceType,
      region: parsed.region,
      classification: "unmapped",
      reasonCode: "UNMAPPED_TYPE"
    };
  }

  if (!matched.rumEligible) {
    return {
      resourceId,
      service: parsed.service,
      resourceType: parsed.resourceType,
      region: parsed.region,
      classification: "excluded",
      reasonCode: "MAPPED_EXCLUDED",
      terraformResourceType: matched.terraformType
    };
  }

  return {
    resourceId,
    service: parsed.service,
    resourceType: parsed.resourceType,
    region: parsed.region,
    classification: "rum_candidate",
    reasonCode: "MAPPED_MANAGEABLE",
    terraformResourceType: matched.terraformType
  };
}

export function buildDiagnostics(classified: EstimatorResourceRow[]): EstimatorRunDiagnostics {
  const discovered = classified.length;
  const unmappedRows = classified.filter((row) => row.classification === "unmapped");
  const mappedResources = discovered - unmappedRows.length;
  const coveragePct = discovered === 0 ? 0 : Number(((mappedResources / discovered) * 100).toFixed(2));
  const permissionDeniedRows = classified.filter((row) => row.reasonCode === "PERMISSION_DENIED");
  const permissionCounts = new Map<string, number>();

  for (const row of permissionDeniedRows) {
    const permission = row.reasonDetail?.replace("Missing permission for ", "") || "unknown_permission";
    permissionCounts.set(permission, (permissionCounts.get(permission) ?? 0) + 1);
  }

  const topMissingPermissions = [...permissionCounts.entries()]
    .map(([permission, count]) => ({ permission, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  const unmappedCounts = new Map<string, { count: number; sampleResourceId: string }>();
  for (const row of unmappedRows) {
    const resourceRoot = row.resourceType.split(/[/:]/)[0] || "unknown";
    const key = `${row.service}:${resourceRoot}`;
    const existing = unmappedCounts.get(key);
    if (existing) {
      existing.count += 1;
    } else {
      unmappedCounts.set(key, { count: 1, sampleResourceId: row.resourceId });
    }
  }

  const topUnmappedPrefixes = [...unmappedCounts.entries()]
    .map(([key, value]) => ({ key, count: value.count, sampleResourceId: value.sampleResourceId }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);

  return {
    mappedResources,
    coveragePct,
    permissionDenied: permissionDeniedRows.length,
    topMissingPermissions,
    topUnmappedPrefixes
  };
}

export function buildIamRemediation(provider: EstimatorProvider, diagnostics: EstimatorRunDiagnostics) {
  const basePermission =
    provider === "aws"
      ? "resourcegroupstaggingapi:GetResources"
      : provider === "azure"
        ? "Microsoft.Resources/subscriptions/resources/read"
        : "cloudasset.assets.searchAllResources";
  const actions = new Set<string>([basePermission]);
  for (const item of diagnostics.topMissingPermissions) {
    actions.add(item.permission);
  }
  const sortedActions = [...actions].sort();
  return {
    actions: sortedActions,
    policy: {
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "RumEstimatorReadOnly",
          Effect: "Allow",
          Action: sortedActions,
          Resource: "*"
        }
      ]
    }
  };
}
