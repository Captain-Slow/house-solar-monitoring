import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { PrismaService } from '../src/db/prisma.service.js';
import { RetentionService } from '../src/collector/retention.service.js';
import { ensureMappingV1 } from '../src/collector/mapping.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

let db: TestDatabase;
let prisma: PrismaService;
let retention: RetentionService;
let runId: number;
let deviceId: number;
const now = new Date('2026-06-01T12:00:00.000Z');
const old = new Date('2026-01-01T12:00:00.000Z');
let seq = 0;

async function insertSample(at: Date) {
  const raw = await prisma.rawPoll.create({
    data: {
      runId,
      seq: ++seq,
      deviceId,
      tier: 'FAST',
      requestedAt: at,
      receivedAt: at,
      observedAt: at,
      blocks: Buffer.alloc(0),
      contentHash: Buffer.alloc(32),
    },
  });
  await prisma.sample.create({
    data: {
      rawPollId: raw.id,
      deviceId,
      observedAt: at,
      mappingVersion: 1,
      pvStringW: [],
      gridBuyPhaseWh: [],
      gridSellPhaseWh: [],
      meterRepeatSec: 0,
      flags: 0,
    },
  });
  return raw.id;
}

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = new PrismaService({ DATABASE_URL: db.url });
  retention = new RetentionService(prisma);
  const source = await prisma.dataSource.create({
    data: { kind: 'MODBUS_TCP', endpoint: 'retention:1502#1' },
  });
  deviceId = (
    await prisma.device.create({
      data: {
        dataSourceId: source.id,
        deviceKey: 'retention',
        role: 'INVERTER',
        model: 'HIT-10L-G3',
        observedCapabilities: {},
        firmware: {},
        capabilitiesObservedAt: old,
        firstSeenAt: old,
        lastSeenAt: old,
      },
    })
  ).id;
  runId = (
    await prisma.collectorRun.create({
      data: { startedAt: old, appVersion: 'test', registerMapVersion: 'test' },
    })
  ).id;
  await ensureMappingV1(prisma);
});
afterAll(async () => {
  retention?.stop();
  await prisma?.close();
  await db?.drop();
});

