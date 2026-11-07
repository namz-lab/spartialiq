// @vitest-environment happy-dom
// ─────────────────────────────────────────────────────────────────────────
// Pure-logic + synthetic-geometry tests for the smart auto-fill engine (v2):
// frontage auto-selection, engine-version resolution, row tiling + guardrails,
// strict/clamp misconfig handling, and edge-case geometry (donut, concave).
// No DB, no Vue — exercises subdivision.ts directly with deterministic seeds.
// ─────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { Block } from '../planning-types'
import { DEFAULT_RULES } from '../planning-types'
import {
  subdivideBlock, resolveEngineVersion, measureBlockDepth, autoFrontageModeForBlock,
  SUBDIVISION_ENGINE_DEFAULT,
} from '../subdivision'

const O: [number, number] = [29.8, -19.4]
const move = (p: number[], m: number, bearing: number) =>
  turf.destination(p, m, bearing, { units: 'meters' }).geometry.coordinates as [number, number]

/** Axis-aligned rectangle block: `widthM` along the east edge, `depthM` to north. */
function rectBlock(widthM: number, depthM: number, id = 'rect'): Block {
  const o = O
  const e = move(o, widthM, 90)
  const ne = move(e, depthM, 0)
  const n = move(o, depthM, 0)
  const poly = turf.polygon([[o, e, ne, n, o]])
  return { id, geom: poly.geometry, roadIds: [], areaSqm: Math.round(turf.area(poly)) }
}
/** Triangle block — has no opposite (anti-parallel) edge. */
function triBlock(baseM: number, heightM: number, id = 'tri'): Block {
  const o = O
  const e = move(o, baseM, 90)
  const apex = move(move(o, baseM / 2, 90), heightM, 0)
  const poly = turf.polygon([[o, e, apex, o]])
  return { id, geom: poly.geometry, roadIds: [], areaSqm: Math.round(turf.area(poly)) }
}
const rules = (over: Record<string, unknown> = {}) => ({ ...DEFAULT_RULES, ...over })

describe('measureBlockDepth', () => {
  it('returns the perpendicular depth from the longest edge', () => {
    const b = rectBlock(120, 60)
    const poly = turf.polygon((b.geom as any).coordinates)
    const ring = poly.geometry.coordinates[0]
    const primary = { a: ring[0], b: ring[1], len: 120, bearing: turf.bearing(ring[0], ring[1]), mid: ring[0] } as any
    expect(measureBlockDepth(poly as any, primary)).toBeGreaterThan(55)
    expect(measureBlockDepth(poly as any, primary)).toBeLessThan(65)
  })
})

describe('autoFrontageModeForBlock (pure)', () => {
  it('shallow block → longest (single row)', () => {
    expect(autoFrontageModeForBlock(rectBlock(120, 30), rules())).toBe('longest') // 30 ≤ 1.3·35
  })
  it('interior block with opposite street, mid depth → both', () => {
    expect(autoFrontageModeForBlock(rectBlock(120, 60), rules())).toBe('both')    // 45.5 < 60 ≤ 70
  })
  it('deep block → longest (more rows, no dual frontage)', () => {
    expect(autoFrontageModeForBlock(rectBlock(120, 130), rules())).toBe('longest') // 130 > 70
  })
  it('block with no opposite edge (steep triangle) → longest', () => {
    // A tall triangle has no edge anti-parallel to its base, so no dual frontage.
    expect(autoFrontageModeForBlock(triBlock(120, 300), rules())).toBe('longest')
  })
})

describe('resolveEngineVersion (precedence: env flag > project > default)', () => {
  it('env flag forces v1 even if project asks v2', () => expect(resolveEngineVersion(true, 2)).toBe(1))
  it('project v1 honoured when no env flag', () => expect(resolveEngineVersion(false, 1)).toBe(1))
  it('defaults to current engine when unset', () => expect(resolveEngineVersion(false, undefined)).toBe(SUBDIVISION_ENGINE_DEFAULT))
  it('default constant is v2', () => expect(SUBDIVISION_ENGINE_DEFAULT).toBe(2))
})

