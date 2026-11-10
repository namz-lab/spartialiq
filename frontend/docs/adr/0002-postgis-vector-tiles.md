# ADR 0002 — PostGIS + ST_AsMVT vector tiles

Status: Accepted · Owner: `gis-eos-architect`

## Context
Country-wide spatial data must reach staff and citizens efficiently.

## Decision
Serve vector tiles from PostGIS via `ST_AsMVT` (`backend src/routes/tiles.js`) over an
allowlisted registry (`src/config/spatialLayers.js`), with GiST indexes (migration 074).

## Consequences
- Every tileable table must be registry-allowlisted + GiST-indexed + tile-envelope-bounded.
- No serving spatial data outside this path without a new ADR.
