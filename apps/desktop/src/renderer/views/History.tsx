import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PanelShell } from "../components/panel-shell";
import type {
  EnergyTotalsQuery,
  PowerSeriesQuery,
  TariffsQuery,
} from "@solar/contracts/generated/graphql";
import type { EChartsCoreOption } from "echarts/core";
import { useSolarQuery } from "../api";
import { Chart, chartColor } from "../components/Chart";
import { Message } from "../components/Display";
import { ToolbarGroup } from "../components/toolbar-group";
import { DataTable, Td, Th, Tr } from "../components/ui/data-table";
import { EmptyList } from "../components/ui/empty";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Reason } from "../components/ui/reason";
import { cn } from "../lib/utils";
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

// Battery SOC lines take their colours from the chart palette tokens.
const socToken: Record<SocLine["statistic"], string> = {
  avg: "--chart-1",
  min: "--chart-3",
  max: "--chart-4",
};

// Controls inside a ToolbarGroup fill the pill's 30px interior, borderless like its icon buttons.
const pillLabel =
  "flex items-center gap-1.5 ps-2 text-xs text-muted-foreground";
const pillField =
  "h-[30px] rounded-full border-0 bg-transparent text-xs text-foreground shadow-none hover:bg-accent dark:bg-transparent";

function Tile({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="dashboard-tile flex shrink-0 flex-col gap-3 border-none p-4 shadow-md/5">
      <h3 className="text-[10px] leading-4 font-medium tracking-[0.04em] text-muted-foreground uppercase">
        {title}
      </h3>
      {children}
    </div>
  );
}

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
                    itemStyle: { color: chartColor("--destructive", 0.16) },
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
      legend: { show: true, top: 0 },
      grid: { left: 55, right: 25, bottom: 35, top: 40 },
      xAxis: { type: "time" },
      yAxis: { type: "value", name: "%", min: 0, max: 100 },
      series: soc.map((line) => ({
        name: line.name,
        type: "line",
        showSymbol: false,
        connectNulls: false,
        itemStyle: { color: chartColor(socToken[line.statistic]) },
        lineStyle:
          line.statistic === "avg"
            ? { color: chartColor(socToken.avg), width: 2 }
            : {
                color: chartColor(socToken[line.statistic]),
                type: "dashed",
                width: 1.5,
              },
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
    <PanelShell
      title="History"
      titleId="history-title"
      contentClassName="gap-4"
      actions={
        <ToolbarGroup>
          <label className={pillLabel}>
            Range{" "}
            <NativeSelect
              className={cn(pillField, "ps-2 pe-7")}
              value={range}
              onChange={(e) => setRange(e.target.value as RangeKind)}
            >
              {(["day", "week", "month", "year", "custom"] as const).map(
                (option) => (
                  <option key={option}>{option}</option>
                ),
              )}
            </NativeSelect>
          </label>
          <label className={pillLabel}>
            Grid window tariff{" "}
            <NativeSelect
              className={cn(pillField, "max-w-40 truncate ps-2 pe-7")}
              value={tariffId}
              onChange={(e) => setTariffId(e.target.value)}
            >
              <option value="">No window breakdown</option>
              {tariffs.data?.tariffs.map((tariff) => (
                <option key={tariff.id} value={tariff.id}>
                  {tariff.name} (#{tariff.id})
                </option>
              ))}
            </NativeSelect>
          </label>
        </ToolbarGroup>
      }
    >
      {range === "custom" && (
        <ToolbarGroup className="self-end">
          <label className={pillLabel}>
            From{" "}
            <Input
              type="date"
              className={cn(pillField, "w-auto px-2 md:text-xs")}
              value={customFrom}
              onChange={(e) => setCustomFrom(e.target.value)}
            />
          </label>
          <label className={pillLabel}>
            Through{" "}
            <Input
              type="date"
              className={cn(pillField, "w-auto px-2 md:text-xs")}
              value={customTo}
              onChange={(e) => setCustomTo(e.target.value)}
            />
          </label>
        </ToolbarGroup>
      )}
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
          <Tile title="Power · gaps shaded">
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
          </Tile>
          <Tile
            title={`Energy by ${dates.granularity.toLowerCase()} · ${dates.fromDate} to ${dates.toDate}`}
          >
            {energy ? (
              <>
                <Chart
                  option={bars}
                  label="Solar, consumption, import and export energy bars"
                />
                <p className="text-xs text-muted-foreground">
                  Coverage:{" "}
                  <Reason reason={energy.total.solar.coverage}>
                    {coveragePercent(energy.total.solar.coverage)}
                  </Reason>{" "}
                  solar ·{" "}
                  <Reason reason={energy.total.gridImport.coverage}>
                    {coveragePercent(energy.total.gridImport.coverage)}
                  </Reason>{" "}
                  grid import
                </p>
                {tariffId && (
                  <DataTable containerClassName="overflow-x-auto">
                    <caption className="sr-only">
                      Grid energy by selected tariff window (tariff local time)
                    </caption>
                    <thead>
                      <Tr>
                        <Th>Window</Th>
                        <Th>Import kWh</Th>
                        <Th>Export kWh</Th>
                      </Tr>
                    </thead>
                    <tbody>
                      {energy.total.gridByWindow.map((window) => (
                        <Tr key={window.window}>
                          <Td>{window.window}</Td>
                          <Td>
                            <Reason
                              reason={[
                                window.importKwh.status,
                                ...window.importKwh.flags,
                              ].join(", ")}
                            >
                              {decimal(window.importKwh.kwh)} ·{" "}
                              {coveragePercent(window.importKwh.coverage)}{" "}
                              coverage
                            </Reason>
                          </Td>
                          <Td>
                            <Reason
                              reason={[
                                window.exportKwh.status,
                                ...window.exportKwh.flags,
                              ].join(", ")}
                            >
                              {decimal(window.exportKwh.kwh)} ·{" "}
                              {coveragePercent(window.exportKwh.coverage)}{" "}
                              coverage
                            </Reason>
                          </Td>
                        </Tr>
                      ))}
                    </tbody>
                  </DataTable>
                )}
              </>
            ) : (
              <Message>
                {totals.error?.message ?? "Loading energy totals…"}
              </Message>
            )}
          </Tile>
          <Tile title="Battery SOC">
            {power ? (
              <>
                <Chart
                  option={socOption}
                  label="Battery SOC history; missing intervals are gaps"
                />
                {soc.length === 0 ? (
                  <EmptyList>
                    No SOC values were recorded in this range.
                  </EmptyList>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {soc.some((line) => line.statistic === "avg")
                      ? `Average, minimum and maximum SOC over each ${bucketLabel(power.bucketSeconds)} interval; a line breaks where no value was recorded.`
                      : `Average SOC is not available at this resolution; showing the minimum and maximum within each ${bucketLabel(power.bucketSeconds)} interval.`}
                  </p>
                )}
              </>
            ) : (
              <Message>Loading SOC…</Message>
            )}
          </Tile>
        </>
      )}
    </PanelShell>
  );
}
