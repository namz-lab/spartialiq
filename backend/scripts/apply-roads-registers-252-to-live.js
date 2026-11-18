#!/usr/bin/env node
// Targeted change for the LIVE database: applies migration 252 (wards and council road classes on the road register,
// wards on the water and asset registers, and the plant register) and nothing else. Same pattern as 242 to 251.
//
// Apply it BEFORE deploying the code that reads council_ops.plant (the Plant view of the Roads and Works dashboard).
//
//   node scripts/apply-roads-registers-252-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-roads-registers-252-to-live.js --apply    the same, then COMMIT
//
// Reads DATABASE_URL from backend/.env. ONE transaction sent as ONE request. It does not touch schema_migrations.
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const root = path.join(__dirname, '..')
const envLine = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!envLine) { console.error('No DATABASE_URL in backend/.env'); process.exit(1) }
const url = envLine.slice('DATABASE_URL='.length)
const MIGRATION = '252_roads_works_registers.sql'

const STATE = `SELECT
    (SELECT count(*)::int FROM council_ops.road_asset) AS roads,
    (SELECT count(ward)::int FROM council_ops.road_asset) AS roads_with_ward,
    (SELECT count(*)::int FROM council_ops.wash_asset) AS water_points,
    (SELECT count(ward)::int FROM council_ops.wash_asset) AS water_points_with_ward,
    (SELECT count(*)::int FROM council_ops.council_asset) AS council_assets,
    (SELECT count(ward)::int FROM council_ops.council_asset) AS council_assets_with_ward`

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)
  const pre = (await c.query(`SELECT
      to_regclass('council_ops.road_asset') IS NOT NULL AS road_asset,
      to_regclass('admin.authority_ward') IS NOT NULL AS authority_ward,
      to_regprocedure('tenancy.make_tenant(regclass,text)') IS NOT NULL AS make_tenant,
      to_regclass('finance.fixed_asset') IS NOT NULL AS fixed_asset,
      EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') AS vungu`)).rows[0]
  const missing = Object.entries(pre).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks: ' + missing.join(', ')); process.exit(1) }
  console.log('prerequisites: all present')
  console.log('before:', JSON.stringify((await c.query(STATE)).rows[0]))

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const after = (await c.query(STATE)).rows[0]
    const classes = (await c.query(`SELECT council_class, count(*)::int n FROM council_ops.road_asset GROUP BY 1 ORDER BY 2 DESC`)).rows
    const plant = (await c.query(`SELECT plant_no, kind, description FROM council_ops.plant ORDER BY plant_no`)).rows
    const rls = (await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE oid IN ('council_ops.plant'::regclass, 'council_ops.plant_log'::regclass)`)).rows
    console.log('after (inside the transaction):', JSON.stringify(after))
    console.log('road classes:', JSON.stringify(classes))
    console.log('plant:', JSON.stringify(plant))
    console.log('row-level security:', JSON.stringify(rls))
    const ok = after.roads_with_ward > 0 && classes.every((r) => r.council_class !== null) && rls.length === 2 && rls.every((r) => r.relrowsecurity)
    if (!ok) throw new Error('the change did not leave what 252 promises')
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied on live.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
