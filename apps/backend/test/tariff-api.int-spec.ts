import { Decimal } from 'decimal.js';
import { computeBill } from '../src/tariff/engine.js';
import { parseRules } from '../src/tariff/rules.schema.js';
import { z } from 'zod';
import { BillFixtureSchema } from '../src/tariff/bill-fixture.js';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { parseEnv } from '../src/config/env.js';
import { createApp } from '../src/main.js';
import { TokenService } from '../src/auth/token.service.js';
import { TlsService } from '../src/tls/tls.service.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { main as verifyBillCli, verifyBill } from '../src/cli/verify-bill.js';
import { TariffService } from '../src/tariff/tariff.service.js';
import { BillingService } from '../src/tariff/billing.service.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

interface Response {
  data?: Record<string, unknown>;
  errors?: {
    message: string;
    extensions: { code: string; issues?: { path: string; message: string }[] };
  }[];
}
const flat = {
  currency: 'MYR',
  timezone: 'UTC',
  touWindows: [],
  defaultWindow: 'OFFPEAK',
  consumptionBasis: 'GROSS_IMPORT',
  thresholdProration: 'NONE',
  nem: null,
  components: [
    {
      code: 'TEST_ENERGY',
      label: 'Synthetic flat charge',
      kind: 'PER_KWH',
      basis: 'IMPORT',
      tierMode: 'INCREMENTAL',
      rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '0.50' }] }],
    },
  ],
  totalRounding: 'NONE',
};

