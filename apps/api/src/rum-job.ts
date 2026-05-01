import { calculateRumFromState, parseTerraformState } from "@rum-tool/rum-engine";
import { logger } from "./logger.js";
import { execFile as execFileCb } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, normalize, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { updateScan } from "./store.js";
import type { ManagedResourceFinding, ScanRequest } from "./types.js";
import { getWorkspaceRoot } from "./workspace-root.js";

const FIXTURE_MAP: Record<string, string[]> = {
  aws: ["aws-dev.tfstate.json", "aws-prod.tfstate.json"],
  azure: ["azure-dev.tfstate.json"],
  gcp: ["gcp-shared.tfstate.json"]
};

const execFile = promisify(execFileCb);

type ScanResult = {
  rum: number;
  stateFiles: number;
  excludedResources: number;
  parseErrors: number;
  resources: ManagedResourceFinding[];
};

function isTerraformStateObjectKey(key: string): boolean {
  return key.endsWith(".tfstate") || key.endsWith(".tfstate.json");
}

function normalizeTargetName(target: ScanRequest["targets"][number]): string {
  if (target.provider === "azure") {
    return `${target.storageAccountName ?? "unknown-account"}/${target.containerName ?? "unknown-container"}`;
  }
  if (target.provider === "local") {
    return target.directoryPath ?? "unknown-directory";
  }
  return target.bucketName ?? "unknown-bucket";
}

function mapRuleCodeAndReason(
  counted: boolean,
  exclusionReason?: "mode_data" | "excluded_type_null_resource" | "excluded_type_terraform_data" | "invalid_or_unmanaged"
): Pick<ManagedResourceFinding, "ruleCode" | "ruleReason"> {
  if (counted) {
    return {
      ruleCode: "INCLUDED_MANAGED_RESOURCE",
      ruleReason: "Managed resource in state counts toward RUM."
    };
  }
  if (exclusionReason === "mode_data") {
    return {
      ruleCode: "EXCLUDED_DATA_SOURCE",
      ruleReason: "Data sources (mode=data) are excluded from RUM."
    };
  }
  if (exclusionReason === "excluded_type_null_resource") {
    return {
      ruleCode: "EXCLUDED_NULL_RESOURCE",
      ruleReason: "null_resource is explicitly excluded from RUM."
    };
  }
  if (exclusionReason === "excluded_type_terraform_data") {
    return {
      ruleCode: "EXCLUDED_TERRAFORM_DATA",
      ruleReason: "terraform_data is explicitly excluded from RUM."
    };
  }
  return {
    ruleCode: "EXCLUDED_INVALID_OR_UNMANAGED",
    ruleReason: "Resource is not a managed Terraform resource in state."
  };
}

function evaluateStateFile(
  raw: string,
  provider: "aws" | "azure" | "gcp" | "local",
  targetName: string,
  stateFile: string
): ScanResult {
  const result = calculateRumFromState(parseTerraformState(raw));
  const resources: ManagedResourceFinding[] = result.evaluations.map((evaluation, index) => {
    const rule = mapRuleCodeAndReason(evaluation.counted, evaluation.exclusionReason);
    return {
      id: `${provider}:${targetName}:${stateFile}:${evaluation.address}:${index}`,
      provider,
      targetName,
      stateFile,
      resourceAddress: evaluation.address,
      resourceType: evaluation.type,
      mode: evaluation.mode,
      instanceCount: evaluation.instanceCount,
      candidateStatus: evaluation.counted ? "included" : "excluded",
      rumCount: evaluation.rum,
      ruleCode: rule.ruleCode,
      ruleReason: rule.ruleReason
    };
  });

  return {
    rum: result.totalRum,
    stateFiles: 1,
    excludedResources: result.excludedResources,
    parseErrors: 0,
    resources
  };
}

function matchesPatterns(fileName: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === "*.tfstate") return fileName.endsWith(".tfstate");
    if (pattern === "*.tfstate.json") return fileName.endsWith(".tfstate.json");
    return fileName.endsWith(pattern.replace("*", ""));
  });
}

