// @vitest-environment happy-dom
//
// The accountant's dashboard, built around the accountant's day: work waiting, the books, cash and
// bank, debtors and creditors, recent postings. Reconciliation shows the real state, books are
// checked per currency, and a task or alert with nowhere to go is text rather than a dead link.
import { describe, it, expect, beforeEach, vi } from 'vitest'

// The dashboard mounts the whole page per test; under a full parallel suite a mount can pass 5 s.
vi.setConfig({ testTimeout: 30_000 })
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('@/services/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('../api/accountingApi', () => ({ accountingApi: { dashboard: vi.fn() } }))
vi.mock('../api/cashApi', () => ({ cashApi: { desk: vi.fn(), verifySession: vi.fn(), returnSession: vi.fn() } }))
vi.mock('../workspaces/shared/usePortal', () => ({ usePortalInbox: () => ({ inbox: { unread: 0 } }) }))

import { accountingApi } from '../api/accountingApi'
import AccountantDashboard from '../workspaces/accountant/pages/AccountantDashboard.vue'
import SectionPage from '../workspaces/accountant/pages/SectionPage.vue'
import { resetAccountant, useAccountant } from '../workspaces/accountant/useAccountant'
import { useFinanceStore } from '../stores/finance'

const api = accountingApi as unknown as { dashboard: ReturnType<typeof vi.fn> }
const Stub = defineComponent({ render: () => h('div') })
const NAMES = ['acc-dashboard', 'acc-journal-new', 'acc-salaries', 'acc-cashbook', 'acc-bank', 'acc-trial', 'acc-reports', 'acc-close', 'acc-voucher',
  'acc-payable', 'acc-assets', 'acc-cashups', 'acc-journals', 'acc-ledger', 'acc-votebook', 'acc-receivable', 'acc-banking', 'acc-revenue', 'acc-messages']

function makeRouter() {
  const routes = NAMES.map((name) => ({
    name, component: Stub,
    path: name === 'acc-voucher' ? '/v/:id' : name === 'acc-dashboard' ? '/' : `/${name}`,
  }))
  return createRouter({ history: createMemoryHistory(), routes })
}

const dash = (over: Record<string, unknown> = {}) => ({
  year: { id: 'y1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open', prior_year_id: null },
  flows: [], banks: [], budget: [], position: [], receivables: [], payables: [], payables_configured: true,
  cashups: [], own_cashups: 0, tasks: [], items_requiring_action: 0, recent: [], current_period: null, alerts: [],
  books: [{ currency: 'USD', balances: true, difference: '0.00' }], readiness: null,
  ...over,
})
const bank = (over: Record<string, unknown> = {}) => ({
  id: 'b1', code: '1100', name: 'Main account', currency: 'USD', balance: '100.00', last_entry: '2026-11-01',
  reconciled_to: null, unreconciled_entries: 0, ...over,
})

function setup(perms: string[] = ['finance.ledger.view', 'finance.ledger.voucher.prepare'], year: string | null = 'y1') {
  const store = useFinanceStore()
  store.identity = { user_id: 'u1', role: 'accountant', authority_id: 1, permissions: perms, department_scope: [], catalogue: [] } as never
  store.selectedYearId = year
  return store
}
async function mountPage(data: unknown, comp: unknown = AccountantDashboard) {
  api.dashboard.mockResolvedValue(data)
  // The layout loads the shared dashboard; the page only reads it.
  resetAccountant()
  await useAccountant().loadDashboard(useFinanceStore().selectedYearId)
  const router = makeRouter()
  await router.push('/')
  const w = mount(comp as never, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  resetAccountant()
})

describe('the accountant dashboard', () => {
  it('shows no "not built" text and no hard-coded Unreconciled', async () => {
    const { w } = await mountPage(dash({ banks: [bank({ reconciled_to: '2026-10-31' })] }))
    setup()
    expect(w.text().toLowerCase()).not.toContain('not built')
    expect(w.text()).not.toMatch(/\bUnreconciled\b/)
  })

  it('shows the real reconciliation state of each bank and links it to the cashbook', async () => {
    setup()
    const { w } = await mountPage(dash({ banks: [
      bank({ reconciled_to: '2026-10-31' }),
      bank({ id: 'b2', name: 'Savings', reconciled_to: null, unreconciled_entries: 3 }),
    ] }))
    const items = w.findAll('.acc-banks li')
    expect(items[0].text()).toContain('Reconciled to 31 October 2026')
    expect(items[1].text()).toContain('Never reconciled')
    expect(items[1].text()).toContain('3 entries not reconciled')
    expect(items[0].text()).not.toContain('not reconciled')
    expect(items[0].find('a').attributes('href')).toBe('/acc-cashbook?account=b1')
    expect(items[1].find('a').attributes('href')).toBe('/acc-cashbook?account=b2')
  })

  it('links each recent posting to its voucher', async () => {
    setup()
    const { w } = await mountPage(dash({ recent: [{ id: 'v9', posting_date: '2026-11-02', voucher_no: 'JV-0009', voucher_type: 'journal', currency: 'USD', description: 'x', amount: '5.00', cash_effect: '0.00' }] }))
    const a = w.findAll('a').find((x) => x.text() === 'JV-0009')
    expect(a?.attributes('href')).toBe('/v/v9')
  })

  it('renders an out-of-balance book as an alert and an in-balance one as a status', async () => {
    setup()
    const { w } = await mountPage(dash({ books: [
      { currency: 'USD', balances: false, difference: '12.50' },
      { currency: 'ZWG', balances: true, difference: '0.00' },
    ] }))
    const al = w.find('.acc-bookslist [role="alert"]')
    expect(al.text()).toContain('Out of balance by')
    expect(al.text()).toContain('12.50')
    expect(w.find('.acc-bookslist [role="status"]').text()).toContain('In balance')
  })

  it('routes payables, assets and bank tasks, and leaves an unknown key as text', async () => {
    setup()
    const { w } = await mountPage(dash({ tasks: [
      { key: 'payables', count: 2, text: 'Two invoices' }, { key: 'assets', count: 1, text: 'One run' },
      { key: 'bank', count: 1, text: 'One statement' }, { key: 'mystery', count: 1, text: 'Something odd' },
    ] }))
    const href = (t: string) => w.findAll('.acc-tasks a').find((a) => a.text().includes(t))?.attributes('href')
    expect(href('Two invoices')).toBe('/acc-payable')
    expect(href('One run')).toBe('/acc-assets')
    expect(href('One statement')).toBe('/acc-bank')
    expect(w.text()).toContain('Something odd')
    expect(href('Something odd')).toBeUndefined()
  })

  it('reports readiness: ready, outstanding, or nothing', async () => {
    setup()
    const period = { id: 'p1', label: 'Period 11', to_date: '2026-11-30', days_left: 14 }
    let { w } = await mountPage(dash({ current_period: period, readiness: { ready: true, outstanding: 0 } }))
    expect(w.text()).toContain('Ready to close')
    ;({ w } = await mountPage(dash({ current_period: period, readiness: { ready: false, outstanding: 3 } })))
    const link = w.findAll('a').find((a) => a.text().includes('3 things outstanding'))
    expect(link?.attributes('href')).toBe('/acc-close')
    expect(w.text()).not.toContain('Ready to close')
    ;({ w } = await mountPage(dash({ current_period: period, readiness: null })))
    expect(w.text()).not.toContain('Ready to close')
    expect(w.text()).not.toContain('outstanding')
  })

  it('offers New journal only to someone who can prepare', async () => {
    setup()
    let { w } = await mountPage(dash())
    expect(w.findAll('.acc-qa').map((a) => a.text())).toContain('New journal')
    expect(w.findAll('.acc-qa').map((a) => a.text())).toContain('Salaries journal')
    setActivePinia(createPinia())
    setup(['finance.ledger.view'])
    ;({ w } = await mountPage(dash()))
    expect(w.findAll('.acc-qa').map((a) => a.text())).not.toContain('New journal')
    expect(w.findAll('.acc-qa').map((a) => a.text())).not.toContain('Salaries journal')
    expect(w.text()).toContain('journal preparer permission')
    expect(w.findAll('.acc-qa').map((a) => a.text())).toEqual(['Record payment', 'Bank reconciliation', 'Trial balance', 'Vote book', 'Period close'])
  })

  it('renders alerts as sent, with a role by tone', async () => {
    setup()
    const { w } = await mountPage(dash({ alerts: [
      { tone: 'neg', key: 'bank', text: 'Main account was never reconciled.' },
      { tone: 'warn', key: 'periods', text: 'Period 11 ends soon.' },
      { tone: 'info', key: 'other', text: 'FYI only.' },
    ] }))
    const lis = w.findAll('.acc-alerts li')
    // The role sits on an inner element so the list item keeps its own role.
    expect(lis.every((li) => li.attributes('role') === undefined)).toBe(true)
    expect(lis[0].find('[role="alert"]').text()).toBe('Main account was never reconciled.')
    expect(lis[1].find('[role="status"]').text()).toBe('Period 11 ends soon.')
    expect(lis[2].find('[role="status"]').text()).toBe('FYI only.')
    expect(lis[0].text()).toBe('Main account was never reconciled.')
    expect(lis[2].find('a').exists()).toBe(false)
  })

  it('shows loading, not the old year, while a year switch is in flight, and ignores out-of-order answers', async () => {
    const store = setup()
    await mountPage(dash({ tasks: [{ key: 'payables', count: 1, text: 'Year one task' }] }))
    const router = makeRouter()
    await router.push('/')
    const w = mount(AccountantDashboard, { global: { plugins: [router] } })
    await flushPromises()
    expect(w.text()).toContain('Year one task')

    const resolvers: Array<(v: unknown) => void> = []
    api.dashboard.mockImplementation(() => new Promise((r) => { resolvers.push(r) }))
    const year = (id: string, label: string, text: string) => dash({ year: { ...dash().year, id, label }, tasks: [{ key: 'payables', count: 1, text }] })
    store.selectedYearId = 'y2'
    void useAccountant().loadDashboard('y2')
    await flushPromises()
    expect(w.text()).not.toContain('Year one task')
    expect(w.find('.cw-skel').exists()).toBe(true)
    store.selectedYearId = 'y3'
    void useAccountant().loadDashboard('y3')
    await flushPromises()
    resolvers[1](year('y3', '2028', 'Year three task'))
    await flushPromises()
    resolvers[0](year('y2', '2027', 'Year two task'))
    await flushPromises()
    expect(w.text()).toContain('Year three task')
    expect(w.text()).not.toContain('Year two task')
    expect(w.find('.cw-skel').exists()).toBe(false)
  })

  it('shows the error and no old-year figures when a year switch fails', async () => {
    const store = setup()
    await mountPage(dash({ tasks: [{ key: 'payables', count: 1, text: 'Year one task' }] }))
    const router = makeRouter()
    await router.push('/')
    const w = mount(AccountantDashboard, { global: { plugins: [router] } })
    await flushPromises()
    api.dashboard.mockRejectedValue(new Error('boom'))
    store.selectedYearId = 'y2'
    await useAccountant().loadDashboard('y2')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(true)
    expect(w.text()).not.toContain('Year one task')
    api.dashboard.mockResolvedValue(dash())
    await w.find('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('keeps a load still in flight at logout from writing the old council into the state', async () => {
    setup()
    let resolve!: (v: unknown) => void
    api.dashboard.mockImplementation(() => new Promise((r) => { resolve = r }))
    const pending = useAccountant().loadDashboard('y1')
    resetAccountant()
    resolve(dash({ tasks: [{ key: 'payables', count: 1, text: 'Old council task' }] }))
    await pending
    expect(useAccountant().state.dashboard).toBeNull()
    expect(useAccountant().state.loading).toBe(false)
    expect(useAccountant().state.error).toBeNull()
  })

  it('drops held figures on a load with no year named when they are not the selected year', async () => {
    setup(undefined, 'y2')
    useAccountant().state.dashboard = dash() as never
    api.dashboard.mockReturnValue(new Promise(() => {}))
    void useAccountant().loadDashboard(null)
    expect(useAccountant().state.dashboard).toBeNull()
  })

  it('keeps held figures while a null-year load is pending and no year is selected', async () => {
    setup(undefined, null)
    useAccountant().state.dashboard = dash() as never
    api.dashboard.mockReturnValue(new Promise(() => {}))
    void useAccountant().loadDashboard(null)
    expect(useAccountant().state.dashboard).not.toBeNull()
  })

  it('keeps held figures on a null-year load for the selected year (the tick)', async () => {
    setup(undefined, 'y1')
    useAccountant().state.dashboard = dash() as never
    api.dashboard.mockReturnValue(new Promise(() => {}))
    void useAccountant().loadDashboard(null)
    expect(useAccountant().state.dashboard?.year.id).toBe('y1')
  })

  it('writes the response of a boot-style null load on an empty state', async () => {
    setup(undefined, null)
    api.dashboard.mockResolvedValue(dash())
    await useAccountant().loadDashboard(null)
    expect(useAccountant().state.dashboard?.year.id).toBe('y1')
  })

  it('shows the loading and no-year states', async () => {
    setup()
    api.dashboard.mockReturnValue(new Promise(() => {}))
    void useAccountant().loadDashboard('y1')
    const router = makeRouter()
    await router.push('/')
    const loading = mount(AccountantDashboard, { global: { plugins: [router] } })
    await flushPromises()
    expect(loading.find('.cw-skel').exists()).toBe(true)

    setActivePinia(createPinia())
    setup(['finance.ledger.view'], null)
    api.dashboard.mockClear()
    const none = mount(AccountantDashboard, { global: { plugins: [router] } })
    await flushPromises()
    expect(none.text()).toContain('Choose a financial year in the banner above.')
    expect(api.dashboard).not.toHaveBeenCalled()
  })

  it('says a period that has passed has ended, and one ending today ends today', async () => {
    setup()
    const p = (days_left: number) => ({ id: 'p1', label: 'Period 11', to_date: '2026-11-30', days_left })
    let { w } = await mountPage(dash({ current_period: p(-3) }))
    expect(w.text()).toContain('Ended 3 days ago')
    expect(w.text()).not.toContain('-3')
    ;({ w } = await mountPage(dash({ current_period: p(0) })))
    expect(w.text()).toContain('Ends today')
    ;({ w } = await mountPage(dash({ current_period: p(14) })))
    expect(w.text()).toContain('14 days left')
  })

  it('does not throw on an older response without books, readiness or reconciliation fields', async () => {
    setup()
    const old = dash({ banks: [{ id: 'b1', code: '1100', name: 'Main account', currency: 'USD', balance: '100.00', last_entry: null }], current_period: { id: 'p1', label: 'Period 11', to_date: '2026-11-30', days_left: 5 } }) as Record<string, unknown>
    delete old.books
    delete old.readiness
    const { w } = await mountPage(old)
    expect(w.find('.acc-books').exists()).toBe(false)
    expect(w.find('.acc-banks li').text()).toContain('Main account')
    expect(w.find('.acc-banks li').text()).not.toContain('Never reconciled')
    expect(w.find('.acc-banks li').text()).not.toContain('reconciled')
    expect(w.text()).not.toContain('Ready to close')
  })
})

describe('the bank table on the Bank Reconciliation page', () => {
  it('shows the real reconciliation state beside the Reconcile link', async () => {
    setup()
    const { useAccountant } = await import('../workspaces/accountant/useAccountant')
    useAccountant().state.dashboard = dash({ banks: [bank({ reconciled_to: '2026-10-31', unreconciled_entries: 2 }), bank({ id: 'b2', name: 'Savings' })] }) as never
    useAccountant().state.desk = {} as never
    api.dashboard.mockResolvedValue(dash({ banks: [bank({ reconciled_to: '2026-10-31', unreconciled_entries: 2 }), bank({ id: 'b2', name: 'Savings' })] }))
    const router = makeRouter()
    router.addRoute({ name: 'sec', path: '/sec', component: Stub, meta: { cwSection: 'bank', cwTitle: 'Bank Reconciliation' } })
    await router.push('/sec')
    const w = mount(SectionPage, { global: { plugins: [router], stubs: { Banking: true, CashBanking: true } } })
    await flushPromises()
    const rows = w.findAll('tbody tr')
    expect(rows[0].text()).toContain('Reconciled to 31 October 2026')
    expect(rows[0].text()).toContain('2 entries not reconciled')
    expect(rows[1].text()).toContain('Never reconciled')
  })

  it('joins the state cleanly when only the entry count is sent', async () => {
    setup()
    const { useAccountant } = await import('../workspaces/accountant/useAccountant')
    const b = { id: 'b1', code: '1100', name: 'Main', currency: 'USD', balance: '1.00', last_entry: null, unreconciled_entries: 2 }
    useAccountant().state.dashboard = dash({ banks: [b] }) as never
    useAccountant().state.desk = {} as never
    api.dashboard.mockResolvedValue(dash({ banks: [b] }))
    const router = makeRouter()
    router.addRoute({ name: 'sec', path: '/sec', component: Stub, meta: { cwSection: 'bank', cwTitle: 'Bank Reconciliation' } })
    await router.push('/sec')
    const w = mount(SectionPage, { global: { plugins: [router], stubs: { Banking: true, CashBanking: true } } })
    await flushPromises()
    const cell = w.findAll('tbody tr')[0].findAll('td')[3].text()
    expect(cell.startsWith('2 entries not reconciled')).toBe(true)
    expect(cell).not.toContain('·')
  })
})
