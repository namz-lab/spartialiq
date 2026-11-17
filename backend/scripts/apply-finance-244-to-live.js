#!/usr/bin/env node
// Targeted schema change for the LIVE database: applies migration 244 (property finance on the
// Planning register: the integration log, the customer matching keys, finance.v_property_finance
// and three finance.property.* permissions) and nothing else.
//
// Why not `npm run migrate`: live's schema_migrations table does not match the repo, so the migrator
// would try to re-run about 170 migrations. This script runs only this one file, which is written to
// be idempotent, and does not touch schema_migrations. Migration 245 needs nothing on live (none of
// the ledger_entry columns it relaxes is NOT NULL there), so it is not included.
//
//   node scripts/apply-finance-244-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-finance-244-to-live.js --apply    the same, then COMMIT
//
// FIRST IT FINISHES MIGRATION 228 ON LIVE. 244's view joins public.stand_allocation.stand_id to
// land.parcel.parcel_id. Migration 228 made stand_allocation.stand_id and stand_subunit.parent_stand_id
// name a parcel (they had named the old public.stands table by uuid), but on live that step never ran:
// both columns are still uuids pointing at public.stands_live_legacy (the old table, renamed when the
// map data was loaded). 228 itself refuses tables that hold rows; live holds 4 allocations and 59
// sub-units. Each old stand is matched to the one current land.parcel with the same stand number;
// the step refuses if any row matches no parcel or more than one. It then points both columns at
// land.parcel and recreates 228's two policies on stand_allocation (the ones it has to drop to change
// the column's type), word for word. Nothing else of 228 is repeated: live already has the rest.
//
// Reads DATABASE_URL from backend/.env. The whole change is ONE transaction sent as ONE request, so a
// dropped connection cannot leave it half applied. Rows it writes: the 4 + 59 re-pointed references,
// and 244's own three finance.permission rows with their finance.role_permission grants. It creates
// three empty tables.
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const root = path.join(__dirname, '..')
const envLine = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!envLine) { console.error('No DATABASE_URL in backend/.env'); process.exit(1) }
const url = envLine.slice('DATABASE_URL='.length)
const MIGRATION = '244_finance_property_gis.sql'

// What 244 builds on: every relation and function it names, and every column its view reads.
const RELATIONS = [
  'public.local_authorities', 'public.users', 'land.parcel', 'land.stand_offer', 'public.stand_allocation',
  'public.parcel_zoning', 'public.plan_zone_type', 'spatial_planning.zone', 'admin.authority_ward', 'admin.ward',
  'finance.party', 'finance.rates_account', 'finance.rates_receipt', 'finance.voucher', 'finance.v_rates_arrears',
  'finance.permission', 'finance.role_permission', 'public.stand_subunit', 'public.stands_live_legacy',
]
const COLUMNS = {
  'land.parcel': ['parcel_id', 'parcel_kind', 'stand_no', 'township_code', 'area_m2', 'tenure_class', 'authority_id', 'ward_code',
    'allocation_status', 'status', 'geom_wgs84'],
  'land.stand_offer': ['parcel_id', 'status', 'price_usd', 'use_scale'],
  'public.stand_allocation': ['id', 'stand_id', 'status', 'deleted_at', 'reference_no', 'allottee_name', 'allocated_to', 'purpose',
    'allocated_at', 'revoked_at'],
  'public.parcel_zoning': ['parcel_layer', 'parcel_id', 'zone_id', 'plan_zone_type_id', 'is_governing', 'plan_instrument_id'],
  'spatial_planning.zone': ['id', 'zone'],
  'public.plan_zone_type': ['id', 'name'],
  'admin.authority_ward': ['authority_id', 'ward_code', 'valid_to'],
  'admin.ward': ['ward_code', 'name', 'geom'],
  'finance.rates_account': ['id', 'parcel_id', 'status', 'deleted_at', 'account_no', 'party_id', 'opened_on', 'erp_account_no'],
  'finance.rates_receipt': ['rates_account_id', 'voucher_id', 'amount', 'currency', 'received_on', 'deleted_at'],
  'finance.v_rates_arrears': ['rates_account_id', 'billed_amount', 'outstanding_amount', 'voucher_type', 'currency', 'days_outstanding', 'posting_date'],
  'finance.permission': ['code', 'label', 'category', 'is_approval', 'is_publication', 'is_restricted', 'description'],
}
const FUNCTIONS = ['app.authority_id()', 'app.is_platform()', 'tenancy.make_tenant(regclass,text)', 'gen_random_uuid()']

// ── Finishing 228 on live ─────────────────────────────────────────────────────────────────────────
// Runs only while stand_allocation.stand_id is still a uuid. The old stand's number names the parcel.
const MATCH = (col) => `(SELECT p.parcel_id FROM public.stands_live_legacy s
                          JOIN land.parcel p ON p.stand_no::text = s.stand_number::text AND p.status = 'current'
                         WHERE s.id::text = ${col})`
