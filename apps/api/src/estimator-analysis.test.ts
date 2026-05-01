import { describe, expect, it } from "vitest";
import {
  buildDiagnostics,
  buildIamRemediation,
  classifyWithMapping,
  parseResourceIdentity
} from "./estimator-analysis.js";
import type { MappingEntry } from "./estimator-mapping.js";
import type { EstimatorResourceRow } from "./estimator-types.js";

/* ---------- parseResourceIdentity ---------- */

describe("parseResourceIdentity", () => {
  it("parses AWS ARN correctly", () => {
    const result = parseResourceIdentity(
      "aws",
      "arn:aws:ec2:us-east-1:123456789012:instance/i-abc123"
    );
    expect(result.service).toBe("ec2");
    expect(result.region).toBe("us-east-1");
    expect(result.resourceType).toBe("instance/i-abc123");
  });

  it("handles AWS ARN with empty region", () => {
    const result = parseResourceIdentity(
      "aws",
      "arn:aws:iam::123456789012:role/admin"
    );
    expect(result.service).toBe("iam");
    expect(result.region).toBeUndefined();
    expect(result.resourceType).toBe("role/admin");
  });

  it("parses Azure resource ID correctly", () => {
    const result = parseResourceIdentity(
      "azure",
      "/subscriptions/sub-1/resourceGroups/rg-1/providers/Microsoft.Compute/virtualMachines/vm-1"
    );
    expect(result.service).toBe("microsoft.compute");
    expect(result.resourceType).toBe("virtualMachines");
  });

  it("handles Azure resource ID without providers segment", () => {
    const result = parseResourceIdentity("azure", "/subscriptions/sub-1");
    expect(result.service).toBe("azure");
    expect(result.resourceType).toBe("unknown");
  });

  it("parses GCP resource name correctly", () => {
    const result = parseResourceIdentity(
      "gcp",
      "//compute.googleapis.com/projects/my-proj/zones/us-central1-a/instances/vm-1"
    );
    expect(result.service).toBe("compute");
    expect(result.resourceType).toBe("projects");
  });

  it("handles GCP resource without leading slashes", () => {
    const result = parseResourceIdentity(
      "gcp",
      "storage.googleapis.com/buckets/my-bucket"
    );
    expect(result.service).toBe("storage");
    expect(result.resourceType).toBe("buckets");
  });
});

/* ---------- classifyWithMapping ---------- */

describe("classifyWithMapping", () => {
  const mapping: MappingEntry[] = [
    { matchPrefix: "arn:aws:ec2:", terraformType: "aws_instance", rumEligible: true },
    { matchPrefix: "arn:aws:ecs:", terraformType: "aws_ecs_cluster", rumEligible: true },
    { matchPrefix: "arn:aws:iam:", terraformType: "aws_iam_role", rumEligible: false },
    { matchPrefix: "arn:aws:ec2:us-east-1:", terraformType: "aws_instance", rumEligible: true }
  ];

  it("classifies a mapped RUM-eligible resource as rum_candidate", () => {
    const result = classifyWithMapping("aws", "arn:aws:ecs:us-east-1:123:cluster/demo", mapping);
    expect(result.classification).toBe("rum_candidate");
    expect(result.reasonCode).toBe("MAPPED_MANAGEABLE");
    expect(result.terraformResourceType).toBe("aws_ecs_cluster");
  });

  it("classifies a mapped non-eligible resource as excluded", () => {
    const result = classifyWithMapping("aws", "arn:aws:iam::123:role/admin", mapping);
    expect(result.classification).toBe("excluded");
    expect(result.reasonCode).toBe("MAPPED_EXCLUDED");
    expect(result.terraformResourceType).toBe("aws_iam_role");
  });

  it("classifies an unmapped resource as unmapped", () => {
    const result = classifyWithMapping("aws", "arn:aws:sns:us-east-1:123:topic/demo", mapping);
    expect(result.classification).toBe("unmapped");
    expect(result.reasonCode).toBe("UNMAPPED_TYPE");
    expect(result.terraformResourceType).toBeUndefined();
  });

  it("uses longest prefix match for specificity", () => {
    // "arn:aws:ec2:us-east-1:" is more specific than "arn:aws:ec2:"
    const result = classifyWithMapping(
      "aws",
      "arn:aws:ec2:us-east-1:123:instance/i-abc",
      mapping
    );
    expect(result.classification).toBe("rum_candidate");
    expect(result.service).toBe("ec2");
    expect(result.region).toBe("us-east-1");
  });

  it("populates service and region from resource identity", () => {
    const result = classifyWithMapping("aws", "arn:aws:ecs:eu-west-1:123:cluster/c1", mapping);
    expect(result.service).toBe("ecs");
    expect(result.region).toBe("eu-west-1");
  });

  it("handles empty mapping list", () => {
    const result = classifyWithMapping("aws", "arn:aws:ec2:us-east-1:123:instance/i-1", []);
    expect(result.classification).toBe("unmapped");
    expect(result.reasonCode).toBe("UNMAPPED_TYPE");
  });
});

/* ---------- buildDiagnostics ---------- */

