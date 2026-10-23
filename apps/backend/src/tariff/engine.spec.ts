import { Decimal } from 'decimal.js';
import { describe, expect, it } from 'vitest';
import { computeBill, isLowerBoundShape } from './engine.js';
import { parseRules } from './rules.schema.js';
import type { TariffRulesV1 } from './rules.schema.js';
import type {
  BillContext,
  MonthlyRateRow,
  NemOpening,
  SegmentQuantities,
} from './types.js';

const base = parseRules({
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
const context: BillContext = {
  coverage: 1,
  periodDays: 30,
  periodStartDate: '2026-11-03',
  periodInProgress: false,
  startsBeforeMonitoring: false,
  entirelyBeforeMonitoring: false,
  noTariffVersion: false,
  vendorDataOnly: false,
  holidayCalendarMissing: false,
  touAllocationEstimated: false,
  accountingUnreconciled: false,
  mappingProvisional: false,
  calcParamsPartialRecompute: false,
  allVersionsBillVerified: false,
};
const known: NemOpening = { lots: [] };
function quantities(
  importKwh: string,
  exportKwh = '0',
  startDate = '2026-11-03',
  endDate = '2026-12-02',
  days = 30,
): SegmentQuantities {
  return {
    startDate,
    endDate,
    days,
    windows: [
      {
        window: 'PEAK',
        importKwh: new Decimal(importKwh),
        exportKwh: new Decimal(exportKwh),
      },
    ],
    importByMonth: { '2026-11': new Decimal(importKwh) },
  };
}
function bill(
  rules: TariffRulesV1 = base,
  energy = quantities('100'),
  overrides: Partial<BillContext> = {},
  monthlyRates: MonthlyRateRow[] = [],
  opening: NemOpening = known,
) {
  return computeBill({
    segments: [{ versionId: 1, rules, quantities: energy }],
    monthlyRates,
    nemOpening: opening,
    context: { ...context, ...overrides },
  });
}

describe('pure pricing', () => {
  it('prices incremental and WHOLE tiers at fake rates and rounds half up including nearest five sen', () => {
    const tiered = parseRules({
      ...base,
      components: [
        {
          ...base.components[0],
          rates: [
            {
              window: 'ANY',
              tiers: [
                { uptoKwh: '1500', rate: '0.50' },
                { uptoKwh: null, rate: '0.75' },
              ],
            },
          ],
        },
      ],
    });
    expect(bill(tiered, quantities('1600')).total).toBe('825.00');
    const whole = parseRules({
      ...tiered,
      components: [{ ...tiered.components[0], tierMode: 'WHOLE' }],
    });
    expect(bill(whole, quantities('1600')).total).toBe('1200.00');
    const rounded = parseRules({
      ...base,
      totalRounding: 'NEAREST_0_05',
      components: [
        {
          ...base.components[0],
          rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '0.005' }] }],
        },
      ],
    });
    expect(bill(rounded, quantities('1')).lineItems[0].amount).toBe('0.01');
    expect(bill(rounded, quantities('5')).subtotal).toBe('0.03');
    expect(bill(rounded, quantities('5')).total).toBe('0.05');
  });
  it('scales thresholds once, splits tariff versions and prorates fixed fees once', () => {
    const rules = parseRules({
      ...base,
      components: [
        {
          code: 'TEST_FEE',
          label: 'Fake fixed fee',
          kind: 'FIXED',
          amount: '10',
          prorate: true,
        },
      ],
    });
    const result = computeBill({
      segments: [
        {
          versionId: 1,
          rules,
          quantities: quantities('0', '0', '2026-11-03', '2026-11-17', 15),
        },
        {
          versionId: 2,
          rules,
          quantities: quantities('0', '0', '2026-11-18', '2026-12-02', 15),
        },
      ],
      monthlyRates: [],
      nemOpening: known,
      context,
    });
    expect(result.lineItems.map((line) => line.amount)).toEqual([
      '5.00',
      '5.00',
    ]);
    expect(result.total).toBe('10.00');
    expect(result.reasons).toContain('TARIFF_CHANGED_MID_PERIOD');
    const days31 = parseRules({
      ...base,
      thresholdProration: 'DAYS_OVER_30',
      components: [
        {
          ...base.components[0],
          rates: [
            {
              window: 'ANY',
              tiers: [
                { uptoKwh: '600', rate: '0.50' },
                { uptoKwh: null, rate: '1.00' },
              ],
            },
          ],
        },
      ],
    });
    expect(
      bill(days31, quantities('620', '0', '2026-11-03', '2026-12-03', 31), {
        periodDays: 31,
      }).total,
    ).toBe('310.00');
    expect(
      bill(days31, quantities('621', '0', '2026-11-03', '2026-12-03', 31), {
        periodDays: 31,
      }).total,
    ).toBe('311.00');
  });
  it('splits at November 15 and prorates the 1,500 kWh synthetic tier by sub-period days', () => {
    const tiered = parseRules({
      ...base,
      components: [
        {
          ...base.components[0],
          rates: [
            {
              window: 'ANY',
              tiers: [
                { uptoKwh: '1500', rate: '0.50' },
                { uptoKwh: null, rate: '0.75' },
              ],
            },
          ],
        },
      ],
    });
    const result = computeBill({
      segments: [
        {
          versionId: 1,
          rules: tiered,
          quantities: quantities('650', '0', '2026-11-03', '2026-11-14', 12),
        },
        {
          versionId: 2,
          rules: tiered,
          quantities: quantities('950', '0', '2026-11-15', '2026-12-02', 18),
        },
      ],
      monthlyRates: [],
      nemOpening: known,
      context,
    });
    expect(result.lineItems.map((item) => item.amount)).toEqual([
      '337.50',
      '487.50',
    ]);
    expect(result.total).toBe('825.00');
    expect(result.lineItems.map((item) => item.segment)).toEqual([0, 1]);
  });
  it('marks pro-rata allocation of an incremental upper tier across active windows', () => {
    const rules = parseRules({
      ...base,
      components: [
        {
          ...base.components[0],
          rates: [
            {
              window: 'PEAK',
              tiers: [
                { uptoKwh: '100', rate: '1' },
                { uptoKwh: null, rate: '2' },
              ],
            },
            {
              window: 'OFFPEAK',
              tiers: [
                { uptoKwh: '100', rate: '0.50' },
                { uptoKwh: null, rate: '1' },
              ],
            },
          ],
        },
      ],
    });
    const energy = {
      ...quantities('80'),
      windows: [
        {
          window: 'PEAK',
          importKwh: new Decimal(80),
          exportKwh: new Decimal(0),
        },
        {
          window: 'OFFPEAK',
          importKwh: new Decimal(80),
          exportKwh: new Decimal(0),
        },
      ],
    };
    const result = bill(rules, energy);
    expect(result.total).toBe('165.00');
    expect(result.reasons).toContain('TIER_SPLIT_PRO_RATA');
  });
  it('applies percentage to rounded lines and only the consumption share over a threshold', () => {
    const rules = parseRules({
      ...base,
      components: [
        {
          ...base.components[0],
          rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '0.015' }] }],
        },
        {
          code: 'TEST_TAX',
          label: 'Fake tax',
          kind: 'PERCENT',
          percent: '10',
          ofComponents: ['TEST_ENERGY'],
          applyIfConsumptionAboveKwh: '1',
          portion: 'ABOVE_THRESHOLD_SHARE',
        },
      ],
    });
    const result = bill(rules, quantities('2'));
    expect(result.lineItems.map((line) => line.amount)).toEqual([
      '0.03',
      '0.00',
    ]);
    const large = bill(
      parseRules({
        ...rules,
        components: [
          rules.components[0],
          { ...rules.components[1], applyIfConsumptionAboveKwh: '10' },
        ],
      }),
      quantities('20'),
    );
    expect(large.lineItems.map((line) => line.amount)).toEqual([
      '0.30',
      '0.02',
    ]);
  });
  it('calculates percent from rounded referenced lines within each tariff segment', () => {
    const rules = parseRules({
      ...base,
      components: [
        {
          ...base.components[0],
          rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '0.005' }] }],
        },
        {
          code: 'TEST_TAX',
          label: 'Fake percent',
          kind: 'PERCENT',
          percent: '50',
          ofComponents: ['TEST_ENERGY'],
          portion: 'ALL',
        },
      ],
    });
    const result = computeBill({
      segments: [
        {
          versionId: 1,
          rules,
          quantities: quantities('1', '0', '2026-11-03', '2026-11-17', 15),
        },
        {
          versionId: 2,
          rules,
          quantities: quantities('1', '0', '2026-11-18', '2026-12-02', 15),
        },
      ],
      monthlyRates: [],
      nemOpening: known,
      context,
    });
    expect(result.lineItems.map((line) => line.amount)).toEqual([
      '0.01',
      '0.01',
      '0.01',
      '0.01',
    ]);
    expect(result.total).toBe('0.04');
  });
  it('marks only a monthly line unavailable when its month rate is absent', () => {
    const rules = parseRules({
      ...base,
      components: [
        ...base.components,
        {
          code: 'TEST_MONTHLY',
          label: 'Fake monthly',
          kind: 'PER_KWH_MONTHLY',
          basis: 'IMPORT',
        },
      ],
    });
    const result = bill(rules);
    expect(result.lineItems.map((line) => line.status)).toEqual([
      'OK',
      'UNAVAILABLE',
    ]);
    expect(result.total).toBeNull();
    expect(result.status).toBe('ESTIMATED');
    expect(result.reasons).toContain('MONTHLY_RATE_MISSING:TEST_MONTHLY');
  });
  it('uses NET_IMPORT to choose incremental tier while billing the non-offset component on gross import', () => {
    const rules = parseRules({
      ...base,
      consumptionBasis: 'NET_IMPORT',
      nem: {
        offsetComponents: ['TEST_ENERGY'],
        touOffset: 'PRO_RATA',
        creditExpiryPeriods: 12,
      },
      components: [
        {
          ...base.components[0],
          rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '0' }] }],
        },
        {
          code: 'TEST_CAPACITY',
          label: 'Fake capacity',
          kind: 'PER_KWH',
          basis: 'IMPORT',
          tierMode: 'INCREMENTAL',
          rates: [
            {
              window: 'ANY',
              tiers: [
                { uptoKwh: '1000', rate: '0.50' },
                { uptoKwh: null, rate: '0.75' },
              ],
            },
          ],
        },
      ],
    });
    const result = bill(rules, quantities('1100', '200'));
    expect(
      result.lineItems.find((line) => line.code === 'TEST_CAPACITY')?.amount,
    ).toBe('550.00');
    expect(result.total).toBe('550.00');
  });
  it('assigns only consumption above the first tier to the upper rate when gross import exceeds NET_IMPORT', () => {
    const rules = parseRules({
      ...base,
      consumptionBasis: 'NET_IMPORT',
      nem: {
        offsetComponents: ['TEST_ENERGY'],
        touOffset: 'PRO_RATA',
        creditExpiryPeriods: 12,
      },
      components: [
        {
          ...base.components[0],
          rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '0' }] }],
        },
        {
          code: 'TEST_CAPACITY',
          label: 'Fake capacity',
          kind: 'PER_KWH',
          basis: 'IMPORT',
          tierMode: 'INCREMENTAL',
          rates: [
            {
              window: 'ANY',
              tiers: [
                { uptoKwh: '1000', rate: '0.50' },
                { uptoKwh: null, rate: '0.75' },
              ],
            },
          ],
        },
      ],
    });
    expect(bill(rules, quantities('1300', '200')).total).toBe('675.00');
    const multi = parseRules({
      ...rules,
      components: [
        rules.components[0],
        {
          ...rules.components[1],
          rates: [
            {
              window: 'ANY',
              tiers: [
                { uptoKwh: '1000', rate: '0.50' },
                { uptoKwh: '1200', rate: '0.75' },
                { uptoKwh: null, rate: '1.00' },
              ],
            },
          ],
        },
      ],
    });
    expect(bill(multi, quantities('1500', '200')).total).toBe('850.00');
  });
  it('splits only the above-threshold net consumption pro-rata over gross-import windows', () => {
    const rules = parseRules({
      ...base,
      consumptionBasis: 'NET_IMPORT',
      nem: {
        offsetComponents: ['TEST_ENERGY'],
        touOffset: 'PRO_RATA',
        creditExpiryPeriods: 12,
      },
      components: [
        {
          ...base.components[0],
          rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '0' }] }],
        },
        {
          code: 'TEST_CAPACITY',
          label: 'Fake capacity',
          kind: 'PER_KWH',
          basis: 'IMPORT',
          tierMode: 'INCREMENTAL',
          rates: [
            {
              window: 'PEAK',
              tiers: [
                { uptoKwh: '1000', rate: '0.50' },
                { uptoKwh: null, rate: '0.75' },
              ],
            },
            {
              window: 'OFFPEAK',
              tiers: [
                { uptoKwh: '1000', rate: '0.20' },
                { uptoKwh: null, rate: '0.30' },
              ],
            },
          ],
        },
      ],
    });
    const energy = {
      ...quantities('1300'),
      windows: [
        {
          window: 'PEAK',
          importKwh: new Decimal(650),
          exportKwh: new Decimal(200),
        },
        {
          window: 'OFFPEAK',
          importKwh: new Decimal(650),
          exportKwh: new Decimal(0),
        },
      ],
    };
    const result = bill(rules, energy);
    expect(result.total).toBe('472.50');
    expect(result.reasons).toContain('TIER_SPLIT_PRO_RATA');
  });
  it('prices monthly quantities per calendar month and rejects negative monthly rates as a lower-bound shape', () => {
    const rules = parseRules({
      ...base,
      components: [
        {
          code: 'TEST_MONTHLY',
          label: 'Fake monthly',
          kind: 'PER_KWH_MONTHLY',
          basis: 'IMPORT',
        },
      ],
    });
    const energy = {
      ...quantities('100'),
      importByMonth: { '2026-11': new Decimal(40), '2026-12': new Decimal(60) },
    };
    const rates = [
      {
        componentCode: 'TEST_MONTHLY',
        month: '2026-11',
        ratePerKwh: new Decimal('0.50'),
      },
      {
        componentCode: 'TEST_MONTHLY',
        month: '2026-12',
        ratePerKwh: new Decimal('0.75'),
      },
    ];
    expect(
      bill(rules, energy, {}, rates).lineItems.map((line) => line.amount),
    ).toEqual(['20.00', '45.00']);
    expect(bill(rules, energy, {}, rates).isLowerBound).toBe(true);
    expect(
      bill(rules, energy, {}, [
        { ...rates[0], ratePerKwh: new Decimal('-0.50') },
        rates[1],
      ]).isLowerBound,
    ).toBe(false);
  });
});

