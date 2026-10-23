import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { Live } from "../models";
import { EnergyFlow } from "./EnergyFlow";
import { ConnectionNotice, Metric } from "./Display";
import { powerValue } from "../models";

const power = (watts: number | null, reason: string | null = null) => ({
  watts,
  reason,
  status: "OK",
});
const live = {
  pv: power(2000),
  grid: power(-120),
  battery: power(0),
  load: power(null, "METER_LINK_DOWN"),
  freshness: "LIVE",
  ageSeconds: 2,
} as Live;

describe("EnergyFlow", () => {
  it("renders actual signed directions and all three line-width tiers", () => {
    const html = renderToStaticMarkup(<EnergyFlow live={live} stale={false} />);
    expect(html).toContain("flow-strong");
    expect(html).toContain("flow-normal");
    expect(html).toContain("flow-idle");
    expect(html).toContain("flow-live");
    expect(html).toContain("2,000 W");
    expect(html).toContain("METER_LINK_DOWN");
  });
  it("disables flow animation on disconnected or server-stale data", () => {
    expect(
      renderToStaticMarkup(<EnergyFlow live={live} stale />),
    ).not.toContain("flow-live");
    expect(
      renderToStaticMarkup(
        <EnergyFlow live={{ ...live, ageSeconds: 31 }} stale={false} />,
      ),
    ).not.toContain("flow-live");
  });
});

describe("connection and numeric presentation", () => {
  it("renders an accessible backend-unreachable banner with the last-data age", () => {
    const html = renderToStaticMarkup(
      <ConnectionNotice
        state={{
          kind: "RECONNECTING",
          since: "2026-10-17T06:15:00Z",
          nextRetryAt: "2026-10-17T06:15:05Z",
        }}
        lastData="2026-10-17T06:10:00Z"
        now={Date.parse("2026-10-17T06:16:00Z")}
      />,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("6 min ago");
    expect(html).toContain(
      "Collection runs on the NAS independently of this app.",
    );
  });
  it("renders a missing value with reason tooltip and zero without missing reason", () => {
    const missing = renderToStaticMarkup(
      <Metric
        label="Home"
        {...powerValue(power(null, "METER_LINK_DOWN") as Live["pv"])}
      />,
    );
    const zero = renderToStaticMarkup(
      <Metric label="Home" {...powerValue(power(0) as Live["pv"])} />,
    );
    expect(missing).toContain('title="METER_LINK_DOWN"');
    expect(missing).toContain("—");
    expect(zero).toContain("0 W");
    expect(zero).not.toContain('title="METER_LINK_DOWN"');
  });
});
