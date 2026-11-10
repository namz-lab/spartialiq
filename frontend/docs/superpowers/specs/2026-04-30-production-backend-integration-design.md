# Production Backend Integration Design

Date: 2026-04-30

## Goal

Make `C:\Users\theop\OneDrive\Desktop\new_backend-main` the single production backend for the Vungu frontend in `C:\Users\theop\OneDrive\Desktop\app-frontend`, replacing local/demo-only persistence for core workflows with real API-backed data.

## Current Context

The frontend is a Vue 3/Vite application with a shared Axios client in `src/services/api.ts`, but several views still call `fetch('/api/...')` directly or store workflow data in `localStorage`. The backend is a Fastify API with PostgreSQL/PostGIS migrations and route groups for auth, layers, spatial, OGC, planning submissions, portal/EO/BI/env/planner dashboards, payments, and admin statistics.

The largest mismatch is contract coverage. The frontend expects production endpoints that do not yet exist in `new_backend-main`, especially development-control, land-use admin, admin invites, surveyor operations, service catalogue, and some development-application helper routes.

## Architecture

`new_backend-main` becomes the only production API. The frontend uses `VITE_API_BASE_URL` through `src/services/api.ts`; all app-data services should go through the shared client so authentication, base URLs, timeouts, and response handling are consistent.

Backend work is organized as additive Fastify route domains plus SQL migrations. New domains should follow the existing backend style:

- `src/domains/<domain>/<domain>.routes.js`
- `src/domains/<domain>/<domain>.controller.js`
- `src/domains/<domain>/<domain>.service.js` when domain logic is non-trivial
- `src/db/migrations/NNN_<feature>.sql`

Frontend work is organized as service-layer alignment first, then view wiring. Views should consume service methods instead of duplicating URLs and response parsing.

## Backend Scope

### Development Control

Add a `/api/development-control` domain for the workflows currently used by `TPD1ApplicationView.vue`, `ParcelSelectorMap.vue`, `SpatialMapCore.vue`, and `src/services/developmentControl.ts`.

Required endpoints:

- `GET /api/development-control/local-authorities`
- `GET /api/development-control/groups`
- `GET /api/development-control/parcels/:parcelId/permitted-uses`
- `POST /api/development-control/compliance-check`
- `POST /api/development-control/applicants`
- `POST /api/development-control/owners`
- `POST /api/development-control/tpd1-applications`
- `GET /api/development-control/tpd1-applications`
- `GET /api/development-control/tpd1-applications/:id`
- `POST /api/development-control/tpd1-applications/:id/documents`
- `GET /api/development-control/live-updates`

Required data model:

- local planning authorities with fee metadata
- land-use groups usable by the public TPD1 form
- applicant and owner parties
- TPD1 applications with authority, applicant, owner, parcel, development details, payment receipt metadata, compliance result, status, and audit timestamps
- document metadata for uploaded application files

### Land Use Management

Add or complete `/api/land-use` endpoints for admin land-use screens.

Required endpoints:

- `GET /api/land-use/groups`
- `GET /api/land-use/groups/:id`
- `POST /api/land-use/groups`
- `PUT /api/land-use/groups/:id`
- `DELETE /api/land-use/groups/:id`
- `GET /api/land-use/zones`
- `GET /api/land-use/controls`
- `POST /api/land-use/controls`
- `PUT /api/land-use/controls/:id`
- `DELETE /api/land-use/controls/:id`
- `GET /api/land-use/zones/:zoneId/matrix`
- `GET /api/land-use/matrix`
- `POST /api/land-use/matrix`
- `PUT /api/land-use/matrix/:id`
- `DELETE /api/land-use/matrix/:id`

The backend already has planning-zone concepts. This work should reuse existing zone tables where possible and add missing group/control/matrix tables only where the current migrations do not provide them.

### Admin Users And Invites

Align admin endpoints with `AdminView.vue` and `InviteAcceptView.vue`.

Required endpoints:

- `GET /api/admin/users`
- `PUT /api/admin/users/:id`
- `DELETE /api/admin/users/:id`
- `POST /api/admin/users/:id/suspend`
- `GET /api/admin/invites`
- `POST /api/auth/invite`
- `GET /api/auth/invite/validate?token=...`
- `POST /api/auth/invite/accept`

The existing `employee_invitations` table from migration `006_vungu_roles_and_tables.sql` should be reused. Role validation must include all active frontend staff roles: `public`, `professional`, `planner`, `admin`, `eo`, `environmental_officer`, and `building_inspector`.

