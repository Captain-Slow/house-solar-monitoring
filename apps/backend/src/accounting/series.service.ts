import { Inject, Injectable } from '@nestjs/common';
import { Decimal } from 'decimal.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../db/prisma.service.js';
import { APP_ENV } from '../config/env.token.js';
import type { Env } from '../config/env.js';
import { SampleFlag } from '../collector/types.js';
import { batteryInvalidMask } from './families.js';
import { BUCKET_MS } from './types.js';
import { accountingInputError } from './totals.service.js';

export type PowerMetric =
  | 'PV'
  | 'LOAD'
  | 'LOAD_VENDOR'
  | 'GRID'
  | 'GRID_A'
  | 'GRID_B'
  | 'GRID_C'
  | 'BATTERY'
  | 'SOC'
  | 'INVERTER_AC';
export interface SeriesPoint {
  t: Date;
  avg: number | null;
  min: number | null;
  max: number | null;
  coverage: Decimal;
}
export interface MetricSeries {
  metric: PowerMetric;
  points: SeriesPoint[];
}
export interface TimeRange {
  from: Date;
  to: Date;
}
export interface PowerSeries {
  bucketSeconds: number;
  series: MetricSeries[];
  gaps: TimeRange[];
}
export const SERIES_WIDTHS = [
  10, 30, 60, 300, 900, 3600, 10800, 86400,
] as const;
export function selectSeriesWidth(
  spanSeconds: number,
  maxPoints: number,
): number {
  return (
    SERIES_WIDTHS.find((width) => width >= spanSeconds / maxPoints) ?? 86400
  );
}

const SAMPLE_ONLY = new Set<PowerMetric>([
  'LOAD_VENDOR',
  'GRID_A',
  'GRID_B',
  'GRID_C',
  'INVERTER_AC',
]);
const SAMPLE_COLUMNS: Record<PowerMetric, string> = {
  PV: 'pvW',
  LOAD: 'gridW',
  LOAD_VENDOR: 'loadVendorW',
  GRID: 'gridW',
  GRID_A: 'gridAW',
  GRID_B: 'gridBW',
  GRID_C: 'gridCW',
  BATTERY: 'batteryW',
  SOC: 'batterySoc',
  INVERTER_AC: 'inverterAcW',
};
const MAX_METRICS = Object.keys(SAMPLE_COLUMNS).length;
const GRID_INVALID =
  SampleFlag.METER_LINK_DOWN |
  SampleFlag.METER_COMM_FAULT |
  SampleFlag.METER_STALE |
  SampleFlag.BLOCK_INVALID_1800 |
  SampleFlag.CLOCK_STEP;
const INVERTER_INVALID = SampleFlag.BLOCK_INVALID_0 | SampleFlag.CLOCK_STEP;
interface Stats {
  avg: number | null;
  min: number | null;
  max: number | null;
  covered: number;
  weight: number;
}

