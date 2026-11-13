# Database Audit

Date: 2026-11-06
Database: PostgreSQL 18.6 (`Ubuntu 18.6-0ubuntu0.26.04.1`)
Schema: `finance`, created by `migrations/188_finance_foundation.sql`, with correctness fixes in `migrations/189_finance_project_reporting.sql`, `migrations/190_finance_transaction_line_year.sql`, `migrations/191_finance_document_year.sql`, `migrations/192_finance_closed_year_project_links.sql` and `migrations/193_finance_exchange_rate_dormant.sql`
Observed in `vungu_dev`: 25 tables + 4 views, 33 permissions, 115 role-permission grants, 0 publication rows.

Migrations 189-193 add no tables or views: 189 adds `project_allocation.financial_year_id` (with a trigger and a composite FK), a supporting unique index on `budget_line (id, financial_year_id)`, and replaces `v_project_performance` with a one-row-per-project definition; 190 adds a transaction/budget-line year trigger; 191 adds `document.financial_year_id` with a subject-derived trigger and an index for the public register; 192 extends the closed-year trigger to `project_allocation` and `project_transaction`; 193 only adds `COMMENT` text declaring the exchange-rate table intentionally dormant.

## 1. Inventory

Tables (25): `account`, `activity`, `approval_threshold`, `budget_line`, `budget_revision`, `column_mapping`, `commitment`, `department`, `document`, `exchange_rate_policy`, `financial_year`, `import_batch`, `import_exception`, `import_row`, `permission`, `programme`, `project`, `project_allocation`, `project_transaction`, `publication`, `role_permission`, `setting`, `transaction`, `user_permission_override`, `user_scope`, `variance_explanation`.

Views (4): `v_budget_line_performance`, `v_department_performance`, `v_project_performance`, `v_published_transaction`.

Functions: `finance.assert_year_open()`, `finance.touch_updated_at()`, `finance.set_project_allocation_year()` (migration 189), `finance.assert_transaction_line_year()` (migration 190), `finance.set_document_year()` (migration 191).

## 1b. Chain integrity — verified and repaired 2026-11-07

A freshly migrated database (the acceptance harness, and therefore any fresh deployment) was
missing migrations 181–187: they had been applied to dev by hand and never added to the allowlist.
Two of them were also not chain-safe as written (186 replaced a view by dropping a column —
impossible with CREATE OR REPLACE; 187 referenced extract tables the chain does not create and
inserted into tables migration 172 had already tenanted). New migrations closed two further gaps
the chain alone could never satisfy:

| Migration | What it does | Why |
|---|---|---|
| 181–187 (listed) | statutory registers, custodian scaffolds, acua subunits, runtime gap tables, use-case columns, zoning lookup view, register fills | routes read these columns; stand allocation 500'd without 185 |
| 195 | `land.parcel.estimated_accuracy_m` (nullable metres) | `/api/context/parcels` reads it; the column's migration never existed |
| 196 | restores `pending_payment` to the permit status CHECK | 085 rebuilt the CHECK without 077's value; the online application-fee flow was refused for every chain-built database since |
| 197 | `published_select` guarded to the public session + own council | cross-tenant read found by two-council probing (see SECURITY-AUDIT S-03) |

186 and 187 were rewritten in place (idempotent, guarded; a chain-built and a hand-built database
both converge). `scripts/migrate.test.js` pins the allowlist; its expectation includes all of the
above. A fresh chain build (`prepare-acceptance-db.js --fresh`) now completes, seeds, and passes
all 8 acceptance suites.

The original inventory follows.

## 2. Money and currency

- `finance.money` is `numeric(18,2)`; no monetary column uses floating point (`migrations/188_finance_foundation.sql:57-60`).
- `finance.currency_code` is a domain restricted to `USD` and `ZWG` (`:51-55`). Adding a currency requires a migration, deliberately.
- Budget lines and transactions carry their own currency; reports and public summaries group by currency and never add across currencies.
- `finance.exchange_rate_policy` exists but no conversion is applied; decision D4 records that no rate basis has been approved.

## 3. Controls

