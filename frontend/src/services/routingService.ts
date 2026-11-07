/**
 * Directions to a site, using the council's own road network.
 *
 * The corridor between the inspector and the stand is fetched once from
 * GET /api/inspector/route-corridor, then kept — in memory for the session and
 * in IndexedDB for the drive — so that re-routing after a wrong turn does not
 * need the network. That is the whole reason routing runs on the device: an
 * inspector who has lost signal on a district road is exactly the person who
 * needs a new route.
 */
import api from './api'
import {
  route as computeRoute, corridorBounds, haversine,
  type LngLat, type RoadFeature, type Route,
} from '@/inspector/routeGraph'

export interface CorridorBounds {
  minLng: number; minLat: number; maxLng: number; maxLat: number
}

export interface Corridor {
  features: RoadFeature[]
  bounds: CorridorBounds
  /** The server hit its segment limit: the graph is incomplete. */
  truncated: boolean
  segmentCount: number
  fetchedAt: string
}

export interface SiteRoute extends Route {
  /** The road network used was clipped by the server's limit. */
  partialNetwork: boolean
  /** The corridor came from the device, not the network. */
  fromCache: boolean
  corridorFetchedAt: string | null
}

const DB_NAME = 'vungu-routing'
const STORE = 'corridors'
const MAX_AGE_MS = 14 * 24 * 60 * 60 * 1000   // roads change slowly; a fortnight is generous

/** bbox rounded to ~100 m, so small GPS drift reuses the same cached corridor. */
export function corridorKey(b: CorridorBounds): string {
  const r = (n: number) => n.toFixed(3)
  return `${r(b.minLng)},${r(b.minLat)},${r(b.maxLng)},${r(b.maxLat)}`
}

const memory = new Map<string, Corridor>()

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') { resolve(null); return }
    try {
      const req = indexedDB.open(DB_NAME, 1)
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE)
      }
      req.onsuccess = () => resolve(req.result)
      req.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

async function readCached(key: string): Promise<Corridor | null> {
  const hit = memory.get(key)
  if (hit) return hit
  const db = await openDb()
  if (!db) return null
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly').objectStore(STORE).get(key)
      tx.onsuccess = () => {
        const value = tx.result as Corridor | undefined
        if (!value) { resolve(null); return }
        if (Date.now() - new Date(value.fetchedAt).getTime() > MAX_AGE_MS) { resolve(null); return }
        memory.set(key, value)
        resolve(value)
      }
      tx.onerror = () => resolve(null)
    } catch { resolve(null) }
  })
}

async function writeCached(key: string, corridor: Corridor): Promise<void> {
  memory.set(key, corridor)
  const db = await openDb()
  if (!db) return
  try {
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(corridor, key)
  } catch {
    // A full or blocked store costs us offline re-routing, not the route in hand.
  }
}

/** Roads in a bounding box, from the cache when it holds them. */
export async function fetchCorridor(
  bounds: CorridorBounds,
  opts: { force?: boolean; classes?: 'drivable' | 'all' } = {},
): Promise<{ corridor: Corridor; fromCache: boolean }> {
  const key = corridorKey(bounds)
  if (!opts.force) {
    const cached = await readCached(key)
    if (cached) return { corridor: cached, fromCache: true }
  }

  const r = await api.get('/inspector/route-corridor', {
    params: {
      minLng: bounds.minLng, minLat: bounds.minLat,
      maxLng: bounds.maxLng, maxLat: bounds.maxLat,
      classes: opts.classes ?? 'drivable',
    },
  })
  const data = r.data?.data ?? r.data
  const corridor: Corridor = {
    features: Array.isArray(data?.features) ? data.features : [],
    bounds,
    truncated: data?.truncated === true,
    segmentCount: Number(data?.segmentCount ?? data?.features?.length ?? 0),
    fetchedAt: new Date().toISOString(),
  }
  await writeCached(key, corridor)
  return { corridor, fromCache: false }
}

/**
 * Directions from `from` to `to`.
 *
 * Falls back to the cached corridor when the request fails, so losing signal
 * degrades to "route from what we already have" rather than to nothing. A
 * straight-line answer is still returned when no road route exists, flagged so
 * the UI can say so.
 */
export async function routeToSite(
  from: LngLat,
  to: LngLat,
  opts: { padM?: number; force?: boolean } = {},
): Promise<SiteRoute> {
  // Pad the corridor by a fifth of the journey (min 1.5 km) so the route can
  // leave the straight line between the two points, which any real road does.
  const padM = opts.padM ?? Math.max(1_500, haversine(from, to) * 0.2)
  const bounds = corridorBounds(from, to, padM)

  let corridor: Corridor | null = null
  let fromCache = false
  try {
    const got = await fetchCorridor(bounds, { force: opts.force })
    corridor = got.corridor
    fromCache = got.fromCache
  } catch {
    const cached = await readCached(corridorKey(bounds))
    if (cached) { corridor = cached; fromCache = true }
  }

  if (!corridor) {
    const { straightLineRoute } = await import('@/inspector/routeGraph')
    return { ...straightLineRoute(from, to), partialNetwork: false, fromCache: false, corridorFetchedAt: null }
  }

  const r = computeRoute(corridor.features, from, to)
  return {
    ...r,
    partialNetwork: corridor.truncated,
    fromCache,
    corridorFetchedAt: corridor.fetchedAt,
  }
}

/** Drop every cached corridor. Exposed for the outbox/settings surfaces. */
export async function clearRoutingCache(): Promise<void> {
  memory.clear()
  const db = await openDb()
  if (!db) return
  try { db.transaction(STORE, 'readwrite').objectStore(STORE).clear() } catch { /* nothing to do */ }
}
