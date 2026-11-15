/**
 * The EO Planning working workflow's records (backend routes/eo-workflow.js; docs/workflows/eo-planning-working-workflow.md).
 * The server decides; this only reads and records.
 */
import api from './api'

export interface WorkflowSwitch {
  key: string
  label: string
  is_on: boolean
  evidence: string | null
  confirmed_at: string | null
  confirmed_by: string | null
}

export interface CaseLane {
  /** L1 permit by committee, L2 permit delegated to the EO, L3 subdivision or consolidation, L7 plan work. */
  lane: 'L1' | 'L2' | 'L3' | 'L7'
  open: boolean
  reasons: string[]
  /** YYYY-MM-DD: the date the application is deemed refused, counted to any written extension. Null until acknowledged. */
  deemed_on: string | null
  extension_until: string | null
  acknowledged_at: string | null
  direction_checked_at: string | null
  direction_check_current: boolean
  binding_directions: { id: string; reference: string | null; section: string; summary: string }[]
  committee: { outcome: string; resolution: string; heard_at: string | null } | null
  switches: Record<string, boolean>
}

export type ReferralKind = 'department' | 'minister' | 'statutory' | 'other'
export type ReferralTier = 'mandatory' | 'precautionary' | 'routine'

export interface Referral {
  id: string
  permit_app_id: string | null
  topic: string | null
  kind: ReferralKind
  tier: ReferralTier
  body: string
  legal_basis: string | null
  question: string
  sent_on: string
  reply_by: string | null
  answered_on: string | null
  advice: string | null
  council_action: string | null
  no_reply: boolean
  overdue: boolean
}

export interface MinisterialDirection {
  id: string
  reference: string | null
  section: 's29' | 's69' | 's70' | 'other'
  received_on: string
  summary: string
  refers_to_minister: boolean
  restricts: boolean
  applies_to_dev_types: string[] | null
  in_force: boolean
  ended_on: string | null
  ceo_informed_on: string | null
}

const data = <T>(r: { data?: { data?: T } }): T => (r.data?.data ?? (r.data as unknown as T))

export const eoWorkflowApi = {
  async switches(): Promise<WorkflowSwitch[]> { return data(await api.get('/eo-workflow/switches')) },
  async setSwitch(key: string, is_on: boolean, evidence: string | null): Promise<void> {
    await api.put(`/eo-workflow/switches/${encodeURIComponent(key)}`, { is_on, evidence })
  },
  async lane(permitId: string): Promise<CaseLane> { return data(await api.get(`/eo-workflow/lane/${encodeURIComponent(permitId)}`)) },
  async recordDirectionCheck(permitId: string): Promise<void> {
    await api.post(`/permit-applications/${encodeURIComponent(permitId)}/direction-check`)
  },
  async recordExtension(permitId: string, extension_until: string, evidence: string): Promise<void> {
    await api.post(`/permit-applications/${encodeURIComponent(permitId)}/extension`, { extension_until, evidence })
  },
  async referrals(params: { permit?: string; open?: boolean } = {}): Promise<Referral[]> {
    return data(await api.get('/eo-workflow/referrals', { params: { permit: params.permit, open: params.open ? 1 : undefined } }))
  },
  async createReferral(body: {
    permit_app_id?: string | null; topic?: string; kind: ReferralKind; tier: ReferralTier
    body: string; legal_basis?: string; question: string; reply_by?: string
  }): Promise<Referral> { return data(await api.post('/eo-workflow/referrals', body)) },
  async answerReferral(id: string, body: { advice?: string; no_reply?: boolean; council_action?: string }): Promise<Referral> {
    return data(await api.patch(`/eo-workflow/referrals/${encodeURIComponent(id)}`, body))
  },
  async directions(): Promise<MinisterialDirection[]> { return data(await api.get('/eo-workflow/directions')) },
  async createDirection(body: {
    reference?: string; section: MinisterialDirection['section']; received_on: string; summary: string
    refers_to_minister?: boolean; restricts?: boolean; applies_to_dev_types?: string[]; ceo_informed_on?: string
  }): Promise<MinisterialDirection> { return data(await api.post('/eo-workflow/directions', body)) },
  async endDirection(id: string): Promise<void> { await api.patch(`/eo-workflow/directions/${encodeURIComponent(id)}`, { in_force: false }) },
}

/** What the server said, in words: its message first, then its code, then the fallback. */
export function serverMessage(e: unknown, fallback: string): string {
  const ax = e as { response?: { data?: { message?: string; error?: string } }; message?: string }
  return ax?.response?.data?.message ?? ax?.response?.data?.error ?? ax?.message ?? fallback
}

export const LANE_LABEL: Record<CaseLane['lane'], string> = {
  L1: 'L1: permit, decided by the committee or council',
  L2: "L2: permit, decided by the EO under the council's delegation",
  L3: 'L3: subdivision or consolidation (Part VI)',
  L7: 'L7: plan work (Part IV)',
}