describe('NEM credit', () => {
  const nemRules = parseRules({
    ...base,
    consumptionBasis: 'NET_IMPORT',
    nem: {
      offsetComponents: ['TEST_ENERGY'],
      touOffset: 'PRO_RATA',
      creditExpiryPeriods: 12,
    },
  });
  it('consumes carried credit FIFO, retains origin and creates only unused new export', () => {
    const result = bill(nemRules, quantities('40', '25'), {}, [], {
      lots: [
        { originStart: '2026-08-03', kwh: new Decimal(30) },
        { originStart: '2026-09-03', kwh: new Decimal(10) },
      ],
    });
    expect(result.total).toBe('0.00');
    expect(result.nem?.consumedLots).toEqual([
      { originStart: '2026-08-03', kwh: '30.000' },
      { originStart: '2026-09-03', kwh: '10.000' },
    ]);
    expect(result.nem?.closingLots).toEqual([
      { originStart: '2026-11-03', kwh: '25.000' },
    ]);
  });
  it('expires before applying any credit and never refreshes origin', () => {
    const result = bill(nemRules, quantities('30', '0'), {}, [], {
      lots: [
        { originStart: '2025-09-03', kwh: new Decimal(20) },
        { originStart: '2026-06-03', kwh: new Decimal(10) },
      ],
    });
    expect(result.nem?.expiredLots).toEqual([
      { originStart: '2025-09-03', kwh: '20.000' },
    ]);
    expect(result.nem?.consumedLots).toEqual([
      { originStart: '2026-06-03', kwh: '10.000' },
    ]);
    expect(result.total).toBe('10.00');
  });
  it('distinguishes same-window-first from pro-rata and marks unknown opening credit', () => {
    const two = {
      ...quantities('10'),
      windows: [
        {
          window: 'PEAK',
          importKwh: new Decimal(10),
          exportKwh: new Decimal(10),
        },
        {
          window: 'OFFPEAK',
          importKwh: new Decimal(10),
          exportKwh: new Decimal(0),
        },
      ],
    };
    const priced = parseRules({
      ...nemRules,
      components: [
        {
          ...base.components[0],
          rates: [
            { window: 'PEAK', tiers: [{ uptoKwh: null, rate: '1.00' }] },
            { window: 'OFFPEAK', tiers: [{ uptoKwh: null, rate: '0.50' }] },
          ],
        },
      ],
    });
    expect(bill(priced, two).total).toBe('7.50');
    expect(
      bill(
        parseRules({
          ...priced,
          nem: { ...priced.nem!, touOffset: 'SAME_WINDOW_FIRST' },
        }),
        two,
      ).total,
    ).toBe('5.00');
    expect(
      bill(priced, quantities('100'), { coverage: 0.9 }, [], { lots: null })
        .reasons,
    ).toEqual(
      expect.arrayContaining([
        'NEM_OPENING_CREDIT_UNKNOWN',
        'MISSING_DATA_DIRECTION_UNKNOWN',
      ]),
    );
  });
  it('carries NEM lots between chronological tariff segments without changing origins', () => {
    const result = computeBill({
      segments: [
        {
          versionId: 1,
          rules: nemRules,
          quantities: quantities('20', '30', '2026-11-03', '2026-11-14', 12),
        },
        {
          versionId: 2,
          rules: nemRules,
          quantities: quantities('5', '0', '2026-11-15', '2026-12-02', 18),
        },
      ],
      monthlyRates: [],
      nemOpening: known,
      context,
    });
    expect(result.nem?.closingLots).toEqual([
      { originStart: '2026-11-03', kwh: '5.000' },
    ]);
    expect(result.nem?.consumedLots).toEqual([
      { originStart: '2026-11-03', kwh: '25.000' },
    ]);
    expect(result.total).toBe('0.00');
  });
  it('does not use known current export when opening credit is unknown', () => {
    const result = bill(nemRules, quantities('100', '80'), {}, [], {
      lots: null,
      reason: 'NEM_CHAIN_GAP',
    });
    expect(result.total).toBe('50.00');
    expect(result.nem?.consumedLots).toEqual([]);
    expect(result.reasons).toContain('NEM_CHAIN_GAP');
  });
  it('reports an estimated inherited opening credit without discarding it', () => {
    const opening: NemOpening = {
      lots: [{ originStart: '2026-09-03', kwh: new Decimal(40) }],
      reason: 'NEM_CHAIN_GAP',
      estimated: true,
    };
    const verified = { allVersionsBillVerified: true };
    const result = bill(nemRules, quantities('30'), verified, [], opening);
    expect(result.status).toBe('ESTIMATED');
    expect(result.reasons).toEqual(['NEM_OPENING_CREDIT_ESTIMATED']);
    expect(result.nem?.consumedLots).toEqual([
      { originStart: '2026-09-03', kwh: '30.000' },
    ]);
    expect(result.total).toBe('0.00');
    const certain = bill(nemRules, quantities('30'), verified, [], {
      ...opening,
      estimated: false,
    });
    expect(certain.reasons).toEqual([]);
  });
  it('lets an unknown opening bank outrank the estimated flag and ignores it without NEM', () => {
    expect(
      bill(nemRules, quantities('30'), { allVersionsBillVerified: true }, [], {
        lots: null,
        reason: 'NEM_CHAIN_GAP',
        estimated: true,
      }).reasons,
    ).toEqual(['NEM_CHAIN_GAP']);
    expect(
      bill(base, quantities('30'), {}, [], {
        lots: [],
        reason: 'NEM_CHAIN_GAP',
        estimated: true,
      }).reasons,
    ).not.toContain('NEM_OPENING_CREDIT_ESTIMATED');
  });
  it('debits oldest credit even when export from this period sets SAME_WINDOW_FIRST allocation', () => {
    const same = parseRules({
      ...nemRules,
      nem: { ...nemRules.nem!, touOffset: 'SAME_WINDOW_FIRST' },
    });
    const result = bill(same, quantities('10', '20'), {}, [], {
      lots: [{ originStart: '2025-11-03', kwh: new Decimal(10) }],
    });
    expect(result.nem?.consumedLots).toEqual([
      { originStart: '2025-11-03', kwh: '10.000' },
    ]);
    expect(result.nem?.closingLots).toEqual([
      { originStart: '2026-11-03', kwh: '20.000' },
    ]);
  });
  it('persists fractional credit exactly through a second billing period', () => {
    const costly = parseRules({
      ...nemRules,
      components: [
        {
          ...base.components[0],
          rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '100' }] }],
        },
      ],
    });
    const first = bill(costly, quantities('0.0004', '0.001'));
    expect(first.nem?.closingLots).toEqual([
      { originStart: '2026-11-03', kwh: '0.0006' },
    ]);
    const second = bill(
      costly,
      quantities('0.001', '0', '2026-12-03', '2027-01-01'),
      { periodStartDate: '2026-12-03' },
      [],
      {
        lots: first.nem!.closingLots.map((lot) => ({
          originStart: lot.originStart,
          kwh: new Decimal(lot.kwh),
        })),
      },
    );
    expect(second.total).toBe('0.04');
  });
  it('consumes two carried lots in age order rather than reverse order', () => {
    const result = bill(nemRules, quantities('15'), {}, [], {
      lots: [
        { originStart: '2026-09-03', kwh: new Decimal(10) },
        { originStart: '2026-08-03', kwh: new Decimal(10) },
      ],
    });
    expect(result.nem?.consumedLots).toEqual([
      { originStart: '2026-08-03', kwh: '10.000' },
      { originStart: '2026-09-03', kwh: '5.000' },
    ]);
    expect(result.nem?.closingLots).toEqual([
      { originStart: '2026-09-03', kwh: '5.000' },
    ]);
  });
});

