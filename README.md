# TFC RUM Calculator Tool

Internal HashiCorp presales productivity tool for estimating Terraform **Resources Under Management (RUM)** — the billing metric for HCP Terraform Cloud and Terraform Enterprise.

## Quick Start

```bash
# Native development
npm install
npm run dev          # Web UI on :5173, API on :8080

# Container deployment (Rancher Desktop / nerdctl)
nerdctl compose up --build -d   # Web on :5173, API on :8080
nerdctl compose down

# Docker deployment
docker compose up --build -d
```

## Architecture

```
apps/web           → React 18 + Carbon Design System + Vite (port 5173)
apps/api           → Express.js API server (port 8080)
apps/cli           → Commander-based CLI tool (rumctl)
packages/rum-engine → Shared RUM calculation engine (zero dependencies)
data/mappings/     → Versioned AWS/Azure/GCP resource→Terraform type mappings
fixtures/          → Test data: synthetic tfstate files, demo states
scripts/tests/     → Shell-based integration/accuracy tests
```

## Features

### Managed State Scanning
Scan cloud storage backends and local directories to calculate RUM from existing Terraform state files.

- **AWS S3** — paginated bucket scanning via AWS CLI
- **Azure Blob Storage** — container scanning via Azure CLI
- **GCP Cloud Storage** — recursive bucket scanning via gsutil
- **Local Directory** — filesystem scanning with configurable patterns and path allowlisting

### Unmanaged Resource Estimator
Discover cloud resources not yet managed by Terraform and estimate potential RUM impact.

- Scope-driven resource discovery across AWS, Azure, and GCP
- Terraform-manageability classification using versioned mapping files
- Estimated candidate RUM summary with per-resource-type breakdown
- Permission diagnostics with suggested IAM remediation policies
- Mapping freshness tracking with configurable staleness threshold

### TFE / TFC Migration Estimator

Terraform Enterprise is transitioning to the same RUM-based billing model that HCP Terraform Cloud already uses. This tool helps presales engineers answer the critical customer question: **"What will my RUM bill look like after migration?"**

