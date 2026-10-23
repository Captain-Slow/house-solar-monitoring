import { createHash, type Hash } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  BeforeApplicationShutdown,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import { Decimal } from 'decimal.js';
import {
  Prisma,
  type BillingPeriod,
  type BillingPeriodResult,
  type TariffVersion,
} from '../generated/prisma/client.js';
import { PrismaService } from '../db/prisma.service.js';
import { APP_ENV } from '../config/env.token.js';
import type { Env } from '../config/env.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { selectSegment } from '../accounting/policy.js';
import {
  DEFAULT_MAX_GAP_SEC,
  LEDGER_ALGO_VERSION,
  LedgerFlag,
  type PolicySegment,
} from '../accounting/types.js';
import {
  BILLING_CALC_VERSION,
  BillingReason,
  NEM_CREDIT_ESTIMATE_REASONS,
  NEM_CREDIT_UNKNOWN_REASONS,
  type CreditLot,
  type NemOpening,
  type SegmentQuantities,
  type MonthlyRateRow,
} from './types.js';
import { parseRules, type TariffRulesV1 } from './rules.schema.js';
import { windowFor } from './tou.js';
import { computeBill } from './engine.js';
import { TariffError } from './tariff.service.js';

const DAY_MS = 86_400_000;
const ONE_HOUR_MS = 3_600_000;
const GRID_FIELDS = {
  METER_NET: ['gridImportNetWh', 'gridExportNetWh'],
  METER_PER_PHASE: ['gridImportPhaseWh', 'gridExportPhaseWh'],
  INVERTER_COUNTER: ['gridImportCounterWh', 'gridExportCounterWh'],
} as const;

function day(date: Date): string {
  return date.toISOString().slice(0, 10);
}
function localInstant(value: string, timezone: string): Date {
  return DateTime.fromISO(value, { zone: timezone }).startOf('day').toJSDate();
}
function afterDay(date: Date): string {
  return DateTime.fromISO(day(date), { zone: 'utc' })
    .plus({ days: 1 })
    .toISODate()!;
}
function lots(value: unknown): CreditLot[] | null {
  if (!Array.isArray(value)) return null;
  return value.map((lot) => {
    if (
      lot === null ||
      typeof lot !== 'object' ||
      typeof lot.originStart !== 'string' ||
      typeof lot.kwh !== 'string'
    )
      throw new Error('Stored credit lot is invalid');
    return { originStart: lot.originStart, kwh: new Decimal(lot.kwh) };
  });
}
function closing(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || !('closingLots' in value))
    return null;
  return value.closingLots;
}
function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}
function hasReason(reasons: readonly string[], group: readonly string[]) {
  return reasons.some((reason) => group.includes(reason));
}
/** A known closing bank whose grid inputs were incomplete: successors inherit the doubt. */
function closingCreditEstimated(
  nem: unknown,
  reasons: readonly string[],
): boolean {
  return nem !== null && hasReason(reasons, NEM_CREDIT_ESTIMATE_REASONS);
}

function hashCanonical(hash: Hash, value: unknown): void {
  if (Array.isArray(value)) {
    hash.update('[');
    for (let i = 0; i < value.length; i++) {
      if (i) hash.update(',');
      hashCanonical(hash, value[i]);
    }
    hash.update(']');
  } else if (value !== null && typeof value === 'object') {
    hash.update('{');
    const fields = value as Record<string, unknown>;
    const keys = Object.keys(fields).sort();
    for (let i = 0; i < keys.length; i++) {
      if (i) hash.update(',');
      const key = keys[i]!;
      hash.update(JSON.stringify(key));
      hash.update(':');
      hashCanonical(hash, fields[key]);
    }
    hash.update('}');
  } else {
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new Error('Unserializable billing result');
    hash.update(encoded);
  }
}

