import { createWriteStream } from 'node:fs';
import { once } from 'node:events';
import { finished } from 'node:stream/promises';
import { parseArgs } from 'node:util';
import { Client, type QueryResult } from 'pg';
import { buildDatabaseUrl } from '../config/database-url.js';
import type { CaptureRecord } from '../modbus/capture.js';
import { decodeBlocks } from '../modbus/decode.js';
import { decodeBlocksBuffer } from '../modbus/raw-poll-codec.js';
import { isMain } from './is-main.js';

type PollTier = CaptureRecord['tier'];
export interface ExportRow {
  id: string;
  observedAt: Date;
  requestedAt: Date;
  receivedAt: Date;
  tier: PollTier;
  blocks: Buffer;
}

/**
 * Reconstitute the raw capture shape produced by recordFromPoll, without a device or DB.
 * This is a diagnostic/wire-replay export, not a lossless Sample/acquisition-timing backup.
 * Historical sample rebuilds use RENORMALIZE on retained RawPoll timing, or restore a DB dump.
 */
export function recordFromRow(row: ExportRow): CaptureRecord {
  const blocks = decodeBlocksBuffer(row.blocks);
  return {
    observedAt: row.observedAt.toISOString(),
    tier: row.tier,
    blocks,
    decoded: decodeBlocks(blocks),
    requestedAt: row.requestedAt.toISOString(),
    receivedAt: row.receivedAt.toISOString(),
  };
}

const PAGE_SIZE = 5000;
export async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      out: { type: 'string' },
      from: { type: 'string' },
      to: { type: 'string' },
      'device-id': { type: 'string' },
    },
  });
  if (!values.out)
    throw new Error(
      'usage: export-samples --out <file.jsonl> [--from ISO] [--to ISO] [--device-id N]',
    );
  const parseDate = (input: string | undefined, fallback: string): string => {
    if (input === undefined) return fallback;
    const date = new Date(input);
    if (
      !Number.isFinite(date.valueOf()) ||
      !/(?:Z|[+-]\d\d:\d\d)$/i.test(input)
    )
      throw new Error(`invalid ISO instant: ${input}`);
    return date.toISOString();
  };
  const from = parseDate(values.from, '1970-01-01T00:00:00.000Z');
  const to = parseDate(values.to, '9999-12-31T23:59:59.999Z');
  if (Date.parse(from) >= Date.parse(to))
    throw new Error('--from must precede --to');
  const deviceId =
    values['device-id'] === undefined ? null : Number(values['device-id']);
  if (deviceId !== null && (!Number.isSafeInteger(deviceId) || deviceId <= 0))
    throw new Error('--device-id must be a positive integer');
  const client = new Client({
    connectionString: buildDatabaseUrl(process.env),
  });
  await client.connect();
  const output = createWriteStream(values.out, { encoding: 'utf8' });
  try {
    let lastAt: Date | null = null,
      lastId: string | null = null;
    for (;;) {
      const result: QueryResult<ExportRow> = await client.query<ExportRow>(
        `
        SELECT id, "observedAt", tier::text AS tier, "requestedAt", "receivedAt", blocks
        FROM "RawPoll"
        WHERE ("deviceId" = $1 OR $1 IS NULL)
          AND "observedAt" >= $2 AND "observedAt" < $3
          AND ($4::timestamptz IS NULL OR ("observedAt", id) > ($4::timestamptz, $5::bigint))
        ORDER BY "observedAt", id LIMIT $6
      `,
        [deviceId, from, to, lastAt, lastId, PAGE_SIZE],
      );
      for (const row of result.rows) {
        if (!output.write(JSON.stringify(recordFromRow(row)) + '\n'))
          await once(output, 'drain');
      }
      if (result.rows.length < PAGE_SIZE) break;
      const last = result.rows[result.rows.length - 1]!;
      lastAt = last.observedAt;
      lastId = last.id;
    }
    output.end();
    await finished(output);
  } catch (error) {
    output.destroy();
    throw error;
  } finally {
    await client.end();
  }
}
if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
