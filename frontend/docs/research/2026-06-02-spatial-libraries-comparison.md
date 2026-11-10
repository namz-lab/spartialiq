# Spatial Libraries — A Comparison for Vungu RDC

**Date:** 2026-06-02
**Audience:** Anyone deciding whether to keep the current spatial stack or move parts of it.
**Status:** Reference document. Not a proposal; not a plan.

This is an honest comparison of the spatial libraries and data formats we could use for Vungu RDC's planning portal. The goal is to make the trade-offs explicit so a future decision is informed, not reflexive.

---

## Context — what we actually need to do

The portal renders maps for three audiences, each with different needs:

| Audience | What they do with the map | Volume on screen |
|---|---|---|
| Citizen — Map & Discover | Browse layers, find a stand, click parcels for info | 24 layers, country-wide pan, ~10 features visible at once |
| Planner — Stand picker / case file | Pick a parcel, see abutting owners, draw buffers, sign-off | 100s of parcels in council district + master-plan overlays |
| EO / inspector / GIS officer | Verify alignment, edit polygons, export PDFs | Small region, high precision, occasional drawing |

Underlying data sources:
- **PostGIS** — 41 spatial tables, biggest is `buildings` at 5.7 M rows / 1.8 GB
- **Vungu master-plan layers** — small (≤ 800 rows each), high editorial value
- **Statutory boundaries** — wards, districts, provinces; needed for jurisdiction checks

Current stack (as of 2026-06-02):
- **Backend**: Fastify + `@fastify/postgres` + PostGIS, serving MVT via `ST_AsMVT`
- **Frontend**: MapLibre GL JS, Vue 3 + Pinia for state
- **Wire format**: Mapbox Vector Tiles (MVT/PBF) for layers, GeoJSON for single-feature popups

---

## TL;DR — when to pick what

| Goal | Pick |
|---|---|
| **Slippy-map browsing of large layered datasets** | MapLibre GL JS (current) |
| **Country-shape analytics, choropleths, animated transitions** | D3.js + GeoJSON / TopoJSON |
| **Simple "marker + popup" maps with no styling fuss** | Leaflet |
| **Heavy GIS workflows: drawing tools, projection switching, WFS-T editing** | OpenLayers |
| **3D buildings + globe perspective** | CesiumJS or Deck.gl-on-MapLibre |
| **Custom WebGL data viz overlays on a basemap** | Deck.gl + MapLibre |
| **Browser-side geospatial analysis (buffers, intersections, distances)** | Turf.js |
| **Tile hosting from a database** | Martin or pg_tileserv (Postgres) or PMTiles (static) |

For our use case, the recommendation is at the end. Read on if you want the reasoning.

---

## Rendering libraries

These are the things that actually draw the map on screen.

### 1. MapLibre GL JS — **what we use today**

WebGL-based vector-tile renderer. Open-source fork of Mapbox GL JS v1.x, governed by the MapLibre Organization. Reads Mapbox Style Spec, consumes MVT.

**Strengths**
- GPU rendering — 60 fps at full country zoom on a laptop, even with 5 M buildings indexed at z16+
- Mapbox Style Spec is the de-facto industry standard for vector-tile styling
- Reads MVT directly — no client-side parsing of large GeoJSON
- Selective layer toggling: 24 vector sources, browser fetches only what's on screen
- Active community, ships ~3 minor versions per year
- BSD-3-Clause licensed, no commercial gate
- Deck.gl integration is a one-line layer add

**Weaknesses**
- WebGL boilerplate — debugging style expressions is harder than CSS
- The style spec is a JSON DSL, not JavaScript — limited dynamic logic
- Drawing/editing isn't built-in; needs `@mapbox/mapbox-gl-draw` (which works with MapLibre but feels grafted on)
- No WMS / WFS support without a plugin — bring-your-own protocols
- 3D support is limited to extrusions; no real 3D terrain without `terrain-rgb`
- Bundle size: ~250 KB gzipped just for the renderer

**Best for:** browsing big layered slippy maps. Exactly our citizen + planner browse use case.

### 2. Mapbox GL JS

Same renderer as MapLibre, but proprietary and tied to Mapbox's account-based billing past v1.13. The reason MapLibre exists.

**Strengths**
- Slightly more polished APIs in newer (v2+) versions
- First-party 3D terrain, atmospheric scattering, etc.

