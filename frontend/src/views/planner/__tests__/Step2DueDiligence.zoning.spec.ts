// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { save, state } = vi.hoisted(() => ({
  save: vi.fn(),
  state: { current: null as any },
}))
vi.mock('@/composables/usePlannerCase', async () => {
  const { ref } = await import('vue')
  state.current = ref(null)
  return { usePlannerCase: () => ({ current: state.current, save }) }
})
vi.mock('@/composables/useUiFeedback', () => ({
  useUiFeedback: () => ({ showToast: vi.fn(), parseApiError: () => '', openMessageBox: vi.fn() }),
}))
vi.mock('@/services/developmentManagementService', () => ({ dmApi: { createConsultation: vi.fn() } }))

import Step2DueDiligence from '@/views/planner/Step2DueDiligence.vue'

function freshCase() {
  return {
    registrationNo: 'VR-1', applicant: {}, property: { standNo: '1', ward: 'W', centroid: [29.8, -19.4] },
    proposal: { devType: 'new_building', description: '', estimatedCost: 0 },
    permit: {}, acknowledgedDate: null, expiryDate: null,
    dueDiligence: {
      fileChecks: {}, compatibility: {}, statutoryChecks: {},
      titleDeedConflict: { hasConflict: false }, referrals: [], completedAt: null,
    },
  }
}

beforeEach(() => { save.mockReset(); state.current.value = freshCase() })

describe('Step 2 zoning apply', () => {
  it('applies a permitted verdict to the compatibility.zoning item + persists the snapshot', async () => {
    const wrapper = mount(Step2DueDiligence, {
      global: { stubs: { ZoningAssessmentCard: true } },
    })
    await flushPromises()
    wrapper.findComponent({ name: 'ZoningAssessmentCard' }).vm.$emit('apply', {
      parcelFid: 42, zoneName: 'Residential 1', zoneCode: 'PU-R1',
      selectedGroupCode: 'RES1', selectedGroupName: 'Dwelling house', permission: 'permitted',
      conditions: 'Single dwelling only', maxHeightM: 8, minLotSqm: 300, maxUnits: 1,
    })
    await flushPromises()
    expect(state.current.value.dueDiligence.compatibility.zoning.result).toBe('pass')
    expect(state.current.value.dueDiligence.compatibility.zoning.notes).toContain('Residential 1')
    expect(state.current.value.dueDiligence.zoningAssessment.permission).toBe('permitted')
    expect(save).toHaveBeenCalled()
  })
})
