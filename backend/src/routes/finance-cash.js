/**
 * The cash office: cash points, income codes, cashier sessions, receipts, the cash-up and the
 * banking.
 *
 * Tables, views and functions — migration 207: finance.cash_point, finance.income_code,
 * finance.cashier_session, finance.cashier_session_count, finance.cash_receipt,
 * finance.cash_receipt_line, finance.bank_deposit, finance.document_sequence,
 * finance.v_cashier_session_receipt, finance.v_cashier_session_total, finance.v_till_position,
 * finance.open_cashier_session(), finance.record_cash_receipt(),
 * finance.record_counter_rates_receipt(), finance.cancel_cash_receipt(),
 * finance.close_cashier_session(), finance.return_cashier_session(),
 * finance.verify_cashier_session(), finance.prepare_bank_deposit().
 *
 * Design: docs/superpowers/specs/2026-11-11-finance-enterprise-reengineering-design.md §5.3
 * (frontend repository).
 *
 * THIS ROUTE IS NOT WHERE THE RULES LIVE
 * The same position as finance-ledger.js and finance-rates.js. A receipt can be taken only in the
 * caller's own open session because finance.cashier_session_for_receipt() refuses anything else;
 * its number is issued by finance.next_document_no(); it cannot be edited because a trigger refuses
 * it; a cashier cannot verify their own cash-up because a CHECK constraint and
 * finance.verify_cashier_session() refuse it; a difference cannot be absorbed because verification
 * posts it or fails. This file asks the questions and turns the refusals into HTTP an officer can
 * act on. scripts/verify-cash-office-invariants.js proves all of it with this file bypassed.
 *
 * WHAT THIS MODULE DOES NOT DO, ON PURPOSE
 *  1. No money arithmetic in JavaScript. Totals, expected takings and variances come from Postgres
 *     as decimal strings.
 *  2. No total across currencies. Every summary is grouped by currency (decision D4).
 *  3. No ledger writes. finance.post_voucher() is the only writer of finance.ledger_entry.
 *  4. No expected figure before the count. While a session is open its own cashier is not sent
 *     its totals: the count is declared first and compared after (control C7).
 */

const { requirePermission } = require('../middleware/financePermissions')
const { parseMoney, normaliseCode } = require('../lib/finance')
const { ledgerRefusal } = require('./finance-ledger')
const { ratesRefusal } = require('./finance-rates')

const uuid = { type: 'string', format: 'uuid' }
const isoDate = { type: 'string', format: 'date' }
const currency = { type: 'string', enum: ['USD', 'ZWG'] }
const money = { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'number' }] }
const METHODS = ['cash', 'cheque', 'mobile_money', 'card', 'bank_transfer']
/** The kinds of planning fee (migration 246), the clerk register's own (128). */
const PLANNING_FEE_KINDS = ['application', 'plan_scrutiny', 'public_notice', 'inspection', 'occupation',
  'appeal', 'search', 'copies', 'other']
/** public.payments.driver (064): the online providers a payment channel names. */
const PAYMENT_DRIVERS = ['manual', 'paynow', 'stripe', 'ecocash', 'onemoney']
const SESSION_STATUSES = ['open', 'suspended', 'abandoned', 'closed', 'verified']
/** The states that still hold a drawer (migration 208): it is freed by a count, never by a status. */
const HOLDING = "('open', 'suspended', 'abandoned')"
const paging = {
  limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  offset: { type: 'integer', minimum: 0, default: 0 },
}

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

// ── Pure helpers, exported for test/finance-cash.test.js ───────────────────────────────────────

/** A positive amount as a decimal string, or null. Never a float past this point. */
function positiveMoney(raw) {
  const parsed = parseMoney(raw)
  if (!parsed.ok || parsed.value.startsWith('-') || Number(parsed.value) === 0) return null
  return parsed.value
}

/** An amount that may be nil (a float, a count), as a decimal string, or null. */
function nonNegativeMoney(raw) {
  const parsed = parseMoney(raw)
  if (!parsed.ok || parsed.value.startsWith('-')) return null
  return parsed.value
}

/**
 * Receipt lines as the database function takes them.
 *
 * `unit_amount` is optional because a fixed-charge income code supplies its own; the database
 * decides which codes are fixed, so an absent amount is passed through as absent rather than
 * defaulted here. A quantity is a count of things and may have three places (2.5 days' hire).
 */
function normaliseLines(lines) {
  if (!Array.isArray(lines) || lines.length === 0) {
    return { ok: false, message: 'A receipt is for at least one thing.' }
  }
  const out = []
  for (const [i, line] of lines.entries()) {
    const entry = { income_code_id: line.income_code_id }
    if (line.unit_amount !== undefined && line.unit_amount !== null && line.unit_amount !== '') {
      const amount = positiveMoney(line.unit_amount)
      if (!amount) return { ok: false, message: `Line ${i + 1}: the amount could not be read, or is not greater than nil.` }
      entry.unit_amount = amount
    }
    if (line.quantity !== undefined && line.quantity !== null && line.quantity !== '') {
      const text = String(line.quantity).trim()
      if (!/^\d{1,9}(\.\d{1,3})?$/.test(text) || Number(text) === 0) {
        return { ok: false, message: `Line ${i + 1}: the quantity must be a number greater than nil, with at most three decimal places.` }
      }
      entry.quantity = text
    }
    if (line.narration) entry.narration = String(line.narration).trim().slice(0, 300)
    out.push(entry)
  }
  return { ok: true, lines: out }
}

/** Counts as the close function takes them: one per currency, no currency twice. */
function normaliseCounts(counts) {
  if (!Array.isArray(counts)) return { ok: false, message: 'Declare the count for each currency in the drawer.' }
  const seen = new Set()
  const out = []
  for (const count of counts) {
    if (seen.has(count.currency)) return { ok: false, message: `The ${count.currency} count is given twice.` }
    seen.add(count.currency)
    const total = nonNegativeMoney(count.declared_total)
    if (total === null) return { ok: false, message: `The ${count.currency} count could not be read.` }
    out.push({
      currency: count.currency, declared_total: total,
      ...(count.explanation ? { explanation: String(count.explanation).trim() } : {}),
    })
  }
  return { ok: true, counts: out }
}

const DUPLICATES = {
  uq_cash_point_code: 'A cash point with that code already exists.',
  uq_income_code_code: 'An income code with that code already exists.',
  uq_cashier_session_open_cashier: 'You already have a session open. Cash it up before opening another.',
  uq_cashier_session_open_point: 'That cash point already has a session open. One drawer has one cashier at a time.',
  uq_cash_point_assignment_live: 'That cashier is already assigned to this cash point.',
  uq_income_code_planning_fee_kind: 'Another income code in use is already that planning fee. Take that one out of use first: an online fee must know which account it credits.',
  uq_payment_channel_driver: 'A bank account is already set for that provider. Change that one instead.',
}

/**
 * Turn a refusal raised by migration 207 into an HTTP answer an officer can act on.
 *
 * The database messages are written to be read, so they are passed through; this adds the status
 * and a stable `error` key. A rates payment at the counter can be refused by the rates functions
 * underneath, and anything can be refused by the ledger, so both translators are consulted.
 */
function cashRefusal(err) {
  if (err && err.refusal) return err.refusal
  const message = `${err && err.message ? err.message : ''}`
  const constraint = err && err.constraint ? err.constraint : ''

  if (err && err.code === '23505' && DUPLICATES[constraint]) {
    return { status: 409, error: 'duplicate', message: DUPLICATES[constraint] }
  }
  if (constraint === 'cashier_session_verified_by_another' || /your own cash-up and must be verified by somebody else/.test(message)) {
    return {
      status: 409, error: 'separation_of_duties',
      message: 'This is your own cash-up. Whoever takes the money does not agree the count; verification must come from someone else.',
    }
  }
  if (constraint === 'cashier_session_abandoned_by_another' || /you cash it up, you do not find it abandoned|cannot be counted under your own supervision|counted or witnessed session/.test(message)) {
    return { status: 409, error: 'separation_of_duties', message }
  }
  if (/somebody other than the cashier and the supervisor|name the witness|may see the cash office/.test(message)) {
    return { status: 400, error: 'witness_invalid', message }
  }
  if (/needs finance\.cash\.(session\.supervise|assignment\.manage)/.test(message)) {
    return { status: 403, error: 'forbidden', message }
  }
  if (/can be found abandoned after/.test(message)) {
    return { status: 409, error: 'too_soon_to_abandon', message }
  }
  if (/drawer is now held by/.test(message)) {
    return { status: 409, error: 'drawer_reissued', message }
  }
  if (/not assigned to cash point/.test(message)) {
    return { status: 403, error: 'not_assigned', message }
  }
  if (/assign yourself|does not operate a till|assignment has already ended|ending an assignment needs a reason|at least ten characters/.test(message)) {
    return { status: 400, error: 'refused', message }
  }
  if (/returning a count for recounting is the verifier/.test(message)) {
    return { status: 409, error: 'separation_of_duties', message }
  }
  if (/belongs to another cashier|another cashier's session/.test(message)) {
    return { status: 403, error: 'not_your_session', message }
  }
  if (/already have a session open|already has a session open/.test(message)) {
    return { status: 409, error: 'session_already_open', message }
  }
  if (/takes no more receipts|is already (open|closed|verified|abandoned)|only a closed|can no longer be cancelled at the counter|is already cancelled|resume it before counting|counted under supervision|only a session found abandoned|only (an open|a suspended) session can be|cannot go from|has been counted; it cannot be abandoned/.test(message)) {
    return { status: 409, error: 'session_state', message }
  }
  if (/count has not been declared|explained in writing|have changed since the count was declared/.test(message)
      || constraint === 'session_count_difference_is_explained') {
    return { status: 409, error: 'count_incomplete', message: message || 'A difference between the count and the receipts is explained in writing.' }
  }
  if (/no cash-difference account/.test(message)) {
    return { status: 409, error: 'difference_account_missing', message }
  }
  if (/may not vary it|has no charge set in|no longer in use/.test(message)) {
    return { status: 409, error: 'charge_fixed', message }
  }
  if (/is not a cash account|is not a bank account|go into the till|names the bank or wallet account|credits a revenue account|gain or a loss/.test(message)) {
    return { status: 400, error: 'account_unsuitable', message }
  }
  if (constraint === 'cash_receipt_electronic_is_referenced' || /names the transaction reference/.test(message)) {
    return { status: 400, error: 'reference_required', message: 'A payment that is not cash or a cheque carries the transaction reference from the bank, card machine or wallet.' }
  }
  if (constraint === 'income_code_fixed_has_a_charge') {
    return { status: 400, error: 'charge_missing', message: 'A fixed charge needs an amount in at least one currency.' }
  }
  if (/holds (USD|ZWG) .* in the ledger that is not already on its way to the bank/.test(message)) {
    return { status: 409, error: 'nothing_to_bank', message }
  }
  if (/is not inside financial year/.test(message)) {
    return { status: 400, error: 'period_invalid', message }
  }
  // Migration 246: a planning fee receipt names a real application and carries planning fees only.
  if (/planning application is not in this council's records/.test(message)) {
    return { status: 404, error: 'application_not_found', message: 'That planning application is not in this council\'s records.' }
  }
  if (/a planning fee receipt carries planning fees only/.test(message)) {
    return { status: 400, error: 'not_a_planning_fee', message }
  }
  const fromRates = ratesRefusal(err)
  if (fromRates && fromRates.error !== 'unknown_reference' && fromRates.error !== 'refused') return fromRates
  const fromLedger = ledgerRefusal(err)
  if (fromLedger) return fromLedger
  if (err && err.code === '23503') {
    return { status: 400, error: 'unknown_reference', message: 'That refers to a cash point, income code, account, party or year this council does not hold.' }
  }
  if (err && (err.code === '23514' || err.code === '23502') && message) {
    return { status: 400, error: 'refused', message }
  }
  return null
}

