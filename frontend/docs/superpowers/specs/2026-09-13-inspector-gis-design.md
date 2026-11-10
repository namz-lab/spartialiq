# Building Inspector GIS — design and contract

Date: 2026-09-13. Scope: the site-map pane of `/inspector-workspace` and the
spatial checks behind the stage-inspection console.

## Why

An audit of the inspector workspace on 2026-09-13 found the map pane did no
spatial work:

- `0 of 8` permits in the local register carry a `location`, so the map drew no
  sites at all. Permit stand numbers ("Somabula", "Communal Land") do not match
  the Stands Register either, and nothing tried the cadastre.
- Sites without coordinates were flown to hardcoded ward centroids.
- The sidebar "Schedule" invented dates (`index × 2 days`), the inbox was always
  empty, and "Quick stats" counted the selected permit's stages, not the district.
- The console records arrival GPS through `POST /stage-inspections/:id/field-events`,
  which does not exist in the backend. Arrival evidence was never saved.
- `GET /api/parcels/nearby` fails on the local database with a mixed-SRID error
  (OSM layers are SRID 900914, the query point was 4326).
- `v_inspector_queue`, `stage_inspection_field_event` and
  `stage_inspection.assigned_at/by` exist in the database but have no migration.

## What a building inspector asks of the map

| Question | Query |
|---|---|
| Where is this site, and how sure are we? | Site resolution with an explicit precision |
| Am I standing on it? | Server-side geofence of the arrival fix and photo geotags |
| What is at this spot? (possible unauthorised work) | Identify: stand, parcel, zone, mapped structure, linked cases |
| Is the use allowed here? | Zone overlay + zone land-use controls |
| Is it too close to something protected? | Watercourse 30 m, water body, protected area, rough terrain, cemetery, waste site, railway, major road |
| How much of the stand is built? | Mapped building footprints inside the stand vs approved plinth area |
| Who adjoins it? | Adjoining stands or parcels with shared boundary length |
| What else is happening nearby? | Permits and enforcement orders within 250 m |
| Measure a setback on the map | Existing `MapToolbar` measure tool |
| Plan a day's run | Nearest-neighbour ordering of open inspections from the inspector's position |
| The permit has no position | Record the site position from a GPS fix at the pegs, or a map pick, with audit |

## Site resolution (server, one SQL fragment)

Precedence, first hit wins:

1. `permit_application.location` inside a Stands Register polygon → that polygon.
2. Stands Register polygon matched by stand number (unique, or unique within the
   recorded ward; within 100 m of the permit point when one exists).
3. Cadastre parcel (`vungu_parcels`) containing the permit point, or matched by
   name, **only when the parcel is at most 5 ha**. Larger parcels are farms or
   communal land and cannot bound a building site.
4. Permit point alone.
5. A large cadastral area alone (display only).

Precision is reported, never implied:

| precision | meaning | geofence |
|---|---|---|
| `boundary` | a stand-sized polygon is known | distance to polygon |
| `point` | only a position is known | distance to point, wider tolerance |
| `area` | only a farm/communal area is known | `unverifiable` |
| `none` | nothing resolves | `unverifiable` |

## Geofence rule

`on_site` when `distance ≤ tolerance + min(accuracy, 50 m)`; tolerance 30 m for a
boundary, 75 m for a point. Computed by the server at write time and stored on the
field event, so a later correction of the site does not rewrite attendance history.

## Constraint basis

Only the 30 m watercourse setback is treated as statutory (EMA stream-bank
protection, the figure already used by `planningSpatial.js`). Every other distance
is a **council review distance**, labelled as such, and yields `review`, not a
breach. Intersecting a water body or protected area yields `conflict`.

Building footprints come from OpenStreetMap and may be out of date; the report says
so. A missing layer yields `no_data`, not `clear`.

## Contract

All routes under `/api`. Staff roles unless stated. Errors use the existing
`{ success:false, error, message? }` shape.

- `GET /inspector/sites?scope=inspectable|all` →
  `{ points: FeatureCollection<Point>, boundaries: FeatureCollection<Polygon>, enforcement: FeatureCollection<Point>, unlocated: number }`.
  Point properties: `permitId, ref, title, stand, ward, applicant, developmentType,
  permitStatus, hasOccupationCertificate, precision, source, lastStage, lastResult,
  scheduledAt, openEnforcement`.
- `GET /inspector/permits/:id/site-report` → `site, jurisdiction, zoning,
  constraints[], access, structures, neighbours[], nearbyCases, limitations[]`.
- `GET /inspector/identify?lng&lat` → `jurisdiction, stand, parcel, zone, building,
  cases[], enforcement[], assessment`.
- `GET|POST /stage-inspections/:sid/field-events` — POST by `building_inspector`
  or `admin`; an inspector may not log against an inspection assigned to someone
  else. POST response carries `site_distance_m, geofence_result, site_precision`.
- `GET /stage-inspections/:sid/geo-verification` → arrival and per-photo distances
  with a summary verdict `consistent | discrepancy | insufficient | unverifiable`.
- `PUT /permit-applications/:id/site-location` — `building_inspector`,
  `gis_officer`, `planner`, `admin`. Body `{ lng, lat, source: 'field_gps'|'map_pick',
  accuracy_m?, reason }`. Rejects points outside the council boundary and GPS fixes
  worse than 25 m. Writes provenance columns, bumps `revision`, logs `permit_event`
  `site_location_set` with the previous position.

## Migrations

- `116_inspector_work_queue.sql` — reconstructs the queue view and assignment columns.
- `117_stage_inspection_field_events.sql` — reconstructs the field-event log.
- `118_inspector_site_geometry.sql` — location provenance, geofence columns,
  normalised stand/parcel name indexes.

## Frontend

- `src/services/inspectorGis.ts` — typed client.
- `src/inspector/siteGeo.ts` — pure helpers (precision copy, run ordering, verdict copy).
- `useInspectorSites` reads `/inspector/sites`.
- `BuildingInspectorView.vue` rebuilt on `--ent-*` tokens: GeoJSON site layers,
  identify-on-click, site report panel, `MapToolbar`, locate-me, run planner,
  set-site-position sheet. Workflow actions stay in the console pane.
- `InspectionGeoVerification.vue` in the stage console shows the arrival and photo
  geofence results.

## Known gap — nobody can assign a stage inspection

`stage_inspection.inspector_id` / `assigned_at` / `assigned_by` exist, the queue view
exposes them, and `POST /stage-inspections/:sid/field-events` refuses to log attendance
against another inspector's assignment (`not_assigned`). But **no route writes them**: the
client had a `dmApi.assignStageInspection()` stub pointing at
`POST /stage-inspections/:id/assign`, which never existed and had no caller. The stub was
deleted rather than left as a 404 waiting to happen (same for `dmApi.resolveBooking`).

So today an inspection is only ever unassigned, and the ownership check can only fire on
data set outside the app. Closing this needs a decision first — who may assign (a
supervisor, or an inspector self-claiming from the queue?), and whether reassignment is
allowed once a stage is under way — so it is deliberately not built here.

## Out of scope

Road-network routing (no routable graph; run legs are straight-line and labelled),
DEM/slope (no elevation layer), building-line distances per road class (no sourced
table — shown as review distances).
