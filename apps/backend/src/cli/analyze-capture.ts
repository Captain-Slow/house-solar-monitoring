import { DateTime } from 'luxon';
import { parseArgs } from 'node:util';
import { loadCapture, type CaptureRecord } from '../modbus/capture.js';
import { decodeAsciiString, decodeBlocks, WordMap } from '../modbus/decode.js';
import { MODEL_STRING } from '../modbus/register-map.js';
import { isMain } from './is-main.js';

const DEFAULT_ZONE = 'Asia/Kuala_Lumpur';
export interface Signs {
  grid: 1 | -1;
  inverter: 1 | -1;
  battery: 1 | -1;
}
const DEFAULT_SIGNS: Signs = { grid: 1, inverter: 1, battery: 1 };
const signLabel = (signs: Signs): string =>
  `grid=${signs.grid}, inverter=${signs.inverter}, battery=${signs.battery}`;
const COUNTERS = [
  'pv_total_energy',
  'grid_buy_energy',
  'grid_sell_energy',
  'bat_charge_energy',
  'bat_discharge_energy',
  'load_energy_use',
] as const;
const TODAY = [
  'pv_today_energy',
  'grid_buy_today',
  'grid_sell_today',
  'bat_charge_today',
  'bat_discharge_today',
  'load_energy_today',
] as const;
type Counter = (typeof COUNTERS)[number];
type Powers = { pv: number; grid: number; bat: number; house: number };
type Energy = {
  pv: number;
  imp: number;
  exp: number;
  dis: number;
  ch: number;
  house: number;
  seconds: number;
};
const emptyEnergy = (): Energy => ({
  pv: 0,
  imp: 0,
  exp: 0,
  dis: 0,
  ch: 0,
  house: 0,
  seconds: 0,
});
const fmt = (value: number | null, digits = 3): string =>
  value === null || !Number.isFinite(value) ? 'n/a' : value.toFixed(digits);
const sorted = (records: readonly CaptureRecord[]): CaptureRecord[] =>
  [...records].sort(
    (a, b) => Date.parse(a.observedAt) - Date.parse(b.observedAt),
  );
const fast = (records: readonly CaptureRecord[]): CaptureRecord[] =>
  sorted(records.filter((r) => r.tier === 'FAST'));
const value = (r: CaptureRecord, key: string): number | null => {
  const n = r.decoded?.[key];
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};
const sum = (r: CaptureRecord, keys: readonly string[]): number | null => {
  let total = 0;
  for (const key of keys) {
    const n = value(r, key);
    if (n === null) return null;
    total += n;
  }
  return total;
};
const pv = (r: CaptureRecord): number | null =>
  sum(r, ['pv1_power', 'pv2_power', 'pv3_power', 'pv4_power']);
const inv = (r: CaptureRecord): number | null =>
  sum(r, ['inv_active_power_a', 'inv_active_power_b', 'inv_active_power_c']);
const eps = (r: CaptureRecord): number | null =>
  sum(r, ['backup_active_a', 'backup_active_b', 'backup_active_c']);
const vendorLoad = (r: CaptureRecord): number | null =>
  sum(r, ['load_power_a', 'load_power_b', 'load_power_c']);
const derivedLoad = (
  r: CaptureRecord,
  signs: Signs = DEFAULT_SIGNS,
): number | null => {
  const grid = value(r, 'meter_active_total'),
    inverter = inv(r),
    backup = eps(r);
  return grid === null || inverter === null || backup === null
    ? null
    : signs.grid * grid + signs.inverter * inverter + backup;
};
const median = (numbers: number[]): number | null => {
  if (!numbers.length) return null;
  const sortedNumbers = [...numbers].sort((a, b) => a - b);
  const middle = Math.floor(sortedNumbers.length / 2);
  return sortedNumbers.length % 2
    ? sortedNumbers[middle]!
    : (sortedNumbers[middle - 1]! + sortedNumbers[middle]!) / 2;
};
const percentile90 = (numbers: number[]): number | null => {
  if (!numbers.length) return null;
  return [...numbers].sort((a, b) => a - b)[
    Math.ceil(numbers.length * 0.9) - 1
  ]!;
};
const percent = (part: number, total: number): string =>
  total ? fmt((100 * part) / total, 2) + '%' : 'n/a';
