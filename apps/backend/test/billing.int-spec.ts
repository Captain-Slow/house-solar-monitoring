import type pg from 'pg';
import { TariffResolver } from '../src/graphql/tariff.resolver.js';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { BillingService } from '../src/tariff/billing.service.js';
import { TariffService } from '../src/tariff/tariff.service.js';
import { AccountingMutations } from '../src/accounting/accounting.mutations.js';
import { RawPollRenormalizer } from '../src/accounting/raw-poll-renormalizer.js';
import { BILLING_CALC_VERSION } from '../src/tariff/types.js';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service.js';
import { LEDGER_ALGO_VERSION, LedgerFlag } from '../src/accounting/types.js';
import { createPolicyVersion } from '../src/accounting/policy.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

const flat = {
  currency: 'MYR',
  timezone: 'UTC',
  touWindows: [],
  defaultWindow: 'OFFPEAK',
  consumptionBasis: 'GROSS_IMPORT',
  thresholdProration: 'NONE',
  nem: null,
  components: [
    {
      code: 'TEST_ENERGY',
      label: 'Fake import energy',
      kind: 'PER_KWH',
      basis: 'IMPORT',
      rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '0.50' }] }],
      tierMode: 'INCREMENTAL',
    },
  ],
  totalRounding: 'NONE',
};
const nemRules = {
  ...flat,
  consumptionBasis: 'NET_IMPORT',
  nem: {
    offsetComponents: ['TEST_ENERGY'],
    touOffset: 'PRO_RATA',
    creditExpiryPeriods: 12,
  },
};
const at = (date: string, bucket: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + bucket * 300_000);

