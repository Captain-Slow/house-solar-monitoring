import { describe, expect, it } from 'vitest';
import {
  DETECT_BLOCKS,
  FAST_PLAN,
  MAX_BLOCK,
  SETTINGS_PLAN,
  SLOW_PLAN,
  buildReadPlan,
  isForbiddenStart,
  type PlannedBlock,
} from './read-plan.js';
import { MODEL_STRING, REGISTERS, WORD_SIZE } from './register-map.js';

const key = (b: PlannedBlock) => `${b.fc}:${b.start}+${b.count}`;

describe('read plan', () => {
  it('FAST is exactly the six FC04 requests from the plan', () => {
    expect(FAST_PLAN.map((b) => [b.start, b.count])).toEqual([
      [0, 123],
      [1800, 123],
      [1923, 1],
      [2000, 123],
      [2123, 123],
      [30000, 30],
    ]);
    expect(FAST_PLAN.every((b) => b.fc === 4)).toBe(true);
  });

  it('chunks from lo and never exceeds the block limit', () => {
    expect(buildReadPlan([[10, 10 + 2 * MAX_BLOCK + 5]], 4)).toEqual([
      { fc: 4, start: 10, count: 123 },
      { fc: 4, start: 133, count: 123 },
      { fc: 4, start: 256, count: 5 },
    ]);
    expect(buildReadPlan([[5, 5]], 4)).toEqual([]);
  });

  it('no planned read of any tier starts inside [1101, 1800)', () => {
    for (const b of [
      ...FAST_PLAN,
      ...SLOW_PLAN,
      ...SETTINGS_PLAN,
      ...DETECT_BLOCKS,
    ]) {
      expect(isForbiddenStart(b.start), key(b)).toBe(false);
      expect(b.count).toBeLessThanOrEqual(MAX_BLOCK);
    }
    expect(isForbiddenStart(1100)).toBe(false);
    expect(isForbiddenStart(1101)).toBe(true);
    expect(isForbiddenStart(1799)).toBe(true);
    expect(isForbiddenStart(1800)).toBe(false);
  });

  it('SETTINGS reads holding registers only, and DETECT is the library detect_config reads', () => {
    expect(SETTINGS_PLAN.every((b) => b.fc === 3)).toBe(true);
    expect(DETECT_BLOCKS.map(key)).toEqual([
      '4:0+123',
      '4:1000+123',
      '4:1900+24',
      '4:1800+7',
    ]);
  });

  it('every mapped register is fully covered by some tier read, so none is dead', () => {
    const covered = new Set<string>();
    for (const b of [
      ...FAST_PLAN,
      ...SLOW_PLAN,
      ...SETTINGS_PLAN,
      ...DETECT_BLOCKS,
    ]) {
      for (let i = 0; i < b.count; i++) covered.add(`${b.fc}:${b.start + i}`);
    }
    for (const r of REGISTERS) {
      for (let i = 0; i < WORD_SIZE[r.dtype]; i++) {
        expect(covered.has(`${r.fc}:${r.addr + i}`), `${r.key} word ${i}`).toBe(
          true,
        );
      }
    }
    for (let i = 0; i < MODEL_STRING.count; i++)
      expect(covered.has(`4:${MODEL_STRING.addr + i}`)).toBe(true);
  });
});
