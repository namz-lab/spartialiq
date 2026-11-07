// src/services/buildingComplaints.ts
// Client for the public-reports endpoints (backend routes/building-complaints.js,
// table spatial_planning.building_complaint, migration 120).
//
// Errors propagate. A failed read must never render as "no complaints" — that
// is the one wrong answer this register can give, because it reads as an
// inspector with nothing outstanding.

import api from './api'

export type ComplaintCategory =
  | 'building_without_permit'
  | 'deviation_from_plan'
  | 'dangerous_structure'
  | 'building_line_encroachment'
  | 'unsafe_site'
  | 'occupation_without_certificate'
  | 'other'

export type ComplaintSeverity = 'routine' | 'urgent' | 'emergency'

export type ComplaintStatus =
  | 'received' | 'assigned' | 'inspected' | 'substantiated' | 'unsubstantiated' | 'closed'

export interface BuildingComplaint {
  id: string
  reference: string
  category: ComplaintCategory
  severity: ComplaintSeverity
  status: ComplaintStatus
  description: string
  stand_number: string | null
  suburb_ward: string | null
  location_note: string | null
  observed_lat: number | null
  observed_lng: number | null
  anonymous: boolean
  /** Always null on an anonymous report — enforced by the schema and the DTO. */
  reporter_name: string | null
  reporter_phone: string | null
  permit_app_id: string | null
  received_at: string
  received_by_name: string | null
  assigned_to: string | null
  assigned_to_name: string | null
  inspected_at: string | null
  inspected_by_name: string | null
  finding: string | null
  closed_at: string | null
  updated_at: string
}

export interface ComplaintSummary {
  open: number
  emergency: number
  awaiting_visit: number
  total: number
}

export interface ComplaintIntake {
  category: ComplaintCategory
  description: string
  severity?: ComplaintSeverity
  stand_number?: string | null
  suburb_ward?: string | null
  location_note?: string | null
  observed_lat?: number | null
  observed_lng?: number | null
  reporter_name?: string | null
  reporter_phone?: string | null
  anonymous?: boolean
  permit_app_id?: string | null
}

export interface ComplaintQuery {
  status?: ComplaintStatus
  category?: ComplaintCategory
  severity?: ComplaintSeverity
  open?: boolean
  search?: string
  limit?: number
  offset?: number
}

/** Labels shown to staff. The stored values are the vocabulary the server checks. */
export const COMPLAINT_CATEGORY_LABELS: Record<ComplaintCategory, string> = {
  building_without_permit: 'Building without a permit',
  deviation_from_plan: 'Deviation from the approved plan',
  dangerous_structure: 'Dangerous or derelict structure',
  building_line_encroachment: 'Building line or boundary encroachment',
  unsafe_site: 'Unsafe site or excavation',
  occupation_without_certificate: 'Occupied without a certificate',
  other: 'Other',
}

export const COMPLAINT_SEVERITY_LABELS: Record<ComplaintSeverity, string> = {
  routine: 'Routine',
  urgent: 'Urgent',
  emergency: 'Emergency — danger to life',
}

export const COMPLAINT_STATUS_LABELS: Record<ComplaintStatus, string> = {
  received: 'Received',
  assigned: 'Assigned',
  inspected: 'Inspected',
  substantiated: 'Substantiated',
  unsubstantiated: 'Unsubstantiated',
  closed: 'Closed',
}

/** A report still needing work from this desk. */
export function isComplaintOpen(c: Pick<BuildingComplaint, 'status'>): boolean {
  return c.status !== 'closed' && c.status !== 'unsubstantiated'
}

function data<T>(r: { data?: { data?: T } }): T {
  const body = r.data as { data?: T } | undefined
  if (!body || body.data === undefined) throw new Error('The server returned an empty response.')
  return body.data
}

export const complaintsApi = {
  async list(query: ComplaintQuery = {}): Promise<{ data: BuildingComplaint[]; summary: ComplaintSummary }> {
    const r = await api.get('/building-complaints', { params: query })
    const body = r.data as { data?: BuildingComplaint[]; summary?: ComplaintSummary } | undefined
    if (!body?.data) throw new Error('The server returned an empty response.')
    return {
      data: body.data,
      summary: body.summary ?? { open: 0, emergency: 0, awaiting_visit: 0, total: body.data.length },
    }
  },

  async get(id: string): Promise<BuildingComplaint> {
    return data(await api.get(`/building-complaints/${encodeURIComponent(id)}`))
  },

  async create(input: ComplaintIntake): Promise<BuildingComplaint> {
    return data(await api.post('/building-complaints', input))
  },

  async triage(
    id: string,
    patch: { severity?: ComplaintSeverity; assigned_to?: string | null; permit_app_id?: string | null; stand_number?: string },
  ): Promise<BuildingComplaint> {
    return data(await api.patch(`/building-complaints/${encodeURIComponent(id)}/triage`, patch))
  },

  async recordFinding(
    id: string,
    outcome: 'substantiated' | 'unsubstantiated',
    finding: string,
  ): Promise<BuildingComplaint> {
    return data(await api.post(`/building-complaints/${encodeURIComponent(id)}/finding`, { outcome, finding }))
  },

  async close(id: string, note?: string): Promise<BuildingComplaint> {
    return data(await api.post(`/building-complaints/${encodeURIComponent(id)}/close`, { note }))
  },
}
