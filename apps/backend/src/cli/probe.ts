import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  CollectorLock,
  LockLostError,
  type CollectorLockOptions,
} from '../collector/collector-lock.js';
import { buildDatabaseUrl } from '../config/database-url.js';
import { recordFromPoll, type CaptureRecord } from '../modbus/capture.js';
import {
  HoymilesG3,
  type DetectedInfo,
  type RawPoll,
} from '../modbus/hoymiles-g3.js';
import { CADENCE_BLOCK } from '../modbus/read-plan.js';
import {
  ReadonlyModbusClient,
  type RegisterReader,
} from '../modbus/readonly-modbus-client.js';
import { isMain } from './is-main.js';

export const EXIT_LOCK = 3;

export interface ProbeOptions {
  host: string;
  port: number;
  unitId: number;
  timeoutMs: number;
  minutes: number;
  intervalSec: number;
  slowIntervalSec: number;
  cadence: boolean;
  out: string;
  /** Present only when DATABASE_URL is set: probe then holds advisory lock 727001. */
  databaseUrl?: string;
  /** Overrides for the lock (tests shorten the lease/takeover timings and use a private key). */
  lock?: Partial<CollectorLockOptions>;
  log?: (line: string) => void;
}

export const CADENCE_INTERVAL_SEC = 2;
export const CADENCE_MINUTES = 10;
const RECONNECT_BACKOFF_SEC = [5, 10, 20, 40] as const;

export class ProbeLockError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProbeLockError';
  }
}

/**
 * Read-only probe. Runs detect, then FAST every `intervalSec`, SLOW every `slowIntervalSec`,
 * SETTINGS once; or with `cadence` only the (1800,123) block every 2 s for 10 min. One JSONL
 * line per poll. Resolves when the time is up; throws {@link ProbeLockError} when the
 * collector lock is held elsewhere or lost.
 */
export async function runProbe(
  opts: ProbeOptions,
  signal?: AbortSignal,
): Promise<{ polls: number }> {
  const log =
    opts.log ??
    ((l: string) => console.log(`${new Date().toISOString()} ${l}`));
  mkdirSync(dirname(opts.out), { recursive: true });
  writeFileSync(opts.out, '');
  const write = (rec: CaptureRecord): void =>
    appendFileSync(opts.out, `${JSON.stringify(rec)}\n`);

  // Aborted by the caller's signal or by loss of lock ownership; interrupts every wait.
  const stop = new AbortController();
  if (signal?.aborted === true) stop.abort();
  signal?.addEventListener('abort', () => stop.abort(), { once: true });
  const wait = (ms: number): Promise<void> =>
    delay(ms, undefined, { signal: stop.signal }).catch(() => undefined);

  const client = new ReadonlyModbusClient({
    host: opts.host,
    port: opts.port,
    unitId: opts.unitId,
    timeoutMs: opts.timeoutMs,
  });

  let lock: CollectorLock | undefined;
  let lostReason: string | undefined;
  /** Throws unless this process may talk to the device right now. */
  const guard = (): void => {
    if (lostReason !== undefined)
      throw new ProbeLockError(`collector lock lost: ${lostReason}`);
    try {
      lock?.assertCanUseDevice();
    } catch (e) {
      if (e instanceof LockLostError) throw new ProbeLockError(e.message);
      throw e;
    }
  };
  // The ownership check sits at the request boundary: no read (or retry) is issued after loss.
  const guarded: RegisterReader = {
    readInput: (addr, len) => {
      guard();
      return client.readInput(addr, len);
    },
    readHolding: (addr, len) => {
      guard();
      return client.readHolding(addr, len);
    },
  };

  if (opts.databaseUrl !== undefined) {
    lock = new CollectorLock({
      log,
      ...opts.lock,
      databaseUrl: opts.databaseUrl,
    });
    lock.on('lost', (reason: string) => {
      lostReason = reason;
      stop.abort();
      void client.close(); // kill the device socket now, do not wait for the next tick
    });
    if (!(await lock.tryAcquire())) {
      await lock.stop();
      throw new ProbeLockError(
        'collector advisory lock 727001 is held by another session',
      );
    }
    const ms = lock.msUntilUsable();
    log(
      `lock held; waiting ${Math.round(ms / 1000)} s takeover delay before the first device request`,
    );
    await wait(ms);
  }

  const g3 = new HoymilesG3(guarded);
  const total = opts.cadence ? CADENCE_MINUTES : opts.minutes;
  const intervalMs =
    (opts.cadence ? CADENCE_INTERVAL_SEC : opts.intervalSec) * 1000;
  const deadline = Date.now() + total * 60_000;
  let polls = 0;
  let connected = false;
  let failures = 0;

  try {
    let nextSlow = 0;
    let tick = Date.now();
    while (Date.now() < deadline && !stop.signal.aborted) {
      guard();
      try {
        if (!connected) {
          await client.connect();
          connected = true;
          if (!opts.cadence) {
            await detectAndRecord(g3, write, log);
            const settings = await g3.readTier('SETTINGS');
            write(recordFromPoll(settings));
            log(
              `SETTINGS recorded (${okBlocks(settings)}/${settings.blocks.length} blocks)`,
            );
          }
          failures = 0;
        }
        let poll: RawPoll;
        if (opts.cadence) {
          const requestedAt = new Date();
          const { transport, ...block } = await g3.readBlock(CADENCE_BLOCK);
          poll = {
            tier: 'FAST',
            requestedAt,
            receivedAt: new Date(),
            blocks: [block],
            ...(transport === true && block.error !== undefined
              ? { transportError: block.error }
              : {}),
          };
        } else {
          poll = await g3.readTier('FAST');
        }
        write(recordFromPoll(poll));
        polls++;
        if (poll.transportError !== undefined)
          throw new Error(poll.transportError);
        if (!opts.cadence && Date.now() >= nextSlow) {
          const slow = await g3.readTier('SLOW');
          write(recordFromPoll(slow));
          nextSlow = Date.now() + opts.slowIntervalSec * 1000;
          if (slow.transportError !== undefined)
            throw new Error(slow.transportError);
        }
        if (polls % 30 === 0) log(`${polls} FAST polls written`);
      } catch (e) {
        if (e instanceof ProbeLockError) throw e;
        log(`poll failed: ${e instanceof Error ? e.message : String(e)}`);
        connected = false;
        await client.close().catch(() => undefined);
        const backoff =
          RECONNECT_BACKOFF_SEC[
            Math.min(failures++, RECONNECT_BACKOFF_SEC.length - 1)
          ]!;
        await wait(backoff * 1000);
        tick = Date.now();
        continue;
      }
      // Fixed-rate schedule that skips missed ticks instead of bursting.
      tick += intervalMs;
      const now = Date.now();
      if (tick <= now) tick = now + intervalMs - ((now - tick) % intervalMs);
      await wait(Math.max(0, tick - now));
    }
    // A loss during the final wait is an error, not a clean exit. Cancellation during the
    // takeover delay is not a loss, so only ownership itself is checked here.
    if (lostReason !== undefined || (lock !== undefined && !lock.isOwned())) {
      throw new ProbeLockError(
        `collector lock lost: ${lostReason ?? 'lease expired'}`,
      );
    }
  } finally {
    await client.close().catch(() => undefined);
    await lock?.stop();
  }
  log(`done: ${polls} polls -> ${opts.out}`);
  return { polls };
}

