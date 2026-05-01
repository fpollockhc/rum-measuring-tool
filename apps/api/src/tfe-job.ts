import { calculateRumFromState, parseTerraformState, analyzeModuleStructure } from "@rum-tool/rum-engine";
import {
  getOrganization,
  listProjects,
  listAllWorkspaces,
  getCurrentStateVersion,
  downloadState
} from "./tfe-client.js";
import type { TfeClientOptions, TfeWorkspace } from "./tfe-client.js";
import type { TfeMigrationRequest, TfeWorkspaceResult, TfeMigrationSummary, TfeProjectSummary, TfeModuleSummary, TfeModuleEntry } from "./tfe-types.js";
import { updateTfeMigration } from "./tfe-store.js";
import { logger } from "./logger.js";

type WorkspaceInput = { id: string; name: string; projectName?: string };

async function processWorkspaceBatch(
  clientOptions: TfeClientOptions,
  workspaceInputs: WorkspaceInput[],
  concurrency: number
): Promise<TfeWorkspaceResult[]> {
  const results: TfeWorkspaceResult[] = [];
  const queue = [...workspaceInputs];

  async function worker() {
    while (queue.length > 0) {
      const workspace = queue.shift();
      if (!workspace) break;

      try {
        const stateVersion = await getCurrentStateVersion(clientOptions, workspace.id);

        if (!stateVersion) {
          results.push({
            workspaceId: workspace.id,
            workspaceName: workspace.name,
            projectName: workspace.projectName,
            rum: 0,
            countedResources: 0,
            excludedResources: 0,
            totalResources: 0,
            parseError: "No state version available"
          });
          continue;
        }

        const downloadUrl = stateVersion.attributes["hosted-state-download-url"];
        const rawState = await downloadState(clientOptions, downloadUrl);
        const state = parseTerraformState(rawState);
        const rumResult = calculateRumFromState(state);
        const moduleAnalysis = analyzeModuleStructure(rumResult.evaluations);

        results.push({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          projectName: workspace.projectName,
          stateVersionId: stateVersion.id,
          rum: rumResult.totalRum,
          countedResources: rumResult.countedResources,
          excludedResources: rumResult.excludedResources,
          totalResources: rumResult.totalResources,
          modules: moduleAnalysis.modules,
          maxModuleDepth: moduleAnalysis.maxDepth
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          projectName: workspace.projectName,
          rum: 0,
          countedResources: 0,
          excludedResources: 0,
          totalResources: 0,
          parseError: message
        });
      }
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, workspaceInputs.length) }, () => worker());
  await Promise.all(workers);

  return results;
}

function buildProjectSummaries(
  workspaces: TfeWorkspaceResult[],
  projectMap: Map<string, string>
): TfeProjectSummary[] {
  const byProject = new Map<string, TfeProjectSummary>();

  for (const ws of workspaces) {
    // Try to find project from the workspace's projectName or the project map
    const projName = ws.projectName ?? "Default Project";
    // Find project ID from the map (reverse lookup) or use name as ID
    let projId = "unknown";
    for (const [id, name] of projectMap.entries()) {
      if (name === projName) { projId = id; break; }
    }

    const existing = byProject.get(projName) ?? {
      projectId: projId,
      projectName: projName,
      workspaceCount: 0,
      rum: 0,
      countedResources: 0,
      excludedResources: 0
    };

    existing.workspaceCount += 1;
    existing.rum += ws.rum;
    existing.countedResources += ws.countedResources;
    existing.excludedResources += ws.excludedResources;
    byProject.set(projName, existing);
  }

  return [...byProject.values()].sort((a, b) => b.rum - a.rum);
}

function buildModuleSummary(workspaces: TfeWorkspaceResult[]): TfeModuleSummary {
  // Aggregate module entries across all workspaces by path
  const moduleMap = new Map<string, { rum: number; resourceCount: number; types: Set<string> }>();
  let maxDepth = 0;

  for (const ws of workspaces) {
    if (!ws.modules) continue;
    for (const mod of ws.modules) {
      const existing = moduleMap.get(mod.path) ?? { rum: 0, resourceCount: 0, types: new Set<string>() };
      existing.rum += mod.rum;
      existing.resourceCount += mod.resourceCount;
      for (const t of mod.resourceTypes) existing.types.add(t);
      moduleMap.set(mod.path, existing);
      if (mod.depth > maxDepth) maxDepth = mod.depth;
    }
  }

  const modules: TfeModuleEntry[] = [];
  for (const [path, data] of moduleMap) {
    const depth = path === "(root)" ? 0 : (path.match(/module\./g)?.length ?? 0);
    modules.push({
      path,
      depth,
      rum: data.rum,
      resourceCount: data.resourceCount,
      resourceTypes: [...data.types].sort()
    });
  }

  modules.sort((a, b) => b.rum - a.rum || a.path.localeCompare(b.path));

  return { modules, maxDepth, totalModules: modules.length };
}

