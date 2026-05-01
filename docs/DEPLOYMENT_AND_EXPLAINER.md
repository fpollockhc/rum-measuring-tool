# TFC RUM Calculator Tool - Deployment Guide and Explainer

## 1. What this tool does

This Phase 1 service helps teams estimate Terraform Cloud Resources Under Management (RUM) from OSS-style state inputs.

RUM calculation rules implemented:
- Count resources where `mode == "managed"`.
- Exclude `mode == "data"`.
- Exclude type `null_resource`.
- Exclude type `terraform_data`.
- Count expanded instances in state (`count` / `for_each` are reflected as multiple instances).

Current Phase 1 scanner source:
- Local fixture state files (`fixtures/states`) simulating AWS/Azure/GCP bucket contents.

## 2. Repository layout

- `packages/rum-engine`: shared RUM parser and rules.
- `apps/api`: REST API and scan job runner.
- `apps/web`: React + Carbon frontend (wizard, deployment actions, dashboard, terminal panel).
- `apps/cli`: `rumctl` CLI for headless runs.
- `fixtures/states`: test state files used by current scan runner.

## 3. Prerequisites

- Node.js 20+
- npm 10+
- Rancher Desktop + `nerdctl` (optional, for container deployment)

## 4. Local deployment (recommended for development)

1. Install dependencies:
```bash
npm install
```

2. Build shared engine + apps:
```bash
npm run build
```

3. Start API:
```bash
npm run dev -w @rum-tool/api
```

4. In another terminal, start web UI:
```bash
npm run dev -w @rum-tool/web
```

5. Open UI:
- `http://localhost:5173`

6. Run a scan from UI:
- Use wizard cards to pick provider(s), bucket name, options.
- Click `Run Scan`.
- Verify dashboard updates (`Total RUM`, `RUM by bucket_name`).

## 5. Container deployment with Rancher Desktop (`nerdctl`)

1. Ensure Rancher Desktop VM is running:
```bash
rdctl start
```

2. Build and run:
```bash
nerdctl compose up --build -d
```

3. Verify containers:
```bash
nerdctl compose ps
nerdctl compose logs api --tail 50
```

4. Access:
- Web: `http://localhost:5173`
- API: `http://localhost:8080/health`

5. Stop:
```bash
nerdctl compose down
```

Troubleshooting:
- If you see `Cannot connect to the Docker daemon at unix:///var/run/docker.sock`, use `nerdctl compose ...` instead of `docker compose ...`.
- If API exits with `ERR_MODULE_NOT_FOUND` for local imports, rebuild with:
```bash
nerdctl compose down
nerdctl compose up --build -d
```

## 6. CLI deployment mode

1. Build CLI:
```bash
npm run build -w @rum-tool/cli
```

2. Run scan with sample config:
```bash
node apps/cli/dist/apps/cli/src/index.js scan -c apps/cli/sample-config.yaml
```

3. Save report:
```bash
node apps/cli/dist/apps/cli/src/index.js scan -c apps/cli/sample-config.yaml -o report.json
```

4. Run synthetic local validation (20 generated state files, deterministic):
```bash
npm run synthetic:test -w @rum-tool/cli
```

4. Output includes:
- `summary.bucketsScanned`
- `summary.stateFilesParsed`
- `summary.totalRum`
- `summary.excludedResources`
- `byBucket[]`

## 7. UI feature walkthrough

### Wizard cards
- Step 1: Select cloud providers.
- Step 2: Enter provider-specific target details.
  - AWS: `S3 Bucket Name`, optional object prefix.
  - Azure: `Storage Account Name`, `Container Name`, optional blob prefix.
  - GCP: `GCS Bucket Name`, optional object prefix.
  - Local Directory: `Directory Path`, recursive toggle, file patterns.
- Step 3: Set dry-run, concurrency, max objects.
- Step 4: Optional execution environment variables (for example AWS region/profile and optional temporary credentials).
- Step 5: Review and run scan.

Security note:
- UI credential entry is optional but less secure than using ambient credentials/OIDC/instance roles.
- Sensitive inline values are redacted in scan records returned by API.

### Deployment actions
- `Deploy Local (Docker)` copies compose command. In Rancher Desktop environments, run the equivalent with `nerdctl compose`.
- `Deploy CLI Runner` copies CLI build/scan command.

### Dashboard
- KPI cards:
  - Latest run: Buckets Scanned, State Files Parsed, Total RUM, Excluded Resources, Parse Errors
  - Cumulative: Completed Runs, Buckets Scanned, State Files Parsed, Total RUM, Excluded Resources, Parse Errors
- Tables:
  - `RUM by bucket_name (Latest Run)`
  - `Scan History` (per-run status, totals, parse errors, error reason)

Cumulative logic:
- Cumulative metrics are de-duplicated by unique bucket key (`provider + bucketName`).
- Re-scanning the same bucket updates that bucket's latest snapshot rather than inflating totals.

### UI terminal
- Restricted command bridge (Phase 1 stub).
- Allowed commands: `scan`, `validate`, `export`, `help`.
- Designed to support CLI-oriented users from web UI.

## 8. API endpoints

- `GET /health`
- `POST /scans`
- `GET /scans`
- `GET /scans/:id`
- `GET /scans/:id/resources` (supports `status=all|included|excluded`, and `format=csv`)
- `GET /metrics/summary`
- `GET /metrics/cumulative`
- `GET /metrics/by-bucket`
- `GET /metrics/by-bucket-cumulative`
- `POST /terminal/exec` (restricted command stub)
- `POST /estimator/aws/runs`
- `POST /estimator/azure/runs`
- `POST /estimator/gcp/runs`
- `GET /estimator/runs`
- `GET /estimator/runs/:id`
- `GET /estimator/runs/:id/candidates` (supports `?format=csv`)
- `GET /estimator/runs/:id/non-manageable` (supports `?format=csv`)
- `GET /estimator/runs/:id/unmapped` (supports `?format=csv`)
- `GET /estimator/runs/:id/diagnostics`
- `GET /estimator/runs/:id/iam-remediation` (supports `?format=policy` for downloadable IAM policy JSON)
- `GET /estimator/mapping/aws`
- `GET /estimator/mapping/:provider` (`aws|azure|gcp`)

