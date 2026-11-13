# GIS–Finance Integration Architecture Assessment (Milestone 1)

**Project:** Vungu RDC — GIS-Integrated Municipal Budget and Financial Management System
**Date:** 2026-11-08
**Status:** Phase 1 delivered. **Milestone 2 implemented the same day** — migrations 198/199 (`finance.spatial_allocation` + guard trigger, `v_budget_ward_attribution`, `v_ward_performance`, `v_unlocated_finance`, `finance.map.view` permission), the `/api/finance/spatial-allocations` + `/api/finance/unlocated` routes, a ward filter on `/api/finance/budget-lines` and in the Budget section, audit rule `FIN_SPATIAL_ALLOCATION`, 12 new DB-backed tests (backend suite 56/614 green), decisions D11–D15 added to the register.
**Scope inspected:** `Manicipal-drums-frontend` (Vue 3 + Vite + TS), `Manicipal-drums-backend-3` (Fastify + PostgreSQL 14/PostGIS 3.6), and the live dev database `vungu_dev`.

---

## 1. Executive summary

The system is **architecturally ready** for GIS–finance integration. Both halves already exist and are production-shaped:

- A mature PostGIS spatial platform: canonical ward geometry (`admin.ward`, 1,961 COD-AB wards), national cadastre (`land.parcel`), governed layer/style registry, custom MVT vector tiles, QGIS Server (WMS) + QGIS Desktop plugin authorship loop, live-change SSE.
- A mature finance module (migrations 188–197, all suites green 2026-11-07): dual-currency ZWG/USD integrity, SQL-computed performance views, RLS tenant isolation, publication workflow, audit trail, import pipeline.

The bridge between them is **deliberately thin today but already drafted**: `ward_code` text on `budget_line`/`transaction`/`project`, a `location POINT` column (with GIST index) on `finance.project`, and a `LinkedFinancePanel` seam. What is missing is (a) a real geographic **allocation model** (multi-ward splits with explicit amounts), (b) **ward roll-up computation** (no view aggregates finance by ward), (c) **map endpoints and UI** (zero maps in the finance module), and (d) — most critically — **real data linkage**: the ward↔authority register (`admin.authority_ward`) is **empty**, and 0 of the 4 demo budget lines carry a ward code.

**Nothing needs to be invented and no second spatial architecture is required.** The integration extends existing tables, reuses the existing finance SQL views, and builds the map on the existing MapLibre + MVT basemap stack. Gaps that require Council decisions or real source data are listed in §7–§8 and must not be filled with synthetic values.

---

## 2. Existing GIS capabilities (backend)

### 2.1 Spatial data model

| Domain | Relation | Geometry | Source migration | Tenant status |
|---|---|---|---|---|
| Ward boundaries (canonical) | `admin.ward` | MultiPolygon 4326 + GIST | 132, reshaped 163 | `national`/reference (intentionally not tenant-scoped) |
| Authority↔ward (time-versioned) | `admin.authority_ward` | — | 163 | reference |
| Authority jurisdiction | `admin.authority_area` | VIEW: `ST_Union` of current wards | 163 | reference |
| Villages | `admin.village` | Point (no GIST) | 132 | reference; **0 rows** |
| Cadastre | `land.parcel` (`geom_wgs84`) | MultiPolygon + GIST | 132/164/174/187 | `national`; delete-proof (`parcel_guard`), append-only `parcel_event` (175) |
| Buildings | `land.building` | Point | 132/187 | national; 0 rows in register |
| Council assets | `council_ops.council_asset`, `road_asset`, `road_structure`, `wash_asset`, `livestock_facility` | Mixed + GIST | 123 | tenant w/ RLS (167); **all empty** |
| GMS editable features | `gis_ops.feature` / `feature_version` / `edit_session` | Geometry + GIST | 133 | **RLS `pending` (debt)** |
| Planning registers | `spatial_planning.permit_application` (Point), `planning_project` (MultiPolygon), `statutory_plan.boundary`, `survey_task`, health registers (Points) | Mixed + GIST | 070–128 | tenant w/ RLS (169) |
| Survey | `survey.*` (SRID 22291) | Mixed | 102 (frozen legacy, 173) | `system` |
| Basemap | `public.country/provinces/districts/wards(view)/roads/rivers/landuse/…` | Mixed + GIST | 074 etc. | served via public tile routes |

