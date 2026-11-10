# Planner Unified Shell Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the planner map (`/planner`) and the planner console (`/planner-workspace`) into one shell that shares a single case file, so selecting a stand on the map carries it into the statutory workflow and no state is lost when switching views.

**Architecture:** A new `PlannerShell.vue` becomes `/planner`. It owns thin top chrome (brand · Map|Console switch · sync chip · profile), *provides* one `providePlannerCase()` context and a `PlannerShellApi`, and renders the existing map and console as `v-show` panes (map mounted immediately; console lazy-mounted then kept alive). The map and console call the shell API instead of `router.push`. `/planner-workspace` and `/planner/statutory` become redirects into the shell.

**Tech Stack:** Vue 3 (`<script setup>`), Pinia, Vue Router 4, MapLibre GL, Vitest + `@vue/test-utils` (happy-dom), TypeScript.

**Conventions for every task:**
- Run a single test file with: `npx vitest run <path>`
- Type-check with: `npm run type-check`
- Build with: `npm run build`
- Commit messages omit any `Co-Authored-By` trailer (user preference).
- Work on the current branch `feat/planner-statutory-shell`.

---

## File Structure

**New files**
- `src/composables/featureToStandSeed.ts` — pure helper: clicked map feature → `StandSeed`.
- `src/composables/usePlannerShell.ts` — `PlannerShellApi` type, injection key, `providePlannerShell` / `usePlannerShell`.
- `src/views/planner/PlannerShell.vue` — the shell (chrome + panes + providers).
- Test files alongside, under `src/**/__tests__/`.

**Modified files**
- `src/composables/usePlannerCase.ts` — add `intakeSeed` + `seedIntake`; fix `emptyCase()` `devType`.
- `src/views/planner/Step1Intake.vue` — consume `intakeSeed`; persist centroid into the case.
- `src/router/index.ts` — `/planner` → shell; redirects for `/planner-workspace` and `/planner/statutory`.
- `src/views/PlannerWorkspaceView.vue` — inherit case ctx; drive section from shell; drop duplicate chrome.
- `src/views/planner/VunguPlannerView.vue` — inject shell API; rewire nav buttons; expose `resizeMap`/`flyTo`; drop duplicate chrome.
- `src/views/planner/CaseFileDrawer.vue` — replace stub with "Case file at a glance".
- `src/views/planner/StatutoryShell.vue` — drop unused drawer slots.

**Retired**
- `src/views/PlannerStatutoryView.vue` — no longer routed (replaced by redirect).

---

## Task 1: `featureToStandSeed` pure helper

**Files:**
- Create: `src/composables/featureToStandSeed.ts`
- Test: `src/composables/__tests__/featureToStandSeed.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/composables/__tests__/featureToStandSeed.spec.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { featureToStandSeed } from '@/composables/featureToStandSeed'

describe('featureToStandSeed', () => {
  it('extracts stand, ward, description from common property keys', () => {
    const seed = featureToStandSeed({
      properties: { stand_number: '1234', ward: 'Ward 5', land_use: 'Residential' },
    })
    expect(seed.standNo).toBe('1234')
    expect(seed.ward).toBe('Ward 5')
    expect(seed.description).toBe('Residential')
  })

  it('falls back across alternative key spellings and coerces numbers', () => {
    const seed = featureToStandSeed({ properties: { erf_no: 88, suburb: 'Mkoba' } })
    expect(seed.standNo).toBe('88')
    expect(seed.ward).toBe('Mkoba')
  })

  it('parses a centroid from a "lng, lat" click coordinate string', () => {
    const seed = featureToStandSeed({ properties: {}, _clickCoord: '29.82, -19.45' })
    expect(seed.centroid).toEqual([29.82, -19.45])
  })

  it('returns empty strings and no centroid for an empty/null feature', () => {
    expect(featureToStandSeed(null)).toEqual({
      standNo: '', ward: '', description: '', centroid: undefined,
    })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/composables/__tests__/featureToStandSeed.spec.ts`
Expected: FAIL — cannot resolve `@/composables/featureToStandSeed`.

- [ ] **Step 3: Write minimal implementation**

Create `src/composables/featureToStandSeed.ts`:

```ts
// Normalises a clicked map feature into the minimal "stand seed" the
// statutory intake form needs. Map features come from many PostGIS layers
// whose property names are not consistent, so we probe candidate keys per
// field and fall back to empty strings.

export interface StandSeed {
  standNo: string
  ward: string
  description: string
  centroid?: [number, number]
}

// A clicked feature as VunguPlannerView exposes it: arbitrary GeoJSON
// properties plus a few underscore-prefixed helpers attached on click.
export interface MapFeatureLike {
  properties?: Record<string, unknown> | null
  _clickCoord?: string | null
  _center?: [number, number] | null
}

const STAND_KEYS = ['stand_number', 'stand_no', 'standno', 'stand', 'parcel_id',
  'parcelid', 'erf_number', 'erf_no', 'plot_number', 'plot_no']
const WARD_KEYS  = ['ward', 'ward_name', 'ward_no', 'wardno', 'suburb_ward', 'suburb']
const DESC_KEYS  = ['description', 'desc', 'land_use', 'landuse', 'use', 'name', 'label']

function firstString(props: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const v = props[k]
    if (typeof v === 'string' && v.trim()) return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return ''
}

function parseClickCoord(s: string | null | undefined): [number, number] | undefined {
  if (!s) return undefined
  const m = s.match(/(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)/)
  if (!m) return undefined
  const a = Number(m[1]); const b = Number(m[2])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return undefined
  return [a, b]
}

export function featureToStandSeed(feature: MapFeatureLike | null | undefined): StandSeed {
  const props = (feature?.properties ?? {}) as Record<string, unknown>
  const centroid =
    (feature?._center as [number, number] | undefined) ??
    parseClickCoord(feature?._clickCoord)
  return {
    standNo: firstString(props, STAND_KEYS),
    ward: firstString(props, WARD_KEYS),
    description: firstString(props, DESC_KEYS),
    centroid,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/composables/__tests__/featureToStandSeed.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/composables/featureToStandSeed.ts src/composables/__tests__/featureToStandSeed.spec.ts
git commit -m "feat(planner): featureToStandSeed normaliser for map to intake handoff"
```

---

## Task 2: `usePlannerCase` — intake seed + devType fix

**Files:**
- Modify: `src/composables/usePlannerCase.ts`
- Test: `src/composables/__tests__/usePlannerCase.seed.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/composables/__tests__/usePlannerCase.seed.spec.ts`:

```ts
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, it, expect } from 'vitest'
import { providePlannerCase, emptyCase, type PlannerCaseContext } from '@/composables/usePlannerCase'

function withCase(): PlannerCaseContext {
  let ctx!: PlannerCaseContext
  const Comp = defineComponent({ setup() { ctx = providePlannerCase(); return () => null } })
  mount(Comp)
  return ctx
}

describe('usePlannerCase seed + defaults', () => {
  it('emptyCase() has a valid DevType default', () => {
    expect(emptyCase().proposal.devType).toBe('new_building')
  })

  it('seedIntake stores a one-shot stand seed', () => {
    const ctx = withCase()
    expect(ctx.intakeSeed.value).toBeNull()
    ctx.seedIntake({ standNo: '1234', ward: 'Ward 5', description: 'Residential' })
    expect(ctx.intakeSeed.value).toEqual({ standNo: '1234', ward: 'Ward 5', description: 'Residential' })
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/composables/__tests__/usePlannerCase.seed.spec.ts`
Expected: FAIL — `emptyCase().proposal.devType` is `'residential'`, and `ctx.intakeSeed` / `ctx.seedIntake` do not exist.

- [ ] **Step 3: Make the changes**

In `src/composables/usePlannerCase.ts`:

3a. Add the import near the top (after the existing imports):

```ts
import type { StandSeed } from './featureToStandSeed'
```

3b. Fix the invalid default in `emptyCase()` — change this line:

```ts
    proposal:  { devType:'residential', description:'', estimatedCost:0,
```

to:

```ts
    proposal:  { devType:'new_building', description:'', estimatedCost:0,
```

3c. Extend the `PlannerCaseContext` interface — add these two members:

```ts
  intakeSeed:  Ref<StandSeed | null>
  seedIntake:  (seed: StandSeed) => void
```

3d. Inside `providePlannerCase()`, near the other `ref()` declarations (e.g. after `const syncPending = ref(false)`), add:

```ts
  const intakeSeed = ref<StandSeed | null>(null)
  function seedIntake(seed: StandSeed) { intakeSeed.value = seed }
```

3e. Add both to the returned `ctx` object (in the `const ctx: PlannerCaseContext = { … }` literal):

```ts
    intakeSeed,
    seedIntake,
```

- [ ] **Step 4: Run test + type-check to verify they pass**

Run: `npx vitest run src/composables/__tests__/usePlannerCase.seed.spec.ts`
Expected: PASS (2 tests).

Run: `npm run type-check`
Expected: no new errors referencing `usePlannerCase.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/composables/usePlannerCase.ts src/composables/__tests__/usePlannerCase.seed.spec.ts
git commit -m "feat(planner): add intakeSeed to case context; fix invalid devType default"
```

---

## Task 3: `Step1Intake` consumes the seed and persists centroid

**Files:**
- Modify: `src/views/planner/Step1Intake.vue`
- Test: `src/views/planner/__tests__/Step1Intake.intakeseed.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/views/planner/__tests__/Step1Intake.intakeseed.spec.ts`:

```ts
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, it, expect, vi } from 'vitest'

const intakeSeed = ref<any>(null)
const current = ref<any>(null)

vi.mock('@/composables/usePlannerCase', () => ({
  usePlannerCase: () => ({
    current,
    intakeSeed,
    registerNew: vi.fn(),
    loadFromPermit: vi.fn(),
    syncPending: ref(false),
  }),
}))
vi.mock('@/composables/useUiFeedback', () => ({
  useUiFeedback: () => ({ showToast: vi.fn(), parseApiError: () => '', openMessageBox: vi.fn() }),
}))
vi.mock('@/services/developmentManagementService', () => ({
  dmApi: { listPermits: vi.fn().mockResolvedValue({ data: [] }) },
}))

import Step1Intake from '@/views/planner/Step1Intake.vue'

describe('Step1Intake intake seed', () => {
  it('prefills the form from a stand seed and clears it', async () => {
    intakeSeed.value = { standNo: '4567', ward: 'Ward 9', description: 'Vacant', centroid: [29.8, -19.4] }
    const wrapper = mount(Step1Intake, {
      global: { stubs: { StandPickerModal: true, UiFeedback: true, FieldError: true } },
    })
    await flushPromises()
    expect((wrapper.vm as any).form.standNo).toBe('4567')
    expect((wrapper.vm as any).form.ward).toBe('Ward 9')
    expect((wrapper.vm as any).selectedCentroid).toEqual([29.8, -19.4])
    expect(intakeSeed.value).toBeNull() // consumed
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/planner/__tests__/Step1Intake.intakeseed.spec.ts`
Expected: FAIL — form not prefilled (no seed watcher yet).

- [ ] **Step 3: Make the changes**

In `src/views/planner/Step1Intake.vue`:

3a. Add `watch` to the Vue import:

```ts
import { ref, onMounted, watch } from 'vue'
```

3b. Pull `intakeSeed` out of the composable — change:

```ts
const { current, registerNew, loadFromPermit, syncPending } = usePlannerCase()
```

to:

```ts
const { current, registerNew, loadFromPermit, syncPending, intakeSeed } = usePlannerCase()
```

3c. After the `const showRegisterForm = ref(true)` line (end of `<script setup>`), add the watcher:

```ts
// Consume a one-shot stand seed handed over from the map. Only prefill a
// fresh form (never clobber a loaded/edited case), then clear the seed.
watch(intakeSeed, (seed) => {
  if (!seed) return
  if (!current.value) {
    if (seed.standNo)     form.value.standNo            = seed.standNo
    if (seed.ward)        form.value.ward               = seed.ward
    if (seed.description) form.value.propertyDescription = seed.description
    if (seed.centroid)    selectedCentroid.value         = seed.centroid
    showRegisterForm.value = true
  }
  intakeSeed.value = null
}, { immediate: true })
```

3d. Persist the centroid into the case on submit — in `onSubmit`, change the `property:` line of the `registerNew({...})` payload:

```ts
      property:  { standNo: form.value.standNo, ward: form.value.ward,
                   description: form.value.propertyDescription, titleDeedNo: form.value.titleDeedNo },
```

to:

```ts
      property:  { standNo: form.value.standNo, ward: form.value.ward,
                   description: form.value.propertyDescription, titleDeedNo: form.value.titleDeedNo,
                   centroid: selectedCentroid.value ?? undefined },
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/views/planner/__tests__/Step1Intake.intakeseed.spec.ts`
Expected: PASS.

Run: `npx vitest run src/views/planner/__tests__/Step1Intake.standpicker.spec.ts`
Expected: PASS (existing test still green).

- [ ] **Step 5: Commit**

```bash
git add src/views/planner/Step1Intake.vue src/views/planner/__tests__/Step1Intake.intakeseed.spec.ts
git commit -m "feat(planner): Step 1 consumes map stand seed and persists centroid"
```

