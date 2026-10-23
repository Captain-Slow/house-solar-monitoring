import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule, type AppOverrides } from './app.module.js';
import { isMain } from './cli/is-main.js';
import { loadEnvOrExit, type Env } from './config/env.js';
import { TlsService } from './tls/tls.service.js';

/** Builds the same HTTPS app for production and integration tests, without binding a port. */
export async function createApp(
  env: Env,
  overrides: AppOverrides = {},
): Promise<INestApplication> {
  const tls = overrides.tlsService ?? (await TlsService.load(env));
  const schemaFile =
    overrides.schemaFile ??
    (process.env.NODE_ENV === 'production' ? true : 'schema.gql');
  const app = await NestFactory.create(
    AppModule.configure(env, tls, { ...overrides, schemaFile }),
    {
      httpsOptions: tls.httpsOptions,
      bufferLogs: true,
      abortOnError: false,
    },
  );
  app.useLogger(app.get(Logger));
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.enableShutdownHooks();
  await app.init();
  app
    .get(Logger)
    .log(`TLS certificate fingerprint sha256/${tls.fingerprintBase64}`);
  return app;
}

if (isMain(import.meta.url)) {
  const env = loadEnvOrExit();
  const app = await createApp(env);
  await app.listen(env.HTTPS_PORT, '0.0.0.0');
}
