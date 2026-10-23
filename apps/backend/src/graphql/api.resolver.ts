import { Inject } from '@nestjs/common';
import { Args, Context, Int, Query, Resolver } from '@nestjs/graphql';
import { GraphQLDateTime } from 'graphql-scalars';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { AuthRequest } from '../auth/token.middleware.js';
import { deviceActiveAt } from '../collector/identity.js';
import {
  SampleFlag,
  COLLECTOR_STATUS,
  type CollectorStatusProvider,
} from '../collector/types.js';
import { APP_ENV } from '../config/env.token.js';
import type { Env } from '../config/env.js';
import { PrismaService } from '../db/prisma.service.js';
import { QualityEventKind, type Device } from '../generated/prisma/client.js';
import { REGISTERS_BY_KEY } from '../modbus/register-map.js';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { TlsService } from '../tls/tls.service.js';
import {
  AccountingStatus,
  CollectorStatus,
  DataQualityEventConnection,
  DeviceModel,
  Freshness,
  LiveStatus,
  OperatingMode,
  PowerValue,
  ValueStatus,
} from './models.js';
import { GraphQLError } from 'graphql';

function inputError(): never {
  throw new GraphQLError('Invalid pagination or filter argument', {
    extensions: { code: 'BAD_USER_INPUT' },
  });
}
function power(
  watts: number | null,
  freshness: Freshness,
  reason?: string,
): PowerValue {
  if (watts === null)
    return {
      watts: null,
      status: ValueStatus.UNAVAILABLE,
      reason: reason ?? 'NO_READING',
    };
  return {
    watts,
    status: freshness === Freshness.STALE ? ValueStatus.STALE : ValueStatus.OK,
    reason: freshness === Freshness.STALE ? 'STALE_SAMPLE' : null,
  };
}
function statusValue(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

@Resolver()
export class ApiResolver {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(COLLECTOR_STATUS)
    private readonly collector: CollectorStatusProvider,
    @Inject(APP_ENV) private readonly env: Env,
    @Inject(TlsService) private readonly tls: TlsService,
    @Inject(ReconciliationService)
    private readonly reconciliation: ReconciliationService,
  ) {}

  private async activeDeviceAt(at: Date): Promise<Device | null> {
    const sources = await this.prisma.dataSource.findMany({
      where: {
        kind: 'MODBUS_TCP',
        // Only sources that hold the configured key can be "the" source (unrelated or empty
        // historical sources must not make the choice ambiguous).
        devices: { some: { deviceKey: this.env.DEVICE_KEY } },
        ...(this.env.MODBUS_HOST === undefined
          ? {}
          : {
              endpoint: `${this.env.MODBUS_HOST}:${this.env.MODBUS_PORT}#${this.env.MODBUS_UNIT_ID}`,
            }),
      },
      select: { id: true },
      take: 2,
    });
    if (sources.length !== 1) return null;
    return deviceActiveAt(this.prisma, sources[0]!.id, this.env.DEVICE_KEY, at);
  }

  @Query(() => LiveStatus)
  async liveStatus(): Promise<LiveStatus> {
    const serverTime = new Date();
    const device = await this.activeDeviceAt(serverTime);
    const sample = device
      ? await this.prisma.sample.findFirst({
          where: { deviceId: device.id },
          orderBy: [{ observedAt: 'desc' }, { id: 'desc' }],
          include: { mapping: { select: { config: true } } },
        })
      : null;
    const latestMapping = await this.prisma.mappingVersion.findFirst({
      orderBy: { version: 'desc' },
    });
    const activePolicy = latestMapping?.provisional
      ? null
      : await this.prisma.accountingPolicy.findFirst({
          where: {
            supersededByVersion: null,
            effectiveFrom: { lte: serverTime },
          },
          orderBy: { effectiveFrom: 'desc' },
        });
    const accountingStatus = latestMapping?.provisional
      ? AccountingStatus.MAPPING_PROVISIONAL
      : AccountingStatus[
          await this.reconciliation.accountingStatus(
            activePolicy?.gridSource ?? 'METER_NET',
          )
        ];
    const observedAt = sample?.observedAt ?? null;
    const ageSeconds = observedAt
      ? Math.max(
          0,
          Math.floor((serverTime.getTime() - observedAt.getTime()) / 1000),
        )
      : null;
    const freshness =
      ageSeconds === null
        ? Freshness.NO_DATA
        : ageSeconds <= 30
          ? Freshness.LIVE
          : Freshness.STALE;
    const flags = sample?.flags ?? 0;
    const gridInvalid = Boolean(
      flags &
      (SampleFlag.METER_LINK_DOWN |
        SampleFlag.METER_COMM_FAULT |
        SampleFlag.METER_STALE |
        SampleFlag.BLOCK_INVALID_1800 |
        SampleFlag.CLOCK_STEP),
    );
    const inverterInvalid = Boolean(
      flags & (SampleFlag.BLOCK_INVALID_0 | SampleFlag.CLOCK_STEP),
    );
    const clockInvalid = Boolean(flags & SampleFlag.CLOCK_STEP);
    const batteryFromBms =
      statusValue(sample?.mapping.config).batteryPowerSource === 'BMS_1914';
    const batteryBlockFlag = batteryFromBms
      ? SampleFlag.BLOCK_INVALID_1800
      : SampleFlag.BLOCK_INVALID_0;
    const batteryInvalid = Boolean(
      flags & (batteryBlockFlag | SampleFlag.CLOCK_STEP),
    );
    const batteryReason = clockInvalid
      ? 'CLOCK_STEP'
      : flags & batteryBlockFlag
        ? batteryFromBms
          ? 'BLOCK_INVALID_1800'
          : 'BLOCK_INVALID_0'
        : 'NO_READING';
    const gridReason =
      flags & SampleFlag.METER_LINK_DOWN
        ? 'METER_LINK_DOWN'
        : flags & SampleFlag.METER_COMM_FAULT
          ? 'METER_COMM_FAULT'
          : flags & SampleFlag.METER_STALE
            ? 'METER_STALE'
            : flags & SampleFlag.BLOCK_INVALID_1800
              ? 'BLOCK_INVALID_1800'
              : flags & SampleFlag.CLOCK_STEP
                ? 'CLOCK_STEP'
                : 'NO_READING';
    const inverterReason =
      flags & SampleFlag.BLOCK_INVALID_0
        ? 'BLOCK_INVALID_0'
        : flags & SampleFlag.CLOCK_STEP
          ? 'CLOCK_STEP'
          : 'NO_READING';
    const gridW = gridInvalid ? null : (sample?.gridW ?? null);
    const loadInvalid =
      inverterInvalid ||
      gridInvalid ||
      Boolean(flags & SampleFlag.NEGATIVE_DERIVED_LOAD);
    const load =
      !loadInvalid &&
      gridW !== null &&
      sample?.inverterAcW != null &&
      sample.epsW != null
        ? gridW + sample.inverterAcW + sample.epsW
        : null;
    const loadReason =
      flags & SampleFlag.NEGATIVE_DERIVED_LOAD
        ? 'NEGATIVE_DERIVED_LOAD'
        : gridInvalid || gridW === null
          ? gridReason
          : inverterReason;
    const status = statusValue(device?.latestStatus);
    const rawMode = statusValue(status.operatingMode);
    const modeCode = rawMode.code ?? status.emsMode;
    const modeObserved = rawMode.observedAt ?? status.emsModeObservedAt;
    const operatingMode: OperatingMode | null =
      typeof modeCode === 'number' &&
      typeof modeObserved === 'string' &&
      !Number.isNaN(Date.parse(modeObserved))
        ? {
            code: modeCode,
            label:
              typeof rawMode.label === 'string'
                ? rawMode.label
                : typeof status.emsModeLabel === 'string'
                  ? status.emsModeLabel
                  : String(modeCode),
            observedAt: new Date(modeObserved),
          }
        : null;
    const faultGroups = statusValue(status.activeFaults);
    const activeFaults = Object.values(faultGroups).flatMap((group) =>
      Array.isArray(group)
        ? group.filter((fault): fault is string => typeof fault === 'string')
        : [],
    );
    const meterLink =
      sample?.meterLink === null || sample?.meterLink === undefined
        ? null
        : (REGISTERS_BY_KEY.get('grid_meter_link')?.enum?.[sample.meterLink] ??
          String(sample.meterLink));
    return {
      serverTime,
      observedAt,
      ageSeconds,
      freshness,
      pv: power(
        inverterInvalid ? null : (sample?.pvW ?? null),
        freshness,
        inverterReason,
      ),
      pvStrings: (sample?.pvStringW ?? []).map((watts) =>
        power(inverterInvalid ? null : watts, freshness, inverterReason),
      ),
      load: power(load, freshness, loadReason),
      loadVendor: power(
        clockInvalid ? null : (sample?.loadVendorW ?? null),
        freshness,
        clockInvalid ? 'CLOCK_STEP' : 'NO_READING',
      ),
      grid: power(gridW, freshness, gridReason),
      gridPhases: [
        sample?.gridAW ?? null,
        sample?.gridBW ?? null,
        sample?.gridCW ?? null,
      ].map((watts) =>
        power(gridInvalid ? null : watts, freshness, gridReason),
      ),
      battery: power(
        batteryInvalid ? null : (sample?.batteryW ?? null),
        freshness,
        batteryReason,
      ),
      batterySoc: sample?.batterySoc ?? null,
      batteryState:
        sample?.batteryState === null || sample?.batteryState === undefined
          ? null
          : (REGISTERS_BY_KEY.get('bat_work_status')?.enum?.[
              sample.batteryState
            ] ?? String(sample.batteryState)),
      operatingMode,
      meterLink,
      activeFaults,
      accountingStatus,
    };
  }

  @Query(() => String, {
    description: 'Role of the calling token (ADMIN or VIEWER).',
  })
  viewerRole(@Context() context: { req: AuthRequest }): string {
    return context.req.principal!.role;
  }

  @Query(() => CollectorStatus)
  async collectorStatus(): Promise<CollectorStatus> {
    const snapshot = this.collector.snapshot();
    const serverTime = new Date();
    const [device, mapping, earliest, backup] = await Promise.all([
      this.activeDeviceAt(serverTime),
      this.prisma.mappingVersion.findFirst({
        orderBy: { version: 'desc' },
        select: { version: true },
      }),
      this.prisma.sample.findFirst({
        orderBy: { observedAt: 'asc' },
        select: { observedAt: true },
      }),
      // The timestamp is advisory: a missing or unreadable file (no backup yet, a permissions
      // mistake on the backups dataset) means "unknown", and must not fail collectorStatus.
      readFile(join(this.env.BACKUP_DIR, 'last-success'), 'utf8').catch(
        () => null,
      ),
    ]);
    const parsedBackup = backup ? new Date(backup.trim()) : null;
    return {
      ...snapshot,
      device,
      mappingVersion: mapping?.version ?? 0,
      policyVersion: 0,
      calcVersion: 0,
      monitoringSince: earliest?.observedAt ?? null,
      siteTimezone: this.env.SITE_TIMEZONE,
      lastBackupAt:
        parsedBackup && !Number.isNaN(parsedBackup.getTime())
          ? parsedBackup
          : null,
      tlsCertExpiresAt: this.tls.notAfter,
    };
  }

  @Query(() => [DeviceModel])
  devices(): Promise<DeviceModel[]> {
    return this.prisma.device.findMany({ orderBy: { id: 'asc' } });
  }

  @Query(() => DataQualityEventConnection)
  async dataQualityEvents(
    @Args('from', { type: () => GraphQLDateTime }) from: Date,
    @Args('to', { type: () => GraphQLDateTime }) to: Date,
    @Args('kinds', { type: () => [String], nullable: true }) kinds?: string[],
    @Args('first', { type: () => Int, nullable: true, defaultValue: 100 })
    first?: number,
    @Args('after', { type: () => String, nullable: true }) after?: string,
  ): Promise<DataQualityEventConnection> {
    const limit = first ?? 100;
    if (
      from > to ||
      limit < 1 ||
      limit > 100 ||
      kinds?.some(
        (kind) =>
          !Object.values(QualityEventKind).includes(kind as QualityEventKind),
      )
    )
      inputError();
    let lastId: bigint | undefined;
    if (after !== undefined && after !== null) {
      const decoded = Buffer.from(after, 'base64').toString('utf8');
      if (
        !/^[1-9]\d*$/.test(decoded) ||
        Buffer.from(decoded).toString('base64') !== after
      )
        inputError();
      lastId = BigInt(decoded);
    }
    const rows = await this.prisma.dataQualityEvent.findMany({
      where: {
        startedAt: { gte: from, lte: to },
        ...(kinds ? { kind: { in: kinds as QualityEventKind[] } } : {}),
        ...(lastId ? { id: { gt: lastId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    return {
      edges: page.map((event) => ({
        cursor: Buffer.from(String(event.id)).toString('base64'),
        node: { ...event, id: String(event.id) },
      })),
      pageInfo: {
        hasNextPage: rows.length > limit,
        endCursor: page.length
          ? Buffer.from(String(page.at(-1)!.id)).toString('base64')
          : null,
      },
    };
  }
}