function isUnderAllowedRoot(pathToCheck: string, allowedRoots: string[]): boolean {
  const normalizedPath = resolve(pathToCheck);
  return allowedRoots.some((root) => {
    const normalizedRoot = resolve(root);
    return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}${sep}`);
  });
}

async function collectLocalStateFiles(
  directoryPath: string,
  recursive: boolean,
  patterns: string[],
  maxObjects?: number
): Promise<string[]> {
  const pending: string[] = [directoryPath];
  const out: string[] = [];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) continue;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) pending.push(absolutePath);
        continue;
      }
      if (matchesPatterns(entry.name, patterns)) {
        out.push(absolutePath);
        if (maxObjects && out.length >= maxObjects) {
          return out;
        }
      }
    }
  }

  return out;
}

async function runCli(command: string, args: string[], envOverrides?: Record<string, string>): Promise<string> {
  const result = await execFile(command, args, {
    maxBuffer: 20 * 1024 * 1024,
    env: {
      ...process.env,
      ...envOverrides
    }
  });
  return result.stdout;
}

function buildAwsEnvOverrides(request: ScanRequest): Record<string, string> {
  const execution = request.executionEnv;
  if (!execution) return {};
  const env: Record<string, string> = {};
  if (execution.awsRegion) {
    env.AWS_REGION = execution.awsRegion;
    env.AWS_DEFAULT_REGION = execution.awsRegion;
  }
  if (execution.awsProfile) {
    env.AWS_PROFILE = execution.awsProfile;
  }
  if (execution.awsAccessKeyId) {
    env.AWS_ACCESS_KEY_ID = execution.awsAccessKeyId;
  }
  if (execution.awsSecretAccessKey) {
    env.AWS_SECRET_ACCESS_KEY = execution.awsSecretAccessKey;
  }
  if (execution.awsSessionToken) {
    env.AWS_SESSION_TOKEN = execution.awsSessionToken;
  }
  if (env.AWS_ACCESS_KEY_ID && !env.AWS_SECRET_ACCESS_KEY) {
    throw new Error("executionEnv.awsSecretAccessKey is required when awsAccessKeyId is provided.");
  }
  if (env.AWS_SECRET_ACCESS_KEY && !env.AWS_ACCESS_KEY_ID) {
    throw new Error("executionEnv.awsAccessKeyId is required when awsSecretAccessKey is provided.");
  }
  return env;
}

function buildAzureEnvOverrides(request: ScanRequest): Record<string, string> {
  const execution = request.executionEnv;
  if (!execution) return {};
  const env: Record<string, string> = {};
  if (execution.azureTenantId) {
    env.AZURE_TENANT_ID = execution.azureTenantId;
  }
  return env;
}

function buildGcpEnvOverrides(request: ScanRequest): Record<string, string> {
  const execution = request.executionEnv;
  if (!execution) return {};
  const env: Record<string, string> = {};
  if (execution.gcpProjectId) {
    env.CLOUDSDK_CORE_PROJECT = execution.gcpProjectId;
  }
  if (execution.googleApplicationCredentials) {
    env.GOOGLE_APPLICATION_CREDENTIALS = execution.googleApplicationCredentials;
  }
  return env;
}

async function scanAwsBucket(
  target: ScanRequest["targets"][number],
  maxObjects: number | undefined,
  envOverrides: Record<string, string>
): Promise<ScanResult> {
  if (!target.bucketName) {
    throw new Error("AWS target missing bucketName");
  }

  let continuationToken: string | undefined;
  let rum = 0;
  let stateFiles = 0;
  let excludedResources = 0;
  let parseErrors = 0;
  const resources: ManagedResourceFinding[] = [];
  const targetName = normalizeTargetName(target);

  do {
    const args = ["s3api", "list-objects-v2", "--bucket", target.bucketName, "--output", "json"];
    if (target.prefix) args.push("--prefix", target.prefix);
    if (continuationToken) args.push("--continuation-token", continuationToken);

    const stdout = await runCli("aws", args, envOverrides);
    const parsed = JSON.parse(stdout) as {
      Contents?: Array<{ Key?: string }>;
      IsTruncated?: boolean;
      NextContinuationToken?: string;
    };

    for (const key of (parsed.Contents ?? []).map((item) => item.Key).filter((key): key is string => Boolean(key))) {
      if (!isTerraformStateObjectKey(key)) continue;
      if (maxObjects && stateFiles >= maxObjects) {
        return { rum, stateFiles, excludedResources, parseErrors, resources };
      }
      try {
        const raw = await runCli("aws", ["s3", "cp", `s3://${target.bucketName}/${key}`, "-"], envOverrides);
        const fileResult = evaluateStateFile(raw, "aws", targetName, key);
        rum += fileResult.rum;
        excludedResources += fileResult.excludedResources;
        resources.push(...fileResult.resources);
        stateFiles += 1;
      } catch {
        parseErrors += 1;
      }
    }

    continuationToken = parsed.IsTruncated ? parsed.NextContinuationToken : undefined;
  } while (continuationToken);

  return { rum, stateFiles, excludedResources, parseErrors, resources };
}

