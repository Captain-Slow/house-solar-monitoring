import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaService } from '../src/db/prisma.service.js';
import { ensureMappingV1 } from '../src/collector/mapping.js';
import { IngestService, PollBuffer } from '../src/collector/ingest.service.js';
import {
  initialRepeatState,
  normalizeFast,
  type RepeatState,
} from '../src/collector/normalize.js';
import { DEFAULT_MAPPING_V1 } from '../src/collector/mapping.js';
import { SampleFlag, type IngestPoll } from '../src/collector/types.js';
import { encodeBlocks } from '../src/modbus/raw-poll-codec.js';
import { FAST_PLAN } from '../src/modbus/read-plan.js';
import { blocksFrom, plausibleImage, setReg } from './support/synthetic.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

let database: TestDatabase;
let prisma: PrismaService;
let ingest: IngestService;
let deviceId: number;
let runId: number;
const base = Date.UTC(2026, 0, 1, 12, 0, 0);
const at = (seconds: number) => new Date(base + seconds * 1000);
let nextSeq = 0;

function poll(
  seconds: number,
  state: RepeatState,
  gridW = 300,
): { poll: IngestPoll; state: RepeatState } {
  const image = plausibleImage();
  setReg(image, 'meter_active_total', gridW);
  const blocks = blocksFrom(FAST_PLAN, image);
  const observedAt = at(seconds);
  const result = normalizeFast({
    blocks,
    observedAt,
    monotonicMs: seconds * 1000,
    mapping: DEFAULT_MAPPING_V1,
    mappingVersion: 1,
    state,
  });
  return {
    poll: {
      runId,
      seq: ++nextSeq,
      deviceId,
      tier: 'FAST',
      requestedAt: new Date(observedAt.getTime() - 100),
      receivedAt: new Date(observedAt.getTime() + 100),
      observedAt,
      blocks: encodeBlocks(blocks),
      sample: result.sample,
      events: result.events,
    },
    state: result.state,
  };
}

beforeAll(async () => {
  database = await createTestDatabase();
  prisma = new PrismaService({ DATABASE_URL: database.url });
  ingest = new IngestService(prisma);
  const source = await prisma.dataSource.create({
    data: { kind: 'MODBUS_TCP', endpoint: 'replay:1502#1' },
  });
  const device = await prisma.device.create({
    data: {
      dataSourceId: source.id,
      deviceKey: 'test',
      role: 'INVERTER',
      model: 'HIT-10L-G3',
      observedCapabilities: {},
      firmware: {},
      capabilitiesObservedAt: at(0),
      firstSeenAt: at(0),
      lastSeenAt: at(0),
    },
  });
  deviceId = device.id;
  runId = (
    await prisma.collectorRun.create({
      data: {
        startedAt: at(0),
        appVersion: 'test',
        registerMapVersion: 'test',
      },
    })
  ).id;
  await ensureMappingV1(prisma);
});
afterAll(async () => {
  await prisma?.close();
  await database?.drop();
});

