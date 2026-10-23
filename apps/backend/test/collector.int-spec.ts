import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Test } from '@nestjs/testing';
import { connect, createServer, type Socket } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CollectorService,
  ENV,
  INGEST_SINK,
  type CollectorSeams,
  type IngestSink,
} from '../src/collector/collector.service.js';
import { CollectorLock } from '../src/collector/collector-lock.js';
import { deviceActiveAt, resolveDevice } from '../src/collector/identity.js';
import { SampleFlag } from '../src/collector/types.js';
import { IngestService } from '../src/collector/ingest.service.js';
import { RawPollRenormalizer } from '../src/accounting/raw-poll-renormalizer.js';
import { replaceDevice } from '../src/cli/device.js';
import {
  startReplayServer,
  type ReplayServer,
} from '../src/cli/replay-server.js';
import { parseEnv } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import {
  ModbusTransportError,
  ReadonlyModbusClient,
} from '../src/modbus/readonly-modbus-client.js';
import { freePort } from './support/net.js';
import {
  createTestDatabase,
  terminateLockHolder,
  type TestDatabase,
} from './support/db.js';
import {
  recordsFor,
  plausibleImage,
  setModel,
  blocksFrom,
} from './support/synthetic.js';
import { DETECT_BLOCKS } from '../src/modbus/read-plan.js';

async function until(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 12_000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(40);
  }
  throw new Error('collector condition not reached');
}

function requestCount(server: ReplayServer): number {
  return [...server.stats.functionCodes.values()].reduce((a, b) => a + b, 0);
}

