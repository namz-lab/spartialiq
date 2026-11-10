# Planner Stand Map Picker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the planner pick a stand on a map from the Step 1 Intake form, auto-fill stand no / ward / description / area / centroid from spatial tables, and block (with a district-named message) any selection outside Vungu RDC's jurisdiction.

**Architecture:** A new backend endpoint `GET /api/parcels/locate?lng&lat` composes spatial "resolvers" (jurisdiction via `gweru_rural_planning_boundary`, district via `districts`, parcel via `vungu_parcels`, ward via `wards`) into one bundle. A new `StandPickerModal.vue` (built on the existing `vunguBasemap` + `searchMap`) calls it on map click / search-result click and emits a typed selection. `Step1Intake.vue` opens the modal from a map-pin icon and maps the bundle to form fields.

**Tech Stack:** Fastify + `@fastify/postgres` (PostGIS), Vue 3 `<script setup>` + MapLibre GL, axios, Vitest (frontend), Jest (backend).

**Reference spec:** `docs/superpowers/specs/2026-05-29-planner-stand-map-picker-design.md`

**Cross-cutting facts (verified against the live DB):**
- SRIDs differ: `vungu_parcels`/`gweru_rural_planning_boundary` = 4326, `wards`/`districts` = 900914. Both are lng/lat degrees. Containment MUST force the point to the geom's SRID, never transform: `ST_Contains(geom, ST_SetSRID(ST_MakePoint($lng,$lat), ST_SRID(geom)))`.
- Centroids for output: `ST_X/ST_Y(ST_Centroid(ST_Transform(geom, 4326)))`.
- `gweru_rural_planning_boundary` is a single polygon (`adm2_en = "Gweru Rural"`) = Vungu RDC's area.
- `local_authorities` has two identical "Vungu Rural District Council" rows with NULL geometry → use `DISTINCT … LIMIT 1` for contacts only.
- Council district pcode env: `COUNCIL_DISTRICT_PCODE` (default `ZW1704`).
- Verified test fixtures:
  - **A** `lng=29.39004439183376 lat=-19.294730339613977` → `in_jurisdiction=true`, `district="Gweru"`, `stand.stand_number="Communal Land"`, `stand.ward="6"`.
  - **C** `lng=31.05 lat=-17.83` (Harare) → `in_jurisdiction=false`, `district="Harare"`, `stand=null`.
  - **D** `lng=0 lat=0` → `in_jurisdiction=false`, `district=null`, `stand=null`.

---

## File structure

**Backend (`../app-backend`)**
- Create `src/routes/parcels.js` — `parcelsRoutes` plugin: the `locate` route + exported `resolveLocation(pg, lng, lat)` and its resolvers.
- Create `src/routes/__tests__/parcels.locate.test.js` — Jest real-DB test of `resolveLocation`.
- Modify `server.js` — register `parcelsRoutes`.
- Modify `src/routes/tiles.js` — make `/map-search` places/POIs country-wide + add districts.

**Frontend (this repo)**
- Create `src/services/parcels.ts` — `locateStand(lng, lat)` + types.
- Create `src/services/__tests__/parcels.spec.ts` — Vitest test (mocked axios).
- Create `src/components/StandPickerModal.vue` — the modal map picker.
- Create `src/components/__tests__/StandPickerModal.spec.ts` — Vitest test.
- Modify `src/composables/usePlannerCase.ts` — optional `centroid` on the case property.
- Modify `src/views/planner/Step1Intake.vue` — map-pin icon, modal wiring, field mapping, parcel-area display.

---

## Task 1: Backend — `resolveLocation` + `locate` route

**Files:**
- Create: `../app-backend/src/routes/parcels.js`
- Test: `../app-backend/src/routes/__tests__/parcels.locate.test.js`
- Modify: `../app-backend/server.js`

- [ ] **Step 1: Write the failing test**

Create `src/routes/__tests__/parcels.locate.test.js`:

```js
require('dotenv').config()
const { Pool } = require('pg')
const { resolveLocation } = require('../parcels')

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: false })
afterAll(async () => { await pool.end() })

describe('resolveLocation', () => {
  test('A: in-Vungu point on a parcel', async () => {
    const b = await resolveLocation(pool, 29.39004439183376, -19.294730339613977)
    expect(b.in_jurisdiction).toBe(true)
    expect(b.district).toBe('Gweru')
    expect(b.authority).not.toBeNull()
    expect(b.authority.name).toBe('Vungu Rural District Council')
    expect(b.stand).not.toBeNull()
    expect(b.stand.stand_number).toBe('Communal Land')
    expect(b.stand.ward).toBe('6')
    expect(Array.isArray(b.stand.centroid)).toBe(true)
    expect(b.stand.centroid).toHaveLength(2)
    expect(typeof b.stand.description).toBe('string')
  })

  test('C: out-of-Vungu point (Harare) names the district, no stand', async () => {
    const b = await resolveLocation(pool, 31.05, -17.83)
    expect(b.in_jurisdiction).toBe(false)
    expect(b.district).toBe('Harare')
    expect(b.stand).toBeNull()
  })

  test('D: point with no district', async () => {
    const b = await resolveLocation(pool, 0, 0)
    expect(b.in_jurisdiction).toBe(false)
    expect(b.district).toBeNull()
    expect(b.stand).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd ../app-backend && npx jest src/routes/__tests__/parcels.locate.test.js`
