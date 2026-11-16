// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { data: [] } }), post: vi.fn(), put: vi.fn(),
             patch: vi.fn(), delete: vi.fn(), defaults: { headers: { common: {} } } },
}))
vi.mock('@/services/session', () => ({
  hasSessionHint: () => false, markSignedIn: vi.fn(), clearSession: vi.fn(),
}))
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useRoute: () => ({ query: {}, params: {} }),
}))

import EOPlannerPortalView from '@/views/EOPlannerPortalView.vue'
import { SECTION_KEYS } from '@/eo-planner/console'

// Audit F17: these sections existed but nothing rendered them. This mounts the
// console pane exactly as EOPlannerWorkspace does (embedded) and asserts the
// rail really carries every section — they are reachable, not merely imported.
describe('F17 — EO console pane renders its sections', () => {
  it('renders every section in the contract, grouped, and suppresses duplicated chrome', async () => {
    setActivePinia(createPinia())
    const w = mount(EOPlannerPortalView, {
      props: { embedded: true },
      global: { stubs: { ProfileDropdown: true }, config: { warnHandler: () => {} } },
    })

    // What the planner and the clerk prepare is folded away until it is asked for; everything else is in the rail.
    const PREPARED = 4
    expect(w.findAll('.eo-nav-item').length).toBe(SECTION_KEYS.length - PREPARED)
    expect(w.findAll('.eo-nav-group').map(g => g.text())).toEqual(['Your cases', 'Registers', 'Office'])
    await w.find('.eo-nav-more').trigger('click')

    // Opened, the rail is the contract: one entry per section key, no more, no fewer.
    const navItems = w.findAll('.eo-nav-item')
    expect(navItems.length).toBe(SECTION_KEYS.length)

    const labels = navItems.map(n => n.text())
    expect(labels.some(l => l.includes('Applications'))).toBe(true)
    expect(labels.some(l => l.includes('Determination'))).toBe(true)
    expect(labels.some(l => l.includes('Appeals'))).toBe(true)
    expect(labels.some(l => l.includes('Committee'))).toBe(true)

    // Your cases / Prepared for you / Registers / Office, so seventeen entries read as four lists, in the order the work goes.
    const groups = w.findAll('.eo-nav-group').map(g => g.text())
    expect(groups).toEqual(['Your cases', 'Prepared for you', 'Registers', 'Office'])
    expect(labels.some(l => l.includes('Public notice'))).toBe(true)

    // Embedded: the shell owns brand + profile, so this pane must not repeat them.
    expect(w.find('.eo-brand').exists()).toBe(false)
    expect(w.findComponent({ name: 'ProfileDropdown' }).exists()).toBe(false)
    // …but its own working controls stay.
    expect(w.find('.eo-nav').exists()).toBe(true)
    expect(w.find('.eo-section-title').exists()).toBe(true)
  }, 60_000)
})
