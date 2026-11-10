# Statutory Workflow Re-engineering — Timeline Stepper

**Date:** 2026-06-04
**Status:** Design (awaiting review)
**Scope:** Frontend only · Planner role · the Section 26 statutory workflow (`StatutoryShell` + the 5 step components)
**Repo:** `app-frontend`

## 1. Problem

The Section 26 statutory workflow ([StatutoryShell.vue](../../../src/views/planner/StatutoryShell.vue)) presents its five steps — Intake → Due Diligence → Committee Report → Permit → Notices — as a flat **tab strip**. The tabs show step names and a coarse locked/unlocked state, but not *where the case stands*: how far through each step the officer is, what's outstanding, why a later step is locked, or what to do next. Officers must open each tab to discover its state, and there is no single view of the case's progress against the 90-day statutory clock.

This is a **flow & UX restructure**: keep the same five steps and all their statutory rules, but rebuild how the workflow is presented and navigated into a **timeline stepper** that makes case state and "what's next" obvious at a glance.

## 2. Goals

1. Replace the tab strip with a **timeline stepper**: a status-rich left rail listing all five steps + an active-step work canvas, with the existing clock banner on top and the case-file drawer preserved.
2. The rail tells the whole story without opening anything: per step — status, a one-line "what's next", a progress chip (e.g. `5/8`) + mini-bar, and, for locked steps, *why* they're locked. The **active step expands inline** to show its sub-task checklist.
3. A **quiet canvas**: the active step's work plus one shared, sticky **"Complete →"** button that is disabled until that step's requirements are met. All guidance lives in the rail, not the canvas.
4. **Preserve all behavior**: statutory logic, fields, validation, gating thresholds, the 90-day clock, PDF exports, and persistence behave exactly as today.
5. Ship the rewrite in **phases that each leave the workflow working and tested**.

## 3. Non-goals

- **No backend changes.** Frontend only.
- **No change to statutory rules or data**: gating thresholds, the clock math, due-diligence check lists, permit-condition rules, notice requirements, the case data model, and the PDF outputs are preserved, not redesigned.
- **No data-layer overhaul**: `usePlannerCase` is consumed as-is; it is not split or re-architected in this effort (explicitly deferred — see §11).
- **No step-internal redesign beyond layout**: each step's forms/controls move into the canvas layout and expose a completion API, but their logic and fields are unchanged.
- No new brand system; reuse existing Step-card styles and tokens.

## 4. Decisions (from brainstorming — chosen via interactive mockups)

| Question | Decision |
|---|---|
| Navigation model | **Timeline stepper** (rail + active-step canvas), not a wizard or single-scroll. |
| Rail richness | **Status-rich** items (status, next-action, progress chip + mini-bar, why-locked) **+ the active step expands** to its sub-task checklist. |
| Canvas / advance | **Quiet canvas**: work + one shared gated **"Complete →"** footer button; guidance lives in the rail. |
| Build approach | **Full rewrite scoped as "rebuild structure, preserve behavior"**, phased: model → shell → steps one at a time. |

## 5. Architecture

### 5.1 New unit — `src/composables/useStatutorySteps.ts` (the status model)
A composable deriving the rail's data from `usePlannerCase().current` (and the clock where relevant). Pure-ish and independently testable. It is the single source of truth for step **status/progress/guidance** — it does NOT own completion actions (those stay in the step components, §5.3).

```ts
export type StepStatus = 'done' | 'available' | 'locked'

export interface StatutorySubtask { label: string; done: boolean }

export interface StatutoryStep {
  id: 1 | 2 | 3 | 4 | 5
  key: 'intake' | 'due_diligence' | 'committee_report' | 'permit' | 'notices'
  title: string
  status: StepStatus
  progressDone: number
  progressTotal: number
  nextAction: string | null      // shown on the active/available step
  lockedReason: string | null    // shown on locked steps ("Unlocks after Step 2")
  subtasks: StatutorySubtask[]    // shown when the step is expanded in the rail
}

export function useStatutorySteps(): { steps: ComputedRef<StatutoryStep[]> }
```

