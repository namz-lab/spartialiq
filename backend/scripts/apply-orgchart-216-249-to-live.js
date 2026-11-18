#!/usr/bin/env node
// Targeted change for the LIVE database: completes migration 216's organisation-chart step, then applies migration 249,
// in ONE transaction. Same pattern as the scripts for 242 to 248.
//
// WHY. On live, 216's roles and ward measures are in place, but its organisation-chart step left the chart as it was:
// the Chief Executive post still carries 'admin', no post belongs to a unit, and the Finance, Engineer, HR / Social
// Services / Administration and Internal Audit heads are missing (the step ran before live's chart was seeded, and
// found nothing to update). Without the Engineer post, 249 has nothing to put the engineering posts under.
//
//   1. 216, step 2 only (the DO block that follows "-- ── 2. The establishment"): the Chief Executive post becomes the
//      accounting officer's; the Planning & Environment posts get unit 'planning'; the four other heads are added,
//      vacant, under the Chief Executive (none is added where the unit already has a post under the Chief Executive).
//   2. 249: admin_org_position.section, and the eleven engineering posts under the Engineer.
//
//   node scripts/apply-orgchart-216-249-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-orgchart-216-249-to-live.js --apply    the same, then COMMIT
//
// Reads DATABASE_URL from backend/.env. It does not touch schema_migrations. Rows it writes: the organisation chart only
// (admin_org_position): one post's role, the planning posts' unit, four head posts, one column, eleven engineering posts.
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const root = path.join(__dirname, '..')
const envLine = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!envLine) { console.error('No DATABASE_URL in backend/.env'); process.exit(1) }
const url = envLine.slice('DATABASE_URL='.length)

// 216's organisation-chart step, taken from the migration itself so the two cannot drift.
const m216 = fs.readFileSync(path.join(root, 'migrations', '216_executive_units.sql'), 'utf8').replace(/\r\n/g, '\n')
const from = m216.indexOf('DO $$\nDECLARE\n  v_ceo uuid;')
const to = m216.indexOf('END $$;', from)
if (from < 0 || to < 0) { console.error("Could not find 216's organisation-chart step"); process.exit(1) }
const step216 = m216.slice(from, to + 'END $$;'.length)
const m249 = fs.readFileSync(path.join(root, 'migrations', '249_engineering_unit_posts.sql'), 'utf8')

// the chart as a list; `section` exists only once 249 has run
const CHART = (withSection) => `SELECT p.unit_key, ${withSection ? 'p.section, ' : ''}p.title, p.system_role, r.title AS reports_to
                 FROM public.admin_org_position p LEFT JOIN public.admin_org_position r ON r.id = p.reports_to
                ORDER BY p.unit_key NULLS FIRST, ${withSection ? 'p.section NULLS FIRST, ' : ''}p.sort_order, p.title`

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)

  const pre = (await c.query(`SELECT
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='admin_org_position' AND column_name='unit_key') AS unit_key_column,
      EXISTS (SELECT 1 FROM public.admin_org_position WHERE reports_to IS NULL AND title = 'Chief Executive Officer') AS ceo_post,
      position('''engineer''' IN pg_get_constraintdef((SELECT oid FROM pg_constraint WHERE conname='users_role_check' AND conrelid='public.users'::regclass))) > 0 AS engineer_role`)).rows[0]
  const missing = Object.entries(pre).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks: ' + missing.join(', ')); process.exit(1) }
  console.log('prerequisites: all present')
  console.log('chart before:'); for (const r of (await c.query(CHART(false))).rows) console.log('  ', JSON.stringify(r))

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;', step216, m249].join('\n')
  try {
    await c.query(script)
    const after = (await c.query(`SELECT
        (SELECT system_role FROM public.admin_org_position WHERE reports_to IS NULL AND title = 'Chief Executive Officer' ORDER BY created_at LIMIT 1) AS ceo_role,
        (SELECT count(*)::int FROM public.admin_org_position WHERE department = 'Planning & Environment' AND unit_key IS DISTINCT FROM 'planning') AS planning_without_unit,
        (SELECT array_agg(unit_key ORDER BY unit_key) FROM (SELECT DISTINCT unit_key FROM public.admin_org_position WHERE unit_key IS NOT NULL) u) AS units,
        (SELECT count(*)::int FROM public.admin_org_position WHERE unit_key = 'engineering') AS engineering_posts,
        (SELECT count(*)::int FROM public.admin_org_position WHERE unit_key = 'engineering' AND system_role IS NULL AND section IS NULL) AS engineering_without_section`)).rows[0]
    console.log('after the change (inside the transaction):', JSON.stringify(after))
    console.log('chart after:'); for (const r of (await c.query(CHART(true))).rows) console.log('  ', JSON.stringify(r))
    const ok = after.ceo_role === 'accounting_officer' && after.planning_without_unit === 0 && (after.units || []).length === 5
      && after.engineering_posts >= 12 && after.engineering_without_section === 0
    if (!ok) throw new Error('the change did not leave what 216 and 249 promise')
    if (APPLY) { await c.query('COMMIT'); console.log("COMMITTED: 216's organisation-chart step and 249 are applied on live.") }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
