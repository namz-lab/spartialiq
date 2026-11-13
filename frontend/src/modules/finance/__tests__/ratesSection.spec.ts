// @vitest-environment happy-dom
//
// The rates section. Five of its rules are controls rather than conveniences:
//
//   1. WHAT BILLING IS WAITING ON IS ALWAYS STATED. With no ratepayer, no rateable value and no
//      approved rate, the screen names D19, D17 and D18 rather than showing an empty bills table.
//   2. WHOEVER RAISED A RUN IS NOT OFFERED "COMMIT", and is told why. Somebody else is.
//   3. WHOEVER DRAFTED A TARIFF IS NOT OFFERED "APPROVE"; a role without the permission never is.
//   4. A RATE IN THE DOLLAR IS NEVER ROUNDED TO MONEY: 0.00850000 reads 0.0085, not 0.01.
//   5. THE ARREARS ARE ONE BOOK PER CURRENCY, with the reconciliation shown and no combined figure.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../api/ratesApi', () => ({
  ratesApi: {
    readiness: vi.fn(), categories: vi.fn(), runs: vi.fn(), tariffs: vi.fn(), arrears: vi.fn(),
    receipts: vi.fn(), accounts: vi.fn(), properties: vi.fn(), billingPreview: vi.fn(),
    commitRun: vi.fn(), approveTariff: vi.fn(),
  },
}))
vi.mock('../api/ledgerApi', () => ({
  ledgerApi: { accounts: vi.fn(), parties: vi.fn() },
}))

import { ratesApi } from '../api/ratesApi'
import { ledgerApi } from '../api/ledgerApi'
import RatesSection from '../pages/sections/RatesSection.vue'
import { useFinanceStore } from '../stores/finance'
import type { FinanceIdentity, FinancialYear } from '../models/types'
import type { BillingRun, RatesArrears, RatesReadiness, RatesTariff } from '../models/ratesTypes'

const api = ratesApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const ledger = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>

const YEAR: FinancialYear = {
  id: 'y1', label: 'DD 2026/27', start_date: '2026-07-01', end_date: '2027-06-30',
  status: 'open', reporting_currency: 'USD', notes: null, opened_at: null, closed_at: null,
}

const identity = (permissions: string[], userId = 'u-director'): FinanceIdentity => ({
  user_id: userId, role: 'finance_admin', authority_id: 1, permissions, department_scope: [],
  catalogue: [{
    code: 'finance.rates.tariff.approve', label: 'Approve a rates tariff', category: 'rates',
    is_approval: true, is_publication: false, is_restricted: false, description: null,
  }],
})

const BLOCKED: RatesReadiness = {
  properties: { properties: 731, with_ratepayer: 0, with_rateable_value: 0, with_both: 0 },
  categories: { active: 0 },
  tariffs: [],
  ledger: { receivable: 1, bank: 1, revenue: 2, periods: { open: 12, total: 12 }, ready: true, note: null },
  blockers: [
    { decision: 'D19', statement: 'The ratepayer of record for each property.', outstanding: 731, met: false,
      detail: '0 of 731 properties have a rates account naming a ratepayer.' },
    { decision: 'D17', statement: 'The valuation roll.', outstanding: 731, met: false,
      detail: '0 of 731 properties have a rateable value in force today.' },
    { decision: 'D18', statement: 'The tariff schedule.', outstanding: null, met: false,
      detail: 'No tariff has been approved for this financial year.' },
  ],
  can_bill_anything: false,
  note: 'No property can be billed yet.',
}

const run = (over: Partial<BillingRun> = {}): BillingRun => ({
  id: 'r1', run_reference: 'RB-2026-Q1', financial_year_id: 'y1', financial_year_label: YEAR.label,
  period_from: '2026-07-01', period_to: '2026-09-30', posting_date: '2026-07-05', currency: 'USD',
  status: 'raised', receivable_ledger_account_id: 'a1', receivable_account_code: '1200',
  revenue_ledger_account_id: 'a2', revenue_account_code: '4100', properties_considered: 731,
  bills_raised: 3, properties_refused: 728, total_billed: '6411.00', prepared_by: 'u-officer',
  prepared_by_name: 'Finance Officer', prepared_at: '2026-07-05T08:00:00Z', committed_by: null,
  committed_by_name: null, committed_at: null, cancelled_by: null, cancelled_at: null,
  cancel_reason: null, notes: null, ...over,
})

const tariff = (over: Partial<RatesTariff> = {}): RatesTariff => ({
  id: 't1', financial_year_id: 'y1', financial_year_label: YEAR.label, property_category_id: 'c1',
  category_code: 'RES', category_name: 'Residential', currency: 'USD', rate_in_dollar: '0.00850000',
  fixed_charge: '12.00', minimum_charge: null, revenue_ledger_account_id: null,
  revenue_account_code: null, revenue_account_name: null, status: 'draft', resolution_reference: null,
  resolution_date: null, approved_by: null, approved_by_name: null, approved_at: null,
  created_by: 'u-director', created_by_name: 'Director of Finance', created_at: '2026-07-01T08:00:00Z',
  notes: null, ...over,
})

