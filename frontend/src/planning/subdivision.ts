// src/planning/subdivision.ts
// ─────────────────────────────────────────────────────────────────────────
// ParcelFlux-like automatic lot subdivision — the "strip method", now with
// MULTI-FRONTAGE (both-side) loading.
//
// For each chosen frontage edge of a block:
//   1. Build a lottable band, `bandDepth` metres deep, projected inward.
//   2. Walk the baseline in lot-width steps (within [min,max], biased to
//      targetAreaSqm, optional jitter, wider corner lots) and drop a
//      perpendicular cutter at each step.
//   3. (single-frontage rows=2) add one centre cut → back-to-back rows.
//   4. Union the cutters, difference from the band → strips = lots.
//   5. Absorb sub-minimum slivers into the best adjacent lot; otherwise keep
//      them as flagged open space.
//
// frontageMode 'both' loads ONE row from each of the two opposite long edges
// (bandDepth capped at half the edge separation) so rows meet back-to-back or
// leave a central open-space strip. Default 'longest' = the previous behaviour.
//
// Everything is geodesic (turf, metres) and deterministic (seeded jitter).
// Pure functions, no DOM — safe to move into a Web Worker later.
// ─────────────────────────────────────────────────────────────────────────

// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Feature, Polygon, Position, LineString } from 'geojson'
import type { Block, Lot, OpenSpace, SubdivisionRules, FrontageMode } from './planning-types'
import { flattenPolys } from './block-generation'

let seq = 0
const lotId = () => `lot-${Date.now().toString(36)}-${(seq++).toString(36)}`
const osId = () => `os-${Date.now().toString(36)}-${(seq++).toString(36)}`

export interface SubdivisionResult {
  lots: Lot[]
  openSpace: OpenSpace[]
}
export interface SubdivideOpts {
  /** road centre-line to treat as the primary frontage (resolved from frontageRoadId) */
  frontageLine?: LineString
  /** assert (throw) on invalid rules instead of clamping. Defaults to import.meta.env.DEV. */
  strictRules?: boolean
  /** test/runtime override for the emergency "force engine v1" env flag. */
  engineV1Flag?: boolean
}

interface Edge { a: Position; b: Position; len: number; bearing: number; mid: Position }

/** Current default subdivision engine. v1 = legacy shallow band, v2 = smart auto-fill. */
export const SUBDIVISION_ENGINE_DEFAULT = 2 as const

// Debug logging is opt-in (VITE_DEBUG_SUBDIVISION) and rate-limited so prod stays quiet.
const DEBUG_SUBDIVISION =
  (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_DEBUG_SUBDIVISION === 'true')
let _logBudget = 50
function dlog(...args: unknown[]) {
  if (DEBUG_SUBDIVISION && _logBudget-- > 0) console.debug('[subdivision]', ...args)
}

/**
 * Pure engine-version resolver (unit-testable). Precedence:
 * emergency env flag (force v1) > per-project rules.engineVersion > default (v2).
 */
export function resolveEngineVersion(envV1: boolean, projectVersion?: 1 | 2): 1 | 2 {
  if (envV1) return 1
  return projectVersion ?? SUBDIVISION_ENGINE_DEFAULT
}

/** Perpendicular depth of the deepest block vertex from a frontage edge (metres). */
export function measureBlockDepth(poly: Feature<Polygon>, edge: Edge): number {
  const line = turf.lineString([edge.a, edge.b])
  let maxD = 0
  for (const p of poly.geometry.coordinates[0]) {
    let d: number
    try { d = turf.pointToLineDistance(turf.point(p), line as any, { units: 'meters' }) } catch { d = 0 }
    if (d > maxD) maxD = d
  }
  return maxD
}

/**
 * Pure frontage-mode auto-selector (unit-testable): 'both' for an interior block
 * that has an opposite long edge and is shallow enough that two back-to-back rows
 * reach the centre; otherwise 'longest'. Frontage stays two-valued — deep blocks
 * with no opposite street are 'longest' with more interior rows (see tiling).
 */