const dtSeconds = (a: CaptureRecord, b: CaptureRecord): number =>
  (Date.parse(b.observedAt) - Date.parse(a.observedAt)) / 1000;

/** Signed linear trapezoid split exactly at a zero crossing; outputs positive directional Wh. */
export function directionalTrapezoid(
  p0: number,
  p1: number,
  seconds: number,
): { positiveWh: number; negativeWh: number } {
  let positiveWs = 0,
    negativeWs = 0;
  if (p0 * p1 >= 0) {
    const area = ((p0 + p1) * seconds) / 2;
    if (area >= 0) positiveWs = area;
    else negativeWs = -area;
  } else {
    const crossing = (seconds * Math.abs(p0)) / (Math.abs(p0) + Math.abs(p1));
    const first = (Math.abs(p0) * crossing) / 2;
    const second = (Math.abs(p1) * (seconds - crossing)) / 2;
    if (p0 > 0) {
      positiveWs = first;
      negativeWs = second;
    } else {
      negativeWs = first;
      positiveWs = second;
    }
  }
  return { positiveWh: positiveWs / 3600, negativeWh: negativeWs / 3600 };
}

function samplePowers(r: CaptureRecord, signs: Signs): Powers | null {
  const solar = pv(r),
    grid = value(r, 'meter_active_total'),
    bat = value(r, 'bat1_power_g3'),
    house = derivedLoad(r, signs);
  return solar === null || grid === null || bat === null || house === null
    ? null
    : { pv: solar, grid: signs.grid * grid, bat: signs.battery * bat, house };
}
function addEnergy(
  energy: Energy,
  a: Powers,
  b: Powers,
  seconds: number,
): void {
  energy.pv += ((a.pv + b.pv) * seconds) / 7200;
  const grid = directionalTrapezoid(a.grid, b.grid, seconds);
  energy.imp += grid.positiveWh;
  energy.exp += grid.negativeWh;
  const battery = directionalTrapezoid(a.bat, b.bat, seconds);
  energy.dis += battery.positiveWh;
  energy.ch += battery.negativeWh;
  energy.house += ((a.house + b.house) * seconds) / 7200;
  energy.seconds += seconds;
}
function interpolate(a: Powers, b: Powers, ratio: number): Powers {
  return {
    pv: a.pv + (b.pv - a.pv) * ratio,
    grid: a.grid + (b.grid - a.grid) * ratio,
    bat: a.bat + (b.bat - a.bat) * ratio,
    house: a.house + (b.house - a.house) * ratio,
  };
}
function checkedZone(tz: string): string {
  if (!DateTime.now().setZone(tz).isValid)
    throw new Error(`invalid timezone: ${tz}`);
  return tz;
}
function dailyEnergies(
  records: readonly CaptureRecord[],
  tz: string,
  signs: Signs,
): Map<string, Energy> {
  checkedZone(tz);
  const days = new Map<string, Energy>();
  const samples = fast(records);
  for (let i = 1; i < samples.length; i++) {
    const previous = samples[i - 1]!,
      current = samples[i]!;
    const duration = dtSeconds(previous, current);
    if (duration <= 0 || duration > 30) continue;
    const a = samplePowers(previous, signs),
      b = samplePowers(current, signs);
    if (a === null || b === null) continue;
    const start = Date.parse(previous.observedAt),
      end = Date.parse(current.observedAt);
    let from = start;
    while (from < end) {
      const local = DateTime.fromMillis(from, { zone: tz });
      const boundary = local.startOf('day').plus({ days: 1 }).toMillis();
      const to = Math.min(end, boundary);
      const day = local.toISODate()!;
      let energy = days.get(day);
      if (energy === undefined) {
        energy = emptyEnergy();
        days.set(day, energy);
      }
      addEnergy(
        energy,
        interpolate(a, b, (from - start) / (end - start)),
        interpolate(a, b, (to - start) / (end - start)),
        (to - from) / 1000,
      );
      from = to;
    }
  }
  return days;
}

