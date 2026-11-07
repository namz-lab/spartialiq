// @vitest-environment happy-dom
//
// The shell hosts three role workspaces. The inspector drives its pane from the
// URL (controlled); the EO planner and the environmental health officer let the
// shell hold that state (uncontrolled). Both must keep working, because one
// component now serves both — this is the contract that stops a change made for
// the inspector from quietly breaking the other two roles' pane switch.
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import { Map as MapIcon } from 'lucide-vue-next'
import RoleWorkspaceShell from '../RoleWorkspaceShell.vue'

vi.mock('vue-router', () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }))
vi.mock('@/stores/auth', () => ({ useAuthStore: () => ({ logout: vi.fn(), user: null }) }))

function shell(props: Record<string, unknown> = {}) {
  return mount(RoleWorkspaceShell, {
    props: {
      title: 'Building Inspector', subtitle: 'Vungu RDC', icon: MapIcon,
      roleLabel: 'Building Inspector', avatarKey: 'building_inspector_avatar',
      ...props,
    },
    slots: { map: '<p class="pane-map">map</p>', console: '<p class="pane-console">console</p>' },
    global: { stubs: { ProfileDropdown: true } },
  })
}

const switchButtons = (w: ReturnType<typeof shell>) => w.findAll('.rw-switch button')
const selected = (w: ReturnType<typeof shell>) =>
  switchButtons(w).find(b => b.attributes('aria-selected') === 'true')?.text()

describe('RoleWorkspaceShell — uncontrolled (EO planner, environmental health officer)', () => {
  it('opens on the map and switches to the console on its own', async () => {
    const w = shell()
    expect(selected(w)).toContain('Map')

    await switchButtons(w)[1].trigger('click')
    expect(selected(w)).toContain('Console')
    // The console pane is mounted lazily, and stays mounted once opened.
    expect(w.find('.pane-console').exists()).toBe(true)
    w.unmount()
  })

  it('honours initialPane for a workspace that starts in its console', async () => {
    const w = shell({ initialPane: 'console' })
    expect(selected(w)).toContain('Console')
    expect(w.find('.pane-console').exists()).toBe(true)
    w.unmount()
  })
})

describe('RoleWorkspaceShell — controlled (building inspector, pane from the URL)', () => {
  it('shows the pane the host passes, and asks the host to change it rather than changing itself', async () => {
    const w = shell({ pane: 'map' })
    expect(selected(w)).toContain('Map')

    await switchButtons(w)[1].trigger('click')

    // The host owns it: the shell reports the intent and waits to be told.
    expect(w.emitted('update:pane')?.[0]).toEqual(['console'])
    expect(selected(w)).toContain('Map')

    // The host applies it (in the app, by navigating), and the shell follows.
    await w.setProps({ pane: 'console' })
    expect(selected(w)).toContain('Console')
    w.unmount()
  })

  it('mounts the console when the host opens that pane from a link, not only from a click', async () => {
    const w = shell({ pane: 'map' })
    expect(w.find('.pane-console').exists()).toBe(false)

    await w.setProps({ pane: 'console' })
    await nextTick()

    expect(w.find('.pane-console').exists()).toBe(true)
    w.unmount()
  })
})
