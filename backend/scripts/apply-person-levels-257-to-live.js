#!/usr/bin/env node
// Targeted change for the LIVE database: applies migration 257 (one register of persons with four levels: the evidence and
// the computed level on registry.person, its history, the council's record of Registrar-General checks, the account
// mirroring the register, and every online citizen account brought into the register) and nothing else. Same pattern as
// 242 to 256.
//
// It never applies 258 (the PROTOTYPE Registrar-General service): that is fictional data for demonstration, and the live
// system runs with the check switched off (RG_MODE defaults to 'off' in production).
//
// Apply it BEFORE deploying the code that reads it (persons.js reads assurance_level; sign-up writes the register).
//
//   node scripts/apply-person-levels-257-to-live.js            dry run: everything runs, then ROLLBACK
//   node scripts/apply-person-levels-257-to-live.js --apply    the same, then COMMIT
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
const MIGRATION = '257_person_assurance_levels.sql'

const STATE = `SELECT
    (SELECT count(*)::int FROM registry.person) AS persons,
    (SELECT count(*)::int FROM public.users WHERE role IN ('registered', 'public')) AS citizen_accounts,
    (SELECT count(*)::int FROM public.users WHERE role IN ('registered', 'public') AND person_id IS NOT NULL) AS citizen_accounts_in_register,
    (SELECT count(*)::int FROM public.citizen_documents WHERE doc_kind IN ('national_id', 'passport') AND verification_status = 'verified' AND verified_by IS NOT NULL) AS id_documents_approved_by_officer,
    (SELECT count(*)::int FROM public.users WHERE role IN ('registered', 'public') AND residency_status = 'verified') AS citizens_resident_on_account`

;(async () => {
  const c = new Client({ connectionString: url, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)
  const pre = (await c.query(`SELECT
      to_regclass('registry.person') IS NOT NULL AS register_256,
      to_regclass('public.citizen_documents') IS NOT NULL AS citizen_documents,
      to_regprocedure('tenancy.make_tenant(regclass,text)') IS NOT NULL AS make_tenant,
      to_regprocedure('registry.identifier_well_formed(text,text)') IS NOT NULL AS identifier_functions,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'person_id') AS users_person,
      EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'residency_status') AS users_residency,
      EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') AS vungu`)).rows[0]
  const missing = Object.entries(pre).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks: ' + missing.join(', ')); process.exit(1) }
  console.log('prerequisites: all present')
  console.log('before:', JSON.stringify((await c.query(STATE)).rows[0]))

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const after = (await c.query(STATE)).rows[0]
    const levels = (await c.query(`SELECT assurance_level, source, count(*)::int AS n FROM registry.person GROUP BY 1, 2 ORDER BY 1, 2`)).rows
    const rls = (await c.query(`SELECT c.relname, c.relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                                 WHERE n.nspname = 'registry' AND c.relname IN ('assurance_event', 'identity_check') ORDER BY 1`)).rows
    const prototype = (await c.query(`SELECT to_regnamespace('rg_prototype') IS NOT NULL AS present`)).rows[0].present
    console.log('after (inside the transaction):', JSON.stringify(after))
    console.log('persons by level and source:', JSON.stringify(levels))
    console.log('row-level security:', JSON.stringify(rls), '| prototype Registrar-General on live:', prototype)
    const ok = rls.length === 2 && rls.every((r) => r.relrowsecurity) && !prototype
      && after.citizen_accounts_in_register >= after.citizen_accounts - 1
    if (!ok) throw new Error('the change did not leave what 257 promises')
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied on live.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: everything ran and was rolled back. Nothing on live changed. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back, nothing on live changed:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
