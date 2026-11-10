# Database reference — migrations

## Format
`migrations/NNN_short_description.sql`. Next number after the highest existing (…074). Idempotent
where feasible (`CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`). One logical change per file.

## Applying (environment-specific — from project memory)
- **Local `Vungu_spatial333`**: no `schema_migrations` tracking. Apply the file **individually**
  (psql / a single-file run). **Never** run the full runner locally.
- **Production**: `node scripts/migrate.js` (or apply the file directly; 074-style files are
  idempotent).

## Every migration
- Adds the indexes/constraints for the columns it introduces (schema-design.md).
- Is reversible in intent (document the down step even if not automated).
- Is smoke-checked: `scripts/verify-spatial-tables.js` / `test-tiles-endpoint.js` still pass.

## Reject
A migration that adds a geom column without a GiST index, or a filtered column without an index,
is incomplete.
