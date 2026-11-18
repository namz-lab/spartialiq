/**
 * Planning fees in the ledger (migration 246).
 *
 *   GET  /finance/planning-fees            every planning fee, its application, receipt or payment, voucher and state
 *   POST /finance/planning-fees/prepare    raise the draft vouchers for online fees still waiting (a revenue officer)
 *
 * The counter receipt is in finance-cash.js (POST /finance/cash/receipts/planning) and an online fee
 * is noted by payments.js the moment the provider confirms it. This module is the revenue side: what
 * came in, what still needs a voucher, and the one act of preparing those vouchers.
 *
 * THE RULES LIVE IN THE DATABASE. finance.prepare_online_planning_fee_vouchers() decides which fees
 * can be prepared and says why the others wait (no income code marked for that kind, no bank account
 * for that provider, no open financial year). It posts nothing: the vouchers are drafts prepared by
 * the caller, and finance.post_voucher() refuses to let the same person post them (203).
 */
const { requirePermission } = require('../middleware/financePermissions')

const uuid = { type: 'string', format: 'uuid' }
const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

const STATES = ['awaiting_voucher', 'awaiting_posting', 'posted', 'cancelled']

const FEE_SELECT = `
  SELECT f.id, f.source, f.fee_kind, f.permit_application_id, f.tpd_reference, f.dev_register_no,
         f.stand_number, f.applicant_name, f.payer_name, f.currency, f.amount::text AS amount,
         f.received_on::text AS received_on, f.reference, f.receipt_no, f.method, f.driver,
         f.voucher_id, f.voucher_no, f.voucher_status, f.state, f.prepared_at,
         COALESCE(u.full_name, u.name) AS prepared_by_name, f.created_at
    FROM finance.v_planning_fee f
    LEFT JOIN public.users u ON u.id = f.prepared_by`

async function financePlanningFeeRoutes(fastify) {
  const pg = fastify.pg
  const canView = { preHandler: requirePermission(fastify, 'finance.planning_fees.view') }
  const canPrepare = { preHandler: requirePermission(fastify, 'finance.planning_fees.prepare') }

  fastify.get('/finance/planning-fees', {
    ...canView,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          state: { type: 'string', enum: STATES },
          source: { type: 'string', enum: ['counter', 'online'] },
          permit_application_id: uuid,
          q: { type: 'string', maxLength: 80 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = []
    const params = []
    const add = (sql, value) => { params.push(value); where.push(sql.replace('$?', `$${params.length}`)) }
    if (q.state) add('f.state = $?', q.state)
    if (q.source) add('f.source = $?', q.source)
    if (q.permit_application_id) add('f.permit_application_id = $?', q.permit_application_id)
    if (q.q && q.q.trim()) {
      const like = `%${q.q.trim().replace(/[%_\\]/g, '\\$&')}%`
      params.push(like)
      const n = `$${params.length}`
      where.push(`(f.tpd_reference ILIKE ${n} OR f.dev_register_no ILIKE ${n} OR f.stand_number ILIKE ${n}
                   OR f.payer_name ILIKE ${n} OR f.applicant_name ILIKE ${n} OR f.reference ILIKE ${n}
                   OR f.voucher_no ILIKE ${n})`)
    }
    const clause = where.length ? `WHERE ${where.join(' AND ')}` : ''
    try {
      const [{ rows }, { rows: totals }, { rows: counts }] = await Promise.all([
        pg.query(`${FEE_SELECT} ${clause} ORDER BY f.received_on DESC, f.created_at DESC
                  LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, q.limit, q.offset]),
        pg.query(`SELECT count(*)::int AS n FROM finance.v_planning_fee f ${clause}`, params),
        // The figures for the page's head: never summed across currencies (D4).
        pg.query(`SELECT state, currency, count(*)::int AS n, sum(amount)::text AS amount
                    FROM finance.v_planning_fee GROUP BY state, currency ORDER BY state, currency`),
      ])
      return ok(reply, { fees: rows, total: totals[0].n, limit: q.limit, offset: q.offset, summary: counts })
    } catch (err) {
      fastify.log.error({ err }, 'planning fees could not be read')
      return fail(reply, 500, 'planning_fees_error', 'The planning fees could not be read.')
    }
  })

  fastify.post('/finance/planning-fees/prepare', {
    ...canPrepare,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: { ids: { type: 'array', items: uuid, maxItems: 500 } },
      },
    },
  }, async (request, reply) => {
    const ids = request.body && request.body.ids && request.body.ids.length ? request.body.ids : null
    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const { rows } = await client.query(
        'SELECT * FROM finance.prepare_online_planning_fee_vouchers($1, $2::uuid[])', [request.user.id, ids])
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('COMMIT')
      const prepared = rows.filter((r) => r.outcome === 'prepared')
      const waiting = rows.filter((r) => r.outcome !== 'prepared')
      request.auditDetails = {
        action: 'planning_fee_vouchers_prepared', prepared: prepared.length, waiting: waiting.length,
        vouchers: prepared.map((r) => r.voucher_no),
      }
      return ok(reply, {
        prepared: prepared.map((r) => ({ planning_fee_id: r.planning_fee_id, voucher_no: r.voucher_no })),
        waiting: waiting.map((r) => ({ planning_fee_id: r.planning_fee_id, reason: r.reason })),
        note: prepared.length
          ? 'Prepared as drafts. They reach the ledger when somebody else posts them from the vouchers to post.'
          : 'Nothing was prepared.',
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      fastify.log.error({ err }, 'planning fee vouchers could not be prepared')
      return fail(reply, 500, 'prepare_failed', 'The vouchers could not be prepared. Nothing was changed.')
    } finally {
      client.release()
    }
  })
}

module.exports = { financePlanningFeeRoutes }
