import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { Inject } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLLocalDate } from 'graphql-scalars';
import { GraphQLError } from 'graphql';
import { PrismaService } from '../db/prisma.service.js';
import {
  type BillingPeriod,
  type BillingPeriodResult,
  type TariffVersion,
} from '../generated/prisma/client.js';
import { Roles } from '../auth/roles.guard.js';
import {
  BillingService,
  billingResultFingerprint,
  type BillingFreshness,
} from '../tariff/billing.service.js';
import { TariffService, TariffError } from '../tariff/tariff.service.js';
import {
  BillingPeriodConnection,
  BillingPeriodInputModel,
  BillingPeriodModel,
  HolidayInputModel,
  TariffHolidayModel,
  TariffInputModel,
  TariffModel,
  TariffMonthlyRateModel,
  TariffVersionModel,
} from './tariff.models.js';
import { DecimalScalar } from './scalars/decimal.scalar.js';

interface BillingRequestContext {
  billingComputeUsed?: boolean;
  billingFreshness?: Map<number, Promise<Map<number, BillingFreshness>>>;
}
const StoredLot = z.object({ originStart: z.iso.date(), kwh: z.string() });
const StoredNem = z.object({
  openingLots: z.array(StoredLot),
  expiredLots: z.array(StoredLot),
  closingLots: z.array(StoredLot),
});

function fail(error: unknown): never {
  if (error instanceof TariffError)
    throw new GraphQLError(error.message, {
      extensions: {
        code: error.code,
        ...(error.issues ? { issues: error.issues } : {}),
      },
    });
  if (error instanceof SyntaxError || error instanceof RangeError)
    throw new GraphQLError('Invalid input', {
      extensions: { code: 'BAD_USER_INPUT' },
    });
  throw error;
}
function versionModel(row: TariffVersion) {
  return {
    ...row,
    effectiveFrom: row.effectiveFrom.toISOString().slice(0, 10),
    effectiveTo: row.effectiveTo?.toISOString().slice(0, 10) ?? null,
    rules: JSON.stringify(row.rules),
  };
}
function periodModel(
  row: BillingPeriod & { result?: BillingPeriodResult | null },
  stale: boolean,
) {
  const result = row.result;
  const nem =
    result?.nem === null || result?.nem === undefined
      ? null
      : StoredNem.parse(result.nem);
  const visibleLot = (lot: z.infer<typeof StoredLot>) => ({
    ...lot,
    // Decimal scalar exposes six places; never round UP displayed credit or
    // truncate the actual bank stored in BillingPeriodResult.nem.
    kwh: /^\d+(?:\.\d{1,6})?$/.test(lot.kwh)
      ? lot.kwh
      : new Decimal(lot.kwh).toDecimalPlaces(6, Decimal.ROUND_DOWN).toFixed(6),
  });
  return {
    stale,
    ...row,
    startDate: row.startDate.toISOString().slice(0, 10),
    endDate: row.endDate.toISOString().slice(0, 10),
    result: result
      ? {
          ...result,
          subtotal: result.subtotal?.toFixed(2) ?? null,
          total: result.total?.toFixed(2) ?? null,
          coverage: result.coverage.toFixed(4),
          nem: nem
            ? {
                openingLots: nem.openingLots.map(visibleLot),
                expiredLots: nem.expiredLots.map(visibleLot),
                closingLots: nem.closingLots.map(visibleLot),
              }
            : null,
          lineItems: result.lineItems,
        }
      : null,
  };
}
function idFromCursor(after?: string): number | undefined {
  if (after === undefined || after === null) return undefined;
  const value = Buffer.from(after, 'base64').toString('utf8');
  const id = Number(value);
  if (
    !/^[1-9]\d*$/.test(value) ||
    !Number.isSafeInteger(id) ||
    Buffer.from(value).toString('base64') !== after
  )
    throw new TariffError('BAD_USER_INPUT', 'Invalid cursor');
  return id;
}

