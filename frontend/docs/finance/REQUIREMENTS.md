# Finance module — requirements checklist

Resumable work list. Baseline: the Vungu RDC technical specification v1.0 (proposed).
`[x]` = implemented **and** covered by a test that was run and passed.
`[~]` = implemented, not yet verified end to end. `[ ]` = not started.
Backend = `../Manicipal-drums-backend-3`.

## How this was last verified — 2026-11-07

| What | Command | Result |
|---|---|---|
| Backend unit suites (dev DB) | `node node_modules/jest/bin/jest.js` (backend repo) | **55 suites, 602 passed** — the long-failing six are green (see audit docs F-14–F-18) |
| Backend acceptance, freshly migrated chain | `node scripts/prepare-acceptance-db.js test` | **8 suites, 78 passed** — Tsamba seeding works again |
| Backend live HTTP | `node scripts/run-live-server-tests.js` | **2 suites, 18 passed** |
| Frontend suites | `npm run test:unit` | **144 files, 1220 passed, 1 skipped** |
| Frontend types + build | `npx vue-tsc --noEmit && npm run build` | clean / passed |
| Cross-tenant isolation | `test/finance-cross-tenant.test.js` + live 4-cell matrix | leak found in `published_select` (194) → **fixed by migration 197**, verified |
| Public-portal RLS performance | 50k published transactions on a scratch chain-built DB | **0.79 ms** paged / **415 ms** full-year aggregate — blocker independently verified resolved |
| Backup → restore → verify | `backup-db.js` / `pg_restore` / `verify-restore.js` | **PASS, 0 mismatches** (126 s / 74 s) |

Audit evidence for all of the above lives in the backend repo's `docs/audit/` (updated
2026-11-07). The decision register for Council is `docs/finance/DECISION-REGISTER.md`.

### Previous verification — 2026-11-06

| What | Command | Result |
|---|---|---|
| Finance primitives, spreadsheet reader/writer, PDF renderer | `node node_modules/jest/bin/jest.js test/finance-primitives.test.js test/finance-spreadsheet.test.js test/finance-pdf.test.js` | **66 passed** |
| Finance acceptance, A1–A10 end to end against a freshly migrated database | `DATABASE_URL=…/vungu_acceptance_test node node_modules/jest/bin/jest.js src/routes/__tests__/finance.acceptance.test.js --runInBand` | **finance.acceptance: 29 passed** |
| Finance roles accepted by the application role registry | `node node_modules/jest/bin/jest.js test/finance-roles.test.js` | **3 passed** |
| Frontend finance module, access screen, role-gated routes and the prompt dialog | `npx vitest run src/modules/finance src/router/__tests__/route-roles.spec.ts` | **60 passed** (44 finance + 16 route-roles) |
| Frontend types | `npx vue-tsc --noEmit` | clean repo-wide (the two pre-existing `QGISMapView.vue` errors are fixed in the working tree) |
| Lint | `npx eslint src/modules/finance --ext .vue,.ts` | clean |
| Production build | `npm run build` (`vue-tsc --noEmit && vite build`) | **passed** |

### Live user-journey pass — 2026-11-06 (evening)

Driven against the real backend (:3000) and Vite (:5174) with demo personas, partly in the
browser UI and partly through the same HTTP endpoints the UI calls (the in-app browser's
webview died mid-session; the journeys completed over HTTP and the surfaces were re-verified
visually after it recovered):

- **Budget lifecycle in the UI**: finance admin created line `E2E-T1` (draft) → submitted;
  treasurer approved it. Preparer and approver saw only their own actions (separation visible).
- **Revisions**: officer raised +25 000 with a written reason via the new dialog, submitted;
  self-approval refused (403); treasurer approved; line shows original 150 000.00 and revised
  175 000.00 together (A4, A6). A second revision (−12 000) was raised through the dialog UI
  and sits as a draft.
- **Import**: CSV with 1 good + 2 bad rows uploaded as actuals; same file + same idempotency key
  re-upload returned the same batch (A1); validation rejected 2 rows with precise row-level
  exceptions (A2); reconciliation carries the source SHA-256 and the declared control totals (A3);
  one exception resolved `row_excluded` with a note; officer refused commit (no
  `finance.import.commit`), finance admin committed with a written override reason; re-commit was
  a no-op (idempotent).
- **Publication**: budget dataset requested → treasurer approved → treasurer publish refused
  (403, approver ≠ publisher) → publisher published → 1 approved line marked; expenditure dataset
  published the same way. Technical admin refused approve and publish (403, A5).
- **Public portal**: anonymous `/api/public/finance/*` returns only the published line (both
  figures), the transaction only after its dataset was published, and no counterparty identity
  (A7). `/council/finances` renders it: cards, definitions block, per-dataset publication table.
- **Reports**: catalogue of 9; `budget_vs_actual` run as JSON; CSV/XLSX/PDF exported — the PDF
  carries the §3.9 metadata block, filenames carry the council identity and timestamp.
