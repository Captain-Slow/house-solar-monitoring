import type { MappingConfig } from '../collector/types.js';

/**
 * Shared accounting contract (plan: Accounting algorithms, Phase 4). Pure types and constants only.
 * Energies are Wh as JS numbers inside pure code (a counter never exceeds 2^32 * 100 Wh < 2^53) and
 * Decimal(12,3) in the database. null always means unknown, never zero.
 */

export const BUCKET_SEC = 300;
export const BUCKET_MS = BUCKET_SEC * 1000;

/** Bump when ledger math changes; buckets with a lower stored calcVersion are recomputed (ALGO_UPGRADE). */
export const LEDGER_ALGO_VERSION = 3;

export const floorBucketMs = (tMs: number): number =>
  Math.floor(tMs / BUCKET_MS) * BUCKET_MS;
export const ceilBucketMs = (tMs: number): number =>
  Math.ceil(tMs / BUCKET_MS) * BUCKET_MS;

// ---- counters ---------------------------------------------------------------------------------

/** Order is part of the storage format (counterUnknownSec, counterGapAllocMask bit index). */
export const COUNTER_KEYS = [
  'PV',
  'GRID_BUY',
  'GRID_SELL',
  'BAT_CHARGE',
  'BAT_DISCHARGE',
  'LOAD_USE',
] as const;
export type CounterKey = (typeof COUNTER_KEYS)[number];

/** Plausible maximum rate R in kW (= kWh/h) per counter: limit(dt_h) = 1000 * R * dt_h + 200 Wh. */
export const COUNTER_RATE_KW: Readonly<Record<CounterKey, number>> = {
  PV: 15,
  GRID_BUY: 60,
  GRID_SELL: 15,
  BAT_CHARGE: 15,
  BAT_DISCHARGE: 15,
  LOAD_USE: 60,
};

/** U32 counter wrap: 2^32 raw units of 0.1 kWh = 2^32 * 100 Wh. */
export const COUNTER_WRAP_WH = 2 ** 32 * 100;
/** A reading at or below this after a decrease is a reset (not a rejected jump). */
export const COUNTER_RESET_MAX_WH = 1000;

export interface CounterPendingReading {
  v: number;
  tMs: number;
}

/** Per-counter state machine state; JSON-serializable (numbers only) so it can live in EnergyInterval.counterState. */
export interface CounterState {
  segment: number;
  deviceId: number | null;
  /** Last ACCEPTED reading (the baseline), or null before the first reading. */
  last: CounterPendingReading | null;
  /** false while the baseline is a first/new-segment reading waiting for its confirming successor. */
  confirmed: boolean;
  /** Consecutive readings consistent with each other but not with `last` (discontinuity candidates). */
  pending: CounterPendingReading[];
}
export type CounterStates = Record<CounterKey, CounterState>;

// ---- ledger flags (EnergyInterval.flags) -------------------------------------------------------

export const LedgerFlag = {
  GRID_GAP: 1 << 0,
  PV_GAP: 1 << 1,
  BAT_GAP: 1 << 2,
  LOAD_GAP: 1 << 3,
  COUNTER_RESET: 1 << 4,
  COUNTER_JUMP_REJECTED: 1 << 5,
  COUNTER_DISCONTINUITY: 1 << 6,
  COUNTER_GAP_ALLOCATED: 1 << 7,
  /** A gap-allocated counter span crosses a configured time-of-use boundary or the local-day boundary. */
  TOU_UNCERTAIN: 1 << 8,
  OUTSIDE_RETENTION: 1 << 9,
  STALE_CALC_PARAMS: 1 << 10,
} as const;

// ---- compute input / output --------------------------------------------------------------------

/** One stored Sample reduced to what the ledger needs. Powers are canonical (+import, +discharge). */
export interface LedgerSample {
  tMs: number;
  deviceId: number;
  /** Original sample provenance; interval attribution never changes the per-sample power source. */
  mappingVersion: number;
  /** Sample.flags (collector/types.ts SampleFlag bits). */
  flags: number;
  gridW: number | null;
  gridAW: number | null;
  gridBW: number | null;
  gridCW: number | null;
  pvW: number | null;
  /** Battery power of the register block named by batteryPowerSource. */
  batteryW: number | null;
  /** batteryPowerSource of the MappingVersion the sample was normalized with; selects which block validates batteryW. */
  batteryPowerSource: MappingConfig['batteryPowerSource'];
  inverterAcW: number | null;
  epsW: number | null;
  batterySoc: number | null;
  /** Counter readings in Wh; null = unknown (block 2000 invalid). */
  counters: Record<CounterKey, number | null>;
}

