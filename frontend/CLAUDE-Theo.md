# CLAUDE.md

Project-level instructions for Claude Code and other agentic tools working in this repository.

## Project

Vungu Rural District Council planning portal — Vue 3 + Pinia + MapLibre GL frontend, Fastify + PostGIS backend (separate repo at `../app-backend`). Replaces paper-based development control with a digital workflow from intake through inspections, and publishes country-wide spatial data (provinces, districts, wards, roads, buildings, landuse) to staff and citizens.

## Design Context

Two strategic documents at the project root drive design and visual decisions. Read them before any UI work:

- **[PRODUCT.md](./PRODUCT.md)** — register, users, brand personality, anti-references, design principles, accessibility.
- **[DESIGN.md](./DESIGN.md)** — visual system: theme, OKLCH palette, typography, layout, radii, elevation, motion, components, plus a dedicated **Map Cartographic System** section that locks in the Google-Maps-style basemap palette (warm off-white land, road `fclass` scale, landuse classes, per-province colours, label hierarchy).

The impeccable skill at `.claude/skills/impeccable/` reads both files automatically. To refresh either, run `/impeccable teach` (strategy) or `/impeccable document` (visual tokens).

### Quick reminders

- Register is **product** (the design serves the planning workflow, it is not the marketing).
- Brand personality: trustworthy, calm, confident-without-decoration. No exclamation marks, no marketing language.
- Hero anti-reference: generic SaaS dashboard (cream + bright blue + hero-metric cards). Most strongly to be avoided.
- Accent (`#1a73e8`) is the only saturated UI colour and stays under ~10 % of any surface. Cartographic colours live in their own taxonomy.
- WCAG 2.1 AA across the board. `prefers-reduced-motion: reduce` collapses map `fitBounds` to a 0 ms jump (see `prefersReducedMotion()` in `src/map/vunguBasemap.ts`).

## Architecture

### Frontend (this repo)

- Routes by role: `/citizen-portal`, `/planner-workspace`, `/gis-officer-portal`, `/eo-planner`, `/inspector-portal`, `/admin/*`, plus public surfaces `/`, `/login`, `/explorer`, `/development-application`.
- Shared map module: `src/map/`
  - `vunguBasemap.ts` — `addVunguBasemap(map)` adds all 24 PostGIS tile layers + labels + admin drill-down click behaviour. Exports `DEFAULT_VISIBLE`, `ALWAYS_ON_LAYER` (always `'country'`), `setBasemapLayerVisible`.
  - `vunguBasemapStyle.ts` — `styleLayerFor(layer)` returns the MapLibre paint+layout config per layer. `chipColorFor(id, geomType)` returns the swatch colour for the filter UI. Single source of truth — UI swatches and map paint always agree.
- Frontend filter component: `src/components/MapLayerFilters.vue` — floating chip panel on the home preview. Country is intentionally excluded from the toggle list.
- Spatial store: `src/stores/spatial.ts` — Pinia store with `loadTileLayers()` / `toggleTileLayer(map, id)` actions, OGC fallback for QGIS Server layers.
- Inspector GIS: `src/services/inspectorGis.ts` + `src/inspector/siteGeo.ts` front the
  `/api/inspector/*` endpoints (sites, site-report, identify, geo-verification,
  site-location). An inspection site is resolved **server-side** and always carries a
  precision (`boundary` / `point` / `area` / `none`) — never place an `area` or `none` site
  on the map or geofence against it (ADR 0010). Hold a MapLibre `Map` in `shallowRef`,
  never `ref` (ADR 0011).
- Inspector console: `src/views/InspectorWorkspaceView.vue` renders thirteen sections from
  `src/views/inspector/sections/`, over the shared `--ent-*` primitives in
  `src/views/inspector/inspector.css` and the one permit picker
  (`components/inspector/InspectorCasePicker.vue`). The workspace URL contract lives in
  `src/inspector/consoleRoute.ts`: `/:inspectionId?` + `?section=` + `?pane=` + `?permit=`,
  read with `readLocation()` and written with `mergeQuery()`. Section and pane changes
  **push** (Back walks them); opening a case **replaces**. Watch `caseKey(location)`, never
  the location object — it is recomputed on every breakpoint change, so an object watcher
  re-fetches the case on resize. Two of the console's defaults are the inspector's to set
  (Settings section): `defaultSection` on `readLocation()` / `mergeQuery()` — pass it to
  **both** or the URL written will contradict where a bare link lands — and the rail's
  initial collapse. The store is `src/inspector/preferences.ts` (pure, tested), read
  reactively through `useInspectorPreferences()`. Add a preference only if it changes real
  behaviour, and never expose a value the server enforces (geofence tolerance, stage gate).
