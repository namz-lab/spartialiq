// @vitest-environment happy-dom
//
// The staff transaction register (audit GAP-1).
//
// Four of its rules are controls rather than conveniences, and nothing but a test keeps them true
// as the screen is edited:
//
//   1. NO COMBINED CURRENCY FIGURE, EVER (Council decision D4). The endpoint returns one total per
//      currency AND per account kind; the screen renders them separately and offers no way to add
//      them. A single figure spanning USD and ZWG would be invented, because the Council has
//      approved no conversion basis. The test below adds up what the screen rendered and asserts
//      the combined figure appears nowhere on it.
//
//   2. A TOTAL IS NEVER SHOWN WITHOUT THE REVERSAL MODE THAT BUILT IT. A correction in this system
//      is a reversal plus a replacement, both of which stay in the register, so the same filter
//      produces a different row count under each of `exclude`, `only` and `all`. The mode is
//      stated in words beside the figures, and it is the mode the RESPONSE echoed rather than the
//      one sitting in the dropdown.
//
//   3. A WITHHELD SUPPLIER IS EXPLAINED, NOT BLANKED. `counterparty_visible: false` means the
//      columns are ABSENT from the response (decision A2, src/routes/finance-projects.js:172), so
//      the screen must drop the column and say which permission carries it. A blank cell would be
//      read as "no supplier was recorded", which is a different and false statement.
//
//   4. TOTALS DESCRIBE THE FILTERED SET, NOT THE PAGE. 113 transactions can be totalled under a
//      table showing 2 of them, and the caption has to say so or the figure looks like the sum of
//      what is visible.
//
// And one rule that is not about money: a failed read is an alert, an empty result is a sentence,
// and neither is a blank panel.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../api/financeApi', () => ({
  financeApi: {
    transactions: vi.fn(),
    transaction: vi.fn(),
    // The ward filter is a WardPicker, which reads the council's ward register on mount.
    mapWardGeometry: vi.fn(),
    mapWards: vi.fn(),
  },
}))

import { financeApi } from '../api/financeApi'
import TransactionsSection from '../pages/sections/TransactionsSection.vue'
import { useFinanceStore } from '../stores/finance'
import type {
  FinanceIdentity, FinancePermission, FinanceTransaction, FinancialYear, TransactionDetail,
  TransactionRegisterPage,
} from '../models/types'

const api = financeApi as unknown as Record<string, ReturnType<typeof vi.fn>>

const CATALOGUE: FinancePermission[] = [
  {
    code: 'finance.transaction.view', label: 'View the transaction register', category: 'actuals',
    is_approval: false, is_publication: false, is_restricted: false, description: null,
  },
  {
    code: 'finance.transaction.view_counterparty', label: 'View counterparty identity',
    category: 'actuals', is_approval: false, is_publication: false, is_restricted: true,
    description: 'Supplier and beneficiary names and references. Restricted; never public.',
  },
]

// A July–June year, deliberately: the council's financial year is not the calendar year.
const YEAR: FinancialYear = {
  id: 'y1', label: 'DD 2026/27', start_date: '2026-07-01', end_date: '2027-06-30',
  status: 'open', reporting_currency: 'USD', notes: null, opened_at: null, closed_at: null,
}

const identity = (permissions: string[], role = 'finance_admin'): FinanceIdentity => ({
  user_id: 'u1', role, authority_id: 1, permissions, department_scope: [], catalogue: CATALOGUE,
})

/** A row as the endpoint sends it WITHOUT the counterparty gate: the two fields are simply absent. */
const WITHOUT_COUNTERPARTY: FinanceTransaction = {
  id: 't1', txn_date: '2026-08-14', amount: '38000.00', currency: 'USD',
  description: 'Culvert materials — Ward 2', reference: 'DD-VCH-DD-L02-03',
  record_type: 'payment', account_code: '2100', account_name: 'Roads and drainage',
  account_kind: 'expenditure', department_code: 'DD-ENG', department_name: 'Engineering Services',
  source_system: 'DDDEMO', source_ref: 'DDDEMO-0003', import_batch_id: 'b1',
}

