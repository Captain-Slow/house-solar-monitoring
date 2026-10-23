import { Injectable, type NestMiddleware } from '@nestjs/common';
import { TokenService, type AuthPrincipal } from './token.service.js';

export interface AuthRequest {
  ip?: string;
  socket: { remoteAddress?: string };
  headers: { authorization?: string };
  principal?: AuthPrincipal;
}
interface AuthResponse {
  status(code: number): { json(body: { error: string }): void };
}

/** Ten failures in a rolling minute, followed by a five-minute block. */
export class AuthRateLimiter {
  private readonly failures = new Map<
    string,
    { timestamps: number[]; blockedUntil: number }
  >();
  constructor(
    private readonly now: () => number = Date.now,
    private readonly capacity = 10_000,
  ) {}

  blocked(ip: string): boolean {
    const record = this.failures.get(ip);
    if (!record) return false;
    const now = this.now();
    if (record.blockedUntil > now) return true;
    record.timestamps = record.timestamps.filter((t) => t > now - 60_000);
    if (record.timestamps.length === 0) this.failures.delete(ip);
    return false;
  }

  fail(ip: string): void {
    const now = this.now();
    const record = this.failures.get(ip) ?? { timestamps: [], blockedUntil: 0 };
    record.timestamps = record.timestamps.filter((t) => t > now - 60_000);
    record.timestamps.push(now);
    if (record.timestamps.length >= 10) record.blockedUntil = now + 300_000;
    this.failures.delete(ip);
    this.failures.set(ip, record);
    if (this.failures.size > this.capacity)
      this.failures.delete(this.failures.keys().next().value!);
  }

  get size(): number {
    return this.failures.size;
  }
}

@Injectable()
export class TokenMiddleware implements NestMiddleware {
  private readonly limiter = new AuthRateLimiter();
  constructor(private readonly tokens: TokenService) {}

  async use(
    req: AuthRequest,
    res: AuthResponse,
    next: () => void,
  ): Promise<void> {
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    if (this.limiter.blocked(ip)) {
      res.status(429).json({ error: 'Too many authentication failures' });
      return;
    }
    const match = /^Bearer (\S+)$/i.exec(req.headers.authorization ?? '');
    const principal = match ? await this.tokens.verify(match[1]!) : null;
    if (!principal) {
      this.limiter.fail(ip);
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    req.principal = principal;
    next();
  }
}
