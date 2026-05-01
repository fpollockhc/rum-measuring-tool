#!/usr/bin/env bash
set -euo pipefail

if ! command -v curl >/dev/null 2>&1; then
  echo "curl is required." >&2
  exit 1
fi

API_BASE="${API_BASE:-http://localhost:8080}"

cleanup() {
  scripts/aws/cleanup_test_bucket.sh "$BUCKET_NAME" || true
}

scripts/aws/setup_test_bucket.sh "rum-ui-test"
BUCKET_NAME="$(cat .aws-test-bucket)"
trap cleanup EXIT

REQUEST_PAYLOAD=$(cat <<JSON
{
  "providers": ["aws"],
  "targets": [
    {"provider": "aws", "bucketName": "$BUCKET_NAME", "prefix": "synthetic/"}
  ],
  "options": {"maxObjects": 1000}
}
JSON
)

SCAN_ID=$(curl -sS -X POST "$API_BASE/scans" \
  -H 'Content-Type: application/json' \
  -d "$REQUEST_PAYLOAD" | sed -n 's/.*"id":"\([^"]*\)".*/\1/p')

if [[ -z "$SCAN_ID" ]]; then
  echo "Failed to create scan via API." >&2
  exit 1
fi

echo "Created scan: $SCAN_ID"

for _ in $(seq 1 30); do
  STATUS=$(curl -sS "$API_BASE/scans/$SCAN_ID" | sed -n 's/.*"status":"\([^"]*\)".*/\1/p')
  if [[ "$STATUS" == "completed" ]]; then
    break
  fi
  if [[ "$STATUS" == "failed" ]]; then
    echo "Scan failed." >&2
    exit 1
  fi
  sleep 1

done

echo "Scan status: $STATUS"
curl -sS "$API_BASE/scans/$SCAN_ID"
