# Production-readiness audit — finance and GIS-finance capability

**Produced** 2026-11-08. **Type** read-only staff-engineer audit. The only write this audit made is
this file, plus one frontend test run and read-only `SELECT`s against `vungu_dev`. No source was
modified, nothing was committed, no data was created or seeded.

**Repositories inspected**
- Frontend `/home/theo-madzinaga/Documents/Manicipal-drums-frontend` — `src/modules/finance/`
  (10,443 lines across 26 files; 15 workspace sections + the public portal view), tests in
  `src/modules/finance/__tests__/`.
- Backend `/home/theo-madzinaga/Documents/Manicipal-drums-backend-3` — `src/routes/finance-*.js`
  (6,059 lines, 10 files), `src/middleware/`, migrations 188–199, tests in `test/` and
  `src/routes/__tests__/`.
- Database `vungu_dev` on localhost (read-only).

**A note on the stated bar.** The brief cites `VUNGU_RDC_CLAUDE_CODE_PROMPT.md` "§12 constraints and
§14 test list (20 items)". That file (38 lines) contains no numbered §12 or §14 and no 20-item test
list; `docs/gis-finance/ARCHITECTURE-ASSESSMENT.md:210` refers to a 15-phase prompt that is not in
either repository. The traceability table below is therefore built against the artefacts that *are*
canonical and in-repo: the baseline specification's **§13 test types** and **§13.1 eight critical
scenarios**, its **§15 fourteen acceptance criteria**, and the gap note's **A1–A10**
(`docs/finance/2026-11-05-finance-impact-gap-note.md`). The substitution is stated rather than
papered over.

---

## 1. Executive verdict

**Not production-grade. Three blockers.**

The engineering quality of this module is genuinely high and unusual: measures are computed once in
SQL views and never re-implemented, money is `numeric(18,2)` formatted digit-by-digit in the browser
without passing through a JavaScript float, currencies are structurally incapable of being summed
together, the closed-year guard is a database trigger, every mutating finance route carries a
permission `preHandler`, there is no string-interpolated SQL anywhere in 6,059 lines of finance
routes, the separation-of-duties invariant is asserted by the migration that seeds the grants, and a
timed backup/restore drill with zero mismatches is already on record
(`../Manicipal-drums-backend-3/docs/audit/BACKUP-RESTORE-EVIDENCE.md:15`). The honest-state
discipline — "unlocated" as a first-class state, `NULL` rather than `0` for undefined execution,
`ward_status='unlinked'` rather than an invented polygon — is better than most production finance
systems.

What stops it shipping is three control failures, each of which has a test suite that asserts the
opposite property and does not actually cover the hole:

1. **BLOCKER-1 — the public finance API's confidentiality depends on the caller being anonymous.**
   Four of the eight `/api/public/finance/*` endpoints carry no publication predicate of their own
   and rely entirely on the `published_select` row-level-security policy. That policy is a *second
   permissive* policy OR'd with `tenant_select`, so any authenticated session whose
   `users.authority_id` is Vungu — including a `building_inspector`, `planning_clerk`, `surveyor` or
   `gis_officer`, none of whom holds a single finance permission — reads the council's **unpublished
   draft budget**, **un-approved proposed projects**, and **public-classified documents from
   withdrawn publications** through the unauthenticated public route. Acceptance check **A7** is
   proven only for anonymous callers; every public-exposure test in the suite is anonymous.

2. **BLOCKER-2 — separation of duties can be dissolved through the live access API.** The migration
   asserts that no *role* holds both an approval and a publication permission, but
   `PUT /api/finance/users/:id/access` writes arbitrary `grant` overrides with no equivalent check.
   One holder of `finance.users.manage_finance_roles` — by default the technical administrator, the
   role designed to hold no financial authority — can give a single officer
   `finance.budget.approve` **and** `finance.publication.publish`, plus the restricted-data
   permissions. The Permissions screen tells the officer this cannot happen.

3. **BLOCKER-3 — a read-only auditor can withdraw financial evidence, and the stated reason is
   discarded.** `DELETE /api/finance/documents/:id` is gated by `finance.document.view`, a *read*
   permission held by `auditor`, `publisher`, `budget_officer`, `dept_head` and
   `finance_committee`. The route's own test suite asserts "an auditor holds no write permission at
   all". The required `reason` (minLength 5) is written to neither the row nor the audit details.

Beyond the blockers: eleven MAJOR findings, chiefly a spatial-attribution integrity hole that lets
ward figures exceed the line they attribute, a public execution percentage that states 0% as fact
where actuals simply are not published, a false "your finance setup is incomplete" banner on every
workspace load, a choropleth whose ward selection is mouse-only in the intended production state,
and a backend test configuration that writes synthetic finance rows into the live development
database (two such rows are in `vungu_dev` right now, one of them *published* to the public portal).

Independently of defects, **M9's exit criteria cannot be met until the Council supplies data**:
`admin.authority_ward` has 0 rows, so no ward polygon can be shaded; there are 4 budget lines (3
drafts and one test artefact), 1 transaction, 1 project with no location, and 0 spatial allocations.
That is the correct state — the module refuses to guess — and it must not be "fixed" by seeding.

---

## 2. Findings, severity-ranked

Each finding: the defect, a failure scenario with inputs and state, file:line evidence, and the fix
sized as an implementation task.

### BLOCKER-1 — `/api/public/finance/*` returns unpublished finance data to any authenticated council session

**Defect.** `finance-public.js` deliberately contains "no authorisation logic" and "no WHERE clause
… that an unpublished row depends on"
(`Manicipal-drums-backend-3/src/routes/finance-public.js:5-23`), delegating confidentiality to the
`published_select` policies. Those policies are created with `CREATE POLICY … FOR SELECT` alongside
`tenant_select`, and PostgreSQL OR's permissive policies. `tenant_select` is
`app.is_platform() OR authority_id = ANY (app.visible_authorities())`
(`migrations/167_tenant_rls.sql:36`, re-created in
`migrations/194_finance_public_query_performance.sql:92-104`), so for a signed-in member of the
authority **every** row of these tables is visible, published or not. Four public endpoints then
have no publication filter in their own SQL:

- `GET /public/finance/overview` sums `finance.budget_line` directly with no `status` predicate —
  `src/routes/finance-public.js:107-124`
- `GET /public/finance/budget` reads the **staff** view `finance.v_budget_line_performance`, which
  has no publication join — `src/routes/finance-public.js:202-233`; view at
  `migrations/188_finance_foundation.sql:796-870`
- `GET /public/finance/projects` reads `finance.v_project_performance` with no status/publication
  predicate — `src/routes/finance-public.js:359-404`; view at
  `migrations/188_finance_foundation.sql:901-947`
- `GET /public/finance/documents` filters only `visibility='public' AND deleted_at IS NULL` —
  `src/routes/finance-public.js:432-460`

`migration 197` narrowed `published_select` so another *council's* staff lose cross-council rows
(`migrations/197_published_select_public_session_only.sql:40-167`) and its header explicitly accepts
that "a council's own staff: nothing [changes]. They already see their council's rows through
tenant_select" (`:23-25`) — which is true and harmless on the *staff* surface, where
`requirePermission` guards every route, and is the leak on the *public* surface, where nothing does.

**Who is affected.** `migration 154_authority_row_level_security.sql:36-47` backfills and then
trigger-defaults `users.authority_id` to VUNGU for `admin, planner, planning_clerk,
building_inspector, eo, env_officer, surveyor, gis_officer`. Of those, `planning_clerk`,
`building_inspector`, `surveyor` and `gis_officer` appear nowhere in
`finance.role_permission` (`migrations/188_finance_foundation.sql:1107-1229`) — they hold **zero**
finance permissions.

**Failure scenario.** Finance staff enter the 2027 draft budget; nothing is submitted, approved or
published. A building inspector signs in normally (so the `vungu_at` cookie is present) and opens
`/council/finances`, or simply requests:

```
GET /api/public/finance/budget?financial_year_id=<2027-id>
Cookie: vungu_at=<the inspector's ordinary session>
```

`optionalAuth` (`src/middleware/jwtAuth.js:326-334`) authenticates them, `setUser`
(`src/middleware/jwtAuth.js:286`) puts them in the async-local store, `tenantPool` issues
`SET ROLE vungu_app` plus `app.authority_id='1'`
(`src/lib/tenancy.js:34-39`), `tenant_select` matches, and the response is **200** carrying every
draft line's code, description, department, original and revised amount — the pre-Council budget.
The same session gets proposed (un-approved) projects from `/public/finance/projects`, and documents
classified public whose `documents` publication was withdrawn last week. The staff route
`/api/finance/budget-lines` correctly answers 403 to the same person.

**Evidence that this is untested.** Every public-exposure assertion uses an unauthenticated
`app.inject` — `src/routes/__tests__/finance.security.test.js:337-399` ("administrative finance
routes are closed to anonymous callers", "an unpublished year does not appear on the public portal",
"unpublished budget and transaction data are not visible publicly"), and
`src/routes/__tests__/finance.acceptance.test.js:870` ("nothing is public before it is published").
`test/finance-cross-tenant.test.js:105` tests *another* council's staff, never the publishing
council's own non-finance staff.

