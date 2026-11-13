// @vitest-environment happy-dom
//
// The work queues: what is waiting on each role, and the two rules that make them trustworthy.
//
// RULE ONE — THE REQUESTER NEVER APPROVES ITS OWN. A revision the viewer submitted does not appear
// in the viewer's approval queue. It is not hidden either: it is reported in that queue's caveat as
// awaiting another approver, because the honest statement is that the work exists and is not theirs
// to finish. The route and a CHECK constraint on finance.budget_revision refuse it independently;
// the queue must not contradict them by counting it.
//
// RULE TWO — A FAILED READ IS NOT A ZERO. The dev database has four budget lines, one transaction,
// one project with no location and an empty ward register, and no demo data may be invented to make
// these screens look busy. So a queue reports `count: null` when its read failed and a real 0 when
// it genuinely has nothing, and the panel renders those two differently.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('../api/financeApi', () => ({
  financeApi: {
    budgetLines: vi.fn(),
    revisions: vi.fn(),
    projects: vi.fn(),
    imports: vi.fn(),
    publications: vi.fn(),
    budgetExceptions: vi.fn(),
    audit: vi.fn(),
    // The ward-split decision queue (GAP-2) reads the spatial-allocation register.
    spatialAllocations: vi.fn(),
  },
}))

// The cash-up queue reads the cash office's sessions (migration 207/208).
vi.mock('../api/cashApi', () => ({ cashApi: { sessions: vi.fn() } }))

import { financeApi } from '../api/financeApi'
import { cashApi } from '../api/cashApi'
import { collectFinanceQueues } from '../composables/useFinanceQueues'
import { useFinanceStore } from '../stores/finance'
import type {
  BudgetRevision, FinanceIdentity, FinancialYear, ImportBatch, Publication,
} from '../models/types'

const api = financeApi as unknown as Record<string, ReturnType<typeof vi.fn>>

const YEAR: FinancialYear = {
  id: 'y1', label: '2031', start_date: '2031-01-01', end_date: '2031-12-31',
  status: 'open', reporting_currency: 'USD', notes: null, opened_at: null, closed_at: null,
}

const GRANTS: Record<string, string[]> = {
  finance_admin: [
    'finance.config.manage', 'finance.budget.view', 'finance.budget.prepare', 'finance.budget.submit',
    'finance.revision.prepare', 'finance.revision.submit', 'finance.actuals.view',
    'finance.import.upload', 'finance.import.validate', 'finance.import.commit',
    'finance.import.exception.resolve', 'finance.variance.explain', 'finance.audit.view',
    'finance.report.view', 'finance.report.export',
  ],
  finance_committee: [
    'finance.budget.view', 'finance.budget.approve', 'finance.revision.approve',
    'finance.project.view', 'finance.project.approve', 'finance.publication.review',
    'finance.publication.approve', 'finance.audit.view', 'finance.report.view',
    'finance.report.export',
  ],
  publisher: [
    'finance.budget.view', 'finance.project.view', 'finance.document.view',
    'finance.publication.review', 'finance.publication.publish', 'finance.publication.withdraw',
  ],
  dept_head: [
    'finance.budget.view', 'finance.budget.prepare', 'finance.budget.submit',
    'finance.revision.prepare', 'finance.revision.submit', 'finance.project.view',
    'finance.project.manage', 'finance.variance.explain',
  ],
  admin: [
    'finance.budget.view', 'finance.audit.view', 'finance.audit.export',
    'finance.users.manage_finance_roles',
  ],
  cash_supervisor: [
    'finance.cash.view', 'finance.cash.session.supervise', 'finance.cash.assignment.manage',
    'finance.cash.session.verify', 'finance.rates.view',
  ],
}

function signIn(role: string, opts: { userId?: string; scope?: FinanceIdentity['department_scope'] } = {}) {
  const store = useFinanceStore()
  store.identity = {
    user_id: opts.userId ?? 'me',
    role,
    authority_id: 1,
    permissions: GRANTS[role],
    department_scope: opts.scope ?? [],
    catalogue: [],
  }
  store.years = [YEAR]
  store.selectYear('y1')
  return store
}

const page = (total: number) => ({
  lines: [], total, limit: 1, offset: 0, available_balance_includes_commitments: false,
})

function revision(over: Partial<BudgetRevision>): BudgetRevision {
  return {
    id: 'r1', budget_line_id: 'b1', revision_no: 1, amount_delta: '1000.00', currency: 'USD',
    reason: 'More tar', state: 'submitted', effective_date: null, requested_by: 'someone-else',
    requested_at: '2031-03-01T00:00:00Z', decided_by: null, decided_at: null,
    decision_note: null, ...over,
  }
}

