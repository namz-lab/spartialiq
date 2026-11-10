# Deploy readiness — 2026-10-18 (evening)

## Verdict

**Feature + API gate: ready for staging.**  
**Public go-live: blocked on real secrets, real Property File, and host ops** (items below).

## Production checklist (1–5) — status

| # | Item | Status |
|---|------|--------|
| 1 | Production secrets / env | **Template ready** — `backend/.env.production.example`. Set real `JWT_SECRET`, `TURNSTILE_SECRET_KEY`, `NODE_ENV=production` on the host. |
| 2 | Non-superuser DB + demo gate | **Local runtime login created** (`vungu_runtime` → `.env.runtime`). Demo `@vungu.test` blocked when `NODE_ENV=production` (or `ALLOW_DEMO_LOGIN=0`). Full migration 168 needs `tenancy` schema on older DBs — use `scripts/bootstrap-local-vungu-system.sql` then `create-runtime-role.js --apply`. |
| 3 | Real Property File / owners | **Importer ready** — `node scripts/import-property-owners.js path.csv` (+ sample CSV). Replace demo owners with council export. |
| 4 | Backup / restore drill | **Scripts ready** — `npm run backup` / `node scripts/backup-db.js`; restore via `CONFIRM_RESTORE=1 node scripts/restore-db.js backups/db-….dump`. Schedule nightly + off-host copy. |
| 5 | Custodian gaps X4 / X7 | **Scaffold built** — `/api/custodian/sg-submissions` (X4) and `/api/custodian/deeds-notices` (X7). Hand/courier until SG/Deeds APIs exist. |

## Acua 300 m² sub-unit layer

| Piece | Detail |
|-------|--------|
| Table | `public.stand_subunit` (typology `acua_300`, estate `Acua`) |
| Seed | Grid (~17.3 m) inside parent stands > 900 m² → **59** plots (~180–300 m²) |
| MVT | layer id `acua_stands` → `acua_stands_tile_view` |
| API | `GET /api/stands/subunits`, identify prefers subunit polygons |
| UI | Citizen map toggle **Acua 300 m² stands** |

## How to harden a host

```powershell
# 1–2 secrets + runtime role
cd backend
copy .env.production.example .env.production   # fill secrets
psql -U postgres -d vungu_master_db_v1 -f scripts/bootstrap-local-vungu-app.sql
psql -U postgres -d vungu_master_db_v1 -f scripts/bootstrap-local-vungu-system.sql
node scripts/apply-local-migration.js 182_custodian_boundary_scaffolds.sql
node scripts/apply-local-migration.js 183_acua_stand_subunits.sql
node scripts/create-runtime-role.js --apply
# start with .env.runtime loaded (server.js does this automatically)

# 3 owners
node scripts/import-property-owners.js path\to\council-owners.csv

# 4 backup drill
node scripts/backup-db.js
# CONFIRM_RESTORE=1 node scripts/restore-db.js backups\db-….dump   # only on a throwaway DB

# 5 verify
node scripts/e2e-deploy-readiness.mjs
```

## Still human / external

- Cloudflare Turnstile **site + secret** from the council dashboard (cannot invent).
- Real allottee CSV from Finance / Property File.
- Deeds Registry and Surveyor-General interfaces (X4/X7 stay paper + register until then).
