// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), defaults: { headers: { common: {} } } },
}))
vi.mock('@/services/session', () => ({
  hasSessionHint: () => false, markSignedIn: vi.fn(), clearSession: vi.fn(),
}))

import router from '@/router'

// Audit F17: three role workspaces had their sections stranded because each
// route served only the map view. These assert the route now resolves to the
// composed workspace that hosts BOTH panes.
const CASES: Array<[string, string]> = [
  ['/eo-planner-portal',     'EOPlannerWorkspace'],
  ['/env-officer-workspace', 'EnvOfficerWorkspace'],
  ['/inspector-workspace',   'InspectorWorkspace'],
]

describe('F17 — role workspaces serve map + console', () => {
  beforeEach(() => setActivePinia(createPinia()))

  // Generous: resolving these pulls in the real map views (maplibre, jsPDF).
  it.each(CASES)('%s resolves to %s', async (path, expected) => {
    const rec = router.resolve(path).matched[0]
    const loader = (rec.components?.default ?? (rec as any).component) as () => Promise<any>
    expect(typeof loader).toBe('function')
    const mod = await loader()
    expect(mod.default).toBeTruthy()
    expect(mod.default.__name ?? mod.default.name).toBe(expected)
  }, 60_000)
})
