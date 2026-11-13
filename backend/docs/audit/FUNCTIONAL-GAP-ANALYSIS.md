# Functional Gap Analysis

Date: 2026-11-06
Companion to `SYSTEM_AUDIT_REPORT.md` and `REQUIREMENTS-TRACEABILITY-MATRIX.csv`.

Severity: **Critical** blocks go-live; **High** required by a specification use case or acceptance criterion; **Medium** correctness/reporting defect; **Low** documentation/usability.

## 1. Gap register

| ID | Severity | Gap | Specification | Current behaviour | Required behaviour |
| --- | --- | --- | --- | --- | --- |
| G-01 | ~~High~~ **Closed** | Per-user finance overrides and departmental scopes cannot be administered | §2.2, §2.3, UC-12 | Closed 2026-11-05: `src/routes/finance-users.js` and `AccessSection.vue` now provide list, read and replace; see C-02 | Authorised administrator can grant/deny individual permissions, set department scope, and see the effective permission set before saving |
| G-02 | ~~Medium~~ **Closed** | Public project data is not year-scoped | §3.1, §3.6 | Closed 2026-11-05: `project_allocation.financial_year_id` + `v_project_performance.financial_year_ids`; public project and overview queries filter by the selected year; see C-03 | Projects shown for the selected year, based on allocations and/or linked transactions in that year, with the year's figures |
| G-03 | ~~Medium~~ **Closed** | Multi-currency projects duplicate rows and hide spend | §6.4 | Closed 2026-11-05: `v_project_performance` returns one row per project, reports other-currency allocations/spend separately and counts mismatches; see C-03 | One row per project with per-currency amounts, or an enforced single allocation currency; explicit mismatch count |
| G-04 | ~~Medium~~ **Closed** | No database guarantee that a transaction's year and currency match its budget line | §6.4, §8.1 | Closed 2026-11-06: migration 190 refuses a cross-year budget-line link at the database; currency mismatch stays stored and counted by design (§6.4/A8); see C-04 | Trigger refuses the cross-year write; a currency mismatch is recorded and surfaced, never converted |
| G-05 | ~~Medium~~ **Closed** | No year-on-year / historical comparison report | §3.9 | Closed 2026-11-06: `year_on_year` report compares `financial_year_id` with `compare_financial_year_id`, grouped by department/account/currency with prior/current/change figures; see C-05 | A comparison report by year, department/account, grouped by currency, with metadata |
| G-06 | ~~Low~~ **Closed** | Public documents are unpaginated and cannot be filtered by year/dataset | §3.1 | Closed 2026-11-06: migration 191 derives `finance.document.financial_year_id`; the endpoint accepts year/dataset/search/sort/limit/offset and returns `total`; the panel pages 25 at a time; see C-06 | Pagination, period/dataset filters, deterministic sorting |
| G-07 | ~~Low~~ **Closed** | Public overview hardcodes the council name | §1.1, §7 | Closed 2026-11-06: the overview reads `public.local_authorities.authority_name`; see C-06 | Read council profile/configuration |
| G-08 | ~~Low~~ **Closed** | Named public-exposure regression test is missing | §13.1 | Closed 2026-11-06: the stale comment now cites the acceptance public-exposure/withdrawal tests that actually assert the property (F-11) | Create the test or correct the comment |
| G-09 | ~~Low~~ **Closed** | Finance role-management permission is not enforced | §2.2 | Closed 2026-11-05: `finance-users.js` enforces `finance.users.manage_finance_roles`; F-02 proves a non-holder gets 403 | — |
| G-10 | ~~Low~~ **Closed** | Test counts in finance docs are stale | §13 | Closed 2026-11-06: counts regenerated from the executed suites (71 unit, 29 acceptance, 66 frontend) | — |

## 1b. Closed in the 2026-11-07 system-wide pass

| Gap | Was | Now |
|---|---|---|
| ERP account linking (GIS/revenue) | every inbound `AccountLinked` event failed 23502 since migration 172; the Tsamba seed could not run, so five acceptance suites were unrunnable | envelope carries `authority_code`, resolved and validated; cross-council guards on both handlers; 7-test suite in the `test:db` set |
| Online application-fee payment | permit created `pending_payment` refused by the CHECK since migration 085 — citizen payment flow 500 on any chain-built database | migration 196 restores the status; both payment suites green |
| "What is around this place" (`/api/context/parcels`) | 500 on chain-built databases — the service reads `land.parcel.estimated_accuracy_m`, which no migration created | migration 195 adds the column; 12-test suite green |
| QGIS project extent (layer catalogue) | `null` for every real project — the parser read `.extent` off an array when the project has 2+ map canvases | first-canvas fix; suite green |
| Acua stands layer styling | layer shipped (183) with no style — portal served it unstyled; extractor suite failed | registry v1 published (status-coloured, matching its parent register), canonical QML generated |
| Fresh-deployment migration chain | 181–187 applied by hand and missing from the allowlist; fresh builds 500'd on stand allocation and more | listed; 186/187 rewritten chain-safe; fresh build + all acceptance suites green |
| Cross-tenant staff reads (finance) | another council's staff saw published finance rows in the staff workspace | migration 197 session guard; 4-test regression; live 4-cell matrix verified |

