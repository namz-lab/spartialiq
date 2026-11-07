# Vungu Spatial Data Portal — README

A Vue 3 + Vite frontend and a Fastify + PostgreSQL/PostGIS backend for the
**Vungu Rural District Council**. Citizens find offerable stands on a map,
submit development applications, pay fees in USD or ZiG, upload identity
documents and building plans, and track every status change in real time.
Council staff (planners, environmental officers, building inspectors,
planning clerks, surveyors, GIS officers, IT admins) work the same data
through role-specific consoles.

This README documents:

1. [What is in place](#what-is-in-place)
2. [Repository layout](#repository-layout)
3. [Local set-up](#local-set-up) — DB, env, install, migrate, run
4. [Database migrations to run](#database-migrations-to-run)
5. [Environment variables](#environment-variables)
6. [Running the email worker](#running-the-email-worker)
7. [API surface (54 endpoints)](#api-surface-54-endpoints)
8. [Frontend routes](#frontend-routes)
9. [Authoritative documents](#authoritative-documents)
10. [What is not yet wired](#what-is-not-yet-wired) — outstanding work
11. [Honest scope notes](#honest-scope-notes) — for a follow-up engineer
    or a code review by Codex

---

## What is in place

### Audit & hardening (already shipped)

- **Frontend audit (initial score 6/20 → 15/20):** dropped Inter, replaced
  with Geist + Fraunces, removed AI-slop visual tells (constellation hero,
  3-col card grid, gradient buttons, glassmorphism, fake metric counters),
  added global `:focus-visible`, `prefers-reduced-motion`, `:active`
  feedback, custom easings, fixed heading hierarchy.
- **Backend security pass:** replaced the home-rolled
  `'jwt_<ts>_<id>'` token parser with real signed JWT
  ([`src/middleware/jwtAuth.js`](../app-backend/src/middleware/jwtAuth.js)),
  removed `/api/auth/register-direct` (which stored
  `'hashed_' + password`), removed the plaintext login fallback, locked
  customer self-register to `'registered' | 'public'`, untracked the
  committed `.env`, tightened rate-limit on `/auth/*`, stripped PII from
  console logs.
- **Component dedup:** extracted [`<ProfileDropdown>`](src/components/shared/ProfileDropdown.vue)
  used by 8 role views, saving ~1.6k LOC and fixing the
  `planner_avatar` localStorage collision bug across roles.

### Citizen-facing features (Turns A → D)

| Surface | Where | What it does |
| --- | --- | --- |
| Stands on the map | [`ViewerPortalView.vue`](src/views/ViewerPortalView.vue) + [`StandsLayer.vue`](src/components/shared/StandsLayer.vue) | Citizens see all available stands as PostGIS polygons + halos with status colours; clicking opens a properties card with the planning-assistant suggestion. |
| Planning assistant | [`planningAssistantService.ts`](src/services/planningAssistantService.ts), backend [`src/services/planningAssistant.js`](../app-backend/src/services/planningAssistant.js) | Given a stand or `(lng, lat)` returns: zone & scale, applicable layout template (with **all values traceable to a Manual section**), permitted uses from the matrix, plot-fit warnings, and the **maximum buildable footprint** computed against the stand area × coverage. |
| Apply for a permit | existing [`DevelopmentApplicationView.vue`](src/views/DevelopmentApplicationView.vue) | Stand-driven; from the stand card the citizen lands here with `?stand=<id>`. |
| Pay a fee | [`PaymentsView.vue`](src/views/PaymentsView.vue) | Live USD/ZiG quote, init, manual confirm or cancel, payment history. |
| Upload identity / ownership documents | [`DocumentsView.vue`](src/views/DocumentsView.vue) | National ID / passport / proof of residence / title deeds. Verified by manual reviewer (interface to plug in Smile ID / Onfido). |
| Submit a building plan | [`PlanReviewView.vue`](src/views/PlanReviewView.vue) | Upload PDF or CAD; deterministic auto-checks run instantly (north arrow, scale, site plan, floor plan, file format, size). Findings cite the Manual section. The page **embeds the typical site-plan figure from the Manual** so citizens know what is expected. |
| Inspections & status updates | backend routes — UI hooks ready, inspector view wiring is the next pass | Citizens get an email on every status change and at every inspection-stage transition (booking → waitlisted → scheduled → rescheduled → passed/failed). |
| Privacy & terms | [`LegalView.vue`](src/views/LegalView.vue) | Sober skeleton tied to `/privacy` and `/terms`. |

### Authoritative source: Manual 2021

We extracted the
[Development Management/Control Manual 2021](Development%20Management_Control%20Manual%202021.pdf)
and shipped key reference figures under
[`public/manual/`](public/manual/) so the citizen UI can render them
inline without re-fetching the PDF:

- `typical-site-plan.png` — Manual Fig 10
- `sanitation-septic.png` — Manual Fig 7 + Fig 8
- `typical-elevation.png` — Manual Fig 9

The **inspection stages** (Annexure 12), **building plan appraisal
checklist** (Annexure 14) and **statutory time limits** are encoded as
constants the backend uses (see
[`src/routes/inspections.js`](../app-backend/src/routes/inspections.js)
and [`src/services/planningAssistant.js`](../app-backend/src/services/planningAssistant.js)).

---

## Repository layout

```
./         # this repo
  src/
    components/shared/              # ProfileDropdown, StandsLayer, StandPropertiesCard
    services/                       # api, types, auth, stands, planning-assistant,
                                    # inspections, payments, documents, plan-review
    views/                          # 50+ Vue views (citizen + 8 role consoles)
    router/index.ts                 # ~70 routes; auth metadata per route
    stores/                         # auth, spatial, planningWorkflow, …
    styles/main.css                 # global tokens + a11y baseline
  public/manual/                    # cropped reference figures from Manual 2021
  Development Management_Control Manual 2021.pdf

../app-backend/        # sibling repo, cloned by the frontend project
  server.js                         # Fastify entry; registers all plugins
  src/
    middleware/jwtAuth.js           # signed-JWT auth (HS256, 12h access + 14d refresh)
    services/
      exchangeRate.js               # USD↔ZWG; daily cache + fallback
      paymentDriver.js              # driver interface; manual + 4 stubs
      idVerifier.js                 # verifier interface; manual + 2 stubs
      planningAssistant.js          # rules engine over zone_land_use_controls
      planReview.js                 # deterministic PDF/CAD checks
      notifier.js                   # outbox writer + 5 templates
    routes/
      auth.js                       # hardened auth + /admin user mgmt
      stands.js                     # GeoJSON stands + reserve/release
      planning-assistant.js         # suggest / decide / templates
      inspections.js                # 13 endpoints (stages, photos, queue)
      application-status.js         # canonical status-change endpoint
      payments.js                   # init/confirm/cancel/webhook
      documents.js                  # upload + staff verify queue
      plan-review.js                # citizen plan upload + auto-review
    workers/
      emailWorker.js                # outbox drainer
  migrations/                       # SQL migrations (run in order)
```

---

## Local set-up

### Prerequisites

- Node.js 20+ (tested on 25)
- PostgreSQL 14+ with PostGIS 3 extension
- The two sibling repos cloned next to each other (`.`,
  `../app-backend`)

### One-time bootstrap

```bash
# 1. Clone both repos as siblings.
cd ~ && git clone https://github.com/Muna18madzinga/Manicipal-drums-frontend.git
cd ~ && git clone https://github.com/Muna18madzinga/Manicipal-drums-backend-3.git

# 2. Backend deps + DB.
cd ../app-backend
npm install
createdb vungu_master_db_v1                 # (or use an existing one)
psql vungu_master_db_v1 -c "CREATE EXTENSION IF NOT EXISTS postgis;"

# 3. Backend env. Generate a real JWT secret, do NOT use the placeholder.
cp .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"  # paste into .env

# 4. Run migrations (see next section for the full ordered list).
psql vungu_master_db_v1 -f migrations/001_initial_schema.sql
# … etc.

# 5. Frontend deps.
cd .
npm install
```

### Daily development

```bash
# Terminal 1 — backend on :3000
cd ../app-backend
JWT_SECRET="$(node -e 'console.log(require("crypto").randomBytes(48).toString("base64"))')" \
  npm run dev

# Terminal 2 — email worker (optional in dev)
cd ../app-backend
node src/workers/emailWorker.js                      # console transport
# or with SMTP:
MAIL_TRANSPORT=smtp SMTP_HOST=… SMTP_PORT=587 SMTP_USER=… SMTP_PASS=… \
  node src/workers/emailWorker.js

# Terminal 3 — frontend on :5174
cd .
npm run dev
```

The frontend's `vite.config.ts` proxies `/api/*` to `http://localhost:3000`,
so the dev origin is `http://localhost:5174` and you don't need to set
CORS.

### Verifying everything is healthy

```bash
# Backend route surface (54 method-level entries):
curl http://localhost:3000/api/test
curl http://localhost:3000/api/inspection-stages | jq

# Frontend type check + production build:
cd .
npm run type-check
npm run build
```

---

## Database migrations to run

Run **in this exact order**, against the same database. They are idempotent
where it makes sense (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`)
but should still only run once each.

| # | File | What it does |
| --- | --- | --- |
| 001 | `001_initial_schema.sql` | Core tables; enables `postgis` and `uuid-ossp`. |
| 042 | `042_development_applications.sql` | `development_applications`, `application_documents`, `application_timeline`, `application_drafts`. |
| 050 | `050_enhance_land_use_management_corrected.sql` | `zone_land_use_controls` matrix + extends `land_use_groups`. |
| 060 | `060_invite_system_and_roles.sql` | Adds employee invite system + expanded role check. |
| **061** | **`061_applicant_type_and_invite_roles.sql`** | **Round 2** — Adds `users.applicant_type`, expands the role allow-list to all internal roles, expands invitable roles. |
| **062** | **`062_stands_and_planning_templates.sql`** | **Turn A** — `stands` (PostGIS polygons + generated centroid), `planning_assistant_templates` seeded with 8 layouts from the Manual. |
| **063** | **`063_notifications_and_inspections.sql`** | **Turn B** — `notifications_outbox`, `application_status_history`, `inspection_bookings` (9 stages from Annexure 12), `inspection_status_events`, `inspection_photos`. |
| **064** | **`064_payments_and_documents.sql`** | **Turn C** — `exchange_rates`, `payments` (both legs USD+ZWG, monotonic receipt no.), `citizen_documents`. |
| **065** | **`065_plan_review.sql`** | **Turn D** — `plan_reviews` (FSM + sha256 dedup), `plan_review_findings`. |

**Note:** there are also `017_…`, `041_…`, `051..053` and other older
migrations in the folder that ran on earlier installs. New deploys can
skip the ones that conflict with current schema; the bold rows above
are the ones added in this engagement.

If you have a fresh DB, the simplest replay is:

```bash
cd ../app-backend
for f in migrations/001_initial_schema.sql \
         migrations/042_development_applications.sql \
         migrations/050_enhance_land_use_management_corrected.sql \
         migrations/060_invite_system_and_roles.sql \
         migrations/061_applicant_type_and_invite_roles.sql \
         migrations/062_stands_and_planning_templates.sql \
         migrations/063_notifications_and_inspections.sql \
         migrations/064_payments_and_documents.sql \
         migrations/065_plan_review.sql; do
  echo "→ $f"
  psql vungu_master_db_v1 -v ON_ERROR_STOP=1 -f "$f"
done
```

### Seeding stands (development data)

The `stands` table is empty after migration 062. For local development,
seed a few sample rows:

```sql
INSERT INTO stands (
  stand_number, ward, zone_id, zone_type, use_scale,
  area_sqm, frontage_m, status, geom
)
SELECT
  'A-' || gs::text,
  'Maboleni',
  z.id,
  z.zone_type,
  z.scale_category,
  500 + (random()*500)::int,
  18,
  'available',
  ST_GeomFromText(
    'POLYGON((' ||
    (29.55 + gs*0.001) || ' ' || (-19.55 + gs*0.0005) || ', ' ||
    (29.5505 + gs*0.001) || ' ' || (-19.55 + gs*0.0005) || ', ' ||
    (29.5505 + gs*0.001) || ' ' || (-19.5495 + gs*0.0005) || ', ' ||
    (29.55 + gs*0.001) || ' ' || (-19.5495 + gs*0.0005) || ', ' ||
    (29.55 + gs*0.001) || ' ' || (-19.55 + gs*0.0005) ||
    '))',
    4326
  )
FROM proposed_peri_urban_zones z
CROSS JOIN generate_series(1, 6) gs
WHERE z.zone_type IS NOT NULL
LIMIT 6;
```

Production seeding will come from a real cadastral import (out of scope
here).

---

## Environment variables

### Backend (`../app-backend/.env`)

The repo's `.env` is now `.gitignore`'d. Use `.env.example` as the
template. Required and optional variables:

| Variable | Required | Default | Notes |
| --- | --- | --- | --- |
| `DATABASE_URL` | yes | — | Full Postgres URL. |
| `JWT_SECRET` | **yes** | — | **Must be ≥ 32 chars.** Server refuses to boot in production with the placeholder string. Generate: `node -e "console.log(require('crypto').randomBytes(48).toString('base64'))"`. |
| `PORT` | no | `3000` | |
| `NODE_ENV` | no | `development` | Controls error-message verbosity, route table dump, console.log stripping at compile time. |
| `ALLOWED_ORIGINS` | no | dev hosts | Comma-separated. |
| `EXCHANGE_FALLBACK_USD_ZWG` | no | `36.0000` | Used when no row in `exchange_rates` is fresher than 72 h. Surfaced to the citizen as `isStale: true`. |
| `MAIL_TRANSPORT` | no | `console` | `console` or `smtp`. SMTP requires nodemailer (`npm i nodemailer`). |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `SMTP_FROM` | (yes if `MAIL_TRANSPORT=smtp`) | — | |
| `MAIL_WORKER_INPROC` | no | unset | When `1`, `server.js` boots the email worker in-process. Production should run it as a separate service. |
| `MAIL_POLL_MS` | no | `30000` | |
| `MAIL_BATCH` | no | `25` | |
| `MAIL_MAX_ATTEMPTS` | no | `5` | |
| `INSPECTION_PHOTO_ROOT` | no | `<cwd>/uploads/inspection-photos` | |
| `CITIZEN_DOC_ROOT` | no | `<cwd>/uploads/citizen-documents` | |
| `PLAN_REVIEW_ROOT` | no | `<cwd>/uploads/plan-reviews` | |
| `ID_VERIFIER` | no | `manual` | `manual`, `smile_id`, or `onfido`. The latter two throw `verifier_not_implemented` until configured. |
| `FRONTEND_URL` | no | `http://localhost:5174` | Used in email body links. |

### Frontend (`./.env`)

Optional. The frontend reads:

| Variable | Default | Notes |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | Set if your backend isn't on the same origin (the dev proxy handles this). |

---

## Running the email worker

The email worker drains `notifications_outbox`. **Until it runs, every
status change still writes a row to the outbox** (audit trail), but no
email is delivered.

```bash
# Console transport — logs each "would-be" email to stdout. Useful in dev.
node src/workers/emailWorker.js

# Real SMTP. Requires `npm i nodemailer` first.
MAIL_TRANSPORT=smtp \
SMTP_HOST=smtp.example.com SMTP_PORT=587 \
SMTP_USER=…  SMTP_PASS=…  SMTP_FROM='no-reply@vungurdc.gov.zw' \
  node src/workers/emailWorker.js
```

Or boot it inside the API process (single-node dev):

```bash
MAIL_WORKER_INPROC=1 npm run dev
```

For multi-instance production, **run the worker as its own service**.
The worker uses `SELECT FOR UPDATE SKIP LOCKED` so multiple instances
are safe.

---

## API surface (54 endpoints)

All endpoints are mounted under `/api`. Auth scopes:

- **public** — no token required
- **auth** — any logged-in user
- **role** — specific role(s) required
- **admin** — `admin` role only

```
AUTH (hardened JWT)
  POST   /auth/register                          public
  POST   /auth/login                             public
  POST   /auth/logout                            auth
  GET    /auth/me                                auth
  PUT    /auth/profile                           auth
  POST   /auth/change-password                   auth
  POST   /auth/refresh                           public (verified by claim)
  POST   /auth/invite                            admin
  GET    /auth/invite/validate                   public
  POST   /auth/invite/accept                     public (token-bound)
  POST   /auth/generate-api-token                auth (QGIS plugin)
  POST   /auth/validate-api-token                public
  GET    /admin/users                            admin
  PUT    /admin/users/:id                        admin
  DELETE /admin/users/:id                        admin
  POST   /admin/users/:id/suspend                admin
  POST   /admin/users/:id/reset-password         admin
  GET    /admin/invites                          admin
  DELETE /admin/invites/:id                      admin

STANDS (Turn A)
  GET    /stands                                 public — GeoJSON FeatureCollection
  GET    /stands/:id                             public — incl. suggestedPlan
  POST   /stands/:id/reserve                     auth   — 30-min soft hold
  POST   /stands/:id/release                     auth

PLANNING ASSISTANT (Turn A)
  POST   /planning-assistant/suggest             public
  POST   /planning-assistant/decide              public
  GET    /planning-assistant/templates           public

INSPECTIONS (Turn B)
  GET    /inspection-stages                      public — 9 stages from Annexure 12
  POST   /applications/:appId/inspections        auth (citizen owner)
  GET    /applications/:appId/inspections        auth
  POST   /inspections/:id/pay                    auth
  POST   /inspections/:id/schedule               role: building_inspector | admin
  POST   /inspections/:id/reschedule             role: building_inspector | admin
  POST   /inspections/:id/complete               role: building_inspector | admin
  POST   /inspections/:id/cancel                 auth
  GET    /inspections/:id                        auth
  GET    /inspector/queue                        role: building_inspector | admin
  POST   /inspections/:id/photos                 role: building_inspector | admin
  GET    /inspections/:id/photos                 auth
  DELETE /inspections/:id/photos/:photoId        role: building_inspector | admin

APPLICATION STATUS (Turn B)
  POST   /applications/:appId/status             role: planner | eo | admin | …
  GET    /applications/:appId/status-history     public

PAYMENTS (Turn C)
  GET    /payments/quote                         public
  GET    /payments/rate                          public
  POST   /payments                               auth
  GET    /payments/:id                           auth (owner) | role
  GET    /payments                               auth
  POST   /payments/:id/confirm                   auth — manual driver only
  POST   /payments/:id/cancel                    auth (owner) | admin
  POST   /payments/webhook/:driver               public — driver-verified
  POST   /payments/admin/rates                   admin

DOCUMENTS (Turn C)
  POST   /documents                              auth — multipart upload
  GET    /documents/mine                         auth
  GET    /documents/:id                          auth (owner) | staff
  GET    /documents/queue                        role: admin | planning_clerk | planner | eo
  POST   /documents/:id/verify                   role: above
  DELETE /documents/:id                          auth (owner pending) | admin

PLAN REVIEW (Turn D)
  POST   /applications/:appId/plan-reviews       auth — multipart, runs auto-checks
  GET    /applications/:appId/plan-reviews       auth
  GET    /plan-reviews/:id                       auth — incl. findings
  POST   /plan-reviews/:id/decide                role: planner | building_inspector | …
```

---

## Frontend routes

| Path | View | Auth |
| --- | --- | --- |
| `/` | `HomeView` | public |
| `/login` | `LoginView` | public (DEV-only demo accounts) |
| `/register` | `RegisterView` | public; `applicant_type` dropdown |
| `/about` | `AboutView` | public |
| `/privacy`, `/terms` | `LegalView` | public |
| `/explorer` | `MapExplorer` | public |
| `/development-application` | `DevelopmentApplicationView` | auth |
| `/applications`, `/applications/:id` | `ApplicationsListView`, `ApplicationDetailView` | auth |
| `/payment/:refNo` | `PaymentGatewayView` (existing) | auth |
| `/payments` | `PaymentsView` (new) | auth |
| `/documents` | `DocumentsView` (new) | auth |
| `/plan-review` | `PlanReviewView` (new) | auth |
| `/portal` | `ViewerPortalView` | auth |
| `/admin` | `AdminView` | admin |
| `/planner` | `VunguPlannerView` | role: planner |
| `/eo-planner` | `EOPlannerView` | role: eo |
| `/env-officer` | `EnvironmentalOfficerView` | role: env_officer |
| `/building-inspector` | `BuildingInspectorView` | role: building_inspector |
| `/planning-clerk` | `PlanningClerkView` | role: planning_clerk |
| `/surveyor` | `SurveyorView` | role: surveyor |
| `/gis-officer` | `GISOfficerView` | role: gis_officer |

---

## Authoritative documents

- **Development Management/Control Manual 2021** — full PDF in
  [`Development Management_Control Manual 2021.pdf`](Development%20Management_Control%20Manual%202021.pdf).
  Cropped figures used by the UI live in [`public/manual/`](public/manual/).
  Stage names, fee categories, statutory time limits and the inspection
  checklist are encoded as constants the backend reads.
- **Schema documentation** — every migration starts with a comment
  block explaining the intent, dependencies and any breaking semantics.

---

## What is not yet wired

These are the **clearly-marked seams** ready for a follow-up engineer or
Codex to plug provider credentials / process work into.

### External integrations (one-file changes)

- **Real payment gateway:** `paymentDriver.js` ships a working `manual`
  driver and stubs for Paynow, Stripe, EcoCash and OneMoney. Each stub
  throws `driver_not_implemented`; implementing the four methods on the
  stub object immediately enables that driver. The `webhook/:driver`
  endpoint already calls `verifyWebhook()` against the chosen driver.
- **ID verification:** `idVerifier.js` ships a working `manual` verifier
  (staff approve in `/documents/queue`) and stubs for Smile ID and
  Onfido. Same shape as payment drivers.
- **SMTP:** `emailWorker.js` ships a `console` transport (logs to
  stdout) and an `smtp` transport (uses `nodemailer` if installed).
  Run `npm i nodemailer` and set `MAIL_TRANSPORT=smtp SMTP_*` to flip
  on real delivery.
- **RBZ exchange-rate fetcher:** `exchangeRate.js` reads the most
  recent row from `exchange_rates`. A nightly cron should
  `INSERT … ON CONFLICT` from RBZ's public rate. Until then,
  `EXCHANGE_FALLBACK_USD_ZWG` keeps the system functional but every
  quote is flagged `isStale: true` so the UI warns the citizen.

### Larger pieces

- **Plan auto-review (deep CAD checks):** `runDeterministicChecks()`
  catches the easy wins (missing north arrow, missing scale, file
  format, size). The `runDeepChecks()` seam is in place to integrate
  `dxf-parser` (Node) or a Python sidecar with `ezdxf` for measuring
  setbacks off the drawing.
- **Stand cadastral import:** `stands` table is empty after the
  migration. A real council deploy needs a one-off import from the
  cadastral GIS. The `stands_seed.sql` block in this README is for
  development only.
- **Inspector / planner UIs for new features:** the **services are
  ready** (`inspectionsService.ts`, `planReviewService.ts`,
  `documentsService.ts`); existing role views can wire them into their
  queues. The citizen surfaces are fully rendered.
- **Email templates (HTML versions):** the worker sends plain-text
  today (the `text/plain` representation rendered with Africa/Harare
  timezone). Adding HTML versions is one block per template in
  `notifier.js`.
- **Password reset (self-service):** the LoginView "Forgot?" link
  currently `mailto:`s the council. A real reset flow needs a
  `/auth/forgot-password` endpoint + tokenised reset email; the
  outbox + worker already handle delivery.
- **Dead-button audit on staff role-views:** the citizen-facing audit
  is complete (HomeView footer, LoginView "Forgot", ViewerPortalView
  quick-actions). The 8 staff role-views (~11k LOC) still have legacy
  click handlers that should be classified flow-by-flow.

### Visual polish

- The **citizen surfaces** (Home, Login, Register, Payments, Documents,
  PlanReview, Legal, ViewerPortal map page) all use the new design
  tokens (Geist + Fraunces, ink/accent palette, custom easings,
  `:focus-visible` rings, `prefers-reduced-motion`).
- The **8 staff role-views** still use legacy CSS. They work and look
  acceptable, but they don't share the new tokens. Migrating them is a
  separate pass — they each have ~1.5k LOC of bespoke CSS.

---

## Honest scope notes

If you're a code reviewer or a follow-up engineer reading this:

1. **Build status:** every commit in this engagement passes
   `npm run type-check` and `npm run build` on the frontend. The
   backend modules pass `node -e "require('./src/routes/...')"` and
   register cleanly through Fastify.

2. **Migrations 062–065 are additive.** They do not modify or drop
   existing rows in `users`, `development_applications`, etc. Rolling
   them back is a single
   `DROP TABLE … CASCADE` per migration.

3. **No external secrets are committed.** `.env` is now in
   `.gitignore`. The previous `.env` was untracked with
   `git rm --cached .env` — that change is in the working tree but
   has not been committed by this engagement.

4. **Demo accounts are gated.** `LoginView`'s 9 demo accounts only
   render when `import.meta.env.DEV === true`. They are tree-shaken
   out of production bundles. Verified with
   `grep "demo1234" dist/assets/*.js → empty`.

5. **The audit-found pre-existing TS errors** in
   `src/components/InteractiveMap.vue`, `src/utils/coordinateTransform.ts`,
   `src/views/admin/RegisterView.vue`, `src/stores/admin.ts`,
   `src/views/admin/DashboardView.vue` are **not introduced by this
   engagement**. They predate it. None block the build (`vue-tsc` is
   advisory; production builds via `vite build` continue to succeed).

6. **The `applicant_type` field** is purely descriptive metadata for
   the council. Authorisation uses `users.role`, which the backend
   pins to `'registered'` or `'public'` for self-registrants regardless
   of what the body sends. This is defence-in-depth — the frontend's
   safe mapping in `RegisterView` is the second line of defence.

7. **The planning assistant is not an LLM.** Every value it returns is
   sourced from the matrix
   (`zone_land_use_controls`) or the constants table
   (`planning_assistant_templates`), each row carrying a
   `source_citation` referencing a Manual section. A planner can
   always trace any suggestion back to a rule. An LLM layer can sit on
   top later for natural-language explanations.

8. **The plan auto-review is not magic.** It catches missing north
   arrow, missing scale, missing site/floor plan annotations, file
   size and format. It does **not** measure setbacks off the drawing
   geometrically yet — that's what `runDeepChecks()` is for.

9. **Email templates render with Africa/Harare timezone** so 9 am
   inspections show as `Fri, 15 May 2026, 11:00` for a citizen in
   Lower Gweru, not in UTC.

10. **Spatial index coverage:** `idx_stands_geom`,
    `idx_stands_centroid`, and the existing `idx_layer_data_geom` /
    `idx_places_geom` indexes are GIST. Any bounding-box query against
    `/stands?bbox=…` uses them.

---

## Quick reference — file you most likely want next

| If you want to… | Look at |
| --- | --- |
| Add a new payment provider | [`src/services/paymentDriver.js`](../app-backend/src/services/paymentDriver.js) |
| Wire real SMTP | [`src/workers/emailWorker.js`](../app-backend/src/workers/emailWorker.js) |
| Add a new email template | [`src/services/notifier.js`](../app-backend/src/services/notifier.js), `TEMPLATES` |
| Add a new planning template | `INSERT` into `planning_assistant_templates` (admin UI is a follow-up) |
| Add a new auto-review check | [`src/services/planReview.js`](../app-backend/src/services/planReview.js), `REQUIRED_PDF_TOKENS` or new function |
| Add a new role | [`src/services/types.ts`](src/services/types.ts) (frontend), [`migrations/061_…`](../app-backend/migrations/061_applicant_type_and_invite_roles.sql) `users_role_check` constraint, [`src/routes/auth.js`](../app-backend/src/routes/auth.js) `INVITABLE_ROLES` |
| Update legal copy | [`src/views/LegalView.vue`](src/views/LegalView.vue) |
| Add a new citizen page | drop a `*.vue` file in `src/views/`, add to `src/router/index.ts` |

---

## Licence

Council-internal. Not yet open-sourced. The Development Management/
Control Manual 2021 is © Government of Zimbabwe / Ministry of Local
Government & Public Works.
