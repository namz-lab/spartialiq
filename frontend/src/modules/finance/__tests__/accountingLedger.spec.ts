// @vitest-environment happy-dom
//
// The General Ledger and the account page of the Accounting workspace. Its rules:
//
//   1. FIGURES ARE THE SERVER'S: every balance, a heading's sum and each running balance is shown as sent.
//   2. A BALANCE ON THE WRONG SIDE IS NEVER FLIPPED: it keeps its real Dr/Cr and is marked in words.
//   3. AN EMPTY CHART, OR NO YEAR, IS "NOT SET UP YET": no error, and with no year nothing is asked.
//   4. NO CONTROL THAT CAN ONLY 403: without the permission the page says who maintains the chart.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { defineComponent, h } from 'vue'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('../api/ledgerApi', () => ({
  ledgerApi: {
    chartBalances: vi.fn(), accountLedger: vi.fn(), accountBalance: vi.fn(), accountLedgerCsv: vi.fn(),
    createAccount: vi.fn(), updateAccount: vi.fn(), withdrawAccount: vi.fn(),
  },
}))

import { ledgerApi } from '../api/ledgerApi'
import GeneralLedgerPage, { collapsed } from '../workspaces/accountant/pages/GeneralLedgerPage.vue'
import AccountLedgerPage from '../workspaces/accountant/pages/AccountLedgerPage.vue'
import { useFinanceStore } from '../stores/finance'

const api = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })
const VIEWER = ['finance.ledger.view']
const MANAGER = ['finance.ledger.view', 'finance.ledger.account.manage']

const row = (over: Record<string, unknown>) => ({
  id: 'x', code: '0', name: 'x', root_type: 'asset', report_type: 'balance_sheet', account_type: null, parent_id: null,
  is_group: false, is_postable: true, status: 'active', notes: null, balances: [], ...over,
})
const bal = (currency: string, amount: string, side: 'Dr' | 'Cr') => ({
  currency, amount, side, net_debit: side === 'Dr' ? amount : `-${amount}`,
})
const chart = (accounts = [
  row({ id: 'g1', code: '1000', name: 'Current assets', is_group: true, is_postable: false, balances: [bal('USD', '750.00', 'Dr'), bal('ZWG', '5000.00', 'Dr')] }),
  row({ id: 'a1', code: '1200', name: 'Bank CBZ', parent_id: 'g1', account_type: 'bank', balances: [bal('USD', '1200.00', 'Dr'), bal('ZWG', '5000.00', 'Dr')] }),
  row({ id: 'a2', code: '1300', name: 'Petty cash', parent_id: 'g1', balances: [bal('USD', '450.00', 'Cr')] }),
  row({ id: 'r1', code: '4000', name: 'Rates', root_type: 'revenue', report_type: 'performance', balances: [bal('USD', '300.00', 'Cr')] }),
]) => ({ accounts, currencies: ['USD', 'ZWG'], as_at: '2026-12-31', closing: 'excluded' })

const lineOf = (n: number, balance: { net_debit: string; amount: string; side: 'Dr' | 'Cr' }, over: Record<string, unknown> = {}) => ({
  id: `e${n}`, voucher_id: `v${n}`, voucher_no: `RC-000000${n}`, voucher_type: 'receipt', posting_date: '2026-09-1' + n,
  narration: `Entry ${n}`, party_id: null, party_name: null, debit: '100.00', credit: '0.00', balance, reconciled: null, ...over,
})
const dr = (a: string) => ({ net_debit: a, amount: a, side: 'Dr' as const })
const ledger = (over: Record<string, unknown> = {}) => ({
  account: row({ id: 'a1', code: '1200', name: 'Bank CBZ', account_type: 'bank' }), natural_side: 'debit', currency: 'USD',
  from: '2026-01-01', to: '2026-12-31', brought_forward: dr('1000.00'),
  entries: [lineOf(1, dr('1100.00')), lineOf(2, dr('1200.00'))], totals: { debit: '200.00', credit: '0.00' },
  carried_forward: dr('1200.00'), total: 2, limit: 100, offset: 0, ...over,
})
const lifetime = (over: Record<string, unknown> = {}) => ({
  account: row({ id: 'a1', code: '1200', name: 'Bank CBZ' }), natural_side: 'debit',
  balances: [{ currency: 'USD', entry_count: 2, debit_total: '1200.00', credit_total: '0.00', net_debit: '1200.00', last_posting_date: '2026-09-12' }],
  by_financial_year: [], note: '', ...over,
})