---

## Task 4: `usePlannerShell` contract

**Files:**
- Create: `src/composables/usePlannerShell.ts`
- Test: `src/composables/__tests__/usePlannerShell.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/composables/__tests__/usePlannerShell.spec.ts`:

```ts
import { mount } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, it, expect } from 'vitest'
import { usePlannerShell } from '@/composables/usePlannerShell'

describe('usePlannerShell', () => {
  it('throws a clear error when used without a provider', () => {
    const Comp = defineComponent({ setup() { usePlannerShell(); return () => null } })
    expect(() => mount(Comp)).toThrow(/outside <PlannerShell>/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/composables/__tests__/usePlannerShell.spec.ts`
Expected: FAIL — cannot resolve `@/composables/usePlannerShell`.

- [ ] **Step 3: Write minimal implementation**

Create `src/composables/usePlannerShell.ts`:

```ts
// Shell API shared between the planner map pane and the console pane.
// Provided by <PlannerShell>; injected by VunguPlannerView, PlannerWorkspaceView,
// and the statutory drawer. Lets the panes drive each other without router
// navigations that would destroy map/form state.

import { inject, provide, type InjectionKey, type Ref } from 'vue'

export type PlannerPane = 'map' | 'console'
export type SectionKey =
  | 'dashboard' | 'workflow' | 'register' | 'enforcement' | 'plans' | 'reports' | 'reference'

export const SECTION_KEYS: readonly SectionKey[] =
  ['dashboard', 'workflow', 'register', 'enforcement', 'plans', 'reports', 'reference']

export interface PlannerShellApi {
  activePane: Readonly<Ref<PlannerPane>>
  activeConsoleSection: Readonly<Ref<SectionKey>>
  showMap: () => void
  showConsole: (section?: SectionKey) => void
  /** Seed Step 1 intake from a clicked map feature and open the workflow. */
  registerStandFromMap: (feature: unknown) => void
  /** Load an existing permit into the case and open the workflow. */
  openCaseForStand: (permitId: string) => Promise<void>
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/composables/__tests__/usePlannerShell.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/composables/usePlannerShell.ts src/composables/__tests__/usePlannerShell.spec.ts
git commit -m "feat(planner): PlannerShellApi provide/inject contract"
```

---

## Task 5: `PlannerShell.vue`

**Files:**
- Create: `src/views/planner/PlannerShell.vue`
- Test: `src/views/planner/__tests__/PlannerShell.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/views/planner/__tests__/PlannerShell.spec.ts`:

```ts
import { mount, flushPromises } from '@vue/test-utils'
import { createRouter, createMemoryHistory } from 'vue-router'
import { createPinia, setActivePinia } from 'pinia'
import { describe, it, expect, beforeEach } from 'vitest'
import PlannerShell from '@/views/planner/PlannerShell.vue'

function makeRouter(initial: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: '/planner', name: 'planner', component: PlannerShell }],
  })
  router.push(initial)
  return router
}

const stubs = {
  VunguPlannerView: { template: '<div class="map-pane-stub" />', methods: { resizeMap() {}, flyTo() {} } },
  PlannerWorkspaceView: { template: '<div class="console-pane-stub" />' },
  ProfileDropdown: true,
}

describe('PlannerShell', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('shows the map pane by default and lazy-mounts the console on switch', async () => {
    const router = makeRouter('/planner')
    await router.isReady()
    const wrapper = mount(PlannerShell, { global: { plugins: [router], stubs } })
    await flushPromises()
    expect(wrapper.find('.map-pane-stub').exists()).toBe(true)
    expect(wrapper.find('.console-pane-stub').exists()).toBe(false)

    await wrapper.findAll('.ps-switch button')[1].trigger('click') // Console
    await flushPromises()
    expect(wrapper.find('.console-pane-stub').exists()).toBe(true)
  })

  it('opens the console pane when ?pane=console is present', async () => {
    const router = makeRouter('/planner?pane=console&section=workflow')
    await router.isReady()
    const wrapper = mount(PlannerShell, { global: { plugins: [router], stubs } })
    await flushPromises()
    expect(wrapper.find('.console-pane-stub').exists()).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/planner/__tests__/PlannerShell.spec.ts`
Expected: FAIL — cannot resolve `@/views/planner/PlannerShell.vue`.

- [ ] **Step 3: Write the implementation**

Create `src/views/planner/PlannerShell.vue`:

```vue
<script setup lang="ts">
// Unified planner workspace. Hosts the spatial map and the statutory console
// as kept-alive panes that share ONE case-file context. The map seeds intake
// and the console reads it back, so a stand selected on the map flows straight
// into the Section 26 workflow.
import { ref, computed, onMounted, onUnmounted, nextTick } from 'vue'
import { useRouter, useRoute } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { providePlannerCase } from '@/composables/usePlannerCase'
import {
  providePlannerShell, SECTION_KEYS,
  type PlannerPane, type SectionKey, type PlannerShellApi,
} from '@/composables/usePlannerShell'
import { featureToStandSeed } from '@/composables/featureToStandSeed'
import ProfileDropdown from '@/components/shared/ProfileDropdown.vue'
import VunguPlannerView from '@/views/planner/VunguPlannerView.vue'
import PlannerWorkspaceView from '@/views/PlannerWorkspaceView.vue'
import { Map as MapIcon, Gavel, WifiOff, Cloud, CloudUpload } from 'lucide-vue-next'

const router = useRouter()
const route = useRoute()
const auth = useAuthStore()

// One case context shared by both panes.
const ctx = providePlannerCase()

const activePane = ref<PlannerPane>('map')
const activeConsoleSection = ref<SectionKey>('dashboard')
const consoleMounted = ref(false)

const mapPane = ref<InstanceType<typeof VunguPlannerView> | null>(null)

function showMap() {
  activePane.value = 'map'
  // A map hidden with display:none loses correct canvas dimensions.
  nextTick(() => (mapPane.value as any)?.resizeMap?.())
}
function showConsole(section?: SectionKey) {
  if (section) activeConsoleSection.value = section
  consoleMounted.value = true
  activePane.value = 'console'
}
function registerStandFromMap(feature: unknown) {
  ctx.seedIntake(featureToStandSeed(feature as any))
  showConsole('workflow')
}
async function openCaseForStand(permitId: string) {
  await ctx.loadFromPermit(permitId)
  showConsole('workflow')
}
function flyTo(centroid: [number, number]) {
  showMap()
  nextTick(() => (mapPane.value as any)?.flyTo?.(centroid))
}

const api: PlannerShellApi = {
  activePane: computed(() => activePane.value),
  activeConsoleSection: computed(() => activeConsoleSection.value),
  showMap, showConsole, registerStandFromMap, openCaseForStand, flyTo,
}
providePlannerShell(api)

// Deep links / redirects: /planner?pane=console&section=workflow
onMounted(() => {
  const section = route.query.section
  if (typeof section === 'string' && (SECTION_KEYS as readonly string[]).includes(section)) {
    activeConsoleSection.value = section as SectionKey
  }
  if (route.query.pane === 'console') showConsole()
})

// Online/sync chip.
const online = ref(typeof navigator !== 'undefined' ? navigator.onLine : true)
function onOnline() { online.value = true }
function onOffline() { online.value = false }
onMounted(() => {
  window.addEventListener('online', onOnline)
  window.addEventListener('offline', onOffline)
})
onUnmounted(() => {
  window.removeEventListener('online', onOnline)
  window.removeEventListener('offline', onOffline)
})
const syncState = computed<'offline' | 'syncing' | 'saved'>(() => {
  if (!online.value) return 'offline'
  if (ctx.syncPending.value) return 'syncing'
  return 'saved'
})
const syncLabel = computed(() =>
  syncState.value === 'offline' ? 'Offline — saved locally'
  : syncState.value === 'syncing' ? 'Syncing…' : 'Saved')

function handleLogout() {
  auth.logout()
  router.push('/login')
}
</script>

<template>
  <div class="ps-root">
    <header class="ps-chrome">
      <div class="ps-brand">
        <div class="ps-logo"><Gavel :size="16" /></div>
        <div>
          <span class="ps-title">Town Planning Officer</span>
          <span class="ps-sub">Vungu RDC · RTCP Act [Ch. 29:12]</span>
        </div>
      </div>

      <div class="ps-switch" role="tablist" aria-label="Planner view">
        <button role="tab" :aria-selected="activePane === 'map'"
                :class="{ active: activePane === 'map' }" @click="showMap">
          <MapIcon :size="14" /> Map
        </button>
        <button role="tab" :aria-selected="activePane === 'console'"
                :class="{ active: activePane === 'console' }" @click="showConsole()">
          <Gavel :size="14" /> Console
        </button>
      </div>

      <div class="ps-sync" :class="syncState" :title="syncLabel">
        <component :is="syncState === 'offline' ? WifiOff : syncState === 'syncing' ? CloudUpload : Cloud" :size="13" />
        <span>{{ syncLabel }}</span>
      </div>

      <ProfileDropdown role-label="Town Planning Officer" avatar-key="planner_avatar" @logout="handleLogout" />
    </header>

    <div class="ps-body">
      <VunguPlannerView ref="mapPane" v-show="activePane === 'map'" />
      <PlannerWorkspaceView v-if="consoleMounted" v-show="activePane === 'console'" />
    </div>
  </div>
</template>

<style scoped>
.ps-root { display:flex; flex-direction:column; height:100vh; background:#f1f5f9; color:#0f172a; }
.ps-chrome { display:flex; align-items:center; gap:0.75rem; padding:0.5rem 1rem;
  background:#fff; border-bottom:1px solid #e2e8f0; box-shadow:0 1px 2px rgba(15,23,42,0.04); flex-shrink:0; }
.ps-brand { display:flex; align-items:center; gap:0.55rem; }
.ps-logo { display:inline-flex; align-items:center; justify-content:center;
  width:1.85rem; height:1.85rem; border-radius:0.4rem; background:#1d4ed8; color:#fff; }
.ps-title { display:block; font-size:0.85rem; font-weight:700; line-height:1.1; }
.ps-sub   { display:block; font-size:0.65rem; color:#64748b; line-height:1.4; }
.ps-switch { display:inline-flex; gap:0.2rem; margin-left:1rem; padding:0.2rem;
  background:#f1f5f9; border:1px solid #e2e8f0; border-radius:0.5rem; }
.ps-switch button { display:inline-flex; align-items:center; gap:0.3rem;
  padding:0.3rem 0.7rem; font-size:0.75rem; font-weight:600; border:none;
  background:transparent; color:#475569; border-radius:0.35rem; cursor:pointer; }
.ps-switch button.active { background:#fff; color:#1d4ed8; box-shadow:0 1px 2px rgba(15,23,42,0.08); }
.ps-sync { display:inline-flex; align-items:center; gap:0.3rem; margin-left:auto;
  font-size:0.7rem; font-weight:600; padding:0.25rem 0.6rem; border-radius:9999px;
  background:#f0fdf4; color:#166534; }
.ps-sync.syncing { background:#eff6ff; color:#1e40af; }
.ps-sync.offline { background:#fef2f2; color:#991b1b; }
.ps-body { flex:1; min-height:0; position:relative; display:flex; }
.ps-body > * { flex:1; min-width:0; }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/planner/__tests__/PlannerShell.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/planner/PlannerShell.vue src/views/planner/__tests__/PlannerShell.spec.ts
git commit -m "feat(planner): PlannerShell hosting map + console as shared-state panes"
```

---

## Task 6: Route the shell and redirect the old surfaces

**Files:**
- Modify: `src/router/index.ts`
- Test: `src/router/__tests__/planner-routes.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/router/__tests__/planner-routes.spec.ts`:

```ts
import { createPinia, setActivePinia } from 'pinia'
import { describe, it, expect, beforeEach } from 'vitest'
import router from '@/router'

describe('planner routes', () => {
  beforeEach(() => setActivePinia(createPinia()))

  it('serves the shell at /planner', () => {
    const r = router.resolve('/planner')
    expect(r.matched.length).toBeGreaterThan(0)
  })

  it('redirects /planner-workspace into the console pane', () => {
    const r = router.resolve('/planner-workspace')
    expect(r.path).toBe('/planner')
    expect(r.query.pane).toBe('console')
  })

  it('redirects /planner/statutory into the workflow section', () => {
    const r = router.resolve('/planner/statutory')
    expect(r.path).toBe('/planner')
    expect(r.query.pane).toBe('console')
    expect(r.query.section).toBe('workflow')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/router/__tests__/planner-routes.spec.ts`
Expected: FAIL — `/planner-workspace` resolves to its own path, not a redirect.

- [ ] **Step 3: Make the changes**

In `src/router/index.ts`:

3a. Add the shell import alongside the other view imports:

```ts
const PlannerShell = () => import('../views/planner/PlannerShell.vue')
```

3b. Remove these now-unused route-level imports (the shell imports the map/console directly; the statutory page is retired):

```ts
const VunguPlannerView = () => import('../views/planner/VunguPlannerView.vue')
const PlannerStatutoryView = () => import('../views/PlannerStatutoryView.vue')
const PlannerWorkspaceView = () => import('../views/PlannerWorkspaceView.vue')
```

