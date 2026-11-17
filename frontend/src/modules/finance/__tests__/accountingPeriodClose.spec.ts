// @vitest-environment happy-dom
//
// Period Close and the year end. Its rules:
//
//   1. A READY PERIOD CLOSES AT ONCE; A NOT-READY ONE ASKS FIRST AND LISTS WHAT IS OUTSTANDING.
//   2. LOCKING IS FINAL AND SAYS SO; ESC CANCELS WITHOUT A CALL.
//   3. THE YEAR-END CARD APPEARS ONLY WHEN NO PERIOD IS OPEN, AND ONLY TO THOSE WHO MAY USE IT.
//   4. NO CONTROL IS DRAWN THAT CAN ONLY BE REFUSED; AN ABSENT RIGHT IS EXPLAINED IN WORDS.
//   5. WITH NO YEAR SELECTED NOTHING IS ASKED OF THE SERVER.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../api/ledgerApi', () => ({
  ledgerApi: { periods: vi.fn(), openPeriods: vi.fn(), setPeriodStatus: vi.fn(), closeYear: vi.fn() },
}))
vi.mock('../api/accountingApi', () => ({
  accountingApi: { periodReadiness: vi.fn(), yearEnd: vi.fn() },
}))

import { ledgerApi } from '../api/ledgerApi'
import { accountingApi } from '../api/accountingApi'
import PeriodClosePage from '../workspaces/accountant/pages/PeriodClosePage.vue'
import { useFinanceStore } from '../stores/finance'

const api = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const acc = accountingApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })
const MANAGER = ['finance.ledger.view', 'finance.ledger.period.manage', 'finance.ledger.close_year']

const period = (n: number, status = 'open', over: Record<string, unknown> = {}) => ({
  id: `p${n}`, financial_year_id: 'y1', period_no: n, label: `Period ${n}`,
  from_date: `2026-0${n}-01`, to_date: `2026-0${n}-28`, status, closed_at: null, locked_at: null, entry_count: n * 3, ...over,
})
const check = (key: string, label: string, count: number, target: string | null = null) => ({
  key, label, count, ok: count === 0, detail: null, target,
})
const readiness = (n: number, over: Record<string, unknown> = {}) => ({
  period: { id: `p${n}`, period_no: n, label: `Period ${n}`, from_date: '2026-01-01', to_date: '2026-01-28', status: 'open' },
  checks: [check('draft_vouchers', 'Draft vouchers', 0, 'acc-journals'), check('cashups_unverified', 'Cash-ups not verified', 0, 'acc-cashups')],
  books: [{ currency: 'USD', balances: true, difference: '0.00' }], ready: true, ...over,
})
const notReady = (n: number) => readiness(n, {
  checks: [check('draft_vouchers', 'Draft vouchers', 2, 'acc-journals'), check('cashups_unverified', 'Cash-ups not verified', 0, 'acc-cashups')],
  ready: false,
})
const yearEnd = (over: Record<string, unknown> = {}) => ({
  year: { id: 'y1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open' }, periods_open: 0,
  books: [{ currency: 'USD', closed: false, revenue: '150.00', expenditure: '100.00', surplus: '50.00', side: 'surplus', closing_voucher: null, pending_closing: null, to_close: true }],
  surplus_account: { id: 'a1', code: '3100', name: 'Accumulated surplus' },
  posters: [{ id: 'u-fd', name: 'Finance Director' }], ...over,
})

let mounted: VueWrapper[] = []
async function setup(opts: { permissions?: string[]; year?: string | null } = {}) {
  const store = useFinanceStore()
  store.identity = { user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: opts.permissions ?? MANAGER, department_scope: [], catalogue: [] }
  store.selectedYearId = opts.year === undefined ? 'y1' : opts.year
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/close', name: 'acc-close', component: PeriodClosePage },
      { path: '/journals', name: 'acc-journals', component: Stub },
      { path: '/cash-ups', name: 'acc-cashups', component: Stub },
      { path: '/ledger', name: 'acc-ledger', component: Stub },
      { path: '/journals/:id', name: 'acc-voucher', component: Stub },
    ],
  })
  await router.push('/close')
  await router.isReady()
  const w = mount(defineComponent({ render: () => h(RouterView) }), { attachTo: document.body, global: { plugins: [router] } })
  mounted.push(w)
  await flushPromises()
  return { w, router }
}
type W = Awaited<ReturnType<typeof setup>>['w']
const button = (w: W, text: string) => w.findAll('button').find((b) => b.text().includes(text))
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

