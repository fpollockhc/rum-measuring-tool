#!/usr/bin/env node
import { Command } from "commander";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import YAML from "yaml";
import { calculateRumFromState, parseTerraformState } from "@rum-tool/rum-engine";

type CliConfig = {
  targets: Array<{
    provider: "aws" | "azure" | "gcp";
    bucketName: string;
  }>;
};

const FIXTURE_MAP: Record<string, string[]> = {
  aws: ["aws-dev.tfstate.json", "aws-prod.tfstate.json"],
  azure: ["azure-dev.tfstate.json"],
  gcp: ["gcp-shared.tfstate.json"]
};

type Provider = "aws" | "azure" | "gcp";

type GeneratedFileManifest = {
  filename: string;
  provider: Provider;
  expectedRum: number;
  countedResources: number;
  excludedResources: number;
  totalResources: number;
};

type SyntheticManifest = {
  generatedAt: string;
  seed: number;
  files: GeneratedFileManifest[];
  aggregateExpectedRum: number;
};

type TerraformResource = {
  mode: string;
  type: string;
  name: string;
  instances: unknown[];
  module?: string;
};

const PROVIDER_MANAGED_TYPES: Record<Provider, string[]> = {
  aws: ["aws_instance", "aws_s3_bucket", "aws_db_instance", "aws_lambda_function", "aws_iam_role"],
  azure: ["azurerm_linux_virtual_machine", "azurerm_network_interface", "azurerm_storage_account", "azurerm_key_vault"],
  gcp: ["google_compute_instance", "google_storage_bucket", "google_sql_database_instance", "google_service_account"]
};

const PROVIDER_DATA_TYPES: Record<Provider, string[]> = {
  aws: ["aws_ami", "aws_caller_identity"],
  azure: ["azurerm_subscription", "azurerm_client_config"],
  gcp: ["google_project", "google_client_config"]
};

function createSeededRandom(seed: number): () => number {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function randInt(rng: () => number, min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

function pick<T>(rng: () => number, values: T[]): T {
  return values[randInt(rng, 0, values.length - 1)];
}

function shuffle<T>(rng: () => number, values: T[]): T[] {
  const out = [...values];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = randInt(rng, 0, i);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function makeInstances(count: number): unknown[] {
  return Array.from({ length: count }, () => ({}));
}

function createSyntheticState(
  rng: () => number,
  provider: Provider,
  expectedRum: number,
  fileIndex: number
): { resources: TerraformResource[]; countedResources: number; excludedResources: number } {
  const managedTypes = PROVIDER_MANAGED_TYPES[provider];
  const dataTypes = PROVIDER_DATA_TYPES[provider];

  const resources: TerraformResource[] = [];
  let remainingRum = expectedRum;
  let managedIdx = 1;

  while (remainingRum > 0) {
    const chunk = Math.min(remainingRum, randInt(rng, 1, 8));
    const resource: TerraformResource = {
      mode: "managed",
      type: pick(rng, managedTypes),
      name: `managed_${fileIndex}_${managedIdx}`,
      instances: makeInstances(chunk)
    };
    if (rng() < 0.35) {
      resource.module = `module.env_${randInt(rng, 1, 3)}.module.stack_${randInt(rng, 1, 4)}`;
    }
    resources.push(resource);
    managedIdx += 1;
    remainingRum -= chunk;
  }

  const excludedTarget = randInt(rng, 2, 6);
  let excludedIdx = 1;
  for (let i = 0; i < excludedTarget; i += 1) {
    const excludedKind = randInt(rng, 0, 2);
    if (excludedKind === 0) {
      resources.push({
        mode: "data",
        type: pick(rng, dataTypes),
        name: `data_${fileIndex}_${excludedIdx}`,
        instances: makeInstances(randInt(rng, 1, 2))
      });
    } else if (excludedKind === 1) {
      resources.push({
        mode: "managed",
        type: "null_resource",
        name: `null_${fileIndex}_${excludedIdx}`,
        instances: makeInstances(randInt(rng, 1, 3))
      });
    } else {
      resources.push({
        mode: "managed",
        type: "terraform_data",
        name: `tdata_${fileIndex}_${excludedIdx}`,
        instances: makeInstances(randInt(rng, 1, 3))
      });
    }
    excludedIdx += 1;
  }

  return {
    resources: shuffle(rng, resources),
    countedResources: managedIdx - 1,
    excludedResources: excludedTarget
  };
}

async function runScan(configPath: string, outputPath?: string): Promise<void> {
  const rawConfig = await readFile(configPath, "utf-8");
  const config = YAML.parse(rawConfig) as CliConfig;

  let totalRum = 0;
  let excludedResources = 0;
  let stateFilesParsed = 0;

  const byBucket: Array<{ bucketName: string; provider: string; rum: number; stateFiles: number }> = [];

  for (const target of config.targets) {
    const row = {
      bucketName: target.bucketName,
      provider: target.provider,
      rum: 0,
      stateFiles: 0
    };
    for (const filename of FIXTURE_MAP[target.provider] ?? []) {
      const rawState = await readFile(join(process.cwd(), "fixtures/states", filename), "utf-8");
      const state = parseTerraformState(rawState);
      const result = calculateRumFromState(state);
      row.rum += result.totalRum;
      row.stateFiles += 1;
      totalRum += result.totalRum;
      excludedResources += result.excludedResources;
      stateFilesParsed += 1;
    }
    byBucket.push(row);
  }

  const output = {
    summary: {
      bucketsScanned: byBucket.length,
      stateFilesParsed,
      totalRum,
      excludedResources
    },
    byBucket
  };

  if (outputPath) {
    await writeFile(outputPath, JSON.stringify(output, null, 2));
    console.log(`Wrote report to ${outputPath}`);
    return;
  }

  console.log(JSON.stringify(output, null, 2));
}

async function listStateFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolutePath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listStateFilesRecursive(absolutePath)));
      continue;
    }
    if (entry.name.endsWith(".tfstate.json")) {
      files.push(absolutePath);
    }
  }
  return files;
}

