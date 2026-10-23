import { Inject, Injectable } from '@nestjs/common';
import { DateTime, IANAZone } from 'luxon';
import { Decimal } from 'decimal.js';
import { ZodError } from 'zod';
import { PrismaService } from '../db/prisma.service.js';
import { Prisma, type BillingPeriod } from '../generated/prisma/client.js';
import type { TariffRulesV1 } from './rules.schema.js';
import { parseRules, TARIFF_RULES_SCHEMA_VERSION } from './rules.schema.js';

export class TariffError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly issues?: { path: string; message: string }[],
  ) {
    super(message);
    this.name = 'TariffError';
  }
}

function invalid(message: string): never {
  throw new TariffError('BAD_USER_INPUT', message);
}

export function localDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) invalid('Invalid local date');
  const date = DateTime.fromISO(value, { zone: 'utc' });
  if (!date.isValid || date.toISODate() !== value)
    invalid('Invalid local date');
  return date.toJSDate();
}

function decimalValue(
  value: string,
  places: number,
  integerDigits: number,
): Decimal {
  if (typeof value !== 'string' || !/^-?\d+(\.\d+)?$/.test(value))
    invalid('Invalid decimal');
  const decimal = new Decimal(value);
  if (
    !decimal.isFinite() ||
    decimal.decimalPlaces() > places ||
    decimal.abs().gte(new Decimal(10).pow(integerDigits))
  )
    invalid('Decimal exceeds allowed precision');
  return decimal;
}

function sensitiveKeys(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(sensitiveKeys);
  if (value !== null && typeof value === 'object')
    return Object.entries(value).some(
      ([key, nested]) =>
        /(?:account|address|customer|consumer|owner|person|name|meter.?id|identity|passport|ic(?:number)?|phone|email|postal|postcode)/i.test(
          key,
        ) || sensitiveKeys(nested),
    );
  return false;
}

export interface BillingPeriodInput {
  tariffId: number;
  startDate: string;
  endDate: string;
  openingCreditLots?: { originStart: string; kwh: string }[] | null;
  bill?: unknown;
  note?: string | null;
}

