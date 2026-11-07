// src/statutory/types/common.ts
// ─────────────────────────────────────────────────────────────────────────
// Shared value types for the statutory (RTCP Act [Ch. 29:12]) domain.
// Dates are ISO 8601 strings; geometry is GeoJSON WGS84 (consistent with the
// existing planning engine in src/planning/*). Pure data — no Vue/turf.
// ─────────────────────────────────────────────────────────────────────────

import type { Geometry } from 'geojson'

/** ISO 8601 timestamp, e.g. '2026-06-24T08:00:00.000Z'. */
export type StatutoryDate = string

export interface Money { amountUSD: number; note?: string }

/** Consent of an interested party — owner / mortgagee / real-right holder (s26(2), s40). */
export interface PartyConsent {
  party: 'owner' | 'mortgagee' | 'real_right_holder' | 'lessee'
  name: string
  given: boolean
  documentRef?: string
}

/** One immutable audit-trail entry (service of orders, status changes, etc.). */
export interface AuditEntry {
  at: StatutoryDate
  actor: string
  role: string
  action: string
  detail?: string
}

/** A reference to PostGIS-backed geometry: a layer + feature id, and/or inline GeoJSON. */
export interface GeomRef {
  layer: string
  featureId?: string
  geom?: Geometry   // GeoJSON WGS84
}

export function nowIso(): StatutoryDate {
  return new Date().toISOString()
}

/** Add whole calendar months to an ISO date (used for s26/s40 deadlines). */
export function addMonths(iso: StatutoryDate, months: number): StatutoryDate {
  const d = new Date(iso)
  d.setMonth(d.getMonth() + months)
  return d.toISOString()
}
