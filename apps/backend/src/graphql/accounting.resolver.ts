import { Inject } from '@nestjs/common';
import { Args, Context, Int, Mutation, Query, Resolver } from '@nestjs/graphql';
import { GraphQLDateTime, GraphQLLocalDate } from 'graphql-scalars';
import { GraphQLError } from 'graphql';
import { Decimal } from 'decimal.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../db/prisma.service.js';
import { Roles } from '../auth/roles.guard.js';
import type { AuthRequest } from '../auth/token.middleware.js';
import {
  AccountingError,
  AccountingMutations,
} from '../accounting/accounting.mutations.js';
import {
  TotalsService,
  accountingInputError,
} from '../accounting/totals.service.js';
import { SeriesService } from '../accounting/series.service.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import {
  AccountingPolicyChange,
  AccountingPolicyInput,
  AccountingPolicyModel,
  CalculationRunConnection,
  CalculationRunModel,
  DataExclusionInput,
  DataExclusionModel,
  EnergyTotals,
  Granularity,
  MeterReadingConnection,
  MeterReadingInput,
  MeterReadingModel,
  PowerMetric,
  PowerSeries,
  Reconciliation,
} from './accounting.models.js';

function cursorId(after: string | undefined): number | undefined {
  if (after === undefined || after === null) return undefined;
  const decoded = Buffer.from(after, 'base64').toString('utf8');
  const n = Number(decoded);
  if (
    !/^[1-9]\d*$/.test(decoded) ||
    !Number.isSafeInteger(n) ||
    Buffer.from(decoded).toString('base64') !== after
  )
    accountingInputError('Invalid cursor');
  return n;
}
function pageSize(first: number): number {
  if (!Number.isInteger(first) || first < 1 || first > 100)
    accountingInputError('first must be 1..100');
  return first;
}
function accountingError(error: unknown): never {
  if (error instanceof AccountingError)
    throw new GraphQLError(error.message, { extensions: { code: error.code } });
  if (error instanceof RangeError) accountingInputError(error.message);
  throw error;
}
function policyModel(row: { validated: unknown; [key: string]: unknown }) {
  return { ...row, validated: JSON.stringify(row.validated) };
}

