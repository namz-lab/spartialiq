// @vitest-environment happy-dom
//
// The Trial Balance page. Its rules: one table per book and never a combined figure; the
// Before/After control only for a closed year; the unclosed-surplus row is text; an unbalanced
// book is an alert; nothing is asked of the server without a year.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../api/ledgerApi', () => ({ ledgerApi: { trialBalance: vi.fn(), trialBalanceCsv: vi.fn() } }))
vi.mock('../workspaces/accountant/kit/csv', async (orig) => ({ ...(await orig<object>()), saveBlob: vi.fn() }))

import { ledgerApi } from '../api/ledgerApi'
import { saveBlob } from '../workspaces/accountant/kit/csv'
import TrialBalancePage from '../workspaces/accountant/pages/TrialBalancePage.vue'
import { useFinanceStore } from '../stores/finance'

const api = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })
const YEAR = { id: 'y1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open', reporting_currency: 'USD' }

const row = (over: Record<string, unknown> = {}) => ({
  currency: 'USD', ledger_account_id: 'a1', account_code: '1200', account_name: 'Bank', root_type: 'asset', report_type: 'balance_sheet',
  account_type: null, entry_count: 2, debit_total: '100.00', credit_total: '0.00', debit_balance: '100.00', credit_balance: '0.00',
  first_posting_date: null, last_posting_date: null, ...over,
})
const book = (currency: string, over: Record<string, unknown> = {}) => ({
  currency, account_count: 2, debit_total: '100.00', credit_total: '100.00', difference: '0.00', balances: true, ...over,
})
const result = (over: Record<string, unknown> = {}) => ({
  accounts: [row(), row({ ledger_account_id: 'a2', account_code: '3000', account_name: 'Reserves', root_type: 'equity', debit_balance: '0.00', credit_balance: '100.00' }),
    row({ currency: 'ZWG', ledger_account_id: 'a3', account_code: '1200', account_name: 'Bank ZWG', debit_balance: '7.00', debit_total: '7.00' })],
  books: [book('USD'), book('ZWG', { debit_total: '7.00', credit_total: '7.00' })], currencies: ['USD', 'ZWG'], note: '', unbalanced: [],
  as_at: '2026-09-30', closing: 'after', closed: [{ currency: 'USD', closed: false }, { currency: 'ZWG', closed: false }], ...over,
})

