const { Pool } = require('pg')
const { seedDemoUsers } = require('./seed-demo-users')

async function main() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) throw new Error('DATABASE_URL must point to the local desktop database.')
  const host = new URL(databaseUrl).hostname
  const port = new URL(databaseUrl).port
  const db = new URL(databaseUrl).pathname.replace(/^\//, '')
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) || port !== '55432' || db !== 'spartialiq_local') {
    throw new Error(`Refusing demo seed outside local SpartialIQ DB (${host}:${port}/${db}).`)
  }
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const { rows } = await pool.query("SELECT to_regclass('public.users') AS users_table")
    if (!rows[0].users_table) throw new Error('Local user table is not present; run migrations first.')
  } finally {
    await pool.end()
  }
  await seedDemoUsers({
    ...process.env,
    DATABASE_URL: databaseUrl,
    DEMO_SEED_ENABLED: 'true',
    DEMO_DEFAULT_PASSWORD: process.env.DEMO_DEFAULT_PASSWORD || 'demo1234',
  })
  console.log('[desktop-seed] done. Demo users are local-only; change the default password before sharing this workstation.')
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[desktop-seed] failed:', error.message)
    process.exit(1)
  })
}

module.exports = { main }
