// @vitest-environment happy-dom
//
// The Chief Executive's master plan page is read-only and honest: a plan not yet gazetted says "Not in force", decisions only affirmed for testing are
// shown as that and never as the council's, a missing plan is said to be missing, and the zone list carries the same figures as the map.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ masterPlan: vi.fn() }))
vi.mock('@/services/executiveOverview', () => ({ executiveApi: { masterPlan: api.masterPlan } }))
vi.mock('@/services/gisStyles', () => ({
  getPublishedStyle: vi.fn(async () => ({ definition: { renderer: { categories: [{ label: 'Cemetery', value: 'Cemetery', symbol: { fill: '#c6c6c6' } }] } } })),
}))
vi.mock('vue-router', () => ({ RouterLink: { name: 'RouterLink', props: ['to'], template: '<a :href="to"><slot /></a>' } }))

// the map is not drawn here: a stand-in that records what the page asks of it
const mapCalls = vi.hoisted(() => ({ fit: vi.fn(), visible: vi.fn(), filter: vi.fn(), handlers: {} as Record<string, (e?: unknown) => void> }))
const exported = vi.hoisted(() => ({ table: null as null | { columns: string[]; rows: unknown[][]; totals?: { label: string; cells: unknown[] }; notes?: string[] } }))
vi.mock('@/components/shared/ExportMenu.vue', () => ({
  default: { name: 'ExportMenu', props: ['build', 'filename', 'print'], setup(p: { build: () => never }) { return { grab: () => { exported.table = p.build() } } }, template: '<button data-testid="export" @click="grab">export</button>' },
}))
vi.mock('maplibre-gl', () => {
  class Map {
    constructor() { /* nothing drawn */ }
    addControl() {}
    on(ev: string, fn: (e?: unknown) => void) { mapCalls.handlers[ev] = fn }
    fitBounds(...a: unknown[]) { mapCalls.fit(...a) }
    getLayer() { return {} }
    setFilter(...a: unknown[]) { mapCalls.filter(...a) }
    queryRenderedFeatures() { return [] }
    getCanvas() { return { style: {} } }
    resize() {}
    remove() {}
  }
  const m = { Map, AttributionControl: class {}, NavigationControl: class {} }
  return { default: m, ...m }
})
vi.mock('maplibre-gl/dist/maplibre-gl.css', () => ({}))
vi.mock('@/map/vunguBasemap', () => ({ addVunguBasemap: vi.fn(async () => ({ layerCount: 30 })), setBasemapLayerVisible: mapCalls.visible }))

import ExecutiveMasterPlanView from '../ExecutiveMasterPlanView.vue'
import type { MasterPlan } from '@/services/executiveOverview'

const PLAN: MasterPlan = {
  as_of: '2026-11-15T10:00:00Z',
  plan: { id: 'p', title: 'Vungu RDC peri-urban local plan (as mapped)', version: 1, status: 'unknown', authority: 'Vungu Rural District Council',
    revision_label: 'Rev 005', revision_date: '2026-07-01', map_scale: 120000, gazette_ref: null, effective_from: null, in_force: false, provisional: true },
  adoption: { formal: true, done: 1, of: 3, steps: [
    { code: 'public_notice', label: 'Public notice', done: true },
    { code: 'council_adoption', label: 'Adopted by the Full Council', done: false },
    { code: 'signature:chief_executive', label: 'Chief Executive Officer', done: false, stale: true },
  ] },
  decisions: { uses_in_plan: 38, decided: 817, proposed: 0, affirmed_for_testing: 414, tested_on_affirmation: true },
  zones: [
    { zone: 'Model A2', polygons: 4, hectares: 205112.8, share_pct: 34.5, parcels: 145, permitted: 6, special_consent: 17, prohibited: 15, not_decided: 0, bbox: [29.1, -19.9, 29.9, -19.2] },
    { zone: 'Cemetery', polygons: 1, hectares: 100.4, share_pct: 0, parcels: 3, permitted: 2, special_consent: 3, prohibited: 27, not_decided: 6, bbox: [29.5, -19.3, 29.51, -19.29] },
  ],
  total_hectares: 594845,
  coverage: { parcels: 2320, zoned: 2269, unzoned: 51 },
  applications: { lodged_under_plan: 8, decided: 8, in_progress: 0, departures: 0, proposed_rule_accepted: 0, decided_without_the_plan: 0 },
  held: { facilities: [{ kind: 'school', n: 102 }], land_features: [{ kind: 'mine', n: 41 }], targeted_farms: { targeted: 283, linked: 278 }, retained_zones: 16, railway_lines: 7 },
}

