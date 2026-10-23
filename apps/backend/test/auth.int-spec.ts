import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import https from 'node:https';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import type { INestApplication } from '@nestjs/common';
import { parseEnv } from '../src/config/env.js';
import { createApp } from '../src/main.js';
import { TokenService } from '../src/auth/token.service.js';
import { runTokenCli } from '../src/cli/token.js';
import { healthcheck } from '../src/cli/healthcheck.js';
import { PrismaService } from '../src/db/prisma.service.js';
import { TlsService } from '../src/tls/tls.service.js';
import { createTestDatabase, type TestDatabase } from './support/db.js';

interface Response {
  status: number;
  body: string;
  headers: IncomingHttpHeaders;
}

describe('HTTPS authentication and health', () => {
  let db: TestDatabase;
  let app: INestApplication;
  let tls: TlsService;
  let dir: string;
  let port: number;
  let token: string;
  let viewer: string;
  const logs: string[] = [];

  async function request(
    path: string,
    authorization?: string,
    body?: string,
    method = 'POST',
    headers: Record<string, string> = {},
  ): Promise<Response> {
    return new Promise((resolve, reject) => {
      const req = https.request(
        {
          hostname: '127.0.0.1',
          port,
          path,
          method,
          ca: tls.cert,
          headers: {
            ...(authorization
              ? { authorization: `Bearer ${authorization}` }
              : {}),
            ...(body ? { 'content-type': 'application/json' } : {}),
            ...headers,
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () =>
            resolve({
              status: res.statusCode ?? 0,
              headers: res.headers,
              body: Buffer.concat(chunks).toString(),
            }),
          );
        },
      );
      req.on('error', reject);
      req.end(body);
    });
  }

  beforeAll(async () => {
    db = await createTestDatabase();
    dir = await mkdtemp(join(tmpdir(), 'solar-auth-'));
    const env = parseEnv({
      DATABASE_URL: db.url,
      COLLECTOR_ENABLED: 'false',
      TLS_DIR: dir,
      BACKUP_DIR: dir,
    });
    tls = await TlsService.load(env);
    const stream = new Writable({
      write(chunk, _encoding, callback) {
        logs.push(String(chunk));
        callback();
      },
    });
    app = await createApp(env, {
      tlsService: tls,
      schemaFile: true,
      logStream: stream,
    });
    await app.listen(0, '127.0.0.1');
    const address: AddressInfo = app.getHttpServer().address();
    port = address.port;
    token = (await app.get(TokenService).create('admin', 'ADMIN')).token;
    viewer = (await app.get(TokenService).create('viewer', 'VIEWER')).token;
  });
  afterAll(async () => {
    await app?.close();
    await db?.drop();
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  it('rejects unauthenticated and invalid GraphQL including introspection and GET; revocation is immediate', async () => {
    expect(
      (
        await request(
          '/graphql',
          undefined,
          JSON.stringify({ query: '{ __schema { queryType { name } } }' }),
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          '/graphql?query=%7B__typename%7D',
          undefined,
          undefined,
          'GET',
        )
      ).status,
    ).toBe(401);
    expect(
      (
        await request(
          '/graphql',
          'bad',
          JSON.stringify({ query: '{ __typename }' }),
        )
      ).status,
    ).toBe(401);
    const revoked = await app.get(TokenService).create('revoked', 'VIEWER');
    await app.get(TokenService).revoke(revoked.id);
    expect(
      (
        await request(
          '/graphql',
          revoked.token,
          JSON.stringify({ query: '{ __typename }' }),
        )
      ).status,
    ).toBe(401);
  });

  it('allows both roles to query, redacts sensitive logs, never adds CORS headers or stack traces', async () => {
    const query = JSON.stringify({
      query: '{ collectorStatus { state acquisitionSource } }',
      token: 'test-secret-payload',
    });
    for (const credential of [viewer, token]) {
      const response = await request('/graphql', credential, query);
      expect(response.status).toBe(200);
      expect(JSON.parse(response.body).data.collectorStatus.state).toBe(
        'DISABLED',
      );
    }
    const preflight = await request(
      '/graphql',
      undefined,
      undefined,
      'OPTIONS',
      {
        origin: 'https://example.org',
        'access-control-request-method': 'POST',
      },
    );
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    const error = await request(
      '/graphql',
      token,
      JSON.stringify({ query: '{ unknownField }' }),
    );
    expect(error.body).not.toMatch(
      /stacktrace|stackTrace|node_modules|test-secret-payload/,
    );
    expect(logs.join('')).not.toContain(token);
    expect(logs.join('')).not.toContain('test-secret-payload');
  });

  it('updates lastUsedAt at most once per minute and token CLI never lists credentials', async () => {
    const row = await app
      .get(PrismaService)
      .apiToken.findUniqueOrThrow({ where: { name: 'viewer' } });
    const before = row.lastUsedAt;
    await request(
      '/graphql',
      viewer,
      JSON.stringify({ query: '{ __typename }' }),
    );
    const after = await app
      .get(PrismaService)
      .apiToken.findUniqueOrThrow({ where: { name: 'viewer' } });
    expect(after.lastUsedAt).toEqual(before);
    const output: string[] = [];
    const env = { DATABASE_URL: db.url, TLS_DIR: dir };
    await runTokenCli(
      ['create', '--name', 'cli-test', '--role', 'ADMIN'],
      env,
      (line) => output.push(line),
    );
    expect(output[0]).toMatch(/^Token: hsm_[A-Za-z0-9_-]{43}$/);
    expect(output[1]).toBe(
      `TLS certificate fingerprint sha256/${tls.fingerprintBase64}`,
    );
    const generated = output[0]!.slice('Token: '.length);
    const principal = await app.get(TokenService).verify(generated);
    expect(principal?.role).toBe('ADMIN');
    output.length = 0;
    await runTokenCli(['list'], env, (line) => output.push(line));
    expect(output.join('')).not.toContain(generated);
    expect(output.join('')).toContain('cli-test');
    await runTokenCli(['revoke', '--id', String(principal!.id)], env, (line) =>
      output.push(line),
    );
    expect(await app.get(TokenService).verify(generated)).toBeNull();
  });

  it('returns 429 on the eleventh failed attempt from an address', async () => {
    const second = await createApp(
      parseEnv({
        DATABASE_URL: db.url,
        COLLECTOR_ENABLED: 'false',
        TLS_DIR: dir,
        BACKUP_DIR: dir,
      }),
      { tlsService: tls, schemaFile: true },
    );
    await second.listen(0, '127.0.0.1');
    const originalPort = port;
    const address: AddressInfo = second.getHttpServer().address();
    port = address.port;
    try {
      for (let attempt = 0; attempt < 5; attempt++)
        expect((await request('/graphql', 'invalid', '{}')).status).toBe(401);
      expect(
        (
          await request(
            '/graphql',
            token,
            JSON.stringify({ query: '{ __typename }' }),
          )
        ).status,
      ).toBe(200);
      for (let attempt = 0; attempt < 5; attempt++)
        expect((await request('/graphql', 'invalid', '{}')).status).toBe(401);
      expect((await request('/graphql', 'invalid', '{}')).status).toBe(429);
      expect((await request('/graphql', token, '{}')).status).toBe(429);
    } finally {
      port = originalPort;
      await second.close();
    }
  });

  it('reports ready only when the latest migration has finished, without affecting liveness', async () => {
    expect((await request('/readyz', undefined, undefined, 'GET')).status).toBe(
      200,
    );
    await app.get(PrismaService).pool.query('DELETE FROM "_prisma_migrations"');
    expect((await request('/readyz', undefined, undefined, 'GET')).status).toBe(
      503,
    );
    expect(
      (await request('/healthz', undefined, undefined, 'GET')).status,
    ).toBe(200);
    expect(await healthcheck(port)).toBe(true);
  });
});
