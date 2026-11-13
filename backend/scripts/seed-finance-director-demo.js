#!/usr/bin/env node
/**
 * A synthetic finance dataset that exercises the Director of Finance surfaces.
 *
 *   node scripts/seed-finance-director-demo.js            # create
 *   node scripts/seed-finance-director-demo.js --clean    # remove everything it created
 *   node scripts/seed-finance-director-demo.js --report    # count what is there now
 *
 * WHY THIS EXISTS
 * The development database held one financial year, one department, two accounts, four budget
 * lines and a single transaction, with no programmes, activities, commitments, variance
 * explanations or reversals. That is enough to prove a screen renders and far too little to prove
 * it is RIGHT: a monthly management account over one transaction shows nothing, a commitments
 * register over zero commitments cannot be wrong, and a reversal mode cannot be tested where no
 * transaction reverses another. Council decision D10 (UAT sign-off) is a release gate, and UAT
 * needs a dataset a finance officer can recognise as their own work.
 *
 * THE YEAR RUNS JULY TO JUNE, ON PURPOSE
 * A council's financial year is not the calendar year, and the single most likely defect in any
 * period-based report is buckets generated from January. This dataset's year is 2026-07-01 to
 * 2027-06-30, so a correct Q1 is July–September and an incorrect one is visibly Jan–Mar. It is the
 * fixture that makes that bug impossible to miss.
 *
 * EVERYTHING IS LABELLED SYNTHETIC AND EVERYTHING IS PREFIXED `DD-`
 * The existing hand-made rows follow the same convention ("DEMO 2027 (synthetic - not a Council
 * year)"), and `docs/finance/COUNCIL-DECISIONS.md` is explicit that this system "does not assert
 * that any figure it displays is correct". A demo figure that could be mistaken for a Council
 * figure would make that statement worse, not better. `--clean` removes the lot by prefix.
 *
 * WHAT IT DELIBERATELY LEAVES INCOMPLETE
 * Some budget lines have NO ward code and some projects have NO physical progress figure, because
 * `null` means "not recorded" and is a different fact from zero (decision D12). A report that
 * cannot distinguish them is wrong, and this dataset is how that is caught. Likewise only some
 * lines carry a variance explanation, so a variance report must show the rest AS unexplained.
 *
 * SAFETY
 * Refuses any database whose name looks like production. It writes only rows it can delete again,
 * and it never touches a row it did not create.
 */
require('dotenv').config()
const { Client } = require('pg')

const DATABASE_URL = process.env.DATABASE_URL
  || 'postgresql://postgres:postgres@localhost:5432/vungu_dev'

