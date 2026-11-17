// @vitest-environment happy-dom
//
// Budget Management: navigation grouped by the budget cycle, the pages a budget officer needs
// (revenue estimates, preparation by vote, variance explanations, the council pack, map, documents),
// and monitoring that shows original and revised together, filters capital and recurrent and states
// which "available" it shows.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'

vi.mock('@/services/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ logout: vi.fn(), user: { name: 'Demo Budget', role: 'budget_officer' } }) }))
vi.mock('../workspaces/shared/usePortal', () => ({ usePortalInbox: () => ({ inbox: { unread: 0 }, loadUnread: vi.fn() }), resetPortalInbox: vi.fn(), initials: () => 'DB' }))
vi.mock('../api/budgetingApi', () => ({ budgetingApi: { dashboard: vi.fn().mockResolvedValue(null) } }))
vi.mock('../api/financeApi', () => ({
  financeApi: {
    budgetLines: vi.fn(), budgetExceptions: vi.fn(), budgetLine: vi.fn(), explainVariance: vi.fn(),
    reportCatalogue: vi.fn(), runReport: vi.fn(), exportReport: vi.fn(),
  },
}))

import { financeApi } from '../api/financeApi'
import { budgetRoutes } from '../workspaces/budget/routes'
import BudgetMonitoring from '../workspaces/budget/pages/BudgetMonitoring.vue'
import PreparationPage from '../workspaces/budget/pages/PreparationPage.vue'
import VariancePage from '../workspaces/budget/pages/VariancePage.vue'
import SubmissionPack from '../workspaces/budget/pages/SubmissionPack.vue'
import { useFinanceStore } from '../stores/finance'

const api = financeApi as unknown as Record<string, ReturnType<typeof vi.fn>>

const line = (over: Record<string, unknown> = {}) => ({
  budget_line_id: 'l1', financial_year_id: 'y1', department_id: 'd1', programme_id: null, account_id: 'a1', ward_code: null,
  code: 'E-100', description: 'Road grading', status: 'approved', currency: 'USD', account_kind: 'expenditure',
  original_amount: '1000.00', approved_adjustments: '200.00', revised_amount: '1200.00', actual_amount: '1300.00',
  open_commitments: '50.00', available_excluding_commitments: '-100.00', available_including_commitments: '-150.00',
  execution_percentage: '108.3', variance: '100.00', transaction_rows: 3, last_transaction_date: null,
  actual_currency_mismatch_rows: 0, revision_currency_mismatch_rows: 0, commitment_currency_mismatch_rows: 0,
  department_code: 'ENG', department_name: 'Engineering', expenditure_class: 'capital', ...over,
})
const lines = (rows: unknown[], over: Record<string, unknown> = {}) => ({ lines: rows, total: rows.length, limit: 500, offset: 0, available_balance_includes_commitments: false, ...over })

function setup(perms: string[] = ['finance.budget.view', 'finance.variance.explain', 'finance.report.export']) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u1', role: 'budget_officer', authority_id: 1, permissions: perms, department_scope: [], catalogue: [] } as never
  store.years = [{ id: 'y1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open', reporting_currency: 'USD' }] as never
  store.selectedYearId = 'y1'
  return store
}
async function mountAt(name: string, comp: unknown) {
  const router = createRouter({ history: createMemoryHistory(), routes: budgetRoutes })
  await router.push({ name })
  const w = mount(comp as never, { global: { plugins: [router] } })
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('Budget Management navigation', () => {
  it('groups the navigation by the budget cycle and lists the officer\'s pages', async () => {
    setup()
    const router = createRouter({ history: createMemoryHistory(), routes: budgetRoutes })
    await router.push({ name: 'bud-settings' })
    const w = mount(RouterView, { global: { plugins: [router], stubs: { FinanceYearPicker: true } } })
    await flushPromises()
    expect(w.findAll('.cw-nav-group').map((g) => g.text())).toEqual(['Desk', 'Preparation', 'Execution', 'Structure', 'Reporting', 'Control'])
    const labels = w.findAll('.cw-nav a').map((a) => a.text())
    for (const l of ['Revenue Estimates', 'Preparation by Vote', 'Variance Explanations', 'Council Submission Pack', 'Allocation by Ward', 'Documents']) {
      expect(labels).toContain(l)
    }
  })

  it('opens Approval Status on submitted lines and the map behind its permission', () => {
    const router = createRouter({ history: createMemoryHistory(), routes: budgetRoutes })
    expect(router.resolve({ name: 'bud-approval' }).meta.cwStateDefault).toBe('submitted')
    expect(router.resolve({ name: 'bud-map' }).meta.cwNeeds).toBe('finance.map.view')
    expect(router.resolve({ name: 'bud-revenue' }).meta.bmKind).toBe('revenue')
    // A virement is not claimed to be one atomic act: the backend records two revisions.
    expect(String(router.resolve({ name: 'bud-virements' }).meta.cwLead)).toContain('each approved on its own')
  })
})

describe('Budget monitoring', () => {
  it('shows original and revised together and filters capital from recurrent', async () => {
    setup()
    api.budgetLines.mockResolvedValue(lines([line(), line({ budget_line_id: 'l2', code: 'E-200', description: 'Salaries', expenditure_class: 'recurrent' })]))
    api.budgetExceptions.mockResolvedValue({ rows: [{ budget_line_id: 'l1', flag: 'over_budget' }], thresholds: { warn_execution_percentage: 90, flag_execution_percentage: 100 } })
    const w = await mountAt('bud-monitoring', BudgetMonitoring)
    expect(api.budgetLines.mock.calls[0][0]).toMatchObject({ kind: 'expenditure', financial_year_id: 'y1' })
    const head = w.find('thead').text()
    expect(head).toContain('Original')
    expect(head).toContain('Revised')
    expect(w.text()).toContain('Over budget')
    // The council's setting says commitments are excluded, and the page says so.
    expect(w.text()).toContain('revised budget less spending,')
    expect(w.findAll('tbody tr')).toHaveLength(2)
    await w.findAll('select')[1].setValue('capital')
    expect(w.findAll('tbody tr')).toHaveLength(1)
    expect(w.find('tbody').text()).toContain('Road grading')
  })

  it('reads revenue lines as estimates against collections, without commitments', async () => {
    setup()
    api.budgetLines.mockResolvedValue(lines([line({ account_kind: 'revenue', expenditure_class: null, revenue_class: 'rates', description: 'Property rates' })]))
    const w = await mountAt('bud-revenue', BudgetMonitoring)
    expect(api.budgetLines.mock.calls[0][0]).toMatchObject({ kind: 'revenue' })
    expect(api.budgetExceptions).not.toHaveBeenCalled()
    expect(w.find('h2').text()).toBe('Revenue Estimates')
    expect(w.find('thead').text()).toContain('Collected')
    expect(w.find('thead').text()).not.toContain('Committed')
  })

  it('says when there are more lines than it read', async () => {
    setup()
    api.budgetLines.mockResolvedValueOnce(lines([line()], { total: 3 })).mockResolvedValue(lines([]))
    api.budgetExceptions.mockResolvedValue({ rows: [], thresholds: null })
    const w = await mountAt('bud-monitoring', BudgetMonitoring)
    expect(w.text()).toContain('Showing the first 1 of 3 lines')
  })
})

describe('Preparation by vote', () => {
  it('counts lines by state for each vote and lists returned lines with their reason', async () => {
    setup()
    api.budgetLines.mockResolvedValue(lines([
      line({ status: 'draft' }), line({ budget_line_id: 'l2', status: 'returned', returned_note: 'Quote missing' }),
      line({ budget_line_id: 'l3', status: 'published', account_kind: 'revenue' }),
      line({ budget_line_id: 'l4', status: 'approved', department_id: 'd2', department_code: 'HLT', department_name: 'Health' }),
    ]))
    const w = await mountAt('bud-preparation', PreparationPage)
    const rows = w.findAll('.pp-table tbody tr')
    expect(rows).toHaveLength(2)
    expect(rows[0].text()).toContain('ENG')
    expect(rows[0].text()).toContain('Has returned lines')
    expect(rows[1].text()).toContain('All approved')
    expect(w.text()).toContain('Quote missing')
  })
})

describe('Variance explanations', () => {
  it('lists over-budget lines and records an explanation against one', async () => {
    const store = setup()
    Object.defineProperty(store, 'selectedYearAcceptsWrites', { value: true })
    api.budgetExceptions.mockResolvedValue({ rows: [line({ flag: 'over_budget' }), line({ budget_line_id: 'l2', flag: 'nearly_exhausted' })], thresholds: { warn_execution_percentage: 90, flag_execution_percentage: 100 } })
    api.budgetLine.mockResolvedValue({ explanations: [] })
    api.explainVariance.mockResolvedValue({ id: 'v1', budget_line_id: 'l1', department_id: null, period_label: null, explanation: 'Fuel prices rose in the quarter.', recorded_at: '2026-11-17T08:00:00Z' })
    const w = await mountAt('bud-variance', VariancePage)
    expect(w.findAll('.vp-item')).toHaveLength(1)
    await w.find('.vp-row').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('No explanation recorded yet.')
    await w.find('textarea').setValue('Fuel prices rose in the quarter.')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.explainVariance).toHaveBeenCalledWith({ financial_year_id: 'y1', budget_line_id: 'l1', explanation: 'Fuel prices rose in the quarter.' })
    expect(w.text()).toContain('Explanation recorded for E-100.')
  })

  it('offers no form to a role that cannot explain', async () => {
    setup(['finance.budget.view'])
    api.budgetExceptions.mockResolvedValue({ rows: [line({ flag: 'over_budget' })], thresholds: null })
    api.budgetLine.mockResolvedValue({ explanations: [] })
    const w = await mountAt('bud-variance', VariancePage)
    await w.find('.vp-row').trigger('click')
    await flushPromises()
    expect(w.find('form').exists()).toBe(false)
  })
})

