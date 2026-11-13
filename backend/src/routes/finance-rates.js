/**
 * Rates billing, debtors and arrears: the property categories, the valuation roll, the tariff
 * schedule, the rates accounts, billing runs and their refusals, bills, receipts and the arrears.
 *
 * Tables, views and functions — migration 205: finance.property_category, finance.valuation_roll,
 * finance.rates_tariff, finance.rates_account, finance.rates_billing_run, finance.rates_bill,
 * finance.rates_receipt, finance.rates_billing_refusal, finance.v_rates_arrears,
 * finance.v_valuation_roll_current, finance.rates_billable(), finance.raise_rates_billing().
 * Migration 206: finance.record_rates_receipt(), finance.commit_rates_billing_run(),
 * finance.cancel_rates_billing_run(), finance.rates_bill_unsettled().
 *
 * Design: docs/superpowers/specs/2026-11-10-general-ledger-architecture.md §5 (frontend repo).
 *
 * THIS ROUTE IS NOT WHERE THE RULES LIVE
 * The same position as src/routes/finance-ledger.js, for the same reason. What a property is
 * charged is a GENERATED column (205:402). Whether it can be billed is ONE function read by both
 * the preview and the run (205:530). A receipt cannot settle more than a bill has open because
 * finance.record_rates_receipt() refuses it; a run cannot be committed by whoever raised it because
 * finance.commit_rates_billing_run() and a CHECK constraint refuse it; a voucher cannot post an
 * amount its bill does not say because a trigger refuses it (206 §6). This file turns those
 * refusals into HTTP an officer can act on, and asks the questions. If it were deleted, nothing
 * about the integrity of the rates ledger would change.
 *
 * WHAT THIS MODULE DOES NOT DO, ON PURPOSE
 *
 * 1. NO MONEY ARITHMETIC IN JAVASCRIPT. Every charge, total, open balance and arrears figure is
 *    computed by Postgres over NUMERIC and reaches JSON as a decimal string. See the header of
 *    src/lib/finance.js. An amount arriving in a request body is parsed to a decimal string and
 *    handed to SQL; it is never added to anything here.
 *
 * 2. NO CURRENCY CONVERSION AND NO TOTAL ACROSS CURRENCIES. A run bills one currency; a receipt
 *    settles bills in its own currency only; every summary is grouped by currency (decision D4).
 *
 * 3. NO GUESSING. A property with no ratepayer, no rateable value or no approved rate is REFUSED,
 *    by name, with the Council decision it waits on (D19, D17, D18). It is never billed nil. The
 *    registers are seeded empty and this module does not fill them with plausible defaults.
 *
 * 4. NO LEDGER WRITES. finance.post_voucher() is the only writer of finance.ledger_entry.
 *
 * WHO MAY DO WHAT
 * The eight `finance.rates.*` permissions seeded by migration 205, through `requirePermission`.
 * Two are approvals: `finance.rates.tariff.approve` (the committee) and `finance.rates.bill.post`
 * (the Director). Posting a receipt is posting a voucher and takes `finance.ledger.voucher.post`.
 * The controls that bind are per record and in the database: whoever drafts a tariff does not
 * approve it, whoever raises a run does not commit it, whoever takes a payment does not post it.
 */

const { requirePermission, requireAnyPermission } = require('../middleware/financePermissions')
const { parseMoney, normaliseCode, dateText } = require('../lib/finance')
const { ledgerRefusal, AGEING_BUCKETS, AGEING_LABELS } = require('./finance-ledger')

const uuid = { type: 'string', format: 'uuid' }
const isoDate = { type: 'string', format: 'date' }
const currency = { type: 'string', enum: ['USD', 'ZWG'] }
const money = { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'number' }] }
const parcelId = { type: 'string', minLength: 1, maxLength: 24 }
const paging = {
  limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
  offset: { type: 'integer', minimum: 0, default: 0 },
}

const RECEIPT_METHODS = ['cash', 'bank_transfer', 'mobile_money', 'cheque', 'card', 'other']

/**
 * Why a property was not billed, in the order finance.rates_billable() decides it (205:606): the
 * most fundamental reason first, exactly one per property. `waiting_on` is the Council decision
 * that has to be answered before the reason goes away, or null where it is not a governance gap.
 */
const REFUSAL_REASONS = [
  { code: 'no_rates_account', waiting_on: 'D19', label: 'No ratepayer of record' },
  { code: 'ratepayer_inactive', waiting_on: 'D19', label: 'Ratepayer not active' },
  { code: 'no_rateable_value', waiting_on: 'D17', label: 'No rateable value in force' },
  { code: 'no_property_category', waiting_on: 'D17', label: 'Property category not active' },
  { code: 'currency_mismatch', waiting_on: 'D17', label: 'Valued in another currency' },
  { code: 'no_approved_tariff', waiting_on: 'D18', label: 'No approved rate in the dollar' },
  { code: 'already_billed', waiting_on: null, label: 'Already billed for this period' },
  { code: 'nil_charge', waiting_on: null, label: 'Charge computes to nil' },
]
const REASON_CODES = REFUSAL_REASONS.map((r) => r.code)

const DECISIONS = {
  D17: 'The valuation roll: its source, its effective date and each property\'s rateable value.',
  D18: 'The tariff schedule: the rate in the dollar per property category per year, as resolved.',
  D19: 'The ratepayer of record for each property.',
}

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

// ── Pure helpers, exported for test/finance-rates.test.js ──────────────────────────────────────

/**
 * Parse a rate in the dollar into a decimal string of up to eight places.
 *
 * A rate is NOT money and is not rounded to two places: a cent and a half in the dollar is 0.015,
 * and 0.02 would bill a third more than the Council resolved (205:193). So more than eight places
 * is REFUSED rather than cut to eight.
 *
 * A number is refused here rather than handed to `parseMoney`, which would round it with toFixed.
 * Over HTTP that case does not arise: the body schema types the field as a string, and Fastify's
 * validator turns a JSON number into its shortest decimal text before this runs — `0.0085`
 * arrives as "0.0085", and a float written in exponent form ("1e-7") is not a number this reads.
 */
function parseRate(raw) {
  if (typeof raw !== 'string') {
    return { ok: false, reason: 'A rate in the dollar is sent as a decimal string, for example "0.0085".' }
  }
  const parsed = parseMoney(raw, { maxScale: 8 })
  if (!parsed.ok) {
    return {
      ok: false,
      reason: parsed.reason === 'more_than_8_decimal_places'
        ? 'A rate in the dollar is recorded to at most eight decimal places.'
        : 'That is not a rate this system can read.',
    }
  }
  if (parsed.value.startsWith('-')) {
    return { ok: false, reason: 'A rate in the dollar cannot be negative.' }
  }
  return { ok: true, value: parsed.value }
}

/** An optional, non-negative money field. `undefined` and `null` both mean "not recorded". */
function parseOptionalMoney(raw, label) {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null }
  const parsed = parseMoney(raw)
  if (!parsed.ok) return { ok: false, reason: `${label} is not an amount this system can read.` }
  if (parsed.value.startsWith('-')) return { ok: false, reason: `${label} cannot be negative.` }
  return { ok: true, value: parsed.value }
}

/**
 * Lay refusal counts out in the fixed order of REFUSAL_REASONS, with every reason present.
 *
 * REGROUPING ONLY: the counts are integers that came out of SQL and none is added here. A reason
 * with no properties is listed with a count of 0 rather than left out, because "nothing is waiting
 * on D18" is a fact a treasurer needs to be able to see, not infer from an absence.
 */
function refusalSummary(rows) {
  const counts = new Map(rows.map((r) => [r.reason_code, r.properties]))
  return REFUSAL_REASONS.map((reason) => ({
    reason_code: reason.code,
    label: reason.label,
    waiting_on: reason.waiting_on,
    decision: reason.waiting_on ? DECISIONS[reason.waiting_on] : null,
    properties: counts.get(reason.code) ?? 0,
  }))
}

/**
 * Validate a receipt's allocations before any of them reaches the database.
 *
 * Shape only: each names a bill, once, with a positive amount as a decimal STRING. Whether the
 * amounts fit the bills, or add up to no more than the payment, is arithmetic on money and is
 * decided by finance.record_rates_receipt() over NUMERIC.
 */
function validateAllocations(allocations) {
  if (allocations === undefined || allocations === null) return { ok: true, allocations: [] }
  if (!Array.isArray(allocations)) {
    return { ok: false, message: 'Allocations are a list of bills and amounts.' }
  }
  const seen = new Set()
  const out = []
  for (let i = 0; i < allocations.length; i += 1) {
    const a = allocations[i]
    const at = `Allocation ${i + 1}`
    if (!a || !a.rates_bill_id) return { ok: false, message: `${at} names no bill.` }
    if (seen.has(a.rates_bill_id)) {
      return { ok: false, message: `${at} names a bill this receipt already allocates to.` }
    }
    seen.add(a.rates_bill_id)
    const parsed = parseMoney(a.amount)
    if (!parsed.ok) return { ok: false, message: `${at} has an amount this system cannot read.` }
    if (parsed.value.startsWith('-') || Number(parsed.value) === 0) {
      return { ok: false, message: `${at} must be for an amount greater than nil.` }
    }
    out.push({ rates_bill_id: a.rates_bill_id, amount: parsed.value })
  }
  return { ok: true, allocations: out }
}

/** A unique index named in a 23505, and the sentence it is about. */
const DUPLICATES = {
  uq_property_category_code: 'A property category with that code already exists.',
  uq_rates_tariff_approved:
    'An approved tariff already exists for that category, year and currency. Supersede it first; two approved rates would make a billing run choose between them.',
  uq_rates_account_no: 'That rates account number is already in use.',
  uq_rates_account_parcel_active:
    'That property already has an active rates account. Two would bill it twice; close the existing one first.',
  uq_rates_billing_run_reference: 'A billing run with that reference already exists.',
  uq_rates_bill_no: 'A bill with that number already exists; choose a different run reference.',
  uq_rates_bill_account_period: 'An account in this run already has a bill for that period.',
  uq_rates_receipt_no: 'That receipt number has already been used.',
  uq_voucher_no: 'That number is already in use by a voucher in the ledger.',
}

