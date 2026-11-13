/**
 * Creditors: supplier invoices, payment vouchers and what is owed.
 *
 * Tables, view and functions: migration 213 (finance.supplier_invoice[_line],
 * finance.supplier_payment[_allocation], finance.v_creditor_open,
 * finance.create_supplier_invoice(), finance.create_supplier_payment(),
 * finance.discard_payables_document()).
 * Design: docs/superpowers/specs/2026-11-13-accountant-full-system-design.md §5 (frontend repo).
 *
 * Capturing a document writes a DRAFT voucher. Approving it is finance.post_voucher(), by somebody
 * other than whoever prepared it; the constraint that holds is the ledger's own. What is owed is
 * read from finance.v_creditor_open, which is derived from the ledger. No money arithmetic happens
 * in this file, and nothing is totalled across currencies.
 */

const { requirePermission } = require('../middleware/financePermissions')
const { parseMoney, str, dateText } = require('../lib/finance')

const uuid = { type: 'string', format: 'uuid' }
const isoDate = { type: 'string', format: 'date' }
const currency = { type: 'string', enum: ['USD', 'ZWG'] }
const money = { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'number' }] }
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } }
const METHODS = ['bank_transfer', 'cheque', 'rtgs', 'mobile_money', 'cash', 'other']
const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message) => reply.code(status).send({ success: false, error, message })

/** A positive amount as a decimal string, or null. */
const positive = (raw) => {
  const p = parseMoney(typeof raw === 'number' ? raw : String(raw ?? ''))
  return p.ok && !p.value.startsWith('-') && !/^0+(\.0+)?$/.test(p.value) ? p.value : null
}
const notNegative = (raw) => {
  if (raw === undefined || raw === null || raw === '') return '0.00'
  const p = parseMoney(typeof raw === 'number' ? raw : String(raw))
  return p.ok && !p.value.startsWith('-') ? p.value : null
}

function payablesRefusal(err) {
  const message = `${err && err.message ? err.message : ''}`
  const hint = err && err.hint ? ` ${err.hint}` : ''
  if (err && err.constraint === 'uq_supplier_invoice_ref') {
    return { status: 409, error: 'duplicate_invoice', message: 'This supplier\'s invoice number has already been captured. Capturing it again is how a supplier is paid twice.' }
  }
  if (err && err.constraint === 'voucher_prepared_and_posted_differ' || /must be posted by somebody else/.test(message)) {
    return { status: 409, error: 'separation_of_duties', message: 'Whoever prepared this document cannot approve it. Approval must come from someone else.' }
  }
  if (/only .* is still open on it/.test(message)) return { status: 409, error: 'overpayment', message: message + hint }
  if (/accepts no postings|falls outside period|no accounting period/.test(message)) return { status: 409, error: 'period_not_open', message: message + hint }
  if (/can no longer be discarded|already .* and cannot be posted again/.test(message)) return { status: 409, error: 'already_done', message: message + hint }
  if (/is a heading and cannot be posted to|is inactive and cannot be posted to/.test(message)) return { status: 400, error: 'account_not_postable', message }
  if (err && ['23514', '23503', '23502'].includes(err.code)) return { status: 409, error: 'refused', message: message + hint }
  return null
}