describe('Council submission pack', () => {
  const catalogue = {
    reports: [
      { id: 'budget_execution_statement', name: 'Budget execution statement', requires: ['financial_year_id'], grouped_by: [] },
      { id: 'quarterly_return', name: 'Quarterly return', requires: ['financial_year_id', 'periodicity'], grouped_by: [], periods: ['quarterly'] },
      { id: 'year_on_year', name: 'Year-on-year comparison', requires: ['financial_year_id', 'compare_financial_year_id'], grouped_by: [] },
    ],
    formats: ['csv', 'xlsx', 'pdf'], can_export_restricted: false, currency_policy: '',
  }

  it('offers only catalogued pack reports and exports with the year and periodicity', async () => {
    setup()
    api.reportCatalogue.mockResolvedValue(catalogue)
    api.exportReport.mockResolvedValue({ blob: new Blob(['x']), filename: 'quarterly.pdf', restricted: false })
    URL.createObjectURL = vi.fn(() => 'blob:x')
    URL.revokeObjectURL = vi.fn()
    const w = await mountAt('bud-submission', SubmissionPack)
    expect(w.findAll('.sp-item h4').map((h) => h.text())).toEqual(['Budget execution statement', 'Quarterly return'])
    await w.find('[aria-label="Export Quarterly return as PDF"]').trigger('click')
    await flushPromises()
    expect(api.exportReport).toHaveBeenCalledWith({ report: 'quarterly_return', financial_year_id: 'y1', periodicity: 'quarterly', format: 'pdf' })
    expect(w.text()).toContain('quarterly.pdf downloaded.')
  })

  it('previews without export for a role that cannot export', async () => {
    setup(['finance.report.view'])
    api.reportCatalogue.mockResolvedValue(catalogue)
    api.runReport.mockResolvedValue({ report: 'budget_execution_statement', financial_year: null, columns: [{ header: 'Vote', key: 'v' }, { header: 'Budget', key: 'b', type: 'number' }], rows: [{ v: 'ENG', b: '1200.00' }], meta: {} })
    const w = await mountAt('bud-submission', SubmissionPack)
    expect(w.find('[aria-label^="Export"]').exists()).toBe(false)
    await w.find('.sp-actions button').trigger('click')
    await flushPromises()
    expect(w.find('.sp-table').text()).toMatch(/1.200\.00/)
  })
})
