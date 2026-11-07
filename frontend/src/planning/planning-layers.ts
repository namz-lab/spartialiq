// src/planning/planning-layers.ts
// ─────────────────────────────────────────────────────────────────────────
// MapLibre wiring for the planning engine. Adds one GeoJSON source + styled
// layer(s) per planning collection and keeps them in sync with the GeoJSON
// produced by usePlanningTools().layers. Pure map plumbing — no Vue, no turf.
//
// Source ids are namespaced `pl-<key>` so they never collide with the basemap
// or the CAD/draw sources already on the planner map.
// ─────────────────────────────────────────────────────────────────────────

import type maplibregl from 'maplibre-gl'
import {
  mpColor,
  LOT_USE_COLORS,
  LOT_USE_FALLBACK,
  SCHEME_BOUNDARY_COLOR,
  DOT_DASH,
} from '@/map/masterplanSymbology'

const EMPTY = { type: 'FeatureCollection', features: [] } as const

// Glyph stack that actually has tiles in /public/fonts.
const FONT = ['Open Sans Regular', 'Arial Unicode MS Regular']

// Lot fill: default (status/feature-state) and "colour by use type". The view
// swaps these via setPaintProperty when the planner toggles colour-by-use.
// New lots in a layout scheme are dwelling houses — statutory Yellow 2.
// envFail/selected stay as functional editing states (not cartography).
export const LOT_FILL_DEFAULT: any = [
  'case',
  ['boolean', ['feature-state', 'envFail'], false], '#a855f7',
  ['boolean', ['feature-state', 'selected'], false], '#f59e0b',
  ['==', ['get', 'isCorner'], true], '#e6c65f',
  mpColor('Yellow 2'),
]
const lotUseMatch: any[] = (() => {
  // Statutory land-use colours per use type (masterplanSymbology.ts).
  const m: any[] = ['match', ['get', 'useType']]
  for (const [use, color] of Object.entries(LOT_USE_COLORS)) m.push(use, color)
  m.push(LOT_USE_FALLBACK)
  return m
})()
export const LOT_FILL_BY_USE: any = [
  'case',
  ['boolean', ['feature-state', 'envFail'], false], '#a855f7',
  ['boolean', ['feature-state', 'selected'], false], '#f59e0b',
  lotUseMatch,
]

export const PLANNING_KEYS = [
  'planningArea', 'constraints', 'blocks', 'openSpace', 'roads', 'lots', 'envelopes',
] as const
export type PlanningLayerKey = typeof PLANNING_KEYS[number]
export type PlanningLayersGeoJSON = Record<PlanningLayerKey, any>

const LAYER_IDS = [
  'pl-area-fill', 'pl-area-line',
  'pl-constraint-fill', 'pl-constraint-line',
  'pl-block-fill', 'pl-block-line',
  'pl-openspace-fill',
  'pl-road-line', 'pl-road-label',
  'pl-lot-fill', 'pl-lot-line', 'pl-lot-label',
  'pl-envelope-fill', 'pl-envelope-line',
]

