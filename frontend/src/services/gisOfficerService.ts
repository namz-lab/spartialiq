// ─── gisOfficerService ──────────────────────────────────────────────
// Thin projection layer the GIS Officer window uses to surface canonical
// Development-Management records as GIS-shaped views. Wraps dmApi — no new
// backend endpoints. Coordinates are REAL: permit_application.location is
// surfaced as lng/lat by v_application_summary (migration 081); permits with
// no stored location are simply not plotted (no fabricated markers).
// ───────────────────────────────────────────────────────────────────

import {
  dmApi,
  type PermitApplication, type EnforcementOrder,
} from './developmentManagementService'

export interface PermitLocation {
  permit: PermitApplication
  lng: number
  lat: number
}

export interface EnforcementLocation {
  order: EnforcementOrder
  lng: number
  lat: number
}

const VUNGU_CENTER: [number, number] = [29.810, -19.492]

export const gisOfficerService = {
  // Real permit centroids only. Permits without a stored location are omitted
  // rather than scattered with fake jitter — the count gap is itself a useful
  // GIS-quality signal (see permitsMissingLocation).
  async listPermitLocations(): Promise<PermitLocation[]> {
    const r = await dmApi.listPermits({ limit: 500, offset: 0 })
    return r.data
      .filter(p => p.lng != null && p.lat != null)
      .map(p => ({ permit: p, lng: p.lng as number, lat: p.lat as number }))
  },

  async listEnforcementLocations(): Promise<EnforcementLocation[]> {
    const orders = await dmApi.listEnforcement().catch(() => [] as EnforcementOrder[])
    return orders
      .filter(o => o.latitude != null && o.longitude != null)
      .map(o => ({ order: o, lng: o.longitude as number, lat: o.latitude as number }))
  },

  vunguCenter(): [number, number] { return VUNGU_CENTER },

  // GIS-quality signal: how many real permits lack a geolocated centroid.
  async permitsMissingLocation(): Promise<{ total: number; missing: number }> {
    const r = await dmApi.listPermits({ limit: 500, offset: 0 })
    const total = r.data.length
    const missing = r.data.filter(p => p.lng == null || p.lat == null).length
    return { total, missing }
  },

  async aggregateCounts(): Promise<{ permits: number; enforcement: number }> {
    const [permits, enforcement] = await Promise.all([
      dmApi.listPermits({ limit: 500, offset: 0 }).then(r => r.data.length).catch(() => 0),
      dmApi.listEnforcement().then(o => o.length).catch(() => 0),
    ])
    return { permits, enforcement }
  },
}
