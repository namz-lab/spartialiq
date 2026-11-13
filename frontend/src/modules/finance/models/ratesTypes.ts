/**
 * Rates billing, debtors and arrears — the shapes `../api/ratesApi.ts` returns.
 *
 * They mirror the backend's `src/routes/finance-rates.js` one for one. Three things about them are
 * deliberate and are the same rules the rest of this module follows:
 *
 * 1. EVERY AMOUNT IS A DECIMAL STRING. A charge, a rateable value, an open balance and an arrears
 *    figure were computed by Postgres over NUMERIC and are carried here untouched. None of them is
 *    ever a `number`, and nothing in this module adds two of them.
 *
 * 2. A RATE IN THE DOLLAR IS NOT MONEY. It is a decimal string of up to eight places — a cent and
 *    a half in the dollar is `0.01500000` — and must never be passed through `formatMoney`, which
 *    would round it to two.
 *
 * 3. NOTHING SPANS TWO CURRENCIES. A billing run has one currency, a receipt settles bills in its
 *    own, and every summary is an array with a `currency` on each element.
 */
import type { Currency } from './types'
import type { AgeingBucket } from './ledgerTypes'

/** A Council decision a refusal is waiting on. `docs/finance/COUNCIL-DECISIONS.md`. */
export type RatesDecision = 'D17' | 'D18' | 'D19'

export type RefusalReason =
  | 'no_rates_account' | 'ratepayer_inactive' | 'no_rateable_value' | 'no_property_category'
  | 'currency_mismatch' | 'no_approved_tariff' | 'already_billed' | 'nil_charge'

export type VoucherStatus = 'draft' | 'posted' | 'cancelled'
export type ReceiptMethod = 'cash' | 'bank_transfer' | 'mobile_money' | 'cheque' | 'card' | 'other'

// ── Readiness ───────────────────────────────────────────────────────────────────────────────

export interface RatesBlocker {
  decision: RatesDecision
  /** What the decision is, in the register's own words. */
  statement: string
  /** How many properties are still waiting on it; null where it is not a per-property count. */
  outstanding: number | null
  met: boolean
  detail: string
}

export interface RatesReadiness {
  properties: {
    properties: number
    with_ratepayer: number
    with_rateable_value: number
    with_both: number
  }
  categories: { active: number }
  tariffs: Array<{ currency: Currency; status: 'draft' | 'approved' | 'superseded'; tariffs: number }>
  ledger: {
    receivable: number
    bank: number
    revenue: number
    periods: { open: number; total: number } | null
    ready: boolean
    note: string | null
  }
  blockers: RatesBlocker[]
  can_bill_anything: boolean
  note: string | null
}

// ── Registers ───────────────────────────────────────────────────────────────────────────────

export interface PropertyCategory {
  id: string
  code: string
  name: string
  description: string | null
  status: 'active' | 'inactive'
  valuations?: number
  approved_tariffs?: number
}

/** One current property, with the value in force today and its rates account — or neither. */
export interface RatesProperty {
  parcel_id: string
  stand_no: string | null
  ward_code: string | null
  township_code: string | null
  area_m2: string | number | null
  valuation_roll_id: string | null
  rateable_value: string | null
  currency: Currency | null
  effective_from: string | null
  effective_to: string | null
  source: string | null
  property_category_id: string | null
  category_code: string | null
  category_name: string | null
  rates_account_id: string | null
  account_no: string | null
  party_id: string | null
  party_name: string | null
  has_rateable_value: boolean
  has_rates_account: boolean
}

export interface Valuation {
  id: string
  parcel_id: string
  stand_no?: string | null
  ward_code?: string | null
  property_category_id?: string
  category_code?: string
  category_name?: string
  rateable_value: string
  currency: Currency
  effective_from: string
  effective_to: string | null
  valuation_date?: string | null
  source?: string
  source_reference?: string | null
  valuer_name?: string | null
  status: 'draft' | 'active' | 'superseded'
  notes?: string | null
}

export interface ValuationBody {
  parcel_id: string
  property_category_id: string
  rateable_value: string
  currency: Currency
  effective_from: string
  effective_to?: string
  source: string
  source_reference?: string
  valuation_date?: string
  valuer_name?: string
  notes?: string
  status?: 'draft' | 'active'
}

