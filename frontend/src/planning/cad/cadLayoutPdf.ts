// src/planning/cad/cadLayoutPdf.ts
// ─────────────────────────────────────────────────────────────────────────
// Paper-space sheet renderer (CAD-3 — Layout & Viewports). Draws a SCALE-TRUE
// engineering plot to PDF via jsPDF (mm units): a bordered sheet with a map
// viewport (parcel, roads at true reserve width, stands coloured by use + lot
// numbers, open space, reserves, CAD linework, dimensions), a north arrow, a
// true scale bar, a legend, and a title block. Vector — crisp at any zoom, and
// 1:1000 means 1 mm on paper is exactly 1 m on the ground. Projection math is in
// cadLayout.ts; this file is the drawing only.
// ─────────────────────────────────────────────────────────────────────────
import { jsPDF } from 'jspdf'
import type { FeatureCollection, Feature, Position } from 'geojson'
import {
  paperDims, fitScale, boundsMetres, makeProjector, metresToMm, scaleBarMetres,
  type PaperName, type Orientation, type Viewport,
} from './cadLayout'
import { frameFor } from './cadGeometry'

// Use-type fill colours (mirror LOT_FILL_BY_USE in planning-layers.ts).
const USE_COLOURS: Record<string, string> = {
  single_residential: '#7dd3fc', duplex: '#34d399', townhouse: '#f472b6',
  mixed_use: '#fbbf24', open_space: '#22c55e',
  school: '#f59e0b', health: '#ef4444', community_centre: '#8b5cf6',
  place_of_worship: '#a78bfa', commercial: '#2563eb', recreation: '#16a34a',
}
const INK = '#0f172a', MUTED = '#5f6368', HAIR = '#dadce0', ACCENT = '#0369a1'

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const isoDate = () => new Date().toISOString().slice(0, 10)
const slug = (s: string) => (s || 'layout').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'layout'

export interface LayoutSheetArgs {
  paper: PaperName
  orientation: Orientation
  /** engineering denominator (1:S), or 'fit' to auto-scale the content. */
  scale?: number | 'fit'
  title: string
  drawingNumber?: string
  planner?: string
  council?: string
  /** SG / plan reference shown in the title block. */
  planNumber?: string
  /** Append a numbered stand schedule (No. · area · frontage · use) page. */
  showSchedule?: boolean
  /** Label parcel corners with local survey coordinates (X/Y metres from SW). */
  showCoordinates?: boolean
  // geometry (any may be omitted)
  planningArea?: FeatureCollection
  roads?: FeatureCollection
  lots?: FeatureCollection
  openSpace?: FeatureCollection
  constraints?: FeatureCollection
  cad?: FeatureCollection
  dimensions?: FeatureCollection
  symbols?: FeatureCollection
  hatch?: FeatureCollection
}

const M = 8           // sheet margin (mm)
const PAD = 4         // viewport inset from border (mm)
const TB_H = 34       // title-block strip height (mm)

/** Render + download the layout sheet. Returns the scale actually used. */
export function plotLayoutPdf(args: LayoutSheetArgs): { scale: number } {
  const { pdf, scale } = buildLayoutPdf(args)
  pdf.save(`${slug(args.drawingNumber || args.title)}-${args.paper}-${isoDate()}.pdf`)
  return { scale }
}

