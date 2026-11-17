// @vitest-environment happy-dom
//
// Creditors: a creditor's statement of account, the drill-downs from Accounts Payable and Parties,
// the creditors age analysis, and changing an asset category.
//   1. THE CREDITOR STATEMENT IS THE SERVER'S `kind=payable` STATEMENT, one book at a time, figures as sent.
//   2. EVERY DOCUMENT DRILLS TO ITS VOUCHER; every supplier drills to its statement.
//   3. THE AGE ANALYSIS IS THE DASHBOARD'S OWN TOTALS; nothing is added up in the browser.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h, type Component } from 'vue'

vi.mock('../api/ledgerApi', () => ({
  ledgerApi: { accounts: vi.fn(), parties: vi.fn(), periods: vi.fn(), createParty: vi.fn(), updateParty: vi.fn() },
}))
vi.mock('../api/accountingApi', () => ({ accountingApi: { partyStatement: vi.fn(), dashboard: vi.fn() } }))
vi.mock('../api/payablesApi', () => ({
  payablesApi: { summary: vi.fn(), open: vi.fn(), invoices: vi.fn(), payments: vi.fn(), invoice: vi.fn() },
}))
vi.mock('../api/assetsApi', () => ({
  assetsApi: { assets: vi.fn(), categories: vi.fn(), runs: vi.fn(), updateCategory: vi.fn(), createCategory: vi.fn() },
}))

import { ledgerApi } from '../api/ledgerApi'
import { accountingApi } from '../api/accountingApi'
import { payablesApi } from '../api/payablesApi'
import { assetsApi } from '../api/assetsApi'
import CreditorStatementPage from '../workspaces/accountant/pages/CreditorStatementPage.vue'
import AccountsPayable from '../workspaces/accountant/pages/AccountsPayable.vue'
import PartiesPage from '../workspaces/accountant/pages/PartiesPage.vue'
import AssetRegister from '../workspaces/accountant/pages/AssetRegister.vue'
import { accountantRoutes } from '../workspaces/accountant/routes'
import { resetAccountant, useAccountant } from '../workspaces/accountant/useAccountant'
import { useFinanceStore } from '../stores/finance'

const led = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const acc = accountingApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const pay = payablesApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const ast = assetsApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })

const cr = (a: string) => ({ net_debit: `-${a}`, amount: a, side: 'Cr' as const })
const SUPPLIER = { id: 's1', party_type: 'supplier', name: 'Gweru Hardware', reference: 'SUP-4', status: 'active', address_text: '9 Fifth Street' }
const statement = (over: Record<string, unknown> = {}) => ({
  party: SUPPLIER, currency: 'USD', kind: 'payable', brought_forward: cr('0.00'),
  entries: [{
    id: 'e1', voucher_id: 'v9', voucher_no: 'PI-0000003', voucher_type: 'purchase_invoice', posting_date: '2026-10-02', narration: 'Cement',
    party_id: 's1', party_name: 'Gweru Hardware', debit: '0.00', credit: '450.00', balance: cr('450.00'), reconciled: null, account_code: '2100',
  }],
  carried_forward: cr('450.00'),
  open_items: [{
    voucher_id: 'v9', voucher_no: 'PI-0000003', voucher_type: 'purchase_invoice', posting_date: '2026-10-01', ledger_account_id: 'ap1',
    billed_amount: '450.00', settled_amount: '0.00', outstanding_amount: '450.00', days_outstanding: 46, ageing_bucket: '31_60',
  }],
  as_at: '2026-11-16', ...over,
})

let wrappers: VueWrapper[] = []
async function setup(page: Component, path: string, permissions: string[] = ['finance.ledger.view']) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u-me', role: 'accountant', authority_id: 1, permissions, department_scope: [], catalogue: [] }
  store.selectedYearId = 'y1'
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/payable', name: 'acc-payable', component: page },
      { path: '/payable/:partyId', name: 'acc-creditor', component: page },
      { path: '/receivable/:partyId', name: 'acc-debtor', component: Stub },
      { path: '/parties', name: 'acc-parties', component: page },
      { path: '/assets', name: 'acc-assets', component: page },
      { path: '/ledger', name: 'acc-ledger', component: Stub },
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

beforeEach(() => {
  setActivePinia(createPinia())
  for (const m of [led, acc, pay, ast]) for (const f of Object.values(m)) f.mockReset()
  resetAccountant()
})
afterEach(() => {
  for (const w of wrappers) w.unmount()
  wrappers = []
  document.body.innerHTML = ''
})

