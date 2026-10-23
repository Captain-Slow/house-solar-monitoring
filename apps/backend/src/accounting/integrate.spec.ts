import { describe, expect, it } from 'vitest';
import { integrateSeries } from './integrate.js';
import type { BucketIntegral } from './integrate.js';

const total = (
  values: Map<number, BucketIntegral>,
  key: 'posWh' | 'negWh' | 'signedWh' | 'coveredSec',
) => [...values.values()].reduce((sum, value) => sum + value[key], 0);

describe('directional power integration', () => {
  it('V1 integrates jittered 1 kW for an hour and excludes a 45-second hole', () => {
    let seed = 6174;
    const random = () =>
      (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
    const times = [0];
    while (times.at(-1)! < 3600)
      times.push(Math.min(3600, times.at(-1)! + 7 + Math.floor(random() * 7)));
    const points = times.map((second) => ({ tMs: second * 1000, w: 1000 }));
    const normal = integrateSeries(points, {
      fromMs: 0,
      toMs: 3_600_000,
      maxGapSec: 30,
    });
    expect(total(normal, 'posWh')).toBeCloseTo(1000, 3);
    expect(total(normal, 'coveredSec')).toBe(3600);
    const hole = [
      ...points.filter(({ tMs }) => tMs < 1_800_000 || tMs > 1_845_000),
      { tMs: 1_800_000, w: 1000 },
      { tMs: 1_845_000, w: 1000 },
    ].sort((a, b) => a.tMs - b.tMs);
    const missing = integrateSeries(hole, {
      fromMs: 0,
      toMs: 3_600_000,
      maxGapSec: 30,
    });
    expect(total(missing, 'posWh')).toBeCloseTo(987.5, 1);
    expect(total(missing, 'coveredSec')).toBe(3555);
    expect(missing.get(1_800_000)?.gap).toBe(true);
  });

  it('V2 splits a zero crossing into import and export without netting', () => {
    const result = integrateSeries(
      [
        { tMs: 0, w: 2000 },
        { tMs: 10_000, w: -2000 },
      ],
      { fromMs: 0, toMs: 300_000, maxGapSec: 30 },
    );
    expect(total(result, 'posWh')).toBeCloseTo(1.38888889, 6);
    expect(total(result, 'negWh')).toBeCloseTo(1.38888889, 6);
    expect(total(result, 'signedWh')).toBeCloseTo(0, 8);
  });

  it('V27 excludes a 45-second interval at 30 s, but credits 12.5 Wh at 60 s', () => {
    const points = [
      { tMs: 0, w: 1000 },
      { tMs: 45_000, w: 1000 },
    ];
    const invalid = integrateSeries(points, {
      fromMs: 0,
      toMs: 300_000,
      maxGapSec: 30,
    });
    const valid = integrateSeries(points, {
      fromMs: 0,
      toMs: 300_000,
      maxGapSec: 60,
    });
    expect(invalid.get(0)).toMatchObject({
      posWh: 0,
      coveredSec: 0,
      gap: true,
    });
    expect(valid.get(0)).toMatchObject({
      posWh: 12.5,
      coveredSec: 45,
      gap: false,
    });
  });

  it('includes exactly maxGapSec and rejects one millisecond more', () => {
    const exact = integrateSeries(
      [
        { tMs: 0, w: 1000 },
        { tMs: 30_000, w: 1000 },
      ],
      { fromMs: 0, toMs: 300_000, maxGapSec: 30 },
    );
    const over = integrateSeries(
      [
        { tMs: 0, w: 1000 },
        { tMs: 30_001, w: 1000 },
      ],
      { fromMs: 0, toMs: 300_000, maxGapSec: 30 },
    );
    expect(exact.get(0)).toMatchObject({
      posWh: 1000 / 120,
      coveredSec: 30,
      gap: false,
    });
    expect(over.get(0)).toMatchObject({ posWh: 0, coveredSec: 0, gap: true });
  });

  it('flags duplicate and backwards timestamps without crediting negative energy', () => {
    const duplicate = integrateSeries(
      [
        { tMs: 0, w: 1000 },
        { tMs: 0, w: 1000 },
        { tMs: 10_000, w: 1000 },
      ],
      { fromMs: 0, toMs: 300_000, maxGapSec: 30 },
    );
    const backwards = integrateSeries(
      [
        { tMs: 10_000, w: 1000 },
        { tMs: 0, w: 1000 },
        { tMs: 20_000, w: null },
      ],
      { fromMs: 0, toMs: 300_000, maxGapSec: 30 },
    );
    expect(duplicate.get(0)?.gap).toBe(true);
    expect(backwards.get(0)?.gap).toBe(true);
    expect(total(duplicate, 'posWh')).toBeCloseTo(1000 / 360, 8);
    expect(total(backwards, 'posWh')).toBe(0);
    expect(total(backwards, 'negWh')).toBe(0);
  });

  it('preserves signed energy and coverage over shifted bucket boundaries', () => {
    let seed = 123;
    const random = () =>
      (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0) / 2 ** 32;
    const points = [{ tMs: 0, w: -500 }];
    for (let i = 1; i <= 250; i++)
      points.push({ tMs: i * 11_000, w: Math.round((random() - 0.5) * 6000) });
    const integrate = (offset: number) =>
      integrateSeries(
        points.map((p) => ({ ...p, tMs: p.tMs + offset })),
        { fromMs: 0, toMs: 3_600_000, maxGapSec: 30 },
      );
    const a = integrate(0);
    const b = integrate(87_000);
    expect(total(a, 'posWh')).toBeCloseTo(total(b, 'posWh'), 7);
    expect(total(a, 'negWh')).toBeCloseTo(total(b, 'negWh'), 7);
    expect(total(a, 'signedWh')).toBeCloseTo(
      total(a, 'posWh') - total(a, 'negWh'),
      8,
    );
    expect(
      [...a.values(), ...b.values()].every(
        (bucket) => bucket.coveredSec <= 300,
      ),
    ).toBe(true);
  });

  it('excludes only requested intervals and clips a seed crossing the range edge', () => {
    const points = [
      { tMs: -10_000, w: 1000 },
      { tMs: 10_000, w: 1000 },
      { tMs: 20_000, w: 1000 },
    ];
    const result = integrateSeries(points, {
      fromMs: 0,
      toMs: 20_000,
      maxGapSec: 30,
      excluded: (a) => a === 10_000,
    });
    expect(result.get(0)).toMatchObject({
      coveredSec: 10,
      gap: true,
      n: 1,
      sumW: 1000,
    });
  });
});
