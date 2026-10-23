import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CollectorLock,
  LockLostError,
} from '../src/collector/collector-lock.js';
import { ProbeLockError, runProbe } from '../src/cli/probe.js';
import {
  createTestDatabase,
  TEST_DATABASE_URL,
  terminateLockHolder,
} from './support/db.js';
import { PausableProxy } from './support/proxy.js';
import { freePort } from './support/net.js';
import { startReplayServer } from '../src/cli/replay-server.js';
import { recordsFor } from './support/synthetic.js';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCapture } from '../src/modbus/capture.js';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const fn of cleanup.splice(0).reverse())
    await fn().catch(() => undefined);
});

let nextKey = 910_000 + Math.floor(Math.random() * 50_000);
const fast = (url: string, key: number, extra = {}) => {
  const lock = new CollectorLock({
    databaseUrl: url,
    key,
    heartbeatMs: 100,
    leaseMs: 600,
    takeoverDelayMs: 400,
    ...extra,
  });
  cleanup.push(() => lock.stop());
  return lock;
};

describe('CollectorLock (needs dev Postgres)', () => {
  it('terminates only the selected database lock when another database holds the same key', async () => {
    const first = await createTestDatabase();
    cleanup.push(() => first.drop());
    const second = await createTestDatabase();
    cleanup.push(() => second.drop());
    const key = nextKey++;
    const a = fast(first.url, key);
    const b = fast(second.url, key);
    expect(await a.tryAcquire()).toBe(true);
    expect(await b.tryAcquire()).toBe(true);
    const lost = new Promise<string>((resolve) => a.once('lost', resolve));

    expect(await terminateLockHolder(key, first.url)).toBe(1);
    await lost;
    expect(a.isOwned()).toBe(false);
    expect(b.isOwned()).toBe(true);
    const contender = fast(second.url, key);
    expect(await contender.tryAcquire()).toBe(false);
    expect(await terminateLockHolder(key, second.url)).toBe(1);
  });

  it('is exclusive: a second instance cannot acquire until the holder stops', async () => {
    const key = nextKey++;
    const a = fast(TEST_DATABASE_URL, key);
    const b = fast(TEST_DATABASE_URL, key);
    expect(await a.tryAcquire()).toBe(true);
    expect(await b.tryAcquire()).toBe(false);
    expect(b.state).toBe('LOCK_NOT_HELD');
    await a.stop();
    expect(await b.tryAcquire()).toBe(true);
  });

  it('enforces the takeover delay before the first device request', async () => {
    const lock = fast(TEST_DATABASE_URL, nextKey++);
    await lock.tryAcquire();
    expect(lock.isOwned()).toBe(true);
    expect(() => lock.assertCanUseDevice()).toThrow(LockLostError);
    await delay(450);
    expect(() => lock.assertCanUseDevice()).not.toThrow();
  });

  it('pg_terminate_backend on the lock session: lost within one heartbeat, then re-acquire + takeover delay', async () => {
    const key = nextKey++;
    const a = fast(TEST_DATABASE_URL, key);
    await a.tryAcquire();
    await delay(450);
    const lost = new Promise<string>((r) => a.once('lost', r));
    const t0 = performance.now();
    expect(await terminateLockHolder(key)).toBe(1);
    const reason = await lost;
    const detectMs = performance.now() - t0;
    expect(detectMs).toBeLessThan(500); // one 100 ms heartbeat + slack (client 'end'/'error' fires sooner)
    expect(reason).toMatch(/client|heartbeat/);
    expect(a.isOwned()).toBe(false);
    expect(() => a.assertCanUseDevice()).toThrow(LockLostError);

    expect(await a.tryAcquire()).toBe(true); // a fresh session
    expect(() => a.assertCanUseDevice()).toThrow(/takeover/);
    await delay(450);
    expect(() => a.assertCanUseDevice()).not.toThrow();
  });

  it('paused DB traffic: ownership expires within the lease and the lingering session is disposed so the lock frees', async () => {
    const key = nextKey++;
    const url = new URL(TEST_DATABASE_URL);
    const proxy = await PausableProxy.start(url.hostname, Number(url.port));
    cleanup.push(() => proxy.stop());
    const viaProxy = new URL(TEST_DATABASE_URL);
    viaProxy.port = String(proxy.port);
    const a = fast(viaProxy.toString(), key);
    expect(await a.tryAcquire()).toBe(true);
    await delay(300);
    expect(a.isOwned()).toBe(true);

    const lost = new Promise<string>((r) => a.once('lost', r));
    const t0 = performance.now();
    proxy.paused = true;
    expect(await lost).toMatch(/lease expired|heartbeat/);
    const ms = performance.now() - t0;
    expect(ms).toBeLessThan(600 + 100 + 1000); // lease + heartbeat + watchdog granularity
    expect(a.isOwned()).toBe(false);

    // A replacement on a direct connection can take the lock once the old session is gone
    // (disposal destroys the socket; the proxy then closes the upstream session).
    const b = fast(TEST_DATABASE_URL, key);
    const deadline = Date.now() + 8000;
    let got = false;
    while (!got && Date.now() < deadline) {
      got = await b.tryAcquire();
      if (!got) await delay(250);
    }
    expect(got).toBe(true);
  });

  it('a lost listener may re-acquire synchronously: the old session is disposed before the new one connects', async () => {
    const key = nextKey++;
    const url = new URL(TEST_DATABASE_URL);
    const proxy = await PausableProxy.start(url.hostname, Number(url.port));
    cleanup.push(() => proxy.stop());
    const viaProxy = new URL(TEST_DATABASE_URL);
    viaProxy.port = String(proxy.port);
    const a = fast(viaProxy.toString(), key);
    expect(await a.tryAcquire()).toBe(true);

    const reacquired = new Promise<boolean>((resolve) => {
      a.once('lost', () => {
        proxy.paused = false; // network heals; the new session can connect
        void a.tryAcquire().then(resolve);
      });
    });
    proxy.paused = true;
    expect(await reacquired).toBe(true);
    // Disposal of session 1 (its socket closed) happened before session 2 connected.
    expect(proxy.events.slice(0, 3)).toEqual(['open:1', 'close:1', 'open:2']);
    expect(a.generation).toBeGreaterThan(1);
  });

  it('stop() while an acquisition is in flight leaves no lock-holding session behind', async () => {
    const key = nextKey++;
    const a = fast(TEST_DATABASE_URL, key);
    const acquiring = a.tryAcquire();
    await a.stop();
    expect(await acquiring).toBe(false);
    const rival = fast(TEST_DATABASE_URL, key);
    expect(await rival.tryAcquire()).toBe(true); // immediately, not after a keepalive timeout
  });

  it('probe: losing the lock mid-run kills the device connection and exits with the lock error', async () => {
    const port = await freePort();
    const server = await startReplayServer({
      records: recordsFor([{ gridW: 100 }, { gridW: 200 }]),
      port,
    });
    cleanup.push(() => server.close());
    const key = nextKey++;
    const running = runProbe({
      ...probeBase(
        join(mkdtempSync(join(tmpdir(), 'probe-')), 'cap.jsonl'),
        port,
      ),
      minutes: 1,
      intervalSec: 30, // long sleep: loss must interrupt it
      databaseUrl: TEST_DATABASE_URL,
      lock: { key, takeoverDelayMs: 0, heartbeatMs: 100 },
    });
    const outcome = running.then(
      () => 'resolved',
      (e: unknown) => e,
    );
    await delay(800);
    expect(server.stats.clients).toBe(1);
    const t0 = performance.now();
    expect(await terminateLockHolder(key)).toBe(1);
    expect(await outcome).toBeInstanceOf(ProbeLockError);
    expect(performance.now() - t0).toBeLessThan(2500);
    await delay(200);
    expect(server.stats.clients).toBe(0);
  });

  it('probe: cancelling during the (default 18 s) takeover delay is a clean exit, not a lock error', async () => {
    const ac = new AbortController();
    const running = runProbe(
      {
        ...probeBase(join(mkdtempSync(join(tmpdir(), 'probe-')), 'x.jsonl'), 1),
        databaseUrl: TEST_DATABASE_URL,
        lock: { key: nextKey++ },
      },
      ac.signal,
    );
    setTimeout(() => ac.abort(), 300);
    const t0 = performance.now();
    await expect(running).resolves.toEqual({ polls: 0 });
    expect(performance.now() - t0).toBeLessThan(3000);
  });

  it('the probe refuses to start while another session holds the default collector lock', async () => {
    const holder = new CollectorLock({ databaseUrl: TEST_DATABASE_URL });
    cleanup.push(() => holder.stop());
    expect(await holder.tryAcquire()).toBe(true);
    await expect(
      runProbe({
        ...probeBase(join(mkdtempSync(join(tmpdir(), 'probe-')), 'x.jsonl'), 1),
        databaseUrl: TEST_DATABASE_URL,
      }),
    ).rejects.toBeInstanceOf(ProbeLockError);
  });

  it('the probe holds the lock while it runs against the replay server, releases it after, and writes a replayable capture', async () => {
    const port = await freePort();
    const server = await startReplayServer({
      records: recordsFor([{ gridW: 100 }, { gridW: 200 }]),
      port,
    });
    cleanup.push(() => server.close());
    const out = join(mkdtempSync(join(tmpdir(), 'probe-')), 'cap.jsonl');
    const key = nextKey++;
    const rival = fast(TEST_DATABASE_URL, key);

    const running = runProbe({
      ...probeBase(out, port),
      minutes: 0.03,
      intervalSec: 0.3,
      databaseUrl: TEST_DATABASE_URL,
      lock: { key, takeoverDelayMs: 0, heartbeatMs: 100 },
    });
    await delay(700);
    expect(await rival.tryAcquire()).toBe(false); // probe owns it mid-run
    await running;
    expect(await rival.tryAcquire()).toBe(true); // released on exit

    const records = parseCapture(readFileSync(out, 'utf8'));
    expect(records[0]!.tier).toBe('DETECT');
    expect(
      records.filter((r) => r.tier === 'FAST').length,
    ).toBeGreaterThanOrEqual(3);
  });
});

function probeBase(out: string, port: number) {
  return {
    host: '127.0.0.1',
    port,
    unitId: 1,
    timeoutMs: 1000,
    minutes: 0.01,
    intervalSec: 1,
    slowIntervalSec: 300,
    cadence: false,
    out,
    log: () => undefined,
  };
}
