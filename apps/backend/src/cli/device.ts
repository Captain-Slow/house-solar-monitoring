import { Prisma } from '../generated/prisma/client.js';
import { parseArgs } from 'node:util';
import { PrismaService } from '../db/prisma.service.js';
import { isMain } from './is-main.js';

export interface ReplaceDeviceArgs {
  key: string;
  effectiveAt: Date;
  reason: string;
}

/** The replacement boundary is explicit; detect observations alone never retire a device. */
export async function replaceDevice(
  prisma: PrismaService,
  args: ReplaceDeviceArgs,
): Promise<{ retiredDeviceId: number; deviceId: number }> {
  if (
    !args.key.trim() ||
    !args.reason.trim() ||
    !Number.isFinite(args.effectiveAt.getTime())
  )
    throw new Error('replace requires a key, reason and valid effectiveAt');
  return prisma.$transaction(async (tx) => {
    const active = await tx.device.findMany({
      where: { deviceKey: args.key, retiredAt: null },
    });
    if (active.length !== 1)
      throw new Error(`expected exactly one active device for key ${args.key}`);
    const previous = active[0]!;
    // These required JSON columns are non-null objects written by resolveDevice.
    if (
      typeof previous.observedCapabilities !== 'object' ||
      previous.observedCapabilities === null ||
      Array.isArray(previous.observedCapabilities) ||
      typeof previous.firmware !== 'object' ||
      previous.firmware === null ||
      Array.isArray(previous.firmware)
    )
      throw new Error('device JSON shape is invalid');
    const observedCapabilities =
      previous.observedCapabilities as Prisma.InputJsonObject;
    const firmware = previous.firmware as Prisma.InputJsonObject;
    await tx.device.update({
      where: { id: previous.id },
      data: { retiredAt: args.effectiveAt, replacementReason: args.reason },
    });
    const next = await tx.device.create({
      data: {
        dataSourceId: previous.dataSourceId,
        deviceKey: previous.deviceKey,
        role: previous.role,
        model: previous.model,
        observedCapabilities,
        capabilitiesObservedAt: previous.capabilitiesObservedAt,
        firmware,
        firstSeenAt: args.effectiveAt,
        lastSeenAt: args.effectiveAt,
      },
    });
    await tx.dataQualityEvent.create({
      data: {
        deviceId: next.id,
        kind: 'DEVICE_REPLACED',
        startedAt: args.effectiveAt,
        details: {
          previousDeviceId: previous.id,
          newDeviceId: next.id,
          reason: args.reason,
        },
      },
    });
    return { retiredDeviceId: previous.id, deviceId: next.id };
  });
}

export async function main(argv: string[]): Promise<void> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      key: { type: 'string' },
      'effective-at': { type: 'string' },
      reason: { type: 'string' },
    },
  });
  if (
    positionals.length !== 1 ||
    positionals[0] !== 'replace' ||
    !values.key ||
    !values['effective-at'] ||
    !values.reason ||
    !/(?:Z|[+-]\d\d:\d\d)$/i.test(values['effective-at'])
  )
    throw new Error(
      'usage: device replace --key <DEVICE_KEY> --effective-at <ISO> --reason <text>',
    );
  const prisma = new PrismaService(process.env);
  try {
    const result = await replaceDevice(prisma, {
      key: values.key,
      effectiveAt: new Date(values['effective-at']),
      reason: values.reason,
    });
    console.log(
      `device ${result.retiredDeviceId} retired; replacement ${result.deviceId} created`,
    );
  } finally {
    await prisma.close();
  }
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
