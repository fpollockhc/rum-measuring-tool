# API Server (apps/api)

Express.js backend serving three domains: managed state scanning, unmanaged estimation, and TFE migration.

## Route Structure

| Prefix | Domain | Job File |
|---|---|---|
| `/scans/*` | Managed state scanning | `rum-job.ts` |
| `/estimator/*` | Unmanaged resource estimation | `estimator-job.ts` |
| `/tfe/*` | TFE-to-TFC migration | `tfe-job.ts` |

## Adding a New Domain (Pattern)

1. Create types in `xxx-types.ts`
2. Create store in `xxx-store.ts` (copy `store.ts` pattern: Map + JSON persistence)
3. Create job in `xxx-job.ts` (async function, updates store on completion/failure)
4. Add Zod schema + routes in `server.ts`
5. Add credential redaction function if the request includes sensitive fields

## Job Lifecycle

```
POST → Zod validate → createRecord(redactedRequest) → void runJob(id, originalRequest) → 202
Job: updateRecord(id, {status: "running"}) → do work → updateRecord(id, {status: "completed", summary, ...})
Client: poll GET /xxx/:id every 1s until status !== "queued" && status !== "running"
```

## Store Pattern

Each store module exports: `create*`, `update*`, `get*`, `list*`. Backed by in-memory `Map<string, Record>` with JSON file sync to `data/`.

## Key Files

- `server.ts` — All routes, Zod schemas, redaction functions
- `types.ts` — Managed scan types
- `estimator-types.ts` — Unmanaged estimator types
- `store.ts` / `estimator-store.ts` — Persistence layers
- `rum-job.ts` — Managed state scanning (cloud CLI → download → rum-engine)
- `estimator-job.ts` — Unmanaged resource discovery (cloud CLI → classify → diagnostics)
- `estimator-analysis.ts` — Pure classification/diagnostic functions
- `estimator-mapping.ts` — Mapping file loading with freshness tracking
