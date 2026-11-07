// src/map/tools/dxfImport.ts
// ─────────────────────────────────────────────────────────────────────────
// Read a DXF (planner's own export, or one edited in AutoCAD/Civil3D/QGIS/
// Bricscad) back into WGS84 GeoJSON — the reverse of dxfExport.ts. Together
// these two files ARE the "subdivide in QGIS or AutoCAD" alternative pathway:
// export DXF → edit externally → re-import.
//
// DXF carries no reliable, round-trip-safe CRS tag (no code here should trust
// a header comment — a third-party re-save is not guaranteed to preserve
// custom comments/XDATA). Instead the caller supplies a known-good WGS84
// reference point (for the planner subdivision flow: the current planning
// area's own centroid) and this module derives the SAME UTM zone/hemisphere
// dxfExport.ts would have used for that location, using the identical
// formula. That sidesteps trying to recover projection info from the file.
//
// Only the layers dxfExport.ts itself writes are understood: LOTS (closed
// polygons, each optionally labelled on PARCEL-AREAS with "<id> #<roundTripId>
// <area>" — the "#<roundTripId>" token, when present, is the exact source
// Lot.id and is the primary match key on re-import; "Lot <n>" is a lower-
// confidence fallback, since lot numbers repeat across blocks) and ROADS
// (open polylines, centre-lines). Other layers (BOUNDARY/OPEN-SPACE/
// CONSTRAINTS) are intentionally not reconciled yet — see the ADR for why.
// ─────────────────────────────────────────────────────────────────────────

import DxfParser from 'dxf-parser'
import proj4 from 'proj4'
import type { Feature, FeatureCollection, Polygon, LineString } from 'geojson'
import { isStandLayer, isRoadLayer, isLabelLayer, resolveLayer } from '@/planning/dxf/layerRegistry'

export interface DxfImportResult {
  featureCollection: FeatureCollection
  count: number
  epsg: string
  zone: number
  warnings: string[]
}

export interface DxfParseOptions {
  /**
   * Also return geometry on layers other than LOTS/ROADS as CAD features
   * (`properties.cad = true`). Used by Planning Studio so a DXF of linework
   * (not just a subdivision) can be brought onto the drafting canvas.
   */
  includeOtherLayers?: boolean
  /**
   * Multiply DXF coordinates by this factor before unprojecting.
   * Only pass after the planner has confirmed a unit transform (e.g. 0.001 for mm → m).
   */
  scaleFactor?: number
  /**
   * Explicit EPSG of the DXF coordinates. When set, the UTM zone is taken from
   * this code rather than derived from `referenceLngLat`.
   */
  epsg?: string
}

export type CadEntitySupport = 'SUPPORTED' | 'CONVERTIBLE' | 'UNSUPPORTED'

export interface DxfInspection {
  readable: boolean
  error?: string
  acadVer: string | null
  insunits: number | null
  unitsLabel: string
  comments: string[]
  exportIdFromFile: string | null
  crsFromFile: string | null
  layers: string[]
  entityCounts: Record<string, number>
  entitySupport: Record<string, CadEntitySupport>
  xrefs: string[]
  hasBinaryDwg: boolean
}

const LOT_LAYER = 'LOTS'
const ROAD_LAYER = 'ROADS'

export type DxfRoadHierarchy = 'arterial' | 'collector' | 'local' | 'access'

/**
 * Infer a planning-road class from a DXF layer name. CAD drawings typically
 * put each reserve width on its own layer (ARTERIAL / COLLECTOR / LOCAL /
 * ACCESS, or ROADS-ARTERIAL, C-ROAD-COLLECTOR, …). Returns null when the
 * layer is not road centre-line work (lots, construction, annotation).
 */
export function roadHierarchyFromDxfLayer(layer: string): DxfRoadHierarchy | null {
  const n = String(layer || '').toUpperCase().replace(/^CAD-/, '').replace(/^VUNGU_/, '').replace(/[_/]+/g, '-')
  if (!n) return null
  if (/ARTERIAL|PRIMARY|HIGHWAY|TRUNK|\bMAJOR\b/.test(n)) return 'arterial'
  if (/COLLECTOR|SECONDARY|SPINE|DISTRIBUTOR/.test(n)) return 'collector'
  if (/ACCESS|LANE|CUL-?DE-?SAC|SERVICE|ALLEY/.test(n)) return 'access'
  if (/^(ROADS?|STREETS?|CL|CENTRELINE|CENTERLINE)$/.test(n)) return 'local'
  if (/\b(ROAD|STREET|LOCAL)\b/.test(n) || /^C-ROAD/.test(n)) return 'local'
  return null
}

