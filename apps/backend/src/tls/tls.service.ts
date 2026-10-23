import { createHash, randomBytes, X509Certificate } from 'node:crypto';
import { isIP } from 'node:net';
import { mkdir, open, readFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { generate } from 'selfsigned';
import { Injectable } from '@nestjs/common';
import type { Env } from '../config/env.js';

export function subjectAltNames(
  input: string,
): Array<{ type: 2; value: string } | { type: 7; ip: string }> {
  const names = new Set([
    'localhost',
    '127.0.0.1',
    ...input
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  ]);
  return [...names].map((name) =>
    isIP(name)
      ? { type: 7 as const, ip: name }
      : { type: 2 as const, value: name },
  );
}

@Injectable()
export class TlsService {
  private constructor(
    readonly cert: string,
    readonly key: string,
    readonly fingerprintBase64: string,
    readonly fingerprintHexColon: string,
    readonly notAfter: Date,
  ) {}

  get httpsOptions(): { cert: string; key: string } {
    return { cert: this.cert, key: this.key };
  }

  static async load(
    env: Pick<Env, 'TLS_DIR' | 'TLS_SUBJECT_ALT_NAMES'>,
  ): Promise<TlsService> {
    await mkdir(env.TLS_DIR, { recursive: true });
    const certPath = join(env.TLS_DIR, 'cert.pem');
    const keyPath = join(env.TLS_DIR, 'key.pem');
    const readPair = async (): Promise<[string, string] | null> => {
      const pair = await Promise.all([
        readFile(certPath, 'utf8').catch((e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return null;
          throw e;
        }),
        readFile(keyPath, 'utf8').catch((e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return null;
          throw e;
        }),
      ]);
      if (pair[0] === null && pair[1] === null) return null;
      if (pair[0] === null || pair[1] === null)
        throw new Error('incomplete TLS certificate pair');
      return pair as [string, string];
    };
    let pair = await readPair();
    if (!pair) {
      const lockPath = join(env.TLS_DIR, '.cert-generation.lock');
      const lock = await open(lockPath, 'wx', 0o600);
      try {
        pair = await readPair();
        if (!pair) {
          const now = new Date();
          const pems = await generate(
            [{ name: 'commonName', value: 'localhost' }],
            {
              keyType: 'ec',
              curve: 'P-256',
              algorithm: 'sha256',
              notBeforeDate: now,
              notAfterDate: new Date(now.getTime() + 3650 * 86_400_000),
              extensions: [
                { name: 'basicConstraints', cA: false },
                { name: 'keyUsage', digitalSignature: true },
                { name: 'extKeyUsage', serverAuth: true },
                {
                  name: 'subjectAltName',
                  altNames: subjectAltNames(env.TLS_SUBJECT_ALT_NAMES),
                },
              ],
            },
          );
          const suffix = randomBytes(8).toString('hex');
          const certTemp = `${certPath}.${suffix}.tmp`;
          const keyTemp = `${keyPath}.${suffix}.tmp`;
          try {
            const certHandle = await open(certTemp, 'wx', 0o644);
            try {
              await certHandle.writeFile(pems.cert);
            } finally {
              await certHandle.close();
            }
            const keyHandle = await open(keyTemp, 'wx', 0o600);
            try {
              await keyHandle.writeFile(pems.private);
            } finally {
              await keyHandle.close();
            }
            await rename(keyTemp, keyPath);
            await rename(certTemp, certPath);
          } finally {
            await Promise.all([
              unlink(certTemp).catch(() => undefined),
              unlink(keyTemp).catch(() => undefined),
            ]);
          }
          pair = [pems.cert, pems.private];
        }
      } finally {
        await lock.close();
        await unlink(lockPath);
      }
    }
    const cert = new X509Certificate(pair[0]);
    const digest = createHash('sha256').update(cert.raw).digest();
    return new TlsService(
      pair[0],
      pair[1],
      digest.toString('base64'),
      [...digest]
        .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
        .join(':'),
      new Date(cert.validTo),
    );
  }
}
