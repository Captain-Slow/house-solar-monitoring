import { describe, expect, it } from 'vitest';
import { newImage, setModel } from '../../test/support/synthetic.js';
import {
  bitmapLabels,
  decodeAsciiString,
  decodeBlocks,
  decodeWords,
  findImplausible,
} from './decode.js';
import { REGISTERS_BY_KEY } from './register-map.js';

describe('decodeWords', () => {
  it('is big-endian high-word-first for 32-bit types and I32R is low-word-first', () => {
    expect(decodeWords([0x0001, 0x0002], 'U32')).toBe(0x10002);
    expect(decodeWords([0x0001, 0x0002], 'I32R')).toBe(0x20001);
    expect(decodeWords([0xffff, 0xffff], 'U32')).toBe(0xffffffff);
    expect(decodeWords([0xffff, 0xffff], 'H32')).toBe(0xffffffff);
  });

  it('sign-extends I16 and I32 but never U16/U32/H32', () => {
    expect(decodeWords([0xffff], 'I16')).toBe(-1);
    expect(decodeWords([0x8000], 'I16')).toBe(-32768);
    expect(decodeWords([0x7fff], 'I16')).toBe(32767);
    expect(decodeWords([0xffff], 'U16')).toBe(65535);
    expect(decodeWords([0xffff, 0xfc18], 'I32')).toBe(-1000);
    expect(decodeWords([0x8000, 0x0000], 'I32')).toBe(-2147483648);
    expect(decodeWords([0x8000, 0x0000], 'U32')).toBe(2147483648);
    expect(decodeWords([0xfc18, 0xffff], 'I32R')).toBe(-1000);
  });

  it('divides by scale', () => {
    expect(decodeWords([2305], 'U16', 10)).toBeCloseTo(230.5);
    expect(decodeWords([0, 12345], 'U32', 10)).toBeCloseTo(1234.5);
    expect(decodeWords([0xff9c], 'I16', 100)).toBeCloseTo(-1);
  });
});

describe('decodeAsciiString', () => {
  it('swaps bytes within each word and returns the longest printable run', () => {
    const img = newImage();
    setModel(img, 'HIT-10L-G3');
    const words = [0, 1, 2, 3, 4].map((i) => img[4].get(1000 + i)!);
    expect(decodeAsciiString(words)).toBe('HIT-10L-G3');
    expect(decodeAsciiString(words, false)).not.toBe('HIT-10L-G3');
  });

  it('breaks runs on non-printable bytes and returns "" when nothing is printable', () => {
    // 'A' 'B' 0x00 'C' 'D' 'E' -> runs "AB" and "CDE"
    expect(decodeAsciiString([0x4241, 0x4300, 0x4544])).toBe('CDE');
    expect(decodeAsciiString([0, 0, 0])).toBe('');
  });
});

describe('decodeBlocks', () => {
  it('stitches a 32-bit register across two blocks of one poll and nulls it when a word is missing', () => {
    const lo = REGISTERS_BY_KEY.get('grid_buy_energy')!;
    const a = { fc: 4 as const, start: lo.addr, count: 1, words: [0x0001] };
    const b = { fc: 4 as const, start: lo.addr + 1, count: 1, words: [0x0000] };
    expect(decodeBlocks([a, b]).grid_buy_energy).toBeCloseTo(6553.6);
    // second half missing: the register is incomplete -> null, never a half value
    expect(
      decodeBlocks([a, { ...b, words: null, error: 'x' }]).grid_buy_energy,
    ).toBeNull();
    expect(decodeBlocks([a]).grid_buy_energy).toBeNull();
  });

  it('keeps FC03 and FC04 address spaces apart', () => {
    const decoded = decodeBlocks([
      { fc: 3, start: 4300, count: 1, words: [4] },
      { fc: 4, start: 4300, count: 1, words: [9] },
    ]);
    expect(decoded.ems_mode).toBe(4);
  });
});

describe('findImplausible', () => {
  it('accepts a valid 820 V PV string and flags 1100.1 V', () => {
    const pv1 = REGISTERS_BY_KEY.get('pv1_voltage')!;
    expect(findImplausible(4, pv1.addr, [8200])).toBeNull();
    expect(findImplausible(4, pv1.addr, [11000])).toBeNull();
    expect(findImplausible(4, pv1.addr, [11001])).toEqual({
      key: 'pv1_voltage',
      value: 1100.1,
    });
  });

  it('exempts a zero frequency but bounds a non-zero one', () => {
    const f = REGISTERS_BY_KEY.get('grid_frequency')!;
    expect(findImplausible(4, f.addr, [0])).toBeNull();
    expect(findImplausible(4, f.addr, [5000])).toBeNull();
    expect(findImplausible(4, f.addr, [3000])?.key).toBe('grid_frequency');
  });
});

describe('bitmapLabels', () => {
  it('names set bits and falls back to bitN', () => {
    const f = REGISTERS_BY_KEY.get('arm_periph_faults')!;
    expect(bitmapLabels(f, 0b100)).toEqual(['Grid meter comm lost']);
    expect(bitmapLabels(f, 1)).toEqual(['bit0']);
    const big = REGISTERS_BY_KEY.get('dsp_safety_faults')!;
    expect(bitmapLabels(big, 2 ** 31)).toEqual(['Fan error']);
  });
});
