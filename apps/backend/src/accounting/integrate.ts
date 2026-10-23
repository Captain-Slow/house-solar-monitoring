import { BUCKET_MS, floorBucketMs } from './types.js';

export interface BucketIntegral {
  posWh: number;
  negWh: number;
  signedWh: number;
  coveredSec: number;
  gap: boolean;
  n: number;
  sumW: number;
  minW: number | null;
  maxW: number | null;
}

export function integrateSeries(
  points: readonly { tMs: number; w: number | null }[],
  opts: {
    fromMs: number;
    toMs: number;
    maxGapSec: number;
    excluded?: (t0: number, t1: number) => boolean;
  },
): Map<number, BucketIntegral> {
  const buckets = new Map<number, BucketIntegral>();
  function bucket(at: number): BucketIntegral {
    const start = floorBucketMs(at);
    let value = buckets.get(start);
    if (!value) {
      value = {
        posWh: 0,
        negWh: 0,
        signedWh: 0,
        coveredSec: 0,
        gap: false,
        n: 0,
        sumW: 0,
        minW: null,
        maxW: null,
      };
      buckets.set(start, value);
    }
    return value;
  }

  for (const point of points) {
    if (point.w !== null && point.tMs >= opts.fromMs && point.tMs < opts.toMs) {
      const value = bucket(point.tMs);
      value.n++;
      value.sumW += point.w;
      value.minW =
        value.minW === null ? point.w : Math.min(value.minW, point.w);
      value.maxW =
        value.maxW === null ? point.w : Math.max(value.maxW, point.w);
    }
  }

  for (let i = 1; i < points.length; i++) {
    const left = points[i - 1];
    const right = points[i];
    const start = Math.max(left.tMs, opts.fromMs);
    const end = Math.min(right.tMs, opts.toMs);
    if (end <= start) {
      if (
        right.tMs <= left.tMs &&
        right.tMs >= opts.fromMs &&
        right.tMs < opts.toMs
      ) {
        bucket(right.tMs).gap = true;
      }
      continue;
    }
    const dtMs = right.tMs - left.tMs;
    const valid =
      left.w !== null &&
      right.w !== null &&
      dtMs > 0 &&
      dtMs <= opts.maxGapSec * 1000 &&
      !opts.excluded?.(left.tMs, right.tMs);
    for (let at = start; at < end;) {
      const next = Math.min(end, floorBucketMs(at) + BUCKET_MS);
      const value = bucket(at);
      if (!valid) {
        value.gap = true;
      } else {
        const p0 = left.w! + ((right.w! - left.w!) * (at - left.tMs)) / dtMs;
        const p1 = left.w! + ((right.w! - left.w!) * (next - left.tMs)) / dtMs;
        const seconds = (next - at) / 1000;
        let posWs = 0;
        let negWs = 0;
        if (p0 >= 0 && p1 >= 0) posWs = ((p0 + p1) * seconds) / 2;
        else if (p0 <= 0 && p1 <= 0) negWs = (-(p0 + p1) * seconds) / 2;
        else {
          const crossing =
            (seconds * Math.abs(p0)) / (Math.abs(p0) + Math.abs(p1));
          if (p0 > 0) {
            posWs = (p0 * crossing) / 2;
            negWs = (-p1 * (seconds - crossing)) / 2;
          } else {
            negWs = (-p0 * crossing) / 2;
            posWs = (p1 * (seconds - crossing)) / 2;
          }
        }
        value.posWh += posWs / 3600;
        value.negWh += negWs / 3600;
        value.signedWh += ((p0 + p1) * seconds) / 7200;
        value.coveredSec += seconds;
      }
      at = next;
    }
  }
  return buckets;
}
