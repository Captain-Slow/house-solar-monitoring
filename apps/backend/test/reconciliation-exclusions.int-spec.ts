import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service.js';
import { initialCounterStates } from '../src/accounting/counters.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

const base = Date.parse('2026-02-01T00:00:00Z');
const date = (seconds: number) => new Date(base + seconds * 1000);
const DAY = 86_400;

/**
 * Endpoint reconstruction replays raw counter observations from the persisted baseline (or from
 * the first sample when there is none) up to one bucket past the second meter reading. An
 * observation covered by a GRID/ALL data exclusion is skipped exactly like the ledger skips it
 * (`from <= t < to`), wherever it lies in that replay scope, not only inside the comparison window.
 */
describe('reconciliation counter replay and data exclusions', () => {
  let db: TestDatabase, prisma: PrismaService, service: ReconciliationService;
  let deviceId: number, runId: number;
  let seq = 0;

  beforeAll(async () => {
    db = await createTestDatabase();
    prisma = new PrismaService({ DATABASE_URL: db.url });
    service = new ReconciliationService(prisma);
    const source = await prisma.dataSource.create({
      data: { kind: 'MODBUS_TCP', endpoint: '127.0.0.1:1502#1' },
    });
    deviceId = (
      await prisma.device.create({
        data: {
          dataSourceId: source.id,
          deviceKey: 'excl',
          role: 'INVERTER',
          model: 'test',
          observedCapabilities: {},
          capabilitiesObservedAt: date(0),
          firmware: {},
          firstSeenAt: date(0),
          lastSeenAt: date(0),
        },
      })
    ).id;
    await prisma.mappingVersion.create({
      data: { version: 1, config: {}, provisional: false, note: 'test' },
    });
    runId = (
      await prisma.collectorRun.create({
        data: {
          startedAt: date(0),
          appVersion: 'test',
          registerMapVersion: 'test',
        },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma?.close();
    await db?.drop();
  });

  /** One raw FAST observation: grid buy counter `buyWh`, grid sell counter fixed at 0. */
  async function observe(second: number, buyWh: number) {
    const t = date(second);
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
        contentHash: Buffer.alloc(32),
      },
    });
    await prisma.sample.create({
      data: {
        rawPollId: raw.id,
        deviceId,
        observedAt: t,
        mappingVersion: 1,
        gridBuyWh: BigInt(buyWh),
        gridSellWh: 0n,
        pvStringW: [],
        gridBuyPhaseWh: [],
        gridSellPhaseWh: [],
        meterRepeatSec: 0,
        flags: 0,
      },
    });
  }

  /** A persisted accepted baseline: both grid counters confirmed at `lastSecond`. */
  async function baseline(
    bucketSecond: number,
    lastSecond: number,
    buyWh: number,
  ) {
    const states = initialCounterStates();
    for (const [key, v] of [
      ['GRID_BUY', buyWh],
      ['GRID_SELL', 0],
    ] as const)
      states[key] = {
        segment: 1,
        deviceId,
        last: { v, tMs: date(lastSecond).getTime() },
        confirmed: true,
        pending: [],
      };
    await prisma.energyInterval.create({
      data: {
        bucketStart: date(bucketSecond),
        calcVersion: 1,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: date(bucketSecond),
        gridCoveredSec: 0,
        pvCoveredSec: 0,
        batCoveredSec: 0,
        loadCoveredSec: 0,
        counterUnknownSec: [300, 300, 300, 300, 300, 300],
        counterGapAllocMask: 0,
        flags: 0,
        counterState: states as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async function exclude(
    from: number,
    to: number,
    families: string[] = ['GRID'],
  ) {
    await prisma.dataExclusion.create({
      data: {
        from: date(from),
        to: date(to),
        families,
        reason: 'bad counter observation',
        createdBy: 'test',
      },
    });
  }

  async function counterImport(
    t1: number,
    t2: number,
    source:
      'HOYMILES_METER_LCD' | 'UTILITY_METER_MANUAL' = 'HOYMILES_METER_LCD',
  ) {
    const reading = (second: number, importKwh: string) =>
      prisma.meterReading.create({
        data: {
          readAt: date(second),
          source,
          importKwh,
          resolutionKwh: '0.001',
        },
      });
    const [from, to] = [await reading(t1, '1.000'), await reading(t2, '2.000')];
    const candidate = (await service.reconcile(from.id, to.id)).candidates.find(
      (item) => item.source === 'INVERTER_COUNTER',
    )!;
    return {
      kwh: candidate.import.oursKwh?.toFixed(3) ?? null,
      coverage: candidate.coverage.toNumber(),
    };
  }

  // Real counter: 100_100 @+300, 100_150 @+310, 100_200 @+320 (0.050 kWh between +305 and +315).
  // Bad observation: 100_200 @+302 is within the plausibility limit, so replaying it accepts it
  // and rejects the true readings that follow until they catch up at +320: delta 0.
  async function scenario(day: number, badSecond: number) {
    await baseline(day, day + 290, 100_000);
    await observe(day + 300, 100_100);
    await observe(day + badSecond, 100_200);
    await observe(day + 310, 100_150);
    await observe(day + 320, 100_200);
  }

  it('control: replaying the unexcluded bad observation yields the false zero delta', async () => {
    const day = 1 * DAY;
    await scenario(day, 302);
    expect(await counterImport(day + 305, day + 315)).toEqual({
      kwh: '0.000',
      coverage: 1,
    });
  });

  it('skips an excluded observation that precedes the requested window', async () => {
    const day = 2 * DAY;
    await scenario(day, 302);
    await exclude(day + 301, day + 303);
    expect(await counterImport(day + 305, day + 315)).toEqual({
      kwh: '0.050',
      coverage: 1,
    });
  });

  it('skips an excluded observation when the exclusion ends exactly at the first reading', async () => {
    const day = 3 * DAY;
    await scenario(day, 304);
    await exclude(day + 303, day + 305);
    expect(await counterImport(day + 305, day + 315)).toEqual({
      kwh: '0.050',
      coverage: 1,
    });
  });

  it('exclusion end is exclusive: an observation exactly at `to` is still replayed', async () => {
    const day = 4 * DAY;
    await scenario(day, 302);
    await exclude(day + 301, day + 302);
    expect(await counterImport(day + 305, day + 315)).toEqual({
      kwh: '0.000',
      coverage: 1,
    });
  });

  it('exclusion start is inclusive: an observation exactly at `from` is skipped', async () => {
    const day = 5 * DAY;
    await scenario(day, 302);
    await exclude(day + 302, day + 303);
    expect(await counterImport(day + 305, day + 315)).toEqual({
      kwh: '0.050',
      coverage: 1,
    });
  });

  it('only GRID and ALL exclusions skip grid counter observations', async () => {
    const pv = 6 * DAY,
      all = 7 * DAY;
    await scenario(pv, 302);
    await exclude(pv + 301, pv + 303, ['PV', 'BATTERY', 'LOAD']);
    expect(await counterImport(pv + 305, pv + 315)).toEqual({
      kwh: '0.000',
      coverage: 1,
    });
    await scenario(all, 302);
    await exclude(all + 301, all + 303, ['ALL']);
    expect(await counterImport(all + 305, all + 315)).toEqual({
      kwh: '0.050',
      coverage: 1,
    });
  });

  it('keeps the persisted seed when the first replayed observation is excluded', async () => {
    const day = 8 * DAY;
    await baseline(day, day + 290, 100_000);
    // The bad first observation is accepted from the seed; without it 100_160 @+310 is accepted
    // from the seed itself (100_120 at +305) and 100_210 @+320 follows (100_185 at +315).
    await observe(day + 300, 100_200);
    await observe(day + 310, 100_160);
    await observe(day + 320, 100_210);
    await exclude(day + 300, day + 301);
    expect(await counterImport(day + 305, day + 315)).toEqual({
      kwh: '0.065',
      coverage: 1,
    });
  });

  it('skips an excluded observation just after the second reading', async () => {
    const day = 9 * DAY;
    await baseline(day, day + 290, 100_000);
    await observe(day + 300, 100_100);
    await observe(day + 310, 100_150);
    // Bad neighbour of the second endpoint: accepted when replayed and interpolated across.
    await observe(day + 316, 100_350);
    await observe(day + 320, 100_200);
    await exclude(day + 316, day + 317);
    expect(await counterImport(day + 305, day + 315)).toEqual({
      kwh: '0.050',
      coverage: 1,
    });
  });

  it('skips an excluded observation hours before the window when no baseline exists', async () => {
    // Day 0 has no persisted energy interval: the replay starts at the first sample.
    await observe(0, 100_000);
    await observe(2, 100_200);
    await observe(3600, 100_100);
    await observe(3610, 100_150);
    await observe(3620, 100_200);
    expect(await counterImport(3605, 3615)).toEqual({
      kwh: '0.000',
      coverage: 1,
    });
    await exclude(1, 3);
    expect(await counterImport(3605, 3615, 'UTILITY_METER_MANUAL')).toEqual({
      kwh: '0.050',
      coverage: 1,
    });
  });

  it('an exclusion that overlaps the compared window still removes counter coverage', async () => {
    const day = 10 * DAY;
    await scenario(day, 302);
    await exclude(day + 308, day + 309);
    const result = await counterImport(day + 305, day + 315);
    expect(result).toEqual({ kwh: null, coverage: 0 });
  });
});
