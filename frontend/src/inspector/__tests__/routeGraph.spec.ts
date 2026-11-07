/**
 * The routing engine behind in-app directions.
 *
 * Every road here is invented, laid out on a small synthetic grid near Gweru so
 * the distances are realistic without using production data. The tests are about
 * the guarantees an inspector relies on: the route follows real roads, obeys
 * one-way, prefers the faster road rather than the shorter line, tells them when
 * it could NOT find a road route, and never silently turns a failure into a
 * confident-looking line.
 */
import { describe, it, expect } from 'vitest'
import {
  buildGraph, nearestNode, findPath, pathToRoute, route, straightLineRoute,
  progressAlong, manoeuvreFor, speedKmh, corridorBounds, haversine, bearing,
  formatDistanceM, formatDuration, compassPoint,
  type RoadFeature, type LngLat,
} from '../routeGraph'

/** ~0.001° of latitude is ~111 m; the grid below is a few hundred metres across. */
const O = { lng: 29.8000, lat: -19.4500 }

function road(
  coords: [number, number][],
  properties: RoadFeature['properties'] = {},
): RoadFeature {
  return { geometry: { type: 'LineString', coordinates: coords }, properties }
}

const at = (dLng: number, dLat: number): [number, number] =>
  [Number((O.lng + dLng).toFixed(5)), Number((O.lat + dLat).toFixed(5))]

describe('graph construction', () => {
  it('joins roads that share an endpoint, so a junction is actually routable', () => {
    const g = buildGraph([
      road([at(0, 0), at(0.002, 0)], { name: 'First Street' }),
      road([at(0.002, 0), at(0.002, 0.002)], { name: 'Second Avenue' }),
    ])
    expect(g.size).toBe(3)
    const start = nearestNode(g, { lng: at(0, 0)[0], lat: at(0, 0)[1] })!
    const goal = nearestNode(g, { lng: at(0.002, 0.002)[0], lat: at(0.002, 0.002)[1] })!
    expect(findPath(g, start, goal)).toHaveLength(3)
  })

  it('honours one-way roads in both directions', () => {
    const forward = buildGraph([road([at(0, 0), at(0.002, 0)], { oneway: 'F' })])
    const a = nearestNode(forward, { lng: at(0, 0)[0], lat: at(0, 0)[1] })!
    const b = nearestNode(forward, { lng: at(0.002, 0)[0], lat: at(0.002, 0)[1] })!
    expect(findPath(forward, a, b)).not.toBeNull()
    expect(findPath(forward, b, a)).toBeNull()

    const backward = buildGraph([road([at(0, 0), at(0.002, 0)], { oneway: 'T' })])
    expect(findPath(backward, a, b)).toBeNull()
    expect(findPath(backward, b, a)).not.toBeNull()
  })

  it('keeps a council vehicle off footpaths and steps', () => {
    const features = [road([at(0, 0), at(0.002, 0)], { fclass: 'footway' })]
    expect(buildGraph(features).size).toBe(0)
    expect(buildGraph(features, { drivableOnly: false }).size).toBe(2)
  })

  it('reads speed from maxspeed when present, else the road class', () => {
    expect(speedKmh('residential', 60)).toBe(60)
    expect(speedKmh('residential', null)).toBe(35)
    expect(speedKmh('trunk', null)).toBe(90)
    expect(speedKmh('something-new', null)).toBe(35)
    expect(speedKmh('residential', 999)).toBe(35)   // implausible tag ignored
  })
})

