/**
 * Option A invariant for Building Control.
 *
 * Official inspection record: spatial_planning.stage_inspection
 * Citizen inspection_bookings: scheduling / payment only
 * planningWorkflow four-stage statuses: not official inspector state
 */

import type { PermitApplication } from '@/services/developmentManagementService'

export const OFFICIAL_INSPECTION_IDENTITY = 'spatial_planning.stage_inspection' as const

export const DEAD_BI_API_PREFIX = '/bi' as const

/** Annexure 12 — same catalogue as backend inspections.js STAGES. */
export const ANNEXURE_STAGES = [
  { number: 1, name: 'Setting out' },
  { number: 2, name: 'Foundation trenches and footing levels' },
  { number: 3, name: 'Foundation brickwork to floor level' },
  { number: 4, name: 'Brickwork and window level' },
  { number: 5, name: 'Brickwork to wall plate' },
  { number: 6, name: 'Roof trusses' },
  { number: 7, name: 'Drainage / sewerage work' },
  { number: 8, name: 'Final inspection' },
  { number: 9, name: 'Certificate of occupation' },
] as const

export const SHORT_WORKFLOW_STAGES = [
  'foundation_insp',
  'superstructure_insp',
  'roofing_insp',
  'final_insp',
] as const

export const OFFICIAL_INSPECTION_RESULTS = [
  'pass',
  'fail',
  'conditional_pass',
  'reinspection_required',
] as const

export type OfficialInspectionResult = (typeof OFFICIAL_INSPECTION_RESULTS)[number]

export const BOOKING_STATUSES = [
  'pending_payment',
  'waitlisted',
  'scheduled',
  'rescheduled',
  'in_progress',
  'passed',
  'failed',
  'cancelled',
] as const

export type BookingStatus = (typeof BOOKING_STATUSES)[number]

export const OFFICIAL_ENFORCEMENT_STATUSES = [
  'draft',
  'issued',
  'served',
  'complied',
  'non_complied',
  'withdrawn',
  'appealed',
] as const

export type OfficialEnforcementStatus = (typeof OFFICIAL_ENFORCEMENT_STATUSES)[number]

/** Legacy client aliases — never write these; map inbound API rows. */
export const LEGACY_ENFORCEMENT_ALIASES = ['active', 'extended', 'cancelled'] as const

export interface InspectorSite {
  permitId: string
  ref: string
  title: string
  stand: string
  ward: string
  applicant: string
  developmentType: string
  permitStatus: string
  hasOccupationCertificate: boolean
  lat: number | null
  lng: number | null
  /** Must stay undefined — Pinia workflow statuses are not official. */
  workflowStatus?: undefined
}

export function isOfficialInspectionResult(value: string): value is OfficialInspectionResult {
  return (OFFICIAL_INSPECTION_RESULTS as readonly string[]).includes(value)
}

export function isSchedulingStatus(value: string): value is BookingStatus {
  return (BOOKING_STATUSES as readonly string[]).includes(value)
}

export function inspectorMayIssueEnforcementOrder(): false {
  return false
}

export function normalizeEnforcementStatus(raw: string | null | undefined): OfficialEnforcementStatus | null {
  if (!raw) return null
  if (raw === 'active' || raw === 'extended') return 'issued'
  if (raw === 'cancelled') return 'withdrawn'
  if ((OFFICIAL_ENFORCEMENT_STATUSES as readonly string[]).includes(raw)) {
    return raw as OfficialEnforcementStatus
  }
  return null
}

export function officialEnforcementOpen(status: string | null | undefined): boolean {
  const s = normalizeEnforcementStatus(status)
  return s === 'draft' || s === 'issued' || s === 'served' || s === 'non_complied'
}

/**
 * The map pane used to POST stageNum * 100 + idx + 1. Catalogue ids in
 * migration 070 are 1–38 sequential. Anything ≥ 100 is not a real item.
 */
export function isSyntheticChecklistItemId(id: number): boolean {
  return Number.isInteger(id) && id >= 100
}

export function annexureStageName(n: number): string {
  return ANNEXURE_STAGES.find(s => s.number === n)?.name ?? `Stage ${n}`
}

export function nextAnnexureStageNumber(
  rows: Array<{ stage_number: number; attempt?: number | null; result?: string | null }>,
): number {
  const latest = new Map<number, { result?: string | null; attempt: number }>()
  for (const r of rows) {
    const attempt = r.attempt ?? 0
    const prev = latest.get(r.stage_number)
    if (!prev || attempt >= prev.attempt) {
      latest.set(r.stage_number, { result: r.result, attempt })
    }
  }
  for (let n = 1; n <= 9; n++) {
    const row = latest.get(n)
    if (!row || (row.result !== 'pass' && row.result !== 'conditional_pass')) return n
  }
  return 9
}

export function permitToInspectorSite(p: PermitApplication): InspectorSite {
  return {
    permitId: p.id,
    ref: p.dev_register_no || p.tpd_reference || p.id.slice(0, 8).toUpperCase(),
    title: p.description || `${String(p.development_type || 'development').replace(/_/g, ' ')} — Stand ${p.stand_number || '—'}`,
    stand: p.stand_number || '—',
    ward: p.suburb_ward || '—',
    applicant: p.applicant_name || '—',
    developmentType: p.development_type || '',
    permitStatus: p.status,
    hasOccupationCertificate: p.has_occupation_certificate === true,
    lat: p.lat ?? null,
    lng: p.lng ?? null,
  }
}

/**
 * Resolve a cadastral stand number (the `stands` tile layer's stand_number
 * attribute) to a site in the inspector's loaded set.
 *
 * Matching is trimmed and case-insensitive because the Stands Register and the
 * permit record are maintained by different desks — 'Somabula' and 'somabula '
 * are the same stand. Returns null when nothing matches, so the caller reports an
 * unresolved parcel honestly instead of opening the wrong case.
 */
export function matchSiteByStand<T extends { stand: string }>(
  sites: readonly T[],
  standNumber: string | null | undefined,
): T | null {
  const needle = String(standNumber ?? '').trim().toLowerCase()
  if (!needle) return null
  return sites.find(s => String(s.stand ?? '').trim().toLowerCase() === needle) ?? null
}

export function occupationIssueFailed(err: unknown): boolean {
  const status = (err as { response?: { status?: number } })?.response?.status
  const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
  return status === 409 || code === 'stages_not_passed'
}

export function parseOccupationIssueFailure(err: unknown): {
  issued: false
  error: string
  missingStages: number[]
} {
  const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data
  const message = data?.message || data?.error || 'Occupation certificate was not issued.'
  const missingStages: number[] = []
  const fromMessage = String(data?.message || '').match(/(\d+(?:\s*,\s*\d+)*)/)
  if (fromMessage) {
    for (const n of fromMessage[1].split(',')) {
      const v = Number(n.trim())
      if (Number.isInteger(v) && v >= 1 && v <= 9) missingStages.push(v)
    }
  }
  return { issued: false, error: message, missingStages }
}
