import type { ConnectionState, QueryError } from "@solar/contracts/bridge";

const delays = [5_000, 10_000, 30_000, 60_000] as const;

export interface ConnectionSnapshot {
  state: ConnectionState;
  failures: number;
}

export function onConnectionSuccess(
  role: "ADMIN" | "VIEWER" | "UNKNOWN",
): ConnectionSnapshot {
  return { state: { kind: "CONNECTED", role }, failures: 0 };
}

export function onConnectionFailure(
  previous: ConnectionSnapshot,
  error: QueryError,
  now: number,
  presentedFingerprint?: string,
): ConnectionSnapshot {
  if (error.class === "AUTH")
    return { state: { kind: "AUTH_FAILED" }, failures: 0 };
  if (error.class === "TLS" && presentedFingerprint) {
    return {
      state: { kind: "TLS_MISMATCH", presentedFingerprint },
      failures: 0,
    };
  }
  const failures = previous.failures + 1;
  const since =
    previous.state.kind === "RECONNECTING"
      ? previous.state.since
      : new Date(now).toISOString();
  return {
    state: {
      kind: "RECONNECTING",
      since,
      nextRetryAt: new Date(
        now + delays[Math.min(failures - 1, delays.length - 1)],
      ).toISOString(),
    },
    failures,
  };
}
