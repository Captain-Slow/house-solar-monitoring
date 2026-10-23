import { describe, expect, it } from 'vitest';
import { CollectorPollQueue } from './collector.service.js';
import type { IngestPoll } from './types.js';

function poll(seq: number, tier: 'FAST' | 'SLOW' | 'SETTINGS'): IngestPoll {
  const at = new Date(seq * 1000);
  return {
    runId: 1,
    seq,
    deviceId: 1,
    tier,
    requestedAt: at,
    receivedAt: at,
    observedAt: at,
    blocks: Buffer.alloc(0),
    events: [],
  };
}

describe('collector persistence queue', () => {
  it('retains all 360 FAST polls despite due SLOW and SETTINGS polls during an outage', () => {
    const queue = new CollectorPollQueue();
    queue.push(poll(1, 'FAST'));
    expect(queue.batch().map((entry) => entry.seq)).toEqual([1]); // failed pending batch
    for (let i = 2; i <= 360; i++) {
      queue.push(poll(i * 3, 'FAST'));
      queue.push(poll(i * 3 + 1, 'SLOW'));
      queue.push(poll(i * 3 + 2, 'SETTINGS'));
    }
    expect(queue.size).toBe(424); // FAST reserve 360, status reserve 64
    expect(queue.droppedFast).toBe(0);
    expect(queue.droppedStatus).toBe(654);
    const first = queue.batch();
    expect(first.map((entry) => entry.seq)).toEqual([1]);
    queue.acknowledge();
    const remainder = queue.batch();
    expect(remainder.filter((entry) => entry.tier === 'FAST')).toHaveLength(
      359,
    );
    expect(remainder.filter((entry) => entry.tier !== 'FAST')).toHaveLength(64);
    const seqs = remainder.map((entry) => entry.seq);
    expect(seqs).toEqual(seqs.toSorted((a, b) => a - b));
  });

  it('drops the oldest FAST only after the full 360 FAST capacity is consumed', () => {
    const queue = new CollectorPollQueue();
    queue.push(poll(1, 'FAST'));
    queue.batch();
    for (let i = 2; i <= 361; i++) queue.push(poll(i, 'FAST'));
    expect(queue.droppedFast).toBe(1);
    expect(queue.size).toBe(360);
    queue.acknowledge();
    const remaining = queue.batch();
    expect(remaining[0]!.seq).toBe(2);
    expect(remaining.at(-1)!.seq).toBe(361);
  });
});
