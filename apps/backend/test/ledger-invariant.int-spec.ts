import { createHash } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AccountingMutations } from '../src/accounting/accounting.mutations.js';
import { LedgerService } from '../src/accounting/ledger.service.js';
import { RawPollRenormalizer } from '../src/accounting/raw-poll-renormalizer.js';
import { IngestService } from '../src/collector/ingest.service.js';
import {
  DEFAULT_MAPPING_V1,
  ensureMappingV1,
} from '../src/collector/mapping.js';
import {
  initialRepeatState,
  normalizeFast,
} from '../src/collector/normalize.js';
import type { IngestPoll } from '../src/collector/types.js';
import { parseEnv } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { encodeBlocks } from '../src/modbus/raw-poll-codec.js';
import { FAST_PLAN } from '../src/modbus/read-plan.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import { blocksFrom, plausibleImage, setReg } from './support/synthetic.js';

/**
 * The ledger is a pure function of the stored Samples, exclusions and policy (plan: Phase 4.4,
 * V5/V23). One stream exercises every recovery path at once: a counter reset, a rejected spike, a
 * 3-hour upstream gap that crosses the Berlin local midnight and is closed by a late sample, a
 * meter-link outage, a GRID exclusion, samples on 5-minute boundaries, and the 2026-10-25 DST
 * change. The converged EnergyInterval table must be identical however it is reached.
 */
const ZONE = 'Europe/Berlin';
const BASE = Date.UTC(2026, 9, 24, 21, 0); // 23:00 CEST on 2026-10-24
const STREAM_END = 18_000; // seconds after BASE (past the 03:00 -> 02:00 DST change at s = 14 400)
const GAP = [1000, 11_800] as const; // no samples in (1000, 11 800): crosses local midnight (s = 3600)
const LINK_DOWN = [12_000, 12_600] as const;
/** Identical meter words for 200 s: with maxRepeatSpanSec 30 the run becomes METER_STALE retroactively. */
const STALE_RUN = [12_700, 12_900] as const;
/** Sparse readings (5-minute spacing) with a rejected spike right after a chunk-boundary-sized hole. */
const SPARSE = [
  16_500, 16_510, 16_810, 17_110, 17_410, 17_710, 18_000,
] as const;
const SPARSE_SPIKE = 16_810;
/** A sample that arrives late, inside the 3-hour gap. */
const LATE_IN_GAP = 7530;
const STALE_SPAN = 30;
const RESET_AT = 13_000;
const SPIKE_AT = 16_000;
const at = (seconds: number) => new Date(BASE + seconds * 1000);
const CLOCK = at(STREAM_END + 7200);

let db: TestDatabase;
let prisma: PrismaService;
let ingest: IngestService;
let ledger: LedgerService;
let mutations: AccountingMutations;
let deviceId: number;
let runId: number;
let all: IngestPoll[];

function counterWh(second: number): number {
  const steady = 5_000_000 + Math.floor((second * 0.2778) / 100) * 100;
  if (second === SPIKE_AT || second === SPARSE_SPIKE) return 100_000_000_000; // 100 000 kWh: far above limit()
  if (second >= RESET_AT)
    return 200 + Math.floor(((second - RESET_AT) * 0.2778) / 100) * 100;
  return steady;
}

function buildStream(): IngestPoll[] {
  const seconds: number[] = [];
  for (let s = 0; s <= STREAM_END; s += 10) {
    if (s > GAP[0] && s < GAP[1]) continue;
    if (s >= SPARSE[0]) continue;
    seconds.push(s);
  }
  seconds.push(...SPARSE, LATE_IN_GAP);
  seconds.sort((a, b) => a - b);
  let state = initialRepeatState();
  let seq = 0;
  return seconds.map((second) => {
    const inStale = second >= STALE_RUN[0] && second < STALE_RUN[1];
    const image = plausibleImage({
      gridW: inStale ? 1234 : 1000 + (second % 600),
      pvW: 0,
    });
    setReg(image, 'grid_buy_energy', counterWh(second) / 1000);
    if (second >= LINK_DOWN[0] && second < LINK_DOWN[1])
      setReg(image, 'grid_meter_link', 0);
    const blocks = blocksFrom(FAST_PLAN, image);
    const observedAt = at(second);
    const result = normalizeFast({
      blocks,
      observedAt,
      monotonicMs: second * 1000,
      mapping: { ...DEFAULT_MAPPING_V1, maxRepeatSpanSec: STALE_SPAN },
      mappingVersion: 1,
      state,
    });
    state = result.state;
    return {
      runId,
      seq: ++seq,
      deviceId,
      tier: 'FAST' as const,
      requestedAt: observedAt,
      receivedAt: observedAt,
      observedAt,
      blocks: encodeBlocks(blocks),
      sample: result.sample,
      events: result.events,
    };
  });
}

