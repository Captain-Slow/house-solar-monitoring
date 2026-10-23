import { createHash, randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../db/prisma.service.js';
import type { TokenRole } from '../generated/prisma/client.js';

export interface AuthPrincipal {
  id: number;
  name: string;
  role: TokenRole;
}
export function tokenHash(token: string): Buffer {
  return createHash('sha256').update(token).digest();
}
export function newToken(): string {
  return `hsm_${randomBytes(32).toString('base64url')}`;
}

@Injectable()
export class TokenService {
  private readonly lastUse = new Map<number, number>();
  constructor(private readonly prisma: PrismaService) {}

  async create(
    name: string,
    role: TokenRole,
  ): Promise<{ token: string; id: number }> {
    const token = newToken();
    const row = await this.prisma.apiToken.create({
      data: { name, role, tokenHash: Uint8Array.from(tokenHash(token)) },
      select: { id: true },
    });
    return { token, id: row.id };
  }

  list() {
    return this.prisma.apiToken.findMany({
      select: {
        id: true,
        name: true,
        role: true,
        createdAt: true,
        lastUsedAt: true,
        revokedAt: true,
      },
      orderBy: { id: 'asc' },
    });
  }

  async revoke(id: number): Promise<boolean> {
    const result = await this.prisma.apiToken.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.lastUse.delete(id);
    return result.count !== 0;
  }

  async verify(token: string): Promise<AuthPrincipal | null> {
    if (!/^hsm_[A-Za-z0-9_-]{43}$/.test(token)) return null;
    const row = await this.prisma.apiToken.findUnique({
      where: { tokenHash: Uint8Array.from(tokenHash(token)) },
      select: {
        id: true,
        name: true,
        role: true,
        revokedAt: true,
        lastUsedAt: true,
      },
    });
    if (!row || row.revokedAt) return null;
    const now = Date.now();
    const previous =
      this.lastUse.get(row.id) ?? row.lastUsedAt?.getTime() ?? -Infinity;
    if (now - previous >= 60_000) {
      this.lastUse.set(row.id, now);
      if (this.lastUse.size > 10_000)
        this.lastUse.delete(this.lastUse.keys().next().value!);
      await this.prisma.apiToken.updateMany({
        where: { id: row.id, revokedAt: null },
        data: { lastUsedAt: new Date(now) },
      });
    }
    return { id: row.id, name: row.name, role: row.role };
  }
}
