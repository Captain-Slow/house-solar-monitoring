import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Decimal } from 'decimal.js';
import { Prisma } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/db/prisma.service.js';
import {
  ReconciliationService,
  evaluateDirection,
} from '../src/reconciliation/reconciliation.service.js';
import { COUNTER_WRAP_WH } from '../src/accounting/types.js';
import { initialCounterStates } from '../src/accounting/counters.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

const base = Date.parse('2026-01-01T00:00:00Z');
const date = (seconds: number) => new Date(base + seconds * 1000);

describe('meter reconciliation', () => {
  let db: TestDatabase, prisma: PrismaService, service: ReconciliationService;
  let firstId: number, lastId: number;
  beforeAll(async () => {
    db = await createTestDatabase();
    prisma = new PrismaService({ DATABASE_URL: db.url });
    service = new ReconciliationService(prisma);
    const source = await prisma.dataSource.create({
      data: { kind: 'MODBUS_TCP', endpoint: '127.0.0.1:1502#1' },
    });
    const device = await prisma.device.create({
      data: {
        dataSourceId: source.id,
        deviceKey: 'test',
        role: 'INVERTER',
        model: 'test',
        observedCapabilities: {},
        capabilitiesObservedAt: date(0),
        firmware: {},
        firstSeenAt: date(0),
        lastSeenAt: date(3900),
      },
    });
    await prisma.mappingVersion.create({
      data: { version: 1, config: {}, provisional: false, note: 'test' },
    });
    const run = await prisma.collectorRun.create({
      data: {
        startedAt: date(0),
        appVersion: 'test',
        registerMapVersion: 'test',
      },
    });
    let seq = 0;
    const seconds = new Set([0, 60, 120, 3600, 3720]);
    for (let s = 50; s <= 310; s += 10) seconds.add(s);
    for (let s = 3590; s <= 3670; s += 10) seconds.add(s);
    for (const second of [...seconds].sort((a, b) => a - b)) {
      const t = date(second);
      const raw = await prisma.rawPoll.create({
        data: {
          runId: run.id,
          seq: ++seq,
          deviceId: device.id,
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
          deviceId: device.id,
          observedAt: t,
          mappingVersion: 1,
          gridW: 3600,
          gridAW: 3600,
          gridBW: 0,
          gridCW: 0,
          pvStringW: [],
          gridBuyWh: BigInt(second * 15),
          gridSellWh: BigInt(second * 5),
          gridBuyPhaseWh: [],
          gridSellPhaseWh: [],
          meterRepeatSec: 0,
          flags: 0,
        },
      });
    }
    await prisma.energyInterval.createMany({
      data: Array.from({ length: 11 }, (_, i) => ({
        bucketStart: date(300 + i * 300),
        calcVersion: 1,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: date(3900),
        gridCoveredSec: 300,
        pvCoveredSec: 0,
        batCoveredSec: 0,
        loadCoveredSec: 0,
        counterUnknownSec: [300, 0, 0, 300, 300, 300],
        counterGapAllocMask: 0,
        flags: 0,
        gridImportNetWh: '5000.000',
        gridExportNetWh: '0.000',
        gridImportPhaseWh: '5000.000',
        gridExportPhaseWh: '0.000',
        gridImportCounterWh: '4500.000',
        gridExportCounterWh: '1500.000',
      })),
    });
    const first = await prisma.meterReading.create({
      data: {
        readAt: date(65),
        source: 'UTILITY_METER_MANUAL',
        importKwh: '100.000',
        exportKwh: '40.000',
        resolutionKwh: '1.000',
      },
    });
    const last = await prisma.meterReading.create({
      data: {
        readAt: date(3665),
        source: 'UTILITY_METER_MANUAL',
        importKwh: '155.300',
        exportKwh: '60.000',
        resolutionKwh: '1.000',
      },
    });
    firstId = first.id;
    lastId = last.id;
  });
  afterAll(async () => {
    await prisma?.close();
    await db?.drop();
  });
  async function counterSample(
    second: number,
    seq: number,
    buy: bigint,
    sell = 0n,
  ) {
    const t = date(second),
      run = (await prisma.collectorRun.findFirst())!,
      device = (await prisma.device.findFirst())!;
    const raw = await prisma.rawPoll.create({
      data: {
        runId: run.id,
        seq,
        deviceId: device.id,
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
        deviceId: device.id,
        observedAt: t,
        mappingVersion: 1,
        gridBuyWh: buy,
        gridSellWh: sell,
        pvStringW: [],
        gridBuyPhaseWh: [],
        gridSellPhaseWh: [],
        meterRepeatSec: 0,
        flags: 0,
      },
    });
  }

  it('integrates both partial edge buckets and interpolates counter readings at exact read times', async () => {
    const result = await service.reconcile(firstId, lastId);
    const net = result.candidates.find((item) => item.source === 'METER_NET')!;
    expect(net.coverage.toNumber()).toBe(1);
    expect(net.import.oursKwh!.toFixed(3)).toBe('55.300');
    expect(net.import.verdict).toBe('PASS');
    expect(net.export.verdict).toBe('FAIL');
    const counter = result.candidates.find(
      (item) => item.source === 'INVERTER_COUNTER',
    )!;
    expect(counter.import.oursKwh!.toFixed(3)).toBe('54.000');
    expect(counter.import.verdict).toBe('PASS');
    expect(result.investigationPath).toHaveLength(5);
    expect(await service.accountingStatus('METER_NET')).toBe(
      'RECONCILIATION_FAILED',
    );
  });

  it('does not count a full ledger bucket for two readings in the same partial bucket', async () => {
    const short = await prisma.meterReading.create({
      data: {
        readAt: date(125),
        source: 'UTILITY_METER_MANUAL',
        importKwh: '100.060',
        exportKwh: '40.000',
        resolutionKwh: '1.000',
      },
    });
    const net = (await service.reconcile(firstId, short.id)).candidates.find(
      (item) => item.source === 'METER_NET',
    )!;
    expect(net.import.oursKwh!.toFixed(3)).toBe('0.060');
    expect(net.import.verdict).toBe('INSUFFICIENT');
  });

  it('applies floor, 0.99 coverage, 2 percent, and twice-resolution tolerances at exact boundaries', () => {
    const d = (n: string) => new Decimal(n);
    expect(
      evaluateDirection(d('50000'), d('50'), d('1'), d('0.99'), 50).verdict,
    ).toBe('PASS');
    expect(
      evaluateDirection(d('50000'), d('49.999'), d('1'), d('1'), 50).verdict,
    ).toBe('INSUFFICIENT');
    expect(
      evaluateDirection(d('20000'), d('20'), d('1'), d('1'), 20).verdict,
    ).toBe('PASS');
    expect(
      evaluateDirection(d('20000'), d('19.999'), d('1'), d('1'), 20).verdict,
    ).toBe('INSUFFICIENT');
    expect(
      evaluateDirection(d('50000'), d('50'), d('1'), d('0.989999'), 50).verdict,
    ).toBe('INSUFFICIENT');
    expect(
      evaluateDirection(d('52000'), d('50'), d('1'), d('1'), 50).verdict,
    ).toBe('PASS');
    expect(
      evaluateDirection(d('52001'), d('50'), d('1'), d('1'), 50).verdict,
    ).toBe('FAIL');
    expect(
      evaluateDirection(d('204000'), d('200'), d('0.1'), d('1'), 50).verdict,
    ).toBe('PASS');
    expect(
      evaluateDirection(d('204001'), d('200'), d('0.1'), d('1'), 50).verdict,
    ).toBe('FAIL');
  });

  it('never mutates policy validation when comparison fails', async () => {
    const policy = await prisma.accountingPolicy.create({
      data: {
        effectiveFrom: date(0),
        gridSource: 'METER_NET',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 30,
        validated: { grid: true },
        note: 'manually validated baseline',
      },
    });
    await prisma.meterReading.update({
      where: { id: lastId },
      data: { importKwh: '160.000' },
    });
    expect(
      (await service.reconcile(firstId, lastId)).candidates[0]!.import.verdict,
    ).toBe('FAIL');
    expect(
      (
        await prisma.accountingPolicy.findUnique({
          where: { version: policy.version },
        })
      )?.validated,
    ).toEqual({ grid: true });
  });
  it('interpolates a confirmed wrapping counter on its unwrapped scale', async () => {
    const original = (await prisma.device.findFirst())!;
    const device = await prisma.device.create({
      data: {
        dataSourceId: original.dataSourceId,
        deviceKey: 'replacement',
        role: 'INVERTER',
        model: 'test',
        observedCapabilities: {},
        capabilitiesObservedAt: date(86_400),
        firmware: {},
        firstSeenAt: date(86_400),
        lastSeenAt: date(86_430),
      },
    });
    const run = (await prisma.collectorRun.findFirst())!;
    const start = 86_400;
    for (const [index, offset, value] of [
      [100, 0, COUNTER_WRAP_WH - 100],
      [101, 10, COUNTER_WRAP_WH - 50],
      [102, 20, 50],
      [103, 30, 100],
    ]) {
      const t = date(start + offset!);
      const raw = await prisma.rawPoll.create({
        data: {
          runId: run.id,
          seq: index!,
          deviceId: device.id,
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
          deviceId: device.id,
          observedAt: t,
          mappingVersion: 1,
          gridBuyWh: BigInt(value!),
          gridSellWh: 0n,
          pvStringW: [],
          gridBuyPhaseWh: [],
          gridSellPhaseWh: [],
          meterRepeatSec: 0,
          flags: 0,
        },
      });
    }
    const from = await prisma.meterReading.create({
      data: {
        readAt: date(start + 15),
        source: 'HOYMILES_METER_LCD',
        importKwh: '0.000',
        resolutionKwh: '0.001',
      },
    });
    const to = await prisma.meterReading.create({
      data: {
        readAt: date(start + 25),
        source: 'HOYMILES_METER_LCD',
        importKwh: '0.075',
        resolutionKwh: '0.001',
      },
    });
    const candidate = (await service.reconcile(from.id, to.id)).candidates.find(
      (item) => item.source === 'INVERTER_COUNTER',
    )!;
    expect(candidate.import.oursKwh!.toFixed(3)).toBe('0.075');
    expect(candidate.import.verdict).toBe('INSUFFICIENT');
  });
  it('keeps full-bucket unknown coverage and excludes counter energy despite accepted endpoints', async () => {
    const bucket = date(300);
    await prisma.energyInterval.update({
      where: { bucketStart: bucket },
      data: { counterUnknownSec: [300, 120, 0, 300, 300, 300] },
    });
    const unknown = (await service.reconcile(firstId, lastId)).candidates.find(
      (item) => item.source === 'INVERTER_COUNTER',
    )!;
    expect(unknown.import.verdict).toBe('INSUFFICIENT');
    expect(unknown.coverage.toNumber()).toBeLessThan(0.99);
    await prisma.energyInterval.update({
      where: { bucketStart: bucket },
      data: { counterUnknownSec: [300, 0, 0, 300, 300, 300] },
    });
    const exclusion = await prisma.dataExclusion.create({
      data: {
        from: date(1000),
        to: date(1010),
        families: ['GRID'],
        reason: 'invalid CT',
        createdBy: 'test',
      },
    });
    const excluded = (await service.reconcile(firstId, lastId)).candidates.find(
      (item) => item.source === 'INVERTER_COUNTER',
    )!;
    expect(excluded.coverage.toNumber()).toBe(0);
    expect(excluded.import.oursKwh).toBeNull();
    expect(excluded.import.verdict).toBe('INSUFFICIENT');
    await prisma.dataExclusion.delete({ where: { id: exclusion.id } });
  });

  it('uses a persisted accepted baseline rather than two nearby raw counter rows', async () => {
    const day = 2 * 86_400,
      states = initialCounterStates();
    states.GRID_BUY = {
      segment: 3,
      deviceId: (await prisma.device.findFirst())!.id,
      last: { v: 100_000, tMs: date(day + 290).getTime() },
      confirmed: true,
      pending: [],
    };
    await prisma.energyInterval.create({
      data: {
        bucketStart: date(day),
        calcVersion: 1,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: date(day),
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
    await counterSample(day + 310, 2001, 100_300n);
    await counterSample(day + 320, 2002, 100_600n);
    const from = await prisma.meterReading.create({
      data: {
        readAt: date(day + 305),
        source: 'HOYMILES_METER_LCD',
        importKwh: '1.000',
        resolutionKwh: '0.001',
      },
    });
    const to = await prisma.meterReading.create({
      data: {
        readAt: date(day + 315),
        source: 'HOYMILES_METER_LCD',
        importKwh: '1.225',
        resolutionKwh: '0.001',
      },
    });
    const candidate = (await service.reconcile(from.id, to.id)).candidates.find(
      (item) => item.source === 'INVERTER_COUNTER',
    )!;
    expect(candidate.import.oursKwh?.toFixed(3)).toBe('0.225');
  });

  it('never differences counter endpoints across a reset segment', async () => {
    const day = 3 * 86_400;
    for (const [offset, reading] of [
      [0, 50_000],
      [10, 50_100],
      [20, 100],
      [30, 200],
    ])
      await counterSample(day + offset, 3000 + offset, BigInt(reading));
    const from = await prisma.meterReading.create({
      data: {
        readAt: date(day + 5),
        source: 'HOYMILES_METER_LCD',
        importKwh: '1.000',
        resolutionKwh: '0.001',
      },
    });
    const to = await prisma.meterReading.create({
      data: {
        readAt: date(day + 25),
        source: 'HOYMILES_METER_LCD',
        importKwh: '1.050',
        resolutionKwh: '0.001',
      },
    });
    const candidate = (await service.reconcile(from.id, to.id)).candidates.find(
      (item) => item.source === 'INVERTER_COUNTER',
    )!;
    expect(candidate.import.oursKwh).toBeNull();
    expect(candidate.import.verdict).toBe('INSUFFICIENT');
  });
  it('does not seed endpoint interpolation from a rejected nearby raw counter jump', async () => {
    const day = 4 * 86_400,
      states = initialCounterStates();
    states.GRID_BUY = {
      segment: 2,
      deviceId: (await prisma.device.findFirst())!.id,
      last: { v: 100_000, tMs: date(day + 290).getTime() },
      confirmed: true,
      pending: [],
    };
    await prisma.energyInterval.create({
      data: {
        bucketStart: date(day),
        calcVersion: 1,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: date(day),
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
    await counterSample(day + 310, 4010, 1_000_000n);
    await counterSample(day + 320, 4020, 100_300n);
    const from = await prisma.meterReading.create({
      data: {
        readAt: date(day + 305),
        source: 'HOYMILES_METER_LCD',
        importKwh: '1.000',
        resolutionKwh: '0.001',
      },
    });
    const to = await prisma.meterReading.create({
      data: {
        readAt: date(day + 315),
        source: 'HOYMILES_METER_LCD',
        importKwh: '1.100',
        resolutionKwh: '0.001',
      },
    });
    const candidate = (await service.reconcile(from.id, to.id)).candidates.find(
      (item) => item.source === 'INVERTER_COUNTER',
    )!;
    expect(candidate.import.oursKwh?.toFixed(3)).toBe('0.100');
  });
  it('derives each meter candidate coverage from its own ledger column', async () => {
    const day = 10 * 86_400;
    const net = { gridImportNetWh: '10.000', gridExportNetWh: '1.000' };
    const phase = { gridImportPhaseWh: '10.000', gridExportPhaseWh: '1.000' };
    const cases: Array<{
      name: string;
      values: Record<string, string | number | null>;
      netCoverage: number;
      phaseCoverage: number;
      phaseImportKwh: string | null;
    }> = [
      {
        // Meter total (1814) unavailable, all three phases valid.
        name: 'total missing, phases valid',
        values: { gridCoveredSec: 0, gridPhaseCoveredSec: 300, ...phase },
        netCoverage: 0,
        phaseCoverage: 1,
        phaseImportKwh: '0.050',
      },
      {
        // Total valid all bucket, phases valid half of it: PER_PHASE must not borrow the total.
        name: 'phases valid for half of a fully covered total',
        values: {
          gridCoveredSec: 300,
          gridPhaseCoveredSec: 150,
          ...net,
          ...phase,
        },
        netCoverage: 1,
        phaseCoverage: 0.5,
        phaseImportKwh: '0.050',
      },
      {
        // Historical row: NULL phase coverage falls back to the meter-total coverage.
        name: 'historical NULL phase coverage',
        values: { gridCoveredSec: 150, ...net, ...phase },
        netCoverage: 0.5,
        phaseCoverage: 0.5,
        phaseImportKwh: '0.050',
      },
      {
        // Total valid, a phase missing: there is no PER_PHASE energy to cover.
        name: 'total valid, phase missing',
        values: { gridCoveredSec: 300, gridPhaseCoveredSec: 0, ...net },
        netCoverage: 1,
        phaseCoverage: 0,
        phaseImportKwh: '0.000',
      },
    ];
    for (const [index, item] of cases.entries()) {
      const start = day + index * 3600;
      await prisma.energyInterval.createMany({
        data: Array.from({ length: 5 }, (_, i) => ({
          bucketStart: date(start + i * 300),
          calcVersion: 1,
          maxGapSecUsed: 30,
          mappingVersion: 1,
          computedAt: date(start),
          gridCoveredSec: 0,
          pvCoveredSec: 0,
          batCoveredSec: 0,
          loadCoveredSec: 0,
          counterUnknownSec: [300, 300, 300, 300, 300, 300],
          counterGapAllocMask: 0,
          flags: 0,
          ...item.values,
        })),
      });
      const from = await prisma.meterReading.create({
        data: {
          readAt: date(start),
          source: 'HOYMILES_METER_LCD',
          importKwh: '0.000',
          resolutionKwh: '0.001',
        },
      });
      const to = await prisma.meterReading.create({
        data: {
          readAt: date(start + 1500),
          source: 'HOYMILES_METER_LCD',
          importKwh: '0.050',
          resolutionKwh: '0.001',
        },
      });
      const result = await service.reconcile(from.id, to.id);
      const phase = result.candidates.find(
        (entry) => entry.source === 'METER_PER_PHASE',
      )!;
      const total = result.candidates.find(
        (entry) => entry.source === 'METER_NET',
      )!;
      expect(total.coverage.toNumber(), `${item.name}: METER_NET`).toBe(
        item.netCoverage,
      );
      expect(phase.coverage.toNumber(), `${item.name}: METER_PER_PHASE`).toBe(
        item.phaseCoverage,
      );
      expect(phase.import.oursKwh?.toFixed(3), item.name).toBe(
        item.phaseImportKwh,
      );
    }
  });
});