/** Build the jsPDF document WITHOUT triggering a download (testable). */
export function buildLayoutPdf(args: LayoutSheetArgs): { pdf: jsPDF; scale: number } {
  const sheet = paperDims(args.paper, args.orientation)
  const pdf = new jsPDF({ orientation: args.orientation, unit: 'mm', format: args.paper.toLowerCase() })

  // ── regions ────────────────────────────────────────────────────────────────
  const border = { x: M, y: M, w: sheet.w - 2 * M, h: sheet.h - 2 * M }
  const tb = { x: border.x, y: border.y + border.h - TB_H, w: border.w, h: TB_H }
  const viewport: Viewport = {
    x: border.x + PAD, y: border.y + PAD,
    w: border.w - 2 * PAD,
    h: border.h - TB_H - 2 * PAD,
  }

  // ── content bounds + scale + projector ───────────────────────────────────────
  const all: Feature[] = []
  const pushFC = (fc?: FeatureCollection) => { if (fc?.features) all.push(...fc.features) }
  pushFC(args.planningArea); pushFC(args.roads); pushFC(args.lots)
  pushFC(args.openSpace); pushFC(args.constraints); pushFC(args.cad); pushFC(args.symbols); pushFC(args.hatch)
  const { bounds, frame } = boundsMetres(all)
  const scale = (args.scale && args.scale !== 'fit')
    ? args.scale
    : fitScale(bounds.widthM, bounds.heightM, viewport.w, viewport.h)
  const project = makeProjector(frame, bounds.centerM, scale, viewport)

  // ── border + clip the viewport so nothing spills over the title block ────────
  pdf.setDrawColor(...hexToRgb(INK)); pdf.setLineWidth(0.6)
  pdf.rect(border.x, border.y, border.w, border.h)
  let clipped = false
  try {
    pdf.saveGraphicsState()
    pdf.rect(viewport.x, viewport.y, viewport.w, viewport.h)
    ;(pdf as any).clip(); (pdf as any).discardPath?.()
    clipped = true
  } catch { /* clipping unsupported → rely on fit-scale keeping content inside */ }

  // ── geometry (bottom → top) ──────────────────────────────────────────────────
  if (args.planningArea) drawPolys(pdf, args.planningArea, project, { fill: '#1d4ed8', fillOpacity: 0.04, stroke: '#1d4ed8', width: 0.5, dash: [1.5, 1] })
  if (args.hatch) drawHatch(pdf, args.hatch, project)
  if (args.constraints) drawPolys(pdf, args.constraints, project, { fill: '#ef4444', fillOpacity: 0.18, stroke: '#b91c1c', width: 0.3, dash: [1, 1] })
  if (args.openSpace) drawPolys(pdf, args.openSpace, project, { fill: '#22c55e', fillOpacity: 0.28, stroke: '#15803d', width: 0.3 })
  if (args.roads) drawRoads(pdf, args.roads, project, scale)
  if (args.lots) drawLots(pdf, args.lots, project)
  if (args.cad) drawCad(pdf, args.cad, project)
  if (args.symbols) drawSymbols(pdf, args.symbols, project)
  if (args.dimensions) drawPolys(pdf, args.dimensions, project, { stroke: '#65727f', width: 0.2 })
  if (args.showCoordinates && args.planningArea) drawCoordinateLabels(pdf, args.planningArea, project)

  if (clipped) { try { pdf.restoreGraphicsState() } catch { /* ignore */ } }

  // ── viewport frame + furniture ───────────────────────────────────────────────
  pdf.setDrawColor(...hexToRgb(HAIR)); pdf.setLineWidth(0.3)
  pdf.rect(viewport.x, viewport.y, viewport.w, viewport.h)
  drawNorthArrow(pdf, viewport.x + viewport.w - 12, viewport.y + 14)
  drawScaleBar(pdf, viewport.x + 8, viewport.y + viewport.h - 8, scale)
  drawLegend(pdf, viewport.x + 6, viewport.y + 6, args)

  // ── title block ──────────────────────────────────────────────────────────────
  drawTitleBlock(pdf, tb, scale, args)

  // ── stand schedule (opt-in extra page) ───────────────────────────────────────
  if (args.showSchedule && args.lots?.features?.length) drawSchedulePage(pdf, args)

  return { pdf, scale }
}

// ── drawing helpers ─────────────────────────────────────────────────────────────

interface PolyStyle { fill?: string; fillOpacity?: number; stroke?: string; width?: number; dash?: number[] }

/** Outer + inner rings of every Polygon/MultiPolygon in the collection. */
function eachRing(fc: FeatureCollection): Position[][] {
  const rings: Position[][] = []
  for (const f of fc.features) {
    const g: any = f.geometry
    if (g?.type === 'Polygon') for (const r of g.coordinates) rings.push(r)
    else if (g?.type === 'MultiPolygon') for (const p of g.coordinates) for (const r of p) rings.push(r)
  }
  return rings
}
function project_(ring: Position[], project: (c: Position) => [number, number]) {
  return ring.map(project)
}
/** Draw a closed ring of absolute-mm points (fill and/or stroke). */
function ringPath(pdf: jsPDF, pts: [number, number][], style: 'F' | 'S' | 'FD') {
  if (pts.length < 2) return
  const deltas: number[][] = []
  for (let i = 1; i < pts.length; i++) deltas.push([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]])
  pdf.lines(deltas, pts[0][0], pts[0][1], [1, 1], style, true)
}
/** Draw an open polyline of absolute-mm points (stroke). */
function linePath(pdf: jsPDF, pts: [number, number][]) {
  for (let i = 1; i < pts.length; i++) pdf.line(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1])
}

