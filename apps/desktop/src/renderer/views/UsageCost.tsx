import { useEffect, useState, type ReactNode } from "react";
import { PanelShell } from "../components/panel-shell";
import { ToolbarGroup } from "../components/toolbar-group";
import type {
  BillingPeriodQuery,
  BillingPeriodsQuery,
  CollectorStatusQuery,
  EnergyTotalsQuery,
} from "@solar/contracts/generated/graphql";
import { useSolarQuery } from "../api";
import { Metric, Message } from "../components/Display";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { DataTable, Td, Th, Tr } from "../components/ui/data-table";
import { EmptyList } from "../components/ui/empty";
import { Input } from "../components/ui/input";
import { NativeSelect } from "../components/ui/native-select";
import { Reason } from "../components/ui/reason";
import { statusTone } from "../components/ui/status-tone";
import { cn } from "../lib/utils";
import {
  billingEstimate,
  coveragePercent,
  decimal,
  energyValue,
  siteLocalDate,
  localInstant,
  lineItemMissingReason,
  numericReason,
  rangeDates,
  type RangeKind,
} from "../models";

type BillingResult = NonNullable<
  NonNullable<BillingPeriodQuery["billingPeriod"]>["result"]
>;

// Controls inside a ToolbarGroup fill the pill's 30px interior, borderless like its icon buttons.
const pillLabel =
  "flex items-center gap-1.5 ps-3 text-xs text-muted-foreground";
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

