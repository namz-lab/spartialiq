// @vitest-environment happy-dom
//
// Ledger Reports: the general ledger in detail and the journal listing. Its rules:
//
//   1. EACH REPORT OWNS ITS QUERY KEYS (gl_*, jl_*): changing a filter resets only that report's offset.
//   2. ONE BOOK AT A TIME FOR THE GENERAL LEDGER; THE JOURNAL LISTING TOTALS ARE ONE ROW PER CURRENCY.
//   3. FIGURES ARE THE SERVER'S, WITH THEIR SIDE: a Cr brought-forward balance is shown as Cr.
//   4. A STALE ANSWER NEVER OVERWRITES A NEWER ONE; NO YEAR MEANS NO REQUEST.
//   5. THE CATALOGUE LINK IS OFFERED ONLY WHEN A WORKSPACE SERVES `reports`; otherwise the reason is text.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterLink, RouterView } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../api/ledgerApi', () => ({
  ledgerApi: { generalLedgerReport: vi.fn(), generalLedgerReportCsv: vi.fn(), journalListing: vi.fn(), journalListingCsv: vi.fn() },
}))
vi.mock('../workspaces/accountant/kit/csv', async (orig) => ({ ...(await orig<object>()), saveBlob: vi.fn() }))

import { ledgerApi } from '../api/ledgerApi'
import { saveBlob } from '../workspaces/accountant/kit/csv'
import LedgerReportsPage from '../workspaces/accountant/pages/LedgerReportsPage.vue'
import { useFinanceStore } from '../stores/finance'
import { registerWorkspace, __resetRegistry } from '../shell/workspaces'
import { UNAVAILABLE_REASON } from '../shell/useFinanceNav'

const api = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })
const YEAR = { id: 'y1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open', reporting_currency: 'USD' }

const dr = (a: string) => ({ net_debit: a, amount: a, side: 'Dr' as const })
const cr = (a: string) => ({ net_debit: `-${a}`, amount: a, side: 'Cr' as const })
const line = (n: number, balance: ReturnType<typeof dr>) => ({
  id: `e${n}`, voucher_id: `v${n}`, voucher_no: `RC-00000${n}`, voucher_type: 'receipt', posting_date: `2026-03-0${n}`,
  narration: `Entry ${n}`, party_id: null, party_name: null, debit: '100.00', credit: '0.00', balance, reconciled: null,
})
const glAccount = (id: string, code: string, name: string, root: string, over: Record<string, unknown> = {}) => ({
  account: { id, code, name, root_type: root }, brought_forward: dr('1500.00'), entries: [line(1, dr('1600.00'))],
  totals: { debit: '100.00', credit: '0.00' }, carried_forward: dr('1600.00'), ...over,
})
const glReport = (over: Record<string, unknown> = {}) => ({
  accounts: [glAccount('a1', '1200', 'Bank CBZ', 'asset')], total_accounts: 60, limit: 25, offset: 0, ...over,
})
const voucher = (id: string, no: string, currency: string, over: Record<string, unknown> = {}) => ({
  id, voucher_no: no, voucher_type: 'journal', currency, posting_date: '2026-03-05', status: 'posted', narration: 'Accrual', reference: null,
  prepared_by_name: 'Pat Preparer', posted_by_name: 'Sam Poster',
  lines: [
    { line_no: 1, account_code: '5000', account_name: 'Salaries', party_name: null, debit: '250.00', credit: '0.00', narration: null },
    { line_no: 2, account_code: '2100', account_name: 'Accruals', party_name: null, debit: '0.00', credit: '250.00', narration: null },
  ],
  debit_total: '250.00', credit_total: '250.00', ...over,
})
const listing = (over: Record<string, unknown> = {}) => ({
  vouchers: [voucher('j1', 'JV-000001', 'USD'), voucher('j2', 'JV-000002', 'ZWG')], total: 120,
  totals: [{ currency: 'USD', debit_total: '250.00', credit_total: '250.00' }, { currency: 'ZWG', debit_total: '900.00', credit_total: '900.00' }], ...over,
})

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  const promise = new Promise<T>((r) => { resolve = r })
  return { promise, resolve }
}

