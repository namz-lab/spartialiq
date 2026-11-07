// @vitest-environment happy-dom
// Behaviour checks for the citizen sections rebuilt on real endpoints:
// each asserts the real API is called and the old fabricated behaviour
// (fake verify, fake subscribe, invented fees) is gone.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { ref } from 'vue'

const permit = {
  id: 'P1', dev_register_no: 'VRDC/DEV/2026/0001', stand_number: '114', suburb_ward: 'Ward 7',
  applicant_name: 'Tendai Moyo', applicant_phone: '0771234567', development_type: 'new_building',
  status: 'objection_period', fee_paid: true, has_occupation_certificate: false,
  created_at: '2026-09-01T00:00:00Z', received_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-10T00:00:00Z',
}

const { applications, dmApi, getCaseSnapshot, getCouncil, listMine, showToast } = vi.hoisted(() => ({
  applications: { value: [] as any[] },
  dmApi: {
    uploadPermitDocument: vi.fn(),
    listObjections: vi.fn(),
    getPublicNotice: vi.fn(),
    createObjection: vi.fn(),
    listPermitDocuments: vi.fn(),
    getCertificate: vi.fn(),
  },
  getCaseSnapshot: vi.fn(),
  getCouncil: vi.fn(),
  listMine: vi.fn(),
  showToast: vi.fn(),
}))

vi.mock('@/composables/useCitizenCase', async (orig) => {
  const real = await orig<typeof import('@/composables/useCitizenCase')>()
  return {
    ...real,
    useCitizenCase: () => ({
      applications, applicationsLoading: ref(false), refreshApplications: vi.fn(),
      appeals: ref([]), refreshAppeals: vi.fn(),
    }),
  }
})

vi.mock('@/services/developmentManagementService', () => ({ dmApi }))

vi.mock('@/services/citizenPortalService', async (orig) => {
  const real = await orig<typeof import('@/services/citizenPortalService')>()
  return {
    ...real,
    citizenPortalService: { ...real.citizenPortalService, getCaseSnapshot, getCouncil },
  }
})

vi.mock('@/services/paymentsService', () => ({ paymentsService: { listMine } }))

vi.mock('@/composables/useUiFeedback', () => ({
  useUiFeedback: () => ({ showToast, parseApiError: (_e: unknown, m: string) => m }),
}))

import ApplicationsSection from '../ApplicationsSection.vue'
import NoticesSection from '../NoticesSection.vue'
import PaymentsSection from '../PaymentsSection.vue'
import CertificatesSection from '../CertificatesSection.vue'

function router() {
  return createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div/>' } },
      { path: '/payment/:id', component: { template: '<div/>' } },
      { path: '/payment/new', component: { template: '<div/>' } },
      { path: '/contact', component: { template: '<div/>' } },
    ],
  })
}
async function mountWith(comp: any) {
  const r = router()
  r.push('/')
  await r.isReady()
  const w = mount(comp, {
    global: { plugins: [r], stubs: { ApplicationPipeline: true, UiFeedback: true } },
  })
  await flushPromises()
  return { w, r }
}
function chooseFile(input: any, name = 'response.pdf') {
  const file = new File([new Uint8Array(8)], name, { type: 'application/pdf' })
  Object.defineProperty(input.element, 'files', { value: [file], configurable: true })
  return input.trigger('change')
}

beforeEach(() => {
  vi.clearAllMocks()
  applications.value = [permit]
})

