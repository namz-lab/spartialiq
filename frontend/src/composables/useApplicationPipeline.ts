// ─── useApplicationPipeline ──────────────────────────────────────────────
// The single, shared, cross-role model of a development application's journey
// through the municipal workflow:
//
//   Citizen submit → Planning Clerk intake → Technical circulation
//   (GIS / Surveyor / Environmental / Inspector) → Public objection period →
//   Planner review & recommendation → EO Planner determination → Citizen outcome
//
// It is driven by the BACKEND permit status (spatial_planning.permit_application),
// not browser/localStorage flags, so every role window renders the same truth.
// The planner's internal Section-26 stepper (useStatutorySteps) is the detail
// view that lives *inside* the "Planner review" / "Determination" stages here.
// ───────────────────────────────────────────────────────────────────────────
import { computed, type ComputedRef, type Ref, unref } from 'vue'
import type { PermitApplication, Consultation } from '@/services/developmentManagementService'

export type StageStatus = 'done' | 'active' | 'pending'
export type RoleKey = 'citizen' | 'planning_clerk' | 'gis_officer' | 'planner' | 'eo'

export interface PipelineStage {
  key: string
  label: string
  role: RoleKey
  roleLabel: string
  description: string
  status: StageStatus
  evidence: string | null
}

// Canonical backend statuses (the permit_application CHECK constraint,
// migrations 070 + 085). This union is THE status model for the frontend —
// every role surface normalises into it rather than keeping its own vocabulary.
//
// `awaiting_eo_decision` was missing here while the backend accepted it and the
// EO inbox filtered on it, so a permit sitting on the EO's desk fell through
// normalizeStatus() as an unrecognised value and drew the wrong pipeline stage
// (review §7).
export type CanonicalStatus =
  | 'pending_payment' | 'registered' | 'acknowledged' | 'circulation'
  | 'objection_period' | 'under_review' | 'awaiting_eo_decision' | 'deferred'
  | 'approved' | 'approved_with_conditions' | 'refused'
  | 'withdrawn' | 'appealed'

// Legacy / loosely-typed frontend values → canonical backend values. The old
// frontend PermitStatus union used some strings the backend never accepts
// (e.g. 'conditionally_approved' would 400 on the status route), so normalise.
const LEGACY_TO_CANONICAL: Record<string, CanonicalStatus> = {
  consultation: 'circulation',
  conditionally_approved: 'approved_with_conditions',
  appeal: 'appealed',
  pending_docs: 'registered',
  lapsed: 'refused',
}

export function normalizeStatus(s: string | null | undefined): CanonicalStatus {
  if (!s) return 'registered'
  return (LEGACY_TO_CANONICAL[s] ?? s) as CanonicalStatus
}

const STATUS_LABELS: Record<string, string> = {
  pending_payment: 'Pending payment', registered: 'Registered',
  acknowledged: 'Acknowledged', circulation: 'In circulation',
  objection_period: 'Objection period', under_review: 'Under review',
  awaiting_eo_decision: 'Awaiting EO decision',
  deferred: 'Deferred', approved: 'Approved',
  approved_with_conditions: 'Approved with conditions', refused: 'Refused',
  withdrawn: 'Withdrawn', appealed: 'Under appeal',
}

export function statusLabel(s: string | null | undefined): string {
  const c = normalizeStatus(s)
  return STATUS_LABELS[c] ?? c.replace(/_/g, ' ')
}

const DEV_TYPE_LABELS: Record<string, string> = {
  new_building: 'New building', alteration: 'Alteration', extension: 'Extension',
  change_of_use: 'Change of use', subdivision: 'Subdivision', consolidation: 'Consolidation',
  rezoning: 'Rezoning', other: 'Other',
}

export function devTypeLabel(t: string | null | undefined): string {
  if (!t) return '—'
  return DEV_TYPE_LABELS[t] ?? t.charAt(0).toUpperCase() + t.slice(1).replace(/_/g, ' ')
}

/**
 * The reference an officer reads out on the phone. Every screen used to fall
 * back to a slice of the row UUID ("3a414869-83ed"), which means nothing to
 * anyone and cannot be searched for. An application without a register number
 * or TPD reference is said to be unregistered, which is the true state.
 */