let mounted: VueWrapper | null = null
async function setup(opts: { path?: string; year?: string | null; serves?: boolean } = {}) {
  const store = useFinanceStore()
  store.identity = {
    user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: ['finance.ledger.view'], department_scope: [], catalogue: [],
    workspaces: ['accountant'], home_workspace: 'accountant',
  } as never
  store.years = [YEAR] as never
  store.selectedYearId = opts.year === undefined ? 'y1' : opts.year
  __resetRegistry()
  registerWorkspace({ key: 'accountant', routes: [], serves: opts.serves === false ? {} : { reports: 'acc-reports' } } as never)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ledger-reports', name: 'acc-ledger-reports', component: LedgerReportsPage },
      { path: '/reports', name: 'acc-reports', component: Stub },
      { path: '/ledger/:id', name: 'acc-account', component: Stub },
      { path: '/journals/:id', name: 'acc-voucher', component: Stub },
    ],
  })
  await router.push(opts.path ?? '/ledger-reports')
  await router.isReady()
  const w = mount(defineComponent({ render: () => h(RouterView) }), { attachTo: document.body, global: { plugins: [router] } })
  mounted = w
  await flushPromises()
  return { w, router }
}
type W = Awaited<ReturnType<typeof setup>>['w']
const card = (w: W, title: string) => w.findAll('section.cw-card').find((s) => s.find('h3')?.text() === title)!
const GL = 'General ledger detail'
const JL = 'Journal listing'
const button = (c: ReturnType<typeof card>, text: string) => c.findAll('button').find((b) => b.text().includes(text))!

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(2026, 8, 30, 12, 0, 0))
  document.body.innerHTML = ''
  api.generalLedgerReport.mockResolvedValue(glReport())
  api.journalListing.mockResolvedValue(listing())
})
afterEach(() => { mounted?.unmount(); mounted = null; vi.useRealTimers() })