- Field custody has **two** stores and they are not interchangeable. Photographs live in
  IndexedDB (`src/inspector/evidenceQueue.ts`) because they are blobs; unsent checklist
  marks live in localStorage under the `inspector_checklist_` prefix
  (`src/inspector/checklistDraft.ts`), keyed on `(permitId, stageNumber)` because the
  stage_inspection record is created lazily at submit time — the very request that fails
  with no signal. Neither prefix may be folded into `inspector_case_`: Settings clears that
  one on the stated grounds that everything in it is already on the server, which is true of
  the case cache and false of held work. Both are surfaced in `InspectorOutbox`, whose badge
  counts photographs **and** checklists. A checklist is only ever sent from the stage
  console, which runs the completeness check and asks the server to compute the result.
- Sections are `<KeepAlive>`d, so `onMounted` fires once per session. Any section whose data
  is judged against the clock (queues, deadlines, agendas) must use
  `useStaleRefresh(refresh)` instead — it owns the first load and re-reads on `onActivated`
  and on `visibilitychange`, age-guarded. Reports is deliberately left manual: it is a
  200-permit pooled crawl, not live field data.
- Public reports (`ComplaintsSection`) is the only inspector surface for work that did not
  begin with an application. It needs backend migration **120** applied
  (`spatial_planning.building_complaint`) and `src/routes/building-complaints.js` registered.
  Anonymity is a schema constraint, not a form rule: an anonymous report cannot store a name
  or number, and the DTO re-checks on the way out.
- EHO console: `src/views/EnvironmentOfficerWorkspaceView.vue` renders eleven sections from
  `src/views/environment-officer/sections/` on the shared `ins-*` primitives
  (`views/inspector/inspector.css`). URL contract + preferences + date/risk helpers are pure in
  `src/environment-officer/console.ts`; move with `useEhoNav().go()` (push, clears section-scoped
  `premises/tab/permit/q`) and `setParam()` (replace). Field registers (premises, outbreaks,
  samples, complaints, inspections) are offline-first in `useHealthCase` — a held row with a
  server id is a failed EDIT and is retried as an update, never a create. Office records
  (notices, certificates, burial permits, clearances, programmes) are online-only via
  `src/services/environmentalHealthOps.ts` → backend `environmental-health-ops.js`
  (migration 122; SQL smoke test `test-eho-ops-sql.js`). Public Health Act notices are their own
  register, never `/enforcement-orders` (that route refuses `env_officer`). Section swaps use a
  mount-time CSS animation, not `<Transition mode="out-in">`.
- Planning Clerk console: `src/views/PlanningClerkPortalView.vue` renders seventeen
  sections from `src/views/planning-clerk/sections/` on the shared `ins-*` primitives
  (`views/inspector/inspector.css`). Nine of them are the clerk's statutory registers
  and they all go through ONE component, `components/planning-clerk/ClerkRegister.vue`
  (list + search + create + void + CSV); a section supplies only its columns and
  fields (`src/planning-clerk/registerSpec.ts`). URL contract + preferences +
  statutory arithmetic are pure and tested in `src/planning-clerk/console.ts`; move
  with `useClerkNav().go()` (pushes, clears section-scoped `q/kind/status/method/
  direction/from/to/view`) and `setParam()` (replaces). **`permit` is deliberately
  NOT section-scoped** — the counter loop is one file across several sections, so
  the open file follows the clerk and is shown in a standing bar. `?section=` is
  omitted against the clerk's **landing preference**, not the fallback — pass the
  same value to `readSection()` and `sectionQuery()`. Counters, deadlines and the
  open file are shared module state in `src/planning-clerk/useClerkOverview.ts`;
  call `invalidate()` after any write. Backend is `src/routes/planning-clerk.js`
  (migration **128**); smoke test `node test-planning-clerk.js` (51 checks).
