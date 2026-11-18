#!/usr/bin/env node
// Targeted schema change for the LIVE database: applies migration 248 (sending the acknowledgement moves a case from
// 'registered' to 'acknowledged') and nothing else. Needs 171 on live first (its trigger is what 248 extends).
//
// Why not `npm run migrate`: live's schema_migrations table does not match the repo, so the migrator would try to re-run
// many migrations. This runs only this one idempotent file and does not touch schema_migrations (as for 242 to 247).
//
//   node scripts/apply-planning-248-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-planning-248-to-live.js --apply    the same, then COMMIT
//
// Reads DATABASE_URL from backend/.env. ONE transaction sent as ONE request. Rows it may write: cases whose acknowledgement
// letter was already sent but which were left 'registered' are moved to 'acknowledged', each with an audit entry.
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const root = path.join(__dirname, '..')
const envLine = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!envLine) { console.error('No DATABASE_URL in backend/.env'); process.exit(1) }
const url = envLine.slice('DATABASE_URL='.length)
const MIGRATION = '248_acknowledgement_moves_case_on.sql'

const COLUMNS = {
  'spatial_planning.permit_application': ['id', 'status', 'revision', 'acknowledged_at', 'updated_at'],
  'spatial_planning.clerk_acknowledgement': ['permit_application_id', 'letter_no', 'sent_at', 'voided_at'],
  'spatial_planning.permit_event': ['permit_app_id', 'event_type', 'actor_id', 'actor_role', 'detail'],
}
const STUCK = `SELECT count(DISTINCT p.id)::int AS n
                 FROM spatial_planning.permit_application p
                 JOIN spatial_planning.clerk_acknowledgement a
                   ON a.permit_application_id = p.id AND a.sent_at IS NOT NULL AND a.voided_at IS NULL
                WHERE p.status = 'registered'`

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)

  const missing = []
  for (const [rel, cols] of Object.entries(COLUMNS)) {
    const [s, t] = rel.split('.')
    const have = new Set((await c.query(
      `SELECT a.attname FROM pg_attribute a JOIN pg_class k ON k.oid=a.attrelid JOIN pg_namespace n ON n.oid=k.relnamespace
        WHERE n.nspname=$1 AND k.relname=$2 AND a.attnum>0 AND NOT a.attisdropped`, [s, t])).rows.map((r) => r.attname))
    if (!have.size) missing.push(`relation ${rel}`)
    else for (const col of cols) if (!have.has(col)) missing.push(`column ${rel}.${col}`)
  }
  const t171 = (await c.query(`SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clerk_ack_records_date') AS ok`)).rows[0].ok
  if (!t171) missing.push('trigger trg_clerk_ack_records_date (migration 171)')
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks:\n  ' + missing.join('\n  ')); process.exit(1) }
  console.log('prerequisites: all present')

  const before = (await c.query(STUCK)).rows[0].n
  console.log(`cases acknowledged by a sent letter but still 'registered': ${before}`)

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const after = (await c.query(`SELECT
        position('status = ''acknowledged''' IN pg_get_functiondef('spatial_planning.clerk_ack_records_date()'::regprocedure)) > 0 AS trigger_moves_status,
        EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_clerk_ack_records_date') AS trigger_in_place,
        (${STUCK}) AS still_stuck,
        (SELECT count(*)::int FROM spatial_planning.permit_event WHERE detail->>'reason' LIKE 'Migration 248%') AS moved_now`)).rows[0]
    console.log('after the change (inside the transaction):', JSON.stringify(after))
    if (!(after.trigger_moves_status && after.trigger_in_place && after.still_stuck === 0 && after.moved_now >= before)) {
      throw new Error('the change did not leave what 248 promises')
    }
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied on live.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
