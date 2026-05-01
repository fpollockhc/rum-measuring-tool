import { useState } from "react";
import {
  Button,
  Checkbox,
  DataTable,
  InlineLoading,
  ActionableNotification,
  PasswordInput,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  TextInput,
  Tile
} from "@carbon/react";
import {
  startTfeMigrationRun,
  getTfeMigrationRun,
  getTfeMigrationExportUrl,
  listTfeProjects,
  type TfeMigrationRecord,
  type TfeMigrationSummary,
  type TfeWorkspaceResult,
  type TfeProject,
  type TfeProjectSummary,
  type TfeModuleSummary,
  type TfeModuleEntry
} from "../lib/api";

export function TfeMigrationTab() {
  /* ---------- form state ---------- */
  const [tfeHostname, setTfeHostname] = useState("");
  const [tfeToken, setTfeToken] = useState("");
  const [organization, setOrganization] = useState("");
  const [workspaceFilter, setWorkspaceFilter] = useState("");
  const [tlsInsecure, setTlsInsecure] = useState(false);

  /* ---------- scope state ---------- */
  const [scopeLevel, setScopeLevel] = useState<"organization" | "project">("organization");
  const [projects, setProjects] = useState<TfeProject[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState("");
  const [selectedProjectName, setSelectedProjectName] = useState("");
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [projectsError, setProjectsError] = useState("");

  /* ---------- run state ---------- */
  const [isRunning, setIsRunning] = useState(false);
  const [runId, setRunId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [progress, setProgress] = useState<TfeMigrationRecord["progress"]>(undefined);
  const [message, setMessage] = useState("");

  /* ---------- result state ---------- */
  const [summary, setSummary] = useState<TfeMigrationSummary | null>(null);
  const [byProject, setByProject] = useState<TfeProjectSummary[]>([]);
  const [byModule, setByModule] = useState<TfeModuleSummary | null>(null);
  const [workspaces, setWorkspaces] = useState<TfeWorkspaceResult[]>([]);
  const [moduleExpanded, setModuleExpanded] = useState(true);

  /* ---------- load projects ---------- */
  async function handleLoadProjects() {
    if (!tfeHostname || !tfeToken || !organization) return;

    setProjectsLoading(true);
    setProjectsError("");
    setProjects([]);
    setSelectedProjectId("");
    setSelectedProjectName("");

    try {
      const result = await listTfeProjects({
        tfeHostname: tfeHostname.replace(/\/+$/, ""),
        tfeToken,
        organization,
        tlsInsecure: tlsInsecure || undefined
      });
      setProjects(result);
      if (result.length === 0) {
        setProjectsError("No projects found in this organization.");
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setProjectsError(`Failed to load projects: ${msg}`);
    } finally {
      setProjectsLoading(false);
    }
  }

  /* ---------- polling ---------- */
  async function pollRun(id: string) {
    for (let i = 0; i < 300; i += 1) {
      const run = await getTfeMigrationRun(id);
      setStatus(run.status);
      setProgress(run.progress);

      if (run.status === "completed") {
        setSummary(run.summary ?? null);
        setByProject(run.byProject ?? []);
        setByModule(run.byModule ?? null);
        setWorkspaces(run.workspaces ?? []);
        setMessage(`Migration estimate ${id} completed.`);
        return;
      }
      if (run.status === "failed") {
        setMessage(`Migration estimate ${id} failed: ${run.errorMessage ?? "unknown error"}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setMessage(`Migration estimate ${id} timed out after 5 minutes.`);
  }

  /* ---------- submit ---------- */
  async function handleRun() {
    if (!tfeHostname || !tfeToken || !organization) return;
    if (scopeLevel === "project" && !selectedProjectId) return;

    setIsRunning(true);
    setMessage("");
    setSummary(null);
    setByProject([]);
    setByModule(null);
    setWorkspaces([]);
    setStatus("queued");
    setProgress(undefined);

    try {
      const created = await startTfeMigrationRun({
        tfeHostname: tfeHostname.replace(/\/+$/, ""),
        tfeToken,
        organization,
        scopeLevel,
        projectId: scopeLevel === "project" ? selectedProjectId : undefined,
        projectName: scopeLevel === "project" ? selectedProjectName : undefined,
        workspaceFilter: workspaceFilter || undefined,
        tlsInsecure: tlsInsecure || undefined
      });
      setRunId(created.id);
      setMessage(`Run ${created.id} queued — connecting to TFE...`);
      await pollRun(created.id);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      setMessage(`Error: ${msg}`);
    } finally {
      setIsRunning(false);
    }
  }

  /* ---------- validation ---------- */
  const canLoadProjects = Boolean(tfeHostname && tfeToken && organization && !isRunning && !projectsLoading);
  const canRun = Boolean(
    tfeHostname && tfeToken && organization && !isRunning &&
    (scopeLevel === "organization" || selectedProjectId)
  );

  /* ---------- progress label ---------- */
  function progressLabel(): string {
    if (!progress) return status;
    switch (progress.phase) {
      case "connecting":
        return "Connecting to TFE...";
      case "listing_workspaces":
        return "Listing workspaces...";
      case "downloading_states":
        return `Processing workspaces (${progress.workspacesProcessed ?? 0} / ${progress.workspacesFound ?? "?"})...`;
      case "calculating":
        return "Finalizing results...";
      default:
        return status;
    }
  }

  /* ---------- project table ---------- */
  const projHeaders = [
    { key: "projectName", header: "Project" },
    { key: "workspaceCount", header: "Workspaces" },
    { key: "billableRum", header: "Billable RUM" },
    { key: "nonBillable", header: "Non-Billable" },
    { key: "totalResources", header: "Total Resources" }
  ];

  const projRows = byProject.map((p, idx) => ({
    id: `proj-${idx}`,
    projectName: p.projectName,
    workspaceCount: String(p.workspaceCount),
    billableRum: String(p.rum),
    nonBillable: String(p.excludedResources),
    totalResources: String(p.rum + p.excludedResources)
  }));

  /* ---------- workspace table ---------- */
  const wsHeaders = [
    { key: "workspaceName", header: "Workspace" },
    { key: "projectName", header: "Project" },
    { key: "billableRum", header: "Billable RUM" },
    { key: "nonBillable", header: "Non-Billable" },
    { key: "totalResources", header: "Total Resources" },
    { key: "status", header: "Status" }
  ];

  const wsRows = workspaces.map((ws, idx) => ({
    id: `ws-${idx}`,
    workspaceName: ws.workspaceName,
    projectName: ws.projectName ?? "—",
    billableRum: String(ws.rum),
    nonBillable: String(ws.excludedResources),
    totalResources: String(ws.totalResources),
    status: ws.parseError ? `Error: ${ws.parseError}` : "OK"
  }));

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      {/* ---------- connection form ---------- */}
      <Tile className="card" style={{ padding: "1.25rem" }}>
        <h3 style={{ margin: "0 0 0.75rem" }}>TFE Migration Estimator</h3>
        <p className="helper-text" style={{ marginBottom: "1rem" }}>
          Connect to a Terraform Enterprise instance to estimate the RUM impact of migrating workspaces to HCP Terraform Cloud.
          Scope by entire organization or drill down to a specific project.
        </p>

        <div className="wizard-form">
          <TextInput
            id="tfe-hostname"
            labelText="TFE Hostname"
            placeholder="https://tfe.company.com"
            value={tfeHostname}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTfeHostname(e.target.value)}
            disabled={isRunning}
          />
          <PasswordInput
            id="tfe-token"
            labelText="TFE API Token"
            placeholder="Workspace-scoped or team token with read access"
            value={tfeToken}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTfeToken(e.target.value)}
            disabled={isRunning}
            hidePasswordLabel="Hide token"
            showPasswordLabel="Show token"
          />
          <TextInput
            id="tfe-org"
            labelText="Organization"
            placeholder="my-org"
            value={organization}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOrganization(e.target.value)}
            disabled={isRunning}
          />

          {/* ---------- scope selector ---------- */}
          <div>
            <p style={{ fontSize: "0.85rem", fontWeight: 600, marginBottom: "0.5rem" }}>Scan Scope</p>
            <div className="wizard-actions">
              <Button
                kind={scopeLevel === "organization" ? "primary" : "tertiary"}
                size="sm"
                onClick={() => setScopeLevel("organization")}
                disabled={isRunning}
              >
                Entire Organization
              </Button>
              <Button
                kind={scopeLevel === "project" ? "primary" : "tertiary"}
                size="sm"
                onClick={() => {
                  setScopeLevel("project");
                  if (projects.length === 0 && canLoadProjects) {
                    void handleLoadProjects();
                  }
                }}
                disabled={isRunning}
              >
                By Project
              </Button>
            </div>
          </div>

          {/* ---------- project picker ---------- */}
          {scopeLevel === "project" && (
            <div className="provider-card">
              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", flexWrap: "wrap" }}>
                <h4 style={{ margin: 0 }}>Select Project</h4>
                <Button
                  kind="tertiary"
                  size="sm"
                  onClick={handleLoadProjects}
                  disabled={!canLoadProjects}
                >
                  {projectsLoading ? "Loading..." : "Refresh Projects"}
                </Button>
              </div>

              {projectsError && (
                <p className="scan-error" style={{ fontSize: "0.85rem" }}>{projectsError}</p>
              )}

              {projects.length > 0 && (
                <div style={{ display: "grid", gap: "0.5rem", maxHeight: "200px", overflowY: "auto" }}>
                  {projects.map((proj) => (
                    <button
                      key={proj.id}
                      type="button"
                      onClick={() => {
                        setSelectedProjectId(proj.id);
                        setSelectedProjectName(proj.name);
                      }}
                      disabled={isRunning}
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        padding: "0.5rem 0.75rem",
                        border: selectedProjectId === proj.id ? "2px solid var(--brand-mint)" : "1px solid #d9e2ec",
                        borderRadius: "0.5rem",
                        background: selectedProjectId === proj.id ? "#ecfdf5" : "white",
                        cursor: isRunning ? "not-allowed" : "pointer",
                        textAlign: "left",
                        width: "100%",
                        fontSize: "0.9rem"
                      }}
                    >
                      <span>
                        <strong>{proj.name}</strong>
                        {proj.description && (
                          <span style={{ color: "#64748b", marginLeft: "0.5rem" }}>{proj.description}</span>
                        )}
                      </span>
                      <span style={{ color: "#64748b", whiteSpace: "nowrap", marginLeft: "1rem" }}>
                        {proj.workspaceCount} workspace{proj.workspaceCount !== 1 ? "s" : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <TextInput
            id="tfe-workspace-filter"
            labelText="Workspace Filter (optional)"
            placeholder="Search by workspace name"
            value={workspaceFilter}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWorkspaceFilter(e.target.value)}
            disabled={isRunning}
          />
          <Checkbox
            id="tfe-tls-insecure"
            labelText="Allow self-signed TLS certificates"
            checked={tlsInsecure}
            onChange={(_: unknown, { checked }: { checked: boolean }) => setTlsInsecure(checked)}
            disabled={isRunning}
          />
        </div>

        <div className="wizard-actions" style={{ marginTop: "1rem" }}>
          <Button kind="primary" onClick={handleRun} disabled={!canRun}>
            {isRunning ? "Running..." : scopeLevel === "project" && selectedProjectName
              ? `Estimate RUM for "${selectedProjectName}"`
              : "Run Migration Estimate"}
          </Button>
        </div>
      </Tile>

      {/* ---------- status panel ---------- */}
      {isRunning && (
        <Tile className="card" style={{ padding: "1.25rem" }}>
          <InlineLoading description={progressLabel()} status="active" />
          {runId && <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: "0.5rem" }}>Run ID: {runId}</p>}
        </Tile>
      )}

      {!isRunning && message && (message.includes("failed") || message.includes("timed out")) && (
        <ActionableNotification
          kind="error"
          title="Migration Failed"
          subtitle={message}
          lowContrast
          inline
          actionButtonLabel="Retry"
          onActionButtonClick={handleRun}
          hideCloseButton
        />
      )}

      {!isRunning && message && !message.includes("failed") && !message.includes("timed out") && summary && (
        <ActionableNotification
          kind="success"
          title="Migration Estimate Complete"
          subtitle={`${summary.totalRum.toLocaleString()} Billable RUM across ${summary.totalWorkspaces} workspaces`}
          lowContrast
          inline
          actionButtonLabel="Re-run"
          onActionButtonClick={handleRun}
          hideCloseButton
        />
      )}

      {/* ---------- summary ---------- */}
      {summary && (
        <Tile className="card" style={{ padding: "1.25rem" }}>
          <h3 style={{ margin: "0 0 0.75rem" }}>Migration Summary</h3>
          <div className="kpi-grid-inline">
            <div>
              <h4>
                Billable RUM
                <span className="metric-help" tabIndex={0}>
                  i
                  <span className="metric-help-text">
                    Resources Under Management — the billing metric for HCP Terraform. Counts managed resource instances excluding null_resource and terraform_data.
                  </span>
                </span>
              </h4>
              <p>{summary.totalRum.toLocaleString()}</p>
            </div>
            <div>
              <h4>Workspaces Scanned</h4>
              <p>{summary.totalWorkspaces.toLocaleString()}</p>
            </div>
            <div>
              <h4>With State</h4>
              <p>{summary.workspacesWithState.toLocaleString()}</p>
            </div>
            <div>
              <h4>
                Non-Billable Resources
                <span className="metric-help" tabIndex={0}>
                  i
                  <span className="metric-help-text">
                    Resources in state that do not count toward RUM: data sources, null_resource, and terraform_data.
                  </span>
                </span>
              </h4>
              <p>{summary.totalExcludedResources.toLocaleString()}</p>
            </div>
            <div>
              <h4>Total Resources</h4>
              <p>{(summary.totalCountedResources + summary.totalExcludedResources).toLocaleString()}</p>
            </div>
            <div>
              <h4>Parse Errors</h4>
              <p>{summary.parseErrors.toLocaleString()}</p>
            </div>
          </div>
        </Tile>
      )}

      {/* ---------- project breakdown ---------- */}
      {byProject.length > 1 && (
        <Tile className="card" style={{ padding: "1.25rem" }}>
          <h3 style={{ margin: "0 0 0.75rem" }}>By Project</h3>
          <DataTable rows={projRows} headers={projHeaders}>
            {({ rows, headers, getHeaderProps, getTableProps }) => (
              <TableContainer>
                <Table {...getTableProps()}>
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => {
                        const { key: _key, ...headerProps } = getHeaderProps({ header });
                        return (
                          <TableHeader key={header.key} {...headerProps}>
                            {header.header}
                          </TableHeader>
                        );
                      })}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        </Tile>
      )}

      {/* ---------- module breakdown ---------- */}
      {byModule && byModule.modules.length > 0 && (
        <Tile className="card" style={{ padding: "1.25rem" }}>
          <div
            className="table-header-row"
            style={{ cursor: "pointer" }}
            onClick={() => setModuleExpanded(!moduleExpanded)}
          >
            <h3 style={{ margin: 0 }}>
              {moduleExpanded ? "▾" : "▸"} Module Breakdown
              <span style={{ fontSize: "0.85rem", fontWeight: 400, color: "#64748b", marginLeft: "0.5rem" }}>
                {byModule.totalModules} module{byModule.totalModules !== 1 ? "s" : ""}, max depth {byModule.maxDepth}
              </span>
            </h3>
          </div>

          {moduleExpanded && (
            <div style={{ marginTop: "0.75rem" }}>
              <DataTable
                rows={byModule.modules.map((mod, idx) => ({
                  id: `mod-${idx}`,
                  path: mod.path,
                  depth: String(mod.depth),
                  billableRum: String(mod.rum),
                  resourceCount: String(mod.resourceCount),
                  resourceTypes: mod.resourceTypes.length <= 5
                    ? mod.resourceTypes.join(", ")
                    : `${mod.resourceTypes.slice(0, 5).join(", ")} +${mod.resourceTypes.length - 5} more`
                }))}
                headers={[
                  { key: "path", header: "Module Path" },
                  { key: "depth", header: "Depth" },
                  { key: "billableRum", header: "Billable RUM" },
                  { key: "resourceCount", header: "Resources" },
                  { key: "resourceTypes", header: "Resource Types" }
                ]}
              >
                {({ rows, headers, getHeaderProps, getTableProps }) => (
                  <TableContainer>
                    <Table {...getTableProps()} size="sm">
                      <TableHead>
                        <TableRow>
                          {headers.map((header) => {
                            const { key: _key, ...headerProps } = getHeaderProps({ header });
                            return (
                              <TableHeader key={header.key} {...headerProps}>
                                {header.header}
                              </TableHeader>
                            );
                          })}
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {rows.map((row) => (
                          <TableRow key={row.id}>
                            {row.cells.map((cell) => (
                              <TableCell key={cell.id}>
                                {cell.info.header === "path" ? (
                                  <code style={{ fontSize: "0.8rem" }}>{cell.value}</code>
                                ) : (
                                  cell.value
                                )}
                              </TableCell>
                            ))}
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </DataTable>
            </div>
          )}
        </Tile>
      )}

      {/* ---------- workspace table ---------- */}
      {workspaces.length > 0 && (
        <Tile className="card" style={{ padding: "1.25rem" }}>
          <div className="table-header-row">
            <h3 style={{ margin: 0 }}>Workspace Breakdown</h3>
            <div className="table-actions">
              {runId && (
                <>
                  <Button
                    kind="tertiary"
                    size="sm"
                    onClick={() => window.open(getTfeMigrationExportUrl(runId, "csv"), "_blank")}
                  >
                    Export CSV
                  </Button>
                  <Button
                    kind="tertiary"
                    size="sm"
                    onClick={() => window.open(getTfeMigrationExportUrl(runId, "json"), "_blank")}
                  >
                    Export JSON
                  </Button>
                </>
              )}
            </div>
          </div>

          <DataTable rows={wsRows} headers={wsHeaders}>
            {({ rows, headers, getHeaderProps, getTableProps }) => (
              <TableContainer>
                <Table {...getTableProps()}>
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => {
                        const { key: _key, ...headerProps } = getHeaderProps({ header });
                        return (
                          <TableHeader key={header.key} {...headerProps}>
                            {header.header}
                          </TableHeader>
                        );
                      })}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {rows.map((row) => (
                      <TableRow key={row.id}>
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            )}
          </DataTable>
        </Tile>
      )}
    </div>
  );
}
