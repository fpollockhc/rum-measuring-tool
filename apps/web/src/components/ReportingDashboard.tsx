import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  DataTable,
  InlineLoading,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableHeader,
  TableRow,
  Tile,
} from "@carbon/react";
import {
  getByBucketCumulative,
  getTfeMigrationRun,
  listEstimatorRuns,
  listScans,
  listTfeMigrationRuns,
} from "../lib/api";
import type { EstimatorRunRecord, ScanRecord, TfeMigrationRecord } from "../lib/api";

type SourceFilter = "all" | "managed" | "unmanaged" | "tfe";
type DimensionOption = "bySource" | "byProvider" | "byBucket" | "byProject" | "byWorkspace" | "byClassification";
type TopN = 5 | 10 | 25 | "all";

type ChartDatum = {
  id: string;
  name: string;
  rum: number;
  pct: number;
};

type RawData = {
  managedBuckets: any[];
  managedScans: ScanRecord[];
  estimatorRuns: EstimatorRunRecord[];
  tfeRuns: TfeMigrationRecord[];
};

const CHART_COLORS = [
  "#0f62fe", "#a56eff", "#24a148", "#f1620a", "#0043ce",
  "#8a3800", "#198038", "#6929c4", "#9ef0f0", "#d2a106",
];

const SOURCE_LABELS: Record<SourceFilter, string> = {
  all: "All Sources",
  managed: "Managed State",
  unmanaged: "Unmanaged",
  tfe: "TFE Migration",
};

const DIMENSION_LABELS: Record<DimensionOption, string> = {
  bySource: "By Source",
  byProvider: "By Provider",
  byBucket: "By Bucket",
  byProject: "By Project",
  byWorkspace: "By Workspace",
  byClassification: "By Classification",
};

const VALID_DIMENSIONS: Record<SourceFilter, DimensionOption[]> = {
  all: ["bySource"],
  managed: ["byProvider", "byBucket"],
  unmanaged: ["byClassification"],
  tfe: ["byProject", "byWorkspace"],
};

function getTopN(data: ChartDatum[], topN: TopN): ChartDatum[] {
  if (topN === "all") return data;
  return data.slice(0, topN);
}

function deriveChartData(
  rawData: RawData,
  sourceFilter: SourceFilter,
  dimensionOption: DimensionOption,
  topN: TopN
): ChartDatum[] {
  let items: ChartDatum[] = [];

  if (sourceFilter === "all") {
    const managedRum = rawData.managedBuckets.reduce((s: number, b: any) => s + (b.rum ?? 0), 0);
    const latestEstimator = rawData.estimatorRuns.find((r) => r.status === "completed");
    const unmanagedRum = latestEstimator?.summary?.rumCandidates ?? 0;
    const latestTfe = rawData.tfeRuns.find((r) => r.status === "completed");
    const tfeRum = latestTfe?.summary?.totalRum ?? 0;
    items = [
      { id: "managed", name: "Managed State", rum: managedRum, pct: 0 },
      { id: "unmanaged", name: "Unmanaged Estimator", rum: unmanagedRum, pct: 0 },
      { id: "tfe", name: "TFE Migration", rum: tfeRum, pct: 0 },
    ].filter((d) => d.rum > 0);
  } else if (sourceFilter === "managed") {
    if (dimensionOption === "byProvider") {
      const byProvider = new Map<string, number>();
      for (const b of rawData.managedBuckets) {
        const key = b.provider ?? "unknown";
        byProvider.set(key, (byProvider.get(key) ?? 0) + (b.rum ?? 0));
      }
      items = [...byProvider.entries()].map(([k, v]) => ({ id: k, name: k, rum: v, pct: 0 }));
    } else {
      items = rawData.managedBuckets.map((b: any, idx: number) => ({
        id: `${b.bucketName}-${idx}`,
        name: b.bucketName ?? "unknown",
        rum: b.rum ?? 0,
        pct: 0,
      }));
    }
  } else if (sourceFilter === "unmanaged") {
    const latestEstimator = rawData.estimatorRuns.find((r) => r.status === "completed");
    const s = latestEstimator?.summary;
    if (s) {
      items = [
        { id: "candidates", name: "RUM Candidates", rum: s.rumCandidates, pct: 0 },
        { id: "non-manageable", name: "Non-Manageable", rum: s.nonManageable, pct: 0 },
        { id: "unmapped", name: "Unmapped", rum: s.unmapped, pct: 0 },
      ].filter((d) => d.rum > 0);
    }
  } else if (sourceFilter === "tfe") {
    const latestTfe = rawData.tfeRuns.find((r) => r.status === "completed");
    if (latestTfe) {
      if (dimensionOption === "byProject" && latestTfe.byProject?.length) {
        items = latestTfe.byProject.map((p) => ({
          id: p.projectId,
          name: p.projectName,
          rum: p.rum,
          pct: 0,
        }));
      } else if (dimensionOption === "byWorkspace" && latestTfe.workspaces?.length) {
        items = latestTfe.workspaces.map((w) => ({
          id: w.workspaceId,
          name: w.workspaceName,
          rum: w.rum,
          pct: 0,
        }));
      } else {
        items = [{ id: "tfe-total", name: "TFE Total", rum: latestTfe.summary?.totalRum ?? 0, pct: 0 }];
      }
    }
  }

  items.sort((a, b) => b.rum - a.rum);
  const total = items.reduce((s, d) => s + d.rum, 0);
  items = items.map((d) => ({ ...d, pct: total > 0 ? Math.round((d.rum / total) * 100) : 0 }));
  return getTopN(items, topN);
}