Expected: FAIL — `Cannot find module '../parcels'`.

- [ ] **Step 3: Write the implementation**

Create `src/routes/parcels.js`:

```js
// src/routes/parcels.js
// Parcel/stand spatial lookup for the planner intake map picker.
// Resolves an arbitrary lng/lat into a jurisdiction + stand bundle.

const VUNGU_AUTHORITY = 'Vungu Rural District Council'

// SRID-safe point-in-polygon: force the point to the geom's own SRID rather
// than transform (the tables mix 4326 and the custom 900914 ≡ CRS84, both
// lng/lat degrees, and 900914 is not transform-safe).
const CONTAINS = (geomExpr) =>
  `ST_Contains(${geomExpr}, ST_SetSRID(ST_MakePoint($1, $2), ST_SRID(${geomExpr})))`

async function jurisdictionResolver(pg, lng, lat) {
  const inj = await pg.query(
    `SELECT ${CONTAINS('geom')} AS v FROM gweru_rural_planning_boundary LIMIT 1`,
    [lng, lat],
  )
  const dist = await pg.query(
    `SELECT name_en FROM districts
     WHERE level = 2 AND ${CONTAINS('geom')} LIMIT 1`,
    [lng, lat],
  )
  const auth = await pg.query(
    `SELECT DISTINCT authority_name AS name, telephone, email, address
     FROM local_authorities WHERE authority_name = $1 LIMIT 1`,
    [VUNGU_AUTHORITY],
  )
  return {
    in_jurisdiction: Boolean(inj.rows[0] && inj.rows[0].v),
    district: dist.rows[0] ? dist.rows[0].name_en : null,
    authority: auth.rows[0] || null,
  }
}

async function parcelResolver(pg, lng, lat) {
  const r = await pg.query(
    `SELECT fid,
            COALESCE(NULLIF(name, ''), name_cfu, 'Parcel ' || fid) AS stand_number,
            province,
            area_ha,
            ST_X(ST_Centroid(ST_Transform(geom, 4326))) AS lng,
            ST_Y(ST_Centroid(ST_Transform(geom, 4326))) AS lat
     FROM vungu_parcels
     WHERE geom IS NOT NULL AND ${CONTAINS('geom')}
     LIMIT 1`,
    [lng, lat],
  )
  if (!r.rows[0]) return null
  const p = r.rows[0]
  return {
    fid: p.fid,
    stand_number: p.stand_number,
    province: p.province,
    area_ha: p.area_ha === null ? null : Number(p.area_ha),
    centroid: [Number(p.lng), Number(p.lat)],
  }
}

async function wardResolver(pg, lng, lat) {
  const r = await pg.query(
    `SELECT name_en FROM wards
     WHERE level = 3 AND ${CONTAINS('geom')} LIMIT 1`,
    [lng, lat],
  )
  return r.rows[0] ? r.rows[0].name_en : null
}

function buildDescription(stand, district) {
  const area = stand.area_ha != null ? ` — ${stand.area_ha} ha` : ''
  const place = district ? `, ${district}` : ''
  return `Parcel ${stand.stand_number}${place}${area}`
}

/**
 * Compose the intake bundle for a point. Pass anything with a `.query`
 * method (a pg Pool or fastify.pg).
 * @returns {{in_jurisdiction:boolean, district:string|null,
 *   authority:object|null, stand:object|null}}
 */
async function resolveLocation(pg, lng, lat) {
  const j = await jurisdictionResolver(pg, lng, lat)
  let stand = null
  if (j.in_jurisdiction) {
    stand = await parcelResolver(pg, lng, lat)
    if (stand) {
      stand.district = j.district
      stand.ward = await wardResolver(pg, lng, lat)
      stand.description = buildDescription(stand, j.district)
    }
  }
  return { ...j, stand }
}

/**
 * Fastify plugin. Register with prefix '/api'; routes live under /api/parcels.
 * @param {import('fastify').FastifyInstance} fastify
 */
async function parcelsRoutes(fastify) {
  fastify.get('/parcels/locate', async (request, reply) => {
    const lng = Number(request.query?.lng)
    const lat = Number(request.query?.lat)
    if (!Number.isFinite(lng) || !Number.isFinite(lat)
        || lng < -180 || lng > 180 || lat < -90 || lat > 90) {
      return reply.code(400).send({
        success: false, error: 'bad_request',
        message: 'lng and lat query params are required and must be valid coordinates',
      })
    }
    try {
      const data = await resolveLocation(fastify.pg, lng, lat)
      return { success: true, data }
    } catch (err) {
      request.log.error({ err }, 'parcel locate failed')
      return reply.code(500).send({
        success: false, error: 'internal', message: 'Failed to locate parcel',
      })
    }
  })
}

module.exports = {
  parcelsRoutes,
  resolveLocation,
  jurisdictionResolver,
  parcelResolver,
  wardResolver,
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd ../app-backend && npx jest src/routes/__tests__/parcels.locate.test.js`
Expected: PASS — 3 tests green.

