import { describe, expect, it } from 'vitest'
import { DESK_KEYS, isDeskKey, teamCards } from '../teamDesks'
import { headline } from '@/components/shared/glance'
import type { PlanningTeam } from '@/services/planningTeam'

const team = (desks: Partial<PlanningTeam['desks']> = {}): PlanningTeam => ({
  as_of: '2026-11-18T08:00:00Z',
  warning_days: 14,
  desks: {
    clerk: { loaded: true, applications: 26, awaiting_fee: 24, to_acknowledge: 2, decisions_to_send: 0, objection_periods_running: 0, objection_periods_to_close: 1, received_this_month: 1 },
    planners: { loaded: true, in_hand: 5, unassigned: 5, due_soon: 0, overdue: 0, with_the_eo: 0, objections_to_consider: 3, replies_overdue: 0, referrals_overdue: 0 },
    inspectors: { loaded: true, booked: 0, without_inspector: 0, past_their_date: 0, done_this_month: 0, complaints_open: 7, complaints_unassigned: 7, enforcement_open: 0 },
    environmental_health: { loaded: false, note: 'No health premises or nuisance complaints are registered yet.' },
    gis_survey: { loaded: true, tasks_open: 9, tasks_overdue: 1, awaiting_review: 5, returned: 0, parcels: 2340, outlines_estimated: 1064 },
    ...desks,
  },
})

const card = (t: PlanningTeam | null, key: string, state = { loading: false, error: null as string | null }) =>
  teamCards(t, state).find((c) => c.key === key)!
const figure = (c: ReturnType<typeof card>, label: string) => c.groups.flatMap((g) => g.stats).find((s) => s.label === label)

describe('the planning team desks', () => {
  it('has the five desks under the EO, in order', () => {
    expect(teamCards(team(), { loading: false, error: null }).map((c) => c.key)).toEqual([...DESK_KEYS])
    expect(isDeskKey('clerk')).toBe(true)
    expect(isDeskKey('finance')).toBe(false)
  })

  it('flags a figure only when there is something to act on', () => {
    const clerk = card(team(), 'clerk')
    expect(figure(clerk, 'Fee paid, not yet acknowledged')).toMatchObject({ value: '2', tone: 'warn' })
    expect(figure(clerk, 'Decisions not yet sent to the applicant')!.tone).toBeUndefined()
    // Work in hand is the desk's normal state, never a flag.
    expect(figure(clerk, 'Waiting for the applicant to pay')!.tone).toBeUndefined()
  })

  it('marks a missed date as bad, not merely to look at', () => {
    const gis = card(team(), 'gis_survey')
    expect(figure(gis, 'Past their due date')).toMatchObject({ value: '1', tone: 'bad' })
    expect(figure(gis, 'Outlines estimated, not surveyed')).toMatchObject({ value: '1,064 of 2,340', tone: 'warn' })
  })

  it('picks the flagged figures for the tile before the quiet ones, kept in the desk order', () => {
    const { shown, flagged, more } = headline(card(team(), 'planners'))
    expect(flagged).toBe(2)
    expect(shown.map((s) => s.label)).toEqual(['Past the three months', 'Not assigned to a planner', 'Objections not yet considered'])
    expect(more).toBe(5)
  })

  it('names the warning window the server uses', () => {
    expect(figure(card(team(), 'planners'), 'Within 14 days of deemed refusal')).toBeDefined()
  })

  it('shows an empty desk once, with its reason, never as zeros', () => {
    const eh = card(team(), 'environmental_health')
    expect(eh.groups).toHaveLength(1)
    expect(eh.groups[0]).toMatchObject({ loaded: false, note: 'No health premises or nuisance complaints are registered yet.' })
  })

  it('says every desk is being read before the answer arrives, and unreadable when the read failed', () => {
    expect(card(null, 'clerk', { loading: true, error: null }).groups[0]).toMatchObject({ loaded: false, unavailable: false, note: 'Reading the desk…' })
    expect(card(null, 'clerk', { loading: false, error: 'The team could not be read.' }).groups[0])
      .toMatchObject({ loaded: false, unavailable: true, note: 'The team could not be read.' })
  })
})
