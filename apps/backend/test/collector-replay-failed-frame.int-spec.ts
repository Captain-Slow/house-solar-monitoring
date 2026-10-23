import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { setTimeout as delay } from 'node:timers/promises';
import {
  CollectorService,
  type IngestSink,
} from '../src/collector/collector.service.js';
import { IngestService } from '../src/collector/ingest.service.js';
import { SampleFlag } from '../src/collector/types.js';
import {
  startReplayServer,
  type ReplayServer,
} from '../src/cli/replay-server.js';
import { parseEnv } from '../src/config/env.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { freePort } from './support/net.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';
import { recordsFor } from './support/synthetic.js';

async function until(
  predicate: () => Promise<boolean> | boolean,
  timeoutMs = 15_000,
): Promise<void> {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) return;
    await delay(40);
  }
  throw new Error('condition not reached');
}

describe('collector against a capture whose first FAST frame failed blocks DETECT shares', () => {
  let db: TestDatabase, prisma: PrismaService;
  let server: ReplayServer | undefined;
  let collector: CollectorService | undefined;
  beforeAll(async () => {
    db = await createTestDatabase();
    prisma = new PrismaService({ DATABASE_URL: db.url });
  });
  afterAll(async () => {
    await collector?.beforeApplicationShutdown();
    await server?.close();
    await prisma.close();
    await db.drop();
  });

  it('detects, stores the failed first frame as captured, then recovers on healthy frames', async () => {
    const records = recordsFor([
      { gridW: 100 },
      { gridW: 200 },
      { gridW: 300 },
    ]);
    // Blocks 0 and 1800 are also DETECT reads; the real device failed them in its first FAST poll.
    for (const block of records.filter((r) => r.tier === 'FAST')[0]!.blocks) {
      if (block.start === 0 || block.start === 1800) {
        block.words = null;
        block.error = 'TIMEOUT';
      }
    }
    const port = await freePort();
    server = await startReplayServer({ records, port });
    const ingest = new IngestService(prisma);
    const sink: IngestSink = {
      ingest: (polls) => ingest.ingest(polls, { maxRepeatSpanSec: 30 }),
    };
    collector = new CollectorService(
      prisma,
      sink,
      parseEnv({
        DATABASE_URL: db.url,
        MODBUS_HOST: '127.0.0.1',
        MODBUS_PORT: String(port),
        MODBUS_TIMEOUT_MS: '200',
        OWNERSHIP_LEASE_SEC: '1',
        POLL_FAST_MS: '1000',
        POLL_SLOW_MS: '60000',
        POLL_SETTINGS_MS: '60000',
        DEVICE_KEY: 'failed-first-frame',
      }),
      { rand: () => 0.5, lockOptions: { heartbeatMs: 100 } },
    );
    await collector.onApplicationBootstrap();

    await until(async () => (await prisma.sample.count()) >= 3);
    expect(collector.snapshot().state).toBe('RUNNING');
    expect(server.state.cycles).toBeGreaterThanOrEqual(3);
    const samples = await prisma.sample.findMany({
      orderBy: { observedAt: 'asc' },
    });
    const bad = SampleFlag.BLOCK_INVALID_0 | SampleFlag.BLOCK_INVALID_1800;
    expect(samples[0]!.flags & bad).toBe(bad);
    expect(samples[1]!.flags & bad).toBe(0);
    expect(samples[2]!.flags & bad).toBe(0);
  });
});
