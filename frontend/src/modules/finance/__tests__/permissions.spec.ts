// @vitest-environment happy-dom
//
// What the finance store and the permission guard promise, and what they explicitly do NOT.
//
// The thing worth testing here is the boundary: `can()` decides what the UI OFFERS, and the
// server decides what happens. These tests assert the offering behaviour and assert, in the one
// test that matters most, that a hidden control is not treated as a control.
import { describe, it, expect, beforeEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount } from '@vue/test-utils'
import { useFinanceStore, messageOf } from '../stores/finance'
import FinanceGuard from '../components/FinanceGuard.vue'
import type { FinanceIdentity, FinancePermission } from '../models/types'

const CATALOGUE: FinancePermission[] = [
  { code: 'finance.budget.view', label: 'View budgets', category: 'budget', is_approval: false, is_publication: false, is_restricted: false, description: null },
  { code: 'finance.budget.prepare', label: 'Prepare budget lines', category: 'budget', is_approval: false, is_publication: false, is_restricted: false, description: null },
  { code: 'finance.budget.approve', label: 'Approve budget', category: 'budget', is_approval: true, is_publication: false, is_restricted: false, description: 'Authorise the official approved allocation.' },
  { code: 'finance.publication.publish', label: 'Publish a dataset', category: 'publication', is_approval: false, is_publication: true, is_restricted: false, description: null },
  { code: 'finance.transaction.view_counterparty', label: 'View counterparty identity', category: 'actuals', is_approval: false, is_publication: false, is_restricted: true, description: null },
]

function identity(role: string, permissions: string[], scope: FinanceIdentity['department_scope'] = []): FinanceIdentity {
  return { user_id: 'u1', role, authority_id: 1, permissions, department_scope: scope, catalogue: CATALOGUE }
}

describe('the finance store', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  it('offers only what the server says this person holds', () => {
    const store = useFinanceStore()
    store.identity = identity('budget_officer', ['finance.budget.view', 'finance.budget.prepare'])
    expect(store.can('finance.budget.view')).toBe(true)
    expect(store.can('finance.budget.prepare')).toBe(true)
    expect(store.can('finance.budget.approve')).toBe(false)
    expect(store.canAny('finance.budget.approve', 'finance.budget.view')).toBe(true)
    expect(store.canAny('finance.budget.approve', 'finance.publication.publish')).toBe(false)
  })

  it('offers nothing at all before the identity is loaded', () => {
    // Failing closed matters: a store that answered `true` while loading would flash controls the
    // person cannot use and, worse, read as permission where there is none.
    const store = useFinanceStore()
    expect(store.identity).toBeNull()
    expect(store.can('finance.budget.view')).toBe(false)
    expect(store.canAny('finance.budget.view', 'finance.budget.approve')).toBe(false)
  })

  it('explains an approval, a publication and a restricted permission differently', () => {
    const store = useFinanceStore()
    store.identity = identity('finance_officer', ['finance.budget.view'])
    expect(store.whyUnavailable('finance.budget.approve')).toMatch(/someone else approves/)
    expect(store.whyUnavailable('finance.publication.publish')).toMatch(/separate duties/)
    expect(store.whyUnavailable('finance.transaction.view_counterparty')).toMatch(/sensitive data/)
    expect(store.whyUnavailable('finance.budget.prepare')).toMatch(/your role does not hold/)
  })

  it('reports a departmental head as scoped, and everyone else as council-wide', () => {
    const store = useFinanceStore()
    store.identity = identity('finance_officer', ['finance.budget.view'])
    expect(store.isScoped).toBe(false)

    store.identity = identity('dept_head', ['finance.budget.view'], [{ id: 'd1', code: 'ENG', name: 'Engineering' }])
    expect(store.isScoped).toBe(true)
    expect(store.departmentScope.map((d) => d.code)).toEqual(['ENG'])
  })

  it('knows which year accepts writes, and treats a closed year as read-only', () => {
    const store = useFinanceStore()
    const base = { reporting_currency: 'USD' as const, notes: null, opened_at: null, closed_at: null }
    store.years = [
      { id: 'y-open', label: '2031', start_date: '2031-01-01', end_date: '2031-12-31', status: 'open', ...base },
      { id: 'y-closed', label: '2030', start_date: '2030-01-01', end_date: '2030-12-31', status: 'closed', ...base },
    ]
    store.selectYear('y-open')
    expect(store.selectedYearAcceptsWrites).toBe(true)
    store.selectYear('y-closed')
    expect(store.selectedYearAcceptsWrites).toBe(false)
    expect(store.selectedYear?.label).toBe('2030')
  })

  it('says what is missing before anything can be budgeted', () => {
    const store = useFinanceStore()
    expect(store.needsSetup.any).toBe(true)
    expect(store.needsSetup.noYear).toBe(true)
    expect(store.needsSetup.noDepartments).toBe(true)
    expect(store.needsSetup.noAccounts).toBe(true)
  })

  it('offers only postable, active accounts for budgeting', () => {
    const store = useFinanceStore()
    const base = {
      revenue_class: null, expenditure_class: null, parent_id: null,
      effective_from: null, effective_to: null,
    }
    store.accounts = [
      { id: 'a1', code: '5100', name: 'Roads', kind: 'expenditure', is_postable: true, status: 'active', ...base },
      { id: 'a2', code: '5000', name: 'Heading', kind: 'expenditure', is_postable: false, status: 'active', ...base },
      { id: 'a3', code: '5200', name: 'Retired', kind: 'expenditure', is_postable: true, status: 'inactive', ...base },
      { id: 'a4', code: '1100', name: 'Rates', kind: 'revenue', is_postable: true, status: 'active', ...base },
    ]
    expect(store.postableAccounts.map((a) => a.code)).toEqual(['5100', '1100'])
    expect(store.expenditureAccounts.map((a) => a.code)).toEqual(['5100'])
    expect(store.revenueAccounts.map((a) => a.code)).toEqual(['1100'])
  })
})

