// @vitest-environment happy-dom
//
// The Accounting workspace's navigation: grouped by the book, with the asset register routed to the
// page that exists. PortalShell is shared by ten other workspaces, so a nav without groups must
// still render exactly as before (no headings).
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { mount, flushPromises } from '@vue/test-utils'
import { RouterView, createMemoryHistory, createRouter } from 'vue-router'
import { House } from 'lucide-vue-next'

vi.mock('@/services/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: {} }), post: vi.fn(), put: vi.fn(), delete: vi.fn() } }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ logout: vi.fn(), user: { name: 'Demo Accountant', role: 'accountant' } }) }))
vi.mock('../api/accountingApi', () => ({ accountingApi: { dashboard: vi.fn().mockResolvedValue(null) } }))
vi.mock('../api/cashApi', () => ({ cashApi: { desk: vi.fn().mockResolvedValue(null) } }))

import { accountantRoutes } from '../workspaces/accountant/routes'
import PortalShell from '../workspaces/shared/PortalShell.vue'
import { useFinanceStore } from '../stores/finance'

const GROUPS = ['Desk', 'The books', 'Cash & bank', 'Debtors', 'Creditors', 'Assets', 'Period end', 'Control']

function makeRouter() {
  return createRouter({ history: createMemoryHistory(), routes: accountantRoutes })
}

beforeEach(() => {
  setActivePinia(createPinia())
  useFinanceStore().identity = { user_id: 'u1', role: 'accountant', authority_id: 1, permissions: [], department_scope: [], catalogue: [] } as never
})

describe('Accounting navigation', () => {
  it('groups the navigation by the book', async () => {
    const router = makeRouter()
    await router.push({ name: 'acc-tax' })
    // The layout is the parent route, so the router mounts it; mounting it directly would nest a second copy.
    const w = mount(RouterView, { global: { plugins: [router], stubs: { FinanceYearPicker: true } } })
    await flushPromises()
    expect(w.findAll('.cw-nav-group').map((g) => g.text())).toEqual(GROUPS)
    // S8: each group is exposed as a named group.
    const sets = w.findAll('.cw-nav [role="group"]')
    expect(sets).toHaveLength(GROUPS.length)
    for (const set of sets) expect(w.get(`#${set.attributes('aria-labelledby')}`).text()).toBe(set.get('.cw-nav-group').text())
    expect(w.findAll('.cw-nav a').map((a) => a.text())).toEqual([
      'Dashboard', 'Journals', 'Salaries Journal', 'General Ledger', 'Trial Balance', 'Cashbook', 'Bank Reconciliation', 'Cash-Up Approvals',
      'Banking & Deposits', 'Debtors', 'Revenue & Billing', 'Accounts Payable', 'Parties', 'Asset Register', 'Period Close',
      'Financial Statements', 'Ledger Reports', 'Tax Control', 'Vote Book', 'Audit Trail', 'Data Migration', 'Settings',
    ])
  })

  it('routes the asset register to the page that exists', () => {
    const r = makeRouter().resolve({ name: 'acc-assets' })
    expect(r.matched.at(-1)?.meta.cwWhy).toBeUndefined()
    expect(r.matched.at(-1)?.meta.cwTitle).toBe('Asset Register')
  })

  it('keeps the old supplier address working and highlights the parent of a child page', () => {
    const router = makeRouter()
    expect(router.resolve({ name: 'acc-suppliers' }).fullPath).toBe('/finance/accountant/suppliers')
    expect(router.resolve({ name: 'acc-journal-new' }).path).toBe('/finance/accountant/journals/new')
    expect(router.resolve('/finance/accountant/journals/new').name).toBe('acc-journal-new')
    expect(router.resolve('/finance/accountant/journals/7/edit').name).toBe('acc-journal-edit')
    expect(router.resolve('/finance/accountant/journals/7').name).toBe('acc-voucher')
    expect(router.resolve({ name: 'acc-voucher', params: { id: '7' } }).meta.cwNav).toBe('acc-journals')
    expect(router.resolve({ name: 'acc-account', params: { id: '7' } }).meta.cwNav).toBe('acc-ledger')
    expect(router.resolve({ name: 'acc-debtor', params: { partyId: '7' } }).meta.cwNav).toBe('acc-receivable')
  })

  it('redirects the old supplier address to Parties', async () => {
    const router = makeRouter()
    await router.push('/finance/accountant/suppliers')
    expect(router.currentRoute.value.name).toBe('acc-parties')
  })

  it('a shell without groups renders no heading', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/', name: 'acc-dashboard', component: { template: '<p>page</p>' } }] })
    await router.push('/')
    const w = mount(PortalShell, {
      props: { nav: [{ name: 'acc-dashboard', label: 'Home', icon: House }], homeRoute: 'acc-dashboard', homeTitle: 'Home', brandSub: 'x', navLabel: 'Test' },
      global: { plugins: [router], stubs: { FinanceYearPicker: true } },
    })
    await flushPromises()
    expect(w.findAll('.cw-nav-group')).toHaveLength(0)
    expect(w.findAll('.cw-nav a')).toHaveLength(1)
  })
})

