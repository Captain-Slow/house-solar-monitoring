import ModbusRTUModule from 'modbus-serial';
import { setTimeout as delay } from 'node:timers/promises';
import { MAX_BLOCK, isForbiddenStart } from './read-plan.js';

// modbus-serial is CJS (`module.exports = ModbusRTU`) but its typings declare an ESM default export.
const ModbusRTU = ModbusRTUModule as unknown as typeof ModbusRTUModule.default;

/** A Modbus exception response from the device (it answered; the transport is healthy). */
export class ModbusExceptionError extends Error {
  constructor(
    readonly fc: 3 | 4,
    readonly start: number,
    readonly count: number,
    readonly modbusCode: number,
    message: string,
  ) {
    super(`FC${fc} (${start}, ${count}): ${message}`);
    this.name = 'ModbusExceptionError';
  }
}

/** Timeout, reset, closed socket: the connection must be considered unusable. */
export class ModbusTransportError extends Error {
  constructor(
    readonly fc: 3 | 4,
    readonly start: number,
    readonly count: number,
    message: string,
  ) {
    super(`FC${fc} (${start}, ${count}): ${message}`);
    this.name = 'ModbusTransportError';
  }
}

/** The only operations the rest of the code base may perform on the device. */
export interface RegisterReader {
  readInput(addr: number, len: number): Promise<number[]>;
  readHolding(addr: number, len: number): Promise<number[]>;
}

export interface ReadonlyModbusClientOptions {
  host: string;
  port?: number;
  unitId?: number;
  timeoutMs?: number;
}

/**
 * Read-only Modbus TCP client. Exposes ONLY connect / readInput (FC04) / readHolding (FC03)
 * / close. The `modbus-serial` instance is a private field, so no write function code is
 * reachable. Calls are serialized through a promise-chain mutex (one request in flight).
 * ESLint (`no-restricted-imports`) forbids importing `modbus-serial` anywhere except this file
 * and `src/cli/replay-server.ts`.
 */
export class ReadonlyModbusClient implements RegisterReader {
  readonly #rtu = new ModbusRTU();
  readonly #opts: Required<ReadonlyModbusClientOptions>;
  #open = false;
  #chain: Promise<unknown> = Promise.resolve();
  /** Aborted by close(); operations capture the instance current at call time. */
  #life = new AbortController();

  constructor(opts: ReadonlyModbusClientOptions) {
    this.#opts = { port: 502, unitId: 1, timeoutMs: 3000, ...opts };
  }

  /** True from a successful connect() until close(); a transport error does not clear it. */
  get isOpen(): boolean {
    return this.#open;
  }

  connect(): Promise<void> {
    return this.#run(
      async () => {
        // modbus-serial copies its timeout into the TCP socket inside connectTCP, so the timeout
        // must be set first or the connect attempt itself is unbounded.
        this.#rtu.setTimeout(this.#opts.timeoutMs);
        this.#rtu.setID(this.#opts.unitId);
        await this.#rtu.connectTCP(this.#opts.host, { port: this.#opts.port });
        this.#open = true;
      },
      () => new Error('client closed during connect'),
    );
  }

  readInput(addr: number, len: number): Promise<number[]> {
    return this.#read(4, addr, len);
  }

  readHolding(addr: number, len: number): Promise<number[]> {
    return this.#read(3, addr, len);
  }

  /**
   * Cancels everything in flight or queued (they reject with a "closed" error), destroys the
   * socket immediately and resolves once the queue has drained. NOT serialized behind the
   * request mutex: losing collector ownership must kill the connection now. modbus-serial's
   * destroy() cancels its own timers without settling pending promises, so cancellation is
   * owned here. Safe on a never-connected client; connect() may be called again afterwards.
   */
  async close(): Promise<void> {
    this.#open = false;
    const old = this.#life;
    this.#life = new AbortController();
    old.abort();
    // destroy() calls back from the socket's 'close' event, which may never fire (socket never
    // opened), so the wait is bounded.
    const closed = new Promise<void>((resolve) => {
      this.#rtu.destroy(() => resolve());
    });
    const ac = new AbortController();
    await Promise.race([
      closed,
      delay(500, undefined, { signal: ac.signal }).catch(() => undefined),
    ]);
    ac.abort();
    await this.#chain;
  }

  async #read(fc: 3 | 4, addr: number, len: number): Promise<number[]> {
    if (!Number.isInteger(addr) || addr < 0 || addr > 0xffff)
      throw new RangeError(`bad address ${addr}`);
    if (!Number.isInteger(len) || len < 1 || len > MAX_BLOCK)
      throw new RangeError(`bad length ${len} (1..${MAX_BLOCK})`);
    if (isForbiddenStart(addr))
      throw new RangeError(`read may not start inside [1101, 1800): ${addr}`);
    return this.#run(
      async () => {
        try {
          const r =
            fc === 4
              ? await this.#rtu.readInputRegisters(addr, len)
              : await this.#rtu.readHoldingRegisters(addr, len);
          if (r.data.length !== len) {
            throw new ModbusTransportError(
              fc,
              addr,
              len,
              `short response: ${r.data.length} of ${len} words`,
            );
          }
          return r.data;
        } catch (err) {
          if (
            err instanceof ModbusExceptionError ||
            err instanceof ModbusTransportError
          )
            throw err;
          const msg = err instanceof Error ? err.message : String(err);
          if (
            typeof err === 'object' &&
            err !== null &&
            'modbusCode' in err &&
            typeof err.modbusCode === 'number'
          ) {
            throw new ModbusExceptionError(fc, addr, len, err.modbusCode, msg);
          }
          throw new ModbusTransportError(fc, addr, len, msg);
        }
      },
      () => new ModbusTransportError(fc, addr, len, 'client closed'),
    );
  }

  /**
   * Queues `work` behind the mutex. If close() runs while it is queued or in flight, the
   * returned promise rejects with `closed()` immediately; a late result of `work` is dropped.
   */
  #run<T>(work: () => Promise<T>, closed: () => Error): Promise<T> {
    const life = this.#life;
    return this.#serialize(() => {
      if (life.signal.aborted) throw closed();
      const pending = work();
      pending.catch(() => undefined);
      return new Promise<T>((resolve, reject) => {
        const onAbort = (): void => reject(closed());
        life.signal.addEventListener('abort', onAbort, { once: true });
        pending
          .then(resolve, reject)
          .finally(() => life.signal.removeEventListener('abort', onAbort));
      });
    });
  }

  #serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#chain.then(fn, fn);
    this.#chain = run.catch(() => undefined);
    return run;
  }
}
