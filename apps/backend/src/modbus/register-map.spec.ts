import { describe, expect, it } from 'vitest';
import {
  REGISTERS as MAP,
  REGISTERS_BY_KEY,
  WORD_SIZE,
  type RegisterDef,
} from './register-map.js';

const REGISTERS: readonly RegisterDef[] = MAP;

describe('register map', () => {
  it('has no junk registers (2151, 112, 153-156, load_energy_total)', () => {
    const addrs = new Set(
      REGISTERS.filter((r) => r.fc === 4).map((r) => r.addr),
    );
    for (const junk of [112, 153, 154, 155, 156, 2151])
      expect(addrs.has(junk), String(junk)).toBe(false);
    expect(REGISTERS_BY_KEY.has('load_energy_total')).toBe(false);
  });

  it('has unique keys and no two registers share a word within one function code', () => {
    expect(new Set(REGISTERS.map((r) => r.key)).size).toBe(REGISTERS.length);
    const owner = new Map<string, string>();
    for (const r of REGISTERS) {
      for (let i = 0; i < WORD_SIZE[r.dtype]; i++) {
        const k = `${r.fc}:${r.addr + i}`;
        expect(
          owner.get(k),
          `${r.key} overlaps ${owner.get(k)}`,
        ).toBeUndefined();
        owner.set(k, r.key);
      }
    }
  });

  it('uses the plan bounds: PV strings 0-1100 V, AC/meter 0-600 V, battery 0-150 V, SOC 0-100', () => {
    for (const k of [
      'pv1_voltage',
      'pv2_voltage',
      'pv3_voltage',
      'pv4_voltage',
    ]) {
      expect(REGISTERS_BY_KEY.get(k)!.bounds).toEqual([0, 1100]);
    }
    for (const addr of [
      62, 63, 64, 67, 68, 69, 81, 82, 83, 1801, 1802, 1803, 1851, 1852, 1853,
    ]) {
      expect(
        REGISTERS.find((r) => r.fc === 4 && r.addr === addr)!.bounds,
        String(addr),
      ).toEqual([0, 600]);
    }
    for (const addr of [46, 1911])
      expect(REGISTERS.find((r) => r.addr === addr)!.bounds).toEqual([0, 150]);
    expect(REGISTERS_BY_KEY.get('battery_soc')!.bounds).toEqual([0, 100]);
    expect(REGISTERS_BY_KEY.get('battery_soh')!.bounds).toEqual([0, 150]);
  });

  it('never bounds power, current or energy registers', () => {
    for (const r of REGISTERS) {
      if (r.unit === 'W' || r.unit === 'A' || r.unit === 'kWh')
        expect(r.bounds, r.key).toBeUndefined();
    }
  });

  it('declares FC03 only for the settings registers', () => {
    const holding = REGISTERS.filter((r) => r.fc === 3).map((r) => r.addr);
    expect(Math.min(...holding)).toBe(258);
    expect(holding).toContain(4300);
    expect(REGISTERS_BY_KEY.get('ems_mode')!.fc).toBe(3);
    expect(REGISTERS_BY_KEY.get('system_workstatus')!.fc).toBe(4);
  });
});
