import { describe, expect, it } from 'vitest';
import { SampleFlag } from '../collector/types.js';
import type { LedgerSample } from './types.js';
import { familyPowers, isExcluded } from './families.js';

const sample: LedgerSample = {
  tMs: 0,
  deviceId: 1,
  mappingVersion: 1,
  flags: 0,
  gridW: -10,
  gridAW: 1000,
  gridBW: -500,
  gridCW: -510,
  pvW: 1200,
  batteryPowerSource: 'BAT1_POWER_G3_50',
  batteryW: -50,
  inverterAcW: -30,
  epsW: 0,
  batterySoc: 50,
  counters: {
    PV: 0,
    GRID_BUY: 0,
    GRID_SELL: 0,
    BAT_CHARGE: 0,
    BAT_DISCHARGE: 0,
    LOAD_USE: 0,
  },
};

describe('family validity', () => {
  it('preserves valid negative loads down to -50 W', () => {
    expect(familyPowers(sample)).toEqual({
      grid: { net: -10, phases: [1000, -500, -510] },
      pv: 1200,
      battery: -50,
      load: -40,
    });
  });

  it.each([
    SampleFlag.METER_LINK_DOWN,
    SampleFlag.METER_COMM_FAULT,
    SampleFlag.METER_STALE,
    SampleFlag.BLOCK_INVALID_1800,
  ])(
    'masks grid and derived load, not independent inverter families (%i)',
    (flag) => {
      expect(familyPowers({ ...sample, flags: flag })).toEqual({
        grid: { net: null, phases: null },
        pv: 1200,
        battery: -50,
        load: null,
      });
    },
  );

  it('masks inverter families but not grid on invalid block 0', () => {
    expect(
      familyPowers({ ...sample, flags: SampleFlag.BLOCK_INVALID_0 }),
    ).toEqual({
      grid: { net: -10, phases: [1000, -500, -510] },
      pv: null,
      battery: null,
      load: null,
    });
    expect(familyPowers({ ...sample, flags: SampleFlag.CLOCK_STEP })).toEqual({
      grid: { net: null, phases: null },
      pv: null,
      battery: null,
      load: null,
    });
  });

  it('requires every phase for per-phase integration, independently of grid net', () => {
    expect(familyPowers({ ...sample, gridBW: null }).grid).toEqual({
      net: -10,
      phases: null,
    });
    expect(
      familyPowers({ ...sample, flags: SampleFlag.NEGATIVE_DERIVED_LOAD }).load,
    ).toBeNull();
  });

  it('takes grid net and derived load from the meter total alone, never from the phases', () => {
    // Phases sum to -10 W; the meter total says +700 W import.
    const total = familyPowers({ ...sample, gridW: 700 });
    expect(total.grid).toEqual({ net: 700, phases: [1000, -500, -510] });
    expect(total.load).toBe(670);
    const unavailable = familyPowers({ ...sample, gridW: null });
    expect(unavailable.grid).toEqual({
      net: null,
      phases: [1000, -500, -510],
    });
    expect(unavailable.load).toBeNull();
  });

  describe('battery validity follows the sample mapping source', () => {
    const { BLOCK_INVALID_0: block0, BLOCK_INVALID_1800: block1800 } =
      SampleFlag;
    it.each([
      // source, flags, expected battery W (1200 = valid, null = masked)
      ['BMS_1914', 0, 1200],
      ['BMS_1914', block0, 1200],
      ['BMS_1914', block1800, null],
      ['BMS_1914', block0 | block1800, null],
      ['BMS_1914', SampleFlag.CLOCK_STEP, null],
      ['BAT1_POWER_G3_50', 0, 1200],
      ['BAT1_POWER_G3_50', block0, null],
      ['BAT1_POWER_G3_50', block1800, 1200],
      ['BAT1_POWER_G3_50', block0 | block1800, null],
      ['BAT1_POWER_G3_50', SampleFlag.CLOCK_STEP, null],
    ] as const)(
      '%s with flags %i yields battery %s',
      (source, flags, battery) => {
        expect(
          familyPowers({
            ...sample,
            batteryPowerSource: source,
            batteryW: 1200,
            flags,
          }).battery,
        ).toBe(battery);
      },
    );

    it('leaves PV, grid and load on their own blocks whichever battery source is configured', () => {
      for (const source of ['BMS_1914', 'BAT1_POWER_G3_50'] as const) {
        const masked = familyPowers({
          ...sample,
          batteryPowerSource: source,
          flags: SampleFlag.BLOCK_INVALID_0,
        });
        expect(masked.pv).toBeNull();
        expect(masked.load).toBeNull();
        expect(masked.grid.net).toBe(-10);
        const meterDown = familyPowers({
          ...sample,
          batteryPowerSource: source,
          flags: SampleFlag.BLOCK_INVALID_1800,
        });
        expect(meterDown.pv).toBe(1200);
        expect(meterDown.grid.net).toBeNull();
      }
    });
  });

  it('excludes only listed families and only overlapping half-open spans', () => {
    const exclusions = [
      { fromMs: 100, toMs: 200, families: ['PV'] as const },
      { fromMs: 400, toMs: 500, families: ['ALL'] as const },
    ];
    expect(isExcluded('PV', 90, 100, exclusions)).toBe(false);
    expect(isExcluded('PV', 90, 110, exclusions)).toBe(true);
    expect(isExcluded('GRID', 90, 110, exclusions)).toBe(false);
    expect(isExcluded('GRID', 450, 550, exclusions)).toBe(true);
  });
});
