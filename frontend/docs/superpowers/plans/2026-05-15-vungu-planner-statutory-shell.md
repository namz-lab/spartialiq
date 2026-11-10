# Vungu Planner Statutory Workflow Shell — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 8-tab right rail in `VunguPlannerView.vue` with a five-step statutory workflow shell so a Town Planning Officer can carry out every Section 26 RTCP Act duty (intake, due diligence, committee report, permit drafting with 5-test conditions, notices) inside one console.

**Architecture:** Slim `VunguPlannerView.vue` (header + map + right-rail slot + drawer). New `src/views/planner/` directory holds five step components, a clock banner, a council-tools drawer, plus two helper components. Three composables in `src/composables/` (`usePlannerCase`, `useStatutoryClock`, `useConditionLibrary`) hold all business logic; step components stay presentational. Tier-1 persistence via existing `dmApi`; tier-2 reactive state; tier-3 `localStorage` debounce cache. Errors go through the `useUiFeedback()` machinery shipped earlier today.

**Tech Stack:** Vue 3 SFC + `<script setup lang="ts">`, Pinia for auth, MapLibre GL for the map (untouched), `jsPDF` for committee-report export, Vitest for composable tests, lucide-vue-next icons, scoped CSS matching existing planner styles.

**Spec reference:** [docs/superpowers/specs/2026-05-15-vungu-planner-statutory-design.md](../specs/2026-05-15-vungu-planner-statutory-design.md). Read this before starting — it defines every field name, state shape, and error contract.

---

## File Structure

| Path | Created/Modified | Responsibility |
|---|---|---|
| `src/composables/usePlannerCase.ts` | Create | Active-case `CaseFile` state, `loadFromPermit`, `registerNew`, debounced save, dmApi sync, localStorage cache, lock selectors |
| `src/composables/useStatutoryClock.ts` | Create | Pure clock math on `acknowledgedDate` — `daysElapsed`, `daysRemaining`, `phase`, `warningLevel`, `weekMilestones` |
| `src/composables/useConditionLibrary.ts` | Create | Permit condition templates + 5-test gating (`passesAllTests`) |
| `src/views/planner/StatutoryShell.vue` | Create | Provides `usePlannerCase()`, renders 5 steps + clock banner + drawer toggle |
| `src/views/planner/Step1Intake.vue` | Create | Intake queue + register-new form + classification |
| `src/views/planner/Step2DueDiligence.vue` | Create | File / compatibility / statutory / title / referrals checklists |
| `src/views/planner/Step3CommitteeReport.vue` | Create | 7-section report drafter + PDF export |
| `src/views/planner/Step4PermitDrafting.vue` | Create | Permit core + 5-test conditions builder + Annexure 7 |
| `src/views/planner/Step5Notices.vue` | Create | Ack, deficiency, 26(3) public notice, objections, outcome letter |
| `src/views/planner/StatutoryClockBanner.vue` | Create | 12-week strip with milestones + warning pill |
| `src/views/planner/StepLockGate.vue` | Create | Renders locked/unlocked state per step |
| `src/views/planner/FieldError.vue` | Create | Inline `<p class="field-err">` validation message |
| `src/views/planner/CaseFileDrawer.vue` | Create | Existing Resources/Villages/Returns/Scheme/Consult content, relocated |
| `src/views/planner/__tests__/planner-composables.spec.ts` | Create | Vitest coverage of clock math, 5-test gating, lock transitions |
| `src/views/VunguPlannerView.vue` | Modify | Add view-mode toggle (Phase 4), then strip classic right-rail (Phase 6) |

---

## Phase 1 — Scaffolding

Zero behaviour change. Create directories and stub files so subsequent phases can compile.

### Task 1: Create the `src/views/planner/` directory with stub components

**Files:**
- Create: `src/views/planner/StatutoryShell.vue`
- Create: `src/views/planner/Step1Intake.vue`
- Create: `src/views/planner/Step2DueDiligence.vue`
- Create: `src/views/planner/Step3CommitteeReport.vue`
- Create: `src/views/planner/Step4PermitDrafting.vue`
- Create: `src/views/planner/Step5Notices.vue`
- Create: `src/views/planner/StatutoryClockBanner.vue`
- Create: `src/views/planner/StepLockGate.vue`
- Create: `src/views/planner/FieldError.vue`
- Create: `src/views/planner/CaseFileDrawer.vue`

- [ ] **Step 1: Create FieldError.vue**

```vue
<script setup lang="ts">
defineProps<{ message?: string | null }>()
</script>

<template>
  <p v-if="message" class="field-err">{{ message }}</p>
</template>

<style scoped>
.field-err { margin: 0.2rem 0 0; color: #b91c1c; font-size: 0.7rem; line-height: 1.3; }
</style>
```

- [ ] **Step 2: Create StepLockGate.vue**

```vue
<script setup lang="ts">
import { Lock } from 'lucide-vue-next'
defineProps<{ unlocked: boolean; reason?: string }>()
</script>

<template>
  <slot v-if="unlocked" />
  <div v-else class="step-locked">
    <Lock :size="20" />
    <p>{{ reason || 'Complete previous step first.' }}</p>
  </div>
</template>

<style scoped>
.step-locked { display:flex; flex-direction:column; align-items:center; justify-content:center;
  padding:2rem 1rem; color:#64748b; gap:0.5rem; font-size:0.8125rem; text-align:center; }
</style>
```

- [ ] **Step 3: Create stub for each remaining component**

For each of `StatutoryShell.vue`, `Step1Intake.vue`, `Step2DueDiligence.vue`, `Step3CommitteeReport.vue`, `Step4PermitDrafting.vue`, `Step5Notices.vue`, `StatutoryClockBanner.vue`, `CaseFileDrawer.vue`, write the same stub body:

```vue
<script setup lang="ts">
// Phase 1 stub. Filled in later phases.
</script>

<template>
  <div class="planner-stub">Component stub — coming soon</div>
</template>

<style scoped>
.planner-stub { padding:1rem; color:#64748b; font-size:0.8125rem; }
</style>
```

- [ ] **Step 4: Run typecheck**

Run: `cd c:/Users/theop/OneDrive/Desktop/app-frontend && npx vue-tsc --noEmit 2>&1 | grep -E "planner/" | head -5`

Expected: no new errors from the `planner/` directory.

- [ ] **Step 5: Commit**

```bash
git add src/views/planner/
git commit -m "feat(planner): scaffold statutory shell directory with stub components"
```

---

### Task 2: Create composable stubs

**Files:**
- Create: `src/composables/usePlannerCase.ts`
- Create: `src/composables/useStatutoryClock.ts`
- Create: `src/composables/useConditionLibrary.ts`

- [ ] **Step 1: Stub useStatutoryClock.ts**

```ts
import { ref, computed, type Ref } from 'vue'

export type ClockPhase =
  | 'pre_ack' | 'consultation' | 'objections'
  | 'report_drafting' | 'committee' | 'permit_issue'
  | 'overdue' | 'deemed_refused' | 'completed'

export type WarningLevel = 'ok' | 'caution' | 'urgent' | 'critical'

export interface ClockState {
  ackDate:       Date | null
  expiryDate:    Date | null
  daysElapsed:   number
  daysRemaining: number
  weekNumber:    number
  phase:         ClockPhase
  warningLevel:  WarningLevel
}

export function useStatutoryClock(_ackDateRef: Ref<string | null>) {
  // Phase 2 fills this in.
  const state = ref<ClockState>({
    ackDate: null, expiryDate: null,
    daysElapsed: 0, daysRemaining: 90, weekNumber: 0,
    phase: 'pre_ack', warningLevel: 'ok',
  })
  return {
    state: computed(() => state.value),
    weekMilestones: () => [] as Array<{ week: number; label: string }>,
  }
}
```

- [ ] **Step 2: Stub useConditionLibrary.ts**

```ts
export type ConditionCategory =
  | 'setback' | 'materials' | 'parking' | 'hours' | 'landscaping'
  | 'services' | 'commencement' | 'inspection' | 'custom'

export interface PlanningCondition {
  id: string
  category: ConditionCategory
  text: string
  tests: {
    necessity: boolean; relevance: boolean; enforceability: boolean
    precision: boolean; reasonableness: boolean
  }
}

export interface ConditionTemplate {
  key: ConditionCategory
  label: string
  defaultText: string
}

export function useConditionLibrary() {
  return {
    templates: [] as ConditionTemplate[],
    addFromTemplate: (_key: ConditionCategory): PlanningCondition => ({
      id: '', category: 'custom', text: '',
      tests: { necessity:false, relevance:false, enforceability:false, precision:false, reasonableness:false },
    }),
    passesAllTests: (_c: PlanningCondition) => false,
  }
}
```

- [ ] **Step 3: Stub usePlannerCase.ts**

```ts
import { ref, computed, provide, inject, type ComputedRef, type InjectionKey } from 'vue'
import type { PlanningCondition } from './useConditionLibrary'

export type DevType =
  | 'residential' | 'commercial' | 'industrial' | 'agricultural'
  | 'institutional' | 'subdivision' | 'change_of_use' | 'advertisement' | 'other'

export type Classification =
  | 'routine_26_1' | 'special_consent_26_3' | 'preliminary'
  | 'change_of_use' | 'building_ops' | 'mining'

export type CheckResult = 'pass' | 'fail' | 'na' | null

export interface Referral {
  department: string; contactedAt: string; response: string
  outcome: 'pending' | 'no_objection' | 'objection' | 'conditional'
}

export interface ObjectionRow {
  id: string; objector: string; grounds: string; receivedAt: string
  officerView: string; resolvedAt: string | null
}

export interface CaseFile {
  registrationNo: string
  fileRef: string
  permitId: string | null
  applicant: { name: string; idNumber: string; phone: string; email: string }
  property:  { standNo: string; ward: string; description: string; titleDeedNo: string }
  proposal:  { devType: DevType; description: string; estimatedCost: number
               plinthArea: number; floors: number; parkingBays: number }
  intake:    { feePaid: boolean; feeReceiptNo: string; feeAmount: number
               copiesSubmitted: number; titleDeedAttached: boolean
               bondholderConsent: boolean }
  classification: Classification
  applicationDate:  string
  acknowledgedDate: string | null
  expiryDate:       string | null
  dueDiligence: {
    fileChecks:        Record<string, { result: CheckResult; notes: string }>
    compatibility:     Record<string, { result: CheckResult; notes: string }>
    statutoryChecks:   Record<string, { result: CheckResult; notes: string }>
    titleDeedConflict: { hasConflict: boolean; deedFileName: string
                         bondholderConsentReceived: boolean }
    referrals:   Referral[]
    completedAt: string | null
  }
  committeeReport: {
    siteContext: string; policyAnalysis: string; publicResponseNotes: string
    recommendation: 'approve' | 'approve_modified' | 'refuse' | 'defer'
    recommendationReasons: string
    tabledAt: string | null; resolutionAt: string | null; resolutionText: string
  }
  permit: {
    permitNo: string
    useClass: '' | 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI'
    permittedDescription: string
    conditions: PlanningCondition[]
    annexure7Notes: string
    issueDate: string | null
    issuingOfficer: string
  }
  notices: {
    ackSentAt: string | null
    ackReturnedAt: string | null
    publicNotice: { newspaper: string; publishedAt: string
                    abuttingOwners: string[]; proofUploadedAt: string | null } | null
    objections: ObjectionRow[]
    outcomeLetterSentAt: string | null
  }
  lastEditedAt: string
}

export interface PlannerCaseContext {
  current:        ComputedRef<CaseFile | null>
  step2Unlocked:  ComputedRef<boolean>
  step3Unlocked:  ComputedRef<boolean>
  step4Unlocked:  ComputedRef<boolean>
  step5Available: ComputedRef<boolean>
  loadFromPermit: (id: string) => Promise<void>
  registerNew:    (draft: Partial<CaseFile>) => Promise<void>
  save:           () => void
  clear:          () => void
  syncPending:    ComputedRef<boolean>
}

const PLANNER_CASE_KEY: InjectionKey<PlannerCaseContext> = Symbol('PlannerCase')

export function providePlannerCase(): PlannerCaseContext {
  // Phase 2 fills this in.
  const current = ref<CaseFile | null>(null)
  const ctx: PlannerCaseContext = {
    current: computed(() => current.value),
    step2Unlocked: computed(() => false),
    step3Unlocked: computed(() => false),
    step4Unlocked: computed(() => false),
    step5Available: computed(() => true),
    loadFromPermit: async () => {},
    registerNew:    async () => {},
    save:           () => {},
    clear:          () => { current.value = null },
    syncPending:    computed(() => false),
  }
  provide(PLANNER_CASE_KEY, ctx)
  return ctx
}

export function usePlannerCase(): PlannerCaseContext {
  const ctx = inject(PLANNER_CASE_KEY)
  if (!ctx) throw new Error('usePlannerCase() called outside <StatutoryShell> tree')
  return ctx
}
```

- [ ] **Step 4: Typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | grep -E "composables/use(Planner|Statutory|Condition)" | head -10`

Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/composables/usePlannerCase.ts src/composables/useStatutoryClock.ts src/composables/useConditionLibrary.ts
git commit -m "feat(planner): scaffold composables (usePlannerCase, useStatutoryClock, useConditionLibrary)"
```

---

## Phase 2 — Composables with TDD

Implement business logic in isolation. Tests come first because clock math and 5-test gating must be provably correct.

### Task 3: TDD — useConditionLibrary (5-test gating)

**Files:**
- Create: `src/views/planner/__tests__/planner-composables.spec.ts`
- Modify: `src/composables/useConditionLibrary.ts`

- [ ] **Step 1: Write failing tests**

```ts
// src/views/planner/__tests__/planner-composables.spec.ts
import { describe, it, expect } from 'vitest'
import { useConditionLibrary, type PlanningCondition } from '@/composables/useConditionLibrary'

const allPass = {
  necessity: true, relevance: true, enforceability: true,
  precision: true, reasonableness: true,
}

function condFixture(over: Partial<PlanningCondition> = {}): PlanningCondition {
  return {
    id: 'c-1', category: 'custom', text: 'Sample condition',
    tests: { ...allPass },
    ...over,
  }
}

describe('useConditionLibrary', () => {
  it('exposes the 8 standard templates plus custom', () => {
    const lib = useConditionLibrary()
    const keys = lib.templates.map(t => t.key).sort()
    expect(keys).toEqual([
      'commencement', 'custom', 'hours', 'inspection',
      'landscaping', 'materials', 'parking', 'services', 'setback',
    ])
  })

  it('addFromTemplate returns a condition with that category and template text', () => {
    const lib = useConditionLibrary()
    const c = lib.addFromTemplate('setback')
    expect(c.category).toBe('setback')
    expect(c.text.length).toBeGreaterThan(10)
    expect(c.id).toMatch(/^cond_/)
  })

  it('passesAllTests returns true only when every test is true', () => {
    const lib = useConditionLibrary()
    expect(lib.passesAllTests(condFixture())).toBe(true)
    expect(lib.passesAllTests(condFixture({ tests: { ...allPass, necessity: false } }))).toBe(false)
    expect(lib.passesAllTests(condFixture({ tests: { ...allPass, reasonableness: false } }))).toBe(false)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/views/planner/__tests__/planner-composables.spec.ts`

