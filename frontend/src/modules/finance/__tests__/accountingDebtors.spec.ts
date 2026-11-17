// @vitest-environment happy-dom
//
// Debtors (ageing), a debtor's statement with Credit note and Write-off, and Parties.
//   1. ONE BOOK AT A TIME: no figure spans USD and ZWG.
//   2. FIGURES ARE THE SERVER'S, as sent; a reconciliation difference is an alert in words.
//   3. A CREDIT NOTE OR WRITE-OFF IS A DRAFT through the guided dialog; the open figure moves only when posted.
//   4. EVERY CAPABILITY OF THE OLD SUPPLIER SCREEN SURVIVES ON PARTIES.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h, type Component } from 'vue'

vi.mock('../api/ledgerApi', () => ({
  ledgerApi: {
    debtorAgeing: vi.fn(), accounts: vi.fn(), parties: vi.fn(), periods: vi.fn(), createVoucher: vi.fn(),
    createParty: vi.fn(), updateParty: vi.fn(),
  },
}))
vi.mock('../api/accountingApi', () => ({ accountingApi: { partyStatement: vi.fn() } }))

import { ledgerApi } from '../api/ledgerApi'
import { accountingApi } from '../api/accountingApi'
import DebtorsPage from '../workspaces/accountant/pages/DebtorsPage.vue'
import DebtorStatementPage from '../workspaces/accountant/pages/DebtorStatementPage.vue'
import PartiesPage from '../workspaces/accountant/pages/PartiesPage.vue'
import GuidedJournalDialog from '../workspaces/accountant/kit/GuidedJournalDialog.vue'
import AccountPicker from '../workspaces/accountant/kit/AccountPicker.vue'
import { resetLedgerLists } from '../workspaces/accountant/kit/useLedgerLists'
import { accountantRoutes } from '../workspaces/accountant/routes'
import { useFinanceStore } from '../stores/finance'
import { formatDate } from '../composables/useMoney'

const api = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const acc = accountingApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })
const VIEW = ['finance.ledger.view']
const PREPARE = [...VIEW, 'finance.ledger.voucher.prepare']
const MANAGE = [...VIEW, 'finance.ledger.party.manage']

const acct = (over: Record<string, unknown>) => ({
  id: 'x', code: '0', name: 'x', root_type: 'asset', report_type: 'balance_sheet', account_type: null, parent_id: null,
  is_group: false, is_postable: true, status: 'active', ...over,
})
const CHART = [
  acct({ id: 'rec1', code: '1200', name: 'Rates debtors', account_type: 'receivable' }),
  acct({ id: 'rev1', code: '4000', name: 'Rates income', root_type: 'revenue' }),
  acct({ id: 'exp1', code: '5900', name: 'Bad debts', root_type: 'expense' }),
  acct({ id: 'bank1', code: '1000', name: 'Bank', account_type: 'bank' }),
]
const PARTY = { id: 'p1', party_type: 'ratepayer', name: 'Mr Moyo', reference: 'R-77', status: 'active', address_text: '4 Main Street' }
const period = { id: 'per1', financial_year_id: 'y1', period_no: 1, label: 'P1', from_date: '1990-01-01', to_date: '2099-12-31', status: 'open', closed_at: null, locked_at: null }

