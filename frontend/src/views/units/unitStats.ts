// The figures each Executive Arm area shows, in one place, so the Chief Executive's card and the unit's own dashboard
// show the same words and the same numbers. A department whose register is empty says so and is never shown as zeros.
import type {
  AuditSection, EngineeringSection, LandSection, PlanningSection, SectionState, SocialServicesSection,
} from '@/services/executiveOverview'

export type Tone = 'warn' | 'bad' | 'good'
export interface Stat { label: string; value: string; tone?: Tone }
export interface Group { heading?: string; loaded: boolean; unavailable?: boolean; note?: string; stats: Stat[]; /** A caveat shown under the figures, e.g. an incomplete register. */ footnote?: string }

export const n = (v: number | undefined) => (v ?? 0).toLocaleString('en-GB')
export const share = (part: number | undefined, whole: number | undefined) =>
  whole ? `${Math.round(((part ?? 0) * 100) / whole)}%` : '—'
const flag = (v: number | undefined, tone: Tone): Tone | undefined => ((v ?? 0) > 0 ? tone : undefined)

/** A section that was not returned: the page could not read it. */
export const missing = (note: string, unavailable: boolean, heading?: string): Group =>
  ({ ...(heading ? { heading } : {}), loaded: false, unavailable, note, stats: [] })

export function planningGroup(pl: PlanningSection | undefined, fail: () => Group): Group {
  return pl ? {
    heading: 'Development control', loaded: pl.loaded, unavailable: pl.unavailable, note: pl.note,
    stats: [
      { label: 'Applications in progress', value: n(pl.in_progress) },
      { label: 'Past statutory due date', value: n(pl.overdue), tone: flag(pl.overdue, 'bad') },
      { label: 'Awaiting a decision', value: n(pl.awaiting_decision), tone: flag(pl.awaiting_decision, 'warn') },
      { label: 'Approved this year', value: n(pl.approved_this_year) },
      { label: 'Open building complaints', value: n(pl.open_building_complaints), tone: flag(pl.open_building_complaints, 'warn') },
    ],
  } : fail()
}

export function landGroup(ld: LandSection | undefined, fail: () => Group): Group {
  return ld ? {
    heading: 'Land register', loaded: ld.loaded, unavailable: ld.unavailable, note: ld.note,
    stats: [
      { label: 'Parcels on the register', value: n(ld.parcels) },
      { label: 'With a rates account', value: share(ld.parcels_with_account, ld.parcels) },
      { label: 'Outlines estimated, not surveyed', value: n(ld.estimated_boundaries), tone: flag(ld.estimated_boundaries, 'warn') },
    ],
  } : fail()
}

export function engineeringGroup(en: EngineeringSection | undefined, fail: () => Group): Group {
  if (!en) return fail()
  const km = (v: number | undefined) => (v ?? 0).toLocaleString('en-GB')
  // The roads in the register are map geometry, not a survey: say so when that is all there is.
  const unverified = (en.roads ?? 0) > 0 && en.roads_unverified === en.roads
  const incomplete = en.water_points_register_complete === false
  const stats: Stat[] = [
    { label: 'Council roads', value: `${n(en.roads)} (${km(en.road_km)} km${unverified ? ', unverified' : ''})` },
  ]
  if ((en.national_roads ?? 0) > 0) {
    stats.push({ label: "National roads (not the council's)", value: `${n(en.national_roads)} (${km(en.national_road_km)} km)` })
  }
  stats.push(
    {
      label: incomplete ? 'Water points recorded working' : 'Water points working',
      value: incomplete ? `${n(en.water_points_working)} of ${n(en.water_points)} recorded` : `${n(en.water_points_working)} of ${n(en.water_points)}`,
      tone: !incomplete && en.water_points && en.water_points_working! < en.water_points ? 'warn' : undefined,
    },
    { label: 'Council assets', value: n(en.council_assets) },
    { label: 'Capital projects in progress', value: n(en.projects_in_progress) },
  )
  const notes: string[] = []
  if (incomplete) {
    notes.push(en.water_points_register_note
      ?? `The water-point register is incomplete${en.water_points_expected ? ` (about ${en.water_points_expected} expected)` : ''}; its figures are what is recorded, not what exists.`)
  }
  if (unverified) notes.push('Roads are map geometry from OpenStreetMap, not a survey: they carry no surface or condition.')
  return { loaded: en.loaded, unavailable: en.unavailable, note: en.note, stats, ...(notes.length ? { footnote: notes.join(' ') } : {}) }
}

export function socialGroup(ss: SocialServicesSection | undefined, fail: () => Group): Group {
  return ss ? {
    loaded: ss.loaded, unavailable: ss.unavailable, note: ss.note,
    stats: [
      { label: 'Health premises registered', value: n(ss.premises) },
      { label: 'Fitness certificates due or expired', value: n(ss.certificates_due_or_expired), tone: flag(ss.certificates_due_or_expired, 'warn') },
      { label: 'Open nuisance complaints', value: n(ss.open_nuisance_complaints), tone: flag(ss.open_nuisance_complaints, 'warn') },
    ],
  } : fail()
}

export function hrGroup(hr: SectionState | undefined, fail: () => Group): Group {
  return hr ? { loaded: hr.loaded, unavailable: hr.unavailable, note: hr.note, stats: [] } : fail()
}

export function auditGroup(au: AuditSection | undefined, fail: () => Group): Group {
  return au ? {
    loaded: au.loaded, unavailable: au.unavailable, note: au.note,
    stats: [
      { label: 'Engagements open', value: `${n(au.engagements_open)} of ${n(au.engagements)}` },
      { label: 'Findings open', value: n(au.findings_open), tone: flag(au.findings_open, 'warn') },
      { label: 'High-risk findings', value: n(au.findings_high_risk), tone: flag(au.findings_high_risk, 'bad') },
      { label: 'Actions past their date', value: n(au.actions_overdue), tone: flag(au.actions_overdue, 'bad') },
    ],
  } : fail()
}
