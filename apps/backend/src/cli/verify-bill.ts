import { readFile, realpath } from 'node:fs/promises';
import { basename, sep } from 'node:path';
import { parseArgs } from 'node:util';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../db/prisma.service.js';
import { parseRules } from '../tariff/rules.schema.js';
import { BillFixtureSchema, reproduceBill } from '../tariff/bill-fixture.js';
import { isMain } from './is-main.js';

export async function verifyBill(
  prisma: PrismaService,
  versionId: number,
  fixturePath: string,
  output: (line: string) => void = console.log,
  options: { attestRealBill: boolean } = { attestRealBill: false },
): Promise<boolean> {
  if (!Number.isSafeInteger(versionId) || versionId < 1)
    throw new Error('Invalid tariff version id');
  if (
    (await realpath(fixturePath))
      .split(sep)
      .some((segment) => segment.toLowerCase() === 'synthetic')
  )
    throw new Error('Synthetic fixtures cannot verify a tariff version');
  const stat = await readFile(fixturePath);
  if (stat.byteLength > 64 * 1024)
    throw new Error('Bill fixture exceeds 64 KB');
  const input: unknown = JSON.parse(stat.toString('utf8'));
  if (
    input !== null &&
    typeof input === 'object' &&
    'synthetic' in input &&
    input.synthetic === true
  )
    throw new Error('Synthetic fixtures cannot verify a tariff version');
  const fixture = BillFixtureSchema.parse(input);
  const identified = await prisma.tariffVersion.findUnique({
    where: { id: versionId },
    select: { tariffId: true },
  });
  if (!identified) throw new Error('Tariff version not found');
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(716071, ${identified.tariffId}) IS NULL AS locked`;
      const version = await tx.tariffVersion.findUniqueOrThrow({
        where: { id: versionId },
      });
      const rules = parseRules(version.rules);
      const holidays = await tx.tariffHoliday.findMany({
        where: {
          tariffId: version.tariffId,
          date: {
            gte: new Date(`${fixture.periodStartDate}T00:00:00Z`),
            lte: new Date(`${fixture.periodEndDate}T00:00:00Z`),
          },
        },
      });
      const monthlyRates = await tx.tariffMonthlyRate.findMany({
        where: { tariffId: version.tariffId },
      });
      const reproduced = reproduceBill(fixture, rules, {
        holidays: new Set(
          holidays.map((holiday) => holiday.date.toISOString().slice(0, 10)),
        ),
        monthlyRates: monthlyRates.map((rate) => ({
          componentCode: rate.componentCode,
          month: rate.month,
          ratePerKwh: new Decimal(rate.ratePerKwh.toFixed()),
        })),
      });
      for (const line of fixture.lines) {
        const actual =
          reproduced.result?.lineItems.filter(
            (item) => item.code === line.code,
          ) ?? [];
        output(
          `${line.code}: expected ${line.amount}, actual ${
            actual.length && actual.every((item) => item.amount !== null)
              ? actual
                  .reduce((sum, item) => sum.plus(item.amount!), new Decimal(0))
                  .toFixed(2)
              : 'UNAVAILABLE'
          }`,
        );
      }
      output(
        `TOTAL: expected ${fixture.total}, actual ${reproduced.result?.total ?? 'UNAVAILABLE'}`,
      );
      for (const mismatch of reproduced.mismatches)
        output(
          `MISMATCH ${mismatch.line}: expected ${mismatch.expected}, actual ${mismatch.actual}`,
        );
      for (const refusal of reproduced.refusals) output(`REFUSED: ${refusal}`);
      if (!reproduced.ok) return false;
      if (!options.attestRealBill) {
        output(
          'ATTESTATION_REQUIRED: I confirm this fixture was transcribed from a REAL redacted TNB bill; I understand synthetic or engine-generated data must never verify a tariff',
        );
        return false;
      }
      const flags = JSON.stringify({
        consumptionBasis: rules.consumptionBasis,
        thresholdProration: rules.thresholdProration,
        nem: rules.nem
          ? {
              offsetComponents: rules.nem.offsetComponents,
              touOffset: rules.nem.touOffset,
              creditExpiryPeriods: rules.nem.creditExpiryPeriods,
            }
          : null,
        totalRounding: rules.totalRounding,
      });
      await tx.tariffVersion.update({
        where: { id: versionId },
        data: {
          billVerified: true,
          sourceNote: `${version.sourceNote}\nBill-reproduced rule flags: ${flags}\nattested real bill ${basename(fixturePath)} ${new Date().toISOString()}`,
        },
      });
      await tx.billingPeriodResult.updateMany({
        where: {
          period: {
            tariffId: version.tariffId,
            startDate: { lte: version.effectiveTo ?? new Date('9999-12-31') },
            endDate: { gte: version.effectiveFrom },
          },
        },
        data: { calcVersion: 0 },
      });
      output('Bill reproduced; tariff version verified');
      return true;
    },
    { timeout: 120_000, maxWait: 10_000 },
  );
}

export async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      version: { type: 'string' },
      fixture: { type: 'string' },
      'attest-real-bill': { type: 'boolean' },
    },
  });
  if (!values.version || !/^[1-9]\d*$/.test(values.version) || !values.fixture)
    throw new Error(
      'usage: verify-bill --version <tariffVersionId> --fixture <path.json> [--attest-real-bill]',
    );
  const prisma = new PrismaService(process.env);
  try {
    if (
      !(await verifyBill(
        prisma,
        Number(values.version),
        values.fixture,
        console.log,
        { attestRealBill: values['attest-real-bill'] === true },
      ))
    )
      process.exitCode = 1;
  } finally {
    await prisma.close();
  }
}

if (isMain(import.meta.url))
  main(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof Error ? error.message : 'Bill verification failed',
    );
    process.exitCode = 1;
  });
