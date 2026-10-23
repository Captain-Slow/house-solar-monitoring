import { createHash } from 'node:crypto';
import { Injectable, Optional } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../db/prisma.service.js';
import { SampleFlag, type IngestPoll } from './types.js';
import { WordMap } from '../modbus/decode.js';
import { decodeBlocksBuffer } from '../modbus/raw-poll-codec.js';
import { meterWordsHash } from './normalize.js';

const BUCKET_MS = 300_000;
const floor5 = (date: Date): Date =>
  new Date(Math.floor(date.getTime() / BUCKET_MS) * BUCKET_MS);
// With no later sample, the newest sample's own bucket is still dirty at exact boundaries.
const ceil5 = (date: Date, withoutNext = false): Date =>
  new Date(
    (withoutNext
      ? Math.floor(date.getTime() / BUCKET_MS) + 1
      : Math.ceil(date.getTime() / BUCKET_MS)) * BUCKET_MS,
  );

type TimestampRow = { id: bigint; observedAt: Date };
/** Proven members of one valid meter repeat run; proof-limited lookups may return a subset. */
export interface MeterRepeatRun {
  sampleIds: bigint[];
  rawPollIds: bigint[];
  maxRepeatSec: number;
}

/**
 * Find a repeat run by acquisition identity, never by the possibly duplicated wall timestamp.
 * Every retained acquisition sequence entry participates in continuity, across all devices/tiers:
 * missing history cannot prove that an invalid/changed FAST poll did not end the run. Immutable
 * durations also prevent corrupt replayed Samples shortening it.
 * Repair may stop after a validated member exceeds stopAfterRepeatSec: membership is then partial
 * and maxRepeatSec is a sufficient lower bound. Ingest/replay use the default complete traversal.
 */
export async function findMeterRepeatRun(
  tx: Prisma.TransactionClient,
  deviceId: number,
  anchorRawPollId: bigint,
  maxRepeatSpanSec: number,
  stopAfterRepeatSec = Infinity,
): Promise<MeterRepeatRun> {
  const anchor = await tx.rawPoll.findUnique({
    where: { id: anchorRawPollId },
    include: {
      sample: { select: { id: true, meterRepeatSec: true, flags: true } },
    },
  });
  const empty = { sampleIds: [], rawPollIds: [], maxRepeatSec: 0 };
  if (anchor === null || anchor.tier !== 'FAST' || anchor.deviceId !== deviceId)
    return empty;
  // Legacy durations can only be verified against their original sample-backed wall chain.
  // This comparison never supplies a repeat duration: missing timing evidence ends the chain.
  const legacy = anchor.monotonicMs === null;
  const evidence = (poll: typeof anchor) => ({
    hash: meterWordsHash(
      new WordMap(decodeBlocksBuffer(Buffer.from(poll.blocks))),
    ),
    repeat:
      poll.acquisitionMeterRepeatSec ?? poll.sample?.meterRepeatSec ?? null,
  });
  const initial = evidence(anchor);
  if (initial.hash === null || initial.repeat === null) return empty;
  const result: MeterRepeatRun = {
    sampleIds: anchor.sample === null ? [] : [anchor.sample.id],
    rawPollIds: [anchor.id],
    maxRepeatSec: initial.repeat,
  };
  if (result.maxRepeatSec > stopAfterRepeatSec) return result;
  for (const direction of ['backward', 'forward'] as const) {
    let previous = anchor;
    let previousRepeat = initial.repeat;
    let sequence = anchor.seq;
    const sign = direction === 'backward' ? -1 : 1;
    let finished = false;
    // Most acquisitions change immediately. Read the first neighbour before hydrating
    // a full page; only a proven continuing run justifies the larger bounded batch.
    let pageSize = 1;
    while (!finished) {
      // Sequence is allocated once per captured poll, before persistence, for the whole run.
      // Page lightweight identities across ALL tiers/devices: retained non-FAST entries bridge
      // FAST gaps, but a dropped/pruned acquisition is an unprovable boundary. Do not require a
      // particular starting sequence: collector restarts and retention can remove a run's prefix.
      const acquisitions = await tx.rawPoll.findMany({
        where: {
          runId: anchor.runId,
          seq: direction === 'backward' ? { lt: sequence } : { gt: sequence },
        },
        select: { id: true, seq: true, deviceId: true, tier: true },
        orderBy: { seq: direction === 'backward' ? 'desc' : 'asc' },
        take: pageSize,
      });
      if (acquisitions.length === 0) break;
      const fastIds = acquisitions
        .filter((poll) => poll.deviceId === deviceId && poll.tier === 'FAST')
        .map((poll) => poll.id);
      // Fetch blocks and Sample evidence only for relevant FAST polls, once per bounded page.
      const polls = new Map(
        (
          await tx.rawPoll.findMany({
            where: { id: { in: fastIds } },
            include: {
              sample: {
                select: { id: true, meterRepeatSec: true, flags: true },
              },
            },
          })
        ).map((poll) => [poll.id, poll]),
      );
      for (const acquisition of acquisitions) {
        if (acquisition.seq !== sequence + sign) {
          finished = true;
          break;
        }
        sequence = acquisition.seq;
        if (acquisition.deviceId !== deviceId || acquisition.tier !== 'FAST')
          continue;
        const poll = polls.get(acquisition.id);
        // Retention may remove a raw-only FAST row between the identity and evidence reads.
        if (poll === undefined) {
          finished = true;
          break;
        }
        const current = evidence(poll);
        const elapsed = legacy
          ? poll.monotonicMs === null
            ? sign * (poll.observedAt.getTime() - previous.observedAt.getTime())
            : -1
          : poll.monotonicMs === null
            ? -1
            : sign * (poll.monotonicMs - previous.monotonicMs!);
        const repeatDelta =
          current.repeat === null
            ? -1
            : sign * (current.repeat - previousRepeat);
        if (
          current.hash !== initial.hash ||
          elapsed < 0 ||
          elapsed > maxRepeatSpanSec * 1000 ||
          repeatDelta < 0 ||
          Math.abs(elapsed - repeatDelta * 1000) > 1000
        ) {
          finished = true;
          break;
        }
        result.rawPollIds.push(poll.id);
        if (poll.sample !== null) result.sampleIds.push(poll.sample.id);
        result.maxRepeatSec = Math.max(result.maxRepeatSec, current.repeat!);
        if (result.maxRepeatSec > stopAfterRepeatSec) return result;
        previous = poll;
        previousRepeat = current.repeat!;
        pageSize = 1000;
      }
    }
  }
  return result;
}

