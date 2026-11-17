// @vitest-environment happy-dom
//
// The Salaries Journal page of the Accounting workspace. Its rules:
//
//   1. THE MONTH'S TOTALS, NOT A PAYROLL: the standard legs are named for the Zimbabwean month
//      (gross, PAYE to ZIMRA, NSSA, the employer's share, net pay) and nothing is preselected —
//      no account exists until the Council resolves one.
//   2. THE GUIDE IS A GUIDE: the running Dr/Cr is exact cents in the browser; the server's figures
//      replace it on save, and the database refuses what does not balance.
//   3. THE DRAFT POSTS NOTHING: the number is SJ-, issued by the server, and somebody else posts it.
//   4. WITHOUT THE PERMISSION THE PAGE SAYS SO: no form that can only 403.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../api/ledgerApi', () => ({
  ledgerApi: {
    accounts: vi.fn(), parties: vi.fn(), periods: vi.fn(), vouchers: vi.fn(),
    createSalariesJournal: vi.fn(),
  },
}))

import { ledgerApi } from '../api/ledgerApi'
import SalariesPage from '../workspaces/accountant/pages/SalariesPage.vue'
import { useFinanceStore } from '../stores/finance'

const api = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })
const PREPARER = ['finance.ledger.voucher.prepare']

/** The pickers stand in as plain selects, so a test chooses an account the way a person does. */
const AccountStub = defineComponent({
  name: 'AccountPicker',
  props: { modelValue: { type: String, default: '' }, accounts: { type: Array, default: () => [] }, label: { type: String, default: '' } },
  emits: ['update:modelValue'],
  render() {
    return h('select', {
      class: 'acct-stub', 'aria-label': this.label,
      value: this.modelValue,
      onChange: (e: Event) => this.$emit('update:modelValue', (e.target as HTMLSelectElement).value),
    }, [h('option', { value: '' }, 'Choose'), ...((this.accounts as Array<{ id: string; code: string }>) ?? []).map((a) => h('option', { value: a.id }, a.code))])
  },
})
const PartyStub = defineComponent({
  name: 'PartyPicker',
  props: { modelValue: { type: String, default: '' }, parties: { type: Array, default: () => [] }, label: { type: String, default: '' }, placeholder: { type: String, default: '' } },
  emits: ['update:modelValue'],
  render() {
    return h('select', {
      class: 'party-stub', 'aria-label': this.label,
      value: this.modelValue,
      onChange: (e: Event) => this.$emit('update:modelValue', (e.target as HTMLSelectElement).value),
    }, [h('option', { value: '' }, 'None'), ...((this.parties as Array<{ id: string; name: string }>) ?? []).map((p) => h('option', { value: p.id }, p.name))])
  },
})

const account = (id: string, code: string, over: Record<string, unknown> = {}) => ({
  id, code, name: code, root_type: 'expense', report_type: 'performance', account_type: null, parent_id: null,
  is_group: false, is_postable: true, status: 'active', notes: null, ...over,
})
const CHART = [
  account('a1', '5100', { name: 'Salaries' }),
  account('a2', '2100', { name: 'PAYE', root_type: 'liability', report_type: 'balance_sheet', account_type: 'tax' }),
  account('a3', '2110', { name: 'NSSA', root_type: 'liability', report_type: 'balance_sheet', account_type: 'tax' }),
  account('a4', '1100', { name: 'Bank', root_type: 'asset', report_type: 'balance_sheet', account_type: 'bank' }),
]
const PARTIES = [
  { id: 'p1', name: 'ZIMRA', party_type: 'supplier', reference: null, status: 'active' },
  { id: 'p2', name: 'NSSA', party_type: 'supplier', reference: null, status: 'active' },
]
const PERIODS = [{ id: 'q1', period_no: 1, label: 'January', from_date: '2026-01-01', to_date: '2026-01-31', status: 'open', financial_year_id: 'y1' }]

