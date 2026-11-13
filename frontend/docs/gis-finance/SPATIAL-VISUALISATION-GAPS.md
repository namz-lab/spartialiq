# Spatial Visualisation — Coverage Audit and Gap Specification

**Project:** Vungu RDC — GIS-Integrated Municipal Budget and Financial Management System
**Date:** 2026-11-08
**Type:** Read-only architecture audit. No source changed, nothing committed, no geometry or data invented.
**Repos inspected:**
- Frontend `/home/theo-madzinaga/Documents/Manicipal-drums-frontend`
- Backend `/home/theo-madzinaga/Documents/Manicipal-drums-backend-3` (the `../app-backend` named in `CLAUDE.md` does not exist — confirmed; `/home/theo-madzinaga/Documents/` contains no such directory)
- Live dev database `vungu_dev` on `localhost:5432` (queried read-only; counts in §6 are measured, not quoted)

**Binding documents this audit does not contradict:**
`docs/gis-finance/ARCHITECTURE-ASSESSMENT.md` §6.1 (seven binding principles), `DESIGN.md` → *Map Cartographic System*, `docs/finance/DECISION-REGISTER.md` D11–D15.

---

## 0. Two corrections to the brief, stated before anything is built on it

1. **The "13-field ward info panel" and "project info panel field list" are not on disk anywhere.**
   `VUNGU_RDC_CLAUDE_CODE_PROMPT.md` (frontend root, 38 lines) contains no numbered phases at all — it is the
   implementation-authorisation prompt, not the spatial specification. The DOCX baseline
   (`/home/theo-madzinaga/Downloads/Vungu_RDC_Municipal_Budget_System_Technical_Specification.docx`, 701 paragraphs,
   extracted and grepped) mentions wards/maps/GIS **nowhere** in a spatial-requirement sense. The only on-disk source
   of the phase numbering and the field lists is `docs/gis-finance/ARCHITECTURE-ASSESSMENT.md` itself
   (§6.2 item 3, §9 milestone table line 204, §10 traceability).
   **Consequence:** this audit treats **ARCHITECTURE-ASSESSMENT.md §6.2.3 as the authoritative ward-panel field list**
   (it enumerates exactly thirteen: original, adjustments, revised, actual, open commitments, available ±,
   execution %, revenue budget, revenue actual, revenue variance, project count/measures, allocation-vs-ward_code
   basis flag, ward_status) and §6.3/§9-M5 as the project-panel source. An implementation agent must not treat a
   field list recited from the GIS programme brief as settled unless it appears in one of those files.

2. **The dev database has 1 project, not 0.** The assessment's §7 table says "0 projects". Measured today:
   one project `VERIFY-202611081833` (USD 1,000.00, status `approved`, no ward code, `location IS NULL`). It is a
   test artefact, and it is already showing up in `finance.v_unlocated_finance` as `projects/USD 1 row / 1,000.00`.
   Everything else in §7 verified correct.

---

## 1. Endpoint inventory — what the spatial surface actually returns

All five live spatial endpoints are in one file, registered at `server.js:721`
(`await server.register(financeSpatialRoutes, { prefix: '/api' })`).

| # | Endpoint | file:line | Params accepted | Measures / payload returned | Permission | View(s) read | Provenance carried |
|---|---|---|---|---|---|---|---|
| 1 | `GET /api/finance/spatial-allocations` | `finance-spatial.js:93-134` | `subject_kind` (budget_line\|project), `subject_id`, `status` (draft\|approved\|rejected\|withdrawn), `limit` ≤500, `offset` | all `finance.spatial_allocation` columns + derived `target_status` ∈ {`linked`,`unlinked`,`ward_register_empty`} (`:113-125`) | `finance.map.view` (`:94`) | table `finance.spatial_allocation` | ✗ no `sources`, no `generated_at`. `target_status` **does** carry the D11 ward-register signal per row |
| 2 | `POST /api/finance/spatial-allocations` | `:137-205` | `subject_kind`, `subject_id`, `target_code`, `amount`, `currency`, `share` (0<s≤1), `methodology` (min 10 chars), `evidence_document_id` | the created draft row (201) | `finance.budget.prepare` **or** `finance.project.manage` (`:138`), then re-checked per subject kind (`:158-162`, map at `:44`) | — | n/a |
| 3 | `POST /api/finance/spatial-allocations/:id/approve` \| `/reject` \| `/withdraw` | `:248-252`, `:254-258`, `:261-297` (shared `decide()` `:208-246`) | `decision_note` (required on reject) | the decided row | `finance.budget.approve` / `finance.project.approve` (`:249`,`:255`), re-checked per kind (`:218-222`); self-approval refused `:223-226` | — | n/a |
| 4 | `GET /api/finance/unlocated` | `:300-315` | `financial_year_id` | `{ unlocated: [{authority_id, financial_year_id, currency, dataset, unlocated_rows, unlocated_amount}] }` | `finance.map.view` (`:301`) | `finance.v_unlocated_finance` (`:310`) | ✗ none |
| 5 | `GET /api/finance/map/wards` | `:322-386` | `financial_year_id`, `currency` (USD\|ZWG) | `{ financial_year, currencies[], wards[], unlocated[], ward_register_linked, sources[], generated_at }` (`:377-385`). Per ward: `revenue_budget`, `revenue_actual`, `revenue_variance`, `expenditure_budget`, `expenditure_actual`, `open_commitments`, `expenditure_execution_percentage`, `attributed_lines`, `allocation_rows`, `transaction_rows`, `ward_status`, `unlocated_reason` | `finance.map.view` (`:323`) | `finance.v_ward_performance` (`:359`) + `finance.v_unlocated_finance` (`:367`) | ✔ `sources` (const `:48`), ✔ `generated_at`, ✔ `ward_register_linked` (`:375`, helper `:51-57`). ✗ **no `data_as_at`** — see MINOR-7 |
| 6 | `GET /api/finance/map/ward-geometry` | `:391-414` | none | `{ ward_register_linked, features: [{type:'Feature', properties:{ward_code,name}, geometry}] }`; `ST_SimplifyPreserveTopology(geom, 0.001)` (`:399`) from `admin.authority_ward ⋈ admin.ward` (`:400-403`) | `finance.map.view` (`:392`) | tables `admin.authority_ward`, `admin.ward` | ✔ `ward_register_linked`; empty register returns **200 + `features: []` + `linked:false`** (`:394-396`, `:413`) — honest, not silently empty |

**Endpoints that the assessment promises and that do not exist** (verified by `grep -rn "finance/map" src/` over the whole backend — only lines 322 and 391 match):

- `GET /api/finance/map/projects` — **absent** (assessment §6.3 bullet 3). Confirmed.
- `GET /api/public/finance/map/wards` — **absent** (assessment §6.3 bullet 5). `finance-public.js` exposes 8 routes (`:61`, `:79`, `:185`, `:238`, `:291`, `:344`, `:360`, `:414`); none is spatial.
- `GET /api/finance/transactions` — **no staff transaction-register endpoint exists at all** (`grep -rn "finance/transactions"` matches only the two *public* routes). The ward→transaction leg of the §9-M3 drill-down therefore has no backend. The `transaction_register` report (`finance-reports.js` `REPORT_NAMES`) exists but its `querySchema` accepts no `ward_code`.

**Already-serving spatial payload not in the assessment's list:** `GET /api/public/finance/projects`
(`finance-public.js:360-406`) already returns `ST_X(pr.location) AS longitude, ST_Y(pr.location) AS latitude`
per project, publication-gated by the `published_select` policy on `finance.project`
(`188_finance_foundation.sql:1506-1512`). The public project **point source already exists**; only the public *ward*
aggregate is missing.

---

## 2. Measures — what the views compute vs what the panels require

### 2.1 What migration 199 actually computes

`finance.v_budget_ward_attribution` (`199_finance_ward_performance.sql:34-88`) — one row per (budget line, target):

| Branch | lines | ward_code | basis | original_amount | budget_amount | open_commitments |
|---|---|---|---|---|---|---|
| split (approved allocations exist) | `:50-59` | allocation `target_code` | `spatial_allocation` | **NULL** (deliberate, `:48-49`) | `sum(allocation.amount)` | **NULL** |
| unsplit | `:62-71` | line's own `ward_code`, or NULL | `line_ward_code` \| `unlocated` | `p.original_amount` | `p.revised_amount` | `p.open_commitments` |
| remainder of a split line | `:74-82` | NULL | `unallocated_remainder` | NULL | `revised − Σ allocations` | NULL |

