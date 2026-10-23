import { Inject, Injectable } from '@nestjs/common';
import {
  initialRepeatState,
  meterWordsHash,
  normalizeFast,
  type RepeatState,
} from '../collector/normalize.js';
import { validateMappingConfig } from '../collector/mapping.js';
import { SampleFlag } from '../collector/types.js';
import {
  dirtyAcquisitionSamples,
  findMeterRepeatRun,
} from '../collector/ingest.service.js';
import { PrismaService } from '../db/prisma.service.js';
import { decodeBlocksBuffer } from '../modbus/raw-poll-codec.js';
import { WordMap } from '../modbus/decode.js';
import { Prisma, type MappingVersion } from '../generated/prisma/client.js';

export const RENORMALIZER = Symbol('RENORMALIZER');
export interface Renormalizer {
  renormalize(
    fromMs: number,
    toMs: number,
    mappingVersion: MappingVersion,
    tx?: Prisma.TransactionClient,
  ): Promise<void>;
}

const PAGE_SIZE = 1000;

/** The device's replay chain: where acquisition-time repeat and clock state continues from. */
interface Chain {
  runId: number;
  /** Null when the last replayed poll predates the persisted monotonic clock. */
  monotonicMs: number | null;
  state: RepeatState;
}

/**
 * Rebuilds `Sample` rows from retained FAST raw polls.
 *
 * Acquisition-time clock validity is a fact of the original acquisition that a replay must never
 * loosen, so polls are replayed per device in acquisition order (collector run, then sequence)
 * on the monotonic clock persisted in `RawPoll.monotonicMs`. Monotonic clocks of different collector
 * runs are unrelated, so every run starts a fresh chain. Wall time is never used to derive
 * elapsed time.
 *
 * Every immutable acquisition duration is authoritative, including across interior retention holes.
 * Legacy rows without durable timing preserve their surviving Sample duration; absent legacy
 * Samples are rebuilt clock-invalid rather than deriving elapsed time from their wall timestamps.
 * Acquisition and surviving Sample CLOCK_STEP facts are never loosened.
 */
