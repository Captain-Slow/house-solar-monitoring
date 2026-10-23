import { createHash } from 'node:crypto';
import { WordMap, type RawBlock } from '../modbus/decode.js';
import { REGISTERS_BY_KEY } from '../modbus/register-map.js';
import {
  SampleFlag,
  type MappingConfig,
  type QualityEventInput,
  type SampleInput,
} from './types.js';

/**
 * Per-device acquisition state carried from one FAST poll to the next.
 *
 * `monotonicMs` values are comparable only inside one collector run (process lifetime);
 * a new run starts from `initialRepeatState()`. Wall time (`lastObservedAtMs`) is used only
 * to detect clock steps; the meter repeat duration is measured purely on the monotonic clock
 * so that a wall-clock adjustment can never shorten or reset it.
 */
export interface RepeatState {
  meterHash: string | null;
  /** Monotonic time at which the current meter words were first observed. */
  firstSeenMonotonicMs: number | null;
  lastObservedAtMs: number | null;
  lastMonotonicMs: number | null;
  activeConditions: number;
}

export function initialRepeatState(): RepeatState {
  return {
    meterHash: null,
    firstSeenMonotonicMs: null,
    lastObservedAtMs: null,
    lastMonotonicMs: null,
    activeConditions: 0,
  };
}

const TRANSITION_FLAGS =
  SampleFlag.METER_LINK_DOWN |
  SampleFlag.BLOCK_INVALID_0 |
  SampleFlag.BLOCK_INVALID_1800 |
  SampleFlag.BLOCK_INVALID_2000 |
  SampleFlag.BLOCK_INVALID_30000 |
  SampleFlag.CLOCK_STEP |
  SampleFlag.NEGATIVE_DERIVED_LOAD;
const BLOCK_FLAGS =
  SampleFlag.BLOCK_INVALID_0 |
  SampleFlag.BLOCK_INVALID_1800 |
  SampleFlag.BLOCK_INVALID_2000 |
  SampleFlag.BLOCK_INVALID_30000;
const FAULT_ACTIVE = 1 << 16;

/** The same complete meter-word fingerprint is used by acquisition and retained-raw validity repair. */
export function meterWordsHash(words: WordMap): string | null {
  const start = REGISTERS_BY_KEY.get('grid_meter_link')!.addr;
  const end = REGISTERS_BY_KEY.get('meter_pf_c')!.addr;
  const meterWords = words.slice(4, start, end - start + 1);
  if (meterWords === null) return null;
  const bytes = Buffer.allocUnsafe(meterWords.length * 2);
  for (let i = 0; i < meterWords.length; i++)
    bytes.writeUInt16BE(meterWords[i]!, i * 2);
  return createHash('sha256').update(bytes).digest('hex');
}