const recon = (over: Record<string, unknown> = {}) => ({
  currency: 'USD', rows: 2, ageing_total: '300.00', control_balance: '300.00', control_accounts: 1, control_codes: '1200', difference: '0.00', agrees: true, ...over,
})
const ageing = (over: Record<string, unknown> = {}) => ({
  bills: [], total: 3, limit: 500, offset: 0,
  by_bucket: [
    { currency: 'USD', ageing_bucket: 'current', rows: 1, outstanding_amount: '100.00' },
    { currency: 'USD', ageing_bucket: '61_90', rows: 1, outstanding_amount: '200.00' },
    { currency: 'USD', ageing_bucket: 'unallocated', rows: 1, outstanding_amount: '-50.00' },
    { currency: 'ZWG', ageing_bucket: 'current', rows: 1, outstanding_amount: '9999.00' },
  ],
  by_party: [
    { currency: 'USD', party_id: 'p1', party_name: 'Mr Moyo', party_reference: 'R-77', bill_count: 3, outstanding_amount: '250.00', oldest_days: 70 },
    { currency: 'ZWG', party_id: 'p2', party_name: 'Mrs Dube', party_reference: null, bill_count: 1, outstanding_amount: '9999.00', oldest_days: 5 },
  ],
  by_party_bucket: [
    { currency: 'USD', party_id: 'p1', ageing_bucket: 'current', outstanding_amount: '100.00' },
    { currency: 'USD', party_id: 'p1', ageing_bucket: '61_90', outstanding_amount: '200.00' },
    { currency: 'USD', party_id: 'p1', ageing_bucket: 'unallocated', outstanding_amount: '-50.00' },
    { currency: 'ZWG', party_id: 'p2', ageing_bucket: 'current', outstanding_amount: '9999.00' },
  ],
  reconciliation: [recon(), recon({ currency: 'ZWG', ageing_total: '9999.00', control_balance: '9999.00' })],
  buckets: [], as_at: '2026-11-16', note: '', ...over,
})
const dr = (a: string) => ({ net_debit: a, amount: a, side: 'Dr' as const })
const item = (over: Record<string, unknown> = {}) => ({
  voucher_id: 'v1', voucher_no: 'RB-0000012', voucher_type: 'receipt_bill', posting_date: '2026-08-01',
  billed_amount: '300.00', settled_amount: '180.00', outstanding_amount: '120.00', days_outstanding: 107, ageing_bucket: '91_180', ...over,
})
const statement = (over: Record<string, unknown> = {}) => ({
  party: PARTY, currency: 'USD', kind: 'receivable', brought_forward: dr('10.00'),
  entries: [{
    id: 'e1', voucher_id: 'v1', voucher_no: 'RB-0000012', voucher_type: 'journal', posting_date: '2026-08-01', narration: 'Rates 2026',
    party_id: 'p1', party_name: 'Mr Moyo', debit: '300.00', credit: '0.00', balance: dr('310.00'), reconciled: null, account_code: '1200',
  }],
  carried_forward: dr('310.00'), open_items: [item()], as_at: '2026-11-16', ...over,
})

let wrappers: VueWrapper[] = []
async function setup(page: Component, path: string, opts: { permissions?: string[]; year?: string | null } = {}) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: opts.permissions ?? PREPARE, department_scope: [], catalogue: [] }
  store.selectedYearId = opts.year === undefined ? 'y1' : opts.year
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/receivable', name: 'acc-receivable', component: page },
      { path: '/receivable/:partyId', name: 'acc-debtor', component: page },
      { path: '/payable/:partyId', name: 'acc-creditor', component: Stub },
      { path: '/parties', name: 'acc-parties', component: page },
      { path: '/journals/:id', name: 'acc-voucher', component: Stub },
    ],
  })
  await router.push(path)
  await router.isReady()
  const w = mount(page, { attachTo: document.body, global: { plugins: [router] } })
  wrappers.push(w)
  await flushPromises()
  return { w, router }
}
const button = (w: VueWrapper, text: string) => w.findAll('button').find(b => b.text() === text)
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null
const field = (id: string) => document.body.querySelector(`#${id}`) as HTMLInputElement
async function type(id: string, v: string) { const el = field(id); el.value = v; el.dispatchEvent(new Event('input')); await flushPromises() }
const saveDraft = async () => {
  (Array.from(document.body.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Save as draft') as HTMLElement).click()
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  resetLedgerLists()
  document.body.innerHTML = ''
  api.debtorAgeing.mockResolvedValue(ageing())
  api.accounts.mockResolvedValue({ accounts: CHART })
  api.parties.mockResolvedValue({ parties: [PARTY], total: 1, limit: 200, offset: 0, note: null })
  api.periods.mockResolvedValue({ periods: [period], total: 1 })
  api.createVoucher.mockResolvedValue({ voucher: { id: 'v9', voucher_no: 'CN-000009' } })
  api.createParty.mockResolvedValue({ ...PARTY })
  api.updateParty.mockResolvedValue({ ...PARTY })
  acc.partyStatement.mockResolvedValue(statement())
})
afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers = []; vi.restoreAllMocks() })

