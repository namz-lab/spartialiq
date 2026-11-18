// The EO Planning's team at a glance: what each desk under the EO shows, in one place, so the tile and the desk
// in full use the same words and the same numbers (the same arrangement as views/units/unitStats.ts for the
// Chief Executive). Pure: no Vue state, no requests, so every rule here is testable on its own.
//
// TONE
//   bad   the law or a date has been missed: past the three months, a booked inspection past its date
//   warn  someone has to act and nobody has yet: a paid fee not acknowledged, a case with no planner
//   none  a count of work in hand, which is the desk's normal state
// A figure is flagged only when it is above zero, so a quiet desk shows no colour at all.
import type { Component } from 'vue'
import { Inbox, Users, HardHat, Leaf, MapPinned } from 'lucide-vue-next'
import { missing, n, type Group, type Stat, type Tone } from '@/views/units/unitStats'
import type { GlanceCard } from '@/components/shared/glance'
import type { PlanningTeam } from '@/services/planningTeam'
import type { SectionKey } from './console'

export type DeskKey = keyof PlanningTeam['desks']

export const DESK_KEYS: readonly DeskKey[] = ['clerk', 'planners', 'inspectors', 'environmental_health', 'gis_survey']

export function isDeskKey(v: unknown): v is DeskKey {
  return typeof v === 'string' && (DESK_KEYS as readonly string[]).includes(v)
}

/** Where a desk's work is seen in this console. The officers' own consoles are theirs; these are the EO's ways in. */
export interface DeskLink { section: SectionKey; label: string }

export interface TeamCard extends GlanceCard {
  key: DeskKey
  /** What the desk is for, under its title when it is open in full. */
  post: string
  links: DeskLink[]
}

/** A figure, carrying `tone` only when it is above zero. */
function stat(label: string, v: number | undefined, tone?: Tone, value = n(v)): Stat {
  return tone && (v ?? 0) > 0 ? { label, value, tone } : { label, value }
}

// The desk's figures are read by name; every field is optional (a desk not loaded has none).
type DeskFigures = Record<string, number | undefined> & { loaded: boolean; unavailable?: boolean; note?: string }

interface DeskSpec { title: string; post: string; icon: Component; links: DeskLink[]; groups: (d: DeskFigures, warningDays: number) => Group[] }

