# Backend reference — API design

## Conventions (match src/routes/tiles.js)
- All routes under `/api`. Resource-oriented paths; plural nouns.
- Success: return the resource / collection directly. Errors: consistent `{ error, message }`
  shape + correct HTTP status (400 validation, 401/403 auth, 404 missing, 409 conflict, 500).
- Read endpoints: support the filters the UI needs, nothing speculative (YAGNI).
- Pagination for unbounded collections; never return an unbounded result set to a table view.

## Spatial endpoints (existing)
- `GET /api/tiles/layers` — catalog.
- `GET /api/tiles/:layer/:z/:x/:y.pbf` — MVT via `ST_AsMVT`, allowlisted tables only.
- `GET /api/tiles/:layer/:id` — single feature as GeoJSON.
Respect per-layer `minzoom` and `roads.lowZoomFilter`.

## Validation
Validate at the boundary. Reject early with 400 + a message the frontend can show. Coerce/whitelist
query params; never pass raw params into SQL or into `ST_*` without bounds.
