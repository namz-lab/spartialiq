# Planner Command Centers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the planner and E.O. command-center windows so they expose the full local-authority workflow through clean in-window modules, tabs, and summary panels.

**Architecture:** Add a small shared planning-workbench data/helper module that defines the new module groupings and summary calculations, cover it with Vitest, then wire both command-center views to that shared structure. Keep the existing map-first layouts, but reorganize the sidebars and tabs into progressive workspaces so everything is available without overcrowding the screen.

**Tech Stack:** Vue 3, TypeScript, Vitest, Vue Test Utils, MapLibre GL, Pinia

---

### Task 1: Create shared command-center workspace definitions with tests

**Files:**
- Create: `src/data/planningWorkbench.ts`
- Create: `src/data/__tests__/planningWorkbench.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from 'vitest'
import {
  plannerRightTabs,
  plannerRegisterDefinitions,
  plannerBottomPanelDefinitions,
  eoRightTabs,
  eoExecutiveSummaryDefinitions,
  eoMapOverlayDefinitions,
  calculatePlannerRegisterCounts,
  calculateRevenueSnapshot,
} from '../planningWorkbench'

describe('planningWorkbench definitions', () => {
  it('defines the approved planner workspace tabs and supporting modules', () => {
    expect(plannerRightTabs.map((tab) => tab.id)).toEqual([
      'case',
      'analysis',
      'workflow',
      'documents',
      'comments',
    ])
    expect(plannerRegisterDefinitions.map((item) => item.id)).toEqual([
      'subdivision',
      'change_of_use',
      'layout',
      'permit',
      'site_visit',
      'circulation',
    ])
    expect(plannerBottomPanelDefinitions.map((panel) => panel.id)).toEqual([
      'yield',
      'constraints',
      'schedule',
      'circulation',
      'site-notes',
    ])
  })

  it('defines the approved EO executive modules', () => {
    expect(eoRightTabs.map((tab) => tab.id)).toEqual([
      'review',
      'compliance',
      'revenue',
      'reports',
      'audit',
      'masterplan',
    ])
    expect(eoExecutiveSummaryDefinitions).toHaveLength(4)
    expect(eoMapOverlayDefinitions.map((item) => item.id)).toEqual([
      'pending-applications',
      'conflict-hotspots',
      'environmental-alerts',
      'revenue-areas',
      'master-plan-projects',
      'enforcement-cases',
    ])
  })

  it('calculates planner register counts from live case items', () => {
    const result = calculatePlannerRegisterCounts([
      { register: 'layout', stage: 'draft' },
      { register: 'layout', stage: 'circulating' },
      { register: 'site_visit', stage: 'scheduled' },
      { register: 'circulation', stage: 'awaiting' },
    ])

    expect(result.layout.count).toBe(2)
    expect(result.site_visit.count).toBe(1)
    expect(result.circulation.count).toBe(1)
    expect(result.layout.urgent).toBe(1)
  })

  it('calculates EO revenue snapshot totals from proposal items', () => {
    const result = calculateRevenueSnapshot([
      { stage: 'approved', estimatedRevenue: 4200, billed: false, overdue: false },
      { stage: 'billed', estimatedRevenue: 1800, billed: true, overdue: true },
      { stage: 'awaiting_eo', estimatedRevenue: 2100, billed: false, overdue: false },
    ])

    expect(result.pendingRevenue).toBe(4200)
    expect(result.billedRevenue).toBe(1800)
    expect(result.overdueAccounts).toBe(1)
    expect(result.awaitingFinance).toBe(1)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/data/__tests__/planningWorkbench.spec.ts`
Expected: FAIL with module resolution error for `../planningWorkbench`

- [ ] **Step 3: Write minimal implementation**

