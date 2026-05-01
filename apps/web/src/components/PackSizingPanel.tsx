import { Checkbox, NumberInput, Tile } from "@carbon/react";

export const PACK_TIERS = [
  { packs: 100, rum: 10_000 },
  { packs: 250, rum: 25_000 },
  { packs: 500, rum: 50_000 },
  { packs: 1_000, rum: 100_000 },
  { packs: 2_500, rum: 250_000 },
  { packs: 5_000, rum: 500_000 },
];

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function recommendPack(bufferedRum: number) {
  return PACK_TIERS.find((t) => t.rum >= bufferedRum) ?? PACK_TIERS[PACK_TIERS.length - 1];
}

export type PackSizingPanelProps = {
  baseRum: number;
  peakMultiplier: number;
  onPeakMultiplierChange: (v: number) => void;
  growthBufferPct: number;
  onGrowthBufferChange: (v: number) => void;
  useMonthlyMode: boolean;
  onMonthlyModeChange: (v: boolean) => void;
  monthlyValues: number[];
  onMonthlyValuesChange: (v: number[]) => void;
  annualAverage: number;
  bufferedRum: number;
  recommended: { packs: number; rum: number };
  headroomPct: number;
};

export function PackSizingPanel({
  baseRum,
  peakMultiplier,
  onPeakMultiplierChange,
  growthBufferPct,
  onGrowthBufferChange,
  useMonthlyMode,
  onMonthlyModeChange,
  monthlyValues,
  onMonthlyValuesChange,
  annualAverage,
  bufferedRum,
  recommended,
  headroomPct,
}: PackSizingPanelProps) {
  if (baseRum === 0) {
    return (
      <Tile className="card pack-sizing-panel">
        <h3>Pack Sizing Recommendation</h3>
        <p className="helper-text">Run a scan to populate the pack sizing calculator.</p>
      </Tile>
    );
  }

  return (
    <Tile className="card pack-sizing-panel">
      <h3>Pack Sizing Recommendation</h3>
      <p className="helper-text" style={{ marginBottom: "1.25rem" }}>
        Translates your RUM snapshot into a pack purchase recommendation using IBM's 6-step sizing methodology.
        Packs are purchased in multiples of 100 RUM (e.g. 250 packs = 25,000 RUM entitlement).
      </p>

      <div className="pack-controls">
        <Checkbox
          id="monthly-mode"
          labelText="Use 12 monthly peak values instead of snapshot"
          checked={useMonthlyMode}
          onChange={(_evt: unknown, { checked }: { checked: boolean | "indeterminate" }) =>
            onMonthlyModeChange(Boolean(checked))
          }
        />
        {!useMonthlyMode && (
          <NumberInput
            id="peak-multiplier"
            label="Peak month multiplier — how much higher is your busiest month vs. this snapshot? (1.0 = same, 1.5 = 50% higher)"
            min={1.0}
            max={2.0}
            step={0.05}
            value={peakMultiplier}
            onChange={(_event, state) => onPeakMultiplierChange(Number(state.value ?? 1.0))}
          />
        )}
        <NumberInput
          id="growth-buffer"
          label="Growth buffer % (IBM guidance: 20–30%)"
          min={0}
          max={100}
          value={growthBufferPct}
          onChange={(_event, state) => onGrowthBufferChange(Number(state.value ?? 25))}
        />
      </div>

      {useMonthlyMode && (
        <div style={{ marginBottom: "1.25rem" }}>
          <p className="helper-text" style={{ marginBottom: "0.75rem" }}>
            Enter the peak managed resource count for each month (monthly high-water mark):
          </p>
          <div className="monthly-grid">
            {MONTHS.map((month, idx) => (
              <NumberInput
                key={month}
                id={`month-${idx}`}
                label={month}
                min={0}
                value={monthlyValues[idx]}
                onChange={(_event, state) => {
                  const updated = [...monthlyValues];
                  updated[idx] = Number(state.value ?? 0);
                  onMonthlyValuesChange(updated);
                }}
              />
            ))}
          </div>
        </div>
      )}

      <div className="pack-steps">
        <div className="pack-step">
          <span className="step-num">1</span>
          <span className="step-label">RUM snapshot (current scan)</span>
          <span className="step-value">{baseRum.toLocaleString()}</span>
        </div>
        {!useMonthlyMode && (
          <div className="pack-step">
            <span className="step-num">2</span>
            <span className="step-label">Peak month estimate (snapshot × {peakMultiplier.toFixed(2)})</span>
            <span className="step-value">{Math.ceil(baseRum * peakMultiplier).toLocaleString()}</span>
          </div>
        )}
        <div className="pack-step">
          <span className="step-num">{useMonthlyMode ? "2–4" : "3–4"}</span>
          <span className="step-label">
            {useMonthlyMode ? "Annual average of 12 monthly peaks" : "Estimated annual monthly average"}
          </span>
          <span className="step-value">{Math.ceil(annualAverage).toLocaleString()}</span>
        </div>
        <div className="pack-step">
          <span className="step-num">5</span>
          <span className="step-label">Growth buffer applied (+{growthBufferPct}%)</span>
          <span className="step-value">{bufferedRum.toLocaleString()}</span>
        </div>
        <div className="pack-step">
          <span className="step-num">6</span>
          <span className="step-label">Nearest pack tier at or above buffered estimate</span>
          <span className="step-value">{recommended.rum.toLocaleString()} RUM</span>
        </div>
      </div>

      <div className="pack-result-callout">
        <div className="pack-result-main">
          <span className="pack-result-label">Recommended Pack Configuration</span>
          <span className="pack-result-tier">{recommended.packs.toLocaleString()} packs</span>
          <span className="pack-result-rum">= {recommended.rum.toLocaleString()} RUM monthly average entitlement</span>
        </div>
        <div className="pack-result-headroom">
          {headroomPct}% headroom within this tier
        </div>
      </div>

      <p className="helper-text" style={{ marginTop: "0.75rem", fontSize: "0.8rem" }}>
        IBM Terraform Self-Managed Premium licenses in 100-RUM packs. The licensed metric is the average of 12 monthly peaks across the subscription year.
        Stacks is available exclusively on RUM plans.
      </p>
    </Tile>
  );
}
