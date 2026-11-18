// @vitest-environment happy-dom
//
// A unit's dashboard. Pins the honesty rules it shares with the Chief Executive's overview: an empty register says so
// instead of showing zeros, a vacant post is shown as vacant and never given a name, a unit with no ward measure says
// so instead of drawing a map, a refused read says the unit is not theirs, and the Chief Executive gets a way back.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/services/units', async (orig) => ({ ...(await orig<object>()), unitsApi: { get: api.get } }))

const auth = vi.hoisted(() => ({ user: { name: 'CEO', role: 'accounting_officer' } as { name: string; role: string } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ logout: vi.fn(), user: auth.user }) }))
// The page keeps its view in the address (?view=…): a reactive stand-in for the route, which push updates as the router would.
const nav = vi.hoisted(() => ({ route: null as unknown as { query: Record<string, unknown> } }))
vi.mock('vue-router', async () => {
  const { reactive } = await import('vue')
  nav.route = reactive({ query: {} as Record<string, unknown> })
  return {
    useRoute: () => nav.route,
    useRouter: () => ({
      push: vi.fn(async (to: { query?: Record<string, unknown> } | string) => {
        if (typeof to === 'object' && to.query) nav.route.query = Object.fromEntries(Object.entries(to.query).filter(([, v]) => v !== undefined))
      }),
    }),
    RouterLink: { name: 'RouterLink', props: ['to'], template: '<a :href="to"><slot /></a>' },
  }
})
// The ward tables have their own spec.
vi.mock('@/components/executive/WardTable.vue', () => ({
  default: { name: 'WardTable', props: ['unitKey', 'only'], template: '<div class="wt-stub" :data-only="only" />' },
}))
vi.mock('@/components/shared/ProfileDropdown.vue', () => ({ default: { name: 'ProfileDropdown', template: '<div />' } }))
vi.mock('@/views/executive/ExecutiveWardMap.vue', () => ({
  default: { name: 'ExecutiveWardMap', props: ['unitKey'], template: '<div class="wm-stub" :data-unit="unitKey" />' },
}))

import UnitDashboardView from '../UnitDashboardView.vue'
import type { UnitDashboard } from '@/services/units'

const MAPS = { ward_register: { linked: true, wards: 19, basis: 'interim', instrument_ref: null }, run: null, measures: [], has_measures: true }

const ENGINEERING: UnitDashboard = {
  unit: { key: 'engineering', label: 'Roads and Works', post: 'District Engineer', desks: [{ label: 'Parcel and asset map', path: '/gis-officer-portal' }] },
  as_of: '2026-11-14T08:00:00.000Z',
  head: { id: 'p1', title: 'Engineer', system_role: 'engineer', holder_name: 'Demo Engineer', vacant: false, is_head: true },
  establishment: {
    total: 2, vacant: 1,
    posts: [
      { id: 'p1', title: 'Engineer', system_role: 'engineer', holder_name: 'Demo Engineer', vacant: false, is_head: true },
      { id: 'p2', title: 'Roads Foreman', system_role: null, holder_name: null, vacant: true, is_head: false },
    ],
  },
  sections: { engineering: { loaded: true, roads: 5, road_km: 73.2, water_points: 6, water_points_working: 4, council_assets: 3, projects_in_progress: 3 } },
  maps: { ...MAPS, measures: [{ measure_key: 'road_density' } as never] },
}

