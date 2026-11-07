// @vitest-environment happy-dom
// Join + Explode (cadJoin.joinLineStrings / explodeToSegments + useCadDocument).
import { describe, it, expect } from 'vitest'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import type { LineString } from 'geojson'
import { joinLineStrings, explodeToSegments } from '../cadJoin'
import { useCadDocument } from '../useCadDocument'

const O: [number, number] = [29.8, -19.4]
const move = (p: number[], m: number, b: number) =>
  turf.destination(p, m, b, { units: 'meters' }).geometry.coordinates as [number, number]
const ls = (...pts: [number, number][]): LineString => ({ type: 'LineString', coordinates: pts })

describe('joinLineStrings', () => {
  it('chains three contiguous segments into one polyline', () => {
    const a = O, b = move(O, 50, 90), c = move(b, 50, 90), d = move(c, 50, 90)
    // deliberately out of order + one reversed
    const merged = joinLineStrings([ls(b, c), ls(d, c), ls(a, b)], 0.5)
    expect(merged).toHaveLength(1)
    expect(merged[0].coordinates.length).toBe(4)
    // endpoints span a → d (~150 m)
    const span = turf.distance(merged[0].coordinates[0], merged[0].coordinates[3], { units: 'meters' })
    expect(span).toBeGreaterThan(140)
  })

  it('leaves disconnected lines separate', () => {
    const far = move(O, 500, 90)
    const merged = joinLineStrings([ls(O, move(O, 20, 90)), ls(far, move(far, 20, 90))], 0.5)
    expect(merged).toHaveLength(2)
  })

  it('respects the tolerance (a 5 m gap does not join at tol 0.5)', () => {
    const b = move(O, 50, 90), c = move(b, 5, 90)   // 5 m gap
    const merged = joinLineStrings([ls(O, b), ls(c, move(c, 50, 90))], 0.5)
    expect(merged).toHaveLength(2)
  })
})

describe('explodeToSegments', () => {
  it('breaks a polyline into individual 2-point segments', () => {
    const segs = explodeToSegments(ls(O, move(O, 10, 90), move(O, 20, 90)))
    expect(segs).toHaveLength(2)
    expect(segs[0].coordinates).toHaveLength(2)
  })

  it('breaks a polygon ring into its edges', () => {
    const o = O, e = move(o, 10, 90), n = move(o, 10, 0)
    const poly: any = { type: 'Polygon', coordinates: [[o, e, n, o]] }
    expect(explodeToSegments(poly)).toHaveLength(3)
  })
})

describe('useCadDocument join/explode', () => {
  it('joinSelected merges connected line entities into one polyline (one undo step)', () => {
    const d = useCadDocument()
    const a = O, b = move(O, 40, 90), c = move(b, 40, 90)
    const e1 = d.addEntity('line', ls(a, b))
    const e2 = d.addEntity('line', ls(b, c))
    d.select([e1.id, e2.id])
    const before = d.entities.value.length
    const n = d.joinSelected(0.5)
    expect(n).toBe(1)
    expect(d.entities.value.length).toBe(before - 1)   // 2 lines → 1 polyline
    d.undo()
    expect(d.entities.value.length).toBe(before)
  })

  it('explodeSelected breaks a rectangle into 4 segments', () => {
    const d = useCadDocument()
    const o = O, e = move(o, 20, 90), ne = move(e, 20, 0), n = move(o, 20, 0)
    const rect = d.addEntity('rectangle', { type: 'Polygon', coordinates: [[o, e, ne, n, o]] } as any)
    d.select([rect.id])
    const n2 = d.explodeSelected()
    expect(n2).toBe(4)
    expect(d.entities.value.every(x => x.type === 'line')).toBe(true)
  })

  it('explodeSelected turns a symbol into its primitive parts', () => {
    const d = useCadDocument()
    const sym = d.addSymbol('north_arrow', O)!
    d.select([sym.id])
    const n = d.explodeSelected()
    expect(n).toBeGreaterThan(1)
    expect(d.entities.value.some(x => x.type === 'symbol')).toBe(false)   // original gone
    expect(d.entities.value.some(x => x.type === 'text' && x.text === 'N')).toBe(true)
  })
})
