import { useEffect, useMemo, useState } from "react";
import { getSummary } from "../lib/api";
import { MONTHS, recommendPack, PackSizingPanel } from "./PackSizingPanel";
import { PackSizingChart, ChartPoint } from "./PackSizingChart";

function buildChartData(
  baseRum: number,
  peakMultiplier: number,
  growthBufferPct: number,
  useMonthlyMode: boolean,
  monthlyValues: number[],
  annualAverage: number,
  bufferedRum: number,
  chartMode: "12" | "36",
  forecastValues: number[]
): ChartPoint[] {
  const totalMonths = chartMode === "12" ? 12 : 36;
  const monthlyGrowthRate = growthBufferPct / 100 / 12;
  const points: ChartPoint[] = [];

  for (let i = 0; i < totalMonths; i++) {
    let rumProfile: number;
    if (i < 12) {
      if (useMonthlyMode) {
        rumProfile = monthlyValues[i] || 0;
      } else {
        const phase = ((i - 6) / 12) * 2 * Math.PI;
        const variance = 1 + 0.08 * Math.sin(phase);
        rumProfile = Math.round(baseRum * peakMultiplier * variance);
      }
    } else {
      const baseMonth12 = useMonthlyMode
        ? monthlyValues[11] || annualAverage
        : Math.round(baseRum * peakMultiplier);
      const compoundFactor = Math.pow(1 + monthlyGrowthRate, i - 11);
      rumProfile = Math.round(baseMonth12 * compoundFactor);
    }

    const label = i < 12 ? MONTHS[i] : `M${i + 1}`;
    points.push({
      month: label,
      rumProfile,
      annualAverage: Math.ceil(annualAverage),
      growthBuffered: bufferedRum,
      forecast: forecastValues.length > i ? forecastValues[i] : undefined,
    });
  }

  return points;
}

export function PackSizingTab() {
  const [baseRum, setBaseRum] = useState(0);
  const [peakMultiplier, setPeakMultiplier] = useState(1.0);
  const [growthBufferPct, setGrowthBufferPct] = useState(25);
  const [useMonthlyMode, setUseMonthlyMode] = useState(false);
  const [monthlyValues, setMonthlyValues] = useState<number[]>(Array(12).fill(0));
  const [chartMode, setChartMode] = useState<"12" | "36">("12");

  // Forecast state
  const [forecastEnabled, setForecastEnabled] = useState(false);
  const [forecastInputMode, setForecastInputMode] = useState<"growthRate" | "targetRum">("growthRate");
  const [forecastGrowthPct, setForecastGrowthPct] = useState(20);
  const [forecastTargetRum, setForecastTargetRum] = useState(0);
  const [forecastTargetMonth, setForecastTargetMonth] = useState(36);

  useEffect(() => {
    getSummary().then((data) => {
      if (data?.totalRum) setBaseRum(data.totalRum);
    }).catch(() => {});
  }, []);

  const annualAverage = useMemo(
    () =>
      useMonthlyMode
        ? monthlyValues.reduce((a, b) => a + b, 0) / 12
        : baseRum * peakMultiplier,
    [useMonthlyMode, monthlyValues, baseRum, peakMultiplier]
  );

  const bufferedRum = useMemo(
    () => Math.ceil(annualAverage * (1 + growthBufferPct / 100)),
    [annualAverage, growthBufferPct]
  );

  const recommended = useMemo(() => recommendPack(bufferedRum), [bufferedRum]);

  const headroomPct = useMemo(
    () => Math.round(((recommended.rum - bufferedRum) / recommended.rum) * 100),
    [recommended, bufferedRum]
  );

  const { forecastValues, forecastMilestones, forecastUpgradeMonth, impliedAnnualPct } = useMemo(() => {
    const empty = {
      forecastValues: [] as number[],
      forecastMilestones: [] as Array<{ month: number; rum: number }>,
      forecastUpgradeMonth: null as number | null,
      impliedAnnualPct: null as number | null,
    };
    if (!forecastEnabled || baseRum === 0) return empty;

    const totalMonths = chartMode === "12" ? 12 : 36;
    let monthlyRate: number;

    if (forecastInputMode === "growthRate") {
      monthlyRate = (1 + forecastGrowthPct / 100) ** (1 / 12) - 1;
    } else {
      const target = forecastTargetRum > 0 ? forecastTargetRum : recommended.rum;
      const safeMonth = Math.max(1, forecastTargetMonth);
      monthlyRate = (target / baseRum) ** (1 / safeMonth) - 1;
    }

    const values = Array.from({ length: totalMonths }, (_, i) =>
      Math.round(baseRum * (1 + monthlyRate) ** (i + 1))
    );

    const milestones = [12, 24, 36]
      .filter((m) => m <= totalMonths)
      .map((m) => ({ month: m, rum: values[m - 1] }));

    let upgradeMonth: number | null = null;
    for (let i = 0; i < values.length; i++) {
      const buffered = Math.ceil(values[i] * (1 + growthBufferPct / 100));
      if (recommendPack(buffered).rum > recommended.rum) {
        upgradeMonth = i + 1;
        break;
      }
    }

    const implied =
      forecastInputMode === "targetRum"
        ? ((1 + monthlyRate) ** 12 - 1) * 100
        : null;

    return {
      forecastValues: values,
      forecastMilestones: milestones,
      forecastUpgradeMonth: upgradeMonth,
      impliedAnnualPct: implied,
    };
  }, [
    forecastEnabled,
    forecastInputMode,
    forecastGrowthPct,
    forecastTargetRum,
    forecastTargetMonth,
    baseRum,
    chartMode,
    growthBufferPct,
    recommended,
  ]);

  const chartData = useMemo(
    () =>
      buildChartData(
        baseRum,
        peakMultiplier,
        growthBufferPct,
        useMonthlyMode,
        monthlyValues,
        annualAverage,
        bufferedRum,
        chartMode,
        forecastValues
      ),
    [baseRum, peakMultiplier, growthBufferPct, useMonthlyMode, monthlyValues, annualAverage, bufferedRum, chartMode, forecastValues]
  );

  return (
    <div className="pack-sizing-tab">
      <PackSizingChart
        chartData={chartData}
        recommended={recommended}
        chartMode={chartMode}
        onChartModeChange={setChartMode}
        forecastEnabled={forecastEnabled}
        onForecastEnabledChange={setForecastEnabled}
        forecastInputMode={forecastInputMode}
        onForecastInputModeChange={setForecastInputMode}
        forecastGrowthPct={forecastGrowthPct}
        onForecastGrowthPctChange={setForecastGrowthPct}
        forecastTargetRum={forecastTargetRum}
        onForecastTargetRumChange={setForecastTargetRum}
        forecastTargetMonth={forecastTargetMonth}
        onForecastTargetMonthChange={setForecastTargetMonth}
        forecastMilestones={forecastMilestones}
        forecastUpgradeMonth={forecastUpgradeMonth}
        impliedAnnualPct={impliedAnnualPct}
      />
      <PackSizingPanel
        baseRum={baseRum}
        peakMultiplier={peakMultiplier}
        onPeakMultiplierChange={setPeakMultiplier}
        growthBufferPct={growthBufferPct}
        onGrowthBufferChange={setGrowthBufferPct}
        useMonthlyMode={useMonthlyMode}
        onMonthlyModeChange={setUseMonthlyMode}
        monthlyValues={monthlyValues}
        onMonthlyValuesChange={setMonthlyValues}
        annualAverage={annualAverage}
        bufferedRum={bufferedRum}
        recommended={recommended}
        headroomPct={headroomPct}
      />
    </div>
  );
}
