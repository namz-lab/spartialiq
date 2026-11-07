// Citizen map — data access and pure helpers for MapSection.vue.
//
// Every call here is a public, citizen-safe endpoint:
//   /api/map-search           names: places, wards, stands, roads, parcels
//   /api/map-query            questions and filters ("how many clinics")
//   /api/map/nearest-services nearest facility per category to a point
//   /api/map/public-notices   proposals open for objection (no applicant data)
//   /api/parcels/locate       parcel, ward, district, council area at a point
//   /api/development-control/zoning-at   zone + development matrix at a point

import area from '@turf/area'
import api from '@/services/api'
import { searchMap, type SearchResult } from '@/services/vectorTiles'

export type LngLat = [number, number]

// ── Search ────────────────────────────────────────────────────────
export interface MapHit {
  type: string
  label: string
  subtitle?: string
  center: LngLat
}
export interface SearchOutcome { hits: MapHit[]; message: string; isQuery: boolean }

// Questions and filters go to /map-query; so does a name search that finds nothing.
export const QUESTION = /^(how many|count|number of|show|list|find|where|all|nearest)\b/i

const validCenter = (c: unknown): c is LngLat =>
  Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1]) && !(c[0] === 0 && c[1] === 0)

export async function mapQuery(q: string): Promise<SearchOutcome> {
  const r = await api.get('/map-query', { params: { q } })
  const hits = ((r.data?.results ?? []) as MapHit[]).filter(h => validCenter(h.center))
  return { hits, message: String(r.data?.message ?? ''), isQuery: true }
}

export async function searchOrQuery(q: string): Promise<SearchOutcome> {
  if (!QUESTION.test(q)) {
    const hits = (await searchMap(q)) as (SearchResult & MapHit)[]
    if (hits.length) return { hits: hits.filter(h => validCenter(h.center)), message: '', isQuery: false }
  }
  try {
    return await mapQuery(q)
  } catch {
    return { hits: [], message: 'Search is not available right now. Try again in a moment.', isQuery: true }
  }
}

/** One-tap questions shown under the search box. */
export const QUICK_QUERIES: { label: string; q: string }[] = [
  { label: 'Available stands', q: 'available stands' },
  { label: 'Clinics', q: 'show clinics' },
  { label: 'Hospitals', q: 'show hospitals' },
  { label: 'Schools', q: 'show schools' },
  { label: 'Police', q: 'show police' },
  { label: 'Wards', q: 'wards' },
  { label: 'Planning zones', q: 'residential zones' },
  { label: 'Cemeteries', q: 'cemeteries' },
]

// ── Point queries ─────────────────────────────────────────────────
export interface NearestService { key: string; label: string; name: string; fclass: string; dist_m: number; center: LngLat }

export async function nearestServices(lng: number, lat: number): Promise<NearestService[]> {
  const r = await api.get('/map/nearest-services', { params: { lng, lat } })
  return (r.data?.data ?? []) as NearestService[]
}

export interface PublicNotice {
  reference: string | null
  stand_number: string | null
  suburb_ward: string | null
  development_type: string | null
  objection_start: string | null
  objection_end: string | null
  center: LngLat
}

export async function publicNotices(): Promise<PublicNotice[]> {
  const r = await api.get('/map/public-notices')
  return ((r.data?.data ?? []) as PublicNotice[]).filter(n => validCenter(n.center))
}

// ── Formatting ────────────────────────────────────────────────────
export function fmtDistance(m: number): string {
  if (!Number.isFinite(m)) return '—'
  return m < 1000 ? `${Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}

export function fmtArea(sqm: number): string {
  if (!Number.isFinite(sqm)) return '—'
  return sqm < 10000 ? `${Math.round(sqm).toLocaleString()} m²` : `${(sqm / 10000).toFixed(2)} ha`
}

export function fmtDate(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? iso + 'T00:00:00' : iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** "12°30.1′S"-style is overkill for residents; decimal degrees, 5 places (≈1 m). */
export function fmtCoord([lng, lat]: LngLat): string {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`
}

// ── Measuring ─────────────────────────────────────────────────────
const EARTH_R = 6371008.8
export function haversine(a: LngLat, b: LngLat): number {
  const rad = Math.PI / 180
  const dLat = (b[1] - a[1]) * rad
  const dLng = (b[0] - a[0]) * rad
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLng / 2) ** 2
  return 2 * EARTH_R * Math.asin(Math.sqrt(h))
}