async function scanAzureContainer(
  target: ScanRequest["targets"][number],
  maxObjects: number | undefined,
  envOverrides: Record<string, string>,
  executionEnv?: ScanRequest["executionEnv"]
): Promise<ScanResult> {
  if (!target.storageAccountName || !target.containerName) {
    throw new Error("Azure target requires storageAccountName and containerName");
  }

  const listArgs = [
    "storage",
    "blob",
    "list",
    "--account-name",
    target.storageAccountName,
    "--container-name",
    target.containerName,
    "--auth-mode",
    "login",
    "--output",
    "json",
    "--num-results",
    String(maxObjects ?? 5000)
  ];
  if (target.prefix) listArgs.push("--prefix", target.prefix);
  if (executionEnv?.azureSubscriptionId) {
    listArgs.push("--subscription", executionEnv.azureSubscriptionId);
  }

  const listStdout = await runCli("az", listArgs, envOverrides);
  const blobs = JSON.parse(listStdout) as Array<{ name?: string }>;

  let rum = 0;
  let stateFiles = 0;
  let excludedResources = 0;
  let parseErrors = 0;
  const resources: ManagedResourceFinding[] = [];
  const targetName = normalizeTargetName(target);

  for (const name of blobs.map((blob) => blob.name).filter((name): name is string => Boolean(name))) {
    if (!isTerraformStateObjectKey(name)) continue;
    if (maxObjects && stateFiles >= maxObjects) {
      return { rum, stateFiles, excludedResources, parseErrors, resources };
    }
    try {
      const downloadArgs = [
        "storage",
        "blob",
        "download",
        "--account-name",
        target.storageAccountName,
        "--container-name",
        target.containerName,
        "--name",
        name,
        "--auth-mode",
        "login",
        "--file",
        "/dev/stdout",
        "--output",
        "none"
      ];
      if (executionEnv?.azureSubscriptionId) {
        downloadArgs.push("--subscription", executionEnv.azureSubscriptionId);
      }
      const raw = await runCli("az", downloadArgs, envOverrides);
      const fileResult = evaluateStateFile(raw, "azure", targetName, name);
      rum += fileResult.rum;
      excludedResources += fileResult.excludedResources;
      resources.push(...fileResult.resources);
      stateFiles += 1;
    } catch {
      parseErrors += 1;
    }
  }

  return { rum, stateFiles, excludedResources, parseErrors, resources };
}

async function scanGcsBucket(
  target: ScanRequest["targets"][number],
  maxObjects: number | undefined,
  envOverrides: Record<string, string>
): Promise<ScanResult> {
  if (!target.bucketName) {
    throw new Error("GCP target missing bucketName");
  }

  const prefixPath = target.prefix ? target.prefix.replace(/^\/+/, "") : "";
  const listPath = prefixPath ? `gs://${target.bucketName}/${prefixPath}**` : `gs://${target.bucketName}/**`;
  const listStdout = await runCli("gsutil", ["ls", "-r", listPath], envOverrides);
  const objectPaths = listStdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("gs://") && !line.endsWith("/") && isTerraformStateObjectKey(line));

  let rum = 0;
  let stateFiles = 0;
  let excludedResources = 0;
  let parseErrors = 0;
  const resources: ManagedResourceFinding[] = [];
  const targetName = normalizeTargetName(target);

  for (const objectPath of objectPaths) {
    if (maxObjects && stateFiles >= maxObjects) {
      return { rum, stateFiles, excludedResources, parseErrors, resources };
    }
    try {
      const raw = await runCli("gsutil", ["cat", objectPath], envOverrides);
      const fileResult = evaluateStateFile(raw, "gcp", targetName, objectPath);
      rum += fileResult.rum;
      excludedResources += fileResult.excludedResources;
      resources.push(...fileResult.resources);
      stateFiles += 1;
    } catch {
      parseErrors += 1;
    }
  }

  return { rum, stateFiles, excludedResources, parseErrors, resources };
}

async function scanFixtureFiles(provider: string): Promise<ScanResult> {
  const fixtureFiles = FIXTURE_MAP[provider] ?? [];
  const workspaceRoot = getWorkspaceRoot();
  let rum = 0;
  let stateFiles = 0;
  let excludedResources = 0;
  const resources: ManagedResourceFinding[] = [];

  for (const filename of fixtureFiles) {
    const fullPath = join(workspaceRoot, "fixtures/states", filename);
    const raw = await readFile(fullPath, "utf-8");
    const fileResult = evaluateStateFile(
      raw,
      provider as "aws" | "azure" | "gcp" | "local",
      `fixtures/${provider}`,
      filename
    );
    rum += fileResult.rum;
    stateFiles += 1;
    excludedResources += fileResult.excludedResources;
    resources.push(...fileResult.resources);
  }

  return { rum, stateFiles, excludedResources, parseErrors: 0, resources };
}

