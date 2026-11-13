// @vitest-environment happy-dom
//
// The cashier's counter. Four of its rules are controls rather than conveniences:
//
//   1. A TILL THAT CANNOT BE OPENED SAYS WHY, naming who sets it up, rather than offering a form
//      that would be refused.
//   2. THE COUNT IS DECLARED BLIND. An open session never shows its own cashier a total of the
//      day's takings, and the cash-up form asks for the count before any difference is shown.
//   3. THE COUNCIL'S CHARGE IS NOT EDITABLE AT THE COUNTER, and is not sent: the database supplies it.
//   4. NO RECEIPT NUMBER AND NO DATE ARE EVER SENT. Both are issued by the server.
//   5. A HELD DRAWER IS NAMED, with who holds it and in what state (migration 208). A drawer is freed
//      by a count, so the counter never offers a held one, and a suspended or abandoned session
//      takes no payments.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../api/cashApi', () => ({
  cashApi: {
    openSession: vi.fn(), issueReceipt: vi.fn(), issueRatesReceipt: vi.fn(),
    cancelReceipt: vi.fn(), closeSession: vi.fn(), suspendSession: vi.fn(), resumeSession: vi.fn(),
  },
}))
vi.mock('../api/ratesApi', () => ({ ratesApi: { accounts: vi.fn(), bills: vi.fn() } }))

import { cashApi } from '../api/cashApi'
import CashCounter from '../components/cash/CashCounter.vue'
import { useFinanceStore } from '../stores/finance'
import type { FinanceIdentity } from '../models/types'
import type { CashDesk, CashierSessionDetail } from '../models/cashTypes'

const api = cashApi as unknown as Record<string, ReturnType<typeof vi.fn>>

const CASHIER = ['finance.cash.view', 'finance.cash.session.operate', 'finance.cash.receipt.record',
  'finance.cash.receipt.cancel', 'finance.rates.view', 'finance.rates.receipt.record']

const identity = (permissions: string[]): FinanceIdentity => ({
  user_id: 'u-cashier', role: 'cashier', authority_id: 1, permissions, department_scope: [], catalogue: [],
})

const SESSION: CashierSessionDetail = {
  id: 's1', session_no: 'CS-0000004', status: 'open', business_date: '2026-11-12',
  cash_point_id: 'p1', cash_point_code: 'MAIN', cash_point_name: 'Main counter', difference_account_set: true,
  cashier_id: 'u-cashier', cashier_name: 'Demo Cashier', financial_year_id: 'y1', financial_year_label: 'DD 2026/27',
  opened_at: '2026-11-12T06:00:00Z', closed_at: null, verified_at: null, verified_by: null, verified_by_name: null,
  verify_note: null, returned_at: null, returned_by_name: null, return_reason: null,
  receipt_count: 1, cancelled_count: 0, counts: [], totals: [], totals_withheld: true,
  receipts: [{
    id: 'r1', source: 'sundry', receipt_no: 'RC-0000011', payer_name: 'T. Moyo', party_id: null, currency: 'USD',
    amount: '40.00', method: 'cash', method_reference: null, voucher_id: 'v1', voucher_status: 'draft',
    is_cancelled: false, cancel_reason: null, is_physical: true, received_on: '2026-11-12',
    created_at: '2026-11-12T07:00:00Z', cashier_session_id: 's1', narration: null,
  }],
}

const desk = (over: Partial<CashDesk> = {}): CashDesk => ({
  today: '2026-11-12',
  cash_points: [{ id: 'p1', code: 'MAIN', name: 'Main counter', location: null, status: 'active', difference_account_set: true, open_session_id: null }],
  income_codes: [
    { id: 'c-hall', code: 'HALL', name: 'Hall hire', pricing: 'fixed', unit_amount_usd: '40.00', unit_amount_zwg: null, status: 'active' },
    { id: 'c-mkt', code: 'MKT', name: 'Market fee', pricing: 'variable', unit_amount_usd: null, unit_amount_zwg: null, status: 'active' },
  ],
  bank_accounts: [{ id: 'b1', code: '1100', name: 'CBZ current' }],
  financial_years: [{ id: 'y1', label: 'DD 2026/27', start_date: '2026-07-01', end_date: '2027-06-30', period_open_today: true }],
  my_session: null, awaiting_verification: 0, till_position: [],
  readiness: { cash_points: 1, income_codes: 2, bank_accounts: 1, year_open_today: true, period_open_today: true, decision: 'D22' },
  ...over,
})

