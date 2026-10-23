import { Global, Module, type DynamicModule } from '@nestjs/common';
import type { Env } from '../config/env.js';
import { AccountingMutations } from './accounting.mutations.js';
import {
  LEDGER_OPTIONS,
  LEDGER_WORKER_ENABLED,
  LedgerService,
  type LedgerOptions,
} from './ledger.service.js';
import { RawPollRenormalizer, RENORMALIZER } from './raw-poll-renormalizer.js';

@Global()
@Module({})
export class AccountingModule {
  static forRoot(env: Env, options: LedgerOptions = {}): DynamicModule {
    return {
      module: AccountingModule,
      providers: [
        { provide: LEDGER_OPTIONS, useValue: options },
        // Global override disables accounting in a restore drill regardless of collector source.
        { provide: LEDGER_WORKER_ENABLED, useValue: env.COLLECTOR_ENABLED },
        RawPollRenormalizer,
        { provide: RENORMALIZER, useExisting: RawPollRenormalizer },
        LedgerService,
        AccountingMutations,
      ],
      exports: [LedgerService, AccountingMutations, RENORMALIZER],
    };
  }
}