### Surveyor Workstation

Add `/api/surveyor` for `SurveyorView.vue`.

Required endpoints:

- `GET /api/surveyor/jobs`
- `PATCH /api/surveyor/jobs/:id`
- `GET /api/surveyor/coordinates`
- `POST /api/surveyor/coordinates`
- `GET /api/surveyor/beacons`
- `POST /api/surveyor/beacons`
- `GET /api/surveyor/layouts`
- `POST /api/surveyor/layouts`

Required data model:

- pegging jobs connected to planning applications or portal applications where available
- coordinate book entries
- beacon records
- layout records

### Service Catalogue And Citizen Applications

Make service catalogue data backend-backed while preserving the current public catalogue content.

Required endpoints:

- `GET /api/services`
- `GET /api/services/:id`

The existing `/api/portal/applications` endpoints remain the primary submission/tracking path for general citizen service applications. The frontend should use backend counts and application history instead of `localStorage` for submitted applications.

### Development Application Helpers

The backend already has `/api/development-applications`. Add compatibility helpers used by `src/services/developmentApplication.js` where they are still needed:

- `PATCH /api/development-applications/:id/status`
- `GET /api/development-applications/:id/timeline`
- `POST /api/development-applications/:id/comments`
- `POST /api/development-applications/:id/documents`
- `GET /api/development-applications/:id/documents`
- `DELETE /api/development-applications/:id/documents/:documentId`
- `POST /api/development-applications/calculate-fees`
- `GET /api/development-applications/stats`
- `GET /api/development-applications/search`
- `GET /api/development-applications/development-types`
- `GET /api/development-applications/zone-requirements`
- `POST /api/development-applications/drafts`
- `GET /api/development-applications/drafts`
- `DELETE /api/development-applications/drafts/:draftId`

Where an existing canonical route already exists, compatibility routes should delegate to it rather than duplicating logic.

## Frontend Scope

### API Client

Update `src/services/api.ts` so services can consistently unwrap backend envelopes:

- success response shape: `{ success: true, data: ... }`
- paginated response shape: `{ success: true, data: [...], pagination: ... }`
- error response shape: `{ success: false, error: { code, message } }`

The response interceptor should preserve Axios response objects for existing callers unless a new helper is introduced. Avoid a breaking global unwrapping change in one sweep.

### Service Modules

Add or update focused frontend service modules:

- `src/services/developmentControl.ts`
- `src/services/landUseService.ts`
- `src/services/serviceCatalogue.ts`
- `src/services/surveyor.ts`
- `src/services/adminService.ts`
- `src/services/developmentApplication.js`

Each service should own URL construction, response unwrapping, and payload mapping.

### Views

Update the following views to use real services:

- `src/views/TPD1ApplicationView.vue`
- `src/views/OnlineApplicationsView.vue`
- `src/views/OnlineApplicationFormView.vue`
- `src/views/SurveyorView.vue`
- `src/views/AdminView.vue`
- `src/views/InviteAcceptView.vue`

Keep localStorage only for temporary unsent drafts. Submitted applications, counts, statuses, and staff work queues must come from the backend.

## Error Handling

Frontend views should show clear loading, empty, and failed states for each backend-backed workflow. Backend routes should use the existing `sendSuccess`, `sendPaginated`, and `AppError` helpers so errors keep the current production envelope.

## Security And Production Readiness

All staff/admin endpoints require JWT authentication and role authorization. Public catalogue endpoints may be unauthenticated. Citizen application and payment history endpoints require authentication and must scope records to `request.user.id`.

Database migrations must be idempotent and safe to run on startup, matching the existing migration runner behavior.

## Testing And Verification

Backend verification:

- migration runner succeeds
- route smoke tests cover happy-path and auth failure for each new domain
- database queries use parameterized SQL
- role-protected routes reject unauthorized roles

Frontend verification:

- `npm run type-check`
- `npm run build`
- service-level tests for payload mapping and response unwrapping where practical
- manual smoke test through login, service catalogue, application submission, TPD1 submission, admin invite, surveyor queue

## Out Of Scope

This integration will not redesign the UI, replace the payment gateway with a real third-party provider, or fully implement QGIS plugin administration unless required by build/runtime failures. QGIS plugin routes can be handled in a later dedicated integration pass.

## Approval

The user approved making `new_backend-main` the production backend and adding missing backend tables/routes while wiring the frontend to real API data.
