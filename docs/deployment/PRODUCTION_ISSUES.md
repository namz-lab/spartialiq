# Production issues log — 2026-10-18

Honest distance-to-production after auditing stand owners, planner console, and backend workers.

## Stand owners

| Fact | Detail |
|------|--------|
| Schema | `spatial_planning.property` + `parcel_owner` exist (migration 084) |
| Staff API | `GET /api/properties/:standNo/owners` (role-gated) |
| Nearby | `GET /api/parcels/nearby` attaches `site.stand.owners` for staff |
| Public identify | Sold/status + allocation ref; **allottee display name** only (no phone/email) |
| Local DB before fix | **0 properties / 0 owners**; `stand_allocation` empty even for `status=allocated` |
| After seed | Demo allottees on HDR-004, HDR-103, MDR-203, EC-303 |

**Real council owner data is not imported.** Demo names are placeholders until Property File / finance / deeds feeds land.

## Issues found (console / server)

| # | Severity | Symptom | Root cause | Fix status |
|---|----------|---------|------------|------------|
| 1 | **Blocker** | Planner staff APIs 500 (`permit-applications`, `auth/me`, `properties/.../owners`, …) | `jwtAuth` SELECT `users.authority_id` / `is_platform` — columns missing on Oct-2 restore | **Fixed locally** — columns added; bootstrap SQL updated |
| 2 | High | No owner info anywhere | Empty `property` / `parcel_owner` / `stand_allocation` | **Seeded demo**; need real data load for production |
| 3 | Medium | Server log spam every ~30s | Missing `public.admin_setting`, `integration.outbox_event` | **Stub tables created**; bootstrap SQL updated |
| 4 | Medium | Identify said sold but `allocation: null` | Allocated stands without `stand_allocation` rows | **Seeded**; identify now returns `allotteeName` |
| 5 | Medium | Planner map often blank / few tiles | Styles limited (“using saved styles”); QGIS Server not required for MVT but basemap/style path fragile; some layers “no primary key” | Partially open — MVT path works when PostGIS up; QGIS optional |
| 6 | Low | `/api/analytics/pageview` 500 | Analytics table/path incomplete on thin DB | Open |
| 7 | Product | Use cases still open | C15 rates clearance, P10 annual plan, F7 expense recovery, G11 acquisition, A5 by-laws | Not built |
| 8 | Ops | Desktop EXE not offline-complete | Needs system Postgres + DB restore + first-run npm | By design; document for council IT |

## How far from production?

**Roughly: demo / pilot-ready for spatial stand lookup; not council go-live.**

| Area | Readiness |
|------|-----------|
| Citizen map + sold/available identify | ~70% (works with demo stands) |
| Staff planner shell | ~40% (UI loads; many APIs were broken until auth columns; map/style still fragile) |
| Owner / Property File | ~25% (API yes; real data no) |
| Tenancy / RLS contract | ~30% (code expects 154–168; local dump bootstrapped thin) |
| Integrations (GMS, email, analytics) | ~20% |
| Statutory use-case pack | ~50% overall (see USE-CASES.md gaps) |

**Go-live needs (minimum):**
1. Apply migrations through tenancy/runtime role (or keep bootstrap + `TENANCY_MODE` policy documented).
2. Import real Property File / allottee register into `property` + `parcel_owner` (+ keep `stand_allocation` in sync on allocate).
3. Harden planner tile/style path and smoke every staff portal route under `demo.planner`.
4. Turn off “development build” demo account strip; real Cloudflare Turnstile; `APP_DATABASE_URL` non-superuser.
5. Scheduled backups and restore drill (DB already lost once on this machine).

## Verify after restore

```bash
psql … -f backend/scripts/bootstrap-local-vungu-app.sql
# then seed owners or import Property File
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:3000/api/properties/HDR-004/owners
curl "http://127.0.0.1:3000/api/stands/identify?lng=29.7313&lat=-19.4837"
```
