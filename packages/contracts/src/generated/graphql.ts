import { TypedDocumentNode as DocumentNode } from "@graphql-typed-document-node/core";
export type Maybe<T> = T | null;
export type InputMaybe<T> = Maybe<T>;
export type Exact<T extends { [key: string]: unknown }> = {
  [K in keyof T]: T[K];
};
export type MakeOptional<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]?: Maybe<T[SubKey]>;
};
export type MakeMaybe<T, K extends keyof T> = Omit<T, K> & {
  [SubKey in K]: Maybe<T[SubKey]>;
};
export type MakeEmpty<
  T extends { [key: string]: unknown },
  K extends keyof T,
> = { [_ in K]?: never };
export type Incremental<T> =
  | T
  | {
      [P in keyof T]?: P extends " $fragmentName" | "__typename" ? T[P] : never;
    };
/** All built-in and custom scalars, mapped to their actual values */
export type Scalars = {
  ID: { input: string; output: string };
  String: { input: string; output: string };
  Boolean: { input: boolean; output: boolean };
  Int: { input: number; output: number };
  Float: { input: number; output: number };
  /** A date-time string at UTC, such as 2007-12-03T10:15:30Z, compliant with the `date-time` format outlined in section 5.6 of the RFC 3339 profile of the ISO 8601 standard for representation of dates and times using the Gregorian calendar. */
  DateTime: { input: any; output: any };
  /** Decimal encoded as a fixed-point string (up to 12 integer and 6 fractional digits). */
  Decimal: { input: any; output: any };
  /** A local date string (i.e., with no associated timezone) in `YYYY-MM-DD` format, e.g. `2020-01-01`. */
  LocalDate: { input: any; output: any };
};

export type AccountingPolicy = {
  __typename?: "AccountingPolicy";
  batterySource: Scalars["String"]["output"];
  createdAt: Scalars["DateTime"]["output"];
  effectiveFrom: Scalars["DateTime"]["output"];
  gridSource: Scalars["String"]["output"];
  loadSource: Scalars["String"]["output"];
  maxGapSec: Scalars["Int"]["output"];
  note: Scalars["String"]["output"];
  pvSource: Scalars["String"]["output"];
  supersededByVersion: Maybe<Scalars["Int"]["output"]>;
  validated: Scalars["String"]["output"];
  version: Scalars["Int"]["output"];
};

export type AccountingPolicyChange = {
  __typename?: "AccountingPolicyChange";
  billingPeriodsInvalidated: Scalars["Int"]["output"];
  calculationRun: Maybe<CalculationRun>;
  outsideRetentionBefore: Maybe<Scalars["DateTime"]["output"]>;
  policy: AccountingPolicy;
};

export type AccountingPolicyInput = {
  batterySource: Scalars["String"]["input"];
  effectiveFrom: Scalars["DateTime"]["input"];
  gridSource: Scalars["String"]["input"];
  loadSource: Scalars["String"]["input"];
  maxGapSec: Scalars["Int"]["input"];
  note: Scalars["String"]["input"];
  pvSource: Scalars["String"]["input"];
  validated: InputMaybe<Scalars["String"]["input"]>;
};

export enum AccountingStatus {
  MappingProvisional = "MAPPING_PROVISIONAL",
  Reconciled = "RECONCILED",
  ReconciliationFailed = "RECONCILIATION_FAILED",
  Unreconciled = "UNRECONCILED",
}

export type BillingPeriod = {
  __typename?: "BillingPeriod";
  endDate: Scalars["LocalDate"]["output"];
  id: Scalars["Int"]["output"];
  note: Maybe<Scalars["String"]["output"]>;
  result: Maybe<BillingPeriodResult>;
  stale: Scalars["Boolean"]["output"];
  startDate: Scalars["LocalDate"]["output"];
  tariffId: Scalars["Int"]["output"];
};

export type BillingPeriodConnection = {
  __typename?: "BillingPeriodConnection";
  edges: Array<BillingPeriodEdge>;
  pageInfo: PageInfo;
};

export type BillingPeriodEdge = {
  __typename?: "BillingPeriodEdge";
  cursor: Scalars["String"]["output"];
  node: BillingPeriod;
};

export type BillingPeriodInput = {
  bill: InputMaybe<Scalars["String"]["input"]>;
  endDate: Scalars["LocalDate"]["input"];
  note: InputMaybe<Scalars["String"]["input"]>;
  openingCreditLots: InputMaybe<Array<OpeningCreditLotInput>>;
  startDate: Scalars["LocalDate"]["input"];
  tariffId: Scalars["Int"]["input"];
};

export type BillingPeriodResult = {
  __typename?: "BillingPeriodResult";
  coverage: Scalars["Decimal"]["output"];
  isLowerBound: Scalars["Boolean"]["output"];
  lineItems: Array<LineItem>;
  nem: Maybe<NemState>;
  reasons: Array<Scalars["String"]["output"]>;
  status: BillingStatus;
  subtotal: Maybe<Scalars["Decimal"]["output"]>;
  total: Maybe<Scalars["Decimal"]["output"]>;
};

export enum BillingStatus {
  Complete = "COMPLETE",
  Estimated = "ESTIMATED",
  Unavailable = "UNAVAILABLE",
}

export type CalculationRun = {
  __typename?: "CalculationRun";
  calcVersion: Scalars["Int"]["output"];
  error: Maybe<Scalars["String"]["output"]>;
  finishedAt: Maybe<Scalars["DateTime"]["output"]>;
  id: Scalars["Int"]["output"];
  kind: Scalars["String"]["output"];
  mappingVersion: Scalars["Int"]["output"];
  outsideRetentionBefore: Maybe<Scalars["DateTime"]["output"]>;
  rangeEnd: Scalars["DateTime"]["output"];
  rangeStart: Scalars["DateTime"]["output"];
  reason: Scalars["String"]["output"];
  startedAt: Scalars["DateTime"]["output"];
  status: Scalars["String"]["output"];
};

export type CalculationRunConnection = {
  __typename?: "CalculationRunConnection";
  edges: Array<CalculationRunEdge>;
  pageInfo: PageInfo;
};

export type CalculationRunEdge = {
  __typename?: "CalculationRunEdge";
  cursor: Scalars["String"]["output"];
  node: CalculationRun;
};

export type CollectorStatus = {
  __typename?: "CollectorStatus";
  acquisitionSource: Scalars["String"]["output"];
  calcVersion: Scalars["Int"]["output"];
  consecutiveFailures: Scalars["Int"]["output"];
  device: Maybe<Device>;
  lastBackupAt: Maybe<Scalars["DateTime"]["output"]>;
  lastError: Maybe<Scalars["String"]["output"]>;
  lastErrorAt: Maybe<Scalars["DateTime"]["output"]>;
  lastSuccessAt: Maybe<Scalars["DateTime"]["output"]>;
  mappingVersion: Scalars["Int"]["output"];
  monitoringSince: Maybe<Scalars["DateTime"]["output"]>;
  nextRetryAt: Maybe<Scalars["DateTime"]["output"]>;
  policyVersion: Scalars["Int"]["output"];
  siteTimezone: Scalars["String"]["output"];
  state: Scalars["String"]["output"];
  tlsCertExpiresAt: Scalars["DateTime"]["output"];
};

export type CreditLot = {
  __typename?: "CreditLot";
  kwh: Scalars["Decimal"]["output"];
  originStart: Scalars["LocalDate"]["output"];
};

export type DataExclusion = {
  __typename?: "DataExclusion";
  createdAt: Scalars["DateTime"]["output"];
  createdBy: Scalars["String"]["output"];
  families: Array<Scalars["String"]["output"]>;
  from: Scalars["DateTime"]["output"];
  id: Scalars["Int"]["output"];
  reason: Scalars["String"]["output"];
  to: Scalars["DateTime"]["output"];
};

export type DataExclusionInput = {
  families: Array<Scalars["String"]["input"]>;
  from: Scalars["DateTime"]["input"];
  reason: Scalars["String"]["input"];
  to: Scalars["DateTime"]["input"];
};

export type DataQualityEvent = {
  __typename?: "DataQualityEvent";
  createdAt: Scalars["DateTime"]["output"];
  deviceId: Maybe<Scalars["Int"]["output"]>;
  endedAt: Maybe<Scalars["DateTime"]["output"]>;
  id: Scalars["String"]["output"];
  kind: Scalars["String"]["output"];
  startedAt: Scalars["DateTime"]["output"];
};

export type DataQualityEventConnection = {
  __typename?: "DataQualityEventConnection";
  edges: Array<DataQualityEventEdge>;
  pageInfo: PageInfo;
};

export type DataQualityEventEdge = {
  __typename?: "DataQualityEventEdge";
  cursor: Scalars["String"]["output"];
  node: DataQualityEvent;
};

export type Device = {
  __typename?: "Device";
  deviceKey: Scalars["String"]["output"];
  firstSeenAt: Scalars["DateTime"]["output"];
  id: Scalars["Int"]["output"];
  lastSeenAt: Scalars["DateTime"]["output"];
  model: Scalars["String"]["output"];
  retiredAt: Maybe<Scalars["DateTime"]["output"]>;
};

export type EnergyRow = {
  __typename?: "EnergyRow";
  batteryCharge: EnergyValue;
  batteryDischarge: EnergyValue;
  consumption: EnergyValue;
  gridByWindow: Array<WindowEnergy>;
  gridExport: EnergyValue;
  gridImport: EnergyValue;
  periodEnd: Scalars["LocalDate"]["output"];
  periodStart: Scalars["LocalDate"]["output"];
  solar: EnergyValue;
  vendor: VendorComparison;
};

export type EnergyTotals = {
  __typename?: "EnergyTotals";
  lastSourceUpdate: Maybe<Scalars["DateTime"]["output"]>;
  monitoringSince: Maybe<Scalars["DateTime"]["output"]>;
  preMonitoringExcluded: Scalars["Boolean"]["output"];
  rows: Array<EnergyRow>;
  total: EnergyRow;
};

export type EnergyValue = {
  __typename?: "EnergyValue";
  coverage: Scalars["Decimal"]["output"];
  flags: Array<Scalars["String"]["output"]>;
  kwh: Maybe<Scalars["Decimal"]["output"]>;
  provenance: Provenance;
  source: Scalars["String"]["output"];
  status: ValueStatus;
  validated: Scalars["Boolean"]["output"];
};

