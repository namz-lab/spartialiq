// @vitest-environment happy-dom
//
// The report picker's control logic (workstream W2).
//
// Ten reports were added, two of which have a period dimension and eight of which do not. The
// rules pinned here are the ones where a wrong control is worse than a missing one:
//
//   1. A PERIODICITY CONTROL APPEARS ONLY FOR A REPORT WHOSE CATALOGUE ENTRY DECLARES `periods`.
//      On a report with no period dimension an officer would set a periodicity, see figures that
//      did not change, and reasonably conclude the figures were monthly when they were annual.
//      This is the central assertion of this file.
//   2. A FILTER IS SENT ONLY TO A REPORT THAT APPLIES IT. The exported file prints "Filters
//      applied" from the request, so a filter the report ignores would put a line on a council's
//      file claiming a narrowing the figures never had.
//   3. Changing the report CLEARS the controls the new report does not apply, so nothing is left
//      over from the previous one.
//   4. A report offering exactly one periodicity is a fixed-form return: the periodicity is
//      stated, not offered, and no accumulation toggle is shown — there is nothing to choose.
//   5. The provenance block and the RESTRICTED handling, which predate W2, still work.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../api/financeApi', () => ({
  financeApi: {
    reportCatalogue: vi.fn(),
    runReport: vi.fn(),
    exportReport: vi.fn(),
  },
}))

import { financeApi } from '../api/financeApi'
import ReportsSection from '../pages/sections/ReportsSection.vue'
import { useFinanceStore } from '../stores/finance'
import type {
  Account, Department, FinanceIdentity, FinancialYear, Programme, ReportDefinition, ReportResult,
} from '../models/types'

const api = financeApi as unknown as Record<string, ReturnType<typeof vi.fn>>

/** The July–June year the demo fixture uses: the one that exposes calendar-quarter bucketing. */
const YEAR: FinancialYear = {
  id: 'y-dd', label: 'DD 2026/27', start_date: '2026-07-01', end_date: '2027-06-30',
  status: 'open', reporting_currency: 'USD', notes: null, opened_at: null, closed_at: null,
}

const DEPARTMENT = { id: 'd1', code: 'DD-ENG', name: 'Engineering' } as unknown as Department
const PROGRAMME = {
  id: 'pr1', department_id: 'd1', code: 'DD-P-ROADS', name: 'Roads', description: null,
  status: 'active',
} as Programme
const ACCOUNT = {
  id: 'a1', code: 'DD-5100', name: 'Road maintenance', kind: 'expenditure',
  revenue_class: null, expenditure_class: 'recurrent', parent_id: null, is_postable: true,
  effective_from: null,
} as unknown as Account

/**
 * The shape of the catalogue the backend's GET /api/finance/reports really returns.
 *
 * `accepts` is part of that contract: the backend publishes it from `REPORT_FILTERS` in
 * src/routes/finance-reports.js so the picker offers a filter only where it narrows something.
 * The values below mirror that table. If a filter is added to a report in the backend, this mock
 * is where the test suite learns about it — the screen itself holds no copy.
 */
