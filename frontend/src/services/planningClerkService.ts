// ─── planningClerkService ───────────────────────────────────────────
// Thin projection layer the Planning Clerk Portal uses to read the
// canonical Development-Management records via dmApi as clerk-shaped
// views (development register, dispatch queue, refusal queue,
// fee-reconciliation source list). No new backend endpoints.
// ───────────────────────────────────────────────────────────────────

import {
  dmApi,
  type PermitApplication, type EnforcementOrder,
} from './developmentManagementService'
import { isPermitApproved, isPermitInCirculation, normalizeStatus } from '@/composables/useApplicationPipeline'

export interface DevelopmentRegisterRow {
  permit: PermitApplication
  daysSinceReceived: number
}

// Re-export API client (planningClerkApi) — localStorage registers moved to Postgres.
export { planningClerkApi } from './planningClerkApi'

export const planningClerkService = {
  async developmentRegister(): Promise<DevelopmentRegisterRow[]> {
    const r = await dmApi.listPermits({ limit: 500, offset: 0 })
    return r.data
      .map(p => ({
        permit: p,
        daysSinceReceived: p.received_at
          ? Math.floor((Date.now() - new Date(p.received_at).getTime()) / 86_400_000)
          : 0,
      }))
      .sort((a, b) =>
        new Date(b.permit.created_at).getTime() - new Date(a.permit.created_at).getTime())
  },

  async newApplicationsToday(): Promise<PermitApplication[]> {
    const r = await dmApi.listPermits({ limit: 500, offset: 0 })
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    return r.data.filter(p => p.received_at
      && new Date(p.received_at).getTime() >= start.getTime())
  },

  async incompleteApplications(): Promise<PermitApplication[]> {
    const r = await dmApi.listPermits({ limit: 500, offset: 0 })
    return r.data.filter(p => {
      const s = normalizeStatus(p.status)
      return (s === 'registered' || s === 'acknowledged' || s === 'pending_payment') && !p.fee_paid
    })
  },

  async dispatchQueue(): Promise<PermitApplication[]> {
    const r = await dmApi.listPermits({ limit: 500, offset: 0 })
    return r.data.filter(p => isPermitApproved(p.status))
  },

  async refusalQueue(): Promise<PermitApplication[]> {
    const r = await dmApi.listPermits({ limit: 500, offset: 0 })
    return r.data.filter(p => normalizeStatus(p.status) === 'refused')
  },

  async noticeQueue(): Promise<PermitApplication[]> {
    const r = await dmApi.listPermits({ limit: 500, offset: 0 })
    return r.data.filter(p =>
      normalizeStatus(p.status) === 'objection_period' || isPermitInCirculation(p.status))
  },

  async enforcementOrders(): Promise<EnforcementOrder[]> {
    return dmApi.listEnforcement().catch(() => [] as EnforcementOrder[])
  },

  async getPermit(id: string): Promise<PermitApplication | null> {
    try { return await dmApi.getPermit(id) } catch { return null }
  },
}
