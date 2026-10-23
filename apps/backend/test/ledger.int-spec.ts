import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  initialRepeatState,
  normalizeFast,
} from '../src/collector/normalize.js';
import {
  DEFAULT_MAPPING_V1,
  ensureMappingV1,
} from '../src/collector/mapping.js';
import { IngestService } from '../src/collector/ingest.service.js';
import { SampleFlag, type IngestPoll } from '../src/collector/types.js';
import { parseEnv } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { AccountingMutations } from '../src/accounting/accounting.mutations.js';
import {
  LedgerService,
  type LedgerOptions,
} from '../src/accounting/ledger.service.js';
import { computeRange } from '../src/accounting/compute.js';
import { RetentionService } from '../src/collector/retention.service.js';
import { Prisma, type EnergyInterval } from '../src/generated/prisma/client.js';
import { initialCounterStates } from '../src/accounting/counters.js';
import { RawPollRenormalizer } from '../src/accounting/raw-poll-renormalizer.js';
import { SeriesService } from '../src/accounting/series.service.js';
import {
  BUCKET_MS,
  COUNTER_KEYS,
  LedgerFlag,
} from '../src/accounting/types.js';
import { encodeBlocks } from '../src/modbus/raw-poll-codec.js';
import { FAST_PLAN } from '../src/modbus/read-plan.js';
import { blocksFrom, plausibleImage, setReg } from './support/synthetic.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

const base = Date.UTC(2026, 4, 1, 0, 0);
const at = (seconds: number) => new Date(base + seconds * 1000);
let db: TestDatabase;
let prisma: PrismaService;
let ingest: IngestService;
let ledger: LedgerService;
let mutations: AccountingMutations;
let deviceId: number;
let runId: number;
let seq: number;

async function setup(timeZone = 'Asia/Kuala_Lumpur') {
  db = await createTestDatabase();
  prisma = new PrismaService({ DATABASE_URL: db.url });
  const env = parseEnv({
    DATABASE_URL: db.url,
    COLLECTOR_ENABLED: 'false',
    SITE_TIMEZONE: timeZone,
  });
  ledger = new LedgerService(prisma, env, { clock: () => at(100_000) });
  mutations = new AccountingMutations(
    prisma,
    env,
    new RawPollRenormalizer(prisma),
    () => at(100_000),
  );
  ingest = new IngestService(prisma);
  await ensureMappingV1(prisma);
  const source = await prisma.dataSource.create({
    data: { kind: 'MODBUS_TCP', endpoint: `ledger-${Date.now()}:502#1` },
  });
  const device = await prisma.device.create({
    data: {
      dataSourceId: source.id,
      deviceKey: 'ledger',
      role: 'INVERTER',
      model: 'synthetic',
      observedCapabilities: {},
      firmware: {},
      capabilitiesObservedAt: at(0),
      firstSeenAt: at(0),
      lastSeenAt: at(0),
    },
  });
  deviceId = device.id;
  runId = (
    await prisma.collectorRun.create({
      data: {
        startedAt: at(0),
        appVersion: 'test',
        registerMapVersion: 'test',
      },
    })
  ).id;
  seq = 0;
}

