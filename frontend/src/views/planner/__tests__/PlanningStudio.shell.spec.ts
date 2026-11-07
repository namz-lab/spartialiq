// @vitest-environment happy-dom
// Smoke test for the Planning Studio workstation shell: the tool rail exposes
// every drafting tool, the active tool is marked for assistive tech as well as
// visually, the inspector tabs switch, and the status bar toggles bind to the
// precision-drafting state. The map engine is stubbed — this covers the shell,
// not the CAD kernel (that has its own specs under src/planning/cad/__tests__).
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia } from 'pinia'
import { describe, it, expect, vi } from 'vitest'

// The factory is hoisted, so the stub map has to be declared inside it.
vi.mock('maplibre-gl', () => {
  class FakeMap {
    handlers: Record<string, Function[]> = {}
    doubleClickZoom = { enable() {}, disable() {} }
    canvas = { style: { cursor: '' }, addEventListener() {} }
    on(evt: string, cb: Function) { (this.handlers[evt] ||= []).push(cb) }   // 'load' is never fired
    getCanvas() { return this.canvas }
    getSource() { return null }
    getLayer() { return null }
    getCenter() { return { lng: 29.82, lat: -19.48 } }
    project() { return { x: 0, y: 0 } }
    queryRenderedFeatures() { return [] }
    remove() {}
  }
  return { default: { Map: FakeMap } }
})
vi.mock('@/services/vectorTiles', () => ({ getTileLayerCatalog: vi.fn(async () => []) }))

import PlanningStudio from '@/views/planner/PlanningStudio.vue'

async function mountStudio() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/planner', name: 'planner', component: { template: '<div />' } },
      { path: '/planner/studio/:layer/:fid', name: 'planner-studio', component: PlanningStudio },
    ],
  })
  router.push('/planner/studio/parcels/42')
  await router.isReady()
  const wrapper = mount(PlanningStudio, { global: { plugins: [router, createPinia()] } })
  await flushPromises()
  return wrapper
}

describe('Planning Studio shell', () => {
  it('groups every drafting tool on the rail and marks the active one', async () => {
    const w = await mountStudio()
    expect(w.findAll('.ps-railgrp')).toHaveLength(6)
    expect(w.findAll('.ps-tool[aria-pressed]')).toHaveLength(18)   // all 18 canvas tools

    const line = w.findAll('.ps-tool[aria-pressed]').find(b => b.attributes('aria-label')?.startsWith('Line'))!
    await line.trigger('click')
    expect(line.attributes('aria-pressed')).toBe('true')
    expect(line.classes()).toContain('is-active')
  })

  it('switches inspector panels and toggles precision drafting from the status bar', async () => {
    const w = await mountStudio()
    const tabs = w.findAll('.ps-tab')
    expect(tabs).toHaveLength(3)
    await tabs[2].trigger('click')                                  // Layers
    expect(tabs[2].attributes('aria-selected')).toBe('true')

    const ortho = w.findAll('.ps-toggle').find(b => b.text() === 'ORTHO')!
    expect(ortho.attributes('aria-pressed')).toBe('false')
    await ortho.trigger('click')
    expect(ortho.attributes('aria-pressed')).toBe('true')
  })

  it('opens the keyboard shortcut reference', async () => {
    const w = await mountStudio()
    expect(w.find('.ps-keys').exists()).toBe(false)
    await w.find('button[aria-label="Keyboard shortcuts"]').trigger('click')
    expect(w.find('.ps-keys').exists()).toBe(true)
  })

  it('exposes CAD Interchange rather than silent DXF import', async () => {
    const w = await mountStudio()
    const cadx = w.findAll('button').find(b => b.text().includes('CAD Interchange'))
    expect(cadx).toBeTruthy()
    const exp = w.findAll('button').find(b => b.text().includes('Export DXF'))
    const imp = w.findAll('button').find(b => b.text().includes('Import DXF'))
    expect(exp).toBeFalsy()
    expect(imp).toBeFalsy()
    expect(w.find('input[type="file"][accept*=".dxf"]').exists()).toBe(false)
  })
})
