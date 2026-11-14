/**
 * seed-all-demo.js
 *
 * Run every demo seed, in dependency order.
 *
 * Users first, because every other script looks a user up by email. Then
 * the planner seed, which creates the committee meetings the golden thread
 * puts its agenda item on — run the other way round on an empty database,
 * the thread finds no meeting and silently skips the item. Then the golden
 * thread, because the per-role scripts attach to the case it creates. Order
 * among the rest does not matter.
 *
 *     node scripts/seed-all-demo.js
 *     node scripts/seed-all-demo.js --undo    # reverse order
 *
 * Each script owns its own transaction, so one failing cannot leave another
 * half-written. The runner keeps going and reports at the end rather than
 * stopping at the first failure, which would leave some portals populated
 * and some not, with no summary of which.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const { execFileSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')
const { Client } = require('pg')

const SCRIPTS = [
  'seed-demo-users.js',
  'seed-planner-demo.js',
  'seed-golden-thread.js',
  'seed-inspector-demo.js',
  'seed-inspector-register.js',
  'seed-eho-office.js',
  'seed-surveyor-demo.js',
  'seed-gis-officer-demo.js',
  'seed-admin-demo.js',
  // The Chief Executive's overview: road, water and asset registers and the audit plan. Needs only the users.
  'seed-executive-demo.js',
  // Last, and only dependent on the users: it creates its own financial year, classifications,
  // budget lines and a year of transactions under the `DD-` prefix, and removes them again on
  // --undo. It is what makes the finance reports and the Director's cockpit demonstrable — those
  // screens are correct but unreadable against the four hand-made budget lines that preceded it.
  'seed-finance-director-demo.js',
]

// seed-demo-users.js refuses to run without these, and it has no --undo: accounts are the one thing
// every other script depends on. The password is the documented demo one (README, "Sign in"); set
// DEMO_DEFAULT_PASSWORD to use another.
const USER_SEED_ENV = {
  ...process.env,
  DEMO_SEED_ENABLED: 'true',
  DEMO_DEFAULT_PASSWORD: process.env.DEMO_DEFAULT_PASSWORD || 'demo1234',
}

if (process.env.NODE_ENV === 'production') {
  console.error('Refusing to seed demo data in production.')
  process.exit(1)
}

/**
 * Two things every seed script needs and none of them can supply for itself.
 *
 *  1. public.seed_demo_ledger, the side table --undo reads (migration 123). It is demo-only by
 *     design (see its header), so it is not in the production migration chain; it is applied here.
 *  2. The council. Since the tenancy migrations (154-169) most tables take authority_id from
 *     app.authority_id(), a session setting, so a seed run without it fails on the first
 *     NOT NULL. Every child process is started with the pilot council already set, through
 *     PGOPTIONS, which the pg driver reads.
 */
async function prepare() {
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try {
    await client.query(fs.readFileSync(path.join(__dirname, '..', 'migrations', '123_seed_demo_ledger.sql'), 'utf8'))
    const { rows } = await client.query("SELECT id FROM public.local_authorities WHERE code = 'VUNGU'")
    if (!rows[0]) throw new Error("local authority 'VUNGU' not found; run the migrations first")
    return rows[0].id
  } finally {
    await client.end()
  }
}

const undoing = process.argv.includes('--undo')
const order = undoing ? [...SCRIPTS].reverse() : SCRIPTS
const failed = []

async function main() {
  const authorityId = await prepare()
  USER_SEED_ENV.PGOPTIONS = [process.env.PGOPTIONS, `-c app.authority_id=${authorityId}`].filter(Boolean).join(' ')

  for (const script of order) {
    if (undoing && script === 'seed-demo-users.js') continue // no --undo; keep the accounts
    process.stdout.write(`\n=== ${undoing ? 'undo' : 'seed'} ${script} ===\n`)
    try {
      execFileSync(
        process.execPath,
        [path.join(__dirname, script), ...(undoing ? ['--undo'] : [])],
        { stdio: 'inherit', env: USER_SEED_ENV },
      )
    } catch (_) {
      failed.push(script)
      process.stdout.write(`!! ${script} failed; continuing\n`)
    }
  }

  if (failed.length) {
    console.error(`\n${failed.length} script(s) failed: ${failed.join(', ')}`)
    process.exit(1)
  }
  console.log(`\n${undoing ? 'All demo data removed.' : 'All demo data seeded.'}`)
}

main().catch((e) => { console.error(e.message || e); process.exit(1) })