let mounted: VueWrapper | null = null
async function setup(opts: { path?: string; year?: string | null; yearRow?: Record<string, unknown> } = {}) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: ['finance.ledger.view'], department_scope: [], catalogue: [] }
  store.years = [{ ...YEAR, ...opts.yearRow }] as never
  store.selectedYearId = opts.year === undefined ? 'y1' : opts.year
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/trial-balance', name: 'acc-trial', component: TrialBalancePage },
      { path: '/ledger/:id', name: 'acc-account', component: Stub },
      { path: '/close-period', name: 'acc-close', component: Stub },
    ],
  })
  await router.push(opts.path ?? '/trial-balance?as_at=2026-09-30')
  await router.isReady()
  mounted = mount(defineComponent({ render: () => h(RouterView) }), { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  return { w: mounted, router }
}

describe('the trial balance page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    document.body.innerHTML = ''
  })
  afterEach(() => { mounted?.unmount(); mounted = null; vi.useRealTimers() })

  it('shows two books as two tables, each with its own totals and no combined figure', async () => {
    api.trialBalance.mockResolvedValue(result())
    const { w } = await setup()
    expect(w.findAll('table')).toHaveLength(2)
    const [usd, zwg] = w.findAll('section[aria-label$="book"]')
    expect(usd.text()).toContain('USD book')
    expect(usd.find('tfoot').text()).toContain('100.00')
    expect(zwg.find('tfoot').text()).toContain('7.00')
    expect(w.text()).not.toContain('107.00')
    expect(w.text()).toContain('In balance')
  })

  it('puts an asset in credit in the Cr column, unflipped', async () => {
    api.trialBalance.mockResolvedValue(result({ accounts: [row({ debit_balance: '0.00', credit_balance: '50.00' })], currencies: ['USD'], books: [book('USD')] }))
    const { w } = await setup()
    const cells = w.findAll('tbody tr')[0].findAll('td')
    expect(cells[0].text()).toBe('—')
    expect(cells[1].text()).toBe('50.00')
    expect(w.text()).not.toContain('-50.00')
  })

  it('offers Before/After closing only when a year has been closed', async () => {
    api.trialBalance.mockResolvedValue(result())
    const open = await setup()
    expect(open.w.find('#tb-closing').exists()).toBe(false)
    mounted?.unmount()
    api.trialBalance.mockResolvedValue(result({ closed: [{ currency: 'USD', closed: true }, { currency: 'ZWG', closed: false }] }))
    const closed = await setup()
    expect(closed.w.find('#tb-closing').exists()).toBe(true)
    await closed.w.find('#tb-closing').setValue('before')
    await flushPromises()
    expect(api.trialBalance.mock.calls.at(-1)![0]).toMatchObject({ closing: 'before' })
  })

  it('shows the unclosed-surplus row as text, with the sentence and a link to Period Close', async () => {
    api.trialBalance.mockResolvedValue(result({
      accounts: [row({ ledger_account_id: null, account_code: null, account_name: 'Surplus of earlier years not yet closed', debit_balance: '0.00', credit_balance: '10.00' }), row()],
      currencies: ['USD'], books: [book('USD')],
    }))
    const { w } = await setup()
    const tr = w.findAll('tbody tr')[0]
    expect(tr.text()).toContain('Surplus of earlier years not yet closed')
    expect(tr.text()).toContain('Revenue and expenditure of an earlier year that has not been closed. Close that year in Period Close.')
    const links = tr.findAll('a')
    expect(links).toHaveLength(1)
    expect(links[0].attributes('href')).toBe('/close-period')
    const real = w.findAll('tbody tr')[1].find('a')
    expect(real.attributes('href')).toBe('/ledger/a1?book=USD&to=2026-09-30')
  })

  it('says Out of balance by 0.01 in words', async () => {
    api.trialBalance.mockResolvedValue(result({ books: [book('USD', { balances: false, difference: '0.01' }), book('ZWG')], unbalanced: ['USD'] }))
    const { w } = await setup()
    expect(w.text()).toContain('Out of balance by 0.01')
  })

  it('asks for nothing and says so when no year is chosen', async () => {
    const { w } = await setup({ year: null })
    expect(api.trialBalance).not.toHaveBeenCalled()
    expect(w.text()).toContain('Choose a financial year in the banner above.')
  })

  it('calls the API with the new as_at when the date changes', async () => {
    api.trialBalance.mockResolvedValue(result())
    const { w, router } = await setup()
    await w.find('#tb-asat').setValue('2026-06-30')
    await flushPromises()
    expect(router.currentRoute.value.query.as_at).toBe('2026-06-30')
    expect(api.trialBalance.mock.calls.at(-1)![0]).toMatchObject({ financial_year_id: 'y1', as_at: '2026-06-30', closing: 'after' })
  })

  it('exports the CSV with the same parameters', async () => {
    api.trialBalance.mockResolvedValue(result())
    api.trialBalanceCsv.mockResolvedValue(new Blob(['x']))
    const { w } = await setup()
    await w.findAll('button').find((b) => b.text().includes('Export CSV'))!.trigger('click')
    await flushPromises()
    expect(api.trialBalanceCsv).toHaveBeenCalledWith(api.trialBalance.mock.calls[0][0])
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'trial-balance-2026-09-30.csv')
  })

  it('shows the server message when the export is refused', async () => {
    api.trialBalance.mockResolvedValue(result())
    api.trialBalanceCsv.mockRejectedValue({ response: { data: new Blob([JSON.stringify({ message: 'Too many rows to export.' })]) } })
    const { w } = await setup()
    await w.findAll('button').find((b) => b.text().includes('Export CSV'))!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Too many rows to export.')
    expect(saveBlob).not.toHaveBeenCalled()
  })

  it('defaults as_at to today when inside the year, using the local date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date(2026, 8, 30, 23, 30)) // local 30 Sep, late evening
    api.trialBalance.mockResolvedValue(result())
    await setup({ path: '/trial-balance' })
    expect(api.trialBalance.mock.calls[0][0]).toMatchObject({ as_at: '2026-09-30' })
  })

  it('clamps the default as_at to the year end and to the year start', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    api.trialBalance.mockResolvedValue(result())
    vi.setSystemTime(new Date(2027, 2, 5, 12))
    await setup({ path: '/trial-balance' })
    expect(api.trialBalance.mock.calls[0][0]).toMatchObject({ as_at: '2026-12-31' })
    mounted?.unmount()
    vi.setSystemTime(new Date(2025, 5, 5, 12))
    await setup({ path: '/trial-balance' })
    expect(api.trialBalance.mock.calls.at(-1)![0]).toMatchObject({ as_at: '2026-01-01' })
  })

  it('shows a loading skeleton, then an error with Retry', async () => {
    let reject!: (e: unknown) => void
    api.trialBalance.mockReturnValueOnce(new Promise((_, r) => { reject = r }))
    const { w } = await setup()
    expect(w.find('.cw-skel').exists()).toBe(true)
    reject(new Error('boom'))
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(true)
    api.trialBalance.mockResolvedValue(result())
    await w.findAll('button').find((b) => b.text() === 'Retry')!.trigger('click')
    await flushPromises()
    expect(w.findAll('table')).toHaveLength(2)
  })

  it('lets the newest request win when responses arrive out of order', async () => {
    let first!: (v: unknown) => void
    let second!: (v: unknown) => void
    api.trialBalance.mockReturnValueOnce(new Promise((r) => { first = r })).mockReturnValueOnce(new Promise((r) => { second = r }))
    const { w } = await setup({ path: '/trial-balance?as_at=2026-06-30' })
    await w.find('#tb-asat').setValue('2026-07-31')
    await flushPromises()
    second(result({ as_at: '2026-07-31', books: [book('USD', { debit_total: '777.00', credit_total: '777.00' })], currencies: ['USD'] }))
    await flushPromises()
    expect(w.text()).toContain('777.00')
    expect(w.find('.cw-skel').exists()).toBe(false)
    first(result({ as_at: '2026-06-30', books: [book('USD', { debit_total: '111.00', credit_total: '111.00' })], currencies: ['USD'] }))
    await flushPromises()
    expect(w.text()).toContain('777.00')
    expect(w.text()).not.toContain('111.00')
  })

  it('shows the empty state when nothing is posted', async () => {
    api.trialBalance.mockResolvedValue(result({ accounts: [], books: [], currencies: [] }))
    const { w } = await setup()
    expect(w.text()).toContain('Nothing has been posted as at')
  })
})