- **Finance access admin**: admin self-edit refused (409); budget officer confined to DEMO-ENG
  with a deny override and a written reason; the audit event carries full before/after sets.

Rows created by this pass are labelled `E2E` (`E2E-T1`, `E2E-TRX-*`, revisions on E2E-T1) in
`vungu_dev`, alongside the earlier `DEMO` rows. Remove both sets before any Council demonstration.

### Prompt dialog — 2026-11-06

Every `window.prompt` in the staff workspace (17 call sites across 6 sections) was replaced by
`FinancePromptDialog.vue` on the shared `UiSheet` overlay, driven by `useFinancePrompt()` — same
`string | null` contract, but validated before submit (decimal amounts, minimum reason lengths,
selects instead of typed enums/line numbers), focus-trapped, and covered by
`__tests__/prompt-dialog.spec.ts` (7 tests).

## Slice 9 — The finance workspace's own account, and the gaps between the API and the screens
Added 2026-11-08. Verified against the live backend (:3000) and Vite (:5174) as
`demo.finance-admin@vungu.test`, and by `npx vitest run src/modules/finance` (44 → 61 tests, 6 files).

### The account menu — every finance role could sign in and not sign out
- [x] `/finance` is the whole of what a finance role sees: `ROLE_HOME` sends all seven finance
      roles there and the workspace carried no account chip, so there was **no sign-out, no way to
      see which account was signed in, and no way to leave** except the address bar.
      `FinanceWorkspace.vue` now carries the shared `ProfileDropdown`, labelled from the finance
      role the **server** reports (`/finance/me`), falling back to the browser's session while that
      call is in flight — so the door is there even when the permission read hangs or fails.
- [x] Signing out calls `auth.logout()`, **`store.reset()`** and then leaves for `/login`. The reset
      is the part that matters: Pinia state outlives the route change, so without it the next
      person at the same machine — the normal case in a shared council office — would inherit the
      previous officer's permission set, departmental scope and selected year.
- [x] A skip link and a focusable `#fin-main`, which the workspace had never had.
- [x] `__tests__/sign-out.spec.ts` (12 tests, one per finance role plus the four behaviours) pins the chip for all seven finance roles plus
      `admin`, the reset, the redirect, and that the control exists while loading and after a
      failed permission read.

### A toolbar that was invisible in every section
- [x] All nine finance toolbars were built on `.ins-bar`, which on the shared inspector sheet is a
      **6px progress meter with `overflow: hidden`**. Every search box, filter and primary action in
      Budget, Projects, Imports, Revisions, Publication, Audit, Classifications and Documents was
      in the DOM, focusable, and clipped to a sliver. They now use `.fin-bar`, defined in
      `finance.css` with the reason recorded beside it.
- [x] The budget and project tables pin their action column (`.fin-table.sticky-actions`): eleven
      columns of figures are wider than the content pane, and what scrolled out of sight first was
      Edit / Submit / Approve.

### Endpoints the backend served and no screen could reach
Each of these existed in `financeApi.ts` or the backend and had **no caller in any view**:

- [x] **Documents** — a whole specification slice (§3.8) with no surface. `DocumentsSection.vue`:
      list, filter by subject kind and visibility, search, attach (with a record picker that
      resolves years, lines, revisions, projects, batches and publications rather than asking for a
      UUID), download, change visibility, withdraw. `finance.document.upload` was a permission no
      screen could exercise. Covered by `__tests__/documents.spec.ts` (5 tests), which pins that a
      preparer is offered no release control, that making a document public demands a written
      reason, and that withdrawal is described as retention.
- [x] **Budget line edit** (`PATCH /budget-lines/:id`) — the section's own header said "the Edit
      button disappears and says where to go instead"; there was no Edit button at all, so a draft
      with a typo could only be fixed through the API. Department, account, code and currency are
      fixed in the form, matching the fields the server accepts.
- [x] **Financial year edit** (`PATCH /financial-years/:id`) — label, note and reporting currency,
      offered only for draft and open years because the server refuses the rest. The dates stay
      uneditable and the screen says why.
- [x] **Department, programme, activity and account edit** — in-place row editing, with an
      Activities tab that did not exist (`GET/POST/PATCH /finance/activities` were unreachable) and
      a Withdraw that reports the server's retire-instead-of-delete answer.
- [x] **Project edit, transaction association and detachment** (`PATCH /projects/:id`,
      `POST`/`DELETE /projects/:id/transactions/...`) and document attachment from the trace.
- [x] **Commitments** (`GET /finance/commitments`) — the register behind the difference between the
      two "available" figures every budget row shows. Loaded on demand, grouped per currency.
- [x] **Import row preview** (`GET /imports/:id/rows`) — what each row BECAME after the mapping and
      lookups ran, beside the existing raw preview. Paged and filterable by row state.
