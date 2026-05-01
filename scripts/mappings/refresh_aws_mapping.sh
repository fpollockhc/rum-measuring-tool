#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MAPPING_FILE="${ROOT_DIR}/data/mappings/aws_resource_to_tf.json"
REPORT_FILE="${ROOT_DIR}/data/mappings/aws_mapping_validation_report.json"
PROVIDER_CONSTRAINT="${1:->= 5.0.0}"
TMP_DIR="$(mktemp -d)"

cleanup() {
  rm -rf "${TMP_DIR}"
}
trap cleanup EXIT

if ! command -v terraform >/dev/null 2>&1; then
  echo "ERROR: terraform CLI is required but not installed." >&2
  exit 1
fi

if [ ! -f "${MAPPING_FILE}" ]; then
  echo "ERROR: mapping file not found at ${MAPPING_FILE}" >&2
  exit 1
fi

cat > "${TMP_DIR}/main.tf" <<EOF
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "${PROVIDER_CONSTRAINT}"
    }
  }
}
EOF

echo "Initializing temporary Terraform workspace..."
terraform -chdir="${TMP_DIR}" init -upgrade -no-color >/dev/null

echo "Reading provider schema..."
terraform -chdir="${TMP_DIR}" providers schema -json > "${TMP_DIR}/schema.json"

node -e '
const fs = require("fs");
const path = process.argv[1];
const out = process.argv[2];
const schema = JSON.parse(fs.readFileSync(path, "utf8"));
const aws = schema.provider_schemas?.["registry.terraform.io/hashicorp/aws"];
if (!aws?.resource_schemas) {
  console.error("Unable to locate AWS resource_schemas in provider schema JSON.");
  process.exit(1);
}
const resources = Object.keys(aws.resource_schemas).sort();
fs.writeFileSync(out, resources.join("\n") + "\n", "utf8");
' "${TMP_DIR}/schema.json" "${TMP_DIR}/aws_provider_resources.txt"

RESOLVED_VERSION="$(awk '
  /provider "registry.terraform.io\/hashicorp\/aws"/ { in_block=1; next }
  in_block && /version =/ {
    gsub(/"/, "", $3);
    print $3;
    exit
  }
  in_block && /^\}/ { in_block=0 }
' "${TMP_DIR}/.terraform.lock.hcl")"

if [ -z "${RESOLVED_VERSION}" ]; then
  RESOLVED_VERSION="unknown"
fi

echo "Validating mapping entries against provider resources..."
node -e '
const fs = require("fs");
const mappingPath = process.argv[1];
const resourcesPath = process.argv[2];
const reportPath = process.argv[3];
const resolvedVersion = process.argv[4];
const providerConstraint = process.argv[5];

const mapping = JSON.parse(fs.readFileSync(mappingPath, "utf8"));
const supported = new Set(
  fs.readFileSync(resourcesPath, "utf8").split(/\r?\n/).map((v) => v.trim()).filter(Boolean)
);

const missingTerraformTypes = [];
for (const entry of mapping.mappings ?? []) {
  if (!supported.has(entry.terraformType)) {
    missingTerraformTypes.push(entry.terraformType);
  }
}

const now = new Date();
mapping.mappingVersion = `${now.getUTCFullYear()}.${String(now.getUTCMonth() + 1).padStart(2, "0")}.${String(now.getUTCDate()).padStart(2, "0")}`;
mapping.updatedAt = now.toISOString();
mapping.providerVersionConstraint = providerConstraint;
mapping.providerVersionResolved = resolvedVersion;
mapping.source = mapping.source || "manual_curated";

fs.writeFileSync(mappingPath, JSON.stringify(mapping, null, 2) + "\n", "utf8");

const report = {
  generatedAt: now.toISOString(),
  providerVersionResolved: resolvedVersion,
  providerVersionConstraint: providerConstraint,
  totalMappingEntries: (mapping.mappings ?? []).length,
  totalProviderResources: supported.size,
  missingTerraformTypes,
  ok: missingTerraformTypes.length === 0
};
fs.writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n", "utf8");

if (!report.ok) {
  console.error("WARNING: Some mapping terraformType values are not in current provider schema.");
  console.error(JSON.stringify(report.missingTerraformTypes, null, 2));
  if (process.env.ESTIMATOR_MAPPING_ENFORCE_SCHEMA === "true") {
    process.exit(2);
  }
}
' "${MAPPING_FILE}" "${TMP_DIR}/aws_provider_resources.txt" "${REPORT_FILE}" "${RESOLVED_VERSION}" "${PROVIDER_CONSTRAINT}"

echo "Done."
echo "Updated mapping: ${MAPPING_FILE}"
echo "Validation report: ${REPORT_FILE}"
echo "Resolved AWS provider: ${RESOLVED_VERSION}"
