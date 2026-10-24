import { describe, expect, it } from 'vitest';
import { SERIES_WIDTHS, selectSeriesGrid } from './series-grid.js';

const DAY = 86_400_000;
const start = Date.parse('2030-01-15T00:00:00Z');
const countAt = (fromMs: number, toMs: number, stepMs: number, anchor = 0) =>
  Math.ceil(
    (toMs - (anchor + Math.floor((fromMs - anchor) / stepMs) * stepMs)) /
      stepMs,
  );

describe('series grid selection', () => {
  it('keeps the smallest table width when the aligned count fits, as it did when the start was aligned', () => {
    expect(
      (
        [
          [10, 1],
          [31, 1],
          [300, 1],
          [301, 1],
          [366 * 86400, 2000],
        ] as const
      ).map(
        ([span, max]) =>
          selectSeriesGrid(start, start + span * 1000, max).widthSeconds,
      ),
    ).toEqual([10, 60, 300, 900, 86400]);
    expect(selectSeriesGrid(start, start + 600_000, 2)).toEqual({
      widthSeconds: 300,
      anchorMs: 0,
      firstMs: start,
      count: 2,
    });
  });

  it('counts the real aligned buckets: an unaligned start at an exact threshold needs the next width', () => {
    // span / width === maxPoints, but the start is 150 s into a 300 s bucket: three buckets.
    expect(countAt(start + 150_000, start + 750_000, 300_000)).toBe(3);
    expect(selectSeriesGrid(start + 150_000, start + 750_000, 2)).toEqual({
      widthSeconds: 900,
      anchorMs: 0,
      firstMs: start,
      count: 1,
    });
    // One second of data that straddles a 10 s boundary needs 30 s buckets at maxPoints 1.
    expect(selectSeriesGrid(start + 9_500, start + 10_500, 1)).toMatchObject({
      widthSeconds: 30,
      count: 1,
    });
    expect(selectSeriesGrid(start + 3_250, start + 4_250, 1)).toMatchObject({
      widthSeconds: 10,
      count: 1,
    });
  });

  it('falls back to one ledger-aligned multiple-of-300 s grid when no table width fits', () => {
    // 600 s around midnight: every table width, up to one day, has a boundary at midnight.
    const midnight = start + DAY;
    expect(selectSeriesGrid(midnight - 150_000, midnight + 150_000, 1)).toEqual(
      {
        widthSeconds: 600,
        anchorMs: midnight - 300_000,
        firstMs: midnight - 300_000,
        count: 1,
      },
    );
    // 366 days, unaligned start, one point: a single bucket that starts before `from`.
    const from = Date.parse('2030-01-15T10:07:13.250Z');
    const to = from + 366 * DAY;
    expect(selectSeriesGrid(from, to, 1)).toEqual({
      widthSeconds: 31_622_700,
      anchorMs: Date.parse('2030-01-15T10:05:00Z'),
      firstMs: Date.parse('2030-01-15T10:05:00Z'),
      count: 1,
    });
    expect(selectSeriesGrid(from, to, 2).count).toBe(2);
    expect(selectSeriesGrid(from, to, 50).widthSeconds).toBe(632_700);
    expect(selectSeriesGrid(from, to, 2000)).toMatchObject({
      widthSeconds: 86400,
      anchorMs: 0,
      count: 367,
    });
  });

  it('never exceeds maxPoints and always covers [from, to) exactly, for every start phase, span and cap', () => {
    let seed = 99;
    const random = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const offsets = [
      0,
      1,
      5_000,
      9_999,
      10_000,
      29_999,
      150_000,
      299_999,
      300_000,
      899_999,
      3_599_999,
      10_799_999,
      86_399_999,
      ...Array.from({ length: 20 }, () => Math.floor(random() * 4 * DAY)),
    ];
    const spans = [
      1,
      999,
      1_000,
      10_000,
      299_000,
      300_000,
      301_000,
      3_600_000,
      DAY,
      7 * DAY,
      30 * DAY,
      365 * DAY,
      366 * DAY,
    ];
    const caps = [1, 2, 3, 7, 50, 300, 366, 367, 1000, 2000];
    let fallbacks = 0;
    for (const offset of offsets)
      for (const span of spans)
        for (const maxPoints of caps) {
          const from = start + offset,
            to = from + span;
          const grid = selectSeriesGrid(from, to, maxPoints);
          const step = grid.widthSeconds * 1000;
          const label = JSON.stringify({ offset, span, maxPoints, grid });
          expect(Number.isInteger(grid.widthSeconds), label).toBe(true);
          expect(grid.widthSeconds, label).toBeGreaterThan(0);
          if (grid.widthSeconds >= 300)
            expect(grid.widthSeconds % 300, label).toBe(0);
          expect(grid.count, label).toBeGreaterThanOrEqual(1);
          expect(grid.count, label).toBeLessThanOrEqual(maxPoints);
          // Aligned buckets: the first contains `from`, the last contains the final instant.
          expect((grid.firstMs - grid.anchorMs) % step, label).toBe(0);
          expect(grid.firstMs, label).toBeLessThanOrEqual(from);
          expect(grid.firstMs + step, label).toBeGreaterThan(from);
          expect(
            grid.firstMs + grid.count * step,
            label,
          ).toBeGreaterThanOrEqual(to);
          expect(grid.firstMs + (grid.count - 1) * step, label).toBeLessThan(
            to,
          );
          if (grid.anchorMs === 0) {
            // Smallest fitting table width.
            const index = (SERIES_WIDTHS as readonly number[]).indexOf(
              grid.widthSeconds,
            );
            expect(index, label).toBeGreaterThanOrEqual(0);
            if (index > 0)
              expect(
                countAt(from, to, SERIES_WIDTHS[index - 1]! * 1000),
                label,
              ).toBeGreaterThan(maxPoints);
          } else {
            fallbacks++;
            // The anchor is a ledger boundary within 300 s of `from`; no table width fit;
            // and no smaller multiple of 300 s would fit either.
            expect(grid.anchorMs % 300_000, label).toBe(0);
            expect(from - grid.anchorMs, label).toBeLessThan(300_000);
            for (const width of SERIES_WIDTHS)
              expect(countAt(from, to, width * 1000), label).toBeGreaterThan(
                maxPoints,
              );
            if (grid.widthSeconds > 300)
              expect(
                countAt(from, to, step - 300_000, grid.anchorMs),
                label,
              ).toBeGreaterThan(maxPoints);
          }
        }
    expect(fallbacks).toBeGreaterThan(0);
  });
});
