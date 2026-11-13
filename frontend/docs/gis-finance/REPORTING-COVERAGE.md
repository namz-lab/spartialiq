# Reporting and export coverage — Vungu RDC GIS-integrated budget system

**Produced** 2026-11-08. **Type** read-only audit. Nothing in this document was implemented; the
only write this audit made was this file.

**Repositories inspected**
- Frontend `/home/theo-madzinaga/Documents/Manicipal-drums-frontend` (finance module
  `src/modules/finance/`, report UI `src/modules/finance/pages/sections/ReportsSection.vue`).
- Backend `/home/theo-madzinaga/Documents/Manicipal-drums-backend-3` (`src/routes/finance-reports.js`,
  687 lines; migrations 188–199). **`CLAUDE.md` names `../app-backend`; that path does not exist** —
  every backend citation below is against `Manicipal-drums-backend-3`.
- Functional baseline `~/Downloads/Vungu_RDC_Municipal_Budget_System_Technical_Specification.docx`
  (read in full; cited by its own section numbers, e.g. §3.9). The repo-root
  `VUNGU_RDC_CLAUDE_CODE_PROMPT.md` is the engineering prompt over that baseline; it names no
  individual report, it names the nine personas (`VUNGU_RDC_CLAUDE_CODE_PROMPT.md:26`) and requires
  "reports, exports, documents, controlled publication, and audit history"
  (`VUNGU_RDC_CLAUDE_CODE_PROMPT.md:20`).

**Status of the question asked.** "Every user must have all the reports they need" is **not**
satisfied today. The nine reports are well built where they exist — one builder shared by screen and
file (`finance-reports.js:91-397`), provenance in all three formats, no cross-currency total
anywhere — but the catalogue is a *single annual slice per dimension*. There is no period
(monthly/quarterly) report, no ward/spatial report although the views for one already exist, no
capital/recurrent or funding-source dimension although the columns exist, and four of the eight
roles cannot produce a file at all. Three defects let an exported file misstate its own scope.

**Compliance posture.** Nothing here asserts legal compliance. The Zimbabwe statutory material in
Part A is **evidence to cite**, gathered from secondary and news sources with the primary Acts
largely behind 403s; every item marked `ZW` is a candidate **decision-register item under D8**
(statutory report formats and formulas), not an implementation assumption.

---

## Part A — The authoritative reporting-needs list

Source tags: `SPEC` = the baseline DOCX; `PROMPT` = `VUNGU_RDC_CLAUDE_CODE_PROMPT.md`;
`REQ` = `docs/finance/REQUIREMENTS.md`; `ROLE` = a duty implied by a role's permissions in
`migrations/188_finance_foundation.sql`; `GIS` = `docs/gis-finance/ARCHITECTURE-ASSESSMENT.md`
(binding §6.1); `ZW` = Zimbabwe statutory/management research (URLs in Part G).

Status: **HAVE** = exists and does what its name says; **PARTIAL** = exists but incomplete or
mis-described; **ABSENT** = nothing produces it.