- **The clerk's registers were in localStorage and now are not.** Correspondence,
  fee receipts, acknowledgements, dispatch, refusals, newspaper certificates and
  abutter notices all lived in one browser under `clerk_*_v1` keys — the council's
  proof of statutory notice, one cleared cache from gone, invisible to a second
  clerk. They are nine tables in `spatial_planning.clerk_*`. **There is no DELETE,
  here or on the server**: an entry is corrected with PATCH or struck through with
  `voided_at` + a mandatory reason. Do not add one. The CHECK constraints in 125
  are the real rules (a posted permit needs a tracking number, a file is in one
  place at a time, copies need a receipt) and `CONSTRAINT_MESSAGES` in the route
  turns each into a sentence a clerk can read — add the message with the constraint.
- Money in the clerk's registers is `amount` + `currency IN ('USD','ZWG')`, matching
  migration 064's convention for the council's books. Never sum across currencies on
  a screen, and never render a Postgres `count`/`sum` straight into a template — they
  arrive as strings, so `num()` from `services/planningClerk.ts` is mandatory.

- IT Admin console: `src/views/AdminWorkspaceView.vue` renders fifteen sections from
  `src/views/admin/sections/` on the shared `ins-*` primitives
  (`views/inspector/inspector.css`). One route, `/admin`, with the section AND its
  filters in the query (`src/admin/console.ts`, pure + tested): move with
  `useAdminNav().go()` (pushes, clears the section-scoped `q/severity/event/status/
  user/entity`) and `setParam()` (replaces, keeps them). `?section=` is omitted
  against the admin's **landing preference**, not the fallback — pass the same
  value to `readSection()` and `sectionQuery()` or a bare link lands somewhere the
  rail disagrees with. Counters are shared module state in
  `src/admin/useAdminOverview.ts`; call `invalidate()` after any write that changes
  a badge. Backend is `src/routes/admin-console.js` (migration **127**), every
  endpoint `requireAdmin`; smoke test `node test-admin-console.js` (64 checks).
  Full reference: **[docs/ADMIN.md](./docs/ADMIN.md)**.
- **The audit trail was empty for the whole life of the system** and is now real.
  `src/middleware/auditLog.js` wrote to `security_audit_log`, which migration 041
  can never create (a CHECK names a column that is not there, and its user_id is
  INTEGER against a uuid), AND the plugin was registered bare so Fastify
  encapsulated its hook to a scope with no routes. Both are fixed; it writes to
  `public.admin_audit_event`. `src/middleware/httpCache.js` still has the second
  problem — its headers and LRU are inert. Left alone deliberately: fixing it
  changes caching across the whole API.
- Admin settings (`public.admin_setting`) mark each key `enforced` (the server acts
  on it) or record-only, and the console shows which. **Add an enforced setting only
  with its call site in the same change** — `src/services/adminSettings.js` is the
  only reader. Sign-in lockout is per email address, counting failures since that
  address last succeeded, checked before the password so it cannot leak; lifting one
  records a synthetic success rather than deleting the evidence.
- **"Sent" in the outbox does not mean delivered.** `emailWorker.js` runs in-process
  (`MAIL_WORKER_INPROC=1`) on the `console` transport by default: it prints each
  message to the server log and *then* marks the row `sent`. `GET /admin/outbox`
  returns `meta.delivery` (`workerRunning`/`transport`/`delivers`) and the Email &
  jobs section says so in a banner — that count is otherwise read as proof an
  applicant was notified. Set `MAIL_TRANSPORT=smtp` + `SMTP_HOST` for real delivery.
- `RoleWorkspaceShell` slots are flex ROWS with `flex:1` on each child: pass **one** child
  per slot, or two siblings silently become two half-width columns. Its pane is optionally
  controlled (`v-model:pane`) — the inspector drives it from the URL, the EO and EHO
  workspaces stay uncontrolled.
