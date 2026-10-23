import { DateTime } from 'luxon';
import {
  Prisma,
  type AccountingPolicy,
  type CalculationRun,
} from '../generated/prisma/client.js';
import type { PrismaService } from '../db/prisma.service.js';
import {
  BUCKET_MS,
  ceilBucketMs,
  DEFAULT_MAX_GAP_SEC,
  floorBucketMs,
  LEDGER_ALGO_VERSION,
  LedgerFlag,
  type PolicySegment,
  type GridSource,
  type PvSource,
  type BatterySource,
  type LoadSource,
} from './types.js';

export interface PolicyInput {
  effectiveFrom: Date;
  gridSource: GridSource;
  pvSource: PvSource;
  batterySource: BatterySource;
  loadSource: LoadSource;
  maxGapSec: number;
  validated?: Record<string, boolean>;
  note: string;
}

export function selectSegment(
  segments: PolicySegment[],
  at: Date,
): PolicySegment | undefined {
  let chosen: PolicySegment | undefined;
  for (const segment of segments) {
    if (segment.supersededByVersion !== null || segment.effectiveFrom > at)
      continue;
    if (
      !chosen ||
      segment.effectiveFrom > chosen.effectiveFrom ||
      (segment.effectiveFrom.getTime() === chosen.effectiveFrom.getTime() &&
        segment.version > chosen.version)
    )
      chosen = segment;
  }
  return chosen;
}

