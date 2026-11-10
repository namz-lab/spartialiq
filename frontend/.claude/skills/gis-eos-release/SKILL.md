---
name: gis-eos-release
description: Release manager for the Vungu platform. Use when shipping — validate the deploy, verify migrations applied, run smoke tests, confirm rollback path, write release notes, and version. Reuses the existing backend smoke tests and delegates deploy mechanics to installed deployment skills.
---

# GIS-EOS Release

Runtime release readiness. Read `_shared/GOVERNANCE.md` (Release-Readiness gate) and
`_shared/METRICS.md` (budgets). Delegate deploy mechanics to the installed
`deployment-patterns` / `github-release-management` skills.

## Release checklist
1. **Migrations verified applied** in the target env (production via `migrate.js`; local
   individually — never the full runner locally).
2. **Smoke tests pass** — reuse the existing `test-tiles-endpoint.js` (8 checks) and
   `scripts/verify-spatial-tables.js` (table inventory). Add a smoke check for the new feature's
   critical path.
3. **Runtime budgets met** (METRICS.md) — tile <100ms, load <2s, key endpoints within p95.
4. **Rollback path known** — how to revert this release + any migration (down step documented).
5. **Release notes** — what changed, for whom, any migration/action required.
6. **Version** stamped; feature-history.md state → Released (TPM owns the file, you signal it).

## Rules
Don't ship on a green build alone — exercise the real critical path (`verify`/`browser-qa`).
A release with no rollback path is not ready. Return `confidence: NN% — reason`.
