// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from "@testing-library/react";
import type { QueryResult } from "@solar/contracts/bridge";
import { DataQuality } from "./DataQuality";
import {
  installBridge,
  renderWithClient,
  syntheticReading,
  syntheticReadings,
  type FakeBridge,
  type QueryHandler,
} from "../test-support";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T06:00:00Z"));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const unavailable: QueryResult<unknown> = {
  ok: false,
  error: { class: "NETWORK", message: "not needed by this test" },
};

function optionIds(select: HTMLElement): number[] {
  return [...select.querySelectorAll("option")]
    .map((option) => /#(\d+)$/.exec(option.textContent ?? "")?.[1])
    .filter((id): id is string => id !== undefined)
    .map(Number);
}

describe("DataQuality meter reading selection", () => {
  async function loadMore(): Promise<void> {
    await act(async () => {
      fireEvent.click(
        await screen.findByRole("button", { name: "Load more readings" }),
      );
    });
  }

  it("lets every reading beyond the first page be found and selected for reconciliation", async () => {
    const readings = syntheticReadings(120);
    const bridge = installBridge((op, vars) =>
      op === "MeterReadings" ? readings.query(op, vars) : unavailable,
    );
    const { client } = renderWithClient(
      <DataQuality siteTimezone="Asia/Kuala_Lumpur" />,
    );
    const from = await screen.findByLabelText("From reading");
    const to = await screen.findByLabelText("To reading");
    await waitFor(() => expect(optionIds(from)).toHaveLength(50));
    expect(optionIds(to)).not.toContain(120);

    await loadMore();
    await waitFor(() => expect(optionIds(from)).toHaveLength(100));
    await loadMore();
    await waitFor(() => expect(optionIds(from)).toHaveLength(120));
    expect(optionIds(from)).toEqual(
      Array.from({ length: 120 }, (_, index) => index + 1),
    );
    // Every page was reached by following the backend cursor, never by asking for more than the API allows.
    const pages = bridge.callsFor("MeterReadings");
    expect(pages.every((call) => Number(call.vars?.first) <= 100)).toBe(true);
    expect(pages.map((call) => call.vars?.after ?? null)).toEqual([
      null,
      btoa("50"),
      btoa("100"),
    ]);
    expect(screen.queryByRole("button", { name: "Load more readings" })).toBe(
      null,
    );

    // A reading added after the first page was loaded is reachable too.
    readings.rows.push(syntheticReading(121));
    await act(() => client.invalidateQueries());
    await waitFor(() => expect(optionIds(to)).toContain(121));

    fireEvent.change(from, { target: { value: "5" } });
    fireEvent.change(to, { target: { value: "121" } });
    await waitFor(() =>
      expect(bridge.callsFor("Reconciliation").at(-1)?.vars).toEqual({
        fromReadingId: 5,
        toReadingId: 121,
      }),
    );
  });

  it("offers another page when a reading is added after the last full page was loaded", async () => {
    const readings = syntheticReadings(100);
    installBridge((op, vars) =>
      op === "MeterReadings" ? readings.query(op, vars) : unavailable,
    );
    const { client } = renderWithClient(
      <DataQuality siteTimezone="Asia/Kuala_Lumpur" />,
    );
    const to = await screen.findByLabelText("To reading");
    await loadMore();
    await waitFor(() => expect(optionIds(to)).toHaveLength(100));
    expect(screen.queryByRole("button", { name: "Load more readings" })).toBe(
      null,
    );

    readings.rows.push(syntheticReading(101));
    await act(() => client.invalidateQueries());
    await loadMore();
    await waitFor(() => expect(optionIds(to)).toContain(101));
  });

  it("preserves loaded readings after a failed page and retries the same cursor successfully", async () => {
    const readings = syntheticReadings(120);
    let failing = false;
    const bridge = installBridge((op, vars) => {
      if (op !== "MeterReadings") return unavailable;
      return failing
        ? {
            ok: false,
            error: { class: "NETWORK", message: "page load failed" },
          }
        : readings.query(op, vars);
    });
    renderWithClient(<DataQuality siteTimezone="Asia/Kuala_Lumpur" />);
    const from = await screen.findByLabelText("From reading");
    await waitFor(() => expect(optionIds(from)).toHaveLength(50));
    failing = true;
    await loadMore();
    await screen.findByText("page load failed");
    expect(optionIds(from)).toEqual(
      Array.from({ length: 50 }, (_, i) => i + 1),
    );
    expect(
      (
        screen.getByRole("button", {
          name: "Load more readings",
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    failing = false;
    await loadMore();
    await waitFor(() =>
      expect(optionIds(from)).toEqual(
        Array.from({ length: 100 }, (_, i) => i + 1),
      ),
    );
    expect(screen.queryByText("page load failed")).toBe(null);
    expect(
      bridge.callsFor("MeterReadings").map((call) => call.vars?.after),
    ).toEqual([null, btoa("50"), btoa("50")]);
    await loadMore();
    await waitFor(() =>
      expect(optionIds(from)).toEqual(
        Array.from({ length: 120 }, (_, i) => i + 1),
      ),
    );
    expect(screen.queryByRole("button", { name: "Load more readings" })).toBe(
      null,
    );
  });
});

type SyntheticEvent = {
  id: string;
  kind: string;
  startedAt: string;
  endedAt: string;
  createdAt: string;
  deviceId: number;
};

function syntheticEvent(id: number, startedAt: string): SyntheticEvent {
  return {
    id: String(id),
    kind: `SYNTH_EVT_${id}`,
    startedAt,
    endedAt: startedAt,
    createdAt: startedAt,
    deviceId: 1,
  };
}

/** Mirrors the backend: startedAt within [from, to], id > cursor, ascending id, hasNextPage via limit + 1. */
function eventsBackend(rows: SyntheticEvent[]): QueryHandler {
  return (op, vars) => {
    if (op !== "DataQualityEvents") return unavailable;
    const from = Date.parse(String(vars?.from));
    const to = Date.parse(String(vars?.to));
    const after =
      typeof vars?.after === "string" ? Number(atob(vars.after)) : 0;
    const limit = Number(vars?.first);
    const matching = rows.filter(
      (row) =>
        Date.parse(row.startedAt) >= from &&
        Date.parse(row.startedAt) <= to &&
        Number(row.id) > after,
    );
    const page = matching.slice(0, limit);
    const last = page.at(-1);
    return {
      ok: true,
      data: {
        dataQualityEvents: {
          edges: page.map((node) => ({
            cursor: btoa(node.id),
            node,
          })),
          pageInfo: {
            hasNextPage: matching.length > limit,
            endCursor: last ? btoa(last.id) : null,
          },
        },
      },
    };
  };
}

function listedEvents(): number[] {
  return screen
    .queryAllByText(/^SYNTH_EVT_\d+ ·/)
    .map((item) => Number(/SYNTH_EVT_(\d+)/.exec(item.textContent ?? "")?.[1]));
}

function range(count: number, first: number): number[] {
  return Array.from({ length: count }, (_, index) => first + index);
}

describe("DataQuality event pagination", () => {
  // ids 1-3 are early September events; ids 4-123 are October events (more than one 100-event page).
  const rows = [
    ...[1, 2, 3].map((id) => syntheticEvent(id, `2026-09-1${id}T02:00:00Z`)),
    ...range(120, 4).map((id) =>
      syntheticEvent(id, new Date(Date.UTC(2026, 9, 5, 2, id)).toISOString()),
    ),
  ];

  async function pageToSecondPage(bridge: FakeBridge): Promise<void> {
    await waitFor(() => expect(listedEvents()).toEqual(range(100, 4)));
    fireEvent.click(screen.getByRole("button", { name: "More events" }));
    await waitFor(() => expect(listedEvents()).toEqual(range(20, 104)));
    expect(bridge.callsFor("DataQualityEvents").at(-1)?.vars?.after).toBe(
      btoa("103"),
    );
  }

  function eventRequestsAfter(
    bridge: FakeBridge,
    already: number,
  ): Array<Record<string, unknown> | undefined> {
    return bridge
      .callsFor("DataQualityEvents")
      .slice(already)
      .map((call) => call.vars);
  }

  it("returns to the first page of an earlier range, including when the old cursor would give an empty page", async () => {
    const bridge = installBridge(eventsBackend(rows));
    renderWithClient(<DataQuality siteTimezone="Asia/Kuala_Lumpur" />);
    await pageToSecondPage(bridge);
    const issued = bridge.callsFor("DataQualityEvents").length;

    fireEvent.change(screen.getByLabelText("From local day"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(screen.getByLabelText("Through local day"), {
      target: { value: "2026-09-30" },
    });

    // Only events 1-3 fall in September; a retained id > 103 cursor would show nothing.
    await waitFor(() => expect(listedEvents()).toEqual([1, 2, 3]));
    expect(
      eventRequestsAfter(bridge, issued).every((vars) => vars?.after == null),
    ).toBe(true);
  });

  it("restarts at the first page when only the start date moves earlier", async () => {
    const bridge = installBridge(eventsBackend(rows));
    renderWithClient(<DataQuality siteTimezone="Asia/Kuala_Lumpur" />);
    await pageToSecondPage(bridge);
    const issued = bridge.callsFor("DataQualityEvents").length;

    fireEvent.change(screen.getByLabelText("From local day"), {
      target: { value: "2026-09-01" },
    });

    // First 100 events of September 1 – October 17 include the early events hidden by the old cursor.
    await waitFor(() => expect(listedEvents()).toEqual(range(100, 1)));
    expect(
      eventRequestsAfter(bridge, issued).every((vars) => vars?.after == null),
    ).toBe(true);
  });

  it("restarts at the first page when only the end date changes", async () => {
    const bridge = installBridge(eventsBackend(rows));
    renderWithClient(<DataQuality siteTimezone="Asia/Kuala_Lumpur" />);
    await pageToSecondPage(bridge);
    const issued = bridge.callsFor("DataQualityEvents").length;

    fireEvent.change(screen.getByLabelText("Through local day"), {
      target: { value: "2026-10-16" },
    });

    await waitFor(() => expect(listedEvents()).toEqual(range(100, 4)));
    expect(
      eventRequestsAfter(bridge, issued).every((vars) => vars?.after == null),
    ).toBe(true);
  });

  it("restarts at the first page when the site timezone changes the instant range", async () => {
    const bridge = installBridge(eventsBackend(rows));
    const view = renderWithClient(
      <DataQuality siteTimezone="Asia/Kuala_Lumpur" />,
    );
    await pageToSecondPage(bridge);
    const issued = bridge.callsFor("DataQualityEvents").length;
    const before = bridge.callsFor("DataQualityEvents").at(-1)?.vars;

    // Same local dates (UTC+8 vs UTC+7 on 2026-10-17), different UTC instants.
    view.rerender(<DataQuality siteTimezone="Asia/Jakarta" />);

    await waitFor(() => expect(listedEvents()).toEqual(range(100, 4)));
    const requests = eventRequestsAfter(bridge, issued);
    expect(requests[0]?.from).not.toBe(before?.from);
    expect(requests.every((vars) => vars?.after == null)).toBe(true);
  });
});
