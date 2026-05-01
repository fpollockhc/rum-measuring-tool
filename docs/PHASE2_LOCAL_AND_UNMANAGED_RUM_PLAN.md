# Phase 2 Plan: Local State + Unmanaged Resource RUM Estimator

## Scope

This plan covers two additions:

1. Add `Local Directory` scanning as a source option in the existing managed-state workflow.
2. Add a new UI tab for `Unmanaged Resource RUM Estimator` (AWS prototype first), then Azure, then GCP.

## Why this approach

- Local directory scanning closes a real onboarding gap for teams without remote backends.
- Unmanaged estimation addresses pre-IaC or partial-IaC customers.
- We keep output explainable by classifying every discovered resource with a reason code.

## Sources consulted (current)

- Terraform import overview and command docs:
  - https://developer.hashicorp.com/terraform/cli/import
  - https://developer.hashicorp.com/terraform/cli/commands/import
- AWS Resource Groups Tagging API:
  - https://docs.aws.amazon.com/resourcegroupstagging/latest/APIReference/API_GetResources.html
  - https://docs.aws.amazon.com/resourcegroupstagging/latest/APIReference/supported-services.html
  - https://docs.aws.amazon.com/cli/latest/reference/resourcegroupstaggingapi/get-resources.html
- Azure Resource Graph references:
  - https://learn.microsoft.com/azure/governance/resource-graph/overview
  - https://learn.microsoft.com/azure/governance/resource-graph/concepts/query-language
  - https://learn.microsoft.com/azure/governance/resource-graph/reference/supported-tables-resources
- GCP Cloud Asset Inventory:
  - https://cloud.google.com/asset-inventory/docs/search-resources
  - https://cloud.google.com/asset-inventory/docs/reference/rest/v1/TopLevel/searchAllResources
- Open-source inspiration:
  - Terraformer: https://github.com/GoogleCloudPlatform/terraformer
  - Terracognita: https://github.com/cycloidio/terracognita

## Key constraints and principles

- `Managed RUM` and `Estimated Potential RUM` are different products; do not blend metrics.
- Estimator output must be explicitly labeled as estimated.
- Every non-counted resource should have a deterministic reason code.
- Keep provider adapters isolated behind a common interface.

---

## Track A: Local Directory Source

### Product changes

- In providers/source step, add selectable source: `Local Directory`.
- Targets step for local source:
  - `directoryPath` (required)
  - `recursive` (default true)
  - `patterns` (default `*.tfstate`, `*.tfstate.json`)
  - optional `maxFiles`, `maxFileSizeMB`

### API contract changes

Request target model (add local variant):

- `provider: "local"`
- `directoryPath: string`
- `recursive?: boolean`
- `patterns?: string[]`
- `maxFiles?: number`

### Backend implementation

- Add `scanLocalDirectory(target)` adapter.
- Reuse existing state parser + RUM engine (no logic fork).
- Capture per-file parse errors and continue.

### Security / safety

- Path allowlist root via env (`LOCAL_SCAN_ALLOWED_ROOTS`).
- Reject traversal outside allowed roots.
- Per-file size guard.

### Acceptance criteria

- Local source is selectable in UI and runnable.
- Results appear in latest/cumulative/history with same schema.
- Cumulative dedup key for local: `local:<normalizedDirectoryPath>`.

---

## Track B: New Tab - Unmanaged Resource RUM Estimator

## UX (new tab)

Tab name: `Unmanaged Estimator`

Panels:
- Scope inputs (account/org/tenant/subscription scope, regions, tag filters)
- Credentials/auth mode inputs
- Scan controls (`dry-run`, service filters, max resources)
- Results dashboard:
  - discovered resources
  - estimated RUM candidates
  - non-RUM/non-manageable
  - unknown/unmapped
- Tables:
  - `RUM-qualified candidates`
  - `Non-RUM / Not-manageable resources` with reason
  - `Unmapped resource types`

## AWS prototype architecture