Dimensions carried: `budget_line_id, authority_id, financial_year_id, department_id, currency, account_kind, ward_code, basis, allocation_rows`. **Dropped from `v_budget_line_performance`:** `programme_id`, `activity_id`, `account_id`, `actual_amount`, `available_excluding_commitments`, `available_including_commitments`, `variance`, `execution_percentage` (the source view's full column list was read from the live DB: 27 columns).

`finance.v_ward_performance` (`:94-163`) — one row per (authority, financial_year, currency, ward_code | unlocated_reason):

| Column | line | Derivation |
|---|---|---|
| `ward_status` ∈ {`linked`,`unlinked`,NULL} | `:131-138` | `linked` only when the code is a **current** `admin.authority_ward` row; NULL when `ward_code IS NULL` |
| `unlocated_reason` ∈ {`unlocated`,`unallocated_remainder`,NULL} | `:100`, `:126-128` | ward rows merge across bases; geography-less rows keep the reason |
| `revenue_budget` | `:101-102` | `Σ budget_amount` where `account_kind='revenue'` |
| `expenditure_budget` | `:103-104` | `Σ budget_amount` where `account_kind='expenditure'` |
| `open_commitments` | `:105` | `Σ open_commitments` (NULL on split rows — so a split ward reports no commitments) |
| `revenue_actual`, `expenditure_actual` | `:110-119` | from **`finance.transaction.ward_code`** — the transaction's *own* ward, not its line's attribution |
| `revenue_variance` | `:141-143` | `actual − budget`; **NULL when `revenue_budget IS NULL`** (missing ≠ zero) |
| `expenditure_execution_percentage` | `:147-149` | `coalesce(actual,0)*100/expenditure_budget`; NULL when budget is NULL or 0 |
| `attributed_lines`, `allocation_rows` | `:106-107`, `:150-151` | the basis flag, expressed as two counts |
| `transaction_rows` | `:115`, `:152` | count of ward-coded transactions |

`finance.v_unlocated_finance` (`:177-202`): three UNION branches — `budget` (lines with `ward_code IS NULL` **and** no approved allocation, `:179-188`), `transactions` (`ward_code IS NULL`, `:189-194`), `projects` (`ward_code IS NULL AND location IS NULL`, **`financial_year_id` deliberately NULL**, `:195-202`). Columns: `unlocated_rows`, `unlocated_amount`.

**Ward status values, definitively:** `linked`, `unlinked`, `NULL` (from the view). The *route* adds a third
vocabulary for allocation targets only: `linked` / `unlinked` / `ward_register_empty` (`finance-spatial.js:113-125`).
These two vocabularies are **not the same set** — a UI that renders `ward_status` must not expect
`ward_register_empty`, which only ever appears on allocation rows.

### 2.2 Ward panel — the thirteen fields vs reality

| # | Required field (ASSESSMENT §6.2.3) | Status | Evidence / what is needed |
|---|---|---|---|
| 1 | original | **NEEDS SQL** | `v_budget_ward_attribution` carries `original_amount` (`199:66`) but `v_ward_performance`'s `budget` CTE never aggregates it (`199:96-109`). One added `sum(...) FILTER` per account_kind. |
| 2 | approved adjustments | **NEEDS SQL** | Not carried into the attribution view at all; `v_budget_line_performance.approved_adjustments` must be propagated (unsplit branch only — splitting an adjustment by assumption would breach §6.1 rule 7). |
| 3 | revised | **ALREADY COMPUTABLE** | = `expenditure_budget` / `revenue_budget` (`199:101-104`); the unsplit branch passes `revised_amount` (`199:67`). |
| 4 | actual | **ALREADY COMPUTABLE** (with a caveat) | `expenditure_actual` / `revenue_actual` (`199:113-114`) — but attributed by **`transaction.ward_code`**, not by the line's geography. See MAJOR-4. |
| 5 | open commitments | **ALREADY COMPUTABLE** (partial) | `199:105`. NULL for split lines by construction (`199:55`), so a split ward shows "—" for commitments. |
| 6 | available (±commitments) | **NEEDS SQL** | Neither `available_excluding_commitments` nor `available_including_commitments` reaches the attribution view. The UI must not subtract these itself — §6.1 rule 2. |
| 7 | execution % | **ALREADY COMPUTABLE** | `199:147-149`. |
| 8 | revenue budget | **ALREADY COMPUTABLE** | `199:101-102`. |
| 9 | revenue actual | **ALREADY COMPUTABLE** | `199:113`. |
| 10 | revenue variance | **ALREADY COMPUTABLE** | `199:141-143`. |
| 11 | project count / measures | **NEEDS SQL** | Deliberately excluded (`199:26-28`: projects span years). Needs either a year-scoped project roll-up view or a separate `/finance/map/projects` aggregate. The panel currently fetches `/finance/projects?ward_code=` client-side (`MapSection.vue:106-108`), which is a list, not a measure. |
| 12 | allocation-derived vs ward_code-derived flag | **ALREADY COMPUTABLE** | `attributed_lines` + `allocation_rows` (`199:150-151`), rendered at `MapSection.vue:331-332`. |
| 13 | ward_status | **ALREADY COMPUTABLE** | `199:131-138`, rendered at `MapSection.vue:319-320`. |

**Score: 8 already computable, 5 need SQL, 0 blocked.** The panel as built renders eleven rows
(`MapSection.vue:323-335`) — the eight above plus `transaction_rows`, the two basis counts and a year·currency line.

### 2.3 Project panel — what `v_project_performance` gives

Source: `189_finance_project_reporting.sql:88-192` (one row per project, audit F-04).

| Required field | Status | Evidence |
|---|---|---|
| reference, name, department, ward_code, status, currency | **ALREADY COMPUTABLE** | `189:150-157` |
| approved_budget | **ALREADY COMPUTABLE** | `189:161` |
| allocated_original / allocated_revisions / allocated_total | **ALREADY COMPUTABLE** | `189:162-164` |
| actual_spend, remaining_allocation | **ALREADY COMPUTABLE** | `189:165`, `189:166-167` |
| execution_percentage (NULL when nothing allocated, not 0) | **ALREADY COMPUTABLE** | `189:168-172` |
| transaction_rows, matched_transaction_rows, last_transaction_date | **ALREADY COMPUTABLE** | `189:173-175` |
| other-currency allocations / spend + mismatch counts | **ALREADY COMPUTABLE** | `189:176-180` |
| financial_year_ids (year scoping) | **ALREADY COMPUTABLE** | `189:181-188` |
| start_date, end_date, description, location_text | **ALREADY COMPUTABLE** | on `finance.project` (`188:526-528`), already selected by `finance-projects.js:132` |
| longitude / latitude | **ALREADY COMPUTABLE** | `geometry(Point,4326)` (`188:524`), GIST `idx_project_location` (`188:554`), already projected out at `finance-projects.js:98`,`:134` and `finance-public.js` public projects |
| linked_subject_kind / id (trace into planning) | **ALREADY COMPUTABLE** | `189:155-156`; `/api/finance/linked/:kind/:id` + `LinkedFinancePanel.vue` |
| **physical_progress_percent** | **BLOCKED (D12)** | The column does not exist on `finance.project` (`188:515-549` — read in full). Spend-vs-progress exception flags cannot be built. |
| ward-level spatial split of a project | **ALREADY COMPUTABLE, no UI** | `finance.spatial_allocation` accepts `subject_kind='project'` (`198:32`), capped against `Σ project_allocation.amount` (`198:186-189`) |

---

## 3. Frontend map capability assessment

Files: `src/modules/finance/pages/sections/MapSection.vue` (480 lines),
`src/modules/finance/composables/useFinanceMap.ts` (124 lines),
`src/modules/finance/api/financeApi.ts:48-95` (types), `:243-248` (calls),
registered in `FinanceWorkspace.vue:95-97` behind `requires: ['finance.map.view']`.

| Question | Answer | file:line |
|---|---|---|
| Which measures can the user switch between? | **Seven**: expenditure budget, actual expenditure, budget execution, revenue budget, revenue collected, revenue variance, open commitments | `useFinanceMap.ts:31-46`; `<select v-model="measure">` `MapSection.vue:265-267` |
| Measures NOT switchable | original, adjustments, available ±, variance (expenditure), project measures, revenue-collection-rate % | §2.2 above |
| How are breaks computed? | **Nearest-rank quantile over DISTINCT values that exist**, 5 classes, deduped edges; returns `[]` (no scale) when fewer than two distinct values | `useFinanceMap.ts:88-102`; called `MapSection.vue:165-168` |
| Is NULL distinguished from zero? | **Yes, correctly.** `measureValue` preserves NULL (`:52-57`); `fillExpression` emits `['case',['==',['get','value'],null],'#e8e8e8', step]` so no-data gets its own grey and never the bottom class | `useFinanceMap.ts:52-57`, `:111-120`; applied `MapSection.vue:170` |
| Is the currency join safe? | **Yes.** `rowsByWard` filters `row.currency === currency && row.ward_code && !row.unlocated_reason` — a ZWG figure cannot shade a USD map | `useFinanceMap.ts:73-81` |
| Is the legend honest about breaks / year / currency / source / as-at? | **Breaks ✔** (`legendEntries` renders the real edges, `:225-241`), **measure·currency·year ✔** (`:303`), **source ✔** `finance.v_ward_performance`, **as-at ✔ but it is `generated_at` = query time, not data-as-at** (`:310`). No statement of the **attribution basis** (which figures came from allocations vs ward codes vs transaction ward codes) | `MapSection.vue:302-311` |
| Is "unlocated" surfaced? | **Yes, as a first-class card** with per-dataset rows, amounts, and a sentence saying these are never mapped to an invented location | `MapSection.vue:382-402`, labels `:249-253` |
| Is there ward drill-down? | **Partially.** Click → ward panel → budget lines (`/finance/budget-lines?ward_code=`) + projects (`/finance/projects?ward_code=`), both permission-branched; "Open in Budget" pushes `?section=budget&ward=`. **No transaction leg** (no endpoint exists) and no department/programme/activity leg | `MapSection.vue:96-115`, `:117-121`, `:123-126`, `:205-208` |
| Map⇄dashboard `?ward=` sync? | **One-way only.** Map → Budget works (`MapSection.vue:125` writes the query; `BudgetSection.vue:47-49` reads `route.query.ward` then falls back to `store.mapWardCode`, store at `stores/finance.ts:37`,`:196-198`). **MapSection never reads `route.query.ward` on mount** — a deep link or a Budget→Map hand-back does not select the ward | `MapSection.vue:41-50` (no route read), `:117-121` |
| Reduced motion on `fitBounds`? | **Compliant by accident, not by contract.** `fitBounds(..., { duration: 0 })` is hardcoded — it never animates for anyone. `prefersReducedMotion()` (`vunguBasemap.ts:870`) is not imported. DESIGN.md specifies 700 ms ease-out-quart *or* 0 ms under reduce | `MapSection.vue:179` |
| Basemap added via `addVunguBasemap`? | **Yes — but with no options**, so `visibleSet` becomes *every* catalogue layer (`vunguBasemap.ts:254-257`), not `DEFAULT_VISIBLE` (`:161-172`). Buildings, POIs, stands and all admin fills render under a 0.78-opacity choropleth | `MapSection.vue:192` |
| Map created with `preserveDrawingBuffer`? | **No** (`:185-190`), so `exportMapToPdf` (`map/tools/mapExport.ts:63`, requirement documented at `:11-13`) returns a blank image. PDF map export is unavailable on the finance map | `MapSection.vue:185-190` |
| Choropleth palette source | **A new six-step blue ramp defined in the finance module**, not in `vunguBasemapStyle.ts` and not in DESIGN.md | `useFinanceMap.ts:105` |
| Test coverage | 7 unit tests on the pure logic (measures, currency join, unlocated exclusion, quantile refusal, no-data grey, formatting, measure count) — `financeMap.spec.ts:21-72`. Backend: 5 integration tests incl. permission gating, view-equality, currency isolation, unlocated, empty register — `finance.map.test.js:82-156`. **No test covers the rendered component, the basemap interaction, or `?ward=` sync.** |
| Spatial-allocation UI | **None at all.** `grep -rn "spatial" src/modules/finance/` returns zero matches. Milestone 2's register, draft/approve/reject/withdraw flow and methodology capture are unreachable through the product | — |
| Public map | **None.** `CouncilFinanceView.vue` (750 lines) contains no maplibre import; ward appears only as text on project cards (`:592`) | — |

---

## 4. Gap specification, per milestone

Each gap is one implementable task. Every one of them obeys §6.1: no new geometry store, no second tile
server, the map renders and never calculates, currencies stay separate, missing ≠ zero, RLS is the tenancy
boundary, finance measures never ride `/api/tiles/*` or `/api/ogc/*`, splits are approved acts.

Conventions used below: *view* = the SQL the endpoint reads (a new measure is a view column, never arithmetic in
Vue); *reuse* = the existing asset, with its path; *acceptance* = the check that proves it.

### M4 — Revenue and expenditure mapping

**M4-1 · Extend `finance.v_budget_ward_attribution` with the missing dimensions and measures** — MAJOR
- Create migration `200_finance_ward_measures.sql`; `CREATE OR REPLACE VIEW finance.v_budget_ward_attribution` adding
  `programme_id`, `activity_id`, `account_id`, `original_amount` (already present, keep), `approved_adjustments`,
  `actual_amount`, `available_excluding_commitments`, `available_including_commitments`, `variance` —
  **only on the `line_ward_code` and `unlocated` branches** (`199:62-71`). On `spatial_allocation` branches they stay
  NULL exactly as `original_amount` and `open_commitments` already do (`199:48-59`): re-splitting an adjustment or an
  available balance across targets without a recorded methodology is the assumption §6.1 rule 7 forbids.
- View it reads: `finance.v_budget_line_performance` (all 27 columns confirmed present in the live DB).
- Permission: none (view); re-run `tenancy.classify(..., 'tenant_view', ...)` and the `vungu_app` grant, as `199:241-252` does.
- Acceptance: for a line with no allocations, every new column equals the source view's value to the cent; for a split line, every new column is NULL and `budget_amount` equals `Σ` allocation amounts; `tenancy.classify` reports `tenant_view`.

**M4-2 · Extend `finance.v_ward_performance` to complete the thirteen-field panel** — MAJOR
- Same migration. Add to the `budget` CTE (`199:96-109`): `original_revenue`/`original_expenditure`,
  `adjustments_revenue`/`adjustments_expenditure`, `available_excluding_commitments`,
  `available_including_commitments`, `expenditure_variance`, and
  `revenue_collection_percentage = round(coalesce(revenue_actual,0)*100/revenue_budget, 2)` with the **same NULL guard
  as `:147-149`** (NULL when `revenue_budget IS NULL OR = 0`, never 0 %).
- Add `split_coverage_amount` and `unallocated_remainder_amount` so the panel can say how much of a split ward's money
  is attributed vs still unattributed, instead of the user inferring it from two counts.
- Acceptance: a ward with a revenue budget and no receipts shows `revenue_collection_percentage = 0.00` *and*
  `revenue_actual IS NULL` is distinguishable in the payload; a ward with no revenue budget shows NULL, not 0.

**M4-3 · `finance.v_ward_dimension_performance` — the department / programme / project breakdown view** — MAJOR
- Same migration. One row per `(authority_id, financial_year_id, currency, ward_code, unlocated_reason, department_id, programme_id, account_kind)` built from the M4-1 attribution view plus the same `actuals` CTE as `199:110-119`.
- This is what makes "expenditure by department / programme / project" a *rendering* rather than a client-side
  group-by. The UI must not aggregate rows itself.
- Acceptance: `Σ` over all departments for one (ward, year, currency) equals the matching `v_ward_performance` row exactly.

**M4-4 · `GET /api/finance/map/wards` — add dimension filters and apply department scope** — **BLOCKER** (scope), MAJOR (feature)
- Add params: `department_id` (uuid), `programme_id` (uuid), `account_kind` ('revenue'|'expenditure'),
  `dimension` ('total'|'department'|'programme'), `measure_set` (optional, for payload trimming).
- **Apply `departmentScope(fastify, request)`** exactly as `finance-budget.js:83`,`:94` does, as an additional
  `AND ($n::uuid[] IS NULL OR department_id = ANY($n))` on the M4-3 view. Today `finance-spatial.js:358-364` applies no
  scope at all (see BLOCKER-2).
- Response additions: `department_scope` (the array actually applied, or null), `dimension`, and
  `actuals_basis: 'transaction_ward_code'` so the client can state what "actual" means.
- Permission: unchanged `finance.map.view` (`:323`).
- Reuse: `departmentScope` in `src/middleware/financePermissions.js:89-101`; `SOURCES` const pattern `finance-spatial.js:48`.
- Acceptance: a `dept_head` with one row in `finance.user_scope` receives ward aggregates whose totals equal the sum of
  **only their own department's** lines, and the drill-down list from `/finance/budget-lines?ward_code=` sums to the
  same figure. A `finance_admin` with no scope row sees the unscoped totals.

**M4-5 · State the actuals attribution basis on the map, and offer the alternative as a view column** — MAJOR
- `v_ward_performance` attributes actuals by `finance.transaction.ward_code` (`199:111-119`), *not* by the geography of
  the line the transaction posts to. With 0 of 1 transactions ward-coded today, every ward will read
  "0 % executed" even where its budget lines are ward-tagged. That is an honest figure with a misleading face.
- Add `expenditure_actual_via_line` / `revenue_actual_via_line` as **additional columns** computed from
  `finance.transaction ⋈ finance.budget_line`'s attribution (not replacing the existing columns), and an
  `actuals_basis` selector on the endpoint. Both bases are legitimate; the map must say which one it is showing.
- Frontend: a one-line note under the legend, next to `Source: finance.v_ward_performance` (`MapSection.vue:310`).
- Acceptance: with a ward-coded budget line and a transaction carrying no ward code,
  `expenditure_actual IS NULL` and `expenditure_actual_via_line` equals the transaction amount; the legend names the basis in use.

**M4-6 · Frontend: measure groups, not a flat list of fourteen** — MINOR
- `useFinanceMap.ts:31-46` becomes three groups (Expenditure / Revenue / Attribution) with the new measures from M4-2.
  `MEASURES` keeps its shape — every entry still just `raw(row)`s a column, no arithmetic (`:23-29`).
- `measureDef(key).kind` grows a `'percent'` variant for collection rate; `formatMeasure` already handles it (`:60-70`).
- Reuse: existing `<select>` (`MapSection.vue:265-267`) becomes `<optgroup>`; no new component.
- Acceptance: `financeMap.spec.ts` gains a case per new measure asserting NULL passthrough; the existing
  "offers the seven measures" test (`:71`) is updated to the new count rather than deleted.

**M4-7 · Outstanding revenue / arrears — DO NOT BUILD** — **BLOCKED (D13)**
- No debtor or arrears amount exists anywhere in the database. `revenue_link.*` (migration 132) carries ERP account
  keys and status bands and **no amounts**, by design. There is nothing to render.
- The required behaviour is that the measure list **names the measure as unavailable with its reason** and renders no
  layer — not that it is silently absent (a user who has been promised an arrears map must learn why there isn't one),
  and absolutely not that a collection shortfall is relabelled as arrears.
- Acceptance: the measure selector shows "Outstanding revenue — not available: no arrears data source (Council decision D13)" as a disabled entry, and no code path computes a number for it.

### M5 — Projects and the capital map

**M5-1 · `GET /api/finance/map/projects` — create it (confirmed absent)** — MAJOR
- Params: `financial_year_id` (uuid, filters on `financial_year_ids @> ARRAY[$1]` as `finance-public.js` does),
  `currency` (USD|ZWG), `status` (the seven values of `188:528-530`), `department_id`,
  `bbox` (`minLon,minLat,maxLon,maxLat`, validated, applied as `pr.location && ST_MakeEnvelope($,$,$,$,4326)` so the
  existing GIST index `idx_project_location` (`188:554`) is used), `limit` ≤500, `offset`.
- Response:
  `{ financial_year, currencies: Currency[], features: GeoJSON.FeatureCollection, unlocated_projects: [{project_id, reference, name, status, currency, approved_budget, ward_code, reason: 'no_location'|'no_ward_or_location'}], unlocated: UnlocatedRow[], ward_register_linked, sources: ['finance.v_project_performance','finance.v_unlocated_finance'], generated_at, data_as_at }`.
  Each feature: `geometry` from `ST_AsGeoJSON(pr.location)`, properties = the whole `v_project_performance` row for
  that project plus `location_text`, `start_date`, `end_date`, `department_code`.
- View: `finance.v_project_performance ⋈ finance.project` — exactly the join `finance-projects.js:93-111` already makes.
- Permission: `finance.map.view` (`requirePermission(fastify, 'finance.map.view')`, same as `:323`); apply
  `departmentScope` as in M4-4.
- Reuse: the SELECT list at `finance-projects.js:93-111`; `wardRegisterLinked()` `finance-spatial.js:51-57`;
  the `SOURCES`/`generated_at` provenance block `:48`,`:377-385`.
- Acceptance: a project with a location appears once in `features` and not in `unlocated_projects`; a project with
  neither ward nor location appears in `unlocated_projects` **and** in the `projects` row of
  `v_unlocated_finance`; a `bbox` that excludes the point returns it in neither list but leaves
  `unlocated_projects` unchanged; the `EXPLAIN` shows an index scan on `idx_project_location`.

**M5-2 · Unlocated-projects list is a list, not just a count** — MINOR
- `v_unlocated_finance` gives only `unlocated_rows` + `unlocated_amount` per currency (`199:195-202`). An officer needs
  the names to fix them. Served by M5-1's `unlocated_projects` array; no new view required.
- Reuse: `finance-projects.js` list query with `AND pr.location IS NULL AND pr.ward_code IS NULL`.
- Acceptance: the card's count equals the array length, per currency.

**M5-3 · Frontend: graduated-circle project layer on the existing finance map** — MAJOR
- Add to `MapSection.vue` a second source/layer pair (`fin-projects`, `fin-projects-circle`) alongside
  `fin-wards` (`:137-140`, `:193-201`). Radius = `['interpolate',['linear'],['get','value'], …]` over
  `√(approved_budget)` classes from a new `computeCircleStops()` in `useFinanceMap.ts` built on the **same
  `computeBreaks` quantile logic** (`:88-102`) so circles and choropleth cannot disagree on what a class is.
  Colour = project `status`, from a named status scale added to `vunguBasemapStyle.ts` (see M5-8), never a second
  ad-hoc palette.
- A project with a NULL measure gets the no-data grey and the **minimum** radius, never radius 0 (invisible ≠ no money).
- Reuse: `computeBreaks`/`fillExpression` shapes (`useFinanceMap.ts:88-120`); the existing legend block
  (`MapSection.vue:302-311`) gains a circle-size key, as `mapExport.ts:18-21`'s `LegendEntry` already models.
- Acceptance: with 0 located projects (today) no circle layer is painted and the empty state of §6.4 renders; with one
  located project exactly one circle is drawn at its coordinates and clicking it opens the project panel.

**M5-4 · Project info panel** — MAJOR
- Fields: every "ALREADY COMPUTABLE" row of §2.3, grouped as Identity (reference, name, department, status, ward +
  `ward_status`), Money (currency, approved budget, allocated original/revisions/total, actual spend, remaining,
  execution % — "not defined" when nothing allocated), Other-currency (the `other_currency_*` JSON objects and
  mismatch counts rendered as explicit, un-summed rows), Time (start, end, last transaction date), Trace (linked
  subject → `LinkedFinancePanel.vue`), Location (`location_text`, coordinates, "no recorded location").
- **`physical_progress_percent` must not appear, not even greyed with a 0** — it does not exist (BLOCKED D12).
- Reuse: `src/modules/finance/components/LinkedFinancePanel.vue` (245 lines, already built, currently mounted only
  inside the finance module); the `fin-ward-facts` `<dl>` pattern `MapSection.vue:323-335`;
  `src/components/map/GeoMiniMap.vue` for the thumbnail (it already honours `prefersReducedMotion()` at its
  `fitBounds`); the existing project trace UI `ProjectsSection.vue:744-748`.
- Acceptance: panel renders from one `/finance/map/projects` feature with no second request; a project whose spend is
  in another currency shows that amount in its own row and it is absent from `actual_spend`.

**M5-5 · Replace the manual lon/lat inputs with a map picker** — MAJOR
- Today: two free-text decimal inputs, `ProjectsSection.vue:586-591`, validated only as "both or neither"
  (`:131`, `:204`), with the hint "With latitude, puts the project on the council's map." Nothing checks the point is
  inside the district, inside the stated ward, or on land. 0 of 1 projects has used them.
- Specify: keep the numeric inputs (they are the audit-friendly record and a surveyor may have a GPS fix) and add a
  **"Pick on map"** button that opens a picker modal; the modal writes the two inputs, and the inputs keep writing the
  marker. One source of truth, two editors.
- The picker is `StandPickerModal.vue`'s pattern, not a new one: that component already does
  `addVunguBasemap` + `/map-search` debounced name lookup + a draggable `maplibregl.Marker` + a reduced-motion
  guard (`src/components/StandPickerModal.vue:1-30`). Build `ProjectLocationPickerModal.vue` from it, swapping
  `locateStand` for "return the picked `[lon, lat]`".
- For the (later) case of a project footprint rather than a point, reuse `MapboxDraw` with the shared
  `DRAW_STYLES` exactly as `src/views/gis-officer/sections/StandsEditorSection.vue:5-6`,`:264` does (`src/map/drawStyles.ts`) — **not** the orphaned `src/views/gis-officer/map/MapWorkspaceSection.vue:111`.
- Server-side: add to `POST`/`PATCH /finance/projects` (`finance-projects.js:246-247`, `:352-353`) a check that the
  point falls within the authority's jurisdiction **when `admin.authority_ward` is populated**, warning (not refusing)
  otherwise — the same graceful-degradation shape as the allocation guard (`198:137-149`). A point outside the
  council's area is recorded with a flag, never silently moved.
- Acceptance: picking on the map fills both inputs to 6 dp; typing coordinates moves the marker; saving with the
  ward register empty succeeds with `location_outside_jurisdiction: null`; with the register loaded, a point in
  another district saves and returns `location_outside_jurisdiction: true`.

**M5-6 · Spend-vs-progress exceptions — DO NOT BUILD** — **BLOCKED (D12)**
- `finance.project` has no progress column (full table read, `188:515-549`). "Delayed" and "underfunded" views that
  rely only on dates and money *can* be built (`end_date < today AND execution_percentage < 100`), and should be,
  labelled for what they are — a schedule-and-money exception, not a physical-delivery one.
- Acceptance: no code path produces a progress percentage; the exception list's title and empty state name D12.

**M5-7 · The spatial-allocation register has no UI** — MAJOR
- Migration 198 and five endpoints exist; `grep -rn "spatial" src/modules/finance/` returns nothing. Project and
  budget-line splits — the mechanism that makes a ward choropleth correct for money that genuinely spans wards —
  cannot be recorded, approved, rejected or withdrawn through the product.
- Specify: `financeApi` additions (`listSpatialAllocations`, `createSpatialAllocation`, `approve|reject|withdraw`)
  mirroring `financeApi.ts:243-248`'s shape, plus a `SpatialAllocationPanel.vue` opened from the ward panel and from
  the project panel. The form **must not offer an equal-division button** and must require the `methodology` text
  (min 10 chars, as the schema enforces at `finance-spatial.js:151`).
- Reuse: the existing approve/reject confirmation pattern in `RevisionsSection.vue`; `FinancePromptDialog.vue` /
  `useFinancePrompt.ts` for the decision note.
- Acceptance: a draft recorded by officer A cannot be approved by officer A (403 `self_approval`, `:223-226`); an
  amount exceeding the line's revised total is refused with the trigger's message (422 `allocation_refused`,
  `:37`, trigger `198:204-207`); after approval the ward panel's `allocation_rows` increments and
  `attributed_lines` does not.

**M5-8 · Register the finance colour scales in the style module** — MAJOR (design-system integrity)
- `CHOROPLETH_COLORS` is a six-step blue ramp declared in `useFinanceMap.ts:105`. It is not in
  `src/map/vunguBasemapStyle.ts` and not in DESIGN.md's *Map Cartographic System*. §6.1 rule 1 says "no new style
  system"; DESIGN.md says the map paint and the legend swatch always agree through one source (`chipColorFor()`).
  The finance ramp currently has neither property.
- Specify: move the ramp and the new project-status scale into `vunguBasemapStyle.ts` as a named export
  (`FINANCE_CHOROPLETH`, `FINANCE_PROJECT_STATUS`) and add a *Finance overlay* subsection to DESIGN.md's cartographic
  section recording them, their no-data grey, and the rule that they sit **above** the basemap and **below** labels.
  `useFinanceMap.ts` imports instead of declaring.
- Reuse: `src/components/MapLegend.vue:1-27` is the precedent — it resolves every colour from the registry and defines none.
- Acceptance: `grep -n "#f7fbff" src/modules/finance/` returns nothing; the legend swatches and the paint expression
  read the same export; DESIGN.md names the ramp.

**M5-9 · The finance map fights the basemap it sits on** — MAJOR
- Two concrete defects:
  (a) `addVunguBasemap(map!)` is called with **no options** (`MapSection.vue:192`), so `visibleSet` = every catalogue
  layer (`vunguBasemap.ts:254-257`) rather than `DEFAULT_VISIBLE` (`:161-172`). Buildings, POI points, stands and all
  four admin fills render beneath a 0.78-opacity choropleth; DESIGN.md's label hierarchy and the per-province fills
  compete with the finance ramp for the same pixels.
  (b) `wireGlobalClick` (`vunguBasemap.ts:790-821`) installs a map-wide click that, for admin layers, calls
  `zoomToAdminFeature` (`:811-812`). The finance layer's own click (`MapSection.vue:205-208`) does not stop it.
  **Once ward polygons exist (post-D11), clicking a ward will select it in the panel and simultaneously drill-zoom the
  camera to the basemap ward beneath it.** The bug is invisible today only because there are no polygons.
- Specify: pass `{ defaultVisible: new Set(['country','provinces','districts','roads','water_areas','waterways','landuse','places_points']) }`
  (a quiet reference base; `ALWAYS_ON_LAYER` is added regardless, `:186`), and suppress the admin drill-zoom while the
  finance overlay owns the click — either by passing a flag through `addVunguBasemap`'s options or by listening to the
  existing `feature-click` custom event (`vunguBasemap.ts:816-820`) instead of registering a competing per-layer handler.
- Reuse: `setBasemapLayerVisible` (exported from `vunguBasemap.ts`), the `feature-click` event contract, and
  `src/components/MapLayerFilters.vue` if the user should control the reference layers.
- Acceptance: with polygons loaded, one click selects the ward and the camera does not move; the basemap under the
  choropleth shows roads, water and place names only.

### M6 (map surface only) — role-based map experiences

This section is confined to the MAP. The workspace-level role work (which sections a role sees, which permissions it
holds) is already done and owned elsewhere: `FinanceWorkspace.vue:95-97`,`:189-195` hides sections a person cannot
open, and `199:217-230` grants `finance.map.view` to all seven finance roles. **No new role and no new permission.**

**M6-1 · A preset table, derived from permissions the person already has** — MINOR
- Add to `useFinanceMap.ts` a pure `mapPresetFor(permissions: Set<string>): { measure: MeasureKey; dimension: string; currency: Currency | null; layers: string[] }`.
  Presets (recommended, not Council policy — nothing here changes authority):

  | Holds | Default measure | Default dimension | Extra surface |
  |---|---|---|---|
  | `finance.budget.approve` (committee/manager shape) | `execution` | total | exceptions list |
  | `finance.budget.prepare` only (budget officer) | `expenditure_budget` | department | unallocated / unlocated card expanded |
  | revenue-leaning (`finance.transaction.*` without budget approve) | `revenue_collection_percentage` | total | collection measures first |
  | `finance.report.export` + no write codes (auditor) | `expenditure_actual` | total | export button, every control read-only |
  | `finance.project.manage` / `.approve` | project layer on, `allocated_total` | — | project panel open |

- The function is pure and unit-testable; the section reads it once on mount. It sets *defaults only* — every control
  stays available to anyone who holds `finance.map.view`, because the permission already says they may read these
  figures (`199:213-215`).
- Reuse: `store.can(code)` (already used at `MapSection.vue:102`,`:105`); `FinanceGuard.vue`.
- Acceptance: a unit test per preset asserting the chosen measure; a person with two role shapes gets the
  higher-privilege preset deterministically, never a random one.

**M6-2 · Department scope must reach the map** — see **M4-4 / BLOCKER-2**. This is the only *security*-grade item in M6.

**M6-3 · Auditor export** — MINOR
- `exportMapToPdf` (`src/map/tools/mapExport.ts:63`) already renders a municipal map sheet with a legend
  (`LegendEntry` `:18-21`), centre coordinates, zoom, scale and timestamp. It needs the map created with
  `preserveDrawingBuffer: true` (`:11-13`), which `MapSection.vue:185-190` does not set — one option, one line.
- Pass the real `legendEntries` (`MapSection.vue:225-241`) plus a subtitle carrying year, currency, measure, source
  view and `generated_at`, so an exported sheet cannot be quoted without its provenance.
- Acceptance: the exported PDF is not blank, and its footer names the year, the currency and the source view.

**M6-4 · What must NOT differ by role** — MINOR (a guardrail, not a build)
- The *figures* must not. Two people holding `finance.map.view` with the same department scope must see identical
  numbers for the same (ward, year, currency, measure). Presets change defaults and layer visibility only.
- Acceptance: an integration test that calls `/finance/map/wards` as two different roles with the same scope and
  asserts byte-identical `wards` arrays.

### M7 — Public transparency map

**M7-1 · PREREQUISITE: `finance.spatial_allocation` has no `published_select` policy** — **BLOCKER**
- Measured on the live DB: `pg_policy` for `finance.spatial_allocation` returns exactly two rows, `tenant_select`
  and `tenant_write` (both `app.is_platform() OR authority_id …`). `relrowsecurity = true`. By contrast
  `finance.budget_line` carries `published_select` + the two tenant policies (`188:1473-1478`).
- Why this blocks M7: `finance.v_ward_performance` is `security_invoker` (`199:95`), so an anonymous reader's own
  policies decide its rows. An anonymous read sees **zero** `spatial_allocation` rows, so
  `v_budget_ward_attribution`'s `split_total` CTE (`199:44-47`) is empty, so **every split line falls through to the
  unsplit branch** (`199:62-71`) and attributes its *entire* `revised_amount` to its own `ward_code`. The
  all-or-nothing rule that migration 198's header makes binding (`198:9-15`) silently inverts for the public.
  A public ward map built on this view would contradict the staff map and could report a ward's money that the
  Council explicitly allocated elsewhere.
- Fix, before any public map endpoint exists — either:
  (a) add `published_select` on `finance.spatial_allocation` keyed to the subject's publication, mirroring
  `188:1506-1512`'s shape: approved + not deleted + the subject's dataset published for the authority; **or**
  (b) build a separate `finance.v_public_ward_performance` that resolves attribution through a `security_definer`
  helper so the public cannot see a half-applied rule.
  (a) is preferred — it keeps one view and one attribution rule, which is the whole point of §6.1 rule 2.
- Acceptance: a regression test that creates a split line, publishes the budget dataset, reads
  `v_ward_performance` as an anonymous session, and asserts the ward figures **equal** the staff reading;
  and a second asserting an *unapproved* split leaks nothing.

**M7-2 · `GET /api/public/finance/map/wards`** — MAJOR
- Params: `financial_year_id` (uuid, required — the public portal always has a year selected, as
  `/public/finance/overview` requires it, `finance-public.js:83`), `currency` (USD|ZWG),
  `dataset` ('budget'|'revenue'|'expenditure'|'projects', default = every dataset live for that year).
- Response:
  `{ financial_year, currencies, wards: [{ward_code, ward_status, revenue_budget, revenue_actual, expenditure_budget, expenditure_actual, expenditure_execution_percentage, project_count }], unlocated: [{dataset,currency,unlocated_rows,unlocated_amount}], ward_register_linked, published_datasets: string[], provenance: {published_at, reporting_period_label, data_as_at, version} per dataset, sources, generated_at }`.
- **Aggregated per ward only.** No `budget_line_id`, no `project_id`, no transaction rows, no counterparties — the
  latter is structural, not filtered: `finance.v_published_transaction` does not select those columns
  (`finance-public.js:18-19`), and the public ward route must read `v_ward_performance` (whose actuals come from
  `finance.transaction` under `published_select`, `188:1495-1502`) rather than the base tables.
- Permission: **none** — `optionalAuth(fastify)`, the `anyone` object at `finance-public.js:58`. Authorisation is the
  database's: RLS admits only rows a live publication covers. Do not add a `WHERE` clause that an unpublished row
  depends on; that is precisely the failure mode `finance-public.js:7-16` exists to remove.
- D14 gating: a dataset absent from `finance.publication` for that year simply yields no measures for it, and the
  payload's `published_datasets` tells the UI which measures to offer. **The endpoint must not offer a measure the
  Council has not published, and must not infer one** (e.g. no expenditure choropleth derived from a published budget).
- Reuse: `provenance()` `finance-public.js:46-54`; the years route `:61-72`; the `anyone` guard `:58`.
- Acceptance: anonymous request with `budget` published and `expenditure` not published returns revenue/expenditure
  **budget** figures and NULL actuals, and `published_datasets = ['budget']`; the two-council probe (repeat of the
  F-18 live probe) returns only the requesting council's wards; withdrawing the publication makes the same request
  return no wards without a code change.

**M7-3 · `GET /api/public/finance/map/ward-geometry`** — MINOR
- Same shape as the staff route (`finance-spatial.js:391-414`) with `optionalAuth`. Safe: `admin.ward` and
  `admin.authority_ward` have `relrowsecurity = false` (measured) — they are national reference data, already
  readable by `vungu_app` (`199:241`). Ward boundaries are public information; the finance figures are what
  publication gates.
- Add an `ETag` / `Cache-Control` (the geometry changes only when the Council's ward list changes). The staff route
  has none either — see MINOR-12.
- Acceptance: anonymous 200 with `ward_register_linked:false, features:[]` today; after D11, 19 features and a
  cache hit on the second request.

**M7-4 · Public map panel in `CouncilFinanceView.vue`** — MAJOR
- `CouncilFinanceView.vue` is 750 lines with no map (confirmed: zero maplibre imports; ward appears as text at `:592`).
- Build `PublicFinanceMapPanel.vue` as a **thin wrapper over the same rendering logic** — import `computeBreaks`,
  `fillExpression`, `measureValue`, `formatMeasure`, `rowsByWard` from `useFinanceMap.ts` rather than re-deriving
  them, so the public choropleth and the staff choropleth cannot classify the same figures differently. The
  divergence is only in the data source and the measure list (restricted to `published_datasets`).
- It must carry the publication provenance visibly (published date, reporting period, `data_as_at`, version) — the
  public surface already has these and the staff map does not, so this panel is *more* honest, not less.
- Acceptance: the same ward and measure render the same class in both panels when both datasets are published;
  the panel states the publication version it is showing.

**M7-5 · Public project points** — MINOR
- Already served: `/public/finance/projects` returns `longitude`/`latitude` (`finance-public.js:360-406`) under the
  `finance.project` `published_select` policy (`188:1506-1512`), which requires status ∈ {approved, in_progress,
  suspended, completed} **and** a live `projects` publication. No new endpoint needed — only the map layer.
- D14 still governs whether the Council wants individual project *points* public as opposed to ward aggregates.
  Points are already public today if the projects dataset is published; that is a pre-existing D5/D14 question this
  audit flags rather than resolves.
- Acceptance: with the projects dataset withdrawn, the public map draws no project circles and says the dataset is not published.

### M8 — Spatial imports and advanced analytics

**M8-1 · Extend the existing import pipeline to spatial datasets** — MAJOR
- The pipeline to extend, not replace: `src/routes/finance-imports.js` — upload (`:370`, SHA-256 + idempotency key +
  duplicate refusal `:464-470`), list (`:572`), detail (`:609`), validate (`:641`), rows (`:863`), exceptions
  (`:893`, patch `:931`), commit (`:975`), cancel (`:1212`), reconciliation (`:1242`). Datasets today:
  `const DATASETS = ['budget','actuals','commitments','projects']` (`:48`).
- Add `'ward_register'`, `'project_locations'`, `'asset_locations'` to `DATASETS` and matching `REQUIRED_COLUMNS`
  groups (`:55-57`). Accepted payloads: GeoJSON, zipped Shapefile, GeoPackage, CSV/XLSX with coordinate columns.
- **Nothing about the state machine changes.** Upload → map → validate → exceptions → commit → reconcile stays
  identical; a geometry that fails validation is an exception row, exactly like a bad account code.
- Acceptance: the same file uploaded twice for the same year and dataset is refused with the existing
  `duplicate` response (`:464-470`); the audit trail carries the import exactly as a budget import does.

**M8-2 · CRS detection via `gis_ops.crs_registry`** — MAJOR
- The registry exists: `gis_ops.crs_registry` created at `132_gis_core_register.sql:65` and re-asserted at
  `187_fill_parcel_register_and_rates.sql:15-26`, with `srid, code, name, datum, proj4text, is_survey,
  transform_method, accuracy_m`; `GRANT SELECT … TO vungu_app` at `187:321`.
- Specify: the validate step reads the file's declared CRS (`.prj`, GeoPackage `gpkg_spatial_ref_sys`, GeoJSON's
  implicit 4326) and resolves it against the registry. An **unregistered CRS is an exception, never a guess**; a
  CSV with no CRS declaration is an exception asking the officer to state one from the registry, never defaulted
  to 4326.
- Acceptance: a Shapefile in SRID 22291 (the survey CRS, `is_survey = true`) validates with its transform recorded;
  one in an SRID absent from the registry produces an exception naming the SRID.

**M8-3 · Every geometry write goes through the existing gate** — MAJOR
- `spatial_planning.geom_from_geojson_checked(text, int, boolean)` (`106_geometry_validation.sql:19`, commented at
  `:51`) validates with `ST_IsValidReason`. Already the house pattern: `src/routes/stands.js:486-487`,`:535-536`;
  `src/routes/gis.js:104`,`:133`.
- Specify: the commit step writes through this function only. **Invalid geometry is rejected with its reason and never
  auto-repaired** (no `ST_MakeValid`, no buffer-zero trick) — a repaired boundary is a changed boundary, and for a
  ward register that is a delimitation act.
- Acceptance: a self-intersecting polygon in the upload produces an exception carrying the `ST_IsValidReason` text and
  commits nothing.

**M8-4 · Preview and explicit approval before any existing geometry changes; never silent replace** — MAJOR
- Specify: the validate response gains a `geometry_changes` block — per feature, `action ∈ {insert, update, unchanged}`,
  the target's identity, and for an update the before/after area and a flag when the change exceeds a configurable
  tolerance. Commit requires `confirm_geometry_changes: true` plus the exact `change_count` the preview reported
  (an optimistic-concurrency token), so a preview the officer did not see cannot be committed.
- For `ward_register`: writing `admin.authority_ward` is the D11 act. The import may **propose** rows; approval is a
  separate, audited decision recording `basis ∈ {proclamation, delimitation, interim, proposed}` and `instrument_ref`
  (the columns migration 163 provides for exactly this). The system must never write the ward list from a file alone.
- Reuse: the exception-queue + approval shape of `finance-imports.js:893-975`; the audit rule pattern that
  `FIN_SPATIAL_ALLOCATION` follows.
- Acceptance: a commit without `confirm_geometry_changes` is refused; a commit whose `change_count` disagrees with
  the live preview is refused; `admin.authority_ward` is unchanged after a `ward_register` commit until the separate
  approval runs.

**M8-5 · Year-over-year ward choropleth** — MINOR
- The report already exists: `year_on_year` in `REPORT_NAMES` (`finance-reports.js`), with
  `financial_year_id` + `compare_financial_year_id` in `querySchema`. It has **no ward dimension**.
- Specify: add `ward_code` (and the M4-4 `department_id`) to `querySchema`, and a `/finance/map/wards/compare`
  endpoint returning two `v_ward_performance` rows per ward (base year, compare year) plus the delta **per
  currency** — never a cross-currency delta, and NULL where either year's figure is NULL (a ward that did not exist
  in the budget last year has no change, not a −100 %).
- Reuse: the report builder; `computeBreaks` with a **diverging** ramp added under M5-8 (a delta needs a diverging
  scale; the sequential blue ramp would misread negatives).
- Acceptance: a ward present in one year only renders as "no comparison", not as a maximum-class change.

**M8-6 · Project density and capital-investment distribution** — MINOR
- Both are renderings of M5-1's feature collection: density = a MapLibre heatmap layer or a per-ward count from
  `v_project_performance` grouped by `ward_code`; capital distribution = the choropleth of `Σ allocated_total` per
  ward, which the M4-3 view produces once projects carry wards.
- No new data and no new computation in the client: the per-ward project count/sum is a view column (M4-2's
  `project_count`), not a client-side `reduce`.
- Acceptance: the per-ward count on the map equals `SELECT count(*) FROM finance.v_project_performance WHERE ward_code = …` exactly.

**M8-7 · Unlocated analysis over time** — MINOR
- `v_unlocated_finance` is already per (year, currency, dataset) (`199:177-202`). A trend view is a query over years,
  not a new view: `/finance/unlocated` (`finance-spatial.js:300-315`) already accepts `financial_year_id`; make it
  optional-multi or let the UI call it per year.
- This is the measure of the programme's own progress — "how much of the Council's money can be placed on a map" —
  and should be on the Overview, not buried in the map section.
- Acceptance: the trend shows one point per year with a published or draft budget, and states that project rows are
  year-less by construction (`199:196`).

**M8-8 · Spend-vs-progress exceptions — DO NOT BUILD** — **BLOCKED (D12)**. See M5-6.

**M8-9 · `gis_ops.*` RLS debt must clear before M8 touches GMS paths** — MAJOR (pre-existing debt)
- The assessment records `gis_ops.*` as tenancy `pending` since migration 165, tracked by
  `scripts/verify-tenancy.js`. Any spatial import that writes through `gis_ops.feature` / `edit_session` would
  inherit an unclassified tenancy boundary, against §6.1 rule 5.
- Acceptance: `node scripts/verify-tenancy.js` reports no `pending` classification for `gis_ops` before the first
  spatial commit path ships.

### Cross-cutting gaps (not attributable to one milestone)

**X-1 · Ward→transaction drill-down has no backend** — MAJOR
- The §9-M3 requirement is "drill-down ward→department→programme→activity→line→transaction". There is **no staff
  transaction-register endpoint** in the entire backend (`grep -rn "finance/transactions"` matches only
  `finance-public.js:291` and `:344`). The ward panel therefore stops at budget lines
  (`MapSection.vue:103`) and projects (`:106`).
- Cheapest honest fix, reusing what exists: add `ward_code` to `finance-reports.js`'s `querySchema` and let the
  `transaction_register` report serve the ward's transactions (it already has `canView`, department scope, and a
  restricted-columns gate at `:112-116` of the run handler that keeps counterparty identity behind
  `finance.report.export_restricted`). A new `/finance/transactions` list endpoint is the alternative, but it would
  duplicate the report's restricted-column discipline.
