# System Audit Report

Date: 2026-11-06
Auditor: implementation review against the Vungu RDC Technical Specification v1.0
Repositories:
- Backend: `<backend-repo>`
- Frontend: `<frontend-repo>`
- Read-only reference: `<reference-repo>`

## 1. Method

1. Extracted and read the authoritative DOCX specification.
2. Mapped every specification module and use case to backend routes, frontend views, database objects and tests.
3. Ran the finance unit, frontend, acceptance, security and workflow suites, a backup/restore drill and a load test (see `TEST-RESULTS.md` and the evidence documents).
4. Inspected the schema, views, RLS policies, permission catalogue, money handling and audit controls.
5. Recorded only findings with a file/line or executable evidence; unresolved items are labelled "not verified".

Limitations: no external penetration test, no browser/accessibility audit, no off-host DR rehearsal and no UAT with Council staff. A load test and a same-host backup/restore drill were subsequently performed and are recorded in `PERFORMANCE-TEST-EVIDENCE.md` and `BACKUP-RESTORE-EVIDENCE.md`; the load test found a public-portal scaling blocker, which was then fixed and re-measured (F-13).

## 2. Executive summary

The module is a serious, mostly complete implementation. Its strongest parts are the parts the specification treats as non-negotiable:

- Money is `NUMERIC`/`finance.money`, never floating point, and currencies are never added together.
- Public exposure is enforced by row-level security policies keyed to a live publication row, not by route filters.
- Imports are idempotent, hash-checked, reconciled to declared control totals, and separate upload from commit.
- Budget revisions preserve the original allocation and enforce requester/approver separation.
- Closed financial years are protected by a database trigger, not just an API check.
- The audit trail is append-only and records refused attempts.

The issues that mattered before go-live were these; F-01 to F-06 are now fixed:

1. Finance roles were not part of the application's role registry, so the user-administration and invite routes rejected them. This is fixed in this audit (`F-01`).
2. ~~There is no API or screen for finance-specific role assignment beyond the user's single `users.role`; per-user overrides and departmental scopes cannot be administered (`F-02`).~~ **Fixed 2026-11-05** — see F-02 below.
3. ~~Public project data is not scoped to the selected financial year (`F-03`).~~ **Fixed 2026-11-05** — see F-03 below.
4. ~~The project performance view duplicates project rows and hides mismatched-currency spend when a project has allocations in both currencies (`F-04`).~~ **Fixed 2026-11-05** — see F-04 below.
5. ~~Transactions can be linked to a budget line from another year or currency by direct SQL, bypassing import validation (`F-05`).~~ **Fixed 2026-11-06** — cross-year links are refused by the database; currency mismatches remain stored and counted by design (see F-05 below).
6. ~~There is no year-on-year or historical comparison report (`F-06`).~~ **Fixed 2026-11-06** — see F-06 below.

The 2026-11-07 system-wide pass resolved five more findings beyond the finance module — the
ERP inbound authority bug that had silently broken every `AccountLinked` event since migration
172 (`F-14`), a migration chain that skipped seven applied-by-hand files and broke any fresh
deployment (`F-15`), the online application-fee payment flow refused by a CHECK constraint
since migration 085 (`F-16`), `/api/context/parcels` reading a column no migration created
(`F-17`), and a cross-tenant read: another council's staff could see published finance rows in
the staff workspace (`F-18`, fixed by migration 197). The previously flagged public-portal RLS
performance blocker was independently re-verified at 50,000 transactions — see F-13 below and
`PERFORMANCE-TEST-EVIDENCE.md`.

A load test performed during the review found a public-portal scaling blocker (`F-13`): at
20,000 transactions the portal returned HTTP 500 on 27.42% of requests at concurrency 30, all
PostgreSQL `57014` statement timeouts. The cause was per-row evaluation of the publication RLS
policy on `finance.transaction`, compounded by per-row tenant-policy session calls. It was fixed
by `migrations/194_finance_public_query_performance.sql`, a policy-only rewrite that preserves
the publication and tenant models. The full matrix (2k/10k/20k/50k × 1/10/30/50, public-only and
mixed) now returns **0 errors and 0 timeouts**; see F-13 and `PERFORMANCE-TEST-EVIDENCE.md`.

