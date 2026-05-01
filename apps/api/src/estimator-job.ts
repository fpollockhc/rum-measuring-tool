import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { updateEstimatorRun } from "./estimator-store.js";
import type {
  AwsEstimatorRequest,
  AzureEstimatorRequest,
  EstimatorProvider,
  EstimatorResourceRow,
  GcpEstimatorRequest
} from "./estimator-types.js";
import { loadMapping, type MappingEntry } from "./estimator-mapping.js";
import { buildDiagnostics, classifyWithMapping, parseResourceIdentity } from "./estimator-analysis.js";

const execFile = promisify(execFileCb);

async function runCli(
  command: "aws" | "az" | "gcloud",
  args: string[],
  envOverrides: Record<string, string>
): Promise<string> {
  const result = await execFile(command, args, {
    maxBuffer: 30 * 1024 * 1024,
    env: {
      ...process.env,
      ...envOverrides
    }
  });
  return result.stdout;
}

function buildAwsEnvOverrides(request: AwsEstimatorRequest): Record<string, string> {
  const execution = request.executionEnv;
  if (!execution) return {};
  const env: Record<string, string> = {};
  if (execution.awsRegion) {
    env.AWS_REGION = execution.awsRegion;
    env.AWS_DEFAULT_REGION = execution.awsRegion;
  }
  if (execution.awsProfile) env.AWS_PROFILE = execution.awsProfile;
  if (execution.awsAccessKeyId) env.AWS_ACCESS_KEY_ID = execution.awsAccessKeyId;
  if (execution.awsSecretAccessKey) env.AWS_SECRET_ACCESS_KEY = execution.awsSecretAccessKey;
  if (execution.awsSessionToken) env.AWS_SESSION_TOKEN = execution.awsSessionToken;
  return env;
}

function buildAzureEnvOverrides(request: AzureEstimatorRequest): Record<string, string> {
  const execution = request.executionEnv;
  if (!execution) return {};
  const env: Record<string, string> = {};
  if (execution.azureSubscriptionId) env.AZURE_SUBSCRIPTION_ID = execution.azureSubscriptionId;
  if (execution.azureTenantId) env.AZURE_TENANT_ID = execution.azureTenantId;
  return env;
}

function buildGcpEnvOverrides(request: GcpEstimatorRequest): Record<string, string> {
  const execution = request.executionEnv;
  if (!execution) return {};
  const env: Record<string, string> = {};
  if (execution.gcpProjectId) env.CLOUDSDK_CORE_PROJECT = execution.gcpProjectId;
  if (execution.googleApplicationCredentials) {
    env.GOOGLE_APPLICATION_CREDENTIALS = execution.googleApplicationCredentials;
  }
  return env;
}

function isPermissionDenied(message: string): boolean {
  return (
    message.includes("AccessDenied") ||
    message.includes("AccessDeniedException") ||
    message.includes("UnauthorizedOperation") ||
    message.includes("is not authorized to perform") ||
    message.includes("does not have authorization") ||
    message.includes("permission denied")
  );
}

async function resolveAwsServiceDiscoveryNamespace(
  resourceArn: string,
  envOverrides: Record<string, string>
): Promise<{ terraformType?: string; permissionDenied?: boolean; reasonDetail?: string }> {
  const parsed = parseResourceIdentity("aws", resourceArn);
  if (parsed.service !== "servicediscovery") return {};
  const resourcePath = resourceArn.split(":")[5] ?? "";
  if (!resourcePath.startsWith("namespace/")) return {};
  const namespaceId = resourcePath.split("/")[1];
  if (!namespaceId) return {};

  const args = ["servicediscovery", "get-namespace", "--id", namespaceId, "--output", "json"];
  if (parsed.region) args.push("--region", parsed.region);

  try {
    const stdout = await runCli("aws", args, envOverrides);
    const payload = JSON.parse(stdout) as { Namespace?: { Type?: string } };
    if (payload.Namespace?.Type === "DNS_PRIVATE") return { terraformType: "aws_service_discovery_private_dns_namespace" };
    if (payload.Namespace?.Type === "DNS_PUBLIC") return { terraformType: "aws_service_discovery_public_dns_namespace" };
    if (payload.Namespace?.Type === "HTTP") return { terraformType: "aws_service_discovery_http_namespace" };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isPermissionDenied(message)) {
      return { permissionDenied: true, reasonDetail: "Missing permission for servicediscovery:GetNamespace" };
    }
  }
  return {};
}

async function classifyAwsResource(
  resourceId: string,
  mapping: MappingEntry[],
  envOverrides: Record<string, string>
): Promise<EstimatorResourceRow> {
  const base = classifyWithMapping("aws", resourceId, mapping);
  if (base.reasonCode !== "UNMAPPED_TYPE") return base;

  const resolved = await resolveAwsServiceDiscoveryNamespace(resourceId, envOverrides);
  if (resolved.terraformType) {
    return {
      ...base,
      classification: "rum_candidate",
      reasonCode: "MAPPED_MANAGEABLE",
      terraformResourceType: resolved.terraformType
    };
  }
  if (resolved.permissionDenied) {
    return {
      ...base,
      reasonCode: "PERMISSION_DENIED",
      reasonDetail: resolved.reasonDetail
    };
  }
  return base;
}

