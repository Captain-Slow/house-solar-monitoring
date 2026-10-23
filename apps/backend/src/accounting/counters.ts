import {
  COUNTER_RATE_KW,
  COUNTER_RESET_MAX_WH,
  COUNTER_WRAP_WH,
} from './types.js';
import type {
  CounterKey,
  CounterState,
  CounterStates,
  LedgerEvent,
} from './types.js';

export function initialCounterStates(): CounterStates {
  const empty = (): CounterState => ({
    segment: 0,
    deviceId: null,
    last: null,
    confirmed: false,
    pending: [],
  });
  return {
    PV: empty(),
    GRID_BUY: empty(),
    GRID_SELL: empty(),
    BAT_CHARGE: empty(),
    BAT_DISCHARGE: empty(),
    LOAD_USE: empty(),
  };
}

export function stepCounter(
  state: CounterState,
  key: CounterKey,
  reading: { v: number; tMs: number; deviceId: number },
  ctx: { maxGapSec: number },
): {
  state: CounterState;
  accepted?: {
    deltaWh: number;
    fromMs: number;
    toMs: number;
    gapAllocated: boolean;
  };
  unknown?: { fromMs: number; toMs: number };
  events: LedgerEvent[];
} {
  const { v, tMs, deviceId } = reading;
  const candidate = { v, tMs };
  const limit = (fromMs: number, toMs: number): number =>
    (1000 * COUNTER_RATE_KW[key] * (toMs - fromMs)) / 3_600_000 + 200;
  const event = (kind: LedgerEvent['kind']): LedgerEvent => ({
    kind,
    counter: key,
    atMs: tMs,
    details: { valueWh: v, segment: state.segment },
  });
  const unknown =
    state.last && tMs > state.last.tMs
      ? { fromMs: state.last.tMs, toMs: tMs }
      : undefined;
  if (state.deviceId !== null && state.deviceId !== deviceId) {
    return {
      state: {
        segment: state.segment + 1,
        deviceId,
        last: candidate,
        confirmed: false,
        pending: [],
      },
      unknown,
      events: [],
    };
  }
  if (!state.last) {
    return {
      state: {
        segment: state.segment,
        deviceId,
        last: candidate,
        confirmed: false,
        pending: [],
      },
      events: [],
    };
  }
  const last = state.last;
  const dt = tMs - last.tMs;
  const d = v - last.v;
  if (!state.confirmed) {
    if (dt > 0 && d >= 0 && d <= limit(last.tMs, tMs)) {
      return {
        state: {
          ...state,
          deviceId,
          last: candidate,
          confirmed: true,
          pending: [],
        },
        accepted: {
          deltaWh: d,
          fromMs: last.tMs,
          toMs: tMs,
          gapAllocated: dt > ctx.maxGapSec * 1000,
        },
        events: [],
      };
    }
    // An unconfirmed baseline cannot establish a difference. Replace it, making its span unknown.
    return {
      state: {
        ...state,
        deviceId,
        last: candidate,
        confirmed: false,
        pending: [],
      },
      unknown,
      events: [],
    };
  }
  const wraps = last.v > 0.9 * COUNTER_WRAP_WH && v < 0.1 * COUNTER_WRAP_WH;
  const delta = wraps ? v + COUNTER_WRAP_WH - last.v : d;
  if (dt > 0 && delta >= 0 && delta <= limit(last.tMs, tMs)) {
    return {
      state: { ...state, last: candidate, pending: [] },
      accepted: {
        deltaWh: delta,
        fromMs: last.tMs,
        toMs: tMs,
        gapAllocated: dt > ctx.maxGapSec * 1000,
      },
      events: [],
    };
  }
  if (!wraps && d < 0 && v <= COUNTER_RESET_MAX_WH) {
    return {
      state: {
        ...state,
        segment: state.segment + 1,
        last: candidate,
        confirmed: false,
        pending: [],
      },
      unknown,
      events: [event('COUNTER_RESET')],
    };
  }
  const prior = state.pending.at(-1);
  const consistent =
    prior &&
    tMs > prior.tMs &&
    v >= prior.v &&
    v - prior.v <= limit(prior.tMs, tMs);
  const pending = consistent ? [...state.pending, candidate] : [candidate];
  if (pending.length >= 3) {
    return {
      state: {
        ...state,
        segment: state.segment + 1,
        last: candidate,
        confirmed: true,
        pending: [],
      },
      unknown,
      events: [event('COUNTER_DISCONTINUITY')],
    };
  }
  return {
    state: { ...state, pending },
    events: [event('COUNTER_JUMP_REJECTED')],
  };
}
