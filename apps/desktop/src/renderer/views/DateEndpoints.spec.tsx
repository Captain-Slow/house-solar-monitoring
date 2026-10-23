import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { solarQueryKey } from "../api";
import { History } from "./History";
import { DataQuality } from "./DataQuality";
import { Overview } from "./Overview";
import { UsageCost } from "./UsageCost";

afterEach(() => vi.useRealTimers());

function queryVariables(client: QueryClient, operation: string): unknown {
  return client
    .getQueryCache()
    .findAll()
    .find((query) => query.queryKey[0] === operation)?.queryKey[1];
}

describe("GraphQL endpoint date contracts", () => {
  it("sends inclusive site LocalDate to energyTotals but exclusive UTC end to powerSeries", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T18:00:00Z"));
    const client = new QueryClient();
    client.setQueryData(solarQueryKey("Tariffs"), {
      tariffs: [{ id: 1, name: "Not automatically selected" }],
    });
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <History siteTimezone="Asia/Kuala_Lumpur" />
      </QueryClientProvider>,
    );
    expect(queryVariables(client, "EnergyTotals")).toEqual({
      fromDate: "2026-10-18",
      toDate: "2026-10-18",
      granularity: "DAY",
      tariffId: null,
    });
    expect(queryVariables(client, "PowerSeries")).toEqual({
      from: "2026-10-17T16:00:00Z",
      to: "2026-10-18T16:00:00Z",
      metrics: ["PV", "LOAD", "GRID", "BATTERY", "SOC"],
      maxPoints: 1000,
    });
    expect(markup).toContain("Grid window tariff");
    expect(markup).toContain("No window breakdown");
    expect(markup).toContain("Not automatically selected (#1)");
  });
  it("sends inclusive site LocalDate to energyTotals and final millisecond to dataQualityEvents", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T18:00:00Z"));
    const client = new QueryClient();
    renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <DataQuality siteTimezone="Asia/Kuala_Lumpur" />
      </QueryClientProvider>,
    );
    expect(queryVariables(client, "EnergyTotals")).toEqual({
      fromDate: "2026-10-01",
      toDate: "2026-10-18",
      granularity: "DAY",
    });
    expect(queryVariables(client, "DataQualityEvents")).toEqual({
      from: "2026-09-30T16:00:00Z",
      to: "2026-10-18T15:59:59.999Z",
      first: 100,
      after: null,
    });
  });
  it("requests only today's inclusive LocalDate in Overview and the selected month in Usage & Cost", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T18:00:00Z"));
    const overviewClient = new QueryClient();
    renderToStaticMarkup(
      <QueryClientProvider client={overviewClient}>
        <Overview
          stale={false}
          lastKnown={false}
          siteTimezone="Asia/Kuala_Lumpur"
        />
      </QueryClientProvider>,
    );
    expect(queryVariables(overviewClient, "EnergyTotals")).toEqual({
      fromDate: "2026-10-18",
      toDate: "2026-10-18",
      granularity: "DAY",
    });
    const costClient = new QueryClient();
    renderToStaticMarkup(
      <QueryClientProvider client={costClient}>
        <UsageCost siteTimezone="Asia/Kuala_Lumpur" />
      </QueryClientProvider>,
    );
    expect(queryVariables(costClient, "EnergyTotals")).toEqual({
      fromDate: "2026-10-01",
      toDate: "2026-10-31",
      granularity: "DAY",
    });
  });
  it("labels interval deltas separately from pre-monitoring lifetime readings", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-17T18:00:00Z"));
    const client = new QueryClient();
    const quantities = [
      "solar",
      "consumption",
      "gridImport",
      "gridExport",
      "batteryCharge",
      "batteryDischarge",
    ];
    const energy = Object.fromEntries(
      quantities.map((key) => [
        key,
        {
          kwh: "1.000",
          status: "OK",
          flags: [],
        },
      ]),
    );
    client.setQueryData(
      solarQueryKey("EnergyTotals", {
        fromDate: "2026-10-01",
        toDate: "2026-10-18",
        granularity: "DAY",
      }),
      {
        energyTotals: {
          rows: [
            {
              periodStart: "2026-10-18",
              ...energy,
              vendor: {
                intervalDelta: Object.fromEntries(
                  quantities.map((key) => [
                    key,
                    { kwh: "1.000", provenance: "DEVICE_COUNTER" },
                  ]),
                ),
                lifetime: Object.fromEntries(
                  quantities.map((key) => [
                    key,
                    { kwh: "1001.000", provenance: "DEVICE_COUNTER" },
                  ]),
                ),
                vendorToday: Object.fromEntries(
                  quantities.map((key) => [
                    key,
                    { kwh: null, provenance: "VENDOR_SUMMARY" },
                  ]),
                ),
              },
            },
          ],
        },
      },
    );
    const markup = renderToStaticMarkup(
      <QueryClientProvider client={client}>
        <DataQuality siteTimezone="Asia/Kuala_Lumpur" />
      </QueryClientProvider>,
    );
    expect(markup).toContain("Inverter interval delta kWh (unvalidated)");
    expect(markup).toContain(
      "Inverter lifetime kWh (includes pre-monitoring, unvalidated)",
    );
    expect(markup).toContain(">1.000<");
    expect(markup).toContain(">1,001.000<");
  });
});
