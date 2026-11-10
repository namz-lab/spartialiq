# ADR 0007 — `dxf-parser` for the QGIS/AutoCAD subdivision round-trip

Status: Accepted · Owner: `gis-eos-architect`

## Context
Planners could already export a subdivision as DXF (`frontend/src/map/tools/dxfExport.ts`,
hand-rolled writer, no dependency) so it could be opened in QGIS/AutoCAD/Civil3D/Bricscad. There
was no way back — nothing read an edited DXF into the app. Building the reverse direction means
parsing real-world DXF: not just the legacy `POLYLINE`/`VERTEX`/`SEQEND` this app's own exporter
writes, but `LWPOLYLINE` (the modern default AutoCAD and QGIS's DXF writer both use on save),
including group-code parsing, entity/layer/table sections, and enough of the DXF spec to be
robust against a file a *different* CAD/GIS tool produced — not just our own output.

## Decision
Add `dxf-parser` (frontend dependency, `frontend/src/map/tools/dxfImport.ts` is the only caller)
rather than hand-rolling a reader. Hand-rolling was considered and rejected: a reader that only
covers our own exporter's exact output would silently break the moment a planner actually edited
the file in AutoCAD or QGIS and saved — which is the entire point of this feature. `dxf-parser` is
a small, dependency-light, TypeScript-typed library with no native/binary requirements (pure JS,
browser-safe), verified against both this app's own exporter output and a hand-built
`LWPOLYLINE` fixture simulating a real AutoCAD/QGIS re-save
(`frontend/src/map/tools/__tests__/dxfImport.spec.ts`).

Explicitly rejected for this pass: shelling out to `ogr2ogr`/GDAL for GeoPackage read/write —
confirmed not installed in production (`backend/Dockerfile` is plain `node:20-alpine`, no GDAL;
the production host at the time used a plain Node buildpack). DXF alone covers both QGIS and AutoCAD
since QGIS reads/writes DXF natively via its OGR driver — one format, one parser, no server-side
dependency at all (parsing happens entirely client-side, matching how export already works).

## Consequences
- New frontend dependency, `dxf-parser` (see `package.json`). No backend changes, no new
  endpoint, no new migration — the parsed result feeds the same `PlanningProject` shape and save
  path the web CAD tool already uses (`usePlanningTools.ts` `importDxf()`).
- Only DXF is supported for the round-trip. Native GeoPackage and a live QGIS-plugin sync for
  planning projects specifically remain future work (see `docs/QGIS_WEB_INTEGRATION.md`) —
  revisit if/when GDAL becomes available server-side.
- Real binary DWG stays out of scope (needs the proprietary ODA/Teigha SDK); DXF is the universal
  interchange format every relevant tool already reads and writes.
