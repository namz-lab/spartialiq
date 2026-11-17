// @vitest-environment happy-dom
//
// Finance Operations, the finance officer's workspace: imports are read by stage, the batches with
// unresolved exceptions are the review list, every task goes where it is worked (a billing run to
// Revenue and Rates), and the banking page reads only what the officer may read.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { defineComponent, h } from 'vue'

vi.mock('@/services/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('../api/bankApi', () => ({ bankApi: { overview: vi.fn(), statements: vi.fn() } }))
vi.mock('../api/cashApi', () => ({ cashApi: { deposits: vi.fn() } }))

import { bankApi } from '../api/bankApi'
import { cashApi } from '../api/cashApi'
import { batchesToReview, byStage, exceptionLabel } from '../workspaces/officer/imports'
import { taskLink } from '../workspaces/officer/tasks'
import BankingPage from '../workspaces/officer/pages/BankingPage.vue'
import '../workspaces/officer/routes'
import { registrationOf } from '../shell/workspaces'
import { useFinanceStore } from '../stores/finance'

const m = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>
const batch = (over: Record<string, unknown>) => ({
  id: 'b', dataset: 'actuals', original_filename: 'f.csv', status: 'validated', rows_total: 10, rows_rejected: 0,
  open_exceptions: '0', uploaded_at: '2026-11-01T10:00:00Z', ...over,
}) as never

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('imports', () => {
  it('counts batches by stage, leaving out cancelled and superseded ones', () => {
    const s = byStage([batch({ status: 'uploaded' }), batch({ status: 'mapped' }), batch({ status: 'validated' }),
      batch({ status: 'failed' }), batch({ status: 'cancelled' }), batch({ status: 'superseded' })])
    expect(Object.fromEntries(s.map((x) => [x.key, x.n]))).toEqual({ uploaded: 2, validated: 1, failed: 1, committed: 0 })
  })

  it('reviews failed batches and open ones with unresolved exceptions, newest first', () => {
    const r = batchesToReview([
      batch({ id: 'a', open_exceptions: '3', uploaded_at: '2026-11-01T00:00:00Z' }),
      batch({ id: 'b', status: 'failed', uploaded_at: '2026-11-03T00:00:00Z' }),
      batch({ id: 'c', status: 'cancelled', open_exceptions: '5' }),
      batch({ id: 'd' }),
    ])
    expect(r.map((x: { id: string }) => x.id)).toEqual(['b', 'a'])
  })

  it('names the server exception codes in plain words', () => {
    expect(exceptionLabel('UNKNOWN_ACCOUNT_CODE')).toBe('Account not in the chart')
    expect(exceptionLabel('SOMETHING_NEW')).toBe('something new')
  })
})

describe('the task queue', () => {
  it('sends each task where it is worked', () => {
    expect(taskLink({ key: 'reconciliation', text: 'Import exceptions to resolve' })).toEqual({ name: 'ofc-exceptions' })
    expect(taskLink({ key: 'reconciliation', text: 'Imports not yet committed' })).toEqual({ name: 'ofc-imports' })
    expect(taskLink({ key: 'receivables', text: 'Rates billing runs to commit' })).toEqual({ target: 'rates' })
    expect(taskLink({ key: 'receivables', text: 'Debtors owing more than 90 days' })).toEqual({ name: 'ofc-receivables' })
  })
})

describe('the workspace registration', () => {
  it('serves imports, projects and documents', () => {
    const serves = registrationOf('officer')!.serves
    expect(serves.imports).toBe('ofc-imports')
    expect(serves.projects).toBe('ofc-projects')
    expect(serves.documents).toBe('ofc-documents')
  })
})

describe('the banking page', () => {
  const Stub = defineComponent({ render: () => h('div') })
  async function mountAs(perms: string[]) {
    const store = useFinanceStore()
    store.identity = { user_id: 'u1', role: 'finance_officer', authority_id: 1, permissions: perms, department_scope: [], catalogue: [], workspaces: ['officer'] } as never
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'ofc-banking', component: Stub }] })
    await router.push('/')
    const w = mount(BankingPage, { global: { plugins: [router] } })
    await flushPromises()
    return w
  }

  it('shows the cashbook and reconciliation state, and says who captures statements', async () => {
    m(bankApi.overview).mockResolvedValue({ positions: [{ id: 'b1', code: '1100', name: 'Main', currency: 'USD', cashbook_balance: '250.00', last_entry: '2026-11-01',
      unmatched_entries: 2, reconciled_to: null, reconciled_balance: null, open_statements: 0 }], bank_accounts: [], fields: [] })
    m(bankApi.statements).mockResolvedValue([])
    m(cashApi.deposits).mockResolvedValue({ deposits: [] })
    const w = await mountAs(['finance.bank.view', 'finance.cash.view'])
    expect(w.text()).toContain('1100 — Main')
    expect(w.text()).toContain('Never reconciled')
    expect(w.text()).toContain('finance.bank.reconcile')
    expect(w.text()).not.toContain('!')
  })

  it('does not read the bank or the tills without the view permissions', async () => {
    const w = await mountAs([])
    expect(bankApi.overview).not.toHaveBeenCalled()
    expect(cashApi.deposits).not.toHaveBeenCalled()
    expect(w.text()).toContain('finance.bank.view')
  })
})
