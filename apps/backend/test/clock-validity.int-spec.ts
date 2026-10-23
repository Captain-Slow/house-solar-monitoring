import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type pg from 'pg';
import {
  DEFAULT_MAPPING_V1,
  ensureMappingV1,
} from '../src/collector/mapping.js';
import {
  findMeterRepeatRun,
  IngestService,
} from '../src/collector/ingest.service.js';
import { RetentionService } from '../src/collector/retention.service.js';
import {
  initialRepeatState,
  normalizeFast,
  type RepeatState,
} from '../src/collector/normalize.js';
import { SampleFlag, type IngestPoll } from '../src/collector/types.js';
import { parseEnv } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { AccountingMutations } from '../src/accounting/accounting.mutations.js';
import { LedgerService } from '../src/accounting/ledger.service.js';
import { RawPollRenormalizer } from '../src/accounting/raw-poll-renormalizer.js';
import { encodeBlocks } from '../src/modbus/raw-poll-codec.js';
import { FAST_PLAN } from '../src/modbus/read-plan.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import { blocksFrom, plausibleImage, setReg } from './support/synthetic.js';

/**
 * Acquisition-time clock validity must survive ingestion, replay and accounting: wall-clock steps
 * and collector restarts are facts of acquisition that a rebuild from raw polls cannot unlearn.
 * Every reading uses a frozen meter image unless a voltage is given, so repeat durations matter.
 */
const base = Date.UTC(2026, 4, 1, 0, 0);
const at = (seconds: number) => new Date(base + seconds * 1000);
const MAX_REPEAT_SEC = DEFAULT_MAPPING_V1.maxRepeatSpanSec;
const HOUR = 3600;

let db: TestDatabase;
let prisma: PrismaService;
let ingest: IngestService;
let ledger: LedgerService;
let mutations: AccountingMutations;
let deviceId: number;
let runId: number;
let nextSeq: number;

interface Reading {
  /** Wall-clock second (what the OS clock said when the poll completed). */
  wall: number;
  /** Monotonic second of the collector process (never steps). */
  mono: number;
  gridW?: number;
  /** Changes the meter words, which restarts the repeat run. */
  voltage?: number;
  invalidMeter?: boolean;
}

async function newRun(): Promise<number> {
  nextSeq = 0;
  runId = (
    await prisma.collectorRun.create({
      data: {
        startedAt: at(0),
        appVersion: 'test',
        registerMapVersion: 'test',
      },
    })
  ).id;
  return runId;
}

