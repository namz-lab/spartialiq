#!/usr/bin/env node
// Targeted change for the LIVE database: applies migration 251 (the Department of Roads and Works' 2027 establishment) and
// nothing else. Same pattern as the scripts for 242 to 250. Needs 249 and 250.
//
// It must be applied BEFORE the code that reads admin_org_position.grade is deployed (the unit dashboards and the admin
// console's organisation chart select that column).
//
//   node scripts/apply-roads-works-251-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-roads-works-251-to-live.js --apply    the same, then COMMIT
//
// Reads DATABASE_URL from backend/.env. ONE transaction sent as ONE request. It does not touch schema_migrations. Rows it
// writes: the engineering posts on the organisation chart (titles, grades, reporting lines, removals and additions).
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const root = path.join(__dirname, '..')
const envLine = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!envLine) { console.error('No DATABASE_URL in backend/.env'); process.exit(1) }
const url = envLine.slice('DATABASE_URL='.length)
const MIGRATION = '251_roads_and_works_2027_establishment.sql'

const PROPOSAL = { 'District Engineer': [10, 1], 'Civil Engineering Technician': [9, 1], 'Roads and Works Foreman/Technician': [8, 1],
  'Grader Operator': [6, 1], 'Heavy Equipment Operator': [6, 2], 'Class 2 Driver': [5, 2], 'Tractor Driver': [3, 1],
  'Tow Grader Operator': [3, 1], 'General Hand': [1, 1] }

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)

  const pre = (await c.query(`SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_org_position' AND column_name='section') AS section_column,
      EXISTS (SELECT 1 FROM public.admin_org_position WHERE unit_key='engineering' AND system_role='engineer') AS engineer_post`)).rows[0]
  const missing = Object.entries(pre).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks: ' + missing.join(', ') + ' (migrations 249, 216)'); process.exit(1) }
  const held = (await c.query(`SELECT title FROM public.admin_org_position WHERE unit_key='engineering' AND holder_id IS NOT NULL`)).rows.map((r) => r.title)
  console.log('prerequisites: all present; engineering posts with a holder:', JSON.stringify(held))

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const rows = (await c.query(`SELECT title, grade, department, system_role FROM public.admin_org_position WHERE unit_key='engineering' ORDER BY grade DESC NULLS LAST, sort_order`)).rows
    const counted = {}
    for (const r of rows) counted[r.title] = (counted[r.title] ?? 0) + 1
    console.log('after the change (inside the transaction):')
    for (const r of rows) console.log('  ', JSON.stringify(r))
    const exact = Object.keys(counted).length === Object.keys(PROPOSAL).length
      && Object.entries(PROPOSAL).every(([t, [g, n]]) => counted[t] === n && rows.filter((r) => r.title === t).every((r) => r.grade === g))
      && rows.every((r) => r.department === 'Roads and Works')
    if (!exact) throw new Error('the department is not exactly the 2027 proposal')
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied on live.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
