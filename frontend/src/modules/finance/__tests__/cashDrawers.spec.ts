// @vitest-environment happy-dom
//
// The cash supervisor's drawers board (migration 208). Its rules:
//
//   1. NOTHING RELEASES A DRAWER WITHOUT A COUNT. There is no close, release or reset for an open or
//      suspended session; "Find abandoned" appears only when the server says the session may be.
//   2. THE SUPERVISED COUNT IS WITNESSED by somebody who is neither the cashier nor the supervisor,
//      and the witness list offered excludes both.
//   3. A SUPERVISOR NEVER ACTS ON THEIR OWN SESSION, and never assigns themselves.
//   4. PROVISIONAL POLICY IS SAID TO BE PROVISIONAL (decision D29).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../api/cashApi', () => ({
  cashApi: {
    drawers: vi.fn(), witnesses: vi.fn(), abandonSession: vi.fn(), supervisedClose: vi.fn(),
    sessionEvents: vi.fn(), assignments: vi.fn(), assign: vi.fn(), endAssignment: vi.fn(),
  },
}))

import { cashApi } from '../api/cashApi'
import CashDrawers from '../components/cash/CashDrawers.vue'
import { useFinanceStore } from '../stores/finance'
import type { CashDesk, CashDrawer } from '../models/cashTypes'

const api = cashApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const SUPERVISOR = ['finance.cash.view', 'finance.cash.session.supervise', 'finance.cash.assignment.manage', 'finance.cash.session.verify']

const desk = {
  today: '2026-11-13', cash_points: [], income_codes: [], bank_accounts: [], financial_years: [], my_session: null,
  awaiting_verification: 0, till_position: [],
  readiness: { cash_points: 2, income_codes: 1, bank_accounts: 1, year_open_today: true, period_open_today: true, decision: 'D22' },
  policy: { abandon_after_hours: { value: 12, provisional: true, decision: 'D29' }, require_assignment: { value: false, provisional: true, decision: 'D29' } },
} as CashDesk

const drawer = (over: Partial<CashDrawer>): CashDrawer => ({
  cash_point_id: 'p1', code: 'MAIN', name: 'Main counter', location: null, point_status: 'active',
  session_id: 's2', session_no: 'CS-0000002', session_status: 'open', cashier_id: 'u-relief', cashier_name: 'Demo Relief Cashier',
  opened_at: '2026-11-12T05:38:00Z', business_date: '2026-11-12', suspended_at: null, abandoned_at: null,
  abandoned_by_name: null, abandon_reason: null, hours_held: '24.5', may_be_abandoned: true, is_stale: true,
  receipt_count: 1, expected_cash: [{ currency: 'USD', amount: '40.00' }], assigned: [],
  ...over,
})

async function mountBoard(drawers: CashDrawer[], permissions = SUPERVISOR) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u-sup', role: 'cash_supervisor', authority_id: 1, permissions, department_scope: [], catalogue: [] }
  api.drawers.mockResolvedValue({ drawers, awaiting_verification: 1 })
  const w = mount(CashDrawers, { props: { desk }, global: { stubs: { FinancePromptDialog: true } } })
  await flushPromises()
  return w
}
const button = (w: Awaited<ReturnType<typeof mountBoard>>, text: string) => w.findAll('button').find((b) => b.text().includes(text))