describe('billing service from the ledger', () => {
  let db: TestDatabase,
    prisma: PrismaService,
    tariff: TariffService,
    billing: BillingService;
  beforeAll(async () => {
    db = await createTestDatabase();
    const env = parseEnv({
      DATABASE_URL: db.url,
      COLLECTOR_ENABLED: 'false',
      SITE_TIMEZONE: 'UTC',
    });
    prisma = new PrismaService({ DATABASE_URL: db.url });
    tariff = new TariffService(prisma);
    billing = new BillingService(
      prisma,
      env,
      new ReconciliationService(prisma),
    );
    await prisma.mappingVersion.create({
      data: { version: 1, config: {}, provisional: false, note: 'synthetic' },
    });
    await prisma.accountingPolicy.create({
      data: {
        effectiveFrom: new Date('2026-01-01T00:00:00Z'),
        gridSource: 'METER_NET',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 30,
        validated: {},
        note: 'synthetic',
      },
    });
  });
  afterAll(async () => {
    await prisma?.close();
    await db?.drop();
  });

  async function makeTariff(rules: object = flat, from = '2026-01-01') {
    const row = await tariff.createTariff({
      name: 'Synthetic pricing',
      currency: 'MYR',
      timezone: 'UTC',
    });
    const version = await tariff.createTariffVersion(
      row.id,
      from,
      null,
      JSON.stringify(rules),
      'Test-only fake rates',
    );
    return { row, version };
  }
  async function seedDay(
    date: string,
    options: {
      importWh?: string;
      exportWh?: string;
      coverage?: (bucket: number) => number;
      counterImportWh?: string;
      counterExportWh?: string;
      counterBucket?: number;
      gapBucket?: number;
    } = {},
  ) {
    await prisma.energyInterval.createMany({
      data: Array.from({ length: 288 }, (_, index) => ({
        bucketStart: at(date, index),
        calcVersion: LEDGER_ALGO_VERSION,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: at(date, index),
        gridImportNetWh: index === 0 ? (options.importWh ?? '0.000') : '0.000',
        gridExportNetWh: index === 0 ? (options.exportWh ?? '0.000') : '0.000',
        gridImportCounterWh:
          index === (options.counterBucket ?? 0)
            ? (options.counterImportWh ?? '0.000')
            : '0.000',
        gridExportCounterWh:
          index === (options.counterBucket ?? 0)
            ? (options.counterExportWh ?? '0.000')
            : '0.000',
        gridImportPhaseWh: '0.000',
        gridExportPhaseWh: '0.000',
        gridCoveredSec: options.coverage?.(index) ?? 300,
        pvCoveredSec: 300,
        batCoveredSec: 300,
        loadCoveredSec: 300,
        counterUnknownSec: [0, 0, 0, 0, 0, 0],
        counterGapAllocMask: index === options.gapBucket ? 1 << 1 : 0,
        flags: index === options.gapBucket ? LedgerFlag.TOU_UNCERTAIN : 0,
      })),
    });
  }
  const now = new Date('2027-01-01T00:00:00Z');
  it('splits a Nov–Dec billing period at the tariff version and retains whole-period coverage', async () => {
    const { row, version } = await makeTariff(flat, '2026-11-03');
    await prisma.tariffVersion.update({
      where: { id: version.id },
      data: { effectiveTo: new Date('2026-11-14') },
    });
    const second = await tariff.createTariffVersion(
      row.id,
      '2026-11-15',
      null,
      JSON.stringify(flat),
      'Different fake test version',
    );
    const period = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-11-03',
      endDate: '2026-12-02',
      openingCreditLots: [],
    });
    for (let i = 0; i < 23; i++) {
      const date = new Date(
        new Date('2026-11-03T00:00:00Z').getTime() + i * 86_400_000,
      )
        .toISOString()
        .slice(0, 10);
      await seedDay(date, {
        importWh: i === 0 ? '1000.000' : i === 12 ? '2000.000' : '0.000',
      });
    }
    await seedDay('2026-12-01', { importWh: '3000.000' });
    const result = await billing.computePeriod(period.id, now);
    expect(result.tariffVersionIds).toEqual([version.id, second.id]);
    expect(result.reasons).toContain('TARIFF_CHANGED_MID_PERIOD');
    expect(result.reasons).toContain('TARIFF_NOT_BILL_VERIFIED');
    expect(result.coverage.toFixed(4)).toBe('0.8000');
    expect(result.status).toBe('ESTIMATED');
    const quantities = z
      .array(
        z.object({
          versionId: z.number(),
          importByMonth: z.record(z.string(), z.string()),
        }),
      )
      .parse(result.quantities);
    expect(quantities).toMatchObject([
      { versionId: version.id, importByMonth: { '2026-11': '1.000' } },
      {
        versionId: second.id,
        importByMonth: { '2026-11': '2.000', '2026-12': '3.000' },
      },
    ]);
    const before = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-10-01',
      endDate: '2026-10-01',
    });
    expect((await billing.computePeriod(before.id, now)).reasons).toContain(
      'NO_TARIFF_VERSION',
    );
  });

  it('uses the selected policy source and marks counter gap allocation; policy changes invalidate stored versions', async () => {
    const { row } = await makeTariff();
    await seedDay('2026-05-01', {
      importWh: '1000.000',
      counterImportWh: '2000.000',
      counterBucket: 1,
      gapBucket: 1,
    });
    const period = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-05-01',
      endDate: '2026-05-01',
      openingCreditLots: [],
    });
    let result = await billing.computePeriod(period.id, now);
    expect(result.total?.toFixed(2)).toBe('0.50');
    const unaffected = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-04-30',
      endDate: '2026-04-30',
      openingCreditLots: [],
    });
    await billing.computePeriod(unaffected.id, now);
    await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-05-02',
      endDate: '2026-05-02',
      openingCreditLots: [],
    });
    const affectedCount = await prisma.billingPeriodResult.count({
      where: { period: { endDate: { gte: new Date('2026-05-01') } } },
    });
    const changed = await createPolicyVersion(
      prisma,
      {
        effectiveFrom: new Date('2026-05-01T00:05:00Z'),
        gridSource: 'INVERTER_COUNTER',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 30,
        note: 'Synthetic source switch',
      },
      400,
      now,
    );
    expect(changed.billingPeriodsInvalidated).toBe(affectedCount);
    expect(
      (
        await prisma.billingPeriodResult.findUniqueOrThrow({
          where: { billingPeriodId: unaffected.id },
        })
      ).calcVersion,
    ).toBe(BILLING_CALC_VERSION);
    expect(
      await billing.isStale(
        await prisma.billingPeriod.findUniqueOrThrow({
          where: { id: period.id },
          include: { result: true, tariff: true },
        }),
        now,
      ),
    ).toBe(true);
    result = await billing.computePeriod(period.id, now);
    expect(result.policyVersions).toContain(changed.policy.version);
    expect(result.reasons).toContain('TOU_ALLOCATION_ESTIMATED');
    expect(result.isLowerBound).toBe(false);
    expect(result.total?.toFixed(2)).toBe('1.50');
    await createPolicyVersion(
      prisma,
      {
        effectiveFrom: new Date('2026-05-01T00:10:00Z'),
        gridSource: 'METER_NET',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 30,
        note: 'Restore synthetic source choice',
      },
      400,
      now,
    );
    await prisma.energyInterval.update({
      where: { bucketStart: at('2026-05-01', 0) },
      data: { maxGapSecUsed: 45, flags: LedgerFlag.OUTSIDE_RETENTION },
    });
    result = await billing.computePeriod(period.id, now);
    expect(result.reasons).toContain('CALC_PARAMS_PARTIAL_RECOMPUTE');
  });

  it('checks exact 80% and 99.5% coverage boundaries and missing ToU holiday calendar', async () => {
    const rules = {
      ...flat,
      touWindows: [
        {
          code: 'PEAK',
          days: ['MON'],
          start: '14:00',
          end: '22:00',
          excludeHolidays: true,
        },
      ],
    };
    const { row } = await makeTariff(rules);
    await seedDay('2026-06-01', {
      coverage: (i) => (i < 230 ? 300 : i === 230 ? 120 : 0),
    });
    await seedDay('2026-06-02', {
      coverage: (i) => (i < 286 ? 300 : i === 286 ? 168 : 0),
    });
    await seedDay('2026-06-03', {
      coverage: (i) => (i < 230 ? 300 : i === 230 ? 119 : 0),
    });
    expect(
      (
        await prisma.energyInterval.findUniqueOrThrow({
          where: { bucketStart: at('2026-06-01', 231) },
        })
      ).gridCoveredSec,
    ).toBe(0);
    const periods = await Promise.all(
      ['2026-06-01', '2026-06-02', '2026-06-03'].map((date) =>
        tariff.upsertBillingPeriod({
          tariffId: row.id,
          startDate: date,
          endDate: date,
          openingCreditLots: [],
        }),
      ),
    );
    const results = [];
    for (const period of periods)
      results.push(await billing.computePeriod(period.id, now));
    expect(results[0].coverage.toFixed(4)).toBe('0.8000');
    expect(results[0].status).toBe('ESTIMATED');
    expect(results[0].reasons).toContain('HOLIDAY_CALENDAR_MISSING');
    expect(results[1].coverage.toFixed(4)).toBe('0.9950');
    expect(results[1].reasons).not.toContain('COVERAGE_BELOW_99_5');
    expect(results[2].status).toBe('UNAVAILABLE');
    await tariff.setTariffHolidays(row.id, 2026, [
      { date: '2026-01-01', name: 'Synthetic holiday' },
    ]);
    expect(
      await billing.isStale(
        await prisma.billingPeriod.findUniqueOrThrow({
          where: { id: periods[0].id },
          include: { tariff: true, result: true },
        }),
        now,
      ),
    ).toBe(true);
    expect(
      (await billing.computePeriod(periods[0].id, now)).reasons,
    ).not.toContain('HOLIDAY_CALENDAR_MISSING');
  });

  it('chains FIFO NEM lots, propagates corrections, respects anchors and identifies gaps', async () => {
    const { row } = await makeTariff(nemRules);
    const dates = [
      '2026-07-01',
      '2026-07-02',
      '2026-07-03',
      '2026-07-04',
      '2026-07-06',
    ];
    for (const date of dates)
      await seedDay(date, {
        importWh: date === dates[1] ? '30000.000' : '0.000',
        exportWh: date === dates[0] ? '100000.000' : '0.000',
      });
    const periods = [];
    for (const date of dates)
      periods.push(
        await tariff.upsertBillingPeriod({
          tariffId: row.id,
          startDate: date,
          endDate: date,
          ...(date === dates[0] || date === dates[3]
            ? { openingCreditLots: [] }
            : {}),
        }),
      );
    for (const period of periods) await billing.computePeriod(period.id, now);
    expect(
      (
        await prisma.billingPeriodResult.findUniqueOrThrow({
          where: { billingPeriodId: periods[0].id },
        })
      ).nem,
    ).toMatchObject({
      closingLots: [{ originStart: dates[0], kwh: '100.000' }],
    });
    let second = await prisma.billingPeriodResult.findUniqueOrThrow({
      where: { billingPeriodId: periods[1].id },
    });
    expect(second.nem).toMatchObject({
      closingLots: [{ originStart: dates[0], kwh: '70.000' }],
    });
    expect(
      (
        await prisma.billingPeriodResult.findUniqueOrThrow({
          where: { billingPeriodId: periods[4].id },
        })
      ).reasons,
    ).toContain('NEM_CHAIN_GAP');
    const oldThird = await prisma.billingPeriodResult.findUniqueOrThrow({
      where: { billingPeriodId: periods[2].id },
    });
    const oldAnchor = await prisma.billingPeriodResult.findUniqueOrThrow({
      where: { billingPeriodId: periods[3].id },
    });
    await prisma.energyInterval.update({
      where: { bucketStart: at(dates[0], 0) },
      data: {
        gridExportNetWh: '20000.000',
        computedAt: new Date('2027-01-02T00:00:00Z'),
      },
    });
    await billing.computePeriod(
      periods[0].id,
      new Date('2027-01-03T00:00:00Z'),
    );
    second = await prisma.billingPeriodResult.findUniqueOrThrow({
      where: { billingPeriodId: periods[1].id },
    });
    expect(second.nem).toMatchObject({ closingLots: [] });
    const third = await prisma.billingPeriodResult.findUniqueOrThrow({
      where: { billingPeriodId: periods[2].id },
    });
    expect(third.nem).toMatchObject({ closingLots: [] });
    expect(third.computedAt.getTime()).toBeGreaterThan(
      oldThird.computedAt.getTime(),
    );
    const anchored = await prisma.billingPeriodResult.findUniqueOrThrow({
      where: { billingPeriodId: periods[3].id },
    });
    expect(anchored.nem).toMatchObject({ openingLots: [] });
    expect(anchored.computedAt).toEqual(oldAnchor.computedAt);
  });

  it('stops a NEM correction cascade once a downstream closing balance is unchanged', async () => {
    const { row } = await makeTariff(nemRules);
    const dates = ['2026-09-10', '2026-09-11', '2026-09-12'];
    await seedDay(dates[0], { exportWh: '100000.000' });
    await seedDay(dates[1], { importWh: '200000.000' });
    await seedDay(dates[2]);
    const periods = [];
    for (const date of dates)
      periods.push(
        await tariff.upsertBillingPeriod({
          tariffId: row.id,
          startDate: date,
          endDate: date,
          ...(date === dates[0] ? { openingCreditLots: [] } : {}),
        }),
      );
    for (const period of periods) await billing.computePeriod(period.id, now);
    const before = await prisma.billingPeriodResult.findUniqueOrThrow({
      where: { billingPeriodId: periods[2].id },
    });
    await prisma.energyInterval.update({
      where: { bucketStart: at(dates[0], 0) },
      data: {
        gridExportNetWh: '20000.000',
        computedAt: new Date('2027-01-02T00:00:00Z'),
      },
    });
    await billing.computePeriod(
      periods[0].id,
      new Date('2027-01-03T00:00:00Z'),
    );
    expect(
      (
        await prisma.billingPeriodResult.findUniqueOrThrow({
          where: { billingPeriodId: periods[1].id },
        })
      ).nem,
    ).toMatchObject({ closingLots: [] });
    expect(
      (
        await prisma.billingPeriodResult.findUniqueOrThrow({
          where: { billingPeriodId: periods[2].id },
        })
      ).computedAt,
    ).toEqual(before.computedAt);
    await billing.recomputeStale(new Date('2027-01-04T00:00:00Z'));
    expect(
      (
        await prisma.billingPeriodResult.findUniqueOrThrow({
          where: { billingPeriodId: periods[2].id },
        })
      ).computedAt,
    ).toEqual(before.computedAt);
  });

  it('marks only billing periods overlapping an accounting recalculation stale', async () => {
    const first = await prisma.billingPeriod.findFirstOrThrow({
      where: { startDate: new Date('2026-07-01') },
    });
    const second = await prisma.billingPeriod.findFirstOrThrow({
      where: { startDate: new Date('2026-07-02') },
    });
    const env = parseEnv({
      DATABASE_URL: db.url,
      COLLECTOR_ENABLED: 'false',
      SITE_TIMEZONE: 'UTC',
    });
    const mutations = new AccountingMutations(
      prisma,
      env,
      new RawPollRenormalizer(prisma),
      () => now,
    );
    await mutations.requestRecalculation(
      'LEDGER_RECOMPUTE',
      at('2026-07-01', 0),
      at('2026-07-02', 0),
      'Synthetic billing range',
    );
    expect(
      (
        await prisma.billingPeriodResult.findUniqueOrThrow({
          where: { billingPeriodId: first.id },
        })
      ).calcVersion,
    ).toBe(0);
    expect(
      (
        await prisma.billingPeriodResult.findUniqueOrThrow({
          where: { billingPeriodId: second.id },
        })
      ).calcVersion,
    ).toBe(BILLING_CALC_VERSION);
  });

  it('marks pre-monitoring periods and never clips coverage to the monitoring boundary', async () => {
    const { row } = await makeTariff(flat, '2025-12-30');
    const entirely = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2025-12-30',
      endDate: '2025-12-30',
      openingCreditLots: [],
    });
    expect((await billing.computePeriod(entirely.id, now)).reasons).toContain(
      'PERIOD_BEFORE_MONITORING',
    );
    await seedDay('2025-12-31');
    await seedDay('2026-01-01');
    const partial = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2025-12-31',
      endDate: '2026-01-01',
      openingCreditLots: [],
    });
    const result = await billing.computePeriod(partial.id, now);
    expect(result.coverage.toFixed(4)).toBe('1.0000');
    expect(result.status).toBe('ESTIMATED');
    expect(result.reasons).toContain('PRE_MONITORING_DATA_MISSING');
  });

  it('marks missing NEM export as direction-unknown and expires old lots before FIFO', async () => {
    const { row } = await makeTariff(nemRules);
    await seedDay('2026-08-01', { importWh: '3000.000' });
    const expiry = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-08-01',
      endDate: '2026-08-01',
      openingCreditLots: [
        { originStart: '2025-01-01', kwh: '20.000' },
        { originStart: '2026-06-01', kwh: '5.000' },
      ],
    });
    const expired = await billing.computePeriod(expiry.id, now);
    expect(expired.nem).toMatchObject({
      expiredLots: [{ originStart: '2025-01-01', kwh: '20.000' }],
      consumedLots: [{ originStart: '2026-06-01', kwh: '3.000' }],
      closingLots: [{ originStart: '2026-06-01', kwh: '2.000' }],
    });
    await seedDay('2026-08-02', { importWh: '1000.000' });
    await prisma.energyInterval.updateMany({
      where: {
        bucketStart: { gte: at('2026-08-02', 0), lt: at('2026-08-02', 20) },
      },
      data: { gridExportNetWh: null },
    });
    const missing = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-08-02',
      endDate: '2026-08-02',
    });
    const uncertain = await billing.computePeriod(missing.id, now);
    expect(uncertain.status).toBe('ESTIMATED');
    expect(uncertain.isLowerBound).toBe(false);
    expect(uncertain.reasons).toContain('MISSING_DATA_DIRECTION_UNKNOWN');
  });

  it('preserves sub-milli-kWh carried credit exactly across a stored NEM result', async () => {
    const { row } = await makeTariff(nemRules);
    await seedDay('2026-10-01');
    const period = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-10-01',
      endDate: '2026-10-01',
      openingCreditLots: [{ originStart: '2026-09-01', kwh: '0.0000007' }],
    });
    const result = await billing.computePeriod(period.id, now);
    expect(result.nem).toMatchObject({
      openingLots: [{ originStart: '2026-09-01', kwh: '0.0000007' }],
      closingLots: [{ originStart: '2026-09-01', kwh: '0.0000007' }],
    });
  });

  it('invalidates monthly rate changes and refreshes open periods after an hour', async () => {
    const rules = {
      ...flat,
      components: [
        ...flat.components,
        {
          code: 'TEST_MONTHLY',
          label: 'Fake monthly adjustment',
          kind: 'PER_KWH_MONTHLY',
          basis: 'IMPORT',
        },
      ],
    };
    const { row } = await makeTariff(rules);
    await seedDay('2026-09-01', { importWh: '1000.000' });
    const period = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-09-01',
      endDate: '2026-09-01',
      openingCreditLots: [],
    });
    await tariff.setMonthlyRate(
      row.id,
      'TEST_MONTHLY',
      '2026-09',
      '0.120000',
      'Fake test rate',
    );
    let result = await billing.computePeriod(period.id, now);
    expect(result.total?.toFixed(2)).toBe('0.62');
    await tariff.setMonthlyRate(
      row.id,
      'TEST_MONTHLY',
      '2026-09',
      '0.340000',
      'Fake replacement',
    );
    expect(
      await billing.isStale(
        await prisma.billingPeriod.findUniqueOrThrow({
          where: { id: period.id },
          include: { result: true, tariff: true },
        }),
        now,
      ),
    ).toBe(true);
    result = await billing.computePeriod(period.id, now);
    expect(result.total?.toFixed(2)).toBe('0.84');
    await seedDay('2027-01-01');
    const first = new Date('2027-01-01T00:00:00Z');
    await prisma.energyInterval.updateMany({
      where: {
        bucketStart: { gte: first, lt: new Date('2027-01-02T00:00:00Z') },
      },
      data: { computedAt: first },
    });
    const open = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2027-01-01',
      endDate: '2027-01-01',
      openingCreditLots: [],
    });
    await billing.computePeriod(open.id, first);
    expect(
      await billing.isStale(
        await prisma.billingPeriod.findUniqueOrThrow({
          where: { id: open.id },
          include: { result: true, tariff: true },
        }),
        new Date('2027-01-01T00:30:00Z'),
      ),
    ).toBe(false);
    expect(
      await billing.isStale(
        await prisma.billingPeriod.findUniqueOrThrow({
          where: { id: open.id },
          include: { result: true, tariff: true },
        }),
        new Date('2027-01-01T01:00:01Z'),
      ),
    ).toBe(true);
    expect(
      await billing.isStale(
        await prisma.billingPeriod.findUniqueOrThrow({
          where: { id: open.id },
          include: { result: true, tariff: true },
        }),
        new Date('2027-01-02T00:00:00Z'),
      ),
    ).toBe(true);
    expect(
      (await billing.computePeriod(open.id, new Date('2027-01-02T00:00:00Z')))
        .reasons,
    ).not.toContain('PERIOD_IN_PROGRESS');
  });
  it('ignores TOU uncertainty from unused PV and counter grid sources', async () => {
    const { row } = await makeTariff();
    await seedDay('2026-02-10');
    await prisma.energyInterval.update({
      where: { bucketStart: at('2026-02-10', 0) },
      data: { counterGapAllocMask: 1, flags: LedgerFlag.TOU_UNCERTAIN },
    });
    const period = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-02-10',
      endDate: '2026-02-10',
      openingCreditLots: [],
    });
    let result = await billing.computePeriod(period.id, now);
    expect(result.reasons).not.toContain('TOU_ALLOCATION_ESTIMATED');
    await createPolicyVersion(
      prisma,
      {
        effectiveFrom: at('2026-02-10', 0),
        gridSource: 'INVERTER_COUNTER',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 30,
        note: 'Counter source without grid gap',
      },
      400,
      now,
    );
    result = await billing.computePeriod(period.id, now);
    expect(result.reasons).not.toContain('TOU_ALLOCATION_ESTIMATED');
    await createPolicyVersion(
      prisma,
      {
        effectiveFrom: at('2026-02-11', 0),
        gridSource: 'METER_NET',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 30,
        note: 'Restore net source',
      },
      400,
      now,
    );
  });

  it('measures whole-period ledger coverage even when half the tariff dates have no version', async () => {
    const { row } = await makeTariff(flat, '2026-02-21');
    await seedDay('2026-02-20');
    await seedDay('2026-02-21');
    const period = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-02-20',
      endDate: '2026-02-21',
      openingCreditLots: [],
    });
    const result = await billing.computePeriod(period.id, now);
    expect(result.reasons).toContain('NO_TARIFF_VERSION');
    expect(result.coverage.toFixed(4)).toBe('1.0000');
  });

  it('sees a stale grandparent and refuses to reuse an unrefreshed NEM predecessor', async () => {
    const { row } = await makeTariff(nemRules);
    const dates = ['2026-03-10', '2026-03-11', '2026-03-12'];
    for (const date of dates)
      await seedDay(date, {
        importWh: date === dates[0] ? '0.000' : '1000.000',
      });
    const periods = [];
    for (const date of dates)
      periods.push(
        await tariff.upsertBillingPeriod({
          tariffId: row.id,
          startDate: date,
          endDate: date,
          ...(date === dates[0]
            ? { openingCreditLots: [{ originStart: date, kwh: '10.000' }] }
            : {}),
        }),
      );
    for (const period of periods) await billing.computePeriod(period.id, now);
    await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: dates[0],
      endDate: dates[0],
      openingCreditLots: [{ originStart: dates[0], kwh: '20.000' }],
    });
    expect(
      await billing.isStale(
        await prisma.billingPeriod.findUniqueOrThrow({
          where: { id: periods[2].id },
          include: { result: true, tariff: true },
        }),
        now,
      ),
    ).toBe(true);
    const outOfOrder = await billing.computePeriod(periods[2].id, now, false);
    expect(outOfOrder.reasons).toContain('NEM_CHAIN_GAP');
    await billing.computePeriod(periods[0].id, now);
    const refreshed = await prisma.billingPeriodResult.findUniqueOrThrow({
      where: { billingPeriodId: periods[2].id },
    });
    expect(refreshed.nem).toMatchObject({
      closingLots: [{ originStart: dates[0], kwh: '18.000' }],
    });
    await prisma.energyInterval.update({
      where: { bucketStart: at(dates[0], 0) },
      data: {
        gridExportNetWh: '1000.000',
        computedAt: new Date('2027-01-02T00:00:00Z'),
      },
    });
    const later = new Date('2027-01-03T00:00:00Z');
    expect(
      await billing.isStale(
        await prisma.billingPeriod.findUniqueOrThrow({
          where: { id: periods[2].id },
          include: { result: true, tariff: true },
        }),
        later,
      ),
    ).toBe(true);
    expect(
      (await billing.computePeriod(periods[1].id, later, false)).reasons,
    ).toContain('NEM_CHAIN_GAP');
  });

  it('does not mistake disabled acquisition for vendor-only data', async () => {
    const { row } = await makeTariff();
    const period = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-04-20',
      endDate: '2026-04-20',
      openingCreditLots: [],
    });
    const disabled = new BillingService(
      prisma,
      parseEnv({
        DATABASE_URL: db.url,
        COLLECTOR_ENABLED: 'false',
        COLLECTOR_SOURCE: 'NONE',
        SITE_TIMEZONE: 'UTC',
      }),
      new ReconciliationService(prisma),
    );
    const result = await disabled.computePeriod(period.id, now);
    expect(result.reasons).not.toContain('VENDOR_DATA_ONLY');
  });
  it('completes ten simultaneous bills on the ten-connection pool without starving the lock owner', async () => {
    const { row } = await makeTariff();
    const period = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-04-21',
      endDate: '2026-04-21',
      openingCreditLots: [],
    });
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        billing.computePeriod(period.id, now, false),
      ),
    );
    expect(results).toHaveLength(10);
    expect(
      results.every((result) => result.billingPeriodId === period.id),
    ).toBe(true);
    expect(prisma.pool.options.max).toBe(10);
  }, 20_000);
  it('does not publish a bill computed before a concurrent monthly-rate invalidation', async () => {
    const rules = {
      ...flat,
      components: [
        ...flat.components,
        {
          code: 'TEST_MONTHLY',
          label: 'Fake monthly adjustment',
          kind: 'PER_KWH_MONTHLY',
          basis: 'IMPORT',
        },
      ],
    };
    const { row } = await makeTariff(rules);
    await tariff.setMonthlyRate(
      row.id,
      'TEST_MONTHLY',
      '2026-04',
      '0.100000',
      'Fake first rate',
    );
    await seedDay('2026-04-25', { importWh: '1000.000' });
    const period = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-04-25',
      endDate: '2026-04-25',
      openingCreditLots: [],
    });
    const reconciliation = new ReconciliationService(prisma);
    const original = reconciliation.accountingStatus.bind(reconciliation);
    let entered!: () => void, release!: () => void;
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const spy = vi
      .spyOn(reconciliation, 'accountingStatus')
      .mockImplementation(async (source) => {
        entered();
        await gate;
        return original(source);
      });
    try {
      const pending = new BillingService(
        prisma,
        parseEnv({
          DATABASE_URL: db.url,
          COLLECTOR_ENABLED: 'false',
          SITE_TIMEZONE: 'UTC',
        }),
        reconciliation,
      ).computePeriod(period.id, now, false);
      await reached;
      const mutation = tariff.setMonthlyRate(
        row.id,
        'TEST_MONTHLY',
        '2026-04',
        '0.200000',
        'Fake replacement',
      );
      await Promise.race([
        mutation,
        new Promise((resolve) => setTimeout(resolve, 1000)),
      ]);
      release();
      await Promise.all([pending, mutation]);
    } finally {
      release();
      spy.mockRestore();
    }
    const stored = await prisma.billingPeriod.findUniqueOrThrow({
      where: { id: period.id },
      include: { result: true, tariff: true },
    });
    expect(stored.result?.calcVersion).toBe(0);
    expect(await billing.isStale(stored, now)).toBe(true);
    expect(
      (await billing.computePeriod(period.id, now, false)).total?.toFixed(2),
    ).toBe('0.70');
  });
  it('uses each Kuala Lumpur tariff version own ToU window at the split boundary', async () => {
    const base = { ...flat, timezone: 'Asia/Kuala_Lumpur' };
    const one = {
      ...base,
      touWindows: [
        {
          code: 'FIRST_PEAK',
          days: ['MON'],
          start: '00:00',
          end: '12:00',
          excludeHolidays: false,
        },
      ],
    };
    const two = {
      ...base,
      touWindows: [
        {
          code: 'SECOND_PEAK',
          days: ['TUE'],
          start: '00:00',
          end: '12:00',
          excludeHolidays: false,
        },
      ],
    };
    const site = await tariff.createTariff({
      name: 'Fake ToU boundary',
      currency: 'MYR',
      timezone: 'Asia/Kuala_Lumpur',
    });
    const first = await tariff.createTariffVersion(
      site.id,
      '2026-02-23',
      '2026-02-23',
      JSON.stringify(one),
      'Fake Monday',
    );
    const second = await tariff.createTariffVersion(
      site.id,
      '2026-02-24',
      null,
      JSON.stringify(two),
      'Fake Tuesday',
    );
    await prisma.energyInterval.createMany({
      data: ['2026-02-22T16:00:00Z', '2026-02-23T16:00:00Z'].map((value) => ({
        bucketStart: new Date(value),
        computedAt: new Date(value),
        calcVersion: LEDGER_ALGO_VERSION,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        gridImportNetWh: '1000.000',
        gridExportNetWh: '0.000',
        gridCoveredSec: 300,
        pvCoveredSec: 300,
        batCoveredSec: 300,
        loadCoveredSec: 300,
        counterUnknownSec: [0, 0, 0, 0, 0, 0],
        counterGapAllocMask: 0,
        flags: 0,
      })),
    });
    const period = await tariff.upsertBillingPeriod({
      tariffId: site.id,
      startDate: '2026-02-23',
      endDate: '2026-02-24',
      openingCreditLots: [],
    });
    const result = await billing.computePeriod(period.id, now);
    const quantities = z
      .array(
        z.object({
          versionId: z.number(),
          windows: z.array(
            z.object({
              window: z.string(),
              importKwh: z.string(),
            }),
          ),
        }),
      )
      .parse(result.quantities);
    expect(quantities.map((q) => [q.versionId, q.windows])).toEqual([
      [first.id, [{ window: 'FIRST_PEAK', importKwh: '1.000' }]],
      [second.id, [{ window: 'SECOND_PEAK', importKwh: '1.000' }]],
    ]);
  });

  it('uses the actual 23-hour daylight-saving local day for coverage', async () => {
    const site = await tariff.createTariff({
      name: 'Fake DST coverage',
      currency: 'MYR',
      timezone: 'America/New_York',
    });
    await tariff.createTariffVersion(
      site.id,
      '2026-03-08',
      null,
      JSON.stringify({ ...flat, timezone: 'America/New_York' }),
      'Fake DST',
    );
    const start = new Date('2026-03-08T05:00:00Z').getTime();
    await prisma.energyInterval.createMany({
      data: Array.from({ length: 276 }, (_, index) => ({
        bucketStart: new Date(start + index * 300_000),
        computedAt: new Date(start + index * 300_000),
        calcVersion: LEDGER_ALGO_VERSION,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        gridImportNetWh: '0.000',
        gridExportNetWh: '0.000',
        gridCoveredSec: 300,
        pvCoveredSec: 300,
        batCoveredSec: 300,
        loadCoveredSec: 300,
        counterUnknownSec: [0, 0, 0, 0, 0, 0],
        counterGapAllocMask: 0,
        flags: 0,
      })),
    });
    const period = await tariff.upsertBillingPeriod({
      tariffId: site.id,
      startDate: '2026-03-08',
      endDate: '2026-03-08',
      openingCreditLots: [],
    });
    expect(
      (await billing.computePeriod(period.id, now)).coverage.toFixed(4),
    ).toBe('1.0000');
  });
  it('cascades one thousand NEM periods and serves a 100-row page with fewer than fifty SQL queries', async () => {
    const { row } = await makeTariff(nemRules, '2028-01-01');
    const start = new Date('2028-01-01T00:00:00Z').getTime();
    const dates = Array.from(
      { length: 1000 },
      (_, index) => new Date(start + index * 86_400_000),
    );
    await prisma.billingPeriod.createMany({
      data: dates.map((date, index) => ({
        tariffId: row.id,
        startDate: date,
        endDate: date,
        ...(index === 0 ? { openingCreditLots: [] } : {}),
      })),
    });
    for (let first = 0; first < dates.length; first += 10) {
      const data = [];
      for (
        let dayIndex = first;
        dayIndex < Math.min(first + 10, dates.length);
        dayIndex++
      )
        for (let bucket = 0; bucket < 288; bucket++)
          data.push({
            bucketStart: new Date(
              dates[dayIndex]!.getTime() + bucket * 300_000,
            ),
            computedAt: dates[dayIndex]!,
            calcVersion: LEDGER_ALGO_VERSION,
            maxGapSecUsed: 30,
            mappingVersion: 1,
            gridImportNetWh: '0.000',
            gridExportNetWh: bucket === 0 ? '1000.000' : '0.000',
            gridCoveredSec: 300,
            pvCoveredSec: 300,
            batCoveredSec: 300,
            loadCoveredSec: 300,
            counterUnknownSec: [0, 0, 0, 0, 0, 0],
            counterGapAllocMask: 0,
            flags: 0,
          });
      await prisma.energyInterval.createMany({ data });
    }
    const first = await prisma.billingPeriod.findFirstOrThrow({
      where: { tariffId: row.id },
      orderBy: { startDate: 'asc' },
    });
    await billing.computePeriod(first.id, new Date('2032-01-01T00:00:00Z'));
    expect(
      await prisma.billingPeriodResult.count({
        where: { period: { tariffId: row.id } },
      }),
    ).toBe(1000);
    const last = await prisma.billingPeriod.findFirstOrThrow({
      where: { tariffId: row.id },
      orderBy: { startDate: 'desc' },
      include: { result: true },
    });
    const closing = z
      .object({
        closingLots: z.array(
          z.object({ originStart: z.string(), kwh: z.string() }),
        ),
      })
      .parse(last.result?.nem).closingLots;
    expect(closing.length).toBeGreaterThan(0);
    expect(closing.length).toBeLessThan(400);
    expect(closing.at(-1)?.originStart).toBe(
      last.startDate.toISOString().slice(0, 10),
    );
    const boundary = await prisma.billingPeriod.findFirstOrThrow({
      where: { tariffId: row.id },
      orderBy: { startDate: 'asc' },
      skip: 899,
      select: { id: true },
    });
    let queries = 0;
    const clients = new WeakSet<pg.PoolClient>();
    const spies: Array<{ mockRestore: () => void }> = [];
    const onAcquire = (client: pg.PoolClient) => {
      if (clients.has(client)) return;
      clients.add(client);
      const original = client.query.bind(client);
      spies.push(
        vi.spyOn(client, 'query').mockImplementation((...args) => {
          if (++queries >= 50)
            throw new Error('Billing page exceeded SQL query bound');
          return Reflect.apply(original, client, args);
        }),
      );
    };
    prisma.pool.on('acquire', onAcquire);
    try {
      const resolver = new TariffResolver(prisma, tariff, billing);
      const page = await resolver.billingPeriods(
        100,
        Buffer.from(String(boundary.id)).toString('base64'),
        {},
      );
      expect(page.edges).toHaveLength(100);
      expect(queries).toBeGreaterThan(0);
      expect(queries).toBeLessThan(50);
    } finally {
      prisma.pool.off('acquire', onAcquire);
      for (const spy of spies) spy.mockRestore();
    }
  }, 180_000);
});
