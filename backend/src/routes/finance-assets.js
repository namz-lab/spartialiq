/**
 * The fixed-asset register, depreciation runs and disposals.
 *
 * Tables, view and functions: migration 214 (finance.asset_category, finance.fixed_asset,
 * finance.depreciation_run, finance.depreciation_charge, finance.v_asset_register,
 * finance.run_depreciation(), finance.dispose_asset()).
 * Design: docs/superpowers/specs/2026-11-13-accountant-full-system-design.md §6 (frontend repo).
 *
 * Registering an asset posts nothing: its cost reaches the ledger through the document that bought
 * it. A depreciation run and a disposal are draft vouchers until somebody other than whoever
 * raised them approves, which is finance.post_voucher(). The method, the cap at the depreciable
 * amount and the disposal's entries are the database's. No money arithmetic happens in this file.
 */

const { requirePermission } = require('../middleware/financePermissions')
const { parseMoney, normaliseCode, dateText } = require('../lib/finance')

const uuid = { type: 'string', format: 'uuid' }
const isoDate = { type: 'string', format: 'date' }
const currency = { type: 'string', enum: ['USD', 'ZWG'] }
const money = { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'number' }] }
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } }
const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message) => reply.code(status).send({ success: false, error, message })

/** A non-negative amount as a decimal string; '' and absent are nil; unreadable is null. */
const amount = (raw) => {
  if (raw === undefined || raw === null || raw === '') return '0.00'
  const p = parseMoney(typeof raw === 'number' ? raw : String(raw))
  return p.ok && !p.value.startsWith('-') ? p.value : null
}

function assetsRefusal(err) {
  const message = `${err && err.message ? err.message : ''}`
  const hint = err && err.hint ? ` ${err.hint}` : ''
  const c = err && err.constraint
  if (c === 'uq_asset_category_code') return { status: 409, error: 'duplicate', message: 'That category code is already in use.' }
  if (c === 'asset_category_depreciable_is_complete') return { status: 400, error: 'category_incomplete', message: 'A depreciated category needs its accumulated-depreciation account, its expense account and a useful life.' }
  if (c === 'fixed_asset_residual_in_range') return { status: 400, error: 'bad_residual', message: 'The residual value must be less than the cost.' }
  if (c === 'fixed_asset_opening_in_range') return { status: 400, error: 'bad_opening', message: 'Depreciation already charged cannot exceed the cost less the residual value.' }
  if (c === 'fixed_asset_start_not_before_acquired') return { status: 400, error: 'bad_start', message: 'Depreciation cannot start before the asset was acquired.' }
  if (c === 'voucher_prepared_and_posted_differ' || /must be posted by somebody else/.test(message)) {
    return { status: 409, error: 'separation_of_duties', message: 'Whoever raised this cannot approve it. Approval must come from someone else.' }
  }
  if (/has already been run/.test(message)) return { status: 409, error: 'already_run', message: message + hint }
  if (/accepts no postings|falls outside period|no accounting period/.test(message)) return { status: 409, error: 'period_not_open', message: message + hint }
  if (err && ['23514', '23503', '23502'].includes(err.code)) return { status: 409, error: 'refused', message: message + hint }
  return null
}