/** Add planning sources + layers once. Safe to call again (no-ops if present). */
export function addPlanningLayers(map: maplibregl.Map): void {
  if (!map || map.getSource('pl-lots')) return

  for (const k of PLANNING_KEYS) {
    if (!map.getSource(`pl-${k}`)) map.addSource(`pl-${k}`, { type: 'geojson', data: EMPTY as any })
  }
  const add = (layer: any) => { if (!map.getLayer(layer.id)) map.addLayer(layer) }

  // Scheme-area boundary — statutory Blue 2 inner edge.
  add({ id: 'pl-area-fill', type: 'fill', source: 'pl-planningArea',
    paint: { 'fill-color': SCHEME_BOUNDARY_COLOR, 'fill-opacity': 0.04 } })
  add({ id: 'pl-area-line', type: 'line', source: 'pl-planningArea',
    paint: { 'line-color': SCHEME_BOUNDARY_COLOR, 'line-width': 3 } })

  // Constraints / exclusions — statutory restricted land (Orange 1).
  add({ id: 'pl-constraint-fill', type: 'fill', source: 'pl-constraints',
    paint: { 'fill-color': mpColor('Orange 1'), 'fill-opacity': 0.25 } })
  add({ id: 'pl-constraint-line', type: 'line', source: 'pl-constraints',
    paint: { 'line-color': '#b26a1f', 'line-width': 1, 'line-dasharray': [2, 2] } })

  // Blocks (amber outline; red wash when flagged/selected via feature-state).
  add({ id: 'pl-block-fill', type: 'fill', source: 'pl-blocks',
    paint: {
      'fill-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#ef4444', '#f59e0b'],
      'fill-opacity': ['case', ['boolean', ['feature-state', 'selected'], false], 0.32, 0.08],
    } })
  add({ id: 'pl-block-line', type: 'line', source: 'pl-blocks',
    paint: { 'line-color': '#b45309', 'line-width': 1.5 } })

  // Public open space — statutory Green 1.
  add({ id: 'pl-openspace-fill', type: 'fill', source: 'pl-openSpace',
    paint: { 'fill-color': mpColor('Green 1'), 'fill-opacity': 0.45 } })

  // Proposed new streets — statutory Red 1 family, classed by hierarchy so
  // arterial / collector / local / access read apart on the canvas.
  add({ id: 'pl-road-line', type: 'line', source: 'pl-roads',
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': ['case',
        ['boolean', ['feature-state', 'selected'], false], '#0f172a',
        ['match', ['get', 'hierarchy'],
          'arterial', '#7f1d1d',
          'collector', '#b91c1c',
          'access', '#78716c',
          mpColor('Red 1'),
        ],
      ],
      'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 6,
        ['interpolate', ['linear'], ['coalesce', ['get', 'widthM'], 12], 8, 2, 30, 7]],
    } })

  // Road names (drawn along the centreline; only roads carrying a `name` show one).
  add({ id: 'pl-road-label', type: 'symbol', source: 'pl-roads',
    layout: {
      'symbol-placement': 'line', 'text-field': ['coalesce', ['get', 'name'], ''],
      'text-size': 10, 'text-font': FONT, 'text-allow-overlap': false, 'text-padding': 4,
    },
    paint: { 'text-color': '#1e293b', 'text-halo-color': '#ffffff', 'text-halo-width': 1.4 } })

  // Lots (statutory Yellow 2 residential; corner lots a touch deeper) + numbers.
  add({ id: 'pl-lot-fill', type: 'fill', source: 'pl-lots',
    paint: {
      // purple = envelope failure, amber = merge-selected, else Yellow 2.
      // Swapped to LOT_FILL_BY_USE by the view when "colour by use" is on.
      'fill-color': LOT_FILL_DEFAULT,
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'envFail'], false], 0.6,
        ['boolean', ['feature-state', 'selected'], false], 0.6,
        0.45,
      ],
    } })
  add({ id: 'pl-lot-line', type: 'line', source: 'pl-lots',
    paint: { 'line-color': '#3f3f3f', 'line-width': 0.8 } })
  add({ id: 'pl-lot-label', type: 'symbol', source: 'pl-lots',
    layout: { 'text-field': ['get', 'lotNumber'], 'text-size': 11, 'text-font': FONT, 'text-allow-overlap': false },
    paint: { 'text-color': '#3d3325', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } })

  // Building envelopes — statutory building lines: narrow black dot-and-dash.
  add({ id: 'pl-envelope-fill', type: 'fill', source: 'pl-envelopes',
    paint: { 'fill-color': '#202020', 'fill-opacity': 0.06 } })
  add({ id: 'pl-envelope-line', type: 'line', source: 'pl-envelopes',
    paint: { 'line-color': '#202020', 'line-width': 0.8, 'line-dasharray': DOT_DASH } })
}

/** Push the latest GeoJSON from usePlanningTools().layers into the sources. */
export function syncPlanningLayers(map: maplibregl.Map, layers: PlanningLayersGeoJSON): void {
  if (!map) return
  for (const k of PLANNING_KEYS) {
    const src = map.getSource(`pl-${k}`) as maplibregl.GeoJSONSource | undefined
    if (src && typeof src.setData === 'function') src.setData((layers && layers[k]) || (EMPTY as any))
  }
}

/** Tear down (not strictly needed — map.remove() handles it on unmount). */
export function removePlanningLayers(map: maplibregl.Map): void {
  if (!map) return
  for (const id of LAYER_IDS) if (map.getLayer(id)) map.removeLayer(id)
  for (const k of PLANNING_KEYS) if (map.getSource(`pl-${k}`)) map.removeSource(`pl-${k}`)
}
