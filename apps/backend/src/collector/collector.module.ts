import {
  Global,
  Inject,
  Injectable,
  Module,
  type DynamicModule,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Env } from '../config/env.js';
import { APP_ENV } from '../config/env.token.js';
import { PrismaService } from '../db/prisma.service.js';
import {
  CollectorService,
  ENV,
  INGEST_SINK,
  type IngestSink,
} from './collector.service.js';
import { IngestService } from './ingest.service.js';
import { ensureMappingV1 } from './mapping.js';
import { RetentionService } from './retention.service.js';
import { COLLECTOR_STATUS } from './types.js';

/** Runs the daily retention job for the lifetime of the app. */
@Injectable()
class RetentionRunner implements OnApplicationBootstrap, OnModuleDestroy {
  constructor(
    private readonly retention: RetentionService,
    @Inject(APP_ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    this.retention.start(this.env);
  }

  onModuleDestroy(): void {
    this.retention.stop();
  }
}

/** True when the Modbus collector (and with it ingest and retention) runs in this process. */
export function collectorActive(env: Env): boolean {
  return env.COLLECTOR_ENABLED && env.COLLECTOR_SOURCE === 'MODBUS';
}

/**
 * Wires the Modbus collector, ingest and retention. Imported only when `collectorActive(env)`;
 * otherwise the API reports a DISABLED collector (ApiRuntimeModule) and no polling, ingest
 * or retention job runs, so a restore drill with the collector off never prunes data.
 */
@Global()
@Module({})
export class CollectorModule {
  static forRoot(env: Env): DynamicModule {
    return {
      module: CollectorModule,
      providers: [
        IngestService,
        RetentionService,
        RetentionRunner,
        { provide: ENV, useValue: env },
        {
          provide: INGEST_SINK,
          inject: [IngestService, PrismaService],
          useFactory: (
            ingest: IngestService,
            prisma: PrismaService,
          ): IngestSink => {
            // The stale-span comes from the active MappingConfig, resolved once on first use.
            let span: number | undefined;
            return {
              async ingest(polls) {
                span ??= (await ensureMappingV1(prisma)).config
                  .maxRepeatSpanSec;
                return ingest.ingest(polls, { maxRepeatSpanSec: span });
              },
            };
          },
        },
        CollectorService,
        { provide: COLLECTOR_STATUS, useExisting: CollectorService },
      ],
      exports: [COLLECTOR_STATUS, CollectorService],
    };
  }
}
