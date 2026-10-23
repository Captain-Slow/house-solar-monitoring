import { describe, expect, it } from "vitest";
import {
  advanceDate,
  batteryDirection,
  billingEstimate,
  coveragePercent,
  dashboardStaleness,
  decimal,
  energyValue,
  flowTier,
  flows,
  freshness,
  gapAreas,
  isAdmin,
  numericReason,
  rangeDates,
  siteDayStartUtc,
  siteLocalDate,
  siteRangeInstants,
  staleBanner,
  watts,
} from "./models";

describe("numeric display", () => {
  it("distinguishes missing readings with reasons from measured zero", () => {
    expect(energyValue({ kwh: null, flags: ["METER_LINK_DOWN"] })).toEqual({
      text: "—",
      reason: "METER_LINK_DOWN",
    });
    expect(energyValue({ kwh: "0", flags: [] })).toEqual({
      text: "0.000 kWh",
      reason: undefined,
    });
    expect(watts(0)).toBe("0 W");
    expect(watts(null)).toBe("—");
  });
  it("formats fixed-point decimals without binary floating point rounding", () => {
    expect(decimal("123456789012.000001")).toBe("123,456,789,012.000001");
    expect(decimal("-0.010000")).toBe("−0.010000");
    expect(decimal("0", 3)).toBe("0.000");
  });
  it("rounds tiny Decimal coverage into readable percent without floating point", () => {
    expect(coveragePercent("0.0003531947983836499")).toBe("0.04 %");
    expect(coveragePercent("0.00007559424917082049")).toBe("0.01 %");
    expect(coveragePercent("1")).toBe("100 %");
    expect(coveragePercent("0")).toBe("0 %");
    expect(coveragePercent("0.99995")).toBe("100 %");
    expect(coveragePercent(null)).toBe("—");
  });
  it("explains missing numeric readings without tagging a measured zero", () => {
    expect(numericReason(null, "MISSING_EXPORT", "UNAVAILABLE")).toBe(
      "MISSING_EXPORT",
    );
    expect(numericReason(null, null, "UNAVAILABLE")).toBe("UNAVAILABLE");
    expect(numericReason("0", "MISSING_EXPORT", "UNAVAILABLE")).toBeUndefined();
  });
});

describe("energy flow and freshness", () => {
  it("assigns dashed, normal and strong tiers at 100 W and 2 kW boundaries", () => {
    expect(flowTier(99)).toBe("idle");
    expect(flowTier(-100)).toBe("normal");
    expect(flowTier(1999)).toBe("normal");
    expect(flowTier(-2000)).toBe("strong");
  });
  it("reverses export and charging arrows while preserving missing readings", () => {
    const power = (watts: number | null) => ({
      watts,
      status: "OK" as const,
      reason: watts == null ? "NO_READING" : null,
    });
    expect(
      flows({
        pv: power(120),
        grid: power(-130),
        battery: power(-90),
        load: power(null),
      }),
    ).toEqual([
      { from: "Solar", to: "Inverter", watts: 120, reason: null },
      { from: "Inverter", to: "Grid", watts: 130, reason: null },
      { from: "Inverter", to: "Battery", watts: 90, reason: null },
      { from: "Inverter", to: "Home", watts: null, reason: "NO_READING" },
    ]);
  });
  it("labels discharge, charge and idle using signed measured battery watts", () => {
    expect(batteryDirection(100, "Charging")).toBe("Discharging");
    expect(batteryDirection(-100, "Discharging")).toBe("Charging");
    expect(batteryDirection(0, "Standby")).toBe("Idle");
    expect(batteryDirection(null, "Standby")).toBe("Idle (vendor status)");
  });
  it("uses server ageSeconds rather than local clock for LIVE threshold", () => {
    expect(freshness({ freshness: "LIVE", ageSeconds: 30 })).toBe("LIVE");
    expect(freshness({ freshness: "LIVE", ageSeconds: 31 })).toBe("STALE");
    expect(freshness({ freshness: "NO_DATA", ageSeconds: null })).toBe(
      "NO_DATA",
    );
  });
});