```ts
export const plannerRightTabs = [
  { id: 'case', label: 'Case' },
  { id: 'analysis', label: 'Analysis' },
  { id: 'workflow', label: 'Workflow' },
  { id: 'documents', label: 'Documents' },
  { id: 'comments', label: 'Comments' },
]

export const plannerRegisterDefinitions = [
  { id: 'subdivision', label: 'Subdivision Register' },
  { id: 'change_of_use', label: 'Change of Use Register' },
  { id: 'layout', label: 'Layout Applications' },
  { id: 'permit', label: 'Permit Register' },
  { id: 'site_visit', label: 'Site Visits' },
  { id: 'circulation', label: 'Circulation Queue' },
]

export const plannerBottomPanelDefinitions = [
  { id: 'yield', label: 'Yield & Costing' },
  { id: 'constraints', label: 'Constraint Results' },
  { id: 'schedule', label: 'Stand Schedule' },
  { id: 'circulation', label: 'Circulation Status' },
  { id: 'site-notes', label: 'Site Visit Notes' },
]

export const eoRightTabs = [
  { id: 'review', label: 'Review' },
  { id: 'compliance', label: 'Compliance' },
  { id: 'revenue', label: 'Revenue' },
  { id: 'reports', label: 'Reports' },
  { id: 'audit', label: 'Audit' },
  { id: 'masterplan', label: 'Master Plan' },
]

export function calculatePlannerRegisterCounts(items: Array<{ register: string; stage: string }>) {
  // return object keyed by register id with count + urgent totals
}

export function calculateRevenueSnapshot(
  items: Array<{ stage: string; estimatedRevenue: number; billed: boolean; overdue: boolean }>
) {
  // return pendingRevenue, billedRevenue, overdueAccounts, awaitingFinance
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/data/__tests__/planningWorkbench.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/data/planningWorkbench.ts src/data/__tests__/planningWorkbench.spec.ts
git commit -m "feat: add command center workspace definitions"
```

### Task 2: Rework the planner command center into a progressive local-authority workspace

**Files:**
- Modify: `src/views/VunguPlannerView.vue`
- Modify: `src/data/planningWorkbench.ts`
- Test: `src/data/__tests__/planningWorkbench.spec.ts`

- [ ] **Step 1: Write the failing test**

Add a new assertion to `src/data/__tests__/planningWorkbench.spec.ts`:

```ts
it('describes the planner quick actions and workflow modules needed by the local authority desk', () => {
  expect(plannerQuickActionDefinitions.map((action) => action.id)).toEqual([
    'select',
    'search',
    'draw',
    'measure',
    'buffer',
    'subdivision',
    'annotate',
    'print',
    'quick-check',
  ])

  expect(plannerWorkflowModuleDefinitions.map((module) => module.id)).toEqual([
    'intake',
    'parcel',
    'technical',
    'site-work',
    'scheme-design',
    'circulation',
    'recommendation',
    'finance',
    'history',
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/data/__tests__/planningWorkbench.spec.ts`
Expected: FAIL because the new planner exports do not exist yet

- [ ] **Step 3: Write minimal implementation**

Update `src/data/planningWorkbench.ts` with the new planner exports:

```ts
export const plannerQuickActionDefinitions = [
  { id: 'select', label: 'Select' },
  { id: 'search', label: 'Search' },
  { id: 'draw', label: 'Draw' },
  { id: 'measure', label: 'Measure' },
  { id: 'buffer', label: 'Buffer' },
  { id: 'subdivision', label: 'Subdivision' },
  { id: 'annotate', label: 'Annotate' },
  { id: 'print', label: 'Print' },
  { id: 'quick-check', label: 'Quick Check' },
]

export const plannerWorkflowModuleDefinitions = [
  { id: 'intake', label: 'Intake & Register' },
  { id: 'parcel', label: 'Parcel & Ownership' },
  { id: 'technical', label: 'Technical Analysis' },
  { id: 'site-work', label: 'Site Work' },
  { id: 'scheme-design', label: 'Scheme Design' },
  { id: 'circulation', label: 'Circulation' },
  { id: 'recommendation', label: 'Recommendation' },
  { id: 'finance', label: 'Finance Handoff' },
  { id: 'history', label: 'History & Communication' },
]
```

Then wire `src/views/VunguPlannerView.vue` to:

- use the new right-tab structure: `case`, `analysis`, `workflow`, `documents`, `comments`
- add `Application Inbox` and `Registers` blocks to the left sidebar
- add planner quick actions for `Annotate`, `Print`, and `Quick Check`
- show the case, analysis, workflow, and document modules as grouped expandable sections instead of the old `Property / Actions / Proposal` split
- surface `Stand Schedule`, `Circulation Status`, and `Site Visit Notes` as on-demand planner panels without removing existing yield behavior

Key target shape:

