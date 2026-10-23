import { useEffect, useState } from "react";
import type {
  AccountingPoliciesQuery,
  CalculationRunsQuery,
  CollectorStatusQuery,
  DataQualityEventsQuery,
  DevicesQuery,
  EnergyTotalsQuery,
  ReconciliationQuery,
} from "@solar/contracts/generated/graphql";
import { useMeterReadings, useSolarQuery } from "../api";
import { MeterReadingsPager, Message } from "../components/Display";
import {
  coveragePercent,
  decimal,
  localInstant,
  numericReason,
  siteRangeInstants,
  siteLocalDate,
} from "../models";

/** Event paging belongs to one date range: keyed by that range, a new range always starts at its first page. */
function QualityEvents({ from, to }: { from: string; to: string }) {
  const [cursor, setCursor] = useState<string | null>(null);
  const events = useSolarQuery<DataQualityEventsQuery>("DataQualityEvents", {
    from,
    to,
    first: 100,
    after: cursor,
  });
  if (!events.data)
    return (
      <Message>{events.error?.message ?? "Loading quality events…"}</Message>
    );
  const { edges, pageInfo } = events.data.dataQualityEvents;
  return (
    <>
      <ul>
        {edges.map(({ node }) => (
          <li key={node.id}>
            {node.kind} · {localInstant(node.startedAt)} –{" "}
            {localInstant(node.endedAt)} · device {node.deviceId ?? "—"}
          </li>
        ))}
      </ul>
      <button
        type="button"
        disabled={!pageInfo.hasNextPage}
        onClick={() => setCursor(pageInfo.endCursor ?? null)}
      >
        More events
      </button>
    </>
  );
}

