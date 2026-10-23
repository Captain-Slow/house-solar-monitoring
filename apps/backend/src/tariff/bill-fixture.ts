import { Decimal } from 'decimal.js';
import { DateTime } from 'luxon';
import { z } from 'zod';
import { computeBill } from './engine.js';
import type { TariffRulesV1 } from './rules.schema.js';
import type { BillContext, BillResult, MonthlyRateRow } from './types.js';
const D = Decimal.clone({ precision: 30, rounding: Decimal.ROUND_HALF_UP });

const kwh = z.string().regex(/^\d{1,9}(\.\d{1,12})?$/);
const amount = z.string().regex(/^-?\d{1,9}\.\d{2}$/);
const date = z.iso.date();
const lot = z.strictObject({ originStart: date, kwh });
/** Strict top-level and nested objects reject identifying account/address/name/meter fields. */
export const BillFixtureSchema = z
  .strictObject({
    /** Harness marker only; never used to verify or price a bill. */
    synthetic: z.boolean().optional(),
    periodStartDate: date,
    periodEndDate: date,
    importPeakKwh: kwh,
    importOffpeakKwh: kwh,
    exportKwh: kwh,
    importByMonth: z
      .array(
        z.strictObject({
          month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
          kwh,
        }),
      )
      .optional(),
    importByWindow: z
      .array(z.strictObject({ window: z.string().min(1), kwh }))
      .optional(),
    exportByWindow: z
      .array(z.strictObject({ window: z.string().min(1), kwh }))
      .optional(),
    lines: z.array(z.strictObject({ code: z.string().min(1), amount })),
    total: amount,
    openingLots: z.array(lot),
    closingLots: z.array(lot),
  })
  .refine((bill) => bill.periodEndDate >= bill.periodStartDate, {
    path: ['periodEndDate'],
    message: 'End precedes start',
  });
export type BillFixture = z.infer<typeof BillFixtureSchema>;

