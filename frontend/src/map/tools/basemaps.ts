// src/map/tools/basemaps.ts
// ─────────────────────────────────────────────────────────────────────────
// Satellite / aerial imagery basemap toggle for the shared MapLibre map.
//
// Fixes the "no ground-truth imagery" gap: planners need to compare the
// cadastre against what is actually built. Imagery comes from Esri World
// Imagery (public REST tiles — no API key, so it works behind the council
// firewall and in the field).
//
// The imagery raster is inserted at the BOTTOM of the layer stack so every
// PostGIS vector layer (roads, labels, master-plan boundaries) still draws on
// top of the photo. In "satellite" mode the opaque vector LAND fills (and the
// cream background) are made transparent so the photo shows through; in
// "hybrid" mode they stay faintly visible. Switching back to "map" restores
// the cartographic basemap exactly, including any per-layer opacity
// expressions that addVunguBasemap configured.
// ─────────────────────────────────────────────────────────────────────────

const IMAGERY_SOURCE = 'sat-imagery'
const IMAGERY_LAYER = 'sat-imagery'

const ESRI_WORLD_IMAGERY =
  'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

export type BasemapMode = 'map' | 'satellite' | 'hybrid'

// Per-map record of the fill-opacity values we overrode, so "map" can put the
// cartographic basemap back exactly as addVunguBasemap left it.
const savedOpacity = new WeakMap<object, Map<string, unknown>>()

/** ids of every layer whose fill we dim when imagery is shown. */
function dimmableLayerIds(map: any): string[] {
  const style = map.getStyle?.()
  if (!style?.layers) return []
  return style.layers
    .filter(
      (l: any) =>
        l.id !== IMAGERY_LAYER &&
        (l.type === 'fill' || l.type === 'background' || l.type === 'fill-extrusion'),
    )
    .map((l: any) => l.id)
}

function opacityProp(type: string): string {
  if (type === 'background') return 'background-opacity'
  if (type === 'fill-extrusion') return 'fill-extrusion-opacity'
  return 'fill-opacity'
}

function dimFills(map: any, target: number): void {
  let store = savedOpacity.get(map)
  if (!store) {
    store = new Map<string, unknown>()
    savedOpacity.set(map, store)
  }
  for (const id of dimmableLayerIds(map)) {
    const layer = map.getLayer(id)
    if (!layer) continue
    const prop = opacityProp(layer.type)
    // Record the ORIGINAL value only once (first dim) so satellite→hybrid
    // toggling never overwrites the true cartographic value.
    if (!store.has(id)) store.set(id, map.getPaintProperty(id, prop))
    map.setPaintProperty(id, prop, target)
  }
}

function restoreFills(map: any): void {
  const store = savedOpacity.get(map)
  if (!store) return
  for (const [id, value] of store.entries()) {
    const layer = map.getLayer(id)
    if (!layer) continue
    const prop = opacityProp(layer.type)
    // undefined means the property was never explicitly set → MapLibre default
    // (1 for every *-opacity), so restoring to 1 is correct.
    map.setPaintProperty(id, prop, value == null ? 1 : value)
  }
  store.clear()
}

function ensureImagery(map: any): void {
  if (!map.getSource(IMAGERY_SOURCE)) {
    map.addSource(IMAGERY_SOURCE, {
      type: 'raster',
      tiles: [ESRI_WORLD_IMAGERY],
      tileSize: 256,
      maxzoom: 19,
      attribution:
        'Imagery &copy; <a href="https://www.esri.com/" target="_blank" rel="noopener">Esri</a>, Maxar, Earthstar Geographics',
    })
  }
  if (!map.getLayer(IMAGERY_LAYER)) {
    // Insert at the very bottom of the stack. The cream `background` layer that
    // sits above it is dimmed to transparent by dimFills(), so the photo is
    // visible while every vector data + label layer still draws on top.
    const firstId = map.getStyle()?.layers?.[0]?.id
    map.addLayer(
      { id: IMAGERY_LAYER, type: 'raster', source: IMAGERY_SOURCE, paint: { 'raster-opacity': 1 } },
      firstId,
    )
  }
}

function removeImagery(map: any): void {
  if (map.getLayer(IMAGERY_LAYER)) map.removeLayer(IMAGERY_LAYER)
  if (map.getSource(IMAGERY_SOURCE)) map.removeSource(IMAGERY_SOURCE)
}

/**
 * Switch the basemap between the cartographic vector map and Esri imagery.
 *  - 'map'       → vector cartography only (imagery removed, fills restored)
 *  - 'satellite' → imagery, land fills fully hidden, roads + labels on top
 *  - 'hybrid'    → imagery with faint translucent zoning fills + labels
 */
export function setBasemapMode(map: any, mode: BasemapMode): void {
  if (!map || !map.getStyle) return
  if (mode === 'map') {
    removeImagery(map)
    restoreFills(map)
    return
  }
  ensureImagery(map)
  dimFills(map, mode === 'satellite' ? 0 : 0.35)
}
