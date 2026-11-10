# CODEMAP — Vungu planning platform

Owner: `gis-eos-architect` (refresh via installed `doc-updater` / `/update-codemaps`).
Seed map — regenerate when structure changes; the orchestrator reads this for Impact Analysis.

## Frontend (this repo)
- Entry: `src/main.ts` → `App.vue`, Pinia, router. Global CSS `src/styles/main.css`
  (`:root` tokens incl. `--login-*`), `maplibre-polish.css`, `public-pages.css`.
- Routing: `src/router/index.ts` — role surfaces `/citizen-portal`, `/planner-workspace`,
  `/gis-officer-portal`, `/eo-planner`, `/inspector-portal`, `/planning-clerk`,
  `/environment-officer`, `/admin/*`; public `/`, `/login`, `/explorer`, `/development-application`.
- Views: `src/views/<role>/sections/*.vue` (290 SFCs total).
- Map module: `src/map/vunguBasemap.ts` (`addVunguBasemap`, `DEFAULT_VISIBLE`,
  `ALWAYS_ON_LAYER`, `setBasemapLayerVisible`), `src/map/vunguBasemapStyle.ts`
  (`styleLayerFor`, `chipColorFor`).
- Stores: `src/stores/*` (`spatial.ts`, `admin.ts`, …). Services: `src/services/*`
  (`api.ts` baseURL `/api`, `vectorTiles.ts`). Composables: `src/composables/*`.
- Shared components: `src/components/*` (map/*, workflow/*, MapLayerFilters, ParcelSelectorMap,
  StandPickerModal, PaymentMethodPicker, UiFeedback, …).
- Planning module: `src/planning/**` — `usePlanningTools.ts` (the subdivision engine: state,
  `runBlocks`/`runSubdivision`/`importDxf`, validation, save/load), `planning-types.ts` (the
  `PlanningProject` contract persisted to the backend), `subdivision.ts`/`block-generation.ts`
  (algorithms), `road-templates.ts` (Generate Neighbourhood), `cad/**` (the CAD drafting
  subsystem used by `src/views/planner/PlanningStudio.vue`). UI: `PlanningStudio.vue` (dedicated
  CAD Studio, `/planner/studio/:layer/:fid`) and `src/components/planner/PlanningPanel.vue` (side
  panel on `/planner`, owns Save/Export/Import DXF/CSV/PDF).
- CAD/GIS interchange: `src/map/tools/dxfExport.ts` (write) + `dxfImport.ts` (read) — the
  QGIS/AutoCAD subdivision round-trip (export DXF → edit externally → re-import via
  `usePlanningTools.importDxf()`). See ADR 0007, `docs/QGIS_WEB_INTEGRATION.md`.

## Backend (`../app-backend`)
- `server.js` (CommonJS) → Fastify, routes under `/api`, `@fastify/postgres` → `fastify.pg`.
- `src/routes/tiles.js` — `/api/tiles/layers`, `/api/tiles/:layer/:z/:x/:y.pbf` (`ST_AsMVT`),
  `/api/tiles/:layer/:id`.
- `src/routes/planning.js` — persistence for `src/planning/**` above:
  `spatial_planning.planning_project` (JSONB snapshot, optimistic-lock `revision`, migration 095;
  linked to a permit case via migration 108).
- `src/routes/qgis.js` — generic PostGIS layer push/pull for the PyQGIS plugin (NOT wired to
  `planning_project` — that round-trip goes through DXF client-side instead, see above).
- `src/config/spatialLayers.js` — 24-layer registry (minzoom, attributes allowlist, roads filter).
- `migrations/074_spatial_tile_indexes.sql` — GiST indexes. Smoke: `test-tiles-endpoint.js`,
  `scripts/verify-spatial-tables.js`.

## Data
Postgres `Vungu_spatial333` — 24 spatial layers + app tables (`development_applications`, …).
SRID 900914 ≡ 4326.

> Freshness: if this file predates recent `git log` on `src/` or the backend, refresh before
> using it for Impact Analysis (GOVERNANCE.md freshness gate).