function batch(over: Partial<ImportBatch>): ImportBatch {
  return {
    id: 'i1', financial_year_id: 'y1', dataset: 'actuals', original_filename: 'march.csv',
    file_hash: 'abc', file_size_bytes: '10', status: 'validated', rows_total: 10, rows_valid: 10,
    rows_rejected: 0, declared_control_count: null, declared_control_total: null,
    declared_control_currency: null, reconciled_count: null, reconciled_total: null,
    reconciliation_status: 'not_declared', error_summary: null,
    uploaded_at: '2031-03-01T00:00:00Z', validated_at: '2031-03-02T00:00:00Z',
    committed_at: null, ...over,
  }
}

function publication(over: Partial<Publication>): Publication {
  return {
    id: 'p1', financial_year_id: 'y1', dataset: 'budget', version: 1, state: 'approved',
    reporting_period_label: null, data_as_at: null, decision_note: null, withdraw_reason: null,
    reviewed_at: null, reviewed_by_name: null, approved_at: null, approved_by_name: 'Someone',
    published_at: null, published_by_name: null, withdrawn_at: null, withdrawn_by_name: null,
    ...over,
  }
}

/** Nothing anywhere. Every mock resolves to an honest empty result. */
function nothingAnywhere(): void {
  api.budgetLines.mockResolvedValue(page(0))
  api.revisions.mockResolvedValue([])
  api.projects.mockResolvedValue([])
  api.imports.mockResolvedValue([])
  api.publications.mockResolvedValue([])
  api.budgetExceptions.mockResolvedValue({ rows: [], thresholds: { warn_execution_percentage: 90, flag_execution_percentage: 100 }, note: '' })
  api.audit.mockResolvedValue({ events: [], limit: 200, offset: 0, note: '' })
  api.spatialAllocations.mockResolvedValue({ allocations: [], limit: 200, offset: 0 })
  ;(cashApi.sessions as ReturnType<typeof vi.fn>).mockResolvedValue({ sessions: [], total: 0, limit: 200, offset: 0 })
}

const byId = (queues: Awaited<ReturnType<typeof collectFinanceQueues>>['queues'], id: string) =>
  queues.find((q) => q.id === id)

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  nothingAnywhere()
})

describe('separation of duties inside the queue', () => {
  it('never puts a revision the viewer requested in the viewer\'s own approval queue', async () => {
    const store = signIn('finance_committee', { userId: 'me' })
    api.revisions.mockResolvedValue([
      revision({ id: 'r-theirs', requested_by: 'someone-else' }),
      revision({ id: 'r-mine', requested_by: 'me' }),
      revision({ id: 'r-mine-2', requested_by: 'me' }),
    ])

    const { queues } = await collectFinanceQueues(store)
    const q = byId(queues, 'revisions-awaiting-approval')
    expect(q?.count).toBe(1)
    // And it does not pretend the other two have gone away.
    expect(q?.caveat).toMatch(/2 further submitted revisions are your own request/)
    expect(q?.caveat).toMatch(/awaiting another approver/)
  })

  it('says nothing about self-approval when none of the submitted work is the viewer\'s', async () => {
    const store = signIn('finance_committee', { userId: 'me' })
    api.revisions.mockResolvedValue([revision({ requested_by: 'someone-else' })])
    const { queues } = await collectFinanceQueues(store)
    expect(byId(queues, 'revisions-awaiting-approval')?.count).toBe(1)
    expect(byId(queues, 'revisions-awaiting-approval')?.caveat).toBeUndefined()
  })

  it('excludes the viewer\'s own submitted budget lines from its approval count too', async () => {
    const store = signIn('finance_committee', { userId: 'me' })
    api.budgetLines.mockResolvedValue({
      lines: [
        { budget_line_id: 'b1', submitted_by: 'me' },
        { budget_line_id: 'b2', submitted_by: 'someone-else' },
        { budget_line_id: 'b3', submitted_by: 'someone-else' },
      ],
      total: 3, limit: 200, offset: 0, available_balance_includes_commitments: false,
    })
    const { queues } = await collectFinanceQueues(store)
    const q = byId(queues, 'budget-awaiting-approval')
    expect(q?.count).toBe(2)
    expect(q?.caveat).toMatch(/1 further submitted line is your own/)
  })

  it('does not offer an approval queue to someone who cannot approve', async () => {
    const store = signIn('dept_head', { userId: 'me' })
    const { queues } = await collectFinanceQueues(store)
    expect(byId(queues, 'budget-awaiting-approval')).toBeUndefined()
    expect(byId(queues, 'revisions-awaiting-approval')).toBeUndefined()
  })
})

