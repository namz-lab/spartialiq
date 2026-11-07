// Shared QGIS Server overlay for any MapLibre map in the portal.
// ---------------------------------------------------------------------------
// One implementation, used by the home map (InteractiveMap.vue) and the
// planner workspace. It is the *extraction* of the logic that was inline in
// VunguPlannerView.vue — not a second QGIS integration:
//
//   layer toggle -> this module -> wmsTileUrlTemplate() (services/ogc.ts)
//                -> GET /api/ogc/wms/map/:layer  (existing backend OGC proxy)
//                -> QGIS Server -> vungu-project.qgs
//
// WMS mode is authoritative: QGIS Server rasterises the layer with the exact
// symbology stored in the .qgs/.qml project, so hatches, gradients, category
// breaks and outlines are pixel-identical to QGIS Desktop. Nothing here
// re-creates QGIS styling in JavaScript.
//
// CRS/BBOX: wmsTileUrlTemplate embeds MapLibre's {bbox-epsg-3857} token and
// crs=EPSG:3857. MapLibre substitutes each tile's Web-Mercator bbox as the
// user pans/zooms, so viewport updates are handled by the raster source
// itself — there is no manual bbox math and no redraw wiring to get wrong.
// (The project's layers are EPSG:4326; QGIS Server reprojects to 3857.)
//
// Vector mode is the degraded fallback: when QGIS Server is down the features
// still come from PostGIS over WFS, and they are painted from the SAME QGIS
// project symbology. The backend reads the renderer out of the .qgs file
// without QGIS Server (/api/ogc/api/styles/:layer); qgisVectorLayers() turns
// its categorised / graduated / single symbols into MapLibre expressions.
// Only when that read fails too does a layer fall back to the flat statutory
// palette.

import { ogcService, wmsTileUrlTemplate } from '@/services/ogc'
import api from '@/services/api'
import { mpColor } from '@/map/masterplanSymbology'

/** Tile edge in px. Larger tiles = far fewer QGIS renders per pan. */
const WMS_TILE_SIZE = 512

export type QgisLayerMeta = { name: string; title: string; geometry?: string }
export type QgisRenderMode = 'wms' | 'vector'
export type QgisHealth = 'healthy' | 'degraded' | 'offline' | 'unknown'

/** Source id for a QGIS layer. Stable so add/remove/toggle agree. */
export const qgisSourceId = (name: string) => `qgis-src-${name}`

/** Every style-layer id this module may create for one QGIS layer. */
export function qgisLayerIds(name: string) {
  const main = `qgis-${name}-v`
  return { raster: `qgis-${name}`, ...vectorIds(main) }
}

/** The style-layer ids a vector layer may use, derived from its main id. */
export const vectorIds = (main: string) =>
  ({ main, outline: `${main}-outline`, casing: `${main}-casing` })

const allIds = (name: string) => Object.values(qgisLayerIds(name))

// ── QGIS project symbology as MapLibre paint ─────────────────────────────

type QgisStroke = { color?: string; width?: number }
export type QgisSymbol = {
  name?: string; category?: string; render?: boolean
  lower?: number; upper?: number
  fill?: { color?: string; style?: string } | null
  stroke?: QgisStroke | null
  strokeLayers?: QgisStroke[]
  marker?: { color?: string; size?: number } | null
}
export type QgisStyle = {
  rendererType?: string
  attributeName?: string
  symbols?: QgisSymbol[]
}

const CLEAR = 'rgba(0,0,0,0)'
const fillOf = (s: QgisSymbol) => (!s.fill || s.fill.style === 'no' ? CLEAR : s.fill.color || CLEAR)
// A QGIS line symbol is a stack: casing first, core last. The core carries the
// class colour; the casing, if any, is drawn beneath it as its own layer.
const strokesOf = (s: QgisSymbol) => (s.strokeLayers?.length ? s.strokeLayers : s.stroke ? [s.stroke] : [])
const coreOf = (s: QgisSymbol) => strokesOf(s).at(-1)
const casingOf = (s: QgisSymbol) => { const k = strokesOf(s); return k.length > 1 ? k[0] : undefined }
// ponytail: the extractor drops the width unit; QGIS mm widths are small
// (0.15–1.5) and pixel widths large (4–6), so < 2 is read as mm at 96 dpi.
const px = (w?: number) => (w == null ? 1 : w < 2 ? Math.max(0.8, w * 3.78) : w)
const isElse = (s: QgisSymbol) => s.category === '' || s.category === 'default'

