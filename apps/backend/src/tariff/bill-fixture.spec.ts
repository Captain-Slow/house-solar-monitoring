import { readFileSync } from 'node:fs';
import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { BillFixtureSchema, reproduceBill } from './bill-fixture.js';
import { parseRules } from './rules.schema.js';

const rules = parseRules({
  currency: 'MYR',
  timezone: 'Asia/Kuala_Lumpur',
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
      code: 'TEST_ENERGY',
      label: 'Synthetic energy',
      kind: 'PER_KWH',
      basis: 'IMPORT',
      tierMode: 'INCREMENTAL',
      rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '0.50' }] }],
    },
  ],
  totalRounding: 'NONE',
});
const fixtures = new URL(
  '../../test/fixtures/bills/synthetic/',
  import.meta.url,
);

describe('redacted bill reproduction', () => {
  it('matches a fully synthetic printed bill', () => {
    const bill = BillFixtureSchema.parse(
      JSON.parse(readFileSync(new URL('matching.json', fixtures), 'utf8')),
    );
    expect(bill.synthetic).toBe(true);
    const result = reproduceBill(bill, rules, {
      holidays: new Set(),
      monthlyRates: [],
    });
    expect(result.ok).toBe(true);
    expect(result.mismatches).toEqual([]);
    expect(result.result?.reasons).toContain('TARIFF_NOT_BILL_VERIFIED');
  });
  it('reports precisely the erroneous printed line', () => {
    const bill = BillFixtureSchema.parse(
      JSON.parse(readFileSync(new URL('wrong-line.json', fixtures), 'utf8')),
    );
    expect(
      reproduceBill(bill, rules, { holidays: new Set(), monthlyRates: [] })
        .mismatches,
    ).toEqual([{ line: 'TEST_ENERGY', expected: '50.05', actual: '50.00' }]);
  });
  it('rejects identifying metadata rather than ignoring it', () => {
    const bill = JSON.parse(
      readFileSync(new URL('matching.json', fixtures), 'utf8'),
    );
    expect(() =>
      BillFixtureSchema.parse({
        ...bill,
        accountNumber: 'private',
        address: 'private',
        meterId: 'private',
        name: 'private',
      }),
    ).toThrow();
  });
  it('refuses a multi-month monthly-rate fixture without measured month quantities', () => {
    const monthly = parseRules({
      ...rules,
      components: [
        {
          code: 'TEST_AFA',
          label: 'Fake monthly rate',
          kind: 'PER_KWH_MONTHLY',
          basis: 'IMPORT',
        },
      ],
    });
    const bill = BillFixtureSchema.parse({
      periodStartDate: '2026-11-03',
      periodEndDate: '2026-12-02',
      importPeakKwh: '100.000',
      importOffpeakKwh: '0.000',
      exportKwh: '0.000',
      lines: [{ code: 'TEST_AFA', amount: '80.00' }],
      total: '80.00',
      openingLots: [],
      closingLots: [],
    });
    const rates = [
      {
        componentCode: 'TEST_AFA',
        month: '2026-11',
        ratePerKwh: new Decimal('0.50'),
      },
      {
        componentCode: 'TEST_AFA',
        month: '2026-12',
        ratePerKwh: new Decimal('1.00'),
      },
    ];
    const ctx = { holidays: new Set<string>(), monthlyRates: rates };
    const refused = reproduceBill(bill, monthly, ctx);
    expect(refused).toMatchObject({
      ok: false,
      refusals: ['MONTHLY_SPLIT_REQUIRED'],
      result: null,
    });
    const measured = BillFixtureSchema.parse({
      ...bill,
      importByMonth: [
        { month: '2026-11', kwh: '40.000' },
        { month: '2026-12', kwh: '60.000' },
      ],
    });
    expect(reproduceBill(measured, monthly, ctx)).toMatchObject({
      ok: true,
      refusals: [],
      result: { total: '80.00' },
    });
    const inconsistentMonth = BillFixtureSchema.parse({
      ...measured,
      importByMonth: [
        { month: '2026-11', kwh: '40.000' },
        { month: '2026-12', kwh: '59.000' },
      ],
    });
    expect(reproduceBill(inconsistentMonth, monthly, ctx)).toMatchObject({
      ok: false,
      refusals: ['IMPORT_MONTH_SPLIT_INCONSISTENT'],
      result: null,
    });
    const wrongRates = {
      ...ctx,
      monthlyRates: [
        { ...rates[0], ratePerKwh: new Decimal('0.80') },
        rates[1],
      ],
    };
    expect(reproduceBill(measured, monthly, wrongRates)).toMatchObject({
      ok: false,
      mismatches: [
        { line: 'TEST_AFA', expected: '80.00', actual: '92.00' },
        { line: 'TOTAL', expected: '80.00', actual: '92.00' },
      ],
    });
  });
  it('refuses to invent a NEM export window for SAME_WINDOW_FIRST', () => {
    const same = parseRules({
      ...rules,
      nem: {
        offsetComponents: ['TEST_ENERGY'],
        touOffset: 'SAME_WINDOW_FIRST',
        creditExpiryPeriods: 12,
      },
      components: [
        {
          ...rules.components[0],
          rates: [
            { window: 'PEAK', tiers: [{ uptoKwh: null, rate: '1.00' }] },
            { window: 'OFFPEAK', tiers: [{ uptoKwh: null, rate: '0.50' }] },
          ],
        },
      ],
    });
    const bill = BillFixtureSchema.parse({
      periodStartDate: '2026-11-03',
      periodEndDate: '2026-12-02',
      importPeakKwh: '100.000',
      importOffpeakKwh: '100.000',
      exportKwh: '100.000',
      lines: [{ code: 'TEST_ENERGY', amount: '50.00' }],
      total: '50.00',
      openingLots: [],
      closingLots: [],
    });
    const ctx = { holidays: new Set<string>(), monthlyRates: [] };
    expect(reproduceBill(bill, same, ctx)).toMatchObject({
      ok: false,
      refusals: ['EXPORT_WINDOW_SPLIT_REQUIRED'],
      result: null,
    });
    const distributed = BillFixtureSchema.parse({
      ...bill,
      exportByWindow: [{ window: 'PEAK', kwh: '100.000' }],
    });
    expect(reproduceBill(distributed, same, ctx)).toMatchObject({
      ok: true,
      refusals: [],
      result: { total: '50.00' },
    });
    const inconsistentExport = BillFixtureSchema.parse({
      ...bill,
      exportByWindow: [{ window: 'PEAK', kwh: '99.000' }],
    });
    expect(reproduceBill(inconsistentExport, same, ctx)).toMatchObject({
      ok: false,
      refusals: ['EXPORT_WINDOW_SPLIT_INCONSISTENT'],
      result: null,
    });
  });
  it('rejects a window split contradicting printed peak/off-peak import even if its total matches', () => {
    const windowed = parseRules({
      ...rules,
      components: [
        {
          ...rules.components[0],
          rates: [
            { window: 'PEAK', tiers: [{ uptoKwh: null, rate: '1.00' }] },
            { window: 'OFFPEAK', tiers: [{ uptoKwh: null, rate: '0.50' }] },
          ],
        },
      ],
    });
    const bill = BillFixtureSchema.parse({
      periodStartDate: '2026-11-03',
      periodEndDate: '2026-12-02',
      importPeakKwh: '100.000',
      importOffpeakKwh: '0.000',
      exportKwh: '0.000',
      lines: [{ code: 'TEST_ENERGY', amount: '100.00' }],
      total: '100.00',
      openingLots: [],
      closingLots: [],
    });
    const ctx = { holidays: new Set<string>(), monthlyRates: [] };
    const inconsistent = BillFixtureSchema.parse({
      ...bill,
      importByWindow: [{ window: 'OFFPEAK', kwh: '100.000' }],
      lines: [{ code: 'TEST_ENERGY', amount: '50.00' }],
      total: '50.00',
    });
    expect(reproduceBill(inconsistent, windowed, ctx)).toMatchObject({
      ok: false,
      refusals: ['IMPORT_WINDOW_SPLIT_INCONSISTENT'],
      result: null,
    });
    const consistent = BillFixtureSchema.parse({
      ...bill,
      importByWindow: [{ window: 'PEAK', kwh: '100.000' }],
    });
    expect(reproduceBill(consistent, windowed, ctx)).toMatchObject({
      ok: true,
      refusals: [],
      result: { total: '100.00' },
    });
  });
});
