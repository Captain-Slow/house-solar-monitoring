import { DateTime } from "luxon";
import type { ConnectionState } from "@solar/contracts/bridge";
import type {
  LiveStatusQuery,
  PowerSeriesQuery,
} from "@solar/contracts/generated/graphql";

export type Live = LiveStatusQuery["liveStatus"];
export type Power = Live["pv"];

export function decimal(
  value: string | null | undefined,
  minimumFractionDigits = 0,
): string {
  if (value == null) return "—";
  const negative = value.startsWith("-");
  const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
  const grouped = (whole ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "−" : ""}${grouped}${fraction || minimumFractionDigits ? "." + fraction.padEnd(minimumFractionDigits, "0") : ""}`;
}

/** Coverage is a unit fraction encoded as a Decimal string; round to two percent places without float conversion. */
export function coveragePercent(value: string | null | undefined): string {
  if (value == null) return "—";
  const [whole = "0", fractional = ""] = value.split(".");
  let digits = `${whole}${fractional.padEnd(4, "0").slice(0, 4)}`;
  if (fractional.length > 4 && fractional[4]! >= "5") {
    let index = digits.length - 1;
    while (index >= 0 && digits[index] === "9") index--;
    digits =
      index < 0
        ? `1${"0".repeat(digits.length)}`
        : `${digits.slice(0, index)}${String.fromCharCode(digits.charCodeAt(index) + 1)}${"0".repeat(digits.length - index - 1)}`;
  }
  digits = digits.padStart(3, "0");
  const percentWhole = digits.slice(0, -2).replace(/^0+(?=\d)/, "");
  const percentFraction = digits.slice(-2).replace(/0+$/, "");
  return `${percentWhole}${percentFraction ? `.${percentFraction}` : ""} %`;
}

export function watts(value: number | null | undefined): string {
  return value == null ? "—" : `${value.toLocaleString()} W`;
}

export function numericReason(
  value: string | null | undefined,
  reason: string | null | undefined,
  fallback: string,
): string | undefined {
  return value == null ? reason || fallback : undefined;
}

export type BillingLineValue = {
  code: string;
  kind: string;
  status: string;
  note: string | null;
  quantityKwh: string | null;
  rate: string | null;
  amount: string | null;
};
export function lineItemMissingReason(
  line: BillingLineValue,
  field: "quantityKwh" | "rate" | "amount",
  resultReasons: readonly string[],
): string | undefined {
  if (line[field] != null) return undefined;
  if (
    field === "quantityKwh" &&
    ["FIXED", "PERCENT", "ROUNDING"].includes(line.kind)
  )
    return "Not applicable";
  if (field === "rate" && ["PER_KWH", "ROUNDING"].includes(line.kind))
    return "Not applicable";
  const componentReason = resultReasons.find(
    (reason) => reason === `MONTHLY_RATE_MISSING:${line.code}`,
  );
  const reason =
    componentReason ??
    (line.status === "UNAVAILABLE"
      ? resultReasons.join(", ") || "Unavailable"
      : "Not applicable");
  return line.note ? `${reason} · billing month ${line.note}` : reason;
}

export function energyValue(value: {
  kwh: string | null;
  flags?: readonly string[];
  status?: string;
}): { text: string; reason: string | undefined } {
  return {
    text: value.kwh == null ? "—" : `${decimal(value.kwh, 3)} kWh`,
    reason:
      value.kwh == null
        ? value.flags?.join(", ") || value.status || "NO_READING"
        : undefined,
  };
}

export function powerValue(value: Power): {
  text: string;
  reason: string | undefined;
} {
  return {
    text: watts(value.watts),
    reason: value.watts == null ? (value.reason ?? value.status) : undefined,
  };
}

export function batteryDirection(
  value: number | null,
  vendorState: string | null,
): string {
  if (value === null)
    return vendorState === "Standby"
      ? "Idle (vendor status)"
      : (vendorState ?? "—");
  if (value > 0) return "Discharging";
  if (value < 0) return "Charging";
  return "Idle";
}

export type Flow = {
  from: string;
  to: string;
  watts: number | null;
  reason?: string | null;
};
export function flowTier(value: number | null): "idle" | "normal" | "strong" {
  return value == null || Math.abs(value) < 100
    ? "idle"
    : Math.abs(value) < 2000
      ? "normal"
      : "strong";
}

// Signed grid: positive import. Signed battery: positive discharge (backend sample convention).
export function flows(
  live: Record<
    "pv" | "grid" | "battery" | "load",
    Pick<Power, "watts" | "reason">
  >,
): Flow[] {
  const directed = (
    first: string,
    second: string,
    value: Pick<Power, "watts" | "reason">,
  ): Flow => ({
    from: value.watts != null && value.watts < 0 ? second : first,
    to: value.watts != null && value.watts < 0 ? first : second,
    watts: value.watts == null ? null : Math.abs(value.watts),
    reason: value.reason,
  });
  return [
    directed("Solar", "Inverter", live.pv),
    directed("Grid", "Inverter", live.grid),
    directed("Battery", "Inverter", live.battery),
    directed("Inverter", "Home", live.load),
  ];
}

export function freshness(live: {
  ageSeconds: number | null;
  freshness: string;
}): "LIVE" | "STALE" | "NO_DATA" {
  if (live.ageSeconds == null) return "NO_DATA";
  return live.ageSeconds <= 30 && live.freshness === "LIVE" ? "LIVE" : "STALE";
}

export function dashboardStaleness(
  tab: string,
  connection: ConnectionState | null,
  live: { ageSeconds: number | null; freshness: string } | undefined,
): { greyed: boolean; overviewStale: boolean; lastKnown: boolean } {
  const lastKnown = connection?.kind === "RECONNECTING";
  const overviewStale =
    lastKnown || (live != null && freshness(live) !== "LIVE");
  return {
    greyed: lastKnown || (tab === "Overview" && overviewStale),
    overviewStale,
    lastKnown,
  };
}

export function gapAreas(
  gaps: PowerSeriesQuery["powerSeries"]["gaps"],
): Array<[{ xAxis: string }, { xAxis: string }]> {
  return gaps.map((gap) => [{ xAxis: gap.from }, { xAxis: gap.to }]);
}

type SeriesPoints = PowerSeriesQuery["powerSeries"]["series"][number]["points"];
export type SocLine = {
  statistic: "avg" | "min" | "max";
  name: string;
  data: Array<[string, number | null]>;
};

/**
 * Backend SOC points carry avg only at sample resolution; rollup buckets provide min/max with avg null.
 * Each statistic is plotted under its own honest name, only when it has at least one value, and null stays
 * null so buckets without data remain gaps instead of becoming zeros or borrowing another statistic.
 */
export function socLines(points: SeriesPoints): SocLine[] {
  return (
    [
      { statistic: "avg", name: "SOC average" },
      { statistic: "min", name: "SOC minimum" },
      { statistic: "max", name: "SOC maximum" },
    ] as const
  )
    .map(({ statistic, name }) => ({
      statistic,
      name,
      data: points.map((point): [string, number | null] => [
        point.t,
        point[statistic],
      ]),
    }))
    .filter((line) => line.data.some(([, value]) => value !== null));
}

export function bucketLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${seconds / 60} min`;
  if (seconds < 86_400) return `${seconds / 3600} h`;
  return `${seconds / 86_400} d`;
}