function polls(
  seconds: number[],
  options: {
    gridW?: number;
    stale?: boolean;
    gridCounter?: (second: number) => number;
    meterVoltageA?: (second: number) => number;
    /**
     * Battery power registers: BMS block 1800 holds `bms` W, inverter block 0 holds `g3` W.
     * `source` selects the mapping version the sample is normalized with; `failBlock` drops that
     * register block from every poll.
     */
    battery?: {
      source: 'BAT1_POWER_G3_50' | 'BMS_1914';
      bms: number;
      g3: number;
      failBlock?: 0 | 1800 | 'both';
    };
  } = {},
): IngestPoll[] {
  let state = initialRepeatState();
  return seconds.map((second) => {
    const image = plausibleImage({ gridW: options.gridW ?? 1000, pvW: 0 });
    if (options.meterVoltageA)
      setReg(image, 'meter_grid_voltage_a', options.meterVoltageA(second));
    if (options.gridCounter)
      setReg(image, 'grid_buy_energy', options.gridCounter(second) / 1000);
    if (options.stale) setReg(image, 'grid_meter_link', 0);
    if (options.battery) {
      setReg(image, 'batt_power_bms', options.battery.bms);
      setReg(image, 'bat1_power_g3', options.battery.g3);
    }
    const blocks = blocksFrom(FAST_PLAN, image).map((block) =>
      options.battery?.failBlock === block.start ||
      (options.battery?.failBlock === 'both' &&
        (block.start === 0 || block.start === 1800))
        ? { ...block, words: null }
        : block,
    );
    const observedAt = at(second);
    const result = normalizeFast({
      blocks,
      observedAt,
      monotonicMs: second * 1000,
      mapping: {
        ...DEFAULT_MAPPING_V1,
        maxRepeatSpanSec: 3600,
        batteryPowerSource:
          options.battery?.source ?? DEFAULT_MAPPING_V1.batteryPowerSource,
      },
      mappingVersion: options.battery?.source === 'BMS_1914' ? 2 : 1,
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

async function run(now = at(100_000)) {
  await ledger.processOnce(now);
}
async function hashIntervals(): Promise<string> {
  const rows = await prisma.energyInterval.findMany({
    orderBy: { bucketStart: 'asc' },
  });
  const columns = [
    'gridImportNetWh',
    'gridExportNetWh',
    'gridImportPhaseWh',
    'gridExportPhaseWh',
    'gridImportCounterWh',
    'gridExportCounterWh',
    'pvIntWh',
    'pvCounterWh',
    'batChargeIntWh',
    'batDischargeIntWh',
    'batChargeCounterWh',
    'batDischargeCounterWh',
    'loadDerivedWh',
    'loadCounterWh',
  ] as const;
  return createHash('sha256')
    .update(
      JSON.stringify(
        rows.map((row) => columns.map((key) => row[key]?.toString() ?? null)),
      ),
    )
    .digest('hex');
}

beforeEach(async () => {
  await setup();
});
afterEach(async () => {
  await prisma?.close();
  await db?.drop();
});

describe('persisted accounting ledger', () => {
  it('V5: 360 duplicate polls and a second recompute preserve all Wh columns', async () => {
    const batch = polls(
      Array.from({ length: 360 }, (_, i) => 10 * i),
      { gridCounter: (s) => 1234500 + (s / 10) * 100 },
    );
    expect(
      await ingest.ingest(batch, { maxRepeatSpanSec: 3600 }),
    ).toMatchObject({ insertedSamples: 360 });
    await run();
    const rows = await prisma.energyInterval.findMany({
      orderBy: { bucketStart: 'asc' },
    });
    expect(rows.length).toBe(12);
    const firstHash = await hashIntervals();
    expect(
      await ingest.ingest(batch, { maxRepeatSpanSec: 3600 }),
    ).toMatchObject({ insertedSamples: 0, duplicateSamples: 360 });
    await run();
    await prisma.ledgerDirtyRange.create({
      data: { fromBucket: at(0), toBucket: at(3600), reason: 'RECALC_REQUEST' },
    });
    await run();
    expect(await hashIntervals()).toBe(firstHash);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });

  it('finishes dense incremental midnight accounting and matches a full rebuild', async () => {
    ledger = new LedgerService(
      prisma,
      parseEnv({
        DATABASE_URL: db.url,
        COLLECTOR_ENABLED: 'false',
        SITE_TIMEZONE: 'UTC',
      }),
      {},
      false,
    );
    const batch = polls(
      Array.from({ length: 8641 }, (_, i) => i * 10),
      {
        gridCounter: (s) => 1234500 + s,
        meterVoltageA: (s) => 230 + ((s / 10) % 2),
      },
    );
    // Seed normalized history directly; the regression is the worker's incremental
    // boundary, not thousands of individual ingest-side invalidation queries.
    for (let first = 0; first < batch.length - 1; first += 350) {
      const page = batch.slice(first, Math.min(first + 350, 8640));
      const raw = await prisma.rawPoll.createManyAndReturn({
        data: page.map((poll) => ({
          runId,
          seq: poll.seq,
          deviceId,
          tier: poll.tier,
          requestedAt: poll.requestedAt,
          receivedAt: poll.receivedAt,
          observedAt: poll.observedAt,
          monotonicMs: poll.observedAt.getTime() - base,
          acquisitionClockStep: false,
          acquisitionMeterRepeatSec: 0,
          blocks: Uint8Array.from(poll.blocks),
          contentHash: createHash('sha256').update(poll.blocks).digest(),
        })),
        select: { id: true, seq: true },
      });
      const rawIds = new Map(raw.map((row) => [row.seq, row.id]));
      await prisma.sample.createMany({
        data: page.map((poll) => ({
          ...poll.sample!,
          vendorToday: poll.sample!.vendorToday ?? undefined,
          deviceId,
          rawPollId: rawIds.get(poll.seq)!,
        })),
      });
    }
    await prisma.ledgerDirtyRange.create({
      data: {
        fromBucket: at(0),
        toBucket: at(86400),
        reason: 'INGEST',
      },
    });
    await run();
    batch[8640]!.monotonicMs = 86_400_000;
    await ingest.ingest(batch.slice(-1), { maxRepeatSpanSec: 3600 });
    await run();
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    const snapshot = async () =>
      (
        await prisma.energyInterval.findMany({
          orderBy: { bucketStart: 'asc' },
        })
      ).map((row) => ({ ...row, computedAt: null }));
    const incremental = await snapshot();
    const day = incremental.filter((row) => row.bucketStart < at(86400));
    expect(day).toHaveLength(288);
    expect(day.every((row) => row.gridCoveredSec === 300)).toBe(true);
    expect(
      day.every((row) => row.gridImportNetWh?.toString() === '83.333'),
    ).toBe(true);
    expect(
      day.every((row) => row.gridImportCounterWh?.toString() === '300'),
    ).toBe(true);
    const events = await prisma.dataQualityEvent.findMany({
      orderBy: { id: 'asc' },
    });
    await prisma.energyInterval.deleteMany();
    await prisma.ledgerDirtyRange.create({
      data: {
        fromBucket: at(0),
        toBucket: at(86700),
        reason: 'RECALC_REQUEST',
      },
    });
    await run();
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    expect(await snapshot()).toEqual(incremental);
    expect(
      await prisma.dataQualityEvent.findMany({ orderBy: { id: 'asc' } }),
    ).toEqual(events);
  });

  it('V23a: delayed, out-of-order persistence equals the in-order ledger', async () => {
    const times = Array.from({ length: 270 }, (_, i) => i * 10);
    const ordered = polls(times, {
      gridCounter: (s) => 1234500 + (s / 10) * 100,
    });
    await ingest.ingest(ordered, { maxRepeatSpanSec: 3600 });
    await run();
    const expected = await hashIntervals();
    await prisma.energyInterval.deleteMany();
    await prisma.sample.deleteMany();
    await prisma.rawPoll.deleteMany();
    const reordered = polls(times, {
      gridCounter: (s) => 1234500 + (s / 10) * 100,
    });
    await ingest.ingest(reordered.slice(135), { maxRepeatSpanSec: 3600 });
    await run();
    await ingest.ingest(reordered.slice(0, 135), { maxRepeatSpanSec: 3600 });
    await run();
    expect(await prisma.sample.count()).toBe(270);
    expect(await hashIntervals()).toBe(expected);
  });

  it('V7: meter-down flags reduce grid coverage but leave independent counter candidates', async () => {
    await ingest.ingest(
      polls(
        Array.from({ length: 120 }, (_, i) => i * 10),
        { gridCounter: (s) => 1234500 + (s / 10) * 100 },
      ),
      { maxRepeatSpanSec: 3600 },
    );
    await run();
    const before = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(600) },
    });
    const affected = polls([610, 620, 630], {
      stale: true,
      gridCounter: (s) => 1234500 + (s / 10) * 100,
    });
    // Different run/device timestamp would deduplicate, so mutate existing meter flags and enqueue exactly the affected bucket.
    await prisma.sample.updateMany({
      where: { observedAt: { gte: at(600), lt: at(900) } },
      data: { flags: 1 },
    });
    await prisma.ledgerDirtyRange.create({
      data: { fromBucket: at(600), toBucket: at(900), reason: 'INGEST' },
    });
    await run();
    const after = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(600) },
    });
    expect(after.gridCoveredSec).toBeLessThan(before.gridCoveredSec);
    expect(after.gridImportCounterWh?.toString()).toBe(
      before.gridImportCounterWh?.toString(),
    );
    expect(affected).toHaveLength(3);
  });

  it('V23b: a late sample recomputes its preceding and following buckets', async () => {
    const initial = polls([0, 10, 10_800, 10_810], {
      gridCounter: (s) => 1234500 + Math.floor(s / 10) * 100,
    });
    await ingest.ingest(initial, { maxRepeatSpanSec: 3600 });
    await run();
    const late = polls([5_400], { gridCounter: () => 1240000 });
    await ingest.ingest(late, { maxRepeatSpanSec: 3600 });
    const dirty = await prisma.ledgerDirtyRange.findFirstOrThrow();
    expect(dirty.fromBucket).toEqual(at(0));
    expect(dirty.toBucket.getTime()).toBeGreaterThanOrEqual(
      at(10_800).getTime(),
    );
    await run();
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    expect(await prisma.energyInterval.count()).toBeGreaterThan(2);
  });

  it('V23f: retroactive METER_STALE reduces the already-computed 11:55 bucket', async () => {
    const noon = 12 * 3600;
    await ingest.ingest(polls([noon - 330, noon - 320], { gridW: 500 }), {
      maxRepeatSpanSec: 30,
    });
    const repeating = polls(
      [noon - 20, noon - 10, noon, noon + 10, noon + 20],
      { gridW: 777 },
    );
    await ingest.ingest(repeating.slice(0, 4), { maxRepeatSpanSec: 30 });
    await run();
    const previous = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(noon - 600) },
    });
    const original = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(noon - 300) },
    });
    expect(original.gridCoveredSec).toBeGreaterThan(0);
    await ingest.ingest(repeating.slice(4), { maxRepeatSpanSec: 30 });
    const marked = await prisma.sample.findMany({
      where: { observedAt: { gte: at(noon - 20), lte: at(noon + 20) } },
    });
    expect(
      marked.every((sample) => (sample.flags & SampleFlag.METER_STALE) !== 0),
    ).toBe(true);
    await run();
    const corrected = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(noon - 300) },
    });
    expect(corrected.gridCoveredSec).toBeLessThan(original.gridCoveredSec);
    expect(corrected.gridImportNetWh).toBeNull();
    const untouched = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(noon - 600) },
    });
    expect(untouched.gridImportNetWh?.toString()).toBe(
      previous.gridImportNetWh?.toString(),
    );
  });

  it('GRID exclusion creation and deletion recompute the actual predecessor beyond one bucket', async () => {
    await ingest.ingest(
      polls([0, 600, 610], {
        meterVoltageA: (second) => 230 + second / 10,
      }),
      { maxRepeatSpanSec: 3600 },
    );
    await run();
    await mutations.createAccountingPolicy({
      effectiveFrom: at(0),
      gridSource: 'METER_NET',
      pvSource: 'INTEGRATED',
      batterySource: 'INTEGRATED',
      loadSource: 'DERIVED',
      maxGapSec: 600,
      note: 'bridge ten-minute grid interval',
    });
    await run();
    const before = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(before.gridImportNetWh?.toString()).toBe('83.333');
    const exclusion = await mutations.createDataExclusion(
      {
        from: at(600),
        to: at(601),
        families: ['GRID'],
        reason: 'bad endpoint',
      },
      'test',
    );
    const created = await prisma.ledgerDirtyRange.findFirstOrThrow({
      where: { reason: 'EXCLUSION' },
    });
    expect(created.fromBucket).toEqual(at(0));
    await run();
    const excluded = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(excluded.gridImportNetWh).toBeNull();
    expect(excluded.gridCoveredSec).toBe(0);
    expect(await mutations.deleteDataExclusion(exclusion.id)).toBe(true);
    const removed = await prisma.ledgerDirtyRange.findFirstOrThrow({
      where: { reason: 'EXCLUSION' },
    });
    expect(removed.fromBucket).toEqual(at(0));
    await run();
    const restored = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(restored.gridImportNetWh?.toString()).toBe('83.333');
    expect(restored.gridCoveredSec).toBe(300);
  });
  it('V27: 45-second gap is excluded at 30 and included at 60, source-only switch does not rewrite', async () => {
    await ingest.ingest(polls([0, 45], { gridW: 1000 }), {
      maxRepeatSpanSec: 3600,
    });
    await run();
    const old = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(old.flags & LedgerFlag.GRID_GAP).not.toBe(0);
    const changed = await mutations.createAccountingPolicy({
      effectiveFrom: at(0),
      gridSource: 'METER_NET',
      pvSource: 'INTEGRATED',
      batterySource: 'INTEGRATED',
      loadSource: 'DERIVED',
      maxGapSec: 60,
      note: 'allow 45 seconds',
    });
    expect(changed.calculationRun?.kind).toBe('CALC_PARAMS_CHANGE');
    await run();
    const current = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(Number(current.gridImportNetWh)).toBe(12.5);
    expect(current.gridCoveredSec).toBe(45);
    expect(current.maxGapSecUsed).toBe(60);
    expect(
      (
        await prisma.calculationRun.findUniqueOrThrow({
          where: { id: changed.calculationRun!.id },
        })
      ).status,
    ).toBe('DONE');
    const sourceOnly = await mutations.createAccountingPolicy({
      effectiveFrom: at(0),
      gridSource: 'INVERTER_COUNTER',
      pvSource: 'INTEGRATED',
      batterySource: 'INTEGRATED',
      loadSource: 'DERIVED',
      maxGapSec: 60,
      note: 'select candidate',
    });
    expect(sourceOnly.calculationRun).toBeNull();
    expect(
      (
        await prisma.energyInterval.findUniqueOrThrow({
          where: { bucketStart: at(0) },
        })
      ).computedAt,
    ).toEqual(current.computedAt);
  });

  it('rejects overlapping running recalculations with typed RECALC_IN_PROGRESS', async () => {
    const first = await mutations.requestRecalculation(
      'LEDGER_RECOMPUTE',
      at(0),
      at(3600),
      'manual correction',
    );
    expect(first.status).toBe('RUNNING');
    await expect(
      mutations.requestRecalculation(
        'LEDGER_RECOMPUTE',
        at(1800),
        at(5400),
        'overlap',
      ),
    ).rejects.toMatchObject({ code: 'RECALC_IN_PROGRESS' });
    await run();
    expect(
      (
        await prisma.calculationRun.findUniqueOrThrow({
          where: { id: first.id },
        })
      ).status,
    ).toBe('DONE');
  });

  it('reports the retention cutoff for a partially clamped recalculation', async () => {
    const old = new Date(Date.UTC(2025, 0, 1));
    await expect(
      mutations.requestRecalculation(
        'LEDGER_RECOMPUTE',
        old,
        new Date(old.getTime() + BUCKET_MS),
        'too old',
      ),
    ).rejects.toMatchObject({ code: 'OUTSIDE_RETENTION' });
    const requested = await mutations.requestRecalculation(
      'LEDGER_RECOMPUTE',
      old,
      at(300),
      'historical repair',
    );
    expect(requested.outsideRetentionBefore).toEqual(requested.rangeStart);
    expect(requested.rangeStart.getTime()).toBeGreaterThan(old.getTime());
  });

  it('rebuilds raw samples with the current mapping via RENORMALIZE', async () => {
    const original = polls([0, 10, 20]);
    await ingest.ingest(original, { maxRepeatSpanSec: 3600 });
    await prisma.sample.updateMany({ data: { gridW: 9999 } });
    const result = await mutations.requestRecalculation(
      'RENORMALIZE',
      at(0),
      at(300),
      'redecode raw',
    );
    expect(result.kind).toBe('RENORMALIZE');
    expect((await prisma.sample.findFirstOrThrow()).gridW).toBe(1000);
    await run();
    expect(
      (
        await prisma.calculationRun.findUniqueOrThrow({
          where: { id: result.id },
        })
      ).status,
    ).toBe('DONE');
  });
  it('rolls back renormalized samples when replay fails before recovery dirt is inserted', async () => {
    await ingest.ingest(polls([0, 10]), { maxRepeatSpanSec: 3600 });
    await run();
    const env = parseEnv({ DATABASE_URL: db.url, COLLECTOR_ENABLED: 'false' });
    const failing = new AccountingMutations(prisma, env, {
      async renormalize(_from, _to, _mapping, tx) {
        await tx!.sample.updateMany({ data: { gridW: 9999 } });
        throw new Error('replay interrupted');
      },
    });
    await expect(
      failing.requestRecalculation('RENORMALIZE', at(0), at(300), 'replay'),
    ).rejects.toThrow('replay interrupted');
    expect((await prisma.sample.findFirstOrThrow()).gridW).toBe(1000);
    expect(await prisma.calculationRun.count()).toBe(0);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });

  it('renormalizes the preceding interpolation bucket when the left-edge sample changes', async () => {
    const previous = polls([290], { gridW: 1000 });
    const corrected = polls([300], { gridW: 2000 });
    const next = polls([310], { gridW: 1000 });
    await ingest.ingest([...previous, ...corrected, ...next], {
      maxRepeatSpanSec: 3600,
    });
    await prisma.sample.updateMany({
      where: { observedAt: at(300) },
      data: { gridW: 1000 },
    });
    await run();
    const old = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(Number(old.gridImportNetWh)).toBeCloseTo(2.778, 2);
    await mutations.requestRecalculation(
      'RENORMALIZE',
      at(300),
      at(600),
      'correct edge',
    );
    await run();
    const fresh = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(Number(fresh.gridImportNetWh)).toBeCloseTo(4.167, 2);
  });

  it('replays retroactive meter staleness over every sample in the repeated run', async () => {
    const noon = 12 * 3600;
    await ingest.ingest(
      polls([noon - 20, noon - 10, noon, noon + 10, noon + 20], { gridW: 777 }),
      { maxRepeatSpanSec: 3600 },
    );
    const range = { observedAt: { gte: at(noon - 20), lte: at(noon + 20) } };
    expect(
      (await prisma.sample.findMany({ where: range })).some(
        (row) => row.flags & SampleFlag.METER_STALE,
      ),
    ).toBe(false);
    await mutations.requestRecalculation(
      'RENORMALIZE',
      at(noon - 300),
      at(noon + 300),
      'replay repeat state',
    );
    const samples = await prisma.sample.findMany({
      where: range,
      orderBy: { observedAt: 'asc' },
    });
    expect(samples).toHaveLength(5);
    expect(
      samples.every((row) => (row.flags & SampleFlag.METER_STALE) !== 0),
    ).toBe(true);
    await run();
    expect(
      (
        await prisma.energyInterval.findUniqueOrThrow({
          where: { bucketStart: at(noon - 300) },
        })
      ).gridCoveredSec,
    ).toBe(0);
  });
  it('RENORMALIZE preserves unstale energy across a gap that ends a meter repeat run', async () => {
    await ingest.ingest(polls([0, 10, 20, 100, 110]), {
      maxRepeatSpanSec: 30,
    });
    await run();
    const before = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(before.gridImportNetWh?.toString()).toBe('5.556');
    expect(before.gridCoveredSec).toBe(20);
    const flags = (
      await prisma.sample.findMany({
        orderBy: { observedAt: 'asc' },
      })
    ).map((row) => row.flags);
    expect(
      flags.slice(0, 3).every((flag) => !(flag & SampleFlag.METER_STALE)),
    ).toBe(true);
    await mutations.requestRecalculation(
      'RENORMALIZE',
      at(0),
      at(300),
      'unchanged meter run',
    );
    expect(
      (await prisma.sample.findMany({ orderBy: { observedAt: 'asc' } })).map(
        (row) => row.flags,
      ),
    ).toEqual(flags);
    await run();
    const after = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(after.gridImportNetWh?.toString()).toBe('5.556');
    expect(after.gridCoveredSec).toBe(20);
  });
  it('RENORMALIZE retains staleness when its triggering repeat reading lies beyond the replay end', async () => {
    await ingest.ingest(
      polls([280, 290, 300, 310, 320, 330], {
        gridW: 1000,
        meterVoltageA: (second) => (second === 280 ? 231 : 230),
      }),
      { maxRepeatSpanSec: 30 },
    );
    await run();
    const original = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(original.gridCoveredSec).toBe(0);
    const outside = await prisma.sample.findUniqueOrThrow({
      where: { deviceId_observedAt: { deviceId, observedAt: at(330) } },
    });
    expect(outside.flags & SampleFlag.METER_STALE).not.toBe(0);
    await mutations.requestRecalculation(
      'RENORMALIZE',
      at(0),
      at(300),
      'replay run continuing past right edge',
    );
    const replayed = await prisma.sample.findUniqueOrThrow({
      where: { deviceId_observedAt: { deviceId, observedAt: at(290) } },
    });
    expect(replayed.flags & SampleFlag.METER_STALE).not.toBe(0);
    const untouched = await prisma.sample.findUniqueOrThrow({
      where: { deviceId_observedAt: { deviceId, observedAt: at(330) } },
    });
    expect(untouched).toEqual(outside);
    await run();
    const after = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(after.gridCoveredSec).toBe(0);
    expect(after.gridImportNetWh).toBeNull();
  });

  it('RENORMALIZE dirt includes the actual predecessor beyond one bucket and following sample', async () => {
    await ingest.ingest(
      polls([0, 600, 610, 1200], {
        meterVoltageA: (second) => 230 + second / 10,
      }),
      { maxRepeatSpanSec: 3600 },
    );
    await run();
    await mutations.createAccountingPolicy({
      effectiveFrom: at(0),
      gridSource: 'METER_NET',
      pvSource: 'INTEGRATED',
      batterySource: 'INTEGRATED',
      loadSource: 'DERIVED',
      maxGapSec: 600,
      note: 'bridge ten-minute meter gap',
    });
    await run();
    const old = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(old.gridImportNetWh?.toString()).toBe('83.333');
    await prisma.mappingVersion.create({
      data: {
        version: 2,
        config: { ...DEFAULT_MAPPING_V1, gridMeterSign: -1 },
        provisional: true,
        note: 'reverse grid meter polarity',
      },
    });
    await mutations.requestRecalculation(
      'RENORMALIZE',
      at(600),
      at(900),
      'correct meter polarity',
    );
    const pending = await prisma.ledgerDirtyRange.findFirstOrThrow({
      where: { reason: 'RENORMALIZE' },
    });
    expect(pending.fromBucket).toEqual(at(0));
    expect(pending.toBucket).toEqual(at(1200));
    await run();
    const corrected = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(corrected.gridImportNetWh?.toString()).toBe('41.667');
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });

  it('F6: the configured battery source, not block 0, decides which register failure masks battery data in the ledger and in both series resolutions', async () => {
    await prisma.mappingVersion.create({
      data: {
        version: 2,
        config: { ...DEFAULT_MAPPING_V1, batteryPowerSource: 'BMS_1914' },
        provisional: true,
        note: 'battery power from BMS register 1914',
      },
    });
    // Block 1800 holds the BMS power register (1200 W), block 0 the inverter register (777 W).
    const cases = [
      { start: 0, source: 'BMS_1914', failBlock: 0, watts: 1200 },
      { start: 600, source: 'BMS_1914', failBlock: 1800, watts: null },
      { start: 1200, source: 'BAT1_POWER_G3_50', failBlock: 1800, watts: 777 },
      { start: 1800, source: 'BAT1_POWER_G3_50', failBlock: 0, watts: null },
    ] as const;
    for (const { start, source, failBlock } of cases)
      await ingest.ingest(
        polls(
          Array.from({ length: 31 }, (_, i) => start + i * 10),
          { battery: { source, bms: 1200, g3: 777, failBlock } },
        ),
        { maxRepeatSpanSec: 3600 },
      );
    await run();
    for (const { start, watts } of cases) {
      const row = await prisma.energyInterval.findUniqueOrThrow({
        where: { bucketStart: at(start) },
      });
      if (watts === null) {
        expect(row.batCoveredSec).toBe(0);
        expect(row.batDischargeIntWh).toBeNull();
        expect(row.batAvgW).toBeNull();
      } else {
        expect(row.batCoveredSec).toBe(300);
        expect(row.batDischargeIntWh?.toString()).toBe(
          String((watts * 300) / 3600),
        );
        expect(row.batAvgW).toBe(watts);
      }
    }
    const series = new SeriesService(
      prisma,
      parseEnv({
        DATABASE_URL: db.url,
        COLLECTOR_ENABLED: 'false',
        SAMPLE_RETENTION_DAYS: '3650',
      }),
    );
    // 300 s ledger buckets first, then 60 s windows served straight from Sample rows.
    for (const [maxPoints, bucketSeconds] of [
      [7, 300],
      [35, 60],
    ] as const) {
      const result = await series.powerSeries(
        at(0),
        at(2100),
        ['BATTERY'],
        maxPoints,
      );
      expect(result.bucketSeconds).toBe(bucketSeconds);
      for (const { start, watts } of cases) {
        const points = result.series[0]!.points.filter(
          (p) =>
            p.t.getTime() >= at(start).getTime() &&
            p.t.getTime() < at(start + 300).getTime(),
        );
        expect(points).toHaveLength(300 / bucketSeconds);
        for (const point of points) {
          expect(point.avg).toBe(watts);
          expect(point.coverage.toNumber() > 0).toBe(watts !== null);
        }
      }
    }
  });
  it('persists independent SOC slots across battery mappings, invalid blocks, clock steps and exclusions at fine and coarse widths', async () => {
    await prisma.mappingVersion.create({
      data: {
        version: 2,
        config: { ...DEFAULT_MAPPING_V1, batteryPowerSource: 'BMS_1914' },
        provisional: false,
        note: 'historical BMS source',
      },
    });
    const cases = [
      { start: 0, source: 'BAT1_POWER_G3_50', failBlock: 0, soc: true },
      { start: 600, source: 'BAT1_POWER_G3_50', failBlock: 1800, soc: false },
      { start: 1200, source: 'BMS_1914', failBlock: 0, soc: true },
      { start: 1800, source: 'BMS_1914', failBlock: 1800, soc: false },
      {
        start: 2400,
        source: 'BAT1_POWER_G3_50',
        failBlock: 'both',
        soc: false,
      },
      { start: 3000, source: 'BMS_1914', failBlock: 'both', soc: false },
      {
        start: 3600,
        source: 'BAT1_POWER_G3_50',
        failBlock: undefined,
        soc: false,
      },
      { start: 4200, source: 'BMS_1914', failBlock: undefined, soc: false },
      {
        start: 4800,
        source: 'BAT1_POWER_G3_50',
        failBlock: undefined,
        soc: false,
      },
    ] as const;
    for (const { start, source, failBlock } of cases)
      await ingest.ingest(
        polls([start + 0.1, start + 9, start + 60], {
          battery: { source, bms: 1200, g3: 777, failBlock },
        }),
        { maxRepeatSpanSec: 3600 },
      );
    await prisma.sample.updateMany({
      where: { observedAt: { gte: at(3600), lt: at(3900) } },
      data: { flags: SampleFlag.CLOCK_STEP },
    });
    for (const [start, family] of [
      [4200, 'BATTERY'],
      [4800, 'ALL'],
    ] as const)
      await prisma.dataExclusion.create({
        data: {
          from: at(start),
          to: at(start + 300),
          families: [family],
          reason: 'synthetic exclusion',
          createdBy: 'test',
        },
      });
    await run();
    const series = new SeriesService(
      prisma,
      parseEnv({
        DATABASE_URL: db.url,
        COLLECTOR_ENABLED: 'false',
        SAMPLE_RETENTION_DAYS: '3650',
      }),
    );
    for (const { start, source, soc } of cases) {
      const row = await prisma.energyInterval.findUniqueOrThrow({
        where: { bucketStart: at(start) },
      });
      expect(row.mappingVersion).toBe(source === 'BMS_1914' ? 2 : 1);
      expect(row.socCoveredSec).toBe(soc ? 20 : 0);
      expect(row.socMin !== null).toBe(soc);
      expect(row.socMax !== null).toBe(soc);
      const coarse = await series.powerSeries(
        at(start),
        at(start + 300),
        ['SOC'],
        1,
      );
      const fine = await series.powerSeries(
        at(start),
        at(start + 300),
        ['SOC'],
        30,
      );
      const point = coarse.series[0]!.points[0]!;
      expect(point.avg).toBeNull();
      expect(point.min).toBe(row.socMin);
      expect(point.max).toBe(row.socMax);
      expect(point.coverage.toNumber()).toBeCloseTo((soc ? 20 : 0) / 300, 12);
      expect(
        fine.series[0]!.points.reduce(
          (sum, p) => sum + p.coverage.toNumber() * 10,
          0,
        ),
      ).toBe(soc ? 20 : 0);
      if (!soc)
        expect(coarse.gaps).toEqual([{ from: at(start), to: at(start + 300) }]);
    }
  });
  it.each(['pending', 'chunk-crash', 'propagation-crash', 'upgrade'] as const)(
    'repairs retained acquisition validity before %s calculation without renormalizing original mapping or values',
    async (mode) => {
      await ingest.ingest(
        polls([0, 10, 20, 30, 40]).map((poll) => ({
          ...poll,
          monotonicMs: poll.observedAt.getTime() - base,
        })),
        { maxRepeatSpanSec: 30 },
      );
      if (mode === 'upgrade') {
        await run();
        await prisma.energyInterval.updateMany({
          data: { calcVersion: 2, socCoveredSec: null },
        });
      }
      // Simulate the prior replay defect, which erased immutable acquisition ages/staleness.
      await prisma.sample.updateMany({ data: { flags: 0, meterRepeatSec: 0 } });
      const values = await prisma.sample.findMany({
        orderBy: { observedAt: 'asc' },
        select: { mappingVersion: true, gridW: true, batteryW: true },
      });
      expect(await prisma.energyInterval.count()).toBe(
        mode === 'upgrade' ? 1 : 0,
      );
      await prisma.mappingVersion.create({
        data: {
          version: 2,
          config: {
            ...DEFAULT_MAPPING_V1,
            gridMeterSign: -1,
            batteryPowerSource: 'BMS_1914',
            maxRepeatSpanSec: 3600,
          },
          provisional: false,
          note: 'new mapping must not overwrite original samples on upgrade',
        },
      });
      if (mode === 'chunk-crash' || mode === 'propagation-crash') {
        const beforeSamples = await prisma.sample.findMany({
          orderBy: { id: 'asc' },
        });
        const beforeDirty = await prisma.ledgerDirtyRange.findMany({
          orderBy: { id: 'asc' },
        });
        const interrupted = new LedgerService(
          prisma,
          parseEnv({ DATABASE_URL: db.url, COLLECTOR_ENABLED: 'false' }),
          {
            clock: () => at(100_000),
            onBeforeCommit: (stage) => {
              if (`${stage}-crash` === mode) throw new Error('repair crash');
            },
          },
        );
        await expect(interrupted.processOnce()).rejects.toThrow('repair crash');
        expect(
          await prisma.sample.findMany({ orderBy: { id: 'asc' } }),
        ).toEqual(beforeSamples);
        expect(
          await prisma.ledgerDirtyRange.findMany({ orderBy: { id: 'asc' } }),
        ).toEqual(beforeDirty);
        expect(await prisma.energyInterval.count()).toBe(0);
      }
      await run();
      const samples = await prisma.sample.findMany({
        orderBy: { observedAt: 'asc' },
      });
      expect(
        samples.map(({ mappingVersion, gridW, batteryW }) => ({
          mappingVersion,
          gridW,
          batteryW,
        })),
      ).toEqual(values);
      expect(samples.map((sample) => sample.meterRepeatSec)).toEqual([
        0, 10, 20, 30, 40,
      ]);
      expect(
        samples.every(
          (sample) => (sample.flags & SampleFlag.METER_STALE) !== 0,
        ),
      ).toBe(true);
      const corrected = await prisma.energyInterval.findUniqueOrThrow({
        where: { bucketStart: at(0) },
      });
      expect(corrected.calcVersion).toBe(3);
      expect(corrected.mappingVersion).toBe(1);
      expect(corrected.gridCoveredSec).toBe(0);
      expect(corrected.gridImportNetWh).toBeNull();
      expect(corrected.socCoveredSec).toBe(50);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      if (mode === 'upgrade')
        expect(
          await prisma.calculationRun.findFirst({
            where: { kind: 'ALGO_UPGRADE', status: 'DONE' },
          }),
        ).not.toBeNull();
      const stableSamples = await prisma.sample.findMany({
        orderBy: { id: 'asc' },
      });
      const stableIntervals = await prisma.energyInterval.findMany({
        orderBy: { bucketStart: 'asc' },
      });
      await run();
      expect(await prisma.sample.findMany({ orderBy: { id: 'asc' } })).toEqual(
        stableSamples,
      );
      expect(
        await prisma.energyInterval.findMany({
          orderBy: { bucketStart: 'asc' },
        }),
      ).toEqual(stableIntervals);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    },
  );
  it.each(['seed', 'lookahead'] as const)(
    'repairs retained clock validity of the %s outside the requested chunk',
    async (side) => {
      const corruptAt = side === 'seed' ? 290 : 310;
      await ingest.ingest(
        polls([290, 310]).map((poll) => ({
          ...poll,
          monotonicMs: poll.observedAt.getTime() - base,
          sample: {
            ...poll.sample!,
            flags:
              poll.observedAt.getTime() === at(corruptAt).getTime()
                ? SampleFlag.CLOCK_STEP
                : 0,
          },
        })),
        { maxRepeatSpanSec: 3600 },
      );
      await prisma.sample.updateMany({ data: { flags: 0 } });
      await prisma.ledgerDirtyRange.deleteMany();
      const start = side === 'seed' ? 300 : 0;
      await prisma.ledgerDirtyRange.create({
        data: {
          fromBucket: at(start),
          toBucket: at(start + 300),
          reason: 'INGEST',
        },
      });
      await run();
      const interval = await prisma.energyInterval.findUniqueOrThrow({
        where: { bucketStart: at(start) },
      });
      expect(interval.gridCoveredSec).toBe(0);
      expect(interval.gridImportNetWh).toBeNull();
      const repaired = await prisma.sample.findFirstOrThrow({
        where: { observedAt: at(corruptAt) },
      });
      expect(repaired.flags & SampleFlag.CLOCK_STEP).toBe(
        SampleFlag.CLOCK_STEP,
      );
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    },
  );
});

