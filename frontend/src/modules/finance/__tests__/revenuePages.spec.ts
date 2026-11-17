// @vitest-environment happy-dom
//
// The Revenue and Rates pages of their own:
//
//   1. THE COLLECTION LIST sends its filters to the server and shows one age analysis per currency;
//      a book that no longer agrees with the receivable control account is said to disagree.
//   2. THE BILLS REGISTER shows the server's totals per currency and status, never a sum of a page.
//   3. A STATEMENT shows the balance per currency, never one figure across USD and ZWG.
//   4. AN EXPORT is the server's strings, quoted where needed, and says when it was cut short.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('../api/ratesApi', () => ({
  ratesApi: { arrears: vi.fn(), bills: vi.fn(), statement: vi.fn(), accounts: vi.fn() },
}))

import { ratesApi } from '../api/ratesApi'
import CollectionList from '../workspaces/revenue/pages/CollectionList.vue'
import BillsRegister from '../workspaces/revenue/pages/BillsRegister.vue'
import AccountStatement from '../workspaces/revenue/pages/AccountStatement.vue'
import { readAll, toCsv } from '../workspaces/revenue/kit'
import type { RatesArrears, RatesStatement } from '../models/ratesTypes'

const api = ratesApi as unknown as Record<string, ReturnType<typeof vi.fn>>

function router(path = '/r') {
  const Empty = { template: '<div />' }
  const r = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/r', name: 'r', component: Empty },
      { path: '/statements/:id?', name: 'rev-statement', component: Empty },
    ],
  })
  void r.push(path)
  return r
}

const ARREARS: RatesArrears = {
  books: [
    { currency: 'USD', buckets: [
      { bucket: 'current', label: 'Not yet 30 days', documents: 2, outstanding: '120.00' },
      { bucket: 'over_365', label: 'Over a year', documents: 1, outstanding: '80.00' },
      { bucket: 'settled', label: 'Settled in full', documents: 4, outstanding: '0.00' },
    ] },
    { currency: 'ZWG', buckets: [{ bucket: 'current', label: 'Not yet 30 days', documents: 1, outstanding: '900.00' }] },
  ],
  accounts: [{
    rates_account_id: 'a1', account_no: 'R-0001', parcel_id: 'P1', stand_no: '12', ward_code: '7', party_id: 'p1',
    party_name: 'T. Moyo', currency: 'USD', balance: '200.00', owed: '200.00', unallocated_credit: '0.00', oldest_days: 400, open_bills: 3,
  }],
  total: 1, limit: 50, offset: 0,
  reconciliation: [
    { currency: 'USD', control_balance: '200.00', ledger_ageing: '200.00', rates_arrears: '200.00', ledger_difference: '0.00', other_debtors: '0.00', reconciles: true },
    { currency: 'ZWG', control_balance: '850.00', ledger_ageing: '900.00', rates_arrears: '900.00', ledger_difference: '50.00', other_debtors: '0.00', reconciles: false },
  ],
  as_at: '2026-11-17', note: 'From the ledger.',
}

describe('the collection list', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('shows one age analysis per currency and names the book that does not reconcile', async () => {
    api.arrears.mockResolvedValue(ARREARS)
    const w = mount(CollectionList, { global: { plugins: [router()] } })
    await flushPromises()
    const captions = w.findAll('caption').map((c) => c.text())
    expect(captions).toEqual(['USD', 'ZWG'])
    expect(w.text()).not.toContain('Settled in full')
    expect(w.text()).toMatch(/ZWG debtor ageing differs from the receivable control account/)
    expect(w.text()).toContain('R-0001')
    expect(w.text()).toContain('400 days')
  })

  it('sends the age and currency filters to the server', async () => {
    api.arrears.mockResolvedValue(ARREARS)
    const w = mount(CollectionList, { global: { plugins: [router()] } })
    await flushPromises()
    const selects = w.findAll('select')
    await selects[0].setValue('over_365')
    await selects[1].setValue('USD')
    await flushPromises()
    expect(api.arrears).toHaveBeenLastCalledWith(expect.objectContaining({ bucket: 'over_365', currency: 'USD', offset: 0 }))
  })
})

describe('the bills register', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('shows the server\'s totals per currency and status', async () => {
    api.bills.mockResolvedValue({
      bills: [], total: 0, limit: 50, offset: 0,
      totals: [{ currency: 'USD', voucher_status: 'posted', amount: '5000.00', bills: 40 }, { currency: 'ZWG', voucher_status: 'draft', amount: '70.00', bills: 1 }],
    })
    const w = mount(BillsRegister, { global: { plugins: [router()] } })
    await flushPromises()
    const totals = w.find('table[aria-label="Totals over every matching bill"]')
    expect(totals.exists()).toBe(true)
    expect(totals.findAll('tbody tr')).toHaveLength(2)
    expect(totals.text()).toContain('Issued')
    expect(totals.text()).toContain('40')
  })
})

describe('a ratepayer statement', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  it('shows a balance per currency and a bill\'s age', async () => {
    const statement: RatesStatement = {
      account: {
        id: 'a1', account_no: 'R-0001', parcel_id: 'P1', stand_no: '12', ward_code: '7', party_id: 'p1', party_name: 'T. Moyo',
        party_reference: null, party_status: 'active', erp_account_no: null, opened_on: '2026-07-01', closed_on: null, status: 'active',
        notes: null, township_code: null, contact_phone: null, contact_email: null, address_text: null,
      },
      bills: [{
        id: 'b1', bill_no: 'RB-1', period_from: '2026-07-01', period_to: '2026-07-31', issued_on: '2026-07-05', due_on: '2026-08-05',
        currency: 'USD', amount: '100.00', voucher_status: 'posted', rateable_value: '10000.00', rate_in_dollar: '0.01',
        open_amount: '100.00', outstanding_amount: '100.00', ageing_bucket: '91_180', days_outstanding: 104,
      }],
      receipts: [],
      balances: [
        { currency: 'USD', balance: '100.00', owed: '100.00', unallocated_credit: '0.00' },
        { currency: 'ZWG', balance: '-20.00', owed: '0.00', unallocated_credit: '20.00' },
      ],
      note: 'Posted figures only.',
    }
    api.statement.mockResolvedValue(statement)
    const r = router('/statements/a1')
    await r.isReady()
    const w = mount(AccountStatement, { global: { plugins: [r] } })
    await flushPromises()
    expect(api.statement).toHaveBeenCalledWith('a1')
    expect(w.text()).toContain('Balance USD')
    expect(w.text()).toContain('Balance ZWG')
    expect(w.text()).toContain('91 to 180 days')
    expect(w.text()).toContain('not yet matched to a bill')
  })
})

describe('the revenue exports', () => {
  it('quotes a cell that holds a comma or a quote and keeps money as text', () => {
    expect(toCsv(['A', 'B'], [['Moyo, T.', '1234.50'], ['say "hi"', null]])).toBe('A,B\r\n"Moyo, T.",1234.50\r\n"say ""hi""",')
  })

  it('reads every page and says when the cap cut the list short', async () => {
    const page = vi.fn(async (limit: number, offset: number) => ({ rows: Array.from({ length: limit }, (_, i) => offset + i), total: 500 }))
    const all = await readAll(page, 300)
    expect(all.rows).toHaveLength(300)
    expect(all.truncated).toBe(true)
    expect(page).toHaveBeenCalledTimes(2)
  })
})
