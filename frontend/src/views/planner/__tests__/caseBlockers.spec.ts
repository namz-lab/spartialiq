import { describe, it, expect } from 'vitest'
import { deriveCaseBlockers } from '@/views/planner/caseBlockers'
import { emptyCase } from '@/composables/usePlannerCase'

describe('deriveCaseBlockers', () => {
  it('reports pending referrals as blocking and completed ones as clear', () => {
    const c = emptyCase()
    c.dueDiligence.referrals = [
      { department: 'Engineering', contactedAt: '2026-05-30', response: '', outcome: 'pending' },
      { department: 'Fire', contactedAt: '2026-05-20', response: 'No objection', outcome: 'no_objection' },
      { department: 'Health', contactedAt: '2026-05-22', response: 'Ok', outcome: 'no_objection' },
    ]
    const { blockers, nextAction } = deriveCaseBlockers(c)
    expect(blockers.find(b => b.id === 'referral:Engineering')?.severity).toBe('blocking')
    expect(blockers.find(b => b.id === 'referral:Fire')?.severity).toBe('clear')
    expect(nextAction).toMatch(/engineering/i)
  })

  it('flags unresolved objections as a warning', () => {
    const c = emptyCase()
    c.notices.objections = [{
      id: 'o1', objector: 'Neighbour', grounds: 'Traffic', receivedAt: '2026-06-05',
      officerView: '', resolvedAt: null,
    }]
    const { blockers } = deriveCaseBlockers(c)
    expect(blockers.find(b => b.id === 'objections')?.severity).toBe('warning')
  })

  it('flags incomplete intake when the fee is unpaid', () => {
    const c = emptyCase()
    c.intake.feePaid = false
    const { blockers, nextAction } = deriveCaseBlockers(c)
    expect(blockers.find(b => b.id === 'intake')?.severity).toBe('warning')
    expect(nextAction.toLowerCase()).toContain('fee')
  })

  it('returns a calm next action when nothing is outstanding', () => {
    const c = emptyCase()
    c.permitId = 'p-1'
    c.intake.feePaid = true
    c.dueDiligence.completedAt = '2026-06-20'
    c.committeeReport.resolutionAt = '2026-07-01'
    c.committeeReport.recommendation = 'approve'
    const { blockers, nextAction } = deriveCaseBlockers(c)
    expect(blockers.every(b => b.severity === 'clear')).toBe(true)
    expect(nextAction.length).toBeGreaterThan(0)
  })
})
