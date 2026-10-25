import { Fragment } from "react";
import type {
  CollectorStatusQuery,
  EnergyTotalsQuery,
  LiveStatusQuery,
} from "@solar/contracts/generated/graphql";
import { PanelShell } from "../components/panel-shell";
import { useSolarQuery } from "../api";
import { EnergyFlow } from "../components/EnergyFlow";
import { Metric, Message } from "../components/Display";
import { Badge } from "../components/ui/badge";
import { EmptyView } from "../components/ui/empty";
import { Reason } from "../components/ui/reason";
import { statusTone } from "../components/ui/status-tone";
import {
  coveragePercent,
  batteryDirection,
  energyValue,
  freshness,
  siteLocalDate,
  localInstant,
  powerValue,
  watts,
} from "../models";

const TILE = "dashboard-tile flex min-h-0 flex-col border-none p-4 shadow-md/5";
const TILE_LABEL =
  "text-[10px] leading-4 font-medium tracking-[0.04em] text-muted-foreground uppercase";

export function Overview({
  stale,
  lastKnown,
  siteTimezone,
}: {
  stale: boolean;
  lastKnown: boolean;
  siteTimezone: string | undefined;
}) {
  const live = useSolarQuery<LiveStatusQuery>("LiveStatus", undefined, 10_000);
  const collector = useSolarQuery<CollectorStatusQuery>(
    "CollectorStatus",
    undefined,
    30_000,
  );
  const today = siteTimezone ? siteLocalDate(new Date(), siteTimezone) : "";
  const totals = useSolarQuery<EnergyTotalsQuery>(
    "EnergyTotals",
    {
      fromDate: today,
      toDate: today,
      granularity: "DAY",
    },
    undefined,
    Boolean(siteTimezone),
  );
  const data = live.data?.liveStatus;
  const energy = totals.data?.energyTotals.total;
  // With no sample at all and no diagnostic reason on any power value, the live tiles hold nothing
  // but dashes, so one empty-state message replaces them. A reason such as METER_LINK_DOWN keeps them.
  const bare =
    data != null &&
    data.freshness === "NO_DATA" &&
    [
      data.pv,
      data.load,
      data.loadVendor,
      data.battery,
      data.grid,
      ...data.pvStrings,
      ...data.gridPhases,
    ].every((power) => !power.reason || power.reason === "NO_READING");
  return (
    <PanelShell
      title="Overview"
      titleId="overview-title"
      headerClassName="px-2"
      contentClassName="ps-2.5 pe-0.5 pt-4 [scrollbar-gutter:stable]"
      actions={
        data && (
          <p className="text-xs text-foreground/70">
            Observed {localInstant(data.observedAt)} ·{" "}
            {lastKnown ? "last known" : freshness(data)} · server age{" "}
            {data.ageSeconds ?? "—"} s{lastKnown ? " at last response" : ""}
          </p>
        )
      }
    >
      {live.error && !data && (
        <div className="mb-4">
          <Message>Live status unavailable: {live.error.message}</Message>
        </div>
      )}
      <div className="grid grid-cols-[repeat(4,minmax(160px,1fr))] auto-rows-[160px] gap-4">
        {data && (
          <>
            {bare ? (
              <div className="col-span-4 row-span-2 flex">
                <EmptyView
                  title="No readings yet"
                  hint="Values appear here once the collector records its first reading."
                />
              </div>
            ) : (
              <>
                <div className={`${TILE} col-span-2 row-span-2`}>
                  <EnergyFlow
                    live={data}
                    stale={stale || freshness(data) !== "LIVE"}
                  />
                </div>
                <dl className="contents">
                  <Metric
                    label="Solar"
                    {...powerValue(data.pv)}
                    detail={
                      <span>
                        Strings:{" "}
                        {data.pvStrings.map((v, i) => (
                          <Fragment key={i}>
                            {i ? " · " : ""}
                            <Reason reason={v.reason}>{watts(v.watts)}</Reason>
                          </Fragment>
                        ))}
                      </span>
                    }
                  />
                  <Metric
                    label="Home (derived)"
                    {...powerValue(data.load)}
                    detail={
                      <Reason
                        reason={`Vendor-reported load: ${watts(data.loadVendor.watts)}${data.loadVendor.reason ? ` (${data.loadVendor.reason})` : ""}`}
                      >
                        Vendor figure ⓘ
                      </Reason>
                    }
                  />
                  <Metric
                    label={`Grid (${data.grid.watts == null ? "unknown" : data.grid.watts < 0 ? "export" : data.grid.watts > 0 ? "import" : "idle"})`}
                    {...powerValue(data.grid)}
                    detail={
                      <span>
                        Phases:{" "}
                        {data.gridPhases.map((v, i) => (
                          <Fragment key={i}>
                            {i ? " · " : ""}
                            <Reason reason={v.reason}>{watts(v.watts)}</Reason>
                          </Fragment>
                        ))}
                      </span>
                    }
                  />
                  <Metric
                    label="Battery"
                    {...powerValue(data.battery)}
                    detail={
                      <Reason reason={data.batteryState}>
                        {batteryDirection(
                          data.battery.watts,
                          data.batteryState,
                        )}
                      </Reason>
                    }
                  />
                </dl>
              </>
            )}
            <dl className="contents">
              <Metric
                label="Battery SOC"
                text={data.batterySoc == null ? "—" : `${data.batterySoc}%`}
                reason={data.batterySoc == null ? "NO_READING" : undefined}
              />
            </dl>
            <div className={`${TILE} col-span-3 gap-2`}>
              <h3 className={TILE_LABEL}>Operating mode</h3>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                <Badge variant="secondary">
                  {data.operatingMode?.label ?? "—"}
                </Badge>
                <span className="text-muted-foreground">
                  ·{" "}
                  {data.operatingMode
                    ? localInstant(data.operatingMode.observedAt)
                    : "NO_READING"}
                </span>
              </p>
              <p className="flex flex-wrap items-center gap-2 text-sm">
                Accounting:{" "}
                <Badge
                  variant="secondary"
                  className={statusTone(data.accountingStatus)}
                >
                  {data.accountingStatus}
                </Badge>
              </p>
              {data.activeFaults.length > 0 && (
                <p className="text-sm">
                  Faults: {data.activeFaults.join(", ")}
                </p>
              )}
            </div>
          </>
        )}
        <div className={`${TILE} col-span-4 row-span-2 gap-3`}>
          <div className="flex items-baseline justify-between gap-3">
            <h3 className={TILE_LABEL}>Today’s local-day energy</h3>
            {collector.data && (
              <p className="text-xs text-muted-foreground">
                Monitoring since{" "}
                {localInstant(collector.data.collectorStatus.monitoringSince)}
              </p>
            )}
          </div>
          {energy ? (
            <dl className="grid grid-cols-3 gap-4">
              {(
                [
                  ["Solar", energy.solar],
                  ["Consumption", energy.consumption],
                  ["Grid import", energy.gridImport],
                  ["Grid export", energy.gridExport],
                  ["Battery charge", energy.batteryCharge],
                  ["Battery discharge", energy.batteryDischarge],
                ] as const
              ).map(([label, value]) => {
                const shown = energyValue(value);
                return (
                  <Metric
                    key={label}
                    label={label}
                    text={shown.text}
                    reason={shown.reason}
                    detail={
                      <Reason reason={value.coverage}>
                        Coverage {coveragePercent(value.coverage)} ·{" "}
                        {value.provenance}
                      </Reason>
                    }
                  />
                );
              })}
            </dl>
          ) : (
            <Message>
              {siteTimezone
                ? (totals.error?.message ?? "Loading daily totals…")
                : "Loading site timezone…"}
            </Message>
          )}
        </div>
      </div>
    </PanelShell>
  );
}
