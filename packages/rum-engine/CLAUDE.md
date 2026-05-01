# RUM Engine (packages/rum-engine)

Core RUM calculation library. MUST remain dependency-free and side-effect-free.

## RUM Counting Rules

1. Only `mode: "managed"` resources count toward RUM
2. `mode: "data"` resources are always excluded
3. `null_resource` and `terraform_data` types are always excluded regardless of mode
4. RUM = sum of `instances.length` across all counted resources
5. Module nesting does NOT affect RUM counting — `module.a.module.b.aws_instance.x` counts the same as root-level `aws_instance.x`

## Exports

- `calculateRumFromState(state: TerraformState): RumResult` — Main calculation
- `parseTerraformState(raw: string): TerraformState` — JSON parse wrapper
- Types: `TerraformState`, `TerraformResource`, `RumResult`, `ResourceEvaluation`, `ExclusionReason`

## Rules for Changes

- No runtime dependencies — this package must work in any context (API, CLI, browser)
- All functions must be pure (no I/O, no side effects)
- Every resource gets an evaluation entry regardless of whether it's counted
- Test new logic in `test/rum-engine.test.ts`