/**
 * Turn a refusal raised by migrations 205 and 206 into an HTTP answer an officer can act on.
 *
 * The database messages are written to be read — "bill RB-2027-07-00012 has 137.00 still open and
 * this receipt allocates 200.00 to it" — so they are passed through. What this adds is the status
 * code and a stable `error` key. Anything the ledger raises underneath (a closed period, the
 * preparer trying to post) is handed to `ledgerRefusal`, so the two modules give one answer.
 */
function ratesRefusal(err) {
  const message = `${err && err.message ? err.message : ''}`
  const constraint = err && err.constraint ? err.constraint : ''

  if (err && err.code === '23505' && DUPLICATES[constraint]) {
    return { status: 409, error: 'duplicate', message: DUPLICATES[constraint] }
  }
  if (constraint === 'rates_tariff_drafted_and_approved_differ') {
    return {
      status: 409, error: 'separation_of_duties',
      message: 'Whoever drafted this tariff cannot approve it. Approval records a Council resolution and must come from someone else.',
    }
  }
  if (/already has an active rateable value in force/.test(message)) {
    return { status: 409, error: 'valuation_overlap', message }
  }
  if (/is not a receivable control account|is not a bank or cash account|not revenue;|names a revenue account/.test(message)) {
    return { status: 400, error: 'account_unsuitable', message }
  }
  if (/is not inside financial year|before it begins/.test(message)) {
    return { status: 400, error: 'period_invalid', message }
  }
  if (/still open and this receipt allocates|allocations add up to/.test(message)) {
    return { status: 409, error: 'over_allocation', message }
  }
  if (/belongs to a different rates account|named twice on this receipt|greater than nil|not allocated to a bill/.test(message)) {
    return { status: 400, error: 'allocation_invalid', message }
  }
  if (/cannot be settled until|has been reversed and has nothing to settle/.test(message)) {
    return { status: 409, error: 'bill_not_settleable', message }
  }
  if (/no longer agrees with rates (bill|receipt)/.test(message)) {
    return { status: 409, error: 'voucher_disagrees_with_document', message }
  }
  if (/billing run .* (cannot be committed again|cannot be cancelled|raised no bills|cannot be committed as raised)/.test(message)) {
    return { status: 409, error: 'run_state', message }
  }
  if (/billing run .* must be posted by somebody else/.test(message)) {
    return {
      status: 409, error: 'separation_of_duties',
      message: 'Whoever raised this billing run cannot commit it. Committing must come from someone else.',
    }
  }
  const fromLedger = ledgerRefusal(err)
  if (fromLedger) return fromLedger
  if (err && err.code === '23503') {
    return {
      status: 400, error: 'unknown_reference',
      message: 'That refers to a property, party, category, account or year this council does not hold.',
    }
  }
  if (err && (err.code === '23514' || err.code === '23502') && message) {
    return { status: 400, error: 'refused', message }
  }
  return null
}

// ── The routes ────────────────────────────────────────────────────────────────────────────────

