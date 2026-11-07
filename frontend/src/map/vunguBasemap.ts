// src/map/vunguBasemap.ts
// Adds the PostGIS vector-tile basemap layers to any MapLibre map.
// One call per map, after the map's 'load' event. Idempotent.
import maplibregl from 'maplibre-gl'
import { tileUrlTemplate, getTileLayerCatalog, getFeature, type TileLayerMeta } from '@/services/vectorTiles'
import { absoluteApiUrl } from '@/services/runtimeOrigin'
import {
  styleLayersFor, roadCasingPaint, renderStrategyFor, loadPublishedSymbology,
} from './vunguBasemapStyle'

type Group = TileLayerMeta['group']

/** MapLibre logs `Unimplemented type: 4` (MultiPoint / unknown MVT geom) via
 *  console.error inside Evented.fire, before any map `error` listener runs.
 *  Patch once so every basemap consumer stays quiet for that known tile noise. */
let mapLibreNoiseSilenced = false
function silenceBenignMapLibreErrors(): void {
  if (mapLibreNoiseSilenced) return
  mapLibreNoiseSilenced = true
  const orig = console.error
  console.error = (...args: unknown[]) => {
    const a0 = args[0]
    const msg = a0 instanceof Error ? a0.message : typeof a0 === 'string' ? a0 : ''
    if (/unimplemented type/i.test(msg)) return
    orig.apply(console, args as Parameters<typeof console.error>)
  }
}

function attachBasemapErrorHandler(map: any): void {
  if (map.__vunguErrorBound) return
  map.__vunguErrorBound = true
  silenceBenignMapLibreErrors()
  map.on('error', (e: any) => {
    const msg = e?.error?.message ?? ''
    if (/fetch|network|ajax|load|glyph|tile|font|ERR_|unimplemented type/i.test(msg)) return
    if (msg) console.warn('[vungu basemap]', msg)
  })
}

/** Admin layer ids — the set that gets labels + click-to-zoom behavior. */
const ADMIN_LAYERS = new Set(['country', 'provinces', 'districts', 'wards'])

/** Min-zoom at which each admin layer's labels start appearing. */
const ADMIN_LABEL_MINZOOM: Record<string, number> = {
  country: 3, provinces: 5, districts: 7, wards: 10,
}
/** Label text size per admin level. */
const ADMIN_LABEL_SIZE: Record<string, number> = {
  country: 14, provinces: 12, districts: 10, wards: 9,
}

/**
 * Line layers that get name labels rendered along the line. `text-field`
 * reads `name` (the OSM/Geofabrik feature name). Min-zoom is tuned so the
 * names don't crowd low-zoom views.
 */
const LINE_LABEL_CONFIG: Record<string, { minzoom: number; size: number; color: string }> = {
  // OSM-Carto label tones: #444 street labels, grey railways, and the
  // ocean-blue #4a80a0 for waterways. White halos (set on the symbol
  // layer) keep them legible on the cream land.
  roads:     { minzoom: 11, size: 11, color: '#444444' },
  railways:  { minzoom: 10, size: 10, color: '#707070' },
  waterways: { minzoom: 11, size: 10, color: '#4a80a0' },
}

/**
 * Point / polygon layers that get a centroid label rendered above the
 * feature. Min-zoom tuned so labels only appear once the feature itself
 * is large enough to read against — Google-Maps style progressive reveal
 * as you zoom from country (z6) down to street/building (z18+).
 */
interface PointLabelCfg {
  minzoom: number
  /** Fixed px size, or a MapLibre expression (used for place-name hierarchy). */
  size: number | any[]
  color: string
  /** Anchor offset from the point (em) — used for symbol-placement: 'point'. */
  offsetY?: number
  /** Uppercase the label (suburb-style for place_areas / protected_areas). */
  uppercase?: boolean
}

// Place-name size by OSM `fclass` — city names large and prominent
// (16-20 px at z13), towns/villages stepping down, hamlets small.
const PLACE_SIZE_EXPR: any = [
  'match', ['get', 'fclass'],
  'city',           18,
  'town',           14,
  'village',        11.5,
  'suburb',         11,
  'neighbourhood',  10,
  'hamlet',         9.5,
  'locality',       9.5,
  'isolated_dwelling', 9,
  11,
]

const POINT_LABEL_CONFIG: Record<string, PointLabelCfg> = {
  // Cities / towns / villages — size hierarchy by fclass, OSM-Carto #444.
  places_points:            { minzoom: 6,  size: PLACE_SIZE_EXPR, color: '#444444', offsetY: 0.9 },
  places_areas:             { minzoom: 10, size: 11, color: '#666666', uppercase: true },
  // POIs (hospital, school, market, …).
  pois_points:              { minzoom: 14, size: 10, color: '#7b5a16', offsetY: 0.9 },
  pois_areas:               { minzoom: 14, size: 10, color: '#7b5a16' },
  // Transport (airports, stations, bus stops).
  transport_points:         { minzoom: 12, size: 10, color: '#0070b0', offsetY: 0.9 },
  transport_areas:          { minzoom: 13, size: 10, color: '#0070b0' },
  // Natural / protected areas.
  natural_points:           { minzoom: 14, size: 10, color: '#4c7a2f', offsetY: 0.9 },
  natural_areas:            { minzoom: 11, size: 10, color: '#4c7a2f' },
  protected_areas:          { minzoom: 8,  size: 11, color: '#4c7a2f', uppercase: true },
  // Worship.
  places_of_worship_points: { minzoom: 14, size: 10, color: '#6b4e96', offsetY: 0.9 },
  places_of_worship_areas:  { minzoom: 14, size: 10, color: '#6b4e96' },
  // Buildings — only labeled when named, at a high zoom.
  buildings:                { minzoom: 17, size: 10, color: '#666666' },
}

