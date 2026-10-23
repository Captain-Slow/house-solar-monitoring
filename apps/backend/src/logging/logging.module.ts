import { Module, type DynamicModule } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import type { Writable } from 'node:stream';
import type { Env } from '../config/env.js';

export const LOG_REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  '*.token',
  '*.password',
  '*.DATABASE_URL',
  'req.body.token',
  'req.body.password',
  'req.body.DATABASE_URL',
] as const;

@Module({})
export class LoggingModule {
  static forRoot(env: Env, stream?: Writable): DynamicModule {
    return {
      module: LoggingModule,
      imports: [
        LoggerModule.forRoot({
          pinoHttp: {
            level: env.LOG_LEVEL,
            redact: { paths: [...LOG_REDACT], censor: '[Redacted]' },
            ...(stream ? { stream } : {}),
          },
        }),
      ],
      exports: [LoggerModule],
    };
  }
}