const CATALOGUE: ReportDefinition[] = [
  {
    id: 'budget_vs_actual', name: 'Budget versus actual',
    requires: ['financial_year_id'], grouped_by: ['currency', 'department', 'account'],
    accepts: ['department_id'],
    description: 'One row per budget line with all seven §6.1 measures.',
  },
  {
    id: 'management_accounts', name: 'Management accounts',
    requires: ['financial_year_id', 'periodicity'],
    grouped_by: ['currency', 'department', 'account', 'period'],
    periods: ['monthly', 'quarterly', 'half_yearly', 'yearly'],
    accepts: ['department_id', 'account_id', 'kind', 'currency'],
    description: 'Actuals bucketed by period against the annual revised allocation.',
  },
  {
    id: 'quarterly_return', name: 'Quarterly return to the parent Ministry',
    requires: ['financial_year_id', 'periodicity'],
    grouped_by: ['currency', 'department', 'account', 'quarter (cumulative)'],
    periods: ['quarterly'],
    accepts: ['department_id', 'account_id', 'kind', 'currency'],
    description: 'The year-to-date quarterly form of the management account.',
  },
  {
    id: 'capital_vs_recurrent', name: 'Capital and recurrent expenditure',
    requires: ['financial_year_id'], grouped_by: ['currency', 'capital/recurrent', 'department'],
    accepts: ['department_id', 'expenditure_class', 'currency'],
    description: 'Expenditure split by the class the Council set on the account.',
  },
  {
    id: 'programme_performance', name: 'Programme and activity performance',
    requires: ['financial_year_id'], grouped_by: ['currency', 'programme', 'activity'],
    accepts: ['department_id', 'programme_id', 'kind', 'currency'],
    description: 'Budget and actuals by programme and then activity.',
  },
  {
    id: 'ward_finance', name: 'Ward finance',
    requires: ['financial_year_id'], grouped_by: ['currency', 'ward'],
    accepts: ['department_id', 'ward_code', 'currency'],
    description: 'Revenue and expenditure per ward, with unlocated money as its own row.',
  },
  {
    id: 'transaction_register', name: 'Transaction register',
    requires: ['financial_year_id'], grouped_by: [],
    accepts: ['department_id', 'dates'],
    restricted_columns: ['counterparty_ref', 'counterparty_name'],
    description: 'Imported actuals with their source system and reference.',
  },
]

const identity = (permissions: string[]): FinanceIdentity => ({
  user_id: 'u1', role: 'finance_admin', authority_id: 1, permissions,
  department_scope: [], catalogue: [],
})

/** A period report's result, as the backend returns it for the July–June demo year. */
const MANAGEMENT_RESULT = {
  report: 'management_accounts',
  financial_year: YEAR,
  columns: [
    { header: 'Department code', key: 'department_code' },
    { header: 'Currency', key: 'currency' },
    { header: 'Revised budget (annual)', key: 'revised_amount', type: 'number' },
    { header: 'Jul-Sep 2026', key: 'q1', type: 'number' },
    { header: 'Oct-Dec 2026', key: 'q2', type: 'number' },
    { header: 'Jan-Mar 2027', key: 'q3', type: 'number' },
    { header: 'Apr-Jun 2027', key: 'q4', type: 'number' },
    { header: 'Actual year to date', key: 'actual_year_to_date', type: 'number' },
    { header: 'Variance', key: 'variance', type: 'number' },
  ],
  rows: [{
    department_code: 'DD-ENG', currency: 'USD', revised_amount: '365000.00',
    q1: '90000.00', q2: '0.00', q3: '130000.00', q4: '128000.00',
    actual_year_to_date: '348000.00', variance: '17000.00',
  }],
  meta: {
    Council: 'Vungu Rural District Council',
    Periodicity: 'quarterly, discrete periods',
    'Periods reported': 'Jul-Sep 2026 (2026-07-01 to 2026-09-30); Oct-Dec 2026 (2026-10-01 to 2026-12-31)',
    'Period basis': "Buckets are generated from this council's own financial-year start date (2026-07-01).",
  },
} as unknown as ReportResult

async function mountSection(permissions = ['finance.report.view', 'finance.report.export']) {
  const store = useFinanceStore()
  store.identity = identity(permissions)
  store.years = [YEAR]
  store.selectYear('y-dd')
  store.departments = [DEPARTMENT]
  store.programmes = [PROGRAMME]
  store.accounts = [ACCOUNT]
  const wrapper = mount(ReportsSection)
  await flushPromises()
  return wrapper
}

/** Pick a report in the select, exactly as an officer does. */
async function choose(wrapper: Awaited<ReturnType<typeof mountSection>>, id: string) {
  await wrapper.find('#rp-report').setValue(id)
  await flushPromises()
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  api.reportCatalogue.mockResolvedValue({
    reports: CATALOGUE,
    formats: ['json', 'csv', 'xlsx', 'pdf'],
    can_export_restricted: false,
    currency_policy: 'USD and ZWG are reported separately.',
  })
  api.runReport.mockResolvedValue(MANAGEMENT_RESULT)
})

