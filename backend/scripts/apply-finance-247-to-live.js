#!/usr/bin/env node
// Targeted schema change for the LIVE database: applies migration 247 (an inspection fee paid at the
// cash office releases the inspection booking) and nothing else. Needs 246 on live first.
//
// Why not `npm run migrate`: live's schema_migrations table does not match the repo, so the migrator
// would try to re-run about 170 migrations. This runs only this one idempotent file and does not touch
// schema_migrations.
//
//   node scripts/apply-finance-247-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-finance-247-to-live.js --apply    the same, then COMMIT
//
// Reads DATABASE_URL from backend/.env. ONE transaction sent as ONE request. Rows it may write: it
// releases inspection bookings already paid for at the cash office (none on live when written).
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const root = path.join(__dirname, '..')
const envLine = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!envLine) { console.error('No DATABASE_URL in backend/.env'); process.exit(1) }
const url = envLine.slice('DATABASE_URL='.length)
const MIGRATION = '247_cash_office_inspection_fee_releases_booking.sql'

const NEEDS = [
  ['relation', 'finance.planning_fee'], ['relation', 'finance.cash_receipt'], ['relation', 'finance.cash_receipt_line'],
  ['relation', 'finance.income_code'], ['relation', 'public.inspection_bookings'], ['relation', 'public.inspection_status_events'],
  ['relation', 'spatial_planning.permit_application'],
  ['function', 'finance.record_cash_receipt(uuid,uuid,text,finance.currency_code,text,jsonb,uuid,uuid,text,text)'],
  ['function', 'finance.sync_planning_application_fee_paid(uuid)'],
  ['function', 'tenancy.make_tenant(regclass,text)'], ['function', 'tenancy.classify(text,text,text)'],
]
const COLUMNS = {
  'public.inspection_bookings': ['id', 'application_id', 'stage_number', 'status', 'fee_paid_at', 'updated_at'],
  'public.inspection_status_events': ['booking_id', 'from_status', 'to_status', 'actor_id', 'actor_role', 'notes'],
  'spatial_planning.permit_application': ['id', 'authority_id', 'tpd_reference', 'dev_register_no', 'dev_app_id'],
  'finance.income_code': ['planning_fee_kind'],
}

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)
  const missing = []
  for (const [kind, name] of NEEDS) {
    const sql = kind === 'relation' ? 'SELECT to_regclass($1) IS NOT NULL ok' : 'SELECT to_regprocedure($1) IS NOT NULL ok'
    if (!(await c.query(sql, [name])).rows[0].ok) missing.push(`${kind} ${name}`)
  }
  for (const [rel, cols] of Object.entries(COLUMNS)) {
    const [s, t] = rel.split('.')
    const have = new Set((await c.query(
      `SELECT a.attname FROM pg_attribute a JOIN pg_class k ON k.oid=a.attrelid JOIN pg_namespace n ON n.oid=k.relnamespace
        WHERE n.nspname=$1 AND k.relname=$2 AND a.attnum>0 AND NOT a.attisdropped`, [s, t])).rows.map((r) => r.attname))
    for (const col of cols) if (!have.has(col)) missing.push(`column ${rel}.${col}`)
  }
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks:\n  ' + missing.join('\n  ')); process.exit(1) }
  console.log('prerequisites: all present')

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const after = (await c.query(`SELECT
        to_regclass('finance.planning_fee_booking') IS NOT NULL AS link_table,
        to_regprocedure('finance.release_paid_inspections(uuid,uuid)') IS NOT NULL AS release_fn,
        EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_inspection_booking_released_if_paid') AS booking_trigger,
        position('release_paid_inspections' IN pg_get_functiondef('finance.record_planning_fee_receipt(uuid,uuid,uuid,text,finance.currency_code,text,jsonb,uuid,uuid,text,text)'::regprocedure)) > 0 AS receipt_releases,
        (SELECT count(*)::int FROM finance.planning_fee_booking) AS bookings_released,
        (SELECT count(*)::int FROM pg_policies WHERE schemaname='finance' AND tablename='planning_fee_booking') AS tenant_policies`)).rows[0]
    console.log('after the change (inside the transaction):', JSON.stringify(after))
    if (!(after.link_table && after.release_fn && after.booking_trigger && after.receipt_releases && after.tenant_policies >= 2)) {
      throw new Error('the change did not leave what 247 promises')
    }
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied on live.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