| # | Reporting need | Source | Status | Evidence |
|---|---|---|---|---|
| N1 | Annual budget report (original, adjustments, revised per line) | SPEC §3.9, §6.1 | HAVE | `budget_vs_actual`, `finance-reports.js:171-206` |
| N2 | Budget-versus-actual analysis | SPEC §3.9 | HAVE | `finance-reports.js:171-206` over `v_budget_line_performance` (`188:796-868`) |
| N3 | Revenue report by **revenue source** with collections and variance | SPEC §3.4, §3.9 | PARTIAL | `revenue_performance` groups by **department**, not source, and omits variance: `finance-reports.js:208-237`; catalogue claims "revenue source" at `finance-reports.js:72` |
| N4 | Expenditure report by account, department, programme, activity, budget line | SPEC §3.5 | PARTIAL | `expenditure_performance` is department-only (`finance-reports.js:208-237`); no programme/activity grouping anywhere |
| N5 | Variance report, with authorised variance explanations | SPEC §3.5, §6.2, §6.3 | PARTIAL | `variance` column on `budget_vs_actual` only (`finance-reports.js:204`); `finance.variance_explanation` (`188:492`) is read only in the budget-line detail (`finance-budget.js:175`) and appears in no report |
| N6 | Departmental summary | SPEC §3.9 | HAVE | `finance-reports.js:208-237` over `v_department_performance` (`188:877-895`) |
| N7 | Project / capital-investment performance | SPEC §3.6, §3.9 | PARTIAL | `project_performance` exists (`finance-reports.js:240-273`) but **ignores the financial year it prints on its cover** — see Gap 2 |
| N8 | Year-on-year comparison | SPEC §3.9 | HAVE | `year_on_year`, FULL OUTER JOIN with currency as a join key, `finance-reports.js:110-169` |
| N9 | Budget revisions and approvals history | SPEC §3.3, UC-09 | HAVE | `finance-reports.js:275-310` |
| N10 | Transaction register with source references | SPEC §3.7 | PARTIAL | `finance-reports.js:312-356`; silent `LIMIT 100000` at `:330` |
| N11 | Import reconciliation against declared control totals | SPEC §3.8, §6.5 | PARTIAL | `finance-reports.js:358-393`; **no department scoping** at `:370` |
| N12 | Row-level import error report | SPEC §3.8 | PARTIAL | `/finance/imports/:id/exceptions` JSON only (`finance-imports.js:893`); not a report, not exportable |
| N13 | Overspending / near-exhausted / unusual-movement flags against configurable thresholds | SPEC §3.5 | PARTIAL | `/finance/exceptions/budget` JSON, `LIMIT 500` (`finance-budget.js:717-756`); not in the report catalogue, not exportable |
| N14 | Charts for revenue, expenditure, execution and project performance | SPEC §3.9, Appendix A | ABSENT | no chart in the finance module: `ReportsSection.vue` renders a table only (`:244-262`); `FinanceOverviewSection.vue` (362 lines) contains no chart markup |
| N15 | PDF / XLSX / CSV export subject to permissions | SPEC §3.9, REQ Slice 5 | PARTIAL | three formats built from one report (`finance-reports.js:519-555`); four of eight roles hold no export permission — see Part C |
| N16 | Council identity, reporting period, generation date, currency and applied filters on every report | SPEC §3.9 | PARTIAL | `reportMeta` (`finance-reports.js:400-428`) on screen (`ReportsSection.vue:222-226`), in CSV (`spreadsheet-write.js:161-167`), XLSX "About this export" sheet (`spreadsheet-write.js:52-58`) and the PDF cover (`report-pdf.js:170-183`) — but "Filters applied" is echoed from the query string, not from what the SQL used (Gap 3) |
| N17 | Reporting cut-off date and data freshness visible | SPEC §6.5 | PARTIAL | reports carry "Generated at" only (`finance-reports.js:424`); `finance.publication.data_as_at` exists (`188:702`) and is not carried onto reports |
| N18 | Reporting currency identified; no cross-currency aggregation | SPEC §6.4, test §13.1 | HAVE | proof in Part E.3 |
| N19 | Restricted (counterparty) columns need their own permission, and the file says so | SPEC §2.3 | HAVE | `finance-reports.js:319`, `:349-354`, `:498-504`; filename `-RESTRICTED-` at `:57`; per-page PDF mark `report-pdf.js:266-269` |
| N20 | Audit search and authorised audit export | SPEC §3.10, UC-08 | PARTIAL | `/finance/audit` (`finance-reports.js:570-616`), `/finance/audit/export` (`:618-684`); export takes **only** `from`/`to`/`format` (`:620-629`) and no export of any kind is itself audited (Gap 5) |
| N21 | Public downloadable approved budgets, reports and financial statements | SPEC §3.1, Appendix A | PARTIAL | public portal serves **uploaded documents** only (`finance-public.js:414`, `CouncilFinanceView.vue:623-624`); no public generated-report export route exists |
| N22 | Publication date, reporting period and data currency beside every public dataset | SPEC §3.1 | HAVE | `finance-public.js:100-105`, `188:680-710` |
| N23 | Capital and recurrent reported separately | SPEC §3.5/§6 (asserted in-schema at `188:213-214`) | ABSENT | `finance.account.expenditure_class` exists; no report groups, filters or splits by it |
| N24 | Funding source distinguished (internally generated, grants, transfers, other) | SPEC §3.3, §3.4 | ABSENT | `budget_line.funding_source_account_id` (`188:403`), `project.funding_source_account_id` (`188:525`); no report uses either |
| N25 | Commitments register | SPEC §3.3, glossary | PARTIAL | `open_commitments` is a column on two reports; `/finance/commitments` (`finance-budget.js:585`) has no report or export |
| N26 | Nine personas each reach the reports their duties require | PROMPT (`:26`), SPEC §2.2 | PARTIAL | Part C |
| N27 | Least-privilege, department-scoped data for a departmental head | PROMPT (`:26`), SPEC §2.3 | PARTIAL | scope is per-user data, not conferred by the role (`financePermissions.js:89-101`) — Gap 8 |
| N28 | Ward-level / map-based finance report | GIS §6.1, §6.3; ZW4 | ABSENT | `v_ward_performance` (`199:95-164`), `v_budget_ward_attribution` (`199:35-83`) and `v_unlocated_finance` (`199:178-204`) are computed and exposed as JSON at `/finance/map/wards` (`finance-spatial.js:322-382`) but appear in **no** report and in **no** export |
| N29 | "Unlocated" reported as a first-class bucket in any figure that claims to be geographic | GIS §6.1 rule 4 | PARTIAL | honoured by the map endpoint (`finance-spatial.js:300-315`); no report states it |
| N30 | Printable/PDF map for a committee pack | GIS §6.4; SPEC §3.9 (PDF) | ABSENT | `src/map/tools/mapExport.ts:63` `exportMapToPdf()` exists and is not referenced by the finance module (no match in `MapSection.vue`) |
| N31 | Spatial-allocation register (who split what, on what methodology) | GIS §6.1 rule 7, D15 | PARTIAL | `/finance/spatial-allocations` JSON (`finance-spatial.js:93`); no report, no export |
| N32 | Monthly management accounts | ZW1 | ABSENT | no report has a period dimension; `from`/`to` are honoured **only** by `transaction_register` (`finance-reports.js:326-327`) and aggregate nothing |
| N33 | Quarterly financial report to the parent Ministry (copy to Treasury), by mid-month after quarter end | ZW2 | ABSENT | as N32; no cadence mechanism exists (Part E.7) |
| N34 | Annual financial statements / year-end budget-execution statement for the Auditor-General | ZW3 | ABSENT | no year-end statement report; the system is deliberately not a general ledger (SPEC §1.3), so the realistic deliverable is a budget-execution statement plus an audit evidence pack |
| N35 | Devolution / intergovernmental-transfer reporting: separate books of account per the Ministry circular, project acquittals | ZW4 | ABSENT | needs N24 (funding source) + N28 (ward) + project linkage; none of the three is in a report |
| N36 | Budget estimates submitted to the Minister in the parent-Ministry format (the LADS/budget-call-circular format) | ZW5 | ABSENT | nothing generates a submission-format file; **D8 open** |
| N37 | Programme-based budgeting presentation | ZW6, SPEC §3.3 | ABSENT | `finance.programme` / `finance.activity` exist (`188:168`, `188:185`); no report groups by them; **D3 open** |
| N38 | Debtors / arrears (outstanding revenue) by area | ZW7, SPEC §3.4 | BLOCKED | no arrears amount exists anywhere — **D13** |
| N39 | Asset register with financial values | ZW7 | BLOCKED | `council_ops.*` registers are empty (ARCHITECTURE-ASSESSMENT §7) |
| N40 | Physical-progress vs financial-execution exception report | GIS §6.2.5, SPEC §3.6 | BLOCKED | `physical_progress_percent` does not exist — **D12** |
| N41 | Reports runnable per ward against the Council's own ward list | GIS §6.3 | BLOCKED | `admin.authority_ward` has 0 rows — **D11**; `v_ward_performance.ward_status` honestly reports `unlinked` (`199:139-146`) |

---

## Part B — The nine existing reports, claim versus computation

All nine are guarded by one permission, `finance.report.view` (`finance-reports.js:63`), and
exporting any of them by `finance.report.export` (`:64`). All nine are built by one function
(`:91-397`) shared by the JSON and the export paths, so a screen and a file cannot disagree.

### 1. `budget_vs_actual` — "Budget versus actual"
Claims: requires `financial_year_id`; grouped by currency, department, account (`:71`).
Computes: one row per budget line from `v_budget_line_performance` joined to department and account,
filtered by year, optional `department_id`, and the caller's department scope (`:171-186`). All seven
§6.1 measures plus both available-balance definitions and `variance`.
**Discrepancy:** none in what it computes. It is a *line listing*, not a grouped report — "grouped by"
in the catalogue describes the sort order (`ORDER BY d.code, a.code, p.code`), not aggregation. No
programme/activity/ward/funding-source/expenditure-class dimension.

### 2. `revenue_performance` — "Revenue performance"
Claims: grouped by currency and **revenue source** (`:72`).
Computes: `v_department_performance` filtered to `account_kind = 'revenue'`, grouped by department,
kind and currency (`:208-222`).
**Discrepancy — material.** There is no revenue-source dimension in the query, and none exists in the
schema to group by (the nearest column, `funding_source_account_id`, is unused). The report is a
revenue-filtered departmental summary. It also omits `variance`, which §6.2 defines specifically for
revenue (actual − revised), although the per-line view computes it (`188:850-856`). No period/trend
dimension, so §3.4's "collection trends by period and source" is unmet.

