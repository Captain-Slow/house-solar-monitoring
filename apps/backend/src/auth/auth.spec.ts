import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { Reflector } from '@nestjs/core';
import { Mutation, Resolver } from '@nestjs/graphql';
import { Test } from '@nestjs/testing';
import type { ExecutionContext } from '@nestjs/common';
import { AuthRateLimiter } from './token.middleware.js';
import { newToken, tokenHash } from './token.service.js';
import { Roles, RolesGuard } from './roles.guard.js';

@Resolver()
class TestMutation {
  @Mutation(() => String)
  execute() {
    return 'allowed';
  }
}

@Roles('ADMIN')
@Resolver()
class TestProtectedQuery {
  execute() {
    return 'allowed';
  }
}

describe('token auth', () => {
  it('generates 256 bits and stores only its SHA-256 digest', () => {
    const first = newToken();
    const second = newToken();
    expect(first).toMatch(/^hsm_[A-Za-z0-9_-]{43}$/);
    expect(first).not.toBe(second);
    expect(tokenHash(first)).toEqual(
      createHash('sha256').update(first).digest(),
    );
    expect(tokenHash(first).length).toBe(32);
  });

  it('blocks the eleventh attempt for five minutes; successes do not erase prior failures', () => {
    let clock = 1_000_000;
    const limiter = new AuthRateLimiter(() => clock);
    for (let i = 0; i < 10; i++) {
      expect(limiter.blocked('1')).toBe(false);
      limiter.fail('1');
    }
    expect(limiter.blocked('1')).toBe(true);
    clock += 299_999;
    expect(limiter.blocked('1')).toBe(true);
    clock += 1;
    expect(limiter.blocked('1')).toBe(false);
    clock += 60_001;
    expect(limiter.size).toBe(0);
  });

  it('evicts old addresses before the map grows without bound', () => {
    const limiter = new AuthRateLimiter(() => 1_000, 3);
    for (const ip of ['a', 'b', 'c', 'd']) limiter.fail(ip);
    expect(limiter.size).toBe(3);
    expect(limiter.blocked('a')).toBe(false);
  });

  it('enforces ADMIN on test-only GraphQL mutations in a TestingModule', async () => {
    const module = await Test.createTestingModule({
      providers: [RolesGuard, Reflector, TestMutation, TestProtectedQuery],
    }).compile();
    const guard = module.get(RolesGuard);
    const context = (role: 'VIEWER' | 'ADMIN', mutation = true) =>
      ({
        getType: () => 'graphql',
        getClass: () => (mutation ? TestMutation : TestProtectedQuery),
        // Only the function's identity is used (metadata lookup); it is never called unbound.
        getHandler: () =>
          mutation
            ? // oxlint-disable-next-line typescript/unbound-method
              TestMutation.prototype.execute
            : // oxlint-disable-next-line typescript/unbound-method
              TestProtectedQuery.prototype.execute,
        getArgs: () => [
          null,
          {},
          { req: { principal: { role } } },
          { parentType: { name: mutation ? 'Mutation' : 'Query' } },
        ],
      }) as unknown as ExecutionContext;
    expect(() => guard.canActivate(context('VIEWER'))).toThrow('Forbidden');
    expect(guard.canActivate(context('ADMIN'))).toBe(true);
    expect(() => guard.canActivate(context('VIEWER', false))).toThrow(
      'Forbidden',
    );
    await module.close();
  });
});