export function autoFrontageModeForBlock(block: Block, rules: SubdivisionRules): FrontageMode {
  const poly = turf.polygon(block.geom.coordinates)
  const edges = rankedEdges(poly)
  if (!edges.length) return 'longest'
  const primary = edges[0]
  const depth = measureBlockDepth(poly, primary)
  const shallow = rules.shallowDepthFactor ?? 1.3
  const dual = rules.dualFrontageDepthFactor ?? 2.0
  // Shallow block ⇒ one lot deep ⇒ a single frontage row (no centre cut).
  if (depth <= shallow * rules.maxDepthM) return 'longest'
  // Interior block with an opposite street, not too deep ⇒ load both sides.
  const opp = oppositeEdge(edges, primary)
  if (opp && depth <= dual * rules.maxDepthM) return 'both'
  // Otherwise (deep, or no opposite street) ⇒ single frontage + more rows.
  return 'longest'
}

/** Normalise rules; in strict mode throw on invalid config, else clamp + log. */
function sanitizeRules(rules: SubdivisionRules, strict: boolean): SubdivisionRules {
  const problems: string[] = []
  if (rules.minDepthM > rules.maxDepthM) problems.push('minDepthM > maxDepthM')
  if (rules.minWidthM > rules.maxWidthM) problems.push('minWidthM > maxWidthM')
  if ((rules.maxRows ?? 8) < 1) problems.push('maxRows < 1')
  if (rules.minAreaSqm < 0) problems.push('minAreaSqm < 0')
  if (!problems.length) return rules
  if (strict) throw new Error(`Invalid subdivision rules: ${problems.join('; ')}`)
  dlog('clamping invalid rules:', problems.join('; '))
  return {
    ...rules,
    minDepthM: Math.min(rules.minDepthM, rules.maxDepthM),
    maxDepthM: Math.max(rules.minDepthM, rules.maxDepthM),
    minWidthM: Math.min(rules.minWidthM, rules.maxWidthM),
    maxWidthM: Math.max(rules.minWidthM, rules.maxWidthM),
    maxRows: Math.max(1, rules.maxRows ?? 8),
    minAreaSqm: Math.max(0, rules.minAreaSqm),
  }
}

/** Public entry — dispatches to the engine resolved from the flag + project version. */
export function subdivideBlock(block: Block, rules: SubdivisionRules, opts: SubdivideOpts = {}): SubdivisionResult {
  const envV1 = opts.engineV1Flag
    ?? (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUBDIVISION_ENGINE_V1 === 'true')
  const version = resolveEngineVersion(!!envV1, rules.engineVersion)
  const strict = opts.strictRules
    ?? (typeof import.meta !== 'undefined' ? !!(import.meta as any).env?.DEV : true)
  const safeRules = sanitizeRules(rules, strict)
  return version === 1
    ? subdivideBlockV1(block, safeRules, opts)
    : subdivideBlockV2(block, safeRules, opts)
}

