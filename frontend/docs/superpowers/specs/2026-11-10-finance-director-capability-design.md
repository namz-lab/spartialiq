# Finance Director capability completion — design spec

Date: 2026-11-10 · Role in scope: `finance_admin` (26 of 34 permissions), the council's Director of
Finance. Secondary beneficiaries: `finance_officer`, `finance_committee`, `auditor`.

**Baseline audits this implements.** `docs/gis-finance/ROLE-WORKFLOW-COVERAGE.md` (GAP-1, GAP-5,
GAP-6, GAP-7, GAP-15) and `docs/gis-finance/REPORTING-COVERAGE.md` (N3, N4, N5, N13, N14, N23,
N24, N25, N28, N29, N32, N33, N34, N37). Nothing here invents a requirement; every work item
cites one of those rows.

**Reference architecture consulted.** ERPNext (`~/Downloads/erpnext-develop`), specifically
`erpnext/accounts/report/financial_statements.py:217` `get_period_list()` — the periodicity engine
that turns a date range plus a periodicity into labelled period buckets, each with `from_date`,
`to_date`, a stable `key` and a human `label`, with an `accumulated_values` mode. That function is
the missing primitive behind every period-based report below, and §2 adapts it.

## 0. What is deliberately NOT taken from ERPNext

ERPNext is a double-entry accounting system: `gl_entry`, `journal_entry`, `payment_entry`,
`period_closing_voucher`, and financial statements derived from debits and credits. **None of that
is imported.** `docs/finance/COUNCIL-DECISIONS.md` closes with "It does not replace the Council's
general ledger and cannot be used as a book of account", and `finance.transaction` is a register of
*imported* actuals carrying `source_system`, `source_ref`, `import_batch_id` and a file hash — not a
posting. Adding a partial GL would make that statement false while delivering none of a GL's
integrity. What is taken is the *reporting* architecture: period buckets, dimension-wise grouping,
and the discipline that a screen and an exported file are built by one function.

Equally not taken: ERPNext's Chart-of-Accounts root-type inference. `finance.account.kind` is set by
Council per account and is never inferred from the code range (decision D2); the Czech band rule
already rejected in the gap note is the same mistake.

## 1. Architectural decisions

**A1 — The staff transaction register is its own route file, not a report.**
`src/routes/finance-transactions.js`. A register is a browsing surface with filters, pagination and
a detail view; a report is a built artefact with provenance and an export. Conflating them is how
`transaction_register` acquired a silent `LIMIT 100000` (`finance-reports.js:330`). The register
paginates and states its total; the report exports and states its cut-off.

