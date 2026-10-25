// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { Settings } from "./Settings";
import { installBridge, renderWithClient } from "../test-support";

afterEach(cleanup);

function renderSettings(role: "ADMIN" | "VIEWER" | "UNKNOWN"): void {
  installBridge(() => ({
    ok: false,
    error: { class: "NETWORK", message: "not needed by this test" },
  }));
  renderWithClient(<Settings role={role} onReset={() => {}} />);
}

async function openTile(tile: RegExp): Promise<void> {
  fireEvent.click(await screen.findByRole("button", { name: tile }));
  await screen.findByRole("dialog");
}

function shown(text: string | RegExp): boolean {
  return screen.queryAllByText(text).length > 0;
}

describe("Settings mutation visibility", () => {
  it("hides every mutating tariff, holiday, rate, reading and exclusion form for VIEWER", async () => {
    renderSettings("VIEWER");
    expect(shown(/VIEWER access/)).toBe(true);
    await openTile(/Tariffs/);
    expect(shown("Tariff holidays & monthly rates")).toBe(true);
    expect(shown("TNB RP4 ToU + NEM template")).toBe(false);
    expect(shown("Create tariff")).toBe(false);
  });
  it.each([
    [/Meter readings/, "Save meter reading"],
    [/Exclusions/, "Delete exclusion"],
  ] as const)("hides %s mutations for VIEWER", async (tile, mutation) => {
    renderSettings("VIEWER");
    await openTile(tile);
    expect(shown(mutation)).toBe(false);
  });
  it("does not unlock mutations for UNKNOWN role", async () => {
    renderSettings("UNKNOWN");
    expect(shown(/Role could not be verified/)).toBe(true);
    await openTile(/Tariffs/);
    expect(shown("Create tariff")).toBe(false);
  });
  it.each([
    [/Tariffs/, "TNB RP4 ToU + NEM template"],
    [/Meter readings/, "Save meter reading"],
    [/Exclusions/, "Delete exclusion"],
  ] as const)(
    "shows the real %s mutations for ADMIN",
    async (tile, mutation) => {
      renderSettings("ADMIN");
      await openTile(tile);
      expect(shown(mutation)).toBe(true);
    },
  );
  it("keeps an unsaved editor draft when its dialog is closed and reopened", async () => {
    renderSettings("ADMIN");
    await openTile(/Meter readings/);
    const editor = (await screen.findByLabelText(
      /^Meter reading JSON/,
    )) as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '{"note":"unsaved draft"}' } });
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    await openTile(/Meter readings/);
    expect(
      (await screen.findByLabelText(
        /^Meter reading JSON/,
      )) as HTMLTextAreaElement,
    ).toHaveProperty("value", '{"note":"unsaved draft"}');
  });
});