const dbName = new URL(DATABASE_URL).pathname.replace(/^\//, '')
if (/prod|live/i.test(dbName)) {
  console.error(`Refusing to seed synthetic data into ${dbName}: the name looks like production.`)
  process.exit(1)
}

const YEAR_LABEL = 'DD 2026/27 (synthetic demo — July to June, not a Council year)'
const SOURCE = 'DDDEMO'

/** Vungu's own ward codes, so ward reporting has something real to join to (admin.ward). */
const WARDS = ['ZW102101', 'ZW102102', 'ZW102103', 'ZW102104']

const DEPARTMENTS = [
  { code: 'DD-ENG', name: 'Engineering and Works (demo)', vote: 30 },
  { code: 'DD-HLT', name: 'Health and Environment (demo)', vote: 40 },
  { code: 'DD-FIN', name: 'Finance and Administration (demo)', vote: 10 },
  { code: 'DD-SOC', name: 'Social Services (demo)', vote: 50 },
]

const PROGRAMMES = [
  { code: 'DD-P-ROADS', name: 'Road network (demo)', dept: 'DD-ENG' },
  { code: 'DD-P-WATER', name: 'Water and sanitation (demo)', dept: 'DD-ENG' },
  { code: 'DD-P-PHC', name: 'Primary health care (demo)', dept: 'DD-HLT' },
  { code: 'DD-P-REV', name: 'Revenue administration (demo)', dept: 'DD-FIN' },
  { code: 'DD-P-EDU', name: 'Community education (demo)', dept: 'DD-SOC' },
]

const ACTIVITIES = [
  { code: 'DD-A-GRADE', name: 'Grading and regravelling (demo)', prog: 'DD-P-ROADS' },
  { code: 'DD-A-CULV', name: 'Culvert construction (demo)', prog: 'DD-P-ROADS' },
  { code: 'DD-A-BORE', name: 'Borehole rehabilitation (demo)', prog: 'DD-P-WATER' },
  { code: 'DD-A-CLINIC', name: 'Clinic outreach (demo)', prog: 'DD-P-PHC' },
  { code: 'DD-A-BILL', name: 'Billing and collection (demo)', prog: 'DD-P-REV' },
  { code: 'DD-A-SKILLS', name: 'Skills training (demo)', prog: 'DD-P-EDU' },
]

/**
 * The chart of accounts.
 *
 * `kind` is set explicitly per account and is NEVER inferred from the code range — that inference
 * is the mistake rejected in docs/finance/2026-11-05-finance-impact-gap-note.md (risk 1) and
 * forbidden by decision D2. The revenue classes and both expenditure classes are all represented
 * so that a capital-versus-recurrent split and a funding-source report have something to separate.
 */
const ACCOUNTS = [
  { code: 'DD-1100', name: 'Rates and supplementary charges (demo)', kind: 'revenue', rev: 'internally_generated' },
  { code: 'DD-1200', name: 'Licences and permits (demo)', kind: 'revenue', rev: 'internally_generated' },
  { code: 'DD-1300', name: 'Devolution grant (demo)', kind: 'revenue', rev: 'grant' },
  { code: 'DD-1400', name: 'Government transfer (demo)', kind: 'revenue', rev: 'transfer' },
  { code: 'DD-1900', name: 'Sundry income (demo)', kind: 'revenue', rev: 'other' },
  { code: 'DD-5100', name: 'Roads maintenance (demo)', kind: 'expenditure', exp: 'recurrent' },
  { code: 'DD-5200', name: 'Salaries and allowances (demo)', kind: 'expenditure', exp: 'recurrent' },
  { code: 'DD-5300', name: 'Drugs and medical supplies (demo)', kind: 'expenditure', exp: 'recurrent' },
  { code: 'DD-7100', name: 'Road construction — capital (demo)', kind: 'expenditure', exp: 'capital' },
  { code: 'DD-7200', name: 'Borehole drilling — capital (demo)', kind: 'expenditure', exp: 'capital' },
]

/**
 * The budget lines.
 *
 * `ward` is deliberately null on two of them so that ward reporting has an "unlocated" bucket to
 * report as a first-class row rather than a rounding difference, and `explain` is false on several
 * so a variance report has lines it must show as unexplained.
 */
const LINES = [
  { code: 'DD-L01', descr: 'Grading and regravelling — Ward 1', dept: 'DD-ENG', prog: 'DD-P-ROADS', act: 'DD-A-GRADE', acct: 'DD-5100', fund: 'DD-1100', ccy: 'USD', amount: 320000, ward: 'ZW102101', explain: true },
  { code: 'DD-L02', descr: 'Culvert construction — Ward 2', dept: 'DD-ENG', prog: 'DD-P-ROADS', act: 'DD-A-CULV', acct: 'DD-7100', fund: 'DD-1300', ccy: 'USD', amount: 480000, ward: 'ZW102102', explain: false },
  { code: 'DD-L03', descr: 'Borehole rehabilitation — Ward 3', dept: 'DD-ENG', prog: 'DD-P-WATER', act: 'DD-A-BORE', acct: 'DD-7200', fund: 'DD-1400', ccy: 'USD', amount: 260000, ward: 'ZW102103', explain: true },
  { code: 'DD-L04', descr: 'Clinic outreach programme', dept: 'DD-HLT', prog: 'DD-P-PHC', act: 'DD-A-CLINIC', acct: 'DD-5300', fund: 'DD-1300', ccy: 'USD', amount: 150000, ward: 'ZW102104', explain: false },
  { code: 'DD-L05', descr: 'Salaries — Health and Environment', dept: 'DD-HLT', prog: 'DD-P-PHC', act: null, acct: 'DD-5200', fund: 'DD-1100', ccy: 'USD', amount: 410000, ward: null, explain: false },
  { code: 'DD-L06', descr: 'Rates collection costs', dept: 'DD-FIN', prog: 'DD-P-REV', act: 'DD-A-BILL', acct: 'DD-5200', fund: 'DD-1100', ccy: 'USD', amount: 190000, ward: null, explain: true },
  { code: 'DD-L07', descr: 'Rates and charges — revenue estimate', dept: 'DD-FIN', prog: 'DD-P-REV', act: 'DD-A-BILL', acct: 'DD-1100', fund: null, ccy: 'USD', amount: 900000, ward: null, explain: false },
  { code: 'DD-L08', descr: 'Devolution grant — revenue estimate', dept: 'DD-FIN', prog: 'DD-P-REV', act: null, acct: 'DD-1300', fund: null, ccy: 'USD', amount: 650000, ward: null, explain: false },
  { code: 'DD-L09', descr: 'Local purchases in ZWG — Engineering', dept: 'DD-ENG', prog: 'DD-P-ROADS', act: 'DD-A-GRADE', acct: 'DD-5100', fund: 'DD-1100', ccy: 'ZWG', amount: 24000000, ward: 'ZW102101', explain: true },
  { code: 'DD-L10', descr: 'Licences and permits — revenue estimate (ZWG)', dept: 'DD-FIN', prog: 'DD-P-REV', act: 'DD-A-BILL', acct: 'DD-1200', fund: null, ccy: 'ZWG', amount: 15000000, ward: null, explain: false },
  { code: 'DD-L11', descr: 'Skills training — Social Services', dept: 'DD-SOC', prog: 'DD-P-EDU', act: 'DD-A-SKILLS', acct: 'DD-5300', fund: 'DD-1900', ccy: 'USD', amount: 95000, ward: 'ZW102102', explain: false },
  { code: 'DD-L12', descr: 'Road construction — capital, Ward 4', dept: 'DD-ENG', prog: 'DD-P-ROADS', act: 'DD-A-CULV', acct: 'DD-7100', fund: 'DD-1400', ccy: 'USD', amount: 720000, ward: 'ZW102104', explain: true },
]

async function userIdByEmail(db, email) {
  const { rows } = await db.query('SELECT id FROM public.users WHERE email = $1', [email])
  if (!rows[0]) throw new Error(`Seed needs the demo user ${email}; run scripts/seed-demo-users.js first.`)
  return rows[0].id
}

async function clean(db) {
  // Ordered by dependency: links before the things they link, children before parents.
  const statements = [
    `DELETE FROM finance.project_transaction WHERE transaction_id IN (SELECT id FROM finance.transaction WHERE source_system = '${SOURCE}')`,
    `DELETE FROM finance.project_allocation WHERE project_id IN (SELECT id FROM finance.project WHERE reference LIKE 'DD-%')`,
    `DELETE FROM finance.project WHERE reference LIKE 'DD-%'`,
    `DELETE FROM finance.variance_explanation WHERE financial_year_id IN (SELECT id FROM finance.financial_year WHERE label = $1)`,
    `DELETE FROM finance.commitment WHERE reference LIKE 'DD-%'`,
    `DELETE FROM finance.budget_revision WHERE budget_line_id IN (SELECT id FROM finance.budget_line WHERE code LIKE 'DD-%')`,
    `DELETE FROM finance.transaction WHERE source_system = '${SOURCE}'`,
    `DELETE FROM finance.budget_line WHERE code LIKE 'DD-%'`,
    `DELETE FROM finance.activity WHERE code LIKE 'DD-%'`,
    `DELETE FROM finance.programme WHERE code LIKE 'DD-%'`,
    `DELETE FROM finance.account WHERE code LIKE 'DD-%'`,
    `DELETE FROM finance.department WHERE code LIKE 'DD-%'`,
    `DELETE FROM finance.financial_year WHERE label = $1`,
  ]
  for (const sql of statements) {
    await db.query(sql, sql.includes('$1') ? [YEAR_LABEL] : [])
  }
}

async function report(db) {
  const { rows } = await db.query(`
    SELECT 'financial_year' AS entity, count(*)::int AS rows FROM finance.financial_year WHERE label = $1
    UNION ALL SELECT 'department', count(*)::int FROM finance.department WHERE code LIKE 'DD-%'
    UNION ALL SELECT 'programme', count(*)::int FROM finance.programme WHERE code LIKE 'DD-%'
    UNION ALL SELECT 'activity', count(*)::int FROM finance.activity WHERE code LIKE 'DD-%'
    UNION ALL SELECT 'account', count(*)::int FROM finance.account WHERE code LIKE 'DD-%'
    UNION ALL SELECT 'budget_line', count(*)::int FROM finance.budget_line WHERE code LIKE 'DD-%'
    UNION ALL SELECT 'budget_revision', count(*)::int FROM finance.budget_revision WHERE budget_line_id IN (SELECT id FROM finance.budget_line WHERE code LIKE 'DD-%')
    UNION ALL SELECT 'transaction', count(*)::int FROM finance.transaction WHERE source_system = $2
    UNION ALL SELECT 'transaction (reversals)', count(*)::int FROM finance.transaction WHERE source_system = $2 AND reverses_id IS NOT NULL
    UNION ALL SELECT 'commitment', count(*)::int FROM finance.commitment WHERE reference LIKE 'DD-%'
    UNION ALL SELECT 'variance_explanation', count(*)::int FROM finance.variance_explanation WHERE financial_year_id IN (SELECT id FROM finance.financial_year WHERE label = $1)
    UNION ALL SELECT 'project', count(*)::int FROM finance.project WHERE reference LIKE 'DD-%'
    ORDER BY entity`, [YEAR_LABEL, SOURCE])
  for (const r of rows) console.log(`  ${r.entity.padEnd(26)} ${String(r.rows).padStart(6)}`)
}

async function main() {
  // `--undo` is the verb scripts/seed-all-demo.js passes to every seed it runs; `--clean` is the
  // verb the other finance scripts use. Both mean the same thing here, so the runner can drive
  // this script without a special case for it.
  const removing = process.argv.includes('--clean') || process.argv.includes('--undo')
  const mode = removing ? 'clean'
    : process.argv.includes('--report') ? 'report' : 'create'
  const db = new Client({ connectionString: DATABASE_URL })
  await db.connect()
  // The bulk insert of a year of transactions exceeds the database's 30 s statement_timeout.
  await db.query('SET statement_timeout = 0')

  try {
    if (mode === 'report') { console.log(`Synthetic finance demo data in ${dbName}:`); await report(db); return }

    await db.query('BEGIN')
    await clean(db)
    if (mode === 'clean') {
      await db.query('COMMIT')
      console.log(`Removed the synthetic finance demo dataset from ${dbName}.`)
      return
    }

    const authorityId = 1
    // The three actors are three DIFFERENT people on purpose. Separation of duties is enforced by
    // the permission catalogue, by the routes and by a CHECK constraint on finance.budget_revision
    // (decided_by <> requested_by); a dataset in which one account both prepared and approved
    // would be rejected by the database and would misrepresent the control if it were not.
    // `demo.treasurer` is the finance_committee account — the only role holding the three approval
    // permissions (migration 188:1180-1192).
    const preparer = await userIdByEmail(db, 'demo.budget-officer@vungu.test')
    const approver = await userIdByEmail(db, 'demo.treasurer@vungu.test')
    const officer = await userIdByEmail(db, 'demo.finance-officer@vungu.test')

    // ── The year ────────────────────────────────────────────────────────────────────────────────
    const { rows: yearRows } = await db.query(
      `INSERT INTO finance.financial_year
         (authority_id, label, start_date, end_date, status, reporting_currency, opened_at, opened_by, notes, created_by)
       VALUES ($1, $2, '2026-07-01', '2027-06-30', 'open', 'USD', now(), $3,
               'Synthetic demonstration data. Not a Council financial year and not a Council figure.', $3)
       RETURNING id`, [authorityId, YEAR_LABEL, officer])
    const yearId = yearRows[0].id

    // ── Classifications ─────────────────────────────────────────────────────────────────────────
    const dept = {}
    for (const d of DEPARTMENTS) {
      const { rows } = await db.query(
        `INSERT INTO finance.department (authority_id, code, name, vote_number, status, created_by)
         VALUES ($1,$2,$3,$4,'active',$5) RETURNING id`,
        [authorityId, d.code, d.name, d.vote, officer])
      dept[d.code] = rows[0].id
    }
    const prog = {}
    for (const p of PROGRAMMES) {
      const { rows } = await db.query(
        `INSERT INTO finance.programme (authority_id, department_id, code, name, status, created_by)
         VALUES ($1,$2,$3,$4,'active',$5) RETURNING id`,
        [authorityId, dept[p.dept], p.code, p.name, officer])
      prog[p.code] = rows[0].id
    }
    const act = {}
    for (const a of ACTIVITIES) {
      const { rows } = await db.query(
        `INSERT INTO finance.activity (authority_id, programme_id, code, name, status, created_by)
         VALUES ($1,$2,$3,$4,'active',$5) RETURNING id`,
        [authorityId, prog[a.prog], a.code, a.name, officer])
      act[a.code] = rows[0].id
    }
    const acct = {}
    for (const a of ACCOUNTS) {
      const { rows } = await db.query(
        `INSERT INTO finance.account
           (authority_id, code, name, kind, expenditure_class, revenue_class, is_postable, status, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,true,'active',$7) RETURNING id`,
        [authorityId, a.code, a.name, a.kind, a.exp || null, a.rev || null, officer])
      acct[a.code] = rows[0].id
    }

    // ── Budget lines, approved by someone other than the preparer ───────────────────────────────
    const line = {}
    for (const l of LINES) {
      const { rows } = await db.query(
        `INSERT INTO finance.budget_line
           (authority_id, financial_year_id, department_id, programme_id, activity_id, account_id,
            ward_code, funding_source_account_id, code, description, currency, original_amount,
            status, submitted_at, submitted_by, approved_at, approved_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'approved',now(),$13,now(),$14,$13)
         RETURNING id`,
        [authorityId, yearId, dept[l.dept], l.prog ? prog[l.prog] : null, l.act ? act[l.act] : null,
          acct[l.acct], l.ward, l.fund ? acct[l.fund] : null, l.code, l.descr, l.ccy, l.amount,
          preparer, approver])
      line[l.code] = rows[0].id
    }

    // ── Revisions: a supplementary allocation and a reduction, both approved ────────────────────
    // Signed deltas, and decided by someone other than the requester — the CHECK constraint on
    // finance.budget_revision (decided_by <> requested_by) enforces that regardless of this file.
    const revisions = [
      { code: 'DD-L01', delta: 45000, ccy: 'USD', reason: 'Supplementary allocation for storm damage on the Ward 1 road network (demo).' },
      { code: 'DD-L04', delta: -20000, ccy: 'USD', reason: 'Reduction following a lower drug tender price than estimated (demo).' },
      { code: 'DD-L12', delta: 130000, ccy: 'USD', reason: 'Supplementary capital allocation, devolution funds carried to construction (demo).' },
      { code: 'DD-L09', delta: 3000000, ccy: 'ZWG', reason: 'Supplementary allocation for local purchases after price movement (demo).' },
    ]
    let revNo = 0
    for (const r of revisions) {
      revNo += 1
      await db.query(
        `INSERT INTO finance.budget_revision
           (authority_id, budget_line_id, revision_no, amount_delta, currency, reason, state,
            effective_date, requested_by, requested_at, decided_by, decided_at, decision_note)
         VALUES ($1,$2,$3,$4,$5,$6,'approved','2026-10-01',$7,now(),$8,now(),
                 'Approved by the finance committee (demo).')`,
        [authorityId, line[r.code], revNo, r.delta, r.ccy, r.reason, preparer, approver])
    }

    // ── Transactions: twelve months, both currencies, revenue and expenditure ───────────────────
    //
    // Generated in SQL so the amounts are NUMERIC from the moment they exist and no figure in this
    // dataset was ever a JavaScript float. The spread is deliberately uneven — one line overspends
    // its revised budget, one barely moves — so that an exception feed and a variance report have
    // something true to find rather than a uniform 1/12th per month.
    const postings = [
      { code: 'DD-L01', months: 12, perMonth: 29000, ward: 'ZW102101' },   // overspends after revision
      { code: 'DD-L02', months: 9, perMonth: 38000, ward: 'ZW102102' },
      { code: 'DD-L03', months: 6, perMonth: 21000, ward: 'ZW102103' },
      { code: 'DD-L04', months: 12, perMonth: 9000, ward: 'ZW102104' },
      { code: 'DD-L05', months: 12, perMonth: 34000, ward: null },
      { code: 'DD-L06', months: 12, perMonth: 13000, ward: null },
      { code: 'DD-L07', months: 12, perMonth: 68000, ward: null },         // revenue
      { code: 'DD-L08', months: 4, perMonth: 162500, ward: null },         // grant, quarterly
      { code: 'DD-L09', months: 12, perMonth: 1900000, ward: 'ZW102101' }, // ZWG
      { code: 'DD-L10', months: 12, perMonth: 1100000, ward: null },       // ZWG revenue
      { code: 'DD-L11', months: 3, perMonth: 4000, ward: 'ZW102102' },     // barely moves
      { code: 'DD-L12', months: 8, perMonth: 72000, ward: 'ZW102104' },
    ]
    for (const p of postings) {
      const meta = LINES.find((l) => l.code === p.code)
      await db.query(
        `INSERT INTO finance.transaction
           (authority_id, financial_year_id, account_id, department_id, programme_id, activity_id,
            ward_code, budget_line_id, txn_date, amount, currency, description, reference,
            record_type, counterparty_ref, counterparty_name, source_system, source_ref,
            posted_at, created_by)
         SELECT $1, $2, $3, $4, $5, $6, $7, $8,
                (DATE '2026-07-15' + (n || ' month')::interval)::date,
                $9::numeric, $10, $11 || ' — month ' || (n + 1),
                'DD-VCH-' || $12 || '-' || lpad((n + 1)::text, 2, '0'),
                CASE WHEN $13 = 'revenue' THEN 'receipt' ELSE 'payment' END,
                'DD-CP-' || lpad(((n % 4) + 1)::text, 3, '0'),
                (ARRAY['Chimanda Construction (demo)','Gweru Medical Supplies (demo)',
                       'Midlands Fuel Depot (demo)','Vungu Hardware (demo)'])[(n % 4) + 1],
                $14, 'DD-' || $12 || '-' || lpad((n + 1)::text, 2, '0'),
                now(), $15
           FROM generate_series(0, $16::int - 1) AS n`,
        [authorityId, yearId, acct[meta.acct], dept[meta.dept],
          meta.prog ? prog[meta.prog] : null, meta.act ? act[meta.act] : null,
          p.ward, line[p.code], p.perMonth, meta.ccy, meta.descr, p.code,
          ACCOUNTS.find((a) => a.code === meta.acct).kind, SOURCE, officer, p.months])
    }

    // ── A correction: one transaction reversed, and its replacement ─────────────────────────────
    //
    // A correction in this system is a reversal PLUS a replacement, both left visible
    // (finance.transaction.reverses_id, migration 188). The register's default reversal mode has to
    // exclude both halves or every total over this dataset is overstated by the corrected amount.
    // Without a pair in the data that behaviour cannot be tested, which is why one exists here.
    const { rows: toReverse } = await db.query(
      `SELECT id, financial_year_id, account_id, department_id, programme_id, activity_id,
              ward_code, budget_line_id, txn_date, amount, currency, description
         FROM finance.transaction
        WHERE source_system = $1 AND reference = 'DD-VCH-DD-L02-03'
        LIMIT 1`, [SOURCE])
    if (toReverse[0]) {
      const t = toReverse[0]
      await db.query(
        `INSERT INTO finance.transaction
           (authority_id, financial_year_id, account_id, department_id, programme_id, activity_id,
            ward_code, budget_line_id, txn_date, amount, currency, description, reference,
            record_type, source_system, source_ref, reverses_id, posted_at, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,
                 'Reversal of DD-VCH-DD-L02-03 — wrong vote (demo)', 'DD-VCH-DD-L02-03-R',
                 'journal', $12, 'DD-DD-L02-03-R', $13, now(), $14)`,
        [authorityId, t.financial_year_id, t.account_id, t.department_id, t.programme_id,
          t.activity_id, t.ward_code, t.budget_line_id, t.txn_date, -Number(t.amount), t.currency,
          SOURCE, t.id, officer])
    }

    // ── Commitments, in all three live states ───────────────────────────────────────────────────
    const commitments = [
      { code: 'DD-L02', ref: 'DD-PO-0001', amount: 96000, liq: 0, ccy: 'USD', status: 'open', descr: 'Purchase order — culvert pipes (demo)' },
      { code: 'DD-L12', ref: 'DD-PO-0002', amount: 180000, liq: 72000, ccy: 'USD', status: 'partially_liquidated', descr: 'Contract — road construction, Ward 4 (demo)' },
      { code: 'DD-L03', ref: 'DD-PO-0003', amount: 54000, liq: 54000, ccy: 'USD', status: 'liquidated', descr: 'Borehole drilling contract (demo)' },
      { code: 'DD-L09', ref: 'DD-PO-0004', amount: 2600000, liq: 0, ccy: 'ZWG', status: 'open', descr: 'Local purchase order — aggregate (demo)' },
      { code: 'DD-L01', ref: 'DD-PO-0005', amount: 41000, liq: 12000, ccy: 'USD', status: 'partially_liquidated', descr: 'Plant hire — grader (demo)' },
    ]
    for (const c of commitments) {
      await db.query(
        `INSERT INTO finance.commitment
           (authority_id, budget_line_id, reference, amount, currency, committed_on, status,
            liquidated_amount, source_system, source_ref, description, created_by)
         VALUES ($1,$2,$3,$4,$5,'2026-09-01',$6,$7,$8,$3,$9,$10)`,
        [authorityId, line[c.code], c.ref, c.amount, c.ccy, c.status, c.liq, SOURCE, c.descr, officer])
    }

    // ── Variance explanations on SOME lines only ────────────────────────────────────────────────
    // The lines with `explain: false` are left unexplained on purpose: a variance report whose
    // whole value is distinguishing an explained variance from an unexplained one needs both.
    for (const l of LINES.filter((x) => x.explain)) {
      await db.query(
        `INSERT INTO finance.variance_explanation
           (authority_id, financial_year_id, budget_line_id, department_id, period_label,
            explanation, recorded_by)
         VALUES ($1,$2,$3,$4,'Q2 2026/27',$5,$6)`,
        [authorityId, yearId, line[l.code], dept[l.dept],
          `Variance on ${l.code} arises from price movement on inputs procured earlier in the year than estimated (demo explanation, not a Council statement).`,
          officer])
    }

    // ── Projects, including one where spend runs ahead of physical progress ─────────────────────
    // `physical_progress_percent` is NULL on one project and 0 on another. Those are different
    // facts (decision D12, migration 202): NULL means no report was made, 0 means a report was
    // made and nothing has been built. A screen that renders both as "0 %" is wrong.
    const projects = [
      { ref: 'DD-PRJ-001', name: 'Ward 2 culvert programme (demo)', dept: 'DD-ENG', ward: 'ZW102102', ccy: 'USD', budget: 480000, status: 'in_progress', progress: 35, line: 'DD-L02', alloc: 340000 },
      { ref: 'DD-PRJ-002', name: 'Ward 4 road construction (demo)', dept: 'DD-ENG', ward: 'ZW102104', ccy: 'USD', budget: 850000, status: 'in_progress', progress: 20, line: 'DD-L12', alloc: 576000 },
      { ref: 'DD-PRJ-003', name: 'Ward 3 borehole rehabilitation (demo)', dept: 'DD-ENG', ward: 'ZW102103', ccy: 'USD', budget: 260000, status: 'in_progress', progress: null, line: 'DD-L03', alloc: 126000 },
      { ref: 'DD-PRJ-004', name: 'Clinic outreach vehicles (demo)', dept: 'DD-HLT', ward: 'ZW102104', ccy: 'USD', budget: 150000, status: 'approved', progress: 0, line: 'DD-L04', alloc: 108000 },
    ]
    for (const p of projects) {
      const { rows } = await db.query(
        `INSERT INTO finance.project
           (authority_id, reference, name, description, department_id, ward_code, location_text,
            funding_source_account_id, start_date, end_date, status, currency, approved_budget,
            physical_progress_percent, progress_recorded_at, progress_recorded_by,
            approved_at, approved_by, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'2026-08-01','2027-05-31',$9,$10,$11,$12,
                 CASE WHEN $12::numeric IS NULL THEN NULL ELSE now() END,
                 CASE WHEN $12::numeric IS NULL THEN NULL ELSE $13::uuid END,
                 now(),$14,$13)
         RETURNING id`,
        [authorityId, p.ref, p.name, 'Synthetic demonstration project. Not a Council project.',
          dept[p.dept], p.ward, `Ward ${p.ward} (demo)`, acct['DD-1300'], p.status, p.ccy,
          p.budget, p.progress, officer, approver])
      const projectId = rows[0].id
      await db.query(
        `INSERT INTO finance.project_allocation
           (authority_id, project_id, budget_line_id, amount, currency, allocation_type,
            effective_date, note, financial_year_id, created_by)
         VALUES ($1,$2,$3,$4,$5,'original','2026-08-01','Original allocation (demo).',$6,$7)`,
        [authorityId, projectId, line[p.line], p.alloc, p.ccy, yearId, officer])
      // Link the line's postings to the project so project spend is traceable to the register.
      await db.query(
        `INSERT INTO finance.project_transaction
           (authority_id, project_id, transaction_id, association, share, note, created_by)
         SELECT $1, $2, t.id, 'direct', 1, 'Linked by the demo seed.', $4
           FROM finance.transaction t
          WHERE t.source_system = $3 AND t.budget_line_id = $5 AND t.reverses_id IS NULL`,
        [authorityId, projectId, SOURCE, officer, line[p.line]])
    }

    await db.query('COMMIT')
    console.log(`Seeded the synthetic finance demo dataset into ${dbName}.`)
    console.log(`  Financial year: ${YEAR_LABEL}`)
    console.log('  July-to-June on purpose, so a period report bucketing from January is visible.\n')
    await report(db)
    console.log('\nRemove it again with: node scripts/seed-finance-director-demo.js --clean')
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    await db.end()
  }
}

main().catch((err) => { console.error(err.message); process.exit(1) })
