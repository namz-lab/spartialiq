// @vitest-environment happy-dom
// SurveyRequestsCard after the enterprise redesign: the presentation changed,
// the statutory gate and the API contract did not. Asserts the states the
// planner actually sees, and that the gate only clears on an ACCEPTED report.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'

// `current` must be a genuine ref — the template relies on Vue unwrapping it.
const { applicationTasks, assignJob, updateJob, caseRef } = await vi.hoisted(async () => {
  const { ref } = await import('vue')
  return {
    applicationTasks: vi.fn(),
    assignJob: vi.fn(),
    updateJob: vi.fn(),
    caseRef: ref<any>(null),
  }
})

vi.mock('@/services/surveyor', () => ({
  surveyorApi: { applicationTasks, assignJob, updateJob },
}))
vi.mock('@/composables/usePlannerCase', () => ({
  usePlannerCase: () => ({ current: caseRef, save: vi.fn() }),
}))

import SurveyRequestsCard from '../SurveyRequestsCard.vue'

function makeCase(devType: string, permitId: string | null = 'p1') {
  return {
    registrationNo: 'TPD-2026-00124', fileRef: 'F/124', permitId,
    applicant: { name: 'T. Moyo', idNumber: '', phone: '', email: '' },
    property: { standNo: '1824', ward: 'Ward 7', description: '', titleDeedNo: '' },
    proposal: { devType, description: '', estimatedCost: 0, plinthArea: 0, floors: 1, parkingBays: 0 },
  }
}

const FINDING = {
  id: 'f1', survey_task_id: 't1',
  summary: 'Boundary corresponds with the approved subdivision layout.',
  recommendation: 'no_objection', conditions: 'Beacon verification before final survey.',
  notes: null, submitted_by: null,
  submitted_at: '2026-08-11T09:00:00.000Z', created_at: '2026-08-11T09:00:00.000Z',
}

const TASK = {
  id: 't1', permit_app_id: 'p1', task_type: 'verification',
  stand_number: '1824', suburb_ward: 'Ward 7', instructions: 'Verify stand boundaries.',
  priority: 'urgent', due_date: '2026-01-05', status: 'submitted',
  created_at: '2026-08-01T08:00:00.000Z', updated_at: '2026-08-01T08:00:00.000Z',
  findings: [FINDING],
}

beforeEach(() => {
  vi.clearAllMocks()
  caseRef.value = makeCase('subdivision')
  applicationTasks.mockResolvedValue([])
})

describe('SurveyRequestsCard — statutory gate', () => {
  it('emits required-but-unsatisfied for a subdivision with no accepted report', async () => {
    applicationTasks.mockResolvedValue([TASK])
    const w = mount(SurveyRequestsCard)
    await flushPromises()

    const emitted = w.emitted('gate-change')!
    expect(emitted[emitted.length - 1][0]).toEqual({ required: true, satisfied: false })
    expect(w.text()).toContain('case progression blocked')
    // Requesting a survey must never read as satisfying the requirement.
    expect(w.text()).not.toContain('case may proceed')
  })

  it('clears the gate only once a report is accepted', async () => {
    applicationTasks.mockResolvedValue([{ ...TASK, status: 'accepted' }])
    const w = mount(SurveyRequestsCard)
    await flushPromises()

    const emitted = w.emitted('gate-change')!
    expect(emitted[emitted.length - 1][0]).toEqual({ required: true, satisfied: true })
    expect(w.text()).toContain('Survey requirement satisfied — case may proceed')
  })

  it('reports not-required for a non-survey development type', async () => {
    caseRef.value = makeCase('new_building')
    const w = mount(SurveyRequestsCard)
    await flushPromises()

    expect(w.emitted('gate-change')![0][0]).toEqual({ required: false, satisfied: false })
    expect(w.text()).toContain('Not required')
    expect(w.text()).not.toContain('case progression blocked')
  })

  it('does not treat a returned report as satisfying the gate', async () => {
    applicationTasks.mockResolvedValue([{ ...TASK, status: 'returned' }])
    const w = mount(SurveyRequestsCard)
    await flushPromises()

    const emitted = w.emitted('gate-change')!
    expect(emitted[emitted.length - 1][0]).toEqual({ required: true, satisfied: false })
    expect(w.text()).toContain('Returned for rework')
  })
})