/** Persist interpolation-bounding recovery dirt and dependent-result invalidation atomically. */
export async function dirtyAcquisitionSamples(
  tx: Prisma.TransactionClient,
  changed: TimestampRow[],
  createdAt = new Date(),
): Promise<{ dirtyFrom: Date | null; dirtyTo: Date | null }> {
  if (changed.length === 0) return { dirtyFrom: null, dirtyTo: null };
  let first = changed[0]!.observedAt;
  let last = first;
  for (const row of changed) {
    if (row.observedAt < first) first = row.observedAt;
    if (row.observedAt > last) last = row.observedAt;
  }
  const neighbors = await tx.$queryRaw<
    { before: Date | null; after: Date | null }[]
  >`
    SELECT
      (SELECT "observedAt" FROM "Sample" WHERE "observedAt" < ${first}
        ORDER BY "observedAt" DESC LIMIT 1) AS "before",
      (SELECT "observedAt" FROM "Sample" WHERE "observedAt" > ${last}
        ORDER BY "observedAt" LIMIT 1) AS "after"`;
  const dirtyFrom = floor5(neighbors[0]!.before ?? first);
  const dirtyTo = neighbors[0]!.after
    ? ceil5(neighbors[0]!.after)
    : ceil5(last, true);
  await tx.ledgerDirtyRange.create({
    data: {
      fromBucket: dirtyFrom,
      toBucket: dirtyTo,
      reason: 'INGEST',
      createdAt,
    },
  });
  // Core acquisition also runs before the optional tariff schema is installed.
  // There are no cached bills to invalidate then; dirt remains for the later worker.
  const [billing] = await tx.$queryRaw<{ available: boolean }[]>`
    SELECT to_regclass('"BillingPeriodResult"') IS NOT NULL AS available`;
  if (billing!.available)
    await tx.$executeRaw`
    UPDATE "BillingPeriodResult" AS r SET "calcVersion" = 0
    FROM "BillingPeriod" AS p JOIN "Tariff" AS t ON t."id" = p."tariffId"
    WHERE r."billingPeriodId" = p."id"
      AND (p."startDate"::timestamp AT TIME ZONE t."timezone") < ${dirtyTo}
      AND ((p."endDate" + 1)::timestamp AT TIME ZONE t."timezone") > ${dirtyFrom}`;
  return { dirtyFrom, dirtyTo };
}

