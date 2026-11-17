// @vitest-environment happy-dom
//
// Executive Finance (accounting officer):
//   1. READ-ONLY: the workspace's own pages render no control that writes.
//   2. CASH AND BANK: one table per currency, the server's balances as sent, overdrawn said in words.
//   3. NAVIGATION reaches the statements, debtors by age, cash and the audit trail.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type RouteRecordRaw } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../api/ledgerApi', () => ({ ledgerApi: { cashAccounts: vi.fn(), debtorAgeing: vi.fn() } }))
vi.mock('../api/financeApi', () => ({ financeApi: { overviewSeries: vi.fn() } }))
const registered = vi.hoisted(() => [] as { key: string; routes: RouteRecordRaw[]; serves: Record<string, string> }[])
vi.mock('../shell/workspaces', () => ({ registerWorkspace: (w: never) => registered.push(w) }))

import { ledgerApi } from '../api/ledgerApi'
import { financeApi } from '../api/financeApi'
import CashPosition from '../workspaces/executive/pages/CashPosition.vue'
import ExecutiveDashboard from '../workspaces/executive/pages/ExecutiveDashboard.vue'
import { executiveDash } from '../workspaces/executive/dashboard'
import '../workspaces/executive/routes'
import { useFinanceStore } from '../stores/finance'

const ledger = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })
const bal = (amount: string, side: 'Dr' | 'Cr' = 'Dr') => ({ net_debit: amount, amount, side })
const ACCOUNTS = [
  { id: 'b1', code: '1010', name: 'CBZ current', account_type: 'bank', currency: 'USD', balance: bal('12500.00'), last_entry: '2026-11-10', reconciled_to: '2026-10-31', reconciled_balance: '11000.00', unreconciled: { entries: 4, debit: '1', credit: '1' } },
  { id: 'b2', code: '1020', name: 'ZB overdraft', account_type: 'bank', currency: 'USD', balance: bal('300.00', 'Cr'), last_entry: null, reconciled_to: null, reconciled_balance: null, unreconciled: { entries: 0, debit: '0', credit: '0' } },
  { id: 'c1', code: '1050', name: 'Main till', account_type: 'cash', currency: 'ZWG', balance: bal('900.00'), last_entry: null, reconciled_to: null, reconciled_balance: null, unreconciled: null },
]

let wrappers: VueWrapper[] = []
async function mountPage(page: never) {
  const store = useFinanceStore()
  store.identity = { user_id: 'ceo', role: 'accounting_officer', authority_id: 1, permissions: ['finance.ledger.view', 'finance.audit.view', 'finance.report.view'], department_scope: [], catalogue: [] } as never
  store.selectedYearId = 'y1'
  const names = ['exe-cash', 'exe-ageing', 'exe-position', 'exe-payments', 'exe-reports', 'exe-trail', 'exe-revenue', 'exe-expenditure', 'exe-departments', 'exe-projects', 'exe-overview']
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'home', component: Stub }, ...names.map((name) => ({ path: `/${name}`, name, component: Stub }))] })
  await router.push('/')
  const w = mount(page, { global: { plugins: [router] } })
  wrappers.push(w)
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  ledger.cashAccounts.mockResolvedValue({ accounts: ACCOUNTS })
  ledger.debtorAgeing.mockResolvedValue({
    bills: [], total: 0, limit: 1, offset: 0, by_party: [], by_party_bucket: [], buckets: [], as_at: '2026-11-16', note: '',
    by_bucket: [{ currency: 'USD', ageing_bucket: 'current', rows: 1, outstanding_amount: '400.00' }, { currency: 'USD', ageing_bucket: 'over_365', rows: 1, outstanding_amount: '75.00' }, { currency: 'ZWG', ageing_bucket: 'current', rows: 1, outstanding_amount: '8.00' }],
    reconciliation: [{ currency: 'USD', rows: 2, ageing_total: '475.00', control_balance: '475.00', control_accounts: 1, control_codes: '1200', difference: '0.00', agrees: true }],
  })
  ;(financeApi as unknown as Record<string, ReturnType<typeof vi.fn>>).overviewSeries.mockResolvedValue({ periods: [], series: [] })
})
afterEach(() => { wrappers.forEach((w) => w.unmount()); wrappers = []; executiveDash.reset() })

describe('Cash and Bank', () => {
  it('reads the year and shows one table per currency, with an overdrawn bank said in words', async () => {
    const w = await mountPage(CashPosition as never)
    expect(ledger.cashAccounts).toHaveBeenCalledWith('y1')
    expect(w.findAll('table')).toHaveLength(2)
    expect(w.text()).toContain('CBZ current')
    expect(w.text()).toContain('overdrawn')
    expect(w.text()).toContain('Never reconciled')
    expect(w.text()).toContain('4 entries')
  })
  it('renders no button except Retry on an error', async () => {
    const ok = await mountPage(CashPosition as never)
    expect(ok.findAll('button')).toHaveLength(0)
    ledger.cashAccounts.mockRejectedValueOnce(new Error('x'))
    const bad = await mountPage(CashPosition as never)
    expect(bad.findAll('button').map((b) => b.text())).toEqual(['Retry'])
  })
})

describe('Executive dashboard', () => {
  beforeEach(() => {
    executiveDash.state.data = {
      year: { id: 'y1', label: 'FY2026', reporting_currency: 'USD' }, totals: [], prior: [], departments: [],
      projects: { in_progress: 0, completed: 0, on_track: 0, active: 0, on_track_pct: null }, high_risks: 0, compliance: { due: 0, on_time: 0, pct: null },
    } as never
  })
  it('shows cash and debtors by age in the reporting currency only, and the reconciliation', async () => {
    const w = await mountPage(ExecutiveDashboard as never)
    expect(ledger.debtorAgeing).toHaveBeenCalledWith({ currency: 'USD', outstanding_only: true, limit: 1 })
    expect(w.text()).toContain('Over 365 days')
    expect(w.text()).not.toContain('Main till')
    expect(w.text()).toContain('Agrees with the debtors control account.')
  })
  it('offers links to read, and no button that acts', async () => {
    const w = await mountPage(ExecutiveDashboard as never)
    expect(w.findAll('button')).toHaveLength(0)
    expect(w.text()).toContain('Read Further')
    expect(w.text()).not.toMatch(/Executive Actions|Strategic Plan|Council Brief/)
  })
})

describe('Executive routes', () => {
  it('serves the position, ageing and audit targets and has a cash page', () => {
    const exe = registered.find((r) => r.key === 'accounting')!
    expect(exe.serves).toMatchObject({ 'statements.position': 'exe-position', 'statements.ageing': 'exe-ageing', audit: 'exe-trail' })
    const names = (exe.routes[0].children ?? []).map((c) => c.name)
    expect(names).toEqual(expect.arrayContaining(['exe-cash', 'exe-position', 'exe-ageing', 'exe-trail', 'exe-payments']))
  })
})
