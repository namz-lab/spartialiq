// @vitest-environment happy-dom
//
// The journal editor. Its rules:
//   1. The running balance is a guide in exact cents (0.10 + 0.20 = 0.30) and says it is a guide.
//   2. A refusal names the faulty line, in the sentences the accountant reads.
//   3. The server numbers a journal; a typed number is sent only when typed.
//   4. An out-of-balance draft may be saved, and the page says it cannot be posted.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('../api/ledgerApi', () => ({
  ledgerApi: {
    accounts: vi.fn(), parties: vi.fn(), periods: vi.fn(),
    voucher: vi.fn(), createVoucher: vi.fn(), updateVoucher: vi.fn(),
  },
}))

import { ledgerApi } from '../api/ledgerApi'
import JournalEditorPage from '../workspaces/accountant/pages/JournalEditorPage.vue'
import { resetLedgerLists } from '../workspaces/accountant/kit/useLedgerLists'
import { useFinanceStore } from '../stores/finance'

const api = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>

const acct = (id: string, code: string, name: string, account_type: string | null = null) => ({
  id, code, name, root_type: 'asset', report_type: 'financial_position', account_type,
  parent_id: null, is_group: false, is_postable: true, status: 'active',
})
const ACCOUNTS = [
  acct('a-bank', '1200', 'Bank - CBZ current', 'bank'),
  acct('a-fuel', '5310', 'Fuel and oils'),
  acct('a-debt', '1300', 'Rates debtors', 'receivable'),
]
const PARTIES = [{ id: 'p-1', party_type: 'debtor', name: 'Moyo Stores', reference: 'D-1', status: 'active' }]
const PERIODS = [
  { id: 'per-3', financial_year_id: 'fy1', period_no: 3, label: null, from_date: '2026-09-01', to_date: '2026-09-30', status: 'open', closed_at: null, locked_at: null, entry_count: 0 },
  { id: 'per-4', financial_year_id: 'fy1', period_no: 4, label: null, from_date: '2026-10-01', to_date: '2026-10-31', status: 'closed', closed_at: null, locked_at: null, entry_count: 0 },
  { id: 'per-5', financial_year_id: 'fy1', period_no: 5, label: null, from_date: '2026-11-01', to_date: '2026-11-30', status: 'locked', closed_at: null, locked_at: null, entry_count: 0 },
]

const Stub = { template: '<div />' }
const SAVED = { voucher: { id: 'v-new', voucher_no: 'JV-0000007' }, lines: 2, balance: { debit_total: '0.30', credit_total: '0.30', difference: '0.00' }, balances: true, note: 'Saved as a draft.' }

async function mountEditor(path = '/journals/new', year: string | null = 'fy1') {
  const permissions = ['finance.ledger.view', 'finance.ledger.voucher.prepare']
  const store = useFinanceStore()
  store.identity = { user_id: 'u-acc', role: 'accountant', authority_id: 1, permissions, department_scope: [], catalogue: [] } as never
  store.selectedYearId = year
  store.years = [{ id: 'fy1', label: 'FY2026', status: 'open', reporting_currency: 'USD' }] as never
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/journals', name: 'acc-journals', component: Stub },
      { path: '/journals/new', name: 'acc-journal-new', component: JournalEditorPage },
      { path: '/journals/:id/edit', name: 'acc-journal-edit', component: JournalEditorPage },
      { path: '/journals/:id', name: 'acc-voucher', component: Stub },
      { path: '/ledger', name: 'acc-ledger', component: Stub },
      { path: '/dash', name: 'acc-dashboard', component: Stub },
    ],
  })
  router.push(path)
  await router.isReady()
  const w = mount(JournalEditorPage, { global: { plugins: [router] }, attachTo: document.body })
  await flushPromises()
  return { w, router }
}

const lineRow = (w: VueWrapper, n: number) => w.find(`[data-line="${n}"]`)
const debit = (w: VueWrapper, n: number) => lineRow(w, n).find('input[data-field="debit"]')
const credit = (w: VueWrapper, n: number) => lineRow(w, n).find('input[data-field="credit"]')
async function pickAccount(w: VueWrapper, n: number, text: string) {
  const input = lineRow(w, n).find('input[data-account], input[role="combobox"]')
  await input.trigger('focus')
  await input.setValue(text)
  const opt = lineRow(w, n).findAll('[role="option"]')[0]
  await opt.trigger('click')
}
async function pickParty(w: VueWrapper, n: number, text: string) {
  const inputs = lineRow(w, n).findAll('input[role="combobox"]')
  await inputs[1].trigger('focus')
  await inputs[1].setValue(text)
  await lineRow(w, n).findAll('[role="option"]').find(o => o.text().includes(text))!.trigger('click')
}
const save = (w: VueWrapper) => w.findAll('button').find(b => b.text().includes('Save draft'))!