- Acceptance: the ward panel lists that ward's transactions, counterparty identity absent unless the caller holds
  `finance.report.export_restricted`.

**X-2 · `?ward=` sync is one-way** — MAJOR
- Map → Budget works (`MapSection.vue:125` writes `{section:'budget', ward}`; `BudgetSection.vue:47-49` reads it and
  then watches `store.mapWardCode`). Map never reads it: `MapSection.vue:41-50` initialises `selectedWard` to `null`
  and nothing consults `route.query.ward` or `store.mapWardCode`.
- Specify: on mount, `selectedWard.value = (typeof route.query.ward === 'string' && route.query.ward) || store.mapWardCode`,
  and `watch(() => route.query.ward, …)`. Also push the ward into the URL when selected (today only
  `store.setMapWard` is called, `:119`), so a ward view is linkable and survives a reload — which is what a committee
  paper citing "ward 7's execution" needs.
- `openInProjects` (`:128-130`) **drops the ward entirely** — it pushes `{section:'projects'}` with no ward, so the
  Projects section opens unfiltered. `ProjectsSection.vue` has no `route.query.ward` read either.
- Acceptance: `/?section=map&ward=ZW170401` opens the map with that ward selected and its panel populated;
  "Projects" carries the ward filter through.

**X-3 · Provenance is query time, not data-as-at** — MINOR
- `generated_at: new Date().toISOString()` (`finance-spatial.js:384`), rendered as "as at {{ … }}"
  (`MapSection.vue:310`). That is when the SQL ran, not how current the underlying actuals are. The public surface
  already models the right thing — `data_as_at` from `finance.publication` (`finance-public.js:46-54`).
