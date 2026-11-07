// src/planning/cad/cadRender.ts
// ─────────────────────────────────────────────────────────────────────────
// MapLibre rendering for the CAD document. One GeoJSON source ('cad') + styled
// layers (polygon fill/outline, lines, points, text labels) with a selection
// highlight via feature-state. Mirrors planning-layers.ts so paint config lives
// in one place. Pure map plumbing — no Vue, no turf.
// ─────────────────────────────────────────────────────────────────────────
import type maplibregl from 'maplibre-gl'
import type { FeatureCollection } from 'geojson'
import type { CadGrip } from './cadGrips'

const SRC = 'cad'
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] }
const FONT = ['Open Sans Regular', 'Arial Unicode MS Regular']
const SELECTED = ['boolean', ['feature-state', 'selected'], false]

export const CAD_LAYER_IDS = ['cad-fill', 'cad-line', 'cad-point', 'cad-label']

/** Add the CAD source + layers once (safe to call again). */
export function addCadLayers(map: maplibregl.Map): void {
  if (!map || map.getSource(SRC)) return
  map.addSource(SRC, { type: 'geojson', data: EMPTY as any })

  map.addLayer({
    id: 'cad-fill', type: 'fill', source: SRC,
    filter: ['==', ['geometry-type'], 'Polygon'],
    paint: {
      'fill-color': ['case', SELECTED as any, '#f59e0b', ['coalesce', ['get', 'color'], '#1a73e8']],
      'fill-opacity': ['case', SELECTED as any, 0.28, ['coalesce', ['get', 'fillOpacity'], 0.12]],
    },
  })
  map.addLayer({
    id: 'cad-line', type: 'line', source: SRC,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', SELECTED as any, '#f59e0b', ['coalesce', ['get', 'color'], '#1a73e8']],
      'line-width': ['case', SELECTED as any, 3, ['coalesce', ['get', 'weight'], 1.5]],
    },
  })
  map.addLayer({
    id: 'cad-point', type: 'circle', source: SRC,
    filter: ['==', ['geometry-type'], 'Point'],
    paint: {
      'circle-radius': 4,
      'circle-color': ['case', SELECTED as any, '#f59e0b', ['coalesce', ['get', 'color'], '#1a73e8']],
      'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5,
    },
  })
  map.addLayer({
    id: 'cad-label', type: 'symbol', source: SRC,
    filter: ['all', ['==', ['get', 'type'], 'text'], ['!=', ['get', 'text'], '']],
    layout: { 'text-field': ['get', 'text'], 'text-size': 12, 'text-font': FONT, 'text-allow-overlap': true },
    paint: { 'text-color': '#1f2933', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 },
  })
}

/** Push the latest CAD GeoJSON into the source. */
export function syncCad(map: maplibregl.Map, fc: FeatureCollection): void {
  const src = map?.getSource(SRC) as maplibregl.GeoJSONSource | undefined
  if (src && typeof src.setData === 'function') src.setData((fc || EMPTY) as any)
}

/** Toggle the selection highlight for an entity id. */
export function setCadSelected(map: maplibregl.Map, id: string, selected: boolean): void {
  try { map.setFeatureState({ source: SRC, id }, { selected }) } catch { /* ignore */ }
}

export const CAD_SOURCE_ID = SRC

// ── Grip layer ────────────────────────────────────────────────────────────────

const GRIP_SRC = 'cad-grips'
const EMPTY_FC: FeatureCollection = { type: 'FeatureCollection', features: [] }

export const GRIP_LAYER_ID = 'cad-grips'

/** Add the grip handles source + layer (safe to call again). */
export function addGripLayer(map: maplibregl.Map): void {
  if (!map || map.getSource(GRIP_SRC)) return
  map.addSource(GRIP_SRC, { type: 'geojson', data: EMPTY_FC as any })
  map.addLayer({
    id: GRIP_LAYER_ID,
    type: 'circle',
    source: GRIP_SRC,
    paint: {
      'circle-radius': 5,
      // hot grip (being dragged) → accent orange; normal → white with blue ring
      'circle-color': ['case', ['boolean', ['get', 'hot'], false], '#f59e0b', '#ffffff'],
      'circle-stroke-color': ['case', ['boolean', ['get', 'hot'], false], '#d97706', '#1a73e8'],
      'circle-stroke-width': 1.5,
    },
  })
}

/** Push updated grip positions into the source.  hotGripIdx highlights one grip. */
export function syncGrips(
  map: maplibregl.Map,
  grips: CadGrip[],
  hotGripIdx: number | null = null,
): void {
  const src = map?.getSource(GRIP_SRC) as maplibregl.GeoJSONSource | undefined
  if (!src || typeof src.setData !== 'function') return
  const fc: FeatureCollection = {
    type: 'FeatureCollection',
    features: grips.map(g => ({
      type: 'Feature',
      id: g.gripIdx,
      geometry: { type: 'Point', coordinates: g.lngLat },
      properties: {
        gripIdx: g.gripIdx,
        entityId: g.entityId,
        hot: g.gripIdx === hotGripIdx,
      },
    })),
  }
  src.setData(fc as any)
}

// ── Dimension layer (associative annotations) ──────────────────────────────────

const DIM_SRC = 'cad-dims'
const DIM_SELECTED = ['boolean', ['get', 'selected'], false]

export const DIM_LAYER_IDS = ['cad-dim-line', 'cad-dim-label']

