// @vitest-environment happy-dom
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

// The store must not reach the network during a guard test.
vi.mock('@/services/api', () => ({
  default: { get: vi.fn(), post: vi.fn(), put: vi.fn(), defaults: { headers: { common: {} } } },
}))
vi.mock('@/services/session', () => ({
  hasSessionHint: () => false,   // skip initializeAuth(); the user is set directly
  markSignedIn: vi.fn(),
  clearSession: vi.fn(),
}))

// Stub every view this file can navigate to — the allow cases and the redirect
// destinations of the deny cases. What is under test is the guard, not the
// screens, and resolving the real lazy chunks makes this spec unusable in CI:
// PlannerShell alone pulls its whole section tree and took over two minutes to
// transform. The navigation itself stays real (guards run, redirects resolve).
const stub = vi.hoisted(() => () => ({ default: { name: 'RouteStub', render: () => null } }))
vi.mock('@/views/planner/PlannerShell.vue', stub)
vi.mock('@/views/planner/PlanningStudio.vue', stub)
vi.mock('@/views/admin/GisSymbologyRegistryView.vue', stub)
vi.mock('@/views/admin/ContentManagementView.vue', stub)
vi.mock('@/views/AdminWorkspaceView.vue', stub)
vi.mock('@/views/AnalyticsView.vue', stub)
vi.mock('@/views/CitizenPortalView.vue', stub)
vi.mock('@/views/SurveyorView.vue', stub)
vi.mock('@/views/InspectorWorkspace.vue', stub)
vi.mock('@/views/GISOfficerPortalView.vue', stub)
vi.mock('@/views/LoginView.vue', stub)
vi.mock('@/views/view/AboutView.vue', stub)

import router from '@/router'
import { useAuthStore } from '@/stores/auth'

// route-roles.spec.ts asserts the allow-list attached to every path. This file
// asserts the guard actually CONSUMES it, by performing real navigations —
// router.resolve() only reads metadata and would pass even with the guard
// deleted.
//
// Navigation is slow here because it resolves real lazy components (the role
// workspaces pull in their whole section tree — PlannerShell alone is tens of
// seconds to transform on a cold cache), hence the raised timeout. Deny cases
// are fast; only the allow cases pay for the component.
const NAV_TIMEOUT = 120_000

// Park on a public route between navigations. The router is a module singleton
// shared by every test in this file, and pushing the path it is ALREADY on is a
// duplicate navigation that resolves without running guards — so a deny case
// would silently "pass" the navigation it is supposed to block.
//
// /about, not /login: /login now carries `hideForAuth`, so parking an
// authenticated user there bounces them to their role home — which for the
// owning role IS the path under test, making the allow cases vacuous.
const PARK = '/about'

async function goAs(role: string, path: string) {
  const auth = useAuthStore()
  auth.user = { id: '1', email: 'officer@vungu.test', role } as never
  await router.replace(PARK).catch(() => {})
  await router.push(path).catch(() => { /* redirected by the guard */ })
  return router.currentRoute.value.path
}

/** Anonymous visitor — no user on the store at all. */
async function goAnonymous(path: string) {
  await router.replace(PARK).catch(() => {})
  await router.push(path).catch(() => {})
  return router.currentRoute.value.path
}

describe('navigation guard consumes meta.roles', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('admits the owning role', async () => {
    expect(await goAs('surveyor', '/surveyor')).toBe('/surveyor')
  }, NAV_TIMEOUT)

  it('redirects a citizen off a staff workspace to their own home', async () => {
    expect(await goAs('registered', '/surveyor')).toBe('/citizen')
  }, NAV_TIMEOUT)
})

// Review P0: /planner and /planner/studio/* carried `requiresAuth` only, so any
// authenticated account rendered the planner shell and its applicant PII.
describe('planner workspace is role-gated', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('admits a planner', async () => {
    expect(await goAs('planner', '/planner')).toBe('/planner')
  }, NAV_TIMEOUT)

  it('denies a registered citizen', async () => {
    expect(await goAs('registered', '/planner')).toBe('/citizen')
  }, NAV_TIMEOUT)

  it('denies an anonymous visitor', async () => {
    expect(await goAnonymous('/planner')).toBe('/login')
  }, NAV_TIMEOUT)

  it('treats a viewer as a client: home to the citizen portal, not a staff screen', async () => {
    expect(await goAs('viewer', '/planner')).toBe('/citizen')
  }, NAV_TIMEOUT)

  it('keeps the IT admin out (separation of duties, ADMIN_BLOCKED)', async () => {
    // ROLE_HOME.admin is /admin/users, which itself redirects to /admin.
    expect(await goAs('admin', '/planner')).toBe('/admin')
  }, NAV_TIMEOUT)

  it('denies a citizen the Planning Studio deep link', async () => {
    expect(await goAs('registered', '/planner/studio/parcels/123')).toBe('/citizen')
  }, NAV_TIMEOUT)

  it('denies a non-planning staff role the Planning Studio deep link', async () => {
    expect(await goAs('building_inspector', '/planner/studio/parcels/123'))
      .toBe('/inspector-workspace')
  }, NAV_TIMEOUT)
})

// Clients (citizens) are never recognised as council staff.
describe('clients stay on client screens', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it.each(['registered', 'viewer', 'public'])('keeps a %s client off council analytics', async (role) => {
    expect(await goAs(role, '/analytics')).toBe('/citizen')
  }, NAV_TIMEOUT)

  it('sends a client from the counter payments console to their own payments tab', async () => {
    await goAs('viewer', '/payments')
    expect(router.currentRoute.value.fullPath).toBe('/citizen?section=payments')
  }, NAV_TIMEOUT)
})

// Review P0: the /admin prefix guard ran before meta.roles and bounced the GIS
// officer out of the symbology registry they are the author of.
describe('GIS symbology registry honours its own allow-list', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('admits the GIS officer', async () => {
    expect(await goAs('gis_officer', '/admin/gis-symbology')).toBe('/admin/gis-symbology')
  }, NAV_TIMEOUT)

  it('admits the admin', async () => {
    expect(await goAs('admin', '/admin/gis-symbology')).toBe('/admin/gis-symbology')
  }, NAV_TIMEOUT)

  it('denies a planner (planners consume symbology, they do not author it)', async () => {
    expect(await goAs('planner', '/admin/gis-symbology')).toBe('/planner')
  }, NAV_TIMEOUT)

  it('denies a registered citizen', async () => {
    expect(await goAs('registered', '/admin/gis-symbology')).toBe('/citizen')
  }, NAV_TIMEOUT)

  it('still blocks non-admins from /admin routes with no explicit allow-list', async () => {
    expect(await goAs('gis_officer', '/admin/content')).toBe('/gis-officer-portal')
  }, NAV_TIMEOUT)
})