- [x] **Column overrides and mapping profiles** — `columnOverrides` was declared and sent to
      validation with **no control anywhere to set it**, while the missing-required banner told the
      officer to "map them below". A file with one unrecognised heading therefore could not be
      imported through the console at all. The mapping controls now exist, and
      `POST /finance/column-mappings` saves them as a named profile.
- [x] **Public transaction detail** (`GET /public/finance/transactions/:id`) — a resident can open a
      published posting and read the documents the council released with it.
- [x] **`GET /finance/linked/:kind/:id`** — `LinkedFinancePanel.vue`, the module's integration entry
      point, previously called from nowhere. Mounted in the project trace, where the record's kind
      and id are certain.

### Known gap this work deliberately did not paper over
- [x] **The planner-side host for `LinkedFinancePanel`** — resolved in Slice 10 below, once the
      schema was read rather than guessed at: the mapping does exist
      (`permit_application.dev_app_id`), and the permit endpoint already returns it.
- [ ] **No staff register of individual postings.** There is no `GET /finance/transactions`, so
      attaching a transaction to a project takes a typed identifier, and a document attached to a
      `transaction` subject does too. Everything else offers a picker.

## Slice 10 — The session boundary, the planning↔finance identifier, and test isolation
Added 2026-11-08, after the Slice 9 work was reviewed. Three defects, each found by asking what
would actually happen rather than whether the code looked right.

### 1. Signing out did not end the session in the browser
`POST /auth/logout` was already correct server-side: it revokes the `user_session` row, and
`authenticate()` re-checks session liveness on every request, so the access cookie stops working
at once rather than drifting to its 12-hour expiry. Verified: `demo.planner` reads
`GET /finance/linked/...` with 200; `demo.inspector`, `demo.surveyor` and `demo.clerk` are refused
403 by the server whatever the screen offers.

What did not happen was the clearing of **in-memory state**. A sign-out is a route change inside
one long-lived tab, so every Pinia store survived it. On a shared council workstation — one
browser, officers taking turns — the next person to sign in inherited the previous officer's
finance permission set, departmental scope, selected financial year and loaded classifications,
and the planning board's loaded applications, until each store happened to refetch. The finance
workspace worked around this by calling `financeStore.reset()` from its own sign-out handler,
which covered the one door it knew about and left the 401 interceptor, the idle timeout and every
other role's shell leaking.

- [x] `src/services/sessionScope.ts` — the clearing now lives at the session boundary. Every store
      Pinia has instantiated is reset, except an explicit list that holds nothing about the person
      (`auth`, which is doing the clearing; `council`, the authority's name and province;
      `spatial`, the public tile-layer catalogue). The default direction is deliberate: a store
      added next year is session-scoped until someone argues otherwise.
- [x] Called from the auth store's `clearLocal()`, which runs on an explicit sign-out, a rejected
      refresh, a failed profile probe and a 401 from any endpoint — so there is one boundary, not
      one per screen.
- [x] Module-level caches that are not stores clear too, through `onSessionEnd()`:
      `useInspectorWorkload`'s rail badge counts were one inspector's outstanding work held at
      module scope for the life of the tab.
- [x] `vungu.finance.lastFinancialYear` is purged with the other session caches in
      `services/session.ts`. The remembered year is one person's chosen reporting period; the next
      officer must land on the current open year, not on whichever period the first was
      reconciling. A chosen language is a setting, not case data, and survives.
- [x] `usePlanningWorkflowStore` gained the `reset()` the boundary expects; its items carry
      applicant names and the stand applied over.
- [x] Pinned by `src/stores/__tests__/sessionScope.spec.ts` (7 tests), including that one store
      throwing does not stop the rest — a half-cleared session is worse than the error, because
      what is left behind is the state nobody is looking at.

Verified in the browser: officer one signs in (`demo.budget-officer`), signs out, and the chip,
rail, remembered year and every `localStorage` case key are gone; browser **Back** lands on
`/login` with no finance rail rendered and no trace of the previous role; a direct hit on
`/finance` redirects to `/login?redirect=/finance`; officer two (`demo.finance-officer`) signs in
on the same browser and sees their own role and no inherited year. Zero console errors.

This is **not** the security control — the server is. It is what stops the second officer being
shown the first officer's figures as if they were their own.

### 2. `permit_application` vs `development_applications` — the mapping was in the schema
Slice 9 recorded this as needing "either the application id on the planner's case file or a
backend lookup". Reading migration 070 settled it: `spatial_planning.permit_application.dev_app_id`
is a soft reference to `public.development_applications.id` (no FK, because the citizen-portal
lineage is `VARCHAR` and the GIS dev-control lineage is `UUID`; the link is enforced in application
code). `GET /permit-applications/:id` returns it already — it is a `SELECT *`.

- [x] `PermitApplication.dev_app_id` is typed, with the note that it is present on the single fetch
      and absent from the list views.
- [x] `CaseFile.devAppId` carries it onto the planner's case file, normalised to `null` for drafts
      cached before the field existed — `undefined` would be read as "not linked".
