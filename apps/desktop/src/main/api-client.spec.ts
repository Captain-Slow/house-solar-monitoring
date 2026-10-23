import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClient } from "./api-client.js";
import { SettingsStore } from "./settings-store.js";

const electron = vi.hoisted(() => ({
  fetch: vi.fn(),
  verify: vi.fn(),
  close: vi.fn().mockResolvedValue(undefined),
  partition: vi.fn(),
}));

vi.mock("electron", () => ({
  session: {
    fromPartition: (...args: unknown[]) =>
      electron.partition(...args) ?? {
        fetch: electron.fetch,
        setCertificateVerifyProc: electron.verify,
        closeAllConnections: electron.close,
      },
  },
  app: { getPath: () => "unused" },
  safeStorage: { isEncryptionAvailable: () => true },
}));

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  electron.fetch.mockReset();
  electron.verify.mockReset();
  electron.close.mockReset().mockResolvedValue(undefined);
  electron.partition.mockReset();
});

describe("ApiClient reconnect scheduling", () => {
  it("coalesces concurrent failures into one retry, advances on retry failure, and resets after success", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-02T03:04:05.000Z"));
    const store = new SettingsStore();
    vi.spyOn(store, "getSettings").mockResolvedValue({
      backendUrl: "https://solar.local",
      pinnedFingerprint: `sha256/${Buffer.alloc(32).toString("base64")}`,
    });
    vi.spyOn(store, "getToken").mockResolvedValue("test-token-not-real");
    const states: string[] = [];
    const client = new ApiClient(store, (state) => {
      states.push(state.kind);
    });
    let stage: "initial" | "batch" | "retry-fail" | "recovered" = "initial";
    const pending: Array<(reason: Error) => void> = [];
    electron.fetch.mockImplementation((_url: string, options: RequestInit) => {
      if (stage === "batch")
        return new Promise<Response>((_resolve, reject) => {
          pending.push(reject);
        });
      if (stage === "retry-fail")
        return Promise.reject(new Error("net::ERR_CONNECTION_REFUSED"));
      const isRole =
        typeof options.body === "string" && options.body.includes("viewerRole");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            data: isRole
              ? { viewerRole: "ADMIN" }
              : { collectorStatus: { state: "RUNNING" } },
          }),
          { status: 200 },
        ),
      );
    });
    await client.initialize();
    expect(client.state).toEqual({ kind: "CONNECTED", role: "ADMIN" });

    stage = "batch";
    const first = client.query("LiveStatus");
    const second = client.query("CollectorStatus");
    const third = client.query("LiveStatus");
    expect(pending).toHaveLength(3);
    for (const reject of pending.splice(0))
      reject(new Error("net::ERR_CONNECTION_REFUSED"));
    await Promise.all([first, second, third]);
    expect(client.state).toEqual({
      kind: "RECONNECTING",
      since: "2026-01-02T03:04:05.000Z",
      nextRetryAt: "2026-01-02T03:04:10.000Z",
    });
    expect(states.filter((kind) => kind === "RECONNECTING")).toHaveLength(1);

    stage = "retry-fail";
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.state).toEqual({
      kind: "RECONNECTING",
      since: "2026-01-02T03:04:05.000Z",
      nextRetryAt: "2026-01-02T03:04:20.000Z",
    });
    expect(states.filter((kind) => kind === "RECONNECTING")).toHaveLength(2);

    stage = "recovered";
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.state).toEqual({ kind: "CONNECTED", role: "ADMIN" });

    stage = "batch";
    const afterRecovery = client.query("LiveStatus");
    expect(pending).toHaveLength(1);
    pending.shift()?.(new Error("net::ERR_CONNECTION_REFUSED"));
    await afterRecovery;
    expect(client.state).toEqual({
      kind: "RECONNECTING",
      since: "2026-01-02T03:04:20.000Z",
      nextRetryAt: "2026-01-02T03:04:25.000Z",
    });
  });
});