@Resolver()
export class AccountingResolver {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TotalsService) private readonly totals: TotalsService,
    @Inject(SeriesService) private readonly series: SeriesService,
    @Inject(ReconciliationService)
    private readonly reconciliationService: ReconciliationService,
    @Inject(AccountingMutations)
    private readonly mutations: AccountingMutations,
  ) {}

  @Query(() => EnergyTotals)
  energyTotals(
    @Args('fromDate', { type: () => GraphQLLocalDate }) fromDate: string,
    @Args('toDate', { type: () => GraphQLLocalDate }) toDate: string,
    @Args('granularity', { type: () => Granularity }) granularity: Granularity,
    @Args('tariffId', {
      type: () => Int,
      nullable: true,
      description:
        'Explicit tariff for gridByWindow; omitted means no window breakdown.',
    })
    tariffId?: number,
  ) {
    return this.totals.energyTotals(fromDate, toDate, granularity, tariffId);
  }

  @Query(() => PowerSeries)
  powerSeries(
    @Args('from', { type: () => GraphQLDateTime }) from: Date,
    @Args('to', { type: () => GraphQLDateTime }) to: Date,
    @Args('metrics', { type: () => [PowerMetric] }) metrics: PowerMetric[],
    @Args('maxPoints', { type: () => Int, defaultValue: 1000 })
    maxPoints: number,
  ) {
    return this.series.powerSeries(from, to, metrics, maxPoints);
  }

  @Query(() => [DataExclusionModel])
  async dataExclusions(
    @Args('first', { type: () => Int, defaultValue: 100 }) first: number,
  ) {
    if (!Number.isInteger(first) || first < 1 || first > 200)
      accountingInputError('first must be 1..200');
    return this.prisma.dataExclusion.findMany({
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: first,
    });
  }

  @Query(() => MeterReadingConnection)
  async meterReadings(
    @Args('first', { type: () => Int, defaultValue: 50 }) first: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    const limit = pageSize(first),
      cursor = cursorId(after);
    const rows = await this.prisma.meterReading.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      edges: page.map((node) => ({
        cursor: Buffer.from(String(node.id)).toString('base64'),
        node,
      })),
      pageInfo: {
        hasNextPage: rows.length > limit,
        endCursor: page.length
          ? Buffer.from(String(page.at(-1)!.id)).toString('base64')
          : null,
      },
    };
  }

  @Query(() => Reconciliation)
  reconciliation(
    @Args('fromReadingId', { type: () => Int }) fromReadingId: number,
    @Args('toReadingId', { type: () => Int }) toReadingId: number,
  ) {
    return this.reconciliationService.reconcile(fromReadingId, toReadingId);
  }

  @Query(() => [AccountingPolicyModel])
  async accountingPolicies() {
    return (
      await this.prisma.accountingPolicy.findMany({
        orderBy: { version: 'asc' },
      })
    ).map(policyModel);
  }

  @Query(() => CalculationRunConnection)
  async calculationRuns(
    @Args('first', { type: () => Int, defaultValue: 20 }) first: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ) {
    const limit = pageSize(first),
      cursor = cursorId(after);
    const rows = await this.prisma.calculationRun.findMany({
      where: cursor ? { id: { gt: cursor } } : undefined,
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      edges: page.map((node) => ({
        cursor: Buffer.from(String(node.id)).toString('base64'),
        node,
      })),
      pageInfo: {
        hasNextPage: rows.length > limit,
        endCursor: page.length
          ? Buffer.from(String(page.at(-1)!.id)).toString('base64')
          : null,
      },
    };
  }

  @Roles('ADMIN')
  @Mutation(() => MeterReadingModel)
  async addMeterReading(@Args('input') input: MeterReadingInput) {
    const amounts = [
      input.importKwh,
      input.exportKwh,
      input.importPeakKwh,
      input.importOffpeakKwh,
    ].filter((v): v is string => v !== undefined && v !== null);
    const representable = (value: string, limit: number) => {
      const decimal = new Decimal(value);
      return (
        decimal.isFinite() &&
        decimal.gte(0) &&
        decimal.lt(limit) &&
        decimal.decimalPlaces() <= 3
      );
    };
    if (
      !Number.isFinite(input.readAt?.getTime()) ||
      amounts.some((value) => !representable(value, 1_000_000_000)) ||
      !representable(input.resolutionKwh ?? '1', 1000) ||
      new Decimal(input.resolutionKwh ?? '1').lte(0)
    )
      accountingInputError('Invalid meter reading');
    try {
      return await this.prisma.meterReading.create({
        data: {
          // oxlint-disable-next-line typescript/no-misused-spread -- GraphQL input class: plain data fields only
          ...input,
          resolutionKwh: input.resolutionKwh ?? '1',
          importKwh: input.importKwh,
          exportKwh: input.exportKwh ?? null,
          importPeakKwh: input.importPeakKwh ?? null,
          importOffpeakKwh: input.importOffpeakKwh ?? null,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        accountingInputError(
          'Meter reading already exists at this time for this source',
        );
      throw error;
    }
  }

  @Roles('ADMIN')
  @Mutation(() => Boolean)
  async deleteMeterReading(@Args('id', { type: () => Int }) id: number) {
    const removed = await this.prisma.meterReading.deleteMany({
      where: { id },
    });
    return removed.count > 0;
  }

  @Roles('ADMIN')
  @Mutation(() => AccountingPolicyChange)
  async createAccountingPolicy(@Args('input') input: AccountingPolicyInput) {
    if (
      !Number.isFinite(input.effectiveFrom?.getTime()) ||
      !Number.isInteger(input.maxGapSec) ||
      input.maxGapSec <= 0 ||
      !['METER_NET', 'METER_PER_PHASE', 'INVERTER_COUNTER'].includes(
        input.gridSource,
      ) ||
      !['COUNTER', 'INTEGRATED'].includes(input.pvSource) ||
      !['COUNTER', 'INTEGRATED'].includes(input.batterySource) ||
      !['DERIVED', 'VENDOR_COUNTER'].includes(input.loadSource) ||
      !input.note.trim()
    )
      accountingInputError('Invalid accounting policy');
    let validated: Record<string, boolean> | undefined;
    if (input.validated !== undefined && input.validated !== null) {
      try {
        const parsed: unknown = JSON.parse(input.validated);
        if (
          !parsed ||
          typeof parsed !== 'object' ||
          Array.isArray(parsed) ||
          Object.values(parsed).some((v) => typeof v !== 'boolean')
        )
          accountingInputError('validated must be a JSON object of booleans');
        validated = parsed as Record<string, boolean>;
      } catch (error) {
        if (error instanceof GraphQLError) throw error;
        accountingInputError('Invalid validated JSON');
      }
    }
    try {
      const change = await this.mutations.createAccountingPolicy({
        // oxlint-disable-next-line typescript/no-misused-spread -- GraphQL input class: plain data fields only
        ...input,
        gridSource: input.gridSource as
          'METER_NET' | 'METER_PER_PHASE' | 'INVERTER_COUNTER',
        pvSource: input.pvSource as 'COUNTER' | 'INTEGRATED',
        batterySource: input.batterySource as 'COUNTER' | 'INTEGRATED',
        loadSource: input.loadSource as 'DERIVED' | 'VENDOR_COUNTER',
        validated,
      });
      return { ...change, policy: policyModel(change.policy) };
    } catch (error) {
      accountingError(error);
    }
  }

  @Roles('ADMIN')
  @Mutation(() => DataExclusionModel)
  async createDataExclusion(
    @Args('input') input: DataExclusionInput,
    @Context() context: { req: AuthRequest },
  ) {
    try {
      return await this.mutations.createDataExclusion(
        input,
        context.req.principal!.name,
      );
    } catch (error) {
      accountingError(error);
    }
  }

  @Roles('ADMIN')
  @Mutation(() => Boolean)
  async deleteDataExclusion(@Args('id', { type: () => Int }) id: number) {
    try {
      return await this.mutations.deleteDataExclusion(id);
    } catch (error) {
      accountingError(error);
    }
  }

  @Roles('ADMIN')
  @Mutation(() => CalculationRunModel)
  async requestRecalculation(
    @Args('kind') kind: string,
    @Args('from', { type: () => GraphQLDateTime }) from: Date,
    @Args('to', { type: () => GraphQLDateTime }) to: Date,
    @Args('reason') reason: string,
  ) {
    if (kind !== 'LEDGER_RECOMPUTE' && kind !== 'RENORMALIZE')
      accountingInputError('Invalid recalculation kind');
    try {
      return await this.mutations.requestRecalculation(kind, from, to, reason);
    } catch (error) {
      accountingError(error);
    }
  }
}
