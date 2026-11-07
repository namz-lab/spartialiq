// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, it, expect } from 'vitest'
import { providePlannerCase, emptyCase, type PlannerCaseContext } from '@/composables/usePlannerCase'

function withCase(): PlannerCaseContext {
  let ctx!: PlannerCaseContext
  const Comp = defineComponent({ setup() { ctx = providePlannerCase(); return () => null } })
  mount(Comp)
  return ctx
}

describe('usePlannerCase seed + defaults', () => {
  it('emptyCase() has a valid DevType default', () => {
    expect(emptyCase().proposal.devType).toBe('new_building')
  })

  it('seedIntake stores a one-shot stand seed', () => {
    const ctx = withCase()
    expect(ctx.intakeSeed.value).toBeNull()
    ctx.seedIntake({ standNo: '1234', ward: 'Ward 5', description: 'Residential' })
    expect(ctx.intakeSeed.value).toEqual({ standNo: '1234', ward: 'Ward 5', description: 'Residential' })
  })
})