export function billingResultFingerprint(
  result: BillingPeriodResult | null | undefined,
): string | null {
  if (!result) return null;
  const hash = createHash('sha256');
  hashCanonical(hash, {
    total: result.total?.toString() ?? null,
    subtotal: result.subtotal?.toString() ?? null,
    status: result.status,
    reasons: result.reasons,
    isLowerBound: result.isLowerBound,
    coverage: result.coverage.toString(),
    quantities: result.quantities,
    lineItems: result.lineItems,
    nem: result.nem,
    tariffVersionIds: result.tariffVersionIds,
    policyVersions: result.policyVersions,
    mappingVersion: result.mappingVersion,
    calcVersion: result.calcVersion,
  });
  return hash.digest('hex');
}

export interface BillingFreshness {
  stale: boolean;
  resultComputedAtMs: number | null;
  resultCalcVersion: number | null;
  resultFingerprint: string | null;
}

@Injectable()
export class BillingService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private timer: NodeJS.Timeout | undefined;
  private readonly logger = new Logger(BillingService.name);
  private running = false;
  private activeComputations = 0;
  private readonly computationWaiters: Array<() => void> = [];
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: Env,
    @Inject(ReconciliationService)
    private readonly reconciliation: ReconciliationService,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.env.COLLECTOR_ENABLED) return;
    void this.recomputeStale(new Date()).catch(() =>
      this.logger.error('Billing refresh failed; retrying next hour'),
    );
    this.timer = setInterval(() => {
      void this.recomputeStale(new Date()).catch(() =>
        this.logger.error('Billing refresh failed; retrying next hour'),
      );
    }, ONE_HOUR_MS);
    this.timer.unref();
  }
  beforeApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  private async metadata(
    period: BillingPeriod,
    timezone: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const from = localInstant(day(period.startDate), timezone);
    const to = localInstant(afterDay(period.endDate), timezone);
    const [versions, policies, mapping, latestLedger] = await Promise.all([
      db.tariffVersion.findMany({
        where: {
          tariffId: period.tariffId,
          effectiveFrom: { lte: period.endDate },
          OR: [
            { effectiveTo: null },
            { effectiveTo: { gte: period.startDate } },
          ],
        },
        orderBy: { effectiveFrom: 'asc' },
      }),
      this.activePolicies(db),
      db.mappingVersion.findFirst({ orderBy: { version: 'desc' } }),
      db.energyInterval.findFirst({
        where: { bucketStart: { gte: from, lt: to } },
        orderBy: { computedAt: 'desc' },
        select: { computedAt: true },
      }),
    ]);
    const ids = new Set<number>();
    const active = selectSegment(policies as PolicySegment[], from);
    if (active) ids.add(active.version);
    for (const policy of policies)
      if (policy.effectiveFrom > from && policy.effectiveFrom < to)
        ids.add(policy.version);
    return {
      from,
      to,
      versions,
      policies: policies as PolicySegment[],
      policyVersions: [...ids].sort((a, b) => a - b),
      mapping,
      latestLedger,
    };
  }

  private activePolicies(db: Prisma.TransactionClient) {
    return db.accountingPolicy.findMany({
      where: { supersededByVersion: null },
      orderBy: { effectiveFrom: 'asc' },
    });
  }

  /**
   * The reconciliation state `computeBill` consumes: the grid source current at `now`
   * decides which candidate of the latest meter-reading pair must PASS. Cached results
   * record it as the presence of `ACCOUNTING_UNRECONCILED`, so every validity check and
   * computation evaluates this one function.
   */
  private async accountingUnreconciled(
    now: Date,
    db: Prisma.TransactionClient,
    policies?: PolicySegment[],
  ): Promise<boolean> {
    const current = selectSegment(
      policies ?? ((await this.activePolicies(db)) as PolicySegment[]),
      now,
    );
    return (
      (await this.reconciliation.accountingStatus(
        current?.gridSource ?? 'METER_NET',
        db,
      )) !== 'RECONCILED'
    );
  }

  async isStale(
    period: BillingPeriod & {
      result?: BillingPeriodResult | null;
      tariff?: { timezone: string };
    },
    now: Date,
    db: Prisma.TransactionClient = this.prisma,
    accountingUnreconciled?: boolean,
  ): Promise<boolean> {
    let current: BillingPeriod & {
      result?: BillingPeriodResult | null;
      tariff?: { timezone: string };
    } = period;
    // One reconciliation evaluation serves the whole ancestor walk, and only if a result depends on it.
    let unreconciled = accountingUnreconciled;
    const reconciliation = async () =>
      (unreconciled ??= await this.accountingUnreconciled(now, db));
    while (true) {
      if (await this.selfStale(current, now, db, reconciliation)) return true;
      if (current.openingCreditLots !== null || current.result!.nem === null)
        return false;
      const previous = await db.billingPeriod.findFirst({
        where: {
          tariffId: current.tariffId,
          startDate: { lt: current.startDate },
        },
        orderBy: { startDate: 'desc' },
        include: { result: true },
      });
      if (!previous || afterDay(previous.endDate) !== day(current.startDate))
        return false;
      if (!previous.result) return true;
      if (this.predecessorChanged(current.result!, previous.result))
        return true;
      current = previous;
    }
  }

  private predecessorChanged(
    current: BillingPeriodResult,
    previous: BillingPeriodResult,
  ): boolean {
    // Flat and UNAVAILABLE results never consumed an opening credit bank.
    if (current.nem === null) return false;
    const unknownOpening = hasReason(
      current.reasons,
      NEM_CREDIT_UNKNOWN_REASONS,
    );
    const unknownClosing =
      previous.nem === null ||
      previous.status === 'UNAVAILABLE' ||
      hasReason(previous.reasons, NEM_CREDIT_UNKNOWN_REASONS);
    // An unknown bank stays unknown even if this period minted some of its own lots.
    // A non-NEM/unavailable predecessor likewise supplies no known bank.
    if (unknownOpening || unknownClosing)
      return unknownOpening !== unknownClosing;
    const storedOpening =
      typeof current.nem === 'object' && 'openingLots' in current.nem
        ? current.nem.openingLots
        : null;
    return (
      JSON.stringify(closing(previous.nem)) !== JSON.stringify(storedOpening) ||
      closingCreditEstimated(previous.nem, previous.reasons) !==
        current.reasons.includes(BillingReason.NEM_OPENING_CREDIT_ESTIMATED)
    );
  }

  private async selfStale(
    period: BillingPeriod & {
      result?: BillingPeriodResult | null;
      tariff?: { timezone: string };
    },
    now: Date,
    db: Prisma.TransactionClient,
    accountingUnreconciled: () => Promise<boolean>,
  ): Promise<boolean> {
    if (!period.result) return true;
    const tariff =
      period.tariff ??
      (await db.tariff.findUniqueOrThrow({
        where: { id: period.tariffId },
      }));
    return this.currentInputsStale(
      period,
      tariff.timezone,
      {
        ...(await this.metadata(period, tariff.timezone, db)),
        // UNAVAILABLE results never consult accounting status, so it cannot invalidate them.
        accountingUnreconciled:
          period.result.status === 'UNAVAILABLE'
            ? false
            : await accountingUnreconciled(),
      },
      now,
    );
  }

  private currentInputsStale(
    period: BillingPeriod & { result?: BillingPeriodResult | null },
    timezone: string,
    meta: {
      versions: TariffVersion[];
      policyVersions: number[];
      mapping: { version: number } | null;
      latestLedger: { computedAt: Date } | null;
      accountingUnreconciled: boolean;
    },
    now: Date,
  ): boolean {
    if (!period.result) return true;
    const result = period.result;
    if (
      result.calcVersion !== BILLING_CALC_VERSION ||
      result.mappingVersion !== (meta.mapping?.version ?? 0) ||
      !sameNumbers(result.policyVersions, meta.policyVersions) ||
      !sameNumbers(
        result.tariffVersionIds,
        meta.versions.map((version) => version.id),
      )
    )
      return true;
    if (
      meta.versions.some((version) => version.createdAt > result.computedAt) ||
      (meta.latestLedger && meta.latestLedger.computedAt > result.computedAt)
    )
      return true;
    if (
      result.status !== 'UNAVAILABLE' &&
      result.reasons.includes(BillingReason.ACCOUNTING_UNRECONCILED) !==
        meta.accountingUnreconciled
    )
      return true;
    const today = DateTime.fromJSDate(now).setZone(timezone).toISODate()!;
    if (
      day(period.endDate) < today &&
      result.reasons.includes('PERIOD_IN_PROGRESS')
    )
      return true;
    if (
      day(period.endDate) >= today &&
      now.getTime() - result.computedAt.getTime() >= ONE_HOUR_MS
    )
      return true;
    return false;
  }

  /** One set-based snapshot per tariff; every ancestor is evaluated once in date order. */
  async freshnessForTariff(
    tariffId: number,
    now: Date,
  ): Promise<Map<number, BillingFreshness>> {
    const tariff = await this.prisma.tariff.findUniqueOrThrow({
      where: { id: tariffId },
    });
    const [periods, versions, policies, mapping, latestRows] =
      await Promise.all([
        this.prisma.billingPeriod.findMany({
          where: { tariffId },
          include: { result: true },
          orderBy: { startDate: 'asc' },
        }),
        this.prisma.tariffVersion.findMany({
          where: { tariffId },
          orderBy: { effectiveFrom: 'asc' },
        }),
        this.activePolicies(this.prisma),
        this.prisma.mappingVersion.findFirst({ orderBy: { version: 'desc' } }),
        this.prisma.$queryRaw<{ id: number; computedAt: Date | null }[]>`
        SELECT p."id", MAX(e."computedAt") AS "computedAt"
        FROM "BillingPeriod" p
        LEFT JOIN "EnergyInterval" e
          ON e."bucketStart" >= (p."startDate"::timestamp AT TIME ZONE ${tariff.timezone})
          AND e."bucketStart" < ((p."endDate" + 1)::timestamp AT TIME ZONE ${tariff.timezone})
        WHERE p."tariffId" = ${tariffId}
        GROUP BY p."id"
      `,
      ]);
    const ledger = new Map(latestRows.map((row) => [row.id, row.computedAt]));
    // One reconciliation evaluation per snapshot, and only if some result depends on it.
    const accountingUnreconciled = periods.some(
      ({ result }) => result !== null && result.status !== 'UNAVAILABLE',
    )
      ? await this.accountingUnreconciled(
          now,
          this.prisma,
          policies as PolicySegment[],
        )
      : false;
    const freshness = new Map<number, BillingFreshness>();
    let previous: (typeof periods)[number] | undefined;
    for (const period of periods) {
      const from = localInstant(day(period.startDate), tariff.timezone);
      const to = localInstant(afterDay(period.endDate), tariff.timezone);
      const overlapping = versions.filter(
        (version) =>
          version.effectiveFrom <= period.endDate &&
          (version.effectiveTo === null ||
            version.effectiveTo >= period.startDate),
      );
      const policyIds = new Set<number>();
      const active = selectSegment(policies as PolicySegment[], from);
      if (active) policyIds.add(active.version);
      for (const policy of policies)
        if (policy.effectiveFrom > from && policy.effectiveFrom < to)
          policyIds.add(policy.version);
      let stale = this.currentInputsStale(
        period,
        tariff.timezone,
        {
          versions: overlapping,
          policyVersions: [...policyIds].sort((a, b) => a - b),
          mapping,
          latestLedger: ledger.get(period.id)
            ? { computedAt: ledger.get(period.id)! }
            : null,
          accountingUnreconciled,
        },
        now,
      );
      if (
        !stale &&
        period.result!.nem !== null &&
        period.openingCreditLots === null &&
        previous &&
        afterDay(previous.endDate) === day(period.startDate)
      )
        stale =
          (freshness.get(previous.id)?.stale ?? true) ||
          !previous.result ||
          this.predecessorChanged(period.result!, previous.result);
      freshness.set(period.id, {
        stale,
        resultComputedAtMs: period.result?.computedAt.getTime() ?? null,
        resultCalcVersion: period.result?.calcVersion ?? null,
        resultFingerprint: billingResultFingerprint(period.result),
      });
      previous = period;
    }
    return freshness;
  }

  async invalidateForPolicyChange(range: {
    from: Date;
    to?: Date;
  }): Promise<number> {
    const periods = await this.prisma.billingPeriod.findMany({
      where: { result: { isNot: null } },
      include: { tariff: true, result: true },
    });
    let count = 0;
    for (const period of periods) {
      const from = localInstant(day(period.startDate), period.tariff.timezone);
      const to = localInstant(afterDay(period.endDate), period.tariff.timezone);
      if (to <= range.from || (range.to && from >= range.to)) continue;
      if (
        period.result &&
        !sameNumbers(
          period.result.policyVersions,
          (await this.metadata(period, period.tariff.timezone)).policyVersions,
        )
      )
        count++;
    }
    return count;
  }

  async recomputeStale(now: Date = new Date()): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      const periods = await this.prisma.billingPeriod.findMany({
        select: { id: true, tariffId: true },
        orderBy: [{ tariffId: 'asc' }, { startDate: 'asc' }],
      });
      let computed = 0;
      let tariffId: number | undefined;
      let freshness: Map<number, BillingFreshness> | undefined;
      for (const period of periods) {
        if (period.tariffId !== tariffId) {
          tariffId = period.tariffId;
          freshness = await this.freshnessForTariff(tariffId, now);
        }
        if (freshness!.get(period.id)?.stale) {
          await this.computePeriod(period.id, now);
          computed++;
          // A NEM cascade may already have refreshed several following periods.
          freshness = await this.freshnessForTariff(tariffId, now);
        }
      }
      return computed;
    } finally {
      this.running = false;
    }
  }

  async computePeriod(
    billingPeriodId: number,
    now: Date = new Date(),
    cascade = true,
  ): Promise<BillingPeriodResult> {
    if (this.activeComputations < 3) this.activeComputations++;
    else
      await new Promise<void>((resolve) =>
        this.computationWaiters.push(resolve),
      );
    try {
      let result = await this.computeOne(billingPeriodId, now);
      let current = await this.prisma.billingPeriod.findUniqueOrThrow({
        where: { id: billingPeriodId },
      });
      while (cascade && result.closingChanged) {
        const next = await this.prisma.billingPeriod.findFirst({
          where: {
            tariffId: current.tariffId,
            startDate: { gt: current.startDate },
          },
          orderBy: { startDate: 'asc' },
        });
        if (
          !next ||
          next.openingCreditLots !== null ||
          day(next.startDate) !== afterDay(current.endDate)
        )
          break;
        current = next;
        result = await this.computeOne(next.id, now, true);
      }
      return await this.prisma.billingPeriodResult.findUniqueOrThrow({
        where: { billingPeriodId },
      });
    } finally {
      const next = this.computationWaiters.shift();
      if (next) next();
      else this.activeComputations--;
    }
  }

  private async computeOne(
    billingPeriodId: number,
    now: Date,
    predecessorFresh = false,
  ): Promise<{ closingChanged: boolean }> {
    const identified = await this.prisma.billingPeriod.findUnique({
      where: { id: billingPeriodId },
      select: { tariffId: true },
    });
    if (!identified)
      throw new TariffError('NOT_FOUND', 'Billing period not found');
    return this.prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(716071, ${identified.tariffId}) IS NULL AS locked`;
        const period = await tx.billingPeriod.findUnique({
          where: { id: billingPeriodId },
          include: { tariff: true, result: true },
        });
        if (!period)
          throw new TariffError('NOT_FOUND', 'Billing period not found');
        const { from, to, versions, policies, policyVersions, mapping } =
          await this.metadata(period, period.tariff.timezone, tx);
        const [rows, holidays, monthlyRates, monitoringPolicy, previous] =
          await Promise.all([
            tx.energyInterval.findMany({
              where: { bucketStart: { gte: from, lt: to } },
              orderBy: { bucketStart: 'asc' },
            }),
            tx.tariffHoliday.findMany({
              where: {
                tariffId: period.tariffId,
                date: {
                  gte: new Date(
                    `${day(period.startDate).slice(0, 4)}-01-01T00:00:00Z`,
                  ),
                  lte: new Date(
                    `${day(period.endDate).slice(0, 4)}-12-31T00:00:00Z`,
                  ),
                },
              },
            }),
            tx.tariffMonthlyRate.findMany({
              where: { tariffId: period.tariffId },
            }),
            tx.accountingPolicy.findFirst({
              orderBy: { effectiveFrom: 'asc' },
            }),
            tx.billingPeriod.findFirst({
              where: {
                tariffId: period.tariffId,
                startDate: { lt: period.startDate },
              },
              orderBy: { startDate: 'desc' },
              include: { result: true },
            }),
          ]);
        const holidaySet = new Set(
          holidays.map((holiday) => day(holiday.date)),
        );
        const holidayYears = new Set(
          holidays.map((holiday) => day(holiday.date).slice(0, 4)),
        );
        const startDate = day(period.startDate),
          endDate = day(period.endDate);
        const periodDays =
          Math.round(
            (period.endDate.getTime() - period.startDate.getTime()) / DAY_MS,
          ) + 1;
        const segments: {
          versionId: number;
          rules: TariffRulesV1;
          quantities: SegmentQuantities;
        }[] = [];
        let covered = 0;
        let touAllocationEstimated = false;
        let calcParamsPartialRecompute = false;
        let holidayCalendarMissing = false;
        let noTariffVersion = false;
        let cursor = DateTime.fromISO(startDate, { zone: 'utc' });
        const stop = DateTime.fromISO(endDate, { zone: 'utc' }).plus({
          days: 1,
        });
        // Coverage and ledger flags apply to the whole period, including unpriced dates.
        for (const row of rows) {
          const policy = selectSegment(policies, row.bucketStart);
          const source = policy?.gridSource ?? 'METER_NET';
          if (!(source in GRID_FIELDS))
            throw new Error('Stored grid source is invalid');
          const [importField, exportField] =
            GRID_FIELDS[source as keyof typeof GRID_FIELDS];
          const overlap =
            Math.min(300_000, to.getTime() - row.bucketStart.getTime()) / 1000;
          if (row[importField] !== null && row[exportField] !== null)
            covered +=
              source === 'INVERTER_COUNTER'
                ? Math.max(
                    0,
                    overlap -
                      Math.max(
                        row.counterUnknownSec[1] ?? 300,
                        row.counterUnknownSec[2] ?? 300,
                      ),
                  )
                : Math.min(overlap, Math.max(0, row.gridCoveredSec));
          if (
            source === 'INVERTER_COUNTER' &&
            row.counterGapAllocMask & ((1 << 1) | (1 << 2))
          )
            touAllocationEstimated = true;
          if (
            row.calcVersion !== LEDGER_ALGO_VERSION ||
            row.maxGapSecUsed !== (policy?.maxGapSec ?? DEFAULT_MAX_GAP_SEC) ||
            row.flags &
              (LedgerFlag.OUTSIDE_RETENTION | LedgerFlag.STALE_CALC_PARAMS)
          )
            calcParamsPartialRecompute = true;
        }
        for (const version of versions) {
          const begin = DateTime.fromJSDate(version.effectiveFrom, {
            zone: 'utc',
          });
          const end = version.effectiveTo
            ? DateTime.fromJSDate(version.effectiveTo, { zone: 'utc' }).plus({
                days: 1,
              })
            : stop;
          if (begin > cursor) noTariffVersion = true;
          const segmentStart = begin > cursor ? begin : cursor;
          const segmentEnd = end < stop ? end : stop;
          if (segmentEnd <= segmentStart) continue;
          const rules = parseRules(version.rules);
          const dateStart = segmentStart.toISODate()!,
            dateEnd = segmentEnd.minus({ days: 1 }).toISODate()!;
          const startMs = localInstant(
            dateStart,
            period.tariff.timezone,
          ).getTime();
          const endMs = localInstant(
            segmentEnd.toISODate()!,
            period.tariff.timezone,
          ).getTime();
          const windows = new Map<
            string,
            { importKwh: Decimal; exportKwh: Decimal }
          >();
          const importByMonth: Record<string, Decimal> = {};
          for (const row of rows) {
            const bucket = row.bucketStart.getTime();
            if (bucket < startMs || bucket >= endMs) continue;
            const policy = selectSegment(policies, row.bucketStart);
            const source = policy?.gridSource ?? 'METER_NET';
            if (!(source in GRID_FIELDS))
              throw new Error('Stored grid source is invalid');
            const [importField, exportField] =
              GRID_FIELDS[source as keyof typeof GRID_FIELDS];
            const imported = row[importField],
              exported = row[exportField];
            const overlapMs = Math.min(
              300_000,
              endMs - bucket,
              to.getTime() - bucket,
            );
            const factor =
              overlapMs === 300_000
                ? null
                : new Decimal(overlapMs).div(300_000);
            const window = windowFor(row.bucketStart, rules, holidaySet);
            let aggregate = windows.get(window);
            if (!aggregate) {
              aggregate = {
                importKwh: new Decimal(0),
                exportKwh: new Decimal(0),
              };
              windows.set(window, aggregate);
            }
            if (imported !== null) {
              const kwh = new Decimal(imported.toFixed()).div(1000);
              const value = factor ? kwh.times(factor) : kwh;
              aggregate.importKwh = aggregate.importKwh.plus(value);
              const month = DateTime.fromJSDate(row.bucketStart)
                .setZone(period.tariff.timezone)
                .toFormat('yyyy-MM');
              importByMonth[month] = (
                importByMonth[month] ?? new Decimal(0)
              ).plus(value);
            }
            if (exported !== null) {
              const kwh = new Decimal(exported.toFixed()).div(1000);
              aggregate.exportKwh = aggregate.exportKwh.plus(
                factor ? kwh.times(factor) : kwh,
              );
            }
          }
          if (rules.touWindows.some((window) => window.excludeHolidays)) {
            for (
              let date = segmentStart;
              date < segmentEnd;
              date = date.plus({ years: 1 }).startOf('year')
            )
              if (!holidayYears.has(date.toFormat('yyyy')))
                holidayCalendarMissing = true;
          }
          segments.push({
            versionId: version.id,
            rules,
            quantities: {
              startDate: dateStart,
              endDate: dateEnd,
              days: Math.round(segmentEnd.diff(segmentStart, 'days').days),
              windows: [...windows].map(([window, value]) => ({
                window,
                ...value,
              })),
              importByMonth,
            },
          });
          if (segmentEnd > cursor) cursor = segmentEnd;
        }
        if (cursor < stop) noTariffVersion = true;
        const accountingUnreconciled = await this.accountingUnreconciled(
          now,
          tx,
          policies,
        );
        let nemOpening: NemOpening;
        if (period.openingCreditLots !== null)
          nemOpening = { lots: lots(period.openingCreditLots) };
        else if (!previous)
          nemOpening = { lots: null, reason: 'NEM_OPENING_CREDIT_UNKNOWN' };
        else if (
          afterDay(previous.endDate) !== startDate ||
          !previous.result ||
          (!predecessorFresh &&
            (await this.isStale(previous, now, tx, accountingUnreconciled))) ||
          hasReason(previous.result.reasons, NEM_CREDIT_UNKNOWN_REASONS)
        )
          nemOpening = { lots: null, reason: 'NEM_CHAIN_GAP' };
        else
          nemOpening = {
            lots: lots(closing(previous.result.nem)),
            reason: 'NEM_CHAIN_GAP',
            estimated: closingCreditEstimated(
              previous.result.nem,
              previous.result.reasons,
            ),
          };
        const rates: MonthlyRateRow[] = monthlyRates.map((row) => ({
          componentCode: row.componentCode,
          month: row.month,
          ratePerKwh: new Decimal(row.ratePerKwh.toFixed()),
        }));
        const coverage = Math.min(
          1,
          covered / ((to.getTime() - from.getTime()) / 1000),
        );
        const result = computeBill({
          segments,
          monthlyRates: rates,
          nemOpening,
          context: {
            coverage,
            periodDays,
            periodStartDate: startDate,
            periodInProgress:
              endDate >=
              DateTime.fromJSDate(now)
                .setZone(period.tariff.timezone)
                .toISODate()!,
            startsBeforeMonitoring:
              monitoringPolicy !== null &&
              from < monitoringPolicy.effectiveFrom,
            entirelyBeforeMonitoring:
              monitoringPolicy !== null && to <= monitoringPolicy.effectiveFrom,
            noTariffVersion,
            vendorDataOnly: false,
            holidayCalendarMissing,
            touAllocationEstimated,
            accountingUnreconciled,
            mappingProvisional: mapping?.provisional ?? true,
            calcParamsPartialRecompute,
            allVersionsBillVerified:
              versions.length > 0 &&
              versions.every((version) => version.billVerified),
          },
        });
        const oldClosing = closing(period.result?.nem);
        const serializedClosing = result.nem?.closingLots ?? null;
        const oldUnknown = hasReason(
          period.result?.reasons ?? [],
          NEM_CREDIT_UNKNOWN_REASONS,
        );
        const newUnknown = hasReason(
          result.reasons,
          NEM_CREDIT_UNKNOWN_REASONS,
        );
        const oldEstimated = closingCreditEstimated(
          period.result?.nem ?? null,
          period.result?.reasons ?? [],
        );
        const newEstimated = closingCreditEstimated(result.nem, result.reasons);
        // Successors depend on the quality of the bank as well as on its lots.
        const closingChanged =
          JSON.stringify(oldClosing) !== JSON.stringify(serializedClosing) ||
          oldUnknown !== newUnknown ||
          oldEstimated !== newEstimated;
        const quantities = segments.map((segment) => ({
          versionId: segment.versionId,
          startDate: segment.quantities.startDate,
          endDate: segment.quantities.endDate,
          days: segment.quantities.days,
          windows: segment.quantities.windows.map((window) => ({
            window: window.window,
            importKwh: window.importKwh.toFixed(3),
            exportKwh: window.exportKwh.toFixed(3),
          })),
          importByMonth: Object.fromEntries(
            Object.entries(segment.quantities.importByMonth).map(
              ([month, value]) => [month, value.toFixed(3)],
            ),
          ),
        }));
        const lineItems = result.lineItems.map((item) => ({
          code: item.code,
          label: item.label,
          kind: item.kind,
          segment: item.segment,
          quantityKwh: item.quantityKwh,
          rate: item.rate,
          amount: item.amount,
          status: item.status,
          ...(item.note === undefined ? {} : { note: item.note }),
        }));
        const nem = result.nem
          ? {
              openingLots: result.nem.openingLots.map((lot) => ({ ...lot })),
              expiredLots: result.nem.expiredLots.map((lot) => ({ ...lot })),
              consumedLots: result.nem.consumedLots.map((lot) => ({ ...lot })),
              closingLots: result.nem.closingLots.map((lot) => ({ ...lot })),
            }
          : Prisma.JsonNull;
        const data = {
          computedAt: now,
          calcVersion: BILLING_CALC_VERSION,
          mappingVersion: mapping?.version ?? 0,
          policyVersions,
          tariffVersionIds: versions.map((version) => version.id),
          quantities: quantities as Prisma.InputJsonValue,
          lineItems,
          nem,
          subtotal: result.subtotal,
          total: result.total,
          status: result.status,
          reasons: result.reasons,
          isLowerBound: result.isLowerBound,
          coverage: new Decimal(coverage).toFixed(4),
        };
        await tx.billingPeriodResult.upsert({
          where: { billingPeriodId },
          create: { billingPeriodId, ...data },
          update: data,
        });
        return { closingChanged };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
  }
}
