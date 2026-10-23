import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import { LedgerService } from '../src/accounting/ledger.service.js';
import { BUCKET_MS, LedgerFlag } from '../src/accounting/types.js';
import { CollectorService } from '../src/collector/collector.service.js';
import { IngestService } from '../src/collector/ingest.service.js';
import {
  startReplayServer,
  type ReplayServer,
} from '../src/cli/replay-server.js';
import { parseEnv } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { FAST_PLAN } from '../src/modbus/read-plan.js';
import {
  createTestDatabase,
  TEST_DATABASE_URL,
  type TestDatabase,
} from './support/db.js';
import { freePort } from './support/net.js';
import {
  blocksFrom,
  plausibleImage,
  recordsFor,
  setReg,
} from './support/synthetic.js';

async function until(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 12_000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(40);
  }
  throw new Error('collector condition not reached');
}

// Ignore generated ids and computation time, but compare both energy and the state needed
// to compute later buckets. These rows are computed twice from the very same stored samples.
async function fingerprint(prisma: PrismaService) {
  const rows = await prisma.energyInterval.findMany({
    orderBy: { bucketStart: 'asc' },
  });
  return rows.map((row) => ({
    bucketStart: row.bucketStart.toISOString(),
    mappingVersion: row.mappingVersion,
    maxGapSecUsed: row.maxGapSecUsed,
    gridImportNetWh: row.gridImportNetWh?.toString() ?? null,
    gridImportCounterWh: row.gridImportCounterWh?.toString() ?? null,
    gridExportNetWh: row.gridExportNetWh?.toString() ?? null,
    pvIntWh: row.pvIntWh?.toString() ?? null,
    pvCounterWh: row.pvCounterWh?.toString() ?? null,
    gridCoveredSec: row.gridCoveredSec,
    pvCoveredSec: row.pvCoveredSec,
    counterGapAllocMask: row.counterGapAllocMask,
    counterUnknownSec: row.counterUnknownSec,
    flags: row.flags,
    counterState: row.counterState,
  }));
}

