// @vitest-environment happy-dom
//
// Finance Management, the finance director's workspace: the position is composed per currency from
// reads the person may make (a read they may not make is never sent, so no refusal is audited), the
// approvals inbox says what is waiting, who decides and where, and an unreadable count is never zero.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

vi.mock('@/services/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('../api/dashboardsApi', () => ({ dashboardsApi: { officer: vi.fn(), executive: vi.fn(), revenue: vi.fn(), manager: vi.fn() } }))
vi.mock('../api/accountingApi', () => ({ accountingApi: { dashboard: vi.fn() } }))
vi.mock('../api/payablesApi', () => ({ payablesApi: { summary: vi.fn() } }))

import { dashboardsApi } from '../api/dashboardsApi'
import { accountingApi } from '../api/accountingApi'
import { payablesApi } from '../api/payablesApi'
import { position, loadPosition, resetPosition, ordered, execution, executionTone, whyEmpty } from '../workspaces/manager/position'
import { buildInbox, sortInbox, waitingTotal } from '../workspaces/manager/approvals'
import '../workspaces/manager/routes'
import { registrationOf } from '../shell/workspaces'

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
  resetPosition()
})

describe('the position read', () => {
  it('does not ask for a read the person may not make', async () => {
    m(dashboardsApi.officer).mockResolvedValue({ banks: [] })
    m(dashboardsApi.executive).mockResolvedValue({ totals: [] })
    m(accountingApi.dashboard).mockResolvedValue({ banks: [] })
    await loadPosition('y1', (code) => code === 'finance.ledger.view')
    expect(dashboardsApi.revenue).not.toHaveBeenCalled()
    expect(payablesApi.summary).not.toHaveBeenCalled()
    expect(position.revenue.state).toBe('denied')
    expect(position.payables.state).toBe('denied')
    expect(position.operations.state).toBe('ok')
    expect(dashboardsApi.officer).toHaveBeenCalledWith('y1')
  })

  it('reports a failed read as an error, not as an empty figure', async () => {
    m(dashboardsApi.officer).mockRejectedValue(new Error('boom'))
    m(dashboardsApi.executive).mockResolvedValue({ totals: [] })
    m(dashboardsApi.revenue).mockResolvedValue({ collection_rate: [] })
    m(accountingApi.dashboard).mockResolvedValue({ banks: [] })
    m(payablesApi.summary).mockResolvedValue({ owed: [] })
    await loadPosition('y1', () => true)
    expect(position.operations.state).toBe('error')
    expect(whyEmpty(position.operations, 'x')).toBeTruthy()
    expect(whyEmpty(position.executive, 'x')).toBeNull()
  })

  it('puts the reporting currency first and never merges currencies', () => {
    const rows = ordered([{ currency: 'ZWG', amount: '9' }, { currency: 'USD', amount: '1' }], 'USD')
    expect(rows.map((r) => r.currency)).toEqual(['USD', 'ZWG'])
    expect(rows).toHaveLength(2)
  })

  it('separates the two sides of the budget and tones over-spending red', () => {
    const exe = { totals: [
      { currency: 'USD', account_kind: 'revenue', budget: '10', actual: '5', execution: '50.0' },
      { currency: 'USD', account_kind: 'expenditure', budget: '10', actual: '11', execution: '110.0' },
    ] } as never
    expect(execution(exe, 'expenditure')).toHaveLength(1)
    expect(executionTone('110.0', 'expenditure')).toBe('is-over')
    expect(executionTone('95.0', 'expenditure')).toBe('is-mid')
    expect(executionTone('50.0', 'revenue')).toBe('is-over')
    expect(executionTone(null, 'revenue')).toBe('')
  })
})

describe('the approvals inbox', () => {
  const manager = { pending: [{ key: 'budget', label: 'Budget lines submitted', n: 3 }, { key: 'vouchers', label: 'Vouchers', n: 0 }] } as never

  it('lists every kind of decision with who makes it', () => {
    const items = buildInbox({ manager, accounting: null, payables: { awaiting_approval: { invoices: 2, payments: 1 } } as never,
      importsValidated: 4, assetRunsAwaiting: 0, disposalsAwaiting: 0, cutoversPreparing: null })
    const budget = items.find((i) => i.key === 'budget')!
    expect(budget.decides).toMatch(/committee/i)
    expect(budget.where).toEqual({ target: 'budget', query: { status: 'submitted' } })
    expect(items.find((i) => i.key === 'invoices')!.n).toBe(2)
    expect(items.find((i) => i.key === 'imports')!.n).toBe(4)
  })

  it('keeps an unreadable count apart from zero', () => {
    const items = sortInbox(buildInbox({ manager, accounting: null, payables: null,
      importsValidated: 4, assetRunsAwaiting: 0, disposalsAwaiting: 0, cutoversPreparing: null }))
    const cashups = items.find((i) => i.key === 'cashups')!
    expect(cashups.n).toBeNull()
    expect(cashups.why).toBeTruthy()
    // Waiting first, then nothing waiting, then unreadable.
    expect(items[0].key).toBe('imports')
    expect(items.at(-1)!.n).toBeNull()
    expect(waitingTotal(items)).toBe(7)
  })
})

describe('the workspace registration', () => {
  it('serves the statements, reports and documents as well as configuration', () => {
    const serves = registrationOf('manager')!.serves
    expect(serves.statements).toBe('mgr-statements')
    expect(serves.reports).toBe('mgr-reports')
    expect(serves.documents).toBe('mgr-documents')
    expect(serves.years).toBe('mgr-periods')
  })
})