export function g2Table(
  records: readonly CaptureRecord[],
  signs: Signs = DEFAULT_SIGNS,
): string {
  const ordered = sorted(records);
  const detect = ordered.find((r) => r.tier === 'DETECT');
  const first = ordered.find((r) => r.tier === 'FAST');
  const words =
    detect &&
    new WordMap(detect.blocks).slice(
      MODEL_STRING.fc,
      MODEL_STRING.addr,
      MODEL_STRING.count,
    );
  const model = words && decodeAsciiString(words);
  const rows = [`| model | ${model || 'n/a'} | exact |`];
  for (const key of COUNTERS)
    rows.push(
      `| ${key} | ${fmt(first ? value(first, key) : null, 1)} kWh | ±0.1 kWh |`,
    );
  rows.push(
    `| battery_soc | ${fmt(first ? value(first, 'battery_soc') : null, 0)} % | ±1 % |`,
  );
  for (const phase of ['a', 'b', 'c']) {
    const key = `meter_grid_voltage_${phase}`;
    rows.push(
      `| ${key} | ${fmt(first ? value(first, key) : null, 1)} V | ±2 V |`,
    );
  }
  return [
    `## G2 decode parity (${signLabel(signs)}; raw decoded values)`,
    '| field | TS value | tolerance |',
    '| --- | ---: | --- |',
    ...rows,
  ].join('\n');
}