describe('FinanceGuard', () => {
  beforeEach(() => { setActivePinia(createPinia()) })

  const mountGuard = (requires: string | string[], surface?: string) => mount(FinanceGuard, {
    props: { requires, surface },
    slots: { default: '<button type="button" id="the-action">Approve</button>' },
    global: { plugins: [] },
  })

  it('renders the action when the permission is held', () => {
    const store = useFinanceStore()
    store.identity = identity('finance_committee', ['finance.budget.approve'])
    const wrapper = mountGuard('finance.budget.approve')
    expect(wrapper.find('#the-action').exists()).toBe(true)
  })

  it('explains instead of rendering the action when it is not', () => {
    const store = useFinanceStore()
    store.identity = identity('budget_officer', ['finance.budget.view'])
    const wrapper = mountGuard('finance.budget.approve', 'Approving a budget')
    expect(wrapper.find('#the-action').exists()).toBe(false)
    // It explains rather than going blank: a blank panel reads as a broken system.
    expect(wrapper.text()).toContain('Approving a budget is not open to your role')
    expect(wrapper.text()).toMatch(/someone else approves/)
    expect(wrapper.text()).toContain('budget_officer')
  })

  it('renders when any one of several permissions is held', () => {
    const store = useFinanceStore()
    store.identity = identity('publisher', ['finance.publication.publish'])
    expect(mountGuard(['finance.budget.approve', 'finance.publication.publish']).find('#the-action').exists()).toBe(true)
    expect(mountGuard(['finance.budget.approve', 'finance.budget.prepare']).find('#the-action').exists()).toBe(false)
  })

  it('hides nothing that the server would have allowed, and allows nothing the server would refuse', () => {
    // The guard is a mirror of the server's answer, not a second opinion. If the server reports a
    // permission, the control appears; if it does not, it does not — with no local override, no
    // role-name special case and no "admin sees everything" shortcut anywhere in this component.
    const store = useFinanceStore()
    store.identity = identity('admin', ['finance.budget.view', 'finance.audit.view'])
    expect(mountGuard('finance.budget.approve').find('#the-action').exists()).toBe(false)
    expect(mountGuard('finance.publication.publish').find('#the-action').exists()).toBe(false)
    expect(mountGuard('finance.budget.view').find('#the-action').exists()).toBe(true)
  })
})

describe('messageOf', () => {
  it('uses the sentence the backend wrote, which is written for a council officer', () => {
    expect(messageOf({
      response: { status: 409, data: { success: false, error: 'year_closed', message: 'Financial year 2030 is closed.' } },
    })).toBe('Financial year 2030 is closed.')
  })

  it('names the permission a refusal needed, because "forbidden" is not actionable', () => {
    expect(messageOf({
      response: {
        status: 403,
        data: { message: 'You do not hold the permission this action requires.', required_permission: 'finance.publication.publish' },
      },
    })).toBe('You do not hold the permission this action requires. (needs finance.publication.publish)')
  })

  it('falls back to something true for a bare status', () => {
    expect(messageOf({ response: { status: 401 } })).toMatch(/session has ended/i)
    expect(messageOf({ response: { status: 413 } })).toMatch(/larger than the council allows/i)
    expect(messageOf({}, 'Nothing happened.')).toBe('Nothing happened.')
  })
})
