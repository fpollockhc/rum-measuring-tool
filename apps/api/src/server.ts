import express from "express";
import cors from "cors";
import helmet from "helmet";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createScan, getScan, listScans } from "./store.js";
import { runScanJob } from "./rum-job.js";
import type { ManagedResourceFinding, ScanRequest } from "./types.js";
import { createEstimatorRun, getEstimatorRun, listEstimatorRuns } from "./estimator-store.js";
import { runAwsEstimatorJob, runAzureEstimatorJob, runGcpEstimatorJob } from "./estimator-job.js";
import { loadMapping } from "./estimator-mapping.js";
import { buildDiagnostics, buildIamRemediation } from "./estimator-analysis.js";
import type { EstimatorProvider, EstimatorResourceRow } from "./estimator-types.js";
import { createTfeMigration, getTfeMigration, listTfeMigrations } from "./tfe-store.js";
import { runTfeMigrationJob } from "./tfe-job.js";
import { listProjects } from "./tfe-client.js";
import type { TfeWorkspaceResult } from "./tfe-types.js";
import { logger } from "./logger.js";

const app = express();
const port = Number(process.env.PORT ?? 8080);

// Security headers — helmet sets X-Frame-Options, X-Content-Type-Options,
// Strict-Transport-Security, X-XSS-Protection, and more
app.use(helmet({
  contentSecurityPolicy: false, // CSP handled by nginx in production
  crossOriginEmbedderPolicy: false // Allow embedding for presales demos
}));

// CORS — restrict to known frontend origins
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? "http://localhost:5173,http://localhost:80")
  .split(",")
  .map((o) => o.trim());

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (server-to-server, curl, health checks)
    if (!origin || ALLOWED_ORIGINS.includes(origin)) {
      callback(null, true);
    } else {
      logger.warn({ origin }, "CORS request from disallowed origin");
      callback(null, true); // Allow in internal tool — log but don't block
    }
  }
}));

app.use(express.json({ limit: "10mb" }));

// Request ID middleware — attaches unique ID for tracing
app.use((req, _res, next) => {
  (req as unknown as { requestId: string }).requestId =
    (req.headers["x-request-id"] as string) ?? randomUUID();
  next();
});

// Request logging middleware
app.use((req, res, next) => {
  const start = Date.now();
  const reqId = (req as unknown as { requestId: string }).requestId;
  res.on("finish", () => {
    logger.info({
      requestId: reqId,
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      durationMs: Date.now() - start
    }, `${req.method} ${req.originalUrl} ${res.statusCode}`);
  });
  next();
});

// Request timeout middleware (2 minutes)
app.use((_req, res, next) => {
  res.setTimeout(120_000, () => {
    if (!res.headersSent) {
      res.status(408).json({ error: "Request timeout" });
    }
  });
  next();
});

const scanRequestSchema = z.object({
  providers: z.array(z.enum(["aws", "azure", "gcp", "local"])).nonempty(),
  targets: z
    .array(
      z.object({
        provider: z.enum(["aws", "azure", "gcp", "local"]),
        bucketName: z.string().min(1).optional(),
        storageAccountName: z.string().min(1).optional(),
        containerName: z.string().min(1).optional(),
        directoryPath: z.string().min(1).optional(),
        recursive: z.boolean().optional(),
        patterns: z.array(z.string().min(1)).optional(),
        prefix: z.string().optional()
      }).superRefine((target, ctx) => {
        if ((target.provider === "aws" || target.provider === "gcp") && !target.bucketName) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "bucketName is required for aws/gcp targets" });
        }
        if (target.provider === "azure" && (!target.storageAccountName || !target.containerName)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: "storageAccountName and containerName are required for azure targets"
          });
        }
        if (target.provider === "local" && !target.directoryPath) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: "directoryPath is required for local targets" });
        }
      })
    )
    .nonempty(),
  options: z
    .object({
      dryRun: z.boolean().optional(),
      maxObjects: z.number().int().positive().optional(),
      concurrency: z.number().int().positive().optional()
    })
    .optional(),
  executionEnv: z
    .object({
      awsRegion: z.string().min(1).optional(),
      awsProfile: z.string().min(1).optional(),
      awsAccessKeyId: z.string().min(1).optional(),
      awsSecretAccessKey: z.string().min(1).optional(),
      awsSessionToken: z.string().min(1).optional(),
      azureSubscriptionId: z.string().min(1).optional(),
      azureTenantId: z.string().min(1).optional(),
      gcpProjectId: z.string().min(1).optional(),
      googleApplicationCredentials: z.string().min(1).optional()
    })
    .optional()
});

