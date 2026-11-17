/**
 * Where each line of the officer dashboard's task queue is worked.
 *
 * The server sends two tasks under `reconciliation` (exceptions, uncommitted imports) and two under
 * `receivables` (old debtors, billing runs), so the sentence decides between them. A billing run is
 * committed in Revenue and Rates, which the officer reaches by target, not by a route of this
 * workspace.
 */
import type { FinanceTarget } from '../../shell/targets'

export type TaskLink = { name: string } | { target: FinanceTarget }

export function taskLink(t: { key: string; text: string }): TaskLink {
  if (/billing run/i.test(t.text)) return { target: 'rates' }
  if (t.key === 'reconciliation') return /exception/i.test(t.text) ? { name: 'ofc-exceptions' } : { name: 'ofc-imports' }
  if (t.key === 'journals') return { name: 'ofc-journals' }
  if (t.key === 'receivables') return { name: 'ofc-receivables' }
  return { name: 'ofc-dashboard' }
}
