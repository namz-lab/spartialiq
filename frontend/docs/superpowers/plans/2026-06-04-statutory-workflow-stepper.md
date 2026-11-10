# Statutory Workflow Timeline Stepper — Implementation Plan (Phases 1–2)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the statutory workflow's flat tab strip with a timeline stepper — a status-rich left rail (status, next-action, progress, why-locked, expandable sub-tasks) plus an active-step canvas — rendering the existing 5 step components as-is.

**Architecture:** A pure `useStatutorySteps(ctx)` composable derives a `StatutoryStep[]` descriptor array from the planner-case context. A presentational `StatutoryStepper` rail renders it and emits `select`. `StatutoryShell` is relaid out to `[clock banner] / [rail | active-step canvas] / [case drawer]`, driving `activeStepId`. The 5 step components and all statutory logic are untouched.

**Tech Stack:** Vue 3 (`<script setup>`), Pinia, Vitest + `@vue/test-utils` (happy-dom), TypeScript.

**Scope:** Phases 1–2 of the spec ([2026-06-04-statutory-workflow-stepper-design.md](../specs/2026-06-04-statutory-workflow-stepper-design.md)). The shared "Complete →" footer and per-step canvas migration (phases 3–7) are a **separate follow-up plan**; in this plan the steps keep their existing in-step buttons.

**Conventions for every task:**
- Run one test file: `npx vitest run <path>`
- Type-check: `npm run type-check`; Build: `npm run build`
- Any spec using `mount()` MUST have `// @vitest-environment happy-dom` as line 1 (no global test env).
- Commit messages omit any `Co-Authored-By` trailer. Never use `--no-verify` (a hook blocks it).
- Branch `feat/planner-statutory-shell`; do not touch unrelated uncommitted files.

---

## File Structure

**New**
- `src/views/planner/dueDiligenceChecks.ts` — the three due-diligence check lists (extracted from Step2 so the status model and Step 2 share one source of truth).
- `src/composables/useStatutorySteps.ts` — `StatutoryStep` types + `useStatutorySteps(ctx)` deriving the descriptor array.
- `src/views/planner/StatutoryStepper.vue` — the presentational rail.
- Test specs under `src/**/__tests__/`.

**Modified**
- `src/views/planner/Step2DueDiligence.vue` — import the extracted check lists (behavior-identical).
- `src/views/planner/StatutoryShell.vue` — relayout to rail + active-step canvas.

---

## Task 1: Extract the due-diligence check lists (shared source of truth)

**Files:**
- Create: `src/views/planner/dueDiligenceChecks.ts`
- Modify: `src/views/planner/Step2DueDiligence.vue`
- Test: `src/views/planner/__tests__/dueDiligenceChecks.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/views/planner/__tests__/dueDiligenceChecks.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { FILE_CHECKS, COMPAT_CHECKS, STATUTE_CHECKS, DD_CHECK_TOTAL } from '@/views/planner/dueDiligenceChecks'

describe('dueDiligenceChecks', () => {
  it('has the expected counts', () => {
    expect(FILE_CHECKS).toHaveLength(4)
    expect(COMPAT_CHECKS).toHaveLength(8)
    expect(STATUTE_CHECKS).toHaveLength(9)
    expect(DD_CHECK_TOTAL).toBe(21)
  })
  it('entries are [key, label] tuples with non-empty keys', () => {
    for (const list of [FILE_CHECKS, COMPAT_CHECKS, STATUTE_CHECKS]) {
      for (const [key, label] of list) {
        expect(typeof key).toBe('string'); expect(key.length).toBeGreaterThan(0)
        expect(typeof label).toBe('string'); expect(label.length).toBeGreaterThan(0)
      }
    }
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/planner/__tests__/dueDiligenceChecks.spec.ts`
Expected: FAIL — cannot resolve `@/views/planner/dueDiligenceChecks`.

- [ ] **Step 3: Create the module by MOVING the arrays out of Step 2**

Open `src/views/planner/Step2DueDiligence.vue` and locate the three `const FILE_CHECKS = [...] as const`, `const COMPAT_CHECKS = [...] as const`, `const STATUTE_CHECKS = [...] as const` definitions near the top of `<script setup>`. **Copy them verbatim** into a new file `src/views/planner/dueDiligenceChecks.ts`, exported, and add the total:

```ts
// Due-diligence check lists for the Section 26 workflow. Single source of truth
// shared by Step2DueDiligence.vue (the checklist UI) and useStatutorySteps (the
// stepper's progress model). Keep [key, label] tuples — keys are persisted in
// the case's dueDiligence buckets.

export const FILE_CHECKS = [
  ['existing_use_rights',     'Existing use rights of the stand'],
  ['prior_applications',      'Previous applications, permits, refusals'],
  ['active_enforcement',      'Active enforcement / prohibition orders'],
  ['title_deed_restrictions', 'Title-deed restrictions on the property'],
] as const

export const COMPAT_CHECKS = [
  ['zoning',             'Land-use zoning conformity'],
  ['conflict_of_use',    'Conflict of use (e.g. liquor next to school)'],
  ['multiple_stand_use', 'Multiple stand use within same use group'],
  ['layout_conformity',  'Conformity with approved layout (setback, density)'],
  ['traffic',            'Traffic circulation & access'],
  ['coordinated_dev',    'Coordinated development & services sequencing'],
  ['env_sensitivity',    'Environmental sensitivity (wetlands, water courses)'],
  ['public_health_adj',  'Public-health adjacency'],
] as const

export const STATUTE_CHECKS = [
  ['rtcp',         'RTCP Act [Ch. 29:12] — permit requirements ss. 22/26/32/34/38'],
  ['uca',          'Urban Councils Act [Ch. 29:15] — by-law adoption'],
  ['health',       'Public Health Act [Ch. 15:09] — sanitation & hygiene'],
  ['by_laws',      'Model Building By-Laws (1977) — construction & sewerage'],
  ['factories',    'Factories & Works Act [Ch. 14:08] — factory plans (s. 9(4))'],
  ['liquor',       'Liquor Licensing Act [Ch. 14:12] — licensed premises'],
  ['atm',          'Atmospheric Pollution Prevention Act [Ch. 318]'],
  ['mines',        'Mines & Minerals Act [Ch. 21:05] — mining developments'],
  ['constitution', 'Constitution of Zimbabwe — due process / property rights'],
] as const

export const DD_CHECK_TOTAL = FILE_CHECKS.length + COMPAT_CHECKS.length + STATUTE_CHECKS.length
```

> IMPORTANT: copy the ACTUAL tuple contents from `Step2DueDiligence.vue`. If the live arrays differ from the above (extra/renamed entries), use the live ones and update the test's expected counts to match — the live file is authoritative.

- [ ] **Step 4: Rewire Step 2 to import them**

In `src/views/planner/Step2DueDiligence.vue`, DELETE the three local `const FILE_CHECKS/COMPAT_CHECKS/STATUTE_CHECKS = [...] as const` definitions and add an import alongside the other imports:

```ts
import { FILE_CHECKS, COMPAT_CHECKS, STATUTE_CHECKS } from './dueDiligenceChecks'
```

Leave everything else in Step 2 unchanged (the arrays are used the same way).

- [ ] **Step 5: Verify (behavior identical)**

Run: `npx vitest run src/views/planner/__tests__/dueDiligenceChecks.spec.ts` → PASS (2 tests)
Run: `npx vitest run src/views/planner/__tests__/Step2DueDiligence.zoning.spec.ts` → still PASS
Run: `npm run type-check` → no NEW errors in `Step2DueDiligence.vue` / `dueDiligenceChecks.ts`

- [ ] **Step 6: Commit**

```bash
git add src/views/planner/dueDiligenceChecks.ts src/views/planner/Step2DueDiligence.vue src/views/planner/__tests__/dueDiligenceChecks.spec.ts
git commit -m "refactor(planner): extract due-diligence check lists to a shared module"
```

---

## Task 2: `useStatutorySteps(ctx)` status model

**Files:**
- Create: `src/composables/useStatutorySteps.ts`
- Test: `src/composables/__tests__/useStatutorySteps.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/composables/__tests__/useStatutorySteps.spec.ts`:

```ts
import { ref, computed } from 'vue'
import { describe, it, expect } from 'vitest'
import { useStatutorySteps } from '@/composables/useStatutorySteps'
import { emptyCase } from '@/composables/usePlannerCase'
import type { PlannerCaseContext } from '@/composables/usePlannerCase'

// Build a minimal ctx-like object the composable accepts.
function ctxFor(current: any): PlannerCaseContext {
  const cur = ref(current)
  return {
    current: cur,
    step2Unlocked: computed(() => !!cur.value?.permitId),
    step3Unlocked: computed(() => !!cur.value?.dueDiligence?.completedAt),
    step4Unlocked: computed(() => !!cur.value?.committeeReport?.resolutionAt &&
      ['approve', 'approve_modified'].includes(cur.value?.committeeReport?.recommendation)),
    step5Available: computed(() => true),
  } as unknown as PlannerCaseContext
}

describe('useStatutorySteps', () => {
  it('locks everything when there is no case', () => {
    const { steps } = useStatutorySteps(ctxFor(null))
    expect(steps.value).toHaveLength(5)
    expect(steps.value.every(s => s.status === 'locked')).toBe(true)
    expect(steps.value[0].lockedReason).toBe('No active case')
  })

  it('marks intake available then done; gates step 2 on registration', () => {
    const fresh = emptyCase()
    const { steps } = useStatutorySteps(ctxFor(fresh))
    expect(steps.value[0].status).toBe('available')         // intake
    expect(steps.value[0].nextAction).toBe('Register the application')
    expect(steps.value[1].status).toBe('locked')            // due diligence
    expect(steps.value[1].lockedReason).toBe('Register the application first')
  })

  it('reports due-diligence progress out of 21 checks', () => {
    const c = emptyCase()
    c.permitId = 'p1'
    c.dueDiligence.fileChecks = { existing_use_rights: { result: 'pass', notes: '' } }
    c.dueDiligence.compatibility = { zoning: { result: 'fail', notes: '' } }
    const { steps } = useStatutorySteps(ctxFor(c))
    const dd = steps.value[1]
    expect(dd.status).toBe('available')
    expect(dd.progressTotal).toBe(21)
    expect(dd.progressDone).toBe(2)
    expect(dd.nextAction).toBe('19 checks outstanding')
  })

  it('flows through to permit once approved, and marks done states', () => {
    const c = emptyCase()
    c.permitId = 'p1'
    c.dueDiligence.completedAt = '2026-06-01T00:00:00Z'
    c.committeeReport.resolutionAt = '2026-06-02T00:00:00Z'
    c.committeeReport.recommendation = 'approve'
    const { steps } = useStatutorySteps(ctxFor(c))
    expect(steps.value[1].status).toBe('done')              // due diligence
    expect(steps.value[2].status).toBe('done')              // report (resolutionAt set)
    expect(steps.value[3].status).toBe('available')         // permit unlocked, not issued
    c.permit.issueDate = '2026-06-03T00:00:00Z'
    const { steps: steps2 } = useStatutorySteps(ctxFor(c))
    expect(steps2.value[3].status).toBe('done')             // permit issued
  })

  it('keeps permit locked when the resolution is a refusal', () => {
    const c = emptyCase()
    c.permitId = 'p1'; c.dueDiligence.completedAt = 'x'
    c.committeeReport.resolutionAt = 'y'; c.committeeReport.recommendation = 'refuse'
    const { steps } = useStatutorySteps(ctxFor(c))
    expect(steps.value[3].status).toBe('locked')
    expect(steps.value[3].lockedReason).toBe('Needs an approve resolution')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/composables/__tests__/useStatutorySteps.spec.ts`
Expected: FAIL — cannot resolve `@/composables/useStatutorySteps`.

- [ ] **Step 3: Write the implementation**

Create `src/composables/useStatutorySteps.ts`:

```ts
// Derives the timeline-stepper rail's per-step descriptors from the planner-case
// context. Pure status/progress/guidance — it does NOT own completion actions
// (those live in the step components). Takes the context as an argument (rather
// than injecting) so the shell can both provide and consume the case safely.
import { computed, type ComputedRef } from 'vue'
import type { PlannerCaseContext, CaseFile, CheckResult } from '@/composables/usePlannerCase'
import { FILE_CHECKS, COMPAT_CHECKS, STATUTE_CHECKS, DD_CHECK_TOTAL } from '@/views/planner/dueDiligenceChecks'

export type StepStatus = 'done' | 'available' | 'locked'
export interface StatutorySubtask { label: string; done: boolean }
export interface StatutoryStep {
  id: 1 | 2 | 3 | 4 | 5
  key: 'intake' | 'due_diligence' | 'committee_report' | 'permit' | 'notices'
  title: string
  status: StepStatus
  progressDone: number
  progressTotal: number
  nextAction: string | null
  lockedReason: string | null
  subtasks: StatutorySubtask[]
}

type Bucket = Record<string, { result: CheckResult; notes: string }> | undefined

function markedCount(bucket: Bucket, keys: ReadonlyArray<readonly [string, string]>): number {
  if (!bucket) return 0
  let n = 0
  for (const [k] of keys) if (bucket[k]?.result != null) n++
  return n
}

function lockedStep(id: StatutoryStep['id'], key: StatutoryStep['key'], title: string): StatutoryStep {
  return { id, key, title, status: 'locked', progressDone: 0, progressTotal: 0,
    nextAction: null, lockedReason: 'No active case', subtasks: [] }
}

export function useStatutorySteps(ctx: PlannerCaseContext): { steps: ComputedRef<StatutoryStep[]> } {
  const steps = computed<StatutoryStep[]>(() => {
    const c = ctx.current.value as CaseFile | null
    if (!c) {
      return [
        lockedStep(1, 'intake', 'Intake'),
        lockedStep(2, 'due_diligence', 'Due Diligence'),
        lockedStep(3, 'committee_report', 'Committee Report'),
        lockedStep(4, 'permit', 'Permit'),
        lockedStep(5, 'notices', 'Notices'),
      ]
    }
    const dd = c.dueDiligence
    const ddMarked = markedCount(dd.fileChecks, FILE_CHECKS)
      + markedCount(dd.compatibility, COMPAT_CHECKS)
      + markedCount(dd.statutoryChecks, STATUTE_CHECKS)
    const ddOutstanding = DD_CHECK_TOTAL - ddMarked

    // 1 · Intake
    const intakeSubs: StatutorySubtask[] = [
      { label: 'Applicant', done: !!c.applicant.name },
      { label: 'Property / stand', done: !!c.property.standNo },
      { label: 'Proposal', done: !!c.proposal.description },
    ]
    const intake: StatutoryStep = {
      id: 1, key: 'intake', title: 'Intake',
      status: c.permitId ? 'done' : 'available',
      progressDone: intakeSubs.filter(s => s.done).length, progressTotal: intakeSubs.length,
      nextAction: c.permitId ? null : 'Register the application',
      lockedReason: null, subtasks: intakeSubs,
    }

    // 2 · Due Diligence
    const ddLocked = !ctx.step2Unlocked.value
    const dueDiligence: StatutoryStep = {
      id: 2, key: 'due_diligence', title: 'Due Diligence',
      status: ddLocked ? 'locked' : (dd.completedAt ? 'done' : 'available'),
      progressDone: ddMarked, progressTotal: DD_CHECK_TOTAL,
      nextAction: ddLocked ? null
        : dd.completedAt ? null
        : ddOutstanding > 0 ? `${ddOutstanding} checks outstanding`
        : 'Mark due diligence complete',
      lockedReason: ddLocked ? 'Register the application first' : null,
      subtasks: [
        { label: 'File checks',          done: markedCount(dd.fileChecks, FILE_CHECKS) === FILE_CHECKS.length },
        { label: 'Compatibility',        done: markedCount(dd.compatibility, COMPAT_CHECKS) === COMPAT_CHECKS.length },
        { label: 'Statutory provisions', done: markedCount(dd.statutoryChecks, STATUTE_CHECKS) === STATUTE_CHECKS.length },
        { label: 'Title-deed',           done: !dd.titleDeedConflict.hasConflict || dd.titleDeedConflict.bondholderConsentReceived },
        { label: 'Referrals logged',     done: dd.referrals.length > 0 },
      ],
    }

    // 3 · Committee Report
    const repLocked = !ctx.step3Unlocked.value
    const cr = c.committeeReport
    const reportSubs: StatutorySubtask[] = [
      { label: 'Tabled to committee', done: !!cr.tabledAt },
      { label: 'Resolution recorded', done: !!cr.resolutionAt },
    ]
    const report: StatutoryStep = {
      id: 3, key: 'committee_report', title: 'Committee Report',
      status: repLocked ? 'locked' : (cr.resolutionAt ? 'done' : 'available'),
      progressDone: reportSubs.filter(s => s.done).length, progressTotal: reportSubs.length,
      nextAction: repLocked ? null : cr.resolutionAt ? null : 'Record committee resolution',
      lockedReason: repLocked ? 'Complete due diligence first' : null,
      subtasks: reportSubs,
    }

    // 4 · Permit
    const permitLocked = !ctx.step4Unlocked.value
    const permitSubs: StatutorySubtask[] = [
      { label: 'Permit number', done: !!c.permit.permitNo },
      { label: 'Conditions',    done: c.permit.conditions.length > 0 },
      { label: 'Issued',        done: !!c.permit.issueDate },
    ]
    const permit: StatutoryStep = {
      id: 4, key: 'permit', title: 'Permit',
      status: permitLocked ? 'locked' : (c.permit.issueDate ? 'done' : 'available'),
      progressDone: permitSubs.filter(s => s.done).length, progressTotal: permitSubs.length,
      nextAction: permitLocked ? null : c.permit.issueDate ? null : 'Draft & issue the permit',
      lockedReason: permitLocked ? 'Needs an approve resolution' : null,
      subtasks: permitSubs,
    }

    // 5 · Notices
    const n = c.notices
    const noticeSubs: StatutorySubtask[] = [
      { label: 'Acknowledgement sent', done: !!n.ackSentAt },
      { label: 'Public notice',        done: !!n.publicNotice?.publishedAt },
      { label: 'Objections handled',   done: n.objections.length === 0 || n.objections.every(o => !!o.resolvedAt) },
      { label: 'Outcome letter sent',  done: !!n.outcomeLetterSentAt },
    ]
    const notices: StatutoryStep = {
      id: 5, key: 'notices', title: 'Notices',
      status: n.outcomeLetterSentAt ? 'done' : 'available',
      progressDone: noticeSubs.filter(s => s.done).length, progressTotal: noticeSubs.length,
      nextAction: n.outcomeLetterSentAt ? null : 'Issue acknowledgement & notices',
      lockedReason: null, subtasks: noticeSubs,
    }

    return [intake, dueDiligence, report, permit, notices]
  })

  return { steps }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/composables/__tests__/useStatutorySteps.spec.ts`
