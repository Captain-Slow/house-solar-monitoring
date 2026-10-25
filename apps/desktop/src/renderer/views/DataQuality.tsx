import { useEffect, useState, type ReactNode } from "react";
import { PanelShell } from "../components/panel-shell";
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
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { DataTable, Td, Th, Tr } from "../components/ui/data-table";
import { EmptyList } from "../components/ui/empty";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Reason } from "../components/ui/reason";
import { statusTone } from "../components/ui/status-tone";
import {
  coveragePercent,
  decimal,
  localInstant,
  numericReason,
  siteRangeInstants,
  siteLocalDate,
} from "../models";

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

const fieldLabel = "flex flex-col gap-1.5 text-xs text-muted-foreground";
const listClass =
  "divide-y divide-border rounded-lg border border-border text-xs";
const itemClass = "px-3 py-2";

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
      {edges.length === 0 ? (
        <EmptyList>No quality events in this range.</EmptyList>
      ) : (
        <ul className={listClass}>
          {edges.map(({ node }) => (
            <li key={node.id} className={itemClass}>
              {node.kind} · {localInstant(node.startedAt)} –{" "}
              {localInstant(node.endedAt)} · device {node.deviceId ?? "—"}
            </li>
          ))}
        </ul>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="self-start"
        disabled={!pageInfo.hasNextPage}
        onClick={() => setCursor(pageInfo.endCursor ?? null)}
      >
        More events
      </Button>
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
    <PanelShell
      title="Data Quality"
      titleId="quality-title"
      contentClassName="gap-4"
    >
      <Tile title="Collector & device">
        {status ? (
          <dl className="grid grid-cols-[minmax(140px,250px)_minmax(0,1fr)] gap-x-4 gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">State</dt>
            <dd>
              <Badge variant="secondary" className={statusTone(status.state)}>
                {status.state}
              </Badge>{" "}
              · {status.acquisitionSource}
            </dd>
            <dt className="text-muted-foreground">Last success</dt>
            <dd>{localInstant(status.lastSuccessAt)}</dd>
            <dt className="text-muted-foreground">Last error</dt>
            <dd>
              {status.lastError ?? "None"} · {localInstant(status.lastErrorAt)}
            </dd>
            <dt className="text-muted-foreground">Next retry</dt>
            <dd>{localInstant(status.nextRetryAt)}</dd>
            <dt className="text-muted-foreground">Monitoring since</dt>
            <dd>{localInstant(status.monitoringSince)}</dd>
            <dt className="text-muted-foreground">Last backup</dt>
            <dd>{localInstant(status.lastBackupAt)}</dd>
            <dt className="text-muted-foreground">TLS certificate expiry</dt>
            <dd>{localInstant(status.tlsCertExpiresAt)}</dd>
            <dt className="text-muted-foreground">Site day timezone</dt>
            <dd>{status.siteTimezone}</dd>
            <dt className="text-muted-foreground">
              Mapping / policy / calculation versions
            </dt>
            <dd>
              {status.mappingVersion} / {status.policyVersion} /{" "}
              {status.calcVersion}
            </dd>
            <dt className="text-muted-foreground">Current device</dt>
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
        <h4 className="pt-1 text-sm font-semibold">Devices</h4>
        {devices.data ? (
          devices.data.devices.length === 0 ? (
            <EmptyList>No devices recorded.</EmptyList>
          ) : (
            <ul className={listClass}>
              {devices.data.devices.map((device) => (
                <li key={device.id} className={itemClass}>
                  {device.deviceKey} · {device.model} · first{" "}
                  {localInstant(device.firstSeenAt)} · last{" "}
                  {localInstant(device.lastSeenAt)}
                  {device.retiredAt &&
                    ` · retired ${localInstant(device.retiredAt)}`}
                </li>
              ))}
            </ul>
          )
        ) : (
          <Message>{devices.error?.message ?? "Loading devices…"}</Message>
        )}
        <h4 className="pt-1 text-sm font-semibold">Accounting policies</h4>
        {policies.data ? (
          policies.data.accountingPolicies.length === 0 ? (
            <EmptyList>No accounting policies recorded.</EmptyList>
          ) : (
            <ul className={listClass}>
              {policies.data.accountingPolicies.map((policy) => (
                <li key={policy.version} className={itemClass}>
                  v{policy.version} · {policy.gridSource} grid ·{" "}
                  {policy.pvSource} solar · {policy.loadSource} load ·{" "}
                  {policy.batterySource} battery · validated {policy.validated}{" "}
                  · effective {localInstant(policy.effectiveFrom)}
                </li>
              ))}
            </ul>
          )
        ) : (
          <Message>{policies.error?.message ?? "Loading policies…"}</Message>
        )}
      </Tile>
      <Tile title="Gaps & events">
        <div className="flex flex-wrap items-end gap-4">
          <label className={fieldLabel}>
            From local day{" "}
            <Input
              type="date"
              className="h-8 w-auto"
              value={fromDate}
              onChange={(e) => setFromDate(e.target.value)}
            />
          </label>
          <label className={fieldLabel}>
            Through local day{" "}
            <Input
              type="date"
              className="h-8 w-auto"
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
      </Tile>
      <Tile title="Daily comparison against inverter counters">
        {totals.data ? (
          <DataTable containerClassName="overflow-x-auto">
            <thead>
              <Tr>
                <Th>Local day</Th>
                <Th>Quantity</Th>
                <Th>Ours kWh</Th>
                <Th>Inverter interval delta kWh (unvalidated)</Th>
                <Th>
                  Inverter lifetime kWh (includes pre-monitoring, unvalidated)
                </Th>
                <Th>Inverter today kWh (VENDOR_SUMMARY)</Th>
              </Tr>
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
                  <Tr key={`${row.periodStart}-${key}`}>
                    <Td className="whitespace-nowrap">{row.periodStart}</Td>
                    <Td>{key}</Td>
                    <Td className="tabular-nums">
                      <Reason
                        reason={row[key].flags.join(", ") || row[key].status}
                      >
                        {decimal(row[key].kwh)}
                      </Reason>
                    </Td>
                    <Td className="tabular-nums">
                      <Reason
                        reason={numericReason(
                          row.vendor.intervalDelta[key].kwh,
                          null,
                          "DEVICE_COUNTER: NEEDS_TWO_READINGS",
                        )}
                      >
                        {decimal(row.vendor.intervalDelta[key].kwh)}
                      </Reason>
                    </Td>
                    <Td className="tabular-nums">
                      <Reason
                        reason={numericReason(
                          row.vendor.lifetime[key].kwh,
                          null,
                          `${row.vendor.lifetime[key].provenance}: NO_READING`,
                        )}
                      >
                        {decimal(row.vendor.lifetime[key].kwh)}
                      </Reason>
                    </Td>
                    <Td className="tabular-nums">
                      <Reason
                        reason={numericReason(
                          row.vendor.vendorToday[key].kwh,
                          null,
                          "VENDOR_SUMMARY: NO_READING",
                        )}
                      >
                        {decimal(row.vendor.vendorToday[key].kwh)}
                      </Reason>
                    </Td>
                  </Tr>
                )),
              )}
            </tbody>
          </DataTable>
        ) : (
          <Message>
            {siteTimezone
              ? (totals.error?.message ?? "Loading daily comparisons…")
              : "Loading site timezone…"}
          </Message>
        )}
      </Tile>
      <Tile title="Reconciliation">
        {readings.loaded ? (
          <div className="flex flex-wrap items-end gap-4">
            <label className={fieldLabel}>
              From reading{" "}
              <NativeSelect
                size="sm"
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
              </NativeSelect>
            </label>
            <label className={fieldLabel}>
              To reading{" "}
              <NativeSelect
                size="sm"
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
              </NativeSelect>
            </label>
          </div>
        ) : (
          <Message>
            {readings.error?.message ?? "Loading meter readings…"}
          </Message>
        )}
        {readings.loaded && (
          <div className="flex flex-col items-start gap-3">
            <MeterReadingsPager pages={readings} />
          </div>
        )}
        {reconciliation.data ? (
          <>
            <DataTable containerClassName="overflow-x-auto">
              <thead>
                <Tr>
                  <Th>Source</Th>
                  <Th>Coverage</Th>
                  <Th>Import ours / utility / ratio / verdict</Th>
                  <Th>Export ours / utility / ratio / verdict</Th>
                </Tr>
              </thead>
              <tbody>
                {reconciliation.data.reconciliation.candidates.map(
                  (candidate) => (
                    <Tr key={candidate.source}>
                      <Td>{candidate.source}</Td>
                      <Td>
                        <Reason reason={candidate.coverage}>
                          {coveragePercent(candidate.coverage)}
                        </Reason>
                      </Td>
                      <Td className="tabular-nums">
                        <Reason
                          reason={numericReason(
                            candidate.import.oursKwh,
                            null,
                            candidate.import.verdict,
                          )}
                        >
                          {decimal(candidate.import.oursKwh)}
                        </Reason>{" "}
                        /{" "}
                        <Reason
                          reason={numericReason(
                            candidate.import.utilityKwh,
                            null,
                            candidate.import.verdict,
                          )}
                        >
                          {decimal(candidate.import.utilityKwh)}
                        </Reason>{" "}
                        /{" "}
                        <Reason
                          reason={numericReason(
                            candidate.import.ratio,
                            null,
                            candidate.import.verdict,
                          )}
                        >
                          {decimal(candidate.import.ratio)}
                        </Reason>{" "}
                        /{" "}
                        <Badge
                          variant="secondary"
                          className={statusTone(candidate.import.verdict)}
                        >
                          {candidate.import.verdict}
                        </Badge>
                      </Td>
                      <Td className="tabular-nums">
                        <Reason
                          reason={numericReason(
                            candidate.export.oursKwh,
                            null,
                            candidate.export.verdict,
                          )}
                        >
                          {decimal(candidate.export.oursKwh)}
                        </Reason>{" "}
                        /{" "}
                        <Reason
                          reason={numericReason(
                            candidate.export.utilityKwh,
                            null,
                            candidate.export.verdict,
                          )}
                        >
                          {decimal(candidate.export.utilityKwh)}
                        </Reason>{" "}
                        /{" "}
                        <Reason
                          reason={numericReason(
                            candidate.export.ratio,
                            null,
                            candidate.export.verdict,
                          )}
                        >
                          {decimal(candidate.export.ratio)}
                        </Reason>{" "}
                        /{" "}
                        <Badge
                          variant="secondary"
                          className={statusTone(candidate.export.verdict)}
                        >
                          {candidate.export.verdict}
                        </Badge>
                      </Td>
                    </Tr>
                  ),
                )}
              </tbody>
            </DataTable>
            <p className="text-xs text-muted-foreground">
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
      </Tile>
      <Tile title="Calculation runs">
        {runs.data ? (
          <>
            {runs.data.calculationRuns.edges.length === 0 ? (
              <EmptyList>No calculation runs yet.</EmptyList>
            ) : (
              <ul className={listClass}>
                {runs.data.calculationRuns.edges.map(({ node }) => (
                  <li key={node.id} className={itemClass}>
                    #{node.id} · {node.kind} · {node.status} ·{" "}
                    {localInstant(node.startedAt)} · {node.reason}{" "}
                    {node.error && `· ${node.error}`}
                  </li>
                ))}
              </ul>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={!runs.data.calculationRuns.pageInfo.hasNextPage}
              onClick={() =>
                setRunCursor(
                  runs.data.calculationRuns.pageInfo.endCursor ?? null,
                )
              }
            >
              More runs
            </Button>
          </>
        ) : (
          <Message>
            {runs.error?.message ?? "Loading calculation runs…"}
          </Message>
        )}
      </Tile>
    </PanelShell>
  );
}