type XY = [number, number]

function utmDefFor(refLng: number, refLat: number) {
  const zone = Math.floor((refLng + 180) / 6) + 1
  const south = refLat < 0
  return utmDef(zone, south)
}

function utmDef(zone: number, south: boolean) {
  return {
    zone,
    south,
    def: `+proj=utm +zone=${zone} ${south ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`,
    epsg: `EPSG:${south ? 327 : 326}${String(zone).padStart(2, '0')}`,
  }
}

/** Parse EPSG:326xx / EPSG:327xx into a UTM definition. Returns null for anything else. */
export function utmDefFromEpsg(epsg: string): ReturnType<typeof utmDef> | null {
  const m = /EPSG:(326|327)(\d{2})$/i.exec(String(epsg || '').trim())
  if (!m) return null
  const zone = Number(m[2])
  if (zone < 1 || zone > 60) return null
  return utmDef(zone, m[1] === '327')
}

export function expectedUtmEpsg(refLng: number, refLat: number): string {
  return utmDefFor(refLng, refLat).epsg
}

export const INSUNITS_LABEL: Record<number, string> = {
  0: 'unspecified',
  1: 'inches',
  2: 'feet',
  3: 'miles',
  4: 'millimetres',
  5: 'centimetres',
  6: 'metres',
  7: 'kilometres',
  8: 'microinches',
  9: 'mils',
  10: 'yards',
  11: 'angstroms',
  12: 'nanometres',
  13: 'microns',
  14: 'decimetres',
  15: 'decametres',
  16: 'hectometres',
}

/** Scale factor that converts the given $INSUNITS into metres. Null = unknown / do not scale. */
export function metresScaleForInsunits(code: number | null): number | null {
  if (code == null) return null
  if (code === 6) return 1
  if (code === 4) return 0.001
  if (code === 5) return 0.01
  if (code === 14) return 0.1
  if (code === 7) return 1000
  if (code === 1) return 0.0254
  if (code === 2) return 0.3048
  if (code === 10) return 0.9144
  return null
}

const SUPPORTED_TYPES = new Set(['LINE', 'LWPOLYLINE', 'POLYLINE', 'VERTEX', 'SEQEND', 'TEXT', 'MTEXT', 'CIRCLE', 'ARC'])
const CONVERTIBLE_TYPES = new Set(['SPLINE', 'HATCH', 'INSERT', 'DIMENSION', 'LEADER', 'MULTILEADER', 'ELLIPSE', 'SOLID', '3DFACE', 'TRACE'])
const UNSUPPORTED_TYPES = new Set(['3DSOLID', 'BODY', 'REGION', 'PROXY', 'ACAD_PROXY_ENTITY', 'OLE2FRAME', 'IMAGE', 'UNDERLAY', 'VIEWPORT', 'HELIX', 'MESH', 'SURFACE', 'MLINE'])

export function supportForEntityType(type: string): CadEntitySupport {
  const t = String(type || '').toUpperCase()
  if (SUPPORTED_TYPES.has(t)) return 'SUPPORTED'
  if (CONVERTIBLE_TYPES.has(t)) return 'CONVERTIBLE'
  if (UNSUPPORTED_TYPES.has(t) || /3D/.test(t)) return 'UNSUPPORTED'
  return 'UNSUPPORTED'
}

function headerVal(header: any, key: string): unknown {
  if (!header || typeof header !== 'object') return undefined
  return header[key] ?? header[key.replace(/^\$/, '')] ?? header[`$${key.replace(/^\$/, '')}`]
}

function scanComments(dxfText: string): string[] {
  const out: string[] = []
  const lines = dxfText.split(/\r?\n/)
  for (let i = 0; i < lines.length - 1 && i < 400; i++) {
    if (lines[i].trim() === '999') out.push(lines[i + 1] || '')
  }
  return out
}