3c. Replace the `/planner` route's `component`:

```ts
    {
      path: '/planner',
      name: 'planner',
      component: VunguPlannerView,
      meta: {
        title: 'Vungu RDC Planner - Spatial Data Portal',
        requiresAuth: true
      }
    },
```

with:

```ts
    {
      path: '/planner',
      name: 'planner',
      component: PlannerShell,
      meta: {
        title: 'Town Planning Officer — Vungu RDC',
        requiresAuth: true
      }
    },
```

3d. Replace the `/planner/statutory` route:

```ts
    {
      path: '/planner/statutory',
      name: 'planner-statutory',
      component: PlannerStatutoryView,
      meta: {
        title: 'Statutory Workflow — Vungu RDC Planner',
        requiresAuth: true
      }
    },
```

with:

```ts
    {
      path: '/planner/statutory',
      redirect: () => ({ path: '/planner', query: { pane: 'console', section: 'workflow' } }),
    },
```

3e. Replace the `/planner-workspace` route:

```ts
    {
      path: '/planner-workspace',
      name: 'planner-workspace',
      component: PlannerWorkspaceView,
      meta: {
        title: 'Town Planning Officer Console — Vungu RDC',
        requiresAuth: true
      }
    },
```

with:

```ts
    {
      path: '/planner-workspace',
      redirect: () => ({ path: '/planner', query: { pane: 'console' } }),
    },
```

- [ ] **Step 4: Run test + type-check to verify they pass**

Run: `npx vitest run src/router/__tests__/planner-routes.spec.ts`
Expected: PASS (3 tests).

Run: `npm run type-check`
Expected: no unused-import errors in `router/index.ts`.

- [ ] **Step 5: Commit**

```bash
git add src/router/index.ts src/router/__tests__/planner-routes.spec.ts
git commit -m "feat(planner): route /planner to the shell; redirect workspace + statutory"
```

---

## Task 7: `PlannerWorkspaceView` inherits context and shell-driven section

**Files:**
- Modify: `src/views/PlannerWorkspaceView.vue`

> No new unit test — this is a wiring refactor verified by type-check, the existing PlannerShell test, and the manual walkthrough in Task 10. Keep the diff surgical.

- [ ] **Step 1: Switch to the inherited case context**

Change the import:

```ts
import { providePlannerCase } from '@/composables/usePlannerCase'
```

to:

```ts
import { useOrProvidePlannerCase } from '@/composables/usePlannerCase'
```

and change the call:

```ts
providePlannerCase()
```

to:

```ts
useOrProvidePlannerCase()
```

- [ ] **Step 2: Drive the active section from the shell**

Add the shell import (next to the existing imports):

```ts
import { usePlannerShell, type SectionKey } from '@/composables/usePlannerShell'
```

Remove the local `SectionKey` type alias and the local `activeSection` ref:

```ts
type SectionKey = 'dashboard'|'workflow'|'register'|'enforcement'|'plans'|'reports'|'reference'
```
```ts
const activeSection = ref<SectionKey>('dashboard')
```

Add, after `const authStore = useAuthStore()`:

```ts
const shell = usePlannerShell()
const activeSection = shell.activeConsoleSection           // readonly computed
function goSection(key: SectionKey) { shell.showConsole(key) }
```

- [ ] **Step 3: Repoint section changes through the shell**

In the template, every section change becomes a `goSection(...)` call:

- Nav buttons: change `@click="activeSection = s.key"` to `@click="goSection(s.key)"`
- Dashboard handler: change `@open-section="(k: SectionKey) => activeSection = k"` to `@open-section="(k: SectionKey) => goSection(k)"`
- PermitRegister handler: change `@open-permit="activeSection = 'workflow'"` to `@open-permit="goSection('workflow')"`

`activeMeta` already reads `activeSection.value` — it now reads the shell's computed; no change needed.

- [ ] **Step 4: Remove the duplicate chrome (now owned by the shell)**

Delete the brand block, the back-to-map button, and the ProfileDropdown from `<header class="pw-header">`, keeping the sidebar collapse toggle and the section title. Concretely, remove:

```vue
      <button class="pw-icon-btn" @click="router.push('/planner')" title="Open spatial map view">
        <ArrowLeft :size="14" />
      </button>
      <div class="pw-brand">
        <div class="pw-icon"><Gavel :size="16" /></div>
        <div>
          <span class="pw-title">Town Planning Officer Console</span>
          <span class="pw-sub">Vungu RDC · RTCP Act [Ch. 29:12]</span>
        </div>
      </div>
```

and

```vue
      <ProfileDropdown
        role-label="Town Planning Officer"
        avatar-key="planner_avatar"
        @logout="handleLogout"
      />
```

Then remove the now-unused script bits: the `ProfileDropdown` import, `handleLogout`, `useRouter`/`router`, `useAuthStore`/`authStore`, and the `ArrowLeft`/`Gavel` icon imports if no longer referenced. (Let `npm run type-check` flag any that remain used and keep those.)

- [ ] **Step 5: Verify and commit**

Run: `npm run type-check`
Expected: no errors in `PlannerWorkspaceView.vue`.

Run: `npx vitest run src/views/planner/__tests__/PlannerShell.spec.ts`
Expected: PASS (console stub still mounts).

```bash
git add src/views/PlannerWorkspaceView.vue
git commit -m "refactor(planner): console inherits shell case context + section state"
```

---

## Task 8: `VunguPlannerView` uses the shell API

**Files:**
- Modify: `src/views/planner/VunguPlannerView.vue`

> Wiring refactor of a large file; edits are localized. Verified by type-check + manual walkthrough (Task 10).

- [ ] **Step 1: Inject the shell + case context and expose map controls**

Add imports (next to the existing `useRouter` / `plannerApi` imports):

```ts
import { usePlannerShell } from '@/composables/usePlannerShell'
import { usePlannerCase } from '@/composables/usePlannerCase'
```

After `const authStore = useAuthStore()`:

```ts
const shell = usePlannerShell()
const { current } = usePlannerCase()

function resizeMap() { mapInstance.value?.resize() }
function flyTo(centroid: [number, number]) {
  mapInstance.value?.flyTo({ center: centroid, zoom: 17, speed: 1.2 })
}
defineExpose({ resizeMap, flyTo })

// "Register"/"Open in console" from a selected map feature. If the stand
// already has a permit, open that case; otherwise seed a fresh intake.
function actOnSelectedStand() {
  if (standPermits.value.length) shell.openCaseForStand(standPermits.value[0].id)
  else shell.registerStandFromMap(selectedFeature.value)
}
function goRegister() {
  if (selectedFeature.value) shell.registerStandFromMap(selectedFeature.value)
  else shell.showConsole('workflow')
}
```

