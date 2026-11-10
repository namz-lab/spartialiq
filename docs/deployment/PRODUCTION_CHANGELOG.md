# Production change log — SpartialIQ / Vungu

Date: 2026-10-16  
Repos: `finale` (umbrella) · `Manicipal-drums-backend-3` · `Manicipal-drums-frontend`

## Critical finding (environment)

- Local Postgres cluster restarted without `vungu_master_db_v1` (database missing after unclean shutdown / cluster recovery).
- Restored from `backend/backups/vungu_master_db_v1-20261002-143546.dump`.
- **Action for ops:** keep scheduled `pg_dump`/`pg_restore` and document the restore path; do not rely on a single laptop data directory.

## Features added

| Item | Detail |
|------|--------|
| `GET /api/stands/identify?lng=&lat=` | Point-in-polygon stand lookup; returns status, sold/available labels, geometry, zone, price, allocation ref |
| Citizen map click identify | `MapSection.vue` calls identify on map click; floating card shows Sold / Available / Reserved + properties |
| OSM clip to Vungu (earlier) | `vungu_clip_boundary`, `scripts/clip-osm-to-vungu.js`, `129_clip_osm_to_vungu.sql` |
| Live table inventory | `backend/docs/LIVE-DATABASE-TABLES.md` — raw PostGIS tables, not GPKG at runtime |
| Architecture docs pack | Conceptual / Logical / Physical / Expected-Needed-Delivered (Zimbabwe sources) |

## Modified

| Item | Detail |
|------|--------|
| `backend/src/routes/stands.js` | Identify route registered **before** `/:id`; availability labels |
| `frontend/src/views/citizen/sections/MapSection.vue` | Spatial identify UX; sold/available pills; apply CTA gated on availability |
| `backend/src/config/spatialLayers.js` | Clarify tiles read PostGIS tables, not GPKG |
| `backend/docs/SSOT-database.md`, `DATA-DUMP-REPORT.md` | Runtime = raw tables; GPKG import-only |
| `backend/scripts/migrate-render.js` | Allowlist includes `129_clip_osm_to_vungu.sql` |

## Method critique (honest)

1. **Citizen map previously used point markers for “available stands” only** — that is not spatial register identify. Polygon click → PostGIS `ST_Intersects` is the correct method; markers remain a convenience list.
2. **Tile attributes alone are not enough for “sold?”** — MVT may omit allocation fields; identify hits the register.
3. **`available_stand` view vs `stands` table** — two surfaces; identify uses `stands` (authoritative geometry + status). Keep them aligned via migrations/views.
4. **Origin/main divergence** — FE ~384 ahead / ~290 behind; BE ~122 ahead / ~197 behind. Blind force-push would destroy remote work (tenancy, SurveyPro, parcel register). Merge `origin/main` then push; do not `--force`.
5. **Desktop `.exe`** — Tauri `npm run desktop:build` bundles Node + local Postgres; large GPKG is **not** inside the installer (by design). Full map still needs import/restore.
6. **Use-case gaps (2026-10-18):** A5 / P10 / G11 / C15 / F7 are now **built** (migration `181`, `/api/registers/*`, `/statutory-registers`, citizen Rates clearance). Remaining honesty gaps: Deeds Registry s109 hand-off is still paper (X6 out-of-band); ERP charges ledger is still a band/balance read, not a full Part XII ledger; X4/X7 still not built.

## Use-case coverage (this tranche)

| ID | Status after this work |
|----|------------------------|
| C1 Explore map | built (unchanged) |
| C3 Look up parcel/stand | **strengthened** — polygon identify + sold/status |
| G1 Find parcel/stand | **strengthened** via identify API |
| G10 Allocate stand | built (existing); identify surfaces allocation ref when present |

## Production harden + Acua layer (2026-10-18 evening)

| Item | Detail |
|------|--------|
| 1 Secrets template | `backend/.env.production.example` |
| 2 Runtime DB role | `vungu_runtime` via `create-runtime-role.js`; demo `@vungu.test` blocked in production |
| 3 Owners import | `scripts/import-property-owners.js` + sample CSV |
| 4 Backup/restore | `backup-db.js` + `restore-db.js` (CONFIRM_RESTORE=1) |
| 5 X4 / X7 scaffolds | `/api/custodian/sg-submissions`, `/api/custodian/deeds-notices` |
| Acua 300 m² | migration 183 → 59 `stand_subunit` plots; MVT `acua_stands`; citizen map toggle |

API gate after this tranche: **37/37 PASS**.

## Statutory registers tranche (2026-10-18)