function scanXrefs(dxfText: string, parsed: any): string[] {
  const found = new Set<string>()
  const re = /\b([^\s\\/]+\.(?:dwg|dxf|dgn))\b/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(dxfText)) && found.size < 40) found.add(m[1])
  const blocks = parsed?.blocks
  if (blocks && typeof blocks === 'object') {
    for (const [name, b] of Object.entries(blocks as Record<string, any>)) {
      const flags = Number(b?.xrefFlags ?? b?.flags ?? 0)
      const path = b?.xrefPath || b?.path || b?.ownerHandle
      if (flags & 4 || (typeof path === 'string' && /\.(dwg|dxf)$/i.test(path))) {
        found.add(String(path || name))
      }
    }
  }
  for (const e of (parsed?.entities || []) as any[]) {
    if (String(e.type || '').toUpperCase() === 'INSERT' && e.path) found.add(String(e.path))
  }
  return [...found]
}

/**
 * Read DXF headers, layers, entity inventory and XREFs without unprojecting.
 * Does not assume a CRS.
 */
export function inspectDxf(dxfText: string): DxfInspection {
  const empty = (error: string): DxfInspection => ({
    readable: false, error, acadVer: null, insunits: null, unitsLabel: 'unknown',
    comments: [], exportIdFromFile: null, crsFromFile: null, layers: [],
    entityCounts: {}, entitySupport: {}, xrefs: [], hasBinaryDwg: /^AC10\d\d/.test(dxfText.slice(0, 6)),
  })
  if (!dxfText || !dxfText.trim()) return empty('Empty file.')
  if (/^AC10\d\d/.test(dxfText.slice(0, 6))) return empty('This is a binary DWG file. Save as DXF from AutoCAD and try again.')

  let dxf: ReturnType<InstanceType<typeof DxfParser>['parseSync']>
  try {
    dxf = new DxfParser().parseSync(dxfText)
  } catch (e: any) {
    return empty(`Could not read the DXF — ${e?.message || 'malformed file'}.`)
  }
  if (!dxf) return empty('Could not read the DXF — malformed file.')

  const comments = scanComments(dxfText)
  const acadVer = String(headerVal(dxf.header, '$ACADVER') || '') || null
  const insRaw = headerVal(dxf.header, '$INSUNITS')
  const insunits = insRaw == null || insRaw === '' ? null : Number(insRaw)
  const entityCounts: Record<string, number> = {}
  const entitySupport: Record<string, CadEntitySupport> = {}
  const layers = new Set<string>()
  const skip = new Set(['SECTION', 'ENDSEC', 'EOF', 'TABLE', 'ENDTAB', 'LAYER', 'LTYPE', 'BLOCK', 'ENDBLK', 'SEQEND', 'VERTEX'])
  const rawLines = dxfText.split(/\r?\n/)
  for (let i = 0; i < rawLines.length - 1; i++) {
    if (rawLines[i].trim() !== '0') continue
    const type = rawLines[i + 1].trim().toUpperCase()
    if (!type || skip.has(type)) continue
    entityCounts[type] = (entityCounts[type] || 0) + 1
    entitySupport[type] = supportForEntityType(type)
  }
  for (const e of (dxf.entities || []) as any[]) {
    if (e.layer) layers.add(String(e.layer))
  }
  const tablesLayers = (dxf as any).tables?.layer?.layers
  if (tablesLayers && typeof tablesLayers === 'object') {
    for (const name of Object.keys(tablesLayers)) layers.add(name)
  }
  const exportIdFromFile = comments.find(c => /^VUNGU-EXPORT:/i.test(c))?.replace(/^VUNGU-EXPORT:/i, '').trim() || null
  const crsFromFile = comments.find(c => /^VUNGU-CRS:/i.test(c))?.replace(/^VUNGU-CRS:/i, '').trim() || null
  const unitsLabel = insunits == null ? 'unknown' : (INSUNITS_LABEL[insunits] || `code ${insunits}`)
  return {
    readable: true,
    acadVer,
    insunits: Number.isFinite(insunits as number) ? insunits : null,
    unitsLabel,
    comments,
    exportIdFromFile,
    crsFromFile,
    layers: [...layers].sort(),
    entityCounts,
    entitySupport,
    xrefs: scanXrefs(dxfText, dxf),
    hasBinaryDwg: false,
  }
}