export function pathLength(pts: LngLat[]): number {
  let m = 0
  for (let i = 1; i < pts.length; i++) m += haversine(pts[i - 1], pts[i])
  return m
}

/** Geodesic area of the closed ring through pts (m²); 0 below three points. */
export function ringArea(pts: LngLat[]): number {
  if (pts.length < 3) return 0
  return area({ type: 'Polygon', coordinates: [[...pts, pts[0]]] })
}

// ── Deep links (?section=map&at=lng,lat,zoom) ─────────────────────
export function parseAt(v: unknown): { center: LngLat; zoom: number } | null {
  if (typeof v !== 'string') return null
  const [lng, lat, z] = v.split(',').map(Number)
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90) return null
  return { center: [lng, lat], zoom: Number.isFinite(z) ? Math.min(20, Math.max(5, z)) : 16 }
}

export function formatAt([lng, lat]: LngLat, zoom: number): string {
  return `${lng.toFixed(6)},${lat.toFixed(6)},${Math.round(zoom)}`
}

// ── Layers a resident can switch ──────────────────────────────────
// Ids are vunguBasemap catalogue ids; a row may drive several tile layers.
export interface LayerRow { key: string; label: string; ids: string[]; geom: 'polygon' | 'line' | 'point'; on: boolean; hint?: string }
export interface LayerGroup { title: string; rows: LayerRow[] }

export function citizenLayerGroups(): LayerGroup[] {
  return [
    { title: 'Boundaries', rows: [
      { key: 'wards', label: 'Wards', ids: ['wards'], geom: 'polygon', on: true },
      { key: 'districts', label: 'Districts', ids: ['districts'], geom: 'polygon', on: true },
    ] },
    { title: 'Planning and land', rows: [
      { key: 'zones', label: 'Planning zones', ids: ['vungu_proposed_peri_urban_zones'], geom: 'polygon', on: true,
        hint: 'What may be built where. Tap a zone for its permitted uses.' },
      { key: 'tenure', label: 'Land tenure zones', ids: ['vungu_beyond_peri_urban_zones'], geom: 'polygon', on: false },
      { key: 'parcels', label: 'Parcels', ids: ['vungu_parcels'], geom: 'polygon', on: false },
      { key: 'farms', label: 'Farms', ids: ['vungu_farm_cadastre'], geom: 'polygon', on: false },
      { key: 'stands', label: 'Stands register', ids: ['stands'], geom: 'polygon', on: false },
      { key: 'landuse', label: 'Land use', ids: ['landuse'], geom: 'polygon', on: true },
    ] },
    { title: 'Infrastructure and environment', rows: [
      { key: 'roads', label: 'Roads', ids: ['roads'], geom: 'line', on: true },
      { key: 'rail', label: 'Railways', ids: ['railways'], geom: 'line', on: true },
      { key: 'buildings', label: 'Buildings', ids: ['buildings'], geom: 'polygon', on: true, hint: 'Shown from street level zoom.' },
      { key: 'water', label: 'Rivers and dams', ids: ['waterways', 'water_areas'], geom: 'line', on: true },
      { key: 'protected', label: 'Protected areas', ids: ['protected_areas'], geom: 'polygon', on: true },
    ] },
    { title: 'Places and services', rows: [
      { key: 'places', label: 'Place names', ids: ['places_points', 'places_areas'], geom: 'point', on: true },
      { key: 'services', label: 'Facilities', ids: ['pois_points', 'pois_areas'], geom: 'point', on: true },
      { key: 'worship', label: 'Places of worship', ids: ['places_of_worship_points', 'places_of_worship_areas'], geom: 'point', on: false },
      { key: 'transport', label: 'Transport', ids: ['transport_points', 'transport_areas', 'traffic_points', 'traffic_areas'], geom: 'point', on: false },
      { key: 'cemeteries', label: 'Cemeteries', ids: ['vungu_cemeteries'], geom: 'polygon', on: true },
      { key: 'waste', label: 'Waste sites', ids: ['vungu_waste_management'], geom: 'polygon', on: true },
    ] },
  ]
}
