// @vitest-environment happy-dom
//
// Tax Control. Its rules:
//   1. FIGURES ARE THE SERVER'S, as sent; nothing is added up in the browser.
//   2. ONE BOOK AT A TIME.
//   3. A PAYMENT IS Dr TAX / Cr BANK, the bank account chosen before the dialog opens.
//   4. NO CONTROL THAT CAN ONLY BE REFUSED: no permission or no open period means no button and a sentence.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../api/accountingApi', () => ({ accountingApi: { tax: vi.fn() } }))
vi.mock('../api/ledgerApi', () => ({
  ledgerApi: { createVoucher: vi.fn(), accounts: vi.fn(), parties: vi.fn(), periods: vi.fn(), accountLedgerCsv: vi.fn() },
}))

import { accountingApi } from '../api/accountingApi'
import { ledgerApi } from '../api/ledgerApi'
import TaxControlPage from '../workspaces/accountant/pages/TaxControlPage.vue'
import GuidedJournalDialog from '../workspaces/accountant/kit/GuidedJournalDialog.vue'
import AccountPicker from '../workspaces/accountant/kit/AccountPicker.vue'
import { resetLedgerLists } from '../workspaces/accountant/kit/useLedgerLists'
import { useFinanceStore } from '../stores/finance'

const tax = (accountingApi as unknown as { tax: ReturnType<typeof vi.fn> }).tax
const api = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })
const PREPARE = ['finance.ledger.view', 'finance.ledger.voucher.prepare']
const VIEW = ['finance.ledger.view']
const STANDING = 'This page reads the tax accounts as the ledger holds them. The CSV beside each account is a worksheet for the person who writes the return; the return itself is not produced here.'

const acct = (over: Record<string, unknown>) => ({
  id: 'x', code: '0', name: 'x', root_type: 'asset', report_type: 'balance_sheet', account_type: null, parent_id: null,
  is_group: false, is_postable: true, status: 'active', ...over,
})
const CHART = [
  acct({ id: 'vat', code: '2300', name: 'VAT control', root_type: 'liability', account_type: 'tax' }),
  acct({ id: 'bank1', code: '1200', name: 'Bank CBZ', account_type: 'bank' }),
  acct({ id: 'bank2', code: '1210', name: 'Bank Stanbic', account_type: 'bank' }),
]
const period = (status = 'open') => ({
  id: 'per1', financial_year_id: 'y1', period_no: 1, label: 'P1', from_date: '1990-01-01', to_date: '2099-12-31', status, closed_at: null, locked_at: null,
})
const taxData = (over: Record<string, unknown> = {}) => ({
  accounts: [{
    id: 'vat', code: '2300', name: 'VAT control', root_type: 'liability',
    balances: [
      { currency: 'USD', net_debit: '15.00', amount: '15.00', side: 'Dr' },
      { currency: 'ZWG', net_debit: '-40.00', amount: '40.00', side: 'Cr' },
    ],
  }],
  periods: [
    { period_id: 'p4', period_no: 4, label: 'April', from_date: '2026-04-01', to_date: '2026-04-30' },
    { period_id: 'p5', period_no: 5, label: 'May', from_date: '2026-05-01', to_date: '2026-05-31' },
  ],
  movements: [
    { ledger_account_id: 'vat', currency: 'USD', period_id: 'p5', debit: '15.00', credit: '0.00' },
    { ledger_account_id: 'vat', currency: 'ZWG', period_id: 'p5', debit: '0.00', credit: '40.00' },
  ],
  bank_accounts: [{ id: 'bank1', code: '1200', name: 'Bank CBZ' }, { id: 'bank2', code: '1210', name: 'Bank Stanbic' }],
  parties: [
    { party_id: 'zimra', name: 'ZIMRA', party_type: 'supplier', ledger_account_id: 'vat', currency: 'ZWG', net_debit: '-40.00', amount: '40.00', side: 'Cr' },
  ],
  period_balances: [
    { ledger_account_id: 'vat', currency: 'USD', period_id: 'p4', period_no: 4, closing: '0.00', side: 'Dr' },
    { ledger_account_id: 'vat', currency: 'USD', period_id: 'p5', period_no: 5, closing: '15.00', side: 'Dr' },
  ],
  note: '',
  ...over,
})

