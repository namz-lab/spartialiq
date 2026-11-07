// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia'
import { describe, it, expect, beforeEach } from 'vitest'
import type { RouteRecordNormalized } from 'vue-router'
import router, { roleHome } from '@/router'
import type { Role } from '@/services/types'

// M0.2 replaced ten hand-written path comparisons in the navigation guard with
// declarative `meta.roles`. It was meant to be a pure refactor, so the expected
// values below are the allow-lists copied from the PRE-refactor guard. If a
// later edit widens or narrows access, these fail — which is the point:
// authorisation should never drift silently.
//
// Routes are resolved rather than navigated, matching planner-routes.spec.ts:
// navigating would trip the auth guard and redirect to /login.
//
// resolve() — not getRoutes() — because a record's own `.meta` is NOT merged
// with its parent's, while `resolve().meta` is. The guard reads `to.meta`,
// which is the merged form, so resolving asserts what actually gates the
// navigation. This distinction is what lets one `roles` on a parent
// cover all of its child routes.

const rec = (path: string): RouteRecordNormalized | undefined =>
  router.getRoutes().find(r => r.path === path)

const rolesFor = (path: string) => router.resolve(path).meta?.roles as readonly Role[] | undefined

describe('route role allow-lists (pre-M0.2 behaviour preserved)', () => {
  beforeEach(() => setActivePinia(createPinia()))

  const CASES: Array<[string, Role[]]> = [
    // was: !['eo','admin','planner','planning_clerk'].includes(role)
    ['/eo-planner-portal',     ['eo', 'admin', 'planner', 'planning_clerk']],
    // was: !['surveyor','admin'].includes(role)
    ['/surveyor',              ['surveyor', 'admin']],
    // The council's survey job queue (the native job module).
    ['/surveyor/jobs',         ['surveyor', 'admin']],
    // was: !['gis_officer','admin','planner'].includes(role)
    ['/gis-officer-portal',    ['gis_officer', 'admin', 'planner']],
    // was: !['env_officer','admin','planner'].includes(role)
    ['/env-officer-workspace', ['env_officer', 'admin', 'planner']],
    // was: !['planning_clerk','admin','planner'].includes(role)
    ['/planning-clerk-portal', ['planning_clerk', 'admin', 'planner']],
    // was: !['building_inspector','admin','planner'].includes(role)
    ['/inspector-workspace',   ['building_inspector', 'admin', 'planner']],
  ]

  it.each(CASES)('%s allows exactly the previous role set', (path, expected) => {
    const actual = rolesFor(path)
    expect(actual, `${path} has no meta.roles`).toBeTruthy()
    expect([...actual!].sort()).toEqual([...expected].sort())
  })

  it('gates the PII-bearing surfaces to council staff only', () => {
    // was the shared ['planner','planning_clerk','eo','gis_officer',
    // 'env_officer','building_inspector','surveyor','admin'] list
    const staff: Role[] = [
      'planner', 'planning_clerk', 'eo', 'gis_officer',
      'env_officer', 'building_inspector', 'surveyor', 'admin',
    ]
    // Concrete path for the optional param — resolve() needs a real URL.
    for (const path of ['/property/1234', '/report-builder', '/gis-map']) {
      expect([...(rolesFor(path) ?? [])].sort(), path).toEqual([...staff].sort())
    }
  })

  it('closes the routes that previously had no role guard at all', () => {
    // Audit F3: reachable by any authenticated user, including a citizen.
    // /statutory/planner is now a redirect into the planner console, which is
    // guarded to planners, so no page renders there without a role check.
    expect(router.resolve('/statutory/planner').matched[0]?.redirect).toBeTruthy()
    expect(rolesFor('/planner')).toEqual(['planner'])
    expect(rolesFor('/gis-map')).toBeTruthy()
  })

  it('lets the GIS Officer reach the symbology registry, and keeps planners out', () => {
    // The GIS Officer is the cartographic author — they restyle in QGIS, then
    // approve and publish the version every client renders. Guarding this route
    // with `requiresAdmin` (as it was first written) locks the owner out of their
    // own tool, because that flag admits only `admin`.
    const m = router.resolve('/admin/gis-symbology').meta
    expect(m?.requiresAdmin, 'requiresAdmin would exclude gis_officer').toBeFalsy()
    expect(m?.requiresAuth).toBe(true)

    // Must mirror STYLE_ADMINS in backend src/routes/gisStyles.js exactly, or the
    // route and the API disagree about who may publish.
    expect([...(rolesFor('/admin/gis-symbology') ?? [])].sort())
      .toEqual(['admin', 'gis_officer'])

    // Planners consume symbology; they do not author it.
    expect(rolesFor('/admin/gis-symbology')).not.toContain('planner')
  })

  it('keeps /qgis-map public — published basemap layers, no permits or PII', () => {
    const m = router.resolve('/qgis-map').meta
    expect(m?.requiresAuth).toBeFalsy()
    expect(m?.roles).toBeUndefined()
    expect(rec('/qgis-map')).toBeTruthy()
  })

  it('never lists a role the backend cannot issue', () => {
    // The DB CHECK constraint (migration 061, widened by 132 for the GIS
    // Branch) is the authority; a role outside it makes a guard that can
    // never pass.
    const ISSUABLE: Role[] = [
      'admin', 'planner', 'eo', 'env_officer', 'building_inspector',
      'planning_clerk', 'surveyor', 'gis_officer', 'viewer', 'registered', 'public',
      'gis_head', 'gis_data', 'gis_dev', 'gis_analyst', 'gis_tech', 'gis_clerk',
      'dept_editor', 'dept_viewer',
    ]
    for (const r of router.getRoutes()) {
      for (const role of (r.meta?.roles ?? []) as Role[]) {
        expect(ISSUABLE, `${r.path} lists unissuable role "${role}"`).toContain(role)
      }
    }
  })
})

describe('roleHome', () => {
  it('routes every issuable role to a real landing path', () => {
    const expected: Record<Role, string> = {
      admin:              '/admin/users',
      planner:            '/planner',
      eo:                 '/eo-planner-portal',
      env_officer:        '/env-officer-workspace',
      building_inspector: '/inspector-workspace',
      planning_clerk:     '/planning-clerk-portal',
      surveyor:           '/surveyor',
      gis_officer:        '/gis-officer-portal',
      viewer:             '/citizen',
      registered:         '/citizen',
      public:             '/citizen',
    }
    for (const [role, path] of Object.entries(expected)) {
      expect(roleHome(role), role).toBe(path)
    }
  })

  it('falls back to the citizen portal for an unknown role', () => {
    expect(roleHome('')).toBe('/citizen')
    expect(roleHome('user')).toBe('/citizen')   // the removed phantom role
  })
})
