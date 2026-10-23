import { Field, Int, ObjectType, registerEnumType } from '@nestjs/graphql';
import { GraphQLDateTime } from 'graphql-scalars';

export enum ValueStatus {
  OK = 'OK',
  PARTIAL = 'PARTIAL',
  STALE = 'STALE',
  UNAVAILABLE = 'UNAVAILABLE',
}
export enum Freshness {
  LIVE = 'LIVE',
  STALE = 'STALE',
  NO_DATA = 'NO_DATA',
}
export enum AccountingStatus {
  MAPPING_PROVISIONAL = 'MAPPING_PROVISIONAL',
  UNRECONCILED = 'UNRECONCILED',
  RECONCILED = 'RECONCILED',
  RECONCILIATION_FAILED = 'RECONCILIATION_FAILED',
}
registerEnumType(ValueStatus, { name: 'ValueStatus' });
registerEnumType(Freshness, { name: 'Freshness' });
registerEnumType(AccountingStatus, { name: 'AccountingStatus' });

@ObjectType()
export class PowerValue {
  @Field(() => Int, { nullable: true }) watts: number | null;
  @Field(() => ValueStatus) status: ValueStatus;
  @Field(() => String, { nullable: true }) reason: string | null;
}

@ObjectType()
export class OperatingMode {
  @Field(() => Int) code: number;
  @Field() label: string;
  @Field(() => GraphQLDateTime) observedAt: Date;
}

@ObjectType()
export class LiveStatus {
  @Field(() => GraphQLDateTime) serverTime: Date;
  @Field(() => GraphQLDateTime, { nullable: true }) observedAt: Date | null;
  @Field(() => Int, { nullable: true }) ageSeconds: number | null;
  @Field(() => Freshness) freshness: Freshness;
  @Field(() => PowerValue) pv: PowerValue;
  @Field(() => [PowerValue]) pvStrings: PowerValue[];
  @Field(() => PowerValue) load: PowerValue;
  @Field(() => PowerValue) loadVendor: PowerValue;
  @Field(() => PowerValue) grid: PowerValue;
  @Field(() => [PowerValue]) gridPhases: PowerValue[];
  @Field(() => PowerValue) battery: PowerValue;
  @Field(() => Int, { nullable: true }) batterySoc: number | null;
  @Field(() => String, { nullable: true }) batteryState: string | null;
  @Field(() => OperatingMode, { nullable: true })
  operatingMode: OperatingMode | null;
  @Field(() => String, { nullable: true }) meterLink: string | null;
  @Field(() => [String]) activeFaults: string[];
  @Field(() => AccountingStatus) accountingStatus: AccountingStatus;
}

@ObjectType('Device')
export class DeviceModel {
  @Field(() => Int) id: number;
  @Field() deviceKey: string;
  @Field() model: string;
  @Field(() => GraphQLDateTime) firstSeenAt: Date;
  @Field(() => GraphQLDateTime) lastSeenAt: Date;
  @Field(() => GraphQLDateTime, { nullable: true }) retiredAt: Date | null;
}

@ObjectType()
export class CollectorStatus {
  @Field() acquisitionSource: string;
  @Field() siteTimezone: string;
  @Field() state: string;
  @Field(() => GraphQLDateTime, { nullable: true }) lastSuccessAt: Date | null;
  @Field(() => GraphQLDateTime, { nullable: true }) lastErrorAt: Date | null;
  @Field(() => String, { nullable: true }) lastError: string | null;
  @Field(() => Int) consecutiveFailures: number;
  @Field(() => GraphQLDateTime, { nullable: true }) nextRetryAt: Date | null;
  @Field(() => DeviceModel, { nullable: true }) device: DeviceModel | null;
  @Field(() => Int) mappingVersion: number;
  @Field(() => Int) policyVersion: number;
  @Field(() => Int) calcVersion: number;
  @Field(() => GraphQLDateTime, { nullable: true })
  monitoringSince: Date | null;
  @Field(() => GraphQLDateTime, { nullable: true }) lastBackupAt: Date | null;
  @Field(() => GraphQLDateTime) tlsCertExpiresAt: Date;
}

@ObjectType('DataQualityEvent')
export class DataQualityEventModel {
  @Field() id: string;
  @Field(() => Int, { nullable: true }) deviceId: number | null;
  @Field() kind: string;
  @Field(() => GraphQLDateTime) startedAt: Date;
  @Field(() => GraphQLDateTime, { nullable: true }) endedAt: Date | null;
  @Field(() => GraphQLDateTime) createdAt: Date;
}

@ObjectType()
export class DataQualityEventEdge {
  @Field() cursor: string;
  @Field(() => DataQualityEventModel) node: DataQualityEventModel;
}

@ObjectType()
export class PageInfo {
  @Field() hasNextPage: boolean;
  @Field(() => String, { nullable: true }) endCursor: string | null;
}

@ObjectType()
export class DataQualityEventConnection {
  @Field(() => [DataQualityEventEdge]) edges: DataQualityEventEdge[];
  @Field(() => PageInfo) pageInfo: PageInfo;
}