const mountPage = async (unit: string) => {
  const wrapper = mount(UnitDashboardView, { props: { unit } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  api.get.mockReset()
  auth.user = { name: 'CEO', role: 'accounting_officer' }
  nav.route.query = {}
})

const shownStyle = (el: { attributes: (k: string) => string | undefined }) => (el.attributes('style') ?? '').indexOf('display: none') === -1

describe('UnitDashboardView', () => {
  it("shows the unit's figures, its head, and its ward map for that unit only", async () => {
    api.get.mockResolvedValue(ENGINEERING)
    const w = await mountPage('engineering')
    expect(api.get).toHaveBeenCalledWith('engineering')
    expect(w.find('h1').text()).toContain('Roads and Works')
    expect(w.text()).toContain('Demo Engineer')
    expect(w.text()).toContain('4 of 6')
    // the map is a view of its own, opened from the menu
    expect(w.find('.wm-stub').exists()).toBe(false)
    await w.findAll('.ud-nav-item').find((b) => b.text() === 'Ward map')!.trigger('click')
    await flushPromises()
    expect(nav.route.query).toEqual({ view: 'wards-map' })
    expect(w.find('.wm-stub').attributes('data-unit')).toBe('engineering')
    expect(shownStyle(w.get('[data-testid=ud-stands]'))).toBe(false)
  })

  it('opens on "Where the unit stands", with the figures and the posts side by side', async () => {
    api.get.mockResolvedValue(ENGINEERING)
    const w = await mountPage('engineering')
    expect(shownStyle(w.get('[data-testid=ud-stands]'))).toBe(true)
    expect(w.find('.ud-nav-item[aria-current="page"]').text()).toBe('Where the unit stands')
    expect(w.get('[data-testid=ud-stands]').findAll('h2').map((h) => h.text())).toEqual(['Where the unit stands', 'Establishment'])
  })

  it('offers the register counts table to Planning only; other units get the measures', async () => {
    api.get.mockResolvedValue(ENGINEERING)
    const eng = await mountPage('engineering')
    expect(eng.findAll('.ud-nav-item').map((b) => b.text())).not.toContain('What the registers hold')
    expect(eng.find('.wt-stub').attributes('data-only')).toBe('measures')

    api.get.mockResolvedValue({ ...ENGINEERING, unit: { ...ENGINEERING.unit, key: 'planning', label: 'Planning and Environment' } })
    nav.route.query = { view: 'wards-registers' }
    const plan = await mountPage('planning')
    expect(plan.find('.wt-stub').attributes('data-only')).toBe('counts')
    expect(shownStyle(plan.get('.ud-wardtable'))).toBe(true)
  })

  it('falls back to "Where the unit stands" for a ward view the unit does not have', async () => {
    api.get.mockResolvedValue({ ...ENGINEERING, maps: { ...MAPS, has_measures: false } })
    nav.route.query = { view: 'wards-map' }
    const w = await mountPage('engineering')
    expect(shownStyle(w.get('[data-testid=ud-stands]'))).toBe(true)
    expect(w.find('.wm-stub').exists()).toBe(false)
  })

  it('lets the Chief Executive move to the other units from the menu, and a unit head not', async () => {
    api.get.mockResolvedValue(ENGINEERING)
    const ceo = await mountPage('engineering')
    const hrefs = ceo.findAll('a.ud-nav-item').map((a) => a.attributes('href'))
    expect(hrefs).toEqual(['/units/finance', '/units/planning', '/units/social_admin', '/units/audit'])
    auth.user = { name: 'Eng', role: 'engineer' }
    const head = await mountPage('engineering')
    expect(head.findAll('a.ud-nav-item')).toHaveLength(0)
  })

  it('shows a vacant post as vacant, with no name', async () => {
    api.get.mockResolvedValue(ENGINEERING)
    const w = await mountPage('engineering')
    const row = w.findAll('tbody tr').find((r) => r.text().includes('Roads Foreman'))!
    expect(row.text()).toContain('Vacant')
    expect(w.text()).toContain('2 posts, 1 vacant')
  })

  it("says an empty register is empty instead of showing zeros", async () => {
    api.get.mockResolvedValue({ ...ENGINEERING, sections: { engineering: { loaded: false, note: 'The road, water and asset registers have not been loaded yet.' } } })
    const w = await mountPage('engineering')
    expect(w.text()).toContain('have not been loaded yet')
    expect(w.find('dl').exists()).toBe(false)
  })

  it('says a unit with no ward measure has no ward map, and draws none', async () => {
    api.get.mockResolvedValue({
      ...ENGINEERING,
      unit: { key: 'audit', label: 'Internal Audit', post: 'Internal Auditor', desks: [] },
      sections: { audit: { loaded: true, engagements: 2, engagements_open: 2, findings_open: 3, findings_high_risk: 1, actions_overdue: 1 } },
      maps: { ...MAPS, has_measures: false },
    })
    const w = await mountPage('audit')
    expect(w.find('.wm-stub').exists()).toBe(false)
    expect(w.text()).toContain('not tied to a ward')
  })

  it('says human resources is not in the system, with no figures', async () => {
    api.get.mockResolvedValue({
      ...ENGINEERING,
      unit: { key: 'social_admin', label: 'Human Resources, Social Services and Administration', post: 'Human Resources, Social Services & Administration Officer', desks: [] },
      sections: {
        social_services: { loaded: true, premises: 3, certificates_due_or_expired: 0, open_nuisance_complaints: 0 },
        hr: { loaded: false, note: 'Staff and payroll are not yet in the system.' },
      },
    })
    const w = await mountPage('social_admin')
    expect(w.text()).toContain('Staff and payroll are not yet in the system.')
  })

  it('names a vacant head post as vacant', async () => {
    api.get.mockResolvedValue({ ...ENGINEERING, head: { ...ENGINEERING.head!, holder_name: null, vacant: true } })
    const w = await mountPage('engineering')
    expect(w.find('.ud-post').text()).toContain('post vacant')
  })

  it('tells a refused reader the unit is not theirs', async () => {
    api.get.mockRejectedValue({ response: { status: 403 } })
    const w = await mountPage('planning')
    expect(w.find('[role="alert"]').text()).toContain('not yours to open')
  })

  it('gives the Chief Executive a way back to the overview, and nobody else', async () => {
    api.get.mockResolvedValue(ENGINEERING)
    const ceo = await mountPage('engineering')
    expect(ceo.findAll('a').some((a) => a.attributes('href') === '/executive')).toBe(true)
    auth.user = { name: 'Eng', role: 'engineer' }
    const head = await mountPage('engineering')
    expect(head.findAll('a').some((a) => a.attributes('href') === '/executive')).toBe(false)
  })

  it('shows no arrears figure anywhere (decision D13)', async () => {
    api.get.mockResolvedValue(ENGINEERING)
    const w = await mountPage('engineering')
    expect(w.text().toLowerCase()).not.toContain('arrear')
  })
})