let wrappers: VueWrapper[] = []
async function setup(opts: { permissions?: string[]; year?: string | null; path?: string; currency?: 'USD' | 'ZWG' } = {}) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: opts.permissions ?? PREPARE, department_scope: [], catalogue: [] }
  store.selectedYearId = opts.year === undefined ? 'y1' : opts.year
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/tax', name: 'acc-tax', component: TaxControlPage },
      { path: '/ledger', name: 'acc-ledger', component: Stub },
      { path: '/ledger/:id', name: 'acc-account', component: Stub },
      { path: '/journals/:id', name: 'acc-voucher', component: Stub },
      { path: '/payable/:partyId', name: 'acc-creditor', component: Stub },
    ],
  })
  await router.push(opts.path ?? '/tax')
  await router.isReady()
  const w = mount(TaxControlPage, { attachTo: document.body, global: { plugins: [router] } })
  wrappers.push(w)
  await flushPromises()
  return { w, router }
}
const button = (w: VueWrapper, text: string) => w.findAll('button').find(b => b.text() === text)
const PAY = 'Record a payment to the tax authority'
const dialog = () => document.body.querySelector('[role="dialog"]') as HTMLElement | null
const field = (id: string) => document.body.querySelector(`#${id}`) as HTMLInputElement
async function type(id: string, v: string) { const el = field(id); el.value = v; el.dispatchEvent(new Event('input')); await flushPromises() }
async function pickBank(w: VueWrapper, id: string) {
  const sel = w.find('select')
  ;(sel.element as HTMLSelectElement).value = id
  await sel.trigger('change')
  await flushPromises()
}
const deferred = <T,>() => { let res!: (v: T) => void; const p = new Promise<T>(r => { res = r }); return { p, res } }

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  resetLedgerLists()
  document.body.innerHTML = ''
  tax.mockResolvedValue(taxData())
  api.accounts.mockResolvedValue({ accounts: CHART })
  api.parties.mockResolvedValue({ parties: [], total: 0, limit: 200, offset: 0 })
  api.periods.mockResolvedValue({ periods: [period()], total: 1 })
  api.createVoucher.mockResolvedValue({ voucher: { id: 'v9', voucher_no: 'JV-000009' } })
})
afterEach(() => { wrappers.forEach(w => w.unmount()); wrappers = [] })

describe('states', () => {
  it('shows the standing sentence in every state', async () => {
    expect((await setup()).w.text()).toContain(STANDING)
    expect((await setup({ year: null })).w.text()).toContain(STANDING)
    tax.mockResolvedValue(taxData({ accounts: [] }))
    expect((await setup()).w.text()).toContain(STANDING)
    tax.mockRejectedValue(new Error('x'))
    expect((await setup()).w.text()).toContain(STANDING)
  })
  it('shows the server note as sent when it is not empty', async () => {
    tax.mockResolvedValue(taxData({ note: 'Balances are as at the last posting.' }))
    expect((await setup()).w.text()).toContain('Balances are as at the last posting.')
  })
  it('with no year selected, says so and makes no call', async () => {
    const { w } = await setup({ year: null })
    expect(w.text()).toContain('Choose a financial year in the banner above.')
    expect(tax).not.toHaveBeenCalled()
  })
  it('shows a loading state while the read is in flight', async () => {
    const d = deferred<ReturnType<typeof taxData>>()
    tax.mockReturnValue(d.p)
    const { w } = await setup()
    expect(w.find('[aria-busy="true"]').exists()).toBe(true)
    d.res(taxData())
    await flushPromises()
    expect(w.find('[aria-busy="true"]').exists()).toBe(false)
  })
  it('shows an error with Retry, and Retry reads again', async () => {
    tax.mockRejectedValueOnce(new Error('boom'))
    const { w } = await setup()
    expect(w.find('[role="alert"]').exists()).toBe(true)
    await button(w, 'Retry')!.trigger('click')
    await flushPromises()
    expect(tax).toHaveBeenCalledTimes(2)
    expect(w.text()).toContain('VAT control')
  })
  it('empty chart: says no account is marked as tax, how to mark one, and links to the General Ledger', async () => {
    tax.mockResolvedValue(taxData({ accounts: [] }))
    const { w } = await setup()
    expect(w.text()).toContain('No account in the chart is marked as tax')
    expect(w.text()).toContain('account type to tax')
    expect(w.findAll('a').find(a => a.text().includes('General Ledger'))!.attributes('href')).toBe('/ledger')
  })
})

