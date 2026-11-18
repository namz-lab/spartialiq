#!/usr/bin/env node
// Targeted change for the LIVE database: applies migration 254 (the survey fields on the road, structure, water point and
// council asset registers, the fixed words allowed in them, the survey log, and the department's name on its ward
// measures) and nothing else. Same pattern as 242 to 253.
//
// Apply it BEFORE deploying the code that serves the Survey registers view (src/routes/roads-works-registers.js).
//
//   node scripts/apply-roads-survey-254-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-roads-survey-254-to-live.js --apply    the same, then COMMIT
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
const MIGRATION = '254_roads_works_survey.sql'

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)
  const pre = (await c.query(`SELECT
      to_regclass('council_ops.road_asset') IS NOT NULL AS road_asset,
      to_regclass('council_ops.road_structure') IS NOT NULL AS road_structure,
      to_regclass('council_ops.wash_asset') IS NOT NULL AS wash_asset,
      to_regclass('council_ops.council_asset') IS NOT NULL AS council_asset,
      to_regprocedure('council_ops.fill_ward()') IS NOT NULL AS migration_252,
      to_regclass('spatial_engine.measure') IS NOT NULL AS measure,
      to_regprocedure('tenancy.make_tenant(regclass,text)') IS NOT NULL AS make_tenant`)).rows[0]
  const missing = Object.entries(pre).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks: ' + missing.join(', ')); process.exit(1) }
  console.log('prerequisites: all present')
  // The migration limits these fields to fixed words; any other value already there would stop it. Say which first.
  const odd = (await c.query(`SELECT 'road surface' f, surface v, count(*)::int n FROM council_ops.road_asset WHERE surface IS NOT NULL AND surface NOT IN ('earth','gravel','bitumen','concrete','paving') GROUP BY 2
      UNION ALL SELECT 'road condition', condition, count(*)::int FROM council_ops.road_asset WHERE condition IS NOT NULL AND condition NOT IN ('good','fair','poor','very_poor','impassable') GROUP BY 2
      UNION ALL SELECT 'structure condition', condition, count(*)::int FROM council_ops.road_structure WHERE condition IS NOT NULL AND condition NOT IN ('good','fair','poor','very_poor','impassable') GROUP BY 2
      UNION ALL SELECT 'building condition', condition, count(*)::int FROM council_ops.council_asset WHERE condition IS NOT NULL AND condition NOT IN ('good','fair','poor','very_poor') GROUP BY 2`)).rows
  if (odd.length) { console.error('NOT ATTEMPTED. Values outside the survey words:', JSON.stringify(odd)); process.exit(1) }

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const cols = (await c.query(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns
       WHERE table_schema = 'council_ops' AND column_name IN ('width_m','drainage','surveyed_on','span_m','pump_type','yield_note','last_repaired_on','caretaker')
       ORDER BY 1`)).rows.map((r) => r.c)
    const rls = (await c.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'council_ops.survey_record'::regclass`)).rows[0]
    const words = (await c.query(`SELECT conname FROM pg_constraint WHERE conname LIKE '%_words' AND connamespace = 'council_ops'::regnamespace ORDER BY 1`)).rows.map((r) => r.conname)
    const stale = (await c.query(`SELECT count(*)::int n FROM spatial_engine.measure WHERE owner_dept = 'Engineering and Works'`)).rows[0].n
    console.log('new columns:', cols.join(', '))
    console.log('word constraints:', words.join(', '))
    console.log('survey_record row-level security:', rls.relrowsecurity, '| measures still named "Engineering and Works":', stale)
    const ok = cols.length >= 11 && rls.relrowsecurity && words.length === 6 && stale === 0
    if (!ok) throw new Error('the change did not leave what 254 promises')
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied on live.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
