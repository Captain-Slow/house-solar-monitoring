import {
  Field,
  InputType,
  Int,
  ObjectType,
  registerEnumType,
} from '@nestjs/graphql';
import { GraphQLDateTime, GraphQLLocalDate } from 'graphql-scalars';
import { Decimal } from 'decimal.js';
import { DecimalScalar } from './scalars/decimal.scalar.js';
import { PageInfo, ValueStatus } from './models.js';

export enum Granularity {
  DAY = 'DAY',
  WEEK = 'WEEK',
  MONTH = 'MONTH',
  YEAR = 'YEAR',
}
export enum PowerMetric {
  PV = 'PV',
  LOAD = 'LOAD',
  LOAD_VENDOR = 'LOAD_VENDOR',
  GRID = 'GRID',
  GRID_A = 'GRID_A',
  GRID_B = 'GRID_B',
  GRID_C = 'GRID_C',
  BATTERY = 'BATTERY',
  SOC = 'SOC',
  INVERTER_AC = 'INVERTER_AC',
}
export enum Provenance {
  MEASURED_INTEGRATED = 'MEASURED_INTEGRATED',
  DEVICE_COUNTER = 'DEVICE_COUNTER',
  DERIVED = 'DERIVED',
  ESTIMATED = 'ESTIMATED',
  VENDOR_SUMMARY = 'VENDOR_SUMMARY',
}
export enum MeterReadingSource {
  UTILITY_METER_MANUAL = 'UTILITY_METER_MANUAL',
  HOYMILES_METER_LCD = 'HOYMILES_METER_LCD',
}
for (const [name, value] of Object.entries({
  Granularity,
  PowerMetric,
  Provenance,
  MeterReadingSource,
}))
  registerEnumType(value, { name });

