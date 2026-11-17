/**
 * Opt-in escape hatches for running a finance demo seed against a database that is not on
 * localhost, and an owner-level substitute for `SET session_replication_role = replica` on
 * managed Postgres (Neon and friends) where that setting is reserved for superusers.
 *
 * Nothing here changes a script's default behaviour: without the flag the guards still refuse
 * any host but localhost exactly as before. With SEED_ALLOW_REMOTE=1 or --allow-remote-db the
 * script runs against the managed database named in DATABASE_URL — a database the operator
 * owns and has chosen to treat as a demo target.
 *
 * `SET LOCAL session_replication_role = replica` turns EVERY trigger off for one transaction
 * and reverts at commit. The substitute below can only turn USER triggers off (an owner may
 * not touch system triggers — foreign keys stay enforced, which the seeds' child-first delete
 * order already respects), and because ALTER TABLE DDL commits with the transaction it must be
 * paired with reguardFinanceTriggers() before COMMIT. Rollback needs no pair: the DDL rolls
 * back too.
 */
const REMOTE_FLAG = '--allow-remote-db'
const remoteAllowed = () => process.env.SEED_ALLOW_REMOTE === '1' || process.argv.slice(2).includes(REMOTE_FLAG)

/** Refuse a non-local DATABASE_URL unless the remote opt-in was passed. Returns the host. */
function allowRemoteDb(url, { what = 'this seed' } = {}) {
  const host = new URL(url).hostname
  if (['127.0.0.1', 'localhost', '::1'].includes(host)) return host
  if (!remoteAllowed()) {
    console.error(`Refusing to run against ${host}: ${what} only writes to a local database.`)
    console.error(`Pass ${REMOTE_FLAG} (or SEED_ALLOW_REMOTE=1) to target a managed database you own.`)
    process.exit(1)
  }
  console.warn(`WARNING: ${what} is running against the remote database ${host} (${REMOTE_FLAG}).`)
  return host
}

/** Refuse a non-local API base unless the remote opt-in was passed. Returns the host. */
function allowRemoteApi(url, { what = 'this seed' } = {}) {
  const host = new URL(url).hostname
  if (['127.0.0.1', 'localhost'].includes(host)) return host
  if (!remoteAllowed()) {
    console.error(`Refusing to drive ${url}: ${what} only drives a local backend.`)
    console.error(`Pass ${REMOTE_FLAG} (or SEED_ALLOW_REMOTE=1) to point it elsewhere.`)
    process.exit(1)
  }
  console.warn(`WARNING: ${what} is driving the remote API ${url} (${REMOTE_FLAG}).`)
  return host
}

/**
 * Disable every user trigger on every finance.* table for the caller's OPEN transaction —
 * the owner-level stand-in for `SET LOCAL session_replication_role = replica`. Call
 * reguardFinanceTriggers() before COMMIT (a rollback restores them by itself). Returns the
 * number of tables toggled.
 */
async function unguardFinanceTriggers(db) {
  const { rows } = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'finance' ORDER BY 1`)
  for (const r of rows) await db.query(`ALTER TABLE finance."${r.tablename}" DISABLE TRIGGER USER`)
  return rows.length
}

/** The pair to unguardFinanceTriggers(): re-enable user triggers before COMMIT. */
async function reguardFinanceTriggers(db) {
  const { rows } = await db.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'finance' ORDER BY 1`)
  for (const r of rows) await db.query(`ALTER TABLE finance."${r.tablename}" ENABLE TRIGGER USER`)
  return rows.length
}

module.exports = { allowRemoteDb, allowRemoteApi, unguardFinanceTriggers, reguardFinanceTriggers }