describe('ApplicationsSection case detail', () => {
  beforeEach(() => {
    getCaseSnapshot.mockResolvedValue({
      permit, lifecycle: 'public_notice', consultations: [], objections: [], inspections: [], certificate: null,
      documents: [{ id: 'D1', doc_type: 'title_deed', file_name: 'deed.pdf', bytes: 2048, uploaded_at: '2026-09-02T00:00:00Z' }],
      letters: [{ id: 'L1', doc_type: 'acknowledgement', title: 'Acknowledgement letter', version: 1, created_at: '2026-09-03T00:00:00Z' }],
      messages: [{ id: 'M1', message_type: 'document_request', body: 'Please upload a signed site plan.', created_at: '2026-09-04T00:00:00Z', author_name: 'Planner' }],
    })
  })

  it('shows council messages, letters and documents on file', async () => {
    const { w } = await mountWith(ApplicationsSection)
    await w.find('.apps-item').trigger('click')
    await flushPromises()
    const text = w.text()
    expect(text).toContain('Please upload a signed site plan.')
    expect(text).toContain('Acknowledgement letter')
    expect(text).toContain('deed.pdf')
    expect(text).toContain('Documents requested')
  })

  it('uploads a document straight to the case file', async () => {
    dmApi.uploadPermitDocument.mockResolvedValue({ id: 'D2', doc_type: 'site_plan', file_name: 'site.pdf', uploaded_at: '2026-09-05T00:00:00Z' })
    const { w } = await mountWith(ApplicationsSection)
    await w.find('.apps-item').trigger('click')
    await flushPromises()
    await w.find('#apps-upload-type').setValue('site_plan')
    await chooseFile(w.find('.apps-upload input[type=file]'), 'site.pdf')
    await flushPromises()
    expect(dmApi.uploadPermitDocument).toHaveBeenCalledWith('P1', expect.any(File), 'site_plan')
    expect(w.text()).toContain('site.pdf')
  })
})

describe('NoticesSection', () => {
  beforeEach(() => {
    dmApi.listObjections.mockResolvedValue([
      { id: 'O1', objector_name: 'Neighbour', grounds: 'Blocks light', received_at: '2026-09-06T00:00:00Z', resolved_at: null, resolution: null },
    ])
    dmApi.getPublicNotice.mockResolvedValue({
      advert_verified: true, advert_verified_at: '2026-09-05T00:00:00Z', advert_reference: 'Chronicle p.14',
      site_notice_verified: false, abutting_owners_verified: false,
      objection_period_end: '2099-01-01T00:00:00Z', notes: null,
    })
  })

  it('shows council-confirmed duties and uploads a written response instead of posting an objection', async () => {
    dmApi.uploadPermitDocument.mockResolvedValue({ id: 'D9' })
    const { w } = await mountWith(NoticesSection)
    await w.find('.no-btn.primary').trigger('click')
    const text = w.text()
    expect(text).toContain('Confirmed by Council')
    expect(text).toContain('Chronicle p.14')
    expect(text).not.toMatch(/subscribe/i)
    await chooseFile(w.find('.no-response input[type=file]'))
    await flushPromises()
    expect(dmApi.uploadPermitDocument).toHaveBeenCalledWith('P1', expect.any(File), 'objection_response')
    expect(dmApi.createObjection).not.toHaveBeenCalled()
  })
})

describe('PaymentsSection', () => {
  it('lists real payments, shows the council fee, and links receipts to the payment page', async () => {
    getCouncil.mockResolvedValue({ name: 'Vungu RDC', application_fee: 25 })
    listMine.mockResolvedValue([
      { id: 'PAY1', purpose: 'application_fee', relatedId: 'P1', amountUsd: 25, amountZwg: 0, walletCcy: 'USD',
        status: 'paid', paidAt: '2026-09-02T00:00:00Z', createdAt: '2026-09-02T00:00:00Z' },
    ])
    const { w, r } = await mountWith(PaymentsSection)
    const text = w.text()
    expect(text).toContain('USD 25.00')
    expect(text).not.toContain('ZWL')
    await w.find('.pay-table .pay-link').trigger('click')
    await flushPromises()
    expect(r.currentRoute.value.fullPath).toBe('/payment/PAY1')
  })

  it('shows a retry when history fails to load', async () => {
    getCouncil.mockRejectedValue(new Error('x'))
    listMine.mockRejectedValue(new Error('offline'))
    const { w } = await mountWith(PaymentsSection)
    expect(w.find('.pay-error').exists()).toBe(true)
  })
})

describe('CertificatesSection', () => {
  it('makes no authenticity claim it cannot back', async () => {
    applications.value = [{ ...permit, status: 'approved' }]
    const { w } = await mountWith(CertificatesSection)
    const text = w.text()
    expect(text).not.toMatch(/authentic in the|secure ledger|QR authentication/i)
    expect(w.findAll('button').some(b => b.text() === 'Verify')).toBe(false)
  })
})