describe('the general ledger report', () => {
  it('asks for the selected year, the reporting book and the default range, one page of accounts', async () => {
    await setup()
    expect(api.generalLedgerReport).toHaveBeenCalledTimes(1)
    expect(api.generalLedgerReport).toHaveBeenCalledWith({
      financial_year_id: 'y1', currency: 'USD', from: '2026-01-01', to: '2026-09-30', limit: 25, offset: 0,
    })
  })

  it('shows brought forward, entries, totals and carried forward in the one book, with links', async () => {
    const { w } = await setup()
    const c = card(w, GL)
    const rows = c.findAll('tbody tr').map((r) => r.text())
    expect(rows[0]).toContain('Brought forward')
    expect(rows[0]).toContain('1 500.00 Dr')
    expect(c.text()).toContain('Carried forward')
    expect(c.text()).toContain('Entry 1')
    const links = c.findAllComponents(RouterLink)
    expect(links.map((l) => l.props('to'))).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'acc-account', params: { id: 'a1' } }),
      expect.objectContaining({ name: 'acc-voucher', params: { id: 'v1' } }),
    ]))
  })

  it('sends the currency from the book switch and never shows both books', async () => {
    const { w, router } = await setup({ path: '/ledger-reports?gl_book=ZWG' })
    expect(api.generalLedgerReport.mock.calls[0][0].currency).toBe('ZWG')
    const c = card(w, GL)
    const radios = c.findAll('[role="radio"]')
    expect(radios.map((r) => r.attributes('aria-checked'))).toEqual(['false', 'true'])
    expect(c.text()).toContain('ZWG book')
    expect(c.text()).not.toContain('USD book')
    await radios[0].trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.gl_book).toBe('USD')
    expect(api.generalLedgerReport.mock.calls.at(-1)![0].currency).toBe('USD')
  })

  it('shows a Cr brought-forward balance as Cr, marked against an asset account', async () => {
    api.generalLedgerReport.mockResolvedValue(glReport({
      accounts: [glAccount('a1', '1200', 'Bank CBZ', 'asset', { brought_forward: cr('300.00'), carried_forward: cr('200.00') })],
    }))
    const { w } = await setup()
    const bf = card(w, GL).find('.st-bf')
    expect(bf.text()).toContain('300.00 Cr')
    expect(bf.text()).toContain('against its usual side')
  })

  it('says "against its usual side" in words on an entry row too, not by colour alone (WCAG 1.4.1)', async () => {
    api.generalLedgerReport.mockResolvedValue(glReport({
      accounts: [glAccount('a1', '1200', 'Bank CBZ', 'asset', { entries: [{ ...line(1, dr('40.00')), balance: cr('40.00') }, line(2, dr('60.00'))] })],
    }))
    const { w } = await setup()
    const entryRows = card(w, GL).findAll('tbody tr').filter((r) => !r.classes().some((c) => c.startsWith('st-')))
    expect(entryRows).toHaveLength(2)
    expect(entryRows[0].text()).toContain('40.00 Cr')
    expect(entryRows[0].find('.is-contra').text()).toContain('against its usual side')
    expect(entryRows[1].text()).toContain('60.00 Dr')
    expect(entryRows[1].text()).not.toContain('against its usual side')
  })

  it('marks no side on a nil balance', async () => {
    api.generalLedgerReport.mockResolvedValue(glReport({
      accounts: [glAccount('a1', '1200', 'Bank CBZ', 'asset', { brought_forward: dr('0.00'), entries: [] })],
    }))
    const { w } = await setup()
    const bf = card(w, GL).find('.st-bf').text()
    expect(bf).toContain('0.00')
    expect(bf).not.toMatch(/\b(Dr|Cr)\b/)
  })

  it('applies filters to the query and the request, and returns to the first page', async () => {
    api.generalLedgerReport.mockResolvedValue(glReport())
    const { w, router } = await setup({ path: '/ledger-reports?gl_offset=25' })
    expect(api.generalLedgerReport.mock.calls[0][0].offset).toBe(25)
    const c = card(w, GL)
    await c.find('#gl-root').setValue('asset')
    await c.find('#gl-afrom').setValue('1000')
    await c.find('#gl-ato').setValue('1999')
    await c.find('form').trigger('submit')
    await flushPromises()
    const q = router.currentRoute.value.query
    expect(q).toMatchObject({ gl_root: 'asset', gl_afrom: '1000', gl_ato: '1999' })
    expect(q.gl_offset).toBeUndefined()
    expect(api.generalLedgerReport).toHaveBeenLastCalledWith({
      financial_year_id: 'y1', currency: 'USD', from: '2026-01-01', to: '2026-09-30',
      root_type: 'asset', account_from: '1000', account_to: '1999', limit: 25, offset: 0,
    })
  })

  it('drives dates from the date range and ignores dates outside the year', async () => {
    const { w, router } = await setup({ path: '/ledger-reports?gl_from=2019-01-01&gl_to=2031-01-01' })
    expect(api.generalLedgerReport.mock.calls[0][0]).toMatchObject({ from: '2026-01-01', to: '2026-09-30' })
    const c = card(w, GL)
    const dates = c.findAll('input[type="date"]')
    await dates[0].setValue('2026-02-01')
    await dates[1].setValue('2026-03-31')
    await c.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ gl_from: '2026-02-01', gl_to: '2026-03-31' })
    expect(api.generalLedgerReport).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2026-02-01', to: '2026-03-31' }))
  })

  it('pages by accounts', async () => {
    const { w, router } = await setup()
    expect(card(w, GL).find('.pg-text').text()).toBe('1–25 of 60')
    await button(card(w, GL), 'Next').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.gl_offset).toBe('25')
    expect(api.generalLedgerReport).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 25, limit: 25 }))
  })

  it('exports the same filters without limit or offset', async () => {
    api.generalLedgerReportCsv.mockResolvedValue(new Blob(['x']))
    const { w } = await setup({ path: '/ledger-reports?gl_root=asset&gl_offset=25' })
    await button(card(w, GL), 'Export CSV').trigger('click')
    await flushPromises()
    expect(api.generalLedgerReportCsv).toHaveBeenCalledWith({
      financial_year_id: 'y1', currency: 'USD', from: '2026-01-01', to: '2026-09-30', root_type: 'asset',
    })
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'general-ledger-usd-2026-01-01-2026-09-30.csv')
  })

  it('shows the message of a 413 Blob refusal and saves nothing', async () => {
    api.generalLedgerReportCsv.mockRejectedValue({
      response: { status: 413, data: new Blob([JSON.stringify({ message: 'Too many rows. Narrow the dates.' })]) },
    })
    const { w } = await setup()
    await button(card(w, GL), 'Export CSV').trigger('click')
    await flushPromises()
    expect(card(w, GL).find('[role="alert"]').text()).toContain('Too many rows. Narrow the dates.')
    expect(saveBlob).not.toHaveBeenCalled()
  })

  it('falls back to a plain sentence when the refusal cannot be read', async () => {
    api.generalLedgerReportCsv.mockRejectedValue(new Error('network'))
    const { w } = await setup()
    await button(card(w, GL), 'Export CSV').trigger('click')
    await flushPromises()
    expect(card(w, GL).find('[role="alert"]').text()).toContain('The export could not be made.')
  })

  it('keeps the newest answer when an earlier request finishes last', async () => {
    const slow = deferred<ReturnType<typeof glReport>>()
    api.generalLedgerReport.mockReturnValueOnce(slow.promise)
    const { w, router } = await setup()
    api.generalLedgerReport.mockResolvedValueOnce(glReport({ accounts: [glAccount('a2', '1300', 'Petty cash', 'asset')] }))
    await router.replace({ query: { gl_book: 'ZWG' } })
    await flushPromises()
    expect(card(w, GL).text()).toContain('Petty cash')
    slow.resolve(glReport({ accounts: [glAccount('a1', '1200', 'Bank CBZ', 'asset')] }))
    await flushPromises()
    expect(card(w, GL).text()).toContain('Petty cash')
    expect(card(w, GL).text()).not.toContain('Bank CBZ')
  })

  it('shows loading, then an empty state with what to do next', async () => {
    const slow = deferred<ReturnType<typeof glReport>>()
    api.generalLedgerReport.mockReturnValueOnce(slow.promise)
    const { w } = await setup()
    expect(card(w, GL).find('[data-test="gl-loading"]').exists()).toBe(true)
    slow.resolve(glReport({ accounts: [], total_accounts: 0 }))
    await flushPromises()
    expect(card(w, GL).find('[data-test="gl-loading"]').exists()).toBe(false)
    expect(card(w, GL).find('[data-test="gl-empty"]').text()).toContain('Widen the dates')
  })

  it('shows an error with Retry that asks again', async () => {
    api.generalLedgerReport.mockRejectedValueOnce({})
    const { w } = await setup()
    const alert = card(w, GL).find('[role="alert"]')
    expect(alert.text()).toContain('could not be loaded')
    api.generalLedgerReport.mockResolvedValueOnce(glReport())
    await button(card(w, GL), 'Retry').trigger('click')
    await flushPromises()
    expect(card(w, GL).find('[role="alert"]').exists()).toBe(false)
    expect(card(w, GL).text()).toContain('Bank CBZ')
  })
})

