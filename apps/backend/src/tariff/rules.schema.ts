import { IANAZone } from 'luxon';
import { z } from 'zod';

export const TARIFF_RULES_SCHEMA_VERSION = 1;
const decimal = z.string().regex(/^-?\d{1,6}(\.\d{1,6})?$/);
const nonNegative = decimal.refine(
  (value) => !value.startsWith('-'),
  'Must be non-negative',
);
const code = z.string().min(1);
const time = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
  .refine(
    (value) => Number(value.slice(3)) % 5 === 0,
    'Time must align to five minutes',
  );
const threshold = nonNegative;
const component = z.discriminatedUnion('kind', [
  z.strictObject({
    code,
    label: z.string().min(1),
    kind: z.literal('PER_KWH'),
    basis: z.literal('IMPORT'),
    rates: z
      .array(
        z.strictObject({
          window: code,
          tiers: z
            .array(
              z.strictObject({ uptoKwh: threshold.nullable(), rate: decimal }),
            )
            .min(1),
        }),
      )
      .min(1),
    tierMode: z.enum(['INCREMENTAL', 'WHOLE']),
  }),
  z.strictObject({
    code,
    label: z.string().min(1),
    kind: z.literal('PER_KWH_MONTHLY'),
    basis: z.literal('IMPORT'),
    applyIfConsumptionAboveKwh: threshold.optional(),
  }),
  z.strictObject({
    code,
    label: z.string().min(1),
    kind: z.literal('FIXED'),
    amount: decimal,
    prorate: z.boolean(),
    waiveIfConsumptionAtOrBelowKwh: threshold.optional(),
  }),
  z.strictObject({
    code,
    label: z.string().min(1),
    kind: z.literal('PERCENT'),
    percent: decimal,
    ofComponents: z.array(code).min(1),
    applyIfConsumptionAboveKwh: threshold.optional(),
    portion: z.enum(['ALL', 'ABOVE_THRESHOLD_SHARE']),
  }),
]);

export const TariffRulesV1Schema = z
  .strictObject({
    currency: z.literal('MYR'),
    timezone: z
      .string()
      .refine((zone) => IANAZone.isValidZone(zone), 'Invalid IANA timezone'),
    touWindows: z.array(
      z.strictObject({
        code,
        days: z
          .array(z.enum(['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN']))
          .min(1),
        start: time,
        end: time,
        excludeHolidays: z.boolean(),
      }),
    ),
    defaultWindow: code,
    consumptionBasis: z.enum(['GROSS_IMPORT', 'NET_IMPORT']),
    thresholdProration: z.enum(['NONE', 'DAYS_OVER_30']),
    nem: z
      .strictObject({
        offsetComponents: z.array(code).min(1),
        touOffset: z.enum(['PRO_RATA', 'SAME_WINDOW_FIRST']),
        creditExpiryPeriods: z.number().int().positive(),
      })
      .nullable(),
    components: z.array(component).min(1),
    totalRounding: z.enum(['NONE', 'NEAREST_0_05']),
  })
  .superRefine((rules, ctx) => {
    const add = (path: (string | number)[], message: string) =>
      ctx.addIssue({ code: 'custom', path, message });
    const windows = new Set([rules.defaultWindow, 'ANY']);
    const seenWindows = new Set<string>();
    rules.touWindows.forEach((window, index) => {
      if (window.start >= window.end)
        add(
          ['touWindows', index, 'end'],
          'Window must end after it starts; overnight windows are not supported',
        );
      if (
        window.code === rules.defaultWindow ||
        window.code === 'ANY' ||
        seenWindows.has(window.code)
      )
        add(
          ['touWindows', index, 'code'],
          'Window code must be unique and distinct from defaultWindow and ANY',
        );
      if (new Set(window.days).size !== window.days.length)
        add(['touWindows', index, 'days'], 'Duplicate weekday');
      seenWindows.add(window.code);
      windows.add(window.code);
    });
    const seen = new Set<string>();
    rules.components.forEach((item, index) => {
      if (seen.has(item.code))
        add(['components', index, 'code'], 'Duplicate component code');
      if (item.kind === 'PER_KWH') {
        const rateWindows = new Set<string>();
        item.rates.forEach((rate, ri) => {
          if (!windows.has(rate.window))
            add(
              ['components', index, 'rates', ri, 'window'],
              'Unknown window code',
            );
          if (rateWindows.has(rate.window))
            add(
              ['components', index, 'rates', ri, 'window'],
              'Duplicate rate window',
            );
          rateWindows.add(rate.window);
          rate.tiers.forEach((tier, ti) => {
            if (tier.uptoKwh === null) {
              if (ti !== rate.tiers.length - 1)
                add(
                  ['components', index, 'rates', ri, 'tiers', ti, 'uptoKwh'],
                  'Open-ended tier must be last',
                );
            } else if (
              ti > 0 &&
              rate.tiers[ti - 1]?.uptoKwh !== null &&
              Number(tier.uptoKwh) <= Number(rate.tiers[ti - 1]?.uptoKwh)
            ) {
              add(
                ['components', index, 'rates', ri, 'tiers', ti, 'uptoKwh'],
                'Tier boundaries must increase',
              );
            }
          });
          if (rate.tiers.at(-1)?.uptoKwh !== null)
            add(
              ['components', index, 'rates', ri, 'tiers'],
              'Exactly one trailing open-ended tier required',
            );
        });
        if (!rateWindows.has('ANY'))
          for (const window of windows) {
            if (window !== 'ANY' && !rateWindows.has(window))
              add(
                ['components', index, 'rates'],
                `Missing rate for window ${window}`,
              );
          }
      }
      if (item.kind === 'PERCENT')
        item.ofComponents.forEach((ref, ri) => {
          if (!seen.has(ref))
            add(
              ['components', index, 'ofComponents', ri],
              'Percent reference must name an earlier component',
            );
        });
      if (
        item.kind === 'PERCENT' &&
        item.portion === 'ABOVE_THRESHOLD_SHARE' &&
        item.applyIfConsumptionAboveKwh === undefined
      )
        add(
          ['components', index, 'applyIfConsumptionAboveKwh'],
          'Above-threshold share requires a threshold',
        );
      seen.add(item.code);
    });
    rules.nem?.offsetComponents.forEach((ref, index) => {
      if (
        !rules.components.some(
          (item) =>
            item.code === ref &&
            (item.kind === 'PER_KWH' || item.kind === 'PER_KWH_MONTHLY'),
        )
      )
        add(
          ['nem', 'offsetComponents', index],
          'Offset component must be an energy component',
        );
    });
  });

export type TariffRulesV1 = z.infer<typeof TariffRulesV1Schema>;
export function parseRules(json: unknown): TariffRulesV1 {
  return TariffRulesV1Schema.parse(json);
}