### 3. `expenditure_performance` — "Expenditure performance"
Claims: grouped by currency and department (`:73`).
Computes: the same query with `account_kind = 'expenditure'` (`:208-222`).
**Discrepancy:** accurate as described, but it is the *only* expenditure report, and §3.5 asks for
account/department/programme/activity/budget-line classification and overspend flags. Omits
`variance` and `available_including_commitments`. No capital/recurrent split (N23).

### 4. `departmental_summary` — "Departmental summary"
Claims: grouped by currency and department (`:74`).
Computes: the same query with no `account_kind` filter — both kinds, per department, per currency
(`:208-237`).
**Discrepancy:** none. Reports 2, 3 and 4 are one query with one parameter changed.

### 5. `project_performance` — "Project performance"
Claims: `requires: []`; grouped by currency and project (`:75`).
Computes: `v_project_performance` (`189:88-196`), filtered only by `department_id` and scope
(`:240-252`).
**Discrepancy — material.** The SQL has **no financial-year filter**, yet `financial_year_id` is an
accepted parameter for every report (`:434`), is resolved into `base.financial_year` (`:92-98`), is
printed on the cover as "Financial year <label> (<start> to <end>)" (`:412`) and is put in the export
**filename** (`:515-517`). A council exporting "project performance 2026" receives all-year figures
under a 2026 heading. `v_project_performance.financial_year_ids` (`189:181-187`) exists precisely to
make this filterable and is neither used nor exported. The report also drops the view's
`other_currency_allocations` / `other_currency_spend` / mismatch counters (`189:176-181`), so a
project carrying a second currency exports as if it did not.

### 6. `year_on_year` — "Year-on-year comparison"
Claims: requires both years; grouped by currency, department, account (`:76`).
Computes: two CTEs over `v_budget_line_performance`, FULL OUTER JOIN with **currency in the join key**
(`:146-150`), so a USD line and a ZWG line are two rows and are never netted (`:114-116`).
**Discrepancy:** none. Limited to exactly two years — no multi-year trend (N32/N33 adjacent).

### 7. `budget_revisions` — "Budget revisions and approvals"
Claims: requires year; no grouping (`:77`).
Computes: `finance.budget_revision` joined to line, department and the requesting/deciding users,
with reason, state, dates and decision note (`:275-291`). Scoped.
**Discrepancy:** none. Note it lists requester and approver names — appropriate for an approval
history, and it is **not** behind `export_restricted`, which is correct (these are officers, not
counterparties) but worth recording as a deliberate reading.

### 8. `transaction_register` — "Transaction register"
Claims: requires year; restricted columns `counterparty_ref`, `counterparty_name` (`:78`).
Computes: `finance.transaction` with account, department and budget line, honouring `from`/`to`,
`department_id` and scope; counterparty columns appended only when the restricted permission resolved
true (`:312-356`).
**Discrepancy:** `LIMIT 100000` (`:330`) truncates silently. `reportMeta` then reports
`['Rows', '100000']` (`:422`) with no truncation flag, so a large register exports as a complete file
that is not one.

### 9. `import_reconciliation` — "Import reconciliation"
Claims: requires year; no grouping (`:79`).
Computes: `finance.import_batch` with file hash, size, row counts, declared control count/total/
currency, reconciled count/total and status (`:358-393`).
**Discrepancy — material.** The query takes **only** `financial_year_id` (`:370-371`): neither
`department_id` nor the caller's `scope` is applied, while `reportMeta` will still print
`department_id=…` under "Filters applied" if one was passed. Any holder of `finance.report.view`,
including a department-scoped `dept_head`, reads every import batch for the whole council.

---

## Part C — Role × report matrix

Permission facts: catalogue `188:1054-1092`; grants `188:1107-1230`; `finance.map.view`
`199:217-230`. The report section is shown to anyone holding `finance.report.view`
(`FinanceWorkspace.vue:119-121`).

| Role | Run 9 on screen (`report.view`) | Export CSV/XLSX/PDF (`report.export`) | Counterparty columns (`report.export_restricted`) | Audit search / export | Finance map (`map.view`) | Scope |
|---|---|---|---|---|---|---|
| `finance_admin` | yes (`188:1128`) | yes (`188:1129`) | yes (`188:1130`) | view only (`188:1133`) | yes | council-wide |
| `finance_officer` | yes (`188:1150`) | yes (`188:1151`) | **no** | no | yes | council-wide |
| `budget_officer` | yes (`188:1163`) | yes (`188:1164`) | **no** | no | yes | council-wide |
| `dept_head` | yes (`188:1177`) | **NO — no `report.export` grant** | no | no | yes | own departments *only if* `finance.user_scope` rows exist |
| `finance_committee` | yes (`188:1190`) | yes (`188:1191`) | no | view only (`188:1192`) | yes | council-wide |
| `publisher` | yes (`188:1201`) | **NO** | no | no | yes | council-wide |
| `auditor` | yes (`188:1210`) | yes (`188:1211`) | yes (`188:1212`) | view **and** export (`188:1213-1214`) | yes | council-wide |
| `admin` (technical) | yes (`188:1219`) | **NO** | no | view **and** export (`188:1220-1221`) | **no** (not in the `199:227` list) | council-wide |
| `planner` / `eo` / `env_officer` | `planner` yes (`188:1227`); `eo`/`env_officer` no | no | no | no | no | council-wide reads of budget/project |

**Needs versus gaps, per role**

| Role | Reports the duty requires | Gap today |
|---|---|---|
| `finance_admin` | all nine, plus import reconciliation and exception reports; monthly/quarterly packs | no period report, no ward report, no exception export (Gaps 1, 4, 15, 16) |
| `finance_officer` | prepare and validate: budget vs actual, revenue, expenditure, register, reconciliation, row-level exceptions | row-level import exceptions not exportable (Gap 16); no period report |
| `budget_officer` | budget preparation and allocation monitoring: budget vs actual, revisions, unallocated/unlocated, ward allocations | no ward/allocation report at all (Gaps 4, 29); no programme-based view (Gap 14) |
| `dept_head` | own department's budget vs actual, variance with explanations, projects — and must hand them to committee | **cannot export anything** (Gap 6); scope not guaranteed (Gap 8); variance explanations in no report (Gap 17) |
| `finance_committee` | committee pack: departmental summary, year-on-year, revisions and approvals, exceptions, PDF | has PDF; no exception report, no period pack, no ward view (Gaps 1, 4, 15) |
| `publisher` | what is about to become public, as published: dataset previews and the public figures | **cannot export** the thing being published (Gap 7); publication preview is not a report |
| `auditor` | everything, with counterparty identity, plus the audit trail | audit export cannot be filtered by actor/event/entity (Gap 19); **no export is itself audited** (Gap 5); no evidence pack (Gap 18) |
| `admin` (technical) | audit and service health only; deliberately no financial authority | correct by design. Note it holds `report.view` but no export — consistent with §2.3 |
| Public user | published budgets, reports and financial statements as downloads | documents only; no generated public export (Gap 20) |

