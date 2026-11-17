// @vitest-environment happy-dom
//
// The Journals register and the voucher page of the Accounting workspace. Its rules:
//
//   1. THE REGISTER OPENS ON WHAT WAITS FOR THIS PERSON, and paging is the server's.
//   2. PREPARER IS NEVER POSTER: no Post on your own draft, and the page says why.
//   3. A REVERSAL NEEDS A WRITTEN REASON AND IS RAISED AS A DRAFT; a document's voucher is cancelled from its document.
//   4. POST CARRIES THE VERSION REVIEWED; ONLY THE PREPARER EDITS OR CANCELS; A CANCEL KEEPS THE NUMBER.
//   5. WITH NO YEAR SELECTED NOTHING IS ASKED OF THE SERVER.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../api/ledgerApi', () => ({
  ledgerApi: {
    vouchers: vi.fn(), voucher: vi.fn(), postVoucher: vi.fn(), reverseVoucher: vi.fn(), discardVoucher: vi.fn(),
    accounts: vi.fn(), parties: vi.fn(), periods: vi.fn(),
  },
}))

import { ledgerApi } from '../api/ledgerApi'
import JournalsPage from '../workspaces/accountant/pages/JournalsPage.vue'
import VoucherPage from '../workspaces/accountant/pages/VoucherPage.vue'
import { useFinanceStore } from '../stores/finance'
import { resetLedgerLists } from '../workspaces/accountant/kit/useLedgerLists'

const api = ledgerApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })
const ACCOUNTANT = ['finance.ledger.view', 'finance.ledger.voucher.prepare', 'finance.ledger.voucher.post', 'finance.ledger.voucher.reverse']

const summary = (over: Record<string, unknown> = {}) => ({
  id: 'v1', voucher_no: 'JV-0000001', voucher_type: 'journal', currency: 'USD', financial_year_id: 'y1',
  posting_date: '2026-09-14', narration: 'Fuel', reference: null, status: 'draft',
  reverses_voucher_id: null, reverses_voucher_no: null, reversed_by_voucher_no: null, is_opening: false,
  prepared_by: 'u-other', prepared_at: '2026-09-14T08:00:00Z', posted_by: null, posted_at: null,
  prepared_by_name: 'Demo Clerk', posted_by_name: null, line_count: 2, debit_total: '450.00', credit_total: '450.00',
  version: 3, cancelled_by: null, cancelled_at: null, cancel_reason: null, pending_reversal_no: null,
  ...over,
})
const list = (over: Record<string, unknown> = {}) => ({
  vouchers: [summary()], total: 1, limit: 50, offset: 0, scope_applied: null,
  queues: { to_post: 2, mine: 1, posted: 5, all: 8, cancelled: 4 }, note: '', ...over,
})
const line = (n: number, over: Record<string, unknown> = {}) => ({
  id: `l${n}`, line_no: n, ledger_account_id: `a${n}`, account_code: n === 1 ? '5310' : '1200',
  account_name: n === 1 ? 'Fuel and oils' : 'Bank – CBZ current', root_type: 'expense',
  debit: n === 1 ? '450.00' : '0.00', credit: n === 1 ? '0.00' : '450.00',
  party_id: null, party_name: null, department_id: null, department_code: null, programme_id: null, activity_id: null,
  ward_code: null, project_id: null, budget_line_id: null, against_voucher_id: null, against_voucher_no: null, narration: null,
  ...over,
})
const detail = (voucherOver: Record<string, unknown> = {}, over: Record<string, unknown> = {}) => ({
  voucher: { ...summary(), period_no: 3, period_label: 'Sep 2026', period_status: 'open', financial_year_label: '2026', cancelled_by_name: null, ...voucherOver },
  lines: [line(1), line(2)], entries: [], reversed_by: null, source: null,
  draft_balance: { debit_total: '450.00', credit_total: '450.00', difference: '0.00', line_count: 2 },
  posted_balance: { debit_total: '0.00', credit_total: '0.00', difference: '0.00', entry_count: 0 },
  balances: true, note: null, ...over,
})