export interface RatesTariff {
  id: string
  financial_year_id: string
  financial_year_label: string
  property_category_id: string
  category_code: string
  category_name: string
  currency: Currency
  /** Up to eight decimal places. Not money: never format it as an amount. */
  rate_in_dollar: string
  /** null means the Council recorded none, which is not the same as nil. */
  fixed_charge: string | null
  minimum_charge: string | null
  revenue_ledger_account_id: string | null
  revenue_account_code: string | null
  revenue_account_name: string | null
  status: 'draft' | 'approved' | 'superseded'
  resolution_reference: string | null
  resolution_date: string | null
  approved_by: string | null
  approved_by_name: string | null
  approved_at: string | null
  created_by: string | null
  created_by_name: string | null
  created_at: string
  notes: string | null
}

export interface TariffBody {
  financial_year_id: string
  property_category_id: string
  currency: Currency
  rate_in_dollar: string
  fixed_charge?: string | null
  minimum_charge?: string | null
  revenue_ledger_account_id?: string | null
  resolution_reference?: string | null
  resolution_date?: string | null
  notes?: string | null
}

export interface RatesAccount {
  id: string
  account_no: string
  parcel_id: string
  stand_no: string | null
  ward_code: string | null
  party_id: string
  party_name: string
  party_reference: string | null
  party_status: 'active' | 'inactive'
  erp_account_no: string | null
  opened_on: string
  closed_on: string | null
  status: 'active' | 'closed'
  notes: string | null
}

export interface RatesAccountBalance {
  currency: Currency
  /** What is owed less any unallocated credit. Signed. */
  balance: string
  owed: string
  unallocated_credit: string
}

export interface RatesStatement {
  account: RatesAccount & {
    township_code: string | null
    contact_phone: string | null
    contact_email: string | null
    address_text: string | null
  }
  bills: Array<Pick<RatesBill, 'id' | 'bill_no' | 'period_from' | 'period_to' | 'issued_on' | 'due_on'
    | 'currency' | 'amount' | 'voucher_status' | 'rateable_value' | 'rate_in_dollar' | 'open_amount'> & {
      /** From the posted ledger. null while the bill is still a draft. */
      outstanding_amount: string | null
      ageing_bucket: AgeingBucket | null
      days_outstanding: number | null
    }>
  receipts: Array<Pick<RatesReceipt, 'id' | 'receipt_no' | 'received_on' | 'currency' | 'amount'
    | 'method' | 'reference' | 'voucher_status'>>
  balances: RatesAccountBalance[]
  note: string
}

// ── Billing ─────────────────────────────────────────────────────────────────────────────────

export interface RefusalCount {
  reason_code: RefusalReason
  label: string
  waiting_on: RatesDecision | null
  decision: string | null
  /** Always present, including 0: "nothing is waiting on D18" is a fact, not an absence. */
  properties: number
}

export interface BillablePreviewRow {
  parcel_id: string
  stand_no: string | null
  ward_code: string | null
  rates_account_id: string | null
  account_no: string | null
  party_name: string | null
  category_code: string | null
  category_name: string | null
  rateable_value: string | null
  valuation_currency: Currency | null
  rate_in_dollar: string | null
  fixed_charge: string | null
  minimum_charge: string | null
  bill_amount: string | null
  billable: boolean
  reason_code: RefusalReason | null
  waiting_on: RatesDecision | null
  message: string
}

export interface BillingPreview {
  currency: Currency
  period_from: string
  period_to: string
  properties_considered: number
  billable: number
  refused: number
  /** In `currency`, summed by the database over the billable rows. */
  total_amount: string
  refusals: RefusalCount[]
  rows: BillablePreviewRow[]
  limit: number
  offset: number
  note: string
}

export interface BillingPeriodQuery {
  financial_year_id: string
  period_from: string
  period_to: string
  currency: Currency
}

