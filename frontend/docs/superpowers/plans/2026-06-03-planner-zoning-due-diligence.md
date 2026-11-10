# Spatial Zoning Auto-Check (Step 2 Due Diligence) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In Step 2 Due Diligence, show the selected stand's zone + full permitted-uses table from the backend `development_matrix`, and let the officer apply the authoritative zoning verdict (Permitted / Special Consent / Prohibited) into the `compatibility.zoning` checklist item with one click.

**Architecture:** A thin read-only service wraps the existing `GET /development-control/parcels/:fid/permitted-uses` endpoint and normalises its 3-array response into a flat, permission-tagged list. A new `ZoningAssessmentCard` mounted in Step 2 resolves the stand's parcel `fid` (from the persisted centroid via `locateStand`), renders the table, and emits an `apply` payload. A pure `buildZoningEntry` maps that payload to the checklist result + notes + a persisted snapshot. **No backend changes** — endpoints are consumed read-only over HTTP.

**Tech Stack:** Vue 3 (`<script setup>`), Pinia, axios (`src/services/api.ts`), Vitest + `@vue/test-utils` (happy-dom), TypeScript.

**Conventions for every task:**
- Run one test file: `npx vitest run <path>`
- Type-check: `npm run type-check` (the project's base `tsconfig` excludes `__tests__`; type-only changes are gated here, not at runtime).
- Build: `npm run build`
- Any spec that uses `mount()` MUST have `// @vitest-environment happy-dom` as its FIRST line (this repo has no global test env).
- Commit messages omit any `Co-Authored-By` trailer. Never use `--no-verify` (a hook blocks it).
- Work on the current branch `feat/planner-statutory-shell`.

---

## File Structure

**New**
- `src/services/developmentControl.ts` — read-only client + pure mappers (`getPermittedUses`, `buildZoningEntry`) and the shared types (`Permission`, `PermittedUse`, `ZoneAssessment`, `ZoningApplyPayload`, `ZoningSnapshot`, `ZoningChecklistEntry`).
- `src/views/planner/ZoningAssessmentCard.vue` — the Step 2 card (resolve fid → fetch → render table → emit `apply`); owns loading/error/no-data/loaded states.
- Test specs under `src/**/__tests__/`.

**Modified**
- `src/composables/usePlannerCase.ts` — add `property.parcelFid?` and `dueDiligence.zoningAssessment?` to the `CaseFile` type.
- `src/views/planner/Step2DueDiligence.vue` — mount the card + `onApplyZoning` handler.

**Unchanged (consumed only):** backend `/development-control` routes, `development_matrix`, zone tables.

---

## Task 1: `developmentControl` service + pure mapper

**Files:**
- Create: `src/services/developmentControl.ts`
- Test: `src/services/__tests__/developmentControl.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/developmentControl.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@/services/api', () => ({ default: { get: vi.fn() } }))
import api from '@/services/api'
import { getPermittedUses, buildZoningEntry } from '@/services/developmentControl'

const mockedGet = api.get as unknown as ReturnType<typeof vi.fn>

const envelope = {
  success: true,
  data: {
    parcel: { parcel_id: 42, stand_number: 'Farm 12', township_name: 'Vungu' },
    zone: { zone_id: 3, zone_code: 'PU-R1', zone_name: 'Residential 1' },
    permitted_uses: [
      { group_code: 'RES1', description: 'Dwelling house', category: 'Residential',
        conditions: 'Single dwelling only', max_units: 1, max_height_meters: 8, min_lot_size_sqm: 300 },
    ],
    consent_required_uses: [
      { group_code: 'SHOP', description: 'Tuck shop', category: 'Commercial',
        conditions: null, max_units: null, max_height_meters: null, min_lot_size_sqm: null },
    ],
    prohibited_uses: [
      { group_code: 'IND', description: 'Heavy industry', category: 'Industrial',
        conditions: null, max_units: null, max_height_meters: null, min_lot_size_sqm: null },
    ],
  },
}

describe('getPermittedUses', () => {
  beforeEach(() => mockedGet.mockReset())

  it('flattens the 3 arrays and tags permission', async () => {
    mockedGet.mockResolvedValue({ data: envelope })
    const res = await getPermittedUses(42)
    expect(mockedGet).toHaveBeenCalledWith('/development-control/parcels/42/permitted-uses')
    expect(res!.zoneName).toBe('Residential 1')
    expect(res!.uses).toHaveLength(3)
    const res1 = res!.uses.find(u => u.groupCode === 'RES1')!
    expect(res1.permission).toBe('permitted')
    expect(res1.groupName).toBe('Dwelling house')
    expect(res1.maxHeightM).toBe(8)
    expect(res!.uses.find(u => u.groupCode === 'SHOP')!.permission).toBe('special_consent')
    expect(res!.uses.find(u => u.groupCode === 'IND')!.permission).toBe('prohibited')
  })

  it('returns null when the matrix is empty (no zone)', async () => {
    mockedGet.mockResolvedValue({ data: { success: true, data: {
      parcel: {}, zone: null, permitted_uses: [], consent_required_uses: [], prohibited_uses: [] } } })
    expect(await getPermittedUses(42)).toBeNull()
  })

  it('returns null on 404', async () => {
    mockedGet.mockRejectedValue({ response: { status: 404 } })
    expect(await getPermittedUses(99)).toBeNull()
  })
})

describe('buildZoningEntry', () => {
  const base = {
    parcelFid: 42, zoneName: 'Residential 1', zoneCode: 'PU-R1',
    selectedGroupCode: 'RES1', selectedGroupName: 'Dwelling house',
    conditions: 'Single dwelling only', maxHeightM: 8, minLotSqm: 300, maxUnits: 1,
  }
  const at = new Date('2026-06-03T10:00:00Z')

  it('maps permitted → pass with a summary note + snapshot', () => {
    const e = buildZoningEntry({ ...base, permission: 'permitted' }, at)
    expect(e.result).toBe('pass')
    expect(e.notes).toContain('Residential 1')
    expect(e.notes).toContain('Permitted')
    expect(e.notes).toContain('max height 8 m')
    expect(e.snapshot.assessedAt).toBe('2026-06-03T10:00:00.000Z')
    expect(e.snapshot.permission).toBe('permitted')
  })

  it('maps prohibited → fail', () => {
    expect(buildZoningEntry({ ...base, permission: 'prohibited' }, at).result).toBe('fail')
  })

  it('maps special_consent → pass with a "Special consent required" note', () => {
    const e = buildZoningEntry({ ...base, permission: 'special_consent' }, at)
    expect(e.result).toBe('pass')
    expect(e.notes).toContain('Special consent required')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/developmentControl.spec.ts`
Expected: FAIL — cannot resolve `@/services/developmentControl`.

- [ ] **Step 3: Write the implementation**

Create `src/services/developmentControl.ts`:

```ts
// Read-only client for the backend development-control matrix.
// Surfaces the authoritative zoning verdict (Permitted / Special Consent /
// Prohibited) for a parcel so Step 2 due diligence can apply it.
// NO backend changes — this only consumes
// GET /development-control/parcels/:fid/permitted-uses.
import api from './api'

export type Permission = 'permitted' | 'special_consent' | 'prohibited'

export interface PermittedUse {
  groupCode: string
  groupName: string
  category: string | null
  permission: Permission
  conditions: string | null
  maxHeightM: number | null
  minLotSqm: number | null
  maxUnits: number | null
}

export interface ZoneAssessment {
  parcelFid: number
  standNumber: string | null
  zoneName: string | null
  zoneCode: string | null
  uses: PermittedUse[]
}

function num(v: unknown): number | null {
  const n = typeof v === 'string' ? Number(v) : (v as number)
  return typeof n === 'number' && Number.isFinite(n) ? n : null
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null
}

function mapUse(row: any, permission: Permission): PermittedUse {
  return {
    groupCode: String(row?.group_code ?? ''),
    groupName: str(row?.description) ?? String(row?.group_code ?? '—'),
    category: str(row?.category),
    permission,
    conditions: str(row?.conditions),
    maxHeightM: num(row?.max_height_meters),
    minLotSqm: num(row?.min_lot_size_sqm),
    maxUnits: num(row?.max_units),
  }
}

// Returns null when the stand has no resolvable zoning data (404, no zone, or
// an empty matrix) — the card renders that as graceful degradation.
export async function getPermittedUses(parcelFid: number): Promise<ZoneAssessment | null> {
  let env: any
  try {
    const res = await api.get(`/development-control/parcels/${parcelFid}/permitted-uses`)
    env = res.data?.data ?? res.data
  } catch (e: any) {
    if (e?.response?.status === 404) return null
    throw e
  }
  if (!env) return null
  const permitted = Array.isArray(env.permitted_uses) ? env.permitted_uses : []
  const consent = Array.isArray(env.consent_required_uses) ? env.consent_required_uses : []
  const prohibited = Array.isArray(env.prohibited_uses) ? env.prohibited_uses : []
  const uses: PermittedUse[] = [
    ...permitted.map((r: any) => mapUse(r, 'permitted')),
    ...consent.map((r: any) => mapUse(r, 'special_consent')),
    ...prohibited.map((r: any) => mapUse(r, 'prohibited')),
  ]
  if (uses.length === 0) return null // no zone / empty matrix
  // NOTE: the backend's data.zone block returns undefined fields (it reads
  // parcel.zone_* which the parcel query doesn't select), so zone name/code are
  // usually null. We still render the table; presence of uses == has a zone.
  return {
    parcelFid,
    standNumber: str(env.parcel?.stand_number),
    zoneName: str(env.zone?.zone_name),
    zoneCode: str(env.zone?.zone_code),
    uses,
  }
}

export interface ZoningApplyPayload {
  parcelFid: number
  zoneName: string | null
  zoneCode: string | null
  selectedGroupCode: string
  selectedGroupName: string
  permission: Permission
  conditions: string | null
  maxHeightM: number | null
  minLotSqm: number | null
  maxUnits: number | null
}

export interface ZoningSnapshot extends ZoningApplyPayload {
  assessedAt: string
}

export interface ZoningChecklistEntry {
  result: 'pass' | 'fail'
  notes: string
  snapshot: ZoningSnapshot
}

const PERMISSION_LABEL: Record<Permission, string> = {
  permitted: 'Permitted',
  special_consent: 'Special consent required',
  prohibited: 'Prohibited',
}

// Pure mapping from a chosen use verdict to the Step 2 checklist entry.
export function buildZoningEntry(
  payload: ZoningApplyPayload,
  now: Date = new Date(),
): ZoningChecklistEntry {
  const result: 'pass' | 'fail' = payload.permission === 'prohibited' ? 'fail' : 'pass'
  const limits = [
    payload.maxHeightM != null ? `max height ${payload.maxHeightM} m` : null,
    payload.minLotSqm != null ? `min lot ${payload.minLotSqm} m²` : null,
    payload.maxUnits != null ? `max units ${payload.maxUnits}` : null,
  ].filter(Boolean).join(', ')
  const parts = [
    `Zone ${payload.zoneName ?? payload.zoneCode ?? '—'}: ${payload.selectedGroupName} — ${PERMISSION_LABEL[payload.permission]}.`,
    payload.permission === 'special_consent' ? 'Special consent required.' : '',
    payload.conditions ? `Conditions: ${payload.conditions}` : '',
    limits ? `Limits: ${limits}.` : '',
    `(Auto from zoning check ${now.toISOString().slice(0, 10)}.)`,
  ].filter(Boolean)
  return {
    result,
    notes: parts.join(' '),
    snapshot: { ...payload, assessedAt: now.toISOString() },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/developmentControl.spec.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/developmentControl.ts src/services/__tests__/developmentControl.spec.ts
git commit -m "feat(planner): development-control zoning service + checklist mapper"
```

---

## Task 2: Case-state fields for the zoning assessment

**Files:**
- Modify: `src/composables/usePlannerCase.ts`

> This is a type + persistence-shape change. Runtime tests cannot fail on a type-only addition (vitest strips types), so it is gated by `npm run type-check` and exercised by Tasks 3–4. Keep the diff minimal.

- [ ] **Step 1: Add the import**

Near the other imports at the top of `src/composables/usePlannerCase.ts`, add:

```ts
import type { ZoningSnapshot } from '@/services/developmentControl'
```

- [ ] **Step 2: Extend the `CaseFile` `property` type**

Find the `property:` member of the `CaseFile` interface (it currently has `standNo`, `ward`, `description`, `titleDeedNo`, `centroid?`). Add `parcelFid?`:

```ts
  property: {
    standNo: string
    ward: string
    description: string
    titleDeedNo: string
    centroid?: [number, number]
    parcelFid?: number
  }
```

(Adapt to the exact existing field list — only ADD `parcelFid?: number`.)

- [ ] **Step 3: Extend the `CaseFile` `dueDiligence` type**

In the `dueDiligence:` member of the `CaseFile` interface, add an optional `zoningAssessment` alongside the existing members (`fileChecks`, `compatibility`, `statutoryChecks`, `titleDeedConflict`, `referrals`, `completedAt`):

```ts
    zoningAssessment?: ZoningSnapshot
```

- [ ] **Step 4: Verify**

Run: `npm run type-check`
Expected: no NEW errors in `usePlannerCase.ts`. (`emptyCase()` needs no change — both fields are optional and default to `undefined`.)

- [ ] **Step 5: Commit**

```bash
git add src/composables/usePlannerCase.ts
git commit -m "feat(planner): add parcelFid + zoningAssessment to the case file"
```

---

## Task 3: `ZoningAssessmentCard.vue`

**Files:**
- Create: `src/views/planner/ZoningAssessmentCard.vue`
- Test: `src/views/planner/__tests__/ZoningAssessmentCard.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/views/planner/__tests__/ZoningAssessmentCard.spec.ts`:

```ts
// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const current = ref<any>(null)
vi.mock('@/composables/usePlannerCase', () => ({ usePlannerCase: () => ({ current }) }))

const locateStand = vi.fn()
vi.mock('@/services/parcels', () => ({ locateStand: (...a: any[]) => locateStand(...a) }))

const getPermittedUses = vi.fn()
vi.mock('@/services/developmentControl', async (orig) => {
  const actual = await (orig as any)()
  return { ...actual, getPermittedUses: (...a: any[]) => getPermittedUses(...a) }
})

import ZoningAssessmentCard from '@/views/planner/ZoningAssessmentCard.vue'

const assessment = {
  parcelFid: 42, standNumber: 'Farm 12', zoneName: 'Residential 1', zoneCode: 'PU-R1',
  uses: [
    { groupCode: 'RES1', groupName: 'Dwelling house', category: 'Residential', permission: 'permitted',
      conditions: 'Single dwelling only', maxHeightM: 8, minLotSqm: 300, maxUnits: 1 },
    { groupCode: 'IND', groupName: 'Heavy industry', category: 'Industrial', permission: 'prohibited',
      conditions: null, maxHeightM: null, minLotSqm: null, maxUnits: null },
  ],
}

beforeEach(() => {
  locateStand.mockReset(); getPermittedUses.mockReset()
  current.value = { property: { centroid: [29.8, -19.4] }, dueDiligence: {} }
})

describe('ZoningAssessmentCard', () => {
  it('runs the check, renders the table, and emits apply for the selected group', async () => {
    locateStand.mockResolvedValue({ stand: { fid: 42 } })
    getPermittedUses.mockResolvedValue(assessment)

    const wrapper = mount(ZoningAssessmentCard)
    await wrapper.find('.zac-run').trigger('click')
    await flushPromises()

    expect(getPermittedUses).toHaveBeenCalledWith(42)
    expect(current.value.property.parcelFid).toBe(42)       // cached
    expect(wrapper.findAll('.zac-row').length).toBe(2)

    await wrapper.find('.zac-apply').trigger('click')        // default-selects first non-prohibited (RES1)
    const payload = wrapper.emitted('apply')![0][0] as any
    expect(payload.selectedGroupCode).toBe('RES1')
    expect(payload.permission).toBe('permitted')
    expect(payload.parcelFid).toBe(42)
  })

  it('shows a graceful no-data state when the service returns null', async () => {
    locateStand.mockResolvedValue({ stand: { fid: 7 } })
    getPermittedUses.mockResolvedValue(null)
    const wrapper = mount(ZoningAssessmentCard)
    await wrapper.find('.zac-run').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Zoning data unavailable')
    expect(wrapper.find('.zac-apply').exists()).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/planner/__tests__/ZoningAssessmentCard.spec.ts`
Expected: FAIL — cannot resolve `@/views/planner/ZoningAssessmentCard.vue`.

- [ ] **Step 3: Write the implementation**

Create `src/views/planner/ZoningAssessmentCard.vue`:

```vue
<script setup lang="ts">
// Step 2 zoning assessment. Resolves the selected stand's parcel fid (from the
// persisted centroid), fetches the authoritative permitted-uses table from the
// development-control matrix, and lets the officer apply the verdict to the
// due-diligence checklist. Degrades gracefully where no zoning data exists.
import { ref, computed, onMounted } from 'vue'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { locateStand } from '@/services/parcels'
import {
  getPermittedUses,
  type ZoneAssessment, type PermittedUse, type Permission, type ZoningApplyPayload,
} from '@/services/developmentControl'
import { MapPin, CheckCircle2, AlertTriangle, XCircle, Loader2, RefreshCw } from 'lucide-vue-next'

const emit = defineEmits<{ apply: [ZoningApplyPayload] }>()
const { current } = usePlannerCase()

type State = 'idle' | 'loading' | 'loaded' | 'nodata' | 'error'
const state = ref<State>('idle')
const assessment = ref<ZoneAssessment | null>(null)
const selectedGroupCode = ref<string>('')

const saved = computed(() => current.value?.dueDiligence?.zoningAssessment ?? null)

onMounted(() => { if (saved.value) state.value = 'loaded' })

async function run() {
  if (!current.value) return
  state.value = 'loading'
  try {
    let fid = current.value.property.parcelFid ?? null
    if (fid == null) {
      const c = current.value.property.centroid
      if (!c) { state.value = 'nodata'; return }
      const loc = await locateStand(c[0], c[1])
      fid = loc.stand?.fid ?? null
      if (fid == null) { state.value = 'nodata'; return }
      current.value.property.parcelFid = fid
    }
    const res = await getPermittedUses(fid)
    if (!res || res.uses.length === 0) { state.value = 'nodata'; return }
    assessment.value = res
    selectedGroupCode.value =
      res.uses.find(u => u.permission !== 'prohibited')?.groupCode ?? res.uses[0].groupCode
    state.value = 'loaded'
  } catch {
    state.value = 'error'
  }
}

const selectedUse = computed<PermittedUse | null>(() =>
  assessment.value?.uses.find(u => u.groupCode === selectedGroupCode.value) ?? null)

function apply() {
  const a = assessment.value, u = selectedUse.value
  if (!a || !u) return
  emit('apply', {
    parcelFid: a.parcelFid,
    zoneName: a.zoneName,
    zoneCode: a.zoneCode,
    selectedGroupCode: u.groupCode,
    selectedGroupName: u.groupName,
    permission: u.permission,
    conditions: u.conditions,
    maxHeightM: u.maxHeightM,
    minLotSqm: u.minLotSqm,
    maxUnits: u.maxUnits,
  })
}

const permMeta: Record<Permission, { label: string; cls: string; icon: any }> = {
  permitted:        { label: 'Permitted',        cls: 'perm-ok', icon: CheckCircle2 },
  special_consent:  { label: 'Special consent',  cls: 'perm-sc', icon: AlertTriangle },
  prohibited:       { label: 'Prohibited',       cls: 'perm-no', icon: XCircle },
}
</script>

<template>
  <section class="zac">
    <header class="zac-head">
      <MapPin :size="14" />
      <strong>Zoning assessment</strong>
      <span class="zac-sub">Land-use conformity from the development matrix</span>
    </header>

    <!-- Prior applied result -->
    <div v-if="saved && !assessment" class="zac-saved">
      Last applied: <strong>{{ saved!.selectedGroupName }}</strong> —
      {{ permMeta[saved!.permission].label }}
      <span class="zac-when">({{ saved!.assessedAt.slice(0, 10) }})</span>
      <button class="zac-run" @click="run"><RefreshCw :size="12" /> Re-run check</button>
    </div>

    <!-- Idle -->
    <div v-else-if="state === 'idle'" class="zac-idle">
      <button class="zac-run" @click="run">Run zoning check</button>
      <span class="zac-hint">Resolves the stand's zone and permitted uses.</span>
    </div>

    <div v-else-if="state === 'loading'" class="zac-msg"><Loader2 :size="14" class="spin" /> Checking zoning…</div>

    <div v-else-if="state === 'nodata'" class="zac-msg zac-warn">
      Zoning data unavailable for this stand — record manually.
      <button class="zac-run" @click="run"><RefreshCw :size="12" /> Retry</button>
    </div>

    <div v-else-if="state === 'error'" class="zac-msg zac-err">
      Could not reach the zoning service.
      <button class="zac-run" @click="run"><RefreshCw :size="12" /> Retry</button>
    </div>

    <!-- Loaded table -->
    <div v-else-if="state === 'loaded' && assessment" class="zac-body">
      <div class="zac-zone">
        Zone: <strong>{{ assessment.zoneName ?? assessment.zoneCode ?? 'name unavailable' }}</strong>
      </div>
      <table class="zac-table">
        <tr v-for="u in assessment.uses" :key="u.groupCode" class="zac-row">
          <td>
            <label>
              <input type="radio" name="zac-group" :value="u.groupCode" v-model="selectedGroupCode" />
              {{ u.groupName }}
            </label>
          </td>
          <td>
            <span class="zac-chip" :class="permMeta[u.permission].cls">
              <component :is="permMeta[u.permission].icon" :size="11" /> {{ permMeta[u.permission].label }}
            </span>
          </td>
          <td class="zac-limits">
            <span v-if="u.maxHeightM != null">≤{{ u.maxHeightM }}m </span>
            <span v-if="u.minLotSqm != null">≥{{ u.minLotSqm }}m² </span>
            <span v-if="u.maxUnits != null">≤{{ u.maxUnits }} units</span>
          </td>
        </tr>
      </table>
      <button class="zac-apply" :disabled="!selectedUse" @click="apply">
        Apply to checklist
      </button>
    </div>
  </section>
</template>

<style scoped>
.zac { border:1px solid #e2e8f0; border-radius:0.5rem; background:#fff; margin-bottom:0.6rem; }
.zac-head { display:flex; align-items:center; gap:0.4rem; padding:0.5rem 0.75rem;
  border-bottom:1px solid #e2e8f0; background:#f8fafc; font-size:0.8125rem; color:#0f172a; }
.zac-sub { margin-left:auto; font-size:0.68rem; color:#64748b; font-weight:400; }
.zac-idle, .zac-saved, .zac-msg { display:flex; align-items:center; gap:0.5rem; padding:0.6rem 0.75rem; font-size:0.75rem; color:#475569; }
.zac-hint { color:#94a3b8; font-size:0.7rem; }
.zac-when { color:#94a3b8; }
.zac-warn { color:#92400e; background:#fffbeb; }
.zac-err  { color:#991b1b; background:#fef2f2; }
.zac-run { display:inline-flex; align-items:center; gap:0.25rem; border:1px solid #cbd5e1;
  background:#fff; color:#1d4ed8; border-radius:0.3rem; padding:0.25rem 0.6rem;
  font-size:0.72rem; font-weight:600; cursor:pointer; }
.zac-body { padding:0.5rem 0.75rem; display:flex; flex-direction:column; gap:0.5rem; }
.zac-zone { font-size:0.75rem; color:#475569; }
.zac-table { width:100%; border-collapse:collapse; font-size:0.72rem; }
.zac-table td { padding:0.3rem 0.4rem; border-top:1px solid #f1f5f9; vertical-align:middle; }
.zac-table label { display:flex; align-items:center; gap:0.35rem; cursor:pointer; }
.zac-chip { display:inline-flex; align-items:center; gap:0.25rem; padding:0.1rem 0.45rem;
  border-radius:9999px; font-weight:600; font-size:0.68rem; }
.perm-ok { background:#dcfce7; color:#166534; }
.perm-sc { background:#fef3c7; color:#92400e; }
.perm-no { background:#fee2e2; color:#991b1b; }
.zac-limits { color:#64748b; white-space:nowrap; }
.zac-apply { align-self:flex-start; border:none; border-radius:0.3rem; background:#1d4ed8;
  color:#fff; padding:0.35rem 0.7rem; font-size:0.72rem; font-weight:700; cursor:pointer; }
.zac-apply:disabled { background:#94a3b8; cursor:not-allowed; }
.spin { animation: zacspin 1s linear infinite; }
@keyframes zacspin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/views/planner/__tests__/ZoningAssessmentCard.spec.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/views/planner/ZoningAssessmentCard.vue src/views/planner/__tests__/ZoningAssessmentCard.spec.ts
git commit -m "feat(planner): ZoningAssessmentCard for Step 2 due diligence"
```

---

## Task 4: Wire the card into Step 2 Due Diligence

**Files:**
- Modify: `src/views/planner/Step2DueDiligence.vue`
- Test: `src/views/planner/__tests__/Step2DueDiligence.zoning.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/views/planner/__tests__/Step2DueDiligence.zoning.spec.ts`:

```ts
// @vitest-environment happy-dom
import { mount, flushPromises } from '@vue/test-utils'
import { ref } from 'vue'
import { describe, it, expect, vi, beforeEach } from 'vitest'

const save = vi.fn()
const current = ref<any>(null)
vi.mock('@/composables/usePlannerCase', () => ({ usePlannerCase: () => ({ current, save }) }))
vi.mock('@/composables/useUiFeedback', () => ({
  useUiFeedback: () => ({ showToast: vi.fn(), parseApiError: () => '', openMessageBox: vi.fn() }),
}))
vi.mock('@/services/developmentManagementService', () => ({ dmApi: { createConsultation: vi.fn() } }))

import Step2DueDiligence from '@/views/planner/Step2DueDiligence.vue'

function freshCase() {
  return {
    registrationNo: 'VR-1', applicant: {}, property: { standNo: '1', ward: 'W', centroid: [29.8, -19.4] },
    proposal: { devType: 'new_building', description: '', estimatedCost: 0 },
    permit: {}, acknowledgedDate: null, expiryDate: null,
    dueDiligence: {
      fileChecks: {}, compatibility: {}, statutoryChecks: {},
      titleDeedConflict: { hasConflict: false }, referrals: [], completedAt: null,
    },
  }
}

beforeEach(() => { save.mockReset(); current.value = freshCase() })

describe('Step 2 zoning apply', () => {
  it('applies a permitted verdict to the compatibility.zoning item + persists the snapshot', async () => {
    const wrapper = mount(Step2DueDiligence, {
      global: { stubs: { ZoningAssessmentCard: true } },
    })
    await flushPromises()
    wrapper.findComponent({ name: 'ZoningAssessmentCard' }).vm.$emit('apply', {
      parcelFid: 42, zoneName: 'Residential 1', zoneCode: 'PU-R1',
      selectedGroupCode: 'RES1', selectedGroupName: 'Dwelling house', permission: 'permitted',
      conditions: 'Single dwelling only', maxHeightM: 8, minLotSqm: 300, maxUnits: 1,
    })
    await flushPromises()
    expect(current.value.dueDiligence.compatibility.zoning.result).toBe('pass')
    expect(current.value.dueDiligence.compatibility.zoning.notes).toContain('Residential 1')
    expect(current.value.dueDiligence.zoningAssessment.permission).toBe('permitted')
    expect(save).toHaveBeenCalled()
  })
})
```

> Note: the name-based `findComponent({ name: 'ZoningAssessmentCard' })` resolves because Step 2 imports the component under that name. If it does not resolve in practice, import the real component in the test and use `wrapper.findComponent(ZoningAssessmentCard)` instead (still stubbed via `global.stubs`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/planner/__tests__/Step2DueDiligence.zoning.spec.ts`
Expected: FAIL — `ZoningAssessmentCard` not present / `onApplyZoning` undefined.

- [ ] **Step 3: Make the changes**

In `src/views/planner/Step2DueDiligence.vue`:

3a. Add imports (next to the existing imports):

```ts
import ZoningAssessmentCard from './ZoningAssessmentCard.vue'
import { buildZoningEntry, type ZoningApplyPayload } from '@/services/developmentControl'
```

3b. Add the handler (in `<script setup>`, near the other functions like `setResult`):

```ts
function onApplyZoning(payload: ZoningApplyPayload) {
  if (!current.value) return
  const entry = buildZoningEntry(payload)
  current.value.dueDiligence.compatibility.zoning = { result: entry.result, notes: entry.notes }
  current.value.dueDiligence.zoningAssessment = entry.snapshot
  save()
  fb.showToast(`Zoning applied: ${payload.selectedGroupName}`, 'success')
}
```

3c. In the template, mount the card immediately before the **Compatibility checks** `<section class="dd-card">` (the one whose `<header>` reads "Compatibility checks"):

```vue
    <ZoningAssessmentCard @apply="onApplyZoning" />
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/views/planner/__tests__/Step2DueDiligence.zoning.spec.ts`
Expected: PASS.

Run: `npm run type-check`
Expected: no NEW errors in `Step2DueDiligence.vue`.

- [ ] **Step 5: Commit**

```bash
git add src/views/planner/Step2DueDiligence.vue src/views/planner/__tests__/Step2DueDiligence.zoning.spec.ts
git commit -m "feat(planner): apply zoning verdict into Step 2 due-diligence checklist"
```

---

## Task 5: Final verification

**Files:** none (verification only)

- [ ] **Step 1: Full unit-test run**

Run: `npx vitest run`
Expected: all suites pass, including the 3 new specs and all pre-existing planner specs.

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: no new errors referencing `developmentControl.ts`, `ZoningAssessmentCard.vue`, `usePlannerCase.ts`, or `Step2DueDiligence.vue`.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: succeeds.

- [ ] **Step 4: Manual walkthrough (record in commit body; needs running backend + frontend)**

```
[ ] Open a registered case with a map-picked stand → Step 2 → "Run zoning check"
[ ] Zone + permitted-uses table render (or graceful "Zoning data unavailable" for an unseeded stand)
[ ] Pick a use group → "Apply to checklist" → the "Land-use zoning conformity" item flips to Pass/Fail
    and its notes show zone + verdict + conditions + limits
[ ] Prohibited use → item becomes Fail; Special consent → Pass with "Special consent required" note
[ ] Reload the case → the card shows "Last applied: …" (snapshot persisted)
[ ] A manually-typed stand with no centroid → "Confirm the stand location on the map first" path, manual ticking still works
```

- [ ] **Step 5: Commit any fixups** (skip if none)

```bash
git add -A
git commit -m "chore(planner): final verification fixups for zoning auto-check"
```

---

## Self-Review

**Spec coverage:**
- Show zone + full permitted-uses table → Task 3 (card) on Task 1 (service). ✓
- Officer picks use group + one-click apply, overridable → Task 3 (radio select + apply) + Task 4 (handler writes the item; existing `setResult` still allows override). ✓
- Persist assessment on the case → Task 2 (`zoningAssessment` field) + Task 4 (snapshot saved). ✓
- Graceful degradation (no centroid / no zone / 404 / empty) → Task 1 (`null`) + Task 3 (`nodata`/`error` states). ✓
- No backend changes → only `api.get` to existing endpoints; no backend files in any task. ✓
- SC → pass + note; prohibited → fail; permitted → pass → Task 1 `buildZoningEntry` + tests. ✓
- Testing (unit/component/integration) → Tasks 1, 3, 4. ✓

**Placeholder scan:** No TBD/TODO; every code step is complete. The `findComponent` note in Task 4 is an explicit fallback instruction, not a placeholder.

**Type consistency:** `Permission`, `PermittedUse`, `ZoneAssessment`, `ZoningApplyPayload`, `ZoningSnapshot`, `ZoningChecklistEntry`, `getPermittedUses`, `buildZoningEntry` are defined in Task 1 and used identically in Tasks 2/3/4. The `apply` payload shape emitted by the card (Task 3) matches `ZoningApplyPayload` consumed by `buildZoningEntry` (Task 1) and the Step 2 handler (Task 4). `property.parcelFid` / `dueDiligence.zoningAssessment` (Task 2) match the card's reads/writes (Task 3) and the handler's writes (Task 4).
