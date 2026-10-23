import { Injectable, Logger } from '@nestjs/common';
import { DateTime } from 'luxon';
import { PrismaService } from '../db/prisma.service.js';

const DAY_MS = 86_400_000;
const BATCH_SIZE = 10_000;

export interface RetentionEnv {
  SITE_TIMEZONE: string;
  RAW_RETENTION_DAYS: number;
  SAMPLE_RETENTION_DAYS: number;
}

@Injectable()
export class RetentionService {
  private readonly logger = new Logger('RetentionService');
  private timer: NodeJS.Timeout | undefined;
  private started = false;
  private generation = 0;
  constructor(private readonly prisma: PrismaService) {}

  async runOnce(
    now: Date,
    env: { RAW_RETENTION_DAYS: number; SAMPLE_RETENTION_DAYS: number },
  ): Promise<{
    deletedSamples: number;
    deletedRawPolls: number;
  }> {
    if (
      ![env.RAW_RETENTION_DAYS, env.SAMPLE_RETENTION_DAYS].every(
        (n) => Number.isInteger(n) && n > 0,
      )
    )
      throw new RangeError('retention days must be positive integers');
    const sampleCutoff = new Date(
      now.getTime() - env.SAMPLE_RETENTION_DAYS * DAY_MS,
    );
    const rawCutoff = new Date(now.getTime() - env.RAW_RETENTION_DAYS * DAY_MS);
    let deletedSamples = 0;
    let deletedRawPolls = 0;
    // Pruning shares requestRecalculation's replay reservation (advisory lock 716071/7): a RENORMALIZE
    // still rewriting Samples must commit its run before the DELETE takes its snapshot, or the window
    // protection below could not see it and would delete the rebuilt Samples. The reservation is taken
    // without waiting, outside any short interactive-transaction budget; when it is busy, Sample pruning
    // is deferred to the next run (raw-poll pruning below does not depend on it).
    const client = await this.prisma.pool.connect();
    try {
      while (true) {
        await client.query('BEGIN');
        try {
          const lock = await client.query<{ ok: boolean }>(
            'SELECT pg_try_advisory_xact_lock(716071, 7) AS ok',
          );
          if (!lock.rows[0]?.ok) {
            await client.query('ROLLBACK');
            this.logger.warn(
              'Sample pruning deferred: a replay holds the recalculation reservation',
            );
            break;
          }
          const result = await client.query(
            `WITH doomed AS (
              SELECT s."id" FROM "Sample" s
              WHERE s."observedAt" < $1
                AND s."observedAt" < COALESCE((SELECT min("fromBucket") FROM "LedgerDirtyRange"), 'infinity'::timestamptz)
                AND NOT EXISTS (
                  SELECT 1 FROM "CalculationRun" c
                  WHERE c."kind" = 'RENORMALIZE' AND c."status" = 'RUNNING'
                    AND s."observedAt" >= c."rangeStart" AND s."observedAt" < c."rangeEnd")
              ORDER BY s."observedAt", s."id" LIMIT ${BATCH_SIZE}
            ) DELETE FROM "Sample" s USING doomed WHERE s."id" = doomed."id" RETURNING s."id"`,
            [sampleCutoff],
          );
          await client.query('COMMIT');
          const deleted = result.rowCount ?? 0;
          deletedSamples += deleted;
          if (deleted < BATCH_SIZE) break;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          throw error;
        }
      }
    } finally {
      client.release();
    }
    while (true) {
      const rows = await this.prisma.$queryRaw<{ id: bigint }[]>`
        WITH doomed AS (
          SELECT r."id" FROM "RawPoll" r
          WHERE r."observedAt" < ${rawCutoff}
            AND r."observedAt" < COALESCE((SELECT min("fromBucket") FROM "LedgerDirtyRange"), 'infinity'::timestamptz)
            AND NOT EXISTS (SELECT 1 FROM "Sample" s WHERE s."rawPollId" = r."id")
          ORDER BY r."observedAt", r."id" LIMIT ${BATCH_SIZE}
        ) DELETE FROM "RawPoll" r USING doomed WHERE r."id" = doomed."id" RETURNING r."id"`;
      deletedRawPolls += rows.length;
      if (rows.length < BATCH_SIZE) break;
    }
    return { deletedSamples, deletedRawPolls };
  }

  start(env: RetentionEnv): void {
    if (this.started) return;
    this.started = true;
    const generation = ++this.generation;
    const schedule = () => {
      const now = DateTime.now().setZone(env.SITE_TIMEZONE);
      if (!now.isValid) throw new RangeError('invalid SITE_TIMEZONE');
      let next = now.startOf('day').set({ hour: 3 });
      if (next.toMillis() <= now.toMillis())
        next = now.plus({ days: 1 }).startOf('day').set({ hour: 3 });
      this.timer = setTimeout(() => {
        this.timer = undefined;
        void this.runOnce(new Date(), env)
          .catch(() => {
            // The timer must not create an unhandled rejection or expose database credentials.
            console.error('Retention run failed');
          })
          .finally(() => {
            if (this.started && this.generation === generation) schedule();
          });
      }, next.toMillis() - now.toMillis());
      this.timer.unref();
    };
    schedule();
  }

  stop(): void {
    clearTimeout(this.timer);
    this.started = false;
    this.generation++;
    this.timer = undefined;
  }
}