async function scanLocalDirectory(
  target: ScanRequest["targets"][number],
  maxObjects?: number
): Promise<ScanResult> {
  if (!target.directoryPath) {
    throw new Error("Local target requires directoryPath");
  }

  const workspaceRoot = getWorkspaceRoot();
  const allowedRootsRaw = process.env.LOCAL_SCAN_ALLOWED_ROOTS;
  const allowedRoots = allowedRootsRaw
    ? allowedRootsRaw.split(",").map((value) => value.trim()).filter(Boolean)
    : [workspaceRoot];

  const resolvedInput = isAbsolute(target.directoryPath)
    ? resolve(target.directoryPath)
    : resolve(workspaceRoot, target.directoryPath);
  if (!isUnderAllowedRoot(resolvedInput, allowedRoots)) {
    throw new Error(`Local directory '${target.directoryPath}' is outside allowed roots.`);
  }

  const patterns = (target.patterns && target.patterns.length > 0)
    ? target.patterns
    : ["*.tfstate", "*.tfstate.json"];

  const files = await collectLocalStateFiles(resolvedInput, target.recursive ?? true, patterns, maxObjects);

  let rum = 0;
  let stateFiles = 0;
  let excludedResources = 0;
  let parseErrors = 0;
  const resources: ManagedResourceFinding[] = [];
  const targetName = normalizeTargetName(target);
  for (const filePath of files) {
    try {
      const raw = await readFile(filePath, "utf-8");
      const normalizedPath = normalize(filePath).replace(`${workspaceRoot}${sep}`, "");
      const fileResult = evaluateStateFile(raw, "local", targetName, normalizedPath);
      rum += fileResult.rum;
      excludedResources += fileResult.excludedResources;
      resources.push(...fileResult.resources);
      stateFiles += 1;
    } catch {
      parseErrors += 1;
    }
  }

  return { rum, stateFiles, excludedResources, parseErrors, resources };
}

export async function runScanJob(scanId: string, requestOverride?: ScanRequest): Promise<void> {
  updateScan(scanId, (scan) => ({ ...scan, status: "running", errorMessage: undefined }));

  const scan = updateScan(scanId, (s) => s);
  if (!scan) return;
  const request = requestOverride ?? scan.request;

  try {
    let totalRum = 0;
    let excludedResources = 0;
    let stateFilesParsed = 0;
    let parseErrors = 0;
    const managedResources: ManagedResourceFinding[] = [];

    const byBucket: Array<{
      bucketName: string;
      provider: string;
      rum: number;
      stateFiles: number;
      excludedResources: number;
      parseErrors: number;
    }> = [];

    const awsEnvOverrides = buildAwsEnvOverrides(request);
    const azureEnvOverrides = buildAzureEnvOverrides(request);
    const gcpEnvOverrides = buildGcpEnvOverrides(request);

    for (const target of request.targets) {
      const maxObjects = request.options?.maxObjects;
      const useAwsS3 = target.provider === "aws" && process.env.ENABLE_AWS_S3_SCAN === "true";
      const useAzureBlob = target.provider === "azure" && process.env.ENABLE_AZURE_BLOB_SCAN === "true";
      const useGcs = target.provider === "gcp" && process.env.ENABLE_GCP_GCS_SCAN === "true";
      const useLocalDirectory = target.provider === "local";

      const result = useAwsS3
        ? await scanAwsBucket(target, maxObjects, awsEnvOverrides)
        : useAzureBlob
          ? await scanAzureContainer(target, maxObjects, azureEnvOverrides, request.executionEnv)
          : useGcs
            ? await scanGcsBucket(target, maxObjects, gcpEnvOverrides)
            : useLocalDirectory
              ? await scanLocalDirectory(target, maxObjects)
              : await scanFixtureFiles(target.provider);

      byBucket.push({
        bucketName: normalizeTargetName(target),
        provider: target.provider,
        rum: result.rum,
        stateFiles: result.stateFiles,
        excludedResources: result.excludedResources,
        parseErrors: result.parseErrors
      });

      totalRum += result.rum;
      excludedResources += result.excludedResources;
      stateFilesParsed += result.stateFiles;
      parseErrors += result.parseErrors;
      managedResources.push(...result.resources);
    }

    updateScan(scanId, (s) => ({
      ...s,
      status: "completed",
      summary: {
        bucketsScanned: byBucket.length,
        stateFilesParsed,
        totalRum,
        excludedResources,
        parseErrors
      },
      byBucket,
      managedResources
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ scanId, err: message }, "Scan failed");
    updateScan(scanId, (s) => ({ ...s, status: "failed", errorMessage: message }));
  }
}