The architecture also differs from the specification in ways that must be formally accepted or corrected: no Angular admin application, JavaScript rather than TypeScript, `/api` rather than `/api/v1`, local private file storage rather than MinIO, and no background worker/queue for imports and reports (`F-10`).

### Status distinctions

| Claim | Status |
| --- | --- |
| **Functionally implemented** | Yes — all audited finance behaviours exist |
| **Automatically tested** | Yes — 2026-11-07: 55 backend unit suites (602 tests), 8 acceptance suites (78), 2 live HTTP suites (18), 144 frontend files (1,220 tests) — all green |
| **Performance verified** | Yes, for this host and dataset — 32 load runs at 2k–50k, 0 HTTP 500, 0 timeouts |
| **Security reviewed** | Yes — static review, 33 adversarial tests, and publication/tenant visibility re-verified on the 20k load dataset |
| **Operationally verified** | Partly — backup/restore re-demonstrated 2026-11-07 (2m06s backup of 709.7 MB, 1m14s restore, `verify-restore` PASS, 0 mismatches); off-host DR, monitoring and real network path are not |
| **Council accepted** | No — AD-01–AD-05 and §15 UAT are outstanding |

## 3. Architecture conformance

| Specification | Implemented | Evidence | Assessment |
| --- | --- | --- | --- |
| Vue.js public frontend | Yes | `src/modules/finance/pages/CouncilFinanceView.vue`; `/council/finances` and `/council/*` redirects in `src/router/index.ts:145-156` | Conforms |
| Angular administrative frontend | No | Admin is the same Vue SPA (`src/router/index.ts:248+`); finance workspace at `/finance` | Deviation |
| Node.js + TypeScript backend | Node.js yes, TypeScript no | `server.js`, `src/routes/finance-*.js` are CommonJS JavaScript | Deviation |
| PostgreSQL | Yes | PostgreSQL 18.6; `finance` schema with 30 tables | Conforms |
| Redis cache/queue | Partial | Optional `@fastify/redis` registration for tile L2 cache (`server.js:366-370`); not used for finance jobs | Partial |
| MinIO object storage | No | Documents are written to a private local root (`finance-documents.js:34-36`) | Deviation |
| Nginx gateway | Config present | `nginx.conf` in both repositories | Present, deployment not verified |
| Background Node.js workers | No | Import validation/commit and report generation run in-request | Deviation |
| Docker | Dockerfiles present | `Dockerfile` in both repositories; only `docker-compose.qgis.yml` for the GIS stack | Partial |
| Playwright + unit/API tests | Yes | Frontend Vitest + Playwright config; backend Jest | Conforms |
| Knex migrations | No | Custom `scripts/migrate.js` and numbered SQL migrations | Deviation |

## 4. Module assessment

