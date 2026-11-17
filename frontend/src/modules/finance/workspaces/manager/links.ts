/**
 * Turn an approvals-inbox location into a link the director may follow, or the reason there is none.
 * A target goes through `useFinanceNav`; a named screen in another workspace is offered only when
 * the server lists that workspace among the person's own (client amendment §13.5).
 */
import type { RouteLocationRaw } from 'vue-router'
import { useFinanceNav, UNAVAILABLE_REASON } from '../../shell/useFinanceNav'
import { useFinanceStore } from '../../stores/finance'
import { WORKSPACE_META } from '../../shell/workspaces'
import type { InboxWhere } from './approvals'

export type Resolved = { ok: true; to: RouteLocationRaw; where: string; reason?: undefined } | { ok: false; to: null; where?: undefined; reason: string }

export function useWhere(): (w: InboxWhere) => Resolved {
  const nav = useFinanceNav()
  const store = useFinanceStore()
  return (w) => {
    if ('target' in w) {
      const r = nav.resolve(w.target)
      if (r.kind !== 'route') return { ok: false, to: null, reason: r.reason }
      return { ok: true, to: { name: r.name, query: w.query ?? {} }, where: WORKSPACE_META[r.workspace].name }
    }
    const held = (store.identity?.workspaces ?? []) as readonly string[]
    if (!held.includes(w.workspace)) return { ok: false, to: null, reason: UNAVAILABLE_REASON }
    return { ok: true, to: { name: w.name, query: w.query ?? {} }, where: WORKSPACE_META[w.workspace].name }
  }
}
