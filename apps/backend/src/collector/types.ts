import type { PollTierName } from '../modbus/read-plan.js';

/** MappingConfig v1 (plan Phase 1.10). Raw signs are unverified until G3 passes. */
export interface MappingConfig {
  gridMeterSign: 1 | -1;
  gridMeterPhaseSign: [1 | -1, 1 | -1, 1 | -1];
  inverterAcSign: 1 | -1;
  batterySign: 1 | -1;
  batteryPowerSource: 'BAT1_POWER_G3_50' | 'BMS_1914';
  maxRepeatSpanSec: number;
}

/** Sample.flags bits (plan Phase 2.3). */
export const SampleFlag = {
  METER_LINK_DOWN: 1 << 0,
  METER_COMM_FAULT: 1 << 1,
  METER_STALE: 1 << 2,
  BLOCK_INVALID_0: 1 << 3,
  BLOCK_INVALID_1800: 1 << 4,
  BLOCK_INVALID_2000: 1 << 5,
  BLOCK_INVALID_30000: 1 << 6,
  CLOCK_STEP: 1 << 7,
  NEGATIVE_DERIVED_LOAD: 1 << 8,
  BATTERY_SIGN_CONFLICT: 1 << 9,
} as const;

/** One normalized FAST sample, ready for insert (counters in Wh as bigint, unknown = null). */
export interface SampleInput {
  observedAt: Date;
  mappingVersion: number;
  meterLink: number | null;
  gridW: number | null;
  gridAW: number | null;
  gridBW: number | null;
  gridCW: number | null;
  gridVoltA: number | null;
  gridVoltB: number | null;
  gridVoltC: number | null;
  gridPortW: number | null;
  inverterAcW: number | null;
  epsW: number | null;
  pvW: number | null;
  pvStringW: number[];
  batteryW: number | null;
  batteryBmsW: number | null;
  batterySoc: number | null;
  batteryState: number | null;
  loadVendorW: number | null;
  loadVendorTotalW: number | null;
  pvWh: bigint | null;
  gridBuyWh: bigint | null;
  gridSellWh: bigint | null;
  gridBuyPhaseWh: bigint[];
  gridSellPhaseWh: bigint[];
  batChargeWh: bigint | null;
  batDischargeWh: bigint | null;
  loadUseWh: bigint | null;
  vendorToday: Record<string, number> | null;
  meterRepeatSec: number;
  flags: number;
}

/** Quality event produced by pure code; persisted by the ingest service. */
export interface QualityEventInput {
  kind:
    | 'GAP'
    | 'DB_UNAVAILABLE'
    | 'CONNECTION_LOST'
    | 'METER_LINK_DOWN'
    | 'METER_STALE'
    | 'BLOCK_INVALID'
    | 'CLOCK_STEP'
    | 'CAPABILITY_CHANGED'
    | 'IDENTITY_MISMATCH'
    | 'NEGATIVE_DERIVED_LOAD'
    | 'FAULT_ACTIVE'
    | 'DEVICE_REPLACED'
    | 'ACQUISITION_SOURCE_CHANGED';
  startedAt: Date;
  endedAt?: Date;
  details: Record<string, unknown>;
}

export type CollectorState =
  | 'RUNNING'
  | 'DEGRADED_UPSTREAM'
  | 'LOCK_NOT_HELD'
  | 'IDENTITY_MISMATCH'
  | 'DISABLED'
  | 'STOPPING';

/** Read-only view of the collector for the GraphQL layer (implemented by CollectorService). */
export interface CollectorStatusSnapshot {
  state: CollectorState;
  acquisitionSource: 'MODBUS' | 'NONE';
  lastSuccessAt: Date | null;
  lastErrorAt: Date | null;
  lastError: string | null;
  consecutiveFailures: number;
  nextRetryAt: Date | null;
}
export const COLLECTOR_STATUS = Symbol('COLLECTOR_STATUS');
export interface CollectorStatusProvider {
  snapshot(): CollectorStatusSnapshot;
}

/** Poll as handed from the collector to ingest. `tier` is never DETECT here. */
export interface IngestPoll {
  runId: number;
  seq: number;
  deviceId: number;
  tier: Exclude<PollTierName, 'DETECT'> | 'DETECT';
  requestedAt: Date;
  receivedAt: Date;
  observedAt: Date;
  /** Encoded with modbus/raw-poll-codec.ts */
  blocks: Buffer;
  /**
   * Collector-process monotonic midpoint of the FAST read, in ms (see `RawPoll.monotonicMs`).
   * Present for FAST polls only. Comparable only between polls of the same `runId`.
   */
  monotonicMs?: number;
  /** Present for FAST polls only. */
  sample?: SampleInput;
  events: QualityEventInput[];
}