| Module | Status | Strong evidence | Material gaps |
| --- | --- | --- | --- |
| Public portal (§3.1) | Implemented | Year selector from publications; per-currency summary; published budget/revenue/expenditure/transactions/projects/documents; provenance on figures; documents paginated/filterable by year and dataset; council identity read from the register; performance verified to 20k transactions (F-13) | No combined multi-currency total by design |
| Administrative portal (§3.2) | Partial | Finance workspace with overview, budget, revisions, imports, projects, reports, publication, audit, settings | No council profile editor specific to finance |
| Budget management (§3.3) | Implemented | Original vs revised, hierarchical accounts, revisions with approval, version history, submit/return/approve, closed-year trigger | No draft/submitted/returned state on revisions beyond route state; see gap analysis |
| Revenue monitoring (§3.4) | Implemented | Revenue accounts/classes, budget vs actual, published revenue endpoints, variance formula, year-on-year comparison | No combined multi-currency total by design |
| Expenditure monitoring (§3.5) | Implemented | Transactions, commitments, available balances, overspend exceptions, variance explanations; cross-year budget-line links refused by the database, currency mismatches stored and counted | No combined multi-currency total by design |
| Projects and capital (§3.6) | Implemented | Project lifecycle, allocations, transaction links, public summaries after approval; performance is year-scoped and reports other currencies separately | No capital-project report beyond `project_performance` |
| Transactions and documents (§3.7) | Implemented | Register, source refs, document upload/download, private-by-default, checksum, malware scan, public download | No MinIO; no document-level permission matrix beyond visibility |
| Imports (§3.8) | Implemented | CSV/XLSX, mapping, row exceptions, idempotency, hash, control totals, transactional commit, reconciliation | Validation/commit is synchronous |
| Reporting (§3.9) | Implemented | Nine reports including year-on-year comparison, PDF/XLSX/CSV, council/period/currency/filter metadata, restricted export permission | Historical depth limited to the years held in the register |
| Administration and audit (§3.10) | Partial | Append-only `admin_audit_event`, finance search/export, refused attempts, retention comment | Finance role/scope administration missing; no retention job evidenced |
| Use cases UC-01..UC-12 | Implemented | A1-A10 acceptance tests; UC-11 year-on-year delivered; UC-12 access administration covered by F-02 | — |

## 5. Findings

Severity: Critical = blocks go-live; High = required for a specification use case; Medium = correctness/reporting defect; Low = documentation or usability.

### F-01 — High — Finance roles could not be assigned through the application (FIXED)
`migrations/188_finance_foundation.sql:995-1004` adds seven finance roles to the `users` CHECK constraint, but the application role registries were not updated:
- `src/routes/auth.js` `INVITABLE_ROLES` and `VALID_USER_ROLES` omitted them, so `PUT /api/admin/users/:id` returned "Invalid role" and invitations could not grant a finance role.
- `src/config/permissions.js` `ALL_ROLES`/`STAFF_ROLES` omitted them, so the admin role matrix and `GET /admin/users?staff=true` did not recognise finance staff.

Fix applied: added the seven roles to both registries and added `FINANCE_ROLES` plus console labels in `src/config/permissions.js`; regression test `test/finance-roles.test.js` (3 assertions groups) passes.

### F-02 — High — Finance-specific access administration is incomplete (FIXED)
Originally: `finance.users.manage_finance_roles` existed in the catalogue and was granted only to `admin` (`migrations/188_finance_foundation.sql:1222`), but no route read it. User provisioning used `requireAdmin` in `src/routes/auth.js:1059-1194`, and the finance UI's `PermissionsSection.vue` was explicitly informational. There was no API/UI to grant or deny a per-user override, assign departmental scopes, or delegate finance user administration.

Fix applied (2026-11-05):
- `src/routes/finance-users.js`: `GET /finance/users`, `GET /finance/users/:id/access`, and
  `PUT /finance/users/:id/access` (role, overrides and scope replaced in one transaction). All are
  guarded by `finance.users.manage_finance_roles`; self-editing is refused; a reason is mandatory.
- `auditLog.js` merges a route-supplied `req.auditDetails`; the access route records the reason and
  the before/after role, overrides, scope and effective permissions, without copying account PII.
- `src/modules/finance/pages/sections/AccessSection.vue` is the administrator-only screen, wired
  into the finance workspace as "Finance access".
- Registered in `server.js` and `test/helpers/buildApp.js`.

Evidence: acceptance F-02 passes in the 27-test finance suite (technical administrator succeeds;
finance administrator without the permission gets 403; deny wins; unknown permission refused;
self-edit refused; audit details present). Frontend `access.spec.ts` passes 4 tests and the module
type-checks.

