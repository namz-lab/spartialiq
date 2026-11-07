import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addVunguBasemap, PLANNER_BASEMAP_DEFAULT } from '../vunguBasemap'

vi.mock('@/services/vectorTiles', () => ({
  tileUrlTemplate: (id: string) => `/api/tiles/${id}/{z}/{x}/{y}.pbf`,
  getTileLayerCatalog: vi.fn(),
  getFeature: vi.fn(),
}))
import { getTileLayerCatalog } from '@/services/vectorTiles'

// The basemap resolves its cartography from the GIS symbology registry. In the
// test environment there is no HTTP backend, so without this mock the registry
// fetch fails with "Invalid URL", every layer falls into diagnostic-grey
// unresolved mode, and these assertions about the real compiled layers fail.
vi.mock('@/services/gisStyles', () => {
  const published = [
    {
      layerId: 'provinces',
      displayName: 'Provinces',
      geometry: 'polygon',
      styleId: 'provinces-v1',
      styleName: 'Provinces',
      styleVersion: 1,
      status: 'published',
      source: 'statutory_schedule',
      sourcePath: null,
      rendererType: 'categorized',
      classificationAttribute: 'name',
      fidelity: 'direct',
      fidelityNotes: [],
      checksum: 'sha-provinces',
      opacity: 1,
      minZoom: null,
      maxZoom: null,
      approvedBy: null,
      publishedBy: null,
      stylePublishedAt: null,
      dataSyncedAt: null,
      dataSource: null,
      qgisProject: null,
      qgisLayer: null,
      renderStrategy: 'vector',
      renderNotes: [],
      definition: {},
      maplibre: [
        { id: 'vungu-provinces', type: 'fill', source: 'vungu-provinces', 'source-layer': 'provinces', minzoom: 0, maxzoom: 22, paint: { 'fill-color': '#ddd8a8' } },
        { id: 'vungu-provinces-label', type: 'symbol', source: 'vungu-provinces', 'source-layer': 'provinces', minzoom: 0, maxzoom: 22, paint: {}, layout: { 'text-field': ['get', 'name'], 'text-size': 11 } },
      ],
    },
    {
      layerId: 'roads',
      displayName: 'Roads',
      geometry: 'line',
      styleId: 'roads-v1',
      styleName: 'Roads',
      styleVersion: 1,
      status: 'published',
      source: 'statutory_schedule',
      sourcePath: null,
      rendererType: 'categorized',
      classificationAttribute: 'fclass',
      fidelity: 'direct',
      fidelityNotes: [],
      checksum: 'sha-roads',
      opacity: 1,
      minZoom: null,
      maxZoom: null,
      approvedBy: null,
      publishedBy: null,
      stylePublishedAt: null,
      dataSyncedAt: null,
      dataSource: null,
      qgisProject: null,
      qgisLayer: null,
      renderStrategy: 'vector',
      renderNotes: [],
      definition: {},
      maplibre: [
        { id: 'vungu-roads', type: 'line', source: 'vungu-roads', 'source-layer': 'roads', minzoom: 8, maxzoom: 22, paint: { 'line-color': '#444444' } },
      ],
    },
  ]
  return {
    getPublishedStylesheet: vi.fn(() => Promise.resolve(published)),
    peekPublishedStyle: (id: string) => published.find((s) => s.layerId === id) ?? null,
  }
})

function fakeMap() {
  const sources: Record<string, any> = {}
  const layers: any[] = []
  return {
    sources,
    layers,
    style: { _loaded: true },
    getSource: (id: string) => sources[id],
    addSource: (id: string, s: any) => { sources[id] = s },
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addLayer: (l: any) => { layers.push(l) },
    getStyle: () => ({ layers }),
    moveLayer: (id: string, before: string) => {
      const from = layers.findIndex((l) => l.id === id)
      const [l] = layers.splice(from, 1)
      layers.splice(layers.findIndex((x) => x.id === before), 0, l)
    },
    setLayoutProperty: vi.fn(),
    on: vi.fn(),
  }
}

const CATALOG = [
  { id: 'provinces', title: 'Provinces', geomType: 'polygon', group: 'admin', minzoom: 0, maxzoom: 22 },
  { id: 'roads', title: 'Roads', geomType: 'line', group: 'transport', minzoom: 8, maxzoom: 22 },
]

