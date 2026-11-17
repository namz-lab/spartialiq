// @vitest-environment happy-dom
//
// The Financial Statements page. Its rules: three statements in tabs held in ?statement=, one book
// at a time held in ?book= and never a combined figure; `incomplete` is an alert when present and
// nothing when empty; the surplus line sits under equity; the cash statement carries the server's
// note; a late response never shows another statement's or book's figures.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../api/ledgerApi', () => ({
  ledgerApi: {
    position: vi.fn(), positionCsv: vi.fn(), performance: vi.fn(), performanceCsv: vi.fn(),
    cashStatement: vi.fn(), cashStatementCsv: vi.fn(),
  },
}))
vi.mock('../workspaces/accountant/kit/csv', async (orig) => ({ ...(await orig<object>()), saveBlob: vi.fn() }))

import { ledgerApi } from '../api/ledgerApi'
import { saveBlob } from '../workspaces/accountant/kit/csv'
import StatementsPage from '../workspaces/accountant/pages/StatementsPage.vue'
import { useFinanceStore } from '../stores/finance'

const api = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const YEAR = { id: 'y1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open', reporting_currency: 'USD' }
const NOTE = 'This is a statement of cash receipts and payments. It is not an IPSAS 2 cash flow statement.'

const acct = (id: string, code: string, name: string, root: string, balance: string, currency = 'USD') =>
  ({ currency, ledger_account_id: id, account_code: code, account_name: name, root_type: root, balance })
const sect = (root: string, accounts: unknown[]) => ({ root_type: root, natural_side: root === 'asset' || root === 'expense' ? 'debit' : 'credit', accounts })

const position = (over: Record<string, unknown> = {}) => ({
  books: [
    { currency: 'USD', sections: [sect('asset', [acct('a1', '1200', 'Bank', 'asset', '1550.00')]), sect('equity', [acct('e1', '3000', 'Reserves', 'equity', '1000.00')])] },
    { currency: 'ZWG', sections: [sect('asset', [acct('a9', '1200', 'Bank ZWG', 'asset', '77.00', 'ZWG')])] },
  ],
  subtotals: [{ currency: 'USD', root_type: 'asset', subtotal: '1550.00' }, { currency: 'USD', root_type: 'equity', subtotal: '1000.00' }],
  currencies: ['USD', 'ZWG'], incomplete: [], note: '',
  surplus_to_date: [{ currency: 'USD', amount: '550.00', side: 'surplus' }],
  check: [{ currency: 'USD', assets: '1550.00', liabilities: '0.00', equity_and_surplus: '1550.00', balances: true }],
  ...over,
})
const performance = (over: Record<string, unknown> = {}) => ({
  financial_year: { id: 'y1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31' },
  books: [{ currency: 'USD', sections: [sect('revenue', [acct('r1', '4000', 'Rates', 'revenue', '1200.00')]), sect('expense', [acct('x1', '5000', 'Salaries', 'expense', '400.00')])] }],
  periods: null, period_rows: [], accumulated: false, currencies: ['USD'], incomplete: [], note: '',
  prior: [{ currency: 'USD', ledger_account_id: 'r1', balance: '900.00' }], prior_year: { id: 'y0', label: '2025' }, ...over,
})
const cash = (over: Record<string, unknown> = {}) => ({
  from: '2026-01-01', to: '2026-09-30',
  accounts: [{ currency: 'USD', id: 'c1', code: '1200', name: 'Main bank', opening: '0.00', receipts: '1900.00', payments: '400.00', closing: '1500.00' }],
  books: [{ currency: 'USD', opening: '0.00', receipts: '1900.00', payments: '400.00', closing: '1500.00' }],
  by_counter: [{ currency: 'USD', group: 'revenue', label: 'Revenue', inflow: '900.00', outflow: '0.00', net: '900.00' }],
  reconciles: [{ currency: 'USD', movement: '1500.00', analysed: '1500.00', agrees: true }], note: NOTE, ...over,
})