---

## Part D — Gap list, severity-ranked

Severity: **BLOCKER** = a reporting obligation that cannot be met at all, or a defect that lets an
exported file misstate its own scope. **MAJOR** = a role cannot do its job, a stated requirement is
unmet, or a dimension that exists in the schema is unreachable. **MINOR** = reachable another way,
or presentational.

### BLOCKER

**Gap 1 — No periodic (monthly / quarterly) report. Every report is a whole-year slice.**
Evidence: `from`/`to` are accepted for every report (`finance-reports.js:437-438`) and used by
exactly one (`:326-327`); no report aggregates by month, quarter or any period. ZW1/ZW2 describe
monthly management accounts and a quarterly return to the parent Ministry as the cadence councils are
measured against; SPEC §3.4 asks for performance "by period".
Task: `period_performance` — params `financial_year_id` (required), `period` ∈ `month|quarter`
(required), `department_id?`, `account_kind?`, `expenditure_class?`, `ward_code?`. Grouping:
period bucket × currency × account_kind × department. Build on `finance.transaction.txn_date`
bucketed with `date_trunc`, joined to the period's opening/closing position from
`v_budget_line_performance` (budget figures do not vary by month, so the report must show
*cumulative* actual against the annual revised budget, and label it as such — never a pro-rated
budget, which would be an invented figure). Guard: `finance.report.view` / `finance.report.export`.
Formats: csv, xlsx, pdf. Provenance must carry the period boundaries and the data cut-off (Gap 23).

**Gap 2 — `project_performance` ignores the financial year it prints on its cover and in its filename.**
Evidence: SQL params `[departmentId, scope]` only (`finance-reports.js:252`); cover year from
`:92-98` printed at `:412`; filename from `:515-517`.
Task: add `AND ($n::uuid IS NULL OR $n::uuid = ANY(p.financial_year_ids))` using
`189:181-187`; add a `financial_year_ids` column to the output; and when no year is given, print
"all years" (the meta already does this when `financial_year` is null — the bug is that the year is
resolved and displayed while being ignored). Also surface the view's
`other_currency_allocations`, `other_currency_spend` and the two mismatch counters
(`189:176-181`). Guard unchanged. Formats: all.

**Gap 3 — "Filters applied" asserts filters the SQL did not apply.**
Evidence: `reportMeta` builds the line from the raw request query
(`finance-reports.js:421`: `Object.entries(filters)`), while `from`/`to` are honoured only by
`transaction_register` and `department_id` is ignored by `import_reconciliation` (`:370`).
Task: have `buildReport` return an `applied_filters` object listing only the parameters its branch
actually bound, and build the meta line from that; reject (400) or explicitly report as "ignored for
this report" any parameter the branch does not support. This is a provenance-integrity fix, not a
cosmetic one: §3.9 requires the applied filters, and a file that overstates its filtering is worse
than one that states none.

**Gap 4 — No ward / spatial report, although every view needed for one already exists.**
Evidence: `REPORTS` has nine ids (`finance-reports.js:37-49`), none spatial;
`v_ward_performance` (`199:95-164`), `v_budget_ward_attribution` (`199:35-83`) and
`v_unlocated_finance` (`199:178-204`) are complete, granted and classified (`199:236-253`), and reach
the UI only as JSON for the choropleth (`finance-spatial.js:322-382`). A GIS-integrated budget system
cannot hand a councillor a ward sheet.
Task: three catalogue entries.
- `ward_performance` — params `financial_year_id` (required), `currency?`, `ward_code?`,
  `include_unlocated` (default true). Grouping: ward × currency. Source: `finance.v_ward_performance`
  with `ward_status` and `unlocated_reason` as columns (they are the honest-degradation signal for
  D11). Guard: `finance.map.view` **and** `finance.report.view`; export under
  `finance.report.export`. Formats: csv, xlsx, pdf.
- `ward_budget_attribution` — params `financial_year_id`, `ward_code?`. Grouping: budget line ×
  target, with `basis` ∈ `spatial_allocation | line_ward_code | unlocated | unallocated_remainder`.
  Source: `v_budget_ward_attribution`. Same guards and formats.
- `unlocated_finance` — params `financial_year_id?`. Source: `v_unlocated_finance`. Same guards.
Provenance must include `ward_register_linked` (`finance-spatial.js:51-57`) so a file produced while
D11 is open says so on its cover.

**Gap 5 — No export of any kind is recorded in the audit trail, including RESTRICTED exports.**
Evidence: the audit hook returns early for non-mutating methods
(`auditLog.js:45` `MUTATING_METHODS = POST|PUT|PATCH|DELETE`, `:161`); both export routes are `GET`
(`finance-reports.js:486`, `:618`); no finance route writes an audit row for a read. The report UI
tells the user the opposite: "the exported file will be named RESTRICTED and the export **is recorded
in the audit trail**" (`ReportsSection.vue:186-188`). SPEC §3.10 requires material events to be
recorded, and a disclosure of supplier identity leaving the building is the clearest such event.
Task: write an explicit audit event from the export handler (`FIN_REPORT_EXPORT`, severity `high`,
`critical` when `include_restricted`) carrying report id, format, filters applied, row count and the
restricted flag; same for `FIN_AUDIT_EXPORT`. Either extend the hook to a named read-allowlist or
insert from the route — the hook's "mutating only" default is correct for the rest of the API and
should not be loosened globally. Until this lands, correct the UI claim.

### MAJOR

**Gap 6 — A departmental head cannot export any report.** `dept_head` holds `finance.report.view`
(`188:1177`) and no `finance.report.export`, so the role that owes the committee its department's
explanations can only read a screen. Task: a Council-facing decision recorded under **D6** (role
grants are delegation), then a migration adding `('dept_head','finance.report.export')`; the UI
already hides the buttons correctly (`ReportsSection.vue:200-213`).

**Gap 7 — `publisher` cannot export.** `publisher` holds `report.view` only (`188:1201`). The role
that publishes a dataset cannot produce the file of what it published. Task: as Gap 6, under D6.

**Gap 8 — A department scope is per-user data, not a property of the role.**
`departmentScope()` confines a caller only if `finance.user_scope` rows exist
(`financePermissions.js:89-101`, table `188:100`); nothing requires a `dept_head` to have one. A
`dept_head` provisioned without a scope row reads and (after Gap 6) exports the whole council, with
no indication on the file that it was unscoped. Task: (a) report the scope explicitly in provenance
("Department scope: all departments" / the named list), which makes the condition visible on every
file; (b) a check in `finance-users.js` refusing to activate a `dept_head` with no scope row, or a
documented decision that an unscoped `dept_head` is legitimate.

