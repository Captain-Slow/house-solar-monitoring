import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SettingsStore } from "./settings-store.js";
import { ApiClient } from "./api-client.js";

const state = vi.hoisted(() => ({
  directory: "",
  failUnlink: false,
  failSettingsRename: false,
  fetch: vi.fn(),
}));

vi.mock("electron", () => ({
  app: { getPath: () => state.directory },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
  session: {
    fromPartition: () => ({
      fetch: state.fetch,
      setCertificateVerifyProc: vi.fn(),
    }),
  },
}));

vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return {
    ...actual,
    unlink: async (path: string) => {
      if (state.failUnlink && path.endsWith("token.bin"))
        throw new Error("Windows file lock");
      return actual.unlink(path);
    },
    rename: async (source: string, destination: string) => {
      if (state.failSettingsRename && destination.endsWith("settings.json"))
        throw new Error("interrupted settings commit");
      return actual.rename(source, destination);
    },
  };
});

const first = {
  backendUrl: "https://solar.local",
  pinnedFingerprint: `sha256/${Buffer.alloc(32, 1).toString("base64")}`,
};
const second = {
  backendUrl: "https://other.local",
  pinnedFingerprint: `sha256/${Buffer.alloc(32, 2).toString("base64")}`,
};
const fakeCredential = "not-a-real-secret-token";

beforeEach(async () => {
  state.directory = await mkdtemp(join(tmpdir(), "solar-settings-"));
  state.failUnlink = false;
  state.failSettingsRename = false;
  state.fetch.mockReset();
});

afterEach(async () => {
  await rm(state.directory, { recursive: true, force: true });
});

describe("persisted backend credential identity", () => {
  it("rejects a credential whose encrypted backend identity differs from settings, without making a request", async () => {
    const store = new SettingsStore();
    await store.pinCertificate(first.backendUrl, first.pinnedFingerprint);
    await store.saveToken(fakeCredential, first);
    expect(
      await readFile(join(state.directory, "settings.json"), "utf8"),
    ).not.toContain(fakeCredential);
    await writeFile(
      join(state.directory, "settings.json"),
      JSON.stringify(second),
    );
    expect(await store.getToken()).toBeNull();
    expect(await store.hasToken()).toBe(false);
    const client = new ApiClient(store, vi.fn());
    await client.initialize();
    expect(client.state.kind).toBe("NOT_CONFIGURED");
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("preserves the original identity on token invalidation failure, and removes token before a failed settings commit", async () => {
    const store = new SettingsStore();
    await store.pinCertificate(first.backendUrl, first.pinnedFingerprint);
    await store.saveToken(fakeCredential, first);
    state.failUnlink = true;
    await expect(
      store.pinCertificate(second.backendUrl, second.pinnedFingerprint),
    ).rejects.toThrow("Windows file lock");
    expect(await store.getSettings()).toEqual(first);
    expect(await store.getToken()).toBe(fakeCredential);
    state.failUnlink = false;
    state.failSettingsRename = true;
    await expect(
      store.pinCertificate(second.backendUrl, second.pinnedFingerprint),
    ).rejects.toThrow("interrupted settings commit");
    expect(await store.getSettings()).toEqual(first);
    expect(await store.getToken()).toBeNull();
  });
});
