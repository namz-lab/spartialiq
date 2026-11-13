/**
 * The twelve finance workspaces, and which of them have been built.
 *
 * WHO MAY OPEN A WORKSPACE IS NOT DECIDED HERE. The server's catalogue
 * (backend `src/config/financeWorkspaces.js`) sends each person's `workspaces` and
 * `home_workspace` on `GET /api/finance/me`; the browser only reads them. This file holds the
 * presentation half: each workspace's application name and address, and the registry that each
 * built workspace adds itself to.
 *
 * The registry exists because the migration is incremental and reversible (spec §13.7). A
 * workspace the server admits someone to but which has not been built yet is simply not in the
 * registry, and that person is sent to the previous console instead.
 */
import type { RouteRecordRaw } from 'vue-router'
import type { FinanceTarget } from './targets'

/** Catalogue order, the same as the server's. The switcher lists workspaces in this order. */
export const WORKSPACE_KEYS = [
  'manager', 'officer', 'accountant', 'accounting', 'budget', 'department',
  'committee', 'cashier', 'revenue', 'publisher', 'audit', 'administration',
] as const

export type WorkspaceKey = typeof WORKSPACE_KEYS[number]

export const WORKSPACE_META: Record<WorkspaceKey, { name: string; path: string }> = {
  manager: { name: 'Finance Management', path: '/finance/manager' },
  officer: { name: 'Finance Operations', path: '/finance/officer' },
  accountant: { name: 'Accounting', path: '/finance/accountant' },
  accounting: { name: 'Executive Finance', path: '/finance/accounting' },
  budget: { name: 'Budget Management', path: '/finance/budget' },
  department: { name: 'Department Finance', path: '/finance/department' },
  committee: { name: 'Committee Decisions', path: '/finance/committee' },
  cashier: { name: 'Cash Office', path: '/finance/cashier' },
  revenue: { name: 'Revenue and Rates', path: '/finance/revenue' },
  publisher: { name: 'Publication', path: '/finance/publisher' },
  audit: { name: 'Internal Audit', path: '/finance/audit' },
  administration: { name: 'Finance Access Administration', path: '/finance/administration' },
}

export function isWorkspaceKey(value: unknown): value is WorkspaceKey {
  return typeof value === 'string' && (WORKSPACE_KEYS as readonly string[]).includes(value)
}

export interface WorkspaceRegistration {
  key: WorkspaceKey
  /** The workspace's route record(s), mounted under /finance by the router. */
  routes: RouteRecordRaw[]
  /** Which cross-link targets this workspace's screens serve, by child route name. */
  serves: Partial<Record<FinanceTarget, string>>
  /** The route name of the workspace's dashboard. */
  home?: string
}

const registry = new Map<WorkspaceKey, WorkspaceRegistration>()

export function registerWorkspace(reg: WorkspaceRegistration): void {
  registry.set(reg.key, reg)
}

export function registrationOf(key: WorkspaceKey): WorkspaceRegistration | undefined {
  return registry.get(key)
}

/** The workspaces that exist in this build, in catalogue order. */
export function builtWorkspaces(): WorkspaceKey[] {
  return WORKSPACE_KEYS.filter((k) => registry.has(k))
}

/** Tests only. */
export function __resetRegistry(): void {
  registry.clear()
}