async function setup(opts: { permissions?: string[]; year?: string | null } = {}) {
  const store = useFinanceStore()
  store.identity = {
    user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: opts.permissions ?? PREPARER, department_scope: [], catalogue: [],
  }
  store.selectedYearId = opts.year === undefined ? 'y1' : opts.year
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'acc-salaries', component: SalariesPage },
      { path: '/v/:id', name: 'acc-voucher', component: Stub },
      { path: '/journals', name: 'acc-journals', component: Stub },
      { path: '/ledger', name: 'acc-ledger', component: Stub },
    ],
  })
  await router.push('/')
  await router.isReady()
  const w = mount(defineComponent({ render: () => h(RouterView) }), {
    attachTo: document.body,
    global: { plugins: [router], stubs: { AccountPicker: AccountStub, PartyPicker: PartyStub } },
  })
  await flushPromises()
  return { w, router }
}
type W = Awaited<ReturnType<typeof setup>>['w']
const button = (w: W, text: string) => w.findAll('button').find((b) => b.text().includes(text))
/** The amount boxes in leg order. */
const amounts = (w: W) => w.findAll('input[inputmode="decimal"]')
const accounts = (w: W) => w.findAll('select.acct-stub')
const parties = (w: W) => w.findAll('select.party-stub')

/** The month, filled: gross 20,000 + employer 1,800 against PAYE 4,200, NSSA 2,700 and net 14,900. */
async function fillMonth(w: W): Promise<void> {
  const a = accounts(w)
  await a[0].setValue('a1') // Gross salaries
  await a[1].setValue('a2') // PAYE
  await a[2].setValue('a3') // NSSA
  await a[3].setValue('a1') // Employer's contributions
  await a[4].setValue('a4') // Net pay
  const p = parties(w)
  await p[1].setValue('p1') // ZIMRA on PAYE
  await p[2].setValue('p2') // NSSA on its leg
  const m = amounts(w)
  await m[0].setValue('20000.00')
  await m[1].setValue('4200.00')
  await m[2].setValue('2700.00')
  await m[3].setValue('1800.00')
  await m[4].setValue('14900.00')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  window.history.replaceState(null, '')
  document.body.innerHTML = ''
  api.accounts.mockResolvedValue({ accounts: CHART })
  api.parties.mockResolvedValue({ parties: PARTIES, total: PARTIES.length })
  api.periods.mockResolvedValue({ periods: PERIODS })
  api.vouchers.mockResolvedValue({ vouchers: [], total: 0, limit: 10, offset: 0, scope_applied: null, queues: {} })
  api.createSalariesJournal.mockResolvedValue({
    voucher: { id: 'v1', voucher_no: 'SJ-0000001', voucher_type: 'payroll', currency: 'USD', financial_year_id: 'y1', posting_date: '2026-01-31', status: 'draft', prepared_by: 'u-me', prepared_at: 'now', version: 1 },
    lines: 5, balance: { debit_total: '21800.00', credit_total: '21800.00', difference: '0.00' }, balances: true, note: 'The draft balances.',
  })
})