export function caseRef(p: { dev_register_no?: string | null; tpd_reference?: string | null }): string {
  return p.dev_register_no || p.tpd_reference || 'Unregistered'
}

/** "1" → "Ward 1"; anything already descriptive is left alone. */
export function wardLabel(w: string | null | undefined): string {
  const v = (w ?? '').trim()
  if (!v) return 'Ward not recorded'
  return /^\d+$/.test(v) ? `Ward ${v}` : v
}

/** Permit has a determination that allows construction-stage work. */
export function isPermitApproved(status: string | null | undefined): boolean {
  const s = normalizeStatus(status)
  return s === 'approved' || s === 'approved_with_conditions'
}

/** Permit is with specialists (technical circulation or planner review). */
export function isPermitInCirculation(status: string | null | undefined): boolean {
  const s = normalizeStatus(status)
  return s === 'circulation' || s === 'under_review'
}

/** Match a referral to a specialist desk. Planner body_name is free text. */
export function matchesReferralDepartment(
  consultation: { body_name?: string | null; department?: string | null },
  needles: readonly string[],
): boolean {
  const hay = `${consultation.body_name || ''} ${consultation.department || ''}`.toLowerCase()
  return needles.some(n => hay.includes(n.toLowerCase()))
}

// Which pipeline stage index a given status currently sits at.
const STATUS_STAGE_INDEX: Record<CanonicalStatus, number> = {
  pending_payment: 0,            // SUBMITTED
  registered: 1,                 // INTAKE
  acknowledged: 2,               // CIRCULATION (intake done)
  circulation: 2,                // CIRCULATION
  objection_period: 3,           // OBJECTIONS
  under_review: 4,               // ASSESSMENT
  // The planner has finished and the file is on the EO's desk: the case has
  // left assessment and is sitting in determination, waiting on the EO.
  awaiting_eo_decision: 5,       // DETERMINATION
  deferred: 5,                   // DETERMINATION (EO sent it back)
  approved: 6,                   // OUTCOME
  approved_with_conditions: 6,   // OUTCOME
  refused: 6,                    // OUTCOME
  withdrawn: 6,                  // OUTCOME (terminal)
  appealed: 5,                   // back at DETERMINATION on appeal
}

const TERMINAL: CanonicalStatus[] =
  ['approved', 'approved_with_conditions', 'refused', 'withdrawn']

interface StageDef { key: string; label: string; role: RoleKey; roleLabel: string; description: string }

export const STAGE_DEFS: readonly StageDef[] = [
  { key: 'submitted',   label: 'Submitted',        role: 'citizen',        roleLabel: 'Citizen',        description: 'Application lodged' },
  { key: 'intake',      label: 'Intake',           role: 'planning_clerk', roleLabel: 'Planning Clerk', description: 'Validated & acknowledged' },
  { key: 'circulation', label: 'Technical review', role: 'gis_officer',    roleLabel: 'GIS · Surveyor · Env · Inspector', description: 'Circulated to specialists' },
  { key: 'objections',  label: 'Objection period', role: 'planning_clerk', roleLabel: 'Public · Clerk', description: 'Public notice & objections' },
  { key: 'assessment',  label: 'Planner review',   role: 'planner',        roleLabel: 'Planner',        description: 'Assessment & recommendation' },
  { key: 'decision',    label: 'Determination',    role: 'eo',             roleLabel: 'EO Planner',     description: 'Final decision · RTCP Act s.26' },
  { key: 'outcome',     label: 'Outcome',          role: 'citizen',        roleLabel: 'Citizen',        description: 'Outcome issued to applicant' },
] as const

// Allowed forward (and appeal) transitions — mirrors the spirit of the backend
// status route. The backend remains the authority; this drives UI affordances
// and validation only.
export const ALLOWED_TRANSITIONS: Record<CanonicalStatus, CanonicalStatus[]> = {
  pending_payment:          ['registered', 'withdrawn'],
  registered:               ['acknowledged', 'withdrawn'],
  acknowledged:             ['circulation', 'under_review', 'withdrawn'],
  circulation:              ['objection_period', 'under_review', 'withdrawn'],
  objection_period:         ['under_review', 'withdrawn'],
  // The planner hands the file up rather than determining it themselves; the
  // direct under_review → approved/refused edges stay only because the backend
  // still accepts them (see the split-determination note in the review).
  under_review:             ['awaiting_eo_decision', 'deferred', 'approved', 'approved_with_conditions', 'refused', 'withdrawn'],
  awaiting_eo_decision:     ['deferred', 'approved', 'approved_with_conditions', 'refused', 'withdrawn'],
  deferred:                 ['under_review', 'approved', 'approved_with_conditions', 'refused'],
  approved:                 ['appealed'],
  approved_with_conditions: ['appealed'],
  refused:                  ['appealed'],
  withdrawn:                [],
  appealed:                 ['approved', 'approved_with_conditions', 'refused'],
}

