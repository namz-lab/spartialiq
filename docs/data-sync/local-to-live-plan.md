# Bringing local into live: findings and plan

**Status: PROPOSAL, 16 November 2026. Nothing has been written to live.** Every step that writes waits for the owner's approval.

Live is the shared Neon database (`neondb`) that https://spartialiq.onrender.com uses. Local is the Docker database (`vungu_master_db_v1`) the work so far was built on. The owner's instruction: live is the single source of truth, and **nothing in local may be left behind**.

## 1. What the read-only comparison found

| | Local | Live |
|---|---|---|
| Tables, views and materialised views | 449 | 259 |
| Functions (excluding extensions') | 211 | 44 |
| Repo migrations recorded as applied | 181 | 7 (latest `129_clip_osm_to_vungu.sql`) |
| Tables with row-level security | (tenancy contract, migration 165 on) | 2 |
| Roles the code steps into | `vungu_app`, `vungu_system` | `vungu_app` only |
| PostGIS | 3.5.2 | 3.6.4 |

- **Only in local:** 229 relations (193 tables, 93 of them with rows; 36 views), 167 functions, the schemas `tenancy`, `spatial_engine`, `basemap` (plus `tiger`, `topology`, `scratch`, `ogr_system_tables`, which are not application data), and columns missing from 68 tables that exist on both.
- **Only in live:** 39 tables, among them `finance.revenue_account` (751), `finance.collection_snapshot` (180), `finance.billing_district` (30), `public.buildings`' companions, the older `gweru_*` layers, and an empty `surveyor_surveyor_demo_surveyor` schema.
- **More rows in live than local (56 tables):** live has its own records that local does not, for example `finance.ledger_entry` (2,101), `public.buildings` (139,619), `admin.ward` (1,961), 26 permits against local's 14, the clerk's registers, council-ops registers, payments. **These are kept. Nothing in live is deleted or overwritten without an explicit decision.**
- **More rows in local than live (52 tables):** for example `land.parcel` (2,320 against 751), `revenue_link.*` (1,589 against 751), `council_ops.road_asset` (1,059 against 0), `public.zone_land_use_controls` (817 against 0), the committee, inspections, health, building plans, survey.

**The live site already runs the newest code.** Its `/api/eo-workflow/switches` answers 401 (the route exists), so Render deploys `main`. The code expects the local schema, which live does not have, so features built since migration 129 fail on live today. Bringing the schema across fixes the live site as well as making room for the data.

## 2. The plan

Every phase is reviewed before it runs. No phase uses `npm run migrate` or a seed script, and none sets `ALLOW_DEV_DB_TESTS`.

### Phase 0. Backup (read-only, done before anything else)
A full `pg_dump` of live, kept outside the repository in `~/lamis-backups/`. It is the way back if a later phase goes wrong. (A Neon branch made in the Neon console is a second, faster way back, and is recommended before Phase 1.)

### Phase 1. Schema: live gets what the code expects (additive only)
A script generated from local's schema, containing **only what live lacks**: the missing schemas, tables, columns, views, functions, triggers, indexes, constraints, row-level-security policies, grants, and the `vungu_system` role. Nothing is dropped; no column is changed in type; nothing that exists on live is replaced. Left out: `tiger`, `topology`, `scratch`, `ogr_system_tables` and the tiger/topology extensions (geocoder and development leftovers, not the council's data).
The script is shown to the owner in full before it runs, in one transaction, so it applies completely or not at all.

### Phase 2. Data: local rows live does not have (additive only)
Table by table, in the order the foreign keys need, **insert the local rows whose key is not in live** (`ON CONFLICT DO NOTHING`), then move each sequence past the highest id. Rows that exist on both sides with **different content** are listed for a decision, not overwritten.
Proposed exclusions, because they are development traffic or test residue rather than the council's data (the owner decides):
- sessions, login attempts and page views (`public.user_session`, `public.admin_login_attempt`, `public.page_view`);
- `public.notifications_outbox`: **copying it would let live send local's queued e-mails to real addresses**;
- `public.seed_demo_ledger`, `public.activity_spatial_test`, `spatial_planning.delegation_switch` and `delegation_switch_event` (left by test runs; all switches are off);
- `schema_migrations`, which is brought into line separately so that the repo's migrator and live agree.
Users are matched by e-mail; a local user missing from live is added with the same id where it is free. Accounts on test domains (`example.com`, `example.test`) are listed for the owner to keep or leave.

### Phase 3. Verify
Run the comparison again; every local table should then have at least its local rows on live. Smoke-test the local app against live and the live site, read-only.

## 3. Decisions for the owner

1. **Go ahead with Phase 1** (the schema script is shown first)?
2. **When a row is on both sides with different content:** local wins, live wins, or decide each table?
3. **The exclusions** in Phase 2: agree, or say which to bring across.
