import { Prisma } from '../generated/prisma/client.js';
import {
  Inject,
  Injectable,
  Optional,
  type BeforeApplicationShutdown,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  CollectorLock,
  LockLostError,
  type CollectorLockOptions,
} from './collector-lock.js';
import { reconnectDelaySec } from './backoff.js';
import {
  compareIdentity,
  deviceActiveAt,
  DeviceIdentityUnavailableError,
  resolveDevice,
} from './identity.js';
import { ensureMappingV1 } from './mapping.js';
import {
  initialRepeatState,
  normalizeFast,
  type RepeatState,
} from './normalize.js';
import { PollBuffer } from './ingest.service.js';
import type {
  CollectorStatusProvider,
  CollectorStatusSnapshot,
  CollectorState,
  IngestPoll,
  MappingConfig,
  QualityEventInput,
} from './types.js';
import type { Env } from '../config/env.js';
import { buildDatabaseUrl } from '../config/database-url.js';
import { PrismaService } from '../db/prisma.service.js';
import { bitmapLabels, decodeBlocks, enumLabel } from '../modbus/decode.js';
import { HoymilesG3, observedAt, type RawPoll } from '../modbus/hoymiles-g3.js';
import { encodeBlocks } from '../modbus/raw-poll-codec.js';
import {
  REGISTERS_BY_KEY,
  REGISTER_MAP_VERSION,
} from '../modbus/register-map.js';
import {
  ReadonlyModbusClient,
  type ReadonlyModbusClientOptions,
  type RegisterReader,
} from '../modbus/readonly-modbus-client.js';

export const INGEST_SINK = Symbol('INGEST_SINK');
export const ENV = Symbol('ENV');
export const COLLECTOR_SEAMS = Symbol('COLLECTOR_SEAMS');
export interface IngestSink {
  ingest(polls: IngestPoll[]): Promise<unknown>;
}
export interface CollectorSeams {
  now?: () => number;
  monotonicMs?: () => number;
  rand?: () => number;
  clientFactory?: (opts: ReadonlyModbusClientOptions) => ReadonlyModbusClient;
  lockFactory?: (opts: CollectorLockOptions) => CollectorLock;
  lockOptions?: Pick<CollectorLockOptions, 'heartbeatMs' | 'key'>;
}

/** Strictly future wall-clock multiple, even when the last poll overran several intervals. */
export function nextFastTick(nowMs: number, intervalMs: number): number {
  return (Math.floor(nowMs / intervalMs) + 1) * intervalMs;
}

function statusFromPoll(poll: RawPoll): Prisma.InputJsonObject {
  const d = decodeBlocks(poll.blocks);
  const status: Record<string, unknown> = {
    observedAt: observedAt(poll).toISOString(),
  };
  if (poll.tier === 'SETTINGS') {
    const ems = d.ems_mode ?? null;
    const reg = REGISTERS_BY_KEY.get('ems_mode');
    status.emsMode = ems;
    status.emsModeLabel =
      ems !== null && reg !== undefined ? enumLabel(reg, ems) : null;
    status.emsModeObservedAt = status.observedAt;
  }
  if (poll.tier === 'SLOW')
    status.firmware = { safetyDspVersion: d.safetydsp_fm_ver ?? null };
  if (poll.tier === 'FAST') {
    const faults: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(d)) {
      const def = REGISTERS_BY_KEY.get(key);
      if (value !== null && value !== 0 && def?.bitmap !== undefined)
        faults[key] = bitmapLabels(def, value);
    }
    status.activeFaults = faults;
    status.systemWorkstatus = d.system_workstatus ?? null;
    status.batterySoh = d.battery_soh ?? null;
    status.batteryState = d.bat_work_status ?? null;
    status.meterLink = d.grid_meter_link ?? null;
    status.firmware = { powerDspVersion: d.powerdsp_fm_ver ?? null };
  }
  // Every field above is built from decoded numbers, strings and string arrays.
  return status as Prisma.InputJsonObject;
}