// Roles that typically perform the transition INTO a given status. The EO
// Planner alone determines (approve/refuse/defer); the planner advances review.
export const TRANSITION_ROLES: Partial<Record<CanonicalStatus, RoleKey[]>> = {
  registered:               ['planning_clerk', 'planner'],
  acknowledged:             ['planning_clerk'],
  circulation:              ['planner', 'planning_clerk'],
  objection_period:         ['planning_clerk', 'planner'],
  under_review:             ['planner'],
  // The planner refers up; only the EO records the determination itself.
  awaiting_eo_decision:     ['planner'],
  deferred:                 ['eo'],
  approved:                 ['eo'],
  approved_with_conditions: ['eo'],
  refused:                  ['eo'],
}

export function nextStatuses(s: string | null | undefined): CanonicalStatus[] {
  return ALLOWED_TRANSITIONS[normalizeStatus(s)] ?? []
}

function evidenceFor(
  key: string, permit: PermitApplication, canonical: CanonicalStatus, consultations?: Consultation[],
): string | null {
  switch (key) {
    case 'circulation': {
      if (consultations && consultations.length) {
        const responded = consultations.filter(c => {
          const r = c.response_status ?? c.outcome
          return r && r !== 'pending'
        }).length
        return `${responded}/${consultations.length} referrals responded`
      }
      return null
    }
    case 'assessment':
      return permit.recommendation
        ? `Recommendation: ${String(permit.recommendation).replace(/_/g, ' ')}`
        : null
    case 'decision':
      return (['approved', 'approved_with_conditions', 'refused', 'deferred', 'awaiting_eo_decision'] as CanonicalStatus[])
        .includes(canonical) ? statusLabel(canonical) : null
    case 'outcome':
      return TERMINAL.includes(canonical) ? statusLabel(canonical) : null
    default:
      return null
  }
}

export interface BuildOpts { consultations?: Consultation[] }

/** Pure builder: cross-role stages for a permit (or an empty/pending skeleton). */
export function buildPipeline(permit: PermitApplication | null, opts: BuildOpts = {}): PipelineStage[] {
  if (!permit) {
    return STAGE_DEFS.map(d => ({ ...d, status: 'pending' as StageStatus, evidence: null }))
  }
  const canonical = normalizeStatus(permit.status)
  const currentIndex = STATUS_STAGE_INDEX[canonical] ?? 1
  const isTerminal = TERMINAL.includes(canonical)

  return STAGE_DEFS.map((d, i) => {
    let status: StageStatus
    if (isTerminal) status = 'done'           // reached a final outcome
    else if (i < currentIndex) status = 'done'
    else if (i === currentIndex) status = 'active'
    else status = 'pending'
    return { ...d, status, evidence: evidenceFor(d.key, permit, canonical, opts.consultations) }
  })
}

/** Reactive wrapper for components/composables. */
export function useApplicationPipeline(
  permit: Ref<PermitApplication | null> | (() => PermitApplication | null),
  consultations?: Ref<Consultation[]> | (() => Consultation[]),
): { stages: ComputedRef<PipelineStage[]>; currentStatus: ComputedRef<CanonicalStatus | null> } {
  const getPermit = () => (typeof permit === 'function' ? permit() : unref(permit))
  const getConsults = () => (consultations ? (typeof consultations === 'function' ? consultations() : unref(consultations)) : undefined)
  const stages = computed(() => buildPipeline(getPermit(), { consultations: getConsults() }))
  const currentStatus = computed(() => {
    const p = getPermit()
    return p ? normalizeStatus(p.status) : null
  })
  return { stages, currentStatus }
}