describe('the journal listing', () => {
  it('asks for the selected year and the default range, one page of vouchers', async () => {
    await setup()
    expect(api.journalListing).toHaveBeenCalledWith({ financial_year_id: 'y1', from: '2026-01-01', to: '2026-09-30', limit: 50, offset: 0 })
  })

  it('shows each voucher with its lines, in its own currency, and links the voucher number', async () => {
    const { w } = await setup()
    const c = card(w, JL)
    expect(c.text()).toContain('JV-000001')
    expect(c.text()).toContain('5000 Salaries')
    expect(c.text()).toContain('Prepared by Pat Preparer, posted by Sam Poster')
    expect(c.findAllComponents(RouterLink).map((l) => l.props('to'))).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: 'acc-voucher', params: { id: 'j1' } })]))
  })

  it('renders the totals as one row per currency and no combined row', async () => {
    const { w } = await setup()
    const rows = card(w, JL).findAll('table[aria-label="Totals by currency"] tbody tr')
    expect(rows.map((r) => r.attributes('data-currency'))).toEqual(['USD', 'ZWG'])
    expect(rows[0].text()).toContain('250.00')
    expect(rows[1].text()).toContain('900.00')
    expect(card(w, JL).text()).not.toContain('1 150.00')
    expect(card(w, JL).text()).not.toContain('1,150.00')
  })

  it('applies filters to the query and the request, and returns to the first page', async () => {
    const { w, router } = await setup({ path: '/ledger-reports?jl_offset=50' })
    expect(api.journalListing.mock.calls[0][0].offset).toBe(50)
    const c = card(w, JL)
    await c.find('#jl-type').setValue('receipt')
    await c.find('#jl-status').setValue('posted')
    await c.find('#jl-book').setValue('ZWG')
    await c.find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query).toMatchObject({ jl_type: 'receipt', jl_status: 'posted', jl_book: 'ZWG' })
    expect(router.currentRoute.value.query.jl_offset).toBeUndefined()
    expect(api.journalListing).toHaveBeenLastCalledWith({
      financial_year_id: 'y1', from: '2026-01-01', to: '2026-09-30', voucher_type: 'receipt', status: 'posted', currency: 'ZWG', limit: 50, offset: 0,
    })
  })

  it('exports the same filters without limit or offset, and shows a 413 Blob message', async () => {
    api.journalListingCsv.mockResolvedValueOnce(new Blob(['x']))
    const { w } = await setup({ path: '/ledger-reports?jl_status=posted&jl_offset=50' })
    await button(card(w, JL), 'Export CSV').trigger('click')
    await flushPromises()
    expect(api.journalListingCsv).toHaveBeenCalledWith({ financial_year_id: 'y1', from: '2026-01-01', to: '2026-09-30', status: 'posted' })
    expect(saveBlob).toHaveBeenCalledWith(expect.any(Blob), 'journal-listing-2026-01-01-2026-09-30.csv')
    api.journalListingCsv.mockRejectedValueOnce({ response: { status: 413, data: new Blob([JSON.stringify({ message: 'Too large. Narrow the dates.' })]) } })
    await button(card(w, JL), 'Export CSV').trigger('click')
    await flushPromises()
    expect(card(w, JL).find('[role="alert"]').text()).toContain('Too large. Narrow the dates.')
  })

  it('keeps the newest answer when an earlier request finishes last', async () => {
    const slow = deferred<ReturnType<typeof listing>>()
    api.journalListing.mockReturnValueOnce(slow.promise)
    const { w, router } = await setup()
    api.journalListing.mockResolvedValueOnce(listing({ vouchers: [voucher('j9', 'JV-000009', 'USD')], total: 1 }))
    await router.replace({ query: { jl_status: 'draft' } })
    await flushPromises()
    expect(card(w, JL).text()).toContain('JV-000009')
    slow.resolve(listing())
    await flushPromises()
    expect(card(w, JL).text()).toContain('JV-000009')
    expect(card(w, JL).text()).not.toContain('JV-000001')
  })

  it('shows loading, empty and error states', async () => {
    const slow = deferred<ReturnType<typeof listing>>()
    api.journalListing.mockReturnValueOnce(slow.promise)
    const { w } = await setup()
    expect(card(w, JL).find('[data-test="jl-loading"]').exists()).toBe(true)
    slow.resolve(listing({ vouchers: [], total: 0, totals: [] }))
    await flushPromises()
    expect(card(w, JL).find('[data-test="jl-empty"]').text()).toContain('No vouchers match')
  })

  it('shows an error with Retry that asks again', async () => {
    api.journalListing.mockRejectedValueOnce({})
    const { w } = await setup()
    expect(card(w, JL).find('[role="alert"]').text()).toContain('The journal listing could not be loaded.')
    await button(card(w, JL), 'Retry').trigger('click')
    await flushPromises()
    expect(card(w, JL).find('[role="alert"]').exists()).toBe(false)
    expect(card(w, JL).text()).toContain('JV-000001')
  })
})

