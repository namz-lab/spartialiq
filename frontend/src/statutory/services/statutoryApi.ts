// src/statutory/services/statutoryApi.ts
// Persistence for master and local plans → /api/statutory/plans (migration 101).
// Applications, orders and certificates live in the operational register
// (developmentManagementService); this file no longer duplicates them.

import api from '@/services/api'
import type { AnyPlan } from '../types/plans'

export const statutoryApi = {
  async savePlan(plan: AnyPlan): Promise<{ id: string }> {
    const r = await api.post('/statutory/plans', plan)
    return r.data?.data ?? { id: plan.id }
  },

  async listPlans(): Promise<AnyPlan[]> {
    const r = await api.get('/statutory/plans')
    const rows = r.data?.data ?? r.data ?? []
    return Array.isArray(rows) ? rows as AnyPlan[] : []
  },

  async plansForPoint(lng: number, lat: number): Promise<AnyPlan[]> {
    const r = await api.get('/statutory/plans/for-parcel', { params: { lng, lat } })
    const rows = r.data?.data ?? r.data ?? []
    return Array.isArray(rows) ? rows as AnyPlan[] : []
  },
}
