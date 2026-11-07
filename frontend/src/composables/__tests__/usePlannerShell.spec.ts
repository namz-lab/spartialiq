// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, it, expect } from 'vitest'
import { usePlannerShell } from '@/composables/usePlannerShell'

describe('usePlannerShell', () => {
  it('throws a clear error when used without a provider', () => {
    const Comp = defineComponent({ setup() { usePlannerShell(); return () => null } })
    expect(() => mount(Comp)).toThrow(/outside <PlannerShell>/)
  })
})