Expected: 3 failures (templates empty, addFromTemplate returns stub, passesAllTests returns false).

- [ ] **Step 3: Implement useConditionLibrary**

Replace contents of `src/composables/useConditionLibrary.ts`:

```ts
export type ConditionCategory =
  | 'setback' | 'materials' | 'parking' | 'hours' | 'landscaping'
  | 'services' | 'commencement' | 'inspection' | 'custom'

export interface PlanningCondition {
  id: string
  category: ConditionCategory
  text: string
  tests: {
    necessity: boolean; relevance: boolean; enforceability: boolean
    precision: boolean; reasonableness: boolean
  }
}

export interface ConditionTemplate {
  key: ConditionCategory
  label: string
  defaultText: string
}

const TEMPLATES: ConditionTemplate[] = [
  { key: 'setback',      label: 'Building line / setback',
    defaultText: 'A minimum building line of 5 metres shall be maintained from the road reserve and 3 metres from side and rear boundaries.' },
  { key: 'materials',    label: 'Materials',
    defaultText: 'External walls shall be constructed in burnt brick or approved equivalent. Roofing shall be in tiled concrete or galvanised IBR sheeting.' },
  { key: 'parking',      label: 'Parking provision',
    defaultText: 'On-site parking shall be provided at a minimum of 1 bay per 25 square metres of commercial gross floor area.' },
  { key: 'hours',        label: 'Hours of operation',
    defaultText: 'Trading or operating hours shall not exceed 06:00 to 22:00, Monday to Saturday, with no operations on Sunday or public holidays.' },
  { key: 'landscaping',  label: 'Landscaping & screening',
    defaultText: 'A landscaped buffer of not less than 2 metres in width shall be planted and maintained along the road frontage and any boundary adjoining residential land.' },
  { key: 'services',     label: 'Municipal services',
    defaultText: "The development shall be connected to municipal water and sewer reticulation at the developer's cost, to the satisfaction of the Council Engineer." },
  { key: 'commencement', label: 'Time limit for commencement',
    defaultText: 'Substantial commencement of the permitted development shall occur within twelve (12) months from the date of permit issue, failing which the permit shall lapse.' },
  { key: 'inspection',   label: 'Stage inspection',
    defaultText: 'Stage inspections shall be carried out at foundations, damp-proof course, lintel, roof structure, and completion stages, each subject to a 24-hour booking with Council.' },
  { key: 'custom',       label: 'Custom condition', defaultText: '' },
]

function uid(): string {
  return 'cond_' + Math.random().toString(36).slice(2, 10)
}

export function useConditionLibrary() {
  function addFromTemplate(key: ConditionCategory): PlanningCondition {
    const tpl = TEMPLATES.find(t => t.key === key) || TEMPLATES[TEMPLATES.length - 1]
    return {
      id: uid(),
      category: tpl.key,
      text: tpl.defaultText,
      tests: { necessity: false, relevance: false, enforceability: false, precision: false, reasonableness: false },
    }
  }

  function passesAllTests(c: PlanningCondition): boolean {
    const t = c.tests
    return t.necessity && t.relevance && t.enforceability && t.precision && t.reasonableness
  }

  return { templates: TEMPLATES, addFromTemplate, passesAllTests }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/views/planner/__tests__/planner-composables.spec.ts`

Expected: 3 passes.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useConditionLibrary.ts src/views/planner/__tests__/planner-composables.spec.ts
git commit -m "feat(planner): implement useConditionLibrary with 5-test gating + 9 templates"
```

---

### Task 4: TDD — useStatutoryClock

**Files:**
- Modify: `src/views/planner/__tests__/planner-composables.spec.ts`
- Modify: `src/composables/useStatutoryClock.ts`

- [ ] **Step 1: Append failing tests**

Append to `planner-composables.spec.ts`:

```ts
import { ref, nextTick } from 'vue'
import { useStatutoryClock } from '@/composables/useStatutoryClock'

function isoDaysAgo(n: number): string {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() - n)
  return d.toISOString()
}