const FINISH_228 = `
DO $f$
DECLARE bad text;
BEGIN
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.stand_allocation'::regclass AND attname = 'stand_id') <> 'uuid' THEN
    RAISE NOTICE '228 on live: stand_allocation.stand_id already names a parcel; nothing to finish';
    RETURN;
  END IF;

  -- every row must match exactly one current parcel, or nothing changes
  SELECT string_agg(x, '; ') INTO bad FROM (
    SELECT 'allocation ' || a.reference_no || ' matches ' || n || ' parcels' x
      FROM public.stand_allocation a
      CROSS JOIN LATERAL (SELECT count(*) n FROM public.stands_live_legacy s
                            JOIN land.parcel p ON p.stand_no::text = s.stand_number::text AND p.status = 'current'
                           WHERE s.id = a.stand_id) m WHERE m.n <> 1
    UNION ALL
    SELECT 'sub-unit ' || u.id || ' matches ' || n || ' parcels'
      FROM public.stand_subunit u
      CROSS JOIN LATERAL (SELECT count(*) n FROM public.stands_live_legacy s
                            JOIN land.parcel p ON p.stand_no::text = s.stand_number::text AND p.status = 'current'
                           WHERE s.id = u.parent_stand_id) m WHERE m.n <> 1) z;
  IF bad IS NOT NULL THEN
    RAISE EXCEPTION 'cannot finish 228 on live, a stand does not name exactly one parcel: %', bad;
  END IF;

  -- the one view over these columns (228's acua_stands_tile_view, identical on live); recreated below
  DROP VIEW IF EXISTS public.acua_stands_tile_view;
  DROP POLICY IF EXISTS tenant_select ON public.stand_allocation;
  DROP POLICY IF EXISTS tenant_write ON public.stand_allocation;
  ALTER TABLE public.stand_allocation DROP CONSTRAINT IF EXISTS stand_allocation_stand_id_fkey;
  ALTER TABLE public.stand_subunit DROP CONSTRAINT IF EXISTS stand_subunit_parent_stand_id_fkey;
  ALTER TABLE public.stand_allocation ALTER COLUMN stand_id TYPE varchar USING stand_id::varchar;
  ALTER TABLE public.stand_subunit ALTER COLUMN parent_stand_id TYPE varchar USING parent_stand_id::varchar;

  -- the user triggers stay off for the re-pointing only (an allocation's own rules are not re-judged)
  ALTER TABLE public.stand_allocation DISABLE TRIGGER USER;
  ALTER TABLE public.stand_subunit DISABLE TRIGGER USER;
  UPDATE public.stand_allocation a SET stand_id = ${MATCH('a.stand_id')};
  UPDATE public.stand_subunit u SET parent_stand_id = ${MATCH('u.parent_stand_id')};
  ALTER TABLE public.stand_allocation ENABLE TRIGGER USER;
  ALTER TABLE public.stand_subunit ENABLE TRIGGER USER;

  ALTER TABLE public.stand_allocation ADD CONSTRAINT stand_allocation_stand_id_fkey
    FOREIGN KEY (stand_id) REFERENCES land.parcel (parcel_id) ON DELETE CASCADE;
  ALTER TABLE public.stand_subunit ADD CONSTRAINT stand_subunit_parent_stand_id_fkey
    FOREIGN KEY (parent_stand_id) REFERENCES land.parcel (parcel_id) ON DELETE CASCADE;

  -- 228's two policies, word for word
  CREATE POLICY tenant_select ON public.stand_allocation FOR SELECT USING (
    EXISTS (SELECT 1 FROM land.stand_offer p WHERE p.parcel_id = stand_allocation.stand_id));
  CREATE POLICY tenant_write ON public.stand_allocation FOR ALL
    USING (app.is_platform() OR EXISTS (SELECT 1 FROM land.stand_offer p WHERE p.parcel_id = stand_allocation.stand_id AND p.authority_id = app.authority_id()))
    WITH CHECK (app.is_platform() OR EXISTS (SELECT 1 FROM land.stand_offer p WHERE p.parcel_id = stand_allocation.stand_id AND p.authority_id = app.authority_id()));
  -- 228's view, word for word, with the privileges it holds on live today
  CREATE VIEW public.acua_stands_tile_view AS
  SELECT (row_number() OVER (ORDER BY created_at, id))::integer AS fid,
         id::text AS subunit_id, subunit_number, parent_stand_id::text AS parent_stand_id, estate, typology, status,
         COALESCE(round(area_sqm)::integer, round(target_area_sqm)::integer, 0) AS area_sqm_int,
         COALESCE(round(price_usd * 100)::integer, 0) AS price_usd_cents,
         geom
    FROM public.stand_subunit
   WHERE status <> 'withdrawn' AND typology = 'acua_300';
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.acua_stands_tile_view TO vungu_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_system') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.acua_stands_tile_view TO vungu_system;
  END IF;
  RAISE NOTICE '228 on live: stand_allocation and stand_subunit now name parcels';
END $f$;`
const AFTER_228 = `
  SELECT format_type(a.atttypid, a.atttypmod) AS stand_id_type,
         (SELECT count(*)::int FROM public.stand_allocation) AS allocations,
         (SELECT count(*)::int FROM public.stand_allocation x JOIN land.parcel p ON p.parcel_id = x.stand_id) AS allocations_on_a_parcel,
         (SELECT string_agg(x.reference_no || ' -> ' || x.stand_id, ', ' ORDER BY x.reference_no) FROM public.stand_allocation x) AS allocations_now,
         (SELECT count(*)::int FROM public.stand_subunit) AS subunits,
         (SELECT count(*)::int FROM public.stand_subunit x JOIN land.parcel p ON p.parcel_id = x.parent_stand_id) AS subunits_on_a_parcel
    FROM pg_attribute a WHERE a.attrelid = 'public.stand_allocation'::regclass AND a.attname = 'stand_id'`

