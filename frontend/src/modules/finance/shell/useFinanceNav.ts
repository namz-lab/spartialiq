/**
 * Links between workspaces that only go where the person may go.
 *
 * `resolveTarget` looks in the current workspace, then the person's home, then the rest of the
 * workspaces the SERVER says they hold, in catalogue order. A workspace that is not theirs is never
 * chosen, and neither is one that has not been built. When nothing serves the target the caller
 * gets a sentence to show instead of a link (client amendment §13.5): a button that opens a page
 * which then refuses is worse than no button.
 *
 * The server still authorises every request on the page a link opens. This decides what is
 * OFFERED, not what is allowed.
 */
import { computed, type ComputedRef } from 'vue'
import { useRoute, useRouter, type LocationQueryRaw } from 'vue-router'
import { useFinanceStore } from '../stores/finance'
import { registrationOf, WORKSPACE_KEYS, isWorkspaceKey, type WorkspaceKey } from './workspaces'
import type { FinanceTarget } from './targets'

export const UNAVAILABLE_REASON =
  'None of your finance workspaces includes this. Ask the finance administrator if your duties have changed.'

export type ResolvedTarget =
  | { kind: 'route'; workspace: WorkspaceKey; name: string }
  | { kind: 'unavailable'; reason: string }

export interface NavContext {
  current: WorkspaceKey | null
  home: WorkspaceKey | null
  /** The workspaces the server reports this person may open. */
  open: readonly WorkspaceKey[]
}

export function resolveTarget(target: FinanceTarget, ctx: NavContext): ResolvedTarget {
  const held = new Set(ctx.open)
  const candidates = [
    ctx.current, ctx.home, ...WORKSPACE_KEYS.filter((k) => held.has(k)),
  ].filter((k): k is WorkspaceKey => k !== null && held.has(k))
  for (const key of candidates) {
    const name = registrationOf(key)?.serves[target]
    if (name) return { kind: 'route', workspace: key, name }
  }
  return { kind: 'unavailable', reason: UNAVAILABLE_REASON }
}

export function useFinanceNav(): {
  current: ComputedRef<WorkspaceKey | null>
  resolve: (target: FinanceTarget) => ResolvedTarget
  go: (target: FinanceTarget, query?: LocationQueryRaw) => ResolvedTarget
} {
  const route = useRoute()
  const router = useRouter()
  const store = useFinanceStore()

  const current = computed<WorkspaceKey | null>(() => {
    const key = route.meta.financeWorkspace
    return isWorkspaceKey(key) ? key : null
  })

  function resolve(target: FinanceTarget): ResolvedTarget {
    return resolveTarget(target, {
      current: current.value,
      home: store.identity?.home_workspace ?? null,
      open: store.identity?.workspaces ?? [],
    })
  }

  /** Navigate when the target resolves; return the resolution either way so a caller can explain. */
  function go(target: FinanceTarget, query: LocationQueryRaw = {}): ResolvedTarget {
    const resolved = resolve(target)
    if (resolved.kind === 'route') void router.push({ name: resolved.name, query })
    return resolved
  }

  return { current, resolve, go }
}
