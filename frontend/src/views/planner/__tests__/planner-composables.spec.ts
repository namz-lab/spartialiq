// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest'
import { useConditionLibrary, type PlanningCondition } from '@/composables/useConditionLibrary'

const allPass = {
  necessity: true, relevance: true, enforceability: true,
  precision: true, reasonableness: true,
}

function condFixture(over: Partial<PlanningCondition> = {}): PlanningCondition {
  return {
    id: 'c-1', category: 'custom', text: 'Sample condition',
    tests: { ...allPass },
    ...over,
  }
}

describe('useConditionLibrary', () => {
  it('exposes the 8 standard templates plus custom', () => {
    const lib = useConditionLibrary()
    const keys = lib.templates.map(t => t.key).sort()
    expect(keys).toEqual([
      'commencement', 'custom', 'hours', 'inspection',
      'landscaping', 'materials', 'parking', 'services', 'setback',
    ])
  })

  it('addFromTemplate returns a condition with that category and template text', () => {
    const lib = useConditionLibrary()
    const c = lib.addFromTemplate('setback')
    expect(c.category).toBe('setback')
    expect(c.text.length).toBeGreaterThan(10)
    expect(c.id).toMatch(/^cond_/)
  })

  it('passesAllTests returns true only when every test is true', () => {
    const lib = useConditionLibrary()
    expect(lib.passesAllTests(condFixture())).toBe(true)
    expect(lib.passesAllTests(condFixture({ tests: { ...allPass, necessity: false } }))).toBe(false)
    expect(lib.passesAllTests(condFixture({ tests: { ...allPass, reasonableness: false } }))).toBe(false)
  })
})

import { ref, nextTick } from 'vue'
import { useStatutoryClock } from '@/composables/useStatutoryClock'

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString()
}

describe('useStatutoryClock', () => {
  it('returns pre_ack phase when ackDate is null', () => {
    const ack = ref<string | null>(null)
    const { state } = useStatutoryClock(ack)
    expect(state.value.phase).toBe('pre_ack')
    expect(state.value.daysElapsed).toBe(0)
    expect(state.value.daysRemaining).toBe(90)
    expect(state.value.warningLevel).toBe('ok')
  })

  it('computes daysElapsed and daysRemaining from ackDate', async () => {
    const ack = ref<string | null>(isoDaysAgo(10))
    const { state } = useStatutoryClock(ack)
    await nextTick()
    expect(state.value.daysElapsed).toBe(10)
    // three calendar months, so 80 to 82 days depending on which months the period spans
    expect(state.value.daysRemaining).toBeGreaterThanOrEqual(79)
    expect(state.value.daysRemaining).toBeLessThanOrEqual(82)
    expect(state.value.weekNumber).toBe(1)
    expect(state.value.warningLevel).toBe('ok')
  })

  it('flags warningLevel caution at 30 days remaining', async () => {
    const ack = ref<string | null>(ackWithDaysLeft(30))
    const { state } = useStatutoryClock(ack)
    await nextTick()
    expect(state.value.daysRemaining).toBe(30)
    expect(state.value.warningLevel).toBe('caution')
  })

  it('flags warningLevel urgent at 14 days remaining', async () => {
    const ack = ref<string | null>(ackWithDaysLeft(14))
    const { state } = useStatutoryClock(ack)
    await nextTick()
    expect(state.value.daysRemaining).toBe(14)
    expect(state.value.warningLevel).toBe('urgent')
  })

  it('flags phase deemed_refused + warningLevel critical at 0 days', async () => {
    const ack = ref<string | null>(ackWithDaysLeft(-1))
    const { state } = useStatutoryClock(ack)
    await nextTick()
    expect(state.value.daysRemaining).toBeLessThanOrEqual(0)
    expect(state.value.phase).toBe('deemed_refused')
    expect(state.value.warningLevel).toBe('critical')
  })

  it('weekMilestones returns the six statutory checkpoints', () => {
    const ack = ref<string | null>(isoDaysAgo(0))
    const { weekMilestones } = useStatutoryClock(ack)
    const m = weekMilestones()
    expect(m.length).toBe(6)
    expect(m[0]).toEqual({ week: 0,  label: 'Intake' })
    expect(m[5]).toEqual({ week: 12, label: 'Resolution' })
  })
})

