# Planner Case Backend — Tasks, Messages, Documents, Clock, Handoff, Analysis

**Date:** 2026-06-10
**Status:** Design (awaiting review) · migration 085 written, routes NOT yet implemented
**Scope:** Backend (`app-backend`) data model + API for the Planner Console · consumed by the frontend Planner workspace
**Repo:** `app-backend` (migration + routes) · `app-frontend` (service + UI, later phase)

## 1. Problem

The Planner Console's statutory workflow is mostly backend-backed (permit applications, the planner case file, referrals/consultations, objections, committee, audit), but several planner needs still have **no persistent home** or live in **fragmented, per-role tables**:

- No shared **case conversation** keyed on the permit (only `survey_comment`, surveyor-scoped, and `application_comments`, citizen dev-apps).
- No **document review / document-request** loop tied to a permit (citizen_documents is identity-verification, user-scoped).
- No **statutory-clock control** beyond a single `statutory_due_date` (no pause/resume/extend ledger).
- No **EO-handoff** record, **generated-document** store, or **spatial-analysis** persistence (the demo `/api/analyze` was removed).
- Specialist findings exist but **scattered** across `application_consultation`, `survey_finding`, `plan_review_findings`, `stage_inspection` with no single read.

## 2. Goal

Fill exactly the missing pieces so the planner case file is fully backend-backed, **reusing the substantial existing schema** rather than rebuilding it.

## 3. Decision — Federate, don't unify (chosen)

The DB already implements most of the requested concepts per-role. Rather than a risky migration of live tables into generic ones, we **federate**: keep the role-specific tables, promote `application_consultation` to the canonical "case task", add only the genuinely-missing tables, and expose specialist findings as a **UNION view**.

| Requested entity | Disposition | Backing |
|---|---|---|
| `case_assignments` | **Reuse** | `permit_application.assigned_to` (lead) + `application_consultation.assigned_to` (specialist); reassignment → `permit_event`. |
| `case_tasks` | **Extend** | `application_consultation` + new `priority`, `task_status`, `task_type`. |
| `case_messages` + `message_visibility` | **New** | `case_message` (with `visibility` enum, modelled on `survey_comment.audience`). |
| `document_reviews` | **New** | `document_review` (+ `permit_document` link). |
| `document_requests` | **New** | `document_request`. |
| `specialist_findings` | **New (view)** | `v_specialist_findings` UNION-ing consultation/survey/inspection/plan-review. |
| `statutory_clock_events` | **New** | `statutory_clock_event` + `permit_application.clock_state`/`clock_paused_days`. |
| `planner_recommendations` | **Reuse** | `permit_application.recommendation`/`recommendation_reasons`/`committee_report`; history → `permit_event` / folded into handoff. |
| `eo_handoff_packages` | **New** | `eo_handoff_package` + status `awaiting_eo_decision`. |
| `generated_documents` | **New** | `generated_document` (versioned, server-stored). |
| `spatial_analysis_results` | **New** | `spatial_analysis_result` (real PostGIS overlay). |
| `case_visibility` / `message_visibility` | **Column** | `case_message.visibility`; no separate table. |

**Net: 8 new tables, 1 view, column additions to 2 tables.** The other entities are reuse/extend.

## 4. Data model — migration `085_planner_case_backend.sql`

Written and registered (see §6). Highlights:

- **`permit_application`** — `+awaiting_eo_decision` in the status CHECK; `+clock_state` (`running|paused|stopped`), `+clock_paused_days`. `statutory_due_date` (082) stays the authoritative current due date; the ledger explains it.
- **`application_consultation`** — `+priority`, `+task_status` (`open|in_progress|responded|accepted|returned|cancelled`, distinct from the finding `response_status`), `+task_type` (routes to a specialist workspace).
- **`case_message`** — `permit_app_id`, `author_id/role`, `message_type` (`internal_note|citizen_message|specialist_comment|decision_comment|document_request`), **`visibility`** (`internal|specialist|citizen|public`), `body`, `in_reply_to`, `attachments` jsonb.
- **`permit_document`** — soft polymorphic link `(document_id, source∈citizen|application|generated|external)` so a permit can list docs from any source.
- **`document_request`** — `doc_kind`, `reason`, `status` (`open|fulfilled|waived|cancelled`), `due_at`, `fulfilled_document_id`.
- **`document_review`** — decision (`approved|rejected|replacement_requested`) on a `permit_document`; distinct from citizen-doc identity `/verify`.
- **`statutory_clock_event`** — append-only `event_type` (`started|paused|resumed|extended|breached|reset`), `reason`, `days_delta`, `new_due_date`.
- **`generated_document`** — `doc_type` (`due_diligence_report|committee_report|decision_memo|permit|refusal_letter|outcome_letter|acknowledgement`), `storage_url`, `sha256_hex`, `version`/`supersedes`, `payload` snapshot.
- **`spatial_analysis_result`** — `analysis_type`, `input_geom`/`result_geom` (4326), `result` jsonb; `permit_app_id` nullable for ad-hoc.
- **`eo_handoff_package`** — `recommendation`, `reasons`, `conditions`, `attachments` (generated_document ids), `findings_snapshot`, `status`, `eo_decision`.
- **`v_specialist_findings`** — UNION of `application_consultation` responses, `survey_finding` (via `survey_task`), `stage_inspection` results, and `plan_review_findings` (joined to the permit via `permit_application.dev_app_id = plan_reviews.application_id`).

