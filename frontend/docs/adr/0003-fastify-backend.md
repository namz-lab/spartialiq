# ADR 0003 — Fastify + @fastify/postgres backend

Status: Accepted · Owner: `gis-eos-architect`

## Context
The backend needs fast HTTP + direct Postgres access under `/api`.

## Decision
Fastify (CommonJS) with `@fastify/postgres` (`fastify.pg`); routes registered under `/api`
(`server.js`). New routes mirror `src/routes/tiles.js` (parameterised SQL, consistent errors).

## Consequences
- Business logic in services, thin route handlers; validate at the boundary.
- Don't introduce a second HTTP framework or an ORM without a new ADR.
