import { describe, it, expect } from 'vitest'
import { caseStep, nextDate, CASE_STEPS } from '../caseSteps'

describe('where a case is on its road', () => {
  it('reads the step from the status', () => {
    expect(caseStep({ status: 'registered' }).current?.key).toBe('registered')
    expect(caseStep({ status: 'acknowledged' }).current?.key).toBe('acknowledged')
    expect(caseStep({ status: 'circulation' }).current?.key).toBe('circulated')
    expect(caseStep({ status: 'objection_period' }).current?.key).toBe('circulated')
    expect(caseStep({ status: 'under_review' }).current?.key).toBe('assessed')
  })

  it('moves to the committee step only when a resolution is recorded', () => {
    expect(caseStep({ status: 'under_review', committeeResolved: false }).current?.key).toBe('assessed')
    expect(caseStep({ status: 'under_review', committeeResolved: true }).current?.key).toBe('committee')
    expect(caseStep({ status: 'awaiting_eo_decision', committeeResolved: true }).next?.key).toBe('decided')
  })

  it('a decided case is at "decided" until the applicant is notified', () => {
    expect(caseStep({ status: 'approved' }).current?.key).toBe('decided')
    expect(caseStep({ status: 'refused' }).next?.key).toBe('notified')
    expect(caseStep({ status: 'approved', notified: true }).current?.key).toBe('notified')
    expect(caseStep({ status: 'approved', notified: true }).next).toBeNull()
  })

  it('says so for the states the steps do not describe', () => {
    expect(caseStep({ status: 'pending_payment' })).toMatchObject({ index: -1, current: null, note: 'Waiting for the fee' })
    expect(caseStep({ status: 'withdrawn' })).toMatchObject({ current: null, next: null, note: 'Withdrawn' })
    expect(caseStep({ status: 'appealed' })).toMatchObject({ note: 'Under appeal', next: null })
    expect(caseStep({ status: 'deferred', committeeResolved: false }).note).toBe('Deferred')
  })

  it('does not show "Acknowledged" as done for a case that was never acknowledged', () => {
    const s = caseStep({ status: 'under_review', acknowledged: false })
    expect(s.current?.key).toBe('assessed')
    expect(s.skipped).toEqual(['acknowledged'])
    expect(s.note).toMatch(/Not acknowledged/)
    expect(caseStep({ status: 'under_review', acknowledged: true }).skipped).toEqual([])
    expect(caseStep({ status: 'registered', acknowledged: false }).skipped).toEqual([])
  })

  it('has seven steps, each with an owner', () => {
    expect(CASE_STEPS).toHaveLength(7)
    expect(CASE_STEPS.every((s) => s.owner)).toBe(true)
  })
})

describe('the next date to work to', () => {
  const m = { ask_extension_by: '2027-01-28', resolve_by: '2027-02-13', deemed_on: '2027-02-28' }
  it('is the first milestone not yet past', () => {
    expect(nextDate(m, '2027-01-01')).toEqual({ label: 'Ask for an extension by', date: '2027-01-28', days: 27 })
    expect(nextDate(m, '2027-01-28')).toMatchObject({ label: 'Ask for an extension by', days: 0 })
    expect(nextDate(m, '2027-02-01')).toMatchObject({ label: 'Committee to resolve by', date: '2027-02-13', days: 12 })
    expect(nextDate(m, '2027-02-20')).toMatchObject({ label: 'Deemed refused on', days: 8 })
  })
  it('shows the deemed-refusal date, as past, once every milestone has gone by', () => {
    expect(nextDate(m, '2027-03-05')).toMatchObject({ label: 'Deemed refused on', days: -5 })
  })
  it('is nothing before the case is acknowledged', () => {
    expect(nextDate(null, '2027-01-01')).toBeNull()
  })
})