function insightText(data: ChartDatum[], dimensionOption: DimensionOption, topN: TopN): string {
  if (data.length === 0) return "No data available for the selected filters.";
  const topLabel = DIMENSION_LABELS[dimensionOption].toLowerCase().replace("by ", "");
  const n = topN === "all" ? data.length : Math.min(data.length, topN);
  const topPct = data.slice(0, n).reduce((s, d) => s + d.pct, 0);
  const top = data[0];
  return `Your top ${n} ${topLabel}${n > 1 ? "s" : ""} account for ${topPct}% of billable RUM. The largest single ${topLabel} "${top.name}" contributes ${top.rum.toLocaleString()} RUM (${top.pct}%).`;
}

export function ReportingDashboard() {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [dimensionOption, setDimensionOption] = useState<DimensionOption>("bySource");
  const [topN, setTopN] = useState<TopN>(10);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [rawData, setRawData] = useState<RawData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const [bucketsRes, scansRes, estimatorRes, tfeRes] = await Promise.all([
          getByBucketCumulative(),
          listScans(),
          listEstimatorRuns(),
          listTfeMigrationRuns(),
        ]);

        const tfeRuns: TfeMigrationRecord[] = tfeRes.runs ?? [];
        const latestTfe = tfeRuns.find((r) => r.status === "completed");

        if (latestTfe && (!latestTfe.byProject || !latestTfe.workspaces)) {
          const detail = await getTfeMigrationRun(latestTfe.id).catch(() => null);
          if (detail) {
            const idx = tfeRuns.findIndex((r) => r.id === latestTfe.id);
            if (idx !== -1) tfeRuns[idx] = detail;
          }
        }

        setRawData({
          managedBuckets: bucketsRes.buckets ?? [],
          managedScans: scansRes.scans ?? [],
          estimatorRuns: estimatorRes.runs ?? [],
          tfeRuns,
        });
      } catch {
        setRawData({ managedBuckets: [], managedScans: [], estimatorRuns: [], tfeRuns: [] });
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  function handleSourceChange(s: SourceFilter) {
    setSourceFilter(s);
    setDimensionOption(VALID_DIMENSIONS[s][0]);
    setSelectedRowId(null);
  }

  const chartData = useMemo(() => {
    if (!rawData) return [];
    return deriveChartData(rawData, sourceFilter, dimensionOption, topN);
  }, [rawData, sourceFilter, dimensionOption, topN]);

  const insight = useMemo(() => insightText(chartData, dimensionOption, topN), [chartData, dimensionOption, topN]);

  const tableRows = chartData.map((d) => ({
    id: d.id,
    name: d.name,
    rum: d.rum.toLocaleString(),
    pct: `${d.pct}%`,
  }));

  const tableHeaders = [
    { key: "name", header: "Name" },
    { key: "rum", header: "RUM" },
    { key: "pct", header: "% of Total" },
  ];

  const validDimensions = VALID_DIMENSIONS[sourceFilter];

  if (loading) {
    return (
      <Tile className="card" style={{ padding: "2rem", textAlign: "center" }}>
        <InlineLoading description="Loading reporting data…" />
      </Tile>
    );
  }

  if (!rawData || chartData.length === 0) {
    return (
      <Tile className="card" style={{ padding: "1.5rem" }}>
        <p className="helper-text">No data available. Run a scan to populate the dashboard.</p>
      </Tile>
    );
  }

  return (
    <div className="reporting-tab">
      {/* Main 4-column grid: nav | donut | bar | insight */}
      <div className="reporting-main-grid">

        {/* Left: vertical nav */}
        <Tile className="card reporting-nav-panel">
          <div className="reporting-nav-section">
            <span className="reporting-nav-label">Source</span>
            {(["all", "managed", "unmanaged", "tfe"] as SourceFilter[]).map((s) => (
              <button
                key={s}
                className={`reporting-nav-item ${sourceFilter === s ? "active" : ""}`}
                onClick={() => handleSourceChange(s)}
              >
                {SOURCE_LABELS[s]}
              </button>
            ))}
          </div>

          {validDimensions.length > 1 && (
            <div className="reporting-nav-section">
              <span className="reporting-nav-label">Dimension</span>
              {validDimensions.map((d) => (
                <button
                  key={d}
                  className={`reporting-nav-item ${dimensionOption === d ? "active" : ""}`}
                  onClick={() => { setDimensionOption(d); setSelectedRowId(null); }}
                >
                  {DIMENSION_LABELS[d]}
                </button>
              ))}
            </div>
          )}

          <div className="reporting-nav-section">
            <span className="reporting-nav-label">Show</span>
            {([5, 10, 25, "all"] as TopN[]).map((n) => (
              <button
                key={String(n)}
                className={`reporting-nav-item ${topN === n ? "active" : ""}`}
                onClick={() => { setTopN(n); setSelectedRowId(null); }}
              >
                {n === "all" ? "All" : `Top ${n}`}
              </button>
            ))}
          </div>
        </Tile>

        {/* Donut chart */}
        <Tile className="card reporting-chart-card">
          <h3 className="reporting-chart-title">RUM Breakdown</h3>
          <ResponsiveContainer width="100%" height={360}>
            <PieChart>
              <Pie
                data={chartData}
                dataKey="rum"
                nameKey="name"
                cx="50%"
                cy="50%"
                innerRadius="52%"
                outerRadius="78%"
                onClick={(entry: any) => setSelectedRowId((prev) => (prev === entry.id ? null : entry.id))}
              >
                {chartData.map((entry, idx) => (
                  <Cell
                    key={entry.id}
                    fill={CHART_COLORS[idx % CHART_COLORS.length]}
                    opacity={selectedRowId && selectedRowId !== entry.id ? 0.25 : 1}
                    style={{ cursor: "pointer" }}
                  />
                ))}
              </Pie>
              <Tooltip formatter={(value) => typeof value === "number" ? value.toLocaleString() : String(value ?? "")} />
            </PieChart>
          </ResponsiveContainer>
          {/* Legend below chart */}
          <div className="reporting-legend">
            {chartData.map((entry, idx) => (
              <div
                key={entry.id}
                className={`reporting-legend-item ${selectedRowId === entry.id ? "selected" : selectedRowId ? "dimmed" : ""}`}
                onClick={() => setSelectedRowId((prev) => (prev === entry.id ? null : entry.id))}
              >
                <span className="legend-dot" style={{ background: CHART_COLORS[idx % CHART_COLORS.length] }} />
                <span className="legend-name">{entry.name}</span>
                <span className="legend-pct">{entry.pct}%</span>
              </div>
            ))}
          </div>
        </Tile>

        {/* Bar chart */}
        <Tile className="card reporting-chart-card">
          <h3 className="reporting-chart-title">
            RUM by {DIMENSION_LABELS[dimensionOption].replace("By ", "")}
          </h3>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart layout="vertical" data={chartData} margin={{ left: 0, right: 24, top: 4, bottom: 4 }}>
              <XAxis
                type="number"
                tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v))}
                tick={{ fontSize: 11 }}
              />
              <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 11 }} />
              <Tooltip formatter={(value) => typeof value === "number" ? value.toLocaleString() : String(value ?? "")} />
              <Bar dataKey="rum" name="RUM" radius={[0, 3, 3, 0]}>
                {chartData.map((entry, idx) => (
                  <Cell
                    key={entry.id}
                    fill={CHART_COLORS[idx % CHART_COLORS.length]}
                    opacity={selectedRowId && selectedRowId !== entry.id ? 0.25 : 1}
                    style={{ cursor: "pointer" }}
                    onClick={() => setSelectedRowId((prev) => (prev === entry.id ? null : entry.id))}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Tile>

        {/* Right: insight */}
        <Tile className="card reporting-insight-card">
          <span className="reporting-nav-label">Insight</span>
          <p className="reporting-insight-text">{insight}</p>
        </Tile>

      </div>

      {/* Detail table — full width below */}
      <Tile className="card table-card">
        <h3 style={{ marginBottom: "0.75rem" }}>Detail — {DIMENSION_LABELS[dimensionOption]}</h3>
        <DataTable rows={tableRows} headers={tableHeaders}>
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
                    const isSelected = selectedRowId === row.id;
                    const isDimmed = selectedRowId && !isSelected;
                    return (
                      <TableRow
                        key={row.id}
                        style={{
                          cursor: "pointer",
                          opacity: isDimmed ? 0.4 : 1,
                          background: isSelected ? "#e8f1ff" : undefined,
                        }}
                        onClick={() => setSelectedRowId((prev) => (prev === row.id ? null : row.id))}
                      >
                        {row.cells.map((cell) => (
                          <TableCell key={cell.id}>{cell.value}</TableCell>
                        ))}
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </TableContainer>
          )}
        </DataTable>
      </Tile>
    </div>
  );
}