Key facts:
- `public.wards` is a **compatibility view** over `admin.ward` (163); `stands.ward_fid` FK points at `admin.ward(legacy_fid)`.
- `admin.authority_ward` carries `basis ∈ {proclamation, delimitation, interim, proposed}` + `instrument_ref` — the designed home for the Council's official ward list.
- Geometry write-gate: `spatial_planning.geom_from_geojson_checked()` (106) validates every geometry write with `ST_IsValidReason`.
- `land.parcel` boundaries are immutable outside `gms.survey_import` GUC; lineage via `parcel_lineage`, adoption events via `parcel_event`.

### 2.2 Layer catalogue, styles, QGIS

- **Governed style registry** (`114_gis_style_registry.sql`): `gis_layer`/`gis_style`/`gis_style_audit` + `gis_published_style`, lifecycle draft→…→published, one published version per layer, append-only audit, renderer-neutral `vungu.gis.style/1` docs. Frontend admin UI: `/admin/gis-symbology`. Seeder: `scripts/seed-gis-style-registry.mjs` (frontend repo).
- **Publication allowlist**: `public.layer_publication` (152) — default DENY, `audience staff|public`.
- **QGIS Server** 3.40 via `docker-compose.qgis.yml` (nginx :8080), bridged at `/api/ogc/*` (WMS/WFS/WMTS/OGC-API) with vector fallback when down.
- **QGIS Desktop plugin** (`qgis-projects/vungu-integration`, shipped as `vungu-qgis-plugin.zip`): staff authorship loop — pushes layers/styles to PostGIS + registry with revocable API tokens. Philosophy (docs/QGIS_WEB_INTEGRATION.md): *QGIS Desktop authors, web portal serves, one PostGIS.*
- **Live sync**: trigger `notify_spatial_change()` (109) → `pg_notify` → tile-cache invalidation + SSE `/api/map/events`.

### 2.3 Spatial API surface

- **MVT tiles** (public, cached, ETag): `/api/tiles/:layer/:z/:x/:y.pbf` + catalogue `/api/tiles/layers` (`src/routes/tiles.js`, `src/lib/tileQuery.js`). `stands`/`acua_stands` served via `*_tile_view`.
- **GMS**: `/api/gms/tiles/*`, edit sessions with QA approval + versioning, `/api/gms/search`, DXF export.
- **OGC bridge**: `/api/ogc/wms|wfs|wmts|api/*` — anonymous, gated only by `layer_publication`/`publicLayers`.
- **Identify/search**: `/api/map-search`, `/api/map-query`, `/api/parcels/locate|find|nearby`, `/api/inspector/identify` (cross-layer drill-down), `/api/wards`.
- **⚠️ Security property to preserve:** tile/OGC routes are *public by design* (basemap). **Finance measures must never ride these routes** — they need authenticated, permission-checked endpoints (§6.3).

### 2.4 Frontend map stack

- **MapLibre GL JS 4.7** everywhere; shared basemap engine `src/map/vunguBasemap.ts` + registry-first style resolution (`vunguBasemapStyle.ts`); MapboxDraw (digitizing), OpenLayers only in the planner WFS-T editor.
- Proven interaction patterns to reuse: `featureAtPoint` hit-testing + `feature-click` events; side info-panel with action buttons (`GISMapView.vue:766-870`); identify API (`inspectorGis.ts`); attribute table (`components/map/AttributeTable.vue`); search (`/map-search`, debounced); **PDF map export** (`map/tools/mapExport.ts`); measure tools; legend component resolving colours from the published registry.
- Map route permissions are pinned by `src/router/__tests__/route-roles.spec.ts` (`/gis-map` = COUNCIL_STAFF; `/qgis-map`, `/explorer` public).
- Dead weight to avoid extending (flagged, not removed): orphaned GMS map workspace (`src/views/gis-officer/map/*` — unreachable), `ParcelSelectorMap.vue`, `pmtilesProtocol.ts`, unused `leaflet`/geocoder deps, mock mining polygons in `GISMapView`.

---

## 3. Existing finance capabilities (backend)

