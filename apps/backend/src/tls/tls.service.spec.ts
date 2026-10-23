import { afterAll, describe, expect, it } from 'vitest';
import { createHash, X509Certificate } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TlsService, subjectAltNames } from './tls.service.js';

const dirs: string[] = [];
afterAll(async () => {
  for (const dir of dirs) await rm(dir, { recursive: true, force: true });
});

describe('TLS certificate', () => {
  it('classifies DNS and IP SAN entries with loopback always present', () => {
    expect(subjectAltNames('solar.lan, 192.168.1.2, ::1, localhost')).toEqual([
      { type: 2, value: 'localhost' },
      { type: 7, ip: '127.0.0.1' },
      { type: 2, value: 'solar.lan' },
      { type: 7, ip: '192.168.1.2' },
      { type: 7, ip: '::1' },
    ]);
  });

  it('generates P-256 with requested SANs, file modes, and independent DER digest; preserves the pair', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'solar-tls-'));
    dirs.push(dir);
    const env = { TLS_DIR: dir, TLS_SUBJECT_ALT_NAMES: 'solar.lan,10.0.0.2' };
    const first = await TlsService.load(env);
    const x509 = new X509Certificate(first.cert);
    expect(x509.subjectAltName).toContain('DNS:solar.lan');
    expect(x509.subjectAltName).toContain('IP Address:10.0.0.2');
    expect(x509.publicKey.asymmetricKeyType).toBe('ec');
    expect(x509.publicKey.asymmetricKeyDetails?.namedCurve).toBe('prime256v1');
    expect(first.fingerprintBase64).toBe(
      createHash('sha256').update(x509.raw).digest('base64'),
    );
    expect(first.fingerprintHexColon).toBe(
      createHash('sha256')
        .update(x509.raw)
        .digest('hex')
        .toUpperCase()
        .match(/../g)!
        .join(':'),
    );
    expect(first.notAfter.getTime() - Date.now()).toBeGreaterThan(
      3649 * 86_400_000,
    );
    const keyPath = join(dir, 'key.pem');
    if (process.platform !== 'win32')
      expect((await stat(keyPath)).mode & 0o777).toBe(0o600);
    const key = await readFile(keyPath, 'utf8');
    const second = await TlsService.load({
      ...env,
      TLS_SUBJECT_ALT_NAMES: 'different.example',
    });
    expect(second.cert).toBe(first.cert);
    expect(await readFile(keyPath, 'utf8')).toBe(key);
  });
});