describe('ledger horizons and exclusion replay', () => {
  async function rawSample(
    second: number,
    fields: { gridBuyWh?: bigint; gridW?: number },
  ) {
    const t = at(second);
    const raw = await prisma.rawPoll.create({
      data: {
        runId,
        seq: ++seq,
        deviceId,
        tier: 'FAST',
        requestedAt: t,
        receivedAt: t,
        observedAt: t,
        blocks: Buffer.from([1]),
        contentHash: createHash('sha256').update(`h${second}`).digest(),
      },
    });
    await prisma.sample.create({
      data: {
        rawPollId: raw.id,
        deviceId,
        observedAt: t,
        mappingVersion: 1,
        gridW: fields.gridW ?? null,
        gridBuyWh: fields.gridBuyWh ?? null,
        pvStringW: [],
        gridBuyPhaseWh: [],
        gridSellPhaseWh: [],
        meterRepeatSec: 0,
        flags: 0,
      },
    });
  }

  describe('RENORMALIZE with raw retention longer than sample retention', () => {
    const now = at(2 * 86_400);
    const retention = (sample: string) =>
      parseEnv({
        DATABASE_URL: db.url,
        COLLECTOR_ENABLED: 'false',
        RAW_RETENTION_DAYS: '400',
        SAMPLE_RETENTION_DAYS: sample,
      });

    async function prunedHistoryWithNewMapping() {
      await ingest.ingest(
        polls([0, 10]).map((poll) => ({
          ...poll,
          monotonicMs: poll.observedAt.getTime() - base,
        })),
        { maxRepeatSpanSec: 3600 },
      );
      await run(); // ordinary 400-day ledger: import 2.778 Wh under mapping 1
      // Retention has pruned the samples but the raw polls survive.
      await prisma.sample.deleteMany({});
      await prisma.mappingVersion.create({
        data: {
          version: 2,
          config: { ...DEFAULT_MAPPING_V1, gridMeterSign: -1 },
          provisional: true,
          note: 'reverse grid meter polarity',
        },
      });
    }
    const bucket = () =>
      prisma.energyInterval.findUniqueOrThrow({
        where: { bucketStart: at(0) },
      });

    it('updates the ledger from the rebuilt samples and only then completes the run', async () => {
      await prunedHistoryWithNewMapping();
      expect(Number((await bucket()).gridImportNetWh)).toBeCloseTo(2.778, 2);
      const env = retention('1');
      const request = await new AccountingMutations(
        prisma,
        env,
        new RawPollRenormalizer(prisma),
        () => now,
      ).requestRecalculation('RENORMALIZE', at(0), at(300), 'raw horizon');
      expect(await prisma.sample.count()).toBeGreaterThan(0);
      await new LedgerService(prisma, env, { clock: () => now }).processOnce(
        now,
      );
      const row = await bucket();
      expect(row.mappingVersion).toBe(2);
      expect(Number(row.gridImportNetWh)).toBe(0);
      expect(Number(row.gridExportNetWh)).toBeCloseTo(2.778, 2);
      expect(row.flags & LedgerFlag.OUTSIDE_RETENTION).toBe(0);
      expect(
        (
          await prisma.calculationRun.findUniqueOrThrow({
            where: { id: request.id },
          })
        ).status,
      ).toBe('DONE');
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    });

    it('keeps the raw horizon on durable dirt across a crash and retry', async () => {
      await prunedHistoryWithNewMapping();
      const env = retention('1');
      const request = await new AccountingMutations(
        prisma,
        env,
        new RawPollRenormalizer(prisma),
        () => now,
      ).requestRecalculation('RENORMALIZE', at(0), at(300), 'raw horizon');
      const crashing = new LedgerService(prisma, env, {
        clock: () => now,
        onBeforeCommit: () => {
          throw new Error('crash before commit');
        },
      });
      await expect(crashing.processOnce(now)).rejects.toThrow(
        'crash before commit',
      );
      expect(
        (
          await prisma.calculationRun.findUniqueOrThrow({
            where: { id: request.id },
          })
        ).status,
      ).toBe('RUNNING');
      expect(
        await prisma.ledgerDirtyRange.count({
          where: { reason: 'RENORMALIZE' },
        }),
      ).toBe(1);
      expect((await bucket()).mappingVersion).toBe(1);
      await new LedgerService(prisma, env, { clock: () => now }).processOnce(
        now,
      );
      expect((await bucket()).mappingVersion).toBe(2);
      expect(
        (
          await prisma.calculationRun.findUniqueOrThrow({
            where: { id: request.id },
          })
        ).status,
      ).toBe('DONE');
    });

    it('keeps older current-version buckets whose samples and raw polls are gone while renormalizing a later range', async () => {
      const withClock = (batch: IngestPoll[]) =>
        batch.map((poll) => ({
          ...poll,
          monotonicMs: poll.observedAt.getTime() - base,
        }));
      await ingest.ingest(withClock(polls([0, 10, 310, 320])), {
        maxRepeatSpanSec: 3600,
      });
      await run();
      const before = await bucket();
      expect(before.calcVersion).toBe(3);
      // Bucket 0 lost its samples (sample retention) and its raw polls: it cannot be rebuilt.
      await prisma.sample.deleteMany({
        where: { observedAt: { lt: at(300) } },
      });
      await prisma.rawPoll.deleteMany({
        where: { observedAt: { lt: at(300) } },
      });
      await prisma.mappingVersion.create({
        data: {
          version: 2,
          config: { ...DEFAULT_MAPPING_V1, gridMeterSign: -1 },
          provisional: true,
          note: 'reverse grid meter polarity',
        },
      });
      const env = retention('1');
      await new AccountingMutations(
        prisma,
        env,
        new RawPollRenormalizer(prisma),
        () => now,
      ).requestRecalculation('RENORMALIZE', at(300), at(600), 'later range');
      await new LedgerService(prisma, env, { clock: () => now }).processOnce(
        now,
      );
      const after = await bucket();
      expect(after.mappingVersion).toBe(1);
      expect(after.gridImportNetWh?.toString()).toBe(
        before.gridImportNetWh?.toString(),
      );
      const later = await prisma.energyInterval.findUniqueOrThrow({
        where: { bucketStart: at(300) },
      });
      expect(later.mappingVersion).toBe(2);
    });

    it('still clamps ordinary recomputation to sample retention', async () => {
      await prunedHistoryWithNewMapping();
      const env = retention('1');
      await prisma.ledgerDirtyRange.create({
        data: {
          fromBucket: at(0),
          toBucket: at(300),
          reason: 'RECALC_REQUEST',
        },
      });
      await new LedgerService(prisma, env, { clock: () => now }).processOnce(
        now,
      );
      const row = await bucket();
      expect(row.mappingVersion).toBe(1);
      expect(row.flags & LedgerFlag.OUTSIDE_RETENTION).not.toBe(0);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    });
  });

  describe('narrow replay and counter-transition exclusions', () => {
    it('replay of a later window equals the whole-range result when an older exclusion splits the counter transition', async () => {
      await rawSample(0, { gridBuyWh: 1000n });
      await rawSample(10, { gridBuyWh: 1100n });
      await rawSample(590, { gridW: 1000 }); // power-only: NULL counter
      await rawSample(610, { gridBuyWh: 1300n });
      await mutations.createAccountingPolicy({
        effectiveFrom: at(0),
        gridSource: 'METER_NET',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 600,
        note: 'bridge the counter gap',
      });
      await mutations.createDataExclusion(
        { from: at(20), to: at(30), families: ['GRID'], reason: 'bad span' },
        'test',
      );
      await prisma.ledgerDirtyRange.create({
        data: {
          fromBucket: at(0),
          toBucket: at(1200),
          reason: 'RECALC_REQUEST',
        },
      });
      await run();
      const snapshot = async () => {
        const row = await prisma.energyInterval.findUniqueOrThrow({
          where: { bucketStart: at(600) },
        });
        return {
          counter: row.gridImportCounterWh,
          unknown: row.counterUnknownSec,
        };
      };
      const whole = await snapshot();
      expect(whole.counter).toBeNull();
      expect(whole.unknown[COUNTER_KEYS.indexOf('GRID_BUY')]).toBe(300);

      await prisma.ledgerDirtyRange.create({
        data: {
          fromBucket: at(600),
          toBucket: at(900),
          reason: 'RECALC_REQUEST',
        },
      });
      await run();
      expect(await snapshot()).toEqual(whole);

      await prisma.ledgerDirtyRange.create({
        data: {
          fromBucket: at(0),
          toBucket: at(1200),
          reason: 'RECALC_REQUEST',
        },
      });
      await run();
      expect(await snapshot()).toEqual(whole);
    });
    it('loads exclusions from the verified counter anchor, not from an obsolete stored baseline', async () => {
      await rawSample(0, { gridBuyWh: 1000n });
      await rawSample(10, { gridBuyWh: 1100n });
      await rawSample(299, { gridW: 1000 }); // power-only: NULL counter
      await rawSample(610, { gridBuyWh: 1300n });
      await mutations.createAccountingPolicy({
        effectiveFrom: at(0),
        gridSource: 'METER_NET',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 600,
        note: 'bridge the counter gap',
      });
      await mutations.createDataExclusion(
        { from: at(20), to: at(30), families: ['GRID'], reason: 'bad span' },
        'test',
      );
      // An obsolete historical row (no evidence in its bucket) carries a counter state whose anchor
      // (400 s) is newer than the real accepted anchor (the 10 s reading). Verification must carry
      // the real state through it, and the exclusion bound must follow that state.
      const obsolete = initialCounterStates();
      obsolete.GRID_BUY = {
        segment: 0,
        deviceId,
        last: { v: 1150, tMs: at(400).getTime() },
        confirmed: true,
        pending: [],
      };
      await prisma.energyInterval.create({
        data: {
          bucketStart: at(300),
          calcVersion: 2,
          maxGapSecUsed: 30,
          mappingVersion: 1,
          computedAt: at(300),
          gridCoveredSec: 0,
          pvCoveredSec: 0,
          batCoveredSec: 0,
          loadCoveredSec: 0,
          counterUnknownSec: [300, 300, 300, 300, 300, 300],
          counterGapAllocMask: 0,
          flags: 0,
          counterState: obsolete as unknown as Prisma.InputJsonValue,
        },
      });
      await prisma.ledgerDirtyRange.create({
        data: {
          fromBucket: at(0),
          toBucket: at(600),
          reason: 'RECALC_REQUEST',
        },
      });
      await run();
      await prisma.energyInterval.deleteMany({
        where: { bucketStart: { gte: at(600) } },
      });
      await prisma.ledgerDirtyRange.create({
        data: {
          fromBucket: at(600),
          toBucket: at(900),
          reason: 'RECALC_REQUEST',
        },
      });
      await run();
      const row = await prisma.energyInterval.findUniqueOrThrow({
        where: { bucketStart: at(600) },
      });
      expect(row.gridImportCounterWh).toBeNull();
      expect(row.counterUnknownSec[COUNTER_KEYS.indexOf('GRID_BUY')]).toBe(300);
    });
  });

  describe('RENORMALIZE rebuilt window inside the raw horizon', () => {
    const DAY = 86_400;
    const W0 = 5 * DAY; // window start, seconds after `base`
    const now = at(12 * DAY);
    const sampleHorizon = at(10 * DAY); // SAMPLE_RETENTION_DAYS = 2
    const counter = (s: number) => 5_000_000 + 100 * (s / 60);
    const range = (from: number, to: number, step: number) =>
      Array.from(
        { length: Math.floor((to - from) / step) + 1 },
        (_, i) => from + i * step,
      );
    const clocked = (seconds: number[]) =>
      polls(seconds, { gridCounter: counter }).map((poll) => ({
        ...poll,
        monotonicMs: poll.observedAt.getTime() - base,
      }));
    const signature = (row: EnergyInterval, mask = ~0) =>
      JSON.stringify({ ...row, computedAt: null, flags: row.flags & mask });
    // Untouched rows keep their original computedAt, so any rewrite (even with equal values) shows.
    const exact = (row: EnergyInterval, mask = ~0) =>
      JSON.stringify({ ...row, flags: row.flags & mask });
    const rows = async () =>
      new Map(
        (
          await prisma.energyInterval.findMany({
            orderBy: { bucketStart: 'asc' },
          })
        ).map((row) => [row.bucketStart.getTime(), row]),
      );

    /**
     * Long history (3 pruned days on each side of a window), a sparse live tail at/after the sample
     * horizon, then retention-pruned samples, a new mapping and an explicit RENORMALIZE of the window.
     * Counter c(s) = 5 000 000 + 100 * s/60 Wh, so every accepted span has a hand-computable delta.
     */
    async function scenario(
      options: {
        windowSec?: number;
        windowStep?: number;
        outage?: boolean;
        retainSamples?: [number, number][];
        dropRawFrom?: number;
        /** Several rebuilt windows [startSec, endSec) in ascending order; default one window at W0. */
        windows?: [number, number][];
      } = {},
    ) {
      const windows: [number, number][] = options.windows ?? [
        [W0, W0 + (options.windowSec ?? 3600)],
      ];
      const first = windows[0]![0];
      const w1 = windows[windows.length - 1]![1];
      await mutations.createAccountingPolicy({
        effectiveFrom: at(0),
        gridSource: 'METER_NET',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 600,
        note: 'bridge sparse pre/post cadence',
      });
      const series = [
        ...range(first - 3 * DAY, first - 300, 300),
        ...windows.flatMap(([ws, we], i) => {
          const next = windows[i + 1]?.[0];
          return [
            ...range(ws + 120, we - 60, options.windowStep ?? 60).filter(
              // bucket [W0+1800, W0+2100) receives no sample but is bridged by counter spans
              (sec) => !(options.outage && sec >= W0 + 1800 && sec < W0 + 2100),
            ),
            // pruned history between two windows (authoritative rows)
            ...(next !== undefined && next - we > 600
              ? range(we + 120, next - 300, 300)
              : []),
          ];
        }),
        ...range(w1 + 120, Math.min(w1 + 3 * DAY, 11 * DAY), 300),
        ...range(10 * DAY + 3600, 10 * DAY + 3600 + 1200, 300),
      ];
      for (let i = 0; i < series.length; i += 1000)
        await ingest.ingest(clocked(series.slice(i, i + 1000)), {
          maxRepeatSpanSec: 3600,
        });
      // The initial pass runs an hour earlier so a later rewrite of any row changes its computedAt.
      await run(new Date(now.getTime() - 3_600_000));
      const before = await rows();
      const kept = options.retainSamples ?? [];
      await prisma.sample.deleteMany({
        where: {
          observedAt: { lt: sampleHorizon },
          NOT: kept.map(([from, to]) => ({
            observedAt: { gte: at(from), lt: at(to) },
          })),
        },
      });
      await prisma.mappingVersion.create({
        data: {
          version: 2,
          config: { ...DEFAULT_MAPPING_V1, gridMeterSign: -1 },
          provisional: true,
          note: 'reverse grid meter polarity',
        },
      });
      if (options.dropRawFrom !== undefined)
        await prisma.rawPoll.deleteMany({
          where: { observedAt: { gte: at(options.dropRawFrom), lt: at(w1) } },
        });
      const env = parseEnv({
        DATABASE_URL: db.url,
        COLLECTOR_ENABLED: 'false',
        RAW_RETENTION_DAYS: '400',
        SAMPLE_RETENTION_DAYS: '2',
      });
      const mutate = new AccountingMutations(
        prisma,
        env,
        new RawPollRenormalizer(prisma),
        () => now,
      );
      const renormalize = () =>
        mutate.requestRecalculation(
          'RENORMALIZE',
          at(windows[0]![0]),
          at(windows[0]![1]),
          'raw horizon window',
        );
      const requests = [];
      for (const [ws, we] of windows)
        requests.push(
          await mutate.requestRecalculation(
            'RENORMALIZE',
            at(ws),
            at(we),
            'raw horizon window',
          ),
        );
      const request = requests[0]!;
      return {
        w1,
        before,
        request,
        requests,
        renormalize,
        env,
        ledger: (hooks: LedgerOptions = {}) =>
          new LedgerService(prisma, env, { clock: () => now, ...hooks }),
      };
    }
    const windowKeys = (map: Map<number, EnergyInterval>, w1: number) =>
      [...map.keys()].filter(
        (ms) => ms >= at(W0).getTime() && ms < at(w1).getTime(),
      );
    const runStatus = async (id: number) =>
      await prisma.calculationRun.findUniqueOrThrow({ where: { id } });

    it('completes in one pass, rebuilds only the window and leaves older and newer history untouched', async () => {
      const s = await scenario();
      await s.ledger().processOnce(now);
      const after = await rows();
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      const run = await runStatus(s.request.id);
      expect(run.status).toBe('DONE');
      expect(run.rangeEnd).toEqual(at(s.w1));
      const w0 = at(W0).getTime();
      const w1 = at(s.w1).getTime();
      for (const [ms, old] of s.before) {
        if (ms >= w0 && ms < w1) continue;
        const current = after.get(ms);
        expect(current, `row ${ms}`).toBeDefined();
        // Only the single row right after the window may gain OUTSIDE_RETENTION.
        const mask = ms === w1 ? ~LedgerFlag.OUTSIDE_RETENTION : ~0;
        expect(exact(current!, mask)).toBe(exact(old, mask));
      }
      for (const ms of after.keys())
        if (ms < w0 || ms >= w1) expect(s.before.has(ms)).toBe(true);
      const inside = windowKeys(after, s.w1);
      expect(inside).toHaveLength(12);
      for (const ms of inside) expect(after.get(ms)!.mappingVersion).toBe(2);
    });

    it('does bounded work: compute calls scale with days, not buckets', async () => {
      // 72 buckets in one local day: a bucket-by-bucket walk would need far more than 12 calls
      const s = await scenario({ windowSec: 6 * 3600, windowStep: 300 });
      let calls = 0;
      await s
        .ledger({
          computeRange: (input) => {
            calls++;
            return computeRange(input);
          },
        })
        .processOnce(now);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      expect(calls).toBeLessThanOrEqual(12);
    });

    it('rebuilds an in-range bucket that has no samples but is bridged by counter spans', async () => {
      const s = await scenario({ outage: true });
      const outage = at(W0 + 1800).getTime();
      expect(s.before.get(outage)?.mappingVersion).toBe(1);
      await s.ledger().processOnce(now);
      const row = (await rows()).get(outage);
      expect(row?.mappingVersion).toBe(2);
      expect(row?.gridImportCounterWh).not.toBeNull();
    });

    it('derives the first rebuilt bucket from the stored starting state', async () => {
      const s = await scenario();
      await s.ledger().processOnce(now);
      const first = (await rows()).get(at(W0).getTime())!;
      // Stored baseline: last reading at W0-300. First rebuilt reading at W0+120 -> span of 420 s whose
      // [W0, W0+120] part is 200 Wh; three further 60 s spans (100 Wh each) finish the bucket.
      expect(first.gridImportCounterWh?.toString()).toBe('500');
      expect(first.counterUnknownSec[COUNTER_KEYS.indexOf('GRID_BUY')]).toBe(0);
    });

    it('a crash between chunks plus a retention run neither loses rebuilt samples nor changes the result', async () => {
      const s = await scenario({ windowSec: 36 * 3600, windowStep: 300 });
      let chunks = 0;
      await expect(
        s
          .ledger({
            onBeforeCommit: (stage) => {
              if (stage === 'chunk' && ++chunks === 2)
                throw new Error('crash in the second chunk');
            },
          })
          .processOnce(now),
      ).rejects.toThrow('crash in the second chunk');
      expect((await runStatus(s.request.id)).status).toBe('RUNNING');
      const inWindow = {
        observedAt: { gte: at(W0), lt: at(s.w1) },
      };
      const rebuilt = await prisma.sample.count({ where: inWindow });
      expect(rebuilt).toBeGreaterThan(0);
      await new RetentionService(prisma).runOnce(now, s.env);
      expect(await prisma.sample.count({ where: inWindow })).toBe(rebuilt);
      await s.ledger().processOnce(now);
      expect((await runStatus(s.request.id)).status).toBe('DONE');
      const crashed = await rows();
      // The same window rebuilt again without any interruption must give identical rows.
      const rerun = await s.renormalize();
      await s.ledger().processOnce(now);
      expect((await runStatus(rerun.id)).status).toBe('DONE');
      const uninterrupted = await rows();
      expect(uninterrupted.size).toBe(crashed.size);
      for (const [ms, row] of crashed)
        expect(signature(uninterrupted.get(ms)!)).toBe(signature(row));
    });

    it('never merges ordinary dirt into RENORMALIZE work: ordinary dirt stays clamped and flagged at the sample horizon', async () => {
      const s = await scenario();
      await prisma.ledgerDirtyRange.create({
        data: {
          fromBucket: at(W0 - 3600),
          toBucket: at(W0 + 7200),
          reason: 'RECALC_REQUEST',
        },
      });
      await s.ledger().processOnce(now);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      const after = await rows();
      for (
        let ms = at(W0 - 3600).getTime();
        ms < at(W0).getTime();
        ms += BUCKET_MS
      ) {
        const row = after.get(ms);
        if (!row) continue;
        expect(row.flags & LedgerFlag.OUTSIDE_RETENTION).not.toBe(0);
        expect(row.mappingVersion).toBe(1);
      }
      for (const ms of windowKeys(after, s.w1)) {
        expect(after.get(ms)!.mappingVersion).toBe(2);
        expect(after.get(ms)!.flags & LedgerFlag.OUTSIDE_RETENTION).toBe(0);
      }
      expect((await runStatus(s.request.id)).status).toBe('DONE');
    });

    it('write path: dirt that spans authoritative rows never rewrites them, even when their samples still exist', async () => {
      const w1 = W0 + 3600;
      const s = await scenario({
        retainSamples: [
          [W0 - 7200, W0],
          [w1, w1 + 7200],
        ],
      });
      const sentinels = [at(W0 - 600).getTime(), at(w1 + 300).getTime()];
      for (const ms of sentinels)
        await prisma.energyInterval.update({
          where: { bucketStart: new Date(ms) },
          data: { gridImportNetWh: 123.456 },
        });
      const before = await rows();
      await prisma.ledgerDirtyRange.create({
        data: {
          fromBucket: at(W0 - 7200),
          toBucket: at(w1 + 7200),
          reason: 'RENORMALIZE',
        },
      });
      await s.ledger().processOnce(now);
      const after = await rows();
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      for (const ms of sentinels)
        expect(after.get(ms)!.gridImportNetWh?.toString()).toBe('123.456');
      for (const [ms, old] of before) {
        if (ms >= at(W0).getTime() && ms < at(w1).getTime()) continue;
        const mask =
          ms === at(w1).getTime() ? ~LedgerFlag.OUTSIDE_RETENTION : ~0;
        expect(exact(after.get(ms)!, mask)).toBe(exact(old, mask));
      }
    });

    it('rebuilds several windows (adjacent and disjoint) in one pass and leaves everything between them untouched', async () => {
      const windows: [number, number][] = [
        [W0, W0 + 3600],
        [W0 + 3600, W0 + 7200], // adjacent: merges with the first into one writable interval
        [W0 + DAY, W0 + DAY + 3600], // disjoint: authoritative rows lie between
      ];
      const s = await scenario({ windows });
      await s.ledger().processOnce(now);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      for (const request of s.requests)
        expect((await runStatus(request.id)).status).toBe('DONE');
      const after = await rows();
      const inside = (ms: number) =>
        windows.some(
          ([from, to]) => ms >= at(from).getTime() && ms < at(to).getTime(),
        );
      const successors = new Set(
        [W0 + 7200, W0 + DAY + 3600].map((sec) => at(sec).getTime()),
      );
      for (const [ms, old] of s.before) {
        if (inside(ms)) {
          expect(after.get(ms)?.mappingVersion, `window row ${ms}`).toBe(2);
          continue;
        }
        const mask = successors.has(ms) ? ~LedgerFlag.OUTSIDE_RETENTION : ~0;
        expect(exact(after.get(ms)!, mask), `row ${ms}`).toBe(exact(old, mask));
      }
    });

    it('rebuilds a window that straddles the sample horizon: below it only the window changes, at/after it ordinary work applies', async () => {
      const start = 10 * DAY - 3600;
      const s = await scenario({ windows: [[start, 10 * DAY + 3600]] });
      await s.ledger().processOnce(now);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      expect((await runStatus(s.request.id)).status).toBe('DONE');
      const after = await rows();
      for (const [ms, old] of s.before) {
        if (ms < at(start).getTime())
          expect(exact(after.get(ms)!), `row ${ms}`).toBe(exact(old));
        else if (ms < at(10 * DAY + 3600).getTime())
          expect(after.get(ms)?.mappingVersion, `window row ${ms}`).toBe(2);
      }
    });

    it('converges when the first counter anchor lies inside a multi-day window whose early evidence is gone', async () => {
      const day2 = at(2 * DAY);
      const hours = (h: number) => h * 3600;
      // One early reading (the only anchor before the window's second local day), then a later witness.
      await ingest.ingest(
        clocked([0, hours(17), hours(17) + 600, hours(17) + 1200]),
        { maxRepeatSpanSec: 3600 },
      );
      await run(day2);
      await prisma.sample.deleteMany({});
      await prisma.rawPoll.deleteMany({
        where: { observedAt: { lt: at(hours(10)) } },
      });
      await prisma.mappingVersion.create({
        data: {
          version: 2,
          config: { ...DEFAULT_MAPPING_V1, gridMeterSign: -1 },
          provisional: true,
          note: 'reverse grid meter polarity',
        },
      });
      const env = parseEnv({
        DATABASE_URL: db.url,
        COLLECTOR_ENABLED: 'false',
        RAW_RETENTION_DAYS: '400',
        SAMPLE_RETENTION_DAYS: '1',
      });
      const request = await new AccountingMutations(
        prisma,
        env,
        new RawPollRenormalizer(prisma),
        () => day2,
      ).requestRecalculation('RENORMALIZE', at(0), at(hours(20)), 'multi-day');
      await new LedgerService(prisma, env, { clock: () => day2 }).processOnce(
        day2,
      );
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      expect((await runStatus(request.id)).status).toBe('DONE');
    });

    it('keeps stored rows inside the window that the rebuilt evidence cannot reproduce', async () => {
      const s = await scenario({ dropRawFrom: W0 + 1800 });
      // No later evidence either: the live tail is gone, so nothing can bridge past the last rebuilt sample.
      await prisma.sample.deleteMany({
        where: { observedAt: { gte: at(W0 + 1800) } },
      });
      await s.ledger().processOnce(now);
      expect((await runStatus(s.request.id)).status).toBe('DONE');
      const after = await rows();
      expect(after.get(at(W0).getTime())!.mappingVersion).toBe(2);
      for (const [ms, old] of s.before) {
        if (ms < at(W0 + 2100).getTime() || ms >= at(s.w1).getTime()) continue;
        expect(after.has(ms), `row ${ms}`).toBe(true);
        expect(exact(after.get(ms)!)).toBe(exact(old));
      }
    });
  });
});