### F-03 — Medium — Public project data is not filtered by financial year (FIXED)
Originally `GET /api/public/finance/overview` took `financial_year_id` but its project query was `FROM finance.project GROUP BY currency` with no year predicate (`finance-public.js:117-120`). `GET /api/public/finance/projects` had no `financial_year_id` parameter, and `finance.project` has no financial-year column. The frontend project panel therefore showed every published project regardless of the selected year.

Consequence: the project panel contradicted the selected reporting period.

Fix applied (2026-11-05):
- `migrations/189_finance_project_reporting.sql` adds `finance.project_allocation.financial_year_id`,
  populated from the budget line by a trigger and protected by a composite foreign key. The year is
  therefore available wherever the allocation is, including to the public role, which cannot read an
  unpublished budget line.
- `finance.v_project_performance` exposes `financial_year_ids`: the distinct years in which a
  project has an allocation or a linked transaction.
- `/api/public/finance/overview` filters its project figures with
  `WHERE $1 = ANY(financial_year_ids)`.
- `/api/public/finance/projects` accepts `financial_year_id` and applies the same filter.
- `CouncilFinanceView.vue` passes the selected year when it loads the project panel.

Evidence: acceptance test "F-03 and F-04: public projects follow the selected year and report other
currencies separately" creates a project whose only activity is in a second year, and asserts it is
absent from the first year's panel and present in the second's, through both the project endpoint and
the overview.

### F-04 — Medium — Project performance can duplicate rows and hide currency mismatches (FIXED)
Originally `finance.v_project_performance` grouped allocations by `(project_id, currency)`
(`migrations/188_finance_foundation.sql:900-946`). A project with both a USD and a ZWG allocation
produced two rows for the same `project_id`. The spend join only matched the allocation currency
(`sp.currency = al.currency`), so spend in the other currency was silently omitted. The view had no
mismatch counter analogous to `actual_currency_mismatch_rows` on the budget-line view.

Consequence: duplicate projects and understated spend on multi-currency projects.

Fix applied (2026-11-05): migration 189 replaces the view with exactly one row per project. Amounts
are reported in the project's own currency; allocations and spend in another currency are returned
as `other_currency_allocations` / `other_currency_spend` (JSON objects keyed by currency) and
counted in `allocation_currency_mismatch_rows` / `actual_currency_mismatch_rows`. Nothing is
converted or added. The public project card shows those amounts separately and says so.

Evidence: the F-03/F-04 acceptance test injects a ZWG allocation and a ZWG transaction against a USD
project and asserts one project row, USD totals unchanged, both mismatch counters set to 1, and the
ZWG amounts present in the separate fields.

### F-05 — Medium — Database does not enforce transaction/budget-line year consistency (FIXED)
Originally, imports validated that a transaction's date/currency aligned with its budget line, but the schema did not. `finance.transaction.financial_year_id`, `currency` and `budget_line_id` were independent columns, so a direct SQL correction or a future integration adapter could post a transaction against a line from another year.

Fix applied (2026-11-06): `migrations/190_finance_transaction_line_year.sql` adds `finance.assert_transaction_line_year()` and `trg_transaction_line_year` on `finance.transaction` (`BEFORE INSERT OR UPDATE`). It resolves the line's year and refuses a mismatch with a `check_violation` and an explanatory hint. The migration first refuses to enable the trigger if live cross-year rows already exist, and reports the count so they can be corrected.

Currency is deliberately NOT hard-rejected. Specification §6.4 and acceptance A8 require a transaction in a different currency from its budget line to be stored, excluded from that line's totals and counted in `actual_currency_mismatch_rows`, so the fault is visible rather than converted or silently dropped. `v_budget_line_performance` and `v_project_performance` both report that count; migration 190's header records the decision.

Evidence: acceptance test "F-05: a transaction cannot cross financial years, while a currency mismatch is stored and counted" inserts a year-2033 transaction against a year-2031 line and asserts it is refused and not written; it then moves a valid row's year or line and asserts both updates are refused; finally it inserts a ZWG transaction against a USD line in the same year, confirms the row is stored unchanged and the line's `actual_currency_mismatch_rows` is 1.

