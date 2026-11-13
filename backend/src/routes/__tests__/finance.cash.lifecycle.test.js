/**
 * The till session lifecycle (migration 208), through the real routes and the real database.
 *
 * A supervisor assigns a cashier to a counter; the cashier opens a till, takes a payment, suspends
 * and resumes, then leaves the drawer. A second cashier is told who holds it. The supervisor finds
 * the session abandoned (not before the threshold), counts the drawer with a witness (the auditor),
 * and the accountant verifies the count, which neither of them may do for themselves. Along the
 * way: what each role cannot do, the history the session keeps, and the audit trail.
 *
 * What the database refuses with every route bypassed, including the concurrency races, is proven
 * in scripts/verify-cash-session-lifecycle.js. This suite proves the routes reach those rules,
 * translate their refusals and hold the permissions.
 *
 * Run with (a disposable database with migration 208 applied and the demo users seeded):
 *   DATABASE_URL='postgresql://…/vungu_cash208' DEMO_DEFAULT_PASSWORD=demo1234 \
 *     node node_modules/jest/bin/jest.js src/routes/__tests__/finance.cash.lifecycle.test.js \
 *     --testPathIgnorePatterns /node_modules/ --runInBand
 */
const crypto = require('node:crypto')
const { systemOf } = require('../../lib/dbContext')
const { buildFinanceAppForTest } = require('../../../test/helpers/buildApp')
const { loginAs } = require('../../../test/helpers/auth')

const PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234'
const TAG = `LT${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const auth = (token) => ({ authorization: `Bearer ${token}` })

function day(offset) {
  const d = new Date()
  d.setUTCDate(d.getUTCDate() + offset)
  return d.toISOString().slice(0, 10)
}

describe('the till session lifecycle', () => {
  let app
  let sys
  const as = {}
  const id = {}
  const made = {}

  const call = (method, url, token, payload) =>
    app.inject({ method, url: `/api${url}`, headers: token ? auth(token) : {}, ...(payload ? { payload } : {}) })
  const data = (res) => res.json().data
  const marketLine = (amount) => [{ income_code_id: made.market, unit_amount: amount }]

  beforeAll(async () => {
    app = await buildFinanceAppForTest()
    sys = systemOf(app.pg)
    const accounts = {
      director: 'demo.finance-admin@vungu.test',
      accountant: 'demo.accountant@vungu.test',
      supervisor: 'demo.supervisor@vungu.test',
      cashier: 'demo.cashier@vungu.test',
      relief: 'demo.cashier2@vungu.test',
      auditor: 'demo.auditor@vungu.test',
      ceo: 'demo.ceo@vungu.test',
    }
    for (const [key, email] of Object.entries(accounts)) {
      as[key] = await loginAs(app, email, PASSWORD)
      const { rows } = await sys.query('SELECT id FROM public.users WHERE email = $1', [email])
      id[key] = rows[0].id
    }
    // The relief cashier may already hold a demonstration session elsewhere; this suite uses the
    // main cashier for the till and the relief cashier only to look at the counter.

    const year = await call('POST', '/finance/financial-years', as.director, {
      label: `${TAG} Lifecycle year`, start_date: day(-60), end_date: day(300), reporting_currency: 'USD',
    })
    expect(year.statusCode).toBe(201)
    made.yearId = data(year).id
    expect((await call('POST', `/finance/financial-years/${made.yearId}/open`, as.director)).statusCode).toBe(200)
    expect((await call('POST', '/finance/ledger/periods', as.director,
      { financial_year_id: made.yearId, periodicity: 'monthly' })).statusCode).toBeLessThan(300)
    const account = async (code, name, rootType, accountType) => {
      const res = await call('POST', '/finance/ledger/accounts', as.director,
        { code: `${TAG}-${code}`, name, root_type: rootType, ...(accountType ? { account_type: accountType } : {}) })
      expect(res.statusCode).toBe(201)
      return data(res).id
    }
    made.till = await account('1010', 'Lifecycle till', 'asset', 'cash')
    made.marketAcct = await account('4310', 'Lifecycle market fees', 'revenue')
    made.diff = await account('5900', 'Lifecycle differences', 'expense')
    const point = await call('POST', '/finance/cash/points', as.director,
      { code: `${TAG}-MAIN`, name: `${TAG} Lifecycle counter`, till_account_id: made.till, difference_account_id: made.diff })
    expect(point.statusCode).toBe(201)
    made.pointId = data(point).cash_point.id
    const market = await call('POST', '/finance/cash/income-codes', as.director,
      { code: `${TAG}-MKT`, name: `${TAG} Market fee`, ledger_account_id: made.marketAcct })
    expect(market.statusCode).toBe(201)
    made.market = data(market).income_code.id
  })

  afterAll(async () => {
    if (!app) return
    let cleanupError = null
    const client = await sys.connect()
    try {
      await client.query('BEGIN')
      const vouchers = 'SELECT id FROM finance.voucher WHERE financial_year_id = $1'
      const sessions = 'SELECT id FROM finance.cashier_session WHERE financial_year_id = $1'
      await client.query('ALTER TABLE finance.ledger_entry DISABLE TRIGGER trg_ledger_entry_immutable')
      await client.query(`DELETE FROM finance.ledger_entry WHERE voucher_id IN (${vouchers})`, [made.yearId])
      await client.query('ALTER TABLE finance.ledger_entry ENABLE TRIGGER trg_ledger_entry_immutable')
      await client.query('ALTER TABLE finance.cash_receipt DISABLE TRIGGER trg_cash_receipt_immutable')
      await client.query('ALTER TABLE finance.cash_receipt_line DISABLE TRIGGER trg_cash_receipt_line_immutable')
      await client.query(`DELETE FROM finance.cash_receipt_line WHERE cash_receipt_id IN
                            (SELECT id FROM finance.cash_receipt WHERE voucher_id IN (${vouchers}))`, [made.yearId])
      await client.query(`DELETE FROM finance.cash_receipt WHERE voucher_id IN (${vouchers})`, [made.yearId])
      await client.query('ALTER TABLE finance.cash_receipt ENABLE TRIGGER trg_cash_receipt_immutable')
      await client.query('ALTER TABLE finance.cash_receipt_line ENABLE TRIGGER trg_cash_receipt_line_immutable')
      await client.query('ALTER TABLE finance.cashier_session_event DISABLE TRIGGER trg_cashier_session_event_immutable')
      await client.query('ALTER TABLE finance.cashier_session DISABLE TRIGGER trg_cashier_session_transition')
      await client.query('ALTER TABLE finance.cash_point_assignment DISABLE TRIGGER trg_cash_point_assignment_guard')
      await client.query(`DELETE FROM finance.cashier_session_event WHERE cashier_session_id IN (${sessions})`, [made.yearId])
      await client.query(`DELETE FROM finance.cashier_session_count WHERE cashier_session_id IN (${sessions})`, [made.yearId])
      await client.query('DELETE FROM finance.cashier_session WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.cash_point_assignment WHERE cash_point_id = $1', [made.pointId])
      await client.query('ALTER TABLE finance.cashier_session_event ENABLE TRIGGER trg_cashier_session_event_immutable')
      await client.query('ALTER TABLE finance.cashier_session ENABLE TRIGGER trg_cashier_session_transition')
      await client.query('ALTER TABLE finance.cash_point_assignment ENABLE TRIGGER trg_cash_point_assignment_guard')
      await client.query(`UPDATE finance.voucher SET status = 'draft', posted_by = NULL, posted_at = NULL
                           WHERE financial_year_id = $1 AND status <> 'draft'`, [made.yearId])
      await client.query(`DELETE FROM finance.voucher_line WHERE voucher_id IN (${vouchers})`, [made.yearId])
      await client.query('DELETE FROM finance.voucher WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.income_code WHERE code LIKE $1', [`${TAG}%`])
      await client.query('DELETE FROM finance.cash_point WHERE code LIKE $1', [`${TAG}%`])
      await client.query('DELETE FROM finance.ledger_period WHERE financial_year_id = $1', [made.yearId])
      await client.query('DELETE FROM finance.ledger_account WHERE code LIKE $1', [`${TAG}%`])
      await client.query('DELETE FROM finance.financial_year WHERE id = $1', [made.yearId])
      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      cleanupError = err
    } finally {
      client.release()
    }
    await app.close()
    if (cleanupError) throw new Error(`[finance.cash.lifecycle] cleanup of ${TAG} failed: ${cleanupError.message}`)
  })

  /** The audit hook writes after the reply; wait for the row rather than racing it. */
  async function auditRow(action) {
    for (let i = 0; i < 20; i += 1) {
      const { rows } = await sys.query(
        `SELECT event, severity, actor_id, status, details FROM public.admin_audit_event
          WHERE details->>'action' = $1 AND details->>'session_no' = $2 ORDER BY id DESC LIMIT 1`, [action, made.sessionNo])
      if (rows[0]) return rows[0]
      await new Promise((r) => setTimeout(r, 50))
    }
    return null
  }

  test('the cash supervisor holds supervision and nothing that takes money or keeps the book', async () => {
    const permissions = async (token) => new Set((await call('GET', '/finance/me', token)).json().data.permissions)
    const supervisor = await permissions(as.supervisor)
    for (const code of ['finance.cash.view', 'finance.cash.session.supervise', 'finance.cash.assignment.manage',
      'finance.cash.session.verify']) expect(supervisor.has(code)).toBe(true)
    for (const code of ['finance.cash.session.operate', 'finance.cash.receipt.record', 'finance.cash.setup.manage',
      'finance.cash.deposit.prepare', 'finance.ledger.voucher.post', 'finance.ledger.voucher.prepare']) {
      expect(supervisor.has(code)).toBe(false)
    }
    const accountant = await permissions(as.accountant)
    expect(accountant.has('finance.cash.session.supervise')).toBe(false)
    expect(accountant.has('finance.cash.assignment.manage')).toBe(false)
    const cashier = await permissions(as.cashier)
    for (const code of ['finance.cash.session.supervise', 'finance.cash.assignment.manage', 'finance.cash.session.verify']) {
      expect(cashier.has(code)).toBe(false)
    }
    const me = (await call('GET', '/finance/me', as.supervisor)).json().data
    expect(me.home_workspace).toBe('cashier')
  })

  test('only a supervisor reads the drawers, finds a session abandoned, counts under supervision or assigns', async () => {
    const fake = '00000000-0000-4000-8000-000000000000'
    for (const who of [as.cashier, as.accountant, as.auditor, as.ceo]) {
      expect((await call('GET', '/finance/cash/drawers', who)).statusCode).toBe(403)
      expect((await call('POST', `/finance/cash/sessions/${fake}/abandon`, who, { reason: 'left the counter at noon' })).statusCode).toBe(403)
      expect((await call('POST', `/finance/cash/sessions/${fake}/supervised-close`, who,
        { witness_id: fake, counts: [] })).statusCode).toBe(403)
      expect((await call('POST', '/finance/cash/assignments', who, { cash_point_id: made.pointId, user_id: id.cashier })).statusCode).toBe(403)
    }
  })

  test('a supervisor assigns a cashier, never themselves and never someone who does not operate a till', async () => {
    const self = await call('POST', '/finance/cash/assignments', as.supervisor, { cash_point_id: made.pointId, user_id: id.supervisor })
    expect(self.statusCode).toBe(400)
    const notOperator = await call('POST', '/finance/cash/assignments', as.supervisor, { cash_point_id: made.pointId, user_id: id.accountant })
    expect(notOperator.statusCode).toBe(400)
    expect(notOperator.json().message).toMatch(/does not operate a till/)
    const assigned = await call('POST', '/finance/cash/assignments', as.supervisor,
      { cash_point_id: made.pointId, user_id: id.cashier, note: 'morning shift' })
    expect(assigned.statusCode).toBe(201)
    made.assignmentId = data(assigned).id
    const twice = await call('POST', '/finance/cash/assignments', as.supervisor, { cash_point_id: made.pointId, user_id: id.cashier })
    expect(twice.statusCode).toBe(409)

    const list = data(await call('GET', `/finance/cash/assignments?cash_point_id=${made.pointId}`, as.supervisor))
    expect(list.assignments.map((a) => a.user_id)).toEqual([id.cashier])
    expect(list.operators.some((o) => o.id === id.cashier)).toBe(true)
    expect(list.operators.some((o) => o.id === id.accountant)).toBe(false)

    const desk = data(await call('GET', '/finance/cash/desk', as.cashier))
    expect(desk.cash_points.find((p) => p.id === made.pointId).assigned_to_me).toBe(true)
    expect(desk.policy.abandon_after_hours).toEqual({ value: 12, provisional: true, decision: 'D29' })
    expect(desk.policy.require_assignment.provisional).toBe(true)
  })

  test('a cashier suspends and resumes; while suspended the drawer is still held, and nobody else may act for them', async () => {
    const opened = await call('POST', '/finance/cash/sessions', as.cashier,
      { cash_point_id: made.pointId, financial_year_id: made.yearId, floats: [{ currency: 'USD', amount: '50.00' }] })
    expect(opened.statusCode).toBe(201)
    made.sessionId = data(opened).session.id
    made.sessionNo = data(opened).session.session_no
    const paid = await call('POST', '/finance/cash/receipts', as.cashier,
      { session_id: made.sessionId, payer_name: 'T. Moyo', currency: 'USD', method: 'cash', lines: marketLine('30.00') })
    expect(paid.statusCode).toBe(201)

    expect((await call('POST', `/finance/cash/sessions/${made.sessionId}/suspend`, as.relief)).statusCode).toBe(403)
    const suspended = await call('POST', `/finance/cash/sessions/${made.sessionId}/suspend`, as.cashier)
    expect(suspended.statusCode).toBe(200)
    expect(data(suspended).session.status).toBe('suspended')
    expect(data(suspended).session.totals_withheld).toBe(true)

    const relief = data(await call('GET', '/finance/cash/desk', as.relief))
    const point = relief.cash_points.find((p) => p.id === made.pointId)
    expect(point.held_state).toBe('suspended')
    expect(point.held_by_name).toBe('Demo Cashier')
    expect(point.held_session_no).toBe(made.sessionNo)

    const blocked = await call('POST', '/finance/cash/receipts', as.cashier,
      { session_id: made.sessionId, payer_name: 'T. Moyo', currency: 'USD', method: 'cash', lines: marketLine('5.00') })
    expect(blocked.statusCode).toBe(409)
    expect(blocked.json().error).toBe('session_state')
    const countWhileAway = await call('POST', `/finance/cash/sessions/${made.sessionId}/close`, as.cashier, { counts: [] })
    expect(countWhileAway.statusCode).toBe(409)

    const resumed = await call('POST', `/finance/cash/sessions/${made.sessionId}/resume`, as.cashier)
    expect(resumed.statusCode).toBe(200)
    expect(data(resumed).session.status).toBe('open')
    expect(data(await call('GET', '/finance/cash/desk', as.cashier)).my_session.status).toBe('open')
  })

  test('a session is found abandoned only by a supervisor, after the threshold, with a reason, and it still holds the drawer', async () => {
    const early = await call('POST', `/finance/cash/sessions/${made.sessionId}/abandon`, as.supervisor,
      { reason: 'cashier left at 16:00 without cashing up' })
    expect(early.statusCode).toBe(409)
    expect(early.json().error).toBe('too_soon_to_abandon')
    const shortReason = await call('POST', `/finance/cash/sessions/${made.sessionId}/abandon`, as.supervisor, { reason: 'gone' })
    expect(shortReason.statusCode).toBe(400)

    // Thirteen hours on, as the clock would have it the next morning.
    await sys.query(`UPDATE finance.cashier_session SET opened_at = now() - interval '13 hours' WHERE id = $1`, [made.sessionId])
    const board = data(await call('GET', '/finance/cash/drawers', as.supervisor))
    const drawer = board.drawers.find((d) => d.cash_point_id === made.pointId)
    expect(drawer.may_be_abandoned).toBe(true)
    expect(drawer.expected_cash).toEqual([{ currency: 'USD', amount: '80.00' }])
    expect(drawer.receipt_count).toBe(1)
    expect(drawer.assigned.map((a) => a.user_id)).toEqual([id.cashier])

    const found = await call('POST', `/finance/cash/sessions/${made.sessionId}/abandon`, as.supervisor,
      { reason: 'cashier left at 16:00 without cashing up' })
    expect(found.statusCode).toBe(200)
    expect(data(found).session.status).toBe('abandoned')
    expect(data(found).session.abandoned_by_name).toBe('Demo Cash Supervisor')
    const again = await call('POST', `/finance/cash/sessions/${made.sessionId}/abandon`, as.supervisor,
      { reason: 'a second time, by mistake' })
    expect(again.statusCode).toBe(409)

    const receipt = await call('POST', '/finance/cash/receipts', as.cashier,
      { session_id: made.sessionId, payer_name: 'T. Moyo', currency: 'USD', method: 'cash', lines: marketLine('5.00') })
    expect(receipt.statusCode).toBe(409)
    const ownCount = await call('POST', `/finance/cash/sessions/${made.sessionId}/close`, as.cashier,
      { counts: [{ currency: 'USD', declared_total: '80.00' }] })
    expect(ownCount.statusCode).toBe(409)
    expect(ownCount.json().message).toMatch(/counted under supervision/)

    const mine = data(await call('GET', '/finance/cash/desk', as.cashier)).my_session
    expect(mine.status).toBe('abandoned')
    expect(mine.abandon_reason).toBe('cashier left at 16:00 without cashing up')
    expect(mine.totals_withheld).toBe(true)

    const audit = await auditRow('cashier_session_abandoned')
    expect(audit).toMatchObject({ event: 'FIN_CASH_SESSION', severity: 'critical', actor_id: id.supervisor, status: 200 })
  })

  test('the supervised count is witnessed and explained, frees the drawer, and is verified by somebody else', async () => {
    const url = `/finance/cash/sessions/${made.sessionId}/supervised-close`
    const short = [{ currency: 'USD', declared_total: '78.00' }]
    const byCashierWitness = await call('POST', url, as.supervisor, { witness_id: id.cashier, counts: short })
    expect(byCashierWitness.statusCode).toBe(400)
    expect(byCashierWitness.json().error).toBe('witness_invalid')
    const witnesses = data(await call('GET', '/finance/cash/witnesses', as.supervisor)).witnesses
    expect(witnesses.some((w) => w.id === id.auditor)).toBe(true)
    expect(witnesses.some((w) => w.id === id.supervisor)).toBe(false)

    const unexplained = await call('POST', url, as.supervisor, { witness_id: id.auditor, counts: short })
    expect(unexplained.statusCode).toBe(409)
    expect(unexplained.json().error).toBe('count_incomplete')

    const counted = await call('POST', url, as.supervisor,
      { witness_id: id.auditor, counts: [{ currency: 'USD', declared_total: '78.00', explanation: 'two dollars short in the coin tray' }] })
    expect(counted.statusCode).toBe(200)
    const session = data(counted).session
    expect(session.status).toBe('closed')
    expect(session.closed_by_name).toBe('Demo Cash Supervisor')
    expect(session.witness_id).toBe(id.auditor)
    expect(session.counts[0]).toMatchObject({ expected_takings: '30.00', declared_total: '78.00', variance: '-2.00' })

    const free = data(await call('GET', '/finance/cash/desk', as.cashier)).cash_points.find((p) => p.id === made.pointId)
    expect(free.open_session_id).toBeNull()

    const bySupervisor = await call('POST', `/finance/cash/sessions/${made.sessionId}/verify`, as.supervisor, {})
    expect(bySupervisor.statusCode).toBe(409)
    expect(bySupervisor.json().error).toBe('separation_of_duties')
    const verified = await call('POST', `/finance/cash/sessions/${made.sessionId}/verify`, as.accountant, { note: 'agreed with the witness' })
    expect(verified.statusCode).toBe(200)
    expect(data(verified).vouchers_posted).toBe(2)

    const audit = await auditRow('cashier_session_counted_under_supervision')
    expect(audit).toMatchObject({ severity: 'critical', actor_id: id.supervisor })
    expect(audit.details.witness_id).toBe(id.auditor)
    expect(audit.details.counts[0].variance).toBe('-2.00')
  })

  test('the session keeps its whole history, with the count as declared and who did each thing', async () => {
    const { events } = data(await call('GET', `/finance/cash/sessions/${made.sessionId}/events`, as.auditor))
    expect(events.map((e) => e.event)).toEqual([
      'opened', 'float_recorded', 'suspended', 'resumed', 'abandoned', 'counted_under_supervision', 'verified',
    ])
    const by = (event) => events.find((e) => e.event === event)
    expect(by('suspended').actor_id).toBe(id.cashier)
    expect(by('abandoned')).toMatchObject({ actor_id: id.supervisor, reason: 'cashier left at 16:00 without cashing up' })
    expect(by('counted_under_supervision')).toMatchObject({ actor_id: id.supervisor, witness_id: id.auditor, witness_name: 'Demo Auditor' })
    expect(by('counted_under_supervision').detail.counts[0]).toMatchObject({ declared_total: '78.00', variance: '-2.00' })
    expect(by('verified').actor_id).toBe(id.accountant)
    expect(events.every((e) => e.source === 'live')).toBe(true)
  })

  test('ending an assignment is recorded and never touches a session in progress', async () => {
    const reopened = await call('POST', '/finance/cash/sessions', as.cashier, { cash_point_id: made.pointId, financial_year_id: made.yearId })
    expect(reopened.statusCode).toBe(201)
    const sessionId = data(reopened).session.id
    expect((await call('POST', `/finance/cash/assignments/${made.assignmentId}/end`, as.cashier, { reason: 'moved counter' })).statusCode).toBe(403)
    const ended = await call('POST', `/finance/cash/assignments/${made.assignmentId}/end`, as.supervisor, { reason: 'moved to the market counter' })
    expect(ended.statusCode).toBe(200)
    expect(data(await call('GET', `/finance/cash/sessions/${sessionId}`, as.cashier)).session.status).toBe('open')
    const endedTwice = await call('POST', `/finance/cash/assignments/${made.assignmentId}/end`, as.supervisor, { reason: 'again, by mistake' })
    expect(endedTwice.statusCode).toBe(400)
    const history = data(await call('GET', '/finance/cash/assignments?include_ended=true', as.supervisor)).assignments
    expect(history.find((a) => a.id === made.assignmentId)).toMatchObject({ ended_by_name: 'Demo Cash Supervisor', end_reason: 'moved to the market counter' })
    const closed = await call('POST', `/finance/cash/sessions/${sessionId}/close`, as.cashier, { counts: [] })
    expect(closed.statusCode).toBe(200)
  })
})
