// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: { data: [] } }), post: vi.fn(), put: vi.fn(),
             defaults: { headers: { common: {} } } },
}))
vi.mock('@/services/session', () => ({
  hasSessionHint: () => false, markSignedIn: vi.fn(), clearSession: vi.fn(),
}))

import RoleWorkspaceShell from '@/components/shared/RoleWorkspaceShell.vue'
import { Briefcase } from 'lucide-vue-next'

describe('RoleWorkspaceShell', () => {
  it('shows the map pane first and mounts the console only on demand', async () => {
    setActivePinia(createPinia())
    const w = mount(RoleWorkspaceShell, {
      props: { title: 'EO Planner', subtitle: 'sub', icon: Briefcase,
               roleLabel: 'E.O. Planning', avatarKey: 'eo_planner_avatar' },
      slots: { map: '<div class="the-map">MAP</div>', console: '<div class="the-console">CONSOLE</div>' },
      global: { stubs: { ProfileDropdown: true, RouterLink: true } },
    })

    // Map visible, console not yet mounted — sections must not cost anything
    // until the officer asks for them.
    expect(w.find('.the-map').exists()).toBe(true)
    expect(w.find('.the-console').exists()).toBe(false)

    const tabs = w.findAll('[role="tab"]')
    expect(tabs).toHaveLength(2)
    await tabs[1].trigger('click')

    // Console now mounted AND the map is kept alive (v-show, not v-if), so
    // switching back does not rebuild the MapLibre instance.
    expect(w.find('.the-console').exists()).toBe(true)
    expect(w.find('.the-map').exists()).toBe(true)
    expect(tabs[1].attributes('aria-selected')).toBe('true')
  })
})