describe('the periodicity control is offered only where it means something', () => {
  // The central assertion of this file.
  it('does NOT appear for a report whose catalogue entry declares no periods', async () => {
    const wrapper = await mountSection()
    // budget_vs_actual is the default selection and has no `periods`.
    expect(wrapper.find('.fin-rp-period').exists()).toBe(false)
    expect(wrapper.find('input[name="rp-periodicity"]').exists()).toBe(false)
    expect(wrapper.text()).not.toContain('Reporting periods')
  })

  it('does not appear for any of the eight non-period reports', async () => {
    const wrapper = await mountSection()
    for (const report of CATALOGUE.filter((r) => !r.periods)) {
      await choose(wrapper, report.id)
      expect(wrapper.find('.fin-rp-period').exists(),
        `${report.id} must not offer a periodicity`).toBe(false)
    }
  })

  it('appears for a period report, with one choice per periodicity the catalogue declares', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'management_accounts')
    expect(wrapper.find('.fin-rp-period').exists()).toBe(true)
    const radios = wrapper.findAll('input[name="rp-periodicity"]')
    expect(radios).toHaveLength(4)
    expect(radios.map((r) => r.attributes('value')))
      .toEqual(['monthly', 'quarterly', 'half_yearly', 'yearly'])
    expect(wrapper.text()).toContain('Half-yearly')
  })

  it('offers the accumulated / year-to-date toggle, and says the columns must not be added', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'management_accounts')
    const toggle = wrapper.find('.fin-rp-mode input[type="checkbox"]')
    expect(toggle.exists()).toBe(true)
    expect(wrapper.find('.fin-rp-mode').text()).toMatch(/Year to date \(accumulated\)/)
    expect(wrapper.find('.fin-rp-mode').text()).toMatch(/must not be added together/)
  })

  it('states the periodicity rather than offering it for a fixed-form return', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'quarterly_return')
    expect(wrapper.find('.fin-rp-period').exists()).toBe(true)
    // One periodicity means nothing to choose: no radios, and no accumulation toggle either.
    expect(wrapper.find('input[name="rp-periodicity"]').exists()).toBe(false)
    expect(wrapper.find('.fin-rp-mode').exists()).toBe(false)
    expect(wrapper.find('.fin-rp-fixed').text()).toMatch(/quarterly periods only/)
  })

  it('says the buckets come from the council\'s own year start, not the calendar year', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'management_accounts')
    expect(wrapper.find('.fin-rp-note').text()).toMatch(/own financial-year start date/)
    expect(wrapper.find('.fin-rp-note').text()).toMatch(/July–June year begins its first quarter in July/)
    // Rule A4, stated where the control is set rather than only on the result.
    expect(wrapper.find('.fin-rp-note').text()).toMatch(/keeps its column and reports zero/)
  })
})

