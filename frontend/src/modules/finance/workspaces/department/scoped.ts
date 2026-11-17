/**
 * Wrap a page's lazy component in the department scope gate (ScopeGate.vue), so an unscoped head of
 * department never mounts it and it never asks the server for council-wide figures.
 */
import { defineComponent, h, type Component } from 'vue'

type Loader = () => Promise<{ default: Component } | Component>

export function scoped(load: Loader): () => Promise<Component> {
  return async () => {
    const [mod, gate] = await Promise.all([load(), import('./ScopeGate.vue')])
    const inner = ((mod as { default?: Component }).default ?? mod) as Component
    return defineComponent({
      name: 'DepartmentScoped',
      setup: () => () => h(gate.default, null, { default: () => h(inner) }),
    })
  }
}