// Draw order (bottom -> top), per the OSM-Carto layer-order spec:
// landuse -> water -> buildings -> roads -> POIs -> admin overlay.
// Vungu RDC master-plan overlays sit just above generic landuse so the
// council's zoning paints on top of OSM land cover, but below roads,
// buildings and admin boundaries.
const GROUP_ORDER: Group[] = ['landuse', 'master_plan', 'hydro', 'structures', 'transport', 'poi', 'admin']

/**
 * Synthetic per-building height (metres) for the 3D extrusion. OSM
 * Zimbabwe has no height tag, so this derives one: a per-`type` base
 * (apartments tall, huts short), and for the ~98% untyped buildings a
 * small deterministic jitter keyed off `fid` (5 / 7 / 9 / 11 m) so a
 * suburb reads as textured massing rather than one flat slab.
 */
const BUILDING_HEIGHT_EXPR: any = [
  'case',
  ['==', ['get', 'type'], 'apartments'],    24,
  ['==', ['get', 'type'], 'commercial'],    15,
  ['==', ['get', 'type'], 'retail'],        12,
  ['==', ['get', 'type'], 'industrial'],    13,
  ['==', ['get', 'type'], 'train_station'], 14,
  ['==', ['get', 'type'], 'school'],        11,
  ['==', ['get', 'type'], 'detached'],       7,
  ['==', ['get', 'type'], 'house'],          6,
  ['==', ['get', 'type'], 'roof'],           4,
  ['==', ['get', 'type'], 'shed'],           4,
  ['==', ['get', 'type'], 'hut'],            3,
  ['==', ['get', 'type'], 'construction'],   5,
  // Untyped majority: 5 / 7 / 9 / 11 m by fid parity.
  ['+', 5, ['*', ['%', ['to-number', ['get', 'fid']], 4], 2]],
]

/**
 * Backwards-compat: a hint for callers (and tests) of what *can* be the
 * starter set. By default `addVunguBasemap` now turns ALL layers visible
 * and trusts each layer's per-source `minzoom` to gate dense ones
 * (buildings z14+, POIs z13+, etc.) so they only render once the user
 * has zoomed in far enough.
 *
 * `country` MUST stay in this set and MUST NOT be exposed as a toggle
 * elsewhere — it is the always-on outline that anchors the map.
 */
export const DEFAULT_VISIBLE: ReadonlySet<string> = new Set([
  'country', 'provinces', 'districts', 'wards',
  'water_areas', 'waterways', 'protected_areas', 'natural_areas',
  'roads', 'railways',
  'landuse', 'admin_areas', 'places_areas',
  'buildings', 'traffic_areas', 'transport_areas', 'pois_areas', 'places_of_worship_areas',
  'places_points', 'pois_points', 'traffic_points', 'transport_points',
  'natural_points', 'places_of_worship_points',
  // Stand polygons must be on by default so click-to-identify (sold/status) works.
  'stands',
])

/**
 * What the planner's map shows on arrival: the boundaries and roads that orient a planner, water,
 * and the Vungu planning zones. Everything else in the catalogue is one click away in the layer
 * panel, not drawn by default. (addVunguBasemap's own default is "all", which suits the public
 * explorer, where the aim is to show the data. A planner works on the zones.)
 */
export const PLANNER_BASEMAP_DEFAULT: ReadonlySet<string> = new Set([
  'country', 'provinces', 'districts', 'wards',
  'roads', 'railways', 'water_areas', 'waterways',
  'vungu_proposed_peri_urban_zones', 'vungu_beyond_peri_urban_zones',
])

/** Layer id that can never be hidden. */
export const ALWAYS_ON_LAYER = 'country'

export interface BasemapOptions {
  /** Restrict to these groups. Default: all. */
  groups?: Group[]
  /** Emit a 'feature-click' CustomEvent on click. Default: true. */
  interactive?: boolean
  /** Override default-visible layer ids. `country` is always added regardless. */
  defaultVisible?: ReadonlySet<string> | string[]
  /**
   * Auto-tilt the camera into a 3D view when the user zooms into a city
   * (pitch eases to 48 deg at z>=15, back to flat below z13.5) so the 3D
   * building extrusions read. Default: true. Respects reduced-motion.
   */
  autoTilt?: boolean
  /**
   * Put every basemap layer beneath this style layer, if it exists. The basemap is added after an
   * asynchronous catalogue fetch, so a caller that draws its own overlays meanwhile (the planner's
   * drawing, CAD and planning layers) would otherwise end up UNDER the basemap.
   */
  beforeId?: string
}

/** Resolves once the map's style can accept sources and layers. */
function whenStyleLoaded(map: any): Promise<void> {
  // `style._loaded` rather than `isStyleLoaded()`: the latter also waits on
  // every source's tiles, and would stay false on a map that is already
  // streaming tiles — long after 'style.load' has fired and gone.
  if (!map?.style || map.style._loaded) return Promise.resolve()
  return new Promise((resolve) => map.once('style.load', () => resolve()))
}

/**
 * Adds vector-tile sources + style layers for the zimbabwe.gpkg dataset.
 * Safe to call once per map. Failures are swallowed per-layer so one bad
 * layer never blanks the map.
 */