@Resolver()
export class TariffResolver {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TariffService) private readonly tariff: TariffService,
    @Inject(BillingService) private readonly billing: BillingService,
  ) {}

  private async freshness(
    row: BillingPeriod & { result?: BillingPeriodResult | null },
    context: BillingRequestContext,
  ): Promise<boolean> {
    context.billingFreshness ??= new Map();
    let snapshot = context.billingFreshness.get(row.tariffId);
    if (!snapshot) {
      snapshot = this.billing.freshnessForTariff(row.tariffId, new Date());
      context.billingFreshness.set(row.tariffId, snapshot);
    }
    const evaluated = (await snapshot).get(row.id);
    return (
      !evaluated ||
      evaluated.stale ||
      (row.result?.computedAt.getTime() ?? null) !==
        evaluated.resultComputedAtMs ||
      (row.result?.calcVersion ?? null) !== evaluated.resultCalcVersion ||
      billingResultFingerprint(row.result) !== evaluated.resultFingerprint
    );
  }

  private async refreshOne(
    row: BillingPeriod & { result?: BillingPeriodResult | null },
    context: BillingRequestContext,
  ): Promise<boolean> {
    context.billingComputeUsed = true;
    await this.billing.computePeriod(row.id, new Date(), false);
    row.result = await this.prisma.billingPeriodResult.findUnique({
      where: { billingPeriodId: row.id },
    });
    const stale = await this.billing.isStale(row, new Date());
    (await context.billingFreshness!.get(row.tariffId)!).set(row.id, {
      stale,
      resultComputedAtMs: row.result?.computedAt.getTime() ?? null,
      resultCalcVersion: row.result?.calcVersion ?? null,
      resultFingerprint: billingResultFingerprint(row.result),
    });
    return stale;
  }

  @Query(() => [TariffModel])
  async tariffs() {
    return (
      await this.prisma.tariff.findMany({
        include: { versions: { orderBy: { effectiveFrom: 'asc' } } },
        orderBy: { id: 'asc' },
      })
    ).map((row) => ({ ...row, versions: row.versions.map(versionModel) }));
  }

  @Query(() => [TariffHolidayModel])
  async tariffHolidays(
    @Args('tariffId', { type: () => Int }) tariffId: number,
    @Args('year', { type: () => Int }) year: number,
  ) {
    try {
      if (!Number.isInteger(year) || year < 1900 || year > 9998)
        throw new TariffError('BAD_USER_INPUT', 'Invalid holiday year');
      const rows = await this.prisma.tariffHoliday.findMany({
        where: {
          tariffId,
          date: {
            gte: new Date(`${year}-01-01T00:00:00Z`),
            lte: new Date(`${year}-12-31T00:00:00Z`),
          },
        },
        orderBy: { date: 'asc' },
      });
      return rows.map((row) => ({
        ...row,
        date: row.date.toISOString().slice(0, 10),
      }));
    } catch (error) {
      fail(error);
    }
  }

  @Query(() => [TariffMonthlyRateModel])
  async tariffMonthlyRates(
    @Args('tariffId', { type: () => Int }) tariffId: number,
  ) {
    return this.prisma.tariffMonthlyRate.findMany({
      where: { tariffId },
      orderBy: [{ month: 'asc' }, { componentCode: 'asc' }],
    });
  }

  @Query(() => BillingPeriodModel, { nullable: true })
  async billingPeriod(
    @Args('id', { type: () => Int }) id: number,
    @Context() context: BillingRequestContext,
  ) {
    const row = await this.prisma.billingPeriod.findUnique({
      where: { id },
      include: { tariff: true, result: true },
    });
    if (!row) return null;
    let stale = await this.freshness(row, context);
    if (stale && !context.billingComputeUsed)
      stale = await this.refreshOne(row, context);
    return periodModel(row, stale);
  }

  @Query(() => BillingPeriodConnection)
  async billingPeriods(
    @Args('first', { type: () => Int, defaultValue: 24 }) first: number,
    @Args('after', { type: () => String, nullable: true })
    after: string | undefined,
    @Context() context: BillingRequestContext,
  ) {
    try {
      if (!Number.isInteger(first) || first < 1 || first > 100)
        throw new TariffError('BAD_USER_INPUT', 'first must be 1..100');
      const cursor = idFromCursor(after);
      const rows = await this.prisma.billingPeriod.findMany({
        where: cursor ? { id: { gt: cursor } } : undefined,
        include: { tariff: true, result: true },
        orderBy: { id: 'asc' },
        take: first + 1,
      });
      const page = rows.slice(0, first);
      // One compute per request; other results are explicitly marked stale.
      const stale: boolean[] = [];
      for (const row of page) {
        let needsRefresh = await this.freshness(row, context);
        if (needsRefresh && !context.billingComputeUsed)
          needsRefresh = await this.refreshOne(row, context);
        stale.push(needsRefresh);
      }
      return {
        edges: page.map((node, index) => ({
          cursor: Buffer.from(String(node.id)).toString('base64'),
          node: periodModel(node, stale[index]!),
        })),
        pageInfo: {
          hasNextPage: rows.length > first,
          endCursor: page.length
            ? Buffer.from(String(page.at(-1)!.id)).toString('base64')
            : null,
        },
      };
    } catch (error) {
      fail(error);
    }
  }

  @Roles('ADMIN')
  @Mutation(() => TariffModel)
  async createTariff(@Args('input') input: TariffInputModel) {
    try {
      return { ...(await this.tariff.createTariff(input)), versions: [] };
    } catch (error) {
      fail(error);
    }
  }

  @Roles('ADMIN')
  @Mutation(() => TariffVersionModel)
  async createTariffVersion(
    @Args('tariffId', { type: () => Int }) tariffId: number,
    @Args('effectiveFrom', { type: () => GraphQLLocalDate })
    effectiveFrom: string,
    @Args('effectiveTo', { type: () => GraphQLLocalDate, nullable: true })
    effectiveTo: string | null,
    @Args('rules') rules: string,
    @Args('sourceNote') sourceNote: string,
  ) {
    try {
      return versionModel(
        await this.tariff.createTariffVersion(
          tariffId,
          effectiveFrom,
          effectiveTo,
          rules,
          sourceNote,
        ),
      );
    } catch (error) {
      fail(error);
    }
  }

  @Roles('ADMIN')
  @Mutation(() => [TariffHolidayModel])
  async setTariffHolidays(
    @Args('tariffId', { type: () => Int }) tariffId: number,
    @Args('year', { type: () => Int }) year: number,
    @Args('holidays', { type: () => [HolidayInputModel] })
    holidays: HolidayInputModel[],
  ) {
    try {
      return (
        await this.tariff.setTariffHolidays(tariffId, year, holidays)
      ).map((row) => ({ ...row, date: row.date.toISOString().slice(0, 10) }));
    } catch (error) {
      fail(error);
    }
  }

  @Roles('ADMIN')
  @Mutation(() => TariffMonthlyRateModel)
  async setMonthlyRate(
    @Args('tariffId', { type: () => Int }) tariffId: number,
    @Args('componentCode') componentCode: string,
    @Args('month') month: string,
    @Args('ratePerKwh', { type: () => DecimalScalar }) ratePerKwh: string,
    @Args('sourceNote') sourceNote: string,
  ) {
    try {
      return await this.tariff.setMonthlyRate(
        tariffId,
        componentCode,
        month,
        ratePerKwh,
        sourceNote,
      );
    } catch (error) {
      fail(error);
    }
  }

  @Roles('ADMIN')
  @Mutation(() => BillingPeriodModel)
  async upsertBillingPeriod(@Args('input') input: BillingPeriodInputModel) {
    try {
      const bill =
        input.bill === undefined
          ? undefined
          : input.bill === null
            ? null
            : JSON.parse(input.bill);
      const period = await this.tariff.upsertBillingPeriod({
        tariffId: input.tariffId,
        startDate: input.startDate,
        endDate: input.endDate,
        openingCreditLots:
          input.openingCreditLots?.map((lot) => ({
            originStart: lot.originStart,
            kwh: lot.kwh,
          })) ?? input.openingCreditLots,
        bill,
        note: input.note,
      });
      return periodModel(period, true);
    } catch (error) {
      fail(error);
    }
  }
}
