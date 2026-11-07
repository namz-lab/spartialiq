// ─── propertyService ─────────────────────────────────────────────────────
// Frontend client for the parcel-centric Property File (land register).
// Backend: backend/src/routes/properties.js (migration 084). Empty payloads
// are honest empties — the UI never fabricates owners or deeds. On network /
// auth failure the Property File shows "register could not be loaded".
// Applications/permits on a parcel still come from dmApi.
//
//   GET /api/properties/:standNo                 → PropertySummary
//   GET /api/properties/:standNo/owners          → PropertyOwner[]
//   GET /api/properties/:standNo/zoning          → ZoningDesignation[]
//   GET /api/properties/:standNo/existing-uses   → ExistingUse[]
//   GET /api/properties/:standNo/lineage         → ParcelLineage
//   GET /api/properties/:standNo/assessment      → PropertyAssessment
// Staff role-gated; owners + assessment carry PII.
// ───────────────────────────────────────────────────────────────────────────
import api from './api'

export interface PropertyHeritage {
  conservation_district: boolean
  municipally_designated: boolean
  provincially_designated: boolean
  notes: string | null
}

export interface PropertySummary {
  stand_number: string
  ward: string | null
  address: string | null
  aan: string | null               // assessment account number
  pid: string | null               // property id
  area_sqm: number | null
  frontage_m: number | null
  units: number | null
  dwellings: number | null
  corner_lot: boolean
  dev_agreement: boolean
  follow_up_date: string | null
  heritage: PropertyHeritage | null
}

export interface PropertyOwner {
  id: string
  name: string
  company: string | null
  role: 'owner' | 'occupier' | 'agent'
  postal_address: string | null
  phone: string | null
  email: string | null
  since: string | null
}

export interface ZoningDesignation {
  id: string
  designation: string
  effective_date: string | null
  notes: string | null
  reference: string | null
}

export interface ExistingUse {
  id: string
  use: string
  recorded_at: string | null
  notes: string | null
}

// Subdivision/consolidation lineage (parent PID ↔ child lots).
export interface ParcelLineageNode {
  stand_number: string
  pid: string | null
  created_at?: string | null
}
export interface ParcelLineage {
  action: 'subdivision' | 'consolidation' | null
  parent: ParcelLineageNode | null
  children: ParcelLineageNode[]
}

// Assessment / rates linkage.
export interface PropertyAssessment {
  aan: string | null
  roll_number: string | null
  valuation: number | null
  rateable_value: number | null
  rates_balance: number | null
  last_paid_at: string | null
}

function unwrap<T>(r: { data?: { data?: T } | T }): T {
  const body = r.data as { data?: T } | T
  return (body && typeof body === 'object' && 'data' in (body as object)
    ? (body as { data: T }).data
    : body) as T
}

export const propertyService = {
  async getSummary(standNo: string): Promise<PropertySummary> {
    const r = await api.get(`/properties/${encodeURIComponent(standNo)}`)
    return unwrap<PropertySummary>(r)
  },
  async listOwners(standNo: string): Promise<PropertyOwner[]> {
    const r = await api.get(`/properties/${encodeURIComponent(standNo)}/owners`)
    return unwrap<PropertyOwner[]>(r) ?? []
  },
  async listZoningDesignations(standNo: string): Promise<ZoningDesignation[]> {
    const r = await api.get(`/properties/${encodeURIComponent(standNo)}/zoning`)
    return unwrap<ZoningDesignation[]>(r) ?? []
  },
  async listExistingUses(standNo: string): Promise<ExistingUse[]> {
    const r = await api.get(`/properties/${encodeURIComponent(standNo)}/existing-uses`)
    return unwrap<ExistingUse[]>(r) ?? []
  },
  // Parent PID ↔ child lots from subdivisions/consolidations.
  async getLineage(standNo: string): Promise<ParcelLineage> {
    const r = await api.get(`/properties/${encodeURIComponent(standNo)}/lineage`)
    return unwrap<ParcelLineage>(r)
  },
  // Assessment account / rates balance.
  async getAssessment(standNo: string): Promise<PropertyAssessment> {
    const r = await api.get(`/properties/${encodeURIComponent(standNo)}/assessment`)
    return unwrap<PropertyAssessment>(r)
  },
}
