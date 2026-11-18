/**
 * The cash office's shapes, as `src/routes/finance-cash.js` (backend) sends them.
 *
 * Every amount is a decimal STRING. Nothing in the cash office adds two of them in the browser:
 * expected takings, variances and till positions are computed by Postgres and arrive ready to show.
 */
import type { Currency } from './types'

export type CashMethod = 'cash' | 'cheque' | 'mobile_money' | 'card' | 'bank_transfer'
export type SessionStatus = 'open' | 'suspended' | 'abandoned' | 'closed' | 'verified'
export type VoucherState = 'draft' | 'posted' | 'cancelled'

export const CASH_METHODS: readonly { value: CashMethod; label: string; physical: boolean }[] = [
  { value: 'cash', label: 'Cash', physical: true },
  { value: 'mobile_money', label: 'Mobile money', physical: false },
  { value: 'card', label: 'Card', physical: false },
  { value: 'bank_transfer', label: 'Bank transfer', physical: false },
  { value: 'cheque', label: 'Cheque', physical: true },
]

export function methodLabel(method: string | null): string {
  return CASH_METHODS.find((m) => m.value === method)?.label ?? 'Not recorded'
}

export interface CashPoint {
  id: string
  code: string
  name: string
  location: string | null
  status: 'active' | 'inactive'
  /** False means a cash-up with a difference cannot be verified at this counter yet. */
  difference_account_set: boolean
  /** The session holding this drawer — open, suspended or abandoned — or null when it is free. */
  open_session_id: string | null
  held_session_no?: string | null
  held_state?: Extract<SessionStatus, 'open' | 'suspended' | 'abandoned'> | null
  held_by_id?: string | null
  held_by_name?: string | null
  held_since?: string | null
  /** The holding session belongs to an earlier business day. */
  held_stale?: boolean | null
  /** A live assignment covers today (migration 208). */
  assigned_to_me?: boolean
}

export interface IncomeCode {
  id: string
  code: string
  name: string
  /** `fixed`: the Council's charge, which the counter may not vary. */
  pricing: 'fixed' | 'variable'
  /** `null`: not chargeable in this currency. Never converted from the other. */
  unit_amount_usd: string | null
  unit_amount_zwg: string | null
  status: 'active' | 'inactive'
  /** Migration 246: set when this income is a planning fee, so its receipt names the application. */
  planning_fee_kind?: PlanningFeeKind | null
}

/** The kinds of planning fee (migration 246), the planning clerk register's own. */
export type PlanningFeeKind =
  | 'application' | 'plan_scrutiny' | 'public_notice' | 'inspection' | 'occupation'
  | 'appeal' | 'search' | 'copies' | 'other'

export const PLANNING_FEE_KINDS: { value: PlanningFeeKind; label: string }[] = [
  { value: 'application', label: 'Application fee' },
  { value: 'plan_scrutiny', label: 'Plan scrutiny' },
  { value: 'public_notice', label: 'Public notice / advertising' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'occupation', label: 'Occupation certificate' },
  { value: 'appeal', label: 'Appeal' },
  { value: 'search', label: 'Planning search' },
  { value: 'copies', label: 'Certified copies' },
  { value: 'other', label: 'Other planning fee' },
]

export const planningFeeLabel = (kind: string | null | undefined): string =>
  PLANNING_FEE_KINDS.find((k) => k.value === kind)?.label ?? (kind ? kind.replace(/_/g, ' ') : '')

/** A planning application as the cashier picks it (GET /finance/cash/planning-applications). */
export interface PlanningApplicationHit {
  id: string
  tpd_reference: string | null
  dev_register_no: string | null
  stand_number: string | null
  applicant_name: string | null
  development_type: string | null
  status: string
  fee_paid: boolean
  fees_received: number
}

/** An online provider and the bank account it settles into (migration 246, decision D22). */
export interface PaymentChannel {
  id: string
  driver: string
  name: string
  status: 'active' | 'inactive'
  notes: string | null
  bank_account_id: string
  bank_account_code: string
  bank_account_name: string
}

export interface CashAccountOption { id: string; code: string; name: string }

export interface CashYear {
  id: string
  label: string
  start_date: string
  end_date: string
  period_open_today: boolean
}

export interface SessionCount {
  currency: Currency
  opening_float: string
  /** Set by the database when the count is declared; `null` while the session is open. */
  expected_takings: string | null
  declared_total: string | null
  /** Declared less float less expected. Negative is short. */
  variance: string | null
  explanation: string | null
  difference_voucher_id?: string | null
}

