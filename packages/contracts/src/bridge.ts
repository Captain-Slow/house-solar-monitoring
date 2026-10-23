import type { OperationName } from "./index.js";
export type { OperationName } from "./index.js";

export type ConnectionState =
  | { kind: "NOT_CONFIGURED" }
  | { kind: "CONNECTED"; role: "ADMIN" | "VIEWER" | "UNKNOWN" }
  | { kind: "RECONNECTING"; nextRetryAt: string; since: string }
  | { kind: "AUTH_FAILED" }
  | { kind: "TLS_MISMATCH"; presentedFingerprint: string };

export type QueryError = {
  class:
    | "TLS"
    | "NETWORK"
    | "AUTH"
    | "RATE_LIMITED"
    | "SERVER"
    | "GRAPHQL"
    | "NOT_CONFIGURED";
  message: string;
};
export type QueryResult<T> =
  { ok: true; data: T } | { ok: false; error: QueryError };

export interface SolarBridge {
  query<T = unknown>(
    op: OperationName,
    vars?: Record<string, unknown>,
  ): Promise<QueryResult<T>>;
  settings: {
    get(): Promise<{
      backendUrl: string | null;
      pinnedFingerprint: string | null;
      hasToken: boolean;
    }>;
    probeCertificate(
      url: string,
    ): Promise<
      { ok: true; fingerprint: string } | { ok: false; message: string }
    >;
    pinCertificate(
      url: string,
      fingerprint: string,
    ): Promise<{ ok: boolean; message?: string }>;
    saveToken(token: string): Promise<{ ok: boolean; message?: string }>;
    clear(): Promise<void>;
  };
  onConnectionState(cb: (s: ConnectionState) => void): () => void;
}

declare global {
  interface Window {
    solar: SolarBridge;
  }
}