import { deriveStatutoryState } from '@/composables/useStatutoryClock'
import { addMonths } from '@/statutory/periods'

/** An acknowledgement date whose three-month deadline falls `days` from now (negative: that long ago). */
function ackWithDaysLeft(days: number): string {
  const deadline = new Date(); deadline.setUTCDate(deadline.getUTCDate() + days)
  return addMonths(deadline.toISOString(), -3)
}

describe('deriveStatutoryState (pure)', () => {
  it('treats exactly daysRemaining === 0 as deemed_refused + critical', () => {
    // acknowledged on 1 March, three months to the day on 1 June
    const s = deriveStatutoryState('2026-03-01T00:00:00.000Z', new Date('2026-06-01T00:00:00.000Z'))
    expect(s.daysRemaining).toBe(0)
    expect(s.phase).toBe('deemed_refused')
    expect(s.warningLevel).toBe('critical')
  })

  it('computes expiryDate as ackDate + three calendar months (not 90 days)', () => {
    const june = deriveStatutoryState('2026-06-01T00:00:00.000Z', new Date('2026-06-01T00:00:00.000Z'))
    expect(june.expiryDate?.toISOString()).toBe('2026-09-01T00:00:00.000Z')   // 92 days
    const sub = deriveStatutoryState('2026-06-01T00:00:00.000Z', new Date('2026-06-01T00:00:00.000Z'), 'subdivision')
    expect(sub.expiryDate?.toISOString()).toBe('2026-10-01T00:00:00.000Z')    // s.40(6): four months
  })

  it('keeps the original check: 1 January + three months', () => {
    const ack = new Date('2026-01-01T00:00:00.000Z')
    const s = deriveStatutoryState(ack.toISOString(), new Date('2026-01-01T00:00:00.000Z'))
    expect(s.expiryDate?.toISOString()).toBe('2026-04-01T00:00:00.000Z')
  })

  it('transitions through phase ladder at week boundaries', () => {
    const now = new Date('2026-06-01T00:00:00.000Z')
    function ackDaysAgo(days: number): string {
      const d = new Date(now); d.setUTCDate(d.getUTCDate() - days); return d.toISOString()
    }
    expect(deriveStatutoryState(ackDaysAgo(0),  now).phase).toBe('consultation')   // wk 0
    expect(deriveStatutoryState(ackDaysAgo(7),  now).phase).toBe('objections')     // wk 1
    expect(deriveStatutoryState(ackDaysAgo(42), now).phase).toBe('report_drafting')// wk 6
    expect(deriveStatutoryState(ackDaysAgo(63), now).phase).toBe('committee')      // wk 9
    expect(deriveStatutoryState(ackDaysAgo(84), now).phase).toBe('permit_issue')   // wk 12
    expect(deriveStatutoryState('2026-03-01T00:00:00.000Z', now).phase).toBe('deemed_refused') // three months to the day
  })
})

import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { providePlannerCase, usePlannerCase, type CaseFile } from '@/composables/usePlannerCase'

function withProvidedCase() {
  let captured: ReturnType<typeof providePlannerCase> | null = null
  const Host = defineComponent({
    setup() { captured = providePlannerCase(); return () => h('div') },
  })
  mount(Host)
  if (!captured) throw new Error('context not captured')
  return captured
}

