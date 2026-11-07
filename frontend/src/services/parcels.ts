// src/services/parcels.ts
// Client for the parcel/stand spatial lookup (/api/parcels).
import api from './api'

export interface StandDetail {
  fid: number
  stand_number: string
  province: string | null
  area_ha: number | null
  centroid: [number, number]   // [lng, lat]
  ward: string | null
  district: string | null
  description: string
}

export interface ResponsibleAuthority {
  name: string
  telephone: string | null
  email: string | null
  address: string | null
}

export interface StandLocation {
  in_jurisdiction: boolean
  district: string | null
  /** Ward containing the point, parcel or not. */
  ward?: string | null
  authority: ResponsibleAuthority | null
  stand: StandDetail | null
}

/** Resolves a map point into a jurisdiction + stand bundle. */
export async function locateStand(lng: number, lat: number): Promise<StandLocation> {
  const res = await api.get('/parcels/locate', { params: { lng, lat } })
  return (res.data?.data ?? res.data) as StandLocation
}

export interface FoundParcel {
  fid: number
  stand_number: string
  status: string | null
  district: string | null
  area_ha: number | null
  centroid: [number, number]
  bbox: [number, number, number, number]
}

export async function findParcels(q: string): Promise<FoundParcel[]> {
  const res = await api.get('/parcels/find', { params: { q } })
  const data = res.data?.data ?? res.data ?? []
  return Array.isArray(data) ? data : []
}

export interface NearbyParcel {
  fid: number
  stand_number: string
  status: string | null
  area_ha: number | null
  dist_m: number
}

export interface NearbyQuery {
  site?: StandLocation
  radius_m: number
  parcels: NearbyParcel[]
  roads?: unknown[]
  pois?: unknown[]
  buildings?: number
  applications?: unknown[]
}

/** Staff-only surroundings query (ownership may be present on the site stand). */
export async function parcelsNearby(
  lng: number,
  lat: number,
  radius = 100,
): Promise<NearbyQuery> {
  const res = await api.get('/parcels/nearby', { params: { lng, lat, radius } })
  const data = res.data?.data ?? res.data
  return {
    site: data?.site,
    radius_m: data?.radius_m ?? radius,
    parcels: Array.isArray(data?.parcels) ? data.parcels : [],
    roads: data?.roads,
    pois: data?.pois,
    buildings: data?.buildings,
    applications: data?.applications,
  }
}