const ARREARS: RatesArrears = {
  books: [
    { currency: 'USD', buckets: [
      { bucket: 'current', label: 'Not yet 30 days', documents: 0, outstanding: '0.00' },
      { bucket: '31_60', label: '31 to 60 days', documents: 1, outstanding: '1137.00' },
      { bucket: 'unallocated', label: 'Received and not yet matched to a bill', documents: 1, outstanding: '-200.00' },
    ] },
    { currency: 'ZWG', buckets: [
      { bucket: 'current', label: 'Not yet 30 days', documents: 2, outstanding: '48000.00' },
    ] },
  ],
  accounts: [{
    rates_account_id: 'ra1', account_no: 'RA-0001', parcel_id: 'P1', stand_no: '101', ward_code: '2',
    party_id: 'p1', party_name: 'T. Moyo', currency: 'USD', balance: '937.00', owed: '1137.00',
    unallocated_credit: '200.00', oldest_days: 40, open_bills: 1,
  }],
  total: 1, limit: 100, offset: 0,
  reconciliation: [
    { currency: 'USD', control_balance: '937.00', ledger_ageing: '937.00', rates_arrears: '937.00',
      ledger_difference: '0.00', other_debtors: '0.00', reconciles: true },
    { currency: 'ZWG', control_balance: '48000.00', ledger_ageing: '47000.00', rates_arrears: '47000.00',
      ledger_difference: '-1000.00', other_debtors: '0.00', reconciles: false },
  ],
  as_at: '2026-08-15', note: 'Ages run from each bill\'s own posting date.',
}

const ALL = ['finance.rates.view', 'finance.rates.valuation.manage', 'finance.rates.tariff.manage',
  'finance.rates.account.manage', 'finance.rates.bill.prepare', 'finance.rates.bill.post',
  'finance.rates.receipt.record', 'finance.ledger.view', 'finance.ledger.voucher.post']

async function mountAs(permissions: string[], userId = 'u-director') {
  const store = useFinanceStore()
  store.identity = identity(permissions, userId)
  store.years = [YEAR]
  store.selectedYearId = YEAR.id
  const wrapper = mount(RatesSection, { global: { stubs: { FinancePromptDialog: true } } })
  await flushPromises()
  return wrapper
}

const openTab = async (wrapper: Awaited<ReturnType<typeof mountAs>>, key: string) => {
  await wrapper.get(`#rates-tab-${key}`).trigger('click')
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  api.readiness.mockResolvedValue(BLOCKED)
  api.categories.mockResolvedValue({ categories: [], note: null })
  api.runs.mockResolvedValue({ runs: [], total: 0, limit: 50, offset: 0 })
  api.tariffs.mockResolvedValue({ tariffs: [], note: 'No tariff is recorded.' })
  api.arrears.mockResolvedValue(ARREARS)
  ledger.accounts.mockResolvedValue({ accounts: [], total: 0, shape: 'flat', note: '' })
  ledger.parties.mockResolvedValue({ parties: [], total: 0, limit: 200, offset: 0, note: null })
})