describe("ApiClient credential boundaries", () => {
  it("rejects reflected bearer tokens in both GraphQL errors and data", async () => {
    const token = "fake-token-for-reflection";
    for (const reflection of ["error", "data"] as const) {
      const store = new SettingsStore();
      vi.spyOn(store, "getSettings").mockResolvedValue({
        backendUrl: "https://solar.local",
        pinnedFingerprint: `sha256/${Buffer.alloc(32).toString("base64")}`,
      });
      vi.spyOn(store, "getToken").mockResolvedValue(token);
      vi.spyOn(store, "clear").mockResolvedValue();
      electron.fetch.mockImplementation(
        (_url: string, options: RequestInit) => {
          const body = String(options.body);
          if (body.includes("viewerRole"))
            return Promise.resolve(
              new Response(JSON.stringify({ data: { viewerRole: "ADMIN" } }), {
                status: 200,
              }),
            );
          if (body.includes("liveStatus")) {
            const payload =
              reflection === "error"
                ? { errors: [{ message: `Authorization: Bearer ${token}` }] }
                : { data: { liveStatus: { unexpected: token } } };
            return Promise.resolve(
              new Response(JSON.stringify(payload), { status: 200 }),
            );
          }
          return Promise.resolve(
            new Response(
              JSON.stringify({
                data: { collectorStatus: { state: "RUNNING" } },
              }),
              { status: 200 },
            ),
          );
        },
      );
      const client = new ApiClient(store, vi.fn());
      await client.initialize();
      const result = await client.query("LiveStatus");
      expect(result).toEqual({
        ok: false,
        error: {
          class: "SERVER",
          message: "Backend response contained a protected credential",
        },
      });
      expect(JSON.stringify(result)).not.toContain(token);
      await client.clear();
    }
  });

  it("aborts an in-flight token save before a replacement backend is pinned", async () => {
    const original = {
      backendUrl: "https://solar.local",
      pinnedFingerprint: `sha256/${Buffer.alloc(32, 1).toString("base64")}`,
    };
    const replacement = {
      backendUrl: "https://replacement.local",
      pinnedFingerprint: `sha256/${Buffer.alloc(32, 2).toString("base64")}`,
    };
    let settings = original;
    const store = new SettingsStore();
    vi.spyOn(store, "getSettings").mockImplementation(async () => settings);
    vi.spyOn(store, "getToken").mockResolvedValue("existing-fake-token");
    const save = vi.spyOn(store, "saveToken").mockResolvedValue();
    vi.spyOn(store, "pinCertificate").mockImplementation(async () => {
      settings = replacement;
    });
    let release: ((response: Response) => void) | undefined;
    let delayed = false;
    electron.fetch.mockImplementation((url: string, options: RequestInit) => {
      const body = String(options.body);
      if (delayed && body.includes("collectorStatus"))
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      const data = body.includes("viewerRole")
        ? { viewerRole: "ADMIN" }
        : { collectorStatus: { state: "RUNNING" } };
      return Promise.resolve(
        new Response(JSON.stringify({ data }), { status: 200 }),
      );
    });
    const client = new ApiClient(store, vi.fn());
    await client.initialize();
    vi.spyOn(client, "probeCertificate").mockResolvedValue({
      ok: true,
      fingerprint: replacement.pinnedFingerprint,
    });
    delayed = true;
    const saving = client.saveToken("replacement-test-token");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const pinning = client.pinCertificate(
      replacement.backendUrl,
      replacement.pinnedFingerprint,
    );
    release?.(
      new Response(
        JSON.stringify({ data: { collectorStatus: { state: "RUNNING" } } }),
        { status: 200 },
      ),
    );
    expect(await saving).toEqual({
      ok: false,
      message: "Backend settings changed; token was not saved",
    });
    expect(await pinning).toEqual({ ok: true });
    expect(save).not.toHaveBeenCalled();
    expect(client.state.kind).toBe("NOT_CONFIGURED");
    expect(
      electron.fetch.mock.calls.every(
        ([url]) => url === `${original.backendUrl}/graphql`,
      ),
    ).toBe(true);
  });

  it("recovers from a cached certificate rejection after explicit re-pinning without trusting retired callbacks", async () => {
    const origin = "https://solar.local";
    const fingerprint = (byte: number) =>
      `sha256/${Buffer.alloc(32, byte).toString("base64")}`;
    let serverFingerprint = fingerprint(1);
    let settings = {
      backendUrl: origin,
      pinnedFingerprint: serverFingerprint,
    };
    let networkDown = false;
    type Verify = (
      request: {
        hostname: string;
        certificate: { fingerprint: string; data: string };
      },
      callback: (code: number) => void,
    ) => void;
    let retiredVerification: Verify | undefined;
    const partitions = new Map<string, unknown>();
    electron.partition.mockImplementation((partition: string) => {
      const existing = partitions.get(partition);
      if (existing) return existing;
      let verify: Verify | null = null;
      const verdicts = new Map<string, number>();
      const transport = {
        setCertificateVerifyProc: (proc: Verify | null) => {
          verify = proc;
          retiredVerification ??= proc ?? undefined;
        },
        closeAllConnections: async () => {},
        fetch: async (_url: string, options: RequestInit) => {
          if (networkDown) throw new Error("net::ERR_CONNECTION_REFUSED");
          let verdict = verdicts.get(serverFingerprint);
          if (verdict === undefined) {
            verify?.(
              {
                hostname: "solar.local",
                certificate: { fingerprint: serverFingerprint, data: "" },
              },
              (code) => {
                verdict = code;
              },
            );
            if (verdict === undefined)
              throw new Error("No certificate verdict");
            verdicts.set(serverFingerprint, verdict);
          }
          if (verdict !== 0) throw new Error("net::ERR_FAILED");
          return new Response(
            JSON.stringify({
              data: String(options.body).includes("viewerRole")
                ? { viewerRole: "ADMIN" }
                : { collectorStatus: { state: "DISABLED" } },
            }),
            { status: 200 },
          );
        },
      };
      partitions.set(partition, transport);
      return transport;
    });
    const store = new SettingsStore();
    vi.spyOn(store, "getSettings").mockImplementation(async () => settings);
    vi.spyOn(store, "getToken").mockResolvedValue("synthetic-original-token");
    vi.spyOn(store, "saveToken").mockResolvedValue();
    vi.spyOn(store, "clear").mockResolvedValue();
    vi.spyOn(store, "pinCertificate").mockImplementation(async (url, pin) => {
      settings = { backendUrl: url, pinnedFingerprint: pin };
    });
    const client = new ApiClient(store, vi.fn());
    vi.spyOn(client, "probeCertificate").mockImplementation(async () => ({
      ok: true,
      fingerprint: serverFingerprint,
    }));
    await client.initialize();
    expect(client.state).toEqual({ kind: "CONNECTED", role: "ADMIN" });

    serverFingerprint = fingerprint(2);
    await client.checkConnection();
    expect(client.state).toEqual({
      kind: "TLS_MISMATCH",
      presentedFingerprint: serverFingerprint,
    });
    expect(await client.pinCertificate(origin, serverFingerprint)).toEqual({
      ok: true,
    });
    expect(await client.saveToken("synthetic-replacement-token")).toEqual({
      ok: true,
    });
    expect(client.state).toEqual({ kind: "CONNECTED", role: "ADMIN" });

    // A verification completion from the old trust context must not relabel a
    // later ordinary transport failure as a certificate mismatch.
    const lateRequest = {
      hostname: "solar.local",
      certificate: { fingerprint: fingerprint(3), data: "" },
    };
    retiredVerification?.(lateRequest, () => {});
    networkDown = true;
    expect(await client.query("CollectorStatus")).toMatchObject({
      ok: false,
      error: { class: "NETWORK" },
    });
    expect(client.state.kind).toBe("RECONNECTING");
    networkDown = false;
    await client.checkConnection();
    serverFingerprint = fingerprint(1);
    await client.checkConnection();
    expect(client.state.kind).toBe("TLS_MISMATCH");
    expect(await client.pinCertificate(origin, serverFingerprint)).toEqual({
      ok: true,
    });
    expect(await client.saveToken("synthetic-return-token")).toEqual({
      ok: true,
    });
    expect(client.state).toEqual({ kind: "CONNECTED", role: "ADMIN" });
    // Returning to the same pin must not reactivate the first session's callback.
    retiredVerification?.(lateRequest, () => {});
    networkDown = true;
    expect(await client.query("CollectorStatus")).toMatchObject({
      ok: false,
      error: { class: "NETWORK" },
    });
    await client.clear();
  });

  it("stays unconfigured when retiring a transport fails and permits repeated clearing", async () => {
    const store = new SettingsStore();
    vi.spyOn(store, "getSettings").mockResolvedValue({
      backendUrl: "https://solar.local",
      pinnedFingerprint: `sha256/${Buffer.alloc(32, 1).toString("base64")}`,
    });
    vi.spyOn(store, "getToken").mockResolvedValue("synthetic-token");
    vi.spyOn(store, "clear").mockResolvedValue();
    electron.fetch.mockImplementation(
      async (_url, options: RequestInit) =>
        new Response(
          JSON.stringify({
            data: String(options.body).includes("viewerRole")
              ? { viewerRole: "ADMIN" }
              : { collectorStatus: { state: "DISABLED" } },
          }),
          { status: 200 },
        ),
    );
    const client = new ApiClient(store, vi.fn());
    await client.initialize();
    electron.close.mockRejectedValueOnce(new Error("retirement failed"));
    await expect(client.clear()).rejects.toThrow("retirement failed");
    expect(client.state).toEqual({ kind: "NOT_CONFIGURED" });
    expect(await client.query("CollectorStatus")).toMatchObject({
      ok: false,
      error: { class: "NOT_CONFIGURED" },
    });
    await client.clear();
    expect(client.state).toEqual({ kind: "NOT_CONFIGURED" });
  });

  it("invalidates a pending role response before transport retirement completes", async () => {
    const store = new SettingsStore();
    vi.spyOn(store, "getSettings").mockResolvedValue({
      backendUrl: "https://solar.local",
      pinnedFingerprint: `sha256/${Buffer.alloc(32, 1).toString("base64")}`,
    });
    vi.spyOn(store, "getToken").mockResolvedValue("synthetic-token");
    vi.spyOn(store, "clear").mockResolvedValue();
    let holdRole = false;
    let releaseRole: ((response: Response) => void) | undefined;
    electron.fetch.mockImplementation(async (_url, options: RequestInit) => {
      const role = String(options.body).includes("viewerRole");
      if (role && holdRole)
        return new Promise<Response>((resolve) => {
          releaseRole = resolve;
        });
      return new Response(
        JSON.stringify({
          data: role
            ? { viewerRole: "ADMIN" }
            : { collectorStatus: { state: "DISABLED" } },
        }),
        { status: 200 },
      );
    });
    const client = new ApiClient(store, vi.fn());
    await client.initialize();
    holdRole = true;
    const checking = client.checkConnection();
    await vi.waitFor(() => expect(releaseRole).toBeTypeOf("function"));
    let releaseClose: (() => void) | undefined;
    electron.close.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          releaseClose = resolve;
        }),
    );
    const clearing = client.clear();
    await vi.waitFor(() => expect(releaseClose).toBeTypeOf("function"));
    releaseRole?.(
      new Response(JSON.stringify({ data: { viewerRole: "ADMIN" } }), {
        status: 200,
      }),
    );
    await checking;
    expect(client.state).toEqual({ kind: "NOT_CONFIGURED" });
    expect(await client.query("CollectorStatus")).toMatchObject({
      ok: false,
      error: { class: "NOT_CONFIGURED" },
    });
    releaseClose?.();
    await clearing;
    expect(client.state).toEqual({ kind: "NOT_CONFIGURED" });
  });
});

