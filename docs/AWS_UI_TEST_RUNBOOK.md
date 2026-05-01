# AWS UI Test Runbook (with teardown)

This runbook validates the UI workflow against real S3 state files and ensures all AWS test data is removed after testing.

## Prerequisites

- AWS credentials exported in your shell (`AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, optional `AWS_SESSION_TOKEN`).
- Region exported (`AWS_REGION` or `AWS_DEFAULT_REGION`).
- API and web services running locally.

## 1. Build synthetic state files

```bash
npm run synthetic:test -w @rum-tool/cli
```

This creates 20 deterministic files in `fixtures/synthetic/` and a manifest with expected RUM totals.

## 2. Enable real AWS S3 scanning in API

Start API with feature flag:

```bash
ENABLE_AWS_S3_SCAN=true npm run dev -w @rum-tool/api
```

Start web app in another terminal if needed:

```bash
npm run dev -w @rum-tool/web
```

## 3. Create test bucket and upload synthetic files

```bash
scripts/aws/setup_test_bucket.sh
```

Output includes:
- test bucket name
- suggested UI values (`bucketName`, `prefix=synthetic/`)

## 4. Run scan from UI

Open `http://localhost:5173` and use wizard:
- Providers: `AWS`
- Bucket / Container Name: value from setup script
- Prefix: `synthetic/`
- Click `Run Scan`

Validate dashboard:
- `State Files Parsed` should be 20.
- `Total RUM` should equal `aggregateExpectedRum` in `fixtures/synthetic/manifest.json` (default: 1045).
- `Parse Errors` should be 0.
- Wizard status panel should show `queued` -> `running` -> `completed` (or `failed` with error text).

## 5. Tear down AWS test resources immediately

```bash
scripts/aws/cleanup_test_bucket.sh
```

If needed, pass the bucket explicitly:

```bash
scripts/aws/cleanup_test_bucket.sh <bucket-name>
```

## Optional: one-command API smoke test with automatic cleanup

This script creates bucket + uploads files + calls API + always cleans up on exit.

```bash
ENABLE_AWS_S3_SCAN=true scripts/aws/run_api_s3_smoke.sh
```

## Safety notes

- Use only synthetic/dummy state files for testing.
- Do not enable S3 versioning on the test bucket for this workflow.
- Cleanup script is designed to run immediately after test completion.
