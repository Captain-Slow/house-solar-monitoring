// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import type { QueryResult } from "@solar/contracts/bridge";
import { useMeterReadings, type MeterReadingsPages } from "./api";
import { MeterReadingsPager } from "./components/Display";
import {
  installBridge,
  renderWithClient,
  syntheticReadings,
} from "./test-support";

afterEach(cleanup);

function Readings({ capture }: { capture(pages: MeterReadingsPages): void }) {
  const pages = useMeterReadings();
  capture(pages);
  return (
    <>
      <output aria-label="Loaded reading IDs">
        {pages.readings.map((row) => row.id).join(",")}
      </output>
      <MeterReadingsPager pages={pages} />
    </>
  );
}

function shownIds(): number[] {
  const text = screen.getByLabelText("Loaded reading IDs").textContent;
  return text ? text.split(",").map(Number) : [];
}

function range(count: number): number[] {
  return Array.from({ length: count }, (_, i) => i + 1);
}

describe("meter reading page callbacks", () => {
  it("does not let a cached idle callback cancel a refresh before React rerenders", async () => {
    const readings = syntheticReadings(120);
    const refresh = Promise.withResolvers<QueryResult<unknown>>();
    let holding = false;
    const bridge = installBridge((op, vars) =>
      holding && vars?.after == null
        ? refresh.promise
        : readings.query(op, vars),
    );
    let latest!: MeterReadingsPages;
    const { client } = renderWithClient(
      <Readings
        capture={(pages) => {
          latest = pages;
        }}
      />,
    );
    await waitFor(() => expect(shownIds()).toEqual(range(50)));
    const cachedLoadMore = latest.loadMore;
    readings.rows.splice(9, 1);
    holding = true;
    let invalidation!: Promise<void>;
    act(() => {
      invalidation = client.invalidateQueries({ queryKey: ["MeterReadings"] });
      // This callback still sees the idle render, so only cancelRefetch:false protects the refresh.
      cachedLoadMore();
    });
    expect(
      bridge.callsFor("MeterReadings").map((call) => call.vars?.after),
    ).toEqual([null, null]);
    await waitFor(() => expect(latest.fetching).toBe(true));
    expect(latest.loadingMore).toBe(false);
    expect(
      (
        screen.getByRole("button", {
          name: "Load more readings",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    // The current callback must also refuse to start a page during the refresh.
    act(() => latest.loadMore());
    await act(async () => {
      holding = false;
      refresh.resolve(await readings.query("MeterReadings", { first: 50 }));
      await invalidation;
    });
    const expected = readings.rows.map((row) => row.id);
    await waitFor(() => expect(shownIds()).toEqual(expected.slice(0, 50)));
    fireEvent.click(screen.getByRole("button", { name: "Load more readings" }));
    await waitFor(() => expect(shownIds()).toEqual(expected.slice(0, 100)));
    expect(
      bridge.callsFor("MeterReadings").map((call) => call.vars?.after),
    ).toEqual([null, null, btoa("51")]);
    expect(new Set(shownIds()).size).toBe(100);
  });

  it("labels only a pending next page as Loading readings and ignores repeated callbacks", async () => {
    const readings = syntheticReadings(120);
    const next = Promise.withResolvers<QueryResult<unknown>>();
    const bridge = installBridge((op, vars) =>
      vars?.after === btoa("50") ? next.promise : readings.query(op, vars),
    );
    let latest!: MeterReadingsPages;
    renderWithClient(
      <Readings
        capture={(pages) => {
          latest = pages;
        }}
      />,
    );
    await waitFor(() => expect(shownIds()).toEqual(range(50)));
    const cachedLoadMore = latest.loadMore;
    act(() => {
      cachedLoadMore();
      cachedLoadMore();
    });
    const pager = await screen.findByRole("button", {
      name: "Loading readings…",
    });
    expect((pager as HTMLButtonElement).disabled).toBe(true);
    act(() => latest.loadMore());
    expect(bridge.callsFor("MeterReadings")).toHaveLength(2);
    await act(async () => {
      next.resolve(
        await readings.query("MeterReadings", { first: 50, after: btoa("50") }),
      );
      await next.promise;
    });
    await waitFor(() => expect(shownIds()).toEqual(range(100)));
  });

  it.each([0, 50, 100, 120])(
    "stops at the real terminal page for %i readings",
    async (count) => {
      const readings = syntheticReadings(count);
      const bridge = installBridge(readings.query);
      let latest!: MeterReadingsPages;
      renderWithClient(
        <Readings
          capture={(pages) => {
            latest = pages;
          }}
        />,
      );
      await waitFor(() => expect(latest.loaded).toBe(true));
      for (let loaded = 50; loaded < count; loaded += 50) {
        await waitFor(() => expect(shownIds()).toEqual(range(loaded)));
        fireEvent.click(
          screen.getByRole("button", { name: "Load more readings" }),
        );
      }
      await waitFor(() => expect(shownIds()).toEqual(range(count)));
      expect(screen.queryByRole("button", { name: "Load more readings" })).toBe(
        null,
      );
      const cursors = [
        null,
        ...range(Math.ceil(count / 50) - 1).map((page) =>
          btoa(String(page * 50)),
        ),
      ];
      expect(
        bridge.callsFor("MeterReadings").map((call) => call.vars?.after),
      ).toEqual(cursors);
      const issued = bridge.callsFor("MeterReadings").length;
      act(() => latest.loadMore());
      expect(bridge.callsFor("MeterReadings")).toHaveLength(issued);
      expect(shownIds()).toEqual(range(count));
    },
  );
});
