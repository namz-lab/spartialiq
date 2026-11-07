// src/map/tools/dxfExport.ts
// ─────────────────────────────────────────────────────────────────────────
// Produce an AutoCAD DXF from planner-drawn geometry so a subdivision (e.g. a
// farm split into parcels) can be handed to a surveyor or opened in AutoCAD /
// Civil 3D / QGIS / Bricscad.
//
// WGS84 lng/lat from the web map is projected to UTM (WGS84) metres with proj4,
// so the drawing is true-to-scale and georeferenced — distances, parcel areas
// and shapes are correct on the ground. The UTM zone is chosen from the
// drawing's own centroid, so it works anywhere the planner draws.
//
// Output targets DXF R12 (AC1009): the most widely-readable interchange format,
// needs no entity handles, and every CAD/GIS tool imports it. Each geometry
// kind lands on its own named, coloured layer, and every closed parcel is
// auto-labelled with its area.
// ─────────────────────────────────────────────────────────────────────────

import proj4 from 'proj4'

export interface DxfLabel {
  lngLat: [number, number]
  text: string
}

export interface DxfExportOptions {
  /** file name without extension */
  fileName?: string
  /** drawing title, written as a TEXT note (e.g. the farm name) */
  title?: string
  /** auto-label each closed parcel with its area (default true) */
  annotateAreas?: boolean
  /** If false, do not trigger a browser download (caller takes `dxf`). Default true. */
  download?: boolean
  /** DXF group-999 comments written at the top of the file (best-effort provenance). */
  comments?: string[]
  /** $INSUNITS code (6 = metres). Default 6. */
  insunits?: number
}

export interface DxfExportResult {
  count: number      // entities written
  epsg: string       // CRS the coordinates are in
  zone: number
  /** Full DXF text (always returned so a sidecar package can hash it). */
  dxf: string
}

type LngLat = [number, number]
type XY = [number, number]

// kind → { layer name, ACI colour }
const LAYER_BY_KIND: Record<string, { layer: string; color: number }> = {
  polygon:   { layer: 'PARCELS',      color: 3 },  // green
  split:     { layer: 'PARCELS',      color: 3 },
  circle:    { layer: 'CIRCLES',      color: 6 },  // magenta
  buffer:    { layer: 'BUFFERS',      color: 5 },  // blue
  line:      { layer: 'LINES',        color: 7 },  // white/black
  polyline:  { layer: 'POLYLINES',    color: 4 },  // cyan
  arc:       { layer: 'ARCS',         color: 2 },  // yellow
  dimension: { layer: 'DIMENSIONS',   color: 1 },  // red
  offset:    { layer: 'CONSTRUCTION', color: 8 },  // grey
  trim:      { layer: 'LINES',        color: 7 },
  // Land-subdivision plan layers (planner tool)
  lot:        { layer: 'LOTS',         color: 4 },  // cyan
  road:       { layer: 'ROADS',        color: 7 },  // white/black centre-lines
  open_space: { layer: 'OPEN-SPACE',   color: 3 },  // green
  boundary:   { layer: 'BOUNDARY',     color: 5 },  // blue
  constraint: { layer: 'CONSTRAINTS',  color: 1 },  // red
}
const DEFAULT_LAYER = { layer: 'PARCELS', color: 3 }
const AREA_LAYER = { layer: 'PARCEL-AREAS', color: 2 }
const TEXT_LAYER = { layer: 'ANNOTATION', color: 7 }
const TITLE_LAYER = { layer: 'TITLE', color: 8 }

function layerFor(kind?: string) {
  return (kind && LAYER_BY_KIND[kind]) || DEFAULT_LAYER
}

// ── DXF group-code writer ───────────────────────────────────────────────────
class DxfDoc {
  private out: string[] = []
  g(code: number, value: string | number) {
    this.out.push(String(code))
    this.out.push(String(value))
  }
  toString() {
    return this.out.join('\n') + '\n'
  }
}

// shoelace area (m²) on projected metric coordinates
function ringArea(ring: XY[]): number {
  let a = 0
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    a += (ring[j][0] + ring[i][0]) * (ring[j][1] - ring[i][1])
  }
  return Math.abs(a) / 2
}

// area-weighted polygon centroid on projected metric coordinates
function ringCentroid(ring: XY[]): XY {
  let cx = 0, cy = 0, a = 0
  for (let i = 0, n = ring.length, j = n - 1; i < n; j = i++) {
    const f = ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]
    cx += (ring[j][0] + ring[i][0]) * f
    cy += (ring[j][1] + ring[i][1]) * f
    a += f
  }
  if (Math.abs(a) < 1e-9) {
    // degenerate — fall back to vertex average
    const s = ring.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]] as XY, [0, 0] as XY)
    return [s[0] / ring.length, s[1] / ring.length]
  }
  a *= 3
  return [cx / a, cy / a]
}