describe('the figures', () => {
  it('links each figure to the account ledger for that period\'s dates, in the book shown', async () => {
    const { w } = await setup({ path: '/tax?book=USD' })
    const link = w.findAll('a').find(a => a.text() === '15.00')!
    expect(link.attributes('href')).toBe('/ledger/vat?book=USD&from=2026-05-01&to=2026-05-31')
  })
  it('shows a nil movement as a dash, not a link, and the closing balance as sent', async () => {
    const { w } = await setup({ path: '/tax?book=USD' })
    const rows = w.findAll('tbody tr')
    expect(rows[0].text()).toContain('April')
    expect(rows[0].findAll('a')).toHaveLength(0)
    expect(rows[0].findAll('td').slice(1).map(td => td.text())).toEqual(['—', '—', '—'])
    expect(rows[1].findAll('td')[2].text()).toBe('—')
    expect(rows[1].findAll('td')[2].find('a').exists()).toBe(false)
    // The closing balance is the server's own, at each period end; a nil one keeps its dash.
    expect(rows[0].findAll('td')[3].text()).toBe('—')
    expect(rows[1].findAll('td')[3].text()).toBe('15.00 Dr')
  })
  it('shows one book at a time, and the switch changes the book in the query', async () => {
    const { w, router } = await setup({ path: '/tax?book=USD' })
    expect(w.text()).toContain('Debits (USD)')
    expect(w.text()).not.toContain('40.00')
    await w.findAll('[role="radio"]').find(b => b.text() === 'ZWG')!.trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.query.book).toBe('ZWG')
    expect(w.text()).toContain('Debits (ZWG)')
    expect(w.findAll('a').find(a => a.text() === '40.00')!.attributes('href')).toBe('/ledger/vat?book=ZWG&from=2026-05-01&to=2026-05-31')
    expect(w.text()).not.toContain('15.00')
  })
  it('shows a Cr balance as Cr and a Dr balance as Dr', async () => {
    const usd = await setup({ path: '/tax?book=USD' })
    expect(usd.w.find('.tx-bal').text()).toMatch(/15\.00\s+Dr/)
    const zwg = await setup({ path: '/tax?book=ZWG' })
    expect(zwg.w.find('.tx-bal').text()).toMatch(/40\.00\s+Cr/)
  })
  it('shows a zero balance without a side', async () => {
    tax.mockResolvedValue(taxData({ accounts: [{ id: 'vat', code: '2300', name: 'VAT control', root_type: 'liability', balances: [{ currency: 'USD', net_debit: '0.00', amount: '0.00', side: 'Dr' }] }] }))
    const { w } = await setup({ path: '/tax?book=USD' })
    expect(w.find('.tx-bal').text()).toContain('0.00')
    expect(w.find('.tx-bal').text()).not.toMatch(/\b(Dr|Cr)\b/)
  })
  it('ignores an out-of-order response: the later year wins', async () => {
    const slow = deferred<ReturnType<typeof taxData>>()
    tax.mockReturnValueOnce(slow.p)
    const { w } = await setup()
    tax.mockResolvedValueOnce(taxData({ accounts: [{ id: 'vat', code: '2300', name: 'Newer account', root_type: 'liability', balances: [] }] }))
    useFinanceStore().selectedYearId = 'y2'
    await flushPromises()
    slow.res(taxData({ accounts: [{ id: 'vat', code: '2300', name: 'Older account', root_type: 'liability', balances: [] }] }))
    await flushPromises()
    expect(w.text()).toContain('Newer account')
    expect(w.text()).not.toContain('Older account')
  })
})

