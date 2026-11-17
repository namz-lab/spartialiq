// @vitest-environment happy-dom
//
// The Cashbook and the GuidedJournalDialog. Its rules:
//   1. A DOCUMENT IS A TWO-LINE DRAFT with no number of ours; the server numbers it.
//   2. NO CONTROL THAT CAN ONLY BE REFUSED: no permission or no open period means no buttons and a sentence.
//   3. THE SERVER'S REFUSAL IS SHOWN AS SENT; amounts are read in exact cents.
//   4. HEAD FIGURES ARE THE SERVER'S, as sent.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../api/ledgerApi', () => ({
  ledgerApi: {
    cashAccounts: vi.fn(), accountLedger: vi.fn(), accountBalance: vi.fn(), accountLedgerCsv: vi.fn(),
    createVoucher: vi.fn(), accounts: vi.fn(), parties: vi.fn(), periods: vi.fn(),
  },
}))

import { ledgerApi } from '../api/ledgerApi'
import CashbookPage from '../workspaces/accountant/pages/CashbookPage.vue'
import GuidedJournalDialog from '../workspaces/accountant/kit/GuidedJournalDialog.vue'
import AccountPicker from '../workspaces/accountant/kit/AccountPicker.vue'
import { resetLedgerLists } from '../workspaces/accountant/kit/useLedgerLists'
import { useFinanceStore } from '../stores/finance'

const api = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })
const PREPARE = ['finance.ledger.view', 'finance.ledger.voucher.prepare']
const VIEW = ['finance.ledger.view']

const acct = (over: Record<string, unknown>) => ({
  id: 'x', code: '0', name: 'x', root_type: 'asset', report_type: 'balance_sheet', account_type: null, parent_id: null,
  is_group: false, is_postable: true, status: 'active', ...over,
})
const CHART = [
  acct({ id: 'bank1', code: '1200', name: 'Bank CBZ', account_type: 'bank' }),
  acct({ id: 'bank2', code: '1210', name: 'Bank Stanbic', account_type: 'bank' }),
  acct({ id: 'cash1', code: '1300', name: 'Petty cash', account_type: 'cash' }),
  acct({ id: 'exp1', code: '5000', name: 'Fuel', root_type: 'expense' }),
  acct({ id: 'pay1', code: '2100', name: 'Creditors', account_type: 'payable' }),
  acct({ id: 'rec1', code: '1100', name: 'Debtors', account_type: 'receivable' }),
  acct({ id: 'rev1', code: '4000', name: 'Rates', root_type: 'revenue' }),
]
const PARTIES = [{ id: 'p1', party_type: 'debtor', name: 'Mr Moyo', reference: null, status: 'active' }]
const today = (() => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
})()
const period = (status = 'open', from = '1990-01-01', to = '2099-12-31') => ({
  id: 'per1', financial_year_id: 'y1', period_no: 1, label: 'P1', from_date: from, to_date: to, status, closed_at: null, locked_at: null,
})
const cashRow = (over: Record<string, unknown> = {}) => ({
  id: 'bank1', code: '1200', name: 'Bank CBZ', account_type: 'bank', currency: 'USD',
  balance: { net_debit: '500.00', amount: '500.00', side: 'Dr' }, last_entry: '2026-09-30',
  reconciled_to: '2026-09-30', reconciled_balance: '495.00', unreconciled: { entries: 3, debit: '10.00', credit: '5.00' }, ...over,
})
const dr = (a: string) => ({ net_debit: a, amount: a, side: 'Dr' as const })
const ledger = () => ({
  account: acct({ id: 'bank1', code: '1200', name: 'Bank CBZ', account_type: 'bank' }), natural_side: 'debit', currency: 'USD',
  from: '2026-01-01', to: '2026-12-31', brought_forward: dr('0.00'), entries: [], totals: { debit: '0.00', credit: '0.00' },
  carried_forward: dr('0.00'), total: 0, limit: 100, offset: 0,
})