@ObjectType()
export class EnergyValue {
  @Field(() => DecimalScalar, { nullable: true }) kwh: Decimal | null;
  @Field(() => Provenance) provenance: Provenance;
  @Field() source: string;
  @Field() validated: boolean;
  @Field(() => DecimalScalar) coverage: Decimal;
  @Field(() => ValueStatus) status: ValueStatus;
  @Field(() => [String]) flags: string[];
}
@ObjectType()
export class WindowEnergy {
  @Field() window: string;
  @Field(() => EnergyValue) importKwh: EnergyValue;
  @Field(() => EnergyValue) exportKwh: EnergyValue;
}
@ObjectType()
export class VendorValue {
  @Field(() => DecimalScalar, { nullable: true }) kwh: Decimal | null;
  @Field(() => Provenance) provenance: Provenance;
}
@ObjectType()
export class VendorQuantities {
  @Field(() => VendorValue) solar: VendorValue;
  @Field(() => VendorValue) consumption: VendorValue;
  @Field(() => VendorValue) gridImport: VendorValue;
  @Field(() => VendorValue) gridExport: VendorValue;
  @Field(() => VendorValue) batteryCharge: VendorValue;
  @Field(() => VendorValue) batteryDischarge: VendorValue;
}
@ObjectType()
export class VendorComparison {
  @Field(() => VendorQuantities, {
    description:
      'Last raw lifetime readings in the range; includes pre-monitoring energy and is unvalidated.',
  })
  lifetime: VendorQuantities;
  @Field(() => VendorQuantities, {
    description:
      'Last minus first raw lifetime readings within the range; unvalidated, not ledger energy.',
  })
  intervalDelta: VendorQuantities;
  @Field(() => VendorQuantities) vendorToday: VendorQuantities;
}
@ObjectType()
export class EnergyRow {
  @Field(() => GraphQLLocalDate) periodStart: string;
  @Field(() => GraphQLLocalDate) periodEnd: string;
  @Field(() => EnergyValue) solar: EnergyValue;
  @Field(() => EnergyValue) consumption: EnergyValue;
  @Field(() => EnergyValue) gridImport: EnergyValue;
  @Field(() => EnergyValue) gridExport: EnergyValue;
  @Field(() => EnergyValue) batteryCharge: EnergyValue;
  @Field(() => EnergyValue) batteryDischarge: EnergyValue;
  @Field(() => [WindowEnergy]) gridByWindow: WindowEnergy[];
  @Field(() => VendorComparison) vendor: VendorComparison;
}
@ObjectType()
export class EnergyTotals {
  @Field(() => GraphQLDateTime, { nullable: true })
  monitoringSince: Date | null;
  @Field() preMonitoringExcluded: boolean;
  @Field(() => GraphQLDateTime, { nullable: true })
  lastSourceUpdate: Date | null;
  @Field(() => [EnergyRow]) rows: EnergyRow[];
  @Field(() => EnergyRow) total: EnergyRow;
}
@ObjectType()
export class SeriesPoint {
  @Field(() => GraphQLDateTime) t: Date;
  @Field(() => Int, { nullable: true }) avg: number | null;
  @Field(() => Int, { nullable: true }) min: number | null;
  @Field(() => Int, { nullable: true }) max: number | null;
  @Field(() => DecimalScalar) coverage: Decimal;
}
@ObjectType()
export class MetricSeries {
  @Field(() => PowerMetric) metric: PowerMetric;
  @Field(() => [SeriesPoint]) points: SeriesPoint[];
}
@ObjectType()
export class TimeRange {
  @Field(() => GraphQLDateTime) from: Date;
  @Field(() => GraphQLDateTime) to: Date;
}
@ObjectType()
export class PowerSeries {
  @Field(() => Int) bucketSeconds: number;
  @Field(() => [MetricSeries]) series: MetricSeries[];
  @Field(() => [TimeRange]) gaps: TimeRange[];
}
@ObjectType('MeterReading')
export class MeterReadingModel {
  @Field(() => Int) id: number;
  @Field(() => GraphQLDateTime) readAt: Date;
  @Field(() => DecimalScalar) importKwh: Decimal;
  @Field(() => DecimalScalar, { nullable: true }) exportKwh: Decimal | null;
  @Field(() => DecimalScalar, { nullable: true }) importPeakKwh: Decimal | null;
  @Field(() => DecimalScalar, { nullable: true })
  importOffpeakKwh: Decimal | null;
  @Field(() => DecimalScalar) resolutionKwh: Decimal;
  @Field(() => MeterReadingSource) source: MeterReadingSource;
  @Field(() => String, { nullable: true }) note: string | null;
  @Field(() => GraphQLDateTime) createdAt: Date;
}
@InputType()
export class MeterReadingInput {
  @Field(() => GraphQLDateTime) readAt: Date;
  @Field(() => DecimalScalar) importKwh: string;
  @Field(() => DecimalScalar, { nullable: true }) exportKwh?: string;
  @Field(() => DecimalScalar, { nullable: true }) importPeakKwh?: string;
  @Field(() => DecimalScalar, { nullable: true }) importOffpeakKwh?: string;
  @Field(() => DecimalScalar, { nullable: true }) resolutionKwh?: string;
  @Field(() => MeterReadingSource) source: MeterReadingSource;
  @Field(() => String, { nullable: true }) note?: string;
}
@ObjectType()
export class MeterReadingEdge {
  @Field() cursor: string;
  @Field(() => MeterReadingModel) node: MeterReadingModel;
}
@ObjectType()
export class MeterReadingConnection {
  @Field(() => [MeterReadingEdge]) edges: MeterReadingEdge[];
  @Field(() => PageInfo) pageInfo: PageInfo;
}
@ObjectType('AccountingPolicy')
export class AccountingPolicyModel {
  @Field(() => Int) version: number;
  @Field(() => GraphQLDateTime) effectiveFrom: Date;
  @Field(() => Int, { nullable: true }) supersededByVersion: number | null;
  @Field() gridSource: string;
  @Field() pvSource: string;
  @Field() batterySource: string;
  @Field() loadSource: string;
  @Field(() => Int) maxGapSec: number;
  @Field(() => String) validated: string;
  @Field() note: string;
  @Field(() => GraphQLDateTime) createdAt: Date;
}
@InputType()
export class AccountingPolicyInput {
  @Field(() => GraphQLDateTime) effectiveFrom: Date;
  @Field() gridSource: string;
  @Field() pvSource: string;
  @Field() batterySource: string;
  @Field() loadSource: string;
  @Field(() => Int) maxGapSec: number;
  @Field(() => String, { nullable: true }) validated?: string;
  @Field() note: string;
}
@ObjectType('CalculationRun')
export class CalculationRunModel {
  @Field(() => Int) id: number;
  @Field() kind: string;
  @Field() reason: string;
  @Field(() => GraphQLDateTime) rangeStart: Date;
  @Field(() => GraphQLDateTime) rangeEnd: Date;
  @Field(() => Int) calcVersion: number;
  @Field(() => Int) mappingVersion: number;
  @Field(() => GraphQLDateTime) startedAt: Date;
  @Field(() => GraphQLDateTime, { nullable: true }) finishedAt: Date | null;
  @Field() status: string;
  @Field(() => String, { nullable: true }) error: string | null;
  @Field(() => GraphQLDateTime, { nullable: true })
  outsideRetentionBefore?: Date | null;
}
@ObjectType()
export class CalculationRunEdge {
  @Field() cursor: string;
  @Field(() => CalculationRunModel) node: CalculationRunModel;
}
@ObjectType()
export class CalculationRunConnection {
  @Field(() => [CalculationRunEdge]) edges: CalculationRunEdge[];
  @Field(() => PageInfo) pageInfo: PageInfo;
}
@ObjectType()
export class AccountingPolicyChange {
  @Field(() => AccountingPolicyModel) policy: AccountingPolicyModel;
  @Field(() => CalculationRunModel, { nullable: true })
  calculationRun: CalculationRunModel | null;
  @Field(() => Int) billingPeriodsInvalidated: number;
  @Field(() => GraphQLDateTime, { nullable: true })
  outsideRetentionBefore: Date | null;
}
@ObjectType('DataExclusion')
export class DataExclusionModel {
  @Field(() => Int) id: number;
  @Field(() => GraphQLDateTime) from: Date;
  @Field(() => GraphQLDateTime) to: Date;
  @Field(() => [String]) families: string[];
  @Field() reason: string;
  @Field() createdBy: string;
  @Field(() => GraphQLDateTime) createdAt: Date;
}
@InputType()
export class DataExclusionInput {
  @Field(() => GraphQLDateTime) from: Date;
  @Field(() => GraphQLDateTime) to: Date;
  @Field(() => [String]) families: string[];
  @Field() reason: string;
}
@ObjectType()
export class ReconciliationDirection {
  @Field(() => String) verdict: string;
  @Field(() => DecimalScalar, { nullable: true }) utilityKwh: Decimal | null;
  @Field(() => DecimalScalar, { nullable: true }) oursKwh: Decimal | null;
  @Field(() => DecimalScalar, { nullable: true }) ratio: Decimal | null;
}
@ObjectType()
export class ReconciliationCandidate {
  @Field() source: string;
  @Field(() => DecimalScalar) coverage: Decimal;
  @Field(() => ReconciliationDirection) import: ReconciliationDirection;
  @Field(() => ReconciliationDirection) export: ReconciliationDirection;
}
@ObjectType()
export class Reconciliation {
  @Field(() => Int) fromReadingId: number;
  @Field(() => Int) toReadingId: number;
  @Field(() => [ReconciliationCandidate]) candidates: ReconciliationCandidate[];
  @Field(() => [String]) investigationPath: string[];
}