**A2 — Counterparty fields are present or absent, never blank.**
Already the contract in `models/types.ts` (`FinanceTransaction.counterparty_ref`: "Present ONLY for
a caller holding finance.transaction.view_counterparty. Absent, not blank."). The register honours
it by not selecting the columns, so a blank cell can never be mistaken for "no supplier recorded".
Every response carries `counterparty_visible: boolean` so the UI explains the absence.

**A3 — Periodicity is one backend library, not `date_trunc` scattered per report.**
`src/lib/financePeriods.js` exports `periodList()`. One place decides what "Q2" means for a council
whose financial year may not start in January. Every period-based report consumes it, so a monthly
management account and a quarterly return cannot disagree about which month a transaction fell in.

**A4 — A period with no activity reports zero, and still gets its column.**
A missing month is a fact a director needs to see. No report interpolates, carries forward, or drops
an empty period. `null` means *not recorded* and renders as such; `0` means a figure was recorded
and it was nil. This is the existing D12 rule for `physical_progress_percent` generalised.

**A5 — No report, register or chart combines currencies.** Unchanged from D4, restated because ten
new reports are the most likely place for it to be broken. Currency is a grouping key, never a
filter defaulting to one. Where a total would span USD and ZWG there is no total.

**A6 — Charts are inline SVG in this repo, with no charting dependency.**
`package.json` has no chart library and gains none: DESIGN.md owns the palette and a chart library
arrives with its own. Every chart is rendered from the same rows as, and ships beside, a real table
— a chart a screen reader cannot read is not a report (WCAG 2.1 AA). Motion honours
`prefers-reduced-motion`.

**A7 — Department scoping is applied by the same middleware as everywhere else.**
`departmentScope` from `src/middleware/financePermissions`. A `dept_head` reading the register sees
their votes; the response names the scope actually applied (`scope_applied`), as the ward endpoints
already do, so a narrowed figure is never silently narrowed.

## 2. The period engine (`src/lib/financePeriods.js`)

Adapted from ERPNext `get_period_list()`. Pure, no database access, unit-testable.

```js
periodList({ start, end, periodicity, accumulated = false })
// periodicity: 'monthly' | 'quarterly' | 'half_yearly' | 'yearly'
// -> [{ from_date: 'YYYY-MM-DD', to_date: 'YYYY-MM-DD', key: 'm01', label: 'Jan 2026' }, ...]
```

Rules, each a test:
- Buckets are generated from the **financial year's own** `start_date`, so a July–June year yields
  Q1 = Jul–Sep. The council's year is not assumed to be the calendar year.
- The final bucket is clipped to the year's `end_date` and never extends past it.
- `key` is stable, ordinal and safe as an object key / SQL alias (`m01`…`m12`, `q1`…`q4`).
- `accumulated: true` makes each bucket run from the year start to that bucket's `to_date`, for a
  year-to-date column set. The label says so (`"To Mar 2026"`).
- A date on a bucket boundary belongs to exactly one bucket. No transaction is counted twice and
  none is dropped: the generated buckets tile the year exactly.

## 3. Workstream W1 — Staff transaction register (GAP-1, BLOCKER)

`finance.transaction.view` (migration `188:1065`) is held by `finance_admin`, `finance_officer`,
`finance_committee` and `auditor`, and is read by no `requirePermission` call in the backend.
`src/middleware/auditLog.js:92` already carries the audit rule `{ match: '/finance/transactions',
event: 'FIN_TRANSACTION', severity: 'high' }` for a route that does not exist.

### `GET /api/finance/transactions` — `finance.transaction.view`

Query (all optional but `financial_year_id`): `financial_year_id`, `department_id`, `account_id`,
`programme_id`, `activity_id`, `budget_line_id`, `project_id`, `ward_code`, `kind`
(`revenue|expenditure`), `expenditure_class` (`recurrent|capital`), `revenue_class`, `currency`,
`from`, `to`, `q` (description / reference), `source_system`, `import_batch_id`,
`reversals` (`exclude|only|all`, default `exclude`), `limit` (max 200, default 50), `offset`,
`sort` (`txn_date|amount|account_code|department_code`), `direction`.

Response:
```
{ transactions: FinanceTransaction[], total, limit, offset,
  totals: Array<{ currency, account_kind, rows, amount }>,   // per currency AND kind. Never combined.
  counterparty_visible: boolean,
  scope_applied: string[] | null,                            // null = not confined
  reversals: 'exclude' | 'only' | 'all' }
```

- `totals` is computed in SQL over `NUMERIC`, grouped by currency and kind (A5). It describes the
  **filtered set**, not the page, and the UI must label it so.
- `reversals` defaults to `exclude` because a reversal plus its replacement both sit in the register
  (`finance.transaction.reverses_id`) and a naive total double-counts. The response echoes the mode
  so a figure can never be read without knowing which it is.
- Counterparty columns are selected only when the caller holds
  `finance.transaction.view_counterparty` (A2).

### `GET /api/finance/transactions/:id` — `finance.transaction.view`

```
{ transaction, budget_line | null, project | null, documents: FinanceDocument[],
  import_batch | null,
  reversal: { reverses: {...} | null, reversed_by: {...} | null },
  counterparty_visible }
```
`reversal` is how a director answers "was this corrected?" without reading the whole register.

### Frontend
`src/modules/finance/pages/sections/TransactionsSection.vue`, section key `transactions`, group
`data`, icon `Receipt`, requires `['finance.transaction.view']`. Registered in
`FinanceWorkspace.vue` and `rolePreset.ts` by the integrator, not by the implementer.

## 4. Workstream W2 — Management accounts and statutory returns

All built by the existing single `buildReport()` in `src/routes/finance-reports.js` so the screen
and the exported file cannot disagree (`finance-reports.js:91-397`), and all three export formats
come free. Each report is either complete *with* its export or absent from the catalogue — a
catalogue entry that errors on export is worse than no entry.

| Report id | Need | What it does |
|---|---|---|
| `management_accounts` | N32 | Period columns (A3) × department/account, per currency and kind: budget, actual, variance per period, plus year-to-date. The council's monthly management account. |
| `quarterly_return` | N33 | `accumulated` quarterly form of the above, with the quarter stated on the cover. |
| `budget_execution_statement` | N34 | Annual: original, adjustments, revised, actual, variance, execution % per vote and account, with commitments shown separately. Labelled a budget-execution statement, **not** a financial statement (§0). |
| `variance_report` | N5 | Variance per line with the authorised `finance.variance_explanation` text joined on, and lines whose variance is unexplained listed as such. |
| `capital_vs_recurrent` | N23 | Splits expenditure by `finance.account.expenditure_class`. |
| `funding_source` | N24 | Groups by `budget_line.funding_source_account_id` / `project.funding_source_account_id`, with `revenue_class` (internally generated / grant / transfer / other). |
| `programme_performance` | N37, N4 | Groups by `finance.programme` then `finance.activity`. |
| `revenue_by_source` | N3 | **Fixes** `revenue_performance`, which the catalogue claims is "by revenue source" but which groups by department (`finance-reports.js:208-237`) and omits variance. Groups by revenue account and includes variance. |
| `commitments_register` | N25 | `finance.commitment` with outstanding balance; currently reachable only as a column on two reports. |
| `ward_finance` | N28, N29 | `finance.v_ward_performance`, with `unlocated` as a first-class row, never dropped and never folded into a ward. |

Catalogue additions: `ReportDefinition` gains `periods?: Array<'monthly'|'quarterly'|'half_yearly'|'yearly'>`
and `requires` may include `'periodicity'`. `ReportsSection.vue` renders a periodicity control only
for reports that declare one.

`revenue_performance` is **kept** and left working — removing a report id someone has bookmarked is
not this change's business — but its catalogue `grouped_by` is corrected to say `department`, which
is what it does.

## 5. Workstream W3 — The Director's cockpit (N14, GAP-5/6/7, N13)

`FinanceOverviewSection.vue` (362 lines) contains no chart markup and no exception feed.

### `GET /api/finance/overview/series` — `finance.budget.view`
`financial_year_id`, `periodicity`, `department_id`. Returns, per currency and kind, one row per
period: `budget`, `actual`, `commitments`, `cumulative_actual`. Feeds the charts; the same rows feed
the table beneath them (A6).

### `GET /api/finance/overview/attention` — `finance.budget.view`
The director's exception feed, each item carrying a count, a one-sentence statement and a link
target. Sources, all existing: overspent and near-exhausted lines
(`/finance/exceptions/budget`, N13), budget lines and revisions and projects and publications
awaiting a decision (GAP-5/6/7), validated import batches awaiting commit, unresolved import
exceptions, lines with a material variance and no explanation (N5), projects where spend runs ahead
of physical progress (`spend_ahead_of_progress`, D12/migration 202), and money with no geography
(`finance.v_unlocated_finance`, N29).

An item with a zero count is rendered as "none", not hidden — a director must be able to see that a
queue was checked and was empty.

### Chart primitives
`src/modules/finance/components/charts/`: `ChartFrame.vue` (title, figcaption, currency label, the
table fallback and the empty state), plus `PeriodBars.vue` and `PeriodLines.vue`. Tokens from
DESIGN.md only; no hardcoded colour; accent under ~10 % of the surface.

## 6. Out of scope, and why

- **Debtors / arrears (N38)** and **asset register (N39)** — blocked on D13 and on
  `council_ops.*` being empty. No amount exists to report.
- **Ministry submission format (N36)** — blocked on D8; no format has been supplied.
- **Report scheduling / cadence (Part E.7)** — needs a job runner; a cadence that silently fails is
  worse than none.
- **Double-entry, trial balance, balance sheet, cash flow** — §0.

## 7. Acceptance checks

| # | Check |
|---|---|
| C1 | `GET /finance/transactions` without `finance.transaction.view` is refused 403. |
| C2 | Counterparty columns are **absent** from the response for a caller without `.view_counterparty`, not blank. |
| C3 | `totals` never contains a row combining USD and ZWG, on any filter. |
| C4 | Default `reversals=exclude` omits both a reversing row and nothing else; `all` returns both and the response says so. |
| C5 | A `dept_head` register response is confined to their votes and names the scope in `scope_applied`. |
| C6 | `periodList()` buckets tile the financial year exactly: no gap, no overlap, final bucket clipped to `end_date`. |
| C7 | A July–June financial year yields Q1 = Jul–Sep, not Jan–Mar. |
| C8 | Every new report returns the same rows through JSON and through CSV/XLSX/PDF export. |
| C9 | A period with no transactions appears as a column with zero, not omitted. |
| C10 | `ward_finance` includes the `unlocated` row and labels it. |
| C11 | Every chart has a table with the same figures and an accessible name. |
| C12 | An attention item with a zero count renders as "none", not hidden. |
