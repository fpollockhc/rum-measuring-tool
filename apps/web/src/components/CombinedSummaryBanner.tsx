import { useEffect, useState, useCallback } from "react";
import { Tile } from "@carbon/react";
import { getCombinedRumSummary } from "../lib/api";
import type { CombinedRumSummary } from "../lib/api";

/** Polling interval for the combined summary (ms) */
const POLL_INTERVAL = 5_000;

/** Colors for the stacked bar segments */
const SOURCE_COLORS = {
  managed: "#0f62fe",       // Carbon blue-60
  unmanaged: "#a56eff",     // Carbon purple-50
  tfeMigration: "#24a148"   // Carbon green-50
} as const;

const SOURCE_LABELS = {
  managed: "Managed State (TFC)",
  unmanaged: "Unmanaged (Cloud)",
  tfeMigration: "TFE Migration"
} as const;

export function CombinedSummaryBanner() {
  const [data, setData] = useState<CombinedRumSummary | null>(null);

  const refresh = useCallback(async () => {
    try {
      const summary = await getCombinedRumSummary();
      setData(summary);
    } catch {
      // Silently ignore — banner just doesn't render if API is down
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_INTERVAL);
    return () => clearInterval(timer);
  }, [refresh]);

  // Don't render until at least one source has data
  if (!data || data.activeSources === 0) return null;

  const { totalBillableRum, totalNonBillable, totalResources, sources } = data;

  // Build bar segments
  const segments: Array<{ key: string; label: string; rum: number; color: string }> = [];
  if (sources.managed) {
    segments.push({ key: "managed", label: SOURCE_LABELS.managed, rum: sources.managed.billableRum, color: SOURCE_COLORS.managed });
  }
  if (sources.unmanaged) {
    segments.push({ key: "unmanaged", label: SOURCE_LABELS.unmanaged, rum: sources.unmanaged.billableRum, color: SOURCE_COLORS.unmanaged });
  }
  if (sources.tfeMigration) {
    segments.push({ key: "tfeMigration", label: SOURCE_LABELS.tfeMigration, rum: sources.tfeMigration.billableRum, color: SOURCE_COLORS.tfeMigration });
  }

  return (
    <Tile className="card combined-summary-banner" style={{ padding: "1.25rem" }}>
      <div className="combined-summary-header">
        <h3 style={{ margin: 0 }}>Combined RUM Summary</h3>
        <span className="combined-summary-source-count">
          {data.activeSources} source{data.activeSources !== 1 ? "s" : ""}
        </span>
      </div>

      {/* KPI row */}
      <div className="combined-summary-kpis">
        <div className="combined-summary-kpi combined-summary-kpi--primary">
          <span className="combined-summary-kpi-label">
            Billable RUM
            <span className="metric-help" tabIndex={0}>
              i
              <span className="metric-help-text">
                Total billable Resources Under Management across all scan sources.
              </span>
            </span>
          </span>
          <span className="combined-summary-kpi-value">{totalBillableRum.toLocaleString()}</span>
        </div>
        <div className="combined-summary-kpi">
          <span className="combined-summary-kpi-label">Non-Billable</span>
          <span className="combined-summary-kpi-value">{totalNonBillable.toLocaleString()}</span>
        </div>
        <div className="combined-summary-kpi">
          <span className="combined-summary-kpi-label">Total Resources</span>
          <span className="combined-summary-kpi-value">{totalResources.toLocaleString()}</span>
        </div>
      </div>

      {/* Stacked bar */}
      {totalBillableRum > 0 && (
        <div className="combined-summary-bar-container">
          <div className="combined-summary-bar">
            {segments.map((seg) => {
              const pct = totalBillableRum > 0 ? (seg.rum / totalBillableRum) * 100 : 0;
              if (pct === 0) return null;
              return (
                <div
                  key={seg.key}
                  className="combined-summary-bar-segment"
                  style={{ width: `${pct}%`, backgroundColor: seg.color }}
                  title={`${seg.label}: ${seg.rum.toLocaleString()} RUM (${pct.toFixed(1)}%)`}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="combined-summary-legend">
        {segments.map((seg) => {
          const pct = totalBillableRum > 0 ? (seg.rum / totalBillableRum) * 100 : 0;
          return (
            <div key={seg.key} className="combined-summary-legend-item">
              <span
                className="combined-summary-legend-swatch"
                style={{ backgroundColor: seg.color }}
              />
              <span className="combined-summary-legend-label">{seg.label}</span>
              <span className="combined-summary-legend-value">
                {seg.rum.toLocaleString()} <span className="combined-summary-legend-pct">({pct.toFixed(1)}%)</span>
              </span>
            </div>
          );
        })}
      </div>
    </Tile>
  );
}
