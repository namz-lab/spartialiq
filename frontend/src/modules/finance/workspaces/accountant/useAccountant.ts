/**
 * State the Accounting screens share: the dashboard read for the selected financial year, and the
 * cash desk (cash points, bank accounts, till positions) the banking and setup pages draw on.
 */
import { reactive } from 'vue'
import { accountingApi, type AccountingDashboard } from '../../api/accountingApi'
import { cashApi } from '../../api/cashApi'
import { messageOf, useFinanceStore } from '../../stores/finance'
import type { CashDesk } from '../../models/cashTypes'
import { resetLedgerLists } from './kit/useLedgerLists'

const state = reactive({
  dashboard: null as AccountingDashboard | null,
  error: null as string | null,
  loading: false,
  desk: null as CashDesk | null,
  deskError: null as string | null,
})

let dashboardSeq = 0

/**
 * Only the latest call writes the shared state, so a slow answer for a year left behind can never
 * overwrite the year chosen after it. A load for a different year clears the old figures first, so
 * they never show under the new year's name. `null` (the server picks the year) keeps what is there.
 */
async function loadDashboard(yearId?: string | null): Promise<void> {
  const mine = ++dashboardSeq
  state.loading = true
  state.error = null
  if (state.dashboard) {
    // Named year: clear when it differs. No year named (the server picks one): keep the figures unless the
    // banner has selected a different year.
    const held = state.dashboard.year.id
    const wanted = yearId ?? useFinanceStore().selectedYearId
    if (wanted && held !== wanted) state.dashboard = null
  }
  try {
    const res = await accountingApi.dashboard(yearId)
    if (mine !== dashboardSeq) return
    state.dashboard = res
  } catch (err) {
    if (mine !== dashboardSeq) return
    state.error = messageOf(err, 'The accounting dashboard could not be read.')
  } finally {
    if (mine === dashboardSeq) state.loading = false
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
  dashboardSeq++ // a load still in flight belongs to the council that has just left
  state.loading = false
  state.error = null
  state.dashboard = null
  state.desk = null
  resetLedgerLists()
}

export function useAccountant() {
  return { state, loadDashboard, loadDesk }
}
