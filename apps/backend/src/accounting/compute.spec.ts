import { describe, expect, it } from 'vitest';
import { SampleFlag } from '../collector/types.js';
import { computeRange, dailyBalanceResidual } from './compute.js';
import { BUCKET_MS, LedgerFlag } from './types.js';
import type { ComputeInput, IntervalRow, LedgerSample } from './types.js';

function sample(
  tMs: number,
  changes: Partial<LedgerSample> = {},
): LedgerSample {
  return {
    tMs,
    deviceId: 1,
    mappingVersion: 1,
    flags: 0,
    gridW: 1000,
    gridAW: 1000,
    gridBW: 0,
    gridCW: 0,
    pvW: 400,
    batteryPowerSource: 'BAT1_POWER_G3_50',
    batteryW: 100,
    inverterAcW: 0,
    epsW: 0,
    batterySoc: 50,
    counters: {
      PV: null,
      GRID_BUY: null,
      GRID_SELL: null,
      BAT_CHARGE: null,
      BAT_DISCHARGE: null,
      LOAD_USE: null,
    },
    ...changes,
  };
}
function gridReading(tMs: number, v: number): LedgerSample {
  return sample(tMs, {
    counters: {
      PV: null,
      GRID_BUY: v,
      GRID_SELL: null,
      BAT_CHARGE: null,
      BAT_DISCHARGE: null,
      LOAD_USE: null,
    },
  });
}

function input(
  samples: LedgerSample[],
  changes: Partial<ComputeInput> = {},
): ComputeInput {
  return {
    fromMs: 0,
    toMs: BUCKET_MS,
    maxGapSec: 30,
    samples,
    counterStates: null,
    exclusions: [],
    touBoundaryMinutes: [14 * 60],
    timeZone: 'Asia/Kuala_Lumpur',
    ...changes,
  };
}
const sum = (rows: IntervalRow[], key: keyof IntervalRow): number =>
  rows.reduce(
    (value, row) =>
      value + (typeof row[key] === 'number' ? (row[key] as number) : 0),
    0,
  );

