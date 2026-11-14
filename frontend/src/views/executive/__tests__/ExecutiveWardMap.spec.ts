// @vitest-environment happy-dom
//
// "Ward by ward" draws what the server computed and nothing more. This pins the rules the design rests on:
// the provisional-ward notice while decision D11 is open, the same figures in the list as on the map, a ward
// with no figure or a small base shown as such (never as a low value), no canvas at all when there are no wards
// or no computed values, a failed read said plainly, and the classification method disclosed.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({ index: vi.fn(), map: vi.fn() }))
vi.mock('@/services/spatialEngine', () => ({ spatialEngineApi: { index: api.index, map: api.map } }))

// MapLibre needs WebGL, which happy-dom does not have; the component's own logic is what is under test.
const created = vi.hoisted(() => ({ maps: [] as unknown[] }))
vi.mock('maplibre-gl', () => {
  class Map {
    private container: unknown
    constructor(opts: { container: unknown }) { this.container = opts.container; created.maps.push(this) }
    loaded() { return true }
    once(_e: string, cb: () => void) { cb() }
    on() {}
    addControl() {}
    addSource() {}
    addLayer() {}
    getSource() { return { setData: () => {} } }
    setPaintProperty() {}
    setFilter() {}
    fitBounds() {}
    getContainer() { return this.container }
    getCanvas() { return { style: {} } }
    remove() {}
  }
  class NavigationControl {}
  return { default: { Map, NavigationControl } }
})

import ExecutiveWardMap from '../ExecutiveWardMap.vue'
import type { MapsIndex, WardMap, WardFeature } from '@/services/spatialEngine'

const REGISTER = { linked: true, wards: 3, basis: 'interim', instrument_ref: 'PROVISIONAL-D11' }
const INDEX: MapsIndex = {
  ward_register: REGISTER,
  run: { id: 'r1', computed_at: '2026-11-13T18:07:32Z', wards: 3, ward_register_basis: 'interim' },
  measures: [
    { measure_key: 'parcel_account_coverage', label: 'Parcels with a rates account', description: 'The share of parcels with an account.', unit: '% of parcels', kind: 'share', direction: 'higher_is_better', ramp: 'sequential', owner_dept: 'Finance and Planning', source_note: 'land.parcel and revenue_link.account_link.' },
    { measure_key: 'parcel_density', label: 'Registered parcels per km²', description: 'Parcels per square kilometre.', unit: 'parcels per km²', kind: 'density', direction: 'neutral', ramp: 'sequential', owner_dept: 'Planning and Survey', source_note: 'land.parcel.' },
  ],
}

const poly = { type: 'Polygon', coordinates: [[[29, -19], [30, -19], [30, -20], [29, -20], [29, -19]]] } as GeoJSON.Geometry
const ward = (code: string, name: string, p: Partial<WardFeature['properties']>): WardFeature => ({
  type: 'Feature', geometry: poly,
  properties: { ward_code: code, name, value: null, raw_value: null, numerator: null, denominator: null, reliability: 'no_data', rank: null, class_index: null, ...p },
})

const MAP: WardMap = {
  measure: { key: 'parcel_account_coverage', label: 'Parcels with a rates account', description: 'The share of parcels with an account.', unit: '% of parcels', kind: 'share', direction: 'higher_is_better', ramp: 'sequential', owner_dept: 'Finance and Planning', source_note: 'land.parcel and revenue_link.account_link.', min_denominator: 10 },
  ward_register: REGISTER,
  reason: null,
  classes: { method: 'fixed', breaks: [25, 50, 75], classes: 4 },
  ranked: 2,
  run: { computed_at: '2026-11-13T18:07:32Z', unlocated: 306, facts: 2320 },
  features: [
    ward('Z1', '1', { value: 87.4, raw_value: 87.4, numerator: 90, denominator: 103, reliability: 'ok', rank: 1, class_index: 3 }),
    ward('Z2', '2', { value: 12, raw_value: 12, numerator: 12, denominator: 100, reliability: 'ok', rank: 2, class_index: 0 }),
    ward('Z3', '3', { value: null, raw_value: 0, numerator: 0, denominator: 4, reliability: 'small_base', rank: null, class_index: null }),
    ward('Z4', '4', {}),
  ],
}

async function mountPage() {
  const wrapper = mount(ExecutiveWardMap)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  api.index.mockReset()
  api.map.mockReset()
  created.maps.length = 0
  api.index.mockResolvedValue(INDEX)
  api.map.mockResolvedValue(MAP)
})