export async function addVunguBasemap(map: any, options: BasemapOptions = {}): Promise<{ layerCount: number }> {
  attachBasemapErrorHandler(map)
  const { groups, interactive = true, autoTilt = true } = options
  // Data catalogue and published symbology are independent concerns fetched in
  // parallel: the catalogue says WHICH layers exist and where their tiles are,
  // the registry says HOW each one is drawn. Both must be in hand before the
  // first layer is added, or layers would be styled before their style arrives.
  const [catalog] = await Promise.all([
    getTileLayerCatalog(),
    loadPublishedSymbology(),
  ])

  if (!catalog.length) {
    return { layerCount: 0 }
  }

  // The catalogue is a cached promise, so on every map after the first it
  // resolves in a microtask — before MapLibre has finished loading even an
  // inline style. addSource/addLayer then throw "Style is not done loading",
  // the per-layer catch below swallows all of them, and the map comes up as
  // a bare background. Wait for the style, whoever the caller is.
  await whenStyleLoaded(map)

  // The caller may have removed the map (view unmounted) while the catalogue
  // was in flight; a removed map has no style and every addSource would throw.
  if (map._removed || !map.style) return { layerCount: 0 }

  // Default: every layer is visible (each layer's `minzoom` gates dense
  // ones so they only render once the user is zoomed in). Caller may
  // pass `defaultVisible` to limit the visible set; `country` is always
  // added regardless.
  const visibleSet = options.defaultVisible
    ? new Set<string>([...Array.from(options.defaultVisible as Iterable<string>), ALWAYS_ON_LAYER])
    : new Set<string>(catalog.map((l) => l.id))
  visibleSet.add(ALWAYS_ON_LAYER)

  const wanted = catalog
    .filter((l) => !groups || groups.includes(l.group))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))

  for (const layer of wanted) {
    const sourceId = `vungu-${layer.id}`
    try {
      if (!map.getSource(sourceId)) {
        // Build the tile URL the careful way:
        //  - Must be absolute (MapLibre's tile worker uses `new Request(url)`
        //    and has no document.baseURI / window.location to resolve relative
        //    paths against; relative URLs error with "Failed to parse URL").
        //  - Must NOT URL-encode the `{z}/{x}/{y}` placeholders (`new URL(...)`
        //    would turn them into %7Bz%7D... and MapLibre would never
        //    substitute the coords).
        // tileUrlTemplate() is already absolute (incl. Tauri → :3000).
        map.addSource(sourceId, {
          type: 'vector',
          tiles: [tileUrlTemplate(layer.id)],
          minzoom: layer.minzoom,
          maxzoom: layer.maxzoom,
        })
      }
      // Road casing — the darker stroke under every road fill. OSM Carto
      // renders ALL casings as one layer below ALL fills so intersections
      // merge cleanly. Colours + widths come from roadCasingPaint() in
      // vunguBasemapStyle.ts (single source of truth for road dimensions).
      // Added BEFORE the road fill so it renders underneath.
      if (layer.id === 'roads') {
        const casingId = `${sourceId}-casing`
        if (!map.getLayer(casingId)) {
          // line-cap / line-join are LAYOUT properties in MapLibre, not paint —
          // putting them in paint produces a console error and they get ignored.
          map.addLayer({
            id: casingId,
            type: 'line',
            source: sourceId,
            'source-layer': layer.id,
            minzoom: 10,
            maxzoom: layer.maxzoom,
            paint: roadCasingPaint(),
            layout: {
              visibility: visibleSet.has(layer.id) ? 'visible' : 'none',
              'line-cap': 'round',
              'line-join': 'round',
            },
          })
        }
      }

      if (layer.id === 'buildings') {
        // Buildings render as a 3D fill-extrusion instead of a flat fill.
        // OSM Zimbabwe has no height attribute, so height is synthesised:
        // a per-`type` base (apartments tall, huts short) with a small
        // per-`fid` jitter so a suburb reads as varied massing, not a
        // uniform slab. Heights interpolate in from 0 at z14 so the
        // flat-footprint to 3D transition is smooth.
        if (!map.getLayer(sourceId)) {
          const visibility = visibleSet.has(layer.id) ? 'visible' : 'none'
          map.addLayer({
            id: sourceId,
            type: 'fill-extrusion',
            source: sourceId,
            'source-layer': layer.id,
            minzoom: layer.minzoom,
            maxzoom: layer.maxzoom,
            layout: { visibility },
            paint: {
              // OSM-Carto building grey; the vertical gradient shades the
              // walls so the 3D massing reads even at a shallow pitch.
              'fill-extrusion-color': '#d9d0c9',
              'fill-extrusion-base': 0,
              'fill-extrusion-opacity': 0.95,
              'fill-extrusion-vertical-gradient': true,
              'fill-extrusion-height': [
                'interpolate', ['linear'], ['zoom'],
                14, 0,
                16.5, BUILDING_HEIGHT_EXPR,
              ] as any,
            },
          })
          if (interactive) wireCursor(map, sourceId)
        }
      } else if (!map.getLayer(sourceId)) {
        const visibility = visibleSet.has(layer.id) ? 'visible' : 'none'

        // A published style can need SEVERAL MapLibre layers that MapLibre
        // cannot express as one -- fill + wide outline, road casing + ink,
        // plus a label layer. The registry decides that grouping; adding only
        // the first would drop outlines and labels.
        const styleLayers = styleLayersFor(layer)

        if (!styleLayers.length && renderStrategyFor(layer.id) !== 'vector') {
          // The authored QGIS symbology cannot be reproduced in MapLibre
          // (procedural hatch, SVG marker, expression-driven rule). Drawing an
          // approximation here would show planners unapproved cartography, so
          // the layer is skipped and left to the QGIS Server WMS overlay.
          console.info(
            `[vungu-basemap] "${layer.id}" is server-rendered symbology `
            + '(strategy=wms); skipped in the vector basemap.',
          )
        }

        // The first layer keeps the bare source id so every existing consumer
        // -- visibility toggles, click handlers, feature-state hover -- keeps
        // working against the id it already uses.
        styleLayers.forEach((styleLayer, i) => {
          const id = i === 0 ? sourceId : styleLayer.id
          if (map.getLayer(id)) return
          map.addLayer({
            ...styleLayer,
            id,
            minzoom: styleLayer.minzoom ?? layer.minzoom,
            maxzoom: styleLayer.maxzoom ?? layer.maxzoom,
            layout: { ...(styleLayer.layout || {}), visibility },
          })
        })

        if (styleLayers.length && interactive) wireCursor(map, sourceId)
      }

      // Provinces additionally get a paired line layer for the boundary
      // stroke — the fill is colour-coded per province, but a thin slate
      // outline keeps the regions visually crisp where similar pastels
      // meet (e.g. Mashonaland Central vs Mashonaland East).
      if (layer.id === 'provinces') {
        const outlineId = `${sourceId}-outline`
        if (!map.getLayer(outlineId)) {
          const labelVisibility = visibleSet.has(layer.id) ? 'visible' : 'none'
          map.addLayer({
            id: outlineId,
            type: 'line',
            source: sourceId,
            'source-layer': layer.id,
            minzoom: layer.minzoom,
            maxzoom: layer.maxzoom,
            paint: {
              'line-color': '#7a8089',
              'line-width': 1.0,
              'line-opacity': [
                'interpolate', ['linear'], ['zoom'],
                0, 1, 9, 1, 12, 0.5, 16, 0.2,
              ] as any,
            },
            layout: { visibility: labelVisibility },
          })
        }
      }

      // Railways — classic cross-tick symbology. Short dashes drawn much
      // wider than the base line read as perpendicular sleepers, so rail
      // can never be mistaken for a river.
      if (layer.id === 'railways') {
        const ticksId = `${sourceId}-ticks`
        if (!map.getLayer(ticksId)) {
          const v = visibleSet.has(layer.id) ? 'visible' : 'none'
          map.addLayer({
            id: ticksId,
            type: 'line',
            source: sourceId,
            'source-layer': layer.id,
            minzoom: layer.minzoom,
            maxzoom: layer.maxzoom,
            paint: {
              'line-color': '#707070',
              // dasharray units are line-widths: 0.12 wide × ~5 px tall
              // slivers every ~1.6 widths → evenly spaced cross-ticks.
              'line-width': [
                'interpolate', ['linear'], ['zoom'],
                8, 3.5, 12, 5, 16, 7,
              ] as any,
              'line-dasharray': [0.12, 1.6],
            },
            layout: { visibility: v },
          })
        }
      }

      // For line layers (roads/railways/waterways) add a paired symbol
      // layer that draws `name` *along* the line via symbol-placement:line.
      // For roads, ALSO add a pill-shaped route shield layer for `ref`
      // (A17, R6, …) so the map reads the way OSM Carto and Google show
      // their highway shields, not as inlined text.
      if (LINE_LABEL_CONFIG[layer.id]) {
        const lineLabelId = `${sourceId}-label`
        if (!map.getLayer(lineLabelId)) {
          const cfg = LINE_LABEL_CONFIG[layer.id]
          const v = visibleSet.has(layer.id) ? 'visible' : 'none'
          map.addLayer({
            id: lineLabelId,
            type: 'symbol',
            source: sourceId,
            'source-layer': layer.id,
            minzoom: cfg.minzoom,
            maxzoom: layer.maxzoom,
            filter: ['all', ['has', 'name'], ['!=', ['get', 'name'], '']],
            layout: {
              'text-field': ['get', 'name'],
              'symbol-placement': 'line',
              'text-size': cfg.size,
              'text-letter-spacing': 0.02,
              'text-padding': 4,
              'symbol-spacing': 220,
              visibility: v,
            },
            paint: {
              'text-color': cfg.color,
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.4,
              'text-halo-blur': 0.5,
            },
          })
        }

        // Route-shield layer (roads only). The shield needs a canvas-
        // generated icon registered via map.addImage; in test/SSR
        // environments without canvas or addImage support we skip
        // both the image AND the layer to keep behaviour deterministic.
        if (layer.id === 'roads' && typeof map.addImage === 'function') {
          const shieldId = `${sourceId}-shield`
          if (!map.hasImage?.('road-shield')) {
            const img = createRoadShieldImage()
            if (img) map.addImage('road-shield', img.data as any, img.options as any)
          }
          if (!map.getLayer(shieldId) && map.hasImage?.('road-shield')) {
            const v = visibleSet.has(layer.id) ? 'visible' : 'none'
            map.addLayer({
              id: shieldId,
              type: 'symbol',
              source: sourceId,
              'source-layer': layer.id,
              minzoom: 10,
              maxzoom: layer.maxzoom,
              filter: ['all', ['has', 'ref'], ['!=', ['get', 'ref'], '']],
              layout: {
                'symbol-placement': 'line',
                'symbol-spacing': 300,
                'text-field': ['get', 'ref'],
                'text-size': 10,
                'text-letter-spacing': 0.04,
                'text-padding': 2,
                'icon-image': 'road-shield',
                'icon-text-fit': 'both',
                'icon-text-fit-padding': [2, 6, 2, 6],
                'icon-allow-overlap': false,
                'text-allow-overlap': false,
                'text-optional': false,
                visibility: v,
              },
              paint: {
                'text-color': '#3c4043',
              },
            })
          }
        }
      }

      // For tabular POI / area layers, add a centroid label so the user
      // sees feature names (suburbs, hospitals, parks, airports, churches,
      // named buildings) as they zoom in.
      if (POINT_LABEL_CONFIG[layer.id] && !ADMIN_LAYERS.has(layer.id)) {
        const ptLabelId = `${sourceId}-label`
        if (!map.getLayer(ptLabelId)) {
          const cfg = POINT_LABEL_CONFIG[layer.id]
          const v = visibleSet.has(layer.id) ? 'visible' : 'none'
          map.addLayer({
            id: ptLabelId,
            type: 'symbol',
            source: sourceId,
            'source-layer': layer.id,
            minzoom: cfg.minzoom,
            maxzoom: layer.maxzoom,
            filter: ['all', ['has', 'name'], ['!=', ['get', 'name'], '']],
            layout: {
              'text-field': ['get', 'name'],
              'text-size': cfg.size,
              'text-offset': cfg.offsetY ? [0, cfg.offsetY] : [0, 0],
              'text-anchor': cfg.offsetY ? 'top' : 'center',
              'text-padding': 4,
              'text-allow-overlap': false,
              'text-optional': true,
              'text-transform': cfg.uppercase ? 'uppercase' : 'none',
              'text-letter-spacing': cfg.uppercase ? 0.08 : 0,
              visibility: v,
            },
            paint: {
              'text-color': cfg.color,
              'text-halo-color': '#ffffff',
              'text-halo-width': 1.4,
              'text-halo-blur': 0.5,
            },
          })
        }
      }

      // For admin layers, add a paired symbol layer that draws the place
      // name from MVT `name_en`. Min-zoom is tuned per level so labels
      // appear as you zoom in (country → province → district → ward).
      if (ADMIN_LAYERS.has(layer.id)) {
        const labelId = `${sourceId}-label`
        if (!map.getLayer(labelId)) {
          const labelVisibility = visibleSet.has(layer.id) ? 'visible' : 'none'
          map.addLayer({
            id: labelId,
            type: 'symbol',
            source: sourceId,
            'source-layer': layer.id,
            minzoom: ADMIN_LABEL_MINZOOM[layer.id] ?? layer.minzoom,
            maxzoom: layer.maxzoom,
            layout: {
              'text-field': ['coalesce', ['get', 'name_en'], ['get', 'name'], ''],
              'text-size': ADMIN_LABEL_SIZE[layer.id] ?? 11,
              'text-allow-overlap': false,
              'text-padding': 6,
              'text-transform': layer.id === 'country' ? 'uppercase' : 'none',
              'text-letter-spacing': layer.id === 'country' ? 0.1 : 0,
              visibility: labelVisibility,
            },
            paint: {
              'text-color': layer.id === 'country' ? '#5b5b5b' : '#444444',
              'text-halo-color': 'rgba(255,255,255,0.9)',
              'text-halo-width': 1.5,
              'text-halo-blur': 0.4,
            },
          })
        }
      }
      // ── Vungu master-plan labels ────────────────────────────────────────
      // Each council layer gets a centroid label showing the most useful
      // planning attribute (zone name, parcel name, settlement category).
      // Labels appear as you zoom in so they don't crowd the district view.
      const MASTER_LABEL: Record<string, { field: string; minzoom: number; size: number; color: string }> = {
        stands:                          { field: 'stand_number', minzoom: 13, size: 10, color: '#0b3d28' },
        vungu_proposed_peri_urban_zones: { field: 'zone',         minzoom: 11, size: 10, color: '#7d1a40' },
        vungu_beyond_peri_urban_zones:   { field: 'settlement',   minzoom: 10, size: 9.5, color: '#4b3880' },
        vungu_farm_cadastre:             { field: 'name',         minzoom: 11, size: 9.5, color: '#7a6030' },
        vungu_parcels:                   { field: 'name',         minzoom: 12, size: 9,   color: '#7a5010' },
        vungu_cemeteries:                { field: 'name',         minzoom: 13, size: 9,   color: '#3a6048' },
        vungu_waste_management:          { field: 'use',          minzoom: 13, size: 9,   color: '#606050' },
      }
      if (MASTER_LABEL[layer.id]) {
        const mlId = `${sourceId}-master-label`
        if (!map.getLayer(mlId)) {
          const ml = MASTER_LABEL[layer.id]
          const v = visibleSet.has(layer.id) ? 'visible' : 'none'
          map.addLayer({
            id: mlId,
            type: 'symbol',
            source: sourceId,
            'source-layer': layer.id,
            minzoom: ml.minzoom,
            maxzoom: layer.maxzoom,
            layout: {
              'text-field': ['coalesce', ['get', ml.field], ''],
              'text-size': ml.size,
              'text-anchor': 'center',
              'text-max-width': 8,
              'text-allow-overlap': false,
              'text-optional': true,
              'text-padding': 3,
              visibility: v,
            },
            paint: {
              'text-color': ml.color,
              'text-halo-color': 'rgba(255,255,255,0.85)',
              'text-halo-width': 1.5,
              'text-halo-blur': 0.4,
            },
          })
        }
      }

    } catch (err) {
      console.error(`addVunguBasemap: failed to add ${layer.id}`, err)
    }
  }

  // Keep the caller's own overlays on top (see BasemapOptions.beforeId). moveLayer puts a layer
  // directly beneath beforeId, so moving them in their current order preserves that order.
  if (options.beforeId && map.getLayer(options.beforeId)) {
    for (const l of map.getStyle().layers as Array<{ id: string }>) {
      if (l.id.startsWith('vungu-')) map.moveLayer(l.id, options.beforeId)
    }
  }

  // Single map-wide click handler that dispatches one 'feature-click' for
  // the topmost feature under the cursor. Replaces N per-layer handlers
  // that would each fire on overlapping clicks and stampede getFeature.
  if (interactive) {
    const interactiveIds = wanted.map((l) => `vungu-${l.id}`)
    wireGlobalClick(map, interactiveIds)
    wireGlobalContextMenu(map, interactiveIds)
  }

  if (autoTilt) wireAutoTilt(map)
  wireLiveRefresh(map)
  return { layerCount: wanted.length }
}