function redactSensitiveScanFields(request: ScanRequest): ScanRequest {
  if (!request.executionEnv) {
    return request;
  }
  return {
    ...request,
    executionEnv: {
      ...request.executionEnv,
      awsAccessKeyId: request.executionEnv.awsAccessKeyId ? "***redacted***" : undefined,
      awsSecretAccessKey: request.executionEnv.awsSecretAccessKey ? "***redacted***" : undefined,
      awsSessionToken: request.executionEnv.awsSessionToken ? "***redacted***" : undefined,
      googleApplicationCredentials: request.executionEnv.googleApplicationCredentials ? "***redacted***" : undefined
    }
  };
}

function redactSensitiveEstimatorFields<T extends { executionEnv?: Record<string, unknown> }>(
  request: T
): T {
  if (!request.executionEnv) return request;
  const redacted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(request.executionEnv)) {
    const lower = key.toLowerCase();
    if (
      lower.includes("key") ||
      lower.includes("secret") ||
      lower.includes("token") ||
      lower.includes("credential")
    ) {
      redacted[key] = value ? "***redacted***" : undefined;
    } else {
      redacted[key] = value;
    }
  }
  return { ...request, executionEnv: redacted };
}

function emptySummary() {
  return {
    bucketsScanned: 0,
    stateFilesParsed: 0,
    totalRum: 0,
    excludedResources: 0,
    parseErrors: 0
  };
}

type BucketSnapshot = {
  bucketName: string;
  provider: string;
  rum: number;
  stateFiles: number;
  excludedResources: number;
  parseErrors: number;
  runs: number;
  lastScanId: string;
  lastScannedAt: string;
};

function getLatestUniqueBucketSnapshots(scans: ReturnType<typeof listScans>): BucketSnapshot[] {
  const latestByBucket = new Map<string, BucketSnapshot>();
  const runCounts = new Map<string, number>();

  for (const scan of scans) {
    for (const bucket of scan.byBucket ?? []) {
      const key = `${bucket.provider}:${bucket.bucketName}`;
      runCounts.set(key, (runCounts.get(key) ?? 0) + 1);
      if (latestByBucket.has(key)) {
        continue;
      }
      latestByBucket.set(key, {
        bucketName: bucket.bucketName,
        provider: bucket.provider,
        rum: bucket.rum,
        stateFiles: bucket.stateFiles,
        excludedResources: bucket.excludedResources ?? 0,
        parseErrors: bucket.parseErrors ?? 0,
        runs: 0,
        lastScanId: scan.id,
        lastScannedAt: scan.createdAt
      });
    }
  }

  for (const [key, snapshot] of latestByBucket.entries()) {
    snapshot.runs = runCounts.get(key) ?? 1;
  }

  return [...latestByBucket.values()].sort((a, b) => b.rum - a.rum);
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.post("/scans", async (req, res) => {
  const parsed = scanRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const scan = createScan(redactSensitiveScanFields(parsed.data));
  void runScanJob(scan.id, parsed.data);
  res.status(202).json(scan);
});

app.get("/scans", (_req, res) => {
  res.json({ scans: listScans() });
});

app.get("/scans/:id", (req, res) => {
  const scan = getScan(req.params.id);
  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }
  res.json(scan);
});