/** Add the dimension source + layers (witness/dimension/tick lines + label). */
export function addDimensionLayers(map: maplibregl.Map): void {
  if (!map || map.getSource(DIM_SRC)) return
  map.addSource(DIM_SRC, { type: 'geojson', data: EMPTY_FC as any })
  map.addLayer({
    id: 'cad-dim-line', type: 'line', source: DIM_SRC,
    filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', DIM_SELECTED as any, '#f59e0b', '#65727f'],
      'line-width': 1,
    },
  })
  map.addLayer({
    id: 'cad-dim-label', type: 'symbol', source: DIM_SRC,
    filter: ['has', 'dimLabel'],
    layout: {
      'text-field': ['get', 'dimLabel'],
      'text-size': 11,
      'text-font': FONT,
      'text-rotate': ['coalesce', ['get', 'angle'], 0],
      'text-rotation-alignment': 'map',
      'text-allow-overlap': true,
      'text-offset': [0, -0.6],
    },
    paint: {
      'text-color': ['case', DIM_SELECTED as any, '#b45309', '#1f2933'],
      'text-halo-color': '#ffffff', 'text-halo-width': 1.6,
    },
  })
}

/** Push the resolved dimension FeatureCollection into the source. */
export function syncDimensions(map: maplibregl.Map, fc: FeatureCollection): void {
  const src = map?.getSource(DIM_SRC) as maplibregl.GeoJSONSource | undefined
  if (src && typeof src.setData === 'function') src.setData((fc || EMPTY_FC) as any)
}

// ── Symbol layer (blocks / inserted symbols) ───────────────────────────────────

const SYM_SRC = 'cad-symbols'
const SYM_SELECTED = ['boolean', ['get', 'selected'], false]
const SYM_FILL = ['==', ['get', 'role'], 'fill']

export const SYMBOL_LAYER_IDS = ['cad-symbol-fill', 'cad-symbol-line', 'cad-symbol-label']

/** Add the symbol source + layers (fill parts, line parts, text labels). */
export function addSymbolLayers(map: maplibregl.Map): void {
  if (!map || map.getSource(SYM_SRC)) return
  map.addSource(SYM_SRC, { type: 'geojson', data: EMPTY_FC as any })
  map.addLayer({
    id: 'cad-symbol-fill', type: 'fill', source: SYM_SRC,
    filter: ['all', ['==', ['geometry-type'], 'Polygon'], SYM_FILL as any],
    paint: {
      'fill-color': ['case', SYM_SELECTED as any, '#f59e0b', ['coalesce', ['get', 'color'], '#1f2933']],
      'fill-opacity': 0.9,
    },
  })
  map.addLayer({
    id: 'cad-symbol-line', type: 'line', source: SYM_SRC,
    filter: ['!', SYM_FILL as any],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case', SYM_SELECTED as any, '#f59e0b', ['coalesce', ['get', 'color'], '#1f2933']],
      'line-width': 1.4,
    },
  })
  map.addLayer({
    id: 'cad-symbol-label', type: 'symbol', source: SYM_SRC,
    filter: ['all', ['==', ['geometry-type'], 'Point'], ['!=', ['get', 'text'], '']],
    layout: { 'text-field': ['get', 'text'], 'text-size': 12, 'text-font': FONT, 'text-allow-overlap': true },
    paint: {
      'text-color': ['case', SYM_SELECTED as any, '#b45309', '#1f2933'],
      'text-halo-color': '#ffffff', 'text-halo-width': 1.4,
    },
  })
}

/** Push the expanded symbol FeatureCollection into the source. */
export function syncSymbols(map: maplibregl.Map, fc: FeatureCollection): void {
  const src = map?.getSource(SYM_SRC) as maplibregl.GeoJSONSource | undefined
  if (src && typeof src.setData === 'function') src.setData((fc || EMPTY_FC) as any)
}

// ── Hatch layer (land-use fills) ───────────────────────────────────────────────

const HATCH_SRC = 'cad-hatch'
const HATCH_SELECTED = ['boolean', ['get', 'selected'], false]
const HATCH_ROLE = (r: string) => ['==', ['get', 'role'], r]

export const HATCH_LAYER_IDS = ['cad-hatch-fill', 'cad-hatch-line', 'cad-hatch-dot']

/** Add the hatch source + layers (boundary fill + pattern lines + dots). */
export function addHatchLayers(map: maplibregl.Map): void {
  if (!map || map.getSource(HATCH_SRC)) return
  map.addSource(HATCH_SRC, { type: 'geojson', data: EMPTY_FC as any })
  map.addLayer({
    id: 'cad-hatch-fill', type: 'fill', source: HATCH_SRC,
    filter: HATCH_ROLE('fill') as any,
    paint: {
      'fill-color': ['case', HATCH_SELECTED as any, '#f59e0b', ['coalesce', ['get', 'color'], '#94a3b8']],
      'fill-opacity': ['coalesce', ['get', 'fillOpacity'], 0.3],
    },
  })
  map.addLayer({
    id: 'cad-hatch-line', type: 'line', source: HATCH_SRC,
    filter: HATCH_ROLE('line') as any,
    paint: {
      'line-color': ['case', HATCH_SELECTED as any, '#b45309', ['coalesce', ['get', 'color'], '#65727f']],
      'line-width': 0.8,
    },
  })
  map.addLayer({
    id: 'cad-hatch-dot', type: 'circle', source: HATCH_SRC,
    filter: HATCH_ROLE('dot') as any,
    paint: {
      'circle-radius': 1.4,
      'circle-color': ['case', HATCH_SELECTED as any, '#b45309', ['coalesce', ['get', 'color'], '#65727f']],
    },
  })
}

/** Push the expanded hatch FeatureCollection into the source. */
export function syncHatch(map: maplibregl.Map, fc: FeatureCollection): void {
  const src = map?.getSource(HATCH_SRC) as maplibregl.GeoJSONSource | undefined
  if (src && typeof src.setData === 'function') src.setData((fc || EMPTY_FC) as any)
}
