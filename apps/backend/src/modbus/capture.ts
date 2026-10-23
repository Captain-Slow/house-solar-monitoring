import { readFileSync } from 'node:fs';
import { decodeBlocks, type DecodedValues, type RawBlock } from './decode.js';
import { observedAt, type RawPoll } from './hoymiles-g3.js';
import type { PollTierName } from './read-plan.js';

/**
 * One JSONL capture line: `{observedAt, tier, blocks, decoded}`. Written by the probe and by
 * export-samples, read by the replay server and analyze-capture. Modbus data holds no secrets.
 */
export interface CaptureRecord {
  /** Midpoint of first request and last response, ISO-8601 UTC. */
  observedAt: string;
  tier: PollTierName;
  blocks: RawBlock[];
  /** key -> decoded value for every mapped register fully covered by valid blocks. */
  decoded: DecodedValues;
  requestedAt?: string;
  receivedAt?: string;
  transportError?: string;
}

const TIERS: readonly string[] = ['DETECT', 'FAST', 'SLOW', 'SETTINGS'];

export function recordFromPoll(poll: RawPoll): CaptureRecord {
  const rec: CaptureRecord = {
    observedAt: observedAt(poll).toISOString(),
    tier: poll.tier,
    blocks: poll.blocks,
    decoded: decodeBlocks(poll.blocks),
    requestedAt: poll.requestedAt.toISOString(),
    receivedAt: poll.receivedAt.toISOString(),
  };
  if (poll.transportError !== undefined)
    rec.transportError = poll.transportError;
  return rec;
}

export function parseCapture(
  text: string,
  source = 'capture',
): CaptureRecord[] {
  const out: CaptureRecord[] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (line === '') continue;
    let rec: CaptureRecord;
    try {
      rec = JSON.parse(line) as CaptureRecord;
    } catch {
      throw new Error(`${source}:${i + 1}: invalid JSON`);
    }
    if (
      typeof rec.observedAt !== 'string' ||
      !TIERS.includes(rec.tier) ||
      !Array.isArray(rec.blocks) ||
      Number.isNaN(Date.parse(rec.observedAt))
    ) {
      throw new Error(`${source}:${i + 1}: not a capture record`);
    }
    out.push(rec);
  }
  return out;
}

export function loadCapture(path: string): CaptureRecord[] {
  return parseCapture(readFileSync(path, 'utf8'), path);
}
