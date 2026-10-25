import { app, BrowserWindow, nativeTheme } from "electron";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ApiClient } from "./api-client.js";
import { bindWindowState, broadcastConnection, registerIpc } from "./ipc.js";
import {
  installRendererSecurity,
  rendererWebPreferences,
  secureWindow,
} from "./security.js";
import { SettingsStore } from "./settings-store.js";
import { trustedDevUrl } from "./policy.js";

const devUrl = trustedDevUrl(process.env.ELECTRON_RENDERER_URL, app.isPackaged);
const output = resolve(fileURLToPath(import.meta.url), "..", "..");

async function createWindow(client: ApiClient): Promise<void> {
  const window = new BrowserWindow({
    width: 914,
    height: 672,
    minWidth: 914,
    minHeight: 672,
    titleBarStyle: "hidden",
    backgroundColor: "#09090b",
    show: false,
    webPreferences: {
      ...rendererWebPreferences,
      preload: resolve(output, "preload/index.cjs"),
      devTools: !app.isPackaged,
    },
  });
  window.setAutoHideMenuBar(false);
  window.setMenuBarVisibility(false);
  bindWindowState(window);
  secureWindow(window, devUrl);
  window.once("ready-to-show", () => window.show());
  window.webContents.on("did-finish-load", () =>
    window.webContents.send("solar:connection-state", client.state),
  );
  await window.loadURL(devUrl ?? "app://renderer/");
}

nativeTheme.themeSource = "dark";

void app.whenReady().then(async () => {
  installRendererSecurity(resolve(output, "renderer"), devUrl);
  const store = new SettingsStore();
  const client = new ApiClient(store, broadcastConnection);
  registerIpc(client, store, devUrl);
  await client.initialize();
  await createWindow(client);
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow(client);
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
