import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { PrismaService } from '../db/prisma.service.js';
import { accountingInputError } from '../accounting/totals.service.js';
import {
  BUCKET_MS,
  COUNTER_WRAP_WH,
  type CounterKey,
  type CounterState,
  type CounterStates,
  type ExclusionWindow,
} from '../accounting/types.js';
import { integrateSeries } from '../accounting/integrate.js';
import {
  familyPowers,
  gridMeterCoveredSec,
  isExcluded,
} from '../accounting/families.js';
import { initialCounterStates, stepCounter } from '../accounting/counters.js';
import { SampleFlag } from '../collector/types.js';
import {
  Prisma,
  type MeterReading,
  type Sample,
} from '../generated/prisma/client.js';

export interface ReconciliationDirection {
  verdict: 'PASS' | 'FAIL' | 'INSUFFICIENT';
  utilityKwh: Decimal | null;
  oursKwh: Decimal | null;
  ratio: Decimal | null;
}
export interface ReconciliationCandidate {
  source: 'METER_NET' | 'METER_PER_PHASE' | 'INVERTER_COUNTER';
  coverage: Decimal;
  import: ReconciliationDirection;
  export: ReconciliationDirection;
}
export interface Reconciliation {
  fromReadingId: number;
  toReadingId: number;
  candidates: ReconciliationCandidate[];
  investigationPath: string[];
}
const investigationPath = [
  'Direction: check import/export signs per phase and meter fault 30029 bit 2; nighttime phase import with no PV is normal, nighttime export suggests a reversed CT.',
  'Constant ratio across windows: inspect CT ratio and meter scaling.',
  'Netting: compare METER_NET with METER_PER_PHASE directional energy.',
  'Placement: a load-correlated shortfall can indicate a circuit outside the CTs.',
  'Data: inspect coverage gaps and exclusions in the comparison window.',
];

type MeterSource = ReconciliationCandidate['source'];
interface CounterEndpoint {
  value: Decimal;
  segment: number;
  deviceId: number | null;
}
function acceptedCounter(
  samples: Sample[],
  key: 'gridBuyWh' | 'gridSellWh',
  at: number,
  counterKey: CounterKey,
  seed?: CounterState,
): CounterEndpoint | null {
  let state = seed ?? initialCounterStates()[counterKey];
  const accepted: Array<{
    t: number;
    value: number;
    segment: number;
    deviceId: number | null;
  }> = [];
  if (state.confirmed && state.last)
    accepted.push({
      t: state.last.tMs,
      value: state.last.v,
      segment: state.segment,
      deviceId: state.deviceId,
    });
  let wrapOffset = 0;
  for (const sample of samples) {
    const value = sample[key];
    if (value === null || sample.flags & SampleFlag.BLOCK_INVALID_2000)
      continue;
    const prior = state;
    const result = stepCounter(
      state,
      counterKey,
      {
        v: Number(value),
        tMs: sample.observedAt.getTime(),
        deviceId: sample.deviceId,
      },
      { maxGapSec: 30 },
    );
    state = result.state;
    if (state.segment !== prior.segment) wrapOffset = 0;
    if (result.accepted) {
      if (!prior.confirmed && prior.last)
        accepted.push({
          t: prior.last.tMs,
          value: prior.last.v + wrapOffset,
          segment: prior.segment,
          deviceId: prior.deviceId,
        });
      if (prior.last && Number(value) < prior.last.v)
        wrapOffset += COUNTER_WRAP_WH;
      accepted.push({
        t: sample.observedAt.getTime(),
        value: Number(value) + wrapOffset,
        segment: state.segment,
        deviceId: state.deviceId,
      });
    }
  }
  let left: (typeof accepted)[number] | undefined;
  let right: (typeof accepted)[number] | undefined;
  for (const reading of accepted) {
    if (reading.t <= at) left = reading;
    if (reading.t >= at) {
      right = reading;
      break;
    }
  }
  if (
    !left ||
    !right ||
    left.segment !== right.segment ||
    left.deviceId !== right.deviceId
  )
    return null;
  const value =
    left.t === right.t
      ? new Decimal(left.value)
      : new Decimal(left.value).plus(
          new Decimal(right.value - left.value)
            .times(at - left.t)
            .div(right.t - left.t),
        );
  return { value, segment: left.segment, deviceId: left.deviceId };
}
export function evaluateDirection(
  oursWh: Decimal | null,
  utilityKwh: Decimal | null,
  resolutionKwh: Decimal,
  coverage: Decimal,
  minimumKwh: number,
): ReconciliationDirection {
  const oursKwh = oursWh?.div(1000) ?? null;
  const ratio =
    utilityKwh?.gt(0) && oursKwh !== null ? oursKwh.div(utilityKwh) : null;
  const verdict =
    coverage.lt('0.99') ||
    utilityKwh === null ||
    utilityKwh.lt(minimumKwh) ||
    oursWh === null ||
    oursWh.lt(0)
      ? 'INSUFFICIENT'
      : oursKwh!
            .minus(utilityKwh)
            .abs()
            .lte(Decimal.max(utilityKwh.times('0.02'), resolutionKwh.times(2)))
        ? 'PASS'
        : 'FAIL';
  return { verdict, utilityKwh, oursKwh, ratio };
}

