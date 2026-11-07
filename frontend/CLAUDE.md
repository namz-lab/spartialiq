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
- API client: `src/services/api.ts` (axios, `baseURL: '/api'`), `src/services/vectorTiles.ts` (`getTileLayerCatalog()`, `getFeature(layer, fid)`, `tileUrlTemplate(layer)`).

### Backend (`../app-backend`)

- Entry: `server.js` (CommonJS) loads `.env`, registers Fastify routes under `/api`. Postgres via `@fastify/postgres` -> `fastify.pg`.
- Tile service: `src/routes/tiles.js` serves `GET /api/tiles/layers`, `GET /api/tiles/:layer/:z/:x/:y.pbf` (`ST_AsMVT` over the registry-allowlisted tables), and `GET /api/tiles/:layer/:id` (single feature as GeoJSON).
- Layer registry: `src/config/spatialLayers.js` — 24 layers from `zimbabwe.gpkg`, with per-layer `minzoom`, `attributes` allowlist, and `lowZoomFilter` for roads. SRID 900914 (= WGS 84 CRS84, equivalent to 4326, handled in SQL).
- Migration: `migrations/074_spatial_tile_indexes.sql` adds GiST indexes on every geom column + `roads.fclass`. Run with `node scripts/migrate.js` (or apply directly, the 074 file is idempotent).
- DB: `Vungu_spatial333` on local Postgres (or the production server via `DATABASE_URL`). The 24 layers live alongside existing app data (`gweru_*`, `development_applications`).
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

## Specs and plans

Design + implementation specs for completed features live under:

- `docs/superpowers/specs/` — design specs (the why and what)
- `docs/superpowers/plans/` — implementation plans (the how, task-by-task)

Most recent: `2026-05-20-postgis-vector-tile-maps-design.md` + `2026-05-20-postgis-vector-tile-maps.md`.