// ── Engine v2 — smart auto-fill ───────────────────────────────────────────────
// Frontage decides which street edges load; rows tile each band's full depth.
function subdivideBlockV2(block: Block, rules: SubdivisionRules, opts: SubdivideOpts = {}): SubdivisionResult {
  const poly = turf.polygon(block.geom.coordinates)
  const edges = rankedEdges(poly)
  if (!edges.length) return { lots: [], openSpace: [] }

  // Override precedence: explicit per-block mode > rules mode > geometry auto-select.
  const explicit = block.frontageMode || rules.frontageMode
  const mode: FrontageMode = explicit || autoFrontageModeForBlock(block, rules)

  // Primary frontage: the edge nearest the chosen road, else the longest edge.
  let primary = edges[0]
  if (opts.frontageLine) {
    const near = nearestEdgeTo(edges, opts.frontageLine)
    if (near) primary = near
  }
  const frontEdges: Edge[] = [primary]
  if (mode === 'both') {
    const opp = oppositeEdge(edges, primary)
    if (opp) frontEdges.push(opp)
  }

  const targetRowDepth = (rules.minDepthM + rules.maxDepthM) / 2
  const maxRows = Math.max(1, rules.maxRows ?? 8)
  const maxInteriorRows = Math.max(1, rules.maxInteriorRowsWithoutOppositeEdge ?? 4)

  // Per-edge band depth: 'both' meets in the middle (half the separation); a lone
  // 'longest' edge tiles the full block depth.
  let cappedReserve = false
  const allLots: Lot[] = []
  const openSpace: OpenSpace[] = []
  const bands: Feature<Polygon>[] = []
  for (const e of frontEdges) {
    let bandDepth = measureBlockDepth(poly, e)
    if (frontEdges.length === 2) {
      const other = frontEdges.find(x => x !== e)
      const sep = other ? edgeSeparation(e, other) : bandDepth
      if (sep > 0) bandDepth = Math.min(bandDepth, sep / 2)
    }
    bandDepth = clamp(bandDepth, Math.min(rules.minDepthM, rules.maxDepthM), 400)

    // rows = how many lot-deep rows tile this band, with guardrails.
    let rowsN = clamp(Math.round(bandDepth / targetRowDepth), 1, maxRows)
    while (rowsN > 1 && bandDepth / rowsN < rules.minDepthM) rowsN--   // no skinny rows

    // Deep-block safety: a lone frontage with no opposite street caps its rows and
    // leaves the remaining depth as a tagged central reserve (not landlocked rows).
    if (frontEdges.length === 1 && rowsN > maxInteriorRows) {
      rowsN = maxInteriorRows
      bandDepth = Math.min(bandDepth, rowsN * targetRowDepth)
      cappedReserve = true
    }

    const r = subdivideAlongEdgeV2(poly, e, rules, bandDepth, rowsN, block.id)
    allLots.push(...r.lots)
    openSpace.push(...r.openSpace)
    if (r.band) bands.push(r.band)
  }

  // Leftover = block minus every lottable band. Tag as a deliberate interior
  // reserve when we capped rows; otherwise it's ordinary leftover open space.
  let merged: any = bands.length ? bands[0] : null
  for (let i = 1; i < bands.length; i++) { try { merged = turf.union(merged, bands[i] as any) || merged } catch { /* keep */ } }
  const leftover = leftoverOf(poly, merged)
  for (const os of leftover) {
    if (cappedReserve) { os.kind = 'reserve'; os.interiorReserve = true }
    openSpace.push(os)
  }

  const blockArea = turf.area(poly)
  const osArea = openSpace.reduce((s, o) => s + o.areaSqm, 0)
  if (blockArea > 0 && osArea / blockArea > 0.5) dlog('high open space', Math.round((osArea / blockArea) * 100) + '%', 'block', block.id)

  return { lots: allLots, openSpace }
}

