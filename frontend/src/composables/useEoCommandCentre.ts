// ─── useEoCommandCentre ──────────────────────────────────────────────
// Real-data layer for the EO Planner Command Centre (/eo-planner).
//
// Replaces the view's hardcoded demo arrays. Everything here is derived
// from the canonical Development-Management spine via dmApi:
//   - permits     → GET /api/permit-applications (spatial_planning.permit_application)
//   - enforcement → GET /api/enforcement-orders   (spatial_planning.enforcement_order)
//
// The pure `derive*` functions take plain arrays so they can be unit-tested
// without a backend (see useEoCommandCentre.spec.ts). The composable wraps
// them in reactive state plus a `decide()` action that transitions a permit's
// status (RTCP Act s.26 determination — backed by the role widened in B1).
// ─────────────────────────────────────────────────────────────────────

import { ref, computed, type Ref } from 'vue'
import {
  dmApi,
  type PermitApplication,
  type EnforcementOrder,
} from '@/services/developmentManagementService'
import { STATUTORY_DETERMINATION_DAYS } from '@/services/eoPlannerService'
import { isPermitApproved, normalizeStatus } from '@/composables/useApplicationPipeline'

const DAY_MS = 86_400_000

function isActionableStatus(status: string): boolean {
  const s = normalizeStatus(status)
  return s === 'registered' || s === 'acknowledged' || s === 'circulation'
    || s === 'objection_period' || s === 'under_review' || s === 'deferred'
    || s === 'awaiting_eo_decision' || s === 'pending_payment' || s === 'appealed'
}

function isDecidedStatus(status: string): boolean {
  const s = normalizeStatus(status)
  return s === 'approved' || s === 'approved_with_conditions' || s === 'refused' || s === 'withdrawn'
}

// A determination is NOT made here. The command centre used to transition a
// permit's status directly, which produced an approval with no conditions, no
// reasons and no decision letter. Determinations are made once, in the
// console's Determination section, through POST /eo-decision — this module now
// only reads and summarises. The mapping from decision to status lives in the
// backend, where the statutory transition table already is.

// Proposal/queue stage chip key derived from a raw permit status, so the UI
// is resilient to either status vocabulary the backend may emit.
export function stageForStatus(status: string): string {
  switch (normalizeStatus(status)) {
    case 'approved':
    case 'approved_with_conditions':
      return 'approved'
    case 'refused':
      return 'rejected'
    case 'circulation':
      return 'circulating'
    case 'objection_period':
      return 'conflict_check'
    case 'withdrawn':
      return 'draft'
    default:
      return 'awaiting_eo'
  }
}

function whenReceived(p: PermitApplication): number {
  const iso = p.received_at || p.created_at
  return iso ? new Date(iso).getTime() : Date.now()
}

function daysWaiting(p: PermitApplication, now = Date.now()): number {
  return Math.max(0, Math.floor((now - whenReceived(p)) / DAY_MS))
}

