import pg from 'pg';

export const TEST_DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://solar:solar@127.0.0.1:55432/solar_test';

/** Terminates holders of advisory lock `key` in the selected database only. */
export async function terminateLockHolder(
  key: number,
  url: string = TEST_DATABASE_URL,
): Promise<number> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    const r = await c.query(
      `SELECT pg_terminate_backend(pid) AS t FROM pg_locks
        WHERE locktype = 'advisory' AND classid = 0 AND objid = $1 AND granted
          AND database = (SELECT oid FROM pg_database WHERE datname = current_database())`,
      [key],
    );
    return r.rowCount ?? 0;
  } finally {
    await c.end();
  }
}

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface TestDatabase {
  /** Plain URL with credentials (test only). */
  url: string;
  name: string;
  drop(): Promise<void>;
}

/**
 * Runs `work`, which provisions a database the caller already created. When `work` fails, `drop`
 * removes exactly that database and the original error propagates. If the drop fails as well, an
 * AggregateError reports both, the original error FIRST.
 */
export async function provisionOrDrop<T>(
  name: string,
  drop: () => Promise<void>,
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    try {
      await drop();
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `test database ${name} provisioning failed and cleanup failed: ${String(error)}; cleanup: ${String(cleanupError)}`,
      );
    }
    throw error;
  }
}

/**
 * Creates a fresh, uniquely named database on the dev Postgres, applies every
 * prisma/migrations/*\/migration.sql in order (up to `throughMigration`, or exactly the
 * `onlyMigrations` set, when given), and returns its URL. Call `drop()` in afterAll.
 */
export async function createTestDatabase(
  options: {
    throughMigration?: string;
    onlyMigrations?: readonly string[];
  } = {},
): Promise<TestDatabase> {
  const name = `t_${randomBytes(6).toString('hex')}`;
  const drop = async (): Promise<void> => {
    const a = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await a.connect();
    try {
      await a.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await a.end();
    }
  };

  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } catch (error) {
    // Nothing was created, so there is nothing to drop; the CREATE failure is the one to report.
    await admin.end().catch(() => undefined);
    throw error;
  }

  // From here on this invocation owns `name`; any failure, including closing `admin`, must remove
  // exactly that database.
  return provisionOrDrop(name, drop, async () => {
    await admin.end();

    const u = new URL(TEST_DATABASE_URL);
    u.pathname = `/${name}`;
    const url = u.toString();

    const migrationsDir = join(
      import.meta.dirname,
      '..',
      '..',
      'prisma',
      'migrations',
    );
    const dirs = readdirSync(migrationsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()
      .filter(
        (d) =>
          (options.throughMigration === undefined ||
            d <= options.throughMigration) &&
          (options.onlyMigrations === undefined ||
            options.onlyMigrations.includes(d)),
      );
    const c = new pg.Client({ connectionString: url });
    await c.connect();
    try {
      // Same table Prisma creates, so /readyz's "latest migration applied" check sees real rows.
      await c.query(`CREATE TABLE "_prisma_migrations" (
      id VARCHAR(36) PRIMARY KEY NOT NULL, checksum VARCHAR(64) NOT NULL, finished_at TIMESTAMPTZ,
      migration_name VARCHAR(255) NOT NULL, logs TEXT, rolled_back_at TIMESTAMPTZ,
      started_at TIMESTAMPTZ NOT NULL DEFAULT now(), applied_steps_count INTEGER NOT NULL DEFAULT 0)`);
      for (const d of dirs) {
        const sql = readFileSync(
          join(migrationsDir, d, 'migration.sql'),
          'utf8',
        );
        await c.query(sql);
        await c.query(
          `INSERT INTO "_prisma_migrations" (id, checksum, finished_at, migration_name, applied_steps_count)
         VALUES ($1, $2, now(), $3, 1)`,
          [randomUUID(), createHash('sha256').update(sql).digest('hex'), d],
        );
      }
    } finally {
      await c.end();
    }

    return { url, name, drop };
  });
}