// ── Engine v1 — legacy shallow band (kept for rollback via engineVersion/flag) ──
// TODO(planner-v2): retire one major release after v2 ships — migrate stored v1
// projects to v2, then delete subdivideBlockV1 + the VITE_SUBDIVISION_ENGINE_V1
// flag so we don't maintain two engines indefinitely.
function subdivideBlockV1(block: Block, rules: SubdivisionRules, opts: SubdivideOpts = {}): SubdivisionResult {
  const poly = turf.polygon(block.geom.coordinates)
  const edges = rankedEdges(poly)
  if (!edges.length) return { lots: [], openSpace: [] }

  const mode = (block.frontageMode || rules.frontageMode || 'longest')

  // Primary frontage: the edge nearest the chosen road, else the longest edge.
  let primary = edges[0]
  if (opts.frontageLine) {
    const near = nearestEdgeTo(edges, opts.frontageLine)
    if (near) primary = near
  }
  const frontEdges: Edge[] = [primary]
  if (mode === 'both') {
    const opp = oppositeEdge(edges, primary)
    if (opp) frontEdges.push(opp)
  }

  // Band depth. For both-side loading cap at half the edge separation so the
  // two rows meet back-to-back (or leave a central strip when the block is deep).
  let bandDepth = clamp(rules.maxDepthM, Math.min(rules.minDepthM, rules.maxDepthM), 120)
  if (frontEdges.length === 2) {
    const sep = edgeSeparation(primary, frontEdges[1])
    if (sep > 0) bandDepth = Math.min(bandDepth, sep / 2)
  }
  // Double row only makes sense for single-frontage loading.
  const doubleRow = mode !== 'both' && rules.rows === 2

  const allLots: Lot[] = []
  const openSpace: OpenSpace[] = []
  const bands: Feature<Polygon>[] = []
  for (const e of frontEdges) {
    const r = subdivideAlongEdge(poly, e, rules, bandDepth, block.id, doubleRow)
    allLots.push(...r.lots)
    openSpace.push(...r.openSpace)        // slivers that couldn't be absorbed
    if (r.band) bands.push(r.band)
  }

  // Central / outer leftover = block minus every lottable band → open space.
  let merged: any = bands.length ? bands[0] : null
  for (let i = 1; i < bands.length; i++) { try { merged = turf.union(merged, bands[i] as any) || merged } catch { /* keep */ } }
  for (const os of leftoverOf(poly, merged)) openSpace.push(os)

  return { lots: allLots, openSpace }
}

// ── one frontage band ───────────────────────────────────────────────────────
function subdivideAlongEdge(
  poly: Feature<Polygon>, edge: Edge, rules: SubdivisionRules,
  bandDepth: number, blockId: string, doubleRow: boolean,
): { lots: Lot[]; openSpace: OpenSpace[]; band: Feature<Polygon> | null } {
  const A = edge.a, B = edge.b
  const bearingAB = edge.bearing
  const perp = perpIntoBlock(poly, A, B, bearingAB)

  const band = buildBand(A, B, bearingAB, perp, bandDepth, 2)
  let lottable: any
  try { lottable = turf.intersect(poly as any, band as any) } catch { lottable = null }
  if (!lottable) return { lots: [], openSpace: [], band: null }

  const L = turf.distance(A, B, { units: 'meters' })
  // Bias lot width to hit targetAreaSqm at the band depth, if given.
  const targetWidth = (rules.targetAreaSqm && bandDepth > 0)
    ? clamp(rules.targetAreaSqm / bandDepth, rules.minWidthM, rules.maxWidthM)
    : rules.targetWidthM
  const widths = planWidths(L, rules, targetWidth)

  const cutters: Feature<Polygon>[] = []
  let acc = 0
  for (let i = 0; i < widths.length - 1; i++) {
    acc += widths[i]
    const P = dest(A, acc, bearingAB)
    const a = dest(P, -1, perp)
    const b = dest(P, bandDepth + 2, perp)
    const ribbon = turf.buffer(turf.lineString([a, b]), 0.25, { units: 'meters' })
    if (ribbon) cutters.push(ribbon as any)
  }
  if (doubleRow) {
    const mid = bandDepth / 2
    const a = dest(A, mid, perp)
    const b = dest(B, mid, perp)
    const ribbon = turf.buffer(turf.lineString([a, b]), 0.25, { units: 'meters' })
    if (ribbon) cutters.push(ribbon as any)
  }

  let strips: Feature<Polygon>[]
  if (cutters.length) {
    let cut: any = cutters[0]
    for (let i = 1; i < cutters.length; i++) { try { cut = turf.union(cut, cutters[i] as any) || cut } catch { /* keep */ } }
    let pieces: any
    try { pieces = turf.difference(lottable as any, cut as any) } catch { pieces = lottable }
    strips = pieces ? flattenPolys(pieces) : flattenPolys(lottable)
  } else {
    strips = flattenPolys(lottable)
  }

  const lots: Lot[] = []
  const slivers: Feature<Polygon>[] = []
  for (const s of strips) {
    if (turf.area(s) < rules.minAreaSqm) slivers.push(s)
    else lots.push(makeLot(s, A, bearingAB, blockId))
  }
  const openSpace = absorbSlivers(lots, slivers, A, bearingAB, blockId)
  flagCornersAlong(lots, A, bearingAB)
  return { lots, openSpace, band }
}

