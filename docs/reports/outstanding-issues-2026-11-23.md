# Outstanding issues for the development team — 23 November 2026

Reviewed at `main` 339d79d (after PR #55). Checks run:
- the backend Jest suite, against the local Docker database (never the live one);
- the frontend Vitest suite and `vue-tsc`;
- `npm audit` on production dependencies;
- a scan for TODO markers, dead code and schema drift;
- a probe of the live site.

## 1. Must fix before the next release

> **1.2 addressed on branch `fix/dependency-vulnerabilities`.** Production dependencies after the change:
>
> - **Backend:** 3 moderate findings (from 2 critical, 17 high and 10 moderate). All three are one `minimatch` advisory, reached through `archiver` (the backup script only) and `@fastify/static`.
> - **Frontend:** 2 moderate findings (from 1 critical, 9 high and 3 moderate). Both are the `uuid` buffer-bounds advisory inside `exceljs`; it applies only to v3, v5 or v6 with a caller-supplied buffer, and `exceljs` uses v4.
>
> What changed:
>
> | Change | Why it was needed |
> |---|---|
> | `npm audit fix` in both workspaces | Fixes within the declared version ranges, including `fastify`, `fast-jwt`, `fast-xml-parser`, `axios`, `vue` and `lodash`. |
> | Major upgrades: `@fastify/static` 10, `@fastify/swagger-ui` 6.1.5, `archiver` 8, `csv-parse` 7 | No fix existed within the current major versions. |
> | `zod` removed | It was unused. |
> | `maplibre-gl` 4.7 to 6.19 | Every version up to 6.4 has the sanitiser XSS advisory. Version 6 has no default export, so imports became `import * as maplibregl`, and `preserveDrawingBuffer` moved under `canvasContextAttributes`. |
> | `xlsx` replaced by `exceljs` in `utils/tableExport.ts` | SheetJS no longer publishes to npm. `exceljs` reaches the browser as a CommonJS `default` export. |
> | New `src/map/maplibre.ts`, with a vite alias that sends `maplibre-gl` imports to it | From version 5, MapLibre finds its web worker beside its own file. Without this, every map was blank, in development and in production ("Worker failed to load"). The wrapper sets the worker URL to a bundled asset. |
>
> How it was checked:
>
> - **Development:**
>   - a map built with the app's basemap drew 2,672 features from 80 tiles, without errors;
>   - the app's own `downloadExcel` produced a workbook that reads back correctly.
> - **Production build:** the worker is emitted as `assets/maplibre-gl-worker-*.mjs` and served as `text/javascript`, and it starts in the browser.
> - **Not checked:**
>   - every map screen, one by one;
>   - the PWA service worker, because the in-app browser refuses all service workers.

| # | Issue | Evidence | What to do |
|---|---|---|---|
| 1.1 | **The live site is out of date.** Render has not deployed since about PR #45. The live database already has migrations 256 and 257, but the code that uses them is not deployed. | `GET https://spartialiq.onrender.com/api/persons/search` returns **404** (a deployed route would answer 401). `/api/health` returns 200. | Deploy `main` from the Render dashboard. Add a deploy hook or `render.yaml` so that a merge deploys. |
| 1.2 | **Critical and high vulnerabilities in production dependencies.** Backend: 2 critical, 17 high. Frontend: 1 critical, 9 high. | The critical ones are `fast-jwt` (authentication tokens), `fast-xml-parser` and `maplibre-gl`. The high ones include `fastify`, `@fastify/static`, `axios`, `vue`, `lodash` and `joi`. All have fixes, except `xlsx`. | Run `npm audit fix` and test, one workspace at a time; give `fastify` and `fast-jwt` priority. `xlsx` has no npm fix: move to the SheetJS CDN build or `exceljs`. |
| 1.3 | ~~Inspection photos keep their EXIF metadata.~~ **Withdrawn after review: not a defect.** | Inspectors' photos go through `POST /stage-inspections/:sid/photos` (`routes/development-management.js`). The photo's position and time are recorded on purpose (`taken_lat`, `taken_lng`), so the geofence can show that the inspector was on site. Each file's SHA-256 is stored, and supervisors can flag an inspection for "photos don't match site"; the original file is the evidence for both, and stripping it would change the file. Files are served only to council staff and the applicant who owns the case (`routes/protected-uploads.js`). The "strips EXIF (TODO)" note at `frontend/src/services/inspectionsService.ts:160` belongs to `uploadPhoto` and `POST /inspections/:id/photos`, which no screen calls. | Nothing must be done. Two optional tidy-ups: remove the unused `uploadPhoto` and its route, or correct its comment. If the council ever wants applicants not to see the inspector's device model, give applicants a cleaned copy and keep the original for staff. |
| 1.4 | **Addressed: the TypeScript admin server is removed.** 39 files are gone: `src/index.ts`, `src/admin/**`, `src/controllers/admin/**`, `src/middleware/admin/auth.ts`, `src/routes/admin/auth.ts`, `src/models/AdminUser.ts`, `src/types/admin.ts` and the `.ts` files in `src/services/admin/`; the `dev:admin` script is removed too. `server.js` loaded none of them, and nothing that runs imported them. The JavaScript QGIS helpers in `src/services/admin/` stay. The frontend had already retired the one screen written for these routes (`/admin/phase2`). Fourteen other `.ts` files remain unused, being earlier copies of routes and middleware that `server.js` loads as `.js`; they hold no sign-in. Original finding: **A mock sign-in controller is still in the repository.** `authControllerSimple.ts` returns a `super_admin` token for any email and password. | `backend/src/controllers/admin/authControllerSimple.ts:24`, imported by `src/admin/auth.ts` and `src/admin/routes/auth.ts`. It is reachable only through `npm run dev:admin`; production runs `server.js`. | Delete the TypeScript admin server (`src/index.ts`, `src/admin/**`, `src/controllers/admin/**` and the duplicated services: 53 `.ts` files), or replace the stub with real authentication. As it stands, one script runs an open admin API. |

## 2. Test suite: 18 of 104 backend suites fail (89 of 1,265 tests)

> **Addressed on branch `fix/stale-tests`.** The stale tests are fixed. Against the local database, a plain `npm test` now leaves only four failing suites, all of them down to the environment:
>
> - `inspector-gis`: the local `buildings` table is empty;
> - `parcels.nearby`: `pois_points` is missing;
> - `spatial-engine.sql`: the 30-second statement timeout;
> - `plan-revisions`: the same timeout, only under the full run.
>
> **Flaky:** `application-plan` passes alone (7 of 7), but can fail in the full parallel run. `committee-gate` switches the council's delegation settings (S1 to S5) on and off in the same database, and a refusal by the EO alone depends on them. To fix it, either run the two suites serially, or give `committee-gate` its own authority for the switches.
>
> The frontend passes in full.
>
> What was done:
>
> - **The status route.** `PATCH /permit-applications/:id/status` answered with the row from before the AFTER triggers ran. An acknowledgement circulates the case and moves its revision on, so the officer was given a stale revision and status, and their next change was refused as a conflict. The route now answers with the case as it stands. This was a real bug, found through the tests.
> - **The test walks.** They now record the automatic referrals' replies with `test/helpers/circulation.js`. Roads and Works is consulted on every case, blocking, so a case is not decided until it replies.
> - **`acknowledgement-moves-case`** expects the case to go on into `circulation`, with both automatic entries in its history.
> - **`payments.applicationfee`.**
>   - It used a fixed Paynow poll URL, so payments left by interrupted runs were settled in place of its own.
>   - Since migration 246, every run leaves a `finance.planning_fee` row, which can never be deleted.
>   - It now uses its own poll URL, refuses a database that is not a test one, removes its rows with the keeping trigger off, and is an integration suite.
> - **Six finance suites** (assets, bank, migration, payables, salaries, vote-book) refuse a database that is not a test one, but were never listed as integration suites. They are now listed.
> - **`publish-zone-styles`** names zones as the system loads them: "Light Industry" becomes "Light and General Industry" (`load-eo-matrix.js`).
> - **`route-roles.spec.ts`** uses an address that will never be a workspace; the committee workspace has since been built.
>
> Left behind by interrupted runs: the local database holds six test payments with undeletable `finance.planning_fee` notes. They are local only.

The frontend passes 2,238 of 2,240 tests, and `vue-tsc` reports no type errors.

Causes:

| Cause | Suites | Fix |
|---|---|---|
| **The tests predate automatic circulation (PR #53).** An acknowledged case now moves to `circulation` and is fee-gated at `pending_payment`, but the tests expect the old route: `acknowledged → under_review`, `registered`. | `committee-gate`, `statutory-gates`, `acknowledgement-moves-case`, `permit-record-fields`, `payments.applicationfee`, `test/application-plan`, `test/plan-revisions`, `inspector-gis` | Update the tests' walk through the statuses (a shared helper would stop this happening again). This is the largest single item: about 60 tests. |
| **The finance suites refuse the database, as designed.** They need the acceptance database. | `finance.assets`, `.bank`, `.migration`, `.payables`, `.salaries`, `.vote-book` | Not a defect. Run them with `npm run test:db:prepare` and `DATABASE_URL=…/vungu_acceptance_test`. Add that run to CI so they are not skipped silently. |
| **Statement timeout on the local database** (30 s); the rest of each suite then aborts. | `spatial-engine.sql` | Raise `statement_timeout` for this suite, or speed up `spatial_engine.refresh()`. |
| **A reference table is missing locally** (`pois_points`). | `parcels.nearby`, `spatial-names` | Load the layer in the test database, or have the resolver skip a source that is absent. |
| **New data, old expectation.** "Light Industry" is a peri-urban zone with no colour. | `scripts/publish-zone-styles` | Give it a colour, or add it to `KNOWN_UNSTYLED`. |
| **Frontend:** one route test expects the old catch-all. | `route-roles.spec.ts` | Update it to the current redirect. |

The frontend test `rdc-farm-subdivision.spec.ts` rewrites the tracked file `src/planning/__tests__/subdivision.geojson` every time it runs. It should write to a temporary folder.

## 3. Schema and deployment drift

| # | Issue | What to do |
|---|---|---|
| 3.1 | **`scripts/migrate.js` stops at 247.** Migrations 248–258 reach live only through the one-off `scripts/apply-*-to-live.js` scripts, so a new environment built with `npm run migrate` (a second council, a rebuilt test database) lacks them. Live's `schema_migrations` table also does not match the repository. | Reconcile once, with a reviewed script that records what live really has. Then register 248–258 in `migrate.js` and `migrate.test.js`, and return to one migration path. |
| 3.2 | **Migration 258 (the Registrar-General prototype) is not on live, by design, but its routes are mounted everywhere.** On live, `/api/rg-prototype/*` would fail with server errors rather than answer "not here". The demonstration key is in the source (`registrarGeneral.js:16`) and in the migration. | Mount the prototype routes only when `RG_MODE=prototype`. Keep the key out of anything that may be deployed. |
| 3.3 | **Log files and a stray CSV at the repository root.** `backend.log`, `frontend.log`, `demo-*.log`, `*.err.log` and `hertfordshire-import-report.csv` are not ignored. | Add `*.log` to `.gitignore`; move the CSV or delete it. |

## 4. Unfinished features (known, recorded in code or documents)

- **Register of persons:**
  - Merging duplicate persons. For example, a backfilled "Demo Citizen" and an online one; nothing is merged on a name alone.
  - Gates by assurance level for acts of legal weight. These need a council decision first.
- ~~**Data ingestion (admin)**~~: removed with the TypeScript server in 1.4. It was never mounted.
- **Plan review:** setback measurement from DXF or PDF drawings is not built (`services/planReview.js:128`).
- **ERP adapter:** the CSV-over-SFTP fallback is not built (`services/gms/erpAdapter.js:58`).
- **Earlier plans** (`docs/PROGRESS.md`, "What's left"):
  - QGIS Server wiring;
  - production payment credentials and webhooks (still sandbox);
  - the remaining Survey Task Manager modules;
  - user acceptance by role.
- **Product placeholders:**
  - non-permit e-services (`router/index.ts:545`);
  - retiring the planner-v1 subdivision format (`planning/subdivision.ts:216`).

## Suggested order

1. Deploy `main` (1.1).
2. Patch the dependencies (1.2).
3. ~~Remove the mock admin server (1.4).~~ Done.
4. Bring the tests up to date with automatic circulation, and put the acceptance-database run in CI (section 2).
5. Reconcile the migration path (3.1).

Item 1.3 (photo metadata) was withdrawn; see the table.
