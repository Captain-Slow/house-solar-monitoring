import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseEnv } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { AccountingMutations } from '../src/accounting/accounting.mutations.js';
import { LedgerService } from '../src/accounting/ledger.service.js';
import { TotalsService } from '../src/accounting/totals.service.js';
import { ensurePolicyV1, selectSegment } from '../src/accounting/policy.js';
import { RawPollRenormalizer } from '../src/accounting/raw-poll-renormalizer.js';
import { LedgerFlag } from '../src/accounting/types.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

const base = Date.UTC(2026, 0, 2, 0, 0);
const at = (seconds: number) => new Date(base + seconds * 1000);
let db: TestDatabase;
let prisma: PrismaService;
let mutations: AccountingMutations;
let ledger: LedgerService;

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = new PrismaService({ DATABASE_URL: db.url });
  const env = parseEnv({ DATABASE_URL: db.url, COLLECTOR_ENABLED: 'false' });
  mutations = new AccountingMutations(
    prisma,
    env,
    new RawPollRenormalizer(prisma),
    () => at(3_600),
  );
  ledger = new LedgerService(prisma, env, { clock: () => at(3_600) });
});
afterAll(async () => {
  await prisma?.close();
  await db?.drop();
});

describe('effective-dated accounting policy (V6/V27)', () => {
  it('does not seed before the first sample and seeds v1 exactly once', async () => {
    expect(await ensurePolicyV1(prisma)).toBeNull();
    const source = await prisma.dataSource.create({
      data: { kind: 'MODBUS_TCP', endpoint: 'policy:502#1' },
    });
    const device = await prisma.device.create({
      data: {
        dataSourceId: source.id,
        deviceKey: 'policy',
        role: 'INVERTER',
        model: 'synthetic',
        observedCapabilities: {},
        firmware: {},
        capabilitiesObservedAt: at(0),
        firstSeenAt: at(0),
        lastSeenAt: at(0),
      },
    });
    await prisma.mappingVersion.create({
      data: { version: 1, config: {}, provisional: true, note: 'test' },
    });
    const run = await prisma.collectorRun.create({
      data: {
        startedAt: at(0),
        appVersion: 'test',
        registerMapVersion: 'test',
      },
    });
    const raw = await prisma.rawPoll.create({
      data: {
        runId: run.id,
        seq: 1,
        deviceId: device.id,
        tier: 'FAST',
        requestedAt: at(0),
        receivedAt: at(0),
        observedAt: at(0),
        blocks: Buffer.alloc(0),
        contentHash: Buffer.alloc(32),
      },
    });
    await prisma.sample.create({
      data: {
        rawPollId: raw.id,
        deviceId: device.id,
        observedAt: at(0),
        mappingVersion: 1,
        pvStringW: [],
        gridBuyPhaseWh: [],
        gridSellPhaseWh: [],
        meterRepeatSec: 0,
        flags: 0,
      },
    });
    const seeded = await ensurePolicyV1(prisma);
    expect(seeded).toMatchObject({
      version: 1,
      effectiveFrom: at(0),
      gridSource: 'METER_NET',
      pvSource: 'INTEGRATED',
      batterySource: 'INTEGRATED',
      loadSource: 'DERIVED',
      maxGapSec: 30,
    });
    expect(await ensurePolicyV1(prisma)).toEqual(seeded);
    expect(await prisma.accountingPolicy.count()).toBe(1);
  });

  it('moves monitoringSince backward for delayed May 1 ledger samples and preserves May 1 totals', async () => {
    const delayedDb = await createTestDatabase();
    const delayedPrisma = new PrismaService({ DATABASE_URL: delayedDb.url });
    try {
      const env = parseEnv({
        DATABASE_URL: delayedDb.url,
        COLLECTOR_ENABLED: 'false',
        SITE_TIMEZONE: 'UTC',
      });
      const delayedLedger = new LedgerService(delayedPrisma, env);
      const totals = new TotalsService(delayedPrisma, env);
      const may1 = new Date('2026-05-01T00:00:00.000Z');
      const may2 = new Date('2026-05-02T00:00:00.000Z');
      const may3 = new Date('2026-05-03T00:00:00.000Z');
      const source = await delayedPrisma.dataSource.create({
        data: { kind: 'MODBUS_TCP', endpoint: 'delayed-policy:502#1' },
      });
      const device = await delayedPrisma.device.create({
        data: {
          dataSourceId: source.id,
          deviceKey: 'delayed-policy',
          role: 'INVERTER',
          model: 'synthetic',
          observedCapabilities: {},
          firmware: {},
          capabilitiesObservedAt: may1,
          firstSeenAt: may1,
          lastSeenAt: may2,
        },
      });
      await delayedPrisma.mappingVersion.create({
        data: { version: 1, config: {}, provisional: true, note: 'test' },
      });
      const run = await delayedPrisma.collectorRun.create({
        data: {
          startedAt: may2,
          appVersion: 'test',
          registerMapVersion: 'test',
        },
      });
      const addSample = async (observedAt: Date, seq: number) => {
        const raw = await delayedPrisma.rawPoll.create({
          data: {
            runId: run.id,
            seq,
            deviceId: device.id,
            tier: 'FAST',
            requestedAt: observedAt,
            receivedAt: observedAt,
            observedAt,
            blocks: Buffer.alloc(0),
            contentHash: Buffer.alloc(32),
          },
        });
        await delayedPrisma.sample.create({
          data: {
            rawPollId: raw.id,
            deviceId: device.id,
            observedAt,
            mappingVersion: 1,
            gridW: 1000,
            pvStringW: [],
            gridBuyPhaseWh: [],
            gridSellPhaseWh: [],
            meterRepeatSec: 0,
            flags: 0,
          },
        });
      };
      await addSample(may2, 1);
      await addSample(new Date(may2.getTime() + 30_000), 2);
      await delayedPrisma.ledgerDirtyRange.create({
        data: {
          fromBucket: may2,
          toBucket: new Date(may2.getTime() + 300_000),
          reason: 'INGEST',
        },
      });
      await delayedLedger.processOnce(may3);
      const seeded = await delayedPrisma.accountingPolicy.findFirstOrThrow();
      expect(seeded.effectiveFrom).toEqual(may2);
      expect(seeded.supersededByVersion).toBeNull();

      await addSample(may1, 3);
      await addSample(new Date(may1.getTime() + 30_000), 4);
      await delayedPrisma.ledgerDirtyRange.create({
        data: {
          fromBucket: may1,
          toBucket: new Date(may1.getTime() + 300_000),
          reason: 'INGEST',
        },
      });
      await delayedLedger.processOnce(may3);
      const corrected = await delayedPrisma.accountingPolicy.findFirstOrThrow();
      expect(corrected.version).toBe(seeded.version);
      expect(corrected.effectiveFrom).toEqual(may1);
      expect(await delayedPrisma.accountingPolicy.count()).toBe(1);
      const may1Totals = await totals.energyTotals(
        '2026-05-01',
        '2026-05-01',
        'DAY',
      );
      expect(may1Totals.monitoringSince).toEqual(may1);
      expect(may1Totals.preMonitoringExcluded).toBe(false);
      expect(may1Totals.total.gridImport.kwh).toBe('0.008');
      expect(may1Totals.total.gridImport.coverage.toNumber()).toBeGreaterThan(
        0,
      );

      await delayedPrisma.sample.deleteMany({
        where: { observedAt: { gte: may1, lt: may2 } },
      });
      expect((await ensurePolicyV1(delayedPrisma))?.effectiveFrom).toEqual(
        may1,
      );
      expect(
        (await totals.energyTotals('2026-05-01', '2026-05-01', 'DAY'))
          .monitoringSince,
      ).toEqual(may1);

      const active = await new AccountingMutations(
        delayedPrisma,
        env,
        new RawPollRenormalizer(delayedPrisma),
      ).createAccountingPolicy({
        effectiveFrom: may1,
        gridSource: 'METER_PER_PHASE',
        pvSource: 'INTEGRATED',
        batterySource: 'INTEGRATED',
        loadSource: 'DERIVED',
        maxGapSec: 30,
        note: 'retroactive source selection',
      });
      const april30 = new Date('2026-04-30T00:00:00.000Z');
      await addSample(april30, 5);
      const activeStart = await ensurePolicyV1(delayedPrisma);
      expect(activeStart?.version).toBe(active.policy.version);
      expect(activeStart?.effectiveFrom).toEqual(april30);
      expect(
        (
          await delayedPrisma.accountingPolicy.findUniqueOrThrow({
            where: { version: seeded.version },
          })
        ).effectiveFrom,
      ).toEqual(may1);
      expect(await delayedPrisma.accountingPolicy.count()).toBe(2);
    } finally {
      await delayedPrisma.close();
      await delayedDb.drop();
    }
  });

  it('source-only versions supersede future active segments without touching intervals or runs', async () => {
    await prisma.energyInterval.create({
      data: {
        bucketStart: at(0),
        calcVersion: 1,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: at(0),
        gridCoveredSec: 0,
        pvCoveredSec: 0,
        batCoveredSec: 0,
        loadCoveredSec: 0,
        counterUnknownSec: [300, 300, 300, 300, 300, 300],
        counterGapAllocMask: 0,
        flags: 0,
      },
    });
    const source = {
      gridSource: 'INVERTER_COUNTER' as const,
      pvSource: 'INTEGRATED' as const,
      batterySource: 'INTEGRATED' as const,
      loadSource: 'DERIVED' as const,
      maxGapSec: 30,
      note: 'selected candidate',
    };
    const v2 = await mutations.createAccountingPolicy({
      ...source,
      effectiveFrom: at(600),
    });
    expect(v2.calculationRun).toBeNull();
    const v3 = await mutations.createAccountingPolicy({
      ...source,
      gridSource: 'METER_PER_PHASE',
      effectiveFrom: at(0),
    });
    expect(v3.calculationRun).toBeNull();
    expect(await prisma.calculationRun.count()).toBe(0);
    expect(
      (
        await prisma.energyInterval.findUniqueOrThrow({
          where: { bucketStart: at(0) },
        })
      ).computedAt,
    ).toEqual(at(0));
    const versions = await prisma.accountingPolicy.findMany({
      orderBy: { version: 'asc' },
    });
    expect(versions.map((p) => p.supersededByVersion)).toEqual([
      v3.policy.version,
      v3.policy.version,
      null,
    ]);
    expect(
      selectSegment(versions as Parameters<typeof selectSegment>[0], at(900))
        ?.version,
    ).toBe(v3.policy.version);
  });

  it('maxGapSec mismatch writes a CALC_PARAMS request and finishes it after recomputation', async () => {
    const changed = await mutations.createAccountingPolicy({
      effectiveFrom: at(0),
      gridSource: 'METER_NET',
      pvSource: 'INTEGRATED',
      batterySource: 'INTEGRATED',
      loadSource: 'DERIVED',
      maxGapSec: 60,
      note: 'allow 45-second gaps',
    });
    expect(changed.calculationRun?.kind).toBe('CALC_PARAMS_CHANGE');
    expect(
      await prisma.ledgerDirtyRange.count({ where: { reason: 'CALC_PARAMS' } }),
    ).toBe(1);
    await ledger.processOnce(at(3_600));
    expect(
      (
        await prisma.calculationRun.findUniqueOrThrow({
          where: { id: changed.calculationRun!.id },
        })
      ).status,
    ).toBe('DONE');
    expect(
      (
        await prisma.energyInterval.findUniqueOrThrow({
          where: { bucketStart: at(0) },
        })
      ).maxGapSecUsed,
    ).toBe(60);
  });
  it('does not duplicate pending CALC_PARAMS dirt for a source-only successor', async () => {
    const pending = await mutations.createAccountingPolicy({
      effectiveFrom: at(0),
      gridSource: 'METER_NET',
      pvSource: 'INTEGRATED',
      batterySource: 'INTEGRATED',
      loadSource: 'DERIVED',
      maxGapSec: 30,
      note: 'return to 30',
    });
    expect(pending.calculationRun?.kind).toBe('CALC_PARAMS_CHANGE');
    const runs = await prisma.calculationRun.count();
    const dirty = await prisma.ledgerDirtyRange.count({
      where: { reason: 'CALC_PARAMS' },
    });
    const selected = await mutations.createAccountingPolicy({
      effectiveFrom: at(0),
      gridSource: 'INVERTER_COUNTER',
      pvSource: 'INTEGRATED',
      batterySource: 'INTEGRATED',
      loadSource: 'DERIVED',
      maxGapSec: 30,
      note: 'source only while pending',
    });
    expect(selected.calculationRun).toBeNull();
    expect(await prisma.calculationRun.count()).toBe(runs);
    expect(
      await prisma.ledgerDirtyRange.count({ where: { reason: 'CALC_PARAMS' } }),
    ).toBe(dirty);
    await ledger.processOnce(at(3_600));
  });

  it('flags stored maxGapSec mismatches beyond retention without reconstructing them', async () => {
    const old = new Date(Date.UTC(2024, 0, 1));
    await prisma.energyInterval.create({
      data: {
        bucketStart: old,
        calcVersion: 1,
        maxGapSecUsed: 30,
        mappingVersion: 1,
        computedAt: old,
        gridImportNetWh: '22.000',
        gridCoveredSec: 300,
        pvCoveredSec: 0,
        batCoveredSec: 0,
        loadCoveredSec: 0,
        counterUnknownSec: [300, 300, 300, 300, 300, 300],
        counterGapAllocMask: 0,
        flags: 0,
      },
    });
    const change = await mutations.createAccountingPolicy({
      effectiveFrom: old,
      gridSource: 'METER_NET',
      pvSource: 'INTEGRATED',
      batterySource: 'INTEGRATED',
      loadSource: 'DERIVED',
      maxGapSec: 60,
      note: 'retroactive parameter',
    });
    expect(change.outsideRetentionBefore).not.toBeNull();
    const preserved = await prisma.energyInterval.findUniqueOrThrow({
      where: { bucketStart: old },
    });
    expect(preserved.gridImportNetWh?.toString()).toBe('22');
    expect(preserved.maxGapSecUsed).toBe(30);
    expect(preserved.flags & LedgerFlag.STALE_CALC_PARAMS).not.toBe(0);
  });

  it('bounds exclusions, invalidates surrounding buckets, and reverses the mutation', async () => {
    await expect(
      mutations.createDataExclusion(
        { from: at(600), to: at(0), families: ['GRID'], reason: 'fault' },
        'admin',
      ),
    ).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
    await expect(
      mutations.createDataExclusion(
        { from: at(0), to: at(600), families: ['DEVICE'], reason: 'fault' },
        'admin',
      ),
    ).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
    for (const inherited of ['constructor', 'toString', '__proto__']) {
      await expect(
        mutations.createDataExclusion(
          {
            from: at(0),
            to: at(600),
            families: [inherited],
            reason: 'fault',
          },
          'admin',
        ),
      ).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
    }
    const exclusion = await mutations.createDataExclusion(
      { from: at(300), to: at(600), families: ['GRID'], reason: 'fault' },
      'admin',
    );
    const first = await prisma.ledgerDirtyRange.findFirstOrThrow({
      where: { reason: 'EXCLUSION' },
    });
    expect(first.fromBucket).toEqual(at(0));
    expect(first.toBucket).toEqual(at(600));
    expect(await mutations.deleteDataExclusion(exclusion.id)).toBe(true);
    expect(
      await prisma.ledgerDirtyRange.count({ where: { reason: 'EXCLUSION' } }),
    ).toBe(2);
    expect(await mutations.deleteDataExclusion(exclusion.id)).toBe(false);
  });
});
