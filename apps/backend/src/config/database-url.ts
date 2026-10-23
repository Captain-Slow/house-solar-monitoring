// Dependency-free on purpose: prisma.config.ts imports this file inside the runtime image,
// which contains nothing but dist/, node_modules/, prisma/ and this file. `node:fs` only.
import { readFileSync } from 'node:fs';

/**
 * Returns the connection URL. With `DATABASE_PASSWORD_FILE` unset (dev/tests) `DATABASE_URL`
 * is returned unchanged. Otherwise the file is read, trailing whitespace stripped, and the
 * URL-encoded password is inserted; `DATABASE_URL` must then carry the user but no password
 * (e.g. `postgresql://solar@db:5432/solar`).
 */
export function buildDatabaseUrl(
  env: Readonly<Record<string, string | undefined>>,
): string {
  const url = env.DATABASE_URL;
  if (url === undefined || url === '')
    throw new Error('DATABASE_URL is required');
  const file = env.DATABASE_PASSWORD_FILE;
  if (file === undefined || file === '') return url;

  const password = readFileSync(file, 'utf8').replace(/\s+$/, '');
  if (password === '') throw new Error('DATABASE_PASSWORD_FILE is empty');

  const u = new URL(url);
  if (u.password !== '') {
    throw new Error(
      'DATABASE_URL must not contain a password when DATABASE_PASSWORD_FILE is set',
    );
  }
  const user = u.username === '' ? '' : `${u.username}:`;
  if (user === '')
    throw new Error(
      'DATABASE_URL must carry a user when DATABASE_PASSWORD_FILE is set',
    );
  return `${u.protocol}//${user}${encodeURIComponent(password)}@${u.host}${u.pathname}${u.search}`;
}
