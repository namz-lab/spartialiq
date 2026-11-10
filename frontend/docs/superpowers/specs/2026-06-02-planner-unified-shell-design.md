# Planner Unified Shell — Integrating the Map and the Console

**Date:** 2026-06-02
**Status:** Design (awaiting review)
**Scope:** Frontend only · Planner role only (`/planner` surfaces)
**Repo:** `app-frontend`

## 1. Problem

A Town Planning Officer today works across three disconnected surfaces:

- **`/planner`** — `VunguPlannerView.vue`, the spatial **map** ("Planning Command Center"): MapLibre canvas, layer switcher, draw/measure/buffer tools, search, QGIS Server connect, per-stand right rail (Plot · Permits · Checks · Tools).
- **`/planner-workspace`** — `PlannerWorkspaceView.vue`, the **console** ("Town Planning Officer Console"): a 7-section left rail (Dashboard, Statutory Workflow, Permit Register, Enforcement, Building Plans, Reports, Reference). Its "Statutory Workflow" section embeds `StatutoryShell` (the 5-step Section 26 process).
- **`/planner/statutory`** — `PlannerStatutoryView.vue`, a third full page that embeds the *same* `StatutoryShell`.

These are independent full-page routes. Moving between them is a full navigation that destroys state:

- The map's "Register new application", "Open in Planner Console", and right-rail actions all call `router.push('/planner-workspace')` **with no context** — a stand selected on the map is forgotten the instant you arrive at the console.
- Login sends a planner to `/planner` (the map); the console is reachable only by hunting for a button.
- `/planner/statutory` duplicates the workflow that already lives inside the console, so there are two divergent statutory surfaces.
- The workflow's "Council Tools" drawer, `CaseFileDrawer.vue`, is a literal stub (`Component stub — coming soon`); `StatutoryShell` even wires seven named slots into it that no caller ever fills.

## 2. Goals

1. **One planner workspace.** The map and the console become two panes of a single shell that share one session and one active case file. Switching panes never loses map state or form state.
2. **Context flows.** Selecting a stand on the map and choosing to register it (or open its existing case) carries that stand into the statutory workflow, prefilled.
3. **All 5 stages proper.** Intake → Due Diligence → Committee Report → Permit → Notices: correct gating, correct hand-off of data between steps, reliable persistence. Build the stub drawer. Retire the orphan `/planner/statutory` page.
4. **Map-first login that lands in the integrated shell**, with the console one click away.

## 3. Non-goals

- No backend changes. All required endpoints (`dmApi`, `spatialApi.getSurroundingParcels`, tiles, wards) already exist.
- No changes to other roles' login/landing, even though `LoginView.ROLE_HOMES` and the router's `roleHome()` disagree for `eo` / `planning_clerk` / `gis_officer`. Noted as an observation; out of this scope.
- No redesign of the map's GIS toolset or the console's non-workflow sections beyond what integration requires.
- No new visual/brand system; reuse existing tokens and component styles.

## 4. Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Map ↔ console relationship | **Unified shell, shared state** (both panes kept alive; one case context). |
| Build approach | **Wrapper shell + `v-show` panes** (not `<keep-alive>` routing — it detaches the map DOM and breaks the WebGL canvas). |
| Login landing | **Map first**, inside the unified shell. |
| "All stages proper" | **Full audit** of 5 steps + **build the stub drawer** + **retire `/planner/statutory`**. |
| Section 5 extras | **Included**: abutting-owners-from-map and an autosave/sync chip. |

## 5. Architecture

### 5.1 New component: `PlannerShell.vue` (route `/planner`)

```
PlannerShell.vue
├─ top chrome
│   ├─ brand (Vungu RDC · Town Planning)
│   ├─ segmented switch:  [ Map ] [ Console ]
│   ├─ autosave/sync chip (Saved · Syncing · Offline)
│   └─ ProfileDropdown  (role "Town Planning Officer", logout → /login)
├─ provides  planner-case context        (lifted up; see 5.2)
├─ provides  PlannerShellApi             (see 5.3)
└─ panes (v-show; only the active one displayed)
    ├─ <VunguPlannerView>      mounted immediately
    └─ <PlannerWorkspaceView>  mounted on first open (v-if gate), then kept alive via v-show
```

Both panes stay mounted once opened, so the MapLibre instance and the console section/form state persist across switches. On switching **to** the map pane, the shell calls `map.resize()` (a map hidden with `display:none` loses correct canvas dimensions in MapLibre).

### 5.2 Shared planner-case context

`providePlannerCase()` (today called inside `PlannerWorkspaceView`) **moves up to `PlannerShell`**. Downstream consumers already use `useOrProvidePlannerCase()` / `usePlannerCase()`:

- `PlannerWorkspaceView` changes its `providePlannerCase()` call to `useOrProvidePlannerCase()` so it inherits the shell's instance instead of creating a second one.
- `StatutoryShell` already calls `useOrProvidePlannerCase()` → inherits the shell's instance.