export interface BillingRun {
  id: string
  run_reference: string
  financial_year_id: string
  financial_year_label: string
  period_from: string
  period_to: string
  posting_date: string
  currency: Currency
  status: 'raised' | 'committed' | 'cancelled'
  receivable_ledger_account_id: string
  receivable_account_code: string
  revenue_ledger_account_id: string
  revenue_account_code: string
  properties_considered: number
  bills_raised: number
  properties_refused: number
  total_billed: string
  /** Whoever raised the run cannot commit it; the screen compares this with the viewer. */
  prepared_by: string
  prepared_by_name: string | null
  prepared_at: string
  committed_by: string | null
  committed_by_name: string | null
  committed_at: string | null
  cancelled_by: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  notes: string | null
}

export interface BillingRunBody extends BillingPeriodQuery {
  run_reference: string
  posting_date: string
  receivable_ledger_account_id: string
  revenue_ledger_account_id: string
  due_on?: string
  narration?: string
}

export interface BillingRefusal {
  id: string
  parcel_id: string
  stand_no: string | null
  ward_code: string | null
  rates_account_id: string | null
  account_no: string | null
  reason_code: RefusalReason
  waiting_on: RatesDecision | null
  message: string
}

export interface RatesBill {
  id: string
  bill_no: string
  rates_account_id: string
  account_no: string
  party_name: string
  parcel_id: string
  stand_no: string | null
  ward_code: string | null
  billing_run_id: string | null
  period_from: string
  period_to: string
  issued_on: string
  due_on: string | null
  rateable_value: string
  rate_in_dollar: string
  fixed_charge: string | null
  minimum_charge: string | null
  currency: Currency
  amount: string
  voucher_id: string
  voucher_status: VoucherStatus
  /**
   * What the bill still has open to be settled, counting receipts still in DRAFT. The cashier's
   * figure: it is what a new receipt may allocate, and it can be lower than the arrears, which
   * count only what is posted.
   */
  open_amount: string
}

/** Per currency AND status, over the whole filtered set. Never one figure across currencies. */
export interface DocumentTotal {
  currency: Currency
  voucher_status: VoucherStatus
  amount: string
  bills?: number
  receipts?: number
}

export interface RatesReceipt {
  id: string
  receipt_no: string
  rates_account_id: string
  account_no: string
  party_name: string
  received_on: string
  currency: Currency
  amount: string
  method: ReceiptMethod | null
  reference: string | null
  voucher_id: string
  voucher_status: VoucherStatus
  /** Whoever recorded the receipt cannot post it. */
  prepared_by: string
  posted_by: string | null
  allocated_amount: string
  unallocated_amount: string
}

export interface ReceiptBody {
  receipt_no: string
  rates_account_id: string
  financial_year_id: string
  amount: string
  currency: Currency
  received_on: string
  bank_ledger_account_id: string
  receivable_ledger_account_id?: string
  method?: ReceiptMethod
  reference?: string
  narration?: string
  allocations?: Array<{ rates_bill_id: string; amount: string }>
}

// ── Arrears ─────────────────────────────────────────────────────────────────────────────────

export interface ArrearsBook {
  currency: Currency
  /** All eight buckets, in the order a statement prints them, including the empty ones. */
  buckets: Array<{ bucket: AgeingBucket; label: string; documents: number; outstanding: string }>
}

export interface ArrearsAccount {
  rates_account_id: string
  account_no: string
  parcel_id: string
  stand_no: string | null
  ward_code: string | null
  party_id: string
  party_name: string
  currency: Currency
  balance: string
  owed: string
  unallocated_credit: string
  oldest_days: number | null
  open_bills: number
}

/** The receivable control account against the ageing drawn from it, per currency. */
export interface ArrearsReconciliation {
  currency: Currency
  control_balance: string
  ledger_ageing: string
  rates_arrears: string
  /** Ageing less control. Anything but 0.00 means the report has stopped agreeing with the books. */
  ledger_difference: string
  /** Receivables in the ledger that are not rates: other debtors raised by journal. */
  other_debtors: string
  reconciles: boolean
}

export interface RatesArrears {
  books: ArrearsBook[]
  accounts: ArrearsAccount[]
  total: number
  limit: number
  offset: number
  reconciliation: ArrearsReconciliation[]
  as_at: string
  note: string
}

export interface Paged {
  total: number
  limit: number
  offset: number
}