export enum Freshness {
  Live = "LIVE",
  NoData = "NO_DATA",
  Stale = "STALE",
}

export enum Granularity {
  Day = "DAY",
  Month = "MONTH",
  Week = "WEEK",
  Year = "YEAR",
}

export type HolidayInput = {
  date: Scalars["LocalDate"]["input"];
  name: Scalars["String"]["input"];
};

export type LineItem = {
  __typename?: "LineItem";
  amount: Maybe<Scalars["Decimal"]["output"]>;
  code: Scalars["String"]["output"];
  kind: Scalars["String"]["output"];
  label: Scalars["String"]["output"];
  note: Maybe<Scalars["String"]["output"]>;
  quantityKwh: Maybe<Scalars["Decimal"]["output"]>;
  rate: Maybe<Scalars["Decimal"]["output"]>;
  segment: Scalars["Int"]["output"];
  status: Scalars["String"]["output"];
};

export type LiveStatus = {
  __typename?: "LiveStatus";
  accountingStatus: AccountingStatus;
  activeFaults: Array<Scalars["String"]["output"]>;
  ageSeconds: Maybe<Scalars["Int"]["output"]>;
  battery: PowerValue;
  batterySoc: Maybe<Scalars["Int"]["output"]>;
  batteryState: Maybe<Scalars["String"]["output"]>;
  freshness: Freshness;
  grid: PowerValue;
  gridPhases: Array<PowerValue>;
  load: PowerValue;
  loadVendor: PowerValue;
  meterLink: Maybe<Scalars["String"]["output"]>;
  observedAt: Maybe<Scalars["DateTime"]["output"]>;
  operatingMode: Maybe<OperatingMode>;
  pv: PowerValue;
  pvStrings: Array<PowerValue>;
  serverTime: Scalars["DateTime"]["output"];
};

export type MeterReading = {
  __typename?: "MeterReading";
  createdAt: Scalars["DateTime"]["output"];
  exportKwh: Maybe<Scalars["Decimal"]["output"]>;
  id: Scalars["Int"]["output"];
  importKwh: Scalars["Decimal"]["output"];
  importOffpeakKwh: Maybe<Scalars["Decimal"]["output"]>;
  importPeakKwh: Maybe<Scalars["Decimal"]["output"]>;
  note: Maybe<Scalars["String"]["output"]>;
  readAt: Scalars["DateTime"]["output"];
  resolutionKwh: Scalars["Decimal"]["output"];
  source: MeterReadingSource;
};

export type MeterReadingConnection = {
  __typename?: "MeterReadingConnection";
  edges: Array<MeterReadingEdge>;
  pageInfo: PageInfo;
};

export type MeterReadingEdge = {
  __typename?: "MeterReadingEdge";
  cursor: Scalars["String"]["output"];
  node: MeterReading;
};

export type MeterReadingInput = {
  exportKwh: InputMaybe<Scalars["Decimal"]["input"]>;
  importKwh: Scalars["Decimal"]["input"];
  importOffpeakKwh: InputMaybe<Scalars["Decimal"]["input"]>;
  importPeakKwh: InputMaybe<Scalars["Decimal"]["input"]>;
  note: InputMaybe<Scalars["String"]["input"]>;
  readAt: Scalars["DateTime"]["input"];
  resolutionKwh: InputMaybe<Scalars["Decimal"]["input"]>;
  source: MeterReadingSource;
};

export enum MeterReadingSource {
  HoymilesMeterLcd = "HOYMILES_METER_LCD",
  UtilityMeterManual = "UTILITY_METER_MANUAL",
}

export type MetricSeries = {
  __typename?: "MetricSeries";
  metric: PowerMetric;
  points: Array<SeriesPoint>;
};

export type Mutation = {
  __typename?: "Mutation";
  addMeterReading: MeterReading;
  createAccountingPolicy: AccountingPolicyChange;
  createDataExclusion: DataExclusion;
  createTariff: Tariff;
  createTariffVersion: TariffVersion;
  deleteDataExclusion: Scalars["Boolean"]["output"];
  deleteMeterReading: Scalars["Boolean"]["output"];
  requestRecalculation: CalculationRun;
  setMonthlyRate: TariffMonthlyRate;
  setTariffHolidays: Array<TariffHoliday>;
  upsertBillingPeriod: BillingPeriod;
};

export type MutationAddMeterReadingArgs = {
  input: MeterReadingInput;
};

export type MutationCreateAccountingPolicyArgs = {
  input: AccountingPolicyInput;
};

export type MutationCreateDataExclusionArgs = {
  input: DataExclusionInput;
};

export type MutationCreateTariffArgs = {
  input: TariffInput;
};

export type MutationCreateTariffVersionArgs = {
  effectiveFrom: Scalars["LocalDate"]["input"];
  effectiveTo: InputMaybe<Scalars["LocalDate"]["input"]>;
  rules: Scalars["String"]["input"];
  sourceNote: Scalars["String"]["input"];
  tariffId: Scalars["Int"]["input"];
};

export type MutationDeleteDataExclusionArgs = {
  id: Scalars["Int"]["input"];
};

export type MutationDeleteMeterReadingArgs = {
  id: Scalars["Int"]["input"];
};

export type MutationRequestRecalculationArgs = {
  from: Scalars["DateTime"]["input"];
  kind: Scalars["String"]["input"];
  reason: Scalars["String"]["input"];
  to: Scalars["DateTime"]["input"];
};

export type MutationSetMonthlyRateArgs = {
  componentCode: Scalars["String"]["input"];
  month: Scalars["String"]["input"];
  ratePerKwh: Scalars["Decimal"]["input"];
  sourceNote: Scalars["String"]["input"];
  tariffId: Scalars["Int"]["input"];
};

export type MutationSetTariffHolidaysArgs = {
  holidays: Array<HolidayInput>;
  tariffId: Scalars["Int"]["input"];
  year: Scalars["Int"]["input"];
};

export type MutationUpsertBillingPeriodArgs = {
  input: BillingPeriodInput;
};

export type NemState = {
  __typename?: "NemState";
  closingLots: Array<CreditLot>;
  expiredLots: Array<CreditLot>;
  openingLots: Array<CreditLot>;
};

export type OpeningCreditLotInput = {
  kwh: Scalars["Decimal"]["input"];
  originStart: Scalars["LocalDate"]["input"];
};

export type OperatingMode = {
  __typename?: "OperatingMode";
  code: Scalars["Int"]["output"];
  label: Scalars["String"]["output"];
  observedAt: Scalars["DateTime"]["output"];
};

export type PageInfo = {
  __typename?: "PageInfo";
  endCursor: Maybe<Scalars["String"]["output"]>;
  hasNextPage: Scalars["Boolean"]["output"];
};

export enum PowerMetric {
  Battery = "BATTERY",
  Grid = "GRID",
  GridA = "GRID_A",
  GridB = "GRID_B",
  GridC = "GRID_C",
  InverterAc = "INVERTER_AC",
  Load = "LOAD",
  LoadVendor = "LOAD_VENDOR",
  Pv = "PV",
  Soc = "SOC",
}

export type PowerSeries = {
  __typename?: "PowerSeries";
  bucketSeconds: Scalars["Int"]["output"];
  gaps: Array<TimeRange>;
  series: Array<MetricSeries>;
};

export type PowerValue = {
  __typename?: "PowerValue";
  reason: Maybe<Scalars["String"]["output"]>;
  status: ValueStatus;
  watts: Maybe<Scalars["Int"]["output"]>;
};

export enum Provenance {
  Derived = "DERIVED",
  DeviceCounter = "DEVICE_COUNTER",
  Estimated = "ESTIMATED",
  MeasuredIntegrated = "MEASURED_INTEGRATED",
  VendorSummary = "VENDOR_SUMMARY",
}

export type Query = {
  __typename?: "Query";
  accountingPolicies: Array<AccountingPolicy>;
  billingPeriod: Maybe<BillingPeriod>;
  billingPeriods: BillingPeriodConnection;
  calculationRuns: CalculationRunConnection;
  collectorStatus: CollectorStatus;
  dataExclusions: Array<DataExclusion>;
  dataQualityEvents: DataQualityEventConnection;
  devices: Array<Device>;
  energyTotals: EnergyTotals;
  liveStatus: LiveStatus;
  meterReadings: MeterReadingConnection;
  powerSeries: PowerSeries;
  reconciliation: Reconciliation;
  tariffHolidays: Array<TariffHoliday>;
  tariffMonthlyRates: Array<TariffMonthlyRate>;
  tariffs: Array<Tariff>;
  /** Role of the calling token (ADMIN or VIEWER). */
  viewerRole: Scalars["String"]["output"];
};

export type QueryBillingPeriodArgs = {
  id: Scalars["Int"]["input"];
};

export type QueryBillingPeriodsArgs = {
  after: InputMaybe<Scalars["String"]["input"]>;
  first?: Scalars["Int"]["input"];
};

export type QueryCalculationRunsArgs = {
  after: InputMaybe<Scalars["String"]["input"]>;
  first?: Scalars["Int"]["input"];
};

export type QueryDataExclusionsArgs = {
  first?: Scalars["Int"]["input"];
};

export type QueryDataQualityEventsArgs = {
  after: InputMaybe<Scalars["String"]["input"]>;
  first?: InputMaybe<Scalars["Int"]["input"]>;
  from: Scalars["DateTime"]["input"];
  kinds: InputMaybe<Array<Scalars["String"]["input"]>>;
  to: Scalars["DateTime"]["input"];
};

export type QueryEnergyTotalsArgs = {
  fromDate: Scalars["LocalDate"]["input"];
  granularity: Granularity;
  tariffId: InputMaybe<Scalars["Int"]["input"]>;
  toDate: Scalars["LocalDate"]["input"];
};

export type QueryMeterReadingsArgs = {
  after: InputMaybe<Scalars["String"]["input"]>;
  first?: Scalars["Int"]["input"];
};

export type QueryPowerSeriesArgs = {
  from: Scalars["DateTime"]["input"];
  maxPoints?: Scalars["Int"]["input"];
  metrics: Array<PowerMetric>;
  to: Scalars["DateTime"]["input"];
};