describe("buildDiagnostics", () => {
  it("returns zero values for empty input", () => {
    const result = buildDiagnostics([]);
    expect(result.mappedResources).toBe(0);
    expect(result.coveragePct).toBe(0);
    expect(result.permissionDenied).toBe(0);
    expect(result.topMissingPermissions).toHaveLength(0);
    expect(result.topUnmappedPrefixes).toHaveLength(0);
  });

  it("calculates coverage percentage correctly", () => {
    const rows: EstimatorResourceRow[] = [
      { resourceId: "a", service: "ec2", resourceType: "instance", classification: "rum_candidate", reasonCode: "MAPPED_MANAGEABLE", terraformResourceType: "aws_instance" },
      { resourceId: "b", service: "ec2", resourceType: "instance", classification: "rum_candidate", reasonCode: "MAPPED_MANAGEABLE", terraformResourceType: "aws_instance" },
      { resourceId: "c", service: "sns", resourceType: "topic", classification: "unmapped", reasonCode: "UNMAPPED_TYPE" }
    ];
    const result = buildDiagnostics(rows);
    expect(result.mappedResources).toBe(2);
    expect(result.coveragePct).toBeCloseTo(66.67, 2);
  });

  it("counts permission denied rows and aggregates permissions", () => {
    const rows: EstimatorResourceRow[] = [
      { resourceId: "a", service: "x", resourceType: "y", classification: "unmapped", reasonCode: "PERMISSION_DENIED", reasonDetail: "Missing permission for ec2:DescribeInstances" },
      { resourceId: "b", service: "x", resourceType: "y", classification: "unmapped", reasonCode: "PERMISSION_DENIED", reasonDetail: "Missing permission for ec2:DescribeInstances" },
      { resourceId: "c", service: "x", resourceType: "y", classification: "unmapped", reasonCode: "PERMISSION_DENIED", reasonDetail: "Missing permission for s3:ListBuckets" }
    ];
    const result = buildDiagnostics(rows);
    expect(result.permissionDenied).toBe(3);
    expect(result.topMissingPermissions).toHaveLength(2);
    expect(result.topMissingPermissions[0].permission).toBe("ec2:DescribeInstances");
    expect(result.topMissingPermissions[0].count).toBe(2);
    expect(result.topMissingPermissions[1].permission).toBe("s3:ListBuckets");
    expect(result.topMissingPermissions[1].count).toBe(1);
  });

  it("aggregates unmapped prefixes with sample resource IDs", () => {
    const rows: EstimatorResourceRow[] = [
      { resourceId: "arn:aws:sns:us-east-1:123:topic/t1", service: "sns", resourceType: "topic/t1", classification: "unmapped", reasonCode: "UNMAPPED_TYPE" },
      { resourceId: "arn:aws:sns:us-east-1:123:topic/t2", service: "sns", resourceType: "topic/t2", classification: "unmapped", reasonCode: "UNMAPPED_TYPE" },
      { resourceId: "arn:aws:sqs:us-east-1:123:queue/q1", service: "sqs", resourceType: "queue/q1", classification: "unmapped", reasonCode: "UNMAPPED_TYPE" }
    ];
    const result = buildDiagnostics(rows);
    expect(result.topUnmappedPrefixes).toHaveLength(2);
    expect(result.topUnmappedPrefixes[0].count).toBe(2);
    expect(result.topUnmappedPrefixes[0].key).toBe("sns:topic");
  });

  it("limits top results to 10 entries", () => {
    const rows: EstimatorResourceRow[] = Array.from({ length: 15 }, (_, i) => ({
      resourceId: `arn:aws:svc${i}:us-east-1:123:res/r`,
      service: `svc${i}`,
      resourceType: `res/r`,
      classification: "unmapped" as const,
      reasonCode: "UNMAPPED_TYPE" as const
    }));
    const result = buildDiagnostics(rows);
    expect(result.topUnmappedPrefixes.length).toBeLessThanOrEqual(10);
  });
});

/* ---------- buildIamRemediation ---------- */

describe("buildIamRemediation", () => {
  it("includes provider base permission for AWS", () => {
    const diagnostics = buildDiagnostics([]);
    const result = buildIamRemediation("aws", diagnostics);
    expect(result.actions).toContain("resourcegroupstaggingapi:GetResources");
    expect(result.policy.Statement[0].Sid).toBe("RumEstimatorReadOnly");
    expect(result.policy.Statement[0].Effect).toBe("Allow");
  });

  it("includes provider base permission for Azure", () => {
    const diagnostics = buildDiagnostics([]);
    const result = buildIamRemediation("azure", diagnostics);
    expect(result.actions).toContain("Microsoft.Resources/subscriptions/resources/read");
  });

  it("includes provider base permission for GCP", () => {
    const diagnostics = buildDiagnostics([]);
    const result = buildIamRemediation("gcp", diagnostics);
    expect(result.actions).toContain("cloudasset.assets.searchAllResources");
  });

  it("merges missing permissions into remediation actions", () => {
    const rows: EstimatorResourceRow[] = [
      { resourceId: "a", service: "x", resourceType: "y", classification: "unmapped", reasonCode: "PERMISSION_DENIED", reasonDetail: "Missing permission for ec2:DescribeInstances" },
      { resourceId: "b", service: "x", resourceType: "y", classification: "unmapped", reasonCode: "PERMISSION_DENIED", reasonDetail: "Missing permission for s3:ListBuckets" }
    ];
    const diagnostics = buildDiagnostics(rows);
    const result = buildIamRemediation("aws", diagnostics);
    expect(result.actions).toContain("ec2:DescribeInstances");
    expect(result.actions).toContain("s3:ListBuckets");
    expect(result.actions).toContain("resourcegroupstaggingapi:GetResources");
  });

  it("deduplicates and sorts actions", () => {
    const rows: EstimatorResourceRow[] = [
      { resourceId: "a", service: "x", resourceType: "y", classification: "unmapped", reasonCode: "PERMISSION_DENIED", reasonDetail: "Missing permission for z:Action" },
      { resourceId: "b", service: "x", resourceType: "y", classification: "unmapped", reasonCode: "PERMISSION_DENIED", reasonDetail: "Missing permission for a:Action" }
    ];
    const diagnostics = buildDiagnostics(rows);
    const result = buildIamRemediation("aws", diagnostics);
    const sorted = [...result.actions].sort();
    expect(result.actions).toEqual(sorted);
  });
});
