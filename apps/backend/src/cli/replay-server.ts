import { ServerTCP } from 'modbus-serial';
import type { Server, Socket } from 'node:net';
import { parseArgs } from 'node:util';
import { loadCapture, type CaptureRecord } from '../modbus/capture.js';
import { DETECT_BLOCKS } from '../modbus/read-plan.js';
import type { FunctionCode } from '../modbus/register-map.js';
import { isMain } from './is-main.js';

const FAST_CYCLE_END_START = 30000;

type Image = Record<FunctionCode, Map<number, number>>;

const emptyImage = (): Image => ({ 3: new Map(), 4: new Map() });

/**
 * Lays a captured record over `image`: a valid block sets its addresses, a block that failed in
 * the capture removes them, so an older (static) tier cannot mask the failure.
 */
function overlay(image: Image, rec: CaptureRecord | undefined): void {
  if (rec === undefined) return;
  for (const b of rec.blocks) {
    const valid = b.words !== null && b.words.length === b.count;
    for (let i = 0; i < b.count; i++) {
      if (valid) image[b.fc].set(b.start + i, b.words![i]!);
      else image[b.fc].delete(b.start + i);
    }
  }
}

/**
 * Register image built from a capture. Static tiers (DETECT, SLOW, SETTINGS) overlay the most
 * recent record at or before the current FAST record (else the first of that tier); the FAST
 * record advances after each FC04 read that starts at 30000, the last FAST block.
 * Any address not covered by a valid captured block answers ILLEGAL DATA ADDRESS.
 *
 * A client's first reads after connecting are its DETECT reads (the collector runs detect() on
 * every (re)connect): while they arrive in DETECT_BLOCKS order they are served from the DETECT
 * record alone, because the current FAST record may have failed blocks that DETECT shares
 * addresses with (0, 1800..1922) and detection could otherwise never succeed, so the replay
 * would never reach the read at 30000 that advances it. The first read that is not the next
 * DETECT block ends that phase; polling then sees the failed FAST frame exactly as captured.
 */
export class ReplayState {
  private readonly fastIdx: number[] = [];
  private pos = 0;
  private image: Image = emptyImage();
  private detectImage: Image = emptyImage();
  /** Index of the next expected DETECT block, or null once polling started on this connection. */
  private detectNext: number | null = 0;
  cycles = 0;

  constructor(private readonly records: readonly CaptureRecord[]) {
    records.forEach((r, i) => {
      if (r.tier === 'FAST') this.fastIdx.push(i);
    });
    if (this.fastIdx.length === 0)
      throw new Error('capture has no FAST records');
    this.rebuild();
  }

  get fastPosition(): number {
    return this.pos;
  }

  /** A client connected: its next reads are expected to be the DETECT sequence. */
  beginSession(): void {
    this.detectNext = 0;
  }

  /** Words for `[start, start+count)` or null when any is not covered. */
  read(fc: FunctionCode, start: number, count: number): number[] | null {
    // The last FAST block closes the cycle, whether or not this record can serve it.
    const closesCycle = fc === 4 && start === FAST_CYCLE_END_START;
    const m = (
      this.isDetectRead(fc, start, count) ? this.detectImage : this.image
    )[fc];
    const out: number[] = [];
    let covered = true;
    for (let i = 0; i < count && covered; i++) {
      const w = m.get(start + i);
      if (w === undefined) covered = false;
      else out.push(w);
    }
    if (closesCycle) this.advance();
    return covered ? out : null;
  }

  private isDetectRead(
    fc: FunctionCode,
    start: number,
    count: number,
  ): boolean {
    if (this.detectNext === null) return false;
    const expected = DETECT_BLOCKS[this.detectNext]!;
    if (
      fc === expected.fc &&
      start === expected.start &&
      count === expected.count
    ) {
      this.detectNext =
        this.detectNext + 1 < DETECT_BLOCKS.length ? this.detectNext + 1 : null;
      return true;
    }
    this.detectNext = null;
    return false;
  }

  private advance(): void {
    this.pos = (this.pos + 1) % this.fastIdx.length;
    this.cycles++;
    this.rebuild();
  }

  private rebuild(): void {
    const current = this.fastIdx[this.pos]!;
    const pickTier = (
      tier: CaptureRecord['tier'],
    ): CaptureRecord | undefined => {
      for (let i = current; i >= 0; i--)
        if (this.records[i]!.tier === tier) return this.records[i];
      return this.records.find((r) => r.tier === tier);
    };
    const image = emptyImage();
    for (const tier of ['DETECT', 'SLOW', 'SETTINGS'] as const)
      overlay(image, pickTier(tier));
    overlay(image, this.records[current]);
    this.image = image;
    this.detectImage = emptyImage();
    overlay(this.detectImage, pickTier('DETECT'));
  }
}