describe('cash-ups awaiting verification (migration 208)', () => {
  it('does not count a cash-up the viewer counted or witnessed under supervision as work waiting on them', async () => {
    const store = signIn('cash_supervisor', { userId: 'me' })
    const closed = (id: string, over: Record<string, string | null>) => ({ id, status: 'closed', cashier_id: 'a-cashier', closed_by: null, witness_id: null, ...over })
    ;(cashApi.sessions as ReturnType<typeof vi.fn>).mockResolvedValue({
      sessions: [
        closed('s-counted-by-me', { closed_by: 'me', witness_id: 'w' }),
        closed('s-witnessed-by-me', { closed_by: 'other-supervisor', witness_id: 'me' }),
        closed('s-theirs', {}),
      ],
      total: 3, limit: 200, offset: 0,
    })
    const { queues } = await collectFinanceQueues(store)
    expect(byId(queues, 'cash-ups-awaiting-verification')?.count).toBe(1)
  })
})

describe('the four handovers that used to be invisible', () => {
  it('tells a departmental head what in its votes is awaiting its submission', async () => {
    const store = signIn('dept_head', { scope: [{ id: 'd1', code: 'ENG', name: 'Engineering' }] })
    api.budgetLines.mockImplementation(({ status }: { status?: string }) =>
      Promise.resolve(page(status === 'draft' ? 3 : 0)))

    const { queues } = await collectFinanceQueues(store)
    const q = byId(queues, 'budget-awaiting-submission')
    expect(q?.count).toBe(3)
    // Scoped wording: "your department's", and the department named in the help text.
    expect(q?.label).toMatch(/Your department's lines awaiting submission/)
    expect(q?.help).toMatch(/Engineering/)
    expect(q?.section).toBe('budget')
    expect(q?.query).toEqual({ status: 'draft' })
  })

  it('tells the committee that budget lines are submitted to it, with a count', async () => {
    const store = signIn('finance_committee')
    api.budgetLines.mockResolvedValue({
      lines: [{ submitted_by: 'x' }, { submitted_by: 'y' }],
      total: 2, limit: 200, offset: 0, available_balance_includes_commitments: false,
    })
    const { queues } = await collectFinanceQueues(store)
    expect(byId(queues, 'budget-awaiting-approval')?.count).toBe(2)
    expect(byId(queues, 'budget-awaiting-approval')?.query).toEqual({ status: 'submitted' })
  })

  it('tells the publisher what is approved and awaiting publication, and not the committee\'s half', async () => {
    const store = signIn('publisher')
    api.publications.mockResolvedValue([
      publication({ id: 'pa', state: 'approved' }),
      publication({ id: 'pb', state: 'pending' }),
      publication({ id: 'pc', state: 'published' }),
    ])
    const { queues } = await collectFinanceQueues(store)
    expect(byId(queues, 'publication-awaiting-release')?.count).toBe(1)
    // The publisher cannot approve, so it is not given the committee's queue.
    expect(byId(queues, 'publication-awaiting-approval')).toBeUndefined()
  })

  it('tells the committee what is awaiting its release approval, and not the publisher\'s half', async () => {
    const store = signIn('finance_committee')
    api.publications.mockResolvedValue([
      publication({ id: 'pa', state: 'approved' }),
      publication({ id: 'pb', state: 'pending' }),
    ])
    const { queues } = await collectFinanceQueues(store)
    expect(byId(queues, 'publication-awaiting-approval')?.count).toBe(1)
    expect(byId(queues, 'publication-awaiting-release')).toBeUndefined()
  })

  it('tells the only committer which batches are validated and waiting for it', async () => {
    const store = signIn('finance_admin')
    api.imports.mockResolvedValue([
      batch({ id: 'i1', status: 'validated' }),
      batch({ id: 'i2', status: 'validated' }),
      batch({ id: 'i3', status: 'committed' }),
      batch({ id: 'i4', status: 'uploaded' }),
    ])
    const { queues } = await collectFinanceQueues(store)
    const q = byId(queues, 'imports-awaiting-commit')
    expect(q?.count).toBe(2)
    expect(q?.toneLabel).toBe('Only you can do this')
    expect(q?.query).toEqual({ status: 'validated' })
  })

  it('counts open exceptions only on batches that are still in play', async () => {
    const store = signIn('finance_admin')
    api.imports.mockResolvedValue([
      batch({ id: 'i1', status: 'validated', open_exceptions: '4' }),
      batch({ id: 'i2', status: 'uploaded', open_exceptions: '1' }),
      // A committed or cancelled batch's exceptions are history, not work.
      batch({ id: 'i3', status: 'committed', open_exceptions: '9' }),
      batch({ id: 'i4', status: 'cancelled', open_exceptions: '7' }),
    ])
    const { queues } = await collectFinanceQueues(store)
    expect(byId(queues, 'imports-open-exceptions')?.count).toBe(5)
  })

  it('tells a preparer when a line has been returned to it', async () => {
    const store = signIn('finance_admin')
    api.budgetLines.mockImplementation(({ status }: { status?: string }) =>
      Promise.resolve(page(status === 'returned' ? 2 : 0)))
    const { queues } = await collectFinanceQueues(store)
    expect(byId(queues, 'budget-returned')?.count).toBe(2)
    expect(byId(queues, 'budget-returned')?.query).toEqual({ status: 'returned' })
  })

  it('tells the committee which projects are awaiting its approval', async () => {
    const store = signIn('finance_committee')
    api.projects.mockResolvedValue([{ project_id: 'p1' }, { project_id: 'p2' }])
    const { queues } = await collectFinanceQueues(store)
    expect(byId(queues, 'projects-awaiting-approval')?.count).toBe(2)
    expect(api.projects).toHaveBeenCalledWith(expect.objectContaining({ status: 'awaiting_approval' }))
  })

  it('gives a technical administrator refusals rather than a financial queue', async () => {
    const store = signIn('admin')
    api.audit.mockResolvedValue({ events: [{ id: 'a1' }, { id: 'a2' }], limit: 200, offset: 0, note: '' })
    const { queues } = await collectFinanceQueues(store)
    expect(byId(queues, 'audit-refusals')?.count).toBe(2)
    expect(byId(queues, 'audit-refusals')?.label).toMatch(/last 7 days/)
    // admin must stay outside the money: no budget, revision, import or publication queue.
    expect(queues.map((q) => q.id)).toEqual(['audit-refusals'])
    expect(api.audit).toHaveBeenCalledWith(expect.objectContaining({ status_min: 400 }))
  })
})

describe('the empty states', () => {
  it('states plainly that a departmental head has nothing to submit, rather than going blank', async () => {
    const store = signIn('dept_head', { scope: [{ id: 'd1', code: 'ENG', name: 'Engineering' }] })
    const { queues } = await collectFinanceQueues(store)
    const q = byId(queues, 'budget-awaiting-submission')
    // A real zero, with a sentence written for this queue.
    expect(q?.count).toBe(0)
    expect(q?.empty).toBe('Nothing in your votes is waiting to be submitted.')
  })

  it('gives every queue a sentence for the case where there is nothing in it', async () => {
    for (const role of Object.keys(GRANTS)) {
      setActivePinia(createPinia())
      vi.clearAllMocks()
      nothingAnywhere()
      const store = signIn(role)
      const { queues } = await collectFinanceQueues(store)
      for (const q of queues) {
        expect(q.empty.length).toBeGreaterThan(10)
        expect(q.help.length).toBeGreaterThan(10)
        expect(q.empty.endsWith('.')).toBe(true)
      }
    }
  })

  it('reports a failed read as unknown, never as zero', async () => {
    const store = signIn('finance_admin')
    api.imports.mockRejectedValue(new Error('network'))
    const { queues, failures } = await collectFinanceQueues(store)
    const q = byId(queues, 'imports-awaiting-commit')
    expect(q?.count).toBeNull()
    expect(failures).toContain('import batches')
  })

  it('asks nothing and claims nothing when no reporting period is chosen', async () => {
    const store = signIn('finance_committee')
    store.selectYear(null)
    const { queues } = await collectFinanceQueues(store)
    // Not an error and not an empty queue: the question has no answer yet.
    expect(queues).toEqual([])
    expect(api.budgetLines).not.toHaveBeenCalled()
  })

  it('issues only the reads a role\'s permissions warrant', async () => {
    const store = signIn('publisher')
    await collectFinanceQueues(store)
    expect(api.publications).toHaveBeenCalledTimes(1)
    // A publisher prepares nothing, approves nothing and imports nothing.
    expect(api.budgetLines).not.toHaveBeenCalled()
    expect(api.revisions).not.toHaveBeenCalled()
    expect(api.imports).not.toHaveBeenCalled()
    expect(api.audit).not.toHaveBeenCalled()
  })
})
