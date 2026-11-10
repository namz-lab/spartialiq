# Production test readiness — design

Date: 2026-09-21
Status: approved, pending implementation plans

## Goal

Make the Vungu portal testable end to end by one person walking every role,
and replace the three divergent letterhead implementations with one.

"Production grade" here means testable first: every role signs in, every
portal shows real rows, no dead ends. Hardening of error paths, auth edges,
performance and security is deliberately deferred — it should be informed by
what the walkthrough finds, not guessed at now.

## Current state

Measured on 2026-09-21 against local `Vungu_spatial333`.

- `npm run type-check` passes clean.
- Two relations are corrupt: `pg_depend` (system catalog, relation 2608,
  block 121) and `public.inspection_bookings`. The first breaks
  `information_schema`, most DDL and `pg_dump`.
- 78 migration files exist (`000`–`122`). `schema_migrations` records 23, and
  stops at `102`. Migrations 103–122 were applied by hand without being
  recorded — tables from 120 and 121 exist with rows. The tracking table
  cannot be trusted, and the normal way to audit it is what the corruption
  broke.
- 76 application tables are empty.
- `scripts/seed-demo-users.js` already creates accounts for all nine staff
  roles. Demo *data* exists only for planner and inspector.

### Data at stake

Spatial data is large and worth preserving: 210,240 roads, 23,707 landuse,
14,905 waterways, 8,661 water areas, 7,601 + 6,103 POIs, 1,961 wards, 733
parcels, 687 farm cadastre.

Application data is small: 13 users, 28 permit applications, 48 planning
projects, 36 permit events, 8 stands, 8 payments.

## Decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Scope | Testability before hardening | Hardening should follow evidence from a real walkthrough |
| Test target | Local, repair the DB first | Seeding 7 portals hits the corruption immediately |
| Repair method | Fresh DB from a dump/restore | Replaying migrations proved infeasible; see Phase 0 |
| Existing rows | Preserve, seed around them | Some are meaningful; demo rows stay identifiable |
| Letterhead art | Supplied by the user | One asset constant, swapped without a code change |

### `public.development_applications` is dead

It has 0 rows and a live route at `/api/development-applications`, but no
frontend code calls it. The citizen portal reads
`spatial_planning.permit_application` through `dmApi.listPermits` →
`/development-management`. The legacy table is **not** seeded. Removing it and
its route is out of scope here and belongs to a later cleanup.

## Phase 0 — Database rebuild

Blocks Phase 2, which cannot seed anything until the schema is sound. Phase 1
is frontend-only and does not depend on it.

### Why not replay the migrations

The original plan was to replay all 78 migrations onto an empty database.
Measurement on 2026-09-21 showed that is not possible:

- `scripts/migrate.js` drives an explicit ordered allowlist, not
  filename order, and it lists only **54 of the 78** files.
- The 24 unlisted files include `000_multi_tenant_schema.sql`,
  `001_admin_schema.sql`, `002_phase2_schema.sql` and **116–122** — the
  inspector work queue, stage-inspection field events, inspector site
  geometry, permit document uploads, building complaints and both
  environmental-health migrations. Replaying the allowlist would build a
  schema missing exactly the tables Phase 2 must seed.
- Five migration numbers collide from parallel histories: two each of `078`,
  `079`, `080`, `081` and `082`.
- `050_enhance_land_use_management_corrected.sql` is documented in the runner
  as broken and deliberately skipped.

There is no canonical order to replay, and inventing one is guesswork whose
failure mode is a schema that silently disagrees with the application.

Reconciling the allowlist is real work, but it affects Render deploys rather
than local testing, so it is deferred to its own task (see Out of scope).

### Mechanism

`pg_dump` normally fails here, because its table query LEFT JOINs
`pg_depend`. Running it under `zero_damaged_pages=on` skips the damaged page
and succeeds: verified on 2026-09-21, producing 163 tables, 16 views, 38
functions, 323 indexes and 138 sequence ownerships. The setting only zeroes
the page in the reading backend's memory; a dump writes nothing to the source
database.

1. Take a filesystem-level copy of the data directory before anything else.
   `zero_damaged_pages` permanently destroys a damaged page if that page is
   ever written, so the untouched copy — not the live database — is the real
   fallback.
2. Create a new database alongside the old one. Do not drop
   `Vungu_spatial333`.
3. Restore the schema dump into it, then the data dump. Both are taken under
   `zero_damaged_pages=on`.
4. Reset every sequence to `max(id)` of its owning table. Sequence *values*
   do not survive a dump/restore correctly when rows are loaded explicitly,
   and the symptom is a duplicate-key error on the next insert.
5. `public.inspection_bookings` is corrupt and its data cannot be read. Its
   *definition* still dumps, so it is recreated by the schema restore and left
   empty. Nothing is lost: `pg_class` reports `relpages=0`,
   `reltuples=-1` and a single 8 KB page, so the table was never populated —
   it is one damaged empty page, not lost records.

   This table is live, not legacy. The whole `/api/inspections` route is built
   on it and `payments.js` flips its `fee_paid_at` for the `inspection_fee`
   type, so the citizen Inspections section is **erroring today**, not merely
   empty. The rebuild restores it to working-and-empty, which Phase 2 then
   seeds.
6. Cut `DATABASE_URL` over only after verification passes.

**Verification gate.**

- `select count(*) from pg_depend` and `select count(*) from
  information_schema.columns` both succeed on the new database — the
  corruption is gone.
- A fresh `pg_dump --schema-only` of the new database, taken *without*
  `zero_damaged_pages`, diffs clean against the dump taken from the old one.
  This is the real check that nothing was dropped in transit.
- Per-table row counts match the old database for every table except
  `inspection_bookings`.
