---
name: gis-eos-performance
description: Performance specialist for the Vungu platform. Use when a view is slow, a map stutters, a query is heavy, or before releasing a large feature. Checks against the METRICS.md budgets (tile <100ms, search <200ms, 60fps pan, load <2s) then delegates profiling to the installed performance-optimizer agent. Thin by design.
---

# GIS-EOS Performance

Read `_shared/METRICS.md` for the budgets. This skill checks against them and delegates deep
profiling to the installed `performance-optimizer` agent.

## Budgets (reject on breach)
Initial load <2s · tile render <100ms · search <200ms · map pan 60fps · tables virtualize >500
rows · API p95 <300ms (per-endpoint for spatial). No unexplained bundle growth.

## Where the platform's hot spots are
- Tile queries: must be GiST-indexed + tile-envelope-bounded (see `gis-eos-postgis`). An
  unindexed geom query is the usual culprit.
- Map: paint from `vunguBasemapStyle.ts`; too many always-on layers hurts fps — respect
  `DEFAULT_VISIBLE`/`minzoom`.
- Big tables (registers): virtualize; paginate the API, don't ship 10k rows.
- Heavy routes: lazy-load (dynamic import) rather than bloating the initial chunk.

## Method (ponytail)
Measure first (installed `performance-optimizer` / browser traces) — don't optimise on a hunch.
Fix the biggest measured cost, re-measure, stop when the budget is met. Return
`confidence: NN% — reason` with the before/after number.
