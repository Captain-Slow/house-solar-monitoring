import { app, safeStorage } from "electron";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { normalizeFingerprint, parseBackendUrl } from "./policy.js";

const persisted = z.object({
  backendUrl: z.string(),
  pinnedFingerprint: z.string(),
});
const encryptedCredential = persisted.extend({ token: z.string().min(1) });
export interface BackendSettings {
  backendUrl: string;
  pinnedFingerprint: string;
}

export class SettingsStore {
  private get directory(): string {
    return app.getPath("userData");
  }
  private get settingsPath(): string {
    return join(this.directory, "settings.json");
  }
  private get tokenPath(): string {
    return join(this.directory, "token.bin");
  }

  async getSettings(): Promise<BackendSettings | null> {
    try {
      const value = persisted.parse(
        JSON.parse(await readFile(this.settingsPath, "utf8")),
      );
      if (
        !parseBackendUrl(value.backendUrl) ||
        !normalizeFingerprint(value.pinnedFingerprint)
      )
        return null;
      return value;
    } catch {
      return null;
    }
  }

  async getToken(settings?: BackendSettings): Promise<string | null> {
    if (!safeStorage.isEncryptionAvailable()) return null;
    const expected = settings ?? (await this.getSettings());
    if (!expected) return null;
    try {
      const value = encryptedCredential.parse(
        JSON.parse(safeStorage.decryptString(await readFile(this.tokenPath))),
      );
      return value.backendUrl === expected.backendUrl &&
        value.pinnedFingerprint === expected.pinnedFingerprint
        ? value.token
        : null;
    } catch {
      return null;
    }
  }

  async hasToken(): Promise<boolean> {
    return (await this.getToken()) !== null;
  }

  async pinCertificate(url: string, fingerprint: string): Promise<void> {
    await mkdir(this.directory, { recursive: true });
    const path = `${this.settingsPath}.tmp`;
    await writeFile(
      path,
      JSON.stringify({ backendUrl: url, pinnedFingerprint: fingerprint }),
      { mode: 0o600 },
    );
    await unlink(this.tokenPath).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return;
      throw error;
    });
    await rename(path, this.settingsPath);
  }

  async saveToken(token: string, settings: BackendSettings): Promise<void> {
    if (!safeStorage.isEncryptionAvailable())
      throw new Error("OS encryption unavailable; token was not saved");
    await mkdir(this.directory, { recursive: true });
    const path = `${this.tokenPath}.tmp`;
    const boundCredential = JSON.stringify({ ...settings, token });
    await writeFile(path, safeStorage.encryptString(boundCredential), {
      mode: 0o600,
    });
    await rename(path, this.tokenPath);
  }

  async clear(): Promise<void> {
    for (const path of [this.tokenPath, this.settingsPath]) {
      try {
        await unlink(path);
      } catch (error) {
        if (!(
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        ))
          throw error;
      }
    }
  }
}