describe('ExecutiveWardMap', () => {
  it('says the ward boundaries are provisional while the ward list is interim', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('.wm-note--provisional').text()).toContain('provisional')
    expect(wrapper.find('.wm-note--provisional').text()).toContain('D11')
  })

  it('does not call the list provisional once the Council has confirmed it', async () => {
    api.index.mockResolvedValue({ ...INDEX, ward_register: { ...REGISTER, basis: 'proclamation' } })
    api.map.mockResolvedValue({ ...MAP, ward_register: { ...REGISTER, basis: 'proclamation' } })
    const wrapper = await mountPage()
    expect(wrapper.find('.wm-note--provisional').exists()).toBe(false)
  })

  it('offers the measures and loads the first one', async () => {
    const wrapper = await mountPage()
    expect(wrapper.findAll('.wm-measure').map((l) => l.text())).toEqual(['Parcels with a rates account', 'Registered parcels per km²'])
    expect(api.map).toHaveBeenCalledWith('parcel_account_coverage')
  })

  it('loads the map for a measure when it is chosen', async () => {
    const wrapper = await mountPage()
    await wrapper.findAll('input[type="radio"]')[1].setValue(true)
    await flushPromises()
    expect(api.map).toHaveBeenLastCalledWith('parcel_density')
  })

  it('ranks wards and shows a small base or no data as such, never as a low value', async () => {
    const wrapper = await mountPage()
    const rows = wrapper.findAll('.wm-table tbody tr').map((r) => r.findAll('td, th').map((c) => c.text()))
    expect(rows[0]).toEqual(['1', '1', '87.4%'])
    expect(rows[1]).toEqual(['2', '2', '12%'])
    // Ward 3 has a computed value (0%) on a base of 4 parcels: shown, but flagged, unranked and unclassified.
    expect(rows[2][0]).toBe('—')
    expect(rows[2][2]).toContain('small base, not classified')
    // Ward 4 has no figure: no data, not 0%.
    expect(rows[3][2]).toContain('no data')
    expect(rows[3][2]).not.toContain('0%')
  })

  it('writes the legend from the disclosed breaks, in the measure\'s unit', async () => {
    const wrapper = await mountPage()
    expect(wrapper.findAll('.wm-legend li').map((l) => l.text())).toEqual([
      'under 25%', '25% to under 50%', '50% to under 75%', '75% or more', 'No data or small base',
    ])
  })

  it('discloses how the classes were decided, the source and what could not be placed', async () => {
    const wrapper = await mountPage()
    const foot = wrapper.find('.wm-foot').text()
    expect(foot).toContain('fixed thresholds')
    expect(foot).toContain('Source: land.parcel')
    expect(foot).toContain('306 of 2,320 records could not be placed')
    expect(foot).toContain('compare the values, not the areas')
  })

  it('draws a map when there is something to draw', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('.wm-canvas').exists()).toBe(true)
    expect(created.maps.length).toBe(1)
  })

  it('draws no canvas and says why when no wards are loaded', async () => {
    api.map.mockResolvedValue({ ...MAP, reason: 'ward_register_empty', features: [], classes: null, run: null, ward_register: { linked: false, wards: 0, basis: null, instrument_ref: null } })
    const wrapper = await mountPage()
    expect(wrapper.find('.wm-canvas').exists()).toBe(false)
    expect(wrapper.text()).toContain("wards have not been loaded")
    expect(created.maps.length).toBe(0)
  })

  it('draws no canvas and says why when the measures have not been computed', async () => {
    api.map.mockResolvedValue({ ...MAP, reason: 'not_computed', classes: { method: 'quantile', breaks: [], classes: 0 }, run: null })
    const wrapper = await mountPage()
    expect(wrapper.find('.wm-canvas').exists()).toBe(false)
    expect(wrapper.text()).toContain('have not been computed')
  })

  it('shows an alert, not an empty map, when the measures cannot be read', async () => {
    api.index.mockRejectedValue(new Error('network'))
    const wrapper = await mountPage()
    expect(wrapper.find('[role="alert"]').text()).toContain('could not be read')
    expect(wrapper.find('.wm-canvas').exists()).toBe(false)
  })

  it('keeps the map reachable without a pointer: a labelled radio group and a captioned table', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('[role="radiogroup"]').attributes('aria-label')).toBe('Measure to map')
    expect(wrapper.find('caption').exists()).toBe(true)
    expect(wrapper.find('.wm-canvas').attributes('aria-label')).toContain('Map of 4 wards')
  })
})
