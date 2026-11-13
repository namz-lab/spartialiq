/**
 * Bank reconciliation: a bank statement matched against the cashbook.
 *
 * Tables and functions: migration 212 (finance.bank_statement, finance.bank_statement_line,
 * finance.bank_match, finance.bank_match_entry, finance.match_bank_items(),
 * finance.auto_match_bank_statement(), finance.bank_reconciliation_summary(),
 * finance.complete_bank_reconciliation()).
 * Design: docs/superpowers/specs/2026-11-13-accountant-full-system-design.md §4 (frontend repo).
 *
 * The cashbook is finance.ledger_entry on a bank account; nothing here writes to it. A statement
 * line the cashbook does not have is journalled through the ledger routes (prepared by one person,
 * posted by another) and then matched. The equality of a match, and the three checks a completed
 * reconciliation passes, are the database's. No money arithmetic happens in this file.
 */

const crypto = require('node:crypto')
const { requirePermission } = require('../middleware/financePermissions')
const { readTabular } = require('../lib/spreadsheet')
const { parseMoney, parseDate, normaliseHeader, resolveColumns, str, dateText } = require('../lib/finance')
const { scanBuffer } = require('../services/malwareScan')

const uuid = { type: 'string', format: 'uuid' }
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } }
const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

/** The columns of a statement, with the headings banks' exports commonly use. */
const STATEMENT_FIELDS = [
  { key: 'txn_date', label: 'Date', aliases: ['Date', 'Transaction Date', 'Txn Date', 'Posting Date', 'Value Date', 'Trans Date', 'Entry Date'] },
  { key: 'description', label: 'Description', aliases: ['Description', 'Narration', 'Details', 'Transaction Details', 'Particulars', 'Narrative', 'Transaction Description'] },
  { key: 'reference', label: 'Reference', aliases: ['Reference', 'Ref', 'Reference Number', 'Cheque No', 'Cheque Number', 'Transaction Reference', 'Ref No'] },
  { key: 'money_in', label: 'Money in (the bank\'s credit column)', aliases: ['Credit', 'Credits', 'Money In', 'Deposits', 'Deposit', 'Cr', 'Credit Amount', 'Paid In'] },
  { key: 'money_out', label: 'Money out (the bank\'s debit column)', aliases: ['Debit', 'Debits', 'Money Out', 'Withdrawals', 'Withdrawal', 'Dr', 'Debit Amount', 'Paid Out'] },
  { key: 'amount', label: 'Amount (money out negative)', aliases: ['Amount', 'Transaction Amount', 'Value'] },
]
const REQUIRED = [['txn_date'], ['amount', 'money_in', 'money_out']]

const negate = (money) => (money.startsWith('-') ? money.slice(1) : `-${money}`)
const isNil = (money) => /^-?0+(\.0+)?$/.test(money)
const blank = (v) => v === undefined || v === null || String(v).trim() === ''

/**
 * Read a statement's rows into lines. PURE. Returns `{ lines, problems }`; any problem refuses the
 * whole file, because a statement with a line left out cannot be reconciled.
 *
 * A row with a description and no amount (an "opening balance" or "balance brought forward" row)
 * is skipped; so is a wholly blank one.
 */
