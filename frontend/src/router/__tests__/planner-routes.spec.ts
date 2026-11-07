// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { describe, it, expect, beforeEach } from 'vitest'
import type { RouteRecordNormalized } from 'vue-router'
import router from '@/router'

// These assertions read the REAL route records from src/router/index.ts.
// Inspecting records (not navigating) avoids the auth guards that would
// otherwise redirect an unauthenticated push() to /login.
describe('planner routes (real router config)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('serves a component at /planner (the shell)', () => {
    const rec = router.getRoutes().find((r: RouteRecordNormalized) => r.path === '/planner')
    expect(rec).toBeTruthy()
    // A lazy component is registered (either as `component` or components.default).
    expect(rec!.components?.default ?? (rec as any).component).toBeTruthy()
  })

  it('redirects /planner-workspace into the console pane', () => {
    const rec = router.getRoutes().find((r: RouteRecordNormalized) => r.path === '/planner-workspace')
    expect(rec).toBeTruthy()
    expect(typeof rec!.redirect).toBe('function')
    expect((rec!.redirect as () => unknown)()).toEqual({ path: '/planner', query: { pane: 'console' } })
  })

  it('redirects /planner/statutory into the workflow section', () => {
    const rec = router.getRoutes().find((r: RouteRecordNormalized) => r.path === '/planner/statutory')
    expect(rec).toBeTruthy()
    expect(typeof rec!.redirect).toBe('function')
    expect((rec!.redirect as () => unknown)()).toEqual({ path: '/planner', query: { pane: 'console', section: 'workflow' } })
  })
})