/** The same row for a caller who holds the restricted permission. */
const WITH_COUNTERPARTY: FinanceTransaction = {
  ...WITHOUT_COUNTERPARTY,
  counterparty_ref: 'SUP-0041', counterparty_name: 'Midlands Plant Hire',
}

const ZWG_ROW: FinanceTransaction = {
  id: 't2', txn_date: '2026-09-02', amount: '1900000.00', currency: 'ZWG',
  description: null, reference: null, record_type: null,
  account_code: '1100', account_name: 'Rates', account_kind: 'revenue',
  department_code: 'DD-FIN', department_name: 'Finance', source_system: 'DDDEMO',
  source_ref: 'DDDEMO-0044', import_batch_id: 'b1',
}

const registerPage = (over: Partial<TransactionRegisterPage> = {}): TransactionRegisterPage => ({
  transactions: [WITHOUT_COUNTERPARTY, ZWG_ROW],
  total: 113,
  limit: 50,
  offset: 0,
  // Four totals: two currencies × two sides. There is no fifth row adding any of them together.
  totals: [
    { currency: 'USD', account_kind: 'expenditure', rows: 73, amount: '2038000.00' },
    { currency: 'USD', account_kind: 'revenue', rows: 16, amount: '1466000.00' },
    { currency: 'ZWG', account_kind: 'expenditure', rows: 12, amount: '22800000.00' },
    { currency: 'ZWG', account_kind: 'revenue', rows: 12, amount: '13200000.00' },
  ],
  counterparty_visible: false,
  scope_applied: null,
  reversals: 'exclude',
  ...over,
})

const detailFor = (over: Partial<TransactionDetail> = {}): TransactionDetail => ({
  transaction: WITHOUT_COUNTERPARTY,
  budget_line: {
    id: 'bl2', code: 'DD-L02', description: 'Culvert construction — Ward 2',
    revised_amount: '480000.00', actual_amount: '304000.00', currency: 'USD',
  },
  project: { project_id: 'p1', reference: 'DD-PRJ-02', name: 'Ward 2 culverts' },
  documents: [{
    id: 'd1', subject_kind: 'transaction', subject_id: 't1', filename: 'DD-VCH-DD-L02-03.pdf',
    mime_type: 'application/pdf', size_bytes: '20480', document_type: 'voucher',
    visibility: 'private', uploaded_at: '2026-08-15T09:00:00Z', uploaded_by_name: 'Rudo Moyo',
  }],
  import_batch: {
    id: 'b1', dataset: 'actuals', original_filename: 'actuals-2026-08.csv',
    file_hash: '9f2c1bd4e7a6035c8d41fe0b7a2c9d5e6f108342ab7c9e01d5f3426b8c7a0192',
    committed_at: '2026-08-20T11:30:00Z', reconciliation_status: 'matched',
  },
  reversal: {
    reverses: null,
    reversed_by: {
      id: 't9', txn_date: '2026-08-28', amount: '-38000.00', reference: 'DD-VCH-DD-L02-03-R',
    },
  },
  counterparty_visible: false,
  ...over,
})

