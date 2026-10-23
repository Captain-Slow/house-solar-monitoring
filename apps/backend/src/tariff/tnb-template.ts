import type { TariffRulesV1 } from './rules.schema.js';

/** Candidate line structure only. Empty rates, amounts and thresholds are intentional:
 * none is asserted as a TNB rule until a redacted bill reproduces them. In particular,
 * the reported 1,500 kWh tier and 600 kWh waiver must be confirmed from the bill.
 * This object MUST fail parseRules until the user fills the unknown bill values.
 */
export function tnbTemplateRules(): TariffRulesV1 {
  return {
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
    nem: {
      offsetComponents: ['ENERGY'],
      touOffset: 'PRO_RATA',
      creditExpiryPeriods: 12,
    },
    components: [
      {
        code: 'ENERGY',
        label: 'ToU energy (unverified)',
        kind: 'PER_KWH',
        basis: 'IMPORT',
        tierMode: 'INCREMENTAL',
        rates: [
          {
            window: 'PEAK',
            tiers: [
              { uptoKwh: '', rate: '' },
              { uptoKwh: null, rate: '' },
            ],
          },
          {
            window: 'OFFPEAK',
            tiers: [
              { uptoKwh: '', rate: '' },
              { uptoKwh: null, rate: '' },
            ],
          },
        ],
      },
      {
        code: 'CAPACITY',
        label: 'Capacity (unverified)',
        kind: 'PER_KWH',
        basis: 'IMPORT',
        tierMode: 'INCREMENTAL',
        rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '' }] }],
      },
      {
        code: 'NETWORK',
        label: 'Network (unverified)',
        kind: 'PER_KWH',
        basis: 'IMPORT',
        tierMode: 'INCREMENTAL',
        rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '' }] }],
      },
      {
        code: 'RETAIL',
        label: 'Retail (unverified)',
        kind: 'FIXED',
        amount: '',
        prorate: true,
        waiveIfConsumptionAtOrBelowKwh: '',
      },
      {
        code: 'AFA',
        label: 'Monthly AFA (unverified)',
        kind: 'PER_KWH_MONTHLY',
        basis: 'IMPORT',
      },
      {
        code: 'EEI',
        label: 'EEI rebate (unverified)',
        kind: 'PERCENT',
        percent: '',
        ofComponents: ['ENERGY'],
        portion: 'ALL',
      },
      {
        code: 'KWTBB',
        label: 'KWTBB (unverified)',
        kind: 'PERCENT',
        percent: '',
        ofComponents: ['ENERGY'],
        portion: 'ALL',
      },
      {
        code: 'SST',
        label: 'SST (unverified)',
        kind: 'PERCENT',
        percent: '',
        ofComponents: ['ENERGY'],
        portion: 'ALL',
      },
    ],
    totalRounding: 'NONE',
  };
}