function readStatementRows(headers, rows, columnMap) {
  const index = (field) => {
    const header = columnMap[field]
    return header ? headers.findIndex((h) => normaliseHeader(h) === normaliseHeader(header)) : -1
  }
  const at = Object.fromEntries(STATEMENT_FIELDS.map((f) => [f.key, index(f.key)]))
  const get = (row, field) => (at[field] < 0 ? undefined : row[at[field]])
  const lines = []
  const problems = []
  rows.forEach((row, i) => {
    const rowNo = i + 1
    const amounts = {}
    for (const field of ['amount', 'money_in', 'money_out']) {
      const raw = get(row, field)
      if (blank(raw)) continue
      const parsed = parseMoney(typeof raw === 'number' ? raw : String(raw))
      if (!parsed.ok) { problems.push(`Row ${rowNo}: the ${field.replace('_', ' ')} figure cannot be read as an amount.`); return }
      if (!isNil(parsed.value)) amounts[field] = parsed.value
    }
    let amount = null
    if (amounts.money_in && amounts.money_out) {
      problems.push(`Row ${rowNo}: carries both money in and money out.`); return
    } else if (amounts.money_in) amount = amounts.money_in.startsWith('-') ? amounts.money_in : amounts.money_in
    else if (amounts.money_out) amount = amounts.money_out.startsWith('-') ? amounts.money_out : negate(amounts.money_out)
    else if (amounts.amount) amount = amounts.amount
    if (amount === null) return
    const rawDate = get(row, 'txn_date')
    const date = blank(rawDate) ? { ok: false } : parseDate(rawDate instanceof Date ? rawDate : String(rawDate))
    if (!date.ok) { problems.push(`Row ${rowNo}: has an amount and no readable date. Dates are read day first (31/03/2026) or as 2026-03-31.`); return }
    lines.push({
      line_no: lines.length + 1, txn_date: date.value, amount,
      description: blank(get(row, 'description')) ? null : String(get(row, 'description')).trim().slice(0, 500),
      reference: blank(get(row, 'reference')) ? null : String(get(row, 'reference')).trim().slice(0, 120),
    })
  })
  return { lines, problems }
}

function bankRefusal(err) {
  const message = `${err && err.message ? err.message : ''}`
  const hint = err && err.hint ? ` ${err.hint}` : ''
  if (/a match must be equal/.test(message)) return { status: 409, error: 'match_not_equal', message: message + hint }
  if (/already matched|not on this statement|not in this bank account/.test(message)) return { status: 409, error: 'item_not_available', message }
  if (/does not add up/.test(message)) return { status: 409, error: 'statement_incomplete', message: message + hint }
  if (/are not matched to the cashbook/.test(message)) return { status: 409, error: 'lines_unmatched', message: message + hint }
  if (/statement closes at/.test(message)) return { status: 409, error: 'balances_disagree', message: message + hint }
  if (/can no longer be changed|is already/.test(message)) return { status: 409, error: 'statement_closed', message: message + hint }
  if (err && err.constraint === 'uq_bank_statement_file') return { status: 409, error: 'already_imported', message: 'This exact file has already been imported for this bank account.' }
  if (err && ['23514', '23503'].includes(err.code)) return { status: 409, error: 'refused', message: message + hint }
  return null
}