export class PollBuffer {
  private readonly polls: IngestPoll[] = [];
  constructor(readonly capacity = 360) {
    if (!Number.isInteger(capacity) || capacity <= 0)
      throw new RangeError('capacity must be positive');
  }
  get size(): number {
    return this.polls.length;
  }
  push(poll: IngestPoll): number {
    let dropped = 0;
    if (this.polls.length === this.capacity) {
      this.polls.shift();
      dropped = 1;
    }
    this.polls.push(poll);
    return dropped;
  }
  drain(max = this.polls.length): IngestPoll[] {
    if (!Number.isInteger(max) || max < 0)
      throw new RangeError('max must be nonnegative');
    return this.polls.splice(0, max);
  }
}

function intArray(values: readonly (number | null)[]): Prisma.Sql {
  return values.length === 0
    ? Prisma.sql`ARRAY[]::integer[]`
    : Prisma.sql`ARRAY[${Prisma.join(values)}]::integer[]`;
}
function bigintArray(values: readonly bigint[]): Prisma.Sql {
  return values.length === 0
    ? Prisma.sql`ARRAY[]::bigint[]`
    : Prisma.sql`ARRAY[${Prisma.join(values)}]::bigint[]`;
}

@Injectable()
export class IngestService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly clock: () => Date = () => new Date(),
  ) {}

  async ingest(
    polls: IngestPoll[],
    opts: { maxRepeatSpanSec: number },
  ): Promise<{
    insertedSamples: number;
    duplicateSamples: number;
  }> {
    if (!Number.isFinite(opts.maxRepeatSpanSec) || opts.maxRepeatSpanSec < 0)
      throw new RangeError('maxRepeatSpanSec must be nonnegative');
    return this.prisma.$transaction(
      async (tx) => {
        let insertedSamples = 0;
        let duplicateSamples = 0;
        const inserted = new Map<number, TimestampRow[]>();
        const fastRaw = new Map<number, bigint[]>();
        for (const poll of polls) {
          const acquisitionSample =
            poll.tier === 'FAST' && poll.monotonicMs !== undefined
              ? poll.sample
              : undefined;
          const raw = await tx.$queryRaw<{ id: bigint }[]>`
          INSERT INTO "RawPoll" ("runId", "seq", "deviceId", "tier", "requestedAt", "receivedAt", "observedAt", "monotonicMs", "acquisitionClockStep", "acquisitionMeterRepeatSec", "blocks", "contentHash")
          VALUES (${poll.runId}, ${poll.seq}, ${poll.deviceId}, ${poll.tier}::"PollTier",
            ${poll.requestedAt}, ${poll.receivedAt}, ${poll.observedAt}, ${poll.monotonicMs ?? null},
            ${acquisitionSample === undefined ? null : !!(acquisitionSample.flags & SampleFlag.CLOCK_STEP)},
            ${acquisitionSample?.meterRepeatSec ?? null}, ${poll.blocks},
            ${createHash('sha256').update(poll.blocks).digest()})
          ON CONFLICT ("runId", "seq") DO NOTHING RETURNING "id"`;
          if (raw.length === 0) {
            if (poll.sample) duplicateSamples++;
            continue;
          }
          if (poll.tier === 'FAST') {
            const ids = fastRaw.get(poll.deviceId) ?? [];
            ids.push(raw[0]!.id);
            fastRaw.set(poll.deviceId, ids);
          }
          const sample = poll.sample;
          if (poll.tier === 'FAST' && sample) {
            const row = await tx.$queryRaw<TimestampRow[]>(Prisma.sql`
            INSERT INTO "Sample" (
              "rawPollId", "deviceId", "observedAt", "mappingVersion", "meterLink",
              "gridW", "gridAW", "gridBW", "gridCW", "gridVoltA", "gridVoltB", "gridVoltC",
              "gridPortW", "inverterAcW", "epsW", "pvW", "pvStringW", "batteryW", "batteryBmsW",
              "batterySoc", "batteryState", "loadVendorW", "loadVendorTotalW", "pvWh", "gridBuyWh",
              "gridSellWh", "gridBuyPhaseWh", "gridSellPhaseWh", "batChargeWh", "batDischargeWh",
              "loadUseWh", "vendorToday", "meterRepeatSec", "flags"
            ) VALUES (
              ${raw[0]!.id}, ${poll.deviceId}, ${sample.observedAt}, ${sample.mappingVersion}, ${sample.meterLink},
              ${sample.gridW}, ${sample.gridAW}, ${sample.gridBW}, ${sample.gridCW}, ${sample.gridVoltA},
              ${sample.gridVoltB}, ${sample.gridVoltC}, ${sample.gridPortW}, ${sample.inverterAcW},
              ${sample.epsW}, ${sample.pvW}, ${intArray(sample.pvStringW)}, ${sample.batteryW},
              ${sample.batteryBmsW}, ${sample.batterySoc}, ${sample.batteryState}, ${sample.loadVendorW},
              ${sample.loadVendorTotalW}, ${sample.pvWh}, ${sample.gridBuyWh}, ${sample.gridSellWh},
              ${bigintArray(sample.gridBuyPhaseWh)}, ${bigintArray(sample.gridSellPhaseWh)}, ${sample.batChargeWh},
              ${sample.batDischargeWh}, ${sample.loadUseWh}, ${sample.vendorToday === null ? null : JSON.stringify(sample.vendorToday)}::jsonb,
              ${sample.meterRepeatSec}, ${sample.flags}
            ) ON CONFLICT ("deviceId", "observedAt") DO NOTHING RETURNING "id", "observedAt"`);
            if (row.length) {
              insertedSamples++;
              const rows = inserted.get(poll.deviceId) ?? [];
              rows.push(row[0]!);
              inserted.set(poll.deviceId, rows);
            } else duplicateSamples++;
          }
          for (const event of poll.events) {
            await tx.dataQualityEvent.create({
              data: {
                deviceId: poll.deviceId,
                kind: event.kind,
                startedAt: event.startedAt,
                endedAt: event.endedAt,
                details: event.details as Prisma.InputJsonObject,
              },
            });
          }
          await tx.$executeRaw`UPDATE "Device" SET "lastSeenAt" = GREATEST("lastSeenAt", ${poll.observedAt}) WHERE "id" = ${poll.deviceId}`;
        }
        if (insertedSamples > 0) {
          const allTimes = [...inserted.values()]
            .flat()
            .map((row) => row.observedAt);
          allTimes.sort((a, b) => a.getTime() - b.getTime());
          const first = allTimes[0]!;
          const last = allTimes[allTimes.length - 1]!;
          // Newly inserted timestamps all lie within [first, last], so neither outer
          // neighbor can be a row from this batch, even with multiple devices.
          const existing = await tx.$queryRaw<
            { before: Date | null; after: Date | null }[]
          >`
          SELECT
            (SELECT "observedAt" FROM "Sample" WHERE "observedAt" < ${first}
              ORDER BY "observedAt" DESC LIMIT 1) AS "before",
            (SELECT "observedAt" FROM "Sample" WHERE "observedAt" > ${last}
              ORDER BY "observedAt" ASC LIMIT 1) AS "after"`;
          await tx.ledgerDirtyRange.create({
            data: {
              fromBucket: floor5(existing[0]!.before ?? first),
              toBucket: existing[0]!.after
                ? ceil5(existing[0]!.after)
                : ceil5(last, true),
              reason: 'INGEST',
              createdAt: this.clock(),
            },
          });
        }
        for (const [deviceId, rawIds] of fastRaw) {
          const covered = new Set<bigint>();
          for (const rawId of rawIds) {
            if (covered.has(rawId)) continue;
            const run = await findMeterRepeatRun(
              tx,
              deviceId,
              rawId,
              opts.maxRepeatSpanSec,
            );
            for (const id of run.rawPollIds) covered.add(id);
            if (run.maxRepeatSec <= opts.maxRepeatSpanSec) continue;
            const changed = await tx.$queryRaw<TimestampRow[]>`
              UPDATE "Sample" SET "flags" = "flags" | ${SampleFlag.METER_STALE}
              WHERE "id" = ANY(${run.sampleIds}::bigint[])
                AND ("flags" & ${SampleFlag.METER_STALE}) = 0
              RETURNING "id", "observedAt"`;
            await dirtyAcquisitionSamples(tx, changed, this.clock());
          }
        }
        return { insertedSamples, duplicateSamples };
      },
      { timeout: 120_000 },
    );
  }
}