async function discoverAwsResources(request: AwsEstimatorRequest, envOverrides: Record<string, string>): Promise<string[]> {
  const configuredRegions =
    request.scope.regions && request.scope.regions.length > 0
      ? request.scope.regions
      : [envOverrides.AWS_REGION ?? process.env.AWS_REGION ?? "us-east-1"];
  const discovered = new Set<string>();

  for (const region of configuredRegions) {
    let token: string | undefined;
    do {
      const args = ["resourcegroupstaggingapi", "get-resources", "--region", region, "--output", "json"];
      const tagFilters = request.scope.tagFilters ?? [];
      for (const filter of tagFilters) {
        args.push("--tag-filters", `Key=${filter.key}${filter.values && filter.values.length > 0 ? `,Values=${filter.values.join(",")}` : ""}`);
      }
      if (token) args.push("--pagination-token", token);

      const stdout = await runCli("aws", args, envOverrides);
      const parsed = JSON.parse(stdout) as {
        ResourceTagMappingList?: Array<{ ResourceARN?: string }>;
        PaginationToken?: string;
      };
      for (const arn of (parsed.ResourceTagMappingList ?? []).map((v) => v.ResourceARN).filter(Boolean) as string[]) {
        discovered.add(arn);
      }
      token = parsed.PaginationToken || undefined;
    } while (token);
  }
  return [...discovered];
}

async function discoverAzureResources(request: AzureEstimatorRequest, envOverrides: Record<string, string>): Promise<string[]> {
  const args = ["resource", "list", "--output", "json"];
  const subscriptionId = request.scope.subscriptionId ?? request.executionEnv?.azureSubscriptionId;
  if (subscriptionId) args.push("--subscription", subscriptionId);
  if (request.scope.resourceGroup) args.push("--resource-group", request.scope.resourceGroup);

  const stdout = await runCli("az", args, envOverrides);
  const parsed = JSON.parse(stdout) as Array<{ id?: string }>;
  return parsed.map((item) => item.id).filter(Boolean) as string[];
}

async function discoverGcpResources(request: GcpEstimatorRequest, envOverrides: Record<string, string>): Promise<string[]> {
  const projectId = request.scope.projectId || request.executionEnv?.gcpProjectId;
  if (!projectId) {
    throw new Error("gcp projectId is required for GCP estimator runs");
  }
  const args = ["asset", "search-all-resources", `--scope=projects/${projectId}`, "--format=json"];
  const stdout = await runCli("gcloud", args, envOverrides);
  const parsed = JSON.parse(stdout) as Array<{ name?: string }>;
  return parsed.map((item) => item.name).filter(Boolean) as string[];
}

function summarize(classified: EstimatorResourceRow[]) {
  return {
    discoveredResources: classified.length,
    rumCandidates: classified.filter((row) => row.classification === "rum_candidate").length,
    nonManageable: classified.filter((row) => row.classification === "not_manageable" || row.classification === "excluded").length,
    unmapped: classified.filter((row) => row.classification === "unmapped").length
  };
}

async function runEstimatorJob(
  provider: EstimatorProvider,
  runId: string,
  discover: () => Promise<string[]>,
  classify: (resourceId: string, mapping: MappingEntry[]) => Promise<EstimatorResourceRow> | EstimatorResourceRow
): Promise<void> {
  updateEstimatorRun(runId, (run) => ({ ...run, status: "running", errorMessage: undefined }));
  try {
    const enableVar =
      provider === "aws"
        ? process.env.ENABLE_AWS_UNMANAGED_ESTIMATOR
        : provider === "azure"
          ? process.env.ENABLE_AZURE_UNMANAGED_ESTIMATOR
          : process.env.ENABLE_GCP_UNMANAGED_ESTIMATOR;
    if (enableVar !== "true") {
      throw new Error(`${provider.toUpperCase()} unmanaged estimator is disabled. Set ENABLE_${provider.toUpperCase()}_UNMANAGED_ESTIMATOR=true`);
    }

    const mapping = await loadMapping(provider);
    const discovered = await discover();
    const classified = await Promise.all(discovered.map((resourceId) => classify(resourceId, mapping.entries)));
    const summary = summarize(classified);
    const diagnostics = buildDiagnostics(classified);

    updateEstimatorRun(runId, (run) => ({
      ...run,
      status: "completed",
      summary,
      diagnostics,
      mapping: mapping.metadata,
      resources: classified
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    updateEstimatorRun(runId, (run) => ({ ...run, status: "failed", errorMessage: message }));
  }
}

export async function runAwsEstimatorJob(runId: string, request: AwsEstimatorRequest): Promise<void> {
  const envOverrides = buildAwsEnvOverrides(request);
  await runEstimatorJob(
    "aws",
    runId,
    () => discoverAwsResources(request, envOverrides),
    (resourceId, mapping) => classifyAwsResource(resourceId, mapping, envOverrides)
  );
}

export async function runAzureEstimatorJob(runId: string, request: AzureEstimatorRequest): Promise<void> {
  const envOverrides = buildAzureEnvOverrides(request);
  await runEstimatorJob(
    "azure",
    runId,
    () => discoverAzureResources(request, envOverrides),
    (resourceId, mapping) => classifyWithMapping("azure", resourceId, mapping)
  );
}

export async function runGcpEstimatorJob(runId: string, request: GcpEstimatorRequest): Promise<void> {
  const envOverrides = buildGcpEnvOverrides(request);
  await runEstimatorJob(
    "gcp",
    runId,
    () => discoverGcpResources(request, envOverrides),
    (resourceId, mapping) => classifyWithMapping("gcp", resourceId, mapping)
  );
}