**Gap 9 — `import_reconciliation` ignores department scope.** `finance-reports.js:370`. Task: either
apply `scope` through `import_batch → transaction.department_id` (batches are not departmental, so
this likely means "scoped users do not get this report"), or state in the catalogue and the
provenance block that this report is council-wide by nature. Do not leave it silently unscoped.

**Gap 10 — `revenue_performance` is advertised as grouped by revenue source and is not.**
`finance-reports.js:72` versus `:208-222`. No revenue-source dimension exists to group by. Task:
short term, correct the catalogue string. Proper fix: decide the revenue-source classification under
**D2** (chart of accounts) — whether it is `account` within `kind='revenue'`, or
`funding_source_account_id`, or a new `finance.revenue_source` table — then add
`revenue_by_source` (params `financial_year_id`, `period?`; grouping source × currency; source
`v_budget_line_performance` filtered `account_kind='revenue'`).

**Gap 11 — Revenue, expenditure and departmental reports omit variance.** `v_budget_line_performance`
computes §6.2/§6.3 variance per line (`188:850-856`), `v_department_performance` does not aggregate it
and the three reports do not show it (`finance-reports.js:224-237`). Task: add
`sum(variance)` and `available_including_commitments` to `v_department_performance` (a new migration,
`DROP/CREATE` with the grant + `tenancy.classify` re-applied as 189 demonstrates at `189:198-209`),
then add the columns. §6.2 also requires the sign convention to be explained in the report legend —
the PDF cover is the place for it.

**Gap 12 — No capital/recurrent dimension.** `finance.account.expenditure_class` exists and the
migration's own comment says capital and recurrent are reported separately (`188:213-214`); no report
uses it. Task: add `expenditure_class` as a column and an optional filter on `budget_vs_actual`,
`expenditure_performance` and `departmental_summary`; add `capital_programme` (params
`financial_year_id`, grouping department × project × currency, sources `v_project_performance` +
`v_budget_line_performance` filtered `expenditure_class='capital'`).

**Gap 13 — No funding-source dimension, so devolution/grant reporting is impossible.**
`budget_line.funding_source_account_id` (`188:403`) and `project.funding_source_account_id`
(`188:525`) are unused by every report. ZW4 (Local Authorities Circular No 1 of 2019, separate
devolution books of account; quarterly acquittals) makes this a live management need. Task: add
funding source to `budget_vs_actual` and `project_performance` as a column and filter; add
`funding_source_performance` (params `financial_year_id`, `funding_source_account_id?`, `period?`;
grouping funding source × department × currency). Whether the Council's devolution grant is
identified by an account, a programme or a dedicated flag is a **D2/D8** question — do not guess it.