describe('the creditor statement', () => {
  it('is registered under Accounts Payable', () => {
    const children = accountantRoutes[0].children ?? []
    const r = children.find(x => x.name === 'acc-creditor')
    expect(r?.path).toBe('payable/:partyId')
    expect(r?.meta?.cwNav).toBe('acc-payable')
  })

  it('asks the server for the payable statement in the chosen book and shows its figures as sent', async () => {
    acc.partyStatement.mockResolvedValue(statement())
    const { w } = await setup(CreditorStatementPage, '/payable/s1?book=USD')
    expect(acc.partyStatement).toHaveBeenCalledWith('s1', { currency: 'USD', kind: 'payable' })
    const text = w.text()
    expect(text).toContain('Gweru Hardware')
    expect(text).toContain('450.00 Cr')
    expect(text).toContain('31 to 60 days')
    const links = w.findAll('a').filter(a => a.text() === 'PI-0000003')
    expect(links.length).toBe(2)
    expect(links[0].attributes('href')).toBe('/journals/v9')
  })

  it('passes the dates and says when nothing is unpaid', async () => {
    acc.partyStatement.mockResolvedValue(statement({ open_items: [] }))
    const { w } = await setup(CreditorStatementPage, '/payable/s1?book=ZWG&from=2026-01-01&to=2026-06-30')
    expect(acc.partyStatement).toHaveBeenCalledWith('s1', { currency: 'ZWG', kind: 'payable', from: '2026-01-01', to: '2026-06-30' })
    expect(w.text()).toContain('Nothing is unpaid in the USD book.')
  })

  it('shows a refusal as an alert with Retry', async () => {
    acc.partyStatement.mockRejectedValueOnce({ response: { status: 413, data: { message: 'Narrow the dates and read it in parts.' } } })
    const { w } = await setup(CreditorStatementPage, '/payable/s1')
    const alert = w.find('[role="alert"]')
    expect(alert.text()).toContain('Narrow the dates')
    acc.partyStatement.mockResolvedValue(statement())
    await w.findAll('button').find(b => b.text() === 'Retry')!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('Accounts Payable drill-downs and age analysis', () => {
  const summary = { owed: [], awaiting_approval: { invoices: 0, payments: 0 }, payable_accounts: [{ id: 'ap1', code: '2100', name: 'Creditors' }], tax_accounts: [], bank_accounts: [], methods: ['bank_transfer'] }
  const open = {
    currency: 'USD', party_id: 's1', party_name: 'Gweru Hardware', party_reference: null, voucher_id: 'v9', voucher_no: 'PI-0000003',
    voucher_type: 'purchase_invoice', supplier_invoice_id: 'i1', document_ref: 'INV-77', document_date: '2026-10-01', due_date: null,
    raised: '450.00', settled: '0.00', outstanding: '450.00', pending: '0.00', payable: '450.00', days_outstanding: 46, days_overdue: 0,
    payable_code: '2100', bucket: '31_60',
  }
  function mocks() {
    pay.summary.mockResolvedValue(summary)
    pay.open.mockResolvedValue([open])
    pay.invoices.mockResolvedValue([])
    pay.payments.mockResolvedValue([])
    led.parties.mockResolvedValue({ parties: [] })
    led.accounts.mockResolvedValue({ accounts: [] })
  }

  it('links the supplier to its statement and the document to its voucher', async () => {
    mocks()
    const { w } = await setup(AccountsPayable, '/payable')
    expect(w.findAll('a').find(a => a.text() === 'Gweru Hardware')?.attributes('href')).toBe('/payable/s1?book=USD')
    expect(w.findAll('a').find(a => a.text() === 'PI-0000003')?.attributes('href')).toBe('/journals/v9')
    expect(w.text()).not.toContain('Supplier Management')
  })

  it('shows the age analysis from the dashboard totals, as sent', async () => {
    mocks()
    const { state } = useAccountant()
    state.dashboard = {
      payables: [
        { currency: 'USD', bucket: 'current', items: 2, amount: '1200.00' },
        { currency: 'USD', bucket: 'over_90', items: 1, amount: '75.50' },
      ],
    } as unknown as typeof state.dashboard
    const { w } = await setup(AccountsPayable, '/payable')
    const card = w.find('[aria-label="Creditors age analysis"]')
    expect(card.exists()).toBe(true)
    expect(card.text()).toMatch(/1\s?200\.00/)
    expect(card.text()).toContain('75.50')
    expect(card.text()).toContain('2 documents')
  })

  it('shows no age analysis while the dashboard has nothing owed', async () => {
    mocks()
    const { w } = await setup(AccountsPayable, '/payable')
    expect(w.find('[aria-label="Creditors age analysis"]').exists()).toBe(false)
  })
})

describe('Parties', () => {
  it('links a supplier to the creditor statement', async () => {
    led.parties.mockResolvedValue({ parties: [SUPPLIER], total: 1 })
    const { w } = await setup(PartiesPage, '/parties?type=supplier')
    expect(w.findAll('a').find(a => a.text() === 'Gweru Hardware')?.attributes('href')).toBe('/payable/s1')
  })
  it('is a tab strip: arrows, Home and End change the type and move focus to the new tab', async () => {
    led.parties.mockResolvedValue({ parties: [], total: 0 })
    const { w, router } = await setup(PartiesPage, '/parties?type=supplier')
    const tabs = () => w.findAll('[role="tab"]')
    expect(tabs().map(t => t.attributes('tabindex'))).toEqual(['0', '-1', '-1', '-1', '-1'])
    expect(w.get('[role="tabpanel"]').attributes('aria-labelledby')).toBe(tabs()[0].attributes('id'))
    ;(tabs()[0].element as HTMLElement).focus()
    await tabs()[0].trigger('keydown', { key: 'ArrowRight' }); await flushPromises()
    expect(router.currentRoute.value.query.type).toBe('debtor')
    expect(document.activeElement).toBe(tabs()[1].element)
    await tabs()[1].trigger('keydown', { key: 'End' }); await flushPromises()
    expect(router.currentRoute.value.query.type).toBe('other')
    expect(document.activeElement).toBe(tabs()[4].element)
    await tabs()[4].trigger('keydown', { key: 'Home' }); await flushPromises()
    expect(router.currentRoute.value.query.type).toBe('supplier')
    expect(document.activeElement).toBe(tabs()[0].element)
  })
})

describe('the asset register: changing a category', () => {
  it('sends the change without the code and with the status', async () => {
    const cat = {
      id: 'c1', code: 'MV', name: 'Motor vehicles', method: 'straight_line', useful_life_months: 60, residual_pct: '10.00', status: 'active',
      asset_account_id: 'fa1', asset_account_code: '1600', asset_account_name: 'Vehicles', accumulated_account_id: 'ad1',
      accumulated_account_code: '1690', expense_account_id: 'de1', expense_account_code: '5600',
    }
    ast.assets.mockResolvedValue({ assets: [], totals: [] })
    ast.categories.mockResolvedValue({
      categories: [cat], comparison: [],
      accounts: [
        { id: 'fa1', code: '1600', name: 'Vehicles', root_type: 'asset', account_type: 'fixed_asset' },
        { id: 'ad1', code: '1690', name: 'Accumulated depreciation', root_type: 'asset', account_type: null },
        { id: 'de1', code: '5600', name: 'Depreciation', root_type: 'expense', account_type: null },
      ],
    })
    ast.runs.mockResolvedValue([])
    ast.updateCategory.mockResolvedValue(undefined)
    led.periods.mockResolvedValue({ periods: [] })
    const { w } = await setup(AssetRegister, '/assets', ['finance.ledger.view', 'finance.assets.manage'])
    await w.findAll('button').find(b => b.text() === 'Categories')!.trigger('click')
    await w.find('[aria-label="Edit Motor vehicles"]').trigger('click')
    const form = w.find('form[role="dialog"]')
    expect(form.find('h3').text()).toBe('Change Motor vehicles')
    const name = form.findAll('input').find(i => (i.element as HTMLInputElement).value === 'Motor vehicles')!
    await name.setValue('Motor vehicles and plant')
    await form.trigger('submit')
    await flushPromises()
    expect(ast.updateCategory).toHaveBeenCalledWith('c1', {
      name: 'Motor vehicles and plant', asset_account_id: 'fa1', status: 'active',
      accumulated_account_id: 'ad1', expense_account_id: 'de1', useful_life_months: 60, residual_pct: 10,
    })
    expect(ast.createCategory).not.toHaveBeenCalled()
  })
})
