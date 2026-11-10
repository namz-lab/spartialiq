# Citizen ↔ Planner Application Thread — Design

**Date:** 2026-05-30
**Status:** Approved (pending spec review)
**Surface:** Citizen Portal (`/citizen`) + Planner Workspace (`/planner-workspace`)
**Scope:** Slice A of a larger Citizen Portal effort. Slices B (citizen map / payments / documents) and C (inspections / certificates / endpoint audit) follow.

## Problem

The citizen portal exists with 11 sections and a `useCitizenCase` composable, and `submitDraft` already calls the DM Handbook `dmApi.createPermit`. But the backend's `/api/permit-applications` routes are staff-only (`requireRole` excludes citizens), so a citizen cannot actually submit, and the list endpoint returns 401 instead of their own rows. The `New application` form also has no map-based stand picker — the planner gets one via `StandPickerModal`, but the citizen still types a free-text stand number. The result: no real citizen → planner handoff, and no real map data on the citizen side.

## Goals

- A citizen can submit a development application from `/citizen → New application`, using the same `StandPickerModal` the planner uses (real map data, real jurisdiction guard).
- The submitted application becomes a single row in `spatial_planning.permit_application` (the DM Handbook table), `created_by = jwt.user.id`, `status = 'registered'`.
- The same row appears in the planner's Permit Register (`/planner-workspace`) immediately.
- When the planner updates the status (`PATCH /:id/status`), the citizen sees the new lifecycle label on their dashboard / applications list after refresh.
- The citizen sees **only their own** applications on `GET /api/permit-applications`; the planner sees all.

## Non-goals

- Document upload, payments, inspections, certificates, notices, appeals — Slices B and C.
- Real-time push of status changes — refresh on view is fine.
- The other ten citizen sections — only `NewApplicationSection`, `ApplicationsSection`, `DashboardSection` are touched here (the latter two automatically benefit once the backend returns rows).
- A separate citizen routes namespace. One endpoint, role-aware filtering.

## Architecture and data flow

```
Citizen NewApplicationSection (multi-step wizard, existing)
  ├─ Step 2 "Property": <Stand no.> input + [map-pin] → StandPickerModal
  │     on @select → applyStandSelection(loc):
  │       draft.stand_number = loc.stand.stand_number
  │       draft.suburb_ward  = loc.stand.ward ?? draft.suburb_ward
  │       draft.description  = draft.description || loc.stand.description
  ├─ Step 5 "Submit" → cc.submitDraft(draft.id)
  └─ submitDraft → dmApi.createPermit({ stand_number, suburb_ward,
        applicant_name, applicant_id_number, applicant_phone, applicant_email,
        development_type, description })
     → POST /api/permit-applications
     → backend: requireRole now includes citizen roles;
       INSERT spatial_planning.permit_application with created_by = jwt.user.id,
       status='registered'
     → 201 { id, dev_register_no, ... }

Single source of truth — `spatial_planning.permit_application`:

  Citizen ApplicationsSection.list ─┐                        ┌─ Planner PermitRegisterSection.list
                                    │                        │
                       GET /api/permit-applications            GET /api/permit-applications
                       isStaff=false → WHERE created_by = $userId   isStaff=true → no extra filter
                                    │                        │
                                    └────── one row ─────────┘

Planner status change loop:
  Planner clicks status (existing UI) → dmApi.setPermitStatus(id, status) → PATCH /:id/status
  Citizen refreshes /citizen → ApplicationsSection / DashboardSection re-fetch
  permitStatusToLifecycle(p) maps new backend status → lifecycle label shown
```

## Backend

### Role gating (in `src/routes/development-management.js`)

Define a single readers constant near the top of the file:

```js
const PERMIT_READERS = [...STAFF_ROLES, 'user', 'viewer', 'registered']
```

Apply it:

- `POST /permit-applications` (current allow-list `['planning_clerk', 'planner', 'admin']`) → add the same three citizen roles.
- `GET /permit-applications` (current `STAFF_ROLES`) → use `PERMIT_READERS`.
- `GET /permit-applications/:id` → use `PERMIT_READERS`.
- `PATCH /:id/status` and the other write/sub-routes (consultations, objections, status, etc.) **stay staff-only**. Citizens cannot move their own status, file consultations, or add internal notes.

### Own-row filtering on read

`request.user.role` and `request.user.id` are populated by `jwtAuth`.

- `GET /permit-applications`:
  ```js
  const isStaff = STAFF_ROLES.includes(request.user.role)
  // existing where clause stays; append:
  //   AND ($N::uuid IS NULL OR created_by = $N)
  // with the bound param = isStaff ? null : request.user.id
  ```
  Citizens see only their own rows; staff see everything.

- `GET /permit-applications/:id`:
  ```js
  // after the existing select:
  if (!isStaff && row.created_by !== request.user.id) {
    return reply.code(404).send({ success: false, error: 'not_found' })
  }
  ```
  Return 404 not 403, so the existence of someone else's permit isn't leaked.

### View migration

The list handler queries `spatial_planning.v_application_summary`, which doesn't expose `created_by`. Add a small migration to extend it:

```sql
-- migrations/075_v_application_summary_add_created_by.sql
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

Apply via the existing direct-apply approach (the project's migrate runner is partial — see `2026-05-29-planner-stand-map-picker-design.md` for prior precedent). Idempotent.

## Frontend

### `src/views/citizen/sections/NewApplicationSection.vue`

In the property step (around the existing `<label><span>Stand number *</span><input v-model="draft.stand_number" /></label>`):

- Wrap the input + a map-pin button in a flex row, button on the far left, same pattern and styling as `Step1Intake`'s stand field. Add a `name="na-stand-no"` while we're there.
- Add imports:
  ```ts
  import StandPickerModal from '@/components/StandPickerModal.vue'
  import type { StandLocation } from '@/services/parcels'
  import { MapPin } from 'lucide-vue-next'
  ```
- Add reactive state and handler:
  ```ts
  const pickerOpen = ref(false)
  function applyStandSelection(loc: StandLocation) {
    const s = loc.stand
    if (!s) return
    draft.value && (
      draft.value.stand_number = s.stand_number,
      draft.value.suburb_ward  = s.ward || draft.value.suburb_ward,
      draft.value.description  = draft.value.description || s.description
    )
    pickerOpen.value = false
  }
  defineExpose({ applyStandSelection })
  ```
- Render `<StandPickerModal :open="pickerOpen" @close="pickerOpen = false" @select="applyStandSelection" />` near the end of the section's root.
- **Dev-type select audit**: confirm the `<select v-model="draft.development_type">` options match the eight backend `VALID_TYPES` (`new_building`, `alteration`, `extension`, `change_of_use`, `subdivision`, `consolidation`, `rezoning`, `other`). If any legacy zoning option (`residential`, `commercial`, …) is still listed, swap it. The `DevType` union the file imports has already been aligned to the backend in a prior commit, so this is just a template check.

### `src/services/citizenPortalService.ts`

Simplify `listMyApplications`:

```ts
async listMyApplications(): Promise<PermitApplication[]> {
  const r = await dmApi.listPermits({ limit: 200, offset: 0 })
  return r.data
},
```

- Drop the `applicantIdNumber` parameter and the client-side filter; the backend now filters by `created_by`.
- Update callers (`ApplicationsSection`, `DashboardSection`, anywhere else that passes an id number) to call with no args.

### `src/composables/useCitizenCase.ts`

`refreshApplications()` already calls `dmApi.listPermits({ limit: 200, offset: 0 })` with no client filter — no change needed. After backend filtering, this naturally returns the citizen's own rows.

## Error handling

- Backend: existing 400 / 401 / 403 / 500 paths unchanged. Adding a new 404 path for "citizen tries to read someone else's permit by id".
- Frontend: citizen `ApplicationsSection` and `DashboardSection` already wrap calls in try/catch with toasts; no new handling needed.

## Testing

### Backend (jest, real DB)

`src/routes/__tests__/permit-applications.citizen.test.js`:

- Log in as `demo.viewer@vungu.test` (role `viewer`) via `/api/auth/login`; record token T_C.
- Log in as `demo.planner@vungu.test`; record token T_P.
- With T_C: `POST /api/permit-applications` with a minimal valid body (`applicant_name`, `development_type='new_building'`) — expect 201.
- With T_C: `GET /api/permit-applications` — expect 200 and `data` includes the citizen's row(s); no rows belonging to another `created_by`.
- With T_P: `GET /api/permit-applications` — expect 200 and `data` length ≥ T_C's data length.
- With T_C: `GET /api/permit-applications/{some_other_planner_owned_id}` — expect 404.
- Clean up by deleting the citizen's smoke rows at end-of-suite.

### Frontend (vitest + happy-dom)

`src/views/citizen/sections/__tests__/NewApplicationSection.standpicker.spec.ts`:

- Mock `useCitizenCase` (return a real `draft` ref so `applyStandSelection` can write into it).
- Mock `useUiFeedback`.
- `mount(NewApplicationSection)` with `StandPickerModal` stubbed.
- Call `(w.vm as any).applyStandSelection(syntheticInVunguBundle)` and assert `draft.stand_number === 'Communal Land'`, `draft.suburb_ward === '6'`, `draft.description` set.

### Manual end-to-end (after deploy)

1. Citizen logs in (`demo.viewer@vungu.test`).
2. `/citizen` → New application → fills steps; on Step 2, pin → modal → pick a Vungu parcel → details apply.
3. Step 5 → Submit → toast "Submitted" → ApplicationsSection lists the new permit with lifecycle `Received`.
4. In another tab: planner logs in (`demo.planner@vungu.test`); Permit Register shows the same row with `dev_register_no` / `stand_number`.
5. Planner opens the permit and moves status → `under_review`.
6. Citizen refreshes `/citizen` → lifecycle now reads `Due diligence`.
7. Out-of-jurisdiction picker case: when a citizen picks a Harare point, the modal blocks confirmation. Submission cannot reference a non-Vungu stand via the picker.

## Extensibility

- Per-section future fields (documents, payments, inspections) drop into the same row by extending the DM Handbook schema; no need for a parallel citizen table.
- If a future requirement appears for "citizens can see other people's published notices", that becomes a separate read endpoint (`GET /api/notices`) reading from a published-notices view; the current own-row filter stays as the default.
- The view-extending migration (075) is the seam for adding any other column the list query needs.

## Files

**Add**
- `app-backend/migrations/075_v_application_summary_add_created_by.sql`
- `app-backend/src/routes/__tests__/permit-applications.citizen.test.js`
- `app-frontend/src/views/citizen/sections/__tests__/NewApplicationSection.standpicker.spec.ts`

**Edit**
- `app-backend/src/routes/development-management.js` — role lists + own-row WHERE + GET `:id` own-row check.
- `app-frontend/src/views/citizen/sections/NewApplicationSection.vue` — pin button, modal, handler, dev-type option audit.
- `app-frontend/src/services/citizenPortalService.ts` — simplify `listMyApplications`.
- `app-frontend/src/views/citizen/sections/ApplicationsSection.vue` and `DashboardSection.vue` — update the `listMyApplications` call sites if they pass an id number.