**Gap 14 — No programme / activity grouping anywhere.** `finance.programme` (`188:168`),
`finance.activity` (`188:185`) and `budget_line.programme_id/activity_id` exist; no report groups by
them, and the Appendix A drill-down (summary → category → department → programme → budget line) stops
at department. ZW6 (the Ministry's programme-based budgeting direction) and **D3** (hierarchy depth)
bear on this. Task: `programme_performance` (params `financial_year_id`, `department_id?`,
`programme_id?`; grouping programme × activity × currency; source `v_budget_line_performance`;
guard `finance.report.view`; formats all), plus programme/activity columns on `budget_vs_actual`.

**Gap 15 — The budget exception list is not a report.** `/finance/exceptions/budget` computes
over-budget, nearly-exhausted, spend-without-budget and currency-mismatch flags against the Council's
configured thresholds, JSON only, `LIMIT 500` (`finance-budget.js:717-756`). SPEC §3.5 requires the
flags; a committee cannot be handed them. Task: catalogue entry `budget_exceptions` (params
`financial_year_id`, `department_id?`, `flag?`; grouping none; source
`v_budget_line_performance` with the same threshold logic, thresholds printed in the provenance
block; guard `finance.report.view`/`export`; formats all). Lift or paginate the 500-row cap, and
state the cap in provenance if it stays.

**Gap 16 — Row-level import errors are not exportable.** SPEC §3.8 requires row-level error reports;
`/finance/imports/:id/exceptions` is JSON (`finance-imports.js:893`). Task: `import_exceptions`
(params `import_batch_id` required, `financial_year_id?`, `status?`; source
`finance.import_exception` + `finance.import_row`; guard `finance.report.view`; formats csv, xlsx —
a PDF of rejected rows has little use but costs nothing to allow).

**Gap 17 — Variance explanations appear in no report.** `finance.variance_explanation` (`188:492`) is
read only in the budget-line detail (`finance-budget.js:175`). SPEC §3.5 requires authorised variance
explanations and management comments to be captured *and* §3.9 requires a variance report. Task: add
the latest explanation (author, date, text) as columns on `budget_vs_actual`, or a dedicated
`variance_explanations` report (params `financial_year_id`, `department_id?`).

**Gap 18 — No year-end budget-execution statement or audit evidence pack.** ZW3: the Auditor-General
examines annual financial statements; the AG's local-authority reports repeatedly turn on
non-submission. This system is explicitly not the general ledger (SPEC §1.3), so the deliverable is
not a statutory statement — it is (a) a year-end budget-execution statement per vote and currency and
(b) a reproducible evidence pack: the year's `import_reconciliation`, `budget_revisions`,
`budget_exceptions`, publication history and the audit trail, exported together with one provenance
block. Task: `year_end_execution` (params `financial_year_id`; grouping department × account_kind ×
currency; source `v_department_performance`) and an `audit_pack` multi-sheet XLSX
(`buildXlsx` already takes a `sheets` array — `spreadsheet-write.js:48`). Formats must carry the
year's status (`open|closed|archived`, already in the meta at `finance-reports.js:413`). The exact
statement format is **D8**.

**Gap 19 — The audit export cannot be filtered.** `/finance/audit` accepts actor, event, entity,
severity, status and dates (`finance-reports.js:573-587`); `/finance/audit/export` accepts only
`from`, `to`, `format` (`:620-629`), capped at `LIMIT 100000` (`:640`). An auditor investigating one
officer or one record must export everything and filter it by hand. Task: give the export the search
endpoint's querystring, bind the same predicates, and print them in the export's meta block
(`:656-664`), which currently states only the period.

**Gap 20 — The public portal offers no generated report, only uploaded documents.** SPEC §3.1 and
Appendix A require downloadable approved budgets, reports and financial statements;
`finance-public.js:414` and `CouncilFinanceView.vue:623-624` serve `finance.document` files only.
Task: `GET /api/public/finance/export?dataset=budget|revenue|expenditure|projects&financial_year_id=…`
reading the published surfaces (`v_published_transaction` `188:951-979`, the published budget query
`finance-public.js:185`), CSV and XLSX, with the publication's `reporting_period_label` and
`data_as_at` in the meta block, no counterparty columns by construction, and nothing outside a live
publication. Guard: anonymous, RLS-gated exactly as the existing public reads.

**Gap 21 — `transaction_register` truncates silently at 100 000 rows.**
`finance-reports.js:330`; meta reports the truncated count as the row count (`:422`). Task: detect
`rows.length === LIMIT`, add `['Truncated', 'yes — first 100 000 rows by date; narrow the period']`
to the meta, and prefer keyset pagination or a streamed CSV for the full register.

**Gap 22 — No charts.** SPEC §3.9 and Appendix A require charts for revenue, expenditure, execution
and project performance; the finance module contains none (`ReportsSection.vue:244-262` table only;
`FinanceOverviewSection.vue` 362 lines, no chart). Task: on-screen charts in Overview and Reports
(execution by department, revenue vs budget by source, project spend). A chart in an exported PDF is
a larger job (`report-pdf.js` draws tables only) and should be scoped separately.

**Gap 23 — No report states its data cut-off.** Provenance carries "Generated at"
(`finance-reports.js:424`) but no data-as-at; `finance.publication.data_as_at` exists (`188:702`) and
`import_batch.committed_at` is available. SPEC §6.5 requires reporting cut-off dates and data
freshness to be visible. Task: add `['Data as at', …]` derived from the latest committed import batch
for the year and dataset, plus `['Latest transaction date', …]`.

**Gap 24 — No council-level income-and-expenditure summary for staff.** The public overview computes
council totals by kind and currency (`finance-public.js:107-128`); staff reports stop at department
rows. Task: `council_summary` (params `financial_year_id`, `period?`; grouping account_kind ×
currency, with a department breakdown sheet in XLSX; source `v_department_performance`).

**Gap 25 — No commitments register report.** `/finance/commitments` exists
(`finance-budget.js:585`); `open_commitments` is a column on two reports. The glossary and §3.3 treat
commitments as a reportable class. Task: `commitments_register` (params `financial_year_id`,
`department_id?`, `status?`; source `finance.commitment` joined to line/account/department; guard
`finance.report.view`; formats all; counterparty columns, if the table carries any, behind
`export_restricted`).

**Gap 26 — The report routes have no HTTP-level test.** `test/` contains `finance-pdf.test.js`,
`finance-spreadsheet.test.js` and `finance-roles.test.js`; none exercises `/finance/reports/run` or
`/finance/reports/export`, and `finance-roles.test.js` makes no assertion about report permissions.
Task: tests for — a `dept_head` is confined by `finance.user_scope`; `include_restricted` without the
permission is 403 (`finance-reports.js:461-465`, `:500-504`); the filename carries `RESTRICTED`
(`:57`); the three formats carry the same figures and the same meta; a two-currency fixture produces
no combined total in any format.

### MINOR

**Gap 27 — The finance map cannot be printed.** `src/map/tools/mapExport.ts:63` `exportMapToPdf(map,
{title, subtitle, legend, fileName})` already renders a committee-ready map sheet with header,
footer, scale, timestamp and legend, and requires only `preserveDrawingBuffer: true` on the map. The
finance `MapSection.vue` does not reference it. Task: an "Export map (PDF)" button passing the
selected year, currency, measure, the choropleth breaks as `legend`, and the
`ward_register_linked` state in the subtitle. This is reuse, not new capability.

**Gap 28 — The unlocated register is JSON only.** `finance-spatial.js:300-315`. Covered by Gap 4's
third entry; listed separately because it is also the honest-denominator for every ward figure.

**Gap 29 — The spatial-allocation register has no report.** `/finance/spatial-allocations`
(`finance-spatial.js:93`) holds the approved geographic splits with methodology and evidence —
exactly what D15 says must be auditable. Task: `spatial_allocations` (params `financial_year_id?`,
`subject_kind?`, `status?`, `ward_code?`; columns subject, target, amount, currency, share,
methodology, evidence document, requester, approver, dates; guard `finance.map.view` +
`finance.report.view`).

**Gap 30 — `project_performance` has no ward filter** although it exports `ward_code`
(`finance-reports.js:242`, `:258`) and `/finance/projects` already accepts `ward_code`
(`financeApi.ts:406`). Task: add the parameter.

**Gap 31 — No multi-sheet committee pack.** Each export is one report, one sheet
(`finance-reports.js:543-550`), while `buildXlsx` accepts many (`spreadsheet-write.js:48`). Task: a
`pack` parameter assembling a fixed set of reports into one workbook with one "About this export"
sheet.

**Gap 32 — The PDF has no council letterhead.** The cover prints the council name as text
(`report-pdf.js:157-158`); §3.2 has the council manage its logo. Task: optional logo from the council
profile.

**Gap 33 — The catalogue does not tell the client which formats the caller may use.** `/finance/reports`
returns `formats: ['json','csv','xlsx','pdf']` for everyone (`finance-reports.js:81`) and
`can_export_restricted` (`:82`) but not `can_export`; the UI derives that separately from the
permission set (`ReportsSection.vue:44`). Task: add `can_export` to the payload so one source answers
the question.

**Gap 34 — `year_on_year` compares exactly two years.** `finance-reports.js:110-113`. A three- or
five-year trend is a common council request. Task: accept a list of years, or a `years_back`
parameter, keeping currency in the join key.

---

## Part E — Mechanics audit

### E.1 Provenance metadata — on screen and in all three formats, but partly unfaithful
`reportMeta` (`finance-reports.js:400-428`) builds sixteen lines: council name and code from
`public.local_authorities` (`:401-404`), report name, financial year with start/end and status,
comparison year where relevant, currencies present, the currency-treatment sentence, which
available-balance definition is in force (read from `finance.setting`, `:405-406`), filters applied,
row count, whether restricted data is included, generation time, the generating user and role, and a
closing statement that the report is not a statutory return (`:426`).
Carried into: the screen (`ReportsSection.vue:222-226`), CSV as `# field,value` lines before a blank
line and the header row (`spreadsheet-write.js:161-167`), XLSX as a leading "About this export" sheet
(`spreadsheet-write.js:52-58`), PDF as a cover block (`report-pdf.js:170-183`).
**Verified present in all three formats.** Two faults: "Filters applied" is not the filters applied
(Gap 3), and there is no data cut-off (Gap 23). `/finance/audit/export` has its own, thinner meta
block (`finance-reports.js:656-664`) that does not name the filters either (Gap 19).

### E.2 Export formats
CSV (`:519-526`), PDF (`:528-541`) and XLSX (`:543-555`) — all three from the same `built` and the
same `meta`, which is why a committee PDF and an officer's spreadsheet cannot differ. CSV is
RFC 4180 with CRLF, a UTF-8 BOM and formula-injection neutralisation
(`spreadsheet-write.js:154-167`). XLSX writes amounts as numeric cells with the database's decimal
string passed through unparsed (`spreadsheet-write.js:97-103`). The PDF never wraps a numeric cell
and never draws a total row (`report-pdf.js:79-104`, `:11-13`).
Missing: nothing in the format set itself. JSON is screen-only by design (`finance-reports.js:447-450`).

### E.3 Currency separation — proof that no report can produce a mixed-currency total
1. `finance.money` is `numeric(18,2)` and currency is a CHECKed column, never a format
   (`188:59` `CREATE DOMAIN finance.money AS numeric(18,2)`, `188:53` the currency domain; `spreadsheet-write.js:13-15`).
2. `v_budget_line_performance` sums only rows whose currency equals the line's, counting the rest as
   faults (`188:797-823`: `FILTER (WHERE r.currency = l.currency)` and
   `count(*) FILTER (WHERE … <> …)`).
3. `v_department_performance` carries `currency` in its `GROUP BY` (`188:895`), so a department
   with both currencies is two rows.
4. `v_project_performance` keeps non-matching currencies out of the totals and returns them as
   explicit JSON plus counters (`189:176-181`).
5. `v_ward_performance` groups by currency (`199:100-146`).
6. `year_on_year` carries currency in the FULL OUTER JOIN key (`finance-reports.js:146-150`).
7. Every report's column list contains a `Currency` column.
8. Neither writer emits a total row: the PDF states this as a deliberate absence
   (`report-pdf.js:11-13`); `buildXlsx` writes only header + data rows (`spreadsheet-write.js:86-115`)
   and no formula.
9. `exchange_rate_policy` is empty and inert by migration (`188:237`, D4).
**Conclusion: no report path can emit a combined USD+ZWG figure.** The one residual risk is a
recipient summing a mixed column in Excel themselves; the per-row currency column and the absence of
a total row are the available mitigations, and the cover states the rule
(`finance-reports.js:419`). Untested at HTTP level (Gap 26).

### E.4 Restricted columns and the RESTRICTED filename convention — applied
`include_restricted` resolves to true only if the caller holds `finance.report.export_restricted`
(`finance-reports.js:459-460`, `:498-499`); asking without it is a 403 naming the permission
(`:461-465`, `:500-504`). The columns are appended to the SELECT and the column list only then
(`:319`, `:349-354`). `exportFilename` inserts `-RESTRICTED-` (`:55-58`), the response carries
`x-finance-restricted` (`:524`, `:539`, `:554`), the PDF prints a cover warning and a per-page
RESTRICTED mark (`report-pdf.js:163-168`, `:266-269`), and the frontend repeats it in the download
confirmation and an on-screen banner (`ReportsSection.vue:107-109`, `:228-234`).
**Applied correctly.** Only two roles hold the permission (`finance_admin`, `auditor`). The one
failure is that the disclosure leaves no audit trace (Gap 5).

### E.5 Scoping — a `dept_head` is *not* automatically confined
`departmentScope()` returns the caller's `finance.user_scope` department ids, or `null` meaning "no
filter", and deliberately never returns `[]` (`financePermissions.js:89-101`). It is applied by
seven of nine reports (`finance-reports.js:184`, `:221`, `:251`, `:290`, `:328`, and both
`year_on_year` CTEs at `:125`/`:134`) and **not** by `import_reconciliation` (`:370`). The scope is
per-user administration data, so a `dept_head` provisioned without scope rows reads the entire
council and nothing on the file says so (Gaps 8, 9). The finance map endpoints apply no scope at all
(`finance-spatial.js:322-382`) — defensible for an aggregate ward choropleth, but it should be a
recorded decision rather than an omission.

### E.6 Spatial / ward reporting — computable today, reportable not at all
`v_budget_ward_attribution`, `v_ward_performance` and `v_unlocated_finance` (migration 199) implement
the all-or-nothing attribution rule, the unallocated remainder, the unlocated bucket and honest
`ward_status` reporting against D11. They are granted to `vungu_app` and classified `tenant_view`
(`199:236-253`), and are read by `/finance/map/wards` and `/finance/unlocated`. **No report, no
export, no ward parameter in `ReportsSection.vue`, no `ward_code` in the report API client**
(`financeApi.ts:540-563`). Gap 4.

### E.7 Cadence — no scheduling mechanism exists
No cron, scheduler or job runner in the backend: `package.json` dependencies contain no `node-cron`
or equivalent, and a grep for `cron|node-schedule|setInterval|scheduled` in `src/` finds only
inspection *booking* scheduling (`src/routes/inspections.js`). SPEC §7 proposes a background worker
for "scheduled jobs" and "report generation"; neither exists. Consequence: monthly and quarterly
reports (Gap 1, ZW1/ZW2) would be run by hand, with no record that a period's report was produced.
Task (separate from Gap 1): a `finance.report_schedule` table + a worker that runs a saved report
definition on a cadence, writes the file to the existing document store
(`finance.document`, `188:654`) and records an audit event — i.e. make a produced periodic report an
artefact, not an action someone remembered to take.

### E.8 Audit export for the `auditor` role
`finance.audit.export` is held by `auditor` and `admin` only (`188:1213-1214`, `:1220-1221`).
`/finance/audit/export` reads `public.admin_audit_event` through `systemOf()` so the trail is not
filtered by the reader's own RLS (`finance-reports.js:631-642`, rationale at `:559-568`), selects the
finance subset by `event LIKE 'FIN\_%' OR path LIKE '/api/finance/%'`, and exports CSV/XLSX/PDF with
a meta block. Refused attempts are included because the hook records 4xx responses, which makes
SPEC §13.1's "attempt to publish without permission; confirm denial and audit event" true. Faults:
no filters (Gap 19), `LIMIT 100000` undisclosed, the export itself unaudited (Gap 5), and the
export's `path LIKE` predicate omits `/api/public/finance/%` which the search endpoint includes
(`:596` versus `:637`) — so public-surface events appear in the search and not in the export.

---

## Part F — Blocked needs

None of these may be filled with synthetic data.

| Need | Blocked on | Decision | What unblocks it |
|---|---|---|---|
| N41 / Gap 4 — ward reports with real geography | `admin.authority_ward` has **0 rows**; `admin.authority_area` empty (ARCHITECTURE-ASSESSMENT §7) | **D11** | The CEO/Chamber Secretary confirming the Council's ward list with its delimitation instrument; the GIS officer loading it. The report itself can be built now and will report `ward_status='unlinked'` honestly (`199:139-146`) — build it, do not invent wards |
| N38 — outstanding revenue / arrears by ward or property | No arrears amount exists anywhere; `revenue_link` carries keys and status bands only, by design | **D13** | Council naming the billing/ERP system that holds debtor balances and authorising a control-totaled periodic extract through the existing import pipeline |
| N40 — physical progress versus financial execution | `finance.project.physical_progress_percent` does not exist | **D12** | Council deciding who records progress, how often and with what evidence; then one controlled migration |
| N39 — asset register with financial values | `council_ops.*` registers are empty | — (data supply) | Phase 11 asset imports |
| N36 / N34 — Ministry submission formats and statutory statement formats | No authoritative format in hand | **D8** | Finance Director supplying the parent-Ministry budget-call-circular schedules and any statutory return format. Until then the system reports internally and claims nothing |
| N3 / Gap 10 — revenue by source | The revenue-source classification is not decided | **D2** | The approved chart of accounts, with each account's kind and its revenue-source grouping |
| N37 / Gap 14 — programme-based presentation | Hierarchy depth undecided; `programme`/`activity` unpopulated | **D3** | Council deciding vote → programme → activity depth |
| Gaps 6, 7 — export rights for `dept_head` and `publisher` | Role grants are a delegation of authority | **D6** | Council's delegation-of-financial-authority instrument; then a migration |
| Any public ward-level export (Gap 20 extended to geography) | Disclosure matrix for aggregated geography undecided | **D5**, **D14** | Council resolution on legal advice; the publication workflow is already the mechanism |
| Gap 29 — spatial-allocation register as evidence | Approval authority and required methodology evidence undecided | **D15** | Council resolution with D6; the table and its guard trigger already exist (migration 198) |
| Real figures in any of the above | 4 budget lines, 1 transaction, 0 projects in `vungu_dev`; 0/4 lines carry a ward code | **D7** | Three consecutive months of real ERP extracts with declared control totals |

Release gate unchanged: **D9/D10** — no go-live until a restore has been demonstrated and UAT signed
(`docs/finance/DECISION-REGISTER.md:124-133`).

---

## Part G — Sources for the Zimbabwe statutory and management research

Treat all of these as **evidence to cite**, not settled law. The primary statutes were not readable
during this audit: `zimlii.org` returned HTTP 403 for the Rural District Councils Act, and the UCAZ
budget-call-circular page served navigation only. Every `ZW` item below therefore rests on secondary
or news reporting and belongs in **D8** for Council/legal confirmation before any report claims to
satisfy it.

- `ZW1`, `ZW2` — monthly management accounts, quarterly reports and draft financial accounts
  described as statutory requirements under the Public Finance Management Act, the Urban Councils Act
  and the Rural District Councils Act; 43 of 92 local authorities compliant at the time of writing:
  https://www.herald.co.zw/local-authorities-ordered-to-submit-quarterly-financial-audits/
- `ZW2` — Public Finance Management Act [Chapter 22:19] consolidated text, whose table of contents
  lists quarterly (s33) and monthly (s34) financial statements; text of the council-specific
  provisions not retrievable: https://zimlii.org/akn/zw/act/2009/11/eng@2024-12-31
- `ZW2` — PFMA s38: Treasury must publish consolidated monthly financial reports in the Gazette
  within thirty days of month end (central government, cited as the cadence precedent):
  https://www.veritaszim.net/node/4564
- `ZW3` — Auditor-General's report on Local Authorities for the year ended 31 December 2021 (the
  annual-statements examination and the recurring non-submission findings):
  https://www.auditorgeneral.gov.zw/phocadownload/Local-Authority/Report%20of%20the%20Auditor-General%20for%20the%20Financial%20Year%20ended%20December%2031%202021%20on%20Local%20Authorities.pdf