let mounted: VueWrapper | null = null
async function setup(opts: { path?: string; year?: string | null } = {}) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: ['finance.ledger.view'], department_scope: [], catalogue: [] }
  store.years = [YEAR] as never
  store.selectedYearId = opts.year === undefined ? 'y1' : opts.year
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/reports', name: 'acc-reports', component: StatementsPage }],
  })
  await router.push(opts.path ?? '/reports?as_at=2026-09-30')
  await router.isReady()
  mounted = mount(defineComponent({ render: () => h(RouterView) }), { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  return { w: mounted, router }
}
const deferred = <T,>() => { let res!: (v: T) => void; const p = new Promise<T>((r) => { res = r }); return { p, res } }

describe('the financial statements page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })
  afterEach(() => { mounted?.unmount(); mounted = null; vi.restoreAllMocks() })

  it('asks for nothing and says so when no year is chosen', async () => {
    const { w } = await setup({ year: null })
    expect(api.position).not.toHaveBeenCalled()
    expect(w.text()).toContain('Choose a financial year in the banner above.')
  })

  it('shows a loading state, then the statement, and an error with Retry', async () => {
    const d = deferred<unknown>()
    api.position.mockReturnValueOnce(d.p)
    const { w } = await setup()
    expect(w.find('.cw-skel').exists()).toBe(true)
    d.res(position())
    await flushPromises()
    expect(w.find('.cw-skel').exists()).toBe(false)
    expect(w.text()).toContain('1200 Bank')
    mounted?.unmount()
    api.position.mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(position())
    const failed = await setup()
    expect(failed.w.find('[role="alert"]').exists()).toBe(true)
    await failed.w.find('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(failed.w.text()).toContain('1200 Bank')
  })

  it('says so when the book has nothing on the statement', async () => {
    api.position.mockResolvedValue(position({ books: [{ currency: 'USD', sections: [] }], surplus_to_date: [], check: [] }))
    const { w } = await setup()
    expect(w.text()).toContain('Nothing has been posted to the USD book')
  })

  it('renders incomplete as an alert, and nothing when it is empty', async () => {
    api.position.mockResolvedValue(position({ incomplete: ['No payable account is set up.', '1200 is reconciled to 2026-06-30; 3 later entries are not.'] }))
    const { w } = await setup()
    const alert = w.find('.fs-incomplete')
    expect(alert.attributes('role')).toBe('alert')
    expect(alert.text()).toContain('No payable account is set up.')
    expect(alert.findAll('li')).toHaveLength(2)
    mounted?.unmount()
    api.position.mockResolvedValue(position({ incomplete: [] }))
    const clean = await setup()
    expect(clean.w.find('.fs-incomplete').exists()).toBe(false)
    expect(clean.w.find('[role="alert"]').exists()).toBe(false)
  })

  it('puts the surplus line under equity, and leaves it out for a closed book', async () => {
    api.position.mockResolvedValue(position())
    const { w } = await setup()
    const bodies = w.findAll('tbody')
    const equity = bodies.find((b) => b.text().includes('Net assets and equity'))!
    const rows = equity.findAll('tr').map((r) => r.text())
    expect(rows[1]).toContain('3000 Reserves')
    const sur = rows.find((r) => r.includes('Surplus to date') && !r.includes('Total'))!
    expect(sur).toContain('550.00')
    expect(rows.indexOf(sur)).toBeGreaterThan(1)
    expect(bodies.find((b) => b.text().includes('Assets'))!.text()).not.toContain('Surplus to date')
    mounted?.unmount()
    api.position.mockResolvedValue(position({ surplus_to_date: [] }))
    const closed = await setup()
    expect(closed.w.text()).not.toContain('Surplus to date')
  })

  it('says a deficit is a deficit', async () => {
    api.position.mockResolvedValue(position({ surplus_to_date: [{ currency: 'USD', amount: '-20.00', side: 'deficit' }] }))
    const { w } = await setup()
    expect(w.text()).toContain('Deficit to date')
  })

  it('shows the check as a status when it balances and as an alert, with the figures, when it does not', async () => {
    api.position.mockResolvedValue(position())
    const { w } = await setup()
    expect(w.find('[role="status"]').text()).toContain('Assets equal liabilities plus equity')
    mounted?.unmount()
    api.position.mockResolvedValue(position({ check: [{ currency: 'USD', assets: '1550.00', liabilities: '0.00', equity_and_surplus: '1549.99', balances: false }] }))
    const bad = await setup()
    const alert = bad.w.find('[role="alert"]')
    expect(alert.text()).toContain('does not balance')
    expect(alert.text()).toContain('1 549.99')
  })

  it('shows one book at a time, asks the server for that book and never a combined figure', async () => {
    api.position.mockResolvedValue(position())
    const { w, router } = await setup()
    expect(api.position.mock.calls[0][0]).toMatchObject({ financial_year_id: 'y1', currency: 'USD', as_at: '2026-09-30' })
    expect(w.text()).not.toContain('Bank ZWG')
    expect(w.text()).not.toContain('1627')
    expect(w.text()).not.toContain('1 627')
    const zwg = w.findAll('[role="radio"]').find((b) => b.text() === 'ZWG')!
    await zwg.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.book).toBe('ZWG')
    expect(api.position.mock.calls.at(-1)![0]).toMatchObject({ currency: 'ZWG' })
    expect(w.text()).toContain('Bank ZWG')
    expect(w.text()).not.toContain('1200 Bank\n')
    expect(w.text()).not.toContain('Reserves')
    expect(w.text()).not.toContain('1 627')
  })

  it('defaults the book to the year\'s reporting currency', async () => {
    api.position.mockResolvedValue(position())
    const { w } = await setup({ path: '/reports?as_at=2026-09-30&book=ZWG' })
    expect(api.position.mock.calls[0][0]).toMatchObject({ currency: 'ZWG' })
    expect(w.find('[role="radio"][aria-checked="true"]').text()).toBe('ZWG')
  })

  it('holds the tab in ?statement= and loads that statement', async () => {
    api.position.mockResolvedValue(position())
    api.performance.mockResolvedValue(performance())
    api.cashStatement.mockResolvedValue(cash())
    const { w, router } = await setup()
    const tabs = w.findAll('[role="tab"]')
    expect(tabs.map((t) => t.text())).toEqual(['Financial position', 'Financial performance', 'Cash receipts and payments'])
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    await tabs[1].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.statement).toBe('performance')
    expect(api.performance).toHaveBeenCalledTimes(1)
    expect(w.text()).toContain('4000 Rates')
    await w.findAll('[role="tab"]')[2].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.statement).toBe('cash')
    expect(api.cashStatement.mock.calls[0][0]).toMatchObject({ financial_year_id: 'y1', from: '2026-01-01' })
    await w.findAll('[role="tab"]')[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.statement).toBeUndefined()
  })

  it('opens on the tab named in the address', async () => {
    api.cashStatement.mockResolvedValue(cash())
    const { w } = await setup({ path: '/reports?statement=cash&to=2026-09-30' })
    expect(api.position).not.toHaveBeenCalled()
    expect(w.findAll('[role="tab"]')[2].attributes('aria-selected')).toBe('true')
  })

  it('shows the server\'s note on the cash statement, verbatim', async () => {
    api.cashStatement.mockResolvedValue(cash())
    const { w } = await setup({ path: '/reports?statement=cash' })
    expect(w.text()).toContain(NOTE)
    expect(w.find('tfoot').text()).toContain('1 500.00')
    expect(w.find('[role="status"]').text()).toContain('agrees')
  })

  it('shows a cash analysis that does not agree as an alert', async () => {
    api.cashStatement.mockResolvedValue(cash({ reconciles: [{ currency: 'USD', movement: '1500.00', analysed: '1400.00', agrees: false }] }))
    const { w } = await setup({ path: '/reports?statement=cash' })
    const alert = w.find('[role="alert"]')
    expect(alert.text()).toContain('does not agree')
    expect(alert.text()).toContain('1 400.00')
  })

  it('does not ask for the comparison until it is ticked, then names the year the server sent and shows its figures as sent', async () => {
    api.performance.mockResolvedValue(performance())
    const { w, router } = await setup({ path: '/reports?statement=performance&as_at=2026-09-30' })
    expect(api.performance.mock.calls[0][0]).not.toHaveProperty('compare')
    expect(w.text()).toContain('Compare with the prior year')
    expect(w.findAll('thead th').map((t) => t.text())).not.toContain('2025')
    await w.find('input[type="checkbox"]').setValue(true)
    await flushPromises()
    expect(router.currentRoute.value.query.compare).toBe('1')
    expect(api.performance).toHaveBeenCalledTimes(2)
    expect(api.performance.mock.calls[1][0]).toMatchObject({ compare: 'prior_year' })
    expect(w.text()).toContain('Compare with 2025')
    expect(w.findAll('thead th').map((t) => t.text())).toContain('2025')
    const rates = w.findAll('tbody tr').find((r) => r.text().includes('4000 Rates'))!
    expect(rates.findAll('td').map((c) => c.text())).toEqual(['4000 Rates', '1 200.00', '900.00'])
    const pay = w.findAll('tbody tr').find((r) => r.text().includes('5000 Salaries'))!
    expect(pay.findAll('td')[2].text()).toBe('—')
    expect(w.text()).not.toContain('There is no prior year')
  })

  it('says there is no prior year to compare with when the server sends none', async () => {
    api.performance.mockResolvedValue(performance({ prior_year: null, prior: undefined }))
    const { w } = await setup({ path: '/reports?statement=performance&as_at=2026-09-30&compare=1' })
    expect(api.performance.mock.calls[0][0]).toMatchObject({ compare: 'prior_year' })
    const status = w.findAll('[role="status"]').find((e) => e.text().includes('There is no prior year to compare with.'))
    expect(status).toBeTruthy()
    expect(w.findAll('thead th').map((t) => t.text())).toEqual(['Account', 'USD'])
  })

  it('exports the performance CSV with the comparison only when it is on screen', async () => {
    api.performance.mockResolvedValue(performance())
    api.performanceCsv.mockResolvedValue(new Blob(['x']))
    const off = await setup({ path: '/reports?statement=performance&as_at=2026-09-30' })
    await off.w.findAll('button').find((b) => b.text().includes('Export CSV'))!.trigger('click')
    await flushPromises()
    expect(api.performanceCsv.mock.calls[0][0]).not.toHaveProperty('compare')
    mounted?.unmount()
    const on = await setup({ path: '/reports?statement=performance&as_at=2026-09-30&compare=1' })
    await on.w.findAll('button').find((b) => b.text().includes('Export CSV'))!.trigger('click')
    await flushPromises()
    expect(api.performanceCsv.mock.calls[1][0]).toMatchObject({ compare: 'prior_year' })
  })

  it('foots the equity section on its face: the total including surplus is the server\'s figure', async () => {
    api.position.mockResolvedValue(position())
    const { w } = await setup()
    const equity = w.findAll('tbody').find((b) => b.text().includes('Net assets and equity'))!
    const rows = equity.findAll('tr').map((r) => r.text())
    const iSub = rows.findIndex((r) => r.includes('Total equity before surplus to date'))
    const iSur = rows.findIndex((r) => r.includes('Surplus to date') && !r.includes('Total'))
    const iTot = rows.findIndex((r) => r.includes('Equity including surplus to date'))
    expect(iSub).toBeGreaterThan(0)
    expect(iSur).toBeGreaterThan(iSub)
    expect(iTot).toBeGreaterThan(iSur)
    expect(rows[iSub]).toContain('1 000.00')
    expect(rows[iSur]).toContain('550.00')
    expect(rows[iTot]).toContain('1 550.00')
    expect(w.text()).not.toContain('Total net assets and equity')
  })

  it('never asks for a date outside the selected year, and drops them when the year changes', async () => {
    api.position.mockResolvedValue(position())
    const { w } = await setup({ path: '/reports?as_at=2025-06-30' })
    const first = api.position.mock.calls[0][0].as_at as string
    expect(first >= '2026-01-01' && first <= '2026-12-31').toBe(true)
    mounted?.unmount()
    api.position.mockClear()
    const next = await setup({ path: '/reports?as_at=2026-09-30' })
    expect(api.position.mock.calls[0][0].as_at).toBe('2026-09-30')
    const store = useFinanceStore()
    store.years = [YEAR, { ...YEAR, id: 'y2', label: '2027', start_date: '2027-01-01', end_date: '2027-12-31' }] as never
    store.selectedYearId = 'y2'
    await flushPromises()
    const last = api.position.mock.calls.at(-1)![0]
    expect(last.financial_year_id).toBe('y2')
    expect(last.as_at >= '2027-01-01' && last.as_at <= '2027-12-31').toBe(true)
    expect(next.w.exists()).toBe(true)
    expect(w).toBeTruthy()
  })

  it('keeps cash dates inside the selected year too', async () => {
    api.cashStatement.mockResolvedValue(cash())
    await setup({ path: '/reports?statement=cash&from=2025-01-01&to=2027-03-01' })
    const p = api.cashStatement.mock.calls[0][0]
    expect(p.from).toBe('2026-01-01')
    expect(p.to >= '2026-01-01' && p.to <= '2026-12-31').toBe(true)
  })

  it('keeps periodicity and accumulated, with a column per period', async () => {
    api.performance.mockResolvedValue(performance({
      periods: [{ from_date: '2026-01-01', to_date: '2026-03-31', key: 'q1', label: 'Q1' }, { from_date: '2026-04-01', to_date: '2026-06-30', key: 'q2', label: 'Q2' }],
      period_rows: [{ key: 'q1', currency: 'USD', ledger_account_id: 'r1', account_code: '4000', root_type: 'revenue', balance: '500.00' }],
      accumulated: true,
    }))
    const { w, router } = await setup({ path: '/reports?statement=performance&periodicity=quarterly&accumulated=1&as_at=2026-09-30' })
    expect(api.performance.mock.calls[0][0]).toMatchObject({ periodicity: 'quarterly', accumulated: true })
    expect(w.findAll('thead th').map((t) => t.text())).toEqual(['Account', 'Q1', 'Q2', 'Year'])
    const rates = w.findAll('tbody tr').find((r) => r.text().includes('4000 Rates'))!
    expect(rates.findAll('td').map((c) => c.text())).toEqual(['4000 Rates', '500.00', '—', '1 200.00'])
    expect(w.text()).toContain('overlap')
    await w.find('#fs-per').setValue('')
    await flushPromises()
    expect(router.currentRoute.value.query.periodicity).toBeUndefined()
    expect(router.currentRoute.value.query.accumulated).toBeUndefined()
  })

  it('shows incomplete on the performance statement too', async () => {
    api.performance.mockResolvedValue(performance({ incomplete: ['Depreciation has not been run for April.'] }))
    const { w } = await setup({ path: '/reports?statement=performance' })
    expect(w.find('.fs-incomplete').text()).toContain('Depreciation has not been run for April.')
  })

  it('exports the CSV with the same parameters', async () => {
    api.position.mockResolvedValue(position())
    const blob = new Blob(['a,b'])
    api.positionCsv.mockResolvedValue(blob)
    const { w } = await setup()
    const button = w.findAll('button').find((b) => b.text().includes('Export CSV'))!
    await button.trigger('click')
    await flushPromises()
    expect(api.positionCsv.mock.calls[0][0]).toEqual(api.position.mock.calls[0][0])
    expect(saveBlob).toHaveBeenCalledWith(blob, 'statement-position-usd-2026-09-30.csv')
  })

  it('exports each of the other statements by its own method', async () => {
    api.performance.mockResolvedValue(performance())
    api.performanceCsv.mockResolvedValue(new Blob(['x']))
    const p = await setup({ path: '/reports?statement=performance&as_at=2026-09-30' })
    await p.w.findAll('button').find((b) => b.text().includes('Export CSV'))!.trigger('click')
    await flushPromises()
    expect(api.performanceCsv.mock.calls[0][0]).toEqual(api.performance.mock.calls[0][0])
    mounted?.unmount()
    api.cashStatement.mockResolvedValue(cash())
    api.cashStatementCsv.mockResolvedValue(new Blob(['x']))
    const c = await setup({ path: '/reports?statement=cash&from=2026-02-01&to=2026-09-30' })
    await c.w.findAll('button').find((b) => b.text().includes('Export CSV'))!.trigger('click')
    await flushPromises()
    expect(api.cashStatementCsv.mock.calls[0][0]).toEqual({ financial_year_id: 'y1', from: '2026-02-01', to: '2026-09-30' })
    expect(api.cashStatementCsv.mock.calls[0][0]).toEqual(api.cashStatement.mock.calls[0][0])
  })

  it('shows the message inside a CSV error Blob', async () => {
    api.position.mockResolvedValue(position())
    api.positionCsv.mockRejectedValue({ response: { data: new Blob([JSON.stringify({ message: 'The export is too large.' })]) } })
    const { w } = await setup()
    await w.findAll('button').find((b) => b.text().includes('Export CSV'))!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('The export is too large.')
    expect(saveBlob).not.toHaveBeenCalled()
  })

  it('falls back to a plain sentence when the CSV error has no readable body', async () => {
    api.position.mockResolvedValue(position())
    api.positionCsv.mockRejectedValue(new Error('network'))
    const { w } = await setup()
    await w.findAll('button').find((b) => b.text().includes('Export CSV'))!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('The export could not be made.')
  })

  it('prints with window.print', async () => {
    api.position.mockResolvedValue(position())
    const print = vi.fn()
    vi.stubGlobal('print', print)
    const { w } = await setup()
    await w.findAll('button').find((b) => b.text().includes('Print'))!.trigger('click')
    expect(print).toHaveBeenCalledTimes(1)
    vi.unstubAllGlobals()
  })

  it('discards a late response after switching tab', async () => {
    const slow = deferred<unknown>()
    api.position.mockReturnValueOnce(slow.p)
    api.performance.mockResolvedValue(performance())
    const { w } = await setup()
    await w.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()
    expect(w.text()).toContain('4000 Rates')
    slow.res(position())
    await flushPromises()
    expect(w.text()).toContain('4000 Rates')
    expect(w.text()).not.toContain('1200 Bank')
    expect(w.text()).not.toContain('Surplus to date')
  })

  it('discards a late response after switching book', async () => {
    const slow = deferred<unknown>()
    api.position.mockReturnValueOnce(slow.p)
    api.position.mockResolvedValueOnce(position())
    const { w } = await setup()
    await w.findAll('[role="radio"]').find((b) => b.text() === 'ZWG')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Bank ZWG')
    slow.res(position({
      books: [{ currency: 'USD', sections: [sect('asset', [acct('a1', '1200', 'Bank', 'asset', '1550.00')])] }],
    }))
    await flushPromises()
    expect(w.text()).toContain('Bank ZWG')
    expect(w.text()).not.toContain('1 550.00')
  })

  it('keeps an error from a late failure out of the current statement', async () => {
    const slow = deferred<unknown>()
    api.position.mockReturnValueOnce(slow.p)
    api.performance.mockResolvedValue(performance())
    const { w } = await setup()
    await w.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()
    slow.res(Promise.reject(new Error('late')))
    await flushPromises().catch(() => undefined)
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})