Net effect: the **map pane and the console pane read and write the same `current` case file.** No second source of truth.

### 5.3 `PlannerShellApi` (provide/inject)

The shell defines and provides a small API object (closure over its own pane/section refs and the injected case ctx). Map and console call it instead of `router.push`.

```ts
interface PlannerShellApi {
  activePane:           Readonly<Ref<'map' | 'console'>>
  activeConsoleSection: Readonly<Ref<SectionKey>>           // dashboard | workflow | register | …
  showMap():            void
  showConsole(section?: SectionKey): void
  registerStandFromMap(feature: MapFeatureLike): void       // seed intake + open workflow Step 1
  openCaseForStand(permitId: string): Promise<void>         // loadFromPermit + open workflow
}
export function usePlannerShell(): PlannerShellApi           // inject helper
```

`PlannerWorkspaceView`'s internal `activeSection` ref is replaced by `shell.activeConsoleSection` so the map (and login deep-links) can drive which section the console shows.

### 5.4 Routing

- `/planner` → `PlannerShell` (default pane: **map**).
- `/planner-workspace` → **redirect** to `/planner` (shell opens the console pane; preserved as a deep link via a query flag, e.g. `/planner?pane=console`).
- `/planner/statutory` → **redirect** to `/planner?pane=console&section=workflow`.
- Login `roleHome('planner')` stays `/planner` (no change needed; now lands in the shell).
- The shell reads optional `?pane=` / `?section=` query on mount to support deep links and the redirects above.

## 6. The map ↔ console bridge (the integration itself)

### 6.1 Map feature → stand seed

The map's selected feature (`selectedFeature`, with `featureDisplayProps`, `_clickCoord`, `standPermits`) is normalized by a pure helper into a stand seed:

```ts
interface StandSeed { standNo: string; ward: string; description: string; centroid?: [number, number] }
function featureToStandSeed(feature): StandSeed   // tolerant of varied layer property names
```

`registerStandFromMap(feature)`:
1. `featureToStandSeed(feature)` → seed.
2. Write the seed into the case context as a one-shot `intakeSeed` (new field on the context, see 6.2).
3. `shell.showConsole('workflow')` → console opens on the Statutory Workflow section; `StatutoryShell` shows Step 1.

### 6.2 Step 1 consumes the seed

`usePlannerCase` gains a small one-shot inbox:

```ts
intakeSeed: Ref<StandSeed | null>
seedIntake(seed: StandSeed): void     // set
```

`Step1Intake.vue` watches `intakeSeed`; when set and no case is loaded, it prefills `form.standNo/ward/propertyDescription` and `selectedCentroid` (reusing its existing `applyStandSelection` shape), then clears the seed so re-entry doesn't clobber edits. This reuses the field mapping already present in `applyStandSelection`.

### 6.3 Existing-case path

When the selected stand already has permits (`standPermits` is populated), the map's "Permits" and "Checks" tabs show **"Open case"** → `openCaseForStand(permitId)` → `ctx.loadFromPermit(permitId)` → `showConsole('workflow')`. `StatutoryShell`'s existing `watch(current.permitId → step 2)` advances the workflow appropriately.

### 6.4 Console → map ("Show on map")

When `current` has a `property.centroid`, the workflow header / case drawer shows **"Show on map"** → `shell.showMap()` + `flyTo(centroid)`. (The map exposes a `flyTo(centroid)` via the shell API or a shared ref.)

## 7. "Make all stages proper" — audit checklist

For each step, verify and fix gating, hand-off, and persistence.

- **Step 1 — Intake.** Registration writes through `registerNew` (dmApi + localStorage + retry). Confirm `intakeSeed` prefill. **Bug fix:** `emptyCase()` defaults `proposal.devType: 'residential'`, which is not a valid `DevType` (`new_building | alteration | extension | change_of_use | subdivision | consolidation | rezoning | other`). Change the default to `'new_building'` to match `Step1Intake`'s form default and the type.
- **Step 2 — Due Diligence.** `step2Unlocked = !!current.permitId`. Confirm checks/referrals/title-deed conflict persist and that `dueDiligence.completedAt` is set by an explicit "complete" action (it gates Step 3).
- **Step 3 — Committee Report.** `step3Unlocked = !!dueDiligence.completedAt`. Confirm Step 2 referrals/objections are visible here; `recommendation` + `resolutionAt` persist (they gate Step 4).
- **Step 4 — Permit Drafting.** `step4Unlocked` requires a `resolutionAt` with recommendation `approve`/`approve_modified`. Confirm permit number, use class, conditions, issue date persist and read the Step 3 resolution.
- **Step 5 — Notices.** Acknowledgement, public notice (newspaper + abutting owners), objections, outcome letter persist. Wire abutting owners from the map (see 8.1).
- **Cross-cutting.** Every mutation calls `save()`. The sync chip (8.2) reflects `syncPending`. Confirm cross-tab `onWindowFocus` reload still behaves with the lifted context.

