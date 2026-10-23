import { describe, expect, it } from 'vitest';
import type { CaptureRecord } from '../modbus/capture.js';
import { encodeBlocks } from '../modbus/raw-poll-codec.js';
import {
  dailyBalance,
  directionalTrapezoid,
  g2Table,
  g3Signs,
  g4Cadence,
  g5Counters,
  main,
  type Signs,
} from './analyze-capture.js';
import { recordFromRow } from './export-samples.js';

const base = {
  pv1_power: 0,
  pv2_power: 0,
  pv3_power: 0,
  pv4_power: 0,
  meter_active_total: 1000,
  meter_active_a: 500,
  meter_active_b: 250,
  meter_active_c: 250,
  inv_active_power_a: 0,
  inv_active_power_b: 0,
  inv_active_power_c: 0,
  backup_active_a: 0,
  backup_active_b: 0,
  backup_active_c: 0,
  load_power_a: 500,
  load_power_b: 250,
  load_power_c: 250,
  bat1_power_g3: 0,
  bat_work_status: 0,
};
function capture(
  at: string,
  decoded: Record<string, number | null> = {},
  words?: number[],
): CaptureRecord {
  return {
    observedAt: at,
    tier: 'FAST',
    decoded: { ...base, ...decoded },
    blocks:
      words === undefined
        ? []
        : [{ fc: 4, start: 1800, count: words.length, words }],
  };
}

function clock(seconds: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, seconds)).toISOString();
}

