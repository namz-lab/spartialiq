// @vitest-environment happy-dom
// The EO map answers "what is here" on click — the query an officer makes most
// often. Two things must hold: the registers are asked for the clicked point,
// and a map tool that consumes clicks (measure, notification radius) suppresses
// the query instead of firing one identify per measured vertex.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, computed } from 'vue'

const clickHandlers: Array<(e: any) => void> = []
// What the basemap layers would return under the cursor.
let renderedHits: any[] = []

vi.mock('maplibre-gl', () => ({
  default: {
    Map: class {
      on(ev: string, a: any, b?: any) { if (ev === 'click' && typeof a === 'function') clickHandlers.push(a); void b }
      addControl() {} remove() {} flyTo() {} getZoom() { return 10 }
      getSource() { return { setData() {} } }
      getLayer() { return null }
      addSource() {} addLayer() {} setLayoutProperty() {}
      getCanvas() { return { style: {} } }
      container = document.createElement('div')
      getContainer() { return this.container }
      getStyle() { return { layers: [{ id: 'vungu-roads' }, { id: 'vungu-landuse' }] } }
      queryRenderedFeatures() { return renderedHits }
      project() { return { x: 100, y: 100 } }
      doubleClickZoom = { enable() {}, disable() {} }
    },
    NavigationControl: class {}, ScaleControl: class {},
    Marker: class { setLngLat() { return this } setPopup() { return this } addTo() { return this } remove() {} },
    Popup: class { setHTML() { return this } },
  },
}))
// The real pickTopHit is kept: layer priority is what decides which feature a
// click is about, so a stub would make the attribute test meaningless.
vi.mock('@/map/vunguBasemap', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  addVunguBasemap: vi.fn(),
  setBasemapLayerVisible: vi.fn(),
  DEFAULT_VISIBLE: new Set<string>(),
  prefersReducedMotion: () => true,
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ path: '/eo-planner-portal', params: {}, query: {}, name: 'eo-planner-portal' }),
  RouterLink: { template: '<a><slot /></a>' },
}))
// Stores are mocked outright: this spec is about the map query, not the spine.
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ logout: vi.fn() }) }))
vi.mock('@/stores/spatial', () => ({
  useSpatialStore: () => ({
    tileLayers: [], isLoading: false, visibleTileLayers: new Set<string>(),
    loadTileLayers: vi.fn(), toggleTileLayer: vi.fn(),
  }),
}))

