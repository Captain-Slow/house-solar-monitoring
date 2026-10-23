import type { Device } from '../generated/prisma/client.js';
import type { PrismaService } from '../db/prisma.service.js';
import type { DetectedInfo } from '../modbus/hoymiles-g3.js';

export type Capabilities = DetectedInfo['observed'];

export function compareIdentity(
  detected: DetectedInfo,
  expectedModel: string,
): 'OK' | 'MISMATCH' {
  return detected.model === expectedModel ? 'OK' : 'MISMATCH';
}

/** Only the four observed features vary; none is an identity key. */
export function diffCapabilities(
  prev: Capabilities,
  next: Capabilities,
): (keyof Capabilities)[] {
  const keys: (keyof Capabilities)[] = [
    'hasBattery',
    'hasGridMeter',
    'mpptCount',
    'batteryCapacityKwh',
  ];
  return keys.filter((key) => prev[key] !== next[key]);
}

/** Interval owner of a configured device key at a collector-observed UTC instant. */
export async function deviceActiveAt(
  prisma: PrismaService,
  dataSourceId: number,
  deviceKey: string,
  at: Date,
): Promise<Device | null> {
  const owner = await prisma.device.findFirst({
    where: {
      dataSourceId,
      deviceKey,
      firstSeenAt: { lte: at },
      OR: [{ retiredAt: null }, { retiredAt: { gt: at } }],
    },
    orderBy: { firstSeenAt: 'desc' },
  });
  if (owner !== null) return owner;
  const earliest = await prisma.device.findFirst({
    where: { dataSourceId, deviceKey },
    orderBy: { firstSeenAt: 'asc' },
    select: { firstSeenAt: true },
  });
  // A backward clock step before the device's first observation must not create another identity.
  if (earliest !== null && at < earliest.firstSeenAt)
    return prisma.device.findFirst({
      where: { dataSourceId, deviceKey, retiredAt: null },
    });
  return null;
}

export class DeviceIdentityUnavailableError extends Error {
  constructor() {
    super('device identity cannot be resolved at the current observation time');
    this.name = 'DeviceIdentityUnavailableError';
  }
}

export async function resolveDevice(
  prisma: PrismaService,
  args: {
    dataSourceEndpoint: string;
    deviceKey: string;
    detected: DetectedInfo;
  },
): Promise<{ deviceId: number; created: boolean; capabilityChanged: boolean }> {
  const source = await prisma.dataSource.upsert({
    where: {
      kind_endpoint: { kind: 'MODBUS_TCP', endpoint: args.dataSourceEndpoint },
    },
    create: { kind: 'MODBUS_TCP', endpoint: args.dataSourceEndpoint },
    update: {},
  });
  for (let attempt = 0; attempt < 2; attempt++) {
    const now = new Date();
    const existing = await deviceActiveAt(
      prisma,
      source.id,
      args.deviceKey,
      now,
    );
    if (existing !== null) {
      if (now < existing.firstSeenAt)
        return {
          deviceId: existing.id,
          created: false,
          capabilityChanged: false,
        };
      const previous = existing.observedCapabilities;
      const capabilityChanged =
        typeof previous === 'object' &&
        previous !== null &&
        !Array.isArray(previous)
          ? diffCapabilities(
              {
                hasBattery: previous.hasBattery === true,
                hasGridMeter: previous.hasGridMeter === true,
                mpptCount: Number(previous.mpptCount),
                batteryCapacityKwh:
                  previous.batteryCapacityKwh == null
                    ? null
                    : Number(previous.batteryCapacityKwh),
              },
              args.detected.observed,
            ).length > 0
          : true;
      const updated = await prisma.device.updateMany({
        where: {
          id: existing.id,
          firstSeenAt: { lte: now },
          OR: [{ retiredAt: null }, { retiredAt: { gt: now } }],
        },
        data: {
          firmware: args.detected.firmware,
          observedCapabilities: args.detected.observed,
          capabilitiesObservedAt: now,
          lastSeenAt: now,
        },
      });
      if (updated.count > 0)
        return { deviceId: existing.id, created: false, capabilityChanged };
      continue; // explicit replacement raced the observation; resolve once more
    }
    // A configured key with a future boundary or a retired-only history needs an explicit
    // replacement; never manufacture a second identity when an interval has no owner.
    const known = await prisma.device.findFirst({
      where: { dataSourceId: source.id, deviceKey: args.deviceKey },
      select: { id: true },
    });
    if (known !== null) throw new DeviceIdentityUnavailableError();
    try {
      const created = await prisma.device.create({
        data: {
          dataSourceId: source.id,
          deviceKey: args.deviceKey,
          role: 'INVERTER',
          model: args.detected.model,
          firmware: args.detected.firmware,
          observedCapabilities: args.detected.observed,
          capabilitiesObservedAt: now,
          firstSeenAt: now,
          lastSeenAt: now,
        },
      });
      return { deviceId: created.id, created: true, capabilityChanged: false };
    } catch (error) {
      if (
        attempt === 0 &&
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      )
        continue;
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 'P2002'
      )
        throw new DeviceIdentityUnavailableError();
      throw error;
    }
  }
  throw new DeviceIdentityUnavailableError();
}
