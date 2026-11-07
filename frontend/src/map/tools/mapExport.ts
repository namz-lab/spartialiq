// src/map/tools/mapExport.ts
// ─────────────────────────────────────────────────────────────────────────
// Export the CURRENT map view to a print-ready PDF.
//
// Fixes the "no map print/export" gap: a council needs to attach a map of the
// site to a committee report or a statutory notice. This renders the live
// MapLibre canvas plus a header (title + subtitle), a footer (centre
// coordinates, zoom, scale, timestamp), an optional legend, and the data
// attribution — the standard municipal map-sheet furniture.
//
// REQUIRES the map to be created with `preserveDrawingBuffer: true`; otherwise
// the WebGL drawing buffer is cleared after each frame and toDataURL() returns
// a blank image. The shared InteractiveMap sets this (see its map options).
// ─────────────────────────────────────────────────────────────────────────

import { jsPDF } from 'jspdf'

export interface LegendEntry {
  label: string
  color: string
}

export interface MapExportOptions {
  title?: string
  subtitle?: string
  /** optional swatch + label rows drawn over the top-left of the map image */
  legend?: LegendEntry[]
  /** file name without extension */
  fileName?: string
}

const ACCENT: [number, number, number] = [26, 115, 232]
const INK: [number, number, number] = [32, 33, 36]
const MUTED: [number, number, number] = [95, 99, 104]
const HAIRLINE: [number, number, number] = [218, 220, 224]

/** Resolve once the map has finished rendering, with a hard timeout fallback. */
function waitIdle(map: any): Promise<void> {
  return new Promise<void>((resolve) => {
    let done = false
    const finish = () => {
      if (done) return
      done = true
      resolve()
    }
    try {
      map.triggerRepaint?.()
      if (typeof map.once === 'function') map.once('idle', finish)
    } catch {
      /* fall through to the timeout */
    }
    setTimeout(finish, 600)
  })
}

/** Approximate ground resolution (metres per pixel) at the map centre. */
function metresPerPixel(map: any): number {
  const lat = map.getCenter().lat
  const zoom = map.getZoom()
  return (40075016.686 * Math.abs(Math.cos((lat * Math.PI) / 180))) / Math.pow(2, zoom + 8)
}

export async function exportMapToPdf(map: any, opts: MapExportOptions = {}): Promise<void> {
  if (!map || typeof map.getCanvas !== 'function') return

  const title = opts.title || 'Vungu Rural District Council — Map'
  const subtitle = opts.subtitle || ''

  await waitIdle(map)

  const canvas = map.getCanvas()
  const dataUrl = canvas.toDataURL('image/png')
  const wpx = canvas.width
  const hpx = canvas.height
  const landscape = wpx >= hpx

  const pdf = new jsPDF({
    orientation: landscape ? 'landscape' : 'portrait',
    unit: 'pt',
    format: 'a4',
  })
  const pageW = pdf.internal.pageSize.getWidth()
  const pageH = pdf.internal.pageSize.getHeight()
  const margin = 28
  const headerH = 58
  const footerH = 30

  // ── Header ──────────────────────────────────────────────────────────────
  pdf.setFillColor(...ACCENT)
  pdf.rect(0, 0, pageW, 6, 'F')
  pdf.setTextColor(...INK)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(15)
  pdf.text(title, margin, 34)
  if (subtitle) {
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(10)
    pdf.setTextColor(...MUTED)
    pdf.text(subtitle, margin, 49)
  }

  // ── Map image (fit within content box, preserve aspect ratio) ───────────
  const contentW = pageW - margin * 2
  const contentH = pageH - headerH - footerH - margin
  const ratio = Math.min(contentW / wpx, contentH / hpx)
  const imgW = wpx * ratio
  const imgH = hpx * ratio
  const imgX = margin + (contentW - imgW) / 2
  const imgY = headerH
  pdf.addImage(dataUrl, 'PNG', imgX, imgY, imgW, imgH)
  pdf.setDrawColor(...HAIRLINE)
  pdf.rect(imgX, imgY, imgW, imgH)

  // ── Legend (top-left over the map, on a white card) ─────────────────────
  if (opts.legend && opts.legend.length) {
    const rowH = 14
    const padding = 8
    const boxW = 132
    const boxH = padding * 2 + opts.legend.length * rowH
    const lx = imgX + 10
    const ly = imgY + 10
    pdf.setFillColor(255, 255, 255)
    pdf.setDrawColor(...HAIRLINE)
    pdf.rect(lx, ly, boxW, boxH, 'FD')
    pdf.setFontSize(8)
    opts.legend.forEach((entry, i) => {
      const ry = ly + padding + i * rowH
      const rgb = hexToRgb(entry.color)
      pdf.setFillColor(rgb[0], rgb[1], rgb[2])
      pdf.rect(lx + padding, ry + 2, 9, 9, 'F')
      pdf.setTextColor(...INK)
      pdf.text(entry.label, lx + padding + 15, ry + 9.5)
    })
  }

  // ── Footer ──────────────────────────────────────────────────────────────
  const c = map.getCenter()
  const z = map.getZoom()
  const mpp = metresPerPixel(map)
  // Real-world length of a 100-pixel bar at the map centre.
  const barMeters = Math.round(mpp * 100)
  const stamp = new Date().toLocaleString()
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(8)
  pdf.setTextColor(...MUTED)
  pdf.text(
    `Centre ${c.lat.toFixed(5)}, ${c.lng.toFixed(5)}   ·   Zoom ${z.toFixed(1)}   ·   ~${barMeters} m / 100 px   ·   ${stamp}`,
    margin,
    pageH - 14,
  )
  pdf.text('Map data © OpenStreetMap contributors · Imagery © Esri', pageW - margin, pageH - 14, {
    align: 'right',
  })

  pdf.save(`${opts.fileName || 'vungu-map'}-${Date.now()}.pdf`)
}

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim())
  if (!m) return [128, 128, 128]
  return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)]
}
