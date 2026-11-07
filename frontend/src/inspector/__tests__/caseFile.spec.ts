import { describe, it, expect } from 'vitest'
import { stageTimeline, permitValidity, complianceDeadline } from '../caseFile'
import type { StageInspection } from '@/services/developmentManagementService'

function insp(stage: number, attempt: number, result: StageInspection['result'], inspected: string | null = '2026-03-01T08:00:00Z'): StageInspection {
  return {
    id: `${stage}-${attempt}`, permit_app_id: 'p', stage_number: stage, stage_name: '', attempt,
    scheduled_at: null, inspected_at: inspected, inspector_name: null, stamp_reference: null,
    result, overall_result: null, notes: null, photo_urls: [], created_at: '', updated_at: '',
  }
}

describe('stage timeline', () => {
  it('judges each stage on its latest attempt, not its best', () => {
    const lines = stageTimeline([insp(1, 1, 'pass'), insp(2, 1, 'pass'), insp(2, 2, 'fail'), insp(3, 1, null, null)])
    expect(lines).toHaveLength(9)
    expect(lines[0].state).toBe('passed')
    expect(lines[1]).toMatchObject({ state: 'failed', attempts: 2 })
    expect(lines[2].state).toBe('booked')
    expect(lines[8].state).toBe('not_started')
  })

  it('treats a failed attempt followed by a pass as passed', () => {
    expect(stageTimeline([insp(4, 2, 'conditional_pass'), insp(4, 1, 'fail')])[3].state).toBe('conditional')
  })
})

describe('permit validity', () => {
  const now = new Date('2026-09-14T00:00:00Z')

  it('stops the 12-month clock once any stage has been inspected', () => {
    expect(permitValidity('2024-01-01', [insp(1, 1, 'pass')], now).state).toBe('commenced')
  })

  it('flags lapsed, expiring and valid permits', () => {
    expect(permitValidity('2025-08-01', [], now).state).toBe('lapsed')
    expect(permitValidity('2025-10-15', [], now)).toMatchObject({ state: 'expiring', daysLeft: 31 })
    expect(permitValidity('2026-06-01', [], now).state).toBe('valid')
  })

  it('does not guess when there is no decision date', () => {
    expect(permitValidity(null, [], now).state).toBe('unknown')
  })
})

describe('compliance deadline', () => {
  const now = new Date('2026-09-14T00:00:00Z')
  it('adds the compliance period to the issue date and reports overdue as negative', () => {
    expect(complianceDeadline('2026-09-01T00:00:00Z', 30, now)?.daysLeft).toBe(17)
    expect(complianceDeadline('2026-08-01T00:00:00Z', 14, now)?.daysLeft).toBe(-30)
  })
  it('returns null rather than a fake date when the order has none', () => {
    expect(complianceDeadline(null, 30, now)).toBeNull()
    expect(complianceDeadline('2026-09-01', null, now)).toBeNull()
  })
})