/**
 * Recover identity from a dxfExport.ts area label. Two independent signals:
 *  - `lotId`: the exact `#<roundTripId>` token (dxfExport.ts embeds the real
 *    `Lot.id` this way when the caller passes `roundTripId`). Globally unique
 *    — this is the primary match key.
 *  - `lotNumber`: the human "Lot <n>" prefix. `lotNumber` alone is only
 *    unique WITHIN a block (renumberLots() numbers per block), so it's kept
 *    only as a lower-confidence fallback for labels with no `#id` token (an
 *    older export, or one hand-annotated in the CAD tool).
 * Anything that doesn't match either shape yields neither — treated as "no
 * id recovered", not a guess.
 */
function parseLotLabel(text: string): { lotId?: string; lotNumber?: string } {
  const head = (/^(.+?)\s{2,}\S/.exec(text.trim())?.[1] ?? text.trim()).trim()
  const lotId = /#(\S+)/.exec(head)?.[1]
  const lotNumber = /^lot\s+(\S+)/i.exec(head)?.[1]
  return { lotId, lotNumber }
}

function circleRing(cx: number, cy: number, r: number, n = 32): XY[] {
  const pts: XY[] = []
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  pts.push(pts[0])
  return pts
}

function arcLine(cx: number, cy: number, r: number, start: number, end: number, n = 24): XY[] {
  const a0 = start
let a1 = end
  if (!Number.isFinite(a0) || !Number.isFinite(a1) || r <= 0) return []
  if (a1 <= a0) a1 += Math.PI * 2
  if (a1 <= a0) a1 += Math.PI * 2
  const steps = Math.max(4, Math.round(n * (a1 - a0) / (Math.PI * 2)))
  const pts: XY[] = []
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * (i / steps)
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)])
  }
  return pts
}

/**
 * Parse a DXF document into WGS84 GeoJSON. `referenceLngLat` anchors the UTM
 * zone/hemisphere unless `opts.epsg` is an explicit UTM EPSG. Throws if the file
 * has no recognised geometry, unless `includeOtherLayers` is set and other
 * drawable geometry is present.
 */
