# Vungu Planning Portal — Map, Layer & QGIS Server Architecture

How the maps work end to end: where every layer comes from, how the statutory
master-plan symbology is applied, and how QGIS Server is wired in — including
what happens when it is offline.

---

## 1. The big picture

There are **two independent layer pipelines** feeding the same MapLibre maps:

```
PIPELINE A — PostGIS vector-tile basemap (always on)
┌──────────┐   ST_AsMVT    ┌─────────────────┐   .pbf tiles   ┌────────────────┐
│ PostGIS  │ ────────────► │ Fastify backend │ ─────────────► │ MapLibre GL    │
│ 24 layers│               │ /api/tiles/...  │                │ vunguBasemap   │
└──────────┘               └─────────────────┘                └────────────────┘
                                                    styling: masterplanSymbology.ts

PIPELINE B — QGIS Server project layers (on demand, per layer)
┌──────────┐   WMS/WFS     ┌─────────────────┐   raster tiles ┌────────────────┐
│ QGIS     │ ────────────► │ Fastify backend │   or GeoJSON   │ MapLibre GL    │
│ Server   │               │ /api/ogc/...    │ ─────────────► │ QGIS overlay   │
│ :8080    │  (proxied)    │ (OGC bridge)    │                │ layers         │
└──────────┘               └─────────────────┘                └────────────────┘
     │ offline?                    │
     └──── falls back to ──────────┤
           1. QGIS project file (.qgs) for the layer catalog
           2. PostGIS directly for the features (WFS fallback)
```

Both pipelines are **fully config-driven**. The frontend holds no server
addresses, no credentials, and no per-layer hardcoded colours. Configuration
lives in the backend `.env`:

| Variable | Purpose | Example |
|---|---|---|
| `QGIS_SERVER_URL` | Where QGIS Server listens | `http://localhost:8080` |
| `QGIS_PROJECT` | Project path as QGIS Server sees it | `/vungu-project.qgs` |
| `QGIS_PROJECT_LOCAL` | (optional) local `.qgs` override for the fallback | — |
| `DATABASE_URL` | Postgres/PostGIS connection | `postgres://…` |
| `OGC_TIMEOUT`, `OGC_MAX_RETRIES` | Bridge behaviour | `5000`, `1` |

---

## 2. The statutory master-plan symbology (single source of truth)

**File: `src/map/masterplanSymbology.ts`**

Every cartographic colour on every planning map comes from this one module.
It encodes the Zimbabwe town-planning map-notation schedule in three levels:

1. **Named colours** — the schedule's colour names mapped to hex exactly once:
   `MASTERPLAN_COLORS['Yellow 2'] → '#f1dd7c'`, `'Red Brown 1' → '#9e4a2a'`,
   `'Blue 2' → '#1f5fa8'`, and so on (36 named colours). Look one up with
   `mpColor('Green 1')`.

2. **Feature-class mappings** — which named colour each map feature takes:

   | Feature | Statutory rule | Export |
   |---|---|---|
   | National roads | Black | `OSM_FCLASS_ROAD_COLORS` (motorway/trunk) |
   | Primary distributors | Dark Brown | 〃 (primary) |
   | District distributors | Red Brown 1 | 〃 (secondary) |
   | Local distributors | Brown 2.2 | 〃 (tertiary) |
   | Access roads | Red Brown 1.2 | 〃 (residential/service/…) |
   | Proposed new streets | Red 1 | `MASTERPLAN_ROADS` (`proposed`) |
   | Scheme-area boundary | Blue 2 inner edge | `SCHEME_BOUNDARY_COLOR` |
   | Local-authority boundary | Black dot-and-dash | `LOCAL_AUTHORITY_BOUNDARY_COLOR` + `DOT_DASH` |
   | Building lines | Narrow black dot-and-dash | `DOT_DASH` |
   | Dwelling houses | Yellow 2 | `OSM_LANDUSE_COLORS.residential` |
   | Shops | Blue 1 | 〃 `.retail` |
   | Offices | Blue-Grey 1.2 | 〃 `.commercial` |
   | Industry | Red-Purple 1 / 1.2 | 〃 `.industrial` |
   | Public open space | Green 1 | 〃 `.park` |
   | Woodlands / national parks | Green 2.2 | 〃 `.forest` / `.nature_reserve` |
   | Cultivated farm land | Yellow-Brown 3 | 〃 `.farmland` |
   | Pasture | Yellow-Green 1.2 | 〃 `.meadow` |
   | Cemeteries | Grey 1.2 edged Grey 1 | 〃 `.cemetery` |
   | Restricted land | Orange 1 | (constraints layer) |
   | Railways | Blue 2.2 | basemap `railways` palette |
   | Unused land | Uncoloured | `UNUSED_LAND` (paper base) |

