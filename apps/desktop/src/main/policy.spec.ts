import { describe, expect, it } from "vitest";
import {
  classifyError,
  isRendererUrl,
  normalizeFingerprint,
  parseBackendUrl,
  trustedDevUrl,
  validVariables,
} from "./policy.js";

describe("backend URL validation", () => {
  it("accepts HTTPS hostnames, IPv4 and IPv6 with optional ports", () => {
    expect(parseBackendUrl("https://solar.local:8443")?.origin).toBe(
      "https://solar.local:8443",
    );
    expect(parseBackendUrl("https://192.168.1.2")?.hostname).toBe(
      "192.168.1.2",
    );
    expect(parseBackendUrl("https://[::1]:8443")?.hostname).toBe("[::1]");
  });
  it("rejects insecure schemes, credentials, paths and malformed DNS labels", () => {
    for (const url of [
      "http://solar.local",
      "https://user:pass@solar.local",
      "https://solar.local/graphql",
      "https://solar.local/foo/../",
      "https://solar.local/?q=1",
      "https://solar.local/#foo",
      "https://-bad.local",
      "https://solar.local:99999",
    ]) {
      expect(parseBackendUrl(url), url).toBeNull();
    }
  });
});

describe("IPC sender origin and payload limits", () => {
  it("rejects lookalike app authorities and arbitrary sites", () => {
    expect(isRendererUrl("app://renderer/index.html")).toBe(true);
    expect(isRendererUrl("app://renderer.evil/index.html")).toBe(false);
    expect(isRendererUrl("app://renderer@evil/index.html")).toBe(false);
    expect(isRendererUrl("https://example.com")).toBe(false);
    expect(
      isRendererUrl("http://localhost:5173/dashboard", "http://localhost:5173"),
    ).toBe(true);
    expect(
      isRendererUrl("http://localhost:5174/dashboard", "http://localhost:5173"),
    ).toBe(false);
  });
  it("accepts exactly 64 KiB JSON and rejects the next byte", () => {
    expect(validVariables({ value: "x".repeat(65_524) })).toBe(true);
    expect(validVariables({ value: "x".repeat(65_525) })).toBe(false);
    expect(validVariables({ value: "é".repeat(40_000) })).toBe(false);
    expect(validVariables([])).toBe(false);
  });
});

describe("renderer dev origin", () => {
  it("never trusts environment URL in packaged builds and allows only loopback HTTP in dev", () => {
    expect(trustedDevUrl("https://attacker.example", true)).toBeUndefined();
    expect(trustedDevUrl("http://localhost:5173", true)).toBeUndefined();
    expect(trustedDevUrl("http://localhost:5173", false)).toBe(
      "http://localhost:5173",
    );
    expect(trustedDevUrl("http://127.0.0.1:5173/", false)).toBe(
      "http://127.0.0.1:5173",
    );
    expect(
      trustedDevUrl("http://attacker.example:5173", false),
    ).toBeUndefined();
    expect(trustedDevUrl("http://localhost.evil:5173", false)).toBeUndefined();
    expect(trustedDevUrl("https://localhost:5173", false)).toBeUndefined();
    expect(trustedDevUrl("http://user@localhost:5173", false)).toBeUndefined();
  });
});

describe("TLS fingerprint and error classification", () => {
  it("normalizes SHA-256 hex to the printed sha256/base64 format", () => {
    const bytes = Buffer.alloc(32, 0xab);
    expect(normalizeFingerprint(bytes.toString("hex"))).toBe(
      `sha256/${bytes.toString("base64")}`,
    );
    expect(normalizeFingerprint(`sha256/${bytes.toString("base64")}`)).toBe(
      `sha256/${bytes.toString("base64")}`,
    );
    expect(normalizeFingerprint("sha256/not-a-digest")).toBeNull();
  });
  it("distinguishes rejected certificates from refused connections and auth failures", () => {
    expect(
      classifyError(new Error("net::ERR_CERT_AUTHORITY_INVALID")).class,
    ).toBe("TLS");
    expect(classifyError(new Error("net::ERR_CONNECTION_REFUSED")).class).toBe(
      "NETWORK",
    );
    expect(classifyError(null, 401).class).toBe("AUTH");
    expect(classifyError(null, 429).class).toBe("RATE_LIMITED");
    expect(classifyError(null, 200, [{ message: "bad field" }]).class).toBe(
      "GRAPHQL",
    );
  });
});
