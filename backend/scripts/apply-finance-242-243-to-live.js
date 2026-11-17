#!/usr/bin/env node
// Targeted schema change for the LIVE database: applies migrations 242 (ledger reporting, voucher
// integrity, year-end close as a draft) and 243 (the salaries journal) and nothing else.
//
// Why not `npm run migrate`: live's schema_migrations table does not match the repo, so the migrator
// would try to re-run about 170 migrations. This script runs only these two files, both written to be
// idempotent, and does not touch schema_migrations.
//
//   node scripts/apply-finance-242-243-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-finance-242-243-to-live.js --apply    the same, then COMMIT
//
// Reads DATABASE_URL from backend/.env. The whole change is ONE transaction sent as ONE request, so a
// dropped connection cannot leave it half applied. It writes no rows other than what 242 itself
// writes: two finance.role_permission grants to 'accountant', and the legacy_duplicate_reversal mark
// on any second posted reversal of a voucher (named in a NOTICE if any is found).
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const root = path.join(__dirname, '..')
const envLine = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
if (!envLine) { console.error('No DATABASE_URL in backend/.env'); process.exit(1) }
const url = envLine.slice('DATABASE_URL='.length)
const sql = (f) => fs.readFileSync(path.join(root, 'migrations', f), 'utf8')

// What 242 and 243 build on (migrations 203 to 214). If any is missing, the change is not attempted.
const PREREQUISITES = `
  SELECT x.what FROM (VALUES
    ('table finance.voucher', to_regclass('finance.voucher') IS NOT NULL),
    ('table finance.voucher_line', to_regclass('finance.voucher_line') IS NOT NULL),
    ('table finance.ledger_entry', to_regclass('finance.ledger_entry') IS NOT NULL),
    ('table finance.ledger_account', to_regclass('finance.ledger_account') IS NOT NULL),
    ('table finance.ledger_period', to_regclass('finance.ledger_period') IS NOT NULL),
    ('table finance.financial_year', to_regclass('finance.financial_year') IS NOT NULL),
    ('table finance.document_sequence', to_regclass('finance.document_sequence') IS NOT NULL),
    ('table finance.role_permission', to_regclass('finance.role_permission') IS NOT NULL),
    ('table finance.permission', to_regclass('finance.permission') IS NOT NULL),
    ('table finance.party', to_regclass('finance.party') IS NOT NULL),
    ('table finance.department', to_regclass('finance.department') IS NOT NULL),
    ('table finance.programme', to_regclass('finance.programme') IS NOT NULL),
    ('table finance.activity', to_regclass('finance.activity') IS NOT NULL),
    ('table finance.project', to_regclass('finance.project') IS NOT NULL),
    ('table finance.budget_line', to_regclass('finance.budget_line') IS NOT NULL),
    ('type finance.currency_code', to_regtype('finance.currency_code') IS NOT NULL),
    ('function finance.post_voucher', EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'finance' AND p.proname = 'post_voucher')),
    ('function finance.reverse_voucher(uuid,uuid,uuid,text,date,text)', to_regprocedure('finance.reverse_voucher(uuid,uuid,uuid,text,date,text)') IS NOT NULL),
    ('permission finance.ledger.account.manage', EXISTS (SELECT 1 FROM finance.permission WHERE code = 'finance.ledger.account.manage')),
    ('permission finance.ledger.close_year', EXISTS (SELECT 1 FROM finance.permission WHERE code = 'finance.ledger.close_year'))
  ) AS x(what, present) WHERE NOT x.present`

// After the change, inside the same transaction: what the two migrations promise.
const AFTER = `
  SELECT
    to_regprocedure('finance.ledger_balances(uuid,date,text)') IS NOT NULL                       AS ledger_balances,
    to_regprocedure('finance.year_closed(uuid,text)') IS NOT NULL                                AS year_closed,
    to_regprocedure('finance.raise_reversal(uuid,uuid,text,date,text)') IS NOT NULL               AS raise_reversal,
    to_regprocedure('finance.raise_year_closing(uuid,text,uuid,text,date)') IS NOT NULL           AS raise_year_closing,
    (SELECT count(*)::int FROM information_schema.columns WHERE table_schema = 'finance' AND table_name = 'voucher'
        AND column_name IN ('version', 'legacy_duplicate_reversal'))                              AS voucher_new_columns,
    (SELECT pg_get_constraintdef(oid) LIKE '%payroll%' FROM pg_constraint
      WHERE conrelid = 'finance.voucher'::regclass AND conname = 'voucher_type_known')            AS payroll_type,
    (SELECT count(*)::int FROM finance.voucher WHERE legacy_duplicate_reversal)                   AS duplicate_reversals_marked,
    (SELECT count(*)::int FROM finance.role_permission WHERE role_name = 'accountant'
        AND permission_code IN ('finance.ledger.account.manage', 'finance.ledger.close_year'))   AS accountant_grants`

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 300000, keepAlive: true })
  c.on('error', () => {})
  const notices = []
  c.on('notice', (n) => notices.push(n.message))
  await c.connect()
  const db = (await c.query(`SELECT current_database() db, current_user u, version() v`)).rows[0]
  console.log(`database ${db.db} as ${db.u}: ${db.v.split(',')[0]}`)

  const missing = (await c.query(PREREQUISITES)).rows.map((r) => r.what)
  if (missing.length) {
    console.error('NOT ATTEMPTED. Live lacks what 242 and 243 build on:\n  ' + missing.join('\n  '))
    process.exit(1)
  }
  console.log('prerequisites: all present')

  // Live data the two widened CHECKs must accept (242 and 243 replace them; a row outside would fail).
  const odd = (await c.query(`
    SELECT 'voucher_type ' || voucher_type AS v FROM finance.voucher
     WHERE voucher_type NOT IN ('opening','journal','rates_bill','receipt','credit_note','write_off','closing','reversal',
                                'supplier_invoice','payment','depreciation','asset_disposal','payroll')
    UNION
    SELECT 'document_sequence kind ' || kind FROM finance.document_sequence
     WHERE kind NOT IN ('receipt','cashier_session','bank_deposit','opening','supplier_invoice','payment','asset',
                        'depreciation','asset_disposal','journal','credit_note','write_off','closing','payroll')`)).rows
  if (odd.length) {
    console.error('NOT ATTEMPTED. Live holds rows the new checks would refuse:\n  ' + odd.map((r) => r.v).join('\n  '))
    process.exit(1)
  }

  const script = [
    'BEGIN;',
    "SET LOCAL lock_timeout = '15s';",
    'SET LOCAL statement_timeout = 0;',
    sql('242_finance_ledger_reporting.sql'),
    sql('243_finance_payroll_journal.sql'),
    // Kept so the AFTER read below can run inside this transaction before it ends.
  ].join('\n')

  try {
    await c.query(script)
    const after = (await c.query(AFTER)).rows[0]
    console.log('after the change (inside the transaction):', JSON.stringify(after))
    const ok = after.ledger_balances && after.year_closed && after.raise_reversal && after.raise_year_closing
      && after.voucher_new_columns === 2 && after.payroll_type && after.accountant_grants === 2
    if (!ok) throw new Error('the change did not leave what 242 and 243 promise')
    if (APPLY) {
      await c.query('COMMIT')
      console.log('COMMITTED: 242 and 243 are applied on live.')
    } else {
      await c.query('ROLLBACK')
      console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.')
    }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally {
    if (notices.length) console.log('notices:\n  ' + notices.join('\n  '))
    await c.end().catch(() => {})
  }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
