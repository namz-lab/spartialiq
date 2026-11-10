# Requisition for Claude Enterprise Account
## Project: SpartialIQ — Zimbabwe Multi-Council Digital Planning Portal

**Prepared by:** Kedar Munyama (munyanamaz@gmail.com)
**Date:** 15 June 2026
**Repository:** `c:\Users\munya\Desktop\finale` (branch: master)

---

## 1. Executive Summary

SpartialIQ is a full-stack digital planning portal built to replace paper-based development control across multiple Zimbabwe local authorities. The system handles the complete lifecycle of a planning application — from citizen submission through statutory review, building inspections, fee payments, and certificate of occupation — serving eight distinct staff roles across multiple councils.

Development of this system has been conducted using **Claude Code (Sonnet 4.6)** as the primary AI-assisted engineering tool. This requisition formally requests an **Anthropic Claude Enterprise account** to continue and complete the project, given the scale of the remaining work and the loss of the development virtual machine environment.

---

## 2. Project Status — What Has Been Built

### 2.1 Core Platform

| Layer | Technology | Status |
|---|---|---|
| Frontend | Vue 3 + Composition API + Pinia + MapLibre GL 4.7.1 + Vite | Deployed locally |
| Backend | Fastify 5.7.1 + Node.js 20 LTS | Deployed locally |
| Database | PostgreSQL 14+ / PostGIS 3.3+ | 80+ migrations written |
| Auth | JWT HS256 (12h access / 14d refresh) | Complete |
| Maps | MVT/PBF tile pipeline via ST_AsMVT (24 PostGIS layers) | Complete |

### 2.2 Completed Features

- **Welcome Layer** — 10-council Zimbabwe selector with province filter, animated branding, council-gated routing across the entire application.
- **Authentication** — Full registration, login, invite system (8 staff roles), role-based portal redirect, refresh-token session management.
- **Payment Gateways** — Paynow, EcoCash, OneMoney, and Stripe drivers with USSD display, webhook-driven confirmation, exchange rate resolution (RBZ rate → ZWG), and outbox-pattern email receipts.
- **Interactive Map** — 24 PostGIS spatial layers served as binary vector tiles (MVT/PBF) to MapLibre GL; zoom-aware low-resolution filtering; LRU tile cache (4,000 tiles, 128 MB, 24h TTL); single-feature GeoJSON popup.
- **Stands Layer** — Mutable stand polygons editable by planner/GIS officer; Register Stand and Edit Stand modals; status-coded fill colours; stand labels at zoom 14+; vector-tile cache invalidation on mutation.
- **Zones Layer** — Full CRUD for `vungu_proposed_peri_urban_zones` and `zone_land_use_controls`; EO Planner zones right-rail tab; management columns (zone_type, scale_category, is_active).
- **Workflow Dashboard** — Real-time staff dashboard (`/workflow`) with application queue, status pipeline, and inspection panel. (Note: currently reads the wrong DB table — see Section 3.)
- **Application Tracking** — Citizen-facing 8-stage pipeline tracker with backend polling. (Same table bug — see Section 3.)
- **EO Planner Portal** — Most complete staff portal; all sections (intake, due diligence, technical circulation, public notification, objections, committee reports, permit drafting, enforcement) are fully wired to the backend.
- **Building Inspector Portal** — Fully wired; 9-stage DM Handbook inspection API, checklist recording, photo upload, scoring breakdown, occupation certificate issuance.
- **Planning Clerk Portal** — Dashboard, development register, application receipt, dispatch queue, refusal queue, enforcement view all wired. (Three sections still have UI stubs only.)
- **Admin Panel** — User list, invite, suspend/activate, role edit, password reset, invite revocation — all wired to backend.
- **HTTP Caching Middleware** — LRU server-side cache with tiered Cache-Control headers (tiles 24h, API 5min–1h).
- **Document & KYC System** — Citizen upload, planning clerk verification queue, KYC submission and approval; SHA-256 deduplication; per-user 100 MB quota.
- **Notification System** — Outbox-pattern email queue decoupled from API response time; 11 notification templates; in-app unread badge via polling.
- **Security Hardening** — bcrypt-12, rate limiting (global 100/min, auth 10/min), helmet headers, audit log (every authenticated mutation written to `security_audit_log`), SQL parameterised queries throughout.
- **Database Normalisation** — 3NF migrations (078–080) adding ref tables, `v_stands` view, `user_profiles` table, `stands_tile_view`, `zone_type_cache` copy column with trigger.
- **Production Deployment Guide** — docs/deployment/DEPLOYMENT.md covering NGINX, SSL, PM2, environment variables, migration order (80+ migrations), spatial data import via ogr2ogr.

