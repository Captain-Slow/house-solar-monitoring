import { createHash, X509Certificate } from "node:crypto";
import { isIP } from "node:net";
import { domainToASCII } from "node:url";
import type { Certificate } from "electron";
import type { QueryError } from "@solar/contracts/bridge";

export function parseBackendUrl(input: string): URL | null {
  if (input.trim() !== input) return null;
  const address = /^https:\/\/[^/?#]*(\/[^?#]*)?/.exec(input);
  if (!address || (address[1] && address[1] !== "/")) return null;
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (!isIP(host)) {
    const ascii = domainToASCII(host);
    if (
      !ascii ||
      ascii.length > 253 ||
      ascii !== host ||
      !ascii
        .split(".")
        .every(
          (label) =>
            label.length > 0 &&
            label.length <= 63 &&
            /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label),
        )
    )
      return null;
  }
  return url;
}

export function trustedDevUrl(
  candidate: string | undefined,
  packaged: boolean,
): string | undefined {
  if (packaged || !candidate) return undefined;
  try {
    const url = new URL(candidate);
    if (
      url.protocol !== "http:" ||
      (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash
    )
      return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export function normalizeFingerprint(input: string): string | null {
  const value = input.trim();
  const base64 = /^sha256\/([A-Za-z0-9+/]{43}=)$/.exec(value);
  if (base64)
    return Buffer.from(base64[1]!, "base64").length === 32 ? value : null;
  const hex = value.replaceAll(":", "");
  if (!/^[a-f\d]{64}$/i.test(hex)) return null;
  return `sha256/${Buffer.from(hex, "hex").toString("base64")}`;
}

export function certificateFingerprint(
  certificate: Pick<Certificate, "fingerprint" | "data">,
): string | null {
  // Chromium may report a colon-separated digest; hashing DER also covers versions reporting SHA-1.
  try {
    const pem = certificate.data;
    if (pem)
      return `sha256/${createHash("sha256").update(new X509Certificate(pem).raw).digest("base64")}`;
  } catch {
    /* Fall back to Chromium's SHA-256 fingerprint. */
  }
  return normalizeFingerprint(certificate.fingerprint);
}

export function isRendererUrl(frameUrl: string, devUrl?: string): boolean {
  try {
    const frame = new URL(frameUrl);
    if (
      frame.protocol === "app:" &&
      frame.hostname === "renderer" &&
      frame.port === "" &&
      !frame.username &&
      !frame.password
    )
      return true;
    if (devUrl) {
      const dev = new URL(devUrl);
      return (
        frame.origin === dev.origin &&
        frame.protocol === dev.protocol &&
        !frame.username &&
        !frame.password
      );
    }
  } catch {
    /* Invalid sender. */
  }
  return false;
}

export function validVariables(
  value: unknown,
): value is Record<string, unknown> {
  if (value === undefined) return true;
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try {
    const json = JSON.stringify(value);
    return json !== undefined && Buffer.byteLength(json, "utf8") <= 64 * 1024;
  } catch {
    return false;
  }
}

export function classifyError(
  error: unknown,
  status?: number,
  graphqlErrors?: unknown[],
): QueryError {
  if (status === 401 || status === 403)
    return {
      class: "AUTH",
      message: "Authentication failed or permission denied",
    };
  if (status === 429)
    return { class: "RATE_LIMITED", message: "Backend rate limit reached" };
  if (status && status >= 500)
    return { class: "SERVER", message: "Backend server error" };
  if (graphqlErrors?.length)
    return {
      class: "GRAPHQL",
      message: graphqlErrors
        .map((item) => {
          if (
            item &&
            typeof item === "object" &&
            "message" in item &&
            typeof item.message === "string"
          )
            return item.message;
          return "GraphQL error";
        })
        .join("; "),
    };
  const message =
    error instanceof Error
      ? `${error.message} ${error.cause instanceof Error ? error.cause.message : ""}`
      : String(error ?? "");
  if (/ERR_CERT_|CERTIFICATE|SSL|TLS|ERR_FAILED.*certificate/i.test(message))
    return {
      class: "TLS",
      message: "Backend TLS certificate could not be verified",
    };
  if (status && status >= 400)
    return { class: "SERVER", message: `Backend returned HTTP ${status}` };
  return {
    class: "NETWORK",
    message: "Backend unreachable or request timed out",
  };
}