Expected: PASS (5 tests).

Run: `npm run type-check` → no NEW errors referencing `useStatutorySteps.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/composables/useStatutorySteps.ts src/composables/__tests__/useStatutorySteps.spec.ts
git commit -m "feat(planner): useStatutorySteps status model for the workflow stepper"
```

---

## Task 3: `StatutoryStepper.vue` rail

**Files:**
- Create: `src/views/planner/StatutoryStepper.vue`
- Test: `src/views/planner/__tests__/StatutoryStepper.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/views/planner/__tests__/StatutoryStepper.spec.ts`:

```ts
// @vitest-environment happy-dom
import { mount } from '@vue/test-utils'
import { describe, it, expect } from 'vitest'
import StatutoryStepper from '@/views/planner/StatutoryStepper.vue'
import type { StatutoryStep } from '@/composables/useStatutorySteps'

const steps: StatutoryStep[] = [
  { id: 1, key: 'intake', title: 'Intake', status: 'done', progressDone: 3, progressTotal: 3, nextAction: null, lockedReason: null, subtasks: [] },
  { id: 2, key: 'due_diligence', title: 'Due Diligence', status: 'available', progressDone: 5, progressTotal: 21, nextAction: '16 checks outstanding', lockedReason: null,
    subtasks: [{ label: 'File checks', done: true }, { label: 'Compatibility', done: false }] },
  { id: 3, key: 'committee_report', title: 'Committee Report', status: 'locked', progressDone: 0, progressTotal: 2, nextAction: null, lockedReason: 'Complete due diligence first', subtasks: [] },
]

describe('StatutoryStepper', () => {
  it('renders steps with status, next-action, progress and locked reason', () => {
    const w = mount(StatutoryStepper, { props: { steps, activeId: 2 } })
    expect(w.findAll('.sx-step').length).toBe(3)
    expect(w.text()).toContain('16 checks outstanding')
    expect(w.text()).toContain('5/21')
    expect(w.text()).toContain('Complete due diligence first')
  })

  it('expands the active step to show subtasks', () => {
    const w = mount(StatutoryStepper, { props: { steps, activeId: 2 } })
    const active = w.find('.sx-step.active')
    expect(active.exists()).toBe(true)
    expect(active.findAll('.sx-subtask').length).toBe(2)
  })

  it('emits select for an unlocked step but not a locked one', async () => {
    const w = mount(StatutoryStepper, { props: { steps, activeId: 2 } })
    await w.findAll('.sx-step')[0].trigger('click')   // intake (done, unlocked)
    expect(w.emitted('select')![0]).toEqual([1])
    await w.findAll('.sx-step')[2].trigger('click')   // report (locked)
    expect(w.emitted('select')!.length).toBe(1)       // no new emit
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/planner/__tests__/StatutoryStepper.spec.ts`
Expected: FAIL — cannot resolve `@/views/planner/StatutoryStepper.vue`.

- [ ] **Step 3: Write the implementation**

Create `src/views/planner/StatutoryStepper.vue`:

```vue
<script setup lang="ts">
// Presentational rail for the statutory timeline stepper. Renders the
// descriptors from useStatutorySteps; the active step expands to its subtasks.
// No business logic — emits `select` for unlocked steps only.
import type { StatutoryStep } from '@/composables/useStatutorySteps'
import { CheckCircle2, Circle, Lock } from 'lucide-vue-next'

const props = defineProps<{ steps: StatutoryStep[]; activeId: number }>()
const emit = defineEmits<{ select: [id: number] }>()

function onClick(s: StatutoryStep) {
  if (s.status === 'locked') return
  emit('select', s.id)
}
</script>

<template>
  <nav class="sx-rail" aria-label="Statutory steps">
    <button
      v-for="s in props.steps" :key="s.id" type="button"
      class="sx-step"
      :class="{ active: s.id === props.activeId, locked: s.status === 'locked',
                done: s.status === 'done' }"
      :disabled="s.status === 'locked'"
      @click="onClick(s)">
      <span class="sx-dot" :class="'st-' + s.status">
        <CheckCircle2 v-if="s.status === 'done'" :size="12" />
        <Lock v-else-if="s.status === 'locked'" :size="11" />
        <span v-else>{{ s.id }}</span>
      </span>
      <span class="sx-main">
        <span class="sx-row">
          <span class="sx-title">{{ s.title }}</span>
          <span v-if="s.progressTotal > 0" class="sx-chip">{{ s.progressDone }}/{{ s.progressTotal }}</span>
        </span>
        <span v-if="s.nextAction" class="sx-next">{{ s.nextAction }}</span>
        <span v-if="s.lockedReason" class="sx-locked">{{ s.lockedReason }}</span>
        <span v-if="s.progressTotal > 0" class="sx-bar">
          <i :style="{ width: Math.round((s.progressDone / s.progressTotal) * 100) + '%' }"></i>
        </span>
        <span v-if="s.id === props.activeId && s.subtasks.length" class="sx-subs">
          <span v-for="t in s.subtasks" :key="t.label" class="sx-subtask" :class="{ done: t.done }">
            <component :is="t.done ? CheckCircle2 : Circle" :size="10" /> {{ t.label }}
          </span>
        </span>
      </span>
    </button>
  </nav>
</template>

<style scoped>
.sx-rail { display:flex; flex-direction:column; gap:0.3rem; padding:0.5rem; }
.sx-step { display:flex; gap:0.5rem; align-items:flex-start; text-align:left;
  padding:0.5rem 0.6rem; border:1px solid #e2e8f0; border-radius:0.45rem;
  background:#fff; color:#475569; cursor:pointer; width:100%; }
.sx-step.active { background:#eff6ff; border-color:#bfdbfe; }
.sx-step.locked { cursor:not-allowed; opacity:0.75; }
.sx-step:disabled { cursor:not-allowed; }
.sx-dot { width:20px; height:20px; min-width:20px; border-radius:50%;
  display:inline-flex; align-items:center; justify-content:center;
  font-size:10px; font-weight:700; background:#e2e8f0; color:#64748b; }
.sx-dot.st-done { background:#16a34a; color:#fff; }
.sx-dot.st-available { background:#1d4ed8; color:#fff; }
.sx-dot.st-locked { background:#e2e8f0; color:#94a3b8; }
.sx-main { flex:1; display:flex; flex-direction:column; gap:0.2rem; min-width:0; }
.sx-row { display:flex; align-items:center; justify-content:space-between; gap:0.4rem; }
.sx-title { font-size:0.78rem; font-weight:700; color:#0f172a; }
.sx-chip { font-size:0.62rem; font-weight:700; padding:0.05rem 0.4rem; border-radius:9999px;
  background:#f1f5f9; color:#475569; }
.sx-next { font-size:0.66rem; color:#1d4ed8; }
.sx-locked { font-size:0.66rem; color:#94a3b8; }
.sx-bar { height:3px; background:#e2e8f0; border-radius:9999px; overflow:hidden; }
.sx-bar > i { display:block; height:100%; background:#1d4ed8; transition:width 0.3s ease; }
.sx-subs { display:flex; flex-direction:column; gap:0.15rem; margin-top:0.2rem; }
.sx-subtask { display:flex; align-items:center; gap:0.3rem; font-size:0.66rem; color:#94a3b8; }
.sx-subtask.done { color:#166534; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/planner/__tests__/StatutoryStepper.spec.ts`
Expected: PASS (3 tests).

Run: `npm run type-check` → no NEW errors referencing `StatutoryStepper.vue`.

- [ ] **Step 5: Commit**

```bash
git add src/views/planner/StatutoryStepper.vue src/views/planner/__tests__/StatutoryStepper.spec.ts
git commit -m "feat(planner): StatutoryStepper rail component"
```

---

## Task 4: Relayout `StatutoryShell.vue` to rail + active-step canvas

**Files:**
- Modify: `src/views/planner/StatutoryShell.vue`
- Test: `src/views/planner/__tests__/StatutoryShell.stepper.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/views/planner/__tests__/StatutoryShell.stepper.spec.ts`:

```ts
// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { ref, computed } from 'vue'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const current = ref<any>(null)
vi.mock('@/composables/usePlannerCase', async (orig) => {
  const actual = await (orig as any)()
  return {
    ...actual,
    useOrProvidePlannerCase: () => ({
      current,
      step2Unlocked: computed(() => !!current.value?.permitId),
      step3Unlocked: computed(() => !!current.value?.dueDiligence?.completedAt),
      step4Unlocked: computed(() => false),
      step5Available: computed(() => true),
    }),
  }
})

import StatutoryShell from '@/views/planner/StatutoryShell.vue'

const stepStubs = {
  StatutoryClockBanner: true, CaseFileDrawer: true, StepLockGate: { template: '<div><slot/></div>' },
  Step1Intake: { template: '<div class="s1-stub" />' },
  Step2DueDiligence: { template: '<div class="s2-stub" />' },
  Step3CommitteeReport: { template: '<div class="s3-stub" />' },
  Step4PermitDrafting: { template: '<div class="s4-stub" />' },
  Step5Notices: { template: '<div class="s5-stub" />' },
}

beforeEach(() => { current.value = null })

describe('StatutoryShell stepper layout', () => {
  it('renders the stepper rail and the active step canvas', async () => {
    current.value = { permitId: 'p1', applicant: {}, property: {}, proposal: {},
      dueDiligence: { fileChecks: {}, compatibility: {}, statutoryChecks: {},
        titleDeedConflict: { hasConflict: false, bondholderConsentReceived: false }, referrals: [], completedAt: null },
      committeeReport: { recommendation: 'defer', tabledAt: null, resolutionAt: null },
      permit: { permitNo: '', conditions: [], issueDate: null },
      notices: { ackSentAt: null, publicNotice: null, objections: [], outcomeLetterSentAt: null } }
    const w = mount(StatutoryShell, { global: { stubs: stepStubs } })
    await flushPromises()
    expect(w.findComponent({ name: 'StatutoryStepper' }).exists()).toBe(true)
    // permitId set → the shell auto-activates step 2; its stub is shown.
    expect(w.find('.s2-stub').exists()).toBe(true)
  })

  it('switches the active step when the rail emits select', async () => {
    current.value = { permitId: 'p1', applicant: {}, property: {}, proposal: {},
      dueDiligence: { fileChecks: {}, compatibility: {}, statutoryChecks: {},
        titleDeedConflict: { hasConflict: false, bondholderConsentReceived: false }, referrals: [], completedAt: null },
      committeeReport: { recommendation: 'defer', tabledAt: null, resolutionAt: null },
      permit: { permitNo: '', conditions: [], issueDate: null },
      notices: { ackSentAt: null, publicNotice: null, objections: [], outcomeLetterSentAt: null } }
    const w = mount(StatutoryShell, { global: { stubs: stepStubs } })
    await flushPromises()
    w.findComponent({ name: 'StatutoryStepper' }).vm.$emit('select', 5)
    await flushPromises()
    expect(w.find('.s5-stub').isVisible()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/planner/__tests__/StatutoryShell.stepper.spec.ts`
Expected: FAIL — `StatutoryStepper` not found in the shell.

- [ ] **Step 3: Rewrite the shell**

Replace the entire contents of `src/views/planner/StatutoryShell.vue` with:

```vue
<script setup lang="ts">
import { ref, watch } from 'vue'
import { useOrProvidePlannerCase } from '@/composables/usePlannerCase'
import { useStatutorySteps } from '@/composables/useStatutorySteps'
import StatutoryClockBanner from './StatutoryClockBanner.vue'
import StatutoryStepper from './StatutoryStepper.vue'
import Step1Intake from './Step1Intake.vue'
import Step2DueDiligence from './Step2DueDiligence.vue'
import Step3CommitteeReport from './Step3CommitteeReport.vue'
import Step4PermitDrafting from './Step4PermitDrafting.vue'
import Step5Notices from './Step5Notices.vue'
import StepLockGate from './StepLockGate.vue'
import CaseFileDrawer from './CaseFileDrawer.vue'
import { Settings } from 'lucide-vue-next'

const ctx = useOrProvidePlannerCase()
const { steps } = useStatutorySteps(ctx)
const activeStep = ref<1 | 2 | 3 | 4 | 5>(1)
const drawerOpen = ref(false)

watch(() => ctx.current.value?.permitId, (id) => { if (id) activeStep.value = 2 })

function onSelect(id: number) { activeStep.value = id as 1 | 2 | 3 | 4 | 5 }
</script>

<template>
  <div class="shell-root">
    <StatutoryClockBanner />

    <div class="shell-main">
      <aside class="shell-rail">
        <StatutoryStepper :steps="steps" :active-id="activeStep" @select="onSelect" />
      </aside>

      <div class="shell-canvas">
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
    </div>

    <button class="shell-drawer-toggle" @click="drawerOpen = !drawerOpen">
      <Settings :size="12" /> Council Tools
    </button>
    <Transition name="drawer-slide">
      <CaseFileDrawer v-if="drawerOpen" @close="drawerOpen = false" />
    </Transition>
  </div>
</template>

<style scoped>
.shell-root { display:flex; flex-direction:column; height:100%; background:#f1f5f9; }
.shell-main { flex:1; min-height:0; display:flex; }
.shell-rail { width:15rem; min-width:15rem; border-right:1px solid #e2e8f0;
  background:#fff; overflow-y:auto; }
.shell-canvas { flex:1; min-width:0; overflow-y:auto; }
.shell-drawer-toggle { display:inline-flex; align-items:center; gap:0.25rem;
  position:sticky; bottom:0; margin:0.5rem auto; padding:0.35rem 0.75rem;
  background:#fff; border:1px solid #e2e8f0; color:#475569;
  border-radius:9999px; font-size:0.7rem; font-weight:600; cursor:pointer; }
.drawer-slide-enter-active, .drawer-slide-leave-active { transition:transform 0.25s ease, opacity 0.2s; }
.drawer-slide-enter-from, .drawer-slide-leave-to { transform:translateX(100%); opacity:0; }
@media (max-width: 720px) {
  .shell-main { flex-direction:column; }
  .shell-rail { width:auto; min-width:0; border-right:none; border-bottom:1px solid #e2e8f0; }
}
</style>
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/views/planner/__tests__/StatutoryShell.stepper.spec.ts` → PASS (2 tests)
Run: `npm run type-check` → no NEW errors in `StatutoryShell.vue`
Run: `npm run build` → succeeds

