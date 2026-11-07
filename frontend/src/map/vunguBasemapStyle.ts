// src/map/vunguBasemapStyle.ts
// ---------------------------------------------------------------------------
// Resolves MapLibre style layers for each PostGIS tile layer FROM THE
// ENTERPRISE GIS SYMBOLOGY REGISTRY (/api/gis/styles).
//
// This module deliberately contains NO per-layer cartography -- no layer
// palette, no fill colours, no stroke widths, no classification tables, no road
// hierarchy, no province colours. Every one of those used to live here as a
// hard-coded copy of what QGIS drew, which is precisely how the web map came to
// disagree with QGIS. They now live in exactly one place: the versioned,
// approved, published style document in the registry, compiled to MapLibre by
// the backend (src/services/gis/compile.js) -- the same function that compiles
// the QML QGIS Server renders from.
//
//   registry style document
//        ├── compileMaplibre()  ──► these layers            (web)
//        └── compileQml()       ──► QGIS Desktop / Server    (paper, WMS)
//
// To change how a layer looks: restyle it in QGIS (or amend the statutory
// schedule), import a new version through the GIS admin area, have it approved
// and published. Editing this file cannot change any colour, by design.
//
// DEGRADED MODE: if the registry is unreachable, layers render in a neutral
// diagnostic grey (UNRESOLVED_*). That is intentional. Rendering a
// plausible-looking guess would put unapproved symbology in front of planners
// making statutory decisions; an obviously-unstyled map is the safe failure.
// ---------------------------------------------------------------------------
import type { TileLayerMeta } from '@/services/vectorTiles'
import {
  getPublishedStylesheet,
  peekPublishedStyle,
  type CompiledMapLayer,
  type PublishedStyle,
  type RenderStrategy,
} from '@/services/gisStyles'

// --- Map canvas ------------------------------------------------------------
// The paper the map is drawn ON, not the symbology of anything in it. No QGIS
// layer defines these; they are the sheet and the annotation pen, and belong to
// the application's map chrome rather than to the cartographic registry.
export const MAP_BACKGROUND = '#f2efe9'       // cream land base
export const LABEL_COLOR = '#444444'          // city / primary labels
export const LABEL_COLOR_MUTED = '#666666'    // suburb / secondary labels
export const LABEL_COLOR_WATER = '#4a80a0'    // waterway labels
export const LABEL_HALO = 'rgba(255,255,255,0.9)'

// --- Diagnostic appearance for an unresolved layer -------------------------
// Deliberately drab and uniform so "the registry did not answer" is visually
// unmistakable and can never be mistaken for approved cartography.
const UNRESOLVED_FILL = '#d4d4d4'
const UNRESOLVED_LINE = '#a3a3a3'
const UNRESOLVED_POINT = '#8a8a8a'

export interface BasemapStyleLayer {
  id: string
  type: 'fill' | 'line' | 'circle' | 'symbol'
  source: string
  'source-layer': string
  minzoom?: number
  maxzoom?: number
  paint: Record<string, any>
  layout?: Record<string, any>
}

/**
 * Loads the published stylesheet. Call once before adding layers; every
 * resolver below reads the cache this fills.
 */
export async function loadPublishedSymbology(): Promise<PublishedStyle[]> {
  return getPublishedStylesheet()
}

/** The published style for a layer, if the stylesheet has been loaded. */
export function publishedStyleFor(layerId: string): PublishedStyle | null {
  return peekPublishedStyle(layerId)
}

/**
 * How this layer must be drawn. `wms` means the authored QGIS symbology cannot
 * be expressed in MapLibre and the caller must request a QGIS Server raster
 * rather than drawing vector layers.
 */
export function renderStrategyFor(layerId: string): RenderStrategy {
  return peekPublishedStyle(layerId)?.renderStrategy ?? 'vector'
}

/** The diagnostic grey used when no published style resolved. */
function unresolvedLayer(layer: Pick<TileLayerMeta, 'id' | 'geomType'>): BasemapStyleLayer {
  const sourceId = `vungu-${layer.id}`
  const base = { id: sourceId, source: sourceId, 'source-layer': layer.id }
  if (layer.geomType === 'line') {
    return { ...base, type: 'line', paint: { 'line-color': UNRESOLVED_LINE, 'line-width': 1 } }
  }
  if (layer.geomType === 'point') {
    return {
      ...base,
      type: 'circle',
      paint: {
        'circle-color': UNRESOLVED_POINT, 'circle-radius': 3,
        'circle-stroke-color': '#ffffff', 'circle-stroke-width': 1,
      },
    }
  }
  return {
    ...base,
    type: 'fill',
    paint: {
      'fill-color': UNRESOLVED_FILL,
      'fill-opacity': 0.4,
      'fill-outline-color': UNRESOLVED_LINE,
    },
  }
}