let wrappers: VueWrapper[] = []
async function setup(opts: { permissions?: string[]; year?: string | null; path?: string } = {}) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: opts.permissions ?? PREPARE, department_scope: [], catalogue: [] }
  store.selectedYearId = opts.year === undefined ? 'y1' : opts.year
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/cashbook', name: 'acc-cashbook', component: CashbookPage },
      { path: '/ledger', name: 'acc-ledger', component: Stub },
      { path: '/bank', name: 'acc-bank', component: Stub },
      { path: '/payable', name: 'acc-payable', component: Stub },
      { path: '/cashups', name: 'acc-cashups', component: Stub },
      { path: '/journals/:id', name: 'acc-voucher', component: Stub },
    ],
  })
  await router.push(opts.path ?? '/cashbook')
  await router.isReady()
  const w = mount(CashbookPage, { attachTo: document.body, global: { plugins: [router] } })
  wrappers.push(w)
  await flushPromises()
  return { w, router }
}
const button = (w: VueWrapper, text: string) => w.findAll('button').find(b => b.text() === text)
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null
const field = (id: string) => document.body.querySelector(`#${id}`) as HTMLInputElement
async function type(id: string, v: string) { const el = field(id); el.value = v; el.dispatchEvent(new Event('input')); await flushPromises() }
const save = async () => {
  (Array.from(document.body.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Save as draft') as HTMLElement).click()
  await flushPromises()
}
const picker = (w: VueWrapper) => w.findComponent(GuidedJournalDialog).findAllComponents(AccountPicker)[0]
const pickerIds = (w: VueWrapper) => {
  const p = picker(w)
  return (p.props('accounts') as typeof CHART).filter(p.props('filter') as (a: unknown) => boolean).filter(a => a.is_postable).map(a => a.id)
}
async function choose(w: VueWrapper, id: string) { picker(w).vm.$emit('update:modelValue', id); await flushPromises() }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  resetLedgerLists()
  document.body.innerHTML = ''
  api.cashAccounts.mockResolvedValue({ accounts: [cashRow()] })
  api.accountLedger.mockResolvedValue(ledger())
  api.accountBalance.mockResolvedValue(null)
  api.accounts.mockResolvedValue({ accounts: CHART })
  api.parties.mockResolvedValue({ parties: PARTIES, total: 1, limit: 200, offset: 0 })
  api.periods.mockResolvedValue({ periods: [period()], total: 1 })
  api.createVoucher.mockResolvedValue({ voucher: { id: 'v9', voucher_no: 'JV-000009' } })
})
afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers = [] })

async function open(w: VueWrapper, doc: string) { await button(w, doc)!.trigger('click'); await flushPromises() }

describe('the cashbook head', () => {
  it('shows the figures as sent, with the reconciliation line and a link to Bank Reconciliation', async () => {
    const { w } = await setup()
    expect(api.cashAccounts).toHaveBeenCalledWith('y1')
    expect(w.text()).toContain('500.00')
    expect(w.text()).toContain('Reconciled to 30 September 2026 at US$ 495.00')
    const link = w.findAll('a').find(a => a.text().includes('3 entries'))!
    expect(link.attributes('href')).toBe('/bank')
  })
  it('says "Never reconciled" when the account has never been reconciled', async () => {
    api.cashAccounts.mockResolvedValue({ accounts: [cashRow({ reconciled_to: null, reconciled_balance: null })] })
    const { w } = await setup()
    expect(w.text()).toContain('Never reconciled')
  })
  it('shows no reconciliation line for a cash account', async () => {
    api.cashAccounts.mockResolvedValue({ accounts: [cashRow({ id: 'cash1', account_type: 'cash', reconciled_to: null, unreconciled: null })] })
    const { w } = await setup()
    expect(w.text()).not.toContain('Never reconciled')
    expect(w.text()).not.toContain('Not yet reconciled')
  })
})

