import { describe, expect, it } from "vitest";
import {
  onConnectionFailure,
  onConnectionSuccess,
  type ConnectionSnapshot,
} from "./connection-state.js";

const network = { class: "NETWORK" as const, message: "unreachable" };

describe("connection state transitions", () => {
  it("backs off 5, 10, 30, then 60 seconds and caps there", () => {
    let current: ConnectionSnapshot = {
      state: { kind: "NOT_CONFIGURED" },
      failures: 0,
    };
    const start = Date.parse("2026-01-02T03:04:05.000Z");
    for (const [index, delay] of [5, 10, 30, 60, 60].entries()) {
      current = onConnectionFailure(current, network, start + index * 1_000);
      expect(current.state.kind).toBe("RECONNECTING");
      if (current.state.kind === "RECONNECTING") {
        expect(
          Date.parse(current.state.nextRetryAt) - (start + index * 1_000),
        ).toBe(delay * 1_000);
        expect(current.state.since).toBe(new Date(start).toISOString());
      }
    }
  });
  it("resets backoff on success and stops retrying for auth or TLS mismatches", () => {
    const start = 1_700_000_000_000;
    let current = onConnectionFailure(
      { state: { kind: "NOT_CONFIGURED" }, failures: 0 },
      network,
      start,
    );
    current = onConnectionFailure(current, network, start + 5_000);
    current = onConnectionSuccess("ADMIN");
    current = onConnectionFailure(current, network, start + 15_000);
    expect(current.state).toEqual({
      kind: "RECONNECTING",
      since: new Date(start + 15_000).toISOString(),
      nextRetryAt: new Date(start + 20_000).toISOString(),
    });
    expect(
      onConnectionFailure(
        current,
        { class: "AUTH", message: "bad token" },
        start,
      ).state.kind,
    ).toBe("AUTH_FAILED");
    expect(
      onConnectionFailure(
        current,
        { class: "TLS", message: "bad cert" },
        start,
        "sha256/presented",
      ).state,
    ).toEqual({
      kind: "TLS_MISMATCH",
      presentedFingerprint: "sha256/presented",
    });
  });
  it("retries generic TLS errors without falsely claiming a known mismatched fingerprint", () => {
    const current = onConnectionFailure(
      { state: { kind: "CONNECTED", role: "VIEWER" }, failures: 0 },
      { class: "TLS", message: "invalid certificate" },
      1_000,
    );
    expect(current.state.kind).toBe("RECONNECTING");
  });
});