function buildSummary(workspaces: TfeWorkspaceResult[], totalWorkspaces: number): TfeMigrationSummary {
  const workspacesWithState = workspaces.filter((w) => !w.parseError || w.parseError !== "No state version available").length;
  const parseErrors = workspaces.filter((w) => w.parseError && w.parseError !== "No state version available").length;

  return {
    totalWorkspaces,
    workspacesWithState,
    workspacesScanned: workspaces.length,
    totalRum: workspaces.reduce((sum, w) => sum + w.rum, 0),
    totalCountedResources: workspaces.reduce((sum, w) => sum + w.countedResources, 0),
    totalExcludedResources: workspaces.reduce((sum, w) => sum + w.excludedResources, 0),
    parseErrors
  };
}

export async function runTfeMigrationJob(
  runId: string,
  request: TfeMigrationRequest
): Promise<void> {
  const clientOptions: TfeClientOptions = {
    hostname: request.tfeHostname.replace(/\/+$/, ""),
    token: request.tfeToken,
    tlsInsecure: request.tlsInsecure
  };

  const concurrency = request.concurrency ?? 5;

  try {
    // Phase 1: Mark as running, validate connection
    updateTfeMigration(runId, (current) => ({
      ...current,
      status: "running",
      progress: { phase: "connecting" }
    }));

    await getOrganization(clientOptions, request.organization);

    // Phase 2: List projects and resolve project scoping
    updateTfeMigration(runId, (current) => ({
      ...current,
      progress: { phase: "listing_workspaces" }
    }));

    // Build project ID → name map for enrichment
    const projectMap = new Map<string, string>();
    let resolvedProjectId = request.projectId;

    try {
      const projects = await listProjects(clientOptions, request.organization);
      for (const proj of projects) {
        projectMap.set(proj.id, proj.attributes.name);
      }

      // If projectName was provided but not projectId, resolve it
      if (!resolvedProjectId && request.projectName) {
        const match = projects.find(
          (p) => p.attributes.name.toLowerCase() === request.projectName!.toLowerCase()
        );
        if (match) {
          resolvedProjectId = match.id;
        } else {
          throw new Error(`Project "${request.projectName}" not found in organization "${request.organization}"`);
        }
      }
    } catch (error) {
      // Projects API may not be available on older TFE — fall back gracefully
      if (resolvedProjectId || request.projectName) {
        throw error; // Only re-throw if user explicitly requested project scoping
      }
      logger.warn({ runId, err: error instanceof Error ? error.message : error }, "Could not list projects (older TFE?)");
    }

    // List workspaces (optionally filtered by project)
    const workspaces = await listAllWorkspaces(
      clientOptions,
      request.organization,
      {
        nameFilter: request.workspaceFilter,
        projectId: resolvedProjectId
      }
    );

    updateTfeMigration(runId, (current) => ({
      ...current,
      progress: {
        phase: "downloading_states",
        workspacesFound: workspaces.length,
        workspacesProcessed: 0
      }
    }));

    // Phase 3: Download states and calculate RUM
    const workspaceInputs: WorkspaceInput[] = workspaces.map((ws) => ({
      id: ws.id,
      name: ws.attributes.name,
      projectName: ws.relationships?.project?.data?.id
        ? projectMap.get(ws.relationships.project.data.id) ?? "Default Project"
        : "Default Project"
    }));

    const results = await processWorkspaceBatch(clientOptions, workspaceInputs, concurrency);

    // Phase 4: Build summary and complete
    const summary = buildSummary(results, workspaces.length);
    const byProject = buildProjectSummaries(results, projectMap);
    const byModule = buildModuleSummary(results);

    // Sort by RUM descending for display
    results.sort((a, b) => b.rum - a.rum);

    updateTfeMigration(runId, (current) => ({
      ...current,
      status: "completed",
      progress: {
        phase: "calculating",
        workspacesFound: workspaces.length,
        workspacesProcessed: results.length
      },
      summary,
      byProject,
      byModule,
      workspaces: results
    }));

    logger.info(
      { runId, workspaces: summary.totalWorkspaces, rum: summary.totalRum },
      "TFE migration completed"
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error({ runId, err: message }, "TFE migration failed");

    updateTfeMigration(runId, (current) => ({
      ...current,
      status: "failed",
      errorMessage: message
    }));
  }
}