- **26 tables + 4 views**, migrations 188–197. Money = `numeric(18,2)`, currency CHECK `USD|ZWG`, never converted or summed across currencies (decision D4).
- **All measures computed in SQL views** (the map must reuse these, never re-implement):
  - `finance.v_budget_line_performance` — original / approved adjustments / revised / actual / open commitments / available (± commitments) / execution % (NULL when revised=0) / variance / currency-mismatch counters, per line.
  - `finance.v_department_performance` — department roll-up, grouped by currency.
  - `finance.v_project_performance` — one row per project: allocations, spend (apportioned), remaining, execution %, `financial_year_ids`.
  - `finance.v_published_transaction` — public surface; counterparty columns structurally absent.
- **RBAC**: permission catalogue (33 codes) + role defaults + per-user grant/deny overrides + department scopes (`finance.user_scope`). Roles: `finance_admin, finance_officer, budget_officer, dept_head, finance_committee (treasurer/approver), publisher, auditor` (+ technical `admin`). Separation of duties enforced (admin approves/publishes nothing; requester ≠ approver).
- **Tenant isolation**: every finance table via `tenancy.make_tenant` RLS; public visibility = `published_select` policies keyed to a **live `finance.publication` row** (194 perf rewrite; 197 closes cross-tenant reads; fails closed).
- **Publication workflow**: request → preview (per-currency counts/totals) → approve (finance_committee) → publish (publisher, transactionally supersedes) → withdraw. Budget lines additionally flip to `status='published'`.
- **Audit**: `public.admin_audit_event` append-only; every mutating request incl. 403 refusals; structured before/after on approvals/publishes/imports/access changes.
- **Import pipeline**: upload (SHA-256, idempotency key, malware scan) → map → validate → exceptions → commit → reconcile; commitments import-only; wards validated against `admin.ward` *when populated*, gracefully degraded otherwise.
- **Financial-year integrity**: `assert_year_open()` DB trigger — closed/archived years reject writes at the DB level.

---

## 4. Existing finance↔GIS integration points (already built)

| Seam | Where | State |
|---|---|---|
| `ward_code` text on `budget_line`, `transaction`, `project` | migration 188; carried into `v_budget_line_performance`, `v_project_performance`; exposed on project endpoints + project report | Stored, import-mapped — **not FK, not validated in UI, not filterable on budget/transaction endpoints** |
| `finance.project.location POINT(4326)` + GIST | migration 188; written by POST/PATCH `/finance/projects` (lon/lat); returned by staff + public endpoints | **0 rows use it**; frontend has manual lon/lat fields ("puts the project on the council's map") but renders no map |
| `linked_subject_kind/id` on projects | `development_application, planning_project, survey_project, council_asset, service_desk_ticket, environmental_review, other` + `/api/finance/linked/:kind/:id` | Backend + `LinkedFinancePanel.vue` exist; **panel is not mounted outside the finance module** |
| Ward validation in importer | `finance-imports.js` validates against `admin.ward` when populated | Graceful degradation by design |
| Rates/ERP seam | `revenue_link.*` (132): parcel↔ERP account keys + status bands, **no amounts** | Read-only integration surface |

---

## 5. Spatial status per entity (prompt Phase 1 requirement)

**Already geographic:** wards, villages (empty), parcels, stands (empty table currently), buildings (register empty; 5.7M national in `public.buildings`), roads (210k national; council register empty), council asset registers (empty), GMS features (empty), permit applications, planning projects, statutory plans, survey tasks, health registers, basemap layers.

**Financial entities and their needed spatial relationship:**

| Financial entity | Today | Needed | Mechanism |
|---|---|---|---|
| Budget line | `ward_code` text (optional) | single ward (primary) or explicit multi-area split | ward reference validation + `spatial_allocation` for splits |
| Transaction | `ward_code` text (optional) | trace to ward (derived via budget line/ward_code); project-linked via `project_transaction` | ward filter + drill-down; no new geometry |
| Project | `ward_code` + `location POINT` (unused) | verified point + ward; multi-ward split where justified | location promoted to first-class (picker + map), allocation for splits |
| Commitment | none | inherits its budget line's geography | via budget line |
| Revenue by property/facility | none (`revenue_link` keys only, no amounts) | requires rates/debtors source data | **blocked on data source — see D13** |
| Council assets w/ financial values | asset registers empty | asset value + expenditure linkage | Phase 11 imports + allocation targets |

