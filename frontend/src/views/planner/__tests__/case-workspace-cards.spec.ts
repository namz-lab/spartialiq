// @vitest-environment happy-dom
// Render check for the three case-workspace cards after the enterprise
// redesign: the presentation changed, the data contract did not. These assert
// that each state still renders the real backend fields and that the
// preserved handlers still fire.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// vi.mock is hoisted above the const declarations, so the spies must be too.
const {
  listEvents, listPermitMeetings, listMeetings, recordAgendaOutcome, scheduleOnAgenda, createMeeting,
} = vi.hoisted(() => ({
  listEvents: vi.fn(),
  listPermitMeetings: vi.fn(),
  listMeetings: vi.fn(),
  recordAgendaOutcome: vi.fn(),
  scheduleOnAgenda: vi.fn(),
  createMeeting: vi.fn(),
}))

vi.mock('@/services/developmentManagementService', () => ({
  dmApi: { listEvents, listPermitMeetings, listMeetings, recordAgendaOutcome, scheduleOnAgenda, createMeeting },
}))

import ApplicationTrackCard from '../ApplicationTrackCard.vue'
import CaseAuditTrail from '../CaseAuditTrail.vue'
import CommitteeScheduleCard from '../CommitteeScheduleCard.vue'

const EVENT = {
  id: 'e1',
  event_type: 'status_changed',
  actor_id: null,
  actor_name: 'A. Officer',
  actor_role: 'planner',
  detail: { status: 'under_review' },
  created_at: '2026-08-11T14:32:00.000Z',
}

const AGENDA = {
  agenda_item_id: 'a1',
  purpose: 'determination',
  outcome: 'pending',
  resolution: null,
  heard_at: null,
  meeting_id: 'm1',
  title: 'TPC — June 2026',
  meeting_date: '2026-06-18',
  location: null,
  meeting_status: 'scheduled',
}

beforeEach(() => vi.clearAllMocks())

describe('ApplicationTrackCard', () => {
  it('renders the completeness count, per-submittal status and the referral list', () => {
    const w = mount(ApplicationTrackCard, {
      props: { devType: 'subdivision', satisfied: { title_deed: true, fee_receipt: true } },
    })
    const text = w.text()
    // subdivision = 5 common + 3 survey submittals, 2 satisfied
    expect(text).toContain('2 / 8')
    expect(text).toContain('Received')
    expect(text).toContain('Outstanding')
    expect(text).toContain('Surveyor-General diagram / general plan')
    expect(text).toContain('Roads Authority')       // real referral, not invented status
    expect(text).toContain('Public hearing required')
    expect(text).toContain('90')                     // statutory days
  })

  it('reports full completeness when every submittal is satisfied', () => {
    const w = mount(ApplicationTrackCard, {
      props: {
        devType: 'alteration',
        satisfied: { tpd1: true, title_deed: true, locality_plan: true, site_plan: true, fee_receipt: true, architectural: true },
      },
    })
    expect(w.text()).toContain('6 / 6')
    expect(w.text()).not.toContain('Outstanding')
  })
})

describe('CaseAuditTrail', () => {
  it('prompts to register when there is no permit id, and calls no API', () => {
    const w = mount(CaseAuditTrail, { props: { permitId: null } })
    expect(w.text()).toContain('Register the application first')
    expect(listEvents).not.toHaveBeenCalled()
  })

  it('renders the event type, summary, actor and role from the log', async () => {
    listEvents.mockResolvedValue([EVENT])
    const w = mount(CaseAuditTrail, { props: { permitId: 'p1' } })
    await flushPromises()
    expect(listEvents).toHaveBeenCalledWith('p1')
    const text = w.text()
    expect(text).toContain('Status changed')
    expect(text).toContain('under review')
    expect(text).toContain('A. Officer')
    expect(text).toContain('planner')
    expect(w.find('time').attributes('datetime')).toBe(EVENT.created_at)
  })

  it('shows the empty state, and the error state with a working retry', async () => {
    listEvents.mockResolvedValueOnce([])
    const w = mount(CaseAuditTrail, { props: { permitId: 'p1' } })
    await flushPromises()
    expect(w.text()).toContain('No recorded case activity.')

    listEvents.mockRejectedValueOnce(new Error('boom'))
    await (w.vm as any).load()
    await flushPromises()
    expect(w.text()).toContain('Audit history could not be loaded.')

    listEvents.mockResolvedValueOnce([EVENT])
    await w.find('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Status changed')
  })
})

describe('CommitteeScheduleCard', () => {
  it('prompts to register when there is no permit id', () => {
    const w = mount(CommitteeScheduleCard, { props: { permitId: null } })
    expect(w.text()).toContain('Register the application first')
    expect(listPermitMeetings).not.toHaveBeenCalled()
  })

  it('renders a pending agenda item with the record-resolution area and posts the outcome', async () => {
    listPermitMeetings.mockResolvedValue([AGENDA])
    listMeetings.mockResolvedValue([{ id: 'm1', title: 'TPC — June 2026', meeting_date: '2026-06-18', status: 'scheduled' }])
    recordAgendaOutcome.mockResolvedValue({})

    const w = mount(CommitteeScheduleCard, { props: { permitId: 'p1' } })
    await flushPromises()

    const text = w.text()
    expect(text).toContain('TPC — June 2026')
    expect(text).toContain('Pending')          // outcome always present as text
    expect(text).toContain('Scheduled')        // workflow status
    expect(text).toContain('Record committee resolution')

    await w.find('#res-a1').setValue('Minute 14/26 — approved subject to conditions')
    await w.find('#out-a1').setValue('approved_with_conditions')
    await w.findAll('button').find(b => b.text().includes('Record resolution'))!.trigger('click')
    await flushPromises()

    expect(recordAgendaOutcome).toHaveBeenCalledWith('a1', {
      outcome: 'approved_with_conditions',
      resolution: 'Minute 14/26 — approved subject to conditions',
    })
  })

  it('renders a recorded outcome without the record area, and shows the resolution', async () => {
    listPermitMeetings.mockResolvedValue([{ ...AGENDA, outcome: 'refused', resolution: 'Refused — non-conforming use.' }])
    listMeetings.mockResolvedValue([])
    const w = mount(CommitteeScheduleCard, { props: { permitId: 'p1' } })
    await flushPromises()
    expect(w.text()).toContain('Refused')
    expect(w.text()).toContain('Refused — non-conforming use.')
    expect(w.text()).not.toContain('Record committee resolution')
  })

  it('tables the application onto the selected meeting and surfaces a duplicate', async () => {
    listPermitMeetings.mockResolvedValue([])
    listMeetings.mockResolvedValue([{ id: 'm2', title: 'TPC — July 2026', meeting_date: '2026-07-20', status: 'scheduled' }])
    scheduleOnAgenda.mockResolvedValue({})

    const w = mount(CommitteeScheduleCard, { props: { permitId: 'p1' } })
    await flushPromises()
    expect(w.text()).toContain('Not yet tabled to a committee.')

    const table = () => w.findAll('button').find(b => b.text().includes('Table application'))!
    await table().trigger('click')
    await flushPromises()
    expect(scheduleOnAgenda).toHaveBeenCalledWith('m2', { permit_app_id: 'p1', purpose: 'determination' })

    scheduleOnAgenda.mockRejectedValueOnce({ response: { data: { error: 'already_scheduled' } } })
    await table().trigger('click')
    await flushPromises()
    expect(w.text()).toContain('already on that meeting agenda')
  })
})
