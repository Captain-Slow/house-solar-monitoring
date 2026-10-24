import { Inject, Injectable } from '@nestjs/common';
import { GraphQLError } from 'graphql';
import { DateTime } from 'luxon';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../db/prisma.service.js';
import { Prisma, type EnergyInterval } from '../generated/prisma/client.js';
import { APP_ENV } from '../config/env.token.js';
import type { Env } from '../config/env.js';
import {
  COUNTER_KEYS,
  DEFAULT_MAX_GAP_SEC,
  LEDGER_ALGO_VERSION,
  LedgerFlag,
  type PolicySegment,
} from './types.js';
import { gridMeterCoveredSec } from './families.js';
import { accountingStart, selectSegment } from './policy.js';
import { parseRules, type TariffRulesV1 } from '../tariff/rules.schema.js';
import { windowFor } from '../tariff/tou.js';

export type Granularity = 'DAY' | 'WEEK' | 'MONTH' | 'YEAR';
export type Quantity =
  | 'solar'
  | 'consumption'
  | 'gridImport'
  | 'gridExport'
  | 'batteryCharge'
  | 'batteryDischarge';
const QUANTITIES: Quantity[] = [
  'solar',
  'consumption',
  'gridImport',
  'gridExport',
  'batteryCharge',
  'batteryDischarge',
];
export type Provenance =
  | 'MEASURED_INTEGRATED'
  | 'DEVICE_COUNTER'
  | 'DERIVED'
  | 'ESTIMATED'
  | 'VENDOR_SUMMARY';
export interface EnergyValue {
  kwh: string | null;
  provenance: Provenance;
  source: string;
  validated: boolean;
  coverage: Decimal;
  status: 'OK' | 'PARTIAL' | 'UNAVAILABLE';
  flags: string[];
}
export interface VendorValue {
  kwh: string | null;
  provenance: 'DEVICE_COUNTER' | 'VENDOR_SUMMARY';
}
export interface VendorComparison {
  lifetime: Record<Quantity, VendorValue>;
  intervalDelta: Record<Quantity, VendorValue>;
  vendorToday: Record<Quantity, VendorValue>;
}
export interface WindowEnergy {
  window: string;
  importKwh: EnergyValue;
  exportKwh: EnergyValue;
}
export interface EnergyRow {
  periodStart: string;
  periodEnd: string;
  solar: EnergyValue;
  consumption: EnergyValue;
  gridImport: EnergyValue;
  gridExport: EnergyValue;
  batteryCharge: EnergyValue;
  batteryDischarge: EnergyValue;
  gridByWindow: WindowEnergy[];
  vendor: VendorComparison;
}
export interface EnergyTotals {
  monitoringSince: Date | null;
  preMonitoringExcluded: boolean;
  lastSourceUpdate: Date | null;
  rows: EnergyRow[];
  total: EnergyRow;
}

export function accountingInputError(message: string): never {
  throw new GraphQLError(message, { extensions: { code: 'BAD_USER_INPUT' } });
}

const CANDIDATE_FIELDS: Record<
  Quantity,
  Record<string, keyof EnergyInterval>
> = {
  solar: { COUNTER: 'pvCounterWh', INTEGRATED: 'pvIntWh' },
  consumption: { DERIVED: 'loadDerivedWh', VENDOR_COUNTER: 'loadCounterWh' },
  gridImport: {
    METER_NET: 'gridImportNetWh',
    METER_PER_PHASE: 'gridImportPhaseWh',
    INVERTER_COUNTER: 'gridImportCounterWh',
  },
  gridExport: {
    METER_NET: 'gridExportNetWh',
    METER_PER_PHASE: 'gridExportPhaseWh',
    INVERTER_COUNTER: 'gridExportCounterWh',
  },
  batteryCharge: {
    COUNTER: 'batChargeCounterWh',
    INTEGRATED: 'batChargeIntWh',
  },
  batteryDischarge: {
    COUNTER: 'batDischargeCounterWh',
    INTEGRATED: 'batDischargeIntWh',
  },
};
const COUNTER_INDEX: Record<Quantity, number> = {
  solar: COUNTER_KEYS.indexOf('PV'),
  consumption: COUNTER_KEYS.indexOf('LOAD_USE'),
  gridImport: COUNTER_KEYS.indexOf('GRID_BUY'),
  gridExport: COUNTER_KEYS.indexOf('GRID_SELL'),
  batteryCharge: COUNTER_KEYS.indexOf('BAT_CHARGE'),
  batteryDischarge: COUNTER_KEYS.indexOf('BAT_DISCHARGE'),
};
const FLAG_ENTRIES = Object.entries(LedgerFlag);
const DEFAULT_POLICY: PolicySegment = {
  version: 0,
  effectiveFrom: new Date(0),
  supersededByVersion: null,
  gridSource: 'METER_NET',
  pvSource: 'INTEGRATED',
  batterySource: 'INTEGRATED',
  loadSource: 'DERIVED',
  maxGapSec: DEFAULT_MAX_GAP_SEC,
  validated: {},
  note: '',
};