**Fix (≈1 day).** Do not weaken RLS. Make the public surface state its own contract:
1. Add the publication predicate to the four handlers' SQL, so the route no longer depends on who
   is asking: `budget_line.status='published'` + an `EXISTS` on a live `budget` publication;
   `project.status IN (…)` + a live `projects` publication; `document` + a live `documents`
   publication; and route `/public/finance/budget` through a new
   `finance.v_published_budget_line` that carries the publication join the way
   `v_published_transaction` already does (`migrations/188_finance_foundation.sql:951-979` is the
   pattern to copy).
2. Alternatively or additionally, register the public routes on a Fastify scope that forces the
   anonymous session (clear `app.authority_id` for the connection) regardless of the cookie. This is
   the cheaper, broader fix and makes the docstring's claim true.
3. Add the missing tests: for each public endpoint, assert the same body for an anonymous caller and
   for a signed-in `building_inspector`, and that neither contains an unpublished id.

---

### BLOCKER-2 — separation of duties can be dissolved through `PUT /api/finance/users/:id/access`

**Defect.** The invariant is asserted over role defaults only:
`migrations/188_finance_foundation.sql:1236-1256` raises if any `finance.role_permission` row set
gives one role both `is_approval` and `is_publication`, and if `admin` holds any approval,
publication or restricted permission. The *effective* permission set is role defaults **plus**
`finance.user_permission_override` grants, minus deny
(`src/middleware/financePermissions.js:52-69`). The write path for those overrides —
`src/routes/finance-users.js:179-287` — validates only that each `permission_code` exists in the
catalogue (`:205-218`), that there are no duplicates (`:219-226`), that departments belong to the
council (`:228-241`), that the account is active (`:243-248`) and that the caller is not editing
their own access (`:213-216`). It performs **no** check on the resulting combination. A grep of the
whole backend finds `is_approval` / `is_publication` / `is_restricted` referenced in exactly one
place outside the migration, and it is a read:
`src/routes/finance-config.js:69`.

**Failure scenario.** The IT administrator (role `admin`, the only seeded holder of
`finance.users.manage_finance_roles`, `migrations/188_finance_foundation.sql:1225`) sends:

```
PUT /api/finance/users/<officer-id>/access
{ "role": "finance_committee",
  "reason": "cover during the publisher's leave",
  "overrides": [ { "permission_code": "finance.publication.publish", "effect": "grant" },
                 { "permission_code": "finance.transaction.view_counterparty", "effect": "grant" },
                 { "permission_code": "finance.report.export_restricted", "effect": "grant" } ] }
```

The request succeeds. That officer now holds `finance.budget.approve`, `finance.revision.approve`,
`finance.publication.approve` **and** `finance.publication.publish`, and can approve a supplementary
allocation and publish it to the public portal unaided, plus export supplier identities. Nothing
refuses it, no alert fires, and the change is audited only as a `FIN_PERMISSION` event whose
before/after the auditor must read and reason about. Two administrators can give each other the same
set, since only *self*-edit is blocked. Meanwhile `PermissionsSection.vue:113-118` tells every
officer: "No role holds both an approval and the publication permission. That invariant is asserted
by the migration that seeds the grants: if an edit ever gave one role both, the migration fails
rather than quietly weakening the control."

**Fix (≈half a day).** In `finance-users.js`, after computing `after = await readAccess(...)` but
inside the transaction, re-read the effective set and refuse (409 `separation_of_duties`) when it
contains both an `is_approval` and an `is_publication` permission, when the target's role is `admin`
and the set contains any `is_approval`/`is_publication`/`is_restricted` permission, and when the
target role is `auditor` and the set contains any write permission. Mirror it as a database
constraint: a `BEFORE INSERT OR UPDATE` trigger on `finance.user_permission_override` that resolves
the effective set and raises — so the control survives a future route as well. Add a permission test
per branch. Then make `PermissionsSection.vue:113-118` true, or soften the claim.

---

### BLOCKER-3 — a read-only auditor can withdraw a financial document, and the reason is thrown away

**Defect.** `DELETE /api/finance/documents/:id` is guarded by `...canView`, i.e.
`requirePermission(fastify, 'finance.document.view')` —
`Manicipal-drums-backend-3/src/routes/finance-documents.js:294-296`, shorthand defined at
`:77`. `auditor` holds `finance.document.view`
(`migrations/188_finance_foundation.sql:1208`), as do `publisher` (`:1197`), `budget_officer`
(`:1176`), `dept_head` (`:1189`) and `finance_committee` (`:1193`). The handler's schema requires
`reason` (`:297-301`) but the `UPDATE` writes only `deleted_at`/`deleted_by`
(`:304-309`) and the route sets no `request.auditDetails`, so the stated reason is discarded
entirely: it reaches neither the row nor `public.admin_audit_event.details`
(`src/middleware/auditLog.js:185-205` merges only what a route attaches).

**Failure scenario.** An external auditor is granted the `auditor` role for a statutory audit. They
send `DELETE /api/finance/documents/<invoice-id>` with
`{"reason":"duplicate"}`. The invoice supporting a 250,000 USD expenditure transaction is
soft-deleted: it stops being listed (`:189-238` filters `deleted_at IS NULL`) and stops being served
(`:243-246`), and the transaction it evidenced now has no document. The audit trail records a
`FIN_DOCUMENT` / `DELETE` row with a path and a 200, and no reason. Meanwhile
`src/routes/__tests__/finance.acceptance.test.js:275` asserts "an auditor holds no write permission
at all" — a property this route breaks.

**Fix (≈2 hours).** Introduce `finance.document.withdraw` in the catalogue
(`migrations/188_finance_foundation.sql:1054-1088` pattern), grant it to `finance_admin`,
`finance_officer` and `dept_head` only, re-point the route's `preHandler` at it, persist the reason
(a `withdrawn_reason text` column, or an `finance.document_event` row), set
`request.auditDetails = { reason, before, after }`, and extend the auditor test to walk every
mutating verb on every finance route rather than a sample.

---

### MAJOR-1 — an approved reduction revision is not re-checked against approved spatial allocations

**Defect.** `finance.spatial_allocation_guard()` caps the cumulative approved split at the subject's
canonical total **at approval time only**:
`migrations/198_finance_spatial_allocation.sql:175-208`, with the cap read from
`v_budget_line_performance.revised_amount` (`:178-180`) and the refusal at `:204-207`. Nothing
re-validates when `revised_amount` later falls. The revision route checks only that the revised
allocation does not go below zero
(`src/routes/finance-budget.js:437-447`) and makes no reference to `spatial_allocation` — a grep of
`finance-budget.js` and `finance-projects.js` for `spatial_allocation` returns nothing.
`v_budget_ward_attribution` then computes the remainder as a bare subtraction:
`(p.revised_amount - split_total.split_total)` — `migrations/199_finance_ward_performance.sql:71-82`.

**Failure scenario.** Line `WATER-01`, revised 100,000 USD. Two splits are approved with recorded
methodology: ward 12 → 60,000, ward 15 → 40,000. In March the Council approves a reduction revision
of −50,000 (approved by a second officer, so every existing control passes). Revised is now 50,000.
`GET /api/finance/map/wards` returns ward 12 = 60,000 and ward 15 = 40,000 — **100,000 attributed
against a 50,000 line** — plus an `unallocated_remainder` row of **−50,000**. The choropleth shades
two wards at twice their true allocation, the ward panel's execution percentages are computed against
inflated budgets, and the "what the map cannot place" card shows a negative amount. Nothing flags it.

**Fix (≈1 day).** Add a `BEFORE UPDATE` statement-level check (or an `AFTER` trigger on
`finance.budget_revision` transitioning to `approved`) that refuses the revision when
`sum(approved spatial_allocation.amount)` for the line and currency would exceed the new revised
amount, with a message naming the splits to withdraw first. Mirror it in the revision-approve route
as a 409 `spatial_allocations_exceed_revised` listing the allocation ids, so the officer is told what
to do rather than being blocked by a trigger. Surface a non-negative-remainder assertion in
`v_budget_ward_attribution` (a `GREATEST(…, 0)` would hide the fault — report it as an exception row
instead). Add tests for the reduce-after-split path in
`test/finance-spatial-allocation.test.js` (which today covers only the approve-time cap, `:234`).

---

### MAJOR-2 — the public budget page states "0% executed" as a fact when actuals are not published

**Defect.** `v_budget_line_performance.actual_amount` is `COALESCE(sum(...), 0)` over
`finance.transaction` (`migrations/188_finance_foundation.sql:805-816, 836`), and the view is
`security_invoker`, so under an anonymous session the `actuals` CTE sees only transactions admitted by
`published_select` — which requires a live `revenue`/`expenditure` publication
(`migrations/197_…:103-113`). `execution_percentage` is `NULL` only when *revised* is zero
(`:847-851`), never when actuals are merely invisible. `/public/finance/budget` serves
`actual_amount`, `available_excluding_commitments`, `execution_percentage` and `variance` straight
from that view — `src/routes/finance-public.js:215-217`.