// Serialize the seed and policy mutations, including independent backend processes.
async function policyLock(tx: Prisma.TransactionClient): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(716071, 4) IS NULL AS locked`;
}

export async function ensurePolicyV1(
  prisma: PrismaService,
  tx?: Prisma.TransactionClient,
): Promise<AccountingPolicy | null> {
  const ensure = async (client: Prisma.TransactionClient) => {
    await policyLock(client);
    const existing = await client.accountingPolicy.findFirst({
      orderBy: { version: 'asc' },
    });
    const first = await client.sample.findFirst({
      orderBy: { observedAt: 'asc' },
      select: { observedAt: true },
    });
    if (existing) {
      if (first) {
        const earliestActive = await client.accountingPolicy.findFirst({
          where: { supersededByVersion: null },
          orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }],
        });
        if (earliestActive && first.observedAt < earliestActive.effectiveFrom)
          return client.accountingPolicy.update({
            where: { version: earliestActive.version },
            data: { effectiveFrom: first.observedAt },
          });
      }
      return existing;
    }
    if (!first) return null;
    return client.accountingPolicy.create({
      data: {
        effectiveFrom: first.observedAt,
        gridSource: 'METER_NET',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: DEFAULT_MAX_GAP_SEC,
        validated: {},
        note: 'PV and battery remain INTEGRATED until G5 establishes a counter/integration ratio within 0.95–1.05.',
      },
    });
  };
  return tx ? ensure(tx) : prisma.$transaction(ensure);
}

export interface PolicyChange {
  policy: AccountingPolicy;
  calculationRun: CalculationRun | null;
  billingPeriodsInvalidated: number;
  outsideRetentionBefore: Date | null;
}

export async function createPolicyVersion(
  prisma: PrismaService,
  input: PolicyInput,
  retentionDays = 400,
  now = new Date(),
): Promise<PolicyChange> {
  if (
    !Number.isInteger(input.maxGapSec) ||
    input.maxGapSec <= 0 ||
    !Number.isFinite(input.effectiveFrom.getTime()) ||
    !input.note.trim()
  )
    throw new RangeError('invalid accounting policy');
  return prisma.$transaction(
    async (tx) => {
      await policyLock(tx);
      const beforeActive = await tx.accountingPolicy.findMany({
        where: { supersededByVersion: null },
        orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }],
      });
      const policy = await tx.accountingPolicy.create({
        data: {
          ...input,
          validated: input.validated ?? {},
          note: input.note.trim(),
        },
      });
      await tx.accountingPolicy.updateMany({
        where: {
          version: { not: policy.version },
          supersededByVersion: null,
          effectiveFrom: { gte: input.effectiveFrom },
        },
        data: { supersededByVersion: policy.version },
      });
      const active = await tx.accountingPolicy.findMany({
        where: { supersededByVersion: null },
        orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }],
      });
      const changed = await tx.energyInterval.findMany({
        where: {
          bucketStart: {
            gte: new Date(floorBucketMs(input.effectiveFrom.getTime())),
          },
        },
        select: { bucketStart: true, maxGapSecUsed: true },
        orderBy: { bucketStart: 'asc' },
      });
      const cutoff = new Date(
        ceilBucketMs(now.getTime() - retentionDays * 86_400_000),
      );
      let outsideRetentionBefore: Date | null = null;
      let first: number | null = null;
      let end = 0;
      let runStart: number | null = null;
      let runEnd = 0;
      let staleFirst: number | null = null;
      let staleEnd = 0;
      const flushStale = async (): Promise<void> => {
        if (staleFirst === null) return;
        await tx.$executeRaw`UPDATE "EnergyInterval" SET "flags" = "flags" | ${LedgerFlag.STALE_CALC_PARAMS}
        WHERE "bucketStart" >= ${new Date(staleFirst)} AND "bucketStart" < ${new Date(staleEnd)}`;
        staleFirst = null;
      };
      const flush = async (): Promise<void> => {
        if (first === null) return;
        await tx.ledgerDirtyRange.create({
          data: {
            fromBucket: new Date(first),
            toBucket: new Date(end),
            reason: 'CALC_PARAMS',
          },
        });
        runStart ??= first;
        runEnd = end;
        first = null;
      };
      for (const row of changed) {
        const selected = selectSegment(
          active as PolicySegment[],
          row.bucketStart,
        );
        const previous = selectSegment(
          beforeActive as PolicySegment[],
          row.bucketStart,
        );
        const ms = row.bucketStart.getTime();
        if (
          (selected?.maxGapSec ?? DEFAULT_MAX_GAP_SEC) ===
            (previous?.maxGapSec ?? DEFAULT_MAX_GAP_SEC) ||
          !selected ||
          selected.maxGapSec === row.maxGapSecUsed
        ) {
          await flush();
          await flushStale();
          continue;
        }
        if (ms < cutoff.getTime()) {
          await flush();
          outsideRetentionBefore ??= cutoff;
          if (staleFirst !== null && staleEnd !== ms) await flushStale();
          staleFirst ??= ms;
          staleEnd = ms + BUCKET_MS;
          continue;
        }
        await flushStale();
        if (first !== null && end !== ms) await flush();
        first ??= ms;
        end = ms + BUCKET_MS;
      }
      await flushStale();
      await flush();
      const mapping = await tx.mappingVersion.findFirst({
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      const calculationRun =
        runStart === null
          ? null
          : await tx.calculationRun.create({
              data: {
                kind: 'CALC_PARAMS_CHANGE',
                reason: `Accounting policy ${policy.version}: maxGapSec`,
                rangeStart: new Date(runStart),
                rangeEnd: new Date(runEnd),
                calcVersion: LEDGER_ALGO_VERSION,
                mappingVersion: mapping?.version ?? 0,
                startedAt: now,
                status: 'RUNNING',
              },
            });
      const periods = await tx.billingPeriod.findMany({
        where: { result: { isNot: null } },
        include: { tariff: true, result: true },
      });
      let billingPeriodsInvalidated = 0;
      for (const period of periods) {
        const start = DateTime.fromJSDate(period.startDate, {
          zone: 'utc',
        }).toISODate()!;
        const end = DateTime.fromJSDate(period.endDate, { zone: 'utc' })
          .plus({ days: 1 })
          .toISODate()!;
        const from = DateTime.fromISO(start, {
          zone: period.tariff.timezone,
        }).toJSDate();
        const to = DateTime.fromISO(end, {
          zone: period.tariff.timezone,
        }).toJSDate();
        if (to <= input.effectiveFrom) continue;
        const versions = new Set<number>();
        const first = selectSegment(active as PolicySegment[], from);
        if (first) versions.add(first.version);
        for (const segment of active)
          if (segment.effectiveFrom > from && segment.effectiveFrom < to)
            versions.add(segment.version);
        const current = [...versions].sort((a, b) => a - b);
        const stored = [...(period.result?.policyVersions ?? [])].sort(
          (a, b) => a - b,
        );
        if (JSON.stringify(current) !== JSON.stringify(stored))
          billingPeriodsInvalidated++;
      }
      return {
        policy,
        calculationRun,
        billingPeriodsInvalidated,
        outsideRetentionBefore,
      };
    },
    { timeout: 120_000 },
  );
}
