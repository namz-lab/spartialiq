// ─── eoPlannerService ──────────────────────────────────────────────
// Thin projection layer the EO Planner Portal sections use to read
// canonical Development-Management records via dmApi. No new backend
// endpoints — wraps the existing development-management routes with
// EO-Planner-shaped views (intake queue, due-diligence pipeline,
// circulation tracking, committee bundles, deemed-refusal clock).
// ───────────────────────────────────────────────────────────────────

import {
  dmApi,
  type PermitApplication, type Consultation, type Objection,
  type BuildingPlan, type EnforcementOrder,
} from './developmentManagementService'
import { isPermitApproved, isPermitInCirculation, normalizeStatus } from '@/composables/useApplicationPipeline'

// 90-day statutory determination clock per RTCP Act s.26
export const STATUTORY_DETERMINATION_DAYS = 90

export interface IntakeQueueItem {
  permit: PermitApplication
  daysSinceReceived: number
  daysToDeemed: number | null
  isComplete: boolean
}

export interface CirculationStatus {
  permit_application_id: string
  departments: {
    name: string
    outcome: Consultation['outcome']
    respondedAt: string | null
    consultation: Consultation | null
  }[]
  outstandingCount: number
}

// The standing circulation list. In a rural district council roads, traffic, stormwater, and water and sewer are all the
// Department of Roads and Works', so one referral (key 'engineering') goes to it and is answered on its own referral desk,
// with the infrastructure-cost test of s.26(5). Older cases may still carry 'traffic' or 'water_sewer' referrals: they
// are shown, and answered on the same desk.
export const ALL_TECH_DEPARTMENTS = [
  'environmental_health',
  'survey',
  'engineering',
  'fire',
  'housing',
  'electricity',
  'environment',
] as const

const DEPARTMENT_LABEL: Record<string, string> = {
  engineering: 'Roads and Works',
  environmental_health: 'Environmental health',
  traffic: 'Roads and Works: traffic',
  water_sewer: 'Roads and Works: water and sewer',
}
/** The department's name as officers know it. */
export const departmentLabel = (name: string): string =>
  DEPARTMENT_LABEL[name] ?? (name.charAt(0).toUpperCase() + name.slice(1)).replace(/_/g, ' ')
/** Does Roads and Works answer this referral (on its own desk)? */
export const answeredByRoadsAndWorks = (name: string): boolean =>
  ['engineering', 'roads and works', 'roads_and_works', 'traffic', 'water_sewer'].includes(name.toLowerCase()) || name.toLowerCase().startsWith('engineering')

