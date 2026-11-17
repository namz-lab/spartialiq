// @vitest-environment happy-dom
//
// Committee Decisions. Pinned because each failure is a decision taken wrongly or not at all:
//   - a member sees only the kinds their permissions decide, and nothing is read for the others;
//   - one kind failing to load does not blank the agenda;
//   - Approve is not offered on one's own submission;
//   - a rejection needs a written reason; a resolution reference travels in the note where the
//     endpoint has no field of its own, and in the tariff's own field where it has;
//   - the decision register reads the audit trail, including refused attempts.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('@/services/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('../api/financeApi', () => ({
  financeApi: {
    budgetLines: vi.fn(), revisions: vi.fn(), projects: vi.fn(), publications: vi.fn(), publicationPreview: vi.fn(),
    approveBudgetLine: vi.fn(), returnBudgetLine: vi.fn(), approveRevision: vi.fn(), rejectRevision: vi.fn(),
    approveProject: vi.fn(), approvePublication: vi.fn(), rejectPublication: vi.fn(), audit: vi.fn(),
  },
}))
vi.mock('../api/ratesApi', () => ({ ratesApi: { tariffs: vi.fn(), approveTariff: vi.fn() } }))

import { financeApi } from '../api/financeApi'
import { ratesApi } from '../api/ratesApi'
import { useFinanceStore } from '../stores/finance'
import { loadAgenda, committeeDash, noteWithResolution, resolutionOf, currentTariff } from '../workspaces/committee/agenda'
import { toDecision } from '../workspaces/committee/decisions'
import AgendaPage from '../workspaces/committee/pages/AgendaPage.vue'
import '../workspaces/committee/routes'
import { registrationOf } from '../shell/workspaces'

const fa = financeApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const ra = ratesApi as unknown as Record<string, ReturnType<typeof vi.fn>>
const Stub = defineComponent({ render: () => h('div') })

const line = (over: Record<string, unknown> = {}) => ({
  budget_line_id: 'bl1', financial_year_id: 'y1', department_id: 'd1', code: 'EX-001', description: 'Road grading', status: 'submitted',
  currency: 'USD', account_kind: 'expenditure', original_amount: '12000.00', revised_amount: '12000.00', actual_amount: '0.00',
  execution_percentage: null, department_code: 'ENG', department_name: 'Engineering', submitted_by: 'u-other', ...over,
})
const revision = (over: Record<string, unknown> = {}) => ({
  id: 'r1', budget_line_id: 'bl1', revision_no: 2, amount_delta: '-500.00', currency: 'USD', reason: 'Saving on fuel', state: 'submitted',
  requested_by: 'u-other', requested_at: '2026-11-01T10:00:00Z', budget_line_code: 'EX-001', budget_line_description: 'Road grading', ...over,
})
const tariff = (over: Record<string, unknown> = {}) => ({
  id: 't1', financial_year_id: 'y1', financial_year_label: '2026', property_category_id: 'c1', category_code: 'RES', category_name: 'Residential',
  currency: 'USD', rate_in_dollar: '0.0125', status: 'draft', created_by: 'u-other', created_at: '2026-11-01T10:00:00Z', ...over,
})

function signIn(perms: string[]) {
  const store = useFinanceStore()
  store.identity = { user_id: 'me', role: 'finance_committee', authority_id: 1, permissions: perms, department_scope: [], catalogue: [] } as never
  return store
}

async function mountAgenda() {
  const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'com-agenda', component: Stub }] })
  await router.push('/')
  const w = mount(AgendaPage, { global: { plugins: [router] } })
  await flushPromises()
  return w
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  committeeDash.reset()
  fa.budgetLines.mockResolvedValue({ lines: [line()] })
  fa.revisions.mockResolvedValue([revision()])
  fa.projects.mockResolvedValue([])
  fa.publications.mockResolvedValue([])
  ra.tariffs.mockImplementation(async (p: { status: string }) => ({ tariffs: p.status === 'draft' ? [tariff()] : [tariff({ id: 't0', status: 'approved', rate_in_dollar: '0.0100', resolution_reference: 'FC/3/2025' })] }))
})

