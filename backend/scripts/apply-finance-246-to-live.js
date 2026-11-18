#!/usr/bin/env node
// Targeted schema change for the LIVE database: applies migration 246 (planning fees in the ledger)
// and nothing else.
//
// Why not `npm run migrate`: live's schema_migrations table does not match the repo, so the migrator
// would try to re-run about 170 migrations. This script runs only this one file, which is written to
// be idempotent, and does not touch schema_migrations.
//
//   node scripts/apply-finance-246-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-finance-246-to-live.js --apply    the same, then COMMIT
//
// ORDER MATTERS: apply this BEFORE the code that reads it reaches live. The planning clerk's overview
// and the cash office read finance.v_planning_fee, so code deployed first would fail on those pages.
//
// What 246 writes besides structure: the two finance.planning_fees.* permissions and their role
// grants, and one finance.planning_fee row ("awaiting a voucher") for each planning fee already paid
// online. It creates no income code and no payment channel (decision D22: the council enters them).
//
// Reads DATABASE_URL from backend/.env. ONE transaction sent as ONE request, so a dropped connection
// cannot leave it half applied.
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const root = path.join(__dirname, '..')
const envLine = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!envLine) { console.error('No DATABASE_URL in backend/.env'); process.exit(1) }
const url = envLine.slice('DATABASE_URL='.length)
const MIGRATION = '246_planning_fees_in_the_ledger.sql'

// Everything 246 names: relations, functions, and the columns its functions and view read.
const RELATIONS = [
  'public.local_authorities', 'public.users', 'public.payments', 'spatial_planning.permit_application',
  'finance.income_code', 'finance.cash_receipt', 'finance.cash_receipt_line', 'finance.voucher',
  'finance.voucher_line', 'finance.ledger_account', 'finance.financial_year', 'finance.permission',
  'finance.role_permission',
]
const COLUMNS = {
  'public.payments': ['id', 'purpose', 'related_kind', 'related_id', 'payer_email', 'amount_usd', 'amount_zwg',
    'wallet_ccy', 'driver', 'status', 'paid_at', 'issued_receipt_no', 'provider_ref'],
  'spatial_planning.permit_application': ['id', 'authority_id', 'tpd_reference', 'dev_register_no', 'stand_number',
    'applicant_name', 'status', 'fee_paid_at', 'updated_at'],
  'finance.income_code': ['id', 'authority_id', 'code', 'name', 'ledger_account_id', 'department_id', 'status', 'deleted_at'],
  'finance.cash_receipt': ['id', 'authority_id', 'receipt_no', 'payer_name', 'currency', 'received_on', 'voucher_id',
    'method', 'cancelled_at'],
  'finance.cash_receipt_line': ['cash_receipt_id', 'income_code_id', 'amount'],
  'finance.voucher': ['id', 'authority_id', 'voucher_no', 'voucher_type', 'currency', 'financial_year_id', 'posting_date',
    'narration', 'reference', 'status', 'prepared_by', 'posted_at'],
  'finance.ledger_account': ['id', 'code', 'name', 'account_type', 'is_postable', 'status', 'deleted_at'],
  'finance.financial_year': ['id', 'authority_id', 'status', 'start_date', 'end_date', 'deleted_at'],
  'finance.permission': ['code', 'label', 'category', 'is_approval', 'is_publication', 'is_restricted', 'description'],
}
const FUNCTIONS = [
  'app.authority_id()', 'tenancy.make_tenant(regclass,text)', 'tenancy.classify(text,text,text)',
  'finance.record_cash_receipt(uuid,uuid,text,finance.currency_code,text,jsonb,uuid,uuid,text,text)',
  'finance.next_document_no(integer,text)', 'gen_random_uuid()',
]