function mountCounter(d: CashDesk, permissions = CASHIER) {
  const store = useFinanceStore()
  store.identity = identity(permissions)
  return mount(CashCounter, { props: { desk: d }, global: { stubs: { FinancePromptDialog: true } } })
}

describe('the cashier\'s counter', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  it('says why a till cannot be opened, and who sets it up, rather than offering a form', () => {
    const w = mountCounter(desk({ cash_points: [], readiness: { cash_points: 0, income_codes: 0, bank_accounts: 0, year_open_today: true, period_open_today: true, decision: 'D22' } }))
    expect(w.text()).toContain('A till cannot be opened yet')
    expect(w.text()).toContain('D22')
    expect(w.find('form').exists()).toBe(false)
  })

  it('names the closed accounting period when that is what stops the day', () => {
    const w = mountCounter(desk({ readiness: { cash_points: 1, income_codes: 2, bank_accounts: 1, year_open_today: true, period_open_today: false, decision: 'D22' } }))
    expect(w.text()).toContain('could never be posted')
  })

  it('opens a till with the float and sends no date', async () => {
    api.openSession.mockResolvedValue({ session: SESSION })
    const w = mountCounter(desk())
    const inputs = w.findAll('input.cash-num')
    await inputs[0].setValue('50.00')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.openSession).toHaveBeenCalledWith({ cash_point_id: 'p1', financial_year_id: 'y1', floats: [{ currency: 'USD', amount: '50.00' }] })
    expect(JSON.stringify(api.openSession.mock.calls[0][0])).not.toMatch(/date/)
    expect(w.emitted('changed')).toHaveLength(1)
  })

  it('does not choose between two open financial years on the cashier\'s behalf', () => {
    const w = mountCounter(desk({ financial_years: [
      { id: 'y1', label: 'DD 2026/27', start_date: '2026-07-01', end_date: '2027-06-30', period_open_today: true },
      { id: 'y2', label: 'DEMO 2026', start_date: '2026-01-01', end_date: '2026-12-31', period_open_today: true },
    ] }))
    expect(w.text()).toContain('it is not chosen for you')
    expect(w.find('button[type="submit"]').attributes('disabled')).toBeDefined()
  })

  it('shows an open session its receipts but no total of the day\'s takings', () => {
    const w = mountCounter(desk({ my_session: SESSION }))
    expect(w.text()).toContain('RC-0000011')
    expect(w.text()).toContain('T. Moyo')
    // "To collect" is the payment being keyed. Nothing sums the session.
    expect(w.text()).not.toMatch(/takings|total for the day|expected/i)
  })

  it('locks the Council\'s fixed charge, and sends the line without an amount or a receipt number', async () => {
    api.issueReceipt.mockResolvedValue({ receipt: { ...SESSION.receipts[0], id: 'r2', receipt_no: 'RC-0000012' } })
    const w = mountCounter(desk({ my_session: SESSION }))
    await w.find('input[placeholder^="Name of the person"]').setValue('R. Dube')
    await w.find('.cash-line-code select').setValue('c-hall')
    const amount = w.find('.cash-line-amt input')
    expect(amount.attributes('disabled')).toBeDefined()
    expect((amount.element as HTMLInputElement).value).toBe('40.00')
    expect(w.text()).toContain('Set by Council')
    expect(w.find('.cash-total strong').text()).toContain('40.00')

    await w.findAll('form').at(-1)!.trigger('submit')
    await flushPromises()
    const body = api.issueReceipt.mock.calls[0][0]
    expect(body).toEqual({
      session_id: 's1', currency: 'USD', method: 'cash', payer_name: 'R. Dube',
      lines: [{ income_code_id: 'c-hall' }],
    })
    expect(w.text()).toContain('RC-0000012')
  })

  it('will not issue a non-cash receipt without the account it was paid into and its reference', async () => {
    const w = mountCounter(desk({ my_session: SESSION, bank_accounts: [
      { id: 'b1', code: '1100', name: 'CBZ current' }, { id: 'b2', code: '1110', name: 'EcoCash wallet' },
    ] }))
    await w.find('input[placeholder^="Name of the person"]').setValue('R. Dube')
    await w.find('.cash-line-code select').setValue('c-mkt')
    await w.find('.cash-line-amt input').setValue('12.00')
    const mobile = w.findAll('.cash-methods button').find((b) => b.text() === 'Mobile money')!
    await mobile.trigger('click')
    await w.findAll('form').at(-1)!.trigger('submit')
    await flushPromises()
    expect(api.issueReceipt).not.toHaveBeenCalled()
    expect(w.find('.cash-problem').text()).toContain('bank or wallet account')
  })

  it('asks for the count before showing any difference, and only then for an explanation', async () => {
    api.closeSession.mockRejectedValueOnce({ response: { data: { message: 'the USD count differs from the receipts by -2.00, and a difference is explained in writing before the session can be closed' } } })
    const w = mountCounter(desk({ my_session: SESSION }))
    await w.findAll('button').find((b) => b.text() === 'Cash up')!.trigger('click')
    expect(w.text()).toContain('You are not shown what the receipts add up to first')
    expect(w.find('textarea').exists()).toBe(false)

    await w.find('input.cash-num-lg').setValue('38.00')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(api.closeSession).toHaveBeenCalledWith('s1', [{ currency: 'USD', declared_total: '38.00' }])
    expect(w.text()).toContain('differs from the receipts by -2.00')
    expect(w.find('textarea').exists()).toBe(true)
  })

  it('shows a declared count read-only, waiting on somebody else', () => {
    const closed: CashierSessionDetail = {
      ...SESSION, status: 'closed', closed_at: '2026-11-12T15:00:00Z', totals_withheld: false,
      counts: [{ currency: 'USD', opening_float: '50.00', expected_takings: '40.00', declared_total: '88.00', variance: '-2.00', explanation: 'Change given in error' }],
    }
    const w = mountCounter(desk({ my_session: closed }))
    expect(w.text()).toContain('Awaiting verification')
    expect(w.text()).toContain('Somebody else now agrees it')
    expect(w.text()).toContain('Change given in error')
    expect(w.text()).not.toContain('Issue receipt')
  })

  // ── Migration 208: the session lifecycle ──────────────────────────────────────────────────────

  it('names who holds each drawer when none is free, instead of "every cash point already has a session open"', () => {
    const w = mountCounter(desk({ cash_points: [{
      id: 'p1', code: 'MAIN', name: 'Main counter', location: null, status: 'active', difference_account_set: true,
      open_session_id: 's9', held_session_no: 'CS-0000002', held_state: 'open', held_by_id: 'u-relief',
      held_by_name: 'Demo Relief Cashier', held_since: '2026-11-12T05:38:00Z', held_stale: false, assigned_to_me: false,
    }] }))
    expect(w.text()).toContain('A till cannot be opened yet')
    expect(w.text()).toContain('Main counter is held by Demo Relief Cashier (open since')
    expect(w.text()).toContain('a cash supervisor can find the session abandoned and count it with a witness')
    expect(w.text()).not.toContain('Every cash point already has a session open')
    expect(w.find('form').exists()).toBe(false)
  })

  it('offers assigned drawers first and never a held one', () => {
    const w = mountCounter(desk({ cash_points: [
      { id: 'p1', code: 'A', name: 'Hall counter', location: null, status: 'active', difference_account_set: true, open_session_id: null, assigned_to_me: false },
      { id: 'p2', code: 'B', name: 'Rates counter', location: null, status: 'active', difference_account_set: true, open_session_id: null, assigned_to_me: true },
      { id: 'p3', code: 'C', name: 'Market counter', location: null, status: 'active', difference_account_set: true, open_session_id: 's3', held_by_name: 'T. Ncube', held_state: 'suspended' },
    ] }))
    const options = w.findAll('select option').map((o) => o.text())
    expect(options[0]).toContain('Rates counter')
    expect(options[0]).toContain('(assigned to you)')
    expect(options.some((o) => o.includes('Market counter'))).toBe(false)
    expect(w.text()).toContain('Market counter (T. Ncube)')
  })

  it('offers only assigned drawers when the Council requires assignment', () => {
    const w = mountCounter(desk({
      policy: { abandon_after_hours: { value: 12, provisional: true, decision: 'D29' }, require_assignment: { value: true, provisional: true, decision: 'D29' } },
    }))
    expect(w.text()).toContain('None of the free cash points is assigned to you')
  })

  it('suspends an open till, and a suspended one takes no payment but can be resumed', async () => {
    api.suspendSession.mockResolvedValue({ session: { ...SESSION, status: 'suspended' } })
    const open = mountCounter(desk({ my_session: SESSION }))
    const suspend = open.findAll('button').find((b) => b.text().includes('Suspend'))!
    await suspend.trigger('click')
    await flushPromises()
    expect(api.suspendSession).toHaveBeenCalledWith('s1')
    expect(open.emitted('changed')).toHaveLength(1)

    api.resumeSession.mockResolvedValue({ session: SESSION })
    const w = mountCounter(desk({ my_session: { ...SESSION, status: 'suspended', suspended_at: '2026-11-12T10:00:00Z' } }))
    expect(w.text()).toContain('The drawer is still yours')
    expect(w.find('form.pos-form').exists()).toBe(false)
    await w.findAll('button').find((b) => b.text().includes('Resume'))!.trigger('click')
    await flushPromises()
    expect(api.resumeSession).toHaveBeenCalledWith('s1')
  })

  it('tells the cashier their session was found abandoned, by whom and why, and offers nothing to do', () => {
    const w = mountCounter(desk({ my_session: {
      ...SESSION, status: 'abandoned', abandoned_at: '2026-11-13T06:00:00Z', abandoned_by_name: 'Demo Cash Supervisor',
      abandon_reason: 'cashier left at 16:00 without cashing up',
    } }))
    expect(w.text()).toContain('found abandoned by Demo Cash Supervisor')
    expect(w.text()).toContain('cashier left at 16:00 without cashing up')
    expect(w.text()).toContain('count the drawer with a witness')
    expect(w.find('form').exists()).toBe(false)
    expect(w.findAll('button').some((b) => /Cash up|Resume|Issue/.test(b.text()))).toBe(false)
  })

  it('takes no payment in a session from an earlier business day, and offers only the cash-up', () => {
    const w = mountCounter(desk({ today: '2026-11-13', my_session: SESSION }))
    expect(w.text()).toContain('This session belongs to')
    expect(w.find('form.pos-form').exists()).toBe(false)
    expect(w.findAll('button').some((b) => b.text().includes('Suspend'))).toBe(false)
    expect(w.findAll('button').some((b) => b.text().includes('Cash up'))).toBe(true)
  })

  it('says a count was made under supervision, with the witness, when it was', () => {
    const w = mountCounter(desk({ my_session: {
      ...SESSION, status: 'closed', closed_at: '2026-11-13T07:00:00Z', closed_by: 'u-sup', closed_by_name: 'Demo Cash Supervisor',
      witness_id: 'u-aud', witness_name: 'Demo Auditor', totals_withheld: false,
      counts: [{ currency: 'USD', opening_float: '50.00', expected_takings: '40.00', declared_total: '88.00', variance: '-2.00', explanation: 'short in the coin tray' }],
    } }))
    expect(w.text()).toContain('counted under supervision by Demo Cash Supervisor')
    expect(w.text()).toContain('witnessed by Demo Auditor')
    expect(w.text()).not.toContain('You declared the count')
  })
})