async function setup(opts: { path: string; permissions?: string[]; year?: string | null; userId?: string }) {
  const store = useFinanceStore()
  store.identity = {
    user_id: opts.userId ?? 'u-me', role: 'accountant', authority_id: 1, permissions: opts.permissions ?? ACCOUNTANT,
    department_scope: [], catalogue: [],
  }
  store.selectedYearId = opts.year === undefined ? 'y1' : opts.year
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/journals', name: 'acc-journals', component: JournalsPage },
      { path: '/journals/new', name: 'acc-journal-new', component: Stub },
      { path: '/journals/:id/edit', name: 'acc-journal-edit', component: Stub },
      { path: '/journals/:id', name: 'acc-voucher', component: VoucherPage },
      { path: '/ledger/:id', name: 'acc-account', component: Stub },
      { path: '/payable', name: 'acc-payable', component: Stub },
      { path: '/assets', name: 'acc-assets', component: Stub },
      { path: '/banking', name: 'acc-banking', component: Stub },
      { path: '/revenue', name: 'acc-revenue', component: Stub },
      { path: '/cash-ups', name: 'acc-cashups', component: Stub },
    ],
  })
  await router.push(opts.path)
  await router.isReady()
  const w = mount(defineComponent({ render: () => h(RouterView) }), { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}
const button = (w: Awaited<ReturnType<typeof setup>>['w'], text: string) => w.findAll('button').find((b) => b.text().includes(text))

describe('the journals register and the voucher page', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    window.history.replaceState(null, '')
    document.body.innerHTML = ''
    resetLedgerLists()
    api.parties.mockResolvedValue({ parties: [], total: 0 })
    api.accounts.mockResolvedValue({ accounts: [] })
    api.periods.mockResolvedValue({ periods: [] })
  })

  it('opens on what waits for this person', async () => {
    api.vouchers.mockResolvedValue(list())
    const { w } = await setup({ path: '/journals' })
    expect(api.vouchers.mock.calls[0][0]).toMatchObject({ financial_year_id: 'y1', queue: 'to_post', limit: 50, offset: 0 })
    const tab = w.findAll('[role="tab"]').find((t) => t.text().includes('To post'))!
    expect(tab.text()).toContain('To post 2')
    expect(tab.attributes('aria-selected')).toBe('true')
    expect(w.text()).toContain('JV-0000001')
    expect(w.text()).toContain('Draft')
  })

  it('is a tab strip with a roving tabindex, a panel, and Arrow, Home and End keys that move focus', async () => {
    api.vouchers.mockResolvedValue(list())
    const { w, router } = await setup({ path: '/journals?queue=mine' })
    const tabs = () => w.findAll('[role="tab"]')
    expect(tabs().map((t) => t.attributes('tabindex'))).toEqual(['-1', '0', '-1', '-1', '-1'])
    const panel = w.get('[role="tabpanel"]')
    expect(panel.attributes('id')).toBe(tabs()[1].attributes('aria-controls'))
    expect(panel.attributes('aria-labelledby')).toBe(tabs()[1].attributes('id'))
    ;(tabs()[1].element as HTMLElement).focus()
    await tabs()[1].trigger('keydown', { key: 'ArrowRight' }); await flushPromises()
    expect(router.currentRoute.value.query.queue).toBe('posted')
    expect(document.activeElement).toBe(tabs()[2].element)
    await tabs()[2].trigger('keydown', { key: 'End' }); await flushPromises()
    expect(router.currentRoute.value.query.queue).toBe('cancelled')
    expect(document.activeElement).toBe(tabs()[4].element)
    await tabs()[4].trigger('keydown', { key: 'Home' }); await flushPromises()
    expect(router.currentRoute.value.query.queue).toBe('to_post')
    expect(document.activeElement).toBe(tabs()[0].element)
    await tabs()[0].trigger('keydown', { key: 'ArrowLeft' }); await flushPromises()
    expect(router.currentRoute.value.query.queue).toBe('cancelled')
    expect(document.activeElement).toBe(tabs()[4].element)
  })

  it('falls back to My drafts, then All, when nothing waits to be posted', async () => {
    api.vouchers.mockResolvedValue(list({ queues: { to_post: 0, mine: 3, posted: 5, all: 8, cancelled: 0 } }))
    const { w } = await setup({ path: '/journals' })
    expect(api.vouchers.mock.calls.length).toBeLessThanOrEqual(2)
    expect(api.vouchers.mock.calls.at(-1)![0]).toMatchObject({ queue: 'mine' })
    expect(w.findAll('[role="tab"]').find((t) => t.text().includes('My drafts'))!.attributes('aria-selected')).toBe('true')
  })

  it('pages on the server', async () => {
    api.vouchers.mockResolvedValue(list({ total: 120 }))
    const { w, router } = await setup({ path: '/journals?queue=all' })
    expect(api.vouchers.mock.calls.at(-1)![0]).toMatchObject({ offset: 0 })
    await button(w, 'Next')!.trigger('click')
    await flushPromises()
    expect(api.vouchers.mock.calls.at(-1)![0]).toMatchObject({ offset: 50, limit: 50 })
    expect(router.currentRoute.value.query.offset).toBe('50')
  })

  it('does not offer Post on a voucher the viewer prepared, and says why', async () => {
    api.voucher.mockResolvedValue(detail({ prepared_by: 'u-me' }))
    const { w } = await setup({ path: '/journals/v1' })
    expect(button(w, 'Post')).toBeUndefined()
    expect(w.text()).toContain('You prepared this voucher, so somebody else posts it.')
    expect(button(w, 'Cancel draft')).toBeDefined()
    expect(w.text()).toContain('Edit')
  })

  it('shows a non-preparer a sentence instead of Edit and Cancel draft', async () => {
    api.voucher.mockResolvedValue(detail())
    const { w } = await setup({ path: '/journals/v1' })
    expect(button(w, 'Cancel draft')).toBeUndefined()
    expect(w.findAll('a').some((a) => a.text() === 'Edit')).toBe(false)
    expect(w.text()).toContain('Only the person who prepared it may change or cancel it; copy it into a new draft of your own.')
    expect(button(w, 'Post')).toBeDefined()
  })

  it('offers Post to a second person and re-reads after posting', async () => {
    api.voucher.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail({ status: 'posted', posted_by: 'u-me', posted_by_name: 'Me', posted_at: '2026-09-15T08:00:00Z' }))
    api.postVoucher.mockResolvedValue({ posted: 'JV-0000001', entries: 2, note: 'Posted 2 entries to the ledger.' })
    const { w } = await setup({ path: '/journals/v1' })
    expect(w.text()).not.toContain('You prepared this voucher')
    await button(w, 'Post')!.trigger('click')
    await flushPromises()
    expect(api.postVoucher).toHaveBeenCalledWith('v1', 3)
    expect(api.voucher).toHaveBeenCalledTimes(2)
    expect(w.find('[role="status"]').text()).toContain('Posted 2 entries to the ledger.')
    expect(button(w, 'Post')).toBeUndefined()
    expect(button(w, 'Reverse')).toBeDefined()
  })

  it('on 409 changed_since_review shows the message, reads the draft again and does not post again', async () => {
    api.voucher.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail({ version: 4, narration: 'Fuel, corrected' }))
    api.postVoucher.mockRejectedValue(Object.assign(new Error('conflict'), {
      isAxiosError: true,
      response: { status: 409, data: { error: 'changed_since_review', message: 'The draft was changed after you opened it. Read it again before posting.', current_version: 4 } },
    }))
    const { w } = await setup({ path: '/journals/v1' })
    await button(w, 'Post')!.trigger('click')
    await flushPromises()
    expect(api.postVoucher).toHaveBeenCalledTimes(1)
    expect(api.postVoucher).toHaveBeenCalledWith('v1', 3)
    expect(w.find('[role="alert"]').text()).toContain('The draft was changed after you opened it. Read it again before posting.')
    expect(api.voucher).toHaveBeenCalledTimes(2)
    expect(w.text()).toContain('Fuel, corrected')
    // The next click carries the version just read.
    api.postVoucher.mockResolvedValue({ posted: 'JV-0000001', entries: 2, note: 'Posted.' })
    api.voucher.mockResolvedValue(detail({ status: 'posted' }))
    await button(w, 'Post')!.trigger('click')
    await flushPromises()
    expect(api.postVoucher).toHaveBeenLastCalledWith('v1', 4)
  })

  it('shows the over_applied refusal as the server sent it, currency included', async () => {
    const message = 'RB-0000012 has USD 120.00 still open; this would apply USD 150.00.'
    api.voucher.mockResolvedValue(detail())
    api.postVoucher.mockRejectedValue({ response: { status: 409, data: { error: 'over_applied', message } } })
    const { w } = await setup({ path: '/journals/v1' })
    await button(w, 'Post')!.trigger('click')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain(message)
    expect(api.postVoucher).toHaveBeenCalledTimes(1)
  })

  it('asks for a reason, raises the reversal as a draft, says so and links to it', async () => {
    const posted = { status: 'posted', posted_by: 'u-x', posted_by_name: 'Other' }
    api.voucher.mockResolvedValueOnce(detail(posted))
      .mockResolvedValueOnce(detail(posted, { reversed_by: { id: 'v2', voucher_no: 'JV-0000001-R', posting_date: '2026-09-16', status: 'draft', narration: 'Wrong account charged' } }))
    api.reverseVoucher.mockResolvedValue({
      reversal: { id: 'v2', voucher_no: 'JV-0000001-R', status: 'draft' }, reversed: 'JV-0000001', awaiting_post: true, note: 'Raised as a draft.',
    })
    const { w } = await setup({ path: '/journals/v1' })
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    await button(w, 'Reverse')!.trigger('click')
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    const submit = w.findAll('button').find((b) => b.attributes('type') === 'submit')!
    expect(submit.attributes('disabled')).toBeDefined()
    await w.find('textarea').setValue('too short')
    expect(submit.attributes('disabled')).toBeDefined()
    await w.find('textarea').setValue('Wrong account charged')
    await w.find('form[role="dialog"]').trigger('submit')
    await flushPromises()
    expect(api.reverseVoucher).toHaveBeenCalledTimes(1)
    const [id, body] = api.reverseVoucher.mock.calls[0]
    expect(id).toBe('v1')
    expect(body.reason).toBe('Wrong account charged')
    expect(body.posting_date).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(api.voucher).toHaveBeenCalledTimes(2)
    const status = w.find('[role="status"]').text()
    expect(status).toContain('JV-0000001-R is a draft reversal of JV-0000001')
    expect(status).toContain('nothing has been posted')
    expect(status).toContain('Somebody other than you posts it')
    expect(status).not.toMatch(/reversed by/i)
    expect(w.findAll('a').some((a) => a.text() === 'Open the draft reversal' && a.attributes('href') === '/journals/v2')).toBe(true)
    // The pending-reversal state: named, linked, and Reverse is explained rather than offered.
    expect(w.text()).toContain('Reversal waiting')
    expect(w.text()).toContain('is waiting to be posted by somebody other than its preparer')
    expect(w.text()).not.toContain('Reversed by')
    expect(button(w, 'Reverse')).toBeUndefined()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
  })

  it('names a posted reversal as Reversed by', async () => {
    api.voucher.mockResolvedValue(detail({ status: 'posted', posted_by: 'u-x', posted_by_name: 'Other' },
      { reversed_by: { id: 'v2', voucher_no: 'RV-1', posting_date: '2026-09-16', status: 'posted', narration: null } }))
    const { w } = await setup({ path: '/journals/v1' })
    expect(w.text()).toContain('Reversed by')
    expect(w.findAll('a').some((a) => a.text() === 'RV-1')).toBe(true)
    expect(button(w, 'Reverse')).toBeUndefined()
  })

  it('does not offer Edit on a reversal draft, and says why', async () => {
    api.voucher.mockResolvedValue(detail({ prepared_by: 'u-me', voucher_type: 'reversal', reverses_voucher_id: 'v0', reverses_voucher_no: 'JV-0000000' }))
    const { w } = await setup({ path: '/journals/v1' })
    expect(w.findAll('a').some((a) => a.text() === 'Edit')).toBe(false)
    expect(w.text()).toContain('cannot be edited')
    expect(button(w, 'Cancel draft')).toBeDefined()
  })

  it('does not offer Edit on a closing draft, says why, and still offers Cancel', async () => {
    api.voucher.mockResolvedValue(detail({ prepared_by: 'u-me', voucher_type: 'closing' }))
    const { w } = await setup({ path: '/journals/v1' })
    expect(w.findAll('a').some((a) => a.text() === 'Edit')).toBe(false)
    expect(w.text()).toContain('A year-end closing is built from the books, so it cannot be edited')
    expect(button(w, 'Cancel draft')).toBeDefined()
  })

  it('offers Cancel on a closing draft to a closer without the prepare right when the server says so', async () => {
    api.voucher.mockResolvedValue(detail({ prepared_by: 'u-me', voucher_type: 'closing' }, { may_discard: true }))
    const { w } = await setup({ path: '/journals/v1', permissions: ['finance.ledger.view', 'finance.ledger.voucher.post', 'finance.ledger.close_year'] })
    expect(button(w, 'Cancel draft')).toBeDefined()
    expect(w.findAll('a').some((a) => a.text() === 'Edit')).toBe(false)
  })

  it('offers no Cancel on a closing draft when the server says may_discard is false, and says who can help', async () => {
    api.voucher.mockResolvedValue(detail({ prepared_by: 'u-me', voucher_type: 'closing' }, { may_discard: false }))
    const { w } = await setup({ path: '/journals/v1', permissions: ['finance.ledger.view', 'finance.ledger.voucher.post'] })
    expect(button(w, 'Cancel draft')).toBeUndefined()
    expect(w.text()).toContain('You cannot cancel it: have it posted by someone else, or ask an administrator.')
    expect(w.text()).not.toContain('Cancel it and raise the closing again')
  })

  it('cancels a draft with a reason, sends it, and keeps the number visible', async () => {
    api.voucher.mockResolvedValueOnce(detail({ prepared_by: 'u-me' })).mockResolvedValueOnce(detail({
      prepared_by: 'u-me', status: 'cancelled', cancelled_by: 'u-me', cancelled_by_name: 'Me', cancelled_at: '2026-09-15T08:00:00Z', cancel_reason: 'Entered twice by mistake',
    }, { note: 'Cancelled before it was posted. Its number is kept.' }))
    api.discardVoucher.mockResolvedValue({ cancelled: 'JV-0000001', voucher_id: 'v1', status: 'cancelled', cancel_reason: 'Entered twice by mistake', note: '' })
    const { w, router } = await setup({ path: '/journals/v1' })
    await button(w, 'Cancel draft')!.trigger('click')
    expect(w.find('[role="dialog"]').exists()).toBe(true)
    expect(api.discardVoucher).not.toHaveBeenCalled()
    await w.find('textarea').setValue('Entered twice by mistake')
    await w.find('form[role="dialog"]').trigger('submit')
    await flushPromises()
    expect(api.discardVoucher).toHaveBeenCalledWith('v1', 'Entered twice by mistake')
    expect(router.currentRoute.value.name).toBe('acc-voucher')
    expect(w.text()).toContain('JV-0000001')
    expect(w.find('[role="status"]').text()).toContain('JV-0000001 is cancelled. It keeps its number')
    expect(w.text()).toContain('Cancelled')
    expect(button(w, 'Cancel draft')).toBeUndefined()
  })

  it('shows a cancelled voucher with its reason and who cancelled it', async () => {
    api.voucher.mockResolvedValue(detail({
      prepared_by: 'u-me', status: 'cancelled', cancelled_by: 'u-me', cancelled_by_name: 'Tendai Moyo', cancelled_at: '2026-09-15T08:00:00Z', cancel_reason: 'Entered twice by mistake',
    }, { note: 'Cancelled before it was posted. Its number is kept.' }))
    const { w } = await setup({ path: '/journals/v1' })
    expect(w.text()).toContain('Tendai Moyo')
    expect(w.text()).toContain('Reason: Entered twice by mistake')
    expect(w.text()).toContain('Cancelled before it was posted. Its number is kept.')
    expect(button(w, 'Cancel draft')).toBeUndefined()
    expect(button(w, 'Post')).toBeUndefined()
  })

  it('closes an open cancel dialog when the address moves to another voucher', async () => {
    api.voucher.mockImplementation((id: string) => Promise.resolve(detail({ id, voucher_no: id === 'v1' ? 'JV-1' : 'JV-2', prepared_by: 'u-me' })))
    const { w, router } = await setup({ path: '/journals/v1' })
    await button(w, 'Cancel draft')!.trigger('click')
    expect(w.find('[role="alertdialog"], [role="dialog"]').exists()).toBe(true)
    await router.push('/journals/v2'); await flushPromises()
    expect(w.find('[role="alertdialog"], [role="dialog"]').exists()).toBe(false)
    expect(w.text()).toContain('JV-2')
  })

  it('gives the journals list a caption and a row header for each number', async () => {
    api.vouchers.mockResolvedValue(list())
    const { w } = await setup({ path: '/journals' })
    expect(w.get('table caption').text()).toContain('Journals')
    expect(w.get('tbody th[scope="row"]').text()).toContain('JV-0000001')
  })

  it('closes the cancel dialog on Escape and gives focus back', async () => {
    api.voucher.mockResolvedValue(detail({ prepared_by: 'u-me' }))
    const { w } = await setup({ path: '/journals/v1' })
    const opener = button(w, 'Cancel draft')!
    await opener.trigger('click')
    await flushPromises()
    const dlg = w.find('[role="dialog"]')
    expect(dlg.attributes('aria-modal')).toBe('true')
    expect(document.getElementById(dlg.attributes('aria-labelledby')!)!.textContent).toBe('Cancel this draft')
    expect(document.activeElement?.closest(`[aria-labelledby="${dlg.attributes('aria-labelledby')}"]`)).not.toBeNull()
    await dlg.trigger('keydown', { key: 'Escape' })
    await flushPromises()
    expect(w.find('[role="dialog"]').exists()).toBe(false)
    expect(api.discardVoucher).not.toHaveBeenCalled()
    expect(document.activeElement).toBe(opener.element)
  })

  it('shows the server message when a cancel is refused, inside the dialog', async () => {
    api.voucher.mockResolvedValue(detail({ prepared_by: 'u-me' }))
    api.discardVoucher.mockRejectedValue({ response: { status: 409, data: { message: 'This draft is already posted.' } } })
    const { w, router } = await setup({ path: '/journals/v1' })
    await button(w, 'Cancel draft')!.trigger('click')
    await w.find('textarea').setValue('Entered twice')
    await w.find('form[role="dialog"]').trigger('submit')
    await flushPromises()
    expect(w.find('[role="alert"]').text()).toContain('This draft is already posted.')
    expect(router.currentRoute.value.name).toBe('acc-voucher')
  })

  it('has a Cancelled tab with its count, asks for status=cancelled, and says why a voucher was cancelled', async () => {
    api.vouchers.mockResolvedValue(list({ vouchers: [summary({ status: 'cancelled', cancelled_at: '2026-09-15T08:00:00Z', cancel_reason: 'Entered twice by mistake' })] }))
    const { w } = await setup({ path: '/journals?queue=cancelled' })
    const tab = w.findAll('[role="tab"]').find((t) => t.text().startsWith('Cancelled'))!
    expect(tab.text()).toBe('Cancelled 4')
    expect(tab.attributes('aria-selected')).toBe('true')
    expect(api.vouchers.mock.calls.at(-1)![0]).toMatchObject({ status: 'cancelled' })
    expect(api.vouchers.mock.calls.at(-1)![0]).not.toHaveProperty('queue')
    expect(w.text()).toContain('JV-0000001')
    expect(w.text()).toContain('Entered twice by mistake')
  })

  it('flags a posted voucher whose reversal is waiting in the register', async () => {
    api.vouchers.mockResolvedValue(list({ vouchers: [summary({ status: 'posted', pending_reversal_no: 'JV-0000001-R' })] }))
    const { w } = await setup({ path: '/journals?queue=posted' })
    expect(w.text()).toContain('reversal JV-0000001-R waiting to be posted')
  })

  it('keeps the voucher on the page when the re-read after posting fails', async () => {
    api.voucher.mockResolvedValueOnce(detail()).mockRejectedValueOnce(new Error('offline'))
    api.postVoucher.mockResolvedValue({ posted: 'JV-0000001', entries: 2, note: 'Posted 2 entries to the ledger.' })
    const { w } = await setup({ path: '/journals/v1' })
    await button(w, 'Post')!.trigger('click')
    await flushPromises()
    expect(w.text()).toContain('JV-0000001')
    expect(w.find('[role="alert"]').exists()).toBe(true)
  })

  it('shows the note the journal editor passes on arrival', async () => {
    api.voucher.mockResolvedValue(detail())
    const { w, router } = await setup({ path: '/journals' })
    api.vouchers.mockResolvedValue(list())
    // The memory router does not write window.history.state, so stand in for the browser's history entry.
    window.history.replaceState({ note: 'Draft saved. Somebody else posts it.' }, '')
    await router.replace({ name: 'acc-voucher', params: { id: 'v9' } })
    await flushPromises()
    expect(w.find('[role="status"]').text()).toContain('Draft saved. Somebody else posts it.')
  })

  it('does not crash and shows no note when none was passed', async () => {
    api.voucher.mockResolvedValue(detail())
    const { w } = await setup({ path: '/journals/v1' })
    // The region stays mounted so that it is announced, but it is empty.
    expect(w.find('[role="status"]').text()).toBe('')
    expect(w.text()).toContain('JV-0000001')
  })

  it('hides Edit and Cancel draft on a voucher raised by a document and links to it', async () => {
    api.voucher.mockResolvedValue(detail({}, { source: { kind: 'supplier_invoice', id: 'si1', label: 'Invoice INV-77' } }))
    const { w } = await setup({ path: '/journals/v1' })
    expect(button(w, 'Cancel draft')).toBeUndefined()
    expect(w.findAll('a').some((a) => a.text() === 'Edit')).toBe(false)
    const link = w.findAll('a').find((a) => a.text().includes('Invoice INV-77'))!
    expect(link.attributes('href')).toBe('/payable')
    expect(w.text()).toContain('cancelled from')
  })

  const deferred = <T,>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((r) => { resolve = r }); return { promise, resolve } }

  it('writes no notice on another voucher when a post or a cancel answers after the person has left', async () => {
    const post = deferred<{ posted: string; entries: number; note: string }>()
    api.voucher.mockImplementation((id: string) => Promise.resolve(id === 'vA'
      ? detail({ id: 'vA', voucher_no: 'JV-A', version: 1 })
      : detail({ id: 'vB', voucher_no: 'JV-B', version: 1, prepared_by: 'u-me' })))
    api.postVoucher.mockReturnValue(post.promise)
    const { w, router } = await setup({ path: '/journals/vA' })
    await button(w, 'Post')!.trigger('click')
    await router.push('/journals/vB'); await flushPromises()
    post.resolve({ posted: 'JV-A', entries: 2, note: 'Posted JV-A.' })
    await flushPromises()
    expect(w.text()).toContain('JV-B')
    expect(w.text()).not.toContain('Posted JV-A.')
    // The same for a cancel: the notice names the voucher that was cancelled, and only on its own page.
    const gone = deferred<{ cancelled: string }>()
    api.discardVoucher.mockReturnValue(gone.promise)
    await button(w, 'Cancel draft')!.trigger('click')
    await w.find('textarea').setValue('Entered twice by mistake')
    await w.find('form[role="dialog"]').trigger('submit')
    await router.push('/journals/vA'); await flushPromises()
    gone.resolve({ cancelled: 'JV-B' })
    await flushPromises()
    expect(w.text()).not.toContain('is cancelled')
  })

  it('drops a slow answer for the voucher left behind, and posts the voucher on screen with its own version', async () => {
    const a = deferred<ReturnType<typeof detail>>()
    api.voucher.mockImplementation((id: string) => (id === 'vA' ? a.promise : Promise.resolve(detail({ id: 'vB', voucher_no: 'JV-B', version: 1 }))))
    api.postVoucher.mockResolvedValue({ posted: 'JV-B', entries: 2, note: 'Posted.' })
    const { w, router } = await setup({ path: '/journals/vA' })
    await router.push('/journals/vB')
    await flushPromises()
    expect(w.text()).toContain('JV-B')
    // A's answer lands late and must not replace B's.
    a.resolve(detail({ id: 'vA', voucher_no: 'JV-A', version: 1 }))
    await flushPromises()
    expect(w.text()).toContain('JV-B')
    expect(w.text()).not.toContain('JV-A')
    api.voucher.mockResolvedValue(detail({ id: 'vB', voucher_no: 'JV-B', status: 'posted' }))
    await button(w, 'Post')!.trigger('click')
    await flushPromises()
    expect(api.postVoucher).toHaveBeenCalledWith('vB', 1)
  })

  it('moves focus to the notice after a successful cancel, because the Cancel draft button is gone', async () => {
    api.voucher.mockResolvedValueOnce(detail({ prepared_by: 'u-me' })).mockResolvedValueOnce(detail({
      prepared_by: 'u-me', status: 'cancelled', cancelled_by_name: 'Me', cancelled_at: '2026-09-15T08:00:00Z', cancel_reason: 'Entered twice',
    }))
    api.discardVoucher.mockResolvedValue({ cancelled: 'JV-0000001', voucher_id: 'v1', status: 'cancelled', cancel_reason: 'Entered twice', note: '' })
    const { w } = await setup({ path: '/journals/v1' })
    await button(w, 'Cancel draft')!.trigger('click')
    await w.find('textarea').setValue('Entered twice')
    await w.find('form[role="dialog"]').trigger('submit')
    await flushPromises()
    expect(button(w, 'Cancel draft')).toBeUndefined()
    expect(document.activeElement).toBe(w.find('[role="status"]').element)
    expect(w.find('textarea').exists()).toBe(false)
    expect(w.text()).toContain('Not posted (cancelled)')
  })

  it('moves focus to the notice after raising a reversal and after posting', async () => {
    const posted = { status: 'posted', posted_by: 'u-x', posted_by_name: 'Other' }
    api.voucher.mockResolvedValueOnce(detail(posted))
      .mockResolvedValueOnce(detail(posted, { reversed_by: { id: 'v2', voucher_no: 'JV-R', posting_date: '2026-09-16', status: 'draft', narration: null } }))
    api.reverseVoucher.mockResolvedValue({ reversal: { id: 'v2', voucher_no: 'JV-R', status: 'draft' }, reversed: 'JV-0000001', awaiting_post: true, note: '' })
    const r = await setup({ path: '/journals/v1' })
    await button(r.w, 'Reverse')!.trigger('click')
    await r.w.find('textarea').setValue('Wrong account charged')
    await r.w.find('form[role="dialog"]').trigger('submit')
    await flushPromises()
    expect(button(r.w, 'Reverse')).toBeUndefined()
    expect(document.activeElement).toBe(r.w.find('[role="status"]').element)
    r.w.unmount()
    document.body.innerHTML = ''
    api.voucher.mockReset()
    api.voucher.mockResolvedValueOnce(detail()).mockResolvedValueOnce(detail({ status: 'posted', posted_by_name: 'Me' }))
    api.postVoucher.mockResolvedValue({ posted: 'JV-0000001', entries: 2, note: 'Posted 2 entries.' })
    const p = await setup({ path: '/journals/v1' })
    await button(p.w, 'Post')!.trigger('click')
    await flushPromises()
    expect(button(p.w, 'Post')).toBeUndefined()
    expect(document.activeElement).toBe(p.w.find('[role="status"]').element)
  })

  it('reads the voucher again after a 409 reversal_pending and keeps the message in the dialog', async () => {
    const posted = { status: 'posted', posted_by: 'u-x', posted_by_name: 'Other' }
    const message = 'JV-0000001 already has a reversal, JV-R, waiting to be posted.'
    api.voucher.mockResolvedValueOnce(detail(posted))
      .mockResolvedValueOnce(detail(posted, { reversed_by: { id: 'v2', voucher_no: 'JV-R', posting_date: '2026-09-16', status: 'draft', narration: null } }))
    api.reverseVoucher.mockRejectedValue(Object.assign(new Error('c'), { isAxiosError: true, response: { status: 409, data: { error: 'reversal_pending', message } } }))
    const { w } = await setup({ path: '/journals/v1' })
    await button(w, 'Reverse')!.trigger('click')
    await w.find('textarea').setValue('Wrong account charged')
    await w.find('form[role="dialog"]').trigger('submit')
    await flushPromises()
    expect(api.voucher).toHaveBeenCalledTimes(2)
    expect(w.find('[role="dialog"] [role="alert"]').text()).toContain(message)
    expect(w.text()).toContain('Reversal waiting')
  })

  it('uses draft wording when raising a reversal fails without a server message', async () => {
    api.voucher.mockResolvedValue(detail({ status: 'posted', posted_by: 'u-x', posted_by_name: 'Other' }))
    api.reverseVoucher.mockRejectedValue({})
    const { w } = await setup({ path: '/journals/v1' })
    await button(w, 'Reverse')!.trigger('click')
    await w.find('textarea').setValue('Wrong account charged')
    await w.find('form[role="dialog"]').trigger('submit')
    await flushPromises()
    expect(w.find('[role="dialog"] [role="alert"]').text()).toContain('The reversal could not be raised.')
  })

  it('explains in words when the preparer no longer holds the prepare permission', async () => {
    api.voucher.mockResolvedValue(detail({ prepared_by: 'u-me' }))
    const { w } = await setup({ path: '/journals/v1', permissions: ['finance.ledger.view', 'finance.ledger.voucher.post'] })
    expect(button(w, 'Cancel draft')).toBeUndefined()
    expect(w.text()).toContain(useFinanceStore().whyUnavailable('finance.ledger.voucher.prepare'))
  })

  it('leaves out the copy suggestion when the viewer cannot copy', async () => {
    api.voucher.mockResolvedValue(detail())
    const { w } = await setup({ path: '/journals/v1', permissions: ['finance.ledger.view', 'finance.ledger.voucher.post'] })
    expect(w.text()).toContain('Only the person who prepared it may change or cancel it.')
    expect(w.text()).not.toContain('copy it into a new draft')
  })

  it('shows its own wording on an empty Cancelled tab', async () => {
    api.vouchers.mockResolvedValue(list({ vouchers: [], total: 0 }))
    const { w } = await setup({ path: '/journals?queue=cancelled' })
    expect(w.text()).toContain('No draft has been cancelled in this year.')
    expect(w.text()).not.toContain('Use New journal')
  })

  it('shows the list of the tab last chosen when answers arrive out of order', async () => {
    const slow = deferred<ReturnType<typeof list>>()
    api.vouchers.mockImplementation((p: { status?: string; queue?: string }) => (p.status === 'cancelled'
      ? slow.promise : Promise.resolve(list({ vouchers: [summary({ voucher_no: 'JV-TOPOST' })] }))))
    const { w, router } = await setup({ path: '/journals?queue=posted' })
    await router.replace({ query: { queue: 'cancelled' } })
    await router.replace({ query: { queue: 'to_post' } })
    await flushPromises()
    expect(w.text()).toContain('JV-TOPOST')
    slow.resolve(list({ vouchers: [summary({ voucher_no: 'JV-CANCELLED', status: 'cancelled' })] }))
    await flushPromises()
    expect(w.text()).toContain('JV-TOPOST')
    expect(w.text()).not.toContain('JV-CANCELLED')
    expect(w.findAll('[role="tab"]').find((t) => t.text().startsWith('To post'))!.attributes('aria-selected')).toBe('true')
  })

  it('says there is no year when none is selected and asks the server for nothing', async () => {
    const { w } = await setup({ path: '/journals', year: null })
    expect(w.text()).toContain('Choose a financial year')
    expect(api.vouchers).not.toHaveBeenCalled()
  })
})
