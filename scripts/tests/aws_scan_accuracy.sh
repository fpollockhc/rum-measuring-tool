#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi
if ! command -v node >/dev/null 2>&1; then
  echo "node is required." >&2
  exit 1
fi

API_BASE="${API_BASE:-http://localhost:8080}"
MANIFEST_PATH="${1:-fixtures/synthetic/manifest.json}"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Manifest not found at $MANIFEST_PATH" >&2
  exit 1
fi

if [[ "${ENABLE_AWS_S3_SCAN:-}" != "true" ]]; then
  echo "ENABLE_AWS_S3_SCAN is not true in current shell. Start API with ENABLE_AWS_S3_SCAN=true." >&2
fi

EXPECTED_TOTAL=$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(m.aggregateExpectedRum));" "$MANIFEST_PATH")
EXPECTED_FILES=$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String((m.files||[]).length));" "$MANIFEST_PATH")

cleanup() {
  scripts/aws/cleanup_test_bucket.sh "$BUCKET_NAME" || true
}

scripts/aws/setup_test_bucket.sh "rum-accuracy-test"
BUCKET_NAME="$(cat .aws-test-bucket)"
trap cleanup EXIT

REQUEST_PAYLOAD=$(cat <<JSON
{
  "providers": ["aws"],
  "targets": [
    {"provider": "aws", "bucketName": "$BUCKET_NAME", "prefix": "synthetic/"}
  ],
  "options": {"maxObjects": 10000}
}
JSON
)

SCAN_JSON=$(curl -sS -X POST "$API_BASE/scans" -H 'Content-Type: application/json' -d "$REQUEST_PAYLOAD")
SCAN_ID=$(echo "$SCAN_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(d.id||'')")

if [[ -z "$SCAN_ID" ]]; then
  echo "Failed to create scan. Response: $SCAN_JSON" >&2
  exit 1
fi

echo "Created AWS scan: $SCAN_ID (bucket $BUCKET_NAME)"

for _ in $(seq 1 90); do
  RUN_JSON=$(curl -sS "$API_BASE/scans/$SCAN_ID")
  STATUS=$(echo "$RUN_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(d.status||'')")
  if [[ "$STATUS" == "completed" ]]; then
    ACTUAL_TOTAL=$(echo "$RUN_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(String(d.summary?.totalRum??-1))")
    ACTUAL_FILES=$(echo "$RUN_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(String(d.summary?.stateFilesParsed??-1))")
    PARSE_ERRORS=$(echo "$RUN_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(String(d.summary?.parseErrors??-1))")

    if [[ "$ACTUAL_TOTAL" != "$EXPECTED_TOTAL" || "$ACTUAL_FILES" != "$EXPECTED_FILES" || "$PARSE_ERRORS" != "0" ]]; then
      echo "FAIL aws accuracy: expected total=$EXPECTED_TOTAL files=$EXPECTED_FILES parseErrors=0, actual total=$ACTUAL_TOTAL files=$ACTUAL_FILES parseErrors=$PARSE_ERRORS" >&2
      exit 1
    fi
    echo "PASS aws accuracy: totalRum=$ACTUAL_TOTAL stateFiles=$ACTUAL_FILES parseErrors=$PARSE_ERRORS"
    exit 0
  fi
  if [[ "$STATUS" == "failed" ]]; then
    echo "FAIL aws scan failed: $RUN_JSON" >&2
    exit 1
  fi
  sleep 1
done

echo "FAIL aws scan timed out" >&2
exit 1
