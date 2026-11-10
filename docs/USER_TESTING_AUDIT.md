# SpartialIQ — Full User-Flow Testing Audit

**Date:** 2026-06-09
**Branch:** master
**Servers tested:** Backend `http://localhost:3000` · Frontend `http://localhost:5175`
**Database status:** PostgreSQL not running locally — all DB-backed endpoints return `500 Internal Server Error`. Audit covers both the live DB-off observable state and full code-level flow tracing for every role.

---

## Contents

1. [The Root Data-Split Bug](#1-the-root-data-split-bug)
2. [Citizen](#2-citizen--citizen)
3. [Planner](#3-planner--planner)
4. [EO Planner](#4-eo-planner--eo-planner-portal)
5. [Building Inspector](#5-building-inspector--building-inspector)
6. [Planning Clerk](#6-planning-clerk--planning-clerk-portal)
7. [Environment Officer](#7-environment-officer--env-officer)
8. [Surveyor](#8-surveyor--surveyor)
9. [GIS Officer](#9-gis-officer--gis-officer-portal)
10. [Admin](#10-admin--admin)
11. [Cross-Cutting Broken Buttons](#11-cross-cutting-broken-buttons--interactions)
12. [Priority Fix List](#12-priority-fix-list)

---

## 1. The Root Data-Split Bug

There are **two completely separate application tables** in the system. The citizen-facing submission flow and two critical staff views are wired to different tables and never see each other's data.

| Actor | API called | Table | Wired? |
|---|---|---|---|
| Citizen submits application | `POST /api/permit-applications` | `permit_applications` | ✅ |
| Planner workspace reads list | `GET /api/permit-applications` | `permit_applications` | ✅ |
| **WorkflowDashboard reads list** | `GET /api/development-applications` | `development_applications` | ❌ Wrong table |
| **ApplicationTrackingView reads** | `GET /api/development-applications/:id` | `development_applications` | ❌ Wrong table |
| **"Advance status" button** | `POST /api/applications/:appId/status` | `development_applications` | ❌ Wrong table |

**End result:** A citizen submits a permit application → it lands in `permit_applications`. The Workflow Dashboard queries `development_applications` (empty or stale legacy rows). Staff see nothing. The citizen's own "Track application" view also shows nothing. The "Advance status" button in the dashboard writes to a row that no citizen application ever populated.

### Files to fix

| File | Line | Change |
|---|---|---|
| `frontend/src/views/WorkflowDashboardView.vue` | 353 | `api.get('/development-applications')` → `api.get('/permit-applications')` |
| `frontend/src/views/WorkflowDashboardView.vue` | 393 | `api.get('/applications/${row.id}/status-history')` — status-history endpoint must also exist on `permit_applications` |
| `frontend/src/views/WorkflowDashboardView.vue` | 403 | `api.get('/applications/${row.id}/inspections')` — OK, points to inspection bookings |
| `frontend/src/views/WorkflowDashboardView.vue` | ~470 | `advanceStatus` POST target must change to `PATCH /api/permit-applications/:id/status` |
| `frontend/src/views/WorkflowDashboardView.vue` | 178 | "View full application" link: `` `/development-application/${row.id}` `` → `` `/applications/${row.id}` `` |
| `frontend/src/views/ApplicationTrackingView.vue` | 262 | `api.get('/development-applications/${appId}')` → `dmApi.getPermit(appId)` |

---

## 2. Citizen (`/citizen`)

**Login redirect:** `registered` / `public` role → `/citizen` ✅

### New Application (5-step TPD wizard)

| Step | Feature | What happens | Status |
|---|---|---|---|
| 1 | Applicant identity form | Saves to localStorage draft | ✅ Works |
| 2 | Site / stand picker | Opens `StandPickerModal`, populates stand fields | ✅ Works |
| 3 | Development type + description | Saves to draft | ✅ Works |
| 4 | Document checklist | Marks docs as staged (no actual file upload here) | ⚠️ Documents are stubs only — no file bytes uploaded |
| 5 | Consent + declaration + Submit | Calls `dmApi.createPermit()` → `POST /api/permit-applications` | ✅ Correct table |
| — | "+ New draft" button | Creates blank draft in localStorage | ✅ Works |
| — | Trash icon on draft | Removes draft | ✅ Works |
| — | Stand picker "Cancel" | Closes modal without changes | ✅ Works |

### My Applications

| Feature | What happens | Status |
|---|---|---|
| Applications list on load | `dmApi.listPermits()` → `GET /api/permit-applications` | ✅ Correct table |
| Search by register no / stand | Client-side filter | ✅ Works |
| Status dropdown filter | Client-side filter | ✅ Works |
| Click an application row | `citizenPortalService.getCaseSnapshot(id)` → `dmApi.getPermit(id)` | ✅ Works |
| **"Track application →" button** | Navigates to `/applications/:id/track` → `ApplicationTrackingView` reads `development_applications` | ❌ **Wrong table — always 404** |
| Case detail — lifecycle stages | Renders `APPLICATION_LIFECYCLE` with current status | ✅ Visual |
| "Refresh" button | Re-calls `dmApi.listPermits()` | ✅ Works |

### Inspections

| Feature | Status |
|---|---|
| Load existing bookings per permit | ✅ `dmApi.listStageInspections(permitId)` |
| "Request inspection" button | ✅ `POST /api/permit-applications/:id/stage-inspections` |
| 9-stage progress display | ✅ Rendered from bookings data |
| Fee payment link for inspection | ✅ Links to `/payment/:refNo` |

### Payments

| Feature | Status |
|---|---|
| Load payment methods | ✅ `GET /api/payments/methods` |
| Initiate payment | ✅ `POST /api/payments` (auth required) |
| Payment history list | ✅ `GET /api/payments` |
| Cancel payment | ✅ `POST /api/payments/:id/cancel` |
| Manual confirm (dev mode) | ✅ `POST /api/payments/:id/confirm` |
| USSD code display | ✅ Shown from `initResult.ussdCode` |

### Documents

| Feature | Status |
|---|---|
| Upload document | ✅ `POST /api/documents` (multipart) |
| View my documents | ✅ `GET /api/documents/mine` |
| Delete document | ✅ `DELETE /api/documents/:id` |
| Request verification | ✅ `POST /api/documents/:id/verify` |

### Appeals

| Feature | Status |
|---|---|
| "File appeal" button | ⚠️ **localStorage only** — no backend call; appeal is lost on page refresh or different device |
| 28-day window countdown | ✅ Calculated locally |

### Certificates

| Feature | Status |
|---|---|
| Show occupation certificate | ✅ `dmApi.getCertificate(permitId)` |
| Download certificate | ⚠️ No download endpoint wired — shows data only |

---

## 3. Planner (`/planner`)

**Login redirect:** `planner` role → `/planner` ❌ **Wrong destination**

`/planner` loads `VunguPlannerView` — a 2,873-line spatial map viewer with search, layer toggles, and stand picking. It has **no workflow tools** — no permit list, no case management, no statutory steps. The actual workflow workspace is at `/planner-workspace` (`PlannerWorkspaceView`) which is fully wired to `dmApi`.

**Fix:** Change `roleHome('planner')` in `frontend/src/router/index.ts:461` from `/planner` to `/planner-workspace`.

### Planner Workspace (`/planner-workspace`) — when navigated to manually

| Section | Feature | Status |
|---|---|---|
| Dashboard | Load permit list + enforcement orders | ✅ `dmApi.listPermits()` + `dmApi.listEnforcement()` |
| Dashboard | Deemed-refusal deadline cards | ✅ Calculated from `received_at` |
| Dashboard | Falls back to demo data when offline | ✅ 4 demo permits shown |
| Dashboard | 30-second auto-refresh poll | ✅ `setInterval(refresh, 30_000)` |
| Statutory Workflow | Open any permit from register | ✅ `dmApi.getPermit(id)` |
| Statutory Workflow | Step 1 — Intake / completeness check | ✅ `dmApi.updatePermitStatus('complete')` |
| Statutory Workflow | Step 2 — Due diligence | ✅ `dmApi.updatePermitStatus('under_review')` |
| Statutory Workflow | Step 3 — Committee report | ✅ `dmApi.updatePermitStatus('consultation')` |
| Statutory Workflow | Step 4 — Permit drafting | ✅ `dmApi.updatePermitStatus('permit_drafting')` |
| Statutory Workflow | Step 5 — Issue permit | ✅ `dmApi.updatePermitStatus('permit_issued')` |
| Statutory Workflow | Statutory clock banner | ✅ Shows days elapsed + deemed-refusal warning |
| Permit Register | Search + filter | ✅ Client-side over `dmApi.listPermits()` |
| Permit Register | Click row → opens statutory workflow | ✅ `usePlannerCase.selectPermit(id)` |
| Permit Register | Export button | ⚠️ UI present — no backend export endpoint wired |
| Enforcement | List orders | ✅ `dmApi.listEnforcement()` |
| Enforcement | Create order | ✅ `POST /api/enforcement-orders` |
| Enforcement | Update order status | ✅ `PATCH /api/enforcement-orders/:id/status` |
| Building Plans | List plans for a permit | ✅ `dmApi.listBuildingPlans(permitId)` |
| Building Plans | Appraise / annotate plan | ✅ `dmApi.appraiseBuildingPlan()` |
| Reports | Stats aggregations | ⚠️ Renders counts from loaded permits — no dedicated reports endpoint |

---

## 4. EO Planner (`/eo-planner-portal`)

**Login redirect:** `eo` role → `/eo-planner-portal` ✅

This is the **best-wired role** in the system. All sections correctly use `eoPlannerService` which wraps `dmApi`.

| Section | Feature | Status |
|---|---|---|
| Dashboard | Intake queue (registered / pending_docs / under_review) | ✅ |
| Dashboard | Due-diligence queue | ✅ |
| Dashboard | Public notice queue | ✅ |
| Dashboard | Committee bundle | ✅ |
| Dashboard | Permit drafting queue | ✅ |
| Dashboard | 90-day deemed-refusal clock per application | ✅ Calculated from `received_at` |
| Dashboard | Urgent (≤14 days to deemed) highlighted | ✅ |
| Intake Review | List + accept / query / reject applications | ✅ `dmApi.updatePermitStatus()` |
| Due Diligence | Technical queries to applicant | ✅ `dmApi.listConsultations()` |
| Technical Circulation | Send to departments | ✅ `POST /api/consultations` |
| Technical Circulation | Record department responses | ✅ `PATCH /api/consultations/:id/response` |
| Public Notification | Trigger objection period | ✅ `dmApi.updatePermitStatus('objection_period')` |
| Objection response | Record applicant response | ✅ `PATCH /api/objections/:id/consideration` |
| Committee Reports | Bundle generation | ✅ Renders from permit data |
| Permit Drafting | Draft + issue permit | ✅ `dmApi.updatePermitStatus('permit_issued')` |
| Enforcement | Create / manage orders | ✅ `dmApi.createEnforcement()` |

---

## 5. Building Inspector (`/building-inspector`)

**Login redirect:** `building_inspector` → `/building-inspector` ✅

| Feature | Status |
|---|---|
| Application search by stand / name | ✅ `dmApi.listPermits({ search })` |
| Create a new permit application (from inspector) | ✅ `dmApi.createPermit()` |
| List stage inspections for a permit | ✅ `dmApi.listStageInspections(permitId)` |
| Create stage inspection booking | ✅ `POST /api/permit-applications/:id/stage-inspections` |
| Record inspection result (pass/fail/conditional) | ✅ `dmApi.recordInspectionResult()` |
| Record checklist items | ✅ `dmApi.recordChecklist()` |
| Upload inspection photo | ✅ `dmApi.uploadStagePhoto()` (multipart) |
| Flag an inspection issue | ✅ `dmApi.flagStageInspection()` |
| View stage flags | ✅ `dmApi.listStageFlags()` |
| List building plans | ✅ `dmApi.listBuildingPlans(permitId)` |
| Appraise building plan | ✅ `dmApi.appraiseBuildingPlan()` |
| Add plan annotation | ✅ `POST /api/building-plans/:bpid/annotations` |
| Get occupation certificate | ✅ `dmApi.getCertificate(permitId)` |
| **Issue occupation certificate** | ✅ `dmApi.issueCertificate(permitId, { issued_by, notes })` |
| View inspection scoring breakdown | ✅ `dmApi.getInspectionScoring()` |

Building Inspector is **fully wired** and the most complete staff portal.

---

## 6. Planning Clerk (`/planning-clerk-portal`)

**Login redirect:** `planning_clerk` → `/planning-clerk-portal` ✅

| Section | Feature | Status |
|---|---|---|
| Dashboard | KPI counts | ✅ `planningClerkService` → `dmApi` |
| Dashboard | New applications today | ✅ Filters by `received_at` = today |
| Development Register | Full list of all permits | ✅ `planningClerkService.developmentRegister()` |
| Development Register | Days-since-received column | ✅ Calculated from `received_at` |
| Application Receipt | Mark application received | ✅ `dmApi.updatePermitStatus('received')` |
| Application Receipt | **Payment link field** | ⚠️ Requires clerk to manually paste dmApi UUID — no lookup or autocomplete |
| Fees section | Record fee payment | ⚠️ Links to payment service but no auto-reconcile against `permit_applications.fee_paid` |
| Dispatch Queue | List approved / conditionally approved permits | ✅ `planningClerkService.dispatchQueue()` |
| Refusal Queue | List refused permits | ✅ `planningClerkService.refusalQueue()` |
| Public Notices | Manage public notice records | ⚠️ UI present — no backend call wired (static form) |
| Acknowledgement Letters | Generate acknowledgement | ⚠️ No email / PDF dispatch wired |
| Enforcement Records | View enforcement orders | ✅ `dmApi.listEnforcement()` |
| Permit Dispatch | Record permit collected | ⚠️ UI only — no `PATCH` call to mark permit dispatched |

---

## 7. Environment Officer (`/env-officer`)

**Login redirect:** `env_officer` → `/env-officer` → `EnvironmentalOfficerView`

> **Domain note:** This role is the Environmental Health Officer (EHO) — food premises, water quality, disease surveillance. It is a **separate domain** from the development-application workflow. This is architecturally correct. However, the link between development applications requiring EHO appraisal and this portal is not implemented.

| Feature | Status |
|---|---|
| EHO Dashboard (premises, outbreaks, water) | ⚠️ Uses `useHealthCase` composable — **all data is local mock state**, no backend calls |
| Plan Appraisal section | ⚠️ Should receive planning apps needing EHO sign-off; not connected to `permit_applications` or `consultations` |
| Inspections (food premises) | ⚠️ Local state only |
| Surveillance (outbreak tracking) | ⚠️ Local state only |
| Enforcement (health nuisances) | ⚠️ Local state only |
| Certificates (health certs) | ⚠️ Local state only |

**Missing link:** When the EO Planner sends a permit to technical circulation and selects `department = environmental_health`, the EHO portal should display that consultation and allow the officer to record a response. Currently there is no query to `GET /api/applications/:id/consultations?department=environmental_health` in this portal.

---

## 8. Surveyor (`/surveyor`)

**Login redirect:** `surveyor` → `/surveyor` → `SurveyorView`

> **Domain note:** Surveyor manages cadastral records — stand register, beacons, encroachments, setting-out. Separate from development application workflow. Architecturally separate domain.

| Feature | Status |
|---|---|
| Dashboard (stands, beacons, encroachments) | ⚠️ Uses `useCadastralCase` composable — **all data is local mock state**, no backend calls |
| Cadastral section | ⚠️ Local state only |
| Layouts section | ⚠️ Local state only |
| Beacon verification | ⚠️ Local state only |
| Construction setting-out | ⚠️ Local state only |
| Enforcement support | ⚠️ Local state only |

**Missing link:** When a planning application goes to technical circulation and `department = survey`, the surveyor should see the consultation in their queue. Currently the surveyor portal has no connection to the `consultations` table.

---

## 9. GIS Officer (`/gis-officer-portal`)

**Login redirect:** `gis_officer` → `/gis-officer-portal` ✅

| Section | Feature | Status |
|---|---|---|
| Dashboard | KPI counts | ⚠️ Uses `useGisCase` composable — local state |
| Application Mapping | List permits for mapping | ✅ `dmApi.listPermits()` in ApplicationMappingSection |
| Spatial Database | Map layer management | ✅ `GET /api/tiles/layers` |
| Dynamic layers | Register new layer | ✅ `POST /api/layers` (dynamic-layers route) |
| Abutter notification maps | Generate abutter list | ⚠️ UI exists but `GET /api/coordinate-points` call is not guaranteed to return abutters for a given parcel |
| Zoning maps | View zone data | ✅ `GET /api/development-control/zones` |
| Environmental constraints | View constraint layers | ✅ Tile layers |
| Forward planning maps | View strategic plans | ⚠️ Static tiles — no plan documents wired |
| Data quality | Layer validation | ⚠️ UI only — no backend validation endpoint |
| Public GIS portal | External map viewer config | ⚠️ Config saved locally, not persisted |
| QGIS plugin sync | Push styles to QGIS | ⚠️ Backend `SecurityAuditService` disabled — plugin sync endpoint returns placeholder message |

---

## 10. Admin (`/admin`)

**Login redirect:** `admin` → `/admin/users` (redirects to `/admin`) ✅

| Feature | Status |
|---|---|
| User list | ✅ `GET /api/admin/users` (requires admin JWT) |
| Invite staff member | ✅ `POST /api/auth/invite` |
| Set role on invite | ✅ Validated against `INVITABLE_ROLES` allowlist |
| Suspend / activate user | ✅ `POST /api/admin/users/:id/suspend` |
| Edit user role / job title | ✅ `PUT /api/admin/users/:id` |
| Delete user | ✅ `DELETE /api/admin/users/:id` |
| Reset user password | ✅ `POST /api/admin/users/:id/reset-password` |
| Invite list | ✅ `GET /api/admin/invites` |
| Revoke pending invite | ✅ `DELETE /api/admin/invites/:id` |
| Land Use Management page | ⚠️ `requiresAdmin: true` **commented out** — any logged-in user can access `/admin/land-use` |
| Security Dashboard | ⚠️ Route exists; `SecurityAuditService` is disabled on backend — returns placeholder |
| Video Tutorials | ⚠️ Static content only |
| QGIS Plugin page | ⚠️ Shows plugin download info; sync service disabled |

---

## 11. Cross-Cutting Broken Buttons & Interactions

| Location | Element | Problem | Fix |
|---|---|---|---|
| WorkflowDashboard | "View full application" button | Links to `/development-application/${row.id}` — this opens the **new-application wizard form**, not a detail view | Change to `/applications/${row.id}` |
| WorkflowDashboard | "Citizen tracking view" button | Navigates to `/applications/:id/track` which reads `development_applications` — always 404 | Fix ApplicationTrackingView to use `dmApi.getPermit()` |
| WorkflowDashboard | "Advance status" button + modal | Calls `POST /api/applications/:appId/status` against `development_applications` IDs — no citizen application ever has an ID in that table | Rewire to `PATCH /api/permit-applications/:id/status` |
| WorkflowDashboard | localStorage fallback | Falls back to `localStorage.getItem('vungu_applications')` on API error — this key is **never written** anywhere in the codebase | Remove fallback or write to this key on submission |
| Citizen → My Applications | "Track application →" | Navigates to ApplicationTrackingView which reads wrong table | Fix tracking view to use `dmApi.getPermit()` |
| Citizen → Appeals | "File appeal" button | Saves to localStorage only — lost on hard refresh or other device | Wire to a backend endpoint |
| Any portal | "Refresh" button while DB is down | Error message shown but no friendly offline state — only Planner / Inspector show demo data | Add consistent offline demo mode |
| Admin → Land Use | Page access | `requiresAdmin: true` is commented out — citizens can navigate here | Re-enable guard |
| Planning Clerk → Receipt | Payment link field | Clerk must manually paste a UUID — no autocomplete or lookup from the permit list | Add `<select>` from loaded permits |
| Planning Clerk → Dispatch | "Mark as dispatched" | Button present; no `PATCH` call to update permit status to `dispatched` | Wire button |
| Planning Clerk → Notices | Public notice form | Form fields present; no `POST` or `PUT` call | Wire to backend |
| EHO → Plan Appraisal | EHO clearance form | No connection to `consultations` table | Wire to `PATCH /api/consultations/:id/response` |
| Surveyor portal | All sections | All local mock state — no backend calls | Wire to cadastral backend or document as future phase |

---

## 12. Priority Fix List

### P0 — Must fix before any real permit data flows end-to-end

1. **WorkflowDashboard wrong table** — `frontend/src/views/WorkflowDashboardView.vue:353`
   Change `api.get('/development-applications', ...)` → `api.get('/permit-applications', ...)` and update the "advance status" `POST` target to `PATCH /api/permit-applications/:id/status`.

2. **WorkflowDashboard "View full application" wrong link** — `WorkflowDashboardView.vue:178`
   Change `` `/development-application/${row.id}` `` → `` `/applications/${row.id}` ``.

3. **ApplicationTrackingView wrong table** — `frontend/src/views/ApplicationTrackingView.vue:262`
   Change `api.get('/development-applications/${appId}')` → `dmApi.getPermit(appId)` and map the response to the tracking view's `app` shape.

4. **Planner sent to map view instead of workflow** — `frontend/src/router/index.ts:461`
   Change `return '/planner'` → `return '/planner-workspace'`.

5. **Start PostgreSQL** — Without the database running, registration, login, and all data operations fail with HTTP 500. No other fixes are testable until the DB is up.

### P1 — Wire remaining staff roles to backend

6. **EHO appraisal handoff** — In `EnvironmentOfficerWorkspaceView`, the EHO plan-appraisal section should query `GET /api/applications/:id/consultations?department=environmental_health` and call `PATCH /api/consultations/:id/response` when the officer grants or refuses clearance.

7. **Surveyor circulation link** — `SurveyorWorkspaceView` should query `GET /api/permit-applications` filtered to `consultation` status and list pending `consultations` where `department = survey`.

8. **Citizen appeals backend persistence** — Wire `useCitizenCase.fileAppeal()` to a real endpoint (e.g. `POST /api/permit-applications/:id/objections`) instead of localStorage.

9. **Planning Clerk permit dispatch** — Wire the "mark dispatched" button to `PATCH /api/permit-applications/:id/status` with `status = permit_issued`.

10. **Planning Clerk public notices** — Wire the notice form to a backend endpoint or to the `objection_period` status transition.

### P2 — Quality and observability

11. **Re-lock `/admin/land-use`** — Uncomment `requiresAdmin: true` in `frontend/src/router/index.ts:218`.

12. **Offline demo data for WorkflowDashboard** — Mirror the planner / inspector fallback pattern: show clearly-labelled demo rows when the API is unreachable.

13. **Remove dead `vungu_applications` localStorage fallback** in `WorkflowDashboardView.vue:365` — this key is never written anywhere.

14. **Planning Clerk fee auto-reconcile** — When a payment is confirmed (`status = paid`), automatically set `permit_applications.fee_paid = true` for the linked `related_id`.

15. **GIS Officer `useGisCase` backend** — Decide whether to wire cadastral / GIS case data to a backend table or document clearly that the GIS portal is Phase 3 and these sections are placeholders.

---

*Generated by SpartialIQ code-level flow audit · 2026-06-09*