// ── one frontage band, tiled into `rowsN` rows (engine v2) ────────────────────
// Same column-cutting as v1 but with rowsN-1 evenly spaced row cuts so the band's
// full depth fills with a width × row grid instead of a single shallow strip.
function subdivideAlongEdgeV2(
  poly: Feature<Polygon>, edge: Edge, rules: SubdivisionRules,
  bandDepth: number, rowsN: number, blockId: string,
): { lots: Lot[]; openSpace: OpenSpace[]; band: Feature<Polygon> | null } {
  const A = edge.a, B = edge.b
  const bearingAB = edge.bearing
  const perp = perpIntoBlock(poly, A, B, bearingAB)

  const band = buildBand(A, B, bearingAB, perp, bandDepth, 2)
  let lottable: any
  try { lottable = turf.intersect(poly as any, band as any) } catch { lottable = null }
  if (!lottable) return { lots: [], openSpace: [], band: null }

  const rowDepth = bandDepth / Math.max(1, rowsN)
  const L = turf.distance(A, B, { units: 'meters' })
  // Bias lot width to hit targetAreaSqm at ONE row's depth (not the whole band).
  const targetWidth = (rules.targetAreaSqm && rowDepth > 0)
    ? clamp(rules.targetAreaSqm / rowDepth, rules.minWidthM, rules.maxWidthM)
    : rules.targetWidthM
  const widths = planWidths(L, rules, targetWidth)

  const cutters: Feature<Polygon>[] = []
  // Column cuts (lot widths along the frontage).
  let acc = 0
  for (let i = 0; i < widths.length - 1; i++) {
    acc += widths[i]
    const P = dest(A, acc, bearingAB)
    const a = dest(P, -1, perp)
    const b = dest(P, bandDepth + 2, perp)
    const ribbon = turf.buffer(turf.lineString([a, b]), 0.25, { units: 'meters' })
    if (ribbon) cutters.push(ribbon as any)
  }
  // Row cuts (rowsN-1 lines parallel to the frontage), spanning the full band.
  const Aext = dest(A, -2, bearingAB)
  const Bext = dest(B, 2, bearingAB)
  for (let r = 1; r < rowsN; r++) {
    const depthR = r * rowDepth
    const a = dest(Aext, depthR, perp)
    const b = dest(Bext, depthR, perp)
    const ribbon = turf.buffer(turf.lineString([a, b]), 0.25, { units: 'meters' })
    if (ribbon) cutters.push(ribbon as any)
  }

  let strips: Feature<Polygon>[]
  if (cutters.length) {
    let cut: any = cutters[0]
    for (let i = 1; i < cutters.length; i++) { try { cut = turf.union(cut, cutters[i] as any) || cut } catch { /* keep */ } }
    let pieces: any
    try { pieces = turf.difference(lottable as any, cut as any) } catch { pieces = lottable }
    strips = pieces ? flattenPolys(pieces) : flattenPolys(lottable)
  } else {
    strips = flattenPolys(lottable)
  }

  const lots: Lot[] = []
  const slivers: Feature<Polygon>[] = []
  for (const s of strips) {
    if (turf.area(s) < rules.minAreaSqm) slivers.push(s)
    else lots.push(makeLot(s, A, bearingAB, blockId))
  }
  const openSpace = absorbSlivers(lots, slivers, A, bearingAB, blockId)
  flagCornersAlong(lots, A, bearingAB)
  return { lots, openSpace, band }
}