- [ ] **Step 5: Register the route in `server.js`**

Add the require next to the tiles require (after line 56 `const { tilesRoutes } = require('./src/routes/tiles')`):

```js
const { parcelsRoutes } = require('./src/routes/parcels')
```

Add the registration next to the other `server.register(..., { prefix: '/api' })` calls (search for the `tilesRoutes` registration and add directly below it):

```js
    await server.register(parcelsRoutes, { prefix: '/api' })
```

- [ ] **Step 6: Smoke-test the live route**

Start the backend (`npm run dev`) if not running, then:

Run: `curl -s "http://127.0.0.1:3000/api/parcels/locate?lng=29.39004439183376&lat=-19.294730339613977"`
Expected: JSON `{"success":true,"data":{"in_jurisdiction":true,"district":"Gweru",...,"stand":{"stand_number":"Communal Land","ward":"6",...}}}`

Run: `curl -s -o /dev/null -w "%{http_code}\n" "http://127.0.0.1:3000/api/parcels/locate?lng=abc"`
Expected: `400`

- [ ] **Step 7: Commit**

```bash
cd ../app-backend
git add src/routes/parcels.js src/routes/__tests__/parcels.locate.test.js server.js
git commit -m "feat(api): add /parcels/locate spatial resolver for stand picker"
```

---

## Task 2: Backend — country-wide `/map-search`

**Files:**
- Modify: `../app-backend/src/routes/tiles.js` (the `places` and `pois` queries, ~lines 159-197; add a districts query)

- [ ] **Step 1: Verify the current (Vungu-only) behaviour**

Run: `curl -s "http://127.0.0.1:3000/api/map-search?q=harare" | head -c 200`
Expected: `{"success":true,"data":[]}` (Harare is outside Vungu, so nothing matches today).

- [ ] **Step 2: Make places + POIs country-wide and add districts**

In `src/routes/tiles.js`, replace the **places** query block (the `const places = await fastify.pg.query(... FROM places_points p JOIN districts d ON d.pcode = $2 ... ST_Within ...)` and its `for` loop) with a country-wide version that labels each hit with its containing district:

```js
      // Named places (towns / villages) country-wide, labelled by district.
      const places = await fastify.pg.query(
        `SELECT p.name AS label, p.fclass,
                d.name_en AS district,
                ST_X(ST_Centroid(ST_SetSRID(p.geom, 4326))) AS lon,
                ST_Y(ST_Centroid(ST_SetSRID(p.geom, 4326))) AS lat
         FROM places_points p
         LEFT JOIN districts d
           ON d.level = 2 AND ST_Contains(d.geom, ST_SetSRID(p.geom, ST_SRID(d.geom)))
         WHERE p.name ILIKE $1
         ORDER BY p.name
         LIMIT 8`,
        [like]
      )
      for (const r of places.rows) {
        out.push({
          type: 'place',
          label: r.label,
          subtitle: r.district
            ? `${cap((r.fclass || 'place').replace(/_/g, ' '))} · ${r.district}`
            : (r.fclass ? cap(r.fclass.replace(/_/g, ' ')) : 'Place'),
          center: [Number(r.lon), Number(r.lat)],
        })
      }
```

Replace the **POIs** query block similarly (drop the `JOIN districts d ON d.pcode = $2` + `ST_Within` restriction):

```js
      // Points of interest country-wide, searched by name.
      const pois = await fastify.pg.query(
        `SELECT p.name AS label, p.fclass,
                ST_X(ST_Centroid(ST_SetSRID(p.geom, 4326))) AS lon,
                ST_Y(ST_Centroid(ST_SetSRID(p.geom, 4326))) AS lat
         FROM pois_points p
         WHERE p.name ILIKE $1
         ORDER BY p.name
         LIMIT 8`,
        [like]
      )
      for (const r of pois.rows) {
        out.push({
          type: 'poi',
          label: r.label,
          subtitle: r.fclass ? cap(r.fclass.replace(/_/g, ' ')) : 'Facility',
          center: [Number(r.lon), Number(r.lat)],
        })
      }
```

