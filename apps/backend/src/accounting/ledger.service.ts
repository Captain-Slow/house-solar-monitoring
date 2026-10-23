import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import {
  Inject,
  Injectable,
  Logger,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { DateTime } from 'luxon';
import {
  Prisma,
  type EnergyInterval,
  type Sample,
} from '../generated/prisma/client.js';
import type { Env } from '../config/env.js';
import { APP_ENV } from '../config/env.token.js';
import { PrismaService } from '../db/prisma.service.js';
import { computeRange, dailyBalanceResidual } from './compute.js';
import { ensurePolicyV1, selectSegment } from './policy.js';
import { RawPollRenormalizer } from './raw-poll-renormalizer.js';
import {
  BUCKET_MS,
  ceilBucketMs,
  COUNTER_KEYS,
  DEFAULT_MAX_GAP_SEC,
  floorBucketMs,
  LEDGER_ALGO_VERSION,
  LedgerFlag,
  type ComputeInput,
  type ComputeOutput,
  type CounterKey,
  type CounterStates,
  type ExclusionWindow,
  type IntervalRow,
  type LedgerSample,
  type PolicySegment,
} from './types.js';

export const LEDGER_OPTIONS = Symbol('LEDGER_OPTIONS');
export const LEDGER_WORKER_ENABLED = Symbol('LEDGER_WORKER_ENABLED');
export interface LedgerOptions {
  intervalMs?: number;
  clock?: () => Date;
  onBeforeChunkWrite?: () => void | Promise<void>;
  onBeforeCommit?: (stage: 'chunk' | 'propagation') => void | Promise<void>;
  computeRange?: (input: ComputeInput) => ComputeOutput;
}

type Dirty = { id: bigint; fromBucket: Date; toBucket: Date; reason: string };
function workSignature(from: number, to: number, committed: unknown): string {
  return createHash('sha256')
    .update(JSON.stringify([from, to, committed]))
    .digest('hex');
}
const date = (ms: number): Date => new Date(ms);

/** Mirrors the SQL `m.config->>'batteryPowerSource' = 'BMS_1914'` rule used by the API series. */
function batteryPowerSource(
  config: Prisma.JsonValue | undefined,
): LedgerSample['batteryPowerSource'] {
  return typeof config === 'object' &&
    config !== null &&
    !Array.isArray(config) &&
    config.batteryPowerSource === 'BMS_1914'
    ? 'BMS_1914'
    : 'BAT1_POWER_G3_50';
}

function ledgerSample(
  row: Sample,
  sources: ReadonlyMap<number, LedgerSample['batteryPowerSource']>,
): LedgerSample {
  return {
    tMs: row.observedAt.getTime(),
    deviceId: row.deviceId,
    mappingVersion: row.mappingVersion,
    flags: row.flags,
    gridW: row.gridW,
    gridAW: row.gridAW,
    gridBW: row.gridBW,
    gridCW: row.gridCW,
    pvW: row.pvW,
    batteryW: row.batteryW,
    // Sample.mappingVersion is a foreign key, so the lookup always hits; the default is the schema default.
    batteryPowerSource: sources.get(row.mappingVersion) ?? 'BAT1_POWER_G3_50',
    inverterAcW: row.inverterAcW,
    epsW: row.epsW,
    batterySoc: row.batterySoc,
    counters: {
      PV: row.pvWh === null ? null : Number(row.pvWh),
      GRID_BUY: row.gridBuyWh === null ? null : Number(row.gridBuyWh),
      GRID_SELL: row.gridSellWh === null ? null : Number(row.gridSellWh),
      BAT_CHARGE: row.batChargeWh === null ? null : Number(row.batChargeWh),
      BAT_DISCHARGE:
        row.batDischargeWh === null ? null : Number(row.batDischargeWh),
      LOAD_USE: row.loadUseWh === null ? null : Number(row.loadUseWh),
    },
  };
}

/**
 * Covered seconds are fractional inside the pure integrator (sample timestamps carry milliseconds)
 * but persisted as whole seconds in INTEGER columns, where the database truncates. Quantize here,
 * explicitly and only for this coverage metadata: Wh is integrated from the exact interval lengths and
 * stays untouched. Whole seconds are floored so coverage never claims time that was not integrated;
 * the value is first snapped to the millisecond grid it truly lives on, so floating-point noise in
 * a summed full bucket (299.99999999999994) cannot cost a second. Every write and every recovery
 * equality check goes through storedRow, so the compared value is always one the column holds.
 */
const wholeSeconds = (seconds: number): number =>
  Math.floor(Math.round(seconds * 1000) / 1000);

function storedRow(
  row: IntervalRow,
  maxGapSecUsed: number,
  now: Date,
): Prisma.EnergyIntervalCreateInput {
  const wh = (n: number | null): Prisma.Decimal | null =>
    n === null ? null : new Prisma.Decimal(n).toDecimalPlaces(3);
  return {
    bucketStart: date(row.bucketStartMs),
    calcVersion: LEDGER_ALGO_VERSION,
    maxGapSecUsed,
    mappingVersion: row.mappingVersion,
    computedAt: now,
    gridImportNetWh: wh(row.gridImportNetWh),
    gridExportNetWh: wh(row.gridExportNetWh),
    gridImportPhaseWh: wh(row.gridImportPhaseWh),
    gridExportPhaseWh: wh(row.gridExportPhaseWh),
    gridImportCounterWh: wh(row.gridImportCounterWh),
    gridExportCounterWh: wh(row.gridExportCounterWh),
    pvIntWh: wh(row.pvIntWh),
    pvCounterWh: wh(row.pvCounterWh),
    batChargeIntWh: wh(row.batChargeIntWh),
    batDischargeIntWh: wh(row.batDischargeIntWh),
    batChargeCounterWh: wh(row.batChargeCounterWh),
    batDischargeCounterWh: wh(row.batDischargeCounterWh),
    loadDerivedWh: wh(row.loadDerivedWh),
    loadCounterWh: wh(row.loadCounterWh),
    gridCoveredSec: wholeSeconds(row.gridCoveredSec),
    pvCoveredSec: wholeSeconds(row.pvCoveredSec),
    batCoveredSec: wholeSeconds(row.batCoveredSec),
    socCoveredSec: row.socCoveredSec,
    loadCoveredSec: wholeSeconds(row.loadCoveredSec),
    counterUnknownSec: row.counterUnknownSec,
    counterGapAllocMask: row.counterGapAllocMask,
    flags: row.flags,
    counterState: row.counterState as unknown as Prisma.InputJsonValue,
    gridAvgW: row.gridAvgW,
    gridMinW: row.gridMinW,
    gridMaxW: row.gridMaxW,
    pvAvgW: row.pvAvgW,
    pvMaxW: row.pvMaxW,
    batAvgW: row.batAvgW,
    loadAvgW: row.loadAvgW,
    loadMaxW: row.loadMaxW,
    socMin: row.socMin,
    socMax: row.socMax,
    socLast: row.socLast,
  };
}

/** Text form of a stored/computed scalar (number, bigint, string, Decimal) for equality checks. */
function scalarText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (
    typeof value === 'number' ||
    typeof value === 'bigint' ||
    typeof value === 'boolean'
  )
    return value.toString();
  return JSON.stringify(value) ?? '';
}

