import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from "electron";
import { z } from "zod";
import { OPERATIONS, type OperationName } from "@solar/contracts/operations";
import type { ConnectionState, QueryResult } from "@solar/contracts/bridge";
import { ApiClient } from "./api-client.js";
import { SettingsStore } from "./settings-store.js";
import { isRendererUrl, parseBackendUrl, validVariables } from "./policy.js";

const operation = z.custom<OperationName>(
  (value) => typeof value === "string" && Object.hasOwn(OPERATIONS, value),
);
const variables = z.custom<Record<string, unknown> | undefined>(validVariables);
const token = z.string().min(16).max(4096).regex(/^\S+$/);
const fingerprint = z.string().regex(/^sha256\/[A-Za-z0-9+/]{43}=$/);
const backendUrl = z
  .string()
  .refine((value) => parseBackendUrl(value) !== null);

export function registerIpc(
  client: ApiClient,
  store: SettingsStore,
  devUrl?: string,
): void {
  const authorize = (event: IpcMainInvokeEvent): void => {
    if (
      !event.senderFrame ||
      !isRendererUrl(event.senderFrame.url, devUrl) ||
      event.senderFrame !== event.sender.mainFrame
    )
      throw new Error("Untrusted renderer frame");
  };
  ipcMain.handle(
    "solar:query",
    async (
      event,
      op: unknown,
      vars: unknown,
    ): Promise<QueryResult<unknown>> => {
      authorize(event);
      const parsed = z.tuple([operation, variables]).safeParse([op, vars]);
      if (!parsed.success)
        return {
          ok: false,
          error: {
            class: "GRAPHQL",
            message: "Invalid operation or variables (maximum 64 KB JSON)",
          },
        };
      return client.query(parsed.data[0], parsed.data[1]);
    },
  );
  ipcMain.handle("solar:settings:get", async (event) => {
    authorize(event);
    const settings = await store.getSettings();
    return {
      backendUrl: settings?.backendUrl ?? null,
      pinnedFingerprint: settings?.pinnedFingerprint ?? null,
      hasToken: await store.hasToken(),
    };
  });
  ipcMain.handle("solar:settings:probe", async (event, input: unknown) => {
    authorize(event);
    const parsed = backendUrl.safeParse(input);
    return parsed.success
      ? client.probeCertificate(parsed.data)
      : { ok: false, message: "Invalid HTTPS backend URL" };
  });
  ipcMain.handle(
    "solar:settings:pin",
    async (event, input: unknown, digest: unknown) => {
      authorize(event);
      const parsed = z
        .tuple([backendUrl, fingerprint])
        .safeParse([input, digest]);
      return parsed.success
        ? client.pinCertificate(parsed.data[0], parsed.data[1])
        : { ok: false, message: "Invalid URL or SHA-256 fingerprint" };
    },
  );
  ipcMain.handle("solar:settings:token", async (event, input: unknown) => {
    authorize(event);
    const parsed = token.safeParse(input);
    return parsed.success
      ? client.saveToken(parsed.data)
      : { ok: false, message: "Invalid token" };
  });
  ipcMain.handle("solar:settings:clear", async (event) => {
    authorize(event);
    await client.clear();
  });
  ipcMain.handle("solar:window:minimize", (event) => {
    authorize(event);
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });
  ipcMain.handle("solar:window:toggle-maximize", (event) => {
    authorize(event);
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  });
  ipcMain.handle("solar:window:close", (event) => {
    authorize(event);
    BrowserWindow.fromWebContents(event.sender)?.close();
  });
}

export function broadcastConnection(state: ConnectionState): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed())
      window.webContents.send("solar:connection-state", state);
  }
}

/** Tells the renderer whether the window is maximised so the caption button shows Maximize or Restore. */
export function bindWindowState(window: BrowserWindow): void {
  const send = (): void => {
    if (!window.isDestroyed())
      window.webContents.send("solar:window:maximized", window.isMaximized());
  };
  window.on("maximize", send);
  window.on("unmaximize", send);
  window.on("enter-full-screen", send);
  window.on("leave-full-screen", send);
  window.webContents.on("did-finish-load", send);
}
