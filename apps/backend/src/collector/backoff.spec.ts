import { describe, expect, it } from 'vitest';
import { reconnectDelaySec } from './backoff.js';
import { nextFastTick } from './collector.service.js';

describe('collector scheduling', () => {
  it('follows a capped exponential reconnect schedule with bounded jitter', () => {
    for (const [i, base] of [5, 10, 20, 40, 80, 160, 300, 300].entries()) {
      expect(reconnectDelaySec(i + 1, () => 0)).toBeCloseTo(base * 0.9);
      expect(reconnectDelaySec(i + 1, () => 0.5)).toBe(base);
      expect(reconnectDelaySec(i + 1, () => 1)).toBeCloseTo(base * 1.1);
    }
    expect(reconnectDelaySec(0, () => 0.5)).toBe(5);
    expect(reconnectDelaySec(1000, () => 0.5)).toBe(300);
  });

  it('schedules the next multiple and skips overrun ticks', () => {
    expect(nextFastTick(0, 10_000)).toBe(10_000);
    expect(nextFastTick(20_000, 10_000)).toBe(30_000);
    expect(nextFastTick(31_500, 10_000)).toBe(40_000);
    expect(nextFastTick(86_200, 10_000)).toBe(90_000);
  });
});
