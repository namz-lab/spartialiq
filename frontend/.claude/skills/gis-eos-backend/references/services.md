# Backend reference — services

## Layering (keep it thin — ponytail)
Route handler = validate + call service + shape response. Service = business logic + data access
via `fastify.pg`. Don't add a repository/DAO layer unless there are ≥3 real consumers — one
caller doesn't earn an abstraction.

## Rules
- A service function ≤ ~200 lines (METRICS.md) — extract collaborators past that.
- Transactions for multi-statement writes that must be atomic (permit issue + register entry).
- Soft-delete + audit, never hard-delete domain records (MUNICIPAL-STANDARDS.md).
- Statutory invariants live here (permit needs committee decision; inspection stage ordering) —
  enforce server-side, not only in the UI.

## Reuse
Grep existing services before writing one. Shared helpers stay shared; don't copy SQL between
routes — extract the query if it's used in ≥2 places (and register it in PATTERNS.md).