describe('capture gate analysis', () => {
  it('reports G2 first FAST values and byte-swapped DETECT model', () => {
    const model = 'HIT-10L-G3';
    const words = Array.from(
      { length: 5 },
      (_, i) => model.charCodeAt(i * 2) | (model.charCodeAt(i * 2 + 1) << 8),
    );
    const detect: CaptureRecord = {
      observedAt: clock(0),
      tier: 'DETECT',
      decoded: {},
      blocks: [{ fc: 4, start: 1000, count: 5, words }],
    };
    const text = g2Table([
      detect,
      capture(clock(2), {
        pv_total_energy: 12.3,
        battery_soc: 78,
        meter_grid_voltage_a: 230,
      }),
    ]);
    expect(text).toContain('| model | HIT-10L-G3 | exact |');
    expect(text).toContain('| pv_total_energy | 12.3 kWh | ±0.1 kWh |');
    expect(text).toContain('| battery_soc | 78 % | ±1 % |');
    expect(text).toContain('| meter_grid_voltage_a | 230.0 V | ±2 V |');
  });

  it('chooses battery discharge sign and correct residual hypothesis', () => {
    const records = [
      capture(clock(0), {
        bat1_power_g3: 250,
        bat_work_status: 2,
        meter_active_total: -100,
        meter_active_a: -50,
        meter_active_b: -25,
        meter_active_c: -25,
        inv_active_power_a: 500,
        load_power_a: 600,
        load_power_b: 0,
        load_power_c: 0,
      }),
      capture(clock(10), {
        bat1_power_g3: -250,
        bat_work_status: 1,
        meter_active_total: -100,
        meter_active_a: -50,
        meter_active_b: -25,
        meter_active_c: -25,
        inv_active_power_a: 500,
        load_power_a: 600,
        load_power_b: 0,
        load_power_c: 0,
      }),
    ];
    const report = g3Signs(records);
    expect(report).toContain('raw positive=discharge agreement 100.00%');
    expect(report).toContain('raw positive=charge agreement 0.00%');
    expect(report).toContain('(-1,+1): 0.00 W');
    expect(report).toContain('Best: -1,+1 (0.00 W); >=3x separation: yes');
  });

  it('requires 30 minutes of contiguous eligible grid samples and every phase importing', () => {
    const records = Array.from({ length: 181 }, (_, i) =>
      capture(new Date(Date.UTC(2026, 0, 1) + i * 10_000).toISOString()),
    );
    const report = g3Signs(records);
    expect(report).toContain('Grid import window: 30.00 min (>=30 min: yes)');
    expect(report).toContain('all import: yes');
    records[60]!.decoded.meter_active_b = -1;
    expect(g3Signs(records)).toContain('all import: no');
  });

  it('detects meter update cadence and retains 2-second versus 10-second decimation with a final partial interval', () => {
    const records = Array.from({ length: 12 }, (_, i) =>
      capture(
        clock(i * 2),
        {},
        Array.from({ length: 28 }, (_, j) => (j === 0 ? Math.floor(i / 2) : 0)),
      ),
    );
    for (const record of records) record.tier = 'DETECT'; // cadence probes need not be FAST
    const report = g4Cadence(records);
    expect(report).toContain('n=5; median 4.00 s; p90 4.00 s');
    expect(report).toContain(
      'max repeat span 2.00 s; holes 0; recommended maxRepeatSpanSec=30.00',
    );
    expect(report).toContain(
      'Grid: all 6.111 Wh, every 5th 6.111 Wh, difference 0.00%',
    );
    expect(report).toContain('Derived load: all 6.111 Wh, every 5th 6.111 Wh');
    expect(report).toContain('nominal 2.00 s vs 10.00 s');
  });

  it('compares constant-load full captures at 10 seconds versus 20 seconds, never 50 seconds', () => {
    const records = Array.from({ length: 721 }, (_, i) =>
      capture(clock(i * 10), { inv_active_power_a: 2000 }),
    );
    const report = g4Cadence(records);
    expect(report).toContain('nominal 10.00 s vs 20.00 s');
    expect(report).toContain(
      'Grid: all 2000.000 Wh, every 2nd 2000.000 Wh, difference 0.00%',
    );
    expect(report).toContain(
      'Derived load: all 6000.000 Wh, every 2nd 6000.000 Wh, difference 0.00% (<1%: yes)',
    );
    expect(report).not.toContain('every 5th');
  });

  it('retains the final full-capture endpoint when 20-second decimation leaves a partial interval', () => {
    const records = [0, 10, 20, 30].map((seconds) =>
      capture(clock(seconds), { inv_active_power_a: 2000 }),
    );
    expect(g4Cadence(records)).toContain(
      'Derived load: all 25.000 Wh, every 2nd 25.000 Wh, difference 0.00%',
    );
  });

  it('does not pass a cadence comparison without a complete decimation interval', () => {
    const records = [0, 2, 4].map((seconds) => capture(clock(seconds)));
    const report = g4Cadence(records);
    expect(report).toContain('difference n/a (<1%: n/a');
    expect(report).toContain('insufficient complete shared data');
    expect(report).not.toContain('<1%: yes');
  });

  it('does not compare different covered spans when a full capture has missing intermediate load', () => {
    const records = [0, 10, 20, 30, 40].map((seconds) =>
      capture(clock(seconds), {
        inv_active_power_a: seconds === 10 ? null : 2000,
      }),
    );
    const report = g4Cadence(records);
    expect(report).toContain(
      'Derived load: all 16.667 Wh, every 2nd 33.333 Wh, difference n/a (<1%: n/a',
    );
  });

  it('splits zero-crossing energy by direction rather than netting', () => {
    expect(directionalTrapezoid(1000, -1000, 10)).toEqual({
      positiveWh: (2.5 / 3600) * 1000,
      negativeWh: (2.5 / 3600) * 1000,
    });
  });

  it('compares counters over their window and detects local midnight daily-register reset', () => {
    const a = capture('2026-01-01T15:59:50.000Z', {
      pv1_power: 1000,
      pv_total_energy: 10,
      grid_buy_energy: 20,
      pv_today_energy: 5,
    });
    const b = capture('2026-01-01T16:00:10.000Z', {
      pv1_power: 1000,
      pv_total_energy: 10.1,
      grid_buy_energy: 20.1,
      pv_today_energy: 0,
    });
    const counters = g5Counters([a, b], 'Asia/Kuala_Lumpur');
    expect(counters).toContain(
      '| pv_total_energy | 0.100 | 0.006 | 18.000 | 20 |',
    );
    expect(counters).toContain(
      '| grid_buy_energy vs meter | 0.100 | 0.006 | 18.000 | 20 |',
    );
    expect(counters).toContain(
      '| pv_today_energy | 2026-01-02T00:00:10.000+08:00 | yes |',
    );
    const balance = dailyBalance([a, b]);
    expect(balance).toContain(
      '| 2026-01-01 | 2.778 | 0.000 | 0.000 | 2.778 | 0.000 | 2.778 | 2.778 | 50.00% | 10 | BALANCE_ANOMALY |',
    );
    expect(balance).toContain(
      '| 2026-01-02 | 2.778 | 0.000 | 0.000 | 2.778 | 0.000 | 2.778 | 2.778 | 50.00% | 10 | BALANCE_ANOMALY |',
    );
  });

  it('clips integration to counter observations and keeps source families independent', () => {
    const samples = [0, 10, 20].map((seconds) =>
      capture(clock(seconds), { bat1_power_g3: null }),
    );
    const first = capture(clock(5), {
      pv_total_energy: 20,
      grid_buy_energy: 30,
    });
    const last = capture(clock(15), {
      pv_total_energy: 20.1,
      grid_buy_energy: 30.1,
    });
    first.tier = 'SLOW';
    last.tier = 'SLOW';
    const report = g5Counters([
      samples[2]!,
      last,
      samples[0]!,
      first,
      samples[1]!,
    ]);
    expect(report).toContain(
      '| grid_buy_energy vs meter | 0.100 | 0.003 | 36.000 | 10 |',
    );
    expect(report).toContain('| pv_total_energy | 0.100 | 0.000 | n/a | 10 |');
  });

  it('reports missing cadence load as unknown rather than zero energy', () => {
    const records = [0, 2, 4, 6, 8, 10].map((seconds) => ({
      observedAt: clock(seconds),
      tier: 'DETECT' as const,
      decoded: {},
      blocks: [
        {
          fc: 4 as const,
          start: 1800,
          count: 28,
          words: Array(28).fill(0) as number[],
        },
      ],
    }));
    const report = g4Cadence(records);
    expect(report).toContain(
      'Derived load: all n/a Wh, every 5th n/a Wh, difference n/a',
    );
  });

  it('counts standby as disagreement and reports null statuses excluded', () => {
    const records = Array.from({ length: 101 }, (_, i) =>
      capture(clock(i * 10), {
        bat1_power_g3: 1000,
        bat_work_status: i < 98 ? 2 : i < 100 ? 0 : null,
      }),
    );
    const report = g3Signs(records);
    // 98 agree, 2 standby disagree, 1 null status also counts against the gate
    expect(report).toContain('n=101 (status known 100, null status 1');
    expect(report).toContain('raw positive=discharge agreement 97.03%');
    expect(report).toContain('raw positive=charge agreement 0.00%');
    expect(report).toContain('>=99%: neither');
  });

  it('does not pass the battery gate when almost every status is missing', () => {
    const records = Array.from({ length: 100 }, (_, i) =>
      capture(clock(i * 10), {
        bat1_power_g3: 1000,
        bat_work_status: i === 0 ? 2 : null,
      }),
    );
    const report = g3Signs(records);
    expect(report).toContain('raw positive=discharge agreement 1.00%');
    expect(report).toContain('>=99%: neither');
  });

  it('retains 90-second changes but skips capture holes when measuring cadence', () => {
    const continuous = Array.from({ length: 91 }, (_, i) =>
      capture(
        clock(i * 2),
        {},
        Array.from({ length: 28 }, (_, j) =>
          j === 0 ? Math.floor(i / 45) : 0,
        ),
      ),
    );
    const report = g4Cadence(continuous);
    expect(report).toContain('n=2; median 90.00 s; p90 90.00 s');
    expect(report).toContain('holes 0; recommended maxRepeatSpanSec=180.00');
    const withHole = [0, 2, 4, 100, 102, 104].map((s, i) =>
      capture(
        clock(s),
        {},
        Array.from({ length: 28 }, (_, j) =>
          j === 0 ? (i < 3 ? 0 : i < 5 ? 1 : 2) : 0,
        ),
      ),
    );
    const holeReport = g4Cadence(withHole);
    expect(holeReport).toContain('n=1; median 4.00 s');
    expect(holeReport).toContain('holes 1');
  });

  it('compares grid counters against meter and register 2165 independently', () => {
    const records = Array.from({ length: 13 }, (_, i) =>
      capture(clock(i * 30), {
        grid_active_power_total: 2000,
        ...(i === 0
          ? { grid_buy_energy: 20 }
          : i === 12
            ? { grid_buy_energy: 20.1 }
            : {}),
      }),
    );
    const report = g5Counters(records);
    expect(report).toContain(
      '| grid_buy_energy vs meter | 0.100 | 0.100 | 1.000 | 360 |',
    );
    expect(report).toContain(
      '| grid_buy_energy vs 2165 | 0.100 | 0.200 | 0.500 | 360 |',
    );
    const reversed = records.map((r) =>
      capture(r.observedAt, {
        ...r.decoded,
        meter_active_total: -1000,
        grid_active_power_total: -2000,
        grid_sell_energy: r.decoded.grid_buy_energy ?? null,
        grid_buy_energy: null,
      }),
    );
    const sell = g5Counters(reversed);
    expect(sell).toContain(
      '| grid_sell_energy vs meter | 0.100 | 0.100 | 1.000 | 360 |',
    );
    expect(sell).toContain(
      '| grid_sell_energy vs 2165 | 0.100 | 0.200 | 0.500 | 360 |',
    );
  });

  it('applies configured signs to canonical load, battery and grid accounting', () => {
    const signs: Signs = { grid: 1, inverter: 1, battery: -1 };
    const first = capture(clock(0), {
      meter_active_total: 0,
      inv_active_power_a: 1000,
      bat1_power_g3: -1000,
      bat_work_status: 2,
      bat_discharge_energy: 10,
    });
    const last = capture(clock(20), {
      meter_active_total: 0,
      inv_active_power_a: 1000,
      bat1_power_g3: -1000,
      bat_work_status: 2,
      bat_discharge_energy: 10.1,
    });
    const balance = dailyBalance([first, last], 'Asia/Kuala_Lumpur', signs);
    expect(balance).toContain(
      '| 2026-01-01 | 0.000 | 5.556 | 0.000 | 0.000 | 0.000 | 5.556 | 0.000 | 0.00% | 20 | — |',
    );
    expect(g5Counters([first, last], 'Asia/Kuala_Lumpur', signs)).toContain(
      '| bat_discharge_energy | 0.100 | 0.006 | 18.000 | 20 |',
    );
    expect(g5Counters([first, last])).toContain(
      '| bat_discharge_energy | 0.100 | 0.000 | n/a | 20 |',
    );
    expect(g3Signs([first, last], signs)).toContain(
      'Canonical signed-load residual median: 0.00 W.',
    );

    const reversed = [0, 10].map((sec) =>
      capture(clock(sec), {
        meter_active_total: -1000,
        inv_active_power_a: -2000,
        grid_active_power_total: -2000,
        load_power_a: 3000,
        load_power_b: 0,
        load_power_c: 0,
        grid_buy_energy: sec === 0 ? 1 : 1.1,
      }),
    );
    const inverted: Signs = { grid: -1, inverter: -1, battery: 1 };
    expect(g4Cadence(reversed, inverted)).toContain(
      'Derived load: all 8.333 Wh',
    );
    expect(g3Signs(reversed, inverted)).toContain(
      'Canonical signed-load residual median: 0.00 W.',
    );
    expect(g5Counters(reversed, 'Asia/Kuala_Lumpur', inverted)).toContain(
      '| grid_buy_energy vs 2165 | 0.100 | 0.006 | 18.000 | 10 |',
    );
    expect(dailyBalance(reversed, 'Asia/Kuala_Lumpur', inverted)).toContain(
      '| 2026-01-01 | 0.000 | 0.000 | 0.000 | 2.778 | 0.000 | 8.333 | -5.556 | -200.00% | 10 | BALANCE_ANOMALY |',
    );
    expect(() => main(['missing.jsonl', '--grid-sign', '0'])).toThrow(
      '--grid-sign must be 1 or -1',
    );
  });

  it('exports a DB row as capture JSONL shape with decoded blocks', () => {
    const row = {
      id: '42',
      observedAt: new Date(clock(10)),
      requestedAt: new Date(clock(9)),
      receivedAt: new Date(clock(11)),
      tier: 'FAST' as const,
      blocks: encodeBlocks([
        { fc: 4, start: 1814, count: 2, words: [0, 1000] },
        { fc: 4, start: 2000, count: 2, words: null },
      ]),
    };
    const record = recordFromRow(row);
    expect(record).toEqual({
      observedAt: clock(10),
      tier: 'FAST',
      requestedAt: clock(9),
      receivedAt: clock(11),
      blocks: [
        { fc: 4, start: 1814, count: 2, words: [0, 1000] },
        { fc: 4, start: 2000, count: 2, words: null },
      ],
      decoded: { meter_active_total: 1000 },
    });
  });
});