export type QueryReconciliationArgs = {
  fromReadingId: Scalars["Int"]["input"];
  toReadingId: Scalars["Int"]["input"];
};

export type QueryTariffHolidaysArgs = {
  tariffId: Scalars["Int"]["input"];
  year: Scalars["Int"]["input"];
};

export type QueryTariffMonthlyRatesArgs = {
  tariffId: Scalars["Int"]["input"];
};

export type Reconciliation = {
  __typename?: "Reconciliation";
  candidates: Array<ReconciliationCandidate>;
  fromReadingId: Scalars["Int"]["output"];
  investigationPath: Array<Scalars["String"]["output"]>;
  toReadingId: Scalars["Int"]["output"];
};

export type ReconciliationCandidate = {
  __typename?: "ReconciliationCandidate";
  coverage: Scalars["Decimal"]["output"];
  export: ReconciliationDirection;
  import: ReconciliationDirection;
  source: Scalars["String"]["output"];
};

export type ReconciliationDirection = {
  __typename?: "ReconciliationDirection";
  oursKwh: Maybe<Scalars["Decimal"]["output"]>;
  ratio: Maybe<Scalars["Decimal"]["output"]>;
  utilityKwh: Maybe<Scalars["Decimal"]["output"]>;
  verdict: Scalars["String"]["output"];
};

export type SeriesPoint = {
  __typename?: "SeriesPoint";
  avg: Maybe<Scalars["Int"]["output"]>;
  coverage: Scalars["Decimal"]["output"];
  max: Maybe<Scalars["Int"]["output"]>;
  min: Maybe<Scalars["Int"]["output"]>;
  t: Scalars["DateTime"]["output"];
};

export type Tariff = {
  __typename?: "Tariff";
  currency: Scalars["String"]["output"];
  id: Scalars["Int"]["output"];
  name: Scalars["String"]["output"];
  timezone: Scalars["String"]["output"];
  versions: Array<TariffVersion>;
};

export type TariffHoliday = {
  __typename?: "TariffHoliday";
  date: Scalars["LocalDate"]["output"];
  name: Scalars["String"]["output"];
  tariffId: Scalars["Int"]["output"];
};

export type TariffInput = {
  currency: Scalars["String"]["input"];
  name: Scalars["String"]["input"];
  timezone: Scalars["String"]["input"];
};

export type TariffMonthlyRate = {
  __typename?: "TariffMonthlyRate";
  componentCode: Scalars["String"]["output"];
  month: Scalars["String"]["output"];
  ratePerKwh: Scalars["Decimal"]["output"];
  sourceNote: Scalars["String"]["output"];
  tariffId: Scalars["Int"]["output"];
};

export type TariffVersion = {
  __typename?: "TariffVersion";
  billVerified: Scalars["Boolean"]["output"];
  effectiveFrom: Scalars["LocalDate"]["output"];
  effectiveTo: Maybe<Scalars["LocalDate"]["output"]>;
  id: Scalars["Int"]["output"];
  rules: Scalars["String"]["output"];
  sourceNote: Scalars["String"]["output"];
  tariffId: Scalars["Int"]["output"];
};

export type TimeRange = {
  __typename?: "TimeRange";
  from: Scalars["DateTime"]["output"];
  to: Scalars["DateTime"]["output"];
};

export enum ValueStatus {
  Ok = "OK",
  Partial = "PARTIAL",
  Stale = "STALE",
  Unavailable = "UNAVAILABLE",
}

export type VendorComparison = {
  __typename?: "VendorComparison";
  /** Last minus first raw lifetime readings within the range; unvalidated, not ledger energy. */
  intervalDelta: VendorQuantities;
  /** Last raw lifetime readings in the range; includes pre-monitoring energy and is unvalidated. */
  lifetime: VendorQuantities;
  vendorToday: VendorQuantities;
};

export type VendorQuantities = {
  __typename?: "VendorQuantities";
  batteryCharge: VendorValue;
  batteryDischarge: VendorValue;
  consumption: VendorValue;
  gridExport: VendorValue;
  gridImport: VendorValue;
  solar: VendorValue;
};

export type VendorValue = {
  __typename?: "VendorValue";
  kwh: Maybe<Scalars["Decimal"]["output"]>;
  provenance: Provenance;
};

export type WindowEnergy = {
  __typename?: "WindowEnergy";
  exportKwh: EnergyValue;
  importKwh: EnergyValue;
  window: Scalars["String"]["output"];
};

export type PowerFieldsFragment = {
  __typename?: "PowerValue";
  watts: number | null;
  status: ValueStatus;
  reason: string | null;
};

export type EnergyFieldsFragment = {
  __typename?: "EnergyValue";
  kwh: any | null;
  coverage: any;
  flags: Array<string>;
  provenance: Provenance;
  source: string;
  status: ValueStatus;
  validated: boolean;
};

export type VendorFieldsFragment = {
  __typename?: "VendorQuantities";
  solar: {
    __typename?: "VendorValue";
    kwh: any | null;
    provenance: Provenance;
  };
  consumption: {
    __typename?: "VendorValue";
    kwh: any | null;
    provenance: Provenance;
  };
  gridImport: {
    __typename?: "VendorValue";
    kwh: any | null;
    provenance: Provenance;
  };
  gridExport: {
    __typename?: "VendorValue";
    kwh: any | null;
    provenance: Provenance;
  };
  batteryCharge: {
    __typename?: "VendorValue";
    kwh: any | null;
    provenance: Provenance;
  };
  batteryDischarge: {
    __typename?: "VendorValue";
    kwh: any | null;
    provenance: Provenance;
  };
};

export type EnergyRowFieldsFragment = {
  __typename?: "EnergyRow";
  periodStart: any;
  periodEnd: any;
  solar: {
    __typename?: "EnergyValue";
    kwh: any | null;
    coverage: any;
    flags: Array<string>;
    provenance: Provenance;
    source: string;
    status: ValueStatus;
    validated: boolean;
  };
  consumption: {
    __typename?: "EnergyValue";
    kwh: any | null;
    coverage: any;
    flags: Array<string>;
    provenance: Provenance;
    source: string;
    status: ValueStatus;
    validated: boolean;
  };
  gridImport: {
    __typename?: "EnergyValue";
    kwh: any | null;
    coverage: any;
    flags: Array<string>;
    provenance: Provenance;
    source: string;
    status: ValueStatus;
    validated: boolean;
  };
  gridExport: {
    __typename?: "EnergyValue";
    kwh: any | null;
    coverage: any;
    flags: Array<string>;
    provenance: Provenance;
    source: string;
    status: ValueStatus;
    validated: boolean;
  };
  batteryCharge: {
    __typename?: "EnergyValue";
    kwh: any | null;
    coverage: any;
    flags: Array<string>;
    provenance: Provenance;
    source: string;
    status: ValueStatus;
    validated: boolean;
  };
  batteryDischarge: {
    __typename?: "EnergyValue";
    kwh: any | null;
    coverage: any;
    flags: Array<string>;
    provenance: Provenance;
    source: string;
    status: ValueStatus;
    validated: boolean;
  };
  gridByWindow: Array<{
    __typename?: "WindowEnergy";
    window: string;
    importKwh: {
      __typename?: "EnergyValue";
      kwh: any | null;
      coverage: any;
      flags: Array<string>;
      provenance: Provenance;
      source: string;
      status: ValueStatus;
      validated: boolean;
    };
    exportKwh: {
      __typename?: "EnergyValue";
      kwh: any | null;
      coverage: any;
      flags: Array<string>;
      provenance: Provenance;
      source: string;
      status: ValueStatus;
      validated: boolean;
    };
  }>;
  vendor: {
    __typename?: "VendorComparison";
    lifetime: {
      __typename?: "VendorQuantities";
      solar: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      consumption: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      gridImport: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      gridExport: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      batteryCharge: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      batteryDischarge: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
    };
    intervalDelta: {
      __typename?: "VendorQuantities";
      solar: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      consumption: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      gridImport: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      gridExport: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      batteryCharge: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      batteryDischarge: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
    };
    vendorToday: {
      __typename?: "VendorQuantities";
      solar: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      consumption: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      gridImport: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      gridExport: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      batteryCharge: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
      batteryDischarge: {
        __typename?: "VendorValue";
        kwh: any | null;
        provenance: Provenance;
      };
    };
  };
};

export type PeriodFieldsFragment = {
  __typename?: "BillingPeriod";
  id: number;
  startDate: any;
  endDate: any;
  tariffId: number;
  note: string | null;
  stale: boolean;
  result: {
    __typename?: "BillingPeriodResult";
    coverage: any;
    isLowerBound: boolean;
    reasons: Array<string>;
    status: BillingStatus;
    subtotal: any | null;
    total: any | null;
    lineItems: Array<{
      __typename?: "LineItem";
      amount: any | null;
      code: string;
      kind: string;
      label: string;
      note: string | null;
      quantityKwh: any | null;
      rate: any | null;
      segment: number;
      status: string;
    }>;
    nem: {
      __typename?: "NemState";
      openingLots: Array<{
        __typename?: "CreditLot";
        kwh: any;
        originStart: any;
      }>;
      closingLots: Array<{
        __typename?: "CreditLot";
        kwh: any;
        originStart: any;
      }>;
      expiredLots: Array<{
        __typename?: "CreditLot";
        kwh: any;
        originStart: any;
      }>;
    } | null;
  } | null;
};

export type PolicyFieldsFragment = {
  __typename?: "AccountingPolicy";
  version: number;
  effectiveFrom: any;
  gridSource: string;
  pvSource: string;
  batterySource: string;
  loadSource: string;
  maxGapSec: number;
  note: string;
  validated: string;
  createdAt: any;
  supersededByVersion: number | null;
};

export type RunFieldsFragment = {
  __typename?: "CalculationRun";
  id: number;
  kind: string;
  reason: string;
  status: string;
  error: string | null;
  startedAt: any;
  finishedAt: any | null;
  rangeStart: any;
  rangeEnd: any;
  mappingVersion: number;
  calcVersion: number;
  outsideRetentionBefore: any | null;
};

