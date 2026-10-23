import { useEffect, useMemo, useState } from "react";
import type {
  EnergyTotalsQuery,
  PowerSeriesQuery,
  TariffsQuery,
} from "@solar/contracts/generated/graphql";
import type { EChartsCoreOption } from "echarts/core";
import { useSolarQuery } from "../api";
import { Chart } from "../components/Chart";
import { Message } from "../components/Display";
import {
  bucketLabel,
  coveragePercent,
  decimal,
  gapAreas,
  socLines,
  siteLocalDate,
  rangeDates,
  siteRangeInstants,
  type RangeKind,
  type SocLine,
} from "../models";

const socColor: Record<SocLine["statistic"], string> = {
  avg: "#8dd6ff",
  min: "#9be28a",
  max: "#ffda91",
};

export function History({
  siteTimezone,
}: {
  siteTimezone: string | undefined;
}) {
  const [range, setRange] = useState<RangeKind>("day");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [tariffId, setTariffId] = useState("");
  const tariffs = useSolarQuery<TariffsQuery>("Tariffs");
  useEffect(() => {
    if (siteTimezone) {
      const today = siteLocalDate(new Date(), siteTimezone);
      setCustomFrom(today);
      setCustomTo(today);
    }
  }, [siteTimezone]);
  const dates = siteTimezone
    ? rangeDates(range, new Date(), customFrom, customTo, siteTimezone)
    : { fromDate: "", toDate: "", granularity: "DAY" as const };
  const valid = Boolean(
    siteTimezone &&
    dates.fromDate &&
    dates.toDate &&
    dates.fromDate <= dates.toDate,
  );
  const bounds =
    valid && siteTimezone
      ? siteRangeInstants(dates.fromDate, dates.toDate, siteTimezone)
      : null;
  const from = bounds?.from ?? "";
  const to = bounds?.toExclusive ?? "";
  const series = useSolarQuery<PowerSeriesQuery>(
    "PowerSeries",
    {
      from,
      to,
      metrics: ["PV", "LOAD", "GRID", "BATTERY", "SOC"],
      maxPoints: 1000,
    },
    undefined,
    valid,
  );
  const totals = useSolarQuery<EnergyTotalsQuery>(
    "EnergyTotals",
    { ...dates, tariffId: tariffId ? Number(tariffId) : null },
    undefined,
    valid,
  );
  const power = valid ? series.data?.powerSeries : undefined;
  const energy = valid ? totals.data?.energyTotals : undefined;
  const chartOption = useMemo<EChartsCoreOption>(
    () => ({
      tooltip: { trigger: "axis" },
      legend: { show: false },
      grid: { left: 65, right: 25, bottom: 75, top: 35 },
      xAxis: { type: "time" },
      yAxis: { type: "value", name: "W" },
      dataZoom: [{ type: "inside" }, { type: "slider" }],
      series:
        power?.series
          .filter((s) => s.metric !== "SOC")
          .map((s, index) => ({
            name: s.metric,
            type: "line",
            showSymbol: false,
            connectNulls: false,
            data: s.points.map((point) => [point.t, point.avg]),
            markArea:
              index === 0
                ? {
                    silent: true,
                    itemStyle: { color: "rgba(225, 110, 86, 0.16)" },
                    data: gapAreas(power.gaps),
                  }
                : undefined,
          })) ?? [],
    }),
    [power],
  );
  const socPoints = power?.series.find((s) => s.metric === "SOC")?.points;
  const soc = useMemo(() => socLines(socPoints ?? []), [socPoints]);
  const socOption = useMemo<EChartsCoreOption>(
    () => ({
      tooltip: { trigger: "axis" },
      legend: { show: true, top: 0, textStyle: { color: "#cfdfeb" } },
      grid: { left: 55, right: 25, bottom: 35, top: 40 },
      xAxis: { type: "time" },
      yAxis: { type: "value", name: "%", min: 0, max: 100 },
      series: soc.map((line) => ({
        name: line.name,
        type: "line",
        showSymbol: false,
        connectNulls: false,
        itemStyle: { color: socColor[line.statistic] },
        lineStyle:
          line.statistic === "avg"
            ? { color: socColor.avg, width: 2 }
            : { color: socColor[line.statistic], type: "dashed", width: 1.5 },
        data: line.data,
      })),
    }),
    [soc],
  );
  const bars = useMemo<EChartsCoreOption>(
    () => ({
      tooltip: { trigger: "axis" },
      grid: { left: 60, right: 25, bottom: 60, top: 25 },
      xAxis: {
        type: "category",
        data: energy?.rows.map((row) => row.periodStart) ?? [],
        axisLabel: { rotate: 35 },
      },
      yAxis: { type: "value", name: "kWh" },
      series: (
        ["solar", "consumption", "gridImport", "gridExport"] as const
      ).map((key) => ({
        name: key,
        type: "bar",
        data: energy?.rows.map((row) => row[key].kwh) ?? [],
      })),
    }),
    [energy],
  );
  return (
    <section aria-labelledby="history-title">
      <h2 id="history-title">History</h2>
      <div className="form-row">
        <label>
          Range{" "}
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as RangeKind)}
          >
            {(["day", "week", "month", "year", "custom"] as const).map(
              (option) => (
                <option key={option}>{option}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Grid window tariff{" "}
          <select
            value={tariffId}
            onChange={(e) => setTariffId(e.target.value)}
          >
            <option value="">No window breakdown</option>
            {tariffs.data?.tariffs.map((tariff) => (
              <option key={tariff.id} value={tariff.id}>
                {tariff.name} (#{tariff.id})
              </option>
            ))}
          </select>
        </label>
        {range === "custom" && (
          <>
            <label>
              From{" "}
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setCustomFrom(e.target.value)}
              />
            </label>
            <label>
              Through{" "}
              <input
                type="date"
                value={customTo}
                onChange={(e) => setCustomTo(e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      {tariffs.error && <Message>{tariffs.error.message}</Message>}
      {!siteTimezone ? (
        <Message>Loading site timezone…</Message>
      ) : (
        !valid && (
          <Message>Through date must be on or after start date.</Message>
        )
      )}
      {valid && (
        <>
          <div className="card">
            <h3>Power · gaps shaded</h3>
            {power ? (
              <Chart
                option={chartOption}
                label="Power series; missing intervals are gaps with shaded regions"
              />
            ) : (
              <Message>
                {series.error?.message ?? "Loading power series…"}
              </Message>
            )}
          </div>
          <div className="card">
            <h3>
              Energy by {dates.granularity.toLowerCase()} · {dates.fromDate} to{" "}
              {dates.toDate}
            </h3>
            {energy ? (
              <>
                <Chart
                  option={bars}
                  label="Solar, consumption, import and export energy bars"
                />
                <p className="meta">
                  Coverage:{" "}
                  <span title={energy.total.solar.coverage}>
                    {coveragePercent(energy.total.solar.coverage)}
                  </span>{" "}
                  solar ·{" "}
                  <span title={energy.total.gridImport.coverage}>
                    {coveragePercent(energy.total.gridImport.coverage)}
                  </span>{" "}
                  grid import
                </p>
                {tariffId && (
                  <table>
                    <caption>
                      Grid energy by selected tariff window (tariff local time)
                    </caption>
                    <thead>
                      <tr>
                        <th>Window</th>
                        <th>Import kWh</th>
                        <th>Export kWh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {energy.total.gridByWindow.map((window) => (
                        <tr key={window.window}>
                          <td>{window.window}</td>
                          <td
                            title={[
                              window.importKwh.status,
                              ...window.importKwh.flags,
                            ].join(", ")}
                          >
                            {decimal(window.importKwh.kwh)} ·{" "}
                            {coveragePercent(window.importKwh.coverage)}{" "}
                            coverage
                          </td>
                          <td
                            title={[
                              window.exportKwh.status,
                              ...window.exportKwh.flags,
                            ].join(", ")}
                          >
                            {decimal(window.exportKwh.kwh)} ·{" "}
                            {coveragePercent(window.exportKwh.coverage)}{" "}
                            coverage
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            ) : (
              <Message>
                {totals.error?.message ?? "Loading energy totals…"}
              </Message>
            )}
          </div>
          <div className="card">
            <h3>Battery SOC</h3>
            {power ? (
              <>
                <Chart
                  option={socOption}
                  label="Battery SOC history; missing intervals are gaps"
                />
                <p className="meta">
                  {soc.length === 0
                    ? "No SOC values were recorded in this range."
                    : soc.some((line) => line.statistic === "avg")
                      ? `Average, minimum and maximum SOC over each ${bucketLabel(power.bucketSeconds)} interval; a line breaks where no value was recorded.`
                      : `Average SOC is not available at this resolution; showing the minimum and maximum within each ${bucketLabel(power.bucketSeconds)} interval.`}
                </p>
              </>
            ) : (
              <Message>Loading SOC…</Message>
            )}
          </div>
        </>
      )}
    </section>
  );
}
