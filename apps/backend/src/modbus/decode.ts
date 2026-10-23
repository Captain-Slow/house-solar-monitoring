import {
  WORD_SIZE,
  type Dtype,
  type FunctionCode,
  type RegisterDef,
} from './register-map.js';
import { REGISTERS, registerAt } from './register-map.js';

/**
 * Port of the library's `decode_words`: big-endian, high word first; `I32R` is low word
 * first; the result is divided by `scale`.
 */
export function decodeWords(
  words: readonly number[],
  dtype: Dtype,
  scale = 1,
): number {
  const need = WORD_SIZE[dtype];
  if (words.length < need)
    throw new RangeError(`${dtype} needs ${need} word(s), got ${words.length}`);
  let v: number;
  switch (dtype) {
    case 'U16':
      v = words[0]!;
      break;
    case 'I16':
      v = words[0]! >= 0x8000 ? words[0]! - 0x10000 : words[0]!;
      break;
    case 'U32':
    case 'H32':
      v = words[0]! * 0x10000 + words[1]!;
      break;
    case 'I32':
      v = words[0]! * 0x10000 + words[1]!;
      if (v >= 0x80000000) v -= 0x100000000;
      break;
    case 'I32R':
      v = words[1]! * 0x10000 + words[0]!;
      if (v >= 0x80000000) v -= 0x100000000;
      break;
  }
  return scale === 1 ? v : v / scale;
}

/**
 * Port of `decode_ascii_string`: each word's bytes are swapped (low byte first), non-printable
 * bytes become separators and the longest printable run wins; "" if none.
 */
export function decodeAsciiString(
  words: readonly number[],
  byteSwap = true,
): string {
  let text = '';
  for (const w of words) {
    const hi = byteSwap ? w & 0xff : (w >> 8) & 0xff;
    const lo = byteSwap ? (w >> 8) & 0xff : w & 0xff;
    for (const c of [hi, lo])
      text += c >= 32 && c < 127 ? String.fromCharCode(c) : '.';
  }
  let best = '';
  for (const run of text.split('.')) if (run.length > best.length) best = run;
  return best;
}

/** One raw block of a poll. `words` is null when the block was not read or was rejected. */
export interface RawBlock {
  fc: FunctionCode;
  start: number;
  count: number;
  words: number[] | null;
  error?: string;
}

/** Address -> word view over the valid blocks of ONE poll, per function code. */
export class WordMap {
  private readonly maps: Record<FunctionCode, Map<number, number>> = {
    3: new Map(),
    4: new Map(),
  };

  constructor(blocks: readonly RawBlock[]) {
    for (const b of blocks) {
      if (b.words === null || b.words.length !== b.count) continue;
      const m = this.maps[b.fc];
      for (let i = 0; i < b.count; i++) m.set(b.start + i, b.words[i]!);
    }
  }

  /** The `n` words at `addr`, or null if any is missing (never a partial value). */
  slice(fc: FunctionCode, addr: number, n: number): number[] | null {
    const m = this.maps[fc];
    const out: number[] = [];
    for (let i = 0; i < n; i++) {
      const w = m.get(addr + i);
      if (w === undefined) return null;
      out.push(w);
    }
    return out;
  }

  value(reg: RegisterDef): number | null {
    const ws = this.slice(reg.fc, reg.addr, WORD_SIZE[reg.dtype]);
    return ws === null ? null : decodeWords(ws, reg.dtype, reg.scale);
  }
}

export type DecodedValues = Record<string, number | null>;

/** Decode every mapped register covered by the blocks; a register with a missing word is null. */
export function decodeBlocks(blocks: readonly RawBlock[]): DecodedValues {
  const wm = new WordMap(blocks);
  const covered = new Set<string>();
  for (const b of blocks) {
    if (b.words === null) continue;
    for (let i = 0; i < b.count; i++) covered.add(`${b.fc}:${b.start + i}`);
  }
  const out: DecodedValues = {};
  for (const reg of REGISTERS) {
    if (covered.has(`${reg.fc}:${reg.addr}`)) out[reg.key] = wm.value(reg);
  }
  return out;
}

/** Plausibility of the registers fully contained in one block read (port of `block_is_plausible`). */
export function findImplausible(
  fc: FunctionCode,
  start: number,
  words: readonly number[],
): { key: string; value: number } | null {
  for (let i = 0; i < words.length; i++) {
    const reg = registerAt(fc, start + i);
    if (reg?.bounds === undefined) continue;
    const n = WORD_SIZE[reg.dtype];
    if (i + n > words.length) continue; // block-edge partial: not "bad data"
    const raw = decodeWords(words.slice(i, i + n), reg.dtype, 1);
    if (reg.boundsAllowZero === true && raw === 0) continue;
    const v = reg.scale === 1 ? raw : raw / reg.scale;
    if (v < reg.bounds[0] || v > reg.bounds[1])
      return { key: reg.key, value: v };
  }
  return null;
}

/** Label of an enum register value, or the raw number as text. */
export function enumLabel(reg: RegisterDef, value: number): string {
  return reg.enum?.[value] ?? String(value);
}

/** Labels of the set bits of a bitmap register; unknown bits are `bit<N>`. */
export function bitmapLabels(reg: RegisterDef, value: number): string[] {
  const out: string[] = [];
  for (let bit = 0; bit < 32; bit++) {
    if (Math.floor(value / 2 ** bit) % 2 === 1)
      out.push(reg.bitmap?.[bit] ?? `bit${bit}`);
  }
  return out;
}
