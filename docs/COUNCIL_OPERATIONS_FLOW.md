# Council Operations Flow

Canonical map of how a development application (and its related subdivision,
GIS, and survey work) moves through Vungu Rural District Council — who does
each step, what screen they use, what API it calls, and what changes in the
database. Written 2026-08-03 from the actual routes/migrations/views in this
repository, not from aspiration — where an existing doc's description no
longer matched the code, this one follows the code and says so.

Sources reconciled into this doc: `docs/INTEGRATION_REPORT.md` §5 (the
stage-by-stage lifecycle trace this document reorganises around role),
`docs/SCHEMA.md` §5 (roles + inspection stages), and direct reads of
`backend/migrations/061_applicant_type_and_invite_roles.sql`,
`backend/src/routes/application-status.js`,
`backend/src/routes/development-management.js`,
`backend/src/routes/inspections.js`, `backend/src/routes/stands.js`, and the
per-role frontend view folders under `frontend/src/views/`.

## 1. Roles

From `users_role_check` (migration 061): `public`, `registered`, `viewer`,
`admin`, `planner`, `eo`, `env_officer`, `building_inspector`,
`planning_clerk`, `surveyor`, `gis_officer`. `public`/`registered`/`viewer`
are citizen-side access levels, not staff — the sections below cover the
eight staff roles plus the citizen.

## 2. Status model — what's actually true (reconciled)

There are three different-looking "status" concepts in this codebase. They
are not inconsistent so much as **three different things that happen to
share the word "status"** — this section says which is which so nothing gets
conflated:

1. **`development_applications.status`** (the DB column written by the one
   canonical endpoint, `POST /api/applications/:appId/status` in
   `backend/src/routes/application-status.js`) is a **plain `VARCHAR(50)`,
   not an enum**. Migration 042 also declares a Postgres type
   `application_status AS ENUM (draft, submitted, under_review,
   requires_more_info, approved, rejected, withdrawn, ...)` — but the column
   never actually uses that type (see `042_development_applications.sql:33`
   vs `:132`). The enum is effectively unused; nothing in the database
   constrains what string lands in this column, and the route's own comment
   says so explicitly ("Statuses are deliberately a free-form string").
   Treat the enum as historical intent, not an active constraint.
