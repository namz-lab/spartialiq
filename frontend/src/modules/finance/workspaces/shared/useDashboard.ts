/**
 * One workspace dashboard's state: the server's read, its error and whether it is loading.
 *
 * Each workspace defines one at module level (`defineDashboard`) so its layout, its dashboard and
 * its section pages share the same read; the layout loads it on boot and on each tick, and a page
 * that changes something asks for it again (`portalRefresh`, provided by PortalLayout).
 */
import { inject, reactive } from 'vue'
import { messageOf } from '../../stores/finance'

export interface Dashboard<T> {
  state: { data: T | null; error: string | null; loading: boolean }
  load: (yearId?: string | null) => Promise<void>
  reset: () => void
  /** The year the server answered for, when the read is per year. */
  yearOf: () => string | undefined
}

export function defineDashboard<T>(fetch: (yearId?: string | null) => Promise<T>, message: string): Dashboard<T> {
  const state = reactive({ data: null as T | null, error: null as string | null, loading: false })
  async function load(yearId?: string | null): Promise<void> {
    state.loading = true
    state.error = null
    try {
      state.data = (await fetch(yearId)) as never
    } catch (err) {
      state.error = messageOf(err, message)
    } finally {
      state.loading = false
    }
  }
  return {
    state: state as Dashboard<T>['state'],
    load,
    reset: () => { state.data = null; state.error = null },
    yearOf: () => (state.data as { year?: { id?: string } } | null)?.year?.id,
  }
}

/** Ask the workspace to read its dashboard again (after an act on a section page). */
export function usePortalRefresh(): () => void {
  return inject<() => void>('portalRefresh', () => undefined)
}

/** "2 Nov 14:23", the way the pictures write a time in a list. */
export const shortWhen = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  return `${d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`
}
export const dayMonth = (iso: string | null | undefined): string =>
  iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'
export const pctText = (v: string | null | undefined): string => (v === null || v === undefined ? '—' : `${v}%`)

/** The rows for one currency, the reporting currency first. */
export function byCurrency<T extends { currency: string }>(rows: T[] | undefined, first: string): T[] {
  return [...(rows ?? [])].sort((a, b) => Number(b.currency === first) - Number(a.currency === first) || a.currency.localeCompare(b.currency))
}
/** Chart ticks: a round top value and five steps. */
export function niceMax(values: number[]): number {
  const top = Math.max(1, ...values)
  // Small counts get whole-number steps (0 to 4) rather than quarters.
  if (top <= 4) return 4
  const step = 10 ** Math.floor(Math.log10(top))
  return Math.ceil(top / step) * step
}
export const tickLabel = (v: number): string =>
  v >= 1e6 ? `${(v / 1e6).toLocaleString('en-GB', { maximumFractionDigits: 1 })}M` : v >= 1e3 ? `${(v / 1e3).toLocaleString('en-GB', { maximumFractionDigits: 0 })}K` : String(Math.round(v))
