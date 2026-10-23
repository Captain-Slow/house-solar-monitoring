import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import { parseRules, TariffRulesV1Schema } from './rules.schema.js';
import { tnbTemplateRules } from './tnb-template.js';
import { windowFor } from './tou.js';

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

describe('tariff rules', () => {
  it('reports every empty template rate and threshold with a precise path', () => {
    try {
      parseRules(tnbTemplateRules());
      throw new Error('Expected template rejection');
    } catch (error) {
      expect(error).toBeInstanceOf(ZodError);
      const paths = (error as ZodError).issues.map((issue) =>
        issue.path.join('.'),
      );
      for (const path of [
        'components.0.rates.0.tiers.0.uptoKwh',
        'components.0.rates.0.tiers.0.rate',
        'components.0.rates.0.tiers.1.rate',
        'components.0.rates.1.tiers.0.uptoKwh',
        'components.0.rates.1.tiers.0.rate',
        'components.0.rates.1.tiers.1.rate',
        'components.1.rates.0.tiers.0.rate',
        'components.2.rates.0.tiers.0.rate',
        'components.3.amount',
        'components.3.waiveIfConsumptionAtOrBelowKwh',
        'components.5.percent',
        'components.6.percent',
        'components.7.percent',
      ])
        expect(paths).toContain(path);
    }
  });
  it('rejects overnight or non-five-minute windows, invalid zones, non-increasing tiers and forward percentage references', () => {
    expect(() => parseRules({ ...rules, timezone: 'not/a-zone' })).toThrow();
    expect(() =>
      parseRules({
        ...rules,
        touWindows: [{ ...rules.touWindows[0], start: '22:00', end: '06:00' }],
      }),
    ).toThrow();
    expect(() =>
      parseRules({
        ...rules,
        touWindows: [{ ...rules.touWindows[0], start: '14:01' }],
      }),
    ).toThrow();
    expect(() =>
      parseRules({
        ...rules,
        components: [
          {
            ...rules.components[0],
            rates: [
              {
                window: 'ANY',
                tiers: [
                  { uptoKwh: '100', rate: '0.50' },
                  { uptoKwh: '99', rate: '0.20' },
                  { uptoKwh: null, rate: '0.10' },
                ],
              },
            ],
          },
        ],
      }),
    ).toThrow();
    expect(() =>
      parseRules({
        ...rules,
        components: [
          {
            code: 'TEST_TAX',
            label: 'Synthetic tax',
            kind: 'PERCENT',
            percent: '1',
            ofComponents: ['TEST_ENERGY'],
            portion: 'ALL',
          },
          rules.components[0],
        ],
      }),
    ).toThrow();
  });
  it('accepts ANY fallback and rejects unknown rate windows and duplicate component codes by path', () => {
    expect(
      parseRules({
        ...rules,
        components: [
          {
            ...rules.components[0],
            rates: [
              { window: 'PEAK', tiers: [{ uptoKwh: null, rate: '0.75' }] },
              { window: 'ANY', tiers: [{ uptoKwh: null, rate: '0.50' }] },
            ],
          },
        ],
      }).components,
    ).toHaveLength(1);
    const parsed = {
      ...rules,
      components: [
        rules.components[0],
        {
          ...rules.components[0],
          rates: [
            { window: 'UNKNOWN', tiers: [{ uptoKwh: null, rate: '0.50' }] },
          ],
        },
      ],
    };
    const outcome = TariffRulesV1Schema.safeParse(parsed);
    const errors = outcome.error?.issues.map((issue) => issue.path.join('.'));
    expect(errors).toContain('components.1.code');
    expect(errors).toContain('components.1.rates.0.window');
  });
});

describe('windowFor', () => {
  it('honors exact five-minute boundaries, weekends and holidays in Kuala Lumpur', () => {
    const at = (clock: string) =>
      windowFor(new Date(`2026-11-02T${clock}:00+08:00`), rules, new Set());
    expect(at('13:55')).toBe('OFFPEAK');
    expect(at('14:00')).toBe('PEAK');
    expect(at('21:55')).toBe('PEAK');
    expect(at('22:00')).toBe('OFFPEAK');
    expect(
      windowFor(new Date('2026-11-07T14:00:00+08:00'), rules, new Set()),
    ).toBe('OFFPEAK');
    expect(
      windowFor(
        new Date('2026-11-02T14:00:00+08:00'),
        rules,
        new Set(['2026-11-02']),
      ),
    ).toBe('OFFPEAK');
  });
  it('uses the local date and clock across the Berlin DST transition', () => {
    const berlin = parseRules({
      ...rules,
      timezone: 'Europe/Berlin',
      touWindows: [
        { ...rules.touWindows[0], days: ['SUN'], start: '01:00', end: '04:00' },
      ],
    });
    expect(windowFor(new Date('2026-10-25T00:30:00Z'), berlin, new Set())).toBe(
      'PEAK',
    );
    expect(windowFor(new Date('2026-10-25T01:30:00Z'), berlin, new Set())).toBe(
      'PEAK',
    );
    expect(windowFor(new Date('2026-10-25T03:00:00Z'), berlin, new Set())).toBe(
      'OFFPEAK',
    );
    expect(
      windowFor(
        new Date('2026-10-25T01:30:00Z'),
        berlin,
        new Set(['2026-10-25']),
      ),
    ).toBe('OFFPEAK');
  });
});
