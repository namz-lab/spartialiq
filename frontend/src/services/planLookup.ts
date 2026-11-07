// src/services/planLookup.ts
// ---------------------------------------------------------------------------
// Client for the public plan lookup (/api/plan-lookup): "what can I build here?"
//
// WHAT A VISITOR SEES IS THE SERVER'S DECISION
// The server shows a plan to the public only once it is gazetted, and to signed-in council staff also their own
// authority's drafts (marked provisional). This module and the page that uses it never filter or relabel that: a
// parcel with no visible plan is simply "not published", which is also the answer when it is in no zone at all.
import api from './api'

export type ParcelLayer = 'stands' | 'vungu_parcels' | 'land.parcel'

export interface LookupCandidate {
  layer: ParcelLayer
  id: string
  label: string
  place: string | null
  area_ha: number | null
}

export interface LookupUse {
  code: string
  description: string
  category: string | null
  conditions: string | null
}

export interface LookupResult {
  governing: boolean
  share_pct: number | null
  plan: {
    id: string
    title: string
    version: number
    status: string
    authority: string | null
    gazette_ref: string | null
    effective_from: string | null
    /** The plan is not in force. Only council staff are ever sent one. */
    provisional: boolean
  }
  zone: { id: number; name: string; type_code: string | null; review_status: 'unreviewed' | 'in_review' | 'reviewed' | null; reviewed_by: string | null }
  uses: { permitted: LookupUse[]; special_consent: LookupUse[]; prohibited: LookupUse[] }
  /** Uses the plan has but has not decided for this zone. */
  not_decided: number
}

export interface ParcelLookup {
  parcel: { layer: ParcelLayer; id: string; label: string | null; place: string | null; area_ha: number | null }
  published: boolean
  provisional: boolean
  results: LookupResult[]
  notice: string
}

/** The shortest term the server will search for. */
export const MIN_QUERY = 2

export const planLookup = {
  async search(q: string): Promise<LookupCandidate[]> {
    const r = await api.get('/plan-lookup/search', { params: { q } })
    return r.data.data
  },
  async lookup(layer: ParcelLayer, id: string): Promise<ParcelLookup> {
    const r = await api.get(`/plan-lookup/${encodeURIComponent(layer)}/${encodeURIComponent(id)}`)
    return r.data.data
  },
}

/** A readable reason for a failed request. The server's own wording for a bad search; generic otherwise. */
export function lookupProblem(err: unknown, fallback = 'That did not work. Please try again.'): string {
  const res = (err as { response?: { status?: number; data?: { message?: string } } })?.response
  if (res?.status === 400 && res.data?.message) return res.data.message
  if (res?.status === 429) return 'Too many searches just now. Please wait a minute and try again.'
  return fallback
}
