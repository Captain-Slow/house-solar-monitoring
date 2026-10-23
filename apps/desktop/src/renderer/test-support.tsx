import type { ReactElement } from "react";
import { render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type {
  ConnectionState,
  OperationName,
  QueryResult,
  SolarBridge,
} from "@solar/contracts/bridge";

export type BridgeCall = {
  op: OperationName;
  vars: Record<string, unknown> | undefined;
};
export type QueryHandler = (
  op: OperationName,
  vars: Record<string, unknown> | undefined,
) => QueryResult<unknown> | Promise<QueryResult<unknown>>;

export interface FakeBridge {
  calls: BridgeCall[];
  callsFor(op: OperationName): BridgeCall[];
  /** Mirrors the preload script: remember and broadcast the latest connection state. */
  emit(state: ConnectionState): void;
}

/** Installs a synthetic window.solar bridge for renderer tests; no network or Electron is involved. */
export function installBridge(
  handle: QueryHandler,
  settings = {
    backendUrl: "https://synthetic.invalid",
    pinnedFingerprint: "sha256/synthetic",
    hasToken: true,
  },
): FakeBridge {
  const subscribers = new Set<(state: ConnectionState) => void>();
  let current: ConnectionState | undefined;
  const calls: BridgeCall[] = [];
  const bridge: SolarBridge = {
    query: ((op: OperationName, vars?: Record<string, unknown>) => {
      calls.push({ op, vars });
      return Promise.resolve(handle(op, vars));
    }) as SolarBridge["query"],
    settings: {
      get: () => Promise.resolve(settings),
      probeCertificate: () =>
        Promise.resolve({ ok: true, fingerprint: "sha256/synthetic" }),
      pinCertificate: () => Promise.resolve({ ok: true }),
      saveToken: () => Promise.resolve({ ok: true }),
      clear: () => Promise.resolve(),
    },
    onConnectionState(callback) {
      subscribers.add(callback);
      if (current) callback(current);
      return () => {
        subscribers.delete(callback);
      };
    },
  };
  Object.defineProperty(window, "solar", {
    value: bridge,
    configurable: true,
    writable: true,
  });
  return {
    calls,
    callsFor: (op) => calls.filter((call) => call.op === op),
    emit(state) {
      current = state;
      for (const subscriber of subscribers) subscriber(state);
    },
  };
}

export interface SyntheticReading {
  id: number;
  readAt: string;
  importKwh: string;
  exportKwh: string | null;
  source: "UTILITY_METER_MANUAL";
}

export function syntheticReading(id: number): SyntheticReading {
  return {
    id,
    readAt: new Date(Date.UTC(2026, 0, 1) + id * 86_400_000).toISOString(),
    importKwh: String(1000 + id),
    exportKwh: null,
    source: "UTILITY_METER_MANUAL",
  };
}

export interface SyntheticReadings {
  rows: SyntheticReading[];
  /** Mirrors the backend resolver: ascending id order, cursor = base64(last id), first limited to 1..100. */
  query: QueryHandler;
}

export function syntheticReadings(count: number): SyntheticReadings {
  const rows = Array.from({ length: count }, (_, index) =>
    syntheticReading(index + 1),
  );
  return {
    rows,
    query(_op, vars) {
      const first = Number(vars?.first ?? 50);
      if (!Number.isInteger(first) || first < 1 || first > 100)
        return {
          ok: false,
          error: { class: "GRAPHQL", message: "first must be 1..100" },
        };
      const after =
        typeof vars?.after === "string" ? Number(atob(vars.after)) : 0;
      const remaining = rows.filter((row) => row.id > after);
      const page = remaining.slice(0, first);
      const last = page.at(-1);
      return {
        ok: true,
        data: {
          meterReadings: {
            edges: page.map((node) => ({
              cursor: btoa(String(node.id)),
              node,
            })),
            pageInfo: {
              hasNextPage: remaining.length > first,
              endCursor: last ? btoa(String(last.id)) : null,
            },
          },
        },
      };
    },
  };
}

export interface RenderedView {
  client: QueryClient;
  rerender(ui: ReactElement): void;
}

/** Renders under a fresh QueryClient configured like the production client. */
export function renderWithClient(ui: ReactElement): RenderedView {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const wrap = (children: ReactElement): ReactElement => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const view = render(wrap(ui));
  return { client, rerender: (next) => view.rerender(wrap(next)) };
}