| ID | Deliverable |
|----|-------------|
| A5 | `council_ops.bylaw_register` + UI tab |
| P10 | `council_ops.annual_district_plan` + approve/submit |
| G11 | `council_ops.compulsory_acquisition` |
| C15 / X6 | `council_ops.rates_clearance` + citizen lodge + staff issue |
| F7 | `council_ops.expense_recovery` |

- Migration: `backend/migrations/181_council_statutory_registers.sql`
- API: `backend/src/routes/council-registers.js` → `/api/registers/*`
- Staff UI: `/statutory-registers` · Citizen: `/citizen?section=rates_clearance`
- Gates: API `e2e-deploy-readiness.mjs` **34/34 PASS**; Playwright `e2e/button-crawl.spec.ts` **91 pass / 0 hard fail** → `BUTTON_CRAWL_RESULTS.json`

## Verify

```bash
# API (smoke — HDR-105 available)
curl "http://127.0.0.1:3000/api/stands/identify?lng=29.7513&lat=-19.48455"

# Desktop EXE (from frontend/)
npm run desktop:build
# → src-tauri/target/release/bundle/nsis/*.exe
```

## Follow-up from stand-identify audit (2026-10-16)

| Gap | Fix |
|-----|-----|
| Tauri tiles hit `tauri.localhost` | `runtimeOrigin.ts` + absolute tile/SSE URLs → `127.0.0.1:3000` |
| GISMapView camelCase/centroid mismatch | Normalize `standNumber`/`centroid[]`; show sold + price |
| `/parcels/locate` ignored `stands` | Prefer `stands` register; cadastre fallback |
| `/parcels/locate` gated on jurisdiction | Stand register resolves even outside jurisdiction polygon |
| `/parcels/find` parcels-only | UNION stands by stand_number |
| Stands MVT off by default | `stands` in `DEFAULT_VISIBLE` |

Audit source: [Stand sold lookup audit](8879f2ab-a64a-4dfc-a6cc-93ad63c4c15e). Desktop URL gap also noted in [Tauri EXE build audit](8038275f-6efb-4b1c-8b0d-b38738b13272).

## Desktop EXE (2026-10-16)

- Built with Tauri after installing Rust 1.99.1.
- Installer / EXE under `frontend/src-tauri/target/release/bundle/`.
- **Not** fully offline: Postgres/PostGIS via Scoop/system; backend `npm install` on first launch into app-data; GPKG map data separate.
- Critique: embedding full PG + `node_modules` overflows the Windows Tauri build-script stack — slim packaging is required.

## GitHub push (follow-up, 2026-10-16)

| Repo | Commit | Notes |
|------|--------|-------|
| frontend `main` | `f08d9583` | runtimeOrigin, DEFAULT_VISIBLE stands, GISMapView sold props, ogc/landUse desktop base |
| backend `main` | `a678acf5` | parcels locate/find prefer stands register |
| backend `main` | `e4352b60` | jurisdiction-free stand locate; find UNION cast; local vungu_app bootstrap |

### Follow-up #2 (same day)

| Item | Detail |
|------|--------|
| `/parcels/locate` | Resolve stands even when click is outside jurisdiction polygon |
| `/parcels/find` UNION | Cast `vungu_parcels.area_ha` (text) ↔ stands numeric so UNION succeeds |
| Local tenancy bootstrap | `scripts/bootstrap-local-vungu-app.sql` — restored Oct-2 dump lacked `vungu_app`; strict TENANCY_MODE was 500ing identify/locate |
| Missing tables (noise) | `admin_setting`, `integration.outbox_event` still absent on restored dump — workers log and continue |

## GitHub push (2026-10-16)

| Repo | Branch | Commit | Notes |
|------|--------|--------|-------|
| [Manicipal-drums-backend-3](https://github.com/Muna18madzinga/Manicipal-drums-backend-3) | `main` | `6693c452` | Cherry-picked identify onto remote main (keeps tenancy/SurveyPro history) |
| [Manicipal-drums-backend-3](https://github.com/Muna18madzinga/Manicipal-drums-backend-3) | `db-normalisation` | `9fb01e0d` | Full normalisation + docs pack |
| [Manicipal-drums-frontend](https://github.com/Muna18madzinga/Manicipal-drums-frontend) | `main` | `9832035b` | Map identify + desktop packaging on remote main |

**Note:** Local `main` had diverged with “unrelated histories” from `origin/main`. Remote was updated via cherry-pick onto `origin/main`, not by force-pushing the divergent local history (would have dropped SurveyPro/tenancy work).