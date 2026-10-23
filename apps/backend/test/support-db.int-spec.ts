import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it, vi } from 'vitest';
import {
  createTestDatabase,
  provisionOrDrop,
  TEST_DATABASE_URL,
} from './support/db.js';

async function adminQuery<T extends pg.QueryResultRow>(
  sql: string,
): Promise<T[]> {
  const c = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await c.connect();
  try {
    return (await c.query<T>(sql)).rows;
  } finally {
    await c.end();
  }
}
const testDatabaseNames = async () =>
  (
    await adminQuery<{ datname: string }>(
      `SELECT datname FROM pg_database WHERE datname LIKE 't\\_%' ORDER BY datname`,
    )
  ).map((x) => x.datname);

describe('createTestDatabase failure cleanup', () => {
  it('drops only the database it allocated when provisioning fails, and propagates the original failure', async () => {
    // An unrelated t_* database must survive the failed provisioning's cleanup.
    const sentinel = `t_sentinel_${randomBytes(4).toString('hex')}`;
    await adminQuery(`CREATE DATABASE "${sentinel}"`);
    try {
      const before = await testDatabaseNames();
      expect(before).toContain(sentinel);
      // 0005 alone cannot apply: its EnergyInterval table comes from an earlier migration.
      await expect(
        createTestDatabase({ onlyMigrations: ['0005_soc_coverage'] }),
      ).rejects.toThrow(/EnergyInterval/);
      expect(await testDatabaseNames()).toEqual(before);
    } finally {
      await adminQuery(`DROP DATABASE IF EXISTS "${sentinel}" WITH (FORCE)`);
    }
  });

  it('drops the database it created when closing the CREATE connection fails, and propagates that failure', async () => {
    const before = await testDatabaseNames();
    // Called with an explicit `this` below.
    // oxlint-disable-next-line typescript/unbound-method
    const realEnd = pg.Client.prototype.end;
    // The first Client#end in createTestDatabase closes the admin connection right after CREATE.
    vi.spyOn(pg.Client.prototype, 'end').mockImplementationOnce(async function (
      this: pg.Client,
    ) {
      await new Promise<void>((resolve) => realEnd.call(this, () => resolve()));
      throw new Error('admin end failed');
    });
    try {
      await expect(createTestDatabase()).rejects.toThrow('admin end failed');
      expect(await testDatabaseNames()).toEqual(before);
    } finally {
      vi.restoreAllMocks();
    }
  });
});

describe('provisionOrDrop', () => {
  it('returns the result and never drops when the work succeeds', async () => {
    const drop = vi.fn().mockResolvedValue(undefined);
    await expect(
      provisionOrDrop('t_x', drop, async () => 'ready'),
    ).resolves.toBe('ready');
    expect(drop).not.toHaveBeenCalled();
  });

  it('drops once and rethrows the original error itself when the drop succeeds', async () => {
    const original = new Error('provisioning failed');
    const drop = vi.fn().mockResolvedValue(undefined);
    await expect(
      provisionOrDrop('t_x', drop, async () => {
        throw original;
      }),
    ).rejects.toBe(original);
    expect(drop).toHaveBeenCalledTimes(1);
  });

  it('reports both errors, original first, when the drop fails too', async () => {
    const original = new Error('provisioning failed');
    const cleanup = new Error('drop failed');
    const rejection = await provisionOrDrop(
      't_x',
      async () => {
        throw cleanup;
      },
      async () => {
        throw original;
      },
    ).then(
      () => undefined,
      (error: unknown) => error,
    );
    expect(rejection).toBeInstanceOf(AggregateError);
    if (!(rejection instanceof AggregateError)) return;
    expect(rejection.errors).toHaveLength(2);
    expect(rejection.errors[0]).toBe(original);
    expect(rejection.errors[1]).toBe(cleanup);
    expect(rejection.message).toContain('t_x');
  });
});