The original register follows.

## 2. Closed in this audit

| ID | Gap | Fix | Evidence |
| --- | --- | --- | --- |
| C-01 | Finance roles absent from application role registries; admin/invite routes rejected them | Added seven finance roles to `src/routes/auth.js` (`INVITABLE_ROLES`, `VALID_USER_ROLES`) and `src/config/permissions.js` (`FINANCE_ROLES`, `ALL_ROLES`, `STAFF_ROLES`, labels) | `test/finance-roles.test.js` passes (3 tests); finance unit suites unaffected (69 passed) |
| C-02 | Finance-specific access administration missing and `finance.users.manage_finance_roles` decorative (G-01, S-01, S-02) | Added `src/routes/finance-users.js` (list, read, replace role/overrides/scope), `AccessSection.vue`, route registration, and `req.auditDetails` support in `auditLog.js` | Acceptance F-02 passes (29/29); frontend access spec passes (4 tests); audit row carries reason plus before/after role, overrides, scope and effective permissions |
| C-03 | Public project data not year-scoped and multi-currency project rows duplicated (G-02, G-03) | Migration 189: allocation year stored and protected by a composite FK; `v_project_performance` returns one row per project with `financial_year_ids`, separate other-currency amounts and mismatch counts; public project/overview queries filter by year; frontend sends the selected year and shows other currencies separately | Acceptance F-03/F-04 test passes; full finance suite 29/29; frontend 53 tests |
| C-04 | Transaction can be posted against a budget line from another financial year (G-04) | Migration 190: `finance.assert_transaction_line_year()` + `trg_transaction_line_year` refuse a cross-year link on insert or update, after a pre-check that blocks enabling the trigger over existing violations. Currency mismatch deliberately remains a stored, counted fault per §6.4/A8 | Acceptance F-05 test passes; full finance suite 29/29 |
| C-05 | No year-on-year or historical comparison report (G-05) | `year_on_year` report in `finance-reports.js`: current year plus comparison year, `FULL OUTER JOIN` over `v_budget_line_performance`, grouped by department/account/currency, prior/current/change columns, both years in metadata and exports; frontend selects the comparison year | Acceptance F-06 test passes; full finance suite 29/29; frontend 53 tests |
| C-06 | Public documents unpaginated/unfiltered, council name hardcoded, and a stale exposure-test reference (G-06, G-07, G-08) | Migration 191 derives and indexes `finance.document.financial_year_id`; the public documents endpoint gains year/dataset/subject/type/search/sort/limit/offset and `total`; the overview reads the authority name; the stale comment now cites the real acceptance tests; the public panel pages documents | Acceptance F-07/F-08 test passes; full finance suite 29/29; frontend 53 tests |

## 3. Detailed recommendations

### G-01 — Finance access administration (closed 2026-11-05)

Delivered shape:
- `GET /api/finance/users` — list staff with their finance role, override/scope counts, and the
  permission defaults of the seven finance roles.
- `GET /api/finance/users/:id/access` — role defaults, overrides, departmental scope and the
  server-computed effective permission set.
- `PUT /api/finance/users/:id/access` — replace role, overrides and scope in one transaction. A
  written reason is mandatory; self-editing is refused.
- All three are guarded by `finance.users.manage_finance_roles`, not `requireAdmin`.
- `auditLog.js` now merges a route-supplied `req.auditDetails`; the access route records the reason
  and the before/after role, overrides, scope and effective permissions, without copying account
  PII into the trail.
- `AccessSection.vue` is the administrator-only screen: search, role picker, scope picker,
  per-permission inherit/grant/deny, effective count and required reason.

Evidence: acceptance F-02 (technical administrator succeeds; finance administrator without the
permission gets 403; deny wins; unknown permission refused; self-edit refused; audit details
present); frontend `access.spec.ts` (4 tests); `vue-tsc --noEmit` clean for the module.

### G-02 and G-03 — Project year and currency correctness

The schema needs a deliberate decision: is a project year-bound or multi-year? The specification's project entity has dates and an approved budget, while allocations and transactions carry the financial year. Recommended:
1. Keep projects multi-year.
2. Add `financial_year_id` to `project_allocation` (already present) and scope public project results with `EXISTS` on allocations or linked transactions for the selected year.
3. Replace `v_project_performance` with two views:
   - `v_project_performance_year` grouped by `(project_id, financial_year_id, currency)`;
   - `v_project_performance` one row per project, with JSON/array per-currency totals and explicit mismatch counts.
