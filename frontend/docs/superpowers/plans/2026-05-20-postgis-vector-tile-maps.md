# PostGIS Vector Tile Maps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve the country-wide `zimbabwe.gpkg` spatial dataset from PostGIS as Mapbox Vector Tiles, and make every map in the app render it.

**Architecture:** A Fastify route on the backend (`server.js`) generates MVT tiles on demand with PostGIS `ST_AsMVT`, driven by a layer registry that allowlists tables and sets zoom tiers. The frontend gets one shared `addVunguBasemap(map)` module that every MapLibre map calls to add the tile layers. The existing QGIS Server bridge stays untouched.

**Tech Stack:** Fastify 5 + `@fastify/postgres` + PostGIS (`ST_AsMVT`), Vue 3 + Pinia + MapLibre GL 4, Vitest (frontend), Jest (backend pure-function tests).

---

## Context for the implementer

- **Two backend entry points exist.** `src/index.ts` is a secondary admin app; **`server.js` (CommonJS, repo root) is the app that actually runs** (`npm run dev` → `node server.js`). All backend wiring in this plan targets `server.js`. New backend modules are plain CommonJS `.js` files to match its `require(...)` pattern.
- The Postgres pool is exposed as `fastify.pg` (registered via `@fastify/postgres` in `server.js` ~line 167). Dev default DB: `postgresql://postgres:***REDACTED***@localhost:5432/vungu_master_db_v1`, overridable by `DATABASE_URL`.
- Routes are registered with `server.register(routeFn, { prefix: '/api' })`. A route module exports a named function taking `(fastify, opts)`.
- Backend migrations are SQL files in `app-backend/migrations/`, run by `scripts/migrate.js`, which has a **hardcoded `MIGRATIONS` array** — new migrations must be added to it. The runner needs `DATABASE_URL`.
- The GeoPackage `zimbabwe.gpkg` uses the standard OSM/Geofabrik schema. Layers and their columns (confirmed by inspecting the file):
  - `country`, `provinces`, `districts`, `wards`: `fid, geom, pcode, name_en, parent_pcode, level`
  - `roads`: `fid, geom, osm_id, code, fclass, name, ref, oneway, maxspeed, layer, bridge, tunnel`
  - `railways`: `fid, geom, osm_id, code, fclass, name, layer, bridge, tunnel`
  - `waterways`: `fid, geom, osm_id, code, fclass, width, name`
  - `buildings`: `fid, geom, osm_id, code, fclass, name, type`
  - `landuse`, `water_areas`, `natural_areas`: `fid, geom, osm_id, code, fclass, name`
  - `protected_areas`: `fid, geom, osm_id, code, fclass`
  - `places_points`: `fid, geom, osm_id, code, fclass, population, name`
  - `pois_points`, `transport_points`, `traffic_points`, `natural_points`, `places_of_worship_points`: `fid, geom, osm_id, code, fclass, name`
- **`fid` is the primary key** of every imported table.
- Frontend: `@/` aliases `src/`. The axios instance `src/services/api.ts` (default export, also re-exported by `src/utils/axios.ts`) has `baseURL = '/api'`. MapLibre version 4.7. Frontend tests are Vitest `.spec.ts` files.

---

## File structure

**Backend (`app-backend/`):**
- Create `src/config/spatialLayers.js` — the layer registry (single source of truth) + lookup helpers.
- Create `src/lib/tileQuery.js` — pure functions: tile-coordinate validation and MVT SQL builder.
- Create `src/lib/tileQuery.test.js` — Jest unit tests for `tileQuery.js`.
- Create `src/lib/tileCache.js` — small bounded in-process tile cache.
- Create `src/lib/tileCache.test.js` — Jest unit tests for `tileCache.js`.
- Create `src/routes/tiles.js` — the `/api/tiles` Fastify route plugin.
- Create `migrations/074_spatial_tile_indexes.sql` — spatial + attribute indexes.
- Create `scripts/verify-spatial-tables.js` — DB introspection script (Task 1).
- Create `test-tiles-endpoint.js` (repo root) — manual integration check, matching the existing `test-*.js` pattern.
- Modify `server.js` — require + register the tiles route.
- Modify `scripts/migrate.js` — add `074` to the `MIGRATIONS` array.

**Frontend (`app-frontend/`):**
- Create `src/services/vectorTiles.ts` — tile API client.
- Create `src/services/__tests__/vectorTiles.spec.ts` — Vitest tests.
- Create `src/map/vunguBasemapStyle.ts` — MapLibre paint/layout fragments per geometry type.
- Create `src/map/__tests__/vunguBasemapStyle.spec.ts` — Vitest tests.
- Create `src/map/vunguBasemap.ts` — `addVunguBasemap(map, options?)`.
- Create `src/map/__tests__/vunguBasemap.spec.ts` — Vitest tests.
- Modify `src/stores/spatial.ts` — add `loadTileLayers()` / `toggleTileLayer()`.
- Modify map views: `GISMapView.vue`, `VunguMapView.vue`, `QGISMapView.vue`, `MapExplorer.vue`, `InteractiveMap.vue`, `SpatialMapCore.vue`, `ParcelSelectorMap.vue`, `citizen/sections/MapSection.vue`, and the four `gis-officer/sections/*` map sections.

---

## Task 1: Verify imported PostGIS tables

**Files:**
- Create: `app-backend/scripts/verify-spatial-tables.js`

- [ ] **Step 1: Write the verification script**

```js
// scripts/verify-spatial-tables.js
// Confirms the zimbabwe.gpkg layers exist in PostGIS and prints their
// table name, geometry column, SRID and row count. Run before building
// the layer registry so the registry reflects what is actually there.
const { Pool } = require('pg')

const EXPECTED = [
  'country', 'provinces', 'districts', 'wards',
  'roads', 'railways', 'waterways',
  'buildings', 'landuse', 'water_areas', 'protected_areas', 'natural_areas',
  'admin_areas', 'places_areas', 'traffic_areas', 'transport_areas',
  'pois_areas', 'places_of_worship_areas',
  'places_points', 'pois_points', 'traffic_points', 'transport_points',
  'natural_points', 'places_of_worship_points',
]

async function main() {
  const connectionString =
    process.env.DATABASE_URL ||
    'postgresql://postgres:***REDACTED***@localhost:5432/vungu_master_db_v1'
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('render.com')
      ? { rejectUnauthorized: false }
      : undefined,
  })
  try {
    const { rows } = await pool.query(
      `SELECT f_table_name AS table, f_geometry_column AS geom_col, srid, type
       FROM geometry_columns
       WHERE f_table_schema = 'public'
       ORDER BY f_table_name`
    )
    const found = new Map(rows.map((r) => [r.table, r]))
    console.log('=== geometry_columns (public schema) ===')
    for (const r of rows) {
      console.log(`  ${r.table.padEnd(26)} geom=${r.geom_col} srid=${r.srid} type=${r.type}`)
    }
    console.log('\n=== expected zimbabwe.gpkg layers ===')
    const missing = []
    for (const name of EXPECTED) {
      const hit = found.get(name)
      if (!hit) { missing.push(name); console.log(`  MISSING  ${name}`); continue }
      const { rows: cnt } = await pool.query(`SELECT count(*)::int AS n FROM "${name}"`)
      console.log(`  OK       ${name.padEnd(26)} rows=${cnt[0].n} srid=${hit.srid} geom=${hit.geom_col}`)
    }
    if (missing.length) {
      console.log(`\n${missing.length} layer(s) missing: ${missing.join(', ')}`)
      console.log('If these are absent, the GeoPackage import is incomplete — import them with ogr2ogr before continuing.')
      process.exitCode = 1
    } else {
      console.log('\nAll expected layers present.')
    }
  } finally {
    await pool.end()
  }
}

main().catch((err) => { console.error(err); process.exit(1) })
```

- [ ] **Step 2: Run the verification script**