export function billingEstimate(
  result: { status: string; isLowerBound: boolean; reasons: readonly string[] },
  isNem: boolean,
): { marker: string; explanation: string | null } {
  if (result.status !== "ESTIMATED") return { marker: "", explanation: null };
  if (result.isLowerBound && !isNem)
    return { marker: "≥", explanation: result.reasons.join(", ") };
  return {
    marker: "",
    explanation: `estimate: may be higher or lower${result.reasons.length ? ` — ${result.reasons.join(", ")}` : ""}`,
  };
}

export function localInstant(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}
export function localTime(value: string | null | undefined): string {
  return value
    ? new Date(value).toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "—";
}
export function siteLocalDate(instant: Date, siteTimezone: string): string {
  const day = DateTime.fromJSDate(instant, { zone: siteTimezone }).toISODate();
  if (!day) throw new Error(`Invalid site timezone: ${siteTimezone}`);
  return day;
}
export function advanceDate(date: string, days: number): string {
  const next = DateTime.fromISO(date, { zone: "UTC" })
    .plus({ days })
    .toISODate();
  if (!next) throw new Error(`Invalid local date: ${date}`);
  return next;
}
export function siteDayStartUtc(date: string, siteTimezone: string): string {
  const start = DateTime.fromISO(date, { zone: siteTimezone }).startOf("day");
  const utc = start.toUTC().toISO({ suppressMilliseconds: true });
  if (!start.isValid || start.toISODate() !== date || !utc)
    throw new Error(`Invalid site local day: ${date}`);
  return utc;
}

