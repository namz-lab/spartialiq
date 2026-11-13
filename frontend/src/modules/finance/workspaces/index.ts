/**
 * The finance workspaces in this build.
 *
 * Each workspace registers itself (`registerWorkspace`) from its own `routes.ts`; importing it here
 * is what puts it in the build. A workspace not imported here does not exist as far as routing is
 * concerned, and anyone whose home it would be keeps using the previous console (spec §13.7).
 *
 * Phase order (spec §11): cashier, accountant, budget, manager; review; then the other eight.
 */
import type { RouteRecordRaw } from 'vue-router'
import { FINANCE_ROLES } from '@/services/types'
import { builtWorkspaces, registrationOf } from '../shell/workspaces'
import { guardWorkspace } from '../shell/workspaceGuard'
import './cashier/routes'
import './accountant/routes'
import './budget/routes'
import './manager/routes'
import './officer/routes'
import './audit/routes'
import './revenue/routes'
import './executive/routes'
import './publisher/routes'
import './department/routes'

/**
 * Every built workspace's routes, each marked with its workspace and guarded.
 *
 * The role list is the same as the console's: it only keeps non-finance accounts out before the
 * finance identity is read. Which workspace a finance account may open is the guard's job, on the
 * server's answer.
 */
export function financeWorkspaceRoutes(): RouteRecordRaw[] {
  return builtWorkspaces().flatMap((key) => (registrationOf(key)?.routes ?? []).map((route) => ({
    ...route,
    beforeEnter: guardWorkspace,
    meta: {
      ...route.meta,
      financeWorkspace: key,
      requiresAuth: true,
      roles: [...FINANCE_ROLES, 'admin' as const],
    },
  }) as RouteRecordRaw))
}