// ── Shared selects ────────────────────────────────────────────────────────────────────────────

const SESSION_SELECT = `
  SELECT cs.id, cs.session_no, cs.status, cs.business_date::text AS business_date,
         cs.cash_point_id, cp.code AS cash_point_code, cp.name AS cash_point_name,
         (cp.difference_account_id IS NOT NULL) AS difference_account_set,
         cs.cashier_id, COALESCE(cu.full_name, cu.name) AS cashier_name,
         cs.financial_year_id, y.label AS financial_year_label,
         cs.opened_at, cs.closed_at, cs.verified_at,
         cs.verified_by, COALESCE(vu.full_name, vu.name) AS verified_by_name, cs.verify_note,
         cs.returned_at, COALESCE(ru.full_name, ru.name) AS returned_by_name, cs.return_reason,
         cs.suspended_at, cs.abandoned_at, cs.abandoned_by, COALESCE(au.full_name, au.name) AS abandoned_by_name,
         cs.abandon_reason, cs.closed_by, COALESCE(sb.full_name, sb.name) AS closed_by_name,
         cs.witness_id, COALESCE(wu.full_name, wu.name) AS witness_name,
         (cs.business_date < CURRENT_DATE AND cs.status IN ('open', 'suspended', 'abandoned')) AS is_stale,
         (SELECT count(*)::int FROM finance.v_cashier_session_receipt r
           WHERE r.cashier_session_id = cs.id AND NOT r.is_cancelled) AS receipt_count,
         (SELECT count(*)::int FROM finance.v_cashier_session_receipt r
           WHERE r.cashier_session_id = cs.id AND r.is_cancelled) AS cancelled_count
    FROM finance.cashier_session cs
    JOIN finance.cash_point cp ON cp.id = cs.cash_point_id
    JOIN finance.financial_year y ON y.id = cs.financial_year_id
    JOIN public.users cu ON cu.id = cs.cashier_id
    LEFT JOIN public.users vu ON vu.id = cs.verified_by
    LEFT JOIN public.users ru ON ru.id = cs.returned_by
    LEFT JOIN public.users au ON au.id = cs.abandoned_by
    LEFT JOIN public.users sb ON sb.id = cs.closed_by
    LEFT JOIN public.users wu ON wu.id = cs.witness_id`

const RECEIPT_SELECT = `
  SELECT r.receipt_id AS id, r.source, r.receipt_no, r.payer_name, r.party_id, r.currency,
         r.amount::text AS amount, r.method, r.method_reference, r.voucher_id, r.voucher_status,
         r.is_cancelled, r.cancel_reason, r.is_physical, r.received_on::text AS received_on,
         r.created_at, r.cashier_session_id, r.narration,
         -- What the payment was for, as one line for a list: the income codes, or rates.
         CASE WHEN r.source = 'rates' THEN 'Property rates'
              ELSE (SELECT string_agg(DISTINCT i.name, ', ')
                      FROM finance.cash_receipt_line l JOIN finance.income_code i ON i.id = l.income_code_id
                     WHERE l.cash_receipt_id = r.receipt_id) END AS service
    FROM finance.v_cashier_session_receipt r`

/** The caller's own receipts: those taken in a session they were the cashier of. */
const MINE = (param) => `r.cashier_session_id IN (SELECT id FROM finance.cashier_session WHERE cashier_id = ${param})`

const EVENT_SELECT = `
  SELECT e.id::text AS id, e.event, e.from_status, e.to_status, e.occurred_at, e.source, e.reason, e.detail,
         e.actor_id, COALESCE(a.full_name, a.name) AS actor_name,
         e.witness_id, COALESCE(w.full_name, w.name) AS witness_name
    FROM finance.cashier_session_event e
    LEFT JOIN public.users a ON a.id = e.actor_id
    LEFT JOIN public.users w ON w.id = e.witness_id
   WHERE e.cashier_session_id = $1
   ORDER BY e.occurred_at, e.id`

/** Staff of this council who hold a finance permission, by the same resolution the API uses. */
const HOLDERS_SELECT = `
  SELECT u.id, COALESCE(u.full_name, u.name) AS name, u.role
    FROM public.users u
   -- The application role reads users by column grant; active is the column it is given for this.
   WHERE COALESCE(u.active, true)
     AND EXISTS (SELECT 1 FROM finance.resolve_effective_permissions(u.id) p WHERE p.permission_code = $1)
   ORDER BY 2`

// ── The routes ────────────────────────────────────────────────────────────────────────────────