- Every sequence returns a `last_value` at or above its table's `max(id)`.
- The backend boots and `test-tiles-endpoint.js` passes against the new
  database.

**Rollback.** Point `DATABASE_URL` back at `Vungu_spatial333`. If that database
has itself been damaged further, restore the filesystem copy from step 1.

**Risk.** `schema_migrations` is carried over as-is and will still under-report
what is applied. That is honest — it records the same 23 rows the old database
had — but it means the new database is *not* yet reproducible from migrations.
Making it so is the deferred allowlist task, and until that is done nobody
should assume a fresh `migrate.js` run reproduces this schema.

## Phase 1 — One letterhead

Independent of Phase 0, so it can land first.

Four surfaces exist today. One is visibly broken and one is missing entirely:

- `src/environment-officer/documents.ts` draws a text letterhead in jsPDF.
- `src/views/PaymentReceiptView.vue` uses the shield emoji as the coat of arms.
- `src/views/surveyor/views/modules/lite/finance/EstimateView.vue` loads
  `/letterhead.png`, falling back to `/tariff/` then `/help/`. None of those
  files exist in `public/`, so the image is broken in every print today.
- `../app-backend/src/services/notifier.js` — outbound email. Its
  comment claims to keep "the council letterhead simple and inline-styled",
  but `textToHtml` only wraps paragraphs in a bare `div`. There is no council
  name, department or mark on any email a citizen receives.

### Design

- `src/documents/council.ts` — council identity: name, department, postal and
  physical address, phone, email, and the asset path. One module, no Vue, no
  I/O, unit-testable.
- `drawLetterhead(doc, opts)` — jsPDF. Replaces the hand-drawn header in
  `documents.ts`; `councilDoc()` keeps its signature so its callers are
  untouched.
- `CouncilLetterhead.vue` — the HTML and print surface. Replaces the emoji
  header and the broken image.
- `emailLetterhead()` in the backend — inline-styled email HTML, prepended by
  `textToHtml`.

All render from the same identity, so a PDF notice, an on-screen receipt and
an acknowledgement email carry the same wording.

**Email is a different medium.** Mail clients block remote images by default
and ignore `<style>`, so the email letterhead is typographic and inline-styled
by default, with the artwork as progressive enhancement behind an absolute
URL — never the only thing carrying the council's identity.

**Cross-repo identity.** The backend is a separate repository and cannot
import `src/documents/council.ts`. The plan must pick one of: a shared JSON
file vendored into both, or a backend `src/config/council.js` mirror with a
test in each repo asserting the fields it depends on. Duplicating the values
silently is not acceptable — that is how the four surfaces diverged.

**The swap point.** The artwork path is a single constant. Dropping the real
file at `public/letterhead/council-letterhead.png` completes the work with no
code change.

**Error handling.** If the asset is absent or fails to load, both renderers
fall back to the typographic letterhead. This is what stops today's broken
image recurring, and it is the state the system ships in until the artwork
arrives.

## Phase 2 — Seed every role

Extends the existing `seed-*-demo.js` pattern: idempotent, each insert guarded
on a natural key, safe to re-run. One script per role plus a `seed-all-demo.js`
runner. Every seeded row is tagged so demo data can be identified and removed.

Gaps by role, from measured row counts:

- **Building inspector** — worst. `stage_inspection` and all its photo, flag
  and checklist tables, `occupation_certificate`, `building_plan`,
  `building_complaint` are all empty. The thirteen-section console is nearly
  all empty states despite `seed-inspector-demo.js`.
- **EHO** — field registers hold 1–3 rows each; every office record
  (`health_abatement_notice`, `health_burial_permit`,
  `health_food_handler_cert`, `health_licence_clearance`,
  `health_field_programme`, `health_premises_inspection`) is empty.
- **Planner** — three committee meetings exist with no `committee_member`,
  `agenda_item` or `meeting_attendance`; no `public_notice`,
  `application_consultation`, `application_objection`,
  `statutory_clock_event` or `generated_document`.
- **Surveyor** — 14 survey tasks, but the whole `survey` schema is empty.
- **GIS officer** — `gis_feature`, `zoning_designation`, `parcel_owner`,
  `spatial_analysis_result` empty.
- **Citizen** — 28 permit applications exist and are read correctly; seed
  supporting rows only.
- **Admin** — `site_content`, `invites` empty.
- **Payments** — 8 payments, no `exchange_rates`.

Seed data must form coherent worked examples, not disconnected rows: an
application that proceeds through consultation to committee to permit to
inspection, so the walkthrough follows one case across portals.

Dead ends found while walking a portal — a section with no loading, empty or
error state — are fixed as they are found and listed in the plan.

## Phase 3 — Verification

- Sign in as each of the nine staff roles and as a registered citizen, and
  browse the public surfaces signed out; confirm every section renders real
  rows. (`Role` has eleven values; `public` is the unauthenticated case.)
- Confirm the letterhead appears on every generated document.
- `npm run type-check`, `npm run lint`, `npm run test:unit -- --no-file-parallelism`.
- Backend smoke tests: `test-tiles-endpoint.js`,
  `scripts/verify-spatial-tables.js`, `test-eho-ops-sql.js`.

Lint currently reports 3 pre-existing errors outside the inspector module.
Those are recorded as the baseline, not fixed here.

## Out of scope

Error-path and auth hardening, performance work, security review, the Render
rollout, and removing the dead `development_applications` table and route.
Each follows from what the walkthrough finds.

**Reconciling the migration allowlist.** 24 of 78 migration files are absent
from `scripts/migrate.js`, five numbers collide, and `050` is broken.
Until that is audited and the allowlist rewritten, the schema is not
reproducible from migrations and a fresh Render deploy will not match local.
This is the most important deferred item — it blocks deployment, not testing,
which is the only reason it is not in this spec.