export type MeterFieldsFragment = {
  __typename?: "MeterReading";
  id: number;
  readAt: any;
  source: MeterReadingSource;
  importKwh: any;
  exportKwh: any | null;
  importPeakKwh: any | null;
  importOffpeakKwh: any | null;
  resolutionKwh: any;
  note: string | null;
  createdAt: any;
};

export type TariffFieldsFragment = {
  __typename?: "Tariff";
  id: number;
  name: string;
  currency: string;
  timezone: string;
  versions: Array<{
    __typename?: "TariffVersion";
    id: number;
    effectiveFrom: any;
    effectiveTo: any | null;
    rules: string;
    sourceNote: string;
    billVerified: boolean;
    tariffId: number;
  }>;
};

export type LiveStatusQueryVariables = Exact<{ [key: string]: never }>;

export type LiveStatusQuery = {
  __typename?: "Query";
  liveStatus: {
    __typename?: "LiveStatus";
    serverTime: any;
    observedAt: any | null;
    ageSeconds: number | null;
    freshness: Freshness;
    accountingStatus: AccountingStatus;
    activeFaults: Array<string>;
    batterySoc: number | null;
    batteryState: string | null;
    meterLink: string | null;
    battery: {
      __typename?: "PowerValue";
      watts: number | null;
      status: ValueStatus;
      reason: string | null;
    };
    grid: {
      __typename?: "PowerValue";
      watts: number | null;
      status: ValueStatus;
      reason: string | null;
    };
    load: {
      __typename?: "PowerValue";
      watts: number | null;
      status: ValueStatus;
      reason: string | null;
    };
    loadVendor: {
      __typename?: "PowerValue";
      watts: number | null;
      status: ValueStatus;
      reason: string | null;
    };
    pv: {
      __typename?: "PowerValue";
      watts: number | null;
      status: ValueStatus;
      reason: string | null;
    };
    gridPhases: Array<{
      __typename?: "PowerValue";
      watts: number | null;
      status: ValueStatus;
      reason: string | null;
    }>;
    pvStrings: Array<{
      __typename?: "PowerValue";
      watts: number | null;
      status: ValueStatus;
      reason: string | null;
    }>;
    operatingMode: {
      __typename?: "OperatingMode";
      code: number;
      label: string;
      observedAt: any;
    } | null;
  };
};

export type CollectorStatusQueryVariables = Exact<{ [key: string]: never }>;

export type CollectorStatusQuery = {
  __typename?: "Query";
  collectorStatus: {
    __typename?: "CollectorStatus";
    acquisitionSource: string;
    calcVersion: number;
    consecutiveFailures: number;
    lastBackupAt: any | null;
    lastError: string | null;
    lastErrorAt: any | null;
    lastSuccessAt: any | null;
    mappingVersion: number;
    monitoringSince: any | null;
    nextRetryAt: any | null;
    policyVersion: number;
    siteTimezone: string;
    state: string;
    tlsCertExpiresAt: any;
    device: {
      __typename?: "Device";
      id: number;
      deviceKey: string;
      firstSeenAt: any;
      lastSeenAt: any;
      model: string;
      retiredAt: any | null;
    } | null;
  };
};