---

## 6. Proposed integration architecture

### 6.1 Principles (binding)

1. **One spatial architecture.** No new geometry store, no second tile server, no new style system. Finance layers join the existing catalogue/registry/publication machinery.
2. **Map figures are traceable.** Every number on the map comes from the existing `finance.v_*` views (extended) — the map renders, it never calculates. Drill-down lands on the existing budget/transaction/project records.
3. **Currencies stay separate.** Choropleths are per selected currency; no conversion, no mixed-currency totals; missing ≠ zero (NULL renders "not defined"/unlocated).
4. **Unlocated is a first-class state.** Records with no ward and no allocation appear in an explicit "unlocated" bucket — never placed at an invented location.
5. **RLS is the only tenancy boundary.** New tables get `tenancy.make_tenant`; anything public gets `published_select` keyed to live publications (194/197 shape). No weakening for performance.
6. **Public tile routes stay dumb.** Finance measures flow only through authenticated `/api/finance/map/*` (staff) and publication-gated `/api/public/finance/map/*` (public) — never `/api/tiles/*`.
7. **Allocations are auditable acts** with explicit methodology; splits never default to equal division.

### 6.2 Data model (Milestone 2 — migrations 198+, versioned)

1. **`finance.spatial_allocation`** — the multi-area split table:
   `id, authority_id, subject_kind ('budget_line'|'project'), subject_id, target_kind ('ward' v1; 'parcel'|'stand'|'council_asset'|'village' later), target_code, amount numeric(18,2) CHECK (>0), currency CHECK (USD|ZWG), share numeric(6,5) NULL, methodology text NOT NULL, evidence_document_id → finance.document, status draft/approved, requested_by/at, approved_by/at, created_*/updated_*`.
   Constraints & semantics:
   - Currency must equal the subject's currency; per (subject, currency) the Σ amounts must not exceed the subject's revised/allocated total (enforced at approve time against the performance views).
   - **All-or-nothing per subject+currency:** if any allocation exists, ward roll-ups use *only* allocations (prevents double counting); the un-allocated remainder surfaces as "unallocated", never spread.
   - `tenancy.make_tenant` + audit events (`FIN_SPATIAL_ALLOCATION` rule).
2. **Ward reference hardening (no FK)** — keep `ward_code` text (import resilience is deliberate: budgeting must not be blocked by an unloaded national register), but add a validating trigger + normalisation: unknown codes (not in `admin.authority_ward` current set for the authority, when that register is populated) are accepted yet flagged `ward_status='unlinked'` in the roll-up view. UI gets a ward picker fed by the authority's linked wards.
3. **`finance.v_ward_performance`** (`security_invoker`, classified `tenant_view`) — one row per (ward_code, financial_year, currency): original, adjustments, revised, actual, open commitments, available (±), execution %, revenue budget/actual/variance (account `kind='revenue'`), project count/measures, allocation-derived vs ward_code-derived flag, `ward_status ∈ {linked, unlinked, unallocated_remainder}`. Built **from** `v_budget_line_performance` / `v_project_performance`, so publication RLS composes automatically for the public variant.
4. **`finance.v_unlocated_finance`** — per (year, currency, dataset): totals lacking ward + allocation. Feeds the "unlocated" card and prompt §9.11 analytics.
5. **`finance.project.physical_progress_percent numeric(5,2) NULL` + `progress_evidence_document_id`** — *only if Council decision D12 approves* (prompt Phase 7 compares physical vs financial progress; the field does not exist today).
6. **Ward filters** on `/finance/budget-lines` and `/finance/transactions` (flagged gap: stored but unfilterable), plus `?ward_code=` surfaced in Budget/Transactions sections.

### 6.3 Endpoints (Milestones 3–7)