### Discovery

Phase B1 (fast baseline):
- Use `resourcegroupstaggingapi get-resources` per selected region.
- Note: this can miss untagged resource discovery, so mark coverage limitations.

Phase B2 (coverage hardening):
- Add service-specific enumerators for priority gaps and untagged resources.
- Merge and deduplicate by ARN.

### Normalize

Canonical row:
- `provider` (`aws`)
- `resourceId` (ARN)
- `service`
- `resourceType`
- `region`
- `accountId`
- `tags`
- `source` (`tagging_api` or service-specific)

### Classify + estimate

- Use mapping catalog: AWS discovered type -> Terraform AWS provider resource type(s).
- For each row produce:
  - `classification`: `rum_candidate | excluded | not_manageable | unmapped`
  - `reasonCode`
  - optional `terraformResourceType`

### Reason codes (initial)

- `MAPPED_MANAGEABLE`
- `EXCLUDED_NULL_RESOURCE_EQUIVALENT` (if ever relevant)
- `EXCLUDED_TERRAFORM_DATA_EQUIVALENT`
- `NOT_SUPPORTED_BY_PROVIDER`
- `UNMAPPED_TYPE`
- `DISCOVERY_LIMITATION_UNTAGGED`
- `INSUFFICIENT_SCOPE_PERMISSIONS`

## Mapping strategy

Create versioned mapping data file:
- `data/mappings/aws_resource_to_tf.json`

Fields:
- `match`: ARN pattern or service/type pair
- `terraformType`
- `rumEligible: boolean`
- `notes`
- `confidence`

## Should we integrate Terraformer directly?

Recommendation: **Do not hard-depend on Terraformer in core path**.

Reasoning:
- Terraformer is useful for reverse-IaC generation, not specifically RUM estimation.
- It introduces execution complexity and dependency risk for runtime service.
- Better approach: borrow concepts:
  - mapping coverage tracking
  - provider-driven type support thinking
  - best-effort classification with explicit limitations

Optional later:
- add Terraformer-assisted mode as experimental export path.

---

## Data model additions

New estimator run model:
- `estimatorRuns` table/store
- status lifecycle like scans (`queued/running/completed/failed`)
- scope metadata
- summary metrics
- result artifacts (candidates/non-manageable/unmapped)

Persistence:
- start with JSON file parity (`data/estimator-runs.json`)
- move to SQLite/Postgres when volume grows

---

## API proposals (new)

- `POST /estimator/aws/runs`
- `GET /estimator/runs`
- `GET /estimator/runs/:id`
- `GET /estimator/runs/:id/summary`
- `GET /estimator/runs/:id/candidates`
- `GET /estimator/runs/:id/non-manageable`
- `GET /estimator/runs/:id/unmapped`

---

## Implementation phases

### Phase 2.1 (small)
- Local Directory source end-to-end.
- Tests + docs.

### Phase 2.2 (AWS estimator MVP)
- New tab shell + run creation + status polling.
- AWS discovery via tagging API.
- Initial mapping for top services.
- Explainability reason codes and exports.

### Phase 2.3 (AWS hardening)
- Untagged/service-specific enumerators for gaps.
- Coverage dashboard and confidence scoring.
- Performance tuning and pagination controls.

### Phase 2.4
- Azure estimator prototype using Resource Graph.

### Phase 2.5
- GCP estimator prototype using Cloud Asset Inventory.

---

## Testing strategy

- Unit: mapping + classifier reason code coverage.
- Fixture integration: synthetic inventories with expected classifications.
- Cloud integration: controlled test accounts with teardown scripts.
- Regression: stable snapshots for summary counts and reason-code distributions.

---

## Immediate next build order

1. Implement Local Directory source in existing scan flow.
2. Add Unmanaged Estimator tab scaffolding + AWS run endpoint skeleton.
3. Build AWS discovery adapter and mapping v0.
4. Add candidate/non-manageable tables and CSV/JSON export.
