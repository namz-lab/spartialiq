/**
 * State the Cash Office screens share: the desk (this cashier's till, cash points, income codes,
 * bank accounts) and the service queue.
 *
 * Module-level, so moving between the sidebar's pages does not re-read the desk each time; every
 * page that changes something calls the matching `load*` afterwards. Sign-out clears it through
 * `resetCashier()`, as the finance store is cleared.
 */
import { computed, reactive } from 'vue'
import { cashApi } from '../../api/cashApi'
import { messageOf } from '../../stores/finance'
import type { CashDesk, QueueTicket } from '../../models/cashTypes'

const state = reactive({
  desk: null as CashDesk | null,
  deskError: null as string | null,
  loadingDesk: false,
  queue: [] as QueueTicket[],
  queueError: null as string | null,
})

async function loadDesk(): Promise<CashDesk | null> {
  state.loadingDesk = true
  state.deskError = null
  try {
    state.desk = await cashApi.desk()
  } catch (err) {
    state.deskError = messageOf(err, 'The cash office could not be read.')
  } finally {
    state.loadingDesk = false
  }
  return state.desk
}

async function loadQueue(): Promise<void> {
  state.queueError = null
  try {
    state.queue = (await cashApi.queue()).tickets
  } catch (err) {
    state.queueError = messageOf(err, 'The queue could not be read.')
  }
}

export function resetCashier(): void {
  state.desk = null
  state.deskError = null
  state.queue = []
}

/** The till as one word for the screens: what the cashier can do right now. */
export type TillState = 'none' | 'open' | 'suspended' | 'abandoned' | 'stale' | 'counted' | 'verified'

export function useCashier() {
  const session = computed(() => state.desk?.my_session ?? null)
  const till = computed<TillState>(() => {
    const s = session.value
    if (!s) return 'none'
    if (['open', 'suspended', 'abandoned'].includes(s.status) && state.desk && s.business_date < state.desk.today) return 'stale'
    if (s.status === 'closed') return 'counted'
    return s.status as TillState
  })
  /** A payment can be taken only in the cashier's own open session of today. */
  const canTakePayment = computed(() => till.value === 'open')
  return { state, session, till, canTakePayment, loadDesk, loadQueue }
}

export { greeting, initials } from '../shared/usePortal'

/** "Nov 2026" from an ISO date, as a bill's period is printed. */
export function periodLabel(from: string | null | undefined): string {
  if (!from) return '—'
  const d = new Date(`${from.slice(0, 10)}T00:00:00`)
  return Number.isNaN(d.getTime()) ? from : d.toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })
}

export function timeOf(iso: string | null | undefined): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