const AFTER = `
  SELECT
    to_regclass('finance.property_integration_run') IS NOT NULL   AS integration_run,
    to_regclass('finance.property_integration_event') IS NOT NULL AS integration_event,
    to_regclass('finance.party_identity') IS NOT NULL             AS party_identity,
    to_regclass('finance.v_property_finance') IS NOT NULL         AS property_view,
    (SELECT count(*)::int FROM finance.permission WHERE code LIKE 'finance.property.%')        AS permissions,
    (SELECT count(*)::int FROM finance.role_permission WHERE permission_code LIKE 'finance.property.%') AS grants,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'finance'
        AND tablename IN ('property_integration_run', 'property_integration_event', 'party_identity')) AS tenant_policies`

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  const notices = []
  c.on('notice', (n) => notices.push(n.message))
  await c.connect()
  const db = (await c.query(`SELECT current_database() db, current_user u, version() v`)).rows[0]
  console.log(`database ${db.db} as ${db.u}: ${db.v.split(',')[0]}`)

  const missing = []
  for (const r of RELATIONS) if (!(await c.query('SELECT to_regclass($1) IS NOT NULL ok', [r])).rows[0].ok) missing.push(`relation ${r}`)
  for (const f of FUNCTIONS) if (!(await c.query('SELECT to_regprocedure($1) IS NOT NULL ok', [f])).rows[0].ok) missing.push(`function ${f}`)
  for (const [rel, cols] of Object.entries(COLUMNS)) {
    if (missing.includes(`relation ${rel}`)) continue
    const [s, t] = rel.split('.')
    const have = new Set((await c.query(
      `SELECT a.attname FROM pg_attribute a JOIN pg_class k ON k.oid = a.attrelid JOIN pg_namespace n ON n.oid = k.relnamespace
        WHERE n.nspname = $1 AND k.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped`, [s, t])).rows.map((r) => r.attname))
    for (const col of cols) if (!have.has(col)) missing.push(`column ${rel}.${col}`)
  }
  if (missing.length) {
    console.error('NOT ATTEMPTED. Live lacks what 244 builds on:\n  ' + missing.join('\n  '))
    process.exit(1)
  }
  console.log('prerequisites: all present')

  const script = [
    'BEGIN;',
    "SET LOCAL lock_timeout = '15s';",
    'SET LOCAL statement_timeout = 0;',
    FINISH_228,
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8'),
  ].join('\n')

  try {
    await c.query(script)
    const a228 = (await c.query(AFTER_228)).rows[0]
    console.log('228 finished (inside the transaction):', JSON.stringify(a228))
    if (a228.stand_id_type === 'uuid' || a228.allocations_on_a_parcel !== a228.allocations || a228.subunits_on_a_parcel !== a228.subunits) {
      throw new Error('a stand reference does not name a parcel after finishing 228')
    }
    const after = (await c.query(AFTER)).rows[0]
    console.log('after the change (inside the transaction):', JSON.stringify(after))
    // the view must also run, not only exist
    const rows = (await c.query('SELECT count(*)::int n, count(*) FILTER (WHERE in_authority)::int in_authority FROM finance.v_property_finance')).rows[0]
    console.log('finance.v_property_finance reads:', JSON.stringify(rows))
    const ok = after.integration_run && after.integration_event && after.party_identity && after.property_view && after.permissions === 3
    if (!ok) throw new Error('the change did not leave what 244 promises')
    if (APPLY) {
      await c.query('COMMIT')
      console.log(`COMMITTED: ${MIGRATION} is applied on live.`)
    } else {
      await c.query('ROLLBACK')
      console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.')
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally {
    if (notices.length) console.log('notices:\n  ' + notices.join('\n  '))
    await c.end().catch(() => {})
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