function drawPolys(pdf: jsPDF, fc: FeatureCollection, project: (c: Position) => [number, number], s: PolyStyle) {
  if (s.dash) pdf.setLineDashPattern(s.dash, 0); else pdf.setLineDashPattern([], 0)
  pdf.setLineWidth(s.width ?? 0.3)
  if (s.stroke) pdf.setDrawColor(...hexToRgb(s.stroke))
  for (const ring of eachRing(fc)) {
    const pts = project_(ring, project)
    if (s.fill) {
      pdf.setFillColor(...hexToRgb(s.fill))
      ;(pdf as any).setGState?.(new (pdf as any).GState({ opacity: s.fillOpacity ?? 1 }))
      ringPath(pdf, pts, s.stroke ? 'FD' : 'F')
      ;(pdf as any).setGState?.(new (pdf as any).GState({ opacity: 1 }))
    } else if (s.stroke) {
      ringPath(pdf, pts, 'S')
    }
  }
  pdf.setLineDashPattern([], 0)
}

/** Roads: a grey ribbon at the true reserve width + a thin dark centreline. */
function drawRoads(pdf: jsPDF, fc: FeatureCollection, project: (c: Position) => [number, number], scale: number) {
  pdf.setLineDashPattern([], 0)
  pdf.setLineCap('round')
  for (const f of fc.features) {
    const g: any = f.geometry
    const lines: Position[][] = g?.type === 'LineString' ? [g.coordinates]
      : g?.type === 'MultiLineString' ? g.coordinates : []
    const widthM = Number((f.properties as any)?.widthM) || 12
    const ribbon = Math.max(metresToMm(widthM, scale), 0.4)
    for (const ln of lines) {
      const pts = project_(ln, project)
      pdf.setDrawColor(210, 214, 220); pdf.setLineWidth(ribbon); linePath(pdf, pts)
      pdf.setDrawColor(...hexToRgb(INK)); pdf.setLineWidth(0.25); linePath(pdf, pts)
    }
  }
  pdf.setLineCap('butt')
}

/** Lots: fill by use colour, thin outline, lot number at the ring centroid. */
function drawLots(pdf: jsPDF, fc: FeatureCollection, project: (c: Position) => [number, number]) {
  pdf.setLineDashPattern([], 0); pdf.setLineWidth(0.2)
  for (const f of fc.features) {
    const g: any = f.geometry
    if (g?.type !== 'Polygon' && g?.type !== 'MultiPolygon') continue
    const rings: Position[][] = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
    const use = String((f.properties as any)?.useType || 'single_residential')
    pdf.setFillColor(...hexToRgb(USE_COLOURS[use] || '#94a3b8'))
    pdf.setDrawColor(...hexToRgb('#0369a1'))
    for (const ring of rings) ringPath(pdf, project_(ring, project), 'FD')
    // lot number at the outer-ring centroid
    const num = (f.properties as any)?.lotNumber
    if (num != null && num !== '') {
      const pts = project_(rings[0], project)
      const cx = pts.reduce((s, p) => s + p[0], 0) / pts.length
      const cy = pts.reduce((s, p) => s + p[1], 0) / pts.length
      pdf.setFontSize(5); pdf.setTextColor(...hexToRgb('#0c4a6e'))
      pdf.text(String(num), cx, cy, { align: 'center', baseline: 'middle' })
    }
  }
}