function daysToDeemed(p: PermitApplication, now = Date.now()): number | null {
  if (!p.received_at) return null
  return Math.round(STATUTORY_DETERMINATION_DAYS - (now - new Date(p.received_at).getTime()) / DAY_MS)
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-ZW', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Split a free-text suburb_ward ("Ward 4 — Lalapanzi", "4", "Lalapanzi") into a
// stable grouping key + a human label for the ward-activity panel.
export function parseWard(suburbWard: string | null | undefined): { key: string; label: string } {
  const raw = (suburbWard || '').trim()
  if (!raw) return { key: 'unknown', label: 'Unassigned ward' }
  const m = raw.match(/ward\s*(\d+)\s*(?:[—\-–:]\s*(.+))?/i)
  if (m) return { key: `w${m[1]}`, label: m[2] ? `Ward ${m[1]} — ${m[2]}` : `Ward ${m[1]}` }
  if (/^\d+$/.test(raw)) return { key: `w${raw}`, label: `Ward ${raw}` }
  return { key: raw.toLowerCase(), label: raw }
}

// ─── Derived view-models (pure — unit tested) ────────────────────────

export interface EoMetrics {
  pendingApprovals: number
  activeProjects: number
  envViolations: number
  avgTurnaroundDays: number | null
  // Gaps — no backend feed yet; surfaced as null so the UI shows an honest
  // "not yet available" state instead of a fabricated figure.
  revenueThisMonth: null
  standsAllocatedYtd: null
}

export function deriveMetrics(
  permits: PermitApplication[],
  enforcement: EnforcementOrder[],
): EoMetrics {
  const pendingApprovals = permits.filter(p => isActionableStatus(p.status)).length
  const activeProjects = permits.filter(p => !isDecidedStatus(p.status)).length
  const envViolations = enforcement.filter(e => e.status === 'active' || e.status === 'extended' || e.status === 'appealed').length

  // Average turnaround = days from received → decision for decided permits.
  const turnarounds = permits
    .filter(p => (isPermitApproved(p.status) || normalizeStatus(p.status) === 'refused') && p.received_at)
    .map(p => (new Date(p.updated_at).getTime() - new Date(p.received_at as string).getTime()) / DAY_MS)
    .filter(d => Number.isFinite(d) && d >= 0)
  const avgTurnaroundDays = turnarounds.length
    ? Math.round((turnarounds.reduce((s, d) => s + d, 0) / turnarounds.length) * 10) / 10
    : null

  return {
    pendingApprovals, activeProjects, envViolations, avgTurnaroundDays,
    revenueThisMonth: null, standsAllocatedYtd: null,
  }
}

export interface QueueItem {
  id: string                 // permit id (used for actions)
  ref: string                // human reference (dev_register_no / short id)
  title: string
  type: string
  ward: string
  daysWaiting: number
  daysToDeemed: number | null
  priority: 'urgent' | 'high' | 'medium' | 'low'
  submittedBy: string
  date: string
  flags: string[]
  status: string
}

function priorityFor(daysWait: number, toDeemed: number | null): QueueItem['priority'] {
  if (toDeemed != null && toDeemed <= 7) return 'urgent'
  if (toDeemed != null && toDeemed <= 14) return 'high'
  if (daysWait > 21) return 'urgent'
  if (daysWait > 14) return 'high'
  if (daysWait > 7) return 'medium'
  return 'low'
}

const DEV_TYPE_LABELS: Record<string, string> = {
  new_building: 'New Building', alteration: 'Alteration', extension: 'Extension',
  change_of_use: 'Change of Use', subdivision: 'Subdivision', consolidation: 'Consolidation',
  rezoning: 'Rezoning', other: 'Other',
}

export function deriveQueue(permits: PermitApplication[], now = Date.now()): QueueItem[] {
  return permits
    .filter(p => isActionableStatus(p.status))
    .map(p => {
      const wait = daysWaiting(p, now)
      const toDeemed = daysToDeemed(p, now)
      const flags: string[] = []
      if (toDeemed != null && toDeemed <= 14) flags.push(`${toDeemed} d to deemed refusal`)
      if (!p.fee_paid) flags.push('Fee unpaid')
      return {
        id: p.id,
        ref: p.dev_register_no || p.tpd_reference || p.id.slice(0, 8).toUpperCase(),
        title: p.description || `${DEV_TYPE_LABELS[p.development_type] ?? p.development_type} — Stand ${p.stand_number}`,
        type: DEV_TYPE_LABELS[p.development_type] ?? p.development_type,
        ward: parseWard(p.suburb_ward).label,
        daysWaiting: wait,
        daysToDeemed: toDeemed,
        priority: priorityFor(wait, toDeemed),
        submittedBy: p.applicant_name,
        date: fmtDate(p.received_at || p.created_at),
        flags,
        status: p.status,
      }
    })
    .sort((a, b) => (a.daysToDeemed ?? 9999) - (b.daysToDeemed ?? 9999))
}

export interface ProposalCard {
  id: string
  ref: string
  title: string
  ward: string
  stand: string
  type: string
  date: string
  stage: string
  flags: string[]
  status: string
}

export function deriveProposals(permits: PermitApplication[]): ProposalCard[] {
  return permits.map(p => ({
    id: p.id,
    ref: p.dev_register_no || p.tpd_reference || p.id.slice(0, 8).toUpperCase(),
    title: p.description || `${DEV_TYPE_LABELS[p.development_type] ?? p.development_type} — Stand ${p.stand_number}`,
    ward: parseWard(p.suburb_ward).label,
    stand: p.stand_number || '—',
    type: DEV_TYPE_LABELS[p.development_type] ?? p.development_type,
    date: fmtDate(p.received_at || p.created_at),
    stage: stageForStatus(p.status),
    flags: p.fee_paid ? [] : ['Fee unpaid'],
    status: p.status,
  }))
}

export interface WardActivityRow {
  key: string
  label: string
  apps: number
  violations: number
}

export function deriveWardActivity(
  permits: PermitApplication[],
  enforcement: EnforcementOrder[],
): WardActivityRow[] {
  const rows = new Map<string, WardActivityRow>()
  const bump = (sw: string | null | undefined, field: 'apps' | 'violations') => {
    const { key, label } = parseWard(sw)
    const row = rows.get(key) ?? { key, label, apps: 0, violations: 0 }
    row[field] += 1
    rows.set(key, row)
  }
  for (const p of permits) bump(p.suburb_ward, 'apps')
  for (const e of enforcement) bump(e.suburb_ward, 'violations')
  return [...rows.values()]
    .filter(r => r.key !== 'unknown' || r.apps + r.violations > 0)
    .sort((a, b) => (b.apps + b.violations) - (a.apps + a.violations))
}

export interface StaffWorkloadRow {
  name: string
  role: string
  tasks: number
  pct: number
  load: string
  color: string
  initials: string
}

/** Role-desk load from live permits and enforcement. There is no named-officer assignment API. */
export function deriveStaffWorkload(
  permits: PermitApplication[],
  enforcement: EnforcementOrder[],
): StaffWorkloadRow[] {
  const desks: Array<{ name: string; role: string; color: string; initials: string; tasks: number }> = [
    {
      name: 'Town Planning', role: 'Planner / EO', color: '#1a73e8', initials: 'TP',
      tasks: permits.filter(p => isActionableStatus(p.status)).length,
    },
    {
      name: 'Planning Clerk', role: 'Registry', color: '#0f9d58', initials: 'PC',
      tasks: permits.filter(p => {
        const s = normalizeStatus(p.status)
        return s === 'registered' || s === 'acknowledged'
      }).length,
    },
    {
      name: 'Building Inspector', role: 'Inspections', color: '#f9ab00', initials: 'BI',
      tasks: permits.filter(p => isPermitApproved(p.status)).length,
    },
    {
      name: 'Environment', role: 'EHO', color: '#188038', initials: 'EH',
      tasks: enforcement.filter(o => o.status === 'active' || o.status === 'extended').length,
    },
    {
      name: 'GIS Officer', role: 'Mapping', color: '#7b61ff', initials: 'GIS',
      tasks: permits.filter(p => normalizeStatus(p.status) === 'circulation').length,
    },
  ]
  const max = Math.max(1, ...desks.map(d => d.tasks))
  return desks.map(d => {
    const pct = Math.round((d.tasks / max) * 100)
    const load = pct >= 80 ? 'high' : pct >= 40 ? 'medium' : 'low'
    return { ...d, pct, load }
  })
}

export interface ViolationRow {
  id: string                 // enforcement order id (for actions)
  ref: string
  description: string
  ward: string
  date: string
  reporter: string
  severity: 'critical' | 'high' | 'medium'
  resolved: boolean
  lng: number | null
  lat: number | null
  // Carried through so enforcement actions (Stop Work / Fine) can build a
  // valid backend payload — POST /enforcement-orders and /prohibition-orders
  // require subject_name + subject_address; stand_number anchors the order.
  standNumber: string
  subjectName: string
  subjectAddress: string
}

const HIGH_SEVERITY_TYPES = new Set(['stop_work', 'demolition', 'cessation', 'stop_notice', 'enforcement_notice'])

export function deriveViolations(enforcement: EnforcementOrder[]): ViolationRow[] {
  return enforcement.map(e => ({
    id: e.id,
    ref: e.order_reference,
    description: e.breach_description || e.required_action || 'Planning breach',
    ward: parseWard(e.suburb_ward).label,
    date: fmtDate(e.issued_at),
    reporter: e.owner_name || e.subject_name || 'Enforcement',
    severity: e.status === 'appealed'
      ? 'critical'
      : HIGH_SEVERITY_TYPES.has(e.order_type) ? 'high' : 'medium',
    resolved: e.status === 'complied' || e.status === 'cancelled',
    lng: e.longitude,
    lat: e.latitude,
    standNumber: e.stand_number || '',
    subjectName: e.subject_name || e.owner_name || 'Unknown',
    subjectAddress: e.subject_address || e.suburb_ward || '',
  }))
}

// ─── Reactive composable ─────────────────────────────────────────────

export function useEoCommandCentre() {
  const permits = ref<PermitApplication[]>([]) as Ref<PermitApplication[]>
  const enforcement = ref<EnforcementOrder[]>([]) as Ref<EnforcementOrder[]>
  const loading = ref(false)
  const error = ref<string | null>(null)

  async function refresh() {
    loading.value = true
    error.value = null
    try {
      const [permitRes, enf] = await Promise.all([
        dmApi.listPermits({ limit: 200, offset: 0 }),
        dmApi.listEnforcement().catch(() => [] as EnforcementOrder[]),
      ])
      permits.value = permitRes.data ?? []
      enforcement.value = enf ?? []
    } catch (e: any) {
      error.value = e?.response?.data?.error ?? e?.message ?? 'Failed to load EO data'
      permits.value = []
      enforcement.value = []
    } finally {
      loading.value = false
    }
  }

  const metrics = computed(() => deriveMetrics(permits.value, enforcement.value))
  const queue = computed(() => deriveQueue(permits.value))
  const proposals = computed(() => deriveProposals(permits.value))
  const wardActivity = computed(() => deriveWardActivity(permits.value, enforcement.value))
  const staffWorkload = computed(() => deriveStaffWorkload(permits.value, enforcement.value))
  const violations = computed(() => deriveViolations(enforcement.value))
  const urgentCount = computed(() => queue.value.filter(q => q.priority === 'urgent').length)

  return {
    permits, enforcement, loading, error,
    metrics, queue, proposals, wardActivity, staffWorkload, violations, urgentCount,
    refresh,
  }
}