- Specify: add `data_as_at` to the staff payload, sourced from the latest committed import batch
  (`finance.import_batch.committed_at` per dataset) or the publication where one exists, and label the two
  separately in the legend: "figures as at <data_as_at> · read <generated_at>".
- Acceptance: the legend shows two distinct timestamps and neither is invented when the source is unknown (then it
  says "data currency not recorded").

**X-4 · The unlocated bucket's measures are computed and then discarded** — MINOR
- `v_ward_performance` emits full rows for `ward_code IS NULL` (measured today: two rows, USD and ZWG, carrying
  `revenue_budget 400000.00`, `expenditure_budget 425000.00`, `expenditure_actual 4200.00`,
  `expenditure_execution_percentage 0.99`). `/finance/map/wards` filters them out with
  `AND ward_code IS NOT NULL` (`finance-spatial.js:361`), and the unlocated card then shows only
  `unlocated_amount` from a *different* view (`v_unlocated_finance`). So the user can see how much money is
  unplaced but not how it is performing — even though the view already computed it.
- Specify: return the geography-less rows in a separate `unlocated_measures` array (keeping them out of `wards` so
  they can never be shaded), and render the unlocated card with the same measure set as a ward.
- Acceptance: the card shows execution and revenue variance for the unlocated bucket, and no unlocated row ever
  reaches `rowsByWard` (which already guards this at `useFinanceMap.ts:76`).