describe('IngestService', () => {
  it('seeds v1 idempotently and selects the latest valid mapping', async () => {
    expect(await ensureMappingV1(prisma)).toMatchObject({
      version: 1,
      provisional: true,
      config: DEFAULT_MAPPING_V1,
    });
    expect(await prisma.mappingVersion.count()).toBe(1);
    await prisma.mappingVersion.create({
      data: {
        version: 2,
        config: { ...DEFAULT_MAPPING_V1, batterySign: -1 },
        provisional: false,
        note: 'verified',
      },
    });
    expect(await ensureMappingV1(prisma)).toMatchObject({
      version: 2,
      provisional: false,
      config: { batterySign: -1 },
    });
    await prisma.mappingVersion.delete({ where: { version: 2 } });
  });

  it('first-ever sample is dirty through the next exclusive bucket', async () => {
    const source = await prisma.dataSource.create({
      data: { kind: 'MODBUS_TCP', endpoint: 'other:1502#1' },
    });
    const other = await prisma.device.create({
      data: {
        dataSourceId: source.id,
        deviceKey: 'other',
        role: 'INVERTER',
        model: 'HIT-10L-G3',
        observedCapabilities: {},
        firmware: {},
        capabilitiesObservedAt: at(-10000),
        firstSeenAt: at(-10000),
        lastSeenAt: at(-10000),
      },
    });
    const original = deviceId;
    deviceId = other.id;
    const first = poll(-10000, initialRepeatState()).poll;
    deviceId = original;
    await ingest.ingest([first], { maxRepeatSpanSec: 30 });
    const dirty = await prisma.ledgerDirtyRange.findFirst({
      orderBy: { id: 'desc' },
    });
    expect(dirty?.fromBucket).toEqual(
      new Date(Math.floor(at(-10000).getTime() / 300000) * 300000),
    );
    expect(dirty?.toBucket).toEqual(
      new Date((Math.floor(at(-10000).getTime() / 300000) + 1) * 300000),
    );
  });

  it('stores 360 repeated polls once; replay creates no additional ledger dirt', async () => {
    let state = initialRepeatState();
    const polls: IngestPoll[] = [];
    for (let i = 0; i < 360; i++) {
      const result = poll(3600 + i * 10, state);
      polls.push(result.poll);
      state = result.state;
    }
    expect(await ingest.ingest(polls, { maxRepeatSpanSec: 30 })).toEqual({
      insertedSamples: 360,
      duplicateSamples: 0,
    });
    const dirty = await prisma.ledgerDirtyRange.count();
    const events = await prisma.dataQualityEvent.count();
    expect(await ingest.ingest(polls, { maxRepeatSpanSec: 30 })).toEqual({
      insertedSamples: 0,
      duplicateSamples: 360,
    });
    expect(await prisma.sample.count({ where: { deviceId } })).toBe(360);
    expect(await prisma.rawPoll.count({ where: { deviceId } })).toBe(360);
    expect(await prisma.ledgerDirtyRange.count()).toBe(dirty);
    expect(await prisma.dataQualityEvent.count()).toBe(events);
  });

  it('marks late insertion from preceding existing sample to following one', async () => {
    const first = poll(-120, initialRepeatState(), 1000).poll;
    const later = poll(120, initialRepeatState(), 1100).poll;
    await ingest.ingest([first, later], { maxRepeatSpanSec: 30 });
    const between = poll(60, initialRepeatState(), 1200).poll;
    expect(
      await ingest.ingest([between], { maxRepeatSpanSec: 30 }),
    ).toMatchObject({ insertedSamples: 1 });
    const dirty = await prisma.ledgerDirtyRange.findFirst({
      orderBy: { id: 'desc' },
    });
    expect(dirty?.fromBucket).toEqual(at(-300));
    expect(dirty?.toBucket).toEqual(at(300));
  });

  it('retroactively flags the complete repeat run across a bucket boundary and dirties the old bucket', async () => {
    let state = initialRepeatState();
    const early: IngestPoll[] = [];
    for (const seconds of [-20, -10, 0]) {
      const result = poll(seconds, state, 777);
      early.push(result.poll);
      state = result.state;
    }
    await ingest.ingest(early, { maxRepeatSpanSec: 30 });
    const crossing = poll(20, state, 777).poll;
    await ingest.ingest([crossing], { maxRepeatSpanSec: 30 });
    const stored = await prisma.sample.findMany({
      where: { deviceId, observedAt: { in: early.map((p) => p.observedAt) } },
      orderBy: { observedAt: 'asc' },
    });
    expect(
      stored.map((s) => Boolean(s.flags & SampleFlag.METER_STALE)),
    ).toEqual([true, true, true]);
    const range = await prisma.ledgerDirtyRange.findFirst({
      orderBy: { id: 'desc' },
    });
    expect(range!.fromBucket.getTime()).toBeLessThanOrEqual(at(-300).getTime());
    expect(range!.toBucket.getTime()).toBeGreaterThan(at(0).getTime());
  });

  it('flags a late low-age observation inserted inside an already-stale run', async () => {
    const first = poll(20_000, initialRepeatState(), 888);
    const late = poll(20_010, first.state, 888);
    const stale = poll(20_040, late.state, 888);
    await ingest.ingest([first.poll, stale.poll], { maxRepeatSpanSec: 30 });
    expect(
      await ingest.ingest([late.poll], { maxRepeatSpanSec: 30 }),
    ).toMatchObject({ insertedSamples: 1 });
    const stored = await prisma.sample.findUniqueOrThrow({
      where: {
        deviceId_observedAt: { deviceId, observedAt: late.poll.observedAt },
      },
    });
    expect(stored.flags & SampleFlag.METER_STALE).toBeTruthy();
  });

  it('starts a new retroactive run after an unobserved gap', async () => {
    const first = poll(23_000, initialRepeatState(), 999);
    const beforeGap = poll(23_010, first.state, 999);
    const afterGap = poll(23_130, beforeGap.state, 999);
    await ingest.ingest([first.poll, beforeGap.poll, afterGap.poll], {
      maxRepeatSpanSec: 30,
    });
    const stored = await prisma.sample.findMany({
      where: {
        deviceId,
        observedAt: {
          in: [
            first.poll.observedAt,
            beforeGap.poll.observedAt,
            afterGap.poll.observedAt,
          ],
        },
      },
      orderBy: { observedAt: 'asc' },
    });
    expect(
      stored.map((s) => Boolean(s.flags & SampleFlag.METER_STALE)),
    ).toEqual([false, false, true]);
  });

  it('rolls back raw rows, samples, events, status and dirty ranges on transaction failure', async () => {
    const good = poll(12_000, initialRepeatState()).poll;
    const bad = poll(12_010, initialRepeatState()).poll;
    bad.sample!.mappingVersion = 999999;
    const counts = await Promise.all([
      prisma.rawPoll.count(),
      prisma.sample.count(),
      prisma.dataQualityEvent.count(),
      prisma.ledgerDirtyRange.count(),
    ]);
    const lastSeenAt = (
      await prisma.device.findUniqueOrThrow({ where: { id: deviceId } })
    ).lastSeenAt;
    await expect(
      ingest.ingest([good, bad], { maxRepeatSpanSec: 30 }),
    ).rejects.toThrow();
    expect(
      await Promise.all([
        prisma.rawPoll.count(),
        prisma.sample.count(),
        prisma.dataQualityEvent.count(),
        prisma.ledgerDirtyRange.count(),
      ]),
    ).toEqual(counts);
    expect(
      (await prisma.device.findUniqueOrThrow({ where: { id: deviceId } }))
        .lastSeenAt,
    ).toEqual(lastSeenAt);
  });

  it('writes one dirty range for a mixed-device batch and treats an exact next bucket as exclusive', async () => {
    const earliest = poll(30_000, initialRepeatState(), 111).poll;
    const next = poll(30_300, initialRepeatState(), 222).poll;
    await ingest.ingest([earliest, next], { maxRepeatSpanSec: 30 });
    const other = await prisma.device.findFirstOrThrow({
      where: { deviceKey: 'other' },
    });
    const between = poll(30_100, initialRepeatState(), 333).poll;
    between.deviceId = other.id;
    const dirtyBefore = await prisma.ledgerDirtyRange.count();
    expect(
      await ingest.ingest([between], { maxRepeatSpanSec: 30 }),
    ).toMatchObject({ insertedSamples: 1 });
    expect(await prisma.ledgerDirtyRange.count()).toBe(dirtyBefore + 1);
    const dirty = await prisma.ledgerDirtyRange.findFirst({
      orderBy: { id: 'desc' },
    });
    expect(dirty?.fromBucket).toEqual(at(30_000));
    expect(dirty?.toBucket).toEqual(at(30_300));
    const mixed = poll(31_000, initialRepeatState(), 444).poll;
    const mixedOther = poll(31_100, initialRepeatState(), 555).poll;
    mixedOther.deviceId = other.id;
    const beforeMixed = await prisma.ledgerDirtyRange.count();
    expect(
      await ingest.ingest([mixed, mixedOther], { maxRepeatSpanSec: 30 }),
    ).toMatchObject({ insertedSamples: 2 });
    expect(await prisma.ledgerDirtyRange.count()).toBe(beforeMixed + 1);
  });

  it('drops the oldest buffered poll and preserves FIFO ordering across partial drains', () => {
    const buffer = new PollBuffer(2);
    const a = poll(0, initialRepeatState()).poll;
    const b = poll(10, initialRepeatState()).poll;
    const c = poll(20, initialRepeatState()).poll;
    expect(buffer.push(a)).toBe(0);
    expect(buffer.push(b)).toBe(0);
    expect(buffer.push(c)).toBe(1);
    expect(buffer.size).toBe(2);
    expect(buffer.drain(1)).toEqual([b]);
    expect(buffer.drain()).toEqual([c]);
    expect(buffer.size).toBe(0);
  });
});
