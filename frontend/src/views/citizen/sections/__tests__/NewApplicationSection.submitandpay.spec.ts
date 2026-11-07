// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { setActivePinia, createPinia } from 'pinia'

const submitDraft = vi.fn()
const draftData = {
  id: 'D1', stand_number: 'CIT-SMK-1', suburb_ward: '1',
  development_type: 'new_building', description: 'shed',
  applicant_name: 'Test User', applicant_id_number: '12-345678-X-78',
  consent_to_publish: true, declaration_signed: true,
  documents: [],
}
const currentDraft = { value: draftData }
const currentDraftId = { value: 'D1' }
const drafts = { value: [draftData] }
vi.mock('@/composables/useCitizenCase', () => ({
  useCitizenCase: () => ({
    submitDraft,
    currentDraft,
    currentDraftId,
    drafts,
    save: vi.fn(),
    newDraft: vi.fn(),
    selectDraft: vi.fn(),
    removeDraft: vi.fn(),
  }),
  REQUIRED_DOCS_BY_TYPE: {},
  DOC_TYPE_LABELS: {},
  isAttached: () => true,
}))
vi.mock('@/services/paymentsService', () => ({
  paymentsService: { init: vi.fn() },
}))
vi.mock('@/services/citizenPortalService', () => ({
  citizenPortalService: { getCouncil: vi.fn() },
}))
vi.mock('@/composables/useUiFeedback', () => ({
  useUiFeedback: () => ({
    showToast: vi.fn(), parseApiError: () => '',
    error: vi.fn(), success: vi.fn(), openMessageBox: vi.fn(),
  }),
}))

import NewApplicationSection from '../NewApplicationSection.vue'
import { paymentsService } from '@/services/paymentsService'
import { citizenPortalService } from '@/services/citizenPortalService'

async function mountAtSubmitStep() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/citizen', component: { template: '<div/>' } },
      { path: '/payment/:id', name: 'payment', component: { template: '<div/>' } },
    ],
  })
  router.push('/citizen')
  await router.isReady()
  const w = mount(NewApplicationSection, {
    global: { plugins: [router], stubs: { IdentityDocVerifier: true } },
  })
  await flushPromises()
  // Walk to the final step. NewApplicationSection exposes `step` and `TOTAL_STEPS` via defineExpose.
  ;(w.vm as any).step = (w.vm as any).TOTAL_STEPS
  await flushPromises()
  return { w, router }
}

describe('NewApplicationSection Submit & pay', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    ;(citizenPortalService.getCouncil as any).mockResolvedValue({
      name: 'Vungu Rural District Council', application_fee: 25,
    })
    submitDraft.mockResolvedValue({ id: 'P1' })
    ;(paymentsService.init as any).mockResolvedValue({ id: 'PAY1' })
  })

  it('on picker submit: submitDraft → init → route to /payment/:id', async () => {
    const { w, router } = await mountAtSubmitStep()
    await w.find('[data-tile="ecocash"]').trigger('click')
    await w.find('input[name="pmp-phone"]').setValue('0771234567')
    await w.find('[data-test="pmp-pay"]').trigger('click')
    await flushPromises()
    await flushPromises()

    expect(submitDraft).toHaveBeenCalledWith('D1', {
      payIntent: { phone: '+263771234567', walletCcy: 'USD' },
    })
    expect(paymentsService.init).toHaveBeenCalledWith(expect.objectContaining({
      purpose:    'application_fee', relatedKind: 'permit',
      relatedId:  'P1', driver: 'paynow',
      metadata:   { phone: '+263771234567', wallet: 'ecocash' },
    }))
    expect(router.currentRoute.value.path).toBe('/payment/PAY1')
  })
})