Run (from `app-backend/`): `node scripts/verify-spatial-tables.js`
Expected: a list of geometry tables. **Record the actual table names, geometry column name (`geom` vs `wkb_geometry`), and SRID** — Task 2's registry must match them.

If layers are reported MISSING, stop and import them first:
`ogr2ogr -f PostgreSQL "PG:dbname=vungu_master_db_v1 user=postgres password=***REDACTED***" "C:/Users/theop/OneDrive/Desktop/dataset/zimbabwe.gpkg" -nlt PROMOTE_TO_MULTI -lco GEOMETRY_NAME=geom -lco FID=fid`

- [ ] **Step 3: Commit**

```bash
git add scripts/verify-spatial-tables.js
git commit -m "chore: add spatial table verification script"
```

---

## Task 2: Layer registry

**Files:**
- Create: `app-backend/src/config/spatialLayers.js`

The registry below assumes Task 1 confirmed table names as-is, geometry column `geom`, SRID 4326. **If Task 1 reported a different geometry column or SRID, change `GEOM_COLUMN` / `GEOM_SRID` below; if a table name differs, change that entry's `table`.**

- [ ] **Step 1: Write the registry**

```js
// src/config/spatialLayers.js
// Single source of truth for the PostGIS layers served as vector tiles.
// `id` is also the MVT source-layer name used by the frontend.

const GEOM_COLUMN = 'geom'   // change if Task 1 reported a different column
const GEOM_SRID = 4326       // change if Task 1 reported a different SRID

/**
 * @typedef {Object} SpatialLayer
 * @property {string} id          unique id + MVT source-layer name
 * @property {string} table       PostGIS table name
 * @property {'polygon'|'line'|'point'} geomType
 * @property {'admin'|'landuse'|'hydro'|'transport'|'structures'|'poi'} group
 * @property {string} title       human label
 * @property {string[]} attributes columns exposed inside each tile
 * @property {number} minzoom
 * @property {number} maxzoom
 * @property {{maxZoom:number, where:string}|null} lowZoomFilter
 */

/** @type {SpatialLayer[]} */
const LAYERS = [
  // --- admin boundaries (always available) ---
  { id: 'country',   table: 'country',   geomType: 'polygon', group: 'admin', title: 'Country',   attributes: ['fid', 'name_en', 'pcode', 'level'], minzoom: 0,  maxzoom: 22, lowZoomFilter: null },
  { id: 'provinces', table: 'provinces', geomType: 'polygon', group: 'admin', title: 'Provinces', attributes: ['fid', 'name_en', 'pcode', 'level'], minzoom: 0,  maxzoom: 22, lowZoomFilter: null },
  { id: 'districts', table: 'districts', geomType: 'polygon', group: 'admin', title: 'Districts', attributes: ['fid', 'name_en', 'pcode', 'level'], minzoom: 5,  maxzoom: 22, lowZoomFilter: null },
  { id: 'wards',     table: 'wards',     geomType: 'polygon', group: 'admin', title: 'Wards',     attributes: ['fid', 'name_en', 'pcode', 'level'], minzoom: 8,  maxzoom: 22, lowZoomFilter: null },

  // --- landuse ---
  { id: 'landuse',      table: 'landuse',      geomType: 'polygon', group: 'landuse', title: 'Land Use',     attributes: ['fid', 'name', 'fclass'], minzoom: 8,  maxzoom: 22, lowZoomFilter: null },
  { id: 'admin_areas',  table: 'admin_areas',  geomType: 'polygon', group: 'landuse', title: 'Admin Areas',  attributes: ['fid', 'name', 'fclass'], minzoom: 8,  maxzoom: 22, lowZoomFilter: null },
  { id: 'places_areas', table: 'places_areas', geomType: 'polygon', group: 'landuse', title: 'Place Areas',  attributes: ['fid', 'name', 'fclass'], minzoom: 10, maxzoom: 22, lowZoomFilter: null },

  // --- hydrology / nature ---
  { id: 'water_areas',     table: 'water_areas',     geomType: 'polygon', group: 'hydro', title: 'Water Bodies',    attributes: ['fid', 'name', 'fclass'], minzoom: 8,  maxzoom: 22, lowZoomFilter: null },
  { id: 'waterways',       table: 'waterways',       geomType: 'line',    group: 'hydro', title: 'Waterways',       attributes: ['fid', 'name', 'fclass'], minzoom: 8,  maxzoom: 22, lowZoomFilter: null },
  { id: 'protected_areas', table: 'protected_areas', geomType: 'polygon', group: 'hydro', title: 'Protected Areas', attributes: ['fid', 'fclass'],         minzoom: 6,  maxzoom: 22, lowZoomFilter: null },
  { id: 'natural_areas',   table: 'natural_areas',   geomType: 'polygon', group: 'hydro', title: 'Natural Areas',   attributes: ['fid', 'name', 'fclass'], minzoom: 8,  maxzoom: 22, lowZoomFilter: null },

  // --- transport ---
  { id: 'roads',    table: 'roads',    geomType: 'line', group: 'transport', title: 'Roads',    attributes: ['fid', 'name', 'fclass', 'ref', 'oneway'], minzoom: 8,  maxzoom: 22,
    lowZoomFilter: { maxZoom: 12, where: "fclass IN ('motorway','trunk','primary','secondary')" } },
  { id: 'railways', table: 'railways', geomType: 'line', group: 'transport', title: 'Railways', attributes: ['fid', 'name', 'fclass'], minzoom: 8, maxzoom: 22, lowZoomFilter: null },

  // --- structures (dense — high zoom only) ---
  { id: 'buildings',              table: 'buildings',              geomType: 'polygon', group: 'structures', title: 'Buildings',          attributes: ['fid', 'name', 'fclass', 'type'], minzoom: 14, maxzoom: 22, lowZoomFilter: null },
  { id: 'traffic_areas',          table: 'traffic_areas',          geomType: 'polygon', group: 'structures', title: 'Traffic Areas',      attributes: ['fid', 'name', 'fclass'],         minzoom: 13, maxzoom: 22, lowZoomFilter: null },
  { id: 'transport_areas',        table: 'transport_areas',        geomType: 'polygon', group: 'structures', title: 'Transport Areas',    attributes: ['fid', 'name', 'fclass'],         minzoom: 13, maxzoom: 22, lowZoomFilter: null },
  { id: 'pois_areas',             table: 'pois_areas',             geomType: 'polygon', group: 'structures', title: 'POI Areas',          attributes: ['fid', 'name', 'fclass'],         minzoom: 13, maxzoom: 22, lowZoomFilter: null },
  { id: 'places_of_worship_areas', table: 'places_of_worship_areas', geomType: 'polygon', group: 'structures', title: 'Worship Areas',    attributes: ['fid', 'name', 'fclass'],         minzoom: 13, maxzoom: 22, lowZoomFilter: null },

  // --- points of interest ---
  { id: 'places_points',            table: 'places_points',            geomType: 'point', group: 'poi', title: 'Places',           attributes: ['fid', 'name', 'fclass', 'population'], minzoom: 6,  maxzoom: 22, lowZoomFilter: null },
  { id: 'pois_points',              table: 'pois_points',              geomType: 'point', group: 'poi', title: 'Points of Interest', attributes: ['fid', 'name', 'fclass'],            minzoom: 13, maxzoom: 22, lowZoomFilter: null },
  { id: 'traffic_points',           table: 'traffic_points',           geomType: 'point', group: 'poi', title: 'Traffic Points',   attributes: ['fid', 'name', 'fclass'],              minzoom: 14, maxzoom: 22, lowZoomFilter: null },
  { id: 'transport_points',         table: 'transport_points',         geomType: 'point', group: 'poi', title: 'Transport Points', attributes: ['fid', 'name', 'fclass'],              minzoom: 13, maxzoom: 22, lowZoomFilter: null },
  { id: 'natural_points',           table: 'natural_points',           geomType: 'point', group: 'poi', title: 'Natural Points',   attributes: ['fid', 'name', 'fclass'],              minzoom: 13, maxzoom: 22, lowZoomFilter: null },
  { id: 'places_of_worship_points', table: 'places_of_worship_points', geomType: 'point', group: 'poi', title: 'Worship Points',   attributes: ['fid', 'name', 'fclass'],              minzoom: 13, maxzoom: 22, lowZoomFilter: null },
]

const BY_ID = new Map(LAYERS.map((l) => [l.id, l]))

/** @returns {SpatialLayer|undefined} */
function getLayer(id) {
  return BY_ID.get(id)
}

/** @returns {SpatialLayer[]} */
function allLayers() {
  return LAYERS
}

module.exports = { LAYERS, getLayer, allLayers, GEOM_COLUMN, GEOM_SRID }
```

