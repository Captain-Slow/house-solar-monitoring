import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { parseEnv } from '../src/config/env.js';
import { z } from 'zod';
import { createApp } from '../src/main.js';
import { TokenService } from '../src/auth/token.service.js';
import { TlsService } from '../src/tls/tls.service.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import { TariffService } from '../src/tariff/tariff.service.js';

interface Response {
  data?: Record<string, unknown>;
  errors?: Array<{ message: string; extensions: { code: string } }>;
}
describe('accounting API over HTTPS', () => {
  let db: TestDatabase,
    app: INestApplication,
    tls: TlsService,
    dir: string,
    port: number,
    viewer: string,
    admin: string;
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
          incoming.on('data', (part: Buffer) => parts.push(part));
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
    dir = await mkdtemp(join(tmpdir(), 'solar-accounting-api-'));
    const env = parseEnv({
      DATABASE_URL: db.url,
      COLLECTOR_ENABLED: 'false',
      TLS_DIR: dir,
      BACKUP_DIR: dir,
    });
    tls = await TlsService.load(env);
    app = await createApp(env, { tlsService: tls, schemaFile: true });
    await app.listen(0, '127.0.0.1');
    port = (app.getHttpServer().address() as AddressInfo).port;
    viewer = (await app.get(TokenService).create('viewer', 'VIEWER')).token;
    admin = (await app.get(TokenService).create('admin', 'ADMIN')).token;
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('allows viewer reads but denies mutations; administrator can add a real meter reading', async () => {
    const read = await request(
      'query { energyTotals(fromDate:"2026-01-01",toDate:"2026-01-01",granularity:DAY) { rows { gridImport { kwh status coverage } } monitoringSince } }',
      viewer,
    );
    expect(read.errors).toBeUndefined();
    expect(read.data?.energyTotals).toMatchObject({
      rows: [{ gridImport: { kwh: null, status: 'UNAVAILABLE' } }],
      monitoringSince: null,
    });
    const mutation =
      'mutation { addMeterReading(input:{readAt:"2026-01-01T00:00:00.000Z",source:UTILITY_METER_MANUAL,importKwh:"50.000"}) { id importKwh resolutionKwh } }';
    expect((await request(mutation, viewer)).errors?.[0]?.extensions.code).toBe(
      'FORBIDDEN',
    );
    expect(
      (await request(mutation, admin)).data?.addMeterReading,
    ).toMatchObject({ importKwh: '50', resolutionKwh: '1' });
    expect((await request(mutation, admin)).errors?.[0]?.extensions.code).toBe(
      'BAD_USER_INPUT',
    );
    await request(
      'mutation { addMeterReading(input:{readAt:"2026-01-02T00:00:00.000Z",source:UTILITY_METER_MANUAL,importKwh:"51.000"}) { id } }',
      admin,
    );
    const listed = await request(
      '{ meterReadings(first:1) { edges { cursor node { importKwh } } pageInfo { hasNextPage endCursor } } }',
      viewer,
    );
    expect(listed.errors).toBeUndefined();
    const connection = z
      .object({
        edges: z.array(z.object({ cursor: z.string() })),
        pageInfo: z.object({ hasNextPage: z.boolean() }),
      })
      .parse(listed.data?.meterReadings);
    expect(connection.pageInfo.hasNextPage).toBe(true);
    const next = await request(
      `{ meterReadings(first:1,after:"${connection.edges[0]!.cursor}") { edges { node { importKwh } } pageInfo { hasNextPage } } }`,
      viewer,
    );
    expect(next.errors).toBeUndefined();
    expect(
      z
        .object({
          edges: z.array(
            z.object({ node: z.object({ importKwh: z.string() }) }),
          ),
        })
        .parse(next.data?.meterReadings).edges[0]!.node.importKwh,
    ).toBe('51');
    expect(
      (
        await request(
          '{ meterReadings(first:101) { edges { cursor } } }',
          viewer,
        )
      ).errors?.[0]?.extensions.code,
    ).toBe('BAD_USER_INPUT');
  });

  it('delegates policy mutation to the ledger module without scheduling source-only recomputation', async () => {
    const policy = await request(
      'mutation { createAccountingPolicy(input:{effectiveFrom:"2026-01-01T00:00:00.000Z",gridSource:"METER_PER_PHASE",pvSource:"INTEGRATED",batterySource:"INTEGRATED",loadSource:"DERIVED",maxGapSec:30,note:"operator source choice"}) { policy { version gridSource } calculationRun { id } billingPeriodsInvalidated } }',
      admin,
    );
    expect(policy.errors).toBeUndefined();
    expect(policy.data?.createAccountingPolicy).toMatchObject({
      policy: { gridSource: 'METER_PER_PHASE' },
      calculationRun: null,
      billingPeriodsInvalidated: 0,
    });
    const read = await request(
      '{ accountingPolicies { gridSource validated } calculationRuns(first:1) { edges { cursor } } }',
      viewer,
    );
    expect(read.errors).toBeUndefined();
    expect(read.data?.accountingPolicies).toMatchObject([
      { gridSource: 'METER_PER_PHASE', validated: '{}' },
    ]);
  });

  it('exposes recalculation retention clipping and overlapping-run error codes', async () => {
    const day = 86_400_000;
    const from = new Date(Date.now() - 401 * day).toISOString();
    const to = new Date(Date.now() - 399 * day).toISOString();
    const mutation = `mutation { requestRecalculation(kind:"LEDGER_RECOMPUTE",from:"${from}",to:"${to}",reason:"historical audit") { id outsideRetentionBefore rangeStart } }`;
    const result = await request(mutation, admin);
    expect(result.errors).toBeUndefined();
    const run = z
      .object({ outsideRetentionBefore: z.string(), rangeStart: z.string() })
      .parse(result.data?.requestRecalculation);
    expect(new Date(run.rangeStart).getTime()).toBe(
      new Date(run.outsideRetentionBefore).getTime(),
    );
    expect((await request(mutation, admin)).errors?.[0]?.extensions.code).toBe(
      'RECALC_IN_PROGRESS',
    );
  });

  it('rejects row, duration and maxPoints limits with BAD_USER_INPUT', async () => {
    for (const query of [
      '{ energyTotals(fromDate:"2020-01-01",toDate:"2024-01-01",granularity:DAY) { rows { periodStart } } }',
      '{ powerSeries(from:"2025-01-01T00:00:00.000Z",to:"2026-02-01T00:00:00.000Z",metrics:[PV]) { bucketSeconds } }',
      '{ powerSeries(from:"2026-01-01T00:00:00.000Z",to:"2026-01-02T00:00:00.000Z",metrics:[PV],maxPoints:2001) { bucketSeconds } }',
    ])
      expect((await request(query, viewer)).errors?.[0]?.extensions.code).toBe(
        'BAD_USER_INPUT',
      );
  });
  it('rejects monetary values outside the exact database decimal representation', async () => {
    for (const [stamp, importKwh, resolutionKwh] of [
      ['2026-02-01T00:00:00.000Z', '1000000000', '1'],
      ['2026-02-02T00:00:00.000Z', '0.0001', '1'],
      ['2026-02-03T00:00:00.000Z', '1', '1000'],
      ['2026-02-04T00:00:00.000Z', '1', '0.0001'],
    ]) {
      const mutation = `mutation { addMeterReading(input:{readAt:"${stamp}",source:UTILITY_METER_MANUAL,importKwh:"${importKwh}",resolutionKwh:"${resolutionKwh}"}) { id } }`;
      expect(
        (await request(mutation, admin)).errors?.[0]?.extensions.code,
      ).toBe('BAD_USER_INPUT');
    }
  });
  it('returns bounded data exclusions newest first to viewers', async () => {
    for (const [from, to, reason] of [
      ['2026-03-01T00:00:00.000Z', '2026-03-01T01:00:00.000Z', 'fake first'],
      ['2026-03-02T00:00:00.000Z', '2026-03-02T01:00:00.000Z', 'fake second'],
    ]) {
      const created = await request(
        `mutation { createDataExclusion(input:{from:"${from}",to:"${to}",families:["GRID"],reason:"${reason}"}) { id reason createdBy } }`,
        admin,
      );
      expect(created.errors).toBeUndefined();
      expect(created.data?.createDataExclusion).toMatchObject({
        reason,
        createdBy: 'admin',
      });
    }
    const listed = await request(
      '{ dataExclusions { reason families createdBy } recent:dataExclusions(first:1) { reason } }',
      viewer,
    );
    expect(listed.errors).toBeUndefined();
    expect(listed.data?.dataExclusions).toEqual([
      { reason: 'fake second', families: ['GRID'], createdBy: 'admin' },
      { reason: 'fake first', families: ['GRID'], createdBy: 'admin' },
    ]);
    expect(listed.data?.recent).toEqual([{ reason: 'fake second' }]);
    for (const first of [0, 201]) {
      const invalid = await request(
        `{ dataExclusions(first:${first}) { id } }`,
        viewer,
      );
      expect(invalid.errors?.[0]?.extensions.code).toBe('BAD_USER_INPUT');
    }
  });
  it('bounds power-series metric variables and preserves valid selections for viewers', async () => {
    const query = `query ($metrics: [PowerMetric!]!) {
      powerSeries(
        from: "2000-01-01T00:00:00.000Z",
        to: "2000-01-21T00:00:00.000Z",
        metrics: $metrics,
        maxPoints: 2000
      ) { series { metric } }
    }`;
    for (const metrics of [[], Array(5000).fill('GRID_A')]) {
      const rejected = await request(query, viewer, { metrics });
      expect(rejected.errors?.[0]?.extensions.code).toBe('BAD_USER_INPUT');
    }
    const selected = await request(query, viewer, {
      metrics: ['GRID_A', 'PV', 'GRID_A'],
    });
    expect(selected.errors).toBeUndefined();
    expect(selected.data?.powerSeries).toEqual({
      series: [{ metric: 'GRID_A' }, { metric: 'PV' }],
    });
  });

  it('accepts explicit tariff selection and exposes distinct lifetime and interval fields to viewers', async () => {
    const tariffs = app.get(TariffService);
    const tariff = await tariffs.createTariff({
      name: 'Totals API fixture',
      currency: 'MYR',
      timezone: 'UTC',
    });
    await tariffs.createTariffVersion(
      tariff.id,
      '2025-12-31',
      undefined,
      JSON.stringify({
        currency: 'MYR',
        timezone: 'UTC',
        touWindows: [],
        defaultWindow: 'FLAT',
        consumptionBasis: 'GROSS_IMPORT',
        thresholdProration: 'NONE',
        nem: null,
        components: [
          {
            code: 'FIXED',
            label: 'Fixture',
            kind: 'FIXED',
            amount: '0',
            prorate: false,
          },
        ],
        totalRounding: 'NONE',
      }),
      'synthetic API fixture',
    );
    const result = await request(
      `query ($tariffId: Int) {
      energyTotals(fromDate: "2026-01-01", toDate: "2026-01-01", granularity: DAY, tariffId: $tariffId) {
        total {
          gridByWindow { window importKwh { kwh status coverage } exportKwh { kwh status } }
          vendor {
            lifetime { gridImport { kwh provenance } }
            intervalDelta { gridImport { kwh provenance } }
          }
        }
      }
    }`,
      viewer,
      { tariffId: tariff.id },
    );
    expect(result.errors).toBeUndefined();
    expect(result.data?.energyTotals).toMatchObject({
      total: {
        gridByWindow: [
          {
            window: 'FLAT',
            importKwh: { kwh: null, status: 'UNAVAILABLE', coverage: '0' },
            exportKwh: { kwh: null, status: 'UNAVAILABLE' },
          },
        ],
        vendor: {
          lifetime: { gridImport: { kwh: null, provenance: 'DEVICE_COUNTER' } },
          intervalDelta: {
            gridImport: { kwh: null, provenance: 'DEVICE_COUNTER' },
          },
        },
      },
    });
  });
});
