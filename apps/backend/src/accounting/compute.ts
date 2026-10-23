import { DateTime } from 'luxon';
import { SampleFlag } from '../collector/types.js';
import { initialCounterStates, stepCounter } from './counters.js';
import { familyPowers, isExcluded } from './families.js';
import { integrateSeries } from './integrate.js';
import type { BucketIntegral } from './integrate.js';
import { BUCKET_MS, COUNTER_KEYS, floorBucketMs, LedgerFlag } from './types.js';
import type {
  ComputeInput,
  ComputeOutput,
  CounterKey,
  CounterStates,
  ExclusionFamily,
  IntervalRow,
  LedgerEvent,
} from './types.js';

type CounterColumn =
  | 'pvCounterWh'
  | 'gridImportCounterWh'
  | 'gridExportCounterWh'
  | 'batChargeCounterWh'
  | 'batDischargeCounterWh'
  | 'loadCounterWh';
const counterColumns: Record<CounterKey, CounterColumn> = {
  PV: 'pvCounterWh',
  GRID_BUY: 'gridImportCounterWh',
  GRID_SELL: 'gridExportCounterWh',
  BAT_CHARGE: 'batChargeCounterWh',
  BAT_DISCHARGE: 'batDischargeCounterWh',
  LOAD_USE: 'loadCounterWh',
};
const counterFamilies: Record<CounterKey, ExclusionFamily> = {
  PV: 'PV',
  GRID_BUY: 'GRID',
  GRID_SELL: 'GRID',
  BAT_CHARGE: 'BATTERY',
  BAT_DISCHARGE: 'BATTERY',
  LOAD_USE: 'LOAD',
};
const eventFlags: Record<LedgerEvent['kind'], number> = {
  COUNTER_RESET: LedgerFlag.COUNTER_RESET,
  COUNTER_JUMP_REJECTED: LedgerFlag.COUNTER_JUMP_REJECTED,
  COUNTER_DISCONTINUITY: LedgerFlag.COUNTER_DISCONTINUITY,
};

