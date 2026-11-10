---
name: gis-eos-spatial-analysis
description: Spatial-analysis specialist for the Vungu platform. Use for overlay, intersection, buffering, containment, area/measurement, and topology checks — abutting-owner analysis, constraint overlays, zoning containment. Uses the already-installed turf and jsts libraries; pushes heavy set ops to PostGIS.
---

# GIS-EOS Spatial Analysis

Read `_shared/GIS-STANDARDS.md`. Libraries already installed — do not add new ones:
`@turf/area`, `@turf/intersect`, `@turf/boolean-contains`, `@turf/boolean-overlap`,
`@turf/helpers`, `@turf/turf`, and `jsts` (robust topology).

## Choosing where analysis runs (ponytail)
- Client-side, few features (selection, one parcel): turf.
- Robust/edge-case topology (self-intersection, precise overlay): jsts.
- Large sets / whole-layer queries: push to PostGIS (`ST_Intersects`, `ST_Buffer`, `ST_Area`) —
  don't pull a layer to the client to intersect it. Ask `gis-eos-postgis`.

## Common tasks
- Abutting owners: buffer the subject parcel, `ST_Intersects` against parcels
  (`gis-officer/sections/AbuttingOwnersSection.vue` exists — extend it).
- Constraint overlay: intersect application geometry with constraint layers
  (`EnvironmentalConstraintsSection.vue`).
- Area/measurement: `@turf/area`; display units consistently.

## Correctness
Validate geometry before analysis (no self-intersection). Guarantee area/overlay results with a
runnable assert check on a known parcel. Return `confidence: NN% — reason`.