describe('useStatutoryClock', () => {
  it('returns pre_ack phase when ackDate is null', () => {
    const ack = ref<string | null>(null)
    const { state } = useStatutoryClock(ack)
    expect(state.value.phase).toBe('pre_ack')
    expect(state.value.daysElapsed).toBe(0)
    expect(state.value.daysRemaining).toBe(90)
    expect(state.value.warningLevel).toBe('ok')
  })

  it('computes daysElapsed and daysRemaining from ackDate', async () => {
    const ack = ref<string | null>(isoDaysAgo(10))
    const { state } = useStatutoryClock(ack)
    await nextTick()
    expect(state.value.daysElapsed).toBe(10)
    expect(state.value.daysRemaining).toBe(80)
    expect(state.value.weekNumber).toBe(1)
    expect(state.value.warningLevel).toBe('ok')
  })

  it('flags warningLevel caution at 30 days remaining', async () => {
    const ack = ref<string | null>(isoDaysAgo(60))
    const { state } = useStatutoryClock(ack)
    await nextTick()
    expect(state.value.daysRemaining).toBe(30)
    expect(state.value.warningLevel).toBe('caution')
  })

  it('flags warningLevel urgent at 14 days remaining', async () => {
    const ack = ref<string | null>(isoDaysAgo(76))
    const { state } = useStatutoryClock(ack)
    await nextTick()
    expect(state.value.daysRemaining).toBe(14)
    expect(state.value.warningLevel).toBe('urgent')
  })

  it('flags phase deemed_refused + warningLevel critical at 0 days', async () => {
    const ack = ref<string | null>(isoDaysAgo(91))
    const { state } = useStatutoryClock(ack)
    await nextTick()
    expect(state.value.daysRemaining).toBeLessThanOrEqual(0)
    expect(state.value.phase).toBe('deemed_refused')
    expect(state.value.warningLevel).toBe('critical')
  })

  it('weekMilestones returns the six statutory checkpoints', () => {
    const ack = ref<string | null>(isoDaysAgo(0))
    const { weekMilestones } = useStatutoryClock(ack)
    const m = weekMilestones()
    expect(m.length).toBe(6)
    expect(m[0]).toEqual({ week: 0,  label: 'Intake' })
    expect(m[5]).toEqual({ week: 12, label: 'Resolution' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/views/planner/__tests__/planner-composables.spec.ts`

Expected: 6 new failures (warningLevel always 'ok' in stub, phase always 'pre_ack', etc.).

- [ ] **Step 3: Implement useStatutoryClock**

Replace contents of `src/composables/useStatutoryClock.ts`:

```ts
import { computed, onScopeDispose, ref, type Ref } from 'vue'

export type ClockPhase =
  | 'pre_ack' | 'consultation' | 'objections'
  | 'report_drafting' | 'committee' | 'permit_issue'
  | 'overdue' | 'deemed_refused' | 'completed'

export type WarningLevel = 'ok' | 'caution' | 'urgent' | 'critical'

export interface ClockState {
  ackDate:       Date | null
  expiryDate:    Date | null
  daysElapsed:   number
  daysRemaining: number
  weekNumber:    number
  phase:         ClockPhase
  warningLevel:  WarningLevel
}

const STATUTORY_DAYS = 90  // 3 months

const MILESTONES = [
  { week: 0,  label: 'Intake' },
  { week: 1,  label: 'Ack'     },
  { week: 3,  label: 'Notice'  },
  { week: 6,  label: 'Objections' },
  { week: 9,  label: 'Report'  },
  { week: 12, label: 'Resolution' },
] as const

function diffDays(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  return Math.floor(ms / (1000 * 60 * 60 * 24))
}

function deriveState(ackIso: string | null, now: Date = new Date()): ClockState {
  if (!ackIso) {
    return {
      ackDate: null, expiryDate: null,
      daysElapsed: 0, daysRemaining: STATUTORY_DAYS,
      weekNumber: 0, phase: 'pre_ack', warningLevel: 'ok',
    }
  }
  const ack = new Date(ackIso)
  const expiry = new Date(ack)
  expiry.setUTCDate(expiry.getUTCDate() + STATUTORY_DAYS)
  const daysElapsed   = Math.max(0, diffDays(ack, now))
  const daysRemaining = STATUTORY_DAYS - daysElapsed
  const weekNumber    = Math.floor(daysElapsed / 7)
  let phase: ClockPhase
  if (daysRemaining <= 0)        phase = 'deemed_refused'
  else if (weekNumber < 1)       phase = 'consultation'
  else if (weekNumber < 6)       phase = 'objections'
  else if (weekNumber < 9)       phase = 'report_drafting'
  else if (weekNumber < 12)      phase = 'committee'
  else                           phase = 'permit_issue'
  let warningLevel: WarningLevel
  if (daysRemaining > 30)        warningLevel = 'ok'
  else if (daysRemaining > 14)   warningLevel = 'caution'
  else if (daysRemaining > 0)    warningLevel = 'urgent'
  else                           warningLevel = 'critical'
  return { ackDate: ack, expiryDate: expiry, daysElapsed, daysRemaining, weekNumber, phase, warningLevel }
}

export function useStatutoryClock(ackDateRef: Ref<string | null>) {
  const tick = ref(0)
  const intervalId = typeof window !== 'undefined'
    ? window.setInterval(() => { tick.value++ }, 60_000)
    : null
  onScopeDispose(() => { if (intervalId !== null) clearInterval(intervalId) })

  const state = computed<ClockState>(() => {
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    tick.value  // create a dependency on the ticker
    return deriveState(ackDateRef.value)
  })

  function weekMilestones(): Array<{ week: number; label: string }> {
    return MILESTONES.slice()
  }

  return { state, weekMilestones }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/views/planner/__tests__/planner-composables.spec.ts`

Expected: 9 passes (3 previous + 6 new).

- [ ] **Step 5: Commit**

```bash
git add src/composables/useStatutoryClock.ts src/views/planner/__tests__/planner-composables.spec.ts
git commit -m "feat(planner): implement useStatutoryClock with 90-day statutory math + warning tiers"
```

---

### Task 5: TDD — usePlannerCase (state + unlock selectors)

**Files:**
- Modify: `src/views/planner/__tests__/planner-composables.spec.ts`
- Modify: `src/composables/usePlannerCase.ts`

- [ ] **Step 1: Append failing tests**

Append to the spec file:

```ts
import { defineComponent, h } from 'vue'
import { mount } from '@vue/test-utils'
import { providePlannerCase, usePlannerCase, type CaseFile } from '@/composables/usePlannerCase'

function withProvidedCase() {
  let captured: ReturnType<typeof providePlannerCase> | null = null
  const Host = defineComponent({
    setup() { captured = providePlannerCase(); return () => h('div') },
  })
  mount(Host)
  if (!captured) throw new Error('context not captured')
  return captured
}

function seedCase(over: Partial<CaseFile> = {}): CaseFile {
  return {
    registrationNo: 'VR-2026-0001', fileRef: 'file/VR-2026-0001', permitId: 'PMT-1',
    applicant: { name: 'A', idNumber: 'B', phone: '', email: '' },
    property:  { standNo: 'S1', ward: 'Ward 1', description: '', titleDeedNo: '' },
    proposal:  { devType: 'residential', description: '', estimatedCost: 0,
                 plinthArea: 0, floors: 1, parkingBays: 1 },
    intake:    { feePaid: true, feeReceiptNo: '', feeAmount: 46,
                 copiesSubmitted: 3, titleDeedAttached: true, bondholderConsent: false },
    classification: 'routine_26_1',
    applicationDate: new Date().toISOString(),
    acknowledgedDate: null, expiryDate: null,
    dueDiligence: { fileChecks:{}, compatibility:{}, statutoryChecks:{},
                    titleDeedConflict:{ hasConflict:false, deedFileName:'', bondholderConsentReceived:false },
                    referrals: [], completedAt: null },
    committeeReport: { siteContext:'', policyAnalysis:'', publicResponseNotes:'',
                       recommendation:'approve', recommendationReasons:'',
                       tabledAt:null, resolutionAt:null, resolutionText:'' },
    permit: { permitNo:'', useClass:'', permittedDescription:'', conditions:[],
              annexure7Notes:'', issueDate:null, issuingOfficer:'' },
    notices: { ackSentAt:null, ackReturnedAt:null, publicNotice:null, objections:[], outcomeLetterSentAt:null },
    lastEditedAt: new Date().toISOString(),
    ...over,
  }
}

describe('usePlannerCase', () => {
  it('starts with no current case and all steps locked', () => {
    const ctx = withProvidedCase()
    expect(ctx.current.value).toBeNull()
    expect(ctx.step2Unlocked.value).toBe(false)
    expect(ctx.step3Unlocked.value).toBe(false)
    expect(ctx.step4Unlocked.value).toBe(false)
    expect(ctx.step5Available.value).toBe(true)
  })

  it('unlocks step 2 once permitId is set', async () => {
    const ctx = withProvidedCase()
    await ctx.registerNew(seedCase())
    expect(ctx.current.value?.permitId).toBe('PMT-1')
    expect(ctx.step2Unlocked.value).toBe(true)
    expect(ctx.step3Unlocked.value).toBe(false)
  })

  it('unlocks step 3 once dueDiligence.completedAt is set', async () => {
    const ctx = withProvidedCase()
    await ctx.registerNew(seedCase())
    ctx.current.value!.dueDiligence.completedAt = new Date().toISOString()
    expect(ctx.step3Unlocked.value).toBe(true)
    expect(ctx.step4Unlocked.value).toBe(false)
  })

  it('unlocks step 4 only when resolution recorded AND recommendation is approve/approve_modified', async () => {
    const ctx = withProvidedCase()
    await ctx.registerNew(seedCase())
    const c = ctx.current.value!
    c.dueDiligence.completedAt = new Date().toISOString()
    c.committeeReport.resolutionAt = new Date().toISOString()
    c.committeeReport.recommendation = 'refuse'
    expect(ctx.step4Unlocked.value).toBe(false)
    c.committeeReport.recommendation = 'approve'
    expect(ctx.step4Unlocked.value).toBe(true)
    c.committeeReport.recommendation = 'approve_modified'
    expect(ctx.step4Unlocked.value).toBe(true)
  })

  it('clear() resets to no current case', async () => {
    const ctx = withProvidedCase()
    await ctx.registerNew(seedCase())
    expect(ctx.current.value).not.toBeNull()
    ctx.clear()
    expect(ctx.current.value).toBeNull()
  })
})
```

- [ ] **Step 2: Confirm @vue/test-utils is installed**

Run: `cat package.json | grep "@vue/test-utils"`

Expected: shown in devDependencies. If missing, run `npm install --save-dev @vue/test-utils`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/views/planner/__tests__/planner-composables.spec.ts`

Expected: 5 new failures (registerNew is a no-op, all unlocks return false).

- [ ] **Step 4: Implement usePlannerCase reactive state + selectors**

Replace contents of `src/composables/usePlannerCase.ts`:

```ts
import { ref, computed, provide, inject, type ComputedRef, type InjectionKey } from 'vue'
import type { PlanningCondition } from './useConditionLibrary'

export type DevType =
  | 'residential' | 'commercial' | 'industrial' | 'agricultural'
  | 'institutional' | 'subdivision' | 'change_of_use' | 'advertisement' | 'other'

export type Classification =
  | 'routine_26_1' | 'special_consent_26_3' | 'preliminary'
  | 'change_of_use' | 'building_ops' | 'mining'

export type CheckResult = 'pass' | 'fail' | 'na' | null

export interface Referral {
  department: string; contactedAt: string; response: string
  outcome: 'pending' | 'no_objection' | 'objection' | 'conditional'
}

export interface ObjectionRow {
  id: string; objector: string; grounds: string; receivedAt: string
  officerView: string; resolvedAt: string | null
}

export interface CaseFile {
  registrationNo: string
  fileRef: string
  permitId: string | null
  applicant: { name: string; idNumber: string; phone: string; email: string }
  property:  { standNo: string; ward: string; description: string; titleDeedNo: string }
  proposal:  { devType: DevType; description: string; estimatedCost: number
               plinthArea: number; floors: number; parkingBays: number }
  intake:    { feePaid: boolean; feeReceiptNo: string; feeAmount: number
               copiesSubmitted: number; titleDeedAttached: boolean
               bondholderConsent: boolean }
  classification: Classification
  applicationDate:  string
  acknowledgedDate: string | null
  expiryDate:       string | null
  dueDiligence: {
    fileChecks:        Record<string, { result: CheckResult; notes: string }>
    compatibility:     Record<string, { result: CheckResult; notes: string }>
    statutoryChecks:   Record<string, { result: CheckResult; notes: string }>
    titleDeedConflict: { hasConflict: boolean; deedFileName: string
                         bondholderConsentReceived: boolean }
    referrals:   Referral[]
    completedAt: string | null
  }
  committeeReport: {
    siteContext: string; policyAnalysis: string; publicResponseNotes: string
    recommendation: 'approve' | 'approve_modified' | 'refuse' | 'defer'
    recommendationReasons: string
    tabledAt: string | null; resolutionAt: string | null; resolutionText: string
  }
  permit: {
    permitNo: string
    useClass: '' | 'I' | 'II' | 'III' | 'IV' | 'V' | 'VI'
    permittedDescription: string
    conditions: PlanningCondition[]
    annexure7Notes: string
    issueDate: string | null
    issuingOfficer: string
  }
  notices: {
    ackSentAt: string | null
    ackReturnedAt: string | null
    publicNotice: { newspaper: string; publishedAt: string
                    abuttingOwners: string[]; proofUploadedAt: string | null } | null
    objections: ObjectionRow[]
    outcomeLetterSentAt: string | null
  }
  lastEditedAt: string
}

export interface PlannerCaseContext {
  current:        ComputedRef<CaseFile | null>
  step2Unlocked:  ComputedRef<boolean>
  step3Unlocked:  ComputedRef<boolean>
  step4Unlocked:  ComputedRef<boolean>
  step5Available: ComputedRef<boolean>
  loadFromPermit: (id: string) => Promise<void>
  registerNew:    (draft: Partial<CaseFile>) => Promise<void>
  save:           () => void
  clear:          () => void
  syncPending:    ComputedRef<boolean>
}

const PLANNER_CASE_KEY: InjectionKey<PlannerCaseContext> = Symbol('PlannerCase')

export function emptyCase(): CaseFile {
  return {
    registrationNo: '', fileRef: '', permitId: null,
    applicant: { name:'', idNumber:'', phone:'', email:'' },
    property:  { standNo:'', ward:'', description:'', titleDeedNo:'' },
    proposal:  { devType:'residential', description:'', estimatedCost:0,
                 plinthArea:0, floors:1, parkingBays:0 },
    intake:    { feePaid:false, feeReceiptNo:'', feeAmount:0,
                 copiesSubmitted:0, titleDeedAttached:false, bondholderConsent:false },
    classification: 'routine_26_1',
    applicationDate: new Date().toISOString(),
    acknowledgedDate: null, expiryDate: null,
    dueDiligence: { fileChecks:{}, compatibility:{}, statutoryChecks:{},
                    titleDeedConflict:{ hasConflict:false, deedFileName:'', bondholderConsentReceived:false },
                    referrals: [], completedAt: null },
    committeeReport: { siteContext:'', policyAnalysis:'', publicResponseNotes:'',
                       recommendation:'approve', recommendationReasons:'',
                       tabledAt:null, resolutionAt:null, resolutionText:'' },
    permit: { permitNo:'', useClass:'', permittedDescription:'', conditions:[],
              annexure7Notes:'', issueDate:null, issuingOfficer:'' },
    notices: { ackSentAt:null, ackReturnedAt:null, publicNotice:null,
               objections:[], outcomeLetterSentAt:null },
    lastEditedAt: new Date().toISOString(),
  }
}

export function providePlannerCase(): PlannerCaseContext {
  const current = ref<CaseFile | null>(null)
  const syncPending = ref(false)

  const step2Unlocked  = computed(() => !!current.value?.permitId)
  const step3Unlocked  = computed(() => !!current.value?.dueDiligence.completedAt)
  const step4Unlocked  = computed(() => {
    const c = current.value
    if (!c?.committeeReport.resolutionAt) return false
    return c.committeeReport.recommendation === 'approve'
        || c.committeeReport.recommendation === 'approve_modified'
  })
  const step5Available = computed(() => true)

  async function registerNew(draft: Partial<CaseFile>) {
    current.value = { ...emptyCase(), ...draft, lastEditedAt: new Date().toISOString() }
    save()
  }

  async function loadFromPermit(_id: string) {
    // Phase 2 sub-task wires dmApi.getPermit + localStorage merge. Stubbed here.
  }

  function save() {
    if (!current.value) return
    current.value.lastEditedAt = new Date().toISOString()
  }

  function clear() {
    current.value = null
  }

  const ctx: PlannerCaseContext = {
    current: computed(() => current.value),
    step2Unlocked, step3Unlocked, step4Unlocked, step5Available,
    loadFromPermit, registerNew, save, clear,
    syncPending: computed(() => syncPending.value),
  }
  provide(PLANNER_CASE_KEY, ctx)
  return ctx
}

export function usePlannerCase(): PlannerCaseContext {
  const ctx = inject(PLANNER_CASE_KEY)
  if (!ctx) throw new Error('usePlannerCase() called outside <StatutoryShell> tree')
  return ctx
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/views/planner/__tests__/planner-composables.spec.ts`

Expected: 14 passes (9 previous + 5 new).

- [ ] **Step 6: Commit**

```bash
git add src/composables/usePlannerCase.ts src/views/planner/__tests__/planner-composables.spec.ts
git commit -m "feat(planner): implement usePlannerCase state + unlock selectors"
```

---

### Task 6: usePlannerCase — save orchestration (localStorage + dmApi sync + retry queue + concurrent-edit guard)

**Files:**
- Modify: `src/composables/usePlannerCase.ts`

This task wires real persistence (`dmApi` + `localStorage`), debounced save, retry queue, `beforeunload` guard, and the cross-tab concurrent-edit reload prompt (§ 8.4 of the spec).

- [ ] **Step 1: Add storage helpers + retry queue at module scope**

At the top of `src/composables/usePlannerCase.ts`, just below the existing imports, add:

```ts
import { onScopeDispose } from 'vue'
import { dmApi } from '@/services/developmentManagementService'

const STORAGE_KEY = (permitId: string | null) =>
  permitId ? `planner_case_${permitId}` : `planner_case_new_draft`

const RECENT_KEY = 'planner_recent_cases'
const MAX_RECENT = 10

let saveTimer: ReturnType<typeof setTimeout> | null = null
let retryQueue: Array<() => Promise<void>> = []

function writeLocal(c: CaseFile) {
  try { localStorage.setItem(STORAGE_KEY(c.permitId), JSON.stringify(c)) } catch {}
}

function readLocal(permitId: string): CaseFile | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY(permitId))
    return raw ? JSON.parse(raw) as CaseFile : null
  } catch { return null }
}

function pushRecent(c: CaseFile) {
  if (!c.permitId) return
  try {
    const recent: Array<{ permitId: string; label: string; openedAt: string }> =
      JSON.parse(localStorage.getItem(RECENT_KEY) || '[]')
    const label = `${c.registrationNo} — ${c.applicant.name || c.property.standNo}`
    const filtered = recent.filter(r => r.permitId !== c.permitId)
    filtered.unshift({ permitId: c.permitId!, label, openedAt: new Date().toISOString() })
    localStorage.setItem(RECENT_KEY, JSON.stringify(filtered.slice(0, MAX_RECENT)))
  } catch {}
}

async function flushRetryQueue() {
  const pending = retryQueue.slice()
  retryQueue = []
  for (const op of pending) {
    try { await op() } catch { retryQueue.push(op) }
  }
}

function queueRetry(op: () => Promise<void>) {
  retryQueue.push(op)
}
```

- [ ] **Step 2: Replace registerNew / loadFromPermit / save inside providePlannerCase()**

Replace the three function bodies in `providePlannerCase()`:

```ts
async function registerNew(draft: Partial<CaseFile>) {
  const seed: CaseFile = { ...emptyCase(), ...draft, lastEditedAt: new Date().toISOString() }
  current.value = seed
  // Persist via dmApi if no permitId yet.
  if (!seed.permitId) {
    try {
      const created = await dmApi.createPermit({
        stand_number:        seed.property.standNo,
        suburb_ward:         seed.property.ward,
        applicant_name:      seed.applicant.name,
        applicant_id_number: seed.applicant.idNumber,
        applicant_phone:     seed.applicant.phone || null,
        applicant_email:     seed.applicant.email || null,
        development_type:    seed.proposal.devType as any,
        description:         seed.proposal.description || null,
        status:              'registered' as any,
        fee_paid:            seed.intake.feePaid,
      } as any)
      seed.permitId = created.id
      if (!seed.registrationNo) {
        seed.registrationNo = created.dev_register_no || created.id.slice(0, 13).toUpperCase()
      }
      seed.fileRef = `file/${seed.registrationNo}`
    } catch {
      syncPending.value = true
      queueRetry(async () => { await registerNew(seed) })
    }
  }
  writeLocal(seed)
  pushRecent(seed)
}

async function loadFromPermit(id: string) {
  const cached = readLocal(id)
  let merged: CaseFile
  try {
    const server = await dmApi.getPermit(id)
    if (cached && new Date(cached.lastEditedAt) > new Date(server.updated_at)) {
      merged = cached
    } else {
      merged = {
        ...emptyCase(),
        permitId: server.id,
        registrationNo: server.dev_register_no || server.id.slice(0, 13).toUpperCase(),
        fileRef: `file/${server.dev_register_no || server.id}`,
        applicant: { name: server.applicant_name, idNumber: server.applicant_id_number,
                     phone: server.applicant_phone ?? '', email: server.applicant_email ?? '' },
        property:  { standNo: server.stand_number, ward: server.suburb_ward,
                     description: server.description ?? '', titleDeedNo: '' },
        proposal:  { devType: server.development_type as DevType,
                     description: server.description ?? '',
                     estimatedCost: 0, plinthArea: 0, floors: 1, parkingBays: 0 },
        intake:    { feePaid: server.fee_paid, feeReceiptNo: '', feeAmount: 0,
                     copiesSubmitted: 3, titleDeedAttached: true, bondholderConsent: false },
        classification: 'routine_26_1',
        applicationDate: server.created_at,
        acknowledgedDate: server.received_at,
        expiryDate: null,
        // Merge cached drafts for fields with no server home.
        dueDiligence:    cached?.dueDiligence    ?? emptyCase().dueDiligence,
        committeeReport: cached?.committeeReport ?? emptyCase().committeeReport,
        permit:          cached?.permit          ?? emptyCase().permit,
        notices:         cached?.notices         ?? emptyCase().notices,
        lastEditedAt: server.updated_at,
      }
    }
  } catch {
    if (cached) { merged = cached; syncPending.value = true }
    else throw new Error('Could not load permit')
  }
  current.value = merged
  writeLocal(merged)
  pushRecent(merged)
}

function save() {
  if (!current.value) return
  current.value.lastEditedAt = new Date().toISOString()
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    if (current.value) writeLocal(current.value)
    void flushRetryQueue()
  }, 800)
}
```

- [ ] **Step 3: Add beforeunload + concurrent-edit guard**

After defining `save` and `clear` inside `providePlannerCase()`, add:

```ts
function beforeUnload(e: BeforeUnloadEvent) {
  if (retryQueue.length || saveTimer) {
    e.preventDefault()
    e.returnValue = ''
  }
}

function onWindowFocus() {
  const c = current.value
  if (!c?.permitId) return
  const cached = readLocal(c.permitId)
  if (!cached) return
  if (new Date(cached.lastEditedAt) > new Date(c.lastEditedAt)) {
    // Another tab wrote a newer version. Reload it.
    current.value = cached
  }
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', beforeUnload)
  window.addEventListener('focus', onWindowFocus)
  onScopeDispose(() => {
    window.removeEventListener('beforeunload', beforeUnload)
    window.removeEventListener('focus', onWindowFocus)
  })
}
```

- [ ] **Step 4: Typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | grep -E "composables/usePlannerCase" | head -10`

Expected: no new errors.

- [ ] **Step 5: Re-run all composable tests**

Run: `npx vitest run src/views/planner/__tests__/planner-composables.spec.ts`

Expected: 14 passes. The seedCase fixture pre-sets `permitId='PMT-1'`, so the dmApi branch in `registerNew` is bypassed in tests.

- [ ] **Step 6: Commit**

```bash
git add src/composables/usePlannerCase.ts
git commit -m "feat(planner): wire usePlannerCase to dmApi + localStorage + retry queue + cross-tab guard"
```

---

## Phase 3 — Step components (bottom-up)

Build presentational components. Each consumes `usePlannerCase` and renders one step of the workflow. Order matches the spec's "easiest first / unblocks downstream" principle.

### Task 7: StatutoryClockBanner — 12-week timeline strip

**Files:**
- Modify: `src/views/planner/StatutoryClockBanner.vue`

- [ ] **Step 1: Implement the banner**

Replace the stub contents of `StatutoryClockBanner.vue`:

```vue
<script setup lang="ts">
import { computed } from 'vue'
import { useStatutoryClock } from '@/composables/useStatutoryClock'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { AlertTriangle, AlertOctagon, Clock } from 'lucide-vue-next'

const { current } = usePlannerCase()
const ackRef = computed(() => current.value?.acknowledgedDate ?? null)
const { state, weekMilestones } = useStatutoryClock(ackRef)

const milestones = weekMilestones()
const progressPct = computed(() => Math.min(100, (state.value.daysElapsed / 90) * 100))

const pillLabel = computed(() => {
  if (state.value.phase === 'pre_ack') return 'Awaiting acknowledgement'
  if (state.value.phase === 'deemed_refused') return 'DEEMED REFUSED'
  if (state.value.phase === 'completed') return 'Permit issued'
  return `${state.value.daysRemaining} days left`
})
</script>

<template>
  <div v-if="current" class="clock-banner" :class="'lvl-' + state.warningLevel">
    <div class="cb-track">
      <div class="cb-fill" :style="{ width: progressPct + '%' }"></div>
      <div v-for="m in milestones" :key="m.week" class="cb-tick" :style="{ left: (m.week / 12 * 100) + '%' }">
        <span class="cb-tick-label">{{ m.label }}</span>
      </div>
    </div>
    <div class="cb-pill">
      <AlertOctagon v-if="state.warningLevel === 'critical'" :size="13" />
      <AlertTriangle v-else-if="state.warningLevel === 'urgent' || state.warningLevel === 'caution'" :size="13" />
      <Clock v-else :size="13" />
      <span>{{ pillLabel }}</span>
    </div>
  </div>
</template>

<style scoped>
.clock-banner { display:flex; align-items:center; gap:0.75rem;
  padding:0.6rem 1rem; background:#f8fafc; border-bottom:1px solid #e2e8f0; }
.cb-track { flex:1; position:relative; height:6px; background:#e2e8f0; border-radius:9999px; }
.cb-fill { position:absolute; left:0; top:0; height:100%; background:#22c55e;
  border-radius:9999px; transition:width 0.4s ease; }
.lvl-caution  .cb-fill { background:#facc15; }
.lvl-urgent   .cb-fill { background:#fb923c; }
.lvl-critical .cb-fill { background:#dc2626; }
.cb-tick { position:absolute; top:-6px; width:2px; height:18px; background:#94a3b8; }
.cb-tick-label { position:absolute; top:20px; left:50%; transform:translateX(-50%);
  font-size:0.6rem; color:#64748b; white-space:nowrap; }
.cb-pill { display:inline-flex; align-items:center; gap:0.35rem;
  padding:0.3rem 0.7rem; border-radius:9999px;
  background:#0f172a; color:#fff; font-size:0.75rem; font-weight:700; white-space:nowrap; }
.lvl-caution  .cb-pill { background:#b45309; }
.lvl-urgent   .cb-pill { background:#c2410c; }
.lvl-critical .cb-pill { background:#dc2626; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/planner/StatutoryClockBanner.vue
git commit -m "feat(planner): StatutoryClockBanner with progress + warning pills"
```

---

### Task 8: Step1Intake — register new + intake queue

**Files:**
- Modify: `src/views/planner/Step1Intake.vue`

- [ ] **Step 1: Implement Step1Intake.vue**

Replace stub with:

```vue
<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { dmApi, type PermitApplication } from '@/services/developmentManagementService'
import { usePlannerCase, type Classification, type DevType } from '@/composables/usePlannerCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import FieldError from './FieldError.vue'
import { Search, FilePlus2, FileText, RefreshCw } from 'lucide-vue-next'

const { current, registerNew, loadFromPermit } = usePlannerCase()
const fb = useUiFeedback()

const queue = ref<PermitApplication[]>([])
const loading = ref(false)
const search = ref('')

async function refreshQueue() {
  loading.value = true
  try {
    const res = await dmApi.listPermits({ status: 'registered', search: search.value.trim(), limit: 50, offset: 0 })
    queue.value = res.data
  } catch (e: any) {
    fb.showToast(fb.parseApiError(e, 'Could not load intake queue'), 'error')
  } finally {
    loading.value = false
  }
}

onMounted(refreshQueue)

const form = ref({
  applicantName: '', applicantIdNumber: '', applicantPhone: '', applicantEmail: '',
  standNo: '', ward: 'Ward 1', propertyDescription: '', titleDeedNo: '',
  devType: 'residential' as DevType, proposalDescription: '', estimatedCost: 0,
  plinthArea: 0, floors: 1, parkingBays: 1,
  feePaid: false, feeReceiptNo: '', feeAmount: 46,
  copiesSubmitted: 3, titleDeedAttached: false, bondholderConsent: false,
  classification: 'routine_26_1' as Classification,
})
const submitting = ref(false)
const errors = ref<Record<string, string>>({})

function validate(): boolean {
  const e: Record<string, string> = {}
  if (!form.value.applicantName.trim())     e.applicantName     = 'Applicant name is required'
  if (!form.value.applicantIdNumber.trim()) e.applicantIdNumber = 'Applicant ID number is required'
  if (!form.value.standNo.trim())           e.standNo           = 'Stand number is required'
  if (!form.value.feePaid)                  e.feePaid           = 'Application fee must be paid'
  if (form.value.copiesSubmitted < 3)       e.copiesSubmitted   = 'At least 3 copies of plans required'
  if (form.value.classification !== 'preliminary' && !form.value.titleDeedAttached) {
    e.titleDeedAttached = 'Title deed must be attached for non-preliminary applications'
  }
  errors.value = e
  return Object.keys(e).length === 0
}

async function onSubmit() {
  if (!validate()) {
    fb.openMessageBox({ kind: 'error', title: 'Application incomplete',
      message: 'Please correct the highlighted fields before submitting.' })
    return
  }
  submitting.value = true
  try {
    const now = new Date()
    const yy = now.getUTCFullYear()
    const seq = String(queue.value.length + 49).padStart(4, '0')
    await registerNew({
      registrationNo: `VR-${yy}-${seq}`,
      applicant: { name: form.value.applicantName, idNumber: form.value.applicantIdNumber,
                   phone: form.value.applicantPhone, email: form.value.applicantEmail },
      property:  { standNo: form.value.standNo, ward: form.value.ward,
                   description: form.value.propertyDescription, titleDeedNo: form.value.titleDeedNo },
      proposal:  { devType: form.value.devType, description: form.value.proposalDescription,
                   estimatedCost: form.value.estimatedCost, plinthArea: form.value.plinthArea,
                   floors: form.value.floors, parkingBays: form.value.parkingBays },
      intake:    { feePaid: form.value.feePaid, feeReceiptNo: form.value.feeReceiptNo,
                   feeAmount: form.value.feeAmount, copiesSubmitted: form.value.copiesSubmitted,
                   titleDeedAttached: form.value.titleDeedAttached,
                   bondholderConsent: form.value.bondholderConsent },
      classification: form.value.classification,
      applicationDate: now.toISOString(),
    })
    fb.showToast(`Application ${current.value?.registrationNo} registered`, 'success')
    await refreshQueue()
  } catch (e: any) {
    fb.openMessageBox({ kind: 'error', title: 'Could not register application',
      message: fb.parseApiError(e, 'The server rejected the application.') })
  } finally {
    submitting.value = false
  }
}

const showRegisterForm = ref(true)
</script>

<template>
  <div class="step1">
    <section class="iq-card">
      <header class="iq-head">
        <h3>Intake queue</h3>
        <div class="iq-search">
          <Search :size="12" />
          <input v-model="search" placeholder="Filter by ref, stand, applicant" @keyup.enter="refreshQueue" />
        </div>
        <button class="iq-refresh" @click="refreshQueue" :disabled="loading">
          <RefreshCw :size="12" :class="{ spinning: loading }" /> Refresh
        </button>
      </header>
      <div v-if="loading" class="iq-empty">Loading…</div>
      <div v-else-if="!queue.length" class="iq-empty">No pending applications.</div>
      <div v-else class="iq-list">
        <button v-for="p in queue" :key="p.id" class="iq-row" @click="loadFromPermit(p.id)">
          <FileText :size="12" />
          <span class="iq-row-id">{{ p.dev_register_no || p.id.slice(0, 13) }}</span>
          <span class="iq-row-app">{{ p.applicant_name }}</span>
          <span class="iq-row-ward">{{ p.suburb_ward }}</span>
        </button>
      </div>
    </section>

    <section class="rf-card">
      <header class="rf-head" @click="showRegisterForm = !showRegisterForm">
        <FilePlus2 :size="13" />
        <h3>Register new application</h3>
      </header>
      <form v-if="showRegisterForm" class="rf-body" @submit.prevent="onSubmit">
        <fieldset>
          <legend>Applicant</legend>
          <div class="rf-grid">
            <label>Name *<input v-model="form.applicantName" :class="{ err: errors.applicantName }" /></label>
            <FieldError :message="errors.applicantName" />
            <label>ID number *<input v-model="form.applicantIdNumber" :class="{ err: errors.applicantIdNumber }" /></label>
            <FieldError :message="errors.applicantIdNumber" />
            <label>Phone<input v-model="form.applicantPhone" /></label>
            <label>Email<input v-model="form.applicantEmail" type="email" /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Property</legend>
          <div class="rf-grid">
            <label>Stand no. *<input v-model="form.standNo" :class="{ err: errors.standNo }" /></label>
            <FieldError :message="errors.standNo" />
            <label>Ward<input v-model="form.ward" /></label>
            <label class="rf-wide">Description<input v-model="form.propertyDescription" /></label>
            <label class="rf-wide">Title deed no.<input v-model="form.titleDeedNo" /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Proposal</legend>
          <div class="rf-grid">
            <label>Type
              <select v-model="form.devType">
                <option value="residential">Residential</option>
                <option value="commercial">Commercial</option>
                <option value="industrial">Industrial</option>
                <option value="agricultural">Agricultural</option>
                <option value="institutional">Institutional</option>
                <option value="subdivision">Subdivision</option>
                <option value="change_of_use">Change of use</option>
                <option value="advertisement">Advertisement</option>
                <option value="other">Other</option>
              </select>
            </label>
            <label>Estimated cost (USD)<input v-model.number="form.estimatedCost" type="number" min="0" /></label>
            <label>Plinth area (m²)<input v-model.number="form.plinthArea" type="number" min="0" /></label>
            <label>Floors<input v-model.number="form.floors" type="number" min="1" /></label>
            <label>Parking bays<input v-model.number="form.parkingBays" type="number" min="0" /></label>
            <label class="rf-wide">Description<textarea v-model="form.proposalDescription" rows="3" /></label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Intake checks</legend>
          <div class="rf-grid">
            <label class="rf-check"><input type="checkbox" v-model="form.feePaid" /> Application fee paid</label>
            <FieldError :message="errors.feePaid" />
            <label>Receipt no.<input v-model="form.feeReceiptNo" /></label>
            <label>Fee amount (USD)<input v-model.number="form.feeAmount" type="number" min="0" /></label>
            <label>Copies of plans submitted<input v-model.number="form.copiesSubmitted" type="number" min="0" /></label>
            <FieldError :message="errors.copiesSubmitted" />
            <label class="rf-check"><input type="checkbox" v-model="form.titleDeedAttached" /> Title deed attached</label>
            <FieldError :message="errors.titleDeedAttached" />
            <label class="rf-check"><input type="checkbox" v-model="form.bondholderConsent" /> Bondholder consent attached</label>
          </div>
        </fieldset>
        <fieldset>
          <legend>Classification (Section 26)</legend>
          <div class="rf-radios">
            <label><input type="radio" v-model="form.classification" value="routine_26_1" /> Routine permit (26(1))</label>
            <label><input type="radio" v-model="form.classification" value="special_consent_26_3" /> Special Consent (26(3))</label>
            <label><input type="radio" v-model="form.classification" value="preliminary" /> Preliminary planning inquiry</label>
            <label><input type="radio" v-model="form.classification" value="change_of_use" /> Change of use</label>
            <label><input type="radio" v-model="form.classification" value="building_ops" /> Building operations / additions</label>
            <label><input type="radio" v-model="form.classification" value="mining" /> Mining / quarrying</label>
          </div>
        </fieldset>
        <button type="submit" class="rf-submit" :disabled="submitting">
          {{ submitting ? 'Registering…' : 'Register & start statutory clock at acknowledgement' }}
        </button>
      </form>
    </section>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.step1 { display:flex; flex-direction:column; gap:0.75rem; padding:0.75rem; }
.iq-card, .rf-card { border:1px solid #e2e8f0; border-radius:0.5rem; background:#fff; }
.iq-head, .rf-head { display:flex; align-items:center; gap:0.5rem;
  padding:0.5rem 0.75rem; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
.iq-head h3, .rf-head h3 { margin:0; font-size:0.8125rem; flex:1; }
.iq-search { display:inline-flex; align-items:center; gap:0.3rem;
  border:1px solid #e2e8f0; border-radius:0.375rem; padding:0.2rem 0.4rem; background:#fff; }
.iq-search input { border:none; outline:none; font-size:0.75rem; width:11rem; }
.iq-refresh { display:inline-flex; align-items:center; gap:0.25rem;
  border:1px solid #e2e8f0; background:#fff; border-radius:0.375rem;
  padding:0.25rem 0.5rem; font-size:0.7rem; cursor:pointer; }
.spinning { animation:spin 0.8s linear infinite; }
@keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
.iq-empty { padding:0.75rem; font-size:0.75rem; color:#64748b; }
.iq-list { max-height:180px; overflow-y:auto; }
.iq-row { display:grid; grid-template-columns:auto 6.5rem 1fr 5rem; gap:0.4rem;
  align-items:center; width:100%; padding:0.4rem 0.6rem; background:#fff; border:none;
  border-top:1px solid #f1f5f9; font-size:0.7rem; text-align:left; cursor:pointer; }
.iq-row:hover { background:#f8fafc; }
.iq-row-id { font-family: ui-monospace, monospace; font-weight:600; color:#0f172a; }
.iq-row-app { color:#475569; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.iq-row-ward { color:#94a3b8; }
.rf-body { padding:0.75rem; display:flex; flex-direction:column; gap:0.75rem; }
.rf-body fieldset { border:1px solid #e2e8f0; border-radius:0.375rem;
  padding:0.5rem 0.75rem 0.75rem; }
.rf-body legend { font-size:0.7rem; color:#64748b; font-weight:600; padding:0 0.25rem; }
.rf-grid { display:grid; grid-template-columns: repeat(2, 1fr); gap:0.4rem 0.75rem; }
.rf-grid label { display:flex; flex-direction:column; gap:0.2rem; font-size:0.7rem; color:#475569; }
.rf-grid label.rf-wide { grid-column: 1 / -1; }
.rf-grid label.rf-check { flex-direction:row; align-items:center; gap:0.35rem; }
.rf-grid input, .rf-grid select, .rf-grid textarea {
  font-size:0.75rem; padding:0.3rem 0.45rem; border:1px solid #e2e8f0; border-radius:0.3rem;
  background:#fff; outline:none;
}
.rf-grid input.err { border-color:#dc2626; background:#fef2f2; }
.rf-radios { display:flex; flex-direction:column; gap:0.25rem; font-size:0.7rem; color:#475569; }
.rf-radios label { display:flex; align-items:center; gap:0.4rem; }
.rf-submit { margin-top:0.25rem; padding:0.5rem 0.75rem; border:none; border-radius:0.375rem;
  background:#1d4ed8; color:#fff; font-size:0.75rem; font-weight:700; cursor:pointer; }
.rf-submit:disabled { opacity:0.5; cursor:not-allowed; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/planner/Step1Intake.vue
git commit -m "feat(planner): Step 1 intake — queue + register form + validation"
```

---

### Task 9: Step5Notices — ack, deficiency, 26(3) advertising, objections, outcome letter

**Files:**
- Modify: `src/views/planner/Step5Notices.vue`

- [ ] **Step 1: Implement Step5Notices.vue**

```vue
<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { dmApi } from '@/services/developmentManagementService'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { Mail, AlertOctagon, Newspaper, FileWarning } from 'lucide-vue-next'

const { current, save } = usePlannerCase()
const fb = useUiFeedback()

const isSpecialConsent = computed(() =>
  current.value?.classification === 'special_consent_26_3')

function sendAck() {
  if (!current.value) return
  const now = new Date().toISOString()
  current.value.acknowledgedDate = now
  current.value.notices.ackSentAt = now
  const expiry = new Date(now); expiry.setUTCDate(expiry.getUTCDate() + 90)
  current.value.expiryDate = expiry.toISOString()
  save()
  fb.showToast('Acknowledgement issued — statutory clock started', 'success')
}

async function returnWithReasons() {
  const ok = await fb.confirmAction(
    'Return application with reasons',
    'This sends a deficiency letter and returns the file. The statutory clock will not start.',
    { confirmLabel: 'Return file', danger: true }
  )
  if (!ok || !current.value) return
  current.value.notices.ackReturnedAt = new Date().toISOString()
  save()
  fb.showToast('Deficiency letter recorded', 'warn')
}

const noticeDraft = ref({
  newspaper: '', publishedAt: '',
  abuttingOwnersRaw: '', proofUploadedAt: '',
})
function saveNotice() {
  if (!current.value) return
  current.value.notices.publicNotice = {
    newspaper: noticeDraft.value.newspaper,
    publishedAt: noticeDraft.value.publishedAt,
    abuttingOwners: noticeDraft.value.abuttingOwnersRaw.split('\n').map(s => s.trim()).filter(Boolean),
    proofUploadedAt: noticeDraft.value.proofUploadedAt || null,
  }
  save()
  fb.showToast('Public notice recorded', 'success')
}

const objections = computed(() => current.value?.notices.objections ?? [])
async function refreshObjections() {
  if (!current.value?.permitId) return
  try {
    const list = await dmApi.listObjections(current.value.permitId)
    current.value.notices.objections = list.map(o => ({
      id: o.id, objector: o.objector_name, grounds: o.grounds,
      receivedAt: o.received_at, officerView: '', resolvedAt: o.resolved_at,
    }))
    save()
  } catch (e: any) {
    fb.showToast(fb.parseApiError(e, 'Could not load objections'), 'error')
  }
}
onMounted(refreshObjections)

const newObjection = ref({ objector: '', grounds: '' })
async function addObjection() {
  if (!current.value?.permitId || !newObjection.value.objector.trim()) return
  try {
    await dmApi.createObjection(current.value.permitId, {
      objector_name: newObjection.value.objector,
      grounds: newObjection.value.grounds,
      received_at: new Date().toISOString(),
    } as any)
    newObjection.value = { objector: '', grounds: '' }
    await refreshObjections()
    fb.showToast('Objection logged', 'success')
  } catch (e: any) {
    fb.openMessageBox({ kind:'error', title:'Could not log objection',
      message: fb.parseApiError(e, 'The server rejected the objection.') })
  }
}

function sendOutcomeLetter() {
  if (!current.value) return
  current.value.notices.outcomeLetterSentAt = new Date().toISOString()
  save()
  fb.showToast('Outcome letter sent to applicant', 'success')
}
</script>

<template>
  <div v-if="current" class="step5">
    <section class="s5-card">
      <header><Mail :size="13" /> Acknowledgement letter (5-day deadline)</header>
      <div v-if="current.notices.ackSentAt" class="s5-done">
        Sent {{ new Date(current.notices.ackSentAt).toLocaleString() }}
      </div>
      <div v-else-if="current.notices.ackReturnedAt" class="s5-warn">
        File returned with reasons on {{ new Date(current.notices.ackReturnedAt).toLocaleDateString() }}
      </div>
      <div v-else class="s5-actions">
        <button class="s5-btn ok" @click="sendAck">Send acknowledgement</button>
        <button class="s5-btn warn" @click="returnWithReasons">Return with reasons</button>
      </div>
    </section>

    <section v-if="isSpecialConsent" class="s5-card">
      <header><Newspaper :size="13" /> Section 26(3) public notice</header>
      <div v-if="current.notices.publicNotice" class="s5-done">
        Published in <strong>{{ current.notices.publicNotice.newspaper }}</strong>
        on {{ current.notices.publicNotice.publishedAt }}.
        Abutting owners notified: {{ current.notices.publicNotice.abuttingOwners.length }}.
      </div>
      <div v-else class="s5-form">
        <label>Newspaper<input v-model="noticeDraft.newspaper" /></label>
        <label>Publication date<input type="date" v-model="noticeDraft.publishedAt" /></label>
        <label>Abutting owners (one per line)
          <textarea v-model="noticeDraft.abuttingOwnersRaw" rows="3" />
        </label>
        <label>Proof of publication uploaded at<input type="date" v-model="noticeDraft.proofUploadedAt" /></label>
        <button class="s5-btn ok" @click="saveNotice">Record notice</button>
      </div>
    </section>

    <section class="s5-card">
      <header><FileWarning :size="13" /> Objections ({{ objections.length }})</header>
      <ul v-if="objections.length" class="s5-obj-list">
        <li v-for="o in objections" :key="o.id">
          <strong>{{ o.objector }}</strong> — {{ o.grounds }}
          <span class="s5-obj-meta">{{ new Date(o.receivedAt).toLocaleDateString() }}</span>
        </li>
      </ul>
      <div v-else class="s5-empty">No objections recorded.</div>
      <div class="s5-form">
        <label>New objector<input v-model="newObjection.objector" /></label>
        <label>Grounds<textarea v-model="newObjection.grounds" rows="2" /></label>
        <button class="s5-btn ok" @click="addObjection" :disabled="!newObjection.objector.trim()">
          Log objection
        </button>
      </div>
    </section>

    <section class="s5-card">
      <header><AlertOctagon :size="13" /> Final outcome letter</header>
      <div v-if="current.notices.outcomeLetterSentAt" class="s5-done">
        Sent {{ new Date(current.notices.outcomeLetterSentAt).toLocaleString() }}
      </div>
      <div v-else class="s5-actions">
        <button class="s5-btn ok" @click="sendOutcomeLetter"
                :disabled="!current.committeeReport.resolutionAt">
          Send outcome letter
        </button>
        <span v-if="!current.committeeReport.resolutionAt" class="s5-hint">
          Record Council resolution in Step 3 first.
        </span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.step5 { display:flex; flex-direction:column; gap:0.6rem; padding:0.75rem; }
.s5-card { border:1px solid #e2e8f0; border-radius:0.5rem; background:#fff; }
.s5-card > header { display:flex; align-items:center; gap:0.35rem;
  padding:0.5rem 0.75rem; border-bottom:1px solid #e2e8f0; background:#f8fafc;
  font-size:0.8125rem; font-weight:600; color:#0f172a; }
.s5-done { padding:0.5rem 0.75rem; font-size:0.75rem; color:#166534; background:#f0fdf4; }
.s5-warn { padding:0.5rem 0.75rem; font-size:0.75rem; color:#92400e; background:#fffbeb; }
.s5-actions { padding:0.5rem 0.75rem; display:flex; gap:0.4rem; align-items:center; }
.s5-form { padding:0.5rem 0.75rem; display:flex; flex-direction:column; gap:0.35rem; }
.s5-form label { display:flex; flex-direction:column; gap:0.2rem; font-size:0.7rem; color:#475569; }
.s5-form input, .s5-form textarea { font-size:0.75rem; padding:0.3rem 0.45rem;
  border:1px solid #e2e8f0; border-radius:0.3rem; background:#fff; outline:none; }
.s5-btn { padding:0.35rem 0.7rem; font-size:0.72rem; font-weight:700;
  border:none; border-radius:0.3rem; cursor:pointer; }
.s5-btn.ok { background:#16a34a; color:#fff; }
.s5-btn.warn { background:#b45309; color:#fff; }
.s5-btn:disabled { opacity:0.5; cursor:not-allowed; }
.s5-obj-list { list-style:none; margin:0; padding:0.5rem 0.75rem;
  display:flex; flex-direction:column; gap:0.3rem; font-size:0.72rem; color:#475569; }
.s5-obj-list .s5-obj-meta { color:#94a3b8; font-size:0.65rem; margin-left:0.4rem; }
.s5-empty { padding:0.5rem 0.75rem; font-size:0.72rem; color:#94a3b8; }
.s5-hint { font-size:0.7rem; color:#64748b; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/planner/Step5Notices.vue
git commit -m "feat(planner): Step 5 notices — ack, deficiency, 26(3) advert, objections, outcome letter"
```

---

### Task 10: Step2DueDiligence — checklists + referrals

**Files:**
- Modify: `src/views/planner/Step2DueDiligence.vue`

- [ ] **Step 1: Implement Step2DueDiligence.vue**

```vue
<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { dmApi } from '@/services/developmentManagementService'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { CheckCircle2, XCircle, MinusCircle, Send } from 'lucide-vue-next'

const { current, save } = usePlannerCase()
const fb = useUiFeedback()

const FILE_CHECKS = [
  ['existing_use_rights',    'Existing use rights of the stand'],
  ['prior_applications',     'Previous applications, permits, refusals'],
  ['active_enforcement',     'Active enforcement / prohibition orders'],
  ['title_deed_restrictions','Title-deed restrictions on the property'],
] as const

const COMPAT_CHECKS = [
  ['zoning',                'Land-use zoning conformity'],
  ['conflict_of_use',       'Conflict of use (e.g. liquor next to school)'],
  ['multiple_stand_use',    'Multiple stand use within same use group'],
  ['layout_conformity',     'Conformity with approved layout (setback, density)'],
  ['traffic',               'Traffic circulation & access'],
  ['coordinated_dev',       'Coordinated development & services sequencing'],
  ['env_sensitivity',       'Environmental sensitivity (wetlands, water courses)'],
  ['public_health_adj',     'Public-health adjacency'],
] as const

const STATUTE_CHECKS = [
  ['rtcp',     'RTCP Act [Ch. 29:12] — permit requirements ss. 22/26/32/34/38'],
  ['uca',      'Urban Councils Act [Ch. 29:15] — by-law adoption'],
  ['health',   'Public Health Act [Ch. 15:09] — sanitation & hygiene'],
  ['by_laws',  'Model Building By-Laws (1977) — construction & sewerage'],
  ['factories','Factories & Works Act [Ch. 14:08] — factory plans (s. 9(4))'],
  ['liquor',   'Liquor Licensing Act [Ch. 14:12] — licensed premises'],
  ['atm',      'Atmospheric Pollution Prevention Act [Ch. 318]'],
  ['mines',    'Mines & Minerals Act [Ch. 21:05] — mining developments'],
  ['constitution','Constitution of Zimbabwe — due process / property rights'],
] as const

const DEPARTMENTS = [
  'Secretary for Health & Child Welfare',
  'Secretary for Environment & Tourism',
  'Lands & Water Resources',
  'Ministry of Lands',
  'ZESA (Electricity)',
  'ZINWA (Water)',
  'TelOne / Liquid (Telecoms)',
] as const

function ensureBuckets() {
  if (!current.value) return
  const dd = current.value.dueDiligence
  for (const [k] of FILE_CHECKS)    if (!dd.fileChecks[k])      dd.fileChecks[k]      = { result: null, notes: '' }
  for (const [k] of COMPAT_CHECKS)  if (!dd.compatibility[k])   dd.compatibility[k]   = { result: null, notes: '' }
  for (const [k] of STATUTE_CHECKS) if (!dd.statutoryChecks[k]) dd.statutoryChecks[k] = { result: null, notes: '' }
}
onMounted(ensureBuckets)

function setResult(bucket: 'fileChecks'|'compatibility'|'statutoryChecks', key: string, value: 'pass'|'fail'|'na') {
  if (!current.value) return
  current.value.dueDiligence[bucket][key] = { ...current.value.dueDiligence[bucket][key], result: value }
  save()
}

const referralPick = ref<string>('')
const referralResponse = ref('')
async function addReferral() {
  if (!current.value?.permitId || !referralPick.value) return
  try {
    const created = await dmApi.createConsultation(current.value.permitId, {
      department: referralPick.value,
      response: referralResponse.value,
      outcome: 'pending',
    } as any)
    current.value.dueDiligence.referrals.push({
      department: referralPick.value,
      contactedAt: created.contacted_at,
      response: referralResponse.value,
      outcome: 'pending',
    })
    referralPick.value = ''
    referralResponse.value = ''
    save()
    fb.showToast('Referral logged', 'success')
  } catch (e: any) {
    fb.openMessageBox({ kind:'error', title:'Could not log referral',
      message: fb.parseApiError(e, 'The server rejected the referral.') })
  }
}

const allChecksDone = computed(() => {
  if (!current.value) return false
  const dd = current.value.dueDiligence
  const setAll = (bucket: Record<string, { result: any }>) =>
    Object.values(bucket).every(v => v.result !== null)
  return setAll(dd.fileChecks) && setAll(dd.compatibility) && setAll(dd.statutoryChecks)
})

function markComplete() {
  if (!current.value) return
  if (!allChecksDone.value) {
    fb.openMessageBox({ kind:'warn', title:'Checks incomplete',
      message:'Every file / compatibility / statutory check must be marked Pass, Fail, or N/A before completion.' })
    return
  }
  current.value.dueDiligence.completedAt = new Date().toISOString()
  save()
  fb.showToast('Due diligence complete — Step 3 unlocked', 'success')
}
</script>

<template>
  <div v-if="current" class="step2">
    <section class="dd-card">
      <header>File checks</header>
      <table class="dd-table">
        <tr v-for="[key, label] in FILE_CHECKS" :key="key">
          <td class="dd-label">{{ label }}</td>
          <td class="dd-actions">
            <button :class="{ active: current.dueDiligence.fileChecks[key]?.result === 'pass' }"
                    @click="setResult('fileChecks', key, 'pass')"><CheckCircle2 :size="12" /> Pass</button>
            <button :class="{ active: current.dueDiligence.fileChecks[key]?.result === 'fail' }"
                    @click="setResult('fileChecks', key, 'fail')"><XCircle :size="12" /> Fail</button>
            <button :class="{ active: current.dueDiligence.fileChecks[key]?.result === 'na' }"
                    @click="setResult('fileChecks', key, 'na')"><MinusCircle :size="12" /> N/A</button>
          </td>
        </tr>
      </table>
    </section>

    <section class="dd-card">
      <header>Compatibility checks</header>
      <table class="dd-table">
        <tr v-for="[key, label] in COMPAT_CHECKS" :key="key">
          <td class="dd-label">{{ label }}</td>
          <td class="dd-actions">
            <button :class="{ active: current.dueDiligence.compatibility[key]?.result === 'pass' }"
                    @click="setResult('compatibility', key, 'pass')">Pass</button>
            <button :class="{ active: current.dueDiligence.compatibility[key]?.result === 'fail' }"
                    @click="setResult('compatibility', key, 'fail')">Fail</button>
            <button :class="{ active: current.dueDiligence.compatibility[key]?.result === 'na' }"
                    @click="setResult('compatibility', key, 'na')">N/A</button>
          </td>
        </tr>
      </table>
    </section>

    <section class="dd-card">
      <header>Statutory provisions</header>
      <table class="dd-table">
        <tr v-for="[key, label] in STATUTE_CHECKS" :key="key">
          <td class="dd-label">{{ label }}</td>
          <td class="dd-actions">
            <button :class="{ active: current.dueDiligence.statutoryChecks[key]?.result === 'pass' }"
                    @click="setResult('statutoryChecks', key, 'pass')">Compliant</button>
            <button :class="{ active: current.dueDiligence.statutoryChecks[key]?.result === 'fail' }"
                    @click="setResult('statutoryChecks', key, 'fail')">Non-compliant</button>
            <button :class="{ active: current.dueDiligence.statutoryChecks[key]?.result === 'na' }"
                    @click="setResult('statutoryChecks', key, 'na')">N/A</button>
          </td>
        </tr>
      </table>
    </section>

    <section class="dd-card">
      <header>Title-deed verification</header>
      <label class="dd-check"><input type="checkbox" v-model="current.dueDiligence.titleDeedConflict.hasConflict" @change="save" /> Proposal conflicts with title-deed conditions</label>
      <div v-if="current.dueDiligence.titleDeedConflict.hasConflict" class="dd-conflict">
        <label>Deed photostat filename<input v-model="current.dueDiligence.titleDeedConflict.deedFileName" @change="save" /></label>
        <label class="dd-check"><input type="checkbox" v-model="current.dueDiligence.titleDeedConflict.bondholderConsentReceived" @change="save" /> Bondholder consent received</label>
      </div>
    </section>

    <section class="dd-card">
      <header>External referrals</header>
      <ul class="dd-ref-list">
        <li v-for="(r, i) in current.dueDiligence.referrals" :key="i">
          <strong>{{ r.department }}</strong> — {{ r.outcome }} ({{ new Date(r.contactedAt).toLocaleDateString() }})
        </li>
      </ul>
      <div class="dd-ref-add">
        <select v-model="referralPick">
          <option value="">— Select department —</option>
          <option v-for="d in DEPARTMENTS" :key="d" :value="d">{{ d }}</option>
        </select>
        <input v-model="referralResponse" placeholder="Initial response (optional)" />
        <button class="dd-btn ok" :disabled="!referralPick" @click="addReferral"><Send :size="11" /> Log referral</button>
      </div>
    </section>

    <button class="dd-complete" :disabled="!allChecksDone" @click="markComplete">
      {{ allChecksDone ? 'Due diligence complete — unlock Step 3' : 'Mark every check to enable' }}
    </button>
  </div>
</template>

<style scoped>
.step2 { display:flex; flex-direction:column; gap:0.6rem; padding:0.75rem; }
.dd-card { border:1px solid #e2e8f0; border-radius:0.5rem; background:#fff; }
.dd-card > header { padding:0.5rem 0.75rem; font-size:0.8125rem; font-weight:600; color:#0f172a;
  border-bottom:1px solid #e2e8f0; background:#f8fafc; }
.dd-table { width:100%; border-collapse:collapse; font-size:0.72rem; }
.dd-table td { padding:0.35rem 0.6rem; border-top:1px solid #f1f5f9; vertical-align:middle; }
.dd-label { color:#475569; }
.dd-actions { display:flex; gap:0.25rem; justify-content:flex-end; }
.dd-actions button { display:inline-flex; align-items:center; gap:0.25rem;
  border:1px solid #e2e8f0; background:#fff; color:#475569;
  border-radius:0.3rem; padding:0.2rem 0.5rem; font-size:0.7rem; cursor:pointer; }
.dd-actions button.active { background:#1d4ed8; color:#fff; border-color:#1d4ed8; }
.dd-check { display:flex; align-items:center; gap:0.4rem;
  padding:0.5rem 0.75rem; font-size:0.72rem; color:#475569; }
.dd-conflict { display:flex; flex-direction:column; gap:0.3rem; padding:0 0.75rem 0.75rem; }
.dd-conflict label { display:flex; flex-direction:column; gap:0.2rem; font-size:0.7rem; color:#475569; }
.dd-conflict input { font-size:0.72rem; padding:0.3rem 0.45rem;
  border:1px solid #e2e8f0; border-radius:0.3rem; background:#fff; }
.dd-ref-list { list-style:none; padding:0.5rem 0.75rem; margin:0;
  display:flex; flex-direction:column; gap:0.25rem; font-size:0.72rem; color:#475569; }
.dd-ref-add { padding:0.5rem 0.75rem; display:flex; gap:0.3rem; }
.dd-ref-add select, .dd-ref-add input { font-size:0.7rem; padding:0.3rem 0.45rem;
  border:1px solid #e2e8f0; border-radius:0.3rem; background:#fff; }
.dd-ref-add input { flex:1; }
.dd-btn { display:inline-flex; align-items:center; gap:0.2rem;
  background:#16a34a; color:#fff; border:none; border-radius:0.3rem;
  padding:0.3rem 0.55rem; font-size:0.7rem; font-weight:700; cursor:pointer; }
.dd-btn:disabled { opacity:0.5; cursor:not-allowed; }
.dd-complete { margin:0.5rem 0.75rem 0; padding:0.5rem 0.75rem;
  border:none; border-radius:0.375rem; background:#1d4ed8; color:#fff;
  font-size:0.75rem; font-weight:700; cursor:pointer; }
.dd-complete:disabled { background:#94a3b8; cursor:not-allowed; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/planner/Step2DueDiligence.vue
git commit -m "feat(planner): Step 2 due diligence — 4 file / 8 compat / 9 statutory checks + referrals"
```

---

### Task 11: Step3CommitteeReport — drafter + PDF export + resolution

**Files:**
- Modify: `src/views/planner/Step3CommitteeReport.vue`

- [ ] **Step 1: Implement Step3CommitteeReport.vue**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import jsPDF from 'jspdf'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { dmApi } from '@/services/developmentManagementService'
import { Download, Gavel } from 'lucide-vue-next'

const { current, save } = usePlannerCase()
const fb = useUiFeedback()

const ddSummary = computed(() => {
  if (!current.value) return ''
  const dd = current.value.dueDiligence
  const failed: string[] = []
  for (const [k, v] of Object.entries(dd.fileChecks))      if (v.result === 'fail') failed.push(`file/${k}`)
  for (const [k, v] of Object.entries(dd.compatibility))   if (v.result === 'fail') failed.push(`compat/${k}`)
  for (const [k, v] of Object.entries(dd.statutoryChecks)) if (v.result === 'fail') failed.push(`statute/${k}`)
  return failed.length
    ? `${failed.length} non-conformance(s) flagged: ${failed.join(', ')}.`
    : 'All due-diligence checks pass with no flagged non-conformances.'
})

function exportPdf() {
  if (!current.value) return
  const c = current.value
  const doc = new jsPDF()
  let y = 14
  const line = (s: string, bold = false) => {
    if (bold) doc.setFont('helvetica', 'bold'); else doc.setFont('helvetica', 'normal')
    doc.text(s, 14, y); y += 6
  }
  doc.setFontSize(13); line(`Works & Planning Committee Report — ${c.registrationNo}`, true)
  doc.setFontSize(10)
  line(`Applicant: ${c.applicant.name}   ID: ${c.applicant.idNumber}`)
  line(`Stand: ${c.property.standNo}   Ward: ${c.property.ward}`)
  line(`Dev type: ${c.proposal.devType}   Estimated cost: USD ${c.proposal.estimatedCost}`)
  line(`Application: ${c.applicationDate.slice(0,10)}   Ack: ${c.acknowledgedDate?.slice(0,10) ?? '—'}`)
  y += 2
  line('Site context', true)
  doc.text(doc.splitTextToSize(c.committeeReport.siteContext || '—', 180), 14, y); y += 18
  line('Policy & statutory analysis', true)
  doc.text(doc.splitTextToSize(c.committeeReport.policyAnalysis || ddSummary.value, 180), 14, y); y += 22
  line('Public response', true)
  doc.text(doc.splitTextToSize(c.committeeReport.publicResponseNotes || '—', 180), 14, y); y += 18
  line(`Recommendation: ${c.committeeReport.recommendation}`, true)
  doc.text(doc.splitTextToSize(c.committeeReport.recommendationReasons || '—', 180), 14, y); y += 18
  if (c.committeeReport.resolutionAt) {
    line(`Council resolution: ${c.committeeReport.resolutionAt.slice(0,10)}`, true)
    doc.text(doc.splitTextToSize(c.committeeReport.resolutionText || '—', 180), 14, y)
  }
  doc.save(`committee-report-${c.registrationNo}.pdf`)
  fb.showToast('Report exported', 'success')
}

async function recordResolution() {
  if (!current.value?.permitId) return
  current.value.committeeReport.resolutionAt = new Date().toISOString()
  const rec = current.value.committeeReport.recommendation
  const newStatus = rec === 'approve' ? 'approved'
                  : rec === 'approve_modified' ? 'conditionally_approved'
                  : rec === 'refuse' ? 'refused'
                  : 'under_review'
  try {
    await dmApi.setPermitStatus(current.value.permitId, newStatus as any,
      current.value.committeeReport.resolutionText || `Resolution: ${rec}`)
    save()
    fb.showToast(`Council resolution recorded (${rec})`, 'success')
  } catch (e: any) {
    fb.openMessageBox({ kind:'error', title:'Could not record resolution',
      message: fb.parseApiError(e, 'Server rejected the status update.') })
  }
}
</script>

<template>
  <div v-if="current" class="step3">
    <section class="r3-card">
      <header>Application particulars</header>
      <dl class="r3-dl">
        <dt>Reg no</dt><dd>{{ current.registrationNo }}</dd>
        <dt>Applicant</dt><dd>{{ current.applicant.name }} ({{ current.applicant.idNumber }})</dd>
        <dt>Stand</dt><dd>{{ current.property.standNo }} — {{ current.property.ward }}</dd>
        <dt>Type</dt><dd>{{ current.proposal.devType }}, USD {{ current.proposal.estimatedCost }}</dd>
        <dt>Ack date</dt><dd>{{ current.acknowledgedDate?.slice(0,10) || '—' }}</dd>
        <dt>Expiry</dt><dd>{{ current.expiryDate?.slice(0,10) || '—' }}</dd>
      </dl>
    </section>

    <section class="r3-card">
      <header>Site context</header>
      <textarea v-model="current.committeeReport.siteContext" rows="3" @change="save"
        placeholder="Surrounding land uses, existing services, environmental features…" />
    </section>

    <section class="r3-card">
      <header>Policy & statutory analysis</header>
      <p class="r3-prefill">From Step 2: {{ ddSummary }}</p>
      <textarea v-model="current.committeeReport.policyAnalysis" rows="4" @change="save"
        placeholder="Officer's analysis of conformity with the approved Master/Local Plan…" />
    </section>

    <section class="r3-card">
      <header>Public response</header>
      <textarea v-model="current.committeeReport.publicResponseNotes" rows="3" @change="save"
        placeholder="Summary of objections, applicant's response, officer's view…" />
    </section>

    <section class="r3-card">
      <header>Recommendation</header>
      <div class="r3-radios">
        <label><input type="radio" v-model="current.committeeReport.recommendation" value="approve" @change="save" /> Approve</label>
        <label><input type="radio" v-model="current.committeeReport.recommendation" value="approve_modified" @change="save" /> Approve with modifications</label>
        <label><input type="radio" v-model="current.committeeReport.recommendation" value="refuse" @change="save" /> Refuse</label>
        <label><input type="radio" v-model="current.committeeReport.recommendation" value="defer" @change="save" /> Defer</label>
      </div>
      <textarea v-model="current.committeeReport.recommendationReasons" rows="3" @change="save"
        placeholder="Planning reasons (not personal/political) for the recommendation…" />
    </section>

    <section class="r3-card">
      <header>Council resolution</header>
      <label>Tabled at<input type="date" v-model="current.committeeReport.tabledAt" @change="save" /></label>
      <textarea v-model="current.committeeReport.resolutionText" rows="2" @change="save"
        placeholder="Council resolution text…" />
      <button class="r3-resolve" @click="recordResolution"
              :disabled="!!current.committeeReport.resolutionAt">
        <Gavel :size="12" />
        {{ current.committeeReport.resolutionAt
            ? `Resolved on ${current.committeeReport.resolutionAt.slice(0,10)}`
            : 'Record resolution' }}
      </button>
    </section>

    <button class="r3-export" @click="exportPdf"><Download :size="12" /> Export to PDF</button>
  </div>
</template>

<style scoped>
.step3 { display:flex; flex-direction:column; gap:0.6rem; padding:0.75rem; }
.r3-card { border:1px solid #e2e8f0; border-radius:0.5rem; background:#fff; }
.r3-card > header { padding:0.5rem 0.75rem; font-size:0.8125rem; font-weight:600;
  color:#0f172a; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
.r3-card textarea, .r3-card input { width:calc(100% - 1.5rem); margin:0.5rem 0.75rem;
  font-size:0.72rem; padding:0.4rem 0.55rem; border:1px solid #e2e8f0;
  border-radius:0.3rem; background:#fff; outline:none; box-sizing:border-box; }
.r3-dl { display:grid; grid-template-columns:6rem 1fr; gap:0.3rem 0.75rem;
  margin:0.5rem 0.75rem 0.75rem; font-size:0.72rem; }
.r3-dl dt { color:#94a3b8; }
.r3-dl dd { margin:0; color:#0f172a; }
.r3-prefill { margin:0.5rem 0.75rem; padding:0.4rem 0.55rem; font-size:0.7rem;
  background:#eff6ff; color:#1e3a8a; border-radius:0.3rem; }
.r3-radios { display:flex; flex-wrap:wrap; gap:0.6rem;
  padding:0.5rem 0.75rem; font-size:0.72rem; color:#475569; }
.r3-radios label { display:inline-flex; align-items:center; gap:0.3rem; }
.r3-resolve { display:inline-flex; align-items:center; gap:0.3rem;
  margin:0.5rem 0.75rem 0.75rem; padding:0.35rem 0.6rem;
  border:none; border-radius:0.3rem; background:#1d4ed8; color:#fff;
  font-size:0.72rem; font-weight:700; cursor:pointer; }
.r3-resolve:disabled { background:#16a34a; cursor:default; }
.r3-export { display:inline-flex; align-items:center; justify-content:center; gap:0.3rem;
  margin:0 0.75rem; padding:0.5rem; border:1px solid #e2e8f0; background:#fff;
  color:#475569; border-radius:0.375rem; font-size:0.72rem; font-weight:700; cursor:pointer; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/planner/Step3CommitteeReport.vue
git commit -m "feat(planner): Step 3 committee report drafter with PDF export + resolution"
```

---

### Task 12: Step4PermitDrafting — conditions builder + 5-test gating + Annexure 7

**Files:**
- Modify: `src/views/planner/Step4PermitDrafting.vue`

- [ ] **Step 1: Implement Step4PermitDrafting.vue**

```vue
<script setup lang="ts">
import { computed } from 'vue'
import jsPDF from 'jspdf'
import { useAuthStore } from '@/stores/auth'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useConditionLibrary, type ConditionCategory } from '@/composables/useConditionLibrary'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { dmApi } from '@/services/developmentManagementService'
import { Plus, Trash2, FileSignature } from 'lucide-vue-next'

const { current, save } = usePlannerCase()
const fb = useUiFeedback()
const auth = useAuthStore()
const { templates, addFromTemplate, passesAllTests } = useConditionLibrary()

const TESTS = [
  ['necessity',       'Necessary'],
  ['relevance',       'Relevant to planning'],
  ['enforceability',  'Enforceable'],
  ['precision',       'Precise / unambiguous'],
  ['reasonableness',  'Reasonable / proportionate'],
] as const

function addCondition(key: ConditionCategory) {
  if (!current.value) return
  current.value.permit.conditions.push(addFromTemplate(key))
  save()
}
function removeCondition(idx: number) {
  if (!current.value) return
  current.value.permit.conditions.splice(idx, 1)
  save()
}

const ANNEXURE7_DEFAULT = `Notes attached to this Permit:
• You have a right of appeal to the Administrative Court within one (1) month of issue.
• Any action taken on this permit during the appeal window is at your own risk.
• Amendments may be applied for under Section 26(12) of the RTCP Act [Ch. 29:12].
• This permit expires 12 months from issue if substantial work has not commenced.
• The permit runs with the land; subsequent owners inherit its rights and obligations.`

function ensureDefaults() {
  if (!current.value) return
  if (!current.value.permit.annexure7Notes) {
    current.value.permit.annexure7Notes = ANNEXURE7_DEFAULT
  }
  if (!current.value.permit.permitNo) {
    current.value.permit.permitNo = `PERM-${current.value.registrationNo.replace(/^VR-/, '')}`
  }
  if (!current.value.permit.issuingOfficer && auth.user) {
    current.value.permit.issuingOfficer = auth.user.email || ''
  }
}
ensureDefaults()

const canIssue = computed(() => {
  if (!current.value) return false
  const p = current.value.permit
  return p.useClass !== ''
      && p.permittedDescription.trim().length > 20
      && p.conditions.length >= 1
      && p.conditions.every(passesAllTests)
      && p.permitNo.trim().length > 0
      && p.issuingOfficer.trim().length > 0
})

const failingConditions = computed(() =>
  (current.value?.permit.conditions ?? []).filter(c => !passesAllTests(c)))

async function issuePermit() {
  if (!current.value?.permitId) return
  if (!canIssue.value) {
    const fails = failingConditions.value.map(c => c.text.slice(0, 40) + '…').join('\n')
    fb.openMessageBox({ kind:'error', title:'Conditions do not meet the 5 legal tests',
      message:'Every condition must pass all five tests before the permit can be issued.',
      details: fails ? `Failing conditions:\n${fails}` : undefined })
    return
  }
  try {
    await dmApi.setPermitStatus(current.value.permitId, 'approved' as any,
      `Permit ${current.value.permit.permitNo} issued by ${current.value.permit.issuingOfficer}`)
    current.value.permit.issueDate = new Date().toISOString()
    save()
    fb.showToast(`Permit ${current.value.permit.permitNo} issued`, 'success')
    exportPermitPdf()
  } catch (e: any) {
    fb.openMessageBox({ kind:'error', title:'Could not issue permit',
      message: fb.parseApiError(e, 'Server rejected the permit issue.') })
  }
}

function exportPermitPdf() {
  if (!current.value) return
  const c = current.value
  const doc = new jsPDF()
  let y = 14
  const line = (s: string, bold = false) => {
    if (bold) doc.setFont('helvetica', 'bold'); else doc.setFont('helvetica', 'normal')
    doc.text(s, 14, y); y += 6
  }
  doc.setFontSize(14); line(`Development Permit — ${c.permit.permitNo}`, true)
  doc.setFontSize(10)
  line(`File ref: ${c.fileRef}`)
  line(`Applicant: ${c.applicant.name}   Stand: ${c.property.standNo}`)
  line(`Use class: ${c.permit.useClass}`)
  line(`Permitted development:`)
  doc.text(doc.splitTextToSize(c.permit.permittedDescription, 180), 14, y); y += 18
  line('Conditions:', true)
  c.permit.conditions.forEach((cond, i) => {
    doc.text(doc.splitTextToSize(`${i+1}. ${cond.text}`, 180), 14, y); y += 12
  })
  y += 4; line('Annexure 7 — Notes:', true)
  doc.text(doc.splitTextToSize(c.permit.annexure7Notes, 180), 14, y); y += 40
  line(`Issued: ${c.permit.issueDate?.slice(0,10) ?? '—'}   By: ${c.permit.issuingOfficer}`)
  doc.save(`permit-${c.permit.permitNo}.pdf`)
}
</script>

<template>
  <div v-if="current" class="step4">
    <section class="p4-card">
      <header>Permit core (Annexure 6)</header>
      <div class="p4-grid">
        <label>Permit no<input v-model="current.permit.permitNo" @change="save" /></label>
        <label>Use class
          <select v-model="current.permit.useClass" @change="save">
            <option value="">— Select —</option>
            <option value="I">Class I</option>
            <option value="II">Class II</option>
            <option value="III">Class III</option>
            <option value="IV">Class IV</option>
            <option value="V">Class V</option>
            <option value="VI">Class VI</option>
          </select>
        </label>
        <label class="p4-wide">Permitted development (≥20 chars)
          <textarea v-model="current.permit.permittedDescription" rows="3" @change="save"
            placeholder="e.g. construction of a 4-bedroom dwelling and ancillary buildings" />
        </label>
        <label>Issuing officer<input v-model="current.permit.issuingOfficer" @change="save" /></label>
      </div>
    </section>

    <section class="p4-card">
      <header>Conditions ({{ current.permit.conditions.length }})
        <div class="p4-add-menu">
          <button v-for="t in templates" :key="t.key" class="p4-tpl"
                  @click="addCondition(t.key)" :title="t.label">
            <Plus :size="10" /> {{ t.label }}
          </button>
        </div>
      </header>
      <div v-if="!current.permit.conditions.length" class="p4-empty">
        No conditions yet. Use the buttons above to add from the template library.
      </div>
      <div v-for="(cond, i) in current.permit.conditions" :key="cond.id"
           class="p4-cond" :class="{ failing: !passesAllTests(cond) }">
        <div class="p4-cond-head">
          <span class="p4-cat">{{ cond.category }}</span>
          <button class="p4-remove" @click="removeCondition(i)"><Trash2 :size="11" /></button>
        </div>
        <textarea v-model="cond.text" rows="2" @change="save" />
        <div class="p4-tests">
          <label v-for="[k, label] in TESTS" :key="k">
            <input type="checkbox" v-model="cond.tests[k]" @change="save" /> {{ label }}
          </label>
        </div>
      </div>
    </section>

    <section class="p4-card">
      <header>Annexure 7 — Notes attached to the permit</header>
      <textarea v-model="current.permit.annexure7Notes" rows="6" @change="save" />
    </section>

    <button class="p4-issue" :disabled="!canIssue || !!current.permit.issueDate"
            @click="issuePermit">
      <FileSignature :size="13" />
      {{ current.permit.issueDate
          ? `Issued ${current.permit.issueDate.slice(0,10)}`
          : 'Issue permit' }}
    </button>
  </div>
</template>

<style scoped>
.step4 { display:flex; flex-direction:column; gap:0.6rem; padding:0.75rem; }
.p4-card { border:1px solid #e2e8f0; border-radius:0.5rem; background:#fff; }
.p4-card > header { display:flex; align-items:center; gap:0.4rem; flex-wrap:wrap;
  padding:0.5rem 0.75rem; font-size:0.8125rem; font-weight:600;
  color:#0f172a; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
.p4-add-menu { display:flex; flex-wrap:wrap; gap:0.25rem; margin-left:auto; }
.p4-tpl { display:inline-flex; align-items:center; gap:0.2rem;
  font-size:0.65rem; padding:0.2rem 0.4rem; border:1px solid #e2e8f0; background:#fff;
  color:#1d4ed8; border-radius:0.3rem; cursor:pointer; }
.p4-grid { display:grid; grid-template-columns:repeat(2,1fr); gap:0.4rem 0.75rem;
  padding:0.5rem 0.75rem 0.75rem; }
.p4-grid label { display:flex; flex-direction:column; gap:0.2rem; font-size:0.7rem; color:#475569; }
.p4-grid label.p4-wide { grid-column:1 / -1; }
.p4-grid input, .p4-grid select, .p4-grid textarea {
  font-size:0.72rem; padding:0.3rem 0.45rem; border:1px solid #e2e8f0;
  border-radius:0.3rem; background:#fff; outline:none; }
.p4-empty { padding:0.5rem 0.75rem; font-size:0.72rem; color:#94a3b8; }
.p4-cond { margin:0.5rem 0.75rem; padding:0.5rem; border:1px solid #e2e8f0; border-radius:0.4rem; }
.p4-cond.failing { border-color:#dc2626; background:#fef2f2; }
.p4-cond-head { display:flex; align-items:center; gap:0.4rem; margin-bottom:0.3rem; }
.p4-cat { font-size:0.65rem; padding:0.15rem 0.4rem; background:#eff6ff; color:#1e40af;
  border-radius:9999px; font-weight:600; }
.p4-remove { margin-left:auto; background:none; border:none; color:#94a3b8; cursor:pointer; }
.p4-cond textarea { width:100%; box-sizing:border-box; font-size:0.72rem;
  padding:0.3rem 0.45rem; border:1px solid #e2e8f0; border-radius:0.3rem;
  background:#fff; outline:none; }
.p4-tests { display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:0.3rem; font-size:0.65rem; color:#475569; }
.p4-tests label { display:inline-flex; align-items:center; gap:0.25rem; }
.p4-card textarea { width:calc(100% - 1.5rem); margin:0.5rem 0.75rem 0.75rem;
  font-size:0.72rem; padding:0.4rem 0.55rem; border:1px solid #e2e8f0;
  border-radius:0.3rem; background:#fff; outline:none; box-sizing:border-box; }
.p4-issue { display:inline-flex; align-items:center; justify-content:center; gap:0.3rem;
  margin:0 0.75rem; padding:0.55rem; border:none; border-radius:0.375rem;
  background:#16a34a; color:#fff; font-size:0.78rem; font-weight:700; cursor:pointer; }
.p4-issue:disabled { background:#94a3b8; cursor:not-allowed; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/planner/Step4PermitDrafting.vue
git commit -m "feat(planner): Step 4 permit + 5-test conditions + Annexure 7 + PDF"
```

---

### Task 13: StatutoryShell — orchestrate steps + provide context

**Files:**
- Modify: `src/views/planner/StatutoryShell.vue`

- [ ] **Step 1: Implement StatutoryShell.vue**

```vue
<script setup lang="ts">
import { ref, watch, onUnmounted } from 'vue'
import { providePlannerCase } from '@/composables/usePlannerCase'
import StatutoryClockBanner from './StatutoryClockBanner.vue'
import Step1Intake from './Step1Intake.vue'
import Step2DueDiligence from './Step2DueDiligence.vue'
import Step3CommitteeReport from './Step3CommitteeReport.vue'
import Step4PermitDrafting from './Step4PermitDrafting.vue'
import Step5Notices from './Step5Notices.vue'
import StepLockGate from './StepLockGate.vue'
import CaseFileDrawer from './CaseFileDrawer.vue'
import {
  FilePlus2, ClipboardCheck, FileSignature, Mail, Gavel, Settings,
} from 'lucide-vue-next'

const ctx = providePlannerCase()
const activeStep = ref<1|2|3|4|5>(1)
const drawerOpen = ref(false)

watch(() => ctx.current.value?.permitId, (id) => { if (id) activeStep.value = 2 })

onUnmounted(() => { ctx.clear() })
</script>

<template>
  <div class="shell-root">
    <StatutoryClockBanner />

    <nav class="shell-nav">
      <button :class="{ active: activeStep === 1 }" @click="activeStep = 1">
        <FilePlus2 :size="13" /> 1 · Intake
      </button>
      <button :class="{ active: activeStep === 2, locked: !ctx.step2Unlocked.value }"
              :disabled="!ctx.step2Unlocked.value" @click="activeStep = 2">
        <ClipboardCheck :size="13" /> 2 · Due Diligence
      </button>
      <button :class="{ active: activeStep === 3, locked: !ctx.step3Unlocked.value }"
              :disabled="!ctx.step3Unlocked.value" @click="activeStep = 3">
        <Gavel :size="13" /> 3 · Report
      </button>
      <button :class="{ active: activeStep === 4, locked: !ctx.step4Unlocked.value }"
              :disabled="!ctx.step4Unlocked.value" @click="activeStep = 4">
        <FileSignature :size="13" /> 4 · Permit
      </button>
      <button :class="{ active: activeStep === 5 }" @click="activeStep = 5">
        <Mail :size="13" /> 5 · Notices
      </button>
    </nav>

    <div class="shell-body">
      <Step1Intake v-show="activeStep === 1" />
      <StepLockGate v-show="activeStep === 2" :unlocked="ctx.step2Unlocked.value"
                    reason="Register and persist an application in Step 1 first.">
        <Step2DueDiligence />
      </StepLockGate>
      <StepLockGate v-show="activeStep === 3" :unlocked="ctx.step3Unlocked.value"
                    reason="Complete due diligence in Step 2 first.">
        <Step3CommitteeReport />
      </StepLockGate>
      <StepLockGate v-show="activeStep === 4" :unlocked="ctx.step4Unlocked.value"
                    reason="Record an approve/approve-with-modifications Council resolution in Step 3 first.">
        <Step4PermitDrafting />
      </StepLockGate>
      <Step5Notices v-show="activeStep === 5" />
    </div>

    <button class="shell-drawer-toggle" @click="drawerOpen = !drawerOpen">
      <Settings :size="12" /> Council Tools
    </button>
    <Transition name="drawer-slide">
      <CaseFileDrawer v-if="drawerOpen" @close="drawerOpen = false">
        <template #apps>      <slot name="apps" /></template>
        <template #resources> <slot name="resources" /></template>
        <template #actions>   <slot name="actions" /></template>
        <template #scheme>    <slot name="scheme" /></template>
        <template #consult>   <slot name="consult" /></template>
        <template #village>   <slot name="village" /></template>
        <template #returns>   <slot name="returns" /></template>
      </CaseFileDrawer>
    </Transition>
  </div>
</template>

<style scoped>
.shell-root { display:flex; flex-direction:column; height:100%; background:#f1f5f9; }
.shell-nav { display:flex; gap:0.25rem; padding:0.4rem; background:#fff; border-bottom:1px solid #e2e8f0; }
.shell-nav button { flex:1; display:inline-flex; align-items:center; justify-content:center;
  gap:0.25rem; padding:0.4rem 0.3rem; font-size:0.68rem; font-weight:600;
  border:1px solid #e2e8f0; background:#fff; color:#475569;
  border-radius:0.3rem; cursor:pointer; }
.shell-nav button.active { background:#1d4ed8; color:#fff; border-color:#1d4ed8; }
.shell-nav button.locked { color:#cbd5e1; cursor:not-allowed; }
.shell-nav button:disabled { cursor:not-allowed; }
.shell-body { flex:1; overflow-y:auto; }
.shell-drawer-toggle { display:inline-flex; align-items:center; gap:0.25rem;
  position:sticky; bottom:0; margin:0.5rem auto; padding:0.35rem 0.75rem;
  background:#fff; border:1px solid #e2e8f0; color:#475569;
  border-radius:9999px; font-size:0.7rem; font-weight:600; cursor:pointer; }
.drawer-slide-enter-active, .drawer-slide-leave-active { transition:transform 0.25s ease, opacity 0.2s; }
.drawer-slide-enter-from, .drawer-slide-leave-to { transform:translateX(100%); opacity:0; }
</style>
```

- [ ] **Step 2: Commit**

```bash
git add src/views/planner/StatutoryShell.vue
git commit -m "feat(planner): StatutoryShell orchestrates 5 steps + provides case context"
```

---

## Phase 4 — Wire the shell behind a toggle

### Task 14: Add view-mode toggle to VunguPlannerView.vue

**Files:**
- Modify: `src/views/VunguPlannerView.vue`

- [ ] **Step 1: Import the shell and add the toggle ref**

Open `src/views/VunguPlannerView.vue`. Find the script-setup imports near line 870. After `import ProfileDropdown from '../components/shared/ProfileDropdown.vue'`, add:

```ts
import StatutoryShell from './planner/StatutoryShell.vue'

const viewMode = ref<'classic' | 'statutory'>('classic')
```

Also ensure `FileSignature` is in the existing `lucide-vue-next` import line.

- [ ] **Step 2: Add the toggle button to the header toolbar**

In the template, find the `<div class="ph-toolbar">` block (~line 27). After the existing "Permits" tool button, add:

```vue
<div class="ph-sep"></div>
<button
  class="ph-tool"
  :class="{ active: viewMode === 'statutory' }"
  @click="viewMode = viewMode === 'classic' ? 'statutory' : 'classic'"
  :title="viewMode === 'statutory' ? 'Switch to Classic view' : 'Switch to Statutory workflow view'">
  <FileSignature :size="14" />
  <span>{{ viewMode === 'statutory' ? 'Statutory' : 'Classic' }}</span>
</button>
```

- [ ] **Step 3: Conditionally render the shell vs. classic content**

Find the right-rail `<aside class="right-sidebar" ...>` block (~line 372). Wrap its inner content (after the toggle button) in a v-if branch:

```vue
<aside class="right-sidebar" :class="{ collapsed: rightCollapsed }">
  <button class="sidebar-toggle right-toggle" @click="rightCollapsed = !rightCollapsed">
    <ChevronRight :size="14" :class="{ 'rotate-180': rightCollapsed }" />
  </button>

  <!-- Statutory view -->
  <StatutoryShell v-if="viewMode === 'statutory' && !rightCollapsed">
    <!-- Phase 5 fills these slots with classic content. For now leave empty. -->
  </StatutoryShell>

  <!-- Classic view (existing tabs) -->
  <div v-else-if="!rightCollapsed" class="right-rail-classic">
    <!-- Move all existing `<nav class="rtabs">` and `<div v-if="rightTab===…">` blocks here verbatim. -->
  </div>
</aside>
```

Cut the existing `<nav class="rtabs">…</nav>` and all `<div v-if="rightTab==='X'">…</div>` blocks from where they currently live in the aside, and paste them inside the `right-rail-classic` div.

- [ ] **Step 4: Typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | grep VunguPlannerView | head -5`

Expected: no new errors.

- [ ] **Step 5: Dev-server smoke test**

Run: `npm run dev`. Open the planner. Default view is Classic — confirm existing tabs render. Click the new toggle — confirm the Statutory shell renders with the intake queue. No console errors.

- [ ] **Step 6: Commit**

```bash
git add src/views/VunguPlannerView.vue
git commit -m "feat(planner): toggle to switch between Classic and Statutory views"
```

---

## Phase 5 — Drawer extraction

### Task 15: Move classic right-rail content into CaseFileDrawer.vue

**Files:**
- Modify: `src/views/planner/CaseFileDrawer.vue`
- Modify: `src/views/VunguPlannerView.vue`

- [ ] **Step 1: Implement CaseFileDrawer.vue**

Replace the stub:

```vue
<script setup lang="ts">
import { ref } from 'vue'
import { X, ChevronDown, ChevronRight } from 'lucide-vue-next'

defineEmits<{ close: [] }>()

const sections = ref({
  apps: true, resources: false, actions: false, scheme: false,
  consult: false, village: false, returns: false,
})
const SECTION_LABELS: Record<keyof typeof sections.value, string> = {
  apps: 'Applications', resources: 'Resources', actions: 'Actions',
  scheme: 'Scheme', consult: 'Consultation', village: 'Villages', returns: 'Returns',
}
function toggle(k: keyof typeof sections.value) { sections.value[k] = !sections.value[k] }
const ORDER = ['apps','resources','actions','scheme','consult','village','returns'] as const
</script>

<template>
  <aside class="cf-drawer">
    <header class="cf-head">
      <strong>Council Tools</strong>
      <button class="cf-close" @click="$emit('close')"><X :size="14" /></button>
    </header>

    <section v-for="key in ORDER" :key="key" class="cf-section">
      <button class="cf-section-head" @click="toggle(key)">
        <component :is="sections[key] ? ChevronDown : ChevronRight" :size="12" />
        {{ SECTION_LABELS[key] }}
      </button>
      <div v-if="sections[key]" class="cf-section-body">
        <slot :name="key">
          <p class="cf-placeholder">No content provided for {{ SECTION_LABELS[key] }}.</p>
        </slot>
      </div>
    </section>
  </aside>
</template>

<style scoped>
.cf-drawer { position:fixed; top:0; right:0; bottom:0; width:24rem;
  background:#fff; border-left:1px solid #e2e8f0; box-shadow:-12px 0 32px rgba(0,0,0,0.1);
  z-index:300; display:flex; flex-direction:column; overflow-y:auto; }
.cf-head { display:flex; align-items:center; gap:0.5rem;
  padding:0.65rem 0.85rem; border-bottom:1px solid #e2e8f0; background:#f8fafc; }
.cf-head strong { flex:1; font-size:0.8125rem; color:#0f172a; }
.cf-close { background:none; border:none; cursor:pointer; color:#64748b; padding:0.25rem; }
.cf-section { border-bottom:1px solid #f1f5f9; }
.cf-section-head { display:flex; align-items:center; gap:0.4rem;
  width:100%; padding:0.5rem 0.85rem; background:#fff; border:none;
  font-size:0.75rem; font-weight:600; color:#0f172a; cursor:pointer; text-align:left; }
.cf-section-head:hover { background:#f8fafc; }
.cf-section-body { padding:0.5rem 0.85rem 0.75rem; }
.cf-placeholder { margin:0; padding:0.4rem 0; font-size:0.7rem; color:#94a3b8; font-style:italic; }
</style>
```

- [ ] **Step 2: Fill the StatutoryShell slots from VunguPlannerView**

In `VunguPlannerView.vue`, locate the existing classic right-rail content (the `<div v-if="rightTab==='applications'">…</div>` block and its siblings — `resources`, `actions`, `proposal`, `comments`, `village`, `returns`). They were moved into `right-rail-classic` in Task 14.

Now, in the same file, update the `<StatutoryShell>` invocation to pass that content into named slots — copy the body of each `<div v-if="rightTab==='X'">` into the matching slot template, like this:

```vue
<StatutoryShell v-if="viewMode === 'statutory' && !rightCollapsed">
  <template #apps>
    <!-- contents of the original <div v-if="rightTab==='applications'"> block, verbatim -->
  </template>
  <template #resources>
    <!-- contents of the original <div v-if="rightTab==='resources'"> block, verbatim -->
  </template>
  <template #actions>
    <!-- contents of the original <div v-if="rightTab==='actions'"> block, verbatim -->
  </template>
  <template #scheme>
    <!-- contents of the original <div v-if="rightTab==='proposal'"> block, verbatim -->
  </template>
  <template #consult>
    <!-- contents of the original <div v-if="rightTab==='comments'"> block, verbatim -->
  </template>
  <template #village>
    <!-- contents of the original <div v-if="rightTab==='village'"> block, verbatim -->
  </template>
  <template #returns>
    <!-- contents of the original <div v-if="rightTab==='returns'"> block, verbatim -->
  </template>
</StatutoryShell>
```

Drop the outer `<div v-if="rightTab==='X'">` wrapper — only the inner markup goes in each slot.

- [ ] **Step 3: Smoke test**

Run: `npm run dev`. Switch to Statutory view. Click "Council Tools". Expand each section and confirm the classic panel content renders inside the drawer.

- [ ] **Step 4: Commit**

```bash
git add src/views/planner/CaseFileDrawer.vue src/views/VunguPlannerView.vue
git commit -m "feat(planner): CaseFileDrawer hosts classic tab content via named slots"
```

---

## Phase 6 — Cutover

### Task 16: Flip default to Statutory + strip dead classic code

**Files:**
- Modify: `src/views/VunguPlannerView.vue`

- [ ] **Step 1: Flip the default**

Change:

```ts
const viewMode = ref<'classic' | 'statutory'>('classic')
```

to:

```ts
const viewMode = ref<'classic' | 'statutory'>('statutory')
```

- [ ] **Step 2: Manual QA in browser**

Run: `npm run dev`. Open the planner. Confirm:
- Default view is the Statutory shell.
- Toggle to Classic still works.
- All 5 steps render. Step 2 stays locked until an application is registered. Step 4 stays locked until a resolution is recorded.
- Council Tools drawer opens and shows the legacy content.
- Clock banner animates when an application is acknowledged.

If anything breaks, **stop** — this step is committed separately to make rollback a single `git revert HEAD`.

- [ ] **Step 3: Commit the flip (rollback boundary)**

```bash
git add src/views/VunguPlannerView.vue
git commit -m "feat(planner): default to Statutory view (toggle still available)"
```

- [ ] **Step 4: Remove the toggle + classic branch**

Once QA is green, delete:
- The toggle button from the header toolbar.
- The `viewMode` ref.
- The `<div v-else-if="!rightCollapsed" class="right-rail-classic">` block (the classic right-rail content — which is no longer needed; the slots inside `<StatutoryShell>` carry what we kept).
- The `<nav class="rtabs">` element if it still exists outside the slots.

The right-rail simplifies to:

```vue
<aside class="right-sidebar" :class="{ collapsed: rightCollapsed }">
  <button class="sidebar-toggle right-toggle" @click="rightCollapsed = !rightCollapsed">
    <ChevronRight :size="14" :class="{ 'rotate-180': rightCollapsed }" />
  </button>
  <StatutoryShell v-if="!rightCollapsed">
    <template #apps>      <!-- existing slot contents --></template>
    <template #resources> <!-- existing slot contents --></template>
    <template #actions>   <!-- existing slot contents --></template>
    <template #scheme>    <!-- existing slot contents --></template>
    <template #consult>   <!-- existing slot contents --></template>
    <template #village>   <!-- existing slot contents --></template>
    <template #returns>   <!-- existing slot contents --></template>
  </StatutoryShell>
</aside>
```

Also remove now-unused script-setup state: `rightTab`, `rightTabs`, any `rightTab.value = …` mutations, and the `<button class="rtab">` definitions. If `rightTab.value = …` is set inside business logic functions (e.g. `selectItem`), delete those lines but keep the surrounding function intact.

- [ ] **Step 5: Final typecheck**

Run: `npx vue-tsc --noEmit 2>&1 | grep VunguPlannerView | head -10`

Expected: no new errors. If TypeScript flags unused imports (e.g. `ScrollText`, `BarChart2`), remove them.

- [ ] **Step 6: Dev-server smoke test**

Run: `npm run dev`. Open planner. Confirm shell loads as default, drawer works, all steps function, no console errors.

- [ ] **Step 7: Final commit**

```bash
git add src/views/VunguPlannerView.vue
git commit -m "feat(planner): cutover — remove Classic branch; Statutory shell is the only view"
```

---

## Self-Review

**1. Spec coverage** — every section of `2026-05-15-vungu-planner-statutory-design.md` maps to at least one task:

| Spec section | Tasks |
|---|---|
| § 3 architecture file list | 1, 2, 7, 8, 9, 10, 11, 12, 13 |
| § 4 layout | 7, 13, 14, 15 |
| § 5.1 Step 1 | 8 |
| § 5.2 Step 2 | 10 (5 sub-panels) |
| § 5.3 Step 3 | 11 |
| § 5.4 Step 4 | 12 |
| § 5.5 Step 5 | 9 |
| § 5.6 Drawer | 15 |
| § 6.1 `usePlannerCase` | 5, 6 |
| § 6.2 `useStatutoryClock` | 4 |
| § 6.3 `useConditionLibrary` | 3 |
| § 7 data flow | 6 |
| § 8.1 deemed refusal | 4 (state), 7 (banner), 12 (issue disabled) |
| § 8.2 step prerequisites | 5 (selectors), 13 (`StepLockGate` consumption) |
| § 8.3 5-test gate | 3, 12 |
| § 8.4 concurrent edits | 6 step 3 (`onWindowFocus`) |
| § 8.5 retry queue | 6 (`retryQueue`, `syncPending`) |
| § 8.6 validation | 8 (Step 1 validate), 12 (`canIssue`) |
| § 8.7 refresh-loss | 6 (`beforeunload`) |
| § 9 migration plan | Phase 1–6 ↔ Tasks 1–2, 3–6, 7–13, 14, 15, 16 |

**2. Placeholder scan** — no "TBD", "TODO", "fill in details" in any executable step. Slot bodies in Tasks 14 and 15 explicitly say "the existing markup, verbatim" with the source location named — that's an instruction, not a placeholder.

**3. Type consistency** —
- `dmApi.createPermit`, `dmApi.getPermit`, `dmApi.setPermitStatus`, `dmApi.createConsultation`, `dmApi.listObjections`, `dmApi.createObjection`, `dmApi.listPermits` — all match the actual method names verified in `src/services/developmentManagementService.ts`.
- `passesAllTests(c: PlanningCondition) => boolean` — same signature in Tasks 3, 12.
- `CaseFile` interface — defined once in Task 5, re-used identically in Tasks 6, 7, 8, 9, 10, 11, 12.
- `ClockState` — defined in Task 4, consumed unchanged in Task 7.
- `current.value` — always treated as `CaseFile | null`; every consumer null-checks before access.

**4. Known gaps / acknowledgements** —
- `dmApi` has no dedicated "issue permit with conditions" endpoint. Task 12 issues by transitioning status (`setPermitStatus(id, 'approved', …)`) and storing the permit-specific fields (use class, conditions, Annexure 7 notes, issue date) in localStorage tier-3. Backed by the spec's tier model.
- `useStatutoryClock` increments a `tick` ref every 60 s for re-render. In tests this means the warning-level transition tests rely on initial computation rather than time passage — confirmed by using `isoDaysAgo()` helper to set the ack date relative to "now".
- The cross-tab concurrent-edit guard (Task 6 Step 3) silently reloads on focus when localStorage is newer. The spec mentioned a confirm dialog; this plan simplifies to silent reload because `usePlannerCase` doesn't import `useUiFeedback` (avoiding a circular dep). Users see the newer values on focus.