- EO planner map (`src/views/EOPlannerView.vue`, the map pane of `EOPlannerWorkspace`) is a
  query surface, not a picture. It mounts the shared `components/map/MapToolbar.vue`
  (search / measure / notification radius / map sheet) with `:imagery="false"` — satellite
  is an Esri source and this platform runs on council infrastructure — and answers a plain
  map click with `GET /inspector/identify` in `InspectorIdentifyCard`; a click is ignored
  while a toolbar tool is armed (`@tool-change`). The same card's `map-feature` prop carries
  the basemap feature under that click — `map/featureAtPoint.ts` reads it off the rendered
  tile (same attribute allowlist as `GET /tiles/:layer/:id`, and it works on maps that add
  the basemap `interactive: false`, which dispatch no `feature-click`); the building
  inspector console feeds the same prop. Cases come from `/inspector/sites?scope=all`
  through `useInspectorSites`: features with a null geometry are dropped before they reach
  MapLibre, and the count that could not be placed is shown in the map key rather than left
  as blank district. Per-case checks are `InspectorSiteReport` inside the review modal.
  The notification radius is `map/tools/withinQuery.ts` → `GET /gis/within` (ST_DWithin over
  the cadastre); the old `queryRenderedFeatures` count survives only as an offline fallback
  and labels itself an estimate.
- API client: `src/services/api.ts` (axios, `baseURL: '/api'`), `src/services/vectorTiles.ts` (`getTileLayerCatalog()`, `getFeature(layer, fid)`, `tileUrlTemplate(layer)`).

### Backend (`../app-backend`)

- Entry: `server.js` (CommonJS) loads `.env`, registers Fastify routes under `/api`. Postgres via `@fastify/postgres` -> `fastify.pg`.
- Tile service: `src/routes/tiles.js` serves `GET /api/tiles/layers`, `GET /api/tiles/:layer/:z/:x/:y.pbf` (`ST_AsMVT` over the registry-allowlisted tables), and `GET /api/tiles/:layer/:id` (single feature as GeoJSON).
- Layer registry: `src/config/spatialLayers.js` — 24 layers from `zimbabwe.gpkg`, with per-layer `minzoom`, `attributes` allowlist, and `lowZoomFilter` for roads. SRID 900914 (= WGS 84 CRS84, equivalent to 4326, handled in SQL).
- Migration: `migrations/074_spatial_tile_indexes.sql` adds GiST indexes on every geom column + `roads.fclass`. Run with `node scripts/migrate-render.js` (or apply directly, the 074 file is idempotent).
- DB: `Vungu_spatial333` on local Postgres (or Render via `DATABASE_URL`). The 24 layers live alongside existing app data (`gweru_*`, `development_applications`).
- Smoke tests: `test-tiles-endpoint.js` (8 checks), `scripts/verify-spatial-tables.js` (table inventory).

## Local development

```bash
# Backend
cd ../app-backend
npm run dev                # node server.js, reads .env, listens on :3000

# Frontend
npm run dev                # vite, listens on :5174, proxies /api/* to :3000
```

Vite proxy in `vite.config.ts` forwards `/api/*` -> `http://localhost:3000`. CORS is also configured for direct browser -> backend calls when `VITE_API_BASE_URL` is set.

### Demo data

Every role has a seeded account (password `demo1234`, or `DEMO_DEFAULT_PASSWORD`)
and a populated portal. One application, **`TPD/VUN/2026/0900`**, runs the whole
workflow — lodgement, notice, consultation, an objection, committee, permit,
stage inspections — so a single case can be followed across portals.

```bash
cd ../app-backend
node scripts/seed-all-demo.js          # seed or re-seed; safe to repeat
node scripts/seed-all-demo.js --undo   # remove every seeded row
```

Seeded rows are tracked in `public.seed_demo_ledger`, so `--undo` removes
exactly what was added and leaves the council's real records alone. Order in
the runner matters: the planner seed creates the committee meetings the golden
thread attaches its agenda item to.

Writing a new seed: use `scripts/lib/seedkit.js` (`ensure` / `remember` /
`forget`), and read real columns with `node scripts/db-describe.js <table>`
rather than guessing — several enum values are not what they look like.

### Database

Local is **`Vungu_spatial334`** (rebuilt 2026-09-21 — see
`../app-backend/docs/db-rebuild-2026-09-21.md`). The schema is **not**
reproducible from `scripts/migrate-render.js`: its allowlist holds 54 of the 78
migration files and five numbers collide. Apply migration files individually,
never the full runner, and add any new file to the allowlist too.

## Specs and plans

Design + implementation specs for completed features live under:

- `docs/superpowers/specs/` — design specs (the why and what)
- `docs/superpowers/plans/` — implementation plans (the how, task-by-task)

Most recent: `2026-05-20-postgis-vector-tile-maps-design.md` + `2026-05-20-postgis-vector-tile-maps.md`.