- [ ] **Step 5: Commit**

```bash
git add src/views/planner/StatutoryShell.vue src/views/planner/__tests__/StatutoryShell.stepper.spec.ts
git commit -m "feat(planner): replace statutory tab strip with the timeline stepper"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit-test run**

Run: `npx vitest run`
Expected: all suites pass, including the 4 new specs and all pre-existing planner specs (Step1 stand-picker, Step2 zoning, gating regression, etc.).

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: no new errors referencing `dueDiligenceChecks.ts`, `useStatutorySteps.ts`, `StatutoryStepper.vue`, `StatutoryShell.vue`, `Step2DueDiligence.vue`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual walkthrough (record in commit body; needs running backend + frontend)**

```
[ ] Open the planner console → Statutory Workflow: the left rail shows all 5 steps with status dots
[ ] A fresh/registered case: Intake done, Due Diligence active with an "N checks outstanding" line + progress chip
[ ] Locked steps (Report/Permit before their gate) show a greyed dot + a why-locked line and are NOT clickable
[ ] Clicking an unlocked step switches the right canvas to that step; the active step expands its sub-task checklist in the rail
[ ] Marking due-diligence checks updates the rail's progress chip/bar live; completing it unlocks Report
[ ] The 90-day clock banner still shows on top; "Council Tools" drawer still opens
[ ] Each step's existing in-step buttons (register, mark complete, issue, etc.) still work (footer migration is a later plan)
```

- [ ] **Step 5: Commit any fixups** (skip if none)

```bash
git add -A
git commit -m "chore(planner): final verification fixups for the workflow stepper"
```

---

## Self-Review

**Spec coverage (phases 1–2):**
- Timeline stepper layout (rail + canvas, clock + drawer preserved) → Task 4. ✓
- Status-rich rail (status, next-action, progress chip + bar, why-locked) + expandable active step subtasks → Task 3 on Task 2's descriptors. ✓
- Status model derived from the case, gating reused → Task 2 (`useStatutorySteps`). ✓
- DD progress out of the real check total → Task 1 (shared lists) + Task 2. ✓
- Behavior preserved; steps rendered as-is with their own buttons; StepLockGate backstop kept → Task 4. ✓
- No backend changes; `usePlannerCase` consumed as-is → all tasks. ✓
- Shared "Complete →" footer + per-step canvas migration → explicitly deferred to the follow-up plan (phases 3–7). ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. The Task 1 note ("copy the ACTUAL tuples; live file is authoritative") is a correctness guardrail, not a placeholder.

**Type consistency:** `StatutoryStep` / `StepStatus` / `StatutorySubtask` defined in Task 2 are imported unchanged by Task 3 (`StatutoryStepper`) and used by Task 4. `useStatutorySteps(ctx)` takes a `PlannerCaseContext` (Task 2) and is called with the shell's `ctx` (Task 4). `FILE_CHECKS`/`COMPAT_CHECKS`/`STATUTE_CHECKS`/`DD_CHECK_TOTAL` (Task 1) are consumed identically in Task 2. The stepper's `select` event (number) matches `onSelect(id: number)` in the shell.