async function financeRatesRoutes(fastify) {
  const pg = fastify.pg

  const canView = { preHandler: requirePermission(fastify, 'finance.rates.view') }
  const canValue = { preHandler: requirePermission(fastify, 'finance.rates.valuation.manage') }
  const canDraftTariff = { preHandler: requirePermission(fastify, 'finance.rates.tariff.manage') }
  const canApproveTariff = { preHandler: requirePermission(fastify, 'finance.rates.tariff.approve') }
  const canKeepAccounts = { preHandler: requirePermission(fastify, 'finance.rates.account.manage') }
  const canPrepare = { preHandler: requirePermission(fastify, 'finance.rates.bill.prepare') }
  const canCommit = { preHandler: requirePermission(fastify, 'finance.rates.bill.post') }
  const canReceipt = { preHandler: requirePermission(fastify, 'finance.rates.receipt.record') }
  const canPostVoucher = { preHandler: requirePermission(fastify, 'finance.ledger.voucher.post') }
  // A category is the key the roll and the tariff share, so whoever maintains either keeps it.
  const canKeepCategories = {
    preHandler: requireAnyPermission(fastify,
      ['finance.rates.valuation.manage', 'finance.rates.tariff.manage']),
  }
  const canCancelRun = {
    preHandler: requireAnyPermission(fastify, ['finance.rates.bill.prepare', 'finance.rates.bill.post']),
  }

  const refuse = (reply, err, fallback) => {
    const mapped = ratesRefusal(err)
    if (mapped) return fail(reply, mapped.status, mapped.error, mapped.message)
    fastify.log.error({ err }, fallback)
    return fail(reply, 500, 'rates_error', fallback)
  }

  const idParams = { type: 'object', required: ['id'], properties: { id: uuid } }

  // ═══ Readiness: what billing is waiting on ══════════════════════════════════════════════════

  /**
   * The state of the three registers billing depends on, counted, with the Council decision each
   * gap waits on.
   *
   * This is the first thing the rates screen shows, because on the day this module is deployed the
   * honest answer to "can we bill?" is no: no property has a ratepayer of record (D19), a rateable
   * value (D17) or an approved rate (D18). A screen that opened on an empty bills table would let
   * that read as "nothing has been billed yet" instead of "nothing can be".
   */
  fastify.get('/finance/rates/readiness', {
    ...canView,
    schema: { querystring: { type: 'object', additionalProperties: false, properties: { financial_year_id: uuid } } },
  }, async (request, reply) => {
    const yearId = request.query.financial_year_id || null
    const [props, cats, tariffs, chart, periods] = await Promise.all([
      pg.query(
        `SELECT count(*)::int AS properties,
                count(*) FILTER (WHERE has_rates_account)::int AS with_ratepayer,
                count(*) FILTER (WHERE has_rateable_value)::int AS with_rateable_value,
                count(*) FILTER (WHERE has_rates_account AND has_rateable_value)::int AS with_both
           FROM finance.v_valuation_roll_current`),
      pg.query(
        `SELECT count(*) FILTER (WHERE status = 'active')::int AS active
           FROM finance.property_category WHERE deleted_at IS NULL`),
      pg.query(
        `SELECT t.currency, t.status, count(*)::int AS tariffs
           FROM finance.rates_tariff t
          WHERE t.deleted_at IS NULL AND ($1::uuid IS NULL OR t.financial_year_id = $1::uuid)
          GROUP BY t.currency, t.status ORDER BY t.currency, t.status`, [yearId]),
      pg.query(
        `SELECT count(*) FILTER (WHERE account_type = 'receivable')::int AS receivable,
                count(*) FILTER (WHERE account_type IN ('bank', 'cash'))::int AS bank,
                count(*) FILTER (WHERE root_type = 'revenue')::int AS revenue
           FROM finance.ledger_account
          WHERE deleted_at IS NULL AND is_postable AND status = 'active'`),
      pg.query(
        `SELECT count(*) FILTER (WHERE status = 'open')::int AS open, count(*)::int AS total
           FROM finance.ledger_period WHERE $1::uuid IS NOT NULL AND financial_year_id = $1::uuid`, [yearId]),
    ])
    const p = props.rows[0]
    const approved = tariffs.rows.filter((t) => t.status === 'approved')
    const blockers = [
      {
        decision: 'D19', statement: DECISIONS.D19,
        outstanding: p.properties - p.with_ratepayer,
        met: p.properties > 0 && p.with_ratepayer === p.properties,
        detail: `${p.with_ratepayer} of ${p.properties} properties have a rates account naming a ratepayer.`,
      },
      {
        decision: 'D17', statement: DECISIONS.D17,
        outstanding: p.properties - p.with_rateable_value,
        met: p.properties > 0 && p.with_rateable_value === p.properties,
        detail: `${p.with_rateable_value} of ${p.properties} properties have a rateable value in force today.`,
      },
      {
        decision: 'D18', statement: DECISIONS.D18,
        outstanding: null,
        met: approved.length > 0,
        detail: yearId
          ? (approved.length > 0
            ? `Approved tariffs for this year: ${approved.map((t) => `${t.tariffs} in ${t.currency}`).join(', ')}.`
            : 'No tariff has been approved for this financial year.')
          : (approved.length > 0
            ? `Approved tariffs across all years: ${approved.map((t) => `${t.tariffs} in ${t.currency}`).join(', ')}.`
            : 'No tariff has been approved for any year.'),
      },
    ]
    return ok(reply, {
      properties: p,
      categories: cats.rows[0],
      tariffs: tariffs.rows,
      ledger: {
        ...chart.rows[0],
        periods: yearId ? periods.rows[0] : null,
        ready: chart.rows[0].receivable > 0 && chart.rows[0].bank > 0 && chart.rows[0].revenue > 0,
        note: chart.rows[0].receivable === 0
          ? 'The general ledger has no receivable control account, so a bill would have nowhere to raise the debt.'
          : null,
      },
      blockers,
      can_bill_anything: p.with_both > 0 && approved.length > 0,
      note: p.with_both === 0
        ? 'No property can be billed yet. A billing run today raises no bills and one refusal per property, each naming the decision it waits on. That list is the work to be done, and nothing here fills it with assumed values.'
        : null,
    })
  })

  // ═══ Property categories ═══════════════════════════════════════════════════════════════════

  fastify.get('/finance/rates/categories', { ...canView }, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT c.id, c.code, c.name, c.description, c.status,
              (SELECT count(*)::int FROM finance.valuation_roll v
                WHERE v.property_category_id = c.id AND v.deleted_at IS NULL AND v.status = 'active') AS valuations,
              (SELECT count(*)::int FROM finance.rates_tariff t
                WHERE t.property_category_id = c.id AND t.deleted_at IS NULL AND t.status = 'approved') AS approved_tariffs
         FROM finance.property_category c
        WHERE c.deleted_at IS NULL ORDER BY c.code`)
    return ok(reply, {
      categories: rows,
      note: rows.length === 0
        ? 'No property categories are recorded. The categories a council rates by are part of decisions D17 and D18; none is assumed.'
        : null,
    })
  })

  fastify.post('/finance/rates/categories', {
    ...canKeepCategories,
    schema: {
      body: {
        type: 'object', required: ['code', 'name'], additionalProperties: false,
        properties: {
          code: { type: 'string', minLength: 1, maxLength: 40 },
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: 'string', maxLength: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.property_category (code, name, description, created_by)
         VALUES ($1,$2,$3,$4) RETURNING id, code, name, description, status`,
        [normaliseCode(b.code).toUpperCase(), b.name.trim(), b.description || null, request.user.id])
      return ok(reply, rows[0], 201)
    } catch (err) {
      return refuse(reply, err, 'The category could not be created.')
    }
  })

  fastify.patch('/finance/rates/categories/:id', {
    ...canKeepCategories,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          name: { type: 'string', minLength: 1, maxLength: 200 },
          description: { type: ['string', 'null'], maxLength: 1000 },
          status: { type: 'string', enum: ['active', 'inactive'] },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows } = await pg.query(
      `UPDATE finance.property_category
          SET name = COALESCE($2, name),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END,
              status = COALESCE($5, status), updated_at = now()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, code, name, description, status`,
      [request.params.id, b.name ? b.name.trim() : null, 'description' in b, b.description ?? null,
        b.status || null])
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such property category.')
    return ok(reply, rows[0])
  })

  // ═══ Properties and the valuation roll ═════════════════════════════════════════════════════

  /**
   * Every current property, with the rateable value in force today and its rates account, if it
   * has either. A property with neither is LISTED, with nulls: 731 properties and no values is the
   * finding, and a listing that showed only valued properties would show an empty table and hide it.
   */
  fastify.get('/finance/rates/properties', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          q: { type: 'string', maxLength: 200 },
          ward_code: { type: 'string', maxLength: 24 },
          has_rateable_value: { type: 'boolean' },
          has_rates_account: { type: 'boolean' },
          ...paging,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = `WHERE ($1::text IS NULL OR r.stand_no ILIKE $1 OR r.parcel_id ILIKE $1
                          OR r.account_no ILIKE $1 OR r.party_name ILIKE $1)
        AND ($2::text IS NULL OR r.ward_code = $2)
        AND ($3::boolean IS NULL OR r.has_rateable_value = $3)
        AND ($4::boolean IS NULL OR r.has_rates_account = $4)`
    const params = [q.q ? `%${q.q.trim()}%` : null, q.ward_code || null,
      q.has_rateable_value ?? null, q.has_rates_account ?? null]
    const [page, count] = await Promise.all([
      pg.query(
        `SELECT r.parcel_id, r.stand_no, r.ward_code, r.township_code, r.area_m2,
                r.valuation_roll_id, r.rateable_value::text AS rateable_value, r.currency,
                r.effective_from::text AS effective_from, r.effective_to::text AS effective_to,
                r.source, r.property_category_id, r.category_code, r.category_name,
                r.rates_account_id, r.account_no, r.party_id, r.party_name,
                r.has_rateable_value, r.has_rates_account
           FROM finance.v_valuation_roll_current r ${where}
          ORDER BY r.stand_no NULLS LAST, r.parcel_id
          LIMIT $5 OFFSET $6`, [...params, q.limit, q.offset]),
      pg.query(`SELECT count(*)::int AS total FROM finance.v_valuation_roll_current r ${where}`, params),
    ])
    return ok(reply, { properties: page.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset })
  })

  /** The roll's own rows — every valuation of a property, drafts and superseded ones included. */
  fastify.get('/finance/rates/valuations', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          parcel_id: parcelId,
          status: { type: 'string', enum: ['draft', 'active', 'superseded'] },
          ...paging,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = `WHERE v.deleted_at IS NULL
        AND ($1::text IS NULL OR v.parcel_id = $1) AND ($2::text IS NULL OR v.status = $2)`
    const params = [q.parcel_id || null, q.status || null]
    const [page, count] = await Promise.all([
      pg.query(
        `SELECT v.id, v.parcel_id, pa.stand_no, pa.ward_code, v.property_category_id,
                pc.code AS category_code, pc.name AS category_name,
                v.rateable_value::text AS rateable_value, v.currency,
                ${dateText('v', 'effective_from', 'effective_to', 'valuation_date')},
                v.source, v.source_reference, v.valuer_name, v.status, v.notes, v.recorded_at
           FROM finance.valuation_roll v
           JOIN land.parcel pa ON pa.parcel_id = v.parcel_id
           JOIN finance.property_category pc ON pc.id = v.property_category_id
           ${where}
          ORDER BY v.parcel_id, v.effective_from DESC, v.id
          LIMIT $3 OFFSET $4`, [...params, q.limit, q.offset]),
      pg.query(`SELECT count(*)::int AS total FROM finance.valuation_roll v ${where}`, params),
    ])
    return ok(reply, { valuations: page.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset })
  })

  fastify.post('/finance/rates/valuations', {
    ...canValue,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['parcel_id', 'property_category_id', 'rateable_value', 'currency', 'effective_from', 'source'],
        properties: {
          parcel_id: parcelId,
          property_category_id: uuid,
          rateable_value: money,
          currency,
          effective_from: isoDate,
          effective_to: isoDate,
          // D17's "source": the roll this value came from. Required, because a rateable value with
          // no stated source is a number somebody typed.
          source: { type: 'string', minLength: 2, maxLength: 300 },
          source_reference: { type: 'string', maxLength: 120 },
          valuation_date: isoDate,
          valuer_name: { type: 'string', maxLength: 200 },
          notes: { type: 'string', maxLength: 2000 },
          status: { type: 'string', enum: ['draft', 'active'], default: 'draft' },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const value = parseMoney(b.rateable_value)
    if (!value.ok || value.value.startsWith('-')) {
      return fail(reply, 400, 'value_unreadable', 'The rateable value is not an amount this system can read.')
    }
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.valuation_roll
           (parcel_id, property_category_id, rateable_value, currency, effective_from, effective_to,
            source, source_reference, valuation_date, valuer_name, notes, status, recorded_by, created_by)
         VALUES ($1,$2,$3::numeric,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$13)
         RETURNING id, parcel_id, rateable_value::text AS rateable_value, currency, status,
                   ${dateText(null, 'effective_from', 'effective_to')}`,
        [b.parcel_id, b.property_category_id, value.value, b.currency, b.effective_from,
          b.effective_to || null, b.source.trim(), b.source_reference || null,
          b.valuation_date || null, b.valuer_name || null, b.notes || null, b.status, request.user.id])
      return ok(reply, rows[0], 201)
    } catch (err) {
      return refuse(reply, err, 'The valuation could not be recorded.')
    }
  })

  /**
   * Amend a valuation.
   *
   * A DRAFT can be changed freely. An ACTIVE valuation's value, currency, category and start date
   * cannot: bills have been or will be computed from it, and a rateable value that silently changed
   * would make the roll disagree with every bill that snapshot it. A new value is a new row; the
   * old one is closed by setting `effective_to`, or superseded. That is all this route allows on an
   * active row.
   */
  fastify.patch('/finance/rates/valuations/:id', {
    ...canValue,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          property_category_id: uuid,
          rateable_value: money,
          currency,
          effective_from: isoDate,
          effective_to: { anyOf: [isoDate, { type: 'null' }] },
          source: { type: 'string', minLength: 2, maxLength: 300 },
          source_reference: { type: ['string', 'null'], maxLength: 120 },
          valuation_date: { anyOf: [isoDate, { type: 'null' }] },
          valuer_name: { type: ['string', 'null'], maxLength: 200 },
          notes: { type: ['string', 'null'], maxLength: 2000 },
          status: { type: 'string', enum: ['draft', 'active', 'superseded'] },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows: current } = await pg.query(
      'SELECT id, status FROM finance.valuation_roll WHERE id = $1 AND deleted_at IS NULL', [request.params.id])
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such valuation.')
    const frozen = ['property_category_id', 'rateable_value', 'currency', 'effective_from', 'source']
    if (current[0].status !== 'draft') {
      const touched = frozen.filter((k) => k in b)
      if (touched.length > 0) {
        return fail(reply, 409, 'valuation_in_force',
          `This valuation is ${current[0].status}; its ${touched.join(', ').replace(/_/g, ' ')} cannot be changed. `
          + 'Record the new value as a new valuation and close this one by setting the date it ran to.')
      }
      if (b.status === 'draft') {
        return fail(reply, 409, 'valuation_in_force', 'A valuation that has been in force does not return to draft.')
      }
      if (current[0].status === 'superseded' && b.status === 'active') {
        return fail(reply, 409, 'valuation_in_force', 'A superseded valuation is not reinstated. Record it again as a new valuation.')
      }
    }
    let value = null
    if ('rateable_value' in b) {
      const parsed = parseMoney(b.rateable_value)
      if (!parsed.ok || parsed.value.startsWith('-')) {
        return fail(reply, 400, 'value_unreadable', 'The rateable value is not an amount this system can read.')
      }
      value = parsed.value
    }
    const set = []
    const params = [request.params.id]
    const put = (column, v, cast = '') => { params.push(v); set.push(`${column} = $${params.length}${cast}`) }
    if ('property_category_id' in b) put('property_category_id', b.property_category_id)
    if (value !== null) put('rateable_value', value, '::numeric')
    if ('currency' in b) put('currency', b.currency)
    if ('effective_from' in b) put('effective_from', b.effective_from)
    if ('effective_to' in b) put('effective_to', b.effective_to)
    if ('source' in b) put('source', b.source.trim())
    if ('source_reference' in b) put('source_reference', b.source_reference)
    if ('valuation_date' in b) put('valuation_date', b.valuation_date)
    if ('valuer_name' in b) put('valuer_name', b.valuer_name)
    if ('notes' in b) put('notes', b.notes)
    if ('status' in b) put('status', b.status)
    try {
      const { rows } = await pg.query(
        `UPDATE finance.valuation_roll SET ${set.join(', ')}, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL
          RETURNING id, parcel_id, rateable_value::text AS rateable_value, currency, status,
                    ${dateText(null, 'effective_from', 'effective_to')}`, params)
      return ok(reply, rows[0])
    } catch (err) {
      return refuse(reply, err, 'The valuation could not be changed.')
    }
  })

  fastify.delete('/finance/rates/valuations/:id', { ...canValue, schema: { params: idParams } },
    async (request, reply) => {
      const { rows } = await pg.query(
        `UPDATE finance.valuation_roll SET deleted_at = now(), deleted_by = $2
          WHERE id = $1 AND deleted_at IS NULL AND status = 'draft' RETURNING id`,
        [request.params.id, request.user.id])
      if (rows[0]) return ok(reply, { discarded: rows[0].id })
      const { rows: exists } = await pg.query(
        'SELECT status FROM finance.valuation_roll WHERE id = $1 AND deleted_at IS NULL', [request.params.id])
      if (!exists[0]) return fail(reply, 404, 'not_found', 'No such valuation.')
      return fail(reply, 409, 'valuation_in_force',
        `This valuation is ${exists[0].status} and stays on the roll. Only a draft can be discarded.`)
    })

  // ═══ The tariff schedule ═══════════════════════════════════════════════════════════════════

  fastify.get('/finance/rates/tariffs', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          status: { type: 'string', enum: ['draft', 'approved', 'superseded'] },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT t.id, t.financial_year_id, y.label AS financial_year_label,
              t.property_category_id, pc.code AS category_code, pc.name AS category_name,
              t.currency, t.rate_in_dollar::text AS rate_in_dollar,
              t.fixed_charge::text AS fixed_charge, t.minimum_charge::text AS minimum_charge,
              t.revenue_ledger_account_id, la.code AS revenue_account_code, la.name AS revenue_account_name,
              t.status, t.resolution_reference, t.resolution_date::text AS resolution_date,
              t.approved_by, COALESCE(au.full_name, au.name) AS approved_by_name, t.approved_at,
              t.created_by, COALESCE(cu.full_name, cu.name) AS created_by_name, t.created_at, t.notes
         FROM finance.rates_tariff t
         JOIN finance.financial_year y ON y.id = t.financial_year_id
         JOIN finance.property_category pc ON pc.id = t.property_category_id
         LEFT JOIN finance.ledger_account la ON la.id = t.revenue_ledger_account_id
         LEFT JOIN public.users au ON au.id = t.approved_by
         LEFT JOIN public.users cu ON cu.id = t.created_by
        WHERE t.deleted_at IS NULL
          AND ($1::uuid IS NULL OR t.financial_year_id = $1::uuid)
          AND ($2::text IS NULL OR t.status = $2)
        ORDER BY y.start_date DESC, pc.code, t.currency, t.created_at`,
      [q.financial_year_id || null, q.status || null])
    return ok(reply, {
      tariffs: rows,
      note: rows.length === 0
        ? 'No tariff is recorded. The rate in the dollar is a Council resolution per category per year (decision D18); none is assumed and none is inferred from any other figure.'
        : null,
    })
  })

  const tariffBody = {
    rate_in_dollar: { type: 'string', maxLength: 32 },
    fixed_charge: { anyOf: [money, { type: 'null' }] },
    minimum_charge: { anyOf: [money, { type: 'null' }] },
    revenue_ledger_account_id: { anyOf: [uuid, { type: 'null' }] },
    resolution_reference: { type: ['string', 'null'], maxLength: 200 },
    resolution_date: { anyOf: [isoDate, { type: 'null' }] },
    notes: { type: ['string', 'null'], maxLength: 2000 },
  }

  fastify.post('/finance/rates/tariffs', {
    ...canDraftTariff,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['financial_year_id', 'property_category_id', 'currency', 'rate_in_dollar'],
        properties: { financial_year_id: uuid, property_category_id: uuid, currency, ...tariffBody },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const rate = parseRate(b.rate_in_dollar)
    if (!rate.ok) return fail(reply, 400, 'rate_unreadable', rate.reason)
    const fixed = parseOptionalMoney(b.fixed_charge, 'The fixed charge')
    if (!fixed.ok) return fail(reply, 400, 'charge_unreadable', fixed.reason)
    const minimum = parseOptionalMoney(b.minimum_charge, 'The minimum charge')
    if (!minimum.ok) return fail(reply, 400, 'charge_unreadable', minimum.reason)
    try {
      // Always a draft. A rate somebody typed is not a rate the Council resolved, and it bills
      // nothing until somebody else records the resolution.
      const { rows } = await pg.query(
        `INSERT INTO finance.rates_tariff
           (financial_year_id, property_category_id, currency, rate_in_dollar, fixed_charge,
            minimum_charge, revenue_ledger_account_id, resolution_reference, resolution_date,
            notes, status, created_by)
         VALUES ($1,$2,$3,$4::numeric,$5::numeric,$6::numeric,$7,$8,$9,$10,'draft',$11)
         RETURNING id, status, rate_in_dollar::text AS rate_in_dollar`,
        [b.financial_year_id, b.property_category_id, b.currency, rate.value, fixed.value,
          minimum.value, b.revenue_ledger_account_id || null, b.resolution_reference || null,
          b.resolution_date || null, b.notes || null, request.user.id])
      return ok(reply, {
        ...rows[0],
        note: 'Saved as a draft. A draft tariff bills nothing; it becomes the Council\'s rate when somebody other than you records the resolution that approved it.',
      }, 201)
    } catch (err) {
      return refuse(reply, err, 'The tariff could not be drafted.')
    }
  })

  fastify.patch('/finance/rates/tariffs/:id', {
    ...canDraftTariff,
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, minProperties: 1, properties: tariffBody },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows: current } = await pg.query(
      'SELECT status FROM finance.rates_tariff WHERE id = $1 AND deleted_at IS NULL', [request.params.id])
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such tariff.')
    if (current[0].status !== 'draft') {
      return fail(reply, 409, 'tariff_decided',
        `This tariff is ${current[0].status} and cannot be edited: bills are computed from it. A change of rate is a new tariff and a new resolution.`)
    }
    const set = []
    const params = [request.params.id]
    const put = (column, v, cast = '') => { params.push(v); set.push(`${column} = $${params.length}${cast}`) }
    if ('rate_in_dollar' in b) {
      const rate = parseRate(b.rate_in_dollar)
      if (!rate.ok) return fail(reply, 400, 'rate_unreadable', rate.reason)
      put('rate_in_dollar', rate.value, '::numeric')
    }
    for (const [key, label] of [['fixed_charge', 'The fixed charge'], ['minimum_charge', 'The minimum charge']]) {
      if (key in b) {
        const parsed = parseOptionalMoney(b[key], label)
        if (!parsed.ok) return fail(reply, 400, 'charge_unreadable', parsed.reason)
        put(key, parsed.value, '::numeric')
      }
    }
    for (const key of ['revenue_ledger_account_id', 'resolution_reference', 'resolution_date', 'notes']) {
      if (key in b) put(key, b[key])
    }
    try {
      const { rows } = await pg.query(
        `UPDATE finance.rates_tariff SET ${set.join(', ')}, updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL AND status = 'draft'
          RETURNING id, status, rate_in_dollar::text AS rate_in_dollar`, params)
      return ok(reply, rows[0])
    } catch (err) {
      return refuse(reply, err, 'The tariff could not be changed.')
    }
  })

  fastify.delete('/finance/rates/tariffs/:id', { ...canDraftTariff, schema: { params: idParams } },
    async (request, reply) => {
      const { rows } = await pg.query(
        `UPDATE finance.rates_tariff SET deleted_at = now(), deleted_by = $2
          WHERE id = $1 AND deleted_at IS NULL AND status = 'draft' RETURNING id`,
        [request.params.id, request.user.id])
      if (rows[0]) return ok(reply, { discarded: rows[0].id })
      return fail(reply, 409, 'tariff_decided', 'Only a draft tariff can be discarded. An approved one is superseded, and stays on the record.')
    })

  /**
   * Record that the Council resolved this rate.
   *
   * The resolution reference is REQUIRED: approving a tariff here is not deciding the rate, it is
   * recording that the Council did (decision D18), and a record of a resolution that cannot say
   * which one is not a record. Whoever drafted the tariff cannot approve it — refused here so the
   * message is legible, and held by `rates_tariff_drafted_and_approved_differ` (206 §5).
   */
  fastify.post('/finance/rates/tariffs/:id/approve', {
    ...canApproveTariff,
    schema: {
      params: idParams,
      body: {
        type: 'object', required: ['resolution_reference'], additionalProperties: false,
        properties: {
          resolution_reference: { type: 'string', minLength: 3, maxLength: 200 },
          resolution_date: isoDate,
        },
      },
    },
  }, async (request, reply) => {
    const { rows: current } = await pg.query(
      `SELECT t.id, t.status, t.created_by, t.rate_in_dollar::text AS rate_in_dollar, t.currency,
              pc.code AS category_code
         FROM finance.rates_tariff t JOIN finance.property_category pc ON pc.id = t.property_category_id
        WHERE t.id = $1 AND t.deleted_at IS NULL`, [request.params.id])
    if (!current[0]) return fail(reply, 404, 'not_found', 'No such tariff.')
    if (current[0].status !== 'draft') {
      return fail(reply, 409, 'tariff_decided', `This tariff is already ${current[0].status}.`)
    }
    if (current[0].created_by === request.user.id) {
      return fail(reply, 409, 'separation_of_duties',
        'You drafted this tariff, so approving it is not yours to do. Approval records a Council resolution and must come from someone else.')
    }
    try {
      const { rows } = await pg.query(
        `UPDATE finance.rates_tariff
            SET status = 'approved', approved_by = $2, approved_at = now(),
                resolution_reference = $3, resolution_date = COALESCE($4::date, resolution_date),
                updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL AND status = 'draft'
          RETURNING id, status, approved_at, resolution_reference`,
        [request.params.id, request.user.id, request.body.resolution_reference.trim(),
          request.body.resolution_date || null])
      request.auditDetails = {
        action: 'tariff_approved', tariff_id: rows[0].id, category: current[0].category_code,
        currency: current[0].currency, rate_in_dollar: current[0].rate_in_dollar,
        resolution_reference: rows[0].resolution_reference,
      }
      return ok(reply, {
        ...rows[0],
        note: 'Approved. Billing runs for this year, category and currency are now computed at this rate.',
      })
    } catch (err) {
      return refuse(reply, err, 'The tariff could not be approved.')
    }
  })

  /** Withdraw an approved tariff so another can take its place. It stays on the record. */
  fastify.post('/finance/rates/tariffs/:id/supersede', {
    ...canApproveTariff,
    schema: {
      params: idParams,
      body: {
        type: 'object', required: ['reason'], additionalProperties: false,
        properties: { reason: { type: 'string', minLength: 5, maxLength: 1000 } },
      },
    },
  }, async (request, reply) => {
    const { rows } = await pg.query(
      `UPDATE finance.rates_tariff
          SET status = 'superseded', updated_at = now(),
              notes = concat_ws(E'\\n', notes, 'Superseded: ' || $2::text)
        WHERE id = $1 AND deleted_at IS NULL AND status = 'approved'
        RETURNING id, status`, [request.params.id, request.body.reason.trim()])
    if (!rows[0]) return fail(reply, 409, 'tariff_decided', 'Only an approved tariff can be superseded.')
    request.auditDetails = { action: 'tariff_superseded', tariff_id: rows[0].id, reason: request.body.reason.trim() }
    return ok(reply, {
      ...rows[0],
      note: 'Superseded. Bills already raised at this rate are unchanged; they carry the rate they were computed at.',
    })
  })

  // ═══ Rates accounts ════════════════════════════════════════════════════════════════════════

  fastify.get('/finance/rates/accounts', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          q: { type: 'string', maxLength: 200 },
          status: { type: 'string', enum: ['active', 'closed'] },
          party_id: uuid,
          ...paging,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = `WHERE ra.deleted_at IS NULL
        AND ($1::text IS NULL OR ra.account_no ILIKE $1 OR pt.name ILIKE $1
             OR pa.stand_no ILIKE $1 OR ra.parcel_id ILIKE $1 OR ra.erp_account_no ILIKE $1)
        AND ($2::text IS NULL OR ra.status = $2)
        AND ($3::uuid IS NULL OR ra.party_id = $3::uuid)`
    const from = `FROM finance.rates_account ra
           JOIN finance.party pt ON pt.id = ra.party_id
           JOIN land.parcel pa ON pa.parcel_id = ra.parcel_id`
    const params = [q.q ? `%${q.q.trim()}%` : null, q.status || null, q.party_id || null]
    const [page, count] = await Promise.all([
      pg.query(
        `SELECT ra.id, ra.account_no, ra.parcel_id, pa.stand_no, pa.ward_code,
                ra.party_id, pt.name AS party_name, pt.reference AS party_reference, pt.status AS party_status,
                ra.erp_account_no, ${dateText('ra', 'opened_on', 'closed_on')}, ra.status, ra.notes
           ${from} ${where}
          ORDER BY ra.account_no, ra.id LIMIT $4 OFFSET $5`, [...params, q.limit, q.offset]),
      pg.query(`SELECT count(*)::int AS total ${from} ${where}`, params),
    ])
    return ok(reply, {
      accounts: page.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset,
      note: count.rows[0].total === 0 && !q.q && !q.status && !q.party_id
        ? 'No rates account exists. A rates account ties a property to its ratepayer of record (decision D19), and the owner register this would be loaded from holds no rows — so each is created here, from the Council\'s own records, and none is inferred.'
        : null,
    })
  })

  /**
   * One ratepayer's statement: the account, every bill with what is still open on it, every
   * receipt, and the balance per currency. Open amounts and balances come from the posted ledger
   * through finance.v_rates_arrears, so this statement and the arrears report cannot disagree.
   */
  fastify.get('/finance/rates/accounts/:id', { ...canView, schema: { params: idParams } },
    async (request, reply) => {
      const { rows: account } = await pg.query(
        `SELECT ra.id, ra.account_no, ra.parcel_id, pa.stand_no, pa.ward_code, pa.township_code,
                ra.party_id, pt.name AS party_name, pt.reference AS party_reference,
                pt.contact_phone, pt.contact_email, pt.address_text, pt.status AS party_status,
                ra.erp_account_no, ${dateText('ra', 'opened_on', 'closed_on')}, ra.status, ra.notes
           FROM finance.rates_account ra
           JOIN finance.party pt ON pt.id = ra.party_id
           JOIN land.parcel pa ON pa.parcel_id = ra.parcel_id
          WHERE ra.id = $1 AND ra.deleted_at IS NULL`, [request.params.id])
      if (!account[0]) return fail(reply, 404, 'not_found', 'No such rates account.')
      const [bills, receipts, balances] = await Promise.all([
        pg.query(
          `SELECT rb.id, rb.bill_no, ${dateText('rb', 'period_from', 'period_to', 'issued_on', 'due_on')},
                  rb.currency, rb.amount::text AS amount, v.status AS voucher_status,
                  rb.rateable_value::text AS rateable_value, rb.rate_in_dollar::text AS rate_in_dollar,
                  finance.rates_bill_unsettled(rb.id)::numeric(18,2)::text AS open_amount,
                  a.outstanding_amount::text AS outstanding_amount, a.ageing_bucket, a.days_outstanding
             FROM finance.rates_bill rb
             JOIN finance.voucher v ON v.id = rb.voucher_id
             LEFT JOIN finance.v_rates_arrears a ON a.rates_bill_id = rb.id
            WHERE rb.rates_account_id = $1 AND rb.deleted_at IS NULL
            ORDER BY rb.period_from DESC, rb.bill_no`, [request.params.id]),
        pg.query(
          `SELECT rc.id, rc.receipt_no, rc.received_on::text AS received_on, rc.currency,
                  rc.amount::text AS amount, rc.method, rc.reference, v.status AS voucher_status
             FROM finance.rates_receipt rc JOIN finance.voucher v ON v.id = rc.voucher_id
            WHERE rc.rates_account_id = $1 AND rc.deleted_at IS NULL
            ORDER BY rc.received_on DESC, rc.receipt_no`, [request.params.id]),
        pg.query(
          `SELECT a.currency, sum(a.outstanding_amount)::text AS balance,
                  COALESCE(sum(a.outstanding_amount) FILTER (WHERE a.outstanding_amount > 0), 0)::numeric(18,2)::text AS owed,
                  COALESCE(-sum(a.outstanding_amount) FILTER (WHERE a.outstanding_amount < 0), 0)::numeric(18,2)::text AS unallocated_credit
             FROM finance.v_rates_arrears a WHERE a.rates_account_id = $1
            GROUP BY a.currency ORDER BY a.currency`, [request.params.id]),
      ])
      return ok(reply, {
        account: account[0], bills: bills.rows, receipts: receipts.rows, balances: balances.rows,
        note: 'Balances are drawn from the posted ledger. A bill or receipt still in draft is listed and is not yet in a balance.',
      })
    })

  fastify.post('/finance/rates/accounts', {
    ...canKeepAccounts,
    schema: {
      body: {
        type: 'object', required: ['account_no', 'parcel_id', 'party_id'], additionalProperties: false,
        properties: {
          account_no: { type: 'string', minLength: 1, maxLength: 60 },
          parcel_id: parcelId,
          party_id: uuid,
          erp_account_no: { type: 'string', maxLength: 60 },
          opened_on: isoDate,
          notes: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.rates_account
           (account_no, parcel_id, party_id, erp_account_no, opened_on, notes, created_by)
         VALUES ($1,$2,$3,$4,COALESCE($5::date, CURRENT_DATE),$6,$7)
         RETURNING id, account_no, parcel_id, party_id, status, opened_on::text AS opened_on`,
        [normaliseCode(b.account_no), b.parcel_id, b.party_id, b.erp_account_no || null,
          b.opened_on || null, b.notes || null, request.user.id])
      return ok(reply, rows[0], 201)
    } catch (err) {
      return refuse(reply, err, 'The rates account could not be opened.')
    }
  })

  fastify.patch('/finance/rates/accounts/:id', {
    ...canKeepAccounts,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, minProperties: 1,
        properties: {
          erp_account_no: { type: ['string', 'null'], maxLength: 60 },
          notes: { type: ['string', 'null'], maxLength: 2000 },
          // Closing is one-way here: a closed account keeps its bills, receipts and arrears, and a
          // property that changes hands gets a new account for the new ratepayer.
          status: { type: 'string', enum: ['closed'] },
          closed_on: isoDate,
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    try {
      const { rows } = await pg.query(
        `UPDATE finance.rates_account
            SET erp_account_no = CASE WHEN $2::boolean THEN $3 ELSE erp_account_no END,
                notes = CASE WHEN $4::boolean THEN $5 ELSE notes END,
                status = COALESCE($6, status),
                closed_on = CASE WHEN $6 = 'closed' THEN COALESCE($7::date, CURRENT_DATE) ELSE closed_on END,
                updated_at = now()
          WHERE id = $1 AND deleted_at IS NULL AND (status = 'active' OR $6::text IS NULL)
          RETURNING id, account_no, status, ${dateText(null, 'opened_on', 'closed_on')}`,
        [request.params.id, 'erp_account_no' in b, b.erp_account_no ?? null, 'notes' in b,
          b.notes ?? null, b.status || null, b.closed_on || null])
      if (!rows[0]) return fail(reply, 404, 'not_found', 'No such open rates account.')
      return ok(reply, rows[0])
    } catch (err) {
      return refuse(reply, err, 'The rates account could not be changed.')
    }
  })

  // ═══ Billing: preview, raise, commit, cancel ═══════════════════════════════════════════════

  const billingPeriod = {
    financial_year_id: uuid, period_from: isoDate, period_to: isoDate, currency,
  }

  /**
   * What a billing run for this period would do, without doing it.
   *
   * Reads finance.rates_billable() — the SAME function finance.raise_rates_billing() reads — so
   * what this shows is what the run then does (205:516). The total is computed by SQL and is in
   * one currency, the run's.
   */
  fastify.get('/finance/rates/billing/preview', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        required: ['financial_year_id', 'period_from', 'period_to', 'currency'],
        properties: {
          ...billingPeriod,
          billable: { type: 'boolean' },
          reason_code: { type: 'string', enum: REASON_CODES },
          ...paging,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const args = [q.financial_year_id, q.period_from, q.period_to, q.currency]
    try {
      const [summary, reasons, page] = await Promise.all([
        pg.query(
          `SELECT count(*)::int AS properties_considered,
                  count(*) FILTER (WHERE billable)::int AS billable,
                  count(*) FILTER (WHERE NOT billable)::int AS refused,
                  COALESCE(sum(bill_amount) FILTER (WHERE billable), 0)::numeric(18,2)::text AS total_amount
             FROM finance.rates_billable($1,$2,$3,$4)`, args),
        pg.query(
          `SELECT reason_code, count(*)::int AS properties
             FROM finance.rates_billable($1,$2,$3,$4) WHERE NOT billable GROUP BY reason_code`, args),
        pg.query(
          `SELECT parcel_id, stand_no, ward_code, rates_account_id, account_no, party_name,
                  category_code, category_name, rateable_value::text AS rateable_value,
                  valuation_currency, rate_in_dollar::text AS rate_in_dollar,
                  fixed_charge::text AS fixed_charge, minimum_charge::text AS minimum_charge,
                  bill_amount::text AS bill_amount, billable, reason_code, waiting_on, message
             FROM finance.rates_billable($1,$2,$3,$4)
            WHERE ($5::boolean IS NULL OR billable = $5) AND ($6::text IS NULL OR reason_code = $6)
            ORDER BY billable DESC, stand_no NULLS LAST, parcel_id
            LIMIT $7 OFFSET $8`, [...args, q.billable ?? null, q.reason_code || null, q.limit, q.offset]),
      ])
      const s = summary.rows[0]
      return ok(reply, {
        currency: q.currency,
        period_from: q.period_from,
        period_to: q.period_to,
        ...s,
        refusals: refusalSummary(reasons.rows),
        rows: page.rows,
        limit: q.limit,
        offset: q.offset,
        note: s.billable === 0
          ? `No property can be billed in ${q.currency} for this period. A run would raise no bills and ${s.refused} refusals; the reasons above are the work list.`
          : `A run would raise ${s.billable} draft bills and ${s.refused} refusals. Nothing is posted until somebody other than the preparer commits the run.`,
      })
    } catch (err) {
      return refuse(reply, err, 'The billing preview could not be computed.')
    }
  })

  fastify.get('/finance/rates/billing/runs', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          status: { type: 'string', enum: ['raised', 'committed', 'cancelled'] },
          ...paging,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = `WHERE r.deleted_at IS NULL
        AND ($1::uuid IS NULL OR r.financial_year_id = $1::uuid) AND ($2::text IS NULL OR r.status = $2)`
    const params = [q.financial_year_id || null, q.status || null]
    const [page, count] = await Promise.all([
      pg.query(`${RUN_SELECT} ${where} ORDER BY r.prepared_at DESC, r.id LIMIT $3 OFFSET $4`,
        [...params, q.limit, q.offset]),
      pg.query(`SELECT count(*)::int AS total FROM finance.rates_billing_run r ${where}`, params),
    ])
    return ok(reply, { runs: page.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset })
  })

  fastify.get('/finance/rates/billing/runs/:id', { ...canView, schema: { params: idParams } },
    async (request, reply) => {
      const { rows } = await pg.query(`${RUN_SELECT} WHERE r.id = $1 AND r.deleted_at IS NULL`, [request.params.id])
      if (!rows[0]) return fail(reply, 404, 'not_found', 'No such billing run.')
      const { rows: reasons } = await pg.query(
        `SELECT reason_code, count(*)::int AS properties
           FROM finance.rates_billing_refusal WHERE billing_run_id = $1 GROUP BY reason_code`, [request.params.id])
      return ok(reply, { run: rows[0], refusals: refusalSummary(reasons) })
    })

  /** Why each property in a run was not billed: the work list (acceptance check G9). */
  fastify.get('/finance/rates/billing/runs/:id/refusals', {
    ...canView,
    schema: {
      params: idParams,
      querystring: {
        type: 'object', additionalProperties: false,
        properties: { reason_code: { type: 'string', enum: REASON_CODES }, ...paging },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = 'WHERE x.billing_run_id = $1 AND ($2::text IS NULL OR x.reason_code = $2)'
    const params = [request.params.id, q.reason_code || null]
    const [page, count] = await Promise.all([
      pg.query(
        `SELECT x.id, x.parcel_id, pa.stand_no, pa.ward_code, x.rates_account_id, ra.account_no,
                x.reason_code, x.waiting_on, x.message
           FROM finance.rates_billing_refusal x
           JOIN land.parcel pa ON pa.parcel_id = x.parcel_id
           LEFT JOIN finance.rates_account ra ON ra.id = x.rates_account_id
           ${where}
          ORDER BY x.reason_code, pa.stand_no NULLS LAST, x.parcel_id
          LIMIT $3 OFFSET $4`, [...params, q.limit, q.offset]),
      pg.query(`SELECT count(*)::int AS total FROM finance.rates_billing_refusal x ${where}`, params),
    ])
    return ok(reply, { refusals: page.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset })
  })

  /**
   * Raise a billing run: one DRAFT bill per billable property and one refusal per property that
   * cannot be billed, from a single pass (205:806). Posts nothing.
   */
  fastify.post('/finance/rates/billing/runs', {
    ...canPrepare,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['run_reference', 'financial_year_id', 'period_from', 'period_to', 'posting_date',
          'currency', 'receivable_ledger_account_id', 'revenue_ledger_account_id'],
        properties: {
          run_reference: { type: 'string', minLength: 3, maxLength: 40 },
          ...billingPeriod,
          posting_date: isoDate,
          receivable_ledger_account_id: uuid,
          revenue_ledger_account_id: uuid,
          due_on: isoDate,
          narration: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `SELECT finance.raise_rates_billing($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) AS id`,
        [b.financial_year_id, b.period_from, b.period_to, b.posting_date, b.currency,
          b.receivable_ledger_account_id, b.revenue_ledger_account_id, request.user.id,
          normaliseCode(b.run_reference).toUpperCase(), b.due_on || null, b.narration || null])
      const { rows: run } = await client.query(`${RUN_SELECT} WHERE r.id = $1`, [rows[0].id])
      await client.query('COMMIT')
      request.auditDetails = {
        action: 'billing_run_raised', run_id: run[0].id, run_reference: run[0].run_reference,
        currency: run[0].currency, period_from: run[0].period_from, period_to: run[0].period_to,
        properties_considered: run[0].properties_considered, bills_raised: run[0].bills_raised,
        properties_refused: run[0].properties_refused, total_billed: run[0].total_billed,
      }
      return ok(reply, {
        run: run[0],
        note: run[0].bills_raised === 0
          ? `The run raised no bills. All ${run[0].properties_refused} properties were refused, and each refusal names the decision it waits on.`
          : `Raised ${run[0].bills_raised} draft bills and ${run[0].properties_refused} refusals. Nothing is in the book of account until somebody other than you commits the run.`,
      }, 201)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The billing run could not be raised.')
    } finally {
      client.release()
    }
  })

  /** Post every bill of a raised run. The point of no return: posted bills are never amended. */
  fastify.post('/finance/rates/billing/runs/:id/commit', { ...canCommit, schema: { params: idParams } },
    async (request, reply) => {
      const { rows: current } = await pg.query(
        'SELECT id, run_reference, status, prepared_by FROM finance.rates_billing_run WHERE id = $1 AND deleted_at IS NULL',
        [request.params.id])
      if (!current[0]) return fail(reply, 404, 'not_found', 'No such billing run.')
      if (current[0].prepared_by === request.user.id) {
        return fail(reply, 409, 'separation_of_duties',
          `You raised billing run ${current[0].run_reference}, so committing it is not yours to do. Committing must come from someone else.`)
      }
      const client = await pg.connect()
      try {
        await client.query('BEGIN')
        const { rows } = await client.query(
          'SELECT finance.commit_rates_billing_run($1, $2) AS posted', [request.params.id, request.user.id])
        // Force the deferred balance triggers inside this transaction, so a refusal arrives as a
        // readable 409 rather than as a failed COMMIT.
        await client.query('SET CONSTRAINTS ALL IMMEDIATE')
        const { rows: run } = await client.query(`${RUN_SELECT} WHERE r.id = $1`, [request.params.id])
        await client.query('COMMIT')
        request.auditDetails = {
          action: 'billing_run_committed', run_id: run[0].id, run_reference: run[0].run_reference,
          currency: run[0].currency, bills_posted: rows[0].posted, total_billed: run[0].total_billed,
        }
        return ok(reply, {
          run: run[0],
          bills_posted: rows[0].posted,
          note: 'Committed. The bills are in the book of account and can never be amended; a bill that is wrong is corrected by reversing it, and both halves stay visible.',
        })
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        return refuse(reply, err, 'The billing run could not be committed.')
      } finally {
        client.release()
      }
    })

  fastify.post('/finance/rates/billing/runs/:id/cancel', {
    ...canCancelRun,
    schema: {
      params: idParams,
      body: {
        type: 'object', required: ['reason'], additionalProperties: false,
        properties: { reason: { type: 'string', minLength: 5, maxLength: 1000 } },
      },
    },
  }, async (request, reply) => {
    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        'SELECT finance.cancel_rates_billing_run($1, $2, $3) AS cancelled',
        [request.params.id, request.user.id, request.body.reason])
      const { rows: run } = await client.query(`${RUN_SELECT} WHERE r.id = $1`, [request.params.id])
      await client.query('COMMIT')
      request.auditDetails = {
        action: 'billing_run_cancelled', run_id: run[0].id, run_reference: run[0].run_reference,
        drafts_cancelled: rows[0].cancelled, reason: request.body.reason.trim(),
      }
      return ok(reply, {
        run: run[0],
        drafts_cancelled: rows[0].cancelled,
        note: 'Cancelled. Its draft bills posted nothing and are withdrawn; the period can be billed again. The refusals are kept.',
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      if (/does not exist/.test(`${err.message}`)) return fail(reply, 404, 'not_found', 'No such billing run.')
      return refuse(reply, err, 'The billing run could not be cancelled.')
    } finally {
      client.release()
    }
  })

  // ═══ Bills ═════════════════════════════════════════════════════════════════════════════════

  fastify.get('/finance/rates/bills', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          rates_account_id: uuid,
          billing_run_id: uuid,
          financial_year_id: uuid,
          currency,
          status: { type: 'string', enum: ['draft', 'posted', 'cancelled'] },
          q: { type: 'string', maxLength: 200 },
          ...paging,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const from = `FROM finance.rates_bill rb
           JOIN finance.voucher v ON v.id = rb.voucher_id
           JOIN finance.rates_account ra ON ra.id = rb.rates_account_id
           JOIN finance.party pt ON pt.id = ra.party_id
           JOIN land.parcel pa ON pa.parcel_id = ra.parcel_id`
    const where = `WHERE rb.deleted_at IS NULL
        AND ($1::uuid IS NULL OR rb.rates_account_id = $1::uuid)
        AND ($2::uuid IS NULL OR rb.billing_run_id = $2::uuid)
        AND ($3::uuid IS NULL OR rb.financial_year_id = $3::uuid)
        AND ($4::text IS NULL OR rb.currency::text = $4)
        AND ($5::text IS NULL OR v.status = $5)
        AND ($6::text IS NULL OR rb.bill_no ILIKE $6 OR ra.account_no ILIKE $6
             OR pt.name ILIKE $6 OR pa.stand_no ILIKE $6)`
    const params = [q.rates_account_id || null, q.billing_run_id || null, q.financial_year_id || null,
      q.currency || null, q.status || null, q.q ? `%${q.q.trim()}%` : null]
    const [page, count, totals] = await Promise.all([
      pg.query(
        `SELECT rb.id, rb.bill_no, rb.rates_account_id, ra.account_no, pt.name AS party_name,
                ra.parcel_id, pa.stand_no, pa.ward_code, rb.billing_run_id,
                ${dateText('rb', 'period_from', 'period_to', 'issued_on', 'due_on')},
                rb.rateable_value::text AS rateable_value, rb.rate_in_dollar::text AS rate_in_dollar,
                rb.fixed_charge::text AS fixed_charge, rb.minimum_charge::text AS minimum_charge,
                rb.currency, rb.amount::text AS amount, rb.voucher_id, v.status AS voucher_status,
                finance.rates_bill_unsettled(rb.id)::numeric(18,2)::text AS open_amount
           ${from} ${where}
          ORDER BY rb.period_from DESC, rb.bill_no, rb.id LIMIT $7 OFFSET $8`,
        [...params, q.limit, q.offset]),
      pg.query(`SELECT count(*)::int AS total ${from} ${where}`, params),
      // Per currency AND status, over the whole filtered set. Never one figure across currencies.
      pg.query(
        `SELECT rb.currency, v.status AS voucher_status, count(*)::int AS bills,
                sum(rb.amount)::text AS amount
           ${from} ${where} GROUP BY rb.currency, v.status ORDER BY rb.currency, v.status`, params),
    ])
    return ok(reply, {
      bills: page.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset,
      totals: totals.rows,
    })
  })

  // ═══ Receipts ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/finance/rates/receipts', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          rates_account_id: uuid,
          financial_year_id: uuid,
          currency,
          status: { type: 'string', enum: ['draft', 'posted', 'cancelled'] },
          q: { type: 'string', maxLength: 200 },
          ...paging,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const from = `FROM finance.rates_receipt rc
           JOIN finance.voucher v ON v.id = rc.voucher_id
           JOIN finance.rates_account ra ON ra.id = rc.rates_account_id
           JOIN finance.party pt ON pt.id = rc.party_id`
    // A cancelled receipt is soft-deleted and its voucher cancelled; it is listed only when asked
    // for by status, so the register a cashier reads is the receipts that stand.
    const where = `WHERE (rc.deleted_at IS NULL OR $4::text = 'cancelled')
        AND ($1::uuid IS NULL OR rc.rates_account_id = $1::uuid)
        AND ($2::uuid IS NULL OR rc.financial_year_id = $2::uuid)
        AND ($3::text IS NULL OR rc.currency::text = $3)
        AND ($4::text IS NULL OR v.status = $4)
        AND ($5::text IS NULL OR rc.receipt_no ILIKE $5 OR ra.account_no ILIKE $5
             OR pt.name ILIKE $5 OR rc.reference ILIKE $5)`
    const params = [q.rates_account_id || null, q.financial_year_id || null, q.currency || null,
      q.status || null, q.q ? `%${q.q.trim()}%` : null]
    const [page, count, totals] = await Promise.all([
      pg.query(
        `SELECT rc.id, rc.receipt_no, rc.rates_account_id, ra.account_no, pt.name AS party_name,
                rc.received_on::text AS received_on, rc.currency, rc.amount::text AS amount,
                rc.method, rc.reference, rc.voucher_id, v.status AS voucher_status,
                v.prepared_by, v.posted_by,
                COALESCE((SELECT sum(l.credit) FROM finance.voucher_line l
                           WHERE l.voucher_id = v.id AND l.against_voucher_id IS NOT NULL), 0)::numeric(18,2)::text AS allocated_amount,
                COALESCE((SELECT sum(l.credit) FROM finance.voucher_line l
                           WHERE l.voucher_id = v.id AND l.against_voucher_id IS NULL), 0)::numeric(18,2)::text AS unallocated_amount
           ${from} ${where}
          ORDER BY rc.received_on DESC, rc.receipt_no, rc.id LIMIT $6 OFFSET $7`,
        [...params, q.limit, q.offset]),
      pg.query(`SELECT count(*)::int AS total ${from} ${where}`, params),
      pg.query(
        `SELECT rc.currency, v.status AS voucher_status, count(*)::int AS receipts,
                sum(rc.amount)::text AS amount
           ${from} ${where} GROUP BY rc.currency, v.status ORDER BY rc.currency, v.status`, params),
    ])
    return ok(reply, {
      receipts: page.rows, total: count.rows[0].total, limit: q.limit, offset: q.offset,
      totals: totals.rows,
    })
  })

  /**
   * Take a payment. Raises the receipt and its DRAFT voucher through
   * finance.record_rates_receipt(); the money is in the book of account once somebody else posts it.
   */
  fastify.post('/finance/rates/receipts', {
    ...canReceipt,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['receipt_no', 'rates_account_id', 'financial_year_id', 'amount', 'currency',
          'received_on', 'bank_ledger_account_id'],
        properties: {
          receipt_no: { type: 'string', minLength: 1, maxLength: 60 },
          rates_account_id: uuid,
          financial_year_id: uuid,
          amount: money,
          currency,
          received_on: isoDate,
          bank_ledger_account_id: uuid,
          receivable_ledger_account_id: uuid,
          method: { type: 'string', enum: RECEIPT_METHODS },
          reference: { type: 'string', maxLength: 120 },
          narration: { type: 'string', maxLength: 500 },
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
    const amount = parseMoney(b.amount)
    if (!amount.ok || amount.value.startsWith('-') || Number(amount.value) === 0) {
      return fail(reply, 400, 'amount_unreadable', 'A receipt is for an amount greater than nil, and this one could not be read.')
    }
    const checked = validateAllocations(b.allocations)
    if (!checked.ok) return fail(reply, 400, 'allocation_invalid', checked.message)

    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        `SELECT finance.record_rates_receipt($1,$2,$3,$4::numeric,$5,$6::date,$7,$8,$9::jsonb,$10,$11,$12,$13) AS id`,
        [b.rates_account_id, b.financial_year_id, normaliseCode(b.receipt_no), amount.value, b.currency,
          b.received_on, b.bank_ledger_account_id, request.user.id, JSON.stringify(checked.allocations),
          b.receivable_ledger_account_id || null, b.method || null, b.reference || null,
          b.narration || null])
      const { rows: receipt } = await client.query(
        `SELECT rc.id, rc.receipt_no, rc.amount::text AS amount, rc.currency,
                rc.received_on::text AS received_on, rc.voucher_id, v.status AS voucher_status,
                COALESCE((SELECT sum(l.credit) FROM finance.voucher_line l
                           WHERE l.voucher_id = v.id AND l.against_voucher_id IS NULL), 0)::numeric(18,2)::text AS unallocated_amount
           FROM finance.rates_receipt rc JOIN finance.voucher v ON v.id = rc.voucher_id
          WHERE rc.id = $1`, [rows[0].id])
      await client.query('COMMIT')
      request.auditDetails = {
        action: 'receipt_recorded', receipt_id: receipt[0].id, receipt_no: receipt[0].receipt_no,
        rates_account_id: b.rates_account_id, amount: receipt[0].amount, currency: receipt[0].currency,
        allocations: checked.allocations.length, unallocated_amount: receipt[0].unallocated_amount,
      }
      return ok(reply, {
        receipt: receipt[0],
        note: 'Recorded as a draft. The payment reduces what the bills have open straight away, and reaches the book of account and the arrears when somebody other than you posts it.',
      }, 201)
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The receipt could not be recorded.')
    } finally {
      client.release()
    }
  })

  /** Post a receipt's voucher. Not the person who took the payment. */
  fastify.post('/finance/rates/receipts/:id/post', { ...canPostVoucher, schema: { params: idParams } },
    async (request, reply) => {
      const { rows: current } = await pg.query(
        `SELECT rc.id, rc.receipt_no, rc.voucher_id, v.status, v.prepared_by
           FROM finance.rates_receipt rc JOIN finance.voucher v ON v.id = rc.voucher_id
          WHERE rc.id = $1 AND rc.deleted_at IS NULL`, [request.params.id])
      if (!current[0]) return fail(reply, 404, 'not_found', 'No such receipt.')
      if (current[0].prepared_by === request.user.id) {
        return fail(reply, 409, 'separation_of_duties',
          `You recorded receipt ${current[0].receipt_no}, so posting it is not yours to do. Posting must come from someone else.`)
      }
      const client = await pg.connect()
      try {
        await client.query('BEGIN')
        const { rows } = await client.query(
          'SELECT finance.post_voucher($1, $2) AS entries', [current[0].voucher_id, request.user.id])
        await client.query('SET CONSTRAINTS ALL IMMEDIATE')
        await client.query('COMMIT')
        request.auditDetails = { action: 'receipt_posted', receipt_id: current[0].id, receipt_no: current[0].receipt_no }
        return ok(reply, {
          posted: current[0].receipt_no, entries: rows[0].entries,
          note: 'Posted. The payment is in the book of account and the arrears; if it is later dishonoured it is reversed, and the debt returns to the bills it had settled.',
        })
      } catch (err) {
        await client.query('ROLLBACK').catch(() => {})
        return refuse(reply, err, 'The receipt could not be posted.')
      } finally {
        client.release()
      }
    })

  /**
   * Cancel a DRAFT receipt.
   *
   * Cancelled, never deleted: a receipt is evidence that money was taken, and a draft that could
   * be made to disappear is how money taken at a counter goes missing. The voucher is marked
   * cancelled with the reason and the receipt is kept, soft-deleted, with who cancelled it. A
   * POSTED receipt is not cancelled at all — it is reversed through the ledger.
   */
  fastify.post('/finance/rates/receipts/:id/cancel', {
    ...canReceipt,
    schema: {
      params: idParams,
      body: {
        type: 'object', required: ['reason'], additionalProperties: false,
        properties: { reason: { type: 'string', minLength: 5, maxLength: 1000 } },
      },
    },
  }, async (request, reply) => {
    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows: current } = await client.query(
        `SELECT rc.id, rc.receipt_no, rc.amount::text AS amount, rc.currency, rc.voucher_id, v.status
           FROM finance.rates_receipt rc JOIN finance.voucher v ON v.id = rc.voucher_id
          WHERE rc.id = $1 AND rc.deleted_at IS NULL FOR UPDATE OF rc, v`, [request.params.id])
      if (!current[0]) {
        await client.query('ROLLBACK')
        return fail(reply, 404, 'not_found', 'No such receipt.')
      }
      if (current[0].status !== 'draft') {
        await client.query('ROLLBACK')
        return fail(reply, 409, 'receipt_posted',
          `Receipt ${current[0].receipt_no} is ${current[0].status}. A posted receipt is never cancelled — it is reversed in the general ledger, and both halves stay on the record.`)
      }
      await client.query(
        `UPDATE finance.voucher SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3
          WHERE id = $1 AND status = 'draft'`, [current[0].voucher_id, request.user.id, request.body.reason.trim()])
      await client.query(
        'UPDATE finance.rates_receipt SET deleted_at = now(), deleted_by = $2 WHERE id = $1',
        [current[0].id, request.user.id])
      await client.query('COMMIT')
      request.auditDetails = {
        action: 'receipt_cancelled', receipt_id: current[0].id, receipt_no: current[0].receipt_no,
        amount: current[0].amount, currency: current[0].currency, reason: request.body.reason.trim(),
      }
      return ok(reply, {
        cancelled: current[0].receipt_no,
        note: 'Cancelled. It posted nothing; the receipt and the reason are kept on the record, and its number is not reused.',
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      return refuse(reply, err, 'The receipt could not be cancelled.')
    } finally {
      client.release()
    }
  })

  // ═══ Arrears ═══════════════════════════════════════════════════════════════════════════════

  /**
   * Rates arrears, per currency: the ageing buckets, the ratepayers who owe, and the reconciliation
   * to the receivable control account.
   *
   * Every figure is finance.v_rates_arrears — which is finance.v_debtor_ageing with the rates
   * account attached, nothing recomputed — so this report and the ledger's debtor ageing are the
   * same numbers. The reconciliation is returned with the report, not left to be assumed: an
   * arrears report that has quietly stopped agreeing with the book of account is the failure this
   * whole module is arranged to make visible.
   */
  fastify.get('/finance/rates/arrears', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          currency,
          ward_code: { type: 'string', maxLength: 24 },
          bucket: { type: 'string', enum: AGEING_BUCKETS },
          q: { type: 'string', maxLength: 200 },
          ...paging,
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = `WHERE ($1::text IS NULL OR a.currency::text = $1)
        AND ($2::text IS NULL OR a.ward_code = $2)
        AND ($3::text IS NULL OR a.account_no ILIKE $3 OR a.party_name ILIKE $3 OR a.stand_no ILIKE $3)`
    const params = [q.currency || null, q.ward_code || null, q.q ? `%${q.q.trim()}%` : null]
    const [buckets, accounts, count, control] = await Promise.all([
      pg.query(
        `SELECT a.currency, a.ageing_bucket, count(*)::int AS documents,
                sum(a.outstanding_amount)::text AS outstanding
           FROM finance.v_rates_arrears a ${where}
          GROUP BY a.currency, a.ageing_bucket`, params),
      pg.query(
        `SELECT a.rates_account_id, a.account_no, a.parcel_id, a.stand_no, a.ward_code,
                a.party_id, a.party_name, a.currency,
                sum(a.outstanding_amount)::text AS balance,
                COALESCE(sum(a.outstanding_amount) FILTER (WHERE a.outstanding_amount > 0), 0)::numeric(18,2)::text AS owed,
                COALESCE(-sum(a.outstanding_amount) FILTER (WHERE a.ageing_bucket = 'unallocated'), 0)::numeric(18,2)::text AS unallocated_credit,
                max(a.days_outstanding) FILTER (WHERE a.outstanding_amount > 0) AS oldest_days,
                count(*) FILTER (WHERE a.outstanding_amount > 0)::int AS open_bills
           FROM finance.v_rates_arrears a ${where}
          GROUP BY a.rates_account_id, a.account_no, a.parcel_id, a.stand_no, a.ward_code,
                   a.party_id, a.party_name, a.currency
         HAVING sum(a.outstanding_amount) <> 0
            AND ($4::text IS NULL OR bool_or(a.ageing_bucket = $4 AND a.outstanding_amount <> 0))
          ORDER BY a.currency, sum(a.outstanding_amount) DESC, a.account_no
          LIMIT $5 OFFSET $6`, [...params, q.bucket || null, q.limit, q.offset]),
      pg.query(
        `SELECT count(*)::int AS total FROM (
           SELECT 1 FROM finance.v_rates_arrears a ${where}
            GROUP BY a.rates_account_id, a.currency
           HAVING sum(a.outstanding_amount) <> 0
              AND ($4::text IS NULL OR bool_or(a.ageing_bucket = $4 AND a.outstanding_amount <> 0))) x`,
        [...params, q.bucket || null]),
      // The whole receivable control against the whole ledger ageing and the rates part of it. Not
      // filtered by ward or search: a reconciliation over a filtered slice proves nothing.
      pg.query(
        `WITH control AS (
           SELECT currency, sum(net_debit) AS balance FROM finance.v_account_balance
            WHERE account_type = 'receivable' GROUP BY currency
         ), ledger AS (
           SELECT currency, sum(outstanding_amount) AS outstanding FROM finance.v_debtor_ageing GROUP BY currency
         ), rates AS (
           SELECT currency, sum(outstanding_amount) AS outstanding FROM finance.v_rates_arrears GROUP BY currency
         )
         SELECT c.currency, c.balance::numeric(18,2)::text AS control_balance,
                COALESCE(l.outstanding, 0)::numeric(18,2)::text AS ledger_ageing,
                COALESCE(r.outstanding, 0)::numeric(18,2)::text AS rates_arrears,
                (COALESCE(l.outstanding, 0) - c.balance)::numeric(18,2)::text AS ledger_difference,
                (COALESCE(l.outstanding, 0) - COALESCE(r.outstanding, 0))::numeric(18,2)::text AS other_debtors,
                (COALESCE(l.outstanding, 0) = c.balance) AS reconciles
           FROM control c
           LEFT JOIN ledger l ON l.currency = c.currency
           LEFT JOIN rates r ON r.currency = c.currency
          ORDER BY c.currency`),
    ])
    // REGROUPING ONLY: each figure below is the string SQL returned. Buckets are laid out in the
    // fixed order a statement prints them, one book per currency, and no figure spans two books.
    const byCurrency = new Map()
    for (const row of buckets.rows) {
      if (!byCurrency.has(row.currency)) byCurrency.set(row.currency, new Map())
      byCurrency.get(row.currency).set(row.ageing_bucket, row)
    }
    const books = [...byCurrency.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([ccy, rows]) => ({
      currency: ccy,
      buckets: AGEING_BUCKETS.map((bucket) => ({
        bucket,
        label: AGEING_LABELS[bucket],
        documents: rows.get(bucket)?.documents ?? 0,
        outstanding: rows.get(bucket)?.outstanding ?? '0.00',
      })),
    }))
    return ok(reply, {
      books,
      accounts: accounts.rows,
      total: count.rows[0].total,
      limit: q.limit,
      offset: q.offset,
      reconciliation: control.rows,
      as_at: new Date().toISOString().slice(0, 10),
      note: books.length === 0
        ? 'No rates arrears: no bill has been posted. Arrears are drawn from the posted ledger, so a run that is raised and not yet committed owes nothing here.'
        : 'Ages run from each bill\'s own posting date. Money received and not yet matched to a bill is shown as an unallocated credit and is not netted off any bill.',
    })
  })
}

/** One billing run, with its preparer, committer and what it billed. Shared by four handlers. */
const RUN_SELECT = `SELECT r.id, r.run_reference, r.financial_year_id, y.label AS financial_year_label,
       r.period_from::text AS period_from, r.period_to::text AS period_to,
       r.posting_date::text AS posting_date, r.currency, r.status,
       r.receivable_ledger_account_id, rv.code AS receivable_account_code,
       r.revenue_ledger_account_id, rn.code AS revenue_account_code,
       r.properties_considered, r.bills_raised, r.properties_refused,
       COALESCE((SELECT sum(rb.amount) FROM finance.rates_bill rb
                  WHERE rb.billing_run_id = r.id), 0)::numeric(18,2)::text AS total_billed,
       r.prepared_by, COALESCE(pu.full_name, pu.name) AS prepared_by_name, r.prepared_at,
       r.committed_by, COALESCE(cu.full_name, cu.name) AS committed_by_name, r.committed_at,
       r.cancelled_by, r.cancelled_at, r.cancel_reason, r.notes
  FROM finance.rates_billing_run r
  JOIN finance.financial_year y ON y.id = r.financial_year_id
  JOIN finance.ledger_account rv ON rv.id = r.receivable_ledger_account_id
  JOIN finance.ledger_account rn ON rn.id = r.revenue_ledger_account_id
  LEFT JOIN public.users pu ON pu.id = r.prepared_by
  LEFT JOIN public.users cu ON cu.id = r.committed_by`

module.exports = {
  financeRatesRoutes,
  // Exported for test/finance-rates.test.js, which exercises them with no database.
  parseRate,
  parseOptionalMoney,
  refusalSummary,
  validateAllocations,
  ratesRefusal,
  REFUSAL_REASONS,
  REASON_CODES,
  RECEIPT_METHODS,
  DECISIONS,
}