---

## 3. What Remains — Prioritised Outstanding Work

### P0 — Blocking (No End-to-End Data Flow Without These)

These are the most critical items preventing any real permit from flowing through the system:

1. **Data-Split Bug (root cause)** — The citizen submission flow writes to `permit_applications`; the Workflow Dashboard, Application Tracking view, and status-advance button all read from and write to `development_applications` (a separate, stale legacy table). Staff see nothing when a citizen submits. The citizen's own tracker always 404s. Six specific file/line changes are required across two views and one router file.

2. **Planner Role Redirect** — The `planner` role currently lands on the spatial map view (`/planner`) instead of the workflow workspace (`/planner-workspace`). A one-line router fix is required but must be tested carefully to avoid breaking other role redirects.

3. **PostgreSQL Must Be Running** — Without a live database, all authenticated endpoints return `500 Internal Server Error`. Registration, login, permit submission, tile generation — everything fails. This is now critically affected by the loss of the development VM (see Section 5).

### P1 — Backend Wiring for Remaining Staff Roles

4. **Environmental Health Officer (EHO) Backend Link** — The EHO portal currently runs entirely on local mock state (no backend calls). When a planner circulates a permit to `department = environmental_health`, the EHO portal must query `GET /api/applications/:id/consultations?department=environmental_health` and call `PATCH /api/consultations/:id/response` to record clearance. Until this is wired, EHO decisions are not recorded and cannot gate permit advancement.

5. **Surveyor Portal Backend Link** — The surveyor portal also runs on local mock state. It must be connected to the `consultations` table, filtering permits at `survey_review` status where `department = survey`. Cadastral sections (beacons, encroachments, setting-out) require schema decisions — either wire to backend tables or formally document as Phase 3.

6. **Citizen Appeals Persistence** — The "File appeal" button saves appeals to `localStorage` only; they are lost on page refresh and invisible on other devices. This must be wired to `POST /api/permit-applications/:id/objections`.

7. **Planning Clerk Gaps** — Three Planning Clerk sections have UI without backend wiring: (a) "Mark as dispatched" button needs `PATCH /api/permit-applications/:id/status`; (b) public notice form needs a `POST` endpoint; (c) payment link field requires autocomplete from the loaded permit list rather than manual UUID entry.

8. **Document File Upload (Citizen Wizard Step 4)** — Document upload in the 5-step application wizard is currently stub-only (marks files as staged but uploads no bytes). Actual multipart upload to `POST /api/documents` must be completed.

9. **Certificate Download** — The occupation certificate view shows data but has no download endpoint. A `GET /api/applications/:id/certificate/pdf` endpoint (or equivalent) must be built.

### P2 — Quality, Security, and Observability

10. **Re-lock `/admin/land-use`** — The `requiresAdmin: true` guard is commented out; any authenticated user can reach the land-use management page.
11. **Security Dashboard** — `SecurityAuditService` is disabled on the backend; the admin security dashboard returns a placeholder. Needs to be re-enabled.
12. **QGIS Plugin Sync** — The QGIS plugin sync endpoint returns a placeholder because the service is disabled. Needs completion for GIS officer workflow.
13. **GIS Officer KPI Backend** — The GIS Officer dashboard currently uses `useGisCase` local state composable. Decide whether to wire to backend tables or document as Phase 3.
14. **Offline Fallback Consistency** — Only the Planner and Inspector portals show clearly-labelled demo data when the API is unreachable. All other portals silently fail. A consistent offline demo pattern is needed.
15. **Fee Auto-Reconcile** — When a payment is confirmed (`status = paid`), `permit_applications.fee_paid` should be set automatically via the webhook handler rather than requiring manual clerk input.

### P3 — Deployment and Go-Live

16. Run and verify migrations 077–080 against a clean PostgreSQL instance.
17. Configure production environment variables (JWT_SECRET, payment keys, SMTP, CORS origins).
18. Import `zimbabwe.gpkg` 24 spatial layers via ogr2ogr; verify SRID 900914 → EPSG:3857 transform in tile pipeline.
19. Configure NGINX reverse proxy, SSL certificates, PM2 process manager.
20. End-to-end integration test of the full citizen → planner → EO → building inspector → certificate lifecycle with a live database.

