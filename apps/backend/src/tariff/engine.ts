import { Decimal } from 'decimal.js';
import type {
  BillContext,
  BillResult,
  LineItem,
  MonthlyRateRow,
  NemOpening,
  NemResult,
  SegmentQuantities,
} from './types.js';
import { BillingReason } from './types.js';
import type { TariffRulesV1 } from './rules.schema.js';

const D = Decimal.clone({ precision: 30, rounding: Decimal.ROUND_HALF_UP });
const ZERO = new D(0);
const money = (amount: Decimal) =>
  new D(amount).toDecimalPlaces(2, D.ROUND_HALF_UP).toFixed(2);
const energy = (amount: Decimal) =>
  new D(amount).toDecimalPlaces(3, D.ROUND_HALF_UP).toFixed(3);
const sum = (values: Decimal[]) =>
  values.reduce((total, value) => total.plus(value), ZERO);

export function isLowerBoundShape(rules: TariffRulesV1): boolean {
  if (rules.nem !== null || rules.consumptionBasis !== 'GROSS_IMPORT')
    return false;
  return rules.components.every((component) => {
    switch (component.kind) {
      case 'PER_KWH':
        return component.rates.every(
          (rate) =>
            rate.tiers.length === 1 &&
            rate.tiers[0]?.uptoKwh === null &&
            new D(rate.tiers[0].rate).gte(0),
        );
      case 'PER_KWH_MONTHLY':
        return true;
      case 'FIXED':
        return new D(component.amount).gte(0);
      case 'PERCENT':
        return new D(component.percent).gte(0) && component.portion === 'ALL';
    }
  });
}

export function isLowerBoundResult(
  rules: TariffRulesV1,
  monthlyRates: MonthlyRateRow[],
): boolean {
  return (
    isLowerBoundShape(rules) &&
    monthlyRates.every((rate) => new D(rate.ratePerKwh).gte(0))
  );
}

type Segment = {
  versionId: number;
  rules: TariffRulesV1;
  quantities: SegmentQuantities;
};
type Lot = { originStart: string; kwh: Decimal; window?: string; own: boolean };

