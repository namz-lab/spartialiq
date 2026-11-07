// src/map/gmsStyle.ts
// ---------------------------------------------------------------------------
// Cartography for GIS Management System overlays: one colour per custodian
// department, used both for the map paint and the custodian badge in the
// layer tree, so the swatch and the map always agree (the same rule
// vunguBasemapStyle.ts follows for the basemap).
//
// These sit in their own taxonomy, apart from the UI accent (#1a73e8), which
// is kept for selection and the parcel outline.
// ---------------------------------------------------------------------------

const CUSTODIAN_COLOUR: Record<string, string> = {
  'Survey Section': '#7a5a2f',
  Planning: '#8e44ad',
  Engineering: '#c2410c',
  Revenue: '#0f766e',
  'Social Services': '#3b5bdb',
  Health: '#b42318',
  Environment: '#2e7d32',
}
const FALLBACK = '#5f6b7a'

export const custodianColour = (dept: string) => CUSTODIAN_COLOUR[dept] ?? FALLBACK

export const SELECTION_COLOUR = '#1a73e8'
export const ERROR_COLOUR = '#b42318'

/** MapLibre layers for one GMS overlay source (source-layer = layer id). */
export function gmsOverlayLayers(layerId: string, geomType: 'Point' | 'LineString' | 'Polygon', custodian: string) {
  const c = custodianColour(custodian)
  const base = { source: `gms-${layerId}`, 'source-layer': layerId }
  if (geomType === 'Point') {
    return [{ ...base, id: `gms-${layerId}`, type: 'circle',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 6], 'circle-color': c,
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1.5 } }]
  }
  if (geomType === 'LineString') {
    return [{ ...base, id: `gms-${layerId}`, type: 'line',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': c, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 4] } }]
  }
  return [
    { ...base, id: `gms-${layerId}`, type: 'fill', paint: { 'fill-color': c, 'fill-opacity': 0.18 } },
    { ...base, id: `gms-${layerId}-line`, type: 'line', paint: { 'line-color': c, 'line-width': 1.5 } },
  ]
}

/** The cadastre: parcels drawn as outlines, labelled with stand numbers up close. */
export function parcelLayers() {
  const base = { source: 'gms-parcels', 'source-layer': 'parcels' }
  const c = custodianColour('Survey Section')
  return [
    { ...base, id: 'gms-parcels', type: 'fill', paint: { 'fill-color': c, 'fill-opacity': 0.05 } },
    { ...base, id: 'gms-parcels-line', type: 'line', paint: { 'line-color': c, 'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 18, 1.5] } },
    { ...base, id: 'gms-parcels-label', type: 'symbol', minzoom: 16,
      layout: { 'text-field': ['get', 'stand_no'], 'text-size': 11, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': c, 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 } },
  ]
}