describe('Period Close and the year end', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    document.body.innerHTML = ''
    api.periods.mockResolvedValue({ periods: [period(1), period(2)], total: 2 })
    acc.periodReadiness.mockImplementation(async (id: string) => readiness(Number(id.slice(1))))
    acc.yearEnd.mockResolvedValue(yearEnd({ periods_open: 2 }))
  })
  afterEach(() => { mounted.forEach((w) => w.unmount()); mounted = [] })

  it('lists the periods and shows the checks with counts and links', async () => {
    acc.periodReadiness.mockResolvedValue(notReady(1))
    const { w } = await setup()
    expect(api.periods).toHaveBeenCalledWith({ financial_year_id: 'y1' })
    expect(acc.periodReadiness).toHaveBeenCalledWith('p1')
    expect(w.text()).toContain('Period 2')
    expect(w.text()).toContain('Not ready to close')
    expect(w.text()).toContain('Draft vouchers')
    const link = w.findAll('a').find((a) => a.text().includes('Go and clear it'))!
    expect(link.attributes('href')).toBe('/journals')
    expect(w.text()).toContain('USD book')
  })

  it('asks before closing a not-ready period and lists what is outstanding', async () => {
    acc.periodReadiness.mockResolvedValue(notReady(1))
    api.setPeriodStatus.mockResolvedValue({})
    const { w } = await setup()
    await button(w, 'Close period')!.trigger('click')
    const dlg = w.find('[role="alertdialog"]')
    expect(dlg.exists()).toBe(true)
    expect(dlg.text()).toContain('Draft vouchers: 2')
    expect(api.setPeriodStatus).not.toHaveBeenCalled()
    await button(w, 'Close anyway')!.trigger('click')
    await flushPromises()
    expect(api.setPeriodStatus).toHaveBeenCalledWith('p1', 'closed')
  })

  it('closes a ready period without asking', async () => {
    api.setPeriodStatus.mockResolvedValue({})
    const { w } = await setup()
    await button(w, 'Close period')!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alertdialog"]').exists()).toBe(false)
    expect(api.setPeriodStatus).toHaveBeenCalledWith('p1', 'closed')
    expect(w.text()).toContain('Period 1 is closed.')
  })

  it('Lock says it is final and Esc cancels without a call', async () => {
    api.periods.mockResolvedValue({ periods: [period(1, 'closed')], total: 1 })
    const { w } = await setup()
    await button(w, 'Lock period')!.trigger('click')
    const dlg = w.find('[role="alertdialog"]')
    expect(dlg.text()).toContain('Locking is final')
    await dlg.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(w.find('[role="alertdialog"]').exists()).toBe(false)
    expect(api.setPeriodStatus).not.toHaveBeenCalled()
    await button(w, 'Lock period')!.trigger('click')
    const confirmBtn = w.findAll('.cw-dialog button').find((b) => b.text() === 'Lock period')!
    await confirmBtn.trigger('click')
    await flushPromises()
    expect(api.setPeriodStatus).toHaveBeenCalledWith('p1', 'locked')
  })

  it('reopens a closed period', async () => {
    api.periods.mockResolvedValue({ periods: [period(1, 'closed')], total: 1 })
    api.setPeriodStatus.mockResolvedValue({})
    const { w } = await setup()
    await button(w, 'Reopen period')!.trigger('click')
    await flushPromises()
    expect(api.setPeriodStatus).toHaveBeenCalledWith('p1', 'open')
  })

  it('shows a server refusal', async () => {
    api.setPeriodStatus.mockRejectedValue({ response: { data: { message: 'Period 2 must be closed first.' } } })
    const { w } = await setup()
    await button(w, 'Close period')!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('Period 2 must be closed first.')
  })

  it('shows the readiness of the period chosen last when responses arrive out of order', async () => {
    const slow = deferred<ReturnType<typeof readiness>>()
    acc.periodReadiness.mockImplementation((id: string) => (id === 'p1' ? slow.promise : Promise.resolve(notReady(2))))
    const { w } = await setup()
    await w.findAll('button').find((b) => b.attributes('aria-label') === 'Check Period 2')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Draft vouchers')
    slow.resolve(readiness(1))
    await flushPromises()
    expect(w.text()).toContain('Not ready to close')
    expect(w.text()).not.toContain('Ready to close.')
  })

  it('does not offer Close, Reopen or Lock to someone without the right, and says why', async () => {
    const { w } = await setup({ permissions: ['finance.ledger.view'] })
    expect(button(w, 'Close period')).toBeUndefined()
    expect(w.text()).toContain('reserved to roles holding "Manage accounting periods"')
  })

  it('offers the twelve monthly periods to a holder when there are none', async () => {
    api.periods.mockResolvedValue({ periods: [], total: 0 })
    api.openPeriods.mockResolvedValue({ note: 'Opened 12 periods.' })
    const { w } = await setup()
    const b = button(w, 'Open the twelve monthly periods')!
    expect(b).toBeTruthy()
    await b.trigger('click')
    await flushPromises()
    expect(api.openPeriods).toHaveBeenCalledWith({ financial_year_id: 'y1', periodicity: 'monthly' })
  })

  it('explains to a non-holder that there are no periods and who can open them', async () => {
    api.periods.mockResolvedValue({ periods: [], total: 0 })
    const { w } = await setup({ permissions: ['finance.ledger.view'] })
    expect(button(w, 'Open the twelve monthly periods')).toBeUndefined()
    expect(w.text()).toContain('no accounting periods yet')
    expect(w.text()).toContain('Opening them is reserved to roles holding "Manage accounting periods"')
  })

  it('has no year-end card while a period is open and says to close every period first', async () => {
    const { w } = await setup()
    expect(w.text()).toContain('Close every period first')
    expect(w.text()).not.toContain('Year end')
    expect(button(w, 'Close the USD book')).toBeUndefined()
  })

  it('raises the closing as a draft without naming a poster, links it and moves focus to the notice', async () => {
    acc.yearEnd.mockResolvedValue(yearEnd())
    api.closeYear.mockResolvedValue({
      closing_voucher: { id: 'v8', voucher_no: 'YC-0000001', currency: 'USD', posting_date: '2026-12-31', status: 'draft', entries: 0, version: 1 },
      awaiting_post: true, note: 'Closing voucher YC-0000001 is a draft. It changes nothing until somebody other than you posts it.',
    })
    const { w } = await setup()
    expect(w.find('select').exists()).toBe(false)
    expect(w.text()).toContain('Surplus')
    expect(w.text()).toContain('50.00')
    expect(w.text()).toContain('Someone other than you must post it: 1 person may.')
    await button(w, 'Close the USD book')!.trigger('click')
    await flushPromises()
    expect(api.closeYear).toHaveBeenCalledWith({ financial_year_id: 'y1', currency: 'USD' })
    const status = w.find('[role="status"]')
    expect(status.text()).toContain('is a draft')
    expect(status.text()).not.toContain('is closed')
    expect(status.findAll('a').find((a) => a.text() === 'Open YC-0000001')!.attributes('href')).toBe('/journals/v8')
    expect(document.activeElement).toBe(status.element)
    expect(status.attributes('tabindex')).toBe('-1')
  })

  it('keeps the status region mounted when there is nothing to say', async () => {
    const { w } = await setup()
    expect(w.find('[role="status"]').exists()).toBe(true)
  })

  it('says a pending closing is waiting to be posted, links it, and offers no Close button', async () => {
    acc.yearEnd.mockResolvedValue(yearEnd({ books: [{ currency: 'USD', closed: false, revenue: '150.00', expenditure: '100.00', surplus: '50.00', side: 'surplus', closing_voucher: null, pending_closing: { id: 'v8', voucher_no: 'YC-0000001', prepared_by_name: 'Tendai Moyo' }, to_close: true }] }))
    const { w } = await setup()
    expect(w.text()).toContain('prepared by Tendai Moyo, is waiting to be posted by someone else')
    expect(w.text()).toContain('Tendai Moyo')
    expect(w.findAll('a').find((a) => a.text() === 'YC-0000001')!.attributes('href')).toBe('/journals/v8')
    expect(button(w, 'Close the USD book')).toBeUndefined()
    expect(button(w, 'Close the remainder')).toBeUndefined()
  })

  it('words a book that is not closed but has a standing closing as a remainder', async () => {
    acc.yearEnd.mockResolvedValue(yearEnd({ books: [{ currency: 'USD', closed: false, revenue: '0.00', expenditure: '30.00', surplus: '30.00', side: 'deficit', closing_voucher: { id: 'v9', voucher_no: 'YC-0000001' }, pending_closing: null, to_close: true }] }))
    api.closeYear.mockResolvedValue({ closing_voucher: { id: 'v10', voucher_no: 'YC-0000002', currency: 'USD', posting_date: '2026-12-31', status: 'draft', entries: 0, version: 1 }, awaiting_post: true, note: '' })
    const { w } = await setup()
    expect(w.text()).toContain('A remainder is left after YC-0000001: deficit US$ 30.00')
    expect(button(w, 'Close the USD book')).toBeUndefined()
    await button(w, 'Close the remainder')!.trigger('click')
    await flushPromises()
    expect(api.closeYear).toHaveBeenCalledWith({ financial_year_id: 'y1', currency: 'USD' })
    expect(w.find('[role="status"]').text()).toContain('is a draft')
  })

  const closedBook = { currency: 'USD', closed: true, revenue: '150.00', expenditure: '100.00', surplus: '50.00', side: 'surplus', closing_voucher: { id: 'v9', voucher_no: 'YC-0000001' }, pending_closing: null, to_close: false }
  const remainderBook = { ...closedBook, closed: false, revenue: '0.00', expenditure: '30.00', surplus: '30.00', side: 'deficit', to_close: true }

  it('shows the server sentence instead of Reopen, and no Reopen button, when the server refuses it', async () => {
    const message = 'A remainder is left in the USD book of 2026 after YC-0000001. Reverse the year-end closing first.'
    api.periods.mockResolvedValue({ periods: [period(1, 'closed', { reopen_refusal: { error: 'year_closed', message } })], total: 1 })
    acc.yearEnd.mockResolvedValue(yearEnd({ books: [remainderBook] }))
    const { w } = await setup()
    expect(button(w, 'Reopen period')).toBeUndefined()
    expect(w.text()).toContain(message)
    expect(w.text()).not.toContain('is closed by')
    expect(button(w, 'Lock period')).toBeDefined()
  })

  it('shows the server sentence instead of Lock, and no Lock button, when the server refuses it', async () => {
    const message = 'Period 1 is the last of 2026, and the USD book still has revenue or expenditure to close. Close the year first.'
    api.periods.mockResolvedValue({ periods: [period(1, 'closed', { is_final: true, lock_refusal: { error: 'year_not_closed', message } })], total: 1 })
    const { w } = await setup()
    expect(button(w, 'Lock period')).toBeUndefined()
    expect(w.text()).toContain(message)
    expect(button(w, 'Reopen period')).toBeDefined()
  })

  it('still offers Lock on a non-final closed period while a book is unclosed', async () => {
    api.periods.mockResolvedValue({ periods: [period(1, 'closed', { is_final: false, lock_refusal: null, reopen_refusal: null })], total: 1 })
    acc.yearEnd.mockResolvedValue(yearEnd())
    const { w } = await setup()
    await button(w, 'Lock period')!.trigger('click')
    expect(w.find('[role="alertdialog"]').text()).toContain('Locking is final')
    expect(button(w, 'Reopen period')).toBeDefined()
  })

  it('offers Lock on the final period when the server does not refuse it', async () => {
    api.periods.mockResolvedValue({ periods: [period(1, 'closed', { is_final: true, lock_refusal: null, reopen_refusal: null })], total: 1 })
    acc.yearEnd.mockResolvedValue(yearEnd({ books: [closedBook] }))
    const { w } = await setup()
    expect(button(w, 'Lock period')).toBeDefined()
  })

  it('shows year_not_closed inside the Lock dialog when the server refuses the confirmed lock', async () => {
    api.periods.mockResolvedValue({ periods: [period(1, 'closed', { is_final: true })], total: 1 })
    api.setPeriodStatus.mockRejectedValue({ response: { status: 409, data: { error: 'year_not_closed', message: 'Period 1 is the last of 2026. Close the year first.' } } })
    const { w } = await setup()
    await button(w, 'Lock period')!.trigger('click')
    await w.findAll('.cw-dialog button').find((b) => b.text() === 'Lock period')!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alertdialog"]').text()).toContain('Close the year first.')
    expect(api.setPeriodStatus).toHaveBeenCalledWith('p1', 'locked')
  })

  it('shows year_closed when a stale page presses Reopen', async () => {
    api.periods.mockResolvedValue({ periods: [period(1, 'closed')], total: 1 })
    acc.yearEnd.mockResolvedValue(yearEnd({ books: [{ ...closedBook, closed: false, closing_voucher: null, to_close: true }] }))
    api.setPeriodStatus.mockRejectedValue({ response: { status: 409, data: { error: 'year_closed', message: 'The USD book of 2026 is closed by YC-1. Reverse the year-end closing first.' } } })
    const { w } = await setup()
    await button(w, 'Reopen period')!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('Reverse the year-end closing first.')
  })

  it('offers no Close button when nothing is left to close, and says so', async () => {
    acc.yearEnd.mockResolvedValue(yearEnd({ books: [{ ...closedBook, closed: false, closing_voucher: null, to_close: false }] }))
    const { w } = await setup()
    expect(button(w, 'Close the USD book')).toBeUndefined()
    expect(w.text()).toContain('Nothing is left to close in this book.')
  })

  it('reads the year end again after a refused close, so a stale card is corrected', async () => {
    acc.yearEnd.mockResolvedValueOnce(yearEnd())
    api.closeYear.mockRejectedValue({ response: { status: 409, data: { error: 'closing_pending', message: 'YC-0000001 is already waiting to be posted.' } } })
    const { w } = await setup()
    acc.yearEnd.mockResolvedValue(yearEnd({ books: [{ ...closedBook, closed: false, closing_voucher: null, pending_closing: { id: 'v8', voucher_no: 'YC-0000001', prepared_by_name: null }, to_close: true }] }))
    await button(w, 'Close the USD book')!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('already waiting to be posted')
    expect(button(w, 'Close the USD book')).toBeUndefined()
    expect(w.text()).toContain('is waiting to be posted by someone else')
  })

  it('keeps a pending closing and its link visible while a period is open again', async () => {
    acc.yearEnd.mockResolvedValue(yearEnd({ periods_open: 1, books: [{ ...closedBook, closed: false, closing_voucher: null, pending_closing: { id: 'v8', voucher_no: 'YC-0000001', prepared_by_name: null }, to_close: true }] }))
    const { w } = await setup()
    expect(w.findAll('a').find((a) => a.text() === 'YC-0000001')!.attributes('href')).toBe('/journals/v8')
    expect(w.text()).toContain('only once every period is closed again')
  })

  it('shows the date the whole-book control checks are measured at', async () => {
    acc.periodReadiness.mockResolvedValue(readiness(1, { as_at: '2026-11-17' }))
    const { w } = await setup()
    expect(w.text()).toContain('whole book as at')
  })

  it('shows 503 readiness_unavailable with its sentence', async () => {
    acc.periodReadiness.mockRejectedValue({ response: { status: 503, data: { error: 'readiness_unavailable', message: 'The readiness checks could not be read just now. Try again.' } } })
    const { w } = await setup()
    expect(w.text()).toContain('The readiness checks could not be read just now. Try again.')
  })

  it.each([
    ['bad_date', 'A year-end closing is dated the last day of the year, 2026-12-31, not 2026-12-30.'],
    ['periods_open', 'Close every period of 2026 first.'],
    ['final_period_locked', 'Period 12 of 2026 is locked, so no year-end closing can be posted into it.'],
    ['bad_number', 'The voucher number must not be blank.'],
    ['closing_pending', 'YC-0000001 is already waiting to be posted.'],
    ['nothing_to_close', 'The USD book has nothing to close.'],
    ['no_surplus_account', 'Mark the equity account that carries accumulated surplus.'],
  ])('shows the server sentence for %s on the year-end close', async (error, message) => {
    acc.yearEnd.mockResolvedValue(yearEnd())
    api.closeYear.mockRejectedValue({ response: { status: 409, data: { error, message } } })
    const { w } = await setup()
    await button(w, 'Close the USD book')!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain(message)
  })

  it.each([
    ['no_change', 'Period 1 is already closed.'],
    ['lock_needs_close', 'Period 1 is open. Close it first.'],
    ['closing_reversal_pending', 'A reversal of a closing is waiting to be posted.'],
    ['period_locked', 'Period 1 is locked.'],
    ['period_changed', 'Period 1 changed while you were looking. Read it again.'],
  ])('shows the server sentence for %s on a period change', async (error, message) => {
    api.setPeriodStatus.mockRejectedValue({ response: { status: 409, data: { error, message } } })
    const { w } = await setup()
    await button(w, 'Close period')!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain(message)
  })

  it('lists the debtors and creditors control checks like any other', async () => {
    acc.periodReadiness.mockResolvedValue(readiness(1, {
      checks: [check('debtors_control', 'Debtors control agrees with the debtors ageing', 1), check('creditors_control', 'Creditors control agrees with the creditors list', 0)],
      ready: false,
    }))
    const { w } = await setup()
    expect(w.text()).toContain('Debtors control agrees with the debtors ageing')
    expect(w.text()).toContain('Creditors control agrees with the creditors list')
    expect(w.findAll('.pc-checks li')[0].text()).toContain('Outstanding')
    expect(w.findAll('.pc-checks li')[1].text()).toContain('Clear')
  })

  it('explains that nobody can sign when there are no posters, and offers no button', async () => {
    acc.yearEnd.mockResolvedValue(yearEnd({ posters: [] }))
    const { w } = await setup()
    expect(button(w, 'Close the USD book')).toBeUndefined()
    expect(w.text()).toContain('nobody else who may post')
    expect(w.text()).not.toContain('Someone other than you must post it')
  })

  it('asks for the surplus account, linking to the chart, when none is marked', async () => {
    acc.yearEnd.mockResolvedValue(yearEnd({ surplus_account: null }))
    const { w } = await setup()
    expect(w.text()).toContain('Mark the equity account that carries accumulated surplus')
    expect(w.findAll('a').some((a) => a.attributes('href') === '/ledger')).toBe(true)
    expect(button(w, 'Close the USD book')).toBeUndefined()
  })

  it('explains who holds the year-end right when the person lacks it', async () => {
    acc.yearEnd.mockResolvedValue(yearEnd())
    const { w } = await setup({ permissions: ['finance.ledger.view', 'finance.ledger.period.manage'] })
    expect(w.text()).toContain('Closing the year is reserved to roles holding "Close the financial year"')
    expect(button(w, 'Close the USD book')).toBeUndefined()
  })

  it('shows a closed book with its closing voucher', async () => {
    acc.yearEnd.mockResolvedValue(yearEnd({ books: [{ currency: 'USD', closed: true, revenue: '150.00', expenditure: '200.00', surplus: '50.00', side: 'deficit', closing_voucher: { id: 'v9', voucher_no: 'YC-0000001' }, pending_closing: null, to_close: false }] }))
    const { w } = await setup()
    expect(w.text()).toContain('Deficit')
    expect(w.findAll('a').find((a) => a.text() === 'YC-0000001')!.attributes('href')).toBe('/journals/v9')
    expect(button(w, 'Close the USD book')).toBeUndefined()
  })

  it('shows a loading state and then an error with Retry', async () => {
    const d = deferred<{ periods: unknown[]; total: number }>()
    api.periods.mockReturnValueOnce(d.promise)
    const { w } = await setup()
    expect(w.find('[aria-busy="true"]').exists()).toBe(true)
    d.resolve({ periods: [], total: 0 })
    await flushPromises()
    expect(w.find('[aria-busy="true"]').exists()).toBe(false)
  })

  it('shows an error with Retry when the periods cannot be read', async () => {
    api.periods.mockRejectedValueOnce({ response: { data: { message: 'Down.' } } })
    const { w } = await setup()
    expect(w.find('[role="alert"]').text()).toContain('Down.')
    await button(w, 'Retry')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('Period 2')
  })

  it('shows an error when the readiness cannot be read', async () => {
    acc.periodReadiness.mockRejectedValue({ response: { data: { message: 'No readiness.' } } })
    const { w } = await setup()
    expect(w.text()).toContain('No readiness.')
  })

  it('makes no call and asks for a year when none is selected', async () => {
    const { w } = await setup({ year: null })
    expect(w.text()).toContain('Choose a financial year in the banner above.')
    expect(api.periods).not.toHaveBeenCalled()
    expect(acc.yearEnd).not.toHaveBeenCalled()
    expect(acc.periodReadiness).not.toHaveBeenCalled()
  })
})
