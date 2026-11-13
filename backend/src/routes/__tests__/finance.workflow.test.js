/**
 * End-to-end financial workflow verification with realistic synthetic Vungu RDC data.
 *
 * The chain under test:
 *   Financial Year → Department → Budget → Budget Revision → Revenue/Expenditure
 *   → Transaction → Project → Financial Report → Public Portal
 *
 * It asserts the properties a council auditor cares about:
 *   - revised allocation = original + approved revisions
 *   - actual expenditure lands on the correct budget line
 *   - project-linked spend is a view of the same transaction, never an extra cost
 *   - USD and ZWG are reported separately and never added together
 *   - the public portal shows only approved-and-published datasets, and withdrawal removes them
 *   - a closed financial year refuses new financial records
 *
 * Run with:
 *   DATABASE_URL='postgresql://…/vungu_acceptance_test' \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.workflow.test.js --runInBand
 *
 * Everything is tagged and removed in afterAll. No production data is touched.
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `WF${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })

describe('financial workflow verification (synthetic Vungu RDC data)', () => {
  let app
  const as = {}
  const made = {
    yearId: null, worksId: null, healthId: null,
    roadsUsdId: null, roadsZwgId: null, ratesUsdId: null, healthUsdId: null,
    revisionId: null, projectId: null, expenditurePublication: null,
  }
  const tx = {}

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    const accounts = {
      financeAdmin: 'demo.finance-admin@vungu.test',
      financeOfficer: 'demo.finance-officer@vungu.test',
      budgetOfficer: 'demo.budget-officer@vungu.test',
      committee: 'demo.treasurer@vungu.test',
      publisher: 'demo.publisher@vungu.test',
      auditor: 'demo.auditor@vungu.test',
    }
    for (const [key, email] of Object.entries(accounts)) {
      as[key] = await loginAs(app, email, PASSWORD)
    }

    // ── Financial year and departments ────────────────────────────────────────────────────────
    const year = await app.inject({
      method: 'POST', url: '/api/finance/financial-years', headers: auth(as.financeAdmin),
      payload: { label: `${TAG} Vungu 2033`, start_date: '2033-01-01', end_date: '2033-12-31', reporting_currency: 'USD' },
    })
    expect(year.statusCode).toBe(201)
    made.yearId = year.json().data.id
    expect((await app.inject({
      method: 'POST', url: `/api/finance/financial-years/${made.yearId}/open`, headers: auth(as.financeAdmin),
    })).statusCode).toBe(200)

    for (const [key, code, name] of [
      ['worksId', `${TAG}-WKS`, 'Works and Roads'],
      ['healthId', `${TAG}-HLT`, 'Health Services'],
    ]) {
      const res = await app.inject({
        method: 'POST', url: '/api/finance/departments', headers: auth(as.financeAdmin),
        payload: { code, name },
      })
      expect(res.statusCode).toBe(201)
      made[key] = res.json().data.id
    }

    // ── Chart of accounts ────────────────────────────────────────────────────────────────────
    const chart = await app.inject({
      method: 'POST', url: '/api/finance/accounts/bulk', headers: auth(as.financeAdmin),
      payload: { accounts: [
        { code: `${TAG}-1100`, name: 'Property rates', kind: 'revenue', revenue_class: 'internally_generated' },
        { code: `${TAG}-1200`, name: 'Devolution grant', kind: 'revenue', revenue_class: 'grant' },
        { code: `${TAG}-5100`, name: 'Roads maintenance', kind: 'expenditure', expenditure_class: 'recurrent' },
        { code: `${TAG}-5200`, name: 'Clinic operating costs', kind: 'expenditure', expenditure_class: 'recurrent' },
      ] },
    })
    expect(chart.statusCode).toBe(200)
    expect(chart.json().data.refused).toEqual([])

    const all = (await app.inject({
      method: 'GET', url: '/api/finance/accounts', headers: auth(as.financeAdmin),
    })).json().data
    const accountId = (code) => all.find((a) => a.code === `${TAG}-${code}`).id

    // ── Budget lines, submitted and approved ────────────────────────────────────────────────
    const createLine = async (payload) => {
      const res = await app.inject({
        method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.financeAdmin),
        payload: { financial_year_id: made.yearId, currency: 'USD', ...payload },
      })
      expect(res.statusCode).toBe(201)
      return res.json().data.id
    }
    made.roadsUsdId = await createLine({
      department_id: made.worksId, account_id: accountId('5100'), code: `${TAG}-WKS-ROADS-USD`,
      description: 'Urban road rehabilitation and grading', original_amount: '500000.00',
    })
    made.roadsZwgId = await createLine({
      department_id: made.worksId, account_id: accountId('5100'), code: `${TAG}-WKS-ROADS-ZWG`,
      description: 'Road maintenance funded in local currency', currency: 'ZWG', original_amount: '1000000.00',
    })
    made.ratesUsdId = await createLine({
      department_id: made.worksId, account_id: accountId('1100'), code: `${TAG}-WKS-RATES-USD`,
      description: 'Property rates collection', original_amount: '800000.00',
    })
    made.healthUsdId = await createLine({
      department_id: made.healthId, account_id: accountId('5200'), code: `${TAG}-HLT-CLINICS-USD`,
      description: 'Clinic operating costs', original_amount: '200000.00',
    })

    for (const id of [made.roadsUsdId, made.roadsZwgId, made.ratesUsdId, made.healthUsdId]) {
      expect((await app.inject({
        method: 'POST', url: `/api/finance/budget-lines/${id}/submit`, headers: auth(as.budgetOfficer),
      })).statusCode).toBe(200)
      const approved = await app.inject({
        method: 'POST', url: `/api/finance/budget-lines/${id}/approve`, headers: auth(as.committee),
        payload: {},
      })
      expect(approved.statusCode).toBe(200)
      expect(approved.json().data.status).toBe('approved')
    }

    // ── A supplementary revision on the USD roads vote ──────────────────────────────────────
    const revision = await app.inject({
      method: 'POST', url: `/api/finance/budget-lines/${made.roadsUsdId}/revisions`,
      headers: auth(as.budgetOfficer),
      payload: { amount_delta: '50000.00', reason: 'Supplementary allocation for the rainy-season road programme' },
    })
    expect(revision.statusCode).toBe(201)
    made.revisionId = revision.json().data.id
    expect((await app.inject({
      method: 'POST', url: `/api/finance/budget-revisions/${made.revisionId}/submit`,
      headers: auth(as.budgetOfficer),
    })).statusCode).toBe(200)
    const approvedRevision = await app.inject({
      method: 'POST', url: `/api/finance/budget-revisions/${made.revisionId}/approve`,
      headers: auth(as.committee), payload: { note: 'Approved by the finance committee' },
    })
    expect(approvedRevision.statusCode).toBe(200)
    expect(approvedRevision.json().data.state).toBe('approved')

    // ── A capital project drawing on the roads vote ─────────────────────────────────────────
    const project = await app.inject({
      method: 'POST', url: '/api/finance/projects', headers: auth(as.financeAdmin),
      payload: {
        reference: `${TAG}-PRJ-ROADS`, name: 'Gweru urban road rehabilitation',
        description: 'Regrading and drainage for 12km of urban roads',
        department_id: made.worksId, ward_code: 'WARD-07', location_text: 'Vungu Ward 7',
        longitude: 29.82, latitude: -19.45, currency: 'USD', approved_budget: '120000.00',
        start_date: '2033-02-01', end_date: '2033-11-30',
      },
    })
    expect(project.statusCode).toBe(201)
    made.projectId = project.json().data.project.id
    expect((await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/submit`, headers: auth(as.financeAdmin),
    })).statusCode).toBe(200)
    expect((await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/approve`, headers: auth(as.committee),
    })).statusCode).toBe(200)

    const allocation = await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/allocations`,
      headers: auth(as.financeAdmin),
      payload: { budget_line_id: made.roadsUsdId, amount: '120000.00' },
    })
    expect(allocation.statusCode).toBe(201)

    // ── Transactions, recorded the way the import/commit path writes them ───────────────────
    const authority = (await systemOf(app.pg).query(
      'SELECT authority_id FROM finance.financial_year WHERE id = $1', [made.yearId],
    )).rows[0].authority_id
    const insertTx = async (key, { lineId, deptId, accountCode, date, amount, currency, description }) => {
      const { rows } = await systemOf(app.pg).query(
        `INSERT INTO finance.transaction
           (authority_id, financial_year_id, account_id, department_id, budget_line_id, txn_date,
            amount, currency, description, reference, record_type, source_system, source_ref, posted_at, created_by)
         VALUES ($1,$2,(SELECT id FROM finance.account WHERE code = $3),
                 $4,$5,$6,$7::numeric,$8,$9,$10,'actual','SYNTHETIC_VUNGU',$10,now(),
                 (SELECT id FROM users WHERE email = 'demo.finance-officer@vungu.test'))
         RETURNING id`,
        [authority, made.yearId, `${TAG}-${accountCode}`, deptId, lineId, date, amount, currency,
          description, `${TAG}-${key}`],
      )
      tx[key] = rows[0].id
    }
    await insertTx('ROADS-PROJECT', {
      lineId: made.roadsUsdId, deptId: made.worksId, accountCode: '5100', date: '2033-03-15',
      amount: '40000.00', currency: 'USD', description: 'Road rehabilitation contractor payment',
    })
    await insertTx('ROADS-OTHER', {
      lineId: made.roadsUsdId, deptId: made.worksId, accountCode: '5100', date: '2033-04-02',
      amount: '10000.00', currency: 'USD', description: 'Grader fuel and operator costs',
    })
    await insertTx('RATES', {
      lineId: made.ratesUsdId, deptId: made.worksId, accountCode: '1100', date: '2033-03-31',
      amount: '300000.00', currency: 'USD', description: 'Property rates collected, first quarter',
    })
    await insertTx('ROADS-ZWG', {
      lineId: made.roadsZwgId, deptId: made.worksId, accountCode: '5100', date: '2033-05-10',
      amount: '200000.00', currency: 'ZWG', description: 'Local-currency road maintenance',
    })

    // The project-linked transaction is the SAME row, associated once.
    const linked = await app.inject({
      method: 'POST', url: `/api/finance/projects/${made.projectId}/transactions`,
      headers: auth(as.financeAdmin), payload: { transaction_id: tx['ROADS-PROJECT'], association: 'direct' },
    })
    expect(linked.statusCode).toBe(201)
  }, 180000)

  afterAll(async () => {
    if (!app) return
    const pg = systemOf(app.pg)
    // A closed year refuses writes; reopen it so the tagged fixture can be removed.
    await pg.query(`UPDATE finance.financial_year SET status = 'open' WHERE label LIKE '${TAG}%'`).catch(() => {})
    const statements = [
      `DELETE FROM finance.project_transaction WHERE project_id IN (SELECT id FROM finance.project WHERE reference LIKE '${TAG}%')`,
      `DELETE FROM finance.project_allocation WHERE project_id IN (SELECT id FROM finance.project WHERE reference LIKE '${TAG}%')`,
      `DELETE FROM finance.project WHERE reference LIKE '${TAG}%'`,
      `DELETE FROM finance.publication WHERE financial_year_id IN (SELECT id FROM finance.financial_year WHERE label LIKE '${TAG}%')`,
      `DELETE FROM finance.variance_explanation WHERE financial_year_id IN (SELECT id FROM finance.financial_year WHERE label LIKE '${TAG}%')`,
      `DELETE FROM finance.budget_revision WHERE budget_line_id IN (SELECT id FROM finance.budget_line WHERE code LIKE '${TAG}%')`,
      `DELETE FROM finance.transaction WHERE source_ref LIKE '${TAG}%'`,
      `DELETE FROM finance.budget_line WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.account WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.department WHERE code LIKE '${TAG}%'`,
      `DELETE FROM finance.financial_year WHERE label LIKE '${TAG}%'`,
    ]
    for (const statement of statements) await pg.query(statement).catch(() => {})
    await app.close()
  }, 60000)

  // ── Budget arithmetic ──────────────────────────────────────────────────────────────────────
  test('the revised allocation is the original vote plus the approved revision', async () => {
    const res = await app.inject({
      method: 'GET', url: `/api/finance/performance?financial_year_id=${made.yearId}&kind=expenditure`,
      headers: auth(as.auditor),
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json().data.rows
    const usdRoads = rows.find((r) => r.department_id === made.worksId && r.currency === 'USD')
    expect(usdRoads.original_amount).toBe('500000.00')
    expect(usdRoads.approved_adjustments).toBe('50000.00')
    expect(usdRoads.revised_amount).toBe('550000.00')
    expect(usdRoads.actual_amount).toBe('50000.00')
    expect(usdRoads.available_excluding_commitments).toBe('500000.00')
    expect(res.json().data.currencies_present.sort()).toEqual(['USD', 'ZWG'])
  })

  test('revenue and expenditure land on the correct budget line and department', async () => {
    const expenditure = await app.inject({
      method: 'GET', url: `/api/finance/performance?financial_year_id=${made.yearId}&kind=expenditure`,
      headers: auth(as.auditor),
    })
    const expRows = expenditure.json().data.rows
    const worksUsd = expRows.find((r) => r.department_id === made.worksId && r.currency === 'USD')
    const worksZwg = expRows.find((r) => r.department_id === made.worksId && r.currency === 'ZWG')
    const healthUsd = expRows.find((r) => r.department_id === made.healthId && r.currency === 'USD')
    expect(worksUsd.actual_amount).toBe('50000.00')
    expect(worksZwg.actual_amount).toBe('200000.00')
    expect(healthUsd.actual_amount).toBe('0.00')

    const revenue = await app.inject({
      method: 'GET', url: `/api/finance/performance?financial_year_id=${made.yearId}&kind=revenue`,
      headers: auth(as.auditor),
    })
    const revRows = revenue.json().data.rows
    expect(revRows).toHaveLength(1)
    expect(revRows[0].department_id).toBe(made.worksId)
    expect(revRows[0].currency).toBe('USD')
    expect(revRows[0].actual_amount).toBe('300000.00')
    expect(revRows[0].revised_amount).toBe('800000.00')
  })

  test('departmental allocations reconcile to the sum of their lines', async () => {
    const { rows } = await systemOf(app.pg).query(
      `SELECT currency,
              sum(revised_amount)::text AS revised,
              sum(actual_amount)::text AS actual
         FROM finance.v_budget_line_performance
        WHERE financial_year_id = $1 AND account_kind = 'expenditure'
        GROUP BY currency ORDER BY currency`, [made.yearId],
    )
    const byCurrency = Object.fromEntries(rows.map((r) => [r.currency, r]))
    // USD: roads 550,000 + health 200,000; actual 50,000.
    expect(byCurrency.USD.revised).toBe('750000.00')
    expect(byCurrency.USD.actual).toBe('50000.00')
    // ZWG: one line of 1,000,000; actual 200,000. Never combined with USD.
    expect(byCurrency.ZWG.revised).toBe('1000000.00')
    expect(byCurrency.ZWG.actual).toBe('200000.00')
  })

  // ── Project spend is not double-counted ───────────────────────────────────────────────────
  test('project-linked spend is a view of the same transaction, not a second cost', async () => {
    const trace = await app.inject({
      method: 'GET', url: `/api/finance/projects/${made.projectId}`, headers: auth(as.financeAdmin),
    })
    expect(trace.statusCode).toBe(200)
    const project = trace.json().data.project
    expect(project.allocated_total).toBe('120000.00')
    expect(project.actual_spend).toBe('40000.00')
    expect(project.execution_percentage).toBe('33.33')

    // The budget line's actual is 50,000 — the two transactions — not 90,000. The 40,000 that is
    // project-linked is already inside that 50,000.
    const { rows } = await systemOf(app.pg).query(
      `SELECT actual_amount::text AS actual FROM finance.v_budget_line_performance
        WHERE budget_line_id = $1`, [made.roadsUsdId],
    )
    expect(rows[0].actual).toBe('50000.00')

    const { rows: totals } = await systemOf(app.pg).query(
      `SELECT
         (SELECT COALESCE(sum(amount), 0)::text FROM finance.transaction
           WHERE financial_year_id = $1 AND currency = 'USD' AND deleted_at IS NULL
             AND account_id = (SELECT id FROM finance.account WHERE code = $2)) AS all_usd_expenditure,
         (SELECT COALESCE(sum(t.amount * pt.share), 0)::text
            FROM finance.project_transaction pt
            JOIN finance.transaction t ON t.id = pt.transaction_id
           WHERE pt.project_id = $3 AND pt.deleted_at IS NULL) AS project_spend`,
      [made.yearId, `${TAG}-5100`, made.projectId],
    )
    expect(totals[0].all_usd_expenditure).toBe('50000.00')
    expect(Number(totals[0].project_spend)).toBeCloseTo(40000, 2)
    // The project share cannot exceed the expenditure it is drawn from.
    expect(Number(totals[0].project_spend)).toBeLessThanOrEqual(Number(totals[0].all_usd_expenditure))
  })

  // ── Reports ───────────────────────────────────────────────────────────────────────────────
  test('the budget-versus-actual report keeps currencies separate and matches the ledger', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/api/finance/reports/run?report=budget_vs_actual&financial_year_id=${made.yearId}&format=json`,
      headers: auth(as.auditor),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json().data
    const roads = body.rows.find((r) => r.budget_line_code === `${TAG}-WKS-ROADS-USD`)
    expect(roads.revised_amount).toBe('550000.00')
    expect(roads.actual_amount).toBe('50000.00')
    expect(roads.currency).toBe('USD')

    const totals = {}
    for (const row of body.rows) {
      totals[row.currency] = totals[row.currency] || { revised: 0, actual: 0 }
      totals[row.currency].revised += Number(row.revised_amount)
      totals[row.currency].actual += Number(row.actual_amount)
    }
    expect(totals.USD.actual).toBeCloseTo(350000, 2) // 50,000 expenditure + 300,000 revenue
    expect(totals.ZWG.actual).toBeCloseTo(200000, 2)
    // No row ever mixes the two currencies.
    expect(body.rows.every((r) => ['USD', 'ZWG'].includes(r.currency))).toBe(true)
  })

  // ── Public portal ─────────────────────────────────────────────────────────────────────────
  test('nothing is public before publication', async () => {
    const years = await app.inject({ method: 'GET', url: '/api/public/finance/years' })
    expect(years.json().data.some((y) => y.id === made.yearId)).toBe(false)

    const transactions = await app.inject({
      method: 'GET', url: `/api/public/finance/transactions?financial_year_id=${made.yearId}`,
    })
    expect(transactions.json().data.total).toBe(0)
  })

  test('approved-and-published budget, revenue, expenditure and projects reach the portal', async () => {
    const publish = async (dataset, { markBudgetLines = false } = {}) => {
      const created = await app.inject({
        method: 'POST', url: '/api/finance/publications', headers: auth(as.financeAdmin),
        payload: {
          financial_year_id: made.yearId, dataset,
          reporting_period_label: `${TAG} 2033 full year`, data_as_at: '2033-12-31',
        },
      })
      expect(created.statusCode).toBe(201)
      const id = created.json().data.id
      expect((await app.inject({
        method: 'POST', url: `/api/finance/publications/${id}/approve`,
        headers: auth(as.committee), payload: { note: 'Approved for public release' },
      })).statusCode).toBe(200)
      if (markBudgetLines) {
        const marked = await app.inject({
          method: 'POST', url: `/api/finance/publications/${id}/mark-budget-lines`,
          headers: auth(as.publisher), payload: {},
        })
        expect(marked.statusCode).toBe(200)
        expect(marked.json().data.marked).toBe(4)
      }
      const published = await app.inject({
        method: 'POST', url: `/api/finance/publications/${id}/publish`, headers: auth(as.publisher),
      })
      expect(published.statusCode).toBe(200)
      expect(published.json().data.publication.state).toBe('published')
      return id
    }

    await publish('budget', { markBudgetLines: true })
    await publish('revenue')
    made.expenditurePublication = await publish('expenditure')
    await publish('projects')

    const overview = await app.inject({
      method: 'GET', url: `/api/public/finance/overview?financial_year_id=${made.yearId}`,
    })
    expect(overview.statusCode).toBe(200)
    const summary = Object.fromEntries(overview.json().data.summary.map((s) => [s.currency, s]))
    expect(summary.USD.expenditure.budget.revised_amount).toBe('750000.00')
    expect(summary.USD.revenue.budget.revised_amount).toBe('800000.00')
    expect(summary.ZWG.expenditure.budget.revised_amount).toBe('1000000.00')
    expect(overview.json().data.definitions.currency).toMatch(/never added together/i)

    const budget = await app.inject({
      method: 'GET', url: `/api/public/finance/budget?financial_year_id=${made.yearId}`,
    })
    expect(budget.statusCode).toBe(200)
    expect(budget.json().data.total).toBe(4)

    const expenditure = await app.inject({
      method: 'GET', url: `/api/public/finance/expenditure?financial_year_id=${made.yearId}`,
    })
    expect(expenditure.statusCode).toBe(200)
    const expByDept = Object.fromEntries(
      expenditure.json().data.by_department.map((r) => [`${r.department_code}:${r.currency}`, r.amount]),
    )
    expect(expByDept[`${TAG}-WKS:USD`]).toBe('50000.00')
    expect(expByDept[`${TAG}-WKS:ZWG`]).toBe('200000.00')

    const revenue = await app.inject({
      method: 'GET', url: `/api/public/finance/revenue?financial_year_id=${made.yearId}`,
    })
    expect(revenue.json().data.by_department[0].amount).toBe('300000.00')
    expect(revenue.json().data.by_department[0].currency).toBe('USD')

    const projects = await app.inject({
      method: 'GET', url: `/api/public/finance/projects?financial_year_id=${made.yearId}`,
    })
    expect(projects.statusCode).toBe(200)
    const publishedProject = projects.json().data.projects.find((p) => p.reference === `${TAG}-PRJ-ROADS`)
    expect(publishedProject).toBeTruthy()
    expect(publishedProject.actual_spend).toBe('40000.00')
    expect(publishedProject.allocated_total).toBe('120000.00')

    const transactions = await app.inject({
      method: 'GET', url: `/api/public/finance/transactions?financial_year_id=${made.yearId}`,
    })
    expect(transactions.json().data.total).toBe(4)
    expect(new Set(transactions.json().data.transactions.map((t) => t.currency))).toEqual(new Set(['USD', 'ZWG']))
    expect(transactions.json().data.transactions[0]).not.toHaveProperty('counterparty_name')

    // One transaction in detail, with its attached documents. The documents list is gated on a
    // live `documents` publication, which this year does not have, so it is empty rather than
    // carrying a document the council classified public but never released (audit BLOCKER-1).
    const one = await app.inject({
      method: 'GET',
      url: `/api/public/finance/transactions/${transactions.json().data.transactions[0].id}`,
    })
    expect(one.statusCode).toBe(200)
    expect(one.json().data.transaction).not.toHaveProperty('counterparty_name')
    expect(one.json().data.documents).toEqual([])
  })

  test('withdrawing the expenditure publication removes it from the portal at once', async () => {
    const withdrawn = await app.inject({
      method: 'POST', url: `/api/finance/publications/${made.expenditurePublication}/withdraw`,
      headers: auth(as.publisher),
      payload: { reason: 'Withdrawn for correction of the Q2 expenditure classification' },
    })
    expect(withdrawn.statusCode).toBe(200)

    const expenditure = await app.inject({
      method: 'GET', url: `/api/public/finance/expenditure?financial_year_id=${made.yearId}`,
    })
    expect(expenditure.statusCode).toBe(200)
    expect(expenditure.json().data.by_department).toEqual([])
    expect(expenditure.json().data.by_account).toEqual([])
  })

  // ── Closed-year protection ────────────────────────────────────────────────────────────────
  test('a closed financial year refuses new financial records', async () => {
    const closed = await app.inject({
      method: 'POST', url: `/api/finance/financial-years/${made.yearId}/close`,
      headers: auth(as.financeAdmin), payload: { note: 'Closed after the 2033 audit' },
    })
    expect(closed.statusCode).toBe(200)
    expect(closed.json().data.status).toBe('closed')

    const newLine = await app.inject({
      method: 'POST', url: '/api/finance/budget-lines', headers: auth(as.financeAdmin),
      payload: {
        financial_year_id: made.yearId, department_id: made.worksId,
        account_id: (await systemOf(app.pg).query(
          'SELECT id FROM finance.account WHERE code = $1', [`${TAG}-5100`],
        )).rows[0].id,
        code: `${TAG}-AFTER-CLOSE`, description: 'Should not exist', currency: 'USD', original_amount: '1.00',
      },
    })
    expect(newLine.statusCode).toBe(409)
    expect(newLine.json().error).toBe('year_closed')

    const revision = await app.inject({
      method: 'POST', url: `/api/finance/budget-lines/${made.roadsUsdId}/revisions`,
      headers: auth(as.budgetOfficer),
      payload: { amount_delta: '1000.00', reason: 'Attempted adjustment after the year was closed' },
    })
    expect(revision.statusCode).toBe(409)
    expect(revision.json().error).toBe('year_closed')

    await expect(systemOf(app.pg).query(
      `INSERT INTO finance.transaction
         (authority_id, financial_year_id, account_id, department_id, txn_date, amount, currency,
          source_system, source_ref)
       VALUES ((SELECT authority_id FROM finance.financial_year WHERE id = $1), $1,
               (SELECT id FROM finance.account WHERE code = $2), $3, '2033-12-31', '1.00', 'USD',
               'SYNTHETIC_VUNGU', $4)`,
      [made.yearId, `${TAG}-5100`, made.worksId, `${TAG}-AFTER-CLOSE`],
    )).rejects.toThrow(/accepts no further financial records/)
  })
})