/**
 * Subscribes to the backend's spatial-change SSE stream (migration 109 +
 * spatialChangeListener.js) so edits saved directly in QGIS Desktop —
 * which never touch the API — still show up without a manual page reload.
 * Wired once per map; reconnects with backoff so a backend restart doesn't
 * leave the map stale forever.
 */
function wireLiveRefresh(map: any): void {
  if (map.__vunguLiveRefresh || typeof EventSource === 'undefined') return
  map.__vunguLiveRefresh = true

  const refreshLayer = (layerId: string) => {
    const src = map.getSource?.(`vungu-${layerId}`) as any
    if (src?.type === 'vector' && typeof src.setTiles === 'function') {
      src.setTiles([`${tileUrlTemplate(layerId)}?v=${Date.now()}`])
    }
  }

  let backoff = 2000
  let source: EventSource | null = null
  const connect = () => {
    // Absolute URL so Tauri WebView reaches Fastify, not tauri.localhost.
    source = new EventSource(absoluteApiUrl('/api/map/events'))
    source.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data)
        // Hand every event to the page that owns the map (the planner repaints
        // its QGIS overlays on `type: 'style'`).
        map.fire?.('vungu:map-event', { detail: ev })
        // A style event means the QGIS symbology changed; the basemap's own
        // vector tiles are painted from the portal palette and are unaffected.
        if (ev.type !== 'style' && ev.layer) refreshLayer(ev.layer)
      } catch { /* ignore malformed */ }
    }
    source.onopen = () => { backoff = 2000 }
    source.onerror = () => {
      source?.close()
      setTimeout(connect, backoff)
      backoff = Math.min(backoff * 2, 30000)
    }
  }
  connect()

  map.on('remove', () => source?.close())
}

