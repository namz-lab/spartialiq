// @vitest-environment happy-dom
//
// The frame every finance workspace sits in, and the switcher between workspaces.
//
// The frame is chrome only: application name, year, switcher, profile, boot states and the one
// sentence that explains a redirect. Navigation and content belong to the workspace. Pinned here:
//   - the application name is the workspace's, so a cashier is in "Cash Office", not "Finance";
//   - a failed identity read is shown with Retry, not as an empty workspace;
//   - signing out clears the finance store, because the next person on a shared office machine
//     must not inherit this person's permissions;
//   - the switcher offers only workspaces the server granted AND that exist in this build.
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'

const push = vi.fn()
const replace = vi.fn()
const route = { query: {} as Record<string, string>, meta: { financeWorkspace: 'cashier' } }
vi.mock('vue-router', () => ({
  useRouter: () => ({ push, replace }),
  useRoute: () => route,
}))

vi.mock('../api/financeApi', () => ({ financeApi: { identity: vi.fn() } }))
const logout = vi.fn().mockResolvedValue(undefined)
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ logout, user: { role: 'cashier' } }) }))

import { financeApi } from '../api/financeApi'
import { useFinanceStore } from '../stores/finance'
import { registerWorkspace, __resetRegistry } from '../shell/workspaces'
import WorkspaceFrame from '../shell/WorkspaceFrame.vue'
import WorkspaceSwitcher from '../shell/WorkspaceSwitcher.vue'
import type { FinanceIdentity } from '../models/types'

const identity = (role: string, workspaces: string[]) => ({
  user_id: 'u1', role, authority_id: 1, permissions: [], department_scope: [], catalogue: [],
  workspaces, home_workspace: workspaces[0] ?? null,
}) as unknown as FinanceIdentity

const stubs = { ProfileDropdown: { template: '<button class="pd" @click="$emit(\'logout\')">profile</button>' }, FinanceYearPicker: true, RouterLink: { props: ['to'], template: '<a :href="typeof to === \'string\' ? to : to.path"><slot /></a>' } }

beforeEach(() => {
  setActivePinia(createPinia())
  __resetRegistry()
  route.query = {}
  push.mockReset(); replace.mockReset(); logout.mockClear()
  vi.mocked(financeApi.identity).mockReset()
  for (const key of ['cashier', 'revenue', 'accountant'] as const) registerWorkspace({ key, routes: [], serves: {} })
})

describe('WorkspaceFrame', () => {
  it('names the application after the workspace', async () => {
    vi.mocked(financeApi.identity).mockResolvedValue(identity('cashier', ['cashier']))
    const w = mount(WorkspaceFrame, { props: { workspace: 'cashier' }, global: { stubs } })
    await flushPromises()
    expect(w.get('h1').text()).toBe('Cash Office')
  })

  it('shows the identity error with Retry instead of an empty workspace', async () => {
    vi.mocked(financeApi.identity).mockRejectedValue(new Error('down'))
    const w = mount(WorkspaceFrame, { props: { workspace: 'cashier' }, global: { stubs } })
    await flushPromises()
    expect(w.get('[role="alert"]').text()).toContain('Retry')
    expect(w.find('#fin-main').exists()).toBe(false)
  })

  it('clears the finance store when signing out', async () => {
    vi.mocked(financeApi.identity).mockResolvedValue(identity('cashier', ['cashier']))
    const w = mount(WorkspaceFrame, { props: { workspace: 'cashier' }, global: { stubs } })
    await flushPromises()
    await w.get('.pd').trigger('click')
    await flushPromises()
    expect(logout).toHaveBeenCalled()
    expect(useFinanceStore().identity).toBeNull()
    expect(push).toHaveBeenCalledWith('/login')
  })

  it('explains a redirect from a workspace that is not theirs', async () => {
    route.query = { notice: 'not-yours' }
    vi.mocked(financeApi.identity).mockResolvedValue(identity('cashier', ['cashier']))
    const w = mount(WorkspaceFrame, { props: { workspace: 'cashier' }, global: { stubs } })
    await flushPromises()
    expect(w.get('[role="status"].wsn').text())
      .toContain('That workspace is not one of yours. You have been returned to your own work.')
  })

  it('renders the workspace content in the main region', async () => {
    vi.mocked(financeApi.identity).mockResolvedValue(identity('cashier', ['cashier']))
    const w = mount(WorkspaceFrame, {
      props: { workspace: 'cashier' }, global: { stubs },
      slots: { default: '<p class="content">counter</p>', nav: '<nav class="own-nav">tabs</nav>' },
    })
    await flushPromises()
    expect(w.get('#fin-main .content').text()).toBe('counter')
    expect(w.find('.own-nav').exists()).toBe(true)
  })
})

describe('WorkspaceSwitcher', () => {
  async function mountSwitcher(workspaces: string[], showConsole = false) {
    const store = useFinanceStore()
    vi.mocked(financeApi.identity).mockResolvedValue(identity('revenue_officer', workspaces))
    await store.loadIdentity()
    return mount(WorkspaceSwitcher, { props: { current: 'revenue', showConsole }, global: { stubs }, attachTo: document.body })
  }

  it('lists only granted workspaces that exist in this build, in catalogue order', async () => {
    const w = await mountSwitcher(['revenue', 'cashier', 'publisher'])
    await w.get('button').trigger('click')
    expect(w.findAll('li').map((li) => li.text())).toEqual(['Cash Office', 'Revenue and Rates'])
  })

  it('marks the workspace the person is in', async () => {
    const w = await mountSwitcher(['revenue', 'cashier'])
    await w.get('button').trigger('click')
    expect(w.get('[aria-current="page"]').text()).toBe('Revenue and Rates')
  })

  it('is not rendered for someone with one workspace and no console link', async () => {
    const w = await mountSwitcher(['revenue'])
    expect(w.find('button').exists()).toBe(false)
  })

  it('offers the previous console while the migration lasts', async () => {
    const w = await mountSwitcher(['revenue'], true)
    await w.get('button').trigger('click')
    expect(w.text()).toContain('Previous finance console')
  })

  it('closes on Escape and returns focus to its button', async () => {
    const w = await mountSwitcher(['revenue', 'cashier'])
    const button = w.get('button')
    await button.trigger('click')
    await w.get('ul').trigger('keydown', { key: 'Escape' })
    expect(w.find('ul').exists()).toBe(false)
    expect(document.activeElement).toBe(button.element)
    w.unmount()
  })
})
