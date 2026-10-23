/**
 * Shared billing contract (plan: Phase 5, Pricing algorithm). Types and constants only.
 * All energy and money inside the pure engine is decimal.js (precision 30); strings at the edges.
 * NOTHING in this module asserts a real TNB rate or rule: rules come from the user's bill.
 */
import type { Decimal } from 'decimal.js';

export const BILLING_CALC_VERSION = 2;
/** Prefix-free reason codes of BillingPeriodResult.reasons (plan Pricing step 6). */
export const BillingReason = {
  COVERAGE_BELOW_99_5: 'COVERAGE_BELOW_99_5',
  MISSING_DATA_DIRECTION_UNKNOWN: 'MISSING_DATA_DIRECTION_UNKNOWN',
  PERIOD_IN_PROGRESS: 'PERIOD_IN_PROGRESS',
  TOU_ALLOCATION_ESTIMATED: 'TOU_ALLOCATION_ESTIMATED',
  HOLIDAY_CALENDAR_MISSING: 'HOLIDAY_CALENDAR_MISSING',
  MONTHLY_RATE_MISSING: 'MONTHLY_RATE_MISSING', // suffixed `:<componentCode>`
  NEM_OPENING_CREDIT_UNKNOWN: 'NEM_OPENING_CREDIT_UNKNOWN',
  NEM_CHAIN_GAP: 'NEM_CHAIN_GAP',
  NEM_OPENING_CREDIT_ESTIMATED: 'NEM_OPENING_CREDIT_ESTIMATED',
  TARIFF_NOT_BILL_VERIFIED: 'TARIFF_NOT_BILL_VERIFIED',
  TARIFF_CHANGED_MID_PERIOD: 'TARIFF_CHANGED_MID_PERIOD',
  TIER_SPLIT_PRO_RATA: 'TIER_SPLIT_PRO_RATA',
  CALC_PARAMS_PARTIAL_RECOMPUTE: 'CALC_PARAMS_PARTIAL_RECOMPUTE',
  ACCOUNTING_UNRECONCILED: 'ACCOUNTING_UNRECONCILED',
  MAPPING_PROVISIONAL: 'MAPPING_PROVISIONAL',
  PRE_MONITORING_DATA_MISSING: 'PRE_MONITORING_DATA_MISSING',
  // UNAVAILABLE-only reasons
  NO_TARIFF_VERSION: 'NO_TARIFF_VERSION',
  COVERAGE_BELOW_80: 'COVERAGE_BELOW_80',
  PERIOD_BEFORE_MONITORING: 'PERIOD_BEFORE_MONITORING',
  VENDOR_DATA_ONLY: 'VENDOR_DATA_ONLY',
} as const;

/**
 * The opening credit bank is not known at all: no anchor/predecessor, or the chain is broken or
 * stale. The engine then applies no credit and a successor inherits the gap.
 */
export const NEM_CREDIT_UNKNOWN_REASONS: readonly string[] = [
  BillingReason.NEM_OPENING_CREDIT_UNKNOWN,
  BillingReason.NEM_CHAIN_GAP,
];
/**
 * The closing credit bank of a NEM period is known but cannot be trusted because the grid data
 * that minted or consumed it is incomplete or provisional: a successor consuming it inherits
 * `NEM_OPENING_CREDIT_ESTIMATED`. Reasons that only touch pricing (ToU allocation, holiday
 * calendar, rates, tier split, bill verification, mid-period tariff change) or are evaluated
 * identically on every period (accounting reconciliation, provisional mapping, in-progress
 * period; a successor of an in-progress period is itself in progress) are deliberately absent.
 * Only an independent `openingCreditLots` anchor or a recomputation with repaired data ends the
 * inheritance.
 */
export const NEM_CREDIT_ESTIMATE_REASONS: readonly string[] = [
  BillingReason.COVERAGE_BELOW_99_5,
  BillingReason.MISSING_DATA_DIRECTION_UNKNOWN,
  BillingReason.PRE_MONITORING_DATA_MISSING,
  BillingReason.CALC_PARAMS_PARTIAL_RECOMPUTE,
  BillingReason.NEM_OPENING_CREDIT_ESTIMATED,
];

export type BillingStatusCode = 'COMPLETE' | 'ESTIMATED' | 'UNAVAILABLE';

/** NEM credit lot; `originStart` (YYYY-MM-DD, the start date of the period that earned it) never changes. */
export interface CreditLot {
  originStart: string;
  kwh: Decimal;
}

/** Opening NEM state handed to the engine. `lots: null` means unknown (reason is then required). */
export interface NemOpening {
  lots: CreditLot[] | null;
  reason?: 'NEM_OPENING_CREDIT_UNKNOWN' | 'NEM_CHAIN_GAP';
  /**
   * `lots` is known but inherited from a predecessor whose closing credit is an estimate. The
   * engine reports `NEM_OPENING_CREDIT_ESTIMATED` for any NEM period that consumes it.
   */
  estimated?: boolean;
}

/** Energy of one sub-period (a billing period split at tariff-version boundaries) per ToU window. */
export interface SegmentQuantities {
  /** Inclusive local dates (YYYY-MM-DD) of the sub-period. */
  startDate: string;
  endDate: string;
  days: number;
  /** One entry per window code that has energy (including the default window). */
  windows: { window: string; importKwh: Decimal; exportKwh: Decimal }[];
  /** Import kWh by calendar month of the bucket (YYYY-MM), for PER_KWH_MONTHLY components. */
  importByMonth: Record<string, Decimal>;
}

export interface MonthlyRateRow {
  componentCode: string;
  month: string;
  ratePerKwh: Decimal;
}

/** Everything the engine needs besides the quantities; the billing service derives these from the DB. */
export interface BillContext {
  /** Whole-period grid coverage in [0,1] (never clipped to monitoringSince). */
  coverage: number;
  periodDays: number;
  /** Local date (YYYY-MM-DD) the period starts: the `originStart` of lots this period creates. */
  periodStartDate: string;
  periodInProgress: boolean;
  /** The period starts before monitoring began (some of it has no data) / lies entirely before it. */
  startsBeforeMonitoring: boolean;
  entirelyBeforeMonitoring: boolean;
  noTariffVersion: boolean;
  vendorDataOnly: boolean;
  holidayCalendarMissing: boolean;
  touAllocationEstimated: boolean;
  accountingUnreconciled: boolean;
  mappingProvisional: boolean;
  calcParamsPartialRecompute: boolean;
  /** true only if EVERY overlapping tariff version has billVerified. */
  allVersionsBillVerified: boolean;
}

export interface LineItem {
  code: string;
  label: string;
  kind: 'PER_KWH' | 'PER_KWH_MONTHLY' | 'FIXED' | 'PERCENT' | 'ROUNDING';
  /** Sub-period index (0-based) when the period was split, else 0. */
  segment: number;
  quantityKwh: string | null;
  rate: string | null;
  /** ROUND_HALF_UP to 0.01; null when the line is UNAVAILABLE. */
  amount: string | null;
  status: 'OK' | 'UNAVAILABLE';
  note?: string;
}

export interface NemResult {
  openingLots: { originStart: string; kwh: string }[];
  expiredLots: { originStart: string; kwh: string }[];
  consumedLots: { originStart: string; kwh: string }[];
  closingLots: { originStart: string; kwh: string }[];
}

export interface BillResult {
  lineItems: LineItem[];
  nem: NemResult | null;
  subtotal: string | null;
  total: string | null;
  status: BillingStatusCode;
  isLowerBound: boolean;
  reasons: string[];
}
