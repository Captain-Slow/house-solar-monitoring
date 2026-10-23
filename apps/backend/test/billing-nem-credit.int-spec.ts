import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { BillingService } from '../src/tariff/billing.service.js';
import { TariffService } from '../src/tariff/tariff.service.js';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import {
  at,
  flatRules,
  nemRules,
  seedAccountingBasics,
  seedDay,
  seedReconciledDay,
} from './support/billing.js';

const now = new Date('2027-01-01T00:00:00Z');
const touRules = {
  ...nemRules,
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
// 259 of 288 buckets covered = 89.93 %: above the 80 % availability floor, below 99.5 %.
const ninetyPercent = (bucket: number) => (bucket < 259 ? 300 : 0);

describe('NEM credit uncertainty across chained billing periods', () => {
  let db: TestDatabase,
    prisma: PrismaService,
    tariff: TariffService,
    billing: BillingService;
  beforeAll(async () => {
    db = await createTestDatabase();
    prisma = new PrismaService({ DATABASE_URL: db.url });
    tariff = new TariffService(prisma);
    billing = new BillingService(
      prisma,
      parseEnv({
        DATABASE_URL: db.url,
        COLLECTOR_ENABLED: 'false',
        SITE_TIMEZONE: 'UTC',
      }),
      new ReconciliationService(prisma),
    );
    await seedAccountingBasics(prisma);
    // Reconciled accounting is global; with it (and verified fake rates) a period can be COMPLETE.
    await seedReconciledDay(prisma, '2026-02-10');
  });
  afterAll(async () => {
    await prisma?.close();
    await db?.drop();
  });

  async function verifiedTariff(rules: object = nemRules, from = '2026-03-01') {
    const row = await tariff.createTariff({
      name: 'Synthetic NEM chain',
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
    await prisma.tariffVersion.update({
      where: { id: version.id },
      data: { billVerified: true },
    });
    return row;
  }
  const periodFor = (tariffId: number, date: string, anchored = false) =>
    tariff.upsertBillingPeriod({
      tariffId,
      startDate: date,
      endDate: date,
      ...(anchored ? { openingCreditLots: [] } : {}),
    });
  const view = async (billingPeriodId: number) => {
    const result = await prisma.billingPeriodResult.findUniqueOrThrow({
      where: { billingPeriodId },
    });
    return {
      status: result.status,
      reasons: result.reasons,
      nem: result.nem as {
        openingLots: { originStart: string; kwh: string }[];
        closingLots: { originStart: string; kwh: string }[];
      } | null,
    };
  };
  const stale = async (billingPeriodId: number, when = now) =>
    billing.isStale(
      await prisma.billingPeriod.findUniqueOrThrow({
        where: { id: billingPeriodId },
        include: { result: true, tariff: true },
      }),
      when,
    );
  async function freshnessOf(tariffId: number, periodId: number, when: Date) {
    const entry = (await billing.freshnessForTariff(tariffId, when)).get(
      periodId,
    );
    if (!entry) throw new Error('Missing freshness entry');
    return entry;
  }
  /** Export 100 kWh on the first day, then fixed imports; only the first day has 90 % coverage. */
  async function seedChain(dates: string[]): Promise<void> {
    const imports = ['0.000', '30000.000', '10000.000', '5000.000', '5000.000'];
    for (const [index, date] of dates.entries())
      await seedDay(prisma, date, {
        importWh: imports[index],
        exportWh: index === 0 ? '100000.000' : '0.000',
        coverage: index === 0 ? ninetyPercent : undefined,
      });
  }

  it('carries an estimated opening credit through B and C until an independent anchor resets it', async () => {
    const row = await verifiedTariff();
    const dates = [
      '2026-03-01',
      '2026-03-02',
      '2026-03-03',
      '2026-03-04',
      '2026-03-05',
    ];
    await seedChain(dates);
    const periods: { id: number }[] = [];
    for (const [index, date] of dates.entries())
      periods.push(await periodFor(row.id, date, index === 0 || index === 3));
    for (const period of periods)
      await billing.computePeriod(period.id, now, false);

    const a = await view(periods[0]!.id);
    expect(a.status).toBe('ESTIMATED');
    expect(a.reasons).toEqual([
      'COVERAGE_BELOW_99_5',
      'MISSING_DATA_DIRECTION_UNKNOWN',
    ]);
    expect(a.nem?.closingLots).toEqual([
      { originStart: dates[0], kwh: '100.000' },
    ]);
    // B has full coverage and every other gate satisfied, but consumes A's uncertain bank.
    const b = await view(periods[1]!.id);
    expect(b.nem?.openingLots).toEqual(a.nem?.closingLots);
    expect(b.nem?.closingLots).toEqual([
      { originStart: dates[0], kwh: '70.000' },
    ]);
    expect(b.status).toBe('ESTIMATED');
    expect(b.reasons).toEqual(['NEM_OPENING_CREDIT_ESTIMATED']);
    // The uncertainty is inherited again by C, whose own data and gates are also perfect.
    const c = await view(periods[2]!.id);
    expect(c.nem?.closingLots).toEqual([
      { originStart: dates[0], kwh: '60.000' },
    ]);
    expect(c.status).toBe('ESTIMATED');
    expect(c.reasons).toEqual(['NEM_OPENING_CREDIT_ESTIMATED']);
    // D carries an explicit bill anchor: the chain stops there, and so does E's inheritance.
    expect(await view(periods[3]!.id)).toMatchObject({
      status: 'COMPLETE',
      reasons: [],
    });
    expect(await view(periods[4]!.id)).toMatchObject({
      status: 'COMPLETE',
      reasons: [],
    });
    for (const period of periods) expect(await stale(period.id)).toBe(false);
  });

  it('clears inherited uncertainty down the chain once upstream data is repaired, even when the lots are identical', async () => {
    const row = await verifiedTariff();
    const dates = ['2026-03-11', '2026-03-12', '2026-03-13', '2026-03-14'];
    await seedChain(dates);
    const periods: { id: number }[] = [];
    for (const [index, date] of dates.entries())
      periods.push(await periodFor(row.id, date, index === 0 || index === 3));
    await billing.computePeriod(periods[0]!.id, now);
    expect((await view(periods[2]!.id)).reasons).toEqual([
      'NEM_OPENING_CREDIT_ESTIMATED',
    ]);

    // Backfill the missing grid coverage of A only: its export Wh and closing lots do not change.
    const repairedAt = new Date('2027-01-02T00:00:00Z');
    await prisma.energyInterval.updateMany({
      where: {
        bucketStart: { gte: at(dates[0]!, 0), lt: at(dates[1]!, 0) },
      },
      data: { gridCoveredSec: 300, computedAt: repairedAt },
    });
    const later = new Date('2027-01-03T00:00:00Z');
    const before = await view(periods[0]!.id);
    await billing.computePeriod(periods[0]!.id, later);
    const a = await view(periods[0]!.id);
    expect(a.nem?.closingLots).toEqual(before.nem?.closingLots);
    expect(a).toMatchObject({ status: 'COMPLETE', reasons: [] });
    // The correction cascades through B and C although no lot changed.
    expect(await view(periods[1]!.id)).toMatchObject({
      status: 'COMPLETE',
      reasons: [],
    });
    expect(await view(periods[2]!.id)).toMatchObject({
      status: 'COMPLETE',
      reasons: [],
    });
    for (const period of periods.slice(0, 3))
      expect(await stale(period.id, later)).toBe(false);
  });

  it('flags a chained successor stale when only its predecessor credit quality changed', async () => {
    const row = await verifiedTariff();
    const dates = ['2026-03-15', '2026-03-16', '2026-03-17'];
    await seedChain(dates);
    const periods: { id: number }[] = [];
    for (const [index, date] of dates.entries())
      periods.push(await periodFor(row.id, date, index === 0));
    await billing.computePeriod(periods[0]!.id, now);
    for (const period of periods)
      expect((await freshnessOf(row.id, period.id, now)).stale).toBe(false);

    await prisma.energyInterval.updateMany({
      where: {
        bucketStart: { gte: at(dates[0]!, 0), lt: at(dates[1]!, 0) },
      },
      data: {
        gridCoveredSec: 300,
        computedAt: new Date('2027-01-02T00:00:00Z'),
      },
    });
    const later = new Date('2027-01-03T00:00:00Z');
    // Recompute only A: B and C keep their old, now outdated, ESTIMATED results.
    await billing.computePeriod(periods[0]!.id, later, false);
    for (const period of periods.slice(1)) {
      expect(await stale(period.id, later)).toBe(true);
      expect((await freshnessOf(row.id, period.id, later)).stale).toBe(true);
    }
    await billing.recomputeStale(later);
    for (const period of periods)
      expect(await view(period.id)).toMatchObject({
        status: 'COMPLETE',
        reasons: [],
      });
  });

  it.each(
    ['equal', 'earlier', 'later'].flatMap((timing, i) =>
      ['repair', 'deterioration', 'lots'].map((change, j) => ({
        timing,
        change,
        offset: (i * 3 + j) * 4,
      })),
    ),
  )(
    'detects consumed bank changes with $timing timestamps ($change) and converges',
    async ({ timing, change, offset }) => {
      const dates = Array.from({ length: 4 }, (_, i) =>
        at('2026-07-01', (offset + i) * 288)
          .toISOString()
          .slice(0, 10),
      );
      const row = await verifiedTariff(nemRules, dates[0]!);
      for (const [index, date] of dates.entries())
        await seedDay(prisma, date, {
          importWh: ['0.000', '30000.000', '10000.000', '5000.000'][index],
          exportWh: index === 0 ? '100000.000' : '0.000',
          coverage:
            index === 0 && change === 'repair' ? ninetyPercent : undefined,
        });
      const periods = [];
      for (const [index, date] of dates.entries())
        periods.push(await periodFor(row.id, date, index === 0 || index === 3));
      await billing.computePeriod(periods[0]!.id, now);
      await billing.computePeriod(periods[3]!.id, now);
      const before = await view(periods[0]!.id);
      const revisedAt = new Date(
        timing === 'earlier'
          ? '2026-12-31T00:00:00Z'
          : timing === 'later'
            ? '2027-01-02T00:00:00Z'
            : now,
      );
      const observedAt = revisedAt > now ? revisedAt : now;
      await prisma.energyInterval.updateMany({
        where: { bucketStart: { gte: at(dates[0]!, 0), lt: at(dates[1]!, 0) } },
        data: { gridCoveredSec: 300, computedAt: revisedAt },
      });
      if (change === 'deterioration')
        await prisma.energyInterval.updateMany({
          where: {
            bucketStart: { gte: at(dates[0]!, 259), lt: at(dates[1]!, 0) },
          },
          data: { gridCoveredSec: 0 },
        });
      if (change === 'lots')
        await prisma.energyInterval.update({
          where: { bucketStart: at(dates[0]!, 0) },
          data: { gridExportNetWh: '120000.000' },
        });
      await billing.computePeriod(periods[0]!.id, revisedAt, false);
      const revised = await view(periods[0]!.id);
      if (change !== 'lots')
        expect(revised.nem?.closingLots).toEqual(before.nem?.closingLots);
      else
        expect(revised.nem?.closingLots).toEqual([
          { originStart: dates[0], kwh: '120.000' },
        ]);
      const snapshot = await billing.freshnessForTariff(row.id, observedAt);
      for (const [index, period] of periods.entries()) {
        const expected = index === 1 || index === 2;
        expect(await stale(period.id, observedAt)).toBe(expected);
        expect(snapshot.get(period.id)?.stale).toBe(expected);
      }
      expect(await billing.recomputeStale(observedAt)).toBeGreaterThan(0);
      for (const [index, period] of periods.entries()) {
        expect(await stale(period.id, observedAt)).toBe(false);
        expect((await freshnessOf(row.id, period.id, observedAt)).stale).toBe(
          false,
        );
        if (index === 1 || index === 2)
          expect((await view(period.id)).reasons).toEqual(
            change === 'deterioration' ? ['NEM_OPENING_CREDIT_ESTIMATED'] : [],
          );
      }
      expect((await view(periods[2]!.id)).nem?.closingLots).toEqual([
        { originStart: dates[0], kwh: change === 'lots' ? '80.000' : '60.000' },
      ]);
      expect(await billing.recomputeStale(observedAt)).toBe(0);
    },
  );

  it.each([
    'unknown',
    'nem-flat',
    'flat-nem',
    'unavailable-nem',
    'nem-unavailable',
  ])(
    'keeps the $0 boundary fresh without repeated worker recomputations',
    async (boundary) => {
      const index = [
        'unknown',
        'nem-flat',
        'flat-nem',
        'unavailable-nem',
        'nem-unavailable',
      ].indexOf(boundary);
      const dates = Array.from({ length: 3 }, (_, i) =>
        at('2026-09-01', (index * 3 + i) * 288)
          .toISOString()
          .slice(0, 10),
      );
      const row = await verifiedTariff(
        boundary === 'flat-nem' ? flatRules : nemRules,
        dates[0]!,
      );
      if (boundary === 'nem-flat' || boundary === 'flat-nem') {
        await prisma.tariffVersion.updateMany({
          where: { tariffId: row.id },
          data: { effectiveTo: new Date(`${dates[0]}T00:00:00Z`) },
        });
        const version = await tariff.createTariffVersion(
          row.id,
          dates[1]!,
          null,
          JSON.stringify(boundary === 'nem-flat' ? flatRules : nemRules),
          'Synthetic boundary',
        );
        await prisma.tariffVersion.update({
          where: { id: version.id },
          data: { billVerified: true },
        });
      }
      for (const [i, date] of dates.entries())
        if (
          !(boundary === 'unavailable-nem' && i === 0) &&
          !(boundary === 'nem-unavailable' && i === 1)
        )
          await seedDay(prisma, date, {
            importWh: i === 0 ? '0.000' : '30000.000',
            exportWh:
              i === 0 || boundary === 'unknown' ? '100000.000' : '0.000',
          });
      const periods = [];
      for (const [i, date] of dates.entries())
        periods.push(
          await periodFor(row.id, date, i === 0 && boundary !== 'unknown'),
        );
      for (const period of periods)
        await billing.computePeriod(period.id, now, false);
      if (boundary === 'unknown') {
        expect((await view(periods[0]!.id)).nem?.closingLots).not.toEqual([]);
        expect((await view(periods[1]!.id)).nem?.openingLots).toEqual([]);
        expect((await view(periods[1]!.id)).reasons).toContain('NEM_CHAIN_GAP');
      }
      if (boundary === 'flat-nem' || boundary === 'unavailable-nem')
        expect((await view(periods[1]!.id)).reasons).toContain('NEM_CHAIN_GAP');
      const later = new Date('2027-01-03T00:00:00Z');
      await billing.computePeriod(periods[0]!.id, later, false);
      const snapshot = await billing.freshnessForTariff(row.id, later);
      for (const period of periods) {
        expect(await stale(period.id, later)).toBe(false);
        expect(snapshot.get(period.id)?.stale).toBe(false);
      }
      expect(await billing.recomputeStale(later)).toBe(0);
      expect(await billing.recomputeStale(later)).toBe(0);
    },
  );

  it('repairs an unknown bank after an anchor is supplied, without a newer computation time', async () => {
    const dates = ['2026-09-20', '2026-09-21', '2026-09-22'];
    const row = await verifiedTariff(nemRules, dates[0]!);
    const periods = [];
    for (const [i, date] of dates.entries()) {
      await seedDay(prisma, date, {
        importWh: i === 0 ? '0.000' : '30000.000',
        exportWh: i === 0 ? '100000.000' : '0.000',
      });
      periods.push(await periodFor(row.id, date));
    }
    await billing.computePeriod(periods[0]!.id, now);
    expect((await view(periods[2]!.id)).reasons).toContain('NEM_CHAIN_GAP');
    await prisma.billingPeriod.update({
      where: { id: periods[0]!.id },
      data: { openingCreditLots: [] },
    });
    await billing.computePeriod(
      periods[0]!.id,
      new Date('2026-12-31T00:00:00Z'),
      false,
    );
    const snapshot = await billing.freshnessForTariff(row.id, now);
    for (const period of periods.slice(1)) {
      expect(await stale(period.id)).toBe(true);
      expect(snapshot.get(period.id)?.stale).toBe(true);
    }
    expect(await billing.recomputeStale(now)).toBeGreaterThan(0);
    for (const period of periods)
      expect(await view(period.id)).toMatchObject({
        status: 'COMPLETE',
        reasons: [],
      });
    expect(await billing.recomputeStale(now)).toBe(0);
  });

  it('does not propagate estimate reasons that cannot change the credit balance', async () => {
    const row = await tariff.createTariff({
      name: 'Synthetic NEM two versions',
      currency: 'MYR',
      timezone: 'UTC',
    });
    // Version one is unverified and needs a holiday calendar it does not have; version two is clean.
    await tariff.createTariffVersion(
      row.id,
      '2026-04-01',
      '2026-04-01',
      JSON.stringify(touRules),
      'Fake unverified ToU version',
    );
    const second = await tariff.createTariffVersion(
      row.id,
      '2026-04-02',
      null,
      JSON.stringify(nemRules),
      'Fake verified version',
    );
    await prisma.tariffVersion.update({
      where: { id: second.id },
      data: { billVerified: true },
    });
    await seedDay(prisma, '2026-04-01', { exportWh: '100000.000' });
    await seedDay(prisma, '2026-04-02', { importWh: '30000.000' });
    const a = await periodFor(row.id, '2026-04-01', true);
    const b = await periodFor(row.id, '2026-04-02');
    await billing.computePeriod(a.id, now);

    expect((await view(a.id)).status).toBe('ESTIMATED');
    expect((await view(a.id)).reasons).toEqual(
      expect.arrayContaining([
        'HOLIDAY_CALENDAR_MISSING',
        'TARIFF_NOT_BILL_VERIFIED',
      ]),
    );
    const successor = await view(b.id);
    expect(successor.nem?.openingLots).toEqual([
      { originStart: '2026-04-01', kwh: '100.000' },
    ]);
    expect(successor.nem?.closingLots).toEqual([
      { originStart: '2026-04-01', kwh: '70.000' },
    ]);
    expect(successor).toMatchObject({ status: 'COMPLETE', reasons: [] });
    expect(await stale(b.id)).toBe(false);
    // Removing pricing-only doubt changes A's result, not the opening bank B consumed.
    await prisma.tariffVersion.updateMany({
      where: { tariffId: row.id },
      data: { billVerified: true },
    });
    await billing.computePeriod(a.id, new Date('2026-12-31T00:00:00Z'), false);
    expect(await stale(b.id)).toBe(false);
    expect((await freshnessOf(row.id, b.id, now)).stale).toBe(false);
    expect(await billing.recomputeStale(now)).toBe(0);
  });

  it('inherits uncertainty that starts in a middle period and leaves earlier periods unaffected', async () => {
    const row = await verifiedTariff(nemRules, '2026-06-01');
    await seedDay(prisma, '2026-06-01', { exportWh: '100000.000' });
    await seedDay(prisma, '2026-06-02', {
      importWh: '30000.000',
      coverage: ninetyPercent,
    });
    await seedDay(prisma, '2026-06-03', { importWh: '10000.000' });
    const periods = [
      await periodFor(row.id, '2026-06-01', true),
      await periodFor(row.id, '2026-06-02'),
      await periodFor(row.id, '2026-06-03'),
    ];
    await billing.computePeriod(periods[0]!.id, now);
    expect(await view(periods[0]!.id)).toMatchObject({
      status: 'COMPLETE',
      reasons: [],
    });
    // B's own data is incomplete, so what it leaves behind is an estimate.
    expect((await view(periods[1]!.id)).reasons).toEqual([
      'COVERAGE_BELOW_99_5',
      'MISSING_DATA_DIRECTION_UNKNOWN',
    ]);
    expect(await view(periods[2]!.id)).toMatchObject({
      status: 'ESTIMATED',
      reasons: ['NEM_OPENING_CREDIT_ESTIMATED'],
      nem: { closingLots: [{ originStart: '2026-06-01', kwh: '60.000' }] },
    });
  });

  it('does not taint a successor without a NEM rule', async () => {
    const row = await verifiedTariff(flatRules, '2026-05-01');
    await seedDay(prisma, '2026-05-01', {
      importWh: '10000.000',
      coverage: ninetyPercent,
    });
    await seedDay(prisma, '2026-05-02', { importWh: '10000.000' });
    const first = await periodFor(row.id, '2026-05-01', true);
    const second = await periodFor(row.id, '2026-05-02');
    await billing.computePeriod(first.id, now, false);
    await billing.computePeriod(second.id, now, false);
    // No NEM rule: no credit exists, so credit uncertainty cannot taint the bill.
    expect(await view(second.id)).toMatchObject({
      status: 'COMPLETE',
      reasons: [],
    });
  });
});