describe('computeRange', () => {
  it('V3 stores both meter netting candidates with opposite phase flow', () => {
    const samples = Array.from({ length: 361 }, (_, i) =>
      sample(i * 10_000, {
        gridW: 500,
        gridAW: 1000,
        gridBW: 1000,
        gridCW: -1500,
      }),
    );
    const result = computeRange(input(samples, { toMs: 3_600_000 }));
    for (const row of result.rows) {
      expect(row.gridImportNetWh).not.toBeNull();
      expect(row.gridExportNetWh).toBe(0);
      expect(row.gridImportPhaseWh).not.toBeNull();
      expect(row.gridExportPhaseWh).not.toBeNull();
    }
    expect(sum(result.rows, 'gridImportNetWh')).toBeCloseTo(500, 5);
    expect(sum(result.rows, 'gridExportNetWh')).toBe(0);
    expect(sum(result.rows, 'gridImportPhaseWh')).toBeCloseTo(2000, 5);
    expect(sum(result.rows, 'gridExportPhaseWh')).toBeCloseTo(1500, 5);
  });

  describe('V3 meter-total NET semantics: register 1814 total, never the phase sum', () => {
    // One hour of constant power. Per-phase readings sum to +500 W.
    const phaseReadings = { gridAW: 1000, gridBW: 1000, gridCW: -1500 };
    const hour = (changes: Partial<LedgerSample>): IntervalRow[] =>
      computeRange(
        input(
          Array.from({ length: 361 }, (_, i) => sample(i * 10_000, changes)),
          { toMs: 3_600_000 },
        ),
      ).rows;

    it.each([
      // meter total W, expected NET import Wh, expected NET export Wh
      [-300, 0, 300],
      [1200, 1200, 0],
    ])(
      'integrates a %i W meter total directionally for NET and each phase directionally for PER_PHASE',
      (gridW, importWh, exportWh) => {
        const rows = hour({ gridW, ...phaseReadings });
        for (const row of rows) {
          for (const key of [
            'gridImportNetWh',
            'gridExportNetWh',
            'gridImportPhaseWh',
            'gridExportPhaseWh',
          ] as const)
            expect(row[key]).not.toBeNull();
          expect(
            row[importWh === 0 ? 'gridImportNetWh' : 'gridExportNetWh'],
          ).toBe(0);
        }
        expect(sum(rows, 'gridImportNetWh')).toBeCloseTo(importWh, 5);
        expect(sum(rows, 'gridExportNetWh')).toBeCloseTo(exportWh, 5);
        expect(sum(rows, 'gridImportPhaseWh')).toBeCloseTo(2000, 5);
        expect(sum(rows, 'gridExportPhaseWh')).toBeCloseTo(1500, 5);
      },
    );

    it('leaves NET unknown when the meter total is unavailable instead of deriving it from valid phases', () => {
      const rows = hour({ gridW: null, ...phaseReadings });
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        expect(row.gridImportNetWh).toBeNull();
        expect(row.gridExportNetWh).toBeNull();
        expect(row.gridCoveredSec).toBe(0);
        expect(row.flags & LedgerFlag.GRID_GAP).toBeTruthy();
      }
      expect(sum(rows, 'gridImportPhaseWh')).toBeCloseTo(2000, 5);
      expect(sum(rows, 'gridExportPhaseWh')).toBeCloseTo(1500, 5);
    });

    it('leaves PER_PHASE unknown when a phase is unavailable instead of deriving it from the meter total', () => {
      const rows = hour({ gridW: 500, ...phaseReadings, gridBW: null });
      expect(rows).toHaveLength(12);
      for (const row of rows) {
        expect(row.gridImportPhaseWh).toBeNull();
        expect(row.gridExportPhaseWh).toBeNull();
      }
      for (const row of rows) {
        expect(row.gridImportNetWh).not.toBeNull();
        expect(row.gridExportNetWh).toBe(0);
      }
      expect(sum(rows, 'gridImportNetWh')).toBeCloseTo(500, 5);
      expect(sum(rows, 'gridExportNetWh')).toBe(0);
    });

    describe('METER_PER_PHASE coverage is its own column, never the meter-total coverage', () => {
      it('covers phase energy when the meter total is unavailable but all three phases are valid', () => {
        const rows = hour({ gridW: null, ...phaseReadings });
        expect(rows).toHaveLength(12);
        for (const row of rows) {
          expect(row.gridImportPhaseWh).not.toBeNull();
          expect(row.gridExportPhaseWh).not.toBeNull();
          expect(row.gridPhaseCoveredSec).toBeCloseTo(300, 5);
          expect(row.gridCoveredSec).toBe(0);
          expect(row.gridImportNetWh).toBeNull();
        }
      });

      it('reports no phase coverage when the meter total is valid but one phase is unavailable', () => {
        const rows = hour({ gridW: 500, ...phaseReadings, gridBW: null });
        expect(rows).toHaveLength(12);
        for (const row of rows) {
          expect(row.gridImportPhaseWh).toBeNull();
          expect(row.gridExportPhaseWh).toBeNull();
          expect(row.gridPhaseCoveredSec).toBe(0);
          expect(row.gridCoveredSec).toBeCloseTo(300, 5);
        }
      });

      it('gives both candidates the same coverage when the total and all phases are valid', () => {
        const rows = hour({ gridW: 500, ...phaseReadings });
        expect(rows).toHaveLength(12);
        for (const row of rows) {
          expect(row.gridPhaseCoveredSec).toBeCloseTo(300, 5);
          expect(row.gridCoveredSec).toBeCloseTo(300, 5);
          expect(row.gridPhaseCoveredSec).toBe(row.gridCoveredSec);
        }
      });

      it('counts only the time all three phases are valid inside a bucket, never a sum or the total coverage', () => {
        // One bucket, 10 s samples at t = 0..300 s. Phase B is missing for t <= 100 s, so the
        // intervals starting at 110 s and later (190 s) are the only ones with all phases valid;
        // the meter total is valid throughout. Phase A/C stay valid for the whole bucket.
        const samples = Array.from({ length: 31 }, (_, i) =>
          sample(i * 10_000, {
            gridW: 500,
            ...phaseReadings,
            gridBW: i * 10_000 <= 100_000 ? null : phaseReadings.gridBW,
          }),
        );
        const row = computeRange(input(samples)).rows[0]!;
        expect(row.gridCoveredSec).toBeCloseTo(300, 5);
        expect(row.gridPhaseCoveredSec).toBeCloseTo(190, 5);
        expect(row.gridImportPhaseWh).not.toBeNull();
      });

      it('keeps meter-total coverage independent of the phase gap in the opposite direction', () => {
        // Total missing for t <= 100 s; all phases valid throughout.
        const samples = Array.from({ length: 31 }, (_, i) =>
          sample(i * 10_000, {
            gridW: i * 10_000 <= 100_000 ? null : 500,
            ...phaseReadings,
          }),
        );
        const row = computeRange(input(samples)).rows[0]!;
        expect(row.gridCoveredSec).toBeCloseTo(190, 5);
        expect(row.gridPhaseCoveredSec).toBeCloseTo(300, 5);
      });

      // Constant 2000 W import / 1500 W export across the three phases (see phaseReadings).
      it.each([
        [
          'a CLOCK_STEP sample splits two intervals out of the bucket',
          (i: number) => [i * 10_000, i === 10 ? SampleFlag.CLOCK_STEP : 0],
          280,
        ],
        [
          'a gap longer than maxGapSec splits one interval out of the bucket',
          (i: number) => [i < 10 ? i * 10_000 : (i + 6) * 10_000, 0],
          230,
        ],
      ] as const)(
        'lowers gridPhaseCoveredSec together with the phase energy when %s',
        (_name, at, covered) => {
          const samples = Array.from({ length: 31 }, (_, i) => {
            const [tMs, flags] = at(i);
            return sample(tMs, { gridW: 500, ...phaseReadings, flags });
          }).filter((s) => s.tMs <= 300_000);
          const row = computeRange(input(samples)).rows[0]!;
          expect(row.gridPhaseCoveredSec).toBeCloseTo(covered, 5);
          expect(row.gridCoveredSec).toBeCloseTo(covered, 5);
          expect(row.gridImportPhaseWh).toBeCloseTo((2000 * covered) / 3600, 5);
          expect(row.gridExportPhaseWh).toBeCloseTo((1500 * covered) / 3600, 5);
          expect(row.flags & LedgerFlag.GRID_GAP).toBeTruthy();
        },
      );
    });
  });

  it('V5 is deterministic, and CLOCK_STEP excludes backward-observed readings', () => {
    const samples = [
      sample(0),
      sample(10_000, { flags: SampleFlag.CLOCK_STEP }),
      sample(20_000),
    ];
    const args = input(samples);
    expect(computeRange(args)).toEqual(computeRange(args));
    const row = computeRange(args).rows[0];
    expect(row.gridImportNetWh).toBeNull();
    expect(row.gridCoveredSec).toBe(0);
    expect(row.flags & LedgerFlag.GRID_GAP).toBeTruthy();
  });

  it('attributes buckets by their original last observation, including seed and counter-only buckets, regardless of replay extent', () => {
    const samples = [
      gridReading(100, 1000),
      gridReading(10_200, 1100),
      { ...gridReading(610_000, 1500), mappingVersion: 2 },
    ];
    const whole = computeRange(input(samples, { toMs: 900_000 }));
    expect(whole.rows.map((row) => row.mappingVersion)).toEqual([1, 1, 2]);
    const narrow = computeRange(input(samples, { toMs: 300_000 }));
    expect(narrow.rows[0]).toEqual(whole.rows[0]);
    const seeded = computeRange(
      input(samples.slice(1), {
        fromMs: 300_000,
        toMs: 900_000,
        counterStates: whole.rows[0]!.counterState,
      }),
    );
    expect(seeded.rows.map((row) => row.mappingVersion)).toEqual([1, 2]);
    expect(samples.map((s) => s.mappingVersion)).toEqual([1, 1, 2]);
  });

  describe('battery integration validates the block of the sample mapping source', () => {
    const bucket = (
      source: LedgerSample['batteryPowerSource'],
      flags: number,
    ) =>
      computeRange(
        input([
          sample(0, { batteryPowerSource: source, batteryW: 1200, flags }),
          sample(10_000, { batteryPowerSource: source, batteryW: 1200, flags }),
        ]),
      ).rows[0]!;

    it('keeps BMS battery energy, coverage and average while only block 0 is invalid', () => {
      const row = bucket('BMS_1914', SampleFlag.BLOCK_INVALID_0);
      expect(row.batDischargeIntWh).toBeCloseTo((1200 * 10) / 3600, 9);
      expect(row.batChargeIntWh).toBe(0);
      expect(row.batCoveredSec).toBe(10);
      expect(row.batAvgW).toBe(1200);
      expect(row.flags & LedgerFlag.BAT_GAP).toBe(0);
      // Block 0 still masks what it carries: PV and derived load; SOC comes from block 1800.
      expect(row.pvIntWh).toBeNull();
      expect(row.pvCoveredSec).toBe(0);
      expect(row.loadDerivedWh).toBeNull();
      expect(row.socMin).toBe(50);
      expect(row.socLast).toBe(50);
    });

    it('masks BMS battery when its own block 1800 is invalid, keeping PV', () => {
      const row = bucket('BMS_1914', SampleFlag.BLOCK_INVALID_1800);
      expect(row.batDischargeIntWh).toBeNull();
      expect(row.batCoveredSec).toBe(0);
      expect(row.flags & LedgerFlag.BAT_GAP).toBeTruthy();
      expect(row.socMin).toBeNull();
      expect(row.pvIntWh).toBeCloseTo((400 * 10) / 3600, 9);
    });

    it('keeps G3 battery while only block 1800 is invalid, and masks it for block 0', () => {
      const meterDown = bucket(
        'BAT1_POWER_G3_50',
        SampleFlag.BLOCK_INVALID_1800,
      );
      expect(meterDown.batDischargeIntWh).toBeCloseTo((1200 * 10) / 3600, 9);
      expect(meterDown.batCoveredSec).toBe(10);
      expect(meterDown.socMin).toBeNull();
      const inverterDown = bucket(
        'BAT1_POWER_G3_50',
        SampleFlag.BLOCK_INVALID_0,
      );
      expect(inverterDown.batDischargeIntWh).toBeNull();
      expect(inverterDown.batCoveredSec).toBe(0);
      expect(inverterDown.socMin).toBe(50);
    });

    it.each(['BMS_1914', 'BAT1_POWER_G3_50'] as const)(
      'masks %s battery when both blocks are invalid',
      (source) => {
        const row = bucket(
          source,
          SampleFlag.BLOCK_INVALID_0 | SampleFlag.BLOCK_INVALID_1800,
        );
        expect(row.batDischargeIntWh).toBeNull();
        expect(row.batCoveredSec).toBe(0);
      },
    );
  });

  it('retains each historical sample battery source when the bucket representative mapping changes', () => {
    const row = computeRange(
      input([
        sample(0, {
          mappingVersion: 1,
          batteryPowerSource: 'BMS_1914',
          batteryW: 1200,
          flags: SampleFlag.BLOCK_INVALID_0,
        }),
        sample(10_000, {
          mappingVersion: 1,
          batteryPowerSource: 'BMS_1914',
          batteryW: 1200,
          flags: SampleFlag.BLOCK_INVALID_0,
        }),
        sample(20_000, {
          mappingVersion: 2,
          batteryPowerSource: 'BAT1_POWER_G3_50',
          batteryW: 600,
          flags: SampleFlag.BLOCK_INVALID_1800,
        }),
        sample(30_000, {
          mappingVersion: 2,
          batteryPowerSource: 'BAT1_POWER_G3_50',
          batteryW: 600,
          flags: SampleFlag.BLOCK_INVALID_1800,
        }),
      ]),
    ).rows[0]!;
    expect(row.mappingVersion).toBe(2);
    expect(row.batDischargeIntWh).toBeCloseTo(7.5, 9);
    expect(row.batCoveredSec).toBe(30);
    expect(row.socCoveredSec).toBe(20);
  });

  describe('SOC observation coverage is independent of battery power', () => {
    it.each(['BMS_1914', 'BAT1_POWER_G3_50'] as const)(
      'counts unique valid ten-second slots for %s without filling integration gaps',
      (batteryPowerSource) => {
        const row = computeRange(
          input([
            sample(100, {
              batteryPowerSource,
              flags: SampleFlag.BLOCK_INVALID_0,
              batterySoc: 45,
            }),
            sample(9000, { batteryPowerSource, batterySoc: 55 }),
            sample(10_200, {
              batteryPowerSource,
              flags: SampleFlag.BLOCK_INVALID_1800,
              batterySoc: 99,
            }),
            sample(20_000, {
              batteryPowerSource,
              flags: SampleFlag.CLOCK_STEP,
              batterySoc: 99,
            }),
            sample(30_000, { batteryPowerSource, batterySoc: null }),
            sample(60_000, { batteryPowerSource, batterySoc: 60 }),
            sample(299_999, { batteryPowerSource, batterySoc: 40 }),
            sample(300_000, { batteryPowerSource, batterySoc: 99 }),
          ]),
        ).rows[0]!;
        expect(row.socCoveredSec).toBe(30);
        expect(row.socMin).toBe(40);
        expect(row.socMax).toBe(60);
        expect(row.socLast).toBe(40);
      },
    );
    it.each(['BATTERY', 'ALL'] as const)(
      'honors %s exclusions without inventing SOC zeroes',
      (family) => {
        const row = computeRange(
          input([sample(0), sample(10_000)], {
            exclusions: [{ fromMs: 0, toMs: 20_000, families: [family] }],
          }),
        ).rows[0]!;
        expect(row.socCoveredSec).toBe(0);
        expect(row.socMin).toBeNull();
        expect(row.socMax).toBeNull();
        expect(row.socLast).toBeNull();
      },
    );
  });

  it('V7 leaves valid counters independent of a down grid meter, then gap-allocates a missing block', () => {
    const samples = Array.from({ length: 121 }, (_, i) =>
      sample(i * 10_000, {
        flags: i >= 30 && i <= 90 ? SampleFlag.METER_LINK_DOWN : 0,
        counters: {
          PV: null,
          GRID_BUY: 1000 + i * 5,
          GRID_SELL: null,
          BAT_CHARGE: null,
          BAT_DISCHARGE: null,
          LOAD_USE: null,
        },
      }),
    );
    const healthy = computeRange(input(samples, { toMs: 1_200_000 }));
    expect(sum(healthy.rows, 'gridCoveredSec')).toBeLessThan(600);
    expect(sum(healthy.rows, 'gridImportCounterWh')).toBe(600);
    expect(
      healthy.rows.some(
        (row) =>
          row.gridImportNetWh === null && row.gridImportCounterWh !== null,
      ),
    ).toBe(true);
    expect(
      healthy.rows.every(
        (row) =>
          row.counterGapAllocMask === 0 &&
          !(row.flags & LedgerFlag.COUNTER_GAP_ALLOCATED),
      ),
    ).toBe(true);
    const missing = samples.map((s, i) =>
      i >= 30 && i <= 90
        ? { ...s, flags: s.flags | SampleFlag.BLOCK_INVALID_2000 }
        : s,
    );
    const gap = computeRange(input(missing, { toMs: 1_200_000 }));
    expect(sum(gap.rows, 'gridImportCounterWh')).toBe(600);
    expect(
      gap.rows
        .filter(
          (row) => row.bucketStartMs >= 300_000 && row.bucketStartMs < 900_000,
        )
        .every((row) => row.counterGapAllocMask & (1 << 1)),
    ).toBe(true);
  });

  it('marks the complement of accepted counter spans unknown, then restores bridged coverage', () => {
    const blocked = [
      sample(0, { flags: SampleFlag.BLOCK_INVALID_2000 }),
      sample(300_000, { flags: SampleFlag.BLOCK_INVALID_2000 }),
    ];
    const noCounters = computeRange(input(blocked));
    expect(noCounters.rows[0].gridImportCounterWh).toBeNull();
    expect(noCounters.rows[0].counterUnknownSec[1]).toBe(300);
    const beginsMidBucket = computeRange(
      input([sample(60_000, { flags: SampleFlag.BLOCK_INVALID_2000 })]),
    );
    expect(beginsMidBucket.rows[0].counterUnknownSec[1]).toBe(240);

    const baseline = sample(0, {
      counters: {
        PV: null,
        GRID_BUY: 1000,
        GRID_SELL: null,
        BAT_CHARGE: null,
        BAT_DISCHARGE: null,
        LOAD_USE: null,
      },
    });
    const unconfirmed = computeRange(input([baseline, sample(300_000)]));
    expect(unconfirmed.rows[0].counterUnknownSec[1]).toBe(300);
    const bridge = computeRange(
      input(
        [
          baseline,
          sample(300_000, {
            counters: {
              PV: null,
              GRID_BUY: 1500,
              GRID_SELL: null,
              BAT_CHARGE: null,
              BAT_DISCHARGE: null,
              LOAD_USE: null,
            },
          }),
        ],
        { toMs: 600_000 },
      ),
    );
    expect(bridge.rows[0].counterUnknownSec[1]).toBe(0);
    expect(bridge.rows[0].gridImportCounterWh).toBe(500);
    expect(bridge.rows[1].counterUnknownSec[1]).toBe(300);
  });

  it('V23(c) widens a delayed accepted span and marks every traversed bucket', () => {
    const sixHours = 6 * 3_600_000;
    const seeded = computeRange(
      input(
        [
          sample(sixHours + 10_000, {
            counters: {
              PV: null,
              GRID_BUY: 1610,
              GRID_SELL: null,
              BAT_CHARGE: null,
              BAT_DISCHARGE: null,
              LOAD_USE: null,
            },
          }),
        ],
        {
          fromMs: sixHours,
          toMs: sixHours + BUCKET_MS,
          counterStates: {
            PV: {
              segment: 0,
              deviceId: null,
              last: null,
              confirmed: false,
              pending: [],
            },
            GRID_BUY: {
              segment: 0,
              deviceId: 1,
              last: { v: 1010, tMs: 10_000 },
              confirmed: true,
              pending: [],
            },
            GRID_SELL: {
              segment: 0,
              deviceId: null,
              last: null,
              confirmed: false,
              pending: [],
            },
            BAT_CHARGE: {
              segment: 0,
              deviceId: null,
              last: null,
              confirmed: false,
              pending: [],
            },
            BAT_DISCHARGE: {
              segment: 0,
              deviceId: null,
              last: null,
              confirmed: false,
              pending: [],
            },
            LOAD_USE: {
              segment: 0,
              deviceId: null,
              last: null,
              confirmed: false,
              pending: [],
            },
          },
        },
      ),
    );
    expect(seeded.writeFromMs).toBe(0);
    const full = computeRange(
      input(
        [
          sample(0, {
            counters: {
              PV: null,
              GRID_BUY: 1000,
              GRID_SELL: null,
              BAT_CHARGE: null,
              BAT_DISCHARGE: null,
              LOAD_USE: null,
            },
          }),
          sample(10_000, {
            counters: {
              PV: null,
              GRID_BUY: 1010,
              GRID_SELL: null,
              BAT_CHARGE: null,
              BAT_DISCHARGE: null,
              LOAD_USE: null,
            },
          }),
          sample(sixHours + 10_000, {
            counters: {
              PV: null,
              GRID_BUY: 1610,
              GRID_SELL: null,
              BAT_CHARGE: null,
              BAT_DISCHARGE: null,
              LOAD_USE: null,
            },
          }),
        ],
        { toMs: sixHours + BUCKET_MS },
      ),
    );
    expect(sum(full.rows, 'gridImportCounterWh')).toBeCloseTo(610, 7);
    expect(
      full.rows
        .filter((row) => row.bucketStartMs < sixHours + BUCKET_MS)
        .every((row) => row.counterGapAllocMask & (1 << 1)),
    ).toBe(true);
  });

  it('widening a split with a nonzero counter transition reproduces the unsplit ledger', () => {
    const samples = Array.from({ length: 61 }, (_, i) =>
      sample(i * 10_000, {
        counters: {
          PV: null,
          GRID_BUY: 1000 + i * 10,
          GRID_SELL: null,
          BAT_CHARGE: null,
          BAT_DISCHARGE: null,
          LOAD_USE: null,
        },
      }),
    );
    const whole = computeRange(input(samples, { toMs: 600_000 }));
    const first = computeRange(
      input(
        samples.filter((s) => s.tMs <= 300_000),
        { toMs: 300_000 },
      ),
    );
    const second = computeRange(
      input(
        samples.filter((s) => s.tMs >= 290_000),
        {
          fromMs: 300_000,
          toMs: 600_000,
          counterStates: first.endCounterStates,
        },
      ),
    );
    // Previewing the 300 s reading credits the 290→300 s 10 Wh delta to
    // the prior bucket; the worker still honors writeFromMs to converge states.
    expect(second.writeFromMs).toBe(0);
    expect(
      sum([...first.rows, ...second.rows], 'gridImportCounterWh'),
    ).toBeCloseTo(sum(whole.rows, 'gridImportCounterWh'), 8);
    const rerun = computeRange(
      input(samples, { fromMs: second.writeFromMs, toMs: 600_000 }),
    );
    expect(rerun.rows).toEqual(whole.rows);
    expect(second.endCounterStates).toEqual(whole.endCounterStates);
  });

  it('exclusions invalidate only the selected family and preserve negative derived flow', () => {
    const result = computeRange(
      input(
        [
          sample(0, { gridW: -20, inverterAcW: -20 }),
          sample(10_000, { gridW: -20, inverterAcW: -20 }),
        ],
        { exclusions: [{ fromMs: 0, toMs: 10_000, families: ['PV'] }] },
      ),
    );
    expect(result.rows[0].pvIntWh).toBeNull();
    expect(result.rows[0].pvAvgW).toBe(400); // The endpoint at the exclusive exclusion boundary is valid.
    expect(result.rows[0].gridExportNetWh).toBeCloseTo(20 / 360, 8);
    expect(result.rows[0].loadDerivedWh).toBeCloseTo(-40 / 360, 8);
  });

  it('a GRID exclusion also invalidates derived load, not the LOAD_USE counter', () => {
    const use = (v: number) => ({
      PV: null,
      GRID_BUY: null,
      GRID_SELL: null,
      BAT_CHARGE: null,
      BAT_DISCHARGE: null,
      LOAD_USE: v,
    });
    const result = computeRange(
      input(
        [
          sample(0, { counters: use(1000) }),
          sample(10_000, { counters: use(1100) }),
        ],
        { exclusions: [{ fromMs: 0, toMs: 10_000, families: ['GRID'] }] },
      ),
    );
    expect(result.rows[0].gridImportNetWh).toBeNull();
    expect(result.rows[0].loadDerivedWh).toBeNull();
    expect(result.rows[0].loadCoveredSec).toBe(0);
    expect(result.rows[0].loadCounterWh).toBe(100);
  });

  it('an excluded accepted span advances the confirmed baseline without creating a segment', () => {
    const values = [1000, 1100, 33_768_500, 1200, 1300];
    const samples = values.map((v, i) =>
      sample(i * 10_000, {
        counters: {
          PV: null,
          GRID_BUY: v,
          GRID_SELL: null,
          BAT_CHARGE: null,
          BAT_DISCHARGE: null,
          LOAD_USE: null,
        },
      }),
    );
    const initial = input(samples, {
      exclusions: [{ fromMs: 5_000, toMs: 6_000, families: ['GRID'] }],
    });
    const result = computeRange(initial);
    expect(result.rows[0].gridImportCounterWh).toBe(200);
    expect(result.events.map((event) => event.kind)).toEqual([
      'COUNTER_JUMP_REJECTED',
    ]);
    expect(result.endCounterStates.GRID_BUY).toMatchObject({
      segment: 0,
      confirmed: true,
      last: { v: 1300, tMs: 40_000 },
    });
    expect(result.rows[0].counterUnknownSec[1]).toBe(270);
  });

  it('flags TOU uncertainty at wall-clock boundaries across both Berlin DST transitions', () => {
    for (const [date, minute] of [
      ['2026-03-29T12:10:00Z', 14 * 60],
      ['2026-10-25T01:40:00Z', 2 * 60 + 30],
    ] as const) {
      const end = Date.parse(date);
      const start = end - 20 * 60_000;
      const result = computeRange(
        input(
          [
            sample(end, {
              counters: {
                PV: null,
                GRID_BUY: 500,
                GRID_SELL: null,
                BAT_CHARGE: null,
                BAT_DISCHARGE: null,
                LOAD_USE: null,
              },
            }),
          ],
          {
            fromMs: start,
            toMs: end + BUCKET_MS,
            timeZone: 'Europe/Berlin',
            touBoundaryMinutes: [minute],
            counterStates: {
              PV: {
                segment: 0,
                deviceId: null,
                last: null,
                confirmed: false,
                pending: [],
              },
              GRID_BUY: {
                segment: 0,
                deviceId: 1,
                last: { v: 0, tMs: start },
                confirmed: true,
                pending: [],
              },
              GRID_SELL: {
                segment: 0,
                deviceId: null,
                last: null,
                confirmed: false,
                pending: [],
              },
              BAT_CHARGE: {
                segment: 0,
                deviceId: null,
                last: null,
                confirmed: false,
                pending: [],
              },
              BAT_DISCHARGE: {
                segment: 0,
                deviceId: null,
                last: null,
                confirmed: false,
                pending: [],
              },
              LOAD_USE: {
                segment: 0,
                deviceId: null,
                last: null,
                confirmed: false,
                pending: [],
              },
            },
          },
        ),
      );
      expect(sum(result.rows, 'gridImportCounterWh')).toBeCloseTo(500, 8);
      expect(
        result.rows
          .filter((row) => row.counterGapAllocMask & (1 << 1))
          .every((row) => row.flags & LedgerFlag.TOU_UNCERTAIN),
      ).toBe(true);
    }
  });

  it('looks past rejected post-range readings to resolve the crossing interval', () => {
    const samples = [
      gridReading(0, 1000),
      gridReading(10_000, 1100),
      gridReading(310_000, 1_000_000_000),
      gridReading(610_000, 1200),
    ];
    const whole = computeRange(input(samples, { toMs: 900_000 }));
    const prefix = computeRange(input(samples, { toMs: 300_000 }));
    const truncated = computeRange(
      input(samples.slice(0, 3), { toMs: 300_000 }),
    );
    expect(prefix.rows[0].gridImportCounterWh).toBeCloseTo(148.333333, 5);
    expect(prefix.rows[0].gridImportCounterWh).toBeCloseTo(
      whole.rows[0].gridImportCounterWh!,
      8,
    );
    expect(prefix.rows[0].counterUnknownSec[1]).toBe(0);
    expect(prefix.lookaheadUnresolved).toEqual([]);
    expect(truncated.lookaheadUnresolved).toEqual(['GRID_BUY']);
    expect(truncated.rows[0].counterUnknownSec[1]).toBe(290);
    expect(prefix.endCounterStates.GRID_BUY.last).toEqual({
      v: 1100,
      tMs: 10_000,
    });
    expect(prefix.events).toEqual([]);

    const suffix = computeRange(
      input(
        samples.filter((s) => s.tMs >= 310_000),
        {
          fromMs: 300_000,
          toMs: 900_000,
          counterStates: prefix.endCounterStates,
        },
      ),
    );
    expect(suffix.writeFromMs).toBe(0);
    expect(
      sum([...prefix.rows, ...suffix.rows], 'gridImportCounterWh'),
    ).toBeCloseTo(sum(whole.rows, 'gridImportCounterWh'), 8);
  });

  it('resolves post-range discontinuities as unknown and scans arbitrarily many rejected spikes', () => {
    const prefix = [gridReading(0, 1000), gridReading(10_000, 1100)];
    const discontinuity = computeRange(
      input(
        [
          ...prefix,
          gridReading(310_000, 1_000_000),
          gridReading(610_000, 1_000_100),
          gridReading(910_000, 1_000_200),
        ],
        { toMs: 300_000 },
      ),
    );
    expect(discontinuity.lookaheadUnresolved).toEqual([]);
    expect(discontinuity.rows[0].gridImportCounterWh).toBe(100);
    expect(discontinuity.rows[0].counterUnknownSec[1]).toBe(290);
    expect(discontinuity.endCounterStates.GRID_BUY).toMatchObject({
      last: { v: 1100, tMs: 10_000 },
      segment: 0,
    });

    const manyRejected = computeRange(
      input(
        [
          ...prefix,
          gridReading(310_000, 1_000_000_000),
          gridReading(610_000, 2_000_000_000),
          gridReading(910_000, 3_000_000_000),
          gridReading(1_210_000, 1200),
        ],
        { toMs: 300_000 },
      ),
    );
    expect(manyRejected.lookaheadUnresolved).toEqual([]);
    expect(manyRejected.rows[0].gridImportCounterWh).toBeCloseTo(
      124.1666667,
      6,
    );
  });

  it('matches a full run at every split after reset and rejected jump transitions', () => {
    let seed = 92;
    const random = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    let reading = 1000;
    const samples = Array.from({ length: 30 }, (_, i) => {
      if (i === 11) reading = 200;
      else if (i === 18) return gridReading(i * 50_000, 1_000_000_000);
      else if (i > 0) reading += 20 + Math.floor(random() * 50);
      return gridReading(i * 50_000, reading);
    });
    const end = 1_500_000;
    const whole = computeRange(input(samples, { toMs: end }));
    for (let split = BUCKET_MS; split < end; split += BUCKET_MS) {
      const left = computeRange(input(samples, { toMs: split }));
      const right = computeRange(
        input(
          samples.filter((s) => s.tMs >= split - 50_000),
          {
            fromMs: split,
            toMs: end,
            counterStates: left.endCounterStates,
          },
        ),
      );
      const joined = [...left.rows, ...right.rows];
      for (const key of ['gridImportCounterWh', 'gridImportNetWh'] as const)
        expect(sum(joined, key)).toBeCloseTo(sum(whole.rows, key), 7);
      for (const row of whole.rows) {
        const splitRow = joined.find(
          (candidate) => candidate.bucketStartMs === row.bucketStartMs,
        );
        expect(splitRow?.counterUnknownSec[1]).toBe(row.counterUnknownSec[1]);
      }
      expect(left.lookaheadUnresolved).toEqual([]);
      expect(right.endCounterStates).toEqual(whole.endCounterStates);
    }
  });

  it('computes the daily balance percentage and avoids zero-denominator anomalies', () => {
    expect(
      dailyBalanceResidual({
        pvWh: 100,
        batDischargeWh: 0,
        batChargeWh: 0,
        importWh: 0,
        exportWh: 0,
        houseWh: 90,
      }),
    ).toEqual({ residualWh: 10, residualPct: 10, anomaly: false });
    expect(
      dailyBalanceResidual({
        pvWh: 100,
        batDischargeWh: 0,
        batChargeWh: 0,
        importWh: 0,
        exportWh: 0,
        houseWh: 80,
      }),
    ).toEqual({ residualWh: 20, residualPct: 20, anomaly: true });
    expect(
      dailyBalanceResidual({
        pvWh: 100,
        batDischargeWh: 0,
        batChargeWh: 0,
        importWh: 0,
        exportWh: 0,
        houseWh: 110,
      }),
    ).toEqual({ residualWh: -10, residualPct: -10, anomaly: true });
    expect(
      dailyBalanceResidual({
        pvWh: 0,
        batDischargeWh: 0,
        batChargeWh: 0,
        importWh: 0,
        exportWh: 0,
        houseWh: 5,
      }),
    ).toEqual({ residualWh: -5, residualPct: null, anomaly: true });
    expect(
      dailyBalanceResidual({
        pvWh: 0,
        batDischargeWh: 0,
        batChargeWh: 0,
        importWh: 0,
        exportWh: 0,
        houseWh: 0,
      }),
    ).toEqual({ residualWh: 0, residualPct: null, anomaly: false });
  });
});