async function setup(opts: { path: string; permissions?: string[]; year?: string | null; mount?: 'router' | 'cashbook' }) {
  const store = useFinanceStore()
  store.identity = {
    user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: opts.permissions ?? VIEWER, department_scope: [], catalogue: [],
  }
  store.selectedYearId = opts.year === undefined ? 'y1' : opts.year
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/ledger', name: 'acc-ledger', component: GeneralLedgerPage },
      { path: '/ledger/:id', name: 'acc-account', component: AccountLedgerPage },
      { path: '/journals/:id', name: 'acc-voucher', component: Stub },
      { path: '/migration', name: 'acc-migration', component: Stub },
    ],
  })
  await router.push(opts.path)
  await router.isReady()
  const root = opts.mount === 'cashbook'
    ? defineComponent({ render: () => h(AccountLedgerPage, { accountId: 'a1', mode: 'cashbook' }, { actions: () => h('button', { class: 'slot-action' }, 'Reconcile') }) })
    : defineComponent({ render: () => h(RouterView) })
  const w = mount(root, { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}
type W = Awaited<ReturnType<typeof setup>>['w']
const button = (w: W, text: string) => w.findAll('button').find((b) => b.text().includes(text))
const trOf = (w: W, text: string) => w.findAll('tbody tr').find((r) => r.text().includes(text))!

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  window.history.replaceState(null, '')
  document.body.innerHTML = ''
  api.accountBalance.mockResolvedValue(lifetime())
  collapsed.value = new Set()
})

