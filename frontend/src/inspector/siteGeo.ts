/**
 * Pure helpers for the inspector's spatial views: the words for what the
 * server's site checks mean, map status classes, and day-run ordering.
 *
 * Wording is fixed here, not per component, so the site map, the report and the
 * stage console never describe the same verdict two different ways.
 */

import { haversineMetres } from '@/composables/useInspectionNavigation'
import { annexureStageName } from './architecture'
import type {
  CoarseArea,
  ConstraintStatus,
  GeofenceResult,
  GeoVerdict,
  IdentifyAssessment,
  PositionSource,
  SitePointProps,
  SitePrecision,
  SiteSource,
} from '@/services/inspectorGis'

export type Tone = 'neutral' | 'info' | 'positive' | 'warning' | 'negative'

export interface Copy {
  tone: Tone
  label: string
  detail: string
}

// ── site position ─────────────────────────────────────────────────────

export function precisionCopy(precision: SitePrecision, coarseArea?: CoarseArea | null): Copy {
  switch (precision) {
    case 'boundary':
      return { tone: 'positive', label: 'Stand boundary known', detail: 'Site checks, coverage and attendance use the stand boundary.' }
    case 'point':
      return { tone: 'info', label: 'Position only', detail: 'No stand boundary is registered. Checks run from a single position.' }
    case 'area':
      return {
        tone: 'warning',
        label: 'Not positioned',
        detail: coarseArea
          ? `Only known to lie within ${coarseArea.label}${coarseArea.areaHa != null ? ` (${formatHectares(coarseArea.areaHa)})` : ''}. Record the site position.`
          : 'Only a large cadastral area is known. Record the site position.',
      }
    default:
      return { tone: 'negative', label: 'Not located', detail: 'Neither the permit nor the registers locate this site. Record the site position.' }
  }
}

/** True when the site has a position an inspector can navigate to and be geofenced against. */
export function isPositioned(precision: SitePrecision | null | undefined): boolean {
  return precision === 'boundary' || precision === 'point'
}

const SOURCE_LABELS: Record<SiteSource, string> = {
  stands_register: 'Stands Register',
  cadastre: 'Cadastre parcel',
  permit_location: 'Permit position',
  cadastre_area: 'Cadastral area',
  none: 'None',
}

export function sourceLabel(source: SiteSource | null | undefined): string {
  return source ? SOURCE_LABELS[source] ?? source : '—'
}

const POSITION_SOURCE_LABELS: Record<PositionSource, string> = {
  intake: 'Captured at application',
  case_file: 'Planner case file',
  field_gps: 'GPS at site',
  map_pick: 'Picked on map',
}

export function positionSourceLabel(source: PositionSource | null | undefined): string {
  return source ? POSITION_SOURCE_LABELS[source] ?? source : 'Not recorded'
}

// ── checks ────────────────────────────────────────────────────────────

export function constraintCopy(status: ConstraintStatus): Copy {
  switch (status) {
    case 'conflict': return { tone: 'negative', label: 'Conflict', detail: 'The site overlaps this feature.' }
    case 'review': return { tone: 'warning', label: 'Check on site', detail: 'Within the review distance.' }
    case 'no_data': return { tone: 'neutral', label: 'No data', detail: 'This layer is not loaded. It has not been checked.' }
    default: return { tone: 'positive', label: 'Clear', detail: 'Nothing within the review distance.' }
  }
}

/** Conflicts first, then reviews, then missing data, then clear; stable within a group. */
export function sortConstraints<T extends { status: ConstraintStatus }>(rows: readonly T[]): T[] {
  const rank: Record<ConstraintStatus, number> = { conflict: 0, review: 1, no_data: 2, clear: 3 }
  return rows
    .map((row, i) => ({ row, i }))
    .sort((a, b) => rank[a.row.status] - rank[b.row.status] || a.i - b.i)
    .map(x => x.row)
}

export function assessmentCopy(a: IdentifyAssessment): Copy {
  switch (a) {
    case 'outside_jurisdiction':
      return { tone: 'neutral', label: 'Outside council area', detail: 'This point is outside the council planning boundary.' }
    case 'permitted_case':
      return { tone: 'positive', label: 'Approved case here', detail: 'An approved building-control case is linked to this spot.' }
    case 'case_not_approved':
      return { tone: 'warning', label: 'Case not yet approved', detail: 'A case is linked to this spot, but no approval is recorded.' }
    case 'structure_without_case':
      return {
        tone: 'negative',
        label: 'Structure with no linked case',
        detail: 'A mapped structure stands here and no building-control case is linked to it. Check whether it is authorised.',
      }
    default:
      return { tone: 'neutral', label: 'No case here', detail: 'No building-control case or mapped structure at this spot.' }
  }
}

