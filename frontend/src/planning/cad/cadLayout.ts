// src/planning/cad/cadLayout.ts
// ─────────────────────────────────────────────────────────────────────────
// Paper-space layout engine (CAD-3 — Layout & Viewports). Pure math: paper
// sizes, engineering scales, and a SCALE-TRUE projector that maps lng/lat to
// millimetres on the sheet. At scale 1:S, one ground metre is exactly 1000/S mm
// on paper — so a 12 m road reserve plots at 12 mm at 1:1000. All metric work
// runs in the local UTM metre frame (cadGeometry.ts) so it is survey-accurate.
// No Vue, no jsPDF here — the renderer (cadLayoutPdf.ts) consumes this.
// ─────────────────────────────────────────────────────────────────────────
import type { Feature, FeatureCollection, Position } from 'geojson'
import { frameFor, type MetreFrame } from './cadGeometry'

// ── paper sizes (mm, portrait) ─────────────────────────────────────────────────
export type PaperName = 'A4' | 'A3' | 'A2' | 'A1' | 'A0'
export type Orientation = 'portrait' | 'landscape'

const PAPER_PORTRAIT: Record<PaperName, { w: number; h: number }> = {
  A4: { w: 210, h: 297 },
  A3: { w: 297, h: 420 },
  A2: { w: 420, h: 594 },
  A1: { w: 594, h: 841 },
  A0: { w: 841, h: 1189 },
}

/** Sheet dimensions (mm) for a paper size + orientation. */
export function paperDims(name: PaperName, orientation: Orientation): { w: number; h: number } {
  const p = PAPER_PORTRAIT[name] || PAPER_PORTRAIT.A3
  return orientation === 'landscape' ? { w: p.h, h: p.w } : { w: p.w, h: p.h }
}

// ── engineering scales ─────────────────────────────────────────────────────────
/** The denominators planners actually plot at (1:S). */
export const ENGINEERING_SCALES = [
  100, 200, 250, 500, 1000, 1250, 2000, 2500, 5000, 10000, 20000, 25000, 50000, 100000,
]

/** Smallest engineering scale whose denominator is ≥ `minScale` (rounds OUT so
 *  content always fits). Falls back to the largest scale if nothing is big enough. */
export function niceScale(minScale: number): number {
  for (const s of ENGINEERING_SCALES) if (s >= minScale) return s
  return ENGINEERING_SCALES[ENGINEERING_SCALES.length - 1]
}

// ── coordinate walk + metric bounds ─────────────────────────────────────────────
function* eachCoord(fc: FeatureCollection | Feature[]): Generator<Position> {
  const feats = Array.isArray(fc) ? fc : fc.features
  const walk = function* (c: any): Generator<Position> {
    if (Array.isArray(c) && typeof c[0] === 'number') { yield c as Position; return }
    if (Array.isArray(c)) for (const x of c) yield* walk(x)
  }
  for (const f of feats) {
    const g: any = (f as any).geometry
    if (g?.coordinates) yield* walk(g.coordinates)
  }
}

export interface MetricBounds {
  minX: number; minY: number; maxX: number; maxY: number
  widthM: number; heightM: number
  centerM: [number, number]
  /** lng/lat of the first coordinate, used to anchor the metre frame. */
  anchorLngLat: [number, number] | null
}

/** Metric bounding box of all coordinates, in the supplied (or derived) frame. */
export function boundsMetres(features: FeatureCollection | Feature[], frame?: MetreFrame): { bounds: MetricBounds; frame: MetreFrame } {
  let anchor: [number, number] | null = null
  for (const c of eachCoord(features)) { anchor = [c[0], c[1]]; break }
  const f = frame ?? frameFor(anchor ? anchor[0] : 29.82, anchor ? anchor[1] : -19.48)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
  for (const c of eachCoord(features)) {
    const [x, y] = f.fwd(c)
    if (x < minX) minX = x; if (y < minY) minY = y
    if (x > maxX) maxX = x; if (y > maxY) maxY = y
  }
  if (!isFinite(minX)) { minX = minY = maxX = maxY = 0 }
  const widthM = maxX - minX, heightM = maxY - minY
  return {
    frame: f,
    bounds: {
      minX, minY, maxX, maxY, widthM, heightM,
      centerM: [(minX + maxX) / 2, (minY + maxY) / 2],
      anchorLngLat: anchor,
    },
  }
}

// ── fit-to-frame scale ───────────────────────────────────────────────────────────
/** The engineering scale at which `widthM × heightM` of ground fits a viewport of
 *  `frameMmW × frameMmH` (mm). Picks the tighter dimension, rounds out to a nice scale. */
export function fitScale(widthM: number, heightM: number, frameMmW: number, frameMmH: number): number {
  const safeW = Math.max(widthM, 1e-6), safeH = Math.max(heightM, 1e-6)
  // need: groundM × (1000/S) ≤ frameMm  →  S ≥ groundM × 1000 / frameMm
  const sW = (safeW * 1000) / Math.max(frameMmW, 1)
  const sH = (safeH * 1000) / Math.max(frameMmH, 1)
  return niceScale(Math.max(sW, sH))
}

// ── projector (lng/lat → mm on the sheet) ────────────────────────────────────────
export interface Viewport { x: number; y: number; w: number; h: number }   // mm

/**
 * Build a scale-true projector. Content is centred in `viewport`; north is up
 * (paper y grows downward, so northing is negated). 1 ground metre → 1000/scale mm.
 */
export function makeProjector(
  frame: MetreFrame, centerM: [number, number], scale: number, viewport: Viewport,
): (lngLat: Position) => [number, number] {
  const mmPerM = 1000 / scale
  const cx = viewport.x + viewport.w / 2
  const cy = viewport.y + viewport.h / 2
  return (lngLat: Position) => {
    const [mx, my] = frame.fwd(lngLat)
    return [cx + (mx - centerM[0]) * mmPerM, cy - (my - centerM[1]) * mmPerM]
  }
}

/** Metres that map to `mm` on paper at `scale` (for line widths / scale bar). */
export function metresToMm(metres: number, scale: number): number {
  return (metres * 1000) / scale
}

/** A "nice" round ground distance whose scale bar is about `targetMm` long. */
export function scaleBarMetres(scale: number, targetMm = 40): number {
  const groundForTarget = (targetMm * scale) / 1000   // metres represented by targetMm
  const pow = Math.pow(10, Math.floor(Math.log10(groundForTarget)))
  const f = groundForTarget / pow
  const nice = f >= 5 ? 5 : f >= 2 ? 2 : 1
  return nice * pow
}