3. **Zoning + reference tables** — `MASTERPLAN_ZONES` (Zones 1A–11 with
   designation, colour, and hatching notes), `MASTERPLAN_PROPOSED_ZONE_COLORS`
   (the 11 Vungu peri-urban zone categories on the statutory scale),
   `MASTERPLAN_SETTLEMENT_COLORS` (land-tenure / Zone-11 rural scale),
   `LOT_USE_COLORS` (Planning Studio lot uses — public buildings all take
   Red 2.2 per the schedule, with `FACILITY_LETTERS` giving the black letter
   designations: P.S., C., W., L.A.).

### Who consumes it

```
masterplanSymbology.ts
 ├── vunguBasemapStyle.ts     → paints all 24 PostGIS basemap layers
 ├── planning-layers.ts       → paints the subdivision-planning overlay
 ├── PlanningStudio.vue       → CAD hatch presets (land-use fills)
 ├── MapLegend.vue            → the legend (via the two above)
 └── VunguPlannerView.vue     → degraded-mode QGIS overlay styling
```

Because the legend and the layer-filter chips read the *same* records the
paint expressions are built from, the key can never disagree with the map.

---

## 3. Pipeline A — the PostGIS basemap (how the 24 layers work)

1. **Registry** — `../app-backend/src/config/spatialLayers.js` lists
   24 tables (provinces, districts, wards, roads, buildings, landuse, water,
   POIs, the Vungu master-plan overlays…) with per-layer `minzoom`, an
   `attributes` allowlist, and a `lowZoomFilter` for roads.

2. **Tile service** — `GET /api/tiles/layers` returns the catalog;
   `GET /api/tiles/:layer/:z/:x/:y.pbf` renders Mapbox Vector Tiles with
   `ST_AsMVT` straight from PostGIS (GiST-indexed, migration 074).

3. **Frontend catalog** — `src/services/vectorTiles.ts#getTileLayerCatalog()`
   fetches the catalog once per session (module-level promise cache).

4. **Map assembly** — `src/map/vunguBasemap.ts#addVunguBasemap(map)` adds one
   MapLibre source + style layer per catalog entry, ordered
   land → landuse → water → roads (casing, then fill) → buildings → boundaries
   → labels, plus the admin drill-down click behaviour.

5. **Styling** — `src/map/vunguBasemapStyle.ts#styleLayerFor(layer)` builds
   the paint objects. Since this change it derives everything from
   `masterplanSymbology.ts`:
   - Roads: an `fclass`-matched colour expression using the statutory
     hierarchy (OSM `motorway/trunk → National (Black)`,
     `primary → Primary Distributor (Dark Brown)`,
     `secondary → District Distributor (Red Brown 1)`,
     `tertiary → Local Distributor (Brown 2.2)`, everything local →
     `Access (Red Brown 1.2)`), width-scaled ~1.4× per zoom level. The
     casing layer is a uniform white "paper halo" — statutory roads are
     solid inked lines, not OSM-style cased roads.
   - Landuse: an `fclass`-matched fill on the statutory land-use table.
   - Districts: black dot-and-dash — the statutory local-authority boundary.
   - Zoning overlays (`vungu_proposed_peri_urban_zones`,
     `vungu_beyond_peri_urban_zones`): categorical fills matched on the
     `zone` / `settlement` attribute against the statutory palettes.
   - `chipColorFor(id, geomType)` gives the filter-chip/legend swatch from the
     same records, so UI swatches always match map paint.

Every map that calls `addVunguBasemap()` — the planner window
(`VunguPlannerView`), the Interactive Map (`InteractiveMap.vue`, used by the
home preview and `/explorer`), and the officer views — gets the statutory
cartography automatically.

---

## 4. Pipeline B — QGIS Server (the process, step by step)

### 4.1 Backend: the OGC bridge

**Routes: `../app-backend/src/routes/ogcServices.js`** (registered
under `/api`), backed by `RefinedOGCBridge`
(`src/services/admin/refinedOGCBridge.js`).

| Endpoint | What it does |
|---|---|
| `GET /api/ogc/health` | Pings QGIS Server (WMS/WFS/WMTS/OGC-API). Returns `{ status: 'healthy' \| 'degraded', services: {…} }`. |
| `GET /api/ogc/layers` | Lists layers. From QGIS Server when up; otherwise parsed **directly out of the local `.qgs` project file** (`qgis-projects/vungu-project.qgs`). Returns `{ project, layers: [{ name, title, geometry, provider }], count }`. |
| `GET /api/ogc/wms/map/:layer?bbox=…&width=…&height=…` | Proxies WMS `GetMap` — QGIS Server renders the layer **with the symbology defined in the .qgs project**. Requires a valid 4-number bbox (400 otherwise). Returns 503 when QGIS Server is offline (no fake placeholder tiles). |
| `GET /api/ogc/wfs/features/:layer` | WFS `GetFeature` as GeoJSON/TopoJSON. If QGIS Server is down it queries **PostGIS directly** (columns discovered from `information_schema`, geometry via `ST_AsGeoJSON`, bbox filter validated, CQL filters parameterised). Layer names are validated as SQL identifiers (400 on anything else). |
| `GET /api/ogc/wms/legend/:layer?raw=true` | Legend graphic (PNG) from QGIS Server. |
| `GET /api/ogc/styled-layer/:layer` | Features + extracted QGIS styling + a MapLibre style in one payload. |
| `GET /api/ogc/watcher/status` | The file watcher: editing/saving `vungu-project.qgs` (e.g. from QGIS Desktop) auto-clears the style cache so the web map picks up new symbology without a restart. |

