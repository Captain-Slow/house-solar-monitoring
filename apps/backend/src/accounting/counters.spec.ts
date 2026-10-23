import { describe, expect, it } from 'vitest';
import { COUNTER_WRAP_WH } from './types.js';
import type { CounterKey, CounterState } from './types.js';
import { initialCounterStates, stepCounter } from './counters.js';

function sequence(key: CounterKey, values: number[], seconds = 1800) {
  let state = initialCounterStates()[key];
  let energy = 0;
  const events: string[] = [];
  const unknown: { fromMs: number; toMs: number }[] = [];
  for (const [i, value] of values.entries()) {
    const step = stepCounter(
      state,
      key,
      { v: value, tMs: i * seconds * 1000, deviceId: 1 },
      { maxGapSec: 30 },
    );
    energy += step.accepted?.deltaWh ?? 0;
    if (step.unknown) unknown.push(step.unknown);
    events.push(...step.events.map((event) => event.kind));
    state = step.state;
  }
  return { energy, state, events, unknown };
}

describe('counter state machine', () => {
  it('V4 treats reset time as unknown then confirms the new segment', () => {
    const result = sequence('GRID_BUY', [1_000_000, 1_000_500, 200, 400]);
    expect(result.energy).toBe(700);
    expect(result.events).toEqual(['COUNTER_RESET']);
    expect(result.unknown).toEqual([{ fromMs: 1_800_000, toMs: 3_600_000 }]);
    expect(result.state).toMatchObject({
      confirmed: true,
      segment: 1,
      last: { v: 400 },
    });
  });

  it('V4 rejects isolated jumps while retaining the last accepted baseline', () => {
    const result = sequence(
      'GRID_BUY',
      [1_000_000, 1_000_100, 33_768_500, 1_000_200],
    );
    expect(result.energy).toBe(200);
    expect(result.events).toEqual(['COUNTER_JUMP_REJECTED']);
    expect(result.state.pending).toEqual([]);
  });

  it('V4 rate limit is in Wh for confirmation, transitions and wrap', () => {
    expect(sequence('GRID_BUY', [0, 500]).energy).toBe(500);
    expect(sequence('GRID_BUY', [0, 31_000]).energy).toBe(0);
    expect(sequence('GRID_BUY', [0, 500, 31_500]).events).toEqual([
      'COUNTER_JUMP_REJECTED',
    ]);
    const wrap = sequence('GRID_BUY', [
      COUNTER_WRAP_WH - 200,
      COUNTER_WRAP_WH - 100,
      100,
    ]);
    expect(wrap.energy).toBe(300);
    expect(wrap.events).toEqual([]);
    expect(
      sequence('PV', [COUNTER_WRAP_WH - 100, COUNTER_WRAP_WH - 50, 20_000])
        .events,
    ).toContain('COUNTER_JUMP_REJECTED');
  });

  it('replaces an unconfirmed baseline, leaving its time unknown', () => {
    const result = sequence('PV', [100_000, 120_000, 120_100]);
    expect(result.energy).toBe(100);
    expect(result.unknown).toEqual([{ fromMs: 0, toMs: 1_800_000 }]);
    expect(result.events).toEqual([]);
  });

  it('forms a new confirmed segment on the third consecutive mutually consistent rejected reading', () => {
    const state: CounterState = {
      segment: 0,
      deviceId: 1,
      last: { v: 100_000, tMs: 0 },
      confirmed: true,
      pending: [],
    };
    let current = state;
    for (const [i, value] of [200_000, 200_100, 200_200].entries()) {
      const step = stepCounter(
        current,
        'PV',
        { v: value, tMs: (i + 1) * 10_000, deviceId: 1 },
        { maxGapSec: 30 },
      );
      if (i < 2)
        expect(step.events.map((event) => event.kind)).toEqual([
          'COUNTER_JUMP_REJECTED',
        ]);
      else {
        expect(step.events.map((event) => event.kind)).toEqual([
          'COUNTER_DISCONTINUITY',
        ]);
        expect(step.unknown).toEqual({ fromMs: 0, toMs: 30_000 });
      }
      current = step.state;
    }
    expect(current).toMatchObject({
      segment: 1,
      confirmed: true,
      last: { v: 200_200 },
      pending: [],
    });
    expect(
      stepCounter(
        current,
        'PV',
        { v: 200_300, tMs: 40_000, deviceId: 1 },
        { maxGapSec: 30 },
      ).accepted?.deltaWh,
    ).toBe(100);
  });

  it('never differences different device IDs and marks long accepted spans for allocation', () => {
    let state = initialCounterStates().PV;
    state = stepCounter(
      state,
      'PV',
      { v: 1000, tMs: 0, deviceId: 1 },
      { maxGapSec: 30 },
    ).state;
    const different = stepCounter(
      state,
      'PV',
      { v: 10, tMs: 1000, deviceId: 2 },
      { maxGapSec: 30 },
    );
    expect(different).toMatchObject({
      unknown: { fromMs: 0, toMs: 1000 },
      state: { segment: 1, confirmed: false },
    });
    expect(
      stepCounter(
        different.state,
        'PV',
        { v: 510, tMs: 3_601_000, deviceId: 2 },
        { maxGapSec: 30 },
      ).accepted,
    ).toMatchObject({ deltaWh: 500, gapAllocated: true });
  });
});