```ts
const plannerRegisters = computed(() =>
  calculatePlannerRegisterCounts(plannerCases.value)
)

const plannerInbox = ref([
  { id: 'APP-2026-014', type: 'Layout Application', ward: 'Ward 4 - Lalapanzi', status: 'awaiting-analysis' },
  { id: 'APP-2026-018', type: 'Change of Use', ward: 'Ward 1 - Somabhula', status: 'site-visit-due' },
])
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/data/__tests__/planningWorkbench.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/VunguPlannerView.vue src/data/planningWorkbench.ts src/data/__tests__/planningWorkbench.spec.ts
git commit -m "feat: expand planner command center workflow modules"
```

### Task 3: Rework the EO command center into an executive oversight workspace

**Files:**
- Modify: `src/views/EOPlannerView.vue`
- Modify: `src/data/planningWorkbench.ts`
- Test: `src/data/__tests__/planningWorkbench.spec.ts`

- [ ] **Step 1: Write the failing test**

Add a new assertion to `src/data/__tests__/planningWorkbench.spec.ts`:

```ts
it('describes the EO oversight modules and district attention summaries', () => {
  expect(eoDistrictAttentionDefinitions.map((item) => item.id)).toEqual([
    'revenue-pending',
    'overdue-cases',
    'active-orders',
    'council-agenda',
  ])

  expect(eoRevenueModuleDefinitions.map((item) => item.id)).toEqual([
    'billed-items',
    'unpaid-items',
    'expected-income',
    'finance-handoffs',
  ])
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/data/__tests__/planningWorkbench.spec.ts`
Expected: FAIL because the EO summary exports do not exist yet

- [ ] **Step 3: Write minimal implementation**

Update `src/data/planningWorkbench.ts` with the new EO exports:

```ts
export const eoDistrictAttentionDefinitions = [
  { id: 'revenue-pending', label: 'Revenue Pending' },
  { id: 'overdue-cases', label: 'Overdue Cases' },
  { id: 'active-orders', label: 'Active Enforcement Orders' },
  { id: 'council-agenda', label: 'Council Agenda Items' },
]

export const eoRevenueModuleDefinitions = [
  { id: 'billed-items', label: 'Billed Applications' },
  { id: 'unpaid-items', label: 'Unpaid Accounts' },
  { id: 'expected-income', label: 'Expected Income' },
  { id: 'finance-handoffs', label: 'Finance Handoffs' },
]
```

Then wire `src/views/EOPlannerView.vue` to:

- add the left-column district attention summary cards
- rename or align map overlay toggles with the approved executive overlays
- add a new `Revenue` tab between `Compliance` and `Reports`
- expand the review workspace with a short executive summary ahead of technical notes
- expose billed, unpaid, expected-income, and finance-handoff status in the new revenue tab

Key target shape:

```ts
const revenueSnapshot = computed(() =>
  calculateRevenueSnapshot(
    proposals.value.map((proposal) => ({
      stage: proposal.stage,
      estimatedRevenue: proposal.estimatedRevenue ?? 0,
      billed: proposal.stage === 'billed',
      overdue: Boolean(proposal.overdue),
    }))
  )
)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/data/__tests__/planningWorkbench.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/views/EOPlannerView.vue src/data/planningWorkbench.ts src/data/__tests__/planningWorkbench.spec.ts
git commit -m "feat: expand EO command center oversight modules"
```

### Task 4: Verify the integrated planner command centers

**Files:**
- Modify: `src/views/VunguPlannerView.vue`
- Modify: `src/views/EOPlannerView.vue`
- Test: `src/data/__tests__/planningWorkbench.spec.ts`

- [ ] **Step 1: Run focused tests**

Run: `npm test -- src/data/__tests__/planningWorkbench.spec.ts`
Expected: PASS

- [ ] **Step 2: Run type-check**

Run: `npm run type-check`
Expected: PASS with no TypeScript errors

- [ ] **Step 3: Run production build**

Run: `npm run build`
Expected: PASS and emit the Vite production bundle

- [ ] **Step 4: Commit**

```bash
git add src/views/VunguPlannerView.vue src/views/EOPlannerView.vue src/data/planningWorkbench.ts src/data/__tests__/planningWorkbench.spec.ts
git commit -m "feat: implement planner command center workspace redesign"
```
