import { decodeBlocks, type RawBlock } from '../../src/modbus/decode.js';
import type { CaptureRecord } from '../../src/modbus/capture.js';
import {
  DETECT_BLOCKS,
  FAST_PLAN,
  SETTINGS_PLAN,
  SLOW_PLAN,
  type PlannedBlock,
} from '../../src/modbus/read-plan.js';
import {
  REGISTERS_BY_KEY,
  WORD_SIZE,
  type FunctionCode,
  type RegisterDef,
} from '../../src/modbus/register-map.js';

/** SYNTHETIC test data only. Real captures come from the probe (Phase 1.8). */
export type Image = Record<FunctionCode, Map<number, number>>;

export function newImage(): Image {
  return { 3: new Map(), 4: new Map() };
}

/** Inverse of decodeWords. */
export function encodeValue(reg: RegisterDef, value: number): number[] {
  const raw = Math.round(value * reg.scale);
  const n = WORD_SIZE[reg.dtype];
  if (n === 1) return [raw & 0xffff];
  const u = raw < 0 ? raw + 0x100000000 : raw;
  const hi = Math.floor(u / 0x10000) & 0xffff;
  const lo = u & 0xffff;
  return reg.dtype === 'I32R' ? [lo, hi] : [hi, lo];
}

export function setReg(img: Image, key: string, value: number): void {
  const reg = REGISTERS_BY_KEY.get(key);
  if (reg === undefined) throw new Error(`unknown register ${key}`);
  encodeValue(reg, value).forEach((w, i) => img[reg.fc].set(reg.addr + i, w));
}

/** Byte-swapped ASCII into input registers starting at 1000. */
export function setModel(img: Image, model: string): void {
  for (let i = 0; i < 5; i++) {
    const c0 = model.charCodeAt(2 * i) || 0;
    const c1 = model.charCodeAt(2 * i + 1) || 0;
    img[4].set(1000 + i, c0 | (c1 << 8));
  }
}

export function blocksFrom(
  plan: readonly PlannedBlock[],
  img: Image,
): RawBlock[] {
  return plan.map((pb) => ({
    ...pb,
    words: Array.from(
      { length: pb.count },
      (_, i) => img[pb.fc].get(pb.start + i) ?? 0,
    ),
  }));
}

export interface SyntheticState {
  pvW?: number;
  pvV?: number;
  gridW?: number;
  batteryW?: number;
  soc?: number;
  night?: boolean;
  grid?: number;
}

/** A plausible HIT-10L-G3-like register image for one instant. */
export function plausibleImage(s: SyntheticState = {}): Image {
  const img = newImage();
  const night = s.night === true;
  setModel(img, 'HIT-10L-G3');
  setReg(img, 'workstatus', 3);
  setReg(img, 'powerdsp_fm_ver', 105);
  setReg(img, 'safetydsp_fm_ver', 102);
  const pvV = night ? 0 : (s.pvV ?? 560);
  const pvW = night ? 0 : (s.pvW ?? 2000);
  for (const n of [1, 2]) {
    setReg(img, `pv${n}_voltage`, pvV);
    setReg(img, `pv${n}_power`, pvW / 2);
  }
  setReg(img, 'bat1_voltage', 52);
  setReg(img, 'bat1_power_g3', s.batteryW ?? 0);
  for (const p of ['a', 'b', 'c']) {
    setReg(img, `grid_voltage_${p}`, 230);
    setReg(img, `meter_grid_voltage_${p}`, 230);
    setReg(img, `inv_voltage_${p}`, 230);
    setReg(img, `backup_voltage_${p}`, 0);
    setReg(img, `meter_active_${p}`, (s.gridW ?? 300) / 3);
    setReg(img, `inv_active_power_${p}`, 0);
    setReg(img, `load_power_${p}`, 100);
  }
  setReg(img, 'grid_frequency', 50);
  setReg(img, 'meter_grid_freq', 50);
  setReg(img, 'grid_meter_link', 1);
  setReg(img, 'meter_active_total', s.gridW ?? 300);
  setReg(img, 'bat_type', 2);
  setReg(img, 'bms_link_status', 1);
  setReg(img, 'bat_work_status', 0);
  setReg(img, 'battery_capacity', 16);
  setReg(img, 'battery_soc', s.soc ?? 52);
  setReg(img, 'battery_soh', 100);
  setReg(img, 'batt_voltage_bms', 52);
  setReg(img, 'grid_buy_energy', 1234.5);
  setReg(img, 'grid_sell_energy', 234.5);
  setReg(img, 'pv_total_energy', 5000.1);
  setReg(img, 'ems_mode', 0);
  return img;
}

export function recordsFor(
  states: readonly SyntheticState[],
  opts: { startMs?: number; intervalMs?: number } = {},
): CaptureRecord[] {
  const t0 = opts.startMs ?? Date.parse('2026-10-01T04:00:00Z');
  const dt = opts.intervalMs ?? 10_000;
  const out: CaptureRecord[] = [];
  const push = (
    tier: CaptureRecord['tier'],
    plan: readonly PlannedBlock[],
    img: Image,
    ms: number,
  ): void => {
    const blocks = blocksFrom(plan, img);
    out.push({
      observedAt: new Date(ms).toISOString(),
      tier,
      blocks,
      decoded: decodeBlocks(blocks),
    });
  };
  const first = plausibleImage(states[0]);
  push('DETECT', DETECT_BLOCKS, first, t0);
  push('SETTINGS', SETTINGS_PLAN, first, t0);
  push('SLOW', SLOW_PLAN, first, t0);
  states.forEach((s, i) =>
    push('FAST', FAST_PLAN, plausibleImage(s), t0 + (i + 1) * dt),
  );
  return out;
}