**Weaknesses**
- v2.0+ requires a Mapbox account and counts map loads against a free tier (50K/month)
- Vendor lock-in: Mapbox can change terms (and have, twice — that's how MapLibre forked)
- Production traffic from Zimbabwe still routes through Mapbox infrastructure, adding latency

**Best for:** projects that need Mapbox-only features (3D terrain) and can absorb metered billing. Not our case.

### 3. Leaflet

The original "easy maps for the web" library. DOM-based — markers and polygons are SVG / DivIcon elements, not GPU primitives.

**Strengths**
- Smallest learning curve in the entire ecosystem — `L.map('id').setView([lat, lon], 8)` and you're done
- Tiny bundle: ~40 KB gzipped
- Huge plugin ecosystem (Leaflet.draw, Leaflet.markercluster, etc.)
- WMS / WFS support out of the box via plugins
- Works on every browser back to IE 9 — relevant if your user base has very old devices

**Weaknesses**
- DOM rendering hits a wall around 1000–2000 visible features. Anything bigger needs clustering or canvas plugins
- Raster-tile first — vector-tile support is a third-party plugin (`vector-grid` / `leaflet.vectorgrid`) and feels bolted on
- No GPU acceleration → battery drain on mobile during pan/zoom
- Styling is per-feature JavaScript, not a declarative spec — gets unwieldy with many layers

**Best for:** small maps with few features, or where the data is already raster (orthophoto tiles). Not great for our 5.7 M buildings.

### 4. OpenLayers

Heavyweight library aimed at desktop-GIS-on-the-web. The choice if you've come from QGIS / ArcGIS.

**Strengths**
- The most comprehensive feature set: WMS, WFS (read + write), WMTS, KML, GML, GeoJSON, TopoJSON, MVT, GPX, IGC — all native
- Real projection support via Proj4js — re-project on the fly between any CRS pair
- First-class drawing / measuring / modifying tools — built in, not plugins
- Canvas + WebGL renderers; pick per layer
- BSD-2-Clause license

**Weaknesses**
- Steepest learning curve of the four main options. The API surface is huge and inconsistent (v6 → v7 → v8 broke things)
- Bundle is ~150 KB gzipped for a basic setup but balloons fast as you add features
- Styling API is verbose JavaScript (no JSON spec to share with designers)
- Vector-tile rendering exists but is slower than MapLibre for the same scene

**Best for:** GIS officers editing data, projection-heavy workflows, integration with GeoServer / MapServer. Could fit the GIS-officer view, overkill for citizen browsing.

### 5. D3.js — `d3-geo` + TopoJSON

Not a map library — a low-level visualization toolkit. The `d3-geo` module ships geographic projections; `topojson-client` decodes the format.

**Strengths**
- Total rendering control. Every shape is an SVG `<path>` you can transform, animate, gradient-fill
- Beautiful for analytic / explanatory views: choropleths, dot-density, animated transitions between states
- ~50 projections built in (Mercator, Albers, Robinson, equal-area variants)
- TopoJSON is genuinely efficient for full-country shape data: ~70 % smaller than equivalent GeoJSON because it deduplicates shared borders
- Pairs naturally with React / Vue via direct SVG render
- ~30 KB gzipped for `d3-geo` + `topojson-client`; you only pull what you use

**Weaknesses**
- SVG hits a performance wall around 5K–10K visible paths. 5.7 M buildings is 500–1000× too many — not even close
- No tile-loading model — you must fetch the *whole* dataset before rendering. A country-wide TopoJSON of Zimbabwe wards is ~1 MB; a country-wide TopoJSON of every building would be 200+ MB, unloadable
- No built-in pan/zoom — you write the math yourself (or use `d3-zoom`)
- No layered slippy-map model — every view is a single SVG
- Steep learning curve if you've never used D3

**Best for:** analytic dashboards, choropleths of statutory boundaries, animated transitions for "show the council district fill in", explanatory infographics. **Not for browsing 5.7 M buildings.**

### 6. CesiumJS

3D globe / virtual-Earth library. Renders the planet as a 3D ellipsoid with terrain and atmosphere.

**Strengths**
- True 3D — terrain, buildings as extruded prisms, sky / atmospheric effects, time-aware animation
- Excellent for "showing the council from above" demos
- Supports 3D Tiles (the OGC standard for streaming 3D building data)
- Apache 2.0 licensed

**Weaknesses**
- Huge bundle: ~1.2 MB gzipped just for the runtime
- Massive complexity for 2D use cases — overkill if you don't need 3D
- 2D mode exists but is worse than a dedicated 2D library at the same task
- Built-in basemaps are commercial (Cesium ion); using your own tiles requires more wiring than MapLibre
- Battery / data costs on mobile devices are noticeable

**Best for:** standalone 3D tours, drone-imagery viewers, urban-design presentations. Not a daily-driver for a municipal portal.

### 7. Deck.gl

WebGL data-visualization toolkit by Uber. Not a basemap library — it draws data *on top* of a basemap (usually MapLibre).

**Strengths**
- Massive scale: visibly handles 10 M+ points smoothly via GPU bucketing
- Layer types like HexagonLayer, ScatterplotLayer, ArcLayer, HeatmapLayer are first-class
- Pairs cleanly with MapLibre via `@deck.gl/mapbox` — Deck layers slot into MapLibre's layer stack
- Apache 2.0 licensed

**Weaknesses**
- It's a *visualization* tool, not a basemap. Always needs a base library underneath
- The API is React-flavored; the imperative API exists but is less polished
- For thematic / categorical layers (our current use), MapLibre's native fill / line layers are simpler

**Best for:** dashboards showing density of applications, heatmaps of citizen submissions per ward, animated flow lines. Pair with MapLibre, don't replace it.

---

## Analysis libraries (compute, not render)

These don't draw anything. They answer geometric questions in the browser so the backend doesn't have to.

### Turf.js

Geospatial swiss-army knife. ~150 functions: buffer, intersection, distance, contains, simplify, etc.

**Strengths**
- All client-side — no server round-trip for "is this point inside this polygon?"
- GeoJSON-native API — easy to compose with MapLibre data sources
- Modular — `import { buffer } from '@turf/buffer'` brings ~5 KB, not the whole library
- Useful for: stand-picker jurisdiction guard, "find abutting owners", distance-to-nearest, instant-feedback validation

**Weaknesses**
- Bigger workloads (e.g., "intersect 5 M buildings with this polygon") are slow vs PostGIS — wrong tool for that scale
- Some functions have edge cases at the antimeridian / poles. We don't go near those
- Updates infrequently — Turf 6 has been stable for years; some users see that as a feature, others as stagnation

**Best for:** small interactive geometry questions. We already use it for the planner stand-picker jurisdiction check.

### JSTS

JavaScript port of the JTS Topology Suite. Lower-level than Turf; more rigorous geometry operations.

**Strengths**
- Topologically correct operations even on degenerate input
- The reference implementation if you need OGC-spec compliance

**Weaknesses**
- ~200 KB gzipped — much heavier than Turf
- API is Java-port-shaped; less ergonomic

**Best for:** if you ever hit a Turf bug on weird geometry, fall back to JSTS. Otherwise stay with Turf.

### GeoBlaze

Raster analysis (DEMs, NDVI, land-cover) in the browser. We're not raster-driven, but worth knowing exists.

---

## Data formats

What the bytes look like on the wire and on disk.

### GeoJSON — `{type, features:[{geometry, properties}]}`

Text JSON, human-readable, the most-supported format in existence.

- **Strengths**: Anything reads it. Trivially diffable. Cmd-F in a text editor.
- **Weaknesses**: Verbose. No spatial indexing. No compression beyond gzip. A 1 MB GeoJSON of polygons becomes ~70 KB MVT for the same data at a single zoom.
- **Use for**: single-feature popups (1 KB), small editable layers (< 5 MB), exports for citizen download.

### TopoJSON — `{type, arcs, objects}`

GeoJSON's cousin. Deduplicates shared boundaries between polygons. The boundary between Ward 5 and Ward 6 is stored once and both wards reference it.

- **Strengths**: 50–80 % smaller than the equivalent GeoJSON for adjacent-polygon datasets. Excellent for choropleths.
- **Weaknesses**: Must decode (via `topojson-client.feature(...)`) before any other library can use it. Not a streaming format — load the whole file. Not understood by PostGIS, QGIS-as-a-server, MapLibre directly.
- **Use for**: shipping the country / districts / wards shape file to a D3 view. Pointless for buildings, roads, or any layer that doesn't share boundaries.

### MVT — Mapbox Vector Tiles (PBF)

Binary protobuf-encoded vector tiles. Each tile is one HTTP request, contains all features in a fixed (z, x, y) bounding box.

- **Strengths**: Viewport-scoped (only fetch what's on screen). GPU-friendly (MapLibre decodes straight into WebGL buffers). 5–50 KB per tile. CDN-cacheable. Industry standard since Mapbox open-sourced the spec.
- **Weaknesses**: Binary — can't grep. Tile boundaries can cause artifacts at feature borders. Requires server-side rendering (PostGIS does this via `ST_AsMVT`). Less useful for "give me one feature" lookups.
- **Use for**: anything you render at scale. **This is what we use.**

### PMTiles

Single-file tile archive. A `.pmtiles` file is essentially a static, indexed tile set that any HTTP server (or Cloudflare R2, or GitHub Release) can host with no server-side rendering at all.

- **Strengths**: No tile server — just a CDN. ~50 % smaller than MBTiles. Free hosting on R2 / S3. Range requests to fetch just the tile you need.
- **Weaknesses**: Static — to update the dataset you regenerate the whole file. No per-feature attribute changes without a regen. Less flexible than database-backed tiles.
- **Use for**: append-only basemap layers that change rarely (admin boundaries, roads). Could replace PostGIS-tile serving for stable layers, freeing the database to focus on the application data.

### GeoPackage (.gpkg)

SQLite container with spatial extensions. The format Vungu's source data arrived in.

- **Strengths**: Single file. Compressed. Reads anywhere (QGIS, ogr2ogr, GDAL). Excellent for transport / import.
- **Weaknesses**: Not a web format. Not queryable at scale without loading into a "real" DB first.
- **Use for**: import sources, archive backups. Already what we have (now off-repo).

### Shapefile (.shp / .dbf / .shx)

Legacy ESRI format. Two-file system, 2-GB max table size, ASCII-only field names. Avoid for new work.

### FlatGeobuf (.fgb)

Newer binary format: streamable, spatially indexed, GeoJSON-compatible after decoding. Designed to replace Shapefiles.

- **Strengths**: Stream-readable — fetch byte ranges by bounding box. ~30 % smaller than the equivalent GeoJSON. Reads in browser via `flatgeobuf` package.
- **Weaknesses**: Newer (2019+) and not yet ubiquitous. Less tooling than GeoJSON. Not natively understood by MapLibre.
- **Use for**: when you need a static dataset bigger than fits in memory but don't want to spin up a tile server. Could replace some of our seed files.

### WKT / WKB — Well-Known Text / Binary

PostGIS's internal geometry formats. Hex strings (WKB) or human-readable text (`POLYGON((30 -22, ...))`). Not for the wire — for SQL and debugging.

---

## Server-side tile services

How the tiles get produced.

### PostGIS + custom Fastify route — **what we have**

PostGIS does the work via `ST_AsMVT`. Our route in `src/routes/tiles.js` runs the SQL, returns the bytes.

- **Strengths**: Full SQL control over what's in each tile. Indexes (GiST) make tile queries fast. No extra moving parts to deploy. The same database that holds your application data also serves the map.
- **Weaknesses**: Wrote-it-yourself code to maintain. Doesn't auto-scale (one DB per region).
- **Best for**: us, today.

### Martin

Standalone tile server written in Rust by the MapLibre team. Points at a PostGIS DB and auto-discovers tables.

- **Strengths**: Zero code to write. Faster than handwritten Node routes (Rust + connection pooling). Built-in Redis caching. Function-based tile sources for dynamic styling.
- **Weaknesses**: Another process to run / monitor. Less flexible than custom SQL for special cases (low-zoom filters, computed columns).
- **When to consider**: when our hand-rolled `tiles.js` becomes a maintenance burden. Currently it's ~350 LOC — manageable.

### pg_tileserv (Crunchy Data)

Like Martin but in Go. Mature, easy deploy.

- **Strengths**: Auto-discovers tables and functions. Production-tested at scale (Crunchy runs it for paying customers).
- **Weaknesses**: Go runtime adds 20+ MB to the deploy. Similar tradeoffs to Martin.

### GeoServer

Java-based, the granddaddy of OGC services. Full WMS, WFS, WCS, WPS support.

- **Strengths**: Anything an OGC client can ask, GeoServer can answer. The standard for enterprise GIS.
- **Weaknesses**: JVM. ~500 MB resident. Complex configuration. Overkill for vector-tile serving unless you also need WFS-T editing or WPS analysis.

### QGIS Server

What we currently use as a *fallback* (mentioned in CLAUDE.md for some QGIS layers).

- **Strengths**: Reads QGIS project files directly — designers can style in QGIS Desktop and publish unchanged.
- **Weaknesses**: Tied to QGIS's release cycle. Performance is acceptable but not Martin-level.

### Tegola

Go-based tile server, simpler than Martin but Go-based.

### PMTiles via Cloudflare R2 / GitHub Releases

Skip the tile server entirely. Generate a `.pmtiles` file once, host it as a static asset. Discussed in the formats section.

---

## What Vungu RDC actually needs vs what we have

Side-by-side, per use case:

| Use case | What we use | Is it right? |
|---|---|---|
| Citizen Map & Discover (24 layers, country zoom) | MapLibre + PostGIS MVT | ✅ Yes |
| Planner stand-picker (parcels + jurisdiction check) | MapLibre + Turf.js | ✅ Yes |
| Click-to-inspect single feature (popup) | GeoJSON Feature endpoint | ✅ Yes |
| Citizen Payments / dashboard tables (not spatial) | Plain HTML, Pinia | ✅ Yes |
| Future: choropleth "applications per ward" | Not built. Could use MapLibre fill-opacity expression OR a D3 + TopoJSON view | Either; D3 is prettier, MapLibre is simpler |
| Future: 3D building extrusions on the planner stand-picker | MapLibre 3D extrusion `paint: {'fill-extrusion-height': …}` | ✅ MapLibre handles it |
| Future: animated flow / heatmap of submissions | Deck.gl-on-MapLibre | ➕ Worth adding when needed |
| Future: GIS-officer editing tools (draw boundaries) | Mapbox-gl-draw (works with MapLibre) or switch to OpenLayers | Decide when we get there |

The conclusion that keeps coming back: **MapLibre is the right call for browsing and styling. D3 is the right call for analytic dashboards. They're not competitors — they live at different altitudes.**

---

## Migration costs — if you wanted to switch

Honest estimates of what it costs to swap one for another, in days of one engineer:

| Switch | Cost | Risk |
|---|---|---|
| MapLibre → Leaflet | 5–8 days | High — lose vector-tile rendering, must downgrade to raster or add a vector-grid plugin |
| MapLibre → OpenLayers | 8–14 days | High — different style API, different events, different layer model |
| MapLibre → D3 for everything | 20+ days | Very high — D3 can't handle the scale. We'd have to ship pre-aggregated data and accept slower interaction |
| MapLibre + add D3 for one dashboard | 2–4 days | Low — D3 lives in its own component, MapLibre untouched |
| MapLibre + add Deck.gl for one heatmap | 1–2 days | Low — Deck.gl integrates cleanly |
| MVT → TopoJSON for everything | 30+ days | Very high — must regenerate all data, abandon viewport-scoped loading, accept worse mobile performance |
| Add PMTiles for admin boundaries | 3–5 days | Low — additive, can be done per-layer |
| PostGIS tile route → Martin | 2–4 days | Low — same data source, different runtime |
| PostGIS → GeoServer | 15–20 days | Medium — gain WFS support, lose simplicity |

---

## Final take

For a municipal planning portal with our scale and use cases:

1. **Stay with MapLibre GL JS for rendering.** No competitor handles 5.7 M buildings + 24 layers at 60 fps on mid-range hardware. The bundle cost (~250 KB) is worth it.
2. **Stay with PostGIS + `ST_AsMVT` for tile generation.** The hand-rolled Fastify route is small enough to maintain. Consider Martin only if the route grows past ~600 LOC of complexity.
3. **Add D3 + TopoJSON when (and only when) we build analytic dashboards** — choropleths of "applications per ward", "approval rate by development type", "fee revenue by quarter". Use it as a complement to MapLibre, never a replacement.
4. **Keep Turf.js for client-side geometry questions.** Already used; works.
5. **Reserve Deck.gl for high-scale dashboard overlays** (density heatmaps, animated flows). Not needed yet.
6. **Don't move to TopoJSON for the basemap.** TopoJSON's compression savings are wiped out by the inability to do viewport-scoped loading. MVT remains the right answer at this scale.
7. **Don't add Cesium / 3D globe.** No requirement from the council surface ever asks for it. The bundle cost would dwarf the entire current frontend.
8. **Watch PMTiles.** Within 1–2 years it may be worth migrating the admin-boundary layers (country / provinces / districts / wards — stable, rarely change) to a static `.pmtiles` file hosted on Cloudflare R2 for $0/mo, freeing PostGIS for application data only.

The current stack — MapLibre + PostGIS + MVT + Turf — is the right composition. It's a battle-tested choice that matches our scale. The valid expansion path is **add** D3 (for analytics) and Deck.gl (for scale-out viz), not replace what works.

---

## References

- [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)
- [Mapbox Vector Tile spec](https://github.com/mapbox/vector-tile-spec)
- [D3 geo module](https://d3js.org/d3-geo)
- [TopoJSON spec](https://github.com/topojson/topojson-specification)
- [Turf.js](https://turfjs.org/)
- [Deck.gl](https://deck.gl/)
- [Leaflet](https://leafletjs.com/)
- [OpenLayers](https://openlayers.org/)
- [CesiumJS](https://cesium.com/platform/cesiumjs/)
- [PMTiles spec](https://github.com/protomaps/PMTiles)
- [Martin tile server](https://github.com/maplibre/martin)
- [pg_tileserv](https://github.com/CrunchyData/pg_tileserv)
- [PostGIS `ST_AsMVT`](https://postgis.net/docs/ST_AsMVT.html)
