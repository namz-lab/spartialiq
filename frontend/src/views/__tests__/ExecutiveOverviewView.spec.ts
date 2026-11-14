// @vitest-environment happy-dom
//
// The Chief Executive's overview follows the council's Executive Arm, and its one rule is honesty:
// a department with no data says so instead of showing zeros, and a department whose read failed
// says that instead of passing for empty. This pins the order and the headings of the six areas,
// the human-resources "not yet in the system" tile, an empty register's note, the failed-read
// state, and the link into the existing finance dashboard.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ overview: vi.fn() }))
vi.mock('@/services/executiveOverview', () => ({ executiveApi: { overview: api.overview } }))

const dash = vi.hoisted(() => ({
  state: { data: null as unknown, error: null as string | null, loading: false },
  load: vi.fn(async () => undefined),
}))
vi.mock('@/modules/finance/workspaces/executive/dashboard', () => ({ executiveDash: dash }))

vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn() }),
  RouterLink: { name: 'RouterLink', props: ['to'], template: '<a :href="to"><slot /></a>' },
}))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ logout: vi.fn(), user: { name: 'CEO', role: 'accounting_officer' } }) }))
vi.mock('@/components/shared/ProfileDropdown.vue', () => ({ default: { name: 'ProfileDropdown', template: '<div />' } }))
// The ward map has its own spec; here it is a stand-in so this page's tests make no map request.
vi.mock('@/views/executive/ExecutiveWardMap.vue', () => ({ default: { name: 'ExecutiveWardMap', template: '<div class="wm-stub" />' } }))

import ExecutiveOverviewView from '../ExecutiveOverviewView.vue'
import type { ExecutiveOverview } from '@/services/executiveOverview'

const FULL: ExecutiveOverview = {
  as_of: '2026-11-13T17:12:09.705Z',
  planning: { loaded: true, total: 8, in_progress: 3, overdue: 2, awaiting_decision: 1, approved_this_year: 5, open_building_complaints: 2 },
  land: { loaded: true, parcels: 2320, parcels_with_account: 1589, estimated_boundaries: 1064 },
  engineering: { loaded: true, roads: 5, road_km: 73.2, water_points: 6, water_points_working: 4, council_assets: 3, projects_in_progress: 3 },
  social_services: { loaded: true, premises: 3, certificates_due_or_expired: 0, open_nuisance_complaints: 0 },
  hr: { loaded: false, note: 'Staff and payroll are not yet in the system.' },
  audit: { loaded: true, engagements: 2, engagements_open: 2, findings_open: 3, findings_high_risk: 1, actions_overdue: 1 },
}

const FINANCE = {
  year: { id: 'y1', reporting_currency: 'USD' },
  totals: [
    { currency: 'USD', account_kind: 'revenue', actual: '1466000.00', budget: '1548000.00', execution: '94.6' },
    { currency: 'USD', account_kind: 'expenditure', actual: '2038000.00', budget: '2780000.00', execution: '73.3' },
  ],
  projects: { on_track: 1, active: 3, in_progress: 3, completed: 0 },
}

async function mountPage() {
  const wrapper = mount(ExecutiveOverviewView)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  api.overview.mockReset()
  dash.state.data = FINANCE
  dash.state.error = null
})

describe('ExecutiveOverviewView', () => {
  it('shows the six Executive Arm areas in order', async () => {
    api.overview.mockResolvedValue(FULL)
    const wrapper = await mountPage()
    const titles = wrapper.findAll('h2').map((h) => h.text())
    expect(titles).toEqual([
      'Finance', 'Planning and Environment', 'Engineering and Works', 'Social Services',
      'Human Resources and Administration', 'Internal Audit',
    ])
  })

  it('says human resources is not yet in the system, with no figures', async () => {
    api.overview.mockResolvedValue(FULL)
    const wrapper = await mountPage()
    const hr = wrapper.findAll('section').find((s) => s.find('h2').text().startsWith('Human Resources'))!
    expect(hr.text()).toContain('Staff and payroll are not yet in the system.')
    expect(hr.find('dl').exists()).toBe(false)
  })

  it("shows an empty register's note instead of zeros", async () => {
    api.overview.mockResolvedValue({
      ...FULL,
      engineering: { loaded: false, note: 'The road, water and asset registers have not been loaded yet.' },
    })
    const wrapper = await mountPage()
    const eng = wrapper.findAll('section').find((s) => s.find('h2').text() === 'Engineering and Works')!
    expect(eng.text()).toContain('have not been loaded yet')
    expect(eng.find('dl').exists()).toBe(false)
  })

  it('reports a department whose read failed as unavailable, not empty', async () => {
    api.overview.mockResolvedValue({
      ...FULL,
      audit: { loaded: false, unavailable: true, note: 'This section could not be read just now.' },
    })
    const wrapper = await mountPage()
    const audit = wrapper.findAll('section').find((s) => s.find('h2').text() === 'Internal Audit')!
    expect(audit.find('.xo-missing').classes()).toContain('is-error')
  })

  it('shows an alert and no invented figures when the overview cannot be read', async () => {
    api.overview.mockRejectedValue(new Error('network'))
    const wrapper = await mountPage()
    expect(wrapper.find('[role="alert"]').text()).toContain('could not be read')
    const planning = wrapper.findAll('section').find((s) => s.find('h2').text() === 'Planning and Environment')!
    expect(planning.find('dl').exists()).toBe(false)
  })

  it('flags what needs the chief executive\'s attention', async () => {
    api.overview.mockResolvedValue(FULL)
    const wrapper = await mountPage()
    const overdue = wrapper.findAll('.xo-stat').find((s) => s.text().includes('Past statutory due date'))!
    expect(overdue.find('dd').classes()).toContain('is-bad')
  })

  it('shows no arrears figure anywhere (decision D13)', async () => {
    api.overview.mockResolvedValue(FULL)
    const wrapper = await mountPage()
    expect(wrapper.text().toLowerCase()).not.toContain('arrear')
  })

  it('links the finance card to the existing finance dashboard', async () => {
    api.overview.mockResolvedValue(FULL)
    const wrapper = await mountPage()
    const link = wrapper.findAll('a').find((a) => a.text().includes('Finance in detail'))!
    expect(link.attributes('href')).toBe('/finance/accounting')
  })
})
