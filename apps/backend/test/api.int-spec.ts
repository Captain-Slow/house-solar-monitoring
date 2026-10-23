import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import https from 'node:https';
import type { AddressInfo } from 'node:net';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { INestApplication } from '@nestjs/common';
import { GraphQLSchemaHost } from '@nestjs/graphql';
import { createRequire } from 'node:module';
import type * as GraphQL from 'graphql';
import { z } from 'zod';
import { parseEnv } from '../src/config/env.js';
import { createApp } from '../src/main.js';
import { replaceDevice } from '../src/cli/device.js';
import { TokenService } from '../src/auth/token.service.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { ApiResolver } from '../src/graphql/api.resolver.js';
import { ReconciliationService } from '../src/reconciliation/reconciliation.service.js';
import { TlsService } from '../src/tls/tls.service.js';
import {
  SampleFlag,
  type CollectorStatusProvider,
} from '../src/collector/types.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
const { printSchema } = createRequire(import.meta.url)(
  'graphql',
) as typeof GraphQL;

const collector: CollectorStatusProvider = {
  snapshot: () => ({
    state: 'RUNNING',
    acquisitionSource: 'MODBUS',
    lastSuccessAt: new Date('2026-01-01'),
    lastErrorAt: null,
    lastError: null,
    consecutiveFailures: 0,
    nextRetryAt: null,
  }),
};

const powerSchema = z.object({
  watts: z.number().nullable(),
  status: z.string(),
  reason: z.string().nullable().optional(),
});
const liveSchema = z.object({
  liveStatus: z.object({
    freshness: z.string().optional(),
    ageSeconds: z.number().nullable().optional(),
    grid: powerSchema.optional(),
    battery: powerSchema.optional(),
    loadVendor: powerSchema.optional(),
    pvStrings: z.array(powerSchema).optional(),
    operatingMode: z
      .object({
        code: z.number(),
        label: z.string(),
        observedAt: z.string().optional(),
      })
      .nullable()
      .optional(),
    activeFaults: z.array(z.string()).optional(),
    accountingStatus: z.string().optional(),
    load: powerSchema.optional(),
    gridPhases: z.array(powerSchema).optional(),
    pv: powerSchema.optional(),
  }),
});
const collectorSchema = z.object({
  collectorStatus: z.object({
    acquisitionSource: z.string(),
    state: z.string(),
    mappingVersion: z.number(),
    policyVersion: z.number(),
    calcVersion: z.number(),
    monitoringSince: z.string().nullable(),
    lastBackupAt: z.string().nullable(),
  }),
  devices: z.array(z.object({ id: z.number(), model: z.string() })),
});
const eventsSchema = z.object({
  dataQualityEvents: z.object({
    edges: z.array(
      z.object({
        cursor: z.string(),
        node: z.object({ id: z.string(), kind: z.string() }),
      }),
    ),
    pageInfo: z.object({
      hasNextPage: z.boolean(),
      endCursor: z.string().nullable(),
    }),
  }),
});