- `ZW3` — AG 2020 report on Local Authorities, stating the AG's mandate under s309(2) of the
  Constitution and the Audit Office Act:
  https://openparly.com/wp-content/uploads/2022/04/AG-2020-REPORT-ON-LOCAL-AUTHORITIES.pdf
- `ZW3` — recent AG findings: 34 local authorities had not submitted 2025 financial statements, six
  had not submitted for 2023 and 2024:
  https://www.newsday.co.zw/local-news/article/200058606/ag-flags-accounting-black-hole-in-rural-council-schools
- `ZW3` — 16 councils failing to submit audited financial statements (earlier period):
  https://cite.org.zw/16-councils-fail-to-submit-audited-financial-reports/
- `ZW4` — Inter-Governmental Fiscal Transfer manual: quarterly financial reports to the Ministry of
  Local Government with a copy to Treasury by mid-month after quarter end; monthly disbursement with
  quarterly review; unspent devolution funds roll over:
  https://www.heraldonline.co.zw/new-guidelines-for-devolution-funds/
- `ZW4` — Local Authorities Circular No 1 of 2019 requiring **separate devolution books of account**,
  and AG findings of missing acquittals: https://bulawayo24.com/news/national/252951
- `ZW5` — Rural District Councils Act [Chapter 29:13]: secondary sources place the estimates
  obligation at s121, the auditor at s134 and the accounts at s135. Unverified against the Act.
  Act landing page (403 to automated fetch): https://zimlii.org/akn/zw/act/1988/8 ·
  full text copy: https://www.scribd.com/document/711043625/Rural-District-Councils-Act ·
  s135 claim: https://mutasardc.org.zw/committe.html
