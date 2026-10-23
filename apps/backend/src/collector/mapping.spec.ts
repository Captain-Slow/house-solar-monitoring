import { describe, expect, it } from 'vitest';
import {
  DEFAULT_MAPPING_V1,
  MAPPING_V1_NOTE,
  validateMappingConfig,
} from './mapping.js';

describe('mapping v1', () => {
  it('keeps unverified signs provisional until G3', () => {
    expect(DEFAULT_MAPPING_V1).toEqual({
      gridMeterSign: 1,
      gridMeterPhaseSign: [1, 1, 1],
      inverterAcSign: 1,
      batterySign: 1,
      batteryPowerSource: 'BAT1_POWER_G3_50',
      maxRepeatSpanSec: 30,
    });
    expect(MAPPING_V1_NOTE).toMatch(/provisional.*G3/i);
  });
  it('rejects malformed persisted mappings instead of interpreting missing signs as zeros', () => {
    expect(() =>
      validateMappingConfig({ ...DEFAULT_MAPPING_V1, batterySign: 0 }),
    ).toThrow();
    expect(() =>
      validateMappingConfig({
        ...DEFAULT_MAPPING_V1,
        gridMeterPhaseSign: [1, -1],
      }),
    ).toThrow();
    expect(validateMappingConfig(DEFAULT_MAPPING_V1)).toEqual(
      DEFAULT_MAPPING_V1,
    );
  });
});