describe('choosing a route', () => {
  /**
   * Two ways from A to B: a direct residential street, and a longer dog-leg on a
   * trunk road. The trunk is longer in metres but faster in minutes, which is
   * what a driver actually wants.
   */
  const network: RoadFeature[] = [
    road([at(0, 0), at(0.010, 0)], { name: 'Slow Street', fclass: 'residential' }),
    road([at(0, 0), at(0, 0.004)], { name: 'Trunk Road', fclass: 'trunk' }),
    road([at(0, 0.004), at(0.010, 0.004)], { name: 'Trunk Road', fclass: 'trunk' }),
    road([at(0.010, 0.004), at(0.010, 0)], { name: 'Trunk Road', fclass: 'trunk' }),
  ]
  const from: LngLat = { lng: at(0, 0)[0], lat: at(0, 0)[1] }
  const to: LngLat = { lng: at(0.010, 0)[0], lat: at(0.010, 0)[1] }

  it('takes the faster road even though it is the longer one', () => {
    const r = route(network, from, to)
    expect(r.straightLine).toBe(false)
    const straight = haversine(from, to)
    expect(r.distanceM).toBeGreaterThan(straight)          // it went round
    expect(r.steps.some(s => s.road === 'Trunk Road')).toBe(true)
  })

  it('reports a distance and a travel time that are consistent with each other', () => {
    const r = route(network, from, to)
    const impliedKmh = (r.distanceM / 1000) / (r.durationS / 3600)
    expect(impliedKmh).toBeGreaterThan(20)
    expect(impliedKmh).toBeLessThan(100)
  })

  it('starts at the inspector and ends at the stand, not at the nearest road vertex', () => {
    const offRoad = { lng: from.lng - 0.0004, lat: from.lat - 0.0004 }
    const r = route(network, offRoad, to)
    expect(r.coordinates[0]).toEqual([offRoad.lng, offRoad.lat])
    expect(r.coordinates[r.coordinates.length - 1]).toEqual([to.lng, to.lat])
  })
})

describe('when there is no road route — the honest fallback', () => {
  const from: LngLat = { lng: at(0, 0)[0], lat: at(0, 0)[1] }

  it('says so rather than drawing a confident line, when the stand is off the network', () => {
    const far = { lng: 30.9, lat: -18.9 }
    const r = route([road([at(0, 0), at(0.002, 0)])], from, far)
    expect(r.straightLine).toBe(true)
    expect(r.steps[0].instruction).toMatch(/no mapped road route/i)
  })

  it('falls back when the two ends are on disconnected roads', () => {
    const island = road([at(0.05, 0.05), at(0.052, 0.05)])
    const r = route([road([at(0, 0), at(0.002, 0)]), island],
      from, { lng: at(0.052, 0.05)[0], lat: at(0.052, 0.05)[1] })
    expect(r.straightLine).toBe(true)
  })

  it('still gives a heading and a real distance in the fallback', () => {
    const to = { lng: O.lng, lat: O.lat + 0.02 }
    const r = straightLineRoute(from, to)
    expect(r.distanceM).toBeGreaterThan(2_000)
    expect(r.steps[0].instruction).toMatch(/north/)
    expect(r.steps[r.steps.length - 1].manoeuvre).toBe('arrive')
  })
})

describe('turn instructions', () => {
  it('names the manoeuvre from the change in bearing', () => {
    expect(manoeuvreFor(0)).toBe('straight')
    expect(manoeuvreFor(10)).toBe('straight')
    expect(manoeuvreFor(30)).toBe('slight-right')
    expect(manoeuvreFor(-30)).toBe('slight-left')
    expect(manoeuvreFor(90)).toBe('right')
    expect(manoeuvreFor(-90)).toBe('left')
    expect(manoeuvreFor(140)).toBe('sharp-right')
    expect(manoeuvreFor(180)).toBe('u-turn')
    expect(manoeuvreFor(370)).toBe('straight')      // wraps
  })

  it('gives a step for each turn, and does not invent one for every vertex', () => {
    // A straight road drawn with five vertices is still one instruction.
    const straight = buildGraph([road([at(0, 0), at(0.002, 0), at(0.004, 0), at(0.006, 0)], { name: 'Long Road' })])
    const a = nearestNode(straight, { lng: at(0, 0)[0], lat: at(0, 0)[1] })!
    const b = nearestNode(straight, { lng: at(0.006, 0)[0], lat: at(0.006, 0)[1] })!
    const r = pathToRoute(straight, findPath(straight, a, b)!)
    expect(r.steps.map(s => s.manoeuvre)).toEqual(['depart', 'arrive'])
  })

  it('describes a real turn onto a named road', () => {
    const g = buildGraph([
      road([at(0, 0), at(0.004, 0)], { name: 'Main Street' }),
      road([at(0.004, 0), at(0.004, 0.004)], { name: 'Church Road' }),
    ])
    const a = nearestNode(g, { lng: at(0, 0)[0], lat: at(0, 0)[1] })!
    const b = nearestNode(g, { lng: at(0.004, 0.004)[0], lat: at(0.004, 0.004)[1] })!
    const r = pathToRoute(g, findPath(g, a, b)!)
    const turn = r.steps.find(s => s.manoeuvre === 'left' || s.manoeuvre === 'right')!
    expect(turn).toBeTruthy()
    expect(turn.instruction).toContain('Church Road')
    expect(r.steps[0].instruction).toContain('Main Street')
    expect(r.steps[r.steps.length - 1].manoeuvre).toBe('arrive')
  })

  it('measures how far to drive before each instruction', () => {
    const g = buildGraph([
      road([at(0, 0), at(0.004, 0)], { name: 'Main Street' }),
      road([at(0.004, 0), at(0.004, 0.004)], { name: 'Church Road' }),
    ])
    const a = nearestNode(g, { lng: at(0, 0)[0], lat: at(0, 0)[1] })!
    const b = nearestNode(g, { lng: at(0.004, 0.004)[0], lat: at(0.004, 0.004)[1] })!
    const r = pathToRoute(g, findPath(g, a, b)!)
    expect(r.steps[0].distanceM).toBeGreaterThan(300)   // ~420 m of Main Street
  })
})