### F-06 — Medium — No year-on-year or historical comparison report (FIXED)
Originally, specification §3.9 requires "year-on-year comparisons and budget-versus-actual analysis". The report catalogue (`finance-reports.js`) had eight reports covering budget-vs-actual, revenue, expenditure, departmental, project, revisions, transaction register and import reconciliation, but no comparison across years.

Fix applied (2026-11-06): added `year_on_year` to `REPORT_NAMES` and the catalogue. It takes `financial_year_id` (the current year) and `compare_financial_year_id` (the prior year), both mandatory, and refuses the same year twice (`same_financial_year`). The query uses a `FULL OUTER JOIN` over `v_budget_line_performance` for the two years, grouped by department, account and currency, so a line present in only one year is still shown. Currency is part of the join and grouping key: USD and ZWG are two rows and are never netted. Columns show prior/current revised budget, revised change, prior/current actual and actual change. The metadata block names both years and their statuses, and the CSV/XLSX/PDF exports use the same built report. The frontend report picker asks for the comparison year when the catalogue says it is required.

Evidence: acceptance test "F-06: a year-on-year report compares two years without combining currencies" prepares the same department/account in 2031 and 2034 with 100,000 and 120,000 USD, asserts the comparison row and 20,000 change, asserts the two-year metadata, checks both validation refusals, and exports CSV containing both year labels and the comparison column.

### F-07 — Low — Public documents endpoint has no pagination or year/dataset filter (FIXED)
Originally `GET /api/public/finance/documents` returned up to 500 rows ordered by upload time (`finance-public.js`), and the frontend rendered the whole list. The specification requires search, filters, sorting and pagination for public records (§3.1).

Fix applied (2026-11-06): `migrations/191_finance_document_year.sql` derives `finance.document.financial_year_id` from the subject record with `finance.set_document_year()`, backfills existing rows, and indexes `(authority_id, financial_year_id, uploaded_at DESC)`. The endpoint now accepts `financial_year_id`, `dataset`, `subject_kind`, `document_type`, `q`, `limit`, `offset`, `sort` and `direction`, returns `total`, and orders deterministically with `NULLS LAST, id`. A `dataset` narrows the allowed subject kinds (budget, revenue, expenditure, projects, reports), and project documents are explicitly multi-year. The public panel loads 25 at a time with “Load more”.

Evidence: acceptance test "F-07 and F-08: public documents are paginated and year-scoped, and the council name comes from the register" inserts public and private documents against a budget line and a transaction, asserts the derived year, the dataset filter, the two-row page plus the one-row next page, the search filter, and that the private document never appears.

### F-08 — Low — Public overview hardcodes the council name (FIXED)
Originally `finance-public.js` returned `{ name: 'Vungu Rural District Council' }` rather than reading the council profile, which is correct for Vungu today and wrong for the stated ambition to support additional councils (§1.1, §7).

Fix applied (2026-11-06): the overview joins `finance.financial_year` to `public.local_authorities` and returns that authority's `authority_name`, falling back to the Vungu name only when the register row is absent. Verification is part of the F-07/F-08 acceptance test, which renames the authority, reads the overview, and restores the name.

### F-09 — Low — Test-count documentation is inconsistent (FIXED)
Originally `docs/finance/*` stated 65 primitive tests and 25 acceptance tests; the executed suites reported 66 and 24 respectively. The counts have been regenerated from the commands in `TEST-RESULTS.md`: 71 backend unit, 29 acceptance, 66 frontend.

### F-10 — Medium — Architecture deviations must be recorded as accepted decisions
The delivered architecture differs from §7.1: Vue admin instead of Angular, JavaScript instead of TypeScript, `/api` instead of `/api/v1`, local filesystem instead of MinIO, no background worker, custom migration runner instead of Knex. Some deviations are defensible for a single-council deployment; none is documented as an approved deviation with its security/operational consequences. The public API is versionless, which makes future breaking changes harder.

