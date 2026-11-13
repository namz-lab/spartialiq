// @vitest-environment happy-dom
//
// The finance access screen is the only place outside SQL where a personal override or a
// departmental scope can be set. These tests pin the two things that would make it dangerous if
// they regressed: it does not load for someone without the permission, and it does not let an
// administrator edit their own access.
//
// A third, added after the production-readiness audit: it does not silently offer a combination
// the server will refuse. BLOCKER-2 was that an administrator could grant one officer an approval
// permission AND the publication permission; the server now recomputes the resulting effective
// set and answers 409, and this screen states the conflict as the administrator builds it instead
// of letting them press Save and read a 409.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

vi.mock('../api/financeApi', () => ({
  financeApi: {
    financeUsers: vi.fn(),
    financeUserAccess: vi.fn(),
    updateFinanceUserAccess: vi.fn(),
  },
}))

import { financeApi } from '../api/financeApi'
import AccessSection from '../pages/sections/AccessSection.vue'
import { useFinanceStore } from '../stores/finance'
import type {
  Department, FinanceAccessDetail, FinanceIdentity, FinancePermission, FinanceUserList,
} from '../models/types'

const api = financeApi as unknown as {
  financeUsers: ReturnType<typeof vi.fn>
  financeUserAccess: ReturnType<typeof vi.fn>
  updateFinanceUserAccess: ReturnType<typeof vi.fn>
}

const CATALOGUE: FinancePermission[] = [
  { code: 'finance.users.manage_finance_roles', label: 'Assign finance roles', category: 'administration', is_approval: false, is_publication: false, is_restricted: false, description: null },
  { code: 'finance.budget.view', label: 'View budgets', category: 'budget', is_approval: false, is_publication: false, is_restricted: false, description: null },
  { code: 'finance.audit.export', label: 'Export the audit trail', category: 'audit', is_approval: false, is_publication: false, is_restricted: false, description: null },
  { code: 'finance.budget.approve', label: 'Approve budget', category: 'budget', is_approval: true, is_publication: false, is_restricted: false, description: null },
  { code: 'finance.publication.publish', label: 'Publish a dataset', category: 'publication', is_approval: false, is_publication: true, is_restricted: false, description: null },
]

function identity(permissions: string[], userId = 'me'): FinanceIdentity {
  return { user_id: userId, role: 'admin', authority_id: 1, permissions, department_scope: [], catalogue: CATALOGUE }
}

const DEPARTMENT: Department = {
  id: 'd1', code: 'ENG', name: 'Engineering', vote_number: 3020,
  status: 'active', head_user_id: null,
}

const LIST: FinanceUserList = {
  users: [
    {
      id: 'u2', email: 'officer@vungu.test', name: 'Rudo Officer', role: 'planner',
      department: null, job_title: null, active: true, status: 'active',
      override_count: 0, scope_count: 0,
    },
  ],
  total: 1,
  limit: 100,
  offset: 0,
  roles: [
    { name: 'finance_officer', permissions: ['finance.budget.view'] },
    { name: 'auditor', permissions: ['finance.audit.export'] },
  ],
}

const DETAIL: FinanceAccessDetail = {
  user: {
    id: 'u2', email: 'officer@vungu.test', name: 'Rudo Officer', role: 'planner',
    department: null, job_title: null, active: true, status: 'active',
  },
  role_permissions: [],
  overrides: [],
  department_scope: [],
  permissions: ['finance.project.view'],
}

function mountSection(): ReturnType<typeof mount> {
  return mount(AccessSection)
}

async function chooseFirstUser(wrapper: ReturnType<typeof mount>): Promise<void> {
  const manage = wrapper.findAll('button').find((b) => b.text() === 'Manage')
  expect(manage, 'the staff list did not render a Manage action').toBeTruthy()
  await manage!.trigger('click')
  await flushPromises()
}