/** The engine only uses quantities supplied by the ledger; it never contacts a device or service. */
export function computeBill(input: {
  segments: Segment[];
  monthlyRates: MonthlyRateRow[];
  nemOpening: NemOpening;
  context: BillContext;
}): BillResult {
  const { context, monthlyRates } = input;
  const reasons = new Set<string>();
  const isLowerBound =
    !context.touAllocationEstimated &&
    input.segments.length > 0 &&
    input.segments.every(
      ({ rules, quantities }) =>
        isLowerBoundResult(rules, monthlyRates) &&
        rules.components.every(
          (component) =>
            component.kind !== 'PER_KWH_MONTHLY' ||
            Object.keys(quantities.importByMonth).every((month) =>
              monthlyRates.some(
                (row) =>
                  row.componentCode === component.code && row.month === month,
              ),
            ),
        ),
    );
  const unavailable =
    context.noTariffVersion ||
    input.segments.length === 0 ||
    context.coverage < 0.8 ||
    context.entirelyBeforeMonitoring ||
    context.vendorDataOnly;
  if (unavailable) {
    if (context.noTariffVersion || input.segments.length === 0)
      reasons.add(BillingReason.NO_TARIFF_VERSION);
    if (context.coverage < 0.8) reasons.add(BillingReason.COVERAGE_BELOW_80);
    if (context.entirelyBeforeMonitoring)
      reasons.add(BillingReason.PERIOD_BEFORE_MONITORING);
    if (context.vendorDataOnly) reasons.add(BillingReason.VENDOR_DATA_ONLY);
    return {
      lineItems: [],
      nem: null,
      subtotal: null,
      total: null,
      status: 'UNAVAILABLE',
      isLowerBound: false,
      reasons: [...reasons],
    };
  }
  if (context.coverage < 0.995) {
    reasons.add(BillingReason.COVERAGE_BELOW_99_5);
    if (!isLowerBound)
      reasons.add(BillingReason.MISSING_DATA_DIRECTION_UNKNOWN);
  }
  if (context.periodInProgress) reasons.add(BillingReason.PERIOD_IN_PROGRESS);
  if (context.touAllocationEstimated)
    reasons.add(BillingReason.TOU_ALLOCATION_ESTIMATED);
  if (context.holidayCalendarMissing)
    reasons.add(BillingReason.HOLIDAY_CALENDAR_MISSING);
  if (!context.allVersionsBillVerified)
    reasons.add(BillingReason.TARIFF_NOT_BILL_VERIFIED);
  if (input.segments.length > 1)
    reasons.add(BillingReason.TARIFF_CHANGED_MID_PERIOD);
  if (context.calcParamsPartialRecompute)
    reasons.add(BillingReason.CALC_PARAMS_PARTIAL_RECOMPUTE);
  if (context.accountingUnreconciled)
    reasons.add(BillingReason.ACCOUNTING_UNRECONCILED);
  if (context.mappingProvisional)
    reasons.add(BillingReason.MAPPING_PROVISIONAL);
  if (context.startsBeforeMonitoring)
    reasons.add(BillingReason.PRE_MONITORING_DATA_MISSING);

  const lineItems: LineItem[] = [];
  const nemActive = input.segments.some(({ rules }) => rules.nem !== null);
  const openingLots =
    input.nemOpening.lots?.map((lot) => ({
      originStart: lot.originStart,
      kwh: new D(lot.kwh),
      own: false,
    })) ?? [];
  if (nemActive && input.nemOpening.lots === null)
    reasons.add(
      input.nemOpening.reason ?? BillingReason.NEM_OPENING_CREDIT_UNKNOWN,
    );
  else if (nemActive && input.nemOpening.estimated)
    reasons.add(BillingReason.NEM_OPENING_CREDIT_ESTIMATED);
  const lots: Lot[] = openingLots.map((lot) => ({ ...lot }));
  const expired: Lot[] = [];
  const consumed: Lot[] = [];
  const sortLots = (items: Lot[]) =>
    items.sort((a, b) => a.originStart.localeCompare(b.originStart));
  sortLots(lots);
  // Age is whole calendar-month boundaries between the origin period's start month and this period's start month.
  // This is a provisional interpretation of "periods" and must be checked against a real bill.
  const currentMonth =
    Number(context.periodStartDate.slice(0, 4)) * 12 +
    Number(context.periodStartDate.slice(5, 7));
  const firstNem = input.segments.find(({ rules }) => rules.nem !== null)?.rules
    .nem;
  if (firstNem)
    for (let i = lots.length - 1; i >= 0; i--) {
      const lot = lots[i];
      const originMonth =
        Number(lot.originStart.slice(0, 4)) * 12 +
        Number(lot.originStart.slice(5, 7));
      if (currentMonth - originMonth > firstNem.creditExpiryPeriods) {
        expired.push(lot);
        lots.splice(i, 1);
      }
    }

  input.segments.forEach(({ rules, quantities }, segment) => {
    const imports = new Map<string, Decimal>();
    const exports = new Map<string, Decimal>();
    for (const window of quantities.windows) {
      imports.set(
        window.window,
        (imports.get(window.window) ?? ZERO).plus(window.importKwh),
      );
      exports.set(
        window.window,
        (exports.get(window.window) ?? ZERO).plus(window.exportKwh),
      );
    }
    const gross = sum([...imports.values()]);
    const adjusted = new Map(imports);
    if (rules.nem) {
      // Segment export is newest. Window-local export selects which import window
      // receives credit first, while every debit still consumes the oldest lot.
      for (const [window, value] of exports)
        if (value.gt(0)) {
          lots.push({
            originStart: context.periodStartDate,
            kwh: value,
            window,
            own: true,
          });
        }
      const apply = (lot: Lot, window: string, amount: Decimal) => {
        if (amount.lte(0)) return;
        adjusted.set(window, (adjusted.get(window) ?? ZERO).minus(amount));
        lot.kwh = lot.kwh.minus(amount);
        const existing = consumed.find(
          (item) => item.originStart === lot.originStart,
        );
        if (existing) existing.kwh = existing.kwh.plus(amount);
        else
          consumed.push({
            originStart: lot.originStart,
            kwh: amount,
            own: lot.own,
          });
      };
      if (
        input.nemOpening.lots !== null &&
        rules.nem.touOffset === 'SAME_WINDOW_FIRST'
      ) {
        for (const [window, exported] of exports) {
          let remaining = D.min(
            exported,
            adjusted.get(window) ?? ZERO,
            sum(lots.map((lot) => lot.kwh)),
          );
          for (const lot of sortLots(lots)) {
            const use = D.min(lot.kwh, remaining);
            apply(lot, window, use);
            remaining = remaining.minus(use);
            if (remaining.isZero()) break;
          }
        }
      }
      if (input.nemOpening.lots !== null)
        for (const lot of sortLots(lots)) {
          const remaining = sum([...adjusted.values()]);
          if (remaining.lte(0) || lot.kwh.lte(0)) continue;
          const use = D.min(lot.kwh, remaining);
          const entries = [...adjusted.entries()].filter(([, value]) =>
            value.gt(0),
          );
          let allocated = ZERO;
          entries.forEach(([window, value], index) => {
            const share =
              index === entries.length - 1
                ? use.minus(allocated)
                : use.times(value).div(remaining);
            apply(lot, window, share);
            allocated = allocated.plus(share);
          });
        }
      for (let i = lots.length - 1; i >= 0; i--)
        if (lots[i].kwh.isZero()) lots.splice(i, 1);
    }
    const net = sum([...adjusted.values()]);
    const consumption = rules.consumptionBasis === 'GROSS_IMPORT' ? gross : net;
    // Thresholds are period-length adjusted first, then assigned to this segment by days.
    const scaled = (text: string) => {
      const threshold = new D(text);
      return (
        rules.thresholdProration === 'DAYS_OVER_30'
          ? threshold.times(context.periodDays).div(30)
          : threshold
      )
        .times(quantities.days)
        .div(context.periodDays);
    };
    const addLine = (item: Omit<LineItem, 'segment' | 'status'>) => {
      lineItems.push({
        ...item,
        segment,
        status: item.amount === null ? 'UNAVAILABLE' : 'OK',
      });
    };
    for (const component of rules.components) {
      if (component.kind === 'PER_KWH') {
        const bases = rules.nem?.offsetComponents.includes(component.code)
          ? adjusted
          : imports;
        const totalKwh = sum([...bases.values()]);
        const activeWindows = [...bases.values()].filter((amount) =>
          amount.gt(0),
        ).length;
        let value = ZERO;
        let splitTier = false;
        for (const [window, kwh] of bases) {
          const rate =
            component.rates.find((entry) => entry.window === window) ??
            component.rates.find((entry) => entry.window === 'ANY');
          if (!rate)
            throw new Error(
              `No rate for window ${window} in ${component.code}`,
            );
          if (component.tierMode === 'WHOLE') {
            const tier = rate.tiers.find(
              (entry) =>
                entry.uptoKwh === null ||
                consumption.lte(scaled(entry.uptoKwh)),
            );
            if (!tier)
              throw new Error(`No matching tier for ${component.code}`);
            value = value.plus(kwh.times(tier.rate));
          } else {
            let chargeableLeft = totalKwh;
            // The consumption range above each tier boundary selects higher-tier
            // kWh. For a non-offset component, gross chargeable import can exceed
            // NET_IMPORT consumption: that extra kWh belongs to the first tier.
            for (let index = 1; index < rate.tiers.length; index++) {
              const tier = rate.tiers[index];
              const lower = scaled(rate.tiers[index - 1].uptoKwh!);
              const upper =
                tier.uptoKwh === null ? consumption : scaled(tier.uptoKwh);
              const inTier = D.min(
                chargeableLeft,
                D.max(0, D.min(consumption, upper).minus(lower)),
              );
              chargeableLeft = chargeableLeft.minus(inTier);
              const quantity = totalKwh.isZero()
                ? ZERO
                : inTier.times(kwh).div(totalKwh);
              value = value.plus(quantity.times(tier.rate));
              if (activeWindows > 1 && quantity.gt(0)) splitTier = true;
            }
            const firstTier = rate.tiers[0];
            if (firstTier) {
              const firstQuantity = totalKwh.isZero()
                ? ZERO
                : chargeableLeft.times(kwh).div(totalKwh);
              value = value.plus(firstQuantity.times(firstTier.rate));
            }
          }
        }
        if (splitTier) reasons.add(BillingReason.TIER_SPLIT_PRO_RATA);
        addLine({
          code: component.code,
          label: component.label,
          kind: component.kind,
          quantityKwh: energy(totalKwh),
          rate: null,
          amount: money(value),
        });
      } else if (component.kind === 'PER_KWH_MONTHLY') {
        const enabled =
          component.applyIfConsumptionAboveKwh === undefined ||
          consumption.gt(scaled(component.applyIfConsumptionAboveKwh));
        const monthEntries = Object.entries(quantities.importByMonth);
        const importTotal = sum(monthEntries.map(([, kwh]) => kwh));
        for (const [month, monthImport] of monthEntries) {
          const rate = monthlyRates.find(
            (row) =>
              row.componentCode === component.code && row.month === month,
          );
          if (!rate)
            reasons.add(
              `${BillingReason.MONTHLY_RATE_MISSING}:${component.code}`,
            );
          const basis =
            rules.nem?.offsetComponents.includes(component.code) &&
            !importTotal.isZero()
              ? net.times(monthImport).div(importTotal)
              : monthImport;
          addLine({
            code: component.code,
            label: component.label,
            kind: component.kind,
            quantityKwh: energy(basis),
            rate: rate ? rate.ratePerKwh.toString() : null,
            amount: !rate
              ? null
              : money(enabled ? basis.times(rate.ratePerKwh) : ZERO),
            note: month,
          });
        }
      } else if (component.kind === 'FIXED') {
        const waived =
          component.waiveIfConsumptionAtOrBelowKwh !== undefined &&
          consumption.lte(scaled(component.waiveIfConsumptionAtOrBelowKwh));
        const value = waived
          ? ZERO
          : new D(component.amount).times(
              component.prorate ? new D(quantities.days).div(30) : 1,
            );
        addLine({
          code: component.code,
          label: component.label,
          kind: component.kind,
          quantityKwh: null,
          rate: component.amount,
          amount: money(value),
        });
      } else {
        const references = lineItems.filter(
          (item) =>
            item.segment === segment &&
            component.ofComponents.includes(item.code),
        );
        const threshold =
          component.applyIfConsumptionAboveKwh === undefined
            ? ZERO
            : scaled(component.applyIfConsumptionAboveKwh);
        const enabled =
          component.applyIfConsumptionAboveKwh === undefined ||
          consumption.gt(threshold);
        const portion =
          component.portion === 'ABOVE_THRESHOLD_SHARE' && !consumption.isZero()
            ? consumption.minus(threshold).div(consumption)
            : new D(1);
        addLine({
          code: component.code,
          label: component.label,
          kind: component.kind,
          quantityKwh: null,
          rate: component.percent,
          amount: references.some((item) => item.amount === null)
            ? null
            : money(
                enabled
                  ? sum(references.map((item) => new D(item.amount!)))
                      .times(component.percent)
                      .div(100)
                      .times(portion)
                  : ZERO,
              ),
        });
      }
    }
  });
  const asLots = (items: Lot[]) => {
    const byOrigin = new Map<string, Decimal>();
    for (const lot of items)
      if (!lot.kwh.isZero())
        byOrigin.set(
          lot.originStart,
          (byOrigin.get(lot.originStart) ?? ZERO).plus(lot.kwh),
        );
    return [...byOrigin]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([originStart, kwh]) => ({
        originStart,
        kwh: kwh.toFixed(Math.max(3, kwh.decimalPlaces())),
      }));
  };
  const nem: NemResult | null = nemActive
    ? {
        openingLots: asLots(openingLots),
        expiredLots: asLots(expired),
        consumedLots: asLots(consumed),
        closingLots: asLots(lots),
      }
    : null;
  const hasUnavailableLine = lineItems.some((line) => line.amount === null);
  let subtotal = hasUnavailableLine
    ? null
    : money(sum(lineItems.map((line) => new D(line.amount!))));
  let total = subtotal;
  if (
    subtotal !== null &&
    input.segments.at(-1)?.rules.totalRounding === 'NEAREST_0_05'
  ) {
    const rounded = new D(subtotal)
      .div('0.05')
      .toDecimalPlaces(0, D.ROUND_HALF_UP)
      .times('0.05');
    const adjustment = rounded.minus(subtotal);
    lineItems.push({
      code: 'ROUNDING',
      label: 'Rounding',
      kind: 'ROUNDING',
      segment: input.segments.length - 1,
      quantityKwh: null,
      rate: null,
      amount: money(adjustment),
      status: 'OK',
    });
    total = money(rounded);
  }
  return {
    lineItems,
    nem,
    subtotal,
    total,
    status: reasons.size ? 'ESTIMATED' : 'COMPLETE',
    isLowerBound,
    reasons: [...reasons],
  };
}