/** Deterministic PRNG (mulberry32). */
function prng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function converge(): Promise<void> {
  for (let i = 0; i < 80; i++) {
    await ledger.processOnce(CLOCK);
    if ((await prisma.ledgerDirtyRange.count()) === 0) return;
  }
  throw new Error('ledger did not converge in 80 passes');
}

/** Hash of every stored column except computedAt. */
async function fingerprint(): Promise<{ hash: string; rows: number }> {
  const rows = await prisma.energyInterval.findMany({
    orderBy: { bucketStart: 'asc' },
  });
  const plain = rows.map(({ computedAt: _computedAt, ...row }) => row);
  return {
    hash: createHash('sha256').update(JSON.stringify(plain)).digest('hex'),
    rows: rows.length,
  };
}

async function wipeData(): Promise<void> {
  await prisma.ledgerDirtyRange.deleteMany();
  // The seeded policy v1 takes effectiveFrom from the first sample SEEN: a fresh arrival order must
  // seed its own, exactly as a new installation would.
  await prisma.accountingPolicy.deleteMany();
  await prisma.energyInterval.deleteMany();
  await prisma.dataQualityEvent.deleteMany();
  await prisma.sample.deleteMany();
  await prisma.rawPoll.deleteMany();
}

async function ledgerEvents(): Promise<string[]> {
  const events = await prisma.dataQualityEvent.findMany({
    where: {
      kind: {
        in: ['COUNTER_RESET', 'COUNTER_JUMP_REJECTED', 'COUNTER_DISCONTINUITY'],
      },
    },
    orderBy: [{ startedAt: 'asc' }, { kind: 'asc' }],
  });
  return events.map((e) => `${e.kind}@${e.startedAt.toISOString()}`);
}

beforeAll(async () => {
  db = await createTestDatabase();
  prisma = new PrismaService({ DATABASE_URL: db.url });
  const env = parseEnv({
    DATABASE_URL: db.url,
    COLLECTOR_ENABLED: 'false',
    SITE_TIMEZONE: ZONE,
  });
  ledger = new LedgerService(prisma, env, { clock: () => CLOCK });
  mutations = new AccountingMutations(
    prisma,
    env,
    new RawPollRenormalizer(prisma),
  );
  ingest = new IngestService(prisma);
  await ensureMappingV1(prisma);
  const source = await prisma.dataSource.create({
    data: { kind: 'MODBUS_TCP', endpoint: 'invariant:502#1' },
  });
  deviceId = (
    await prisma.device.create({
      data: {
        dataSourceId: source.id,
        deviceKey: 'invariant',
        role: 'INVERTER',
        model: 'synthetic',
        observedCapabilities: {},
        firmware: {},
        capabilitiesObservedAt: at(0),
        firstSeenAt: at(0),
        lastSeenAt: at(0),
      },
    })
  ).id;
  runId = (
    await prisma.collectorRun.create({
      data: {
        startedAt: at(0),
        appVersion: 'test',
        registerMapVersion: 'test',
      },
    })
  ).id;
  all = buildStream();
  await mutations.createDataExclusion(
    {
      from: at(14_700),
      to: at(15_300),
      families: ['GRID'],
      reason: 'invariant test',
    },
    'test',
  );
}, 60_000);

afterAll(async () => {
  await prisma?.close();
  await db?.drop();
});