export function DataQuality({
  siteTimezone,
}: {
  siteTimezone: string | undefined;
}) {
  const [fromDate, setFromDate] = useState(() =>
    siteTimezone
      ? `${siteLocalDate(new Date(), siteTimezone).slice(0, 7)}-01`
      : "",
  );
  const [toDate, setToDate] = useState(() =>
    siteTimezone ? siteLocalDate(new Date(), siteTimezone) : "",
  );
  const [fromReading, setFromReading] = useState<number | null>(null);
  const [toReading, setToReading] = useState<number | null>(null);
  const [runCursor, setRunCursor] = useState<string | null>(null);
  useEffect(() => {
    if (siteTimezone) {
      const today = siteLocalDate(new Date(), siteTimezone);
      setFromDate(`${today.slice(0, 7)}-01`);
      setToDate(today);
    }
  }, [siteTimezone]);
  const valid = Boolean(
    siteTimezone && fromDate && toDate && fromDate <= toDate,
  );
  const bounds =
    valid && siteTimezone
      ? siteRangeInstants(fromDate, toDate, siteTimezone)
      : null;
  const from = bounds?.from ?? "";
  const to = bounds?.toInclusive ?? "";
  const collector = useSolarQuery<CollectorStatusQuery>(
    "CollectorStatus",
    undefined,
    30_000,
  );
  const devices = useSolarQuery<DevicesQuery>("Devices");
  const policies = useSolarQuery<AccountingPoliciesQuery>("AccountingPolicies");
  const runs = useSolarQuery<CalculationRunsQuery>("CalculationRuns", {
    first: 20,
    after: runCursor,
  });
  const totals = useSolarQuery<EnergyTotalsQuery>(
    "EnergyTotals",
    {
      fromDate,
      toDate,
      granularity: "DAY",
    },
    undefined,
    valid,
  );
  const readings = useMeterReadings();
  const reconciliation = useSolarQuery<ReconciliationQuery>(
    "Reconciliation",
    { fromReadingId: fromReading, toReadingId: toReading },
    undefined,
    fromReading != null && toReading != null && fromReading !== toReading,
  );
  const status = collector.data?.collectorStatus;
  return (
    <section aria-labelledby="quality-title">
      <h2 id="quality-title">Data Quality</h2>
      <div className="card">
        <h3>Collector &amp; device</h3>
        {status ? (
          <dl className="facts">
            <dt>State</dt>
            <dd>
              {status.state} · {status.acquisitionSource}
            </dd>
            <dt>Last success</dt>
            <dd>{localInstant(status.lastSuccessAt)}</dd>
            <dt>Last error</dt>
            <dd>
              {status.lastError ?? "None"} · {localInstant(status.lastErrorAt)}
            </dd>
            <dt>Next retry</dt>
            <dd>{localInstant(status.nextRetryAt)}</dd>
            <dt>Monitoring since</dt>
            <dd>{localInstant(status.monitoringSince)}</dd>
            <dt>Last backup</dt>
            <dd>{localInstant(status.lastBackupAt)}</dd>
            <dt>TLS certificate expiry</dt>
            <dd>{localInstant(status.tlsCertExpiresAt)}</dd>
            <dt>Site day timezone</dt>
            <dd>{status.siteTimezone}</dd>
            <dt>Mapping / policy / calculation versions</dt>
            <dd>
              {status.mappingVersion} / {status.policyVersion} /{" "}
              {status.calcVersion}
            </dd>
            <dt>Current device</dt>
            <dd>
              {status.device
                ? `${status.device.deviceKey} · ${status.device.model}`
                : "—"}
            </dd>
          </dl>
        ) : (
          <Message>
            {collector.error?.message ?? "Loading collector status…"}
          </Message>
        )}
        <h4>Devices</h4>
        {devices.data ? (
          <ul>
            {devices.data.devices.map((device) => (
              <li key={device.id}>
                {device.deviceKey} · {device.model} · first{" "}
                {localInstant(device.firstSeenAt)} · last{" "}
                {localInstant(device.lastSeenAt)}
                {device.retiredAt &&
                  ` · retired ${localInstant(device.retiredAt)}`}
              </li>
            ))}
          </ul>
        ) : (
          <Message>{devices.error?.message ?? "Loading devices…"}</Message>
        )}
        <h4>Accounting policies</h4>
        {policies.data ? (
          <ul>
            {policies.data.accountingPolicies.map((policy) => (
              <li key={policy.version}>
                v{policy.version} · {policy.gridSource} grid · {policy.pvSource}{" "}
                solar · {policy.loadSource} load · {policy.batterySource}{" "}
                battery · validated {policy.validated} · effective{" "}
                {localInstant(policy.effectiveFrom)}
              </li>
            ))}
          </ul>
        ) : (
          <Message>{policies.error?.message ?? "Loading policies…"}</Message>
        )}
      </div>
      <div className="card">
        <h3>Gaps &amp; events</h3>
        <div className="form-row">
          <label>
            From local day{" "}
            <input
              type="date"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label>
            Through local day{" "}
            <input
              type="date"
              value={toDate}
              onChange={(e) => setToDate(e.target.value)}
            />
          </label>
        </div>
        {!siteTimezone ? (
          <Message>Loading site timezone…</Message>
        ) : (
          !valid && <Message>End date must be on or after start date.</Message>
        )}
        {valid && <QualityEvents key={`${from}|${to}`} from={from} to={to} />}
      </div>
      <div className="card">
        <h3>Daily comparison against inverter counters</h3>
        {totals.data ? (
          <table>
            <thead>
              <tr>
                <th>Local day</th>
                <th>Quantity</th>
                <th>Ours kWh</th>
                <th>Inverter interval delta kWh (unvalidated)</th>
                <th>
                  Inverter lifetime kWh (includes pre-monitoring, unvalidated)
                </th>
                <th>Inverter today kWh (VENDOR_SUMMARY)</th>
              </tr>
            </thead>
            <tbody>
              {totals.data.energyTotals.rows.flatMap((row) =>
                (
                  [
                    "solar",
                    "consumption",
                    "gridImport",
                    "gridExport",
                    "batteryCharge",
                    "batteryDischarge",
                  ] as const
                ).map((key) => (
                  <tr key={`${row.periodStart}-${key}`}>
                    <td>{row.periodStart}</td>
                    <td>{key}</td>
                    <td title={row[key].flags.join(", ") || row[key].status}>
                      {decimal(row[key].kwh)}
                    </td>
                    <td
                      title={numericReason(
                        row.vendor.intervalDelta[key].kwh,
                        null,
                        "DEVICE_COUNTER: NEEDS_TWO_READINGS",
                      )}
                    >
                      {decimal(row.vendor.intervalDelta[key].kwh)}
                    </td>
                    <td
                      title={numericReason(
                        row.vendor.lifetime[key].kwh,
                        null,
                        `${row.vendor.lifetime[key].provenance}: NO_READING`,
                      )}
                    >
                      {decimal(row.vendor.lifetime[key].kwh)}
                    </td>
                    <td
                      title={numericReason(
                        row.vendor.vendorToday[key].kwh,
                        null,
                        "VENDOR_SUMMARY: NO_READING",
                      )}
                    >
                      {decimal(row.vendor.vendorToday[key].kwh)}
                    </td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        ) : (
          <Message>
            {siteTimezone
              ? (totals.error?.message ?? "Loading daily comparisons…")
              : "Loading site timezone…"}
          </Message>
        )}
      </div>
      <div className="card">
        <h3>Reconciliation</h3>
        {readings.loaded ? (
          <div className="form-row">
            <label>
              From reading{" "}
              <select
                value={fromReading ?? ""}
                onChange={(e) =>
                  setFromReading(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Select</option>
                {readings.readings.map((node) => (
                  <option key={node.id} value={node.id}>
                    {localInstant(node.readAt)} · #{node.id}
                  </option>
                ))}
              </select>
            </label>
            <label>
              To reading{" "}
              <select
                value={toReading ?? ""}
                onChange={(e) =>
                  setToReading(e.target.value ? Number(e.target.value) : null)
                }
              >
                <option value="">Select</option>
                {readings.readings.map((node) => (
                  <option key={node.id} value={node.id}>
                    {localInstant(node.readAt)} · #{node.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ) : (
          <Message>
            {readings.error?.message ?? "Loading meter readings…"}
          </Message>
        )}
        {readings.loaded && <MeterReadingsPager pages={readings} />}
        {reconciliation.data ? (
          <>
            <table>
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Coverage</th>
                  <th>Import ours / utility / ratio / verdict</th>
                  <th>Export ours / utility / ratio / verdict</th>
                </tr>
              </thead>
              <tbody>
                {reconciliation.data.reconciliation.candidates.map(
                  (candidate) => (
                    <tr key={candidate.source}>
                      <td>{candidate.source}</td>
                      <td title={candidate.coverage}>
                        {coveragePercent(candidate.coverage)}
                      </td>
                      <td>
                        <span
                          title={numericReason(
                            candidate.import.oursKwh,
                            null,
                            candidate.import.verdict,
                          )}
                        >
                          {decimal(candidate.import.oursKwh)}
                        </span>{" "}
                        /{" "}
                        <span
                          title={numericReason(
                            candidate.import.utilityKwh,
                            null,
                            candidate.import.verdict,
                          )}
                        >
                          {decimal(candidate.import.utilityKwh)}
                        </span>{" "}
                        /{" "}
                        <span
                          title={numericReason(
                            candidate.import.ratio,
                            null,
                            candidate.import.verdict,
                          )}
                        >
                          {decimal(candidate.import.ratio)}
                        </span>{" "}
                        / {candidate.import.verdict}
                      </td>
                      <td>
                        <span
                          title={numericReason(
                            candidate.export.oursKwh,
                            null,
                            candidate.export.verdict,
                          )}
                        >
                          {decimal(candidate.export.oursKwh)}
                        </span>{" "}
                        /{" "}
                        <span
                          title={numericReason(
                            candidate.export.utilityKwh,
                            null,
                            candidate.export.verdict,
                          )}
                        >
                          {decimal(candidate.export.utilityKwh)}
                        </span>{" "}
                        /{" "}
                        <span
                          title={numericReason(
                            candidate.export.ratio,
                            null,
                            candidate.export.verdict,
                          )}
                        >
                          {decimal(candidate.export.ratio)}
                        </span>{" "}
                        / {candidate.export.verdict}
                      </td>
                    </tr>
                  ),
                )}
              </tbody>
            </table>
            <p>
              Investigation:{" "}
              {reconciliation.data.reconciliation.investigationPath.join(
                " → ",
              ) || "None"}
            </p>
          </>
        ) : (
          fromReading != null &&
          toReading != null && (
            <Message>
              {reconciliation.error?.message ??
                "Select two different readings for reconciliation."}
            </Message>
          )
        )}
      </div>
      <div className="card">
        <h3>Calculation runs</h3>
        {runs.data ? (
          <>
            <ul>
              {runs.data.calculationRuns.edges.map(({ node }) => (
                <li key={node.id}>
                  #{node.id} · {node.kind} · {node.status} ·{" "}
                  {localInstant(node.startedAt)} · {node.reason}{" "}
                  {node.error && `· ${node.error}`}
                </li>
              ))}
            </ul>
            <button
              type="button"
              disabled={!runs.data.calculationRuns.pageInfo.hasNextPage}
              onClick={() =>
                setRunCursor(
                  runs.data.calculationRuns.pageInfo.endCursor ?? null,
                )
              }
            >
              More runs
            </button>
          </>
        ) : (
          <Message>
            {runs.error?.message ?? "Loading calculation runs…"}
          </Message>
        )}
      </div>
    </section>
  );
}