export function geofenceCopy(result: GeofenceResult | null | undefined): Copy {
  switch (result) {
    case 'on_site': return { tone: 'positive', label: 'On site', detail: 'The position was within the site tolerance.' }
    case 'off_site': return { tone: 'negative', label: 'Away from site', detail: 'The position was outside the site tolerance.' }
    case 'unverifiable': return { tone: 'neutral', label: 'Cannot verify', detail: 'The site has no usable position, or the fix was too coarse.' }
    default: return { tone: 'neutral', label: 'No position', detail: 'No GPS fix was recorded.' }
  }
}

export function geoVerdictCopy(verdict: GeoVerdict): Copy {
  switch (verdict) {
    case 'consistent':
      return { tone: 'positive', label: 'Positions consistent', detail: 'Recorded positions place the inspection on site.' }
    case 'discrepancy':
      return { tone: 'negative', label: 'Position discrepancy', detail: 'At least one recorded position is away from the site. Review before relying on this inspection.' }
    case 'insufficient':
      return { tone: 'warning', label: 'No positional evidence', detail: 'No arrival fix or geotagged photograph has been recorded.' }
    default:
      return { tone: 'neutral', label: 'Cannot verify', detail: 'The site is not positioned, so attendance cannot be checked.' }
  }
}

// ── map status ────────────────────────────────────────────────────────

export type SiteStatusClass = 'enforcement' | 'failed' | 'overdue' | 'due' | 'occupied' | 'active' | 'awaiting'

const APPROVED = new Set(['approved', 'approved_with_conditions'])

/**
 * One class per site for map symbology and the legend. Priority order matters:
 * an open enforcement order outranks everything, an overdue visit outranks a
 * routine one.
 */
export function siteStatusClass(p: Pick<SitePointProps,
  'openEnforcement' | 'lastResult' | 'hasOccupationCertificate' | 'permitStatus' | 'scheduledAt' | 'inspectedAt'>,
  now: Date = new Date(),
): SiteStatusClass {
  if (p.openEnforcement > 0) return 'enforcement'
  if (p.hasOccupationCertificate) return 'occupied'
  if (!APPROVED.has(p.permitStatus)) return 'awaiting'
  if (p.lastResult === 'fail' || p.lastResult === 'reinspection_required') return 'failed'
  if (p.scheduledAt && !p.inspectedAt) {
    const due = new Date(p.scheduledAt)
    if (!Number.isNaN(due.getTime())) {
      const today = startOfDay(now)
      if (startOfDay(due) < today) return 'overdue'
      if (startOfDay(due).getTime() === today.getTime()) return 'due'
    }
  }
  return 'active'
}

export const SITE_STATUS_LABELS: Record<SiteStatusClass, string> = {
  enforcement: 'Open enforcement',
  failed: 'Failed / re-inspection',
  overdue: 'Inspection overdue',
  due: 'Inspection due today',
  active: 'Approved, inspections open',
  occupied: 'Occupation certificate issued',
  awaiting: 'Not yet approved',
}

/** Token each class is painted with. Read at runtime so the map follows the theme. */
export const SITE_STATUS_TOKENS: Record<SiteStatusClass, string> = {
  enforcement: '--ent-danger',
  failed: '--ent-danger',
  overdue: '--ent-warning',
  due: '--ent-warning',
  active: '--ent-success',
  occupied: '--ent-info',
  awaiting: '--ent-text-3',
}

/**
 * The Annexure 12 stage a site is at, from its latest stage inspection only.
 * A passed stage advances; a failed or unresulted one is repeated. This is a
 * map label — the stage console computes eligibility from the full history.
 */
export function nextStageFor(p: Pick<SitePointProps, 'lastStage' | 'lastResult' | 'hasOccupationCertificate'>): {
  stage: number | null
  label: string
} {
  if (p.hasOccupationCertificate) return { stage: null, label: 'Occupation certificate issued' }
  if (p.lastStage == null) return { stage: 1, label: `Stage 1 · ${annexureStageName(1)}` }
  const passed = p.lastResult === 'pass' || p.lastResult === 'conditional_pass'
  const stage = passed ? Math.min(p.lastStage + 1, 9) : p.lastStage
  const repeat = p.lastResult === 'fail' || p.lastResult === 'reinspection_required'
  return { stage, label: `Stage ${stage} · ${annexureStageName(stage)}${repeat ? ' (re-inspection)' : ''}` }
}

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