describe('addVunguBasemap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getTileLayerCatalog as any).mockResolvedValue(CATALOG)
  })

  it('adds province paint+outline+label and roads casing+paint+line-label', async () => {
    const map = fakeMap()
    await addVunguBasemap(map as any)
    // One source per catalog layer.
    expect(Object.keys(map.sources).sort()).toEqual(['vungu-provinces', 'vungu-roads'])
    // Provinces -> fill paint + boundary outline + label symbol;
    // Roads -> casing line + paint line + symbol-placement=line label.
    expect(map.layers.map((l) => l.id).sort()).toEqual([
      'vungu-provinces',
      'vungu-provinces-label',
      'vungu-provinces-outline',
      'vungu-roads',
      'vungu-roads-casing',
      'vungu-roads-label',
    ])
    const label = map.layers.find((l) => l.id === 'vungu-provinces-label')
    expect(label.type).toBe('symbol')
    expect(label.layout['text-field']).toBeDefined()
    const outline = map.layers.find((l) => l.id === 'vungu-provinces-outline')
    expect(outline.type).toBe('line')
    const roadLabel = map.layers.find((l) => l.id === 'vungu-roads-label')
    expect(roadLabel.type).toBe('symbol')
    expect(roadLabel.layout['symbol-placement']).toBe('line')
    // Casing must render under the paint, so it must be added before
    // `vungu-roads`.
    const ids = map.layers.map((l) => l.id)
    expect(ids.indexOf('vungu-roads-casing')).toBeLessThan(ids.indexOf('vungu-roads'))
  })

  it('is idempotent — calling twice does not duplicate sources or layers', async () => {
    const map = fakeMap()
    await addVunguBasemap(map as any)
    await addVunguBasemap(map as any)
    expect(Object.keys(map.sources)).toHaveLength(2)
    expect(map.layers).toHaveLength(6)
  })

  it('waits for the style to load before adding sources', async () => {
    // The catalogue resolves from cache in a microtask, ahead of MapLibre's
    // own style load. Adding then throws inside MapLibre, so a map whose
    // style is still loading must be waited on, not written to.
    let fireStyleLoad = () => {}
    const map = {
      ...fakeMap(),
      style: { _loaded: false },
      once: vi.fn((event: string, cb: () => void) => {
        if (event === 'style.load') fireStyleLoad = cb
      }),
    }
    const done = addVunguBasemap(map as any)
    await new Promise((r) => setTimeout(r, 0))
    expect(Object.keys(map.sources)).toHaveLength(0)

    map.style._loaded = true
    fireStyleLoad()
    await done
    expect(Object.keys(map.sources)).toHaveLength(2)
  })

  it('respects the groups option', async () => {
    const map = fakeMap()
    await addVunguBasemap(map as any, { groups: ['admin'] })
    expect(Object.keys(map.sources)).toEqual(['vungu-provinces'])
  })


  it('keeps the callers own overlays on top when beforeId is given (the basemap arrives after an async fetch)', async () => {
    const map = fakeMap()
    map.layers.push({ id: 'background' }, { id: 'draw-completed-fill' }, { id: 'pl-lot-fill' })   // added while the catalogue was loading
    await addVunguBasemap(map as any, { beforeId: 'draw-completed-fill' })
    const ids = map.layers.map((l) => l.id)
    const drawAt = ids.indexOf('draw-completed-fill')
    expect(drawAt).toBeGreaterThan(ids.indexOf('vungu-roads'))          // overlay above every basemap layer
    expect(ids.indexOf('pl-lot-fill')).toBeGreaterThan(drawAt)
    expect(ids[0]).toBe('background')
    expect(ids.indexOf('vungu-roads-casing')).toBeLessThan(ids.indexOf('vungu-roads'))   // basemap's own order is kept
  })

  it('without beforeId nothing is reordered, and a missing beforeId is ignored', async () => {
    const map = fakeMap()
    await addVunguBasemap(map as any, { beforeId: 'does-not-exist' })
    expect(map.layers).toHaveLength(6)
  })

  it('defaultVisible limits what is drawn on arrival; the rest is added but hidden', async () => {
    const map = fakeMap()
    await addVunguBasemap(map as any, { defaultVisible: ['roads'] })
    const vis = (id: string) => (map.layers.find((l) => l.id === id)?.layout?.visibility)
    expect(vis('vungu-roads')).toBe('visible')
    expect(vis('vungu-provinces')).toBe('none')
  })
})

describe('the planner default set', () => {
  it('shows orientation and the Vungu zones, not the whole national catalogue', () => {
    for (const id of ['country', 'wards', 'roads', 'vungu_proposed_peri_urban_zones']) expect(PLANNER_BASEMAP_DEFAULT.has(id)).toBe(true)
    for (const id of ['buildings', 'landuse', 'pois_points', 'protected_areas', 'stands']) expect(PLANNER_BASEMAP_DEFAULT.has(id)).toBe(false)
  })
})