export function g3Signs(
  records: readonly CaptureRecord[],
  signs: Signs = DEFAULT_SIGNS,
): string {
  const samples = fast(records);
  let batteryCount = 0,
    statusMissing = 0,
    positiveDischarge = 0,
    positiveCharge = 0;
  let windowsSeconds = 0,
    gridCount = 0;
  const phases = [
    'meter_active_total',
    'meter_active_a',
    'meter_active_b',
    'meter_active_c',
  ];
  const importCount = [0, 0, 0, 0],
    exportCount = [0, 0, 0, 0];
  const qualifying = new Set<CaptureRecord>();
  const residuals: Record<string, number[]> = {
    '+1,+1': [],
    '+1,-1': [],
    '-1,+1': [],
    '-1,-1': [],
  };
  const canonicalErrors: number[] = [];
  for (const r of samples) {
    const bat = value(r, 'bat1_power_g3'),
      status = value(r, 'bat_work_status');
    if (bat !== null && Math.abs(bat) > 100) {
      if (status === null) statusMissing++;
      else {
        batteryCount++;
        if ((bat > 0 && status === 2) || (bat < 0 && status === 1))
          positiveDischarge++;
        if ((bat > 0 && status === 1) || (bat < 0 && status === 2))
          positiveCharge++;
      }
    }
    const solar = pv(r),
      load = vendorLoad(r);
    if (
      solar !== null &&
      solar < 20 &&
      bat !== null &&
      Math.abs(bat) < 50 &&
      load !== null &&
      load > 200 &&
      phases.every((key) => value(r, key) !== null)
    ) {
      qualifying.add(r);
      gridCount++;
      phases.forEach((key, i) => {
        const power = value(r, key)!;
        if (power > 0) importCount[i]!++;
        if (power < 0) exportCount[i]!++;
      });
    }
    const grid = value(r, 'meter_active_total'),
      inverter = inv(r),
      backup = eps(r);
    if (
      load !== null &&
      load > 300 &&
      grid !== null &&
      inverter !== null &&
      backup !== null
    ) {
      for (const sG of [1, -1])
        for (const sI of [1, -1]) {
          residuals[`${sG > 0 ? '+' : '-'}1,${sI > 0 ? '+' : '-'}1`]!.push(
            Math.abs(load - (sG * grid + sI * inverter + backup)),
          );
        }
      canonicalErrors.push(Math.abs(load - derivedLoad(r, signs)!));
    }
  }
  for (let i = 1; i < samples.length; i++) {
    const seconds = dtSeconds(samples[i - 1]!, samples[i]!);
    if (
      seconds > 0 &&
      seconds <= 60 &&
      qualifying.has(samples[i - 1]!) &&
      qualifying.has(samples[i]!)
    )
      windowsSeconds += seconds;
  }
  const ranks = Object.entries(residuals)
    .map(([hypothesis, errors]) => ({ hypothesis, error: median(errors) }))
    .filter(
      (row): row is { hypothesis: string; error: number } => row.error !== null,
    )
    .sort((a, b) => a.error - b.error);
  const best = ranks[0],
    second = ranks[1];
  const separated =
    best !== undefined &&
    second !== undefined &&
    second.error > best.error &&
    second.error >= 3 * best.error;
  const eligible = batteryCount + statusMissing;
  return [
    `## G3 sign tests (${signLabel(signs)}; raw sign hypotheses)`,
    `Battery (|P| > 100 W): n=${eligible} (status known ${batteryCount}, null status ${statusMissing}, counted as disagreement); raw positive=discharge agreement ${percent(positiveDischarge, eligible)}; raw positive=charge agreement ${percent(positiveCharge, eligible)}; >=99%: ${eligible ? (positiveDischarge / eligible >= 0.99 ? 'positive=discharge' : positiveCharge / eligible >= 0.99 ? 'positive=charge' : 'neither') : 'n/a'}.`,
    `Grid import window: ${fmt(windowsSeconds / 60, 2)} min (>=30 min: ${windowsSeconds >= 1800 ? 'yes' : 'no'}), n=${gridCount}; all import: ${windowsSeconds >= 1800 && importCount.every((n) => n === gridCount) && gridCount > 0 ? 'yes' : 'no'}.`,
    '| meter | import (>0) | export (<0) |',
    '| --- | ---: | ---: |',
    ...phases.map(
      (key, i) =>
        `| ${key} | ${percent(importCount[i]!, gridCount)} | ${percent(exportCount[i]!, gridCount)} |`,
    ),
    'Residual medians (W; s_g,s_i):',
    ...Object.entries(residuals).map(
      ([key, errors]) =>
        `- (${key}): ${fmt(median(errors), 2)} W (n=${errors.length})`,
    ),
    `Best: ${best?.hypothesis ?? 'n/a'} (${fmt(best?.error ?? null, 2)} W); >=3x separation: ${best ? (separated ? 'yes' : 'no') : 'n/a'}.`,
    `Canonical signed-load residual median: ${fmt(median(canonicalErrors), 2)} W.`,
  ].join('\n');
}