FK + idempotency conventions mirror 070/080 (`permit_app_id … ON DELETE CASCADE`; `*_by/*_to → users ON DELETE SET NULL`; `IF NOT EXISTS`; `set_updated_at()` triggers on mutable tables).

## 5. API surface (route-implementation pass — NOT in this change)

All in `src/routes/development-management.js`, following its `requireRole` + `logEvent` conventions. Every mutation appends a `permit_event`.

| Endpoint | Verb · roles | Backing |
|---|---|---|
| `GET /planner/cases?assigned_to=me&status=…` | planner/eo/admin | `permit_application` filtered: assigned-to-me · unassigned · overdue (`statutory_due_date < now`) · awaiting-action/specialist/citizen · ready-for-eo. |
| `POST /permit-applications/:id/tasks` | planner/eo/admin | insert `application_consultation` (`assigned_to`, `priority`, `due`, `task_type`). |
| `PATCH /tasks/:id/status` | assignee + planner | update `application_consultation.task_status`. |
| `GET·POST /permit-applications/:id/messages` | role-filtered by `visibility` | `case_message`. |
| `GET /permit-applications/:id/documents` | staff + owner | `permit_document` (+ join to source rows). |
| `PATCH /permit-documents/:pdid/review` | planner/eo/admin | `document_review` (renamed from `/documents/:id/review` to avoid colliding with the existing citizen-doc `/documents/:id/verify`). |
| `POST /permit-applications/:id/document-requests` | planner/eo/admin | `document_request` (+ optional `case_message`). |
| `POST /permit-applications/:id/submit-to-eo-planner` | planner/admin | `eo_handoff_package` + status→`awaiting_eo_decision`. |
| `POST /permit-applications/:id/statutory-clock-events` | planner/eo/admin | `statutory_clock_event` + recompute `statutory_due_date`/`clock_state`. |
| `POST /permit-applications/:id/generated-documents` | planner/eo/admin | store PDF → `generated_document` (+ `permit_document` source='generated'). |
| `POST /spatial-analysis` | staff | `ST_Intersects` drawn geom vs the 24 registry layers → `spatial_analysis_result`. |
| `GET /permit-applications/:id/specialist-findings` | staff + owner | read `v_specialist_findings`. |

**Route note:** the implementation pass must add `'awaiting_eo_decision'` to `VALID_STATUSES` in the `PATCH /:id/status` handler, and to the frontend `PermitStatus` union + `STATUS_LABEL` maps.

## 6. Migration / deployment note (important)

`scripts/migrate.js`'s `MIGRATIONS` allowlist had stopped at **081** — 082/083/084 were applied to local/dev via `psql` but were **never in the Render runner**. Since 085 depends on 082's case columns, this change adds **082, 083, 084, 085** to the array (all idempotent + `schema_migrations`-tracked → safe) and updates `migrate-render.test.js`'s expected list. A fresh deploy now provisions the full planner case schema in order.

## 7. Non-goals / later phases

- **No route handlers or frontend in this change** — model only, per the agreed "spec + migration 085, then stop for review".
- **No unification** of `survey_task`/`consultation` into generic tables (explicitly rejected — see §3).
- **Phasing after review:** (1) routes + `dmApi`/service methods per §5; (2) frontend — inbox queue, case thread, document review, clock controls, findings panel, EO-handoff; (3) wire the real `POST /spatial-analysis` back into the planner map (replacing the removed demo).

## 8. Open questions for review

1. **Clock recompute** — store `statutory_due_date` as derived-on-write from clock events (chosen), or compute on read? Current design writes `new_due_date` per event and mirrors it onto the permit.
2. **`document_review` path** — keep `/permit-documents/:pdid/review` (disambiguated) vs the literal `/documents/:id/review` requested? Recommend the former.
3. **`v_specialist_findings` plan-review join** is via `dev_app_id` (loose string link, since `plan_reviews` predates the permit schema). Acceptable, or add a hard link column on a later migration?
4. **`generated_document` storage** — reuse the existing on-disk upload root pattern (`uploads/…`) as in stage-photos/citizen-docs, confirmed?