export interface ReplayStats {
  /** Currently open client connections. */
  clients: number;
  /** Highest number of simultaneously open clients ever observed (V25: must stay 1). */
  maxConcurrentClients: number;
  totalConnections: number;
  /** Function code -> request count, parsed from the wire (including unsupported ones). */
  functionCodes: Map<number, number>;
}

export interface ReplayServer {
  readonly port: number;
  readonly state: ReplayState;
  readonly stats: ReplayStats;
  close(): Promise<void>;
}

export interface ReplayOptions {
  records: readonly CaptureRecord[];
  host?: string;
  port: number;
  unitId?: number;
  log?: (line: string) => void;
}

function illegalAddress(): Error {
  return Object.assign(new Error('illegal data address'), {
    modbusErrorCode: 0x02,
  });
}

/**
 * Modbus TCP server serving a capture. Implements ONLY the four read handlers; there are no
 * set* handlers, so every write function code gets an exception response.
 */
export async function startReplayServer(
  opts: ReplayOptions,
): Promise<ReplayServer> {
  // modbus-serial treats port 0 as "unset" and would bind 502.
  if (!Number.isInteger(opts.port) || opts.port < 1 || opts.port > 65535)
    throw new RangeError(`bad port ${opts.port}`);
  const state = new ReplayState(opts.records);
  const stats: ReplayStats = {
    clients: 0,
    maxConcurrentClients: 0,
    totalConnections: 0,
    functionCodes: new Map(),
  };
  const log = opts.log ?? (() => undefined);

  const readOrThrow = (
    fc: FunctionCode,
    start: number,
    count: number,
  ): number[] => {
    const words = state.read(fc, start, count);
    if (words === null) throw illegalAddress();
    return words;
  };
  const vector = {
    getInputRegister: (addr: number) => readOrThrow(4, addr, 1)[0]!,
    getHoldingRegister: (addr: number) => readOrThrow(3, addr, 1)[0]!,
    getMultipleInputRegisters: (addr: number, length: number) =>
      readOrThrow(4, addr, length),
    getMultipleHoldingRegisters: (addr: number, length: number) =>
      readOrThrow(3, addr, length),
  };

  const server = new ServerTCP(vector, {
    host: opts.host ?? '127.0.0.1',
    port: opts.port,
    unitID: opts.unitId ?? 1,
    debug: false,
  });
  await new Promise<void>((resolve, reject) => {
    server.once('initialized', resolve);
    server.once('serverError', reject);
  });

  // ServerTCP keeps its net.Server in `_server`; there is no public accessor for connections.
  const internals = server as unknown as { _server: Server };
  const net = internals._server;
  net.on('connection', (sock: Socket) => {
    state.beginSession();
    stats.clients++;
    stats.totalConnections++;
    stats.maxConcurrentClients = Math.max(
      stats.maxConcurrentClients,
      stats.clients,
    );
    log(`client connected (${stats.clients} open)`);
    let buf = Buffer.alloc(0);
    sock.on('data', (d) => {
      buf = Buffer.concat([buf, d]);
      // MBAP: tid(2) pid(2) len(2) unit(1) fc(1) ...; len counts unit + PDU.
      while (buf.length >= 8) {
        const len = buf.readUInt16BE(4);
        if (buf.length < 6 + len) break;
        const fc = buf.readUInt8(7);
        stats.functionCodes.set(fc, (stats.functionCodes.get(fc) ?? 0) + 1);
        buf = buf.subarray(6 + len);
      }
    });
    sock.once('close', () => {
      stats.clients--;
      log(`client disconnected (${stats.clients} open)`);
    });
  });

  const address = net.address();
  const port =
    typeof address === 'object' && address !== null ? address.port : opts.port;
  return {
    port,
    state,
    stats,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

export async function main(argv: string[]): Promise<void> {
  const { values } = parseArgs({
    args: argv,
    options: {
      capture: { type: 'string' },
      port: { type: 'string', default: '15020' },
      host: { type: 'string', default: '127.0.0.1' },
    },
  });
  if (values.capture === undefined)
    throw new Error(
      'usage: replay --capture <file.jsonl> [--port 15020] [--host 127.0.0.1]',
    );
  const records = loadCapture(values.capture);
  const srv = await startReplayServer({
    records,
    host: values.host,
    port: Number(values.port),
    log: (l) => console.log(`${new Date().toISOString()} ${l}`),
  });
  console.log(
    `replay server on ${values.host}:${srv.port} (${records.length} records)`,
  );
  const stop = () => void srv.close().then(() => process.exit(0));
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

if (isMain(import.meta.url)) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