### F-11 — Low — A referenced security test does not exist (FIXED)
Originally `finance-public.js` stated that `test/finance-public-exposure.test.js` asserts public non-exposure, but that file was absent. Public non-exposure was already covered end to end by acceptance tests A7 and the withdrawal test, so the correct repair was to stop citing a test that does not exist rather than add a duplicate.

Fix applied (2026-11-06): the comment now points at the acceptance suite's public-exposure and publication-withdrawal tests, which are the tests that actually assert the property. No duplicate test was added.

### F-12 — Low — The finance role-management permission is not enforced (FIXED)
Originally `finance.users.manage_finance_roles` was decorative because user provisioning used `requireAdmin`. The access-administration endpoints (`finance-users.js`) now enforce it, and F-02 proves a non-holder receives 403. `requireAdmin` remains only for account lifecycle.

### F-13 — Critical — The public portal times out at realistic transaction volume (FIXED)
Found by the load test added in this review. At 20,000 transactions the public portal returned
HTTP 500 on **27.42%** of requests at concurrency 30 (17 of 62), all PostgreSQL `57014`
`canceling statement due to statement timeout`. At concurrency 1 the p50 was 3.8 s and the p95
5.8 s; at concurrency 30 the p50 was 23.0 s. Even at 2,000 transactions the p95 was 3.4–17.5 s.

Cause: the `published_select` policy on `finance.transaction`
(`migrations/188_finance_foundation.sql:1495`) was a correlated `EXISTS` over
`finance.account` and `finance.publication`. PostgreSQL evaluated it once per candidate row,
and the account policy nested its own publication lookup inside it. `EXPLAIN (ANALYZE,
BUFFERS)` under `vungu_app` showed `loops=20000`, ~990,720 shared buffers and ~3.1 s, against
~20 ms for the same count as the owner. The tenant policies compounded it by calling
`app.is_platform()`, `app.visible_authorities()` and `app.authority_id()` per row.

Fix applied (2026-11-06): `migrations/194_finance_public_query_performance.sql` — a
**policy-only rewrite**, no schema change and no denormalisation.
- Every publication test becomes an uncorrelated `IN (SELECT …)` over the same tables, so it is
  hashed once per query (`loops=1`). Withdrawal remains atomic because nothing is materialised.
- The tenant policies short-circuit for an anonymous session (`app.authority_id = ''`) without
  calling any session function; direct database clients (which leave the GUC `NULL`, not `''`)
  keep the role-mapping path.
- `app.is_platform()` tests the setting before doing a role lookup.

Result: the public view count fell from ~3,064 ms / 990,720 buffers to **68.5 ms / 3,639
buffers**. The full 32-run matrix (2k/10k/20k/50k × 1/10/30/50, public-only and mixed) returned
**0 errors, 0 HTTP 500 and 0 timeouts**, including 20k at concurrency 50 (p50 1.91 s, p95 4.87 s,
0 errors). 50k is the measured ceiling (p95 17.1 s at c50, still under the 30 s timeout).

Security was re-verified on the 20k load dataset after the change: the public view still exposes
no counterparty columns; withdrawing expenditure leaves revenue only; withdrawing all
publications leaves 0 transactions, 0 years and 0 accounts; USD and ZWG stay separate; a mapped
direct-client role still sees exactly its authority's rows. Evidence: `PERFORMANCE-TEST-EVIDENCE.md`
§8 and `TEST-RESULTS.md` §4.1.

### F-14 — Critical — ERP inbound events carried no council identity (FIXED 2026-11-07)

Since migration 172 made `revenue_link.*` tenant data, every inbound ERP `AccountLinked` event
failed with 23502: the handler runs on the system connection where `app.authority_id()` is NULL,
and the insert relied on that session default. This was simultaneously a production bug (no ERP
account link could be created) and the reason five GIS/stands acceptance suites could not seed.

