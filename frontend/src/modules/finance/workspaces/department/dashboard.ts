import { ref } from 'vue'
import { dashboardsApi } from '../../api/dashboardsApi'
import { financeApi } from '../../api/financeApi'
import type { OverviewSeriesResult } from '../../models/types'
import { defineDashboard } from '../shared/useDashboard'

export const departmentDash = defineDashboard((year) => dashboardsApi.department(year), 'The department dashboard could not be read.')

/** Month by month budget and actual for the department's votes (the server applies the scope). */
export const monthly = ref<OverviewSeriesResult | null>(null)
export async function loadMonthly(yearId: string | undefined): Promise<void> {
  if (!yearId) { monthly.value = null; return }
  try { monthly.value = await financeApi.overviewSeries({ financial_year_id: yearId, periodicity: 'monthly' }) } catch { monthly.value = null }
}
