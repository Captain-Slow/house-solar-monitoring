import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { solarQueryKey } from "../api";
import { siteLocalDate } from "../models";
import { Overview } from "./Overview";

const power = { watts: 0, reason: null, status: "OK" };
function overviewMarkup(lastKnown: boolean, withEnergy = false): string {
  const client = new QueryClient();
  client.setQueryData(solarQueryKey("LiveStatus"), {
    liveStatus: {
      serverTime: "2026-10-17T06:15:00Z",
      observedAt: "2026-10-17T06:14:43Z",
      freshness: "LIVE",
      ageSeconds: 17,
      pv: power,
      grid: power,
      battery: power,
      load: power,
      loadVendor: power,
      pvStrings: [],
      gridPhases: [],
      batterySoc: 0,
      batteryState: "Standby",
      operatingMode: null,
      accountingStatus: "UNRECONCILED",
      activeFaults: [],
    },
  });
  if (withEnergy) {
    const today = siteLocalDate(new Date(), "Asia/Kuala_Lumpur");
    const quantity = {
      kwh: "0",
      coverage: "0.0003531947983836499",
      provenance: "MEASURED_INTEGRATED",
      status: "OK",
      flags: [],
    };
    client.setQueryData(
      solarQueryKey("EnergyTotals", {
        fromDate: today,
        toDate: today,
        granularity: "DAY",
      }),
      {
        energyTotals: {
          total: {
            solar: quantity,
            consumption: quantity,
            gridImport: quantity,
            gridExport: quantity,
            batteryCharge: quantity,
            batteryDischarge: quantity,
          },
        },
      },
    );
  }
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Overview
        stale={lastKnown}
        lastKnown={lastKnown}
        siteTimezone="Asia/Kuala_Lumpur"
      />
    </QueryClientProvider>,
  );
}

function noDataMarkup(powerReason: string): string {
  const client = new QueryClient();
  const none = { watts: null, reason: powerReason, status: "UNAVAILABLE" };
  client.setQueryData(solarQueryKey("LiveStatus"), {
    liveStatus: {
      serverTime: "2026-10-17T06:15:00Z",
      observedAt: null,
      freshness: "NO_DATA",
      ageSeconds: null,
      pv: none,
      grid: { ...none, reason: powerReason },
      battery: none,
      load: none,
      loadVendor: none,
      pvStrings: [],
      gridPhases: [],
      batterySoc: null,
      batteryState: null,
      operatingMode: {
        code: 1,
        label: "Self-use",
        observedAt: "2026-10-17T06:00:00Z",
      },
      accountingStatus: "MAPPING_PROVISIONAL",
      activeFaults: ["F1"],
    },
  });
  return renderToStaticMarkup(
    <QueryClientProvider client={client}>
      <Overview stale lastKnown={false} siteTimezone="Asia/Kuala_Lumpur" />
    </QueryClientProvider>,
  );
}

describe("Overview without readings", () => {
  it("replaces the dash tiles with one message but keeps mode, accounting and faults", () => {
    const html = noDataMarkup("NO_READING");
    expect(html).toContain("No readings yet");
    expect(html).not.toContain("flow-edge");
    expect(html).toContain("Self-use");
    expect(html).toContain("MAPPING_PROVISIONAL");
    expect(html).toContain("Faults: F1");
  });
  it("keeps every tile when a power value carries a diagnostic reason", () => {
    const html = noDataMarkup("METER_LINK_DOWN");
    expect(html).not.toContain("No readings yet");
    expect(html).toContain("flow-edge");
    expect(html).toContain('data-reason="METER_LINK_DOWN"');
    expect(html).toContain("MAPPING_PROVISIONAL");
  });
});

describe("Overview last-known status and coverage", () => {
  it("shows last known rather than LIVE and retains the server age when reconnecting", () => {
    const html = overviewMarkup(true);
    expect(html).toContain("last known");
    expect(html).toContain("at last response");
    expect(html).not.toMatch(/LIVE.*server age/);
    expect(html).not.toContain("flow-live");
  });
  it("shows server LIVE freshness while connected", () => {
    const html = overviewMarkup(false);
    expect(html).toMatch(/LIVE.*server age/);
    expect(html).not.toContain("last known");
  });
  it("shows percent coverage while retaining exact Decimal in a tooltip", () => {
    const html = overviewMarkup(false, true);
    expect(html).toContain('data-reason="0.0003531947983836499"');
    expect(html).toContain("Coverage 0.04 %");
    expect(html).not.toContain("Coverage 0.0003531947983836499");
  });
});