Security/production notes: no credentials in code (env only, `DATABASE_URL`
preferred), CQL filters are bound parameters, table names are
identifier-validated, bboxes are validated as finite numbers.

### 4.2 Frontend: the client

**File: `src/services/ogc.ts`**

- `ogcService.health()` / `ogcService.getAvailableLayers()` — status + catalog.
- `ogcService.getWFSFeatures({ typeName, maxFeatures })` — features, with all
  the response envelopes handled (GeoJSON, TopoJSON, wrapped).
- `wmsTileUrlTemplate(layerName)` — a MapLibre raster-tile template pointing
  at the backend proxy:
  `/api/ogc/wms/map/<layer>?bbox={bbox-epsg-3857}&width=256&height=256&crs=EPSG:3857&transparent=true`.
  MapLibre substitutes `{bbox-epsg-3857}` per tile (the token must stay
  unencoded, which is why this helper exists).

The frontend never sees `QGIS_SERVER_URL`. It only ever talks to `/api/ogc/*`.

### 4.3 The planner window flow (what happens when you use it)

**File: `src/views/planner/VunguPlannerView.vue`** — "QGIS Server" section in
the left rail.

1. **Auto-connect** — when the map finishes loading, `connectQgis(true)` runs
   quietly: it calls `/api/ogc/health` and `/api/ogc/layers`. The status dot
   shows the result:
   - 🟢 **Connected** — QGIS Server reachable, WMS rendering available.
   - 🟠 **Degraded — project-file fallback** — QGIS Server down; the layer
     list still populates from `vungu-project.qgs`.
   - 🔴 **Unreachable** — the backend OGC bridge itself is down.
   The *Connect/Refresh* button re-runs the same discovery on demand.

2. **Toggling a layer on** (`toggleQgisLayer`):
   - **Healthy** → a MapLibre **raster source** is added using
     `wmsTileUrlTemplate(name)`. Every pan/zoom requests 256×256 WMS tiles;
     QGIS Server renders them **with the .qgs project symbology** (whatever
     you styled in QGIS Desktop is exactly what appears).
   - **Degraded** → the features are fetched over
     `ogcService.getWFSFeatures()` (served from PostGIS by the backend
     fallback) and added as a **GeoJSON source**, styled client-side on the
     statutory palette by geometry type (polygons Blue-Grey 1.2 fill,
     lines Blue 2, points Red 2). Same data, vector rendering instead of
     raster — the demo works with or without QGIS Server running.
   - Either way the overlay is inserted **beneath the planning overlay**
     (`pl-area-fill`) so drafted roads/lots/boundaries stay on top.

3. **Toggling off** removes the layer(s) and source cleanly.

### 4.4 Updating symbology from QGIS Desktop

Edit styles in QGIS Desktop → save `qgis-projects/vungu-project.qgs` → the
backend file watcher clears the style/capabilities cache → next request
re-reads the project. With QGIS Server running, new WMS tiles render with the
new symbology immediately; council QML sidecars in `qgis-projects/styles/`
take precedence in the style extractor.

---

## 5. The planner's own drawing layers (subdivision + studio)

**File: `src/planning/planning-layers.ts`** — the `pl-*` overlay the planner
draws into (kept in sync with `usePlanningTools()` GeoJSON):

| Layer | Statutory treatment |
|---|---|
| `pl-area-line` | Scheme-area boundary — **Blue 2**, solid 3 px |
| `pl-road-line` | Proposed new streets — **Red 1**, width scaled from `widthM` |
| `pl-openspace-fill` | Public open space — **Green 1** |
| `pl-lot-fill` | Lots — **Yellow 2** (corner lots a deeper tint); "colour by use" swaps in `LOT_USE_COLORS` (school/clinic/worship/community → Red 2.2 public buildings, shops → Blue 1, recreation → Yellow-Green 1 private open space…) |
| `pl-envelope-line` | Building lines — narrow **black dot-and-dash** |
| `pl-constraint-fill` | Restricted/excluded ground — **Orange 1** |