describe('Modbus replay collector (V24/V25)', () => {
  const leaseMs = 1000;
  const timeoutMs = 200;
  const takeoverDelayMs = leaseMs + timeoutMs;
  let db: TestDatabase;
  let prisma: PrismaService;
  const servers: ReplayServer[] = [];
  const collectors: CollectorService[] = [];
  beforeAll(async () => {
    db = await createTestDatabase();
    prisma = new PrismaService({ DATABASE_URL: db.url });
  });
  afterAll(async () => {
    for (const collector of collectors.reverse())
      await collector.beforeApplicationShutdown();
    for (const server of servers.reverse()) await server.close();
    await prisma.close();
    await db.drop();
  });

  async function replay(port: number, night = false): Promise<ReplayServer> {
    const server = await startReplayServer({
      port,
      records: recordsFor([{ night }]),
    });
    servers.push(server);
    return server;
  }

  function start(
    port: number,
    key: string,
    overrides: Record<string, string> = {},
    now?: () => number,
    sinkOverride?: IngestSink,
    factory?: CollectorSeams['clientFactory'],
    lockFactory?: CollectorSeams['lockFactory'],
    monotonicMs?: () => number,
  ): CollectorService {
    const env = parseEnv({
      DATABASE_URL: db.url,
      MODBUS_HOST: '127.0.0.1',
      MODBUS_PORT: String(port),
      MODBUS_TIMEOUT_MS: String(timeoutMs),
      OWNERSHIP_LEASE_SEC: String(leaseMs / 1000),
      POLL_FAST_MS: '1000',
      POLL_SLOW_MS: '1000',
      POLL_SETTINGS_MS: '1000',
      DEVICE_KEY: key,
      ...overrides,
    });
    const ingest = new IngestService(prisma);
    const sink: IngestSink = {
      ingest: (polls) => ingest.ingest(polls, { maxRepeatSpanSec: 30 }),
    };
    const collector = new CollectorService(prisma, sinkOverride ?? sink, env, {
      rand: () => 0.5,
      ...(now === undefined ? {} : { now }),
      ...(factory === undefined ? {} : { clientFactory: factory }),
      ...(lockFactory === undefined ? {} : { lockFactory }),
      ...(monotonicMs === undefined ? {} : { monotonicMs }),
      lockOptions: { heartbeatMs: 100 },
    });
    collectors.push(collector);
    return collector;
  }

  it('keeps the same device through night detection and replaces only by explicit CLI boundary', async () => {
    const port = await freePort();
    const dayServer = await replay(port);
    const day = start(port, 'day-night', { POLL_SETTINGS_MS: '10000' });
    await day.onApplicationBootstrap();
    await until(() => day.snapshot().state === 'RUNNING');
    await until(
      async () =>
        (await prisma.sample.count({
          where: { device: { deviceKey: 'day-night' } },
        })) > 0,
    );
    const first = await prisma.device.findFirstOrThrow({
      where: { deviceKey: 'day-night', retiredAt: null },
    });
    await until(async () => {
      const status = (
        await prisma.device.findUniqueOrThrow({ where: { id: first.id } })
      ).latestStatus;
      return (
        typeof status === 'object' &&
        status !== null &&
        !Array.isArray(status) &&
        typeof status.emsModeObservedAt === 'string'
      );
    });
    const initialStatus = (
      await prisma.device.findUniqueOrThrow({ where: { id: first.id } })
    ).latestStatus;
    const emsObservedAt =
      typeof initialStatus === 'object' &&
      initialStatus !== null &&
      !Array.isArray(initialStatus)
        ? initialStatus.emsModeObservedAt
        : null;
    await until(
      async () =>
        (await prisma.sample.count({ where: { deviceId: first.id } })) >= 3,
    );
    const laterStatus = (
      await prisma.device.findUniqueOrThrow({ where: { id: first.id } })
    ).latestStatus;
    expect(laterStatus).toMatchObject({ emsModeObservedAt: emsObservedAt });
    await day.beforeApplicationShutdown();
    await dayServer.close();
    servers.splice(servers.indexOf(dayServer), 1);

    const nightServer = await replay(port, true);
    const night = start(port, 'day-night');
    await night.onApplicationBootstrap();
    await until(
      async () =>
        (await prisma.dataQualityEvent.count({
          where: { kind: 'CAPABILITY_CHANGED', deviceId: first.id },
        })) > 0,
    );
    const same = await prisma.device.findMany({
      where: { deviceKey: 'day-night' },
    });
    expect(same).toHaveLength(1);
    expect(same[0]!.id).toBe(first.id);
    expect(same[0]!.retiredAt).toBeNull();
    expect(same[0]!.observedCapabilities).toMatchObject({ mpptCount: 0 });
    expect(nightServer.stats.maxConcurrentClients).toBe(1);
    await night.beforeApplicationShutdown();

    const replacement = await replaceDevice(prisma, {
      key: 'day-night',
      effectiveAt: new Date(),
      reason: 'physical replacement',
    });
    expect(replacement.retiredDeviceId).toBe(first.id);
    expect(replacement.deviceId).not.toBe(first.id);
    expect(
      await prisma.device.count({
        where: { deviceKey: 'day-night', retiredAt: null },
      }),
    ).toBe(1);
    expect(
      await prisma.dataQualityEvent.count({
        where: { kind: 'DEVICE_REPLACED', deviceId: replacement.deviceId },
      }),
    ).toBe(1);
    const retired = await prisma.device.findUniqueOrThrow({
      where: { id: first.id },
    });
    const fresh = await prisma.device.findUniqueOrThrow({
      where: { id: replacement.deviceId },
    });
    expect(retired.retiredAt).not.toBeNull();
    expect(retired.replacementReason).toBe('physical replacement');
    expect(fresh.model).toBe(retired.model);
    expect(fresh.observedCapabilities).toEqual(retired.observedCapabilities);
    await expect(
      replaceDevice(prisma, {
        key: 'missing-device',
        effectiveAt: new Date(),
        reason: 'not found',
      }),
    ).rejects.toThrow('exactly one active device');
  });

  it('moves live collection to the explicit replacement at its effective time', async () => {
    const port = await freePort();
    await replay(port);
    const collector = start(port, 'live-replacement');
    await collector.onApplicationBootstrap();
    await until(
      async () =>
        (await prisma.sample.count({
          where: { device: { deviceKey: 'live-replacement' } },
        })) > 0,
    );
    const previous = await prisma.device.findFirstOrThrow({
      where: { deviceKey: 'live-replacement', retiredAt: null },
    });
    const effectiveAt = new Date();
    const next = await replaceDevice(prisma, {
      key: 'live-replacement',
      effectiveAt,
      reason: 'swapped inverter',
    });
    await until(
      async () =>
        (await prisma.sample.count({ where: { deviceId: next.deviceId } })) > 0,
    );
    expect(
      await prisma.sample.count({
        where: { deviceId: previous.id, observedAt: { gte: effectiveAt } },
      }),
    ).toBe(0);
    await collector.beforeApplicationShutdown();
  });

  it('assigns SLOW and SETTINGS to the device owning their own observation times', async () => {
    const port = await freePort();
    await replay(port);
    let replacement: { retiredDeviceId: number; deviceId: number } | undefined;
    let effectiveAt: Date | undefined;
    class BoundaryClient extends ReadonlyModbusClient {
      private switched = false;
      override async readInput(addr: number, len: number): Promise<number[]> {
        if (addr === 123 && len === 123 && !this.switched) {
          this.switched = true;
          effectiveAt = new Date(Date.now() + 20);
          replacement = await replaceDevice(prisma, {
            key: 'tier-boundary',
            effectiveAt,
            reason: 'between FAST and SLOW',
          });
          await delay(200);
        }
        return super.readInput(addr, len);
      }
    }
    const collector = start(
      port,
      'tier-boundary',
      {},
      undefined,
      undefined,
      (opts) => new BoundaryClient(opts),
    );
    await collector.onApplicationBootstrap();
    await until(() => replacement !== undefined);
    await until(
      async () =>
        (await prisma.rawPoll.count({
          where: { deviceId: replacement!.deviceId, tier: 'SLOW' },
        })) > 0,
    );
    const slow = await prisma.rawPoll.findFirstOrThrow({
      where: { deviceId: replacement!.deviceId, tier: 'SLOW' },
    });
    const precedingFast = await prisma.rawPoll.findFirstOrThrow({
      where: { runId: slow.runId, seq: { lt: slow.seq }, tier: 'FAST' },
      orderBy: { seq: 'desc' },
    });
    expect(precedingFast.deviceId).toBe(replacement!.retiredDeviceId);
    expect(precedingFast.observedAt.getTime()).toBeLessThan(
      effectiveAt!.getTime(),
    );
    expect(slow.observedAt.getTime()).toBeGreaterThanOrEqual(
      effectiveAt!.getTime(),
    );
    await until(
      async () =>
        (await prisma.rawPoll.count({
          where: { deviceId: replacement!.deviceId, tier: 'SETTINGS' },
        })) > 0,
    );
    const oldRow = await prisma.device.findUniqueOrThrow({
      where: { id: replacement!.retiredDeviceId },
    });
    const newRow = await prisma.device.findUniqueOrThrow({
      where: { id: replacement!.deviceId },
    });
    expect(oldRow.firmware).toMatchObject({ safetyDspVersion: null });
    expect(newRow.firmware).toMatchObject({ safetyDspVersion: 102 });
    expect(newRow.latestStatus).toMatchObject({ emsMode: 0 });
    await collector.beforeApplicationShutdown();
  });

  it('uses the old device until a future-effective replacement, even across reconnect', async () => {
    const port = await freePort();
    const server = await replay(port);
    let client: ReadonlyModbusClient | undefined;
    let skew = 0;
    const collector = start(
      port,
      'scheduled-replacement',
      {},
      () => Date.now() + skew,
      undefined,
      (opts) => {
        client = new ReadonlyModbusClient(opts);
        return client;
      },
    );
    await collector.onApplicationBootstrap();
    await until(
      async () =>
        (await prisma.sample.count({
          where: { device: { deviceKey: 'scheduled-replacement' } },
        })) > 0,
    );
    const previous = await prisma.device.findFirstOrThrow({
      where: { deviceKey: 'scheduled-replacement', retiredAt: null },
    });
    const effectiveAt = new Date(Date.now() + 7000);
    const replacement = await replaceDevice(prisma, {
      key: 'scheduled-replacement',
      effectiveAt,
      reason: 'scheduled swap',
    });
    const oldCountBeforeReconnect = await prisma.sample.count({
      where: { deviceId: previous.id },
    });
    await client!.close(); // force a transport reconnect before the future boundary
    await until(() => collector.snapshot().state === 'DEGRADED_UPSTREAM');
    skew +=
      collector.snapshot().nextRetryAt!.getTime() -
      (Date.now() + skew) +
      leaseMs;
    await until(() => server.stats.totalConnections >= 2);
    expect(Date.now()).toBeLessThan(effectiveAt.getTime());
    await until(
      async () =>
        (await prisma.sample.count({
          where: { deviceId: previous.id, observedAt: { lt: effectiveAt } },
        })) > oldCountBeforeReconnect,
    );
    expect(
      await prisma.sample.count({
        where: {
          deviceId: replacement.deviceId,
          observedAt: { lt: effectiveAt },
        },
      }),
    ).toBe(0);
    await until(
      async () =>
        (await prisma.sample.count({
          where: {
            deviceId: replacement.deviceId,
            observedAt: { gte: effectiveAt },
          },
        })) > 0,
      12_000,
    );
    expect(
      await prisma.sample.count({
        where: { deviceId: previous.id, observedAt: { gte: effectiveAt } },
      }),
    ).toBe(0);
    await collector.beforeApplicationShutdown();
  });

  it('keeps a single identity when the collector clock precedes firstSeenAt', async () => {
    const source = await prisma.dataSource.create({
      data: { kind: 'MODBUS_TCP', endpoint: `127.0.0.1:${await freePort()}#1` },
    });
    const future = new Date(Date.now() + 60_000);
    const observed = {
      hasBattery: true,
      hasGridMeter: true,
      mpptCount: 2,
      batteryCapacityKwh: 16,
    };
    const firmware = { powerDspVersion: 105, safetyDspVersion: null };
    const existing = await prisma.device.create({
      data: {
        dataSourceId: source.id,
        deviceKey: 'clock-rewind',
        role: 'INVERTER',
        model: 'HIT-10L-G3',
        observedCapabilities: observed,
        firmware,
        capabilitiesObservedAt: future,
        firstSeenAt: future,
        lastSeenAt: future,
      },
    });
    const detected = {
      model: existing.model,
      observed,
      firmware,
      raw: {
        tier: 'DETECT' as const,
        requestedAt: new Date(),
        receivedAt: new Date(),
        blocks: [],
      },
    };
    const resolved = await resolveDevice(prisma, {
      dataSourceEndpoint: source.endpoint,
      deviceKey: 'clock-rewind',
      detected,
    });
    expect(resolved).toEqual({
      deviceId: existing.id,
      created: false,
      capabilityChanged: false,
    });
    expect(
      (await deviceActiveAt(prisma, source.id, 'clock-rewind', new Date()))?.id,
    ).toBe(existing.id);
    expect(
      await prisma.device.count({
        where: { dataSourceId: source.id, deviceKey: 'clock-rewind' },
      }),
    ).toBe(1);
  });

  it('does not create an implicit replacement when only retired history exists', async () => {
    const source = await prisma.dataSource.create({
      data: { kind: 'MODBUS_TCP', endpoint: `127.0.0.1:${await freePort()}#1` },
    });
    const observed = {
      hasBattery: true,
      hasGridMeter: true,
      mpptCount: 2,
      batteryCapacityKwh: 16,
    };
    const firmware = { powerDspVersion: 105, safetyDspVersion: null };
    const firstSeenAt = new Date(Date.now() - 60_000);
    await prisma.device.create({
      data: {
        dataSourceId: source.id,
        deviceKey: 'retired-only',
        role: 'INVERTER',
        model: 'HIT-10L-G3',
        observedCapabilities: observed,
        firmware,
        capabilitiesObservedAt: firstSeenAt,
        firstSeenAt,
        lastSeenAt: firstSeenAt,
        retiredAt: new Date(Date.now() - 1000),
        replacementReason: 'retired without replacement',
      },
    });
    const detected = {
      model: 'HIT-10L-G3',
      observed,
      firmware,
      raw: {
        tier: 'DETECT' as const,
        requestedAt: new Date(),
        receivedAt: new Date(),
        blocks: [],
      },
    };
    await expect(
      resolveDevice(prisma, {
        dataSourceEndpoint: source.endpoint,
        deviceKey: 'retired-only',
        detected,
      }),
    ).rejects.toThrow('device identity cannot be resolved');
    expect(
      await prisma.device.count({
        where: { dataSourceId: source.id, deviceKey: 'retired-only' },
      }),
    ).toBe(1);
  });

  it('starts while PostgreSQL is unreachable, then creates one run and recovers when it returns', async () => {
    const port = await freePort();
    await replay(port);
    const proxyPort = await freePort();
    const databaseUrl = new URL(db.url);
    const targetPort = Number(databaseUrl.port);
    databaseUrl.port = String(proxyPort);
    const localPrisma = new PrismaService({
      DATABASE_URL: databaseUrl.toString(),
    });
    const env = parseEnv({
      DATABASE_URL: databaseUrl.toString(),
      MODBUS_HOST: '127.0.0.1',
      MODBUS_PORT: String(port),
      MODBUS_TIMEOUT_MS: String(timeoutMs),
      OWNERSHIP_LEASE_SEC: String(leaseMs / 1000),
      POLL_FAST_MS: '1000',
    });
    const ingest = new IngestService(localPrisma);
    const collector = new CollectorService(
      localPrisma,
      { ingest: (polls) => ingest.ingest(polls, { maxRepeatSpanSec: 30 }) },
      env,
      { lockOptions: { heartbeatMs: 100 } },
    );
    const sockets = new Set<Socket>();
    const proxy = createServer((down) => {
      const up = connect(targetPort, '127.0.0.1');
      sockets.add(down).add(up);
      down.pipe(up);
      up.pipe(down);
      down.on('error', () => up.destroy());
      up.on('error', () => down.destroy());
      down.on('close', () => {
        sockets.delete(down);
        up.destroy();
      });
      up.on('close', () => {
        sockets.delete(up);
        down.destroy();
      });
    });
    try {
      await collector.onApplicationBootstrap();
      await until(
        () =>
          collector.snapshot().lastError === 'collector database unavailable',
      );
      expect(collector.snapshot().state).toBe('LOCK_NOT_HELD');
      await new Promise<void>((resolve) =>
        proxy.listen(proxyPort, '127.0.0.1', resolve),
      );
      await until(() => collector.snapshot().state === 'RUNNING', 20_000);
      expect(
        await localPrisma.collectorRun.count({ where: { endedAt: null } }),
      ).toBe(1);
    } finally {
      await collector.beforeApplicationShutdown();
      await localPrisma.close();
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => proxy.close(() => resolve()));
    }
  });

  it('rejects unexpected model before writing any sample', async () => {
    const port = await freePort();
    const records = recordsFor([{}]);
    const altered = plausibleImage();
    setModel(altered, 'HIT-15L-G3');
    records[0]!.blocks = blocksFrom(DETECT_BLOCKS, altered);
    servers.push(await startReplayServer({ port, records }));
    const collector = start(port, 'wrong-model');
    await collector.onApplicationBootstrap();
    await until(() => collector.snapshot().state === 'IDENTITY_MISMATCH');
    await until(
      async () =>
        (await prisma.dataQualityEvent.count({
          where: { kind: 'IDENTITY_MISMATCH' },
        })) > 0,
    );
    expect(
      await prisma.device.count({ where: { deviceKey: 'wrong-model' } }),
    ).toBe(0);
    expect(
      await prisma.sample.count({
        where: { device: { deviceKey: 'wrong-model' } },
      }),
    ).toBe(0);
    await collector.beforeApplicationShutdown();
  });

  it('stops requests on lock loss, excludes the standby until takeover delay, and survives upstream loss', async () => {
    const port = await freePort();
    const server = await replay(port);
    const a = start(port, 'owner-a');
    let skew = 0;
    let bLock: CollectorLock | undefined;
    let bAcquiredAt = 0;
    const b = start(
      port,
      'owner-b',
      {},
      () => Date.now() + skew,
      undefined,
      undefined,
      (opts) => {
        bLock = new CollectorLock(opts);
        bLock.on('acquired', () => {
          bAcquiredAt = Date.now();
        });
        return bLock;
      },
    );
    await a.onApplicationBootstrap();
    await until(() => a.snapshot().state === 'RUNNING');
    await b.onApplicationBootstrap();
    await until(
      () =>
        b.snapshot().state === 'LOCK_NOT_HELD' &&
        b.snapshot().nextRetryAt !== null,
    );
    expect(server.stats.totalConnections).toBe(1);
    expect(await terminateLockHolder(727001, db.url)).toBe(1);
    await until(
      () =>
        a.snapshot().state === 'LOCK_NOT_HELD' && server.stats.clients === 0,
    );
    const owner = await prisma.device.findFirstOrThrow({
      where: { deviceKey: 'owner-a' },
    });
    await until(
      async () =>
        (await prisma.dataQualityEvent.count({
          where: { deviceId: owner.id, kind: 'DB_UNAVAILABLE' },
        })) === 1,
    );
    expect(
      await prisma.dataQualityEvent.count({
        where: { deviceId: owner.id, kind: 'CONNECTION_LOST' },
      }),
    ).toBe(1);
    const count = requestCount(server);
    const before = server.stats.totalConnections;
    skew += b.snapshot().nextRetryAt!.getTime() - Date.now() + leaseMs;
    await until(() => bAcquiredAt > 0);
    expect(bLock?.isOwned()).toBe(true);
    await delay(
      Math.max(0, bAcquiredAt + Math.floor(takeoverDelayMs / 2) - Date.now()),
    );
    expect(requestCount(server)).toBe(count);
    expect(server.stats.totalConnections).toBe(before);
    await until(() => b.snapshot().state === 'RUNNING', takeoverDelayMs * 5);
    expect(server.stats.maxConcurrentClients).toBe(1);
    expect(a.snapshot().state).toBe('LOCK_NOT_HELD');
    await server.close();
    servers.splice(servers.indexOf(server), 1);
    await until(
      () => b.snapshot().state === 'DEGRADED_UPSTREAM',
      takeoverDelayMs * 5,
    );
    expect(b.snapshot().nextRetryAt).not.toBeNull();
    await b.beforeApplicationShutdown();
    await a.beforeApplicationShutdown();
  });
  it('flushes already captured samples after ownership is lost and persistence recovers', async () => {
    const port = await freePort();
    const server = await replay(port);
    const ingest = new IngestService(prisma);
    let available = false;
    let failures = 0;
    const sink: IngestSink = {
      ingest: async (polls) => {
        if (!available) {
          failures++;
          throw new Error('temporary insert outage');
        }
        return ingest.ingest(polls, { maxRepeatSpanSec: 30 });
      },
    };
    const collector = start(port, 'buffer-recovery', {}, undefined, sink);
    await collector.onApplicationBootstrap();
    await until(() => collector.snapshot().state === 'RUNNING' && failures > 0);
    expect(
      await prisma.sample.count({
        where: { device: { deviceKey: 'buffer-recovery' } },
      }),
    ).toBe(0);
    expect(await terminateLockHolder(727001, db.url)).toBe(1);
    await until(
      () =>
        collector.snapshot().state === 'LOCK_NOT_HELD' &&
        server.stats.clients === 0,
    );
    available = true;
    await until(
      async () =>
        (await prisma.sample.count({
          where: { device: { deviceKey: 'buffer-recovery' } },
        })) > 0,
      9000,
    );
    expect(collector.snapshot().state).toBe('LOCK_NOT_HELD');
    await collector.beforeApplicationShutdown();
  });
  it('drains both a failed pending batch and all later buffered polls on shutdown', async () => {
    const port = await freePort();
    const server = await replay(port);
    const ingest = new IngestService(prisma);
    let available = false;
    let failures = 0;
    const sink: IngestSink = {
      ingest: async (polls) => {
        if (!available) {
          failures++;
          throw new Error('temporary inserts denied');
        }
        return ingest.ingest(polls, { maxRepeatSpanSec: 30 });
      },
    };
    const collector = start(
      port,
      'shutdown-buffer',
      { POLL_SLOW_MS: '60000', POLL_SETTINGS_MS: '60000' },
      undefined,
      sink,
    );
    await collector.onApplicationBootstrap();
    await until(() => failures > 0 && server.state.cycles >= 20, 35_000);
    expect(
      await prisma.sample.count({
        where: { device: { deviceKey: 'shutdown-buffer' } },
      }),
    ).toBe(0);
    available = true;
    await collector.beforeApplicationShutdown();
    expect(
      await prisma.sample.count({
        where: { device: { deviceKey: 'shutdown-buffer' } },
      }),
    ).toBeGreaterThanOrEqual(20);
  });

  it('uses the monotonic poll midpoint so a slow FAST read does not signal CLOCK_STEP', async () => {
    const port = await freePort();
    await replay(port);
    class SlowFirstFastClient extends ReadonlyModbusClient {
      private seenDetect = false;
      private slowReadDone = false;
      override async readInput(addr: number, len: number): Promise<number[]> {
        if (addr === 0 && len === 123) {
          if (this.seenDetect && !this.slowReadDone) {
            this.slowReadDone = true;
            await delay(6000);
          }
          this.seenDetect = true;
        }
        return super.readInput(addr, len);
      }
    }
    const collector = start(
      port,
      'clock-midpoint',
      {},
      undefined,
      undefined,
      (opts) => new SlowFirstFastClient(opts),
    );
    await collector.onApplicationBootstrap();
    await until(
      async () =>
        (await prisma.sample.count({
          where: { device: { deviceKey: 'clock-midpoint' } },
        })) >= 2,
      15_000,
    );
    const samples = await prisma.sample.findMany({
      where: { device: { deviceKey: 'clock-midpoint' } },
      orderBy: { observedAt: 'asc' },
      take: 2,
    });
    expect(samples[1]!.flags & SampleFlag.CLOCK_STEP).toBe(0);
    await collector.beforeApplicationShutdown();
  });

  it('persists the normalization clock with each FAST poll so an unchanged-mapping rebuild reproduces it', async () => {
    const port = await freePort();
    await replay(port);
    // The replay serves a frozen meter. The collector's monotonic clock runs 20x faster than the
    // wall clock: every poll after the first is a clock step and the frozen meter is stale quickly.
    const collector = start(
      port,
      'clock-persist',
      { POLL_SLOW_MS: '1000' },
      undefined,
      undefined,
      undefined,
      undefined,
      () => performance.now() * 20,
    );
    await collector.onApplicationBootstrap();
    await until(
      async () =>
        (await prisma.sample.count({
          where: { device: { deviceKey: 'clock-persist' } },
        })) >= 5,
      20_000,
    );
    await collector.beforeApplicationShutdown();
    const deviceId = (
      await prisma.device.findFirstOrThrow({
        where: { deviceKey: 'clock-persist' },
      })
    ).id;
    const polls = await prisma.rawPoll.findMany({
      where: { deviceId },
      orderBy: { seq: 'asc' },
    });
    const fast = polls.filter((poll) => poll.tier === 'FAST');
    expect(fast.length).toBeGreaterThanOrEqual(5);
    expect(fast.every((poll) => poll.monotonicMs !== null)).toBe(true);
    expect(
      polls.some((poll) => poll.tier !== 'FAST' && poll.monotonicMs !== null),
    ).toBe(false);
    for (let i = 1; i < fast.length; i++)
      expect(fast[i]!.monotonicMs!).toBeGreaterThan(fast[i - 1]!.monotonicMs!);
    const acquired = await prisma.sample.findMany({
      where: { deviceId },
      orderBy: { observedAt: 'asc' },
    });
    expect(fast.map((poll) => poll.acquisitionClockStep)).toEqual(
      acquired.map((sample) => !!(sample.flags & SampleFlag.CLOCK_STEP)),
    );
    expect(fast.map((poll) => poll.acquisitionMeterRepeatSec)).toEqual(
      acquired.map((sample) => sample.meterRepeatSec),
    );
    expect(
      polls
        .filter((poll) => poll.tier !== 'FAST')
        .every(
          (poll) =>
            poll.acquisitionClockStep === null &&
            poll.acquisitionMeterRepeatSec === null,
        ),
    ).toBe(true);
    expect(acquired[0]!.flags & SampleFlag.CLOCK_STEP).toBe(0);
    expect(
      acquired.slice(1).every((row) => row.flags & SampleFlag.CLOCK_STEP),
    ).toBe(true);
    // About 20 s of monotonic time per poll: the frozen meter exceeds the 30 s limit by the third.
    expect(acquired[2]!.meterRepeatSec).toBeGreaterThan(30);
    expect(acquired[2]!.flags & SampleFlag.METER_STALE).not.toBe(0);

    await new RawPollRenormalizer(prisma).renormalize(
      0,
      Date.now() + 3_600_000,
      await prisma.mappingVersion.findFirstOrThrow({
        orderBy: { version: 'desc' },
      }),
    );

    const rebuilt = await prisma.sample.findMany({
      where: { deviceId },
      orderBy: { observedAt: 'asc' },
    });
    expect(rebuilt.map((row) => [row.flags, row.meterRepeatSec])).toEqual(
      acquired.map((row) => [row.flags, row.meterRepeatSec]),
    );
  });

  it('retains escalating reconnect failures when DETECT succeeds but FAST transport fails', async () => {
    const port = await freePort();
    await replay(port);
    class FailFastClient extends ReadonlyModbusClient {
      private seenDetect = false;
      override readInput(addr: number, len: number): Promise<number[]> {
        if (addr === 0 && len === 123) {
          if (this.seenDetect)
            return Promise.reject(
              new ModbusTransportError(4, addr, len, 'socket reset'),
            );
          this.seenDetect = true;
        }
        return super.readInput(addr, len);
      }
    }
    let skew = 0;
    const collector = start(
      port,
      'fast-transport',
      {},
      () => Date.now() + skew,
      undefined,
      (opts) => new FailFastClient(opts),
    );
    await collector.onApplicationBootstrap();
    for (const [failures, delaySec] of [
      [1, 5],
      [2, 10],
      [3, 20],
    ] as const) {
      await until(
        () =>
          collector.snapshot().consecutiveFailures === failures &&
          collector.snapshot().state === 'DEGRADED_UPSTREAM',
      );
      const next = collector.snapshot().nextRetryAt!;
      expect(next.getTime() - (Date.now() + skew)).toBeGreaterThan(
        delaySec * 1000 - 750,
      );
      expect(next.getTime() - (Date.now() + skew)).toBeLessThanOrEqual(
        delaySec * 1000,
      );
      skew += next.getTime() - (Date.now() + skew) + leaseMs;
    }
    expect(
      await prisma.sample.count({
        where: { device: { deviceKey: 'fast-transport' } },
      }),
    ).toBe(0);
    await collector.beforeApplicationShutdown();
  });
  it('drains pending and buffered polls through real Nest app.close before Prisma closes', async () => {
    const port = await freePort();
    const server = await replay(port);
    const appPrisma = new PrismaService({ DATABASE_URL: db.url });
    const verifier = new PrismaService({ DATABASE_URL: db.url });
    const env = parseEnv({
      DATABASE_URL: db.url,
      MODBUS_HOST: '127.0.0.1',
      MODBUS_PORT: String(port),
      MODBUS_TIMEOUT_MS: String(timeoutMs),
      OWNERSHIP_LEASE_SEC: String(leaseMs / 1000),
      POLL_FAST_MS: '1000',
      POLL_SLOW_MS: '60000',
      POLL_SETTINGS_MS: '60000',
      DEVICE_KEY: 'nest-shutdown-buffer',
    });
    const ingest = new IngestService(appPrisma);
    let available = false;
    let failures = 0;
    const sink: IngestSink = {
      ingest: async (polls) => {
        if (!available) {
          failures++;
          throw new Error('temporary insert failure');
        }
        return ingest.ingest(polls, { maxRepeatSpanSec: 30 });
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        { provide: PrismaService, useValue: appPrisma },
        { provide: INGEST_SINK, useValue: sink },
        { provide: ENV, useValue: env },
        CollectorService,
      ],
    }).compile();
    const app = module.createNestApplication();
    let closed = false;
    try {
      await app.init();
      await until(() => failures > 0 && server.state.cycles >= 3);
      const run = await verifier.collectorRun.findFirstOrThrow({
        orderBy: { id: 'desc' },
      });
      expect(
        await verifier.sample.count({
          where: { device: { deviceKey: 'nest-shutdown-buffer' } },
        }),
      ).toBe(0);
      available = true;
      await app.close();
      closed = true;
      expect(
        await verifier.sample.count({
          where: { device: { deviceKey: 'nest-shutdown-buffer' } },
        }),
      ).toBeGreaterThanOrEqual(3);
      expect(
        (
          await verifier.collectorRun.findUniqueOrThrow({
            where: { id: run.id },
          })
        ).endedAt,
      ).not.toBeNull();
    } finally {
      if (!closed) await app.close().catch(() => undefined);
      await verifier.close();
    }
  });
});
