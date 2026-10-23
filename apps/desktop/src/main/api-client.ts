import { randomUUID } from "node:crypto";
import { session, type Session } from "electron";
import { print } from "graphql";
import { OPERATIONS, type OperationName } from "@solar/contracts/operations";
import type {
  ConnectionState,
  QueryError,
  QueryResult,
} from "@solar/contracts/bridge";
import {
  classifyError,
  certificateFingerprint,
  parseBackendUrl,
} from "./policy.js";
import {
  onConnectionFailure,
  onConnectionSuccess,
  type ConnectionSnapshot,
} from "./connection-state.js";
import { SettingsStore, type BackendSettings } from "./settings-store.js";

const operationText = Object.fromEntries(
  Object.entries(OPERATIONS).map(([name, document]) => [name, print(document)]),
) as Record<OperationName, string>;

export class ApiClient {
  private ses: Session | null = null;
  private snapshot: ConnectionSnapshot = {
    state: { kind: "NOT_CONFIGURED" },
    failures: 0,
  };
  private timer: NodeJS.Timeout | undefined;
  private generation = 0;
  private settingsRevision = 0;
  private settingsQueue: Promise<void> = Promise.resolve();
  private presentedFingerprint: string | undefined;
  private settings: BackendSettings | null = null;
  private token: string | null = null;
  private role: "ADMIN" | "VIEWER" | "UNKNOWN" = "UNKNOWN";
  private roleRetryInFlight = false;

  constructor(
    private readonly store: SettingsStore,
    private readonly broadcast: (state: ConnectionState) => void,
  ) {}

  get state(): ConnectionState {
    return this.snapshot.state;
  }

  private serializeSettings<T>(work: () => Promise<T>): Promise<T> {
    const result = this.settingsQueue.then(work);
    this.settingsQueue = result.then(
      () => {},
      () => {},
    );
    return result;
  }
  private publish(snapshot: ConnectionSnapshot): void {
    this.generation++;
    this.snapshot = snapshot;
    this.broadcast(snapshot.state);
    clearTimeout(this.timer);
    if (snapshot.state.kind === "RECONNECTING") {
      const wait = new Date(snapshot.state.nextRetryAt).getTime() - Date.now();
      this.timer = setTimeout(
        () => {
          void this.checkConnection();
        },
        Math.max(0, wait),
      );
    }
  }

  private async configure(settings: BackendSettings): Promise<void> {
    await this.reset();
    // Chromium caches certificate verdicts independently of the verification callback.
    // A new trust configuration needs a new cache, not a reused partition or socket.
    const next = session.fromPartition(`backend-${randomUUID()}`, {
      cache: false,
    });
    const host = new URL(settings.backendUrl).hostname.replace(/^\[|\]$/g, "");
    next.setCertificateVerifyProc((request, callback) => {
      if (this.ses !== next || request.hostname !== host) {
        callback(-2);
        return;
      }
      const actual = certificateFingerprint(request.certificate);
      this.presentedFingerprint =
        actual !== settings.pinnedFingerprint
          ? (actual ?? undefined)
          : undefined;
      callback(actual === settings.pinnedFingerprint ? 0 : -2);
    });
    this.settings = settings;
    this.ses = next;
  }

  async initialize(): Promise<void> {
    const settings = await this.store.getSettings();
    const token = settings ? await this.store.getToken(settings) : null;
    if (!settings || !token) {
      await this.reset();
      return;
    }
    await this.configure(settings);
    this.token = token;
    await this.checkConnection();
  }

  private async reset(): Promise<void> {
    const retired = this.ses;
    this.ses = null;
    this.settings = null;
    this.token = null;
    this.role = "UNKNOWN";
    this.presentedFingerprint = undefined;
    this.publish({ state: { kind: "NOT_CONFIGURED" }, failures: 0 });
    // Detach and invalidate before awaiting cancellation; keep the old strict verifier.
    if (retired) await retired.closeAllConnections();
  }

  async clear(): Promise<void> {
    this.settingsRevision++;
    await this.serializeSettings(async () => {
      try {
        await this.store.clear();
      } finally {
        await this.reset();
      }
    });
  }

