import { describe, expect, it } from 'vitest';
import { decodeBlocksBuffer, encodeBlocks } from './raw-poll-codec.js';

describe('RawPoll.blocks codec', () => {
  it('round-trips valid and failed blocks with boundary words, addresses and counts', () => {
    const blocks = [
      { fc: 4 as const, start: 0, count: 3, words: [0, 65535, 32768] },
      {
        fc: 3 as const,
        start: 65535,
        count: 65535,
        words: null,
        error: 'not serialized',
      },
      { fc: 4 as const, start: 65535, count: 0, words: [] },
    ];
    const encoded = encodeBlocks(blocks);
    expect(encoded.length).toBe(6 + 6 + 6 + 6);
    expect(
      encoded.subarray(6, 12).equals(Buffer.from([0, 0, 255, 255, 128, 0])),
    ).toBe(true);
    expect(decodeBlocksBuffer(encoded)).toEqual([
      blocks[0],
      { fc: 3, start: 65535, count: 65535, words: null },
      blocks[2],
    ]);
  });

  it('rejects malformed records instead of treating truncated words as zeros', () => {
    expect(() =>
      decodeBlocksBuffer(Buffer.from([4, 0, 0, 0, 2, 1, 0, 1])),
    ).toThrow('truncated');
    expect(() => decodeBlocksBuffer(Buffer.from([4, 0, 0]))).toThrow(
      'truncated',
    );
    expect(() => decodeBlocksBuffer(Buffer.from([4, 0, 0, 0, 0, 2]))).toThrow(
      'status',
    );
    expect(() =>
      encodeBlocks([{ fc: 4, start: 0, count: 1, words: [] }]),
    ).toThrow('words');
  });
});