async function financePayablesRoutes(fastify) {
  const pg = fastify.pg
  const can = (code) => ({ preHandler: requirePermission(fastify, code) })
  const canView = can('finance.payables.view')

  const refuse = (reply, err, fallback) => {
    const mapped = payablesRefusal(err)
    if (mapped) return fail(reply, mapped.status, mapped.error, mapped.message)
    fastify.log.error({ err }, fallback)
    return fail(reply, 500, 'payables_error', fallback)
  }
  const transact = async (work) => {
    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const out = await work(client)
      await client.query('SET CONSTRAINTS ALL IMMEDIATE')
      await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  /** The status a person reads, from the voucher: nothing is kept in two places. */
  const STATUS = `CASE WHEN v.status = 'draft' THEN 'awaiting_approval'
      WHEN EXISTS (SELECT 1 FROM finance.voucher r WHERE r.reverses_voucher_id = v.id AND r.status = 'posted') THEN 'reversed'
      ELSE 'approved' END`
  const NAMES = `(SELECT u.full_name FROM public.users u WHERE u.id = v.prepared_by) AS prepared_by_name,
    (SELECT u.full_name FROM public.users u WHERE u.id = v.posted_by) AS approved_by_name, v.posted_at AS approved_at,
    v.prepared_by, v.id AS voucher_id, ${dateText('v', 'posting_date')}`

  /** What is owed, per currency, and what is waiting for a second person. */
  fastify.get('/finance/payables/summary', canView, async (request, reply) => {
    const [owed, waiting, accounts] = await Promise.all([
      pg.query(
        `SELECT currency, count(*)::int AS documents, sum(outstanding_amount)::text AS outstanding,
                COALESCE(sum(outstanding_amount) FILTER (WHERE days_overdue > 0 AND due_date IS NOT NULL), 0)::text AS overdue,
                COALESCE(sum(pending_amount), 0)::text AS in_draft_payments
           FROM finance.v_creditor_open WHERE outstanding_amount <> 0 GROUP BY currency ORDER BY currency`),
      pg.query(
        `SELECT (SELECT count(*)::int FROM finance.supplier_invoice i JOIN finance.voucher v ON v.id = i.voucher_id WHERE v.status = 'draft') AS invoices,
                (SELECT count(*)::int FROM finance.supplier_payment p JOIN finance.voucher v ON v.id = p.voucher_id WHERE v.status = 'draft') AS payments`),
      pg.query(
        `SELECT id, code, name, account_type FROM finance.ledger_account
          WHERE deleted_at IS NULL AND status = 'active' AND is_postable AND NOT is_group
            AND account_type IN ('payable', 'tax', 'bank', 'cash') ORDER BY code`),
    ])
    const of = (type) => accounts.rows.filter((a) => a.account_type === type)
    return ok(reply, {
      owed: owed.rows, awaiting_approval: waiting.rows[0],
      payable_accounts: of('payable'), tax_accounts: of('tax'), bank_accounts: [...of('bank'), ...of('cash')], methods: METHODS,
    })
  })

  // ═══ Supplier invoices ══════════════════════════════════════════════════════════════════════

  const INVOICE = `i.id, i.invoice_no, i.supplier_ref, i.party_id, p.name AS party_name, i.currency,
    ${dateText('i', 'invoice_date', 'due_date')}, i.net_total::text AS net_total, i.tax_total::text AS tax_total,
    i.total::text AS total, i.narration, ${STATUS} AS status, ${NAMES},
    COALESCE(o.outstanding_amount, CASE WHEN v.status = 'draft' THEN i.total ELSE 0 END)::text AS outstanding`
  const INVOICE_FROM = `FROM finance.supplier_invoice i
    JOIN finance.voucher v ON v.id = i.voucher_id
    JOIN finance.party p ON p.id = i.party_id
    LEFT JOIN finance.v_creditor_open o ON o.voucher_id = i.voucher_id AND o.party_id = i.party_id`

  fastify.get('/finance/payables/invoices', {
    ...canView,
    schema: {
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['awaiting_approval', 'unpaid', 'paid', 'reversed'] },
          party_id: uuid, q: { type: 'string', maxLength: 120 },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 100 }, offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT * FROM (SELECT ${INVOICE} ${INVOICE_FROM}) x
        WHERE ($1::uuid IS NULL OR x.party_id = $1)
          AND ($2::text IS NULL OR x.invoice_no ILIKE $2 OR x.supplier_ref ILIKE $2 OR x.party_name ILIKE $2)
          AND ($3::text IS NULL
               OR ($3 = 'awaiting_approval' AND x.status = 'awaiting_approval')
               OR ($3 = 'reversed' AND x.status = 'reversed')
               OR ($3 = 'unpaid' AND x.status = 'approved' AND x.outstanding::numeric <> 0)
               OR ($3 = 'paid' AND x.status = 'approved' AND x.outstanding::numeric = 0))
        ORDER BY (x.status = 'awaiting_approval') DESC, x.invoice_date DESC, x.invoice_no DESC
        LIMIT $4 OFFSET $5`,
      [q.party_id || null, q.q ? `%${q.q.trim()}%` : null, q.status || null, q.limit, q.offset])
    return ok(reply, { invoices: rows })
  })

  fastify.get('/finance/payables/invoices/:id', { ...canView, schema: { params: idParams } }, async (request, reply) => {
    const { rows } = await pg.query(`SELECT ${INVOICE}, pa.code AS payable_code, pa.name AS payable_name ${INVOICE_FROM}
        JOIN finance.ledger_account pa ON pa.id = i.payable_account_id WHERE i.id = $1`, [request.params.id])
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such supplier invoice.')
    const [lines, payments] = await Promise.all([
      pg.query(
        `SELECT l.line_no, la.code AS account_code, la.name AS account_name, l.description,
                l.net_amount::text AS net_amount, l.tax_amount::text AS tax_amount, d.name AS department_name
           FROM finance.supplier_invoice_line l JOIN finance.ledger_account la ON la.id = l.ledger_account_id
           LEFT JOIN finance.department d ON d.id = l.department_id
          WHERE l.invoice_id = $1 ORDER BY l.line_no`, [request.params.id]),
      pg.query(
        `SELECT sp.id, sp.payment_no, ${dateText('sp', 'payment_date')}, a.amount::text AS amount, pv.status AS voucher_status
           FROM finance.supplier_payment_allocation a JOIN finance.supplier_payment sp ON sp.id = a.payment_id
           JOIN finance.voucher pv ON pv.id = sp.voucher_id
          WHERE a.against_voucher_id = $1 ORDER BY sp.payment_date`, [rows[0].voucher_id]),
    ])
    return ok(reply, { invoice: rows[0], lines: lines.rows, payments: payments.rows })
  })

  fastify.post('/finance/payables/invoices', {
    ...can('finance.payables.invoice.prepare'),
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['party_id', 'currency', 'financial_year_id', 'invoice_date', 'due_date', 'supplier_ref', 'payable_account_id', 'lines'],
        properties: {
          party_id: uuid, currency, financial_year_id: uuid, posting_date: isoDate, invoice_date: isoDate, due_date: isoDate,
          supplier_ref: { type: 'string', minLength: 1, maxLength: 120 }, payable_account_id: uuid, tax_account_id: uuid,
          narration: { type: 'string', maxLength: 2000 },
          lines: {
            type: 'array', minItems: 1, maxItems: 500,
            items: {
              type: 'object', additionalProperties: false, required: ['ledger_account_id', 'net_amount'],
              properties: {
                ledger_account_id: uuid, description: { type: 'string', maxLength: 500 }, net_amount: money, tax_amount: money,
                department_id: uuid, budget_line_id: uuid, project_id: uuid,
              },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const lines = []
    for (const [i, line] of b.lines.entries()) {
      const net = positive(line.net_amount)
      const tax = notNegative(line.tax_amount)
      if (!net) return fail(reply, 400, 'bad_amount', `Line ${i + 1} needs a positive amount.`)
      if (tax === null) return fail(reply, 400, 'bad_tax', `Line ${i + 1} has a tax amount that cannot be read.`)
      lines.push({ ...line, net_amount: net, tax_amount: tax })
    }
    try {
      const id = await transact(async (db) => (await db.query(
        'SELECT finance.create_supplier_invoice($1,$2,$3,$4::date,$5::date,$6::date,$7,$8,$9,$10,$11::jsonb,$12) AS id',
        [b.party_id, b.currency, b.financial_year_id, b.posting_date || new Date().toISOString().slice(0, 10), b.invoice_date,
          b.due_date, b.supplier_ref, b.payable_account_id, b.tax_account_id || null, b.narration || null,
          JSON.stringify(lines), request.user.id])).rows[0].id)
      return ok(reply, { id, note: 'Captured as a draft. It posts to the ledger when somebody other than you approves it.' }, 201)
    } catch (err) {
      return refuse(reply, err, 'The supplier invoice could not be captured.')
    }
  })

  /** Approve = post the document's voucher. Never by whoever prepared it. */
  const approve = (kind, table, permission, label) => {
    fastify.post(`/finance/payables/${kind}s/:id/approve`, { ...can(permission), schema: { params: idParams } }, async (request, reply) => {
      const { rows } = await pg.query(
        `SELECT d.voucher_id, v.prepared_by, v.status FROM finance.${table} d JOIN finance.voucher v ON v.id = d.voucher_id WHERE d.id = $1`,
        [request.params.id])
      if (!rows[0]) return fail(reply, 404, 'not_found', `No such ${label}.`)
      if (rows[0].prepared_by === request.user.id) {
        return fail(reply, 409, 'separation_of_duties', `You prepared this ${label}, so approving it is not yours to do. Approval must come from someone else.`)
      }
      try {
        await transact((db) => db.query('SELECT finance.post_voucher($1, $2)', [rows[0].voucher_id, request.user.id]))
        return ok(reply, { approved: true, note: 'Approved and posted. A posted document is corrected by a reversal, never edited.' })
      } catch (err) {
        return refuse(reply, err, `The ${label} could not be approved.`)
      }
    })
    fastify.delete(`/finance/payables/${kind}s/:id`, { ...can(`finance.payables.${kind}.prepare`), schema: { params: idParams } }, async (request, reply) => {
      try {
        const no = await transact(async (db) => (await db.query('SELECT finance.discard_payables_document($1, $2) AS no', [kind, request.params.id])).rows[0].no)
        return ok(reply, { discarded: no })
      } catch (err) {
        return refuse(reply, err, `The ${label} could not be discarded.`)
      }
    })
  }
  approve('invoice', 'supplier_invoice', 'finance.payables.invoice.approve', 'supplier invoice')
  approve('payment', 'supplier_payment', 'finance.payables.payment.approve', 'payment voucher')

  // ═══ What is owed ═══════════════════════════════════════════════════════════════════════════

  /** Open documents, for the creditors list and for choosing what a payment pays. */
  fastify.get('/finance/payables/open', {
    ...canView,
    schema: { querystring: { type: 'object', properties: { party_id: uuid, currency } } },
  }, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT o.currency, o.party_id, o.party_name, o.party_reference, o.voucher_id, o.voucher_no, o.voucher_type,
              o.supplier_invoice_id, o.document_ref, o.document_date::text AS document_date, o.due_date::text AS due_date,
              o.raised_amount::text AS raised, o.settled_amount::text AS settled, o.outstanding_amount::text AS outstanding,
              o.pending_amount::text AS pending, o.payable_amount::text AS payable, o.days_outstanding, o.days_overdue,
              la.code AS payable_code,
              CASE WHEN o.days_outstanding <= 30 THEN 'current' WHEN o.days_outstanding <= 60 THEN '31_60'
                   WHEN o.days_outstanding <= 90 THEN '61_90' ELSE 'over_90' END AS bucket
         FROM finance.v_creditor_open o JOIN finance.ledger_account la ON la.id = o.ledger_account_id
        WHERE o.outstanding_amount <> 0 AND o.party_id IS NOT NULL
          AND ($1::uuid IS NULL OR o.party_id = $1) AND ($2::text IS NULL OR o.currency::text = $2)
        ORDER BY o.party_name, o.document_date, o.voucher_no LIMIT 2000`,
      [request.query.party_id || null, request.query.currency || null])
    return ok(reply, { items: rows })
  })

  // ═══ Payment vouchers ═══════════════════════════════════════════════════════════════════════

  const PAYMENT = `sp.id, sp.payment_no, sp.party_id, p.name AS party_name, sp.currency, ${dateText('sp', 'payment_date')},
    sp.method, sp.reference, sp.total::text AS total, sp.narration, ba.code AS bank_code, ba.name AS bank_name,
    ${STATUS} AS status, ${NAMES}`
  const PAYMENT_FROM = `FROM finance.supplier_payment sp
    JOIN finance.voucher v ON v.id = sp.voucher_id
    JOIN finance.party p ON p.id = sp.party_id
    JOIN finance.ledger_account ba ON ba.id = sp.bank_account_id`

  fastify.get('/finance/payables/payments', {
    ...canView,
    schema: { querystring: { type: 'object', properties: { party_id: uuid, status: { type: 'string', enum: ['awaiting_approval', 'approved', 'reversed'] } } } },
  }, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT * FROM (SELECT ${PAYMENT},
                (SELECT jsonb_agg(jsonb_build_object('voucher_no', av.voucher_no, 'document_ref', COALESCE(si.supplier_ref, av.reference),
                                                     'amount', a.amount::text) ORDER BY av.voucher_no)
                   FROM finance.supplier_payment_allocation a JOIN finance.voucher av ON av.id = a.against_voucher_id
                   LEFT JOIN finance.supplier_invoice si ON si.voucher_id = av.id
                  WHERE a.payment_id = sp.id) AS pays
              ${PAYMENT_FROM}) x
        WHERE ($1::uuid IS NULL OR x.party_id = $1) AND ($2::text IS NULL OR x.status = $2)
        ORDER BY (x.status = 'awaiting_approval') DESC, x.payment_date DESC, x.payment_no DESC LIMIT 200`,
      [request.query.party_id || null, request.query.status || null])
    return ok(reply, { payments: rows })
  })

  fastify.post('/finance/payables/payments', {
    ...can('finance.payables.payment.prepare'),
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['party_id', 'currency', 'financial_year_id', 'payment_date', 'bank_account_id', 'method', 'allocations'],
        properties: {
          party_id: uuid, currency, financial_year_id: uuid, payment_date: isoDate, bank_account_id: uuid,
          method: { type: 'string', enum: METHODS }, reference: { type: 'string', maxLength: 120 }, narration: { type: 'string', maxLength: 2000 },
          allocations: {
            type: 'array', minItems: 1, maxItems: 500,
            items: { type: 'object', additionalProperties: false, required: ['against_voucher_id', 'amount'], properties: { against_voucher_id: uuid, amount: money } },
          },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const allocations = []
    for (const a of b.allocations) {
      const amount = positive(a.amount)
      if (!amount) return fail(reply, 400, 'bad_amount', 'Each amount paid must be a positive figure.')
      allocations.push({ against_voucher_id: a.against_voucher_id, amount })
    }
    if (new Set(allocations.map((a) => a.against_voucher_id)).size !== allocations.length) {
      return fail(reply, 400, 'duplicate_allocation', 'A document appears twice in this payment.')
    }
    try {
      const id = await transact(async (db) => (await db.query(
        'SELECT finance.create_supplier_payment($1,$2,$3,$4::date,$5,$6,$7,$8,$9::jsonb,$10) AS id',
        [b.party_id, b.currency, b.financial_year_id, b.payment_date, b.bank_account_id, b.method,
          str(b.reference, 120), b.narration || null, JSON.stringify(allocations), request.user.id])).rows[0].id)
      return ok(reply, { id, note: 'Prepared as a draft. Nothing is paid in the ledger until somebody other than you approves it.' }, 201)
    } catch (err) {
      return refuse(reply, err, 'The payment voucher could not be prepared.')
    }
  })
}

module.exports = { financePayablesRoutes, payablesRefusal }
