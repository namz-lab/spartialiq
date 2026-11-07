// src/planning/planning-exports.ts
// ─────────────────────────────────────────────────────────────────────────
// Subdivision deliverables: a lot-schedule CSV and a printable plan PDF.
//   • exportLotScheduleCsv  — pure data, no map needed (called from the panel)
//   • exportSubdivisionPlanPdf — layout image + north arrow + scale bar +
//     metrics + a paginated schedule of lots (called from the map view, which
//     supplies the captured canvas image).
// jsPDF is already a project dependency (see map/tools/mapExport.ts).
// ─────────────────────────────────────────────────────────────────────────

import { jsPDF } from 'jspdf'
import type { Lot, PlanningMetrics } from './planning-types'

const isoDate = () => new Date().toISOString().slice(0, 10)
const slug = (s: string) =>
  (s || 'subdivision').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'subdivision'
const shortId = (id: string) => String(id || '').replace(/^(blk|lot)-/, '').slice(0, 10)

function downloadText(filename: string, text: string, mime = 'text/plain') {
  const blob = new Blob([text], { type: mime })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

// ── Lot schedule CSV ────────────────────────────────────────────────────────
function csvCell(v: unknown): string {
  const s = String(v ?? '')
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function exportLotScheduleCsv(lots: Lot[], projectName = 'subdivision'): number {
  const header = ['Lot', 'Block', 'Area (m2)', 'Area (ha)', 'Frontage (m)', 'Depth (m)', 'Corner', 'Status']
  const rows: string[][] = lots.map((l, i) => ([
    l.lotNumber ?? String(i + 1),
    shortId(l.blockId),
    String(l.areaSqm),
    (l.areaSqm / 10000).toFixed(4),
    String(l.frontageM),
    String(l.depthM),
    l.isCorner ? 'yes' : '',
    l.status,
  ]))
  const total = lots.reduce((s, l) => s + l.areaSqm, 0)
  const blockCount = new Set(lots.map(l => l.blockId)).size
  rows.push([])
  rows.push(['TOTAL', `${blockCount} blocks`, String(total), (total / 10000).toFixed(4), '', '', '', `${lots.length} lots`])
  const csv = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
  downloadText(`${slug(projectName)}-lot-schedule-${isoDate()}.csv`, csv, 'text/csv;charset=utf-8')
  return lots.length
}

// ── Subdivision plan PDF ────────────────────────────────────────────────────
export interface PlanPdfArgs {
  title: string
  imageDataUrl: string | null
  imgWidthPx: number
  imgHeightPx: number
  /** ground metres per screen pixel at the map centre (for the scale bar) */
  metresPerPixel: number
  metrics: PlanningMetrics
  lots: Lot[]
  areaSqm: number
}

const ACCENT: [number, number, number] = [3, 105, 161]
const INK: [number, number, number] = [15, 23, 42]
const MUTED: [number, number, number] = [95, 99, 104]
const HAIR: [number, number, number] = [218, 220, 224]

export function exportSubdivisionPlanPdf(args: PlanPdfArgs): void {
  const pdf = new jsPDF({ orientation: 'landscape', unit: 'pt', format: 'a4' })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 28
  const headerH = 58
  const footerH = 26

  // Header.
  pdf.setFillColor(...ACCENT); pdf.rect(0, 0, pageW, 6, 'F')
  pdf.setTextColor(...INK); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(15)
  pdf.text(args.title || 'Subdivision plan', margin, 32)
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(10); pdf.setTextColor(...MUTED)
  pdf.text('Vungu Rural District Council — Subdivision plan', margin, 47)

  // Map image (left ~64%).
  const mapBoxW = (pageW - margin * 2) * 0.64
  const mapBoxH = pageH - headerH - footerH - margin
  const imgX = margin, imgY = headerH
  if (args.imageDataUrl && args.imgWidthPx && args.imgHeightPx) {
    const ratio = Math.min(mapBoxW / args.imgWidthPx, mapBoxH / args.imgHeightPx)
    const w = args.imgWidthPx * ratio
    const h = args.imgHeightPx * ratio
    pdf.addImage(args.imageDataUrl, 'PNG', imgX, imgY, w, h)
    pdf.setDrawColor(...HAIR); pdf.rect(imgX, imgY, w, h)
    drawNorthArrow(pdf, imgX + w - 24, imgY + 28)
    // metres per PDF point = metres/screen-px × screen-px/point
    const mppPdf = args.metresPerPixel * (args.imgWidthPx / w)
    drawScaleBar(pdf, imgX + 14, imgY + h - 16, mppPdf)
  } else {
    pdf.setDrawColor(...HAIR); pdf.rect(imgX, imgY, mapBoxW, mapBoxH)
    pdf.setTextColor(150, 150, 150); pdf.setFontSize(10)
    pdf.text('(map image unavailable)', imgX + 14, imgY + 22)
  }

  // Right column — summary metrics.
  const rx = margin + mapBoxW + 18
  let ry = headerH + 8
  pdf.setTextColor(...INK); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(11)
  pdf.text('Summary', rx, ry); ry += 18
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(9); pdf.setTextColor(40, 40, 40)
  const m = args.metrics
  const lines = [
    `Planning area:  ${(args.areaSqm / 10000).toFixed(2)} ha`,
    `Lots:  ${m.lotCount}`,
    `Average lot:  ${m.avgLotAreaSqm} m²`,
    `Gross density:  ${m.grossDensityPerHa} /ha`,
    `Road length:  ${m.roadLengthM} m`,
    `Open space:  ${m.openSpacePct} %`,
    `Efficiency:  ${m.efficiencyPct} %`,
  ]
  for (const ln of lines) { pdf.text(ln, rx, ry); ry += 15 }

  // Footer.
  pdf.setFont('helvetica', 'normal'); pdf.setFontSize(8); pdf.setTextColor(...MUTED)
  pdf.text(`Generated ${new Date().toLocaleString()}`, margin, pageH - 12)
  pdf.text('Vungu RDC Planning — in-browser subdivision tool', pageW - margin, pageH - 12, { align: 'right' })

  // Schedule pages.
  addLotSchedulePages(pdf, args.lots)

  pdf.save(`${slug(args.title)}-plan-${isoDate()}.pdf`)
}

function drawNorthArrow(pdf: jsPDF, x: number, y: number) {
  pdf.setFillColor(255, 255, 255); pdf.circle(x, y, 13, 'F')
  pdf.setDrawColor(...INK); pdf.circle(x, y, 13, 'S')
  pdf.setFillColor(...INK)
  pdf.triangle(x, y - 9, x - 5, y + 5, x + 5, y + 5, 'F')
  pdf.setFontSize(8); pdf.setTextColor(...INK)
  pdf.text('N', x, y + 12, { align: 'center' })
}

function drawScaleBar(pdf: jsPDF, x: number, y: number, mppPdf: number) {
  if (!isFinite(mppPdf) || mppPdf <= 0) return
  // pick a "nice" round ground distance whose bar is ~110 pt
  let metres = mppPdf * 110
  const pow = Math.pow(10, Math.floor(Math.log10(metres)))
  const f = metres / pow
  const nice = f >= 5 ? 5 : f >= 2 ? 2 : 1
  metres = nice * pow
  const barPt = metres / mppPdf
  // white backing for legibility over the map
  pdf.setFillColor(255, 255, 255); pdf.rect(x - 4, y - 14, barPt + 8, 20, 'F')
  pdf.setDrawColor(...INK); pdf.setLineWidth(2); pdf.line(x, y, x + barPt, y)
  pdf.setLineWidth(0.5); pdf.line(x, y - 3, x, y + 3); pdf.line(x + barPt, y - 3, x + barPt, y + 3)
  pdf.setFontSize(7); pdf.setTextColor(...INK)
  const label = metres >= 1000 ? `${metres / 1000} km` : `${metres} m`
  pdf.text(label, x + barPt / 2, y - 4, { align: 'center' })
}

function addLotSchedulePages(pdf: jsPDF, lots: Lot[]) {
  if (!lots.length) return
  pdf.addPage('a4', 'portrait')
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 36
  let y = margin

  pdf.setFillColor(...ACCENT); pdf.rect(0, 0, pageW, 6, 'F')
  pdf.setTextColor(...INK); pdf.setFont('helvetica', 'bold'); pdf.setFontSize(13)
  pdf.text('Schedule of lots', margin, y + 18); y += 36

  const cols = [
    { label: 'Lot', w: 50 },
    { label: 'Block', w: 120 },
    { label: 'Area (m²)', w: 80 },
    { label: 'Area (ha)', w: 70 },
    { label: 'Frontage (m)', w: 90 },
    { label: 'Depth (m)', w: 70 },
  ]
  const drawHeader = () => {
    pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...INK)
    let x = margin
    for (const c of cols) { pdf.text(c.label, x, y); x += c.w }
    y += 4; pdf.setDrawColor(200, 200, 200); pdf.line(margin, y, pageW - margin, y); y += 12
    pdf.setFont('helvetica', 'normal')
  }
  drawHeader()

  let total = 0
  for (let i = 0; i < lots.length; i++) {
    const l = lots[i]; total += l.areaSqm
    if (y > pageH - margin - 26) { pdf.addPage('a4', 'portrait'); y = margin + 10; drawHeader() }
    const vals = [
      l.lotNumber ?? String(i + 1),
      shortId(l.blockId),
      String(l.areaSqm),
      (l.areaSqm / 10000).toFixed(3),
      String(l.frontageM),
      String(l.depthM),
    ]
    pdf.setFontSize(8); pdf.setTextColor(40, 40, 40)
    let x = margin
    for (let c = 0; c < cols.length; c++) { pdf.text(vals[c], x, y); x += cols[c].w }
    y += 13
  }

  if (y > pageH - margin - 26) { pdf.addPage('a4', 'portrait'); y = margin + 10 }
  y += 4; pdf.setDrawColor(200, 200, 200); pdf.line(margin, y, pageW - margin, y); y += 14
  pdf.setFont('helvetica', 'bold'); pdf.setFontSize(8); pdf.setTextColor(...INK)
  pdf.text(`TOTAL — ${lots.length} lots`, margin, y)
  pdf.text(`${total} m²  (${(total / 10000).toFixed(3)} ha)`, margin + 200, y)
}
