import { useEffect, useMemo, useState } from "react";
import { Button, Checkbox, DataTable, InlineLoading, ActionableNotification, PasswordInput, Table, TableBody, TableCell, TableContainer, TableHead, TableHeader, TableRow, TextInput, Tile } from "@carbon/react";
import {
  getEstimatorMappingMetadata,
  getEstimatorCategoryExportUrl,
  getEstimatorIamRemediation,
  getEstimatorIamRemediationPolicyExportUrl,
  getEstimatorCategoryRows,
  getEstimatorRunDiagnostics,
  getEstimatorRun,
  listEstimatorRuns,
  startAwsEstimatorRun,
  startAzureEstimatorRun,
  startGcpEstimatorRun,
  type EstimatorProvider,
  type EstimatorMappingMetadata,
  type EstimatorResourceRow,
  type EstimatorRunRecord
} from "../lib/api";

type SummaryMetric = {
  label: string;
  value: number;
  help: string;
};

export function UnmanagedEstimatorTab() {
  const [provider, setProvider] = useState<EstimatorProvider>("aws");
  const [regions, setRegions] = useState("us-east-1");
  const [awsRegion, setAwsRegion] = useState("");
  const [awsProfile, setAwsProfile] = useState("");
  const [awsAccessKeyId, setAwsAccessKeyId] = useState("");
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState("");
  const [awsSessionToken, setAwsSessionToken] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [runId, setRunId] = useState("");
  const [status, setStatus] = useState("");
  const [message, setMessage] = useState("");
  const [summary, setSummary] = useState<EstimatorRunRecord["summary"]>();
  const [history, setHistory] = useState<EstimatorRunRecord[]>([]);
  const [mappingMetadata, setMappingMetadata] = useState<EstimatorMappingMetadata | null>(null);
  const [candidateRows, setCandidateRows] = useState<EstimatorResourceRow[]>([]);
  const [nonManageableRows, setNonManageableRows] = useState<EstimatorResourceRow[]>([]);
  const [unmappedRows, setUnmappedRows] = useState<EstimatorResourceRow[]>([]);
  const [detailsLoading, setDetailsLoading] = useState(false);
  const [topUnmapped, setTopUnmapped] = useState<Array<{ key: string; count: number; sampleResourceId: string }>>([]);
  const [topMissingPermissions, setTopMissingPermissions] = useState<Array<{ permission: string; count: number }>>([]);
  const [permissionDeniedCount, setPermissionDeniedCount] = useState(0);
  const [coveragePct, setCoveragePct] = useState(0);
  const [suggestedPermissions, setSuggestedPermissions] = useState<string[]>(["resourcegroupstaggingapi:GetResources"]);
  const [suggestedPolicyJson, setSuggestedPolicyJson] = useState("{}");
  const [copyPolicyStatus, setCopyPolicyStatus] = useState("");
  const [includeTagFilter, setIncludeTagFilter] = useState(false);
  const [tagKey, setTagKey] = useState("Environment");
  const [tagValues, setTagValues] = useState("prod");
  const [azureSubscriptionId, setAzureSubscriptionId] = useState("");
  const [azureResourceGroup, setAzureResourceGroup] = useState("");
  const [azureTenantId, setAzureTenantId] = useState("");
  const [gcpProjectId, setGcpProjectId] = useState("");
  const [gcpCredentialsPath, setGcpCredentialsPath] = useState("");

  const canRun = useMemo(() => {
    if (provider === "gcp") {
      return gcpProjectId.trim().length > 0;
    }
    if (provider === "azure") {
      return true;
    }
    const hasKey = awsAccessKeyId.trim().length > 0;
    const hasSecret = awsSecretAccessKey.trim().length > 0;
    return hasKey === hasSecret;
  }, [provider, gcpProjectId, awsAccessKeyId, awsSecretAccessKey]);

  useEffect(() => {
    void refreshHistory();
    void refreshMapping();
  }, [provider]);

  async function refreshHistory() {
    const data = await listEstimatorRuns();
    setHistory((data.runs ?? []) as EstimatorRunRecord[]);
  }

  async function refreshMapping() {
    try {
      const metadata = await getEstimatorMappingMetadata(provider);
      setMappingMetadata(metadata);
    } catch {
      setMappingMetadata(null);
    }
  }

  async function runEstimator() {
    setIsRunning(true);
    setMessage("");
    setCandidateRows([]);
    setNonManageableRows([]);
    setUnmappedRows([]);
    setTopUnmapped([]);
    setTopMissingPermissions([]);
    setPermissionDeniedCount(0);
    setCoveragePct(0);
    setSuggestedPermissions(["resourcegroupstaggingapi:GetResources"]);
    setSuggestedPolicyJson("{}");
    setCopyPolicyStatus("");
    try {
      const created = provider === "aws"
        ? await startAwsEstimatorRun({
            scope: {
              regions: regions.split(",").map((v) => v.trim()).filter(Boolean),
              tagFilters: includeTagFilter
                ? [{ key: tagKey, values: tagValues.split(",").map((v) => v.trim()).filter(Boolean) }]
                : undefined
            },
            executionEnv: {
              awsRegion: awsRegion || undefined,
              awsProfile: awsProfile || undefined,
              awsAccessKeyId: awsAccessKeyId || undefined,
              awsSecretAccessKey: awsSecretAccessKey || undefined,
              awsSessionToken: awsSessionToken || undefined
            }
          })
        : provider === "azure"
          ? await startAzureEstimatorRun({
              scope: {
                subscriptionId: azureSubscriptionId || undefined,
                resourceGroup: azureResourceGroup || undefined
              },
              executionEnv: {
                azureSubscriptionId: azureSubscriptionId || undefined,
                azureTenantId: azureTenantId || undefined
              }
            })
          : await startGcpEstimatorRun({
              scope: {
                projectId: gcpProjectId
              },
              executionEnv: {
                gcpProjectId: gcpProjectId || undefined,
                googleApplicationCredentials: gcpCredentialsPath || undefined
              }
            });

      setRunId(created.id);
      setStatus(created.status);
      await pollRun(created.id);
      await refreshHistory();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      setMessage(`Estimator failed to start: ${msg}`);
    } finally {
      setIsRunning(false);
    }
  }

  async function pollRun(id: string) {
    for (let i = 0; i < 120; i += 1) {
      const run = await getEstimatorRun(id);
      setStatus(run.status);
      if (run.status === "completed") {
        setSummary(run.summary);
        await refreshCategoryDetails(id);
        setMessage(`Run ${id} completed.`);
        return;
      }
      if (run.status === "failed") {
        setMessage(`Run ${id} failed: ${run.errorMessage ?? "unknown error"}`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setMessage(`Run ${id} timed out.`);
  }

  async function refreshCategoryDetails(id: string) {
    setDetailsLoading(true);
    try {
      const [candidates, nonManageable, unmapped] = await Promise.all([
        getEstimatorCategoryRows(id, "candidates"),
        getEstimatorCategoryRows(id, "non-manageable"),
        getEstimatorCategoryRows(id, "unmapped")
      ]);
      const diagnostics = await getEstimatorRunDiagnostics(id);
      const remediation = await getEstimatorIamRemediation(id);
      setCandidateRows(candidates.rows);
      setNonManageableRows(nonManageable.rows);
      setUnmappedRows(unmapped.rows);
      setTopUnmapped(diagnostics.diagnostics.topUnmappedPrefixes ?? []);
      setTopMissingPermissions(diagnostics.diagnostics.topMissingPermissions ?? []);
      setPermissionDeniedCount(diagnostics.diagnostics.permissionDenied ?? 0);
      setCoveragePct(diagnostics.diagnostics.coveragePct ?? 0);
      setSuggestedPermissions(remediation.suggestedActions ?? []);
      setSuggestedPolicyJson(JSON.stringify(remediation.policy, null, 2));
    } finally {
      setDetailsLoading(false);
    }
  }

  function renderCategoryTable(
    title: string,
    rows: EstimatorResourceRow[],
    category: "candidates" | "non-manageable" | "unmapped"
  ) {
    return (
      <Tile className="card table-card">
        <div className="table-header-row">
          <h3>{title} ({rows.length})</h3>
          <div className="table-actions">
            <Button
              kind="tertiary"
              size="sm"
              disabled={!runId}
              onClick={() => {
                if (!runId) return;
                window.open(getEstimatorCategoryExportUrl(runId, category, "json"), "_blank", "noopener,noreferrer");
              }}
            >
              Export JSON
            </Button>
            <Button
              kind="secondary"
              size="sm"
              disabled={!runId}
              onClick={() => {
                if (!runId) return;
                window.open(getEstimatorCategoryExportUrl(runId, category, "csv"), "_blank", "noopener,noreferrer");
              }}
            >
              Export CSV
            </Button>
          </div>
        </div>
        {rows.length === 0 ? (
          <p className="helper-text">{detailsLoading ? "Loading..." : "No resources in this category for the selected run."}</p>
        ) : (
          <DataTable
            rows={rows.map((row, index) => ({
              id: `${category}-${index}-${row.resourceId}`,
              resourceId: row.resourceId,
              service: row.service,
              resourceType: row.resourceType,
              region: row.region ?? "",
              terraform: row.terraformResourceType ?? "",
              reason: row.reasonCode,
              reasonDetail: row.reasonDetail ?? ""
            }))}
            headers={[
              { key: "resourceId", header: "Resource ID" },
              { key: "service", header: "Service" },
              { key: "resourceType", header: "Resource Type" },
              { key: "region", header: "Region" },
              { key: "terraform", header: "Terraform Type" },
              { key: "reason", header: "Reason" },
              { key: "reasonDetail", header: "Reason Detail" }
            ]}
          >
            {({ rows: tableRows, headers, getHeaderProps, getTableProps }) => (
              <TableContainer>
                <Table {...getTableProps()}>
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHeader {...getHeaderProps({ header })}>{header.header}</TableHeader>
                      ))}
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {tableRows.map((row) => (
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
        )}
      </Tile>
    );
  }

  const metrics: SummaryMetric[] = [
    {
      label: "Discovered",
      value: summary?.discoveredResources ?? 0,
      help: "Total resources discovered in selected scope before Terraform support classification."
    },
    {
      label: "RUM Candidates",
      value: summary?.rumCandidates ?? 0,
      help: "Discovered resources currently mapped to Terraform-manageable types and counted as estimated potential RUM."
    },
    {
      label: "Non-Manageable",
      value: summary?.nonManageable ?? 0,
      help: "Resources mapped but excluded or otherwise not counted as estimated RUM candidates."
    },
    {
      label: "Unmapped",
      value: summary?.unmapped ?? 0,
      help: "Discovered resources with no current mapping to Terraform provider-supported resource types."
    },
    {
      label: "Permission Issues",
      value: permissionDeniedCount,
      help: "Resources where deeper classification was blocked by missing permissions."
    }
  ];

  return (
    <div className="dashboard-grid">
      <Tile className="card table-card">
        <h3>Unmanaged Estimator (Prototype)</h3>
        <p className="helper-text">Discovers cloud resources in scope and estimates Terraform-manageable RUM candidates.</p>
        {mappingMetadata && (
          <div className={`mapping-banner ${mappingMetadata.isStale ? "mapping-stale" : "mapping-fresh"}`}>
            <p>
              <strong>Mapping:</strong> v{mappingMetadata.mappingVersion} | updated {mappingMetadata.updatedAt} | age {mappingMetadata.ageDays} days
              {mappingMetadata.providerVersionConstraint ? ` | provider ${mappingMetadata.providerVersionConstraint}` : ""}
              {mappingMetadata.providerVersionResolved ? ` | resolved ${mappingMetadata.providerVersionResolved}` : ""}
            </p>
            <p>
              <strong>Status:</strong> {mappingMetadata.isStale ? "STALE" : "Fresh"} (threshold {mappingMetadata.staleThresholdDays} days)
            </p>
          </div>
        )}
        <div className="provider-card">
          <div className="wizard-actions">
            <Button kind={provider === "aws" ? "primary" : "tertiary"} size="sm" onClick={() => setProvider("aws")}>AWS</Button>
            <Button kind={provider === "azure" ? "primary" : "tertiary"} size="sm" onClick={() => setProvider("azure")}>Azure</Button>
            <Button kind={provider === "gcp" ? "primary" : "tertiary"} size="sm" onClick={() => setProvider("gcp")}>GCP</Button>
          </div>
          {provider === "aws" && (
            <>
              <TextInput id="regions" labelText="Regions (comma-separated)" value={regions} onChange={(e) => setRegions(e.currentTarget.value)} />
              <Checkbox id="include-tag-filter" labelText="Apply tag filter" checked={includeTagFilter} onChange={(_evt: unknown, { checked }: { checked: boolean | "indeterminate" }) => setIncludeTagFilter(Boolean(checked))} />
              {includeTagFilter && (
                <>
                  <TextInput id="tag-key" labelText="Tag Key" value={tagKey} onChange={(e) => setTagKey(e.currentTarget.value)} />
                  <TextInput id="tag-values" labelText="Tag Values (comma-separated)" value={tagValues} onChange={(e) => setTagValues(e.currentTarget.value)} />
                </>
              )}
              <TextInput id="est-aws-region" labelText="AWS Region override (optional)" value={awsRegion} onChange={(e) => setAwsRegion(e.currentTarget.value)} />
              <TextInput id="est-aws-profile" labelText="AWS Profile (optional)" value={awsProfile} onChange={(e) => setAwsProfile(e.currentTarget.value)} />
              <TextInput id="est-aws-access-key" labelText="AWS Access Key ID (optional)" value={awsAccessKeyId} onChange={(e) => setAwsAccessKeyId(e.currentTarget.value)} />
              <PasswordInput id="est-aws-secret" labelText="AWS Secret Access Key (optional)" value={awsSecretAccessKey} onChange={(e) => setAwsSecretAccessKey(e.currentTarget.value)} />
              <PasswordInput id="est-aws-token" labelText="AWS Session Token (optional)" value={awsSessionToken} onChange={(e) => setAwsSessionToken(e.currentTarget.value)} />
            </>
          )}
          {provider === "azure" && (
            <>
              <TextInput id="est-az-sub" labelText="Subscription ID (optional)" value={azureSubscriptionId} onChange={(e) => setAzureSubscriptionId(e.currentTarget.value)} />
              <TextInput id="est-az-rg" labelText="Resource Group (optional)" value={azureResourceGroup} onChange={(e) => setAzureResourceGroup(e.currentTarget.value)} />
              <TextInput id="est-az-tenant" labelText="Tenant ID (optional)" value={azureTenantId} onChange={(e) => setAzureTenantId(e.currentTarget.value)} />
            </>
          )}
          {provider === "gcp" && (
            <>
              <TextInput id="est-gcp-project" labelText="Project ID" value={gcpProjectId} onChange={(e) => setGcpProjectId(e.currentTarget.value)} />
              <TextInput id="est-gcp-creds" labelText="Credentials File Path (optional)" value={gcpCredentialsPath} onChange={(e) => setGcpCredentialsPath(e.currentTarget.value)} />
            </>
          )}
          <Button kind="primary" disabled={isRunning || !canRun} onClick={runEstimator}>{isRunning ? "Running..." : "Run Estimator"}</Button>
        </div>
      </Tile>

      {/* ---------- status / notifications ---------- */}
      {isRunning && (
        <Tile className="card" style={{ padding: "1.25rem" }}>
          <InlineLoading description={`Estimator ${status ?? "running"}...`} status="active" />
          {runId && <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: "0.5rem" }}>Run ID: {runId}</p>}
        </Tile>
      )}

      {!isRunning && message && (message.includes("failed") || message.includes("Error")) && (
        <ActionableNotification
          kind="error"
          title="Estimator Failed"
          subtitle={message}
          lowContrast
          inline
          actionButtonLabel="Retry"
          onActionButtonClick={runEstimator}
          hideCloseButton
        />
      )}

      {!isRunning && status === "completed" && message && !message.includes("failed") && (
        <ActionableNotification
          kind="success"
          title="Estimator Complete"
          subtitle={message}
          lowContrast
          inline
          actionButtonLabel="Re-run"
          onActionButtonClick={runEstimator}
          hideCloseButton
        />
      )}

      <Tile className="card table-card">
        <h3>Latest Estimator Summary</h3>
        <p className="helper-text">Mapping coverage: {coveragePct}% of discovered resources were mapped.</p>
        <div className="kpi-grid-inline">
          {metrics.map((metric) => (
            <div key={metric.label} className="metric-card">
              <h4>
                {metric.label}
                <span className="metric-help" tabIndex={0} aria-label={`${metric.label} definition`}>
                  i
                  <span className="metric-help-text">{metric.help}</span>
                </span>
              </h4>
              <p>{metric.value}</p>
            </div>
          ))}
        </div>
      </Tile>

      <Tile className="card table-card">
        <h3>Estimator Run History</h3>
        <DataTable
          rows={history.map((run) => ({
            id: run.id,
            provider: run.provider,
            createdAt: run.createdAt,
            status: run.status,
            discovered: String(run.summary?.discoveredResources ?? 0),
            candidates: String(run.summary?.rumCandidates ?? 0),
            mappingVersion: run.mapping?.mappingVersion ?? "",
            error: run.errorMessage ?? ""
          }))}
          headers={[
            { key: "provider", header: "Provider" },
            { key: "createdAt", header: "Created At" },
            { key: "status", header: "Status" },
            { key: "discovered", header: "Discovered" },
            { key: "candidates", header: "RUM Candidates" },
            { key: "mappingVersion", header: "Mapping Version" },
            { key: "error", header: "Error" }
          ]}
        >
          {({ rows, headers, getHeaderProps, getTableProps }) => (
            <TableContainer>
              <Table {...getTableProps()}>
                <TableHead>
                  <TableRow>
                    {headers.map((header) => (
                      <TableHeader {...getHeaderProps({ header })}>{header.header}</TableHeader>
                    ))}
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

      {renderCategoryTable("RUM Candidate Resources", candidateRows, "candidates")}
      {renderCategoryTable("Non-Manageable Resources", nonManageableRows, "non-manageable")}
      {renderCategoryTable("Unmapped Resources", unmappedRows, "unmapped")}

      <Tile className="card table-card">
        <h3>Top Unmapped Prefixes</h3>
        {topUnmapped.length === 0 ? (
          <p className="helper-text">No unmapped prefixes for the selected run.</p>
        ) : (
          <DataTable
            rows={topUnmapped.map((row, index) => ({
              id: `unmapped-prefix-${index}`,
              key: row.key,
              count: String(row.count),
              sample: row.sampleResourceId
            }))}
            headers={[
              { key: "key", header: "Prefix" },
              { key: "count", header: "Count" },
              { key: "sample", header: "Sample Resource ID" }
            ]}
          >
            {({ rows, headers, getHeaderProps, getTableProps }) => (
              <TableContainer>
                <Table {...getTableProps()}>
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHeader {...getHeaderProps({ header })}>{header.header}</TableHeader>
                      ))}
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
        )}
      </Tile>

      <Tile className="card table-card">
        <h3>Top Missing Permissions</h3>
        {topMissingPermissions.length === 0 ? (
          <p className="helper-text">No permission-related classification blockers detected.</p>
        ) : (
          <DataTable
            rows={topMissingPermissions.map((row, index) => ({
              id: `missing-perm-${index}`,
              permission: row.permission,
              count: String(row.count)
            }))}
            headers={[
              { key: "permission", header: "Permission" },
              { key: "count", header: "Count" }
            ]}
          >
            {({ rows, headers, getHeaderProps, getTableProps }) => (
              <TableContainer>
                <Table {...getTableProps()}>
                  <TableHead>
                    <TableRow>
                      {headers.map((header) => (
                        <TableHeader {...getHeaderProps({ header })}>{header.header}</TableHeader>
                      ))}
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
        )}
      </Tile>

      <Tile className="card table-card">
        <h3>IAM Remediation (Suggested)</h3>
        <p className="helper-text">
          Suggested read-only permissions for estimator discovery and classification based on current run diagnostics.
        </p>
        <div className="review-card">
          <strong>Actions</strong>
          <p className="helper-text">{suggestedPermissions.join(", ")}</p>
        </div>
        <div className="table-actions">
          <Button
            kind="secondary"
            size="sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(suggestedPolicyJson);
                setCopyPolicyStatus("Policy JSON copied.");
              } catch {
                setCopyPolicyStatus("Unable to copy policy JSON from browser.");
              }
            }}
          >
            Copy Policy JSON
          </Button>
          <Button
            kind="tertiary"
            size="sm"
            disabled={!runId}
            onClick={() => {
              if (!runId) return;
              window.open(getEstimatorIamRemediationPolicyExportUrl(runId), "_blank", "noopener,noreferrer");
            }}
          >
            Export Policy JSON
          </Button>
        </div>
        {copyPolicyStatus && <p className="helper-text">{copyPolicyStatus}</p>}
        <pre className="command-block">{suggestedPolicyJson}</pre>
      </Tile>
    </div>
  );
}
