/**
 * Verify that a restored database matches its source for the finance module.
 *
 *   SOURCE_DATABASE_URL=... RESTORE_DATABASE_URL=... node scripts/verify-restore.js
 *
 * This is a read-only drill: it never writes to either database. It compares
 *   - the applied migration list,
 *   - row counts for every finance base table,
 *   - the finance views and triggers that enforce the controls,
 *   - financial totals grouped by currency (never combined),
 *   - publication and document counts.
 *
 * Exit code 0 means every check matched; 1 means at least one difference.
 */
require('dotenv').config()
const { Client } = require('pg')

const sourceUrl = process.env.SOURCE_DATABASE_URL || process.env.DATABASE_URL
const restoreUrl = process.env.RESTORE_DATABASE_URL

if (!sourceUrl || !restoreUrl) {
  console.error('SOURCE_DATABASE_URL and RESTORE_DATABASE_URL are required')
  process.exit(1)
}

const MONEY_QUERIES = {
  budget_original_by_currency:
    `SELECT currency, count(*) AS rows, COALESCE(sum(original_amount), 0)::text AS total
       FROM finance.budget_line WHERE deleted_at IS NULL GROUP BY currency ORDER BY currency`,
  budget_revisions_by_currency:
    `SELECT currency, count(*) AS rows, COALESCE(sum(amount_delta), 0)::text AS total
       FROM finance.budget_revision
      WHERE deleted_at IS NULL AND state = 'approved' GROUP BY currency ORDER BY currency`,
  transactions_by_currency:
    `SELECT currency, count(*) AS rows, COALESCE(sum(amount), 0)::text AS total
       FROM finance.transaction WHERE deleted_at IS NULL GROUP BY currency ORDER BY currency`,
  commitments_by_currency:
    `SELECT currency, count(*) AS rows, COALESCE(sum(amount), 0)::text AS total
       FROM finance.commitment WHERE deleted_at IS NULL GROUP BY currency ORDER BY currency`,
  project_allocations_by_currency:
    `SELECT currency, count(*) AS rows, COALESCE(sum(amount), 0)::text AS total
       FROM finance.project_allocation WHERE deleted_at IS NULL GROUP BY currency ORDER BY currency`,
  project_spend_by_currency:
    `SELECT t.currency, count(*) AS rows,
            COALESCE(sum(t.amount * pt.share), 0)::text AS total
       FROM finance.project_transaction pt
       JOIN finance.transaction t ON t.id = pt.transaction_id
      WHERE pt.deleted_at IS NULL AND t.deleted_at IS NULL
      GROUP BY t.currency ORDER BY t.currency`,
  publications_by_state:
    `SELECT state, count(*) AS rows FROM finance.publication GROUP BY state ORDER BY state`,
  documents_by_visibility:
    `SELECT visibility, count(*) AS rows FROM finance.document
      WHERE deleted_at IS NULL GROUP BY visibility ORDER BY visibility`,
}

async function snapshot(url) {
  const client = new Client({ connectionString: url })
  await client.connect()
  try {
    const migrations = (await client.query(
      'SELECT filename FROM public.schema_migrations ORDER BY filename',
    )).rows.map((r) => r.filename)

    const tables = (await client.query(
      `SELECT table_name FROM information_schema.tables
        WHERE table_schema = 'finance' AND table_type = 'BASE TABLE'
        ORDER BY table_name`,
    )).rows.map((r) => r.table_name)

    const counts = {}
    for (const table of tables) {
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM finance."${table}"`)
      counts[table] = rows[0].n
    }

    const views = (await client.query(
      `SELECT table_name FROM information_schema.views
        WHERE table_schema = 'finance' ORDER BY table_name`,
    )).rows.map((r) => r.table_name)

    const triggers = (await client.query(
      `SELECT event_object_table || '.' || trigger_name AS name
         FROM information_schema.triggers
        WHERE trigger_schema = 'finance'
        ORDER BY 1`,
    )).rows.map((r) => r.name)

    const money = {}
    for (const [name, sql] of Object.entries(MONEY_QUERIES)) {
      money[name] = (await client.query(sql)).rows
    }

    return { migrations, tables, counts, views, triggers, money }
  } finally {
    await client.end()
  }
}

function compare(label, a, b, failures) {
  const left = JSON.stringify(a)
  const right = JSON.stringify(b)
  if (left !== right) failures.push(`${label}\n  source:  ${left}\n  restored:${right}`)
}

async function main() {
  const [source, restored] = await Promise.all([snapshot(sourceUrl), snapshot(restoreUrl)])
  const failures = []

  compare('migration history', source.migrations, restored.migrations, failures)
  compare('finance table list', source.tables, restored.tables, failures)
  compare('finance row counts', source.counts, restored.counts, failures)
  compare('finance views', source.views, restored.views, failures)
  compare('finance triggers', source.triggers, restored.triggers, failures)

  for (const name of Object.keys(MONEY_QUERIES)) {
    compare(name, source.money[name], restored.money[name], failures)
  }

  const summary = {
    migrations: source.migrations.length,
    finance_tables: source.tables.length,
    finance_views: source.views.length,
    finance_triggers: source.triggers.length,
    rows: source.counts,
    totals: source.money,
    mismatches: failures,
  }
  console.log(JSON.stringify(summary, null, 2))

  if (failures.length) {
    console.error(`\n[verify-restore] FAILED: ${failures.length} difference(s)`)
    process.exit(1)
  }
  console.log('\n[verify-restore] PASS: restored database matches the source')
}

main().catch((err) => {
  console.error('[verify-restore] error:', err.message)
  process.exit(1)
})
