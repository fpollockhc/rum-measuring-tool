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
LOCAL_DIR="${2:-fixtures/synthetic}"

if [[ ! -f "$MANIFEST_PATH" ]]; then
  echo "Manifest not found at $MANIFEST_PATH" >&2
  exit 1
fi

EXPECTED_TOTAL=$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String(m.aggregateExpectedRum));" "$MANIFEST_PATH")
EXPECTED_FILES=$(node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8')); process.stdout.write(String((m.files||[]).length));" "$MANIFEST_PATH")

REQUEST_PAYLOAD=$(cat <<JSON
{
  "providers": ["local"],
  "targets": [
    {
      "provider": "local",
      "directoryPath": "$LOCAL_DIR",
      "recursive": true,
      "patterns": ["*.tfstate.json"]
    }
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

echo "Created local scan: $SCAN_ID"

for _ in $(seq 1 60); do
  RUN_JSON=$(curl -sS "$API_BASE/scans/$SCAN_ID")
  STATUS=$(echo "$RUN_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(d.status||'')")
  if [[ "$STATUS" == "completed" ]]; then
    ACTUAL_TOTAL=$(echo "$RUN_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(String(d.summary?.totalRum??-1))")
    ACTUAL_FILES=$(echo "$RUN_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(String(d.summary?.stateFilesParsed??-1))")
    if [[ "$ACTUAL_TOTAL" != "$EXPECTED_TOTAL" || "$ACTUAL_FILES" != "$EXPECTED_FILES" ]]; then
      echo "FAIL local accuracy: expected total=$EXPECTED_TOTAL files=$EXPECTED_FILES, actual total=$ACTUAL_TOTAL files=$ACTUAL_FILES" >&2
      exit 1
    fi
    echo "PASS local accuracy: totalRum=$ACTUAL_TOTAL stateFiles=$ACTUAL_FILES"
    exit 0
  fi
  if [[ "$STATUS" == "failed" ]]; then
    echo "FAIL local scan failed: $RUN_JSON" >&2
    exit 1
  fi
  sleep 1
done

echo "FAIL local scan timed out" >&2
exit 1
