/**
 * Planning fees in the ledger (migration 246). Mirrors backend `src/routes/finance-planning-fees.js`.
 * The counter receipt itself is in cashApi (`issuePlanningReceipt`).
 */
import api from '../../../services/api'
import type { Currency } from '../models/types'
import type { PlanningFeeKind } from '../models/cashTypes'

export type PlanningFeeState = 'awaiting_voucher' | 'awaiting_posting' | 'posted' | 'cancelled'

export interface PlanningFee {
  id: string
  source: 'counter' | 'online'
  fee_kind: PlanningFeeKind
  permit_application_id: string | null
  tpd_reference: string | null
  dev_register_no: string | null
  stand_number: string | null
  applicant_name: string | null
  payer_name: string | null
  currency: Currency
  amount: string
  received_on: string
  reference: string | null
  receipt_no: string | null
  method: string | null
  driver: string | null
  voucher_id: string | null
  voucher_no: string | null
  voucher_status: string | null
  state: PlanningFeeState
  prepared_at: string | null
  prepared_by_name: string | null
}

export interface PlanningFeeSummary { state: PlanningFeeState; currency: Currency; n: number; amount: string }

const unwrap = <T>(r: { data?: { data?: T } | T }): T => {
  const body = r.data as { data?: T } | T
  return (body && typeof body === 'object' && 'data' in (body as object) ? (body as { data: T }).data : body) as T
}

export const planningFeesApi = {
  async list(params?: { state?: PlanningFeeState; source?: 'counter' | 'online'; q?: string; limit?: number; offset?: number }):
  Promise<{ fees: PlanningFee[]; total: number; summary: PlanningFeeSummary[] }> {
    return unwrap(await api.get('/finance/planning-fees', { params }))
  },

  /** Raise the draft vouchers for online fees still waiting. Somebody else posts them. */
  async prepare(ids?: string[]): Promise<{
    prepared: { planning_fee_id: string; voucher_no: string }[]
    waiting: { planning_fee_id: string; reason: string }[]
    note: string
  }> {
    return unwrap(await api.post('/finance/planning-fees/prepare', ids && ids.length ? { ids } : {}))
  },
}
