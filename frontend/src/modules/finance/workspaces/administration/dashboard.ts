/**
 * Finance Access Administration's one read: every staff account that may hold finance access, and
 * the access changes of the last 90 days from the audit trail. Shared by the layout, the dashboard
 * and the pages, so the counts agree everywhere.
 */
import { financeAccessApi, type AccessEvent } from '../../api/financeAccessApi'
import type { FinanceUserList } from '../../models/types'
import { messageOf, useFinanceStore } from '../../stores/finance'
import { defineDashboard } from '../shared/useDashboard'

export interface AdminData {
  list: FinanceUserList
  changes: AccessEvent[]
  /** Null when read; a sentence when the trail could not be read or the role does not include it. */
  changesNote: string | null
  since: string
}

export function daysAgo(n: number, today = new Date()): string {
  const d = new Date(today)
  d.setDate(d.getDate() - n)
  return d.toISOString().slice(0, 10)
}

async function read(): Promise<AdminData> {
  const since = daysAgo(90)
  const list = await financeAccessApi.allUsers()
  let changes: AccessEvent[] = []
  let changesNote: string | null = null
  if (!useFinanceStore().can('finance.audit.view')) {
    changesNote = 'The access-change trail is part of the finance audit trail, which this role does not include.'
  } else {
    try { changes = await financeAccessApi.changes({ from: since }) } catch (err) { changesNote = messageOf(err, 'The access changes could not be read.') }
  }
  return { list, changes, changesNote, since }
}

export const adminDash = defineDashboard<AdminData>(read, 'The finance accounts could not be read.')

/** Accounts per role, most first. Counts are over every listed account. */
export function byRole(list: FinanceUserList | null | undefined): { role: string; n: number }[] {
  const counts = new Map<string, number>()
  for (const u of list?.users ?? []) counts.set(u.role, (counts.get(u.role) ?? 0) + 1)
  return [...counts.entries()].map(([role, n]) => ({ role, n })).sort((a, b) => b.n - a.n || a.role.localeCompare(b.role))
}