## 8.1 Persistence model

- Scan history is persisted to `data/scans.json`.
- On API startup, scan history is loaded from disk.
- This enables restart-safe history and cumulative metrics.

## 9. Security model for Phase 1

Implemented now:
- Terminal allowlist to prevent arbitrary command execution.
- Input schema validation on scan and terminal endpoints.

Planned for live cloud bucket expansion:
- Read-only cloud identities (least privilege).
- Short-lived federated credentials (OIDC/STS/Workload Identity).
- Audit logs for scans and terminal actions.
- Optional redaction mode (derived metadata only).

## 10. Test and validation steps

1. Run unit tests for RUM engine:
```bash
npm run test -w @rum-tool/rum-engine
```

2. Validate API health:
```bash
curl http://localhost:8080/health
```

3. Start scan via API:
```bash
curl -X POST http://localhost:8080/scans \
  -H 'Content-Type: application/json' \
  -d '{
    "providers": ["aws", "azure"],
    "targets": [
      {"provider": "aws", "bucketName": "customer-terraform-states"},
      {"provider": "azure", "storageAccountName": "tfstateaccount", "containerName": "tfstate", "prefix": "prod/"}
    ]
  }'
```

4. Fetch summary:
```bash
curl http://localhost:8080/metrics/summary
```

5. Generate deterministic synthetic state files for local validation:
```bash
node apps/cli/dist/apps/cli/src/index.js synthetic-generate --count 20 --min-rum 25 --max-rum 75 --seed 424242 --out fixtures/synthetic
```

6. Validate expected vs actual RUM from manifest:
```bash
node apps/cli/dist/apps/cli/src/index.js synthetic-validate --manifest fixtures/synthetic/manifest.json
```

7. Scan a local repository directory of state files:
```bash
node apps/cli/dist/apps/cli/src/index.js local-scan --dir fixtures/synthetic
```

8. API-based local accuracy validation (expected vs actual RUM):
```bash
scripts/tests/local_scan_accuracy.sh
```

9. API-based AWS accuracy validation with auto teardown:
```bash
scripts/tests/aws_scan_accuracy.sh
```

10. AWS unmanaged estimator smoke test:
```bash
scripts/tests/aws_unmanaged_estimator_smoke.sh
```

11. Refresh AWS mapping metadata against Terraform provider schema:
```bash
scripts/mappings/refresh_aws_mapping.sh ">= 6.0.0"
```

Note:
- Terraform state is JSON, so comments are not valid in `.tfstate.json`.
- Expected totals are stored in `fixtures/synthetic/manifest.json` for deterministic validation.

## 11. Moving from fixtures to real buckets (next step)

To begin AWS live testing:
1. Start API with `ENABLE_AWS_S3_SCAN=true`.
2. Provide IAM access for `s3:ListBucket` and `s3:GetObject` on approved bucket/prefix.
3. Set bucket and optional prefix in UI wizard.
4. Run scan and validate totals.
5. Tear down test bucket with `scripts/aws/cleanup_test_bucket.sh`.

Detailed runbook:
- [AWS UI Test Runbook](/Users/joelevingston/TFC%20RUM%20CALCULATOR%20TOOL/docs/AWS_UI_TEST_RUNBOOK.md)

Manual demo bucket lifecycle:
- Create demo bucket (persists until explicit teardown):
```bash
scripts/aws/setup_demo_bucket.sh
```
- Tear down demo bucket:
```bash
scripts/aws/teardown_demo_bucket.sh
```

Provider live-mode feature flags:
- AWS live mode: set `ENABLE_AWS_S3_SCAN=true` and ensure `aws` CLI is installed/authenticated.
- Azure live mode: set `ENABLE_AZURE_BLOB_SCAN=true` and ensure `az` CLI is installed/authenticated.
- GCP live mode: set `ENABLE_GCP_GCS_SCAN=true` and ensure `gsutil` CLI is installed/authenticated.
- AWS unmanaged estimator mode: set `ENABLE_AWS_UNMANAGED_ESTIMATOR=true`.
- Azure unmanaged estimator mode: set `ENABLE_AZURE_UNMANAGED_ESTIMATOR=true`.
- GCP unmanaged estimator mode: set `ENABLE_GCP_UNMANAGED_ESTIMATOR=true`.
- Local directory scan roots can be restricted via `LOCAL_SCAN_ALLOWED_ROOTS` (comma-separated absolute paths).
- Mapping freshness threshold days can be tuned via `ESTIMATOR_MAPPING_STALE_DAYS` (default `30`).
- If a provider live flag is not enabled, that provider uses fixture-mode scan behavior.

## 12. Troubleshooting

- `Cannot find module`:
  - Re-run `npm install` then `npm run build`.
- UI cannot reach API:
  - Ensure API runs on `8080` and `VITE_API_BASE` points to it.
- No dashboard values:
  - Start a scan first; metrics show zeros before first completed run.
- API build/start note:
  - Use `npm run dev -w @rum-tool/api` for runtime in this iteration.

## 13. Phase 1 deliverable checklist

- Shared RUM rules engine and tests.
- API scan + metrics endpoints.
- Card-based wizard and deployment buttons.
- Dashboard KPIs and RUM-by-bucket table.
- CLI parity path.
- Deployment/explainer documentation.
