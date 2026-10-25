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
import { App } from "./App";
import {
  installBridge,
  renderWithClient,
  syntheticReading,
  syntheticReadings,
  type FakeBridge,
} from "./test-support";

afterEach(cleanup);

function tariffs(name: string): QueryResult<unknown> {
  return {
    ok: true,
    data: {
      tariffs: [
        {
          id: 1,
          name,
          currency: "MYR",
          timezone: "Asia/Kuala_Lumpur",
          versions: [],
        },
      ],
    },
  };
}

const unavailable: QueryResult<unknown> = {
  ok: false,
  error: { class: "NETWORK", message: "synthetic backend unreachable" },
};

async function openTile(tile: RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: tile }));
}

/** Opens Settings and then the dialog the test needs ("Tariffs" or "Meter readings"). */
async function openSettings(bridge: FakeBridge, tile: RegExp): Promise<void> {
  await screen.findByRole("navigation", { name: "Dashboard tabs" });
  act(() => bridge.emit({ kind: "CONNECTED", role: "VIEWER" }));
  fireEvent.click(screen.getByRole("button", { name: "Settings" }));
  await openTile(tile);
}

function tariffsShown(name: string): number {
  return screen.queryAllByText(new RegExp(name)).length;
}

describe("backend connection boundary", () => {
  it.each(["success", "failure"] as const)(
    "isolates infinite pages when an old backend's pending next page settles with %s",
    async (outcome) => {
      const old = syntheticReadings(120);
      const current = syntheticReadings(60);
      current.rows.splice(
        0,
        60,
        ...Array.from({ length: 60 }, (_, i) => syntheticReading(i + 201)),
      );
      const late = Promise.withResolvers<QueryResult<unknown>>();
      let backend: "A" | "B" = "A";
      const bridge = installBridge((op, vars) => {
        if (op !== "MeterReadings") return unavailable;
        if (backend === "B") return current.query(op, vars);
        return vars?.after === btoa("100") ? late.promise : old.query(op, vars);
      });
      const { client } = renderWithClient(<App />);
      const listed = () =>
        screen
          .queryAllByText(/^#\d+ · .* · import /)
          .map((item) => Number(/^#(\d+)/.exec(item.textContent ?? "")?.[1]));
      await openSettings(bridge, /Meter readings/);
      await waitFor(() =>
        expect(listed()).toEqual(old.rows.slice(0, 50).map((row) => row.id)),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Load more readings" }),
      );
      await waitFor(() =>
        expect(listed()).toEqual(old.rows.slice(0, 100).map((row) => row.id)),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Load more readings" }),
      );
      await screen.findByRole("button", { name: "Loading readings…" });
      expect(bridge.callsFor("MeterReadings")).toHaveLength(3);

      act(() => bridge.emit({ kind: "NOT_CONFIGURED" }));
      backend = "B";
      act(() => bridge.emit({ kind: "CONNECTED", role: "VIEWER" }));
      await openTile(/Meter readings/);
      await waitFor(() =>
        expect(listed()).toEqual(
          current.rows.slice(0, 50).map((row) => row.id),
        ),
      );
      fireEvent.click(
        screen.getByRole("button", { name: "Load more readings" }),
      );
      await waitFor(() =>
        expect(listed()).toEqual(current.rows.map((row) => row.id)),
      );
      await act(async () => {
        late.resolve(
          outcome === "success"
            ? await old.query("MeterReadings", {
                first: 50,
                after: btoa("100"),
              })
            : {
                ok: false,
                error: {
                  class: "NETWORK",
                  message: "forgotten backend page failed",
                },
              },
        );
        await late.promise;
      });
      await waitFor(() => expect(client.isFetching()).toBe(0));
      expect(listed()).toEqual(current.rows.map((row) => row.id));
      expect(screen.queryByText("forgotten backend page failed")).toBe(null);
      expect(screen.queryByRole("button", { name: "Load more readings" })).toBe(
        null,
      );
      expect(
        bridge.callsFor("MeterReadings").map((call) => call.vars?.after),
      ).toEqual([null, btoa("50"), btoa("100"), null, btoa("250")]);
      const readingQueries = client
        .getQueryCache()
        .findAll({ queryKey: ["MeterReadings"] });
      expect(readingQueries).toHaveLength(1);
      expect(readingQueries[0]?.queryKey[2]).toBe(1);
      expect(readingQueries[0]?.state.error).toBe(null);
    },
  );

  it("never shows the forgotten backend's tariffs after the new backend's request fails", async () => {
    let backend: "A" | "B" = "A";
    const bridge = installBridge((op) => {
      if (op !== "Tariffs") return unavailable;
      return backend === "A" ? tariffs("Tariff of backend A") : unavailable;
    });
    renderWithClient(<App />);
    await openSettings(bridge, /Tariffs/);
    await waitFor(() =>
      expect(tariffsShown("Tariff of backend A")).toBeGreaterThan(0),
    );

    // Forget backend A, then connect to backend B whose requests fail.
    act(() => bridge.emit({ kind: "NOT_CONFIGURED" }));
    backend = "B";
    act(() => bridge.emit({ kind: "CONNECTED", role: "VIEWER" }));
    await openTile(/Tariffs/);
    await waitFor(() => expect(bridge.callsFor("Tariffs")).toHaveLength(2));
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(tariffsShown("Tariff of backend A")).toBe(0);
    expect(
      screen.getAllByText("synthetic backend unreachable").length,
    ).toBeGreaterThan(0);
  });

  it("ignores a late response from the forgotten backend once the new backend is active", async () => {
    const late = Promise.withResolvers<QueryResult<unknown>>();
    let backend: "A" | "B" = "A";
    const bridge = installBridge((op) => {
      if (op !== "Tariffs") return unavailable;
      return backend === "A" ? late.promise : tariffs("Tariff of backend B");
    });
    renderWithClient(<App />);
    await openSettings(bridge, /Tariffs/);
    await waitFor(() => expect(bridge.callsFor("Tariffs")).toHaveLength(1));

    act(() => bridge.emit({ kind: "NOT_CONFIGURED" }));
    backend = "B";
    act(() => bridge.emit({ kind: "CONNECTED", role: "VIEWER" }));
    await openTile(/Tariffs/);
    await waitFor(() =>
      expect(tariffsShown("Tariff of backend B")).toBeGreaterThan(0),
    );

    await act(async () => {
      late.resolve(tariffs("Tariff of backend A"));
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(tariffsShown("Tariff of backend A")).toBe(0);
    expect(tariffsShown("Tariff of backend B")).toBeGreaterThan(0);
  });

  it("keeps last-known data while the same backend is merely reconnecting", async () => {
    const bridge = installBridge((op) =>
      op === "Tariffs" ? tariffs("Tariff of backend A") : unavailable,
    );
    renderWithClient(<App />);
    await openSettings(bridge, /Tariffs/);
    await waitFor(() =>
      expect(tariffsShown("Tariff of backend A")).toBeGreaterThan(0),
    );

    act(() =>
      bridge.emit({
        kind: "RECONNECTING",
        since: "2026-10-17T10:00:00Z",
        nextRetryAt: "2026-10-17T10:00:05Z",
      }),
    );
    act(() => bridge.emit({ kind: "CONNECTED", role: "VIEWER" }));

    expect(tariffsShown("Tariff of backend A")).toBeGreaterThan(0);
  });
});