Fix: the inbound envelope now requires `authority_code`, resolved against
`public.local_authorities` and written as a literal. Cross-council guards: an `AccountLinked`
event refuses a parcel already owned (by tenancy column or current ward mapping) by another
authority; `BillingStatusUpdated` never updates an account another council holds. Unknown code →
event recorded `rejected`; missing code → 400 at the envelope check. No default authority exists.

Evidence: `src/routes/__tests__/gms.inbound-authority.test.js` (7 tests, in the `test:db` set);
the Tsamba seed now runs on a freshly migrated database; gms.acceptance, gms.editing,
stand-allocation, soft-delete and geometry-validation suites all pass again.

### F-15 — Critical — the migration chain skipped seven applied-by-hand files (FIXED 2026-11-07)

Migrations 181–187 were applied to the dev database by psql and never added to
`scripts/migrate.js`'s allowlist. Any database built from the chain (a fresh deployment, the
acceptance harness) missed them and 500'd on stand allocation (`stands.requires_minister_approval`
from 185), the statutory registers (181) and the zoning lookup (186).

Fix: 181–187 added to the allowlist in numeric order; 186 rewritten chain-safe (DROP+CREATE for
the two views it replaces — CREATE OR REPLACE cannot drop the chain's `source` column); 187's
extract-dependent fills guarded with `to_regclass` (the stance migration 172 takes) and its
revenue fills now stamp the parcel's authority explicitly (172 already tenanted those tables on
the chain). `scripts/migrate.test.js`'s pinned allowlist updated with the same entries.

Evidence: `prepare-acceptance-db.js --fresh` builds the full chain and seeds; migration test
passes; all suites green.

### F-16 — Critical — the online application-fee flow has been refused since migration 085 (FIXED 2026-11-07)

Migration 085 rebuilt `permit_application_status_check` to add `awaiting_eo_decision` from a list
that no longer carried `pending_payment` (added by 077 for the pay-online flow: a permit is
created `pending_payment`, the citizen pays, the webhook flips it to `registered`). Since then
every chain-built database refuses that insert — the citizen payment flow 500s, and the two
payment suites failed.

Fix: migration `196_permit_pending_payment_restored.sql` rebuilds the constraint with the full
set (077's `pending_payment` + 085's additions).

Evidence: `payments.applicationfee` and `permit-applications.pending-payment` suites pass on a
chain-built database (they were 2 of the long-failing six).

### F-17 — High — /api/context/parcels read a column no migration created (FIXED 2026-11-07)

`contextParcels.js` reads `land.parcel.estimated_accuracy_m` (with a `transform_accuracy_m`
fallback); its migration never landed, so the endpoint 500s on any chain-built database.

Fix: migration `195_parcel_estimated_accuracy.sql` adds the nullable column with a comment
stating its semantics; existing parcels keep their current reported accuracy via the fallback.

Evidence: `context-parcels` suite passes (12 tests).

### F-18 — Critical — cross-tenant read: published finance rows visible to other councils' staff (FIXED 2026-11-07)

Found by live two-council probing: the `published_select` policies (migration 194) matched ANY
session, so an authenticated finance officer of a second council saw Vungu's published financial
year in their workspace picker and the classifications behind published data. The published
figures are public by design — the anonymous portal serves them — but the staff surface must not
list another council's rows.

Fix: migration `197_published_select_public_session_only.sql` keeps 194's set-based published
conditions and adds a session guard on all 14 carrying tables: the authority-less public session
passes, platform staff pass, a session's own council passes — no one else. Verified live matrix:
other council 0 rows; anonymous portal unchanged (year, budget line, transaction all served);
Vungu staff unchanged; signed-in citizen unchanged.

Evidence: `test/finance-cross-tenant.test.js` (4 tests) and the full suite re-run green.

