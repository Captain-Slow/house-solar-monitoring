// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { QueryResult } from "@solar/contracts/bridge";
import { Settings } from "./Settings";
import {
  installBridge,
  renderWithClient,
  syntheticReading,
  syntheticReadings,
} from "../test-support";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const unavailable: QueryResult<unknown> = {
  ok: false,
  error: { class: "NETWORK", message: "not needed by this test" },
};

function listedReadings(): number[] {
  return screen
    .queryAllByText(/^#\d+ · .* · import /)
    .map((item) => Number(/^#(\d+)/.exec(item.textContent ?? "")?.[1]));
}

function range(count: number, first = 1): number[] {
  return Array.from({ length: count }, (_, index) => first + index);
}

async function loadMore(): Promise<void> {
  await act(async () => {
    fireEvent.click(
      await screen.findByRole("button", { name: "Load more readings" }),
    );
  });
}

describe("Settings meter readings", () => {
  it("shows an omitted export reading as a reasoned dash rather than zero kWh", async () => {
    installBridge((op) =>
      op === "MeterReadings"
        ? {
            ok: true,
            data: {
              meterReadings: {
                edges: [
                  {
                    cursor: btoa("7"),
                    node: {
                      id: 7,
                      readAt: "2026-10-17T10:00:00Z",
                      importKwh: "0",
                      exportKwh: null,
                      source: "UTILITY_METER_MANUAL",
                    },
                  },
                ],
                pageInfo: { hasNextPage: false, endCursor: null },
              },
            },
          }
        : unavailable,
    );
    renderWithClient(<Settings role="VIEWER" onReset={() => {}} />);
    const row = await screen.findByText(/^#7 · .* · import /);
    expect(row.textContent).toContain("import 0 kWh");
    const exported = within(row).getByTitle("Export reading not provided");
    expect(exported.textContent).toBe("—");
    expect(row.textContent).not.toContain("export 0 kWh");
  });
});

describe("Settings meter readings beyond the first page", () => {
  it("preserves a deletion refresh when Load more overlaps the pending first page", async () => {
    const readings = syntheticReadings(120);
    const refresh = Promise.withResolvers<QueryResult<unknown>>();
    let holdingRefresh = false;
    const bridge = installBridge((op, vars) => {
      if (op === "MeterReadings")
        return holdingRefresh && vars?.after == null
          ? refresh.promise
          : readings.query(op, vars);
      if (op === "DeleteMeterReading") {
        const index = readings.rows.findIndex((row) => row.id === vars?.id);
        readings.rows.splice(index, 1);
        holdingRefresh = true;
        return { ok: true, data: { deleteMeterReading: true } };
      }
      return unavailable;
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { client } = renderWithClient(
      <Settings role="ADMIN" onReset={() => {}} />,
    );
    await waitFor(() => expect(listedReadings()).toEqual(range(50)));
    fireEvent.change(screen.getByLabelText("Meter reading ID"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete reading" }));
    await waitFor(() =>
      expect(bridge.callsFor("MeterReadings")).toHaveLength(2),
    );
    const pager = screen.getByRole("button", { name: "Load more readings" });
    const disabledDuringRefresh = (pager as HTMLButtonElement).disabled;
    fireEvent.click(pager);
    await act(async () => {
      holdingRefresh = false;
      refresh.resolve(await readings.query("MeterReadings", { first: 50 }));
      await refresh.promise;
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));

    // A canceled refresh would retain #10 and append #51–100 to the stale first page.
    const expected = readings.rows.map((row) => row.id);
    expect(listedReadings()).toEqual(expected.slice(0, 50));
    expect(disabledDuringRefresh).toBe(true);
    expect(
      bridge.callsFor("MeterReadings").map((call) => call.vars?.after),
    ).toEqual([null, null]);
    await loadMore();
    await waitFor(() =>
      expect(listedReadings()).toEqual(expected.slice(0, 100)),
    );
    await loadMore();
    await waitFor(() => expect(listedReadings()).toEqual(expected));
    expect(new Set(listedReadings()).size).toBe(119);
    expect(
      bridge.callsFor("MeterReadings").map((call) => call.vars?.after),
    ).toEqual([null, null, btoa("51"), btoa("101")]);
    expect(screen.queryByRole("button", { name: "Load more readings" })).toBe(
      null,
    );
  });

  it.each([50, 100])(
    "rebuilds loaded page boundaries after deleting cursor reading #%i",
    async (deletedId) => {
      const readings = syntheticReadings(120);
      const refresh = Promise.withResolvers<QueryResult<unknown>>();
      let holding = false;
      const bridge = installBridge((op, vars) => {
        if (op === "MeterReadings")
          return holding && vars?.after == null
            ? refresh.promise
            : readings.query(op, vars);
        if (op === "DeleteMeterReading") {
          readings.rows.splice(
            readings.rows.findIndex((row) => row.id === vars?.id),
            1,
          );
          holding = true;
          return { ok: true, data: { deleteMeterReading: true } };
        }
        return unavailable;
      });
      vi.spyOn(window, "confirm").mockReturnValue(true);
      renderWithClient(<Settings role="ADMIN" onReset={() => {}} />);
      await waitFor(() => expect(listedReadings()).toEqual(range(50)));
      await loadMore();
      await waitFor(() => expect(listedReadings()).toEqual(range(100)));
      fireEvent.change(screen.getByLabelText("Meter reading ID"), {
        target: { value: String(deletedId) },
      });
      fireEvent.click(screen.getByRole("button", { name: "Delete reading" }));
      await waitFor(() =>
        expect(bridge.callsFor("MeterReadings")).toHaveLength(3),
      );
      const pager = screen.getByRole("button", { name: "Load more readings" });
      expect((pager as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(pager);
      await act(async () => {
        holding = false;
        refresh.resolve(await readings.query("MeterReadings", { first: 50 }));
        await refresh.promise;
      });
      const expected = readings.rows.map((row) => row.id);
      await waitFor(() =>
        expect(listedReadings()).toEqual(expected.slice(0, 100)),
      );
      await loadMore();
      await waitFor(() => expect(listedReadings()).toEqual(expected));
      expect(
        bridge.callsFor("MeterReadings").map((call) => call.vars?.after),
      ).toEqual([
        null,
        btoa("50"),
        null,
        btoa(String(expected[49])),
        btoa("101"),
      ]);
    },
  );

  it("lets mutation invalidation replace an already pending next page", async () => {
    const readings = syntheticReadings(120);
    const oldNext = Promise.withResolvers<QueryResult<unknown>>();
    let holdNext = true;
    const bridge = installBridge((op, vars) => {
      if (op === "MeterReadings")
        return holdNext && vars?.after === btoa("50")
          ? oldNext.promise
          : readings.query(op, vars);
      if (op === "DeleteMeterReading") {
        readings.rows.splice(9, 1);
        return { ok: true, data: { deleteMeterReading: true } };
      }
      return unavailable;
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const { client } = renderWithClient(
      <Settings role="ADMIN" onReset={() => {}} />,
    );
    await waitFor(() => expect(listedReadings()).toEqual(range(50)));
    const stalePage = await readings.query("MeterReadings", {
      first: 50,
      after: btoa("50"),
    });
    await loadMore();
    await screen.findByRole("button", { name: "Loading readings…" });
    fireEvent.change(screen.getByLabelText("Meter reading ID"), {
      target: { value: "10" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Delete reading" }));
    const expected = readings.rows
      .filter((row) => row.id !== 10)
      .map((row) => row.id);
    await waitFor(() =>
      expect(listedReadings()).toEqual(expected.slice(0, 50)),
    );
    await act(async () => {
      holdNext = false;
      oldNext.resolve(stalePage);
      await oldNext.promise;
    });
    await waitFor(() => expect(client.isFetching()).toBe(0));
    expect(listedReadings()).toEqual(expected.slice(0, 50));
    await loadMore();
    await waitFor(() =>
      expect(listedReadings()).toEqual(expected.slice(0, 100)),
    );
    expect(
      bridge.callsFor("MeterReadings").map((call) => call.vars?.after),
    ).toEqual([null, btoa("50"), null, btoa("51")]);
  });

  it("reaches, adds and deletes readings that are not on the first page", async () => {
    const readings = syntheticReadings(120);
    const bridge = installBridge((op, vars) => {
      if (op === "MeterReadings") return readings.query(op, vars);
      if (op === "AddMeterReading") {
        const added = syntheticReading(readings.rows.length + 1);
        readings.rows.push(added);
        return { ok: true, data: { addMeterReading: added } };
      }
      if (op === "DeleteMeterReading") {
        const index = readings.rows.findIndex((row) => row.id === vars?.id);
        if (index >= 0) readings.rows.splice(index, 1);
        return { ok: true, data: { deleteMeterReading: index >= 0 } };
      }
      return unavailable;
    });
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderWithClient(<Settings role="ADMIN" onReset={() => {}} />);

    await waitFor(() => expect(listedReadings()).toEqual(range(50)));
    await loadMore();
    await waitFor(() => expect(listedReadings()).toEqual(range(100)));
    await loadMore();
    await waitFor(() => expect(listedReadings()).toEqual(range(120)));
    expect(
      bridge
        .callsFor("MeterReadings")
        .every((call) => Number(call.vars?.first) <= 100),
    ).toBe(true);
    expect(screen.queryByRole("button", { name: "Load more readings" })).toBe(
      null,
    );

    // Saving a reading refreshes the list; the new reading sits on the last page.
    fireEvent.click(screen.getByRole("button", { name: "Save meter reading" }));
    await waitFor(() => expect(listedReadings()).toEqual(range(121)));

    // The reading is selectable for deletion straight from the list and then deleted.
    const row = screen
      .getAllByText(/^#121 · .* · import /)
      .find((item) => item.tagName === "LI");
    if (!row) throw new Error("reading #121 is not listed");
    fireEvent.click(
      within(row).getByRole("button", { name: /select.*for deletion/i }),
    );
    expect(
      (screen.getByLabelText("Meter reading ID") as HTMLInputElement).value,
    ).toBe("121");
    fireEvent.click(screen.getByRole("button", { name: "Delete reading" }));
    await waitFor(() =>
      expect(bridge.callsFor("DeleteMeterReading").at(-1)?.vars).toEqual({
        id: 121,
      }),
    );
    await waitFor(() => expect(listedReadings()).toEqual(range(120)));
  });
});