Editing states stay functional (selection amber, envelope-failure purple) —
those are UI feedback, not cartography.

**Planning Studio** (`PlanningStudio.vue`) hatch presets use the same module:
Residential = Yellow 2 solid, Commercial = Blue 1 cross, Industrial =
Red-Purple 1 cross, Open space = Green 1 dots, Agriculture = Yellow-Brown 3
lines.

**Legend** (`MapLegend.vue`) shows the statutory road hierarchy, the
peri-urban zone scale, and land tenure — all read from the same modules, so it
is always in sync with the paint.

---

## 6. Running it

```bash
# 1. Backend (Fastify, :3000)
cd ../app-backend
node server.js                    # or: npm run dev

# 2. Frontend (Vite, :5174 — proxies /api → :3000)
npm run dev

# 3. (optional, for green-dot WMS rendering) QGIS Server on :8080
docker run -d -p 8080:80 \
  -v "$(pwd)/../app-backend/qgis-projects:/etc/qgisserver" \
  camptocamp/qgis-server
```

Without step 3 the system runs in degraded mode: layer catalog from the
project file, features from PostGIS, vector styling from the statutory
palette. Nothing breaks; the panel dot just shows amber.

### Smoke checks

```bash
curl http://localhost:3000/api/tiles/layers            # 24-layer catalog
curl http://localhost:3000/api/ogc/health              # healthy | degraded
curl http://localhost:3000/api/ogc/layers              # QGIS project layers
curl "http://localhost:3000/api/ogc/wfs/features/proposed_peri_urban_zones?maxFeatures=3"
```

Frontend: `npm run type-check` (vue-tsc) and
`npx vitest run --no-file-parallelism` (basemap-style, studio-foundation and
planner-shell specs cover the symbology contracts — e.g. every `LotUseType`
must have a colour).

---

## 7. Failure modes at a glance

| Situation | What the user sees |
|---|---|
| QGIS Server up | Green dot; toggled layers are WMS rasters with .qgs symbology |
| QGIS Server down, backend up | Amber dot; catalog from `.qgs` file; toggled layers are PostGIS-fed vectors in statutory colours |
| Backend down | Red dot; basemap tiles also unavailable (Vite proxy 500s) — start `node server.js` |
| Bad WMS request (no/garbled bbox) | 400 from the proxy (never a silently wrong extent) |
| Unknown/malformed layer name | 400 (identifier validation) — no SQL ever sees it |

---

## 8. Production: how planners' QGIS Desktop connects

Four paths, all built, all sharing **one PostGIS database**:

1. **Direct PostGIS connection (primary).** Every layer in
   `vungu-project.qgs` is a `provider: postgres` layer — the same tables the
   web app tiles. In production QGIS Server, the backend, and planners'
   QGIS Desktop all point at the same managed Postgres (`DATABASE_URL`).
   A planner adds a PostGIS connection in Desktop and edits the live tables;
   a parcel digitised there appears in the web map on the next tile request.
   No sync step — Desktop and portal are two clients of one database.
   Give planners a scoped DB role (write on their layers only).

2. **The Vungu QGIS plugin (bidirectional sync API).** Backend routes,
   authenticated with a Bearer **API token** (not browser cookies):
   - `POST /api/qgis/sync/upload` — push a layer from Desktop to the portal
   - `GET  /api/qgis/sync/download/:layerName` — pull a portal layer into Desktop
   - `GET/POST /api/qgis-plugin/style-sync/*` — style sync status / force
   - `GET  /api/qgis-plugin/download/plugin` — planners download the plugin
     from the portal itself
   Install guide: `public/QGIS_PLUGIN_INSTALLATION_GUIDE.md`. The planner
   enters the portal URL + token and gets a push/pull dock widget without
   ever holding DB credentials.

3. **Symbology publishing (Desktop → web).** The council project
   `vungu-project.qgs` lives on a volume shared between the backend and
   QGIS Server containers. The planner styles layers in Desktop and saves;
   the backend's project watcher clears the style caches and QGIS Server
   renders subsequent WMS tiles with the new symbology — what the planner
   styles is exactly what the web map shows. Per-layer QML sidecars in
   `qgis-projects/styles/` take precedence for council symbology.

4. **Consuming the portal from Desktop (read-only).** Any QGIS Desktop can
   add the portal as a standard OGC source — WMS/WFS at
   `https://<portal-domain>/api/ogc/…` — for staff who should see the data
   but never write to the database.

**Production topology:** backend and QGIS Server run as sibling containers on
a private network. `QGIS_SERVER_URL` points at the internal service name and
is never exposed publicly — browsers and Desktop clients only ever reach
QGIS Server through the `/api/ogc` proxy. Both containers mount
`qgis-projects/` and share `DATABASE_URL`. The frontend is identical in dev
and production.