function managedRowsToCsv(rows: ManagedResourceFinding[]): string {
  const headers = [
    "id",
    "provider",
    "targetName",
    "stateFile",
    "resourceAddress",
    "resourceType",
    "mode",
    "instanceCount",
    "candidateStatus",
    "rumCount",
    "ruleCode",
    "ruleReason"
  ];
  const lines = rows.map((row) =>
    [
      row.id,
      row.provider,
      row.targetName,
      row.stateFile,
      row.resourceAddress,
      row.resourceType,
      row.mode,
      String(row.instanceCount),
      row.candidateStatus,
      String(row.rumCount),
      row.ruleCode,
      row.ruleReason
    ]
      .map((cell) => csvEscape(cell))
      .join(",")
  );
  return `${headers.join(",")}\n${lines.join("\n")}\n`;
}

app.get("/scans/:id/resources", (req, res) => {
  const scan = getScan(req.params.id);
  if (!scan) {
    res.status(404).json({ error: "Scan not found" });
    return;
  }
  if (scan.status !== "completed") {
    res.status(409).json({ error: `Scan ${req.params.id} is not completed (status=${scan.status})` });
    return;
  }

  const statusFilter = typeof req.query.status === "string" ? req.query.status.toLowerCase() : "all";
  const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "json";

  const rows = (scan.managedResources ?? []).filter((row) => {
    if (statusFilter === "included") return row.candidateStatus === "included";
    if (statusFilter === "excluded") return row.candidateStatus === "excluded";
    return true;
  });

  if (format === "csv") {
    const filename = `scan-${scan.id}-resources-${statusFilter}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(managedRowsToCsv(rows));
    return;
  }

  res.json({
    scanId: scan.id,
    total: rows.length,
    status: statusFilter,
    rows
  });
});

app.get("/metrics/summary", (_req, res) => {
  const scans = listScans().filter((s) => s.status === "completed" && s.summary);
  const latest = scans[0];
  if (!latest?.summary) {
    res.json(emptySummary());
    return;
  }
  res.json(latest.summary);
});

app.get("/metrics/cumulative", (_req, res) => {
  const completed = listScans().filter((s) => s.status === "completed" && s.summary);
  const bucketSnapshots = getLatestUniqueBucketSnapshots(completed);
  const summary = bucketSnapshots.reduce(
    (acc, scan) => ({
      bucketsScanned: acc.bucketsScanned + 1,
      stateFilesParsed: acc.stateFilesParsed + scan.stateFiles,
      totalRum: acc.totalRum + scan.rum,
      excludedResources: acc.excludedResources + scan.excludedResources,
      parseErrors: acc.parseErrors + scan.parseErrors
    }),
    emptySummary()
  );

  res.json({
    completedRuns: completed.length,
    uniqueBuckets: bucketSnapshots.length,
    ...summary
  });
});

app.get("/metrics/by-bucket", (_req, res) => {
  const scans = listScans().filter((s) => s.status === "completed" && s.byBucket);
  const latest = scans[0];
  res.json({ buckets: latest?.byBucket ?? [] });
});

app.get("/metrics/by-bucket-cumulative", (_req, res) => {
  const completed = listScans().filter((s) => s.status === "completed" && s.byBucket);
  res.json({ buckets: getLatestUniqueBucketSnapshots(completed) });
});

const terminalSchema = z.object({
  command: z.string().min(1).max(200)
});
const awsEstimatorRequestSchema = z.object({
  scope: z.object({
    regions: z.array(z.string().min(1)).optional(),
    tagFilters: z
      .array(
        z.object({
          key: z.string().min(1),
          values: z.array(z.string().min(1)).optional()
        })
      )
      .optional()
  }),
  executionEnv: z
    .object({
      awsRegion: z.string().min(1).optional(),
      awsProfile: z.string().min(1).optional(),
      awsAccessKeyId: z.string().min(1).optional(),
      awsSecretAccessKey: z.string().min(1).optional(),
      awsSessionToken: z.string().min(1).optional()
    })
    .optional()
});
const azureEstimatorRequestSchema = z.object({
  scope: z.object({
    subscriptionId: z.string().min(1).optional(),
    resourceGroup: z.string().min(1).optional()
  }),
  executionEnv: z
    .object({
      azureSubscriptionId: z.string().min(1).optional(),
      azureTenantId: z.string().min(1).optional()
    })
    .optional()
});
const gcpEstimatorRequestSchema = z.object({
  scope: z.object({
    projectId: z.string().min(1)
  }),
  executionEnv: z
    .object({
      gcpProjectId: z.string().min(1).optional(),
      googleApplicationCredentials: z.string().min(1).optional()
    })
    .optional()
});

const ALLOWED_COMMANDS = new Set(["scan", "validate", "export", "help"]);

app.post("/terminal/exec", (req, res) => {
  const parsed = terminalSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid command payload" });
    return;
  }

  const [command] = parsed.data.command.trim().split(/\s+/);
  if (!ALLOWED_COMMANDS.has(command)) {
    res.status(403).json({
      error: `Command '${command}' is not allowed. Allowed commands: ${[...ALLOWED_COMMANDS].join(", ")}`
    });
    return;
  }

  // Stub terminal bridge for Phase 1 UI workflow.
  res.json({
    output: `Executed '${parsed.data.command}' in restricted mode.`
  });
});

app.post("/estimator/aws/runs", (req, res) => {
  const parsed = awsEstimatorRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const run = createEstimatorRun("aws", redactSensitiveEstimatorFields(parsed.data));
  void runAwsEstimatorJob(run.id, parsed.data);
  res.status(202).json(run);
});

app.post("/estimator/azure/runs", (req, res) => {
  const parsed = azureEstimatorRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const run = createEstimatorRun("azure", redactSensitiveEstimatorFields(parsed.data));
  void runAzureEstimatorJob(run.id, parsed.data);
  res.status(202).json(run);
});

app.post("/estimator/gcp/runs", (req, res) => {
  const parsed = gcpEstimatorRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const run = createEstimatorRun("gcp", redactSensitiveEstimatorFields(parsed.data));
  void runGcpEstimatorJob(run.id, parsed.data);
  res.status(202).json(run);
});

app.get("/estimator/runs", (_req, res) => {
  res.json({ runs: listEstimatorRuns() });
});

app.get("/estimator/runs/:id", (req, res) => {
  const run = getEstimatorRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Estimator run not found" });
    return;
  }
  res.json(run);
});

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes("\"") || value.includes("\n")) {
    return `"${value.replaceAll("\"", "\"\"")}"`;
  }
  return value;
}

