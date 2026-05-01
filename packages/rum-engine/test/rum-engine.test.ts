import { describe, expect, it } from "vitest";
import { calculateRumFromState, analyzeModuleStructure } from "../src/index";
import type { ResourceEvaluation } from "../src/index";

describe("calculateRumFromState", () => {
  it("counts managed instances and excludes data/null_resource/terraform_data", () => {
    const result = calculateRumFromState({
      resources: [
        {
          mode: "managed",
          type: "aws_instance",
          name: "web",
          instances: [{}, {}, {}]
        },
        {
          mode: "managed",
          type: "aws_s3_bucket",
          name: "data",
          instances: [{}]
        },
        {
          mode: "managed",
          type: "null_resource",
          name: "noop",
          instances: [{}, {}]
        },
        {
          mode: "data",
          type: "aws_ami",
          name: "latest",
          instances: [{}]
        }
      ]
    });

    expect(result.totalRum).toBe(4);
    expect(result.excludedResources).toBe(2);
  });

  it("counts for_each/count-expanded instances", () => {
    const result = calculateRumFromState({
      resources: [
        {
          mode: "managed",
          type: "azurerm_virtual_machine",
          name: "app",
          instances: [{}, {}, {}, {}, {}]
        },
        {
          mode: "managed",
          type: "azurerm_network_interface",
          name: "nic",
          instances: [{}, {}, {}]
        },
        {
          mode: "managed",
          type: "terraform_data",
          name: "meta",
          instances: [{}, {}]
        },
        {
          mode: "data",
          type: "azurerm_resource_group",
          name: "main",
          instances: [{}]
        }
      ]
    });

    expect(result.totalRum).toBe(8);
    expect(result.excludedResources).toBe(2);
  });

  it("handles resources with module paths", () => {
    const result = calculateRumFromState({
      resources: [
        {
          mode: "managed",
          type: "aws_instance",
          name: "web",
          module: "module.network",
          instances: [{}, {}]
        },
        {
          mode: "managed",
          type: "aws_vpc",
          name: "main",
          module: "module.network",
          instances: [{}]
        },
        {
          mode: "managed",
          type: "aws_instance",
          name: "app",
          instances: [{}]
        }
      ]
    });

    expect(result.totalRum).toBe(4);
    expect(result.evaluations[0].address).toBe("module.network.aws_instance.web");
    expect(result.evaluations[2].address).toBe("aws_instance.app");
  });
});

/* ---------- analyzeModuleStructure ---------- */