export interface SessionTotal {
  currency: Currency
  method: CashMethod
  receipts: number
  amount: string
  /** In the drawer (cash, cheque) rather than straight to a bank or wallet. */
  is_physical: boolean
}

export interface CashReceipt {
  id: string
  source: 'sundry' | 'rates'
  receipt_no: string
  payer_name: string
  party_id: string | null
  currency: Currency
  amount: string
  method: CashMethod | null
  method_reference: string | null
  voucher_id: string
  voucher_status: VoucherState
  is_cancelled: boolean
  cancel_reason: string | null
  is_physical: boolean
  received_on: string
  created_at: string
  cashier_session_id: string
  narration: string | null
  /** What it was for, as one line: the income codes' names, or "Property rates". */
  service?: string | null
}

/** A day's receipts for one cashier. Counts carry no money, so they are always sent. */
export interface CashierDayCounts {
  receipts: number
  transactions: number
  cancelled: number
  /** Non-cash payments not yet confirmed by the cash-up's verification. */
  pending: number
}

export interface CashierDayAmount {
  currency: Currency
  collected_today: string
  collected_yesterday: string
  cash_today: string
  /** Percentage change on yesterday, computed by the database; null when yesterday was nil. */
  change_pct: string | null
}

export interface CashierDashboard {
  today: string
  counts: { today: CashierDayCounts; yesterday: CashierDayCounts }
  /** True while the caller holds an uncounted drawer (control C7): `amounts` is then empty. */
  amounts_withheld: boolean
  amounts: CashierDayAmount[]
  recent: CashReceipt[]
  note: string | null
}

/** Somebody waiting at the counter (migration 209). */
export interface QueueTicket {
  id: string
  ticket_no: number
  business_date: string
  customer_name: string
  rates_account_id: string | null
  account_no: string | null
  service: string | null
  status: 'waiting' | 'served' | 'removed'
  created_at: string
  created_by_name: string
  closed_at: string | null
  receipt_no: string | null
  removed_reason: string | null
}

export interface ReceiptLine {
  line_no: number
  code: string
  description: string
  quantity: string
  unit_amount: string
  amount: string
}

/** A receipt as it is printed. */
export interface PrintableReceipt extends CashReceipt {
  session_no: string
  cash_point_name: string
  cashier_name: string
  council_name: string
  lines: ReceiptLine[]
}

export interface CashierSession {
  id: string
  session_no: string
  status: SessionStatus
  business_date: string
  cash_point_id: string
  cash_point_code: string
  cash_point_name: string
  difference_account_set: boolean
  cashier_id: string
  cashier_name: string
  financial_year_id: string
  financial_year_label: string
  opened_at: string
  closed_at: string | null
  verified_at: string | null
  verified_by: string | null
  verified_by_name: string | null
  verify_note: string | null
  returned_at: string | null
  returned_by_name: string | null
  return_reason: string | null
  receipt_count: number
  cancelled_count: number
  counts: SessionCount[]
  // Migration 208.
  suspended_at?: string | null
  abandoned_at?: string | null
  abandoned_by?: string | null
  abandoned_by_name?: string | null
  abandon_reason?: string | null
  /** Set when a supervisor counted an abandoned drawer; null when the cashier counted it. */
  closed_by?: string | null
  closed_by_name?: string | null
  witness_id?: string | null
  witness_name?: string | null
  /** Holding a drawer from an earlier business day. */
  is_stale?: boolean
}

export type SessionEventKind =
  | 'opened' | 'float_recorded' | 'suspended' | 'resumed' | 'abandoned'
  | 'counted' | 'counted_under_supervision' | 'returned' | 'verified'

/** One line of a session's append-only history. */
export interface SessionEvent {
  id: string
  event: SessionEventKind
  from_status: SessionStatus | null
  to_status: SessionStatus | null
  occurred_at: string
  /** `backfill`: reconstructed from a session that existed before the history was kept. */
  source: 'live' | 'backfill'
  reason: string | null
  detail: { counts?: SessionCount[]; counts_returned?: SessionCount[] | string; currency?: Currency; opening_float?: string }
  actor_id: string | null
  actor_name: string | null
  witness_id: string | null
  witness_name: string | null
}

export interface CashierSessionDetail extends CashierSession {
  totals: SessionTotal[]
  /**
   * True while the session is open and the reader is its own cashier: the drawer is counted
   * first and compared after, so the totals are not sent (control C7).
   */
  totals_withheld: boolean
  receipts: CashReceipt[]
  /** The history, without figures while the reader's own drawer is uncounted (C7). */
  events?: SessionEvent[]
}