**X-5 · Execution reads 0.00 % where there are no actuals at all** — MINOR
- Measured: the ZWG unlocated row has `expenditure_budget 18,500,000.00`, `expenditure_actual NULL`, and
  `expenditure_execution_percentage 0.00` — because `:148` does `coalesce(a.expenditure_actual, 0) * 100 / budget`.
- Defensible (nothing spent *is* 0 % executed) but it conflates "no expenditure has occurred" with "no actuals have
  been imported yet", and with 0 ward-coded transactions in the system that is every row. Either return NULL when
  `transaction_rows = 0` **and** no import for that dataset has committed, or keep 0.00 and make the UI say
  "0 % — no transactions carry this ward code (n transactions in total have no ward)". The second is cheaper and
  more honest; it needs no SQL change, only the note from M4-5.
- Acceptance: the panel never shows a bare "0 %" without the sentence explaining the attribution basis.

**X-6 · No ETag/caching on ward geometry** — MINOR
- `/finance/map/ward-geometry` (`finance-spatial.js:391-414`) re-queries and re-simplifies 19 MultiPolygons on every
  call. The tile routes already model the pattern (`src/routes/tiles.js` serves cached + ETag). Trivial, and
  relevant because the public route (M7-3) will be hit by anonymous traffic.

**X-7 · `prefersReducedMotion()` is not used by the finance map** — MINOR
- `MapSection.vue:179` hardcodes `duration: 0`. DESIGN.md's *Click and motion* specifies 700 ms ease-out-quart or
  0 ms under reduce, and `vunguBasemap.ts:870` exports the helper (used correctly at `:717`, `:949-950`, and in
  `GeoMiniMap.vue:31`). The current code is accessible but off-spec and silently diverges from every other map.

