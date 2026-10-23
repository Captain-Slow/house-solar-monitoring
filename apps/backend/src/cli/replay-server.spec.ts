import { connect, createServer } from 'node:net';
import { afterEach, describe, expect, it } from 'vitest';
import { freePort } from '../../test/support/net.js';
import { recordsFor } from '../../test/support/synthetic.js';
import { decodeBlocks } from '../modbus/decode.js';
import { HoymilesG3 } from '../modbus/hoymiles-g3.js';
import {
  ModbusExceptionError,
  ReadonlyModbusClient,
} from '../modbus/readonly-modbus-client.js';
import type { CaptureRecord } from '../modbus/capture.js';
import { startReplayServer, type ReplayServer } from './replay-server.js';

let server: ReplayServer | undefined;
let client: ReadonlyModbusClient | undefined;

afterEach(async () => {
  await client?.close().catch(() => undefined);
  await server?.close();
  server = undefined;
  client = undefined;
});

async function setupRecords(records: CaptureRecord[]) {
  const port = await freePort();
  server = await startReplayServer({ records, port });
  client = await connectClient(port);
  return { g3: new HoymilesG3(client), server, client, port };
}

async function connectClient(port: number): Promise<ReadonlyModbusClient> {
  const c = new ReadonlyModbusClient({
    host: '127.0.0.1',
    port,
    timeoutMs: 1000,
  });
  await c.connect();
  return c;
}

async function setup(
  states = [{ gridW: 100 }, { gridW: 200 }, { gridW: 300 }],
) {
  return setupRecords(recordsFor(states));
}

/** Marks the listed blocks of a captured record as failed reads (as a flaky device would). */
function failBlocks(record: CaptureRecord, starts: readonly number[]): void {
  for (const b of record.blocks) {
    if (starts.includes(b.start)) {
      b.words = null;
      b.error = 'TIMEOUT';
    }
  }
}

/** MBAP frame with an arbitrary PDU. */
function frame(tid: number, pdu: number[]): Buffer {
  const b = Buffer.alloc(7 + pdu.length);
  b.writeUInt16BE(tid, 0);
  b.writeUInt16BE(pdu.length + 1, 4);
  b.writeUInt8(1, 6);
  Buffer.from(pdu).copy(b, 7);
  return b;
}

