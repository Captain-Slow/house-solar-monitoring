import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { DateTime } from 'luxon';
import { parseEnv } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { TotalsService } from '../src/accounting/totals.service.js';
import {
  SeriesService,
  selectSeriesWidth,
  type PowerMetric,
} from '../src/accounting/series.service.js';
import { LEDGER_ALGO_VERSION, LedgerFlag } from '../src/accounting/types.js';
import { SampleFlag } from '../src/collector/types.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import { TariffService } from '../src/tariff/tariff.service.js';

const start = new Date('2026-01-01T00:00:00Z');
const at = (offset: number) => new Date(start.getTime() + offset * 300_000);

describe('accounting totals and power series', () => {
  let db: TestDatabase,
    prisma: PrismaService,
    service: TotalsService,
    series: SeriesService;
  beforeAll(async () => {
    db = await createTestDatabase();
    const env = parseEnv({
      DATABASE_URL: db.url,
      COLLECTOR_ENABLED: 'false',
      SITE_TIMEZONE: 'UTC',
    });
    prisma = new PrismaService({ DATABASE_URL: db.url });
    service = new TotalsService(prisma, env);
    series = new SeriesService(prisma, env);
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
        capabilitiesObservedAt: start,
        firmware: {},
        firstSeenAt: start,
        lastSeenAt: start,
      },
    });
    await prisma.mappingVersion.create({
      data: { version: 1, config: {}, provisional: false, note: 'test' },
    });
    const run = await prisma.collectorRun.create({
      data: {
        startedAt: start,
        appVersion: 'test',
        registerMapVersion: 'test',
      },
    });
    const raw = await prisma.rawPoll.create({
      data: {
        runId: run.id,
        seq: 1,
        deviceId: device.id,
        tier: 'FAST',
        requestedAt: start,
        receivedAt: start,
        observedAt: start,
        blocks: Buffer.from([1]),
        contentHash: Buffer.alloc(32),
      },
    });
    await prisma.sample.create({
      data: {
        rawPollId: raw.id,
        deviceId: device.id,
        observedAt: start,
        mappingVersion: 1,
        pvStringW: [],
        gridBuyPhaseWh: [],
        gridSellPhaseWh: [],
        meterRepeatSec: 0,
        flags: 0,
      },
    });
    const base = {
      calcVersion: LEDGER_ALGO_VERSION,
      maxGapSecUsed: 30,
      mappingVersion: 1,
      computedAt: start,
      gridCoveredSec: 300,
      pvCoveredSec: 300,
      batCoveredSec: 300,
      loadCoveredSec: 300,
      counterUnknownSec: [0, 0, 0, 0, 0, 0],
      counterGapAllocMask: 0,
      flags: 0,
    };
    await prisma.energyInterval.createMany({
      data: [
        {
          ...base,
          bucketStart: at(0),
          gridImportNetWh: '100.100',
          gridImportCounterWh: '99.000',
          gridAvgW: 120,
          gridMinW: 100,
          gridMaxW: 140,
        },
        {
          ...base,
          bucketStart: at(1),
          gridImportNetWh: '99.000',
          gridImportCounterWh: '200.200',
          counterGapAllocMask: 1 << 1,
          gridCoveredSec: 299,
          gridAvgW: 180,
          gridMinW: 160,
          gridMaxW: 200,
        },
      ],
    });
    await prisma.accountingPolicy.createMany({
      data: [
        {
          effectiveFrom: start,
          gridSource: 'METER_NET',
          pvSource: 'INTEGRATED',
          batterySource: 'INTEGRATED',
          loadSource: 'DERIVED',
          maxGapSec: 30,
          validated: { grid: true, pv: false, battery: false, load: false },
          note: 'first',
        },
        {
          effectiveFrom: at(1),
          gridSource: 'INVERTER_COUNTER',
          pvSource: 'INTEGRATED',
          batterySource: 'INTEGRATED',
          loadSource: 'DERIVED',
          maxGapSec: 60,
          validated: { grid: false, pv: false, battery: false, load: false },
          note: 'switch',
        },
      ],
    });
  });
  afterAll(async () => {
    await prisma?.close();
    await db?.drop();
  });
  async function sample(
    second: number,
    seq: number,
    values: Record<string, number | bigint | null>,
    flags = 0,
  ) {
    const observedAt = new Date(start.getTime() + second * 1000);
    const run = (await prisma.collectorRun.findFirst())!;
    const device = (await prisma.device.findFirst())!;
    const raw = await prisma.rawPoll.create({
      data: {
        runId: run.id,
        seq,
        deviceId: device.id,
        tier: 'FAST',
        requestedAt: observedAt,
        receivedAt: observedAt,
        observedAt,
        blocks: Buffer.from([1]),
        contentHash: Buffer.alloc(32),
      },
    });
    await prisma.sample.create({
      data: {
        rawPollId: raw.id,
        deviceId: device.id,
        observedAt,
        mappingVersion: 1,
        ...values,
        pvStringW: [],
        gridBuyPhaseWh: [],
        gridSellPhaseWh: [],
        meterRepeatSec: 0,
        flags,
      },
    });
  }

  it('selects one policy candidate per bucket, exactly sums decimal Wh, and marks counter allocation and stale parameters', async () => {
    const totals = await service.energyTotals(
      '2026-01-01',
      '2026-01-01',
      'DAY',
    );
    expect(totals.rows).toHaveLength(1);
    expect(totals.total.gridImport.kwh).toBe('0.300');
    // Decimal summation in Wh avoids binary floating-point drift.
    expect(totals.rows[0]!.gridImport.source).toBe(
      'METER_NET+INVERTER_COUNTER',
    );
    expect(totals.rows[0]!.gridImport.provenance).toBe('ESTIMATED');
    expect(totals.rows[0]!.gridImport.validated).toBe(false);
    expect(totals.rows[0]!.gridImport.flags).toContain('STALE_CALC_PARAMS');
    expect(totals.rows[0]!.gridImport.status).toBe('PARTIAL');
  });

  it('uses the inclusive 0.995 coverage threshold and never treats a missing bucket as zero flow', async () => {
    const day = Date.parse('2026-01-02T00:00:00Z');
    await prisma.energyInterval.createMany({
      data: Array.from({ length: 287 }, (_, i) => ({
        bucketStart: new Date(day + i * 300_000),
        calcVersion: 1,
        maxGapSecUsed: 60,
        mappingVersion: 1,
        computedAt: start,
        gridCoveredSec: 300,
        pvCoveredSec: 300,
        batCoveredSec: 300,
        loadCoveredSec: 300,
        counterUnknownSec: [0, i === 286 ? 132 : 0, 0, 0, 0, 0],
        counterGapAllocMask: 0,
        flags: 0,
        gridImportCounterWh: '1.000',
      })),
    });
    const full = await service.energyTotals('2026-01-02', '2026-01-02', 'DAY');
    expect(full.total.gridImport.coverage.toString()).toBe('0.995');
    expect(full.total.gridImport.status).toBe('OK');
    await prisma.energyInterval.update({
      where: { bucketStart: new Date(day + 286 * 300_000) },
      data: { counterUnknownSec: [0, 133, 0, 0, 0, 0] },
    });
    const short = await service.energyTotals('2026-01-02', '2026-01-02', 'DAY');
    expect(short.total.gridImport.status).toBe('PARTIAL');
    expect(short.total.gridImport.kwh).not.toBeNull();
    const across = await service.energyTotals(
      '2026-01-01',
      '2026-01-02',
      'DAY',
    );
    expect(across.rows.map((row) => row.gridImport.kwh)).toEqual([
      '0.300',
      '0.287',
    ]);
    expect(across.total.gridImport.kwh).toBe('0.587');
  });

  it('chooses specified widths and emits a null gap when sample-backed metrics have no samples', async () => {
    expect(
      [
        [10, 1],
        [31, 1],
        [300, 1],
        [301, 1],
        [366 * 86400, 2000],
      ].map(([span, max]) => selectSeriesWidth(span!, max!)),
    ).toEqual([10, 60, 300, 900, 86400]);
    const result = await series.powerSeries(
      start,
      at(2),
      ['GRID', 'GRID_A'],
      2,
    );
    expect(result.bucketSeconds).toBe(300);
    expect(result.series[0]!.points.map((point) => point.avg)).toEqual([
      120, 180,
    ]);
    expect(result.series[1]!.points.map((point) => point.avg)).toEqual([
      null,
      null,
    ]);
    expect(result.gaps).toEqual([{ from: start, to: at(2) }]);
  });

  it('counts distinct 10-second sample slots rather than overcounting a burst, and exposes a true gap', async () => {
    const run = (await prisma.collectorRun.findFirst())!;
    const device = (await prisma.device.findFirst())!;
    const first = Date.parse('2026-01-03T00:00:00Z');
    for (const [index, second, watts] of [
      [2, 0, 100],
      [3, 2, 200],
      [4, 20, 300],
    ]) {
      const observedAt = new Date(first + second! * 1000);
      const raw = await prisma.rawPoll.create({
        data: {
          runId: run.id,
          seq: index!,
          deviceId: device.id,
          tier: 'FAST',
          requestedAt: observedAt,
          receivedAt: observedAt,
          observedAt,
          blocks: Buffer.from([1]),
          contentHash: Buffer.alloc(32),
        },
      });
      await prisma.sample.create({
        data: {
          rawPollId: raw.id,
          deviceId: device.id,
          observedAt,
          mappingVersion: 1,
          gridW: watts,
          pvStringW: [],
          gridBuyPhaseWh: [],
          gridSellPhaseWh: [],
          vendorToday: {
            grid_buy_today: index === 2 ? 100 : index === 3 ? 90 : 200,
          },
          meterRepeatSec: 0,
          flags: 0,
        },
      });
    }
    const result = await series.powerSeries(
      new Date(first),
      new Date(first + 60_000),
      ['GRID'],
      2,
    );
    expect(result.bucketSeconds).toBe(30);
    expect(result.series[0]!.points.map((point) => point.avg)).toEqual([
      200,
      null,
    ]);
    expect(result.series[0]!.points[0]!.coverage.toNumber()).toBeCloseTo(2 / 3);
    expect(result.series[0]!.points[0]!.min).toBe(100);
    expect(result.series[0]!.points[0]!.max).toBe(300);
    expect(result.gaps).toEqual([
      { from: new Date(first + 30_000), to: new Date(first + 60_000) },
    ]);
    const totals = await service.energyTotals(
      '2026-01-03',
      '2026-01-03',
      'DAY',
    );
    expect(totals.total.vendor.vendorToday.gridImport).toMatchObject({
      kwh: '0.200',
      provenance: 'VENDOR_SUMMARY',
    });
    expect(totals.total.vendor.lifetime.gridImport.kwh).toBeNull();
  });

  it('separates final raw lifetime from interval delta, including a single known reading', async () => {
    await sample(
      (Date.parse('2026-01-11T01:00:00Z') - start.getTime()) / 1000,
      10001,
      { gridBuyWh: 1_000_000n },
    );
    const single = await service.energyTotals(
      '2026-01-11',
      '2026-01-11',
      'DAY',
    );
    expect(single.total.vendor.lifetime.gridImport).toEqual({
      kwh: '1000.000',
      provenance: 'DEVICE_COUNTER',
    });
    expect(single.total.vendor.intervalDelta.gridImport.kwh).toBeNull();
    await sample(
      (Date.parse('2026-01-11T23:00:00Z') - start.getTime()) / 1000,
      10002,
      { gridBuyWh: 1_001_000n },
    );
    const pair = await service.energyTotals('2026-01-11', '2026-01-11', 'DAY');
    expect(pair.total.vendor.lifetime.gridImport.kwh).toBe('1001.000');
    expect(pair.total.vendor.intervalDelta.gridImport).toEqual({
      kwh: '1.000',
      provenance: 'DEVICE_COUNTER',
    });
    expect(pair.rows[0]!.vendor).toEqual(pair.total.vendor);
    expect(pair.total.gridImport.kwh).toBeNull();
  });

  it('requires an explicit tariff and classifies 14:00/22:00, version changes and holidays', async () => {
    const tariffService = new TariffService(prisma);
    await tariffService.createTariff({
      name: 'Not selected',
      currency: 'MYR',
      timezone: 'UTC',
    });
    const tariff = await tariffService.createTariff({
      name: 'Selected ToU',
      currency: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
    });
    const rules = {
      currency: 'MYR',
      timezone: tariff.timezone,
      touWindows: [
        {
          code: 'PEAK',
          days: ['MON', 'TUE', 'WED', 'THU', 'FRI'],
          start: '14:00',
          end: '22:00',
          excludeHolidays: true,
        },
      ],
      defaultWindow: 'OFFPEAK',
      consumptionBasis: 'GROSS_IMPORT',
      thresholdProration: 'NONE',
      nem: null,
      components: [
        {
          code: 'FIXED',
          label: 'Fixture',
          kind: 'FIXED',
          amount: '0',
          prorate: false,
        },
      ],
      totalRounding: 'NONE',
    };
    await tariffService.createTariffVersion(
      tariff.id,
      '2026-02-01',
      '2026-02-02',
      JSON.stringify(rules),
      'fixture',
    );
    await tariffService.createTariffVersion(
      tariff.id,
      '2026-02-03',
      undefined,
      JSON.stringify({
        ...rules,
        touWindows: [
          { ...rules.touWindows[0], code: 'NEW_PEAK', start: '15:00' },
        ],
      }),
      'changed fixture',
    );
    await tariffService.setTariffHolidays(tariff.id, 2026, [
      { date: '2026-02-04', name: 'Fixture holiday' },
    ]);
    const first = DateTime.fromISO('2026-02-02', {
      zone: tariff.timezone,
    }).toJSDate();
    await prisma.accountingPolicy.create({
      data: {
        effectiveFrom: first,
        gridSource: 'METER_NET',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 60,
        validated: { grid: true },
        note: 'window fixture',
      },
    });
    for (const [local, wh] of [
      ['2026-02-02T13:55', '100'],
      ['2026-02-02T14:00', '200'],
      ['2026-02-02T21:55', '300'],
      ['2026-02-02T22:00', '400'],
      ['2026-02-03T14:00', '500'],
      ['2026-02-03T15:00', '600'],
      ['2026-02-04T15:00', '700'],
    ]) {
      await prisma.energyInterval.create({
        data: {
          bucketStart: DateTime.fromISO(local!, {
            zone: tariff.timezone,
          }).toJSDate(),
          calcVersion: LEDGER_ALGO_VERSION,
          maxGapSecUsed: 60,
          mappingVersion: 1,
          computedAt: start,
          gridCoveredSec: 300,
          pvCoveredSec: 0,
          batCoveredSec: 0,
          loadCoveredSec: 0,
          counterUnknownSec: [300, 300, 300, 300, 300, 300],
          counterGapAllocMask: 0,
          flags: 0,
          gridImportNetWh: wh,
          gridExportNetWh: wh,
          gridImportCounterWh: '9999',
          gridExportCounterWh: '9999',
        },
      });
    }
    const lookup = vi.spyOn(prisma.tariff, 'findUnique');
    try {
      const unselected = await service.energyTotals(
        '2026-02-02',
        '2026-02-04',
        'DAY',
      );
      expect(unselected.total.gridByWindow).toEqual([]);
      expect(lookup).not.toHaveBeenCalled();
    } finally {
      lookup.mockRestore();
    }
    const result = await service.energyTotals(
      '2026-02-02',
      '2026-02-04',
      'DAY',
      tariff.id,
      tariff.timezone,
    );
    const byWindow = (row: typeof result.total) =>
      Object.fromEntries(
        row.gridByWindow.map((value) => [
          value.window,
          [value.importKwh.kwh, value.exportKwh.kwh],
        ]),
      );
    expect(byWindow(result.rows[0]!)).toEqual({
      OFFPEAK: ['0.500', '0.500'],
      PEAK: ['0.500', '0.500'],
    });
    expect(byWindow(result.rows[1]!)).toEqual({
      OFFPEAK: ['0.500', '0.500'],
      NEW_PEAK: ['0.600', '0.600'],
    });
    expect(byWindow(result.rows[2]!)).toEqual({ OFFPEAK: ['0.700', '0.700'] });
    expect(byWindow(result.total)).toEqual({
      OFFPEAK: ['1.700', '1.700'],
      PEAK: ['0.500', '0.500'],
      NEW_PEAK: ['0.600', '0.600'],
    });
    const peak = result.rows[0]!.gridByWindow.find(
      (value) => value.window === 'PEAK',
    )!.importKwh;
    expect(peak.source).toBe('METER_NET');
    expect(peak.validated).toBe(true);
    expect(peak.status).toBe('PARTIAL');
    expect(peak.coverage.toNumber()).toBeCloseTo(600 / (8 * 3600));
    expect(peak.flags).not.toContain('HOLIDAY_CALENDAR_MISSING');
    await expect(
      service.energyTotals(
        '2026-01-31',
        '2026-02-02',
        'DAY',
        tariff.id,
        tariff.timezone,
      ),
    ).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    await expect(
      service.energyTotals('2026-02-02', '2026-02-02', 'DAY', -1),
    ).rejects.toMatchObject({ extensions: { code: 'BAD_USER_INPUT' } });
    await prisma.tariffHoliday.deleteMany({ where: { tariffId: tariff.id } });
    const missingCalendar = await service.energyTotals(
      '2026-02-04',
      '2026-02-04',
      'DAY',
      tariff.id,
      tariff.timezone,
    );
    const uncertainPeak = missingCalendar.total.gridByWindow.find(
      (value) => value.window === 'NEW_PEAK',
    )!;
    expect(uncertainPeak.importKwh.kwh).toBe('0.700');
    expect(uncertainPeak.importKwh.flags).toContain('HOLIDAY_CALENDAR_MISSING');
  });

  it('aggregates Berlin DST days over 276 and 300 UTC buckets, agreeing with UTC totals', async () => {
    const env = parseEnv({
      DATABASE_URL: db.url,
      COLLECTOR_ENABLED: 'false',
      SITE_TIMEZONE: 'Europe/Berlin',
    });
    const berlin = new TotalsService(prisma, env);
    for (const [local, expected, utc] of [
      ['2026-03-29', 276, '2026-03-28T23:00:00Z'],
      ['2026-10-25', 300, '2026-10-24T22:00:00Z'],
    ] as const) {
      const first = Date.parse(utc);
      await prisma.energyInterval.createMany({
        data: Array.from({ length: expected }, (_, i) => ({
          bucketStart: new Date(first + i * 300_000),
          calcVersion: 1,
          maxGapSecUsed: 30,
          mappingVersion: 1,
          computedAt: start,
          gridCoveredSec: 300,
          pvCoveredSec: 300,
          batCoveredSec: 300,
          loadCoveredSec: 300,
          counterUnknownSec: [0, 0, 0, 0, 0, 0],
          counterGapAllocMask: 0,
          flags: 0,
          pvIntWh: '1.000',
        })),
      });
      const localResult = await berlin.energyTotals(local, local, 'DAY');
      const firstUtc = DateTime.fromMillis(first, { zone: 'utc' }).toISODate()!;
      const lastUtc = DateTime.fromMillis(first + expected * 300_000 - 1, {
        zone: 'utc',
      }).toISODate()!;
      const utcResult = await service.energyTotals(firstUtc, lastUtc, 'DAY');
      expect(localResult.total.solar.kwh).toBe(
        expected === 276 ? '0.276' : '0.300',
      );
      expect(localResult.total.solar.kwh).toBe(utcResult.total.solar.kwh);
    }
  });
  it('rounds total raw Wh once, and refuses coverage for a null selected candidate', async () => {
    const first = Date.parse('2026-01-05T00:00:00Z');
    for (const i of [0, 1]) {
      await prisma.energyInterval.create({
        data: {
          bucketStart: new Date(first + i * 86_400_000),
          calcVersion: LEDGER_ALGO_VERSION,
          maxGapSecUsed: 60,
          mappingVersion: 1,
          computedAt: start,
          gridCoveredSec: 300,
          pvCoveredSec: 300,
          batCoveredSec: 300,
          loadCoveredSec: 300,
          counterUnknownSec: [0, 0, 0, 0, 0, 0],
          counterGapAllocMask: 0,
          flags: 0,
          pvIntWh: '0.490',
        },
      });
    }
    const result = await service.energyTotals(
      '2026-01-05',
      '2026-01-06',
      'DAY',
    );
    expect(result.rows.map((row) => row.solar.kwh)).toEqual(['0.000', '0.000']);
    expect(result.total.solar.kwh).toBe('0.001');
    await prisma.energyInterval.create({
      data: {
        bucketStart: new Date(first + 2 * 86_400_000),
        calcVersion: LEDGER_ALGO_VERSION,
        maxGapSecUsed: 60,
        mappingVersion: 1,
        computedAt: start,
        gridCoveredSec: 300,
        pvCoveredSec: 300,
        batCoveredSec: 300,
        loadCoveredSec: 300,
        counterUnknownSec: [0, 0, 0, 0, 0, 0],
        counterGapAllocMask: 0,
        flags: 0,
        gridImportCounterWh: null,
      },
    });
    const absent = await service.energyTotals(
      '2026-01-07',
      '2026-01-07',
      'DAY',
    );
    expect(absent.total.gridImport.coverage.toNumber()).toBe(0);
    expect(absent.total.gridImport.kwh).toBeNull();
    expect(absent.total.gridImport.status).toBe('UNAVAILABLE');
  });

  it('aggregates every power metric at ledger widths and preserves unknown min/max and weighted edge overlaps', async () => {
    const origin = Date.parse('2026-01-08T00:00:00Z');
    await prisma.energyInterval.createMany({
      data: [0, 1].map((i) => ({
        bucketStart: new Date(origin + i * 300_000),
        calcVersion: LEDGER_ALGO_VERSION,
        maxGapSecUsed: 60,
        mappingVersion: 1,
        computedAt: start,
        gridCoveredSec: 300,
        pvCoveredSec: 300,
        batCoveredSec: 300,
        socCoveredSec: 300,
        loadCoveredSec: 300,
        counterUnknownSec: [0, 0, 0, 0, 0, 0],
        counterGapAllocMask: 0,
        flags: 0,
        pvAvgW: i ? 300 : 100,
        pvMaxW: i ? 500 : 200,
        socMin: i ? 20 : 50,
        socMax: i ? 40 : 80,
        socLast: i ? 35 : 75,
      })),
    });
    const shift = (origin - start.getTime()) / 1000;
    await sample(shift + 5, 1005, {
      gridAW: 111,
      inverterAcW: 222,
      loadVendorW: 55,
    });
    await sample(
      shift + 15,
      1015,
      { gridAW: 200, inverterAcW: 300, loadVendorW: 999 },
      SampleFlag.BLOCK_INVALID_2000,
    );
    await sample(shift + 305, 1305, {
      gridAW: 333,
      inverterAcW: 444,
      loadVendorW: 77,
    });
    const sampled = await series.powerSeries(
      new Date(origin),
      new Date(origin + 600_000),
      ['GRID_A', 'LOAD_VENDOR', 'INVERTER_AC'],
      2,
    );
    expect(sampled.bucketSeconds).toBe(300);
    expect(sampled.series.map((s) => s.points.map((p) => p.avg))).toEqual([
      [156, 333],
      [55, 77],
      [261, 444],
    ]);
    expect(sampled.gaps).toEqual([]);
    const ledger = await series.powerSeries(
      new Date(origin + 270_000),
      new Date(origin + 600_000),
      ['PV', 'SOC'],
      1,
    );
    expect(ledger.bucketSeconds).toBe(900);
    expect(ledger.series[0]!.points[0]).toMatchObject({
      avg: 282,
      min: null,
      max: 500,
    });
    expect(ledger.series[0]!.points[0]!.coverage.toNumber()).toBe(1);
    expect(ledger.series[1]!.points[0]).toMatchObject({
      avg: null,
      min: 20,
      max: 80,
    });
    const env = parseEnv({
      DATABASE_URL: db.url,
      COLLECTOR_ENABLED: 'false',
      SITE_TIMEZONE: 'UTC',
      SAMPLE_RETENTION_DAYS: '1',
    });
    const expired = await new SeriesService(prisma, env).powerSeries(
      new Date(origin),
      new Date(origin + 600_000),
      ['GRID_A'],
      2,
    );
    expect(expired.series[0]!.points.map((point) => point.avg)).toEqual([
      null,
      null,
    ]);
    expect(expired.gaps).toEqual([
      { from: new Date(origin), to: new Date(origin + 600_000) },
    ]);
  });
  it('bounds partial-window SOC coverage without placing unknown historical slots inside the query', async () => {
    const origin = Date.parse('2026-01-13T00:00:00Z');
    await prisma.energyInterval.createMany({
      data: [100, 300].map((socCoveredSec, index) => ({
        bucketStart: new Date(origin + index * 300_000),
        calcVersion: LEDGER_ALGO_VERSION,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: start,
        gridCoveredSec: 0,
        pvCoveredSec: 0,
        batCoveredSec: 0,
        loadCoveredSec: 0,
        socCoveredSec,
        socMin: 50,
        socMax: 50,
        socLast: 50,
        counterUnknownSec: [300, 300, 300, 300, 300, 300],
        counterGapAllocMask: 0,
        flags: 0,
      })),
    });
    for (let i = 0; i < 10; i++)
      await sample((origin - start.getTime()) / 1000 + i * 10, 5000 + i, {
        batterySoc: 50,
      });
    const from = new Date(origin + 200_000);
    const to = new Date(origin + 261_000);
    const coarse = await series.powerSeries(from, to, ['SOC'], 1);
    expect(coarse.bucketSeconds).toBe(300);
    expect(coarse.series[0]!.points[0]!.coverage.toNumber()).toBe(0);
    expect(coarse.series[0]!.points[0]).toMatchObject({
      avg: null,
      min: 50,
      max: 50,
    });
    expect(coarse.gaps).toEqual([{ from, to }]);
    const fine = await series.powerSeries(from, to, ['SOC'], 1000);
    expect(
      fine.series[0]!.points.every((point) => point.coverage.isZero()),
    ).toBe(true);
    const whole = await series.powerSeries(
      new Date(origin),
      new Date(origin + 300_000),
      ['SOC'],
      1,
    );
    expect(whole.series[0]!.points[0]!.coverage.toNumber()).toBeCloseTo(1 / 3);
    const full = await series.powerSeries(
      new Date(origin + 500_000),
      new Date(origin + 561_000),
      ['SOC'],
      1,
    );
    expect(full.series[0]!.points[0]!.coverage.toNumber()).toBe(1);
    expect(full.gaps).toEqual([]);
  });

  it('keeps historical SOC extrema but advertises no invented coverage when independent coverage is null', async () => {
    const origin = Date.parse('2026-01-12T00:00:00Z');
    await prisma.energyInterval.create({
      data: {
        bucketStart: new Date(origin),
        calcVersion: 2,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: start,
        gridCoveredSec: 0,
        pvCoveredSec: 0,
        batCoveredSec: 300,
        loadCoveredSec: 0,
        socCoveredSec: null,
        counterUnknownSec: [300, 300, 300, 300, 300, 300],
        counterGapAllocMask: 0,
        flags: LedgerFlag.OUTSIDE_RETENTION,
        socMin: 40,
        socMax: 80,
        socLast: 60,
      },
    });
    const result = await series.powerSeries(
      new Date(origin),
      new Date(origin + 300_000),
      ['SOC'],
      1,
    );
    expect(result.series[0]!.points[0]).toMatchObject({
      avg: null,
      min: 40,
      max: 80,
    });
    expect(result.series[0]!.points[0]!.coverage.toNumber()).toBe(0);
    expect(result.gaps).toEqual([
      { from: new Date(origin), to: new Date(origin + 300_000) },
    ]);
    const partial = await series.powerSeries(
      new Date(origin + 1_000),
      new Date(origin + 301_000),
      ['SOC'],
      1,
    );
    expect(partial.series[0]!.points[0]).toMatchObject({
      avg: null,
      min: 40,
      max: 80,
    });
    expect(
      partial.series[0]!.points.every((point) => point.coverage.isZero()),
    ).toBe(true);
  });

  it('keeps monitoring history after Sample retention, validates policy-only spans, and derives staleness from current parameters', async () => {
    await prisma.accountingPolicy.createMany({
      data: [
        {
          effectiveFrom: new Date('2026-01-09T00:00:00Z'),
          gridSource: 'METER_NET',
          pvSource: 'INTEGRATED',
          batterySource: 'INTEGRATED',
          loadSource: 'DERIVED',
          maxGapSec: 30,
          validated: { grid: true },
          note: 'validated span',
        },
        {
          effectiveFrom: new Date('2026-01-10T00:00:00Z'),
          gridSource: 'METER_PER_PHASE',
          pvSource: 'INTEGRATED',
          batterySource: 'INTEGRATED',
          loadSource: 'DERIVED',
          maxGapSec: 30,
          validated: { grid: false },
          note: 'not validated span',
        },
      ],
    });
    const first = await service.energyTotals('2026-01-09', '2026-01-09', 'DAY');
    expect(first.total.gridImport.validated).toBe(true);
    const both = await service.energyTotals('2026-01-09', '2026-01-10', 'DAY');
    expect(both.total.gridImport.validated).toBe(false);
    expect(both.total.gridImport.source).toBe('METER_NET+METER_PER_PHASE');
    await prisma.energyInterval.create({
      data: {
        bucketStart: new Date('2026-01-10T00:00:00Z'),
        calcVersion: LEDGER_ALGO_VERSION,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: start,
        gridCoveredSec: 300,
        pvCoveredSec: 0,
        batCoveredSec: 0,
        loadCoveredSec: 0,
        counterUnknownSec: [0, 0, 0, 0, 0, 0],
        counterGapAllocMask: 0,
        flags: LedgerFlag.STALE_CALC_PARAMS,
        gridImportPhaseWh: '1000.000',
      },
    });
    const current = await service.energyTotals(
      '2026-01-10',
      '2026-01-10',
      'DAY',
    );
    expect(current.total.gridImport.flags).not.toContain('STALE_CALC_PARAMS');
    await prisma.sample.deleteMany({ where: { observedAt: start } });
    const historical = await service.energyTotals(
      '2026-01-01',
      '2026-01-01',
      'DAY',
    );
    expect(historical.monitoringSince).toEqual(start);
    expect(historical.total.gridImport.kwh).toBe('0.300');
  });
  it('rejects empty, invalid and oversized metric selections before database work', async () => {
    const samples = vi.spyOn(prisma, '$queryRaw');
    const intervals = vi.spyOn(prisma.energyInterval, 'findMany');
    try {
      for (const metrics of [
        [],
        null,
        {},
        ['constructor'],
        ['toString'],
        ['GRID_A', null],
        Array.from({ length: 2 }),
        Array.from({ length: 11 }, () => 'GRID_A'),
        Array.from({ length: 5000 }, () => 'GRID_A'),
      ]) {
        await expect(
          series.powerSeries(start, at(2), metrics as PowerMetric[], 2),
        ).rejects.toMatchObject({
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }
      expect(samples).not.toHaveBeenCalled();
      expect(intervals).not.toHaveBeenCalled();
    } finally {
      samples.mockRestore();
      intervals.mockRestore();
    }
  });

  it('preserves valid metric order and values while deduplicating bounded selections', async () => {
    const metrics: PowerMetric[] = [
      'PV',
      'LOAD',
      'LOAD_VENDOR',
      'GRID',
      'GRID_A',
      'GRID_B',
      'GRID_C',
      'BATTERY',
      'SOC',
      'INVERTER_AC',
    ];
    const all = await series.powerSeries(start, at(2), metrics, 2);
    expect(all.series.map((entry) => entry.metric)).toEqual(metrics);
    expect(all.series.every((entry) => entry.points.length === 2)).toBe(true);
    const unique = await series.powerSeries(
      start,
      at(2),
      ['GRID', 'GRID_A'],
      2,
    );
    const repeated = await series.powerSeries(
      start,
      at(2),
      ['GRID', 'GRID_A', 'GRID'],
      2,
    );
    expect(repeated).toEqual(unique);
  });
});