describe('what is sent to the server', () => {
  it('sends no periodicity and no accumulated flag for a non-period report', async () => {
    const wrapper = await mountSection()
    await wrapper.find('.fin-btn').trigger('click')
    await flushPromises()
    const sent = api.runReport.mock.calls[0][0]
    expect(sent.report).toBe('budget_vs_actual')
    expect(sent.periodicity).toBeUndefined()
    expect(sent.accumulated).toBeUndefined()
  })

  it('sends the chosen periodicity and the accumulated flag for a period report', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'management_accounts')
    await wrapper.find('input[name="rp-periodicity"][value="quarterly"]').setValue(true)
    await wrapper.find('.fin-rp-mode input[type="checkbox"]').setValue(true)
    await wrapper.find('.fin-btn').trigger('click')
    await flushPromises()
    const sent = api.runReport.mock.calls[0][0]
    expect(sent.periodicity).toBe('quarterly')
    expect(sent.accumulated).toBe(true)
  })

  it('sends the quarterly periodicity for the fixed-form return without an accumulated flag', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'quarterly_return')
    await wrapper.find('.fin-btn').trigger('click')
    await flushPromises()
    const sent = api.runReport.mock.calls[0][0]
    expect(sent.periodicity).toBe('quarterly')
    // The report fixes its own accumulation; the screen does not assert it.
    expect(sent.accumulated).toBeUndefined()
  })

  it('sends a dimensional filter only to a report that applies it', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'ward_finance')
    await wrapper.find('#rp-ward').setValue('ZW102101')
    await wrapper.find('.fin-btn').trigger('click')
    await flushPromises()
    expect(api.runReport.mock.calls[0][0].ward_code).toBe('ZW102101')

    // The same control is not even rendered on a report with no ward dimension, so nothing
    // stale can be sent with it.
    await choose(wrapper, 'capital_vs_recurrent')
    expect(wrapper.find('#rp-ward').exists()).toBe(false)
    await wrapper.find('.fin-btn').trigger('click')
    await flushPromises()
    const second = api.runReport.mock.calls[1][0]
    expect(second.report).toBe('capital_vs_recurrent')
    expect(second.ward_code).toBeUndefined()
  })

  it('clears a filter the newly chosen report does not apply', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'capital_vs_recurrent')
    await wrapper.find('#rp-expclass').setValue('capital')
    await choose(wrapper, 'programme_performance')
    await wrapper.find('.fin-btn').trigger('click')
    await flushPromises()
    const sent = api.runReport.mock.calls[0][0]
    expect(sent.report).toBe('programme_performance')
    expect(sent.expenditure_class).toBeUndefined()
  })

  it('asks the export for exactly the parameters the screen was run with', async () => {
    api.exportReport.mockResolvedValue({
      blob: new Blob(['x']), filename: 'vungu-rdc-management-accounts-DD-2026-27.csv',
      restricted: false,
    })
    const wrapper = await mountSection()
    await choose(wrapper, 'management_accounts')
    await wrapper.find('input[name="rp-periodicity"][value="half_yearly"]').setValue(true)
    const csv = wrapper.findAll('.fin-btn').find((b) => b.text().includes('CSV'))!
    await csv.trigger('click')
    await flushPromises()
    const sent = api.exportReport.mock.calls[0][0]
    expect(sent).toMatchObject({
      report: 'management_accounts', periodicity: 'half_yearly', financial_year_id: 'y-dd',
      format: 'csv',
    })
  })
})

