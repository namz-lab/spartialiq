// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import PaymentInitView from '../PaymentInitView.vue'

vi.mock('@/services/paymentsService', () => ({
  paymentsService: { init: vi.fn() },
}))
vi.mock('@/services/citizenPortalService', () => ({
  citizenPortalService: { getCouncil: vi.fn() },
}))
vi.mock('@/services/developmentManagementService', () => ({
  dmApi: { getPermit: vi.fn() },
}))

import { paymentsService } from '@/services/paymentsService'
import { citizenPortalService } from '@/services/citizenPortalService'
import { dmApi } from '@/services/developmentManagementService'

async function mountView(query = { relatedKind: 'permit', relatedId: 'P1' }) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/payment/new', component: PaymentInitView },
      { path: '/payment/:id', name: 'payment', component: { template: '<div>aw</div>' } },
      { path: '/citizen',     component: { template: '<div>portal</div>' } },
    ],
  })
  router.push({ path: '/payment/new', query })
  await router.isReady()
  const w = mount(PaymentInitView, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

describe('PaymentInitView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(citizenPortalService.getCouncil as any).mockResolvedValue({
      name: 'Vungu Rural District Council', application_fee: 25,
    })
    ;(dmApi.getPermit as any).mockResolvedValue({ id: 'P1' })
  })

  it('initiates a payment and routes to the awaiting screen on submit', async () => {
    ;(paymentsService.init as any).mockResolvedValue({ id: 'PAY1' })

    const { w, router } = await mountView()
    await w.find('[data-tile="ecocash"]').trigger('click')
    await w.find('input[name="pmp-phone"]').setValue('0771234567')
    await w.find('[data-test="pmp-pay"]').trigger('click')
    await flushPromises()

    expect(paymentsService.init).toHaveBeenCalledWith({
      purpose:     'application_fee',
      relatedKind: 'permit',
      relatedId:   'P1',
      priceUsd:    25,
      walletCcy:   'USD',
      driver:      'paynow',
      metadata:    { phone: '+263771234567', wallet: 'ecocash' },
    })
    expect(router.currentRoute.value.path).toBe('/payment/PAY1')
  })

  it('routes back to /citizen on cancel', async () => {
    const { w, router } = await mountView()
    await w.find('[data-test="pmp-close"]').trigger('click')
    await flushPromises()
    expect(router.currentRoute.value.path).toBe('/citizen')
  })
})