describe('the Salaries Journal', () => {
  it('opens on the standard legs of the month, with their sides fixed and nothing preselected', async () => {
    const { w } = await setup()
    expect(api.vouchers).toHaveBeenCalledWith({ voucher_type: 'payroll', financial_year_id: 'y1', limit: 10 })
    const rows = w.findAll('tbody tr')
    expect(rows).toHaveLength(5)
    expect(rows[0].text()).toContain('Gross salaries')
    expect(rows[1].text()).toContain('PAYE (ZIMRA)')
    expect(rows[2].text()).toContain('NSSA contributions (employee)')
    expect(rows[3].text()).toContain("Employer's contributions")
    expect(rows[4].text()).toContain('Net pay')
    expect(w.findAll('option[value="debit"]').filter((o) => (o.element as HTMLOptionElement).selected)).toHaveLength(2)
    expect(w.findAll('option[value="credit"]').filter((o) => (o.element as HTMLOptionElement).selected)).toHaveLength(3)
    expect(w.find('[data-testid="sj-guide"]').text()).toContain('No amounts yet')
    expect(w.text()).toContain('This is not a payroll system')
  })

  it('guides the running balance in exact cents and says when the month is in balance', async () => {
    const { w } = await setup()
    const m = amounts(w)
    await m[0].setValue('20000.00')
    await flushPromises()
    expect(w.find('[data-testid="sj-guide"]').text()).toContain('Debits 20000.00')
    expect(w.find('[data-testid="sj-guide"]').text()).toContain('Out of balance by 20000.00')
    await m[1].setValue('4200.00')
    await m[2].setValue('2700.00')
    await m[4].setValue('13100.00')
    await flushPromises()
    expect(w.find('[data-testid="sj-guide"]').text()).toContain('In balance')
    expect(w.find('.cw-banner-msg').exists()).toBe(false)
  })

  it('raises the draft with each leg on its side, its party and its narration, and moves to the voucher', async () => {
    const { w, router } = await setup()
    await w.find('#sj-narr').setValue('Salaries for January 2026')
    await fillMonth(w)
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.createSalariesJournal).toHaveBeenCalledTimes(1)
    const body = api.createSalariesJournal.mock.calls[0][0]
    expect(body).toMatchObject({ currency: 'USD', financial_year_id: 'y1', narration: 'Salaries for January 2026' })
    expect(body.lines).toHaveLength(5)
    expect(body.lines[0]).toMatchObject({ ledger_account_id: 'a1', debit: '20000.00', narration: 'Gross salaries' })
    expect(body.lines[1]).toMatchObject({ ledger_account_id: 'a2', credit: '4200.00', party_id: 'p1', narration: 'PAYE (ZIMRA)' })
    expect(body.lines[2]).toMatchObject({ ledger_account_id: 'a3', credit: '2700.00', party_id: 'p2' })
    expect(body.lines[3]).toMatchObject({ ledger_account_id: 'a1', debit: '1800.00' })
    expect(body.lines[4]).toMatchObject({ ledger_account_id: 'a4', credit: '14900.00' })
    // No voucher number is typed or sent: the server issues SJ-.
    expect(body.voucher_no).toBeUndefined()
    expect(router.currentRoute.value.name).toBe('acc-voucher')
    expect(router.currentRoute.value.params.id).toBe('v1')
  })

  it('refuses to save a month with no accounts, naming each leg, and asks the server for nothing', async () => {
    const { w } = await setup()
    const m = amounts(w)
    await m[0].setValue('20000.00')
    await m[1].setValue('4200.00')
    await flushPromises()
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.createSalariesJournal).not.toHaveBeenCalled()
    const problems = w.find('[role="alert"]')
    expect(problems.text()).toContain('Leg 1 (Gross salaries) cites no account in the chart.')
    expect(problems.text()).toContain('Leg 2 (PAYE (ZIMRA)) cites no account in the chart.')
    expect(w.text()).toContain('Out of balance by 15800.00') // the guide still tells the truth
  })

  it('adds a leg for whatever else the month carries, and it can be removed', async () => {
    const { w } = await setup()
    await button(w, 'Add a leg')!.trigger('click')
    expect(w.findAll('tbody tr')).toHaveLength(6)
    const named = w.findAll('tbody tr')[5].find('input[placeholder="Leg name (e.g. Pension)"]')
    expect(named.exists()).toBe(true)
    await named.setValue('Pension')
    await w.findAll('tbody button[aria-label^="Remove leg"]')[5].trigger('click')
    expect(w.findAll('tbody tr')).toHaveLength(5)
  })

  it('lists the year\'s salaries journals with what still waits', async () => {
    api.vouchers.mockResolvedValue({
      vouchers: [
        { id: 'v0', voucher_no: 'SJ-0000001', voucher_type: 'payroll', currency: 'USD', financial_year_id: 'y1', posting_date: '2026-01-31', narration: 'Salaries for January 2026', reference: null, status: 'draft', reverses_voucher_id: null, reverses_voucher_no: null, reversed_by_voucher_no: null, is_opening: false, prepared_by: 'u-them', prepared_at: 'now', posted_by: null, posted_at: null, prepared_by_name: 'T. Chirwa', posted_by_name: null, version: 1, cancelled_by: null, cancelled_at: null, cancelled_reason: null, line_count: 5, debit_total: '21800.00', credit_total: '21800.00' },
      ],
      total: 1, limit: 10, offset: 0, scope_applied: null, queues: {},
    })
    const { w } = await setup()
    expect(w.text()).toContain("This year's salaries journals")
    expect(w.text()).toContain('SJ-0000001')
    expect(w.text()).toContain('Draft, waiting to be posted by somebody other than T. Chirwa')
    expect(w.findAll('a').some((a) => a.text() === 'SJ-0000001')).toBe(true)
  })

  it('says who may prepare when the role holds no such permission, and offers no form', async () => {
    const { w } = await setup({ permissions: ['finance.ledger.view'] })
    expect(w.find('form').exists()).toBe(false)
    expect(w.text()).toContain('This action is not available to your role.')
  })

  it('shows the server\'s refusal on save, keeping the typed month', async () => {
    api.createSalariesJournal.mockRejectedValue({ response: { status: 409, data: { message: 'accounting period 1 is closed and accepts no postings' } } })
    const { w } = await setup()
    await fillMonth(w)
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('accounting period 1 is closed and accepts no postings')
    expect((amounts(w)[0].element as HTMLInputElement).value).toBe('20000.00')
  })
})
