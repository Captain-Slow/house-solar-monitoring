import { EventEmitter } from 'node:events';
import type { Socket } from 'node:net';
import { performance } from 'node:perf_hooks';
import pg from 'pg';

export const ADVISORY_LOCK_KEY = 727001;

export type LockState = 'HELD' | 'LOCK_NOT_HELD';

export class LockLostError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LockLostError';
  }
}

export interface CollectorLockOptions {
  databaseUrl: string;
  /** Lock key; default 727001. */
  key?: number;
  /** Heartbeat `SELECT 1` interval; default 5 s. */
  heartbeatMs?: number;
  /** Ownership is valid only while a heartbeat succeeded within this window; default 15 s. */
  leaseMs?: number;
  /** After acquiring, no device request until this long has elapsed; default lease + 3 s Modbus timeout. */
  takeoverDelayMs?: number;
  /** Monotonic clock in ms (injectable for tests). */
  clock?: () => number;
  log?: (msg: string) => void;
}

/**
 * Fail-closed ownership of the single device connection, as a lease on a dedicated PostgreSQL
 * session holding session-level advisory lock 727001.
 *
 * Ownership is valid only while the lock session is alive AND a heartbeat has succeeded
 * within `leaseMs`. Every device request must be preceded by {@link assertCanUseDevice}.
 * On client error/end, failed heartbeat or expired lease the lock emits `lost`; the owner must
 * stop issuing requests and close its Modbus socket. The old session is disposed (listeners
 * removed, `end()` with a 2 s timeout, socket destroyed) before another is created, and every
 * callback is tagged with a generation id so late events from a dead session are ignored.
 */
export class CollectorLock extends EventEmitter {
  readonly #url: string;
  readonly #key: number;
  readonly #heartbeatMs: number;
  readonly #leaseMs: number;
  readonly #takeoverDelayMs: number;
  readonly #now: () => number;
  readonly #log: (msg: string) => void;

  #state: LockState = 'LOCK_NOT_HELD';
  #gen = 0;
  #client: pg.Client | undefined;
  #lastHeartbeatOk = Number.NEGATIVE_INFINITY;
  #usableAt = Number.POSITIVE_INFINITY;
  #heartbeatTimer: NodeJS.Timeout | undefined;
  #watchdogTimer: NodeJS.Timeout | undefined;
  #heartbeatInFlight = false;
  #inflight: Promise<boolean> | undefined;
  #disposal: Promise<void> = Promise.resolve();
  #stopped = false;

  constructor(opts: CollectorLockOptions) {
    super();
    this.#url = opts.databaseUrl;
    this.#key = opts.key ?? ADVISORY_LOCK_KEY;
    this.#heartbeatMs = opts.heartbeatMs ?? 5000;
    this.#leaseMs = opts.leaseMs ?? 15_000;
    this.#takeoverDelayMs = opts.takeoverDelayMs ?? this.#leaseMs + 3000;
    this.#now = opts.clock ?? (() => performance.now());
    this.#log = opts.log ?? (() => undefined);
  }

  get state(): LockState {
    return this.#state;
  }

  get generation(): number {
    return this.#gen;
  }

  /** Lock session alive and a heartbeat succeeded within the lease. */
  isOwned(): boolean {
    return (
      this.#state === 'HELD' &&
      this.#now() - this.#lastHeartbeatOk <= this.#leaseMs
    );
  }

