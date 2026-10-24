import type { INestApplication } from '@nestjs/common';
import { mkdtemp, rm } from 'node:fs/promises';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  startReplayServer,
  type ReplayServer,
} from '../src/cli/replay-server.js';
import { TokenService } from '../src/auth/token.service.js';
import { LedgerService } from '../src/accounting/ledger.service.js';
import { CollectorService } from '../src/collector/collector.service.js';
import { parseEnv, type Env } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { createApp } from '../src/main.js';
import { TlsService } from '../src/tls/tls.service.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import { freePort } from './support/net.js';
import { recordsFor } from './support/synthetic.js';

/**
 * Phase 2 exit, end to end against the replay server: the whole app (collector -> normalize ->
 * ingest -> Postgres -> HTTPS + token -> GraphQL), not mocks.
 */
describe('Phase 2 exit against the replay server', () => {
  let db: TestDatabase;
  let replay: ReplayServer;
  let replayPort: number;
  let appA: INestApplication;
  let appB: INestApplication;
  let tlsA: TlsService;
  let portA: number;
  let token: string;
  const dirs: string[] = [];

  function envFor(dir: string): Env {
    return parseEnv({
      DATABASE_URL: db.url,
      MODBUS_HOST: '127.0.0.1',
      MODBUS_PORT: String(replayPort),
      MODBUS_TIMEOUT_MS: '300',
      OWNERSHIP_LEASE_SEC: '1',
      POLL_FAST_MS: '1000',
      TLS_DIR: dir,
      BACKUP_DIR: dir,
      LOG_LEVEL: 'silent',
    });
  }

  async function gql<T>(q: string, schema: z.ZodType<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: '127.0.0.1',
          port: portA,
          path: '/graphql',
          method: 'POST',
          ca: tlsA.cert,
          headers: {
            authorization: `Bearer ${token}`,
            'content-type': 'application/json',
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => {
            try {
              const body = z
                .object({
                  data: z.unknown(),
                  errors: z.array(z.unknown()).optional(),
                })
                .parse(JSON.parse(Buffer.concat(chunks).toString()));
              if (body.errors) reject(new Error(JSON.stringify(body.errors)));
              else resolve(schema.parse(body.data));
            } catch (e) {
              reject(e);
            }
          });
        },
      );
      req.on('error', reject);
      req.end(JSON.stringify({ query: q }));
    });
  }

  async function until(
    fn: () => Promise<boolean> | boolean,
    ms: number,
    what: string,
  ): Promise<void> {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      if (await fn()) return;
      await delay(150);
    }
    throw new Error(
      `timed out waiting for ${what}; collector: ${JSON.stringify(appA?.get(CollectorService).snapshot())}`,
    );
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    replayPort = await freePort();
    const states = Array.from({ length: 30 }, (_, i) => ({
      gridW: 300 + i,
      pvW: 2000,
      batteryW: 0,
    }));
    replay = await startReplayServer({
      records: recordsFor(states),
      port: replayPort,
    });
    const dirA = await mkdtemp(join(tmpdir(), 'p2-a-'));
    dirs.push(dirA);
    const envA = envFor(dirA);
    tlsA = await TlsService.load(envA);
    appA = await createApp(envA, { tlsService: tlsA, schemaFile: true });
    await appA.listen(0, '127.0.0.1');
    portA = (appA.getHttpServer().address() as AddressInfo).port;
    token = (await appA.get(TokenService).create('e2e', 'VIEWER')).token;
  }, 60_000);

  afterAll(async () => {
    await appB?.close();
    await appA?.close();
    await replay?.close().catch(() => undefined);
    await db?.drop();
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });

  it('collects samples, serves them live over HTTPS, and re-ingest never duplicates', async () => {
    const prisma = appA.get(PrismaService);
    await until(
      async () => (await prisma.sample.count()) >= 5,
      30_000,
      '5 samples',
    );

    // The worker's startup ledger pass ran before any Sample existed and the next tick is 60 s
    // after bootstrap, so no AccountingPolicy exists yet: collectorStatus must report none.
    expect(await prisma.accountingPolicy.count()).toBe(0);
    const live = await gql(
      '{ liveStatus { freshness ageSeconds grid { watts status } pv { watts status } batterySoc accountingStatus operatingMode { code label } } collectorStatus { state acquisitionSource monitoringSince policyVersion } }',
      z.object({
        liveStatus: z.object({
          freshness: z.string(),
          ageSeconds: z.number(),
          grid: z.object({ watts: z.number().nullable(), status: z.string() }),
          pv: z.object({ watts: z.number().nullable(), status: z.string() }),
          batterySoc: z.number().nullable(),
          accountingStatus: z.string(),
          operatingMode: z
            .object({ code: z.number(), label: z.string() })
            .nullable(),
        }),
        collectorStatus: z.object({
          state: z.string(),
          acquisitionSource: z.string(),
          monitoringSince: z.coerce.date().nullable(),
          policyVersion: z.number(),
        }),
      }),
    );
    expect(live.liveStatus.freshness).toBe('LIVE');
    expect(live.liveStatus.ageSeconds).toBeLessThanOrEqual(30);
    expect(live.liveStatus.grid.status).toBe('OK');
    expect(live.liveStatus.grid.watts).toBeGreaterThanOrEqual(300);
    expect(live.liveStatus.pv.watts).toBe(2000);
    expect(live.liveStatus.batterySoc).toBe(52);
    expect(live.liveStatus.accountingStatus).toBe('MAPPING_PROVISIONAL');
    expect(live.collectorStatus).toMatchObject({
      state: 'RUNNING',
      acquisitionSource: 'MODBUS',
    });
    expect(live.collectorStatus.monitoringSince).toBeNull();
    expect(live.collectorStatus.policyVersion).toBe(0);

    const [{ n, d }] = await prisma.$queryRaw<{ n: bigint; d: bigint }[]>`
      SELECT count(*) AS n, count(DISTINCT "observedAt") AS d FROM "Sample"`;
    expect(n).toBe(d);
    const devices = await prisma.device.findMany();
    expect(devices).toHaveLength(1);
    expect(devices[0]!.retiredAt).toBeNull();
    expect(await prisma.ledgerDirtyRange.count()).toBeGreaterThan(0);

    // Drive the ledger pass explicitly (joins the worker's in-flight pass if one is running):
    // it seeds policy v1 at the earliest Sample, which is what monitoringSince now reports.
    await appA.get(LedgerService).processOnce();
    const earliest = await prisma.sample.findFirstOrThrow({
      orderBy: { observedAt: 'asc' },
      select: { observedAt: true },
    });
    const seeded = await gql(
      '{ collectorStatus { monitoringSince policyVersion } }',
      z.object({
        collectorStatus: z.object({
          monitoringSince: z.coerce.date().nullable(),
          policyVersion: z.number(),
        }),
      }),
    );
    expect(seeded.collectorStatus.policyVersion).toBe(1);
    expect(seeded.collectorStatus.monitoringSince?.toISOString()).toBe(
      earliest.observedAt.toISOString(),
    );
  }, 60_000);

  it('a second backend on the same database reports LOCK_NOT_HELD and never connects to the device', async () => {
    const clientsBefore = replay.stats.totalConnections;
    const dirB = await mkdtemp(join(tmpdir(), 'p2-b-'));
    dirs.push(dirB);
    const envB = envFor(dirB);
    appB = await createApp(envB, {
      tlsService: await TlsService.load(envB),
      schemaFile: true,
    });
    await until(
      () => appB.get(CollectorService).snapshot().state === 'LOCK_NOT_HELD',
      15_000,
      'LOCK_NOT_HELD',
    );
    await delay(1500);
    expect(replay.stats.totalConnections).toBe(clientsBefore);
    expect(replay.stats.maxConcurrentClients).toBe(1);
  }, 60_000);

  it('losing the replay server degrades the collector but the process keeps serving', async () => {
    await appB.close();
    await replay.close();
    await until(
      () => appA.get(CollectorService).snapshot().state === 'DEGRADED_UPSTREAM',
      20_000,
      'DEGRADED_UPSTREAM',
    );
    const snap = appA.get(CollectorService).snapshot();
    expect(snap.consecutiveFailures).toBeGreaterThan(0);
    expect(snap.nextRetryAt).not.toBeNull();
    const status = await gql(
      '{ collectorStatus { state } }',
      z.object({ collectorStatus: z.object({ state: z.string() }) }),
    );
    expect(status.collectorStatus.state).toBe('DEGRADED_UPSTREAM');
  }, 60_000);
});