async function financeBankRoutes(fastify) {
  const pg = fastify.pg
  const canView = { preHandler: requirePermission(fastify, 'finance.bank.view') }
  const canReconcile = { preHandler: requirePermission(fastify, 'finance.bank.reconcile') }

  const refuse = (reply, err, fallback) => {
    const mapped = bankRefusal(err)
    if (mapped) return fail(reply, mapped.status, mapped.error, mapped.message)
    fastify.log.error({ err }, fallback)
    return fail(reply, 500, 'bank_error', fallback)
  }
  const transact = async (work) => {
    const client = await pg.connect()
    try {
      await client.query('BEGIN')
      const out = await work(client)
      await client.query('COMMIT')
      return out
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      throw err
    } finally {
      client.release()
    }
  }

  const STATEMENT = `s.id, s.bank_account_id, la.code AS account_code, la.name AS account_name, s.currency,
    s.statement_ref, ${dateText('s', 'from_date', 'to_date')}, s.opening_balance::text AS opening_balance,
    s.closing_balance::text AS closing_balance, s.original_filename, s.status, s.imported_at, s.reconciled_at,
    s.cancel_reason, s.summary,
    (SELECT u.full_name FROM public.users u WHERE u.id = s.imported_by) AS imported_by_name,
    (SELECT u.full_name FROM public.users u WHERE u.id = s.reconciled_by) AS reconciled_by_name`

  const summaryOf = async (db, id) => {
    const { rows } = await db.query(
      `SELECT lines_total, lines_unmatched, statement_movement::text AS statement_movement,
              file_difference::text AS file_difference, (file_difference = 0) AS file_adds_up,
              cashbook_balance::text AS cashbook_balance, deposits_in_transit::text AS deposits_in_transit,
              unpresented_payments::text AS unpresented_payments, adjusted_cashbook::text AS adjusted_cashbook,
              difference::text AS difference, (difference = 0) AS agrees
         FROM finance.bank_reconciliation_summary($1)`, [id])
    return rows[0]
  }

  /** Bank accounts in the chart, with each currency's cashbook balance and where reconciliation stands. */
  fastify.get('/finance/bank/accounts', canView, async (request, reply) => {
    const { rows } = await pg.query(
      `WITH book AS (
         SELECT e.ledger_account_id, e.currency, sum(e.debit - e.credit) AS balance, max(e.posting_date) AS last_entry,
                count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM finance.bank_match_entry x WHERE x.ledger_entry_id = e.id))::int AS unmatched_entries
           FROM finance.ledger_entry e
           JOIN finance.ledger_account la ON la.id = e.ledger_account_id AND la.account_type = 'bank'
          GROUP BY e.ledger_account_id, e.currency
       ), keys AS (
         SELECT ledger_account_id, currency::text AS currency FROM book
         UNION SELECT bank_account_id, currency::text FROM finance.bank_statement WHERE status <> 'cancelled'
       )
       SELECT la.id, la.code, la.name, k.currency, COALESCE(b.balance, 0)::text AS cashbook_balance,
              b.last_entry::text AS last_entry, COALESCE(b.unmatched_entries, 0) AS unmatched_entries,
              r.to_date::text AS reconciled_to, r.closing_balance::text AS reconciled_balance,
              (SELECT count(*)::int FROM finance.bank_statement o
                WHERE o.bank_account_id = la.id AND o.currency::text = k.currency AND o.status = 'open') AS open_statements
         FROM keys k
         JOIN finance.ledger_account la ON la.id = k.ledger_account_id
         LEFT JOIN book b ON b.ledger_account_id = la.id AND b.currency::text = k.currency
         LEFT JOIN LATERAL (
           SELECT s.to_date, s.closing_balance FROM finance.bank_statement s
            WHERE s.bank_account_id = la.id AND s.currency::text = k.currency AND s.status = 'reconciled'
            ORDER BY s.to_date DESC LIMIT 1) r ON true
        ORDER BY la.code, k.currency`)
    const { rows: all } = await pg.query(
      `SELECT id, code, name FROM finance.ledger_account
        WHERE account_type = 'bank' AND deleted_at IS NULL AND is_postable AND status = 'active' ORDER BY code`)
    return ok(reply, { positions: rows, bank_accounts: all, fields: STATEMENT_FIELDS.map(({ key, label }) => ({ key, label })) })
  })

  fastify.get('/finance/bank/statements', {
    ...canView,
    schema: { querystring: { type: 'object', properties: { bank_account_id: uuid, status: { type: 'string', enum: ['open', 'reconciled', 'cancelled'] } } } },
  }, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT ${STATEMENT},
              (SELECT count(*)::int FROM finance.bank_statement_line l WHERE l.statement_id = s.id) AS lines_total,
              (SELECT count(*)::int FROM finance.bank_statement_line l WHERE l.statement_id = s.id AND l.match_id IS NULL) AS lines_unmatched
         FROM finance.bank_statement s JOIN finance.ledger_account la ON la.id = s.bank_account_id
        WHERE ($1::uuid IS NULL OR s.bank_account_id = $1) AND ($2::text IS NULL OR s.status = $2)
        ORDER BY (s.status = 'open') DESC, s.to_date DESC, s.imported_at DESC LIMIT 200`,
      [request.query.bank_account_id || null, request.query.status || null])
    return ok(reply, { statements: rows })
  })

  /**
   * Import a statement. multipart/form-data: `file`, `bank_account_id`, `currency`,
   * `opening_balance`, `closing_balance`, and optionally `statement_ref` and `column_map` (JSON of
   * field → the file's column heading). When a needed column cannot be found the answer is a 409
   * carrying the file's headings, so the screen can ask and send the file again.
   */
  fastify.post('/finance/bank/statements', canReconcile, async (request, reply) => {
    if (!request.isMultipart()) return fail(reply, 415, 'expected_multipart', 'Send the statement as multipart/form-data.')
    let file = null
    const fields = {}
    try {
      for await (const part of request.parts({ limits: { fileSize: 20971520, files: 1, fields: 20 } })) {
        if (part.type === 'file') {
          const buf = await part.toBuffer()
          if (!file) file = { filename: part.filename || 'statement', mimetype: part.mimetype || '', buffer: buf }
        } else fields[part.fieldname] = part.value
      }
    } catch (err) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') return fail(reply, 413, 'file_too_large', 'The file is larger than 20 MB.')
      throw err
    }
    if (!file || file.buffer.length === 0) return fail(reply, 400, 'no_file', 'No file was received.')
    if (!['USD', 'ZWG'].includes(fields.currency)) return fail(reply, 400, 'missing_currency', 'Say which currency this statement is in.')
    const balances = {}
    for (const key of ['opening_balance', 'closing_balance']) {
      const parsed = blank(fields[key]) ? { ok: false } : parseMoney(String(fields[key]))
      if (!parsed.ok) return fail(reply, 400, `bad_${key}`, `Give the statement's ${key.replace('_', ' ')} as printed on it. An overdrawn balance is negative.`)
      balances[key] = parsed.value
    }
    const { rows: account } = await pg.query(
      `SELECT id, code, name, account_type FROM finance.ledger_account WHERE id = $1 AND deleted_at IS NULL`,
      [str(fields.bank_account_id, 64)])
    if (!account[0] || account[0].account_type !== 'bank') return fail(reply, 400, 'bad_bank_account', 'Choose a bank account from the chart of accounts.')

    const scan = await scanBuffer(file.buffer, { mime: file.mimetype, log: request.log })
    if (!scan.clean) return fail(reply, 422, 'malware_detected', 'This file failed a security scan and was not accepted.')
    let parsed
    try {
      parsed = await readTabular(file.buffer, file.filename, { maxRows: 50000 })
    } catch (err) {
      return fail(reply, 400, err.message || 'unreadable_file',
        err.message === 'legacy_xls_not_supported' ? 'This is an old binary .xls file. Save it as .xlsx or .csv and upload it again.' : 'The file could not be read as a spreadsheet or CSV.')
    }
    let supplied = {}
    if (fields.column_map) {
      try { supplied = JSON.parse(fields.column_map) } catch { return fail(reply, 400, 'bad_column_map', 'column_map must be JSON.') }
    }
    const { resolved } = resolveColumns(Object.fromEntries(STATEMENT_FIELDS.map((f) => [f.key, f.aliases])), parsed.headers, supplied)
    const columnMap = Object.fromEntries(Object.entries(resolved).map(([k, hit]) => [k, hit.header]))
    // A single signed amount column and separate in/out columns are alternatives; in/out wins.
    if (columnMap.money_in || columnMap.money_out) delete columnMap.amount
    const missing = REQUIRED.filter((group) => !group.some((f) => columnMap[f]))
    if (missing.length) {
      return fail(reply, 409, 'columns_not_mapped',
        'Say which columns of the file hold the date and the amounts.', { headers: parsed.headers, column_map: columnMap })
    }
    const { lines, problems } = readStatementRows(parsed.headers, parsed.rows, columnMap)
    if (problems.length) {
      return fail(reply, 400, 'unreadable_rows',
        `${problems.length} row(s) of the statement cannot be read, so nothing was imported. ${problems.slice(0, 3).join(' ')}`,
        { problems: problems.slice(0, 50), headers: parsed.headers, column_map: columnMap })
    }
    if (lines.length === 0) return fail(reply, 400, 'no_lines', 'The file holds no transactions.')

    try {
      const id = await transact(async (db) => {
        const { rows } = await db.query(
          `INSERT INTO finance.bank_statement
             (bank_account_id, currency, statement_ref, from_date, to_date, opening_balance, closing_balance,
              original_filename, file_hash, imported_by)
           SELECT $1, $2, $3, min(x.txn_date), max(x.txn_date), $4::numeric, $5::numeric, $6, $7, $8
             FROM jsonb_to_recordset($9::jsonb) AS x(txn_date date)
           RETURNING id`,
          [account[0].id, fields.currency, str(fields.statement_ref, 120), balances.opening_balance, balances.closing_balance,
            String(file.filename).slice(0, 255), crypto.createHash('sha256').update(file.buffer).digest('hex'),
            request.user.id, JSON.stringify(lines)])
        await db.query(
          `INSERT INTO finance.bank_statement_line (statement_id, line_no, txn_date, description, reference, amount)
           SELECT $1, x.line_no, x.txn_date, x.description, x.reference, x.amount
             FROM jsonb_to_recordset($2::jsonb) AS x(line_no int, txn_date date, description text, reference text, amount numeric)`,
          [rows[0].id, JSON.stringify(lines)])
        return rows[0].id
      })
      return ok(reply, { id, lines: lines.length, summary: await summaryOf(pg, id) }, 201)
    } catch (err) {
      return refuse(reply, err, 'The statement could not be imported.')
    }
  })

  fastify.get('/finance/bank/statements/:id', { ...canView, schema: { params: idParams } }, async (request, reply) => {
    const { rows: head } = await pg.query(
      `SELECT ${STATEMENT} FROM finance.bank_statement s JOIN finance.ledger_account la ON la.id = s.bank_account_id WHERE s.id = $1`,
      [request.params.id])
    if (!head[0]) return fail(reply, 404, 'not_found', 'No such bank statement.')
    const s = head[0]
    const ENTRY = `e.id, e.voucher_id, e.voucher_no, e.voucher_type, ${dateText('e', 'posting_date')}, e.narration,
      v.reference, (e.debit - e.credit)::text AS amount, p.name AS party_name`
    const [lines, cashbook, matched, summary] = await Promise.all([
      pg.query(
        `SELECT l.id, l.line_no, ${dateText('l', 'txn_date')}, l.description, l.reference, l.amount::text AS amount, l.match_id
           FROM finance.bank_statement_line l WHERE l.statement_id = $1 ORDER BY l.line_no`, [s.id]),
      // What the cashbook holds that no statement has ticked off, up to a week past this one.
      pg.query(
        `SELECT ${ENTRY}, (e.posting_date > $4::date) AS after_statement
           FROM finance.ledger_entry e JOIN finance.voucher v ON v.id = e.voucher_id
           LEFT JOIN finance.party p ON p.id = e.party_id
          WHERE e.ledger_account_id = $1 AND e.currency = $2 AND e.posting_date <= $4::date + 7
            AND NOT EXISTS (SELECT 1 FROM finance.bank_match_entry x WHERE x.ledger_entry_id = e.id)
          ORDER BY e.posting_date, e.voucher_no LIMIT $3`, [s.bank_account_id, s.currency, 2000, s.to_date]),
      pg.query(
        `SELECT m.id AS match_id, m.method, m.matched_at, (SELECT u.full_name FROM public.users u WHERE u.id = m.matched_by) AS matched_by_name,
                ${ENTRY}
           FROM finance.bank_match m
           JOIN finance.bank_match_entry me ON me.match_id = m.id
           JOIN finance.ledger_entry e ON e.id = me.ledger_entry_id
           JOIN finance.voucher v ON v.id = e.voucher_id
           LEFT JOIN finance.party p ON p.id = e.party_id
          WHERE m.statement_id = $1 ORDER BY m.matched_at, e.posting_date`, [s.id]),
      summaryOf(pg, s.id),
    ])
    return ok(reply, { statement: s, summary, lines: lines.rows, cashbook: cashbook.rows, matched_entries: matched.rows })
  })

  fastify.post('/finance/bank/statements/:id/auto-match', { ...canReconcile, schema: { params: idParams } }, async (request, reply) => {
    try {
      const matched = await transact(async (db) =>
        (await db.query('SELECT finance.auto_match_bank_statement($1, $2) AS n', [request.params.id, request.user.id])).rows[0].n)
      return ok(reply, {
        matched,
        note: matched
          ? `${matched} line(s) matched. Only lines with exactly one possible cashbook entry are matched this way; the rest are yours to match.`
          : 'Nothing could be matched without a choice between candidates. Match the remaining lines by hand.',
        summary: await summaryOf(pg, request.params.id),
      })
    } catch (err) {
      return refuse(reply, err, 'The statement could not be matched.')
    }
  })

  fastify.post('/finance/bank/statements/:id/matches', {
    ...canReconcile,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['entry_ids'],
        properties: {
          line_ids: { type: 'array', maxItems: 500, items: uuid },
          entry_ids: { type: 'array', minItems: 1, maxItems: 500, items: uuid },
        },
      },
    },
  }, async (request, reply) => {
    try {
      const id = await transact(async (db) => (await db.query(
        'SELECT finance.match_bank_items($1, $2::uuid[], $3::uuid[], $4) AS id',
        [request.params.id, request.body.line_ids || [], request.body.entry_ids, request.user.id])).rows[0].id)
      return ok(reply, { match_id: id, summary: await summaryOf(pg, request.params.id) }, 201)
    } catch (err) {
      return refuse(reply, err, 'The match could not be recorded.')
    }
  })

  fastify.delete('/finance/bank/matches/:id', { ...canReconcile, schema: { params: idParams } }, async (request, reply) => {
    try {
      const { rows } = await pg.query('DELETE FROM finance.bank_match WHERE id = $1 RETURNING statement_id', [request.params.id])
      if (!rows[0]) return fail(reply, 404, 'not_found', 'No such match.')
      return ok(reply, { unmatched: true, summary: await summaryOf(pg, rows[0].statement_id) })
    } catch (err) {
      return refuse(reply, err, 'The match could not be undone.')
    }
  })

  fastify.post('/finance/bank/statements/:id/complete', { ...canReconcile, schema: { params: idParams } }, async (request, reply) => {
    try {
      const summary = await transact(async (db) => (await db.query(
        'SELECT finance.complete_bank_reconciliation($1, $2) AS summary', [request.params.id, request.user.id])).rows[0].summary)
      return ok(reply, { reconciled: true, summary, note: 'Reconciled. The statement and its matches are now closed.' })
    } catch (err) {
      return refuse(reply, err, 'The reconciliation could not be completed.')
    }
  })

  fastify.post('/finance/bank/statements/:id/cancel', {
    ...canReconcile,
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', minLength: 3, maxLength: 1000 } } },
    },
  }, async (request, reply) => {
    try {
      const done = await transact(async (db) => {
        // Matches go first, while the statement is still open, so its cashbook entries are free again.
        const { rowCount } = await db.query(`SELECT 1 FROM finance.bank_statement WHERE id = $1 AND status = 'open' FOR UPDATE`, [request.params.id])
        if (!rowCount) return false
        await db.query('DELETE FROM finance.bank_match WHERE statement_id = $1', [request.params.id])
        await db.query(
          `UPDATE finance.bank_statement SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3 WHERE id = $1`,
          [request.params.id, request.user.id, request.body.reason.trim()])
        return true
      })
      if (!done) return fail(reply, 409, 'statement_closed', 'Only an open statement can be cancelled.')
      return ok(reply, { cancelled: true })
    } catch (err) {
      return refuse(reply, err, 'The statement could not be cancelled.')
    }
  })
}

module.exports = { financeBankRoutes, readStatementRows, bankRefusal, STATEMENT_FIELDS }