export function computeRange(input: ComputeInput): ComputeOutput {
  const rows = new Map<number, IntervalRow>();
  const counterCoveredSec = new Map<number, number[]>();
  const cloneStates = (states: CounterStates): CounterStates =>
    Object.fromEntries(
      COUNTER_KEYS.map((key) => [
        key,
        {
          ...states[key],
          last: states[key].last ? { ...states[key].last } : null,
          pending: states[key].pending.map((reading) => ({ ...reading })),
        },
      ]),
    ) as CounterStates;
  const states = cloneStates(input.counterStates ?? initialCounterStates());
  const mappingAt = (bucketEndMs: number): number => {
    // Last original observation before the bucket end, including the integration seed.
    // Counter-only buckets keep the preceding mapping, not a later replay's newest one.
    let low = 0;
    let high = input.samples.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (input.samples[middle]!.tMs < bucketEndMs) low = middle + 1;
      else high = middle;
    }
    return input.samples[Math.max(0, low - 1)]!.mappingVersion;
  };
  const rowAt = (at: number): IntervalRow => {
    const start = floorBucketMs(at);
    let row = rows.get(start);
    if (!row) {
      row = {
        bucketStartMs: start,
        mappingVersion: mappingAt(start + BUCKET_MS),
        gridImportNetWh: null,
        gridExportNetWh: null,
        gridImportPhaseWh: null,
        gridExportPhaseWh: null,
        gridImportCounterWh: null,
        gridExportCounterWh: null,
        pvIntWh: null,
        pvCounterWh: null,
        batChargeIntWh: null,
        batDischargeIntWh: null,
        batChargeCounterWh: null,
        batDischargeCounterWh: null,
        loadDerivedWh: null,
        loadCounterWh: null,
        gridCoveredSec: 0,
        pvCoveredSec: 0,
        batCoveredSec: 0,
        socCoveredSec: 0,
        loadCoveredSec: 0,
        counterUnknownSec: COUNTER_KEYS.map(() => 0),
        counterGapAllocMask: 0,
        flags: 0,
        counterState: cloneStates(states),
        gridAvgW: null,
        gridMinW: null,
        gridMaxW: null,
        pvAvgW: null,
        pvMaxW: null,
        batAvgW: null,
        loadAvgW: null,
        loadMaxW: null,
        socMin: null,
        socMax: null,
        socLast: null,
      };
      rows.set(start, row);
    }
    return row;
  };
  const powers = input.samples.map(familyPowers);
  const powerExcluded = (
    family: ExclusionFamily,
    a: number,
    b: number,
  ): boolean =>
    isExcluded(family, a, b, input.exclusions) ||
    (family === 'LOAD' && isExcluded('GRID', a, b, input.exclusions));
  const integrate = (
    family: ExclusionFamily,
    values: readonly (number | null)[],
  ) =>
    integrateSeries(
      input.samples.map((sample, i) => ({
        tMs: sample.tMs,
        w: powerExcluded(family, sample.tMs, sample.tMs + 1) ? null : values[i],
      })),
      {
        fromMs: input.fromMs,
        toMs: input.toMs,
        maxGapSec: input.maxGapSec,
        excluded: (a, b) => powerExcluded(family, a, b),
      },
    );
  const grid = integrate(
    'GRID',
    powers.map((p) => p.grid.net),
  );
  const phases = [0, 1, 2].map((i) =>
    integrate(
      'GRID',
      powers.map((p) => p.grid.phases?.[i] ?? null),
    ),
  );
  const pv = integrate(
    'PV',
    powers.map((p) => p.pv),
  );
  const battery = integrate(
    'BATTERY',
    powers.map((p) => p.battery),
  );
  const load = integrate(
    'LOAD',
    powers.map((p) => p.load),
  );
  const stats = (
    row: IntervalRow,
    value: BucketIntegral | undefined,
    family: 'grid' | 'pv' | 'bat' | 'load',
  ) => {
    if (!value || !value.n) return;
    const avg = Math.round(value.sumW / value.n);
    if (family === 'grid') {
      row.gridAvgW = avg;
      row.gridMinW = value.minW;
      row.gridMaxW = value.maxW;
    } else if (family === 'pv') {
      row.pvAvgW = avg;
      row.pvMaxW = value.maxW;
    } else if (family === 'bat') row.batAvgW = avg;
    else {
      row.loadAvgW = avg;
      row.loadMaxW = value.maxW;
    }
  };
  for (const [start, value] of grid) {
    const row = rowAt(start);
    if (value.coveredSec) {
      row.gridImportNetWh = value.posWh;
      row.gridExportNetWh = value.negWh;
      row.gridCoveredSec = value.coveredSec;
    }
    if (value.gap) row.flags |= LedgerFlag.GRID_GAP;
    stats(row, value, 'grid');
  }
  for (const phase of phases) {
    for (const [start, value] of phase) {
      const row = rowAt(start);
      if (value.coveredSec) {
        row.gridImportPhaseWh = (row.gridImportPhaseWh ?? 0) + value.posWh;
        row.gridExportPhaseWh = (row.gridExportPhaseWh ?? 0) + value.negWh;
      }
      if (value.gap) row.flags |= LedgerFlag.GRID_GAP;
    }
  }
  for (const [start, value] of pv) {
    const row = rowAt(start);
    if (value.coveredSec) {
      row.pvIntWh = value.posWh;
      row.pvCoveredSec = value.coveredSec;
    }
    if (value.gap) row.flags |= LedgerFlag.PV_GAP;
    stats(row, value, 'pv');
  }
  for (const [start, value] of battery) {
    const row = rowAt(start);
    if (value.coveredSec) {
      row.batDischargeIntWh = value.posWh;
      row.batChargeIntWh = value.negWh;
      row.batCoveredSec = value.coveredSec;
    }
    if (value.gap) row.flags |= LedgerFlag.BAT_GAP;
    stats(row, value, 'bat');
  }
  for (const [start, value] of load) {
    const row = rowAt(start);
    if (value.coveredSec) {
      row.loadDerivedWh = value.signedWh;
      row.loadCoveredSec = value.coveredSec;
    }
    if (value.gap) row.flags |= LedgerFlag.LOAD_GAP;
    stats(row, value, 'load');
  }
  let lastSocSlot: number | null = null;
  for (let i = 0; i < input.samples.length; i++) {
    const sample = input.samples[i];
    if (
      sample.tMs < input.fromMs ||
      sample.tMs >= input.toMs ||
      sample.batterySoc === null ||
      // battery_soc (1909) is read in block 1800, like the BMS power register.
      sample.flags & (SampleFlag.BLOCK_INVALID_1800 | SampleFlag.CLOCK_STEP) ||
      isExcluded('BATTERY', sample.tMs, sample.tMs + 1, input.exclusions)
    )
      continue;
    const row = rowAt(sample.tMs);
    const slot = Math.floor(sample.tMs / 10_000) * 10_000;
    if (slot !== lastSocSlot) {
      row.socCoveredSec += 10;
      lastSocSlot = slot;
    }
    row.socMin = Math.min(row.socMin ?? sample.batterySoc, sample.batterySoc);
    row.socMax = Math.max(row.socMax ?? sample.batterySoc, sample.batterySoc);
    row.socLast = sample.batterySoc;
  }

  let writeFromMs = input.fromMs;
  const events: LedgerEvent[] = [];
  const boundaries = [...new Set([0, ...input.touBoundaryMinutes])];
  const crossesBoundary = (fromMs: number, toMs: number): boolean => {
    let day = DateTime.fromMillis(fromMs, { zone: input.timeZone }).startOf(
      'day',
    );
    while (day.toMillis() <= toMs) {
      for (const minute of boundaries) {
        const hour = Math.floor(minute / 60);
        const localMinute = minute % 60;
        const wallTime = day.set({ hour, minute: localMinute });
        if (wallTime.hour !== hour || wallTime.minute !== localMinute) continue;
        for (const candidate of wallTime.getPossibleOffsets()) {
          const at = candidate.toMillis();
          if (at > fromMs && at <= toMs) return true;
        }
      }
      day = day.plus({ days: 1 });
    }
    return false;
  };
  const visitSpan = (
    fromMs: number,
    toMs: number,
    callback?: (row: IntervalRow, seconds: number) => void,
  ) => {
    if (fromMs < input.fromMs)
      writeFromMs = Math.min(writeFromMs, floorBucketMs(fromMs));
    const start = Math.max(fromMs, input.fromMs);
    const end = Math.min(toMs, input.toMs);
    for (let at = start; at < end;) {
      const next = Math.min(end, floorBucketMs(at) + BUCKET_MS);
      const row = rowAt(at);
      callback?.(row, (next - at) / 1000);
      at = next;
    }
  };
  const allocateAccepted = (
    key: CounterKey,
    index: number,
    accepted: {
      fromMs: number;
      toMs: number;
      deltaWh: number;
      gapAllocated: boolean;
    },
  ) => {
    const { fromMs, toMs, deltaWh, gapAllocated } = accepted;
    const family = counterFamilies[key];
    // Even across excluded time the validated reading becomes the confirmed baseline.
    if (isExcluded(family, fromMs, toMs, input.exclusions)) {
      visitSpan(fromMs, toMs);
      return;
    }
    const uncertain = gapAllocated && crossesBoundary(fromMs, toMs);
    visitSpan(fromMs, toMs, (row, seconds) => {
      const column = counterColumns[key];
      let covered = counterCoveredSec.get(row.bucketStartMs);
      if (!covered) {
        covered = COUNTER_KEYS.map(() => 0);
        counterCoveredSec.set(row.bucketStartMs, covered);
      }
      covered[index] += seconds;
      row[column] =
        (row[column] ?? 0) + (deltaWh * seconds * 1000) / (toMs - fromMs);
      if (gapAllocated) {
        row.counterGapAllocMask |= 1 << index;
        row.flags |= LedgerFlag.COUNTER_GAP_ALLOCATED;
        if (uncertain) row.flags |= LedgerFlag.TOU_UNCERTAIN;
      }
    });
  };
  // A widened writeFromMs signals the worker to re-run with full samples and the state before
  // that widened boundary; this invocation only has guaranteed integration seeds for input.fromMs.
  const snapshots: { tMs: number; state: CounterStates }[] = [];
  for (const sample of input.samples) {
    if (sample.tMs < input.fromMs || sample.tMs >= input.toMs) continue;
    rowAt(sample.tMs);
    for (const [index, key] of COUNTER_KEYS.entries()) {
      const v = sample.counters[key];
      if (v === null || sample.flags & SampleFlag.BLOCK_INVALID_2000) continue;
      const family = counterFamilies[key];
      if (isExcluded(family, sample.tMs, sample.tMs + 1, input.exclusions))
        continue;
      const prior = states[key];
      const result = stepCounter(
        prior,
        key,
        { v, tMs: sample.tMs, deviceId: sample.deviceId },
        { maxGapSec: input.maxGapSec },
      );
      states[key] = result.state;
      if (result.accepted) allocateAccepted(key, index, result.accepted);
      if (result.unknown) visitSpan(result.unknown.fromMs, result.unknown.toMs);
      for (const event of result.events) {
        if (event.atMs >= input.fromMs && event.atMs < input.toMs) {
          events.push(event);
          rowAt(event.atMs).flags |= eventFlags[event.kind];
        }
      }
    }
    snapshots.push({ tMs: sample.tMs, state: cloneStates(states) });
  }
  const lookaheadUnresolved: CounterKey[] = [];
  const previewStates = cloneStates(states);
  for (const [index, key] of COUNTER_KEYS.entries()) {
    if (!previewStates[key].last || previewStates[key].last.tMs >= input.toMs)
      continue;
    let resolved = false;
    for (const sample of input.samples) {
      if (sample.tMs < input.toMs) continue;
      const v = sample.counters[key];
      if (
        v === null ||
        sample.flags & SampleFlag.BLOCK_INVALID_2000 ||
        isExcluded(
          counterFamilies[key],
          sample.tMs,
          sample.tMs + 1,
          input.exclusions,
        )
      )
        continue;
      const result = stepCounter(
        previewStates[key],
        key,
        { v, tMs: sample.tMs, deviceId: sample.deviceId },
        { maxGapSec: input.maxGapSec },
      );
      previewStates[key] = result.state;
      if (result.accepted) allocateAccepted(key, index, result.accepted);
      if (result.unknown) visitSpan(result.unknown.fromMs, result.unknown.toMs);
      if (
        result.accepted ||
        result.unknown ||
        (result.state.last !== null && result.state.last.tMs >= input.toMs)
      ) {
        resolved = true;
        break;
      }
    }
    if (!resolved) lookaheadUnresolved.push(key);
  }
  // Preview allocations may fill buckets, but preview states and events never enter
  // the persisted end-of-range states or per-bucket state snapshots.
  let snapshotIndex = 0;
  let current = cloneStates(input.counterStates ?? initialCounterStates());
  const ordered = [...rows.values()].sort(
    (a, b) => a.bucketStartMs - b.bucketStartMs,
  );
  for (const row of ordered) {
    while (
      snapshotIndex < snapshots.length &&
      snapshots[snapshotIndex].tMs < row.bucketStartMs + BUCKET_MS
    ) {
      current = snapshots[snapshotIndex].state;
      snapshotIndex++;
    }
    row.counterState = cloneStates(current);
    const monitoringStart =
      input.counterStates === null
        ? (input.samples[0]?.tMs ?? input.toMs)
        : row.bucketStartMs;
    const eligibleSec = Math.max(
      0,
      (row.bucketStartMs +
        BUCKET_MS -
        Math.max(row.bucketStartMs, monitoringStart)) /
        1000,
    );
    const covered = counterCoveredSec.get(row.bucketStartMs);
    row.counterUnknownSec = COUNTER_KEYS.map((_, index) =>
      Math.max(
        0,
        Math.min(300, Math.round(eligibleSec - (covered?.[index] ?? 0))),
      ),
    );
  }
  return {
    rows: ordered,
    writeFromMs,
    events,
    endCounterStates: cloneStates(states),
    lookaheadUnresolved,
  };
}

export function dailyBalanceResidual(t: {
  pvWh: number;
  batDischargeWh: number;
  batChargeWh: number;
  importWh: number;
  exportWh: number;
  houseWh: number;
}): { residualWh: number; residualPct: number | null; anomaly: boolean } {
  const residualWh =
    t.pvWh +
    t.batDischargeWh -
    t.batChargeWh +
    t.importWh -
    t.exportWh -
    t.houseWh;
  const denominator = t.pvWh + t.batDischargeWh + t.importWh;
  const residualPct =
    denominator === 0 ? null : (residualWh * 100) / denominator;
  return {
    residualWh,
    residualPct,
    anomaly:
      residualPct === null
        ? residualWh !== 0
        : residualPct < 0 || residualPct > 15,
  };
}