function meterWords(r: CaptureRecord): number[] | null {
  return new WordMap(r.blocks).slice(4, 1800, 28);
}
function integrateSeries(
  samples: readonly CaptureRecord[],
  getter: (r: CaptureRecord) => number | null,
): { wh: number; covered: number; complete: boolean } {
  let wh = 0,
    covered = 0,
    complete = samples.length > 1;
  for (let i = 1; i < samples.length; i++) {
    const seconds = dtSeconds(samples[i - 1]!, samples[i]!);
    if (seconds <= 0 || seconds > 30) {
      complete = false;
      continue;
    }
    const a = getter(samples[i - 1]!),
      b = getter(samples[i]!);
    if (a !== null && b !== null) {
      wh += ((a + b) * seconds) / 7200;
      covered += seconds;
    } else {
      complete = false;
    }
  }
  return { wh, covered, complete };
}
export function g4Cadence(
  records: readonly CaptureRecord[],
  signs: Signs = DEFAULT_SIGNS,
): string {
  const samples = sorted(
    records.filter((r) => r.tier === 'FAST' || meterWords(r) !== null),
  );
  const meterSamples = samples
    .map((r) => ({ r, words: meterWords(r) }))
    .filter(
      (entry): entry is { r: CaptureRecord; words: number[] } =>
        entry.words !== null,
    );
  const spacings: number[] = [];
  for (let i = 1; i < meterSamples.length; i++) {
    const seconds = dtSeconds(meterSamples[i - 1]!.r, meterSamples[i]!.r);
    if (seconds > 0) spacings.push(seconds);
  }
  const nominal = median(spacings);
  const changes: number[] = [];
  let lastChange: CaptureRecord | undefined,
    previousWords: number[] | undefined,
    previousRecord: CaptureRecord | undefined;
  let longest = 0,
    holes = 0;
  for (const { r, words } of meterSamples) {
    if (
      previousRecord &&
      nominal !== null &&
      dtSeconds(previousRecord, r) > 3 * nominal
    ) {
      holes++;
      lastChange = r;
      previousWords = words;
      previousRecord = r;
      continue;
    }
    if (
      previousWords !== undefined &&
      words.some((w, i) => w !== previousWords![i])
    ) {
      if (lastChange !== undefined) {
        const span = dtSeconds(lastChange, r);
        if (span > 0) changes.push(span);
      }
      lastChange = r;
    } else if (lastChange === undefined) lastChange = r;
    if (lastChange !== undefined)
      longest = Math.max(longest, dtSeconds(lastChange, r));
    previousWords = words;
    previousRecord = r;
  }
  const med = median(changes);
  const powerSamples = samples.map((r) =>
    r.decoded && Object.keys(r.decoded).length
      ? r
      : { ...r, decoded: decodeBlocks(r.blocks) },
  );
  const powerSpacings: number[] = [];
  for (let i = 1; i < powerSamples.length; i++) {
    const seconds = dtSeconds(powerSamples[i - 1]!, powerSamples[i]!);
    if (seconds > 0) powerSpacings.push(seconds);
  }
  const powerCadence = median(powerSpacings);
  // V16 captures use either a 2-second meter probe or a 10-second full poll.
  // Choose the nearer cadence so ordinary poll timing jitter does not change the mode.
  const stride =
    powerCadence !== null &&
    Math.abs(powerCadence - 2) < Math.abs(powerCadence - 10)
      ? 5
      : 2;
  const sparseLabel = stride === 5 ? 'every 5th' : 'every 2nd';
  // Retain the final endpoint so both integrals cover the same wall-clock window.
  const sparse = powerSamples.filter(
    (_, i) => i % stride === 0 || i === powerSamples.length - 1,
  );
  const comparison = (
    label: string,
    getter: (r: CaptureRecord) => number | null,
  ): string => {
    const dense = integrateSeries(powerSamples, getter),
      sparseResult = integrateSeries(sparse, getter);
    const difference =
      powerSamples.length <= stride || !dense.complete || !sparseResult.complete
        ? null
        : dense.wh === 0
          ? sparseResult.wh === 0
            ? 0
            : null
          : (100 * Math.abs(sparseResult.wh - dense.wh)) / Math.abs(dense.wh);
    return `${label}: all ${fmt(dense.covered ? dense.wh : null)} Wh, ${sparseLabel} ${fmt(sparseResult.covered ? sparseResult.wh : null)} Wh, difference ${difference === null ? 'n/a' : fmt(difference, 2) + '%'} (<1%: ${difference === null ? 'n/a; insufficient complete shared data' : difference < 1 ? 'yes' : 'no'}).`;
  };
  return [
    `## G4 cadence (${signLabel(signs)})`,
    `Meter 1800–1827 changes: n=${changes.length}; median ${fmt(med, 2)} s; p90 ${fmt(percentile90(changes), 2)} s; max repeat span ${fmt(longest, 2)} s; holes ${holes}; recommended maxRepeatSpanSec=${med === null ? 'n/a' : fmt(Math.max(30, 2 * med), 2)}.`,
    `Decimation: ${sparseLabel} sample plus final endpoint; nominal ${fmt(powerCadence, 2)} s vs ${fmt(powerCadence === null ? null : stride * powerCadence, 2)} s.`,
    comparison('Grid', (r) => {
      const raw = value(r, 'meter_active_total');
      return raw === null ? null : signs.grid * raw;
    }),
    comparison('Derived load', (r) => derivedLoad(r, signs)),
  ].join('\n');
}

