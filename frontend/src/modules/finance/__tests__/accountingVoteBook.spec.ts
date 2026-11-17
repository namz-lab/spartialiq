// @vitest-environment happy-dom
//
// The Vote Book page of the Accounting workspace. Its rules:
//
//   1. ONE BOOK AT A TIME: a vote's figures are shown for the book chosen, never combined (D4).
//   2. THE FIGURES ARE THE SERVER'S: budget, commitments, spending and variance as sent, with the
//      utilisation bar only a picture of the percentage already given.
//   3. WHAT IS NOT UNDER CONTROL IS SAID, not hidden: lines still in draft are counted in a sentence.
//   4. NO BUDGET, NO PAGE: an honest empty state, never an invented zero.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('../api/accountingApi', () => ({ accountingApi: { voteBook: vi.fn() } }))

import { accountingApi } from '../api/accountingApi'
import VoteBookPage from '../workspaces/accountant/pages/VoteBookPage.vue'
import { useFinanceStore } from '../stores/finance'

const api = accountingApi as unknown as { voteBook: ReturnType<typeof vi.fn> }
const Stub = defineComponent({ render: () => h('div') })
const VIEWER = ['finance.budget.view']

const book = (over: Record<string, unknown> = {}) => ({
  year: { id: 'y1', label: '2026', start_date: '2026-01-01', end_date: '2026-12-31', status: 'open' },
  totals: [
    { currency: 'USD', budget: '700000.00', committed: '50000.00', actual: '660000.00', available: '-10000.00', utilisation: '94.3', committed_utilisation: '101.4' },
    { currency: 'ZWG', budget: '1000000.00', committed: '0.00', actual: '0.00', available: '1000000.00', utilisation: '0.0', committed_utilisation: '0.0' },
  ],
  votes: [
    { currency: 'USD', code: 'WKS', name: 'Works and Roads', vote_number: 3, budget: '500000.00', committed: '50000.00', actual: '400000.00', available: '50000.00', variance: '100000.00', utilisation: '80.0', committed_utilisation: '90.0' },
    { currency: 'USD', code: 'HLT', name: 'Health Services', vote_number: 5, budget: '200000.00', committed: '0.00', actual: '260000.00', available: '-60000.00', variance: '-60000.00', utilisation: '130.0', committed_utilisation: '130.0' },
    { currency: 'ZWG', code: 'WKS', name: 'Works and Roads', vote_number: 3, budget: '1000000.00', committed: '0.00', actual: '0.00', available: '1000000.00', variance: '1000000.00', utilisation: '0.0', committed_utilisation: '0.0' },
  ],
  over_budget: [
    { currency: 'USD', department_code: 'HLT', department_name: 'Health Services', line_code: 'HLT-CLINICS', line_description: 'Clinic operating costs', budget: '200000.00', spent: '260000.00', committed: '0.00', over_by: '60000.00' },
  ],
  revenue: [
    { currency: 'USD', revenue_class: 'internally_generated', budget: '800000.00', actual: '850000.00', variance: '50000.00' },
    { currency: 'USD', revenue_class: 'grant', budget: '500000.00', actual: '300000.00', variance: '-200000.00' },
  ],
  lines_not_yet_approved: 2,
  ...over,
})

async function setup(opts: { path?: string; permissions?: string[]; year?: string | null } = {}) {
  const store = useFinanceStore()
  store.identity = {
    user_id: 'u-me', role: 'accountant', authority_id: 1, permissions: opts.permissions ?? VIEWER, department_scope: [], catalogue: [],
  }
  store.selectedYearId = opts.year === undefined ? 'y1' : opts.year
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', name: 'acc-votebook', component: VoteBookPage },
      { path: '/reports', name: 'acc-reports', component: Stub },
    ],
  })
  await router.push(opts.path ?? '/')
  await router.isReady()
  const w = mount(defineComponent({ render: () => h(RouterView) }), { attachTo: document.body, global: { plugins: [router] } })
  await flushPromises()
  return { w, router }
}
type W = Awaited<ReturnType<typeof setup>>['w']
const trOf = (w: W, text: string) => w.findAll('tbody tr').find((r) => r.text().includes(text))!
const button = (w: W, text: string) => w.findAll('button').find((b) => b.text().includes(text))

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  window.history.replaceState(null, '')
  document.body.innerHTML = ''
})

