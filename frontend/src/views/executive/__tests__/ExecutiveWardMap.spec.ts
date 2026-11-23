// @vitest-environment happy-dom
//
// "Ward by ward" draws what the server computed and nothing more. This pins the rules the design rests on:
// the provisional-ward notice while decision D11 is open, the same figures in the list as on the map, a ward
// with no figure or a small base shown as such (never as a low value), no canvas at all when there are no wards
// or no computed values, a failed read said plainly, and the classification method disclosed.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

const api = vi.hoisted(() => ({
  index: vi.fn(), map: vi.fn(), wardProfile: vi.fn(), unitIndex: vi.fn(), unitMap: vi.fn(),
}))
vi.mock('@/services/spatialEngine', () => ({ spatialEngineApi: { index: api.index, map: api.map, wardProfile: api.wardProfile } }))
vi.mock('@/services/units', () => ({ unitsApi: { mapsIndex: api.unitIndex, map: api.unitMap } }))
vi.mock('vue-router', () => ({ RouterLink: { name: 'RouterLink', props: ['to'], template: '<a :href="to"><slot /></a>' } }))

// MapLibre needs WebGL, which happy-dom does not have; the component's own logic is what is under test.
type Handler = { event: string; layer: string | null; cb: (e: unknown) => void }
const created = vi.hoisted(() => ({ maps: [] as any[], hit: [] as unknown[] }))
vi.mock('maplibre-gl', () => {
  class Map {
    private container: unknown
    handlers: Handler[] = []
    fits: unknown[][] = []
    filters: unknown[][] = []
    constructor(opts: { container: unknown }) { this.container = opts.container; created.maps.push(this) }
    loaded() { return true }
    once(_e: string, cb: () => void) { cb() }
    // map.on(event, cb) or map.on(event, layer, cb): kept so a test can fire a click.
    on(event: string, a: string | ((e: unknown) => void), b?: (e: unknown) => void) {
      this.handlers.push(typeof a === 'string' ? { event, layer: a, cb: b as (e: unknown) => void } : { event, layer: null, cb: a })
    }
    queryRenderedFeatures() { return created.hit }
    addControl() {}
    addSource() {}
    addLayer() {}
    getSource() { return { setData: () => {} } }
    setPaintProperty() {}
    setFilter(...a: unknown[]) { this.filters.push(a) }
    fitBounds(...a: unknown[]) { this.fits.push(a) }
    getContainer() { return this.container }
    getCanvas() { return { style: {} } }
    remove() {}
  }
  class NavigationControl {}
  return { default: { Map, NavigationControl }, Map, NavigationControl }
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

async function mountPage(props: { unitKey?: 'engineering' } = {}) {
  const wrapper = mount(ExecutiveWardMap, { props })
  await flushPromises()
  return wrapper
}

const scrollTo = vi.fn()
const lastMap = () => created.maps[created.maps.length - 1]
const fire = (event: string, layer: string | null, e: unknown) =>
  lastMap().handlers.filter((h: Handler) => h.event === event && h.layer === layer).forEach((h: Handler) => h.cb(e))

beforeEach(() => {
  scrollTo.mockReset()
  ;(Element.prototype as unknown as { scrollTo: unknown }).scrollTo = scrollTo
  created.hit = []
  api.index.mockReset()
  api.map.mockReset()
  api.wardProfile.mockReset()
  api.unitIndex.mockReset()
  api.unitMap.mockReset()
  api.wardProfile.mockRejectedValue(new Error('not under test'))
  api.unitIndex.mockResolvedValue(INDEX)
  api.unitMap.mockResolvedValue(MAP)
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

describe('ExecutiveWardMap selection', () => {
  const rowOf = (w: ReturnType<typeof mount>, code: string) => w.find(`tr[data-ward="${code}"]`)

  it('shows a prompt, not an empty panel, until a ward is chosen', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('.wm-detail').text()).toContain('Click a ward on the map or in the list')
  })

  it('pins the selected ward\'s figures above the list, outside the part that scrolls', async () => {
    const wrapper = await mountPage()
    await rowOf(wrapper, 'Z1').trigger('click')
    expect(wrapper.find('.wm-list-col > .wm-detail').exists()).toBe(true)
    expect(wrapper.find('.wm-list-scroll .wm-detail').exists()).toBe(false)
    const detail = wrapper.find('.wm-detail').text()
    expect(detail).toContain('Ward 1')
    expect(detail).toContain('87.4%')
    expect(detail).toContain('Rank 1 of 2')
    expect(detail).toContain('90 of 103')
    expect(detail).toContain('Shaded: 75% or more')
  })

  it('clicking a list row selects the ward and zooms the map to it', async () => {
    const wrapper = await mountPage()
    const before = lastMap().fits.length
    await rowOf(wrapper, 'Z2').trigger('click')
    expect(rowOf(wrapper, 'Z2').attributes('aria-current')).toBe('true')
    expect(rowOf(wrapper, 'Z2').classes()).toContain('is-selected')
    expect(lastMap().fits.length).toBe(before + 1)
    const [bounds, opts] = lastMap().fits[lastMap().fits.length - 1] as [unknown, { maxZoom: number }]
    expect(bounds).toEqual([[29, -20], [30, -19]])
    expect(opts.maxZoom).toBe(10)
    expect(lastMap().filters[lastMap().filters.length - 1]).toEqual(['wards-selected', ['==', ['get', 'ward_code'], 'Z2']])
  })

  it('a row is reachable and selectable from the keyboard', async () => {
    const wrapper = await mountPage()
    expect(rowOf(wrapper, 'Z1').attributes('tabindex')).toBe('0')
    await rowOf(wrapper, 'Z1').trigger('keydown', { key: 'Enter' })
    expect(rowOf(wrapper, 'Z1').attributes('aria-current')).toBe('true')
  })

  it('clicking a ward on the map selects it and scrolls the list to its row, without moving the map', async () => {
    const wrapper = await mountPage()
    const before = lastMap().fits.length
    fire('click', 'wards-fill', { features: [{ properties: { ward_code: 'Z2' } }] })
    await flushPromises()
    expect(rowOf(wrapper, 'Z2').attributes('aria-current')).toBe('true')
    expect(wrapper.find('.wm-detail').text()).toContain('Ward 2')
    expect(scrollTo).toHaveBeenCalled()
    expect(lastMap().fits.length).toBe(before) // the user is already looking at the ward: no zoom
  })

  it('says why a ward without a figure is not ranked', async () => {
    const wrapper = await mountPage()
    await rowOf(wrapper, 'Z3').trigger('click')
    expect(wrapper.find('.wm-detail').text()).toContain('Not ranked: the base is too small')
    await rowOf(wrapper, 'Z4').trigger('click')
    expect(wrapper.find('.wm-detail').text()).toContain('Not ranked: no data')
  })

  it('clicking empty map clears the selection', async () => {
    const wrapper = await mountPage()
    await rowOf(wrapper, 'Z1').trigger('click')
    created.hit = []
    fire('click', null, { point: { x: 1, y: 1 } })
    await flushPromises()
    expect(wrapper.find('.wm-detail').text()).toContain('Click a ward on the map or in the list')
    expect(rowOf(wrapper, 'Z1').attributes('aria-current')).toBeUndefined()
  })

  it('a click that lands on a ward does not clear the selection', async () => {
    const wrapper = await mountPage()
    await rowOf(wrapper, 'Z1').trigger('click')
    created.hit = [{}]
    fire('click', null, { point: { x: 1, y: 1 } })
    await flushPromises()
    expect(rowOf(wrapper, 'Z1').attributes('aria-current')).toBe('true')
  })

  it('"Show all wards" appears with a selection, returns the whole district and clears it', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('.wm-reset').exists()).toBe(false)
    await rowOf(wrapper, 'Z1').trigger('click')
    const before = lastMap().fits.length
    await wrapper.find('.wm-reset').trigger('click')
    expect(lastMap().fits.length).toBe(before + 1)
    expect(wrapper.find('.wm-reset').exists()).toBe(false)
    expect(wrapper.find('.wm-detail').text()).toContain('Click a ward')
  })

  it('keeps the selected ward when another measure is chosen, so one ward can be compared across measures', async () => {
    const wrapper = await mountPage()
    await rowOf(wrapper, 'Z1').trigger('click')
    await wrapper.findAll('input[type="radio"]')[1].setValue(true)
    await flushPromises()
    expect(rowOf(wrapper, 'Z1').attributes('aria-current')).toBe('true')
    expect(wrapper.find('.wm-detail').text()).toContain('Ward 1')
  })
})

