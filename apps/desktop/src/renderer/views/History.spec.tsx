// @vitest-environment jsdom
import { createElement } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import type { QueryResult } from "@solar/contracts/bridge";
import { History } from "./History";
import {
  installBridge,
  renderWithClient,
  type FakeBridge,
} from "../test-support";

// echarts needs a canvas; expose the option each chart receives instead.
vi.mock("../components/Chart", () => ({
  Chart: ({ option, label }: { option: unknown; label: string }) =>
    createElement("div", {
      role: "img",
      "aria-label": label,
      "data-option": JSON.stringify(option),
    }),
}));

afterEach(cleanup);

type Stat = number | null;
type Point = { t: string; avg: Stat; min: Stat; max: Stat };
type PlottedSeries = { name: string; data: Array<[string, Stat]> };
type PlottedChart = { legend: { show: boolean }; series: PlottedSeries[] };

const T = [
  "2026-10-17T00:00:00Z",
  "2026-10-17T00:05:00Z",
  "2026-10-17T00:10:00Z",
  "2026-10-17T00:15:00Z",
];

function power(metric: string, points: Point[]) {
  return {
    metric,
    points: points.map((point) => ({ ...point, coverage: "1" })),
  };
}

function powerSeries(
  bucketSeconds: number,
  soc: Point[],
): QueryResult<unknown> {
  const flat = T.map((t) => ({ t, avg: 100, min: null, max: 120 }));
  return {
    ok: true,
    data: {
      powerSeries: {
        bucketSeconds,
        gaps: [],
        series: [
          power("PV", flat),
          power("LOAD", flat),
          power("GRID", flat),
          power("BATTERY", flat),
          power("SOC", soc),
        ],
      },
    },
  };
}

function renderHistory(response: QueryResult<unknown>): FakeBridge {
  const bridge = installBridge((op) => {
    if (op === "PowerSeries") return response;
    if (op === "Tariffs") return { ok: true, data: { tariffs: [] } };
    return {
      ok: false,
      error: { class: "NETWORK", message: "not needed by this test" },
    };
  });
  renderWithClient(<History siteTimezone="Asia/Kuala_Lumpur" />);
  return bridge;
}

function requestedDays(bridge: FakeBridge): number | undefined {
  const vars = bridge.callsFor("PowerSeries").at(-1)?.vars;
  return (
    vars &&
    (Date.parse(String(vars.to)) - Date.parse(String(vars.from))) / 86_400_000
  );
}

async function plottedSocChart(): Promise<PlottedChart> {
  const chart = await screen.findByRole("img", {
    name: /Battery SOC history/,
  });
  return JSON.parse(chart.getAttribute("data-option") ?? "{}") as PlottedChart;
}

async function plottedSoc(): Promise<PlottedSeries[]> {
  return (await plottedSocChart()).series;
}

function seriesNamed(series: PlottedSeries[], label: RegExp): PlottedSeries[] {
  return series.filter((entry) => label.test(entry.name));
}

describe("History battery SOC chart", () => {
  // 300 s buckets (day) and 900 s buckets (week): the backend returns SOC min/max with avg null.
  it.each([
    ["day", 300, 1],
    ["week", 900, 7],
  ])(
    "plots the SOC minimum and maximum on a %s range when the average is not provided",
    async (range, bucketSeconds, days) => {
      const bridge = renderHistory(
        powerSeries(bucketSeconds, [
          { t: T[0], avg: null, min: 40, max: 44 },
          { t: T[1], avg: null, min: 41, max: 47 },
          { t: T[2], avg: null, min: null, max: null }, // a genuine gap
          { t: T[3], avg: null, min: 52, max: 55 },
        ]),
      );
      fireEvent.change(screen.getByLabelText(/Range/), {
        target: { value: range },
      });
      await waitFor(() => expect(requestedDays(bridge)).toBe(days));
      const chart = await plottedSocChart();
      const series = chart.series;
      // The series names must be visible to the viewer, otherwise extrema could be mistaken for an average.
      expect(chart.legend.show).toBe(true);

      const minimum = seriesNamed(series, /min/i);
      const maximum = seriesNamed(series, /max/i);
      expect(minimum).toHaveLength(1);
      expect(maximum).toHaveLength(1);
      expect(minimum[0].data).toEqual([
        [T[0], 40],
        [T[1], 41],
        [T[2], null],
        [T[3], 52],
      ]);
      expect(maximum[0].data).toEqual([
        [T[0], 44],
        [T[1], 47],
        [T[2], null],
        [T[3], 55],
      ]);
      // Extrema are never presented as an average, and no empty average line is drawn.
      expect(seriesNamed(series, /avg|average/i)).toEqual([]);
      for (const entry of series)
        expect(entry.data.some(([, value]) => value !== null)).toBe(true);
    },
  );

  it("plots the average, labelled as such, when the backend provides it", async () => {
    renderHistory(
      powerSeries(60, [
        { t: T[0], avg: 41, min: 40, max: 42 },
        { t: T[1], avg: 43, min: 42, max: 45 },
        { t: T[2], avg: null, min: null, max: null },
        { t: T[3], avg: 50, min: 49, max: 51 },
      ]),
    );
    const series = await plottedSoc();
    const average = seriesNamed(series, /avg|average/i);
    expect(average).toHaveLength(1);
    expect(average[0].data).toEqual([
      [T[0], 41],
      [T[1], 43],
      [T[2], null],
      [T[3], 50],
    ]);
    // min/max keep their own labelled series and are not mixed into the average.
    expect(seriesNamed(series, /min/i)[0].data.map(([, v]) => v)).toEqual([
      40,
      42,
      null,
      49,
    ]);
    expect(seriesNamed(series, /max/i)[0].data.map(([, v]) => v)).toEqual([
      42,
      45,
      null,
      51,
    ]);
  });

  it("never fabricates SOC values for buckets with no data", async () => {
    renderHistory(
      powerSeries(
        300,
        T.map((t) => ({ t, avg: null, min: null, max: null })),
      ),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("img", { name: /Battery SOC history/ }),
      ).toBeTruthy(),
    );
    const series = await plottedSoc();
    for (const entry of series)
      expect(entry.data.every(([, value]) => value === null)).toBe(true);
  });
});