export function BillingLineItems({ result }: { result: BillingResult }) {
  return (
    <DataTable containerClassName="overflow-x-auto">
      <caption className="sr-only">Billing line items</caption>
      <thead>
        <Tr>
          <Th>Item</Th>
          <Th>Quantity kWh</Th>
          <Th>Rate</Th>
          <Th>Amount</Th>
          <Th>Status</Th>
        </Tr>
      </thead>
      <tbody>
        {result.lineItems.map((line, index) => (
          <Tr key={`${line.code}-${line.segment}-${index}`}>
            <Td>
              <Reason reason={line.note}>{line.label}</Reason>
            </Td>
            <Td className="tabular-nums">
              <Reason
                reason={lineItemMissingReason(
                  line,
                  "quantityKwh",
                  result.reasons,
                )}
              >
                {decimal(line.quantityKwh)}
              </Reason>
            </Td>
            <Td className="tabular-nums">
              <Reason
                reason={lineItemMissingReason(line, "rate", result.reasons)}
              >
                {decimal(line.rate)}
              </Reason>
            </Td>
            <Td className="tabular-nums">
              <Reason
                reason={lineItemMissingReason(line, "amount", result.reasons)}
              >
                {decimal(line.amount)}
              </Reason>
            </Td>
            <Td>{line.status}</Td>
          </Tr>
        ))}
      </tbody>
    </DataTable>
  );
}
export function UsageCost({
  siteTimezone,
}: {
  siteTimezone: string | undefined;
}) {
  const [range, setRange] = useState<RangeKind>("month");
  const [customFrom, setFrom] = useState("");
  const [customTo, setTo] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  useEffect(() => {
    if (siteTimezone) {
      const today = siteLocalDate(new Date(), siteTimezone);
      setFrom(today);
      setTo(today);
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
  const totals = useSolarQuery<EnergyTotalsQuery>(
    "EnergyTotals",
    dates,
    undefined,
    valid,
  );
  const collector = useSolarQuery<CollectorStatusQuery>(
    "CollectorStatus",
    undefined,
    30_000,
  );
  const periods = useSolarQuery<BillingPeriodsQuery>("BillingPeriods", {
    first: 24,
    after: cursor,
  });
  const detail = useSolarQuery<BillingPeriodQuery>(
    "BillingPeriod",
    { id: selected },
    undefined,
    selected != null,
  );
  const total = totals.data?.energyTotals.total;
  return (
    <PanelShell
      title="Usage & Cost"
      titleId="cost-title"
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
        </ToolbarGroup>
      }
    >
      <p className="text-sm font-medium text-foreground">
        Calculated from measured grid import/export under your configured
        tariff; not your TNB bill.
      </p>
      {range === "custom" && (
        <ToolbarGroup className="self-end">
          <label className={pillLabel}>
            From{" "}
            <Input
              type="date"
              className={cn(pillField, "w-auto px-2 md:text-xs")}
              value={customFrom}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className={pillLabel}>
            Through{" "}
            <Input
              type="date"
              className={cn(pillField, "w-auto px-2 md:text-xs")}
              value={customTo}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </ToolbarGroup>
      )}
      {!siteTimezone ? (
        <Message>Loading site timezone…</Message>
      ) : (
        !valid && (
          <Message>Through date must be on or after start date.</Message>
        )
      )}
      <p className="text-xs text-muted-foreground">
        Monitoring since{" "}
        {localInstant(
          totals.data?.energyTotals.monitoringSince ??
            collector.data?.collectorStatus.monitoringSince,
        )}{" "}
        {totals.data?.energyTotals.preMonitoringExcluded &&
          "· Pre-monitoring energy excluded"}
      </p>
      {valid &&
        (total ? (
          <dl className="grid shrink-0 grid-cols-2 gap-4">
            {(
              [
                ["Solar", total.solar],
                ["Consumption", total.consumption],
                ["Grid import", total.gridImport],
                ["Grid export", total.gridExport],
                ["Battery charge", total.batteryCharge],
                ["Battery discharge", total.batteryDischarge],
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
                    <span className="text-xs text-muted-foreground">
                      {value.provenance} · coverage{" "}
                      <Reason reason={value.coverage}>
                        {coveragePercent(value.coverage)}
                      </Reason>{" "}
                      · {value.status}
                    </span>
                  }
                />
              );
            })}
          </dl>
        ) : (
          <Message>{totals.error?.message ?? "Loading energy totals…"}</Message>
        ))}
      <Tile title="Billing periods">
        {periods.data ? (
          <>
            {periods.data.billingPeriods.edges.length === 0 ? (
              <EmptyList>No billing periods yet.</EmptyList>
            ) : (
              <ul className="flex flex-col gap-2">
                {periods.data.billingPeriods.edges.map(({ node }) => {
                  const result = node.result;
                  const estimate = result
                    ? billingEstimate(result, result.nem != null)
                    : null;
                  const status = result?.status ?? "Not calculated";
                  const pressed = selected === node.id;
                  return (
                    <li key={node.id} className="flex flex-col gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto w-full justify-start rounded-md border px-3 py-2 text-start text-xs font-normal whitespace-normal data-[pressed=true]:bg-accent"
                        onClick={() => setSelected(node.id)}
                        aria-pressed={pressed}
                        data-pressed={pressed}
                      >
                        <span className="min-w-0 flex-1 leading-5">
                          {node.startDate} – {node.endDate} ·{" "}
                          <Badge
                            variant="secondary"
                            className={statusTone(status)}
                          >
                            {status}
                          </Badge>{" "}
                          · {estimate?.marker}
                          <Reason
                            focusable={false}
                            reason={numericReason(
                              result?.total,
                              result?.reasons.join(", "),
                              status,
                            )}
                          >
                            {decimal(result?.total)}
                          </Reason>{" "}
                          {result && (
                            <Reason focusable={false} reason={result.coverage}>
                              (coverage {coveragePercent(result.coverage)})
                            </Reason>
                          )}
                        </span>
                      </Button>
                      {(estimate?.explanation || node.stale) && (
                        <div className="flex flex-wrap items-center gap-2 px-1">
                          {estimate?.explanation && (
                            <span className="text-xs text-chart-4">
                              {estimate.explanation}
                            </span>
                          )}
                          {node.stale && (
                            <Badge variant="secondary">
                              Recalculation pending
                            </Badge>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start"
              disabled={!periods.data.billingPeriods.pageInfo.hasNextPage}
              onClick={() =>
                setCursor(
                  periods.data.billingPeriods.pageInfo.endCursor ?? null,
                )
              }
            >
              More periods
            </Button>
          </>
        ) : (
          <Message>
            {periods.error?.message ?? "Loading billing periods…"}
          </Message>
        )}
      </Tile>
      {selected != null && (
        <Tile title="Period detail">
          {detail.data?.billingPeriod ? (
            (() => {
              const period = detail.data.billingPeriod;
              const result = period.result;
              const estimate = result
                ? billingEstimate(result, result.nem != null)
                : null;
              const status = result?.status ?? "Not calculated";
              return (
                <>
                  <div className="flex flex-col gap-1 text-sm">
                    <p>
                      {period.startDate} – {period.endDate} ·{" "}
                      <Badge variant="secondary" className={statusTone(status)}>
                        {status}
                      </Badge>{" "}
                      · coverage{" "}
                      <Reason reason={result?.coverage}>
                        {coveragePercent(result?.coverage)}
                      </Reason>
                    </p>
                    <p>
                      Subtotal:{" "}
                      <Reason
                        reason={numericReason(
                          result?.subtotal,
                          result?.reasons.join(", "),
                          status,
                        )}
                      >
                        {decimal(result?.subtotal)}
                      </Reason>{" "}
                      · Total: {estimate?.marker}
                      <Reason
                        reason={numericReason(
                          result?.total,
                          result?.reasons.join(", "),
                          status,
                        )}
                      >
                        {decimal(result?.total)}
                      </Reason>
                    </p>
                    {estimate?.explanation && (
                      <p className="text-xs text-chart-4">
                        {estimate.explanation}
                      </p>
                    )}
                    {result && (
                      <p>Reasons: {result.reasons.join(", ") || "None"}</p>
                    )}
                  </div>
                  {result && (
                    <>
                      <BillingLineItems result={result} />
                      {result.nem && (
                        <DataTable containerClassName="overflow-x-auto">
                          <caption className="sr-only">NEM credit lots</caption>
                          <thead>
                            <Tr>
                              <Th>Type</Th>
                              <Th>Origin local day</Th>
                              <Th>Remaining kWh</Th>
                            </Tr>
                          </thead>
                          <tbody>
                            {(
                              [
                                "openingLots",
                                "closingLots",
                                "expiredLots",
                              ] as const
                            ).flatMap((kind) =>
                              result.nem![kind].map((lot, index) => (
                                <Tr key={`${kind}-${index}`}>
                                  <Td>{kind}</Td>
                                  <Td>{lot.originStart}</Td>
                                  <Td className="tabular-nums">
                                    {decimal(lot.kwh)}
                                  </Td>
                                </Tr>
                              )),
                            )}
                          </tbody>
                        </DataTable>
                      )}
                    </>
                  )}
                </>
              );
            })()
          ) : (
            <Message>{detail.error?.message ?? "Loading period…"}</Message>
          )}
        </Tile>
      )}
    </PanelShell>
  );
}