**Failure scenario.** The Council publishes the `budget` dataset in April and has not yet published
`expenditure`. A citizen opens `/council/finances` → Budget. Every line shows **Actual 0.00**,
**Execution 0%**, **Available = the full revised amount** and **Variance = the full revised amount**.
The portal is stating, as published council information with a provenance block attached, that the
council has spent nothing — when in truth the spend simply is not published. This is the exact
failure mode the module elsewhere goes to great lengths to avoid
(`migrations/188_finance_foundation.sql:846` — "Undefined, not zero and not infinity").

**Fix (≈half a day).** Either (a) have `/public/finance/budget` select only the budget columns
(`original_amount`, `approved_adjustments`, `revised_amount`) unless an `expenditure`/`revenue`
publication is live for the year, replacing the rest with `null` and a stated reason; or (b) add a
`actuals_published boolean` to the public payload and make `CouncilFinanceView.vue` render "not
published" rather than a figure. (a) is safer. Add a test: publish `budget` only, assert the public
budget rows carry no actual/execution/variance figure.

---

### MAJOR-3 — the workspace tells every officer, on every load, that the council's finance setup is incomplete

**Defect.** `boot()` awaits identity, then awaits reference data
(`src/modules/finance/pages/FinanceWorkspace.vue:214-222`). The template gates the body on
`store.loadingIdentity` only (`:272`), so the moment identity resolves the body renders while the
four reference calls are still in flight. `needsSetup` is derived from array lengths with no
loading guard (`src/modules/finance/stores/finance.ts:94-99`), and the banner at
`FinanceWorkspace.vue:301-316` fires on `store.needsSetup.any`.

**Failure scenario.** A finance officer on a 3G link opens `/finance`. Identity returns in 300 ms;
`financialYears()`, `departments()`, `accounts()` and `programmes()` take another 2–4 s. For those
seconds the officer reads, in a prominent panel: "**The council's finance setup is incomplete.** No
financial year has been created. No departments (votes) have been entered. The chart of accounts is
empty." — with buttons offering to go and create them. On a council that has a year, 14 votes and a
3,000-line chart of accounts. The same false-empty applies inside
`FinancialYearsSection.vue:237` ("`v-if="sorted.length === 0"`") and the four `fin-empty` blocks in
`ClassificationsSection.vue:433, 526, 636, 747`; neither section has any loading state
(grep for `loading` in both returns 0 hits).

**Fix (≈3 hours).** Gate the banner and the three sections' empty states on
`!store.loadingReference`; render the existing `fin-loading` `role="status"` line while it is true
(the pattern is already in `FinanceOverviewSection.vue:139`). Add a store test that `needsSetup` is
not asserted while `loadingReference` is true.

---

### MAJOR-4 — ward selection on the finance map is mouse-only in the intended production state (WCAG 2.1.1, 1.4.1)

**Defect.** The only ward-selection path on the map is a maplibre click handler —
`src/modules/finance/pages/sections/MapSection.vue:205-209`. The map container is a plain `div` with
an `aria-label` and no `role`, no `tabindex`, no keyboard handler (`:287`). The keyboard-reachable
alternative — the ward table — is conditioned on the register being **unlinked**:
`v-if="!linked && wardRows.length > 0"` (`:404`). So once Council decision D11 closes and
`admin.authority_ward` is populated — the intended production state — the table disappears and the
choropleth is the sole interface. Even in the unlinked state the table is not operable: the rows are
`<tr … @click="selectWard(w.ward_code)">` (`:413-414`) with no `tabindex`, no `role="button"` and no
`@keydown.enter`.

**Failure scenario.** Council records its 19 wards. An auditor who navigates by keyboard, or any
officer using a screen reader, opens Finance map. They can Tab to the measure select, the currency
select and Refresh, then nothing. The 11-field ward panel, the per-ward budget lines and the
drill-through to Budget are unreachable, and the measure itself is conveyed only by polygon fill —
`aria-label="Ward choropleth of the selected finance measure"` is the whole of what a screen reader
is told. This is a 2.1.1 (Keyboard) failure on the section's primary interaction and a 1.4.1 (Use of
Colour) failure on its primary output.

**Fix (≈half a day).** Render the ward table **always**, not only when unlinked, as the map's
accessible equivalent (it already carries ward, status, budget, actual and execution). Make its rows
real controls: a `<button>` in the first cell, or `tabindex="0" role="button"` plus
`@keydown.enter/@keydown.space`, with `aria-pressed` for the selected row. Add `scope="col"` to the
`<th>`s here and in the other `ins-table` headers in this file. A keyboard test in
`financeMap.spec.ts` (currently pure-logic only) would pin it.

---

### MAJOR-5 — the transaction-register report truncates silently at 100,000 rows

**Defect.** `buildReport`'s `transaction_register` query ends `LIMIT 100000`
(`Manicipal-drums-backend-3/src/routes/finance-reports.js:330`) and nothing in the file sets or
reports a truncation flag (a grep for `truncat` in `finance-reports.js` returns nothing; the
spreadsheet reader has one, `src/lib/spreadsheet.js:145-147`, so the concept exists in the codebase).
The same `built` object feeds the screen (`:444`), the CSV, the XLSX and the PDF (`:486-560`).

**Failure scenario.** A medium council posts 140,000 transactions in a year. The finance officer
exports the transaction register as the reconciliation attachment to the annual accounts. The CSV
contains 100,000 rows ordered by `txn_date, id`, the provenance block states the full year, and
there is no indication that 40,000 rows — the last ~3.5 months — are absent. The register does not
reconcile, and the reason is invisible in the artefact.

**Fix (≈3 hours).** Select `LIMIT 100001`, set `truncated: rows.length > 100000`, trim to 100,000,
and (a) refuse the export with 409 `report_too_large` naming a narrower date range, or (b) write
`TRUNCATED — n of m rows` into the provenance block of all three formats and the screen banner.
(a) is the honest default for a register that must reconcile. The PDF builder already proves metadata
rows survive export (`test/finance-pdf.test.js:43`), so the test shape exists.

---

### MAJOR-6 — four consequential acts carry no structured before/after in the audit trail

**Defect.** `request.auditDetails` is the only route-level channel into
`admin_audit_event.details` (`src/middleware/auditLog.js:185-205`). It is set in 11 places
(`grep -rn auditDetails src/routes/finance-*.js`). It is **not** set by:

- `POST /finance/budget-lines/:id/approve` — `src/routes/finance-budget.js:334-354`
- `POST /finance/projects/:id/approve` — `src/routes/finance-projects.js:381-409`
- `POST /finance/financial-years/:id/close` and `/reopen` — `src/routes/finance-config.js:196-252`
- `PATCH /finance/documents/:id/visibility` — `src/routes/finance-publication.js:440-466`
- `DELETE /finance/documents/:id` — `src/routes/finance-documents.js:294-316` (see BLOCKER-3)

The gap note requires "structured before/after on approvals, publishes, imports and access changes".
Revision approvals, publication decisions, spatial-allocation decisions, import commits and access
changes do carry it; **budget-line and project approvals — the two acts that make an allocation
official — do not**, and neither does the act of making a document public.

**Failure scenario.** Six months later a committee asks who authorised the approval of budget line
`ROADS-04` and at what amount. `admin_audit_event` has a `FIN_BUDGET` / `high` row with
`POST`, `/api/finance/budget-lines/<id>/approve`, `200`, the actor and the timestamp — and
`details = {"routerPath":"/finance/budget-lines/:id/approve"}`. The amount approved must be
reconstructed from `budget_line.original_amount` as it stands *today*, after any revisions. The same
query for a *revision* approval returns the before/after amounts directly
(`src/routes/finance-budget.js:539-543`).