  async probeCertificate(
    input: string,
  ): Promise<
    { ok: true; fingerprint: string } | { ok: false; message: string }
  > {
    const url = parseBackendUrl(input);
    if (!url)
      return {
        ok: false,
        message:
          "Enter a valid HTTPS backend URL without a path or credentials",
      };
    const probe: Session = session.fromPartition(`probe-${randomUUID()}`);
    let fingerprint: string | null = null;
    probe.setCertificateVerifyProc((request, callback) => {
      if (request.hostname === url.hostname.replace(/^\[|\]$/g, ""))
        fingerprint = certificateFingerprint(request.certificate);
      callback(-2);
    });
    try {
      await probe.fetch(`${url.origin}/graphql`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        signal: AbortSignal.timeout(10_000),
      });
    } catch {
      /* Certificate rejection is expected; the callback supplies the fingerprint. */
    }
    probe.setCertificateVerifyProc(null);
    return fingerprint
      ? { ok: true, fingerprint }
      : { ok: false, message: "Could not obtain the backend TLS certificate" };
  }

  async pinCertificate(
    input: string,
    fingerprint: string,
  ): Promise<{ ok: boolean; message?: string }> {
    this.settingsRevision++;
    const revision = this.settingsRevision;
    return this.serializeSettings(async () => {
      const url = parseBackendUrl(input);
      if (!url || !/^sha256\/[A-Za-z0-9+/]{43}=$/.test(fingerprint))
        return { ok: false, message: "Invalid URL or fingerprint" };
      const observed = await this.probeCertificate(input);
      if (revision !== this.settingsRevision)
        return {
          ok: false,
          message: "Settings changed during certificate verification",
        };
      if (!observed.ok || observed.fingerprint !== fingerprint)
        return {
          ok: false,
          message: "Presented certificate changed; probe and compare it again",
        };
      try {
        await this.store.pinCertificate(url.origin, fingerprint);
      } catch {
        await this.reset();
        return {
          ok: false,
          message: "Could not safely replace the pinned backend",
        };
      }
      await this.configure({
        backendUrl: url.origin,
        pinnedFingerprint: fingerprint,
      });
      return { ok: true };
    });
  }

  async saveToken(token: string): Promise<{ ok: boolean; message?: string }> {
    const revision = this.settingsRevision;
    return this.serializeSettings(async () => {
      const settings = this.settings;
      if (!settings || revision !== this.settingsRevision)
        return { ok: false, message: "Pin the backend certificate first" };
      const persisted = await this.store.getSettings();
      if (
        !persisted ||
        persisted.backendUrl !== settings.backendUrl ||
        persisted.pinnedFingerprint !== settings.pinnedFingerprint
      )
        return { ok: false, message: "Pin the backend certificate first" };
      this.generation++;
      const generation = this.generation;
      const checked = await this.request("CollectorStatus", undefined, token);
      if (revision !== this.settingsRevision)
        return {
          ok: false,
          message: "Backend settings changed; token was not saved",
        };
      if (!checked.ok) {
        this.fail(checked.error, generation);
        return { ok: false, message: checked.error.message };
      }
      try {
        await this.store.saveToken(token, settings);
      } catch {
        return {
          ok: false,
          message: "OS encryption unavailable; token was not saved",
        };
      }
      if (revision !== this.settingsRevision)
        return {
          ok: false,
          message: "Backend settings changed; token was not saved",
        };
      this.token = token;
      this.role = "UNKNOWN"; // a role verified for the previous token never carries over
      // CollectorStatus already succeeded with this token; the role is published once verified.
      this.publish(onConnectionSuccess(this.role));
      const roleGeneration = this.generation;
      await this.resolveRole(token);
      if (revision !== this.settingsRevision)
        return {
          ok: false,
          message: "Backend settings changed; token was not saved",
        };
      if (
        roleGeneration === this.generation &&
        token === this.token &&
        this.role !== "UNKNOWN"
      )
        this.publish(onConnectionSuccess(this.role));
      return { ok: true };
    });
  }

  private async resolveRole(token: string): Promise<void> {
    const generation = this.generation;
    const result = await this.request("ViewerRole", undefined, token);
    // Discard a completion for a retired generation or a replaced token.
    if (generation !== this.generation || token !== this.token) return;
    const value =
      result.ok &&
      result.data &&
      typeof result.data === "object" &&
      "viewerRole" in result.data
        ? result.data.viewerRole
        : null;
    this.role = value === "ADMIN" || value === "VIEWER" ? value : "UNKNOWN";
  }

  private fail(error: QueryError, generation: number): void {
    if (generation !== this.generation) return;
    this.publish(
      onConnectionFailure(
        this.snapshot,
        error,
        Date.now(),
        this.presentedFingerprint,
      ),
    );
  }

  async checkConnection(): Promise<void> {
    if (!this.token) return;
    const generation = this.generation;
    const result = await this.request("CollectorStatus", undefined, this.token);
    if (!result.ok) {
      this.fail(result.error, generation);
      return;
    }
    if (generation !== this.generation) return;
    await this.resolveRole(this.token);
    if (generation === this.generation)
      this.publish(onConnectionSuccess(this.role));
  }

  async query(
    op: OperationName,
    vars?: Record<string, unknown>,
  ): Promise<QueryResult<unknown>> {
    if (!this.token || !this.settings)
      return {
        ok: false,
        error: {
          class: "NOT_CONFIGURED",
          message: "Configure backend and token first",
        },
      };
    if (this.snapshot.state.kind === "RECONNECTING")
      return {
        ok: false,
        error: { class: "NETWORK", message: "Backend reconnect is scheduled" },
      };
    if (this.snapshot.state.kind === "AUTH_FAILED")
      return {
        ok: false,
        error: {
          class: "AUTH",
          message: "Authentication failed; enter a valid token",
        },
      };
    if (this.snapshot.state.kind === "TLS_MISMATCH")
      return {
        ok: false,
        error: {
          class: "TLS",
          message: "Backend certificate changed; compare and pin it again",
        },
      };
    const generation = this.generation;
    const result = await this.request(op, vars, this.token);
    if (result.ok) {
      if (generation === this.generation) {
        if (this.snapshot.state.kind !== "CONNECTED") {
          await this.resolveRole(this.token);
          if (generation === this.generation)
            this.publish(onConnectionSuccess(this.role));
        } else if (this.role === "UNKNOWN" && !this.roleRetryInFlight) {
          // A transient ViewerRole failure left the role unresolved. ADMIN controls stay locked
          // until a later ordinary success verifies the role. The retry never delays this result.
          void this.retryRole(generation, this.token);
        }
      }
    } else if (result.error.class !== "GRAPHQL")
      this.fail(result.error, generation);
    return result;
  }

  /** Detached from `query`: a clear, re-pin or token replacement retires its generation/token. */
  private async retryRole(generation: number, token: string): Promise<void> {
    this.roleRetryInFlight = true;
    try {
      await this.resolveRole(token);
      if (
        generation === this.generation &&
        token === this.token &&
        this.role !== "UNKNOWN"
      )
        this.publish(onConnectionSuccess(this.role));
    } catch {
      /* The role stays unresolved; a later ordinary success retries. */
    } finally {
      this.roleRetryInFlight = false;
    }
  }

  private async request(
    op: OperationName,
    vars: Record<string, unknown> | undefined,
    token: string,
  ): Promise<QueryResult<unknown>> {
    const settings = this.settings;
    const activeSession = this.ses;
    if (!settings || !activeSession)
      return {
        ok: false,
        error: {
          class: "NOT_CONFIGURED",
          message: "Backend certificate not pinned",
        },
      };
    try {
      const response = await activeSession.fetch(
        `${settings.backendUrl}/graphql`,
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            query: operationText[op],
            variables: vars ?? {},
          }),
          signal: AbortSignal.timeout(10_000),
        },
      );
      if (
        response.status === 401 ||
        response.status === 403 ||
        response.status === 429 ||
        response.status >= 500
      )
        return { ok: false, error: classifyError(null, response.status) };
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object")
        return { ok: false, error: classifyError(null, response.status) };
      if (token && JSON.stringify(payload).includes(token))
        return {
          ok: false,
          error: {
            class: "SERVER",
            message: "Backend response contained a protected credential",
          },
        };
      const errors =
        "errors" in payload && Array.isArray(payload.errors)
          ? payload.errors
          : undefined;
      if (errors?.length) {
        if (
          errors.some(
            (e: unknown) =>
              e &&
              typeof e === "object" &&
              "extensions" in e &&
              e.extensions &&
              typeof e.extensions === "object" &&
              "code" in e.extensions &&
              e.extensions.code === "FORBIDDEN",
          )
        )
          return { ok: false, error: classifyError(null, 403) };
        return {
          ok: false,
          error: classifyError(null, response.status, errors),
        };
      }
      if (!("data" in payload))
        return {
          ok: false,
          error: {
            class: "SERVER",
            message: "Backend returned no GraphQL data",
          },
        };
      return { ok: true, data: payload.data };
    } catch (error) {
      return {
        ok: false,
        error:
          this.ses === activeSession && this.presentedFingerprint
            ? {
                class: "TLS",
                message:
                  "Backend TLS certificate does not match the pinned fingerprint",
              }
            : classifyError(error),
      };
    }
  }
}
