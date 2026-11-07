// src/map/tools/withinQuery.ts
// ─────────────────────────────────────────────────────────────────────────
// "What is within R metres of this point" — the abutting-owner / notification
// query (RTCP Act s.26(3) advert radius, and the everyday "who do I write to"
// question).
//
// The authoritative answer is GET /api/gis/within: ST_DWithin over the whole
// cadastre, indexed, ordered by ground distance. Counting queryRenderedFeatures
// in the browser only sees the tiles the viewport happens to have loaded, so it
// under-counts at low zoom and silently changes answer as you pan — fine as a
// field fallback when the server is unreachable, never as the schedule you
// attach to a file.
// ─────────────────────────────────────────────────────────────────────────
import api from '@/services/api'

/** The service clamps to this range; mirrored here so the UI agrees with it. */
export const MIN_RADIUS_M = 1
export const MAX_RADIUS_M = 5000

export interface WithinParcel {
  label: string
  district: string | null
  areaHa: number | null
  distanceM: number
}

export interface WithinResult {
  radiusM: number
  count: number
  parcels: WithinParcel[]
  /** true when the figures came from the cadastre, false for a viewport count. */
  authoritative: boolean
}

export function clampRadius(m: unknown): number {
  const n = Math.round(Number(m))
  if (!Number.isFinite(n)) return 100
  return Math.min(MAX_RADIUS_M, Math.max(MIN_RADIUS_M, n))
}

/** Parcels whose geometry falls within `radiusM` of [lng, lat]. Throws on failure
 *  so the caller can decide between the viewport fallback and an honest error. */
export async function parcelsWithin(lng: number, lat: number, radiusM: number): Promise<WithinResult> {
  const radius = clampRadius(radiusM)
  const res = await api.get('/gis/within', { params: { lng, lat, radius } })
  const body = res.data ?? {}
  const rows: any[] = Array.isArray(body.parcels) ? body.parcels : []
  return {
    radiusM: Number(body.radius_m) || radius,
    count: Number.isFinite(Number(body.count)) ? Number(body.count) : rows.length,
    parcels: rows.map((r) => ({
      label: String(r.label ?? '—'),
      district: r.district ?? null,
      areaHa: r.area_ha != null ? Number(r.area_ha) : null,
      distanceM: Math.round(Number(r.distance_m) || 0),
    })),
    authoritative: true,
  }
}

/** The schedule an officer attaches to the file: one row per parcel, metres to
 *  the site. Excel-safe quoting; the header carries the query itself so a
 *  printed sheet still says which point and radius produced it. */
export function withinCsv(center: [number, number], result: WithinResult): string {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)
  const lines = [
    esc(`Parcels within ${result.radiusM} m of ${center[1].toFixed(6)}, ${center[0].toFixed(6)}`),
    esc(`${result.count} parcel(s) · ${result.authoritative ? 'cadastre (ST_DWithin)' : 'viewport estimate'} · generated ${new Date().toISOString()}`),
    '',
    'label,district,area_ha,distance_m',
    ...result.parcels.map((p) =>
      [esc(p.label), esc(p.district ?? ''), p.areaHa != null ? p.areaHa.toFixed(4) : '', String(p.distanceM)].join(','),
    ),
  ]
  return lines.join('\n')
}
