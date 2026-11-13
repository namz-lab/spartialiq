#!/usr/bin/env node
/**
 * Seed an isolated database with a realistic Vungu RDC finance dataset for load testing.
 *
 *   DATABASE_URL='postgresql://…/vungu_workflow_test' node scripts/seed-load-dataset.js
 *   DATABASE_URL=… node scripts/seed-load-dataset.js --clean
 *
 * Creates one financial year, five departments, a chart of accounts, 30 approved budget
 * lines, three approved revisions, 20 approved projects with allocations, 20,000 posted
 * transactions, project links for a third of the expenditure, and live publications for the
 * public portal. Everything is prefixed LOAD- and can be removed with --clean.
 *
 * This script writes only to the database named in DATABASE_URL. It refuses to run against a
 * database whose name does not contain "test" unless ALLOW_NON_TEST_DB=1 is set.
 */
require('dotenv').config()
const { Client } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
if (!DATABASE_URL) {
  console.error('DATABASE_URL is required')
  process.exit(1)
}
const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, '')
if (!/test/i.test(dbName) && process.env.ALLOW_NON_TEST_DB !== '1') {
  console.error(`Refusing: ${dbName} does not look like a test database (set ALLOW_NON_TEST_DB=1 to override)`)
  process.exit(1)
}

const TX_COUNT = Number(process.env.LOAD_TX_COUNT || 20000)

async function clean(db) {
  const statements = [
    `DELETE FROM finance.project_transaction WHERE transaction_id IN (SELECT id FROM finance.transaction WHERE source_system = 'LOADTEST')`,
    `DELETE FROM finance.project_allocation WHERE project_id IN (SELECT id FROM finance.project WHERE reference LIKE 'LOAD-%')`,
    `DELETE FROM finance.project WHERE reference LIKE 'LOAD-%'`,
    `DELETE FROM finance.publication WHERE financial_year_id IN (SELECT id FROM finance.financial_year WHERE label LIKE 'LOAD-%')`,
    `DELETE FROM finance.budget_revision WHERE budget_line_id IN (SELECT id FROM finance.budget_line WHERE code LIKE 'LOAD-%')`,
    `DELETE FROM finance.transaction WHERE source_system = 'LOADTEST'`,
    `DELETE FROM finance.budget_line WHERE code LIKE 'LOAD-%'`,
    `DELETE FROM finance.account WHERE code LIKE 'LOAD-%'`,
    `DELETE FROM finance.department WHERE code LIKE 'LOAD-%'`,
    `DELETE FROM finance.financial_year WHERE label LIKE 'LOAD-%'`,
  ]
  for (const sql of statements) await db.query(sql)
}

