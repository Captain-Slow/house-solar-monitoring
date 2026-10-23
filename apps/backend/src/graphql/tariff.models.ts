import {
  Field,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { GraphQLLocalDate } from 'graphql-scalars';
import { DecimalScalar } from './scalars/decimal.scalar.js';
import { PageInfo } from './models.js';

export enum BillingStatus {
  COMPLETE = 'COMPLETE',
  ESTIMATED = 'ESTIMATED',
  UNAVAILABLE = 'UNAVAILABLE',
}
registerEnumType(BillingStatus, { name: 'BillingStatus' });

@ObjectType('Tariff')
export class TariffModel {
  @Field(() => Int) id: number;
  @Field() name: string;
  @Field() currency: string;
  @Field() timezone: string;
  @Field(() => [TariffVersionModel]) versions: TariffVersionModel[];
}
@ObjectType('TariffVersion')
export class TariffVersionModel {
  @Field(() => Int) id: number;
  @Field(() => Int) tariffId: number;
  @Field(() => GraphQLLocalDate) effectiveFrom: string;
  @Field(() => GraphQLLocalDate, { nullable: true }) effectiveTo: string | null;
  @Field() rules: string;
  @Field() sourceNote: string;
  @Field() billVerified: boolean;
}
@ObjectType('TariffHoliday')
export class TariffHolidayModel {
  @Field(() => Int) tariffId: number;
  @Field(() => GraphQLLocalDate) date: string;
  @Field() name: string;
}
@ObjectType('TariffMonthlyRate')
export class TariffMonthlyRateModel {
  @Field(() => Int) tariffId: number;
  @Field() componentCode: string;
  @Field() month: string;
  @Field(() => DecimalScalar) ratePerKwh: string;
  @Field() sourceNote: string;
}
@ObjectType('CreditLot')
export class CreditLotModel {
  @Field(() => GraphQLLocalDate) originStart: string;
  @Field(() => DecimalScalar) kwh: string;
}
@ObjectType('NemState')
export class NemStateModel {
  @Field(() => [CreditLotModel]) openingLots: CreditLotModel[];
  @Field(() => [CreditLotModel]) expiredLots: CreditLotModel[];
  @Field(() => [CreditLotModel]) closingLots: CreditLotModel[];
}
@ObjectType('LineItem')
export class LineItemModel {
  @Field() code: string;
  @Field() label: string;
  @Field() kind: string;
  @Field(() => Int) segment: number;
  @Field(() => DecimalScalar, { nullable: true }) quantityKwh: string | null;
  @Field(() => DecimalScalar, { nullable: true }) rate: string | null;
  @Field(() => DecimalScalar, { nullable: true }) amount: string | null;
  @Field() status: string;
  @Field(() => String, { nullable: true }) note?: string | null;
}
@ObjectType('BillingPeriodResult')
export class BillingPeriodResultModel {
  @Field(() => BillingStatus) status: BillingStatus;
  @Field(() => DecimalScalar, { nullable: true }) total: string | null;
  @Field(() => DecimalScalar, { nullable: true }) subtotal: string | null;
  @Field(() => [String]) reasons: string[];
  @Field(() => DecimalScalar) coverage: string;
  @Field() isLowerBound: boolean;
  @Field(() => NemStateModel, { nullable: true }) nem: NemStateModel | null;
  @Field(() => [LineItemModel]) lineItems: LineItemModel[];
}
@ObjectType('BillingPeriod')
export class BillingPeriodModel {
  @Field(() => Int) id: number;
  @Field(() => Int) tariffId: number;
  @Field(() => GraphQLLocalDate) startDate: string;
  @Field(() => GraphQLLocalDate) endDate: string;
  @Field(() => String, { nullable: true }) note: string | null;
  @Field() stale: boolean;
  @Field(() => BillingPeriodResultModel, { nullable: true })
  result: BillingPeriodResultModel | null;
}
@ObjectType()
export class BillingPeriodEdge {
  @Field() cursor: string;
  @Field(() => BillingPeriodModel) node: BillingPeriodModel;
}
@ObjectType()
export class BillingPeriodConnection {
  @Field(() => [BillingPeriodEdge]) edges: BillingPeriodEdge[];
  @Field(() => PageInfo) pageInfo: PageInfo;
}
@InputType('TariffInput')
export class TariffInputModel {
  @Field() name: string;
  @Field() currency: string;
  @Field() timezone: string;
}
@InputType('HolidayInput')
export class HolidayInputModel {
  @Field(() => GraphQLLocalDate) date: string;
  @Field() name: string;
}
@InputType('OpeningCreditLotInput')
export class OpeningCreditLotInput {
  @Field(() => GraphQLLocalDate) originStart: string;
  @Field(() => DecimalScalar) kwh: string;
}
@InputType('BillingPeriodInput')
export class BillingPeriodInputModel {
  @Field(() => Int) tariffId: number;
  @Field(() => GraphQLLocalDate) startDate: string;
  @Field(() => GraphQLLocalDate) endDate: string;
  @Field(() => [OpeningCreditLotInput], { nullable: true }) openingCreditLots?:
    OpeningCreditLotInput[] | null;
  @Field(() => String, { nullable: true }) bill?: string | null;
  @Field(() => String, { nullable: true }) note?: string | null;
}
