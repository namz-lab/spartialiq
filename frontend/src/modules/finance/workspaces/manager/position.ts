/**
 * The council's financial position, as the finance director reads it: cash at bank, what debtors
 * owe, what the council owes its creditors, budget execution, rates collection, the balance sheet
 * and whether each book balances.
 *
 * There is no single "position" endpoint, so this composes the reads the other desks already have.
 * Each one is asked only when the person holds the permission it is gated by: a refused request is
 * audited as a refusal, and a director's cockpit must not fill the trail with them. A part that
 * could not be read says so; it is never shown as zero.
 *
 * Every amount is the server's decimal string, one row per currency (decision D4). USD and ZWG are
 * never added together here.
 */
import { reactive } from 'vue'
import { dashboardsApi, type ExecutiveDashboard, type OfficerDashboard, type RevenueDashboard } from '../../api/dashboardsApi'
import { accountingApi, type AccountingDashboard } from '../../api/accountingApi'
import { payablesApi, type PayablesSummary } from '../../api/payablesApi'
import { messageOf } from '../../stores/finance'
import type { Currency } from '../../models/types'

export type PartKey = 'operations' | 'executive' | 'revenue' | 'accounting' | 'payables'

/** The permission each read is gated by on the server. */
export const PART_NEEDS: Record<PartKey, string> = {
  operations: 'finance.ledger.view',
  executive: 'finance.ledger.view',
  revenue: 'finance.rates.view',
  accounting: 'finance.ledger.view',
  payables: 'finance.payables.view',
}

export type Part<T> =
  | { state: 'idle' }
  | { state: 'ok'; data: T }
  | { state: 'denied' }
  | { state: 'error'; message: string }

export interface PositionState {
  loading: boolean
  operations: Part<OfficerDashboard>
  executive: Part<ExecutiveDashboard>
  revenue: Part<RevenueDashboard>
  accounting: Part<AccountingDashboard>
  payables: Part<PayablesSummary>
}

const idle = (): Part<never> => ({ state: 'idle' })

export const position = reactive<PositionState>({
  loading: false,
  operations: idle(), executive: idle(), revenue: idle(), accounting: idle(), payables: idle(),
})

let ticket = 0

/** Read every part this person may read, for one financial year. */
export async function loadPosition(yearId: string | null | undefined, can: (code: string) => boolean): Promise<void> {
  const mine = ++ticket
  position.loading = true
  const y = yearId ?? null
  const reads: Record<PartKey, () => Promise<unknown>> = {
    operations: () => dashboardsApi.officer(y),
    executive: () => dashboardsApi.executive(y),
    revenue: () => dashboardsApi.revenue(y),
    accounting: () => accountingApi.dashboard(y),
    payables: () => payablesApi.summary(),
  }
  const keys = Object.keys(reads) as PartKey[]
  const results = await Promise.all(keys.map(async (k): Promise<Part<unknown>> => {
    if (!can(PART_NEEDS[k])) return { state: 'denied' }
    try {
      return { state: 'ok', data: await reads[k]() }
    } catch (err) {
      return { state: 'error', message: messageOf(err, 'This figure could not be read.') }
    }
  }))
  if (mine !== ticket) return
  keys.forEach((k, i) => { (position as unknown as Record<PartKey, Part<unknown>>)[k] = results[i] })
  position.loading = false
}

export function resetPosition(): void {
  ticket++
  position.loading = false
  position.operations = idle(); position.executive = idle(); position.revenue = idle()
  position.accounting = idle(); position.payables = idle()
}

export const dataOf = <T>(p: Part<T>): T | null => (p.state === 'ok' ? p.data : null)

/** Why a part has no figure, in one sentence; `null` when it has one or is still loading. */
export function whyEmpty(p: Part<unknown>, needs: string): string | null {
  if (p.state === 'denied') return `Your role cannot read this (it needs ${needs}).`
  if (p.state === 'error') return p.message
  return null
}

/** Reporting currency first, then the others in alphabetical order. */
export function ordered<T extends { currency: Currency | string }>(rows: T[] | undefined, first: string): T[] {
  return [...(rows ?? [])].sort((a, b) => Number(b.currency === first) - Number(a.currency === first) || String(a.currency).localeCompare(String(b.currency)))
}

/** Budget execution rows for one side of the budget, per currency. */
export function execution(d: ExecutiveDashboard | null, kind: 'revenue' | 'expenditure') {
  return (d?.totals ?? []).filter((t) => t.account_kind === kind)
}

/** A percentage the server computed, as a tone for the pill: spending over 100 % is a fault. */
export function executionTone(pct: string | null, kind: 'revenue' | 'expenditure'): 'is-good' | 'is-mid' | 'is-over' | '' {
  if (pct === null) return ''
  const n = Number(pct)
  if (kind === 'expenditure') return n > 100 ? 'is-over' : n >= 90 ? 'is-mid' : 'is-good'
  return n >= 90 ? 'is-good' : n >= 60 ? 'is-mid' : 'is-over'
}

/** Debtors and creditors older than 90 days, per currency, from the accounting read's buckets. */
export function over90(rows: AccountingDashboard['receivables'] | undefined) {
  return (rows ?? []).filter((r) => r.bucket === 'over_90' && Number(r.amount) !== 0)
}
