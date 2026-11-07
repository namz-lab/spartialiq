// src/planning/cad/cadSymbols.ts
// ─────────────────────────────────────────────────────────────────────────
// Symbol library + block insertion (CAD-3 — Blocks/Insert). Each symbol is a
// small set of primitives defined in UNIT metre space (centred on the origin,
// +y = north). `expandSymbol` scales by `sizeM`, rotates clockwise from north,
// translates to the insertion point, and converts to lng/lat — so a placed
// symbol is real, scale-true geometry that renders the same on the map and on
// the Plot sheet. Pure: no Vue, no MapLibre.
// ─────────────────────────────────────────────────────────────────────────
import type { Geometry, Position } from 'geojson'
import { frameFor, type MetreFrame } from './cadGeometry'
import type { SymbolSpec } from './cadModel'

// ── unit-space primitive defs ──────────────────────────────────────────────────
type UnitPrim =
  | { kind: 'path'; pts: [number, number][]; closed?: boolean; role?: 'line' | 'fill' }
  | { kind: 'circle'; c: [number, number]; r: number; role?: 'line' | 'fill' }
  | { kind: 'text'; at: [number, number]; text: string }

export interface SymbolDef { id: string; name: string; defaultSizeM: number; parts: UnitPrim[] }

// A compact, recognisable set for planning site plans. Designed in a ~[-0.5,0.5]
// box so `sizeM` ≈ the symbol's overall ground size.
export const SYMBOL_LIBRARY: Record<string, SymbolDef> = {
  north_arrow: {
    id: 'north_arrow', name: 'North arrow', defaultSizeM: 14,
    parts: [
      { kind: 'circle', c: [0, 0], r: 0.5, role: 'line' },
      { kind: 'path', pts: [[0, 0.5], [-0.22, 0.02], [0.22, 0.02]], closed: true, role: 'fill' },
      { kind: 'path', pts: [[0, 0.02], [0, -0.42]], role: 'line' },
      { kind: 'text', at: [0, 0.72], text: 'N' },
    ],
  },
  survey_beacon: {
    id: 'survey_beacon', name: 'Survey beacon', defaultSizeM: 6,
    parts: [
      { kind: 'path', pts: [[0, 0.5], [-0.43, -0.25], [0.43, -0.25]], closed: true, role: 'line' },
      { kind: 'circle', c: [0, 0], r: 0.07, role: 'fill' },
    ],
  },
  tree: {
    id: 'tree', name: 'Tree', defaultSizeM: 6,
    parts: [
      { kind: 'circle', c: [0, 0], r: 0.5, role: 'line' },
      { kind: 'circle', c: [0, 0], r: 0.06, role: 'fill' },
    ],
  },
  manhole: {
    id: 'manhole', name: 'Manhole', defaultSizeM: 1.2,
    parts: [
      { kind: 'path', pts: [[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [-0.5, 0.5]], closed: true, role: 'line' },
      { kind: 'path', pts: [[-0.5, -0.5], [0.5, 0.5]], role: 'line' },
      { kind: 'path', pts: [[-0.5, 0.5], [0.5, -0.5]], role: 'line' },
    ],
  },
  hydrant: {
    id: 'hydrant', name: 'Fire hydrant', defaultSizeM: 1.5,
    parts: [
      { kind: 'circle', c: [0, 0], r: 0.4, role: 'line' },
      { kind: 'path', pts: [[-0.4, 0], [-0.62, 0]], role: 'line' },
      { kind: 'path', pts: [[0.4, 0], [0.62, 0]], role: 'line' },
    ],
  },
  light_pole: {
    id: 'light_pole', name: 'Light pole', defaultSizeM: 3,
    parts: [
      { kind: 'circle', c: [0, 0], r: 0.16, role: 'fill' },
      { kind: 'path', pts: [[0, 0.26], [0, 0.5]], role: 'line' },
      { kind: 'path', pts: [[0, -0.26], [0, -0.5]], role: 'line' },
      { kind: 'path', pts: [[0.26, 0], [0.5, 0]], role: 'line' },
      { kind: 'path', pts: [[-0.26, 0], [-0.5, 0]], role: 'line' },
    ],
  },
}

export const SYMBOL_LIST = Object.values(SYMBOL_LIBRARY)

// ── expansion ───────────────────────────────────────────────────────────────────
export interface SymbolPart { geom: Geometry; role: 'line' | 'fill' | 'text'; text?: string }

function unitCircleRing(c: [number, number], r: number, segs = 28): [number, number][] {
  const ring: [number, number][] = []
  for (let i = 0; i <= segs; i++) {
    const a = (i / segs) * 2 * Math.PI
    ring.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)])
  }
  return ring
}

/**
 * Expand a symbol placement into scale-true lng/lat geometry parts. `rotationDeg`
 * is clockwise from north (north-up, east-+x frame).
 */
export function expandSymbol(spec: SymbolSpec, insertLngLat: [number, number], frame?: MetreFrame): SymbolPart[] {
  const def = SYMBOL_LIBRARY[spec.symbolId]
  if (!def) return []
  const f = frame ?? frameFor(insertLngLat[0], insertLngLat[1])
  const O = f.fwd(insertLngLat)
  const rad = (spec.rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad), sin = Math.sin(rad)
  const size = spec.sizeM > 0 ? spec.sizeM : def.defaultSizeM

  // unit point → lng/lat: scale, rotate clockwise, translate to insertion, inv-project
  const tx = ([ux, uy]: [number, number]): Position => {
    const sx = ux * size, sy = uy * size
    const rx = sx * cos + sy * sin
    const ry = -sx * sin + sy * cos
    return f.inv([O[0] + rx, O[1] + ry])
  }

  const out: SymbolPart[] = []
  for (const p of def.parts) {
    if (p.kind === 'text') {
      out.push({ geom: { type: 'Point', coordinates: tx(p.at) }, role: 'text', text: p.text })
    } else if (p.kind === 'circle') {
      const ring = unitCircleRing(p.c, p.r).map(tx)
      out.push({ geom: { type: 'Polygon', coordinates: [ring] }, role: p.role || 'line' })
    } else {
      const pts = p.pts.map(tx)
      if (p.closed) out.push({ geom: { type: 'Polygon', coordinates: [[...pts, pts[0]]] }, role: p.role || 'line' })
      else out.push({ geom: { type: 'LineString', coordinates: pts }, role: p.role || 'line' })
    }
  }
  return out
}
