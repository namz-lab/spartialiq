#!/usr/bin/env node
/**
 * Presentation polish for a finance demonstration on a LOCAL database, and its exact undo.
 *
 *   DATABASE_URL=<local> node scripts/finance-demo-presentation.js          # apply
 *   DATABASE_URL=<local> node scripts/finance-demo-presentation.js --undo   # restore every value
 *   DATABASE_URL=<local> node scripts/finance-demo-presentation.js --report
 *
 * WHAT IT CHANGES (display text only, never an amount, date, code or id)
 *  - the demo financial year's label "DD 2026/27 (synthetic demo ...)" becomes "2026/27";
 *  - ledger period labels lose the "GL-" seed prefix ("GL-Jul 2026" -> "Jul 2026");
 *  - every " (demo)" suffix in any text column of the finance schema is removed;
 *  - the finance demo accounts get realistic display names (their emails are unchanged).
 *
 * WHY IT IS SEPARATE AND REVERSIBLE
 * The demo seeds label everything synthetic on purpose (docs/finance/COUNCIL-DECISIONS.md), and
 * their --clean / --report modes find the year by that label. So this runs LAST, only for a
 * presentation, and records every old value in demo_presentation.backup. Run --undo before
 * re-running or cleaning any finance demo seed.
 *
 * Posted ledger rows are protected by immutability triggers; the text edits run with user
 * triggers disabled inside one transaction (session_replication_role on a local superuser
 * database, ALTER TABLE ... DISABLE TRIGGER as the table owner elsewhere — scripts/lib/seed-remote.js). Nothing numeric
 * is touched, so every balance and invariant is unchanged. Refuses any non-local database.
 */
const { Client } = require('pg')
const { allowRemoteDb, unguardFinanceTriggers, reguardFinanceTriggers } = require('./lib/seed-remote')

const url = process.env.DATABASE_URL || ''
if (!url) { console.error('Set DATABASE_URL.'); process.exit(1) }
allowRemoteDb(url, { what: 'finance-demo-presentation.js' })

const NAMES = {
  'demo.finance-admin@vungu.test': 'Tatenda Mukarati',
  'demo.finance-officer@vungu.test': 'Rumbidzai Chikore',
  'demo.budget-officer@vungu.test': 'Farai Nyathi',
  'demo.dept-head@vungu.test': 'Eng. Blessing Moyo',
  'demo.treasurer@vungu.test': 'Cllr. Grace Sibanda',
  'demo.publisher@vungu.test': 'Nyasha Dube',
  'demo.auditor@vungu.test': 'Kudakwashe Marufu',
  'demo.accountant@vungu.test': 'Tinashe Gumbo',
  'demo.cashier@vungu.test': 'Chipo Ndlovu',
  'demo.cashier2@vungu.test': 'Precious Mpofu',
  'demo.supervisor@vungu.test': 'Simbarashe Banda',
  'demo.revenue@vungu.test': 'Memory Zhou',
  'demo.ceo@vungu.test': 'Mr. Edson Mahlangu',
}
const YEAR_FROM = /^DD 2026\/27 \(synthetic demo/

async function main() {
  const undo = process.argv.includes('--undo')
  const db = new Client({ connectionString: url })
  await db.connect()
  try {
    await db.query('CREATE SCHEMA IF NOT EXISTS demo_presentation')
    await db.query(`CREATE TABLE IF NOT EXISTS demo_presentation.backup (
      tbl text NOT NULL, id text NOT NULL, col text NOT NULL, old_value text,
      PRIMARY KEY (tbl, id, col))`)

    if (process.argv.includes('--report')) {
      const { rows } = await db.query('SELECT tbl, col, count(*)::int AS n FROM demo_presentation.backup GROUP BY 1, 2 ORDER BY 1, 2')
      console.table(rows.length ? rows : [{ state: 'not applied' }])
      return
    }

    await db.query('BEGIN')
    await unguardFinanceTriggers(db)

    if (undo) {
      const { rows } = await db.query('SELECT DISTINCT tbl, col FROM demo_presentation.backup')
      for (const { tbl, col } of rows) {
        await db.query(`UPDATE ${tbl} t SET ${col} = b.old_value FROM demo_presentation.backup b
                         WHERE b.tbl = $1 AND b.col = $2 AND b.id = t.id::text`, [tbl, col])
      }
      await db.query('DELETE FROM demo_presentation.backup')
      await reguardFinanceTriggers(db)
      await db.query('COMMIT')
      console.log(`Restored ${rows.length} column(s) to their seeded values.`)
      return
    }

    let changed = 0
    /** Back up then update the rows of `tbl` matched by `where`, setting `col` to `expr`. */
    const rewrite = async (tbl, col, expr, where, params = []) => {
      await db.query(
        `INSERT INTO demo_presentation.backup (tbl, id, col, old_value)
         SELECT $${params.length + 1}, t.id::text, $${params.length + 2}, t.${col} FROM ${tbl} t WHERE ${where}
         ON CONFLICT DO NOTHING`, [...params, tbl, col])
      const r = await db.query(`UPDATE ${tbl} t SET ${col} = ${expr} WHERE ${where}`, params)
      changed += r.rowCount
    }

    await rewrite('finance.financial_year', 'label', `'2026/27'`, `t.label ~ $1`, [YEAR_FROM.source])
    await rewrite('finance.financial_year', 'notes', `'Financial year 1 July 2026 to 30 June 2027.'`,
      `t.notes ILIKE 'Synthetic demonstration data%'`)
    await rewrite('finance.ledger_period', 'label', `substr(t.label, 4)`, `t.label LIKE 'GL-%'`)

    const { rows: cols } = await db.query(
      `SELECT c.table_name, c.column_name
         FROM information_schema.columns c
         JOIN information_schema.tables tb USING (table_schema, table_name)
         JOIN information_schema.columns idc ON idc.table_schema = c.table_schema
              AND idc.table_name = c.table_name AND idc.column_name = 'id'
        WHERE c.table_schema = 'finance' AND tb.table_type = 'BASE TABLE'
          AND c.data_type IN ('text', 'character varying') AND c.column_name <> 'id'
          AND c.is_generated = 'NEVER'`)
    for (const { table_name: t, column_name: c } of cols) {
      await rewrite(`finance.${t}`, c, `btrim(regexp_replace(t.${c}, '\\s*\\(demo\\)', '', 'g'))`, `t.${c} ~ '\\(demo\\)'`)
    }

    for (const [email, name] of Object.entries(NAMES)) {
      for (const col of ['full_name', 'name']) {
        // The name goes in as a quoted literal: as a parameter it is unused by the backup INSERT,
        // whose type Postgres then cannot determine. NAMES is a constant in this file.
        await rewrite('public.users', col, `'${name.replace(/'/g, "''")}'`, `t.email = $1`, [email])
      }
    }

    await reguardFinanceTriggers(db)
    await db.query('COMMIT')
    console.log(`Presentation labels applied: ${changed} value(s) changed. Undo with --undo before re-running any finance seed.`)
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err.message); process.exit(1) })
