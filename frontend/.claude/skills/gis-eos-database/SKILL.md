---
name: gis-eos-database
description: PostgreSQL/PostGIS database specialist for the Vungu platform. Use when designing tables, constraints, indexes, or writing migrations. Enforces constraints + indexes + a migration file for every schema change, soft-delete + audit for domain data, and the local-DB no-tracking caveat. References for schema design and migrations.
---

# GIS-EOS Database

Postgres + PostGIS (`Vungu_spatial333`). Read `_shared/STANDARDS.md`. References:
`references/schema-design.md`, `references/migrations.md`. Delegate deep query review to the
installed `database-reviewer` agent.

## Every schema change ships with
1. A **migration file** (`migrations/NNN_*.sql`, idempotent where possible).
2. **Constraints** — FKs, NOT NULL, CHECK — the DB enforces invariants, not just the app.
3. **Indexes** — on every filtered/joined column; **GiST** on every geom column
   (pattern: `074_spatial_tile_indexes.sql`).
4. **Soft-delete + audit** for domain records (no hard delete — MUNICIPAL-STANDARDS.md).

## Local DB caveat (project memory — important)
Local `Vungu_spatial333` has **no** `schema_migrations` tracking. Apply migration files
**individually**; never run the full migration runner locally (`node scripts/migrate.js`
is for production). Verify with `scripts/verify-spatial-tables.js`.

## Reject-gate
A filtered/joined column with no index · a geom column with no GiST index · a domain table with
no soft-delete/audit · a schema change with no migration file · a missing constraint that pushes
an invariant into app code. Return `confidence: NN% — reason`.