| Control | Implementation | Assessment |
| --- | --- | --- |
| Tenant isolation | `authority_id` defaults to `app.authority_id()` on every finance table; `tenant_select` policies; `systemOf` for system tables | Strong |
| Public exposure | `published_select` policies require a live publication row per year/dataset; documents additionally require `visibility = 'public'` | Strong |
| Closed year | `finance.assert_year_open` trigger on `budget_line`, `budget_revision`, `transaction`, `commitment`, `import_batch` | Strong, but see gap D-04 |
| Separation of duties | CHECK on revisions (`decided_by <> requested_by`); publication CHECK requires both approver and publisher | Strong |
| Audit immutability | `admin_audit_event_guard` trigger from migration 132 | Strong |
| Soft deletion | `deleted_at`/`deleted_by` on financial tables; routes retire rather than delete where records exist | Strong |
| Optimistic concurrency | Not consistently present on budget lines; revisions are append-only | Adequate for current workflow |
| Indexes | 45 index statements in migration 188, including year, department, account, date, project and publication state | Adequate; load untested |

## 4. Findings

### D-01 — Medium — Transaction year not tied to its budget line (RESOLVED; currency deliberately reported)
`finance.transaction` has `financial_year_id`, `currency` and `budget_line_id` as independent columns (`migrations/188_finance_foundation.sql` transaction table). No trigger or composite FK required the budget line to belong to the same year. Import validation did check this, but direct SQL and future adapters could bypass it.

Resolved for the year in `migrations/190_finance_transaction_line_year.sql`. `finance.assert_transaction_line_year()` runs `BEFORE INSERT OR UPDATE` on `finance.transaction`, resolves the line's year and raises `check_violation` on a mismatch. The migration pre-checks live rows and refuses to enable the trigger while cross-year violations exist, reporting the count; it does not silently rewrite them.

Currency is intentionally not a hard rejection. `v_budget_line_performance` stores the mismatched actual, excludes it from that line's totals and counts it in `actual_currency_mismatch_rows` (`migrations/188_finance_foundation.sql:796-875`), which is what specification §6.4 and acceptance A8 require: the fault must be visible, not converted or dropped. `v_project_performance` reports the same count for project spend.

### D-02 — Medium — `v_project_performance` duplicates projects and drops mismatched spend (RESOLVED)
The original `alloc` CTE grouped by `(project_id, currency)`, and the view joined one allocation row per currency (`migrations/188_finance_foundation.sql:900-946`). A project with USD and ZWG allocations therefore appeared twice. The `spend` join was restricted to the allocation currency (`sp.currency = al.currency`), so spend in the other currency was omitted without a mismatch counter.

Resolved in `migrations/189_finance_project_reporting.sql`. The replacement view returns exactly one row per project. Amounts remain in the project's own currency (`finance.project.currency`); allocations and spend in another currency are returned as `other_currency_allocations` / `other_currency_spend` JSON objects and counted in `allocation_currency_mismatch_rows` / `actual_currency_mismatch_rows`. Nothing is converted or added across currencies. The view carries `security_invoker = true`, and the migration re-grants `SELECT` to `vungu_app` and re-runs `tenancy.classify` because a recreated view loses the original grant and classification.

Verification: acceptance test "F-03 and F-04: public projects follow the selected year and report other currencies separately" injects a ZWG allocation and a ZWG transaction against a USD project and asserts one project row with separate currency figures.

### D-03 — Medium — Projects have no financial-year column (RESOLVED)
`finance.project` has dates and status but no `financial_year_id`. Allocations reference a budget line (which has a year) and transactions have a year. Public project queries therefore could not filter by year without joining through allocations/transactions. This was the schema cause of public finding F-03.

Resolved in `migrations/189_finance_project_reporting.sql` by storing the year on the allocation rather than on the project: `finance.project_allocation.financial_year_id` is populated from the budget line by `finance.set_project_allocation_year()` and enforced by composite FK `project_allocation_line_year_fkey`, so it cannot disagree with the line. The public role can read the allocation without also being able to read an unpublished budget line. `v_project_performance` exposes `financial_year_ids` (years with an allocation or a linked transaction), and the public API filters projects and overview totals with `WHERE $1 = ANY(financial_year_ids)`.

Verification: same F-03/F-04 acceptance test publishes projects for two years and asserts the panel returns only the project with activity in the selected year.