---

## 5. Severity ranking

> **Implementation note — 2026-11-09.** Frontend slice 11 implements **M5-7** (the spatial-allocation
> register UI with server-enforced SoD), **M6-1** (permission-derived map presets, defaults only),
> **M6-3** (`preserveDrawingBuffer`, Export PDF, and a provenance subtitle/footer naming year,
> currency, measure, source view and `generated_at`) and **M7-5** (published project locations on
> the public map, one currency at a time, drawn only from released coordinates). See
> `docs/finance/REQUIREMENTS.md` § Slice 11. M5-5 (map location picker) remains open. The counts
> below are the original 2026-11-08 assessment and are kept as the baseline.

### BLOCKER (2) — must be resolved before the dependent milestone exists
| ID | Gap | Why blocker |
|---|---|---|
| **B-1** | `finance.spatial_allocation` has no `published_select` policy (M7-1) | Any public ward map reading `v_ward_performance` silently inverts the all-or-nothing attribution rule and can attribute a ward money the Council allocated elsewhere. Measured: `pg_policy` returns only `tenant_select`, `tenant_write`. |
| **B-2** | `/finance/map/wards` and (as specified) `/finance/map/projects` ignore `departmentScope` (M4-4) | A department-scoped officer reads aggregates spanning departments whose records they cannot open; the map's figures and the drill-down's figures disagree. `finance-budget.js:83`,`:94` scopes; `finance-spatial.js:358-364` does not. |