---

## 4. Why a Claude Enterprise Account Is Required

### 4.1 Codebase Scale

SpartialIQ is a large, tightly interlocked codebase:
- **Frontend:** 30+ Vue views, 10+ Pinia stores, 20+ composables, 3 map integration modules, 4 payment drivers.
- **Backend:** 80+ migration SQL files, 25+ route files, 6 middleware modules, 4 payment driver implementations, tile generation pipeline, email outbox worker.
- **Documented depth:** A 12-section system integration report (covering MVT pipeline, auth flow, payment state machine, notification outbox, file storage, security architecture) and a full user-flow testing audit across 8 staff roles have been generated for this project.

This means that productive engineering sessions require holding large amounts of context simultaneously — route files, view components, database schema, and migration state — to correctly cross-reference where a bug spans multiple layers (as the P0 data-split bug does: it involves two Vue views, a router file, and two backend table families).

### 4.2 Development Velocity

The remaining work listed in Section 3 involves:
- Surgical fixes requiring precise understanding of six interconnected files (P0 bug).
- Backend wiring across three unstubbed portals (EHO, Surveyor, Planning Clerk gaps).
- Security and compliance fixes that must not introduce regressions.
- A full production deployment sequence with 80+ ordered migrations.

This work benefits directly and substantially from AI-assisted development. Claude Code has already produced the integration report, testing audit, and the completed features listed in Section 2. Continuing with the same tool is the most efficient path to completion.

### 4.3 Access Continuity and Reliability

A Claude Enterprise account provides:
- Higher usage limits to sustain long uninterrupted engineering sessions without hitting rate limits mid-task.
- Priority access during peak hours, which is critical when working against a deadline.
- Larger context windows for sessions that require simultaneous awareness of multiple large files (e.g., fixing the P0 data-split bug requires holding `WorkflowDashboardView.vue` (500+ lines), `ApplicationTrackingView.vue` (300+ lines), `router/index.ts`, the backend routes catalogue, and the DB schema simultaneously).
- Team/organisation seat management for future collaboration if additional developers join the project.

---

## 5. Loss of Development Virtual Machine

The virtual machine previously used for development is **no longer accessible**. This VM hosted:
- The running **PostgreSQL 14 / PostGIS 3.3 database instance** (`vungu_master_db_v1`).
- The applied **migration state** (migrations 000–076 confirmed applied; status of 077–080 unknown).
- The uploaded **spatial data** (24 layers from `zimbabwe.gpkg`, imported via ogr2ogr).
- The `uploads/` directory containing any documents, inspection photos, and plan review files uploaded during testing.

The immediate consequences are:
1. **All database-backed endpoints return HTTP 500.** No user can register, log in, submit an application, or generate a map tile.
2. **Migration state is unknown.** It is not confirmed how many of the 80+ migrations were applied before VM access was lost. A fresh PostgreSQL instance must be stood up and all migrations re-applied in sequence.
3. **Spatial data must be re-imported.** The `zimbabwe.gpkg` file (kept at `data/spatial/zimbabwe.gpkg`) must be re-imported via ogr2ogr after the database is restored.
4. **Test data is lost.** Any permit applications, payments, or user accounts created during prior testing sessions are no longer accessible.

This situation increases the urgency of a stable, persistent development environment and reliable AI-assisted tooling to rebuild and re-verify the system state efficiently.

---

## 6. Summary and Request

| Item | Detail |
|---|---|
| **Project** | SpartialIQ — Zimbabwe multi-council digital planning portal |
| **Stack** | Vue 3 / Fastify / PostgreSQL+PostGIS / MapLibre GL |
| **Completion estimate** | ~60% complete; P0–P2 work represents approximately 3–5 weeks of focused development |
| **Primary blocker** | VM lost → no running database; P0 data-split bug prevents end-to-end flow |
| **Tooling used** | Claude Code (Sonnet 4.6) for all AI-assisted engineering |
| **Account requested** | Anthropic Claude Enterprise |
| **Justification** | Codebase scale, context requirements, development velocity, and continuity of an AI-assisted workflow already embedded in the project |

We respectfully request that an Anthropic Claude Enterprise account be provisioned to support the completion and production deployment of SpartialIQ.

---

*SpartialIQ Engineering*
*munyanamaz@gmail.com*
*15 June 2026*