describe('the agenda', () => {
  it('reads only the kinds the member decides', async () => {
    const a = await loadAgenda((c) => c === 'finance.revision.approve')
    expect(fa.revisions).toHaveBeenCalledWith({ state: 'submitted', limit: 500 })
    expect(fa.budgetLines).not.toHaveBeenCalled()
    expect(ra.tariffs).not.toHaveBeenCalled()
    expect(a.budget.allowed).toBe(false)
    expect(a.revision.items).toHaveLength(1)
  })

  it('keeps the other kinds when one cannot be read', async () => {
    fa.budgetLines.mockRejectedValue(new Error('down'))
    const a = await loadAgenda(() => true)
    expect(a.budget.error).toBeTruthy()
    expect(a.revision.items).toHaveLength(1)
    expect(a.tariff.items).toHaveLength(1)
  })

  it('puts a draft tariff beside the approved rate it would replace', async () => {
    const a = await loadAgenda((c) => c === 'finance.rates.tariff.approve')
    expect(a.tariff.items[0].current?.rate_in_dollar).toBe('0.0100')
    expect(currentTariff(tariff() as never, [tariff({ currency: 'ZWG', status: 'approved' })] as never)).toBeNull()
  })

  it('shows only the groups the member decides, with their figures', async () => {
    signIn(['finance.revision.approve'])
    await committeeDash.load()
    const w = await mountAgenda()
    expect(w.text()).toContain('Revisions and virements')
    expect(w.text()).not.toContain('Budget lines')
    expect(w.text()).toContain('Road grading')
  })

  it('does not offer Approve on a line the member submitted', async () => {
    signIn(['finance.budget.approve'])
    fa.budgetLines.mockResolvedValue({ lines: [line({ submitted_by: 'me' })] })
    await committeeDash.load()
    const w = await mountAgenda()
    expect(w.text()).toContain('You submitted this line')
    expect(w.findAll('button').some((b) => b.text().includes('Approve'))).toBe(false)
    expect(w.findAll('button').some((b) => b.text().includes('Return'))).toBe(true)
  })

  it('rejects a revision only with a written reason', async () => {
    signIn(['finance.revision.approve'])
    fa.rejectRevision.mockResolvedValue({})
    await committeeDash.load()
    const w = await mountAgenda()
    await w.findAll('button').find((b) => b.text().includes('Reject'))!.trigger('click')
    await flushPromises()
    const submit = () => w.findAll('button[type="submit"]').at(-1)!
    expect(submit().attributes('disabled')).toBeDefined()
    await w.find('textarea').setValue('Not supported by the vote')
    expect(submit().attributes('disabled')).toBeUndefined()
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(fa.rejectRevision).toHaveBeenCalledWith('r1', 'Not supported by the vote')
  })

  it('carries a resolution reference in the note of a revision approval', async () => {
    signIn(['finance.revision.approve'])
    fa.approveRevision.mockResolvedValue({})
    await committeeDash.load()
    const w = await mountAgenda()
    await w.findAll('button').find((b) => b.text().includes('Approve'))!.trigger('click')
    await flushPromises()
    await w.find('input:not([type="date"])').setValue('FC/14/2026')
    await w.find('textarea').setValue('Within the vote ceiling')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(fa.approveRevision).toHaveBeenCalledWith('r1', 'Resolution FC/14/2026. Within the vote ceiling')
  })

  it('records a tariff approval against its resolution reference', async () => {
    signIn(['finance.rates.tariff.approve'])
    ra.approveTariff.mockResolvedValue({})
    await committeeDash.load()
    const w = await mountAgenda()
    expect(w.text()).toContain('0.0100')
    await w.findAll('button').find((b) => b.text().includes('Approve'))!.trigger('click')
    await flushPromises()
    expect(w.find('textarea').exists()).toBe(false)
    await w.find('input:not([type="date"])').setValue('FC/9/2026')
    await w.find('form').trigger('submit')
    await flushPromises()
    expect(ra.approveTariff).toHaveBeenCalledWith('t1', { resolution_reference: 'FC/9/2026' })
  })
})

describe('resolution references and the decision register', () => {
  it('writes and reads a resolution in a note', () => {
    expect(noteWithResolution('Agreed', '')).toBe('Agreed')
    expect(resolutionOf(noteWithResolution('Agreed in full', 'FC/14/2026'))).toBe('FC/14/2026')
    expect(resolutionOf('Agreed')).toBeNull()
  })

  it('reads decisions from the trail, refused attempts included, and ignores other writes', () => {
    const row = (path: string, status = 200, details: Record<string, unknown> = {}) => ({
      id: path, occurred_at: '2026-11-02T09:00:00Z', actor_email: 'chair@vungu', actor_role: 'finance_committee', event: 'FIN_REVISION',
      severity: 'critical', method: 'POST', path, status, entity_type: 'finance_budget_revision', entity_id: 'r1', ip: null, details,
    }) as never
    const ok = toDecision('revision', row('/api/finance/budget-revisions/r1/approve', 200, { note: 'Resolution FC/2/2026. Fine', before: { amount_delta: '-500.00', currency: 'USD' } }))
    expect(ok).toMatchObject({ outcome: 'approved', refused: false, resolution: 'FC/2/2026', figure: 'USD -500.00' })
    expect(toDecision('revision', row('/api/finance/budget-revisions/r1/approve', 403))?.refused).toBe(true)
    expect(toDecision('budget', row('/api/finance/budget-lines/bl1/return', 200, { note: 'Too high' }))?.outcome).toBe('returned')
    expect(toDecision('budget', row('/api/finance/budget-lines/bl1/submit'))).toBeNull()
  })
})

describe('registration', () => {
  it('registers the committee workspace and the targets it serves', () => {
    const reg = registrationOf('committee')
    expect(reg?.home).toBe('com-dashboard')
    expect(reg?.serves.budget).toBe('com-budget')
    expect(reg?.serves.revisions).toBe('com-revisions')
  })
})
