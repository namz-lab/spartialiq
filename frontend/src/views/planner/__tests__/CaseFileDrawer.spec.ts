// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, it, expect, vi } from 'vitest'

const current = ref<any>({
  registrationNo: 'VR-2026-0050', fileRef: 'file/VR-2026-0050', permitId: 'p1',
  applicant: { name: 'A. Moyo' }, property: { standNo: '1234', ward: 'Ward 5', centroid: [29.8, -19.4] },
  dueDiligence: { completedAt: '2026-06-01T00:00:00Z' },
  committeeReport: { resolutionAt: null }, permit: { issueDate: null },
  notices: { outcomeLetterSentAt: null },
})
const flyTo = vi.fn()
const showMap = vi.fn()

vi.mock('@/composables/usePlannerCase', () => ({ usePlannerCase: () => ({ current }) }))
vi.mock('@/composables/usePlannerShell', () => ({ usePlannerShell: () => ({ flyTo, showMap, openCaseForStand: vi.fn() }) }))

import CaseFileDrawer from '@/views/planner/CaseFileDrawer.vue'

describe('CaseFileDrawer', () => {
  it('shows step completion and flies to the case centroid', async () => {
    const wrapper = mount(CaseFileDrawer)
    // Steps 1 and 2 done, 3/4/5 not.
    expect(wrapper.findAll('.cf-step.done').length).toBe(2)
    await wrapper.find('.cf-show-on-map').trigger('click')
    expect(flyTo).toHaveBeenCalledWith([29.8, -19.4])
  })
})