// ── lots / slivers ──────────────────────────────────────────────────────────
function makeLot(s: Feature<Polygon>, A: Position, bearing: number, blockId: string): Lot {
  const dims = lotDims(s, A, bearing)
  return {
    id: lotId(), blockId, geom: s.geometry, areaSqm: Math.round(turf.area(s)),
    frontageM: round1(dims.frontage), depthM: round1(dims.depth), status: 'draft',
  }
}

/** Merge each sub-minimum sliver into the best ADJACENT lot; else keep as open space. */
function absorbSlivers(lots: Lot[], slivers: Feature<Polygon>[], A: Position, bearing: number, blockId: string): OpenSpace[] {
  const open: OpenSpace[] = []
  for (const s of slivers) {
    let bestIdx = -1, bestArea = -1, bestUnion: any = null
    for (let i = 0; i < lots.length; i++) {
      try {
        const lp = turf.polygon((lots[i].geom as any).coordinates)
        const u = turf.union(lp, s)
        if (u && u.geometry.type === 'Polygon') {     // single Polygon ⇒ adjacent
          const a = turf.area(lp)
          if (a > bestArea) { bestArea = a; bestIdx = i; bestUnion = u }
        }
      } catch { /* skip */ }
    }
    if (bestIdx >= 0 && bestUnion) {
      const wasCorner = lots[bestIdx].isCorner
      lots[bestIdx] = makeLot(bestUnion, A, bearing, blockId)
      if (wasCorner) lots[bestIdx].isCorner = true
    } else {
      open.push({ id: osId(), geom: s.geometry, areaSqm: Math.round(turf.area(s)), kind: 'leftover' })
    }
  }
  return open
}

// ── geometry helpers ──────────────────────────────────────────────────────
const dest = (p: Position, m: number, bearing: number): Position =>
  turf.destination(p, m, bearing, { units: 'meters' }).geometry.coordinates as Position

function rankedEdges(poly: Feature<Polygon>): Edge[] {
  const ring = poly.geometry.coordinates[0]
  const edges: Edge[] = []
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1]
    const len = turf.distance(a, b, { units: 'meters' })
    if (len < 1) continue
    edges.push({ a, b, len, bearing: turf.bearing(a, b), mid: turf.midpoint(a, b).geometry.coordinates as Position })
  }
  edges.sort((x, y) => y.len - x.len)
  return edges
}
function nearestEdgeTo(edges: Edge[], line: LineString): Edge | null {
  let best: Edge | null = null, bestD = Infinity
  for (const e of edges) {
    let d: number
    try { d = turf.pointToLineDistance(turf.point(e.mid), line as any, { units: 'meters' }) } catch { d = Infinity }
    if (d < bestD) { bestD = d; best = e }
  }
  return best
}
function angleDiff(a: number, b: number): number {
  let d = Math.abs(((a - b) % 360 + 360) % 360)
  if (d > 180) d = 360 - d
  return d
}
/** Longest edge roughly anti-parallel to `primary` (the opposite side of the block). */
function oppositeEdge(edges: Edge[], primary: Edge): Edge | null {
  let best: Edge | null = null, bestLen = -1
  for (const e of edges) {
    if (e === primary) continue
    if (angleDiff(e.bearing, primary.bearing) >= 135 && e.len > bestLen) { bestLen = e.len; best = e }
  }
  return best
}
function edgeSeparation(e1: Edge, e2: Edge): number {
  try { return turf.pointToLineDistance(turf.point(e1.mid), turf.lineString([e2.a, e2.b]) as any, { units: 'meters' }) }
  catch { return 0 }
}
function perpIntoBlock(poly: Feature<Polygon>, A: Position, B: Position, bearingAB: number): number {
  const mid = turf.midpoint(A, B)
  const right = bearingAB + 90
  const test = turf.destination(mid, 1, right, { units: 'meters' })
  return turf.booleanPointInPolygon(test, poly as any) ? right : bearingAB - 90
}
function buildBand(A: Position, B: Position, bearingAB: number, perp: number, depthM: number, ext: number): Feature<Polygon> {
  const A2 = dest(A, -ext, bearingAB)
  const B2 = dest(B, ext, bearingAB)
  const A3 = dest(A2, depthM, perp)
  const B3 = dest(B2, depthM, perp)
  return turf.polygon([[A2, B2, B3, A3, A2]])
}

