#!/usr/bin/env bash
set -euo pipefail

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required." >&2
  exit 1
fi

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
PREFIX="${1:-rum-ui-test}"
BUCKET_NAME="${PREFIX}-$(date +%Y%m%d%H%M%S)-$RANDOM"
STATE_DIR="fixtures/synthetic"
MARKER_FILE=".aws-test-bucket"

if [[ ! -d "$STATE_DIR" ]]; then
  echo "Synthetic directory '$STATE_DIR' not found. Run: npm run synthetic:test -w @rum-tool/cli" >&2
  exit 1
fi

if [[ "$REGION" == "us-east-1" ]]; then
  aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" >/dev/null
else
  aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
fi

aws s3 cp "$STATE_DIR" "s3://$BUCKET_NAME/synthetic/" --recursive --exclude "manifest.json" >/dev/null

echo "$BUCKET_NAME" > "$MARKER_FILE"

echo "Created test bucket: $BUCKET_NAME"
echo "Uploaded synthetic tfstate files to: s3://$BUCKET_NAME/synthetic/"
echo "Saved bucket marker to: $MARKER_FILE"
echo "Use this in UI wizard:"
echo "  Bucket/Container Name: $BUCKET_NAME"
echo "  Prefix (optional): synthetic/"