- [x] `src/views/planner/case/CaseFinancePanel.vue` owns the identifier decision and is mounted in
      the case file's Overview tab. It mounts `LinkedFinancePanel` **only** with the portal
      application id. With no link it says the lookup cannot be made and that this is not a
      statement that nothing was spent — rather than searching with the permit id, which would
      answer "no council project is attached" and read as a fact about council spending.
- [x] The finance module is loaded on demand, so a case with no portal link — the common case,
      since an application registered at the counter has none — never downloads it.
- [x] `LinkedFinancePanel` now carries its own stylesheets. It is the one finance component mounted
      outside the workspace, and in the planner's case file it rendered unstyled. Both sheets are
      entirely class-prefixed, so loading them on a planning page restyles nothing.
- [x] `src/views/planner/__tests__/caseFinancePanel.spec.ts` (4 tests) pins that the request
      carries the portal id and never the permit id, and that no request is made at all when there
      is no link.

Verified live, with a temporary `development_applications` row linked to one permit and then
reverted: the planner's own permissions are enough
(`GET /finance/linked/development_application/... → 200`), the panel renders the citing project and
its per-currency totals, and with the link removed it makes no request and states the absence.

### 3. Unit tests were talking to the development backend
happy-dom's document origin defaults to `http://localhost:3000`, which is the port the development
backend listens on, and the axios client's `baseURL` is the relative `/api`. Every unmocked request
a test made therefore resolved to the **real server, with the real database behind it**. Tests
passed or failed depending on whether a backend happened to be running and what was in it, and the
suite logged socket hang-ups from racing it.

- [x] `vite.config.ts` sets the test origin to a host that resolves to nothing, so an unmocked
      request is a plain network failure, identical on every machine and in CI, and no unit test
      can read or write council data.
- [x] That exposed the real defect behind the intermittent `citizenSections.spec.ts` failure, which
      had been reported as "pre-existing and unrelated". `NoticesSection` loads in two chained
      rounds and reads `GET /title-notices/mine` through the axios client directly; whether the
      second round had run when the assertions executed depended on how fast that live request
      failed. The spec now mocks it, and a mocked reply settles in a microtask — which is what the
      test's flushes actually wait for. The suite is green with the network closed off.

**Observation for the backend, not fixed here:** `src/routes/__tests__/finance.workflow.test.js`
writes to the same `vungu_dev` database the development frontend reads, tagging its fixtures
`WF<hex>` and creating its own open financial year. A run of it while the console is open makes the
budget section show that test's synthetic departments and lines, because the year picker defaults
to the newest open year. This was observed during verification and resolved itself when the suite
finished. It is the backend twin of the defect fixed above.

### GIS integration readiness
Checked rather than assumed, because the planned GIS-integrated budget work must inherit the same
permission model:

- The spatial substrate already exists: `finance.project.location` is a real `GEOMETRY`,
  `ward_code` is on `budget_line`, `transaction` and `project`, and `finance.v_ward_performance`
  and `finance.v_budget_ward_attribution` are ward-level views — the natural source for a financial
  map layer. There is **no** finance entry in the tile registry (`src/config/spatialLayers.js`), so
  no financial GIS layer exists yet.
- The finance identity is reachable outside the module: `useFinanceStore` is an ordinary Pinia
  store, and `can()`, `departmentScope` and `isScoped` are available to any map view that calls
  `loadIdentity()` first. `finance.project.view` is already granted to `planner`, `eo` and
  `env_officer`, which is why the planner panel above works without giving planning staff the
  budget console.
- The session-boundary fix is a **prerequisite** for using that identity to gate map layers. Before
  it, a stale finance permission set survived a sign-out, so the next officer's map would have been
  governed by the previous officer's permissions. It is now cleared with the rest of the session.
- Two requirements for whoever builds the layer, both outside what a screen can enforce:
  1. The tile route must carry `requirePermission(fastify, 'finance.project.view')` (or a narrower
     code) itself. MVT endpoints do not pass through the finance route middleware, and a layer
     served without it would publish per-ward budget figures to any authenticated account.
  2. The departmental and ward scope must be applied **in the SQL that builds the tile**, not by
     filtering features in the client. A client-side filter ships the figures to the browser and
     then hides them.

### Verification commands — 2026-11-08
```
npx vue-tsc --noEmit                      clean
npx eslint src/modules/finance src/services/sessionScope.ts src/views/planner  clean
npx vitest run                            148 files, 1248 passed, 1 skipped, 0 failed
npm run build                             passes
```

## Slice 11 — GIS–finance M4, M5, M6-1, M6-3, M7-4 and M7-5 frontend
Added 2026-11-09. The backend for ward mapping (M4), the capital-project map (M5) and the public
transparency map (M7) already existed in `../Manicipal-drums-backend-3` (routes
`finance-spatial.js`, `finance-public.js`; migrations 201–202). The frontend was still M3-era, so
this slice wires the existing, SQL-computed figures into the screens. No new finance tables, no
seed data, no client-side aggregation.