describe('states', () => {
  it('shows a loading state, then the page', async () => {
    let resolve!: (v: unknown) => void
    api.cashAccounts.mockReturnValue(new Promise(r => { resolve = r }))
    const { w } = await setup()
    expect(w.find('[aria-busy="true"]').exists()).toBe(true)
    resolve({ accounts: [cashRow()] }); await flushPromises()
    expect(w.find('[aria-busy="true"]').exists()).toBe(false)
  })
  it('says there is no bank or cash account, with a link to the ledger', async () => {
    api.cashAccounts.mockResolvedValue({ accounts: [] })
    const { w } = await setup()
    expect(w.text()).toContain('There is no bank or cash account in the chart yet.')
    expect(w.findAll('a').find(a => a.text().includes('General Ledger'))!.attributes('href')).toBe('/ledger')
  })
  it('shows a failure with Retry, and Retry reads again', async () => {
    api.cashAccounts.mockRejectedValueOnce({ response: { data: { message: 'Database away' } } })
    const { w } = await setup()
    expect(w.find('[role="alert"]').text()).toContain('Database away')
    await button(w, 'Retry')!.trigger('click'); await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
    expect(api.cashAccounts).toHaveBeenCalledTimes(2)
  })
  it('with no financial year asks for none and says to choose one', async () => {
    const { w } = await setup({ year: null })
    expect(api.cashAccounts).not.toHaveBeenCalled()
    expect(w.text()).toContain('Choose a financial year in the banner above.')
  })
  it('drops a slow earlier answer (out of order)', async () => {
    let first!: (v: unknown) => void
    api.cashAccounts.mockReturnValueOnce(new Promise(r => { first = r }))
    const { w } = await setup()
    api.cashAccounts.mockResolvedValueOnce({ accounts: [cashRow({ id: 'bank2', code: '1210', name: 'Bank Stanbic' })] })
    useFinanceStore().selectedYearId = 'y2'
    await flushPromises()
    first({ accounts: [cashRow()] }); await flushPromises()
    expect(w.text()).toContain('1210 Bank Stanbic')
    expect(w.text()).not.toContain('1200 Bank CBZ')
  })
})

describe('permission and period', () => {
  it('without voucher.prepare renders no document button and gives the reason', async () => {
    const { w } = await setup({ permissions: VIEW })
    for (const t of ['Payment', 'Receipt', 'Transfer']) expect(button(w, t)).toBeUndefined()
    expect(w.text()).toContain(useFinanceStore().whyUnavailable('finance.ledger.voucher.prepare'))
  })
  it('with no open period in the year renders no buttons and a sentence', async () => {
    api.periods.mockResolvedValue({ periods: [period('closed')], total: 1 })
    const { w } = await setup()
    for (const t of ['Payment', 'Receipt', 'Transfer']) expect(button(w, t)).toBeUndefined()
    expect(w.text()).toContain('No accounting period is open in this financial year')
  })
  it("shows the buttons when today's period is closed but an earlier one is open", async () => {
    api.periods.mockResolvedValue({ periods: [period('open', '1990-01-01', '1990-12-31'), period('closed', '1991-01-01', '2099-12-31')], total: 2 })
    const { w } = await setup()
    expect(button(w, 'Payment')).toBeDefined()
    await open(w, 'Payment')
    // The date defaults to the end of the latest open period.
    expect(field('gj-date').value).toBe('1990-12-31')
  })
  it('says the periods could not be read, not that none is open, and Retry reads again', async () => {
    api.periods.mockRejectedValueOnce({ response: { data: { message: 'Periods unavailable' } } })
    const { w } = await setup()
    expect(button(w, 'Payment')).toBeUndefined()
    expect(w.text()).toContain('Periods unavailable')
    expect(w.text()).not.toContain('No accounting period is open')
    await button(w, 'Retry')!.trigger('click'); await flushPromises()
    expect(button(w, 'Payment')).toBeDefined()
  })
  it('a failed reload after an earlier success shows the error and Retry, with no buttons', async () => {
    // First load: the periods are read (so this year's periods are cached), the accounts fail.
    api.cashAccounts.mockRejectedValueOnce({ response: { data: { message: 'Database away' } } })
    const { w } = await setup()
    expect(api.periods).toHaveBeenCalledTimes(1)
    // Retry: the accounts come, but the periods reload fails.
    api.periods.mockRejectedValueOnce({ response: { data: { message: 'Periods unavailable' } } })
    await button(w, 'Retry')!.trigger('click'); await flushPromises()
    expect(button(w, 'Payment')).toBeUndefined()
    expect(w.text()).toContain('Periods unavailable')
    expect(w.text()).not.toContain('No accounting period is open')
    expect(button(w, 'Retry')).toBeDefined()
  })
  it('reads the periods afresh on mount and again when the dialog opens', async () => {
    const { w } = await setup()
    expect(api.periods).toHaveBeenCalledTimes(1)
    await open(w, 'Payment')
    expect(api.periods).toHaveBeenCalledTimes(2)
    expect(api.periods).toHaveBeenLastCalledWith({ financial_year_id: 'y1' })
  })
  it('a period closed meanwhile is seen when the dialog opens', async () => {
    const { w } = await setup()
    api.periods.mockResolvedValue({ periods: [period('closed')], total: 1 })
    await open(w, 'Payment')
    expect(dialog()!.textContent).toContain('No accounting period is open for this date')
  })
})