## 6. What is demonstrably working

- Public surface contains no unpublished rows: publication withdrawal immediately empties public transaction results (acceptance test "withdrawing a publication removes the data...").
- Counterparty identity is absent by construction from `v_published_transaction`; the acceptance test asserts supplier names never appear in public JSON.
- Approver/publisher separation is enforced by permissions, route checks and a database CHECK; acceptance test A7 confirms both refusals are audited.
- Requester cannot approve their own revision (A6), and original budget remains visible after a revision (A4).
- Import idempotency, duplicate file refusal, row-level exceptions and reconciliation all pass (A1-A3).
- Closed-year writes are refused through the API and around it by a trigger (A9), including project allocations and project-to-transaction links.
- A departmental head sees only their own vote (scope test).
- Public project figures follow the selected year and report other-currency allocations and spend separately, without converting or adding them (F-03/F-04 acceptance test).
- A transaction cannot be posted against a budget line from another year, through the API or by direct SQL; a currency mismatch is stored unchanged and counted (F-05 acceptance test).
- A year-on-year report compares two years by department/account/currency, shows prior and current figures and changes, and never combines USD and ZWG (F-06 acceptance test).
- The public document register is paginated, searchable and filterable by year and dataset, and a private document never appears even when its year matches (F-07 acceptance test).
- The public overview reads the council name from `public.local_authorities` rather than a constant (F-08 acceptance test).
- Reports carry council, period, generation time, currency treatment and filters; restricted columns require `finance.report.export_restricted`.
- The audit trail records structured before/after state for publication, budget-revision and import-commit transitions, not only who called which route.
- The public portal returns no HTTP 500 and no statement timeouts across 32 load runs at 2k/10k/20k/50k transactions and concurrency 1/10/30/50, after the publication-policy rewrite (F-13).

## 7. Recommended order of work

1. Record Council/ICT acceptance (or correction) of the architecture deviations.
2. ~~Implement finance user/scope administration (F-02) and wire `finance.users.manage_finance_roles`.~~ Done 2026-11-05.
3. ~~Fix project year scoping (F-03) and project currency aggregation (F-04), with tests.~~ Done 2026-11-05.
4. ~~Add transaction/budget-line consistency triggers (F-05), with a migration that first reports existing violations.~~ Done 2026-11-06.
5. ~~Add a year-on-year comparison report (F-06).~~ Done 2026-11-06.
6. ~~Complete public document pagination/filters (F-07), council profile lookup (F-08), and the missing exposure test (F-11).~~ Done 2026-11-06.
7. Re-run the full finance, frontend and acceptance suites and update all counts in `TEST-RESULTS.md`. Done 2026-11-06.
8. ~~Fix the public-portal publication-policy cost (F-13), re-run the load matrix and the security suite, and re-verify publication visibility.~~ Done 2026-11-06.
9. Obtain Council/ICT acceptance of AD-01–AD-05, an external penetration test, an off-host DR rehearsal, an accessibility audit and Council UAT.

## 8. Conclusion

The module is not a prototype: the core financial controls are real and tested. It is also not yet "done" against the specification. F-01 (role registries), F-02 (access administration), F-03 (project year scoping), F-04 (project currency aggregation), F-05 (transaction/budget-line year consistency), F-06 (year-on-year reporting), F-07 (public document pagination/filtering), F-08 (council identity lookup), F-09 and F-11 (documentation/test comment) are now fixed and tested. F-13 (public-portal performance) is also fixed and re-measured: the portal now returns zero errors and zero timeouts across 32 load runs at 2k–50k transactions.

What remains is not an unimplemented finance behaviour. It is the formal acceptance of the architectural deviations (F-10) and the operational evidence that no code audit can supply: an external penetration test, an off-host DR rehearsal, an accessibility audit, and Council UAT. On the functional acceptance criteria in §15, the only outstanding item is that record of acceptance, not a missing feature.