describe('tariff API and bill reproduction', () => {
  let db: TestDatabase,
    app: INestApplication,
    prisma: PrismaService,
    tls: TlsService;
  let dir: string, port: number, viewer: string, admin: string;
  function request(
    query: string,
    token: string,
    variables?: object,
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const outgoing = https.request(
        {
          hostname: '127.0.0.1',
          port,
          path: '/graphql',
          method: 'POST',
          ca: tls.cert,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
        },
        (incoming) => {
          const parts: Buffer[] = [];
          incoming.on('data', (chunk: Buffer) => parts.push(chunk));
          incoming.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(parts).toString()) as Response);
            } catch (error) {
              reject(error);
            }
          });
        },
      );
      outgoing.on('error', reject);
      outgoing.end(JSON.stringify({ query, variables }));
    });
  }
  beforeAll(async () => {
    db = await createTestDatabase();
    dir = await mkdtemp(join(tmpdir(), 'solar-tariff-api-'));
    const env = parseEnv({
      DATABASE_URL: db.url,
      COLLECTOR_ENABLED: 'false',
      SITE_TIMEZONE: 'UTC',
      TLS_DIR: dir,
      BACKUP_DIR: dir,
    });
    tls = await TlsService.load(env);
    prisma = new PrismaService({ DATABASE_URL: db.url });
    app = await createApp(env, { tlsService: tls, schemaFile: true, prisma });
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
    viewer = (await app.get(TokenService).create('tariff-viewer', 'VIEWER'))
      .token;
    admin = (await app.get(TokenService).create('tariff-admin', 'ADMIN')).token;
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('enforces tariff API roles and exercises bill attestation mechanism without V18', async () => {
    const create =
      'mutation { createTariff(input:{name:"Synthetic",currency:"MYR",timezone:"UTC"}) { id currency versions { id } } }';
    expect((await request(create, viewer)).errors?.[0]?.extensions.code).toBe(
      'FORBIDDEN',
    );
    const created = await request(create, admin);
    expect(created.errors).toBeUndefined();
    const tariffId = z
      .object({ id: z.number() })
      .parse(created.data?.createTariff).id;
    const invalid = await request(
      'mutation($id:Int!,$rules:String!) { createTariffVersion(tariffId:$id,effectiveFrom:"2026-11-01",rules:$rules,sourceNote:"synthetic") { id } }',
      admin,
      {
        id: tariffId,
        rules: JSON.stringify({
          ...flat,
          components: [{ ...flat.components[0], rates: [] }],
        }),
      },
    );
    expect(invalid.errors?.[0]?.extensions.code).toBe('BAD_USER_INPUT');
    expect(
      invalid.errors?.[0]?.extensions.issues?.some((issue) =>
        issue.path.includes('components'),
      ),
    ).toBe(true);
    const versionMutation =
      'mutation($id:Int!,$rules:String!) { createTariffVersion(tariffId:$id,effectiveFrom:"2026-11-01",rules:$rules,sourceNote:"synthetic") { id billVerified rules } }';
    const version = await request(versionMutation, admin, {
      id: tariffId,
      rules: JSON.stringify(flat),
    });
    expect(version.errors).toBeUndefined();
    expect(version.data?.createTariffVersion).toMatchObject({
      billVerified: false,
    });
    const versionId = z
      .object({ id: z.number() })
      .parse(version.data?.createTariffVersion).id;
    const overlap = await request(versionMutation, admin, {
      id: tariffId,
      rules: JSON.stringify(flat),
    });
    expect(overlap.errors?.[0]?.extensions.code).toBe('TARIFF_VERSION_OVERLAP');
    const deniedBatch = await request(
      'mutation($id:Int!,$rules:String!) { v:createTariffVersion(tariffId:$id,effectiveFrom:"2026-12-01",rules:$rules,sourceNote:"Fake") { id } h:setTariffHolidays(tariffId:$id,year:2026,holidays:[]) { name } r:setMonthlyRate(tariffId:$id,componentCode:"TEST_ENERGY",month:"2026-11",ratePerKwh:"0.10",sourceNote:"Fake") { month } p:upsertBillingPeriod(input:{tariffId:$id,startDate:"2026-12-01",endDate:"2026-12-01"}) { id } }',
      viewer,
      { id: tariffId, rules: JSON.stringify(flat) },
    );
    expect(deniedBatch.errors?.map((error) => error.extensions.code)).toEqual([
      'FORBIDDEN',
    ]);
    for (const mutation of [
      'setTariffHolidays(tariffId:1,year:2026,holidays:[]) { name }',
      'setMonthlyRate(tariffId:1,componentCode:"TEST_ENERGY",month:"2026-11",ratePerKwh:"0.10",sourceNote:"Fake") { month }',
      'upsertBillingPeriod(input:{tariffId:1,startDate:"2026-12-01",endDate:"2026-12-01"}) { id }',
    ]) {
      const denied = await request(`mutation { alias:${mutation} }`, viewer);
      expect(denied.errors?.[0]?.extensions.code).toBe('FORBIDDEN');
    }
    const unknownField = await request(
      'mutation { createTariffVersion(tariffId:1,effectiveFrom:"2026-11-01",rules:"{}",sourceNote:"x",billVerified:true) { id } }',
      admin,
    );
    expect(unknownField.errors?.[0]?.extensions.code).toBe(
      'GRAPHQL_VALIDATION_FAILED',
    );
    const period = await request(
      'mutation($id:Int!) { upsertBillingPeriod(input:{tariffId:$id,startDate:"2026-11-03",endDate:"2026-11-03",openingCreditLots:[]}) { id result { status total } } }',
      admin,
      { id: tariffId },
    );
    expect(period.errors).toBeUndefined();
    const periodId = z
      .object({ id: z.number() })
      .parse(period.data?.upsertBillingPeriod).id;
    const read = await request(
      `{ tariffs { id versions { id rules billVerified } } billingPeriod(id:${periodId}) { id result { status coverage total reasons isLowerBound nem { closingLots { kwh } } } } }`,
      viewer,
    );
    expect(read.errors).toBeUndefined();
    const detail = z
      .object({
        result: z.object({ status: z.string(), coverage: z.string() }),
      })
      .parse(read.data?.billingPeriod);
    expect(detail.result.status).toBe('UNAVAILABLE');
    expect(detail.result.coverage).toBe('0.0000');
    const start = new Date('2026-11-03T00:00:00Z').getTime();
    await prisma.energyInterval.createMany({
      data: Array.from({ length: 288 }, (_, index) => ({
        bucketStart: new Date(start + index * 300_000),
        calcVersion: 1,
        maxGapSecUsed: 30,
        mappingVersion: 0,
        computedAt: new Date(Date.now() + 1_000),
        gridImportNetWh: index === 0 ? '100000.000' : '0.000',
        gridExportNetWh: '0.000',
        gridCoveredSec: 300,
        pvCoveredSec: 300,
        batCoveredSec: 300,
        loadCoveredSec: 300,
        counterUnknownSec: [0, 0, 0, 0, 0, 0],
        counterGapAllocMask: 0,
        flags: 0,
      })),
    });
    const priced = await request(
      `{ billingPeriod(id:${periodId}) { result { total subtotal coverage lineItems { amount quantityKwh } } } }`,
      viewer,
    );
    expect(priced.errors).toBeUndefined();
    expect(
      z
        .object({
          result: z.object({
            total: z.string(),
            subtotal: z.string(),
            coverage: z.string(),
          }),
        })
        .parse(priced.data?.billingPeriod).result,
    ).toMatchObject({ total: '50.00', subtotal: '50.00', coverage: '1.0000' });
    const oversized = await request(
      '{ billingPeriods(first:101) { edges { cursor } } }',
      viewer,
    );
    expect(oversized.errors?.[0]?.extensions.code).toBe('BAD_USER_INPUT');
    const page = await request(
      '{ billingPeriods(first:1) { edges { cursor node { id result { total } } } pageInfo { endCursor hasNextPage } } }',
      viewer,
    );
    expect(page.errors).toBeUndefined();
    expect(
      z.object({ edges: z.array(z.unknown()) }).parse(page.data?.billingPeriods)
        .edges,
    ).toHaveLength(1);
    const serviceForBudget = app.get(TariffService);
    const pendingA = await serviceForBudget.upsertBillingPeriod({
      tariffId,
      startDate: '2026-11-04',
      endDate: '2026-11-04',
      openingCreditLots: [],
    });
    const pendingB = await serviceForBudget.upsertBillingPeriod({
      tariffId,
      startDate: '2026-11-05',
      endDate: '2026-11-05',
      openingCreditLots: [],
    });
    const bounded = await request(
      `{ a: billingPeriod(id:${pendingA.id}) { id stale } b: billingPeriod(id:${pendingB.id}) { id stale } }`,
      viewer,
    );
    expect(bounded.errors).toBeUndefined();
    expect(bounded.data).toMatchObject({
      a: { stale: false },
      b: { stale: true },
    });
    expect(
      await prisma.billingPeriodResult.count({
        where: { billingPeriodId: { in: [pendingA.id, pendingB.id] } },
      }),
    ).toBe(1);
    await app.get(BillingService).computePeriod(pendingB.id, new Date(), false);
    await prisma.billingPeriodResult.updateMany({
      where: { billingPeriodId: { in: [pendingA.id, pendingB.id] } },
      data: { calcVersion: 0 },
    });
    const marked = await request(
      `{ a: billingPeriod(id:${pendingA.id}) { stale result { status } } b: billingPeriod(id:${pendingB.id}) { stale result { status } } }`,
      viewer,
    );
    expect(marked.errors).toBeUndefined();
    expect(marked.data).toMatchObject({
      a: { stale: false, result: { status: 'UNAVAILABLE' } },
      b: { stale: true, result: { status: 'UNAVAILABLE' } },
    });
    await prisma.billingPeriodResult.updateMany({
      where: { billingPeriodId: { in: [pendingA.id, pendingB.id] } },
      data: { calcVersion: 0 },
    });
    const list = await request(
      '{ billingPeriods(first:3) { edges { node { id stale result { status } } } } }',
      viewer,
    );
    expect(list.errors).toBeUndefined();
    const listed = z
      .object({
        edges: z.array(
          z.object({
            node: z.object({
              id: z.number(),
              stale: z.boolean(),
              result: z.object({ status: z.string() }),
            }),
          }),
        ),
      })
      .parse(list.data?.billingPeriods).edges;
    expect(
      listed
        .filter(({ node }) => [pendingA.id, pendingB.id].includes(node.id))
        .some(({ node }) => node.stale),
    ).toBe(true);
    await expect(
      serviceForBudget.upsertBillingPeriod({
        tariffId,
        startDate: '2026-11-04',
        endDate: '2026-11-05',
      }),
    ).rejects.toMatchObject({ code: 'BILLING_PERIOD_OVERLAP' });
    await expect(
      serviceForBudget.upsertBillingPeriod({
        tariffId,
        startDate: '2026-12-01',
        endDate: '2026-12-01',
        bill: { printed: { accountNumber: 'not-stored' } },
      }),
    ).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
    await expect(
      serviceForBudget.upsertBillingPeriod({
        tariffId,
        startDate: '2026-12-01',
        endDate: '2026-12-01',
        bill: { summary: 'x'.repeat(65_537) },
      }),
    ).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
    await expect(
      serviceForBudget.upsertBillingPeriod({
        tariffId,
        startDate: '2026-01-01',
        endDate: '2027-02-05',
      }),
    ).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
    await expect(
      serviceForBudget.setMonthlyRate(
        tariffId,
        'NOT_A_COMPONENT',
        '2026-11',
        '0.250000',
        'Synthetic',
      ),
    ).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
    const syntheticFixture = join(
      import.meta.dirname,
      'fixtures',
      'bills',
      'synthetic',
      'matching.json',
    );
    await expect(
      verifyBill(prisma, versionId, syntheticFixture, () => {}),
    ).rejects.toThrow(/Synthetic/);
    expect(
      (
        await prisma.tariffVersion.findUniqueOrThrow({
          where: { id: versionId },
        })
      ).billVerified,
    ).toBe(false);
    const fixturePath = join(dir, 'redacted-test-bill.json');
    await writeFile(fixturePath, await readFile(syntheticFixture));
    await expect(
      verifyBill(prisma, versionId, fixturePath, () => {}, {
        attestRealBill: true,
      }),
    ).rejects.toThrow(/Synthetic/);
    const computed = computeBill({
      segments: [
        {
          versionId,
          rules: parseRules(flat),
          quantities: {
            startDate: '2026-11-03',
            endDate: '2026-12-02',
            days: 30,
            windows: [
              {
                window: 'OFFPEAK',
                importKwh: new Decimal(100),
                exportKwh: new Decimal(0),
              },
            ],
            importByMonth: { '2026-11': new Decimal(100) },
          },
        },
      ],
      monthlyRates: [],
      nemOpening: { lots: [] },
      context: {
        coverage: 1,
        periodDays: 30,
        periodStartDate: '2026-11-03',
        periodInProgress: false,
        startsBeforeMonitoring: false,
        entirelyBeforeMonitoring: false,
        noTariffVersion: false,
        vendorDataOnly: false,
        holidayCalendarMissing: false,
        touAllocationEstimated: false,
        accountingUnreconciled: false,
        mappingProvisional: false,
        calcParamsPartialRecompute: false,
        allVersionsBillVerified: false,
      },
    });
    const matching = BillFixtureSchema.parse({
      periodStartDate: '2026-11-03',
      periodEndDate: '2026-12-02',
      importPeakKwh: '100.000',
      importOffpeakKwh: '0.000',
      exportKwh: '0.000',
      lines: computed.lineItems
        .filter((item) => item.amount !== null)
        .map((item) => ({ code: item.code, amount: item.amount })),
      total: computed.total,
      openingLots: [],
      closingLots: [],
    });
    await writeFile(
      fixturePath,
      JSON.stringify({ ...matching, total: '99.99' }),
    );
    expect(
      await verifyBill(prisma, versionId, fixturePath, () => {}, {
        attestRealBill: true,
      }),
    ).toBe(false);
    const previousUrl = process.env.DATABASE_URL;
    const previousCode = process.exitCode;
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.env.DATABASE_URL = db.url;
      process.exitCode = 0;
      await verifyBillCli([
        '--version',
        String(versionId),
        '--fixture',
        fixturePath,
      ]);
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousCode;
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
      log.mockRestore();
    }
    expect(
      (
        await prisma.tariffVersion.findUniqueOrThrow({
          where: { id: versionId },
        })
      ).billVerified,
    ).toBe(false);
    await writeFile(fixturePath, JSON.stringify(matching));
    // This engine-generated fixture proves the CLI mechanism only. It is NOT a
    // real bill and cannot fulfill V18; attestation is simulated in this disposable DB.
    const attestationMessages: string[] = [];
    expect(
      await verifyBill(prisma, versionId, fixturePath, (line) =>
        attestationMessages.push(line),
      ),
    ).toBe(false);
    expect(
      attestationMessages.some((line) =>
        line.startsWith('ATTESTATION_REQUIRED'),
      ),
    ).toBe(true);
    expect(
      (
        await prisma.tariffVersion.findUniqueOrThrow({
          where: { id: versionId },
        })
      ).billVerified,
    ).toBe(false);
    const beforeCli = process.env.DATABASE_URL;
    const beforeExit = process.exitCode;
    const cliOutput = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.env.DATABASE_URL = db.url;
      process.exitCode = 0;
      await verifyBillCli([
        '--version',
        String(versionId),
        '--fixture',
        fixturePath,
      ]);
      expect(process.exitCode).toBe(1);
      expect(
        cliOutput.mock.calls.some(([line]) =>
          String(line).startsWith('ATTESTATION_REQUIRED'),
        ),
      ).toBe(true);
    } finally {
      process.exitCode = beforeExit;
      if (beforeCli === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = beforeCli;
      cliOutput.mockRestore();
    }
    expect(
      await verifyBill(prisma, versionId, fixturePath, () => {}, {
        attestRealBill: true,
      }),
    ).toBe(true);
    const verified = await prisma.tariffVersion.findUniqueOrThrow({
      where: { id: versionId },
    });
    expect(verified.billVerified).toBe(true);
    expect(verified.sourceNote).toContain('Bill-reproduced rule flags:');
    expect(verified.sourceNote).toContain(
      'attested real bill redacted-test-bill.json',
    );
    const service = app.get(TariffService);
    await service.setTariffHolidays(tariffId, 2026, [
      { date: '2026-11-30', name: 'Fake holiday' },
    ]);
    expect(
      (
        await prisma.tariffVersion.findUniqueOrThrow({
          where: { id: versionId },
        })
      ).billVerified,
    ).toBe(false);
    const priorUrl = process.env.DATABASE_URL;
    const priorCode = process.exitCode;
    const successLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      process.env.DATABASE_URL = db.url;
      process.exitCode = 0;
      await verifyBillCli([
        '--version',
        String(versionId),
        '--fixture',
        fixturePath,
        '--attest-real-bill',
      ]);
      expect(process.exitCode).toBe(0);
      expect(
        (
          await prisma.tariffVersion.findUniqueOrThrow({
            where: { id: versionId },
          })
        ).billVerified,
      ).toBe(true);
    } finally {
      process.exitCode = priorCode;
      if (priorUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = priorUrl;
      successLog.mockRestore();
    }
    const monthlyTariff = await service.createTariff({
      name: 'Synthetic monthly rate',
      currency: 'MYR',
      timezone: 'UTC',
    });
    const monthlyRules = {
      ...flat,
      components: [
        ...flat.components,
        {
          code: 'TEST_MONTHLY',
          label: 'Fake monthly adjustment',
          kind: 'PER_KWH_MONTHLY',
          basis: 'IMPORT',
        },
      ],
    };
    const monthlyVersion = await service.createTariffVersion(
      monthlyTariff.id,
      '2026-11-01',
      null,
      JSON.stringify(monthlyRules),
      'Synthetic monthly rate requiring month split',
    );
    await service.setMonthlyRate(
      monthlyTariff.id,
      'TEST_MONTHLY',
      '2026-11',
      '0.100000',
      'Synthetic',
    );
    await service.setMonthlyRate(
      monthlyTariff.id,
      'TEST_MONTHLY',
      '2026-12',
      '0.100000',
      'Synthetic',
    );
    const refusals: string[] = [];
    expect(
      await verifyBill(prisma, monthlyVersion.id, fixturePath, (line) =>
        refusals.push(line),
      ),
    ).toBe(false);
    expect(refusals.some((line) => line.startsWith('REFUSED:'))).toBe(true);
    expect(
      (
        await prisma.tariffVersion.findUniqueOrThrow({
          where: { id: monthlyVersion.id },
        })
      ).billVerified,
    ).toBe(false);
    const monthlyComputed = computeBill({
      segments: [
        {
          versionId: monthlyVersion.id,
          rules: parseRules(monthlyRules),
          quantities: {
            startDate: '2026-11-03',
            endDate: '2026-11-03',
            days: 1,
            windows: [
              {
                window: 'OFFPEAK',
                importKwh: new Decimal(100),
                exportKwh: new Decimal(0),
              },
            ],
            importByMonth: { '2026-11': new Decimal(100) },
          },
        },
      ],
      monthlyRates: [
        {
          componentCode: 'TEST_MONTHLY',
          month: '2026-11',
          ratePerKwh: new Decimal('0.10'),
        },
      ],
      nemOpening: { lots: [] },
      context: {
        coverage: 1,
        periodDays: 1,
        periodStartDate: '2026-11-03',
        periodInProgress: false,
        startsBeforeMonitoring: false,
        entirelyBeforeMonitoring: false,
        noTariffVersion: false,
        vendorDataOnly: false,
        holidayCalendarMissing: false,
        touAllocationEstimated: false,
        accountingUnreconciled: false,
        mappingProvisional: false,
        calcParamsPartialRecompute: false,
        allVersionsBillVerified: false,
      },
    });
    const oneDayFixture = BillFixtureSchema.parse({
      periodStartDate: '2026-11-03',
      periodEndDate: '2026-11-03',
      importPeakKwh: '100.000',
      importOffpeakKwh: '0.000',
      exportKwh: '0.000',
      lines: monthlyComputed.lineItems
        .filter((item) => item.amount !== null)
        .map((item) => ({ code: item.code, amount: item.amount })),
      total: monthlyComputed.total,
      openingLots: [],
      closingLots: [],
    });
    await writeFile(fixturePath, JSON.stringify(oneDayFixture));
    const verifier = new PrismaService({ DATABASE_URL: db.url });
    const originalTransaction = verifier.$transaction.bind(verifier);
    const interception = vi
      .spyOn(verifier, '$transaction')
      .mockImplementation(async (callback) => {
        await service.setMonthlyRate(
          monthlyTariff.id,
          'TEST_MONTHLY',
          '2026-11',
          '0.200000',
          'Changed after reproduction but before verification commit',
        );
        return originalTransaction(callback);
      });
    try {
      expect(
        await verifyBill(verifier, monthlyVersion.id, fixturePath, () => {}, {
          attestRealBill: true,
        }),
      ).toBe(false);
      expect(
        (
          await prisma.tariffVersion.findUniqueOrThrow({
            where: { id: monthlyVersion.id },
          })
        ).billVerified,
      ).toBe(false);
    } finally {
      interception.mockRestore();
      await verifier.close();
    }
  });

  it('never labels an old result fresh when a worker recomputes between API reads', async () => {
    const tariff = await prisma.tariff.findFirstOrThrow({
      where: { name: 'Synthetic' },
    });
    const period = await prisma.billingPeriod.findFirstOrThrow({
      where: {
        tariffId: tariff.id,
        startDate: new Date('2026-11-03T00:00:00Z'),
      },
    });
    const billing = app.get(BillingService);
    const sameNow = new Date('2027-01-01T00:00:00Z');
    await billing.computePeriod(period.id, sameNow, false);
    const old = await prisma.billingPeriodResult.findUniqueOrThrow({
      where: { billingPeriodId: period.id },
    });
    expect(old.total?.toFixed(2)).toBe('50.00');
    await prisma.energyInterval.update({
      where: { bucketStart: new Date('2026-11-03T00:00:00Z') },
      data: { gridImportNetWh: '200000.000', computedAt: new Date() },
    });

    const original = billing.freshnessForTariff.bind(billing);
    let interleaved = false;
    let sameRevision = false;
    const interception = vi
      .spyOn(billing, 'freshnessForTariff')
      .mockImplementation(async (tariffId, now) => {
        if (tariffId === tariff.id && !interleaved) {
          interleaved = true;
          const updated = await billing.computePeriod(
            period.id,
            sameNow,
            false,
          );
          sameRevision =
            updated.computedAt.getTime() === old.computedAt.getTime() &&
            updated.calcVersion === old.calcVersion &&
            updated.total?.toFixed(2) === '100.00';
        }
        return original(tariffId, now);
      });
    try {
      const response = await request(
        `{ billingPeriod(id:${period.id}) { stale result { total } } }`,
        viewer,
      );
      expect(response.errors).toBeUndefined();
      expect(interleaved).toBe(true);
      expect(sameRevision).toBe(true);
      expect(response.data?.billingPeriod).toMatchObject({
        stale: expect.any(Boolean),
        result: { total: '100.00' },
      });
    } finally {
      interception.mockRestore();
    }
  });
  it('returns written holidays and monthly rates to viewers in deterministic order', async () => {
    const service = app.get(TariffService);
    const tariff = await service.createTariff({
      name: 'Synthetic readback',
      currency: 'MYR',
      timezone: 'UTC',
    });
    const rules = {
      ...flat,
      components: [
        ...flat.components,
        {
          code: 'Z_TEST_ENERGY',
          label: 'Fake monthly charge Z',
          kind: 'PER_KWH_MONTHLY',
          basis: 'IMPORT',
        },
        {
          code: 'A_TEST_ENERGY',
          label: 'Fake monthly charge A',
          kind: 'PER_KWH_MONTHLY',
          basis: 'IMPORT',
        },
      ],
    };
    await service.createTariffVersion(
      tariff.id,
      '2026-11-01',
      null,
      JSON.stringify(rules),
      'Synthetic readback',
    );
    await service.setTariffHolidays(tariff.id, 2026, [
      { date: '2026-11-20', name: 'Fake second holiday' },
      { date: '2026-11-10', name: 'Fake first holiday' },
    ]);
    await service.setMonthlyRate(
      tariff.id,
      'Z_TEST_ENERGY',
      '2026-12',
      '0.300000',
      'Synthetic',
    );
    await service.setMonthlyRate(
      tariff.id,
      'Z_TEST_ENERGY',
      '2026-11',
      '0.200000',
      'Synthetic',
    );
    await service.setMonthlyRate(
      tariff.id,
      'A_TEST_ENERGY',
      '2026-11',
      '0.100000',
      'Synthetic',
    );
    const result = await request(
      `{ tariffHolidays(tariffId:${tariff.id},year:2026) { date name } tariffMonthlyRates(tariffId:${tariff.id}) { month componentCode ratePerKwh } }`,
      viewer,
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.tariffHolidays).toEqual([
      { date: '2026-11-10', name: 'Fake first holiday' },
      { date: '2026-11-20', name: 'Fake second holiday' },
    ]);
    expect(result.data?.tariffMonthlyRates).toEqual([
      { month: '2026-11', componentCode: 'A_TEST_ENERGY', ratePerKwh: '0.1' },
      { month: '2026-11', componentCode: 'Z_TEST_ENERGY', ratePerKwh: '0.2' },
      { month: '2026-12', componentCode: 'Z_TEST_ENERGY', ratePerKwh: '0.3' },
    ]);
    for (const year of [1899, 9999]) {
      const invalid = await request(
        `{ tariffHolidays(tariffId:${tariff.id},year:${year}) { date } }`,
        viewer,
      );
      expect(invalid.errors?.[0]?.extensions.code).toBe('BAD_USER_INPUT');
    }
  });
});