export type EnergyTotalsQueryVariables = Exact<{
  fromDate: Scalars["LocalDate"]["input"];
  toDate: Scalars["LocalDate"]["input"];
  granularity: Granularity;
  tariffId: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type EnergyTotalsQuery = {
  __typename?: "Query";
  energyTotals: {
    __typename?: "EnergyTotals";
    lastSourceUpdate: any | null;
    monitoringSince: any | null;
    preMonitoringExcluded: boolean;
    rows: Array<{
      __typename?: "EnergyRow";
      periodStart: any;
      periodEnd: any;
      solar: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      consumption: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      gridImport: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      gridExport: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      batteryCharge: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      batteryDischarge: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      gridByWindow: Array<{
        __typename?: "WindowEnergy";
        window: string;
        importKwh: {
          __typename?: "EnergyValue";
          kwh: any | null;
          coverage: any;
          flags: Array<string>;
          provenance: Provenance;
          source: string;
          status: ValueStatus;
          validated: boolean;
        };
        exportKwh: {
          __typename?: "EnergyValue";
          kwh: any | null;
          coverage: any;
          flags: Array<string>;
          provenance: Provenance;
          source: string;
          status: ValueStatus;
          validated: boolean;
        };
      }>;
      vendor: {
        __typename?: "VendorComparison";
        lifetime: {
          __typename?: "VendorQuantities";
          solar: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          consumption: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridImport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridExport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryCharge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryDischarge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
        };
        intervalDelta: {
          __typename?: "VendorQuantities";
          solar: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          consumption: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridImport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridExport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryCharge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryDischarge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
        };
        vendorToday: {
          __typename?: "VendorQuantities";
          solar: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          consumption: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridImport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridExport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryCharge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryDischarge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
        };
      };
    }>;
    total: {
      __typename?: "EnergyRow";
      periodStart: any;
      periodEnd: any;
      solar: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      consumption: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      gridImport: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      gridExport: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      batteryCharge: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      batteryDischarge: {
        __typename?: "EnergyValue";
        kwh: any | null;
        coverage: any;
        flags: Array<string>;
        provenance: Provenance;
        source: string;
        status: ValueStatus;
        validated: boolean;
      };
      gridByWindow: Array<{
        __typename?: "WindowEnergy";
        window: string;
        importKwh: {
          __typename?: "EnergyValue";
          kwh: any | null;
          coverage: any;
          flags: Array<string>;
          provenance: Provenance;
          source: string;
          status: ValueStatus;
          validated: boolean;
        };
        exportKwh: {
          __typename?: "EnergyValue";
          kwh: any | null;
          coverage: any;
          flags: Array<string>;
          provenance: Provenance;
          source: string;
          status: ValueStatus;
          validated: boolean;
        };
      }>;
      vendor: {
        __typename?: "VendorComparison";
        lifetime: {
          __typename?: "VendorQuantities";
          solar: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          consumption: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridImport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridExport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryCharge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryDischarge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
        };
        intervalDelta: {
          __typename?: "VendorQuantities";
          solar: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          consumption: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridImport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridExport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryCharge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryDischarge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
        };
        vendorToday: {
          __typename?: "VendorQuantities";
          solar: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          consumption: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridImport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          gridExport: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryCharge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
          batteryDischarge: {
            __typename?: "VendorValue";
            kwh: any | null;
            provenance: Provenance;
          };
        };
      };
    };
  };
};

export type PowerSeriesQueryVariables = Exact<{
  from: Scalars["DateTime"]["input"];
  to: Scalars["DateTime"]["input"];
  metrics: Array<PowerMetric> | PowerMetric;
  maxPoints?: InputMaybe<Scalars["Int"]["input"]>;
}>;

export type PowerSeriesQuery = {
  __typename?: "Query";
  powerSeries: {
    __typename?: "PowerSeries";
    bucketSeconds: number;
    gaps: Array<{ __typename?: "TimeRange"; from: any; to: any }>;
    series: Array<{
      __typename?: "MetricSeries";
      metric: PowerMetric;
      points: Array<{
        __typename?: "SeriesPoint";
        t: any;
        avg: number | null;
        min: number | null;
        max: number | null;
        coverage: any;
      }>;
    }>;
  };
};

export type DataQualityEventsQueryVariables = Exact<{
  from: Scalars["DateTime"]["input"];
  to: Scalars["DateTime"]["input"];
  kinds: InputMaybe<
    Array<Scalars["String"]["input"]> | Scalars["String"]["input"]
  >;
  first?: InputMaybe<Scalars["Int"]["input"]>;
  after: InputMaybe<Scalars["String"]["input"]>;
}>;

export type DataQualityEventsQuery = {
  __typename?: "Query";
  dataQualityEvents: {
    __typename?: "DataQualityEventConnection";
    edges: Array<{
      __typename?: "DataQualityEventEdge";
      cursor: string;
      node: {
        __typename?: "DataQualityEvent";
        id: string;
        kind: string;
        startedAt: any;
        endedAt: any | null;
        createdAt: any;
        deviceId: number | null;
      };
    }>;
    pageInfo: {
      __typename?: "PageInfo";
      endCursor: string | null;
      hasNextPage: boolean;
    };
  };
};

export type DevicesQueryVariables = Exact<{ [key: string]: never }>;

export type DevicesQuery = {
  __typename?: "Query";
  devices: Array<{
    __typename?: "Device";
    id: number;
    deviceKey: string;
    firstSeenAt: any;
    lastSeenAt: any;
    model: string;
    retiredAt: any | null;
  }>;
};

export type ViewerRoleQueryVariables = Exact<{ [key: string]: never }>;

export type ViewerRoleQuery = { __typename?: "Query"; viewerRole: string };

export type TariffsQueryVariables = Exact<{ [key: string]: never }>;

export type TariffsQuery = {
  __typename?: "Query";
  tariffs: Array<{
    __typename?: "Tariff";
    id: number;
    name: string;
    currency: string;
    timezone: string;
    versions: Array<{
      __typename?: "TariffVersion";
      id: number;
      effectiveFrom: any;
      effectiveTo: any | null;
      rules: string;
      sourceNote: string;
      billVerified: boolean;
      tariffId: number;
    }>;
  }>;
};

export type TariffHolidaysQueryVariables = Exact<{
  tariffId: Scalars["Int"]["input"];
  year: Scalars["Int"]["input"];
}>;

export type TariffHolidaysQuery = {
  __typename?: "Query";
  tariffHolidays: Array<{
    __typename?: "TariffHoliday";
    date: any;
    name: string;
    tariffId: number;
  }>;
};

export type TariffMonthlyRatesQueryVariables = Exact<{
  tariffId: Scalars["Int"]["input"];
}>;

export type TariffMonthlyRatesQuery = {
  __typename?: "Query";
  tariffMonthlyRates: Array<{
    __typename?: "TariffMonthlyRate";
    componentCode: string;
    month: string;
    ratePerKwh: any;
    sourceNote: string;
    tariffId: number;
  }>;
};

export type DataExclusionsQueryVariables = Exact<{
  first?: Scalars["Int"]["input"];
}>;

export type DataExclusionsQuery = {
  __typename?: "Query";
  dataExclusions: Array<{
    __typename?: "DataExclusion";
    id: number;
    from: any;
    to: any;
    families: Array<string>;
    reason: string;
    createdAt: any;
    createdBy: string;
  }>;
};

export type BillingPeriodsQueryVariables = Exact<{
  first?: Scalars["Int"]["input"];
  after: InputMaybe<Scalars["String"]["input"]>;
}>;

export type BillingPeriodsQuery = {
  __typename?: "Query";
  billingPeriods: {
    __typename?: "BillingPeriodConnection";
    edges: Array<{
      __typename?: "BillingPeriodEdge";
      cursor: string;
      node: {
        __typename?: "BillingPeriod";
        id: number;
        startDate: any;
        endDate: any;
        tariffId: number;
        note: string | null;
        stale: boolean;
        result: {
          __typename?: "BillingPeriodResult";
          coverage: any;
          isLowerBound: boolean;
          reasons: Array<string>;
          status: BillingStatus;
          subtotal: any | null;
          total: any | null;
          lineItems: Array<{
            __typename?: "LineItem";
            amount: any | null;
            code: string;
            kind: string;
            label: string;
            note: string | null;
            quantityKwh: any | null;
            rate: any | null;
            segment: number;
            status: string;
          }>;
          nem: {
            __typename?: "NemState";
            openingLots: Array<{
              __typename?: "CreditLot";
              kwh: any;
              originStart: any;
            }>;
            closingLots: Array<{
              __typename?: "CreditLot";
              kwh: any;
              originStart: any;
            }>;
            expiredLots: Array<{
              __typename?: "CreditLot";
              kwh: any;
              originStart: any;
            }>;
          } | null;
        } | null;
      };
    }>;
    pageInfo: {
      __typename?: "PageInfo";
      endCursor: string | null;
      hasNextPage: boolean;
    };
  };
};

export type BillingPeriodQueryVariables = Exact<{
  id: Scalars["Int"]["input"];
}>;

export type BillingPeriodQuery = {
  __typename?: "Query";
  billingPeriod: {
    __typename?: "BillingPeriod";
    id: number;
    startDate: any;
    endDate: any;
    tariffId: number;
    note: string | null;
    stale: boolean;
    result: {
      __typename?: "BillingPeriodResult";
      coverage: any;
      isLowerBound: boolean;
      reasons: Array<string>;
      status: BillingStatus;
      subtotal: any | null;
      total: any | null;
      lineItems: Array<{
        __typename?: "LineItem";
        amount: any | null;
        code: string;
        kind: string;
        label: string;
        note: string | null;
        quantityKwh: any | null;
        rate: any | null;
        segment: number;
        status: string;
      }>;
      nem: {
        __typename?: "NemState";
        openingLots: Array<{
          __typename?: "CreditLot";
          kwh: any;
          originStart: any;
        }>;
        closingLots: Array<{
          __typename?: "CreditLot";
          kwh: any;
          originStart: any;
        }>;
        expiredLots: Array<{
          __typename?: "CreditLot";
          kwh: any;
          originStart: any;
        }>;
      } | null;
    } | null;
  } | null;
};

export type MeterReadingsQueryVariables = Exact<{
  first?: Scalars["Int"]["input"];
  after: InputMaybe<Scalars["String"]["input"]>;
}>;

export type MeterReadingsQuery = {
  __typename?: "Query";
  meterReadings: {
    __typename?: "MeterReadingConnection";
    edges: Array<{
      __typename?: "MeterReadingEdge";
      cursor: string;
      node: {
        __typename?: "MeterReading";
        id: number;
        readAt: any;
        source: MeterReadingSource;
        importKwh: any;
        exportKwh: any | null;
        importPeakKwh: any | null;
        importOffpeakKwh: any | null;
        resolutionKwh: any;
        note: string | null;
        createdAt: any;
      };
    }>;
    pageInfo: {
      __typename?: "PageInfo";
      endCursor: string | null;
      hasNextPage: boolean;
    };
  };
};

export type ReconciliationQueryVariables = Exact<{
  fromReadingId: Scalars["Int"]["input"];
  toReadingId: Scalars["Int"]["input"];
}>;

export type ReconciliationQuery = {
  __typename?: "Query";
  reconciliation: {
    __typename?: "Reconciliation";
    fromReadingId: number;
    toReadingId: number;
    investigationPath: Array<string>;
    candidates: Array<{
      __typename?: "ReconciliationCandidate";
      source: string;
      coverage: any;
      import: {
        __typename?: "ReconciliationDirection";
        oursKwh: any | null;
        utilityKwh: any | null;
        ratio: any | null;
        verdict: string;
      };
      export: {
        __typename?: "ReconciliationDirection";
        oursKwh: any | null;
        utilityKwh: any | null;
        ratio: any | null;
        verdict: string;
      };
    }>;
  };
};

export type AccountingPoliciesQueryVariables = Exact<{ [key: string]: never }>;

export type AccountingPoliciesQuery = {
  __typename?: "Query";
  accountingPolicies: Array<{
    __typename?: "AccountingPolicy";
    version: number;
    effectiveFrom: any;
    gridSource: string;
    pvSource: string;
    batterySource: string;
    loadSource: string;
    maxGapSec: number;
    note: string;
    validated: string;
    createdAt: any;
    supersededByVersion: number | null;
  }>;
};

export type CalculationRunsQueryVariables = Exact<{
  first?: Scalars["Int"]["input"];
  after: InputMaybe<Scalars["String"]["input"]>;
}>;

export type CalculationRunsQuery = {
  __typename?: "Query";
  calculationRuns: {
    __typename?: "CalculationRunConnection";
    edges: Array<{
      __typename?: "CalculationRunEdge";
      cursor: string;
      node: {
        __typename?: "CalculationRun";
        id: number;
        kind: string;
        reason: string;
        status: string;
        error: string | null;
        startedAt: any;
        finishedAt: any | null;
        rangeStart: any;
        rangeEnd: any;
        mappingVersion: number;
        calcVersion: number;
        outsideRetentionBefore: any | null;
      };
    }>;
    pageInfo: {
      __typename?: "PageInfo";
      endCursor: string | null;
      hasNextPage: boolean;
    };
  };
};

export type CreateTariffMutationVariables = Exact<{
  input: TariffInput;
}>;

export type CreateTariffMutation = {
  __typename?: "Mutation";
  createTariff: {
    __typename?: "Tariff";
    id: number;
    name: string;
    currency: string;
    timezone: string;
    versions: Array<{
      __typename?: "TariffVersion";
      id: number;
      effectiveFrom: any;
      effectiveTo: any | null;
      rules: string;
      sourceNote: string;
      billVerified: boolean;
      tariffId: number;
    }>;
  };
};

export type CreateTariffVersionMutationVariables = Exact<{
  tariffId: Scalars["Int"]["input"];
  effectiveFrom: Scalars["LocalDate"]["input"];
  effectiveTo: InputMaybe<Scalars["LocalDate"]["input"]>;
  rules: Scalars["String"]["input"];
  sourceNote: Scalars["String"]["input"];
}>;

export type CreateTariffVersionMutation = {
  __typename?: "Mutation";
  createTariffVersion: {
    __typename?: "TariffVersion";
    id: number;
    effectiveFrom: any;
    effectiveTo: any | null;
    rules: string;
    sourceNote: string;
    billVerified: boolean;
    tariffId: number;
  };
};

export type SetTariffHolidaysMutationVariables = Exact<{
  tariffId: Scalars["Int"]["input"];
  year: Scalars["Int"]["input"];
  holidays: Array<HolidayInput> | HolidayInput;
}>;

export type SetTariffHolidaysMutation = {
  __typename?: "Mutation";
  setTariffHolidays: Array<{
    __typename?: "TariffHoliday";
    date: any;
    name: string;
    tariffId: number;
  }>;
};

export type SetMonthlyRateMutationVariables = Exact<{
  tariffId: Scalars["Int"]["input"];
  month: Scalars["String"]["input"];
  componentCode: Scalars["String"]["input"];
  ratePerKwh: Scalars["Decimal"]["input"];
  sourceNote: Scalars["String"]["input"];
}>;

export type SetMonthlyRateMutation = {
  __typename?: "Mutation";
  setMonthlyRate: {
    __typename?: "TariffMonthlyRate";
    tariffId: number;
    month: string;
    componentCode: string;
    ratePerKwh: any;
    sourceNote: string;
  };
};

export type UpsertBillingPeriodMutationVariables = Exact<{
  input: BillingPeriodInput;
}>;

export type UpsertBillingPeriodMutation = {
  __typename?: "Mutation";
  upsertBillingPeriod: {
    __typename?: "BillingPeriod";
    id: number;
    startDate: any;
    endDate: any;
    tariffId: number;
    note: string | null;
    stale: boolean;
    result: {
      __typename?: "BillingPeriodResult";
      coverage: any;
      isLowerBound: boolean;
      reasons: Array<string>;
      status: BillingStatus;
      subtotal: any | null;
      total: any | null;
      lineItems: Array<{
        __typename?: "LineItem";
        amount: any | null;
        code: string;
        kind: string;
        label: string;
        note: string | null;
        quantityKwh: any | null;
        rate: any | null;
        segment: number;
        status: string;
      }>;
      nem: {
        __typename?: "NemState";
        openingLots: Array<{
          __typename?: "CreditLot";
          kwh: any;
          originStart: any;
        }>;
        closingLots: Array<{
          __typename?: "CreditLot";
          kwh: any;
          originStart: any;
        }>;
        expiredLots: Array<{
          __typename?: "CreditLot";
          kwh: any;
          originStart: any;
        }>;
      } | null;
    } | null;
  };
};

export type AddMeterReadingMutationVariables = Exact<{
  input: MeterReadingInput;
}>;

export type AddMeterReadingMutation = {
  __typename?: "Mutation";
  addMeterReading: {
    __typename?: "MeterReading";
    id: number;
    readAt: any;
    source: MeterReadingSource;
    importKwh: any;
    exportKwh: any | null;
    importPeakKwh: any | null;
    importOffpeakKwh: any | null;
    resolutionKwh: any;
    note: string | null;
    createdAt: any;
  };
};

export type DeleteMeterReadingMutationVariables = Exact<{
  id: Scalars["Int"]["input"];
}>;

export type DeleteMeterReadingMutation = {
  __typename?: "Mutation";
  deleteMeterReading: boolean;
};

export type CreateAccountingPolicyMutationVariables = Exact<{
  input: AccountingPolicyInput;
}>;

export type CreateAccountingPolicyMutation = {
  __typename?: "Mutation";
  createAccountingPolicy: {
    __typename?: "AccountingPolicyChange";
    billingPeriodsInvalidated: number;
    outsideRetentionBefore: any | null;
    policy: {
      __typename?: "AccountingPolicy";
      version: number;
      effectiveFrom: any;
      gridSource: string;
      pvSource: string;
      batterySource: string;
      loadSource: string;
      maxGapSec: number;
      note: string;
      validated: string;
      createdAt: any;
      supersededByVersion: number | null;
    };
    calculationRun: {
      __typename?: "CalculationRun";
      id: number;
      kind: string;
      reason: string;
      status: string;
      error: string | null;
      startedAt: any;
      finishedAt: any | null;
      rangeStart: any;
      rangeEnd: any;
      mappingVersion: number;
      calcVersion: number;
      outsideRetentionBefore: any | null;
    } | null;
  };
};

export type CreateDataExclusionMutationVariables = Exact<{
  input: DataExclusionInput;
}>;

export type CreateDataExclusionMutation = {
  __typename?: "Mutation";
  createDataExclusion: {
    __typename?: "DataExclusion";
    id: number;
    from: any;
    to: any;
    families: Array<string>;
    reason: string;
    createdAt: any;
    createdBy: string;
  };
};

export type DeleteDataExclusionMutationVariables = Exact<{
  id: Scalars["Int"]["input"];
}>;

export type DeleteDataExclusionMutation = {
  __typename?: "Mutation";
  deleteDataExclusion: boolean;
};

export const PowerFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "PowerFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "PowerValue" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "watts" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "reason" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<PowerFieldsFragment, unknown>;
export const EnergyFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "EnergyFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "EnergyValue" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "kwh" } },
          { kind: "Field", name: { kind: "Name", value: "coverage" } },
          { kind: "Field", name: { kind: "Name", value: "flags" } },
          { kind: "Field", name: { kind: "Name", value: "provenance" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "validated" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<EnergyFieldsFragment, unknown>;
export const VendorFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "VendorFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "VendorQuantities" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "solar" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "consumption" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridImport" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridExport" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "batteryCharge" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "batteryDischarge" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<VendorFieldsFragment, unknown>;
export const EnergyRowFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "EnergyRowFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "EnergyRow" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "periodStart" } },
          { kind: "Field", name: { kind: "Name", value: "periodEnd" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "solar" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "consumption" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridImport" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridExport" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "batteryCharge" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "batteryDischarge" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridByWindow" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "window" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "importKwh" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "EnergyFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "exportKwh" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "EnergyFields" },
                      },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "vendor" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lifetime" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "VendorFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "intervalDelta" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "VendorFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "vendorToday" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "VendorFields" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "EnergyFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "EnergyValue" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "kwh" } },
          { kind: "Field", name: { kind: "Name", value: "coverage" } },
          { kind: "Field", name: { kind: "Name", value: "flags" } },
          { kind: "Field", name: { kind: "Name", value: "provenance" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "validated" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "VendorFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "VendorQuantities" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "solar" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "consumption" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridImport" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridExport" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "batteryCharge" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "batteryDischarge" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<EnergyRowFieldsFragment, unknown>;
export const PeriodFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "PeriodFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "BillingPeriod" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "startDate" } },
          { kind: "Field", name: { kind: "Name", value: "endDate" } },
          { kind: "Field", name: { kind: "Name", value: "tariffId" } },
          { kind: "Field", name: { kind: "Name", value: "note" } },
          { kind: "Field", name: { kind: "Name", value: "stale" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "result" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "coverage" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "isLowerBound" },
                },
                { kind: "Field", name: { kind: "Name", value: "reasons" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "subtotal" } },
                { kind: "Field", name: { kind: "Name", value: "total" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lineItems" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "amount" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "code" } },
                      { kind: "Field", name: { kind: "Name", value: "kind" } },
                      { kind: "Field", name: { kind: "Name", value: "label" } },
                      { kind: "Field", name: { kind: "Name", value: "note" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "quantityKwh" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "rate" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "segment" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "status" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "nem" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "openingLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "closingLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "expiredLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<PeriodFieldsFragment, unknown>;
export const PolicyFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "PolicyFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "AccountingPolicy" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "effectiveFrom" } },
          { kind: "Field", name: { kind: "Name", value: "gridSource" } },
          { kind: "Field", name: { kind: "Name", value: "pvSource" } },
          { kind: "Field", name: { kind: "Name", value: "batterySource" } },
          { kind: "Field", name: { kind: "Name", value: "loadSource" } },
          { kind: "Field", name: { kind: "Name", value: "maxGapSec" } },
          { kind: "Field", name: { kind: "Name", value: "note" } },
          { kind: "Field", name: { kind: "Name", value: "validated" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "supersededByVersion" },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<PolicyFieldsFragment, unknown>;
export const RunFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "RunFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "CalculationRun" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "kind" } },
          { kind: "Field", name: { kind: "Name", value: "reason" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "error" } },
          { kind: "Field", name: { kind: "Name", value: "startedAt" } },
          { kind: "Field", name: { kind: "Name", value: "finishedAt" } },
          { kind: "Field", name: { kind: "Name", value: "rangeStart" } },
          { kind: "Field", name: { kind: "Name", value: "rangeEnd" } },
          { kind: "Field", name: { kind: "Name", value: "mappingVersion" } },
          { kind: "Field", name: { kind: "Name", value: "calcVersion" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "outsideRetentionBefore" },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<RunFieldsFragment, unknown>;
export const MeterFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "MeterFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "MeterReading" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "readAt" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "importKwh" } },
          { kind: "Field", name: { kind: "Name", value: "exportKwh" } },
          { kind: "Field", name: { kind: "Name", value: "importPeakKwh" } },
          { kind: "Field", name: { kind: "Name", value: "importOffpeakKwh" } },
          { kind: "Field", name: { kind: "Name", value: "resolutionKwh" } },
          { kind: "Field", name: { kind: "Name", value: "note" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MeterFieldsFragment, unknown>;
export const TariffFieldsFragmentDoc = {
  kind: "Document",
  definitions: [
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "TariffFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Tariff" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "currency" } },
          { kind: "Field", name: { kind: "Name", value: "timezone" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "versions" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "effectiveFrom" },
                },
                { kind: "Field", name: { kind: "Name", value: "effectiveTo" } },
                { kind: "Field", name: { kind: "Name", value: "rules" } },
                { kind: "Field", name: { kind: "Name", value: "sourceNote" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "billVerified" },
                },
                { kind: "Field", name: { kind: "Name", value: "tariffId" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<TariffFieldsFragment, unknown>;
export const LiveStatusDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "LiveStatus" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "liveStatus" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "serverTime" } },
                { kind: "Field", name: { kind: "Name", value: "observedAt" } },
                { kind: "Field", name: { kind: "Name", value: "ageSeconds" } },
                { kind: "Field", name: { kind: "Name", value: "freshness" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "accountingStatus" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "activeFaults" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "battery" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "PowerFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "grid" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "PowerFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "load" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "PowerFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "loadVendor" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "PowerFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "pv" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "PowerFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "gridPhases" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "PowerFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "pvStrings" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "PowerFields" },
                      },
                    ],
                  },
                },
                { kind: "Field", name: { kind: "Name", value: "batterySoc" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "batteryState" },
                },
                { kind: "Field", name: { kind: "Name", value: "meterLink" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "operatingMode" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "code" } },
                      { kind: "Field", name: { kind: "Name", value: "label" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "observedAt" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "PowerFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "PowerValue" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "watts" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "reason" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<LiveStatusQuery, LiveStatusQueryVariables>;
export const CollectorStatusDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "CollectorStatus" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "collectorStatus" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "acquisitionSource" },
                },
                { kind: "Field", name: { kind: "Name", value: "calcVersion" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "consecutiveFailures" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lastBackupAt" },
                },
                { kind: "Field", name: { kind: "Name", value: "lastError" } },
                { kind: "Field", name: { kind: "Name", value: "lastErrorAt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lastSuccessAt" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "mappingVersion" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "monitoringSince" },
                },
                { kind: "Field", name: { kind: "Name", value: "nextRetryAt" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "policyVersion" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "siteTimezone" },
                },
                { kind: "Field", name: { kind: "Name", value: "state" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "tlsCertExpiresAt" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "device" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "id" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "deviceKey" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "firstSeenAt" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "lastSeenAt" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "model" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "retiredAt" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CollectorStatusQuery,
  CollectorStatusQueryVariables
>;
export const EnergyTotalsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "EnergyTotals" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "fromDate" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "LocalDate" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "toDate" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "LocalDate" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "granularity" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Granularity" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tariffId" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "energyTotals" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "fromDate" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "fromDate" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "toDate" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "toDate" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "granularity" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "granularity" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "tariffId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tariffId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lastSourceUpdate" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "monitoringSince" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "preMonitoringExcluded" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "rows" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "EnergyRowFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "total" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "EnergyRowFields" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "EnergyFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "EnergyValue" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "kwh" } },
          { kind: "Field", name: { kind: "Name", value: "coverage" } },
          { kind: "Field", name: { kind: "Name", value: "flags" } },
          { kind: "Field", name: { kind: "Name", value: "provenance" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "validated" } },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "VendorFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "VendorQuantities" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "solar" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "consumption" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridImport" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridExport" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "batteryCharge" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "batteryDischarge" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "kwh" } },
                { kind: "Field", name: { kind: "Name", value: "provenance" } },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "EnergyRowFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "EnergyRow" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "periodStart" } },
          { kind: "Field", name: { kind: "Name", value: "periodEnd" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "solar" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "consumption" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridImport" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridExport" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "batteryCharge" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "batteryDischarge" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "EnergyFields" },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "gridByWindow" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "window" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "importKwh" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "EnergyFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "exportKwh" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "EnergyFields" },
                      },
                    ],
                  },
                },
              ],
            },
          },
          {
            kind: "Field",
            name: { kind: "Name", value: "vendor" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lifetime" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "VendorFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "intervalDelta" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "VendorFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "vendorToday" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "VendorFields" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<EnergyTotalsQuery, EnergyTotalsQueryVariables>;
export const PowerSeriesDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "PowerSeries" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "from" } },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "DateTime" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "to" } },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "DateTime" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "metrics" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "ListType",
              type: {
                kind: "NonNullType",
                type: {
                  kind: "NamedType",
                  name: { kind: "Name", value: "PowerMetric" },
                },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "maxPoints" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          defaultValue: { kind: "IntValue", value: "1000" },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "powerSeries" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "from" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "from" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "to" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "to" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "metrics" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "metrics" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "maxPoints" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "maxPoints" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "bucketSeconds" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "gaps" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      { kind: "Field", name: { kind: "Name", value: "from" } },
                      { kind: "Field", name: { kind: "Name", value: "to" } },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "series" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "metric" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "points" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "t" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "avg" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "min" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "max" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "coverage" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<PowerSeriesQuery, PowerSeriesQueryVariables>;
export const DataQualityEventsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "DataQualityEvents" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "from" } },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "DateTime" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "to" } },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "DateTime" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "kinds" },
          },
          type: {
            kind: "ListType",
            type: {
              kind: "NonNullType",
              type: {
                kind: "NamedType",
                name: { kind: "Name", value: "String" },
              },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "first" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          defaultValue: { kind: "IntValue", value: "100" },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "after" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "dataQualityEvents" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "from" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "from" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "to" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "to" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "kinds" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "kinds" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "first" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "first" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "after" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "after" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "edges" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "cursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "node" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "id" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kind" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "startedAt" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "endedAt" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "createdAt" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "deviceId" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "pageInfo" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "endCursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "hasNextPage" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  DataQualityEventsQuery,
  DataQualityEventsQueryVariables
>;
export const DevicesDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Devices" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "devices" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "deviceKey" } },
                { kind: "Field", name: { kind: "Name", value: "firstSeenAt" } },
                { kind: "Field", name: { kind: "Name", value: "lastSeenAt" } },
                { kind: "Field", name: { kind: "Name", value: "model" } },
                { kind: "Field", name: { kind: "Name", value: "retiredAt" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<DevicesQuery, DevicesQueryVariables>;
export const ViewerRoleDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "ViewerRole" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "viewerRole" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ViewerRoleQuery, ViewerRoleQueryVariables>;
export const TariffsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Tariffs" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "tariffs" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "TariffFields" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "TariffFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Tariff" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "currency" } },
          { kind: "Field", name: { kind: "Name", value: "timezone" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "versions" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "effectiveFrom" },
                },
                { kind: "Field", name: { kind: "Name", value: "effectiveTo" } },
                { kind: "Field", name: { kind: "Name", value: "rules" } },
                { kind: "Field", name: { kind: "Name", value: "sourceNote" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "billVerified" },
                },
                { kind: "Field", name: { kind: "Name", value: "tariffId" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<TariffsQuery, TariffsQueryVariables>;
export const TariffHolidaysDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "TariffHolidays" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tariffId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "year" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "tariffHolidays" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tariffId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tariffId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "year" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "year" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "date" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "tariffId" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<TariffHolidaysQuery, TariffHolidaysQueryVariables>;
export const TariffMonthlyRatesDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "TariffMonthlyRates" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tariffId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "tariffMonthlyRates" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tariffId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tariffId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "componentCode" },
                },
                { kind: "Field", name: { kind: "Name", value: "month" } },
                { kind: "Field", name: { kind: "Name", value: "ratePerKwh" } },
                { kind: "Field", name: { kind: "Name", value: "sourceNote" } },
                { kind: "Field", name: { kind: "Name", value: "tariffId" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  TariffMonthlyRatesQuery,
  TariffMonthlyRatesQueryVariables
>;
export const DataExclusionsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "DataExclusions" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "first" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
          defaultValue: { kind: "IntValue", value: "100" },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "dataExclusions" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "first" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "first" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "from" } },
                { kind: "Field", name: { kind: "Name", value: "to" } },
                { kind: "Field", name: { kind: "Name", value: "families" } },
                { kind: "Field", name: { kind: "Name", value: "reason" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "createdBy" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<DataExclusionsQuery, DataExclusionsQueryVariables>;
export const BillingPeriodsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "BillingPeriods" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "first" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
          defaultValue: { kind: "IntValue", value: "24" },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "after" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "billingPeriods" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "first" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "first" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "after" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "after" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "edges" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "cursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "node" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "FragmentSpread",
                              name: { kind: "Name", value: "PeriodFields" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "pageInfo" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "endCursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "hasNextPage" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "PeriodFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "BillingPeriod" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "startDate" } },
          { kind: "Field", name: { kind: "Name", value: "endDate" } },
          { kind: "Field", name: { kind: "Name", value: "tariffId" } },
          { kind: "Field", name: { kind: "Name", value: "note" } },
          { kind: "Field", name: { kind: "Name", value: "stale" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "result" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "coverage" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "isLowerBound" },
                },
                { kind: "Field", name: { kind: "Name", value: "reasons" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "subtotal" } },
                { kind: "Field", name: { kind: "Name", value: "total" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lineItems" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "amount" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "code" } },
                      { kind: "Field", name: { kind: "Name", value: "kind" } },
                      { kind: "Field", name: { kind: "Name", value: "label" } },
                      { kind: "Field", name: { kind: "Name", value: "note" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "quantityKwh" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "rate" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "segment" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "status" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "nem" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "openingLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "closingLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "expiredLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<BillingPeriodsQuery, BillingPeriodsQueryVariables>;
export const BillingPeriodDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "BillingPeriod" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "billingPeriod" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "PeriodFields" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "PeriodFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "BillingPeriod" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "startDate" } },
          { kind: "Field", name: { kind: "Name", value: "endDate" } },
          { kind: "Field", name: { kind: "Name", value: "tariffId" } },
          { kind: "Field", name: { kind: "Name", value: "note" } },
          { kind: "Field", name: { kind: "Name", value: "stale" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "result" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "coverage" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "isLowerBound" },
                },
                { kind: "Field", name: { kind: "Name", value: "reasons" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "subtotal" } },
                { kind: "Field", name: { kind: "Name", value: "total" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lineItems" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "amount" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "code" } },
                      { kind: "Field", name: { kind: "Name", value: "kind" } },
                      { kind: "Field", name: { kind: "Name", value: "label" } },
                      { kind: "Field", name: { kind: "Name", value: "note" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "quantityKwh" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "rate" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "segment" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "status" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "nem" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "openingLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "closingLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "expiredLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<BillingPeriodQuery, BillingPeriodQueryVariables>;
export const MeterReadingsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "MeterReadings" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "first" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
          defaultValue: { kind: "IntValue", value: "50" },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "after" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "meterReadings" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "first" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "first" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "after" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "after" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "edges" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "cursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "node" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "FragmentSpread",
                              name: { kind: "Name", value: "MeterFields" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "pageInfo" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "endCursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "hasNextPage" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "MeterFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "MeterReading" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "readAt" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "importKwh" } },
          { kind: "Field", name: { kind: "Name", value: "exportKwh" } },
          { kind: "Field", name: { kind: "Name", value: "importPeakKwh" } },
          { kind: "Field", name: { kind: "Name", value: "importOffpeakKwh" } },
          { kind: "Field", name: { kind: "Name", value: "resolutionKwh" } },
          { kind: "Field", name: { kind: "Name", value: "note" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<MeterReadingsQuery, MeterReadingsQueryVariables>;
export const ReconciliationDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "Reconciliation" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "fromReadingId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "toReadingId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "reconciliation" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "fromReadingId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "fromReadingId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "toReadingId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "toReadingId" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "fromReadingId" },
                },
                { kind: "Field", name: { kind: "Name", value: "toReadingId" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "investigationPath" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "candidates" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "source" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "coverage" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "import" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "oursKwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "utilityKwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "ratio" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "verdict" },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "export" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "oursKwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "utilityKwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "ratio" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "verdict" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<ReconciliationQuery, ReconciliationQueryVariables>;
export const AccountingPoliciesDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "AccountingPolicies" },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "accountingPolicies" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "PolicyFields" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "PolicyFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "AccountingPolicy" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "effectiveFrom" } },
          { kind: "Field", name: { kind: "Name", value: "gridSource" } },
          { kind: "Field", name: { kind: "Name", value: "pvSource" } },
          { kind: "Field", name: { kind: "Name", value: "batterySource" } },
          { kind: "Field", name: { kind: "Name", value: "loadSource" } },
          { kind: "Field", name: { kind: "Name", value: "maxGapSec" } },
          { kind: "Field", name: { kind: "Name", value: "note" } },
          { kind: "Field", name: { kind: "Name", value: "validated" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "supersededByVersion" },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AccountingPoliciesQuery,
  AccountingPoliciesQueryVariables
>;
export const CalculationRunsDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "query",
      name: { kind: "Name", value: "CalculationRuns" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "first" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
          defaultValue: { kind: "IntValue", value: "20" },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "after" },
          },
          type: { kind: "NamedType", name: { kind: "Name", value: "String" } },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "calculationRuns" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "first" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "first" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "after" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "after" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "edges" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "cursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "node" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "FragmentSpread",
                              name: { kind: "Name", value: "RunFields" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "pageInfo" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "endCursor" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "hasNextPage" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "RunFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "CalculationRun" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "kind" } },
          { kind: "Field", name: { kind: "Name", value: "reason" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "error" } },
          { kind: "Field", name: { kind: "Name", value: "startedAt" } },
          { kind: "Field", name: { kind: "Name", value: "finishedAt" } },
          { kind: "Field", name: { kind: "Name", value: "rangeStart" } },
          { kind: "Field", name: { kind: "Name", value: "rangeEnd" } },
          { kind: "Field", name: { kind: "Name", value: "mappingVersion" } },
          { kind: "Field", name: { kind: "Name", value: "calcVersion" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "outsideRetentionBefore" },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CalculationRunsQuery,
  CalculationRunsQueryVariables
>;
export const CreateTariffDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CreateTariff" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "TariffInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "createTariff" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "TariffFields" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "TariffFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "Tariff" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "name" } },
          { kind: "Field", name: { kind: "Name", value: "currency" } },
          { kind: "Field", name: { kind: "Name", value: "timezone" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "versions" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "effectiveFrom" },
                },
                { kind: "Field", name: { kind: "Name", value: "effectiveTo" } },
                { kind: "Field", name: { kind: "Name", value: "rules" } },
                { kind: "Field", name: { kind: "Name", value: "sourceNote" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "billVerified" },
                },
                { kind: "Field", name: { kind: "Name", value: "tariffId" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CreateTariffMutation,
  CreateTariffMutationVariables
>;
export const CreateTariffVersionDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CreateTariffVersion" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tariffId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "effectiveFrom" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "LocalDate" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "effectiveTo" },
          },
          type: {
            kind: "NamedType",
            name: { kind: "Name", value: "LocalDate" },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "rules" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "sourceNote" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "createTariffVersion" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tariffId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tariffId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "effectiveFrom" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "effectiveFrom" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "effectiveTo" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "effectiveTo" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "rules" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "rules" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "sourceNote" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "sourceNote" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "effectiveFrom" },
                },
                { kind: "Field", name: { kind: "Name", value: "effectiveTo" } },
                { kind: "Field", name: { kind: "Name", value: "rules" } },
                { kind: "Field", name: { kind: "Name", value: "sourceNote" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "billVerified" },
                },
                { kind: "Field", name: { kind: "Name", value: "tariffId" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CreateTariffVersionMutation,
  CreateTariffVersionMutationVariables
>;
export const SetTariffHolidaysDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "SetTariffHolidays" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tariffId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "year" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "holidays" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "ListType",
              type: {
                kind: "NonNullType",
                type: {
                  kind: "NamedType",
                  name: { kind: "Name", value: "HolidayInput" },
                },
              },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "setTariffHolidays" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tariffId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tariffId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "year" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "year" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "holidays" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "holidays" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "date" } },
                { kind: "Field", name: { kind: "Name", value: "name" } },
                { kind: "Field", name: { kind: "Name", value: "tariffId" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  SetTariffHolidaysMutation,
  SetTariffHolidaysMutationVariables
>;
export const SetMonthlyRateDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "SetMonthlyRate" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "tariffId" },
          },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "month" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "componentCode" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "ratePerKwh" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "Decimal" },
            },
          },
        },
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "sourceNote" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "String" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "setMonthlyRate" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "tariffId" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "tariffId" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "month" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "month" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "componentCode" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "componentCode" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "ratePerKwh" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "ratePerKwh" },
                },
              },
              {
                kind: "Argument",
                name: { kind: "Name", value: "sourceNote" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "sourceNote" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "tariffId" } },
                { kind: "Field", name: { kind: "Name", value: "month" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "componentCode" },
                },
                { kind: "Field", name: { kind: "Name", value: "ratePerKwh" } },
                { kind: "Field", name: { kind: "Name", value: "sourceNote" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  SetMonthlyRateMutation,
  SetMonthlyRateMutationVariables
>;
export const UpsertBillingPeriodDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "UpsertBillingPeriod" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "BillingPeriodInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "upsertBillingPeriod" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "PeriodFields" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "PeriodFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "BillingPeriod" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "startDate" } },
          { kind: "Field", name: { kind: "Name", value: "endDate" } },
          { kind: "Field", name: { kind: "Name", value: "tariffId" } },
          { kind: "Field", name: { kind: "Name", value: "note" } },
          { kind: "Field", name: { kind: "Name", value: "stale" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "result" },
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "coverage" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "isLowerBound" },
                },
                { kind: "Field", name: { kind: "Name", value: "reasons" } },
                { kind: "Field", name: { kind: "Name", value: "status" } },
                { kind: "Field", name: { kind: "Name", value: "subtotal" } },
                { kind: "Field", name: { kind: "Name", value: "total" } },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "lineItems" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "amount" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "code" } },
                      { kind: "Field", name: { kind: "Name", value: "kind" } },
                      { kind: "Field", name: { kind: "Name", value: "label" } },
                      { kind: "Field", name: { kind: "Name", value: "note" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "quantityKwh" },
                      },
                      { kind: "Field", name: { kind: "Name", value: "rate" } },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "segment" },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "status" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "nem" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "openingLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "closingLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                      {
                        kind: "Field",
                        name: { kind: "Name", value: "expiredLots" },
                        selectionSet: {
                          kind: "SelectionSet",
                          selections: [
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "kwh" },
                            },
                            {
                              kind: "Field",
                              name: { kind: "Name", value: "originStart" },
                            },
                          ],
                        },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  UpsertBillingPeriodMutation,
  UpsertBillingPeriodMutationVariables
>;
export const AddMeterReadingDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "AddMeterReading" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "MeterReadingInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "addMeterReading" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "FragmentSpread",
                  name: { kind: "Name", value: "MeterFields" },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "MeterFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "MeterReading" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "readAt" } },
          { kind: "Field", name: { kind: "Name", value: "source" } },
          { kind: "Field", name: { kind: "Name", value: "importKwh" } },
          { kind: "Field", name: { kind: "Name", value: "exportKwh" } },
          { kind: "Field", name: { kind: "Name", value: "importPeakKwh" } },
          { kind: "Field", name: { kind: "Name", value: "importOffpeakKwh" } },
          { kind: "Field", name: { kind: "Name", value: "resolutionKwh" } },
          { kind: "Field", name: { kind: "Name", value: "note" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  AddMeterReadingMutation,
  AddMeterReadingMutationVariables
>;
export const DeleteMeterReadingDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "DeleteMeterReading" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "deleteMeterReading" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  DeleteMeterReadingMutation,
  DeleteMeterReadingMutationVariables
>;
export const CreateAccountingPolicyDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CreateAccountingPolicy" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "AccountingPolicyInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "createAccountingPolicy" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                {
                  kind: "Field",
                  name: { kind: "Name", value: "policy" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "PolicyFields" },
                      },
                    ],
                  },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "billingPeriodsInvalidated" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "outsideRetentionBefore" },
                },
                {
                  kind: "Field",
                  name: { kind: "Name", value: "calculationRun" },
                  selectionSet: {
                    kind: "SelectionSet",
                    selections: [
                      {
                        kind: "FragmentSpread",
                        name: { kind: "Name", value: "RunFields" },
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "PolicyFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "AccountingPolicy" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "version" } },
          { kind: "Field", name: { kind: "Name", value: "effectiveFrom" } },
          { kind: "Field", name: { kind: "Name", value: "gridSource" } },
          { kind: "Field", name: { kind: "Name", value: "pvSource" } },
          { kind: "Field", name: { kind: "Name", value: "batterySource" } },
          { kind: "Field", name: { kind: "Name", value: "loadSource" } },
          { kind: "Field", name: { kind: "Name", value: "maxGapSec" } },
          { kind: "Field", name: { kind: "Name", value: "note" } },
          { kind: "Field", name: { kind: "Name", value: "validated" } },
          { kind: "Field", name: { kind: "Name", value: "createdAt" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "supersededByVersion" },
          },
        ],
      },
    },
    {
      kind: "FragmentDefinition",
      name: { kind: "Name", value: "RunFields" },
      typeCondition: {
        kind: "NamedType",
        name: { kind: "Name", value: "CalculationRun" },
      },
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          { kind: "Field", name: { kind: "Name", value: "id" } },
          { kind: "Field", name: { kind: "Name", value: "kind" } },
          { kind: "Field", name: { kind: "Name", value: "reason" } },
          { kind: "Field", name: { kind: "Name", value: "status" } },
          { kind: "Field", name: { kind: "Name", value: "error" } },
          { kind: "Field", name: { kind: "Name", value: "startedAt" } },
          { kind: "Field", name: { kind: "Name", value: "finishedAt" } },
          { kind: "Field", name: { kind: "Name", value: "rangeStart" } },
          { kind: "Field", name: { kind: "Name", value: "rangeEnd" } },
          { kind: "Field", name: { kind: "Name", value: "mappingVersion" } },
          { kind: "Field", name: { kind: "Name", value: "calcVersion" } },
          {
            kind: "Field",
            name: { kind: "Name", value: "outsideRetentionBefore" },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CreateAccountingPolicyMutation,
  CreateAccountingPolicyMutationVariables
>;
export const CreateDataExclusionDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "CreateDataExclusion" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: {
            kind: "Variable",
            name: { kind: "Name", value: "input" },
          },
          type: {
            kind: "NonNullType",
            type: {
              kind: "NamedType",
              name: { kind: "Name", value: "DataExclusionInput" },
            },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "createDataExclusion" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "input" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "input" },
                },
              },
            ],
            selectionSet: {
              kind: "SelectionSet",
              selections: [
                { kind: "Field", name: { kind: "Name", value: "id" } },
                { kind: "Field", name: { kind: "Name", value: "from" } },
                { kind: "Field", name: { kind: "Name", value: "to" } },
                { kind: "Field", name: { kind: "Name", value: "families" } },
                { kind: "Field", name: { kind: "Name", value: "reason" } },
                { kind: "Field", name: { kind: "Name", value: "createdAt" } },
                { kind: "Field", name: { kind: "Name", value: "createdBy" } },
              ],
            },
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  CreateDataExclusionMutation,
  CreateDataExclusionMutationVariables
>;
export const DeleteDataExclusionDocument = {
  kind: "Document",
  definitions: [
    {
      kind: "OperationDefinition",
      operation: "mutation",
      name: { kind: "Name", value: "DeleteDataExclusion" },
      variableDefinitions: [
        {
          kind: "VariableDefinition",
          variable: { kind: "Variable", name: { kind: "Name", value: "id" } },
          type: {
            kind: "NonNullType",
            type: { kind: "NamedType", name: { kind: "Name", value: "Int" } },
          },
        },
      ],
      selectionSet: {
        kind: "SelectionSet",
        selections: [
          {
            kind: "Field",
            name: { kind: "Name", value: "deleteDataExclusion" },
            arguments: [
              {
                kind: "Argument",
                name: { kind: "Name", value: "id" },
                value: {
                  kind: "Variable",
                  name: { kind: "Name", value: "id" },
                },
              },
            ],
          },
        ],
      },
    },
  ],
} as unknown as DocumentNode<
  DeleteDataExclusionMutation,
  DeleteDataExclusionMutationVariables
>;
