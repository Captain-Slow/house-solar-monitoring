import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildDatabaseUrl } from './database-url.js';

function secret(contents: string): string {
  const f = join(mkdtempSync(join(tmpdir(), 'dburl-')), 'db_password');
  writeFileSync(f, contents);
  return f;
}

describe('buildDatabaseUrl', () => {
  it('returns DATABASE_URL unchanged without a password file (dev/tests)', () => {
    const url = 'postgresql://solar:solar@127.0.0.1:55432/solar_test';
    expect(buildDatabaseUrl({ DATABASE_URL: url })).toBe(url);
  });

  it('inserts the URL-encoded password so + / = % @ : survive a round trip', () => {
    const pw = 'a+b/c=d%e@f:g?h#i';
    const out = buildDatabaseUrl({
      DATABASE_URL: 'postgresql://solar@db:5432/solar?sslmode=disable',
      DATABASE_PASSWORD_FILE: secret(`${pw}\n`),
    });
    const u = new URL(out);
    expect(decodeURIComponent(u.password)).toBe(pw);
    expect(u.username).toBe('solar');
    expect(u.host).toBe('db:5432');
    expect(u.pathname).toBe('/solar');
    expect(u.search).toBe('?sslmode=disable');
  });

  it('refuses a URL that already has a password, and an empty secret', () => {
    expect(() =>
      buildDatabaseUrl({
        DATABASE_URL: 'postgresql://solar:x@db/solar',
        DATABASE_PASSWORD_FILE: secret('pw'),
      }),
    ).toThrow(/must not contain a password/);
    expect(() =>
      buildDatabaseUrl({
        DATABASE_URL: 'postgresql://solar@db/solar',
        DATABASE_PASSWORD_FILE: secret('\n'),
      }),
    ).toThrow(/empty/);
  });
});