describe('the cash supervisor\'s drawers board', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('shows who holds each drawer, what it should hold, and that the threshold is provisional', async () => {
    const w = await mountBoard([drawer({}), drawer({ cash_point_id: 'p2', code: 'SIDE', name: 'Side counter', session_id: null, session_no: null, session_status: null, cashier_id: null, cashier_name: null, may_be_abandoned: false, is_stale: false, expected_cash: [] })])
    expect(w.text()).toContain('Demo Relief Cashier')
    expect(w.text()).toContain('CS-0000002')
    expect(w.text()).toContain('40.00') // what the drawer should hold: float plus cash receipts
    expect(w.text()).toContain('Free — no session holds this drawer')
    expect(w.text()).toContain('Provisional — Council decision D29 pending')
  })

  it('offers no way to close, release or reset an open or suspended session', async () => {
    const w = await mountBoard([drawer({ may_be_abandoned: false, is_stale: false, hours_held: '2.0' }), drawer({ cash_point_id: 'p2', session_status: 'suspended', may_be_abandoned: false, is_stale: false })])
    const labels = w.findAll('button').map((b) => b.text())
    expect(labels.some((l) => /close|release|reset|force/i.test(l))).toBe(false)
    expect(labels.some((l) => l.includes('Find abandoned'))).toBe(false)
    expect(labels.some((l) => l.includes('Count with a witness'))).toBe(false)
    expect(w.text()).toContain('The cashier cashes up their own drawer')
  })

  it('finds a session abandoned only when the server says it may be, and the count comes after', async () => {
    const w = await mountBoard([drawer({})])
    expect(button(w, 'Find abandoned')).toBeDefined()
    expect(button(w, 'Count with a witness')).toBeUndefined()
  })

  it('never offers a supervisor action on the supervisor\'s own session', async () => {
    const w = await mountBoard([drawer({ cashier_id: 'u-sup', cashier_name: 'Me' })])
    expect(button(w, 'Find abandoned')).toBeUndefined()
  })

  it('counts an abandoned drawer with a witness who is neither the cashier nor the supervisor', async () => {
    api.witnesses.mockResolvedValue({ witnesses: [
      { id: 'u-relief', name: 'Demo Relief Cashier', role: 'cashier' },
      { id: 'u-aud', name: 'Demo Auditor', role: 'auditor' },
      { id: 'u-sup', name: 'Me', role: 'cash_supervisor' },
    ] })
    api.supervisedClose.mockResolvedValue({ session: {}, note: 'Counted under supervision and witnessed.' })
    const w = await mountBoard([drawer({ session_status: 'abandoned', abandoned_by_name: 'Me', abandon_reason: 'left without cashing up' })])
    await button(w, 'Count with a witness')!.trigger('click')
    await flushPromises()
    const witnesses = w.findAll('select option').map((o) => o.text())
    expect(witnesses).toContain('Demo Auditor')
    expect(witnesses).not.toContain('Demo Relief Cashier')
    expect(witnesses).not.toContain('Me')

    const form = w.find('form.cdr-count')
    await form.find('select').setValue('u-aud')
    await form.findAll('input')[0].setValue('38.00')
    await form.trigger('submit')
    await flushPromises()
    expect(api.supervisedClose).toHaveBeenCalledWith('s2', 'u-aud', [{ currency: 'USD', declared_total: '38.00' }])
    expect(w.emitted('changed')).toHaveLength(1)
  })

  it('will not record a supervised count without a witness', async () => {
    api.witnesses.mockResolvedValue({ witnesses: [{ id: 'u-aud', name: 'Demo Auditor', role: 'auditor' }] })
    const w = await mountBoard([drawer({ session_status: 'abandoned' })])
    await button(w, 'Count with a witness')!.trigger('click')
    await flushPromises()
    await w.find('form.cdr-count').trigger('submit')
    await flushPromises()
    expect(api.supervisedClose).not.toHaveBeenCalled()
    expect(w.text()).toContain('Name the witness')
  })

  it('does not offer the supervisor as a cashier to assign', async () => {
    api.assignments.mockResolvedValue({ assignments: [], operators: [
      { id: 'u-cash', name: 'Demo Cashier', role: 'cashier' }, { id: 'u-sup', name: 'Me', role: 'cash_supervisor' },
    ] })
    const w = await mountBoard([drawer({})])
    await button(w, 'Assign')!.trigger('click')
    await flushPromises()
    const options = w.findAll('.cdr-assign-form option').map((o) => o.text())
    expect(options).toContain('Demo Cashier')
    expect(options).not.toContain('Me')
  })

  it('shows supervision actions only to whoever holds the permission', async () => {
    const w = await mountBoard([drawer({ session_status: 'abandoned' })], ['finance.cash.view', 'finance.cash.assignment.manage'])
    expect(button(w, 'Count with a witness')).toBeUndefined()
    expect(button(w, 'Find abandoned')).toBeUndefined()
  })
})
