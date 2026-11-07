// ─── Development approval tracks ─────────────────────────────────────────
// CityView-style "auto-generation of an approval track specific to the
// application type": when the planner picks a development type at intake, the
// system surfaces the required submittals (documents), the departments the
// application must be circulated to, whether a public hearing / objection
// period applies, and the legislated decision timeline.
//
// Keyed by the DM-Handbook development types (usePlannerCase.DevType). Pure
// reference data — no side effects — so it is trivially testable and shared.
// ─────────────────────────────────────────────────────────────────────────
import type { DevType } from '@/composables/usePlannerCase'

export interface SubmittalItem { key: string; label: string }

export interface DevelopmentTrack {
  type: DevType
  label: string
  /** Documents the applicant must lodge for this track (completeness check). */
  submittals: SubmittalItem[]
  /** Departments / statutory bodies this type must be circulated to. */
  referrals: string[]
  /** Whether a public hearing / objection period applies (special consent). */
  hearingRequired: boolean
  /** Legislated decision timeline in days (RTCP Act milestone). */
  statutoryDays: number
  note: string
}

// Submittals every application must lodge.
const COMMON: SubmittalItem[] = [
  { key: 'tpd1',          label: 'TPD1 application form (signed)' },
  { key: 'title_deed',    label: 'Title deed / proof of ownership' },
  { key: 'locality_plan', label: 'Locality plan' },
  { key: 'site_plan',     label: 'Site plan' },
  { key: 'fee_receipt',   label: 'Application fee receipt' },
]

const BUILDING: SubmittalItem[] = [
  { key: 'architectural',  label: 'Architectural drawings' },
  { key: 'structural',     label: 'Structural drawings' },
  { key: 'services_layout', label: 'Water & sewer connection layout' },
]

const SURVEY: SubmittalItem[] = [
  { key: 'survey_diagram', label: 'Surveyor-General diagram / general plan' },
  { key: 'layout_plan',    label: 'Proposed layout plan' },
  { key: 'services_report', label: 'Engineering services report' },
]

function track(
  type: DevType, label: string, extra: SubmittalItem[], referrals: string[],
  hearingRequired: boolean, statutoryDays: number, note: string,
): DevelopmentTrack {
  return { type, label, submittals: [...COMMON, ...extra], referrals, hearingRequired, statutoryDays, note }
}

export const DEVELOPMENT_TRACKS: Record<DevType, DevelopmentTrack> = {
  new_building: track('new_building', 'New building', BUILDING,
    ['GIS Officer', 'Building Inspector', 'Environmental Health'], false, 30,
    'Routine permit (s.26(1)) where compliant with the operative scheme.'),
  alteration: track('alteration', 'Alteration',
    [{ key: 'architectural', label: 'Architectural drawings (as-altered)' }],
    ['Building Inspector'], false, 30,
    'Building-operations approval; minimal circulation.'),
  extension: track('extension', 'Extension', BUILDING,
    ['GIS Officer', 'Building Inspector'], false, 30,
    'Routine permit where setbacks and coverage are met.'),
  change_of_use: track('change_of_use', 'Change of use',
    [{ key: 'use_motivation', label: 'Change-of-use motivation statement' },
     { key: 'parking_layout', label: 'Parking & access layout' }],
    ['GIS Officer', 'Environmental Health', 'Building Inspector'], true, 90,
    'Special consent (s.26(3)); public notice & objection period required.'),
  subdivision: track('subdivision', 'Subdivision', SURVEY,
    ['GIS Officer', 'Surveyor', 'Roads Authority', 'Water Authority', 'Environmental Agency'], true, 90,
    'Subdivision permit; survey diagram and services report mandatory.'),
  consolidation: track('consolidation', 'Consolidation', SURVEY,
    ['GIS Officer', 'Surveyor'], false, 90,
    'Consolidation of contiguous stands held in one ownership.'),
  rezoning: track('rezoning', 'Rezoning',
    [{ key: 'motivation_report', label: 'Planning motivation report' },
     { key: 'notice_proof', label: 'Proof of public notice' }],
    ['GIS Officer', 'Surveyor', 'Roads Authority', 'Water Authority', 'Environmental Agency'], true, 90,
    'Scheme amendment; full public participation required.'),
  other: track('other', 'Other', [],
    ['GIS Officer'], false, 90,
    'Officer to determine the applicable statutory track.'),
}

export function trackFor(type: DevType | string | null | undefined): DevelopmentTrack {
  return DEVELOPMENT_TRACKS[type as DevType] ?? DEVELOPMENT_TRACKS.other
}
