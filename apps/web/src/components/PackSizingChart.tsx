import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button, Checkbox, NumberInput, Tile } from "@carbon/react";

export type ChartPoint = {
  month: string;
  rumProfile: number;
  annualAverage: number;
  growthBuffered: number;
  forecast?: number;
};

type PackSizingChartProps = {
  chartData: ChartPoint[];
  recommended: { packs: number; rum: number };
  chartMode: "12" | "36";
  onChartModeChange: (m: "12" | "36") => void;
  // Forecast props
  forecastEnabled: boolean;
  onForecastEnabledChange: (v: boolean) => void;
  forecastInputMode: "growthRate" | "targetRum";
  onForecastInputModeChange: (m: "growthRate" | "targetRum") => void;
  forecastGrowthPct: number;
  onForecastGrowthPctChange: (v: number) => void;
  forecastTargetRum: number;
  onForecastTargetRumChange: (v: number) => void;
  forecastTargetMonth: number;
  onForecastTargetMonthChange: (v: number) => void;
  forecastMilestones: Array<{ month: number; rum: number }>;
  forecastUpgradeMonth: number | null;
  impliedAnnualPct: number | null;
};

function formatRum(value: number) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)}k`;
  return String(value);
}

export function PackSizingChart({
  chartData,
  recommended,
  chartMode,
  onChartModeChange,
  forecastEnabled,
  onForecastEnabledChange,
  forecastInputMode,
  onForecastInputModeChange,
  forecastGrowthPct,
  onForecastGrowthPctChange,
  forecastTargetRum,
  onForecastTargetRumChange,
  forecastTargetMonth,
  onForecastTargetMonthChange,
  forecastMilestones,
  forecastUpgradeMonth,
  impliedAnnualPct,
}: PackSizingChartProps) {
  return (
    <Tile className="card pack-sizing-chart-card" style={{ width: "100%" }}>
      <div className="pack-sizing-chart-header">
        <h3>RUM Projection</h3>
        <div className="chart-mode-toggle">
          <Button kind={chartMode === "12" ? "primary" : "tertiary"} size="sm" onClick={() => onChartModeChange("12")}>
            12 Months
          </Button>
          <Button kind={chartMode === "36" ? "primary" : "tertiary"} size="sm" onClick={() => onChartModeChange("36")}>
            36 Months
          </Button>
        </div>
      </div>
      <p className="helper-text" style={{ marginBottom: "1rem" }}>
        Blue = monthly RUM profile. Grey dashed = annual average. Teal dashed = growth-buffered target.
        Orange = recommended pack tier ceiling.{forecastEnabled ? " Purple = growth forecast." : ""}
      </p>

      <ResponsiveContainer width="100%" height={480}>
        <LineChart data={chartData} margin={{ top: 8, right: 24, bottom: 8, left: 16 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis dataKey="month" tick={{ fontSize: 11 }} />
          <YAxis tickFormatter={formatRum} tick={{ fontSize: 11 }} width={52} />
          <Tooltip formatter={(value) => typeof value === "number" ? value.toLocaleString() : String(value ?? "")} />
          <Legend />
          <ReferenceLine
            y={recommended.rum}
            stroke="#f1620a"
            strokeDasharray="6 3"
            label={{ value: `Pack tier: ${(recommended.rum / 1000).toFixed(0)}k`, position: "insideTopRight", fontSize: 11, fill: "#f1620a" }}
          />
          {forecastEnabled && forecastUpgradeMonth !== null && chartData[forecastUpgradeMonth - 1] && (
            <ReferenceLine
              x={chartData[forecastUpgradeMonth - 1].month}
              stroke="#f1620a"
              strokeDasharray="4 2"
              label={{ value: "Tier upgrade", position: "top", fontSize: 10, fill: "#f1620a" }}
            />
          )}
          <Line
            type="monotone"
            dataKey="rumProfile"
            name="Monthly RUM Profile"
            stroke="#0f62fe"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          <Line
            type="monotone"
            dataKey="annualAverage"
            name="Annual Average"
            stroke="#64748b"
            strokeWidth={1.5}
            strokeDasharray="6 3"
            dot={false}
          />
          <Line
            type="monotone"
            dataKey="growthBuffered"
            name="Growth-Buffered Target"
            stroke="#1f9d8b"
            strokeWidth={1.5}
            strokeDasharray="4 4"
            dot={false}
          />
          {forecastEnabled && (
            <Line
              type="monotone"
              dataKey="forecast"
              name="Forecast"
              stroke="#6929c4"
              strokeWidth={2}
              strokeDasharray="5 3"
              dot={false}
              connectNulls
            />
          )}
        </LineChart>
      </ResponsiveContainer>

      {/* Forecast Scenarios section */}
      <div className="forecast-section">
        <Checkbox
          id="forecast-enabled"
          labelText="Enable growth forecast"
          checked={forecastEnabled}
          onChange={(_evt: unknown, { checked }: { checked: boolean | "indeterminate" }) =>
            onForecastEnabledChange(Boolean(checked))
          }
        />

        {forecastEnabled && (
          <>
            <div className="forecast-controls">
              <div className="forecast-mode-toggle">
                <button
                  className={`filter-pill ${forecastInputMode === "growthRate" ? "active" : ""}`}
                  onClick={() => onForecastInputModeChange("growthRate")}
                >
                  Annual Growth %
                </button>
                <button
                  className={`filter-pill ${forecastInputMode === "targetRum" ? "active" : ""}`}
                  onClick={() => onForecastInputModeChange("targetRum")}
                >
                  Target RUM
                </button>
              </div>

              {forecastInputMode === "growthRate" ? (
                <NumberInput
                  id="forecast-growth"
                  label="Annual growth rate (%)"
                  min={0}
                  max={500}
                  value={forecastGrowthPct}
                  onChange={(_event, state) => onForecastGrowthPctChange(Number(state.value ?? 20))}
                />
              ) : (
                <>
                  <NumberInput
                    id="forecast-target-rum"
                    label="Target RUM"
                    min={0}
                    value={forecastTargetRum || ""}
                    onChange={(_event, state) => onForecastTargetRumChange(Number(state.value ?? 0))}
                  />
                  <NumberInput
                    id="forecast-target-month"
                    label="By month"
                    min={1}
                    max={36}
                    value={forecastTargetMonth}
                    onChange={(_event, state) => onForecastTargetMonthChange(Number(state.value ?? 36))}
                  />
                  {impliedAnnualPct !== null && (
                    <p className="helper-text" style={{ alignSelf: "flex-end", marginBottom: "0.4rem" }}>
                      ≈ {impliedAnnualPct.toFixed(1)}% implied annual growth
                    </p>
                  )}
                </>
              )}
            </div>

            {forecastMilestones.length > 0 && (
              <div className="forecast-milestones">
                {forecastMilestones.map((m) => (
                  <div key={m.month} className="forecast-milestone-item">
                    <span className="milestone-label">Month {m.month}</span>
                    <span className="milestone-value">{m.rum.toLocaleString()} RUM</span>
                  </div>
                ))}
              </div>
            )}

            {forecastUpgradeMonth !== null && (
              <div className="forecast-upgrade-warning">
                ⚠ Pack tier upgrade required in month {forecastUpgradeMonth} — your buffered forecast will exceed the current {recommended.packs.toLocaleString()}-pack tier ceiling
              </div>
            )}
          </>
        )}
      </div>
    </Tile>
  );
}