async function mountPage() {
  const w = mount(ExecutiveMasterPlanView)
  await flushPromises()
  return w
}
beforeEach(() => { api.masterPlan.mockReset(); mapCalls.fit.mockReset(); mapCalls.visible.mockReset(); mapCalls.filter.mockReset(); exported.table = null })

describe('ExecutiveMasterPlanView', () => {
  it('says which plan and revision, and that it is not in force', async () => {
    api.masterPlan.mockResolvedValue(PLAN)
    const w = await mountPage()
    expect(w.get('[data-testid=mp-identity]').text()).toContain('Rev 005 · July 2026 · 1:120 000')
    expect(w.get('[data-testid=mp-standing]').text()).toBe('Not in force')
  })

  it('shows decisions only affirmed for testing as that, with the counts', async () => {
    api.masterPlan.mockResolvedValue(PLAN)
    const w = await mountPage()
    const t = w.get('[data-testid=mp-testing]').text()
    expect(t).toContain('affirmed for testing')
    expect(t).toContain('414')
    expect(t).toContain('not the council')
  })

  it('shows no testing banner when nothing is affirmed for testing', async () => {
    api.masterPlan.mockResolvedValue({ ...PLAN, decisions: { ...PLAN.decisions!, affirmed_for_testing: 0, tested_on_affirmation: false } })
    expect((await mountPage()).find('[data-testid=mp-testing]').exists()).toBe(false)
  })

  it('lists the adoption steps, with a stale signature said to be stale', async () => {
    api.masterPlan.mockResolvedValue(PLAN)
    const w = await mountPage()
    const steps = w.get('[data-testid=mp-steps]').text()
    expect(steps).toContain('Adopted by the Full Council')
    expect(steps).toContain('signed, then the plan changed')
    expect(w.text()).toContain('Adoption: 1 of 3 steps')
  })

  it('lists every zone with its area and parcels, and selecting one gives what the plan decides there and zooms the map to it', async () => {
    api.masterPlan.mockResolvedValue(PLAN)
    const w = await mountPage()
    const list = w.get('[data-testid=mp-zonelist]')
    expect(list.text()).toContain('Model A2')
    expect(list.text()).toContain('145 parcels')
    // the list is a table with a total, and no inner scroll hides a zone
    expect(list.element.tagName).toBe('TABLE')
    expect(w.get('[data-testid=mp-ztotal]').text()).toContain('3 parcels'.replace('3', '148'))
    expect(w.find('[data-testid=mp-zone-detail]').exists()).toBe(false)
    await list.findAll('button')[1].trigger('click')
    const d = w.get('[data-testid=mp-zone-detail]').text()
    expect(d).toContain('Cemetery')
    expect(d).toContain('Not decided')   // six uses the plan has not decided there, never shown as allowed
    expect(mapCalls.fit).toHaveBeenCalledTimes(1)
  })

  it('reports the coverage of the register, and how the plan is working in applications', async () => {
    api.masterPlan.mockResolvedValue(PLAN)
    const w = await mountPage()
    expect(w.get('[data-testid=mp-coverage]').text()).toContain('2,269')
    expect(w.get('[data-testid=mp-coverage]').text()).toContain('51')
    expect(w.get('[data-testid=mp-applications]').text()).toContain('Applications lodged under the plan8')
    expect(w.get('[data-testid=mp-held]').text()).toContain('Schools102')
    expect(w.get('[data-testid=mp-held]').text()).toContain('Targeted farms283 (278 linked to the register)')
  })

  it('keeps the land features on while either of its two switches is on, and filters to the kinds that are', async () => {
    api.masterPlan.mockResolvedValue(PLAN)
    const w = await mountPage()
    const box = (label: string) => w.findAll('input[type=checkbox]').find((c) => c.element.parentElement?.textContent?.includes(label))!
    // the fill and its outline are filtered together
    const filtered = (filter: unknown) => expect(mapCalls.filter.mock.calls.slice(-2)).toEqual([['vungu-vungu_land_features', filter], ['vungu-vungu_land_features-outline', filter]])
    mapCalls.visible.mockReset(); mapCalls.filter.mockReset()
    await box('Mines, quarries').setValue(false)               // only the proposed new city remains
    expect(mapCalls.visible).toHaveBeenLastCalledWith(expect.anything(), 'vungu_land_features', true)
    filtered(['==', ['get', 'kind'], 'proposed_new_city'])
    await box('Proposed new city').setValue(false)              // neither: the layer is hidden
    expect(mapCalls.visible).toHaveBeenLastCalledWith(expect.anything(), 'vungu_land_features', false)
    await box('Mines, quarries').setValue(true)                 // the other kinds, not the city
    filtered(['!=', ['get', 'kind'], 'proposed_new_city'])
    await box('Proposed new city').setValue(true)               // both: no filter
    filtered(null)
  })

  it('switches another map layer from its toggle', async () => {
    api.masterPlan.mockResolvedValue(PLAN)
    const w = await mountPage()
    mapCalls.visible.mockReset()
    const box = w.findAll('input[type=checkbox]').find((c) => c.element.parentElement?.textContent?.includes('Railway lines'))!
    await box.setValue(false)
    expect(mapCalls.visible).toHaveBeenCalledWith(expect.anything(), 'vungu_railway', false)
  })

  it('exports the zones with the standing, the total and the testing caveat, so the file says what it is', async () => {
    api.masterPlan.mockResolvedValue(PLAN)
    const w = await mountPage()
    const buttons = w.findAll('[data-testid=export]')
    await buttons[buttons.length - 1].trigger('click')
    const t = exported.table!
    expect(t.columns).toEqual(['Zone', 'Area (ha)', 'Share of the plan (%)', 'Parcels', 'Uses permitted', 'By special consent', 'Not allowed', 'Not decided'])
    expect(t.rows).toHaveLength(2)
    expect(t.totals?.label).toBe('Total')
    expect(t.notes!.join(' ')).toContain('Not in force')
    expect(t.notes!.join(' ')).toContain('affirmed for testing')
  })

  it('says so when the council has no plan, and when the plan cannot be read, and has no way to change anything', async () => {
    api.masterPlan.mockResolvedValue({ as_of: PLAN.as_of, plan: null })
    const none = await mountPage()
    expect(none.get('[data-testid=mp-no-plan]').text()).toContain('no master plan on record')
    api.masterPlan.mockRejectedValue(new Error('x'))
    const failed = await mountPage()
    expect(failed.text()).toContain('could not be read')
    for (const w of [none, failed]) expect(w.findAll('button').filter((b) => !/try again/i.test(b.text()) && b.attributes('data-testid') !== 'export')).toHaveLength(0)
  })

  it('offers nothing that changes the plan: no sign, approve or adopt action', async () => {
    api.masterPlan.mockResolvedValue(PLAN)
    const w = await mountPage()
    expect(w.text()).not.toMatch(/\b(sign off|approve this|adopt this|gazette this)\b/i)
    expect(w.findAll('button').map((b) => b.text()).filter((t) => /sign|approve|adopt|gazette/i.test(t))).toEqual([])   // exporting is not changing
  })
})
