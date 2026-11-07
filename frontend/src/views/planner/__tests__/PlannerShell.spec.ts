// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { describe, it, expect, beforeEach, vi } from 'vitest'

vi.mock('@/views/planner/VunguPlannerView.vue', () => ({
  default: { name: 'VunguPlannerView', template: '<div class="map-pane-stub" />',
             methods: { resizeMap() {}, flyTo() {} } },
}))
vi.mock('@/views/PlannerWorkspaceView.vue', () => ({
  default: { name: 'PlannerWorkspaceView', template: '<div class="console-pane-stub" />' },
}))

import PlannerShell from '@/views/planner/PlannerShell.vue'

function makeRouter(initial: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/planner', name: 'planner', component: PlannerShell }],
  })
  router.push(initial)
  return router
}

const stubs = { ProfileDropdown: true }

describe('PlannerShell', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('opens the map pane by default and lazy-mounts the console on switch', async () => {
    const router = makeRouter('/planner')
    await router.isReady()
    const wrapper = mount(PlannerShell, { global: { plugins: [router], stubs } })
    await flushPromises()
    expect(wrapper.find('.map-pane-stub').exists()).toBe(true)
    expect(wrapper.find('.console-pane-stub').exists()).toBe(false)
    const tabs = wrapper.findAll('.ps-switch button')
    expect(tabs[0].attributes('aria-selected')).toBe('true')

    await tabs[1].trigger('click')
    await flushPromises()
    expect(wrapper.find('.console-pane-stub').exists()).toBe(true)
  })

  it('opens the console pane when ?pane=console is present', async () => {
    const router = makeRouter('/planner?pane=console&section=workflow')
    await router.isReady()
    const wrapper = mount(PlannerShell, { global: { plugins: [router], stubs } })
    await flushPromises()
    expect(wrapper.find('.console-pane-stub').exists()).toBe(true)
  })
})
