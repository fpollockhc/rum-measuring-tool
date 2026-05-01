import { useEffect, useState } from "react";
import {
  Button,
  DataTable,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tag,
  Tile
} from "@carbon/react";
import { getByBucket, getCumulativeSummary, getManagedScanResources, getManagedScanResourcesExportUrl, getSummary, listScans } from "../lib/api";

type Summary = {
  bucketsScanned: number;
  stateFilesParsed: number;
  totalRum: number;
  excludedResources: number;
  parseErrors?: number;
};

type CumulativeSummary = Summary & {
  completedRuns: number;
  uniqueBuckets?: number;
};

type BucketRow = { id: string; bucketName: string; provider: string; rum: string; stateFiles: string; parseErrors: string };
type HistoryRow = {
  id: string;
  createdAt: string;
  status: string;
  totalRum: string;
  stateFilesParsed: string;
  parseErrors: string;
  error: string;
};
type ManagedResourceRow = {
  id: string;
  provider: string;
  targetName: string;
  stateFile: string;
  resourceAddress: string;
  candidateStatus: string;
  rumCount: string;
  instanceCount: number;
  ruleCode: string;
  ruleReason: string;
};

const summaryDefaults: Summary = {
  bucketsScanned: 0,
  stateFilesParsed: 0,
  totalRum: 0,
  excludedResources: 0,
  parseErrors: 0
};

const cumulativeDefaults: CumulativeSummary = {
  completedRuns: 0,
  uniqueBuckets: 0,
  bucketsScanned: 0,
  stateFilesParsed: 0,
  totalRum: 0,
  excludedResources: 0,
  parseErrors: 0
};