describe('the journal editor', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    resetLedgerLists()
    vi.clearAllMocks()
    document.body.innerHTML = ''
    api.accounts.mockResolvedValue({ accounts: ACCOUNTS })
    api.parties.mockResolvedValue({ parties: PARTIES, total: 1, limit: 200, offset: 0, note: null })
    api.periods.mockResolvedValue({ periods: PERIODS, total: 2 })
    api.createVoucher.mockResolvedValue(SAVED)
  })

  it('shows the guide in exact cents and marks it a guide', async () => {
    const { w } = await mountEditor()
    await debit(w, 1).setValue('0.10')
    await debit(w, 2).setValue('0.20')
    await w.find('[data-testid="add-line"]').trigger('click')
    await credit(w, 3).setValue('0.30')
    const g = w.find('[data-testid="guide"]').text()
    expect(g).toContain('Debits 0.30')
    expect(g).toContain('Credits 0.30')
    expect(g).toContain('In balance')
    expect(w.text()).toContain('A guide while you type. The exact figures are computed when the draft is saved.')
  })

  it('refuses a line with both sides, naming it', async () => {
    const { w } = await mountEditor()
    await pickAccount(w, 1, '1200'); await debit(w, 1).setValue('10.00')
    await pickAccount(w, 2, '5310'); await debit(w, 2).setValue('5.00'); await credit(w, 2).setValue('5.00')
    await save(w).trigger('click'); await flushPromises()
    expect(w.text()).toContain('Line 2 has both a debit and a credit.')
    expect(api.createVoucher).not.toHaveBeenCalled()
  })

  it('refuses an unreadable amount and leaves it out of the guide', async () => {
    const { w } = await mountEditor()
    await pickAccount(w, 1, '1200'); await debit(w, 1).setValue('1,250.50')
    await pickAccount(w, 2, '5310'); await credit(w, 2).setValue('10.00')
    const g = w.find('[data-testid="guide"]').text()
    expect(g).toContain('Debits 0.00')
    expect(g).toContain('1 line unreadable')
    await save(w).trigger('click'); await flushPromises()
    expect(w.text()).toContain('Line 1: write the amount as 1250.50.')
    expect(api.createVoucher).not.toHaveBeenCalled()
  })

  it('asks for the party on a control account', async () => {
    const { w } = await mountEditor()
    await pickAccount(w, 1, '1300'); await debit(w, 1).setValue('10.00')
    await pickAccount(w, 2, '1200'); await credit(w, 2).setValue('10.00')
    await save(w).trigger('click'); await flushPromises()
    expect(w.text()).toContain('Line 1 is on a control account and needs its party.')
    expect(api.createVoucher).not.toHaveBeenCalled()
    await pickParty(w, 1, 'Moyo Stores')
    await save(w).trigger('click'); await flushPromises()
    expect(api.createVoucher).toHaveBeenCalledTimes(1)
    expect(api.createVoucher.mock.calls[0][0].lines[0].party_id).toBe('p-1')
  })

  it('refuses fewer than two lines, and a line missing its account or amount', async () => {
    const { w } = await mountEditor()
    await pickAccount(w, 1, '1200'); await debit(w, 1).setValue('10.00')
    await save(w).trigger('click'); await flushPromises()
    expect(w.text()).toContain('A journal needs at least two lines.')
    await pickAccount(w, 2, '5310')
    await w.find('[data-testid="add-line"]').trigger('click')
    await debit(w, 3).setValue('3.00')
    await save(w).trigger('click'); await flushPromises()
    expect(w.text()).toContain('Line 2 has an account but no amount.')
    expect(w.text()).toContain('Line 3 has an amount but no account.')
    expect(api.createVoucher).not.toHaveBeenCalled()
  })

  it('sends no number when none is typed', async () => {
    const { w, router } = await mountEditor()
    await pickAccount(w, 1, '1200'); await debit(w, 1).setValue('10.00')
    await pickAccount(w, 2, '5310'); await credit(w, 2).setValue('10.00')
    await save(w).trigger('click'); await flushPromises()
    const body = api.createVoucher.mock.calls[0][0]
    expect('voucher_no' in body).toBe(false)
    expect(body).toMatchObject({ voucher_type: 'journal', currency: 'USD', financial_year_id: 'fy1' })
    expect(body.lines[0]).toEqual({ ledger_account_id: 'a-bank', debit: '10.00' })
    expect(body.lines[1]).toEqual({ ledger_account_id: 'a-fuel', credit: '10.00' })
    expect(router.currentRoute.value.name).toBe('acc-voucher')
    expect(router.currentRoute.value.params.id).toBe('v-new')
  })

  it('offers only the four types a person may type, and never rates_bill, receipt or closing', async () => {
    const { w } = await mountEditor()
    const values = w.findAll('select#je-type option').map(o => o.attributes('value'))
    expect(values).toEqual(['journal', 'opening', 'credit_note', 'write_off'])
    expect(w.text()).not.toContain('Year-end closing')
    expect(w.text()).toContain('Rates bills, receipts and year-end closing are raised by Revenue & Billing, the Cash Office and Period Close')
    // No type needs a typed number any more.
    expect(w.find('input#je-number').attributes('placeholder')).toBe('Issued on save')
    expect(w.find('input#je-number').attributes('required')).toBeUndefined()
  })

  it('shows foreign_reference with the line named, on create', async () => {
    api.createVoucher.mockRejectedValue({ response: { status: 400, data: { error: 'foreign_reference', message: "Line 2 names a party that is not in this council's records." } } })
    const { w, router } = await mountEditor()
    await pickAccount(w, 1, '1200'); await debit(w, 1).setValue('10.00')
    await pickAccount(w, 2, '5310'); await credit(w, 2).setValue('10.00')
    await save(w).trigger('click'); await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain("Line 2 names a party that is not in this council's records.")
    expect(router.currentRoute.value.name).toBe('acc-journal-new')
  })

  it('shows foreign_reference with the line named, on save of a draft', async () => {
    api.voucher.mockResolvedValue({
      voucher: { id: 'v2', voucher_no: 'JV-0000002', voucher_type: 'journal', currency: 'USD', status: 'draft', prepared_by: 'u-acc', posting_date: '2026-09-10', narration: null, reference: null, financial_year_id: 'fy1' },
      lines: [
        { ledger_account_id: 'a-fuel', debit: '5.00', credit: '0.00', party_id: null, department_id: null, project_id: null, narration: null },
        { ledger_account_id: 'a-bank', debit: '0.00', credit: '5.00', party_id: null, department_id: null, project_id: null, narration: null },
      ],
      source: null,
    })
    api.updateVoucher.mockRejectedValue({ response: { status: 400, data: { error: 'foreign_reference', message: "Line 1 names an account that is not in this council's records." } } })
    const { w } = await mountEditor('/journals/v2/edit')
    await save(w).trigger('click'); await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain("Line 1 names an account that is not in this council's records.")
  })

  it('refuses to open a reversal draft for line editing, and says why', async () => {
    api.voucher.mockResolvedValue({
      voucher: { id: 'v5', voucher_no: 'JV-1-R', voucher_type: 'reversal', currency: 'USD', status: 'draft', prepared_by: 'u-acc', posting_date: '2026-09-10', financial_year_id: 'fy1' },
      lines: [], source: null,
    })
    const { w } = await mountEditor('/journals/v5/edit')
    expect(w.find('[role="alert"]').text()).toContain('its lines cannot be edited')
    expect(w.find('[data-line]').exists()).toBe(false)
    expect(w.text()).toContain('Back to the voucher')
  })

  it('refuses to open a closing draft for line editing, and says why', async () => {
    api.voucher.mockResolvedValue({
      voucher: { id: 'v7', voucher_no: 'YC-1', voucher_type: 'closing', currency: 'USD', status: 'draft', prepared_by: 'u-acc', posting_date: '2026-12-31', financial_year_id: 'fy1' },
      lines: [], source: null,
    })
    const { w } = await mountEditor('/journals/v7/edit')
    expect(w.find('[role="alert"]').text()).toContain('A year-end closing is built from the books')
    expect(w.find('[data-line]').exists()).toBe(false)
  })

  it('refuses to open a draft that somebody else prepared, and says why', async () => {
    api.voucher.mockResolvedValue({
      voucher: { id: 'v6', voucher_no: 'JV-6', voucher_type: 'journal', currency: 'USD', status: 'draft', prepared_by: 'u-other', posting_date: '2026-09-10', financial_year_id: 'fy1' },
      lines: [], source: null,
    })
    const { w } = await mountEditor('/journals/v6/edit')
    expect(w.find('[role="alert"]').text()).toContain('Only the person who prepared this draft may change it.')
    expect(w.find('[data-line]').exists()).toBe(false)
  })

  it('saves an out-of-balance draft and says it cannot be posted', async () => {
    const { w } = await mountEditor()
    await pickAccount(w, 1, '1200'); await debit(w, 1).setValue('100.00')
    await pickAccount(w, 2, '5310'); await credit(w, 2).setValue('40.00')
    expect(w.find('[data-testid="guide"]').text()).toContain('Out of balance by 60.00')
    expect(w.text()).toContain('This draft does not balance, so it can be saved but not posted.')
    await save(w).trigger('click'); await flushPromises()
    expect(api.createVoucher).toHaveBeenCalledTimes(1)
  })

  it('balances on the focused line', async () => {
    const { w } = await mountEditor()
    await pickAccount(w, 1, '1200'); await debit(w, 1).setValue('100.00')
    await pickAccount(w, 2, '5310'); await credit(w, 2).setValue('40.00')
    await w.find('[data-testid="add-line"]').trigger('click')
    const bal = lineRow(w, 3).findAll('button').find(b => b.text().includes('Balance on this line'))!
    // WCAG 2.5.3 Label in Name: the accessible name starts with the visible words.
    expect(bal.attributes('aria-label')).toBe('Balance on this line, line 3')
    await bal.trigger('click')
    expect((credit(w, 3).element as HTMLInputElement).value).toBe('60.00')
    expect((debit(w, 3).element as HTMLInputElement).value).toBe('')
  })

  it('balances with Alt+B', async () => {
    const { w } = await mountEditor()
    await pickAccount(w, 1, '1200'); await debit(w, 1).setValue('100.00')
    await credit(w, 2).setValue('40.00')
    await credit(w, 2).trigger('keydown', { key: 'b', altKey: true })
    expect((credit(w, 2).element as HTMLInputElement).value).toBe('40.00')
    expect((debit(w, 2).element as HTMLInputElement).value).toBe('')
    expect((debit(w, 1).element as HTMLInputElement).value).toBe('100.00')
    expect((credit(w, 1).element as HTMLInputElement).value).toBe('')
    await w.find('[data-testid="add-line"]').trigger('click')
    await lineRow(w, 3).find('input[data-field="narration"]').trigger('keydown', { key: 'b', altKey: true })
    expect((credit(w, 3).element as HTMLInputElement).value).toBe('60.00')
    expect((debit(w, 3).element as HTMLInputElement).value).toBe('')
    expect((debit(w, 1).element as HTMLInputElement).value).toBe('100.00')
    expect((credit(w, 2).element as HTMLInputElement).value).toBe('40.00')
  })

  it('adds a line on Enter in the last line\'s narration', async () => {
    const { w } = await mountEditor()
    expect(w.findAll('[data-line]').length).toBe(2)
    await lineRow(w, 2).find('input[data-field="narration"]').trigger('keydown', { key: 'Enter' })
    expect(w.findAll('[data-line]').length).toBe(3)
  })

  it('copies the lines of an existing voucher', async () => {
    api.voucher.mockResolvedValue({
      voucher: { id: 'v1', voucher_no: 'JV-0000001', voucher_type: 'rates_bill', currency: 'ZWG', status: 'posted', posting_date: '2026-01-05', narration: 'Fuel run', reference: 'R1', financial_year_id: 'fy1' },
      lines: [
        { ledger_account_id: 'a-fuel', debit: '25.00', credit: '0.00', party_id: null, department_id: null, project_id: null, narration: 'Diesel' },
        { ledger_account_id: 'a-bank', debit: '0.00', credit: '25.00', party_id: null, department_id: null, project_id: null, narration: null },
      ],
      source: null,
    })
    const { w } = await mountEditor('/journals/new?from=v1')
    expect(api.voucher).toHaveBeenCalledWith('v1')
    expect((debit(w, 1).element as HTMLInputElement).value).toBe('25.00')
    expect((credit(w, 2).element as HTMLInputElement).value).toBe('25.00')
    expect((lineRow(w, 1).find('input[data-field="narration"]').element as HTMLInputElement).value).toBe('Diesel')
    expect((w.find('input#je-number').element as HTMLInputElement).value).toBe('')
    const today = new Date()
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
    expect((w.find('input#je-date').element as HTMLInputElement).value).toBe(iso)
    expect((w.find('select#je-type').element as HTMLSelectElement).value).toBe('journal')
  })

  it('disables Save while saving', async () => {
    let release!: (v: unknown) => void
    api.createVoucher.mockReturnValue(new Promise(r => { release = r }))
    const { w } = await mountEditor()
    await pickAccount(w, 1, '1200'); await debit(w, 1).setValue('10.00')
    await pickAccount(w, 2, '5310'); await credit(w, 2).setValue('10.00')
    const b = save(w)
    await b.trigger('click'); await b.trigger('click')
    expect(api.createVoucher).toHaveBeenCalledTimes(1)
    // Busy is aria-disabled, not disabled, so the focused button keeps focus; save() ignores the second click.
    expect(b.attributes('aria-disabled')).toBe('true')
    expect(b.attributes('disabled')).toBeUndefined()
    release(SAVED); await flushPromises()
  })

  it('names the period of the posting date and its status', async () => {
    const { w } = await mountEditor()
    const date = w.find('input#je-date')
    await date.setValue('2026-09-14')
    expect(w.find('[data-testid="period"]').text()).toBe('Period 3 · Sep 2026 · open')
    await date.setValue('2026-10-02')
    expect(w.find('[data-testid="period"]').text()).toContain('closed: a draft may be saved but cannot be posted until it is reopened')
    await date.setValue('2026-11-02')
    expect(w.find('[data-testid="period"]').text()).toBe('Period 5 · Nov 2026 · locked: nothing can be posted into it')
    await date.setValue('2030-01-01')
    expect(w.find('[data-testid="period"]').text()).toBe('No period covers this date')
  })

  it('edits a draft through updateVoucher, with the number and book fixed', async () => {
    api.voucher.mockResolvedValue({
      voucher: { id: 'v2', voucher_no: 'JV-0000002', voucher_type: 'journal', currency: 'USD', status: 'draft', prepared_by: 'u-acc', posting_date: '2026-09-10', narration: null, reference: null, financial_year_id: 'fy1' },
      lines: [
        { ledger_account_id: 'a-fuel', debit: '5.00', credit: '0.00', party_id: null, department_id: 'd1', project_id: 'pr1', narration: 'Diesel',
          programme_id: 'prog1', activity_id: 'act1', ward_code: 'W3', budget_line_id: 'bl1', against_voucher_id: 'v-bill' },
        { ledger_account_id: 'a-bank', debit: '0.00', credit: '5.00', party_id: null, department_id: null, project_id: null, narration: null,
          programme_id: null, activity_id: null, ward_code: null, budget_line_id: null, against_voucher_id: null },
      ],
      source: null,
    })
    api.updateVoucher.mockResolvedValue({ updated: 'v2', version: 2, balance: { debit_total: '5.00', credit_total: '5.00', difference: '0.00' }, balances: true })
    const { w, router } = await mountEditor('/journals/v2/edit')
    expect((w.find('input#je-number').element as HTMLInputElement).value).toBe('JV-0000002')
    expect(w.find('select#je-type').attributes('disabled')).toBeDefined()
    await save(w).trigger('click'); await flushPromises()
    expect(api.updateVoucher).toHaveBeenCalledWith('v2', expect.objectContaining({ posting_date: '2026-09-10' }))
    expect(api.createVoucher).not.toHaveBeenCalled()
    expect(router.currentRoute.value.params.id).toBe('v2')
    expect(api.updateVoucher.mock.calls[0][1]).toEqual({
      posting_date: '2026-09-10', narration: null, reference: null,
      lines: [
        { ledger_account_id: 'a-fuel', debit: '5.00', department_id: 'd1', project_id: 'pr1', narration: 'Diesel',
          programme_id: 'prog1', activity_id: 'act1', ward_code: 'W3', budget_line_id: 'bl1', against_voucher_id: 'v-bill' },
        { ledger_account_id: 'a-bank', credit: '5.00' },
      ],
    })
  })

  it('does not copy against_voucher_id but keeps the other analysis fields', async () => {
    api.voucher.mockResolvedValue({
      voucher: { id: 'v1', voucher_no: 'R-1', voucher_type: 'receipt', currency: 'USD', status: 'posted', posting_date: '2026-01-05', narration: null, reference: null, financial_year_id: 'fy1' },
      lines: [
        { ledger_account_id: 'a-bank', debit: '5.00', credit: '0.00', party_id: null, department_id: null, project_id: null, narration: null,
          programme_id: 'prog1', activity_id: 'act1', ward_code: 'W3', budget_line_id: 'bl1', against_voucher_id: 'v-bill' },
        { ledger_account_id: 'a-fuel', debit: '0.00', credit: '5.00', party_id: null, department_id: null, project_id: null, narration: null,
          programme_id: null, activity_id: null, ward_code: null, budget_line_id: null, against_voucher_id: null },
      ],
      source: null,
    })
    const { w } = await mountEditor('/journals/new?from=v1')
    await save(w).trigger('click'); await flushPromises()
    const first = api.createVoucher.mock.calls[0][0].lines[0]
    expect('against_voucher_id' in first).toBe(false)
    expect(first).toMatchObject({ programme_id: 'prog1', activity_id: 'act1', ward_code: 'W3', budget_line_id: 'bl1' })
  })

  it('refuses to edit a draft raised from another document', async () => {
    api.voucher.mockResolvedValue({
      voucher: { id: 'v4', voucher_no: 'JV-4', voucher_type: 'journal', currency: 'USD', status: 'draft', posting_date: '2026-09-10', financial_year_id: 'fy1' },
      lines: [], source: { kind: 'bill', id: 'b1' },
    })
    const { w } = await mountEditor('/journals/v4/edit')
    expect(w.find('[role="alert"]').text()).toBe('This draft was raised from another document and is changed there. Back to the voucher')
    expect(w.find('[data-line]').exists()).toBe(false)
    expect(w.text()).toContain('Back to the voucher')
  })

  it('announces the balance result once typing pauses, not on every keystroke, and on a save attempt', async () => {
    vi.useFakeTimers()
    try {
      const { w } = await mountEditor()
      const live = () => w.find('[data-testid="guide-live"]')
      expect(live().attributes('aria-live')).toBe('polite')
      await debit(w, 1).setValue('1'); await debit(w, 1).setValue('10'); await debit(w, 1).setValue('10.0')
      expect(live().text()).toBe('')
      await vi.advanceTimersByTimeAsync(1000)
      expect(live().text()).toBe('Debits 10.00 · Credits 0.00 · Out of balance by 10.00')
      await save(w).trigger('click'); await flushPromises()
      expect(live().text()).toContain('Out of balance by 10.00')
    } finally { vi.useRealTimers() }
  })

  it('refuses a line with an amount of nil', async () => {
    const { w } = await mountEditor()
    await pickAccount(w, 1, '1200'); await debit(w, 1).setValue('0.00')
    await pickAccount(w, 2, '5310'); await credit(w, 2).setValue('10.00')
    await save(w).trigger('click'); await flushPromises()
    expect(w.text()).toContain('Line 1 has an amount of nil.')
    expect(api.createVoucher).not.toHaveBeenCalled()
  })

  it('refuses to edit a posted voucher, with a way back', async () => {
    api.voucher.mockResolvedValue({
      voucher: { id: 'v3', voucher_no: 'JV-3', voucher_type: 'journal', currency: 'USD', status: 'posted', posting_date: '2026-09-10', financial_year_id: 'fy1' },
      lines: [], source: null,
    })
    const { w } = await mountEditor('/journals/v3/edit')
    expect(w.find('[role="alert"]').text()).toContain('Only a draft can be edited')
    expect(w.find('[data-line]').exists()).toBe(false)
    expect(w.text()).toContain('Back to the voucher')
  })

  it('shows the not-set-up state and makes no call without a year', async () => {
    const { w } = await mountEditor('/journals/new', null)
    expect(w.text()).toContain('Choose a financial year in the banner above.')
    expect(w.find('[data-line]').exists()).toBe(false)
    expect(api.accounts).not.toHaveBeenCalled()
    expect(api.periods).not.toHaveBeenCalled()
  })
})