@Injectable()
export class SeriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  /** Retention applies to every Sample-backed series, including at ledger resolutions. */
  private async sampleStatistics(
    metric: PowerMetric,
    from: Date,
    to: Date,
    step: number,
  ): Promise<Map<number, Stats>> {
    const field = Prisma.raw(`s."${SAMPLE_COLUMNS[metric]}"`);
    const invalid =
      metric === 'GRID' || metric.startsWith('GRID_')
        ? GRID_INVALID
        : metric === 'LOAD_VENDOR'
          ? SampleFlag.BLOCK_INVALID_2000 | SampleFlag.CLOCK_STEP
          : metric === 'SOC'
            ? SampleFlag.BLOCK_INVALID_1800 | SampleFlag.CLOCK_STEP
            : INVERTER_INVALID;
    const validity =
      metric === 'BATTERY'
        ? Prisma.sql`AND CASE WHEN m.config->>'batteryPowerSource' = 'BMS_1914'
          THEN (s.flags & ${batteryInvalidMask('BMS_1914')}) = 0
          ELSE (s.flags & ${batteryInvalidMask('BAT1_POWER_G3_50')}) = 0 END`
        : metric === 'LOAD'
          ? Prisma.sql`AND (s.flags & ${GRID_INVALID | INVERTER_INVALID | SampleFlag.NEGATIVE_DERIVED_LOAD}) = 0
            AND s."gridW" IS NOT NULL AND s."inverterAcW" IS NOT NULL AND s."epsW" IS NOT NULL`
          : Prisma.sql`AND (s.flags & ${invalid}) = 0`;
    const value =
      metric === 'LOAD'
        ? Prisma.sql`(s."gridW" + s."inverterAcW" + s."epsW")`
        : Prisma.sql`${field}`;
    const join =
      metric === 'BATTERY'
        ? Prisma.sql`LEFT JOIN "MappingVersion" m ON m.version = s."mappingVersion"`
        : Prisma.empty;
    const exclusions =
      metric === 'SOC'
        ? Prisma.sql`AND NOT EXISTS (
          SELECT 1 FROM "DataExclusion" e
          WHERE e."from" <= s."observedAt" AND e."to" > s."observedAt"
            AND ('BATTERY' = ANY(e.families) OR 'ALL' = ANY(e.families)))`
        : Prisma.empty;
    const fromMs = from.getTime(),
      toMs = to.getTime();
    const rows = await this.prisma.$queryRaw<
      Array<{
        bucket: bigint;
        avg: number;
        min: number;
        max: number;
        covered: Decimal;
      }>
    >(Prisma.sql`
      SELECT bucket, (SUM(avg * n) / SUM(n))::float8 AS avg, MIN(min)::float8 AS min, MAX(max)::float8 AS max,
        (SUM(LEAST(slot + 10000, bucket + ${step}, ${toMs}) - GREATEST(slot, ${fromMs}))/1000.0) AS covered
      FROM (
        SELECT (floor(extract(epoch from s."observedAt") * 1000 / ${step})::bigint * ${step}) AS bucket,
          (floor(extract(epoch from s."observedAt") / 10)::bigint * 10000) AS slot,
          AVG(${value}) AS avg, MIN(${value}) AS min, MAX(${value}) AS max, COUNT(*) AS n
        FROM "Sample" s ${join}
        WHERE s."observedAt" >= ${from} AND s."observedAt" < ${to} AND ${value} IS NOT NULL ${validity} ${exclusions}
        GROUP BY 1,2
      ) slots GROUP BY bucket ORDER BY bucket`);
    return new Map(
      rows.map((row) => [
        Number(row.bucket),
        {
          avg: Number(row.avg),
          min: Number(row.min),
          max: Number(row.max),
          covered: Number(row.covered),
          weight: Number(row.covered),
        },
      ]),
    );
  }

  async powerSeries(
    from: Date,
    to: Date,
    metrics: PowerMetric[],
    maxPoints = 1000,
  ): Promise<PowerSeries> {
    if (
      !Array.isArray(metrics) ||
      metrics.length === 0 ||
      metrics.length > MAX_METRICS
    )
      accountingInputError('Invalid power series range, metrics or maxPoints');
    for (const metric of metrics)
      if (
        typeof metric !== 'string' ||
        !Object.prototype.hasOwnProperty.call(SAMPLE_COLUMNS, metric)
      )
        accountingInputError(
          'Invalid power series range, metrics or maxPoints',
        );
    const duration = to.getTime() - from.getTime();
    if (
      !Number.isFinite(duration) ||
      duration <= 0 ||
      duration > 366 * 86_400_000 ||
      !Number.isInteger(maxPoints) ||
      maxPoints < 1 ||
      maxPoints > 2000
    )
      accountingInputError('Invalid power series range, metrics or maxPoints');
    metrics = [...new Set(metrics)];
    const width = selectSeriesWidth(duration / 1000, maxPoints),
      step = width * 1000;
    const first = Math.floor(from.getTime() / step) * step;
    const count = Math.ceil((to.getTime() - first) / step);
    const sampleMode = width < 300;
    const retentionFrom = new Date(
      Math.max(
        from.getTime(),
        Date.now() - this.env.SAMPLE_RETENTION_DAYS * 86_400_000,
      ),
    );
    const sampleMetrics = metrics.filter(
      (m) => sampleMode || SAMPLE_ONLY.has(m),
    );
    const [aggregated, intervals] = await Promise.all([
      Promise.all(
        sampleMetrics.map((m) =>
          retentionFrom >= to
            ? Promise.resolve(new Map<number, Stats>())
            : this.sampleStatistics(m, retentionFrom, to, step),
        ),
      ),
      sampleMode
        ? Promise.resolve(null)
        : this.prisma.energyInterval.findMany({
            where: {
              bucketStart: {
                gte: new Date(
                  Math.floor(from.getTime() / BUCKET_MS) * BUCKET_MS,
                ),
                lt: to,
              },
            },
            orderBy: { bucketStart: 'asc' },
            select: {
              bucketStart: true,
              gridAvgW: true,
              gridMinW: true,
              gridMaxW: true,
              pvAvgW: true,
              pvMaxW: true,
              batAvgW: true,
              loadAvgW: true,
              loadMaxW: true,
              socMin: true,
              socMax: true,
              socLast: true,
              gridCoveredSec: true,
              pvCoveredSec: true,
              batCoveredSec: true,
              socCoveredSec: true,
              loadCoveredSec: true,
            },
          }),
    ]);
    const sampleByMetric = new Map(
      sampleMetrics.map((m, i) => [m, aggregated[i]!]),
    );
    const intervalGroups = new Map<number, NonNullable<typeof intervals>>();
    for (const row of intervals ?? []) {
      const key = Math.floor(row.bucketStart.getTime() / step) * step;
      const group = intervalGroups.get(key);
      if (group) group.push(row);
      else intervalGroups.set(key, [row]);
    }
    const series: MetricSeries[] = metrics.map((metric) => ({
      metric,
      points: [],
    }));
    const gaps: TimeRange[] = [];
    for (let i = 0; i < count; i++) {
      const t = first + i * step,
        windowStart = Math.max(t, from.getTime()),
        windowEnd = Math.min(t + step, to.getTime());
      const seconds = (windowEnd - windowStart) / 1000;
      let missing = false;
      for (const item of series) {
        const sampled = sampleByMetric.get(item.metric)?.get(t);
        const values: Stats[] = sampled ? [sampled] : [];
        if (!sampleByMetric.has(item.metric))
          for (const row of intervalGroups.get(t) ?? []) {
            const overlap =
              Math.max(
                0,
                Math.min(row.bucketStart.getTime() + BUCKET_MS, windowEnd) -
                  Math.max(row.bucketStart.getTime(), windowStart),
              ) / 1000;
            if (!overlap) continue;
            const fields: Partial<
              Record<
                PowerMetric,
                {
                  avg: number | null;
                  min: number | null;
                  max: number | null;
                  covered: number;
                }
              >
            > = {
              PV: {
                avg: row.pvAvgW,
                min: null,
                max: row.pvMaxW,
                covered: row.pvCoveredSec,
              },
              LOAD: {
                avg: row.loadAvgW,
                min: null,
                max: row.loadMaxW,
                covered: row.loadCoveredSec,
              },
              GRID: {
                avg: row.gridAvgW,
                min: row.gridMinW,
                max: row.gridMaxW,
                covered: row.gridCoveredSec,
              },
              BATTERY: {
                avg: row.batAvgW,
                min: null,
                max: null,
                covered: row.batCoveredSec,
              },
              SOC: {
                avg: null,
                min: row.socMin,
                max: row.socMax,
                // A count cannot locate occupied slots in a clipped historic bucket.
                // Use the minimum possible intersection, never optimistic full coverage.
                covered: Math.max(
                  0,
                  (row.socCoveredSec ?? 0) - (BUCKET_MS / 1000 - overlap),
                ),
              },
            };
            const value = fields[item.metric];
            if (
              value &&
              (value.covered > 0 ||
                (item.metric === 'SOC' &&
                  (value.min !== null || value.max !== null)))
            )
              values.push({
                avg: value.avg,
                min: value.min,
                max: value.max,
                covered: Math.min(overlap, value.covered),
                weight: Math.min(overlap, value.covered),
              });
          }
        const covered = Math.min(
          seconds,
          values.reduce((sum, v) => sum + v.covered, 0),
        );
        const averages = values.filter((v) => v.avg !== null),
          minima = values.filter((v) => v.min !== null),
          maxima = values.filter((v) => v.max !== null);
        item.points.push({
          t: new Date(t),
          avg:
            covered && averages.length
              ? Math.round(
                  averages.reduce((sum, v) => sum + v.avg! * v.weight, 0) /
                    averages.reduce((sum, v) => sum + v.weight, 0),
                )
              : null,
          min:
            (covered > 0 || item.metric === 'SOC') && minima.length
              ? Math.min(...minima.map((v) => v.min!))
              : null,
          max:
            (covered > 0 || item.metric === 'SOC') && maxima.length
              ? Math.max(...maxima.map((v) => v.max!))
              : null,
          coverage: new Decimal(seconds ? covered / seconds : 0),
        });
        if (!covered) missing = true;
      }
      if (missing) {
        const previous = gaps.at(-1);
        if (previous?.to.getTime() === windowStart)
          previous.to = new Date(windowEnd);
        else
          gaps.push({ from: new Date(windowStart), to: new Date(windowEnd) });
      }
    }
    return { bucketSeconds: width, series, gaps };
  }
}