describe('ledger recomputation invariants', () => {
  let reference: { hash: string; rows: number };
  let referenceEvents: string[];

  it('the stream really exercises the hard cases (so equality below is not vacuous)', async () => {
    await ingest.ingest(all, { maxRepeatSpanSec: STALE_SPAN });
    await converge();
    reference = await fingerprint();
    referenceEvents = await ledgerEvents();
    expect(reference.rows).toBeGreaterThan(30);
    expect(referenceEvents.some((e) => e.startsWith('COUNTER_RESET'))).toBe(
      true,
    );
    expect(
      referenceEvents.some((e) => e.startsWith('COUNTER_JUMP_REJECTED')),
    ).toBe(true);
    const rows = await prisma.energyInterval.findMany({
      orderBy: { bucketStart: 'asc' },
    });
    // 3-hour counter gap: gap-allocated on every bucket of the span, across the local midnight.
    const gapBuckets = rows.filter(
      (r) =>
        r.bucketStart.getTime() >= BASE + 1200_000 &&
        r.bucketStart.getTime() < BASE + 11_700_000,
    );
    expect(gapBuckets.length).toBeGreaterThan(30);
    expect(gapBuckets.every((r) => (r.counterGapAllocMask & 0b10) !== 0)).toBe(
      true,
    );
    // meter-link outage and the GRID exclusion reduce grid coverage, never invent energy.
    const outage = rows.find(
      (r) => r.bucketStart.getTime() === BASE + 12_300_000,
    );
    expect(outage?.gridCoveredSec).toBeLessThan(300);
    const excluded = rows.find(
      (r) => r.bucketStart.getTime() === BASE + 15_000_000,
    );
    expect(excluded?.gridCoveredSec).toBeLessThan(300);
    // a retroactively stale meter run (identical words > 30 s) removes grid coverage in its bucket
    const stale = rows.find(
      (r) => r.bucketStart.getTime() === BASE + 12_600_000,
    );
    expect(stale?.gridCoveredSec).toBeLessThan(100);
    // sparse 5-minute readings with a rejected spike still produce counter energy, and each spike
    // is rejected at its own timestamp
    const sparse = rows.find(
      (r) => r.bucketStart.getTime() === BASE + 16_500_000,
    );
    expect(sparse).toBeDefined();
    expect(Number(sparse!.gridImportCounterWh)).toBeGreaterThan(0);
    expect(referenceEvents).toContain(
      `COUNTER_JUMP_REJECTED@${at(SPARSE_SPIKE).toISOString()}`,
    );
    expect(referenceEvents).toContain(
      `COUNTER_JUMP_REJECTED@${at(SPIKE_AT).toISOString()}`,
    );
    expect(referenceEvents).toContain(
      `COUNTER_RESET@${at(RESET_AT).toISOString()}`,
    );
    // the DST change (s = 14 400) lies inside the processed span: rows exist on both sides and the
    // local-day boundary at s = 3600 sits inside the gap-allocated span
    const times = rows.map((r) => r.bucketStart.getTime());
    expect(times.some((t) => t < BASE + 14_400_000)).toBe(true);
    expect(times.some((t) => t >= BASE + 14_400_000)).toBe(true);
    expect(rows.some((r) => (r.flags & 256) !== 0)).toBe(true); // TOU_UNCERTAIN across the local midnight
    expect(await prisma.ledgerDirtyRange.count()).toBe(0);
  });

  it('wipe + full recompute from the stored samples reproduces the identical table', async () => {
    await prisma.energyInterval.deleteMany();
    await prisma.ledgerDirtyRange.create({
      data: {
        fromBucket: at(-600),
        toBucket: at(STREAM_END + 600),
        reason: 'RECALC_REQUEST',
      },
    });
    await converge();
    expect(await fingerprint()).toEqual(reference);
    expect(await ledgerEvents()).toEqual(referenceEvents);
  });

  it('shuffled, interleaved arrival (late samples closing the gap) converges to the identical table', async () => {
    await wipeData();
    const rand = prng(20261024);
    const order = [...all];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }
    let step = 0;
    for (let i = 0; i < order.length; i += 37) {
      await ingest.ingest(order.slice(i, i + 37), {
        maxRepeatSpanSec: STALE_SPAN,
      });
      if (++step % 3 === 0) await converge(); // process while later samples are still missing
    }
    await converge();
    expect(await fingerprint()).toEqual(reference);
    expect(await ledgerEvents()).toEqual(referenceEvents);
  });

  it('a sample arriving late INSIDE the 3-hour gap rewrites the whole span to the identical table', async () => {
    await wipeData();
    const withoutLate = all.filter(
      (p) => p.observedAt.getTime() !== BASE + LATE_IN_GAP * 1000,
    );
    expect(withoutLate.length).toBe(all.length - 1);
    await ingest.ingest(withoutLate, { maxRepeatSpanSec: STALE_SPAN });
    await converge();
    const before = await fingerprint();
    expect(before.hash).not.toBe(reference.hash); // the gap really was allocated differently
    const late = all.filter(
      (p) => p.observedAt.getTime() === BASE + LATE_IN_GAP * 1000,
    );
    await ingest.ingest(late, { maxRepeatSpanSec: STALE_SPAN });
    await converge();
    expect(await fingerprint()).toEqual(reference);
    expect(await ledgerEvents()).toEqual(referenceEvents);
  });

  it('processing disjoint ranges separately (different chunking) equals one pass', async () => {
    await prisma.energyInterval.deleteMany();
    await prisma.dataQualityEvent.deleteMany();
    const buckets = Math.ceil((STREAM_END + 600) / 300);
    for (const parity of [0, 1]) {
      for (let b = parity; b < buckets; b += 2) {
        await prisma.ledgerDirtyRange.create({
          data: {
            fromBucket: at(-300 + b * 300),
            toBucket: at(-300 + b * 300 + 300),
            reason: 'RECALC_REQUEST',
          },
        });
      }
      await converge();
    }
    expect(await fingerprint()).toEqual(reference);
    expect(await ledgerEvents()).toEqual(referenceEvents);
  });
});