describe('the unit drill-down', () => {
  const rowOf = (w: ReturnType<typeof mount>, code: string) => w.find(`tr[data-ward="${code}"]`)

  const PROFILE = {
    ward: { ward_code: 'Z1', name: '1', basis: 'interim', area_km2: 10 },
    computed_at: null,
    units: {
      engineering: [{ measure_key: 'water_points_working', label: 'Water points working', unit: '% working', kind: 'share', direction: 'higher_is_better',
        unit_key: 'engineering', owner_dept: 'Engineering', value: 66.7, raw_value: 66.7, numerator: 2, denominator: 3, reliability: 'ok', rank: 1, ranked: 2 }],
      social_admin: [{ measure_key: 'premises_certified', label: 'Health premises with a valid fitness certificate', unit: '% certified', kind: 'share', direction: 'higher_is_better',
        unit_key: 'social_admin', owner_dept: 'Social Services', value: null, raw_value: null, numerator: null, denominator: null, reliability: 'no_data', rank: null, ranked: 0 }],
    },
  }

  it("reads the selected ward across every unit and links into each unit, saying 'no data' where there is none", async () => {
    api.wardProfile.mockResolvedValue(PROFILE)
    const wrapper = await mountPage()
    await rowOf(wrapper, 'Z1').trigger('click')
    await flushPromises()
    expect(api.wardProfile).toHaveBeenCalledWith('Z1')
    const profile = wrapper.find('.wm-profile')
    expect(profile.text()).toContain('Water points working')
    expect(profile.text()).toContain('66.7%')
    expect(profile.text()).toContain('rank 1 of 2')
    expect(profile.text()).toContain('no data')
    expect(profile.findAll('a').map((a) => a.attributes('href')).sort()).toEqual(['/units/engineering', '/units/social_admin'])
  })

  it('says so when the ward profile cannot be read, without hiding the ward map', async () => {
    const wrapper = await mountPage()
    await rowOf(wrapper, 'Z1').trigger('click')
    await flushPromises()
    expect(wrapper.find('.wm-profile').text()).toContain('could not be read just now')
    expect(wrapper.find('.wm-detail').text()).toContain('Ward 1')
  })

  it("on a unit's own dashboard it reads only that unit's measures and offers no cross-unit profile", async () => {
    const wrapper = await mountPage({ unitKey: 'engineering' })
    expect(api.unitIndex).toHaveBeenCalledWith('engineering')
    expect(api.unitMap).toHaveBeenCalledWith('engineering', 'parcel_account_coverage')
    expect(api.index).not.toHaveBeenCalled()
    await rowOf(wrapper, 'Z1').trigger('click')
    await flushPromises()
    expect(api.wardProfile).not.toHaveBeenCalled()
    expect(wrapper.find('.wm-profile').exists()).toBe(false)
  })
})

describe('a measure over an incomplete register', () => {
  it('says so, and says what a blank ward means', async () => {
    api.map.mockResolvedValue({
      ...MAP,
      measure: {
        ...MAP.measure,
        incomplete_register: {
          register: 'water_points', complete: false, expected_count: 360, source: 'website',
          note: 'The register holds only a few demonstration points; the council website lists about 360 water points.',
        },
      },
    })
    const wrapper = await mountPage()
    const note = wrapper.find('.wm-note--incomplete')
    expect(note.exists()).toBe(true)
    expect(note.text()).toContain('incomplete register')
    expect(note.text()).toContain('about 360 water points')
    expect(note.text()).toContain('no data, not zero')
  })

  it('shows no such note for a complete register', async () => {
    const wrapper = await mountPage()
    expect(wrapper.find('.wm-note--incomplete').exists()).toBe(false)
  })
})