export function reproduceBill(
  fixture: BillFixture,
  rules: TariffRulesV1,
  ctx: { holidays: ReadonlySet<string>; monthlyRates: MonthlyRateRow[] },
): {
  ok: boolean;
  refusals: string[];
  mismatches: { line: string; expected: string; actual: string }[];
  result: BillResult | null;
} {
  const bill = BillFixtureSchema.parse(fixture);
  const days =
    DateTime.fromISO(bill.periodEndDate).diff(
      DateTime.fromISO(bill.periodStartDate),
      'days',
    ).days + 1;
  const peak = new D(bill.importPeakKwh);
  const offpeak = new D(bill.importOffpeakKwh);
  const exported = new D(bill.exportKwh);
  const startMonth = bill.periodStartDate.slice(0, 7);
  const endMonth = bill.periodEndDate.slice(0, 7);
  const imports = bill.importByWindow ?? [
    {
      window: rules.touWindows[0]?.code ?? rules.defaultWindow,
      kwh: bill.importPeakKwh,
    },
    { window: rules.defaultWindow, kwh: bill.importOffpeakKwh },
  ];
  const refusals: string[] = [];
  if (
    rules.components.some(
      (component) => component.kind === 'PER_KWH_MONTHLY',
    ) &&
    startMonth !== endMonth &&
    !bill.importByMonth
  )
    refusals.push('MONTHLY_SPLIT_REQUIRED');
  if (rules.touWindows.length > 1 && peak.gt(0) && !bill.importByWindow)
    refusals.push('IMPORT_WINDOW_SPLIT_REQUIRED');
  if (
    rules.nem &&
    exported.gt(0) &&
    (rules.nem.touOffset === 'SAME_WINDOW_FIRST' ||
      rules.touWindows.length > 0) &&
    !bill.exportByWindow
  )
    refusals.push('EXPORT_WINDOW_SPLIT_REQUIRED');
  const months = bill.importByMonth ?? [
    { month: startMonth, kwh: peak.plus(offpeak).toString() },
  ];
  const withinPeriod = new Set<string>();
  let cursor = DateTime.fromISO(`${startMonth}-01`);
  while (cursor.toFormat('yyyy-MM') <= endMonth) {
    withinPeriod.add(cursor.toFormat('yyyy-MM'));
    cursor = cursor.plus({ months: 1 });
  }
  if (
    bill.importByMonth &&
    (months.some((item) => !withinPeriod.has(item.month)) ||
      new Set(months.map((item) => item.month)).size !== months.length ||
      withinPeriod.size !== months.length)
  )
    refusals.push('MONTHLY_SPLIT_INVALID');
  if (
    bill.importByMonth &&
    D.sum(0, ...months.map((item) => new D(item.kwh)))
      .minus(peak.plus(offpeak))
      .abs()
      .gt('0.001')
  )
    refusals.push('IMPORT_MONTH_SPLIT_INCONSISTENT');
  const allowedWindows = new Set([
    rules.defaultWindow,
    ...rules.touWindows.map((item) => item.code),
  ]);
  if (imports.some((item) => !allowedWindows.has(item.window)))
    refusals.push('IMPORT_WINDOW_SPLIT_INVALID');
  if (bill.importByWindow) {
    const byDefault = D.sum(
      0,
      ...imports
        .filter((item) => item.window === rules.defaultWindow)
        .map((item) => new D(item.kwh)),
    );
    const byPeak = D.sum(
      0,
      ...imports
        .filter((item) => item.window !== rules.defaultWindow)
        .map((item) => new D(item.kwh)),
    );
    if (
      byDefault.minus(offpeak).abs().gt('0.001') ||
      byPeak.minus(peak).abs().gt('0.001')
    )
      refusals.push('IMPORT_WINDOW_SPLIT_INCONSISTENT');
  }
  const exports = bill.exportByWindow ?? [
    { window: rules.defaultWindow, kwh: bill.exportKwh },
  ];
  if (exports.some((item) => !allowedWindows.has(item.window)))
    refusals.push('EXPORT_WINDOW_SPLIT_INVALID');
  if (
    bill.exportByWindow &&
    D.sum(0, ...exports.map((item) => new D(item.kwh)))
      .minus(exported)
      .abs()
      .gt('0.001')
  )
    refusals.push('EXPORT_WINDOW_SPLIT_INCONSISTENT');
  if (refusals.length)
    return { ok: false, refusals, mismatches: [], result: null };
  const context: BillContext = {
    coverage: 1,
    periodDays: days,
    periodStartDate: bill.periodStartDate,
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
  const result = computeBill({
    segments: [
      {
        versionId: 1,
        rules,
        quantities: {
          startDate: bill.periodStartDate,
          endDate: bill.periodEndDate,
          days,
          windows: [...allowedWindows].map((window) => ({
            window,
            importKwh: D.sum(
              0,
              ...imports
                .filter((item) => item.window === window)
                .map((item) => new D(item.kwh)),
            ),
            exportKwh: D.sum(
              0,
              ...exports
                .filter((item) => item.window === window)
                .map((item) => new D(item.kwh)),
            ),
          })),
          importByMonth: Object.fromEntries(
            months.map((item) => [item.month, new D(item.kwh)]),
          ),
        },
      },
    ],
    monthlyRates: ctx.monthlyRates,
    nemOpening: {
      lots: bill.openingLots.map((entry) => ({
        originStart: entry.originStart,
        kwh: new D(entry.kwh),
      })),
    },
    context,
  });
  const mismatches: { line: string; expected: string; actual: string }[] = [];
  for (const printed of bill.lines) {
    const calculated = result.lineItems.filter(
      (line) => line.code === printed.code,
    );
    const actual =
      calculated.some((line) => line.amount === null) || calculated.length === 0
        ? null
        : calculated
            .reduce((total, line) => total.plus(line.amount!), new D(0))
            .toFixed(2);
    if (actual === null || new D(printed.amount).minus(actual).abs().gt('0.01'))
      mismatches.push({
        line: printed.code,
        expected: printed.amount,
        actual: actual ?? 'UNAVAILABLE',
      });
  }
  for (const line of result.lineItems)
    if (!bill.lines.some((printed) => printed.code === line.code))
      mismatches.push({
        line: line.code,
        expected: 'MISSING',
        actual: line.amount ?? 'UNAVAILABLE',
      });
  if (
    result.total === null ||
    new D(bill.total).minus(result.total).abs().gt('0.01')
  )
    mismatches.push({
      line: 'TOTAL',
      expected: bill.total,
      actual: result.total ?? 'UNAVAILABLE',
    });
  const actualLots = result.nem?.closingLots ?? [];
  for (const printed of bill.closingLots) {
    const actual = actualLots
      .filter((entry) => entry.originStart === printed.originStart)
      .reduce((total, entry) => total.plus(entry.kwh), new D(0));
    if (actual.minus(printed.kwh).abs().gt('0.001'))
      mismatches.push({
        line: `NEM:${printed.originStart}`,
        expected: printed.kwh,
        actual: actual.toFixed(3),
      });
  }
  for (const actual of actualLots)
    if (
      !bill.closingLots.some(
        (printed) => printed.originStart === actual.originStart,
      )
    )
      mismatches.push({
        line: `NEM:${actual.originStart}`,
        expected: 'MISSING',
        actual: actual.kwh,
      });
  return { ok: mismatches.length === 0, refusals, mismatches, result };
}