describe('the Vote Book', () => {
  it('asks for the year chosen and shows each vote of the book, with its utilisation', async () => {
    api.voteBook.mockResolvedValue(book())
    const { w } = await setup()
    expect(api.voteBook).toHaveBeenCalledWith('y1')
    const works = trOf(w, 'Works and Roads')
    expect(works.text()).toContain('Vote 3')
    expect(works.text()).toContain('500 000.00')
    expect(works.text()).toContain('80.0%')
    expect(works.text()).toContain('90.0% with commitments')
    const all = w.findAll('tfoot tr').find((r) => r.text().includes('All votes'))!
    expect(all.text()).toContain('700 000.00')
    // Negatives carry the true minus sign (U+2212), never a hyphen.
    expect(all.text()).toContain('−10 000.00')
  })

  it('shows one book at a time: switching to ZWG shows only the ZWG vote', async () => {
    api.voteBook.mockResolvedValue(book())
    const { w, router } = await setup()
    expect(w.text()).toContain('Health Services')
    await router.replace({ query: { book: 'ZWG' } })
    await flushPromises()
    expect(w.findAll('h3').some((h) => h.text().includes('ZWG book'))).toBe(true)
    expect(w.text()).not.toContain('Health Services')
    expect(w.text()).toContain('1 000 000.00')
  })

  it('lists a line spent past its vote with what it is over by', async () => {
    api.voteBook.mockResolvedValue(book())
    const { w } = await setup()
    const over = trOf(w, 'HLT-CLINICS')
    expect(over.text()).toContain('Clinic operating costs')
    expect(over.text()).toContain('60 000.00')
    // The over-budget card belongs to the book: nothing of it in ZWG.
    const { w: zwg } = await setup({ path: '/?book=ZWG' })
    expect(zwg.text()).not.toContain('Lines over budget')
  })

  it('summarises revenue apart, by the class the chart gives it', async () => {
    api.voteBook.mockResolvedValue(book())
    const { w } = await setup()
    const rates = trOf(w, 'Internally generated')
    expect(rates.text()).toContain('850 000.00')
    expect(rates.text()).toContain('50 000.00')
    expect(trOf(w, 'Grants').text()).toContain('−200 000.00')
  })

  it('counts the lines not yet under control in a sentence, not a figure', async () => {
    api.voteBook.mockResolvedValue(book())
    const { w } = await setup()
    expect(w.text()).toContain('2 budget lines are still draft, submitted or returned, and is not controlled here.')
  })

  it('says plainly when no budget exists for the year, and asks nothing else', async () => {
    api.voteBook.mockResolvedValue(book({ totals: [], votes: [], over_budget: [], revenue: [], lines_not_yet_approved: 0 }))
    const { w } = await setup()
    expect(w.text()).toContain('No approved or published budget line exists for this year.')
    expect(w.find('[role="alert"]').exists()).toBe(false)
  })

  it('asks nothing when no year is selected', async () => {
    const { w } = await setup({ year: null })
    expect(api.voteBook).not.toHaveBeenCalled()
    expect(w.text()).toContain('Choose a financial year in the banner above.')
  })

  it('shows the server\'s refusal with a Retry, and recovers', async () => {
    api.voteBook.mockRejectedValueOnce({ response: { status: 500, data: { message: 'The vote book could not be read.' } } })
    const failed = await setup()
    expect(failed.w.find('[role="alert"]').text()).toContain('The vote book could not be read.')
    api.voteBook.mockResolvedValue(book())
    await button(failed.w, 'Retry')!.trigger('click')
    await flushPromises()
    expect(failed.w.text()).toContain('Works and Roads')
  })

  it('reads the year again when the banner\'s year changes', async () => {
    api.voteBook.mockResolvedValue(book())
    const { w } = await setup()
    useFinanceStore().selectedYearId = 'y2'
    await flushPromises()
    expect(api.voteBook).toHaveBeenCalledTimes(2)
    expect(api.voteBook).toHaveBeenLastCalledWith('y2')
    expect(w.find('.cw-skel').exists()).toBe(false)
  })
})
