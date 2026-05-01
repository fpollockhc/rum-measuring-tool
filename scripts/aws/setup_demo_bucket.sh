#!/usr/bin/env bash
set -euo pipefail

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required." >&2
  exit 1
fi

REGION="${AWS_REGION:-${AWS_DEFAULT_REGION:-us-east-1}}"
PREFIX="${1:-rum-demo}"
BUCKET_NAME="${PREFIX}-$(date +%Y%m%d%H%M%S)-$RANDOM"
SOURCE_DIR="fixtures/demo"
MARKER_FILE=".aws-demo-bucket"

if [[ ! -d "$SOURCE_DIR" ]]; then
  echo "Demo directory '$SOURCE_DIR' not found." >&2
  exit 1
fi

if [[ "$REGION" == "us-east-1" ]]; then
  aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" >/dev/null
else
  aws s3api create-bucket --bucket "$BUCKET_NAME" --region "$REGION" \
    --create-bucket-configuration LocationConstraint="$REGION" >/dev/null
fi

aws s3 cp "$SOURCE_DIR" "s3://$BUCKET_NAME/demo/" --recursive >/dev/null

echo "$BUCKET_NAME" > "$MARKER_FILE"

echo "Created demo bucket: $BUCKET_NAME"
echo "Uploaded demo tfstate files to: s3://$BUCKET_NAME/demo/"
echo "Marker file: $MARKER_FILE"
echo "Use in UI: bucket=$BUCKET_NAME prefix=demo/"