- `GET /api/finance/map/wards?year&currency&dataset` — measures per ward + unlocated bucket + provenance (data-as-at, view sources). Permission: new `finance.map.view` (34th code) mapped onto all finance roles; `auditor` read-only by construction.
- `GET /api/finance/map/ward-geometry` — GeoJSON of the authority's current ward polygons from `admin.authority_ward` ⋈ `admin.ward`. **Empty register → 200 + `ward_register_empty: true`** so the UI states the truth instead of drawing nothing silently.
- `GET /api/finance/map/projects?year&currency&status&bbox` — points from `project.location` + `v_project_performance` measures; unlocated projects listed separately.
- Drill-down: existing endpoints with the new ward filters; project trace already exists (`/finance/projects/:id` + trace UI).
- Public (M7): `GET /api/public/finance/map/wards?year` — reads `v_ward_performance` under anonymous RLS: only data passing `published_select` appears; aggregated per-ward only; no counterparties, no points of individual projects unless project dataset published.

### 6.4 Frontend (Milestones 3–7)

- `FinanceMapSection.vue` (new section in `FinanceWorkspace`, permission-gated) + reusable `FinanceMapPanel.vue` (embeddable in Overview / Projects / public portal).
- MapLibre + `addVunguBasemap` as everywhere else; choropleth = data-driven `fill-color` on ward measures with quantile/step breaks; graduated circles for project spend; legend shows breaks, year, currency, source, as-at; explicit "unlocated" card.
- **Map⇄dashboard sync:** selected ward drives Overview/Budget/Projects filters (`?ward=` query); selecting a project row highlights it on the map and vice-versa (same record, same trace panel).
- Role experience = permission-driven presets (Finance Manager → execution + exceptions; Budget Officer → allocations + unallocated areas; Revenue Officer → revenue measures; Auditor → read-only + audit drill) — **no new roles**; the prompt's nine personas map onto the existing seven finance roles + admin (documented mapping in the plan).
- Public transparency map panel in `CouncilFinanceView` — published datasets only, year selector, ward click → published budget/revenue/expenditure summaries for that ward.

### 6.5 GIS imports (Milestone 8) and analytics

- Extend the **finance import pipeline pattern** (upload → validate → preview → approve → commit, idempotent, audited) to spatial datasets: GeoJSON/Shapefile/GeoPackage/CSV-with-coordinates; CRS detection via `gis_ops.crs_registry`; geometry gate `geom_from_geojson_checked` (invalid → rejected with reason, never auto-repaired); duplicate/orphan detection; match to `admin.ward`/`land.parcel` by code; **preview + explicit approval before any existing geometry changes; never silent replace**.
- Analytics (§9 of prompt): year-comparison choropleth, project density, capital investment distribution, expenditure-vs-progress exceptions, unlocated analysis — all built on the same views.

---

## 7. Data gaps — real state of the dev database (2026-11-08)

| Item | State | Consequence |
|---|---|---|
| `admin.authority_ward` | **0 rows** — Vungu RDC (authority 1, code VUNGU) is linked to no wards; `admin.authority_area` is empty | Ward choropleth has no polygons to shade until the official ward list is loaded. COD-AB district **ZW1704 "Gweru"** has **19 wards** (`admin.ward.parent_pcode='ZW1704'`) — the plausible Vungu RDC set, but the official list is a **Council confirmation (D11)**, not ours to guess |
| Finance demo data | 4 budget lines, 1 transaction, **0 projects**, 2 publications, 1 financial year (authority 1) | Nothing meaningful to visualise yet; real PROMUN/Pastel extracts (or Council-entered budgets with wards) are needed. **No synthetic finance data will be created to fill this** |
| `ward_code` coverage | 0/4 budget lines, 0/1 transactions | As above |
| `finance.project.location` | 0/0 populated | Project layer empty until projects exist with locations |
| Asset registers (`council_ops.*`) | 0 rows each | "Assets with financial values", "revenue-generating facilities" layers empty until Phase 11 imports |
| `public.stands` | 0 rows (dev DB state); `vungu_parcels` 733 / `land.parcel` 731 (farm cadastre) | Property-level revenue mapping depends on stands/parcels + rates data |
| `admin.village` | 0 rows | Village-level views unavailable (ward-level only) |
| Outstanding revenue by area | **No debtor/arrears amounts anywhere** (`revenue_link` carries keys + status bands only, by design "no amounts") | Prompt §5 "areas with outstanding revenue" is **blocked on a rates/debtors data source** (D13) |
| Physical progress % | Field does not exist | Prompt §7 progress-vs-spend comparison blocked on D12 |
| `gis_ops.*` RLS | `pending` since 165 | Must be cleared before Milestone 8 touches GMS import paths (existing debt, tracked by `scripts/verify-tenancy.js`) |

