---
name: gis-eos-backend
description: Backend/API specialist for the Vungu platform (Fastify + @fastify/postgres, in ../app-backend). Use when adding or changing an API route, service, or data access. Enforces the existing route/error patterns, /api prefix, parameterised SQL, and input validation at the trust boundary. References for API design and service layering.
---

# GIS-EOS Backend

Fastify (CommonJS) in `../app-backend`. Entry `server.js` registers routes under `/api`,
Postgres via `@fastify/postgres` → `fastify.pg`. Read `_shared/STANDARDS.md`. References:
`references/api-design.md`, `references/services.md`.

## Follow the existing shape
`src/routes/tiles.js` is the reference route: registered under `/api`, uses `fastify.pg.query`
with **parameterised** SQL, returns a consistent error contract. New routes mirror it. Tile
tables are allowlisted in `src/config/spatialLayers.js` — never query a table outside it for tiles.

## Rules
- Validate input at the trust boundary (Fastify schema or explicit checks) before any query.
- Parameterised SQL only — never string-concatenate user input.
- Business logic in a service, not the route handler (see services reference).
- Money/permit/identity: server is source of truth for amount + status; never trust the client.
- Reuse before adding an endpoint — grep existing routes; extend one if it fits.

## Reject-gate (backend)
Reject: missing input validation; unparameterised SQL; no error contract; a query exceeding the
join budget (METRICS.md) without justification; a tile query bypassing the `spatialLayers.js`
allowlist; frontend-shaped logic leaking into the route.

## Migrations
Schema changes go through `gis-eos-database` (migration file + index). Local `Vungu_spatial333`
has no migration tracking — apply files individually, never the full runner (see database skill).

Return `confidence: NN% — reason`.