Add a **districts** source (place this block immediately after the wards block, before parcels):

```js
      // Districts country-wide — lets the planner jump to any district.
      const districts = await fastify.pg.query(
        `SELECT name_en AS label,
                ST_X(ST_Centroid(ST_SetSRID(geom, 4326))) AS lon,
                ST_Y(ST_Centroid(ST_SetSRID(geom, 4326))) AS lat
         FROM districts
         WHERE level = 2 AND name_en ILIKE $1
         ORDER BY name_en
         LIMIT 8`,
        [like]
      )
      for (const r of districts.rows) {
        out.push({ type: 'place', label: r.label, subtitle: 'District',
          center: [Number(r.lon), Number(r.lat)] })
      }
```

> Note: `councilPcode` is still used by the wards query, so leave that line in place. Only the places/pois `$2` district restriction is removed.

- [ ] **Step 3: Verify country-wide search now works**

Run: `curl -s "http://127.0.0.1:3000/api/map-search?q=harare" | head -c 300`
Expected: a non-empty `data` array including a Harare district/place hit with a `center`.

Run: `curl -s "http://127.0.0.1:3000/api/map-search?q=communal" | head -c 300`
Expected: still returns Vungu parcel hits (existing behaviour preserved).

- [ ] **Step 4: Commit**

```bash
cd ../app-backend
git add src/routes/tiles.js
git commit -m "feat(api): make map-search country-wide (places, POIs, districts)"
```

---

## Task 3: Frontend — `parcels.ts` service

**Files:**
- Create: `src/services/parcels.ts`
- Test: `src/services/__tests__/parcels.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/services/__tests__/parcels.spec.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../api', () => ({ default: { get: vi.fn() } }))
import api from '../api'
import { locateStand } from '../parcels'

const mockGet = api.get as unknown as ReturnType<typeof vi.fn>

describe('locateStand', () => {
  beforeEach(() => mockGet.mockReset())

  it('unwraps the {success,data} envelope', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: {
      in_jurisdiction: true, district: 'Gweru', authority: { name: 'Vungu Rural District Council' },
      stand: { fid: 4, stand_number: 'Communal Land', province: 'Midlands',
        area_ha: 12.3, centroid: [29.39, -19.29], ward: '6', district: 'Gweru',
        description: 'Parcel Communal Land, Gweru — 12.3 ha' },
    } } })
    const res = await locateStand(29.39, -19.29)
    expect(mockGet).toHaveBeenCalledWith('/parcels/locate', { params: { lng: 29.39, lat: -19.29 } })
    expect(res.in_jurisdiction).toBe(true)
    expect(res.stand?.stand_number).toBe('Communal Land')
  })

  it('returns an out-of-jurisdiction bundle', async () => {
    mockGet.mockResolvedValue({ data: { success: true, data: {
      in_jurisdiction: false, district: 'Harare', authority: null, stand: null,
    } } })
    const res = await locateStand(31.05, -17.83)
    expect(res.in_jurisdiction).toBe(false)
    expect(res.district).toBe('Harare')
    expect(res.stand).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/__tests__/parcels.spec.ts`
Expected: FAIL — cannot resolve `../parcels`.

- [ ] **Step 3: Write the implementation**

Create `src/services/parcels.ts`:

```ts
// src/services/parcels.ts
// Client for the parcel/stand spatial lookup (/api/parcels).
import api from './api'

export interface StandDetail {
  fid: number
  stand_number: string
  province: string | null
  area_ha: number | null
  centroid: [number, number]   // [lng, lat]
  ward: string | null
  district: string | null
  description: string
}

export interface ResponsibleAuthority {
  name: string
  telephone: string | null
  email: string | null
  address: string | null
}

export interface StandLocation {
  in_jurisdiction: boolean
  district: string | null
  authority: ResponsibleAuthority | null
  stand: StandDetail | null
}

/** Resolves a map point into a jurisdiction + stand bundle. */
export async function locateStand(lng: number, lat: number): Promise<StandLocation> {
  const res = await api.get('/parcels/locate', { params: { lng, lat } })
  return (res.data?.data ?? res.data) as StandLocation
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/services/__tests__/parcels.spec.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/services/parcels.ts src/services/__tests__/parcels.spec.ts
git commit -m "feat(planner): add parcels.locateStand service"
```

---

## Task 4: Frontend — `centroid` on the planner case

**Files:**
- Modify: `src/composables/usePlannerCase.ts` (the `CaseFile.property` interface ~line 48 and its default ~line 144)

- [ ] **Step 1: Add the optional field to the interface**

In `usePlannerCase.ts`, change the property line in the `CaseFile` interface:

```ts
  property:  { standNo: string; ward: string; description: string; titleDeedNo: string; centroid?: [number, number] }
```

- [ ] **Step 2: Keep the default valid**

The existing default at `property: { standNo:'', ward:'', description:'', titleDeedNo:'' }` stays valid because `centroid` is optional. No change needed there.

- [ ] **Step 3: Verify types compile**

Run: `npx vue-tsc --noEmit 2>&1 | grep -E "usePlannerCase" || echo "no new errors in usePlannerCase"`
Expected: `no new errors in usePlannerCase`

- [ ] **Step 4: Commit**

```bash
git add src/composables/usePlannerCase.ts
git commit -m "feat(planner): allow optional parcel centroid on the case property"
```

---

## Task 5: Frontend — `StandPickerModal.vue`

**Files:**
- Create: `src/components/StandPickerModal.vue`
- Test: `src/components/__tests__/StandPickerModal.spec.ts`

- [ ] **Step 1: Write the failing test**

The map itself is hard to unit-test, so the component exposes `applyLocation` (also used by the map-click path). Create `src/components/__tests__/StandPickerModal.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import StandPickerModal from '../StandPickerModal.vue'
import type { StandLocation } from '@/services/parcels'

// Stub MapLibre + basemap so the component mounts without a real canvas.
vi.mock('maplibre-gl', () => ({
  default: {
    Map: class { on() {} addControl() {} remove() {} flyTo() {} resize() {} },
    NavigationControl: class {}, ScaleControl: class {},
    Marker: class { setLngLat() { return this } addTo() { return this } remove() {} },
  },
}))
vi.mock('@/map/vunguBasemap', () => ({ addVunguBasemap: vi.fn() }))

const inVungu: StandLocation = {
  in_jurisdiction: true, district: 'Gweru',
  authority: { name: 'Vungu Rural District Council', telephone: null, email: 'x@y', address: null },
  stand: { fid: 4, stand_number: 'Communal Land', province: 'Midlands', area_ha: 12.3,
    centroid: [29.39, -19.29], ward: '6', district: 'Gweru', description: 'Parcel Communal Land, Gweru — 12.3 ha' },
}
const outVungu: StandLocation = {
  in_jurisdiction: false, district: 'Harare', authority: null, stand: null,
}

describe('StandPickerModal', () => {
  it('enables confirm and emits the stand when in jurisdiction', async () => {
    const w = mount(StandPickerModal, { props: { open: true } })
    await (w.vm as any).applyLocation(inVungu)
    const confirm = w.get('[data-test="confirm"]')
    expect(confirm.attributes('disabled')).toBeUndefined()
    await confirm.trigger('click')
    expect(w.emitted('select')?.[0]?.[0]).toMatchObject({ stand: { stand_number: 'Communal Land' } })
  })

  it('blocks confirm and shows the district message when out of jurisdiction', async () => {
    const w = mount(StandPickerModal, { props: { open: true } })
    await (w.vm as any).applyLocation(outVungu)
    expect(w.get('[data-test="confirm"]').attributes('disabled')).toBeDefined()
    expect(w.text()).toContain('Harare')
    expect(w.text()).toContain('outside Vungu RDC')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/__tests__/StandPickerModal.spec.ts`
Expected: FAIL — cannot resolve `../StandPickerModal.vue`.

- [ ] **Step 3: Write the implementation**

Create `src/components/StandPickerModal.vue`:

```vue
<script setup lang="ts">
import { ref, watch, onBeforeUnmount, nextTick } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addVunguBasemap } from '@/map/vunguBasemap'
import { searchMap, type SearchResult } from '@/services/vectorTiles'
import { locateStand, type StandLocation } from '@/services/parcels'
import { MapPin, Search, X, Loader2 } from 'lucide-vue-next'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: []; select: [StandLocation] }>()

const mapEl = ref<HTMLDivElement>()
let map: maplibregl.Map | undefined
let marker: maplibregl.Marker | undefined

const loading = ref(false)
const location = ref<StandLocation | null>(null)
const query = ref('')
const results = ref<SearchResult[]>([])
let searchTimer: ReturnType<typeof setTimeout> | undefined

const blankStyle = {
  version: 8 as const,
  sources: {},
  layers: [{ id: 'background', type: 'background' as const, paint: { 'background-color': '#f2efe9' } }],
  glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
}

function initMap() {
  if (map || !mapEl.value) return
  map = new maplibregl.Map({
    container: mapEl.value,
    style: blankStyle as any,
    center: [29.6, -19.45],
    zoom: 8, minZoom: 5, maxZoom: 22,
    attributionControl: false,
  })
  map.addControl(new maplibregl.NavigationControl({ visualizePitch: false }), 'top-right')
  map.addControl(new maplibregl.ScaleControl(), 'bottom-left')
  map.on('load', () => { if (map) addVunguBasemap(map) })
  map.on('click', (e: maplibregl.MapMouseEvent) => { void selectPoint(e.lngLat.lng, e.lngLat.lat) })
}

async function selectPoint(lng: number, lat: number) {
  loading.value = true
  if (marker) marker.remove()
  if (map) marker = new maplibregl.Marker({ color: '#1d4ed8' }).setLngLat([lng, lat]).addTo(map)
  try {
    const res = await locateStand(lng, lat)
    await applyLocation(res)
  } catch {
    location.value = null
  } finally {
    loading.value = false
  }
}

// Exposed for tests + reused by selectPoint.
async function applyLocation(res: StandLocation) {
  location.value = res
}
defineExpose({ applyLocation })

function onSearchInput() {
  if (searchTimer) clearTimeout(searchTimer)
  searchTimer = setTimeout(async () => { results.value = await searchMap(query.value) }, 250)
}

function pickResult(r: SearchResult) {
  results.value = []
  query.value = r.label
  if (map) map.flyTo({ center: r.center, zoom: 15 })
  void selectPoint(r.center[0], r.center[1])
}

const canConfirm = () => Boolean(location.value?.in_jurisdiction && location.value?.stand)

function confirm() {
  if (location.value && canConfirm()) emit('select', location.value)
}

function close() { emit('close') }

watch(() => props.open, async (open) => {
  if (open) { await nextTick(); initMap(); map?.resize() }
})

onBeforeUnmount(() => { if (map) { map.remove(); map = undefined } })
</script>

<template>
  <div v-if="open" class="sp-backdrop" @click.self="close" @keydown.esc="close" tabindex="-1">
    <div class="sp-modal" role="dialog" aria-modal="true" aria-label="Select stand on map">
      <header class="sp-head">
        <h3><MapPin :size="15" /> Select stand on the map</h3>
        <button class="sp-x" @click="close" aria-label="Close"><X :size="16" /></button>
      </header>

      <div class="sp-search">
        <Search :size="14" />
        <input v-model="query" name="sp-search" placeholder="Search anywhere in Zimbabwe…"
               @input="onSearchInput" />
        <ul v-if="results.length" class="sp-results">
          <li v-for="(r, i) in results" :key="i" @click="pickResult(r)">
            <span class="sp-r-label">{{ r.label }}</span>
            <span v-if="r.subtitle" class="sp-r-sub">{{ r.subtitle }}</span>
          </li>
        </ul>
      </div>

      <div ref="mapEl" class="sp-map"></div>

      <footer class="sp-foot">
        <div class="sp-info">
          <div v-if="loading" class="sp-muted"><Loader2 :size="13" class="sp-spin" /> Looking up location…</div>

          <template v-else-if="location">
            <div v-if="location.in_jurisdiction && location.stand" class="sp-ok">
              <strong>{{ location.stand.stand_number }}</strong>
              <span class="sp-meta">
                Ward {{ location.stand.ward || '—' }} · {{ location.stand.district || '—' }}
                · {{ location.stand.area_ha != null ? location.stand.area_ha + ' ha' : 'area n/a' }}
              </span>
            </div>
            <div v-else-if="location.in_jurisdiction" class="sp-muted">
              No registered parcel here — click on a parcel.
            </div>
            <div v-else class="sp-err">
              <template v-if="location.district">
                This location is in {{ location.district }} district, outside Vungu RDC's
                jurisdiction. Vungu RDC cannot process applications here — contact the local
                authority responsible for {{ location.district }}.
              </template>
              <template v-else>
                This location is outside Vungu RDC's jurisdiction.
              </template>
            </div>
          </template>

          <div v-else class="sp-muted">Click a parcel on the map, or search above.</div>
        </div>

        <div class="sp-actions">
          <button class="sp-btn" @click="close">Cancel</button>
          <button class="sp-btn primary" data-test="confirm" :disabled="!canConfirm()" @click="confirm">
            Use this stand
          </button>
        </div>
      </footer>
    </div>
  </div>
</template>

<style scoped>
.sp-backdrop { position: fixed; inset: 0; background: rgba(15,23,42,0.55);
  display: flex; align-items: center; justify-content: center; z-index: 1000; padding: 1.5rem; }
.sp-modal { width: min(960px, 96vw); height: min(720px, 92vh); background: #fff;
  border-radius: 0.75rem; display: flex; flex-direction: column; overflow: hidden;
  box-shadow: 0 20px 60px rgba(0,0,0,0.35); }
.sp-head { display: flex; align-items: center; justify-content: space-between;
  padding: 0.75rem 1rem; border-bottom: 1px solid #e2e8f0; }
.sp-head h3 { margin: 0; font-size: 0.95rem; font-weight: 700; display: inline-flex;
  align-items: center; gap: 0.4rem; }
.sp-x { border: none; background: transparent; cursor: pointer; color: #64748b; }
.sp-search { position: relative; display: flex; align-items: center; gap: 0.4rem;
  margin: 0.6rem 1rem; padding: 0.4rem 0.6rem; border: 1px solid #e2e8f0; border-radius: 0.4rem; }
.sp-search input { border: none; outline: none; flex: 1; font-size: 0.8rem; background: transparent; }
.sp-results { position: absolute; top: 100%; left: 0; right: 0; margin: 0.2rem 0 0;
  padding: 0; list-style: none; background: #fff; border: 1px solid #e2e8f0;
  border-radius: 0.4rem; max-height: 240px; overflow: auto; z-index: 5;
  box-shadow: 0 8px 24px rgba(0,0,0,0.12); }
.sp-results li { padding: 0.45rem 0.7rem; cursor: pointer; display: flex; flex-direction: column; }
.sp-results li:hover { background: #f1f5f9; }
.sp-r-label { font-size: 0.8rem; color: #0f172a; }
.sp-r-sub { font-size: 0.68rem; color: #94a3b8; }
.sp-map { flex: 1; min-height: 0; }
.sp-foot { display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 0.75rem 1rem; border-top: 1px solid #e2e8f0; }
.sp-info { flex: 1; min-width: 0; font-size: 0.8rem; }
.sp-ok strong { font-size: 0.85rem; }
.sp-meta { color: #64748b; margin-left: 0.5rem; }
.sp-muted { color: #94a3b8; display: inline-flex; align-items: center; gap: 0.35rem; }
.sp-err { color: #b91c1c; line-height: 1.35; }
.sp-actions { display: flex; gap: 0.5rem; flex-shrink: 0; }
.sp-btn { font-size: 0.78rem; padding: 0.4rem 0.7rem; border: 1px solid #e2e8f0;
  border-radius: 0.4rem; background: #fff; color: #475569; cursor: pointer; }
.sp-btn.primary { background: #1d4ed8; border-color: #1d4ed8; color: #fff; font-weight: 700; }
.sp-btn.primary:disabled { opacity: 0.5; cursor: not-allowed; }
.sp-spin { animation: spspin 0.8s linear infinite; }
@keyframes spspin { to { transform: rotate(360deg); } }
</style>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/__tests__/StandPickerModal.spec.ts`
Expected: PASS — 2 tests green.

