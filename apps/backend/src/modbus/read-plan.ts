import type { FunctionCode } from './register-map.js';

/** One planned Modbus read. */
export interface PlannedBlock {
  readonly fc: FunctionCode;
  readonly start: number;
  readonly count: number;
}

/** Half-open register ranges `[lo, hi)`. */
export type RangeList = readonly (readonly [number, number])[];

export const MAX_BLOCK = 123;

/**
 * Reads must never START inside `[1101, 1800)`: the device behaves badly there
 * (plan Phase 1.4). A read that starts below 1101 and spans into it (1000..1122) is
 * the documented DETECT read and is allowed.
 */
export const FORBIDDEN_START: readonly [number, number] = [1101, 1800];

export function isForbiddenStart(start: number): boolean {
  return start >= FORBIDDEN_START[0] && start < FORBIDDEN_START[1];
}

/** Direct port of the library's `build_read_plan`: each `[lo, hi)` chunked from `lo`. */
export function buildReadPlan(
  ranges: RangeList,
  fc: FunctionCode,
  maxBlock = MAX_BLOCK,
): PlannedBlock[] {
  const plan: PlannedBlock[] = [];
  for (const [lo, hi] of ranges) {
    let a = lo;
    while (a < hi) {
      const n = Math.min(maxBlock, hi - a);
      plan.push({ fc, start: a, count: n });
      a += n;
    }
  }
  return plan;
}

/**
 * FAST = library FAST group, with 30000 read to 30030 so fault bitmaps arrive every poll.
 * Note: the library's default first range is (0, 369); the plan splits it into FAST (0, 123)
 * and SLOW (123, 246) and never reads 246-369.
 */
export const FAST_RANGES: RangeList = [
  [0, 123],
  [1800, 1924],
  [2000, 2246],
  [30000, 30030],
];
export const SLOW_RANGES: RangeList = [[123, 246]];

/** Settings (FC03). */
export const SETTINGS_RANGES: RangeList = [
  [258, 260],
  [303, 312],
  [323, 325],
  [3001, 3002],
  [3016, 3017],
  [4100, 4103],
  [4300, 4307],
  [6048, 6050],
];

/** Exactly the reads of the library's `detect_config`, in order. */
export const DETECT_BLOCKS: readonly PlannedBlock[] = [
  { fc: 4, start: 0, count: 123 },
  { fc: 4, start: 1000, count: 123 },
  { fc: 4, start: 1900, count: 24 },
  { fc: 4, start: 1800, count: 7 },
];

export const FAST_PLAN: readonly PlannedBlock[] = buildReadPlan(FAST_RANGES, 4);
export const SLOW_PLAN: readonly PlannedBlock[] = buildReadPlan(SLOW_RANGES, 4);
export const SETTINGS_PLAN: readonly PlannedBlock[] = buildReadPlan(
  SETTINGS_RANGES,
  3,
);

/** `--cadence` probe block: the whole meter block, 2 s. */
export const CADENCE_BLOCK: PlannedBlock = { fc: 4, start: 1800, count: 123 };

export type PollTierName = 'DETECT' | 'FAST' | 'SLOW' | 'SETTINGS';

export const TIER_PLANS: Readonly<
  Record<PollTierName, readonly PlannedBlock[]>
> = {
  DETECT: DETECT_BLOCKS,
  FAST: FAST_PLAN,
  SLOW: SLOW_PLAN,
  SETTINGS: SETTINGS_PLAN,
};