/** EnergyTotals takes an inclusive LocalDate; PowerSeries is exclusive, quality events inclusive in UTC. */
export function siteRangeInstants(
  fromDate: string,
  throughDate: string,
  siteTimezone: string,
): {
  from: string;
  toExclusive: string;
  toInclusive: string;
} {
  const from = siteDayStartUtc(fromDate, siteTimezone);
  const toExclusive = siteDayStartUtc(
    advanceDate(throughDate, 1),
    siteTimezone,
  );
  const toInclusive = DateTime.fromISO(toExclusive, { zone: "UTC" })
    .minus({ milliseconds: 1 })
    .toISO();
  if (!toInclusive) throw new Error(`Invalid site local day: ${throughDate}`);
  return { from, toExclusive, toInclusive };
}
export function staleBanner(
  since: string,
  lastData: string | null,
  now: number,
  serverAgeSeconds?: number | null,
  elapsedSeconds = 0,
): string {
  const sinceLocal = new Date(since).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const last = lastData ? new Date(lastData) : null;
  const age =
    serverAgeSeconds == null
      ? last
        ? (now - last.getTime()) / 1000
        : 0
      : serverAgeSeconds + elapsedSeconds;
  const minutes = Math.max(0, Math.floor(age / 60));
  return `Backend unreachable since ${sinceLocal} — last data ${localTime(lastData)} (${minutes} min ago). Collection runs on the NAS independently of this app.`;
}

export type RangeKind = "day" | "week" | "month" | "year" | "custom";
export function rangeDates(
  kind: RangeKind,
  now: Date,
  customFrom: string,
  customTo: string,
  siteTimezone: string,
): {
  fromDate: string;
  toDate: string;
  granularity: "DAY" | "WEEK" | "MONTH" | "YEAR";
} {
  const today = siteLocalDate(now, siteTimezone);
  if (kind === "custom")
    return {
      fromDate: customFrom,
      toDate: customTo,
      granularity: "DAY",
    };
  if (kind === "day")
    return {
      fromDate: today,
      toDate: today,
      granularity: "DAY",
    };
  if (kind === "week") {
    const weekday = DateTime.fromISO(today, { zone: siteTimezone }).weekday;
    const monday = advanceDate(today, 1 - weekday);
    return {
      fromDate: monday,
      toDate: advanceDate(monday, 6),
      granularity: "DAY",
    };
  }
  if (kind === "month") {
    const start = `${today.slice(0, 7)}-01`;
    const following = DateTime.fromISO(start, { zone: siteTimezone })
      .plus({ months: 1 })
      .toISODate();
    if (!following) throw new Error(`Invalid site local month: ${start}`);
    return {
      fromDate: start,
      toDate: advanceDate(following, -1),
      granularity: "DAY",
    };
  }
  return {
    fromDate: `${today.slice(0, 4)}-01-01`,
    toDate: `${today.slice(0, 4)}-12-31`,
    granularity: "MONTH",
  };
}

export function isAdmin(
  role: "ADMIN" | "VIEWER" | "UNKNOWN" | undefined,
): boolean {
  return role === "ADMIN";
}