/**
 * One paint value per renderer: a `match` on the category attribute, a `step`
 * over graduated class breaks, or a constant for a single symbol.
 */
function byRenderer<T extends string | number>(
  style: QgisStyle, pick: (s: QgisSymbol) => T | undefined, fallback: T,
): any {
  const syms = (style.symbols || []).filter(s => s.render !== false)
  const attr = style.attributeName
  if (!syms.length) return fallback
  if (style.rendererType === 'categorizedSymbol' && attr) {
    const seen = new Set<string>()
    const pairs: (string | T)[] = []
    let otherwise = fallback
    for (const s of syms) {
      const v = pick(s) ?? fallback
      if (isElse(s)) { otherwise = v; continue }
      const key = String(s.category ?? s.name ?? '')
      if (seen.has(key)) continue // `match` rejects duplicate labels
      seen.add(key)
      pairs.push(key, v)
    }
    return pairs.length ? ['match', ['to-string', ['get', attr]], ...pairs, otherwise] : otherwise
  }
  if (style.rendererType === 'graduatedSymbol' && attr) {
    const sorted = [...syms].sort((a, b) => (a.lower ?? 0) - (b.lower ?? 0))
    const expr: any[] = ['step', ['to-number', ['get', attr], 0], pick(sorted[0]) ?? fallback]
    for (const s of sorted.slice(1)) expr.push(s.lower ?? 0, pick(s) ?? fallback)
    return expr
  }
  return pick(syms[0]) ?? fallback
}

/**
 * MapLibre style layers that reproduce a QGIS layer's symbology. With no
 * style (the .qgs could not be read) the layer is painted on the statutory
 * palette, so it is still distinguishable. The first returned layer is the
 * main one (click handlers bind to it); a casing, when present, is added
 * before it so it draws beneath.
 */