describe('engine dispatch fills better than legacy on deep blocks', () => {
  const deep = rectBlock(220, 130, 'deep')
  it('v2 (default) tiles many rows; v1 leaves a shallow band', () => {
    const v2 = subdivideBlock(deep, rules({ seed: 'unit-v2' }), { engineV1Flag: false })
    const v1 = subdivideBlock(deep, rules({ seed: 'unit-v1' }), { engineV1Flag: true })
    expect(v2.lots.length).toBeGreaterThan(v1.lots.length)
  })
  it('rules.engineVersion=1 pins the legacy path', () => {
    const pinned = subdivideBlock(deep, rules({ seed: 'unit-pin', engineVersion: 1 }), {})
    const auto = subdivideBlock(deep, rules({ seed: 'unit-pin' }), {})
    expect(auto.lots.length).toBeGreaterThan(pinned.lots.length)
  })
})

describe('row tiling + deep-block safety', () => {
  it('deep no-opposite block caps rows and emits a tagged interior reserve', () => {
    const b = triBlock(260, 220, 'deep-tri')
    const r = subdivideBlock(b, rules({ seed: 'unit-deep' }), { strictRules: false })
    expect(r.lots.length).toBeGreaterThan(0)
    // Rows respect min depth: most lots clear it (triangle-clipped edge lots may be
    // shallower, which is fine — the guardrail governs row depth, not every lot).
    const okDepth = r.lots.filter(l => l.depthM >= DEFAULT_RULES.minDepthM - 1).length
    expect(okDepth / r.lots.length).toBeGreaterThan(0.7)
    // A deliberate interior reserve is tagged when rows were capped.
    expect(r.openSpace.some(o => o.interiorReserve)).toBe(true)
  })
})

describe('misconfig handling (strict throws / non-strict clamps)', () => {
  const bad = rules({ minDepthM: 80, maxDepthM: 20, seed: 'unit-bad' }) // minDepth > maxDepth
  const block = rectBlock(120, 60)
  it('strictRules:true throws a clear error', () => {
    expect(() => subdivideBlock(block, bad, { strictRules: true })).toThrow(/Invalid subdivision rules/)
  })
  it('strictRules:false clamps and returns without throwing', () => {
    expect(() => subdivideBlock(block, bad, { strictRules: false })).not.toThrow()
    const r = subdivideBlock(block, bad, { strictRules: false })
    expect(Array.isArray(r.lots)).toBe(true)
  })
})

describe('edge-case geometry does not crash', () => {
  it('donut (polygon with a hole)', () => {
    const o = O
    const outer = [o, move(o, 200, 90), move(move(o, 200, 90), 200, 0), move(o, 200, 0), o]
    const hc = move(move(o, 80, 90), 80, 0)
    const hole = [hc, move(hc, 40, 90), move(move(hc, 40, 90), 40, 0), move(hc, 40, 0), hc]
    const poly = turf.polygon([outer, hole])
    const b: Block = { id: 'donut', geom: poly.geometry, roadIds: [], areaSqm: Math.round(turf.area(poly)) }
    const r = subdivideBlock(b, rules({ seed: 'unit-donut' }), { strictRules: false })
    expect(Array.isArray(r.lots)).toBe(true)
  })
  it('highly concave (L-shaped) block', () => {
    const o = O
    const ring = [
      o, move(o, 200, 90), move(move(o, 200, 90), 80, 0),
      move(move(o, 90, 90), 80, 0), move(move(o, 90, 90), 200, 0),
      move(o, 200, 0), o,
    ]
    const poly = turf.polygon([ring])
    const b: Block = { id: 'L', geom: poly.geometry, roadIds: [], areaSqm: Math.round(turf.area(poly)) }
    const r = subdivideBlock(b, rules({ seed: 'unit-L' }), { strictRules: false })
    expect(Array.isArray(r.lots)).toBe(true)
  })
})

describe('determinism', () => {
  it('same seed ⇒ identical lot count', () => {
    const b = rectBlock(160, 60)
    const a = subdivideBlock(b, rules({ seed: 'fixed' }), {})
    const c = subdivideBlock(b, rules({ seed: 'fixed' }), {})
    expect(a.lots.length).toBe(c.lots.length)
  })
})