describe('following the route on the ground', () => {
  const g = buildGraph([road([at(0, 0), at(0.004, 0), at(0.008, 0)], { name: 'Main Street' })])
  const a = nearestNode(g, { lng: at(0, 0)[0], lat: at(0, 0)[1] })!
  const b = nearestNode(g, { lng: at(0.008, 0)[0], lat: at(0.008, 0)[1] })!
  const r = pathToRoute(g, findPath(g, a, b)!)

  it('counts down the distance as the inspector drives', () => {
    const atStart = progressAlong({ lng: at(0, 0)[0], lat: at(0, 0)[1] }, r)
    const halfway = progressAlong({ lng: at(0.004, 0)[0], lat: at(0.004, 0)[1] }, r)
    expect(halfway.remainingM).toBeLessThan(atStart.remainingM)
    expect(halfway.remainingS).toBeLessThan(atStart.remainingS)
  })

  it('reports how far off the line the vehicle is, so a wrong turn can be detected', () => {
    const onRoute = progressAlong({ lng: at(0.004, 0)[0], lat: at(0.004, 0)[1] }, r)
    expect(onRoute.offRouteM).toBeLessThan(20)
    const strayed = progressAlong({ lng: at(0.004, 0.003)[0], lat: at(0.004, 0.003)[1] }, r)
    expect(strayed.offRouteM).toBeGreaterThan(200)
  })

  it('does not rewind the journey when a GPS fix jumps sideways', () => {
    const clean = progressAlong({ lng: at(0.006, 0)[0], lat: at(0.006, 0)[1] }, r)
    const jumped = progressAlong({ lng: at(0.006, 0.0002)[0], lat: at(0.006, 0.0002)[1] }, r)
    expect(Math.abs(jumped.remainingM - clean.remainingM)).toBeLessThan(60)
  })
})

describe('fetching the corridor', () => {
  it('covers both points with a margin, and stays the right way round', () => {
    const b = corridorBounds({ lng: 29.8, lat: -19.45 }, { lng: 29.9, lat: -19.40 }, 1_000)
    expect(b.minLng).toBeLessThan(29.8)
    expect(b.maxLng).toBeGreaterThan(29.9)
    expect(b.minLat).toBeLessThan(-19.45)
    expect(b.maxLat).toBeGreaterThan(-19.40)
  })
})

describe('presentation helpers', () => {
  it('rounds distance the way a driver reads it', () => {
    expect(formatDistanceM(84)).toBe('80 m')
    expect(formatDistanceM(940)).toBe('940 m')
    expect(formatDistanceM(1_250)).toBe('1.3 km')
    expect(formatDistanceM(24_000)).toBe('24 km')
  })

  it('rounds duration without pretending to a precision it does not have', () => {
    expect(formatDuration(20)).toBe('under a minute')
    expect(formatDuration(600)).toBe('10 min')
    expect(formatDuration(4_500)).toBe('1 h 15 min')
  })

  it('names the compass point a heading falls in', () => {
    expect(compassPoint(0)).toBe('north')
    expect(compassPoint(91)).toBe('east')
    expect(compassPoint(225)).toBe('south-west')
    expect(bearing({ lng: 29.8, lat: -19.45 }, { lng: 29.8, lat: -19.44 })).toBeCloseTo(0, 0)
  })
})