function okBlocks(p: RawPoll): number {
  return p.blocks.filter((b) => b.words !== null).length;
}

async function detectAndRecord(
  g3: HoymilesG3,
  write: (r: CaptureRecord) => void,
  log: (l: string) => void,
): Promise<DetectedInfo> {
  const info = await g3.detect();
  write(recordFromPoll(info.raw));
  log(
    `detect: model=${info.model} powerDspVer=${info.firmware.powerDspVersion} ` +
      `hasBattery=${info.observed.hasBattery} hasGridMeter=${info.observed.hasGridMeter} ` +
      `mppt=${info.observed.mpptCount} capacityKwh=${info.observed.batteryCapacityKwh}`,
  );
  return info;
}

export function parseProbeArgs(
  argv: string[],
  env: NodeJS.ProcessEnv,
): ProbeOptions {
  const { values } = parseArgs({
    args: argv,
    options: {
      host: { type: 'string' },
      port: { type: 'string', default: '502' },
      unit: { type: 'string', default: '1' },
      minutes: { type: 'string', default: '120' },
      interval: { type: 'string', default: '10' },
      cadence: { type: 'boolean', default: false },
      out: { type: 'string' },
    },
  });
  if (values.host === undefined || values.out === undefined) {
    throw new Error(
      'usage: probe --host <ip> [--port 502] [--unit 1] [--minutes 120] [--interval 10] [--cadence] --out captures/local/<ts>.jsonl',
    );
  }
  const num = (name: string, v: string, min: number): number => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min)
      throw new Error(`--${name} must be a number >= ${min}`);
    return n;
  };
  const opts: ProbeOptions = {
    host: values.host,
    port: num('port', values.port, 1),
    unitId: num('unit', values.unit, 0),
    timeoutMs: 3000,
    minutes: num('minutes', values.minutes, 0.01),
    intervalSec: num('interval', values.interval, 1),
    slowIntervalSec: 300,
    cadence: values.cadence,
    out: values.out,
  };
  if (env.DATABASE_URL !== undefined && env.DATABASE_URL !== '')
    opts.databaseUrl = buildDatabaseUrl(env);
  return opts;
}

if (isMain(import.meta.url)) {
  const ac = new AbortController();
  process.on('SIGINT', () => ac.abort());
  process.on('SIGTERM', () => ac.abort());
  try {
    await runProbe(
      parseProbeArgs(process.argv.slice(2), process.env),
      ac.signal,
    );
  } catch (e) {
    console.error(e instanceof Error ? e.message : e);
    process.exit(e instanceof ProbeLockError ? EXIT_LOCK : 1);
  }
}