describe('the General Ledger', () => {
  it("shows each book's balance beside the account and the heading's sum", async () => {
    api.chartBalances.mockResolvedValue(chart())
    const { w } = await setup({ path: '/ledger' })
    expect(api.chartBalances).toHaveBeenCalledWith({ financial_year_id: 'y1' })
    const heads = w.findAll('thead th').map((t) => t.text())
    expect(heads).toEqual(expect.arrayContaining(['Code and name', 'Type', 'USD balance', 'ZWG balance']))
    const bank = trOf(w, 'Bank CBZ').findAll('td').map((t) => t.text())
    expect(bank[2]).toBe('1,200.00 Dr'.replace(',', ' '))
    expect(bank[3]).toBe('5 000.00 Dr')
    const heading = trOf(w, 'Current assets').findAll('td')
    expect(heading[2].text()).toBe('750.00 Dr')
    expect(heading[3].text()).toBe('5 000.00 Dr')
    // Petty cash holds no ZWG: an empty cell, not an invented zero.
    expect(trOf(w, 'Petty cash').findAll('td')[3].text()).toBe('—')
    // The heading is not a link; the account is.
    expect(trOf(w, 'Current assets').find('a').exists()).toBe(false)
    expect(trOf(w, 'Bank CBZ').find('a').exists()).toBe(true)
  })

  it("marks a balance against the account's nature, in words, on its real side (Review Focus 2)", async () => {
    api.chartBalances.mockResolvedValue(chart())
    const { w } = await setup({ path: '/ledger' })
    const cell = trOf(w, 'Petty cash').findAll('td')[2]
    const contra = cell.find('.is-contra')
    expect(contra.exists()).toBe(true)
    expect(contra.text()).toContain('450.00 Cr')
    expect(contra.text()).not.toContain('Dr')
    expect(contra.text()).toContain('against its usual side')
    expect(contra.attributes('title')).toContain('opposite side')
    // The same side on a revenue account is its nature: not marked.
    expect(trOf(w, 'Rates').find('.is-contra').exists()).toBe(false)
    expect(trOf(w, 'Rates').findAll('td')[2].text()).toBe('300.00 Cr')
    // A normal asset balance is not marked either.
    expect(trOf(w, 'Bank CBZ').find('.is-contra').exists()).toBe(false)
  })

  it('opens the account on a row click, but not a heading', async () => {
    api.chartBalances.mockResolvedValue(chart())
    const { w, router } = await setup({ path: '/ledger' })
    await trOf(w, 'Current assets').trigger('click')
    expect(router.currentRoute.value.name).toBe('acc-ledger')
    await trOf(w, 'Bank CBZ').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('acc-account')
    expect(router.currentRoute.value.params.id).toBe('a1')
  })

  it('filters by search, root type and "with a balance only", keeping the headings above a match', async () => {
    api.chartBalances.mockResolvedValue(chart())
    const { w, router } = await setup({ path: '/ledger?q=petty' })
    expect(w.text()).toContain('Petty cash')
    expect(w.text()).toContain('Current assets')
    expect(w.text()).not.toContain('Bank CBZ')
    await router.replace({ query: { root: 'revenue' } })
    await flushPromises()
    expect(w.text()).toContain('Rates')
    expect(w.text()).not.toContain('Petty cash')
    await router.replace({ query: { q: 'zzz' } })
    await flushPromises()
    expect(w.text()).toContain('No account matches these filters.')
  })

  it('collapses a heading', async () => {
    api.chartBalances.mockResolvedValue(chart())
    const { w } = await setup({ path: '/ledger' })
    await w.find('button.gl-toggle').trigger('click')
    expect(w.text()).not.toContain('Bank CBZ')
    expect(w.find('button.gl-toggle').attributes('aria-expanded')).toBe('false')
    await w.find('button.gl-toggle').trigger('click')
    expect(w.text()).toContain('Bank CBZ')
  })

  it('offers account maintenance only with the permission, and says who maintains the chart otherwise', async () => {
    api.chartBalances.mockResolvedValue(chart())
    const viewer = await setup({ path: '/ledger', permissions: VIEWER })
    expect(viewer.w.text()).toContain('The chart is maintained by the accountant and the Director of Finance.')
    expect(button(viewer.w, 'New account')).toBeUndefined()
    expect(button(viewer.w, 'Edit')).toBeUndefined()
    expect(button(viewer.w, 'Withdraw')).toBeUndefined()
    viewer.w.unmount()
    document.body.innerHTML = ''

    const manager = await setup({ path: '/ledger', permissions: MANAGER })
    expect(manager.w.text()).not.toContain('The chart is maintained by')
    expect(button(manager.w, 'New account')).toBeDefined()
    expect(manager.w.findAll('button').filter((b) => b.text() === 'Edit').length).toBe(4)
  })

  it('adds an account and reloads the chart', async () => {
    api.chartBalances.mockResolvedValue(chart())
    api.createAccount.mockResolvedValue({ id: 'n1' })
    const { w } = await setup({ path: '/ledger', permissions: MANAGER })
    await button(w, 'New account')!.trigger('click')
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    await w.find('#ga-code').setValue('1400')
    await w.find('#ga-name').setValue('Stores')
    await w.find('#ga-type').setValue('inventory')
    await w.find('[role="dialog"]').trigger('submit')
    await flushPromises()
    expect(api.createAccount).toHaveBeenCalledWith({ code: '1400', name: 'Stores', root_type: 'asset', account_type: 'inventory' })
    expect(api.chartBalances).toHaveBeenCalledTimes(2)
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('edits an account without sending its code or root type', async () => {
    api.chartBalances.mockResolvedValue(chart())
    api.updateAccount.mockResolvedValue({})
    const { w } = await setup({ path: '/ledger', permissions: MANAGER })
    await w.find('button[aria-label="Edit 1200 Bank CBZ"]').trigger('click')
    await w.find('#ga-name').setValue('Bank CBZ current')
    await w.find('#ga-status').setValue('inactive')
    await w.find('[role="dialog"]').trigger('submit')
    await flushPromises()
    expect(api.updateAccount).toHaveBeenCalledWith('a1', { name: 'Bank CBZ current', account_type: 'bank', parent_id: 'g1', status: 'inactive', notes: null })
  })

  it("shows the server's refusal when an account with postings is withdrawn", async () => {
    api.chartBalances.mockResolvedValue(chart())
    api.withdrawAccount.mockRejectedValue({ response: { status: 409, data: { message: '2 entries posted to this account; it cannot be withdrawn.' } } })
    const { w } = await setup({ path: '/ledger', permissions: MANAGER })
    await w.find('button[aria-label="Withdraw 1200 Bank CBZ"]').trigger('click')
    await button(w, 'Withdraw account')!.trigger('click')
    await flushPromises()
    expect(api.withdrawAccount).toHaveBeenCalledWith('a1')
    const alert = w.find('[role="dialog"] [role="alert"]')
    expect(alert.text()).toContain('2 entries posted to this account; it cannot be withdrawn.')
  })

  it('keeps a collapsed heading collapsed after leaving the page and coming back (session state)', async () => {
    api.chartBalances.mockResolvedValue(chart())
    const first = await setup({ path: '/ledger' })
    await first.w.find('button.gl-toggle').trigger('click')
    expect(first.w.text()).not.toContain('Bank CBZ')
    first.w.unmount()
    document.body.innerHTML = ''
    const again = await setup({ path: '/ledger' })
    expect(again.w.text()).toContain('Current assets')
    expect(again.w.text()).not.toContain('Bank CBZ')
    expect(again.w.find('button.gl-toggle').attributes('aria-expanded')).toBe('false')
  })

  it('drops a slow earlier answer: the newer request wins', async () => {
    let first!: (v: unknown) => void, second!: (v: unknown) => void
    api.chartBalances
      .mockReturnValueOnce(new Promise((r) => { first = r }))
      .mockReturnValueOnce(new Promise((r) => { second = r }))
    const { w } = await setup({ path: '/ledger' })
    useFinanceStore().selectedYearId = 'y2'
    await flushPromises()
    expect(api.chartBalances).toHaveBeenCalledTimes(2)
    second(chart([row({ id: 'n', code: '9000', name: 'Newer year account' })]))
    await flushPromises()
    first(chart([row({ id: 'o', code: '8000', name: 'Older year account' })]))
    await flushPromises()
    expect(w.text()).toContain('Newer year account')
    expect(w.text()).not.toContain('Older year account')
  })

  it('lets only the latest request clear loading', async () => {
    let first!: (v: unknown) => void, second!: (v: unknown) => void
    api.chartBalances
      .mockReturnValueOnce(new Promise((r) => { first = r }))
      .mockReturnValueOnce(new Promise((r) => { second = r }))
    const { w } = await setup({ path: '/ledger' })
    useFinanceStore().selectedYearId = 'y2'
    await flushPromises()
    first(chart([row({ id: 'o', code: '8000', name: 'Older year account' })]))
    await flushPromises()
    expect(w.find('.cw-skel').exists()).toBe(true)
    expect(w.text()).not.toContain('Older year account')
    second(chart())
    await flushPromises()
    expect(w.find('.cw-skel').exists()).toBe(false)
    expect(w.text()).toContain('Bank CBZ')
  })

  it('does not mark a zero balance, which the server sends as Dr, on a credit-natural account', async () => {
    api.chartBalances.mockResolvedValue(chart([
      row({ id: 'r0', code: '4100', name: 'Fees', root_type: 'revenue', report_type: 'performance', balances: [bal('USD', '0.00', 'Dr')] }),
    ]))
    const { w } = await setup({ path: '/ledger' })
    const cell = trOf(w, 'Fees').findAll('td')[2]
    expect(cell.text()).toBe('0.00 Dr')
    expect(cell.find('.is-contra').exists()).toBe(false)
    expect(w.find('tbody').text()).not.toContain('against its usual side')
  })

  it('moves focus into the dialog, closes on Escape and returns focus to the trigger', async () => {
    api.chartBalances.mockResolvedValue(chart())
    const { w } = await setup({ path: '/ledger', permissions: MANAGER })
    const trigger = button(w, 'New account')!
    ;(trigger.element as HTMLElement).focus()
    await trigger.trigger('click')
    await flushPromises()
    const dialog = w.find('[role="dialog"]')
    expect(dialog.attributes('aria-modal')).toBe('true')
    // Named by its visible heading (aria-labelledby), so the name and the heading cannot disagree.
    expect(document.getElementById(dialog.attributes('aria-labelledby')!)!.textContent).toBe('New account')
    expect(document.activeElement?.id).toBe('ga-code')
    await dialog.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
  })

  it('lands focus on the edited account\'s row after a successful save, though the reload rebuilt the table', async () => {
    api.chartBalances.mockResolvedValue(chart())
    api.updateAccount.mockResolvedValue({})
    const { w } = await setup({ path: '/ledger', permissions: MANAGER })
    const edit = w.find('button[aria-label="Edit 1200 Bank CBZ"]')
    ;(edit.element as HTMLElement).focus()
    await edit.trigger('click')
    await flushPromises()
    await w.find('#ga-name').setValue('Bank CBZ main')
    await w.find('[role="dialog"]').trigger('submit')
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(edit.element.isConnected).toBe(false)
    const active = document.activeElement as HTMLElement
    expect(active).not.toBe(document.body)
    expect(active.closest('tr')?.getAttribute('data-account')).toBe('a1')
    expect(active.textContent).toBe('Edit')
    expect(w.find('[role="status"]').text()).toContain('1200 Bank CBZ main saved.')
  })

  it('lands focus on the status notice after a withdraw, since the row is gone', async () => {
    api.chartBalances
      .mockResolvedValueOnce(chart())
      .mockResolvedValueOnce(chart(chart().accounts.filter((a) => a.id !== 'a2')))
    api.withdrawAccount.mockResolvedValue({ withdrawn: 'a2' })
    const { w } = await setup({ path: '/ledger', permissions: MANAGER })
    await w.find('button[aria-label="Withdraw 1300 Petty cash"]').trigger('click')
    await flushPromises()
    await button(w, 'Withdraw account')!.trigger('click')
    await flushPromises()
    expect(w.find('tbody').text()).not.toContain('Petty cash')
    const notice = w.find('[role="status"]')
    expect(notice.text()).toContain('Account 1300 Petty cash withdrawn.')
    expect(document.activeElement).toBe(notice.element)
  })

  it('keeps Tab inside the dialog', async () => {
    api.chartBalances.mockResolvedValue(chart())
    const { w } = await setup({ path: '/ledger', permissions: MANAGER })
    await button(w, 'New account')!.trigger('click')
    await flushPromises()
    const items = [...document.querySelectorAll<HTMLElement>('[role="dialog"] input:not([disabled]), [role="dialog"] select:not([disabled]), [role="dialog"] textarea:not([disabled]), [role="dialog"] button:not([disabled])')]
    items.at(-1)!.focus()
    await w.find('[role="dialog"]').trigger('keydown', { key: 'Tab' })
    expect(document.activeElement).toBe(items[0])
    items[0].focus()
    await w.find('[role="dialog"]').trigger('keydown', { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(items.at(-1))
  })

  it('says the chart is not set up yet, and where it comes from, when it is empty (Review Focus 4)', async () => {
    api.chartBalances.mockResolvedValue(chart([]))
    const { w } = await setup({ path: '/ledger' })
    expect(w.text()).toContain('The chart of accounts is not set up yet.')
    expect(w.find('[role="alert"]').exists()).toBe(false)
    const link = w.findAll('a').find((a) => a.text().includes('Data Migration'))!
    expect(link.attributes('href')).toBe('/migration')
  })

  it('asks nothing and says to choose a year when none is selected (Review Focus 4)', async () => {
    const { w } = await setup({ path: '/ledger', year: null })
    expect(api.chartBalances).not.toHaveBeenCalled()
    expect(w.text()).toContain('Choose a financial year in the banner above.')
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('shows loading, then an error with Retry', async () => {
    let release!: (v: unknown) => void
    api.chartBalances.mockReturnValueOnce(new Promise((r) => { release = r }))
    const { w } = await setup({ path: '/ledger' })
    expect(w.find('.cw-skel').exists()).toBe(true)
    release(chart())
    await flushPromises()
    expect(w.find('.cw-skel').exists()).toBe(false)

    api.chartBalances.mockRejectedValueOnce({ response: { data: { message: 'The ledger is unavailable.' } } })
    const failed = await setup({ path: '/ledger' })
    expect(failed.w.find('[role="alert"]').text()).toContain('The ledger is unavailable.')
    api.chartBalances.mockResolvedValue(chart())
    await button(failed.w, 'Retry')!.trigger('click')
    await flushPromises()
    expect(failed.w.text()).toContain('Bank CBZ')
  })
})

describe('the account page', () => {
  it('renders brought forward, the running balance and carried forward as sent', async () => {
    api.accountLedger.mockResolvedValue(ledger())
    const { w } = await setup({ path: '/ledger/a1' })
    expect(api.accountLedger).toHaveBeenCalledWith('a1', { financial_year_id: 'y1', currency: 'USD', limit: 100, offset: 0 })
    const rows = w.findAll('tbody tr').map((r) => r.text())
    expect(rows[0]).toContain('Brought forward')
    expect(rows[0]).toContain('1 000.00 Dr')
    expect(rows[1]).toContain('RC-0000001')
    expect(rows[1]).toContain('1 100.00 Dr')
    expect(rows[2]).toContain('1 200.00 Dr')
    expect(rows[3]).toContain('Period totals')
    expect(rows[3]).toContain('200.00')
    expect(rows[4]).toContain('Carried forward')
    expect(rows[4]).toContain('1 200.00 Dr')
    expect(w.text()).toContain('Balance to date, every year')
    expect(w.text()).toContain('USD 1 200.00 Dr')
  })

  it('links a voucher number to the voucher', async () => {
    api.accountLedger.mockResolvedValue(ledger())
    const { w } = await setup({ path: '/ledger/a1' })
    expect(w.findAll('a').find((a) => a.text() === 'RC-0000001')!.attributes('href')).toBe('/journals/v1')
  })

  it('asks the server for the next page and keeps the range in the address', async () => {
    api.accountLedger.mockResolvedValue(ledger({ total: 150, entries: [lineOf(1, dr('1100.00'))] }))
    const { w, router } = await setup({ path: '/ledger/a1?book=ZWG&from=2026-03-01&to=2026-06-30' })
    expect(api.accountLedger.mock.calls[0][1]).toMatchObject({ currency: 'ZWG', from: '2026-03-01', to: '2026-06-30', offset: 0 })
    await button(w, 'Next')!.trigger('click')
    await flushPromises()
    expect(api.accountLedger.mock.calls.at(-1)![1]).toMatchObject({ currency: 'ZWG', from: '2026-03-01', to: '2026-06-30', limit: 100, offset: 100 })
    expect(router.currentRoute.value.query).toMatchObject({ book: 'ZWG', from: '2026-03-01', to: '2026-06-30', offset: '100' })
  })

  it("continues page 2's first running balance from page 1's last, as the server sent it (Review Focus 5)", async () => {
    api.accountLedger.mockResolvedValue(ledger({
      total: 150, offset: 100, brought_forward: dr('1000.00'), entries: [lineOf(3, dr('1300.00'))],
      totals: { debit: '300.00', credit: '0.00' }, carried_forward: dr('1300.00'),
    }))
    const { w } = await setup({ path: '/ledger/a1?offset=100' })
    expect(api.accountLedger.mock.calls[0][1]).toMatchObject({ offset: 100 })
    const rows = w.findAll('tbody tr').map((r) => r.text())
    // Not the first page: no brought-forward row. Not the last page: no totals or carried forward yet? 100 + 100 >= 150, so it is the last.
    expect(rows.some((r) => r.includes('Brought forward'))).toBe(false)
    expect(rows[0]).toContain('RC-0000003')
    expect(rows[0]).toContain('1 300.00 Dr')
    expect(rows[1]).toContain('Period totals')
    expect(rows[2]).toContain('Carried forward')
  })

  it('shows neither totals nor carried forward on a page that is not the last', async () => {
    api.accountLedger.mockResolvedValue(ledger({ total: 250, entries: [lineOf(1, dr('1100.00'))] }))
    const { w } = await setup({ path: '/ledger/a1' })
    expect(w.text()).toContain('Brought forward')
    expect(w.text()).not.toContain('Period totals')
    expect(w.text()).not.toContain('Carried forward')
  })

  it("marks a balance against the account's nature on the account page (Review Focus 2)", async () => {
    const cr = { net_debit: '-450.00', amount: '450.00', side: 'Cr' as const }
    api.accountLedger.mockResolvedValue(ledger({ entries: [lineOf(1, cr)], carried_forward: cr, total: 1 }))
    api.accountBalance.mockResolvedValue(lifetime({
      balances: [{ currency: 'USD', entry_count: 1, debit_total: '0.00', credit_total: '450.00', net_debit: '-450.00', last_posting_date: null }],
    }))
    const { w } = await setup({ path: '/ledger/a1' })
    const entry = w.findAll('tbody tr')[1]
    const cell = entry.findAll('td')[4]
    expect(cell.classes()).toContain('is-contra')
    expect(cell.text()).toContain('450.00 Cr')
    expect(cell.text()).not.toContain('Dr')
    expect(cell.text()).toContain('against its usual side')
    const life = w.find('.ac-life .is-contra')
    expect(life.text()).toBe('USD 450.00 Cr')
    expect(w.find('.ac-life').text()).toContain('against its usual side')
    // The brought-forward debit is the account's nature: not marked.
    expect(w.findAll('tbody tr')[0].find('.is-contra').exists()).toBe(false)
  })

  it('says there are no entries, with the brought-forward figure, and keeps the page working', async () => {
    api.accountLedger.mockResolvedValue(ledger({ entries: [], total: 0, totals: { debit: '0.00', credit: '0.00' } }))
    const { w } = await setup({ path: '/ledger/a1' })
    expect(w.text()).toContain('No entries in this book.')
    expect(w.text()).toContain('Brought forward 1 000.00 Dr')
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('shows loading, then the server\'s refusal for a heading, with Retry', async () => {
    let release!: (v: unknown) => void
    api.accountLedger.mockReturnValueOnce(new Promise((r) => { release = r }))
    const { w } = await setup({ path: '/ledger/a1' })
    expect(w.find('.cw-skel').exists()).toBe(true)
    release(ledger())
    await flushPromises()
    expect(w.find('.cw-skel').exists()).toBe(false)
    w.unmount()
    document.body.innerHTML = ''

    api.accountLedger.mockRejectedValue({ response: { status: 409, data: { message: 'This is a heading; it has no entries of its own.' } } })
    const failed = await setup({ path: '/ledger/g1' })
    expect(failed.w.find('[role="alert"]').text()).toContain('This is a heading; it has no entries of its own.')
    expect(button(failed.w, 'Retry')).toBeDefined()
  })

  it('asks nothing and says to choose a year when none is selected (Review Focus 4)', async () => {
    const { w } = await setup({ path: '/ledger/a1', year: null })
    expect(api.accountLedger).not.toHaveBeenCalled()
    expect(api.accountBalance).not.toHaveBeenCalled()
    expect(w.text()).toContain('Choose a financial year in the banner above.')
  })

  it('drops a slow earlier answer: the newer request wins, and only it clears loading', async () => {
    let first!: (v: unknown) => void, second!: (v: unknown) => void
    api.accountLedger
      .mockReturnValueOnce(new Promise((r) => { first = r }))
      .mockReturnValueOnce(new Promise((r) => { second = r }))
    const { w } = await setup({ path: '/ledger/a1' })
    useFinanceStore().selectedYearId = 'y2'
    await flushPromises()
    expect(api.accountLedger).toHaveBeenCalledTimes(2)
    first(ledger({ entries: [lineOf(1, dr('1100.00'), { narration: 'Older entry' })], total: 1 }))
    await flushPromises()
    expect(w.find('.cw-skel').exists()).toBe(true)
    expect(w.text()).not.toContain('Older entry')
    second(ledger({ entries: [lineOf(2, dr('1200.00'), { narration: 'Newer entry' })], total: 1 }))
    await flushPromises()
    expect(w.find('.cw-skel').exists()).toBe(false)
    expect(w.text()).toContain('Newer entry')
    expect(w.text()).not.toContain('Older entry')
  })

  it('does not apply an older answer that arrives after the newer one', async () => {
    let first!: (v: unknown) => void, second!: (v: unknown) => void
    api.accountLedger
      .mockReturnValueOnce(new Promise((r) => { first = r }))
      .mockReturnValueOnce(new Promise((r) => { second = r }))
    const { w } = await setup({ path: '/ledger/a1' })
    useFinanceStore().selectedYearId = 'y2'
    await flushPromises()
    second(ledger({ entries: [lineOf(2, dr('1200.00'), { narration: 'Newer entry' })], total: 1 }))
    await flushPromises()
    first(ledger({ entries: [lineOf(1, dr('1100.00'), { narration: 'Older entry' })], total: 1 }))
    await flushPromises()
    expect(w.text()).toContain('Newer entry')
    expect(w.text()).not.toContain('Older entry')
  })

  it('asks the server for nothing when the person leaves for a voucher', async () => {
    api.accountLedger.mockResolvedValue(ledger())
    const { w, router } = await setup({ path: '/ledger/a1' })
    const ledgerCalls = api.accountLedger.mock.calls.length
    const balanceCalls = api.accountBalance.mock.calls.length
    await w.findAll('a').find((a) => a.text() === 'RC-0000001')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.name).toBe('acc-voucher')
    expect(api.accountLedger.mock.calls.length).toBe(ledgerCalls)
    expect(api.accountBalance.mock.calls.length).toBe(balanceCalls)
  })

  it('does not mark a zero balance, which the server sends as Dr, on a credit-natural account', async () => {
    const zero = { net_debit: '0.00', amount: '0.00', side: 'Dr' as const }
    api.accountLedger.mockResolvedValue(ledger({
      natural_side: 'credit', brought_forward: zero, entries: [lineOf(1, zero, { debit: '0.00', credit: '0.00' })],
      carried_forward: zero, totals: { debit: '0.00', credit: '0.00' }, total: 1,
    }))
    api.accountBalance.mockResolvedValue(lifetime({
      natural_side: 'credit',
      balances: [{ currency: 'USD', entry_count: 1, debit_total: '0.00', credit_total: '0.00', net_debit: '0.00', last_posting_date: null }],
    }))
    const { w } = await setup({ path: '/ledger/a1' })
    expect(w.text()).toContain('0.00 Dr')
    expect(w.find('.is-contra').exists()).toBe(false)
    expect(w.text()).not.toContain('against its usual side')
  })

  it('starts again at the first page when the year changes', async () => {
    api.accountLedger.mockResolvedValue(ledger({ total: 250, offset: 100, entries: [lineOf(3, dr('1300.00'))] }))
    const { router } = await setup({ path: '/ledger/a1?offset=100&book=USD' })
    expect(api.accountLedger.mock.calls.at(-1)![1]).toMatchObject({ offset: 100 })
    useFinanceStore().selectedYearId = 'y2'
    await flushPromises()
    expect(router.currentRoute.value.query.offset).toBeUndefined()
    expect(router.currentRoute.value.query.book).toBe('USD')
    expect(api.accountLedger.mock.calls.at(-1)![1]).toMatchObject({ financial_year_id: 'y2', offset: 0 })
  })

  it('exports the CSV for the range shown, and reads the refusal out of a blob', async () => {
    api.accountLedger.mockResolvedValue(ledger())
    api.accountLedgerCsv.mockRejectedValue({ response: { data: new Blob([JSON.stringify({ message: 'Too many rows to export.' })]) } })
    const { w } = await setup({ path: '/ledger/a1?book=USD&from=2026-03-01' })
    await button(w, 'Export CSV')!.trigger('click')
    await flushPromises()
    expect(api.accountLedgerCsv).toHaveBeenCalledWith('a1', expect.objectContaining({ currency: 'USD', from: '2026-03-01' }))
    expect(w.find('[role="alert"]').text()).toContain('Too many rows to export.')
  })

  it('in cashbook mode has no page head, adds the Reconciled column and offers the actions slot', async () => {
    api.accountLedger.mockResolvedValue(ledger({
      entries: [lineOf(1, dr('1100.00'), { reconciled: true }), lineOf(2, dr('1200.00'), { reconciled: false }), lineOf(3, dr('1300.00'))], total: 3,
    }))
    const { w } = await setup({ path: '/ledger/a1', mount: 'cashbook' })
    expect(w.find('.cw-pagehead').exists()).toBe(false)
    expect(w.findAll('thead th').map((t) => t.text())).toContain('Reconciled')
    const cells = w.findAll('tbody tr').slice(1, 4).map((r) => r.findAll('td').at(-1)!.text())
    expect(cells).toEqual(['Reconciled', 'Not reconciled', '—'])
    expect(w.find('.slot-action').exists()).toBe(true)
    expect(api.accountLedger.mock.calls[0][0]).toBe('a1')
  })

  it('scrolls the table inside its card, never the page, at 390 px', async () => {
    api.accountLedger.mockResolvedValue(ledger())
    const { w } = await setup({ path: '/ledger/a1' })
    const wrap = w.find('.cw-card-body.cw-table-wrap')
    expect(wrap.exists()).toBe(true)
    expect(wrap.find('table').exists()).toBe(true)
    // The wrapper is what scrolls: its style sheet clips sideways overflow; the table itself is the only wide thing.
    const css = readFileSync(resolve(__dirname, '../workspaces/shared/portal.css'), 'utf8')
    expect(css).toMatch(/\.cw-table-wrap\s*\{[^}]*overflow-x:\s*auto/)
    const page = readFileSync(resolve(__dirname, '../workspaces/accountant/pages/AccountLedgerPage.vue'), 'utf8')
    expect(page).toMatch(/\.ac-table\s*\{[^}]*min-width:\s*720px/)
    // Nothing outside the wrap forces the page wider: the toolbar wraps.
    expect(page).toMatch(/\.ac-toolbar\s*\{[^}]*flex-wrap:\s*wrap/)
  })
})