/** CAD entities: lines/polylines/rectangles/circles, stroked per their colour. */
function drawCad(pdf: jsPDF, fc: FeatureCollection, project: (c: Position) => [number, number]) {
  pdf.setLineDashPattern([], 0); pdf.setLineWidth(0.25)
  for (const f of fc.features) {
    const g: any = f.geometry
    const col = String((f.properties as any)?.color || '#1a73e8')
    pdf.setDrawColor(...hexToRgb(col))
    if (g?.type === 'LineString') linePath(pdf, project_(g.coordinates, project))
    else if (g?.type === 'MultiLineString') for (const ln of g.coordinates) linePath(pdf, project_(ln, project))
    else if (g?.type === 'Polygon') for (const r of g.coordinates) ringPath(pdf, project_(r, project), 'S')
    else if (g?.type === 'MultiPolygon') for (const p of g.coordinates) for (const r of p) ringPath(pdf, project_(r, project), 'S')
    else if (g?.type === 'Point') {
      // text labels (Text / Leader annotations) carry a `text` property
      const txt = (f.properties as any)?.text
      if (txt) {
        const [x, y] = project(g.coordinates)
        pdf.setFontSize(6); pdf.setTextColor(...hexToRgb(INK))
        pdf.text(String(txt), x, y, { baseline: 'middle' })
      }
    }
  }
}

/** Hatches: boundary fill (tint or solid) + pattern lines + pattern dots (per `role`). */
function drawHatch(pdf: jsPDF, fc: FeatureCollection, project: (c: Position) => [number, number]) {
  pdf.setLineDashPattern([], 0)
  for (const f of fc.features) {
    const g: any = f.geometry
    const role = String((f.properties as any)?.role || 'fill')
    const col = String((f.properties as any)?.color || '#94a3b8')
    if (role === 'fill' && (g?.type === 'Polygon' || g?.type === 'MultiPolygon')) {
      const rings: Position[][] = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat()
      const op = Number((f.properties as any)?.fillOpacity) || 0.3
      pdf.setFillColor(...hexToRgb(col))
      ;(pdf as any).setGState?.(new (pdf as any).GState({ opacity: op }))
      for (const r of rings) ringPath(pdf, project_(r, project), 'F')
      ;(pdf as any).setGState?.(new (pdf as any).GState({ opacity: 1 }))
    } else if (role === 'line' && g?.type === 'LineString') {
      pdf.setDrawColor(...hexToRgb(col)); pdf.setLineWidth(0.2)
      linePath(pdf, project_(g.coordinates, project))
    } else if (role === 'dot' && g?.type === 'Point') {
      const [x, y] = project(g.coordinates)
      pdf.setFillColor(...hexToRgb(col)); pdf.circle(x, y, 0.35, 'F')
    }
  }
}

/** Inserted symbols: fill parts, stroke parts, and text labels (per `role`). */
function drawSymbols(pdf: jsPDF, fc: FeatureCollection, project: (c: Position) => [number, number]) {
  pdf.setLineDashPattern([], 0); pdf.setLineWidth(0.3)
  for (const f of fc.features) {
    const g: any = f.geometry
    const role = String((f.properties as any)?.role || 'line')
    const col = String((f.properties as any)?.color || '#1f2933')
    if (role === 'text') {
      const txt = (f.properties as any)?.text
      if (txt && g?.type === 'Point') {
        const [x, y] = project(g.coordinates)
        pdf.setFontSize(7); pdf.setTextColor(...hexToRgb(col))
        pdf.text(String(txt), x, y, { align: 'center', baseline: 'middle' })
      }
      continue
    }
    pdf.setDrawColor(...hexToRgb(col)); pdf.setFillColor(...hexToRgb(col))
    if (g?.type === 'Polygon') for (const r of g.coordinates) ringPath(pdf, project_(r, project), role === 'fill' ? 'F' : 'S')
    else if (g?.type === 'LineString') linePath(pdf, project_(g.coordinates, project))
  }
}

function drawNorthArrow(pdf: jsPDF, x: number, y: number) {
  pdf.setFillColor(255, 255, 255); pdf.setDrawColor(...hexToRgb(INK)); pdf.setLineWidth(0.3)
  pdf.circle(x, y, 6, 'FD')
  pdf.setFillColor(...hexToRgb(INK))
  pdf.triangle(x, y - 4.5, x - 2.5, y + 2.5, x + 2.5, y + 2.5, 'F')
  pdf.setFontSize(7); pdf.setTextColor(...hexToRgb(INK))
  pdf.text('N', x, y + 5.6, { align: 'center' })
}

