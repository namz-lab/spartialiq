/**
 * State the Budget Management screens share: the dashboard read for the selected year.
 *
 * Defined once at module level (`defineDashboard`), so the layout loads it on boot and on each tick,
 * the dashboard and the programme pages read it, and a section page that changes something asks for
 * it again through `portalRefresh`.
 */
import { budgetingApi, type BudgetingDashboard } from '../../api/budgetingApi'
import { defineDashboard } from '../shared/useDashboard'
import type { Currency } from '../../models/types'

export const budgetDash = defineDashboard<BudgetingDashboard>(
  (yearId) => budgetingApi.dashboard(yearId),
  'The budget dashboard could not be read.',
)

export function resetBudget(): void {
  budgetDash.reset()
}

/** Rows of one per-currency figure, the year's reporting currency first. */
export function reportingFirst<T extends { currency: Currency }>(rows: T[] | undefined, reporting: Currency): T[] {
  return [...(rows ?? [])].sort((a, b) => Number(b.currency === reporting) - Number(a.currency === reporting) || a.currency.localeCompare(b.currency))
}

export function useBudget() {
  return { state: budgetDash.state, loadDashboard: budgetDash.load }
}
