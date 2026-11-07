import { ref, computed } from 'vue'
import { describe, it, expect } from 'vitest'
import { useStatutorySteps } from '@/composables/useStatutorySteps'
import { emptyCase } from '@/composables/usePlannerCase'
import type { PlannerCaseContext } from '@/composables/usePlannerCase'

// Build a minimal ctx-like object the composable accepts.
function ctxFor(current: any): PlannerCaseContext {
  const cur = ref(current)
  return {
    current: cur,
    step2Unlocked: computed(() => !!cur.value?.permitId),
    step3Unlocked: computed(() => !!cur.value?.dueDiligence?.completedAt),
    step4Unlocked: computed(() => !!cur.value?.committeeReport?.resolutionAt &&
      ['approve', 'approve_modified'].includes(cur.value?.committeeReport?.recommendation)),
    step5Available: computed(() => true),
  } as unknown as PlannerCaseContext
}

describe('useStatutorySteps', () => {
  it('locks everything when there is no case', () => {
    const { steps } = useStatutorySteps(ctxFor(null))
    expect(steps.value).toHaveLength(5)
    expect(steps.value.every(s => s.status === 'locked')).toBe(true)
    expect(steps.value[0].lockedReason).toBe('No active case')
  })

  it('marks intake available then done; gates step 2 on registration', () => {
    const fresh = emptyCase()
    const { steps } = useStatutorySteps(ctxFor(fresh))
    expect(steps.value[0].status).toBe('available')         // intake
    expect(steps.value[0].nextAction).toBe('Register the application')
    expect(steps.value[1].status).toBe('locked')            // due diligence
    expect(steps.value[1].lockedReason).toBe('Register the application first')
  })

  it('reports due-diligence progress out of 21 checks', () => {
    const c = emptyCase()
    c.permitId = 'p1'
    c.dueDiligence.fileChecks = { existing_use_rights: { result: 'pass', notes: '' } }
    c.dueDiligence.compatibility = { zoning: { result: 'fail', notes: '' } }
    const { steps } = useStatutorySteps(ctxFor(c))
    const dd = steps.value[1]
    expect(dd.status).toBe('available')
    expect(dd.progressTotal).toBe(21)
    expect(dd.progressDone).toBe(2)
    expect(dd.nextAction).toBe('19 checks outstanding')
  })

  it('flows through to permit once approved, and marks done states', () => {
    const c = emptyCase()
    c.permitId = 'p1'
    c.dueDiligence.completedAt = '2026-06-01T00:00:00Z'
    c.committeeReport.resolutionAt = '2026-06-02T00:00:00Z'
    c.committeeReport.recommendation = 'approve'
    const { steps } = useStatutorySteps(ctxFor(c))
    expect(steps.value[1].status).toBe('done')              // due diligence
    expect(steps.value[2].status).toBe('done')              // report (resolutionAt set)
    expect(steps.value[3].status).toBe('available')         // permit unlocked, not issued
    c.permit.issueDate = '2026-06-03T00:00:00Z'
    const { steps: steps2 } = useStatutorySteps(ctxFor(c))
    expect(steps2.value[3].status).toBe('done')             // permit issued
  })

  it('keeps permit locked when the resolution is a refusal', () => {
    const c = emptyCase()
    c.permitId = 'p1'; c.dueDiligence.completedAt = 'x'
    c.committeeReport.resolutionAt = 'y'; c.committeeReport.recommendation = 'refuse'
    const { steps } = useStatutorySteps(ctxFor(c))
    expect(steps.value[3].status).toBe('locked')
    expect(steps.value[3].lockedReason).toBe('Needs an approve resolution')
  })
})