describe('paging while a report is loading', () => {
  it('ignores Next on a stale page: no offset skips the new filter set', async () => {
    const { w, router } = await setup({ path: '/ledger-reports?gl_offset=25' })
    const slow = deferred<ReturnType<typeof glReport>>()
    api.generalLedgerReport.mockReturnValueOnce(slow.promise)
    await card(w, GL).find('#gl-root').setValue('asset')
    await card(w, GL).find('form').trigger('submit')
    await flushPromises()
    expect(router.currentRoute.value.query.gl_offset).toBeUndefined()
    const next = button(card(w, GL), 'Next')
    expect(next.attributes('aria-disabled')).toBe('true')
    const calls = api.generalLedgerReport.mock.calls.length
    await next.trigger('click')
    await flushPromises()
    expect(api.generalLedgerReport.mock.calls.length).toBe(calls)
    expect(router.currentRoute.value.query.gl_offset).toBeUndefined()
    expect(api.generalLedgerReport.mock.calls.some((c) => c[0].offset === 50)).toBe(false)
    slow.resolve(glReport())
    await flushPromises()
    expect(button(card(w, GL), 'Next').attributes('aria-disabled')).toBeUndefined()
  })

  it('does the same for the journal listing', async () => {
    const { w, router } = await setup({ path: '/ledger-reports?jl_offset=50' })
    const slow = deferred<ReturnType<typeof listing>>()
    api.journalListing.mockReturnValueOnce(slow.promise)
    await card(w, JL).find('#jl-status').setValue('posted')
    await card(w, JL).find('form').trigger('submit')
    await flushPromises()
    const next = button(card(w, JL), 'Next')
    expect(next.attributes('aria-disabled')).toBe('true')
    expect(button(card(w, JL), 'Previous').attributes('aria-disabled')).toBe('true')
    const calls = api.journalListing.mock.calls.length
    await next.trigger('click')
    await flushPromises()
    expect(api.journalListing.mock.calls.length).toBe(calls)
    expect(api.journalListing.mock.calls.some((c) => c[0].offset === 100)).toBe(false)
    expect(router.currentRoute.value.query.jl_offset).toBeUndefined()
    slow.resolve(listing())
    await flushPromises()
    expect(button(card(w, JL), 'Next').attributes('aria-disabled')).toBeUndefined()
  })
})