/** A council policy value the Council has not yet decided (D29); shown as provisional. */
export interface PolicyValue<T> { value: T; provisional: boolean; decision: string }

/** One drawer on the supervisor's board. */
export interface CashDrawer {
  cash_point_id: string
  code: string
  name: string
  location: string | null
  point_status: 'active' | 'inactive'
  session_id: string | null
  session_no: string | null
  session_status: Extract<SessionStatus, 'open' | 'suspended' | 'abandoned'> | null
  cashier_id: string | null
  cashier_name: string | null
  opened_at: string | null
  business_date: string | null
  suspended_at: string | null
  abandoned_at: string | null
  abandoned_by_name: string | null
  abandon_reason: string | null
  hours_held: string | null
  /** Past the threshold (D29) or a past business day; the server decides. */
  may_be_abandoned: boolean
  is_stale: boolean
  receipt_count: number
  /** Float plus physical receipts, per currency. Not withheld: the reader is not the cashier. */
  expected_cash: { currency: Currency; amount: string }[]
  assigned: { id: string; user_id: string; user_name: string; valid_from: string; valid_to: string | null; note: string | null }[]
}

export interface StaffOption { id: string; name: string; role: string }

export interface CashAssignment {
  id: string
  cash_point_id: string
  cash_point_code: string
  cash_point_name: string
  user_id: string
  user_name: string
  valid_from: string
  valid_to: string | null
  note: string | null
  assigned_by_name: string
  assigned_at: string
  ended_by_name: string | null
  ended_at: string | null
  end_reason: string | null
}

export interface TillPosition {
  cash_point_id: string
  code: string
  name: string
  currency: Currency
  /** What the book of account says the till holds. */
  ledger_balance: string
  /** In the drawer, from sessions nobody has verified yet. */
  unverified_takings: string
  /** Carried to the bank, not yet posted. */
  deposits_awaiting_posting: string
}

export interface CashReadiness {
  cash_points: number
  income_codes: number
  bank_accounts: number
  year_open_today: boolean
  period_open_today: boolean
  decision: string
}

export interface CashDesk {
  today: string
  cash_points: CashPoint[]
  income_codes: IncomeCode[]
  bank_accounts: CashAccountOption[]
  financial_years: CashYear[]
  my_session: CashierSessionDetail | null
  awaiting_verification: number
  till_position: TillPosition[]
  readiness: CashReadiness
  /** Provisional until the Council decides D29. Absent on a server before migration 208. */
  policy?: { abandon_after_hours: PolicyValue<number>; require_assignment: PolicyValue<boolean> }
}

export interface BankDeposit {
  id: string
  deposit_no: string
  cash_point_id: string
  cash_point_name: string
  currency: Currency
  amount: string
  bank_account_id: string
  bank_account_code: string
  bank_account_name: string
  deposited_on: string
  slip_reference: string
  voucher_id: string
  voucher_status: VoucherState
  prepared_by: string
  prepared_by_name: string
  created_at: string
  posted_by_name: string | null
  posted_at: string | null
  narration: string | null
}

export interface SetupAccounts {
  till: (CashAccountOption & { root_type: string; account_type: string | null })[]
  revenue: (CashAccountOption & { root_type: string; account_type: string | null })[]
  difference: (CashAccountOption & { root_type: string; account_type: string | null })[]
  departments: CashAccountOption[]
}

export interface ReceiptLineBody {
  income_code_id: string
  quantity?: string
  unit_amount?: string
  narration?: string
}

export interface SundryReceiptBody {
  session_id: string
  payer_name: string
  currency: Currency
  method: CashMethod
  method_reference?: string
  deposit_account_id?: string
  narration?: string
  lines: ReceiptLineBody[]
}

/** A planning fee at the counter: the same receipt, every line a planning fee, naming the application. */
export interface PlanningReceiptBody extends SundryReceiptBody {
  permit_application_id: string
}

export interface RatesCounterReceiptBody {
  session_id: string
  rates_account_id: string
  amount: string
  currency: Currency
  method: CashMethod
  method_reference?: string
  deposit_account_id?: string
  narration?: string
  allocations: { rates_bill_id: string; amount: string }[]
}

/** The charge an income code carries in one currency, or `null` when it has none there. */
export function chargeIn(code: IncomeCode, currency: Currency): string | null {
  return currency === 'USD' ? code.unit_amount_usd : code.unit_amount_zwg
}

/** Can this income code be receipted in this currency at all? */
export function receiptableIn(code: IncomeCode, currency: Currency): boolean {
  return code.status === 'active' && (code.pricing === 'variable' || chargeIn(code, currency) !== null)
}
