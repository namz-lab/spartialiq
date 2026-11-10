# Building Inspector GIS — implementation record

Design: [`../specs/2026-09-13-inspector-gis-design.md`](../specs/2026-09-13-inspector-gis-design.md)
ADRs: [0010 site resolution and precision](../../adr/0010-inspector-site-resolution-and-precision.md) ·
[0011 MapLibre handles use shallowRef](../../adr/0011-maplibre-map-handles-use-shallowref.md)

## Backend (`../app-backend`)

| Task | Landed in |
|---|---|
| Reconstruct the undocumented queue view + assignment columns | `migrations/116_inspector_work_queue.sql` |
| Reconstruct the field-event log | `migrations/117_stage_inspection_field_events.sql` |
| Site-position provenance, frozen geofence columns, normalised name indexes | `migrations/118_inspector_site_geometry.sql` |
| Site resolution, site report, identify, geofence, evidence geo-verification | `src/services/inspectorSpatial.js` |
| Endpoints + authorisation + audited position write | `src/routes/inspector-gis.js` |
| Fix mixed-SRID failure in `/parcels/nearby` | `src/routes/parcels.js` |
| Share the EMA setback figure instead of copying it | `src/services/planningSpatial.js` (exports `STREAM_BUFFER_M`) |
| 29 tests: geofence rules, resolution precedence, route contract | `src/routes/__tests__/inspector-gis.test.js` |

Registered in `server.js` and `test/helpers/buildApp.js`.

## Frontend

| Task | Landed in |
|---|---|
| Typed client | `src/services/inspectorGis.ts` |
| Wording, map status classes, run ordering (pure + tested) | `src/inspector/siteGeo.ts` |
| Sites from the server, with precision | `src/composables/useInspectorSites.ts` |
| Site map pane rebuilt on `--ent-*` tokens | `src/views/BuildingInspectorView.vue` |
| Site checks panel | `src/components/inspector/InspectorSiteReport.vue` |
| Identify card | `src/components/inspector/InspectorIdentifyCard.vue` |
| Record/correct site position | `src/components/inspector/InspectorSiteLocationSheet.vue` |
| Attendance + photo geofence, in the stage console | `src/components/inspector/InspectionGeoVerification.vue` |
| `tool-change` emit so identify yields to measure/radius | `src/components/map/MapToolbar.vue` |

## What the rewrite deleted

The old map pane's fabricated schedule (`index × 2 days`), the permanently empty inbox,
"Quick stats" that counted the selected permit's stages while labelled as district totals,
the five hardcoded ward centroids, the duplicate photo/flag modals (the stage console owns
them), and 282 hardcoded hex colours.

## Verification (2026-09-14)

- `npm run type-check` — clean (was one TS2589; see ADR 0011).
- `npx vitest run --no-file-parallelism` — 92 files, 612 passed, 1 skipped.
- backend `npx jest` — 19 suites, 100 passed.
- `npx eslint src` — 3 errors, all pre-existing and outside inspector code.
- `npm run build` — succeeds.
- Browser pass at 1440×900 and 390×780: site list, selection, site report, identify,
  record-position (map pick, saved and re-resolved), mobile sheets.

## Known environment issue (not code)

The local `Vungu_spatial333` database has catalog corruption — `invalid page in block 121
of relation base/18570/2608` (`pg_depend`), and `inspection_bookings` block 0. Migration 116
cannot be applied locally because `CREATE OR REPLACE VIEW` must delete dependency rows; its
view body was verified instead by comparing columns, types and row counts against the live
view. A fresh database applies all three migrations normally.