describe('availability and lower bound', () => {
  it.each([
    [{ noTariffVersion: true }, 'NO_TARIFF_VERSION'],
    [{ coverage: 0.79 }, 'COVERAGE_BELOW_80'],
    [{ entirelyBeforeMonitoring: true }, 'PERIOD_BEFORE_MONITORING'],
    [{ vendorDataOnly: true }, 'VENDOR_DATA_ONLY'],
  ])('declares unavailable for %j', (overrides, reason) => {
    const result = bill(base, quantities('100'), overrides);
    expect(result.status).toBe('UNAVAILABLE');
    expect(result.total).toBeNull();
    expect(result.reasons).toContain(reason);
  });
  it.each([
    [{ coverage: 0.9 }, 'COVERAGE_BELOW_99_5'],
    [{ periodInProgress: true }, 'PERIOD_IN_PROGRESS'],
    [{ touAllocationEstimated: true }, 'TOU_ALLOCATION_ESTIMATED'],
    [{ holidayCalendarMissing: true }, 'HOLIDAY_CALENDAR_MISSING'],
    [{ calcParamsPartialRecompute: true }, 'CALC_PARAMS_PARTIAL_RECOMPUTE'],
    [{ accountingUnreconciled: true }, 'ACCOUNTING_UNRECONCILED'],
    [{ mappingProvisional: true }, 'MAPPING_PROVISIONAL'],
    [{ startsBeforeMonitoring: true }, 'PRE_MONITORING_DATA_MISSING'],
  ])('reports %j as estimated', (overrides, reason) => {
    const result = bill(base, quantities('100'), overrides);
    expect(result.status).toBe('ESTIMATED');
    expect(result.reasons).toContain(reason);
  });
  it('treats exactly 80% coverage as available and exactly 99.5% as not coverage-estimated', () => {
    expect(bill(base, quantities('100'), { coverage: 0.8 }).status).toBe(
      'ESTIMATED',
    );
    const atThreshold = bill(base, quantities('100'), {
      coverage: 0.995,
      allVersionsBillVerified: true,
    });
    expect(atThreshold.status).toBe('COMPLETE');
    expect(atThreshold.reasons).not.toContain('COVERAGE_BELOW_99_5');
    expect(
      bill(base, quantities('100'), { coverage: 0.9949 }).reasons,
    ).toContain('COVERAGE_BELOW_99_5');
  });
  it('disqualifies a low-cost ToU allocation from the lower-bound claim', () => {
    const windowed = parseRules({
      ...base,
      components: [
        {
          ...base.components[0],
          rates: [
            { window: 'PEAK', tiers: [{ uptoKwh: null, rate: '1.00' }] },
            { window: 'OFFPEAK', tiers: [{ uptoKwh: null, rate: '0.50' }] },
          ],
        },
      ],
    });
    const uncertain = {
      ...quantities('50'),
      windows: [
        {
          window: 'PEAK',
          importKwh: new Decimal(50),
          exportKwh: new Decimal(0),
        },
        {
          window: 'OFFPEAK',
          importKwh: new Decimal(50),
          exportKwh: new Decimal(0),
        },
      ],
    };
    const observed = bill(windowed, uncertain, {
      coverage: 0.9,
      touAllocationEstimated: true,
    });
    expect(observed.total).toBe('75.00');
    const resolved = {
      ...quantities('0'),
      windows: [
        {
          window: 'OFFPEAK',
          importKwh: new Decimal(100),
          exportKwh: new Decimal(0),
        },
      ],
    };
    expect(bill(windowed, resolved).total).toBe('50.00');
    expect(observed.isLowerBound).toBe(false);
    expect(observed.reasons).toContain('MISSING_DATA_DIRECTION_UNKNOWN');
  });
  it('rejects the exact missing-export and WHOLE-tier counterexamples', () => {
    const nem = parseRules({
      ...base,
      nem: {
        offsetComponents: ['TEST_ENERGY'],
        touOffset: 'PRO_RATA',
        creditExpiryPeriods: 12,
      },
    });
    const observed = bill(nem, quantities('100'), { coverage: 0.9 });
    const complete = bill(nem, quantities('100', '80'));
    expect(observed.total).toBe('50.00');
    expect(complete.total).toBe('10.00');
    expect(observed.isLowerBound).toBe(false);
    expect(observed.reasons).toContain('MISSING_DATA_DIRECTION_UNKNOWN');
    const whole = parseRules({
      ...base,
      components: [
        {
          ...base.components[0],
          tierMode: 'WHOLE',
          rates: [
            {
              window: 'ANY',
              tiers: [
                { uptoKwh: '100', rate: '1.00' },
                { uptoKwh: null, rate: '0.50' },
              ],
            },
          ],
        },
      ],
    });
    expect(bill(whole, quantities('100')).total).toBe('100.00');
    expect(bill(whole, quantities('101')).total).toBe('50.50');
    expect(isLowerBoundShape(whole)).toBe(false);
  });
  it('proves monotonicity for 320 seeded random lower-bound synthetic tariffs and detects a nonmonotone shape', () => {
    let seed = 82917;
    const random = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    for (let index = 0; index < 320; index++) {
      const peakRate = (0.01 + random() * 1.9).toFixed(4);
      const offpeakRate = (0.01 + random() * 1.9).toFixed(4);
      const fee = (random() * 10).toFixed(2);
      const percent = (random() * 15).toFixed(2);
      const rules = parseRules({
        ...base,
        totalRounding: 'NEAREST_0_05',
        components: [
          {
            ...base.components[0],
            rates: [
              { window: 'PEAK', tiers: [{ uptoKwh: null, rate: peakRate }] },
              {
                window: 'OFFPEAK',
                tiers: [{ uptoKwh: null, rate: offpeakRate }],
              },
            ],
          },
          {
            code: 'TEST_MONTHLY',
            label: 'Fake monthly',
            kind: 'PER_KWH_MONTHLY',
            basis: 'IMPORT',
            applyIfConsumptionAboveKwh: '20',
          },
          {
            code: 'TEST_FEE',
            label: 'Fake fee',
            kind: 'FIXED',
            amount: fee,
            prorate: true,
            waiveIfConsumptionAtOrBelowKwh: '20',
          },
          {
            code: 'TEST_TAX',
            label: 'Fake tax',
            kind: 'PERCENT',
            percent,
            ofComponents: ['TEST_ENERGY', 'TEST_MONTHLY', 'TEST_FEE'],
            applyIfConsumptionAboveKwh: '20',
            portion: 'ALL',
          },
        ],
      });
      const rates = [
        {
          componentCode: 'TEST_MONTHLY',
          month: '2026-11',
          ratePerKwh: new Decimal((0.01 + random()).toFixed(4)),
        },
        {
          componentCode: 'TEST_MONTHLY',
          month: '2026-12',
          ratePerKwh: new Decimal((0.01 + random()).toFixed(4)),
        },
      ];
      const peak = (random() * 100).toFixed(3);
      const offpeak = (random() * 100).toFixed(3);
      const increment = new Decimal((1 + random() * 50).toFixed(3));
      const makeSegment = (
        versionId: number,
        peakKwh: Decimal,
        offpeakKwh: Decimal,
      ) => {
        const november = versionId === 1;
        return {
          versionId,
          rules,
          quantities: {
            startDate: november ? '2026-11-03' : '2026-11-18',
            endDate: november ? '2026-11-17' : '2026-12-02',
            days: 15,
            windows: [
              { window: 'PEAK', importKwh: peakKwh, exportKwh: new Decimal(0) },
              {
                window: 'OFFPEAK',
                importKwh: offpeakKwh,
                exportKwh: new Decimal(0),
              },
            ],
            importByMonth: {
              [november ? '2026-11' : '2026-12']: peakKwh.plus(offpeakKwh),
            },
          },
        };
      };
      const observed = [
        makeSegment(1, new Decimal(peak), new Decimal(offpeak)),
        makeSegment(2, new Decimal(offpeak), new Decimal(peak)),
      ];
      const oneWindowHigher = observed.map((segment, si) =>
        si === index % 2
          ? makeSegment(
              segment.versionId,
              segment.quantities.windows[0].importKwh.plus(increment),
              segment.quantities.windows[1].importKwh,
            )
          : segment,
      );
      const complete = observed.map((segment) =>
        makeSegment(
          segment.versionId,
          segment.quantities.windows[0].importKwh.plus(increment),
          segment.quantities.windows[1].importKwh.plus(increment),
        ),
      );
      const run = (segments: typeof observed) =>
        computeBill({
          segments,
          monthlyRates: rates,
          nemOpening: known,
          context,
        });
      expect(run(observed).isLowerBound).toBe(true);
      expect(Number(run(observed).total)).toBeLessThanOrEqual(
        Number(run(oneWindowHigher).total),
      );
      expect(Number(run(observed).total)).toBeLessThanOrEqual(
        Number(run(complete).total),
      );
    }
    const falling = parseRules({
      ...base,
      components: [
        {
          ...base.components[0],
          tierMode: 'WHOLE',
          rates: [
            {
              window: 'ANY',
              tiers: [
                { uptoKwh: '100', rate: '1.00' },
                { uptoKwh: null, rate: '0.50' },
              ],
            },
          ],
        },
      ],
    });
    let found = false;
    for (let index = 0; index < 300; index++) {
      const before = (99 + random()).toFixed(3);
      const after = (101 + random()).toFixed(3);
      if (
        Number(bill(falling, quantities(before)).total) >
        Number(bill(falling, quantities(after)).total)
      )
        found = true;
    }
    expect(found).toBe(true);
  });
});
