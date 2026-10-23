import { Global, Module } from '@nestjs/common';
import { ReconciliationService } from '../reconciliation/reconciliation.service.js';
import { BillingService } from './billing.service.js';
import { TariffService } from './tariff.service.js';

@Global()
@Module({
  providers: [ReconciliationService, BillingService, TariffService],
  exports: [BillingService, TariffService],
})
export class BillingModule {}