export type ExclusionFamily = 'GRID' | 'PV' | 'BATTERY' | 'LOAD' | 'ALL';
export interface ExclusionWindow {
  fromMs: number;
  /** exclusive */
  toMs: number;
  families: readonly ExclusionFamily[];
}

export interface ComputeInput {
  /** Bucket-aligned range [fromMs, toMs) to (re)compute. */
  fromMs: number;
  toMs: number;
  maxGapSec: number;
  /**
   * Ascending by tMs. Include the latest sample before fromMs (integration seed) and
   * readings at/after toMs until each crossing counter transition resolves. If only
   * the first future sample is available, inspect lookaheadUnresolved and retry with
   * more samples. Preview readings never enter the returned counter states.
   */
  samples: readonly LedgerSample[];
  /** State at the end of the latest EnergyInterval row before the range, or null when there is none (first processing). */
  counterStates: CounterStates | null;
  exclusions: readonly ExclusionWindow[];
  /** Local minutes-of-day (0..1439) that count as time-of-use boundaries for TOU_UNCERTAIN; midnight (0) is always included. */
  touBoundaryMinutes: readonly number[];
  timeZone: string;
}

/**
 * One bucket row; Wh fields are numbers (the worker rounds to 3 dp when storing). The `*CoveredSec`
 * fields may be fractional here; the worker floors them to whole seconds (INTEGER columns) when storing.
 */
export interface IntervalRow {
  bucketStartMs: number;
  mappingVersion: number;
  gridImportNetWh: number | null;
  gridExportNetWh: number | null;
  gridImportPhaseWh: number | null;
  gridExportPhaseWh: number | null;
  gridImportCounterWh: number | null;
  gridExportCounterWh: number | null;
  pvIntWh: number | null;
  pvCounterWh: number | null;
  batChargeIntWh: number | null;
  batDischargeIntWh: number | null;
  batChargeCounterWh: number | null;
  batDischargeCounterWh: number | null;
  loadDerivedWh: number | null;
  loadCounterWh: number | null;
  gridCoveredSec: number;
  pvCoveredSec: number;
  batCoveredSec: number;
  /** Occupied valid SOC observation slots (10 s each), independent of integrated battery power. */
  socCoveredSec: number;
  loadCoveredSec: number;
  counterUnknownSec: number[];
  counterGapAllocMask: number;
  flags: number;
  /** State after processing every reading with tMs < bucket end. */
  counterState: CounterStates;
  gridAvgW: number | null;
  gridMinW: number | null;
  gridMaxW: number | null;
  pvAvgW: number | null;
  pvMaxW: number | null;
  batAvgW: number | null;
  loadAvgW: number | null;
  loadMaxW: number | null;
  socMin: number | null;
  socMax: number | null;
  socLast: number | null;
}

export type LedgerEventKind =
  'COUNTER_RESET' | 'COUNTER_JUMP_REJECTED' | 'COUNTER_DISCONTINUITY';
export interface LedgerEvent {
  kind: LedgerEventKind;
  counter: CounterKey;
  atMs: number;
  details: Record<string, number | string>;
}

export interface ComputeOutput {
  /** Ascending, one per bucket in [writeFromMs, toMs) that has any sample, covered time or allocated energy. */
  rows: IntervalRow[];
  /**
   * Earliest bucket the result writes. < input.fromMs when a counter transition began before the range
   * (gap allocation): the worker must widen the range to this bucket and recompute (fixpoint) so that
   * the whole span, with its integration data, is rewritten consistently.
   */
  writeFromMs: number;
  /** Counter events inside [writeFromMs, toMs); the worker replaces stored ledger events of that range. */
  events: LedgerEvent[];
  /** State at toMs (equal to the last row's counterState when a row ends at toMs). */
  endCounterStates: CounterStates;
  /**
   * Counters with a baseline before toMs whose crossing transition remains unresolved by
   * the provided post-range readings. Fetch farther and recompute before persisting rows.
   * Ordered as COUNTER_KEYS; preview readings never change endCounterStates.
   */
  lookaheadUnresolved: CounterKey[];
}

// ---- policy ------------------------------------------------------------------------------------

export type GridSource = 'METER_NET' | 'METER_PER_PHASE' | 'INVERTER_COUNTER';
export type PvSource = 'COUNTER' | 'INTEGRATED';
export type BatterySource = 'COUNTER' | 'INTEGRATED';
export type LoadSource = 'DERIVED' | 'VENDOR_COUNTER';

export interface PolicySegment {
  version: number;
  effectiveFrom: Date;
  supersededByVersion: number | null;
  gridSource: GridSource;
  pvSource: PvSource;
  batterySource: BatterySource;
  loadSource: LoadSource;
  maxGapSec: number;
  validated: Record<string, boolean>;
  note: string;
}
export const DEFAULT_MAX_GAP_SEC = 30;
