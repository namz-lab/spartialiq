# SpartialIQ — Running System & AutoCAD Feature

_Started 2026-08-12 from the current working tree (latest updates)._

## What's running

| Tier | Address | Status |
|------|---------|--------|
| PostgreSQL 18 (Scoop) | `localhost:5432` — db `vungu_master_db_v1` | up |
| Backend (Fastify) | http://localhost:3000 — `/health` → `spartialiq-backend v2.0.0` | up |
| Frontend (Vite 7) | http://localhost:5174 | up (HTTP 200) |

**Demo logins** (password `demo1234`): `demo.admin`, `demo.planner`, `demo.eo`, `demo.surveyor`, `demo.inspector`, `demo.clerk`, `demo.gis` — all `@vungu.test`. Pick a council on the welcome screen first.

## The AutoCAD feature — subdivision round-trip via DXF

The planner can take a subdivision out to AutoCAD (or Civil3D / Bricscad / QGIS), edit it there, and bring it back — no server-side GDAL, all client-side.

**Export → edit → re-import**

1. **Export** — a planning project is written to `.dxf` by a dependency-free writer (`frontend/src/map/tools/dxfExport.ts`). Layers:
   - `LOTS` — closed lot polygons
   - `ROADS` — centre-line polylines
   - `PARCEL-AREAS` — labels carrying a hidden `#<roundTripId>` token per lot
2. **Edit externally** — open in AutoCAD/QGIS, move beacons, resplit lots, save. QGIS reads/writes DXF natively via OGR, so one format covers both worlds.
3. **Re-import** — `frontend/src/map/tools/dxfImport.ts` parses the (possibly third-party-resaved) DXF with `dxf-parser`, re-projects with `proj4`, and reconciles each lot back to the project. The `#<roundTripId>` token is the exact match key; `Lot <n>` is a lower-confidence fallback. Wired into the Planning Studio via `usePlanningTools.ts → importDxf()` / `PlanningPanel.vue`.

**Why DXF only:** DWG needs the proprietary ODA SDK, and GDAL/GeoPackage isn't available in production (plain `node:20-alpine`). DXF is the universal interchange format every relevant CAD/GIS tool already reads and writes. Design rationale: `frontend/docs/adr/0007-dxf-parser-for-cad-roundtrip-import.md`.

**Related:** the Surveyor cadastral module also emits AutoCAD-compatible survey-plan DXF (SI 727 beacons, schedules, blocks) via `backend/src/survey/services/dxfGenerator.js` and its helpers.

## Restarting

```bash
# Postgres (if down)
pg_ctl start -D "C:\Users\munya\scoop\apps\postgresql\current\data" -w
# Backend
cd backend && npm run dev      # :3000
# Frontend
cd frontend && npm run dev     # :5174
```

_Non-fatal boot noise (safe to ignore): `QGIS project not found`, OpenFreeMap glyph 404s._
