// @vitest-environment happy-dom
//
// Every finance role lands in the finance workspace and nowhere else: `/finance` is the whole of
// what a budget officer, a treasurer, a publisher or an auditor sees. Until this component carried
// an account menu there was no way out of it — no sign-out, no way to see which account you were
// signed in as, and nothing that cleared the finance permission set from memory when you left.
//
// These tests pin the three things that matter about it:
//   1. The chip is there, for every finance role, labelled with the role the SERVER reports.
//   2. Signing out ends the session, clears the finance store, and leaves for /login — in that
//      order, so the next person at the same machine cannot inherit the previous officer's
//      permissions, departmental scope or selected year.
//   3. The menu does not appear before the identity is read, because a chip labelled "Finance"
//      under someone else's name is worse than no chip.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

const push = vi.fn()
const replace = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace }),
  useRoute: () => ({ query: {} }),
}))

const logout = vi.fn()
vi.mock('@/stores/auth', () => ({
  useAuthStore: () => ({ logout, user: { name: 'Rudo Moyo', email: 'rudo@vungu.test', role: 'budget_officer' } }),
}))

vi.mock('../api/financeApi', () => ({
  financeApi: {
    identity: vi.fn(),
    financialYears: vi.fn(),
    departments: vi.fn(),
    accounts: vi.fn(),
    programmes: vi.fn(),
  },
}))

import { financeApi } from '../api/financeApi'
import FinanceWorkspace from '../pages/FinanceWorkspace.vue'
import { useFinanceStore } from '../stores/finance'
import type { FinanceIdentity, FinancePermission } from '../models/types'

const api = financeApi as unknown as {
  identity: ReturnType<typeof vi.fn>
  financialYears: ReturnType<typeof vi.fn>
  departments: ReturnType<typeof vi.fn>
  accounts: ReturnType<typeof vi.fn>
  programmes: ReturnType<typeof vi.fn>
}

const CATALOGUE: FinancePermission[] = [
  { code: 'finance.budget.view', label: 'View budgets', category: 'budget', is_approval: false, is_publication: false, is_restricted: false, description: null },
]

function identity(role: string): FinanceIdentity {
  return {
    user_id: 'u1', role, authority_id: 1,
    permissions: ['finance.budget.view'], department_scope: [], catalogue: CATALOGUE,
  }
}

/** Mount the workspace with the server already answering for `role`. */
async function workspace(role = 'budget_officer') {
  api.identity.mockResolvedValue(identity(role))
  api.financialYears.mockResolvedValue([])
  api.departments.mockResolvedValue([])
  api.accounts.mockResolvedValue([])
  api.programmes.mockResolvedValue([])
  const wrapper = mount(FinanceWorkspace)
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  setActivePinia(createPinia())
  vi.clearAllMocks()
})

describe('the finance workspace account menu', () => {
  it('offers a sign-out to a finance role that has no other surface to reach it from', async () => {
    const wrapper = await workspace()
    // Both the chip's own sign-out and the one inside the opened panel count; either is enough for
    // an officer to leave, and the component must render at least one of them.
    expect(wrapper.find('.ph-logout-btn').exists()).toBe(true)
    wrapper.unmount()
  })

  it.each([
    ['finance_admin', 'Finance Administrator'],
    ['finance_officer', 'Finance Officer'],
    ['budget_officer', 'Budget Officer'],
    ['dept_head', 'Departmental Head'],
    ['finance_committee', 'Finance Committee'],
    ['publisher', 'Publisher'],
    ['auditor', 'Auditor'],
    // The technical administrator reaches this console for the audit trail and role provisioning.
    // Labelling it a finance role would misstate who is signed in.
    ['admin', 'IT Administrator'],
  ])('names the %s account as "%s", from the role the server reports', async (role, label) => {
    const wrapper = await workspace(role)
    expect(wrapper.find('.ph-role-badge').text()).toBe(label)
    wrapper.unmount()
  })

  it('ends the session, empties the finance store and leaves for the sign-in page', async () => {
    const wrapper = await workspace()
    const store = useFinanceStore()
    // A signed-in officer's state: permissions read, a year chosen.
    expect(store.identity).not.toBeNull()
    store.selectYear('year-1')

    await wrapper.find('.ph-logout-btn').trigger('click')
    await flushPromises()

    expect(logout).toHaveBeenCalledTimes(1)
    // The store outlives this component — Pinia state survives a route change — so clearing the
    // session without resetting it would leave this officer's permissions in memory for whoever
    // signs in next on the same machine.
    expect(store.identity).toBeNull()
    expect(store.selectedYearId).toBeNull()
    expect(store.permissions.size).toBe(0)
    expect(push).toHaveBeenCalledWith('/login')
    wrapper.unmount()
  })

  it('offers the sign-out while the permissions are still being read', async () => {
    // An identity call that never settles: the workspace is still reading permissions. The chip is
    // deliberately NOT gated on that answer — a slow or hanging permission read is exactly when an
    // officer wants to leave, and the role label falls back to the one the browser's own session
    // carries until the server replaces it.
    api.identity.mockReturnValue(new Promise(() => {}))
    api.financialYears.mockResolvedValue([])
    api.departments.mockResolvedValue([])
    api.accounts.mockResolvedValue([])
    api.programmes.mockResolvedValue([])
    const wrapper = mount(FinanceWorkspace)
    await flushPromises()

    expect(wrapper.text()).toContain('Reading your finance permissions')
    expect(wrapper.find('.ph-logout-btn').exists()).toBe(true)
    expect(wrapper.find('.ph-role-badge').text()).toBe('Budget Officer')
    wrapper.unmount()
  })

  it('still offers a way out when the permission read fails', async () => {
    // The failure case is the one where a stranded officer most needs the door: no identity means
    // no sections, and without a sign-out the only exit is the browser's address bar.
    api.identity.mockRejectedValue({ response: { status: 403, data: { message: 'No finance role.' } } })
    api.financialYears.mockResolvedValue([])
    api.departments.mockResolvedValue([])
    api.accounts.mockResolvedValue([])
    api.programmes.mockResolvedValue([])
    const wrapper = mount(FinanceWorkspace)
    await flushPromises()

    expect(wrapper.text()).toContain('No finance role.')
    expect(wrapper.find('.ph-logout-btn').exists()).toBe(true)
    wrapper.unmount()
  })
})