export function g5Counters(
  records: readonly CaptureRecord[],
  tz = DEFAULT_ZONE,
  signs: Signs = DEFAULT_SIGNS,
): string {
  checkedZone(tz);
  const ordered = sorted(records),
    samples = fast(records);
  const gridMeter = (r: CaptureRecord): number | null => {
    const raw = value(r, 'meter_active_total');
    return raw === null ? null : signs.grid * raw;
  };
  const inverterGrid = (r: CaptureRecord): number | null => {
    const raw = value(r, 'grid_active_power_total');
    return raw === null ? null : signs.grid * raw;
  };
  const battery = (r: CaptureRecord): number | null => {
    const raw = value(r, 'bat1_power_g3');
    return raw === null ? null : signs.battery * raw;
  };
  const sources: Record<
    Counter,
    { label: string; get: (r: CaptureRecord) => number | null }[]
  > = {
    pv_total_energy: [{ label: 'pv_total_energy', get: pv }],
    grid_buy_energy: [
      { label: 'grid_buy_energy vs meter', get: gridMeter },
      { label: 'grid_buy_energy vs 2165', get: inverterGrid },
    ],
    grid_sell_energy: [
      { label: 'grid_sell_energy vs meter', get: gridMeter },
      { label: 'grid_sell_energy vs 2165', get: inverterGrid },
    ],
    bat_charge_energy: [{ label: 'bat_charge_energy', get: battery }],
    bat_discharge_energy: [{ label: 'bat_discharge_energy', get: battery }],
    load_energy_use: [
      { label: 'load_energy_use', get: (r) => derivedLoad(r, signs) },
    ],
  };
  const rows = COUNTERS.flatMap((key) => {
    const readings = ordered.filter((r) => value(r, key) !== null);
    const first = readings[0],
      last = readings[readings.length - 1];
    const delta =
      first && last && first !== last
        ? value(last, key)! - value(first, key)!
        : null;
    return sources[key].map(({ label, get }) => {
      let wh = 0,
        coveredSeconds = 0;
      if (first && last && first !== last) {
        const start = Date.parse(first.observedAt),
          end = Date.parse(last.observedAt);
        for (let i = 1; i < samples.length; i++) {
          const a = samples[i - 1]!,
            b = samples[i]!;
          const t0 = Date.parse(a.observedAt),
            t1 = Date.parse(b.observedAt);
          const seconds = (t1 - t0) / 1000;
          if (seconds <= 0 || seconds > 30) continue;
          const from = Math.max(t0, start),
            to = Math.min(t1, end);
          if (from >= to) continue;
          const p0 = get(a),
            p1 = get(b);
          if (p0 === null || p1 === null) continue;
          const left = p0 + ((p1 - p0) * (from - t0)) / (t1 - t0);
          const right = p0 + ((p1 - p0) * (to - t0)) / (t1 - t0);
          const covered = (to - from) / 1000;
          const directional = directionalTrapezoid(left, right, covered);
          wh +=
            key === 'grid_buy_energy' || key === 'bat_discharge_energy'
              ? directional.positiveWh
              : key === 'grid_sell_energy' || key === 'bat_charge_energy'
                ? directional.negativeWh
                : ((left + right) * covered) / 7200;
          coveredSeconds += covered;
        }
      }
      const integrated =
        delta === null || coveredSeconds === 0 ? null : wh / 1000;
      return `| ${label} | ${fmt(delta)} | ${fmt(integrated)} | ${fmt(integrated && delta !== null ? delta / integrated : null)} | ${fmt(coveredSeconds, 0)} |`;
    });
  });
  const resets = TODAY.map((key) => {
    let previous: CaptureRecord | undefined;
    for (const current of ordered) {
      const n = value(current, key);
      if (n === null) continue;
      if (previous && n < value(previous, key)!) {
        const local = DateTime.fromISO(current.observedAt).setZone(tz).toISO();
        return `| ${key} | ${local} | ${n === 0 ? 'yes' : 'no'} |`;
      }
      previous = current;
    }
    return `| ${key} | n/a | n/a |`;
  });
  return [
    `## G5 counter semantics (${signLabel(signs)})`,
    '| counter | Δ counter (kWh) | integrated (kWh) | ratio | covered (s) |',
    '| --- | ---: | ---: | ---: | ---: |',
    ...rows,
    '',
    `First daily-register drops (${tz}):`,
    '| today register | local reset observation | dropped to 0 |',
    '| --- | --- | --- |',
    ...resets,
  ].join('\n');
}