- [ ] **Step 2: Sanity-check the registry loads**

Run (from `app-backend/`): `node -e "const r=require('./src/config/spatialLayers'); console.log(r.allLayers().length, 'layers;', r.getLayer('roads').table)"`
Expected: `24 layers; roads`

- [ ] **Step 3: Commit**

```bash
git add src/config/spatialLayers.js
git commit -m "feat: add PostGIS spatial layer registry"
```

---

## Task 3: Tile-coordinate validation (pure function + test)

**Files:**
- Create: `app-backend/src/lib/tileQuery.js`
- Test: `app-backend/src/lib/tileQuery.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/tileQuery.test.js
const { isValidTileCoord } = require('./tileQuery')

describe('isValidTileCoord', () => {
  test('accepts a valid tile coordinate', () => {
    expect(isValidTileCoord(10, 600, 580)).toBe(true)
  })
  test('accepts zoom 0 origin tile', () => {
    expect(isValidTileCoord(0, 0, 0)).toBe(true)
  })
  test('rejects negative zoom', () => {
    expect(isValidTileCoord(-1, 0, 0)).toBe(false)
  })
  test('rejects zoom above 22', () => {
    expect(isValidTileCoord(23, 0, 0)).toBe(false)
  })
  test('rejects x out of range for the zoom', () => {
    expect(isValidTileCoord(1, 2, 0)).toBe(false)
  })
  test('rejects non-integer coordinates', () => {
    expect(isValidTileCoord(10, 1.5, 2)).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `app-backend/`): `npx jest src/lib/tileQuery.test.js`
Expected: FAIL with "Cannot find module './tileQuery'"

- [ ] **Step 3: Write the implementation**

```js
// src/lib/tileQuery.js
// Pure helpers for building PostGIS vector-tile (MVT) queries.

/**
 * Validates a slippy-map tile coordinate.
 * @param {number} z @param {number} x @param {number} y
 * @returns {boolean}
 */
function isValidTileCoord(z, x, y) {
  if (![z, x, y].every((n) => Number.isInteger(n))) return false
  if (z < 0 || z > 22) return false
  const max = 2 ** z
  return x >= 0 && x < max && y >= 0 && y < max
}

module.exports = { isValidTileCoord }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/tileQuery.test.js`
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tileQuery.js src/lib/tileQuery.test.js
git commit -m "feat: add tile coordinate validation"
```

---

## Task 4: MVT SQL builder (pure function + test)

**Files:**
- Modify: `app-backend/src/lib/tileQuery.js`
- Modify: `app-backend/src/lib/tileQuery.test.js`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/tileQuery.test.js`:

```js
const { buildTileQuery } = require('./tileQuery')
const { getLayer } = require('../config/spatialLayers')