describe('replay server + read-only client', () => {
  it('serves detect, every tier, and advances one capture record per FAST cycle', async () => {
    const { g3 } = await setup();
    const info = await g3.detect();
    expect(info.model).toBe('HIT-10L-G3');

    const seen: (number | null)[] = [];
    for (let i = 0; i < 4; i++) {
      const poll = await g3.readTier('FAST');
      expect(poll.blocks.every((b) => b.words !== null)).toBe(true);
      seen.push(decodeBlocks(poll.blocks).meter_active_total ?? null);
    }
    expect(seen).toEqual([100, 200, 300, 100]); // wraps around the 3 FAST records

    const slow = await g3.readTier('SLOW');
    expect(decodeBlocks(slow.blocks).safetydsp_fm_ver).toBe(102);
    const settings = await g3.readTier('SETTINGS');
    expect(settings.blocks.every((b) => b.words !== null)).toBe(true);
    expect(decodeBlocks(settings.blocks).ems_mode).toBe(0);
  });

  it('only function codes 3 and 4 are ever sent by a full detect + FAST + SLOW + SETTINGS cycle', async () => {
    const { g3, server: s } = await setup();
    await g3.detect();
    await g3.readTier('FAST');
    await g3.readTier('SLOW');
    await g3.readTier('SETTINGS');
    expect([...s.stats.functionCodes.keys()].sort((a, b) => a - b)).toEqual([
      3, 4,
    ]);
    expect(s.stats.maxConcurrentClients).toBe(1);
  });

  it('answers an unmapped address with a Modbus exception, not zeros', async () => {
    const { client: c } = await setup();
    await expect(c.readInput(5000, 2)).rejects.toBeInstanceOf(
      ModbusExceptionError,
    );
  });

  it('the client refuses reads that start in [1101,1800), too long, or malformed, without touching the wire', async () => {
    const { client: c, server: s } = await setup();
    await expect(c.readInput(1500, 10)).rejects.toThrow(/may not start/);
    await expect(c.readInput(0, 124)).rejects.toThrow(/bad length/);
    await expect(c.readHolding(70000, 1)).rejects.toThrow(/bad address/);
    expect(s.stats.functionCodes.size).toBe(0);
  });

  it('exposes no write operation', async () => {
    const { client: c } = await setup();
    const names = Object.getOwnPropertyNames(Object.getPrototypeOf(c)).sort();
    expect(names).toEqual([
      'close',
      'connect',
      'constructor',
      'isOpen',
      'readHolding',
      'readInput',
    ]);
    expect(Object.keys(c)).toEqual([]);
  });

  it('write function codes reach the server, get no success reply, and change nothing', async () => {
    const { g3, server: s } = await setup();
    const before = (await g3.readTier('SETTINGS')).blocks.map((b) => b.words);
    const sock = connect(s.port, '127.0.0.1');
    await new Promise<void>((r) => sock.once('connect', r));
    const replies: Buffer[] = [];
    sock.on('data', (d) => replies.push(d));
    // FC06 write single register 4300=5, FC16 write multiple (4300, 1 reg, value 5), FC05 coil
    sock.write(frame(1, [0x06, 0x10, 0xcc, 0x00, 0x05]));
    sock.write(frame(2, [0x10, 0x10, 0xcc, 0x00, 0x01, 0x02, 0x00, 0x05]));
    sock.write(frame(3, [0x05, 0x00, 0x01, 0xff, 0x00]));
    await new Promise((r) => setTimeout(r, 200));
    sock.destroy();
    // The frames did arrive (so the test is not vacuous) ...
    for (const fc of [5, 6, 16]) expect(s.stats.functionCodes.get(fc)).toBe(1);
    // ... modbus-serial answers none of them with a normal response (an exception frame has
    // the 0x80 bit set; silence is what the pinned version does for a missing set handler) ...
    const all = Buffer.concat(replies);
    for (let off = 0; off < all.length;) {
      expect(all.readUInt8(off + 7) & 0x80).toBe(0x80);
      off += 6 + all.readUInt16BE(off + 4);
    }
    // ... and the register image is untouched.
    const after = (await g3.readTier('SETTINGS')).blocks.map((b) => b.words);
    expect(after).toEqual(before);
  });

  it('a failed block in a FAST record is replayed as a failure, not masked by DETECT, and the cycle still advances', async () => {
    const records = recordsFor([{ gridW: 100 }, { gridW: 200 }]);
    // record 0: block (0,123) failed and the cycle-ending block (30000) failed too
    failBlocks(records.filter((r) => r.tier === 'FAST')[0]!, [0, 30000]);
    const { g3 } = await setupRecords(records);
    await g3.detect(); // the collector always detects first on a new connection

    const first = await g3.readTier('FAST');
    expect(first.blocks.find((b) => b.start === 0)!.words).toBeNull();
    expect(first.blocks.find((b) => b.start === 30000)!.words).toBeNull();
    expect(first.blocks.find((b) => b.start === 1800)!.words).not.toBeNull();
    const second = await g3.readTier('FAST');
    expect(second.blocks.every((b) => b.words !== null)).toBe(true);
    expect(decodeBlocks(second.blocks).meter_active_total).toBe(200);
  });

  it('detection succeeds while the first FAST frame has failed blocks that DETECT also reads; the frame is then replayed as failed and the next healthy frame follows', async () => {
    const records = recordsFor([{ gridW: 100 }, { gridW: 200 }]);
    // Blocks 0 and 1800 are inside the DETECT reads (0, 1800, 1900); 30000 closes the cycle.
    failBlocks(records.filter((r) => r.tier === 'FAST')[0]!, [0, 1800, 30000]);
    const { g3, server: s } = await setupRecords(records);

    const info = await g3.detect();
    expect(info.model).toBe('HIT-10L-G3');
    expect(info.raw.blocks.every((b) => b.words !== null)).toBe(true);
    expect(s.state.fastPosition).toBe(0); // detection never advances the capture

    const failed = await g3.readTier('FAST');
    const word = (poll: typeof failed, start: number) =>
      poll.blocks.find((b) => b.start === start)!.words;
    expect(word(failed, 0)).toBeNull();
    expect(word(failed, 1800)).toBeNull();
    expect(word(failed, 30000)).toBeNull();
    expect(word(failed, 2000)).not.toBeNull();
    expect(s.state.fastPosition).toBe(1); // the failed cycle-ending read still advanced it

    const healthy = await g3.readTier('FAST');
    expect(healthy.blocks.every((b) => b.words !== null)).toBe(true);
    expect(decodeBlocks(healthy.blocks).meter_active_total).toBe(200);
  });

  it('a reconnect during a failed FAST frame detects again, then replays that frame as failed', async () => {
    const records = recordsFor([
      { gridW: 100 },
      { gridW: 200 },
      { gridW: 300 },
    ]);
    failBlocks(records.filter((r) => r.tier === 'FAST')[1]!, [0, 1800]);
    const { g3, port, server: s } = await setupRecords(records);
    await g3.detect();
    expect(
      decodeBlocks((await g3.readTier('FAST')).blocks).meter_active_total,
    ).toBe(100);
    expect(s.state.fastPosition).toBe(1);

    // The collector closes the socket on any poll error and detects again on the next one.
    await client!.close();
    client = await connectClient(port);
    const again = new HoymilesG3(client);
    expect((await again.detect()).model).toBe('HIT-10L-G3');
    expect(s.stats.totalConnections).toBe(2);

    const failed = await again.readTier('FAST');
    expect(failed.blocks.find((b) => b.start === 0)!.words).toBeNull();
    expect(failed.blocks.find((b) => b.start === 1800)!.words).toBeNull();
    expect(failed.blocks.find((b) => b.start === 30000)!.words).not.toBeNull();
    const recovered = await again.readTier('FAST');
    expect(recovered.blocks.every((b) => b.words !== null)).toBe(true);
    expect(decodeBlocks(recovered.blocks).meter_active_total).toBe(300);
  });

  it('close() cancels an outstanding read instead of hanging, and a queued connect', async () => {
    // A server that accepts and never answers: the read stays outstanding.
    const port = await freePort();
    const silent = createServer();
    await new Promise<void>((r) => silent.listen(port, '127.0.0.1', r));
    const c = new ReadonlyModbusClient({
      host: '127.0.0.1',
      port,
      timeoutMs: 30_000,
    });
    try {
      await c.connect();
      const pending = c.readInput(0, 1).then(
        () => 'resolved',
        (e: unknown) => e,
      );
      await new Promise((r) => setTimeout(r, 100));
      await c.close();
      expect(await pending).toBeInstanceOf(Error);
      expect(c.isOpen).toBe(false);

      const queued = c.connect().then(
        () => 'resolved',
        (e: unknown) => e,
      );
      await c.close();
      expect(await queued).toBeInstanceOf(Error);
      expect(c.isOpen).toBe(false);
      await c.connect(); // an explicit later reconnect is still allowed
      expect(c.isOpen).toBe(true);
    } finally {
      await c.close();
      silent.close();
    }
  }, 10_000);

  it('two concurrent clients are visible in maxConcurrentClients (V25 detector)', async () => {
    const { server: s } = await setup();
    const second = new ReadonlyModbusClient({
      host: '127.0.0.1',
      port: s.port,
    });
    await second.connect();
    expect(s.stats.maxConcurrentClients).toBe(2);
    await second.close();
  });
});