export const eoPlannerService = {
  // ── Intake & due-diligence queue ─────────────────────────────────
  async intakeQueue(): Promise<IntakeQueueItem[]> {
    const r = await dmApi.listPermits({ limit: 200, offset: 0 })
    return r.data
      .filter(p => {
        const s = normalizeStatus(p.status)
        return s === 'registered' || s === 'acknowledged' || s === 'pending_payment'
      })
      .map(p => intakeItemFromPermit(p))
      .sort((a, b) => (a.daysToDeemed ?? 999) - (b.daysToDeemed ?? 999))
  },

  async dueDiligenceQueue(): Promise<PermitApplication[]> {
    const r = await dmApi.listPermits({ limit: 200, offset: 0 })
    return r.data.filter(p =>
      normalizeStatus(p.status) === 'under_review' || isPermitInCirculation(p.status))
  },

  async publicNoticeQueue(): Promise<PermitApplication[]> {
    const r = await dmApi.listPermits({ limit: 200, offset: 0 })
    return r.data.filter(p =>
      normalizeStatus(p.status) === 'objection_period' || isPermitInCirculation(p.status))
  },

  async committeeBundle(): Promise<PermitApplication[]> {
    const r = await dmApi.listPermits({ limit: 200, offset: 0 })
    return r.data.filter(p => normalizeStatus(p.status) === 'under_review')
  },

  async draftingQueue(): Promise<PermitApplication[]> {
    const r = await dmApi.listPermits({ limit: 200, offset: 0 })
    return r.data.filter(p =>
      isPermitApproved(p.status) || normalizeStatus(p.status) === 'refused')
  },

  // ── Technical circulation ────────────────────────────────────────
  async circulationFor(permitId: string): Promise<CirculationStatus> {
    const consults = await dmApi.listConsultations(permitId).catch(() => [] as Consultation[])
    // Canonical rows key on body_name (the department); legacy rows on department.
    const byDept = new Map<string, Consultation>()
    for (const c of consults) {
      const key = (c.body_name || c.department || '').toString()
      if (key) byDept.set(key, c)
    }
    // the standing list, then any other referral this case carries
    const names: string[] = [...ALL_TECH_DEPARTMENTS, ...[...byDept.keys()].filter(k => !(ALL_TECH_DEPARTMENTS as readonly string[]).includes(k))]
    const departments = names.map(name => {
      const c = byDept.get(name)
      return {
        name,
        outcome: normalizeOutcome(c),
        respondedAt: c?.response_received_at ?? c?.response_received_at_date ?? null,
        consultation: c ?? null,
      }
    })
    const outstandingCount = departments.filter(d => d.outcome === 'pending').length
    return { permit_application_id: permitId, departments, outstandingCount }
  },

  async circulate(
    permitId: string,
    department: string,
    opts: { notes?: string; priority?: Consultation['priority']; response_due_at?: string; blocking?: boolean } = {},
  ): Promise<void> {
    await dmApi.createConsultation(permitId, {
      department,
      body_name: department,
      outcome: 'pending',
      notes: opts.notes ?? null,
      priority: opts.priority,
      response_due_at: opts.response_due_at,
      blocking: opts.blocking,
    } as Partial<Consultation>)
  },

  // ── Objections ───────────────────────────────────────────────────
  async listObjections(permitId: string): Promise<Objection[]> {
    return dmApi.listObjections(permitId).catch(() => [] as Objection[])
  },

  // ── Building plans ───────────────────────────────────────────────
  async listBuildingPlans(permitId: string): Promise<BuildingPlan[]> {
    return dmApi.listBuildingPlans(permitId).catch(() => [] as BuildingPlan[])
  },

  // ── Enforcement ──────────────────────────────────────────────────
  async listEnforcement(): Promise<EnforcementOrder[]> {
    return dmApi.listEnforcement().catch(() => [] as EnforcementOrder[])
  },

  // ── Deemed-refusal clock helper ──────────────────────────────────
  daysToDeemedRefusal(p: PermitApplication, statutoryDays = STATUTORY_DETERMINATION_DAYS): number | null {
    if (!p.received_at) return null
    const elapsed = (Date.now() - new Date(p.received_at).getTime()) / 86_400_000
    return Math.round(statutoryDays - elapsed)
  },
}

// Derive the UI stance from whichever response column the row carries
// (canonical response_status, or the legacy outcome alias).
function normalizeOutcome(c?: Consultation | null): Consultation['outcome'] {
  const s = c?.response_status ?? c?.outcome
  if (s === 'no_objection') return 'no_objection'
  if (s === 'objection') return 'objection'
  if (s === 'conditional' || s === 'conditional_approval') return 'conditional'
  return 'pending'
}

function intakeItemFromPermit(p: PermitApplication): IntakeQueueItem {
  const daysSinceReceived = p.received_at
    ? Math.floor((Date.now() - new Date(p.received_at).getTime()) / 86_400_000)
    : 0
  const daysToDeemed = eoPlannerService.daysToDeemedRefusal(p)
  return {
    permit: p,
    daysSinceReceived,
    daysToDeemed,
    isComplete: p.fee_paid && normalizeStatus(p.status) !== 'pending_payment',
  }
}
