// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/services/developmentManagementService', () => ({
  dmApi: {
    createPermit: vi.fn().mockResolvedValue({ id: 'perm-1', dev_register_no: 'VR-2026-0050', updated_at: new Date().toISOString() }),
  },
}))

import { providePlannerCase, emptyCase, type PlannerCaseContext } from '@/composables/usePlannerCase'

function withCase(): PlannerCaseContext {
  let ctx!: PlannerCaseContext
  mount(defineComponent({ setup() { ctx = providePlannerCase(); return () => null } }))
  return ctx
}

describe('statutory workflow gating', () => {
  it('unlocks each step only when its precondition is met', async () => {
    const ctx = withCase()
    expect(ctx.step2Unlocked.value).toBe(false)

    await ctx.registerNew({ ...emptyCase(), registrationNo: 'VR-2026-0050' })
    await flushPromises()
    expect(ctx.current.value?.permitId).toBe('perm-1')
    expect(ctx.step2Unlocked.value).toBe(true)   // Step 1 -> Step 2

    ctx.current.value!.dueDiligence.completedAt = new Date().toISOString()
    expect(ctx.step3Unlocked.value).toBe(true)   // Step 2 -> Step 3

    ctx.current.value!.committeeReport.resolutionAt = new Date().toISOString()
    ctx.current.value!.committeeReport.recommendation = 'refuse'
    expect(ctx.step4Unlocked.value).toBe(false)  // refusal does NOT unlock permit drafting

    ctx.current.value!.committeeReport.recommendation = 'approve'
    expect(ctx.step4Unlocked.value).toBe(true)   // approval -> Step 4
  })
})
