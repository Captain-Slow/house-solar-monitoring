import { BrowserWindow, net, protocol, session } from "electron";
import { extname, isAbsolute, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { isRendererUrl } from "./policy.js";

const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";

protocol.registerSchemesAsPrivileged([
  { scheme: "app", privileges: { standard: true, secure: true } },
]);

export function installRendererSecurity(
  rendererRoot: string,
  devUrl?: string,
): void {
  session.defaultSession.setPermissionRequestHandler(
    (_contents, _permission, callback) => callback(false),
  );
  if (!devUrl) {
    protocol.handle("app", async (request) => {
      const url = new URL(request.url);
      if (url.host !== "renderer" || url.username || url.password)
        return new Response(null, { status: 404 });
      const path = decodeURIComponent(url.pathname);
      const target = resolve(
        rendererRoot,
        path === "/" ? "index.html" : `.${path}`,
      );
      const fromRoot = relative(rendererRoot, target);
      if (fromRoot.startsWith("..") || isAbsolute(fromRoot))
        return new Response(null, { status: 404 });
      const response = await net.fetch(pathToFileURL(target).toString());
      const headers = new Headers(response.headers);
      headers.set("Content-Security-Policy", CSP);
      const types: Record<string, string> = {
        ".js": "text/javascript",
        ".css": "text/css",
        ".html": "text/html",
        ".svg": "image/svg+xml",
        ".png": "image/png",
      };
      if (types[extname(target)])
        headers.set("Content-Type", types[extname(target)]);
      return new Response(response.body, { status: response.status, headers });
    });
  }
}

export function secureWindow(window: BrowserWindow, devUrl?: string): void {
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event, url) => {
    if (!isRendererUrl(url, devUrl)) event.preventDefault();
  });
}

export const rendererWebPreferences = {
  contextIsolation: true,
  sandbox: true,
  nodeIntegration: false,
  webSecurity: true,
} as const;