export function parseDxfToGeoJSON(dxfText: string, referenceLngLat: XY, opts: DxfParseOptions = {}): DxfImportResult {
  if (!dxfText || !dxfText.trim()) throw new Error('Empty file.')

  let dxf: ReturnType<InstanceType<typeof DxfParser>['parseSync']>
  try {
    dxf = new DxfParser().parseSync(dxfText)
  } catch (e: any) {
    throw new Error(`Could not read the DXF — ${e?.message || 'malformed file'}.`)
  }
  if (!dxf || !Array.isArray(dxf.entities) || !dxf.entities.length) {
    throw new Error('No entities found in the DXF file.')
  }

  const utm = (opts.epsg && utmDefFromEpsg(opts.epsg)) || utmDefFor(referenceLngLat[0], referenceLngLat[1])
  const { zone, def, epsg } = utm
  const scale = Number.isFinite(opts.scaleFactor) && (opts.scaleFactor as number) > 0 ? (opts.scaleFactor as number) : 1
  const unproject = (x: number, y: number): XY => proj4(def, 'EPSG:4326', [x * scale, y * scale]) as XY

  const warnings: string[] = []
  const labels: { point: XY; text: string }[] = []
  const lots: Feature<Polygon>[] = []
  const roads: Feature<LineString>[] = []
  const cad: Feature[] = []
  const includeCad = !!opts.includeOtherLayers
  let unknownLayerEntities = 0

  function pushCad(layerName: string, geometry: Feature['geometry'], extra: Record<string, unknown> = {}) {
    const mapping = resolveLayer(layerName)
    cad.push({
      type: 'Feature',
      properties: {
        layer: layerName,
        cad: true,
        objectType: mapping?.objectType || 'UNMAPPED',
        gisRole: mapping?.gisRole || 'unmapped',
        ...extra,
      },
      geometry,
    })
  }

  for (const e of dxf.entities as any[]) {
    const layer = String(e.layer || '')
    const type = String(e.type || '')

    if ((type === 'TEXT' || type === 'MTEXT') && e.startPoint && typeof e.text === 'string') {
      const pt = unproject(e.startPoint.x, e.startPoint.y)
      if (isLabelLayer(layer) || layer === 'PARCEL-AREAS' || layer === 'ANNOTATION' || layer === 'TITLE') {
        labels.push({ point: pt, text: e.text })
      } else if (includeCad) {
        pushCad(layer || 'VUNGU_ANNOTATION', { type: 'Point', coordinates: pt }, { text: e.text })
      }
      continue
    }

    if (includeCad && type === 'CIRCLE' && e.center && Number(e.radius) > 0) {
      const ring = circleRing(e.center.x, e.center.y, e.radius).map(([x, y]) => unproject(x, y))
      pushCad(layer, { type: 'Polygon', coordinates: [ring] }, { cadType: 'circle' })
      continue
    }

    if (includeCad && type === 'ARC' && e.center && Number(e.radius) > 0) {
      const pts = arcLine(e.center.x, e.center.y, e.radius, e.startAngle ?? 0, e.endAngle ?? Math.PI * 2)
        .map(([x, y]) => unproject(x, y))
      if (pts.length >= 2) pushCad(layer, { type: 'LineString', coordinates: pts }, { cadType: 'arc' })
      continue
    }

    // LWPOLYLINE / POLYLINE / LINE all expose `.vertices: {x,y}[]` in dxf-parser.
    if (Array.isArray(e.vertices) && e.vertices.length >= 2) {
      const pts = e.vertices.map((v: any) => unproject(v.x, v.y))
      const stand = isStandLayer(layer) || layer === LOT_LAYER
      const roadH = isRoadLayer(layer) || layer === ROAD_LAYER || !!roadHierarchyFromDxfLayer(layer)
        ? (resolveLayer(layer)?.roadHierarchy || roadHierarchyFromDxfLayer(layer) || 'local')
        : null
      if (stand) {
        if (pts.length < 3) { warnings.push(`Skipped a stand entity with fewer than 3 vertices.`); continue }
        const first = pts[0], last = pts[pts.length - 1]
        const ring = (first[0] === last[0] && first[1] === last[1]) ? pts : [...pts, first]
        lots.push({ type: 'Feature', properties: { layer: LOT_LAYER, sourceLayer: layer, objectType: 'STAND' }, geometry: { type: 'Polygon', coordinates: [ring] } })
      } else if (roadH && !(e.shape || e.closed)) {
        roads.push({
          type: 'Feature',
          properties: { layer: ROAD_LAYER, hierarchy: roadH, sourceLayer: layer, objectType: 'ROAD' },
          geometry: { type: 'LineString', coordinates: pts },
        })
      } else if (includeCad && !isLabelLayer(layer)) {
        const first = pts[0], last = pts[pts.length - 1]
        const alreadyClosed = first[0] === last[0] && first[1] === last[1]
        const closed = !!(e.shape || e.closed) || alreadyClosed
        if (closed && pts.length >= 3) {
          const ring = alreadyClosed ? pts : [...pts, first]
          pushCad(layer, { type: 'Polygon', coordinates: [ring] })
        } else {
          pushCad(layer, { type: 'LineString', coordinates: pts })
        }
      } else if (layer && !isLabelLayer(layer)) {
        unknownLayerEntities++
      }
      continue
    }
  }

  if (unknownLayerEntities > 0) {
    warnings.push(`${unknownLayerEntities} entit${unknownLayerEntities === 1 ? 'y' : 'ies'} on a layer other than ${LOT_LAYER}/${ROAD_LAYER} were ignored.`)
  }

  // Recover each lot's original label by containment: the area label dxfExport.ts
  // writes sits at the polygon's centroid, so a point-in-polygon test pairs them
  // (no external turf dependency needed for a simple ray cast on closed rings).
  for (const lot of lots) {
    const ring = lot.geometry.coordinates[0]
    const match = labels.find(l => pointInRing(l.point, ring))
    if (match) {
      const { lotId, lotNumber } = parseLotLabel(match.text)
      if (lotId) (lot.properties as any).lotId = lotId
      if (lotNumber) (lot.properties as any).lotNumber = lotNumber
    }
  }

  if (!lots.length && !roads.length && !cad.length) {
    throw new Error(`No ${LOT_LAYER} or ${ROAD_LAYER} geometry found — nothing to import.`)
  }

  const features = [...lots, ...roads, ...cad]
  return { featureCollection: { type: 'FeatureCollection', features }, count: features.length, epsg, zone, warnings }
}

/** Standard ray-casting point-in-polygon test on a single (possibly-open) ring. */
function pointInRing(pt: XY, ring: readonly (readonly number[])[]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    const intersect = ((yi > pt[1]) !== (yj > pt[1])) &&
      (pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi)
    if (intersect) inside = !inside
  }
  return inside
}
