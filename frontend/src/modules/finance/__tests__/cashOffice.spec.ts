// @vitest-environment happy-dom
//
// The Cash Office workspace follows the person's duties:
//
//   1. A CASHIER sees the till (Take Payment, Daily Cash Up) and Banking, and no supervision.
//   2. A CASH SUPERVISOR takes no money: no Take Payment, no till; the drawers board and the
//      cash-ups to verify instead, and the dashboard sends them to the drawers board.
//   3. A back-office page without the duty says who holds it rather than drawing the controls.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'

vi.mock('../api/cashApi', () => ({
  cashApi: { desk: vi.fn(), queue: vi.fn(), drawers: vi.fn(), sessions: vi.fn(), deposits: vi.fn() },
}))

import { useFinanceStore } from '../stores/finance'
import { supervisorLanding } from '../workspaces/cashier/routes'
import OfficePage from '../workspaces/cashier/pages/OfficePage.vue'

const CASHIER = ['finance.cash.deposit.prepare', 'finance.cash.receipt.cancel', 'finance.cash.receipt.record',
  'finance.cash.session.operate', 'finance.cash.view', 'finance.rates.receipt.record', 'finance.rates.view']
const SUPERVISOR = ['finance.cash.assignment.manage', 'finance.cash.session.supervise', 'finance.cash.session.verify',
  'finance.cash.view', 'finance.rates.view']

function as(role: string, permissions: string[]) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u1', role, authority_id: 1, permissions, department_scope: [], catalogue: [] } as never
  return store
}

describe('the Cash Office landing', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('keeps a cashier on the dashboard', () => {
    as('cashier', CASHIER)
    expect(supervisorLanding()).toBe(true)
  })

  it('sends a cash supervisor to the drawers board', () => {
    as('cash_supervisor', SUPERVISOR)
    expect(supervisorLanding()).toEqual({ name: 'cashier-drawers' })
  })

  it('sends someone who only verifies to the cash-ups', () => {
    as('accountant', ['finance.cash.view', 'finance.cash.session.verify'])
    expect(supervisorLanding()).toEqual({ name: 'cashier-verify' })
  })

  it('decides nothing before the identity is read', () => {
    expect(supervisorLanding()).toBe(true)
  })
})

describe('a Cash Office back-office page', () => {
  beforeEach(() => { setActivePinia(createPinia()); vi.clearAllMocks() })

  async function open(office: string, permissions: string[]) {
    as('cashier', permissions)
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/x', name: 'x', component: OfficePage, meta: { cwOffice: office, cwTitle: 'Drawers', cwLead: 'Lead' } }],
    })
    await router.push('/x')
    const w = mount(OfficePage, { global: { plugins: [router], stubs: { ReceiptDialog: true } } })
    await flushPromises()
    return w
  }

  it('tells a cashier the drawers board is a supervisor\'s, without its controls', async () => {
    const w = await open('drawers', CASHIER)
    expect(w.text()).toContain('kept by a cash supervisor')
    expect(w.text()).toContain('Your role does not include it')
    expect(w.findAll('button')).toHaveLength(0)
  })

  it('tells a cashier that verifying a cash-up is somebody else\'s', async () => {
    const w = await open('cashups', CASHIER)
    expect(w.text()).toContain('never by the cashier who counted it')
  })

  it('does not refuse banking to a cashier who prepares deposits', async () => {
    const w = await open('banking', CASHIER)
    expect(w.text()).not.toContain('Your role does not include it')
  })
})