async function setup() {
  db = await createTestDatabase();
  prisma = new PrismaService({ DATABASE_URL: db.url });
  const env = parseEnv({
    DATABASE_URL: db.url,
    COLLECTOR_ENABLED: 'false',
    SITE_TIMEZONE: 'Asia/Kuala_Lumpur',
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
    data: { kind: 'MODBUS_TCP', endpoint: `clock-${Date.now()}:502#1` },
  });
  deviceId = (
    await prisma.device.create({
      data: {
        dataSourceId: source.id,
        deviceKey: 'clock',
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
  await newRun();
}

/**
 * Acquires `readings` exactly like the collector: one RepeatState per run, normalization on the
 * run's monotonic clock, and (unless `legacy`) the monotonic midpoint handed to ingest.
 */
function acquire(
  readings: Reading[],
  options: { legacy?: boolean; state?: RepeatState } = {},
): { polls: IngestPoll[]; state: RepeatState } {
  let state = options.state ?? initialRepeatState();
  const polls = readings.map((reading) => {
    const image = plausibleImage({ gridW: reading.gridW ?? 1000, pvW: 0 });
    if (reading.voltage !== undefined)
      setReg(image, 'meter_grid_voltage_a', reading.voltage);
    const blocks = blocksFrom(FAST_PLAN, image);
    if (reading.invalidMeter)
      blocks.find((block) => block.start === 1800)!.words = null;
    const observedAt = at(reading.wall);
    const result = normalizeFast({
      blocks,
      observedAt,
      monotonicMs: reading.mono * 1000,
      mapping: { ...DEFAULT_MAPPING_V1, maxRepeatSpanSec: MAX_REPEAT_SEC },
      mappingVersion: 1,
      state,
    });
    state = result.state;
    return {
      runId,
      seq: ++nextSeq,
      deviceId,
      tier: 'FAST' as const,
      requestedAt: observedAt,
      receivedAt: observedAt,
      observedAt,
      blocks: encodeBlocks(blocks),
      ...(options.legacy ? {} : { monotonicMs: reading.mono * 1000 }),
      sample: result.sample,
      events: result.events,
    };
  });
  return { polls, state };
}

const ingestAll = (polls: IngestPoll[]) =>
  ingest.ingest(polls, { maxRepeatSpanSec: MAX_REPEAT_SEC });
const run = () => ledger.processOnce(at(100_000));
const renormalize = (from: number, to: number, reason = 'replay') =>
  mutations.requestRecalculation('RENORMALIZE', at(from), at(to), reason);

async function storedTiming(): Promise<
  { wall: number; flags: number; meterRepeatSec: number }[]
> {
  const rows = await prisma.sample.findMany({
    orderBy: [{ rawPoll: { runId: 'asc' } }, { rawPoll: { seq: 'asc' } }],
    select: { observedAt: true, flags: true, meterRepeatSec: true },
  });
  return rows.map((row) => ({
    wall: (row.observedAt.getTime() - base) / 1000,
    flags: row.flags,
    meterRepeatSec: row.meterRepeatSec,
  }));
}
const flagsOf = async (wall: number) =>
  (
    await prisma.sample.findUniqueOrThrow({
      where: { deviceId_observedAt: { deviceId, observedAt: at(wall) } },
    })
  ).flags;
const bucket = (second: number) =>
  prisma.energyInterval.findUniqueOrThrow({
    where: { bucketStart: at(second) },
  });

beforeEach(async () => {
  await setup();
});
afterEach(async () => {
  await prisma?.close();
  await db?.drop();
});

describe('acquisition clock validity across rebuilds', () => {
  it('persists the acquisition monotonic clock of FAST polls', async () => {
    const { polls } = acquire([
      { wall: 0, mono: 12.5 },
      { wall: 15, mono: 22.5 },
    ]);
    await ingestAll(polls);
    const stored = await prisma.rawPoll.findMany({ orderBy: { seq: 'asc' } });
    expect(stored.map((row) => row.monotonicMs)).toEqual([12_500, 22_500]);
    expect(stored.map((row) => row.acquisitionClockStep)).toEqual([
      false,
      true,
    ]);
    expect(stored.map((row) => row.acquisitionMeterRepeatSec)).toEqual([0, 10]);
  });

  it('unchanged-mapping RENORMALIZE keeps a CLOCK_STEP sample clock-invalid and adds no grid energy', async () => {
    // Ten monotonic seconds, fifteen wall seconds: the second poll is a clock step.
    await ingestAll(
      acquire([
        { wall: 0, mono: 0 },
        { wall: 15, mono: 10 },
      ]).polls,
    );
    expect((await flagsOf(15)) & SampleFlag.CLOCK_STEP).not.toBe(0);
    await run();
    const original = await bucket(0);
    expect(original.gridCoveredSec).toBe(0);
    expect(original.gridImportNetWh).toBeNull();

    await renormalize(0, 300);

    expect((await flagsOf(15)) & SampleFlag.CLOCK_STEP).not.toBe(0);
    await run();
    const replayed = await bucket(0);
    expect(replayed.gridCoveredSec).toBe(0);
    expect(replayed.gridImportNetWh).toBeNull();
  });

  it('RENORMALIZE reproduces repeat durations and flags after a backward wall-clock step', async () => {
    // Frozen meter; one hour is taken off the wall clock while monotonic time keeps running.
    // Acquisition order differs from wall order after the step.
    await ingestAll(
      acquire([
        { wall: 2 * HOUR, mono: 0 },
        { wall: 2 * HOUR + 10, mono: 10 },
        { wall: 2 * HOUR + 20, mono: 20 },
        { wall: 2 * HOUR + 30, mono: 30 },
        { wall: 2 * HOUR + 40, mono: 40 },
        { wall: HOUR + 50, mono: 50 },
        { wall: HOUR + 60, mono: 60 },
        { wall: HOUR + 70, mono: 70 },
      ]).polls,
    );
    const acquired = await storedTiming();
    expect(acquired.map((row) => row.meterRepeatSec)).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70,
    ]);
    expect(acquired[5]!.flags & SampleFlag.CLOCK_STEP).not.toBe(0);
    expect(acquired[6]!.flags & SampleFlag.CLOCK_STEP).toBe(0);

    await renormalize(HOUR, 3 * HOUR);

    expect(await storedTiming()).toEqual(acquired);
  });

  it('replays acquisition predecessors outside the wall-time range after a backward step', async () => {
    await ingestAll(
      acquire([
        { wall: 0, mono: 0 },
        // This hash change is outside the requested wall range, but precedes its last polls.
        { wall: 2 * HOUR, mono: 10, voltage: 2400 },
        { wall: 10, mono: 20, voltage: 2400 },
        { wall: 20, mono: 30, voltage: 2400 },
      ]).polls,
    );
    const acquired = await storedTiming();
    expect(acquired.map((row) => row.meterRepeatSec)).toEqual([0, 0, 10, 20]);

    await renormalize(0, 300);

    expect(await storedTiming()).toEqual(acquired);
  });

  it('keeps every frozen run stale when wall steps move intervening acquisitions outside the range', async () => {
    await ingestAll(
      acquire([
        { wall: 0, mono: 0 },
        { wall: 10, mono: 10 },
        { wall: 2 * HOUR + 20, mono: 20 },
        { wall: 2 * HOUR + 40, mono: 40 },
        { wall: 2 * HOUR + 50, mono: 50, voltage: 2400 },
        { wall: 20, mono: 60, voltage: 2400 },
      ]).polls,
    );
    const acquired = await storedTiming();
    expect(acquired[0]!.flags & SampleFlag.METER_STALE).not.toBe(0);
    expect(acquired[5]!.flags & SampleFlag.METER_STALE).toBe(0);

    await renormalize(0, 300);

    expect(await storedTiming()).toEqual(acquired);
  });

  it('RENORMALIZE starts every collector run from a fresh repeat state', async () => {
    // Monotonic clocks of different processes are unrelated, so a restart is a new run.
    await ingestAll(
      acquire([
        { wall: 0, mono: 100 },
        { wall: 10, mono: 110 },
        { wall: 20, mono: 120 },
      ]).polls,
    );
    await newRun();
    await ingestAll(
      acquire([
        { wall: 30, mono: 0 },
        { wall: 40, mono: 10 },
        { wall: 50, mono: 20 },
      ]).polls,
    );
    const acquired = await storedTiming();
    expect(acquired.map((row) => row.meterRepeatSec)).toEqual([
      0, 10, 20, 0, 10, 20,
    ]);
    expect(acquired.some((row) => row.flags & SampleFlag.CLOCK_STEP)).toBe(
      false,
    );

    await renormalize(0, 300);

    expect(await storedTiming()).toEqual(acquired);
  });

  it('RENORMALIZE never replaces a stored acquisition CLOCK_STEP when the preceding poll was pruned', async () => {
    await ingestAll(
      acquire([
        { wall: 0, mono: 0 },
        { wall: 15, mono: 10 },
        { wall: 25, mono: 20 },
      ]).polls,
    );
    expect((await flagsOf(15)) & SampleFlag.CLOCK_STEP).not.toBe(0);
    // Raw-poll retention removed the predecessor; the replay now starts at the stepped poll.
    const first = await prisma.sample.findUniqueOrThrow({
      where: { deviceId_observedAt: { deviceId, observedAt: at(0) } },
    });
    await prisma.sample.delete({ where: { id: first.id } });
    await prisma.rawPoll.delete({ where: { id: first.rawPollId } });

    await renormalize(0, 300);

    expect((await flagsOf(15)) & SampleFlag.CLOCK_STEP).not.toBe(0);
    expect((await flagsOf(25)) & SampleFlag.CLOCK_STEP).toBe(0);
  });

  it('RENORMALIZE continues a frozen run whose earlier raw polls were pruned instead of restarting its age', async () => {
    await ingestAll(
      acquire(
        Array.from({ length: 10 }, (_, i) => ({ wall: i * 10, mono: i * 10 })),
      ).polls,
    );
    const acquired = await storedTiming();
    expect(acquired.map((row) => row.meterRepeatSec)).toEqual([
      0, 10, 20, 30, 40, 50, 60, 70, 80, 90,
    ]);
    // Raw-poll retention removed the first five polls; the replay starts mid-run.
    const pruned = await prisma.sample.findMany({
      where: { observedAt: { lt: at(50) } },
    });
    await prisma.sample.deleteMany({
      where: { id: { in: pruned.map((row) => row.id) } },
    });
    await prisma.rawPoll.deleteMany({
      where: { id: { in: pruned.map((row) => row.rawPollId) } },
    });

    await renormalize(0, 300);

    expect(await storedTiming()).toEqual(acquired.slice(5));
    expect(
      (await storedTiming()).every((row) => row.flags & SampleFlag.METER_STALE),
    ).toBe(true);
  });

  it('rebuilds the recorded clock validity and frozen age when sample retention and raw retention removed the predecessor', async () => {
    await ingestAll(
      acquire([
        { wall: 0, mono: 0 },
        { wall: 15, mono: 10 },
        { wall: 25, mono: 20 },
        { wall: 35, mono: 30 },
        { wall: 45, mono: 40 },
        { wall: 55, mono: 50 },
      ]).polls,
    );
    const acquired = await storedTiming();
    await run(); // Retention correctly pins pending ledger input; clear the dirty range first.
    expect(
      await new RetentionService(prisma).runOnce(at(2 * 86_400 + 10), {
        RAW_RETENTION_DAYS: 2,
        SAMPLE_RETENTION_DAYS: 1,
      }),
    ).toEqual({ deletedSamples: 6, deletedRawPolls: 1 });

    await renormalize(0, 300);

    expect(await storedTiming()).toEqual(acquired.slice(1));
    await run();
    expect((await bucket(0)).gridCoveredSec).toBe(0);
  });

  it('does not let a wall-clock duplicate timestamp overwrite the first-acquired sample', async () => {
    const first = acquire([
      { wall: 100, mono: 0, gridW: 1000 },
      { wall: 110, mono: 10, gridW: 1000 },
    ]);
    // Wall clock steps back onto 100 s: ingest keeps the first sample for that instant.
    const stepped = acquire([{ wall: 100, mono: 20, gridW: 2000 }], {
      state: first.state,
    });
    await ingestAll([...first.polls, ...stepped.polls]);
    expect(await prisma.rawPoll.count()).toBe(3);
    expect(await prisma.sample.count()).toBe(2);

    await renormalize(0, 300);

    const kept = await prisma.sample.findUniqueOrThrow({
      where: { deviceId_observedAt: { deviceId, observedAt: at(100) } },
    });
    expect(kept.gridW).toBe(1000);
    expect(await prisma.sample.count()).toBe(2);
  });

  describe('rows captured before the monotonic column existed', () => {
    it('keep their stored acquisition timing and are never re-derived from wall time', async () => {
      await ingestAll(
        acquire(
          [
            { wall: 0, mono: 0 },
            { wall: 15, mono: 10 },
            { wall: 25, mono: 20 },
            { wall: 35, mono: 30 },
            { wall: 45, mono: 40 },
          ],
          { legacy: true },
        ).polls,
      );
      expect(
        (await prisma.rawPoll.findMany()).every(
          (row) => row.monotonicMs === null,
        ),
      ).toBe(true);
      const acquired = await storedTiming();
      expect(acquired[1]!.flags & SampleFlag.CLOCK_STEP).not.toBe(0);

      await renormalize(0, 300);

      const replayed = await storedTiming();
      expect(replayed.map((row) => row.meterRepeatSec)).toEqual(
        acquired.map((row) => row.meterRepeatSec),
      );
      expect(replayed.map((row) => row.flags & SampleFlag.CLOCK_STEP)).toEqual(
        acquired.map((row) => row.flags & SampleFlag.CLOCK_STEP),
      );
      await run();
      expect((await bucket(0)).gridCoveredSec).toBe(0);
    });

    it('are rebuilt as clock-invalid when their stored sample no longer exists', async () => {
      await ingestAll(
        acquire(
          [
            { wall: 0, mono: 0 },
            { wall: 10, mono: 10 },
          ],
          { legacy: true },
        ).polls,
      );
      await prisma.sample.deleteMany({
        where: { observedAt: at(10) },
      });

      await renormalize(0, 300);

      const rebuilt = await prisma.sample.findUniqueOrThrow({
        where: { deviceId_observedAt: { deviceId, observedAt: at(10) } },
      });
      expect(rebuilt.flags & SampleFlag.CLOCK_STEP).not.toBe(0);
      expect(rebuilt.gridW).toBe(1000);
    });
  });
});

describe('a frozen meter cannot regain validity through a clock change', () => {
  it('flags every post-step sample stale, and the ledger counts no grid energy for them', async () => {
    await ingestAll(
      acquire([
        { wall: 2 * HOUR, mono: 0 },
        { wall: 2 * HOUR + 10, mono: 10 },
        { wall: 2 * HOUR + 20, mono: 20 },
        { wall: 2 * HOUR + 30, mono: 30 },
        { wall: 2 * HOUR + 40, mono: 40 },
        // One hour is taken off the wall clock while monotonic time continues.
        { wall: HOUR + 50, mono: 50 },
        { wall: HOUR + 60, mono: 60 },
        { wall: HOUR + 70, mono: 70 },
        { wall: HOUR + 80, mono: 80 },
      ]).polls,
    );
    for (const wall of [HOUR + 50, HOUR + 60, HOUR + 70, HOUR + 80]) {
      expect((await flagsOf(wall)) & SampleFlag.METER_STALE).not.toBe(0);
    }
    await run();
    const rewound = await bucket(HOUR);
    expect(rewound.gridCoveredSec).toBe(0);
    expect(rewound.gridImportNetWh).toBeNull();
    expect((await bucket(2 * HOUR)).gridCoveredSec).toBe(0);
  });

  it('retroactively flags readings acquired before the step once the frozen run exceeds the limit', async () => {
    await ingestAll(
      acquire([
        { wall: 2 * HOUR, mono: 0 },
        { wall: 2 * HOUR + 10, mono: 10 },
        { wall: 2 * HOUR + 20, mono: 20 },
        { wall: HOUR + 30, mono: 30 },
        { wall: HOUR + 40, mono: 40 },
      ]).polls,
    );
    for (const wall of [2 * HOUR, 2 * HOUR + 10, 2 * HOUR + 20]) {
      expect((await flagsOf(wall)) & SampleFlag.METER_STALE).not.toBe(0);
    }
    await run();
    expect((await bucket(2 * HOUR)).gridCoveredSec).toBe(0);
    expect((await bucket(HOUR)).gridCoveredSec).toBe(0);
  });

  it('does not flag unrelated samples that merely lie between the two wall-clock epochs', async () => {
    const earlier = acquire([{ wall: HOUR + 5, mono: 0, voltage: 231 }]);
    await ingestAll(earlier.polls);
    await newRun();
    await ingestAll(
      acquire([
        { wall: 2 * HOUR, mono: 100 },
        { wall: 2 * HOUR + 10, mono: 110 },
        { wall: 2 * HOUR + 20, mono: 120 },
        { wall: HOUR + 30, mono: 130 },
        { wall: HOUR + 40, mono: 140 },
      ]).polls,
    );
    // The wall span of the stale run contains HOUR + 5, which belongs to another run.
    expect((await flagsOf(HOUR + 5)) & SampleFlag.METER_STALE).toBe(0);
  });

  it('keeps the same readings stale when a later unchanged-mapping RENORMALIZE rebuilds them', async () => {
    await ingestAll(
      acquire([
        { wall: 2 * HOUR, mono: 0 },
        { wall: 2 * HOUR + 10, mono: 10 },
        { wall: 2 * HOUR + 20, mono: 20 },
        { wall: HOUR + 30, mono: 30 },
        { wall: HOUR + 40, mono: 40 },
        { wall: HOUR + 50, mono: 50 },
      ]).polls,
    );
    const acquired = await storedTiming();

    await renormalize(HOUR, 3 * HOUR);

    expect(await storedTiming()).toEqual(acquired);
    await run();
    expect((await bucket(HOUR)).gridCoveredSec).toBe(0);
    expect((await bucket(2 * HOUR)).gridCoveredSec).toBe(0);
  });
});

describe('renormalizing frozen-meter runs from persisted clocks', () => {
  it('preserves unstale energy across a gap that ends a repeat run', async () => {
    await ingestAll(
      acquire(
        [0, 10, 20, 100, 110].map((second) => ({ wall: second, mono: second })),
      ).polls,
    );
    await run();
    const before = await bucket(0);
    expect(before.gridImportNetWh?.toString()).toBe('5.556');
    expect(before.gridCoveredSec).toBe(20);
    const acquired = await storedTiming();

    await renormalize(0, 300);

    expect(await storedTiming()).toEqual(acquired);
    await run();
    const after = await bucket(0);
    expect(after.gridImportNetWh?.toString()).toBe('5.556');
    expect(after.gridCoveredSec).toBe(20);
  });

  const crossing = (second: number) => ({
    wall: second,
    mono: second,
    voltage: second === 280 ? 231 : 230,
  });

  it('retains staleness when its triggering repeat reading lies beyond the replay end', async () => {
    await ingestAll(
      acquire([280, 290, 300, 310, 320, 330].map(crossing)).polls,
    );
    const outside = await prisma.sample.findUniqueOrThrow({
      where: { deviceId_observedAt: { deviceId, observedAt: at(330) } },
    });
    expect(outside.flags & SampleFlag.METER_STALE).not.toBe(0);
    await prisma.sample.updateMany({
      where: { observedAt: at(290) },
      data: { flags: 0 },
    });

    await renormalize(0, 300);

    expect((await flagsOf(290)) & SampleFlag.METER_STALE).not.toBe(0);
    expect(
      await prisma.sample.findUniqueOrThrow({
        where: { deviceId_observedAt: { deviceId, observedAt: at(330) } },
      }),
    ).toEqual(outside);
  });

  it('follows the crossing run through raw polls when the stored samples beyond the replay are gone', async () => {
    await ingestAll(
      acquire([280, 290, 300, 310, 320, 330].map(crossing)).polls,
    );
    await prisma.sample.deleteMany({
      where: { observedAt: { gte: at(300) } },
    });
    await prisma.sample.updateMany({
      where: { observedAt: at(290) },
      data: { flags: 0 },
    });

    await renormalize(0, 300);

    expect((await flagsOf(290)) & SampleFlag.METER_STALE).not.toBe(0);
    expect((await flagsOf(280)) & SampleFlag.METER_STALE).toBe(0);
    expect(
      await prisma.sample.count({ where: { observedAt: { gte: at(300) } } }),
    ).toBe(0);
  });

  it('does not let a following poll in another collector run extend the crossing run', async () => {
    await ingestAll(acquire([280, 290].map(crossing)).polls);
    await newRun();
    // A new process has an unrelated monotonic clock; its frozen readings never continue the run.
    await ingestAll(
      acquire(
        [300, 310, 320, 330].map((second) => ({
          wall: second,
          mono: second - 300,
          voltage: 230,
        })),
      ).polls,
    );
    await prisma.sample.deleteMany({ where: { observedAt: { gte: at(300) } } });
    await prisma.sample.updateMany({
      where: { observedAt: at(290) },
      data: { flags: 0 },
    });

    await renormalize(0, 300);

    expect((await flagsOf(290)) & SampleFlag.METER_STALE).toBe(0);
  });
});

describe('retained acquisition evidence regressions', () => {
  it('limits stale proof only after a strict retained witness while full lookup preserves retroactive membership', async () => {
    const first = acquire(
      [100, 110, 120, 130].map((wall, i) => ({ wall, mono: i * 10 })),
    );
    await ingestAll(first.polls);
    const collision = acquire([{ wall: 100, mono: 40 }], {
      state: first.state,
    });
    await ingestAll(collision.polls);
    await ingestAll(
      acquire(
        [
          { wall: 140, mono: 50 },
          { wall: 150, mono: 60 },
        ],
        { state: collision.state },
      ).polls,
    );
    const raws = await prisma.rawPoll.findMany({ orderBy: { seq: 'asc' } });
    const anchor = raws[0]!.id;
    const proof = await findMeterRepeatRun(
      prisma,
      deviceId,
      anchor,
      MAX_REPEAT_SEC,
      30,
    );
    expect(proof.maxRepeatSec).toBe(40);
    expect(proof.rawPollIds).toContain(raws[4]!.id); // raw-only duplicate is the witness
    expect(proof.rawPollIds).not.toContain(raws[5]!.id);
    const equality = await findMeterRepeatRun(
      prisma,
      deviceId,
      anchor,
      MAX_REPEAT_SEC,
      40,
    );
    expect(equality.maxRepeatSec).toBe(50);
    const full = await findMeterRepeatRun(
      prisma,
      deviceId,
      anchor,
      MAX_REPEAT_SEC,
    );
    expect(new Set(full.rawPollIds)).toEqual(
      new Set(raws.map((raw) => raw.id)),
    );
    expect(full.maxRepeatSec).toBe(60);

    await prisma.rawPoll.delete({ where: { id: raws[4]!.id } });
    const unknownBoundary = await findMeterRepeatRun(
      prisma,
      deviceId,
      anchor,
      MAX_REPEAT_SEC,
      30,
    );
    expect(unknownBoundary.maxRepeatSec).toBe(30);
    expect(new Set(unknownBoundary.rawPollIds)).toEqual(
      new Set(raws.slice(0, 4).map((raw) => raw.id)),
    );
  });

  it('keeps immutable repeat ages across interior wall-retention holes without adding energy', async () => {
    await ingestAll(
      acquire([
        { wall: 100, mono: 0, voltage: 231 },
        ...[10, 20, 30, 40].map((wall, i) => ({ wall, mono: (i + 1) * 10 })),
        { wall: 110, mono: 50 },
        { wall: 120, mono: 60 },
        { wall: 130, mono: 70 },
      ]).polls,
    );
    const removed = await prisma.sample.findMany({
      where: { observedAt: { gte: at(10), lte: at(40) } },
    });
    await prisma.sample.deleteMany({
      where: { id: { in: removed.map((s) => s.id) } },
    });
    await prisma.rawPoll.deleteMany({
      where: { id: { in: removed.map((s) => s.rawPollId) } },
    });
    await run();
    expect((await bucket(0)).gridCoveredSec).toBe(0);
    const facts = await prisma.rawPoll.findMany({ orderBy: { seq: 'asc' } });

    await renormalize(0, 300);

    expect((await storedTiming()).map((s) => s.meterRepeatSec)).toEqual([
      0, 40, 50, 60,
    ]);
    expect(await prisma.rawPoll.findMany({ orderBy: { seq: 'asc' } })).toEqual(
      facts,
    );
    await run();
    expect((await bucket(0)).gridCoveredSec).toBe(0);
    expect((await bucket(0)).gridImportNetWh).toBeNull();
  });

  it('uses raw-only duplicate evidence to invalidate the entire frozen acquisition run', async () => {
    await ingestAll(acquire([{ wall: 115, mono: 0, voltage: 231 }]).polls);
    await newRun();
    const first = acquire(
      [100, 110, 120, 130].map((wall, i) => ({ wall, mono: i * 10 })),
    );
    await ingestAll(first.polls);
    await run();
    expect((await bucket(0)).gridCoveredSec).toBeGreaterThan(0);
    const original = await prisma.sample.findUniqueOrThrow({
      where: { deviceId_observedAt: { deviceId, observedAt: at(100) } },
    });
    const collision = acquire([{ wall: 100, mono: 40 }], {
      state: first.state,
    });
    expect(await ingestAll(collision.polls)).toEqual({
      insertedSamples: 0,
      duplicateSamples: 1,
    });

    for (const wall of [100, 110, 120, 130])
      expect((await flagsOf(wall)) & SampleFlag.METER_STALE).not.toBe(0);
    expect((await flagsOf(115)) & SampleFlag.METER_STALE).toBe(0);
    expect(await prisma.ledgerDirtyRange.count()).toBeGreaterThan(0);
    const kept = await prisma.sample.findUniqueOrThrow({
      where: { id: original.id },
    });
    expect(kept.rawPollId).toBe(original.rawPollId);
    expect(kept.meterRepeatSec).toBe(0);
    expect(kept.gridW).toBe(original.gridW);
    await ingestAll(
      acquire([{ wall: 140, mono: 50, voltage: 232 }], {
        state: collision.state,
      }).polls,
    );
    await run();
    expect((await bucket(0)).gridCoveredSec).toBe(0);
    await renormalize(0, 300);
    for (const wall of [100, 110, 120, 130])
      expect((await flagsOf(wall)) & SampleFlag.METER_STALE).not.toBe(0);
    expect((await flagsOf(115)) & SampleFlag.METER_STALE).toBe(0);
  });

  it('does not extend a returned hash across pruned changed words or a collector restart', async () => {
    await ingestAll(
      acquire([
        { wall: 100, mono: 0 },
        { wall: 10, mono: 10, voltage: 231 },
        ...[110, 120, 130, 140].map((wall, i) => ({ wall, mono: 20 + i * 10 })),
      ]).polls,
    );
    const removed = await prisma.sample.findFirstOrThrow({
      where: { observedAt: at(10) },
    });
    await prisma.sample.delete({ where: { id: removed.id } });
    await prisma.rawPoll.delete({ where: { id: removed.rawPollId } });
    await newRun();
    await ingestAll(
      acquire([
        { wall: 150, mono: 0 },
        { wall: 160, mono: 10 },
      ]).polls,
    );
    const acquired = await storedTiming();

    await renormalize(0, 300);

    expect(await storedTiming()).toEqual(acquired);
    expect(acquired.map((s) => s.meterRepeatSec)).toEqual([
      0, 0, 10, 20, 30, 0, 10,
    ]);
    expect(acquired.every((s) => !(s.flags & SampleFlag.METER_STALE))).toBe(
      true,
    );
  });

  it('keeps each recorded age when the first retained meter block is invalid', async () => {
    await ingestAll(
      acquire(
        [0, 10, 20, 30, 40].map((wall) => ({
          wall,
          mono: wall,
          invalidMeter: wall === 20,
        })),
      ).polls,
    );
    const acquired = await storedTiming();
    const removed = await prisma.sample.findMany({
      where: { observedAt: { lt: at(20) } },
    });
    await prisma.sample.deleteMany({
      where: { id: { in: removed.map((s) => s.id) } },
    });
    await prisma.rawPoll.deleteMany({
      where: { id: { in: removed.map((s) => s.rawPollId) } },
    });

    await renormalize(0, 300);

    expect(await storedTiming()).toEqual(acquired.slice(2));
    expect((await storedTiming()).map((s) => s.meterRepeatSec)).toEqual([
      20, 30, 40,
    ]);
  });

  it.each([false, true])(
    'treats an invalid raw-only collision as a boundary (legacy=%s)',
    async (legacy) => {
      const first = acquire(
        [100, 110, 120].map((wall, i) => ({ wall, mono: i * 10 })),
        { legacy },
      );
      await ingestAll(first.polls);
      const invalid = acquire([{ wall: 100, mono: 30, invalidMeter: true }], {
        state: first.state,
        legacy,
      });
      const later = acquire([{ wall: 130, mono: 40 }], {
        state: invalid.state,
        legacy,
      });
      await ingestAll([...invalid.polls, ...later.polls]);

      for (const wall of [100, 110, 120])
        expect((await flagsOf(wall)) & SampleFlag.METER_STALE).toBe(0);
      expect((await flagsOf(130)) & SampleFlag.METER_STALE).not.toBe(0);
      await renormalize(0, 300);
      for (const wall of [100, 110, 120])
        expect((await flagsOf(wall)) & SampleFlag.METER_STALE).toBe(0);
    },
  );

  it.each(['repair', 'renormalize'] as const)(
    'does not join frozen runs across a retained-history hole left by an invalid FAST collision (%s)',
    async (mode) => {
      const first = acquire(
        [100, 110, 120].map((wall, i) => ({ wall, mono: i * 10 })),
      );
      await ingestAll(first.polls);
      const invalid = acquire([{ wall: 100, mono: 30, invalidMeter: true }], {
        state: first.state,
      });
      const later = acquire([{ wall: 130, mono: 40 }], {
        state: invalid.state,
      });
      await ingestAll([...invalid.polls, ...later.polls]);
      await run();
      const acquired = await storedTiming();
      expect(acquired.map((sample) => sample.meterRepeatSec)).toEqual([
        0, 10, 20, 40,
      ]);
      for (const wall of [100, 110, 120])
        expect((await flagsOf(wall)) & SampleFlag.METER_STALE).toBe(0);
      expect((await flagsOf(130)) & SampleFlag.METER_STALE).not.toBe(0);
      const before = await bucket(0);
      expect(before.gridCoveredSec).toBe(20);

      // Raw retention can remove the colliding invalid acquisition while all four
      // sample-backed raws survive the same cutoff. No wall-time ordering proves continuity.
      expect(
        await new RetentionService(prisma).runOnce(
          new Date(at(105).getTime() + 86_400_000),
          { RAW_RETENTION_DAYS: 1, SAMPLE_RETENTION_DAYS: 30 },
        ),
      ).toEqual({ deletedSamples: 0, deletedRawPolls: 1 });
      expect(
        (
          await prisma.rawPoll.findMany({
            orderBy: { seq: 'asc' },
            select: { seq: true },
          })
        ).map((poll) => poll.seq),
      ).toEqual([1, 2, 3, 5]);

      if (mode === 'repair')
        expect(
          await new RawPollRenormalizer(prisma).repairAcquisitionValidity(
            base,
            base + 300_000,
          ),
        ).toEqual({
          changedSamples: 0,
          dirtyFrom: null,
          dirtyTo: null,
        });
      else await renormalize(0, 300);

      expect(await storedTiming()).toEqual(acquired);
      await run();
      const after = await bucket(0);
      expect(after.gridCoveredSec).toBe(before.gridCoveredSec);
      expect(after.gridImportNetWh).toEqual(before.gridImportNetWh);
    },
  );

  it.each(['repair', 'renormalize'] as const)(
    'joins a frozen FAST run through retained SLOW, SETTINGS and DETECT sequence entries across devices (%s)',
    async (mode) => {
      const first = acquire(
        [100, 110, 120].map((wall, i) => ({ wall, mono: i * 10 })),
      );
      const { dataSourceId } = await prisma.device.findUniqueOrThrow({
        where: { id: deviceId },
        select: { dataSourceId: true },
      });
      const statusDevice = await prisma.device.create({
        data: {
          dataSourceId,
          deviceKey: 'status-only',
          role: 'INVERTER',
          model: 'synthetic',
          observedCapabilities: {},
          firmware: {},
          capabilitiesObservedAt: at(0),
          firstSeenAt: at(0),
          lastSeenAt: at(0),
        },
      });
      const status: IngestPoll[] = (
        ['SLOW', 'SETTINGS', 'DETECT'] as const
      ).map((tier, i) => ({
        runId,
        seq: ++nextSeq,
        deviceId: tier === 'SETTINGS' ? statusDevice.id : deviceId,
        tier,
        requestedAt: at(121 + i),
        receivedAt: at(121 + i),
        observedAt: at(121 + i),
        blocks: encodeBlocks([]),
        events: [],
      }));
      const later = acquire([{ wall: 140, mono: 40 }], {
        state: first.state,
      });
      await ingestAll([...first.polls, ...status, ...later.polls]);
      const acquired = await storedTiming();
      expect(
        acquired.every((sample) => sample.flags & SampleFlag.METER_STALE),
      ).toBe(true);
      expect(await prisma.rawPoll.count()).toBe(7);
      expect(await prisma.sample.count()).toBe(4);
      // Recreate historical missing retroactive flags: the later acquisition still proves
      // the entire retained FAST run stale despite its non-FAST sequence interleaving.
      await prisma.sample.updateMany({
        where: { observedAt: { lt: at(140) } },
        data: { flags: 0 },
      });

      if (mode === 'repair')
        expect(
          (
            await new RawPollRenormalizer(prisma).repairAcquisitionValidity(
              base,
              base + 300_000,
            )
          ).changedSamples,
        ).toBe(3);
      else await renormalize(0, 300);

      expect(await storedTiming()).toEqual(acquired);
      await run();
      expect((await bucket(0)).gridCoveredSec).toBe(0);
      expect((await bucket(0)).gridImportNetWh).toBeNull();
    },
  );

  it('repairs historical validity without remapping or changing normalized values, and is idempotent', async () => {
    const first = acquire(
      [100, 110, 120, 130].map((wall, i) => ({ wall, mono: i * 10 })),
    );
    await ingestAll(first.polls);
    await ingestAll(
      acquire([{ wall: 100, mono: 40 }], { state: first.state }).polls,
    );
    await run();
    const original = await prisma.sample.findMany({ orderBy: { id: 'asc' } });
    const secondMapping = await prisma.mappingVersion.create({
      data: {
        version: 2,
        config: { ...DEFAULT_MAPPING_V1, gridMeterSign: -1 },
        provisional: false,
        note: 'preserve original mapping',
      },
    });
    await prisma.sample.updateMany({
      where: { observedAt: at(110) },
      data: { mappingVersion: secondMapping.version },
    });
    await prisma.sample.updateMany({
      data: { flags: 0, meterRepeatSec: 0 },
    });
    const corrupted = await prisma.sample.findMany({ orderBy: { id: 'asc' } });
    const rawFacts = await prisma.rawPoll.findMany({ orderBy: { id: 'asc' } });
    const repair = new RawPollRenormalizer(prisma);

    const result = await repair.repairAcquisitionValidity(base, base + 300_000);

    expect(result).toEqual({
      changedSamples: 4,
      dirtyFrom: at(0),
      dirtyTo: at(300),
    });
    const repaired = await prisma.sample.findMany({ orderBy: { id: 'asc' } });
    for (let i = 0; i < repaired.length; i++) {
      expect(repaired[i]).toEqual({
        ...corrupted[i],
        meterRepeatSec: original[i]!.meterRepeatSec,
        flags: original[i]!.flags,
      });
    }
    expect(await prisma.rawPoll.findMany({ orderBy: { id: 'asc' } })).toEqual(
      rawFacts,
    );
    expect(await prisma.ledgerDirtyRange.count()).toBeGreaterThan(0);
    const dirtyCount = await prisma.ledgerDirtyRange.count();
    expect(
      await repair.repairAcquisitionValidity(base, base + 300_000),
    ).toEqual({
      changedSamples: 0,
      dirtyFrom: null,
      dirtyTo: null,
    });
    expect(await prisma.ledgerDirtyRange.count()).toBe(dirtyCount);
    await run();
    expect((await bucket(0)).gridCoveredSec).toBe(0);
  });

  it('does not overwrite a concurrent raw-only stale verdict while repairing a recorded age', async () => {
    const first = acquire(
      [100, 110, 120, 130].map((wall, i) => ({ wall, mono: i * 10 })),
    );
    await ingestAll(first.polls);
    await prisma.sample.updateMany({
      where: { observedAt: at(110) },
      data: { meterRepeatSec: 0 },
    });
    const live = new PrismaService({ DATABASE_URL: db.url });
    const collision = acquire([{ wall: 100, mono: 40 }], {
      state: first.state,
    });
    let entered!: () => void;
    const atWrite = new Promise<void>((resolve) => {
      entered = resolve;
    });
    let release!: () => void;
    const resume = new Promise<void>((resolve) => {
      release = resolve;
    });
    let paused = false;
    const clients = new WeakSet<pg.PoolClient>();
    const spies: Array<{ mockRestore: () => void }> = [];
    const onAcquire = (client: pg.PoolClient) => {
      if (clients.has(client)) return;
      clients.add(client);
      const original = client.query.bind(client);
      spies.push(
        vi.spyOn(client, 'query').mockImplementation(async (...args) => {
          const query = args[0] as string | pg.QueryConfig;
          const text = typeof query === 'string' ? query : query.text;
          if (
            !paused &&
            /^\s*UPDATE\s+(?:"public"\.)?"Sample"/.test(text) &&
            text.includes('"meterRepeatSec"')
          ) {
            paused = true;
            entered();
            await resume;
          }
          return Reflect.apply(original, client, args);
        }),
      );
    };
    prisma.pool.on('acquire', onAcquire);
    const repairing = new RawPollRenormalizer(prisma).repairAcquisitionValidity(
      base,
      base + 300_000,
    );
    try {
      await Promise.race([
        atWrite,
        repairing.then(() => {
          throw new Error('Repair finished without reaching its Sample write');
        }),
      ]);
      // The repair has already read the first four acquisitions and their non-stale flags.
      // A separate connection commits a real threshold-crossing raw-only collision first.
      expect(
        await new IngestService(live).ingest(collision.polls, {
          maxRepeatSpanSec: MAX_REPEAT_SEC,
        }),
      ).toEqual({ insertedSamples: 0, duplicateSamples: 1 });
      for (const wall of [100, 110, 120, 130])
        expect((await flagsOf(wall)) & SampleFlag.METER_STALE).not.toBe(0);
      release();
      expect((await repairing).changedSamples).toBe(1);
    } finally {
      release();
      try {
        await repairing;
      } finally {
        prisma.pool.off('acquire', onAcquire);
        for (const spy of spies) spy.mockRestore();
        await live.close();
      }
    }

    expect(paused).toBe(true);
    expect(
      (await storedTiming()).map((sample) => sample.meterRepeatSec),
    ).toEqual([0, 10, 20, 30]);
    for (const wall of [100, 110, 120, 130])
      expect((await flagsOf(wall)) & SampleFlag.METER_STALE).not.toBe(0);
    expect(await prisma.sample.count()).toBe(4);
    await run();
    expect((await bucket(0)).gridCoveredSec).toBe(0);
    expect((await bucket(0)).gridImportNetWh).toBeNull();
  });

  it('repairs only in-range immutable timing, preserving clock facts and opaque legacy Samples', async () => {
    await ingestAll(
      acquire([
        { wall: 100, mono: 0 },
        { wall: 110, mono: 50 },
        { wall: 120, mono: 60 },
      ]).polls,
    );
    await newRun();
    await ingestAll(acquire([{ wall: 200, mono: 0 }], { legacy: true }).polls);
    const expected = await prisma.sample.findMany({ orderBy: { id: 'asc' } });
    await prisma.sample.updateMany({
      where: { observedAt: { in: [at(110), at(120)] } },
      data: { flags: 0, meterRepeatSec: 0 },
    });
    const repair = new RawPollRenormalizer(prisma);

    expect(
      (await repair.repairAcquisitionValidity(base + 110_000, base + 120_000))
        .changedSamples,
    ).toBe(1);

    const after = await prisma.sample.findMany({ orderBy: { id: 'asc' } });
    expect(after[0]).toEqual(expected[0]);
    expect(after[1]).toEqual(expected[1]);
    expect(after[1]!.flags & SampleFlag.CLOCK_STEP).not.toBe(0);
    expect(after[2]!.meterRepeatSec).toBe(0);
    expect(after[2]!.flags).toBe(0);
    expect(after[3]).toEqual(expected[3]);
    expect(
      (await repair.repairAcquisitionValidity(base + 120_000, base + 300_000))
        .changedSamples,
    ).toBe(1);
    expect(await prisma.sample.findMany({ orderBy: { id: 'asc' } })).toEqual(
      expected,
    );
  });

  it('uses the requested threshold while retaining authoritative ages and untouched outside Samples', async () => {
    const polls = acquire(
      [0, 10, 20, 30, 40].map((wall) => ({ wall, mono: wall })),
    ).polls;
    await ingestAll(polls);
    const outside = await prisma.sample.findUniqueOrThrow({
      where: { deviceId_observedAt: { deviceId, observedAt: at(0) } },
    });
    await prisma.mappingVersion.create({
      data: {
        version: 2,
        config: { ...DEFAULT_MAPPING_V1, maxRepeatSpanSec: 60 },
        provisional: false,
        note: 'different replay threshold',
      },
    });

    await renormalize(10, 300);

    // Accounting requests round to buckets; call the replayer directly to exercise exact bounds.
    const before = await prisma.sample.findUniqueOrThrow({
      where: { id: outside.id },
    });
    await new RawPollRenormalizer(prisma).renormalize(
      base + 10_000,
      base + 40_000,
      await prisma.mappingVersion.findUniqueOrThrow({ where: { version: 2 } }),
    );
    expect(
      await prisma.sample.findUniqueOrThrow({ where: { id: outside.id } }),
    ).toEqual(before);
    const timing = await storedTiming();
    expect(timing.map((s) => s.meterRepeatSec)).toEqual([0, 10, 20, 30, 40]);
    expect(timing.every((s) => !(s.flags & SampleFlag.METER_STALE))).toBe(true);
  });

  it.each(['repair', 'renormalize'] as const)(
    'preserves known stale validity when the raw-only trigger has expired (%s)',
    async (mode) => {
      const first = acquire(
        [100, 110, 120, 130].map((wall, i) => ({ wall, mono: i * 10 })),
      );
      await ingestAll(first.polls);
      const collision = acquire([{ wall: 100, mono: 40 }], {
        state: first.state,
      });
      await ingestAll(collision.polls);
      await run();
      const known = await storedTiming();
      await prisma.rawPoll.delete({
        where: { runId_seq: { runId, seq: collision.polls[0]!.seq } },
      });

      if (mode === 'repair')
        await new RawPollRenormalizer(prisma).repairAcquisitionValidity(
          base,
          base + 300_000,
        );
      else await renormalize(0, 300);

      expect(await storedTiming()).toEqual(known);
      await run();
      expect((await bucket(0)).gridCoveredSec).toBe(0);
    },
  );
});