export function qgisVectorLayers(
  main: string, source: string, geometry: string,
  style: QgisStyle | null, opacity = 0.8,
): any[] {
  const ids = vectorIds(main)
  const g = geometry.toLowerCase()
  if (g.includes('poly')) {
    return [
      { id: ids.main, type: 'fill', source, paint: {
        'fill-color': style ? byRenderer(style, fillOf, CLEAR) : mpColor('Blue-Grey 1.2'),
        'fill-opacity': opacity * 0.6 } },
      { id: ids.outline, type: 'line', source, paint: {
        'line-color': style ? byRenderer(style, s => s.stroke?.color, '#232323') : mpColor('Blue-Grey 1'),
        'line-width': style ? byRenderer(style, s => Math.min(px(s.stroke?.width), 3), 1) : 1,
        'line-opacity': opacity } },
    ]
  }
  if (g.includes('line')) {
    const core = { id: ids.main, type: 'line', source,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': style ? byRenderer(style, s => coreOf(s)?.color, '#202020') : mpColor('Blue 2'),
        'line-width': style ? byRenderer(style, s => px(coreOf(s)?.width), 1.5) : 1.5,
        'line-opacity': opacity } }
    const hasCasing = style?.symbols?.some(s => casingOf(s))
    if (!hasCasing) return [core]
    return [core, { id: ids.casing, type: 'line', source,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': byRenderer(style!, s => casingOf(s)?.color, CLEAR),
        'line-width': byRenderer(style!, s => px(casingOf(s)?.width ?? 0), 0),
        'line-opacity': opacity } }]
  }
  return [{ id: ids.main, type: 'circle', source, paint: {
    'circle-color': style ? byRenderer(style, s => s.marker?.color ?? fillOf(s), mpColor('Red 2')) : mpColor('Red 2'),
    'circle-radius': style ? byRenderer(style, s => Math.min(10, Math.max(3, px(s.marker?.size ?? 2) / 2)), 4) : 4,
    'circle-opacity': opacity,
    'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1 } }]
}

/** Add qgisVectorLayers() output; the casing goes under the main layer. */
export function addVectorLayers(map: any, layers: any[], beforeId?: string): void {
  const [main, ...rest] = layers
  if (!map.getLayer(main.id)) map.addLayer(main, beforeId)
  for (const l of rest) {
    if (map.getLayer(l.id)) continue
    map.addLayer(l, l.id.endsWith('-casing') ? main.id : beforeId)
  }
}

/** Legend rows for a style: what each colour means, in the project's words. */
export function qgisLegend(style: QgisStyle | null): { label: string; color: string }[] {
  return (style?.symbols || [])
    .filter(s => s.render !== false)
    .map(s => ({
      label: s.name && s.name !== 'default' ? s.name : isElse(s) ? 'Other' : String(s.category ?? ''),
      color: s.marker?.color || (fillOf(s) !== CLEAR ? fillOf(s) : coreOf(s)?.color || CLEAR),
    }))
}

const styleCache = new Map<string, Promise<QgisStyle | null>>()
let styleQueue: Promise<unknown> = Promise.resolve()

/**
 * The layer's renderer read straight from the QGIS project file. Works while
 * QGIS Server is down. Cached per session; null when the project has no such
 * layer, so callers fall back to the statutory palette.
 *
 * ponytail: requests run one at a time. Each costs the backend ~1.2 s (it tries
 * QGIS Server, then parses the .qgs), and a burst of ~20 at page load stalled
 * the whole API for 90 s. Drop the queue once that endpoint is cached server-side.
 */
export function fetchQgisStyle(name: string): Promise<QgisStyle | null> {
  let p = styleCache.get(name)
  if (!p) {
    p = styleQueue.then(() => api.get(`/ogc/api/styles/${encodeURIComponent(name)}`, { timeout: 15000 }))
      .then(r => {
        const s = r.data?.data?.extractedStyle
        return s?.success !== false && s?.symbols?.length ? (s as QgisStyle) : null
      })
      .catch(() => { styleCache.delete(name); return null }) // retry on next toggle
    styleQueue = p
    styleCache.set(name, p)
  }
  return p
}

/** Forget every cached QGIS style, so the next read reflects the saved project. */
export function clearQgisStyleCache(): void {
  styleCache.clear()
}

/**
 * The QGIS project's symbology changed: make the overlays on screen show it.
 *
 * - A WMS overlay gets a fresh tile URL (a version query) so MapLibre and the
 *   browser stop reusing the tiles drawn from the old style.
 * - A vector fallback is rebuilt from the re-read project style.
 *
 * Only layers that are currently on the map are touched, and each keeps its
 * visibility. Call clearQgisStyleCache() first (this does not).
 */
export async function refreshQgisOverlays(
  map: any,
  layers: QgisLayerMeta[],
  opts: { opacity?: number; beforeId?: string } = {},
): Promise<void> {
  if (!map) return
  const version = Date.now()
  for (const layer of layers) {
    const src = map.getSource?.(qgisSourceId(layer.name)) as any
    if (!src) continue
    const ids = qgisLayerIds(layer.name)
    if (src.type === 'raster' && typeof src.setTiles === 'function') {
      src.setTiles([`${wmsTileUrlTemplate(layer.name, WMS_TILE_SIZE)}&v=${version}`])
    } else if (src.type === 'geojson') {
      const hidden = map.getLayer?.(ids.main) && map.getLayoutProperty(ids.main, 'visibility') === 'none'
      try {
        await addQgisLayer(map, layer, { mode: 'vector', opacity: opts.opacity, beforeId: opts.beforeId })
        if (hidden) setQgisLayerVisible(map, layer.name, false)
      } catch { /* keep the overlay as it was drawn; the next change retries */ }
    }
  }
}

/** Set opacity on whatever vector/raster layers exist for the given ids. */
export function setLayersOpacity(map: any, ids: string[], val: number): void {
  for (const id of ids) {
    const type = map?.getLayer?.(id)?.type
    const prop = type === 'raster' ? 'raster-opacity' : type === 'fill' ? 'fill-opacity'
      : type === 'line' ? 'line-opacity' : type === 'circle' ? 'circle-opacity' : null
    if (!prop) continue
    try { map.setPaintProperty(id, prop, type === 'fill' ? val * 0.6 : val) } catch { /* noop */ }
  }
}

/** Is QGIS Server actually rendering? Drives WMS-vs-vector selection. */
export async function fetchQgisHealth(): Promise<QgisHealth> {
  try {
    const r = await ogcService.health()
    const status = r?.data?.status
    return status === 'healthy' ? 'healthy' : status === 'degraded' ? 'degraded' : 'offline'
  } catch {
    return 'offline'
  }
}

/** The authoritative layer list, straight from the QGIS project. */
export async function fetchQgisLayers(): Promise<QgisLayerMeta[]> {
  const layers = await ogcService.getAvailableLayers()
  return (layers || []).map((l: any) => ({
    name: l.name ?? l,
    title: l.title || l.name || String(l),
    geometry: l.geometry,
  }))
}

/**
 * Add one QGIS project layer to the map.
 * Returns the mode actually used, so callers can surface it in the UI.
 * Throws in vector mode if features can't be loaded — callers must show the
 * error rather than swallow it.
 */
export async function addQgisLayer(
  map: any,
  layer: QgisLayerMeta,
  opts: { mode?: QgisRenderMode; opacity?: number; beforeId?: string } = {},
): Promise<QgisRenderMode> {
  if (!map) return 'wms'
  const name = layer.name
  const srcId = qgisSourceId(name)
  const ids = qgisLayerIds(name)
  const opacity = opts.opacity ?? 0.85
  // Keep overlays under the label hierarchy so place names stay legible.
  const beforeId = opts.beforeId && map.getLayer?.(opts.beforeId) ? opts.beforeId : firstSymbolLayerId(map)

  removeQgisLayer(map, name)

  if (opts.mode !== 'vector') {
    // ---- Authoritative: QGIS Server renders the project symbology ----
    // tileSize must match the width/height in the URL template (512).
    map.addSource(srcId, { type: 'raster', tiles: [wmsTileUrlTemplate(name, WMS_TILE_SIZE)], tileSize: WMS_TILE_SIZE })
    map.addLayer(
      { id: ids.raster, type: 'raster', source: srcId, paint: { 'raster-opacity': opacity } },
      beforeId,
    )
    return 'wms'
  }

  // ---- Degraded: features from PostGIS via WFS, QGIS project symbology ----
  const [features, style] = await Promise.all([
    ogcService.getWFSFeatures({ typeName: name, maxFeatures: 5000 }),
    fetchQgisStyle(name),
  ])
  if (!features?.length) throw new Error(`No features returned for ${layer.title || name}`)
  map.addSource(srcId, { type: 'geojson', data: { type: 'FeatureCollection', features } as any })

  const geom = layer.geometry || features[0]?.geometry?.type || ''
  addVectorLayers(map, qgisVectorLayers(ids.main, srcId, geom, style, opacity), beforeId)
  return 'vector'
}

/** Remove a QGIS layer and its source (safe if absent). */
export function removeQgisLayer(map: any, name: string): void {
  if (!map) return
  for (const id of allIds(name)) {
    if (map.getLayer?.(id)) {
      try { map.removeLayer(id) } catch { /* already gone */ }
    }
  }
  if (map.getSource?.(qgisSourceId(name))) {
    try { map.removeSource(qgisSourceId(name)) } catch { /* still referenced */ }
  }
}

/** Show/hide without discarding the source (cheap re-toggle). */
export function setQgisLayerVisible(map: any, name: string, visible: boolean): void {
  if (!map) return
  for (const id of allIds(name)) {
    if (map.getLayer?.(id)) {
      try { map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none') } catch { /* noop */ }
    }
  }
}

/** Opacity across whichever paint properties the active mode produced. */
export function setQgisLayerOpacity(map: any, name: string, val: number): void {
  if (!map) return
  setLayersOpacity(map, allIds(name), val)
}

/** First symbol layer = start of the label hierarchy; overlays go beneath. */
export function firstSymbolLayerId(map: any): string | undefined {
  const ls = map?.getStyle?.()?.layers || []
  return ls.find((l: any) => l.type === 'symbol')?.id
}

/**
 * Re-stack overlays to match panel order (index 0 = drawn on top), keeping
 * them below the labels. Mirrors MapLayerFilters' applyOrder convention.
 */
export function applyQgisOrder(map: any, names: string[]): void {
  if (!map) return
  const anchor = firstSymbolLayerId(map)
  for (let i = names.length - 1; i >= 0; i--) {
    for (const id of allIds(names[i])) {
      if (map.getLayer?.(id)) {
        try { map.moveLayer(id, anchor) } catch { /* not movable yet */ }
      }
    }
  }
}