> Before wiring, confirm the existing ref names by searching the file for `standPermits` and `selectedFeature`. They are referenced in the right-rail Permits/Checks tabs (e.g. `standPermits.length`, `selectedFeature._layerName`). Use whatever names the file already defines.

- [ ] **Step 2: Rewire the navigation buttons in the template**

Replace each occurrence:

- Header toolbar "Planner Console" button — remove it entirely (the shell switch replaces it). Delete:

```vue
        <div class="ph-sep"></div>
        <button class="ph-tool ph-tool--accent" @click="router.push('/planner-workspace')"
                title="Open the full Town Planning Officer console (dashboard, register, enforcement, building plans, reports, reference)">
          <Gavel :size="14" /><span>Planner Console</span>
        </button>
```

- Ward-section "Register new application": change `@click="router.push('/planner-workspace')"` to `@click="goRegister"`.
- Permits tab "Open in Planner Console": change `@click="router.push('/planner-workspace')"` to `@click="actOnSelectedStand"`.
- Checks tab "Full due-diligence checklist": change `@click="router.push('/planner-workspace')"` to `@click="actOnSelectedStand"`.
- Tools tab "Planner Console": change `@click="router.push('/planner-workspace')"` to `@click="shell.showConsole()"`.

- [ ] **Step 3: Remove duplicate chrome**

Remove the brand block and the ProfileDropdown from `<header class="planner-header">`, keeping the search box and the draw toolbar. Delete:

```vue
      <div class="ph-brand">
        <div class="ph-icon"><Map :size="16" /></div>
        <div>
          <span class="ph-title">Planning Command Center</span>
          <span class="ph-sub">Vungu RDC · Spatial Planning Portal</span>
        </div>
      </div>
```

and

```vue
      <ProfileDropdown
        role-label="District Planner"
        avatar-key="planner_avatar"
        @logout="handleLogout"
      />
```

Then remove the now-unused `ProfileDropdown` import, `handleLogout`, and `useRouter`/`router` if no longer referenced. (Keep `router` only if other code still uses it — verify with `npm run type-check`.)

- [ ] **Step 4: Verify and commit**

Run: `npm run type-check`
Expected: no errors in `VunguPlannerView.vue`.

Run: `npm run build`
Expected: build succeeds.

```bash
git add src/views/planner/VunguPlannerView.vue
git commit -m "refactor(planner): map uses shell API for register/open-case; drop duplicate chrome"
```

---

## Task 9: Build the case-file drawer + clean up StatutoryShell slots

**Files:**
- Modify: `src/views/planner/CaseFileDrawer.vue`
- Modify: `src/views/planner/StatutoryShell.vue`
- Test: `src/views/planner/__tests__/CaseFileDrawer.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/views/planner/__tests__/CaseFileDrawer.spec.ts`:

```ts
import { mount } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, it, expect, vi } from 'vitest'

const current = ref<any>({
  registrationNo: 'VR-2026-0050', fileRef: 'file/VR-2026-0050', permitId: 'p1',
  applicant: { name: 'A. Moyo' }, property: { standNo: '1234', ward: 'Ward 5', centroid: [29.8, -19.4] },
  dueDiligence: { completedAt: '2026-06-01T00:00:00Z' },
  committeeReport: { resolutionAt: null }, permit: { issueDate: null },
  notices: { outcomeLetterSentAt: null },
})
const flyTo = vi.fn()
const showMap = vi.fn()

vi.mock('@/composables/usePlannerCase', () => ({ usePlannerCase: () => ({ current }) }))
vi.mock('@/composables/usePlannerShell', () => ({ usePlannerShell: () => ({ flyTo, showMap, openCaseForStand: vi.fn() }) }))

import CaseFileDrawer from '@/views/planner/CaseFileDrawer.vue'

describe('CaseFileDrawer', () => {
  it('shows step completion and flies to the case centroid', async () => {
    const wrapper = mount(CaseFileDrawer)
    // Steps 1 and 2 done, 3/4/5 not.
    expect(wrapper.findAll('.cf-step.done').length).toBe(2)
    await wrapper.find('.cf-show-on-map').trigger('click')
    expect(flyTo).toHaveBeenCalledWith([29.8, -19.4])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/planner/__tests__/CaseFileDrawer.spec.ts`
Expected: FAIL — drawer is a stub with no `.cf-step` / `.cf-show-on-map`.

- [ ] **Step 3: Replace the stub**

Overwrite `src/views/planner/CaseFileDrawer.vue`:

```vue
<script setup lang="ts">
// "Case file at a glance" — a slide-over summary of the active statutory case.
// Reads the shared planner-case context directly (no slots).
import { computed } from 'vue'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { usePlannerShell } from '@/composables/usePlannerShell'
import { X, MapPin, Printer, CheckCircle2, Circle } from 'lucide-vue-next'

defineEmits<{ close: [] }>()
const { current } = usePlannerCase()
const shell = usePlannerShell()

const steps = computed(() => {
  const c = current.value
  return [
    { label: '1 · Intake',        done: !!c?.permitId },
    { label: '2 · Due diligence', done: !!c?.dueDiligence?.completedAt },
    { label: '3 · Report',        done: !!c?.committeeReport?.resolutionAt },
    { label: '4 · Permit',        done: !!c?.permit?.issueDate },
    { label: '5 · Notices',       done: !!c?.notices?.outcomeLetterSentAt },
  ]
})

interface RecentCase { permitId: string; label: string; openedAt: string }
const recent = computed<RecentCase[]>(() => {
  try { return JSON.parse(localStorage.getItem('planner_recent_cases') || '[]') } catch { return [] }
})

const centroid = computed(() => current.value?.property?.centroid)
function showOnMap() { if (centroid.value) shell.flyTo(centroid.value) }
function printCaseFile() { window.print() }
</script>

<template>
  <aside class="cf-drawer" role="dialog" aria-label="Case file">
    <header class="cf-head">
      <strong>Case file</strong>
      <button class="cf-close" @click="$emit('close')" aria-label="Close"><X :size="14" /></button>
    </header>

    <div v-if="current" class="cf-body">
      <section class="cf-summary">
        <div class="cf-reg">{{ current.registrationNo || 'Unregistered draft' }}</div>
        <div class="cf-meta">{{ current.applicant?.name || '—' }}</div>
        <div class="cf-meta">Stand {{ current.property?.standNo || '—' }} · {{ current.property?.ward || '—' }}</div>
        <button v-if="centroid" class="cf-show-on-map" @click="showOnMap">
          <MapPin :size="12" /> Show on map
        </button>
      </section>

      <section class="cf-steps">
        <div v-for="s in steps" :key="s.label" class="cf-step" :class="{ done: s.done }">
          <component :is="s.done ? CheckCircle2 : Circle" :size="13" />
          <span>{{ s.label }}</span>
        </div>
      </section>

      <button class="cf-print" @click="printCaseFile">
        <Printer :size="12" /> Print case file
      </button>
    </div>
    <div v-else class="cf-empty">No active case. Register or open one from the workflow.</div>

    <section v-if="recent.length" class="cf-recent">
      <header>Recent cases</header>
      <ul>
        <li v-for="r in recent" :key="r.permitId">
          <button @click="shell.openCaseForStand(r.permitId)">{{ r.label }}</button>
        </li>
      </ul>
    </section>
  </aside>
</template>

<style scoped>
.cf-drawer { position:fixed; top:0; right:0; bottom:0; width:20rem; z-index:40;
  background:#fff; border-left:1px solid #e2e8f0; box-shadow:-4px 0 16px rgba(15,23,42,0.08);
  display:flex; flex-direction:column; }
.cf-head { display:flex; align-items:center; padding:0.6rem 0.85rem; border-bottom:1px solid #e2e8f0; }
.cf-head strong { flex:1; font-size:0.85rem; }
.cf-close { background:none; border:none; color:#64748b; cursor:pointer; }
.cf-body { padding:0.85rem; display:flex; flex-direction:column; gap:0.85rem; }
.cf-summary { display:flex; flex-direction:column; gap:0.2rem; }
.cf-reg { font-family:ui-monospace, monospace; font-weight:700; color:#0f172a; }
.cf-meta { font-size:0.75rem; color:#64748b; }
.cf-show-on-map { align-self:flex-start; margin-top:0.4rem; display:inline-flex; align-items:center;
  gap:0.3rem; padding:0.3rem 0.6rem; border:1px solid #e2e8f0; border-radius:0.35rem;
  background:#fff; color:#1d4ed8; font-size:0.72rem; font-weight:600; cursor:pointer; }
.cf-steps { display:flex; flex-direction:column; gap:0.3rem; }
.cf-step { display:flex; align-items:center; gap:0.4rem; font-size:0.75rem; color:#94a3b8; }
.cf-step.done { color:#166534; }
.cf-print { display:inline-flex; align-items:center; justify-content:center; gap:0.3rem;
  padding:0.45rem; border:1px solid #e2e8f0; border-radius:0.35rem; background:#fff;
  color:#475569; font-size:0.72rem; font-weight:600; cursor:pointer; }
.cf-empty { padding:1rem; font-size:0.78rem; color:#94a3b8; }
.cf-recent { border-top:1px solid #e2e8f0; padding:0.6rem 0.85rem; }
.cf-recent header { font-size:0.7rem; font-weight:700; text-transform:uppercase;
  letter-spacing:0.06em; color:#94a3b8; margin-bottom:0.4rem; }
.cf-recent ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.2rem; }
.cf-recent button { width:100%; text-align:left; background:none; border:none; cursor:pointer;
  font-size:0.72rem; color:#1d4ed8; padding:0.2rem 0; }
</style>
```

- [ ] **Step 4: Simplify `StatutoryShell.vue` (drop unused slots)**

In `src/views/planner/StatutoryShell.vue`, replace the drawer block:

```vue
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
```

with:

```vue
    <Transition name="drawer-slide">
      <CaseFileDrawer v-if="drawerOpen" @close="drawerOpen = false" />
    </Transition>
```

- [ ] **Step 5: Run test + type-check, then commit**

Run: `npx vitest run src/views/planner/__tests__/CaseFileDrawer.spec.ts`
Expected: PASS.

Run: `npm run type-check`
Expected: no errors in `CaseFileDrawer.vue` / `StatutoryShell.vue`.

```bash
git add src/views/planner/CaseFileDrawer.vue src/views/planner/StatutoryShell.vue src/views/planner/__tests__/CaseFileDrawer.spec.ts
git commit -m "feat(planner): real case-file drawer; drop dead StatutoryShell slots"
```

---

## Task 10: Stage-audit regression test + manual walkthrough

**Files:**
- Test: `src/composables/__tests__/usePlannerCase.gating.spec.ts`

- [ ] **Step 1: Write the gating state-machine test**

Create `src/composables/__tests__/usePlannerCase.gating.spec.ts`:

```ts
import { mount, flushPromises } from '@vue/test-utils'
import { defineComponent } from 'vue'
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/services/developmentManagementService', () => ({
  dmApi: {
    createPermit: vi.fn().mockResolvedValue({ id: 'perm-1', dev_register_no: 'VR-2026-0050', updated_at: new Date().toISOString() }),
  },
}))

import { providePlannerCase, emptyCase, type PlannerCaseContext } from '@/composables/usePlannerCase'

function withCase(): PlannerCaseContext {
  let ctx!: PlannerCaseContext
  mount(defineComponent({ setup() { ctx = providePlannerCase(); return () => null } }))
  return ctx
}

describe('statutory workflow gating', () => {
  it('unlocks each step only when its precondition is met', async () => {
    const ctx = withCase()
    expect(ctx.step2Unlocked.value).toBe(false)

    await ctx.registerNew({ ...emptyCase(), registrationNo: 'VR-2026-0050' })
    await flushPromises()
    expect(ctx.current.value?.permitId).toBe('perm-1')
    expect(ctx.step2Unlocked.value).toBe(true)   // Step 1 → Step 2

    ctx.current.value!.dueDiligence.completedAt = new Date().toISOString()
    expect(ctx.step3Unlocked.value).toBe(true)   // Step 2 → Step 3

    ctx.current.value!.committeeReport.resolutionAt = new Date().toISOString()
    ctx.current.value!.committeeReport.recommendation = 'refuse'
    expect(ctx.step4Unlocked.value).toBe(false)  // refusal does NOT unlock permit drafting

    ctx.current.value!.committeeReport.recommendation = 'approve'
    expect(ctx.step4Unlocked.value).toBe(true)   // approval → Step 4
  })
})
```

- [ ] **Step 2: Run test to verify behaviour**

Run: `npx vitest run src/composables/__tests__/usePlannerCase.gating.spec.ts`
Expected: PASS. (If it fails, a gating selector regressed — fix `usePlannerCase.ts` selectors to match, do not weaken the test.)

- [ ] **Step 3: Manual walkthrough (record results in the commit body)**

Run the app: `npm run dev` (frontend) and the backend `npm run dev` in `../app-backend`. Log in as the planner demo account. Verify each:

```
[ ] Login lands on /planner with the MAP pane showing.
[ ] Map → click a stand → "Register new application" → Console opens on Statutory Workflow, Step 1 stand/ward prefilled.
[ ] Complete Step 1 → Step 2 tab unlocks. Mark all checks → "Complete" → Step 3 unlocks.
[ ] Step 3 record an "approve" resolution → Step 4 unlocks; "refuse" keeps it locked.
[ ] Step 4 add a condition passing all 5 tests → "Issue permit" enabled.
[ ] Step 5 "Send outcome letter" disabled until Step 3 resolution exists.
[ ] Switch Map ↔ Console repeatedly: map keeps its zoom/drawings; console keeps form input.
[ ] "Council Tools" drawer shows the case-file summary + correct step ticks; "Show on map" recentres.
[ ] /planner-workspace and /planner/statutory both land in the shell (console pane).
[ ] Sync chip shows "Saved"; going offline (devtools) shows "Offline — saved locally".
```

- [ ] **Step 4: Commit**

```bash
git add src/composables/__tests__/usePlannerCase.gating.spec.ts
git commit -m "test(planner): regression test for statutory step gating + manual walkthrough"
```

---

## Task 11: Abutting owners from the map → Step 5 public notice

**Files:**
- Modify: `src/views/planner/VunguPlannerView.vue`

> The selected-parcel id and `spatialApi.getSurroundingParcels` already exist. The returned feature shape varies, so extract owner-ish strings defensively and fall back to stand identifiers.

- [ ] **Step 1: Add a defensive owner extractor + action**

In `src/views/planner/VunguPlannerView.vue` add the `spatialApi` import if not present:

```ts
import { spatialApi } from '@/services/api'
```

Add, near the other helpers in `<script setup>`:

```ts
// Pull abutting owners from a spatial buffer around the selected stand and
// hand them to the Section 26 public-notice step (Step 5).
const OWNER_KEYS = ['owner', 'owner_name', 'registered_owner', 'holder', 'occupier', 'proprietor']
const STAND_KEYS_FALLBACK = ['stand_number', 'stand_no', 'standno', 'erf_no', 'parcel_id']

function extractOwners(features: any[]): string[] {
  const out = new Set<string>()
  for (const f of features ?? []) {
    const p = f?.properties ?? f ?? {}
    let name = ''
    for (const k of OWNER_KEYS) if (typeof p[k] === 'string' && p[k].trim()) { name = p[k].trim(); break }
    if (!name) for (const k of STAND_KEYS_FALLBACK) {
      if (p[k] != null && String(p[k]).trim()) { name = `Stand ${String(p[k]).trim()}`; break }
    }
    if (name) out.add(name)
  }
  return [...out]
}

async function useAbuttingOwners() {
  const parcelId = (selectedFeature.value as any)?.properties?.id
    ?? (selectedFeature.value as any)?.id
  if (!parcelId) { showToast('Select a stand first', 'error'); return }
  try {
    const res = await spatialApi.getSurroundingParcels(String(parcelId), 100)
    const features = res.data?.features ?? res.data?.data?.features ?? res.data ?? []
    const owners = extractOwners(features)
    if (!owners.length) { showToast('No abutting owners found', 'error'); return }
    if (!current.value) shell.registerStandFromMap(selectedFeature.value)
    if (current.value) {
      const pn = current.value.notices.publicNotice ?? { newspaper: '', publishedAt: '', abuttingOwners: [], proofUploadedAt: null }
      pn.abuttingOwners = owners
      current.value.notices.publicNotice = pn
    }
    showToast(`${owners.length} abutting owner(s) added to the public notice`)
    shell.showConsole('workflow')
  } catch {
    showToast('Could not fetch abutting owners', 'error')
  }
}
```

> `selectedFeature`, `current`, `shell`, and `showToast` are all in scope from earlier tasks / the existing file. Confirm the `current` destructure from Task 8 Step 1 is present.

- [ ] **Step 2: Add the button to the Checks tab**

In the `rightTab==='checks'` content, after the "Statutory context to verify" card, add:

```vue
              <button class="rt-action" @click="useAbuttingOwners">
                <Users :size="13" />
                <div><strong>Use abutting owners (100 m)</strong><span>Buffer the stand and fill Step 5 public-notice recipients</span></div>
                <ChevronRight :size="12" class="action-arrow" />
              </button>
```

(`Users` and `ChevronRight` are already imported in this file.)

- [ ] **Step 3: Verify and commit**

Run: `npm run type-check`
Expected: no errors.

Run: `npm run build`
Expected: build succeeds.

Manual: select a stand → "Use abutting owners" → Console opens; on a special-consent classification, Step 5 shows the owners count. Record in commit body.

```bash
git add src/views/planner/VunguPlannerView.vue
git commit -m "feat(planner): pull abutting owners from map buffer into Step 5 notice"
```

---

## Task 12: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit-test run**

Run: `npx vitest run`
Expected: all suites pass, including the new planner specs and the existing `Step1Intake.standpicker.spec.ts`.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: no errors.

- [ ] **Step 3: Production build**

Run: `npm run build`
Expected: build succeeds with no unresolved imports (confirms `PlannerStatutoryView` removal and the shell wiring are clean).

- [ ] **Step 4: End-to-end manual pass**

Repeat the Task 10 manual checklist once more against the dev app to confirm nothing regressed after Task 11.

- [ ] **Step 5: Commit any verification fixups**

```bash
git add -A
git commit -m "chore(planner): final verification fixups for unified shell"
```

(If nothing needed fixing, skip this commit.)

---

## Self-Review

**Spec coverage:**
- Unified shell + shared context → Tasks 4, 5, 7, 8.
- Map↔console bridge (register / open case / show on map) → Tasks 1, 2, 3, 5, 8, 9.
- Map-first login landing → Task 6 (shell defaults to map pane; `roleHome('planner')` unchanged).
- All 5 stages proper (gating/hand-off/persistence) + devType fix → Tasks 2, 10.
- Build the stub drawer → Task 9.
- Retire `/planner/statutory` → Task 6.
- Abutting owners from map → Task 11.
- Sync chip → Task 5 (folded into chrome).

**Placeholder scan:** No TBD/TODO; every code step has complete code. The "confirm the existing ref name" notes in Tasks 8/11 are explicit guardrails, not placeholders.

**Type consistency:** `StandSeed` (Task 1) is consumed identically in Tasks 2/3/5. `SectionKey`/`PlannerShellApi` (Task 4) are used consistently in Tasks 5/7. The names `featureToStandSeed`, `seedIntake`, `intakeSeed`, `showConsole`, `openCaseForStand`, `flyTo`, `resizeMap` match across all tasks.
