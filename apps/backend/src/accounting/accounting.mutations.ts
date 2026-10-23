import { Inject, Injectable, Optional } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { APP_ENV } from '../config/env.token.js';
import { PrismaService } from '../db/prisma.service.js';
import type { CalculationRun, Prisma } from '../generated/prisma/client.js';
import {
  ceilBucketMs,
  floorBucketMs,
  LEDGER_ALGO_VERSION,
  LedgerFlag,
} from './types.js';
import {
  createPolicyVersion,
  type PolicyChange,
  type PolicyInput,
} from './policy.js';
import { RENORMALIZER, type Renormalizer } from './raw-poll-renormalizer.js';

export class AccountingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AccountingError';
  }
}

const FAMILIES = new Set(['GRID', 'PV', 'BATTERY', 'LOAD', 'ALL']);
export const ACCOUNTING_CLOCK = Symbol('ACCOUNTING_CLOCK');

@Injectable()
export class AccountingMutations {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: Env,
    @Inject(RENORMALIZER) private readonly renormalizer: Renormalizer,
    @Optional()
    @Inject(ACCOUNTING_CLOCK)
    private readonly clock: () => Date = () => new Date(),
  ) {}

  createAccountingPolicy(input: PolicyInput): Promise<PolicyChange> {
    return createPolicyVersion(
      this.prisma,
      input,
      this.env.SAMPLE_RETENTION_DAYS,
      this.clock(),
    );
  }

  private async dirtySampleBounds(
    tx: Prisma.TransactionClient,
    fromMs: number,
    toMs: number,
  ): Promise<{ fromBucket: Date; toBucket: Date }> {
    const [preceding, following] = await Promise.all([
      tx.sample.findFirst({
        where: { observedAt: { lt: new Date(fromMs) } },
        orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
        select: { observedAt: true },
      }),
      tx.sample.findFirst({
        where: { observedAt: { gte: new Date(toMs) } },
        orderBy: [{ observedAt: 'asc' }, { id: 'asc' }],
        select: { observedAt: true },
      }),
    ]);
    return {
      fromBucket: new Date(
        floorBucketMs(preceding?.observedAt.getTime() ?? fromMs),
      ),
      toBucket: new Date(
        Math.max(
          ceilBucketMs(toMs),
          following ? ceilBucketMs(following.observedAt.getTime()) : toMs,
        ),
      ),
    };
  }

  async createDataExclusion(
    input: { from: Date; to: Date; families: string[]; reason: string },
    createdBy: string,
  ) {
    this.validateExclusion(input);
    return this.prisma.$transaction(async (tx) => {
      const exclusion = await tx.dataExclusion.create({
        data: { ...input, reason: input.reason.trim(), createdBy },
      });
      await tx.ledgerDirtyRange.create({
        data: {
          ...(await this.dirtySampleBounds(
            tx,
            input.from.getTime(),
            input.to.getTime(),
          )),
          reason: 'EXCLUSION',
        },
      });
      return exclusion;
    });
  }

  async deleteDataExclusion(id: number): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.dataExclusion.findUnique({ where: { id } });
      if (!row) return false;
      await tx.dataExclusion.delete({ where: { id } });
      await tx.ledgerDirtyRange.create({
        data: {
          ...(await this.dirtySampleBounds(
            tx,
            row.from.getTime(),
            row.to.getTime(),
          )),
          reason: 'EXCLUSION',
        },
      });
      return true;
    });
  }

  private validateExclusion(input: {
    from: Date;
    to: Date;
    families: string[];
    reason: string;
  }): void {
    if (
      !Number.isFinite(input.from.getTime()) ||
      !Number.isFinite(input.to.getTime()) ||
      input.from >= input.to ||
      input.to.getTime() - input.from.getTime() > 366 * 86_400_000 ||
      input.families.length === 0 ||
      input.families.some((family) => !FAMILIES.has(family)) ||
      !input.reason.trim()
    )
      throw new AccountingError('BAD_USER_INPUT', 'Invalid data exclusion');
  }

  async requestRecalculation(
    kind: 'LEDGER_RECOMPUTE' | 'RENORMALIZE',
    from: Date,
    to: Date,
    reason: string,
  ): Promise<CalculationRun & { outsideRetentionBefore: Date | null }> {
    if (
      !Number.isFinite(from.getTime()) ||
      !Number.isFinite(to.getTime()) ||
      from >= to ||
      !reason.trim()
    )
      throw new AccountingError(
        'BAD_USER_INPUT',
        'Invalid recalculation range',
      );
    const now = this.clock();
    const retention =
      kind === 'RENORMALIZE'
        ? this.env.RAW_RETENTION_DAYS
        : this.env.SAMPLE_RETENTION_DAYS;
    const cutoff = ceilBucketMs(now.getTime() - retention * 86_400_000);
    const start = Math.max(floorBucketMs(from.getTime()), cutoff);
    const end = ceilBucketMs(to.getTime());
    if (start >= end)
      throw new AccountingError(
        'OUTSIDE_RETENTION',
        'Recalculation range lies outside retention',
      );
    // Hold a cross-process reservation during replay, not just while inserting the run:
    // concurrent RENORMALIZE calls must not rewrite samples before discovering overlap.
    const connection = await this.prisma.pool.connect();
    try {
      await connection.query('SELECT pg_advisory_lock(716071, 7)');
      try {
        const mapping = await this.prisma.mappingVersion.findFirst({
          orderBy: { version: 'desc' },
        });
        if (kind === 'RENORMALIZE' && !mapping)
          throw new AccountingError('NO_MAPPING', 'No mapping version exists');
        const existing = await this.prisma.calculationRun.findFirst({
          where: {
            status: 'RUNNING',
            rangeStart: { lt: new Date(end) },
            rangeEnd: { gt: new Date(start) },
          },
        });
        if (existing)
          throw new AccountingError(
            'RECALC_IN_PROGRESS',
            'An overlapping recalculation is in progress',
          );
        // Raw sample changes, the run, and its recovery dirt share one transaction.
        return await this.prisma.$transaction(
          async (tx) => {
            if (kind === 'RENORMALIZE')
              await this.renormalizer.renormalize(start, end, mapping!, tx);
            const sampled =
              kind === 'RENORMALIZE'
                ? await this.dirtySampleBounds(tx, start, end)
                : { fromBucket: new Date(start), toBucket: new Date(end) };
            // With raw retention longer than sample retention, rows below the sample horizon outside
            // the rebuilt range are authoritative history: dirt never reaches into them.
            const sampleCutoff = ceilBucketMs(
              now.getTime() - this.env.SAMPLE_RETENTION_DAYS * 86_400_000,
            );
            const bounds =
              kind === 'RENORMALIZE' && sampleCutoff > cutoff
                ? {
                    fromBucket:
                      start < sampleCutoff
                        ? new Date(start)
                        : sampled.fromBucket,
                    toBucket:
                      end < sampleCutoff ? new Date(end) : sampled.toBucket,
                  }
                : sampled;
            const run = await tx.calculationRun.create({
              data: {
                kind,
                reason: reason.trim(),
                rangeStart: new Date(start),
                rangeEnd: new Date(end),
                calcVersion: LEDGER_ALGO_VERSION,
                mappingVersion: mapping?.version ?? 0,
                startedAt: now,
                status: 'RUNNING',
              },
            });
            await tx.ledgerDirtyRange.create({
              data: {
                // Recompute interpolation from the actual bounding samples. RENORMALIZE dirt keeps
                // its own reason so the worker applies the raw-retention horizon to it, durably.
                ...bounds,
                reason:
                  kind === 'RENORMALIZE' ? 'RENORMALIZE' : 'RECALC_REQUEST',
              },
            });
            // Mark derived billing results stale atomically with the request.
            // Keeping their old NEM lots permits a precise cascade comparison.
            await tx.$executeRaw`
              UPDATE "BillingPeriodResult" AS r SET "calcVersion" = 0
              FROM "BillingPeriod" AS p
              JOIN "Tariff" AS t ON t."id" = p."tariffId"
              WHERE r."billingPeriodId" = p."id"
                AND (p."startDate"::timestamp AT TIME ZONE t."timezone") < ${new Date(end)}
                AND ((p."endDate" + 1)::timestamp AT TIME ZONE t."timezone") > ${new Date(start)}`;
            if (from.getTime() < cutoff)
              await tx.$executeRaw`
            UPDATE "EnergyInterval" SET "flags" = "flags" | ${LedgerFlag.OUTSIDE_RETENTION}
            WHERE "bucketStart" >= ${new Date(floorBucketMs(from.getTime()))} AND "bucketStart" < ${new Date(start)}`;
            return {
              ...run,
              outsideRetentionBefore:
                from.getTime() < cutoff ? new Date(cutoff) : null,
            };
          },
          { timeout: 3_600_000 },
        );
      } finally {
        await connection.query('SELECT pg_advisory_unlock(716071, 7)');
      }
    } finally {
      connection.release();
    }
  }
}
