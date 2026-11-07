/**
 * Road routing for the Building Inspector — the engine behind in-app directions.
 *
 * Pure: no Vue, no network, no map. It takes road segments (as GeoJSON
 * LineStrings from the council's own OSM roads layer), builds a routable graph,
 * and answers "how do I drive from here to that stand".
 *
 * WHY THIS EXISTS IN THE BROWSER
 * The obvious alternative is pgRouting on the server, but pgr_dijkstra needs
 * source/target columns, which means altering a 210k-row table on a cluster with
 * known catalog corruption. It also puts a network round-trip between the
 * inspector and every re-route — on a road where the signal just dropped. The
 * corridor between two points is a few thousand segments: small enough to route
 * in milliseconds on a phone, and small enough to cache for the drive.
 *
 * WHAT IT DELIBERATELY DOES NOT DO
 * No live traffic, no turn restrictions beyond one-way, no lane guidance. Travel
 * time is distance over a per-class speed, so it is an estimate from road class,
 * not a prediction. Callers must present it as such.
 */

export interface RoadFeature {
  /** LineString or MultiLineString coordinates in [lng, lat]. */
  geometry: { type: string; coordinates: number[][] | number[][][] }
  properties?: {
    fclass?: string | null
    name?: string | null
    /** OSM: 'B' both, 'F' forward only, 'T' backward only. */
    oneway?: string | null
    maxspeed?: number | null
  }
}

export interface LngLat { lng: number; lat: number }

export interface RouteStep {
  /** 'depart' | 'left' | 'slight-left' | 'straight' | 'slight-right' | 'right' | 'sharp-left' | 'sharp-right' | 'u-turn' | 'arrive' */
  manoeuvre: Manoeuvre
  /** Road being joined, when the council's data names it. */
  road: string | null
  /** Metres travelled on this step. */
  distanceM: number
  /** Where the manoeuvre happens. */
  at: LngLat
  /** Index into the route's coordinate list. */
  coordinateIndex: number
  instruction: string
}

export type Manoeuvre =
  | 'depart' | 'arrive' | 'straight'
  | 'slight-left' | 'left' | 'sharp-left'
  | 'slight-right' | 'right' | 'sharp-right'
  | 'u-turn'

export interface Route {
  /** The drawn line, [lng, lat] pairs, origin first. */
  coordinates: [number, number][]
  distanceM: number
  durationS: number
  steps: RouteStep[]
  /**
   * True when no road network reached the start or the site, and the route is a
   * straight line. The UI must say so — an inspector following a straight line
   * across a river needs to know that is what they are looking at.
   */
  straightLine: boolean
}

const EARTH_R = 6_371_000

export function haversine(a: LngLat, b: LngLat): number {
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const dφ = φ2 - φ1
  const dλ = ((b.lng - a.lng) * Math.PI) / 180
  const s = Math.sin(dφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)))
}

/** Compass bearing a→b in degrees (0 = north). */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = (a.lat * Math.PI) / 180
  const φ2 = (b.lat * Math.PI) / 180
  const Δλ = ((b.lng - a.lng) * Math.PI) / 180
  const y = Math.sin(Δλ) * Math.cos(φ2)
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ)
  return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360
}

/**
 * Design speed by OSM road class, km/h. Deliberately conservative: these are
 * Zimbabwean rural district roads, and an inspector arriving late because the
 * estimate was optimistic is worse than one arriving early.
 */
const CLASS_SPEED_KMH: Record<string, number> = {
  motorway: 100, motorway_link: 60,
  trunk: 90, trunk_link: 50,
  primary: 80, primary_link: 45,
  secondary: 70, secondary_link: 40,
  tertiary: 60, tertiary_link: 35,
  unclassified: 45, residential: 35, living_street: 20,
  service: 25, track: 25, path: 12, footway: 5, pedestrian: 5, steps: 2,
}
const DEFAULT_SPEED_KMH = 35

/** Classes a council vehicle cannot use. Excluded from the drivable graph. */
const NOT_DRIVABLE = new Set(['footway', 'path', 'steps', 'pedestrian', 'cycleway', 'bridleway'])

export function speedKmh(fclass?: string | null, maxspeed?: number | null): number {
  if (typeof maxspeed === 'number' && maxspeed > 0 && maxspeed <= 140) return maxspeed
  return CLASS_SPEED_KMH[String(fclass ?? '')] ?? DEFAULT_SPEED_KMH
}

interface Edge {
  to: string
  distanceM: number
  seconds: number
  road: string | null
  /** Geometry from the edge's start node to its end node. */
  line: [number, number][]
}

export interface RouteGraph {
  nodes: Map<string, LngLat>
  edges: Map<string, Edge[]>
  size: number
}

/** Node identity: coordinates rounded to ~1 m, so shared endpoints actually join. */
function key(lng: number, lat: number): string {
  return `${lng.toFixed(5)},${lat.toFixed(5)}`
}