const packageInfo: unknown = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'),
    'utf8',
  ),
);
if (
  typeof packageInfo !== 'object' ||
  packageInfo === null ||
  !('version' in packageInfo) ||
  typeof packageInfo.version !== 'string'
)
  throw new Error('invalid backend package version');
const VERSION = packageInfo.version;

/** The one-hour FAST reserve cannot be consumed by less frequent status polls. */
export class CollectorPollQueue {
  private readonly fast = new PollBuffer(360);
  private readonly status = new PollBuffer(64);
  private pending: IngestPoll[] = [];
  private pendingFast = 0;
  private pendingStatus = 0;
  droppedFast = 0;
  droppedStatus = 0;

  get size(): number {
    return this.fast.size + this.status.size + this.pending.length;
  }

  push(poll: IngestPoll): void {
    const isFast = poll.tier === 'FAST';
    const queue = isFast ? this.fast : this.status;
    const capacity = isFast ? 360 : 64;
    const held = isFast ? this.pendingFast : this.pendingStatus;
    if (queue.size + held >= capacity && held > 0) {
      const index = this.pending.findIndex(
        (item) => (item.tier === 'FAST') === isFast,
      );
      this.pending.splice(index, 1);
      if (isFast) {
        this.pendingFast--;
        this.droppedFast++;
      } else {
        this.pendingStatus--;
        this.droppedStatus++;
      }
    }
    const dropped = queue.push(poll);
    if (isFast) this.droppedFast += dropped;
    else this.droppedStatus += dropped;
  }

  batch(): IngestPoll[] {
    if (this.pending.length === 0) {
      const fast = this.fast.drain();
      const status = this.status.drain();
      this.pendingFast = fast.length;
      this.pendingStatus = status.length;
      this.pending = fast.concat(status);
      if (fast.length > 0 && status.length > 0)
        this.pending.sort((a, b) => a.seq - b.seq);
    }
    return this.pending;
  }

  acknowledge(): void {
    this.pending = [];
    this.pendingFast = 0;
    this.pendingStatus = 0;
  }
}