const DESKS: Record<DeskKey, DeskSpec> = {
  clerk: {
    title: 'Planning clerk', post: 'The counter: lodging, fees, acknowledgements, notices and sending decisions out', icon: Inbox,
    links: [{ section: 'register', label: 'Applications' }, { section: 'intake', label: 'Intake review' }, { section: 'notification', label: 'Public notice' }],
    groups: (d) => [
      { heading: 'At the counter', loaded: d.loaded, unavailable: d.unavailable, note: d.note, stats: [
        stat('Fee paid, not yet acknowledged', d.to_acknowledge, 'warn'),
        stat('Waiting for the applicant to pay', d.awaiting_fee),
        stat('Received this month', d.received_this_month),
      ] },
      { heading: 'Notices and decisions', loaded: d.loaded, unavailable: d.unavailable, note: d.note, stats: [
        stat('Objection periods ended, not closed', d.objection_periods_to_close, 'warn'),
        stat('Decisions not yet sent to the applicant', d.decisions_to_send, 'warn'),
        stat('Objection periods running', d.objection_periods_running),
      ] },
    ],
  },
  planners: {
    title: 'Planners', post: 'Assessment, circulation, objections and the report for your determination', icon: Users,
    links: [{ section: 'register', label: 'Applications' }, { section: 'diligence', label: 'Due diligence' }, { section: 'circulation', label: 'Circulation' }, { section: 'decision', label: 'Determination' }],
    groups: (d, days) => [
      { heading: 'Against the clock', loaded: d.loaded, unavailable: d.unavailable, note: d.note, stats: [
        stat('Past the three months', d.overdue, 'bad'),
        stat(`Within ${days} days of deemed refusal`, d.due_soon, 'warn'),
        stat('Waiting on your determination', d.with_the_eo, 'warn'),
      ] },
      { heading: 'Cases in hand', loaded: d.loaded, unavailable: d.unavailable, note: d.note, stats: [
        stat('Cases with the planners', d.in_hand),
        stat('Not assigned to a planner', d.unassigned, 'warn'),
        stat('Objections not yet considered', d.objections_to_consider, 'warn'),
        stat("Departments' replies overdue", d.replies_overdue, 'warn'),
        stat('Referrals past their reply date', d.referrals_overdue, 'warn'),
      ] },
    ],
  },
  inspectors: {
    title: 'Building inspectors', post: 'Stage inspections, building complaints and enforcement', icon: HardHat,
    links: [{ section: 'enforcement', label: 'Enforcement' }, { section: 'plans', label: 'Building plans' }, { section: 'permits', label: 'Permits' }],
    groups: (d) => [
      { heading: 'Stage inspections', loaded: d.loaded, unavailable: d.unavailable, note: d.note, stats: [
        stat('Past their booked date', d.past_their_date, 'bad'),
        stat('Booked with no inspector', d.without_inspector, 'warn'),
        stat('Booked, not yet done', d.booked),
        stat('Done this month', d.done_this_month),
      ] },
      { heading: 'Complaints and enforcement', loaded: d.loaded, unavailable: d.unavailable, note: d.note, stats: [
        stat('Complaints not yet assigned', d.complaints_unassigned, 'warn'),
        stat('Building complaints open', d.complaints_open),
        stat('Enforcement orders in force', d.enforcement_open),
      ] },
    ],
  },
  environmental_health: {
    title: 'Environmental health', post: 'Health premises, nuisance complaints and the health view on applications', icon: Leaf,
    links: [{ section: 'circulation', label: 'Circulation' }],
    groups: (d) => [
      { heading: 'Health registers', loaded: d.loaded, unavailable: d.unavailable, note: d.note, stats: [
        stat('Fitness certificates expired', d.certificates_expired, 'bad'),
        stat('Certificates due within 60 days', d.certificates_due, 'warn'),
        stat('Nuisance complaints open', d.nuisance_open, 'warn'),
        stat('Follow-up visits past their date', d.follow_ups_past, 'warn'),
        stat('Premises registered', d.premises),
      ] },
    ],
  },
  gis_survey: {
    title: 'GIS and survey', post: 'Survey tasks for applications, and the parcel register the planners read', icon: MapPinned,
    links: [{ section: 'circulation', label: 'Circulation' }],
    groups: (d) => [
      { heading: 'Survey tasks', loaded: d.loaded, unavailable: d.unavailable, note: d.note, stats: [
        stat('Past their due date', d.tasks_overdue, 'bad'),
        stat('Submitted, waiting for review', d.awaiting_review, 'warn'),
        stat('Open', d.tasks_open),
        stat('Returned for correction', d.returned),
      ] },
      { heading: 'Parcel register', loaded: d.loaded, unavailable: d.unavailable, note: d.note, stats: [
        stat('Outlines estimated, not surveyed', d.outlines_estimated, 'warn', `${n(d.outlines_estimated)} of ${n(d.parcels)}`),
      ] },
    ],
  },
}

/**
 * The five desks as tiles. Before the team has been read every desk is "being read"; when the read failed every
 * desk says so (and the page shows one error above them), so a failure is never drawn as an idle team.
 */
export function teamCards(team: PlanningTeam | null, state: { loading: boolean; error: string | null }): TeamCard[] {
  return DESK_KEYS.map((key) => {
    const spec = DESKS[key]
    const d = team?.desks[key]
    const groups = d
      ? spec.groups(d as unknown as DeskFigures, team!.warning_days)
      : [missing(state.error ?? (state.loading ? 'Reading the desk…' : 'This desk has not been read.'), !!state.error)]
    // A desk not loaded carries its note once, not once per group.
    const shown = d && !d.loaded ? groups.slice(0, 1) : groups
    return { key, title: spec.title, post: spec.post, icon: spec.icon, links: spec.links, groups: shown }
  })
}