describe('V23 real collector persistence boundaries', () => {
  let db: TestDatabase;
  let prisma: PrismaService;
  let replay: ReplayServer | undefined;
  let collector: CollectorService | undefined;
  let databaseBlocked = false;

  async function allowConnections(allow: boolean): Promise<void> {
    const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    try {
      await admin.query(
        `ALTER DATABASE "${db.name}" WITH ALLOW_CONNECTIONS ${allow ? 'true' : 'false'}`,
      );
      if (!allow) {
        await admin.query(
          'SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()',
          [db.name],
        );
      }
    } finally {
      await admin.end();
    }
  }

  beforeEach(async () => {
    db = await createTestDatabase();
    prisma = new PrismaService({ DATABASE_URL: db.url });
  });
  afterEach(async () => {
    // Restore access before collector shutdown (which flushes and closes its run).
    try {
      if (databaseBlocked) await allowConnections(true);
    } finally {
      databaseBlocked = false;
      try {
        await collector?.beforeApplicationShutdown();
      } finally {
        try {
          await replay?.close();
        } finally {
          try {
            await prisma.close();
          } finally {
            await db.drop();
          }
        }
      }
    }
    collector = undefined;
    replay = undefined;
  });

  async function start(records = recordsFor([{ gridW: 1200, pvW: 1500 }])) {
    const port = await freePort();
    replay = await startReplayServer({ port, records });
    const env = parseEnv({
      DATABASE_URL: db.url,
      MODBUS_HOST: '127.0.0.1',
      MODBUS_PORT: String(port),
      MODBUS_TIMEOUT_MS: '200',
      OWNERSHIP_LEASE_SEC: '1',
      POLL_FAST_MS: '1000',
      POLL_SLOW_MS: '60000',
      POLL_SETTINGS_MS: '60000',
      DEVICE_KEY: 'v23-collector',
    });
    const ingest = new IngestService(prisma);
    collector = new CollectorService(
      prisma,
      { ingest: (polls) => ingest.ingest(polls, { maxRepeatSpanSec: 30 }) },
      env,
      { rand: () => 0.5, lockOptions: { heartbeatMs: 100 } },
    );
    await collector.onApplicationBootstrap();
    return {
      server: replay,
      service: collector,
      ledger: new LedgerService(prisma, env),
    };
  }

  it('V23(a): a real failed Sample insert buffers every FAST poll, then flushes a bounded dirty range and recomputes identically', async () => {
    // An INSERT failure rolls back the complete ingest transaction, not just Sample.
    await prisma.$executeRawUnsafe(`CREATE FUNCTION reject_v23_sample() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'transient Sample insert rejection'; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER reject_v23_sample BEFORE INSERT ON "Sample"
      FOR EACH ROW EXECUTE FUNCTION reject_v23_sample()`);
    let triggerInstalled = true;
    try {
      const { server, service, ledger } = await start();
      await until(
        () =>
          service.snapshot().state === 'RUNNING' && server.state.cycles >= 4,
        15_000,
      );
      expect(await prisma.sample.count()).toBe(0);
      expect(await prisma.rawPoll.count()).toBe(0);
      expect(server.state.cycles).toBeLessThan(360);
      // The collector keeps reading the real replay socket while PostgreSQL rejects inserts.
      const capturedWhileBlocked = server.state.cycles;
      await delay(1100);
      expect(server.state.cycles).toBeGreaterThan(capturedWhileBlocked);
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER reject_v23_sample ON "Sample"',
      );
      await prisma.$executeRawUnsafe('DROP FUNCTION reject_v23_sample()');
      triggerInstalled = false;
      await until(
        async () => (await prisma.sample.count()) >= capturedWhileBlocked + 1,
        15_000,
      );
      await service.beforeApplicationShutdown();
      const samples = await prisma.sample.findMany({
        orderBy: { observedAt: 'asc' },
      });
      const fast = await prisma.rawPoll.findMany({
        where: { tier: 'FAST' },
        orderBy: { seq: 'asc' },
      });
      expect(samples.length).toBeGreaterThanOrEqual(capturedWhileBlocked + 1);
      expect(samples.length).toBeLessThan(360);
      expect(fast).toHaveLength(samples.length);
      expect(samples.length).toBe(server.state.cycles);
      expect(
        new Set(samples.map((sample) => sample.rawPollId.toString())).size,
      ).toBe(samples.length);
      const firstBucket =
        Math.floor(samples[0]!.observedAt.getTime() / BUCKET_MS) * BUCKET_MS;
      const lastBucket =
        Math.floor(samples.at(-1)!.observedAt.getTime() / BUCKET_MS) *
        BUCKET_MS;
      const dirt = await prisma.ledgerDirtyRange.findMany();
      expect(dirt.length).toBeGreaterThan(0);
      expect(Math.min(...dirt.map((span) => span.fromBucket.getTime()))).toBe(
        firstBucket,
      );
      expect(Math.max(...dirt.map((span) => span.toBucket.getTime()))).toBe(
        lastBucket + BUCKET_MS,
      );
      for (const span of dirt) {
        expect(span.fromBucket.getTime()).toBeGreaterThanOrEqual(firstBucket);
        expect(span.toBucket.getTime()).toBeLessThanOrEqual(
          lastBucket + BUCKET_MS,
        );
        expect(span.toBucket.getTime()).toBeGreaterThan(
          span.fromBucket.getTime(),
        );
      }
      const now = new Date();
      await ledger.processOnce(now);
      const live = await fingerprint(prisma);
      expect(live.length).toBeGreaterThan(0);
      expect(
        live.some(
          (row) =>
            row.gridImportNetWh !== null && Number(row.gridImportNetWh) > 0,
        ),
      ).toBe(true);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      await prisma.energyInterval.deleteMany();
      await prisma.ledgerDirtyRange.create({
        data: {
          fromBucket: new Date(firstBucket),
          toBucket: new Date(lastBucket + BUCKET_MS),
          reason: 'RECALC_REQUEST',
        },
      });
      await ledger.processOnce(now);
      expect(await fingerprint(prisma)).toEqual(live);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    } finally {
      if (triggerInstalled) {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS reject_v23_sample ON "Sample"',
        );
        await prisma.$executeRawUnsafe(
          'DROP FUNCTION IF EXISTS reject_v23_sample()',
        );
      }
    }
  }, 45_000);

  it('V23(a2): a real database outage stops polling within the lease; missing samples reduce coverage while valid counters bridge the gap', async () => {
    const records = recordsFor(
      Array.from({ length: 64 }, () => ({ gridW: 1200, pvW: 1500 })),
    );
    let fastIndex = 0;
    for (const record of records) {
      if (record.tier !== 'FAST') continue;
      const image = plausibleImage({ gridW: 1200, pvW: 1500 });
      setReg(image, 'grid_buy_energy', 1234.5 + fastIndex++ * 0.1);
      record.blocks = blocksFrom(FAST_PLAN, image);
    }
    const { server, service, ledger } = await start(records);
    await until(
      async () =>
        service.snapshot().state === 'RUNNING' &&
        (await prisma.sample.count()) >= 3,
      15_000,
    );
    const before = await prisma.sample.findMany({
      orderBy: { observedAt: 'asc' },
    });
    const deviceId = before[0]!.deviceId;
    const stoppedFromCycle = server.state.cycles;
    let stoppedAt = stoppedFromCycle;
    let lockLostAt = new Date();
    // Unlike V23(a), this outage kills the lock session: polling MUST stop, so
    // only polls already buffered at lock loss may flush after access returns.
    databaseBlocked = true;
    try {
      await allowConnections(false);
      await until(
        () =>
          service.snapshot().state === 'LOCK_NOT_HELD' &&
          server.stats.clients === 0,
        2500,
      );
      stoppedAt = server.state.cycles;
      lockLostAt = new Date();
      expect(stoppedAt - stoppedFromCycle).toBeLessThanOrEqual(1);
      await delay(3200);
      expect(server.state.cycles).toBe(stoppedAt);
    } finally {
      await allowConnections(true);
      databaseBlocked = false;
    }
    await until(
      async () =>
        (await prisma.dataQualityEvent.count({
          where: { deviceId, kind: 'DB_UNAVAILABLE' },
        })) > 0,
      10_000,
    );
    const flushedBeforeReconnect = await prisma.sample.findMany({
      where: { deviceId },
    });
    expect(server.state.cycles).toBe(stoppedAt);
    expect(flushedBeforeReconnect.length).toBeLessThanOrEqual(stoppedAt);
    expect(
      flushedBeforeReconnect.every((row) => row.observedAt <= lockLostAt),
    ).toBe(true);
    // Lock loss uses the production 30s acquisition backoff, then its short takeover delay.
    await until(
      async () =>
        service.snapshot().state === 'RUNNING' &&
        (await prisma.sample.count({ where: { deviceId } })) >=
          before.length + 2,
      48_000,
    );
    await service.beforeApplicationShutdown();
    const samples = await prisma.sample.findMany({
      where: { deviceId },
      orderBy: { observedAt: 'asc' },
    });
    const gaps = samples.slice(1).map((sample, i) => ({
      from: samples[i]!,
      to: sample,
      seconds:
        (sample.observedAt.getTime() - samples[i]!.observedAt.getTime()) / 1000,
    }));
    const missing = gaps.find((gap) => gap.seconds > 30);
    expect(missing).toBeDefined();
    expect(missing!.from.gridBuyWh).not.toBeNull();
    expect(missing!.to.gridBuyWh).not.toBeNull();
    expect(
      Number(missing!.to.gridBuyWh) - Number(missing!.from.gridBuyWh),
    ).toBe(100);
    await ledger.processOnce(new Date());
    const rows = await prisma.energyInterval.findMany({
      orderBy: { bucketStart: 'asc' },
    });
    const bridged = rows.filter(
      (row) =>
        (row.bucketStart.getTime() <= missing!.from.observedAt.getTime() &&
          row.bucketStart.getTime() + BUCKET_MS >
            missing!.from.observedAt.getTime()) ||
        (row.bucketStart.getTime() > missing!.from.observedAt.getTime() &&
          row.bucketStart.getTime() < missing!.to.observedAt.getTime()),
    );
    expect(bridged.length).toBeGreaterThan(0);
    expect(
      bridged.some(
        (row) =>
          (row.flags & LedgerFlag.GRID_GAP) !== 0 &&
          (row.flags & LedgerFlag.COUNTER_GAP_ALLOCATED) !== 0 &&
          (row.counterGapAllocMask & 2) !== 0 &&
          row.gridCoveredSec < 300 &&
          row.gridImportCounterWh !== null &&
          Number(row.gridImportCounterWh) > 0,
      ),
    ).toBe(true);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  }, 85_000);
});
