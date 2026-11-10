# Citizen ↔ Planner Application Thread Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a citizen submit a development application from `/citizen → New application` (with the real-map `StandPickerModal`) into the same `spatial_planning.permit_application` row the planner sees in `/planner-workspace`, and let the citizen's dashboard reflect status changes the planner makes.

**Architecture:** Single source of truth in the DM Handbook table. Backend extends `requireRole` on the existing `POST /permit-applications`, `GET /permit-applications` and `GET /permit-applications/:id` to include citizen roles (`user|viewer|registered`), and filters list/get by `created_by = jwt.user.id` for non-staff. Frontend wires the existing `StandPickerModal` into the citizen wizard's Stand-no field and aligns the dev-type select to the backend's eight `VALID_TYPES`.

**Tech Stack:** Fastify + `@fastify/postgres` (PostGIS), Vue 3 `<script setup>` + MapLibre GL, axios, Vitest (frontend), Jest (backend).

**Reference spec:** `docs/superpowers/specs/2026-05-30-citizen-application-thread-design.md`

**Verified facts (live DB / live code at plan time):**
- `STAFF_ROLES` at `src/routes/development-management.js:51` = `['admin', 'planner', 'planning_clerk', 'building_inspector', 'eo']`.
- `spatial_planning.v_application_summary` currently has no `created_by` column; the list handler queries this view.
- Seeded demo users include `demo.viewer@vungu.test` (role `viewer`) and `demo.planner@vungu.test` (role `planner`), password `demo1234`.
- `NewApplicationSection` Stand-no input lives at the Step 2 grid (label "Stand number *").
- Dev-type options in Step 3 are the stale zoning vocabulary and **must** be replaced with the backend `VALID_TYPES`.
- `citizenPortalService.listMyApplications` has no external callers (dead code from the consumer perspective); safe to simplify.

---

## File structure

**Backend (`../app-backend`)**
- Add `migrations/075_v_application_summary_add_created_by.sql` — `CREATE OR REPLACE VIEW` with `pa.created_by` exposed.
- Modify `src/routes/development-management.js` — define `PERMIT_READERS`; extend role gates on the three routes; add `created_by` filter to GET list; add 404 own-row check on GET `:id`.
- Add `src/routes/__tests__/permit-applications.citizen.test.js` — real-DB jest test covering citizen POST, own-row list, planner full list, and 404 on someone else's permit.

**Frontend (this repo)**
- Modify `src/views/citizen/sections/NewApplicationSection.vue` — map-pin button on the Stand-no field, `StandPickerModal` wiring + `applyStandSelection`, dev-type select options swapped to backend `VALID_TYPES`.
- Modify `src/services/citizenPortalService.ts` — drop the dead client-side `applicant_id_number` filter in `listMyApplications`.
- Add `src/views/citizen/sections/__tests__/NewApplicationSection.standpicker.spec.ts` — vitest assertion that `applyStandSelection(loc)` mutates the draft.

---

## Task 1: Apply the view migration so list queries can filter by `created_by`

**Files:**
- Create: `../app-backend/migrations/075_v_application_summary_add_created_by.sql`
- Modify: live `spatial_planning.v_application_summary` (idempotent `CREATE OR REPLACE VIEW`).

- [ ] **Step 1: Create the migration file**

```sql
-- migrations/075_v_application_summary_add_created_by.sql
-- Add pa.created_by to v_application_summary so the list handler can filter
-- citizen requests to their own rows without bypassing the view.
CREATE OR REPLACE VIEW spatial_planning.v_application_summary AS
SELECT
  pa.id, pa.tpd_reference, pa.dev_register_no, pa.stand_number, pa.suburb_ward,
  pa.applicant_name, pa.development_type, pa.status, pa.received_at, pa.decision_at,
  pa.created_by,
  (SELECT COUNT(*) FROM spatial_planning.application_consultation c WHERE c.permit_app_id = pa.id) AS consultation_count,
  (SELECT COUNT(*) FROM spatial_planning.application_objection o   WHERE o.permit_app_id = pa.id)  AS objection_count,
  (SELECT COUNT(*) FROM spatial_planning.building_plan bp          WHERE bp.permit_app_id = pa.id) AS building_plan_count,
  (SELECT COUNT(*) FROM spatial_planning.stage_inspection si       WHERE si.permit_app_id = pa.id) AS inspection_count,
  EXISTS (
    SELECT 1 FROM spatial_planning.occupation_certificate oc WHERE oc.permit_app_id = pa.id
  ) AS has_occupation_certificate
FROM spatial_planning.permit_application pa;
```