@Injectable()
export class CollectorService
  implements
    OnApplicationBootstrap,
    BeforeApplicationShutdown,
    CollectorStatusProvider
{
  private readonly now: () => number;
  private readonly monotonicMs: () => number;
  private readonly rand: () => number;
  private readonly polls = new CollectorPollQueue();
  private readonly events: {
    deviceId: number | null;
    event: QualityEventInput;
  }[] = [];
  private abort = new AbortController();
  private loopPromise?: Promise<void>;
  private lock?: CollectorLock;
  private client?: ReadonlyModbusClient;
  private deviceId?: number;
  private dataSourceId?: number;
  private runId?: number;
  private seq = 0;
  private repeatState: RepeatState = initialRepeatState();
  private state: CollectorState = 'DISABLED';
  private lastSuccessAt: Date | null = null;
  private lastErrorAt: Date | null = null;
  private lastError: string | null = null;
  private consecutiveFailures = 0;
  private nextRetryAt: Date | null = null;
  private lockRetryAt = 0;
  private runRetryAt = 0;
  private dbOutageOpen = false;
  private lastFastAt?: Date;
  private nextSlow = 0;
  private nextSettings = 0;
  private flushRetryAt = 0;
  private flushFailures = 0;
  private started = false;
  private stopping = false;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(INGEST_SINK) private readonly sink: IngestSink,
    @Inject(ENV) private readonly env: Env,
    @Optional()
    @Inject(COLLECTOR_SEAMS)
    private readonly seams: CollectorSeams = {},
  ) {
    this.now = seams.now ?? Date.now;
    this.monotonicMs = seams.monotonicMs ?? (() => performance.now());
    this.rand = seams.rand ?? Math.random;
  }

  snapshot(): CollectorStatusSnapshot {
    return {
      state: this.state,
      acquisitionSource:
        this.env.COLLECTOR_ENABLED && this.env.COLLECTOR_SOURCE === 'MODBUS'
          ? 'MODBUS'
          : 'NONE',
      lastSuccessAt: this.lastSuccessAt,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      consecutiveFailures: this.consecutiveFailures,
      nextRetryAt: this.nextRetryAt,
    };
  }

  async onApplicationBootstrap(): Promise<void> {
    if (this.started) return;
    this.started = true;
    if (!this.env.COLLECTOR_ENABLED || this.env.COLLECTOR_SOURCE !== 'MODBUS')
      return;
    this.abort = new AbortController();
    this.state = 'LOCK_NOT_HELD';
    const leaseMs = this.env.OWNERSHIP_LEASE_SEC * 1000;
    const options: CollectorLockOptions = {
      databaseUrl: buildDatabaseUrl({
        DATABASE_URL: this.env.DATABASE_URL,
        DATABASE_PASSWORD_FILE: this.env.DATABASE_PASSWORD_FILE,
      }),
      leaseMs,
      takeoverDelayMs: leaseMs + this.env.MODBUS_TIMEOUT_MS,
      // Several heartbeats must fit in one lease (default 5 s heartbeat for the 15 s lease).
      heartbeatMs: Math.min(5000, Math.floor(leaseMs / 3)),
      ...this.seams.lockOptions,
    };
    this.lock = this.seams.lockFactory?.(options) ?? new CollectorLock(options);
    this.lock.on('lost', (reason: string) => {
      if (this.stopping) return;
      this.state = 'LOCK_NOT_HELD';
      this.lockRetryAt = this.now() + 30_000;
      this.lastErrorAt = new Date(this.now());
      this.lastError = reason;
      this.queueEvent('CONNECTION_LOST', { reason: 'collector lock lost' });
      if (!this.dbOutageOpen) {
        this.dbOutageOpen = true;
        this.queueEvent('DB_UNAVAILABLE', {
          reason: 'database lock session lost',
        });
      }
      void this.client?.close().catch(() => undefined);
      this.client = undefined;
      this.abort.abort();
      this.g3 = undefined;
    });
    this.loopPromise = this.runLoop();
  }

  async beforeApplicationShutdown(): Promise<void> {
    if (this.stopping || !this.started) return;
    this.stopping = true;
    this.state = 'STOPPING';
    this.abort.abort();
    // A read is bounded by the Modbus timeout; stop never waits longer than five seconds.
    await Promise.race([
      this.loopPromise ?? Promise.resolve(),
      delay(5000, undefined, { ref: false }),
    ]);
    await this.client?.close().catch(() => undefined);
    await this.lock?.stop();
    while (this.polls.size > 0) {
      if (!(await this.flush(true))) break;
    }
    if (this.events.length > 0) await this.flush(true);
    if (this.runId !== undefined)
      await this.prisma.collectorRun.update({
        where: { id: this.runId },
        data: { endedAt: new Date(this.now()), endReason: 'SHUTDOWN' },
      });
  }

  private async wait(ms: number): Promise<void> {
    if (ms <= 0 || this.stopping) return;
    await delay(ms, undefined, { signal: this.abort.signal }).catch(
      () => undefined,
    );
  }

  private queueEvent(
    kind: QualityEventInput['kind'],
    details: Record<string, unknown>,
    from = new Date(this.now()),
    to?: Date,
  ): void {
    this.events.push({
      deviceId: this.deviceId ?? null,
      event: {
        kind,
        startedAt: from,
        ...(to === undefined ? {} : { endedAt: to }),
        details,
      },
    });
  }

  private async flush(force = false): Promise<boolean> {
    if (!force && this.now() < this.flushRetryAt) return false;
    // Report drops only after persistence resumes; retain the count across failed attempts.
    const batch = this.polls.batch();
    try {
      if (batch.length > 0) {
        await this.sink.ingest(batch);
        this.polls.acknowledge();
      }
      if (this.polls.droppedFast > 0 || this.polls.droppedStatus > 0) {
        this.queueEvent('DB_UNAVAILABLE', {
          droppedPolls: this.polls.droppedFast,
          droppedStatusPolls: this.polls.droppedStatus,
          reason: 'buffer overflow',
        });
        this.polls.droppedFast = 0;
        this.polls.droppedStatus = 0;
      }
      while (this.events.length > 0) {
        const { deviceId, event } = this.events[0]!;
        const details = event.details as Prisma.InputJsonObject;
        await this.prisma.dataQualityEvent.create({
          data: {
            deviceId,
            kind: event.kind,
            startedAt: event.startedAt,
            endedAt: event.endedAt,
            details,
          },
        });
        this.events.shift();
      }
      this.flushFailures = 0;
      this.flushRetryAt = 0;
      return true;
    } catch {
      this.flushRetryAt =
        this.now() +
        Math.min(60_000, 5000 * 2 ** Math.min(this.flushFailures++, 4));
      return false;
    }
  }

  private capture(
    poll: RawPoll,
    sample?: IngestPoll['sample'],
    events: QualityEventInput[] = [],
    monotonicMs?: number,
  ): IngestPoll {
    return {
      runId: this.runId!,
      seq: ++this.seq,
      deviceId: this.deviceId!,
      tier: poll.tier,
      requestedAt: poll.requestedAt,
      receivedAt: poll.receivedAt,
      observedAt: observedAt(poll),
      blocks: encodeBlocks(poll.blocks),
      ...(monotonicMs === undefined ? {} : { monotonicMs }),
      ...(sample === undefined ? {} : { sample }),
      events,
    };
  }

  private async runLoop(): Promise<void> {
    const lock = this.lock!;
    let retryAt = 0;
    while (!this.stopping) {
      if (this.runId === undefined) {
        if (this.now() < this.runRetryAt) {
          await this.wait(Math.min(1000, this.runRetryAt - this.now()));
          continue;
        }
        try {
          this.runId = (
            await this.prisma.collectorRun.create({
              data: {
                startedAt: new Date(this.now()),
                appVersion: VERSION,
                registerMapVersion: REGISTER_MAP_VERSION,
              },
            })
          ).id;
        } catch {
          this.state = 'LOCK_NOT_HELD';
          this.lastErrorAt = new Date(this.now());
          this.lastError = 'collector database unavailable';
          this.runRetryAt = this.now() + 5000;
          this.nextRetryAt = new Date(this.runRetryAt);
          await this.wait(1000);
          continue;
        }
      }
      await this.flush();
      if (!lock.isOwned()) {
        if (this.abort.signal.aborted) this.abort = new AbortController();
        this.state = 'LOCK_NOT_HELD';
        if (this.now() >= Math.max(retryAt, this.lockRetryAt)) {
          const acquired = await lock.tryAcquire();
          retryAt = this.now() + (acquired ? 0 : 30_000);
          this.lockRetryAt = retryAt;
          if (acquired) {
            this.dbOutageOpen = false;
            this.abort = new AbortController();
          }
        }
        if (!lock.isOwned()) {
          this.nextRetryAt = new Date(Math.max(retryAt, this.lockRetryAt));
          await this.wait(
            Math.min(
              1000,
              Math.max(1, this.nextRetryAt.getTime() - this.now()),
            ),
          );
          continue;
        }
      }
      const usable = lock.msUntilUsable();
      if (usable > 0) {
        this.nextRetryAt = new Date(this.now() + usable);
        await this.wait(Math.min(1000, usable));
        continue;
      }
      if (this.now() < retryAt) {
        await this.wait(Math.min(1000, retryAt - this.now()));
        continue;
      }
      try {
        if (this.client === undefined) {
          const client =
            this.seams.clientFactory?.({
              host: this.env.MODBUS_HOST!,
              port: this.env.MODBUS_PORT,
              unitId: this.env.MODBUS_UNIT_ID,
              timeoutMs: this.env.MODBUS_TIMEOUT_MS,
            }) ??
            new ReadonlyModbusClient({
              host: this.env.MODBUS_HOST!,
              port: this.env.MODBUS_PORT,
              unitId: this.env.MODBUS_UNIT_ID,
              timeoutMs: this.env.MODBUS_TIMEOUT_MS,
            });
          this.client = client;
          lock.assertCanUseDevice();
          await client.connect();
          const guarded: RegisterReader = {
            readInput: (addr, len) => {
              lock.assertCanUseDevice();
              return client.readInput(addr, len);
            },
            readHolding: (addr, len) => {
              lock.assertCanUseDevice();
              return client.readHolding(addr, len);
            },
          };
          const g3 = new HoymilesG3(guarded);
          const detected = await g3.detect();
          lock.assertCanUseDevice();
          if (
            compareIdentity(detected, this.env.EXPECTED_MODEL) === 'MISMATCH'
          ) {
            this.state = 'IDENTITY_MISMATCH';
            this.queueEvent('IDENTITY_MISMATCH', {
              expectedModel: this.env.EXPECTED_MODEL,
              observedModel: detected.model,
            });
            await this.flush();
            await client.close();
            this.client = undefined;
            this.consecutiveFailures++;
            retryAt =
              this.now() +
              reconnectDelaySec(this.consecutiveFailures, this.rand) * 1000;
            this.nextRetryAt = new Date(retryAt);
            continue;
          }
          const identity = await resolveDevice(this.prisma, {
            dataSourceEndpoint: `${this.env.MODBUS_HOST}:${this.env.MODBUS_PORT}#${this.env.MODBUS_UNIT_ID}`,
            deviceKey: this.env.DEVICE_KEY,
            detected,
          });
          this.dataSourceId = (
            await this.prisma.device.findUniqueOrThrow({
              where: { id: identity.deviceId },
              select: { dataSourceId: true },
            })
          ).dataSourceId;
          if (
            this.deviceId !== identity.deviceId ||
            this.lastFastAt === undefined
          ) {
            const latest = await this.prisma.sample.findFirst({
              where: { deviceId: identity.deviceId },
              orderBy: { observedAt: 'desc' },
              select: { observedAt: true },
            });
            this.lastFastAt = latest?.observedAt;
            if (this.deviceId !== identity.deviceId)
              this.repeatState = initialRepeatState();
          }
          this.deviceId = identity.deviceId;
          if (identity.capabilityChanged)
            this.queueEvent('CAPABILITY_CHANGED', {
              observed: detected.observed,
            });
          this.nextSlow = 0;
          this.nextSettings = 0;
          this.g3 = g3;
        }
        const tick = nextFastTick(this.now(), this.env.POLL_FAST_MS);
        await this.wait(Math.max(0, tick - this.now()));
        if (this.stopping) break;
        lock.assertCanUseDevice();
        const monoStart = this.monotonicMs();
        const fast = await this.g3!.readTier('FAST');
        const monoEnd = this.monotonicMs();
        if (fast.transportError !== undefined)
          throw new Error(fast.transportError);
        const at = observedAt(fast);
        await this.selectDevice(at);
        const events: QualityEventInput[] = [];
        if (
          this.lastFastAt !== undefined &&
          at.getTime() - this.lastFastAt.getTime() > 3 * this.env.POLL_FAST_MS
        ) {
          events.push({
            kind: 'GAP',
            startedAt: this.lastFastAt,
            endedAt: at,
            details: {
              from: this.lastFastAt.toISOString(),
              to: at.toISOString(),
              reason: 'FAST cadence exceeded',
            },
          });
        }
        this.lastFastAt = at;
        const mapping = (this.mapping ??= await ensureMappingV1(this.prisma));
        // The same monotonic midpoint drives normalization and is persisted with the raw poll,
        // so a later rebuild from raw polls reproduces clock validity and meter repeat durations.
        const monotonicMid = (monoStart + monoEnd) / 2;
        const normalized = normalizeFast({
          blocks: fast.blocks,
          observedAt: at,
          monotonicMs: monotonicMid,
          mapping: mapping.config,
          mappingVersion: mapping.version,
          state: this.repeatState,
        });
        this.repeatState = normalized.state;
        this.polls.push(
          this.capture(
            fast,
            normalized.sample,
            [...events, ...normalized.events],
            monotonicMid,
          ),
        );
        await this.updateStatus(fast);
        this.lastSuccessAt = at;
        this.state = 'RUNNING';
        this.consecutiveFailures = 0;
        this.nextRetryAt = null;
        await this.flush();
        for (const [tier, due, interval] of [
          ['SLOW', this.nextSlow, this.env.POLL_SLOW_MS],
          ['SETTINGS', this.nextSettings, this.env.POLL_SETTINGS_MS],
        ] as const) {
          if (this.now() < due || this.stopping) continue;
          lock.assertCanUseDevice();
          const poll = await this.g3!.readTier(tier);
          if (poll.transportError !== undefined)
            throw new Error(poll.transportError);
          await this.selectDevice(observedAt(poll));
          this.polls.push(this.capture(poll));
          await this.updateStatus(poll);
          if (tier === 'SLOW') this.nextSlow = this.now() + interval;
          else this.nextSettings = this.now() + interval;
          await this.flush();
        }
      } catch (error) {
        if (this.stopping) break;
        await this.client?.close().catch(() => undefined);
        this.client = undefined;
        this.g3 = undefined;
        if (error instanceof LockLostError || !this.lock?.isOwned()) {
          this.state = 'LOCK_NOT_HELD';
          continue;
        }
        this.state = 'DEGRADED_UPSTREAM';
        this.lastErrorAt = new Date(this.now());
        this.lastError = error instanceof Error ? error.message : String(error);
        this.queueEvent('CONNECTION_LOST', {
          reason: 'upstream connection failed',
        });
        this.consecutiveFailures++;
        retryAt =
          this.now() +
          reconnectDelaySec(this.consecutiveFailures, this.rand) * 1000;
        this.nextRetryAt = new Date(retryAt);
        // Continue flushing buffered polls during a long upstream reconnect backoff.
      }
    }
  }
  private async selectDevice(at: Date): Promise<void> {
    const owner = await deviceActiveAt(
      this.prisma,
      this.dataSourceId!,
      this.env.DEVICE_KEY,
      at,
    );
    if (owner === null) throw new DeviceIdentityUnavailableError();
    if (owner.id !== this.deviceId) {
      this.deviceId = owner.id;
      this.repeatState = initialRepeatState();
      this.lastFastAt = undefined;
    }
  }

  private mapping?: {
    version: number;
    config: MappingConfig;
    provisional: boolean;
  };
  private async updateStatus(poll: RawPoll): Promise<void> {
    const previous = await this.prisma.device.findUnique({
      where: { id: this.deviceId! },
      select: { latestStatus: true, firmware: true },
    });
    const old = previous?.latestStatus;
    const status: Record<string, unknown> = { ...statusFromPoll(poll) };
    if (
      typeof status.firmware === 'object' &&
      status.firmware !== null &&
      typeof old === 'object' &&
      old !== null &&
      !Array.isArray(old) &&
      typeof old.firmware === 'object' &&
      old.firmware !== null &&
      !Array.isArray(old.firmware)
    ) {
      status.firmware = { ...old.firmware, ...status.firmware };
    }
    const latestStatus = {
      ...(typeof old === 'object' && old !== null && !Array.isArray(old)
        ? old
        : {}),
      ...status,
    } as Prisma.InputJsonObject;
    const firmware = previous?.firmware;
    const updatedFirmware =
      poll.tier === 'SLOW' &&
      typeof firmware === 'object' &&
      firmware !== null &&
      !Array.isArray(firmware)
        ? {
            ...firmware,
            safetyDspVersion:
              decodeBlocks(poll.blocks).safetydsp_fm_ver ?? null,
          }
        : undefined;
    await this.prisma.device.update({
      where: { id: this.deviceId! },
      data: {
        latestStatus,
        ...(updatedFirmware === undefined ? {} : { firmware: updatedFirmware }),
      },
    });
  }
  private g3?: HoymilesG3;
}