The estimator connects directly to any **Terraform Enterprise** or **HCP Terraform Cloud** instance using the same [TFE API v2](https://developer.hashicorp.com/terraform/cloud-docs/api-docs), making it fully bidirectional:

| Migration Path | Use Case |
|---|---|
| **TFE → TFC** | Customer moving from self-hosted TFE to HCP Terraform Cloud — estimate their new RUM-based bill |
| **TFC → TFE** | Customer evaluating self-hosted TFE — understand current RUM footprint before migration |
| **TFE → TFE** | Customer on TFE preparing for upcoming RUM billing — preview what their bill will be |
| **TFC audit** | Validate current TFC RUM counts against what the billing portal shows |

#### How It Works

1. **Connect** — Provide the TFE/TFC hostname (e.g., `tfe.customer.com` or `app.terraform.io`), an API token with workspace read access, and the organization name
2. **Scope** — Optionally filter by project to estimate a subset of workspaces
3. **Scan** — The tool enumerates all workspaces via the API, downloads the current state version for each, and passes it through the shared RUM calculation engine
4. **Results** — Per-workspace RUM breakdown with Billable RUM, Non-Billable resources, and module-level analysis. Sortable and exportable.

#### Requirements

- A **User**, **Team**, or **Organization** API token with at least read access to workspaces and state versions
- Network connectivity from the tool to the TFE/TFC instance (for on-prem TFE, the tool must be run on a machine that can reach the TFE hostname)
- For self-signed TLS certificates (common with on-prem TFE), the `NODE_EXTRA_CA_CERTS` environment variable can be set

#### Technical Details

- Connects via TFE API v2 with Bearer token authentication
- Enumerates workspaces with optional project-level filtering
- Downloads current state versions and calculates RUM per workspace
- Per-workspace results table sortable by RUM count
- Handles pagination and rate limiting with exponential backoff
- Credential redaction — tokens are never persisted or returned in API responses
- Module-level RUM breakdown per workspace for migration planning

### Combined RUM Summary
Always-visible banner aggregating RUM totals across all three scan modes.

- Total Billable RUM, Non-Billable, and Total Resources
- Color-coded stacked bar visualization by source (managed, unmanaged, TFE)
- Auto-polls and updates as new scans complete

### Module Structure Analysis
Per-module RUM breakdown extracted from Terraform state resource addresses.

- Supports arbitrarily nested modules (e.g., `module.env.module.stack.aws_instance.web`)
- Sorted by RUM count descending for quick identification of high-impact modules
- Available in both managed scan and TFE migration results

## API Endpoints

| Method | Path | Description |
|---|---|---|
| `POST` | `/scans` | Start a managed state scan |
| `GET` | `/scans` | List all scans |
| `GET` | `/scans/:id` | Get scan status and results |
| `POST` | `/estimator/runs` | Start an unmanaged resource estimation |
| `GET` | `/estimator/runs` | List all estimator runs |
| `GET` | `/estimator/runs/:id` | Get estimator run results |
| `GET` | `/estimator/runs/:id/diagnostics` | Mapping coverage diagnostics |
| `GET` | `/estimator/mapping/:provider` | Mapping freshness metadata |
| `POST` | `/tfe/migration/runs` | Start a TFE migration estimate |
| `GET` | `/tfe/migration/runs` | List all migration runs |
| `GET` | `/tfe/migration/runs/:id` | Get migration run results |
| `GET` | `/tfe/migration/runs/:id/modules` | Module breakdown for a migration |
| `GET` | `/metrics/combined-summary` | Aggregated RUM across all sources |
| `GET` | `/health` | Health check |

## Testing

```bash
npm run test         # Run all unit tests (50 tests across rum-engine + API)
npm run build        # Build all workspaces
npm run lint         # Lint all workspaces
```

### Integration / Accuracy Tests

- `scripts/tests/local_scan_accuracy.sh` — Local managed scan accuracy
- `scripts/tests/aws_scan_accuracy.sh` — AWS managed scan accuracy
- `scripts/tests/aws_unmanaged_estimator_smoke.sh` — AWS unmanaged estimator smoke test

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `8080` | API server port |
| `NODE_ENV` | — | `production` or `development` |
| `LOG_LEVEL` | `debug` (dev) / `info` (prod) | Pino log level |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:80` | Allowed CORS origins |
| `LOCAL_SCAN_ALLOWED_ROOTS` | workspace root | Comma-separated directory allowlist |
| `ESTIMATOR_MAPPING_STALE_DAYS` | `30` | Days before mapping is flagged stale |
| `ENABLE_AWS_S3_SCAN` | — | Enable live AWS S3 scanning |
| `ENABLE_AZURE_BLOB_SCAN` | — | Enable live Azure Blob scanning |
| `ENABLE_GCP_GCS_SCAN` | — | Enable live GCP GCS scanning |

See [`.env.example`](.env.example) for the full list including cloud provider credentials.

## Production Hardening

- **Docker**: Multi-stage builds, non-root containers, health checks, resource limits
- **Security**: Helmet.js headers, CORS origin restriction, credential redaction
- **Logging**: Pino structured JSON logging with request IDs
- **Persistence**: Atomic file writes (write-to-temp + rename) for crash safety
- **Validation**: Zod schemas on all API inputs

## Mapping Freshness

Resource-to-Terraform type mappings are versioned in `data/mappings/`:
- `aws_resource_to_tf.json`
- `azure_resource_to_tf.json`
- `gcp_resource_to_tf.json`

Refresh with: `scripts/mappings/refresh_aws_mapping.sh ">= 6.0.0"`

## Demo Bucket Workflow

```bash
# Create persistent demo bucket from fixtures
scripts/aws/setup_demo_bucket.sh

# Tear down when finished
scripts/aws/teardown_demo_bucket.sh
```

## Docs

- [Deployment And Explainer](docs/DEPLOYMENT_AND_EXPLAINER.md)
- [AWS UI Test Runbook](docs/AWS_UI_TEST_RUNBOOK.md)
- [Phase 2 Local + Unmanaged RUM Plan](docs/PHASE2_LOCAL_AND_UNMANAGED_RUM_PLAN.md)