4. Enforce one allocation currency per project per year in the allocation route, or expose per-currency rows deliberately in the UI.
5. Add acceptance tests for a USD/ZWG project, a project with no allocations, and a project whose transaction currency differs from its allocation.

### G-04 — Transaction/budget-line consistency (closed 2026-11-06)

Migration `190_finance_transaction_line_year.sql` adds a `BEFORE INSERT OR UPDATE` trigger on
`finance.transaction`:
- If `budget_line_id IS NOT NULL`, the line's `financial_year_id` must equal the transaction's year;
  otherwise the write is refused with `check_violation` and a hint about posting to the right year.
- `budget_line_id IS NULL` remains allowed for genuinely unallocated transactions.
- Currency is not hard-rejected. §6.4/A8 require a mismatched-currency actual to be stored, excluded
  from the line's totals and counted in `actual_currency_mismatch_rows`, so the fault is visible
  rather than silently converted or dropped. `v_budget_line_performance` and
  `v_project_performance` both expose that count.
- The migration runs a pre-check and refuses to enable the trigger while live cross-year rows exist,
  naming the count; it does not silently delete or rewrite them.

Evidence: acceptance F-05 inserts a cross-year transaction and a cross-year update (both refused),
and a same-year ZWG/USD mismatch (stored unchanged and counted).

### G-05 — Year-on-year report (closed 2026-11-06)

`year_on_year` is in `REPORT_NAMES` and the catalogue. It accepts `financial_year_id` (the current
year) and `compare_financial_year_id` (the prior year); both are required and the same year is
refused. The report groups by department, account and currency and shows:
- prior-year revised budget, current-year revised budget and the change;
- prior-year actual, current-year actual and the change;
- department/account identity and currency.

A `FULL OUTER JOIN` keeps a line that exists in only one of the two years. Currency is a join and
grouping key, so USD and ZWG are separate rows and are never netted or converted. The metadata
block names both years and their statuses; the same built report feeds the CSV, XLSX and PDF
exports.

Evidence: acceptance F-06 prepares 100,000 USD in 2031 and 120,000 USD in 2034 for the same
department/account, asserts the comparison row and 20,000 change, checks both missing-year and
same-year refusals, and confirms the CSV export contains both year labels.

### G-06 to G-10 — Smaller corrections

- Documents (done 2026-11-06): `migrations/191_finance_document_year.sql` derives
  `finance.document.financial_year_id` from the subject (budget line, revision, transaction, import
  batch, publication or year) and indexes it. The public documents query accepts
  `financial_year_id`, `dataset`, `subject_kind`, `document_type`, `q`, `limit`, `offset`, `sort` and
  `direction`, returns `total`, and orders deterministically. Project and report documents stay
  multi-year/yearless and are reachable through the `projects`/`reports` dataset filter.
- Council name (done 2026-11-06): the overview reads `public.local_authorities.authority_name`,
  falling back to the Vungu name only if the register row is missing.
- Exposure test (done 2026-11-06): the stale reference was corrected to the acceptance
  public-exposure and publication-withdrawal tests that assert the property end to end; no duplicate
  test was added.
- Permission: done 2026-11-05 — `finance.users.manage_finance_roles` is enforced on the
  access-administration routes; `requireAdmin` remains only for account lifecycle.
- Docs: done 2026-11-06 — counts replaced with the command output in `TEST-RESULTS.md`.

## 4. Acceptance criteria mapping

| Specification §15 criterion | Status | Note |
| --- | --- | --- |
| Authorised users receive role-appropriate access | Met | Roles assignable (C-01); overrides/scopes administered and audited (C-02) |
| Administrators manage financial years and classifications | Met | |
| Finance users import files and see validation errors | Met | |
| Repeated imports do not duplicate transactions | Met | A1 |
| Imported totals reconcile to control totals | Met | A3 |
| Original budgets and approved revisions separately retained | Met | A4 |
| Budget, revenue and expenditure calculations pass tests | Met | A8 |
| Users explore published data from summary to permitted detail | Met | A7 |
| Public users cannot access unpublished/restricted records | Met | A7; acceptance public-exposure and withdrawal tests |
| Projects created, approved and linked to transactions | Met | A10; year scoping and currency separation fixed (C-03) |
| Reports filtered/exported with period and currency labels | Met | Year-on-year comparison delivered (C-05) |
| Significant changes and approvals audited | Met | |
| Backup restoration demonstrated | Met on a test instance | `BACKUP-RESTORE-EVIDENCE.md`: 0 mismatches, 190/190 uploads; off-host DR still required |
| Council UAT signed off | Not met | Not performed |
