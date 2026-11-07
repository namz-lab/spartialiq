// Survey plan generator — renders a scaled, dimensioned diagram for a
// cadastral parcel captured via the surveyor COGO tools.
//
// ponytail: no SI 727 prescribed-scale table, no beacon symbols, no
// GeoPDF (georeferenced re-import). Those need real CRS anchoring; this
// produces a printable/exportable SVG diagram (open it, Ctrl+P -> Save as
// PDF) with continuous auto-fit scale, not an exact Surveyor-General
// submission artifact. Points are unprojected P(Y,X) meters
// (south-oriented ZIM convention) — no north arrow, since true north
// can't be drawn honestly from unprojected points.

export interface SurveyPlanEdge {
  distanceRounded: number
  directionDMS: string
}

export interface SurveyPlanInput {
  standNumber: string | null
  ward: string | null
  taskType: string
  points: Array<{ y: number; x: number }>
  edges: SurveyPlanEdge[]
  areaM2: number
  perimeterM: number
  closureErrorM: number
  closureRatio: string | null
  status: string
}

const PAGE_W = 297 // A4 landscape, mm
const PAGE_H = 210
const MARGIN = 20
const DRAW_W = PAGE_W - MARGIN * 2
const DRAW_H = PAGE_H - MARGIN * 2 - 20 // leave room for title + info block

function bbox(points: Array<{ y: number; x: number }>) {
  const ys = points.map(p => p.y)
  const xs = points.map(p => p.x)
  const minY = Math.min(...ys), maxY = Math.max(...ys)
  const minX = Math.min(...xs), maxX = Math.max(...xs)
  return { minY, maxY, minX, maxX, width: maxY - minY || 1, height: maxX - minX || 1 }
}

export function generateSurveyPlanSVG(plan: SurveyPlanInput): string {
  const b = bbox(plan.points)
  const scale = Math.max(
    Math.min((DRAW_W * 0.85) / b.width, (DRAW_H * 0.85) / b.height),
    0.001,
  ) // mm per meter, uncapped — auto-fit, not a prescribed scale
  const offX = MARGIN + (DRAW_W - b.width * scale) / 2
  const offY = MARGIN + 15 + (DRAW_H - b.height * scale) / 2

  const toSvg = (p: { y: number; x: number }) => ({
    sx: offX + (p.y - b.minY) * scale,
    sy: offY + (p.x - b.minX) * scale,
  })

  const svgPts = plan.points.map(toSvg)
  const pathD = svgPts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.sx.toFixed(2)} ${p.sy.toFixed(2)}`).join(' ') + ' Z'

  let edgeLabels = ''
  for (let i = 0; i < svgPts.length; i++) {
    const a = svgPts[i]
    const c = svgPts[(i + 1) % svgPts.length]
    const midX = (a.sx + c.sx) / 2
    const midY = (a.sy + c.sy) / 2
    const edge = plan.edges[i]
    if (!edge) continue
    edgeLabels += `<text x="${midX.toFixed(2)}" y="${midY.toFixed(2)}" font-family="Arial" font-size="2.6" text-anchor="middle" fill="#334155">${edge.distanceRounded.toFixed(2)}m ${edge.directionDMS}</text>`
  }

  const title = `SURVEY PLAN — ${plan.standNumber ? 'Stand ' + plan.standNumber : plan.taskType}`
  const subtitle = [plan.ward, plan.taskType].filter(Boolean).join(' · ')
  const scaleLabel = `1:${Math.round(1000 / scale)}`
  const areaLabel = plan.areaM2 >= 10000
    ? `${(plan.areaM2 / 10000).toFixed(4)} ha`
    : `${plan.areaM2.toFixed(0)} m²`

  return `<?xml version="1.0" encoding="UTF-8"?>
<svg width="${PAGE_W}mm" height="${PAGE_H}mm" viewBox="0 0 ${PAGE_W} ${PAGE_H}" xmlns="http://www.w3.org/2000/svg" font-family="Arial, sans-serif">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <rect x="5" y="5" width="${PAGE_W - 10}" height="${PAGE_H - 10}" fill="none" stroke="#cbd5e1" stroke-width="0.4"/>
  <text x="${MARGIN}" y="${MARGIN - 6}" font-size="5" font-weight="bold" fill="#0f172a">${title}</text>
  <text x="${MARGIN}" y="${MARGIN - 1}" font-size="3" fill="#475569">${subtitle}</text>
  <path d="${pathD}" fill="#eef2ff" fill-opacity="0.5" stroke="#4338ca" stroke-width="0.5"/>
  ${edgeLabels}
  <g transform="translate(${MARGIN}, ${PAGE_H - MARGIN + 3})">
    <line x1="0" y1="0" x2="30" y2="0" stroke="#0f172a" stroke-width="0.4"/>
    <text x="15" y="4" font-size="2.6" text-anchor="middle" fill="#0f172a">Scale ${scaleLabel} (auto-fit, not SI 727 prescribed)</text>
  </g>
  <g transform="translate(${PAGE_W - MARGIN - 70}, ${PAGE_H - MARGIN - 22})">
    <rect x="0" y="0" width="70" height="22" fill="none" stroke="#0f172a" stroke-width="0.3"/>
    <text x="2" y="5" font-size="2.6" fill="#0f172a">Area: ${areaLabel}</text>
    <text x="2" y="9" font-size="2.6" fill="#0f172a">Perimeter: ${plan.perimeterM.toFixed(2)} m</text>
    <text x="2" y="13" font-size="2.6" fill="#0f172a">Closure: ${plan.closureErrorM.toFixed(3)} m (${plan.closureRatio ?? '—'})</text>
    <text x="2" y="17" font-size="2.6" fill="#0f172a">Status: ${plan.status} · P(Y,X) south-oriented</text>
    <text x="2" y="21" font-size="2.2" fill="#64748b">Generated ${new Date().toLocaleDateString()} — not georeferenced</text>
  </g>
</svg>`
}

export function surveyPlanDataURL(plan: SurveyPlanInput): string {
  const svg = generateSurveyPlanSVG(plan)
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`
}