@Injectable()
export class TariffService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async createTariff(input: {
    name: string;
    currency: string;
    timezone: string;
  }) {
    if (
      !input.name?.trim() ||
      !/^[A-Z]{3}$/.test(input.currency) ||
      !IANAZone.isValidZone(input.timezone)
    )
      invalid('Invalid tariff name, currency or IANA timezone');
    return this.prisma.tariff.create({
      data: {
        name: input.name.trim(),
        currency: input.currency,
        timezone: input.timezone,
      },
    });
  }

  async createTariffVersion(
    tariffId: number,
    effectiveFrom: string,
    effectiveTo: string | null | undefined,
    rules: string,
    sourceNote: string,
  ) {
    const from = localDate(effectiveFrom);
    const to = effectiveTo ? localDate(effectiveTo) : null;
    if (to && to < from) invalid('Tariff version end precedes start');
    if (!sourceNote?.trim()) invalid('Tariff version requires a source note');
    if (
      typeof rules !== 'string' ||
      Buffer.byteLength(rules, 'utf8') > 64 * 1024
    )
      invalid('Tariff rules JSON exceeds 64 KB');
    let parsed: unknown;
    try {
      parsed = JSON.parse(rules);
    } catch {
      invalid('Invalid tariff rules JSON');
    }
    let validated: TariffRulesV1;
    try {
      validated = parseRules(parsed);
    } catch (error) {
      if (error instanceof ZodError)
        throw new TariffError(
          'BAD_USER_INPUT',
          'Invalid tariff rules',
          error.issues.map((issue) => ({
            path: issue.path.join('.'),
            message: issue.message,
          })),
        );
      throw error;
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(716071, ${tariffId}) IS NULL AS locked`;
      const tariff = await tx.tariff.findUnique({ where: { id: tariffId } });
      if (!tariff) invalid('Tariff not found');
      if (
        validated.currency !== tariff.currency ||
        validated.timezone !== tariff.timezone
      )
        invalid('Rules currency and timezone must match the tariff');
      const overlap = await tx.tariffVersion.findFirst({
        where: {
          tariffId,
          effectiveFrom: { lte: to ?? new Date('9999-12-31') },
          OR: [{ effectiveTo: null }, { effectiveTo: { gte: from } }],
        },
      });
      if (overlap)
        throw new TariffError(
          'TARIFF_VERSION_OVERLAP',
          'Tariff version dates overlap',
        );
      const version = await tx.tariffVersion.create({
        data: {
          tariffId,
          effectiveFrom: from,
          effectiveTo: to,
          rulesSchemaVersion: TARIFF_RULES_SCHEMA_VERSION,
          rules: validated as Prisma.InputJsonValue,
          sourceNote: sourceNote.trim(),
          billVerified: false,
        },
      });
      await tx.billingPeriodResult.updateMany({
        where: {
          period: {
            tariffId,
            startDate: { lte: to ?? new Date('9999-12-31') },
            endDate: { gte: from },
          },
        },
        data: { calcVersion: 0 },
      });
      return version;
    });
  }

  async setTariffHolidays(
    tariffId: number,
    year: number,
    holidays: { date: string; name: string }[],
  ) {
    if (
      !Number.isInteger(year) ||
      year < 1900 ||
      year > 9998 ||
      !Array.isArray(holidays)
    )
      invalid('Invalid holiday year');
    const dates = holidays.map((holiday) => {
      const date = localDate(holiday.date);
      if (!holiday.date.startsWith(`${year}-`) || !holiday.name?.trim())
        invalid('Holiday must have a name and fall in the selected year');
      return { tariffId, date, name: holiday.name.trim() };
    });
    if (new Set(dates.map((d) => d.date.getTime())).size !== dates.length)
      invalid('Duplicate holiday date');
    const from = localDate(`${year}-01-01`),
      to = localDate(`${year}-12-31`);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(716071, ${tariffId}) IS NULL AS locked`;
      if (!(await tx.tariff.findUnique({ where: { id: tariffId } })))
        invalid('Tariff not found');
      await tx.tariffHoliday.deleteMany({
        where: { tariffId, date: { gte: from, lte: to } },
      });
      if (dates.length) await tx.tariffHoliday.createMany({ data: dates });
      // A bill gate is tied to the exact tariff inputs used in reproduction.
      const revoked = await tx.tariffVersion.updateMany({
        where: { tariffId, billVerified: true },
        data: { billVerified: false },
      });
      await tx.billingPeriodResult.updateMany({
        where: {
          period: revoked.count
            ? { tariffId }
            : { tariffId, startDate: { lte: to }, endDate: { gte: from } },
        },
        data: { calcVersion: 0 },
      });
      return tx.tariffHoliday.findMany({
        where: { tariffId, date: { gte: from, lte: to } },
        orderBy: { date: 'asc' },
      });
    });
  }

  async setMonthlyRate(
    tariffId: number,
    componentCode: string,
    month: string,
    ratePerKwh: string,
    sourceNote: string,
  ) {
    if (
      !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) ||
      !componentCode?.trim() ||
      !sourceNote?.trim()
    )
      invalid('Invalid monthly rate input');
    const rate = decimalValue(ratePerKwh, 6, 6);
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(716071, ${tariffId}) IS NULL AS locked`;
      const versions = await tx.tariffVersion.findMany({
        where: { tariffId },
        select: { rules: true },
      });
      if (
        !versions.some((version) =>
          parseRules(version.rules).components.some(
            (component) =>
              component.code === componentCode &&
              component.kind === 'PER_KWH_MONTHLY',
          ),
        )
      )
        invalid('No monthly component with this code exists for this tariff');
      const row = await tx.tariffMonthlyRate.upsert({
        where: {
          tariffId_componentCode_month: { tariffId, componentCode, month },
        },
        create: {
          tariffId,
          componentCode,
          month,
          ratePerKwh: rate.toFixed(6),
          sourceNote: sourceNote.trim(),
        },
        update: { ratePerKwh: rate.toFixed(6), sourceNote: sourceNote.trim() },
      });
      const revoked = await tx.tariffVersion.updateMany({
        where: { tariffId, billVerified: true },
        data: { billVerified: false },
      });
      const start = localDate(`${month}-01`);
      const end = DateTime.fromJSDate(start, { zone: 'utc' })
        .plus({ months: 1 })
        .minus({ days: 1 })
        .toJSDate();
      await tx.billingPeriodResult.updateMany({
        where: {
          period: revoked.count
            ? { tariffId }
            : { tariffId, startDate: { lte: end }, endDate: { gte: start } },
        },
        data: { calcVersion: 0 },
      });
      return row;
    });
  }

  async upsertBillingPeriod(input: BillingPeriodInput): Promise<BillingPeriod> {
    const startDate = localDate(input.startDate),
      endDate = localDate(input.endDate);
    const days =
      Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1;
    if (days < 1 || days > 400) invalid('Billing period must span 1..400 days');
    const opening =
      input.openingCreditLots?.map((lot) => {
        localDate(lot.originStart);
        if (lot.originStart > input.startDate)
          invalid('Credit lot origin cannot be in the future');
        const value = decimalValue(lot.kwh, 12, 9);
        if (value.isNegative()) invalid('Credit lot kWh must be non-negative');
        return { originStart: lot.originStart, kwh: value.toString() };
      }) ?? null;
    if (input.bill !== undefined && input.bill !== null) {
      let size: number;
      try {
        size = Buffer.byteLength(JSON.stringify(input.bill), 'utf8');
      } catch {
        invalid('Bill must be valid JSON');
      }
      if (size > 64 * 1024 || sensitiveKeys(input.bill))
        invalid('Bill exceeds 64 KB or contains identifying keys');
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(716071, ${input.tariffId}) IS NULL AS locked`;
      if (!(await tx.tariff.findUnique({ where: { id: input.tariffId } })))
        invalid('Tariff not found');
      const existing = await tx.billingPeriod.findUnique({
        where: { tariffId_startDate: { tariffId: input.tariffId, startDate } },
      });
      const overlap = await tx.billingPeriod.findFirst({
        where: {
          tariffId: input.tariffId,
          id: existing ? { not: existing.id } : undefined,
          startDate: { lte: endDate },
          endDate: { gte: startDate },
        },
      });
      if (overlap)
        throw new TariffError(
          'BILLING_PERIOD_OVERLAP',
          'Billing periods overlap',
        );
      const data = {
        endDate,
        ...(input.openingCreditLots !== undefined || !existing
          ? {
              openingCreditLots:
                opening === null
                  ? Prisma.DbNull
                  : (opening as Prisma.InputJsonValue),
            }
          : {}),
        ...(input.bill !== undefined || !existing
          ? {
              bill:
                input.bill === undefined || input.bill === null
                  ? Prisma.DbNull
                  : (input.bill as Prisma.InputJsonValue),
            }
          : {}),
        ...(input.note !== undefined || !existing
          ? { note: input.note?.trim() ?? null }
          : {}),
      };
      const period = existing
        ? await tx.billingPeriod.update({ where: { id: existing.id }, data })
        : await tx.billingPeriod.create({
            data: { tariffId: input.tariffId, startDate, ...data },
          });
      await tx.billingPeriodResult.updateMany({
        where: { billingPeriodId: period.id },
        data: { calcVersion: 0 },
      });
      if (existing && existing.endDate.getTime() !== endDate.getTime()) {
        const next = await tx.billingPeriod.findFirst({
          where: { tariffId: input.tariffId, startDate: { gt: startDate } },
          orderBy: { startDate: 'asc' },
          select: { id: true },
        });
        if (next)
          await tx.billingPeriodResult.updateMany({
            where: { billingPeriodId: next.id },
            data: { calcVersion: 0 },
          });
      }
      return period;
    });
  }
}
