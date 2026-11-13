/**
 * Routing into the finance workspaces.
 *
 * Three entry points, all of which route on the answer the SERVER gave in `GET /api/finance/me`
 * (`workspaces`, `home_workspace`) and none of which computes access itself:
 *
 *   financeEntry           `/finance` and old `/finance?section=` links
 *   guardWorkspace         `/finance/<workspace>/…` for a workspace that has been built
 *   guardUnknownWorkspace  any other `/finance/…` address
 *
 * THIS IS NOT THE SECURITY BOUNDARY. A person who reached a screen anyway would still be refused
 * by `financePermissions.js` on every request, and the refusal would still be audited. The guard
 * keeps people out of pages that would only refuse them, and tells them why.
 *
 * THE MIGRATION IS REVERSIBLE (spec §13.7). The previous console stays mounted at
 * `/finance/console`. Anyone whose workspace is not built yet goes there, and setting
 * `VITE_FINANCE_WORKSPACES=off` sends every finance address there.
 */
import type { LocationQuery, RouteLocationNormalized, RouteLocationRaw } from 'vue-router'
import { useFinanceStore } from '../stores/finance'
import type { FinanceIdentity } from '../models/types'
import { builtWorkspaces, isWorkspaceKey, WORKSPACE_META, type WorkspaceKey } from './workspaces'
import { SECTION_TARGETS } from './targets'
import { resolveTarget } from './useFinanceNav'
import type { FinanceSectionKey } from '../stores/rolePreset'

export const CONSOLE_PATH = '/finance/console'
export const NO_WORKSPACE_PATH = '/finance/no-workspace'

/** Why a person was redirected. The frame turns each into one sentence. */
export type FinanceNotice = 'not-yours' | 'not-built' | 'unavailable'

/** Filters an old section link carried that the screen replacing it understands. */
const CARRIED_QUERY = ['status', 'state', 'view', 'ward'] as const

let enabledOverride: boolean | null = null

export function workspacesEnabled(): boolean {
  if (enabledOverride !== null) return enabledOverride
  return import.meta.env.VITE_FINANCE_WORKSPACES !== 'off'
}

/** Tests only. */
export function __setWorkspacesEnabled(value: boolean | null): void {
  enabledOverride = value
}

const toConsole = (query: LocationQuery | Record<string, string>): RouteLocationRaw =>
  ({ path: CONSOLE_PATH, query: { ...query } })

/** The person's workspaces as the server reported them, or null when it reported none at all. */
function heldBy(identity: FinanceIdentity): WorkspaceKey[] | null {
  return Array.isArray(identity.workspaces) ? identity.workspaces.filter(isWorkspaceKey) : null
}

/**
 * Where this person belongs: their home workspace if it is built, the console while the migration
 * lasts if it is not, or the explanation if they hold no workspace at all.
 */
function homeLocation(identity: FinanceIdentity, notice?: FinanceNotice): RouteLocationRaw {
  const held = heldBy(identity) ?? []
  const home = identity.home_workspace && isWorkspaceKey(identity.home_workspace) ? identity.home_workspace : null
  const query = notice ? { notice } : undefined
  if (home && builtWorkspaces().includes(home)) {
    return query ? { path: WORKSPACE_META[home].path, query } : { path: WORKSPACE_META[home].path }
  }
  if (held.length) return toConsole(query ?? {})
  return { path: NO_WORKSPACE_PATH }
}

async function readIdentity(): Promise<FinanceIdentity | null> {
  return useFinanceStore().loadIdentity()
}

function isSectionKey(value: unknown): value is FinanceSectionKey {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(SECTION_TARGETS, value)
}

/** `/finance`, with or without an old `?section=`. */
export async function financeEntry(to: RouteLocationNormalized): Promise<RouteLocationRaw> {
  if (!workspacesEnabled()) return toConsole(to.query)
  const identity = await readIdentity()
  // The console renders its own identity error with a Retry; routing anywhere else on a failed
  // read would only produce a second, less helpful, error.
  if (!identity) return toConsole(to.query)
  const held = heldBy(identity)
  if (held === null) return toConsole(to.query)

  const section = to.query.section
  if (section === undefined) return homeLocation(identity)

  const target = isSectionKey(section) ? SECTION_TARGETS[section] : null
  const resolved = target
    ? resolveTarget(target, { current: null, home: identity.home_workspace ?? null, open: held })
    : null
  if (resolved?.kind === 'route') {
    const carried: Record<string, string> = {}
    for (const key of CARRIED_QUERY) {
      const value = to.query[key]
      if (typeof value === 'string') carried[key] = value
    }
    return { name: resolved.name, query: carried }
  }
  // Someone with a workspace still to be built keeps exactly what the link gave them before.
  const built = builtWorkspaces()
  if (held.some((k) => !built.includes(k))) return toConsole(to.query)
  return homeLocation(identity, 'unavailable')
}

/** `/finance/<workspace>/…` for a workspace in this build. */
export async function guardWorkspace(to: RouteLocationNormalized): Promise<true | RouteLocationRaw> {
  if (!workspacesEnabled()) return toConsole(to.query)
  const identity = await readIdentity()
  // The frame shows the error and Retry. Redirecting would send them to /finance, which would
  // read the same failing identity and send them back.
  if (!identity) return true
  const held = heldBy(identity)
  if (held === null) return toConsole(to.query)
  const key = to.meta.financeWorkspace
  if (isWorkspaceKey(key) && held.includes(key) && builtWorkspaces().includes(key)) return true
  return homeLocation(identity, 'not-yours')
}

/** Any other `/finance/…` address: a workspace not built yet, or not a workspace at all. */
export async function guardUnknownWorkspace(to: RouteLocationNormalized): Promise<RouteLocationRaw> {
  if (!workspacesEnabled()) return toConsole(to.query)
  const identity = await readIdentity()
  if (!identity) return toConsole(to.query)
  const segment = to.path.split('/')[2]
  const held = heldBy(identity) ?? []
  const notice: FinanceNotice = isWorkspaceKey(segment) && held.includes(segment) ? 'not-built' : 'not-yours'
  return homeLocation(identity, notice)
}