describe('RetentionService', () => {
  it('deletes expired rows in 10,000-row batches while preserving referenced newer samples', async () => {
    await prisma.$executeRaw`
      INSERT INTO "RawPoll" ("runId", "seq", "deviceId", "tier", "requestedAt", "receivedAt",
        "observedAt", "blocks", "contentHash")
      SELECT ${runId}, n + 1000, ${deviceId}, 'FAST'::"PollTier", ${old}, ${old}, ${old},
        decode('', 'hex'), decode('00', 'hex') FROM generate_series(1, 10001) n`;
    const recent = new Date('2026-05-31T12:00:00.000Z');
    const recentRawId = await insertSample(recent);
    const result = await retention.runOnce(now, {
      RAW_RETENTION_DAYS: 30,
      SAMPLE_RETENTION_DAYS: 30,
    });
    expect(result).toEqual({ deletedSamples: 0, deletedRawPolls: 10001 });
    expect(await prisma.rawPoll.count()).toBe(1);
    expect((await prisma.sample.findFirstOrThrow()).rawPollId).toBe(
      recentRawId,
    );
  });

  it('keeps samples and raw polls exactly at or after pending dirty boundary, then deletes after consumption', async () => {
    const protectedAt = new Date('2026-01-10T12:00:00.000Z');
    const beforeAt = new Date('2026-01-10T11:59:59.999Z');
    const beforeId = await insertSample(beforeAt);
    const protectedId = await insertSample(protectedAt);
    const dirty = await prisma.ledgerDirtyRange.create({
      data: {
        fromBucket: protectedAt,
        toBucket: new Date('2026-01-10T12:05:00.000Z'),
        reason: 'INGEST',
      },
    });
    const first = await retention.runOnce(now, {
      RAW_RETENTION_DAYS: 30,
      SAMPLE_RETENTION_DAYS: 30,
    });
    expect(first).toEqual({ deletedSamples: 1, deletedRawPolls: 1 });
    expect(
      await prisma.rawPoll.findUnique({ where: { id: beforeId } }),
    ).toBeNull();
    expect(
      await prisma.sample.findUnique({ where: { rawPollId: protectedId } }),
    ).not.toBeNull();
    await prisma.ledgerDirtyRange.delete({ where: { id: dirty.id } });
    const second = await retention.runOnce(now, {
      RAW_RETENTION_DAYS: 30,
      SAMPLE_RETENTION_DAYS: 30,
    });
    expect(second).toEqual({ deletedSamples: 1, deletedRawPolls: 1 });
    expect(
      await prisma.rawPoll.findUnique({ where: { id: protectedId } }),
    ).toBeNull();
  });

  it('never deletes samples inside a RUNNING RENORMALIZE window, and defers pruning while a replay holds the reservation', async () => {
    const env = { RAW_RETENTION_DAYS: 400, SAMPLE_RETENTION_DAYS: 30 };
    const inWindow = new Date('2026-01-20T12:00:00.000Z');
    const outside = new Date('2026-01-21T12:00:00.000Z');
    const windowRaw = await insertSample(inWindow);
    const outsideRaw = await insertSample(outside);
    const run = await prisma.calculationRun.create({
      data: {
        kind: 'RENORMALIZE',
        reason: 'window',
        rangeStart: new Date('2026-01-20T00:00:00.000Z'),
        rangeEnd: new Date('2026-01-21T00:00:00.000Z'),
        calcVersion: 3,
        mappingVersion: 1,
        startedAt: now,
        status: 'RUNNING',
      },
    });
    expect(await retention.runOnce(now, env)).toMatchObject({
      deletedSamples: 1,
    });
    expect(
      await prisma.sample.findUnique({ where: { rawPollId: windowRaw } }),
    ).not.toBeNull();
    expect(
      await prisma.sample.findUnique({ where: { rawPollId: outsideRaw } }),
    ).toBeNull();

    // A replay that still holds the reservation has not committed its run yet: pruning defers
    // (it neither blocks nor deletes), and a later run prunes once the reservation is free.
    await prisma.calculationRun.update({
      where: { id: run.id },
      data: { status: 'DONE', finishedAt: now },
    });
    const holder = new pg.Client({ connectionString: db.url });
    await holder.connect();
    try {
      await holder.query('SELECT pg_advisory_lock(716071, 7)');
      const started = Date.now();
      expect(await retention.runOnce(now, env)).toMatchObject({
        deletedSamples: 0,
      });
      expect(Date.now() - started).toBeLessThan(4000);
      expect(
        await prisma.sample.findUnique({ where: { rawPollId: windowRaw } }),
      ).not.toBeNull();
      await holder.query('SELECT pg_advisory_unlock(716071, 7)');
      expect(await retention.runOnce(now, env)).toMatchObject({
        deletedSamples: 1,
      });
    } finally {
      await holder.end();
    }
  });

  it('returns to 03:00 local after a spring-forward day with no 03:00', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-28T01:30:00.000Z')); // 03:30 EET
    const scheduled = new RetentionService(prisma);
    const run = vi.spyOn(scheduled, 'runOnce').mockResolvedValue({
      deletedSamples: 0,
      deletedRawPolls: 0,
    });
    try {
      scheduled.start({
        SITE_TIMEZONE: 'Europe/Helsinki',
        RAW_RETENTION_DAYS: 400,
        SAMPLE_RETENTION_DAYS: 400,
      });
      await vi.advanceTimersByTimeAsync(46.5 * 60 * 60 * 1000);
      expect(run.mock.calls.map(([date]) => date.toISOString())).toEqual([
        '2026-03-29T01:00:00.000Z', // 04:00 EEST, first valid time after the missing 03:00
        '2026-03-30T00:00:00.000Z', // 03:00 EEST, not the previous day's normalized 04:00
      ]);
    } finally {
      scheduled.stop();
      run.mockRestore();
      vi.useRealTimers();
    }
  });
});