### M4 — revenue and expenditure mapping (staff)
- [x] `financeApi.mapWards()` typed against the full 30-field `v_ward_performance` row, plus
      `ward_dimensions`, `projects_by_ward`, `unlocated`, `actuals_basis`, `department_scope` and
      `ward_register_bases`.
- [x] `MapSection.vue` offers all **20** measures in three named groups — expenditure, revenue and
      attribution — instead of the original seven. Attribution is shown as what the approved
      splits place, what they cannot place (`unallocated_remainder_amount`) and how many rows are
      exceptions; a remainder is a figure, never a silent omission.
- [x] The selected ward panel carries the department/programme breakdown and the ward's project
      summary, both read from the server's rows. The client never sums a breakdown to make a total.
- [x] The actuals basis is stated on the map (`transaction_ward_code` vs `budget_line_ward_code`),
      because "actual" has two legitimate definitions and a map that hides which one it used is
      ambiguous. `department_scope` is shown as the scope actually applied.
- [x] Rows the server cannot place are listed below the map with their reason and amount; they are
      not folded into a ward and not dropped.
- [x] D11: when the ward register basis includes `interim`, the map labels the ward list
      **provisional**. The figures are still drawn — the boundaries are what is unconfirmed.
- [x] A null measure paints `FINANCE_NO_DATA`, never the bottom class; the ward table renders a
      dash, and a percentage the server returned as null says "not defined" rather than 0 %.

### M5 — projects and capital on the map (staff)
- [x] `financeApi.mapProjects()` returns the full project feature collection, unlocated projects
      with a reason, currency list, scope and bbox; `MapSection.vue` draws the located projects as
      a circle layer with a measure selector (approved budget, allocated total, actual spend).
- [x] Circle radius grows with the quantile class (area, not diameter) and a null figure gets the
      minimum radius, never 0. The same class edges are used as the choropleth.
- [x] Status colour comes from `FINANCE_PROJECT_STATUS`; status is also in the project panel and
      in an accessible project table, so colour is never the only carrier.
- [x] D12 progress honesty: the panel shows physical progress only when it was recorded, shows
      `spend_ahead_of_progress` as an exception, and does not infer progress from spend.
- [x] Unlocated projects are listed by name, reference, ward and reason. A project with no point
      is not silently absent from the map.
- [x] `src/map/vunguBasemapStyle.ts` now owns the finance ramps
      (`FINANCE_CHOROPLETH`, `FINANCE_NO_DATA`, `FINANCE_PROJECT_STATUS`) and `DESIGN.md` has the
      "Finance overlay" subsection. Paint and legend import the same constants.
- [x] M5-7: `SpatialAllocationPanel.vue` reads and writes the existing allocation register for a
      budget line or project. Drafts are validated (positive amount, ≤2 decimal places, known ward,
      same currency), and approve/refuse/withdraw call the server workflow; the client hides
      self-approval and the server still refuses it (`403 self_approval`). An approved split
      refreshes the ward figures from the views — the map never applies a split locally.

### M6-1 — permission-derived map presets (staff)
- [x] `mapPresetFor(permissions)` in `useFinanceMap.ts` is a pure function returning the map's
      opening measure, breakdown, layer visibility and project measure. `MapSection.vue` reads it
      once when the section mounts (the workspace mounts sections only after the identity is
      loaded), so a reader lands on their work instead of always on expenditure budget.
- [x] Presets, in tested precedence order: money approver → `execution` / ward totals; project
      manager without budget preparation → capital layer on, `allocated_total`; read-only auditor
      (`finance.report.export` and no write code) → `expenditure_actual` / ward totals; budget
      preparer → `expenditure_budget` by department; revenue-leaning reader → collection rate;
      everyone else → expenditure budget / ward totals.
- [x] The preset is presentation, not a gate: every control remains available to anyone holding
      `finance.map.view`, no measure is hidden, and the same permission set always yields the same
      preset (tested, including a person holding several role shapes). Currency is `null` in every
      preset, so the server's first currency carrying figures still wins and USD is never guessed.
- [x] A departmental head who both prepares a budget and manages projects is treated as a preparer
      (the allocation view); the project layer stays one checkbox away. This tie-break is explicit
      in the code and pinned by a test rather than left to object iteration order.

### M6-3 — auditor map export (staff)
- [x] `MapSection.vue` creates the map with `preserveDrawingBuffer: true` and offers **Export PDF**
      (`exportMapToPdf`). The sheet is the live canvas plus the on-screen ramp and project-status
      key — no figure is recomputed for the export.
- [x] `mapExportMeta()` in `useFinanceMap.ts` composes the provenance: year, currency, measure,
      ward-total/department/programme breakdown, source view `finance.v_ward_performance`, the
      view's own `generated_at`, the project-circle measure when circles are shown, and the D11
      provisional caveat when the ward list is interim. The compact footer names the year, currency
      and source view, so a sheet quoted in a committee report cannot be separated from its meaning.