describe('the rates section', () => {
  it('states what billing is waiting on, by decision, before anything else', async () => {
    const wrapper = await mountAs(ALL)
    const blockers = wrapper.findAll('.rates-blocker')
    expect(blockers.map((b) => b.find('.rates-blocker-id').text())).toEqual(['D19', 'D17', 'D18'])
    expect(blockers[0].text()).toContain('0 of 731 properties have a rates account')
    expect(blockers[0].text()).toContain('731 outstanding')
    expect(wrapper.text()).toContain('No property can be billed yet.')
    // And the empty register is a sentence, not a blank panel.
    expect(wrapper.text()).toContain('No billing run has been raised for this year.')
  })

  it('a failed read of the registers is an alert, not an empty readiness panel', async () => {
    api.readiness.mockRejectedValue(new Error('network'))
    const wrapper = await mountAs(ALL)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(wrapper.findAll('.rates-blocker')).toHaveLength(0)
  })

  it('offers Commit to somebody else, and explains its absence to whoever raised the run', async () => {
    api.runs.mockResolvedValue({ runs: [run()], total: 1, limit: 50, offset: 0 })

    const other = await mountAs(ALL, 'u-director')
    expect(other.findAll('button').some((b) => b.text() === 'Commit')).toBe(true)
    expect(other.text()).not.toContain('You raised this run')

    setActivePinia(createPinia())
    const preparer = await mountAs(ALL, 'u-officer')
    expect(preparer.findAll('button').some((b) => b.text() === 'Commit')).toBe(false)
    expect(preparer.text()).toContain('You raised this run, so committing it is not yours to do.')
  })

  it('does not offer Commit to a role that cannot post, or on a run that raised no bills', async () => {
    api.runs.mockResolvedValue({ runs: [run()], total: 1, limit: 50, offset: 0 })
    const officer = await mountAs(ALL.filter((p) => p !== 'finance.rates.bill.post'))
    expect(officer.findAll('button').some((b) => b.text() === 'Commit')).toBe(false)

    setActivePinia(createPinia())
    api.runs.mockResolvedValue({ runs: [run({ bills_raised: 0, total_billed: '0.00' })], total: 1, limit: 50, offset: 0 })
    const empty = await mountAs(ALL)
    expect(empty.findAll('button').some((b) => b.text() === 'Commit')).toBe(false)
  })

  it('shows a rate in the dollar unrounded, and "none set" where the Council set no charge', async () => {
    api.tariffs.mockResolvedValue({ tariffs: [tariff()], note: null })
    const wrapper = await mountAs(ALL)
    await openTab(wrapper, 'tariffs')
    const row = wrapper.find('#rates-panel-tariffs tbody tr')
    expect(row.text()).toContain('0.0085')
    expect(row.text()).not.toContain('0.01')
    expect(row.text()).toContain('12.00')
    // minimum_charge is null: not recorded, which is not nil.
    expect(row.text()).toContain('none set')
  })

  it('does not offer Approve to whoever drafted the tariff, nor to a role without the approval', async () => {
    api.tariffs.mockResolvedValue({ tariffs: [tariff()], note: null })
    const approve = (w: Awaited<ReturnType<typeof mountAs>>) =>
      w.findAll('button').some((b) => b.text() === 'Approve')

    const committee = await mountAs(['finance.rates.view', 'finance.rates.tariff.approve'], 'u-committee')
    await openTab(committee, 'tariffs')
    expect(approve(committee)).toBe(true)

    setActivePinia(createPinia())
    const drafter = await mountAs([...ALL, 'finance.rates.tariff.approve'], 'u-director')
    await openTab(drafter, 'tariffs')
    expect(approve(drafter)).toBe(false)
    expect(drafter.text()).toContain('You drafted this tariff, so approving it is not yours to do.')

    setActivePinia(createPinia())
    const director = await mountAs(ALL, 'u-someone-else')
    await openTab(director, 'tariffs')
    expect(approve(director)).toBe(false)
    expect(director.text()).toContain('Approval is reserved to the roles holding "Approve a rates tariff"')
  })

  it('reports arrears one book per currency, with the reconciliation and no combined figure', async () => {
    const wrapper = await mountAs(['finance.rates.view'])
    await openTab(wrapper, 'arrears')
    const panel = wrapper.get('#rates-panel-arrears')
    const books = panel.findAll('.rates-book')
    expect(books).toHaveLength(2)
    expect(books[0].text()).toContain('USD book')
    expect(books[1].text()).toContain('ZWG book')
    // An unallocated credit is shown, negative, and not netted off a bill.
    expect(books[0].text()).toContain('−200.00')
    // 937.00 + 48 000.00 would be an invented figure; it appears nowhere.
    expect(panel.text()).not.toContain('48 937')
    expect(panel.text()).not.toContain('48937')
    // The book that has stopped agreeing with its control account says so.
    const verdicts = panel.findAll('tbody tr').filter((r) => /Agrees|Does not agree/.test(r.text()))
    expect(verdicts.map((r) => (r.text().includes('Does not agree') ? 'off' : 'ok'))).toEqual(['ok', 'off'])
    expect(panel.find('.rates-off').text()).toContain('1 000.00')
  })

  it('a reader sees no control that writes', async () => {
    api.runs.mockResolvedValue({ runs: [run()], total: 1, limit: 50, offset: 0 })
    api.tariffs.mockResolvedValue({ tariffs: [tariff()], note: null })
    const wrapper = await mountAs(['finance.rates.view'], 'u-auditor')
    const writes = /^(Commit|Cancel|Approve|Discard|Supersede|Raise the run as drafts|Draft a tariff|Record a payment|Open an account|Add category)$/
    for (const key of ['billing', 'tariffs', 'receipts', 'accounts', 'roll']) {
      api.receipts.mockResolvedValue({ receipts: [], totals: [], total: 0, limit: 50, offset: 0 })
      api.accounts.mockResolvedValue({ accounts: [], total: 0, limit: 100, offset: 0, note: null })
      api.properties.mockResolvedValue({ properties: [], total: 0, limit: 50, offset: 0 })
      await openTab(wrapper, key)
      expect(wrapper.findAll('button').filter((b) => writes.test(b.text())).map((b) => b.text())).toEqual([])
    }
  })
})
