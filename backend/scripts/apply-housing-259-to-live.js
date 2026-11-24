#!/usr/bin/env node
// Targeted change: applies migration 259 (Housing and Estates) and nothing else.
//
//   node scripts/apply-housing-259-to-live.js            dry run, then ROLLBACK
//   node scripts/apply-housing-259-to-live.js --apply    COMMIT
//
// Prefers the hosted direct URI in ~/.spartialiq/neon-direct.txt; otherwise backend/.env.
const fs = require('fs')
const path = require('path')
const { Client } = require('pg')

const APPLY = process.argv.includes('--apply')
const root = path.join(__dirname, '..')
const neonPath = path.join(require('os').homedir(), '.spartialiq', 'neon-direct.txt')
let url
if (fs.existsSync(neonPath)) url = fs.readFileSync(neonPath, 'utf8').trim()
else {
  const envLine = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('DATABASE_URL='))
  if (!envLine) { console.error('No DATABASE_URL'); process.exit(1) }
  url = envLine.slice('DATABASE_URL='.length)
}
const MIGRATION = '259_housing_and_estates.sql'

;(async () => {
  const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: true }, query_timeout: 600000, keepAlive: true })
  c.on('error', () => {})
  await c.connect()
  const db = (await c.query('SELECT current_database() db, current_user u')).rows[0]
  console.log(`database ${db.db} as ${db.u}`)
  const pre = (await c.query(`SELECT
      to_regclass('land.parcel') IS NOT NULL AS parcel,
      to_regclass('registry.person') IS NOT NULL AS person,
      to_regprocedure('tenancy.make_tenant(regclass,text)') IS NOT NULL AS make_tenant,
      EXISTS (SELECT 1 FROM public.local_authorities WHERE code = 'VUNGU') AS vungu`)).rows[0]
  const missing = Object.entries(pre).filter(([, v]) => !v).map(([k]) => k)
  if (missing.length) { console.error('NOT ATTEMPTED. Live lacks: ' + missing.join(', ')); process.exit(1) }
  console.log('prerequisites: all present')

  const script = ['BEGIN;', "SET LOCAL lock_timeout = '15s';", 'SET LOCAL statement_timeout = 0;',
    fs.readFileSync(path.join(root, 'migrations', MIGRATION), 'utf8')].join('\n')
  try {
    await c.query(script)
    const made = (await c.query(`SELECT
        (SELECT count(*)::int FROM housing.scheme) AS schemes,
        (SELECT count(*)::int FROM housing.v_spatial_stand) AS stands,
        (SELECT count(*)::int FROM housing.waiting_list) AS waiting,
        has_schema_privilege('vungu_app','housing','USAGE') AS app_usage`)).rows[0]
    console.log('housing:', JSON.stringify(made))
    if (!made.schemes) throw new Error('no housing schemes were created from the cadastre')
    if (APPLY) { await c.query('COMMIT'); console.log(`COMMITTED: ${MIGRATION} is applied.`) }
    else { await c.query('ROLLBACK'); console.log('DRY RUN: rolled back. Rerun with --apply to commit.') }
  } catch (e) {
    await c.query('ROLLBACK').catch(() => {})
    console.error('FAILED, rolled back:', e.message)
    process.exitCode = 1
  } finally { await c.end().catch(() => {}) }
})().catch((e) => { console.error('FAILED:', e.message); process.exit(1) })