export function normalizeFast(input: {
  blocks: RawBlock[];
  observedAt: Date;
  monotonicMs: number;
  mapping: MappingConfig;
  mappingVersion: number;
  state: RepeatState;
  /**
   * Immutable repeat duration recorded at acquisition. Authoritative for every retained poll:
   * wall-time retention can remove interior acquisitions, not only a chain's prefix. Re-anchor
   * even when the retained hash matches; omitted changed words may have restarted the run.
   * Never derive this duration from wall time.
   */
  recordedMeterRepeatSec?: number;
}): { sample: SampleInput; state: RepeatState; events: QualityEventInput[] } {
  const {
    blocks,
    observedAt,
    monotonicMs,
    mapping,
    mappingVersion,
    state,
    recordedMeterRepeatSec,
  } = input;
  const words = new WordMap(blocks);
  const value = (key: string): number | null => {
    const reg = REGISTERS_BY_KEY.get(key);
    if (!reg) throw new Error(`unknown register ${key}`);
    return words.value(reg);
  };
  const sum = (...keys: string[]): number | null => {
    let total = 0;
    for (const key of keys) {
      const n = value(key);
      if (n === null) return null;
      total += n;
    }
    return total;
  };
  const wh = (key: string): bigint | null => {
    const reg = REGISTERS_BY_KEY.get(key);
    if (
      !reg ||
      reg.scale !== 10 ||
      (reg.dtype !== 'U32' && reg.dtype !== 'U16')
    )
      throw new Error(`unsupported energy register ${key}`);
    const raw = words.slice(reg.fc, reg.addr, reg.dtype === 'U32' ? 2 : 1);
    if (raw === null) return null;
    const units =
      reg.dtype === 'U32'
        ? BigInt(raw[0]!) * 65_536n + BigInt(raw[1]!)
        : BigInt(raw[0]!);
    return units * 100n;
  };
  const phases = (stem: string): bigint[] => {
    const result: bigint[] = [];
    for (const phase of ['a', 'b', 'c']) {
      const reading = wh(`${stem}_${phase}`);
      if (reading === null) return [];
      result.push(reading);
    }
    return result;
  };
  const now = observedAt.getTime();
  const meter = value('grid_meter_link');
  let flags = 0;
  const blockDefinitions = [
    ['workstatus', SampleFlag.BLOCK_INVALID_0],
    ['grid_meter_link', SampleFlag.BLOCK_INVALID_1800],
    ['pv_total_energy', SampleFlag.BLOCK_INVALID_2000],
    ['system_workstatus', SampleFlag.BLOCK_INVALID_30000],
  ] as const;
  for (const [key, bit] of blockDefinitions) {
    const start = REGISTERS_BY_KEY.get(key)!.addr;
    const block = blocks.find((b) => b.fc === 4 && b.start === start);
    if (!block || block.words === null || block.words.length !== block.count)
      flags |= bit;
  }
  if (meter !== null && meter !== 1) flags |= SampleFlag.METER_LINK_DOWN;
  const peripheralFaults = value('arm_periph_faults');
  if (peripheralFaults !== null && (peripheralFaults & 4) !== 0)
    flags |= SampleFlag.METER_COMM_FAULT;
  if (
    state.lastObservedAtMs !== null &&
    state.lastMonotonicMs !== null &&
    (now < state.lastObservedAtMs ||
      Math.abs(
        now - state.lastObservedAtMs - (monotonicMs - state.lastMonotonicMs),
      ) > 2000)
  )
    flags |= SampleFlag.CLOCK_STEP;

  const meterHash = meterWordsHash(words);
  // Repeat duration is elapsed monotonic time: a wall-clock step (even backward) must not
  // make a frozen meter look fresh. Monotonic time never runs backward within a run.
  const firstSeenMonotonicMs =
    recordedMeterRepeatSec !== undefined
      ? monotonicMs - recordedMeterRepeatSec * 1000
      : meterHash === null
        ? state.firstSeenMonotonicMs
        : meterHash === state.meterHash && state.firstSeenMonotonicMs !== null
          ? state.firstSeenMonotonicMs
          : monotonicMs;
  const meterRepeatSec =
    recordedMeterRepeatSec ??
    (firstSeenMonotonicMs === null
      ? 0
      : Math.max(0, Math.floor((monotonicMs - firstSeenMonotonicMs) / 1000)));
  if (meterRepeatSec > mapping.maxRepeatSpanSec)
    flags |= SampleFlag.METER_STALE;

  const gridRaw = value('meter_active_total');
  const gridW = gridRaw === null ? null : gridRaw * mapping.gridMeterSign;
  const gridPhases = ['a', 'b', 'c'].map((p, i) => {
    const n = value(`meter_active_${p}`);
    return n === null ? null : n * mapping.gridMeterPhaseSign[i]!;
  });
  const inverterRaw = sum(
    'inv_active_power_a',
    'inv_active_power_b',
    'inv_active_power_c',
  );
  const inverterAcW =
    inverterRaw === null ? null : inverterRaw * mapping.inverterAcSign;
  const epsW = sum('backup_active_a', 'backup_active_b', 'backup_active_c');
  const pvStrings: number[] = [];
  let pvW: number | null = 0;
  for (const n of [1, 2, 3, 4]) {
    const power = value(`pv${n}_power`);
    if (power === null) {
      pvW = null;
      break;
    }
    pvStrings.push(power);
    pvW += power;
  }
  if (pvW === null) pvStrings.length = 0;
  const bmsRaw = value('batt_power_bms');
  const batteryBmsW = bmsRaw === null ? null : bmsRaw * mapping.batterySign;
  const selectedRaw =
    mapping.batteryPowerSource === 'BMS_1914' ? bmsRaw : value('bat1_power_g3');
  const batteryW =
    selectedRaw === null ? null : selectedRaw * mapping.batterySign;
  const batteryState = value('bat_work_status');
  if (
    batteryW !== null &&
    Math.abs(batteryW) > 100 &&
    ((batteryState === 2 && batteryW < 0) ||
      (batteryState === 1 && batteryW > 0))
  )
    flags |= SampleFlag.BATTERY_SIGN_CONFLICT;
  if (
    gridW !== null &&
    inverterAcW !== null &&
    epsW !== null &&
    gridW + inverterAcW + epsW < -50
  )
    flags |= SampleFlag.NEGATIVE_DERIVED_LOAD;

  const today: Record<string, number> = {};
  if (!(flags & SampleFlag.BLOCK_INVALID_2000)) {
    for (const [key, reg] of REGISTERS_BY_KEY) {
      if (
        key.includes('today') &&
        reg.fc === 4 &&
        reg.dtype === 'U16' &&
        reg.scale === 10
      ) {
        const raw = words.slice(reg.fc, reg.addr, 1);
        if (raw !== null) today[key] = raw[0]! * 100;
      }
    }
  }
  const sample: SampleInput = {
    observedAt,
    mappingVersion,
    meterLink: meter,
    gridW,
    gridAW: gridPhases[0]!,
    gridBW: gridPhases[1]!,
    gridCW: gridPhases[2]!,
    gridVoltA: value('meter_grid_voltage_a'),
    gridVoltB: value('meter_grid_voltage_b'),
    gridVoltC: value('meter_grid_voltage_c'),
    gridPortW: value('grid_active_power_total'),
    inverterAcW,
    epsW,
    pvW,
    pvStringW: pvStrings,
    batteryW,
    batteryBmsW,
    batterySoc: value('battery_soc'),
    batteryState,
    loadVendorW: sum('load_power_a', 'load_power_b', 'load_power_c'),
    loadVendorTotalW: value('load_power_total'),
    pvWh: wh('pv_total_energy'),
    gridBuyWh: wh('grid_buy_energy'),
    gridSellWh: wh('grid_sell_energy'),
    gridBuyPhaseWh: phases('grid_buy_energy'),
    gridSellPhaseWh: phases('grid_sell_energy'),
    batChargeWh: wh('bat_charge_energy'),
    batDischargeWh: wh('bat_discharge_energy'),
    loadUseWh: wh('load_energy_use'),
    vendorToday: flags & SampleFlag.BLOCK_INVALID_2000 ? null : today,
    meterRepeatSec,
    flags,
  };
  const faultActive =
    (peripheralFaults !== null && peripheralFaults !== 0) ||
    (value('arm_system_faults') ?? 0) !== 0;
  const activeConditions =
    (flags & TRANSITION_FLAGS) | (faultActive ? FAULT_ACTIVE : 0);
  const transitions = activeConditions & ~state.activeConditions;
  const events: QualityEventInput[] = [];
  const emit = (
    condition: boolean,
    kind: QualityEventInput['kind'],
    details: Record<string, unknown>,
  ) => {
    if (condition) events.push({ kind, startedAt: observedAt, details });
  };
  emit((transitions & SampleFlag.METER_LINK_DOWN) !== 0, 'METER_LINK_DOWN', {
    meterLink: meter,
  });
  emit((transitions & BLOCK_FLAGS) !== 0, 'BLOCK_INVALID', {
    blocks: blockDefinitions
      .filter(([, bit]) => (flags & bit) !== 0)
      .map(([key]) => REGISTERS_BY_KEY.get(key)!.addr),
  });
  emit((transitions & SampleFlag.CLOCK_STEP) !== 0, 'CLOCK_STEP', {});
  emit(
    (transitions & SampleFlag.NEGATIVE_DERIVED_LOAD) !== 0,
    'NEGATIVE_DERIVED_LOAD',
    { derivedW: gridW! + inverterAcW! + epsW! },
  );
  emit((transitions & FAULT_ACTIVE) !== 0, 'FAULT_ACTIVE', {
    peripheralFaults,
    systemFaults: value('arm_system_faults'),
  });
  return {
    sample,
    events,
    state: {
      meterHash: meterHash ?? state.meterHash,
      firstSeenMonotonicMs,
      lastObservedAtMs: now,
      lastMonotonicMs: monotonicMs,
      activeConditions,
    },
  };
}
