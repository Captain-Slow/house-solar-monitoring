import { BUCKET_MS } from './types.js';

export const SERIES_WIDTHS = [
  10, 30, 60, 300, 900, 3600, 10800, 86400,
] as const;

/** The bucket grid `powerSeries` aggregates onto: bucket `i` is `[firstMs + i*step, firstMs + (i+1)*step)`. */
export interface SeriesGrid {
  /** Whole seconds (GraphQL `Int`); a multiple of 300 s once it is not below the ledger resolution. */
  widthSeconds: number;
  /** Grid phase: every bucket start is `anchorMs + n * widthSeconds * 1000` for an integer `n`. */
  anchorMs: number;
  /** Start of the bucket containing `fromMs` (`<= fromMs`). */
  firstMs: number;
  /** Buckets needed to cover `[fromMs, toMs)`; never above `maxPoints`. */
  count: number;
}

/**
 * Chooses the bucket grid for `[fromMs, toMs)` so that the series never has more than
 * `maxPoints` points per metric (`maxPoints` is a hard maximum, not a target).
 *
 * 1. The smallest of {@link SERIES_WIDTHS}, aligned to the Unix epoch (`anchorMs = 0`), whose
 *    ACTUAL aligned bucket count `ceil((toMs - floor(fromMs/step)*step)/step)` is `<= maxPoints`.
 *    A start that is not on a width boundary can add one bucket over `span / width`, so the
 *    old "width >= span/maxPoints" test is not sufficient. Each table width divides the next
 *    one, so the count never grows with the width and the first fit is the smallest.
 * 2. When no table width fits (`maxPoints` below roughly 367 over a long span, or a short span
 *    that crosses a boundary of every table width at `maxPoints = 1`), the grid is anchored at
 *    the 300 s ledger boundary at or before `fromMs` and uses the smallest whole multiple of
 *    300 s with `ceil((toMs - anchorMs)/step) <= maxPoints`. Epoch alignment is dropped on
 *    purpose: one epoch-aligned bucket around an arbitrary start can need a width many times
 *    the request span (up to the start's distance from the epoch). A multiple-of-300 s width
 *    on a 300 s-aligned anchor keeps every 300 s `EnergyInterval` row inside exactly one
 *    bucket, so interval grouping stays exact. The first bucket starts less than 300 s
 *    before `fromMs`; callers clip each bucket window to the request.
 *
 * The result always covers the whole requested interval; nothing is truncated or dropped.
 */
export function selectSeriesGrid(
  fromMs: number,
  toMs: number,
  maxPoints: number,
): SeriesGrid {
  for (const widthSeconds of SERIES_WIDTHS) {
    const step = widthSeconds * 1000;
    const firstMs = Math.floor(fromMs / step) * step;
    const count = Math.ceil((toMs - firstMs) / step);
    if (count <= maxPoints)
      return { widthSeconds, anchorMs: 0, firstMs, count };
  }
  const anchorMs = Math.floor(fromMs / BUCKET_MS) * BUCKET_MS;
  const widthSeconds =
    Math.ceil((toMs - anchorMs) / (maxPoints * BUCKET_MS)) * (BUCKET_MS / 1000);
  return {
    widthSeconds,
    anchorMs,
    firstMs: anchorMs,
    count: Math.ceil((toMs - anchorMs) / (widthSeconds * 1000)),
  };
}
