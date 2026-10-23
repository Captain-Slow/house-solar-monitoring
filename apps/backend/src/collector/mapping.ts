import { z } from 'zod';
import type { PrismaService } from '../db/prisma.service.js';
import type { MappingConfig } from './types.js';

const sign = z.union([z.literal(1), z.literal(-1)]);
const mappingSchema = z
  .object({
    gridMeterSign: sign,
    gridMeterPhaseSign: z.tuple([sign, sign, sign]),
    inverterAcSign: sign,
    batterySign: sign,
    batteryPowerSource: z.enum(['BAT1_POWER_G3_50', 'BMS_1914']),
    maxRepeatSpanSec: z.number().int().positive(),
  })
  .strict();

export const DEFAULT_MAPPING_V1: MappingConfig = {
  gridMeterSign: 1,
  gridMeterPhaseSign: [1, 1, 1],
  inverterAcSign: 1,
  batterySign: 1,
  batteryPowerSource: 'BAT1_POWER_G3_50',
  maxRepeatSpanSec: 30,
};
export const MAPPING_V1_NOTE =
  'Provisional mapping v1: raw signs are unverified until gate G3.';

export async function ensureMappingV1(prisma: PrismaService): Promise<{
  version: number;
  config: MappingConfig;
  provisional: boolean;
}> {
  await prisma.$executeRaw`INSERT INTO "MappingVersion" ("version", "config", "provisional", "note")
    VALUES (1, ${JSON.stringify(DEFAULT_MAPPING_V1)}::jsonb, true, ${MAPPING_V1_NOTE})
    ON CONFLICT ("version") DO NOTHING`;
  const latest = await prisma.mappingVersion.findFirst({
    orderBy: { version: 'desc' },
  });
  if (latest === null) throw new Error('MappingVersion insert did not persist');
  return {
    version: latest.version,
    config: mappingSchema.parse(latest.config),
    provisional: latest.provisional,
  };
}

export function validateMappingConfig(config: unknown): MappingConfig {
  return mappingSchema.parse(config);
}
