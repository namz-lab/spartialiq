# Feature history — enterprise memory

Owner: `gis-eos-tpm`. One entry per completed feature so future agents learn the *why*, not just
the *what*. Newest first. Append via the Definition of Done; don't rewrite past entries.

Template:
```
## <feature> — <YYYY-MM-DD> — <lifecycle state>
- Why: <the need>
- Changed: <modules/files/APIs/tables/layers>
- Risks: <what could break; mitigations>
- Migration: <schema/data steps, if any>
- Follow-ups: <deferred work>
- Health: <Architecture Health Score snapshot, for major features>
```

---

## Subdivision QGIS/AutoCAD DXF round-trip — 2026-08-03 — Released
- Why: planners were limited to the in-browser CAD tool for subdivision; requested an
  alternative that lets the layout be done or edited in QGIS Desktop or AutoCAD/Civil3D/
  Bricscad and brought back into the app.
- Changed: `frontend/src/map/tools/dxfImport.ts` (new, reads DXF → WGS84 GeoJSON, `dxf-parser`
  dependency, ADR 0007); `usePlanningTools.ts` `importDxf()` (new — matches lots by embedded id,
  falls back to lot-number only when unambiguous across blocks, replaces roads only when the
  file carries any); `PlanningPanel.vue` ("Import from CAD/QGIS (DXF)" button next to the
  existing Export); `dxfExport.ts` (lots now also carry a `#<roundTripId>` label token so
  re-import can match exactly, not just by the human-visible per-block lot number);
  `importGeo.ts`/`DataImport.vue` (`.dxf` added to the generic GIS-officer import path as a free
  side effect). No backend changes — reconciliation happens client-side, then saves through the
  existing `planning.js` endpoint unchanged. New `docs/COUNCIL_OPERATIONS_FLOW.md`;
  `docs/QGIS_WEB_INTEGRATION.md` §5a; `docs/PROGRESS.md`; CODEMAP/OWNERSHIP refreshed (were
  stale since 2026-07-14).
- Risks: a naive lot-number-only match would have silently merged unrelated lots across blocks
  (lot numbers repeat per block) — caught by a reconciliation test before shipping, fixed by
  requiring the embedded id as the primary key and only trusting lot-number as a fallback when
  it's globally unique at that moment. DXF carries no attribute table, so roads lose
  hierarchy/width classification on reimport (defaults to 'local') — documented, not silently
  lossy.
- Migration: none (no schema change).
- Follow-ups: native GeoPackage round-trip (blocked on GDAL not being installed in production);
  extending the existing PyQGIS plugin (`backend/qgis-projects/vungu-integration/`) to sync
  `planning_project` live, instead of file-based; real binary DWG (needs ODA/Teigha, proprietary).
- Verification: 23 new tests (golden round-trip through the real exporter, hand-built
  `LWPOLYLINE` fixture simulating a real AutoCAD/QGIS re-save, reconciliation matching/ambiguity
  guards, component-level wiring) — all green; full frontend suite 59 files/335 tests, zero
  regressions; `vue-tsc` unchanged at 45 pre-existing (unrelated, `src/views/surveyor/**`)
  errors, zero new; backend jest 20/22 suites unchanged (2 fail on an unrelated local port-3000
  conflict with another project on this machine, pre-existing). Live-browser smoke test was
  blocked by the dev machine's disk being ~100% full (unrelated to this change — see session
  notes); automated coverage above stands in for it.

## GIS-EOS skill suite — 2026-07-11 — Released
- Why: encode senior-engineer methodology per department so future work is accurate,
  production-grade, and maintainable (ponytail: reuse-first, delete dead code).
- Changed: added 23 `.claude/skills/gis-eos-*` skills + `_shared/` handbooks + INDEX;
  added `--login-*` design tokens to `src/styles/main.css`; seeded `docs/architecture/*`
  and `docs/adr/*`. No app behaviour changed; no new dependency.
- Risks: skills drift from code as it evolves — mitigated by the freshness gate + `gis-eos-platform`.
- Migration: none.
- Follow-ups: as features ship, keep CODEMAP/OWNERSHIP/DOMAIN-GRAPH/PATTERNS current.