  /** Milliseconds until the takeover delay has elapsed (0 when usable; Infinity when not held). */
  msUntilUsable(): number {
    if (!this.isOwned()) return Number.POSITIVE_INFINITY;
    return Math.max(0, this.#usableAt - this.#now());
  }

  /** Throws unless this process may talk to the device right now. Call before EVERY request. */
  assertCanUseDevice(): void {
    if (!this.isOwned())
      throw new LockLostError('collector lock not held or lease expired');
    if (this.#now() < this.#usableAt)
      throw new LockLostError('takeover delay not yet elapsed');
  }

  /**
   * One acquisition attempt on a fresh session. Returns true when the lock is held afterwards.
   * Waits for the disposal of a lost session first, so a replacement session is never created
   * while the old one may still hold the advisory lock.
   */
  tryAcquire(): Promise<boolean> {
    if (this.#stopped) return Promise.resolve(false);
    if (this.#state === 'HELD') return Promise.resolve(true);
    if (this.#inflight !== undefined) return Promise.resolve(false);
    const run = this.#acquire().finally(() => {
      this.#inflight = undefined;
    });
    this.#inflight = run;
    return run;
  }

  async #acquire(): Promise<boolean> {
    await this.#disposal;
    if (this.#stopped) return false;
    const gen = ++this.#gen;
    const client = new pg.Client({
      connectionString: this.#url,
      keepAlive: true,
      connectionTimeoutMillis: 5000,
      query_timeout: 3000,
    });
    client.on('error', (e) =>
      this.#onClientGone(gen, `client error: ${e.message}`),
    );
    client.on('end', () => this.#onClientGone(gen, 'client end'));
    try {
      await client.connect();
      const r = await client.query<{ ok: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS ok',
        [this.#key],
      );
      if (r.rows[0]?.ok !== true || gen !== this.#gen || this.#stopped) {
        await disposeClient(client);
        return false;
      }
    } catch (e) {
      this.#log(
        `lock acquire failed: ${e instanceof Error ? e.message : String(e)}`,
      );
      await disposeClient(client);
      return false;
    }
    this.#client = client;
    this.#state = 'HELD';
    this.#lastHeartbeatOk = this.#now();
    this.#usableAt = this.#lastHeartbeatOk + this.#takeoverDelayMs;
    this.#heartbeatTimer = setInterval(
      () => void this.#heartbeat(gen, client),
      this.#heartbeatMs,
    );
    this.#watchdogTimer = setInterval(
      () => {
        if (
          this.#gen === gen &&
          this.#state === 'HELD' &&
          this.#now() - this.#lastHeartbeatOk > this.#leaseMs
        ) {
          this.#lose('lease expired');
        }
      },
      Math.min(1000, this.#heartbeatMs),
    );
    this.emit('acquired');
    return true;
  }

  /** Releases the lock (best effort) and disposes the session. The instance cannot be reused. */
  async stop(): Promise<void> {
    // Revoke ownership synchronously, before the first await.
    this.#stopped = true;
    this.#gen++;
    this.#clearTimers();
    const client = this.#client;
    this.#client = undefined;
    this.#state = 'LOCK_NOT_HELD';
    // An acquisition in flight sees `stopped` and disposes its own session; wait for that and
    // for any lost session still being disposed, so nothing outlives stop().
    await this.#inflight?.catch(() => undefined);
    await this.#disposal;
    if (client !== undefined) {
      // Bounded by the session's query_timeout (3 s); a failed unlock is harmless because
      // disposing the session releases the lock anyway.
      await client
        .query('SELECT pg_advisory_unlock($1)', [this.#key])
        .catch(() => undefined);
      await disposeClient(client);
    }
  }

  async #heartbeat(gen: number, client: pg.Client): Promise<void> {
    if (this.#heartbeatInFlight || gen !== this.#gen) return;
    this.#heartbeatInFlight = true;
    try {
      await client.query('SELECT 1');
      if (gen === this.#gen) this.#lastHeartbeatOk = this.#now();
    } catch (e) {
      if (gen === this.#gen)
        this.#lose(
          `heartbeat failed: ${e instanceof Error ? e.message : String(e)}`,
        );
    } finally {
      this.#heartbeatInFlight = false;
    }
  }

  #onClientGone(gen: number, reason: string): void {
    if (gen !== this.#gen || this.#state !== 'HELD') return;
    this.#lose(reason);
  }

  #lose(reason: string): void {
    if (this.#state !== 'HELD') return;
    const client = this.#client;
    this.#state = 'LOCK_NOT_HELD';
    this.#client = undefined;
    this.#gen++; // callbacks of the old session are now ignored
    this.#clearTimers();
    this.#log(`lock lost: ${reason}`);
    // Publish the disposal BEFORE notifying listeners: a listener that re-acquires
    // synchronously must wait for the old session to be gone.
    if (client !== undefined) this.#disposal = disposeClient(client);
    this.emit('lost', reason);
  }

  #clearTimers(): void {
    clearInterval(this.#heartbeatTimer);
    clearInterval(this.#watchdogTimer);
    this.#heartbeatTimer = undefined;
    this.#watchdogTimer = undefined;
  }
}

/** Remove listeners, `end()` with a 2 s timeout, then destroy the socket. Never throws. */
export async function disposeClient(client: pg.Client): Promise<void> {
  client.removeAllListeners();
  client.on('error', () => undefined); // a late socket error must not become an unhandled event
  // pg exposes no public socket accessor; `connection.stream` is where it keeps the net.Socket.
  const internals = client as unknown as { connection?: { stream?: Socket } };
  const stream = internals.connection?.stream;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      client.end().catch(() => undefined),
      new Promise<void>((r) => {
        timer = setTimeout(r, 2000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    stream?.destroy();
  }
}