let warnedUnresolved = false

/**
 * Every MapLibre layer for a tile layer, as compiled from its published style.
 *
 * Returns an ARRAY because one style document can need several MapLibre layers
 * that MapLibre cannot express as one: a polygon with a wide outline is
 * fill + line, a statutory road is casing + ink, a labelled layer adds a symbol
 * layer. Those groupings come from the registry, not from this file.
 *
 * An empty array means "do not draw as vectors" -- check renderStrategyFor().
 */
export function styleLayersFor(
  layer: Pick<TileLayerMeta, 'id' | 'geomType' | 'group'>,
): BasemapStyleLayer[] {
  const style = peekPublishedStyle(layer.id)

  if (!style) {
    if (!warnedUnresolved) {
      warnedUnresolved = true
      console.warn(
        '[vungu-basemap] no published style resolved from the GIS symbology registry; '
        + 'layers render in diagnostic grey. Check GET /api/gis/styles.',
      )
    }
    return [unresolvedLayer(layer)]
  }

  // A server-rendered style must never be approximated with vector paint.
  if (style.renderStrategy !== 'vector') return []

  return style.maplibre.map((l: CompiledMapLayer) => ({ ...l }) as BasemapStyleLayer)
}

/**
 * The primary style layer for a tile layer.
 * Kept for callers that add a single layer; prefer styleLayersFor().
 */
export function styleLayerFor(
  layer: Pick<TileLayerMeta, 'id' | 'geomType' | 'group'>,
): BasemapStyleLayer {
  const layers = styleLayersFor(layer)
  // The casing is a halo beneath the ink; the ink carries the colour, so it is
  // the meaningful "primary" layer.
  const primary = layers.find((l) => !l.id.endsWith('-casing')) ?? layers[0]
  return primary ?? unresolvedLayer(layer)
}

/**
 * Paint for the shared road-casing layer.
 *
 * The basemap draws ALL road casings below ALL road fills so intersections
 * merge cleanly, which needs the casing paint available separately from its
 * own layer. Sourced from the published road style's compiled casing layer.
 */
export function roadCasingPaint(): Record<string, any> {
  const casing = peekPublishedStyle('roads')?.maplibre.find((l) => l.id.endsWith('-casing'))
  return casing ? { ...casing.paint } : { 'line-color': UNRESOLVED_LINE, 'line-width': 1.5 }
}

// --- Legend / swatch resolution -------------------------------------------

/** Pulls a representative colour out of a compiled MapLibre paint value. */
function firstColorOf(value: unknown): string | null {
  if (typeof value === 'string') return value.startsWith('#') ? value : null
  if (Array.isArray(value)) {
    // A match/step/interpolate expression: the LAST literal hex is the
    // fallback, which is the most representative single swatch for the layer.
    for (let i = value.length - 1; i >= 0; i--) {
      const found = firstColorOf(value[i])
      if (found) return found
    }
  }
  return null
}

/**
 * The legend / filter-chip swatch for a layer.
 *
 * Derived from the SAME compiled paint the map draws with, so a swatch can
 * never disagree with the map -- which is the only reason a chip palette
 * existed in this module in the first place.
 */
export function chipColorFor(
  layerId: string,
  geomType: 'polygon' | 'line' | 'point' = 'polygon',
): string {
  const style = peekPublishedStyle(layerId)
  if (style) {
    for (const l of style.maplibre) {
      if (l.id.endsWith('-casing') || l.type === 'symbol') continue
      const colour = firstColorOf(
        l.paint['fill-color'] ?? l.paint['line-color'] ?? l.paint['circle-color'],
      )
      if (colour) return colour
    }
  }
  return geomType === 'line' ? UNRESOLVED_LINE
    : geomType === 'point' ? UNRESOLVED_POINT : UNRESOLVED_FILL
}

/**
 * Classification entries for a layer's legend as `{ label → colour }`, taken
 * from the published style's categories. Replaces the exported colour tables
 * the legend used to import directly.
 */
export function classificationColorsFor(layerId: string): Record<string, string> {
  const categories = peekPublishedStyle(layerId)?.definition?.renderer?.categories
  if (!Array.isArray(categories)) return {}
  const out: Record<string, string> = {}
  for (const cat of categories) {
    const colour = cat?.symbol?.fill ?? cat?.symbol?.stroke
    if (colour) out[String(cat.label ?? cat.value)] = colour
  }
  return out
}