async function financeAssetsRoutes(fastify) {
  const pg = fastify.pg
  const can = (code) => ({ preHandler: requirePermission(fastify, `finance.assets.${code}`) })

  const refuse = (reply, err, fallback) => {
    const mapped = assetsRefusal(err)
    if (mapped) return fail(reply, mapped.status, mapped.error, mapped.message)
    fastify.log.error({ err }, fallback)
    return fail(reply, 500, 'assets_error', fallback)
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

  // ═══ Categories ═════════════════════════════════════════════════════════════════════════════

  const CATEGORY = `c.id, c.code, c.name, c.method, c.useful_life_months, c.residual_pct::text AS residual_pct, c.status,
    c.asset_account_id, aa.code AS asset_account_code, aa.name AS asset_account_name,
    c.accumulated_account_id, da.code AS accumulated_account_code, da.name AS accumulated_account_name,
    c.expense_account_id, ea.code AS expense_account_code, ea.name AS expense_account_name`
  const CATEGORY_FROM = `FROM finance.asset_category c
    JOIN finance.ledger_account aa ON aa.id = c.asset_account_id
    LEFT JOIN finance.ledger_account da ON da.id = c.accumulated_account_id
    LEFT JOIN finance.ledger_account ea ON ea.id = c.expense_account_id`

  /**
   * Categories, each with the register's totals beside the ledger's balances on its accounts, per
   * currency: the two are kept by different documents and a difference between them is shown.
   */
  fastify.get('/finance/assets/categories', can('view'), async (request, reply) => {
    const [categories, compare, accounts] = await Promise.all([
      pg.query(`SELECT ${CATEGORY} ${CATEGORY_FROM} ORDER BY c.code`),
      pg.query(
        `WITH reg AS (
           SELECT r.category_id, r.currency::text AS currency, count(*)::int AS assets,
                  sum(r.cost) AS cost, sum(r.accumulated) AS accumulated
             FROM finance.v_asset_register r WHERE r.status <> 'disposed' GROUP BY r.category_id, r.currency
         ), bal AS (
           SELECT ledger_account_id, currency::text AS currency, net_debit FROM finance.v_account_balance
         ), keys AS (
           SELECT category_id, currency FROM reg
           UNION SELECT c.id, b.currency FROM finance.asset_category c JOIN bal b ON b.ledger_account_id IN (c.asset_account_id, c.accumulated_account_id)
         )
         SELECT k.category_id, k.currency, COALESCE(g.assets, 0) AS assets,
                COALESCE(g.cost, 0)::numeric(18,2)::text AS register_cost, COALESCE(ab.net_debit, 0)::numeric(18,2)::text AS ledger_cost,
                (COALESCE(g.cost, 0) - COALESCE(ab.net_debit, 0))::numeric(18,2)::text AS cost_difference,
                COALESCE(g.accumulated, 0)::numeric(18,2)::text AS register_accumulated, COALESCE(-db.net_debit, 0)::numeric(18,2)::text AS ledger_accumulated,
                (COALESCE(g.accumulated, 0) - COALESCE(-db.net_debit, 0))::numeric(18,2)::text AS accumulated_difference,
                (COALESCE(g.cost, 0) = COALESCE(ab.net_debit, 0) AND COALESCE(g.accumulated, 0) = COALESCE(-db.net_debit, 0)) AS agrees
           FROM keys k
           JOIN finance.asset_category c ON c.id = k.category_id
           LEFT JOIN reg g ON g.category_id = k.category_id AND g.currency = k.currency
           LEFT JOIN bal ab ON ab.ledger_account_id = c.asset_account_id AND ab.currency = k.currency
           LEFT JOIN bal db ON db.ledger_account_id = c.accumulated_account_id AND db.currency = k.currency
          ORDER BY c.code, k.currency`),
      pg.query(
        `SELECT id, code, name, root_type, account_type FROM finance.ledger_account
          WHERE deleted_at IS NULL AND status = 'active' AND is_postable AND NOT is_group ORDER BY code`),
    ])
    return ok(reply, { categories: categories.rows, comparison: compare.rows, accounts: accounts.rows })
  })

  const categoryBody = {
    type: 'object', additionalProperties: false,
    properties: {
      code: { type: 'string', minLength: 1, maxLength: 30 }, name: { type: 'string', minLength: 2, maxLength: 160 },
      asset_account_id: uuid, accumulated_account_id: uuid, expense_account_id: uuid,
      method: { type: 'string', enum: ['straight_line', 'none'] },
      useful_life_months: { type: 'integer', minimum: 1, maximum: 1200 },
      residual_pct: { type: 'number', minimum: 0, maximum: 99.99 }, status: { type: 'string', enum: ['active', 'inactive'] },
    },
  }
  fastify.post('/finance/assets/categories', {
    ...can('manage'), schema: { body: { ...categoryBody, required: ['code', 'name', 'asset_account_id', 'method'] } },
  }, async (request, reply) => {
    const b = request.body
    const depreciated = b.method === 'straight_line'
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.asset_category
           (code, name, asset_account_id, accumulated_account_id, expense_account_id, method, useful_life_months, residual_pct, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [normaliseCode(b.code), b.name.trim(), b.asset_account_id, b.accumulated_account_id || null,
          depreciated ? b.expense_account_id || null : null, b.method, depreciated ? b.useful_life_months || null : null,
          depreciated ? b.residual_pct || 0 : 0, request.user.id])
      return ok(reply, { id: rows[0].id }, 201)
    } catch (err) {
      return refuse(reply, err, 'The category could not be saved.')
    }
  })

  fastify.patch('/finance/assets/categories/:id', { ...can('manage'), schema: { params: idParams, body: categoryBody } }, async (request, reply) => {
    const b = request.body
    try {
      const { rowCount } = await pg.query(
        `UPDATE finance.asset_category SET
            name = COALESCE($2, name), asset_account_id = COALESCE($3, asset_account_id),
            accumulated_account_id = COALESCE($4, accumulated_account_id), expense_account_id = COALESCE($5, expense_account_id),
            method = COALESCE($6, method), useful_life_months = COALESCE($7, useful_life_months),
            residual_pct = COALESCE($8, residual_pct), status = COALESCE($9, status)
          WHERE id = $1`,
        [request.params.id, b.name ? b.name.trim() : null, b.asset_account_id || null, b.accumulated_account_id || null,
          b.expense_account_id || null, b.method || null, b.useful_life_months || null,
          b.residual_pct === undefined ? null : b.residual_pct, b.status || null])
      if (!rowCount) return fail(reply, 404, 'not_found', 'No such category.')
      return ok(reply, { updated: true })
    } catch (err) {
      return refuse(reply, err, 'The category could not be saved.')
    }
  })

  // ═══ The register ═══════════════════════════════════════════════════════════════════════════

  const ASSET = `r.id, r.asset_no, r.name, r.description, r.category_id, r.category_code, r.category_name, r.method, r.currency,
    r.cost::text AS cost, r.residual_value::text AS residual_value, r.accumulated_opening::text AS accumulated_opening,
    r.useful_life_months, ${dateText('r', 'acquired_on', 'depreciation_start', 'disposed_on')}, r.serial_no, r.location, r.custodian,
    r.department_id, d.name AS department_name, r.charged::text AS charged, r.charged_in_draft::text AS charged_in_draft,
    r.accumulated::text AS accumulated, r.carrying_amount::text AS carrying_amount, r.status,
    r.disposal_proceeds::text AS disposal_proceeds, r.disposal_note, r.disposal_voucher_id,
    dv.voucher_no AS disposal_voucher_no, dv.prepared_by AS disposal_prepared_by`

  fastify.get('/finance/assets', {
    ...can('view'),
    schema: {
      querystring: {
        type: 'object',
        properties: {
          category_id: uuid, q: { type: 'string', maxLength: 120 },
          status: { type: 'string', enum: ['in_use', 'fully_depreciated', 'not_depreciated', 'disposed', 'disposal_awaiting_approval'] },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 200 }, offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const where = `WHERE ($1::uuid IS NULL OR r.category_id = $1) AND ($2::text IS NULL OR r.status = $2)
        AND ($3::text IS NULL OR r.name ILIKE $3 OR r.asset_no ILIKE $3 OR r.serial_no ILIKE $3 OR r.location ILIKE $3 OR r.custodian ILIKE $3)`
    const params = [q.category_id || null, q.status || null, q.q ? `%${q.q.trim()}%` : null]
    const [page, totals] = await Promise.all([
      pg.query(
        `SELECT ${ASSET} FROM finance.v_asset_register r
           LEFT JOIN finance.department d ON d.id = r.department_id
           LEFT JOIN finance.voucher dv ON dv.id = r.disposal_voucher_id
           ${where} ORDER BY r.asset_no LIMIT $4 OFFSET $5`, [...params, q.limit, q.offset]),
      pg.query(
        `SELECT r.currency, count(*)::int AS assets, sum(r.cost)::text AS cost, sum(r.accumulated)::text AS accumulated,
                sum(r.carrying_amount)::text AS carrying_amount
           FROM finance.v_asset_register r ${where} AND r.status <> 'disposed' GROUP BY r.currency ORDER BY r.currency`, params),
    ])
    return ok(reply, { assets: page.rows, totals: totals.rows })
  })

  const assetBody = {
    type: 'object', additionalProperties: false,
    properties: {
      name: { type: 'string', minLength: 2, maxLength: 200 }, description: { type: 'string', maxLength: 2000 },
      category_id: uuid, currency, cost: money, residual_value: money, accumulated_opening: money,
      acquired_on: isoDate, depreciation_start: isoDate, useful_life_months: { type: 'integer', minimum: 1, maximum: 1200 },
      serial_no: { type: 'string', maxLength: 120 }, location: { type: 'string', maxLength: 200 },
      custodian: { type: 'string', maxLength: 200 }, department_id: uuid,
    },
  }

  fastify.post('/finance/assets', {
    ...can('manage'), schema: { body: { ...assetBody, required: ['name', 'category_id', 'currency', 'cost', 'acquired_on'] } },
  }, async (request, reply) => {
    const b = request.body
    const cost = amount(b.cost)
    const residualGiven = b.residual_value !== undefined && b.residual_value !== ''
    const residual = amount(b.residual_value)
    const opening = amount(b.accumulated_opening)
    if (!cost || /^0+(\.0+)?$/.test(cost)) return fail(reply, 400, 'bad_cost', 'The cost must be a positive amount.')
    if (residual === null || opening === null) return fail(reply, 400, 'bad_amount', 'An amount on this asset cannot be read.')
    try {
      const out = await transact(async (db) => {
        const { rows } = await db.query(
          `INSERT INTO finance.fixed_asset
             (asset_no, name, description, category_id, currency, cost, residual_value, accumulated_opening, acquired_on,
              depreciation_start, useful_life_months, serial_no, location, custodian, department_id, created_by)
           SELECT finance.next_document_no(app.authority_id(), 'asset'), $1, $2, c.id, $4, $5::numeric,
                  -- The category's residual percentage applies when no residual value is given.
                  CASE WHEN $7 THEN $6::numeric ELSE round($5::numeric * c.residual_pct / 100, 2) END,
                  $8::numeric, $9::date, COALESCE($10::date, $9::date), $11, $12, $13, $14, $15, $16
             FROM finance.asset_category c WHERE c.id = $3 AND c.status = 'active'
           RETURNING id, asset_no`,
          [b.name.trim(), b.description || null, b.category_id, b.currency, cost, residual, residualGiven, opening,
            b.acquired_on, b.depreciation_start || null, b.useful_life_months || null, b.serial_no || null,
            b.location || null, b.custodian || null, b.department_id || null, request.user.id])
        return rows[0]
      })
      if (!out) return fail(reply, 400, 'unknown_category', 'Choose an active asset category.')
      return ok(reply, { ...out, note: 'Registered. Registering posts nothing: the cost is in the ledger through the document that bought the asset.' }, 201)
    } catch (err) {
      return refuse(reply, err, 'The asset could not be registered.')
    }
  })

  fastify.patch('/finance/assets/:id', { ...can('manage'), schema: { params: idParams, body: assetBody } }, async (request, reply) => {
    const b = request.body
    const figures = {}
    for (const key of ['cost', 'residual_value', 'accumulated_opening']) {
      if (b[key] === undefined) { figures[key] = null; continue }
      figures[key] = amount(b[key])
      if (figures[key] === null) return fail(reply, 400, 'bad_amount', 'An amount on this asset cannot be read.')
    }
    try {
      const { rowCount } = await pg.query(
        `UPDATE finance.fixed_asset SET
            name = COALESCE($2, name), description = COALESCE($3, description), category_id = COALESCE($4, category_id),
            cost = COALESCE($5::numeric, cost), residual_value = COALESCE($6::numeric, residual_value),
            accumulated_opening = COALESCE($7::numeric, accumulated_opening), acquired_on = COALESCE($8::date, acquired_on),
            depreciation_start = COALESCE($9::date, depreciation_start), useful_life_months = COALESCE($10, useful_life_months),
            serial_no = COALESCE($11, serial_no), location = COALESCE($12, location), custodian = COALESCE($13, custodian),
            department_id = COALESCE($14, department_id), updated_at = now()
          WHERE id = $1`,
        [request.params.id, b.name ? b.name.trim() : null, b.description ?? null, b.category_id || null, figures.cost,
          figures.residual_value, figures.accumulated_opening, b.acquired_on || null, b.depreciation_start || null,
          b.useful_life_months || null, b.serial_no ?? null, b.location ?? null, b.custodian ?? null, b.department_id || null])
      if (!rowCount) return fail(reply, 404, 'not_found', 'No such asset.')
      return ok(reply, { updated: true })
    } catch (err) {
      return refuse(reply, err, 'The asset could not be saved.')
    }
  })

  // ═══ Depreciation runs ══════════════════════════════════════════════════════════════════════

  fastify.get('/finance/assets/runs', {
    ...can('view'), schema: { querystring: { type: 'object', properties: { financial_year_id: uuid } } },
  }, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT r.id, r.run_no, r.currency, r.ledger_period_id, lp.period_no, lp.label AS period_label,
              ${dateText('r', 'period_from', 'period_to')}, r.total::text AS total, r.voucher_id, r.prepared_by,
              (SELECT count(*)::int FROM finance.depreciation_charge dc WHERE dc.run_id = r.id) AS assets,
              CASE WHEN v.status = 'draft' THEN 'awaiting_approval' WHEN finance.voucher_stands(v.id) THEN 'approved' ELSE 'reversed' END AS status,
              (SELECT u.full_name FROM public.users u WHERE u.id = r.prepared_by) AS prepared_by_name,
              (SELECT u.full_name FROM public.users u WHERE u.id = v.posted_by) AS approved_by_name
         FROM finance.depreciation_run r JOIN finance.voucher v ON v.id = r.voucher_id
         JOIN finance.ledger_period lp ON lp.id = r.ledger_period_id
        WHERE ($1::uuid IS NULL OR r.financial_year_id = $1) ORDER BY r.period_to DESC, r.run_no DESC LIMIT 200`,
      [request.query.financial_year_id || null])
    return ok(reply, { runs: rows })
  })

  fastify.get('/finance/assets/runs/:id', { ...can('view'), schema: { params: idParams } }, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT a.asset_no, a.name, c.name AS category_name, dc.amount::text AS amount
         FROM finance.depreciation_charge dc JOIN finance.fixed_asset a ON a.id = dc.asset_id
         JOIN finance.asset_category c ON c.id = a.category_id
        WHERE dc.run_id = $1 ORDER BY a.asset_no`, [request.params.id])
    return ok(reply, { charges: rows })
  })

  fastify.post('/finance/assets/runs', {
    ...can('manage'),
    schema: { body: { type: 'object', additionalProperties: false, required: ['ledger_period_id', 'currency'], properties: { ledger_period_id: uuid, currency } } },
  }, async (request, reply) => {
    try {
      const id = await transact(async (db) => (await db.query(
        'SELECT finance.run_depreciation($1, $2, $3) AS id', [request.body.ledger_period_id, request.body.currency, request.user.id])).rows[0].id)
      return ok(reply, { id, note: 'The run is a draft. It charges nothing until somebody other than you approves it.' }, 201)
    } catch (err) {
      return refuse(reply, err, 'Depreciation could not be run.')
    }
  })

  /** Approve = post the voucher behind a run or a disposal. Never by whoever raised it. */
  const approveVoucher = async (request, reply, voucherId, label) => {
    const { rows } = await pg.query('SELECT prepared_by FROM finance.voucher WHERE id = $1', [voucherId])
    if (!rows[0]) return fail(reply, 404, 'not_found', `No such ${label}.`)
    if (rows[0].prepared_by === request.user.id) {
      return fail(reply, 409, 'separation_of_duties', `You raised this ${label}, so approving it is not yours to do. Approval must come from someone else.`)
    }
    try {
      await transact((db) => db.query('SELECT finance.post_voucher($1, $2)', [voucherId, request.user.id]))
      return ok(reply, { approved: true, note: 'Approved and posted. A posted document is corrected by a reversal, never edited.' })
    } catch (err) {
      return refuse(reply, err, `The ${label} could not be approved.`)
    }
  }

  fastify.post('/finance/assets/runs/:id/approve', { ...can('approve'), schema: { params: idParams } }, async (request, reply) => {
    const { rows } = await pg.query('SELECT voucher_id FROM finance.depreciation_run WHERE id = $1', [request.params.id])
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such depreciation run.')
    return approveVoucher(request, reply, rows[0].voucher_id, 'depreciation run')
  })

  fastify.delete('/finance/assets/runs/:id', { ...can('manage'), schema: { params: idParams } }, async (request, reply) => {
    try {
      const no = await transact(async (db) => (await db.query('SELECT finance.discard_depreciation_run($1) AS no', [request.params.id])).rows[0].no)
      return ok(reply, { discarded: no })
    } catch (err) {
      return refuse(reply, err, 'The run could not be discarded.')
    }
  })

  // ═══ Disposals ══════════════════════════════════════════════════════════════════════════════

  fastify.post('/finance/assets/:id/dispose', {
    ...can('manage'),
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['disposed_on', 'note'],
        properties: {
          disposed_on: isoDate, proceeds: money, proceeds_account_id: uuid, gain_loss_account_id: uuid,
          note: { type: 'string', minLength: 3, maxLength: 1000 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const proceeds = amount(b.proceeds)
    if (proceeds === null) return fail(reply, 400, 'bad_amount', 'The proceeds cannot be read as an amount.')
    try {
      await transact((db) => db.query('SELECT finance.dispose_asset($1, $2::date, $3::numeric, $4, $5, $6, $7)',
        [request.params.id, b.disposed_on, proceeds, b.proceeds_account_id || null, b.gain_loss_account_id || null, b.note, request.user.id]))
      return ok(reply, { note: 'The disposal is a draft. The asset stays on the register until somebody other than you approves it.' }, 201)
    } catch (err) {
      return refuse(reply, err, 'The disposal could not be raised.')
    }
  })

  fastify.post('/finance/assets/:id/disposal/approve', { ...can('approve'), schema: { params: idParams } }, async (request, reply) => {
    const { rows } = await pg.query('SELECT disposal_voucher_id FROM finance.fixed_asset WHERE id = $1', [request.params.id])
    if (!rows[0] || !rows[0].disposal_voucher_id) return fail(reply, 404, 'not_found', 'This asset has no disposal awaiting approval.')
    return approveVoucher(request, reply, rows[0].disposal_voucher_id, 'disposal')
  })

  fastify.delete('/finance/assets/:id/disposal', { ...can('manage'), schema: { params: idParams } }, async (request, reply) => {
    try {
      await transact((db) => db.query('SELECT finance.withdraw_asset_disposal($1)', [request.params.id]))
      return ok(reply, { withdrawn: true })
    } catch (err) {
      return refuse(reply, err, 'The disposal could not be withdrawn.')
    }
  })
}

module.exports = { financeAssetsRoutes, assetsRefusal }
