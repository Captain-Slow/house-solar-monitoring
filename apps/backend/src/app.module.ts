import { Global, Module, type DynamicModule } from '@nestjs/common';
import { type Writable } from 'node:stream';
import {
  CollectorModule,
  collectorActive,
} from './collector/collector.module.js';
import { AccountingModule } from './accounting/accounting.module.js';
import { BillingModule } from './tariff/billing.module.js';
import {
  COLLECTOR_STATUS,
  type CollectorStatusProvider,
} from './collector/types.js';
import { ConfigModule } from './config/env.token.js';
import type { Env } from './config/env.js';
import { DbModule } from './db/db.module.js';
import { PrismaService } from './db/prisma.service.js';
import { AuthModule } from './auth/auth.module.js';
import { GraphqlApiModule } from './graphql/graphql-api.module.js';
import { HealthModule } from './health/health.module.js';
import { LoggingModule } from './logging/logging.module.js';
import { TlsService } from './tls/tls.service.js';

export interface AppOverrides {
  schemaFile?: string | boolean;
  collectorStatus?: CollectorStatusProvider;
  prisma?: PrismaService;
  tlsService?: TlsService;
  migrationsDir?: string;
  logStream?: Writable;
}

@Global()
@Module({})
export class ApiRuntimeModule {
  static forRoot(
    env: Env,
    tls: TlsService,
    status?: CollectorStatusProvider,
  ): DynamicModule {
    const collectorStatus =
      status ??
      (!env.COLLECTOR_ENABLED || env.COLLECTOR_SOURCE === 'NONE'
        ? {
            snapshot: () => ({
              state: 'DISABLED' as const,
              acquisitionSource: 'NONE' as const,
              lastSuccessAt: null,
              lastErrorAt: null,
              lastError: null,
              consecutiveFailures: 0,
              nextRetryAt: null,
            }),
          }
        : null);
    return {
      module: ApiRuntimeModule,
      providers: [
        { provide: TlsService, useValue: tls },
        ...(collectorStatus
          ? [{ provide: COLLECTOR_STATUS, useValue: collectorStatus }]
          : []),
      ],
      exports: collectorStatus ? [TlsService, COLLECTOR_STATUS] : [TlsService],
    };
  }
}

@Module({})
export class AppModule {
  static configure(
    env: Env,
    tls: TlsService,
    options: AppOverrides = {},
  ): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ConfigModule.forRoot(env),
        DbModule.forRoot(env, options.prisma),
        AccountingModule.forRoot(env),
        BillingModule,
        ...(collectorActive(env) && options.collectorStatus === undefined
          ? [CollectorModule.forRoot(env)]
          : []),
        ApiRuntimeModule.forRoot(env, tls, options.collectorStatus),
        LoggingModule.forRoot(env, options.logStream),
        AuthModule,
        GraphqlApiModule.forRoot(options.schemaFile ?? true),
        HealthModule.forRoot(options.migrationsDir),
      ],
    };
  }
}