**Per-step derivation (preserving existing rules):**
- **1 Intake** — `done` when `current.permitId` is set (registered). Subtasks: applicant, property, proposal captured. `nextAction`: "Register the application".
- **2 Due Diligence** — `locked` until `permitId`; `done` when `dueDiligence.completedAt`. `progress` = checks marked / total across the existing File (4) + Compatibility (8) + Statutory (9) lists; `nextAction` summarises outstanding ("3 checks + title-deed"). Subtasks: File checks, Compatibility, Statutory, Title-deed, Referrals.
- **3 Committee Report** — `locked` until `dueDiligence.completedAt` (reason "Unlocks after due diligence"); `done` when `committeeReport.resolutionAt`. `nextAction`: "Record committee resolution".
- **4 Permit** — `locked` until `committeeReport.resolutionAt` with recommendation `approve`/`approve_modified` (reason "Needs committee approval"); `done` when `permit.issueDate`. `nextAction`: "Draft & issue permit".
- **5 Notices** — `available` (notices/acknowledgement may run alongside); `done` when `notices.outcomeLetterSentAt`. Subtasks: Acknowledgement, Public notice, Objections, Outcome letter. `nextAction` reflects the next missing notice item; the outcome-letter subtask notes it needs a Step 3 resolution.

The gating predicates reuse the existing `usePlannerCase` selectors (`step2Unlocked`, `step3Unlocked`, `step4Unlocked`) as the basis for `locked`/`lockedReason`.

### 5.2 New unit — `src/views/planner/StatutoryStepper.vue` (the rail)
Props: `steps: StatutoryStep[]`, `activeId: number`. Emits `select(id)`. Renders each step: status dot, title, `nextAction` line, a progress chip (`progressDone/progressTotal`) + mini-bar, and `lockedReason` for locked steps. The **active** step (matched by `activeId`) renders expanded with its `subtasks` checklist. Clicking a non-locked step emits `select`; clicking a locked step does nothing (its reason is already shown). Owns no business logic — purely presentational over the descriptors.

### 5.3 The Complete contract (quiet footer ↔ step-specific completion)
Each step component exposes a small, uniform API via `defineExpose`:

```ts
defineExpose<{
  canComplete: Ref<boolean> | ComputedRef<boolean>  // requirements met to complete NOW
  complete: () => void                                // performs the step's existing completion action
  completeLabel: string                               // e.g. "Complete due diligence"
}>()
```

The shell renders a shared sticky footer below the active step and binds it to the **active step's** exposed API: the button reads `completeLabel + " →"`, is `:disabled="!canComplete"`, and calls `complete()` on click. `complete()` runs the step's *existing* action (Step 2 `markComplete`, Step 3 `recordResolution`, Step 4 `issuePermit`, Step 5 outcome-letter send; Step 1 submits/register), which mutates the case via `usePlannerCase` and `save()`s. The descriptors in §5.1 then recompute, the rail updates, and the next step unlocks. The shell knows nothing about any step's internals.

> Steps without a meaningful single "complete" action may expose `canComplete: false` / omit `complete`; the shell hides the footer when the active step exposes no `complete`.

### 5.4 Rewritten — `src/views/planner/StatutoryShell.vue`
Layout becomes:
```
StatutoryClockBanner            (preserved, top)
└ body grid:
   ├ StatutoryStepper rail      (left)
   └ active-step canvas         (right): <component :is="activeStepComponent" ref="activeStepRef" />
      └ shared Complete footer  (binds activeStepRef.canComplete/complete/completeLabel)
CaseFileDrawer                  (preserved)
```
Owns `activeStepId` (replacing the current `activeStep` tab index), maps id → step component, holds the `activeStepRef` template ref for the footer binding, and listens to the stepper's `select`. The existing `useOrProvidePlannerCase()` and drawer wiring are preserved.

