/**
 * State the Accounting screens share: the dashboard read for the selected financial year, and the
 * cash desk (cash points, bank accounts, till positions) the banking and setup pages draw on.
 */
import { reactive } from 'vue'
import { accountingApi, type AccountingDashboard } from '../../api/accountingApi'
import { cashApi } from '../../api/cashApi'
import { messageOf } from '../../stores/finance'
import type { CashDesk } from '../../models/cashTypes'

const state = reactive({
  dashboard: null as AccountingDashboard | null,
  error: null as string | null,
  loading: false,
  desk: null as CashDesk | null,
  deskError: null as string | null,
})

async function loadDashboard(yearId?: string | null): Promise<void> {
  state.loading = true
  state.error = null
  try {
    state.dashboard = await accountingApi.dashboard(yearId)
  } catch (err) {
    state.error = messageOf(err, 'The accounting dashboard could not be read.')
  } finally {
    state.loading = false
  }
}

async function loadDesk(): Promise<void> {
  state.deskError = null
  try {
    state.desk = await cashApi.desk()
  } catch (err) {
    state.deskError = messageOf(err, 'The cash office could not be read.')
  }
}

export function resetAccountant(): void {
  state.dashboard = null
  state.desk = null
}

export function useAccountant() {
  return { state, loadDashboard, loadDesk }
}