- [ ] **Step 5: Commit**

```bash
git add src/components/StandPickerModal.vue src/components/__tests__/StandPickerModal.spec.ts
git commit -m "feat(planner): add StandPickerModal map picker with jurisdiction guard"
```

---

## Task 6: Frontend — wire the picker into Step 1 Intake

**Files:**
- Modify: `src/views/planner/Step1Intake.vue` (script + the Stand-no field + Property fieldset)
- Test: `src/views/planner/__tests__/Step1Intake.standpicker.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/views/planner/__tests__/Step1Intake.standpicker.spec.ts`:

```ts
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'

vi.mock('@/composables/usePlannerCase', () => ({
  usePlannerCase: () => ({
    current: { value: null },
    registerNew: vi.fn(), loadFromPermit: vi.fn(), syncPending: vi.fn(),
  }),
}))
vi.mock('@/composables/useUiFeedback', () => ({
  useUiFeedback: () => ({ showToast: vi.fn(), parseApiError: () => '', openMessageBox: vi.fn() }),
}))
vi.mock('@/services/developmentManagementService', () => ({
  dmApi: { listPermits: vi.fn().mockResolvedValue([]) },
}))

import Step1Intake from '../Step1Intake.vue'

describe('Step1Intake stand picker', () => {
  it('maps a selected stand bundle into the form fields', async () => {
    const w = mount(Step1Intake, {
      global: { stubs: { StandPickerModal: true, UiFeedback: true, FieldError: true } },
    })
    ;(w.vm as any).applyStandSelection({
      in_jurisdiction: true, district: 'Gweru', authority: null,
      stand: { fid: 4, stand_number: 'Communal Land', province: 'Midlands', area_ha: 12.3,
        centroid: [29.39, -19.29], ward: '6', district: 'Gweru',
        description: 'Parcel Communal Land, Gweru — 12.3 ha' },
    })
    const vm = w.vm as any
    expect(vm.form.standNo).toBe('Communal Land')
    expect(vm.form.ward).toBe('6')
    expect(vm.form.propertyDescription).toBe('Parcel Communal Land, Gweru — 12.3 ha')
    expect(vm.selectedParcelArea).toBe(12.3)
    expect(vm.selectedCentroid).toEqual([29.39, -19.29])
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/views/planner/__tests__/Step1Intake.standpicker.spec.ts`
Expected: FAIL — `applyStandSelection` is not a function.

