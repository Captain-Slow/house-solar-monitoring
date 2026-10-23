import { useEffect, useState } from "react";
import type {
  BillingPeriodQuery,
  BillingPeriodsQuery,
  CollectorStatusQuery,
  EnergyTotalsQuery,
} from "@solar/contracts/generated/graphql";
import { useSolarQuery } from "../api";
import { Metric, Message } from "../components/Display";
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

export function BillingLineItems({ result }: { result: BillingResult }) {
  return (
    <table>
      <caption>Billing line items</caption>
      <thead>
        <tr>
          <th>Item</th>
          <th>Quantity kWh</th>
          <th>Rate</th>
          <th>Amount</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {result.lineItems.map((line, index) => (
          <tr key={`${line.code}-${line.segment}-${index}`}>
            <td title={line.note ?? undefined}>{line.label}</td>
            <td
              title={lineItemMissingReason(line, "quantityKwh", result.reasons)}
            >
              {decimal(line.quantityKwh)}
            </td>
            <td title={lineItemMissingReason(line, "rate", result.reasons)}>
              {decimal(line.rate)}
            </td>
            <td title={lineItemMissingReason(line, "amount", result.reasons)}>
              {decimal(line.amount)}
            </td>
            <td>{line.status}</td>
          </tr>
        ))}
      </tbody>
    </table>
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
    <section aria-labelledby="cost-title">
      <h2 id="cost-title">Usage &amp; Cost</h2>
      <p className="caption">
        Calculated from measured grid import/export under your configured
        tariff; not your TNB bill.
      </p>
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
        {range === "custom" && (
          <>
            <label>
              From{" "}
              <input
                type="date"
                value={customFrom}
                onChange={(e) => setFrom(e.target.value)}
              />
            </label>
            <label>
              Through{" "}
              <input
                type="date"
                value={customTo}
                onChange={(e) => setTo(e.target.value)}
              />
            </label>
          </>
        )}
      </div>
      {!siteTimezone ? (
        <Message>Loading site timezone…</Message>
      ) : (
        !valid && (
          <Message>Through date must be on or after start date.</Message>
        )
      )}
      <p className="meta">
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
          <dl className="metrics">
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
                    <span className="badge">
                      {value.provenance} · coverage{" "}
                      <span title={value.coverage}>
                        {coveragePercent(value.coverage)}
                      </span>{" "}
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
      <h3>Billing periods</h3>
      {periods.data ? (
        <>
          <ul className="period-list">
            {periods.data.billingPeriods.edges.map(({ node }) => {
              const result = node.result;
              const estimate = result
                ? billingEstimate(result, result.nem != null)
                : null;
              return (
                <li key={node.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(node.id)}
                    aria-pressed={selected === node.id}
                  >
                    {node.startDate} – {node.endDate} ·{" "}
                    {result?.status ?? "Not calculated"} · {estimate?.marker}
                    <span
                      title={numericReason(
                        result?.total,
                        result?.reasons.join(", "),
                        result?.status ?? "Not calculated",
                      )}
                    >
                      {decimal(result?.total)}
                    </span>{" "}
                    {result && (
                      <span title={result.coverage}>
                        (coverage {coveragePercent(result.coverage)})
                      </span>
                    )}
                  </button>
                  {estimate?.explanation && (
                    <span className="estimate">{estimate.explanation}</span>
                  )}
                  {node.stale && (
                    <span className="badge">Recalculation pending</span>
                  )}
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            disabled={!periods.data.billingPeriods.pageInfo.hasNextPage}
            onClick={() =>
              setCursor(periods.data.billingPeriods.pageInfo.endCursor ?? null)
            }
          >
            More periods
          </button>
        </>
      ) : (
        <Message>
          {periods.error?.message ?? "Loading billing periods…"}
        </Message>
      )}
      {selected != null && (
        <div className="card">
          <h3>Period detail</h3>
          {detail.data?.billingPeriod ? (
            (() => {
              const period = detail.data.billingPeriod;
              const result = period.result;
              const estimate = result
                ? billingEstimate(result, result.nem != null)
                : null;
              return (
                <>
                  <p>
                    {period.startDate} – {period.endDate} ·{" "}
                    {result?.status ?? "Not calculated"} · coverage{" "}
                    <span title={result?.coverage ?? undefined}>
                      {coveragePercent(result?.coverage)}
                    </span>
                  </p>
                  <p>
                    Subtotal:{" "}
                    <span
                      title={numericReason(
                        result?.subtotal,
                        result?.reasons.join(", "),
                        result?.status ?? "Not calculated",
                      )}
                    >
                      {decimal(result?.subtotal)}
                    </span>{" "}
                    · Total: {estimate?.marker}
                    <span
                      title={numericReason(
                        result?.total,
                        result?.reasons.join(", "),
                        result?.status ?? "Not calculated",
                      )}
                    >
                      {decimal(result?.total)}
                    </span>
                  </p>
                  {estimate?.explanation && (
                    <p className="estimate">{estimate.explanation}</p>
                  )}
                  {result && (
                    <>
                      <p>Reasons: {result.reasons.join(", ") || "None"}</p>
                      <BillingLineItems result={result} />
                      {result.nem && (
                        <table>
                          <caption>NEM credit lots</caption>
                          <thead>
                            <tr>
                              <th>Type</th>
                              <th>Origin local day</th>
                              <th>Remaining kWh</th>
                            </tr>
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
                                <tr key={`${kind}-${index}`}>
                                  <td>{kind}</td>
                                  <td>{lot.originStart}</td>
                                  <td>{decimal(lot.kwh)}</td>
                                </tr>
                              )),
                            )}
                          </tbody>
                        </table>
                      )}
                    </>
                  )}
                </>
              );
            })()
          ) : (
            <Message>{detail.error?.message ?? "Loading period…"}</Message>
          )}
        </div>
      )}
    </section>
  );
}