function sourceFor(policy: PolicySegment, quantity: Quantity) {
  const family = quantity.startsWith('grid')
    ? 'grid'
    : quantity.startsWith('battery')
      ? 'battery'
      : quantity === 'solar'
        ? 'pv'
        : 'load';
  const source =
    family === 'grid'
      ? policy.gridSource
      : family === 'battery'
        ? policy.batterySource
        : family === 'pv'
          ? policy.pvSource
          : policy.loadSource;
  const counter =
    source === 'COUNTER' ||
    source === 'VENDOR_COUNTER' ||
    source === 'INVERTER_COUNTER';
  const index = counter ? COUNTER_INDEX[quantity] : -1;
  // The grid family's coverage depends on the selected candidate (see gridMeterCoveredSec).
  const coverageField:
    'pvCoveredSec' | 'batCoveredSec' | 'loadCoveredSec' | null =
    family === 'grid'
      ? null
      : family === 'pv'
        ? 'pvCoveredSec'
        : family === 'battery'
          ? 'batCoveredSec'
          : 'loadCoveredSec';
  return {
    source,
    family,
    field: CANDIDATE_FIELDS[quantity][source]!,
    counter,
    index,
    coverageField,
  };
}

function chosenPolicy(policies: PolicySegment[], time: Date): PolicySegment {
  return selectSegment(policies, time) ?? DEFAULT_POLICY;
}

interface TimeSpan {
  start: number;
  end: number;
  flags?: string[];
}