function fmtArea(sqm: number): string {
  return sqm >= 10000 ? `${(sqm / 10000).toFixed(3)} ha` : `${Math.round(sqm)} m2`
}

// strip a polygon ring's repeated closing vertex (GeoJSON repeats first==last)
function openRing(ring: XY[]): XY[] {
  if (ring.length > 1) {
    const a = ring[0], b = ring[ring.length - 1]
    if (a[0] === b[0] && a[1] === b[1]) return ring.slice(0, -1)
  }
  return ring
}

/**
 * Build a georeferenced DXF (R12) from GeoJSON features + text labels and
 * trigger a browser download. Throws if there is nothing to export.
 */
export function exportFeaturesToDxf(
  features: GeoJSON.Feature[],
  labels: DxfLabel[] = [],
  opts: DxfExportOptions = {},
): DxfExportResult {
  const annotateAreas = opts.annotateAreas !== false

  // Pick the UTM zone from the data centroid.
  const allCoords: LngLat[] = []
  const eat = (g: any) => {
    if (!g) return
    if (g.type === 'Point') allCoords.push(g.coordinates)
    else if (g.type === 'LineString') allCoords.push(...g.coordinates)
    else if (g.type === 'Polygon') g.coordinates.forEach((r: any) => allCoords.push(...r))
    else if (g.type === 'MultiPolygon') g.coordinates.forEach((p: any) => p.forEach((r: any) => allCoords.push(...r)))
  }
  for (const f of features) eat(f.geometry)
  for (const l of labels) allCoords.push(l.lngLat)
  if (!allCoords.length) throw new Error('Nothing to export')

  const cLng = allCoords.reduce((s, c) => s + c[0], 0) / allCoords.length
  const cLat = allCoords.reduce((s, c) => s + c[1], 0) / allCoords.length
  const zone = Math.floor((cLng + 180) / 6) + 1
  const south = cLat < 0
  const def = `+proj=utm +zone=${zone} ${south ? '+south ' : ''}+datum=WGS84 +units=m +no_defs`
  const epsg = `EPSG:${south ? 327 : 326}${String(zone).padStart(2, '0')}`
  const project = (c: LngLat): XY => {
    const [x, y] = proj4('EPSG:4326', def, c) as number[]
    return [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000]
  }

  // Track extents for the header + a sensible text height.
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  const grow = (p: XY) => {
    if (p[0] < minX) minX = p[0]
    if (p[1] < minY) minY = p[1]
    if (p[0] > maxX) maxX = p[0]
    if (p[1] > maxY) maxY = p[1]
  }

  const doc = new DxfDoc()
  let count = 0
  const usedLayers = new Map<string, number>()
  const useLayer = (l: { layer: string; color: number }) => { usedLayers.set(l.layer, l.color); return l.layer }

  // entity buffer (written after the header/tables once extents are known)
  const ents = new DxfDoc()

  function writePolyline(coords: XY[], layer: string, color: number, closed: boolean) {
    coords.forEach(grow)
    ents.g(0, 'POLYLINE'); ents.g(8, layer); ents.g(62, color)
    ents.g(66, 1); ents.g(70, closed ? 1 : 0)
    for (const [x, y] of coords) {
      ents.g(0, 'VERTEX'); ents.g(8, layer); ents.g(10, x); ents.g(20, y)
    }
    ents.g(0, 'SEQEND'); ents.g(8, layer)
    count++
  }

  function writeText(p: XY, height: number, text: string, layer: string, color: number) {
    grow(p)
    ents.g(0, 'TEXT'); ents.g(8, layer); ents.g(62, color)
    ents.g(10, p[0]); ents.g(20, p[1]); ents.g(40, Math.round(height * 100) / 100)
    ents.g(1, text)
    count++
  }

  // Defer area labels until we know the drawing size (for text height).
  const areaLabels: { p: XY; text: string }[] = []

  function sanitizeLayer(name: string): string {
    return String(name || '0').replace(/[<>/\\":;?*|=`]/g, '-').replace(/\s+/g, '-').slice(0, 255) || '0'
  }

  for (const f of features) {
    const g: any = f.geometry
    const kind = (f.properties as any)?.kind as string | undefined
    const meta = layerFor(kind)
    const override = (f.properties as any)?.dxfLayer as string | undefined
    const layerName = override ? sanitizeLayer(override) : meta.layer
    const layerColor = meta.color
    if (override) usedLayers.set(layerName, layerColor)
    if (!g) continue

    if (g.type === 'LineString') {
      writePolyline(g.coordinates.map(project), useLayer({ layer: layerName, color: layerColor }), layerColor, false)
    } else if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates
      for (const rings of polys) {
        rings.forEach((ring: LngLat[], i: number) => {
          const proj = openRing(ring.map(project))
          writePolyline(proj, useLayer({ layer: layerName, color: layerColor }), layerColor, true)
          // auto area label on the outer ring. `roundTripId`, when the caller
          // supplies one, rides along as a "#<id>" token so dxfImport.ts can
          // recover the exact source object on re-import — the human-facing
          // `id` (e.g. "Lot 3") stays the primary, readable label text; the
          // round-trip id doesn't need to be pretty, only unique.
          if (annotateAreas && i === 0) {
            const a = ringArea(proj)
            const id = (f.properties as any)?.id
            const rtid = (f.properties as any)?.roundTripId
            const idPart = [id, rtid ? `#${rtid}` : ''].filter(Boolean).join(' ')
            areaLabels.push({
              p: ringCentroid(proj),
              text: idPart ? `${idPart}  ${fmtArea(a)}` : fmtArea(a),
            })
          }
        })
      }
    } else if (g.type === 'Point') {
      const p = project(g.coordinates)
      grow(p)
      ents.g(0, 'POINT'); ents.g(8, useLayer({ layer: layerName, color: layerColor })); ents.g(62, layerColor)
      ents.g(10, p[0]); ents.g(20, p[1]); count++
    }
  }

  // Height derived from drawing size so text is legible at any scale.
  const diag = Number.isFinite(minX) ? Math.hypot(maxX - minX, maxY - minY) : 100
  const textH = Math.min(50, Math.max(1.5, diag / 220))

  // Planner's own text annotations (dimensions / area labels / notes).
  for (const l of labels) writeText(project(l.lngLat), textH, l.text, useLayer(TEXT_LAYER), TEXT_LAYER.color)
  // Auto parcel-area labels.
  for (const al of areaLabels) writeText(al.p, textH, al.text, useLayer(AREA_LAYER), AREA_LAYER.color)

  if (opts.title) {
    const tx: XY = [Number.isFinite(minX) ? minX : 0, (Number.isFinite(maxY) ? maxY : 0) + textH * 2]
    writeText(tx, textH * 1.6, opts.title, useLayer(TITLE_LAYER), TITLE_LAYER.color)
  }

  if (!Number.isFinite(minX)) { minX = minY = 0; maxX = maxY = 0 }

  // ── Assemble the document: HEADER · TABLES · ENTITIES ─────────────────────
  for (const c of (opts.comments || [])) {
    if (c) { doc.g(999, String(c).slice(0, 250)) }
  }
  doc.g(0, 'SECTION'); doc.g(2, 'HEADER')
  doc.g(9, '$ACADVER'); doc.g(1, 'AC1009')
  doc.g(9, '$INSUNITS'); doc.g(70, opts.insunits ?? 6)                 // 6 = metres
  doc.g(9, '$EXTMIN'); doc.g(10, minX); doc.g(20, minY)
  doc.g(9, '$EXTMAX'); doc.g(10, maxX); doc.g(20, maxY)
  doc.g(0, 'ENDSEC')

  doc.g(0, 'SECTION'); doc.g(2, 'TABLES')
  // LTYPE (define CONTINUOUS so layers can reference it cleanly)
  doc.g(0, 'TABLE'); doc.g(2, 'LTYPE'); doc.g(70, 1)
  doc.g(0, 'LTYPE'); doc.g(2, 'CONTINUOUS'); doc.g(70, 0)
  doc.g(3, 'Solid line'); doc.g(72, 65); doc.g(73, 0); doc.g(40, 0)
  doc.g(0, 'ENDTAB')
  // LAYER
  if (!usedLayers.size) usedLayers.set('0', 7)
  doc.g(0, 'TABLE'); doc.g(2, 'LAYER'); doc.g(70, usedLayers.size)
  for (const [name, color] of usedLayers) {
    doc.g(0, 'LAYER'); doc.g(2, name); doc.g(70, 0); doc.g(62, color); doc.g(6, 'CONTINUOUS')
  }
  doc.g(0, 'ENDTAB')
  doc.g(0, 'ENDSEC')

  doc.g(0, 'SECTION'); doc.g(2, 'ENTITIES')
  const tail = new DxfDoc()
  tail.g(0, 'ENDSEC')
  tail.g(0, 'EOF')

  const dxf = doc.toString() + ents.toString() + tail.toString()

  if (opts.download !== false) {
    const blob = new Blob([dxf], { type: 'application/dxf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${opts.fileName || 'subdivision'}-${new Date().toISOString().slice(0, 10)}.dxf`
    document.body.appendChild(a)
    a.click()
    a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return { count, epsg, zone, dxf }
}
