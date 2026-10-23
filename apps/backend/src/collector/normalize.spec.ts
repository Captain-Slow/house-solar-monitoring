import { describe, expect, it } from 'vitest';
import {
  blocksFrom,
  plausibleImage,
  setReg,
} from '../../test/support/synthetic.js';
import { FAST_PLAN } from '../modbus/read-plan.js';
import { DEFAULT_MAPPING_V1 } from './mapping.js';
import {
  initialRepeatState,
  normalizeFast,
  type RepeatState,
} from './normalize.js';
import { SampleFlag } from './types.js';

const at = (seconds: number) => new Date(Date.UTC(2026, 0, 1, 12, 0, seconds));
const sample = (
  seconds = 0,
  state: RepeatState = initialRepeatState(),
  changes: Record<string, number> = {},
  mapping = DEFAULT_MAPPING_V1,
) => {
  const image = plausibleImage();
  for (const [key, value] of Object.entries(changes)) setReg(image, key, value);
  return normalizeFast({
    blocks: blocksFrom(FAST_PLAN, image),
    observedAt: at(seconds),
    monotonicMs: seconds * 1000,
    mapping,
    mappingVersion: 1,
    state,
  });
};

describe('normalizeFast', () => {
  it('applies configured signs to total, phases, inverter sum and both battery sources without altering port power', () => {
    const result = sample(
      0,
      initialRepeatState(),
      {
        meter_active_total: 300,
        meter_active_a: 100,
        meter_active_b: 200,
        meter_active_c: -5,
        inv_active_power_a: 50,
        inv_active_power_b: -10,
        inv_active_power_c: 20,
        bat1_power_g3: -250,
        batt_power_bms: -200,
        bat_work_status: 2,
        grid_active_power_total: -90,
        backup_active_a: 5,
        backup_active_b: 10,
        backup_active_c: 15,
        load_power_a: 1,
        load_power_b: 2,
        load_power_c: 3,
        load_power_total: 9,
      },
      {
        ...DEFAULT_MAPPING_V1,
        gridMeterSign: -1,
        gridMeterPhaseSign: [-1, 1, -1],
        inverterAcSign: -1,
        batterySign: -1,
        batteryPowerSource: 'BMS_1914',
      },
    );
    expect(result.sample).toMatchObject({
      gridW: -300,
      gridAW: -100,
      gridBW: 200,
      gridCW: 5,
      inverterAcW: -60,
      batteryW: 200,
      batteryBmsW: 200,
      gridPortW: -90,
      epsW: 30,
      loadVendorW: 6,
      loadVendorTotalW: 9,
      pvW: 2000,
      pvStringW: [1000, 1000, 0, 0],
    });
  });

  it('keeps default battery power on register 50 even when BMS disagrees', () => {
    const result = sample(0, initialRepeatState(), {
      bat1_power_g3: 175,
      batt_power_bms: -240,
      bat_work_status: 2,
    });
    expect(result.sample.batteryW).toBe(175);
    expect(result.sample.batteryBmsW).toBe(-240);
    expect(result.sample.flags & SampleFlag.BATTERY_SIGN_CONFLICT).toBe(0);
  });

  it('uses only complete valid words and never invents zero for invalid blocks or split registers', () => {
    const image = plausibleImage();
    const blocks = blocksFrom(FAST_PLAN, image);
    for (const start of [0, 1800, 2000, 30000])
      blocks.find((b) => b.start === start)!.words = null;
    const result = normalizeFast({
      blocks,
      observedAt: at(0),
      monotonicMs: 0,
      mapping: DEFAULT_MAPPING_V1,
      mappingVersion: 1,
      state: initialRepeatState(),
    });
    expect(result.sample).toMatchObject({
      pvW: null,
      pvStringW: [],
      batteryW: null,
      gridW: null,
      gridAW: null,
      meterLink: null,
      pvWh: null,
      gridBuyWh: null,
      gridBuyPhaseWh: [],
      vendorToday: null,
    });
    expect(
      result.sample.flags &
        (SampleFlag.BLOCK_INVALID_0 |
          SampleFlag.BLOCK_INVALID_1800 |
          SampleFlag.BLOCK_INVALID_2000 |
          SampleFlag.BLOCK_INVALID_30000),
    ).toBe(120);
    expect(
      result.events.filter((e) => e.kind === 'BLOCK_INVALID'),
    ).toHaveLength(1);
    const split = blocksFrom(FAST_PLAN, image);
    split.find((b) => b.start === 2123)!.words = null;
    expect(
      normalizeFast({
        blocks: split,
        observedAt: at(0),
        monotonicMs: 0,
        mapping: DEFAULT_MAPPING_V1,
        mappingVersion: 1,
        state: initialRepeatState(),
      }).sample.vendorToday,
    ).not.toHaveProperty('grid_buy_today_c');
  });

  it('converts raw tenths of kWh exactly into Wh across lifetime, phase and daily registers', () => {
    const result = sample(0, initialRepeatState(), {
      pv_total_energy: 429_496_729.5,
      grid_buy_energy: 25_000_000.1,
      grid_sell_energy: 1.0,
      bat_charge_energy: 1.0,
      bat_discharge_energy: 0.1,
      load_energy_use: 3.7,
      grid_buy_energy_a: 12.3,
      grid_buy_energy_b: 0,
      grid_buy_energy_c: 4.5,
      grid_sell_energy_a: 429_496_729.5,
      pv_today_energy: 1.0,
      grid_buy_today: 3.2,
    });
    expect(result.sample.pvWh).toBe(429_496_729_500n);
    expect(result.sample.gridBuyWh).toBe(25_000_000_100n);
    expect(result.sample.gridSellWh).toBe(1_000n);
    expect(result.sample.batChargeWh).toBe(1_000n);
    expect(result.sample.batDischargeWh).toBe(100n);
    expect(result.sample.loadUseWh).toBe(3_700n);
    expect(result.sample.gridBuyPhaseWh).toEqual([12_300n, 0n, 4_500n]);
    expect(result.sample.gridSellPhaseWh[0]).toBe(429_496_729_500n);
    expect(result.sample.vendorToday?.pv_today_energy).toBe(1_000);
    expect(result.sample.vendorToday?.grid_buy_today).toBe(3_200);
  });

  it('counts repeated meter words, carries the hash through invalid reads, and emits transitions only', () => {
    const first = sample(0);
    const again = sample(10, first.state);
    const stale = sample(40, again.state);
    expect(first.sample.meterRepeatSec).toBe(0);
    expect(again.sample.meterRepeatSec).toBe(10);
    expect(stale.sample.meterRepeatSec).toBe(40);
    expect(stale.sample.flags & SampleFlag.METER_STALE).toBeTruthy();
    const blocks = blocksFrom(FAST_PLAN, plausibleImage());
    blocks.find((b) => b.start === 1800)!.words = null;
    const missing = normalizeFast({
      blocks,
      observedAt: at(50),
      monotonicMs: 50_000,
      mapping: DEFAULT_MAPPING_V1,
      mappingVersion: 1,
      state: stale.state,
    });
    expect(missing.sample.meterRepeatSec).toBe(50);
    expect(missing.state.meterHash).toBe(stale.state.meterHash);
    const recovered = sample(60, missing.state, { meter_active_total: 301 });
    expect(recovered.sample.meterRepeatSec).toBe(0);
    const down = sample(70, recovered.state, { grid_meter_link: 0 });
    const continued = sample(80, down.state, { grid_meter_link: 0 });
    expect(down.events.some((e) => e.kind === 'METER_LINK_DOWN')).toBe(true);
    expect(continued.events.some((e) => e.kind === 'METER_LINK_DOWN')).toBe(
      false,
    );
  });

  it('sets meter comm, active fault, negative load and battery sign conflict independently', () => {
    const first = sample(0);
    const faulty = sample(10, first.state, {
      arm_periph_faults: 4,
      meter_active_total: -500,
      bat1_power_g3: -180,
      bat_work_status: 2,
    });
    expect(faulty.sample.flags & SampleFlag.METER_COMM_FAULT).toBeTruthy();
    expect(faulty.sample.flags & SampleFlag.NEGATIVE_DERIVED_LOAD).toBeTruthy();
    expect(faulty.sample.flags & SampleFlag.BATTERY_SIGN_CONFLICT).toBeTruthy();
    expect(faulty.events.map((e) => e.kind)).toContain('FAULT_ACTIVE');
    expect(faulty.events.map((e) => e.kind)).toContain('NEGATIVE_DERIVED_LOAD');
    const repeated = sample(20, faulty.state, {
      arm_periph_faults: 4,
      meter_active_total: -500,
      bat1_power_g3: -180,
      bat_work_status: 2,
    });
    expect(repeated.events.some((e) => e.kind === 'FAULT_ACTIVE')).toBe(false);
    expect(
      repeated.events.some((e) => e.kind === 'NEGATIVE_DERIVED_LOAD'),
    ).toBe(false);
    const neutral = sample(30, repeated.state, {
      bat1_power_g3: -100,
      bat_work_status: 0,
    });
    expect(neutral.sample.flags & SampleFlag.BATTERY_SIGN_CONFLICT).toBe(0);
  });

  it('detects a clock jump or backward wall time relative to monotonic time', () => {
    const first = sample(0);
    const jump = sample(10, first.state);
    expect(jump.sample.flags & SampleFlag.CLOCK_STEP).toBe(0);
    const moved = normalizeFast({
      blocks: blocksFrom(FAST_PLAN, plausibleImage()),
      observedAt: at(20),
      monotonicMs: 11_000,
      mapping: DEFAULT_MAPPING_V1,
      mappingVersion: 1,
      state: jump.state,
    });
    expect(moved.sample.flags & SampleFlag.CLOCK_STEP).toBeTruthy();
    expect(moved.events.some((e) => e.kind === 'CLOCK_STEP')).toBe(true);
    const backward = sample(5, moved.state);
    expect(backward.sample.flags & SampleFlag.CLOCK_STEP).toBeTruthy();
    expect(backward.events.some((e) => e.kind === 'CLOCK_STEP')).toBe(false);
  });

  describe('meter repeat age is measured on the monotonic clock', () => {
    const wallRewind = 3600;
    const withWall = (
      wallSeconds: number,
      monotonicSeconds: number,
      state: RepeatState,
      changes: Record<string, number> = {},
    ) => {
      const image = plausibleImage();
      for (const [key, value] of Object.entries(changes))
        setReg(image, key, value);
      return normalizeFast({
        blocks: blocksFrom(FAST_PLAN, image),
        observedAt: at(wallSeconds),
        monotonicMs: monotonicSeconds * 1000,
        mapping: DEFAULT_MAPPING_V1,
        mappingVersion: 1,
        state,
      });
    };

    it('keeps a frozen meter stale after the wall clock is rewound', () => {
      let state = initialRepeatState();
      for (const second of [0, 10, 20, 30]) {
        const result = withWall(second, second, state);
        expect(result.sample.flags & SampleFlag.METER_STALE).toBe(0);
        state = result.state;
      }
      const frozen = withWall(40, 40, state);
      expect(frozen.sample.flags & SampleFlag.METER_STALE).toBeTruthy();

      const stepped = withWall(50 - wallRewind, 50, frozen.state);
      expect(stepped.sample.flags & SampleFlag.CLOCK_STEP).toBeTruthy();
      expect(stepped.sample.meterRepeatSec).toBe(50);
      expect(stepped.sample.flags & SampleFlag.METER_STALE).toBeTruthy();

      // The sample after the step is no longer CLOCK_STEP; only staleness may still reject it.
      const following = withWall(60 - wallRewind, 60, stepped.state);
      expect(following.sample.flags & SampleFlag.CLOCK_STEP).toBe(0);
      expect(following.sample.meterRepeatSec).toBe(60);
      expect(following.sample.flags & SampleFlag.METER_STALE).toBeTruthy();
    });

    it('does not let a forward wall jump age a meter that has only been repeating for the monotonic span', () => {
      const first = withWall(0, 0, initialRepeatState());
      const jumped = withWall(25, 10, first.state);
      expect(jumped.sample.flags & SampleFlag.CLOCK_STEP).toBeTruthy();
      expect(jumped.sample.meterRepeatSec).toBe(10);
      expect(jumped.sample.flags & SampleFlag.METER_STALE).toBe(0);
    });

    it('starts a new repeat run at the monotonic time of the changed reading, whatever the wall clock says', () => {
      const first = withWall(0, 0, initialRepeatState());
      const changes = { meter_active_total: 321 };
      const changed = withWall(20 - wallRewind, 20, first.state, changes);
      expect(changed.sample.meterRepeatSec).toBe(0);
      const repeated = withWall(30 - wallRewind, 30, changed.state, changes);
      expect(repeated.sample.meterRepeatSec).toBe(10);
    });

    it('continues a recorded repeat duration when a replay chain starts without its predecessor', () => {
      const seeded = normalizeFast({
        blocks: blocksFrom(FAST_PLAN, plausibleImage()),
        observedAt: at(500),
        monotonicMs: 7_000,
        mapping: DEFAULT_MAPPING_V1,
        mappingVersion: 1,
        state: initialRepeatState(),
        recordedMeterRepeatSec: 45,
      });
      expect(seeded.sample.meterRepeatSec).toBe(45);
      expect(seeded.sample.flags & SampleFlag.METER_STALE).toBeTruthy();
      expect(seeded.sample.flags & SampleFlag.CLOCK_STEP).toBe(0);
      const next = withWall(510, 17, seeded.state);
      expect(next.sample.meterRepeatSec).toBe(55);
      // A changed reading ends the recorded run.
      const changed = withWall(520, 27, next.state, { meter_active_total: 5 });
      expect(changed.sample.meterRepeatSec).toBe(0);
    });

    it('uses immutable per-poll ages across both missed changes and fractional retained clocks', () => {
      const blocks = blocksFrom(FAST_PLAN, plausibleImage());
      let state = initialRepeatState();
      for (const [mono, age] of [
        [0.125, 0],
        [20.625, 0],
        [30.125, 9],
        [51.125, 30],
        [52.125, 31],
      ]) {
        const result = normalizeFast({
          blocks,
          observedAt: at(mono),
          monotonicMs: mono! * 1000,
          mapping: DEFAULT_MAPPING_V1,
          mappingVersion: 1,
          state,
          recordedMeterRepeatSec: age,
        });
        expect(result.sample.meterRepeatSec).toBe(age);
        expect(!!(result.sample.flags & SampleFlag.METER_STALE)).toBe(
          age! > 30,
        );
        state = result.state;
      }
    });

    it('uses the next valid poll recorded age after a first retained invalid meter block', () => {
      const blocks = blocksFrom(FAST_PLAN, plausibleImage());
      const invalid = blocks.map((block) =>
        block.start === 1800 ? { ...block, words: null } : block,
      );
      const first = normalizeFast({
        blocks: invalid,
        observedAt: at(0),
        monotonicMs: 12_500,
        mapping: DEFAULT_MAPPING_V1,
        mappingVersion: 1,
        state: initialRepeatState(),
        recordedMeterRepeatSec: 30,
      });
      const next = normalizeFast({
        blocks,
        observedAt: at(10),
        monotonicMs: 22_500,
        mapping: DEFAULT_MAPPING_V1,
        mappingVersion: 1,
        state: first.state,
        recordedMeterRepeatSec: 40,
      });
      expect(first.sample.meterRepeatSec).toBe(30);
      expect(next.sample.meterRepeatSec).toBe(40);
      expect(next.sample.flags & SampleFlag.METER_STALE).toBeTruthy();
    });
  });
});