describe('the payment', () => {
  it('has no button, and says why, without the prepare permission', async () => {
    const { w } = await setup({ permissions: VIEW })
    expect(button(w, PAY)).toBeUndefined()
    expect(w.find('select').exists()).toBe(false)
    expect(w.text()).toContain('not available to your role')
  })
  it('has no button, and says why, when no period is open', async () => {
    api.periods.mockResolvedValue({ periods: [period('closed')], total: 1 })
    const { w } = await setup()
    expect(button(w, PAY)).toBeUndefined()
    expect(w.text()).toContain('No accounting period is open')
  })
  it('a failed period load shows an error with Retry, and no button', async () => {
    api.periods.mockRejectedValueOnce(new Error('down'))
    const { w } = await setup()
    expect(button(w, PAY)).toBeUndefined()
    expect(w.find('[role="alert"]').exists()).toBe(true)
    await button(w, 'Retry')!.trigger('click')
    await flushPromises()
    expect(button(w, PAY)).toBeDefined()
  })
  it('does not open the dialog until the bank account is chosen', async () => {
    const { w } = await setup()
    const btn = button(w, PAY)!
    expect(btn.attributes('aria-disabled')).toBe('true')
    await btn.trigger('click')
    await flushPromises()
    expect(dialog()).toBeNull()
    expect(w.text()).toContain('Choose the bank account')
    await pickBank(w, 'bank2')
    expect(button(w, PAY)!.attributes('aria-disabled')).toBeUndefined()
    await button(w, PAY)!.trigger('click')
    await flushPromises()
    expect(dialog()).not.toBeNull()
  })
  it('builds Dr tax / Cr bank, in the book shown', async () => {
    const { w } = await setup({ path: '/tax?book=ZWG' })
    await pickBank(w, 'bank2')
    await button(w, PAY)!.trigger('click')
    await flushPromises()
    const gj = w.findComponent(GuidedJournalDialog)
    expect(gj.props('fixed')).toMatchObject({ ledger_account_id: 'bank2', side: 'credit' })
    const picker = gj.findAllComponents(AccountPicker)[0]
    const ids = (picker.props('accounts') as typeof CHART).filter(picker.props('filter') as (a: unknown) => boolean).map(a => a.id)
    expect(ids).toEqual(['vat'])
    picker.vm.$emit('update:modelValue', 'vat')
    await flushPromises()
    await type('gj-amount', '15.00')
    ;(Array.from(document.body.querySelectorAll('[role="dialog"] button')).find(b => b.textContent === 'Save as draft') as HTMLElement).click()
    await flushPromises()
    expect(api.createVoucher).toHaveBeenCalledTimes(1)
    const body = api.createVoucher.mock.calls[0][0]
    expect(body.currency).toBe('ZWG')
    expect(body.financial_year_id).toBe('y1')
    expect(body.voucher_type).toBe('journal')
    expect(body.lines).toEqual([{ ledger_account_id: 'vat', debit: '15.00' }, { ledger_account_id: 'bank2', credit: '15.00' }])
  })
})

describe('the statutory bodies', () => {
  it('names who the tax accounts say the council owes, in the book shown, linked to their statements', async () => {
    const { w } = await setup({ path: '/tax?book=ZWG' })
    const row = w.findAll('tbody tr').find(r => r.text().includes('ZIMRA'))!
    expect(row.text()).toContain('ZIMRA')
    expect(row.text()).toContain('40.00 Cr')
    expect(row.text()).toContain('owed')
    expect(row.text()).toContain('2300 VAT control')
    const statement = row.findAll('a').find(a => a.text() === 'Creditor statement')!
    expect(statement.attributes('href')).toBe('/payable/zimra?book=ZWG')
    // The ZWG-only party is not offered on the USD book.
    const usd = await setup({ path: '/tax?book=USD' })
    expect(usd.w.text()).toContain('No party is named on a tax account')
  })

  it('exports the control account as the server wrote it, and shows the refusal', async () => {
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    api.accountLedgerCsv.mockResolvedValueOnce(new Blob(['csv']))
    const { w } = await setup({ path: '/tax?book=USD' })
    await w.findAll('button').find(b => b.text().includes('Worksheet CSV'))!.trigger('click')
    await flushPromises()
    expect(api.accountLedgerCsv).toHaveBeenCalledWith('vat', {
      financial_year_id: 'y1', currency: 'USD', from: '2026-04-01', to: '2026-05-31',
    })

    api.accountLedgerCsv.mockRejectedValueOnce({ response: { status: 413, data: { message: 'This range holds more entries than one export carries.' } } })
    await w.findAll('button').find(b => b.text().includes('Worksheet CSV'))!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('This range holds more entries than one export carries.')
  })
})