describe("ApiClient role discovery recovery", () => {
  function storeWithToken(): SettingsStore {
    const store = new SettingsStore();
    vi.spyOn(store, "getSettings").mockResolvedValue({
      backendUrl: "https://solar.local",
      pinnedFingerprint: `sha256/${Buffer.alloc(32, 1).toString("base64")}`,
    });
    vi.spyOn(store, "getToken").mockResolvedValue("synthetic-token");
    vi.spyOn(store, "clear").mockResolvedValue();
    return store;
  }
  const isRole = (options: RequestInit) =>
    String(options.body).includes("viewerRole");
  /** One macrotask turn: a detached role retry has run to completion (or to its hold) afterwards. */
  const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
  const ok = (data: unknown) =>
    new Response(JSON.stringify({ data }), { status: 200 });

  it("keeps ADMIN locked after a ViewerRole-only 503, then recovers on a later ordinary success and stops probing", async () => {
    let roleRequests = 0;
    electron.fetch.mockImplementation(
      async (_url: string, options: RequestInit) => {
        if (!isRole(options))
          return ok({ collectorStatus: { state: "DISABLED" } });
        roleRequests++;
        return roleRequests === 1
          ? new Response("unavailable", { status: 503 })
          : ok({ viewerRole: "ADMIN" });
      },
    );
    const states: unknown[] = [];
    const client = new ApiClient(storeWithToken(), (s) => states.push(s));
    await client.initialize();
    expect(client.state).toEqual({ kind: "CONNECTED", role: "UNKNOWN" });
    expect(roleRequests).toBe(1);

    expect(await client.query("CollectorStatus")).toMatchObject({ ok: true });
    // The retry is detached from the query result; ADMIN appears once it verifies the role.
    await vi.waitFor(() =>
      expect(client.state).toEqual({ kind: "CONNECTED", role: "ADMIN" }),
    );
    expect(roleRequests).toBe(2);

    for (let i = 0; i < 5; i++) await client.query("CollectorStatus");
    expect(roleRequests).toBe(2);
    expect(client.state).toEqual({ kind: "CONNECTED", role: "ADMIN" });
  });

  it("never reports ADMIN when the retried role stays unresolved, and does not issue overlapping retries", async () => {
    let roleRequests = 0;
    let release: ((r: Response) => void) | undefined;
    electron.fetch.mockImplementation(
      async (_url: string, options: RequestInit) => {
        if (!isRole(options))
          return ok({ collectorStatus: { state: "DISABLED" } });
        roleRequests++;
        if (roleRequests === 2)
          return new Promise<Response>((resolve) => {
            release = resolve;
          });
        return new Response("unavailable", { status: 503 });
      },
    );
    const client = new ApiClient(storeWithToken(), vi.fn());
    await client.initialize();
    const first = client.query("CollectorStatus");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await client.query("CollectorStatus"); // overlaps the held retry: must not start another
    expect(roleRequests).toBe(2);
    release?.(new Response("unavailable", { status: 503 }));
    await first;
    await settle();
    expect(roleRequests).toBe(2);
    expect(client.state).toEqual({ kind: "CONNECTED", role: "UNKNOWN" });
  });

  it("survives a ViewerRole transport failure during a retry: no unhandled rejection, flag released, later retry recovers", async () => {
    let roleRequests = 0;
    electron.fetch.mockImplementation(
      async (_url: string, options: RequestInit) => {
        if (!isRole(options))
          return ok({ collectorStatus: { state: "DISABLED" } });
        roleRequests++;
        if (roleRequests === 1) return new Response("x", { status: 503 });
        if (roleRequests === 2) throw new TypeError("socket hang up");
        return ok({ viewerRole: "ADMIN" });
      },
    );
    const unhandled: unknown[] = [];
    const record = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", record);
    try {
      const client = new ApiClient(storeWithToken(), vi.fn());
      await client.initialize();
      await client.query("CollectorStatus"); // retry #2 throws at transport level
      await settle();
      expect(roleRequests).toBe(2);
      expect(client.state).toEqual({ kind: "CONNECTED", role: "UNKNOWN" });
      await client.query("CollectorStatus"); // guard was released: retry #3 runs
      await vi.waitFor(() =>
        expect(client.state).toEqual({ kind: "CONNECTED", role: "ADMIN" }),
      );
      await settle();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", record);
    }
  });

  it("discards a role retry that completes after clear()", async () => {
    let roleRequests = 0;
    let release: ((r: Response) => void) | undefined;
    electron.fetch.mockImplementation(
      async (_url: string, options: RequestInit) => {
        if (!isRole(options))
          return ok({ collectorStatus: { state: "DISABLED" } });
        roleRequests++;
        if (roleRequests === 1)
          return new Response("unavailable", { status: 503 });
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      },
    );
    const client = new ApiClient(storeWithToken(), vi.fn());
    await client.initialize();
    const pending = client.query("CollectorStatus");
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    await client.clear();
    release?.(ok({ viewerRole: "ADMIN" }));
    await pending;
    await settle();
    expect(client.state).toEqual({ kind: "NOT_CONFIGURED" });
    expect(await client.query("CollectorStatus")).toMatchObject({
      ok: false,
      error: { class: "NOT_CONFIGURED" },
    });
  });

  it("never publishes a role verified for the previous token after saveToken replaces it", async () => {
    const store = storeWithToken();
    vi.spyOn(store, "saveToken").mockResolvedValue();
    const held = new Map<string, (r: Response) => void>();
    let firstRole = true;
    electron.fetch.mockImplementation(
      async (_url: string, options: RequestInit) => {
        const bearer = String(
          new Headers(options.headers).get("authorization"),
        );
        const role = isRole(options);
        if (role && firstRole) {
          firstRole = false;
          return new Response("unavailable", { status: 503 });
        }
        const key = `${bearer}:${role ? "role" : "status"}`;
        if (bearer.endsWith("new-token") && !role)
          return new Promise<Response>((resolve) => held.set(key, resolve));
        if (role)
          return new Promise<Response>((resolve) => held.set(key, resolve));
        return ok({ collectorStatus: { state: "DISABLED" } });
      },
    );
    const states: unknown[] = [];
    const client = new ApiClient(store, (s) => states.push(s));
    await client.initialize();
    expect(client.state).toEqual({ kind: "CONNECTED", role: "UNKNOWN" });

    const saving = client.saveToken("new-token");
    await vi.waitFor(() =>
      expect(held.has("Bearer new-token:status")).toBe(true),
    );
    // An ordinary query still runs with the old token and starts a role retry for it.
    const query = client.query("CollectorStatus");
    await vi.waitFor(() =>
      expect(held.has("Bearer synthetic-token:role")).toBe(true),
    );
    held.get("Bearer new-token:status")?.(
      ok({ collectorStatus: { state: "DISABLED" } }),
    );
    await vi.waitFor(() =>
      expect(held.has("Bearer new-token:role")).toBe(true),
    );
    // The old token's ADMIN answer arrives first and must be ignored.
    held.get("Bearer synthetic-token:role")?.(ok({ viewerRole: "ADMIN" }));
    await query;
    await settle(); // the old token's retry has completed and been discarded
    expect(client.state).toEqual({ kind: "CONNECTED", role: "UNKNOWN" });
    held.get("Bearer new-token:role")?.(ok({ viewerRole: "VIEWER" }));
    expect(await saving).toEqual({ ok: true });
    expect(client.state).toEqual({ kind: "CONNECTED", role: "VIEWER" });
    expect(
      states.some(
        (s) =>
          typeof s === "object" &&
          s !== null &&
          "role" in s &&
          s.role === "ADMIN",
      ),
    ).toBe(false);
  });

  it("withdraws a verified ADMIN as soon as the token is replaced and keeps UNKNOWN when the new token's role fails", async () => {
    const store = storeWithToken();
    vi.spyOn(store, "saveToken").mockResolvedValue();
    let releaseNewRole: ((r: Response) => void) | undefined;
    electron.fetch.mockImplementation(
      async (_url: string, options: RequestInit) => {
        if (!isRole(options))
          return ok({ collectorStatus: { state: "DISABLED" } });
        if (
          new Headers(options.headers).get("authorization") ===
          "Bearer new-token"
        )
          return new Promise<Response>((resolve) => {
            releaseNewRole = resolve;
          });
        return ok({ viewerRole: "ADMIN" });
      },
    );
    const states: unknown[] = [];
    const client = new ApiClient(store, (s) => states.push(s));
    await client.initialize();
    expect(client.state).toEqual({ kind: "CONNECTED", role: "ADMIN" });

    const before = states.length;
    const saving = client.saveToken("new-token");
    await vi.waitFor(() => expect(releaseNewRole).toBeTypeOf("function"));
    // The new token's role is unverified, so the previous token's ADMIN is already gone.
    expect(client.state).toEqual({ kind: "CONNECTED", role: "UNKNOWN" });
    releaseNewRole?.(new Response("unavailable", { status: 503 }));
    expect(await saving).toEqual({ ok: true });
    await settle();
    expect(client.state).toEqual({ kind: "CONNECTED", role: "UNKNOWN" });
    expect(states.slice(before)).not.toContainEqual({
      kind: "CONNECTED",
      role: "ADMIN",
    });
  });

  it("discards a role retry from before a re-pin even when the same token is saved again", async () => {
    let settings = {
      backendUrl: "https://solar.local",
      pinnedFingerprint: `sha256/${Buffer.alloc(32, 1).toString("base64")}`,
    };
    const store = storeWithToken();
    vi.spyOn(store, "getSettings").mockImplementation(async () => settings);
    vi.spyOn(store, "pinCertificate").mockImplementation(async (url, pin) => {
      settings = { backendUrl: url, pinnedFingerprint: pin };
    });
    vi.spyOn(store, "saveToken").mockResolvedValue();
    let roleRequests = 0;
    const heldRoles: Array<(r: Response) => void> = [];
    electron.fetch.mockImplementation(
      async (_url: string, options: RequestInit) => {
        if (!isRole(options))
          return ok({ collectorStatus: { state: "DISABLED" } });
        roleRequests++;
        if (roleRequests === 1)
          return new Response("unavailable", { status: 503 });
        return new Promise<Response>((resolve) => {
          heldRoles.push(resolve);
        });
      },
    );
    const states: unknown[] = [];
    const client = new ApiClient(store, (s) => states.push(s));
    const repinned = `sha256/${Buffer.alloc(32, 2).toString("base64")}`;
    vi.spyOn(client, "probeCertificate").mockResolvedValue({
      ok: true,
      fingerprint: repinned,
    });
    await client.initialize();
    expect(client.state).toEqual({ kind: "CONNECTED", role: "UNKNOWN" });

    const querying = client.query("CollectorStatus"); // starts a role retry that stays held
    await vi.waitFor(() => expect(heldRoles).toHaveLength(1));
    expect(
      await client.pinCertificate("https://solar.local", repinned),
    ).toEqual({ ok: true });
    expect(client.state).toEqual({ kind: "NOT_CONFIGURED" });
    const saving = client.saveToken("synthetic-token"); // same token, new trust context
    await vi.waitFor(() => expect(heldRoles).toHaveLength(2));
    expect(client.state).toEqual({ kind: "CONNECTED", role: "UNKNOWN" });
    // The answer from before the re-pin arrives while the new context is still unverified.
    heldRoles[0]?.(ok({ viewerRole: "ADMIN" }));
    await querying;
    await settle();
    expect(client.state).toEqual({ kind: "CONNECTED", role: "UNKNOWN" });
    heldRoles[1]?.(ok({ viewerRole: "VIEWER" }));
    expect(await saving).toEqual({ ok: true });
    expect(client.state).toEqual({ kind: "CONNECTED", role: "VIEWER" });
    expect(states).not.toContainEqual({ kind: "CONNECTED", role: "ADMIN" });
  });

  it("returns a query result while its ViewerRole retry is still held", async () => {
    let roleRequests = 0;
    let release: ((r: Response) => void) | undefined;
    electron.fetch.mockImplementation(
      async (_url: string, options: RequestInit) => {
        if (!isRole(options))
          return ok({ collectorStatus: { state: "DISABLED" } });
        roleRequests++;
        if (roleRequests === 1)
          return new Response("unavailable", { status: 503 });
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      },
    );
    const client = new ApiClient(storeWithToken(), vi.fn());
    await client.initialize();

    let timer: NodeJS.Timeout | undefined;
    const outcome = await Promise.race([
      client.query("CollectorStatus"),
      new Promise<"blocked">((resolve) => {
        timer = setTimeout(() => resolve("blocked"), 500);
      }),
    ]);
    clearTimeout(timer);
    expect(outcome).toMatchObject({ ok: true });
    expect(release).toBeTypeOf("function"); // the retry started and is still held
    expect(client.state).toEqual({ kind: "CONNECTED", role: "UNKNOWN" });
    release?.(ok({ viewerRole: "ADMIN" }));
    await vi.waitFor(() =>
      expect(client.state).toEqual({ kind: "CONNECTED", role: "ADMIN" }),
    );
  });
});
