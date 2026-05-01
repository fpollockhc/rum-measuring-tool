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
REGIONS="${1:-us-east-1}"

MAPPING_JSON=$(curl -sS "$API_BASE/estimator/mapping/aws")
HAS_MAPPING_VERSION=$(echo "$MAPPING_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(d.mappingVersion ? 'yes' : 'no')")
if [[ "$HAS_MAPPING_VERSION" != "yes" ]]; then
  echo "FAIL mapping metadata missing mappingVersion: $MAPPING_JSON" >&2
  exit 1
fi

echo "Mapping metadata available."

REQUEST_PAYLOAD=$(cat <<JSON
{
  "scope": {
    "regions": [$(echo "$REGIONS" | awk -F',' '{for(i=1;i<=NF;i++){gsub(/^ +| +$/,"",$i); printf "%s\"%s\"", (i>1?",":""), $i}}')]
  }
}
JSON
)

RUN_JSON=$(curl -sS -X POST "$API_BASE/estimator/aws/runs" \
  -H 'Content-Type: application/json' \
  -d "$REQUEST_PAYLOAD")
RUN_ID=$(echo "$RUN_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(d.id||'')")

if [[ -z "$RUN_ID" ]]; then
  echo "FAIL estimator run not created: $RUN_JSON" >&2
  exit 1
fi

echo "Created estimator run: $RUN_ID"

for _ in $(seq 1 90); do
  STATUS_JSON=$(curl -sS "$API_BASE/estimator/runs/$RUN_ID")
  STATUS=$(echo "$STATUS_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(d.status||'')")

  if [[ "$STATUS" == "completed" ]]; then
    DISCOVERED=$(echo "$STATUS_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(String(d.summary?.discoveredResources ?? -1))")
    CANDIDATES=$(echo "$STATUS_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(String(d.summary?.rumCandidates ?? -1))")
    MAPPING_VERSION=$(echo "$STATUS_JSON" | node -e "const fs=require('fs');const d=JSON.parse(fs.readFileSync(0,'utf8'));process.stdout.write(d.mapping?.mappingVersion || '')")
    if [[ "$DISCOVERED" == "-1" || "$CANDIDATES" == "-1" || -z "$MAPPING_VERSION" ]]; then
      echo "FAIL estimator summary incomplete: $STATUS_JSON" >&2
      exit 1
    fi
    echo "PASS estimator smoke: discovered=$DISCOVERED candidates=$CANDIDATES mappingVersion=$MAPPING_VERSION"
    exit 0
  fi

  if [[ "$STATUS" == "failed" ]]; then
    echo "FAIL estimator run failed: $STATUS_JSON" >&2
    exit 1
  fi

  sleep 1
done

echo "FAIL estimator run timed out" >&2
exit 1
