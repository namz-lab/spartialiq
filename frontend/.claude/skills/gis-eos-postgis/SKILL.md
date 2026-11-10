---
name: gis-eos-postgis
description: PostGIS specialist for the Vungu spatial backend. Use for spatial SQL — ST_AsMVT tile queries, spatial predicates/joins, GiST indexing, SRID handling, and tile query performance against the 24-layer registry. Ensures every geom query is indexed and bounded.
---

# GIS-EOS PostGIS

Spatial SQL against `Vungu_spatial333` (24 layers + app tables). Read `_shared/GIS-STANDARDS.md`.

## Tile queries
Follow `backend src/routes/tiles.js`: `ST_AsMVT` over the `spatialLayers.js`-allowlisted table,
parameterised, bounded by the tile envelope (`ST_TileEnvelope` / bbox), respecting per-layer
`minzoom` and `roads.lowZoomFilter`. Only emit the attributes in the layer's `attributes` allowlist.

## Indexing (non-negotiable)
Every geom column touched by a query needs a GiST index; `roads.fclass` is indexed too. Pattern
lives in `migrations/074_spatial_tile_indexes.sql` (idempotent). No new spatial table/query ships
without its index — this is a reject-gate.

## SRID
900914 ≡ WGS 84 CRS84 ≡ 4326. Handle in SQL; don't sprinkle `ST_Transform` unless a source is
genuinely a different CRS. Verify with `verify-spatial-tables.js` inventory.

## Local DB caveat (from project memory)
Local `Vungu_spatial333` has **no** `schema_migrations` tracking. Apply migration files
individually; never run the full migration runner locally.

## Reject-gate
Unindexed geom query · unbounded tile query · table outside the allowlist · attribute leak beyond
the allowlist · client-side reprojection without cause. Return `confidence: NN% — reason`.