async function financeCashRoutes(fastify) {
  const pg = fastify.pg

  const canView = { preHandler: requirePermission(fastify, 'finance.cash.view') }
  const canSetUp = { preHandler: requirePermission(fastify, 'finance.cash.setup.manage') }
  const canOperate = { preHandler: requirePermission(fastify, 'finance.cash.session.operate') }
  const canReceipt = { preHandler: requirePermission(fastify, 'finance.cash.receipt.record') }
  const canCancel = { preHandler: requirePermission(fastify, 'finance.cash.receipt.cancel') }
  const canBank = { preHandler: requirePermission(fastify, 'finance.cash.deposit.prepare') }
  const canVerify = { preHandler: requirePermission(fastify, 'finance.cash.session.verify') }
  const canPostVoucher = { preHandler: requirePermission(fastify, 'finance.ledger.voucher.post') }
  const canSupervise = { preHandler: requirePermission(fastify, 'finance.cash.session.supervise') }
  const canAssign = { preHandler: requirePermission(fastify, 'finance.cash.assignment.manage') }

  const refuse = (reply, err, fallback) => {
    const mapped = cashRefusal(err)
    if (mapped) return fail(reply, mapped.status, mapped.error, mapped.message)
    fastify.log.error({ err }, fallback)
    return fail(reply, 500, 'cash_error', fallback)
  }

  /**
   * Who paid, in the council's register of persons (migration 256). Linked beside the receipt, which is a fixed record,
   * in the same transaction: a receipt naming a person who is not in this council's register is not issued.
   */
  async function linkPayer(client, receiptId, personId, userId) {
    const { rows } = await client.query("SELECT status FROM registry.person WHERE id = $1", [personId])
    if (!rows.length || rows[0].status === 'merged') {
      const e = new Error('The payer chosen is not in the register of persons. Search for them again.')
      e.refusal = { status: 400, error: 'payer_not_registered', message: e.message }
      throw e
    }
    await client.query('INSERT INTO registry.receipt_payer (receipt_id, person_id, created_by) VALUES ($1, $2, $3)', [receiptId, personId, userId])
  }

  const idParams = { type: 'object', required: ['id'], properties: { id: uuid } }

  /** One statement inside a transaction, with the deferred balance trigger fired before COMMIT. */
  async function transact(work) {
    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const result = await work(client)
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  /**
   * A session with its counts, its totals and its receipts.
   *
   * CONTROL C7 IS APPLIED HERE. While the session is open, its own cashier is sent the receipts —
   * they issued them — but not the totals: the drawer is counted first and compared after. Anyone
   * else reading an open session (the accountant, the auditor) sees the totals, and so does the
   * cashier from the moment the count is declared.
   */
  async function sessionDetail(db, id, viewerId) {
    const { rows } = await db.query(`${SESSION_SELECT} WHERE cs.id = $1`, [id])
    const session = rows[0]
    if (!session) return null
    // Control C7 stands (decision K1 is not yet taken): an uncounted drawer's totals are withheld
    // from its own cashier whether the session is open, suspended or abandoned.
    const withheld = ['open', 'suspended', 'abandoned'].includes(session.status) && session.cashier_id === viewerId
    const [{ rows: counts }, { rows: totals }, { rows: receipts }, { rows: history }] = await Promise.all([
      db.query(
        `SELECT currency, opening_float::text AS opening_float, expected_takings::text AS expected_takings,
                declared_total::text AS declared_total, variance::text AS variance, explanation,
                difference_voucher_id
           FROM finance.cashier_session_count WHERE cashier_session_id = $1 ORDER BY currency`, [id]),
      db.query(
        `SELECT currency, method, receipts, amount::text AS amount, is_physical
           FROM finance.v_cashier_session_total WHERE cashier_session_id = $1 ORDER BY currency, method`, [id]),
      db.query(`${RECEIPT_SELECT} WHERE r.cashier_session_id = $1 ORDER BY r.created_at DESC, r.receipt_no DESC`, [id]),
      db.query(EVENT_SELECT, [id]),
    ])
    // A count's figures in the history are the cashier's to see once they have declared; while
    // the drawer is uncounted the history carries no money for them either.
    const events = withheld ? history.map((e) => ({ ...e, detail: {} })) : history
    return {
      ...session,
      events,
      counts,
      totals: withheld ? [] : totals,
      totals_withheld: withheld,
      receipts,
    }
  }

  // ═══ The desk ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Everything the cash office screen needs to draw itself for this person, in one read.
   *
   * It carries the reference data a cashier needs and has no other way to get: a cashier holds no
   * ledger or budget permission, so the bank accounts a transfer can be receipted into and the
   * open financial years come from here, already narrowed to what a counter may use.
   */
  fastify.get('/finance/cash/desk', { ...canView }, async (request, reply) => {
    try {
      const [points, codes, banks, years, mine, awaiting, position, policy] = await Promise.all([
        pg.query(
          // Who holds each drawer, so a cashier is told why a point is unavailable and whom to ask.
          `SELECT cp.id, cp.code, cp.name, cp.location, cp.status,
                  (cp.difference_account_id IS NOT NULL) AS difference_account_set,
                  d.session_id AS open_session_id, d.session_no AS held_session_no,
                  d.session_status AS held_state, d.cashier_id AS held_by_id, d.cashier_name AS held_by_name,
                  d.opened_at AS held_since, d.is_stale AS held_stale,
                  finance.is_assigned_to_cash_point($1, cp.id) AS assigned_to_me
             FROM finance.cash_point cp
             JOIN finance.v_cash_drawer d ON d.cash_point_id = cp.id
            WHERE cp.deleted_at IS NULL ORDER BY cp.code`, [request.user.id]),
        pg.query(
          `SELECT i.id, i.code, i.name, i.pricing, i.unit_amount_usd::text AS unit_amount_usd,
                  i.unit_amount_zwg::text AS unit_amount_zwg, i.status, i.planning_fee_kind
             FROM finance.income_code i WHERE i.deleted_at IS NULL ORDER BY i.name`),
        pg.query(
          `SELECT id, code, name FROM finance.ledger_account
            WHERE deleted_at IS NULL AND account_type = 'bank' AND is_postable AND status = 'active'
            ORDER BY code`),
        pg.query(
          `SELECT y.id, y.label, y.start_date::text AS start_date, y.end_date::text AS end_date,
                  EXISTS (SELECT 1 FROM finance.ledger_period lp
                           WHERE lp.financial_year_id = y.id AND lp.status = 'open'
                             AND CURRENT_DATE BETWEEN lp.from_date AND lp.to_date) AS period_open_today
             FROM finance.financial_year y
            WHERE y.deleted_at IS NULL AND y.status = 'open'
              AND CURRENT_DATE BETWEEN y.start_date AND y.end_date
            ORDER BY y.start_date DESC`),
        // The caller's own session that still needs them: open, or closed and not yet verified.
        pg.query(
          `SELECT id FROM finance.cashier_session
            WHERE cashier_id = $1 AND status IN ('open', 'suspended', 'abandoned', 'closed')
            ORDER BY (status IN ${HOLDING}) DESC, opened_at DESC LIMIT 1`, [request.user.id]),
        pg.query(
          `SELECT count(*)::int AS n FROM finance.cashier_session
            WHERE status = 'closed' AND cashier_id <> $1
              AND closed_by IS DISTINCT FROM $1 AND witness_id IS DISTINCT FROM $1`, [request.user.id]),
        pg.query(
          `SELECT cash_point_id, code, name, currency, ledger_balance::text AS ledger_balance,
                  unverified_takings::text AS unverified_takings,
                  deposits_awaiting_posting::text AS deposits_awaiting_posting
             FROM finance.v_till_position
            WHERE ledger_balance <> 0 OR unverified_takings <> 0 OR deposits_awaiting_posting <> 0
            ORDER BY code, currency`),
        pg.query(
          `SELECT key, value FROM finance.setting
            WHERE key IN ('cash.abandon_after_hours', 'cash.require_assignment')`),
      ])
      const setting = (key, fallback) => {
        const row = policy.rows.find((r) => r.key === key)
        return { value: row ? row.value.value : fallback, provisional: row ? row.value.provisional !== false : true, decision: 'D29' }
      }
      const session = mine.rows[0] ? await sessionDetail(pg, mine.rows[0].id, request.user.id) : null
      const active = (rows) => rows.filter((r) => r.status === 'active')
      return ok(reply, {
        today: new Date().toISOString().slice(0, 10),
        cash_points: points.rows,
        income_codes: codes.rows,
        bank_accounts: banks.rows,
        financial_years: years.rows,
        my_session: session,
        awaiting_verification: awaiting.rows[0].n,
        till_position: position.rows,
        // Council policy not yet decided (D29); shown as provisional wherever the screen uses it.
        policy: {
          abandon_after_hours: setting('cash.abandon_after_hours', 12),
          require_assignment: setting('cash.require_assignment', false),
        },
        // What a counter needs before it can take a payment, said as facts the screen can explain.
        readiness: {
          cash_points: active(points.rows).length,
          income_codes: active(codes.rows).length,
          bank_accounts: banks.rows.length,
          year_open_today: years.rows.length > 0,
          period_open_today: years.rows.some((y) => y.period_open_today),
          decision: 'D22',
        },
      })
    } catch (err) {
      return refuse(reply, err, 'The cash office could not be read.')
    }
  })

  /** The ledger accounts a cash point or an income code may name. For whoever sets the office up. */
  fastify.get('/finance/cash/setup/accounts', { ...canSetUp }, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT id, code, name, root_type, account_type FROM finance.ledger_account
        WHERE deleted_at IS NULL AND is_postable AND status = 'active'
          AND (account_type IN ('cash', 'bank') OR root_type IN ('revenue', 'expense'))
        ORDER BY code`)
    const { rows: departments } = await pg.query(
      'SELECT id, code, name FROM finance.department WHERE deleted_at IS NULL ORDER BY code')
    return ok(reply, {
      till: rows.filter((a) => a.account_type === 'cash'),
      revenue: rows.filter((a) => a.root_type === 'revenue'),
      difference: rows.filter((a) => a.root_type === 'revenue' || a.root_type === 'expense'),
      departments,
    })
  })

  // ═══ Setup: cash points and income codes ════════════════════════════════════════════════════

  fastify.post('/finance/cash/points', {
    ...canSetUp,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['code', 'name', 'till_account_id'],
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 30 },
          name: { type: 'string', minLength: 2, maxLength: 120 },
          location: { type: 'string', maxLength: 200 },
          till_account_id: uuid,
          difference_account_id: { anyOf: [uuid, { type: 'null' }] },
          notes: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.cash_point (code, name, location, till_account_id, difference_account_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, code, name`,
        [normaliseCode(b.code), b.name.trim(), b.location || null, b.till_account_id,
          b.difference_account_id || null, b.notes || null, request.user.id])
      request.auditDetails = { action: 'cash_point_created', cash_point_id: rows[0].id, code: rows[0].code }
      return ok(reply, { cash_point: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The cash point could not be created.')
    }
  })

  fastify.patch('/finance/cash/points/:id', {
    ...canSetUp,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 120 },
          location: { type: 'string', maxLength: 200 },
          till_account_id: uuid,
          difference_account_id: { anyOf: [uuid, { type: 'null' }] },
          status: { type: 'string', enum: ['active', 'inactive'] },
          notes: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    try {
      // The till account is where unbanked takings sit. Moving it while a session is open or
      // takings are unbanked would strand them in an account no cash point names.
      if (b.till_account_id || b.status === 'inactive') {
        const { rows: busy } = await pg.query(
          `SELECT (SELECT count(*)::int FROM finance.cashier_session s
                    WHERE s.cash_point_id = $1 AND s.status <> 'verified') AS sessions,
                  (SELECT count(*)::int FROM finance.v_till_position p
                    WHERE p.cash_point_id = $1 AND (p.ledger_balance <> 0 OR p.deposits_awaiting_posting <> 0)) AS holding`,
          [request.params.id])
        if (busy[0].sessions > 0 || busy[0].holding > 0) {
          return fail(reply, 409, 'cash_point_in_use',
            'This cash point has a session that is not yet verified, or takings that are not yet banked. Verify and bank them before changing its till account or taking it out of use.')
        }
      }
      const has = (key) => Object.prototype.hasOwnProperty.call(b, key)
      const { rows } = await pg.query(
        `UPDATE finance.cash_point SET
            name = COALESCE($2, name), location = COALESCE($3, location),
            till_account_id = COALESCE($4, till_account_id),
            difference_account_id = CASE WHEN $5 THEN $6 ELSE difference_account_id END,
            status = COALESCE($7, status), notes = COALESCE($8, notes)
          WHERE id = $1 AND deleted_at IS NULL RETURNING id, code, name, status`,
        [request.params.id, b.name ? b.name.trim() : null, has('location') ? b.location : null,
          b.till_account_id || null, has('difference_account_id'), b.difference_account_id || null,
          b.status || null, has('notes') ? b.notes : null])
      if (!rows[0]) return fail(reply, 404, 'not_found', 'No such cash point.')
      request.auditDetails = { action: 'cash_point_changed', cash_point_id: rows[0].id, changed: Object.keys(b) }
      return ok(reply, { cash_point: rows[0] })
    } catch (err) {
      return refuse(reply, err, 'The cash point could not be changed.')
    }
  })

  const incomeCodeProps = {
    name: { type: 'string', minLength: 2, maxLength: 120 },
    ledger_account_id: uuid,
    department_id: { anyOf: [uuid, { type: 'null' }] },
    pricing: { type: 'string', enum: ['fixed', 'variable'] },
    unit_amount_usd: { anyOf: [money, { type: 'null' }] },
    unit_amount_zwg: { anyOf: [money, { type: 'null' }] },
    status: { type: 'string', enum: ['active', 'inactive'] },
    notes: { type: 'string', maxLength: 500 },
    // Migration 246: this income is a planning fee of this kind, so its receipt names the application.
    planning_fee_kind: { anyOf: [{ type: 'string', enum: PLANNING_FEE_KINDS }, { type: 'null' }] },
  }

  /** A charge as text for SQL, `null` for "not chargeable in this currency", or an error. */
  const charge = (raw) => {
    if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
    const value = positiveMoney(raw)
    return value ? { ok: true, value } : { ok: false }
  }

  fastify.post('/finance/cash/income-codes', {
    ...canSetUp,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['code', 'name', 'ledger_account_id'],
        properties: { code: { type: 'string', minLength: 1, maxLength: 30 }, ...incomeCodeProps },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const usd = charge(b.unit_amount_usd)
    const zwg = charge(b.unit_amount_zwg)
    if (!usd.ok || !zwg.ok) return fail(reply, 400, 'amount_unreadable', 'A charge is an amount greater than nil.')
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.income_code
           (code, name, ledger_account_id, department_id, pricing, unit_amount_usd, unit_amount_zwg, notes,
            planning_fee_kind, created_by)
         VALUES ($1,$2,$3,$4,$5,$6::numeric,$7::numeric,$8,$9,$10) RETURNING id, code, name, planning_fee_kind`,
        [normaliseCode(b.code), b.name.trim(), b.ledger_account_id, b.department_id || null,
          b.pricing || 'variable', usd.value, zwg.value, b.notes || null, b.planning_fee_kind || null, request.user.id])
      request.auditDetails = {
        action: 'income_code_created', income_code_id: rows[0].id, code: rows[0].code,
        pricing: b.pricing || 'variable', unit_amount_usd: usd.value, unit_amount_zwg: zwg.value,
        planning_fee_kind: rows[0].planning_fee_kind,
      }
      return ok(reply, { income_code: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The income code could not be created.')
    }
  })

  fastify.patch('/finance/cash/income-codes/:id', {
    ...canSetUp,
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: incomeCodeProps },
    },
  }, async (request, reply) => {
    const b = request.body
    const has = (key) => Object.prototype.hasOwnProperty.call(b, key)
    const usd = charge(b.unit_amount_usd)
    const zwg = charge(b.unit_amount_zwg)
    if (!usd.ok || !zwg.ok) return fail(reply, 400, 'amount_unreadable', 'A charge is an amount greater than nil.')
    try {
      const { rows: before } = await pg.query(
        `SELECT pricing, unit_amount_usd::text AS unit_amount_usd, unit_amount_zwg::text AS unit_amount_zwg,
                planning_fee_kind
           FROM finance.income_code WHERE id = $1 AND deleted_at IS NULL`, [request.params.id])
      if (!before[0]) return fail(reply, 404, 'not_found', 'No such income code.')
      const { rows } = await pg.query(
        `UPDATE finance.income_code SET
            name = COALESCE($2, name), ledger_account_id = COALESCE($3, ledger_account_id),
            department_id = CASE WHEN $4 THEN $5 ELSE department_id END,
            pricing = COALESCE($6, pricing),
            unit_amount_usd = CASE WHEN $7 THEN $8::numeric ELSE unit_amount_usd END,
            unit_amount_zwg = CASE WHEN $9 THEN $10::numeric ELSE unit_amount_zwg END,
            status = COALESCE($11, status), notes = COALESCE($12, notes),
            planning_fee_kind = CASE WHEN $13 THEN $14 ELSE planning_fee_kind END
          WHERE id = $1 RETURNING id, code, name, pricing, status, planning_fee_kind,
                unit_amount_usd::text AS unit_amount_usd, unit_amount_zwg::text AS unit_amount_zwg`,
        [request.params.id, b.name ? b.name.trim() : null, b.ledger_account_id || null,
          has('department_id'), b.department_id || null, b.pricing || null,
          has('unit_amount_usd'), usd.value, has('unit_amount_zwg'), zwg.value,
          b.status || null, has('notes') ? b.notes : null,
          has('planning_fee_kind'), b.planning_fee_kind || null])
      // A charge is what every payer is asked for, so the trail keeps what it was and what it became.
      request.auditDetails = {
        action: 'income_code_changed', income_code_id: rows[0].id, code: rows[0].code,
        before: before[0],
        after: {
          pricing: rows[0].pricing, unit_amount_usd: rows[0].unit_amount_usd, unit_amount_zwg: rows[0].unit_amount_zwg,
          planning_fee_kind: rows[0].planning_fee_kind,
        },
      }
      return ok(reply, { income_code: rows[0] })
    } catch (err) {
      return refuse(reply, err, 'The income code could not be changed.')
    }
  })

  // ═══ Setup: where each online provider pays in (migration 246, decision D22) ════════════════

  fastify.get('/finance/cash/payment-channels', { ...canSetUp }, async (request, reply) => {
    try {
      const { rows } = await pg.query(
        `SELECT c.id, c.driver, c.name, c.status, c.notes, c.bank_account_id, la.code AS bank_account_code,
                la.name AS bank_account_name
           FROM finance.payment_channel c JOIN finance.ledger_account la ON la.id = c.bank_account_id
          WHERE c.deleted_at IS NULL ORDER BY c.driver`)
      const { rows: banks } = await pg.query(
        `SELECT id, code, name FROM finance.ledger_account
          WHERE deleted_at IS NULL AND account_type = 'bank' AND is_postable AND status = 'active' ORDER BY code`)
      return ok(reply, { channels: rows, bank_accounts: banks, drivers: PAYMENT_DRIVERS })
    } catch (err) {
      return refuse(reply, err, 'The payment channels could not be read.')
    }
  })

  fastify.post('/finance/cash/payment-channels', {
    ...canSetUp,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['driver', 'name', 'bank_account_id'],
        properties: {
          driver: { type: 'string', enum: PAYMENT_DRIVERS },
          name: { type: 'string', minLength: 2, maxLength: 120 },
          bank_account_id: uuid,
          notes: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.payment_channel (driver, name, bank_account_id, notes, created_by)
         VALUES ($1,$2,$3,$4,$5) RETURNING id, driver, name, status`,
        [b.driver, b.name.trim(), b.bank_account_id, b.notes || null, request.user.id])
      request.auditDetails = { action: 'payment_channel_created', payment_channel_id: rows[0].id, driver: b.driver, bank_account_id: b.bank_account_id }
      return ok(reply, { channel: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The payment channel could not be created.')
    }
  })

  fastify.patch('/finance/cash/payment-channels/:id', {
    ...canSetUp,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 120 },
          bank_account_id: uuid,
          status: { type: 'string', enum: ['active', 'inactive'] },
          notes: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const has = (key) => Object.prototype.hasOwnProperty.call(b, key)
    try {
      const { rows } = await pg.query(
        `UPDATE finance.payment_channel SET
            name = COALESCE($2, name), bank_account_id = COALESCE($3, bank_account_id),
            status = COALESCE($4, status), notes = CASE WHEN $5 THEN $6 ELSE notes END
          WHERE id = $1 AND deleted_at IS NULL RETURNING id, driver, name, status, bank_account_id`,
        [request.params.id, b.name ? b.name.trim() : null, b.bank_account_id || null, b.status || null,
          has('notes'), b.notes || null])
      if (!rows[0]) return fail(reply, 404, 'not_found', 'No such payment channel.')
      request.auditDetails = { action: 'payment_channel_changed', payment_channel_id: rows[0].id, changed: Object.keys(b) }
      return ok(reply, { channel: rows[0] })
    } catch (err) {
      return refuse(reply, err, 'The payment channel could not be changed.')
    }
  })

  // ═══ Sessions ═══════════════════════════════════════════════════════════════════════════════

  fastify.get('/finance/cash/sessions', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', enum: SESSION_STATUSES },
          cash_point_id: uuid,
          mine: { type: 'boolean' },
          ...paging,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = []
    const params = []
    const add = (sql, value) => { params.push(value); where.push(sql.replace('?', `$${params.length}`)) }
    if (q.status) add('cs.status = ?', q.status)
    if (q.cash_point_id) add('cs.cash_point_id = ?', q.cash_point_id)
    if (q.mine) add('cs.cashier_id = ?', request.user.id)
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    try {
      const { rows: total } = await pg.query(`SELECT count(*)::int AS n FROM finance.cashier_session cs ${clause}`, params)
      const { rows } = await pg.query(
        `${SESSION_SELECT} ${clause}
          ORDER BY (cs.status = 'closed') DESC, cs.business_date DESC, cs.opened_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, q.limit, q.offset])
      // The counts ride with the list so the verifier's queue shows each difference without a
      // second read per row. An open session's are not sent: nothing has been declared.
      const ids = rows.filter((r) => r.status !== 'open').map((r) => r.id)
      const { rows: counts } = ids.length ? await pg.query(
        `SELECT cashier_session_id, currency, opening_float::text AS opening_float,
                expected_takings::text AS expected_takings, declared_total::text AS declared_total,
                variance::text AS variance, explanation
           FROM finance.cashier_session_count WHERE cashier_session_id = ANY($1) ORDER BY currency`, [ids]) : { rows: [] }
      return ok(reply, {
        sessions: rows.map((s) => ({ ...s, counts: counts.filter((c) => c.cashier_session_id === s.id) })),
        total: total[0].n, limit: q.limit, offset: q.offset,
      })
    } catch (err) {
      return refuse(reply, err, 'The sessions could not be read.')
    }
  })

  fastify.get('/finance/cash/sessions/:id', { ...canView, schema: { params: idParams } },
    async (request, reply) => {
      try {
        const session = await sessionDetail(pg, request.params.id, request.user.id)
        if (!session) return fail(reply, 404, 'not_found', 'No such session.')
        return ok(reply, { session })
      } catch (err) {
        return refuse(reply, err, 'The session could not be read.')
      }
    })

  /**
   * Open a till.
   *
   * The business date is today, by the server's clock, and is not an input: a cashier who could
   * date a session would be able to put today's takings into yesterday's banking. The financial
   * year is the open one containing today; it is asked for only where two open years both contain
   * the date, because choosing between them is not something to do on the cashier's behalf.
   */
  fastify.post('/finance/cash/sessions', {
    ...canOperate,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['cash_point_id'],
        properties: {
          cash_point_id: uuid,
          financial_year_id: uuid,
          floats: {
            type: 'array', maxItems: 2,
            items: {
              type: 'object', additionalProperties: false, required: ['currency', 'amount'],
              properties: { currency, amount: money },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const floats = []
    for (const f of b.floats || []) {
      const amount = nonNegativeMoney(f.amount)
      if (amount === null) return fail(reply, 400, 'amount_unreadable', `The ${f.currency} float could not be read.`)
      if (floats.some((x) => x.currency === f.currency)) return fail(reply, 400, 'float_twice', `The ${f.currency} float is given twice.`)
      floats.push({ currency: f.currency, amount })
    }
    try {
      let yearId = b.financial_year_id
      if (!yearId) {
        const { rows: years } = await pg.query(
          `SELECT id, label FROM finance.financial_year
            WHERE deleted_at IS NULL AND status = 'open' AND CURRENT_DATE BETWEEN start_date AND end_date
            ORDER BY start_date DESC`)
        if (years.length === 0) {
          return fail(reply, 409, 'no_open_year', 'No open financial year contains today, so a till cannot be opened. The Director of Finance opens the year.')
        }
        if (years.length > 1) {
          return fail(reply, 409, 'year_ambiguous',
            'More than one open financial year contains today. Choose the one these takings belong to.', { financial_years: years })
        }
        yearId = years[0].id
      }
      const id = await transact(async (client) => {
        const { rows } = await client.query(
          'SELECT finance.open_cashier_session($1,$2,$3,CURRENT_DATE,$4::jsonb) AS id',
          [b.cash_point_id, request.user.id, yearId, JSON.stringify(floats)])
        return rows[0].id
      })
      const session = await sessionDetail(pg, id, request.user.id)
      request.auditDetails = {
        action: 'cashier_session_opened', session_id: id, session_no: session.session_no,
        cash_point: session.cash_point_code, floats,
      }
      return ok(reply, { session }, 201)
    } catch (err) {
      return refuse(reply, err, 'The session could not be opened.')
    }
  })

  /** Cash up: the cashier declares the count. The variance comes back; it was not shown before. */
  fastify.post('/finance/cash/sessions/:id/close', {
    ...canOperate,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['counts'],
        properties: {
          counts: {
            type: 'array', maxItems: 2,
            items: {
              type: 'object', additionalProperties: false, required: ['currency', 'declared_total'],
              properties: { currency, declared_total: money, explanation: { type: 'string', maxLength: 1000 } },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const checked = normaliseCounts(request.body.counts)
    if (!checked.ok) return fail(reply, 400, 'count_unreadable', checked.message)
    try {
      await transact((client) => client.query(
        'SELECT finance.close_cashier_session($1,$2,$3::jsonb)',
        [request.params.id, request.user.id, JSON.stringify(checked.counts)]))
      const session = await sessionDetail(pg, request.params.id, request.user.id)
      request.auditDetails = {
        action: 'cashier_session_closed', session_id: session.id, session_no: session.session_no,
        counts: session.counts.map((c) => ({ currency: c.currency, expected: c.expected_takings, declared: c.declared_total, variance: c.variance })),
      }
      return ok(reply, {
        session,
        note: 'Count declared. The session takes no more receipts and waits for somebody else to verify it; nothing is in the book of account until they do.',
      })
    } catch (err) {
      return refuse(reply, err, 'The session could not be closed.')
    }
  })

  fastify.post('/finance/cash/sessions/:id/return', {
    ...canVerify,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['reason'],
        properties: { reason: { type: 'string', minLength: 5, maxLength: 1000 } },
      },
    },
  }, async (request, reply) => {
    try {
      await transact((client) => client.query(
        'SELECT finance.return_cashier_session($1,$2,$3)', [request.params.id, request.user.id, request.body.reason]))
      const session = await sessionDetail(pg, request.params.id, request.user.id)
      request.auditDetails = { action: 'cashier_session_returned', session_id: session.id, session_no: session.session_no, reason: request.body.reason.trim() }
      return ok(reply, { session, note: 'Returned to the cashier for a recount. It is open again and nothing was posted.' })
    } catch (err) {
      return refuse(reply, err, 'The session could not be returned.')
    }
  })

  fastify.post('/finance/cash/sessions/:id/verify', {
    ...canVerify,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false,
        properties: { note: { type: 'string', maxLength: 1000 } },
      },
    },
  }, async (request, reply) => {
    try {
      const posted = await transact(async (client) => {
        const { rows } = await client.query(
          'SELECT finance.verify_cashier_session($1,$2,$3) AS n',
          [request.params.id, request.user.id, (request.body && request.body.note) || null])
        return rows[0].n
      })
      const session = await sessionDetail(pg, request.params.id, request.user.id)
      request.auditDetails = {
        action: 'cashier_session_verified', session_id: session.id, session_no: session.session_no,
        cashier_id: session.cashier_id, vouchers_posted: posted,
        counts: session.counts.map((c) => ({ currency: c.currency, expected: c.expected_takings, declared: c.declared_total, variance: c.variance })),
      }
      return ok(reply, {
        session, vouchers_posted: posted,
        note: `Verified. ${posted} voucher${posted === 1 ? '' : 's'} posted to the book of account. The takings are now in the till account and can be banked.`,
      })
    } catch (err) {
      return refuse(reply, err, 'The session could not be verified.')
    }
  })

  // ═══ The session lifecycle (migration 208) ═══════════════════════════════════════════════════
  // Every rule is in the database function; these routes ask, and say why when refused.

  const reasonBody = (min) => ({
    type: 'object', additionalProperties: false, required: ['reason'],
    properties: { reason: { type: 'string', minLength: min, maxLength: 1000 } },
  })

  /** A small act on a session, then the session as it now stands, with an audit entry. */
  async function act(request, reply, sql, args, action, note, extra = {}) {
    try {
      await transact((client) => client.query(sql, args))
      const session = await sessionDetail(pg, request.params.id, request.user.id)
      request.auditDetails = { action, session_id: session.id, session_no: session.session_no, cashier_id: session.cashier_id, ...extra }
      return ok(reply, { session, note })
    } catch (err) {
      return refuse(reply, err, 'The session could not be changed.')
    }
  }

  fastify.post('/finance/cash/sessions/:id/suspend', { ...canOperate, schema: { params: idParams } },
    (request, reply) => act(request, reply, 'SELECT finance.suspend_cashier_session($1,$2)', [request.params.id, request.user.id],
      'cashier_session_suspended', 'Suspended. The drawer is still yours and takes no receipts until you resume.'))

  fastify.post('/finance/cash/sessions/:id/resume', { ...canOperate, schema: { params: idParams } },
    (request, reply) => act(request, reply, 'SELECT finance.resume_cashier_session($1,$2)', [request.params.id, request.user.id],
      'cashier_session_resumed', 'Resumed. The till takes receipts again.'))

  /** A supervisor's finding. It freezes the session; it does not close it or free the drawer. */
  fastify.post('/finance/cash/sessions/:id/abandon', { ...canSupervise, schema: { params: idParams, body: reasonBody(10) } },
    (request, reply) => act(request, reply, 'SELECT finance.mark_cashier_session_abandoned($1,$2,$3)',
      [request.params.id, request.user.id, request.body.reason],
      'cashier_session_abandoned',
      'Found abandoned. The session takes no receipts. The drawer stays held until it is counted under supervision with a witness.',
      { reason: request.body.reason.trim() }))

  /** Count an abandoned drawer with a witness. The variance comes back; verification is somebody else's. */
  fastify.post('/finance/cash/sessions/:id/supervised-close', {
    ...canSupervise,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['witness_id', 'counts'],
        properties: {
          witness_id: uuid,
          counts: {
            type: 'array', maxItems: 2,
            items: {
              type: 'object', additionalProperties: false, required: ['currency', 'declared_total'],
              properties: { currency, declared_total: money, explanation: { type: 'string', maxLength: 1000 } },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const checked = normaliseCounts(request.body.counts)
    if (!checked.ok) return fail(reply, 400, 'count_unreadable', checked.message)
    try {
      await transact((client) => client.query(
        'SELECT finance.supervised_close_cashier_session($1,$2,$3,$4::jsonb)',
        [request.params.id, request.user.id, request.body.witness_id, JSON.stringify(checked.counts)]))
      const session = await sessionDetail(pg, request.params.id, request.user.id)
      request.auditDetails = {
        action: 'cashier_session_counted_under_supervision', session_id: session.id, session_no: session.session_no,
        cashier_id: session.cashier_id, witness_id: session.witness_id,
        counts: session.counts.map((c) => ({ currency: c.currency, expected: c.expected_takings, declared: c.declared_total, variance: c.variance })),
      }
      return ok(reply, {
        session,
        note: 'Counted under supervision and witnessed. The drawer is free. The count waits for verification by somebody who neither counted nor witnessed it.',
      })
    } catch (err) {
      return refuse(reply, err, 'The drawer could not be counted.')
    }
  })

  fastify.get('/finance/cash/sessions/:id/events', { ...canView, schema: { params: idParams } }, async (request, reply) => {
    try {
      const session = await sessionDetail(pg, request.params.id, request.user.id)
      if (!session) return fail(reply, 404, 'not_found', 'No such session.')
      return ok(reply, { session_no: session.session_no, events: session.events })
    } catch (err) {
      return refuse(reply, err, 'The session history could not be read.')
    }
  })

  /** Every drawer, who holds it, and what can be done about it. The supervisor's board. */
  fastify.get('/finance/cash/drawers', { ...canSupervise }, async (request, reply) => {
    try {
      const [{ rows: drawers }, { rows: expected }, { rows: assignments }, { rows: awaiting }] = await Promise.all([
        pg.query(
          `SELECT d.cash_point_id, d.code, d.name, d.location, d.point_status, d.session_id, d.session_no,
                  d.session_status, d.cashier_id, d.cashier_name, d.opened_at, d.business_date::text AS business_date,
                  d.suspended_at, d.abandoned_at, d.abandoned_by_name, d.abandon_reason,
                  d.hours_held::text AS hours_held, d.may_be_abandoned, d.is_stale,
                  (SELECT count(*)::int FROM finance.v_cashier_session_receipt r
                    WHERE r.cashier_session_id = d.session_id AND NOT r.is_cancelled) AS receipt_count
             FROM finance.v_cash_drawer d ORDER BY d.code`),
        // What the drawer should hold: float plus physical receipts, per currency. The supervisor
        // is not the cashier, so C7 does not withhold it from them.
        pg.query(
          `SELECT s.id AS session_id, cur.currency,
                  (COALESCE((SELECT sc.opening_float FROM finance.cashier_session_count sc
                              WHERE sc.cashier_session_id = s.id AND sc.currency = cur.currency), 0)
                   + COALESCE((SELECT sum(r.amount) FROM finance.v_cashier_session_receipt r
                                WHERE r.cashier_session_id = s.id AND r.currency = cur.currency
                                  AND r.is_physical AND NOT r.is_cancelled), 0))::numeric(18,2)::text AS expected_cash
             FROM finance.cashier_session s
            CROSS JOIN (SELECT unnest(ARRAY['USD', 'ZWG']) AS currency) cur
            WHERE s.status IN ${HOLDING}`),
        pg.query(
          `SELECT a.id, a.cash_point_id, a.user_id, COALESCE(u.full_name, u.name) AS user_name,
                  a.valid_from::text AS valid_from, a.valid_to::text AS valid_to, a.note
             FROM finance.cash_point_assignment a JOIN public.users u ON u.id = a.user_id
            WHERE a.ended_at IS NULL ORDER BY u.full_name, u.name`),
        pg.query(`SELECT count(*)::int AS n FROM finance.cashier_session WHERE status = 'closed'`),
      ])
      return ok(reply, {
        drawers: drawers.map((d) => ({
          ...d,
          expected_cash: expected.filter((e) => e.session_id === d.session_id && Number(e.expected_cash) !== 0)
            .map(({ currency, expected_cash }) => ({ currency, amount: expected_cash })),
          assigned: assignments.filter((a) => a.cash_point_id === d.cash_point_id),
        })),
        awaiting_verification: awaiting[0].n,
      })
    } catch (err) {
      return refuse(reply, err, 'The drawers could not be read.')
    }
  })

  /** Who may witness a supervised count: staff who may see the cash office, not the caller. */
  fastify.get('/finance/cash/witnesses', { ...canSupervise }, async (request, reply) => {
    try {
      const { rows } = await pg.query(HOLDERS_SELECT, ['finance.cash.view'])
      return ok(reply, { witnesses: rows.filter((u) => u.id !== request.user.id) })
    } catch (err) {
      return refuse(reply, err, 'The witnesses could not be listed.')
    }
  })

  // ═══ Assignment (migration 208) ══════════════════════════════════════════════════════════════

  fastify.get('/finance/cash/assignments', {
    ...canAssign,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { cash_point_id: uuid, include_ended: { type: 'boolean', default: false } },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    try {
      const [{ rows }, { rows: operators }] = await Promise.all([
        pg.query(
          `SELECT a.id, a.cash_point_id, cp.code AS cash_point_code, cp.name AS cash_point_name,
                  a.user_id, COALESCE(u.full_name, u.name) AS user_name,
                  a.valid_from::text AS valid_from, a.valid_to::text AS valid_to, a.note,
                  COALESCE(b.full_name, b.name) AS assigned_by_name, a.assigned_at,
                  COALESCE(e.full_name, e.name) AS ended_by_name, a.ended_at, a.end_reason
             FROM finance.cash_point_assignment a
             JOIN finance.cash_point cp ON cp.id = a.cash_point_id
             JOIN public.users u ON u.id = a.user_id
             JOIN public.users b ON b.id = a.assigned_by
             LEFT JOIN public.users e ON e.id = a.ended_by
            WHERE ($1::uuid IS NULL OR a.cash_point_id = $1) AND ($2 OR a.ended_at IS NULL)
            ORDER BY cp.code, a.ended_at NULLS FIRST, u.full_name, u.name`,
          [q.cash_point_id || null, q.include_ended]),
        pg.query(HOLDERS_SELECT, ['finance.cash.session.operate']),
      ])
      return ok(reply, { assignments: rows, operators })
    } catch (err) {
      return refuse(reply, err, 'The assignments could not be read.')
    }
  })

  fastify.post('/finance/cash/assignments', {
    ...canAssign,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['cash_point_id', 'user_id'],
        properties: {
          cash_point_id: uuid, user_id: uuid, valid_from: isoDate, valid_to: isoDate,
          note: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    try {
      const id = await transact(async (client) => (await client.query(
        'SELECT finance.assign_cashier($1,$2,$3,$4,$5,$6) AS id',
        [b.cash_point_id, b.user_id, request.user.id, b.valid_from || null, b.valid_to || null, b.note || null])).rows[0].id)
      request.auditDetails = { action: 'cashier_assigned', assignment_id: id, cash_point_id: b.cash_point_id, user_id: b.user_id }
      return ok(reply, { id }, 201)
    } catch (err) {
      return refuse(reply, err, 'The cashier could not be assigned.')
    }
  })

  /** End an assignment. Never touches a session in progress: the drawer is freed by its count. */
  fastify.post('/finance/cash/assignments/:id/end', { ...canAssign, schema: { params: idParams, body: reasonBody(5) } },
    async (request, reply) => {
      try {
        await transact((client) => client.query('SELECT finance.end_cashier_assignment($1,$2,$3)',
          [request.params.id, request.user.id, request.body.reason]))
        request.auditDetails = { action: 'cashier_assignment_ended', assignment_id: request.params.id, reason: request.body.reason.trim() }
        return ok(reply, { id: request.params.id, note: 'Assignment ended. Any session the cashier holds continues until it is counted.' })
      } catch (err) {
        return refuse(reply, err, 'The assignment could not be ended.')
      }
    })

  // ═══ Receipts ═══════════════════════════════════════════════════════════════════════════════

  fastify.get('/finance/cash/receipts', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          session_id: uuid,
          q: { type: 'string', maxLength: 80 },
          mine: { type: 'boolean' },
          date: isoDate,
          method: { type: 'string', enum: METHODS },
          ...paging,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = []
    const params = []
    if (q.session_id) { params.push(q.session_id); where.push(`r.cashier_session_id = $${params.length}`) }
    if (q.mine) { params.push(request.user.id); where.push(MINE(`$${params.length}`)) }
    if (q.date) { params.push(q.date); where.push(`r.received_on = $${params.length}::date`) }
    if (q.method) { params.push(q.method); where.push(`r.method = $${params.length}`) }
    if (q.q && q.q.trim()) {
      params.push(`%${q.q.trim().replace(/[%_\\]/g, '\\$&')}%`)
      where.push(`(r.receipt_no ILIKE $${params.length} OR r.payer_name ILIKE $${params.length} OR r.method_reference ILIKE $${params.length})`)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    try {
      const { rows: total } = await pg.query(`SELECT count(*)::int AS n FROM finance.v_cashier_session_receipt r ${clause}`, params)
      const { rows } = await pg.query(
        `${RECEIPT_SELECT} ${clause} ORDER BY r.created_at DESC, r.receipt_no DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, q.limit, q.offset])
      return ok(reply, { receipts: rows, total: total[0].n, limit: q.limit, offset: q.offset })
    } catch (err) {
      return refuse(reply, err, 'The receipts could not be read.')
    }
  })

  /** One receipt as it is printed: its lines, who took it, at which counter, in which session. */
  fastify.get('/finance/cash/receipts/:id', { ...canView, schema: { params: idParams } },
    async (request, reply) => {
      try {
        const { rows } = await pg.query(
          `${RECEIPT_SELECT} WHERE r.receipt_id = $1`, [request.params.id])
        const receipt = rows[0]
        if (!receipt) return fail(reply, 404, 'not_found', 'No such receipt.')
        const [{ rows: context }, { rows: lines }] = await Promise.all([
          pg.query(
            `SELECT cs.session_no, cp.name AS cash_point_name, COALESCE(u.full_name, u.name) AS cashier_name,
                    la.authority_name AS council_name
               FROM finance.cashier_session cs
               JOIN finance.cash_point cp ON cp.id = cs.cash_point_id
               JOIN public.users u ON u.id = cs.cashier_id
               JOIN public.local_authorities la ON la.id = cs.authority_id
              WHERE cs.id = $1`, [receipt.cashier_session_id]),
          receipt.source === 'sundry'
            ? pg.query(
              `SELECT l.line_no, i.code, COALESCE(l.narration, i.name) AS description,
                      l.quantity::text AS quantity, l.unit_amount::text AS unit_amount, l.amount::text AS amount
                 FROM finance.cash_receipt_line l JOIN finance.income_code i ON i.id = l.income_code_id
                WHERE l.cash_receipt_id = $1 ORDER BY l.line_no`, [receipt.id])
            // A rates receipt's lines are its allocations, which live on its voucher (205:437).
            : pg.query(
              `SELECT l.line_no - 1 AS line_no, 'RATES' AS code,
                      COALESCE(l.narration, 'Rates') AS description, '1' AS quantity,
                      l.credit::text AS unit_amount, l.credit::text AS amount
                 FROM finance.voucher_line l WHERE l.voucher_id = $1 AND l.credit > 0 ORDER BY l.line_no`, [receipt.voucher_id]),
        ])
        return ok(reply, { receipt: { ...receipt, ...context[0], lines } })
      } catch (err) {
        return refuse(reply, err, 'The receipt could not be read.')
      }
    })

  const receiptCommon = {
    session_id: uuid,
    currency,
    method: { type: 'string', enum: METHODS },
    method_reference: { type: 'string', maxLength: 120 },
    deposit_account_id: uuid,
    narration: { type: 'string', maxLength: 500 },
  }

  /** Receipt sundry income: one or more things from the Council's income list. */
  fastify.post('/finance/cash/receipts', {
    ...canReceipt,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['session_id', 'payer_name', 'currency', 'method', 'lines'],
        properties: {
          ...receiptCommon,
          payer_name: { type: 'string', minLength: 2, maxLength: 160 },
          party_id: uuid,
          payer_person_id: uuid,
          lines: {
            type: 'array', minItems: 1, maxItems: 40,
            items: {
              type: 'object', additionalProperties: false, required: ['income_code_id'],
              properties: {
                income_code_id: uuid,
                quantity: { anyOf: [{ type: 'string', maxLength: 16 }, { type: 'number' }] },
                unit_amount: money,
                narration: { type: 'string', maxLength: 300 },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const checked = normaliseLines(b.lines)
    if (!checked.ok) return fail(reply, 400, 'lines_invalid', checked.message)
    try {
      const id = await transact(async (client) => {
        const { rows } = await client.query(
          'SELECT finance.record_cash_receipt($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) AS id',
          [b.session_id, request.user.id, b.payer_name, b.currency, b.method, JSON.stringify(checked.lines),
            b.deposit_account_id || null, b.party_id || null, b.method_reference || null, b.narration || null])
        if (b.payer_person_id) await linkPayer(client, rows[0].id, b.payer_person_id, request.user.id)
        return rows[0].id
      })
      const { rows } = await pg.query(`${RECEIPT_SELECT} WHERE r.receipt_id = $1`, [id])
      request.auditDetails = {
        action: 'cash_receipt_issued', receipt_id: id, receipt_no: rows[0].receipt_no,
        amount: rows[0].amount, currency: rows[0].currency, method: rows[0].method, lines: checked.lines.length,
      }
      return ok(reply, { receipt: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The receipt could not be issued.')
    }
  })

  /**
   * A rates payment at the counter.
   *
   * Two permissions, because it is two acts: issuing a receipt in a cashier session, and settling
   * a ratepayer's bills. A cashier holds both by default; someone granted only the first cannot
   * reach the debtors' ledger through the counter.
   */
  fastify.post('/finance/cash/receipts/rates', {
    preHandler: [canReceipt.preHandler, requirePermission(fastify, 'finance.rates.receipt.record')],
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['session_id', 'rates_account_id', 'amount', 'currency', 'method'],
        properties: {
          ...receiptCommon,
          rates_account_id: uuid,
          amount: money,
          receivable_ledger_account_id: uuid,
          allocations: {
            type: 'array', maxItems: 200,
            items: {
              type: 'object', required: ['rates_bill_id', 'amount'], additionalProperties: false,
              properties: { rates_bill_id: uuid, amount: money },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const amount = positiveMoney(b.amount)
    if (!amount) return fail(reply, 400, 'amount_unreadable', 'A receipt is for an amount greater than nil, and this one could not be read.')
    const allocations = []
    for (const a of b.allocations || []) {
      const part = positiveMoney(a.amount)
      if (!part) return fail(reply, 400, 'allocation_invalid', 'An allocation is for an amount greater than nil.')
      allocations.push({ rates_bill_id: a.rates_bill_id, amount: part })
    }
    try {
      const id = await transact(async (client) => {
        const { rows } = await client.query(
          'SELECT finance.record_counter_rates_receipt($1,$2,$3,$4::numeric,$5,$6,$7::jsonb,$8,$9,$10,$11) AS id',
          [b.session_id, request.user.id, b.rates_account_id, amount, b.currency, b.method,
            JSON.stringify(allocations), b.deposit_account_id || null, b.method_reference || null,
            b.narration || null, b.receivable_ledger_account_id || null])
        return rows[0].id
      })
      const { rows } = await pg.query(`${RECEIPT_SELECT} WHERE r.receipt_id = $1`, [id])
      request.auditDetails = {
        action: 'rates_receipt_issued_at_counter', receipt_id: id, receipt_no: rows[0].receipt_no,
        rates_account_id: b.rates_account_id, amount: rows[0].amount, currency: rows[0].currency,
        method: rows[0].method, allocations: allocations.length,
      }
      return ok(reply, { receipt: rows[0] }, 201)
    } catch (err) {
      return refuse(reply, err, 'The receipt could not be issued.')
    }
  })

  /**
   * A planning fee at the counter (migration 246). The same receipt as a sundry one, with every
   * cash-office control, but each line must be a planning fee code and the application is named: the
   * fee is linked to it, and an application fee marks the application paid.
   */
  fastify.post('/finance/cash/receipts/planning', {
    ...canReceipt,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['session_id', 'permit_application_id', 'payer_name', 'currency', 'method', 'lines'],
        properties: {
          ...receiptCommon,
          permit_application_id: uuid,
          payer_name: { type: 'string', minLength: 2, maxLength: 160 },
          party_id: uuid,
          payer_person_id: uuid,
          lines: {
            type: 'array', minItems: 1, maxItems: 20,
            items: {
              type: 'object', additionalProperties: false, required: ['income_code_id'],
              properties: {
                income_code_id: uuid,
                quantity: { anyOf: [{ type: 'string', maxLength: 16 }, { type: 'number' }] },
                unit_amount: money,
                narration: { type: 'string', maxLength: 300 },
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const checked = normaliseLines(b.lines)
    if (!checked.ok) return fail(reply, 400, 'lines_invalid', checked.message)
    try {
      const id = await transact(async (client) => {
        const { rows } = await client.query(
          'SELECT finance.record_planning_fee_receipt($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11) AS id',
          [b.session_id, request.user.id, b.permit_application_id, b.payer_name, b.currency, b.method,
            JSON.stringify(checked.lines), b.deposit_account_id || null, b.party_id || null,
            b.method_reference || null, b.narration || null])
        if (b.payer_person_id) await linkPayer(client, rows[0].id, b.payer_person_id, request.user.id)
        return rows[0].id
      })
      const [{ rows }, { rows: app }] = await Promise.all([
        pg.query(`${RECEIPT_SELECT} WHERE r.receipt_id = $1`, [id]),
        pg.query(
          `SELECT id, tpd_reference, dev_register_no, stand_number, applicant_name, status,
                  (fee_paid_at IS NOT NULL) AS fee_paid
             FROM spatial_planning.permit_application WHERE id = $1`, [b.permit_application_id]),
      ])
      request.auditDetails = {
        action: 'planning_fee_receipt_issued', receipt_id: id, receipt_no: rows[0].receipt_no,
        permit_application_id: b.permit_application_id, amount: rows[0].amount, currency: rows[0].currency,
        method: rows[0].method, lines: checked.lines.length,
      }
      return ok(reply, { receipt: rows[0], application: app[0] || null }, 201)
    } catch (err) {
      return refuse(reply, err, 'The receipt could not be issued.')
    }
  })

  /**
   * The planning applications a cashier can receipt a fee against: found by reference, register
   * number, stand or applicant. Only what the counter needs to pick the right one, and whether its
   * application fee is already paid (a second one is the thing to stop at the counter).
   */
  fastify.get('/finance/cash/planning-applications', {
    ...canReceipt,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false, required: ['q'],
        properties: { q: { type: 'string', minLength: 2, maxLength: 80 } },
      },
    },
  }, async (request, reply) => {
    const like = `%${request.query.q.trim().replace(/[%_\\]/g, '\\$&')}%`
    try {
      const { rows } = await pg.query(
        `SELECT pa.id, pa.tpd_reference, pa.dev_register_no, pa.stand_number, pa.applicant_name,
                pa.development_type, pa.status, (pa.fee_paid_at IS NOT NULL) AS fee_paid,
                (SELECT count(*)::int FROM finance.v_planning_fee f
                  WHERE f.permit_application_id = pa.id AND f.state <> 'cancelled') AS fees_received
           FROM spatial_planning.permit_application pa
          WHERE pa.tpd_reference ILIKE $1 OR pa.dev_register_no ILIKE $1 OR pa.stand_number ILIKE $1
             OR pa.applicant_name ILIKE $1
          ORDER BY pa.received_at DESC NULLS LAST, pa.created_at DESC
          LIMIT 15`, [like])
      return ok(reply, { applications: rows })
    } catch (err) {
      return refuse(reply, err, 'The applications could not be searched.')
    }
  })

  /** Cancel a receipt taken in your own open session. It stays on the record, with the reason. */
  fastify.post('/finance/cash/receipts/:id/cancel', {
    ...canCancel,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['reason'],
        properties: { reason: { type: 'string', minLength: 5, maxLength: 1000 } },
      },
    },
  }, async (request, reply) => {
    try {
      const { rows: found } = await pg.query(
        `${RECEIPT_SELECT} WHERE r.receipt_id = $1`, [request.params.id])
      if (!found[0]) return fail(reply, 404, 'not_found', 'No such receipt.')
      if (found[0].source === 'rates') {
        return fail(reply, 409, 'cancel_on_rates',
          `Receipt ${found[0].receipt_no} settles rates bills, so it is cancelled from Rates, where the bills it settled are released with it.`)
      }
      await transact((client) => client.query(
        'SELECT finance.cancel_cash_receipt($1,$2,$3)', [request.params.id, request.user.id, request.body.reason]))
      request.auditDetails = {
        action: 'cash_receipt_cancelled', receipt_id: found[0].id, receipt_no: found[0].receipt_no,
        amount: found[0].amount, currency: found[0].currency, reason: request.body.reason.trim(),
      }
      return ok(reply, {
        cancelled: found[0].receipt_no,
        note: 'Cancelled. It posted nothing; the receipt and the reason are kept on the record, and its number is not reused.',
      })
    } catch (err) {
      return refuse(reply, err, 'The receipt could not be cancelled.')
    }
  })

  // ═══ The cashier's dashboard ════════════════════════════════════════════════════════════════

  /**
   * The cashier's day at a glance: their own receipts today against yesterday, the non-cash
   * payments still to be confirmed, the cancelled ones, and the last ten taken.
   *
   * CONTROL C7 STILL APPLIES. While the caller holds an uncounted drawer, today's money figures are
   * that drawer's expected takings, so they are not sent (`amounts_withheld`), exactly as
   * sessionDetail() withholds them. Counts of receipts carry no money and are always sent.
   */
  fastify.get('/finance/cash/dashboard', { ...canView }, async (request, reply) => {
    const me = request.user.id
    try {
      const [counts, money, holding, recent] = await Promise.all([
        pg.query(
          `SELECT (r.received_on = CURRENT_DATE) AS is_today,
                  count(*) FILTER (WHERE NOT r.is_cancelled)::int AS receipts,
                  count(*)::int AS transactions,
                  count(*) FILTER (WHERE r.is_cancelled)::int AS cancelled,
                  count(*) FILTER (WHERE NOT r.is_cancelled AND NOT r.is_physical AND r.voucher_status = 'draft')::int AS pending
             FROM finance.v_cashier_session_receipt r
            WHERE ${MINE('$1')} AND r.received_on IN (CURRENT_DATE, CURRENT_DATE - 1)
            GROUP BY 1`, [me]),
        pg.query(
          `SELECT r.currency,
                  COALESCE(sum(r.amount) FILTER (WHERE r.received_on = CURRENT_DATE), 0)::numeric(18,2)::text AS collected_today,
                  COALESCE(sum(r.amount) FILTER (WHERE r.received_on = CURRENT_DATE - 1), 0)::numeric(18,2)::text AS collected_yesterday,
                  COALESCE(sum(r.amount) FILTER (WHERE r.received_on = CURRENT_DATE AND r.is_physical), 0)::numeric(18,2)::text AS cash_today,
                  CASE WHEN COALESCE(sum(r.amount) FILTER (WHERE r.received_on = CURRENT_DATE - 1), 0) > 0
                       THEN round((COALESCE(sum(r.amount) FILTER (WHERE r.received_on = CURRENT_DATE), 0)
                                   - sum(r.amount) FILTER (WHERE r.received_on = CURRENT_DATE - 1))
                                  * 100 / sum(r.amount) FILTER (WHERE r.received_on = CURRENT_DATE - 1), 1)::text
                  END AS change_pct
             FROM finance.v_cashier_session_receipt r
            WHERE ${MINE('$1')} AND NOT r.is_cancelled AND r.received_on IN (CURRENT_DATE, CURRENT_DATE - 1)
            GROUP BY r.currency ORDER BY r.currency`, [me]),
        pg.query(
          `SELECT count(*)::int AS n, CURRENT_DATE::text AS today FROM finance.cashier_session
            WHERE cashier_id = $1 AND status IN ${HOLDING}`, [me]),
        pg.query(`${RECEIPT_SELECT} WHERE ${MINE('$1')} ORDER BY r.created_at DESC, r.receipt_no DESC LIMIT 10`, [me]),
      ])
      const day = (isToday) => counts.rows.find((row) => row.is_today === isToday)
        || { is_today: isToday, receipts: 0, transactions: 0, cancelled: 0, pending: 0 }
      const strip = ({ is_today: _ignored, ...rest }) => rest
      const withheld = holding.rows[0].n > 0
      return ok(reply, {
        // The database's date, the one every received_on above was compared with.
        today: holding.rows[0].today,
        counts: { today: strip(day(true)), yesterday: strip(day(false)) },
        amounts_withheld: withheld,
        amounts: withheld ? [] : money.rows,
        recent: recent.rows,
        note: withheld
          ? 'Your drawer has not been counted, so today\'s takings are shown after your cash-up (control C7).'
          : null,
      })
    } catch (err) {
      return refuse(reply, err, 'The dashboard could not be read.')
    }
  })

  // ═══ The service queue (migration 209) ══════════════════════════════════════════════════════

  const QUEUE_SELECT = `
    SELECT t.id, t.ticket_no, t.business_date::text AS business_date, t.customer_name, t.rates_account_id,
           ra.account_no, t.service, t.status, t.created_at, COALESCE(cu.full_name, cu.name) AS created_by_name,
           t.closed_at, t.receipt_no, t.removed_reason
      FROM finance.cash_queue_ticket t
      LEFT JOIN finance.rates_account ra ON ra.id = t.rates_account_id
      JOIN public.users cu ON cu.id = t.created_by`

  const queueRefusal = (reply, err, fallback) => {
    const message = `${err && err.message ? err.message : ''}`
    if (/no such queue ticket/.test(message)) return fail(reply, 404, 'not_found', 'No such queue ticket.')
    if (/is already (served|removed)/.test(message)) return fail(reply, 409, 'ticket_closed', `Ticket ${message.replace(/^queue ticket /, '')}.`)
    return refuse(reply, err, fallback)
  }

  /** Who is waiting today, first come first. */
  fastify.get('/finance/cash/queue', { ...canView }, async (request, reply) => {
    try {
      const { rows } = await pg.query(
        `${QUEUE_SELECT} WHERE t.business_date = CURRENT_DATE AND t.status = 'waiting' ORDER BY t.ticket_no`)
      return ok(reply, { tickets: rows, waiting: rows.length })
    } catch (err) {
      return refuse(reply, err, 'The queue could not be read.')
    }
  })

  fastify.post('/finance/cash/queue', {
    ...canReceipt,
    schema: {
      body: {
        type: 'object', additionalProperties: false, required: ['customer_name'],
        properties: {
          customer_name: { type: 'string', minLength: 2, maxLength: 160 },
          rates_account_id: uuid,
          service: { type: 'string', maxLength: 120 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    if (b.customer_name.trim().length < 2) return fail(reply, 400, 'name_required', 'Enter who is waiting.')
    try {
      const id = await transact(async (client) => (await client.query(
        'SELECT finance.add_cash_queue_ticket($1,$2,$3,$4) AS id',
        [request.user.id, b.customer_name, b.rates_account_id || null, b.service || null])).rows[0].id)
      const { rows } = await pg.query(`${QUEUE_SELECT} WHERE t.id = $1`, [id])
      request.auditDetails = { action: 'cash_queue_ticket_added', ticket_id: id, ticket_no: rows[0].ticket_no }
      return ok(reply, { ticket: rows[0] }, 201)
    } catch (err) {
      return queueRefusal(reply, err, 'The customer could not be added to the queue.')
    }
  })

  fastify.post('/finance/cash/queue/:id/serve', {
    ...canReceipt,
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, properties: { receipt_no: { type: 'string', maxLength: 40 } } },
    },
  }, async (request, reply) => {
    const receiptNo = (request.body && request.body.receipt_no) || null
    try {
      await transact((client) => client.query('SELECT finance.close_cash_queue_ticket($1,$2,$3,$4,$5)',
        [request.params.id, request.user.id, 'served', receiptNo, null]))
      request.auditDetails = { action: 'cash_queue_ticket_served', ticket_id: request.params.id, receipt_no: receiptNo }
      return ok(reply, { id: request.params.id })
    } catch (err) {
      return queueRefusal(reply, err, 'The ticket could not be marked served.')
    }
  })

  fastify.post('/finance/cash/queue/:id/remove', { ...canReceipt, schema: { params: idParams, body: reasonBody(3) } },
    async (request, reply) => {
      try {
        await transact((client) => client.query('SELECT finance.close_cash_queue_ticket($1,$2,$3,$4,$5)',
          [request.params.id, request.user.id, 'removed', null, request.body.reason]))
        request.auditDetails = { action: 'cash_queue_ticket_removed', ticket_id: request.params.id, reason: request.body.reason.trim() }
        return ok(reply, { id: request.params.id })
      } catch (err) {
        return queueRefusal(reply, err, 'The ticket could not be removed.')
      }
    })

  // ═══ Banking ════════════════════════════════════════════════════════════════════════════════

  const DEPOSIT_SELECT = `
    SELECT d.id, d.deposit_no, d.cash_point_id, cp.name AS cash_point_name, d.currency,
           d.amount::text AS amount, d.bank_account_id, la.code AS bank_account_code, la.name AS bank_account_name,
           d.deposited_on::text AS deposited_on, d.slip_reference, d.voucher_id, v.status AS voucher_status,
           d.prepared_by, COALESCE(pu.full_name, pu.name) AS prepared_by_name, d.created_at,
           COALESCE(ou.full_name, ou.name) AS posted_by_name, v.posted_at, d.narration
      FROM finance.bank_deposit d
      JOIN finance.cash_point cp ON cp.id = d.cash_point_id
      JOIN finance.ledger_account la ON la.id = d.bank_account_id
      JOIN finance.voucher v ON v.id = d.voucher_id
      JOIN public.users pu ON pu.id = d.prepared_by
      LEFT JOIN public.users ou ON ou.id = v.posted_by`

  fastify.get('/finance/cash/deposits', {
    ...canView,
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { status: { type: 'string', enum: ['draft', 'posted'] }, ...paging } } },
  }, async (request, reply) => {
    const q = request.query
    const params = []
    let clause = 'WHERE d.cancelled_at IS NULL'
    if (q.status) { params.push(q.status); clause += ` AND v.status = $${params.length}` }
    try {
      const { rows } = await pg.query(
        `${DEPOSIT_SELECT} ${clause} ORDER BY (v.status = 'draft') DESC, d.deposited_on DESC, d.created_at DESC
          LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, q.limit, q.offset])
      return ok(reply, { deposits: rows, limit: q.limit, offset: q.offset })
    } catch (err) {
      return refuse(reply, err, 'The bankings could not be read.')
    }
  })

  fastify.post('/finance/cash/deposits', {
    ...canBank,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['cash_point_id', 'currency', 'amount', 'bank_account_id', 'slip_reference'],
        properties: {
          cash_point_id: uuid, currency, amount: money, bank_account_id: uuid,
          financial_year_id: uuid,
          deposited_on: isoDate,
          slip_reference: { type: 'string', minLength: 3, maxLength: 80 },
          narration: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const amount = positiveMoney(b.amount)
    if (!amount) return fail(reply, 400, 'amount_unreadable', 'A banking is for an amount greater than nil, and this one could not be read.')
    try {
      const on = b.deposited_on || new Date().toISOString().slice(0, 10)
      let yearId = b.financial_year_id
      if (!yearId) {
        const { rows: years } = await pg.query(
          `SELECT id, label FROM finance.financial_year
            WHERE deleted_at IS NULL AND status = 'open' AND $1::date BETWEEN start_date AND end_date
            ORDER BY start_date DESC`, [on])
        if (years.length === 0) return fail(reply, 409, 'no_open_year', `No open financial year contains ${on}.`)
        if (years.length > 1) {
          return fail(reply, 409, 'year_ambiguous',
            `More than one open financial year contains ${on}. Choose the one this banking belongs to.`, { financial_years: years })
        }
        yearId = years[0].id
      }
      const id = await transact(async (client) => {
        const { rows } = await client.query(
          'SELECT finance.prepare_bank_deposit($1,$2,$3,$4::numeric,$5,$6,$7::date,$8,$9) AS id',
          [b.cash_point_id, request.user.id, b.currency, amount, b.bank_account_id, yearId, on,
            b.slip_reference, b.narration || null])
        return rows[0].id
      })
      const { rows } = await pg.query(`${DEPOSIT_SELECT} WHERE d.id = $1`, [id])
      request.auditDetails = {
        action: 'bank_deposit_prepared', deposit_id: id, deposit_no: rows[0].deposit_no,
        amount: rows[0].amount, currency: rows[0].currency, slip_reference: rows[0].slip_reference,
      }
      return ok(reply, {
        deposit: rows[0],
        note: 'Recorded as a draft. The till is treated as holding this money on its way to the bank; it reaches the bank account in the book when somebody other than you posts it.',
      }, 201)
    } catch (err) {
      return refuse(reply, err, 'The banking could not be recorded.')
    }
  })

  /** Post a banking's voucher. Not the person who prepared it. */
  fastify.post('/finance/cash/deposits/:id/post', { ...canPostVoucher, schema: { params: idParams } },
    async (request, reply) => {
      try {
        const { rows: current } = await pg.query(
          `SELECT d.id, d.deposit_no, d.voucher_id, d.prepared_by, v.status
             FROM finance.bank_deposit d JOIN finance.voucher v ON v.id = d.voucher_id
            WHERE d.id = $1 AND d.cancelled_at IS NULL`, [request.params.id])
        if (!current[0]) return fail(reply, 404, 'not_found', 'No such banking.')
        if (current[0].prepared_by === request.user.id) {
          return fail(reply, 409, 'separation_of_duties',
            `You prepared banking ${current[0].deposit_no}, so posting it is not yours to do. Posting must come from someone else.`)
        }
        const entries = await transact(async (client) => {
          const { rows } = await client.query('SELECT finance.post_voucher($1,$2) AS n', [current[0].voucher_id, request.user.id])
          return rows[0].n
        })
        request.auditDetails = { action: 'bank_deposit_posted', deposit_id: current[0].id, deposit_no: current[0].deposit_no }
        return ok(reply, { posted: current[0].deposit_no, entries, note: 'Posted. The takings are in the bank account in the book of account.' })
      } catch (err) {
        return refuse(reply, err, 'The banking could not be posted.')
      }
    })
}

module.exports = {
  financeCashRoutes,
  // Exported for test/finance-cash.test.js
  cashRefusal,
  normaliseLines,
  normaliseCounts,
  positiveMoney,
  nonNegativeMoney,
  METHODS,
}