function lineStrings(f: RoadFeature): number[][][] {
  const t = f.geometry?.type
  const c = f.geometry?.coordinates as number[][] | number[][][]
  if (!Array.isArray(c) || c.length === 0) return []
  if (t === 'LineString') return [c as number[][]]
  if (t === 'MultiLineString') return c as number[][][]
  return []
}

/**
 * Build a routable graph.
 *
 * Every segment between consecutive vertices becomes an edge, so a route can
 * join a road part-way along rather than only at its ends. One-way is honoured:
 * 'F' forward only, 'T' backward only, anything else both ways.
 */
export function buildGraph(features: RoadFeature[], opts: { drivableOnly?: boolean } = {}): RouteGraph {
  const drivableOnly = opts.drivableOnly !== false
  const nodes = new Map<string, LngLat>()
  const edges = new Map<string, Edge[]>()

  const link = (from: string, edge: Edge) => {
    const list = edges.get(from)
    if (list) list.push(edge)
    else edges.set(from, [edge])
  }

  for (const f of features) {
    const fclass = f.properties?.fclass ?? null
    if (drivableOnly && NOT_DRIVABLE.has(String(fclass))) continue
    const road = f.properties?.name?.trim() || null
    const oneway = String(f.properties?.oneway ?? 'B').toUpperCase()
    const kmh = speedKmh(fclass, f.properties?.maxspeed ?? null)

    for (const line of lineStrings(f)) {
      for (let i = 0; i + 1 < line.length; i++) {
        const [aLng, aLat] = line[i]
        const [bLng, bLat] = line[i + 1]
        if (![aLng, aLat, bLng, bLat].every(Number.isFinite)) continue
        const ka = key(aLng, aLat)
        const kb = key(bLng, bLat)
        if (ka === kb) continue
        const a = { lng: aLng, lat: aLat }
        const b = { lng: bLng, lat: bLat }
        nodes.set(ka, a)
        nodes.set(kb, b)
        const distanceM = haversine(a, b)
        const seconds = distanceM / ((kmh * 1000) / 3600)
        if (oneway !== 'T') link(ka, { to: kb, distanceM, seconds, road, line: [[aLng, aLat], [bLng, bLat]] })
        if (oneway !== 'F') link(kb, { to: ka, distanceM, seconds, road, line: [[bLng, bLat], [aLng, aLat]] })
      }
    }
  }

  return { nodes, edges, size: nodes.size }
}

/** The graph node closest to a point, within `maxM`. Null when the roads are too far away. */
export function nearestNode(graph: RouteGraph, point: LngLat, maxM = 2_000): string | null {
  let best: string | null = null
  let bestD = Infinity
  for (const [k, n] of graph.nodes) {
    const d = haversine(point, n)
    if (d < bestD) { bestD = d; best = k }
  }
  return bestD <= maxM ? best : null
}

/**
 * A* over the graph, minimising travel time.
 *
 * The heuristic is straight-line distance at the fastest speed in the table, so
 * it never overestimates and the result is a genuine shortest-time path.
 */
export function findPath(graph: RouteGraph, startKey: string, goalKey: string): string[] | null {
  if (startKey === goalKey) return [startKey]
  const goal = graph.nodes.get(goalKey)
  if (!goal || !graph.nodes.has(startKey)) return null

  const FASTEST_MPS = 100 / 3.6
  const h = (k: string) => {
    const n = graph.nodes.get(k)!
    return haversine(n, goal) / FASTEST_MPS
  }

  const came = new Map<string, string>()
  const g = new Map<string, number>([[startKey, 0]])
  // ponytail: array-based priority queue. The corridor graphs this runs on are
  // thousands of nodes, where the scan costs less than a heap's bookkeeping.
  // Swap for a binary heap if whole-district routing is ever needed.
  const open: { k: string; f: number }[] = [{ k: startKey, f: h(startKey) }]
  const closed = new Set<string>()

  while (open.length) {
    let bi = 0
    for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i
    const { k } = open.splice(bi, 1)[0]
    if (k === goalKey) {
      const path = [k]
      let cur = k
      while (came.has(cur)) { cur = came.get(cur)!; path.push(cur) }
      return path.reverse()
    }
    if (closed.has(k)) continue
    closed.add(k)

    for (const e of graph.edges.get(k) ?? []) {
      if (closed.has(e.to)) continue
      const tentative = (g.get(k) ?? Infinity) + e.seconds
      if (tentative < (g.get(e.to) ?? Infinity)) {
        came.set(e.to, k)
        g.set(e.to, tentative)
        open.push({ k: e.to, f: tentative + h(e.to) })
      }
    }
  }
  return null
}