describe('Payment', () => {
  it('builds [{counter, debit}, {bank, credit}] with no voucher_no and no party', async () => {
    const { w } = await setup()
    await open(w, 'Payment')
    await choose(w, 'exp1')
    await type('gj-amount', '1250.50')
    await save()
    expect(api.createVoucher).toHaveBeenCalledTimes(1)
    const body = api.createVoucher.mock.calls[0][0]
    expect(body.voucher_no).toBeUndefined()
    expect(body.lines).toEqual([
      { ledger_account_id: 'exp1', debit: '1250.50' },
      { ledger_account_id: 'bank1', credit: '1250.50' },
    ])
    expect(body).toMatchObject({ currency: 'USD', financial_year_id: 'y1', posting_date: today })
  })
  it('excludes payable (and banks) from the counter list and leads to Accounts Payable', async () => {
    const { w } = await setup()
    await open(w, 'Payment')
    expect(pickerIds(w)).toEqual(expect.arrayContaining(['exp1', 'rec1', 'rev1']))
    expect(pickerIds(w)).not.toContain('pay1')
    expect(pickerIds(w)).not.toContain('bank1')
    expect(dialog()!.textContent).toContain('Supplier invoices are paid in Accounts Payable')
    expect((dialog()!.querySelector('a') as HTMLAnchorElement).getAttribute('href')).toBe('/payable')
  })
})

describe('Receipt and Transfer', () => {
  it('Receipt debits the bank and credits the counter, bank line first', async () => {
    const { w } = await setup()
    await open(w, 'Receipt')
    expect(pickerIds(w)).not.toContain('bank2')
    expect(dialog()!.textContent).toContain('Cash Office')
    await choose(w, 'rev1')
    await type('gj-amount', '40')
    await save()
    expect(api.createVoucher.mock.calls[0][0].lines).toEqual([
      { ledger_account_id: 'bank1', debit: '40.00' },
      { ledger_account_id: 'rev1', credit: '40.00' },
    ])
  })
  it("Transfer's counter list excludes the account itself and non-cash accounts", async () => {
    const { w } = await setup()
    await open(w, 'Transfer')
    expect(pickerIds(w).sort()).toEqual(['bank2', 'cash1'])
    await choose(w, 'bank2')
    await type('gj-amount', '10.00')
    await save()
    expect(api.createVoucher.mock.calls[0][0].lines).toEqual([
      { ledger_account_id: 'bank2', debit: '10.00' },
      { ledger_account_id: 'bank1', credit: '10.00' },
    ])
  })
})

describe('the amount', () => {
  const cases: Array<[string, string, string]> = [
    ['1,250.50', 'commas', 'without commas'],
    ['12.345', 'three decimals', 'two decimal places at most'],
    ['-5', 'negative', 'cannot be negative'],
    ['', 'blank', 'Enter the amount'],
    ['0.00', 'zero', 'more than zero'],
  ]
  for (const [text, name, sentence] of cases) {
    it(`refuses ${name} in words and does not call the API`, async () => {
      const { w } = await setup()
      await open(w, 'Payment')
      await choose(w, 'exp1')
      await type('gj-amount', text)
      await save()
      expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain(sentence)
      expect(api.createVoucher).not.toHaveBeenCalled()
    })
  }
})

describe('against', () => {
  function mountDialog(extra: Record<string, unknown> = {}) {
    const store = useFinanceStore()
    store.identity = { user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: PREPARE, department_scope: [], catalogue: [] }
    store.selectedYearId = 'y1'
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/j/:id', name: 'acc-voucher', component: Stub }, { path: '/', component: Stub }] })
    const w = mount(GuidedJournalDialog, {
      attachTo: document.body, global: { plugins: [router] },
      props: {
        title: 'Credit note', lead: 'Reduce a bill.', currency: 'USD',
        fixed: { ledger_account_id: 'rev1', side: 'debit', label: '4000 Rates' },
        counter: { label: 'Debtors control', filter: (a: { account_type: string | null }) => a.account_type === 'receivable', partyTypes: ['debtor'] },
        voucherType: 'credit_note', against: { voucher_id: 'v7', voucher_no: 'RB-000007', max: '100.00' }, ...extra,
      },
    })
    wrappers.push(w)
    return w
  }
  it('refuses an amount over the maximum in words, and the party line carries against_voucher_id', async () => {
    const w = mountDialog()
    await flushPromises()
    w.findComponent(AccountPicker).vm.$emit('update:modelValue', 'rec1')
    await flushPromises()
    w.findComponent({ name: 'PartyPicker' }).vm.$emit('update:modelValue', 'p1')
    await type('gj-amount', '100.01')
    await save()
    expect(api.createVoucher).not.toHaveBeenCalled()
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('More than the US$ 100.00 still open on RB-000007.')
    await type('gj-amount', '100.00')
    await save()
    const body = api.createVoucher.mock.calls[0][0]
    expect(body.voucher_type).toBe('credit_note')
    expect(body.lines).toEqual([
      { ledger_account_id: 'rev1', debit: '100.00' },
      { ledger_account_id: 'rec1', credit: '100.00', party_id: 'p1', against_voucher_id: 'v7' },
    ])
  })
})