describe('both reports together', () => {
  it('keeps the query keys independent: a filter on one resets only its own offset', async () => {
    const { w, router } = await setup({ path: '/ledger-reports?gl_offset=25&jl_offset=50&jl_status=draft' })
    await card(w, GL).find('#gl-root').setValue('revenue')
    await card(w, GL).find('form').trigger('submit')
    await flushPromises()
    let q = router.currentRoute.value.query
    expect(q.gl_offset).toBeUndefined()
    expect(q.jl_offset).toBe('50')
    expect(q.jl_status).toBe('draft')
    expect(api.journalListing).toHaveBeenCalledTimes(1)

    await card(w, JL).find('#jl-status').setValue('posted')
    await card(w, JL).find('form').trigger('submit')
    await flushPromises()
    q = router.currentRoute.value.query
    expect(q.jl_offset).toBeUndefined()
    expect(q.gl_root).toBe('revenue')
    expect(api.generalLedgerReport).toHaveBeenCalledTimes(2)
  })

  it('prints only its own report: the scope is set when window.print runs and cleared after', async () => {
    const seen: (string | null)[] = []
    const { w } = await setup()
    const scope = () => document.body.querySelector('[data-print]')?.getAttribute('data-print') ?? null
    window.print = vi.fn(() => { seen.push(scope()) })
    await button(card(w, GL), 'Print').trigger('click')
    await flushPromises()
    window.dispatchEvent(new Event('afterprint'))
    await flushPromises()
    expect(scope()).toBeNull()
    await button(card(w, JL), 'Print').trigger('click')
    await flushPromises()
    expect(seen).toEqual(['gl', 'jl'])
    window.dispatchEvent(new Event('afterprint'))
    await flushPromises()
    expect(scope()).toBeNull()
    expect(card(w, JL).classes()).toContain('lr-jl')
    expect(card(w, GL).classes()).toContain('lr-gl')
    expect(w.find('.lr-bud').classes()).toContain('no-print')
  })

  it('keeps the shown figures labelled and formatted for the book they were drawn for until the new answer arrives', async () => {
    const { w, router } = await setup()
    expect(card(w, GL).text()).toContain('USD book')
    const slow = deferred<ReturnType<typeof glReport>>()
    api.generalLedgerReport.mockReturnValueOnce(slow.promise)
    await router.replace({ query: { gl_book: 'ZWG' } })
    await flushPromises()
    const c = card(w, GL)
    expect(c.text()).toContain('USD book')
    expect(c.text()).not.toContain('ZWG book')
    expect(c.find('.st-bf').text()).toContain('1 500.00 Dr')
    expect(c.findAllComponents(RouterLink)[0].props('to')).toMatchObject({ query: { book: 'USD' } })
    slow.resolve(glReport())
    await flushPromises()
    expect(card(w, GL).text()).toContain('ZWG book')
    expect(card(w, GL).text()).not.toContain('USD book')
  })

  it('states which slice and which filters are on the page', async () => {
    const { w } = await setup({ path: '/ledger-reports?jl_status=posted&jl_type=receipt&gl_offset=25' })
    expect(card(w, GL).find('.lr-asline').text()).toContain('Accounts 26–50 of 60')
    const line = card(w, JL).find('[data-test="jl-asline"]').text()
    expect(line).toContain('Receipt')
    expect(line).toContain('posted')
    expect(line).toContain('both currencies')
    expect(line).toContain('Vouchers 1–50 of 120')
  })

  it('makes no request and asks for a year when none is selected', async () => {
    const { w } = await setup({ year: null })
    expect(api.generalLedgerReport).not.toHaveBeenCalled()
    expect(api.journalListing).not.toHaveBeenCalled()
    expect(w.text()).toContain('Choose a financial year in the banner above.')
  })

  it('links to the budget and management reports when a workspace serves them', async () => {
    const { w } = await setup()
    const link = w.findAllComponents(RouterLink).find((l) => l.text().includes('budget and management reports'))!
    expect(link.props('to')).toEqual({ name: 'acc-reports' })
    expect(w.find('[data-test="reports-reason"]').exists()).toBe(false)
  })

  it('shows the reason as plain text, with no link, when no workspace serves reports', async () => {
    const { w } = await setup({ serves: false })
    expect(w.find('[data-test="reports-reason"]').text()).toBe(UNAVAILABLE_REASON)
    expect(w.findAllComponents(RouterLink).some((l) => l.text().includes('budget and management'))).toBe(false)
    expect(w.text()).toContain('Budget and management reports')
  })
})