- [ ] **Step 2: Apply the migration to the live DB**

The project's migrate runner is partial (precedent: `2026-05-29-planner-stand-map-picker.md`). Apply directly via a one-off node script.

Run from `../app-backend`:

```bash
node -e "
require('dotenv').config();
const fs = require('fs'); const path = require('path');
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false });
(async () => {
  const client = await pool.connect();
  try {
    const sql = fs.readFileSync(path.join('migrations','075_v_application_summary_add_created_by.sql'), 'utf8');
    console.log('applying 075...');
    await client.query(sql);
    await client.query('INSERT INTO schema_migrations(filename, applied_at) VALUES (\$1, NOW()) ON CONFLICT (filename) DO NOTHING', ['075_v_application_summary_add_created_by.sql']);
    const c = await client.query(\"SELECT column_name FROM information_schema.columns WHERE table_schema='spatial_planning' AND table_name='v_application_summary' AND column_name='created_by'\");
    console.log('created_by exposed in view:', c.rows.length === 1);
  } catch (e) { console.error('075 ERROR:', e.message); process.exit(1); }
  finally { client.release(); await pool.end(); }
})();
"
```

Expected output ends with `created_by exposed in view: true`.

- [ ] **Step 3: Commit**

```bash
cd ../app-backend
git add migrations/075_v_application_summary_add_created_by.sql
git commit -m "feat(db): expose created_by on v_application_summary for own-row filter"
```

---

## Task 2: Extend `requireRole` + own-row filter on `/permit-applications`

**Files:**
- Modify: `../app-backend/src/routes/development-management.js` (the `STAFF_ROLES` block, the three `permit-applications` handlers).
- Test: `../app-backend/src/routes/__tests__/permit-applications.citizen.test.js`.

- [ ] **Step 1: Write the failing test**

Create `src/routes/__tests__/permit-applications.citizen.test.js`:

```js
require('dotenv').config()
const axios = require('axios')

const BASE = 'http://127.0.0.1:3000/api'
const CITIZEN = { email: 'demo.viewer@vungu.test', password: 'demo1234' }
const PLANNER = { email: 'demo.planner@vungu.test', password: 'demo1234' }

async function login(creds) {
  const r = await axios.post(`${BASE}/auth/login`, creds)
  return r.data.data.token
}

let citizenToken, plannerToken
let citizenPermitId, plannerPermitId

beforeAll(async () => {
  citizenToken = await login(CITIZEN)
  plannerToken = await login(PLANNER)
})

afterAll(async () => {
  // Best-effort cleanup of smoke rows; ignore failures.
  for (const id of [citizenPermitId, plannerPermitId].filter(Boolean)) {
    await axios.delete(`${BASE}/permit-applications/${id}`,
      { headers: { Authorization: `Bearer ${plannerToken}` } }).catch(() => {})
  }
})

describe('/permit-applications role + own-row gating', () => {
  test('citizen can POST a permit', async () => {
    const r = await axios.post(`${BASE}/permit-applications`,
      { applicant_name: 'Citizen Smoke', development_type: 'new_building',
        stand_number: 'CIT-SMK-1', suburb_ward: '1' },
      { headers: { Authorization: `Bearer ${citizenToken}` } })
    expect(r.status).toBe(201)
    citizenPermitId = r.data.data.id
    expect(citizenPermitId).toBeTruthy()
  })

  test('planner can POST a permit', async () => {
    const r = await axios.post(`${BASE}/permit-applications`,
      { applicant_name: 'Planner Smoke', development_type: 'new_building',
        stand_number: 'PLN-SMK-1', suburb_ward: '2' },
      { headers: { Authorization: `Bearer ${plannerToken}` } })
    expect(r.status).toBe(201)
    plannerPermitId = r.data.data.id
  })

  test('citizen GET list returns only own rows', async () => {
    const r = await axios.get(`${BASE}/permit-applications?limit=200&offset=0`,
      { headers: { Authorization: `Bearer ${citizenToken}` } })
    expect(r.status).toBe(200)
    const ids = r.data.data.map(p => p.id)
    expect(ids).toContain(citizenPermitId)
    expect(ids).not.toContain(plannerPermitId)
  })

  test('planner GET list returns rows from all creators', async () => {
    const r = await axios.get(`${BASE}/permit-applications?limit=200&offset=0`,
      { headers: { Authorization: `Bearer ${plannerToken}` } })
    expect(r.status).toBe(200)
    const ids = r.data.data.map(p => p.id)
    expect(ids).toContain(citizenPermitId)
    expect(ids).toContain(plannerPermitId)
  })

  test("citizen GET someone else's permit by id returns 404", async () => {
    const err = await axios.get(`${BASE}/permit-applications/${plannerPermitId}`,
      { headers: { Authorization: `Bearer ${citizenToken}` } }).catch(e => e.response)
    expect(err.status).toBe(404)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run (the backend must be live on `:3000`): `cd ../app-backend && npx jest src/routes/__tests__/permit-applications.citizen.test.js --runInBand`
Expected: FAIL — the citizen POST returns 403, and downstream tests fail because `citizenPermitId` is `undefined`.

- [ ] **Step 3: Add the `PERMIT_READERS` constant and broaden POST**

In `src/routes/development-management.js`, immediately after the existing `const STAFF_ROLES = ['admin', 'planner', 'planning_clerk', 'building_inspector', 'eo']` line, add:

```js
// Citizens (user / viewer / registered) can read their own rows and create
// new applications; only staff can change status or add internal records.
const PERMIT_READERS = [...STAFF_ROLES, 'user', 'viewer', 'registered']
```

Then in the `POST /permit-applications` registration (currently `preHandler: requireRole(fastify, ['planning_clerk', 'planner', 'admin'])`), replace that array with:

```js
preHandler: requireRole(fastify, ['planning_clerk', 'planner', 'admin', 'user', 'viewer', 'registered']),
```

- [ ] **Step 4: Broaden GET list and add own-row filter**

Replace the existing `GET /permit-applications` handler with:

```js
  fastify.get('/permit-applications', {
    preHandler: requireRole(fastify, PERMIT_READERS),
  }, async (request, reply) => {
    const { status, development_type, search, limit = 50, offset = 0 } = request.query
    const isStaff = STAFF_ROLES.includes(request.user.role)
    const ownerFilter = isStaff ? null : request.user.id
    try {
      const { rows } = await pg.query(
        `SELECT * FROM spatial_planning.v_application_summary
         WHERE ($1::text IS NULL OR status = $1)
           AND ($2::text IS NULL OR development_type = $2)
           AND ($3::text IS NULL OR (
                 applicant_name ILIKE '%' || $3 || '%'
                 OR tpd_reference ILIKE '%' || $3 || '%'
                 OR stand_number  ILIKE '%' || $3 || '%'
               ))
           AND ($6::uuid IS NULL OR created_by = $6)
         ORDER BY received_at DESC
         LIMIT $4 OFFSET $5`,
        [status || null, development_type || null, search || null,
         Math.min(Number(limit) || 50, 200), Number(offset) || 0,
         ownerFilter],
      )
      return reply.send({ success: true, data: rows })
    } catch (err) {
      request.log.error({ err }, 'list permit-applications failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })
```

- [ ] **Step 5: Broaden GET `:id` and add own-row 404 check**

Replace the existing `GET /permit-applications/:id` handler with:

```js
  fastify.get('/permit-applications/:id', {
    preHandler: requireRole(fastify, PERMIT_READERS),
  }, async (request, reply) => {
    if (!isUuid(request.params.id)) {
      return reply.code(400).send({ success: false, error: 'bad_id' })
    }
    try {
      const { rows } = await pg.query(
        'SELECT * FROM spatial_planning.permit_application WHERE id = $1',
        [request.params.id],
      )
      if (!rows[0]) {
        return reply.code(404).send({ success: false, error: 'not_found' })
      }
      const isStaff = STAFF_ROLES.includes(request.user.role)
      if (!isStaff && rows[0].created_by !== request.user.id) {
        // 404 not 403 so we don't leak the existence of someone else's row.
        return reply.code(404).send({ success: false, error: 'not_found' })
      }
      return reply.send({ success: true, data: rows[0] })
    } catch (err) {
      request.log.error({ err }, 'get permit-application failed')
      return reply.code(500).send({ success: false, error: 'internal' })
    }
  })
```

- [ ] **Step 6: Restart the backend so the route changes load**

Stop the current backend process and start a fresh one so the route registrations re-run:

```bash
# Find and stop the PID owning :3000 (Windows):
netstat -ano | grep ":3000" | grep LISTEN
# taskkill //F //PID <pid>
# then from ../app-backend:
npm run dev
```

Wait until the log line `Server listening at http://127.0.0.1:3000` appears.

- [ ] **Step 7: Re-run the test and verify it passes**

Run: `cd ../app-backend && npx jest src/routes/__tests__/permit-applications.citizen.test.js --runInBand`
Expected: PASS — 5/5 tests green.

- [ ] **Step 8: Commit**

```bash
cd ../app-backend
git add src/routes/development-management.js src/routes/__tests__/permit-applications.citizen.test.js
git commit -m "feat(api): let citizens submit/list their own permit-applications"
```

---

## Task 3: Wire `StandPickerModal` into the citizen `NewApplicationSection`

**Files:**
- Modify: `src/views/citizen/sections/NewApplicationSection.vue` (script imports + state + handler + Step 2 template + modal render + scoped styles).
- Test: `src/views/citizen/sections/__tests__/NewApplicationSection.standpicker.spec.ts`.

- [ ] **Step 1: Write the failing test**

The map itself is stubbed; the test drives `applyStandSelection` directly to assert the draft mutations.

Create `src/views/citizen/sections/__tests__/NewApplicationSection.standpicker.spec.ts`:

```ts
// @vitest-environment happy-dom
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref } from 'vue'

const draft = ref({
  stand_number: '', suburb_ward: '', title_deed_no: '',
  applicant_name: '', applicant_id_number: '', applicant_phone: '', applicant_email: '',
  development_type: '', description: '',
  documents: [], consent_to_publish: false, declaration_signed: false,
})

vi.mock('@/composables/useCitizenCase', () => ({
  useCitizenCase: () => ({
    currentDraftId: ref('d_test'),
    currentDraft: { value: draft.value },
    drafts: { value: [{ id: 'd_test', submitted_at: null, ...draft.value }] },
    newDraft: vi.fn(), selectDraft: vi.fn(), removeDraft: vi.fn(),
    save: vi.fn(), submitDraft: vi.fn(),
  }),
  REQUIRED_DOCS_BY_TYPE: {} as Record<string, string[]>,
  DOC_TYPE_LABELS: {} as Record<string, string>,
}))
vi.mock('@/composables/useUiFeedback', () => ({
  useUiFeedback: () => ({ showToast: vi.fn(), parseApiError: () => '',
    openMessageBox: vi.fn() }),
}))

import NewApplicationSection from '../NewApplicationSection.vue'

describe('NewApplicationSection stand picker', () => {
  it('maps a selected stand bundle into the draft', async () => {
    const w = mount(NewApplicationSection, {
      global: { stubs: { StandPickerModal: true, UiFeedback: true } },
    })
    ;(w.vm as any).applyStandSelection({
      in_jurisdiction: true, district: 'Gweru', authority: null,
      stand: { fid: 4, stand_number: 'Communal Land', province: 'Midlands',
        area_ha: 12.3, centroid: [29.39, -19.29], ward: '6', district: 'Gweru',
        description: 'Parcel Communal Land, Gweru — 12.3 ha' },
    })
    expect(draft.value.stand_number).toBe('Communal Land')
    expect(draft.value.suburb_ward).toBe('6')
    expect(draft.value.description).toBe('Parcel Communal Land, Gweru — 12.3 ha')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/views/citizen/sections/__tests__/NewApplicationSection.standpicker.spec.ts`
Expected: FAIL — `applyStandSelection is not a function`.

- [ ] **Step 3: Add imports + state + handler in `<script setup>`**

In `src/views/citizen/sections/NewApplicationSection.vue`, add directly after the existing `import { useUiFeedback } from '@/composables/useUiFeedback'` line:

```ts
import StandPickerModal from '@/components/StandPickerModal.vue'
import type { StandLocation } from '@/services/parcels'
import { MapPin } from 'lucide-vue-next'
```

Add reactive state and handler immediately after the existing `const fb = useUiFeedback()`:

```ts
const pickerOpen = ref(false)
function applyStandSelection(loc: StandLocation) {
  const d = cc.currentDraft.value
  const s = loc.stand
  if (!d || !s) return
  d.stand_number = s.stand_number
  if (s.ward) d.suburb_ward = s.ward
  if (!d.description && s.description) d.description = s.description
  cc.save()
  pickerOpen.value = false
}
defineExpose({ applyStandSelection })
```

- [ ] **Step 4: Update the Step 2 template — pin button on the Stand-no field**

Replace the existing Stand-no label (the current `<label><span>Stand number *</span><input v-model="draft.stand_number" /></label>` inside the Step 2 `<div class="na-grid">`) with:

```vue
              <label class="na-stand"><span>Stand number *</span>
                <span class="na-stand-field">
                  <button type="button" class="na-pin" aria-label="Pick stand on map"
                          @click="pickerOpen = true"><MapPin :size="14" /></button>
                  <input name="na-stand-no" v-model="draft.stand_number" />
                </span>
              </label>
```

- [ ] **Step 5: Render `StandPickerModal` at the section root**

At the end of the existing template (just before the closing `</template>`, alongside any `<UiFeedback>` element already there), add:

```vue
    <StandPickerModal :open="pickerOpen" @close="pickerOpen = false" @select="applyStandSelection" />
```

If there's no clear single-root closing context, place it as the last child of the same root element the rest of Step 2/3/4/5 render under.

- [ ] **Step 6: Append scoped styles**

In the existing `<style scoped>` block, append:

```css
.na-stand-field { display: flex; align-items: stretch; }
.na-stand-field input { flex: 1; }
.na-pin { display: inline-flex; align-items: center; justify-content: center;
  width: 1.9rem; margin-right: -1px; border: 1px solid #cbd5e1; border-right: none;
  border-radius: 0.3rem 0 0 0.3rem; background: #f8fafc; color: #1d4ed8; cursor: pointer; }
.na-pin:hover { background: #eff6ff; }
```

- [ ] **Step 7: Run the test and verify it passes**

Run: `npx vitest run src/views/citizen/sections/__tests__/NewApplicationSection.standpicker.spec.ts`
Expected: PASS — 1 test green.

- [ ] **Step 8: Commit**

```bash
git add src/views/citizen/sections/NewApplicationSection.vue src/views/citizen/sections/__tests__/NewApplicationSection.standpicker.spec.ts
git commit -m "feat(citizen): map-pin stand picker on the new-application form"
```

---

## Task 4: Align the citizen dev-type select to the backend `VALID_TYPES`

**Files:**
- Modify: `src/views/citizen/sections/NewApplicationSection.vue` (Step 3 dev-type `<select>` options).

- [ ] **Step 1: Replace the option block**

In `src/views/citizen/sections/NewApplicationSection.vue`, replace the dev-type `<select>` block (the current Step 3 options listing `residential` through `other`) with the eight backend-valid types:

```vue
                <select v-model="draft.development_type">
                  <option value="">— select —</option>
                  <option value="new_building">New building</option>
                  <option value="alteration">Alteration</option>
                  <option value="extension">Extension</option>
                  <option value="change_of_use">Change of use</option>
                  <option value="subdivision">Subdivision</option>
                  <option value="consolidation">Consolidation</option>
                  <option value="rezoning">Rezoning</option>
                  <option value="other">Other</option>
                </select>
```

- [ ] **Step 2: Verify the stand-picker test still passes (sanity)**

Run: `npx vitest run src/views/citizen/sections/__tests__/NewApplicationSection.standpicker.spec.ts`
Expected: PASS — 1 test green.

- [ ] **Step 3: Commit**

```bash
git add src/views/citizen/sections/NewApplicationSection.vue
git commit -m "fix(citizen): align dev-type options to backend VALID_TYPES"
```

---

## Task 5: Simplify `citizenPortalService.listMyApplications`

**Files:**
- Modify: `src/services/citizenPortalService.ts` (`listMyApplications` body + signature).

- [ ] **Step 1: Replace the function**

In `src/services/citizenPortalService.ts`, replace the existing `listMyApplications` with:

```ts
  async listMyApplications(): Promise<PermitApplication[]> {
    // Backend filters by created_by for non-staff callers, so the client
    // can take the response as authoritative.
    const r = await dmApi.listPermits({ limit: 200, offset: 0 })
    return r.data
  },
```

Drop the `applicantIdNumber` parameter. No external callers exist (verified via grep), so no caller updates are needed.

- [ ] **Step 2: Type-check the file**

Run: `npx vue-tsc --noEmit 2>&1 | grep -E "citizenPortalService\\.ts" || echo "clean for citizenPortalService.ts"`
Expected: `clean for citizenPortalService.ts`.

- [ ] **Step 3: Commit**

```bash
git add src/services/citizenPortalService.ts
git commit -m "refactor(citizen): drop dead client filter from listMyApplications"
```

---

## Task 6: Manual end-to-end verification

Manual smoke covering what tests can't easily express. Run after Tasks 1–5 are committed and both servers are up.

- [ ] **Step 1: Reset browser auth so HMR-state from the planner session doesn't bleed in**

In the running browser, open DevTools → Application → Local Storage → clear `auth_token`, `auth_user`, `auth_refresh_token`. Hard-refresh.

- [ ] **Step 2: Citizen submits an application with the map picker**

- Sign in as `demo.viewer@vungu.test` / `demo1234`.
- Navigate to `/citizen → New application`.
- Fill Step 1 (applicant); on Step 2 click the map-pin → search "Communal" → pick the result → confirm. The stand fields populate.
- Fill Step 3 (pick **New building**), Step 4 (documents checklist), Step 5 (consent + declaration) → Submit.
- Expected: toast "Submitted"; `Applications` lists the new permit with lifecycle "Received".

- [ ] **Step 3: Planner sees the same row**

- Open a private window; sign in as `demo.planner@vungu.test` / `demo1234`.
- `/planner-workspace → Permit Register`.
- Expected: the citizen's permit appears with the same `stand_number` and `applicant_name`.

- [ ] **Step 4: Status change flows back to the citizen**

- As the planner, open the permit, move status to `under_review`.
- Switch back to the citizen window; refresh `/citizen`.
- Expected: Dashboard lifecycle reads "Due diligence" (the `permitStatusToLifecycle('under_review') = 'due_diligence'` mapping).

- [ ] **Step 5: Out-of-jurisdiction pick is blocked**

- As a citizen on Step 2, open the picker and click a point in Harare.
- Expected: panel shows "This location is in Harare district, outside Vungu RDC's jurisdiction…"; "Use this stand" is disabled.

---

## Final verification

- [ ] Backend tests: `cd ../app-backend && npx jest src/routes/__tests__/permit-applications.citizen.test.js --runInBand` → 5/5 PASS.
- [ ] Frontend tests: `npx vitest run src/views/citizen/sections/__tests__/NewApplicationSection.standpicker.spec.ts src/components/__tests__/StandPickerModal.spec.ts src/services/__tests__/parcels.spec.ts` → all PASS.
- [ ] Type-check (no new errors in files this plan touched): `npx vue-tsc --noEmit 2>&1 | grep -E "NewApplicationSection\\.vue|citizenPortalService\\.ts" || echo clean`.
- [ ] Manual paths verified end-to-end (Task 6).