// ── day run ───────────────────────────────────────────────────────────

export interface RunStop {
  id: string
  center: [number, number]   // [lng, lat]
}

export interface RunLeg<T extends RunStop> {
  stop: T
  legM: number
  cumulativeM: number
}

/**
 * Nearest-neighbour ordering from a start position. Straight-line legs: there is
 * no routable road network, and callers must label distances as such. Good
 * enough to sequence a day's visits; not a shortest-route guarantee.
 */
export function planRun<T extends RunStop>(start: [number, number], stops: readonly T[]): RunLeg<T>[] {
  const remaining = stops.filter(s => Array.isArray(s.center)
    && Number.isFinite(s.center[0]) && Number.isFinite(s.center[1]))
  const legs: RunLeg<T>[] = []
  let here = start
  let total = 0
  while (remaining.length) {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = distanceM(here, remaining[i].center)
      if (d < bestD) { bestD = d; best = i }
    }
    const [stop] = remaining.splice(best, 1)
    total += bestD
    legs.push({ stop, legM: bestD, cumulativeM: total })
    here = stop.center
  }
  return legs
}

export function distanceM(a: [number, number], b: [number, number]): number {
  return haversineMetres({ lng: a[0], lat: a[1] }, { lng: b[0], lat: b[1] })
}

// ── formatting ────────────────────────────────────────────────────────

export function formatMetres(m: number | null | undefined): string {
  if (m == null || !Number.isFinite(m)) return '—'
  if (m < 1) return '< 1 m'
  if (m < 1000) return `${Math.round(m)} m`
  return `${(m / 1000).toFixed(1)} km`
}

export function formatSqm(m2: number | null | undefined): string {
  if (m2 == null || !Number.isFinite(m2)) return '—'
  if (m2 >= 10000) return formatHectares(m2 / 10000)
  return `${Math.round(m2).toLocaleString('en-GB')} m²`
}

export function formatHectares(ha: number | null | undefined): string {
  if (ha == null || !Number.isFinite(ha)) return '—'
  return `${ha >= 100 ? Math.round(ha).toLocaleString('en-GB') : ha.toFixed(ha >= 10 ? 1 : 2)} ha`
}

export function humanize(s: string | null | undefined): string {
  if (!s) return '—'
  const t = s.replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// ── constraints as evidence text ──────────────────────────────────────
/**
 * The site's constraint checks written out as findings an officer can paste
 * into a review, referral or report. Facts only: what was measured, against
 * which threshold, on whose authority — and, just as important, which layers
 * could not be checked at all.
 *
 * It never states a verdict. "Objection", "risk: high" and "EIA required" are
 * the officer's to decide; silently turning a measured distance into one of
 * them would put a determination in the machine's mouth. A layer that is
 * missing reads "not checked", never "clear" — the difference is the whole
 * point of `no_data`.
 */
export function describeConstraints(report: {
  generatedAt: string
  site: { precision: SitePrecision }
  constraints: readonly SiteConstraintLike[]
} | null | undefined, now: (iso: string) => string = defaultWhen): string {
  if (!report) return ''
  const all = report.constraints ?? []
  const flagged = sortConstraints(all).filter(c => c.status === 'conflict' || c.status === 'review')

  const lines = flagged.map((c) => {
    const where = c.distanceM == null ? 'overlaps the site' : `${formatMetres(c.distanceM)} from the site`
    const named = c.feature?.name ? ` (${c.feature.name})` : ''
    const basis = c.basis === 'statutory' ? c.reference : `council review distance, ${c.reference}`
    return `• ${c.label}${named}: ${where} — threshold ${c.thresholdM} m, ${basis}.`
  })

  if (!lines.length) {
    const checked = all.filter(c => c.status !== 'no_data').length
    lines.push(checked
      ? `• No mapped constraint within its screening distance (${checked} layer${checked === 1 ? '' : 's'} checked).`
      : '• No constraint layers were available for this site.')
  }

  const noData = all.filter(c => c.status === 'no_data')
  if (noData.length) {
    lines.push(`• Not checked (layer unavailable): ${noData.map(c => c.label).join(', ')}.`)
  }

  return `Site screening ${now(report.generatedAt)} — position ${report.site.precision}:\n${lines.join('\n')}`
}

interface SiteConstraintLike {
  label: string
  basis: 'statutory' | 'council_review'
  reference: string
  thresholdM: number
  status: ConstraintStatus
  distanceM: number | null
  feature: { name: string | null } | null
}

function defaultWhen(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? 'date unknown' : d.toLocaleString('en-GB')
}
