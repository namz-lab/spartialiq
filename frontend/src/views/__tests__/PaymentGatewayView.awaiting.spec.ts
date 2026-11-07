// @vitest-environment happy-dom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('@/services/paymentsService', () => ({
  paymentsService: {
    get:    vi.fn(),
    poll:   vi.fn(),
    cancel: vi.fn(),
  },
}))

import { paymentsService } from '@/services/paymentsService'
import PaymentGatewayView from '../PaymentGatewayView.vue'

async function mountView(id = 'PAY1') {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/payment/:id', component: PaymentGatewayView },
      { path: '/citizen',     component: { template: '<div/>' } },
    ],
  })
  router.push(`/payment/${id}`)
  await router.isReady()
  const w = mount(PaymentGatewayView, { global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}

describe('PaymentGatewayView (awaiting/success)', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('shows awaiting state while status=awaiting_provider', async () => {
    ;(paymentsService.get as any).mockResolvedValue({
      id: 'PAY1', status: 'awaiting_provider',
      amountUsd: 25, walletCcy: 'USD',
      metadata: { phone: '+263771234567' },
    })
    const { w } = await mountView()
    expect(w.text()).toMatch(/check your phone/i)
    expect(w.text()).toContain('+263771234567')
  })

  it('Check Now hits poll() and transitions to success on paid', async () => {
    ;(paymentsService.get as any).mockResolvedValue({
      id: 'PAY1', status: 'awaiting_provider',
      amountUsd: 25, walletCcy: 'USD', metadata: {},
    })
    ;(paymentsService.poll as any).mockResolvedValue({
      id: 'PAY1', status: 'paid', amountUsd: 25, walletCcy: 'USD',
      issuedReceiptNo: 'VRDC-2026-000001', paidAt: '2026-05-31T10:00:00Z',
      driver: 'paynow', metadata: {},
    })
    const { w } = await mountView()
    await w.find('[data-test="pgw-check-now"]').trigger('click')
    await flushPromises()
    expect(paymentsService.poll).toHaveBeenCalledWith('PAY1')
    expect(w.text()).toMatch(/payment successful/i)
    expect(w.text()).toContain('VRDC-2026-000001')
  })
})
