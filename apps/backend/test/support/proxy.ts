import { createServer, connect, type Server, type Socket } from 'node:net';

/** TCP proxy that can black-hole traffic (both directions) without closing sockets. */
export class PausableProxy {
  paused = false;
  /** Ordered 'open:<n>' / 'close:<n>' (client side) events, to assert connection ordering. */
  readonly events: string[] = [];
  #n = 0;
  readonly #server: Server;
  readonly #socks = new Set<Socket>();

  private constructor(server: Server) {
    this.#server = server;
  }

  static async start(
    targetHost: string,
    targetPort: number,
  ): Promise<PausableProxy> {
    const holder: { proxy?: PausableProxy } = {};
    const server = createServer((client) => {
      const up = connect(targetPort, targetHost);
      const p = holder.proxy!;
      const id = ++p.#n;
      p.events.push(`open:${id}`);
      p.#socks.add(client).add(up);
      client.on('data', (d) => !p.paused && up.write(d));
      up.on('data', (d) => !p.paused && client.write(d));
      const closeBoth = () => {
        client.destroy();
        up.destroy();
      };
      client.on('close', () => p.events.push(`close:${id}`));
      client.on('close', closeBoth).on('error', closeBoth);
      up.on('close', closeBoth).on('error', closeBoth);
    });
    holder.proxy = new PausableProxy(server);
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    return holder.proxy;
  }

  get port(): number {
    const a = this.#server.address();
    return typeof a === 'object' && a !== null ? a.port : 0;
  }

  async stop(): Promise<void> {
    for (const s of this.#socks) s.destroy();
    await new Promise<void>((r) => this.#server.close(() => r()));
  }
}