function matchesStored(
  expected: Prisma.EnergyIntervalCreateInput,
  stored: EnergyInterval,
): boolean {
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'computedAt') continue;
    const actual: unknown = Reflect.get(stored, key);
    if (key === 'counterState' || Array.isArray(value)) {
      if (!isDeepStrictEqual(value, actual)) return false;
    } else if (value instanceof Date && actual instanceof Date) {
      if (value.getTime() !== actual.getTime()) return false;
    } else if (value === null || actual === null || actual === undefined) {
      if (value !== actual) return false;
    } else if (scalarText(value) !== scalarText(actual)) return false;
  }
  return true;
}

@Injectable()
export class LedgerService
  implements OnApplicationBootstrap, BeforeApplicationShutdown
{
  private timer: NodeJS.Timeout | undefined;
  private readonly logger = new Logger('LedgerService');
  private running: Promise<void> | undefined;
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: Env,
    @Inject(LEDGER_OPTIONS) private readonly options: LedgerOptions = {},
    @Inject(LEDGER_WORKER_ENABLED) private readonly enabled = true,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.enabled) return;
    void this.processOnce().catch(() => undefined);
    this.timer = setInterval(() => {
      void this.processOnce().catch(() => undefined);
    }, this.options.intervalMs ?? 60_000);
  }
  async beforeApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }
  processOnce(now = this.options.clock?.() ?? new Date()): Promise<void> {
    if (this.running) return this.running;
    const work = this.process(now);
    this.running = work;
    void work
      .finally(() => {
        if (this.running === work) this.running = undefined;
      })
      .catch(() => undefined);
    return work;
  }

  private async process(now: Date): Promise<void> {
    const cutoff = ceilBucketMs(
      now.getTime() - this.env.SAMPLE_RETENTION_DAYS * 86_400_000,
    );
    // Explicit RENORMALIZE rebuilds from raw polls and is bounded by raw retention instead.
    const rawCutoff = ceilBucketMs(
      now.getTime() - this.env.RAW_RETENTION_DAYS * 86_400_000,
    );
    // A retention setting is only an upper bound on available evidence. In particular,
    // increasing retention cannot restore pruned samples, and retained histories may
    // have interior holes. Counters alone cannot recover lost SOC/observation statistics.
    await this.prisma.$executeRaw`
      UPDATE "EnergyInterval" e SET "flags" = e."flags" | ${LedgerFlag.OUTSIDE_RETENTION}
      WHERE e."calcVersion" < ${LEDGER_ALGO_VERSION}
        AND (e."bucketStart" < ${date(cutoff)} OR NOT EXISTS (
          SELECT 1 FROM "Sample" s WHERE s."observedAt" >= e."bucketStart"
            AND s."observedAt" < e."bucketStart" + interval '5 minutes'))
        AND (e."flags" & ${LedgerFlag.OUTSIDE_RETENTION}) = 0`;
    const [outdated] = await this.prisma.$queryRaw<
      { from: Date | null; to: Date | null }[]
    >`
      SELECT MIN(e."bucketStart") AS "from", MAX(e."bucketStart") AS "to"
      FROM "EnergyInterval" e WHERE e."calcVersion" < ${LEDGER_ALGO_VERSION}
        AND e."bucketStart" >= ${date(cutoff)} AND EXISTS (
          SELECT 1 FROM "Sample" s WHERE s."observedAt" >= e."bucketStart"
            AND s."observedAt" < e."bucketStart" + interval '5 minutes')`;
    if (outdated?.from && outdated.to) {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT pg_advisory_xact_lock(716071, 6) IS NULL AS locked`;
          const running = await tx.calculationRun.findFirst({
            where: { kind: 'ALGO_UPGRADE', status: 'RUNNING' },
          });
          if (running) return;
          const mapping = await tx.mappingVersion.findFirst({
            orderBy: { version: 'desc' },
          });
          const from = outdated.from!;
          const to = date(outdated.to!.getTime() + BUCKET_MS);
          await tx.ledgerDirtyRange.create({
            data: { fromBucket: from, toBucket: to, reason: 'ALGO_UPGRADE' },
          });
          await tx.calculationRun.create({
            data: {
              kind: 'ALGO_UPGRADE',
              reason: `Ledger algorithm ${LEDGER_ALGO_VERSION}`,
              rangeStart: from,
              rangeEnd: to,
              calcVersion: LEDGER_ALGO_VERSION,
              mappingVersion: mapping?.version ?? 0,
              startedAt: now,
              status: 'RUNNING',
            },
          });
        },
        { timeout: 120_000 },
      );
    }
    // Every transaction claims its own rows; another worker may insert dirt while this one runs.
    const attempts = new Map<bigint, { seen: Set<string>; repeats: number }>();
    for (;;) {
      const step = await this.processChunk(now, cutoff, rawCutoff, attempts);
      if (!step) return;
      if (step.capped) {
        this.logger.warn(
          'Ledger dirty range is not converging; leaving it pending',
        );
        return;
      }
      if (step.signature === null) continue;
      for (const id of step.ids) {
        const prior = attempts.get(id);
        if (!prior) {
          attempts.set(id, { seen: new Set([step.signature]), repeats: 0 });
        } else if (prior.seen.has(step.signature)) {
          prior.repeats++;
        } else {
          prior.seen.add(step.signature);
          prior.repeats = 0;
        }
      }
    }
  }

  /**
   * Where a RENORMALIZE chunk may write below the raw/sample horizon gap: the rebuilt windows of
   * RUNNING RENORMALIZE runs plus everything at or after the sample cutoff, sorted and merged.
   */
  private async writableIntervals(
    tx: Prisma.TransactionClient,
    sampleCutoff: number,
  ): Promise<{ from: number; to: number }[]> {
    const runs = await tx.calculationRun.findMany({
      where: { kind: 'RENORMALIZE', status: 'RUNNING' },
      select: { rangeStart: true, rangeEnd: true },
    });
    const spans = [
      ...runs.map((r) => ({
        from: r.rangeStart.getTime(),
        to: r.rangeEnd.getTime(),
      })),
      { from: sampleCutoff, to: Number.POSITIVE_INFINITY },
    ].sort((a, b) => a.from - b.from);
    const merged: { from: number; to: number }[] = [];
    for (const span of spans) {
      const last = merged.at(-1);
      if (last && span.from <= last.to) last.to = Math.max(last.to, span.to);
      else merged.push({ ...span });
    }
    return merged;
  }

  private nextDay(ms: number): number {
    return DateTime.fromMillis(ms, { zone: this.env.SITE_TIMEZONE })
      .startOf('day')
      .plus({ days: 1 })
      .toMillis();
  }

  private async processChunk(
    now: Date,
    sampleCutoff: number,
    rawCutoff: number,
    attempts: ReadonlyMap<bigint, { seen: Set<string>; repeats: number }>,
  ): Promise<{
    ids: bigint[];
    signature: string | null;
    capped: boolean;
  } | null> {
    return this.prisma.$transaction(
      async (tx) => {
        // Share replay's reservation before taking the worker lock: acquisition repairs
        // must not race a RENORMALIZE transaction that changes Sample mappings/values.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(716071, 7) IS NULL AS locked`;
        // Row locks alone do not serialize two workers with overlapping NEW dirty ids.
        // An ingest commit between one worker's read and write is safe: the next worker
        // cannot overwrite its result until this transaction commits, then re-reads samples.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(716071, 8) IS NULL AS locked`;
        await ensurePolicyV1(this.prisma, tx);
        const locked = await tx.$queryRaw<
          Dirty[]
        >`SELECT * FROM "LedgerDirtyRange" ORDER BY "fromBucket", "id" FOR UPDATE SKIP LOCKED`;
        if (locked.length === 0) return null;
        const acquisition = new RawPollRenormalizer(this.prisma);
        const first = locked[0]!;
        let from = first.fromBucket.getTime();
        let to = first.toBucket.getTime();
        const claimed = [first];
        // Dirt is never merged across retention horizons: a RENORMALIZE range keeps the raw
        // horizon and ordinary work the sample horizon, even when the ranges overlap.
        const renormalize = first.reason === 'RENORMALIZE';
        const cutoff = renormalize ? rawCutoff : sampleCutoff;
        for (const row of locked.slice(1)) {
          if (row.fromBucket.getTime() > to) break;
          if ((row.reason === 'RENORMALIZE') !== renormalize) continue;
          claimed.push(row);
          to = Math.max(to, row.toBucket.getTime());
        }
        const ids = claimed.map((row) => row.id);
        if (ids.some((id) => (attempts.get(id)?.repeats ?? 0) >= 20))
          return { ids, signature: null, capped: true };
        if (from < cutoff) {
          for (const row of claimed) {
            const oldEnd = Math.min(row.toBucket.getTime(), cutoff);
            if (row.fromBucket.getTime() < oldEnd)
              await tx.$executeRaw`
            UPDATE "EnergyInterval" SET "flags" = "flags" | ${row.reason === 'CALC_PARAMS' ? LedgerFlag.STALE_CALC_PARAMS : LedgerFlag.OUTSIDE_RETENTION}
            WHERE "bucketStart" >= ${row.fromBucket} AND "bucketStart" < ${date(oldEnd)}`;
          }
          from = cutoff;
        }
        // Under a raw horizon longer than the sample horizon, rows below the sample cutoff are
        // authoritative history unless a RUNNING RENORMALIZE run rebuilt their samples. Only the
        // writable intervals (rebuilt windows and everything at/after the sample cutoff) may change.
        const writable =
          renormalize && rawCutoff < sampleCutoff
            ? await this.writableIntervals(tx, sampleCutoff)
            : null;
        const interval = writable?.find((i) => i.to > from);
        if (interval && interval.from > from) from = interval.from;
        if (from >= to) {
          await tx.ledgerDirtyRange.deleteMany({ where: { id: { in: ids } } });
          await this.completeRuns(tx, now);
          return { ids, signature: null, capped: false };
        }
        const end = Math.min(
          to,
          this.nextDay(from),
          interval?.to ?? Number.POSITIVE_INFINITY,
        );
        // Reconstruction never reaches below the writable interval's start: the nearest stored row
        // before it supplies the starting counter state and is not re-verified.
        const floor = interval ? Math.max(cutoff, interval.from) : cutoff;
        let result = await this.computeWindow(
          tx,
          from,
          end,
          floor,
          acquisition,
        );
        const writeFrom = from;
        // Counter lookahead can affect an older committed prefix. Verify it one
        // local day at a time rather than materializing every dense Sample since
        // the counter witness. Reconstructed state can expose an earlier anchor.
        let verificationFrom = result.neededFrom;
        for (;;) {
          let verifiedState: CounterStates | undefined;
          for (let start = verificationFrom; start < from;) {
            const stop = Math.min(from, this.nextDay(start));
            const prefix = await this.computeWindow(
              tx,
              start,
              stop,
              floor,
              acquisition,
              verifiedState,
            );
            const prior = await tx.energyInterval.findMany({
              where: { bucketStart: { gte: date(start), lt: date(stop) } },
            });
            const producedInPrefix = new Set(
              prefix.rows.map((row) => row.bucketStartMs),
            );
            const preserved = new Set(
              prior
                .filter(
                  (row) =>
                    (row.calcVersion < LEDGER_ALGO_VERSION &&
                      !prefix.evidenceBuckets.has(row.bucketStart.getTime())) ||
                    // Same rule as the write path: below the sample horizon a stored row the
                    // rebuilt evidence cannot reproduce is kept, so it is not a verification mismatch.
                    (writable !== null &&
                      row.bucketStart.getTime() < sampleCutoff &&
                      !producedInPrefix.has(row.bucketStart.getTime())),
                )
                .map((row) => row.bucketStart.getTime()),
            );
            const stored = new Map(
              prior
                .filter((row) => !preserved.has(row.bucketStart.getTime()))
                .map((row) => [row.bucketStart.getTime(), row]),
            );
            if (
              prefix.rows.filter((row) => !preserved.has(row.bucketStartMs))
                .length !== stored.size ||
              prefix.rows.some((row) => {
                if (preserved.has(row.bucketStartMs)) return false;
                const old = stored.get(row.bucketStartMs);
                return (
                  !old ||
                  !matchesStored(
                    storedRow(
                      row,
                      prefix.rowGap.get(row.bucketStartMs) ??
                        DEFAULT_MAX_GAP_SEC,
                      now,
                    ),
                    old,
                  )
                );
              })
            ) {
              await tx.ledgerDirtyRange.updateMany({
                where: { id: { in: ids } },
                data: {
                  fromBucket: date(verificationFrom),
                  toBucket: date(to),
                },
              });
              return {
                ids,
                signature: workSignature(first.fromBucket.getTime(), to, [
                  'rewind',
                  verificationFrom,
                ]),
                capped: false,
              };
            }
            verifiedState = prefix.endCounterStates;
            start = stop;
          }
          // Unsupported historical rows retain their old values and may also retain
          // an obsolete counter state. Carry actual state through those holes.
          if (
            verifiedState === undefined ||
            isDeepStrictEqual(verifiedState, result.initialCounterStates)
          )
            break;
          result = await this.computeWindow(
            tx,
            from,
            end,
            floor,
            acquisition,
            verifiedState,
          );
          if (result.neededFrom >= verificationFrom) break;
          verificationFrom = result.neededFrom;
        }
        const { rowGap, evidenceBuckets } = result;
        const unsupported = (row: EnergyInterval): boolean =>
          row.calcVersion < LEDGER_ALGO_VERSION &&
          !evidenceBuckets.has(row.bucketStart.getTime());
        await this.options.onBeforeChunkWrite?.();
        const previousEnd = await tx.energyInterval.findUnique({
          where: { bucketStart: date(end - BUCKET_MS) },
        });
        const previousState = previousEnd?.counterState ?? null;
        const existing = await tx.energyInterval.findMany({
          where: { bucketStart: { gte: date(writeFrom), lt: date(end) } },
        });
        const preserved = new Set(
          existing.filter(unsupported).map((row) => row.bucketStart.getTime()),
        );
        const produced = new Set(result.rows.map((row) => row.bucketStartMs));
        for (const row of existing)
          if (
            !produced.has(row.bucketStart.getTime()) &&
            !preserved.has(row.bucketStart.getTime()) &&
            // Below the sample horizon a stored row is never deleted, only rebuilt.
            !(writable && row.bucketStart.getTime() < sampleCutoff)
          )
            await tx.energyInterval.delete({
              where: { bucketStart: row.bucketStart },
            });
        for (const row of result.rows) {
          if (preserved.has(row.bucketStartMs)) continue;
          const data = storedRow(
            row,
            rowGap.get(row.bucketStartMs) ?? DEFAULT_MAX_GAP_SEC,
            now,
          );
          await tx.energyInterval.upsert({
            where: { bucketStart: data.bucketStart },
            create: data,
            update: data,
          });
        }
        const kinds = [
          'COUNTER_RESET',
          'COUNTER_JUMP_REJECTED',
          'COUNTER_DISCONTINUITY',
        ] as const;
        await tx.dataQualityEvent.deleteMany({
          where: {
            kind: { in: [...kinds] },
            startedAt: { gte: date(writeFrom), lt: date(end) },
            details: { path: ['source'], equals: 'ledger' },
            NOT: [...preserved].map((at) => ({
              startedAt: { gte: date(at), lt: date(at + BUCKET_MS) },
            })),
          },
        });
        for (const event of result.events) {
          if (preserved.has(floorBucketMs(event.atMs))) continue;
          await tx.dataQualityEvent.create({
            data: {
              kind: event.kind,
              startedAt: date(event.atMs),
              details: {
                ...event.details,
                source: 'ledger',
                counter: event.counter,
              },
            },
          });
        }
        let localDay = DateTime.fromMillis(writeFrom, {
          zone: this.env.SITE_TIMEZONE,
        }).startOf('day');
        while (localDay.toMillis() < end) {
          const next = localDay.plus({ days: 1 });
          if (next.toMillis() <= now.getTime())
            await this.dailyBalance(tx, next.toMillis(), now);
          localDay = next;
        }
        await this.options.onBeforeCommit?.('chunk');
        // Both computed rows and progress commit together; no chunk may disappear after a crash.
        if (end < to) {
          await tx.ledgerDirtyRange.updateMany({
            where: { id: { in: ids } },
            data: { fromBucket: date(end), toBucket: date(to) },
          });
        } else {
          const frontier = await tx.energyInterval.findFirst({
            orderBy: { bucketStart: 'desc' },
            select: { bucketStart: true },
          });
          const frontierMs = frontier
            ? frontier.bucketStart.getTime() + BUCKET_MS
            : end;
          const propagates =
            JSON.stringify(previousState) !==
              JSON.stringify(result.endCounterStates) && end < frontierMs;
          if (
            propagates &&
            writable &&
            !writable.some((i) => end >= i.from && end < i.to)
          ) {
            // The next stored row is authoritative history. Stop here: at most it is flagged.
            await tx.$executeRaw`
              UPDATE "EnergyInterval" SET "flags" = "flags" | ${LedgerFlag.OUTSIDE_RETENTION}
              WHERE "bucketStart" = (SELECT min("bucketStart") FROM "EnergyInterval" WHERE "bucketStart" >= ${date(end)})`;
            await tx.ledgerDirtyRange.deleteMany({
              where: { id: { in: ids } },
            });
          } else if (propagates) {
            const continuationEnd = Math.min(this.nextDay(end), frontierMs);
            await tx.ledgerDirtyRange.updateMany({
              where: { id: { in: ids } },
              data: {
                fromBucket: date(end),
                toBucket: date(continuationEnd),
              },
            });
            const reasons = new Set(claimed.map((row) => row.reason));
            const runKinds = [
              ...(reasons.has('RECALC_REQUEST')
                ? (['LEDGER_RECOMPUTE'] as const)
                : []),
              ...(reasons.has('CALC_PARAMS')
                ? (['CALC_PARAMS_CHANGE'] as const)
                : []),
              ...(reasons.has('ALGO_UPGRADE')
                ? (['ALGO_UPGRADE'] as const)
                : []),
              // Only when raw retention is longer than sample retention is a RENORMALIZE run's
              // range a rebuilt window and therefore fixed; otherwise it keeps following propagation.
              ...(reasons.has('RENORMALIZE') && writable === null
                ? (['RENORMALIZE'] as const)
                : []),
            ];
            // In raw-horizon mode a RENORMALIZE run keeps its requested range (the rebuilt window).
            if (runKinds.length)
              await tx.calculationRun.updateMany({
                where: {
                  status: 'RUNNING',
                  kind: { in: runKinds },
                  rangeStart: { lt: date(end) },
                  rangeEnd: { gt: date(writeFrom) },
                },
                data: { rangeEnd: date(continuationEnd) },
              });
          } else
            await tx.ledgerDirtyRange.deleteMany({
              where: { id: { in: ids } },
            });
        }
        await this.options.onBeforeCommit?.('propagation');
        await this.completeRuns(tx, now);
        return {
          ids,
          signature: workSignature(first.fromBucket.getTime(), to, [
            result.endCounterStates,
            result.rows,
          ]),
          capped: false,
        };
      },
      { timeout: 120_000 },
    );
  }

  private async computeWindow(
    tx: Prisma.TransactionClient,
    writeFrom: number,
    end: number,
    cutoff: number,
    acquisition: RawPollRenormalizer,
    counterStates?: CounterStates,
  ): Promise<{
    rows: IntervalRow[];
    events: ComputeOutput['events'];
    endCounterStates: CounterStates;
    initialCounterStates: CounterStates | null;
    rowGap: Map<number, number>;
    evidenceBuckets: Set<number>;
    neededFrom: number;
  }> {
    let rewindFloor: number | undefined;
    let rowGap = new Map<number, number>();
    let evidenceBuckets = new Set<number>();
    for (;;) {
      const seed = await tx.sample.findFirst({
        where: { observedAt: { lt: date(writeFrom) } },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
      });
      const middle = await tx.sample.findMany({
        where: { observedAt: { gte: date(writeFrom), lt: date(end) } },
        orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
      });
      evidenceBuckets = new Set(
        middle.map((row) => floorBucketMs(row.observedAt.getTime())),
      );
      const after = await tx.sample.findMany({
        where: { observedAt: { gte: date(end) } },
        orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
        take: 64,
      });
      // Every calculation consumes acquisition evidence, not only upgrades of existing
      // intervals. Include the interpolation seed and counter lookahead; repairs enqueue
      // their full dependent range atomically and are no-ops on the next pass.
      const repaired = await acquisition.repairAcquisitionValidity(
        seed?.observedAt.getTime() ?? writeFrom,
        Math.max(end, (after.at(-1)?.observedAt.getTime() ?? end - 1) + 1),
        tx,
      );
      if (repaired.changedSamples > 0) continue;
      const baseline = await tx.energyInterval.findFirst({
        where: { bucketStart: { lt: date(writeFrom) } },
        orderBy: { bucketStart: 'desc' },
      });
      const policies = await tx.accountingPolicy.findMany({
        where: { supersededByVersion: null },
        orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }],
      });
      const boundaries = [
        writeFrom,
        ...policies
          .map((p) => ceilBucketMs(p.effectiveFrom.getTime()))
          .filter((ms) => ms > writeFrom && ms < end),
        end,
      ].sort((a, b) => a - b);
      const baselineState =
        counterStates ??
        (baseline?.counterState as unknown as CounterStates | null) ??
        null;
      // Exclusions matter wherever they overlap a counter transition that this window can accept
      // or reject: from the accepted/pending anchors carried in the baseline state (which may be
      // much older than the power seed) through the lookahead. The power seed alone is not enough.
      let exclusionFrom = seed?.observedAt.getTime() ?? writeFrom;
      if (baselineState) {
        for (const key of COUNTER_KEYS) {
          const counter = baselineState[key];
          if (counter.last)
            exclusionFrom = Math.min(exclusionFrom, counter.last.tMs);
          for (const reading of counter.pending)
            exclusionFrom = Math.min(exclusionFrom, reading.tMs);
        }
      }
      if (rewindFloor === undefined) {
        // Only the original committed state can carry a newly changed span
        // before the dirty range. Older baselines loaded to reconstruct that
        // prefix must not recursively pull in their own already committed past.
        rewindFloor = writeFrom;
        if (baselineState) {
          for (const key of COUNTER_KEYS) {
            const counter = baselineState[key];
            if (counter.last)
              rewindFloor = Math.min(
                rewindFloor,
                floorBucketMs(counter.last.tMs),
              );
            for (const reading of counter.pending)
              rewindFloor = Math.min(rewindFloor, floorBucketMs(reading.tMs));
          }
        }
      }
      const compute = this.options.computeRange ?? computeRange;
      let rows: IntervalRow[] = [];
      let events: ComputeOutput['events'] = [];
      let state: CounterStates | null = baselineState;
      let earlier = writeFrom;
      for (;;) {
        // Read after the samples so every sample's mapping version is visible.
        const sources = new Map(
          (
            await tx.mappingVersion.findMany({
              select: { version: true, config: true },
            })
          ).map((m) => [m.version, batteryPowerSource(m.config)]),
        );
        const samples = [seed, ...middle, ...after]
          .filter((s): s is Sample => s !== null)
          .map((s) => ledgerSample(s, sources));
        const exclusions = await tx.dataExclusion.findMany({
          where: {
            from: {
              lt: date(
                Math.max(
                  end,
                  (after.at(-1)?.observedAt.getTime() ?? end - 1) + 1,
                ),
              ),
            },
            to: { gt: date(exclusionFrom) },
          },
        });
        const windows: ExclusionWindow[] = exclusions.map((e) => ({
          fromMs: e.from.getTime(),
          toMs: e.to.getTime(),
          families: e.families.filter(
            (family): family is ExclusionWindow['families'][number] =>
              ['GRID', 'PV', 'BATTERY', 'LOAD', 'ALL'].includes(family),
          ),
        }));
        rows = [];
        events = [];
        state = baselineState;
        rowGap = new Map();
        earlier = writeFrom;
        const unresolved = new Set<CounterKey>();
        for (let i = 0; i + 1 < boundaries.length; i++) {
          const start = boundaries[i]!;
          const stop = boundaries[i + 1]!;
          if (start === stop) continue;
          const gap =
            selectSegment(policies as PolicySegment[], date(start))
              ?.maxGapSec ?? DEFAULT_MAX_GAP_SEC;
          // Each policy segment uses the same crossing readings but its own gap rule.
          const output = compute({
            fromMs: writeFrom,
            toMs: end,
            maxGapSec: gap,
            samples,
            counterStates: baselineState,
            exclusions: windows,
            touBoundaryMinutes: [0],
            timeZone: this.env.SITE_TIMEZONE,
          });
          for (const key of output.lookaheadUnresolved) unresolved.add(key);
          earlier = Math.min(earlier, output.writeFromMs);
          for (const row of output.rows) {
            if (row.bucketStartMs < start || row.bucketStartMs >= stop)
              continue;
            rows.push(row);
            rowGap.set(row.bucketStartMs, gap);
          }
          events.push(
            ...output.events.filter(
              (event) => event.atMs >= start && event.atMs < stop,
            ),
          );
          state = output.endCounterStates;
        }
        if (unresolved.size === 0 || after.length === 0) break;
        // Power interpolation already has its right-hand seed. Later rows only
        // matter when they carry a still-unresolved counter; a dense stream of
        // failed block-2000 samples must not become an in-memory lookahead.
        const candidates: Prisma.SampleWhereInput[] = [];
        if (unresolved.has('PV')) candidates.push({ pvWh: { not: null } });
        if (unresolved.has('GRID_BUY'))
          candidates.push({ gridBuyWh: { not: null } });
        if (unresolved.has('GRID_SELL'))
          candidates.push({ gridSellWh: { not: null } });
        if (unresolved.has('BAT_CHARGE'))
          candidates.push({ batChargeWh: { not: null } });
        if (unresolved.has('BAT_DISCHARGE'))
          candidates.push({ batDischargeWh: { not: null } });
        if (unresolved.has('LOAD_USE'))
          candidates.push({ loadUseWh: { not: null } });
        const last = after.at(-1)!;
        const moreQuery = {
          where: {
            AND: [
              { OR: candidates },
              {
                OR: [
                  { observedAt: { gt: last.observedAt } },
                  { observedAt: last.observedAt, id: { gt: last.id } },
                ],
              },
            ],
          },
          orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
          take: after.length,
        } satisfies Prisma.SampleFindManyArgs;
        let more = await tx.sample.findMany(moreQuery);
        if (more.length === 0) break;
        const repairedMore = await acquisition.repairAcquisitionValidity(
          more[0]!.observedAt.getTime(),
          more.at(-1)!.observedAt.getTime() + 1,
          tx,
        );
        if (repairedMore.changedSamples > 0)
          more = await tx.sample.findMany(moreQuery);
        for (const row of more) after.push(row);
      }
      return {
        rows,
        events,
        endCounterStates: state!,
        initialCounterStates: baselineState,
        rowGap,
        evidenceBuckets,
        neededFrom: Math.max(earlier, cutoff, rewindFloor ?? writeFrom),
      };
    }
  }

  private async completeRuns(
    tx: Prisma.TransactionClient,
    now: Date,
  ): Promise<void> {
    const running = await tx.calculationRun.findMany({
      where: {
        status: 'RUNNING',
        kind: {
          in: [
            'LEDGER_RECOMPUTE',
            'RENORMALIZE',
            'ALGO_UPGRADE',
            'CALC_PARAMS_CHANGE',
          ],
        },
      },
    });
    for (const run of running) {
      const dirty = await tx.ledgerDirtyRange.findFirst({
        where: {
          reason: {
            in:
              run.kind === 'CALC_PARAMS_CHANGE'
                ? ['CALC_PARAMS']
                : run.kind === 'ALGO_UPGRADE'
                  ? ['ALGO_UPGRADE']
                  : run.kind === 'RENORMALIZE'
                    ? ['RENORMALIZE']
                    : ['RECALC_REQUEST'],
          },
          fromBucket: { lt: run.rangeEnd },
          toBucket: { gt: run.rangeStart },
        },
      });
      if (!dirty)
        await tx.calculationRun.update({
          where: { id: run.id },
          data: { status: 'DONE', finishedAt: now },
        });
    }
  }

  private async dailyBalance(
    tx: Prisma.TransactionClient,
    end: number,
    now: Date,
  ): Promise<void> {
    const start = DateTime.fromMillis(end - 1, { zone: this.env.SITE_TIMEZONE })
      .startOf('day')
      .toMillis();
    const rows = await tx.energyInterval.findMany({
      where: { bucketStart: { gte: date(start), lt: date(end) } },
    });
    const sum = (
      key:
        | 'pvIntWh'
        | 'batDischargeIntWh'
        | 'batChargeIntWh'
        | 'gridImportNetWh'
        | 'gridExportNetWh'
        | 'loadDerivedWh',
    ) => rows.reduce((total, row) => total + Number(row[key] ?? 0), 0);
    const energy = {
      pvWh: sum('pvIntWh'),
      batDischargeWh: sum('batDischargeIntWh'),
      batChargeWh: sum('batChargeIntWh'),
      importWh: sum('gridImportNetWh'),
      exportWh: sum('gridExportNetWh'),
      houseWh: sum('loadDerivedWh'),
    };
    const residual = dailyBalanceResidual(energy);
    await tx.dataQualityEvent.deleteMany({
      where: {
        kind: 'BALANCE_ANOMALY',
        startedAt: date(start),
        details: { path: ['source'], equals: 'ledger' },
      },
    });
    if (residual.anomaly)
      await tx.dataQualityEvent.create({
        data: {
          kind: 'BALANCE_ANOMALY',
          startedAt: date(start),
          endedAt: date(end),
          details: {
            source: 'ledger',
            localDate: DateTime.fromMillis(start, {
              zone: this.env.SITE_TIMEZONE,
            }).toISODate(),
            residualWh: residual.residualWh,
            residualPct: residual.residualPct,
            computedAt: now.toISOString(),
          },
        },
      });
  }
}