describe("analyzeModuleStructure", () => {
  it("returns single root module for flat state", () => {
    const evaluations: ResourceEvaluation[] = [
      { address: "aws_instance.web", type: "aws_instance", mode: "managed", instanceCount: 2, counted: true, rum: 2 },
      { address: "aws_s3_bucket.data", type: "aws_s3_bucket", mode: "managed", instanceCount: 1, counted: true, rum: 1 }
    ];

    const analysis = analyzeModuleStructure(evaluations);

    expect(analysis.moduleCount).toBe(1);
    expect(analysis.maxDepth).toBe(0);
    expect(analysis.modules[0].path).toBe("(root)");
    expect(analysis.modules[0].rum).toBe(3);
    expect(analysis.modules[0].resourceCount).toBe(2);
    expect(analysis.modules[0].resourceTypes).toEqual(["aws_instance", "aws_s3_bucket"]);
  });

  it("separates root and single-level modules", () => {
    const evaluations: ResourceEvaluation[] = [
      { address: "aws_instance.app", type: "aws_instance", mode: "managed", instanceCount: 1, counted: true, rum: 1 },
      { address: "module.network.aws_vpc.main", type: "aws_vpc", mode: "managed", instanceCount: 1, counted: true, rum: 1 },
      { address: "module.network.aws_subnet.private", type: "aws_subnet", mode: "managed", instanceCount: 3, counted: true, rum: 3 },
      { address: "module.compute.aws_instance.web", type: "aws_instance", mode: "managed", instanceCount: 5, counted: true, rum: 5 }
    ];

    const analysis = analyzeModuleStructure(evaluations);

    expect(analysis.moduleCount).toBe(3);
    expect(analysis.maxDepth).toBe(1);

    // Sorted by RUM descending
    expect(analysis.modules[0].path).toBe("module.compute");
    expect(analysis.modules[0].rum).toBe(5);
    expect(analysis.modules[0].depth).toBe(1);

    expect(analysis.modules[1].path).toBe("module.network");
    expect(analysis.modules[1].rum).toBe(4);
    expect(analysis.modules[1].resourceTypes).toEqual(["aws_subnet", "aws_vpc"]);

    expect(analysis.modules[2].path).toBe("(root)");
    expect(analysis.modules[2].rum).toBe(1);
  });

  it("handles deeply nested modules (3 levels)", () => {
    const evaluations: ResourceEvaluation[] = [
      { address: "module.env_1.module.stack_1.module.db.aws_rds_instance.main", type: "aws_rds_instance", mode: "managed", instanceCount: 1, counted: true, rum: 1 },
      { address: "module.env_1.module.stack_1.aws_instance.web", type: "aws_instance", mode: "managed", instanceCount: 3, counted: true, rum: 3 },
      { address: "module.env_1.aws_vpc.main", type: "aws_vpc", mode: "managed", instanceCount: 1, counted: true, rum: 1 },
      { address: "module.env_2.module.stack_1.aws_instance.web", type: "aws_instance", mode: "managed", instanceCount: 2, counted: true, rum: 2 }
    ];

    const analysis = analyzeModuleStructure(evaluations);

    expect(analysis.maxDepth).toBe(3);
    expect(analysis.moduleCount).toBe(4);

    // Find the deepest module
    const deepest = analysis.modules.find((m) => m.path === "module.env_1.module.stack_1.module.db");
    expect(deepest).toBeDefined();
    expect(deepest!.depth).toBe(3);
    expect(deepest!.rum).toBe(1);
  });

  it("includes excluded resources in resource count but not in RUM", () => {
    const evaluations: ResourceEvaluation[] = [
      { address: "module.app.aws_instance.web", type: "aws_instance", mode: "managed", instanceCount: 2, counted: true, rum: 2 },
      { address: "module.app.null_resource.noop", type: "null_resource", mode: "managed", instanceCount: 1, counted: false, rum: 0, exclusionReason: "excluded_type_null_resource" },
      { address: "module.app.aws_ami.latest", type: "aws_ami", mode: "data", instanceCount: 1, counted: false, rum: 0, exclusionReason: "mode_data" }
    ];

    const analysis = analyzeModuleStructure(evaluations);

    expect(analysis.moduleCount).toBe(1);
    expect(analysis.modules[0].path).toBe("module.app");
    expect(analysis.modules[0].rum).toBe(2);
    expect(analysis.modules[0].resourceCount).toBe(3);
    expect(analysis.modules[0].resourceTypes).toEqual(["aws_ami", "aws_instance", "null_resource"]);
  });

  it("returns empty analysis for empty evaluations", () => {
    const analysis = analyzeModuleStructure([]);
    expect(analysis.moduleCount).toBe(0);
    expect(analysis.maxDepth).toBe(0);
    expect(analysis.modules).toEqual([]);
  });

  it("deduplicates resource types within a module", () => {
    const evaluations: ResourceEvaluation[] = [
      { address: "module.compute.aws_instance.web", type: "aws_instance", mode: "managed", instanceCount: 3, counted: true, rum: 3 },
      { address: "module.compute.aws_instance.api", type: "aws_instance", mode: "managed", instanceCount: 2, counted: true, rum: 2 }
    ];

    const analysis = analyzeModuleStructure(evaluations);

    expect(analysis.modules[0].resourceTypes).toEqual(["aws_instance"]);
    expect(analysis.modules[0].rum).toBe(5);
    expect(analysis.modules[0].resourceCount).toBe(2);
  });

  it("sorts modules by RUM descending, then alphabetically", () => {
    const evaluations: ResourceEvaluation[] = [
      { address: "module.z_mod.aws_instance.a", type: "aws_instance", mode: "managed", instanceCount: 1, counted: true, rum: 1 },
      { address: "module.a_mod.aws_instance.a", type: "aws_instance", mode: "managed", instanceCount: 1, counted: true, rum: 1 },
      { address: "module.big.aws_instance.a", type: "aws_instance", mode: "managed", instanceCount: 10, counted: true, rum: 10 }
    ];

    const analysis = analyzeModuleStructure(evaluations);

    expect(analysis.modules[0].path).toBe("module.big");
    expect(analysis.modules[1].path).toBe("module.a_mod");
    expect(analysis.modules[2].path).toBe("module.z_mod");
  });
});
