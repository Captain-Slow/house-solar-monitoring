import { contextBridge, ipcRenderer } from "electron";
import type { ConnectionState, SolarBridge } from "@solar/contracts/bridge";

let currentState: ConnectionState | undefined;
const subscribers = new Set<(state: ConnectionState) => void>();
ipcRenderer.on("solar:connection-state", (_event, state: ConnectionState) => {
  currentState = state;
  for (const subscriber of subscribers) subscriber(state);
});

const solar: SolarBridge = {
  query: (op, vars) => ipcRenderer.invoke("solar:query", op, vars),
  settings: {
    get: () => ipcRenderer.invoke("solar:settings:get"),
    probeCertificate: (url) => ipcRenderer.invoke("solar:settings:probe", url),
    pinCertificate: (url, fingerprint) =>
      ipcRenderer.invoke("solar:settings:pin", url, fingerprint),
    saveToken: (token) => ipcRenderer.invoke("solar:settings:token", token),
    clear: () => ipcRenderer.invoke("solar:settings:clear"),
  },
  onConnectionState(callback) {
    subscribers.add(callback);
    if (currentState) callback(currentState);
    return () => {
      subscribers.delete(callback);
    };
  },
};

contextBridge.exposeInMainWorld("solar", solar);
