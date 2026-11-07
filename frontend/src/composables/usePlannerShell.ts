// Shell API shared between the planner map pane and the console pane.
// Provided by <PlannerShell>; injected by VunguPlannerView, PlannerWorkspaceView,
// and the statutory drawer. Lets the panes drive each other without router
// navigations that would destroy map/form state.

import { inject, provide, type InjectionKey, type Ref } from 'vue'

export type PlannerPane = 'map' | 'console'
export type SectionKey =
  | 'dashboard' | 'workflow' | 'register' | 'property' | 'referrals'
  | 'participation' | 'inspections' | 'committee'
  | 'appeals' | 'enforcement' | 'plans' | 'forward' | 'layouts' | 'matrix' | 'reports' | 'reference'

export const SECTION_KEYS: readonly SectionKey[] = [
  'dashboard', 'workflow', 'register', 'property', 'referrals',
  'participation', 'inspections', 'committee', 'appeals',
  'enforcement', 'plans', 'forward', 'layouts', 'matrix', 'reports', 'reference',
]

/** Alias used by tests and the console rail — same ordered list. */
export const PLANNER_TOOL_SECTIONS = SECTION_KEYS

export interface PlannerShellApi {
  activePane: Readonly<Ref<PlannerPane>>
  activeConsoleSection: Readonly<Ref<SectionKey>>
  showMap: () => void
  showConsole: (section?: SectionKey) => void
  /** Seed Step 1 intake from a clicked map feature and open the workflow. */
  registerStandFromMap: (feature: unknown) => void
  /** Load an existing permit into the case and open the workflow. */
  openCaseForStand: (permitId: string, tab?: string) => Promise<void>
  /** Switch to the map pane and fly to a centroid. */
  flyTo: (centroid: [number, number]) => void
}

export const PLANNER_SHELL_KEY: InjectionKey<PlannerShellApi> = Symbol('PlannerShell')

export function providePlannerShell(api: PlannerShellApi): void {
  provide(PLANNER_SHELL_KEY, api)
}

export function usePlannerShell(): PlannerShellApi {
  const api = inject(PLANNER_SHELL_KEY)
  if (!api) throw new Error('usePlannerShell() called outside <PlannerShell>')
  return api
}