function drawScaleBar(pdf: jsPDF, x: number, y: number, scale: number) {
  const metres = scaleBarMetres(scale, 40)
  const barMm = metresToMm(metres, scale)
  pdf.setFillColor(255, 255, 255); pdf.rect(x - 2, y - 6, barMm + 4, 9, 'F')
  pdf.setDrawColor(...hexToRgb(INK)); pdf.setLineWidth(0.6); pdf.line(x, y, x + barMm, y)
  pdf.setLineWidth(0.3); pdf.line(x, y - 1.5, x, y + 1.5); pdf.line(x + barMm, y - 1.5, x + barMm, y + 1.5)
  pdf.setFontSize(6); pdf.setTextColor(...hexToRgb(INK))
  const label = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`
  pdf.text(label, x + barMm / 2, y - 2, { align: 'center' })
}

/** Legend of the use-type colours actually present in the lots. */
function drawLegend(pdf: jsPDF, x: number, y: number, args: LayoutSheetArgs) {
  const present = new Set<string>()
  for (const f of args.lots?.features || []) present.add(String((f.properties as any)?.useType || 'single_residential'))
  if (!present.size) return
  const entries = [...present]
  const boxW = 42, rowH = 4.6, padY = 3
  const boxH = padY * 2 + entries.length * rowH + 4
  pdf.setFillColor(255, 255, 255); pdf.setDrawColor(...hexToRgb(HAIR)); pdf.setLineWidth(0.3)
  pdf.rect(x, y, boxW, boxH, 'FD')
  pdf.setFontSize(5.5); pdf.setTextColor(...hexToRgb(MUTED))
  pdf.text('LAND USE', x + 2, y + 4)
  let ry = y + 7.5
  pdf.setFontSize(5); pdf.setTextColor(...hexToRgb(INK))
  for (const use of entries) {
    pdf.setFillColor(...hexToRgb(USE_COLOURS[use] || '#94a3b8'))
    pdf.rect(x + 2, ry - 2.4, 3, 3, 'F')
    pdf.text(use.replace(/_/g, ' '), x + 6.5, ry)
    ry += rowH
  }
}

function drawTitleBlock(pdf: jsPDF, tb: { x: number; y: number; w: number; h: number }, scale: number, args: LayoutSheetArgs) {
  pdf.setDrawColor(...hexToRgb(INK)); pdf.setLineWidth(0.5)
  pdf.rect(tb.x, tb.y, tb.w, tb.h)
  // right-hand metadata column
  const colW = 64
  const cx = tb.x + tb.w - colW
  pdf.line(cx, tb.y, cx, tb.y + tb.h)

  // council + project (left)
  pdf.setFontSize(11); pdf.setTextColor(...hexToRgb(INK)); pdf.setFont('helvetica', 'bold')
  pdf.text(args.title || 'Subdivision layout', tb.x + 4, tb.y + 9)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...hexToRgb(MUTED))
  pdf.text(args.council || 'Vungu Rural District Council — Planning', tb.x + 4, tb.y + 16)
  pdf.setTextColor(...hexToRgb(ACCENT)); pdf.setFontSize(7)
  pdf.text('Proposed layout — not for construction', tb.x + 4, tb.y + 27)

  // area summary (left column) — total area, stand count, avg stand
  const lots = args.lots?.features || []
  if (lots.length) {
    const totalSqm = lots.reduce((s, f) => s + (Number((f.properties as any)?.areaSqm) || 0), 0)
    const avg = Math.round(totalSqm / lots.length)
    pdf.setTextColor(...hexToRgb(MUTED)); pdf.setFontSize(6.5)
    pdf.text(`${lots.length} stands · ${(totalSqm / 10000).toFixed(2)} ha total · avg ${avg} m²`, tb.x + 4, tb.y + 21)
  }

  // metadata grid (right)
  const rows: [string, string][] = [
    ['Drawing', args.drawingNumber || '—'],
    ['Plan/SG', args.planNumber || '—'],
    ['Scale', `1:${scale}  (${args.paper})`],
    ['Date', isoDate()],
    ['Drawn', args.planner || '—'],
  ]
  pdf.setFontSize(6.5)
  let ry = tb.y + 6
  for (const [k, v] of rows) {
    pdf.setTextColor(...hexToRgb(MUTED)); pdf.text(k.toUpperCase(), cx + 3, ry)
    pdf.setTextColor(...hexToRgb(INK)); pdf.setFont('helvetica', 'bold')
    pdf.text(v, cx + 22, ry); pdf.setFont('helvetica', 'normal')
    ry += 5.6
  }
}

/** Label the outer-ring corners of the planning area with local survey X/Y (m). */
function drawCoordinateLabels(pdf: jsPDF, fc: FeatureCollection, project: (c: Position) => [number, number]) {
  const feat = fc.features.find(f => f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon')
  const g: any = feat?.geometry
  if (!g) return
  const ring: Position[] = g.type === 'Polygon' ? g.coordinates[0] : g.coordinates[0][0]
  if (!ring?.length) return
  const f = frameFor(ring[0][0], ring[0][1])
  const ms = ring.map(c => f.fwd(c))
  const minX = Math.min(...ms.map(m => m[0])), minY = Math.min(...ms.map(m => m[1]))
  pdf.setFontSize(4.5); pdf.setTextColor(...hexToRgb(MUTED))
  const seen = new Set<string>()
  ring.forEach((c, i) => {
    const key = `${c[0].toFixed(6)},${c[1].toFixed(6)}`
    if (seen.has(key)) return   // skip the closing duplicate
    seen.add(key)
    const [px, py] = project(c)
    const e = Math.round(ms[i][0] - minX), n = Math.round(ms[i][1] - minY)
    pdf.text(`(${e}, ${n})`, px + 1.2, py - 1)
  })
}

/** Fresh page with a numbered stand schedule table (paginates when long). */
function drawSchedulePage(pdf: jsPDF, args: LayoutSheetArgs) {
  const rows = (args.lots?.features || [])
    .map(f => {
      const p: any = f.properties || {}
      const sqm = Number(p.areaSqm) || 0
      return {
        no: String(p.lotNumber ?? ''),
        sqm, ha: (sqm / 10000).toFixed(4),
        frontage: p.frontageM != null ? String(Math.round(Number(p.frontageM) * 10) / 10) : '—',
        use: String(p.useType || 'single_residential').replace(/_/g, ' '),
      }
    })
    .sort((a, b) => (parseFloat(a.no) || 0) - (parseFloat(b.no) || 0))

  const cols: [string, number][] = [['Stand', 20], ['Area (m²)', 28], ['Area (ha)', 26], ['Frontage (m)', 28], ['Use', 52]]
  const rowH = 6, headerH = 8

  const startPage = () => {
    pdf.addPage(args.paper.toLowerCase(), args.orientation)
    const sheet = paperDims(args.paper, args.orientation)
    const x = M, y = M, w = sheet.w - 2 * M
    pdf.setFontSize(12); pdf.setTextColor(...hexToRgb(INK)); pdf.setFont('helvetica', 'bold')
    pdf.text('Stand Schedule', x, y + 6)
    pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...hexToRgb(MUTED))
    pdf.text(args.title || 'Subdivision layout', x, y + 12)
    // header row
    let hx = x
    const hy = y + 18
    pdf.setFillColor(...hexToRgb('#eef2f7')); pdf.rect(x, hy, w, headerH, 'F')
    pdf.setFontSize(7); pdf.setTextColor(...hexToRgb(INK)); pdf.setFont('helvetica', 'bold')
    for (const [label, cw] of cols) { pdf.text(label, hx + 1.5, hy + 5.4); hx += cw }
    pdf.setFont('helvetica', 'normal')
    return { x, w, bottom: sheet.h - M, y: hy + headerH }
  }

  let ctx = startPage()
  let ry = ctx.y
  pdf.setFontSize(6.5)
  for (const r of rows) {
    if (ry + rowH > ctx.bottom - 4) { ctx = startPage(); ry = ctx.y; pdf.setFontSize(6.5) }
    let cxp = ctx.x
    const cells = [r.no, String(Math.round(r.sqm)), r.ha, r.frontage, r.use]
    pdf.setDrawColor(...hexToRgb(HAIR)); pdf.setLineWidth(0.1)
    pdf.line(ctx.x, ry + rowH, ctx.x + ctx.w, ry + rowH)
    pdf.setTextColor(...hexToRgb(INK))
    cells.forEach((cell, i) => { pdf.text(cell, cxp + 1.5, ry + 4); cxp += cols[i][1] })
    ry += rowH
  }
}