### MAJOR (16)
M4-1 (attribution view dimensions) · M4-2 (complete the 13 fields) · M4-3 (dimension view) ·
M4-5 (actuals basis unstated) · M5-1 (`/finance/map/projects` absent) · M5-3 (project layer) ·
M5-4 (project panel) · M5-5 (map location picker) · M5-7 (no spatial-allocation UI at all) ·
M5-8 (choropleth ramp outside the style module) · M5-9 (basemap click conflict + all layers visible) ·
M7-2 (public ward endpoint) · M7-4 (public map panel) · M8-1 (spatial import datasets) ·
M8-2 (CRS detection) · M8-3 (geometry gate) — plus M8-4 (preview/approval) and M8-9 (`gis_ops` RLS debt),
and X-1 (no transaction drill-down) and X-2 (one-way `?ward=` sync). *(20 items; the sixteen above plus the four
named after "plus" — counted individually in the summary at §9.)*

### MINOR (12)
M4-6 (measure grouping) · M5-2 (unlocated project names) · M6-1 (presets) · M6-3 (auditor export +
`preserveDrawingBuffer`) · M6-4 (figures must not vary by role — guardrail test) · M7-3 (public geometry route) ·
M7-5 (public project points already served; layer only) · M8-5 (year-over-year) · M8-6 (density/distribution) ·
M8-7 (unlocated trend) · X-3 (provenance) · X-4 (discarded unlocated measures) · X-5 (0 % execution) ·
X-6 (no ETag) · X-7 (reduced-motion helper unused).

---

## 6. What each surface honestly shows with today's data

Measured in `vungu_dev` on 2026-11-08 (all read-only):

| Relation | Rows | Note |
|---|---|---|
| `admin.authority_ward` | **0** | D11 open; Vungu RDC linked to no wards |
| `admin.ward WHERE parent_pcode='ZW1704'` | **19** | the plausible set — confirming it is a Council act |
| `finance.budget_line` | 4 (**0** with `ward_code`) | |
| `finance.transaction` | 1 (**0** with `ward_code`) | |
| `finance.project` | **1** (0 with `location`) | `VERIFY-202611081833`, USD 1,000, approved, no ward |
| `finance.spatial_allocation` | **0** | no split has ever been recorded |
| `finance.financial_year` | 1 | |
| `finance.publication WHERE state='published'` | 2 | |
| `council_ops.council_asset`, `admin.village`, `public.stands` | **0 each** | |
| `finance.v_ward_performance` | **2 rows, both `ward_code IS NULL`, `unlocated_reason='unlocated'`** | USD: rev budget 400,000.00 / exp budget 425,000.00 / exp actual 4,200.00 / execution 0.99 %. ZWG: exp budget 18,500,000.00 / actual NULL / execution 0.00 % |
| `finance.v_unlocated_finance` | 4 rows | budget ZWG 1/18,500,000 · budget USD 3/825,000 · transactions USD 1/4,200 · projects USD 1/1,000 |

### 6.1 Staff finance map (`/finance?section=map`) — exists today
**Honestly shows:** nothing on the canvas. `/finance/map/ward-geometry` returns `linked:false, features:[]`
(the D11 state), and `/finance/map/wards` returns `wards: []` because its `ward_code IS NOT NULL` filter
(`finance-spatial.js:361`) excludes the only two rows the view produces. The user sees the basemap, the D11 banner
(`MapSection.vue:289-294`) and a four-row unlocated card (`:382-402`).
**Required empty/degraded state — already correct:** the banner states the register is not linked, names D11, and says
"The measures below are real — nothing can be shaded on the map until the official ward list is recorded."
**What must be added:** the "ward-tagged figures" fallback table (`:404-424`) renders only when `wardRows.length > 0`,
which is never true today, so the promise in that banner ("The measures below are real") currently points at an
absent table. Either render the unlocated measures there (X-4) or change the sentence. **This is the one place where
the UI's copy overstates what it shows.**

### 6.2 Ward info panel
**Honestly shows:** nothing — it is unreachable (no polygon to click, no table row to click). Its fallback card
(`:372-380`) correctly explains why.
**Required state:** once X-4 lands, an "Unlocated" pseudo-ward entry that opens the same panel for the money that
cannot be placed. That is the only ward-shaped thing there is today, and it is worth looking at.

### 6.3 Revenue / expenditure measure switching (M4)
**Will honestly show:** with 0 ward-coded lines and 0 ward-coded transactions, **every measure for every ward is
NULL** and the entire map is "no data" grey. The measure selector will work and shade nothing.
**Required state:** before painting, if `wardRows.length === 0`, the section must say which of the two causes
applies — "no ward register (D11)" or "the register is linked but no budget line or transaction carries a ward
code (n lines, m transactions have none)" — with a direct link to the unlocated card. The existing banner at
`:296-300` says the second but does not give the counts, and it only renders when `linked` is true.

### 6.4 Project / capital map (M5)
**Will honestly show:** zero circles. One project exists; it has no location and no ward.
**Required state:** the project layer legend must render with an explicit "0 of 1 project has a recorded location"
line and the unlocated-projects list showing `VERIFY-202611081833` by name, with the "Pick on map" action (M5-5)
offered inline — the empty state should be the route to fixing itself, not a dead end. The circle layer must not be
added to the map at all when `features` is empty (an empty source paints nothing but still intercepts clicks).

### 6.5 Public transparency map (M7)
**Will honestly show:** nothing — no ward is linked, no ward-tagged figure exists, and two publications cover
datasets with no geography.
**Required state:** the panel must not render an empty grey map to the public. With `ward_register_linked: false` it
should render **no map canvas at all** and one sentence: "The Council's published finances are not yet mapped by
ward." A citizen shown a blank grey district will read it as "nothing was spent here", which is the exact
misreading §6.1 rule 3 exists to prevent. This is a stronger requirement than the staff map's, and deliberately so.

### 6.6 Spatial imports (M8)
**Will honestly show:** the pipeline will work and have nothing to import. The first genuinely useful spatial import
is the ward register itself — which is the D11 act and therefore must be a proposal plus a separate approval
(M8-4), not an import.

---

## 7. Reuse register — build nothing that already exists

| Need | Reuse this | Path |
|---|---|---|
| Add the basemap | `addVunguBasemap(map, { defaultVisible })`, `setBasemapLayerVisible`, `DEFAULT_VISIBLE`, `ALWAYS_ON_LAYER` | `src/map/vunguBasemap.ts:161-186`, `:254-257` |
| Reduced-motion camera | `prefersReducedMotion()`; `flyTo`/`fitBounds` wrappers | `src/map/vunguBasemap.ts:870`; `src/map/tools/camera.ts` |
| Hit-testing a click across stacked layers | `featureAtPoint(map, point, layerTitles)` | `src/map/featureAtPoint.ts:31` (used `EOPlannerView.vue:1651`,`:1899`, `BuildingInspectorView.vue:595`) |
| One click → one feature, no N-request storm | the `feature-click` custom event from `wireGlobalClick` | `src/map/vunguBasemap.ts:790-821` |
| Side info-panel with action buttons | the `info-panel` aside + its responsive rail/sheet CSS | `src/views/GISMapView.vue:186`, `:1067`, `:1216-1283` |
| Cross-layer identify | the identify service | `src/services/inspectorGis.ts` → `/api/inspector/identify` |
| Browse the data behind the picture | `AttributeTable.vue` (queryRenderedFeatures, sortable, row→zoom, dedupes tile-edge splits) | `src/components/map/AttributeTable.vue:1-18` |
| Debounced name search | `searchMap()` → `/api/map-search` | `src/services/vectorTiles.ts`; usage `HomeView.vue:166`, `StandPickerModal.vue:6` |
| PDF map sheet with legend | `exportMapToPdf(map, { title, subtitle, legend, fileName })` — **needs `preserveDrawingBuffer: true`** | `src/map/tools/mapExport.ts:63`, requirement `:11-13`, `LegendEntry` `:18-21` |
| Measure / radius / imagery tools | `MapToolbar.vue` (`Tool = 'none'\|'search'\|'measure'\|'radius'\|'imagery'`, emits `tool-change` so the host can pause its own click) | `src/components/map/MapToolbar.vue:24-28`, `:39-46` |
| A legend that cannot drift from the paint | `MapLegend.vue` — resolves every colour from the published registry, defines none | `src/components/MapLegend.vue:1-27`; `chipColorFor()` in `src/map/vunguBasemapStyle.ts` |
| Small read-only map of a few geometries | `GeoMiniMap.vue` (role-styled features, reduced-motion `fitBounds`) | `src/components/map/GeoMiniMap.vue:1-33` |
| Point picking with search + draggable marker | `StandPickerModal.vue` — the pattern for M5-5 | `src/components/StandPickerModal.vue:1-30` |
| Polygon digitizing | `MapboxDraw` + shared `DRAW_STYLES` | `src/views/gis-officer/sections/StandsEditorSection.vue:5-6`,`:264`; `src/map/drawStyles.ts` |
| Layer visibility chips | `MapLayerFilters.vue` (country intentionally excluded) | `src/components/MapLayerFilters.vue` |
| Finance ↔ domain trace | `LinkedFinancePanel.vue` + `/api/finance/linked/:kind/:id` | `src/modules/finance/components/LinkedFinancePanel.vue` (245 lines) |
| Money / percent formatting that respects NULL | `formatMoney`, `formatPercentage`, `formatDateTime` | `src/modules/finance/composables/useMoney.ts` |
| Department scope on a query | `departmentScope(fastify, request)` | `src/middleware/financePermissions.js:89-101`; applied `finance-budget.js:83`,`:94` |
| Provenance block on a public payload | `provenance(publication)` | `src/routes/finance-public.js:46-54` |
| Geometry write gate | `spatial_planning.geom_from_geojson_checked()` | `migrations/106_geometry_validation.sql:19`; usage `src/routes/stands.js:486` |
| CRS resolution | `gis_ops.crs_registry` | `migrations/132_gis_core_register.sql:65`, `187:15-26` |
| Import state machine | the nine `/finance/imports*` routes | `src/routes/finance-imports.js:370-1242`; datasets `:48` |
| Report + export with restricted-column gating | `/finance/reports/run`, `/finance/reports/export` | `src/routes/finance-reports.js:444`, `:486` |