- [x] `mapExport.ts` wraps long titles/subtitles, sizes the legend card to its longest label, and
      prints the provenance line above the coordinates. A missing year prints "No financial year"
      rather than an empty field.

### M7 — public transparency map
- [x] `financePublicApi.mapWards()` and `mapWardGeometry()` typed and wired into the new
      `PublicFinanceMap.vue`, mounted as the **Map** panel of `CouncilFinanceView.vue`.
- [x] The measure selector is built **only** from the server's `available_measures`, which is
      derived from live publications. If only a budget is published, actual expenditure is not
      offered at all; the citizen cannot read a blank as "0 % executed".
- [x] Every published figure is nullable. The map paints no-data grey and the table says
      "not published"; USD and ZWG are separate row sets and separate maps.
- [x] `ward_register_bases` containing `interim` labels the ward list provisional (D11). If the
      council has not linked its ward register, the map says so and the table still works.
- [x] The always-present ward table is the keyboard and screen-reader equivalent of the
      choropleth. Publication date, version and data cut-off are shown beside the map.
- [x] Public rows never contain a transaction, budget line or project identity, and the page says
      supplier and beneficiary identities are not part of the published record.
- [x] M7-5: the public map draws **published project locations**. `/public/finance/projects` is
      already publication-gated (a proposed or draft project is never returned), so the client adds
      only the location rule: a marker is drawn where the server released a finite longitude and
      latitude, and a ward code is never turned into a point. A project with no released location
      is listed with "no released location" instead of being dropped. The currency selector filters
      the project layer as well as the wards, so a project's dollars and shillings are never placed
      on one map together, and every amount stays in the project's own currency. When the projects
      publication is withdrawn, `available_measures` no longer carries `project_count`, the layer
      empties and the panel states that the register is not published — no code change is needed.
- [x] The public project table is the keyboard and screen-reader equivalent of the markers, using
      the same `FINANCE_PROJECT_STATUS` palette as the staff map. The legend names the statuses
      present and states that a point is a released location, not every project in the register.

### Tests and verification — 2026-11-10
```
npx vue-tsc --noEmit                      clean
npx eslint src/modules/finance             clean (mapExport.ts retains its 3 pre-existing
                                           `any` warnings for the MapLibre instance)
npx vitest run --no-file-parallelism      153 files, 1358 passed, 1 skipped, 0 failed
npm run build                             passes (vue-tsc + vite, PWA generated)
```
`src/modules/finance/__tests__/financeMap.spec.ts` pins the 20 measures, group coverage,
quantile breaks, no-data grey, circle radii (including null → minimum), status colour fallback,
the M6-1 permission presets (one per role shape, deterministic multi-role precedence, preparer
tie-break, no guessed currency), the M6-3 export provenance (year, currency, measure, breakdown,
source view, the view's `generated_at`, the D11 caveat and the project-circle measure always travel
with the sheet; a missing year says so), the public-map rules (only server-available measures
are offered, an unpublished dataset is never offered, and a blank figure is null rather than zero),
and the M7-5 project layer (a marker needs a finite released coordinate, a null/string coordinate
is not a point, the currency filter is applied, an unlocated project is never invented as a point,
and the status colour comes from the shared palette).

The PDF itself was not rendered in a browser during this slice — no authenticated local session or
live publication exists — so "the export is not blank" remains a manual check on a machine with a
real map and tiles. `preserveDrawingBuffer: true` is set, the legend is sized to its labels, and the
title/subtitle wrap rather than overflow.

### What is deliberately NOT in this slice
- **M5-5 project location picker.** Projects still carry their location from the register/import;
  clicking the map does not yet write a point. This wants a deliberate edit permission and an
  audit trail, not a convenient map click.
- **Draw/edit project footprints on the map.** The project layer renders recorded points; drawing
  a polygon remains a Projects workflow. The same permission/audit questions as M5-5 apply.
- The public map is a district-scale GeoJSON overlay, not a tile layer. At Vungu's ward count it
  is smaller than one tile and simpler to keep honest; it is not an MVT endpoint.
- The public map — wards and published project points alike — could not be live-verified locally:
  no publication rows exist, so `/api/public/finance/years` is empty. The only local year is
  `DEMO 2027 (synthetic - not a Council year)`. The server-gating rules are pinned by unit tests;
  a deployed environment with a live publication is still needed for an end-to-end check.
- **M6-4 two-role parity test.** The backend already pins department scope on the ward map
  (`finance.spatial-map.test.js`, M4-4/BLOCKER-2: a scoped officer sees only their own department,
  an unscoped officer sees both). A second integration test asserting byte-identical `wards`
  arrays for two roles with the same scope needs a disposable acceptance database, which this
  session did not have; the frontend cannot express that guarantee, because it renders whatever
  the server returns.
