import type { RawBlock } from './decode.js';

/** Failed blocks keep their requested count but have no word payload; error text is not stored. */
export function encodeBlocks(blocks: RawBlock[]): Buffer {
  let size = 0;
  for (const block of blocks) {
    if (block.fc !== 3 && block.fc !== 4)
      throw new RangeError('invalid function code');
    if (
      !Number.isInteger(block.start) ||
      block.start < 0 ||
      block.start > 65535 ||
      !Number.isInteger(block.count) ||
      block.count < 0 ||
      block.count > 65535
    ) {
      throw new RangeError('block address/count out of range');
    }
    if (block.words !== null) {
      if (
        block.words.length !== block.count ||
        block.words.some((w) => !Number.isInteger(w) || w < 0 || w > 65535)
      ) {
        throw new RangeError('invalid block words');
      }
    }
    size += 6 + (block.words === null ? 0 : block.count * 2);
  }
  const buffer = Buffer.allocUnsafe(size);
  let pos = 0;
  for (const block of blocks) {
    buffer.writeUInt8(block.fc, pos);
    buffer.writeUInt16BE(block.start, pos + 1);
    buffer.writeUInt16BE(block.count, pos + 3);
    buffer.writeUInt8(block.words === null ? 0 : 1, pos + 5);
    pos += 6;
    if (block.words !== null) {
      for (const word of block.words) {
        buffer.writeUInt16BE(word, pos);
        pos += 2;
      }
    }
  }
  return buffer;
}

export function decodeBlocksBuffer(buffer: Buffer): RawBlock[] {
  const blocks: RawBlock[] = [];
  let pos = 0;
  while (pos < buffer.length) {
    if (buffer.length - pos < 6) throw new RangeError('truncated block header');
    const fc = buffer.readUInt8(pos);
    if (fc !== 3 && fc !== 4) throw new RangeError('invalid function code');
    const start = buffer.readUInt16BE(pos + 1);
    const count = buffer.readUInt16BE(pos + 3);
    const ok = buffer.readUInt8(pos + 5);
    if (ok !== 0 && ok !== 1) throw new RangeError('invalid block status');
    pos += 6;
    if (ok === 0) {
      blocks.push({ fc, start, count, words: null });
      continue;
    }
    if (buffer.length - pos < count * 2)
      throw new RangeError('truncated block words');
    const words: number[] = [];
    for (let i = 0; i < count; i++) {
      words.push(buffer.readUInt16BE(pos));
      pos += 2;
    }
    blocks.push({ fc, start, count, words });
  }
  return blocks;
}
