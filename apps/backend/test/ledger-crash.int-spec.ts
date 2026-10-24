import { setTimeout as delay } from 'node:timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { parseEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import {
  LedgerService,
  type LedgerOptions,
} from '../src/accounting/ledger.service.js';
import { computeRange } from '../src/accounting/compute.js';
import { SampleFlag } from '../src/collector/types.js';
import {
  BUCKET_MS,
  LEDGER_ALGO_VERSION,
  LedgerFlag,
} from '../src/accounting/types.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

const base = Date.UTC(2026, 9, 25, 0, 0);
const at = (ms: number) => new Date(base + ms);
let db: TestDatabase;
let prisma: PrismaService;
let env: Env;
let deviceId: number;
let runId: number;
let sequence: number;

beforeEach(async () => {
  db = await createTestDatabase();
  prisma = new PrismaService({ DATABASE_URL: db.url });
  env = parseEnv({
    DATABASE_URL: db.url,
    COLLECTOR_ENABLED: 'false',
    SITE_TIMEZONE: 'Europe/Berlin',
  });
  await prisma.mappingVersion.create({
    data: { version: 1, config: {}, provisional: true, note: 'test' },
  });
  const source = await prisma.dataSource.create({
    data: { kind: 'MODBUS_TCP', endpoint: 'crash:502#1' },
  });
  deviceId = (
    await prisma.device.create({
      data: {
        dataSourceId: source.id,
        deviceKey: 'crash',
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
  sequence = 0;
});
afterEach(async () => {
  await prisma?.close();
  await db?.drop();
});

async function sample(
  ms: number,
  gridW = 1000,
  gridBuyWh: bigint | null = null,
  mappingVersion = 1,
): Promise<void> {
  const time = at(ms);
  const raw = await prisma.rawPoll.create({
    data: {
      runId,
      seq: ++sequence,
      deviceId,
      tier: 'FAST',
      requestedAt: time,
      receivedAt: time,
      observedAt: time,
      blocks: Buffer.alloc(0),
      contentHash: Buffer.alloc(32),
    },
  });
  await prisma.sample.create({
    data: {
      rawPollId: raw.id,
      deviceId,
      observedAt: time,
      mappingVersion,
      gridW,
      gridAW: (gridW / 3) | 0,
      gridBW: (gridW / 3) | 0,
      gridCW: (gridW / 3) | 0,
      pvW: 0,
      batteryW: 0,
      inverterAcW: 0,
      epsW: 0,
      batterySoc: 50,
      gridBuyWh,
      pvStringW: [],
      gridBuyPhaseWh: [],
      gridSellPhaseWh: [],
      meterRepeatSec: 0,
      flags: 0,
    },
  });
}
async function dirty(
  fromMs: number,
  toMs: number,
  reason: 'INGEST' | 'CALC_PARAMS' = 'INGEST',
) {
  return prisma.ledgerDirtyRange.create({
    data: { fromBucket: at(fromMs), toBucket: at(toMs), reason },
  });
}
const worker = (
  hook?: (stage: 'chunk' | 'propagation') => void | Promise<void>,
  timezoneEnv = env,
  overrides: Partial<LedgerOptions> = {},
) =>
  new LedgerService(prisma, timezoneEnv, {
    clock: () => at(3 * 86_400_000),
    onBeforeCommit: hook,
    ...overrides,
  });

async function snapshot() {
  const rows = await prisma.energyInterval.findMany({
    orderBy: { bucketStart: 'asc' },
  });
  return rows.map((row) => [
    row.bucketStart.getTime(),
    row.gridImportNetWh?.toString(),
    row.gridCoveredSec,
    row.gridImportCounterWh?.toString(),
    row.counterGapAllocMask,
    JSON.stringify(row.counterState),
  ]);
}

describe('ledger recovery (V23)', () => {
  for (const stage of ['chunk', 'propagation'] as const) {
    it(`preserves the pending range after a ${stage} transaction crash`, async () => {
      await sample(0, 1000, 1234500n);
      await sample(10_000, 1000, 1234600n);
      await dirty(0, BUCKET_MS);
      await expect(
        worker((atStage) => {
          if (atStage === stage) throw new Error('crash');
        }).processOnce(),
      ).rejects.toThrow('crash');
      expect(await prisma.ledgerDirtyRange.count()).toBe(1);
      expect(await prisma.energyInterval.count()).toBe(0);
      await worker().processOnce();
      const recovered = await snapshot();
      await dirty(0, BUCKET_MS);
      await worker().processOnce();
      expect(await snapshot()).toEqual(recovered);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    });
  }

  it('serializes two workers when ingest inserts overlapping dirt mid-chunk', async () => {
    await sample(0, 1000);
    await sample(10_000, 1000);
    await dirty(0, BUCKET_MS);
    let release!: () => void;
    let reached!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const arrived = new Promise<void>((resolve) => {
      reached = resolve;
    });
    const first = worker(undefined, env, {
      onBeforeChunkWrite: async () => {
        reached();
        await hold;
      },
    }).processOnce();
    await arrived;
    await sample(20_000, 2000);
    await dirty(0, BUCKET_MS);
    let secondReached!: () => void;
    const secondAtCommit = new Promise<void>((resolve) => {
      secondReached = resolve;
    });
    const second = worker((stage) => {
      if (stage === 'chunk') secondReached();
    }).processOnce();
    const raced = await Promise.race([
      secondAtCommit.then(() => true),
      delay(1000).then(() => false),
    ]);
    release();
    await Promise.all([first, second]);
    expect(raced).toBe(false);
    const corrected = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(Number(corrected.gridImportNetWh)).toBeCloseTo(6.944, 2);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });

  it('keeps a merged CALC_PARAMS run RUNNING through later local-day chunks', async () => {
    await sample(0, 1000);
    await sample(10_000, 1000);
    const end = 2 * 86_400_000;
    await dirty(0, end, 'INGEST');
    await dirty(0, end, 'CALC_PARAMS');
    const run = await prisma.calculationRun.create({
      data: {
        kind: 'CALC_PARAMS_CHANGE',
        reason: 'parameter replay',
        rangeStart: at(0),
        rangeEnd: at(end),
        calcVersion: 1,
        mappingVersion: 1,
        startedAt: at(0),
        status: 'RUNNING',
      },
    });
    let chunks = 0;
    await expect(
      worker((stage) => {
        if (stage === 'propagation' && ++chunks === 2)
          throw new Error('pause after first chunk');
      }).processOnce(),
    ).rejects.toThrow('pause after first chunk');
    expect(
      (await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } }))
        .status,
    ).toBe('RUNNING');
    const pending = await prisma.ledgerDirtyRange.findMany({
      where: { reason: 'CALC_PARAMS' },
    });
    expect(pending).toHaveLength(1);
    expect(pending[0]!.fromBucket.getTime()).toBeGreaterThan(base);
    await worker().processOnce();
    expect(
      (await prisma.calculationRun.findUniqueOrThrow({ where: { id: run.id } }))
        .status,
    ).toBe('DONE');
  });

  it.each([
    ['LEDGER_RECOMPUTE', 'RECALC_REQUEST'],
    ['RENORMALIZE', 'RENORMALIZE'],
  ] as const)(
    'keeps a %s run RUNNING while its counter-state continuation extends past the request (default retention)',
    async (kind, reason) => {
      await sample(0, 1000, 1000n);
      await sample(10_000, 1000, 1010n);
      await prisma.energyInterval.create({
        data: {
          bucketStart: at(2 * 86_400_000),
          calcVersion: LEDGER_ALGO_VERSION,
          maxGapSecUsed: 30,
          mappingVersion: 1,
          computedAt: at(0),
          gridCoveredSec: 0,
          pvCoveredSec: 0,
          batCoveredSec: 0,
          loadCoveredSec: 0,
          counterUnknownSec: [300, 300, 300, 300, 300, 300],
          counterGapAllocMask: 0,
          flags: 0,
          counterState: {},
        },
      });
      const run = await prisma.calculationRun.create({
        data: {
          kind,
          reason: 'counter correction',
          rangeStart: at(0),
          rangeEnd: at(BUCKET_MS),
          calcVersion: 1,
          mappingVersion: 1,
          startedAt: at(0),
          status: 'RUNNING',
        },
      });
      await prisma.ledgerDirtyRange.create({
        data: {
          fromBucket: at(0),
          toBucket: at(BUCKET_MS),
          reason,
        },
      });
      let chunks = 0;
      await expect(
        worker((stage) => {
          if (stage === 'propagation' && ++chunks === 2)
            throw new Error('pause in continuation');
        }).processOnce(),
      ).rejects.toThrow('pause in continuation');
      const pending = await prisma.ledgerDirtyRange.findFirstOrThrow({
        where: { reason },
      });
      const ongoing = await prisma.calculationRun.findUniqueOrThrow({
        where: { id: run.id },
      });
      expect(pending.fromBucket.getTime()).toBeGreaterThan(base);
      expect(ongoing.status).toBe('RUNNING');
      expect(ongoing.rangeEnd.getTime()).toBeGreaterThan(
        at(BUCKET_MS).getTime(),
      );
      await worker().processOnce();
      expect(
        (
          await prisma.calculationRun.findUniqueOrThrow({
            where: { id: run.id },
          })
        ).status,
      ).toBe('DONE');
    },
  );

  it('truncates old dirt and retains historical bucket values with OUTSIDE_RETENTION', async () => {
    const old = at(-401 * 86_400_000);
    await prisma.energyInterval.create({
      data: {
        bucketStart: old,
        calcVersion: 1,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: old,
        gridImportNetWh: '22.500',
        gridCoveredSec: 300,
        pvCoveredSec: 0,
        batCoveredSec: 0,
        loadCoveredSec: 0,
        counterUnknownSec: [300, 300, 300, 300, 300, 300],
        counterGapAllocMask: 0,
        flags: 0,
      },
    });
    await prisma.ledgerDirtyRange.create({
      data: {
        fromBucket: old,
        toBucket: at(-400 * 86_400_000),
        reason: 'INGEST',
      },
    });
    await worker().processOnce();
    const preserved = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: old },
    });
    expect(preserved.gridImportNetWh?.toString()).toBe('22.5');
    expect(preserved.flags & LedgerFlag.OUTSIDE_RETENTION).not.toBe(0);
    expect(await prisma.energyInterval.count()).toBe(1);
  });

  it('upgrades retained algorithm buckets and flags older versions outside retention', async () => {
    await sample(0, 1000);
    await sample(10_000, 1000);
    const old = at(-401 * 86_400_000);
    const stored = {
      calcVersion: 0,
      maxGapSecUsed: 30,
      mappingVersion: 1,
      computedAt: at(0),
      gridImportNetWh: '0',
      gridCoveredSec: 0,
      pvCoveredSec: 0,
      batCoveredSec: 0,
      loadCoveredSec: 0,
      counterUnknownSec: [300, 300, 300, 300, 300, 300],
      counterGapAllocMask: 0,
      flags: 0,
    };
    await prisma.energyInterval.create({
      data: { bucketStart: at(0), ...stored },
    });
    await prisma.energyInterval.create({
      data: { bucketStart: old, ...stored },
    });
    await worker().processOnce();
    const upgraded = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(upgraded.calcVersion).toBe(LEDGER_ALGO_VERSION);
    expect(upgraded.gridImportNetWh?.toString()).toBe('2.778');
    expect(upgraded.gridCoveredSec).toBe(10);
    const historical = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: old },
    });
    expect(historical.calcVersion).toBe(0);
    expect(historical.flags & LedgerFlag.OUTSIDE_RETENTION).not.toBe(0);
    expect(
      await prisma.calculationRun.findFirst({
        where: { kind: 'ALGO_UPGRADE', status: 'DONE' },
      }),
    ).not.toBeNull();
  });

  it('preserves unsupported v2 history with no retained samples instead of deleting it on upgrade', async () => {
    const before = await prisma.energyInterval.create({
      data: {
        bucketStart: at(0),
        calcVersion: 2,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: at(0),
        gridImportNetWh: '22.5',
        gridCoveredSec: 300,
        pvCoveredSec: 0,
        batCoveredSec: 300,
        loadCoveredSec: 0,
        counterUnknownSec: [300, 300, 300, 300, 300, 300],
        counterGapAllocMask: 0,
        flags: 0,
        socMin: 40,
        socMax: 80,
        socLast: 60,
      },
    });
    await dirty(0, BUCKET_MS);
    await worker().processOnce();
    expect(
      await prisma.energyInterval.findUnique({ where: { bucketStart: at(0) } }),
    ).toEqual({ ...before, flags: LedgerFlag.OUTSIDE_RETENTION });
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    await worker().processOnce();
    expect(await prisma.calculationRun.count()).toBe(0);
  });

  it('upgrades retained v2 samples but preserves an unsupported internal history hole and its unknown SOC coverage', async () => {
    await sample(0, 1000, 1000n);
    await sample(10_000, 1000, 1100n);
    await sample(610_000, 1000, 1500n);
    const stored = {
      calcVersion: 2,
      maxGapSecUsed: 30,
      mappingVersion: 1,
      computedAt: at(0),
      gridImportNetWh: '22.5',
      gridCoveredSec: 300,
      pvCoveredSec: 0,
      batCoveredSec: 300,
      loadCoveredSec: 0,
      counterUnknownSec: [300, 300, 300, 300, 300, 300],
      counterGapAllocMask: 0,
      flags: 0,
      socMin: 40,
      socMax: 80,
      socLast: 60,
    };
    await prisma.energyInterval.create({
      data: { ...stored, bucketStart: at(0) },
    });
    const hole = await prisma.energyInterval.create({
      data: { ...stored, bucketStart: at(BUCKET_MS) },
    });
    await worker().processOnce();
    const upgraded = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(upgraded.calcVersion).toBe(3);
    expect(upgraded.socCoveredSec).toBe(20);
    expect(
      await prisma.energyInterval.findUniqueOrThrow({
        where: { bucketStart: at(BUCKET_MS) },
      }),
    ).toEqual({ ...hole, flags: LedgerFlag.OUTSIDE_RETENTION });
    const runs = await prisma.calculationRun.count();
    await worker().processOnce();
    expect(await prisma.calculationRun.count()).toBe(runs);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });

  it.each([
    ['an earlier preserved anchor', false, '0.012'],
    ['a later invalidated preserved anchor', true, '0.023'],
  ] as const)(
    'reconstructs actual counter state through a cross-day history hole with %s',
    async (_label, invalidateAnchor, counterWh) => {
      const day = 86_400_000;
      const utcEnv = { ...env, SITE_TIMEZONE: 'UTC' };
      await sample(0, 1000, 1000n);
      await sample(10_000, 1000, 1100n);
      await sample(BUCKET_MS, 1000, 1200n);
      await sample(day + 10_000, 1000, 1300n);
      await dirty(0, day + BUCKET_MS);
      await worker(undefined, utcEnv).processOnce();
      const first = await prisma.energyInterval.findUniqueOrThrow({
        where: { bucketStart: at(0) },
      });
      const boundary = await prisma.energyInterval.findUniqueOrThrow({
        where: { bucketStart: at(day - BUCKET_MS) },
      });
      if (invalidateAnchor) {
        await prisma.sample.updateMany({
          where: { observedAt: at(BUCKET_MS) },
          data: { gridBuyWh: null, flags: SampleFlag.BLOCK_INVALID_2000 },
        });
        await dirty(0, day + BUCKET_MS);
        await worker(undefined, utcEnv).processOnce();
      }
      const hole = await prisma.energyInterval.update({
        where: { bucketStart: at(day - BUCKET_MS) },
        data: {
          calcVersion: 2,
          flags: boundary.flags | LedgerFlag.OUTSIDE_RETENTION,
          counterState: (invalidateAnchor ? boundary : first).counterState!,
        },
      });
      const before = await prisma.energyInterval.findMany({
        orderBy: { bucketStart: 'asc' },
      });
      await dirty(day, day + BUCKET_MS);
      await worker(undefined, utcEnv).processOnce();
      const after = await prisma.energyInterval.findMany({
        orderBy: { bucketStart: 'asc' },
      });
      expect(after.map((row) => ({ ...row, computedAt: null }))).toEqual(
        before.map((row) => ({ ...row, computedAt: null })),
      );
      expect(
        after.find(
          (row) => row.bucketStart.getTime() === at(day - BUCKET_MS).getTime(),
        ),
      ).toEqual(hole);
      expect(after.at(-1)!.gridImportCounterWh?.toString()).toBe(counterWh);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    },
  );

  it('preserves counter energy crossing a policy maxGapSec segment boundary', async () => {
    await sample(0, 1000, 1000n);
    await sample(10_000, 1000, 1010n);
    await sample(290_000, 1000, 1290n);
    await sample(310_000, 1000, 1310n);
    await prisma.accountingPolicy.create({
      data: {
        effectiveFrom: at(0),
        gridSource: 'METER_NET',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 30,
        validated: {},
        note: 'first',
      },
    });
    await prisma.accountingPolicy.create({
      data: {
        effectiveFrom: at(BUCKET_MS),
        gridSource: 'METER_NET',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 60,
        validated: {},
        note: 'second',
      },
    });
    await dirty(0, 2 * BUCKET_MS);
    await worker().processOnce();
    const before = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    const after = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(BUCKET_MS) },
    });
    expect(Number(before.gridImportCounterWh)).toBe(300);
    expect(Number(after.gridImportCounterWh)).toBe(10);
    expect(before.maxGapSecUsed).toBe(30);
    expect(after.maxGapSecUsed).toBe(60);
  });

  it('redistributes a six-hour accepted counter gap back to an old baseline', async () => {
    await sample(0, 1000, 1000n);
    await sample(10_000, 1000, 1010n);
    await dirty(0, BUCKET_MS);
    await worker().processOnce();
    await sample(6 * 3_600_000 + 10_000, 1000, 4610n);
    await dirty(6 * 3_600_000, 6 * 3_600_000 + BUCKET_MS);
    await worker().processOnce();
    const allocated = await prisma.energyInterval.findMany({
      where: { bucketStart: { gte: at(0), lt: at(6 * 3_600_000 + BUCKET_MS) } },
    });
    expect(allocated.length).toBe(73);
    expect(allocated.every((row) => (row.counterGapAllocMask & 2) !== 0)).toBe(
      true,
    );
    expect(
      allocated.reduce(
        (total, row) => total + Number(row.gridImportCounterWh ?? 0),
        0,
      ),
    ).toBeCloseTo(3610, 2);
    const before = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(Number(before.gridImportCounterWh)).toBeCloseTo(58.333, 2);
    await dirty(0, BUCKET_MS);
    await worker().processOnce();
    const after = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(after.gridImportCounterWh?.toString()).toBe(
      before.gridImportCounterWh?.toString(),
    );
    expect(after.counterGapAllocMask).toBe(before.counterGapAllocMask);
  });
  it('resolves a rejected next-day spike before committing the Berlin midnight chunk and preserves a narrow replay', async () => {
    const start = Date.UTC(2026, 2, 28, 22, 55) - base;
    const readings = [
      [0, 1000],
      [10_000, 1100],
      [310_000, 1_000_000_000],
      [610_000, 1200],
    ] as const;
    for (const [ms, value] of readings)
      await sample(start + ms, 1000, BigInt(value));
    const whole = computeRange({
      fromMs: at(start).getTime(),
      toMs: at(start + 3 * BUCKET_MS).getTime(),
      maxGapSec: 30,
      samples: readings.map(([ms, value]) => ({
        tMs: at(start + ms).getTime(),
        deviceId,
        mappingVersion: 1,
        flags: 0,
        gridW: 1000,
        gridAW: 333,
        gridBW: 333,
        gridCW: 333,
        pvW: 0,
        batteryW: 0,
        batteryPowerSource: 'BAT1_POWER_G3_50',
        inverterAcW: 0,
        epsW: 0,
        batterySoc: 50,
        counters: {
          PV: null,
          GRID_BUY: value,
          GRID_SELL: null,
          BAT_CHARGE: null,
          BAT_DISCHARGE: null,
          LOAD_USE: null,
        },
      })),
      counterStates: null,
      exclusions: [],
      touBoundaryMinutes: [0],
      timeZone: 'Europe/Berlin',
    });
    await dirty(start, start + 3 * BUCKET_MS);
    let passes = 0;
    await worker(
      (stage) => {
        if (stage === 'propagation' && ++passes > 5)
          throw new Error('ledger failed to converge within five chunks');
      },
      env,
      { clock: () => new Date(Date.UTC(2026, 2, 30)) },
    ).processOnce();
    expect(passes).toBeLessThanOrEqual(5);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    const actual = await prisma.energyInterval.findMany({
      where: {
        bucketStart: { gte: at(start), lt: at(start + 3 * BUCKET_MS) },
      },
      orderBy: { bucketStart: 'asc' },
    });
    expect(actual).toHaveLength(3);
    expect(actual[0]!.gridImportCounterWh?.toString()).toBe('148.333');
    expect(actual.map((row) => row.gridImportCounterWh?.toString())).toEqual(
      whole.rows.map((row) =>
        Number(row.gridImportCounterWh ?? 0)
          .toFixed(3)
          .replace(/\.?0+$/, ''),
      ),
    );
    const first = actual[0]!.gridImportCounterWh?.toString();
    await dirty(start, start + BUCKET_MS);
    await worker(undefined, env, {
      clock: () => new Date(Date.UTC(2026, 2, 30)),
    }).processOnce();
    expect(
      (
        await prisma.energyInterval.findUniqueOrThrow({
          where: { bucketStart: at(start) },
        })
      ).gridImportCounterWh?.toString(),
    ).toBe(first);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });

  it('repairs grown lookahead beyond 64 rejected readings before committing the first local-day chunk', async () => {
    const start = Date.UTC(2026, 9, 25, 22, 55) - base;
    await sample(start, 1000, 1000n);
    await sample(start + 10_000, 1000, 1100n);
    for (let i = 0; i < 100; i++)
      await sample(
        start + 310_000 + i * 2_000,
        1000,
        BigInt(1_000_000_000 + (i % 2) * 1_000_000_000),
      );
    await sample(start + 610_000, 1000, 1200n);
    // The later candidate must already be repaired when the first local-day
    // chunk commits, not only when its own chunk is eventually processed.
    await prisma.rawPoll.updateMany({
      where: { observedAt: at(start + 610_000) },
      data: { acquisitionClockStep: true },
    });
    await dirty(start, start + 3 * BUCKET_MS);
    let chunks = 0;
    await expect(
      worker((stage) => {
        if (stage === 'chunk' && ++chunks === 2)
          throw new Error('interrupt after first committed chunk');
      }).processOnce(),
    ).rejects.toThrow('interrupt after first committed chunk');
    expect(
      (
        await prisma.sample.findUniqueOrThrow({
          where: {
            deviceId_observedAt: { deviceId, observedAt: at(start + 610_000) },
          },
        })
      ).flags & SampleFlag.CLOCK_STEP,
    ).toBe(SampleFlag.CLOCK_STEP);
    expect(
      (
        await prisma.energyInterval.findUniqueOrThrow({
          where: { bucketStart: at(start) },
        })
      ).gridImportCounterWh?.toString(),
    ).toBe('148.333');
    expect(
      await prisma.energyInterval.findUnique({
        where: { bucketStart: at(start + 2 * BUCKET_MS) },
      }),
    ).toBeNull();
    expect(await prisma.ledgerDirtyRange.count()).toBeGreaterThan(0);
    await worker().processOnce();
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });

  it('finds a lone accepted crossing after a null-only lookahead page without dropping the cursor successor', async () => {
    for (let i = 0; i <= 30; i++)
      await sample(i * 10_000, 1000, 1000n + BigInt(i * 10));
    await dirty(0, BUCKET_MS);
    await worker().processOnce();
    const prefix = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    for (let i = 31; i <= 200; i++) await sample(i * 10_000);
    await sample(2_100_000, 1000, 1900n);
    await dirty(BUCKET_MS, 2 * BUCKET_MS);
    await worker().processOnce();
    const rows = await prisma.energyInterval.findMany({
      orderBy: { bucketStart: 'asc' },
    });
    expect(rows.map((row) => row.bucketStart)).toEqual([at(0), at(BUCKET_MS)]);
    expect(rows[0]).toEqual(prefix);
    expect(rows[1]!.gridCoveredSec).toBe(300);
    expect(rows[1]!.gridImportNetWh?.toString()).toBe('83.333');
    expect(rows[1]!.gridImportCounterWh?.toString()).toBe('100');
    expect(rows[1]!.counterUnknownSec[1]).toBe(0);
    expect(rows[1]!.counterGapAllocMask & 2).toBe(2);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });

  it('persists METER_PER_PHASE coverage independently of the meter-total coverage', async () => {
    for (let i = 0; i <= 30; i++) await sample(i * 10_000, 1000);
    // Meter total (1814) unavailable for the first half of the bucket; all three phases stay valid.
    await prisma.sample.updateMany({
      where: { observedAt: { lt: at(150_000) } },
      data: { gridW: null },
    });
    await dirty(0, BUCKET_MS);
    await worker().processOnce();
    const row = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(row.gridCoveredSec).toBe(150);
    expect(row.gridPhaseCoveredSec).toBe(300);
    expect(row.gridImportNetWh).not.toBeNull();
    expect(row.gridImportPhaseWh?.toString()).toBe('83.25');
  });

  it('never rewrites a stored row whose phase coverage predates migration 0006 (NULL) while verifying it as a prefix', async () => {
    for (let i = 0; i <= 30; i++)
      await sample(i * 10_000, 1000, 1000n + BigInt(i * 10));
    await dirty(0, BUCKET_MS);
    await worker().processOnce();
    expect(
      (
        await prisma.energyInterval.findUniqueOrThrow({
          where: { bucketStart: at(0) },
        })
      ).gridPhaseCoveredSec,
    ).toBe(300);
    const legacy = await prisma.energyInterval.update({
      where: { bucketStart: at(0) },
      data: { gridPhaseCoveredSec: null },
    });
    for (let i = 31; i <= 200; i++) await sample(i * 10_000);
    await sample(2_100_000, 1000, 1900n);
    await dirty(BUCKET_MS, 2 * BUCKET_MS);
    await worker().processOnce();
    const rows = await prisma.energyInterval.findMany({
      orderBy: { bucketStart: 'asc' },
    });
    expect(rows.map((row) => row.bucketStart)).toEqual([at(0), at(BUCKET_MS)]);
    expect(rows[0]).toEqual(legacy);
    expect(rows[1]!.gridPhaseCoveredSec).toBe(300);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });

  it('converges mixed-mapping UTC day chunks and preserves every persisted field on narrow replay and restart', async () => {
    const nextDay = 86_400_000;
    const utcEnv = { ...env, SITE_TIMEZONE: 'UTC' };
    await prisma.mappingVersion.create({
      data: {
        version: 2,
        config: {},
        provisional: false,
        note: 'same mapping, new version',
      },
    });
    await sample(100, 1000, 1000n);
    await sample(10_200, 1000, 1100n);
    await sample(nextDay + 10_000, 1000, 1500n, 2);
    await dirty(0, nextDay + BUCKET_MS);
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const persisted = async () =>
      (
        await prisma.energyInterval.findMany({
          orderBy: { bucketStart: 'asc' },
        })
      ).map(({ computedAt: _computedAt, ...row }) => row);
    try {
      let chunks = 0;
      await worker((stage) => {
        if (stage === 'propagation') chunks++;
      }, utcEnv).processOnce();
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('not converging'),
      );
      expect(chunks).toBeLessThanOrEqual(4);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      const rows = await persisted();
      expect(rows).toHaveLength(289);
      expect(rows[0]).toMatchObject({ mappingVersion: 1, gridCoveredSec: 10 });
      expect(rows[0]!.gridImportNetWh?.toString()).toBe('2.806');
      expect(rows[0]!.gridImportCounterWh?.toString()).toBe('101.342');
      expect(rows[1]!.mappingVersion).toBe(1); // Counter-only bucket keeps its predecessor.
      expect(rows.at(-1)!.mappingVersion).toBe(2);
      await dirty(0, BUCKET_MS);
      await worker(undefined, utcEnv).processOnce();
      expect(await persisted()).toEqual(rows);
      await dirty(nextDay, nextDay + BUCKET_MS);
      await worker(undefined, utcEnv).processOnce();
      expect(await persisted()).toEqual(rows);
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('not converging'),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it('leaves a non-converging continuation pending and recovers on retry', async () => {
    const start = Date.UTC(2026, 9, 25, 22, 55) - base;
    await sample(start, 1000, 1000n);
    await sample(start + 10_000, 1000, 1100n);
    const pending = await dirty(start, start + 2 * BUCKET_MS);
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    let prefixVisits = 0;
    try {
      await worker(undefined, env, {
        computeRange: (input) => {
          const output = computeRange(input);
          if (input.fromMs === at(start + BUCKET_MS).getTime()) {
            output.writeFromMs = at(start).getTime();
          }
          if (
            input.fromMs === at(start).getTime() &&
            input.toMs === at(start + BUCKET_MS).getTime()
          ) {
            const first = output.rows.find(
              (row) => row.bucketStartMs === at(start).getTime(),
            );
            if (first)
              first.gridImportNetWh =
                (first.gridImportNetWh ?? 0) + (prefixVisits++ % 2);
          }
          return output;
        },
      }).processOnce();
      expect(
        await prisma.ledgerDirtyRange.findUnique({ where: { id: pending.id } }),
      ).not.toBeNull();
      expect(
        (
          await prisma.energyInterval.findUniqueOrThrow({
            where: { bucketStart: at(start) },
          })
        ).gridImportNetWh?.toString(),
      ).toBe('2.778');
    } finally {
      warn.mockRestore();
    }
    await worker().processOnce();
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });
  it('allows a progressing dirty range to span more than twenty local-day chunks', async () => {
    await sample(0, 1000);
    await sample(21 * 86_400_000, 1000);
    await dirty(0, 22 * 86_400_000);
    let chunks = 0;
    await worker(
      (stage) => {
        if (stage === 'propagation') chunks++;
      },
      env,
      { clock: () => at(23 * 86_400_000) },
    ).processOnce();
    expect(chunks).toBeGreaterThan(20);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });
  it('converges after a day-30 correction widens back through thirty days of null counters', async () => {
    const day = 86_400_000;
    await sample(0, 1000, 1000n);
    await sample(10_000, 1000, 1100n);
    await dirty(0, BUCKET_MS);
    await worker(undefined, env, { clock: () => at(32 * day) }).processOnce();
    for (let i = 1; i < 30; i++) await sample(i * day, 1000);
    await sample(30 * day + 10_000, 1000, 31_100n);
    await dirty(30 * day, 30 * day + BUCKET_MS);
    const warn = vi
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    let chunks = 0;
    try {
      await worker(
        (stage) => {
          if (stage === 'propagation') chunks++;
        },
        env,
        { clock: () => at(32 * day) },
      ).processOnce();
      expect(chunks).toBeGreaterThan(30);
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining('not converging'),
      );
      expect(await prisma.ledgerDirtyRange.count()).toBe(0);
      const first = await prisma.energyInterval.findUniqueOrThrow({
        where: { bucketStart: at(0) },
      });
      expect(Number(first.gridImportCounterWh)).toBeGreaterThan(100);
    } finally {
      warn.mockRestore();
    }
  }, 180_000);
  it('loads exclusions between the preceding seed and a next-day first sample', async () => {
    const boundary = Date.UTC(2026, 9, 25, 23) - base;
    await sample(boundary - 10_000, 1000);
    await sample(boundary + 10_000, 1000);
    await dirty(boundary, boundary + BUCKET_MS);
    await worker().processOnce();
    expect(
      (
        await prisma.energyInterval.findUniqueOrThrow({
          where: { bucketStart: at(boundary) },
        })
      ).gridCoveredSec,
    ).toBe(10);
    await prisma.dataExclusion.create({
      data: {
        from: at(boundary - 9_000),
        to: at(boundary - 8_000),
        families: ['GRID'],
        reason: 'meter unavailable',
        createdBy: 'test',
      },
    });
    await dirty(boundary, boundary + BUCKET_MS, 'INGEST');
    await worker().processOnce();
    const excluded = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(boundary) },
    });
    expect(excluded.gridCoveredSec).toBe(0);
    expect(excluded.gridImportNetWh).toBeNull();
  });

  it('persists continuation beyond one local day and resumes after restart', async () => {
    await sample(0, 1000, 1000n);
    await sample(10_000, 1000, 1010n);
    await prisma.energyInterval.create({
      data: {
        bucketStart: at(2 * 86_400_000),
        calcVersion: LEDGER_ALGO_VERSION,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: at(0),
        gridCoveredSec: 0,
        pvCoveredSec: 0,
        batCoveredSec: 0,
        loadCoveredSec: 0,
        counterUnknownSec: [300, 300, 300, 300, 300, 300],
        counterGapAllocMask: 0,
        flags: 0,
        counterState: {},
      },
    });
    await dirty(0, BUCKET_MS);
    let commits = 0;
    await expect(
      worker((stage) => {
        if (stage === 'propagation' && ++commits === 2)
          throw new Error('restart');
      }).processOnce(),
    ).rejects.toThrow('restart');
    const pending = await prisma.ledgerDirtyRange.findFirstOrThrow();
    expect(pending.fromBucket.getTime()).toBe(base + BUCKET_MS);
    expect(pending.toBucket.getTime()).toBeGreaterThan(base + BUCKET_MS);
    await worker().processOnce();
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });

  it('replaces rather than duplicates a completed local-day BALANCE_ANOMALY', async () => {
    const start = Date.UTC(2026, 9, 24, 22) - base;
    const end = Date.UTC(2026, 9, 25, 23) - base;
    await sample(end - 20_000, 1000);
    await sample(end - 10_000, 1000);
    await prisma.sample.updateMany({ data: { inverterAcW: -500 } });
    await dirty(start, end);
    await worker().processOnce();
    const first = await prisma.dataQualityEvent.findMany({
      where: { kind: 'BALANCE_ANOMALY' },
    });
    expect(first).toHaveLength(1);
    expect(first[0]?.details).toMatchObject({
      source: 'ledger',
      localDate: '2026-10-25',
    });
    await dirty(start, end);
    await worker().processOnce();
    expect(
      await prisma.dataQualityEvent.count({
        where: { kind: 'BALANCE_ANOMALY' },
      }),
    ).toBe(1);
  });

  it('removes a daily anomaly after a midday correction without touching midnight', async () => {
    const start = Date.UTC(2026, 9, 24, 22) - base;
    const end = Date.UTC(2026, 9, 25, 23) - base;
    const middle = start + 3 * 3_600_000;
    await sample(middle + 10_000, 1000);
    await sample(middle + 20_000, 1000);
    await prisma.sample.updateMany({ data: { inverterAcW: -500 } });
    await dirty(start, end);
    await worker().processOnce();
    expect(
      await prisma.dataQualityEvent.count({
        where: { kind: 'BALANCE_ANOMALY' },
      }),
    ).toBe(1);
    await prisma.sample.updateMany({ data: { inverterAcW: 0 } });
    await dirty(middle, middle + BUCKET_MS);
    await worker().processOnce();
    expect(
      await prisma.dataQualityEvent.count({
        where: { kind: 'BALANCE_ANOMALY' },
      }),
    ).toBe(0);
  });

  it('widens a three-day counter span but commits no more than one local day per chunk', async () => {
    await sample(0, 1000, 1000n);
    await sample(10_000, 1000, 1010n);
    await dirty(0, BUCKET_MS);
    await worker().processOnce();
    const future = 3 * 86_400_000 + 10_000;
    await sample(future, 1000, 73_010n);
    await dirty(3 * 86_400_000, 3 * 86_400_000 + BUCKET_MS);
    let chunks = 0;
    await worker((stage) => {
      if (stage === 'chunk') chunks++;
    }).processOnce();
    expect(chunks).toBeGreaterThanOrEqual(4);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    const before = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(before.counterGapAllocMask & 2).not.toBe(0);
  });

  // Samples carry millisecond timestamps, so integrated coverage is fractional while the column
  // is an integer. Recovery must compare against what the database can actually hold, and the
  // stored coverage never claims more whole seconds than were integrated (10.6 s stores 10).
  it.each([
    { second: 10_200, covered: 10, netWh: '2.806', counterWh: '101.4' },
    { second: 10_700, covered: 10, netWh: '2.944', counterWh: '101.398' },
    { second: 10_100, covered: 10, netWh: '2.778', counterWh: '101.4' },
  ])(
    'converges a cross-day recovery whose bucket coverage is fractional (second sample at +$second ms)',
    async ({ second, covered, netWh, counterWh }) => {
      const nextDay = Date.UTC(2026, 9, 25, 23) - base;
      await sample(100, 1000, 1000n);
      await sample(second, 1000, 1100n);
      await sample(nextDay + 10_000, 1000, 1500n);
      await dirty(0, nextDay + BUCKET_MS);
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      try {
        let chunks = 0;
        await worker((stage) => {
          if (stage === 'propagation') chunks++;
        }).processOnce();
        expect(warn).not.toHaveBeenCalledWith(
          expect.stringContaining('not converging'),
        );
        expect(chunks).toBeLessThanOrEqual(4);
        expect(await prisma.ledgerDirtyRange.count()).toBe(0);
        const first = await prisma.energyInterval.findUniqueOrThrow({
          where: { bucketStart: at(0) },
        });
        expect(first.gridCoveredSec).toBe(covered);
        // Coverage is quantized for storage only; energy keeps the exact interval length.
        expect(first.gridImportNetWh?.toString()).toBe(netWh);
        expect(first.gridImportCounterWh?.toString()).toBe(counterWh);
        const recovered = await snapshot();
        await dirty(0, nextDay + BUCKET_MS);
        await worker().processOnce();
        expect(await snapshot()).toEqual(recovered);
        expect(await prisma.ledgerDirtyRange.count()).toBe(0);
        expect(warn).not.toHaveBeenCalledWith(
          expect.stringContaining('not converging'),
        );
      } finally {
        warn.mockRestore();
      }
    },
  );

  it('records a fully covered bucket of jittered 5 s polls as 300 s despite floating-point summation noise', async () => {
    const times = [
      0, 4883, 9879, 15041, 19885, 25022, 30024, 35149, 40121, 44964, 49957,
      54959, 59763, 64904, 69749, 74651, 79553, 84374, 89454, 94263, 99341,
      104225, 109401, 114400, 119590, 124587, 129436, 134512, 139642, 144553,
      149678, 154663, 159498, 164300, 169219, 174056, 179043, 184084, 189079,
      193906, 198897, 203717, 208832, 213782, 218727, 223864, 229057, 234095,
      239142, 244184, 248992, 253939, 258975, 264117, 269290, 274370, 279463,
      284364, 289531, 294552, 299535, 304558,
    ];
    // Fixture precondition: summing the interval lengths as floating-point seconds loses a hair
    // below 300 even though the intervals tile the bucket exactly.
    let naive = 0;
    for (let i = 1; i < times.length; i++)
      naive += (Math.min(times[i]!, BUCKET_MS) - times[i - 1]!) / 1000;
    expect(naive).toBeLessThan(300);
    for (const ms of times) await sample(ms, 1000);
    await dirty(0, BUCKET_MS);
    await worker().processOnce();
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
    const full = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: at(0) },
    });
    expect(full.gridCoveredSec).toBe(300);
    expect(full.gridImportNetWh?.toString()).toBe('83.333');
  });

  it('uses a single 300-bucket transaction for the Europe/Berlin fall-back local day', async () => {
    const start = Date.UTC(2026, 9, 24, 22) - base;
    const end = Date.UTC(2026, 9, 25, 23) - base;
    await sample(start, 1000);
    await sample(end - 10_000, 1000);
    await dirty(start, end);
    let chunks = 0;
    await worker((stage) => {
      if (stage === 'chunk') chunks++;
    }).processOnce();
    expect(chunks).toBe(1);
    expect((end - start) / BUCKET_MS).toBe(300);
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });
});
