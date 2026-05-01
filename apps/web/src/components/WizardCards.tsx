import { useMemo, useState } from "react";
import {
  Button,
  Checkbox,
  DataTable,
  Form,
  FormGroup,
  InlineLoading,
  ActionableNotification,
  NumberInput,
  PasswordInput,
  ProgressIndicator,
  ProgressStep,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  TextInput,
  Tile
} from "@carbon/react";
import {
  getManagedScanResources,
  getManagedScanResourcesExportUrl,
  getScan,
  type ManagedResourceFinding,
  type ScanStatus,
  startScan
} from "../lib/api";

type Provider = "aws" | "azure" | "gcp" | "local";

type TargetInputs = {
  bucketName: string;
  prefix: string;
  storageAccountName: string;
  containerName: string;
  directoryPath: string;
  recursive: boolean;
  patterns: string;
};

const steps = ["Providers", "Targets", "Options", "Execution Env", "Review"];

export function WizardCards({ onScanStarted }: { onScanStarted: () => void }) {
  const [step, setStep] = useState(0);
  const [providers, setProviders] = useState<Provider[]>(["aws"]);
  const [targets, setTargets] = useState<Record<Provider, TargetInputs>>({
    aws: {
      bucketName: "customer-terraform-states",
      prefix: "",
      storageAccountName: "",
      containerName: "",
      directoryPath: "",
      recursive: true,
      patterns: "*.tfstate,*.tfstate.json"
    },
    azure: {
      bucketName: "",
      prefix: "",
      storageAccountName: "",
      containerName: "",
      directoryPath: "",
      recursive: true,
      patterns: "*.tfstate,*.tfstate.json"
    },
    gcp: {
      bucketName: "",
      prefix: "",
      storageAccountName: "",
      containerName: "",
      directoryPath: "",
      recursive: true,
      patterns: "*.tfstate,*.tfstate.json"
    },
    local: {
      bucketName: "",
      prefix: "",
      storageAccountName: "",
      containerName: "",
      directoryPath: "fixtures/synthetic",
      recursive: true,
      patterns: "*.tfstate,*.tfstate.json"
    }
  });

  const [dryRun, setDryRun] = useState(true);
  const [concurrency, setConcurrency] = useState(10);
  const [maxObjects, setMaxObjects] = useState(1000);
  const [isRunning, setIsRunning] = useState(false);

  const [awsRegion, setAwsRegion] = useState("");
  const [awsProfile, setAwsProfile] = useState("");
  const [awsAccessKeyId, setAwsAccessKeyId] = useState("");
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState("");
  const [awsSessionToken, setAwsSessionToken] = useState("");
  const [azureSubscriptionId, setAzureSubscriptionId] = useState("");
  const [azureTenantId, setAzureTenantId] = useState("");
  const [gcpProjectId, setGcpProjectId] = useState("");
  const [googleApplicationCredentials, setGoogleApplicationCredentials] = useState("");

  const [scanId, setScanId] = useState<string>("");
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [managedFilter, setManagedFilter] = useState<"all" | "included" | "excluded">("all");
  const [managedRows, setManagedRows] = useState<ManagedResourceFinding[]>([]);

  function toggleProvider(provider: Provider, checked: boolean): void {
    setProviders((prev) => {
      if (checked) {
        return prev.includes(provider) ? prev : [...prev, provider];
      }
      return prev.filter((p) => p !== provider);
    });
  }

  function updateTarget(provider: Provider, key: keyof TargetInputs, value: string): void {
    setTargets((prev) => ({
      ...prev,
      [provider]: {
        ...prev[provider],
        [key]: value
      }
    }));
  }

  function validateTargets(): boolean {
    return providers.every((provider) => {
      const target = targets[provider];
      if (provider === "azure") {
        return target.storageAccountName.trim().length > 0 && target.containerName.trim().length > 0;
      }
      if (provider === "local") {
        return target.directoryPath.trim().length > 0;
      }
      return target.bucketName.trim().length > 0;
    });
  }

  const canNext = useMemo(() => {
    if (step === 0) return providers.length > 0;
    if (step === 1) return validateTargets();
    if (step === 3 && providers.includes("aws")) {
      const hasKey = awsAccessKeyId.trim().length > 0;
      const hasSecret = awsSecretAccessKey.trim().length > 0;
      return hasKey === hasSecret;
    }
    return true;
  }, [step, providers, targets, awsAccessKeyId, awsSecretAccessKey]);

  async function runScan() {
    setErrorMessage("");
    setStatusMessage("");
    setScanStatus(null);
    setIsRunning(true);

    const targetPayload = providers.map((provider) => {
      const target = targets[provider];
      if (provider === "azure") {
        return {
          provider,
          storageAccountName: target.storageAccountName || undefined,
          containerName: target.containerName || undefined,
          prefix: target.prefix || undefined
        };
      }
      if (provider === "local") {
        return {
          provider,
          directoryPath: target.directoryPath || undefined,
          recursive: target.recursive,
          patterns: target.patterns.split(",").map((v) => v.trim()).filter(Boolean)
        };
      }
      return {
        provider,
        bucketName: target.bucketName || undefined,
        prefix: target.prefix || undefined
      };
    });

    try {
      const created = await startScan({
        providers,
        targets: targetPayload,
        options: { dryRun, concurrency, maxObjects },
        executionEnv: {
          awsRegion: awsRegion || undefined,
          awsProfile: awsProfile || undefined,
          awsAccessKeyId: awsAccessKeyId || undefined,
          awsSecretAccessKey: awsSecretAccessKey || undefined,
          awsSessionToken: awsSessionToken || undefined,
          azureSubscriptionId: azureSubscriptionId || undefined,
          azureTenantId: azureTenantId || undefined,
          gcpProjectId: gcpProjectId || undefined,
          googleApplicationCredentials: googleApplicationCredentials || undefined
        }
      });

      setScanId(created.id);
      setScanStatus(created.status);
      setStatusMessage(`Scan ${created.id} queued.`);
      await pollScanUntilDone(created.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      setErrorMessage(`Failed to start or track scan: ${message}`);
    } finally {
      setIsRunning(false);
    }
  }

  async function pollScanUntilDone(id: string): Promise<void> {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const scan = await getScan(id);
      setScanStatus(scan.status);
      if (scan.status === "queued") {
        setStatusMessage(`Scan ${id} queued...`);
      }
      if (scan.status === "running") {
        setStatusMessage(`Scan ${id} running...`);
      }
      if (scan.status === "completed") {
        await loadManagedResources(id, managedFilter);
        setStatusMessage(
          `Scan ${id} completed. Parsed ${scan.summary?.stateFilesParsed ?? 0} files, total RUM ${scan.summary?.totalRum ?? 0}.`
        );
        onScanStarted();
        return;
      }
      if (scan.status === "failed") {
        setErrorMessage(`Scan ${id} failed: ${scan.errorMessage ?? "unknown error"}. Check provider credentials/CLI/prefix settings.`);
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    setErrorMessage(`Scan ${id} timed out waiting for completion.`);
  }

  async function loadManagedResources(id: string, status: "all" | "included" | "excluded"): Promise<void> {
    try {
      const data = await getManagedScanResources(id, status);
      setManagedRows(data.rows);
    } catch {
      setManagedRows([]);
    }
  }

  return (
    <Tile className="card">
      <h3>Guided Scan Setup</h3>
      <ProgressIndicator currentIndex={step} spaceEqually>
        {steps.map((label) => (
          <ProgressStep key={label} label={label} />
        ))}
      </ProgressIndicator>

      <Form className="wizard-form">
        {step === 0 && (
          <FormGroup legendText="Choose cloud providers">
            <Checkbox
              id="provider-aws"
              labelText="AWS"
              checked={providers.includes("aws")}
              onChange={(_evt: unknown, { checked }: { checked: boolean | "indeterminate" }) =>
                toggleProvider("aws", Boolean(checked))
              }
            />
            <Checkbox
              id="provider-azure"
              labelText="Azure"
              checked={providers.includes("azure")}
              onChange={(_evt: unknown, { checked }: { checked: boolean | "indeterminate" }) =>
                toggleProvider("azure", Boolean(checked))
              }
            />
            <Checkbox
              id="provider-gcp"
              labelText="GCP"
              checked={providers.includes("gcp")}
              onChange={(_evt: unknown, { checked }: { checked: boolean | "indeterminate" }) =>
                toggleProvider("gcp", Boolean(checked))
              }
            />
            <Checkbox
              id="provider-local"
              labelText="Local Directory"
              checked={providers.includes("local")}
              onChange={(_evt: unknown, { checked }: { checked: boolean | "indeterminate" }) =>
                toggleProvider("local", Boolean(checked))
              }
            />
          </FormGroup>
        )}

        {step === 1 && (
          <>
            {providers.includes("aws") && (
              <div className="provider-card">
                <h4>AWS Target</h4>
                <TextInput
                  id="aws-bucket"
                  labelText="S3 Bucket Name"
                  value={targets.aws.bucketName}
                  onChange={(e) => updateTarget("aws", "bucketName", e.currentTarget.value)}
                  placeholder="terraform-state-bucket"
                />
                <TextInput
                  id="aws-prefix"
                  labelText="Object Prefix (optional)"
                  value={targets.aws.prefix}
                  onChange={(e) => updateTarget("aws", "prefix", e.currentTarget.value)}
                  placeholder="team-a/prod/"
                />
              </div>
            )}

            {providers.includes("azure") && (
              <div className="provider-card">
                <h4>Azure Target</h4>
                <TextInput
                  id="azure-storage-account"
                  labelText="Storage Account Name"
                  value={targets.azure.storageAccountName}
                  onChange={(e) => updateTarget("azure", "storageAccountName", e.currentTarget.value)}
                  placeholder="tfstateaccount"
                />
                <TextInput
                  id="azure-container"
                  labelText="Container Name"
                  value={targets.azure.containerName}
                  onChange={(e) => updateTarget("azure", "containerName", e.currentTarget.value)}
                  placeholder="tfstate"
                />
                <TextInput
                  id="azure-prefix"
                  labelText="Blob Prefix (optional)"
                  value={targets.azure.prefix}
                  onChange={(e) => updateTarget("azure", "prefix", e.currentTarget.value)}
                  placeholder="prod/"
                />
              </div>
            )}

            {providers.includes("gcp") && (
              <div className="provider-card">
                <h4>GCP Target</h4>
                <TextInput
                  id="gcp-bucket"
                  labelText="GCS Bucket Name"
                  value={targets.gcp.bucketName}
                  onChange={(e) => updateTarget("gcp", "bucketName", e.currentTarget.value)}
                  placeholder="tfstate-bucket"
                />
                <TextInput
                  id="gcp-prefix"
                  labelText="Object Prefix (optional)"
                  value={targets.gcp.prefix}
                  onChange={(e) => updateTarget("gcp", "prefix", e.currentTarget.value)}
                  placeholder="env/prod/"
                />
              </div>
            )}

            {providers.includes("local") && (
              <div className="provider-card">
                <h4>Local Directory Target</h4>
                <TextInput
                  id="local-directory"
                  labelText="Directory Path"
                  value={targets.local.directoryPath}
                  onChange={(e) => updateTarget("local", "directoryPath", e.currentTarget.value)}
                  placeholder="fixtures/synthetic"
                />
                <TextInput
                  id="local-patterns"
                  labelText="File Patterns (comma-separated)"
                  value={targets.local.patterns}
                  onChange={(e) => updateTarget("local", "patterns", e.currentTarget.value)}
                  placeholder="*.tfstate,*.tfstate.json"
                />
                <Checkbox
                  id="local-recursive"
                  labelText="Recursive directory scan"
                  checked={targets.local.recursive}
                  onChange={(_evt: unknown, { checked }: { checked: boolean | "indeterminate" }) =>
                    setTargets((prev) => ({
                      ...prev,
                      local: {
                        ...prev.local,
                        recursive: Boolean(checked)
                      }
                    }))
                  }
                />
              </div>
            )}
          </>
        )}

        {step === 2 && (
          <>
            <Checkbox
              id="dry-run"
              labelText="Dry run mode"
              checked={dryRun}
              onChange={(_evt: unknown, { checked }: { checked: boolean | "indeterminate" }) => setDryRun(Boolean(checked))}
            />
            <NumberInput
              id="concurrency"
              label="Concurrency"
              value={concurrency}
              min={1}
              max={100}
              onChange={(_event, state) => setConcurrency(Number(state.value || 10))}
            />
            <NumberInput
              id="max-objects"
              label="Max objects"
              value={maxObjects}
              min={1}
              max={100000}
              onChange={(_event, state) => setMaxObjects(Number(state.value || 1000))}
            />
          </>
        )}

        {step === 3 && (
          <>
            <p className="helper-text">
              Optional per-scan environment variables. Prefer short-lived identities (profiles, role-based auth, managed identities) over static keys.
            </p>

            {providers.includes("aws") && (
              <div className="provider-card">
                <h4>AWS Execution Env</h4>
                <TextInput id="aws-region" labelText="AWS Region (optional)" value={awsRegion} onChange={(e) => setAwsRegion(e.currentTarget.value)} placeholder="us-east-1" />
                <TextInput id="aws-profile" labelText="AWS Profile (optional)" value={awsProfile} onChange={(e) => setAwsProfile(e.currentTarget.value)} placeholder="default" />
                <TextInput id="aws-access-key" labelText="AWS Access Key ID (optional)" value={awsAccessKeyId} onChange={(e) => setAwsAccessKeyId(e.currentTarget.value)} placeholder="AKIA..." />
                <PasswordInput id="aws-secret-key" labelText="AWS Secret Access Key (optional)" value={awsSecretAccessKey} onChange={(e) => setAwsSecretAccessKey(e.currentTarget.value)} placeholder="Enter secret access key" />
                <PasswordInput id="aws-session-token" labelText="AWS Session Token (optional)" value={awsSessionToken} onChange={(e) => setAwsSessionToken(e.currentTarget.value)} placeholder="Temporary session token" />
                {(awsAccessKeyId && !awsSecretAccessKey) || (!awsAccessKeyId && awsSecretAccessKey) ? (
                  <p className="scan-error">Provide both AWS Access Key ID and AWS Secret Access Key, or leave both empty.</p>
                ) : null}
              </div>
            )}

            {providers.includes("azure") && (
              <div className="provider-card">
                <h4>Azure Execution Env</h4>
                <TextInput id="azure-subscription" labelText="Azure Subscription ID (optional)" value={azureSubscriptionId} onChange={(e) => setAzureSubscriptionId(e.currentTarget.value)} placeholder="00000000-0000-0000-0000-000000000000" />
                <TextInput id="azure-tenant" labelText="Azure Tenant ID (optional)" value={azureTenantId} onChange={(e) => setAzureTenantId(e.currentTarget.value)} placeholder="00000000-0000-0000-0000-000000000000" />
              </div>
            )}

            {providers.includes("gcp") && (
              <div className="provider-card">
                <h4>GCP Execution Env</h4>
                <TextInput id="gcp-project" labelText="GCP Project ID (optional)" value={gcpProjectId} onChange={(e) => setGcpProjectId(e.currentTarget.value)} placeholder="my-project-id" />
                <TextInput id="gcp-creds-path" labelText="GOOGLE_APPLICATION_CREDENTIALS path (optional)" value={googleApplicationCredentials} onChange={(e) => setGoogleApplicationCredentials(e.currentTarget.value)} placeholder="/path/to/service-account.json" />
              </div>
            )}
          </>
        )}

        {step === 4 && (
          <div className="review-card">
            <p><strong>Providers:</strong> {providers.join(", ")}</p>
            {providers.includes("aws") && <p><strong>AWS Target:</strong> {targets.aws.bucketName} {targets.aws.prefix ? `(prefix: ${targets.aws.prefix})` : ""}</p>}
            {providers.includes("azure") && <p><strong>Azure Target:</strong> {targets.azure.storageAccountName}/{targets.azure.containerName} {targets.azure.prefix ? `(prefix: ${targets.azure.prefix})` : ""}</p>}
            {providers.includes("gcp") && <p><strong>GCP Target:</strong> {targets.gcp.bucketName} {targets.gcp.prefix ? `(prefix: ${targets.gcp.prefix})` : ""}</p>}
            {providers.includes("local") && <p><strong>Local Target:</strong> {targets.local.directoryPath} {targets.local.patterns ? `(patterns: ${targets.local.patterns})` : ""}</p>}
            <p><strong>Dry run:</strong> {dryRun ? "yes" : "no"}</p>
            <p><strong>Concurrency:</strong> {concurrency}</p>
            <p><strong>Max objects:</strong> {maxObjects}</p>
          </div>
        )}

        <div className="wizard-actions">
          <Button kind="secondary" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
            Back
          </Button>
          {step < steps.length - 1 ? (
            <Button disabled={!canNext} onClick={() => setStep((s) => s + 1)}>
              Next
            </Button>
          ) : (
            <Button disabled={isRunning} onClick={runScan}>
              {isRunning ? "Running..." : "Run Scan"}
            </Button>
          )}
        </div>

        {isRunning && (
          <div style={{ marginTop: "0.75rem" }} role="status" aria-live="polite">
            <InlineLoading description={`Scan ${scanStatus ?? "running"}...`} status="active" />
            {scanId && <p style={{ fontSize: "0.85rem", color: "#64748b", marginTop: "0.25rem" }}>Scan ID: {scanId}</p>}
          </div>
        )}

        {!isRunning && errorMessage && (
          <div style={{ marginTop: "0.75rem" }}>
            <ActionableNotification
              kind="error"
              title="Scan Failed"
              subtitle={errorMessage}
              lowContrast
              inline
              actionButtonLabel="Retry"
              onActionButtonClick={runScan}
              hideCloseButton
            />
          </div>
        )}

        {!isRunning && statusMessage && !errorMessage && scanStatus === "completed" && (
          <div style={{ marginTop: "0.75rem" }}>
            <ActionableNotification
              kind="success"
              title="Scan Complete"
              subtitle={statusMessage}
              lowContrast
              inline
              actionButtonLabel="Re-run"
              onActionButtonClick={runScan}
              hideCloseButton
            />
          </div>
        )}

        {scanId && scanStatus === "completed" && (
          <div className="scan-status-panel">
            <div className="table-header-row">
              <h4>Managed Resource Findings</h4>
              <div className="table-actions">
                <Button kind={managedFilter === "all" ? "primary" : "tertiary"} size="sm" onClick={() => { setManagedFilter("all"); void loadManagedResources(scanId, "all"); }}>All</Button>
                <Button kind={managedFilter === "included" ? "primary" : "tertiary"} size="sm" onClick={() => { setManagedFilter("included"); void loadManagedResources(scanId, "included"); }}>Included</Button>
                <Button kind={managedFilter === "excluded" ? "primary" : "tertiary"} size="sm" onClick={() => { setManagedFilter("excluded"); void loadManagedResources(scanId, "excluded"); }}>Excluded</Button>
                <Button kind="tertiary" size="sm" onClick={() => window.open(getManagedScanResourcesExportUrl(scanId, managedFilter, "json"), "_blank", "noopener,noreferrer")}>Export JSON</Button>
                <Button kind="secondary" size="sm" onClick={() => window.open(getManagedScanResourcesExportUrl(scanId, managedFilter, "csv"), "_blank", "noopener,noreferrer")}>Export CSV</Button>
              </div>
            </div>
            {(() => {
              const fanoutCount = managedRows.filter((r) => (r.instanceCount ?? 1) > 1).length;
              return fanoutCount > 0 ? (
                <div className="fanout-warning">
                  <strong>count/for_each expansion detected:</strong> {fanoutCount} resource block{fanoutCount > 1 ? "s" : ""} fan out to multiple instances — these contribute more RUM than their block count suggests.
                </div>
              ) : null;
            })()}
            {managedRows.length === 0 ? (
              <p className="helper-text">No managed findings for this filter.</p>
            ) : (
              <DataTable
                rows={managedRows.map((row) => ({
                  id: row.id,
                  provider: row.provider,
                  stateFile: row.stateFile,
                  resourceAddress: row.resourceAddress,
                  candidateStatus: row.candidateStatus,
                  rumCount: String(row.rumCount),
                  ruleCode: row.ruleCode
                }))}
                headers={[
                  { key: "provider", header: "Provider" },
                  { key: "stateFile", header: "State File" },
                  { key: "resourceAddress", header: "Resource Address" },
                  { key: "candidateStatus", header: "Candidate Status" },
                  { key: "rumCount", header: "RUM Count" },
                  { key: "ruleCode", header: "Rule Code" }
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
                        {rows.map((row) => {
                          const originalRow = managedRows.find((r) => r.id === row.id);
                          const instanceCount = originalRow?.instanceCount ?? 1;
                          return (
                            <TableRow key={row.id}>
                              {row.cells.map((cell) => (
                                <TableCell key={cell.id}>
                                  {cell.info.header === "rumCount" && instanceCount > 1 ? (
                                    <span style={{ display: "flex", alignItems: "center", gap: "0.4rem" }}>
                                      {cell.value}
                                      <Tag type="warm-gray" size="sm">{instanceCount}x expansion</Tag>
                                    </span>
                                  ) : cell.value}
                                </TableCell>
                              ))}
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </DataTable>
            )}
          </div>
        )}
      </Form>
    </Tile>
  );
}