### 7.1 Build `CaseFileDrawer.vue`

Replace the stub with a real **"Case file at a glance"** drawer driven by `usePlannerCase()` (no slots):

- Header: registration no., file ref, status/clock summary.
- Applicant + property block; "Show on map" if a centroid exists.
- Step completion checklist (which of the 5 steps are done).
- Recent cases (from `planner_recent_cases` localStorage) → quick `loadFromPermit`.
- "Print case file" (browser print of the current case summary).

Simplify `StatutoryShell` to drop the seven unused named slots (`apps/resources/actions/scheme/consult/village/returns`) it forwards to the drawer; the drawer now renders its own content.

### 7.2 Retire `/planner/statutory`

`PlannerStatutoryView.vue` is removed from the router and replaced by the redirect in §5.4. (File may be deleted or left unreferenced; redirect is the behavior that matters.)

## 8. Modern, full-spec touches (included)

### 8.1 Abutting owners from the map
The map already has a buffer tool and `spatialApi.getSurroundingParcels(parcelId, bufferMeters)`. Add a "Use as abutting owners" action (in the map's Checks/Tools rail or Step 5) that pushes the returned owner list into `current.notices.publicNotice.abuttingOwners`, ready for the Section 26 public-notice step.

### 8.2 Autosave / sync chip
A small header chip bound to `ctx.syncPending` (and `navigator.onLine`): **Saved** (idle, synced) · **Syncing…** (retry queue draining) · **Offline — saved locally**. Gives officers confidence their work is captured. Reuses existing state; no new persistence.

## 9. Data flow (summary)

```
Map: click stand ──featureToStandSeed──► ctx.seedIntake() ──► showConsole('workflow')
                                                              │
Step1Intake watches intakeSeed ──prefill form──► registerNew() ──► ctx.current (permitId)
                                                              │
Step2 completedAt ─► Step3 resolutionAt ─► Step4 permit ─► Step5 notices
        every mutation ─► save() ─► localStorage (800ms debounce) + dmApi retry ─► sync chip
Map "Open case" ──► ctx.loadFromPermit(permitId) ──► showConsole('workflow')
Console "Show on map" ──► showMap() + flyTo(centroid)
```

## 10. Error handling

- Map feature missing a stand number → seed still opens Step 1 with whatever is known; stand-number field shows its existing required-field validation.
- `loadFromPermit` failure → existing toast + fall back to cached copy (behavior already in `usePlannerCase`).
- Switching to a not-yet-mounted console pane → `v-if` mounts it once; subsequent switches use `v-show`.
- Offline → registrations/edits persist locally and queue for retry (existing behavior); sync chip shows "Offline".

## 11. Testing

- **Unit (Vitest):** `featureToStandSeed` normalization; `intakeSeed` prefill in `Step1Intake`; shell API `showConsole/showMap/openCaseForStand` mutate pane/section/case correctly; `emptyCase().proposal.devType` is a valid `DevType`.
- **Component:** switching panes preserves map instance (map not re-created) and console form state; deep-link `?pane=console&section=workflow` opens the right place.
- **Manual walkthrough:** login → land on map → select stand → Register → Step 1 prefilled → complete Steps 1–5 with gating enforced → drawer shows correct case-file summary → "Show on map" recentres → abutting owners populate Step 5.
- Keep existing `Step1Intake.standpicker.spec.ts` green.

## 12. Files

**New**
- `src/views/planner/PlannerShell.vue`
- `src/composables/usePlannerShell.ts` (or provide/inject defined inline in the shell + a small `usePlannerShell` injector)
- `src/composables/featureToStandSeed.ts` (pure helper + types)

**Modified**
- `src/router/index.ts` — `/planner` → shell; `/planner-workspace` and `/planner/statutory` → redirects.
- `src/views/planner/VunguPlannerView.vue` — inject shell API; replace `router.push('/planner-workspace')` calls with `registerStandFromMap` / `openCaseForStand` / `showConsole`; fold header/logout into the shell; expose `flyTo`.
- `src/views/PlannerWorkspaceView.vue` — `useOrProvidePlannerCase()`; drive `activeSection` from shell API; fold header/logout into the shell.
- `src/composables/usePlannerCase.ts` — add `intakeSeed` + `seedIntake`; fix `emptyCase()` `devType` default.
- `src/views/planner/Step1Intake.vue` — consume `intakeSeed`.
- `src/views/planner/CaseFileDrawer.vue` — real "Case file at a glance".
- `src/views/planner/StatutoryShell.vue` — drop unused slot plumbing; optional "Show on map".
- `src/views/planner/sections/*` — audit-driven fixes to step components (Step2–Step5) for gating/hand-off/persistence.

**Removed / retired**
- `src/views/PlannerStatutoryView.vue` (replaced by redirect).

## 13. Open questions

None blocking. The two Section 8 touches are intentionally low-surface and can be deferred without affecting the core integration if scope needs trimming during implementation.