describe('finance access administration', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    const store = useFinanceStore()
    store.identity = identity([
      'finance.users.manage_finance_roles', 'finance.budget.view', 'finance.audit.export',
    ])
    store.departments = [DEPARTMENT]
    api.financeUsers.mockResolvedValue(LIST)
    api.financeUserAccess.mockResolvedValue(DETAIL)
  })

  it('lists staff and shows the permissions their role inherits', async () => {
    const wrapper = mountSection()
    await flushPromises()

    expect(api.financeUsers).toHaveBeenCalledTimes(1)
    expect(wrapper.text()).toContain('Rudo Officer')
    expect(wrapper.text()).toContain('officer@vungu.test')

    await chooseFirstUser(wrapper)
    expect(wrapper.text()).toContain('Effective')
    expect(wrapper.text()).toContain('finance.budget.view')
    expect(wrapper.text()).toContain('Engineering')
  })

  it('saves a role, an override and a reason as one reviewable change', async () => {
    api.updateFinanceUserAccess.mockResolvedValue({
      ...DETAIL,
      user: { ...DETAIL.user, role: 'finance_officer' },
      overrides: [{ permission_code: 'finance.audit.export', effect: 'grant', reason: 'Audit support', granted_by: 'me', granted_at: '2026-11-05T18:00:00Z', expires_at: null }],
      department_scope: [{ id: 'd1', code: 'ENG', name: 'Engineering' }],
      permissions: ['finance.budget.view', 'finance.audit.export'],
    } satisfies FinanceAccessDetail)

    const wrapper = mountSection()
    await flushPromises()
    await chooseFirstUser(wrapper)

    await wrapper.find('select').setValue('finance_officer')

    const auditRow = wrapper.findAll('tr').find((tr) => tr.text().includes('finance.audit.export'))
    expect(auditRow, 'the permission catalogue did not render the audit export row').toBeTruthy()
    const grant = auditRow!.findAll('button').find((b) => b.text() === 'Grant')
    await grant!.trigger('click')

    await wrapper.find('input[type="text"]').setValue('Appointed budget officer for the 2027 cycle')
    const save = wrapper.findAll('button').find((b) => b.text().includes('Save access'))
    expect(save).toBeTruthy()
    await save!.trigger('click')
    await flushPromises()

    expect(api.updateFinanceUserAccess).toHaveBeenCalledTimes(1)
    expect(api.updateFinanceUserAccess).toHaveBeenCalledWith('u2', expect.objectContaining({
      role: 'finance_officer',
      overrides: expect.arrayContaining([
        expect.objectContaining({ permission_code: 'finance.audit.export', effect: 'grant' }),
      ]),
      reason: 'Appointed budget officer for the 2027 cycle',
    }))
  })

  it('refuses to let an administrator edit their own access', async () => {
    const store = useFinanceStore()
    api.financeUsers.mockResolvedValue({
      ...LIST,
      users: [{ ...LIST.users[0], id: 'me', name: 'Ada Admin' }],
      total: 1,
    })
    api.financeUserAccess.mockResolvedValue({
      ...DETAIL,
      user: { ...DETAIL.user, id: 'me', name: 'Ada Admin', role: 'finance_admin' },
    })

    const wrapper = mountSection()
    await flushPromises()
    await chooseFirstUser(wrapper)

    expect(wrapper.text()).toContain('This is your own account')
    const save = wrapper.findAll('button').find((b) => b.text().includes('Save access'))
    expect(save?.attributes('disabled')).toBeDefined()
    expect(store.identity?.user_id).toBe('me')
  })

  it('refuses a grant that would leave one person approving and publishing', async () => {
    api.financeUserAccess.mockResolvedValue({
      ...DETAIL,
      user: { ...DETAIL.user, role: 'finance_committee' },
      // The committee's inherited approval duty.
      role_permissions: ['finance.budget.approve'],
      permissions: ['finance.budget.approve'],
    } satisfies FinanceAccessDetail)

    const wrapper = mountSection()
    await flushPromises()
    await chooseFirstUser(wrapper)

    const publishRow = wrapper.findAll('tr').find((tr) => tr.text().includes('finance.publication.publish'))
    expect(publishRow, 'the publication permission did not render').toBeTruthy()
    await publishRow!.findAll('button').find((b) => b.text() === 'Grant')!.trigger('click')
    await flushPromises()

    // Named, both of them, with what to do about it.
    expect(wrapper.text()).toContain('This combination cannot be saved')
    expect(wrapper.text()).toContain('Approve budget')
    expect(wrapper.text()).toContain('Publish a dataset')

    // And the save is not offered even with a reason typed, because the server would refuse it.
    await wrapper.find('input[type="text"]').setValue('Cover during the publisher’s leave')
    const save = wrapper.findAll('button').find((b) => b.text().includes('Save access'))
    expect(save?.attributes('disabled')).toBeDefined()
    expect(api.updateFinanceUserAccess).not.toHaveBeenCalled()

    // Denying the approval duty resolves it: the rule is about the result, not about one row.
    const approveRow = wrapper.findAll('tr').find((tr) => tr.text().includes('finance.budget.approve'))
    await approveRow!.findAll('button').find((b) => b.text() === 'Deny')!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('This combination cannot be saved')
    expect(wrapper.findAll('button').find((b) => b.text().includes('Save access'))?.attributes('disabled'))
      .toBeUndefined()
  })

  it('does not call the API at all without the administration permission', async () => {
    const store = useFinanceStore()
    store.identity = identity(['finance.budget.view'])

    const wrapper = mountSection()
    await flushPromises()

    expect(api.financeUsers).not.toHaveBeenCalled()
    expect(wrapper.text()).toContain('requires the administration permission')
  })
})