function seedCase(over: Partial<CaseFile> = {}): CaseFile {
  return {
    registrationNo: 'VR-2026-0001', fileRef: 'file/VR-2026-0001', permitId: 'PMT-1',
    applicant: { name: 'A', idNumber: 'B', phone: '', email: '' },
    property:  { standNo: 'S1', ward: 'Ward 1', description: '', titleDeedNo: '' },
    proposal:  { devType: 'residential', description: '', estimatedCost: 0,
                 plinthArea: 0, floors: 1, parkingBays: 1 },
    intake:    { feePaid: true, feeReceiptNo: '', feeAmount: 46,
                 copiesSubmitted: 3, titleDeedAttached: true, bondholderConsent: false },
    classification: 'routine_26_1',
    applicationDate: new Date().toISOString(),
    acknowledgedDate: null, expiryDate: null,
    dueDiligence: { fileChecks:{}, compatibility:{}, statutoryChecks:{},
                    titleDeedConflict:{ hasConflict:false, deedFileName:'', bondholderConsentReceived:false },
                    referrals: [], completedAt: null },
    committeeReport: { siteContext:'', policyAnalysis:'', publicResponseNotes:'',
                       recommendation:'approve', recommendationReasons:'',
                       tabledAt:null, resolutionAt:null, resolutionText:'' },
    permit: { permitNo:'', useClass:'', permittedDescription:'', conditions:[],
              annexure7Notes:'', issueDate:null, issuingOfficer:'' },
    notices: { ackSentAt:null, ackReturnedAt:null, publicNotice:null, objections:[], outcomeLetterSentAt:null },
    lastEditedAt: new Date().toISOString(),
    ...over,
  }
}

describe('usePlannerCase', () => {
  it('starts with no current case and all steps locked', () => {
    const ctx = withProvidedCase()
    expect(ctx.current.value).toBeNull()
    expect(ctx.step2Unlocked.value).toBe(false)
    expect(ctx.step3Unlocked.value).toBe(false)
    expect(ctx.step4Unlocked.value).toBe(false)
    expect(ctx.step5Available.value).toBe(true)
  })

  it('unlocks step 2 once permitId is set', async () => {
    const ctx = withProvidedCase()
    await ctx.registerNew(seedCase())
    expect(ctx.current.value?.permitId).toBe('PMT-1')
    expect(ctx.step2Unlocked.value).toBe(true)
    expect(ctx.step3Unlocked.value).toBe(false)
  })

  it('unlocks step 3 once dueDiligence.completedAt is set', async () => {
    const ctx = withProvidedCase()
    await ctx.registerNew(seedCase())
    ctx.current.value!.dueDiligence.completedAt = new Date().toISOString()
    expect(ctx.step3Unlocked.value).toBe(true)
    expect(ctx.step4Unlocked.value).toBe(false)
  })

  it('unlocks step 4 only when resolution recorded AND recommendation is approve/approve_modified', async () => {
    const ctx = withProvidedCase()
    await ctx.registerNew(seedCase())
    const c = ctx.current.value!
    c.dueDiligence.completedAt = new Date().toISOString()
    c.committeeReport.resolutionAt = new Date().toISOString()
    c.committeeReport.recommendation = 'refuse'
    expect(ctx.step4Unlocked.value).toBe(false)
    c.committeeReport.recommendation = 'approve'
    expect(ctx.step4Unlocked.value).toBe(true)
    c.committeeReport.recommendation = 'approve_modified'
    expect(ctx.step4Unlocked.value).toBe(true)
  })

  it('clear() resets to no current case', async () => {
    const ctx = withProvidedCase()
    await ctx.registerNew(seedCase())
    expect(ctx.current.value).not.toBeNull()
    ctx.clear()
    expect(ctx.current.value).toBeNull()
  })
})

describe('usePlannerCase unload guard', () => {
  it('stops warning about unsaved changes once the debounced save has run', async () => {
    const { vi } = await import('vitest')
    vi.useFakeTimers()
    try {
      const ctx = withProvidedCase()
      ctx.current.value = seedCase({ permitId: undefined }) // local-only: no network
      ctx.save()
      const pending = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(pending)
      expect(pending.defaultPrevented).toBe(true)
      vi.runAllTimers()
      const settled = new Event('beforeunload', { cancelable: true })
      window.dispatchEvent(settled)
      expect(settled.defaultPrevented).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
