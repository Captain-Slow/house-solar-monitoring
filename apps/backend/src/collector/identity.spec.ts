import { describe, expect, it } from 'vitest';
import type { DetectedInfo } from '../modbus/hoymiles-g3.js';
import { compareIdentity, diffCapabilities } from './identity.js';

describe('device identity', () => {
  const day: DetectedInfo = {
    model: 'HIT-10L-G3',
    firmware: { powerDspVersion: 105, safetyDspVersion: 102 },
    observed: {
      hasBattery: true,
      hasGridMeter: true,
      mpptCount: 2,
      batteryCapacityKwh: 16,
    },
    raw: {
      tier: 'DETECT',
      requestedAt: new Date(),
      receivedAt: new Date(),
      blocks: [],
    },
  };
  it('compares only model, not day/night capabilities or firmware', () => {
    expect(compareIdentity(day, 'HIT-10L-G3')).toBe('OK');
    expect(
      compareIdentity(
        {
          ...day,
          observed: {
            hasBattery: false,
            hasGridMeter: false,
            mpptCount: 0,
            batteryCapacityKwh: null,
          },
          firmware: { powerDspVersion: 1, safetyDspVersion: null },
        },
        'HIT-10L-G3',
      ),
    ).toBe('OK');
    expect(compareIdentity(day, 'HIT-15L-G3')).toBe('MISMATCH');
  });
  it('reports exactly changed observations', () => {
    expect(
      diffCapabilities(day.observed, { ...day.observed, mpptCount: 0 }),
    ).toEqual(['mpptCount']);
    expect(
      diffCapabilities(day.observed, {
        hasBattery: false,
        hasGridMeter: false,
        mpptCount: 0,
        batteryCapacityKwh: null,
      }),
    ).toEqual([
      'hasBattery',
      'hasGridMeter',
      'mpptCount',
      'batteryCapacityKwh',
    ]);
  });
});