describe('SurveyRequestsCard — rendering', () => {
  it('renders the submitted report, findings, recommendation and conditions', async () => {
    applicationTasks.mockResolvedValue([TASK])
    const w = mount(SurveyRequestsCard)
    await flushPromises()
    const text = w.text()

    expect(text).toContain('Verification survey')        // task type, split from its descriptor
    expect(text).toContain('Submitted')                  // status
    expect(text).toContain('Urgent')                     // priority escalation
    expect(text).toContain('05 Jan 2026')                // due date, long form
    expect(text).toContain('overdue')                    // derived from due_date, not a new field
    expect(text).toContain('Surveyor recommendation')
    expect(text).toContain('No objection')
    expect(text).toContain('Boundary corresponds with the approved subdivision layout.')
    expect(text).toContain('Beacon verification before final survey.')
    expect(text).toContain('1824')                       // property context from the case
  })

  it('shows the register-first state and hides the form without a permit', async () => {
    caseRef.value = makeCase('subdivision', null)
    const w = mount(SurveyRequestsCard)
    await flushPromises()

    expect(w.text()).toContain('Register the application first')
    expect(w.find('#sc-type').exists()).toBe(false)
    expect(applicationTasks).not.toHaveBeenCalled()
  })

  it('shows an empty state, not an error, when the case has no tasks', async () => {
    const w = mount(SurveyRequestsCard)
    await flushPromises()

    expect(w.text()).toContain('No survey tasks')
    expect(w.find('#sc-type').exists()).toBe(true)
  })

  it('surfaces a load failure with a retry instead of a blank card', async () => {
    applicationTasks.mockRejectedValueOnce({ response: { status: 500 } })
    const w = mount(SurveyRequestsCard)
    await flushPromises()

    expect(w.find('[role="alert"]').exists()).toBe(true)
    applicationTasks.mockResolvedValue([TASK])
    await w.find('[role="alert"] button').trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })
})

describe('SurveyRequestsCard — planner actions', () => {
  it('accepts a report through the unchanged updateJob contract', async () => {
    applicationTasks.mockResolvedValue([TASK])
    updateJob.mockResolvedValue({})
    const w = mount(SurveyRequestsCard)
    await flushPromises()

    const accept = w.findAll('button').find(b => b.text().includes('Accept report'))!
    await accept.trigger('click')
    expect(updateJob).toHaveBeenCalledWith('t1', { status: 'accepted' })
  })

  it('returns a report for rework through the unchanged updateJob contract', async () => {
    applicationTasks.mockResolvedValue([TASK])
    updateJob.mockResolvedValue({})
    const w = mount(SurveyRequestsCard)
    await flushPromises()

    const back = w.findAll('button').find(b => b.text().includes('Return for rework'))!
    await back.trigger('click')
    expect(updateJob).toHaveBeenCalledWith('t1', { status: 'returned' })
  })

  it('requests a survey with the case context the backend expects', async () => {
    assignJob.mockResolvedValue({})
    const w = mount(SurveyRequestsCard)
    await flushPromises()

    await w.find('#sc-instr').setValue('Peg the four corners against layout 41/2026.')
    await w.find('#sc-prio').setValue('high')
    await w.find('#sc-due').setValue('2026-09-01')
    const send = w.findAll('button').find(b => b.text().includes('Request survey') && b.attributes('aria-label'))!
    await send.trigger('click')
    await flushPromises()

    expect(assignJob).toHaveBeenCalledWith(expect.objectContaining({
      permit_app_id: 'p1',
      task_type: 'verification',
      stand_number: '1824',
      suburb_ward: 'Ward 7',
      instructions: 'Peg the four corners against layout 41/2026.',
      priority: 'high',
      due_date: '2026-09-01',
    }))
    // The list reloads so the new task (and the gate) reflect server truth.
    expect(applicationTasks).toHaveBeenCalledTimes(2)
  })
})
