# GIS-STANDARDS — map & spatial conventions (GIS-EOS)

The single-source rules for anything touching the map or spatial data.

## Style is single-source
`src/map/vunguBasemapStyle.ts` owns paint/layout. `styleLayerFor(layer)` returns the
MapLibre config; `chipColorFor(id, geomType)` returns the filter-swatch colour. **UI swatches
and map paint must always come from these two functions** — never hardcode a layer colour in a
component. `src/components/MapLayerFilters.vue` consumes `chipColorFor`.

## Basemap contract
`addVunguBasemap(map)` in `src/map/vunguBasemap.ts` adds all 24 PostGIS tile layers + labels +
admin drill-down. Exports: `DEFAULT_VISIBLE`, `ALWAYS_ON_LAYER` (always `'country'`),
`setBasemapLayerVisible`. Country is never a toggle chip.

## Tiles & CRS
- Vector tiles: `GET /api/tiles/:layer/:z/:x/:y.pbf` via `ST_AsMVT` over registry-allowlisted
  tables (`../app-backend/src/config/spatialLayers.js`). Single feature:
  `GET /api/tiles/:layer/:id` (GeoJSON). Catalog: `GET /api/tiles/layers`.
- Frontend helpers: `src/services/vectorTiles.ts` (`getTileLayerCatalog`, `getFeature`,
  `tileUrlTemplate`). Spatial store: `src/stores/spatial.ts`
  (`loadTileLayers`, `toggleTileLayer`).
- **SRID 900914 ≡ WGS 84 CRS84 ≡ 4326** — handled in SQL. Do not reproject client-side unless a
  layer is genuinely a different CRS (then use `proj4`).

## Performance / correctness (hard rejects — see METRICS.md)
- Every geom column queried needs a GiST index (migration `074_spatial_tile_indexes.sql`;
  also indexes `roads.fclass`). No new spatial table without its GiST index migration.
- A table is only tileable if it is in the `spatialLayers.js` allowlist. Never bypass it.
- Respect per-layer `minzoom` and `roads.lowZoomFilter`. No unbounded tile query.
- Tile render budget < 100 ms; map pan holds 60 fps.
- `prefersReducedMotion()` in `vunguBasemap.ts` collapses `fitBounds` to a 0 ms jump — keep it.

## Cadastre / topology
Parcel editing must stay topologically valid (no self-intersection, snap to shared edges).
Use `@turf/*` / `jsts` already installed. Subdivision must sum to the parent geometry.
