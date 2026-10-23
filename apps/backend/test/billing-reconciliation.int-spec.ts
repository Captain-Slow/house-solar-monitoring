import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { z } from 'zod';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { createApp } from '../src/main.js';
import { TokenService } from '../src/auth/token.service.js';
import { TlsService } from '../src/tls/tls.service.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { BillingService } from '../src/tariff/billing.service.js';
import { TariffService } from '../src/tariff/tariff.service.js';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import {
  at,
  flatRules,
  nemRules,
  seedAccountingBasics,
  seedDay,
  seedReconciledDay,
} from './support/billing.js';

interface Response {
  data?: Record<string, unknown>;
  errors?: { message: string; extensions: { code: string } }[];
}
const PeriodNode = z.object({
  id: z.number(),
  stale: z.boolean(),
  result: z.object({
    status: z.string(),
    reasons: z.array(z.string()),
    nem: z
      .object({ closingLots: z.array(z.object({ kwh: z.string() })) })
      .nullable(),
  }),
});
const periodFields =
  'id stale result { status reasons nem { closingLots { kwh } } }';

describe('billing validity follows the reconciliation state it was computed with', () => {
  let db: TestDatabase,
    app: INestApplication,
    prisma: PrismaService,
    tls: TlsService,
    billing: BillingService,
    tariff: TariffService;
  let dir: string, port: number, viewer: string, admin: string;

  // The project's TS lib predates Promise.withResolvers, so the executor form is required here.
  function request(query: string, token: string): Promise<Response> {
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
      outgoing.end(JSON.stringify({ query }));
    });
  }
  beforeAll(async () => {
    db = await createTestDatabase();
    dir = await mkdtemp(join(tmpdir(), 'solar-billing-reconciliation-'));
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
    viewer = (await app.get(TokenService).create('billing-viewer', 'VIEWER'))
      .token;
    admin = (await app.get(TokenService).create('billing-admin', 'ADMIN'))
      .token;
    billing = app.get(BillingService);
    tariff = app.get(TariffService);
    await seedAccountingBasics(prisma);
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function verifiedTariff(rules: object) {
    const row = await tariff.createTariff({
      name: 'Synthetic reconciliation',
      currency: 'MYR',
      timezone: 'UTC',
    });
    const version = await tariff.createTariffVersion(
      row.id,
      '2026-03-01',
      null,
      JSON.stringify(rules),
      'Test-only fake rates',
    );
    await prisma.tariffVersion.update({
      where: { id: version.id },
      data: { billVerified: true },
    });
    return row;
  }
  /** Replaces all utility readings with a reconciling pair around fully covered `date`. */
  async function reconcileAround(date: string) {
    await prisma.meterReading.deleteMany();
    return seedReconciledDay(prisma, date);
  }
  async function mutate(mutation: string) {
    const response = await request(`mutation { ${mutation} }`, admin);
    expect(response.errors).toBeUndefined();
    return response.data;
  }
  async function page(firstPeriodId: number, count: number) {
    const after =
      firstPeriodId > 1
        ? `, after:"${Buffer.from(String(firstPeriodId - 1)).toString('base64')}"`
        : '';
    const response = await request(
      `{ billingPeriods(first:${count}${after}) { edges { node { ${periodFields} } } } }`,
      viewer,
    );
    expect(response.errors).toBeUndefined();
    return z
      .object({ edges: z.array(z.object({ node: PeriodNode })) })
      .parse(response.data?.billingPeriods)
      .edges.map(({ node }) => node);
  }
  async function single(id: number) {
    const response = await request(
      `{ billingPeriod(id:${id}) { ${periodFields} } }`,
      viewer,
    );
    expect(response.errors).toBeUndefined();
    return PeriodNode.parse(response.data?.billingPeriod);
  }
  const readingMutation = (readAt: Date, importKwh: string) =>
    `addMeterReading(input:{readAt:"${readAt.toISOString()}",source:UTILITY_METER_MANUAL,importKwh:"${importKwh}"}) { id }`;

  /** Pause after materializing the endpoint pair, then commit deletion on another connection. */
  async function deleteAfterSelection<T>(
    id: number,
    run: () => Promise<T>,
  ): Promise<T> {
    const other = new PrismaService({ DATABASE_URL: db.url });
    const findMany = prisma.meterReading.findMany.bind(prisma.meterReading);
    let deleted = false;
    const remove = async () => {
      if (!deleted) {
        deleted = true;
        await other.meterReading.delete({ where: { id } });
      }
    };
    const many = vi
      .spyOn(prisma.meterReading, 'findMany')
      .mockImplementation((async (args) => {
        const result = await findMany(args);
        if (args?.take === 2 && result.length === 2) await remove();
        return result;
      }) as typeof findMany);
    try {
      const result = await run();
      expect(deleted).toBe(true);
      return result;
    } finally {
      many.mockRestore();
      await other.close();
    }
  }

  it.each(['firstId', 'lastId'] as const)(
    'uses the selected pair when its $0 endpoint is deleted on another connection',
    async (endpoint) => {
      const pair = await reconcileAround(
        endpoint === 'firstId' ? '2026-04-01' : '2026-04-03',
      );
      const service = app.get(ReconciliationService);
      expect(
        await deleteAfterSelection(pair[endpoint], () =>
          service.accountingStatus('METER_NET'),
        ),
      ).toBe('RECONCILED');
      expect(await service.accountingStatus('METER_NET')).toBe('UNRECONCILED');
      await expect(
        service.reconcile(pair.firstId, pair.lastId),
      ).rejects.toMatchObject({
        extensions: { code: 'BAD_USER_INPUT' },
      });
    },
  );

  it('retains public invalid-pair errors and distinguishes missing, passing, failing and insufficient pairs', async () => {
    const service = app.get(ReconciliationService);
    await prisma.meterReading.deleteMany();
    expect(await service.accountingStatus('METER_NET')).toBe('UNRECONCILED');
    const pair = await seedReconciledDay(prisma, '2026-04-05');
    const unrelated = await prisma.meterReading.create({
      data: {
        readAt: at('2026-04-10', 0),
        source: 'HOYMILES_METER_LCD',
        importKwh: '1000.000',
        resolutionKwh: '1.000',
      },
    });
    expect(await service.accountingStatus('METER_NET')).toBe('RECONCILED');
    for (const [from, to] of [
      [-1, pair.lastId],
      [pair.firstId, -1],
      [pair.firstId, pair.firstId],
      [pair.lastId, pair.firstId],
      [pair.firstId, unrelated.id],
    ])
      await expect(service.reconcile(from!, to!)).rejects.toMatchObject({
        extensions: { code: 'BAD_USER_INPUT' },
      });
    await prisma.meterReading.update({
      where: { id: pair.lastId },
      data: { importKwh: '1100.000' },
    });
    expect(await service.accountingStatus('METER_NET')).toBe(
      'RECONCILIATION_FAILED',
    );
    await prisma.meterReading.update({
      where: { id: pair.lastId },
      data: { importKwh: '1010.000' },
    });
    expect(await service.accountingStatus('METER_NET')).toBe('UNRECONCILED');
    await prisma.meterReading.delete({ where: { id: pair.firstId } });
    expect(await service.accountingStatus('METER_NET')).toBe('UNRECONCILED');
  });

  it('serves liveStatus from the selected pair during deletion and observes deletion on the next request', async () => {
    const pair = await reconcileAround('2026-04-11');
    const response = await deleteAfterSelection(pair.lastId, () =>
      request('{ liveStatus { accountingStatus } }', viewer),
    );
    expect(response.errors).toBeUndefined();
    expect(response.data?.liveStatus).toEqual({
      accountingStatus: 'RECONCILED',
    });
    const next = await request('{ liveStatus { accountingStatus } }', viewer);
    expect(next.errors).toBeUndefined();
    expect(next.data?.liveStatus).toEqual({ accountingStatus: 'UNRECONCILED' });
  });

  it.each(['GraphQL', 'scheduled'])(
    'keeps a closed bill and NEM successors coherent across a deletion race in %s refresh',
    async (refresh) => {
      const date = refresh === 'GraphQL' ? '2026-05-01' : '2026-05-06';
      const pair = await reconcileAround(date);
      const row = await verifiedTariff(nemRules);
      const periods = [];
      for (let i = 0; i < 3; i++) {
        const day = at(date, (i + 1) * 288)
          .toISOString()
          .slice(0, 10);
        await seedDay(prisma, day, {
          importWh: ['0.000', '30000.000', '10000.000'][i],
          exportWh: i === 0 ? '100000.000' : '0.000',
        });
        periods.push(
          await tariff.upsertBillingPeriod({
            tariffId: row.id,
            startDate: day,
            endDate: day,
            ...(i === 0 ? { openingCreditLots: [] } : {}),
          }),
        );
      }
      const firstId = periods[0]!.id;
      await billing.computePeriod(firstId, new Date());
      if (refresh === 'GraphQL') {
        const selected = await deleteAfterSelection(pair.lastId, () =>
          page(firstId, 3),
        );
        for (const node of selected)
          expect(node).toMatchObject({
            stale: false,
            result: { status: 'COMPLETE', reasons: [] },
          });
      } else {
        // This is the same set-based refresh the hourly scheduler invokes.
        await deleteAfterSelection(pair.firstId, () =>
          billing.recomputeStale(new Date()),
        );
      }
      await billing.recomputeStale(new Date());
      for (const node of await page(firstId, 3))
        expect(node).toMatchObject({
          stale: false,
          result: { status: 'ESTIMATED', reasons: ['ACCOUNTING_UNRECONCILED'] },
        });
      expect(await billing.recomputeStale(new Date())).toBe(0);
      await mutate(
        readingMutation(
          at(date, refresh === 'GraphQL' ? 288 : 0),
          refresh === 'GraphQL' ? '1060.000' : '1000.000',
        ),
      );
      await billing.recomputeStale(new Date());
      for (const node of await page(firstId, 3))
        expect(node).toMatchObject({
          stale: false,
          result: { status: 'COMPLETE', reasons: [] },
        });
      expect(await billing.recomputeStale(new Date())).toBe(0);
    },
  );

  it('refreshes equal-time credit quality changes through GraphQL and converges on closed NEM bills', async () => {
    await reconcileAround('2026-06-01');
    const row = await verifiedTariff(nemRules);
    const dates = ['2026-06-02', '2026-06-03', '2026-06-04'];
    const periods = [];
    for (const [i, date] of dates.entries()) {
      await seedDay(prisma, date, {
        importWh: ['0.000', '30000.000', '10000.000'][i],
        exportWh: i === 0 ? '100000.000' : '0.000',
        coverage: i === 0 ? (bucket) => (bucket < 259 ? 300 : 0) : undefined,
      });
      periods.push(
        await tariff.upsertBillingPeriod({
          tariffId: row.id,
          startDate: date,
          endDate: date,
          ...(i === 0 ? { openingCreditLots: [] } : {}),
        }),
      );
    }
    const computedAt = new Date('2027-01-01T00:00:00Z');
    await billing.computePeriod(periods[0]!.id, computedAt);
    expect((await single(periods[2]!.id)).result.reasons).toEqual([
      'NEM_OPENING_CREDIT_ESTIMATED',
    ]);
    await prisma.energyInterval.updateMany({
      where: { bucketStart: { gte: at(dates[0]!, 0), lt: at(dates[1]!, 0) } },
      data: { gridCoveredSec: 300 },
    });
    await billing.computePeriod(periods[0]!.id, computedAt, false);
    const selected = await page(periods[0]!.id, 3);
    expect(selected.map((node) => node.stale)).toEqual([false, false, true]);
    expect(selected[1]!.result).toMatchObject({
      status: 'COMPLETE',
      reasons: [],
    });
    expect(selected[2]!.result.reasons).toEqual([
      'NEM_OPENING_CREDIT_ESTIMATED',
    ]);
    expect(await single(periods[2]!.id)).toMatchObject({
      stale: false,
      result: { status: 'COMPLETE', reasons: [] },
    });
    expect(await billing.recomputeStale(new Date())).toBe(0);
  });

  it('recomputes a closed COMPLETE bill after a required reading is deleted and again after it is restored', async () => {
    const row = await verifiedTariff(flatRules);
    const { lastId } = await reconcileAround('2026-03-20');
    await seedDay(prisma, '2026-03-21', { importWh: '10000.000' });
    const period = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-03-21',
      endDate: '2026-03-21',
      openingCreditLots: [],
    });
    expect(await single(period.id)).toMatchObject({
      stale: false,
      result: { status: 'COMPLETE', reasons: [] },
    });

    await mutate(`deleteMeterReading(id:${lastId})`);
    expect(
      await billing.isStale(
        await prisma.billingPeriod.findUniqueOrThrow({
          where: { id: period.id },
          include: { result: true, tariff: true },
        }),
        new Date(),
      ),
    ).toBe(true);
    // The API refreshes the bill instead of serving COMPLETE on a reconciliation that no longer exists.
    expect(await single(period.id)).toMatchObject({
      stale: false,
      result: { status: 'ESTIMATED', reasons: ['ACCOUNTING_UNRECONCILED'] },
    });

    await mutate(readingMutation(at('2026-03-21', 0), '1060.000'));
    expect(await single(period.id)).toMatchObject({
      stale: false,
      result: { status: 'COMPLETE', reasons: [] },
    });
    // A reading older than the latest pair cannot change the outcome and must not churn the bill.
    const refreshedAt = (
      await prisma.billingPeriodResult.findUniqueOrThrow({
        where: { billingPeriodId: period.id },
      })
    ).computedAt;
    await mutate(readingMutation(at('2026-03-10', 0), '900.000'));
    expect(await single(period.id)).toMatchObject({ stale: false });
    expect(
      (
        await prisma.billingPeriodResult.findUniqueOrThrow({
          where: { billingPeriodId: period.id },
        })
      ).computedAt,
    ).toEqual(refreshedAt);
  });

  it('marks every period of a NEM chain stale, then refreshes the chain consistently, as reconciliation is lost and gained', async () => {
    const row = await verifiedTariff(nemRules);
    const { lastId } = await reconcileAround('2026-03-25');
    const dates = ['2026-03-22', '2026-03-23', '2026-03-24'];
    for (const [index, date] of dates.entries())
      await seedDay(prisma, date, {
        importWh: ['0.000', '30000.000', '10000.000'][index],
        exportWh: index === 0 ? '100000.000' : '0.000',
      });
    const periods: { id: number }[] = [];
    for (const [index, date] of dates.entries())
      periods.push(
        await tariff.upsertBillingPeriod({
          tariffId: row.id,
          startDate: date,
          endDate: date,
          ...(index === 0 ? { openingCreditLots: [] } : {}),
        }),
      );
    const firstId = periods[0]!.id;
    await billing.computePeriod(firstId, new Date());
    for (const node of await page(firstId, 3))
      expect(node).toMatchObject({
        stale: false,
        result: { status: 'COMPLETE', reasons: [] },
      });

    const staleEverywhere = async () => {
      const freshness = await billing.freshnessForTariff(row.id, new Date());
      for (const period of periods) {
        expect(freshness.get(period.id)?.stale).toBe(true);
        expect(
          await billing.isStale(
            await prisma.billingPeriod.findUniqueOrThrow({
              where: { id: period.id },
              include: { result: true, tariff: true },
            }),
            new Date(),
          ),
        ).toBe(true);
      }
    };

    // Loss: the required endpoint disappears.
    await mutate(`deleteMeterReading(id:${lastId})`);
    await staleEverywhere();
    // One refresh per request: the first period is recomputed, the rest are honestly flagged stale.
    const firstRequest = await page(firstId, 3);
    expect(firstRequest.map((node) => node.stale)).toEqual([false, true, true]);
    expect(firstRequest[0]!.result).toMatchObject({
      status: 'ESTIMATED',
      reasons: ['ACCOUNTING_UNRECONCILED'],
    });
    expect(firstRequest[1]!.result.status).toBe('COMPLETE');
    await billing.recomputeStale(new Date());
    const afterLoss = await page(firstId, 3);
    expect(afterLoss.map((node) => node.stale)).toEqual([false, false, false]);
    for (const node of afterLoss)
      expect(node.result.reasons).toEqual(['ACCOUNTING_UNRECONCILED']);
    // The refreshed successors still consume the carried credit: 100 - 30 - 10 kWh.
    expect(afterLoss.map((node) => node.result.nem?.closingLots)).toEqual([
      [{ kwh: '100.000' }],
      [{ kwh: '70.000' }],
      [{ kwh: '60.000' }],
    ]);

    // Gain: restoring the endpoint reconciles again.
    await mutate(readingMutation(at('2026-03-26', 0), '1060.000'));
    await staleEverywhere();
    const gained = await page(firstId, 3);
    expect(gained.map((node) => node.stale)).toEqual([false, true, true]);
    await billing.recomputeStale(new Date());
    for (const node of await page(firstId, 3))
      expect(node).toMatchObject({
        stale: false,
        result: { status: 'COMPLETE', reasons: [] },
      });
  });

  it('does not churn bills that never depended on reconciliation', async () => {
    const row = await verifiedTariff(flatRules);
    const { lastId } = await reconcileAround('2026-03-27');
    // No ledger rows at all: UNAVAILABLE, so reconciliation cannot change the result.
    const period = await tariff.upsertBillingPeriod({
      tariffId: row.id,
      startDate: '2026-03-28',
      endDate: '2026-03-28',
      openingCreditLots: [],
    });
    expect(await single(period.id)).toMatchObject({
      stale: false,
      result: { status: 'UNAVAILABLE' },
    });
    await mutate(`deleteMeterReading(id:${lastId})`);
    expect(await single(period.id)).toMatchObject({
      stale: false,
      result: { status: 'UNAVAILABLE' },
    });
    expect(
      (await billing.freshnessForTariff(row.id, new Date())).get(period.id)
        ?.stale,
    ).toBe(false);
  });
});
