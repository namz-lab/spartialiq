#!/usr/bin/env node
// Targeted schema change for the LIVE database: applies migration 250 (the civil technician, roads foreman and water and
// sanitation technician roles, and their posts) and nothing else. Same pattern as the scripts for 242 to 249. Needs 249.
//
//   node scripts/apply-engineering-roles-250-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-engineering-roles-250-to-live.js --apply    the same, then COMMIT
//
// Reads DATABASE_URL from backend/.env. ONE transaction sent as ONE request. It does not touch schema_migrations. Rows it
// writes: the role lists allowed on users and invites, and the system role of three engineering posts.
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const root = path.join(__dirname, '..')
const envLine = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!envLine) { console.error('No DATABASE_URL in backend/.env'); process.exit(1) }
const url = envLine.slice('DATABASE_URL='.length)
const MIGRATION = '250_engineering_staff_roles.sql'
const ROLES = ['civil_technician', 'roads_foreman', 'water_technician']
const TITLES = { civil_technician: 'Civil Technician', roads_foreman: 'Roads Foreman', water_technician: 'Water and Sanitation Technician' }

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)

  const posts = (await c.query(`SELECT title FROM public.admin_org_position WHERE unit_key = 'engineering' AND title = ANY($1)`, [Object.values(TITLES)])).rows
  const check = (await c.query(`SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='users_role_check' AND conrelid='public.users'::regclass) AS ok`)).rows[0].ok
  const missing = [...Object.values(TITLES).filter((t) => !posts.some((p) => p.title === t)).map((t) => `post "${t}" (migration 249)`), ...(check ? [] : ['users_role_check'])]
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks:\n  ' + missing.join('\n  ')); process.exit(1) }
  console.log('prerequisites: all present')

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const def = (await c.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='users_role_check' AND conrelid='public.users'::regclass`)).rows[0].d
    const inv = (await c.query(`SELECT pg_get_constraintdef(oid) d FROM pg_constraint WHERE conname='invites_role_check'`)).rows[0]?.d ?? ''
    const roled = (await c.query(`SELECT title, system_role FROM public.admin_org_position WHERE unit_key = 'engineering' AND system_role = ANY($1)`, [ROLES])).rows
    const after = {
      users_allow: ROLES.filter((r) => def.includes(`'${r}'`)),
      invites_allow: ROLES.filter((r) => inv.includes(`'${r}'`)),
      posts: roled.map((r) => `${r.title}=${r.system_role}`),
    }
    console.log('after the change (inside the transaction):', JSON.stringify(after))
    const ok = after.users_allow.length === 3 && (!inv || after.invites_allow.length === 3)
      && ROLES.every((r) => roled.some((p) => p.system_role === r && p.title === TITLES[r]))
    if (!ok) throw new Error('the change did not leave what 250 promises')
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied on live.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
