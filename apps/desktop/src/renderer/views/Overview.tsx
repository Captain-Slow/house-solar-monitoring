import type {
  CollectorStatusQuery,
  EnergyTotalsQuery,
  LiveStatusQuery,
} from "@solar/contracts/generated/graphql";
import { useSolarQuery } from "../api";
import { EnergyFlow } from "../components/EnergyFlow";
import { Metric, Message } from "../components/Display";
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
  return (
    <section aria-labelledby="overview-title">
      <h2 id="overview-title">Overview</h2>
      {live.error && !data && (
        <Message>Live status unavailable: {live.error.message}</Message>
      )}
      {data && (
        <>
          <p className="meta">
            Observed {localInstant(data.observedAt)} ·{" "}
            {lastKnown ? "last known" : freshness(data)} · server age{" "}
            {data.ageSeconds ?? "—"} s{lastKnown ? " at last response" : ""}
          </p>
          <div className="overview-layout">
            <EnergyFlow
              live={data}
              stale={stale || freshness(data) !== "LIVE"}
            />
            <dl className="metrics">
              <Metric
                label="Solar"
                {...powerValue(data.pv)}
                detail={
                  <span>
                    Strings:{" "}
                    {data.pvStrings.map((v, i) => (
                      <span key={i} title={v.reason ?? undefined}>
                        {i ? " · " : ""}
                        {watts(v.watts)}
                      </span>
                    ))}
                  </span>
                }
              />
              <Metric
                label="Home (derived)"
                {...powerValue(data.load)}
                detail={
                  <span
                    title={`Vendor-reported load: ${watts(data.loadVendor.watts)}${data.loadVendor.reason ? ` (${data.loadVendor.reason})` : ""}`}
                  >
                    Vendor figure ⓘ
                  </span>
                }
              />
              <Metric
                label={`Grid (${data.grid.watts == null ? "unknown" : data.grid.watts < 0 ? "export" : data.grid.watts > 0 ? "import" : "idle"})`}
                {...powerValue(data.grid)}
                detail={
                  <span>
                    Phases:{" "}
                    {data.gridPhases.map((v, i) => (
                      <span key={i} title={v.reason ?? undefined}>
                        {i ? " · " : ""}
                        {watts(v.watts)}
                      </span>
                    ))}
                  </span>
                }
              />
              <Metric
                label="Battery"
                {...powerValue(data.battery)}
                detail={
                  <span title={data.batteryState ?? undefined}>
                    {batteryDirection(data.battery.watts, data.batteryState)}
                  </span>
                }
              />
              <Metric
                label="Battery SOC"
                text={data.batterySoc == null ? "—" : `${data.batterySoc}%`}
                reason={data.batterySoc == null ? "NO_READING" : undefined}
              />
            </dl>
          </div>
          <div className="card">
            <h3>Operating mode</h3>
            <p>
              {data.operatingMode?.label ?? "—"} ·{" "}
              {data.operatingMode
                ? localInstant(data.operatingMode.observedAt)
                : "NO_READING"}
            </p>
            <p>
              Accounting:{" "}
              <strong className="status-chip">{data.accountingStatus}</strong>
            </p>
            {data.activeFaults.length > 0 && (
              <p>Faults: {data.activeFaults.join(", ")}</p>
            )}
          </div>
        </>
      )}
      <div className="card">
        <h3>Today’s local-day energy</h3>
        {energy ? (
          <dl className="metrics">
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
                    <span title={value.coverage}>
                      Coverage {coveragePercent(value.coverage)} ·{" "}
                      {value.provenance}
                    </span>
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
        {collector.data && (
          <p className="meta">
            Monitoring since{" "}
            {localInstant(collector.data.collectorStatus.monitoringSince)}
          </p>
        )}
      </div>
    </section>
  );
}
