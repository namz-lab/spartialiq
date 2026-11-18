#!/usr/bin/env node
// Targeted schema change for the LIVE database: applies migration 249 (the Engineering and Works unit's posts, in its
// sections, and admin_org_position.section) and nothing else. Same pattern as the scripts for 242 to 248.
//
// It must be applied BEFORE the code that reads admin_org_position.section is deployed: the unit dashboards
// (GET /api/units/:key) and the admin console's organisation chart select that column.
//
//   node scripts/apply-engineering-249-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-engineering-249-to-live.js --apply    the same, then COMMIT
//
// Reads DATABASE_URL from backend/.env. ONE transaction sent as ONE request. Rows it writes: one column on the
// organisation chart, and up to eleven engineering posts under the Engineer (none if a post of that title exists).
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const root = path.join(__dirname, '..')
const envLine = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!envLine) { console.error('No DATABASE_URL in backend/.env'); process.exit(1) }
const url = envLine.slice('DATABASE_URL='.length)
const MIGRATION = '249_engineering_unit_posts.sql'
const POSTS = `SELECT count(*)::int AS n FROM public.admin_org_position WHERE unit_key = 'engineering'`

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)

  const cols = new Set((await c.query(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'admin_org_position'`)).rows.map((r) => r.column_name))
  const missing = ['id', 'title', 'department', 'system_role', 'unit_key', 'reports_to', 'sort_order'].filter((x) => !cols.has(x))
  const engineer = (await c.query(`SELECT count(*)::int AS n FROM public.admin_org_position WHERE unit_key = 'engineering' AND system_role = 'engineer'`)).rows[0].n
  if (!engineer) missing.push("the Engineer post (unit 'engineering', role 'engineer', migration 216)")
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks:\n  ' + missing.join('\n  ')); process.exit(1) }
  console.log(`prerequisites: all present; section column already there: ${cols.has('section')}`)
  const before = (await c.query(POSTS)).rows[0].n
  console.log(`engineering posts before: ${before}`)

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const after = (await c.query(`SELECT
        EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_org_position' AND column_name='section') AS section_column,
        (${POSTS}) AS posts,
        (SELECT count(*)::int FROM public.admin_org_position WHERE unit_key='engineering' AND system_role IS NULL AND section IS NULL) AS posts_without_section,
        (SELECT string_agg(DISTINCT section, ', ') FROM public.admin_org_position WHERE unit_key='engineering') AS sections`)).rows[0]
    console.log('after the change (inside the transaction):', JSON.stringify(after))
    if (!(after.section_column && after.posts >= 12 && after.posts_without_section === 0)) {
      throw new Error('the change did not leave what 249 promises')
    }
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied on live.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