@Injectable()
export class ReconciliationService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async reconcile(
    fromReadingId: number,
    toReadingId: number,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<Reconciliation> {
    const [a, b] = await Promise.all([
      db.meterReading.findUnique({ where: { id: fromReadingId } }),
      db.meterReading.findUnique({ where: { id: toReadingId } }),
    ]);
    if (!a || !b || a.readAt >= b.readAt || a.source !== b.source)
      accountingInputError(
        'Readings must exist, share a source and be in time order',
      );
    return this.reconcileReadings(a, b, db);
  }

  private async reconcileReadings(
    a: MeterReading,
    b: MeterReading,
    db: Prisma.TransactionClient,
  ): Promise<Reconciliation> {
    const t1 = a.readAt.getTime(),
      t2 = b.readAt.getTime();
    const leftEnd = Math.ceil(t1 / BUCKET_MS) * BUCKET_MS;
    const rightStart = Math.floor(t2 / BUCKET_MS) * BUCKET_MS;
    const fullStart = leftEnd;
    const fullEnd = Math.max(leftEnd, rightStart);
    const baseline = await db.energyInterval.findFirst({
      where: {
        bucketStart: { lt: new Date(Math.floor(t1 / BUCKET_MS) * BUCKET_MS) },
        counterState: { not: Prisma.DbNull },
      },
      orderBy: { bucketStart: 'desc' },
      select: { bucketStart: true, counterState: true },
    });
    const seed = baseline?.counterState as unknown as CounterStates | null;
    const replayFrom = baseline
      ? baseline.bucketStart.getTime() + BUCKET_MS
      : -Infinity;
    // Endpoint reconstruction replays raw counter observations over [sampleFrom, sampleTo]
    // (everything from the first sample when no baseline exists), so exclusions must cover that
    // whole scope, not only the compared window.
    const sampleFrom = baseline
      ? Math.min(t1 - BUCKET_MS, replayFrom)
      : undefined;
    const sampleTo = t2 + BUCKET_MS;
    const [intervals, samples, policies, exclusions] = await Promise.all([
      db.energyInterval.findMany({
        where: {
          bucketStart: { gte: new Date(fullStart), lt: new Date(fullEnd) },
        },
        orderBy: { bucketStart: 'asc' },
      }),
      db.sample.findMany({
        where: {
          observedAt: {
            ...(sampleFrom === undefined ? {} : { gte: new Date(sampleFrom) }),
            lte: new Date(sampleTo),
          },
        },
        orderBy: { observedAt: 'asc' },
      }),
      db.accountingPolicy.findMany({
        where: { supersededByVersion: null, effectiveFrom: { lte: b.readAt } },
        orderBy: { effectiveFrom: 'asc' },
      }),
      db.dataExclusion.findMany({
        where: {
          from: { lte: new Date(sampleTo) },
          ...(sampleFrom === undefined
            ? {}
            : { to: { gt: new Date(sampleFrom) } }),
        },
      }),
    ]);
    const parts: Array<[number, number]> = [];
    if (t1 < Math.min(leftEnd, t2)) parts.push([t1, Math.min(leftEnd, t2)]);
    if (rightStart > t1 && rightStart < t2 && rightStart >= leftEnd)
      parts.push([rightStart, t2]);
    const maxGapAt = (time: number) => {
      for (let i = policies.length - 1; i >= 0; i--)
        if (policies[i]!.effectiveFrom.getTime() <= time)
          return policies[i]!.maxGapSec;
      return 30;
    };
    const sums: Record<
      MeterSource,
      {
        imp: Decimal;
        exp: Decimal;
        coveredImport: number;
        coveredExport: number;
      }
    > = {
      METER_NET: {
        imp: new Decimal(0),
        exp: new Decimal(0),
        coveredImport: 0,
        coveredExport: 0,
      },
      METER_PER_PHASE: {
        imp: new Decimal(0),
        exp: new Decimal(0),
        coveredImport: 0,
        coveredExport: 0,
      },
      INVERTER_COUNTER: {
        imp: new Decimal(0),
        exp: new Decimal(0),
        coveredImport: 0,
        coveredExport: 0,
      },
    };
    for (const row of intervals) {
      for (const [source, importField, exportField] of [
        ['METER_NET', 'gridImportNetWh', 'gridExportNetWh'],
        ['METER_PER_PHASE', 'gridImportPhaseWh', 'gridExportPhaseWh'],
        ['INVERTER_COUNTER', 'gridImportCounterWh', 'gridExportCounterWh'],
      ] as const) {
        const item = sums[source];
        if (row[importField] !== null) {
          item.imp = item.imp.plus(String(row[importField]));
          item.coveredImport +=
            source === 'INVERTER_COUNTER'
              ? 300 - (row.counterUnknownSec[1] ?? 300)
              : gridMeterCoveredSec(row, source);
        }
        if (row[exportField] !== null) {
          item.exp = item.exp.plus(String(row[exportField]));
          item.coveredExport +=
            source === 'INVERTER_COUNTER'
              ? 300 - (row.counterUnknownSec[2] ?? 300)
              : gridMeterCoveredSec(row, source);
        }
      }
    }
    const edgeEnergy = (
      source: 'METER_NET' | 'METER_PER_PHASE',
      lo: number,
      hi: number,
    ) => {
      const near = samples.filter(
        (s) =>
          s.observedAt.getTime() >= lo - BUCKET_MS &&
          s.observedAt.getTime() <= hi + BUCKET_MS,
      );
      const streams = source === 'METER_NET' ? [0] : [0, 1, 2];
      let pos = 0,
        neg = 0,
        covered = 0;
      for (const phase of streams) {
        const points = near.map((sample) => {
          const powers = familyPowers({
            tMs: sample.observedAt.getTime(),
            mappingVersion: sample.mappingVersion,
            deviceId: sample.deviceId,
            flags: sample.flags,
            gridW: sample.gridW,
            gridAW: sample.gridAW,
            gridBW: sample.gridBW,
            gridCW: sample.gridCW,
            pvW: sample.pvW,
            // Battery is not read by edge reconciliation.
            batteryPowerSource: 'BAT1_POWER_G3_50',
            batteryW: sample.batteryW,
            inverterAcW: sample.inverterAcW,
            epsW: sample.epsW,
            batterySoc: sample.batterySoc,
            counters: {
              PV: sample.pvWh === null ? null : Number(sample.pvWh),
              GRID_BUY:
                sample.gridBuyWh === null ? null : Number(sample.gridBuyWh),
              GRID_SELL:
                sample.gridSellWh === null ? null : Number(sample.gridSellWh),
              BAT_CHARGE:
                sample.batChargeWh === null ? null : Number(sample.batChargeWh),
              BAT_DISCHARGE:
                sample.batDischargeWh === null
                  ? null
                  : Number(sample.batDischargeWh),
              LOAD_USE:
                sample.loadUseWh === null ? null : Number(sample.loadUseWh),
            },
          });
          return {
            tMs: sample.observedAt.getTime(),
            w:
              source === 'METER_NET'
                ? powers.grid.net
                : (powers.grid.phases?.[phase] ?? null),
          };
        });
        const integrated = integrateSeries(points, {
          fromMs: lo,
          toMs: hi,
          maxGapSec: maxGapAt(lo),
          excluded: (x, y) =>
            exclusions.some(
              (e) =>
                (e.families.includes('GRID') || e.families.includes('ALL')) &&
                e.from.getTime() < y &&
                e.to.getTime() > x,
            ),
        });
        for (const result of integrated.values()) {
          pos += result.posWh;
          neg += result.negWh;
          if (phase === 0) covered += result.coveredSec;
        }
      }
      return { pos, neg, covered };
    };
    for (const [lo, hi] of parts)
      for (const source of ['METER_NET', 'METER_PER_PHASE'] as const) {
        const edge = edgeEnergy(source, lo, hi);
        sums[source].imp = sums[source].imp.plus(edge.pos);
        sums[source].exp = sums[source].exp.plus(edge.neg);
        sums[source].coveredImport += edge.covered;
        sums[source].coveredExport += edge.covered;
      }
    // Same counter rule as the ledger: an observation inside [from, to) of a GRID/ALL exclusion
    // never reaches the counter state machine. Seed state is valid as persisted and is kept.
    const gridExclusions: ExclusionWindow[] = exclusions
      .filter((e) => e.families.includes('GRID') || e.families.includes('ALL'))
      .map((e) => ({
        fromMs: e.from.getTime(),
        toMs: e.to.getTime(),
        families: ['GRID'],
      }));
    const replay = samples.filter((sample) => {
      const tMs = sample.observedAt.getTime();
      return (
        tMs >= replayFrom && !isExcluded('GRID', tMs, tMs + 1, gridExclusions)
      );
    });
    const buy1 = acceptedCounter(
      replay,
      'gridBuyWh',
      t1,
      'GRID_BUY',
      seed?.GRID_BUY,
    );
    const buy2 = acceptedCounter(
      replay,
      'gridBuyWh',
      t2,
      'GRID_BUY',
      seed?.GRID_BUY,
    );
    const sell1 = acceptedCounter(
      replay,
      'gridSellWh',
      t1,
      'GRID_SELL',
      seed?.GRID_SELL,
    );
    const sell2 = acceptedCounter(
      replay,
      'gridSellWh',
      t2,
      'GRID_SELL',
      seed?.GRID_SELL,
    );
    // A grid exclusion inside the compared window leaves no valid counter delta at all.
    const excluded = exclusions.some(
      (window) =>
        (window.families.includes('GRID') || window.families.includes('ALL')) &&
        window.from < b.readAt &&
        window.to > a.readAt,
    );
    const edgeSeconds = parts.reduce(
      (seconds, [lo, hi]) => seconds + (hi - lo) / 1000,
      0,
    );
    const sameSegment = (
      left: CounterEndpoint | null,
      right: CounterEndpoint | null,
    ) =>
      left &&
      right &&
      left.segment === right.segment &&
      left.deviceId === right.deviceId;
    // The endpoint delta is exact only inside one accepted segment and without excluded data;
    // ledger coverage is still authoritative over every full bucket in between.
    if (!excluded && sameSegment(buy1, buy2)) {
      sums.INVERTER_COUNTER.imp = buy2!.value.minus(buy1!.value);
      sums.INVERTER_COUNTER.coveredImport += edgeSeconds;
    } else sums.INVERTER_COUNTER.coveredImport = 0;
    if (!excluded && sameSegment(sell1, sell2)) {
      sums.INVERTER_COUNTER.exp = sell2!.value.minus(sell1!.value);
      sums.INVERTER_COUNTER.coveredExport += edgeSeconds;
    } else sums.INVERTER_COUNTER.coveredExport = 0;
    const utilityImport = new Decimal(b.importKwh.toString()).minus(
      a.importKwh.toString(),
    );
    const utilityExport =
      a.exportKwh !== null && b.exportKwh !== null
        ? new Decimal(b.exportKwh.toString()).minus(a.exportKwh.toString())
        : null;
    const resolution = Decimal.max(
      a.resolutionKwh.toString(),
      b.resolutionKwh.toString(),
    );
    const candidates = (
      Object.entries(sums) as Array<[MeterSource, (typeof sums)[MeterSource]]>
    ).map(([source, s]) => {
      const importCoverage = new Decimal(
        Math.min(1, s.coveredImport / ((t2 - t1) / 1000)),
      );
      const exportCoverage = new Decimal(
        Math.min(1, s.coveredExport / ((t2 - t1) / 1000)),
      );
      const coverage = Decimal.min(importCoverage, exportCoverage);
      return {
        source,
        coverage,
        import: evaluateDirection(
          source === 'INVERTER_COUNTER' && !s.coveredImport ? null : s.imp,
          utilityImport,
          resolution,
          importCoverage,
          50,
        ),
        export: evaluateDirection(
          source === 'INVERTER_COUNTER' && !s.coveredExport ? null : s.exp,
          utilityExport,
          resolution,
          exportCoverage,
          20,
        ),
      };
    });
    return {
      fromReadingId: a.id,
      toReadingId: b.id,
      candidates,
      investigationPath,
    };
  }

  async accountingStatus(
    gridSource: string,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<'RECONCILED' | 'RECONCILIATION_FAILED' | 'UNRECONCILED'> {
    // Materialize one coherent endpoint pair; later deletion cannot invalidate this snapshot.
    const [latest, previous] = await db.meterReading.findMany({
      where: { source: 'UTILITY_METER_MANUAL' },
      orderBy: { readAt: 'desc' },
      take: 2,
    });
    if (!latest || !previous) return 'UNRECONCILED';
    const result = await this.reconcileReadings(previous, latest, db);
    const candidate = result.candidates.find(
      (item) => item.source === gridSource,
    );
    if (
      candidate?.import.verdict === 'FAIL' ||
      candidate?.export.verdict === 'FAIL'
    )
      return 'RECONCILIATION_FAILED';
    return candidate?.import.verdict === 'PASS' ? 'RECONCILED' : 'UNRECONCILED';
  }
}
