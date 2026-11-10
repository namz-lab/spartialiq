# Backend fixes needed for the planner workspace

Found on 26 Sept 2026 while testing every planner screen in a real browser (demo planner account, local backend on :3000, database `Vungu_spatial334`). The frontend now handles each of these problems without breaking, but each one limits what a planner can do until the backend is fixed.

Ordered by impact on a planner's day.

## 1. The ward list is empty in the browser (restart needed)

`GET /api/wards` returns `200` with an **empty gzip body** (`content-length: 0`) whenever the client sends `Accept-Encoding: gzip`, which every browser does. curl without compression gets the data, so it looks fine from the command line.

- Fix: already in `src/routes/tiles.js` (the `return reply…send()` change, uncommitted, edited 26 Sept 08:33). The running server started on 25 Sept, before that edit.
- Action: commit the change and restart the backend.
- Worth a sweep: any other async route that calls `reply.send()` without `return` has the same empty-body bug under `@fastify/compress`.

## 2. "Evaluate planning rules" fails for every case

`POST /api/planning-assistant/suggest` returns `500 {"error":"internal"}`.

- Cause: `suggestPlan()` in `src/services/planningAssistant.js` queries `lug.id`, and that column does not exist in the database (`column lug.id does not exist`, 42703).
- To reproduce: `POST /api/planning-assistant/suggest {"lng":29.741,"lat":-19.5256}`.
- Fix: align the SQL with the actual land-use-group table (or add the missing migration).

## 3. QGIS style endpoint is slow, and bursts stall the whole API

`GET /api/ogc/api/styles/:layer` takes about 1.2 s per call. It tries QGIS Server first (`QGIS_SERVER_TIMEOUT=30000`, `MAX_RETRIES=3`) and only then parses `vungu-project.qgs`. When about 20 of these arrived together, every endpoint, including `/api/health`, stopped answering for about 90 seconds.

- The frontend now sends these one at a time and only when a layer is switched on. That is a workaround, not the fix.
- Fix: while `/ogc/health` reports `degraded`, skip QGIS Server and read the project file directly; cache the parsed style per layer (invalidate on project-file change, as the watcher already does for other caches).
- Once fixed, the queue in `fetchQgisStyle()` (`src/map/qgisWmsOverlay.ts`) can go.

## 4. Style extractor drops the core of multi-layer line symbols

For `roads`, each class in QGIS is a white 6 px casing under a coloured core. The compiled `maplibreStyle` keeps only the first stroke, so every road class comes out `#ffffff`.

- The frontend now builds line paint from `symbols[].strokeLayers` (core over casing), so the planner map is correct.
- Other consumers of `maplibreStyle` still get white roads. Fix in the extractor: core = last stroke layer, casing = first.
- The extractor also drops the width unit (mm vs px). The frontend guesses (< 2 means mm); returning the unit would remove the guess.

## 5. `/api/parcels/find` does not search the stands register

`/api/map-search?q=4521` finds "Stand 4521", but `/api/parcels/find?q=4521` returns nothing. Cases lodged with only a stand number can therefore not be located automatically, and the planner has to pick the stand on a map before site analysis, planning rules or "Show on map" will run.

- Fix: include the stands register in `/parcels/find` (same result shape: `fid`, `stand_number`, `centroid`).

## 6. Register data: "Registered" files with no register number

Several applications have status `registered` but no `TPD/VUN/…` number, so the Permit Register shows "Unregistered" next to a Registered badge. Either the register-number assignment failed for those rows or the status was set without it.

- To reproduce: Permit Register, rows for "Survey Smoke" / "Citizen Smoke" dated 21 Sept 2026.
- Fix: find the code path that sets `registered` without assigning a number, and backfill the affected rows.

## 7. Layer registry: `geometry_type` is null

`GET /api/dynamic-layers/layers` returns `geometry_type: null` for all 11 layers. The planner map used to draw rivers and clinics as polygons because of this. It now reads the geometry from the data, but the registry should carry it.

## 8. QGIS project file (for the GIS officer, not code)

These are in `qgis-projects/vungu-project.qgs`. The web map follows the project, so these show on screen exactly as styled:

- `zimbabwe`: solid **black** fill. Switched on, it covers the map. It should be no fill with a grey outline.
- `gweru_rivers`: black 0.6 mm line. Standard notation is blue (for example `#1f5fa8`, "Blue 2").
- No layer has a title set, so the frontend derives names from table names ("Gweru Rivers"). Setting titles in the project would give proper names.
- QGIS Server itself (`localhost:8080`) is not running locally, so all project layers use the vector fallback rather than pixel-exact WMS.

## 9. Test data clutter

- Layouts: three layouts named "23" (88.01 ha, same date), one with 1439 stands and two with 0.
- Local case `TPD/VUN/2026/0901` ("Planner Smoke") now has a location (Somabula parcel). It was set while testing the new stand picker.