export function Dashboard({ refreshKey }: { refreshKey: number }) {
  const [summary, setSummary] = useState<Summary>(summaryDefaults);
  const [cumulative, setCumulative] = useState<CumulativeSummary>(cumulativeDefaults);
  const [bucketRows, setBucketRows] = useState<BucketRow[]>([]);
  const [historyRows, setHistoryRows] = useState<HistoryRow[]>([]);
  const [latestCompletedScanId, setLatestCompletedScanId] = useState<string>("");
  const [resourceStatusFilter, setResourceStatusFilter] = useState<"all" | "included" | "excluded">("all");
  const [managedResourceRows, setManagedResourceRows] = useState<ManagedResourceRow[]>([]);

  useEffect(() => {
    async function refresh() {
      const [summaryData, cumulativeData, bucketData, scanData] = await Promise.all([
        getSummary(),
        getCumulativeSummary(),
        getByBucket(),
        listScans()
      ]);
      setSummary(summaryData);
      setCumulative(cumulativeData);
      setBucketRows(
        (bucketData.buckets ?? []).map((b: any, idx: number) => ({
          id: `${b.bucketName}-${idx}`,
          bucketName: b.bucketName,
          provider: b.provider,
          rum: String(b.rum),
          stateFiles: String(b.stateFiles),
          parseErrors: String(b.parseErrors ?? 0)
        }))
      );
      const scans = (scanData.scans ?? []) as any[];
      setHistoryRows(
        scans.map((scan: any) => ({
          id: scan.id,
          createdAt: scan.createdAt ?? "",
          status: scan.status,
          totalRum: String(scan.summary?.totalRum ?? 0),
          stateFilesParsed: String(scan.summary?.stateFilesParsed ?? 0),
          parseErrors: String(scan.summary?.parseErrors ?? 0),
          error: scan.errorMessage ?? ""
        }))
      );
      const latestCompleted = scans.find((scan) => scan.status === "completed");
      const scanId = latestCompleted?.id ?? "";
      setLatestCompletedScanId(scanId);
      if (scanId) {
        const resourcesData = await getManagedScanResources(scanId, resourceStatusFilter);
        setManagedResourceRows(
          resourcesData.rows.map((row) => ({
            id: row.id,
            provider: row.provider,
            targetName: row.targetName,
            stateFile: row.stateFile,
            resourceAddress: row.resourceAddress,
            candidateStatus: row.candidateStatus,
            rumCount: String(row.rumCount),
            instanceCount: row.instanceCount ?? 1,
            ruleCode: row.ruleCode,
            ruleReason: row.ruleReason
          }))
        );
      } else {
        setManagedResourceRows([]);
      }
    }
    void refresh();
  }, [refreshKey, resourceStatusFilter]);

  const fanoutCount = managedResourceRows.filter((r) => r.instanceCount > 1).length;

  return (
    <div className="dashboard-grid">
      <Tile className="card kpi-group">
        <h3>Latest Run</h3>
        <div className="kpi-grid-inline">
          <div><h4>Buckets Scanned</h4><p>{summary.bucketsScanned}</p></div>
          <div><h4>State Files Parsed</h4><p>{summary.stateFilesParsed}</p></div>
          <div>
            <h4>
              Total RUM
              <span className="metric-help" tabIndex={0} aria-label="Total RUM definition">
                i
                <span className="metric-help-text">
                  Point-in-time snapshot of all managed resource instances in scanned state files.
                  TFE licenses on an annual monthly average basis — use the Pack Sizing panel below
                  to translate this into a pack recommendation.
                </span>
              </span>
            </h4>
            <p>{summary.totalRum}</p>
            <p style={{ fontSize: "0.75rem", margin: "0.1rem 0 0", color: "#64748b" }}>Point-in-time peak</p>
          </div>
          <div><h4>Excluded Resources</h4><p>{summary.excludedResources}</p></div>
          <div><h4>Parse Errors</h4><p>{summary.parseErrors ?? 0}</p></div>
        </div>
      </Tile>

      <Tile className="card kpi-group">
        <h3>Cumulative (All Completed Runs)</h3>
        <div className="kpi-grid-inline">
          <div><h4>Completed Runs</h4><p>{cumulative.completedRuns}</p></div>
          <div><h4>Unique Buckets</h4><p>{cumulative.uniqueBuckets ?? cumulative.bucketsScanned}</p></div>
          <div><h4>Buckets Scanned</h4><p>{cumulative.bucketsScanned}</p></div>
          <div><h4>State Files Parsed</h4><p>{cumulative.stateFilesParsed}</p></div>
          <div>
            <h4>
              Total RUM
              <span className="metric-help" tabIndex={0} aria-label="Cumulative Total RUM definition">
                i
                <span className="metric-help-text">
                  Aggregate RUM across all completed runs, de-duplicated by unique bucket.
                  Re-scanning the same bucket updates that bucket's snapshot rather than inflating totals.
                </span>
              </span>
            </h4>
            <p>{cumulative.totalRum}</p>
            <p style={{ fontSize: "0.75rem", margin: "0.1rem 0 0", color: "#64748b" }}>Across completed runs</p>
          </div>
          <div><h4>Excluded Resources</h4><p>{cumulative.excludedResources}</p></div>
          <div><h4>Parse Errors</h4><p>{cumulative.parseErrors ?? 0}</p></div>
        </div>
      </Tile>

      <Tile className="card table-card">
        <h3>RUM by bucket_name (Latest Run)</h3>
        <DataTable
          rows={bucketRows}
          headers={[
            { key: "bucketName", header: "Bucket" },
            { key: "provider", header: "Provider" },
            { key: "rum", header: "RUM" },
            { key: "stateFiles", header: "State Files" },
            { key: "parseErrors", header: "Parse Errors" }
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

      <Tile className="card table-card">
        <h3>Scan History</h3>
        <DataTable
          rows={historyRows}
          headers={[
            { key: "createdAt", header: "Created At" },
            { key: "status", header: "Status" },
            { key: "totalRum", header: "Total RUM" },
            { key: "stateFilesParsed", header: "State Files" },
            { key: "parseErrors", header: "Parse Errors" },
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

      <Tile className="card table-card">
        <div className="table-header-row">
          <h3>Latest Managed Resource Findings</h3>
          <div className="table-actions">
            <Button kind={resourceStatusFilter === "all" ? "primary" : "tertiary"} size="sm" onClick={() => setResourceStatusFilter("all")}>All</Button>
            <Button kind={resourceStatusFilter === "included" ? "primary" : "tertiary"} size="sm" onClick={() => setResourceStatusFilter("included")}>Included</Button>
            <Button kind={resourceStatusFilter === "excluded" ? "primary" : "tertiary"} size="sm" onClick={() => setResourceStatusFilter("excluded")}>Excluded</Button>
            <Button
              kind="tertiary"
              size="sm"
              disabled={!latestCompletedScanId}
              onClick={() => {
                if (!latestCompletedScanId) return;
                window.open(getManagedScanResourcesExportUrl(latestCompletedScanId, resourceStatusFilter, "json"), "_blank", "noopener,noreferrer");
              }}
            >
              Export JSON
            </Button>
            <Button
              kind="secondary"
              size="sm"
              disabled={!latestCompletedScanId}
              onClick={() => {
                if (!latestCompletedScanId) return;
                window.open(getManagedScanResourcesExportUrl(latestCompletedScanId, resourceStatusFilter, "csv"), "_blank", "noopener,noreferrer");
              }}
            >
              Export CSV
            </Button>
          </div>
        </div>
        {fanoutCount > 0 && (
          <div className="fanout-warning">
            <strong>count/for_each expansion detected:</strong> {fanoutCount} resource block{fanoutCount > 1 ? "s" : ""} fan out to multiple instances — these contribute more RUM than their block count suggests. This is the most common source of billing surprises.
          </div>
        )}
        {managedResourceRows.length === 0 ? (
          <p className="helper-text">No managed resource findings for the selected run/filter.</p>
        ) : (
          <DataTable
            rows={managedResourceRows}
            headers={[
              { key: "provider", header: "Provider" },
              { key: "targetName", header: "Target" },
              { key: "stateFile", header: "State File" },
              { key: "resourceAddress", header: "Resource Address" },
              { key: "candidateStatus", header: "Candidate Status" },
              { key: "rumCount", header: "RUM Count" },
              { key: "ruleCode", header: "Rule Code" },
              { key: "ruleReason", header: "Rule Reason" }
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
                      const originalRow = managedResourceRows.find((r) => r.id === row.id);
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
      </Tile>
    </div>
  );
}