function valueFor(
  quantity: Quantity,
  rows: EnergyInterval[],
  policies: PolicySegment[],
  start: Date,
  end: Date,
  monitoringSince: Date | null,
  spans?: TimeSpan[],
): EnergyValue {
  const used = new Set<string>();
  const flags = new Set<string>();
  let wh = new Decimal(0);
  let covered = 0;
  let counterUsed = false;
  let derivedUsed = false;
  let estimated = false;
  const effectiveStart = Math.max(
    start.getTime(),
    monitoringSince?.getTime() ?? end.getTime(),
  );
  const ranges = spans ?? [{ start: start.getTime(), end: end.getTime() }];
  let duration = 0;
  let validated = true;
  const initial = sourceFor(
    chosenPolicy(policies, new Date(effectiveStart)),
    quantity,
  );
  for (const range of ranges) {
    const begin = Math.max(effectiveStart, range.start);
    if (begin >= range.end) continue;
    duration += (range.end - begin) / 1000;
    const include = (policy: PolicySegment) => {
      const choice = sourceFor(policy, quantity);
      used.add(choice.source);
      validated &&= policy.validated[choice.family] === true;
      counterUsed ||= choice.counter;
      derivedUsed ||= choice.source === 'DERIVED';
    };
    include(chosenPolicy(policies, new Date(begin)));
    for (const policy of policies)
      if (
        policy.effectiveFrom.getTime() > begin &&
        policy.effectiveFrom.getTime() < range.end
      )
        include(policy);
  }
  validated &&= duration > 0;
  for (const row of rows) {
    const policy = chosenPolicy(policies, row.bucketStart);
    const choice = sourceFor(policy, quantity);
    const raw = row[choice.field];
    // The candidate columns are Decimal(12,3); anything else (null) is unknown and adds nothing.
    if (raw instanceof Prisma.Decimal) {
      wh = wh.plus(raw.toFixed());
      const bucketStart = row.bucketStart.getTime();
      const overlap = Math.max(
        0,
        (Math.min(end.getTime(), bucketStart + 300_000) -
          Math.max(effectiveStart, bucketStart)) /
          1000,
      );
      if (choice.counter) {
        const unknown = Math.min(
          300,
          Math.max(0, row.counterUnknownSec[choice.index] ?? 300),
        );
        covered += Math.max(0, overlap - unknown);
        if (row.counterGapAllocMask & (1 << choice.index)) estimated = true;
      } else
        covered += Math.min(
          overlap,
          Math.max(
            0,
            choice.coverageField === null
              ? gridMeterCoveredSec(row, choice.source)
              : row[choice.coverageField],
          ),
        );
    }
    for (const [name, bit] of FLAG_ENTRIES)
      if (name !== 'STALE_CALC_PARAMS' && row.flags & bit) flags.add(name);
    if (
      row.calcVersion !== LEDGER_ALGO_VERSION ||
      row.maxGapSecUsed !== policy.maxGapSec
    )
      flags.add('STALE_CALC_PARAMS');
  }
  const coverage = new Decimal(duration ? Math.min(1, covered / duration) : 0);
  const status = coverage.gte('0.995')
    ? 'OK'
    : coverage.gt(0)
      ? 'PARTIAL'
      : 'UNAVAILABLE';
  const source = [...used].join('+') || initial.source;
  return {
    kwh: status === 'UNAVAILABLE' ? null : wh.div(1000).toFixed(3),
    provenance: estimated
      ? 'ESTIMATED'
      : counterUsed
        ? 'DEVICE_COUNTER'
        : derivedUsed
          ? 'DERIVED'
          : 'MEASURED_INTEGRATED',
    source,
    validated,
    coverage,
    status,
    flags: [...flags],
  };
}

interface VendorDay {
  day: string;
  first: Partial<Record<Quantity, { id: bigint; value: bigint }>>;
  last: Partial<Record<Quantity, { id: bigint; value: bigint }>>;
  today: Partial<Record<Quantity, Decimal>>;
}
function vendorComparison(days: VendorDay[]): VendorComparison {
  const lifetime = {} as Record<Quantity, VendorValue>;
  const intervalDelta = {} as Record<Quantity, VendorValue>;
  const vendorToday = {} as Record<Quantity, VendorValue>;
  for (const q of QUANTITIES) {
    const first = days.find((day) => day.first[q] !== undefined)?.first[q];
    const last = days.findLast((day) => day.last[q] !== undefined)?.last[q];
    lifetime[q] = {
      kwh: last
        ? new Decimal(last.value.toString()).div(1000).toFixed(3)
        : null,
      provenance: 'DEVICE_COUNTER',
    };
    intervalDelta[q] = {
      kwh:
        first && last && first.id !== last.id
          ? new Decimal((last.value - first.value).toString())
              .div(1000)
              .toFixed(3)
          : null,
      provenance: 'DEVICE_COUNTER',
    };
    const values = days.flatMap((day) =>
      day.today[q] === undefined ? [] : [day.today[q]],
    );
    vendorToday[q] = {
      kwh: values.length
        ? values
            .reduce((sum, n) => sum.plus(n), new Decimal(0))
            .div(1000)
            .toFixed(3)
        : null,
      provenance: 'VENDOR_SUMMARY',
    };
  }
  return { lifetime, intervalDelta, vendorToday };
}

