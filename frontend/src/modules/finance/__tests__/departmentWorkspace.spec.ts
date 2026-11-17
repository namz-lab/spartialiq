// @vitest-environment happy-dom
//
// Department Finance: a head of department with no department recorded is not scoped on the server,
// so every budget read would answer for the whole council. Each data page is gated: it says no
// votes are assigned and makes no request. A scoped head sees their pages, including revisions and
// variance explanations, and the dashboard routes the overspend task to the explanations page.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'

vi.mock('@/services/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ logout: vi.fn(), user: { name: 'Demo Head', role: 'dept_head' } }) }))
vi.mock('../workspaces/shared/usePortal', () => ({ usePortalInbox: () => ({ inbox: { unread: 0 }, loadUnread: vi.fn() }), resetPortalInbox: vi.fn(), initials: () => 'DH' }))
vi.mock('../api/dashboardsApi', () => ({ dashboardsApi: { department: vi.fn() } }))
vi.mock('../api/financeApi', () => ({
  financeApi: {
    budgetLines: vi.fn().mockResolvedValue({ lines: [], total: 0, available_balance_includes_commitments: false }),
    budgetExceptions: vi.fn().mockResolvedValue({ rows: [], thresholds: null }),
    commitments: vi.fn().mockResolvedValue([]),
    overviewSeries: vi.fn().mockResolvedValue({ series: [] }),
  },
}))

import { financeApi } from '../api/financeApi'
import { dashboardsApi } from '../api/dashboardsApi'
import { departmentRoutes } from '../workspaces/department/routes'
import { departmentDash } from '../workspaces/department/dashboard'
import { useFinanceStore } from '../stores/finance'

const api = financeApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const dash = dashboardsApi as unknown as { department: ReturnType<typeof vi.fn> }

function setup(scope: { id: string; code: string; name: string }[]) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u1', role: 'dept_head', authority_id: 1, permissions: ['finance.budget.view', 'finance.variance.explain'], department_scope: scope, catalogue: [] } as never
  store.years = [{ id: 'y1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open', reporting_currency: 'USD' }] as never
  store.selectedYearId = 'y1'
  return store
}
async function open(name: string) {
  const router = createRouter({ history: createMemoryHistory(), routes: departmentRoutes })
  await router.push({ name })
  const w = mount(RouterView, { global: { plugins: [router], stubs: { FinanceYearPicker: true } } })
  await flushPromises()
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  departmentDash.reset()
  dash.department.mockResolvedValue({ year: { id: 'y1', label: '2026', reporting_currency: 'USD' }, departments: [], unscoped: true, totals: [], top_items: [], tasks: [] })
})

describe('Department Finance without a recorded department', () => {
  for (const name of ['dep-expenditure', 'dep-commitments', 'dep-variance']) {
    it(`${name} says no votes are assigned and reads nothing council-wide`, async () => {
      setup([])
      const w = await open(name)
      expect(w.text()).toContain('no votes to show')
      expect(api.budgetLines).not.toHaveBeenCalled()
      expect(api.commitments).not.toHaveBeenCalled()
      expect(api.budgetExceptions).not.toHaveBeenCalled()
    }, 30_000)
  }

  it('gates the console screens too (budget lines)', async () => {
    setup([])
    const w = await open('dep-budget')
    expect(w.text()).toContain('no votes to show')
    expect(w.find('.sp-embed').exists()).toBe(false)
  })
})

describe('Department Finance for a scoped head', () => {
  it('reads the department\'s own lines under its own heading', async () => {
    setup([{ id: 'd1', code: 'ENG', name: 'Engineering' }])
    const w = await open('dep-expenditure')
    expect(w.text()).not.toContain('no votes to show')
    expect(w.find('h2.cw-banner-title, .cw-pagehead h2').text()).toBe('Budget vs Actual')
    expect(api.budgetLines).toHaveBeenCalled()
  })

  it('lists revisions and variance explanations in the navigation', async () => {
    setup([{ id: 'd1', code: 'ENG', name: 'Engineering' }])
    const w = await open('dep-variance')
    const labels = w.findAll('.cw-nav a').map((a) => a.text())
    expect(labels).toContain('Budget Revisions')
    expect(labels).toContain('Variance Explanations')
    expect(labels).toContain('Budget vs Actual')
  })

  it('routes the overspend task to variance explanations', () => {
    const router = createRouter({ history: createMemoryHistory(), routes: departmentRoutes })
    expect(router.resolve({ name: 'dep-variance' }).path).toBe('/finance/department/variance')
  })
})