const AFTER = `
  SELECT
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'finance'
        AND table_name = 'income_code' AND column_name = 'planning_fee_kind')                    AS income_code_column,
    to_regclass('finance.payment_channel') IS NOT NULL                                          AS payment_channel,
    to_regclass('finance.planning_fee') IS NOT NULL                                             AS planning_fee,
    to_regclass('finance.v_planning_fee') IS NOT NULL                                           AS planning_fee_view,
    to_regprocedure('finance.record_planning_fee_receipt(uuid,uuid,uuid,text,finance.currency_code,text,jsonb,uuid,uuid,text,text)') IS NOT NULL AS counter_receipt_fn,
    to_regprocedure('finance.note_online_planning_fee(uuid)') IS NOT NULL                       AS note_online_fn,
    to_regprocedure('finance.prepare_online_planning_fee_vouchers(uuid,uuid[])') IS NOT NULL    AS prepare_fn,
    EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_cash_receipt_planning_fee_cancelled')  AS cancel_trigger,
    (SELECT count(*)::int FROM finance.permission WHERE code LIKE 'finance.planning_fees.%')      AS permissions,
    (SELECT count(*)::int FROM finance.role_permission WHERE permission_code LIKE 'finance.planning_fees.%') AS grants,
    (SELECT count(*)::int FROM pg_policies WHERE schemaname = 'finance'
        AND tablename IN ('payment_channel', 'planning_fee'))                                   AS tenant_policies`

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  const notices = []
  c.on('notice', (n) => notices.push(n.message))
  await c.connect()
  const db = (await c.query(`SELECT current_database() db, current_user u, version() v`)).rows[0]
  console.log(`database ${db.db} as ${db.u}: ${db.v.split(',')[0]}`)

  const missing = []
  for (const r of RELATIONS) if (!(await c.query('SELECT to_regclass($1) IS NOT NULL ok', [r])).rows[0].ok) missing.push(`relation ${r}`)
  for (const f of FUNCTIONS) {
    const ok = (await c.query('SELECT to_regprocedure($1) IS NOT NULL ok', [f]).catch(() => ({ rows: [{ ok: false }] }))).rows[0].ok
    if (!ok) missing.push(`function ${f}`)
  }
  for (const [rel, cols] of Object.entries(COLUMNS)) {
    if (missing.includes(`relation ${rel}`)) continue
    const [s, t] = rel.split('.')
    const have = new Set((await c.query(
      `SELECT a.attname FROM pg_attribute a JOIN pg_class k ON k.oid = a.attrelid JOIN pg_namespace n ON n.oid = k.relnamespace
        WHERE n.nspname = $1 AND k.relname = $2 AND a.attnum > 0 AND NOT a.attisdropped`, [s, t])).rows.map((r) => r.attname))
    for (const col of cols) if (!have.has(col)) missing.push(`column ${rel}.${col}`)
  }
  if (missing.length) {
    console.error('NOT ATTEMPTED. Live lacks what 246 builds on:\n  ' + missing.join('\n  '))
    process.exit(1)
  }
  console.log('prerequisites: all present')

  const before = (await c.query(
    `SELECT count(*)::int AS paid_online_planning_fees FROM public.payments
      WHERE status = 'paid' AND purpose IN ('application_fee','inspection_fee','occupation_certificate','permit_fee','property_search')`)).rows[0]
  console.log('planning fees already paid online (each will be noted as awaiting a voucher):', before.paid_online_planning_fees)

  const script = [
    'BEGIN;',
    "SET LOCAL lock_timeout = '15s';",
    'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8'),
  ].join('\n')

  try {
    await c.query(script)
    const after = (await c.query(AFTER)).rows[0]
    console.log('after the change (inside the transaction):', JSON.stringify(after))
    const noted = (await c.query(
      `SELECT state, source, fee_kind, currency, count(*)::int AS n, sum(amount)::text AS amount
         FROM finance.v_planning_fee GROUP BY 1,2,3,4 ORDER BY 1,2,3,4`)).rows
    console.log('finance.v_planning_fee reads:', JSON.stringify(noted))
    // The clerk's overview query, as the new code runs it, must work.
    await c.query(`SELECT count(*) FROM finance.v_planning_fee WHERE source = 'counter' AND state <> 'cancelled'`)
    const ok = after.income_code_column === 1 && after.payment_channel && after.planning_fee && after.planning_fee_view
      && after.counter_receipt_fn && after.note_online_fn && after.prepare_fn && after.cancel_trigger
      && after.permissions === 2 && after.tenant_policies >= 4
    if (!ok) throw new Error('the change did not leave what 246 promises')
    if (APPLY) {
      await c.query('COMMIT')
      console.log(`COMMITTED: ${MIGRATION} is applied on live.`)
    } else {
      await c.query('ROLLBACK')
      console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.')
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally {
    const shown = notices.filter((m) => !/does not exist, skipping|already exists, skipping/.test(m))
    if (shown.length) console.log('notices:\n  ' + shown.join('\n  '))
    await c.end().catch(() => {})
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