describe('monitoring GraphQL', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let prisma: PrismaService;
  let tls: TlsService;
  let dir: string;
  let port: number;
  let token: string;
  let deviceId: number;
  let runId: number;
  let sequence = 0;

  async function query<T>(
    query: string,
    dataSchema: z.ZodType<T>,
    variables?: object,
  ): Promise<{
    data: T | null;
    errors: Array<{ message: string; extensions?: { code?: string } }>;
  }> {
    return new Promise((resolve, reject) => {
      const request = https.request(
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
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.on('end', () => {
            const raw = Buffer.concat(chunks).toString();
            const parsed = z
              .object({
                data: z.unknown().optional(),
                errors: z
                  .array(
                    z.object({
                      message: z.string(),
                      extensions: z
                        .object({ code: z.string().optional() })
                        .optional(),
                    }),
                  )
                  .optional(),
              })
              .parse(JSON.parse(raw));
            resolve({
              data: dataSchema.nullable().parse(parsed.data ?? null),
              errors: parsed.errors ?? [],
            });
          });
        },
      );
      request.on('error', reject);
      request.end(JSON.stringify({ query, variables }));
    });
  }

  async function seedSample(
    observedAt: Date,
    gridW: number | null,
    flags = 0,
    targetDeviceId = deviceId,
  ) {
    const seq = ++sequence;
    const raw = await prisma.rawPoll.create({
      data: {
        runId,
        seq,
        deviceId: targetDeviceId,
        tier: 'FAST',
        requestedAt: observedAt,
        receivedAt: observedAt,
        observedAt,
        blocks: Buffer.from([1]),
        contentHash: Buffer.alloc(32),
      },
    });
    return prisma.sample.create({
      data: {
        rawPollId: raw.id,
        deviceId: targetDeviceId,
        observedAt,
        mappingVersion: 1,
        meterLink: gridW === null ? 0 : 1,
        gridW,
        gridAW: gridW,
        gridBW: 0,
        gridCW: 0,
        inverterAcW: 200,
        epsW: 0,
        pvW: 200,
        pvStringW: [0, 200],
        batteryW: 0,
        batterySoc: 50,
        batteryState: 1,
        loadVendorW: 200,
        gridBuyPhaseWh: [],
        gridSellPhaseWh: [],
        meterRepeatSec: 0,
        flags,
      },
    });
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    dir = await mkdtemp(join(tmpdir(), 'solar-api-'));
    const env = parseEnv({
      DATABASE_URL: db.url,
      COLLECTOR_ENABLED: 'false',
      MODBUS_HOST: '127.0.0.1',
      MODBUS_PORT: '1502',
      TLS_DIR: dir,
      BACKUP_DIR: dir,
    });
    tls = await TlsService.load(env);
    app = await createApp(env, {
      tlsService: tls,
      schemaFile: true,
      collectorStatus: collector,
    });
    await app.listen(0, '127.0.0.1');
    const address: AddressInfo = app.getHttpServer().address();
    port = address.port;
    prisma = app.get(PrismaService);
    token = (await app.get(TokenService).create('api', 'VIEWER')).token;
    const source = await prisma.dataSource.create({
      data: { kind: 'MODBUS_TCP', endpoint: '127.0.0.1:1502#1' },
    });
    const device = await prisma.device.create({
      data: {
        dataSourceId: source.id,
        deviceKey: env.DEVICE_KEY,
        role: 'INVERTER',
        model: env.EXPECTED_MODEL,
        observedCapabilities: {},
        capabilitiesObservedAt: new Date(),
        firmware: {},
        latestStatus: {
          emsMode: 0,
          emsModeLabel: 'Self-use',
          emsModeObservedAt: '2026-01-01T00:00:00.000Z',
          activeFaults: { battery: ['Warning'] },
          observedAt: new Date().toISOString(),
        },
        firstSeenAt: new Date('2026-01-01'),
        lastSeenAt: new Date(),
      },
    });
    deviceId = device.id;
    const run = await prisma.collectorRun.create({
      data: {
        startedAt: new Date(),
        appVersion: 'test',
        registerMapVersion: 'test',
      },
    });
    runId = run.id;
    await prisma.mappingVersion.create({
      data: {
        version: 1,
        provisional: true,
        config: { batteryPowerSource: 'BMS_1914' },
        note: 'test',
      },
    });
    await writeFile(join(dir, 'last-success'), '2026-10-01T00:00:00.000Z');
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('keeps the committed SDL identical to the code-first runtime schema', async () => {
    const committed = await readFile(join(process.cwd(), 'schema.gql'), 'utf8');
    const runtime = printSchema(app.get(GraphQLSchemaHost).schema);
    expect(committed.trimEnd().endsWith(runtime.trimEnd())).toBe(true);
    expect(runtime).toContain('scalar LocalDate');
    expect(runtime).toContain('scalar Decimal');
  });

  it('reports no-data, then stale with original measured zeros and null grid reason, then live', async () => {
    let response = await query(
      '{ liveStatus { freshness ageSeconds observedAt grid { watts status reason } } }',
      liveSchema,
    );
    expect(response.data?.liveStatus.freshness).toBe('NO_DATA');
    await seedSample(
      new Date(Date.now() - 46_000),
      null,
      SampleFlag.METER_LINK_DOWN,
    );
    response = await query(
      '{ liveStatus { freshness ageSeconds grid { watts status reason } battery { watts status } pvStrings { watts status } operatingMode { code label observedAt } activeFaults batteryState meterLink accountingStatus } }',
      liveSchema,
    );
    expect(response.data?.liveStatus.freshness).toBe('STALE');
    expect(response.data?.liveStatus.ageSeconds).toBeGreaterThanOrEqual(45);
    expect(response.data?.liveStatus.grid).toEqual({
      watts: null,
      status: 'UNAVAILABLE',
      reason: 'METER_LINK_DOWN',
    });
    expect(response.data?.liveStatus.battery).toEqual({
      watts: 0,
      status: 'STALE',
    });
    expect(response.data?.liveStatus.pvStrings?.[0]).toEqual({
      watts: 0,
      status: 'STALE',
    });
    expect(response.data?.liveStatus.operatingMode?.label).toBe('Self-use');
    expect(response.data?.liveStatus.operatingMode?.observedAt).toBe(
      '2026-01-01T00:00:00.000Z',
    );
    expect(response.data?.liveStatus.activeFaults).toContain('Warning');
    expect(response.data?.liveStatus.accountingStatus).toBe(
      'MAPPING_PROVISIONAL',
    );
    const live = await seedSample(new Date(), 0);
    response = await query(
      '{ liveStatus { freshness grid { watts status } load { watts status } gridPhases { watts status } } }',
      liveSchema,
    );
    expect(response.data?.liveStatus.freshness).toBe('LIVE');
    expect(response.data?.liveStatus.grid).toEqual({ watts: 0, status: 'OK' });
    expect(response.data?.liveStatus.load?.watts).toBe(200);
    await prisma.sample.update({
      where: { id: live.id },
      data: { flags: SampleFlag.METER_STALE },
    });
    response = await query(
      '{ liveStatus { grid { watts status reason } gridPhases { watts status reason } pv { watts status } } }',
      liveSchema,
    );
    expect(response.data?.liveStatus.grid).toEqual({
      watts: null,
      status: 'UNAVAILABLE',
      reason: 'METER_STALE',
    });
    expect(response.data?.liveStatus.gridPhases?.[0]?.watts).toBeNull();
    expect(response.data?.liveStatus.pv?.watts).toBe(200);
    await prisma.sample.update({
      where: { id: live.id },
      data: {
        flags: SampleFlag.BLOCK_INVALID_0,
        pvW: null,
        pvStringW: [],
        loadVendorW: 345,
      },
    });
    response = await query(
      '{ liveStatus { pv { watts status reason } loadVendor { watts status } battery { watts status } } }',
      liveSchema,
    );
    expect(response.data?.liveStatus.pv).toEqual({
      watts: null,
      status: 'UNAVAILABLE',
      reason: 'BLOCK_INVALID_0',
    });
    expect(response.data?.liveStatus.loadVendor).toEqual({
      watts: 345,
      status: 'OK',
    });
    expect(response.data?.liveStatus.battery).toEqual({
      watts: 0,
      status: 'OK',
    });
    await prisma.sample.update({
      where: { id: live.id },
      data: { flags: SampleFlag.CLOCK_STEP },
    });
    response = await query(
      '{ liveStatus { loadVendor { watts status reason } battery { watts status reason } } }',
      liveSchema,
    );
    expect(response.data?.liveStatus.loadVendor).toEqual({
      watts: null,
      status: 'UNAVAILABLE',
      reason: 'CLOCK_STEP',
    });
    expect(response.data?.liveStatus.battery).toEqual({
      watts: null,
      status: 'UNAVAILABLE',
      reason: 'CLOCK_STEP',
    });
  });

  it('reports collector metadata and enforces GraphQL query depth', async () => {
    const result = await query(
      '{ collectorStatus { acquisitionSource state device { id deviceKey } mappingVersion policyVersion calcVersion monitoringSince lastBackupAt tlsCertExpiresAt } devices { id model } }',
      collectorSchema,
    );
    expect(result.errors).toHaveLength(0);
    expect(result.data?.collectorStatus).toMatchObject({
      acquisitionSource: 'MODBUS',
      state: 'RUNNING',
      mappingVersion: 1,
      policyVersion: 0,
      calcVersion: 0,
    });
    expect(result.data?.collectorStatus.monitoringSince).toBeTruthy();
    expect(result.data?.collectorStatus.lastBackupAt).toBe(
      '2026-10-01T00:00:00.000Z',
    );
    expect(result.data?.devices).toHaveLength(1);
    const nested = (depth: number) =>
      `{ __type(name: "String") { ${'ofType { '.repeat(depth - 2)}name ${'} '.repeat(depth - 2)} } }`;
    expect((await query(nested(8), z.unknown())).errors).toHaveLength(0);
    expect((await query(nested(9), z.unknown())).errors[0]?.message).toMatch(
      /depth/i,
    );
  });

  it('rejects exponential fragment expansion in bounded time', async () => {
    const fragments = Array.from(
      { length: 30 },
      (_, i) => `fragment F${i} on Query { ...F${i + 1} ...F${i + 1} }`,
    );
    const document = `query { ...F0 } ${fragments.join(' ')} fragment F30 on Query { __typename }`;
    const start = performance.now();
    const result = await query(document, z.unknown());
    expect(performance.now() - start).toBeLessThan(200);
    expect(result.errors[0]?.extensions?.code).toBe('BAD_USER_INPUT');
    expect(result.errors[0]?.message).toMatch(/selections/i);
  });

  it('paginates quality events with opaque id cursors and rejects excessive page size', async () => {
    const since = new Date('2026-01-01');
    for (let n = 0; n < 3; n++)
      await prisma.dataQualityEvent.create({
        data: {
          kind: 'GAP',
          startedAt: new Date(since.getTime() + n * 1000),
          details: {},
          deviceId,
        },
      });
    const gql = `query($first: Int, $after: String) { dataQualityEvents(from: "2026-01-01T00:00:00.000Z", to: "2027-01-01T00:00:00.000Z", kinds: ["GAP"], first: $first, after: $after) { edges { cursor node { id kind } } pageInfo { hasNextPage endCursor } } }`;
    const first = (await query(gql, eventsSchema, { first: 2 })).data
      ?.dataQualityEvents;
    expect(first?.edges).toHaveLength(2);
    expect(first?.pageInfo.hasNextPage).toBe(true);
    const next = (
      await query(gql, eventsSchema, {
        first: 2,
        after: first?.pageInfo.endCursor,
      })
    ).data?.dataQualityEvents;
    expect(next?.edges).toHaveLength(1);
    expect(next?.edges[0]?.node.id).not.toBe(first?.edges[1]?.node.id);
    expect(next?.pageInfo.hasNextPage).toBe(false);
    expect(
      (await query(gql, eventsSchema, { first: 101 })).errors[0]?.extensions
        ?.code,
    ).toBe('BAD_USER_INPUT');
  });

  it('keeps a scheduled replacement on the old interval until its effective time', async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const { deviceId: replacementId } = await replaceDevice(prisma, {
      key: 'inverter-1',
      effectiveAt: future,
      reason: 'scheduled interval handover',
    });
    await seedSample(new Date(), 123);
    const fields =
      '{ liveStatus { freshness grid { watts status } } collectorStatus { device { id } } devices { id } }';
    const schema = z.object({
      liveStatus: z.object({ freshness: z.string(), grid: powerSchema }),
      collectorStatus: z.object({
        device: z.object({ id: z.number() }).nullable(),
      }),
      devices: z.array(z.object({ id: z.number() })),
    });
    const pending = await query(fields, schema);
    expect(pending.errors).toHaveLength(0);
    expect(pending.data?.liveStatus.freshness).toBe('LIVE');
    expect(pending.data?.liveStatus.grid.watts).toBe(123);
    expect(pending.data?.collectorStatus.device?.id).toBe(deviceId);
    expect(pending.data?.devices.map((device) => device.id)).toEqual([
      deviceId,
      replacementId,
    ]);

    const past = new Date(Date.now() - 60 * 60 * 1000);
    await prisma.$transaction([
      prisma.device.update({
        where: { id: deviceId },
        data: { retiredAt: past },
      }),
      prisma.device.update({
        where: { id: replacementId },
        data: { firstSeenAt: past },
      }),
    ]);
    await seedSample(new Date(), 765, 0, replacementId);
    const switched = await query(fields, schema);
    expect(switched.errors).toHaveLength(0);
    expect(switched.data?.liveStatus.freshness).toBe('LIVE');
    expect(switched.data?.liveStatus.grid.watts).toBe(765);
    expect(switched.data?.collectorStatus.device?.id).toBe(replacementId);
  });
  it('still resolves the configured device when an unrelated Modbus source exists and MODBUS_HOST is unset', async () => {
    const other = await prisma.dataSource.create({
      data: { kind: 'MODBUS_TCP', endpoint: '192.0.2.9:502#1' },
    });
    await prisma.device.create({
      data: {
        dataSourceId: other.id,
        deviceKey: 'spare',
        role: 'INVERTER',
        model: 'X',
        observedCapabilities: {},
        capabilitiesObservedAt: new Date(),
        firmware: {},
        firstSeenAt: new Date('2026-01-01'),
        lastSeenAt: new Date(),
      },
    });
    // Same resolver, but configured like a collector-less deployment: no MODBUS_HOST.
    const noHost = parseEnv({
      DATABASE_URL: db.url,
      COLLECTOR_ENABLED: 'false',
    });
    const resolver = new ApiResolver(
      prisma,
      collector,
      noHost,
      tls,
      new ReconciliationService(prisma),
    );
    const status = await resolver.collectorStatus();
    expect(status.device).not.toBeNull();
    expect(status.device?.deviceKey).toBe('inverter-1'); // not the unrelated 'spare' device
  });
  it('reports lastBackupAt as null instead of failing when the backup marker cannot be read', async () => {
    // A directory named last-success makes readFile fail with EISDIR (like EACCES on the NAS).
    const unreadable = await mkdtemp(join(tmpdir(), 'solar-nobackup-'));
    await mkdir(join(unreadable, 'last-success'));
    try {
      const env = parseEnv({
        DATABASE_URL: db.url,
        COLLECTOR_ENABLED: 'false',
        BACKUP_DIR: unreadable,
      });
      const status = await new ApiResolver(
        prisma,
        collector,
        env,
        tls,
        new ReconciliationService(prisma),
      ).collectorStatus();
      expect(status.lastBackupAt).toBeNull();
    } finally {
      await rm(unreadable, { recursive: true, force: true });
    }
  });
});