### D-04 — Low — Year-open trigger does not cover project allocations or links (RESOLVED)
Originally `finance.assert_year_open` was attached to `budget_line`, `budget_revision`, `transaction`, `commitment` and `import_batch` (`:757-765`). `project_allocation` and `project_transaction` were not covered. The allocation route resolved the budget line and therefore inherited the line's year, but direct SQL could insert an allocation against a closed year's line or attach a project to an existing closed-year transaction.

Resolved in `migrations/192_finance_closed_year_project_links.sql`. `finance.assert_year_open()` now resolves `project_transaction` through `NEW.transaction_id`, reads `project_allocation.financial_year_id` directly (populated by migration 189's `set_project_allocation_year()` trigger, which sorts before the guard so the value is set first), and recreates the trigger on both tables.

Verification: acceptance A9 closes the year, then asserts that a direct `UPDATE finance.project_allocation` and a direct `INSERT INTO finance.project_transaction` against a pre-existing closed-year transaction are both refused with `accepts no further financial records`. It then exercises the three routes and asserts each returns HTTP 409 `year_closed`: posting a new allocation, linking a closed-year transaction, and removing an existing link.

### D-05 — Low — `finance.exchange_rate_policy` is unused (DOCUMENTED)
The table exists, but no code path applies a rate. This is honest given decision D4, but it could be mistaken for an implemented conversion feature.

Resolved as documentation in `migrations/193_finance_exchange_rate_dormant.sql`: the table and its `rate`, `rate_source` and `method` columns now carry `COMMENT` text stating that they are intentionally dormant, that no report/view/endpoint consumes a rate, and that decision D4 forbids a combined USD/ZWG total until the Council approves a source, date convention and method. `docs/finance/COUNCIL-DECISIONS.md` D4 remains the authoritative policy. No behaviour changed.

### D-06 — Low — Audit before/after coverage is inconsistent (RESOLVED for high-severity finance events)
`admin_audit_event.details` is `jsonb`, but the middleware recorded request context more consistently than entity diffs. High-severity finance events now attach a structured snapshot through `req.auditDetails`:

- **Publication** approve/reject/publish/withdraw: previous and new `state`, plus the note/reason, the acting user and any superseded version.
- **Budget revision** approve/reject: previous and new `state`, the revision's amount and currency, and the deciding user.
- **Import commit**: previous `status`/`reconciliation_status`, new `status`, rows written and rows skipped as duplicates, plus the override reason when reconciliation was overridden.
- **Finance access changes** already carried role/override/scope before-and-after (F-02).

Verification: the acceptance audit-trail test polls `public.admin_audit_event` and asserts a `FIN_PUBLICATION` row with `before.state = 'approved'` / `after.state = 'published'`, a `FIN_REVISION` row with `before.state = 'submitted'` / `after.state = 'approved'`, and a `FIN_IMPORT` row with `before.status = 'validated'` / `after.status = 'committed'` and a positive `written` count.

## 5. Verification queries used

```sql
-- schema inventory
SELECT table_name FROM information_schema.tables WHERE table_schema = 'finance' ORDER BY 1;
SELECT table_name FROM information_schema.views  WHERE table_schema = 'finance' ORDER BY 1;

-- money and currency domains
SELECT typname, typtype FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace WHERE n.nspname = 'finance';

-- seeded catalogue
SELECT count(*) FROM finance.permission;          -- 33
SELECT count(*) FROM finance.role_permission;     -- 115

-- applied migration
SELECT count(*) FROM finance.financial_year;      -- 1 (DEMO 2027)
```

## 6. Conclusion

The schema is well designed for the financial controls the specification cares about: fixed-precision money, currency isolation, closed-year protection, append-only audit, publication-driven public access and soft deletion. All four medium findings are now closed: project year scoping, multi-currency project aggregation, transaction/budget-line year consistency and the two missing closed-year trigger targets (D-01 to D-04, migrations 189, 190 and 192) are fixed and covered by acceptance tests. Migration 191 adds a subject-derived `document.financial_year_id`, so the public document register is year-scoped without trusting a typed value. D-05 is documented in the schema as intentionally dormant, and D-06 is closed for the high-severity finance transitions, which now carry structured before/after audit details. No integrity defect remains open.