// WCAG 2.4.2 Page Titled and 2.4.3 Focus Order (audit B9): each page its own title; a new page takes focus.
describe('PortalShell page title and focus on navigation', () => {
  function shell() {
    const page = { template: '<p>page</p>' }
    const form = { template: '<input id="own-field" />', mounted() { (this as { $el: HTMLElement }).$el.focus() } }
    const router = createRouter({ history: createMemoryHistory(), routes: [
      { path: '/', name: 'acc-dashboard', component: page },
      { path: '/journals', name: 'acc-journals', component: page, meta: { cwTitle: 'Journals' } },
      { path: '/trial', name: 'acc-trial', component: page, meta: { cwTitle: 'Trial Balance' } },
      { path: '/form', name: 'acc-form', component: form, meta: { cwTitle: 'Form' } },
      { path: '/voucher/:id', name: 'acc-voucher', component: page, meta: { cwTitle: 'Voucher' } },
    ] })
    const nav = [
      { name: 'acc-dashboard', label: 'Dashboard', icon: House },
      { name: 'acc-journals', label: 'Journals', icon: House },
      { name: 'acc-trial', label: 'Trial Balance', icon: House },
    ]
    return { router, mountIt: () => mount(PortalShell, {
      props: { nav, homeRoute: 'acc-dashboard', homeTitle: 'Accountant Dashboard', brandSub: 'x', navLabel: 'Accounting' },
      global: { plugins: [router], stubs: { FinanceYearPicker: true } }, attachTo: document.body,
    }) }
  }

  it('titles the document from the page, distinct per page', async () => {
    const { router, mountIt } = shell()
    await router.push('/')
    const w = mountIt()
    await flushPromises()
    expect(document.title).toBe('Accountant Dashboard – Accounting – Vungu RDC')
    await router.push('/journals'); await flushPromises()
    expect(document.title).toBe('Journals – Accounting – Vungu RDC')
    await router.push('/trial'); await flushPromises()
    expect(document.title).toBe('Trial Balance – Accounting – Vungu RDC')
    expect(w.get('main#cw-main').attributes('aria-label')).toBe('Trial Balance')
    w.unmount()
  })

  it('moves focus to the page on a new path, not on first load and not on a query change', async () => {
    const { router, mountIt } = shell()
    await router.push('/')
    const w = mountIt()
    await flushPromises()
    const main = w.get('main#cw-main').element
    expect(document.activeElement).not.toBe(main)
    const link = w.findAll('.cw-nav a').find((a) => a.text() === 'Journals')!
    ;(link.element as HTMLElement).focus()
    await router.push('/journals'); await flushPromises()
    expect(document.activeElement).toBe(main)
    // A filter writes the query: focus stays where the person put it.
    ;(link.element as HTMLElement).focus()
    await router.replace({ path: '/journals', query: { q: 'x' } }); await flushPromises()
    expect(document.activeElement).toBe(link.element)
    w.unmount()
  })

  it('leaves focus alone when the new page has already put it inside itself', async () => {
    const { router, mountIt } = shell()
    await router.push('/')
    const w = mountIt()
    await flushPromises()
    await router.push('/form'); await flushPromises()
    expect(document.activeElement?.id).toBe('own-field')
    w.unmount()
  })

  it('keeps its title after the router\'s global guard rewrites it, on a query-only and a same-title navigation', async () => {
    const { router, mountIt } = shell()
    // As frontend/src/router/index.ts does: one workspace title written on every navigation.
    router.beforeEach(() => { document.title = 'Accounting - Vungu Rural District Council' })
    await router.push('/journals')
    const w = mountIt()
    await flushPromises()
    expect(document.title).toBe('Journals – Accounting – Vungu RDC')
    await router.replace({ path: '/journals', query: { q: 'rates' } }); await flushPromises()
    expect(document.title).toBe('Journals – Accounting – Vungu RDC')
    await router.push('/voucher/1'); await flushPromises()
    expect(document.title).toBe('Voucher – Accounting – Vungu RDC')
    await router.push('/voucher/2'); await flushPromises()
    expect(document.title).toBe('Voucher – Accounting – Vungu RDC')
    w.unmount()
  })

  it('exposes the menu button state, moves focus into the menu and back on Escape, and closes on an outside click', async () => {
    const { router, mountIt } = shell()
    await router.push('/journals')
    const w = mountIt()
    await flushPromises()
    const toggle = w.get('.cw-menu-toggle')
    expect(toggle.attributes('aria-controls')).toBe('cw-side')
    expect(w.get('#cw-side').exists()).toBe(true)
    expect(toggle.attributes('aria-expanded')).toBe('false')
    ;(toggle.element as HTMLElement).focus()
    await toggle.trigger('click'); await flushPromises()
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(w.get('.cw').classes()).toContain('is-nav-open')
    expect((document.activeElement as HTMLElement).textContent).toContain('Journals') // the current page's link
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })); await flushPromises()
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(document.activeElement).toBe(toggle.element)
    await toggle.trigger('click'); await flushPromises()
    document.body.click(); await flushPromises()
    expect(toggle.attributes('aria-expanded')).toBe('false')
    w.unmount()
  })

  it('always mounts a polite and an assertive live region and speaks announce() through them', async () => {
    const { router, mountIt } = shell()
    await router.push('/journals')
    const w = mountIt()
    await flushPromises()
    expect(w.get('[data-testid="announce-polite"]').attributes('role')).toBe('status')
    expect(w.get('[data-testid="announce-assertive"]').attributes('role')).toBe('alert')
    const { announce } = await import('../workspaces/shared/usePortalAnnouncer')
    announce('Saved.')
    announce('Refused.', 'assertive')
    await new Promise((r) => setTimeout(r, 60)); await flushPromises()
    expect(w.get('[data-testid="announce-polite"]').text()).toBe('Saved.')
    expect(w.get('[data-testid="announce-assertive"]').text()).toBe('Refused.')
    w.unmount()
  })

  it('shows the page title alone when titlePrefix is set and the route has no cwTitle', async () => {
    const { router } = shell()
    await router.push('/')
    const w = mount(PortalShell, {
      props: { nav: [{ name: 'acc-dashboard', label: 'Dashboard', icon: House }], homeRoute: 'acc-journals', homeTitle: 'Home', brandSub: 'x', navLabel: 'Accounting', titlePrefix: 'Cashier' },
      global: { plugins: [router], stubs: { FinanceYearPicker: true } }, attachTo: document.body,
    })
    await flushPromises()
    expect(w.get('h1').text()).toBe('Cashier')
    w.unmount()
  })

  it('has "Skip to content" as its first focusable element, pointing at the page (WCAG 2.4.1)', async () => {
    const { router, mountIt } = shell()
    await router.push('/journals')
    const w = mountIt()
    await flushPromises()
    const first = w.element.querySelector<HTMLElement>('a[href], button:not([disabled]), input, select, textarea, [tabindex]:not([tabindex="-1"])')!
    expect(first.textContent).toBe('Skip to content')
    expect(first.getAttribute('href')).toBe('#cw-main')
    // Hidden until focused; portal.css reveals .cw-skip on :focus / :focus-visible.
    expect(first.classList.contains('cw-skip')).toBe(true)
    w.unmount()
  })
})
