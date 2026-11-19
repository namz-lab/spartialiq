#!/usr/bin/env node
// Targeted change for the LIVE database: applies migration 256 (the council's register of persons: registry.person, its
// identifiers, the payer of a cash-office receipt, the links from applications, objections and user accounts, the list of
// records not yet linked, and the backfill from national IDs already on record) and nothing else. Same pattern as 242 to 255.
//
// Apply it BEFORE deploying the code that reads it (src/routes/persons.js; the clerk's file reads applicant_person_id).
//
//   node scripts/apply-person-register-256-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-person-register-256-to-live.js --apply    the same, then COMMIT
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
const MIGRATION = '256_person_register.sql'

const STATE = `SELECT
    (SELECT count(*)::int FROM spatial_planning.permit_application) AS applications,
    (SELECT count(*)::int FROM spatial_planning.permit_application WHERE applicant_id_number IS NOT NULL) AS applications_with_id_number,
    (SELECT count(*)::int FROM spatial_planning.application_objection) AS objections,
    (SELECT count(*)::int FROM public.users WHERE national_id IS NOT NULL) AS users_with_national_id`

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)
  const pre = (await c.query(`SELECT
      to_regclass('spatial_planning.permit_application') IS NOT NULL AS permit_application,
      to_regclass('spatial_planning.application_objection') IS NOT NULL AS application_objection,
      to_regclass('finance.cash_receipt') IS NOT NULL AS cash_receipt,
      to_regprocedure('tenancy.make_tenant(regclass,text)') IS NOT NULL AS make_tenant,
      to_regprocedure('tenancy.classify(text,text,text)') IS NOT NULL AS classify,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'national_id') AS users_national_id,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'authority_id') AS users_authority,
      EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'vungu_app') AS vungu_app,
      EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') AS vungu`)).rows[0]
  const missing = Object.entries(pre).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks: ' + missing.join(', ')); process.exit(1) }
  console.log('prerequisites: all present')
  console.log('before:', JSON.stringify((await c.query(STATE)).rows[0]))

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const rls = (await c.query(`SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                                 WHERE n.nspname = 'registry' AND c.relkind = 'r' ORDER BY 1`)).rows
    const grants = (await c.query(`SELECT has_schema_privilege('vungu_app', 'registry', 'USAGE') AS usage,
                                          has_table_privilege('vungu_app', 'registry.person', 'INSERT') AS insert`)).rows[0]
    const made = (await c.query(`SELECT
        (SELECT count(*)::int FROM registry.person) AS persons,
        (SELECT count(*)::int FROM spatial_planning.permit_application WHERE applicant_person_id IS NOT NULL) AS applications_linked,
        (SELECT count(*)::int FROM spatial_planning.application_objection WHERE objector_person_id IS NOT NULL) AS objections_linked,
        (SELECT count(*)::int FROM public.users WHERE person_id IS NOT NULL) AS accounts_linked,
        (SELECT count(*)::int FROM registry.v_unlinked) AS not_yet_linked`)).rows[0]
    console.log('row-level security:', JSON.stringify(rls), '| app role:', JSON.stringify(grants))
    console.log('backfilled (one person per well-formed national ID on record):', JSON.stringify(made))
    const ok = rls.length === 3 && rls.every((r) => r.relrowsecurity) && grants.usage && grants.insert
    if (!ok) throw new Error('the change did not leave what 256 promises')
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied on live.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