async function runLocalScan(inputDir: string, outputPath?: string): Promise<void> {
  const absoluteDir = join(process.cwd(), inputDir);
  const files = await listStateFilesRecursive(absoluteDir);

  const byFile: Array<{ file: string; rum: number; excludedResources: number }> = [];
  let totalRum = 0;
  let totalExcluded = 0;
  for (const file of files) {
    const raw = await readFile(file, "utf-8");
    const result = calculateRumFromState(parseTerraformState(raw));
    byFile.push({ file, rum: result.totalRum, excludedResources: result.excludedResources });
    totalRum += result.totalRum;
    totalExcluded += result.excludedResources;
  }

  const output = {
    summary: {
      directory: absoluteDir,
      stateFilesParsed: files.length,
      totalRum,
      excludedResources: totalExcluded
    },
    byFile
  };

  if (outputPath) {
    await writeFile(outputPath, JSON.stringify(output, null, 2));
    console.log(`Wrote local scan report to ${outputPath}`);
    return;
  }
  console.log(JSON.stringify(output, null, 2));
}

async function generateSyntheticFixtures(
  count: number,
  minRum: number,
  maxRum: number,
  seed: number,
  outputDir: string
): Promise<SyntheticManifest> {
  const rng = createSeededRandom(seed);
  const providers: Provider[] = ["aws", "azure", "gcp"];
  const files: GeneratedFileManifest[] = [];
  const absoluteOutputDir = join(process.cwd(), outputDir);
  await mkdir(absoluteOutputDir, { recursive: true });

  for (let i = 1; i <= count; i += 1) {
    const provider = providers[(i - 1) % providers.length];
    const expectedRum = randInt(rng, minRum, maxRum);
    const { resources, countedResources, excludedResources } = createSyntheticState(rng, provider, expectedRum, i);

    const filename = `synthetic-${String(i).padStart(2, "0")}-${provider}-rum-${expectedRum}.tfstate.json`;
    const state = {
      version: 4,
      serial: i,
      lineage: `synthetic-${provider}-${i}`,
      resources
    };

    await writeFile(join(absoluteOutputDir, filename), JSON.stringify(state, null, 2));
    files.push({
      filename,
      provider,
      expectedRum,
      countedResources,
      excludedResources,
      totalResources: countedResources + excludedResources
    });
  }

  const manifest: SyntheticManifest = {
    generatedAt: new Date().toISOString(),
    seed,
    files,
    aggregateExpectedRum: files.reduce((sum, file) => sum + file.expectedRum, 0)
  };

  await writeFile(join(absoluteOutputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  return manifest;
}

async function validateSyntheticFixtures(
  manifestPath: string
): Promise<{ pass: boolean; failures: number; aggregateExpectedRum: number; aggregateActualRum: number }> {
  const absoluteManifestPath = join(process.cwd(), manifestPath);
  const raw = await readFile(absoluteManifestPath, "utf-8");
  const manifest = JSON.parse(raw) as SyntheticManifest;
  const baseDir = dirname(absoluteManifestPath);

  let failures = 0;
  let aggregateActualRum = 0;
  for (const file of manifest.files) {
    const fileRaw = await readFile(join(baseDir, file.filename), "utf-8");
    const state = parseTerraformState(fileRaw);
    const result = calculateRumFromState(state);
    const pass = result.totalRum === file.expectedRum;
    if (!pass) failures += 1;
    aggregateActualRum += result.totalRum;
    console.log(
      `${pass ? "PASS" : "FAIL"} ${file.filename} expected=${file.expectedRum} actual=${result.totalRum}`
    );
  }

  return {
    pass: failures === 0 && aggregateActualRum === manifest.aggregateExpectedRum,
    failures,
    aggregateExpectedRum: manifest.aggregateExpectedRum,
    aggregateActualRum
  };
}

const program = new Command();
program.name("rumctl").description("Terraform Cloud RUM calculation helper");

program
  .command("scan")
  .requiredOption("-c, --config <path>", "Path to YAML config")
  .option("-o, --output <path>", "Write JSON output to file")
  .action(async (opts: { config: string; output?: string }) => {
    await runScan(opts.config, opts.output);
  });

program
  .command("local-scan")
  .requiredOption("-d, --dir <directory>", "Directory containing .tfstate.json files")
  .option("-o, --output <path>", "Write JSON output to file")
  .action(async (opts: { dir: string; output?: string }) => {
    await runLocalScan(opts.dir, opts.output);
  });

program
  .command("synthetic-generate")
  .option("--count <count>", "Number of synthetic files", "20")
  .option("--min-rum <minRum>", "Minimum expected RUM per file", "25")
  .option("--max-rum <maxRum>", "Maximum expected RUM per file", "75")
  .option("--seed <seed>", "Random seed for deterministic output", "424242")
  .option("--out <outDir>", "Output directory", "fixtures/synthetic")
  .action(async (opts: { count: string; minRum: string; maxRum: string; seed: string; out: string }) => {
    const manifest = await generateSyntheticFixtures(
      Number(opts.count),
      Number(opts.minRum),
      Number(opts.maxRum),
      Number(opts.seed),
      opts.out
    );
    console.log(
      `Generated ${manifest.files.length} files in ${opts.out}. aggregateExpectedRum=${manifest.aggregateExpectedRum}`
    );
    console.log(`Manifest: ${join(opts.out, "manifest.json")}`);
  });

program
  .command("synthetic-validate")
  .option("--manifest <manifestPath>", "Path to manifest file", "fixtures/synthetic/manifest.json")
  .action(async (opts: { manifestPath: string }) => {
    const result = await validateSyntheticFixtures(opts.manifestPath);
    console.log(
      `Validation summary expected=${result.aggregateExpectedRum} actual=${result.aggregateActualRum} failures=${result.failures}`
    );
    if (!result.pass) {
      process.exit(1);
    }
  });

program
  .command("synthetic-test")
  .option("--count <count>", "Number of synthetic files", "20")
  .option("--min-rum <minRum>", "Minimum expected RUM per file", "25")
  .option("--max-rum <maxRum>", "Maximum expected RUM per file", "75")
  .option("--seed <seed>", "Random seed for deterministic output", "424242")
  .option("--out <outDir>", "Output directory", "fixtures/synthetic")
  .action(async (opts: { count: string; minRum: string; maxRum: string; seed: string; out: string }) => {
    await generateSyntheticFixtures(
      Number(opts.count),
      Number(opts.minRum),
      Number(opts.maxRum),
      Number(opts.seed),
      opts.out
    );
    const result = await validateSyntheticFixtures(join(opts.out, "manifest.json"));
    console.log(
      `Synthetic test summary expected=${result.aggregateExpectedRum} actual=${result.aggregateActualRum} failures=${result.failures}`
    );
    if (!result.pass) {
      process.exit(1);
    }
  });

program.parseAsync().catch((error) => {
  console.error(error);
  process.exit(1);
});