describe('against with partyOn fixed and a preset party', () => {
  it('puts party_id and against_voucher_id on the fixed line only, and shows the party read-only', async () => {
    const store = useFinanceStore()
    store.identity = { user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: PREPARE, department_scope: [], catalogue: [] }
    store.selectedYearId = 'y1'
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/j/:id', name: 'acc-voucher', component: Stub }, { path: '/', component: Stub }] })
    const w = mount(GuidedJournalDialog, {
      attachTo: document.body, global: { plugins: [router] },
      props: {
        title: 'Credit note', lead: 'Reduce a bill.', currency: 'USD', partyOn: 'fixed', party: { id: 'p1', name: 'Mr Moyo' },
        fixed: { ledger_account_id: 'rec1', side: 'credit', label: '1100 Debtors' },
        counter: { label: 'Revenue account', filter: (a: { root_type: string }) => a.root_type === 'revenue' },
        voucherType: 'credit_note', against: { voucher_id: 'v7', voucher_no: 'RB-000007', max: '100.00' },
      },
    })
    wrappers.push(w)
    await flushPromises()
    expect(w.findComponent({ name: 'PartyPicker' }).exists()).toBe(false)
    expect(dialog()!.textContent).toContain('Mr Moyo')
    w.findComponent(AccountPicker).vm.$emit('update:modelValue', 'rev1')
    await type('gj-amount', '40.00')
    await save()
    expect(api.createVoucher.mock.calls[0][0].lines).toEqual([
      { ledger_account_id: 'rev1', debit: '40.00' },
      { ledger_account_id: 'rec1', credit: '40.00', party_id: 'p1', against_voucher_id: 'v7' },
    ])
  })
})

describe('saving', () => {
  it("shows the server's refusal as sent", async () => {
    api.createVoucher.mockRejectedValue({ response: { status: 409, data: { message: 'The period for that date is closed.' } } })
    const { w } = await setup()
    await open(w, 'Payment')
    await choose(w, 'exp1')
    await type('gj-amount', '5')
    await save()
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('The period for that date is closed.')
  })
  it('on success says the draft is saved, links to the voucher, and emits saved', async () => {
    const { w } = await setup()
    await open(w, 'Payment')
    await choose(w, 'exp1')
    await type('gj-amount', '5')
    await save()
    expect(dialog()!.textContent).toContain('JV-000009 saved as a draft. Somebody other than you posts it.')
    expect((dialog()!.querySelector('a') as HTMLAnchorElement).getAttribute('href')).toBe('/j/v9'.replace('/j/', '/journals/'))
    const emitted = w.findComponent(GuidedJournalDialog).emitted('saved')!
    expect(emitted[0]).toEqual([{ id: 'v9', voucher_no: 'JV-000009' }])
  })
  it('refuses a date with no open period and does not call the API', async () => {
    const { w } = await setup()
    await open(w, 'Payment')
    await choose(w, 'exp1')
    await type('gj-amount', '5')
    await type('gj-date', '1980-01-01')
    expect(dialog()!.textContent).toContain('No accounting period is open for this date')
    await save()
    expect(api.createVoucher).not.toHaveBeenCalled()
  })
})