describe("history and billing", () => {
  it("turns each server gap into chart markArea boundaries", () => {
    expect(
      gapAreas([{ from: "2026-02-01T02:00:00Z", to: "2026-02-01T02:05:00Z" }]),
    ).toEqual([
      [{ xAxis: "2026-02-01T02:00:00Z" }, { xAxis: "2026-02-01T02:05:00Z" }],
    ]);
  });
  it("shows lower-bound marker only for estimated non-NEM bills", () => {
    const estimated = {
      status: "ESTIMATED" as const,
      isLowerBound: true,
      reasons: ["GAP"],
    };
    expect(billingEstimate(estimated, false)).toEqual({
      marker: "≥",
      explanation: "GAP",
    });
    expect(billingEstimate(estimated, true).marker).toBe("");
    expect(billingEstimate(estimated, true).explanation).toContain(
      "estimate: may be higher or lower",
    );
    expect(
      billingEstimate({ ...estimated, isLowerBound: false }, false).marker,
    ).toBe("");
  });
  it("keeps local date buckets independent of UTC conversion", () => {
    expect(advanceDate("2024-02-28", 1)).toBe("2024-02-29");
    expect(
      rangeDates(
        "month",
        new Date("2024-02-20T03:00:00Z"),
        "",
        "",
        "Asia/Kuala_Lumpur",
      ),
    ).toEqual({
      fromDate: "2024-02-01",
      toDate: "2024-02-29",
      granularity: "DAY",
    });
  });
  it("chooses site today across a UTC-PC date boundary", () => {
    const instant = new Date("2026-10-17T18:00:00Z");
    expect(siteLocalDate(instant, "UTC")).toBe("2026-10-17");
    expect(siteLocalDate(instant, "Asia/Kuala_Lumpur")).toBe("2026-10-18");
    expect(rangeDates("day", instant, "", "", "Asia/Kuala_Lumpur")).toEqual({
      fromDate: "2026-10-18",
      toDate: "2026-10-18",
      granularity: "DAY",
    });
    expect(siteDayStartUtc("2026-10-18", "Asia/Kuala_Lumpur")).toBe(
      "2026-10-17T16:00:00Z",
    );
  });
  it("converts site day boundaries across DST without assuming 24-hour UTC days", () => {
    expect(siteDayStartUtc("2024-03-10", "America/New_York")).toBe(
      "2024-03-10T05:00:00Z",
    );
    expect(siteDayStartUtc("2024-03-11", "America/New_York")).toBe(
      "2024-03-11T04:00:00Z",
    );
  });
  it("uses inclusive energyTotals dates and exclusive powerSeries instants for the same selected day", () => {
    const dates = rangeDates(
      "custom",
      new Date("2026-10-17T18:00:00Z"),
      "2026-10-17",
      "2026-10-17",
      "Asia/Kuala_Lumpur",
    );
    expect(dates).toEqual({
      fromDate: "2026-10-17",
      toDate: "2026-10-17",
      granularity: "DAY",
    });
    expect(
      siteRangeInstants(dates.fromDate, dates.toDate, "Asia/Kuala_Lumpur"),
    ).toEqual({
      from: "2026-10-16T16:00:00Z",
      toExclusive: "2026-10-17T16:00:00Z",
      toInclusive: "2026-10-17T15:59:59.999Z",
    });
  });
  it("ends week, month and year totals on the last selected local day", () => {
    const now = new Date("2026-10-17T18:00:00Z");
    expect(rangeDates("week", now, "", "", "Asia/Kuala_Lumpur").toDate).toBe(
      "2026-10-18",
    );
    expect(rangeDates("month", now, "", "", "Asia/Kuala_Lumpur").toDate).toBe(
      "2026-10-31",
    );
    expect(rangeDates("year", now, "", "", "Asia/Kuala_Lumpur").toDate).toBe(
      "2026-12-31",
    );
  });
  it("excludes a quality event at next-day midnight from the inclusive through-day filter", () => {
    const bounds = siteRangeInstants(
      "2026-10-17",
      "2026-10-17",
      "Asia/Kuala_Lumpur",
    );
    const events = [
      { id: "inside", startedAt: "2026-10-17T15:59:59.999Z" },
      { id: "next-day", startedAt: "2026-10-17T16:00:00.000Z" },
    ];
    expect(
      events
        .filter(
          (event) =>
            Date.parse(event.startedAt) <= Date.parse(bounds.toInclusive),
        )
        .map((event) => event.id),
    ).toEqual(["inside"]);
  });
});

describe("connection presentation", () => {
  it("reports last-data age and NAS independence when reconnecting", () => {
    const banner = staleBanner(
      "2026-10-17T06:15:00Z",
      "2026-10-17T06:10:20Z",
      Date.parse("2026-10-17T06:15:59Z"),
    );
    expect(banner).toContain("last data");
    expect(banner).toContain(
      "(5 min ago). Collection runs on the NAS independently of this app.",
    );
  });
  it("uses the server sample age instead of a skewed PC clock", () => {
    const banner = staleBanner(
      "2026-10-17T06:15:00Z",
      "2026-10-17T06:10:20Z",
      Date.parse("2030-10-17T06:15:59Z"),
      80,
      45,
    );
    expect(banner).toContain("(2 min ago)");
    expect(banner).not.toContain("2102400 min");
  });
  it("greys only Overview for a stale sample while the backend remains connected", () => {
    const connected = { kind: "CONNECTED", role: "ADMIN" } as const;
    const stale = { freshness: "STALE", ageSeconds: 45 };
    expect(dashboardStaleness("Overview", connected, stale)).toEqual({
      greyed: true,
      overviewStale: true,
      lastKnown: false,
    });
    for (const tab of ["History", "Usage & Cost", "Data Quality"]) {
      expect(dashboardStaleness(tab, connected, stale).greyed).toBe(false);
    }
  });
  it("greys every data tab and marks status last known while reconnecting", () => {
    const reconnecting = {
      kind: "RECONNECTING",
      since: "2026-10-17T06:15:00Z",
      nextRetryAt: "2026-10-17T06:15:05Z",
    } as const;
    for (const tab of ["Overview", "History", "Usage & Cost", "Data Quality"]) {
      expect(
        dashboardStaleness(tab, reconnecting, {
          freshness: "LIVE",
          ageSeconds: 17,
        }),
      ).toEqual({
        greyed: true,
        overviewStale: true,
        lastKnown: true,
      });
    }
  });
  it("hides mutations for VIEWER or unverified role", () => {
    expect(isAdmin("ADMIN")).toBe(true);
    expect(isAdmin("VIEWER")).toBe(false);
    expect(isAdmin("UNKNOWN")).toBe(false);
  });
});
