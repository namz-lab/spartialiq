// src/statutory/composables/usePlans.ts
// Parts II & IV plan register — persisted via /api/statutory/plans (PostGIS).

import { ref } from 'vue'
import { nowIso } from '../types/common'
import {
  type AnyPlan, type PlanBase, type PlanKind, type PlanStatus,
  type PlanConflict, PLAN_LIFECYCLE,
} from '../types/plans'
import { statutoryApi } from '../services/statutoryApi'

let seq = 0
const uid = (p: string) => `${p}-${Date.now().toString(36)}-${(seq++).toString(36)}`

const plans = ref<AnyPlan[]>([])
const loaded = ref(false)
const loadError = ref('')

export function usePlans() {
  async function refresh(): Promise<void> {
    loadError.value = ''
    try {
      plans.value = await statutoryApi.listPlans()
      loaded.value = true
    } catch (e) {
      loadError.value = 'Could not load the statutory plan register from the server.'
      console.error(e)
    }
  }

  function listPlans(filter?: { kind?: PlanKind; status?: PlanStatus }): AnyPlan[] {
    return plans.value.filter(p =>
      (!filter?.kind || p.kind === filter.kind) &&
      (!filter?.status || p.status === filter.status))
  }

  async function createPlan(kind: PlanKind, seed: Partial<PlanBase> = {}): Promise<AnyPlan> {
    const base: PlanBase = {
      id: uid('plan'),
      kind,
      name: seed.name || `New ${kind} plan`,
      authorityId: seed.authorityId || 'lpa',
      status: 'draft',
      writtenStatement: seed.writtenStatement || { sections: [] },
      maps: seed.maps || [],
      objections: [],
      consultationLog: [],
      audit: [{ at: nowIso(), actor: 'system', role: 'lpa_staff', action: 'created (draft)' }],
    }
    const plan: AnyPlan =
      kind === 'regional' ? { ...base, kind: 'regional', phasing: [], costEstimates: [], priorities: [] }
      : kind === 'master' ? { ...base, kind: 'master', scenicAreas: [], priorityAreas: [], neighbourRelations: [] }
      : { ...base, kind: 'local', measures: [], phasing: [] }
    await statutoryApi.savePlan(plan)
    plans.value = [...plans.value, plan]
    return plan
  }

  async function advanceStatus(id: string, to: PlanStatus): Promise<boolean> {
    const p = plans.value.find(x => x.id === id)
    if (!p) return false
    const curIdx = PLAN_LIFECYCLE.indexOf(p.status)
    const toIdx = PLAN_LIFECYCLE.indexOf(to)
    const sequential = curIdx >= 0 && toIdx === curIdx + 1
    const terminal = (to === 'altered' || to === 'repealed') && p.status === 'operative'
    if (!sequential && !terminal) return false
    p.status = to
    if (to === 'operative') p.effectiveDate = nowIso()
    p.audit.push({ at: nowIso(), actor: 'lpa', role: 'lpa_committee', action: `status → ${to}` })
    await statutoryApi.savePlan(p)
    return true
  }

  function addObjection(planId: string, o: { objector: string; text: string; representation?: boolean }) {
    const p = plans.value.find(x => x.id === planId)
    if (!p) return
    p.objections.push({ id: uid('obj'), status: 'open', objector: o.objector, text: o.text, representation: o.representation })
    void statutoryApi.savePlan(p)
  }

  function referObjectionToAdminCourt(planId: string, objectionId: string) {
    const p = plans.value.find(x => x.id === planId)
    const o = p?.objections.find(x => x.id === objectionId)
    if (!p || !o) return
    o.status = 'referred_admin_court'
    p.audit.push({ at: nowIso(), actor: 'lpa', role: 'lpa_staff', action: `objection ${objectionId} → Administrative Court (s19)` })
    void statutoryApi.savePlan(p)
  }

  /** Operative plans that apply at a point (authority-wide or boundary contains). */
  async function plansForParcelAt(lng: number, lat: number): Promise<{ regional?: AnyPlan; master?: AnyPlan; local?: AnyPlan }> {
    const operative = await statutoryApi.plansForPoint(lng, lat)
    return {
      regional: operative.find(p => p.kind === 'regional'),
      master: operative.find(p => p.kind === 'master'),
      local: operative.find(p => p.kind === 'local'),
    }
  }

  /** Sync helper for callers that only have in-memory operative plans. */
  function plansForParcel(_parcelGeom: unknown): { regional?: AnyPlan; master?: AnyPlan; local?: AnyPlan } {
    const operative = plans.value.filter(p => p.status === 'operative')
    return {
      regional: operative.find(p => p.kind === 'regional'),
      master: operative.find(p => p.kind === 'master'),
      local: operative.find(p => p.kind === 'local'),
    }
  }

  /** Persist edits made in place on a plan held in the register. */
  async function savePlan(plan: AnyPlan): Promise<void> {
    await statutoryApi.savePlan(plan)
  }

  function conflicts(_parcelGeom: unknown): PlanConflict[] {
    return []
  }

  if (!loaded.value) void refresh()

  return {
    plans, loaded, loadError, refresh,
    listPlans, createPlan, savePlan, advanceStatus, addObjection, referObjectionToAdminCourt,
    plansForParcel, plansForParcelAt, conflicts,
  }
}

export type PlansApi = ReturnType<typeof usePlans>