describe('buildTileQuery', () => {
  test('builds an MVT query with z/x/y/layer-name bound as params', () => {
    const { sql, params } = buildTileQuery(getLayer('provinces'), 6, 38, 36)
    expect(params).toEqual([6, 38, 36, 'provinces'])
    expect(sql).toMatch(/ST_AsMVT\(/)
    expect(sql).toMatch(/ST_AsMVTGeom/)
    expect(sql).toMatch(/FROM "provinces"/)
    expect(sql).toMatch(/"name_en"/)
  })
  test('omits the low-zoom filter when zoom is at or above maxZoom', () => {
    const { sql } = buildTileQuery(getLayer('roads'), 14, 9000, 9000)
    expect(sql).not.toMatch(/fclass IN/)
  })
  test('applies the low-zoom filter below maxZoom', () => {
    const { sql } = buildTileQuery(getLayer('roads'), 9, 300, 300)
    expect(sql).toMatch(/fclass IN \('motorway'/)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/tileQuery.test.js`
Expected: FAIL with "buildTileQuery is not a function"

- [ ] **Step 3: Write the implementation**

Replace the contents of `src/lib/tileQuery.js` with:

```js
// src/lib/tileQuery.js
// Pure helpers for building PostGIS vector-tile (MVT) queries.
const { GEOM_COLUMN } = require('../config/spatialLayers')

/**
 * Validates a slippy-map tile coordinate.
 * @param {number} z @param {number} x @param {number} y
 * @returns {boolean}
 */
function isValidTileCoord(z, x, y) {
  if (![z, x, y].every((n) => Number.isInteger(n))) return false
  if (z < 0 || z > 22) return false
  const max = 2 ** z
  return x >= 0 && x < max && y >= 0 && y < max
}

/**
 * Builds the parameterized SQL that returns one MVT tile for a layer.
 * The table, geometry column and attribute names come from the registry
 * (an allowlist), so they are safe to interpolate. z/x/y and the MVT
 * layer name are passed as bound parameters.
 *
 * @param {import('../config/spatialLayers').SpatialLayer} layer
 * @param {number} z @param {number} x @param {number} y
 * @returns {{ sql: string, params: any[] }}
 */
function buildTileQuery(layer, z, x, y) {
  const attrs = layer.attributes.map((a) => `"${a}"`).join(', ')
  let filter = ''
  if (layer.lowZoomFilter && z < layer.lowZoomFilter.maxZoom) {
    filter = ` AND (${layer.lowZoomFilter.where})`
  }
  const sql = `
    SELECT ST_AsMVT(t, $4) AS tile FROM (
      SELECT
        ST_AsMVTGeom(
          ST_Transform("${GEOM_COLUMN}", 3857),
          ST_TileEnvelope($1, $2, $3),
          4096, 64, true
        ) AS geom,
        ${attrs}
      FROM "${layer.table}"
      WHERE "${GEOM_COLUMN}" && ST_Transform(ST_TileEnvelope($1, $2, $3), 4326)${filter}
    ) AS t
    WHERE t.geom IS NOT NULL
  `
  return { sql, params: [z, x, y, layer.id] }
}

module.exports = { isValidTileCoord, buildTileQuery }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/tileQuery.test.js`
Expected: PASS (9 tests total)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tileQuery.js src/lib/tileQuery.test.js
git commit -m "feat: add MVT tile SQL builder"
```

---

## Task 5: In-process tile cache

**Files:**
- Create: `app-backend/src/lib/tileCache.js`
- Test: `app-backend/src/lib/tileCache.test.js`

- [ ] **Step 1: Write the failing test**

```js
// src/lib/tileCache.test.js
const { TileCache } = require('./tileCache')

describe('TileCache', () => {
  test('stores and returns a buffer', () => {
    const c = new TileCache(3)
    const buf = Buffer.from('abc')
    c.set('k1', buf)
    expect(c.get('k1')).toBe(buf)
  })
  test('returns undefined for a missing key', () => {
    expect(new TileCache(3).get('nope')).toBeUndefined()
  })
  test('evicts the oldest entry past capacity', () => {
    const c = new TileCache(2)
    c.set('a', Buffer.from('a'))
    c.set('b', Buffer.from('b'))
    c.set('c', Buffer.from('c'))
    expect(c.get('a')).toBeUndefined()
    expect(c.get('b')).toBeDefined()
    expect(c.get('c')).toBeDefined()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest src/lib/tileCache.test.js`
Expected: FAIL with "Cannot find module './tileCache'"

- [ ] **Step 3: Write the implementation**

```js
// src/lib/tileCache.js
// Bounded in-process cache for rendered MVT tiles. Insertion-order Map =
// simple FIFO eviction. This avoids a Redis dependency; the browser
// Cache-Control header carries most of the repeat-request load anyway.

class TileCache {
  /** @param {number} capacity max number of tiles to retain */
  constructor(capacity = 2000) {
    this.capacity = capacity
    /** @type {Map<string, Buffer>} */
    this.map = new Map()
  }

  /** @param {string} key @returns {Buffer|undefined} */
  get(key) {
    return this.map.get(key)
  }

  /** @param {string} key @param {Buffer} value */
  set(key, value) {
    if (this.map.has(key)) this.map.delete(key)
    this.map.set(key, value)
    if (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value
      this.map.delete(oldest)
    }
  }

  clear() {
    this.map.clear()
  }
}

module.exports = { TileCache }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest src/lib/tileCache.test.js`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/lib/tileCache.js src/lib/tileCache.test.js
git commit -m "feat: add in-process tile cache"
```

---

## Task 6: Spatial index migration

**Files:**
- Create: `app-backend/migrations/074_spatial_tile_indexes.sql`
- Modify: `app-backend/scripts/migrate.js`

- [ ] **Step 1: Write the migration**

```sql
-- 074_spatial_tile_indexes.sql
-- GiST indexes on every geometry column served as vector tiles, plus the
-- attribute index roads.fclass needs for the low-zoom road filter.
-- IF NOT EXISTS keeps this safe to re-run.

CREATE INDEX IF NOT EXISTS idx_country_geom              ON country              USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_provinces_geom            ON provinces            USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_districts_geom            ON districts            USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_wards_geom                ON wards                USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_landuse_geom              ON landuse              USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_admin_areas_geom          ON admin_areas          USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_places_areas_geom         ON places_areas         USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_water_areas_geom          ON water_areas          USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_waterways_geom            ON waterways            USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_protected_areas_geom      ON protected_areas      USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_natural_areas_geom        ON natural_areas        USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_roads_geom                ON roads                USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_railways_geom             ON railways             USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_buildings_geom            ON buildings            USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_traffic_areas_geom        ON traffic_areas        USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_transport_areas_geom      ON transport_areas      USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_pois_areas_geom           ON pois_areas           USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_pow_areas_geom            ON places_of_worship_areas USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_places_points_geom        ON places_points        USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_pois_points_geom          ON pois_points          USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_traffic_points_geom       ON traffic_points       USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_transport_points_geom     ON transport_points     USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_natural_points_geom       ON natural_points       USING GIST (geom);
CREATE INDEX IF NOT EXISTS idx_pow_points_geom           ON places_of_worship_points USING GIST (geom);

CREATE INDEX IF NOT EXISTS idx_roads_fclass              ON roads (fclass);
```

- [ ] **Step 2: Register the migration in the runner**

In `scripts/migrate.js`, add `'074_spatial_tile_indexes.sql'` as the last entry of the `MIGRATIONS` array:

```js
  '072_per_item_inspection_scoring.sql',
  '073_score_includes_na_as_zero.sql',
  '074_spatial_tile_indexes.sql',
]
```

- [ ] **Step 3: Run the migration**

Run (from `app-backend/`, with `DATABASE_URL` set): `npm run migrate`
Expected: output ending with `074_spatial_tile_indexes.sql` applied, no errors.

- [ ] **Step 4: Verify the indexes exist**

Run: `node -e "const {Pool}=require('pg');const p=new Pool({connectionString:process.env.DATABASE_URL});p.query(\"SELECT indexname FROM pg_indexes WHERE indexname LIKE 'idx_%_geom' ORDER BY 1\").then(r=>{console.log(r.rows.length,'geom indexes');return p.end()})"`
Expected: `24 geom indexes`

- [ ] **Step 5: Commit**

```bash
git add migrations/074_spatial_tile_indexes.sql scripts/migrate.js
git commit -m "feat: add spatial indexes for vector tile layers"
```

---

## Task 7: Tile route plugin

**Files:**
- Create: `app-backend/src/routes/tiles.js`

- [ ] **Step 1: Write the route plugin**

```js
// src/routes/tiles.js
// Vector tile service: serves zimbabwe.gpkg PostGIS layers as MVT.
const { allLayers, getLayer } = require('../config/spatialLayers')
const { isValidTileCoord, buildTileQuery } = require('../lib/tileQuery')
const { TileCache } = require('../lib/tileCache')

const cache = new TileCache(2000)

/**
 * Fastify plugin. Register with prefix '/api'; routes live under /api/tiles.
 * @param {import('fastify').FastifyInstance} fastify
 */
async function tilesRoutes(fastify) {
  // Layer catalog — drives frontend layer panels.
  fastify.get('/tiles/layers', async () => ({
    success: true,
    data: allLayers().map((l) => ({
      id: l.id,
      title: l.title,
      geomType: l.geomType,
      group: l.group,
      minzoom: l.minzoom,
      maxzoom: l.maxzoom,
    })),
  }))

  // One MVT tile.
  fastify.get('/tiles/:layer/:z/:x/:y.pbf', async (request, reply) => {
    const { layer: layerId } = request.params
    const z = Number(request.params.z)
    const x = Number(request.params.x)
    const y = Number(request.params.y)

    const layer = getLayer(layerId)
    if (!layer) {
      return reply.code(404).send({ error: `Unknown layer: ${layerId}` })
    }
    if (!isValidTileCoord(z, x, y)) {
      return reply.code(400).send({ error: 'Invalid tile coordinate' })
    }
    // Outside the layer's zoom range → empty tile, no DB hit.
    if (z < layer.minzoom || z > layer.maxzoom) {
      return reply.code(204).send()
    }

    const key = `${layerId}/${z}/${x}/${y}`
    const cached = cache.get(key)
    if (cached) {
      return reply
        .header('Content-Type', 'application/vnd.mapbox-vector-tile')
        .header('Cache-Control', 'public, max-age=86400')
        .header('X-Tile-Cache', 'hit')
        .send(cached)
    }

    try {
      const { sql, params } = buildTileQuery(layer, z, x, y)
      const { rows } = await fastify.pg.query(sql, params)
      const tile = rows[0] && rows[0].tile
      if (!tile || tile.length === 0) {
        return reply.code(204).send()
      }
      const buf = Buffer.from(tile)
      cache.set(key, buf)
      return reply
        .header('Content-Type', 'application/vnd.mapbox-vector-tile')
        .header('Cache-Control', 'public, max-age=86400')
        .header('X-Tile-Cache', 'miss')
        .send(buf)
    } catch (err) {
      fastify.log.error({ err, layer: layerId, z, x, y }, 'tile query failed')
      return reply.code(500).send({ error: 'Tile generation failed' })
    }
  })

  // Single feature as GeoJSON — for click-to-inspect popups.
  fastify.get('/tiles/:layer/:id', async (request, reply) => {
    const { layer: layerId, id } = request.params
    const layer = getLayer(layerId)
    if (!layer) {
      return reply.code(404).send({ error: `Unknown layer: ${layerId}` })
    }
    const fid = Number(id)
    if (!Number.isInteger(fid)) {
      return reply.code(400).send({ error: 'Invalid feature id' })
    }
    try {
      const attrs = layer.attributes.map((a) => `"${a}"`).join(', ')
      const { rows } = await fastify.pg.query(
        `SELECT ${attrs}, ST_AsGeoJSON(geom) AS geometry
         FROM "${layer.table}" WHERE fid = $1`,
        [fid]
      )
      if (rows.length === 0) {
        return reply.code(404).send({ error: 'Feature not found' })
      }
      const { geometry, ...properties } = rows[0]
      return {
        type: 'Feature',
        geometry: JSON.parse(geometry),
        properties: { ...properties, layer: layerId },
      }
    } catch (err) {
      fastify.log.error({ err, layer: layerId, id }, 'feature query failed')
      return reply.code(500).send({ error: 'Feature lookup failed' })
    }
  })
}

module.exports = { tilesRoutes }
```

- [ ] **Step 2: Verify the module loads**

Run (from `app-backend/`): `node -e "console.log(typeof require('./src/routes/tiles').tilesRoutes)"`
Expected: `function`

- [ ] **Step 3: Commit**

```bash
git add src/routes/tiles.js
git commit -m "feat: add vector tile route plugin"
```

---

## Task 8: Register the tile route in server.js

**Files:**
- Modify: `app-backend/server.js`

- [ ] **Step 1: Add the require**

Near the other route requires at the top of `server.js` (after the `spatialRoutes` require, ~line 48), add:

```js
// Vector tile service — serves zimbabwe.gpkg PostGIS layers as MVT.
const { tilesRoutes } = require('./src/routes/tiles')
```

- [ ] **Step 2: Register the route**

In `server.js`, find the block that registers `spatialRoutes` (it logs `✅ Spatial routes registered`). Immediately after that block, add:

```js
  try {
    await server.register(tilesRoutes, { prefix: '/api' })
    console.log('✅ Vector tile routes registered')
  } catch (error) {
    server.log.error({ err: error }, 'Failed to register tile routes')
  }
```

- [ ] **Step 3: Start the server and check the catalog endpoint**

Run (from `app-backend/`): `npm run dev` (in one terminal), then in another:
`curl http://localhost:3000/api/tiles/layers`
Expected: JSON with `"success":true` and a `data` array of 24 layers. (If the port differs, check the server startup log.)

- [ ] **Step 4: Commit**

```bash
git add server.js
git commit -m "feat: register vector tile routes in server"
```

---

## Task 9: Manual tile endpoint integration check

**Files:**
- Create: `app-backend/test-tiles-endpoint.js`

- [ ] **Step 1: Write the integration check script**

```js
// test-tiles-endpoint.js
// Manual check of the vector tile endpoints against a running server.
// Usage: node test-tiles-endpoint.js  (server must be running)
const BASE = process.env.TILE_BASE || 'http://localhost:3000/api/tiles'

async function check(name, fn) {
  try {
    await fn()
    console.log(`PASS  ${name}`)
  } catch (err) {
    console.log(`FAIL  ${name} — ${err.message}`)
    process.exitCode = 1
  }
}

async function main() {
  await check('catalog lists 24 layers', async () => {
    const r = await fetch(`${BASE}/layers`)
    const j = await r.json()
    if (!j.success || j.data.length !== 24) throw new Error(`got ${j.data && j.data.length}`)
  })

  // Zimbabwe sits in tile z6/x38/y36 — provinces should have data there.
  await check('provinces tile z6 returns MVT bytes', async () => {
    const r = await fetch(`${BASE}/provinces/6/38/36.pbf`)
    if (r.status !== 200) throw new Error(`status ${r.status}`)
    const buf = Buffer.from(await r.arrayBuffer())
    if (buf.length === 0) throw new Error('empty body')
  })

  await check('unknown layer returns 404', async () => {
    const r = await fetch(`${BASE}/not_a_layer/6/38/36.pbf`)
    if (r.status !== 404) throw new Error(`status ${r.status}`)
  })

  await check('invalid tile coordinate returns 400', async () => {
    const r = await fetch(`${BASE}/provinces/6/9999/9999.pbf`)
    if (r.status !== 400) throw new Error(`status ${r.status}`)
  })

  await check('buildings tile below minzoom returns 204', async () => {
    const r = await fetch(`${BASE}/buildings/6/38/36.pbf`)
    if (r.status !== 204) throw new Error(`status ${r.status}`)
  })
}

main()
```

- [ ] **Step 2: Run the integration check**

With the server running, run (from `app-backend/`): `node test-tiles-endpoint.js`
Expected: 5 `PASS` lines. If `provinces tile` fails with an empty body, confirm Task 1 showed `provinces` has rows and SRID 4326.

- [ ] **Step 3: Commit**

```bash
git add test-tiles-endpoint.js
git commit -m "test: add vector tile endpoint integration check"
```

---

## Task 10: Frontend tile API client

**Files:**
- Create: `app-frontend/src/services/vectorTiles.ts`
- Test: `app-frontend/src/services/__tests__/vectorTiles.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/services/__tests__/vectorTiles.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { tileUrlTemplate, getTileLayerCatalog, getFeature } from '../vectorTiles'

vi.mock('../api', () => ({
  default: { get: vi.fn() },
}))
import api from '../api'

describe('vectorTiles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('builds an absolute tile URL template with z/x/y placeholders', () => {
    expect(tileUrlTemplate('roads')).toBe('/api/tiles/roads/{z}/{x}/{y}.pbf')
  })

  it('returns the catalog data array', async () => {
    ;(api.get as any).mockResolvedValue({ data: { success: true, data: [{ id: 'roads' }] } })
    const layers = await getTileLayerCatalog()
    expect(layers).toEqual([{ id: 'roads' }])
    expect(api.get).toHaveBeenCalledWith('/tiles/layers')
  })

  it('returns an empty catalog when the request fails', async () => {
    ;(api.get as any).mockRejectedValue(new Error('network'))
    expect(await getTileLayerCatalog()).toEqual([])
  })

  it('fetches a single feature by id', async () => {
    const feature = { type: 'Feature', properties: { fid: 5 } }
    ;(api.get as any).mockResolvedValue({ data: feature })
    expect(await getFeature('roads', 5)).toEqual(feature)
    expect(api.get).toHaveBeenCalledWith('/tiles/roads/5')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `app-frontend/`): `npx vitest run src/services/__tests__/vectorTiles.spec.ts`
Expected: FAIL — cannot resolve `../vectorTiles`.

- [ ] **Step 3: Write the implementation**

```ts
// src/services/vectorTiles.ts
// Client for the backend PostGIS vector tile service (/api/tiles).
import api from './api'

export interface TileLayerMeta {
  id: string
  title: string
  geomType: 'polygon' | 'line' | 'point'
  group: 'admin' | 'landuse' | 'hydro' | 'transport' | 'structures' | 'poi'
  minzoom: number
  maxzoom: number
}

// The API base path. The axios instance uses baseURL '/api' for JSON calls,
// but MapLibre fetches tiles itself and needs the full path.
const TILE_BASE = '/api/tiles'

/** MapLibre vector-source tile template for a layer. */
export function tileUrlTemplate(layerId: string): string {
  return `${TILE_BASE}/${layerId}/{z}/{x}/{y}.pbf`
}

/** Fetches the layer catalog. Returns [] on failure so maps still render. */
export async function getTileLayerCatalog(): Promise<TileLayerMeta[]> {
  try {
    const res = await api.get('/tiles/layers')
    return res.data?.data ?? []
  } catch (error) {
    console.error('Failed to load tile layer catalog:', error)
    return []
  }
}

/** Fetches a single feature as a GeoJSON Feature, or null if not found. */
export async function getFeature(layerId: string, fid: number): Promise<any | null> {
  try {
    const res = await api.get(`/tiles/${layerId}/${fid}`)
    return res.data ?? null
  } catch (error) {
    console.error(`Failed to load feature ${layerId}/${fid}:`, error)
    return null
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/vectorTiles.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/vectorTiles.ts src/services/__tests__/vectorTiles.spec.ts
git commit -m "feat: add frontend vector tile API client"
```

---

## Task 11: Basemap style fragments

**Files:**
- Create: `app-frontend/src/map/vunguBasemapStyle.ts`
- Test: `app-frontend/src/map/__tests__/vunguBasemapStyle.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/map/__tests__/vunguBasemapStyle.spec.ts
import { describe, it, expect } from 'vitest'
import { styleLayerFor } from '../vunguBasemapStyle'

describe('styleLayerFor', () => {
  it('produces a fill layer for a polygon layer', () => {
    const l = styleLayerFor({ id: 'landuse', geomType: 'polygon', group: 'landuse' } as any)
    expect(l.type).toBe('fill')
    expect(l.id).toBe('vungu-landuse')
    expect(l.source).toBe('vungu-landuse')
    expect(l['source-layer']).toBe('landuse')
  })
  it('produces a line layer for a line layer', () => {
    const l = styleLayerFor({ id: 'roads', geomType: 'line', group: 'transport' } as any)
    expect(l.type).toBe('line')
  })
  it('produces a circle layer for a point layer', () => {
    const l = styleLayerFor({ id: 'pois_points', geomType: 'point', group: 'poi' } as any)
    expect(l.type).toBe('circle')
  })
  it('gives admin polygons a transparent fill so boundaries read as outlines', () => {
    const l = styleLayerFor({ id: 'provinces', geomType: 'polygon', group: 'admin' } as any)
    expect(l.paint['fill-opacity']).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `app-frontend/`): `npx vitest run src/map/__tests__/vunguBasemapStyle.spec.ts`
Expected: FAIL — cannot resolve `../vunguBasemapStyle`.

- [ ] **Step 3: Write the implementation**

```ts
// src/map/vunguBasemapStyle.ts
// Generates a MapLibre style layer for each PostGIS tile layer, keyed by
// geometry type and group. Source id and layer id are both `vungu-<id>`.
import type { TileLayerMeta } from '@/services/vectorTiles'

// Per-group fill colours for polygon layers.
const POLYGON_COLORS: Record<string, string> = {
  admin: '#1d4ed8',
  landuse: '#86efac',
  hydro: '#7dd3fc',
  structures: '#cbd5e1',
  poi: '#fcd34d',
}
// Per-group line colours.
const LINE_COLORS: Record<string, string> = {
  transport: '#78716c',
  hydro: '#0ea5e9',
  admin: '#1d4ed8',
}
// Per-group point colours.
const POINT_COLORS: Record<string, string> = {
  poi: '#d97706',
  admin: '#1d4ed8',
}

export interface BasemapStyleLayer {
  id: string
  type: 'fill' | 'line' | 'circle'
  source: string
  'source-layer': string
  paint: Record<string, any>
  layout?: Record<string, any>
}

/** Builds the MapLibre style layer for one tile layer. */
export function styleLayerFor(layer: Pick<TileLayerMeta, 'id' | 'geomType' | 'group'>): BasemapStyleLayer {
  const sourceId = `vungu-${layer.id}`
  const base = { id: sourceId, source: sourceId, 'source-layer': layer.id }

  if (layer.geomType === 'polygon') {
    return {
      ...base,
      type: 'fill',
      paint: {
        'fill-color': POLYGON_COLORS[layer.group] ?? '#cbd5e1',
        // Admin polygons read as outlines only; everything else gets a wash.
        'fill-opacity': layer.group === 'admin' ? 0 : 0.35,
        'fill-outline-color': layer.group === 'admin' ? '#1d4ed8' : '#94a3b8',
      },
    }
  }
  if (layer.geomType === 'line') {
    return {
      ...base,
      type: 'line',
      paint: {
        'line-color': LINE_COLORS[layer.group] ?? '#78716c',
        'line-width': layer.group === 'admin' ? 1.5 : 1,
      },
    }
  }
  return {
    ...base,
    type: 'circle',
    paint: {
      'circle-radius': 4,
      'circle-color': POINT_COLORS[layer.group] ?? '#d97706',
      'circle-stroke-width': 1,
      'circle-stroke-color': '#ffffff',
    },
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/map/__tests__/vunguBasemapStyle.spec.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/map/vunguBasemapStyle.ts src/map/__tests__/vunguBasemapStyle.spec.ts
git commit -m "feat: add basemap style fragment generator"
```

---

## Task 12: Shared basemap module

**Files:**
- Create: `app-frontend/src/map/vunguBasemap.ts`
- Test: `app-frontend/src/map/__tests__/vunguBasemap.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/map/__tests__/vunguBasemap.spec.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { addVunguBasemap } from '../vunguBasemap'

vi.mock('@/services/vectorTiles', () => ({
  tileUrlTemplate: (id: string) => `/api/tiles/${id}/{z}/{x}/{y}.pbf`,
  getTileLayerCatalog: vi.fn(),
  getFeature: vi.fn(),
}))
import { getTileLayerCatalog } from '@/services/vectorTiles'

function fakeMap() {
  const sources: Record<string, any> = {}
  const layers: any[] = []
  return {
    sources,
    layers,
    getSource: (id: string) => sources[id],
    addSource: (id: string, s: any) => { sources[id] = s },
    getLayer: (id: string) => layers.find((l) => l.id === id),
    addLayer: (l: any) => { layers.push(l) },
    setLayoutProperty: vi.fn(),
    on: vi.fn(),
  }
}

const CATALOG = [
  { id: 'provinces', title: 'Provinces', geomType: 'polygon', group: 'admin', minzoom: 0, maxzoom: 22 },
  { id: 'roads', title: 'Roads', geomType: 'line', group: 'transport', minzoom: 8, maxzoom: 22 },
]

describe('addVunguBasemap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(getTileLayerCatalog as any).mockResolvedValue(CATALOG)
  })

  it('adds one vector source and one style layer per catalog layer', async () => {
    const map = fakeMap()
    await addVunguBasemap(map as any)
    expect(Object.keys(map.sources).sort()).toEqual(['vungu-provinces', 'vungu-roads'])
    expect(map.layers.map((l) => l.id).sort()).toEqual(['vungu-provinces', 'vungu-roads'])
  })

  it('is idempotent — calling twice does not duplicate sources', async () => {
    const map = fakeMap()
    await addVunguBasemap(map as any)
    await addVunguBasemap(map as any)
    expect(Object.keys(map.sources)).toHaveLength(2)
  })

  it('respects the groups option', async () => {
    const map = fakeMap()
    await addVunguBasemap(map as any, { groups: ['admin'] })
    expect(Object.keys(map.sources)).toEqual(['vungu-provinces'])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/map/__tests__/vunguBasemap.spec.ts`
Expected: FAIL — cannot resolve `../vunguBasemap`.

- [ ] **Step 3: Write the implementation**

```ts
// src/map/vunguBasemap.ts
// Adds the PostGIS vector-tile basemap layers to any MapLibre map.
// One call per map, after the map's 'load' event. Idempotent.
import { tileUrlTemplate, getTileLayerCatalog, getFeature, type TileLayerMeta } from '@/services/vectorTiles'
import { styleLayerFor } from './vunguBasemapStyle'

type Group = TileLayerMeta['group']

// Draw order: landuse/structures at the bottom, lines above, admin on top.
const GROUP_ORDER: Group[] = ['landuse', 'structures', 'hydro', 'transport', 'poi', 'admin']

export interface BasemapOptions {
  /** Restrict to these groups. Default: all. */
  groups?: Group[]
  /** Emit a 'feature-click' CustomEvent on click. Default: true. */
  interactive?: boolean
}

/**
 * Adds vector-tile sources + style layers for the zimbabwe.gpkg dataset.
 * Safe to call once per map. Failures are swallowed per-layer so one bad
 * layer never blanks the map.
 */
export async function addVunguBasemap(map: any, options: BasemapOptions = {}): Promise<void> {
  const { groups, interactive = true } = options
  const catalog = await getTileLayerCatalog()

  const wanted = catalog
    .filter((l) => !groups || groups.includes(l.group))
    .sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))

  for (const layer of wanted) {
    const sourceId = `vungu-${layer.id}`
    try {
      if (!map.getSource(sourceId)) {
        map.addSource(sourceId, {
          type: 'vector',
          tiles: [new URL(tileUrlTemplate(layer.id), window.location.origin).toString()],
          minzoom: layer.minzoom,
          maxzoom: layer.maxzoom,
        })
      }
      if (!map.getLayer(sourceId)) {
        const styleLayer = styleLayerFor(layer)
        map.addLayer({ ...styleLayer, minzoom: layer.minzoom, maxzoom: layer.maxzoom })
        if (interactive) wireInteraction(map, layer.id, sourceId)
      }
    } catch (err) {
      console.error(`addVunguBasemap: failed to add ${layer.id}`, err)
    }
  }
}

/** Hover cursor + click → fetch feature → emit a 'feature-click' CustomEvent. */
function wireInteraction(map: any, layerId: string, styleLayerId: string): void {
  map.on('mouseenter', styleLayerId, () => { map.getCanvas().style.cursor = 'pointer' })
  map.on('mouseleave', styleLayerId, () => { map.getCanvas().style.cursor = '' })
  map.on('click', styleLayerId, async (e: any) => {
    const hit = e.features && e.features[0]
    if (!hit) return
    const fid = hit.properties && hit.properties.fid
    const feature = fid != null ? await getFeature(layerId, Number(fid)) : null
    map.getContainer().dispatchEvent(
      new CustomEvent('feature-click', {
        detail: { layer: layerId, fid, lngLat: e.lngLat, feature, properties: hit.properties },
      })
    )
  })
}

/** Shows or hides a basemap layer. */
export function setBasemapLayerVisible(map: any, layerId: string, visible: boolean): void {
  const styleLayerId = `vungu-${layerId}`
  if (map.getLayer(styleLayerId)) {
    map.setLayoutProperty(styleLayerId, 'visibility', visible ? 'visible' : 'none')
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/map/__tests__/vunguBasemap.spec.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add src/map/vunguBasemap.ts src/map/__tests__/vunguBasemap.spec.ts
git commit -m "feat: add shared MapLibre basemap module"
```

---

## Task 13: Spatial store tile actions

**Files:**
- Modify: `app-frontend/src/stores/spatial.ts`

- [ ] **Step 1: Add tile state and actions**

In `src/stores/spatial.ts`, add an import at the top (after the existing `ogcService` import):

```ts
import { getTileLayerCatalog, type TileLayerMeta } from '@/services/vectorTiles'
import { setBasemapLayerVisible } from '@/map/vunguBasemap'
```

Inside the store body, after the `failedLayers` ref declaration, add:

```ts
  // PostGIS vector tile layers (zimbabwe.gpkg dataset).
  const tileLayers = ref<TileLayerMeta[]>([])
  const visibleTileLayers = ref<Set<string>>(new Set())
```

After the `loadLayers` action, add:

```ts
  // Loads the PostGIS vector tile catalog. Safe to call repeatedly.
  async function loadTileLayers() {
    tileLayers.value = await getTileLayerCatalog()
  }

  // Toggles a tile layer's visibility on the given MapLibre map.
  function toggleTileLayer(map: any, layerId: string) {
    const next = !visibleTileLayers.value.has(layerId)
    if (next) visibleTileLayers.value.add(layerId)
    else visibleTileLayers.value.delete(layerId)
    setBasemapLayerVisible(map, layerId, next)
  }
```

In the store's `return { ... }` object, add `tileLayers`, `visibleTileLayers`, `loadTileLayers`, and `toggleTileLayer` to the exported members (alongside `loadLayers`).

- [ ] **Step 2: Type-check**

Run (from `app-frontend/`): `npx vue-tsc --noEmit`
Expected: no new errors referencing `spatial.ts`. (Pre-existing unrelated errors elsewhere can be ignored.)

- [ ] **Step 3: Commit**

```bash
git add src/stores/spatial.ts
git commit -m "feat: add tile layer actions to spatial store"
```

---

## Task 14: Roll out — GISMapView

**Files:**
- Modify: `app-frontend/src/views/GISMapView.vue`

- [ ] **Step 1: Import the basemap module**

In the `<script setup>` block of `GISMapView.vue`, add to the imports:

```ts
import { addVunguBasemap } from '@/map/vunguBasemap'
```

- [ ] **Step 2: Call addVunguBasemap on map load**

Find where the MapLibre map is created (a `new maplibregl.Map(...)` call) and its `load` handler. Inside the `map.on('load', ...)` callback, add:

```ts
  addVunguBasemap(map)
```

If the map variable has a different name (e.g. `mapInstance`), use that name. If there is no `load` handler, add one:

```ts
  map.on('load', () => { addVunguBasemap(map) })
```

- [ ] **Step 3: Verify in the browser**

Run (from `app-frontend/`): `npm run dev`, with the backend also running. Open the GIS map view. Confirm Zimbabwe admin boundaries, roads and other layers render, and clicking a feature works.

- [ ] **Step 4: Commit**

```bash
git add src/views/GISMapView.vue
git commit -m "feat: render PostGIS basemap in GISMapView"
```

---

## Task 15: Roll out — VunguMapView

**Files:**
- Modify: `app-frontend/src/views/VunguMapView.vue`

- [ ] **Step 1: Import the basemap module**

In `<script setup>` of `VunguMapView.vue`, add:

```ts
import { addVunguBasemap } from '@/map/vunguBasemap'
```

- [ ] **Step 2: Call addVunguBasemap on map load**

The map is `let map` and is created in `onMounted`. Inside the map's `load` handler (add one if absent), add:

```ts
  addVunguBasemap(map)
```

The existing QGIS WMS layer controls stay — they remain available as optional toggles alongside the PostGIS basemap.

- [ ] **Step 3: Verify in the browser**

With backend + frontend running, open the Vungu map view. Confirm the PostGIS layers render and the QGIS WMS layer checkboxes still work.

- [ ] **Step 4: Commit**

```bash
git add src/views/VunguMapView.vue
git commit -m "feat: render PostGIS basemap in VunguMapView"
```

---

## Task 16: Roll out — QGISMapView

**Files:**
- Modify: `app-frontend/src/views/QGISMapView.vue`

- [ ] **Step 1: Import the basemap module**

In `<script setup>` of `QGISMapView.vue`, add:

```ts
import { addVunguBasemap } from '@/map/vunguBasemap'
```

- [ ] **Step 2: Call addVunguBasemap on map load**

Inside the MapLibre map's `load` handler, add:

```ts
  addVunguBasemap(map)
```

Keep all existing QGIS WMS code — the PostGIS basemap is added as the base context underneath.

- [ ] **Step 3: Verify in the browser**

Open the QGIS map view; confirm both the PostGIS basemap and the QGIS layers render.

- [ ] **Step 4: Commit**

```bash
git add src/views/QGISMapView.vue
git commit -m "feat: add PostGIS basemap to QGISMapView"
```

---

## Task 17: Roll out — MapExplorer

**Files:**
- Modify: `app-frontend/src/views/MapExplorer.vue`

- [ ] **Step 1: Import the basemap module**

In `<script setup>` of `MapExplorer.vue`, add:

```ts
import { addVunguBasemap } from '@/map/vunguBasemap'
```

- [ ] **Step 2: Add the basemap and load the tile catalog**

Inside the map's `load` handler, add:

```ts
  addVunguBasemap(map)
```

If the view has a Pinia spatial store instance (`const spatialStore = useSpatialStore()`), also call `spatialStore.loadTileLayers()` in `onMounted` so the tile layers appear in the layer list. Layer toggles should call `spatialStore.toggleTileLayer(map, layerId)`.

- [ ] **Step 3: Verify in the browser**

Open Map Explorer; confirm the tile layers list loads and toggles show/hide layers on the map.

- [ ] **Step 4: Commit**

```bash
git add src/views/MapExplorer.vue
git commit -m "feat: render PostGIS basemap in MapExplorer"
```

---

## Task 18: Roll out — InteractiveMap component

**Files:**
- Modify: `app-frontend/src/components/InteractiveMap.vue`

- [ ] **Step 1: Import the basemap module**

In `<script setup>` of `InteractiveMap.vue`, add:

```ts
import { addVunguBasemap } from '@/map/vunguBasemap'
```

- [ ] **Step 2: Call addVunguBasemap on map load**

Find the `map.value` MapLibre instance creation and its `load` handler. Inside the `load` callback, add:

```ts
    if (map.value) addVunguBasemap(map.value)
```

- [ ] **Step 3: Verify in the browser**

InteractiveMap is used by several portal views (e.g. GISOfficerView, PlanningClerkView). Open one and confirm the PostGIS basemap renders beneath the existing app layers.

- [ ] **Step 4: Commit**

```bash
git add src/components/InteractiveMap.vue
git commit -m "feat: render PostGIS basemap in InteractiveMap"
```

---

## Task 19: Roll out — SpatialMapCore component

**Files:**
- Modify: `app-frontend/src/components/development/SpatialMapCore.vue`

- [ ] **Step 1: Import the basemap module**

In `<script setup>` of `SpatialMapCore.vue`, add:

```ts
import { addVunguBasemap } from '@/map/vunguBasemap'
```

- [ ] **Step 2: Call addVunguBasemap on map load**

Inside the MapLibre map's `load` handler, add the call so the basemap sits beneath the development-application overlays:

```ts
  addVunguBasemap(map)
```

Use the actual map variable name from the file.

- [ ] **Step 3: Verify in the browser**

Open a development-application view that uses SpatialMapCore; confirm the basemap renders and the application overlays still draw on top.

- [ ] **Step 4: Commit**

```bash
git add src/components/development/SpatialMapCore.vue
git commit -m "feat: render PostGIS basemap in SpatialMapCore"
```

---

## Task 20: Roll out — ParcelSelectorMap component

**Files:**
- Modify: `app-frontend/src/components/ParcelSelectorMap.vue`

- [ ] **Step 1: Import the basemap module**

In `<script setup>` of `ParcelSelectorMap.vue`, add:

```ts
import { addVunguBasemap } from '@/map/vunguBasemap'
```

- [ ] **Step 2: Call addVunguBasemap on map load**

Inside the MapLibre map's `load` handler, add:

```ts
  addVunguBasemap(map)
```

- [ ] **Step 3: Verify in the browser**

Open a view with parcel selection; confirm the basemap renders as context behind the parcel-selection UI.

- [ ] **Step 4: Commit**

```bash
git add src/components/ParcelSelectorMap.vue
git commit -m "feat: render PostGIS basemap in ParcelSelectorMap"
```

---

## Task 21: Roll out — citizen MapSection

**Files:**
- Modify: `app-frontend/src/views/citizen/sections/MapSection.vue`

- [ ] **Step 1: Import the basemap module**

In `<script setup>` of `MapSection.vue`, add:

```ts
import { addVunguBasemap } from '@/map/vunguBasemap'
```

- [ ] **Step 2: Call addVunguBasemap on map load**

Inside the MapLibre map's `load` handler, add:

```ts
  addVunguBasemap(map)
```

- [ ] **Step 3: Verify in the browser**

Open the citizen portal map section; confirm the PostGIS basemap renders.

- [ ] **Step 4: Commit**

```bash
git add src/views/citizen/sections/MapSection.vue
git commit -m "feat: render PostGIS basemap in citizen MapSection"
```

---

## Task 22: Roll out — GIS officer map sections

**Files:**
- Modify: `app-frontend/src/views/gis-officer/sections/ZoningMapsSection.vue`
- Modify: `app-frontend/src/views/gis-officer/sections/ApplicationMappingSection.vue`
- Modify: `app-frontend/src/views/gis-officer/sections/EnforcementMappingSection.vue`
- Modify: `app-frontend/src/views/gis-officer/sections/EnvironmentalConstraintsSection.vue`

For **each** of the four files, apply the same change:

- [ ] **Step 1: Import the basemap module**

In `<script setup>`, add:

```ts
import { addVunguBasemap } from '@/map/vunguBasemap'
```

- [ ] **Step 2: Call addVunguBasemap on map load**

Inside that file's MapLibre map `load` handler, add (using the file's own map variable name):

```ts
  addVunguBasemap(map)
```

- [ ] **Step 3: Verify in the browser**

Open each of the four GIS-officer sections; confirm the PostGIS basemap renders in each.

- [ ] **Step 4: Commit**

```bash
git add src/views/gis-officer/sections/ZoningMapsSection.vue src/views/gis-officer/sections/ApplicationMappingSection.vue src/views/gis-officer/sections/EnforcementMappingSection.vue src/views/gis-officer/sections/EnvironmentalConstraintsSection.vue
git commit -m "feat: render PostGIS basemap in GIS officer map sections"
```

---

## Task 23: Repoint the sparse Gweru spatial-data routes

The `/spatial-data/*` routes in `app-backend/src/routes/spatial-data.ts` read sparse `gweru_*` sample tables. The frontend `src/services/spatial.ts` calls `/spatial-data/land-parcels`, `/spatial-data/coordinate-points`, `/spatial-data/proposed-peri-urban-zones`, and `/spatial-data/layers`.

**Files:**
- Modify: `app-frontend/src/services/spatial.ts`

- [ ] **Step 1: Find callers of the spatial service functions**

Run (from `app-frontend/`):
```bash
git grep -n "listLandParcels\|listCoordinatePoints\|getProposedPeriUrbanZones\|getAvailableLayers\|getPostGISLayer" src
```
Record which views import from `@/services/spatial`.

- [ ] **Step 2: Decide per caller**

For each caller found:
- If the view now uses `addVunguBasemap` for its map data (Tasks 14–22), the old `spatial.ts` call is redundant — remove that call and its now-unused state.
- If a caller genuinely still needs parcel/coordinate data (application-specific, not basemap), leave it untouched — those tables are out of scope.

Apply the removals. Do not delete `src/services/spatial.ts` itself unless Step 1 found zero remaining callers.

- [ ] **Step 3: Type-check**

Run: `npx vue-tsc --noEmit`
Expected: no new errors from the edited files.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: drop redundant Gweru spatial-data calls superseded by vector tiles"
```

> The backend `/spatial-data/*` routes are **left registered** — removing them is out of scope and risks breaking callers not surfaced here. They simply stop being the basemap source.

---

## Task 24: Full verification pass

**Files:** none (verification only)

- [ ] **Step 1: Run backend unit tests**

Run (from `app-backend/`): `npx jest src/lib`
Expected: all tests in `tileQuery.test.js` and `tileCache.test.js` PASS.

- [ ] **Step 2: Run frontend unit tests**

Run (from `app-frontend/`): `npx vitest run src/services/__tests__/vectorTiles.spec.ts src/map/__tests__`
Expected: all PASS.

- [ ] **Step 3: Run the tile endpoint integration check**

With the backend running: `node test-tiles-endpoint.js` (from `app-backend/`)
Expected: 5 PASS lines.

- [ ] **Step 4: Manual map sweep**

With backend + frontend running, open each rolled-out view: GISMapView, VunguMapView, QGISMapView, MapExplorer, a portal using InteractiveMap, a development view using SpatialMapCore, a parcel-selection view, citizen MapSection, and the four GIS-officer sections. For each: confirm Zimbabwe data renders, panning/zooming loads tiles, and feature click works.

- [ ] **Step 5: Frontend production build**

Run (from `app-frontend/`): `npm run build`
Expected: build succeeds.

- [ ] **Step 6: Final commit (if any verification fixes were needed)**

```bash
git add -A
git commit -m "test: verification pass for PostGIS vector tile maps"
```

---

## Notes / deviations from the spec

- **Cache:** the spec mentioned Redis ("already wired in"). `@fastify/redis` is a declared dependency but is **not** registered in `server.js`. To avoid adding a Redis runtime dependency, this plan uses a bounded in-process `TileCache` plus a 24h `Cache-Control` header (browser cache). Redis can be swapped in later behind the same `TileCache` interface.
- **Language:** the spec named backend files `*.ts`. The running server (`server.js`) is CommonJS and `require`s `./src/routes/*`; backend files in this plan are therefore CommonJS `.js`, consistent with `spatial.js` / `dynamic-layers.js`.
- **QGIS Server:** untouched, as agreed — `/api/qgis` and `/ogc/*` remain registered and usable.