function estimatorRowsToCsv(rows: EstimatorResourceRow[]): string {
  const headers = [
    "resourceId",
    "service",
    "resourceType",
    "region",
    "classification",
    "reasonCode",
    "reasonDetail",
    "terraformResourceType"
  ];

  const lines = rows.map((row) =>
    [
      row.resourceId,
      row.service,
      row.resourceType,
      row.region ?? "",
      row.classification,
      row.reasonCode,
      row.reasonDetail ?? "",
      row.terraformResourceType ?? ""
    ]
      .map((cell) => csvEscape(cell))
      .join(",")
  );

  return `${headers.join(",")}\n${lines.join("\n")}\n`;
}

function getEstimatorCategoryRows(
  runId: string,
  category: "candidates" | "non-manageable" | "unmapped"
) {
  const run = getEstimatorRun(runId);
  if (!run) {
    return { status: 404 as const, payload: { error: "Estimator run not found" } };
  }
  if (run.status !== "completed") {
    return {
      status: 409 as const,
      payload: { error: `Run ${runId} is not completed (status=${run.status})` }
    };
  }

  const resources = run.resources ?? [];
  const rows =
    category === "candidates"
      ? resources.filter((row) => row.classification === "rum_candidate")
      : category === "non-manageable"
        ? resources.filter((row) => row.classification === "excluded" || row.classification === "not_manageable")
        : resources.filter((row) => row.classification === "unmapped");

  return { status: 200 as const, payload: { run, rows } };
}