describe('Debtors: the ageing', () => {
  it('reads the ageing once with the brief parameters and shows one book at a time', async () => {
    const { w } = await setup(DebtorsPage, '/receivable?book=USD')
    expect(api.debtorAgeing).toHaveBeenCalledWith({ currency: 'USD', outstanding_only: true, limit: 500 })
    expect(w.text()).toContain('Mr Moyo')
    expect(w.text()).toContain('250.00')
    expect(w.text()).not.toContain('Mrs Dube')
    expect(w.text()).not.toContain('9999.00')
    const zwg = await setup(DebtorsPage, '/receivable?book=ZWG')
    expect(zwg.w.text()).toContain('Mrs Dube')
    expect(zwg.w.text()).not.toContain('Mr Moyo')
  })
  it('reads the ageing for the chosen book and again when the book changes', async () => {
    const { router } = await setup(DebtorsPage, '/receivable?book=ZWG')
    expect(api.debtorAgeing).toHaveBeenLastCalledWith({ currency: 'ZWG', outstanding_only: true, limit: 500 })
    await router.replace({ query: { book: 'USD' } }); await flushPromises()
    expect(api.debtorAgeing).toHaveBeenLastCalledWith({ currency: 'USD', outstanding_only: true, limit: 500 })
    expect(api.debtorAgeing).toHaveBeenCalledTimes(2)
  })
  it('reloads for the effective book when the default book resolves late', async () => {
    await setup(DebtorsPage, '/receivable')
    expect(api.debtorAgeing).toHaveBeenLastCalledWith({ currency: 'USD', outstanding_only: true, limit: 500 })
    useFinanceStore().years = [{ id: 'y1', label: 'FY', start_date: '2026-01-01', end_date: '2026-12-31', reporting_currency: 'ZWG' }] as never
    await flushPromises()
    expect(api.debtorAgeing).toHaveBeenLastCalledWith({ currency: 'ZWG', outstanding_only: true, limit: 500 })
  })
  it('says how many debtors are listed when the server cap is reached', async () => {
    const many = Array.from({ length: 200 }, (_, n) => ({ currency: 'USD', party_id: `q${n}`, party_name: `Debtor ${n}`, party_reference: null, bill_count: 1, outstanding_amount: '1.00', oldest_days: 1 }))
    api.debtorAgeing.mockResolvedValue(ageing({ by_party: many }))
    const { w } = await setup(DebtorsPage, '/receivable?book=USD')
    expect(w.text()).toContain('The 200 largest debtors are listed; the totals row covers every debtor in this book.')
  })
  it('does not claim nobody owes when the control total is not zero but no rows came back', async () => {
    api.debtorAgeing.mockResolvedValue(ageing({ by_party: [], by_party_bucket: [] }))
    const { w } = await setup(DebtorsPage, '/receivable?book=USD')
    expect(w.text()).toContain('The debtors in this book could not be listed.')
    expect(w.text()).not.toContain('Nobody owes')
  })
  it('shows the six age columns and a column for unallocated receipts', async () => {
    const { w } = await setup(DebtorsPage, '/receivable?book=USD')
    const heads = w.findAll('th').map(t => t.text())
    for (const h of ['Current', '31 to 60 days', '61 to 90 days', '91 to 180 days', '181 to 365 days', 'Over 365 days', 'Unallocated receipts']) expect(heads).toContain(h)
    expect(w.text()).toContain('\u221250.00')
  })
  it('says the ageing agrees with the control account, in words and not as an alert', async () => {
    const { w } = await setup(DebtorsPage, '/receivable?book=USD')
    expect(w.text()).toContain('Agrees with the control account 1200')
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
  it('renders a reconciliation difference in words with the server figure (a state of the data, not an alert)', async () => {
    api.debtorAgeing.mockResolvedValue(ageing({ reconciliation: [recon({ agrees: false, difference: '12.50', control_balance: '287.50' })] }))
    const { w } = await setup(DebtorsPage, '/receivable?book=USD')
    expect(w.text()).toContain('Differs from the control account 1200 by')
    expect(w.text()).toContain('12.50')
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
  it('links each debtor row to acc-debtor', async () => {
    const { w } = await setup(DebtorsPage, '/receivable?book=USD')
    const link = w.findAll('a').find(a => a.text().includes('Mr Moyo'))!
    expect(link.attributes('href')).toBe('/receivable/p1?book=USD')
  })
  it('shows a loading state, an empty state, an error with Retry and the no-year state', async () => {
    let resolve!: (v: unknown) => void
    api.debtorAgeing.mockReturnValueOnce(new Promise(r => { resolve = r }))
    const a = await setup(DebtorsPage, '/receivable')
    expect(a.w.find('[aria-busy="true"]').exists()).toBe(true)
    resolve(ageing({ by_party: [], by_party_bucket: [], by_bucket: [], reconciliation: [] })); await flushPromises()
    expect(a.w.text()).toContain('Nobody owes the council')
    api.debtorAgeing.mockRejectedValueOnce({ response: { data: { message: 'Database away' } } })
    const b = await setup(DebtorsPage, '/receivable')
    expect(b.w.find('[role="alert"]').text()).toContain('Database away')
    await button(b.w, 'Retry')!.trigger('click'); await flushPromises()
    expect(b.w.find('[role="alert"]').exists()).toBe(false)
    api.debtorAgeing.mockClear()
    const c = await setup(DebtorsPage, '/receivable', { year: null })
    expect(api.debtorAgeing).not.toHaveBeenCalled()
    expect(c.w.text()).toContain('Choose a financial year in the banner above.')
  })
  it('drops a slow earlier answer (out of order)', async () => {
    let first!: (v: unknown) => void
    api.debtorAgeing.mockReturnValueOnce(new Promise(r => { first = r }))
    const { w } = await setup(DebtorsPage, '/receivable?book=USD')
    api.debtorAgeing.mockResolvedValueOnce(ageing({
      by_party: [{ currency: 'USD', party_id: 'p3', party_name: 'Newer Debtor', party_reference: null, bill_count: 1, outstanding_amount: '5.00', oldest_days: 1 }],
    }))
    useFinanceStore().selectedYearId = 'y2'
    await flushPromises()
    first(ageing()); await flushPromises()
    expect(w.text()).toContain('Newer Debtor')
    expect(w.text()).not.toContain('Mr Moyo')
  })
})

describe('the debtor statement', () => {
  it('shows brought forward, each entry with its running balance, carried forward and the open item as sent', async () => {
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    expect(acc.partyStatement).toHaveBeenCalledWith('p1', { currency: 'USD' })
    const t = w.text()
    expect(t).toContain('Brought forward')
    expect(t).toContain('10.00 Dr')
    expect(t).toContain('310.00 Dr')
    expect(t).toContain('Carried forward')
    expect(t).toContain('120.00')
    expect(t).toContain('4 Main Street')
  })
  it('prints the statement with window.print', async () => {
    const print = vi.fn()
    window.print = print
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await button(w, 'Print statement')!.trigger('click')
    expect(print).toHaveBeenCalledTimes(1)
    expect(w.find('.print-only').text()).toContain('Statement of account')
  })
  it('drops a slow earlier statement (out of order)', async () => {
    let first!: (v: unknown) => void
    acc.partyStatement.mockReturnValueOnce(new Promise(r => { first = r }))
    const { w, router } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    acc.partyStatement.mockResolvedValueOnce(statement({ currency: 'ZWG', carried_forward: dr('777.00'), brought_forward: dr('0.00'), entries: [], open_items: [] }))
    await router.replace({ query: { book: 'ZWG' } }); await flushPromises()
    first(statement()); await flushPromises()
    expect(w.text()).toContain('777.00 Dr')
    expect(w.text()).not.toContain('310.00 Dr')
  })
  it('shows loading, empty open items, an error with Retry and the no-year state', async () => {
    let resolve!: (v: unknown) => void
    acc.partyStatement.mockReturnValueOnce(new Promise(r => { resolve = r }))
    const a = await setup(DebtorStatementPage, '/receivable/p1')
    expect(a.w.find('[aria-busy="true"]').exists()).toBe(true)
    resolve(statement({ open_items: [], entries: [] })); await flushPromises()
    expect(a.w.text()).toContain('Nothing is open in the USD book.')
    acc.partyStatement.mockRejectedValueOnce({ response: { data: { message: 'Statement away' } } })
    const b = await setup(DebtorStatementPage, '/receivable/p1')
    expect(b.w.find('[role="alert"]').text()).toContain('Statement away')
    await button(b.w, 'Retry')!.trigger('click'); await flushPromises()
    expect(b.w.find('[role="alert"]').exists()).toBe(false)
    acc.partyStatement.mockClear()
    const c = await setup(DebtorStatementPage, '/receivable/p1', { year: null })
    expect(acc.partyStatement).not.toHaveBeenCalled()
    expect(c.w.text()).toContain('Choose a financial year in the banner above.')
  })
  it('renders no Credit note or Write-off without the prepare permission and says why', async () => {
    const { w } = await setup(DebtorStatementPage, '/receivable/p1', { permissions: VIEW })
    expect(button(w, 'Credit note')).toBeUndefined()
    expect(w.text()).toContain(useFinanceStore().whyUnavailable('finance.ledger.voucher.prepare'))
  })
  it('labels the open items with the date they are as at, whatever the statement dates', async () => {
    acc.partyStatement.mockResolvedValue(statement({ as_at: '2026-11-16' }))
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?from=2026-01-01&to=2026-03-31')
    const heading = w.find('[aria-label="Open items"] h3').text()
    expect(heading).toBe('Open items as at ' + formatDate('2026-11-16'))
  })
  it('offers neither on an unallocated receipt', async () => {
    acc.partyStatement.mockResolvedValue(statement({ open_items: [item({ outstanding_amount: '-50.00', ageing_bucket: 'unallocated' })] }))
    const { w } = await setup(DebtorStatementPage, '/receivable/p1')
    expect(w.findAll('button').filter(b => /Credit note|Write-off/.test(b.attributes('aria-label') ?? '')).length).toBe(0)
  })

  const rowsText = (w: VueWrapper) => w.find('[aria-label="Open items"]').text()
  it('uses the server ledger_account_id as the fixed account when it is sent', async () => {
    api.accounts.mockResolvedValue({ accounts: [...CHART, acct({ id: 'rec2', code: '1210', name: 'Other debtors', account_type: 'receivable' })] })
    acc.partyStatement.mockResolvedValue(statement({ open_items: [item({ ledger_account_id: 'rec2' })] }))
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await openDoc(w, 'Credit note')
    await fill(w, 'rev1', '10.00')
    await saveDraft()
    expect(api.createVoucher.mock.calls[0][0].lines[1]).toMatchObject({ ledger_account_id: 'rec2', credit: '10.00' })
  })
  it('refuses to guess when the bill has entries on more than one receivable account', async () => {
    const e = statement().entries[0]
    acc.partyStatement.mockResolvedValue(statement({ entries: [e, { ...e, id: 'e2', account_code: '1210' }] }))
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    expect(w.find('button[aria-label^="Credit note"]').exists()).toBe(false)
    expect(rowsText(w)).toContain('This bill spans more than one receivable account; raise the credit note as a journal.')
  })
  it('tells the person to clear the dates when the bill entry is outside the range', async () => {
    acc.partyStatement.mockResolvedValue(statement({ entries: [] }))
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD&from=2026-10-01')
    expect(w.find('button[aria-label^="Credit note"]').exists()).toBe(false)
    expect(rowsText(w)).toContain('Clear the dates to raise a credit note against this bill.')
  })
  it('says so when the chart of accounts could not be read', async () => {
    api.accounts.mockRejectedValue({ response: { data: { message: 'Chart away' } } })
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    expect(w.find('button[aria-label^="Credit note"]').exists()).toBe(false)
    expect(rowsText(w)).toContain('The chart of accounts could not be read')
  })
  it('says the chart is loading while it loads, and that the account is not in the chart when it is missing', async () => {
    let resolve!: (v: unknown) => void
    api.accounts.mockReturnValueOnce(new Promise(r => { resolve = r }))
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    expect(rowsText(w)).toContain('Loading the chart of accounts')
    expect(rowsText(w)).not.toContain('could not be read')
    resolve({ accounts: CHART }); await flushPromises()
    expect(w.find('button[aria-label^="Credit note"]').exists()).toBe(true)
    acc.partyStatement.mockResolvedValue(statement({ open_items: [item({ ledger_account_id: 'gone' })] }))
    const again = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    expect(rowsText(again.w)).toContain('is not in the active chart')
  })
  it('keeps the dialog while a save is in flight, shows the outcome naming the bill and party, then closes', async () => {
    let done!: (v: unknown) => void
    api.createVoucher.mockReturnValueOnce(new Promise(r => { done = r }))
    const { w, router } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await openDoc(w, 'Credit note')
    await fill(w, 'rev1', '10.00')
    await saveDraft()
    await router.replace({ query: { book: 'USD', from: '2026-01-01' } }); await flushPromises()
    expect(dialog()).not.toBeNull()
    done({ voucher: { id: 'v9', voucher_no: 'CN-000009' } }); await flushPromises()
    expect(w.text()).toContain('Credit note CN-000009 saved as a draft for Mr Moyo.')
    expect(dialog()).toBeNull()
  })
  it('says the save failed, naming the bill and party, when a change arrived mid-save', async () => {
    let fail!: (v: unknown) => void
    api.createVoucher.mockReturnValueOnce(new Promise((_, rej) => { fail = rej }))
    const { w, router } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await openDoc(w, 'Write-off')
    await fill(w, 'exp1', '10.00')
    await saveDraft()
    await router.replace({ query: { book: 'USD', to: '2026-12-31' } }); await flushPromises()
    fail({ response: { data: { message: 'Period closed' } } }); await flushPromises()
    expect(w.text()).toContain('The write-off against RB-0000012 for Mr Moyo was not saved: Period closed')
    expect(w.text()).not.toContain('Check Journals')
    expect(dialog()).toBeNull()
  })
  it('does not start the next dialog busy after a pending success', async () => {
    let done!: (v: unknown) => void
    api.createVoucher.mockReturnValueOnce(new Promise(r => { done = r }))
    const { w, router } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await openDoc(w, 'Credit note')
    await fill(w, 'rev1', '10.00')
    await saveDraft()
    await router.replace({ query: { book: 'USD', from: '2026-01-01' } }); await flushPromises()
    done({ voucher: { id: 'v9', voucher_no: 'CN-000009' } }); await flushPromises()
    expect(dialog()).toBeNull()
    await openDoc(w, 'Write-off')
    expect(dialog()).not.toBeNull()
    await router.replace({ query: { book: 'USD', from: '2026-02-01' } }); await flushPromises()
    expect(dialog()).toBeNull()
  })
  it('closes the dialog when the financial year changes', async () => {
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await openDoc(w, 'Credit note')
    expect(dialog()).not.toBeNull()
    useFinanceStore().selectedYearId = 'y2'; await flushPromises()
    expect(dialog()).toBeNull()
  })
  it('reloads for the effective book when the default book resolves late', async () => {
    const { w } = await setup(DebtorStatementPage, '/receivable/p1')
    expect(acc.partyStatement).toHaveBeenLastCalledWith('p1', { currency: 'USD' })
    useFinanceStore().years = [{ id: 'y1', label: 'FY', start_date: '2026-01-01', end_date: '2026-12-31', reporting_currency: 'ZWG' }] as never
    await flushPromises()
    expect(acc.partyStatement).toHaveBeenLastCalledWith('p1', { currency: 'ZWG' })
    void w
  })
  it('has no duplicate row keys when one voucher sits on two receivable accounts', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    acc.partyStatement.mockResolvedValue(statement({ open_items: [item({ ledger_account_id: 'rec1' }), item({ ledger_account_id: 'rec2' })] }))
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    expect(w.findAll('button[aria-label^="Credit note"]').length).toBe(1)
    expect(warn.mock.calls.filter(c => String(c[0]).includes('Duplicate'))).toEqual([])
  })
  it('closes the dialog and clears the notice when the book, the party or the dates change', async () => {
    const { w, router } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await openDoc(w, 'Credit note')
    await fill(w, 'rev1', '10.00')
    await saveDraft()
    expect(w.text()).toContain('saved as a draft for Mr Moyo')
    expect(dialog()).not.toBeNull()
    await router.replace({ query: { book: 'ZWG' } }); await flushPromises()
    expect(dialog()).toBeNull()
    expect(w.text()).not.toContain('saved as a draft for Mr Moyo')
    await openDoc(w, 'Write-off')
    expect(dialog()).not.toBeNull()
    await router.push('/receivable/p2?book=ZWG'); await flushPromises()
    expect(dialog()).toBeNull()
    await openDoc(w, 'Write-off')
    await router.replace({ query: { book: 'ZWG', from: '2026-01-01' } }); await flushPromises()
    expect(dialog()).toBeNull()
  })

  async function openDoc(w: VueWrapper, label: string) {
    await w.find(`button[aria-label^="${label}"]`).trigger('click'); await flushPromises()
  }
  const picker = (w: VueWrapper) => w.findComponent(GuidedJournalDialog).findAllComponents(AccountPicker)[0]
  const pickerIds = (w: VueWrapper) => {
    const p = picker(w)
    return (p.props('accounts') as typeof CHART).filter(p.props('filter') as (a: unknown) => boolean).map(a => a.id)
  }
  async function fill(w: VueWrapper, counter: string, amount: string) {
    picker(w).vm.$emit('update:modelValue', counter)
    await flushPromises()
    await type('gj-amount', amount)
  }

  it('posts a Credit note draft: voucher_type credit_note, counter debited, receivable credited, party and bill named', async () => {
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await openDoc(w, 'Credit note')
    expect(dialog()).not.toBeNull()
    expect(pickerIds(w)).toEqual(['rev1'])
    await fill(w, 'rev1', '100.00')
    await saveDraft()
    expect(api.createVoucher).toHaveBeenCalledTimes(1)
    const body = api.createVoucher.mock.calls[0][0]
    expect(body).toMatchObject({ voucher_type: 'credit_note', currency: 'USD', financial_year_id: 'y1' })
    expect(body.lines).toHaveLength(2)
    expect(body.lines[0]).toEqual({ ledger_account_id: 'rev1', debit: '100.00' })
    expect(body.lines[1]).toEqual({ ledger_account_id: 'rec1', credit: '100.00', party_id: 'p1', against_voucher_id: 'v1' })
  })
  it('reloads the statement after saving and says the open figure moves only when posted', async () => {
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await openDoc(w, 'Credit note')
    await fill(w, 'rev1', '100.00')
    await saveDraft()
    expect(acc.partyStatement).toHaveBeenCalledTimes(2)
    expect(w.text()).toContain('Credit note CN-000009 saved as a draft for Mr Moyo. The open figure changes when it is posted.')
  })
  it('refuses an amount over the open figure in words and saves nothing', async () => {
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await openDoc(w, 'Credit note')
    await fill(w, 'rev1', '120.01')
    await saveDraft()
    expect(api.createVoucher).not.toHaveBeenCalled()
    expect(document.body.querySelector('[role="dialog"] [role="alert"]')!.textContent).toContain('More than the')
    expect(document.body.querySelector('[role="dialog"] [role="alert"]')!.textContent).toContain('still open on RB-0000012.')
    expect(document.body.querySelector('[role="dialog"] [role="alert"]')!.textContent).toContain('120.00')
    expect(document.body.querySelector('[role="dialog"]')!.textContent).toContain('Mr Moyo')
  })
  it('accepts exactly the open figure', async () => {
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await openDoc(w, 'Credit note')
    await fill(w, 'rev1', '120.00')
    await saveDraft()
    expect(api.createVoucher).toHaveBeenCalledTimes(1)
  })
  it('posts a Write-off draft with voucher_type write_off and offers only expense accounts', async () => {
    const { w } = await setup(DebtorStatementPage, '/receivable/p1?book=USD')
    await openDoc(w, 'Write-off')
    expect(pickerIds(w)).toEqual(['exp1'])
    await fill(w, 'exp1', '50.00')
    await saveDraft()
    const body = api.createVoucher.mock.calls[0][0]
    expect(body.voucher_type).toBe('write_off')
    expect(body.lines[0]).toEqual({ ledger_account_id: 'exp1', debit: '50.00' })
    expect(body.lines[1]).toEqual({ ledger_account_id: 'rec1', credit: '50.00', party_id: 'p1', against_voucher_id: 'v1' })
  })
})

describe('Parties', () => {
  it('lists suppliers by default and reads them with the supplier type', async () => {
    const { w } = await setup(PartiesPage, '/parties', { permissions: MANAGE })
    expect(api.parties).toHaveBeenCalledWith({ party_type: 'supplier', limit: 200 })
    expect(w.findAll('[role="tab"]').map(t => t.text())).toEqual(['Suppliers', 'Debtors', 'Ratepayers', 'Employees', 'Other'])
    expect(w.find('[role="tab"][aria-selected="true"]').text()).toBe('Suppliers')
  })
  it('follows ?type= and the tabs', async () => {
    const { w, router } = await setup(PartiesPage, '/parties?type=debtor', { permissions: MANAGE })
    expect(api.parties).toHaveBeenLastCalledWith({ party_type: 'debtor', limit: 200 })
    await w.findAll('[role="tab"]').find(t => t.text() === 'Employees')!.trigger('click'); await flushPromises()
    expect(router.currentRoute.value.query.type).toBe('employee')
    expect(api.parties).toHaveBeenLastCalledWith({ party_type: 'employee', limit: 200 })
  })
  it('creates with the chosen type', async () => {
    const { w } = await setup(PartiesPage, '/parties?type=debtor', { permissions: MANAGE })
    await button(w, 'New debtor')!.trigger('click'); await flushPromises()
    const select = document.body.querySelector('[role="dialog"] select') as HTMLSelectElement
    expect(select.value).toBe('debtor')
    select.value = 'ratepayer'; select.dispatchEvent(new Event('change'))
    const name = document.body.querySelector('[role="dialog"] input[required]') as HTMLInputElement
    name.value = 'Mrs Ncube'; name.dispatchEvent(new Event('input'))
    await flushPromises()
    ;(document.body.querySelector('[role="dialog"] button[type="submit"]') as HTMLElement).click()
    await flushPromises()
    expect(api.createParty).toHaveBeenCalledWith(expect.objectContaining({ party_type: 'ratepayer', name: 'Mrs Ncube' }))
  })
  it('links each debtor and ratepayer row to acc-debtor, and a supplier to its creditor statement', async () => {
    api.parties.mockResolvedValue({ parties: [PARTY, { ...PARTY, id: 's1', party_type: 'supplier', name: 'Acme' }], total: 2, limit: 200, offset: 0, note: null })
    const { w } = await setup(PartiesPage, '/parties?type=ratepayer', { permissions: MANAGE })
    expect(w.findAll('a').find(a => a.text() === 'Mr Moyo')!.attributes('href')).toBe('/receivable/p1')
    expect(w.findAll('a').find(a => a.text() === 'Acme')!.attributes('href')).toBe('/payable/s1')
  })
  it('keeps the supplier capabilities: search, edit with status, contact fields, active pill', async () => {
    api.parties.mockResolvedValue({ parties: [{ ...PARTY, id: 's1', party_type: 'supplier', name: 'Acme', contact_name: 'Ann', contact_phone: '0771', contact_email: 'a@x.zw' }], total: 1, limit: 200, offset: 0, note: null })
    const { w } = await setup(PartiesPage, '/parties', { permissions: MANAGE })
    expect(w.text()).toContain('Ann'); expect(w.text()).toContain('0771'); expect(w.text()).toContain('a@x.zw'); expect(w.text()).toContain('Active')
    const search = w.find('input[aria-label="Search suppliers"]')
    await search.setValue('acm'); await w.find('form[role="search"]').trigger('submit'); await flushPromises()
    expect(api.parties).toHaveBeenLastCalledWith({ party_type: 'supplier', limit: 200, q: 'acm' })
    await w.find('button[aria-label="Edit Acme"]').trigger('click'); await flushPromises()
    const sel = document.body.querySelector('[role="dialog"] select') as HTMLSelectElement
    sel.value = 'inactive'; sel.dispatchEvent(new Event('change')); await flushPromises()
    ;(document.body.querySelector('[role="dialog"] button[type="submit"]') as HTMLElement).click(); await flushPromises()
    expect(api.updateParty).toHaveBeenCalledWith('s1', expect.objectContaining({ name: 'Acme', contact_name: 'Ann', status: 'inactive' }))
  })
  it('shows no New or Edit control without party.manage', async () => {
    const { w } = await setup(PartiesPage, '/parties', { permissions: VIEW })
    expect(button(w, 'New supplier')).toBeUndefined()
    expect(w.find('button[aria-label^="Edit"]').exists()).toBe(false)
  })
  it('shows the saved-failure message as sent', async () => {
    api.createParty.mockRejectedValueOnce({ response: { data: { message: 'Reference already used' } } })
    const { w } = await setup(PartiesPage, '/parties', { permissions: MANAGE })
    await button(w, 'New supplier')!.trigger('click'); await flushPromises()
    const name = document.body.querySelector('[role="dialog"] input[required]') as HTMLInputElement
    name.value = 'Acme'; name.dispatchEvent(new Event('input')); await flushPromises()
    ;(document.body.querySelector('[role="dialog"] button[type="submit"]') as HTMLElement).click(); await flushPromises()
    expect(document.body.querySelector('[role="dialog"] [role="alert"]')!.textContent).toContain('Reference already used')
  })
  it('shows loading, empty, error with Retry', async () => {
    let resolve!: (v: unknown) => void
    api.parties.mockReturnValueOnce(new Promise(r => { resolve = r }))
    const a = await setup(PartiesPage, '/parties', { permissions: MANAGE })
    expect(a.w.find('[aria-busy="true"]').exists()).toBe(true)
    resolve({ parties: [], total: 0, limit: 200, offset: 0, note: null }); await flushPromises()
    expect(a.w.text()).toContain('No suppliers.')
    expect(a.w.text()).toContain('Add the first with New supplier.')
    api.parties.mockRejectedValueOnce({ response: { data: { message: 'Register away' } } })
    const b = await setup(PartiesPage, '/parties', { permissions: MANAGE })
    expect(b.w.find('[role="alert"]').text()).toContain('Register away')
    await button(b.w, 'Retry')!.trigger('click'); await flushPromises()
    expect(b.w.find('[role="alert"]').exists()).toBe(false)
  })
  it('drops a slow earlier answer when the type changes (out of order)', async () => {
    let first!: (v: unknown) => void
    api.parties.mockReturnValueOnce(new Promise(r => { first = r }))
    const { w, router } = await setup(PartiesPage, '/parties', { permissions: MANAGE })
    api.parties.mockResolvedValueOnce({ parties: [{ ...PARTY, name: 'Newer Debtor', party_type: 'debtor' }], total: 1, limit: 200, offset: 0, note: null })
    await router.replace({ query: { type: 'debtor' } }); await flushPromises()
    first({ parties: [{ ...PARTY, id: 's1', party_type: 'supplier', name: 'Old Supplier' }], total: 1, limit: 200, offset: 0, note: null }); await flushPromises()
    expect(w.text()).toContain('Newer Debtor')
    expect(w.text()).not.toContain('Old Supplier')
  })
})

describe('routes', () => {
  const children = accountantRoutes[0].children!
  const named = (n: string) => children.find(r => r.name === n)!
  it('points the debtor pages at their screens and keeps the sidebar parent', () => {
    expect(named('acc-receivable').path).toBe('receivable')
    expect(named('acc-debtor').path).toBe('receivable/:partyId')
    expect((named('acc-debtor').meta as { cwNav: string }).cwNav).toBe('acc-receivable')
  })
  it('redirects acc-suppliers to Parties with ?type=supplier', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/s', name: 'acc-suppliers', redirect: named('acc-suppliers').redirect as never }, { path: '/p', name: 'acc-parties', component: Stub }] })
    await router.push('/s')
    expect(router.currentRoute.value.name).toBe('acc-parties')
    expect(router.currentRoute.value.query.type).toBe('supplier')
  })
})