async function main() {
  const db = new Client({ connectionString: DATABASE_URL })
  await db.connect()
  try {
    const args = process.argv.slice(2)
    await db.query('BEGIN')
    if (args.includes('--clean')) {
      await clean(db)
      await db.query('COMMIT')
      console.log('[seed] cleaned LOAD- dataset')
      return
    }

    await clean(db)

    const { rows: authorityRows } = await db.query(
      'SELECT id FROM public.local_authorities ORDER BY id LIMIT 1',
    )
    if (!authorityRows[0]) throw new Error('no local_authorities row in this database')
    const authorityId = authorityRows[0].id

    const { rows: users } = await db.query(
      `SELECT email, id FROM users WHERE email IN
         ('demo.finance-admin@vungu.test','demo.treasurer@vungu.test','demo.publisher@vungu.test',
          'demo.finance-officer@vungu.test')`,
    )
    const user = (email) => {
      const found = users.find((u) => u.email === email)
      if (!found) throw new Error(`missing demo user ${email}`)
      return found.id
    }
    const financeAdmin = user('demo.finance-admin@vungu.test')
    const committee = user('demo.treasurer@vungu.test')
    const publisher = user('demo.publisher@vungu.test')
    const officer = user('demo.finance-officer@vungu.test')

    const { rows: yearRows } = await db.query(
      `INSERT INTO finance.financial_year
         (authority_id, label, start_date, end_date, reporting_currency, status, created_by)
       VALUES ($1, 'LOAD-VUNGU 2034', '2034-01-01', '2034-12-31', 'USD', 'open', $2)
       RETURNING id`, [authorityId, financeAdmin],
    )
    const yearId = yearRows[0].id

    const departments = [
      ['LOAD-WKS', 'Works and Roads', 1],
      ['LOAD-HLT', 'Health Services', 2],
      ['LOAD-EDU', 'Education', 3],
      ['LOAD-ADM', 'Administration', 4],
      ['LOAD-WTR', 'Water and Sanitation', 5],
    ]
    const deptIds = {}
    for (const [code, name, vote] of departments) {
      const { rows } = await db.query(
        `INSERT INTO finance.department (authority_id, code, name, vote_number, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id`,
        [authorityId, code, name, vote, financeAdmin],
      )
      deptIds[code] = rows[0].id
    }

    const accounts = [
      ['1100', 'Property rates', 'revenue', 'internally_generated', null],
      ['1200', 'Devolution grant', 'revenue', 'grant', null],
      ['1300', 'Licences and permits', 'revenue', 'internally_generated', null],
      ['5100', 'Roads maintenance', 'expenditure', null, 'recurrent'],
      ['5200', 'Clinic operating costs', 'expenditure', null, 'recurrent'],
      ['5300', 'School support', 'expenditure', null, 'recurrent'],
      ['5400', 'Administration', 'expenditure', null, 'recurrent'],
      ['5500', 'Water and sanitation', 'expenditure', null, 'recurrent'],
      ['5600', 'Capital works', 'expenditure', null, 'capital'],
    ]
    const accountIds = {}
    for (const [suffix, name, kind, revenueClass, expenditureClass] of accounts) {
      const code = `LOAD-${suffix}`
      const { rows } = await db.query(
        `INSERT INTO finance.account
           (authority_id, code, name, kind, revenue_class, expenditure_class, is_postable, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,true,'active',$7) RETURNING id`,
        [authorityId, code, name, kind, revenueClass, expenditureClass, financeAdmin],
      )
      accountIds[suffix] = rows[0].id
    }

    // 10 revenue lines (2 per department), 15 USD expenditure lines (3 per department),
    // 5 ZWG expenditure lines (1 per department).
    const revenueAccounts = ['1100', '1200']
    const expenditureAccounts = ['5100', '5200', '5300']
    const lines = []
    let seq = 0
    for (const [deptCode] of departments) {
      for (const acct of revenueAccounts) {
        seq += 1
        lines.push({
          code: `LOAD-${deptCode.slice(5)}-${acct}-R${seq}`,
          deptId: deptIds[deptCode], accountId: accountIds[acct],
          kind: 'revenue', currency: 'USD', amount: '900000.00',
        })
      }
      for (const acct of expenditureAccounts) {
        seq += 1
        lines.push({
          code: `LOAD-${deptCode.slice(5)}-${acct}-E${seq}`,
          deptId: deptIds[deptCode], accountId: accountIds[acct],
          kind: 'expenditure', currency: 'USD', amount: '1000000.00',
        })
      }
      seq += 1
      lines.push({
        code: `LOAD-${deptCode.slice(5)}-5500-Z${seq}`,
        deptId: deptIds[deptCode], accountId: accountIds['5500'],
        kind: 'expenditure', currency: 'ZWG', amount: '4000000.00',
      })
    }

    const lineIds = []
    for (const line of lines) {
      const { rows } = await db.query(
        `INSERT INTO finance.budget_line
           (authority_id, financial_year_id, department_id, account_id, code, description,
            currency, original_amount, status, created_by, approved_by, approved_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8::numeric,'approved',$9,$10,now())
         RETURNING id`,
        [authorityId, yearId, line.deptId, line.accountId, line.code,
          `Load-test vote ${line.code}`, line.currency, line.amount, financeAdmin, committee],
      )
      lineIds.push(rows[0].id)
    }

    // Three approved revisions on expenditure lines.
    const expenditureLineIds = lineIds.filter((_, index) => lines[index].kind === 'expenditure')
    for (let i = 0; i < 3; i += 1) {
      await db.query(
        `INSERT INTO finance.budget_revision
           (authority_id, budget_line_id, revision_no, amount_delta, currency, reason,
            state, requested_by, decided_by, decided_at)
         VALUES ($1,$2,1,1000.00,$3,'Load-test supplementary allocation','approved',$4,$5,now())`,
        [authorityId, expenditureLineIds[i], lines.find((l) => l.kind === 'expenditure').currency,
          officer, committee],
      )
    }

    // 20 approved projects, one per expenditure line, each with a 50,000 allocation.
    const projectIds = []
    const projectCurrencies = []
    for (let i = 0; i < 20; i += 1) {
      const lineIndex = lines.findIndex((l, index) => index === lineIds.indexOf(expenditureLineIds[i]))
      const line = lines[lineIndex]
      const reference = `LOAD-PRJ-${String(i + 1).padStart(2, '0')}`
      const { rows } = await db.query(
        `INSERT INTO finance.project
           (authority_id, reference, name, description, department_id, ward_code, location_text,
            start_date, end_date, status, currency, approved_budget, approved_by, approved_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'2034-01-15','2034-11-30','approved',$8,'50000.00',$9,now(),$10)
         RETURNING id`,
        [authorityId, reference, `Load-test project ${i + 1}`,
          'Synthetic project used for performance testing', line.deptId,
          `WARD-${String((i % 20) + 1).padStart(2, '0')}`, 'Vungu District',
          line.currency, committee, financeAdmin],
      )
      const projectId = rows[0].id
      projectIds.push(projectId)
      projectCurrencies.push(line.currency)
      await db.query(
        `INSERT INTO finance.project_allocation
           (authority_id, project_id, budget_line_id, financial_year_id, amount, currency,
            allocation_type, created_by)
         VALUES ($1,$2,$3,$4,'50000.00',$5,'original',$6)`,
        [authorityId, projectId, expenditureLineIds[i], yearId, line.currency, financeAdmin],
      )
    }

    // 20,000 transactions spread evenly over the 30 budget lines.
    await db.query(
      `WITH lines AS (
         SELECT id, account_id, department_id, currency, row_number() OVER (ORDER BY code) AS rn
           FROM finance.budget_line WHERE code LIKE 'LOAD-%'
       ), n AS (SELECT count(*)::int AS c FROM lines)
       INSERT INTO finance.transaction
         (authority_id, financial_year_id, account_id, department_id, budget_line_id, txn_date,
          amount, currency, description, reference, record_type, source_system, source_ref,
          posted_at, created_by)
       SELECT $1, $2, l.account_id, l.department_id, l.id,
              DATE '2034-01-01' + (g % 365),
              (100 + (random() * 4900))::numeric(14,2),
              l.currency,
              'Load-test transaction ' || g,
              'LOAD-TX-' || g,
              CASE WHEN a.kind = 'revenue' THEN 'receipt' ELSE 'actual' END,
              'LOADTEST', 'LOAD-TX-' || g, now(), $3
         FROM generate_series(1, $4) g
         CROSS JOIN n
         JOIN lines l ON l.rn = (g % n.c) + 1
         JOIN finance.account a ON a.id = l.account_id`,
      [authorityId, yearId, officer, TX_COUNT],
    )

    // Link every third expenditure transaction to a project in the same currency.
    await db.query(
      `WITH proj AS (
         SELECT id, currency,
                row_number() OVER (PARTITION BY currency ORDER BY reference) AS rn
           FROM finance.project WHERE reference LIKE 'LOAD-%'
       ), txn AS (
         SELECT t.id, t.currency, row_number() OVER (ORDER BY t.id) AS rn
           FROM finance.transaction t
           JOIN finance.account a ON a.id = t.account_id
          WHERE t.source_system = 'LOADTEST' AND a.kind = 'expenditure'
       )
       INSERT INTO finance.project_transaction
         (authority_id, project_id, transaction_id, association, share, created_by)
       SELECT $1, p.id, t.id, 'direct', 1, $2
         FROM txn t
         JOIN proj p ON p.currency = t.currency AND p.rn = (t.rn % 10) + 1
        WHERE t.rn % 3 = 0
       ON CONFLICT DO NOTHING`,
      [authorityId, financeAdmin],
    )

    // Live publications for all four public datasets.
    for (const dataset of ['budget', 'revenue', 'expenditure', 'projects']) {
      await db.query(
        `INSERT INTO finance.publication
           (authority_id, financial_year_id, dataset, version, state, reviewed_by, reviewed_at,
            approved_by, approved_at, published_by, published_at, reporting_period_label,
            data_as_at, created_by)
         VALUES ($1,$2,$3,1,'published',$4,now(),$4,now(),$5,now(),
                 'LOAD-VUNGU 2034 full year','2034-12-31',$4)`,
        [authorityId, yearId, dataset, committee, publisher],
      )
    }
    // The public budget endpoint requires the lines themselves to be published.
    await db.query(
      `UPDATE finance.budget_line SET status = 'published' WHERE code LIKE 'LOAD-%'`,
    )

    await db.query('COMMIT')

    const { rows: counts } = await db.query(
      `SELECT
         (SELECT count(*) FROM finance.department WHERE code LIKE 'LOAD-%') AS departments,
         (SELECT count(*) FROM finance.account WHERE code LIKE 'LOAD-%') AS accounts,
         (SELECT count(*) FROM finance.budget_line WHERE code LIKE 'LOAD-%') AS budget_lines,
         (SELECT count(*) FROM finance.budget_revision r JOIN finance.budget_line l ON l.id=r.budget_line_id WHERE l.code LIKE 'LOAD-%') AS revisions,
         (SELECT count(*) FROM finance.project WHERE reference LIKE 'LOAD-%') AS projects,
         (SELECT count(*) FROM finance.project_allocation a JOIN finance.project p ON p.id=a.project_id WHERE p.reference LIKE 'LOAD-%') AS allocations,
         (SELECT count(*) FROM finance.transaction WHERE source_system='LOADTEST') AS transactions,
         (SELECT count(*) FROM finance.project_transaction pt JOIN finance.transaction t ON t.id=pt.transaction_id WHERE t.source_system='LOADTEST') AS project_links,
         (SELECT count(*) FROM finance.publication p JOIN finance.financial_year y ON y.id=p.financial_year_id WHERE y.label LIKE 'LOAD-%') AS publications`,
    )
    console.log(JSON.stringify({ database: dbName, financial_year_id: yearId, ...counts[0] }, null, 2))
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

main().catch((err) => {
  console.error('[seed] failed:', err.message)
  process.exit(1)
})
