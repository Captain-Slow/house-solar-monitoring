import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { buildDatabaseUrl } from '../config/database-url.js';
import { PrismaClient } from '../generated/prisma/client.js';

/** Pool settings from plan Phase 2.1; pg has no default connect timeout, so it is explicit. */
export function createPool(
  env: Readonly<Record<string, string | undefined>>,
): pg.Pool {
  const pool = new pg.Pool({
    connectionString: buildDatabaseUrl(env),
    max: 10,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 30_000,
  });
  // An idle pooled client that dies (PostgreSQL restart) emits 'error' on the pool; without a
  // listener that is an uncaught exception and the process exits instead of surviving the outage.
  // The message is not logged: pg errors can echo connection details.
  pool.on('error', () => undefined);
  return pool;
}

/**
 * The single Prisma client of the process (driver adapter over a bounded pg.Pool).
 *
 * The pool is closed in `onApplicationShutdown`, which Nest runs AFTER every
 * `beforeApplicationShutdown` hook: the collector must still be able to drain its buffer and
 * close its CollectorRun during shutdown (`onModuleDestroy` would run before it).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnApplicationShutdown
{
  readonly pool: pg.Pool;

  constructor(env: Readonly<Record<string, string | undefined>> = process.env) {
    const pool = createPool(env);
    super({ adapter: new PrismaPg(pool) });
    this.pool = pool;
  }

  /** Disconnects the client and ends the pool. CLIs and tests call this directly. */
  async close(): Promise<void> {
    await this.$disconnect();
    await this.pool.end().catch(() => undefined);
  }

  onApplicationShutdown(): Promise<void> {
    return this.close();
  }
}