@Injectable()
export class TotalsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  private async tariffWindows(
    tariffId: number,
    from: DateTime,
    to: DateTime,
    intervals: EnergyInterval[],
  ) {
    const tariff = await this.prisma.tariff.findUnique({
      where: { id: tariffId },
    });
    if (!tariff) accountingInputError('Tariff not found');
    const firstDay = from.setZone(tariff.timezone).toISODate()!;
    const lastDay = to
      .minus({ milliseconds: 1 })
      .setZone(tariff.timezone)
      .toISODate()!;
    const [versions, holidays] = await Promise.all([
      this.prisma.tariffVersion.findMany({
        where: {
          tariffId,
          effectiveFrom: { lte: new Date(lastDay) },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: new Date(firstDay) } },
          ],
        },
        orderBy: { effectiveFrom: 'asc' },
      }),
      this.prisma.tariffHoliday.findMany({
        where: {
          tariffId,
          date: {
            gte: new Date(`${firstDay.slice(0, 4)}-01-01`),
            lte: new Date(`${lastDay.slice(0, 4)}-12-31`),
          },
        },
      }),
    ]);
    const holidaySet = new Set(
      holidays.map((holiday) => holiday.date.toISOString().slice(0, 10)),
    );
    const holidayYears = new Set(
      [...holidaySet].map((date) => date.slice(0, 4)),
    );
    const rules = new Map<number, TariffRulesV1>();
    const groups = new Map<
      string,
      { spans: TimeSpan[]; buckets: Set<number> }
    >();
    const endMs = to.toMillis();
    let versionIndex = 0;
    let rowIndex = 0;
    // Split ordinary days only at rule boundaries; DST transition days follow
    // UTC buckets so skipped/repeated wall-clock hours match billing exactly.
    for (let time = from.toMillis(); time < endMs;) {
      const instant = new Date(time);
      const local = DateTime.fromJSDate(instant, { zone: tariff.timezone });
      const date = local.toISODate()!;
      while (
        versionIndex < versions.length &&
        versions[versionIndex]!.effectiveTo !== null &&
        versions[versionIndex]!.effectiveTo!.toISOString().slice(0, 10) < date
      )
        versionIndex++;
      const version = versions[versionIndex];
      if (!version || version.effectiveFrom.toISOString().slice(0, 10) > date)
        accountingInputError(
          `Tariff ${tariffId} has no effective version for ${date}`,
        );
      let activeRules = rules.get(version.id);
      if (!activeRules) {
        activeRules = parseRules(version.rules);
        rules.set(version.id, activeRules);
      }
      const window = windowFor(instant, activeRules, holidaySet);
      let group = groups.get(window);
      if (!group) {
        group = { spans: [], buckets: new Set() };
        groups.set(window, group);
      }
      const flags =
        activeRules.touWindows.some((entry) => entry.excludeHolidays) &&
        !holidayYears.has(date.slice(0, 4))
          ? ['HOLIDAY_CALENDAR_MISSING']
          : [];
      const dayStart = local.startOf('day');
      const dayEnd = dayStart.plus({ days: 1 });
      let end = Math.min(endMs, dayEnd.toMillis());
      if (dayStart.offset !== dayEnd.offset)
        end = Math.min(end, (Math.floor(time / 300_000) + 1) * 300_000);
      else
        for (const entry of activeRules.touWindows)
          for (const clock of [entry.start, entry.end]) {
            const boundary = DateTime.fromISO(`${date}T${clock}`, {
              zone: tariff.timezone,
            }).toMillis();
            if (boundary > time && boundary < end) end = boundary;
          }
      const previous = group.spans.at(-1);
      if (previous?.end === time && previous.flags?.length === flags.length)
        previous.end = end;
      else group.spans.push({ start: time, end, flags });
      while (
        rowIndex < intervals.length &&
        intervals[rowIndex]!.bucketStart.getTime() < end
      ) {
        group.buckets.add(intervals[rowIndex]!.bucketStart.getTime());
        rowIndex++;
      }
      time = end;
    }
    return groups;
  }

  private async vendorDays(
    from: Date,
    to: Date,
    timezone: string,
  ): Promise<VendorDay[]> {
    const daySql = Prisma.sql`to_char(("observedAt" AT TIME ZONE ${timezone})::date, 'YYYY-MM-DD')`;
    const names: Record<Quantity, string> = {
      solar: 'pv_today_energy',
      consumption: 'load_energy_today',
      gridImport: 'grid_buy_today',
      gridExport: 'grid_sell_today',
      batteryCharge: 'bat_charge_today',
      batteryDischarge: 'bat_discharge_today',
    };
    const columns = Prisma.join(
      QUANTITIES.map(
        (q) =>
          Prisma.sql`MAX(("vendorToday"->>${names[q]})::numeric) AS ${Prisma.raw(`"${q}"`)}`,
      ),
    );
    const daily = await this.prisma.$queryRaw<
      Array<{ day: string } & Record<Quantity, Decimal | null>>
    >(Prisma.sql`
      SELECT ${daySql} AS day, ${columns}
      FROM "Sample" WHERE "observedAt" >= ${from} AND "observedAt" < ${to}
      GROUP BY day ORDER BY day`);
    const days = daily.map((row): VendorDay => ({
      day: row.day,
      first: {},
      last: {},
      today: Object.fromEntries(
        QUANTITIES.filter((q) => row[q] !== null).map((q) => [
          q,
          new Decimal(String(row[q])),
        ]),
      ),
    }));
    const byDay = new Map(days.map((day) => [day.day, day]));
    const fields: Record<Quantity, string> = {
      solar: 'pvWh',
      consumption: 'loadUseWh',
      gridImport: 'gridBuyWh',
      gridExport: 'gridSellWh',
      batteryCharge: 'batChargeWh',
      batteryDischarge: 'batDischargeWh',
    };
    for (const quantity of QUANTITIES) {
      const field = Prisma.raw(`"${fields[quantity]}"`);
      const source = Prisma.sql`SELECT ${daySql} AS day, id, "observedAt", ${field} AS value
        FROM "Sample" WHERE "observedAt" >= ${from} AND "observedAt" < ${to} AND ${field} IS NOT NULL`;
      const edges = await this.prisma.$queryRaw<
        Array<{ edge: string; day: string; id: bigint; value: bigint }>
      >(Prisma.sql`
        SELECT 'first' AS edge, day, id, value FROM (
          SELECT DISTINCT ON (day) day, id, value FROM (${source}) s ORDER BY day, "observedAt", id
        ) first_rows
        UNION ALL
        SELECT 'last' AS edge, day, id, value FROM (
          SELECT DISTINCT ON (day) day, id, value FROM (${source}) s ORDER BY day, "observedAt" DESC, id DESC
        ) last_rows`);
      for (const edge of edges) {
        const day = byDay.get(edge.day);
        if (day)
          day[edge.edge === 'first' ? 'first' : 'last'][quantity] = {
            id: edge.id,
            value: edge.value,
          };
      }
    }
    return days;
  }

  async energyTotals(
    fromDate: string,
    toDate: string,
    granularity: Granularity,
    tariffId?: number | null,
    timezone = this.env.SITE_TIMEZONE,
  ): Promise<EnergyTotals> {
    const from = DateTime.fromISO(fromDate, { zone: timezone });
    const to = DateTime.fromISO(toDate, { zone: timezone });
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(fromDate) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(toDate) ||
      !from.isValid ||
      !to.isValid ||
      from.toISODate() !== fromDate ||
      to.toISODate() !== toDate ||
      from > to ||
      !['DAY', 'WEEK', 'MONTH', 'YEAR'].includes(granularity)
    )
      accountingInputError('Invalid local date range or granularity');
    const end = to.plus({ days: 1 });
    const boundaries: Array<[DateTime, DateTime]> = [];
    let cursor = from;
    while (cursor < end && boundaries.length <= 1000) {
      const next =
        granularity === 'DAY'
          ? cursor.plus({ days: 1 })
          : granularity === 'WEEK'
            ? cursor.startOf('week').plus({ weeks: 1 })
            : granularity === 'MONTH'
              ? cursor.startOf('month').plus({ months: 1 })
              : cursor.startOf('year').plus({ years: 1 });
      const stop = next < end ? next : end;
      boundaries.push([cursor, stop]);
      cursor = stop;
    }
    if (boundaries.length > 1000)
      accountingInputError('Energy totals exceed 1000 rows');
    if (tariffId != null && (!Number.isSafeInteger(tariffId) || tariffId <= 0))
      accountingInputError('tariffId must be a positive integer');
    const startUtc = from.toJSDate(),
      endUtc = end.toJSDate();
    const [intervals, policyRows, policyStart, earliest, latest] =
      await Promise.all([
        this.prisma.energyInterval.findMany({
          where: { bucketStart: { gte: startUtc, lt: endUtc } },
          orderBy: { bucketStart: 'asc' },
        }),
        this.prisma.accountingPolicy.findMany({
          where: { supersededByVersion: null, effectiveFrom: { lt: endUtc } },
          orderBy: { effectiveFrom: 'asc' },
        }),
        accountingStart(this.prisma),
        this.prisma.sample.findFirst({
          orderBy: { observedAt: 'asc' },
          select: { observedAt: true },
        }),
        this.prisma.sample.findFirst({
          orderBy: { observedAt: 'desc' },
          select: { observedAt: true },
        }),
      ]);
    const monitoringSince = policyStart ?? earliest?.observedAt ?? null;
    const policies: PolicySegment[] = policyRows.map((p) => ({
      ...p,
      gridSource: p.gridSource as PolicySegment['gridSource'],
      pvSource: p.pvSource as PolicySegment['pvSource'],
      batterySource: p.batterySource as PolicySegment['batterySource'],
      loadSource: p.loadSource as PolicySegment['loadSource'],
      validated:
        p.validated &&
        typeof p.validated === 'object' &&
        !Array.isArray(p.validated)
          ? Object.fromEntries(
              Object.entries(p.validated).map(([k, v]) => [k, v === true]),
            )
          : {},
    }));
    const days = await this.vendorDays(startUtc, endUtc, timezone);
    const windows =
      tariffId == null
        ? null
        : await this.tariffWindows(tariffId, from, end, intervals);
    let intervalCursor = 0,
      dayCursor = 0;
    const build = (a: DateTime, b: DateTime, whole = false): EnergyRow => {
      const start = a.toJSDate(),
        finish = b.toJSDate();
      const intervalBegin = intervalCursor,
        dayBegin = dayCursor;
      const startDay = a.toISODate()!,
        endDay = b.toISODate()!;
      if (!whole) {
        while (
          intervalCursor < intervals.length &&
          intervals[intervalCursor]!.bucketStart < finish
        )
          intervalCursor++;
        while (dayCursor < days.length && days[dayCursor]!.day < endDay)
          dayCursor++;
      }
      const relevant = whole
        ? intervals
        : intervals.slice(intervalBegin, intervalCursor);
      const observed = whole ? days : days.slice(dayBegin, dayCursor);
      const values = Object.fromEntries(
        QUANTITIES.map((q) => [
          q,
          valueFor(q, relevant, policies, start, finish, monitoringSince),
        ]),
      ) as Record<Quantity, EnergyValue>;
      return {
        periodStart: startDay,
        periodEnd: endDay,
        ...values,
        gridByWindow:
          windows === null
            ? []
            : [...windows].flatMap(([window, group]) => {
                const spans = group.spans.flatMap((span) => {
                  const begin = Math.max(span.start, start.getTime());
                  const end = Math.min(span.end, finish.getTime());
                  return begin < end ? [{ ...span, start: begin, end }] : [];
                });
                if (spans.length === 0) return [];
                const selected = relevant.filter((row) =>
                  group.buckets.has(row.bucketStart.getTime()),
                );
                const windowValue = (quantity: 'gridImport' | 'gridExport') => {
                  const value = valueFor(
                    quantity,
                    selected,
                    policies,
                    start,
                    finish,
                    monitoringSince,
                    spans,
                  );
                  value.flags = [
                    ...new Set([
                      ...value.flags,
                      ...spans.flatMap((span) => span.flags ?? []),
                    ]),
                  ];
                  if (value.provenance === 'ESTIMATED')
                    value.flags.push('TOU_ALLOCATION_ESTIMATED');
                  return value;
                };
                return [
                  {
                    window,
                    importKwh: windowValue('gridImport'),
                    exportKwh: windowValue('gridExport'),
                  },
                ];
              }),
        vendor: vendorComparison(observed),
      };
    };
    const rows = boundaries.map(([a, b]) => build(a, b));
    const total = build(from, end, true);
    return {
      monitoringSince,
      preMonitoringExcluded: !!monitoringSince && startUtc < monitoringSince,
      lastSourceUpdate: latest?.observedAt ?? null,
      rows,
      total,
    };
  }
}