- `ZW5` — parent-Ministry Local Authorities Budget Call Circular (existence and location; contents
  not retrievable): https://ucaz.org.zw/documents/parent-ministry-local-authorities-budget-call-circular
- `ZW5` — ministerial approval of council budgets (90 of 92 approved; alignment with the RDC and
  Urban Councils Acts): https://www.heraldonline.co.zw/90-out-of-92-local-authorities-budgets-approved/
- `ZW6` — councils submitting budgets in the **LADS** format (54 budgets in 2023) and the Ministry's
  programme-based budgeting module review:
  https://www.hit.ac.zw/news/review-of-programme-based-budgeting-module-for-lads.html
- `ZW6` — Promun judged too small for Gweru City Council's transaction volume, with a PAC
  recommendation to upgrade for reporting timeliness; Promun and Pastel described as non-local
  systems councils depend on (the source formats the import pipeline's aliases were seeded from, per
  `docs/finance/DECISION-REGISTER.md:95`):
  https://www.newsday.co.zw/local/article/200035976/parliament-flags-gweru-hwange-councils-finances
- `ZW7` — AG and parliamentary findings on debtors, acquittals and undocumented project
  implementation (the evidence behind D13's "no arrears amounts exist" position):
  https://thestandard.co.zw/business/article/200029584/govt-bolsters-oversight-of-devolution-funds

**What could not be verified.** The exact wording and section numbers of the Rural District Councils
Act's accounts, audit and estimates provisions; the PFMA sections that apply to local authorities as
opposed to Ministries and public entities (the Act's annual-statement definition appears to exclude
local authorities, so the council duty may sit in the sectoral Acts); the schedules and file formats
the parent-Ministry budget call circular requires; whether the LADS format is mandatory for Vungu
RDC. All four are D8 inputs.
