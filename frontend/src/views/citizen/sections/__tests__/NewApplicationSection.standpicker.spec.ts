// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { setActivePinia, createPinia } from 'pinia'
import { createRouter, createMemoryHistory } from 'vue-router'

const draft = ref({
  stand_number: '', suburb_ward: '', title_deed_no: '',
  applicant_name: '', applicant_id_number: '', applicant_phone: '', applicant_email: '',
  development_type: '', description: '',
  documents: [], consent_to_publish: false, declaration_signed: false,
})

vi.mock('@/composables/useCitizenCase', () => ({
  useCitizenCase: () => ({
    currentDraftId: ref('d_test'),
    currentDraft: { value: draft.value },
    drafts: { value: [{ id: 'd_test', submitted_at: null, ...draft.value }] },
    newDraft: vi.fn(), selectDraft: vi.fn(), removeDraft: vi.fn(),
    save: vi.fn(), submitDraft: vi.fn(),
  }),
  REQUIRED_DOCS_BY_TYPE: {} as Record<string, string[]>,
  DOC_TYPE_LABELS: {} as Record<string, string>,
  isAttached: () => true,
}))
vi.mock('@/composables/useUiFeedback', () => ({
  useUiFeedback: () => ({ showToast: vi.fn(), parseApiError: () => '',
    openMessageBox: vi.fn() }),
}))

import NewApplicationSection from '../NewApplicationSection.vue'

describe('NewApplicationSection stand picker', () => {
  it('maps a selected stand bundle into the draft', async () => {
    setActivePinia(createPinia())
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/citizen', component: { template: '<div/>' } }],
    })
    await router.push('/citizen')
    await router.isReady()
    const w = mount(NewApplicationSection, {
      global: {
        plugins: [router],
        stubs: { StandPickerModal: true, UiFeedback: true, IdentityDocVerifier: true },
      },
    })
    ;(w.vm as any).applyStandSelection({
      in_jurisdiction: true, district: 'Gweru', authority: null,
      stand: { fid: 4, stand_number: 'Communal Land', province: 'Midlands',
        area_ha: 12.3, centroid: [29.39, -19.29], ward: '6', district: 'Gweru',
        description: 'Parcel Communal Land, Gweru — 12.3 ha' },
    })
    expect(draft.value.stand_number).toBe('Communal Land')
    expect(draft.value.suburb_ward).toBe('6')
    expect(draft.value.description).toBe('Parcel Communal Land, Gweru — 12.3 ha')
  })
})
