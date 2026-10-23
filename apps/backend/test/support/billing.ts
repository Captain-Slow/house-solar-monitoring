import type { PrismaService } from '../../src/db/prisma.service.js';
import { LEDGER_ALGO_VERSION } from '../../src/accounting/types.js';

/** Synthetic fake rules only: nothing here is a real TNB tariff. */
export const flatRules = {
  currency: 'MYR',
  timezone: 'UTC',
  touWindows: [],
  defaultWindow: 'OFFPEAK',
  consumptionBasis: 'GROSS_IMPORT',
  thresholdProration: 'NONE',
  nem: null,
  components: [
    {
      code: 'TEST_ENERGY',
      label: 'Fake import energy',
      kind: 'PER_KWH',
      basis: 'IMPORT',
      rates: [{ window: 'ANY', tiers: [{ uptoKwh: null, rate: '0.50' }] }],
      tierMode: 'INCREMENTAL',
    },
  ],
  totalRounding: 'NONE',
};
export const nemRules = {
  ...flatRules,
  consumptionBasis: 'NET_IMPORT',
  nem: {
    offsetComponents: ['TEST_ENERGY'],
    touOffset: 'PRO_RATA',
    creditExpiryPeriods: 12,
  },
};

export const at = (date: string, bucket: number) =>
  new Date(new Date(`${date}T00:00:00Z`).getTime() + bucket * 300_000);

/** One synthetic local day of 288 ledger buckets; energy sits in bucket 0. */
export async function seedDay(
  prisma: PrismaService,
  date: string,
  options: {
    importWh?: string;
    exportWh?: string;
    coverage?: (bucket: number) => number;
  } = {},
): Promise<void> {
  await prisma.energyInterval.createMany({
    data: Array.from({ length: 288 }, (_, index) => ({
      bucketStart: at(date, index),
      calcVersion: LEDGER_ALGO_VERSION,
      maxGapSecUsed: 30,
      mappingVersion: 1,
      computedAt: at(date, index),
      gridImportNetWh: index === 0 ? (options.importWh ?? '0.000') : '0.000',
      gridExportNetWh: index === 0 ? (options.exportWh ?? '0.000') : '0.000',
      gridImportCounterWh: '0.000',
      gridExportCounterWh: '0.000',
      gridImportPhaseWh: '0.000',
      gridExportPhaseWh: '0.000',
      gridCoveredSec: options.coverage?.(index) ?? 300,
      pvCoveredSec: 300,
      batCoveredSec: 300,
      loadCoveredSec: 300,
      counterUnknownSec: [0, 0, 0, 0, 0, 0],
      counterGapAllocMask: 0,
      flags: 0,
    })),
  });
}

/** Non-provisional mapping and the METER_NET policy every synthetic billing test needs. */
export async function seedAccountingBasics(
  prisma: PrismaService,
): Promise<void> {
  await prisma.mappingVersion.create({
    data: { version: 1, config: {}, provisional: false, note: 'synthetic' },
  });
  await prisma.accountingPolicy.create({
    data: {
      effectiveFrom: new Date('2026-01-01T00:00:00Z'),
      gridSource: 'METER_NET',
      pvSource: 'INTEGRATED',
      batterySource: 'INTEGRATED',
      loadSource: 'DERIVED',
      maxGapSec: 30,
      validated: {},
      note: 'synthetic',
    },
  });
}

/**
 * Seeds the fully covered 60 kWh day `date` and the two bucket-aligned utility
 * readings that bracket it, which is the minimum that reconciles METER_NET imports.
 * Returns the ids of both readings (the later one is the "required endpoint").
 */
export async function seedReconciledDay(
  prisma: PrismaService,
  date: string,
): Promise<{ firstId: number; lastId: number }> {
  await seedDay(prisma, date, { importWh: '60000.000' });
  const next = new Date(at(date, 288));
  const first = await prisma.meterReading.create({
    data: {
      readAt: at(date, 0),
      source: 'UTILITY_METER_MANUAL',
      importKwh: '1000.000',
      resolutionKwh: '1.000',
    },
  });
  const last = await prisma.meterReading.create({
    data: {
      readAt: next,
      source: 'UTILITY_METER_MANUAL',
      importKwh: '1060.000',
      resolutionKwh: '1.000',
    },
  });
  return { firstId: first.id, lastId: last.id };
}