@Injectable()
export class RawPollRenormalizer implements Renormalizer {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  /**
   * Upgrade acquisition validity without remapping historical values. Run before ledger upgrades:
   * recomputing already-corrupt Samples cannot recover raw-only stale evidence or lost repeat ages.
   * Only retained immutable evidence is repaired; opaque legacy rows remain unchanged.
   */
  async repairAcquisitionValidity(
    fromMs: number,
    toMs: number,
    tx?: Prisma.TransactionClient,
  ): Promise<{
    changedSamples: number;
    dirtyFrom: Date | null;
    dirtyTo: Date | null;
  }> {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || fromMs >= toMs)
      throw new RangeError('Invalid acquisition repair range');
    if (tx === undefined)
      return this.prisma.$transaction(
        (transaction) =>
          this.repairAcquisitionValidity(fromMs, toMs, transaction),
        { timeout: 3_600_000 },
      );
    const thresholds = new Map<number, number>();
    const runs = new Map<number, Map<bigint, number>>();
    const changed: { id: bigint; observedAt: Date }[] = [];
    let cursor: bigint | undefined;
    for (;;) {
      const samples = await tx.sample.findMany({
        where: {
          observedAt: { gte: new Date(fromMs), lt: new Date(toMs) },
          ...(cursor === undefined ? {} : { id: { gt: cursor } }),
        },
        include: { rawPoll: true },
        orderBy: { id: 'asc' },
        take: PAGE_SIZE,
      });
      if (samples.length === 0) break;
      cursor = samples[samples.length - 1]!.id;
      // Sample ids need not follow acquisition order. Only exact neighbouring sequence
      // identities already present in this page can prove a one-observation repeat run.
      const pageRuns = new Map<
        number,
        Map<number, (typeof samples)[number]['rawPoll']>
      >();
      for (const { rawPoll } of samples) {
        if (
          rawPoll.tier !== 'FAST' ||
          rawPoll.acquisitionMeterRepeatSec === null
        )
          continue;
        let run = pageRuns.get(rawPoll.runId);
        if (run === undefined) {
          run = new Map();
          pageRuns.set(rawPoll.runId, run);
        }
        run.set(rawPoll.seq, rawPoll);
      }
      const hashes = new Map<bigint, string | null>();
      const hash = (
        raw: (typeof samples)[number]['rawPoll'],
      ): string | null => {
        if (!hashes.has(raw.id))
          hashes.set(
            raw.id,
            meterWordsHash(
              new WordMap(decodeBlocksBuffer(Buffer.from(raw.blocks))),
            ),
          );
        return hashes.get(raw.id)!;
      };
      for (const sample of samples) {
        const raw = sample.rawPoll;
        if (
          raw.tier !== 'FAST' ||
          (raw.acquisitionMeterRepeatSec === null &&
            raw.acquisitionClockStep === null)
        )
          continue;
        const meterRepeatSec =
          raw.acquisitionMeterRepeatSec ?? sample.meterRepeatSec;
        let additionalFlags =
          raw.acquisitionClockStep === true ? SampleFlag.CLOCK_STEP : 0;
        if (raw.acquisitionMeterRepeatSec !== null) {
          let threshold = thresholds.get(sample.mappingVersion);
          if (threshold === undefined) {
            const version = await tx.mappingVersion.findUniqueOrThrow({
              where: { version: sample.mappingVersion },
            });
            threshold = validateMappingConfig(version.config).maxRepeatSpanSec;
            thresholds.set(sample.mappingVersion, threshold);
          }
          const cached = runs.get(threshold) ?? new Map<bigint, number>();
          runs.set(threshold, cached);
          let maxRepeat = cached.get(raw.id);
          if (maxRepeat === undefined) {
            const page = pageRuns.get(raw.runId);
            const before = page?.get(raw.seq - 1);
            const after = page?.get(raw.seq + 1);
            // Durable age already proves staleness. A NULL meter hash cannot belong
            // to a valid repeat run; otherwise both immediate acquisition neighbours
            // must prove a hash change. Missing/raw-only/interleaved rows fall back.
            const ownHash = meterRepeatSec > threshold ? undefined : hash(raw);
            if (
              meterRepeatSec > threshold ||
              ownHash === null ||
              (before?.deviceId === raw.deviceId &&
                after?.deviceId === raw.deviceId &&
                hash(before) !== ownHash &&
                hash(after) !== ownHash)
            ) {
              maxRepeat = meterRepeatSec;
            } else {
              const run = await findMeterRepeatRun(
                tx,
                sample.deviceId,
                raw.id,
                threshold,
                threshold,
              );
              maxRepeat = run.maxRepeatSec;
              for (const id of run.rawPollIds) cached.set(id, maxRepeat);
            }
          }
          if (Math.max(meterRepeatSec, maxRepeat) > threshold)
            additionalFlags |= SampleFlag.METER_STALE;
        }
        if (
          (additionalFlags & ~sample.flags) === 0 &&
          meterRepeatSec === sample.meterRepeatSec
        )
          continue;
        // Live ingest may mark this Sample stale after our run lookup. Merge additions against
        // the current database flags atomically; never write the earlier read snapshot back.
        const repaired = await tx.$queryRaw<{ id: bigint; observedAt: Date }[]>`
          UPDATE "Sample"
          SET "flags" = "flags" | ${additionalFlags}, "meterRepeatSec" = ${meterRepeatSec}
          WHERE "id" = ${sample.id}
            AND (("flags" & ${additionalFlags}) <> ${additionalFlags}
              OR "meterRepeatSec" <> ${meterRepeatSec})
          RETURNING "id", "observedAt"`;
        changed.push(...repaired);
      }
    }
    return {
      changedSamples: changed.length,
      ...(await dirtyAcquisitionSamples(tx, changed)),
    };
  }

  async renormalize(
    fromMs: number,
    toMs: number,
    mappingVersion: MappingVersion,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    // Replay retained device histories in bounded pages: repeat detection needs the
    // preceding meter hash and first-seen time, even across a requested range edge.
    const mapping = validateMappingConfig(mappingVersion.config);
    const database = tx ?? this.prisma;
    const from = new Date(fromMs);
    const to = new Date(toMs);
    const chains = new Map<number, Chain>();
    const originalThresholds = new Map<number, number>();
    const repeatCandidates: { deviceId: number; rawPollId: bigint }[] = [];
    // Flags every not-yet-stale member of a repeated run that lies inside the replay range.
    const markStale = (sampleIds: bigint[]) =>
      database.$executeRaw`
        UPDATE "Sample" SET "flags" = "flags" | ${SampleFlag.METER_STALE}
        WHERE "id" = ANY(${sampleIds}::bigint[])
          AND "observedAt" >= ${from}
          AND "observedAt" < ${to}
          AND ("flags" & ${SampleFlag.METER_STALE}) = 0`;
    // A backward wall step can put an acquisition predecessor beyond `to`: filtering every
    // poll by wall time would skip it and reset repeat/clock state incorrectly. Find the last
    // relevant acquisition in each run, then replay all of its retained predecessors.
    const runEnds = await database.rawPoll.groupBy({
      by: ['deviceId', 'runId'],
      where: { tier: 'FAST', observedAt: { lt: to } },
      _max: { seq: true },
      orderBy: [{ deviceId: 'asc' }, { runId: 'asc' }],
    });
    for (const end of runEnds) {
      let seq: number | undefined;
      for (;;) {
        const polls = await database.rawPoll.findMany({
          where: {
            deviceId: end.deviceId,
            runId: end.runId,
            tier: 'FAST',
            seq: {
              ...(seq === undefined ? {} : { gt: seq }),
              lte: end._max.seq!,
            },
          },
          orderBy: { seq: 'asc' },
          take: PAGE_SIZE,
        });
        if (polls.length === 0) break;
        seq = polls[polls.length - 1]!.seq;
        const storedByPoll = new Map(
          (
            await database.sample.findMany({
              where: { rawPollId: { in: polls.map((poll) => poll.id) } },
              select: {
                id: true,
                rawPollId: true,
                flags: true,
                meterRepeatSec: true,
                mappingVersion: true,
              },
            })
          ).map((row) => [row.rawPollId, row]),
        );
        for (const poll of polls) {
          const stored = storedByPoll.get(poll.id);
          const previous = chains.get(poll.deviceId);
          const continues =
            previous !== undefined &&
            previous.runId === poll.runId &&
            previous.monotonicMs !== null &&
            poll.monotonicMs !== null;
          const normalized = normalizeFast({
            blocks: decodeBlocksBuffer(Buffer.from(poll.blocks)),
            observedAt: poll.observedAt,
            // A poll without a persisted clock starts its own chain, so this origin only anchors the
            // recorded repeat duration; it never measures elapsed time.
            monotonicMs: poll.monotonicMs ?? 0,
            mapping,
            mappingVersion: mappingVersion.version,
            state: continues ? previous.state : initialRepeatState(),
            recordedMeterRepeatSec:
              poll.acquisitionMeterRepeatSec ??
              (!continues ? (stored?.meterRepeatSec ?? 0) : undefined),
          });
          chains.set(poll.deviceId, {
            runId: poll.runId,
            monotonicMs: poll.monotonicMs,
            state: normalized.state,
          });
          if (
            poll.observedAt.getTime() < fromMs ||
            poll.observedAt.getTime() >= toMs
          )
            continue;
          const sample = normalized.sample;
          // Acquisition facts survive both sample retention and raw predecessor retention.
          // Without either a surviving sample or durable timing, legacy reconstruction is unknown.
          const timingUnknown =
            stored === undefined &&
            poll.acquisitionClockStep === null &&
            (poll.monotonicMs === null || !continues);
          let flags =
            (sample.flags & ~SampleFlag.CLOCK_STEP) |
            (timingUnknown ||
            (poll.acquisitionClockStep ??
              !!(sample.flags & SampleFlag.CLOCK_STEP)) ||
            (stored?.flags ?? 0) & SampleFlag.CLOCK_STEP
              ? SampleFlag.CLOCK_STEP
              : 0);
          // A pruned raw-only trigger cannot disprove a surviving stale verdict. Only an
          // explicitly higher replay threshold may intentionally loosen that historical verdict.
          if (stored !== undefined && stored.flags & SampleFlag.METER_STALE) {
            let originalThreshold = originalThresholds.get(
              stored.mappingVersion,
            );
            if (originalThreshold === undefined) {
              originalThreshold = validateMappingConfig(
                (
                  await database.mappingVersion.findUniqueOrThrow({
                    where: { version: stored.mappingVersion },
                  })
                ).config,
              ).maxRepeatSpanSec;
              originalThresholds.set(stored.mappingVersion, originalThreshold);
            }
            if (mapping.maxRepeatSpanSec <= originalThreshold)
              flags |= SampleFlag.METER_STALE;
          }
          const data = {
            mappingVersion: mappingVersion.version,
            meterLink: sample.meterLink,
            gridW: sample.gridW,
            gridAW: sample.gridAW,
            gridBW: sample.gridBW,
            gridCW: sample.gridCW,
            gridVoltA: sample.gridVoltA,
            gridVoltB: sample.gridVoltB,
            gridVoltC: sample.gridVoltC,
            gridPortW: sample.gridPortW,
            inverterAcW: sample.inverterAcW,
            epsW: sample.epsW,
            pvW: sample.pvW,
            pvStringW: sample.pvStringW,
            batteryW: sample.batteryW,
            batteryBmsW: sample.batteryBmsW,
            batterySoc: sample.batterySoc,
            batteryState: sample.batteryState,
            loadVendorW: sample.loadVendorW,
            loadVendorTotalW: sample.loadVendorTotalW,
            pvWh: sample.pvWh,
            gridBuyWh: sample.gridBuyWh,
            gridSellWh: sample.gridSellWh,
            gridBuyPhaseWh: sample.gridBuyPhaseWh,
            gridSellPhaseWh: sample.gridSellPhaseWh,
            batChargeWh: sample.batChargeWh,
            batDischargeWh: sample.batDischargeWh,
            loadUseWh: sample.loadUseWh,
            vendorToday:
              sample.vendorToday === null ? Prisma.DbNull : sample.vendorToday,
            meterRepeatSec: sample.meterRepeatSec,
            flags,
          };
          if (stored !== undefined) {
            await database.sample.update({ where: { id: stored.id }, data });
          } else {
            // The instant may already belong to another poll (a stepped wall clock repeats
            // instants); that sample is a different acquisition and is never overwritten.
            const occupied = await database.sample.findUnique({
              where: {
                deviceId_observedAt: {
                  deviceId: poll.deviceId,
                  observedAt: poll.observedAt,
                },
              },
              select: { id: true },
            });
            if (occupied === null)
              await database.sample.create({
                data: {
                  ...data,
                  rawPollId: poll.id,
                  deviceId: poll.deviceId,
                  observedAt: poll.observedAt,
                },
              });
          }
          if (!(flags & SampleFlag.BLOCK_INVALID_1800))
            repeatCandidates.push({
              deviceId: poll.deviceId,
              rawPollId: poll.id,
            });
        }
      }
    }
    // Raw acquisition identity also covers collision polls with no Sample. The run lookup walks
    // beyond either range edge and through raw-only evidence; only in-range Samples are changed.
    const covered = new Set<bigint>();
    for (const crossing of repeatCandidates) {
      if (covered.has(crossing.rawPollId)) continue;
      const run = await findMeterRepeatRun(
        database,
        crossing.deviceId,
        crossing.rawPollId,
        mapping.maxRepeatSpanSec,
      );
      for (const id of run.rawPollIds) covered.add(id);
      if (run.maxRepeatSec > mapping.maxRepeatSpanSec)
        await markStale(run.sampleIds);
    }
  }
}