/**
 * Eases the camera into a 3D perspective as the user zooms into a city,
 * and back to flat (top-down) when they zoom out — so the 3D building
 * extrusions reveal themselves without the user having to discover the
 * right-drag pitch gesture. Wired once per map; respects reduced-motion.
 */
function wireAutoTilt(map: any): void {
  if (map.__vunguAutoTilt) return
  map.__vunguAutoTilt = true
  let tilted = false
  const onZoom = () => {
    if (typeof map.getZoom !== 'function') return
    const z = map.getZoom()
    const duration = prefersReducedMotion() ? 0 : 600
    if (z >= 15 && !tilted) {
      tilted = true
      map.easeTo({ pitch: 48, duration })
    } else if (z < 13.5 && tilted) {
      tilted = false
      map.easeTo({ pitch: 0, duration })
    }
  }
  map.on('zoomend', onZoom)
}

/** Hover cursor only. Click handling is centralised in wireGlobalClick so a
 *  single click on overlapping layers fires one getFeature instead of N. */
function wireCursor(map: any, styleLayerId: string): void {
  map.on('mouseenter', styleLayerId, () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', styleLayerId, () => { map.getCanvas().style.cursor = '' })
}

/**
 * Click-resolution priority. Lower number = wins over higher numbers when
 * multiple features overlap at the same pixel. The order is "most specific
 * feature beats less specific context":
 *
 *   1  point features (POI, building, landmark)
 *   2  individual cadastral / parcel polygons (parcels, cemeteries, waste)
 *   3  farms / farm cadastre
 *   4  zone overlays (peri-urban, beyond-peri-urban, planning zones, landuse)
 *   5  administrative polygons (country, provinces, districts, wards)
 *
 * Matching is on substring of the layer id so that catalog ids
 * (`vungu_farm_cadastre`) and dynamic planner ids (`planner-gweru_rural_farms`,
 * `planner-wms-gweru_rural_farms`) all resolve correctly.
 */
export function clickPriority(layerId: string): number {
  const id = String(layerId || '').toLowerCase()
  if (!id) return 99
  // 1 — points / specific landmarks
  if (id.includes('point') || id.includes('poi') || id.includes('building')) return 1
  // 2 — parcels, cemeteries, waste sites (one-stand-sized footprints)
  if (id.includes('parcel') || id.includes('cemeteries') || id.includes('waste')) return 2
  // 3 — farms (the user's complaint: this MUST beat the peri-urban zone below)
  if (id.includes('farm')) return 3
  // 4 — zone overlays + landuse (peri-urban, beyond-peri-urban, proposed zones)
  if (id.includes('zone') || id.includes('peri_urban') || id.includes('landuse')) return 4
  // 5 — administrative polygons (the country / province / ward backdrop)
  if (ADMIN_LAYERS.has(id) || id.includes('district') || id.includes('province')
      || id === 'wards' || id === 'country') return 5
  // anything not classified is treated as more specific than admin context
  return 3
}

/** Picks the highest-priority hit from a queryRenderedFeatures result. Used
 *  by the global click handler and by any per-layer click handler the host
 *  app registers (e.g. the planner's dynamic layer toggles) so all clicks
 *  resolve to the same most-specific feature. */
export function pickTopHit<T extends { layer?: { id?: string } }>(hits: T[]): T | undefined {
  if (!hits || hits.length === 0) return undefined
  let best: T | undefined
  let bestPri = Number.POSITIVE_INFINITY
  for (const h of hits) {
    const id = String(h.layer?.id || '').replace(/^vungu-/, '').replace(/^planner-/, '')
    const pri = clickPriority(id)
    if (pri < bestPri) { best = h; bestPri = pri }
  }
  return best
}

/** One map-wide click handler that picks the topmost interactive feature
 *  under the cursor and dispatches a single 'feature-click' event. Without
 *  this every catalog layer would register its own per-layer click handler
 *  — N stacked layers at one point would fire N getFeature requests and
 *  the right rail would flicker between layers as each response landed. */
function wireGlobalClick(map: any, interactiveStyleIds: string[]): void {
  const toLayerId = (h: any): string =>
    (h && h.layer && h.layer.id ? String(h.layer.id) : '').replace(/^vungu-/, '')

  map.on('click', async (e: any) => {
    const hits = map.queryRenderedFeatures(e.point, { layers: interactiveStyleIds })
    if (!hits.length) return
    // queryRenderedFeatures returns features topmost-first by render order,
    // but the layer the user is *interested in* is almost never the topmost
    // overlay. A farm sitting under a peri-urban zone overlay should win the
    // click, not the zone. pickTopHit imposes a specificity priority on the
    // hits (points > parcels > farms > zones > landuse > admin).
    const hit = pickTopHit(hits) || hits[0]
    const layerId = toLayerId(hit)
    if (!layerId) return
    const fid = hit.properties && hit.properties.fid
    const feature = fid != null ? await getFeature(layerId, Number(fid)) : null

    // Only admin units drill-zoom (province → districts → wards). Parcels,
    // buildings, zones, landuse, POIs never move the camera — the click just
    // queries the feature; the host app shows it (e.g. the planner Plot tab).
    if (feature && feature.geometry && ADMIN_LAYERS.has(layerId)) {
      zoomToAdminFeature(map, layerId, e.lngLat, feature)
    }

    map.getContainer().dispatchEvent(
      new CustomEvent('feature-click', {
        detail: { layer: layerId, fid, lngLat: e.lngLat, feature, properties: hit.properties },
      })
    )
  })
}

/** Right-click sibling of wireGlobalClick: suppresses the browser menu and dispatches
 *  a single 'feature-contextmenu' for the topmost feature under the cursor. The event
 *  fires synchronously off the rendered tile's own attributes, so the menu opens at
 *  once and still opens when the backend is slow or down. The un-clipped geometry sits
 *  behind `loadFeature()`: hosts that need the real parcel await it at the moment they
 *  use it, and hosts that only need layer + fid never pay for the request. Hosts that
 *  don't listen simply lose the default browser menu on the map canvas. */
function wireGlobalContextMenu(map: any, interactiveStyleIds: string[]): void {
  const toLayerId = (h: any): string =>
    (h && h.layer && h.layer.id ? String(h.layer.id) : '').replace(/^vungu-/, '')

  map.on('contextmenu', (e: any) => {
    if (e.originalEvent && typeof e.originalEvent.preventDefault === 'function') {
      e.originalEvent.preventDefault()
    }
    let hits: any[] = []
    try { hits = map.queryRenderedFeatures(e.point, { layers: interactiveStyleIds }) } catch { hits = [] }
    const hit = hits.length ? (pickTopHit(hits) || hits[0]) : null
    const layerId = hit ? toLayerId(hit) : ''
    const fid = hit && hit.properties ? hit.properties.fid : undefined

    // Deferred + memoised: the request is only made if a menu action asks for the
    // geometry, and repeat asks share the one in-flight promise.
    let pending: Promise<any | null> | null = null
    const loadFeature = (): Promise<any | null> => {
      if (!pending) {
        pending = (layerId && fid != null) ? getFeature(layerId, Number(fid)) : Promise.resolve(null)
      }
      return pending
    }

    map.getContainer().dispatchEvent(
      new CustomEvent('feature-contextmenu', {
        detail: {
          layer: layerId,
          fid,
          lngLat: e.lngLat,
          point: { x: e.point.x, y: e.point.y },
          loadFeature,
          properties: hit ? hit.properties : null,
        },
      })
    )
  })
}

/** Returns true when the user has asked the OS for reduced motion. */
export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

/**
 * Generates a 9-slice pill-shaped image that MapLibre can stretch around
 * variable-width route refs (A17, R6, ZW123, …). Cream-yellow fill with a
 * warm-brown stroke — same palette as the motorway/trunk casing so the
 * shields and the road network share a visual family.
 *
 * Returns an `ImageData` plus the stretch metadata MapLibre needs to
 * grow the image without distorting its rounded corners. Returns `null`
 * in environments without a canvas (SSR, headless test runners).
 */
function createRoadShieldImage(): {
  data: ImageData
  options: { stretchX: number[][]; stretchY: number[][]; content: number[]; pixelRatio: number }
} | null {
  if (typeof document === 'undefined') return null
  const w = 32
  const h = 18
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  if (!ctx) return null
  // Rounded-rectangle highway shield, OSM-Carto style: a yellow-orange
  // badge with a dark border and an inner white border ring.
  const roundRect = (x: number, y: number, rw: number, rh: number) => {
    const rr = rh / 2
    ctx.beginPath()
    ctx.moveTo(x + rr, y)
    ctx.lineTo(x + rw - rr, y)
    ctx.quadraticCurveTo(x + rw, y, x + rw, y + rr)
    ctx.lineTo(x + rw, y + rh - rr)
    ctx.quadraticCurveTo(x + rw, y + rh, x + rw - rr, y + rh)
    ctx.lineTo(x + rr, y + rh)
    ctx.quadraticCurveTo(x, y + rh, x, y + rh - rr)
    ctx.lineTo(x, y + rr)
    ctx.quadraticCurveTo(x, y, x + rr, y)
    ctx.closePath()
  }
  // Outer dark border
  roundRect(0.5, 0.5, w - 1, h - 1)
  ctx.fillStyle = '#b07000'
  ctx.fill()
  // Inner white ring
  roundRect(2, 2, w - 4, h - 4)
  ctx.fillStyle = '#ffffff'
  ctx.fill()
  // Yellow-orange shield fill
  roundRect(3.2, 3.2, w - 6.4, h - 6.4)
  ctx.fillStyle = '#fcd6a4'
  ctx.fill()
  return {
    data: ctx.getImageData(0, 0, w, h),
    options: {
      // Stretchable middle (8 to 24 px on X); corners stay rounded.
      stretchX: [[8, 24]],
      stretchY: [[5, 13]],
      content: [6, 4, 26, 14], // padding box for the ref text
      pixelRatio: 1,
    },
  }
}

/** Fit map to the admin feature's bounds, drill down, and show a details popup. */
function zoomToAdminFeature(map: any, layerId: string, lngLat: any, feature: any): void {
  const bbox = bboxOfGeometry(feature.geometry)
  if (bbox) {
    // Per-level cap so a country click doesn't zoom past province scale.
    const maxZoom = layerId === 'country' ? 6
      : layerId === 'provinces' ? 9
      : layerId === 'districts' ? 11 : 13
    // Honour prefers-reduced-motion (WCAG 2.1 SC 2.3.3): collapse the
    // 700 ms ease-out-quart flight to a 0 ms jump for users who have
    // motion sensitivity preferences set at the OS level.
    const duration = prefersReducedMotion() ? 0 : 700
    map.fitBounds(bbox, { padding: 40, maxZoom, duration })
  }

  applyDrillDown(map, layerId, feature.properties || {})

  const p = feature.properties || {}
  const name = p.name_en || p.name || 'Unknown'
  const levelLabel = layerId.charAt(0).toUpperCase() + layerId.slice(1, -1)  // 'districts' → 'District'
  // Markup uses class names defined in src/styles/maplibre-polish.css so
  // the popup picks up the same visual language as the rest of the portal
  // without inline-style soup.
  const html = `
    <div class="vungu-popup-eyebrow">${levelLabel}</div>
    <h3 class="vungu-popup-title">${escapeHtml(name)}</h3>
    <div class="vungu-popup-meta">
      ${p.pcode ? `<div>Code: <strong>${escapeHtml(p.pcode)}</strong></div>` : ''}
      ${p.parent_pcode ? `<div>Parent: ${escapeHtml(p.parent_pcode)}</div>` : ''}
      ${p.level != null ? `<div>Level: ${escapeHtml(String(p.level))}</div>` : ''}
    </div>`
  new maplibregl.Popup({
    offset: 12,
    closeButton: true,
    maxWidth: '260px',
    className: 'vungu-popup',
  })
    .setLngLat(lngLat)
    .setHTML(html)
    .addTo(map)
}

/**
 * Implements the drill-down: clicking a province exposes its districts +
 * wards (filtered to that province); clicking a district exposes its
 * wards (filtered to that district); clicking the country resets the
 * children to their defaults so the whole picture comes back.
 *
 * Pcodes are hierarchical:
 *   province ZW19  →  district ZW1921  →  ward ZW192102
 * So a ward belongs to a province iff its pcode starts with the province
 * pcode (4 chars). Districts use the simpler parent_pcode == pcode rule.
 */
function applyDrillDown(map: any, layerId: string, props: Record<string, any>): void {
  const pcode = props.pcode
  if (!pcode) return

  if (layerId === 'provinces') {
    setBasemapLayerVisible(map, 'districts', true)
    setLayerFilterFamily(map, 'districts', ['==', ['get', 'parent_pcode'], pcode])
    setBasemapLayerVisible(map, 'wards', true)
    setLayerFilterFamily(map, 'wards', [
      '==', ['slice', ['get', 'pcode'], 0, pcode.length], pcode,
    ])
  } else if (layerId === 'districts') {
    setBasemapLayerVisible(map, 'wards', true)
    setLayerFilterFamily(map, 'wards', ['==', ['get', 'parent_pcode'], pcode])
  } else if (layerId === 'country') {
    // Reset: clear filters and restore default visibility for children.
    setLayerFilterFamily(map, 'districts', null)
    setLayerFilterFamily(map, 'wards', null)
    setBasemapLayerVisible(map, 'districts', DEFAULT_VISIBLE.has('districts'))
    setBasemapLayerVisible(map, 'wards', DEFAULT_VISIBLE.has('wards'))
  }
}

/** Apply a MapLibre filter to a basemap layer and its paired outline/label. */
function setLayerFilterFamily(map: any, layerId: string, filter: any | null): void {
  const base = `vungu-${layerId}`
  for (const id of [base, `${base}-outline`, `${base}-label`]) {
    if (map.getLayer(id)) {
      try {
        map.setFilter(id, filter as any)
      } catch (err) {
        // Some style layers (e.g. background) reject filters — ignore.
      }
    }
  }
}

/** Recursive bbox over any GeoJSON geometry's coordinates. */
function bboxOfGeometry(geom: any): [[number, number], [number, number]] | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const walk = (coords: any) => {
    if (typeof coords[0] === 'number') {
      const [x, y] = coords
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    } else {
      for (const c of coords) walk(c)
    }
  }
  if (!geom) return null
  if (geom.type === 'GeometryCollection') {
    for (const g of geom.geometries) walk(g.coordinates)
  } else {
    walk(geom.coordinates)
  }
  if (!isFinite(minX)) return null
  return [[minX, minY], [maxX, maxY]]
}