- Migrations 201 and 202 were applied to the local `vungu_dev` database during this slice. A
  deployed environment must still run them before the new columns/views exist there.

## Slice 1 — Finance foundation (schema, RBAC, config)
Migration `188_finance_foundation.sql` (1546 lines, 25 tables + 4 views).
- [x] `finance` schema: financial years, departments, programmes, activities, accounts (chart of accounts)
- [x] Budget lines, revisions with version history, commitments
- [x] Transaction register with stable source identifier (`source_ref`, unique per year + dataset)
- [x] Import batch / exception / row / mapping tables
- [x] Publication records
- [x] Permission catalogue + role grants, separation of duties (`finance.permission`, `finance.role_permission`)
- [x] Tenancy (row-level security) on every finance table — 22 tables via `tenancy.make_tenant`; the
      four catalogue tables (`permission`, `role_permission`, `user_permission_override`,
      `user_scope`) are deliberately classified `system`, not authority-owned
- [x] Finance roles added to `users_role_check`
- [x] `requirePermission()` middleware (`src/middleware/financePermissions.js:122`)
- [x] Financial year CRUD API + closed-year write refusal (A9)

## Slice 2 — Budget management
`src/routes/finance-budget.js`
- [x] Budget line CRUD, hierarchical accounts, unique line codes
- [x] Original vs revised amounts kept separately (A4)
- [x] Revision workflow: draft → submitted → approved/rejected, requester ≠ approver (A6)
- [x] Available balance and execution percentage (documented formulas, zero-safe)
- [x] Variance explanations (`finance.variance_explanation`)

## Slice 3 — Import and reconciliation
`src/routes/finance-imports.js`, `src/lib/spreadsheet.js`
- [x] CSV/XLSX upload, original file preserved, SHA-256 hash recorded
- [x] Column mapping profiles (configurable, alias-seeded — Council decision D7)
- [x] Preview + row-level validation
- [x] Exception queue; unmappable rows never defaulted (A2)
- [x] Idempotent commit and retry; duplicate source-id protection (A1)
- [x] Reconciliation against declared source control totals (A3), with explicit override

## Slice 4 — Publication and public portal
`src/routes/finance-publication.js`, `src/routes/finance-public.js`
- [x] Publication queue: approve → publish → withdraw, versioned
- [x] Public read API returns published rows only, no restricted fields (A7)
- [x] Public finance pages (overview, budget, revenue, expenditure, projects, documents)
      — `src/modules/finance/pages/CouncilFinanceView.vue`, route `/council/finances`
- [x] Public project panel follows the selected financial year and returns one row per project, with
      allocations/spend in another currency shown separately rather than converted or added
      (F-03/F-04; `migrations/189_finance_project_reporting.sql`, `financeApi.projects`)
- [x] A transaction cannot be linked to a budget line from another financial year; a currency
      mismatch is stored and counted, not converted (§6.4/A8; `migrations/190_finance_transaction_line_year.sql`)
- [x] Public document panel is paginated and filtered by the selected financial year, with search and
      deterministic sorting; the council name and year label come from the published authority/year
      (F-07/F-08; `migrations/191_finance_document_year.sql`, `financeApi.documents`)

## Slice 5 — Reports, exports, documents
`src/routes/finance-reports.js`, `src/routes/finance-documents.js`
- [x] Budget vs actual, variance, departmental and project reports (9 reports)
- [x] Year-on-year comparison: current year plus a selected prior year, grouped by department/account
      and currency, with prior/current/change figures and both years in the metadata and exports
      (F-06; `year_on_year` in `finance-reports.js`, comparison-year picker in `ReportsSection.vue`)
- [x] CSV / XLSX / **PDF** export with council identity, period, currency, filters
      — PDF renderer `src/lib/report-pdf.js`; the cover carries the §3.9 metadata block and a
      restricted export is marked on every page, not only in its filename
- [x] Document association with permission and visibility controls

## Slice 6 — Planning and environmental integration
`src/routes/finance-projects.js`
- [x] `finance.project_allocation` links allocations to existing project entities by their own IDs
      (`development_application`, `planning_project`, `survey_project`, `council_asset`,
      `service_desk_ticket`)
- [x] Trace: planning project → allocation → revisions → transactions → documents → actual spend (A10)
- [x] Environmental review / condition costs linked only where the existing domain supports it —
      `environmental_review` resolves to `{ exists: 'unknown', reason: 'no_single_register' }`
      rather than pretending a register exists (`finance-projects.js:51`)

## Slice 7 — Frontend surfaces
`src/modules/finance/` (ADR 0005 feature-module layout)
- [x] Admin surfaces, twelve sections behind one route (per Appendix B navigation)
- [x] Role-gated routes; backend remains the authority
- [x] Public council finance surfaces (per Appendix A layout)

