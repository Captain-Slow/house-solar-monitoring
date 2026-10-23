import { SampleFlag, type MappingConfig } from '../collector/types.js';
import type {
  ExclusionFamily,
  ExclusionWindow,
  LedgerSample,
} from './types.js';

/**
 * Flags that invalidate battery power. The reading comes from block 1800 (BMS register 1914) or
 * block 0 (inverter register 50) depending on the mapping, so only the configured block counts;
 * a failure of the other block leaves the reading intact.
 */
export function batteryInvalidMask(
  source: MappingConfig['batteryPowerSource'],
): number {
  return (
    (source === 'BMS_1914'
      ? SampleFlag.BLOCK_INVALID_1800
      : SampleFlag.BLOCK_INVALID_0) | SampleFlag.CLOCK_STEP
  );
}

export function familyPowers(sample: LedgerSample): {
  grid: { net: number | null; phases: [number, number, number] | null };
  pv: number | null;
  battery: number | null;
  load: number | null;
} {
  const gridInvalid = Boolean(
    sample.flags &
    (SampleFlag.METER_LINK_DOWN |
      SampleFlag.METER_COMM_FAULT |
      SampleFlag.METER_STALE |
      SampleFlag.BLOCK_INVALID_1800 |
      SampleFlag.CLOCK_STEP),
  );
  const inverterInvalid = Boolean(
    sample.flags & (SampleFlag.BLOCK_INVALID_0 | SampleFlag.CLOCK_STEP),
  );
  const net = gridInvalid ? null : sample.gridW;
  const phases =
    gridInvalid ||
    sample.gridAW === null ||
    sample.gridBW === null ||
    sample.gridCW === null
      ? null
      : ([sample.gridAW, sample.gridBW, sample.gridCW] as [
          number,
          number,
          number,
        ]);
  return {
    grid: { net, phases },
    pv: inverterInvalid ? null : sample.pvW,
    battery:
      sample.flags & batteryInvalidMask(sample.batteryPowerSource)
        ? null
        : sample.batteryW,
    load:
      gridInvalid ||
      inverterInvalid ||
      Boolean(sample.flags & SampleFlag.NEGATIVE_DERIVED_LOAD) ||
      sample.gridW === null ||
      sample.inverterAcW === null ||
      sample.epsW === null
        ? null
        : sample.gridW + sample.inverterAcW + sample.epsW,
  };
}

export function isExcluded(
  family: ExclusionFamily,
  tMs0: number,
  tMs1: number,
  exclusions: readonly ExclusionWindow[],
): boolean {
  return exclusions.some(
    (window) =>
      window.fromMs < tMs1 &&
      tMs0 < window.toMs &&
      (window.families.includes('ALL') || window.families.includes(family)),
  );
}
