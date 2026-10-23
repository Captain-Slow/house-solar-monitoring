import { setTimeout as delay } from 'node:timers/promises';
import {
  decodeAsciiString,
  decodeWords,
  findImplausible,
  type RawBlock,
} from './decode.js';
import {
  DETECT_BLOCKS,
  TIER_PLANS,
  type PlannedBlock,
  type PollTierName,
} from './read-plan.js';
import {
  ModbusExceptionError,
  ModbusTransportError,
  type RegisterReader,
} from './readonly-modbus-client.js';
import { MODEL_STRING } from './register-map.js';

export interface DetectedInfo {
  /** The only field that takes part in identity checks (`EXPECTED_MODEL`). */
  model: string;
  /** Raw firmware words: register 1 (power DSP) from the detect read; 201 (safety DSP) is read by SLOW. */
  firmware: { powerDspVersion: number | null; safetyDspVersion: number | null };
  /** Live observations. These change (night, link drop); never identity, never a counter boundary. */
  observed: {
    hasBattery: boolean;
    hasGridMeter: boolean;
    mpptCount: number;
    batteryCapacityKwh: number | null;
  };
  raw: RawPoll;
}

export interface RawPoll {
  tier: PollTierName;
  requestedAt: Date;
  receivedAt: Date;
  blocks: RawBlock[];
  /** Set when the connection failed mid-poll; the collector must close and reconnect. */
  transportError?: string;
}

export class DetectError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DetectError';
  }
}

export const RETRY_COUNT = 2;
export const RETRY_DELAY_MS = 50;

/** Read-only G3 poller built on a {@link RegisterReader}. */
export class HoymilesG3 {
  constructor(private readonly reader: RegisterReader) {}

  /** Same rules as the library's `detect_config`, reading exactly its four blocks. */
  async detect(): Promise<DetectedInfo> {
    const raw = await this.readPlan('DETECT', DETECT_BLOCKS);
    const block = (start: number): number[] => {
      const b = raw.blocks.find((x) => x.fc === 4 && x.start === start);
      if (b?.words === null || b?.words === undefined) {
        throw new DetectError(
          `detect block ${start} unavailable: ${b?.error ?? raw.transportError ?? 'not read'}`,
        );
      }
      return b.words;
    };
    const a = block(0);
    const b = block(1000);
    const batt = block(1900);
    const meter = block(1800);

    const model =
      decodeAsciiString(b.slice(0, MODEL_STRING.count)) || 'unknown';

    const link = batt[1]!; // 1901
    const capRaw = decodeWords([batt[7]!, batt[8]!], 'U32'); // 1907-1908
    const soc = batt[9]!; // 1909
    const volts = batt[11]! * 0.1; // 1911
    const hasBattery =
      link > 0 || (capRaw * 0.1 > 1 && soc >= 0 && soc <= 100 && volts > 10);

    const mlink = meter[0]!; // 1800
    const hasGridMeter =
      mlink > 0 ||
      [meter[4]!, meter[5]!, meter[6]!].some((x) => x > 0 || x >= 0x8000);

    const mpptCount = [a[27]!, a[30]!, a[33]!, a[36]!].filter(
      (pv) => pv > 10,
    ).length;

    return {
      model,
      firmware: { powerDspVersion: a[1]!, safetyDspVersion: null },
      observed: {
        hasBattery,
        hasGridMeter,
        mpptCount,
        batteryCapacityKwh: hasBattery ? capRaw / 10 : null,
      },
      raw,
    };
  }

  readTier(tier: Exclude<PollTierName, 'DETECT'>): Promise<RawPoll> {
    return this.readPlan(tier, TIER_PLANS[tier]);
  }

  /** Reads one block with the per-register plausibility retry (up to 2 re-reads, 50 ms apart). */
  async readBlock(pb: PlannedBlock): Promise<RawBlock & { transport?: true }> {
    let lastBad = '';
    for (let attempt = 0; attempt <= RETRY_COUNT; attempt++) {
      let words: number[];
      try {
        words =
          pb.fc === 4
            ? await this.reader.readInput(pb.start, pb.count)
            : await this.reader.readHolding(pb.start, pb.count);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (err instanceof ModbusExceptionError)
          return { ...pb, words: null, error: `MODBUS_EXCEPTION: ${msg}` };
        if (err instanceof ModbusTransportError)
          return {
            ...pb,
            words: null,
            error: `TRANSPORT: ${msg}`,
            transport: true,
          };
        throw err; // not a device error (e.g. ownership lost): never recorded as telemetry
      }
      const bad = findImplausible(pb.fc, pb.start, words);
      if (bad === null) return { ...pb, words };
      lastBad = `${bad.key}=${bad.value}`;
      if (attempt < RETRY_COUNT) await delay(RETRY_DELAY_MS);
    }
    return { ...pb, words: null, error: `IMPLAUSIBLE: ${lastBad}` };
  }

  private async readPlan(
    tier: PollTierName,
    plan: readonly PlannedBlock[],
  ): Promise<RawPoll> {
    const requestedAt = new Date();
    const blocks: RawBlock[] = [];
    let transportError: string | undefined;
    for (const pb of plan) {
      if (transportError !== undefined) {
        blocks.push({
          ...pb,
          words: null,
          error: 'SKIPPED_AFTER_TRANSPORT_ERROR',
        });
        continue;
      }
      const { transport, ...blk } = await this.readBlock(pb);
      blocks.push(blk);
      if (transport === true) transportError = blk.error;
    }
    const poll: RawPoll = { tier, requestedAt, receivedAt: new Date(), blocks };
    if (transportError !== undefined) poll.transportError = transportError;
    return poll;
  }
}

/** `observedAt` = midpoint of the first request and the last response. */
export function observedAt(
  poll: Pick<RawPoll, 'requestedAt' | 'receivedAt'>,
): Date {
  return new Date((poll.requestedAt.getTime() + poll.receivedAt.getTime()) / 2);
}