const apiGet = vi.fn(async () => ({ data: { success: true, data: [] } }))
vi.mock('@/services/api', () => ({ default: { get: (...a: any[]) => apiGet(...a), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))

const identify = vi.fn()
vi.mock('@/services/inspectorGis', () => ({
  inspectorGis: {
    identify: (...a: any[]) => identify(...a),
    sites: vi.fn().mockResolvedValue({
      points: { type: 'FeatureCollection', features: [] },
      boundaries: { type: 'FeatureCollection', features: [] },
      enforcement: { type: 'FeatureCollection', features: [] },
      unlocated: 0,
    }),
    siteReport: vi.fn(),
  },
}))
vi.mock('@/composables/useEoCommandCentre', () => ({
  parseWard: (s: string) => ({ key: s || 'unknown', label: s || 'Unassigned ward' }),
  useEoCommandCentre: () => ({
    permits: ref([]), enforcement: ref([]), loading: ref(false), error: ref(null),
    metrics: computed(() => ({ pendingApprovals: 0, activeProjects: 0, envViolations: 0, avgTurnaroundDays: null })),
    queue: computed(() => []), proposals: computed(() => []), wardActivity: computed(() => []),
    staffWorkload: computed(() => []), violations: computed(() => []), urgentCount: computed(() => 0),
    refresh: vi.fn(), decide: vi.fn(),
  }),
}))

import EOPlannerView from '../EOPlannerView.vue'

const IDENTIFY_RESULT = {
  point: [29.81, -19.45],
  jurisdiction: { inJurisdiction: true, district: 'Gweru', ward: 'Ward 3' },
  stand: null, parcel: null, zone: null, building: null,
  cases: [], enforcement: [], assessment: 'no_case', radiusM: 60,
}

async function mountView() {
  clickHandlers.length = 0
  const w = mount(EOPlannerView, {
    props: { embedded: true },
    global: { stubs: { Teleport: true } },
  })
  await new Promise(r => setTimeout(r, 0))
  return w
}

describe('EO planner map — identify on click', () => {
  beforeEach(() => { identify.mockReset(); identify.mockResolvedValue(IDENTIFY_RESULT) })

  it('asks the registers what is at the clicked point', async () => {
    const w = await mountView()
    expect(clickHandlers.length).toBeGreaterThan(0)
    clickHandlers.forEach(h => h({ lngLat: { lng: 29.81, lat: -19.45 }, point: { x: 100, y: 100 } }))
    await new Promise(r => setTimeout(r, 0))
    expect(identify).toHaveBeenCalledWith(29.81, -19.45)
    expect(w.text()).toContain('What is here')
  })

  it('stands down while a map tool owns the click', async () => {
    const w = await mountView()
    ;(w.vm as any).activeMapTool = 'measure'
    await w.vm.$nextTick()
    clickHandlers.forEach(h => h({ lngLat: { lng: 29.81, lat: -19.45 }, point: { x: 100, y: 100 } }))
    await new Promise(r => setTimeout(r, 0))
    expect(identify).not.toHaveBeenCalled()
  })
})

// The zones tab reads the spatial register (GET /zones, a FeatureCollection) —
// not the flat development-control list, which carries no geometry, ward or
// area and left the detail grid blank.
describe('EO planner map — basemap attributes', () => {
  beforeEach(() => {
    identify.mockReset(); identify.mockResolvedValue(IDENTIFY_RESULT)
    renderedHits = [{
      layer: { id: 'vungu-roads' }, id: 42,
      properties: { fid: 42, fclass: 'primary', name: 'Gweru Road', length_km: 12.3456, bridge: '', maxspeed: 80 },
    }]
  })

  it('shows the attributes of the feature under the click', async () => {
    const w = await mountView()
    clickHandlers.forEach(h => h({ lngLat: { lng: 29.81, lat: -19.45 }, point: { x: 100, y: 100 } }))
    await new Promise(r => setTimeout(r, 0))
    const text = w.text()
    expect(text).toContain('Roads')          // layer id humanised — no catalog in this spec
    expect(text).toContain('Gweru Road')
    expect(text).toContain('Primary')        // classes humanised
    expect(text).toContain('12.35')          // fractions rounded
    expect(text).toContain('80')             // integers left alone
    expect(text).not.toContain('Bridge')     // blank attributes dropped
  })

  it('prints a stand price as money, not as stored cents', async () => {
    renderedHits = [{
      layer: { id: 'vungu-stands' }, id: 7,
      properties: { fid: 7, stand_number: 'HDR-001', price_usd_cents: 4500000, area_ha: 0.0425 },
    }]
    const w = await mountView()
    clickHandlers.forEach(h => h({ lngLat: { lng: 29.81, lat: -19.45 }, point: { x: 100, y: 100 } }))
    await new Promise(r => setTimeout(r, 0))
    const text = w.text()
    expect(text).toContain('USD 45,000.00')
    expect(text).toContain('HDR-001')
    expect(text).not.toContain('4500000')
  })

  it('drops the previous feature when the next click hits bare ground', async () => {
    const w = await mountView()
    clickHandlers.forEach(h => h({ lngLat: { lng: 29.81, lat: -19.45 }, point: { x: 100, y: 100 } }))
    await new Promise(r => setTimeout(r, 0))
    expect(w.text()).toContain('Gweru Road')
    renderedHits = []
    clickHandlers.forEach(h => h({ lngLat: { lng: 29.9, lat: -19.5 }, point: { x: 120, y: 120 } }))
    await new Promise(r => setTimeout(r, 0))
    expect(w.text()).not.toContain('Gweru Road')
  })
})

describe('EO planner map — zones', () => {
  it('maps the zone FeatureCollection, keeping geometry and centroid', async () => {
    apiGet.mockImplementation(async (url: string) => {
      if (url === '/zones') {
        return { data: { type: 'FeatureCollection', features: [
          { type: 'Feature', id: 29,
            geometry: { type: 'Polygon', coordinates: [[[29.8, -19.6], [29.82, -19.6], [29.81, -19.62], [29.8, -19.6]]] },
            properties: { id: 29, zone: 'Cemetry', zoneCode: '29', zoneType: 'peri_urban', ward: 'Ward 2',
              areaHa: 41.1, isActive: true, centroid: [29.81, -19.61] } },
          { type: 'Feature', id: 30, geometry: null,
            properties: { id: 30, zone: 'Unmapped', centroid: [null, null], isActive: false } },
        ] } }
      }
      return { data: { success: true, data: [] } }
    })
    const w = await mountView()
    await (w.vm as any).loadZones()
    const zones = (w.vm as any).zonesList
    expect(zones).toHaveLength(2)
    expect(zones[0]).toMatchObject({ id: 29, zone: 'Cemetry', ward: 'Ward 2', areaHa: 41.1 })
    expect(zones[0].centroid).toEqual([29.81, -19.61])
    expect(zones[0].geometry.type).toBe('Polygon')
    // A zone with no geometry must not hand MapLibre a half-null centre.
    expect(zones[1].centroid).toBeNull()
  })
})
