/** State the Budget Management screens share: the dashboard read for the selected year. */
import { reactive } from 'vue'
import { budgetingApi, type BudgetingDashboard } from '../../api/budgetingApi'
import { messageOf } from '../../stores/finance'
import type { Currency } from '../../models/types'

const state = reactive({
  dashboard: null as BudgetingDashboard | null,
  error: null as string | null,
  loading: false,
})

async function loadDashboard(yearId?: string | null): Promise<void> {
  state.loading = true
  state.error = null
  try {
    state.dashboard = await budgetingApi.dashboard(yearId)
  } catch (err) {
    state.error = messageOf(err, 'The budget dashboard could not be read.')
  } finally {
    state.loading = false
  }
}

export function resetBudget(): void {
  state.dashboard = null
}

/** Rows of one per-currency figure, the year's reporting currency first. */
export function reportingFirst<T extends { currency: Currency }>(rows: T[] | undefined, reporting: Currency): T[] {
  return [...(rows ?? [])].sort((a, b) => Number(b.currency === reporting) - Number(a.currency === reporting) || a.currency.localeCompare(b.currency))
}

export function useBudget() {
  return { state, loadDashboard }
}