## 6. Data flow

```
usePlannerCase().current ──► useStatutorySteps() ──► steps[] ──► StatutoryStepper (rail)
shell.activeStepId ──► renders the active step component in the canvas
   active step exposes { canComplete, complete, completeLabel }
      └► shell Complete-footer: disabled unless canComplete; click → complete()
            └► step's existing action → usePlannerCase mutation + save()
                  └► steps[] recompute → rail updates, next step unlocks
stepper @select(id) ──► shell.activeStepId = id  (locked steps are not selectable)
```

## 7. Error handling & edge cases

- **No active case** (`current` null): rail renders all steps `locked` with an empty-state hint; canvas shows "Register or open a case"; footer hidden. (Matches today's behavior where the shell needs a case.)
- **Clicking a locked step**: no-op; the rail already shows the `lockedReason`.
- **Complete with unmet requirements**: impossible via UI (button disabled by `canComplete`); the step's own action retains its existing internal guard as a backstop.
- **Reduced motion**: rail expand/collapse and progress-bar transitions respect `prefers-reduced-motion` (global rule already collapses animations).
- **Persistence/sync**: unchanged — every `complete()` flows through `usePlannerCase.save()` and its existing retry/localStorage path.

## 8. Testing

- **Unit (`useStatutorySteps`):** across representative case states (fresh, registered, DD partial, DD complete, resolution approve/refuse, permit issued), assert each step's `status`, `progressDone/Total`, `nextAction`, `lockedReason`, and `subtasks.done`. Pure composable mounted via a throwaway component.
- **Component (`StatutoryStepper`):** renders statuses + chips + locked reasons; the active step shows its subtasks; `select` emitted for unlocked, not for locked.
- **Shell:** the active step renders in the canvas; the footer is disabled when the active step's `canComplete` is false and enabled + calls `complete()` when true; `select` switches the active step.
- **Per migrated step (phases 3–7):** a focused test that the step still performs its statutory action and exposes `canComplete`/`complete` correctly; existing step specs (e.g. the gating regression, Step 1 stand-picker) stay green.
- All specs that use `mount()` carry `// @vitest-environment happy-dom`.

## 9. Phasing (each phase ships green and is independently testable)

1. **`useStatutorySteps()` + tests** — status model only; no UI change.
2. **`StatutoryStepper` rail + shell relayout** — swap the tab strip for the rail + active-step canvas, rendering the existing step components unchanged (shell drives `activeStepId`); clock banner + drawer preserved. (Shared footer introduced but only wired to steps that already expose a complete action; others keep their in-step buttons until migrated.)
3–7. **Migrate each step (1→5)** into the canvas layout and `defineExpose({ canComplete, complete, completeLabel })`, wiring the shared footer; preserve each step's logic/fields/PDF. One step per phase.

The writing-plans step will break these phases into task-by-task work. Phases 3–7 are independent of each other, so they can be ordered or parallelised as convenient.

## 10. Files

**New**
- `src/composables/useStatutorySteps.ts`
- `src/views/planner/StatutoryStepper.vue`
- Test specs under `src/**/__tests__/`.

**Modified**
- `src/views/planner/StatutoryShell.vue` — relayout to rail + canvas + shared Complete footer; owns `activeStepId`.
- `src/views/planner/Step1Intake.vue` … `Step5Notices.vue` — rebuilt into the canvas layout; each `defineExpose`s the complete API. Statutory logic preserved.

**Unchanged**
- `usePlannerCase.ts`, `useStatutoryClock.ts`, `StatutoryClockBanner.vue`, `CaseFileDrawer.vue`, the PDF/report logic.

## 11. Open questions

None blocking. The data-layer split (`usePlannerCase`) is intentionally out of scope and can be a separate effort later; this rewrite treats the composable as a stable dependency.