**Fix (≈3 hours).** Add `request.auditDetails = { before: {status, amount, currency}, after: {...} }`
to the five routes, copying the shape at `finance-budget.js:539-543`. Extend
`finance.acceptance.test.js:1743` ("the finance audit trail records what was done and what was
refused") to assert a non-empty `details.before`/`details.after` for every `critical`- and
`high`-severity finance event.

---

### MAJOR-7 — three DB-writing finance suites are outside the integration list, so `npm test` writes synthetic finance rows into the live development database

**Defect.** `scripts/test-suites.js` claims to be "the single source of truth" so that "a suite
cannot be excluded from `npm test` while some other command forgets to run it"
(`Manicipal-drums-backend-3/scripts/test-suites.js:8-12`). Its `integration` list
(`:38-47`) contains `finance.acceptance.test.js` but **not** `finance.security.test.js`,
`finance.workflow.test.js` or `finance.map.test.js`. `jest.config.js:27` ignores only
`[...integration, ...live]`, so those three run in a bare `npm test`. All three build a real app
against `process.env.APP_DATABASE_URL || process.env.DATABASE_URL`
(`test/helpers/buildApp.js:76-79`) after `require('dotenv').config()` at `test/helpers/buildApp.js:1`,
and write fixtures through `systemOf(app.pg)` (e.g. `src/routes/__tests__/finance.map.test.js:44-52`,
which inserts a financial year directly). `.env:2` points `DATABASE_URL` at `vungu_dev`.

**Failure scenario — already realised.** Read-only `SELECT`s against `vungu_dev` on 2026-11-08
return:

```
line:E2E-T1:published:USD:150000.00      -- a test artefact, status 'published'
proj:VERIFY-202611081833:approved
year:DEMO 2027:open
pub:budget:published
pub:expenditure:published
```

A published `budget` publication plus a `published` budget line means the development instance's
public transparency portal is currently serving **US$150,000 of synthetic data as published Vungu
RDC finance**. A developer or a demo viewer cannot tell it from real. This matches the recorded
experience that "a jest run makes the live app show synthetic WF* data".

**I did not run the backend suite**, per the brief. If a backend run is ever judged essential, the
risk is exactly the above: new synthetic years, votes, accounts, budget lines, transactions,
projects, publications and documents land in `vungu_dev`, some of them in `published` state, and the
`TAG`-and-remove `afterAll` in each suite only cleans what that run created — a crashed or
interrupted run leaves rows behind permanently. The safe form is
`DATABASE_URL=postgresql://…/vungu_acceptance_test npm run test:db`, which is what
`finance.security.test.js:17-19` itself documents.

**Fix (≈2 hours).** Move the three suites into `integration` in `scripts/test-suites.js` with their
prerequisites documented; add a hard guard at the top of `test/helpers/buildApp.js` that throws when
the resolved database name does not match `/test|acceptance/i` unless
`ALLOW_DEV_DB_TESTS=1` is set; then clean the five artefact rows out of `vungu_dev` by hand (a
separate, explicitly approved task — not part of this audit).

---

### MAJOR-8 — `finance.spatial_allocation` is outside the closed-year trigger set, and project splits have no year check at all

**Defect.** `assert_year_open()` is attached to `budget_line, budget_revision, transaction,
commitment, import_batch, project_allocation, project_transaction`
(`migrations/192_finance_closed_year_project_links.sql:46-56`). `finance.spatial_allocation`, added
six migrations later, is not in that list. Its own guard checks the year for a `budget_line` subject
(`migrations/198_finance_spatial_allocation.sql:117-122`) but the `project` branch
(`:124-137`) performs **no** year check — correctly, since a project spans years — and the route's
year check (`src/routes/finance-spatial.js:177-181`) reads `subject.year_status`, which for a project
can only come from its allocations.

**Failure scenario.** The 2026 year is closed and the accounts signed. A finance officer records a
spatial split of project `CAP-07` across three wards and an approver approves it. Both succeed. The
ward attribution for 2026 — and therefore every ward figure in the signed-off accounts' geography —
changes after the year was closed, with no database-level refusal and nothing in the closed-year
test (`finance.acceptance.test.js:1632`, "A9: a closed financial year accepts nothing, through the
API or around it") covering the table.

**Fix (≈3 hours).** Add `spatial_allocation` to the trigger array in a new migration, with the
subject-resolution branch the guard already has (budget line → its year; project → the years of its
funding allocations, refusing if any is closed). Extend the A9 test to iterate every table in the
trigger array so a future table cannot be forgotten the same way.

---

### MAJOR-9 — maplibre-gl and the whole basemap are eagerly bundled into the finance workspace chunk

**Defect.** `FinanceWorkspace.vue:43` statically imports `MapSection.vue`, which statically imports
`maplibre-gl` (`src/modules/finance/pages/sections/MapSection.vue:23`) and
`@/map/vunguBasemap` (`:25`) — the 24-layer basemap engine. The route itself is lazy
(`src/router/index.ts:62`), so the cost lands on every finance user on first entry to `/finance`,
including an `auditor` or `publisher` who has no reason to open the map.
`node_modules/maplibre-gl/dist/maplibre-gl.js` is 788 KB unminified.

**Failure scenario.** The product's stated budget is "load under 2 s"
(`docs/gis-finance/…`/`METRICS.md` bar cited in `CLAUDE.md`). On the target network, the finance
chunk now carries the map engine plus the basemap style module before the Overview section can
paint, for every one of the eight finance roles.

**Fix (≈1 hour).** `const FinanceMapSection = defineAsyncComponent(() => import('./sections/MapSection.vue'))`
in `FinanceWorkspace.vue`, with the existing `fin-loading` `role="status"` as the suspense fallback.
Verify with `npx vite build` and compare the finance chunk size before and after.

---

### MAJOR-10 — the ward and line performance views aggregate the whole transaction, commitment and revision tables per request; no index on any `ward_code`

**Defect.** `v_budget_line_performance`'s three CTEs group by `budget_line_id` with no year
predicate (`migrations/188_finance_foundation.sql:797-822`): `actuals` scans and hash-aggregates
**all** of `finance.transaction` before the outer `WHERE` on `financial_year_id` can apply, because
the grouping key does not carry the year. `v_budget_ward_attribution` sits on top of that view and is
`UNION ALL`'d three times (`migrations/199_finance_ward_performance.sql:35-82`), i.e. the whole
aggregation is evaluated three times per ward query; `v_ward_performance` then joins it to a second
full aggregate of `finance.transaction` (`:110-120`) and re-reads `admin.authority_ward` per output
row via a correlated `EXISTS` (`:131-137`). All of it runs under `security_invoker` with the
RLS predicates attached.

No index exists on `finance.budget_line (ward_code)`, `finance.transaction (ward_code)` or
`finance.project (ward_code)` — the full index inventory for migrations 188–191 and 198–199 is
`grep -n "CREATE.*INDEX" migrations/188*.sql migrations/189*.sql migrations/19*.sql`, and
`idx_spatial_allocation_subject` / `idx_spatial_allocation_authority`
(`migrations/198_finance_spatial_allocation.sql:72-75`) are the only new ones. The ward filter added
to `/finance/budget-lines` (`src/routes/finance-budget.js:94`) and the ward drill-down in
`MapSection.vue:103-105` therefore both do a sequential scan.

**Failure scenario.** Five years of history at 120,000 transactions a year. A finance manager opens
Finance map and switches currency, which calls `GET /api/finance/map/wards`
(`src/routes/finance-spatial.js:357-368`). The query aggregates ~600,000 transaction rows four times
(three `UNION ALL` branches through `v_budget_line_performance` plus the ward `actuals` CTE) under
RLS. With the database's 30-second `statement_timeout`, the likely outcome is a 500 with SQLSTATE
57014 — the same failure mode migration 194 was written to fix for the public portal, re-created in
the ward layer.

**Fix (≈1–2 days).** (a) Add `CREATE INDEX … ON finance.transaction (financial_year_id, ward_code)`,
`finance.budget_line (financial_year_id, ward_code)`, `finance.project (ward_code)`. (b) Add
`financial_year_id` to the grouping keys of the `actuals`/`commitments`/`adjustments` CTEs so the
year predicate pushes down (it is already on `transaction` since migration 190 and on
`project_allocation` since 189). (c) Benchmark `/finance/map/wards` and `/public/finance/budget` at
100k, 500k and 1M transactions against the 194 harness and record the figures in
`docs/audit/PERFORMANCE-TEST-EVIDENCE.md`; if the ward view still misses the budget, make
`v_ward_performance` a materialised view refreshed on the existing `pg_notify` change hook rather
than weakening RLS.

---

### MAJOR-11 — import validate and commit are row-by-row inside one transaction, with a 200,000-row ceiling

**Defect.** `POST /finance/imports/:id/validate` inserts one `import_row` plus one row per issue per
source row inside a single transaction (`src/routes/finance-imports.js:767-780`), and
`POST /finance/imports/:id/commit` performs two to three sequential round trips per valid row inside
a single transaction (`:1035-1155`). The row ceiling is the `import.max_rows` setting, default
**200,000** (`:376`). There is no batching, no `COPY`, no background job and no progress endpoint.

**Failure scenario.** The Council supplies a 120,000-row annual actuals extract (decision D7's
"three consecutive months of real exports" is a smaller case; the annual one is the realistic
worst). Commit issues ~300,000 sequential statements in one transaction. At a conservative 0.5 ms
round trip that is 150 s of wall clock holding an open transaction, well past any reverse-proxy or
client timeout. If the node process is killed mid-flight the `catch` never runs, the batch is left in
status `'committing'`, and `POST /:id/cancel` refuses it — its allowed statuses are
`uploaded, mapped, validating, validated, failed` (`:1223-1226`). The only route out is re-validating
(`:641`, which accepts any status but `committed`/`cancelled`), which the officer has no reason to
guess.

**Fix (≈2 days).** Batch the inserts (multi-row `VALUES`, 500–1,000 rows per statement, or
`COPY … FROM STDIN` into a staging table then one `INSERT … SELECT`); move commit to a job with a
progress endpoint if a batch exceeds a configured size; add `'committing'` to the cancellable set
with a stated recovery message, or add an explicit `POST /:id/reset` for a stuck batch. Keep the
single-transaction semantics — they are correct.

---

### MINOR findings

| # | Finding | Evidence |
|---|---|---|
| m1 | Budget-line approval has no database-level requester≠approver constraint; only the route guards it. `budget_revision` has both, and the module's own documentation says separation of duties is "enforced as data, not convention". | `migrations/188_finance_foundation.sql:422-423` (constraint requires only that an approver is recorded) vs `:458-460`; route check at `src/routes/finance-budget.js:343-346` |
| m2 | Mutating requests that return 404 are not audited, so a UUID-enumeration probe against finance records (every hidden or cross-tenant row answers 404) leaves no trace. | `src/middleware/auditLog.js:154-156`, `:165` |
| m3 | The import upload accepts any MIME type and does no magic-byte check; only `readTabular` refusing the bytes stops a non-spreadsheet. The document path does both (`ALLOWED_MIME` + `validateFileSignature`). The malware scan *is* present on both. | `src/routes/finance-imports.js:381-389, 436-442` vs `src/routes/finance-documents.js:88-99` and `:36-45` |
| m4 | `/finance/accounts`, `/finance/departments`, `/finance/programmes`, `/finance/activities` have no `LIMIT` or pagination, and the frontend loads all of them at boot. A real chart of accounts is thousands of rows. | `src/routes/finance-config.js:253-265, 352-361, 421-433`; `src/modules/finance/stores/finance.ts:127-152` |
| m5 | `PermissionsSection.vue` has no loading or error state and renders "0 of 0" with no category sections if `/finance/me`'s catalogue failed — a silently blank governance page. | `src/modules/finance/pages/sections/PermissionsSection.vue` (grep for `loading`/`error` returns 0) |
| m6 | `ON CONFLICT DO NOTHING` with no conflict target means **any** unique violation during commit is recorded as `skipped_duplicate`, not as an exception the officer can see. | `src/routes/finance-imports.js:1044-1052, 1082-1090, 1118-1126, 1143-1151` |
| m7 | Choropleth colours are hardcoded hex in TypeScript rather than resolved from the design tokens / published style registry, against the repo's single-source rule; the lightest class `#f7fbff` is indistinguishable from the legend background. | `src/modules/finance/composables/useFinanceMap.ts:112` |
| m8 | `<th>` elements in `MapSection.vue`'s three tables carry no `scope`, unlike `PermissionsSection.vue:131-134`. WCAG 1.3.1. | `src/modules/finance/pages/sections/MapSection.vue:341, 388, 407` |
| m9 | `FinancePromptDialog`'s invalid-reason message is effectively unreachable: `showInvalid` is set only by `submit()`, which the disabled Confirm button prevents. Only Enter inside a single-line input reaches it. The static rule text mitigates it. | `src/modules/finance/components/FinancePromptDialog.vue:77-82, 164-169` |
| m10 | `totalByCurrency`'s docstring says it "throws if asked to add two currencies together"; it returns a per-currency map instead. Behaviour is correct; the contract statement is not. | `src/modules/finance/composables/useMoney.ts:7-8, 100-119` |
| m11 | Migrations 188–199 carry no rollback or down path and no operational notes, against the prompt's "migrations with constraints, indexes, rollback/operational notes". 188 redefines the shared `public.users_role_check` and `public.invites_role_check` with no documented reversal. | `grep -l "rollback\|reversib" migrations/188*.sql migrations/19*.sql` returns nothing; `migrations/188_finance_foundation.sql:995, 1041` |
| m12 | The public transparency **map** (GIS-finance Milestone 7, decision D14) is not built: `CouncilFinanceView.vue` imports no map library and has no map panel. The architecture assessment lists it as M7. | `src/modules/finance/pages/CouncilFinanceView.vue:31-43`; `docs/gis-finance/ARCHITECTURE-ASSESSMENT.md:208` |
| m13 | `gis_ops.feature`, `feature_version` and `edit_session` remain outside row-level security (`pending` since migration 165). Finance does not touch them, but GIS-finance Milestone 8 extends the import pipeline into them. Confirmed live: `node scripts/verify-tenancy.js --debt` → `gis_ops (3)`, total debt 24 against a baseline of 26. | `scripts/verify-tenancy.js:26`; live run 2026-11-08 |

### What is correct and worth protecting

These were verified, not assumed, and a future change should not regress them:

- **Every mutating finance route has a permission `preHandler`.** All 48 `POST`/`PUT`/`PATCH`/`DELETE`
  registrations across the ten `finance-*.js` files were enumerated and each carries `canX` or an
  inline `requirePermission`/`requireAnyPermission`. No unguarded mutation exists. (The *choice* of
  permission is wrong in exactly one case — BLOCKER-3.)
- **No string-interpolated SQL.** The only interpolations into query text are `${sortColumn}`,
  `${dir}`/`${direction}` (whitelist maps plus JSON-schema enums —
  `src/routes/finance-public.js:204-205, 313-314, 450-451`, `finance-budget.js:119`), `${where}`
  (constant), `${table}`/`${amountColumn}` derived from a CHECK-constrained column
  (`finance-imports.js:1248-1260`), `${parentCol}` from a fixed loop (`finance-config.js:356`) and
  `${showCounterparty ? … : ''}` (`finance-projects.js:179, 615`). All parameters are bound.
- **Separation of duties at the role level is asserted by the migration**, which fails rather than
  weakening the control, and includes the `admin`-holds-nothing assertion —
  `migrations/188_finance_foundation.sql:1236-1256`. The route-level requester≠approver guard and the
  `budget_revision` DB CHECK both exist (`finance-budget.js:527-530`, `188:458-460`).
- **Counterparty identity is structurally absent from the public surface.** `v_published_transaction`
  does not select those columns and joins a live publication
  (`migrations/188_finance_foundation.sql:951-979`); asserted against
  `information_schema` at `finance.security.test.js:386-399`. Restricted columns on the staff side
  require their own permission (`finance-reports.js:500-506`, `finance-projects.js:179`).
- **Currency separation holds end to end.** Separate columns, a CHECK'd `finance.currency_code`,
  per-currency `FILTER` clauses with mismatch counters rather than conversion
  (`188:805-822`), per-currency grouping in every roll-up (`188:877-896`, `199:95-160`), a
  reconciliation that refuses one control total against a mixed-currency file
  (`finance-imports.js:806-814`), BigInt-cent addition keyed by currency in the browser
  (`useMoney.ts:100-119`), a PDF builder that adds no total row
  (`test/finance-pdf.test.js:64`), and a dormant, empty `exchange_rate_policy`
  (`migrations/193_finance_exchange_rate_dormant.sql`).
- **Closed-year integrity is a database trigger**, covering seven tables including the two project
  link tables (`migrations/192_…:21-56`) — not route logic.
- **Spatial-allocation integrity is largely right**: all-or-nothing per subject enforced in the view
  (`199:35-82`), currency pinned to the subject (`198:110-116`), requester≠approver as both a CHECK
  (`198:63`) and a route check (`finance-spatial.js:232-235`), mandatory free-text methodology with no
  default and no equal division (`198:45, 78-82`), a decided split immutable but an approved one
  revocable (`198:139-166`), graceful degradation while the ward register is empty (`198:140-148`).
- **No finance measure can reach `/api/tiles/*` or `/api/ogc/*`.** `grep -rln "finance\."` across
  `src/routes/` outside `finance-*.js` matches only the four finance test files; the ward-geometry
  endpoint is permission-gated and simplified server-side
  (`src/routes/finance-spatial.js:391-414`). Binding principle §6.1.6 holds.
- **Audit coverage of refusals.** `authenticate()` runs before the permission test, so `request.user`
  is set when a 403 is sent (`financePermissions.js:122-129`) and the `onResponse` hook records it
  (`auditLog.js:148-205`). Live: 1,247 `FIN*` audit events in `vungu_dev`. The audit table is
  append-only with the application role denied write and an update/delete guard trigger, asserted at
  `finance.security.test.js:590-606`.
- **A timed restore drill exists and passed**: 65 s database restore, 103 s backup, 26/26 finance
  tables, 4/4 views, 31/31 triggers, all row counts and per-currency totals matched, 190/190 uploads
  with identical SHA-256 — `../Manicipal-drums-backend-3/docs/audit/BACKUP-RESTORE-EVIDENCE.md:15, 66-70, 102`.
- **`FinancePromptDialog` focus management is correct** because `UiSheet` does the work:
  `role="dialog"`, `aria-modal="true"`, a real Tab trap with wrap-around and recovery when the focused
  node unmounts, Escape to dismiss, focus moved into the panel on open and restored to the trigger on
  close, and `prefers-reduced-motion` handled in `responsive.css`
  (`src/components/ui/UiSheet.vue:94-122, 150-160, 259-263, 476`).
- **Reduced motion on the map**: the only `fitBounds` in the finance module passes `duration: 0`
  unconditionally (`MapSection.vue:179`), so there is no animation to collapse.

---

## 3. Traceability

### 3.1 Gap-note acceptance checks A1–A10

| # | Check | Status | Test evidence |
|---|---|---|---|
| A1 | Same file imported twice commits once | **Covered** | `src/routes/__tests__/finance.acceptance.test.js:645` ("A1: the same file cannot be committed twice, and a retried commit is the same commit"); implementation `finance-imports.js:412-418` (idempotency key), `:463-478` (file-hash refusal), `:991-995` (idempotent re-commit) |
| A2 | Malformed rows → row-level exceptions, not a failed batch | **Covered** | `finance.acceptance.test.js:511`; `test/finance-primitives.test.js:173-253` (14 per-field exception cases) |
| A3 | Imported totals reconcile to declared control totals | **Covered** | `finance.acceptance.test.js:511, 706`; mismatch blocks commit, `:582`; implementation `finance-imports.js:787-833` |
| A4 | Original and revised allocations both visible after approval | **Covered** | `finance.acceptance.test.js:357`; `finance.workflow.test.js:246` |
| A5 | Technical administrator cannot approve or publish | **Covered** (route + migration) | `finance.acceptance.test.js:150`; migration assertion `188:1247-1256`. **Gap:** not covered for the override path — see BLOCKER-2 |
| A6 | Requester cannot approve their own revision | **Covered** (route + DB CHECK) | `finance.acceptance.test.js:397`; CHECK `188:458-460`; route `finance-budget.js:527-530`; spatial equivalent `test/finance-spatial-allocation.test.js:222` |
| A7 | Public API returns no unpublished row and no counterparty identity | **PARTIAL — anonymous only** | counterparty: `finance.security.test.js:386`, `finance.acceptance.test.js:989` — solid. Unpublished: `finance.security.test.js:366, 371`, `finance.acceptance.test.js:870`, `finance.workflow.test.js:368, 463` — **all anonymous**. **NOT COVERED** for an authenticated council session: see BLOCKER-1 |
| A8 | Amounts in different currencies never aggregated | **Covered** | `finance.acceptance.test.js:719`; `finance.workflow.test.js:342`; `finance.map.test.js:120`; `test/finance-pdf.test.js:64`; frontend `src/modules/finance/__tests__/money.spec.ts:73-127`, `financeMap.spec.ts:31` |
| A9 | A closed financial year rejects writes | **Covered, with a gap** | `finance.acceptance.test.js:1632` ("through the API or around it"); `finance.workflow.test.js:480`; `test/finance-spatial-allocation.test.js:213`. **Gap:** `finance.spatial_allocation` is not in the trigger set and project splits have no year check — MAJOR-8 |
| A10 | Planning project traces allocation → revisions → transactions → actual spend | **Covered** | `finance.acceptance.test.js:769` |

### 3.2 Specification §13.1 — eight critical test scenarios

| § | Scenario | Status | Evidence |
|---|---|---|---|
| 13.1.1 | Import the same file twice; confirm duplicate prevention | Covered | `finance.acceptance.test.js:645` |
| 13.1.2 | Import invalid dates / missing account codes / invalid amounts; row-level errors | Covered | `finance.acceptance.test.js:511`; `test/finance-primitives.test.js:173, 196, 212` |
| 13.1.3 | Publish without permission; confirm denial **and audit event** | Covered | `finance.acceptance.test.js:882`; `finance.security.test.js:289, 313, 607` |
| 13.1.4 | Public user cannot access confidential documents or unpublished transactions | **Partial** — anonymous proven (`finance.security.test.js:371, 453, 493`); authenticated council session NOT COVERED (BLOCKER-1) |
| 13.1.5 | Approve a revision; original and revised remain separately visible | Covered | `finance.acceptance.test.js:357` |
| 13.1.6 | Multi-currency reports not incorrectly aggregated | Covered | `finance.acceptance.test.js:719`, `:1294`; `test/finance-pdf.test.js:64` |
| 13.1.7 | **Restore a database and object-storage backup in a test environment** | Covered (evidence, not an automated test) | `../Manicipal-drums-backend-3/docs/audit/BACKUP-RESTORE-EVIDENCE.md`; tool `scripts/verify-restore.js` |
| 13.1.8 | Closed financial year cannot be silently overwritten | Covered, with MAJOR-8's gap | `finance.acceptance.test.js:1632`; trigger `192:21-56` |

### 3.3 Specification §13 — test types

| Type | Status | Evidence |
|---|---|---|
| Unit (budget calc, currency, validation, permissions) | Covered | `test/finance-primitives.test.js` (34), `money.spec.ts` (19), `financeMap.spec.ts` (7), `permissions.spec.ts` (14) |
| API (validation, structure, authorisation, errors) | Covered | `finance.acceptance.test.js` (29), `finance.security.test.js` (33), `finance.map.test.js` (5) |
| Integration (API/DB, API/storage, frontend/API) | Covered for API/DB and API/storage; **worker/queue N/A** (no queue exists — see MAJOR-11) | `finance.workflow.test.js` (9), `test/finance-spatial-allocation.test.js` (12), `test/finance-cross-tenant.test.js` (4) |
| Import (large files, malformed, duplicates, retries, partial failures, reconciliation) | **Partial** — malformed, duplicates, retries and reconciliation covered; **large files NOT COVERED** (no test above a handful of rows; the 200,000-row ceiling is untested — MAJOR-11), **partial failure mid-commit NOT COVERED** | `test/finance-spreadsheet.test.js` (24), `finance.acceptance.test.js:511-718` |
| Security (access-control bypass, injection, upload, session, document access) | Covered | `finance.security.test.js:148-608` |
| End-to-end (login → import → publication → public viewing) | Covered | `finance.acceptance.test.js:948`, `finance.workflow.test.js:378` |
| UAT | **NOT MET** — Council decision D10, open |

### 3.4 Specification §15 — acceptance criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Role-appropriate sign-in | Met — `finance.security.test.js:148-238`; `src/router/__tests__/route-roles.spec.ts:101-112` |
| 2 | Manage financial years and classifications | Met — `finance.acceptance.test.js:100` |
| 3 | Import supported files and view validation errors | Met — `finance.acceptance.test.js:511`; `ImportsSection.vue` |
| 4 | Repeated imports do not duplicate | Met — A1 |
| 5 | Imported totals reconcile to control totals | Met — A3 |
| 6 | Original and revisions separately retained | Met — A4 |
| 7 | Budget/revenue/expenditure calculations pass agreed cases | Met for the implemented formulas; the *agreed* cases await D8 |
| 8 | Explore published data summary → permitted detail | Met — `CouncilFinanceView.vue`; `finance.acceptance.test.js:948` |
| 9 | **Public users cannot access unpublished or restricted records** | **NOT MET** — BLOCKER-1 |
| 10 | Projects created, approved, linked to transactions | Met — `finance.acceptance.test.js:769` |
| 11 | Reports filtered and exported with period and currency labels | Met, with MAJOR-5's silent truncation; see also `docs/gis-finance/REPORTING-COVERAGE.md` for catalogue gaps |
| 12 | Significant changes and approvals recorded in audit history | **Partial** — MAJOR-6 (no before/after on budget-line and project approvals, year close, document visibility); m2 (404s unaudited) |
| 13 | Backup restoration demonstrated in a test environment | Met on-host — `BACKUP-RESTORE-EVIDENCE.md`; off-host rehearsal outstanding (D9) |
| 14 | Council sign-off of UAT | **NOT MET** — D10 |

### 3.5 GIS-finance milestones (ARCHITECTURE-ASSESSMENT §9)

| M | Scope | Status |
|---|---|---|
| 1 | Architecture assessment | Delivered |
| 2 | Spatial-financial data model (198/199, routes, ward filters, `finance.map.view`) | Delivered; MAJOR-1 and MAJOR-8 are defects within it |
| 3 | Integrated staff finance map | Delivered; MAJOR-4 (keyboard), MAJOR-9 (bundle), MAJOR-10 (performance) |
| 4 | Revenue & expenditure mapping | Partial — measure switching is in `MEASURES` (`useFinanceMap.ts:33-48`); outstanding-revenue blocked on D13 |
| 5 | Projects & capital map | **Not delivered** — no project point layer; `ProjectsSection.vue` has lon/lat fields and no map; 0 of 1 projects carry a location |
| 6 | Role-based map experiences | **Not delivered** — one map for all roles; no presets |
| 7 | Public transparency map | **Not delivered** — m12 |
| 8 | Spatial imports & analytics | **Not delivered**; blocked behind m13 (`gis_ops` RLS debt) |
| 9 | Security, performance, end-to-end | **This document is the audit half.** Load checks against the 194 bar for the ward views are NOT COVERED (MAJOR-10) |

---

## 4. Frontend test run — verbatim

`npx vitest run --root . --no-file-parallelism` in
`/home/theo-madzinaga/Documents/Manicipal-drums-frontend`, 2026-11-08 23:14:14, exit code **0**:

```
 Test Files  149 passed (149)
      Tests  1255 passed | 1 skipped (1256)
   Start at  23:14:14
   Duration  130.32s (transform 14.55s, setup 0ms, import 34.45s, tests 31.04s, environment 34.98s)
```

No failures. The single skip is outside the finance module:
`src/planning/__tests__/rdc-farm-subdivision.spec.ts (7 tests | 1 skipped) 5886ms`.

Finance-module files, all green (68 tests):

```
 ✓ src/modules/finance/__tests__/sign-out.spec.ts (12 tests) 373ms
 ✓ src/modules/finance/__tests__/prompt-dialog.spec.ts (7 tests) 242ms
 ✓ src/modules/finance/__tests__/documents.spec.ts (5 tests) 283ms
 ✓ src/modules/finance/__tests__/access.spec.ts (4 tests) 187ms
 ✓ src/modules/finance/__tests__/permissions.spec.ts (14 tests) 88ms
 ✓ src/modules/finance/__tests__/money.spec.ts (19 tests) 37ms
 ✓ src/modules/finance/__tests__/financeMap.spec.ts (7 tests) 10ms
```

One non-fatal warning was emitted by an unrelated spec:
`[Vue warn]: provide() can only be used inside setup().` in
`src/composables/__tests__/useCitizenCase.attach.spec.ts`.

**Backend suite: deliberately not run.** See MAJOR-7 for the mechanism and the evidence that it
writes to `vungu_dev`. Backend coverage above is reported statically from the test sources: 6 files
in `test/` (1,229 lines) and 4 in `src/routes/__tests__/` (3,087 lines), 29 + 33 + 9 + 5 + 4 + 12 +
34 + 3 + 24 + 14 = **167 finance test cases** enumerated by name in §3.

---

## 5. Per-section frontend quality and accessibility

`L` loading state · `E` empty state · `Err` error banner · `403` explains rather than breaks.
"403" is `yes` where the section renders `FinanceGuard` or routes failures through
`messageOf()` (`stores/finance.ts:191-209`), which names the missing permission.

| # | Section (file) | L | E | Err | 403 | Accessibility notes |
|---|---|---|---|---|---|---|
| 1 | Overview `FinanceOverviewSection.vue` | yes `:139` | yes `:141,146` | yes `:127` | yes | Clean. Three distinct states; no colour-only status. |
| 2 | Finance map `MapSection.vue` | partial — `:276` spinner on Refresh only, no first-load state | yes `:289,296` | yes `:258` | yes (map gated by `finance.map.view`; refused → `error` banner) | **MAJOR-4**: ward selection mouse-only once linked; `<tr @click>` not focusable; `<th>` without `scope` (m8); legend text present so the legend itself is not colour-only; `fitBounds duration:0` (reduced motion fine) |
| 3 | Financial years `FinancialYearsSection.vue` | **no** | yes `:237` — but fires during load (**MAJOR-3**) | yes `:170` | yes | Labelled form fields with `ins-hint` help text; status conveyed by text, not colour alone |
| 4 | Departments & accounts `ClassificationsSection.vue` | **no** | yes `:433,526,636,641,747` — false-empty during load (**MAJOR-3**) | yes `:391` | yes | Largest section (939 lines); four nested registers; labelling good |
| 5 | Budget `BudgetSection.vue` | yes | yes | yes `:363` | yes | Dense table; per-field hints state the currency and available-balance definition; reads `store.mapWardCode` so the map and the dashboard answer the same question |
| 6 | Revisions `RevisionsSection.vue` | yes `:150` | yes `:152,157` | yes `:116` | yes | Good: `role="status"` banner for "awaiting your decision" and a `t-warning` one for the officer's own pending requests (`:136,141`) — self-approval explained before it is refused |
| 7 | Projects `ProjectsSection.vue` | yes `:636` | yes | yes `:489` | yes | Manual lon/lat entry with a hint; no map picker (M5 not delivered) |
| 8 | Data imports `ImportsSection.vue` | partial — progress text `:398`, no first-load state | yes | yes `:498` | yes | Strongest copy in the module; `role="status"` on upload progress; explicit read-only banner for a closed year `:505` |
| 9 | Reports & exports `ReportsSection.vue` | yes | yes `:236` | yes `:131` | yes | Restricted-export refusal is explained with the permission name |
| 10 | Documents `DocumentsSection.vue` | partial `:398` | yes `:363,366` | yes `:297` | yes — tested (`documents.spec.ts:92`) | Says restricted documents are *absent* rather than blanked (`documents.spec.ts:148`) — exactly right |
| 11 | Publication `PublicationSection.vue` | partial | yes `:239,251` | yes `:178` | yes | Per-dataset help text; the approve/publish split is explained |
| 12 | Audit history `FinanceAuditSection.vue` | yes `:152` | yes `:154` | yes `:96` | yes (`:403` filter surfaces refusals) | Refusals are a first-class filter (`:144`) — good auditor affordance |
| 13 | Permissions `PermissionsSection.vue` | **no** | **no** (m5) | **no** | n/a (informational) | Best a11y in the module: `<th scope="col">`, icon + `.sr-only` "Held"/"Not held" so held-ness is never colour-only (`:140-144`). Asserts an SoD guarantee BLOCKER-2 breaks (`:113-118`) |
| 14 | Finance access `AccessSection.vue` | partial `:291` | yes `:273` | yes `:223` | yes (`FinanceGuard`) | Self-edit refusal explained in-page `:294`. This is BLOCKER-2's screen — it offers the override editor with no SoD warning |
| 15 | Settings `FinanceSettingsSection.vue` | partial | yes | yes `:131` | yes | Settable-key allowlist mirrored from the backend |
| — | Public portal `CouncilFinanceView.vue` | yes `:268,427` | yes `:270,375,437,582,614` | yes `:262` | n/a | No map (m12); MAJOR-2 means its budget page can state 0% executed as fact |

**Module-wide accessibility.** A skip link to `#fin-main` with a visible focus style
(`FinanceWorkspace.vue:316-321` styles, `.fin-skip`), `<main tabindex="-1">` so the skip lands
(`:297`), `aria-current="page"` on the active rail item (`:286`), `aria-label` on the section nav
(`:273`), `aria-hidden="true"` on every decorative lucide icon (consistent across all 15 sections),
`role="alert"` for errors and `role="status"` for progress and informational banners, and `tone-*`
status pills that always carry their own text. The dialog primitive is correct (see §2's positives).
The two systemic gaps are the map's keyboard path (MAJOR-4) and the missing `scope` attributes
(m8). Contrast: status pills and banners use the `--ent-tone-*` token pairs rather than raw hex, so
they inherit the token system's AA contrast; the one hardcoded palette is the choropleth ramp (m7),
whose lightest step is the only value that fails a visible-boundary check.

---

## 6. Performance risk list

| # | Path / query | Risk | Budget at stake |
|---|---|---|---|
| P1 | `GET /api/finance/map/wards` → `finance.v_ward_performance` → `v_budget_ward_attribution` (×3 `UNION ALL`) → `v_budget_line_performance` (3 unfiltered aggregate CTEs) + a second full `finance.transaction` aggregate | Full-table aggregation of `transaction`/`commitment`/`budget_revision` four times per request, under RLS, with no year push-down. The 30 s `statement_timeout` is the likely terminator at ~500k transactions — the same 57014 failure migration 194 fixed for the portal. `migrations/188_…:797-822`, `199_…:35-160` | tile/query < 100 ms; 60 fps pan |
| P2 | `GET /api/public/finance/budget` and `/overview` → `v_budget_line_performance` | Same unfiltered aggregation, on the **anonymous public** path where concurrency is highest and where migration 194's own symptom was measured | load < 2 s |
| P3 | `GET /api/finance/budget-lines?ward_code=` and the map's ward drill-down (`MapSection.vue:103-105`) | No index on `finance.budget_line (ward_code)` or `finance.transaction (ward_code)` — sequential scan per ward click | search < 200 ms |
| P4 | `POST /api/finance/imports/:id/commit` | ~3 statements × up to 200,000 rows in one transaction, no batching, no job; proxy timeout and a batch stuck in `'committing'` with no cancel path. `finance-imports.js:1035-1155, 1223-1226` | — (correctness and operability) |
| P5 | `POST /api/finance/imports/:id/validate` | One `import_row` insert plus one `import_exception` insert per issue, per row, in one transaction. `finance-imports.js:767-780` | — |
| P6 | `GET /api/finance/reports/export?report=transaction_register` | 100,000 rows into memory, then a full PDF/XLSX render in-process, synchronously in the request. `finance-reports.js:330, 486-560` | load < 2 s; also MAJOR-5 |
| P7 | Finance workspace JS chunk | `maplibre-gl` (788 KB raw) + the 24-layer basemap engine eagerly imported for all eight finance roles. `FinanceWorkspace.vue:43`, `MapSection.vue:23-25` | load < 2 s |
| P8 | `GET /api/finance/accounts` / `departments` / `programmes` / `activities`, all four called at workspace boot | No `LIMIT`, no pagination; a real chart of accounts is thousands of rows, all serialised and held in the Pinia store. `finance-config.js:253, 352, 421`; `stores/finance.ts:127-152` | load < 2 s |
| P9 | `finance.v_ward_performance`'s `ward_status` | Correlated `EXISTS` on `admin.authority_ward` per output row (`199_…:131-137`). Harmless at 19 wards; it scales with ward count × currency × year | — |
| P10 | `GET /api/finance/map/ward-geometry` | `ST_SimplifyPreserveTopology` over every linked ward on every request, no cache, no ETag — unlike `/api/tiles/*` which is cached. `finance-spatial.js:391-414` | tile < 100 ms |

No load measurement exists for the ward views. `docs/audit/PERFORMANCE-TEST-EVIDENCE.md` covers the
194 work on the public transaction path; P1–P3 are the untested successors.

---

## 7. D10 release-gate checklist

D10 (`docs/finance/DECISION-REGISTER.md`, "D10 — UAT sign-off and demonstrated restore test") is the
release gate and requires every other decision closed. Marked **met** / **not met** / **blocked on
Council or data**.

| Item | Status | Note |
|---|---|---|
| **D10(a)** UAT script covering the workspace sections and the public portal, signed by the Finance Director | **blocked on Council** | No UAT script in either repository. 15 sections now exist, not the twelve D10 names — the script must be rewritten to match (add Finance map, Documents, Finance access) |
| **D10(b)** Timed restore of the nightly backup to a scratch database | **met** | 65 s DB restore, 103 s backup, `verify-restore.js` PASS with 0 mismatches, 26/26 tables, 190/190 uploads SHA-256-identical — `BACKUP-RESTORE-EVIDENCE.md:15, 66-70, 102` |
| **D10(b)** …with a finance report reconciled against the pre-backup figure | **met in substance** | `verify-restore.js` compares per-currency totals for budget, revisions, transactions, commitments, allocations and project spend (`scripts/verify-restore.js:27-45`). A *report-level* reconciliation (export before, export after, diff) is not part of the drill — a 2-hour addition |
| **D10** Off-host restore rehearsal, DNS/service cut-over, application smoke test | **not met** | Explicitly excluded from the measured RTO — `docs/OPERATIONS_RUNBOOK.md:78` |
| **Engineering gate** No open BLOCKER | **not met** | BLOCKER-1, BLOCKER-2, BLOCKER-3 |
| **Engineering gate** Every mutating finance route permission-guarded | **met** | 48/48 enumerated; the guard *choice* is wrong in one case (BLOCKER-3) |
| **Engineering gate** A7 public exposure proven | **not met** | Anonymous only — BLOCKER-1 |
| **Engineering gate** A1–A6, A8, A10 proven | **met** | §3.1 |
| **Engineering gate** A9 proven | **partial** | MAJOR-8 |
| **Engineering gate** Load checks against the stated budgets | **not met** | P1–P10; no measurement for the ward views |
| **Engineering gate** WCAG 2.1 AA across the finance surface | **not met** | MAJOR-4 (2.1.1, 1.4.1), m8 (1.3.1) |
| **Engineering gate** Migration rollback / operational notes for 188–199 | **not met** | m11 |
| **Engineering gate** Test suite does not touch the live database | **not met** | MAJOR-7; `vungu_dev` currently holds published test artefacts |
| **Engineering gate** `gis_ops` RLS debt cleared (needed before GIS-finance M8) | **not met** | m13 — 3 relations `pending` since migration 165 |
| D1 Financial year dates and naming | **blocked on Council** | 1 year exists in dev and it is the synthetic `DEMO 2027` |
| D2 Approved chart of accounts | **blocked on Council** | 2 accounts in dev; both synthetic |
| D3 Budget hierarchy depth | **blocked on Council** | Hierarchy supported, unpopulated |
| D4 Currency policy | **met by safe default** | `exchange_rate_policy` empty and inert |
| D5 Public disclosure matrix | **met by safe default** | Full counterparty withholding; BLOCKER-1 is a *mechanism* failure, not a policy one |
| D6 Approval thresholds | **met by safe default** | `approval_threshold` empty; every revision needs a second person |
| D7 Representative source exports with control totals | **blocked on Council** | 1 import batch in dev; no real extract has been supplied |
| D8 Statutory report formats | **blocked on Council** | See `docs/gis-finance/REPORTING-COVERAGE.md` |
| D9 Retention, backup, hosting, RPO/RTO | **partial** | Backup + measured on-host RTO yes; retention job, off-site arrangement, off-host RTO no |
| D11 Official ward list | **blocked on Council** | `admin.authority_ward` = **0 rows**; 19 candidate COD-AB wards under ZW1704 |
| D12 Physical progress reporting | **blocked on Council** | Field not implemented, correctly |
| D13 Arrears data source | **blocked on Council** | No debtor amounts anywhere, correctly |
| D14 Public map disclosure matrix | **blocked on Council** | And the public map is not built (m12) |
| D15 Spatial allocation approval authority | **met by safe default** | Same approvers as the money; requester ≠ approver enforced twice |

---

## 8. Honest state of the data, 2026-11-08

Read-only counts from `vungu_dev`:

| Relation | Rows |
|---|---|
| `admin.authority_ward` | **0** |
| `admin.ward` (national reference) | 1,961 |
| `admin.village` | 0 |
| `finance.financial_year` | 1 (`DEMO 2027`, open) |
| `finance.department` | 1 |
| `finance.account` | 2 |
| `finance.budget_line` | 4 — `DEMO-L1` draft USD 250,000, `DEMO-L2` draft USD 400,000, `DEMO-L3` draft ZWG 18,500,000, `E2E-T1` **published** USD 150,000 |
| `finance.budget_line` with a `ward_code` | **0** |
| `finance.transaction` | 1 |
| `finance.project` | 1 (`VERIFY-202611081833`, approved) |
| `finance.project` with a `location` | **0** |
| `finance.spatial_allocation` | **0** |
| `finance.publication` | 2, both `published` (`budget`, `expenditure`) |
| `finance.import_batch` | 1 |
| `finance.document` | 2 |
| `council_ops.council_asset` / `road_asset` | 0 / 0 |
| `public.admin_audit_event` where `event LIKE 'FIN%'` | 1,247 |

Two corrections to `ARCHITECTURE-ASSESSMENT.md §7`: there is **1** project (not 0), and the four
budget lines include a **published** test artefact.

**What this means for M9's exit criteria.** The following cannot be met until the Council supplies
data, and no amount of engineering closes them:

1. **The ward choropleth cannot be exercised at all.** `admin.authority_ward` is empty, so
   `/finance/map/ward-geometry` correctly returns `ward_register_linked: false` and zero features
   (`finance-spatial.js:391-414`), and `MapSection.vue:289` renders the "not linked" banner. Quantile
   breaks, the per-ward panel, the map⇄dashboard sync and the choropleth's own accessibility
   (MAJOR-4) cannot be verified against real geometry until **D11** closes.
2. **No measure has a meaningful distribution.** Three draft lines in two currencies and one
   transaction cannot produce a five-class quantile scale (`computeBreaks` correctly returns `[]`
   below two distinct values — `useFinanceMap.ts:95-111`).
3. **Project and capital mapping (M5) has nothing to map.** 0 of 1 projects carry a location.
4. **Asset and revenue-generating-facility layers have nothing to draw.** Every `council_ops`
   register is empty; arrears amounts do not exist anywhere by design (**D13**).
5. **Performance against the stated budgets cannot be measured truthfully.** P1–P3's failure mode
   appears at 10⁵–10⁶ transaction rows. The live database has one. A load harness must therefore run
   against a **separate, disposable, explicitly synthetic** database — never `vungu_dev`, and never
   by promoting synthetic rows into the real register.
6. **UAT (D10) cannot start.** Finance staff cannot accept a budget module that contains no budget.

**On seeding.** Test fixtures are legitimate and this module uses them well: `TAG`-and-remove rows
inside an isolated acceptance database (`finance.security.test.js:17-21`), in-memory spreadsheet
fixtures (`test/finance-spreadsheet.test.js`), and pure-logic frontend fixtures
(`financeMap.spec.ts`, `money.spec.ts`). Seeded demo *finance* data is not legitimate here and the
module is explicit about it — `migrations/188_finance_foundation.sql:1259-1264`: "No financial year,
no department, no account and no amount is seeded … a plausible-looking placeholder in a finance
system is worse than an empty one." I therefore make **no** recommendation to seed budgets, wards,
projects, locations or asset values to make a test, a demo or a performance figure look better. The
five synthetic rows now in `vungu_dev` (MAJOR-7) are the concrete harm that rule exists to prevent:
one of them is being served to the public portal as a published council figure.

---

## 9. Suggested order of work

1. BLOCKER-1 (public exposure) — 1 day, with the authenticated-session tests.
2. BLOCKER-3 (document withdrawal permission and reason) — 2 hours.
3. BLOCKER-2 (SoD on the override path, route + trigger) — half a day.
4. MAJOR-7 (test database guard) before any further backend test run — 2 hours; then clean the five
   artefact rows from `vungu_dev` as a separately approved task.
5. MAJOR-1 and MAJOR-8 (spatial attribution integrity, closed-year coverage) — 1.5 days.
6. MAJOR-2, MAJOR-3, MAJOR-5, MAJOR-6 (figures and records that misstate themselves) — 1.5 days.
7. MAJOR-4 + m8 (keyboard and table semantics) — half a day.
8. MAJOR-9, MAJOR-10, MAJOR-11 + P1–P10 (performance, with a load harness on a disposable
   database) — 3–4 days.
9. MINOR backlog.
10. Then, and only then, the Council-side gates: D11 and D1/D2/D7 to make UAT possible, and D10.