---

## 8. New Council decisions required (added to `docs/finance/DECISION-REGISTER.md` when approved to proceed)

- **D11 — Official ward list for Vungu RDC.** Confirm the 19 COD-AB wards under district ZW1704 (or the correct subset) as the Council's wards, with delimitation basis/instrument, to be recorded in `admin.authority_ward`. Without it the map runs in "ward register not linked" state.
- **D12 — Physical progress reporting on projects.** Whether `physical_progress_percent` is recorded (who, how often, evidence) or progress-vs-spend comparison stays out of scope.
- **D13 — Outstanding-revenue data source.** Which system holds arrears/debtor amounts per property/ward, and whether it may be imported. Until decided, revenue maps show collections and budgets only.
- **D14 — Public map disclosure matrix.** Which ward-level aggregates (budget/revenue/expenditure/projects) may be published on the public map, extending the existing publication datasets.
- **D15 — Spatial allocation methodology rules.** Approval authority for multi-area allocations and the required methodology evidence (extends the existing approval-chain pattern).

Existing open decisions D1–D10 remain (D10 is still the release gate).

---

## 9. Implementation plan (prompt Milestones 1–9)

Each milestone ends with: relevant suites green, DB changes reviewed, permissions verified, map verified visually, docs updated, gaps recorded. **No commit/push/deploy without approval.**

| # | Milestone | Content | Depends on |
|---|---|---|---|
| 1 | Architecture assessment | **This document** | — |
| 2 | Spatial-financial data model | Migrations 198+: `spatial_allocation`, ward hardening + validation, `v_ward_performance`, `v_unlocated_finance`, `finance.map.view` permission, ward filters on budget/transaction endpoints, (D12: progress field). Tests: allocation math, no-double-counting, currency separation, year integrity, RLS on new tables | D11 desirable (validation), D15 |
| 3 | Integrated finance map (staff) | `FinanceMapSection` + `FinanceMapPanel`, ward choropleth, ward info panel (the 13-field prompt list), drill-down ward→department→programme→activity→line→transaction, unlocated card, map⇄dashboard sync | M2; D11 for polygons |
| 4 | Revenue & expenditure mapping | Measure switching on the same map (revenue budget/actual/variance; expenditure by department/programme/project), revenue-collection performance, outstanding-revenue **only if D13 resolves** | M3 |
| 5 | Projects & capital map | Project points, status categories, info panel (prompt Phase 7 list), spend-vs-progress exception flags (**D12**), delayed/underfunded views | M3, D12 for progress |
| 6 | Role-based map experiences | Permission-driven presets for the seven finance roles + admin; auditor read-only + export; GIS/technical admin surface separation (GIS admin gets no finance approval powers — already true) | M3–M5 |
| 7 | Public transparency map | `/council/finances` map panel, publication-gated (`D14`), aggregated only, anon-access tests, two-council probe (repeat the F-18 live probe) | M3, D14 |
| 8 | Spatial imports & advanced analytics | Import pipeline extension (GeoJSON/SHP/GPKG/CSV), CRS detection, preview/approval workflow, reconciliation; year-over-year, density, capital-distribution analytics; clear `gis_ops` RLS debt | M2–M5 |
| 9 | Security, performance, end-to-end | Prompt §14 test list (20 items), load checks vs the 194 perf bar, RTM + audit docs update | M2–M8 |

**Deliberately out of scope / not attempted:** inventing ward boundaries, villages, project locations or asset geometries; auto currency conversion; replacing QGIS integration; weakening RLS; a second tile server; equal-division ward splits; displaying unpublished or cross-council data.

---

## 10. Traceability

Every prompt phase maps to the plan: Phase 1→M1 (this doc); Phase 2→M2; Phases 3–4→M3; Phases 5–6→M4; Phase 7→M5; Phase 8→M6; Phases 9→M4/M8; Phase 10→M7; Phase 11→M8; Phase 12→M9 (constraints §6.1); Phase 13→M3 (sync requirements); Phase 14→all milestones' exit criteria + M9; Phase 15→the milestone table above. Final acceptance criteria 1–17 are covered by M2–M9 exit criteria and the §6.1 binding principles.