/** Distribute baseline length into lot widths within [min,max], with corner allowance. */
function planWidths(L: number, rules: SubdivisionRules, targetWidth: number): number[] {
  const target = clamp(targetWidth, rules.minWidthM, rules.maxWidthM)
  let n = Math.max(1, Math.round(L / target))
  if (L / n > rules.maxWidthM) n = Math.ceil(L / rules.maxWidthM)
  if (L / n < rules.minWidthM) n = Math.max(1, Math.floor(L / rules.minWidthM))
  if (n <= 1) return [L]
  const corner = Math.max(0, rules.cornerWidenM || 0)
  const cornerTotal = Math.min(corner * 2, L * 0.4)
  const base = (L - cornerTotal) / n
  const seed = seedToNum(rules.seed)
  const widths: number[] = []
  let used = 0
  for (let i = 0; i < n; i++) {
    let w = base + ((i === 0 || i === n - 1) ? cornerTotal / 2 : 0)
    if (rules.widthVariation > 0 && i > 0 && i < n - 1) {
      const jitter = (pseudo(i, seed) * 2 - 1) * rules.widthVariation * base
      w = clamp(w + jitter, rules.minWidthM, rules.maxWidthM + corner)
    }
    if (i === n - 1) w = Math.max(0, L - used)
    widths.push(w)
    used += w
  }
  return widths
}
/** Stable string/number → numeric seed for deterministic, reproducible jitter. */
function seedToNum(seed?: string | number): number {
  if (typeof seed === 'number') return seed
  if (!seed) return 0
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return Math.abs(h % 100000)
}
function pseudo(i: number, seed = 0): number {
  const x = Math.sin((i + 1) * 12.9898 + seed * 0.12345) * 43758.5453
  return x - Math.floor(x)
}
function lotDims(s: Feature<Polygon>, A: Position, bearingAB: number) {
  const ring = s.geometry.coordinates[0]
  let minProj = Infinity, maxProj = -Infinity
  for (const p of ring) {
    const d = turf.distance(A, p, { units: 'meters' })
    const proj = d * Math.cos(toRad(turf.bearing(A, p) - bearingAB))
    if (proj < minProj) minProj = proj
    if (proj > maxProj) maxProj = proj
  }
  const frontage = Math.max(0, maxProj - minProj)
  const area = turf.area(s)
  return { frontage, depth: frontage > 0 ? area / frontage : 0 }
}
/** Flag the end lots along this baseline as corner lots. */
function flagCornersAlong(lots: Lot[], A: Position, bearing: number) {
  if (!lots.length) return
  const proj = (l: Lot) => {
    const c = turf.centroid(turf.polygon((l.geom as any).coordinates)).geometry.coordinates as Position
    return turf.distance(A, c, { units: 'meters' }) * Math.cos(toRad(turf.bearing(A, c) - bearing))
  }
  const sorted = [...lots].sort((x, y) => proj(x) - proj(y))
  sorted[0].isCorner = true
  sorted[sorted.length - 1].isCorner = true
}
/** Land in the block but outside the lottable band(s) = open space / leftover. */
function leftoverOf(poly: Feature<Polygon>, lottable: any): OpenSpace[] {
  if (!lottable) return []
  try {
    const rest = turf.difference(poly as any, lottable as any)
    if (!rest) return []
    return flattenPolys(rest)
      .filter(p => turf.area(p) > 5)
      .map(p => ({ id: osId(), geom: p.geometry, areaSqm: Math.round(turf.area(p)), kind: 'leftover' as const }))
  } catch { return [] }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const round1 = (v: number) => Math.round(v * 10) / 10
const toRad = (d: number) => (d * Math.PI) / 180