describe('the rest of the picker', () => {
  it('shows each report\'s description beside its name', async () => {
    const wrapper = await mountSection()
    expect(wrapper.find('.fin-rp-desc').text())
      .toContain('One row per budget line with all seven §6.1 measures.')
    await choose(wrapper, 'ward_finance')
    expect(wrapper.find('.fin-rp-desc').text()).toContain('unlocated money as its own row')
  })

  it('ties the description to the select, so it is read with the control', async () => {
    const wrapper = await mountSection()
    expect(wrapper.find('#rp-report').attributes('aria-describedby')).toBe('rp-report-about')
    expect(wrapper.find('#rp-report-about').exists()).toBe(true)
  })

  it('offers only the dimensional controls the chosen report applies', async () => {
    const wrapper = await mountSection()
    // Capital/recurrent is an expenditure-class report and nothing else.
    await choose(wrapper, 'capital_vs_recurrent')
    expect(wrapper.find('#rp-expclass').exists()).toBe(true)
    expect(wrapper.find('#rp-currency').exists()).toBe(true)
    expect(wrapper.find('#rp-programme').exists()).toBe(false)
    expect(wrapper.find('#rp-account').exists()).toBe(false)

    await choose(wrapper, 'programme_performance')
    expect(wrapper.find('#rp-programme').exists()).toBe(true)
    expect(wrapper.find('#rp-expclass').exists()).toBe(false)

    await choose(wrapper, 'management_accounts')
    expect(wrapper.find('#rp-account').exists()).toBe(true)
    expect(wrapper.find('#rp-kind').exists()).toBe(true)
    expect(wrapper.find('#rp-ward').exists()).toBe(false)
  })

  it('offers the date range only on the report that honours it', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'transaction_register')
    expect(wrapper.find('#rp-from').exists()).toBe(true)
    await choose(wrapper, 'management_accounts')
    expect(wrapper.find('#rp-from').exists()).toBe(false)
  })

  it('says the currency filter is a grouping and not a default', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'management_accounts')
    expect(wrapper.text()).toContain('Each currency separately')
    expect(wrapper.text()).toMatch(/no figure combines\s+USD with ZWG/)
  })

  it('keeps the provenance block, with the period lines the server put on it', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'management_accounts')
    await wrapper.find('.fin-btn').trigger('click')
    await flushPromises()
    const meta = wrapper.find('.fin-report-meta')
    expect(meta.exists()).toBe(true)
    expect(meta.text()).toContain('Periodicity')
    expect(meta.text()).toContain('quarterly, discrete periods')
    expect(meta.text()).toContain("own financial-year start date (2026-07-01)")
  })

  it('renders a period column per period, headed by the period\'s own label', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'management_accounts')
    await wrapper.find('.fin-btn').trigger('click')
    await flushPromises()
    const headers = wrapper.findAll('.fin-rp-table thead th').map((th) => th.text())
    // Jul–Sep, not Jan–Mar: the council's year starts in July.
    expect(headers).toContain('Jul-Sep 2026')
    expect(headers).not.toContain('Jan-Mar 2026')
    // A quarter with no activity keeps its column and shows the recorded nil.
    const cells = wrapper.findAll('.fin-rp-table tbody td').map((td) => td.text())
    expect(headers).toContain('Oct-Dec 2026')
    expect(cells).toContain('0.00')
  })

  it('puts the wide table in its own scrollable region with an accessible name', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'management_accounts')
    await wrapper.find('.fin-btn').trigger('click')
    await flushPromises()
    const region = wrapper.find('.fin-rp-scroll')
    expect(region.attributes('role')).toBe('region')
    expect(region.attributes('tabindex')).toBe('0')
    expect(region.attributes('aria-label')).toContain('9 columns')
    // The provenance block is OUTSIDE the scrolling region, so it cannot scroll away with it.
    expect(region.find('.fin-report-meta').exists()).toBe(false)
    expect(wrapper.text()).toContain('This report has 9 columns')
  })

  it('still explains the restricted toggle a role cannot use', async () => {
    const wrapper = await mountSection()
    await choose(wrapper, 'transaction_register')
    const toggle = wrapper.find('.fin-restricted-toggle input[type="checkbox"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('disabled')).toBeDefined()
    expect(wrapper.find('.fin-restricted-toggle').text())
      .toMatch(/needs the restricted-export permission/)
  })

  it('names a RESTRICTED file as restricted after a download', async () => {
    api.exportReport.mockResolvedValue({
      blob: new Blob(['x']),
      filename: 'vungu-rdc-transaction-register-DD-2026-27-RESTRICTED-2026-11-10.csv',
      restricted: true,
    })
    const wrapper = await mountSection()
    await choose(wrapper, 'transaction_register')
    const csv = wrapper.findAll('.fin-btn').find((b) => b.text().includes('CSV'))!
    await csv.trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="status"]').text()).toMatch(/named RESTRICTED/)
  })

  it('hides the export buttons from a role that may run but not export', async () => {
    const wrapper = await mountSection(['finance.report.view'])
    expect(wrapper.findAll('.fin-btn').some((b) => b.text().includes('CSV'))).toBe(false)
    expect(wrapper.text()).toContain('Exporting needs the')
  })

  it('refuses in a sentence rather than sending a request with no year', async () => {
    const store = useFinanceStore()
    store.identity = identity(['finance.report.view'])
    store.years = []
    const wrapper = mount(ReportsSection)
    await flushPromises()
    await wrapper.find('.fin-btn').trigger('click')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toContain('needs a financial year')
    expect(api.runReport).not.toHaveBeenCalled()
  })
})