function edgeBetween(graph: RouteGraph, from: string, to: string): Edge | null {
  return (graph.edges.get(from) ?? []).find(e => e.to === to) ?? null
}

/** Turn description from the change in bearing between two segments. */
export function manoeuvreFor(deltaDeg: number): Manoeuvre {
  const d = ((deltaDeg + 540) % 360) - 180   // normalise to (-180, 180]
  const a = Math.abs(d)
  if (a < 20) return 'straight'
  if (a > 160) return 'u-turn'
  if (a < 45) return d > 0 ? 'slight-right' : 'slight-left'
  if (a < 120) return d > 0 ? 'right' : 'left'
  return d > 0 ? 'sharp-right' : 'sharp-left'
}

const MANOEUVRE_TEXT: Record<Manoeuvre, string> = {
  depart: 'Head', arrive: 'Arrive at the site',
  straight: 'Continue', 'slight-left': 'Bear left', left: 'Turn left', 'sharp-left': 'Sharp left',
  'slight-right': 'Bear right', right: 'Turn right', 'sharp-right': 'Sharp right',
  'u-turn': 'Make a U-turn',
}

const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
export function compassPoint(deg: number): string {
  return COMPASS[Math.round(((deg % 360) + 360) % 360 / 45) % 8]
}

/** Human distance: metres under a kilometre, one decimal above. */
export function formatDistanceM(m: number): string {
  if (!Number.isFinite(m)) return '—'
  if (m < 950) return `${Math.round(m / 10) * 10} m`
  return `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds)) return '—'
  const mins = Math.round(seconds / 60)
  if (mins < 1) return 'under a minute'
  if (mins < 60) return `${mins} min`
  const h = Math.floor(mins / 60)
  return `${h} h ${mins % 60} min`
}

/** Turn a node path into a drawable route with instructions. */
export function pathToRoute(graph: RouteGraph, path: string[]): Route {
  const coordinates: [number, number][] = []
  const steps: RouteStep[] = []
  let distanceM = 0
  let durationS = 0

  if (path.length === 1) {
    const n = graph.nodes.get(path[0])!
    return {
      coordinates: [[n.lng, n.lat]], distanceM: 0, durationS: 0, straightLine: false,
      steps: [{ manoeuvre: 'arrive', road: null, distanceM: 0, at: n, coordinateIndex: 0, instruction: MANOEUVRE_TEXT.arrive }],
    }
  }

  let currentRoad: string | null | undefined
  let stepDistance = 0
  let stepStartIndex = 0
  let previousBearing: number | null = null

  const firstNode = graph.nodes.get(path[0])!
  coordinates.push([firstNode.lng, firstNode.lat])

  for (let i = 0; i + 1 < path.length; i++) {
    const edge = edgeBetween(graph, path[i], path[i + 1])
    if (!edge) continue
    const a = graph.nodes.get(path[i])!
    const b = graph.nodes.get(path[i + 1])!
    const segBearing = bearing(a, b)

    if (previousBearing === null) {
      steps.push({
        manoeuvre: 'depart', road: edge.road, distanceM: 0, at: a, coordinateIndex: 0,
        instruction: `${MANOEUVRE_TEXT.depart} ${compassPoint(segBearing)}${edge.road ? ` on ${edge.road}` : ''}`,
      })
      currentRoad = edge.road
    } else {
      const turn = manoeuvreFor(segBearing - previousBearing)
      const roadChanged = edge.road !== currentRoad && !!edge.road
      // A step is worth showing when the driver must do something: turn, or
      // join a differently named road. Every vertex would otherwise be a step.
      if (turn !== 'straight' || roadChanged) {
        const last = steps[steps.length - 1]
        if (last) last.distanceM = stepDistance
        steps.push({
          manoeuvre: turn, road: edge.road, distanceM: 0, at: a,
          coordinateIndex: coordinates.length - 1,
          instruction: `${MANOEUVRE_TEXT[turn]}${edge.road ? ` onto ${edge.road}` : ''}`,
        })
        stepDistance = 0
        stepStartIndex = coordinates.length - 1
        currentRoad = edge.road
      }
    }

    coordinates.push([b.lng, b.lat])
    distanceM += edge.distanceM
    durationS += edge.seconds
    stepDistance += edge.distanceM
    previousBearing = segBearing
  }

  const last = steps[steps.length - 1]
  if (last) last.distanceM = stepDistance
  const end = graph.nodes.get(path[path.length - 1])!
  steps.push({
    manoeuvre: 'arrive', road: null, distanceM: 0, at: end,
    coordinateIndex: Math.max(0, coordinates.length - 1),
    instruction: MANOEUVRE_TEXT.arrive,
  })
  void stepStartIndex

  return { coordinates, distanceM, durationS, steps, straightLine: false }
}

/** The straight line used when no road network connects the two points. */
export function straightLineRoute(from: LngLat, to: LngLat): Route {
  const distanceM = haversine(from, to)
  return {
    coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
    distanceM,
    durationS: distanceM / ((DEFAULT_SPEED_KMH * 1000) / 3600),
    straightLine: true,
    steps: [
      {
        manoeuvre: 'depart', road: null, distanceM, at: from, coordinateIndex: 0,
        instruction: `Head ${compassPoint(bearing(from, to))} towards the site — no mapped road route was found`,
      },
      { manoeuvre: 'arrive', road: null, distanceM: 0, at: to, coordinateIndex: 1, instruction: MANOEUVRE_TEXT.arrive },
    ],
  }
}

/**
 * Route from `from` to `to` over these roads.
 *
 * Falls back to a straight line — flagged as such — when either end is off the
 * mapped network or no path connects them, because an inspector on a farm track
 * still needs a heading and a distance.
 */
export function route(features: RoadFeature[], from: LngLat, to: LngLat, opts: { snapM?: number } = {}): Route {
  const graph = buildGraph(features)
  const snapM = opts.snapM ?? 2_000
  const start = nearestNode(graph, from, snapM)
  const goal = nearestNode(graph, to, snapM)
  if (!start || !goal) return straightLineRoute(from, to)

  const path = findPath(graph, start, goal)
  if (!path) return straightLineRoute(from, to)

  const r = pathToRoute(graph, path)
  // Stitch the walk from the real position onto the network, and from the
  // network to the stand, so the drawn line starts and ends where the inspector
  // actually is rather than at a road vertex.
  const startNode = graph.nodes.get(start)!
  const goalNode = graph.nodes.get(goal)!
  const head = haversine(from, startNode)
  const tail = haversine(goalNode, to)
  return {
    ...r,
    coordinates: [[from.lng, from.lat], ...r.coordinates, [to.lng, to.lat]],
    distanceM: r.distanceM + head + tail,
    durationS: r.durationS + (head + tail) / ((DEFAULT_SPEED_KMH * 1000) / 3600),
  }
}

/** Metres from a point to the nearest vertex of the route line. */
export function distanceToRoute(position: LngLat, r: Route): number {
  let best = Infinity
  for (const [lng, lat] of r.coordinates) {
    const d = haversine(position, { lng, lat })
    if (d < best) best = d
  }
  return best
}

/**
 * How far is left, and which instruction is next.
 *
 * Progress is measured from the nearest point on the line, so a GPS fix that
 * jumps sideways does not rewind the journey.
 */
export function progressAlong(position: LngLat, r: Route): {
  nearestIndex: number
  remainingM: number
  remainingS: number
  nextStep: RouteStep | null
  distanceToNextM: number
  offRouteM: number
} {
  let nearestIndex = 0
  let best = Infinity
  for (let i = 0; i < r.coordinates.length; i++) {
    const [lng, lat] = r.coordinates[i]
    const d = haversine(position, { lng, lat })
    if (d < best) { best = d; nearestIndex = i }
  }

  let remainingM = 0
  for (let i = nearestIndex; i + 1 < r.coordinates.length; i++) {
    const [aLng, aLat] = r.coordinates[i]
    const [bLng, bLat] = r.coordinates[i + 1]
    remainingM += haversine({ lng: aLng, lat: aLat }, { lng: bLng, lat: bLat })
  }

  const nextStep = r.steps.find(s => s.coordinateIndex >= nearestIndex && s.manoeuvre !== 'depart') ?? null
  let distanceToNextM = 0
  if (nextStep) {
    for (let i = nearestIndex; i < nextStep.coordinateIndex && i + 1 < r.coordinates.length; i++) {
      const [aLng, aLat] = r.coordinates[i]
      const [bLng, bLat] = r.coordinates[i + 1]
      distanceToNextM += haversine({ lng: aLng, lat: aLat }, { lng: bLng, lat: bLat })
    }
  }

  const speed = r.distanceM > 0 ? r.distanceM / Math.max(r.durationS, 1) : DEFAULT_SPEED_KMH / 3.6
  return {
    nearestIndex,
    remainingM,
    remainingS: remainingM / speed,
    nextStep,
    distanceToNextM,
    offRouteM: best,
  }
}

/** Bounding box covering both points plus a margin, for fetching the corridor. */
export function corridorBounds(a: LngLat, b: LngLat, padM = 1_500): {
  minLng: number; minLat: number; maxLng: number; maxLat: number
} {
  const latPad = padM / 111_320
  const midLat = (a.lat + b.lat) / 2
  const lngPad = padM / (111_320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)))
  return {
    minLng: Math.min(a.lng, b.lng) - lngPad,
    minLat: Math.min(a.lat, b.lat) - latPad,
    maxLng: Math.max(a.lng, b.lng) + lngPad,
    maxLat: Math.max(a.lat, b.lat) + latPad,
  }
}