function handleEstimatorCategoryRoute(
  req: express.Request,
  res: express.Response,
  category: "candidates" | "non-manageable" | "unmapped"
) {
  const runId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  const result = getEstimatorCategoryRows(runId, category);
  if (result.status !== 200) {
    res.status(result.status).json(result.payload);
    return;
  }

  const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "json";
  if (format === "csv") {
    const filename = `estimator-${runId}-${category}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(estimatorRowsToCsv(result.payload.rows));
    return;
  }

  res.json({
    runId,
    category,
    total: result.payload.rows.length,
    rows: result.payload.rows
  });
}

app.get("/estimator/runs/:id/candidates", (req, res) => {
  handleEstimatorCategoryRoute(req, res, "candidates");
});

app.get("/estimator/runs/:id/non-manageable", (req, res) => {
  handleEstimatorCategoryRoute(req, res, "non-manageable");
});

app.get("/estimator/runs/:id/unmapped", (req, res) => {
  handleEstimatorCategoryRoute(req, res, "unmapped");
});

app.get("/estimator/runs/:id/diagnostics", (req, res) => {
  const run = getEstimatorRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Estimator run not found" });
    return;
  }
  if (run.status !== "completed") {
    res.status(409).json({ error: `Run ${req.params.id} is not completed (status=${run.status})` });
    return;
  }
  const diagnostics = run.diagnostics ?? buildDiagnostics(run.resources ?? []);
  res.json({
    runId: run.id,
    diagnostics
  });
});

app.get("/estimator/runs/:id/iam-remediation", (req, res) => {
  const run = getEstimatorRun(req.params.id);
  if (!run) {
    res.status(404).json({ error: "Estimator run not found" });
    return;
  }
  if (run.status !== "completed") {
    res.status(409).json({ error: `Run ${req.params.id} is not completed (status=${run.status})` });
    return;
  }
  const diagnostics = run.diagnostics ?? buildDiagnostics(run.resources ?? []);
  const remediation = buildIamRemediation(run.provider, diagnostics);
  const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "json";

  if (format === "policy") {
    const filename = `estimator-${run.id}-iam-remediation-policy.json`;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(`${JSON.stringify(remediation.policy, null, 2)}\n`);
    return;
  }

  res.json({
    runId: run.id,
    missingPermissions: diagnostics.topMissingPermissions,
    suggestedActions: remediation.actions,
    policy: remediation.policy
  });
});

app.get("/estimator/mapping/aws", async (_req, res) => {
  try {
    const mapping = await loadMapping("aws");
    res.json(mapping.metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to load AWS mapping metadata: ${message}` });
  }
});

app.get("/estimator/mapping/:provider", async (req, res) => {
  const provider = req.params.provider as EstimatorProvider;
  if (!["aws", "azure", "gcp"].includes(provider)) {
    res.status(400).json({ error: "Invalid provider. Expected aws|azure|gcp" });
    return;
  }
  try {
    const mapping = await loadMapping(provider);
    res.json(mapping.metadata);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(500).json({ error: `Failed to load ${provider} mapping metadata: ${message}` });
  }
});

/* ------------------------------------------------------------------ */
/*  TFE Migration Estimator                                           */
/* ------------------------------------------------------------------ */

const tfeConnectionSchema = z.object({
  tfeHostname: z
    .string()
    .min(1)
    .refine((v) => v.startsWith("https://") || v.startsWith("http://"), {
      message: "tfeHostname must start with https:// or http://"
    }),
  tfeToken: z.string().min(1),
  organization: z.string().min(1),
  tlsInsecure: z.boolean().optional()
});

