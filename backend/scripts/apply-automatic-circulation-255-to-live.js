#!/usr/bin/env node
// Targeted change for the LIVE database: applies migration 255 (automatic circulation: the circulation rules, the function
// that applies them, the trigger that runs it when a case is acknowledged, and the circulation of the cases already
// acknowledged) and nothing else. Same pattern as 242 to 254.
//
// Apply it BEFORE deploying the code that refuses hand-picked circulation (POST /permit-applications/:id/consultations).
//
//   node scripts/apply-automatic-circulation-255-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-automatic-circulation-255-to-live.js --apply    the same, then COMMIT
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
const MIGRATION = '255_automatic_circulation.sql'

const STATE = `SELECT status, count(*)::int AS cases,
                      sum((SELECT count(*) FROM spatial_planning.application_consultation c WHERE c.permit_app_id = p.id))::int AS referrals
                 FROM spatial_planning.permit_application p GROUP BY status ORDER BY status`

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)
  const pre = (await c.query(`SELECT
      to_regclass('spatial_planning.application_consultation') IS NOT NULL AS application_consultation,
      to_regclass('public.development_activity') IS NOT NULL AS development_activity,
      to_regprocedure('tenancy.make_tenant(regclass,text)') IS NOT NULL AS make_tenant,
      EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') AS vungu,
      (SELECT count(*) FROM public.development_activity WHERE code IN ('new_building','extension','alteration','change_of_use','subdivision','consolidation','rezoning')) = 7 AS development_types`)).rows[0]
  const missing = Object.entries(pre).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks: ' + missing.join(', ')); process.exit(1) }
  console.log('prerequisites: all present')
  console.log('before:', JSON.stringify((await c.query(STATE)).rows))

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const rules = (await c.query(`SELECT COALESCE(development_type, 'every application') AS type, body_name, blocking FROM spatial_planning.circulation_rule ORDER BY sort_order, development_type NULLS FIRST, body_name`)).rows
    const rls = (await c.query(`SELECT relrowsecurity FROM pg_class WHERE oid = 'spatial_planning.circulation_rule'::regclass`)).rows[0].relrowsecurity
    const trig = (await c.query(`SELECT count(*)::int n FROM pg_trigger WHERE tgname = 'trg_permit_circulate'`)).rows[0].n
    const made = (await c.query(`SELECT p.status, p.development_type, string_agg(c.body_name || CASE WHEN c.blocking THEN ' (blocking)' ELSE '' END, ', ' ORDER BY c.body_name) AS referrals
                                   FROM spatial_planning.permit_application p JOIN spatial_planning.application_consultation c ON c.permit_app_id = p.id
                                  WHERE c.task_type = 'circulation' GROUP BY p.id, p.status, p.development_type`)).rows
    console.log('rules:', rules.length, JSON.stringify(rules.map((r) => `${r.type}: ${r.body_name}${r.blocking ? ' (blocking)' : ''}`)))
    console.log('row-level security on the rules:', rls, '| trigger:', trig === 1)
    console.log('cases circulated by the migration:', JSON.stringify(made))
    console.log('after (inside the transaction):', JSON.stringify((await c.query(STATE)).rows))
    const ok = rules.length === 15 && rls && trig === 1
    if (!ok) throw new Error('the change did not leave what 255 promises')
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied on live.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
