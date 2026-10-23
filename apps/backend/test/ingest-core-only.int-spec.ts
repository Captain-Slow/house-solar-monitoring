import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IngestService } from '../src/collector/ingest.service.js';
import {
  DEFAULT_MAPPING_V1,
  ensureMappingV1,
} from '../src/collector/mapping.js';
import {
  initialRepeatState,
  normalizeFast,
} from '../src/collector/normalize.js';
import type { IngestPoll } from '../src/collector/types.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { encodeBlocks } from '../src/modbus/raw-poll-codec.js';
import { FAST_PLAN } from '../src/modbus/read-plan.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import { blocksFrom, plausibleImage } from './support/synthetic.js';

/**
 * V23(g): Phase 2 ships before the accounting tables exist. Ingest must run without the 0002/0003
 * accounting and tariff tables and write ledger dirty ranges (consumed later by the Phase 4
 * worker) without error. `0004_raw_poll_monotonic` extends the core RawPoll table that ingest
 * writes, so it is part of the core schema here.
 */
const BASE = Date.UTC(2026, 4, 1, 0, 0);
const at = (seconds: number) => new Date(BASE + seconds * 1000);

let db: TestDatabase;
let prisma: PrismaService;
let ingest: IngestService;
let deviceId: number;
let runId: number;
let seq = 0;

function polls(
  seconds: number[],
  options: { gridW?: number; vary?: boolean } = {},
): IngestPoll[] {
  let state = initialRepeatState();
  return seconds.map((second) => {
    const blocks = blocksFrom(
      FAST_PLAN,
      plausibleImage({
        gridW:
          (options.gridW ?? 1000) + (options.vary === false ? 0 : second % 7),
        pvW: 0,
      }),
    );
    const observedAt = at(second);
    const result = normalizeFast({
      blocks,
      observedAt,
      monotonicMs: second * 1000,
      mapping: { ...DEFAULT_MAPPING_V1, maxRepeatSpanSec: 30 },
      mappingVersion: 1,
      state,
    });
    state = result.state;
    return {
      runId,
      seq: ++seq,
      deviceId,
      tier: 'FAST' as const,
      requestedAt: observedAt,
      receivedAt: observedAt,
      observedAt,
      blocks: encodeBlocks(blocks),
      sample: result.sample,
      events: result.events,
    };
  });
}

beforeAll(async () => {
  db = await createTestDatabase({
    onlyMigrations: ['0001_core', '0004_raw_poll_monotonic'],
  });
  prisma = new PrismaService({ DATABASE_URL: db.url });
  ingest = new IngestService(prisma);
  await ensureMappingV1(prisma);
  const source = await prisma.dataSource.create({
    data: { kind: 'MODBUS_TCP', endpoint: 'core-only:502#1' },
  });
  deviceId = (
    await prisma.device.create({
      data: {
        dataSourceId: source.id,
        deviceKey: 'core-only',
        role: 'INVERTER',
        model: 'synthetic',
        observedCapabilities: {},
        firmware: {},
        capabilitiesObservedAt: at(0),
        firstSeenAt: at(0),
        lastSeenAt: at(0),
      },
    })
  ).id;
  runId = (
    await prisma.collectorRun.create({
      data: {
        startedAt: at(0),
        appVersion: 'test',
        registerMapVersion: 'test',
      },
    })
  ).id;
}, 60_000);

afterAll(async () => {
  await prisma?.close();
  await db?.drop();
});

describe('V23(g): ingest without the accounting and tariff migrations', () => {
  it('the accounting tables really do not exist in this database', async () => {
    const rows = await prisma.$queryRaw<
      { t: string | null }[]
    >`SELECT to_regclass('"EnergyInterval"')::text AS t`;
    expect(rows[0]?.t).toBeNull();
    const migrations = await prisma.$queryRaw<
      { migration_name: string }[]
    >`SELECT migration_name FROM "_prisma_migrations"`;
    expect(migrations.map((m) => m.migration_name)).toEqual([
      '0001_core',
      '0004_raw_poll_monotonic',
    ]);
  });

  it('writes samples and INGEST dirty ranges for new, late and retroactively stale data without error', async () => {
    const first = await ingest.ingest(polls([0, 10, 20, 600, 610]), {
      maxRepeatSpanSec: 30,
    });
    expect(first.insertedSamples).toBe(5);
    expect(await prisma.ledgerDirtyRange.count()).toBeGreaterThan(0);
    const before = await prisma.ledgerDirtyRange.count();

    // a late sample between two stored ones dirties the interval it can change
    const late = await ingest.ingest(polls([300]), { maxRepeatSpanSec: 30 });
    expect(late.insertedSamples).toBe(1);
    const ranges = await prisma.ledgerDirtyRange.findMany({
      orderBy: { id: 'asc' },
    });
    expect(ranges.length).toBeGreaterThan(before);
    const lateRange = ranges[ranges.length - 1]!;
    expect(lateRange.reason).toBe('INGEST');
    expect(lateRange.fromBucket.getTime()).toBeLessThanOrEqual(BASE + 20_000);
    expect(lateRange.toBucket.getTime()).toBeGreaterThanOrEqual(BASE + 600_000);

    // identical meter words (constant power) for 50 s exceed maxRepeatSpanSec 30: the whole run
    // becomes METER_STALE retroactively and is dirtied in the same transaction
    const dirtyBefore = await prisma.ledgerDirtyRange.count();
    await ingest.ingest(
      polls([900, 910, 920, 930, 940, 950], { gridW: 1234, vary: false }),
      {
        maxRepeatSpanSec: 30,
      },
    );
    const flagged = await prisma.sample.count({
      where: { observedAt: { gte: at(900), lte: at(950) } },
    });
    expect(flagged).toBe(6);
    const staleRows = await prisma.$queryRaw<{ n: bigint }[]>`
      SELECT count(*) AS n FROM "Sample" WHERE "observedAt" BETWEEN ${at(900)} AND ${at(950)} AND ("flags" & 4) <> 0`;
    expect(Number(staleRows[0]!.n)).toBeGreaterThanOrEqual(5);
    expect(await prisma.ledgerDirtyRange.count()).toBeGreaterThan(dirtyBefore);
    expect(await prisma.sample.count()).toBe(12);
  });
});