describe('the dialog keyboard', () => {
  it('focuses in, closes on Escape and returns focus to the button that opened it', async () => {
    const { w } = await setup()
    const btn = button(w, 'Payment')!
    ;(btn.element as HTMLElement).focus()
    await btn.trigger('click'); await flushPromises()
    expect(dialog()!.contains(document.activeElement)).toBe(true)
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(btn.element)
  })
  it('traps Tab inside the dialog', async () => {
    const { w } = await setup()
    await open(w, 'Payment')
    const buttons = Array.from(dialog()!.querySelectorAll<HTMLElement>('button:not([disabled])'))
    buttons[buttons.length - 1].focus()
    const ev = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
    dialog()!.dispatchEvent(ev)
    expect(ev.defaultPrevented).toBe(true)
    expect(dialog()!.contains(document.activeElement)).toBe(true)
  })
})

describe('save in flight and after saving', () => {
  it('keeps focus in the dialog after a successful save, Esc still closes it, and the message is in a live region', async () => {
    const { w } = await setup()
    await open(w, 'Payment')
    await choose(w, 'exp1')
    await type('gj-amount', '5')
    await save()
    expect(dialog()!.contains(document.activeElement)).toBe(true)
    expect(document.activeElement!.textContent).toBe('Close')
    expect(dialog()!.querySelector('[role="status"][aria-live="polite"]')!.textContent).toContain('saved as a draft')
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await flushPromises()
    expect(dialog()).toBeNull()
  })
  it('ignores Close, Esc and a backdrop click while the save is in flight', async () => {
    let done!: (v: unknown) => void
    api.createVoucher.mockReturnValue(new Promise(r => { done = r }))
    const { w } = await setup()
    await open(w, 'Payment')
    await choose(w, 'exp1')
    await type('gj-amount', '5')
    await save()
    dialog()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    ;(Array.from(dialog()!.querySelectorAll('button')).find(b => b.textContent === 'Cancel') as HTMLElement).click()
    ;(document.body.querySelector('.cw-dialog-backdrop') as HTMLElement).click()
    await flushPromises()
    expect(dialog()).not.toBeNull()
    done({ voucher: { id: 'v9', voucher_no: 'JV-000009' } }); await flushPromises()
    expect(dialog()!.textContent).toContain('JV-000009 saved as a draft')
  })
  it('passes the opener to the dialog for the focus return', async () => {
    const { w } = await setup()
    const btn = button(w, 'Transfer')!
    await btn.trigger('click'); await flushPromises()
    expect(w.findComponent(GuidedJournalDialog).props('opener')).toBe(btn.element)
  })
})

describe('the dialog when the periods cannot be reloaded', () => {
  it('says the periods could not be read, never that none is open, and does not save', async () => {
    const { w } = await setup()
    api.periods.mockRejectedValueOnce({ response: { data: { message: 'Periods unavailable' } } })
    await open(w, 'Payment')
    expect(dialog()!.textContent).not.toContain('No accounting period')
    await choose(w, 'exp1')
    await type('gj-amount', '5')
    await save()
    expect(dialog()!.textContent).toContain('The accounting periods could not be read, so the date cannot be checked. Nothing was saved.')
    expect(dialog()!.textContent).not.toContain('No accounting period')
    expect(api.createVoucher).not.toHaveBeenCalled()
  })
})

describe('against.max that cannot be read', () => {
  it('fails closed: a sentence, and the API is not called', async () => {
    const store = useFinanceStore()
    store.identity = { user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: PREPARE, department_scope: [], catalogue: [] }
    store.selectedYearId = 'y1'
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/j/:id', name: 'acc-voucher', component: Stub }, { path: '/', component: Stub }] })
    const w = mount(GuidedJournalDialog, {
      attachTo: document.body, global: { plugins: [router] },
      props: {
        title: 'Write-off', lead: 'x', currency: 'USD', fixed: { ledger_account_id: 'rev1', side: 'debit', label: '4000 Rates' },
        counter: { label: 'Debtors control', filter: () => true }, against: { voucher_id: 'v7', voucher_no: 'RB-000007', max: 'abc' },
      },
    })
    wrappers.push(w)
    await flushPromises()
    w.findComponent(AccountPicker).vm.$emit('update:modelValue', 'rec1')
    await flushPromises()
    w.findComponent({ name: 'PartyPicker' }).vm.$emit('update:modelValue', 'p1')
    await type('gj-amount', '1.00')
    await save()
    expect(api.createVoucher).not.toHaveBeenCalled()
    expect(dialog()!.querySelector('[role="alert"]')!.textContent).toContain('could not be read')
  })
})
