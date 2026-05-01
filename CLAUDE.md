# TFC RUM Calculator Tool

Internal HashiCorp presales productivity tool for estimating Terraform **Resources Under Management (RUM)** — the billing metric for HCP Terraform Cloud and (soon) Terraform Enterprise.

## Monorepo Layout

```
apps/web         → React 18 + Carbon Design System + Vite (port 5173)
apps/api         → Express.js API server (port 8080)
apps/cli         → Commander-based CLI tool
packages/rum-engine → Shared core RUM calculation engine (zero dependencies)
data/mappings/   → Versioned AWS/Azure/GCP resource→Terraform type mappings (JSON)
fixtures/        → Test data: synthetic tfstate files, demo states
scripts/tests/   → Shell-based integration/accuracy tests
```

## Commands

```bash
npm run dev          # Start all workspaces in dev mode
npm run build        # Build all workspaces
npm run test         # Run all workspace tests (Vitest)
npm run lint         # Lint all workspaces
docker compose up    # Production deployment (web:80, api:8080)
```

## Key Architectural Patterns

- **Fire-and-forget async jobs**: POST endpoints return 202 with a record ID. Client polls GET endpoint until status is `completed` or `failed`. Jobs run via `void runXxxJob(id, request)`.
- **In-memory Map + JSON file persistence**: Each domain (scans, estimator runs, TFE migrations) uses a `Map<string, Record>` with `writeFileSync` to `data/*.json`. Loaded from disk on startup.
- **Zod validation**: All API inputs validated with Zod schemas in `server.ts` before processing.
- **Credential redaction**: Sensitive fields (AWS keys, tokens, GCP creds) MUST be redacted via `redactSensitiveXxxFields()` before storing in any record. Credentials are passed to jobs from the original request, never persisted.

## Environment Variables

| Variable | Purpose |
|---|---|
| `PORT` | API server port (default: 8080) |
| `LOCAL_SCAN_ALLOWED_ROOTS` | Comma-separated allowlist for local directory scanning |
| `ESTIMATOR_MAPPING_STALE_DAYS` | Days before mapping is flagged stale (default: 30) |
| `AWS_REGION`, `AWS_PROFILE` | AWS CLI defaults |
| `GOOGLE_APPLICATION_CREDENTIALS` | GCP service account key path |

## Testing

- **Unit tests**: Vitest — `npm run test` in each workspace
- **Integration tests**: Shell scripts in `scripts/tests/` (local_scan_accuracy.sh, aws_scan_accuracy.sh, aws_unmanaged_estimator_smoke.sh)
- **Fixtures**: `fixtures/synthetic/` has 20 tfstate files with known RUM counts for validation

## Naming Conventions

- Filenames: `kebab-case.ts`
- React components: `PascalCase.tsx`
- Functions/variables: `camelCase`
- Types: `PascalCase`
- API routes: `kebab-case` paths

## Security Rules

- Never persist raw credentials in any store or log output
- Always redact before storing scan/estimator/migration records
- Local directory scanning is sandboxed via `LOCAL_SCAN_ALLOWED_ROOTS`
- TFE tokens are single-use: passed to job, never returned in responses