function escapeHtml(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ))
}

/** Shows or hides a basemap layer (and its paired casing/outline/label/shield). */
export function setBasemapLayerVisible(map: any, layerId: string, visible: boolean): void {
  const styleLayerId = `vungu-${layerId}`
  const v = visible ? 'visible' : 'none'

  // Suffixes added by this module (labels, shields, ticks) plus the ones the
  // registry compiler emits (-fill/-line/-outline/-casing/-circle). Listed
  // explicitly rather than inferred: a registry-compiled suffix that is missing
  // here would leave an orphan layer visible after the user toggles the layer
  // off, which reads as a rendering bug rather than a stale list.
  const ids = [
    styleLayerId,
    `${styleLayerId}-fill`,         // compiled polygon fill
    `${styleLayerId}-line`,         // compiled line ink
    `${styleLayerId}-circle`,       // compiled point marker
    `${styleLayerId}-casing`,       // compiled road / line casing
    `${styleLayerId}-outline`,      // compiled wide polygon outline, province outline
    `${styleLayerId}-ticks`,        // railway cross-tick overlay
    `${styleLayerId}-label`,        // admin / line / point label
    `${styleLayerId}-shield`,       // road-ref shield (roads only)
    `${styleLayerId}-master-label`, // vungu master-plan centroid label
  ]
  for (const id of ids) {
    if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', v)
  }
}
