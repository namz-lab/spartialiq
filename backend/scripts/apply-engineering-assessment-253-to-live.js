#!/usr/bin/env node
// Targeted change for the LIVE database: applies migration 253 (spatial_planning.engineering_assessment, the Department of
// Roads and Works' reply to a planning referral: the s.26(5) infrastructure-cost test, the s.41 subdivision roads and the
// access onto a council road) and nothing else. Same pattern as 242 to 252.
//
// Apply it AFTER 252 (the council road classes it reads) and BEFORE deploying the referral desk code.
//
//   node scripts/apply-engineering-assessment-253-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-engineering-assessment-253-to-live.js --apply    the same, then COMMIT
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
const MIGRATION = '253_engineering_assessment.sql'

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)
  const pre = (await c.query(`SELECT
      to_regclass('spatial_planning.application_consultation') IS NOT NULL AS application_consultation,
      to_regclass('spatial_planning.permit_application') IS NOT NULL AS permit_application,
      to_regclass('council_ops.road_asset') IS NOT NULL AS road_asset,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'council_ops' AND table_name = 'road_asset' AND column_name = 'council_class') AS migration_252,
      to_regprocedure('tenancy.make_tenant(regclass,text)') IS NOT NULL AS make_tenant,
      EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') AS vungu`)).rows[0]
  const missing = Object.entries(pre).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks: ' + missing.join(', ') + (pre.migration_252 ? '' : ' (apply 252 first)')); process.exit(1) }
  console.log('prerequisites: all present')
  const already = (await c.query(`SELECT to_regclass('spatial_planning.engineering_assessment') IS NOT NULL AS ok`)).rows[0].ok
  console.log('engineering_assessment already there:', already)

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const t = (await c.query(`SELECT relname, relrowsecurity FROM pg_class WHERE oid = 'spatial_planning.engineering_assessment'::regclass`)).rows
    const checks = (await c.query(`SELECT conname FROM pg_constraint WHERE conrelid = 'spatial_planning.engineering_assessment'::regclass AND contype IN ('c','u','f') ORDER BY 1`)).rows.map((r) => r.conname)
    const referrals = (await c.query(`SELECT count(*)::int n FROM spatial_planning.application_consultation WHERE lower(body_name) = 'engineering'`)).rows[0].n
    console.log('table and row-level security:', JSON.stringify(t))
    console.log('constraints:', checks.join(', '))
    console.log('engineering referrals on live:', referrals)
    const ok = t.length === 1 && t[0].relrowsecurity && checks.includes('engineering_cost_has_condition') && checks.includes('engineering_access_names_road')
    if (!ok) throw new Error('the change did not leave what 253 promises')
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied on live.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