## Slice 8 — Finance access administration
`src/routes/finance-users.js`, `src/modules/finance/pages/sections/AccessSection.vue`
- [x] List staff and the permissions each finance role inherits (`GET /api/finance/users`)
- [x] Read one person's role defaults, overrides, departmental scope and effective permissions
      (`GET /api/finance/users/:id/access`)
- [x] Replace role, overrides and scope in one transaction, with a written reason
      (`PUT /api/finance/users/:id/access`)
- [x] `finance.users.manage_finance_roles` enforced on every endpoint; a finance administrator
      who does not hold it is refused and the refusal is audited (F-02 / G-01 / S-01 / S-02)
- [x] Self-editing refused: an administrator cannot change their own finance access
- [x] Deny overrides win, expired overrides do not count, and the effective set is computed by the
      server rather than the screen
- [x] Before/after role, overrides, scope and effective permissions written to the audit trail with
      the reason — no email or other account PII copied into it
- [x] `AccessSection.vue`: list, search, role picker, scope picker, per-permission inherit/grant/deny,
      effective count and a required reason; the section is hidden without the permission

## Out of scope (specification §1.3) — must stay out
- [x] No general-ledger replacement
- [x] No payment execution, bank transfer or payroll
- [x] No procurement / tendering / contract award
- [x] No automatic legal-compliance determination
- [x] No publication of confidential personal, supplier or commercially sensitive data

## Council decisions blocking completion
See `COUNCIL-DECISIONS.md`. D1–D10 are all still open; every one of them is a configurable seam
left empty rather than filled with a plausible value. The system is **not** production-approved:
D10 (UAT sign-off and a demonstrated restore test) has not been done.

## Blockers not owned by the finance module

1. **The acceptance harness cannot seed the Tsamba sample**, so five GIS/stands suites
   (`gms.acceptance`, `gms.editing`, `geometry-validation`, `soft-delete`, `stand-allocation`)
   cannot run. `scripts/seed-tsamba.js` calls the real inbound handler, which writes
   `revenue_link.account_link`; migration 172 made that table tenant data with
   `authority_id NOT NULL DEFAULT app.authority_id()`, and `handleInbound` deliberately runs on the
   unscoped system connection (`systemOf`), where `app.authority_id()` is NULL. So the insert fails
   with `23502`. This is a **production** bug, not only a seeding one: any real ERP `AccountLinked`
   event has failed the same way since migration 172 landed. It needs a decision about how the ERP
   feed states which council an event belongs to — `land.parcel` is classified `national` and
   carries no `authority_id`, so the authority cannot be derived from the parcel.
   Workaround meanwhile: `npm run test:db -- test` re-runs the suites without reseeding, which is
   how the finance acceptance run above was obtained.
2. **Two pre-existing type errors** in `src/views/QGISMapView.vue` (MapLibre `addLayer` argument
   types) fail `npm run build`, which runs `vue-tsc --noEmit` before `vite build`.
3. **Six pre-existing backend unit suites** fail for unrelated reasons: `payments.applicationfee`,
   `permit-applications.pending-payment`, `context-parcels`, `layer-catalogue`, `style-extractor`,
   `surveypro-import`. None of them reference the finance module.

## Run-through of the live app — 2026-11-05

Backend (`npm run dev`, :3000) and frontend (Vite, :5174) started together and driven end to end
as `demo.finance-admin@vungu.test`:

- Created financial year **DEMO 2027**, department `DEMO-ENG`, two accounts and three budget
  lines (two USD, one ZWG) through the real API. This demo data is in the `vungu_dev` database;
  every row is labelled `DEMO`/`(demo)`. Remove it before any demonstration to Council.
- `/finance` renders the twelve-section workspace. The overview shows USD and ZWG as **separate
  sections** with the banner "…never added together. No exchange rate is applied", and the
  departmental table states that a department budgeting in two currencies appears twice.
- `/council/finances` (no sign-in) correctly reports "The council has not published financial
  information yet", because nothing has been published — the public API returns published rows
  only (A7).
- Reports & exports offers **CSV / Excel / PDF**; the PDF downloaded through the UI button is a
  valid 2-page document with the §3.9 cover block.
- No console or page errors on any finance surface.

One defect was found by looking at the rendered PDF and fixed: in a wide report the column
shrink was wrapping amounts mid-number (`400000.00` drawn as `400000.0` + `0`). A numeric
column's floor is now its widest *amount* rather than its heading, headings wrap instead, and
`test/finance-pdf.test.js` pins it.

## Next
- Blocker 1 needs a Council/architecture decision before the full acceptance gate can be green.
- Slice 4 and Slice 8 are both exercised now: the 2026-11-06 evening pass took a budget through
  approve → publish onto `/council/finances`, and drove `/finance?section=access` in the browser —
  the editor renders the earlier API-granted scope and deny override, with the required reason
  field gating Save.
- `vite.config.run.ts` (polling watcher for inotify-exhausted workstations) is still present and
  untracked; it says TEMPORARY in its header — delete it or commit it deliberately.