2. **The real governing vocabulary** for what values actually get sent to
   that endpoint is the frontend's `frontend/src/composables/
   useApplicationPipeline.ts` `CanonicalStatus`: `submitted → acknowledged →
   circulation → objection_period → under_review → deferred → approved |
   approved_with_conditions | refused → withdrawn | appealed`. This drives
   the planner's statutory stepper UI and is the closest thing to a
   contract, even though the database doesn't enforce it.
3. **`frontend/src/stores/planningWorkflow.ts`** (`draft → pending_env →
   env_cleared → pending_eo → eo_approved → building_permit_issued →
   foundation_insp → superstructure_insp → roofing_insp → final_insp →
   occupation_issued`) is a **separate sub-machine**: it only starts once a
   permit is issued, and it tracks the building-inspection lifecycle (backed
   by `inspection_bookings` / `inspection_status_events`, not
   `development_applications.status`). Don't read it as a continuation of
   (2) in the same column — it's a different table, different endpoints
   (`backend/src/routes/inspections.js`).

Net effect: the *statutory* pipeline (intake → decision) and the
*inspection* pipeline (permit → occupation) are two different state
machines that happen to be presented as one continuous journey in the UI
and in `docs/INTEGRATION_REPORT.md` §5. Section 4 below follows that
narrative but marks the handover point.

## 3. Role capability matrix

| Role | Frontend surface | Key backend routes (role-gated) | What they own |
|---|---|---|---|
| **Citizen** (`public`/`registered`) | `CitizenPortalView`, `DevelopmentApplicationView`, `PaymentsView`, `PlanReviewView` | `POST /development-applications`, `POST /payments`, `POST /applications/:id/plan-reviews` | Submits, pays, uploads plans, tracks status |
| **Planning Clerk** | `PlanningClerkPortalView` → sections: AcknowledgementsSection, ApplicationReceiptSection, FeesSection, PermitDispatchSection, PublicNoticesSection, DevelopmentRegisterSection, EnforcementRecordsSection | `development-management.js` intake/status (`requireRole` incl. `planning_clerk`), `documents.js` `/documents/queue` + `/:id/verify`, `application-status.js` | Intake receipting (`submitted → under_review`), fee tracking, permit dispatch, public notices, the statutory register |
| **Planner** | `PlannerWorkspaceView` / `PlannerShell` (statutory stepper `Step1Intake…Step5Notices`), **Planning Studio** (`/planner/studio/:layer/:fid`) | `development-management.js` (case updates, consultations, circulation), `stands.js` (subdivision/consolidation, shared with `gis_officer`), `plan-review.js`, `planning.js` (`spatial_planning.planning_project`) | Zoning/due-diligence assessment, circulation to technical bodies, **subdivision layout** (web CAD tool, or via QGIS/AutoCAD — §5), agenda scheduling |
| **EO (Executive Officer)** | `EOPlannerPortalView` → DueDiligenceSection, DecisionReviewSection, PermitDraftingSection, TechnicalCirculationSection, CommitteeReportsSection | `POST /permit-applications/:id/eo-decision` (`EO_DECIDERS = ['eo','admin']`), `PATCH /agenda-items/:id` | The statutory **decision** (approve / approve with conditions / refuse) — gated by the committee resolution check, §4 |
| **Environmental Officer** | `EnvironmentOfficerWorkspaceView` → PlanAppraisalSection, InspectionsSection, SurveillanceSection, CertificatesSection | Shared `STAFF_ROLES` read/status access; consultation response recording | Environmental review stage, plan appraisal, environmental inspections |
| **Building Inspector** | `InspectorWorkspaceView` → PreConstructionSection, StageInspectionsSection, CertificatesSection, EnforcementSection | `inspections.js` (`requireRole(['building_inspector','admin'])` on schedule/reschedule/complete/photos), `development-management.js` stage-inspection + occupation-certificate endpoints | Owns all 9 DM-Handbook inspection stages (§6) and occupation-certificate issuance (server-enforces all 8 prior stages passed first) |
| **Surveyor** | `SurveyorWorkspaceView` / Survey Task Manager module (`frontend/src/views/surveyor/`) | `surveyor.js` (`SURVEYOR=['surveyor','admin']` for findings/coordinates/beacons/control-points; `ASSIGNERS=['planner','eo','planning_clerk','admin']` can assign jobs); `backend/src/survey/routes/*` | Field survey jobs, beacon/control-point capture, DXF/GeoPDF diagram generation for Report-on-Survey deliverables |
| **GIS Officer** | `GISOfficerPortalView` → StandsEditorSection, ZoningMapsSection, EnvironmentalConstraintsSection, AbuttingOwnersSection, SpatialDatabaseSection, PublicGISPortalSection | `gis.js` (`EDITORS=['gis_officer','planner','admin']`), `zones.js`, `stands.js` (shared with planner), QGIS bridge (`qgis.js`) | Spatial database integrity, zoning/constraint layers, abutting-owner analysis, the QGIS↔web sync bridge |
| **Admin** | `/admin/*` | Broadest access across all of the above | Data/content/style management, user/role administration |

## 4. Stage-by-stage flow (statutory pipeline)

Reorganised from `docs/INTEGRATION_REPORT.md` §5 — each stage names the role
that acts, the view they use, and what it writes. Endpoint paths are illustrative
of the pattern already documented there; verify exact routes against
`development-management.js` before relying on them for new integration work,
since that file is large and evolves.

1. **Citizen submits** (`CitizenPortalView` → `DevelopmentApplicationView`) —
   `POST /api/development-applications` writes `development_applications`
   (status=`submitted`), `application_documents`, `application_timeline`.
2. **Planning Clerk receipts** — `POST /api/applications/:id/status {to:
   'under_review'}`, then `POST /api/permit-applications` creates the
   statutory `spatial_planning.permit_application` record (issues the TPD
   reference).
3. **Circulation** (Planner) — `POST /permit-applications/:id/consultations`
   writes `spatial_planning.application_consultation`; status moves toward
   `env_review`.
4. **Environmental review** (Env Officer) — `PATCH /consultations/:id/
   response`, then status moves to `survey_review` or straight to
   `pending_decision`.
5. **Committee decision** (Planner recommends, EO decides) — gated by two
   checks (§ committee gates below), then `POST /permit-applications/:id/
   eo-decision`. On approval, `POST /applications/:id/status {to:
   'approved'}` fires the citizen notification.
6. **Fee payment** (Citizen) — `PaymentsView` → `POST /api/payments`, driver
   callback confirms (`payments.status = paid`).
7. **Building plans** (Citizen uploads, Planner/EO reviews) — `POST
   /applications/:id/plan-reviews` runs `planReview.runDeterministicChecks()`
   automatically before a human decides; `POST /plan-reviews/:id/decide`
   → status moves to `building_permit_issued`. **This is the handover point**
   from the statutory pipeline to the inspection sub-machine (§2.3).
8. **Building inspections — 9 stages** (Building Inspector; see §6).
9. **Occupation certificate** (Building Inspector) — only issuable once all
   8 prior stages show `passed` (server-enforced in
   `development-management.js`); final `POST /applications/:id/status
   {to: 'occupation_issued'}`.

## 5. Subdivision: web tool, plus the QGIS/AutoCAD round-trip

A subdivision (or consolidation) can be part of an application at stage 3–5
above, or done standalone by a planner. Three ways to do the actual layout
work, all producing the same `spatial_planning.planning_project` record:

- **In-browser CAD tool** (Planning Studio, `/planner/studio/:layer/:fid`,
  and the lighter side-panel version on `/planner`) — draw roads, generate
  blocks, run subdivision, edit lots directly. `frontend/src/planning/**`.
- **Via QGIS Desktop or AutoCAD/Civil3D/Bricscad** — the planner exports the
  current layout as a georeferenced DXF ("Export DXF (AutoCAD)" in the
  Planning Studio side panel), edits it in whichever tool they prefer (QGIS
  reads/writes DXF natively via its OGR driver; so does AutoCAD/Civil3D),
  and re-imports the edited file ("Import from CAD/QGIS (DXF)", same panel).
  Reconciliation matches lots back to their original record by an embedded
  id (falls back to the visible "Lot n" label only when that id is
  ambiguous), replaces roads if the file has any, and leaves the result in
  the same in-memory session the web tool edits — validated by the same
  standards checks, saved through the same endpoint, with the same
  optimistic-lock/undo history. See `docs/QGIS_WEB_INTEGRATION.md` for the
  technical detail and what's deliberately out of scope (native GeoPackage,
  a live QGIS-plugin sync for planning projects specifically, real binary
  DWG) versus this repo's separate generic QGIS↔web layer-sync bridge.
- **QGIS↔web live layer sync** (a different, pre-existing capability, GIS
  Officer-owned) — real-time push/pull of general PostGIS layers via the
  PyQGIS plugin; not wired to `planning_project` specifically. Documented in
  full in `docs/QGIS_WEB_INTEGRATION.md`.

## 6. Building inspections — the 9 DM-Handbook stages

From `backend/src/routes/inspections.js` (header comment, sourced from "DM
Handbook 2021 v1.2 Annexure 12"), matching `docs/SCHEMA.md` §5.3 exactly:

1. Setting out
2. Foundation trenches and footing levels
3. Foundation brickwork to floor level
4. Brickwork and window level
5. Brickwork to wall plate
6. Roof trusses
7. Drainage/sewerage work
8. Final inspection
9. Certificate of occupation

Each stage: citizen books + pays → Building Inspector schedules → completes
(pass/fail + notes) → optional photo evidence. Stage 9 (occupation
certificate) is server-gated on stages 1–8 all showing `passed`.

## 7. Committee gates

Two independent checks guard a determination, both in
`development-management.js` (confirmed via `committee-gate.test.js`):

1. **Resolution required**: an EO decision is rejected (`committee_resolution_
   required`) unless backed by a recorded committee resolution, or an
   audited delegated-authority override.
2. **Quorum required**: a resolution can't be recorded on a meeting where
   `present_count < quorum` (`409 quorum_not_met`).

Committee scheduling (`SCHEDULERS = ['planner','planning_clerk','eo','admin']`)
and reads (`STAFF_ROLES`) are broader than who can actually decide.

## 8. Keeping this current

This document is a snapshot of the code as read on 2026-08-03. The
`development-management.js` route file in particular is large and actively
developed — when it changes in a way that moves a stage, a role's gate, or
the committee logic, update this file in the same change (Definition of
Done, `GOVERNANCE.md`). If a future read finds this doc and the code have
drifted, trust the code and fix this file, not the reverse.
