/**
 * What a cross-link asks for, independent of which workspace serves it.
 *
 * The old console addressed everything as `?section=<key>`. A workspace architecture cannot: the
 * vouchers are a screen in Accounting and also reachable from Finance Management, and which one a
 * link should open depends on who follows it. So a link names a TARGET, and `useFinanceNav`
 * resolves it against the workspaces the person holds.
 *
 * Section-level targets keep the old section keys so that queues, legacy links and the console
 * share one vocabulary during the migration. Where a section had tabs that are separate screens in
 * the workspaces, the tabs are targets of their own.
 */
import type { FinanceSectionKey } from '../stores/rolePreset'

/** Every target, as a runtime list, so completeness can be checked (see workspaceCoverage.spec). */
export const FINANCE_TARGETS = [
  'overview', 'map', 'years', 'classifications',
  'budget', 'revisions', 'projects',
  'ledger', 'statements', 'rates', 'cash',
  'transactions', 'imports', 'reports', 'documents',
  'publication', 'audit', 'permissions', 'access', 'settings',
  'cash.counter', 'cash.sessions', 'cash.banking', 'cash.setup',
  'ledger.periods', 'ledger.chart', 'ledger.vouchers',
  'statements.trial-balance', 'statements.position', 'statements.performance', 'statements.ageing',
  'classifications.departments', 'classifications.programmes',
  'classifications.activities', 'classifications.accounts',
] as const

export type FinanceTarget = typeof FINANCE_TARGETS[number]

// Compile-time check: every old section key is also a target. A section added to the console
// without a target here fails the type check rather than becoming unreachable.
type SectionsAreTargets = FinanceSectionKey extends FinanceTarget ? true : never
export const SECTIONS_ARE_TARGETS: SectionsAreTargets = true

/** The target an old `?section=` link stands for: the section itself, or its first tab. */
export const SECTION_TARGETS: Record<FinanceSectionKey, FinanceTarget> = {
  overview: 'overview',
  map: 'map',
  years: 'years',
  classifications: 'classifications.departments',
  budget: 'budget',
  revisions: 'revisions',
  projects: 'projects',
  ledger: 'ledger.vouchers',
  statements: 'statements.trial-balance',
  rates: 'rates',
  cash: 'cash.counter',
  transactions: 'transactions',
  imports: 'imports',
  reports: 'reports',
  documents: 'documents',
  publication: 'publication',
  audit: 'audit',
  permissions: 'permissions',
  access: 'access',
  settings: 'settings',
}