- [ ] **Step 3: Add imports + state + handler to the script**

In `src/views/planner/Step1Intake.vue` `<script setup>`, add to the imports (the existing line 8 `import { Search, FilePlus2, FileText, RefreshCw } from 'lucide-vue-next'` — add `MapPin`):

```ts
import { Search, FilePlus2, FileText, RefreshCw, MapPin } from 'lucide-vue-next'
import StandPickerModal from '@/components/StandPickerModal.vue'
import type { StandLocation } from '@/services/parcels'
```

After the `form` ref declaration (the `const form = ref({ ... })` block), add:

```ts
const pickerOpen = ref(false)
const selectedParcelArea = ref<number | null>(null)
const selectedCentroid = ref<[number, number] | null>(null)

// Map a derived bundle onto the form. One mapping line per field — adding a
// future derived field (e.g. title deed) is a one-line change here.
function applyStandSelection(loc: StandLocation) {
  const s = loc.stand
  if (!s) return
  form.value.standNo = s.stand_number
  if (s.ward) form.value.ward = s.ward
  if (s.description) form.value.propertyDescription = s.description
  selectedParcelArea.value = s.area_ha
  selectedCentroid.value = s.centroid
  pickerOpen.value = false
}

defineExpose({ form, selectedParcelArea, selectedCentroid, applyStandSelection })
```

- [ ] **Step 4: Add the icon to the Stand-no field + the modal + area display**

In the template, replace the Property fieldset's Stand-no label (currently
`<label>Stand no. *<input name="s1-stand-no" v-model="form.standNo" :class="{ err: errors.standNo }" /></label>`) with:

```vue
            <label class="s1-stand">Stand no. *
              <span class="s1-stand-field">
                <input name="s1-stand-no" v-model="form.standNo" :class="{ err: errors.standNo }" />
                <button type="button" class="s1-pin" aria-label="Pick stand on map"
                        @click="pickerOpen = true"><MapPin :size="14" /></button>
              </span>
            </label>
```

Add a read-only parcel-area line right after the Title-deed label
(`<label class="rf-wide">Title deed no.<input name="s1-title-deed-no" v-model="form.titleDeedNo" /></label>`):

```vue
            <label v-if="selectedParcelArea != null" class="rf-wide">Parcel area
              <input :value="selectedParcelArea + ' ha'" readonly name="s1-parcel-area" />
            </label>
```

Add the modal at the end of the template, just before the closing `</template>`
(alongside the existing `<UiFeedback … />` if present):

```vue
    <StandPickerModal :open="pickerOpen" @close="pickerOpen = false" @select="applyStandSelection" />
```

Append scoped styles to the `<style scoped>` block:

```css
.s1-stand-field { display: flex; align-items: stretch; }
.s1-stand-field input { flex: 1; }
.s1-pin { display: inline-flex; align-items: center; justify-content: center;
  width: 1.9rem; margin-left: -1px; border: 1px solid #cbd5e1; border-left: none;
  border-radius: 0 0.3rem 0.3rem 0; background: #f8fafc; color: #1d4ed8; cursor: pointer; }
.s1-pin:hover { background: #eff6ff; }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/views/planner/__tests__/Step1Intake.standpicker.spec.ts`
Expected: PASS.

- [ ] **Step 6: Manual browser check (golden + jurisdiction paths)**

With backend + frontend running, log in as the demo planner, open
`/planner-workspace` → Statutory Workflow → Register new application. Click the
map-pin in the Stand-no field. In the modal: search "communal" → pick the result,
or click a parcel inside Vungu. Confirm the derived strip shows the stand + ward +
area and "Use this stand" fills Stand no / Ward / Description and shows Parcel area.
Then click a point in Harare → confirm the message names "Harare" and "Use this
stand" is disabled.

- [ ] **Step 7: Commit**

```bash
git add src/views/planner/Step1Intake.vue src/views/planner/__tests__/Step1Intake.standpicker.spec.ts
git commit -m "feat(planner): map-pin stand picker on intake form with auto-derived fields"
```

---

## Final verification

- [ ] Backend tests: `cd ../app-backend && npx jest src/routes/__tests__/parcels.locate.test.js` → PASS
- [ ] Frontend tests: `npx vitest run src/services/__tests__/parcels.spec.ts src/components/__tests__/StandPickerModal.spec.ts src/views/planner/__tests__/Step1Intake.standpicker.spec.ts` → PASS
- [ ] Type check (no new errors in touched files): `npx vue-tsc --noEmit 2>&1 | grep -E "parcels.ts|StandPickerModal|Step1Intake|usePlannerCase" || echo clean`
- [ ] Manual golden + out-of-jurisdiction paths verified in the browser (Task 6 Step 6).