const tfeMigrationRequestSchema = tfeConnectionSchema.extend({
  scopeLevel: z.enum(["organization", "project"]).optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
  workspaceFilter: z.string().optional(),
  concurrency: z.number().int().positive().max(20).optional()
});

// List projects for a TFE organization (used by UI for project picker)
app.post("/tfe/projects", async (req, res) => {
  const parsed = tfeConnectionSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const projects = await listProjects(
      {
        hostname: parsed.data.tfeHostname.replace(/\/+$/, ""),
        token: parsed.data.tfeToken,
        tlsInsecure: parsed.data.tlsInsecure
      },
      parsed.data.organization
    );

    res.json({
      projects: projects.map((p) => ({
        id: p.id,
        name: p.attributes.name,
        description: p.attributes.description ?? "",
        workspaceCount: p.attributes["workspace-count"] ?? 0
      }))
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    res.status(502).json({ error: `Failed to list TFE projects: ${message}` });
  }
});

app.post("/tfe/migration/runs", (req, res) => {
  const parsed = tfeMigrationRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  const record = createTfeMigration(parsed.data);
  void runTfeMigrationJob(record.id, parsed.data);
  res.status(202).json(record);
});

app.get("/tfe/migration/runs", (_req, res) => {
  res.json({ runs: listTfeMigrations() });
});

app.get("/tfe/migration/runs/:id", (req, res) => {
  const record = getTfeMigration(req.params.id);
  if (!record) {
    res.status(404).json({ error: "TFE migration run not found" });
    return;
  }
  res.json(record);
});

app.get("/tfe/migration/runs/:id/workspaces", (req, res) => {
  const record = getTfeMigration(req.params.id);
  if (!record) {
    res.status(404).json({ error: "TFE migration run not found" });
    return;
  }
  if (record.status !== "completed") {
    res.status(409).json({ error: `Run ${req.params.id} is not completed (status=${record.status})` });
    return;
  }
  res.json({
    runId: record.id,
    total: record.workspaces?.length ?? 0,
    workspaces: record.workspaces ?? []
  });
});

function tfeWorkspacesToCsv(workspaces: TfeWorkspaceResult[]): string {
  const headers = [
    "workspaceName",
    "workspaceId",
    "rum",
    "countedResources",
    "excludedResources",
    "totalResources",
    "parseError"
  ];
  const lines = workspaces.map((ws) =>
    [
      ws.workspaceName,
      ws.workspaceId,
      String(ws.rum),
      String(ws.countedResources),
      String(ws.excludedResources),
      String(ws.totalResources),
      ws.parseError ?? ""
    ]
      .map((cell) => csvEscape(cell))
      .join(",")
  );
  return `${headers.join(",")}\n${lines.join("\n")}\n`;
}

app.get("/tfe/migration/runs/:id/export", (req, res) => {
  const record = getTfeMigration(req.params.id);
  if (!record) {
    res.status(404).json({ error: "TFE migration run not found" });
    return;
  }
  if (record.status !== "completed") {
    res.status(409).json({ error: `Run ${req.params.id} is not completed (status=${record.status})` });
    return;
  }

  const format = typeof req.query.format === "string" ? req.query.format.toLowerCase() : "json";
  const workspaces = record.workspaces ?? [];

  if (format === "csv") {
    const filename = `tfe-migration-${record.id}.csv`;
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(tfeWorkspacesToCsv(workspaces));
    return;
  }

  res.json({
    runId: record.id,
    summary: record.summary,
    workspaces
  });
});

/* ---------- TFE Module Analysis ---------- */

app.get("/tfe/migration/runs/:id/modules", (req, res) => {
  const record = getTfeMigration(req.params.id);
  if (!record) {
    res.status(404).json({ error: "Migration run not found" });
    return;
  }
  if (record.status !== "completed") {
    res.status(400).json({ error: "Migration run not yet completed" });
    return;
  }

  // Return aggregated module summary + per-workspace module breakdown
  const perWorkspace = (record.workspaces ?? [])
    .filter((ws) => ws.modules && ws.modules.length > 0)
    .map((ws) => ({
      workspaceId: ws.workspaceId,
      workspaceName: ws.workspaceName,
      maxModuleDepth: ws.maxModuleDepth ?? 0,
      modules: ws.modules ?? []
    }));

  res.json({
    runId: record.id,
    aggregate: record.byModule ?? { modules: [], maxDepth: 0, totalModules: 0 },
    perWorkspace
  });
});

/* ---------- Combined RUM Summary ---------- */

app.get("/metrics/combined-summary", (_req, res) => {
  // Latest completed managed scan
  const completedScans = listScans().filter((s) => s.status === "completed" && s.summary);
  const latestScan = completedScans[0];

  // Latest completed estimator run
  const completedEstimator = listEstimatorRuns().filter((r) => r.status === "completed" && r.summary);
  const latestEstimator = completedEstimator[0];

  // Latest completed TFE migration
  const completedMigrations = listTfeMigrations().filter((r) => r.status === "completed" && r.summary);
  const latestMigration = completedMigrations[0];

  const sources: Record<string, unknown> = {};

  if (latestScan?.summary) {
    sources.managed = {
      scanId: latestScan.id,
      completedAt: latestScan.updatedAt,
      billableRum: latestScan.summary.totalRum,
      nonBillable: latestScan.summary.excludedResources,
      totalResources: latestScan.summary.totalRum + latestScan.summary.excludedResources,
      stateFiles: latestScan.summary.stateFilesParsed
    };
  }

  if (latestEstimator?.summary) {
    sources.unmanaged = {
      runId: latestEstimator.id,
      completedAt: latestEstimator.updatedAt,
      provider: latestEstimator.provider,
      billableRum: latestEstimator.summary.rumCandidates,
      nonBillable: latestEstimator.summary.nonManageable,
      totalResources: latestEstimator.summary.discoveredResources
    };
  }

  if (latestMigration?.summary) {
    sources.tfeMigration = {
      runId: latestMigration.id,
      completedAt: latestMigration.updatedAt,
      billableRum: latestMigration.summary.totalRum,
      nonBillable: latestMigration.summary.totalExcludedResources,
      totalResources: latestMigration.summary.totalRum + latestMigration.summary.totalExcludedResources,
      workspaces: latestMigration.summary.totalWorkspaces
    };
  }

  const totalBillableRum =
    ((sources.managed as { billableRum?: number })?.billableRum ?? 0) +
    ((sources.unmanaged as { billableRum?: number })?.billableRum ?? 0) +
    ((sources.tfeMigration as { billableRum?: number })?.billableRum ?? 0);

  const totalNonBillable =
    ((sources.managed as { nonBillable?: number })?.nonBillable ?? 0) +
    ((sources.unmanaged as { nonBillable?: number })?.nonBillable ?? 0) +
    ((sources.tfeMigration as { nonBillable?: number })?.nonBillable ?? 0);

  res.json({
    totalBillableRum,
    totalNonBillable,
    totalResources: totalBillableRum + totalNonBillable,
    activeSources: Object.keys(sources).length,
    sources
  });
});

// Global error handler — must be registered after all routes
app.use((err: unknown, req: express.Request, res: express.Response, _next: express.NextFunction) => {
  const message = err instanceof Error ? err.message : String(err);
  const reqId = (req as unknown as { requestId?: string }).requestId;
  logger.error({ requestId: reqId, err: message, url: req.originalUrl }, "Unhandled error");
  if (!res.headersSent) {
    res.status(500).json({ error: "Internal server error", details: message });
  }
});

app.listen(port, () => {
  logger.info({ port }, `API listening on http://localhost:${port}`);
});