### Do NOT extend (dead code the assessment flags, §2.4)
- `src/views/gis-officer/map/*` — orphaned GMS map workspace, unreachable. Its `MapboxDraw` setup
  (`MapWorkspaceSection.vue:111`) must not be the template for M5-5; use `StandsEditorSection.vue` instead.
- `src/components/ParcelSelectorMap.vue` — superseded.
- `src/map/pmtilesProtocol.ts` — unused protocol handler.
- Unused `leaflet` / geocoder dependencies.
- The mock mining polygons in `GISMapView.vue` — the only invented geometry in the repo; never a pattern to copy.

---

## 8. Security verification (§6.1 rule 6)

**Verified: no finance measure is reachable through `/api/tiles/*` or `/api/ogc/*`.**

| Check | Method | Result |
|---|---|---|
| Tile routes | `grep -rn "finance" src/routes/tiles.js` | **0 matches** (1,309 lines) |
| Tile SQL builder | `grep -rn "finance" src/lib/tileQuery.js` | **0 matches** |
| Tile layer allowlist | `grep -rn "finance" src/config/spatialLayers.js` | **0 matches**; every entry's `table` is a `public.*` basemap/master-plan relation |
| OGC bridge | `grep -rn "finance" src/routes/ogcServices.js` | **0 matches** |
| Dynamic layer registration (the plausible bypass) | `src/routes/dynamic-layers.js` | Constrained to `table_schema = 'public'` at `:52-53`, `:116-117`, `:443-449`, intersected with `spatial_layers.is_visible` and filtered by `isPrivateTable()`. The `finance` schema is **not reachable**. |
| Which routes touch the finance schema at all | `grep -rln "finance\." src/routes/*.js` | Exactly the ten `finance-*.js` files. No spatial/tile/OGC route is among them. |
| Staff map permission | `finance-spatial.js:94`,`:301`,`:323`,`:392` | All four read endpoints behind `requirePermission(fastify, 'finance.map.view')` |
| Permission exists and is read-only | `199:217-224` | `is_approval=false, is_publication=false, is_restricted=false`; granted to all seven finance roles `:226-230` |
| Permission actually enforced | `src/routes/__tests__/finance.map.test.js:82-90` | anonymous → 401, planner (no finance role) → 403, on both `/finance/map/wards` and `/finance/map/ward-geometry` |
| Currency isolation enforced at the boundary | `finance.map.test.js:120-131` | a `currency=ZWG` request returns no USD row, in `wards` **and** `unlocated` |
| Figures equal the view, not a recomputation | `finance.map.test.js:113-118` | endpoint value compared to a direct `SELECT` from `v_ward_performance` |

**Public finance surface is publication-gated — with one blocker.**
`finance-public.js` uses `optionalAuth` only (`:58`) and contains no authorisation logic by design (`:7-16`); every
row it returns must pass a `published_select` policy requiring a **live publication row**
(`188:1438-1512`, hardened by 194/197). Counterparty identity is structurally absent from
`finance.v_published_transaction`, not filtered (`:18-19`).
**However:** `finance.spatial_allocation` carries **no `published_select` policy** (measured —
only `tenant_select`/`tenant_write`). It is not currently reachable publicly, so **this is not a live leak**; it is a
latent correctness failure that fires the moment a public route reads `v_ward_performance`. Reported as **BLOCKER B-1**.

**One more property worth recording:** `/finance/map/ward-geometry` serves ward polygons through the authenticated
finance route rather than the public tile layer, even though `admin.ward` has `relrowsecurity = false` and the same
boundaries are already public via `/api/tiles/wards`. That is harmless duplication, not a violation — and it is the
right call, because it keeps the *authority↔ward* relationship (which is Council-specific) off the public tile surface.

---

## 9. Blocked list — nothing below may be built or faked

| Decision | What it blocks on the map | Honest degraded behaviour required |
|---|---|---|
| **D11 — official ward list** | Every ward polygon. `admin.authority_ward` = 0 rows (measured). Without it no choropleth, no ward panel, no ward validation; every coded ward reports `ward_status='unlinked'` (`199:131-138`). The 19 wards under `ZW1704` are plausible, **not confirmable by us**. | Staff map: the existing D11 banner (`MapSection.vue:289-294`) — correct. Public map: render **no canvas** and one sentence (§6.5). Never draw the 19 candidate wards "provisionally". |
| **D12 — physical progress** | `physical_progress_percent` does not exist (`188:515-549`). Spend-vs-progress exceptions, progress choropleths, "80 % spent / 40 % built" flags — all unbuildable. | Schedule-and-money exceptions only, labelled as such. No progress figure anywhere, not even NULL-rendered as a field. |
| **D13 — arrears data source** | "Areas with outstanding revenue". No debtor amount exists in any table; `revenue_link` carries keys and status bands, no amounts. | The measure appears in the selector as explicitly unavailable with the reason (M4-7). Collections and budgets must never be relabelled as arrears, and a collection shortfall is not an arrear. |
| **D14 — public disclosure matrix** | Which ward aggregates may be published. Gates M7-2's `dataset` parameter and M7-5's project points. | The public map offers only measures whose dataset has a live publication, and infers nothing (no expenditure map derived from a published budget). |
| **D15 — allocation approval authority** | Nothing technically; the default (budget/project approvers decide splits) is in force (`finance-spatial.js:44-45`). | M5-7's UI must record the methodology and never offer equal division; if Council later restricts approval to committee, that is a `finance.role_permission` change, not new code. |

**Also blocked, not by a decision but by absent data:** asset-value and revenue-generating-facility layers
(`council_ops.*` = 0 rows each), village-level views (`admin.village` = 0), and property-level revenue mapping
(`public.stands` = 0 in this database).

---

## 10. Conflicts with §6.1 — stated explicitly

Three specification requirements cannot be met as literally framed without breaching a binding principle. Naming
the conflict is the deliverable; resolving it is a Council or architecture decision, not an implementation choice.

1. **"Areas with outstanding revenue" vs rule 3 (missing ≠ zero) and the no-fabrication rule.**
   There is no arrears figure. Any map of outstanding revenue would have to derive one — most plausibly
   `revenue_budget − revenue_actual`, which is a *collection shortfall against budget*, not a debt owed by anyone.
   Publishing that as "outstanding revenue" would state a ward owes money it may not owe. **Conflict: the
   requirement cannot be met; D13 must resolve before the surface exists.**

2. **"Progress vs spend exceptions" vs rule 2 (the map renders, it never calculates).**
   A progress percentage could be inferred from elapsed schedule (`start_date`/`end_date` vs today). That would be
   the map calculating a delivery measure that no officer recorded, against rule 2 and against D12's whole point.
   **Conflict: elapsed time is not physical progress; do not substitute it.**

3. **Ward-level actuals vs the single attribution rule.**
   `v_ward_performance` attributes budget through allocations-or-ward_code (`199:12-24`) but actuals through the
   *transaction's own* `ward_code` (`199:20-21`). These are two different attribution rules in one row, and the row
   presents them as one ward's performance. It is defensible and documented — but a user reading "budget 425,000,
   actual 4,200, execution 0.99 %" has no way to know the numerator and denominator were attributed differently.
   **This is not a rule breach; it is an honesty gap.** M4-5 closes it by naming the basis on the surface. Until
   then, "ward execution %" should be read as "ward-coded spend against ward-attributed budget", and the panel
   should say so.

A fourth item is a *soft* breach already present in the code: the finance choropleth ramp
(`useFinanceMap.ts:105`) is a colour system defined outside `vunguBasemapStyle.ts` and undocumented in DESIGN.md,
against rule 1's "no new style system" and DESIGN.md's single-source-of-truth rule for swatch↔paint agreement.
M5-8 fixes it.

---

## 11. Summary counts

- **BLOCKER: 2** — B-1 (`spatial_allocation` has no `published_select`; blocks M7 entirely),
  B-2 (department scope absent from the map endpoints).
- **MAJOR: 20** — M4-1, M4-2, M4-3, M4-5, M5-1, M5-3, M5-4, M5-5, M5-7, M5-8, M5-9, M7-2, M7-4,
  M8-1, M8-2, M8-3, M8-4, M8-9, X-1, X-2.
- **MINOR: 15** — M4-6, M5-2, M6-1, M6-3, M6-4, M7-3, M7-5, M8-5, M8-6, M8-7, X-3, X-4, X-5, X-6, X-7.
- **BLOCKED (not gaps — do not build): 3 surfaces** — outstanding revenue (D13), spend-vs-progress (D12),
  ward polygons at all (D11); plus D14 gating the public measure list and D15 holding the split-approval default.
- **Total implementable tasks: 37.**

**Measure coverage:** 8 of the 13 required ward-panel fields are already computable from migration 199;
5 need SQL (original, adjustments, available ±, expenditure variance, project measures); 0 are blocked.
For the project panel, every field except `physical_progress_percent` is already computable from
`v_project_performance`; that one is blocked by D12.

**Endpoint coverage:** 6 spatial endpoints exist; 3 are missing (`/finance/map/projects`,
`/api/public/finance/map/wards`, a staff transaction register with a ward filter).

**Frontend coverage:** one map section exists and is genuinely well-built on the parts it covers (NULL ≠ zero,
quantile breaks that refuse to invent a scale, currency-safe join, first-class unlocated card, honest D11 banner).
Missing: the project layer, the public map, the allocation UI, inbound `?ward=` sync, transaction drill-down,
PDF export, and clean coexistence with the basemap it draws on.
