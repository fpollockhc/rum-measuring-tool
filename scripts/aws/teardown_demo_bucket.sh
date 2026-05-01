#!/usr/bin/env bash
set -euo pipefail

if ! command -v aws >/dev/null 2>&1; then
  echo "aws CLI is required." >&2
  exit 1
fi

MARKER_FILE=".aws-demo-bucket"
BUCKET_NAME="${1:-}"

if [[ -z "$BUCKET_NAME" && -f "$MARKER_FILE" ]]; then
  BUCKET_NAME="$(cat "$MARKER_FILE")"
fi

if [[ -z "$BUCKET_NAME" ]]; then
  echo "Bucket name not provided and $MARKER_FILE not found." >&2
  exit 1
fi

aws s3 rm "s3://$BUCKET_NAME" --recursive >/dev/null 2>&1 || true
aws s3api delete-bucket --bucket "$BUCKET_NAME" >/dev/null

if [[ -f "$MARKER_FILE" ]] && [[ "$(cat "$MARKER_FILE")" == "$BUCKET_NAME" ]]; then
  rm -f "$MARKER_FILE"
fi

echo "Deleted demo bucket: $BUCKET_NAME"