export function dailyBalance(
  records: readonly CaptureRecord[],
  tz = DEFAULT_ZONE,
  signs: Signs = DEFAULT_SIGNS,
): string {
  const days = dailyEnergies(records, tz, signs);
  const rows = [...days].map(([day, e]) => {
    const residual = e.pv + e.dis - e.ch + e.imp - e.exp - e.house;
    const basis = e.pv + e.dis + e.imp;
    const pct = basis > 0 ? (100 * residual) / basis : null;
    return `| ${day} | ${fmt(e.pv)} | ${fmt(e.dis)} | ${fmt(e.ch)} | ${fmt(e.imp)} | ${fmt(e.exp)} | ${fmt(e.house)} | ${fmt(residual)} | ${pct === null ? 'n/a' : fmt(pct, 2) + '%'} | ${fmt(e.seconds, 0)} | ${pct !== null && (pct < 0 || pct > 15) ? 'BALANCE_ANOMALY' : '—'} |`;
  });
  return [
    `## Daily balance (${tz}; Wh; ${signLabel(signs)})`,
    '| local day | PV | battery dis | battery charge | import | export | house | residual | residual % | covered s | status |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |',
    ...rows,
  ].join('\n');
}

export function main(argv: string[]): void {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      tz: { type: 'string', default: DEFAULT_ZONE },
      section: { type: 'string', default: 'all' },
      'grid-sign': { type: 'string', default: '1' },
      'inverter-sign': { type: 'string', default: '1' },
      'battery-sign': { type: 'string', default: '1' },
    },
  });
  if (!positionals.length)
    throw new Error(
      'usage: analyze-capture <capture.jsonl>... [--tz Asia/Kuala_Lumpur] [--section g2|g3|g4|g5|balance|all] [--grid-sign 1|-1] [--inverter-sign 1|-1] [--battery-sign 1|-1]',
    );
  const parseSign = (label: string, raw: string): 1 | -1 => {
    if (raw !== '1' && raw !== '-1')
      throw new Error(`--${label} must be 1 or -1`);
    return raw === '1' ? 1 : -1;
  };
  const signs: Signs = {
    grid: parseSign('grid-sign', values['grid-sign']),
    inverter: parseSign('inverter-sign', values['inverter-sign']),
    battery: parseSign('battery-sign', values['battery-sign']),
  };
  const sections = {
    g2: (r: CaptureRecord[]) => g2Table(r, signs),
    g3: (r: CaptureRecord[]) => g3Signs(r, signs),
    g4: (r: CaptureRecord[]) => g4Cadence(r, signs),
    g5: (r: CaptureRecord[]) => g5Counters(r, values.tz, signs),
    balance: (r: CaptureRecord[]) => dailyBalance(r, values.tz, signs),
  };
  const requested = values.section;
  if (requested !== 'all' && !(requested in sections))
    throw new Error(`invalid section: ${requested}`);
  checkedZone(values.tz);
  const records = positionals.flatMap((path) => loadCapture(path));
  const selected =
    requested === 'all'
      ? Object.values(sections)
      : [sections[requested as keyof typeof sections]];
  console.log(selected.map((render) => render(records)).join('\n\n'));
}
if (isMain(import.meta.url)) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