async function section(
  permissions: string[] = ['finance.transaction.view'],
  response: Partial<TransactionRegisterPage> = {},
) {
  api.transactions.mockResolvedValue(registerPage(response))
  api.transaction.mockResolvedValue(detailFor())
  api.mapWardGeometry.mockResolvedValue({
    ward_register_linked: true,
    features: [{ properties: { ward_code: 'ZW170402', name: 'Vungu Ward 2' } }],
  })
  api.mapWards.mockResolvedValue({ ward_register_bases: ['interim'] })

  const store = useFinanceStore()
  store.identity = identity(permissions)
  store.years = [YEAR]
  store.selectYear('y1')

  const wrapper = mount(TransactionsSection)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

// ── Rule 1: currency is never combined ─────────────────────────────────────────────────────────
describe('the totals never combine currencies', () => {
  it('shows one figure per currency and per side, each labelled with its own currency', async () => {
    const wrapper = await section()
    const tiles = wrapper.findAll('.txn-total')
    expect(tiles).toHaveLength(4)
    const labels = tiles.map((t) => t.find('dt').text())
    expect(labels).toEqual([
      'USD · Expenditure', 'USD · Revenue', 'ZWG · Expenditure', 'ZWG · Revenue',
    ])
    // Every figure carries its currency, so no tile can be read as "the total".
    for (const tile of tiles) {
      expect(tile.text()).toMatch(/US\$|ZWG/)
    }
  })

  it('renders no figure that is the sum of two currencies, or of the two sides', async () => {
    const wrapper = await section()
    const shown = wrapper.text().replace(/[\s  ]/g, '')

    // Everything a careless implementation might have produced from these four totals.
    const forbidden = [
      '27504000', // all four added together
      '3504000', // the two USD totals added
      '36000000', // the two ZWG totals added
      '24838000', // the two expenditure totals, across currencies
      '14666000', // the two revenue totals, across currencies
    ]
    for (const figure of forbidden) {
      expect(shown).not.toContain(figure)
    }

    // And the four honest figures ARE there, so the test is not passing by rendering nothing.
    for (const figure of ['2038000.00', '1466000.00', '22800000.00', '13200000.00']) {
      expect(shown).toContain(figure)
    }
  })

  it('offers no control that would produce a combined figure', async () => {
    const wrapper = await section()
    expect(wrapper.text()).not.toMatch(/grand total|combined total|total \(all currencies\)/i)
    // The screen says why, rather than leaving the absence to be noticed.
    expect(wrapper.text()).toMatch(/no conversion basis/i)
  })
})

// ── Rule 2: the reversal mode is always stated ─────────────────────────────────────────────────
describe('the reversal mode is stated beside the totals', () => {
  it('names the mode in words, not only in the filter control', async () => {
    const wrapper = await section()
    const mode = wrapper.find('[data-test="reversal-mode"]')
    expect(mode.exists()).toBe(true)
    expect(mode.text()).toContain('Live register (corrections removed)')
    // And what that actually means for the figure beside it.
    expect(mode.text()).toMatch(/counted once/)
  })

  it('states the mode the response echoed, for each of the three modes', async () => {
    const only = await section(['finance.transaction.view'], {
      reversals: 'only',
      transactions: [WITHOUT_COUNTERPARTY],
      total: 2,
      totals: [{ currency: 'USD', account_kind: 'expenditure', rows: 2, amount: '0.00' }],
    })
    expect(only.find('[data-test="reversal-mode"]').text()).toContain('Corrections only')
    expect(only.find('[data-test="reversal-mode"]').text()).toMatch(/totals nil/)

    setActivePinia(createPinia())
    const all = await section(['finance.transaction.view'], { reversals: 'all', total: 115 })
    expect(all.find('[data-test="reversal-mode"]').text()).toContain('Every transaction')
    expect(all.find('[data-test="reversal-mode"]').text()).toMatch(/both halves of every correction/)
  })

  it('captions the mode from the response, not from the dropdown, so it cannot describe a figure it did not build', async () => {
    const wrapper = await section()
    // The response said `exclude`. Move the control to `all` WITHOUT a response coming back.
    const select = wrapper.findAll('select').find((s) => s.element.value === 'exclude')
    expect(select).toBeTruthy()
    await select!.setValue('all')
    // Still captioned with the mode that produced the figures on screen.
    expect(wrapper.find('[data-test="reversal-mode"]').text())
      .toContain('Live register (corrections removed)')
  })
})

// ── Rule 3: a withheld supplier is explained, never blanked ────────────────────────────────────
describe('counterparty identity', () => {
  it('explains the absence in a sentence and names the permission', async () => {
    const wrapper = await section()
    const note = wrapper.find('[data-test="counterparty-absent"]')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('finance.transaction.view_counterparty')
    // The crucial distinction: absent from the record, not an empty supplier name.
    expect(note.text()).toMatch(/absent from the record/i)
    expect(note.text()).toMatch(/not.*read as “no supplier was recorded”/i)
  })

  it('renders no counterparty column at all, rather than a column of blanks', async () => {
    const wrapper = await section()
    const headers = wrapper.findAll('thead th').map((th) => th.text())
    expect(headers).not.toContain('Counterparty')
    // Every body row has exactly as many cells as there are headers: no blank column survives.
    const rows = wrapper.findAll('tbody tr:not(.txn-detail-row)')
    expect(rows.length).toBeGreaterThan(0)
    for (const row of rows) {
      expect(row.findAll('td')).toHaveLength(headers.length)
    }
  })

  it('shows the column, and the identity, for a caller who holds the permission', async () => {
    const wrapper = await section(
      ['finance.transaction.view', 'finance.transaction.view_counterparty'],
      { counterparty_visible: true, transactions: [WITH_COUNTERPARTY] },
    )
    expect(wrapper.findAll('thead th').map((th) => th.text())).toContain('Counterparty')
    expect(wrapper.text()).toContain('Midlands Plant Hire')
    expect(wrapper.text()).toContain('SUP-0041')
    // And no explanation of an absence that is not happening.
    expect(wrapper.find('[data-test="counterparty-absent"]').exists()).toBe(false)
  })
})

// ── Rule 4: the totals cover the filtered set, not the page ────────────────────────────────────
describe('what the totals cover', () => {
  it('says the figures are for the whole filtered set and not for the rows on screen', async () => {
    const wrapper = await section()
    expect(wrapper.text()).toMatch(/all 113 transactions matching the filters/)
    expect(wrapper.text()).toMatch(/not the 2 shown in the table/)
  })

  it('names the votes a scoped response was confined to, so a narrowed figure is not read as council-wide', async () => {
    const store = useFinanceStore()
    store.departments = [
      {
        id: 'dept-eng', code: 'DD-ENG', name: 'Engineering Services', status: 'active',
      } as never,
    ]
    const wrapper = await section(['finance.transaction.view'], { scope_applied: ['dept-eng'] })
    expect(wrapper.text()).toContain('DD-ENG Engineering Services')
    expect(wrapper.text()).toMatch(/not council-wide figures/i)
  })
})

// ── Null is not zero ──────────────────────────────────────────────────────────────────────────
describe('a value that was not recorded', () => {
  it('says so, rather than rendering a blank or a nil', async () => {
    const wrapper = await section()
    // ZWG_ROW has no description, no reference and no record type.
    const absent = wrapper.findAll('.undefined-value')
    expect(absent.length).toBeGreaterThan(0)
    expect(absent.map((n) => n.text())).toContain('not recorded')
    // And nowhere is the absence rendered as a zero amount.
    expect(wrapper.text()).not.toMatch(/description:\s*0/i)
  })
})

// ── The detail view ───────────────────────────────────────────────────────────────────────────
describe('one transaction, expanded', () => {
  it('shows the reversal pair, so "is this figure still live" has an answer', async () => {
    const wrapper = await section()
    const detailButton = wrapper.findAll('button').find((b) => b.text().includes('Detail'))
    await detailButton!.trigger('click')
    await flushPromises()
    expect(api.transaction).toHaveBeenCalledWith('t1')
    const text = wrapper.text()
    expect(text).toMatch(/was reversed/)
    expect(text).toContain('DD-VCH-DD-L02-03-R')
    expect(text).toMatch(/no longer stands/)
  })

  it('shows the import provenance: the source filename and the file hash', async () => {
    const wrapper = await section()
    await wrapper.findAll('button').find((b) => b.text().includes('Detail'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('actuals-2026-08.csv')
    expect(wrapper.text())
      .toContain('9f2c1bd4e7a6035c8d41fe0b7a2c9d5e6f108342ab7c9e01d5f3426b8c7a0192')
    expect(wrapper.text()).toMatch(/SHA-256/)
  })

  it('lists the documents behind the figure', async () => {
    const wrapper = await section()
    await wrapper.findAll('button').find((b) => b.text().includes('Detail'))!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('DD-VCH-DD-L02-03.pdf')
    expect(wrapper.text()).toContain('voucher')
  })

  it('says plainly when there is no batch, no project and no document, rather than showing gaps', async () => {
    const wrapper = await section()
    // Set after mounting: `section()` primes the happy path, and this test is the bare one.
    api.transaction.mockResolvedValue(detailFor({
      budget_line: null, project: null, documents: [], import_batch: null,
      reversal: { reverses: null, reversed_by: null },
    }))
    await wrapper.findAll('button').find((b) => b.text().includes('Detail'))!.trigger('click')
    await flushPromises()
    const text = wrapper.text()
    expect(text).toMatch(/No import batch is recorded/)
    expect(text).toMatch(/not linked to a project/)
    expect(text).toMatch(/No voucher, invoice or receipt is attached/)
    expect(text).toMatch(/Not reversed, and not itself a reversal/)
  })
})

// ── Loading, empty and error ──────────────────────────────────────────────────────────────────
describe('the states that are not a table', () => {
  it('reports a failed read as an alert, not as an empty register', async () => {
    api.transactions.mockRejectedValue({
      response: { status: 500, data: { message: 'The transaction register could not be read.' } },
    })
    api.mapWardGeometry.mockResolvedValue({ ward_register_linked: true, features: [] })
    api.mapWards.mockResolvedValue({ ward_register_bases: [] })
    const store = useFinanceStore()
    store.identity = identity(['finance.transaction.view'])
    store.years = [YEAR]
    store.selectYear('y1')
    const wrapper = mount(TransactionsSection)
    await flushPromises()

    const alert = wrapper.find('[role="alert"]')
    expect(alert.exists()).toBe(true)
    expect(alert.text()).toContain('could not be read')
    // And no figures at all: a failed read is not a zero.
    expect(wrapper.findAll('.txn-total')).toHaveLength(0)
  })

  it('says why an empty result is empty, and points at where transactions come from', async () => {
    const wrapper = await section(['finance.transaction.view'], {
      transactions: [], total: 0, totals: [],
    })
    expect(wrapper.text()).toMatch(/No transaction matches these filters/)
    expect(wrapper.text()).toMatch(/committed import batch/)
    // Nothing can be typed into the register, and the screen says so rather than hiding it.
    expect(wrapper.text()).toMatch(/nothing can be keyed in here/i)
  })

  it('explains itself to a role that does not hold the permission, instead of showing an empty page', async () => {
    const store = useFinanceStore()
    store.identity = identity(['finance.budget.view'], 'planner')
    store.years = [YEAR]
    store.selectYear('y1')
    const wrapper = mount(TransactionsSection)
    await flushPromises()
    expect(wrapper.text()).toMatch(/not open to your role/)
    expect(wrapper.text()).toContain('finance.transaction.view')
    // And it never asked the endpoint for something it was going to be refused.
    expect(api.transactions).not.toHaveBeenCalled()
  })
})

// ── The request the screen actually makes ─────────────────────────────────────────────────────
describe('the query the screen sends', () => {
  it('sends the selected year and defaults corrections to the live register', async () => {
    await section()
    expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({
      financial_year_id: 'y1', reversals: 'exclude', limit: 50, offset: 0,
      sort: 'txn_date', direction: 'desc',
    }))
  })

  it('returns to the first page when a filter changes, so page 4 of a different question is impossible', async () => {
    const wrapper = await section()
    // Walk onto a later page first, so a reset is observable.
    api.transactions.mockClear()
    api.transactions.mockResolvedValue(registerPage({ offset: 50 }))
    await wrapper.findAll('button').find((b) => b.text() === 'Next')!.trigger('click')
    await flushPromises()
    expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({ offset: 50 }))

    api.transactions.mockClear()
    api.transactions.mockResolvedValue(registerPage())
    const kind = wrapper.find('select[aria-label="Revenue or expenditure"]')
    await kind.setValue('expenditure')
    await flushPromises()
    expect(api.transactions).toHaveBeenCalledWith(expect.objectContaining({
      offset: 0, kind: 'expenditure',
    }))
  })
})
