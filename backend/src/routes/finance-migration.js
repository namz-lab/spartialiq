/**
 * Cut-over from the Council's previous accounting package (Pastel, Sage, Promun).
 *
 * Tables and functions: migration 211 (finance.cutover, finance.migration_batch,
 * finance.migration_row, finance.account_code_map, finance.party_source_map,
 * finance.cutover_reconciliation[_line], and the commit, reconciliation and sign-off functions).
 * Row reading: src/lib/financeMigration.js. Source layouts: src/config/migrationProfiles.js.
 * Design: docs/superpowers/specs/2026-11-13-accountant-full-system-design.md §3 (frontend repo).
 *
 * THE FLOW, PER FILE
 *   upload → the original bytes are kept and hashed, the columns are matched to fields
 *   check  → every row becomes ready, a problem for a person, or set aside with a reason
 *   decide → a person settles each problem; nothing is guessed on their behalf
 *   commit → a database function writes the data, or refuses the whole file
 *   post   → opening vouchers are posted by somebody other than whoever loaded them
 *
 * THIS ROUTE IS NOT WHERE THE RULES LIVE
 * What may be written, the balance of the opening position, the agreement of open items with their
 * control account, and the refusal to sign off over an unexplained difference are all in migration
 * 211. This file reads files, keeps a person's decisions, and makes the database's refusals
 * legible. The same four rules as the ledger routes apply: no money arithmetic in JavaScript, no
 * figure across two currencies, no period arithmetic of its own, and nothing written to
 * finance.ledger_entry except through finance.post_voucher().
 */

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const { requirePermission } = require('../middleware/financePermissions')
const { readTabular } = require('../lib/spreadsheet')
const { parseMoney, normaliseCode, normaliseHeader, resolveColumns, str, dateText } = require('../lib/finance')
const { scanBuffer } = require('../services/malwareScan')
const { SOURCE_SYSTEMS, LOADS } = require('../config/migrationProfiles')
const reader = require('../lib/financeMigration')

const MIGRATION_ROOT = process.env.FINANCE_IMPORT_ROOT
  ? path.resolve(process.env.FINANCE_IMPORT_ROOT, 'cutover')
  : path.resolve(__dirname, '../../uploads/finance-imports/cutover')

const LOAD_KINDS = Object.keys(LOADS)
const BALANCE_KINDS = ['opening_balance', 'open_items', 'comparison_balance']
const uuid = { type: 'string', format: 'uuid' }
const idParams = { type: 'object', required: ['id'], properties: { id: uuid } }
const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

const UNREADABLE = {
  legacy_xls_not_supported: 'This is an old binary .xls file. Save it as .xlsx or .csv and upload it again.',
  not_a_valid_xlsx: 'The file is named .xlsx but its contents are not a valid workbook.',
  empty_file: 'The file is empty.',
  file_too_large: 'The file is too large to read.',
  not_an_xlsx_workbook: 'The workbook could not be read.',
  workbook_has_no_sheets: 'The workbook contains no worksheets.',
  workbook_has_no_worksheet_part: 'The workbook contains no readable worksheet.',
}

/** The blank file a council fills in when its package cannot export a list in a usable layout. */
const TEMPLATES = {
  chart: [['Account Number', 'Description', 'Financial Category', 'Heading'],
    ['1000', 'Land and buildings', 'Fixed Assets', ''], ['8400', 'Bank - CBZ current account', 'Bank', '']],
  parties: [['Account Number', 'Name', 'Contact', 'Telephone', 'Email', 'Address 1', 'Address 2', 'Address 3'],
    ['MOY001', 'Moyo Hardware (Pvt) Ltd', 'T. Moyo', '+263 54 222 000', 'accounts@example.co.zw', '12 Main Street', 'Gweru', '']],
  opening_balance: [['Account Number', 'Description', 'Debit', 'Credit'],
    ['8400', 'Bank - CBZ current account', '15230.50', ''], ['5000', 'Accumulated surplus', '', '15230.50']],
  open_items: [['Account Number', 'Document No', 'Document Date', 'Description', 'Outstanding'],
    ['MOY001', 'INV-00418', '14/03/2026', 'Refuse collection, March', '120.00']],
}
TEMPLATES.comparison_balance = TEMPLATES.opening_balance

const csvCell = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v)

/** Turn a refusal raised by migration 211 into an answer a person can act on. */
function migrationRefusal(err) {
  const message = `${err && err.message ? err.message : ''}`
  const hint = err && err.hint ? ` ${err.hint}` : ''
  if (/does not balance/.test(message)) return { status: 409, error: 'trial_balance_does_not_balance', message: message + hint }
  if (/control total given/.test(message)) return { status: 409, error: 'control_total_mismatch', message: message + hint }
  if (/open items total/.test(message)) return { status: 409, error: 'open_items_disagree_with_control', message: message + hint }
  if (/still need a decision/.test(message)) return { status: 409, error: 'rows_need_decision', message: message + hint }
  if (/signed off by somebody who did not load it|must be posted by somebody else/.test(message)
      || (err && err.constraint === 'cutover_signer_is_not_its_author')) {
    return { status: 409, error: 'separation_of_duties', message: /signed off/.test(message) ? message + hint : 'You loaded these vouchers, so posting them is not yours to do. Posting must come from someone else.' }
  }
  if (/cannot be signed off/.test(message)) return { status: 409, error: 'cutover_not_ready', message: message + hint }
  if (/can no longer be changed|is already/.test(message)) return { status: 409, error: 'cutover_closed', message: message + hint }
  if (/accepts no postings|falls outside period|no accounting period/.test(message)) return { status: 409, error: 'period_not_open', message: message + hint }
  if (err && err.constraint === 'uq_cutover_in_progress') {
    return { status: 409, error: 'cutover_in_progress', message: 'A cut-over is already being prepared. Finish or abandon it before starting another.' }
  }
  if (err && ['uq_migration_batch_one_opening', 'uq_migration_batch_one_item_list', 'uq_migration_batch_committed_file'].includes(err.constraint)) {
    return { status: 409, error: 'already_loaded', message: 'This load has already been committed for this cut-over. Withdraw the earlier one before loading it again.' }
  }
  if (err && err.constraint === 'uq_ledger_account_code') return { status: 409, error: 'duplicate_account', message: 'An account number in this file is already in the chart of accounts. Check the file again.' }
  if (err && err.constraint === 'uq_party_reference') return { status: 409, error: 'duplicate_party', message: 'An account number in this file is already in the party register. Check the file again.' }
  if (err && ['23514', '23503', '23502'].includes(err.code)) return { status: 409, error: 'refused', message: message + hint }
  return null
}

async function financeMigrationRoutes(fastify) {
  const pg = fastify.pg
  const canView = { preHandler: requirePermission(fastify, 'finance.migration.view') }
  const canPrepare = { preHandler: requirePermission(fastify, 'finance.migration.prepare') }
  const canSignOff = { preHandler: requirePermission(fastify, 'finance.migration.signoff') }
  const canPost = { preHandler: requirePermission(fastify, 'finance.ledger.voucher.post') }

  const refuse = (reply, err, fallback) => {
    const mapped = migrationRefusal(err)
    if (mapped) return fail(reply, mapped.status, mapped.error, mapped.message)
    fastify.log.error({ err }, fallback)
    return fail(reply, 500, 'migration_error', fallback)
  }

  /** Run one statement group in a transaction, with the deferred ledger checks forced inside it. */
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

  const BATCH_COLUMNS = `b.id, b.cutover_id, b.load_kind, b.currency, b.item_side, b.control_account_id,
    ${dateText('b', 'as_at')}, b.original_filename, b.file_hash, b.file_size_bytes, b.headers, b.column_map,
    b.options, b.status, b.rows_total, b.rows_ready, b.rows_problem, b.rows_set_aside,
    b.total_debit::text AS total_debit, b.total_credit::text AS total_credit,
    b.declared_total::text AS declared_total, b.uploaded_by, b.uploaded_at, b.validated_at,
    b.committed_by, b.committed_at, b.withdrawn_at, b.withdraw_reason, b.result,
    (SELECT u.full_name FROM public.users u WHERE u.id = b.uploaded_by) AS uploaded_by_name,
    (SELECT u.full_name FROM public.users u WHERE u.id = b.committed_by) AS committed_by_name,
    (SELECT count(*)::int FROM finance.migration_voucher mv JOIN finance.voucher v ON v.id = mv.voucher_id
      WHERE mv.batch_id = b.id AND v.status = 'draft') AS vouchers_draft,
    (SELECT count(*)::int FROM finance.migration_voucher mv JOIN finance.voucher v ON v.id = mv.voucher_id
      WHERE mv.batch_id = b.id AND v.status = 'posted') AS vouchers_posted,
    (SELECT r.id FROM finance.cutover_reconciliation r WHERE r.batch_id = b.id) AS reconciliation_id`

  const batchOf = async (db, id) => {
    const { rows } = await db.query(`SELECT ${BATCH_COLUMNS} FROM finance.migration_batch b WHERE b.id = $1`, [id])
    return rows[0] || null
  }

  const describe = (batch) => ({
    ...batch,
    fields: LOADS[batch.load_kind].fields.map(({ key, label }) => ({ key, label })),
    required: LOADS[batch.load_kind].required,
  })

  /** Which required field groups have no column, as sentences. Empty when the mapping will do. */
  const missingColumns = (batch) => LOADS[batch.load_kind].required
    .filter((group) => !group.some((f) => batch.column_map[f]))
    .map((group) => group.map((f) => LOADS[batch.load_kind].fields.find((x) => x.key === f).label).join(' or '))

  // ═══ Reference ══════════════════════════════════════════════════════════════════════════════

  fastify.get('/finance/migration/profiles', canView, async (request, reply) => ok(reply, {
    source_systems: SOURCE_SYSTEMS,
    loads: LOAD_KINDS.map((key) => ({
      key, label: LOADS[key].label, required: LOADS[key].required,
      fields: LOADS[key].fields.map(({ key: k, label }) => ({ key: k, label })),
    })),
    root_types: reader.ROOT_TYPES,
    account_types: reader.ACCOUNT_TYPES,
  }))

  fastify.get('/finance/migration/templates/:kind', {
    ...canView,
    schema: { params: { type: 'object', required: ['kind'], properties: { kind: { type: 'string', enum: LOAD_KINDS } } } },
  }, async (request, reply) => {
    const body = TEMPLATES[request.params.kind].map((line) => line.map(csvCell).join(',')).join('\r\n')
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="cutover-${request.params.kind.replace(/_/g, '-')}-template.csv"`)
      .send(`${body}\r\n`)
  })

  // ═══ The cut-over ═══════════════════════════════════════════════════════════════════════════

  const CUTOVER_COLUMNS = `c.id, c.name, c.source_system, c.source_version, ${dateText('c', 'cutover_date')},
    c.financial_year_id, y.label AS financial_year_label, c.status, c.signed_off_by, c.signed_off_at,
    c.sign_off_note, c.abandoned_at, c.abandon_reason, c.created_by, c.created_at,
    (SELECT u.full_name FROM public.users u WHERE u.id = c.created_by) AS created_by_name,
    (SELECT u.full_name FROM public.users u WHERE u.id = c.signed_off_by) AS signed_off_by_name`

  fastify.get('/finance/migration/cutovers', canView, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT ${CUTOVER_COLUMNS} FROM finance.cutover c
         JOIN finance.financial_year y ON y.id = c.financial_year_id
        ORDER BY (c.status = 'preparing') DESC, c.created_at DESC`)
    return ok(reply, { cutovers: rows })
  })

  fastify.post('/finance/migration/cutovers', {
    ...canPrepare,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        required: ['name', 'source_system', 'cutover_date', 'financial_year_id'],
        properties: {
          name: { type: 'string', minLength: 3, maxLength: 160 },
          source_system: { type: 'string', enum: SOURCE_SYSTEMS.map((s) => s.key) },
          source_version: { type: 'string', maxLength: 80 },
          cutover_date: { type: 'string', format: 'date' },
          financial_year_id: uuid,
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    const { rows: year } = await pg.query(
      `SELECT id, label, status, ${dateText(null, 'start_date', 'end_date')}
         FROM finance.financial_year WHERE id = $1 AND deleted_at IS NULL`, [b.financial_year_id])
    if (!year[0]) return fail(reply, 400, 'unknown_financial_year', 'No such financial year.')
    if (b.cutover_date < year[0].start_date || b.cutover_date > year[0].end_date) {
      return fail(reply, 400, 'date_outside_year',
        `The cut-over date must fall inside ${year[0].label} (${year[0].start_date} to ${year[0].end_date}).`)
    }
    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.cutover (name, source_system, source_version, cutover_date, financial_year_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
        [b.name.trim(), b.source_system, b.source_version || null, b.cutover_date, b.financial_year_id, request.user.id])
      return ok(reply, { id: rows[0].id }, 201)
    } catch (err) {
      return refuse(reply, err, 'The cut-over could not be started.')
    }
  })

  fastify.get('/finance/migration/cutovers/:id', { ...canView, schema: { params: idParams } }, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT ${CUTOVER_COLUMNS} FROM finance.cutover c
         JOIN finance.financial_year y ON y.id = c.financial_year_id WHERE c.id = $1`, [request.params.id])
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such cut-over.')
    const [batches, readiness, reconciliations, periods] = await Promise.all([
      pg.query(`SELECT ${BATCH_COLUMNS} FROM finance.migration_batch b WHERE b.cutover_id = $1 ORDER BY b.uploaded_at`, [request.params.id]),
      pg.query('SELECT check_key, passed, blocking, detail FROM finance.cutover_readiness($1)', [request.params.id]),
      pg.query(
        `SELECT r.id, r.batch_id, r.kind, r.currency, ${dateText('r', 'as_at')}, r.refreshed_at,
                count(l.*)::int AS lines,
                count(l.*) FILTER (WHERE l.difference <> 0)::int AS differences,
                count(l.*) FILTER (WHERE l.difference <> 0 AND l.explanation IS NULL)::int AS unexplained
           FROM finance.cutover_reconciliation r
           LEFT JOIN finance.cutover_reconciliation_line l ON l.reconciliation_id = r.id
          WHERE r.cutover_id = $1 GROUP BY r.id ORDER BY r.currency, r.as_at`, [request.params.id]),
      pg.query(
        `SELECT p.period_no, p.label, p.status FROM finance.ledger_period p
          WHERE p.financial_year_id = $1 AND $2::date BETWEEN p.from_date AND p.to_date`,
        [rows[0].financial_year_id, rows[0].cutover_date]),
    ])
    return ok(reply, {
      cutover: rows[0],
      batches: batches.rows.map(describe),
      readiness: readiness.rows,
      reconciliations: reconciliations.rows,
      // The opening vouchers post on the cut-over date, so its period must exist and be open.
      opening_period: periods.rows[0] || null,
    })
  })

  fastify.post('/finance/migration/cutovers/:id/sign-off', {
    ...canSignOff,
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, properties: { note: { type: 'string', maxLength: 2000 } } },
    },
  }, async (request, reply) => {
    try {
      await transact((db) => db.query('SELECT finance.sign_off_cutover($1, $2, $3)',
        [request.params.id, request.user.id, (request.body && request.body.note) || null]))
      return ok(reply, {
        signed_off: true,
        note: 'The cut-over is signed off. Its files, account mapping and reconciliation are now closed and kept as evidence.',
      })
    } catch (err) {
      return refuse(reply, err, 'The cut-over could not be signed off.')
    }
  })

  fastify.post('/finance/migration/cutovers/:id/abandon', {
    ...canPrepare,
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', minLength: 3, maxLength: 2000 } } },
    },
  }, async (request, reply) => {
    const { rows: live } = await pg.query(
      `SELECT count(*)::int AS n FROM finance.migration_batch b
         JOIN finance.migration_voucher mv ON mv.batch_id = b.id
         JOIN finance.voucher v ON v.id = mv.voucher_id
        WHERE b.cutover_id = $1 AND b.status = 'committed'`, [request.params.id])
    if (live[0].n > 0) {
      return fail(reply, 409, 'vouchers_outstanding',
        'This cut-over has raised opening vouchers. Withdraw each balance load first, so no voucher is left without the cut-over it belongs to.')
    }
    const { rowCount } = await pg.query(
      `UPDATE finance.cutover SET status = 'abandoned', abandoned_by = $2, abandoned_at = now(), abandon_reason = $3
        WHERE id = $1 AND status = 'preparing'`, [request.params.id, request.user.id, request.body.reason.trim()])
    if (!rowCount) return fail(reply, 409, 'cutover_closed', 'Only a cut-over still being prepared can be abandoned.')
    return ok(reply, { abandoned: true })
  })

  // ═══ Files ══════════════════════════════════════════════════════════════════════════════════

  /**
   * Upload one file. multipart/form-data: `file`, `load_kind`, and for the balance loads
   * `currency`; for open items `item_side` and `control_account_id`; for a comparison `as_at`.
   * `has_header=false` for an export with no heading row (several of Pastel Partner's).
   */
  fastify.post('/finance/migration/cutovers/:id/batches', { ...canPrepare, schema: { params: idParams } }, async (request, reply) => {
    if (!request.isMultipart()) {
      return fail(reply, 415, 'expected_multipart', 'Send the file as multipart/form-data with the field load_kind.')
    }
    let file = null
    const fields = {}
    try {
      for await (const part of request.parts({ limits: { fileSize: 52428800, files: 1, fields: 20 } })) {
        if (part.type === 'file') {
          const buf = await part.toBuffer()
          if (!file) file = { filename: part.filename || 'upload', mimetype: part.mimetype || '', buffer: buf }
        } else fields[part.fieldname] = part.value
      }
    } catch (err) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') return fail(reply, 413, 'file_too_large', 'The file is larger than 50 MB.')
      throw err
    }
    if (!file || file.buffer.length === 0) return fail(reply, 400, 'no_file', 'No file was received.')
    const kind = fields.load_kind
    if (!LOAD_KINDS.includes(kind)) return fail(reply, 400, 'bad_load_kind', `load_kind must be one of: ${LOAD_KINDS.join(', ')}`)

    const { rows: cut } = await pg.query(`SELECT id, status, source_system FROM finance.cutover WHERE id = $1`, [request.params.id])
    if (!cut[0]) return fail(reply, 404, 'not_found', 'No such cut-over.')
    if (cut[0].status !== 'preparing') return fail(reply, 409, 'cutover_closed', 'This cut-over is closed and takes no more files.')

    const currency = BALANCE_KINDS.includes(kind) ? str(fields.currency, 3) : null
    if (BALANCE_KINDS.includes(kind) && !['USD', 'ZWG'].includes(currency)) {
      return fail(reply, 400, 'missing_currency', 'Say which currency this file is in. Each currency is loaded from its own file, because each is its own book.')
    }
    let itemSide = null
    let controlAccountId = null
    if (kind === 'open_items') {
      itemSide = fields.item_side
      if (!['debtors', 'creditors'].includes(itemSide)) return fail(reply, 400, 'missing_side', 'Say whether these are debtors or creditors.')
      const { rows: acc } = await pg.query(
        `SELECT id, code, name, account_type FROM finance.ledger_account WHERE id = $1 AND deleted_at IS NULL`,
        [str(fields.control_account_id, 64)])
      const wanted = itemSide === 'debtors' ? 'receivable' : 'payable'
      if (!acc[0] || acc[0].account_type !== wanted) {
        return fail(reply, 400, 'bad_control_account', `Choose the ${wanted} control account these open items belong to.`)
      }
      controlAccountId = acc[0].id
    }
    const asAt = kind === 'comparison_balance' ? str(fields.as_at, 10) : null
    if (kind === 'comparison_balance' && !/^\d{4}-\d{2}-\d{2}$/.test(asAt || '')) {
      return fail(reply, 400, 'missing_as_at', 'Give the date the old package\'s trial balance was printed at.')
    }
    let declared = null
    if (fields.declared_total) {
      const parsed = parseMoney(fields.declared_total)
      if (!parsed.ok) return fail(reply, 400, 'bad_control_total', 'The control total cannot be read as an amount.')
      declared = parsed.value
    }

    const scan = await scanBuffer(file.buffer, { mime: file.mimetype, log: request.log })
    if (!scan.clean) {
      request.log.warn({ signature: scan.signature, userId: request.user.id }, 'rejected infected cut-over file')
      return fail(reply, 422, 'malware_detected', 'This file failed a security scan and was not accepted.')
    }

    let parsed
    try {
      parsed = await readTabular(file.buffer, file.filename, { maxRows: 100000 })
    } catch (err) {
      return fail(reply, 400, err.message || 'unreadable_file', UNREADABLE[err.message] || `The file could not be read: ${err.message}`)
    }
    let headers = parsed.headers
    let dataRows = parsed.rows
    if (fields.has_header === 'false') {
      // The reader took the first line as headings; it is data. Put it back and name the columns.
      dataRows = [headers, ...dataRows]
      const width = dataRows.reduce((w, r) => Math.max(w, r.length), 0)
      headers = Array.from({ length: width }, (_, i) => `Column ${i + 1}`)
    }
    if (headers.length === 0 || headers.every((h) => h === '')) {
      return fail(reply, 400, 'no_header_row', 'The first row of the file carries no column names.')
    }
    if (dataRows.length === 0) return fail(reply, 400, 'no_rows', 'The file has a heading row and nothing under it.')

    const aliases = Object.fromEntries(LOADS[kind].fields.map((f) => [f.key, f.aliases]))
    const { resolved } = fields.has_header === 'false' ? { resolved: {} } : resolveColumns(aliases, headers)
    const columnMap = Object.fromEntries(Object.entries(resolved).map(([target, hit]) => [target, hit.header]))

    const options = {}
    if (kind === 'chart' && columnMap.category) {
      const index = headers.findIndex((h) => normaliseHeader(h) === normaliseHeader(columnMap.category))
      options.category_map = reader.suggestCategoryMap(dataRows.map((r) => r[index]))
    }
    if (kind === 'parties') {
      options.party_kind = fields.party_kind === 'supplier' ? 'supplier' : 'customer'
      options.party_type = fields.party_type === 'ratepayer' ? 'ratepayer' : 'debtor'
    }
    if (kind === 'open_items') options.item_side = itemSide
    options.has_header = fields.has_header !== 'false'

    const batchId = crypto.randomUUID()
    const dir = path.join(MIGRATION_ROOT, String(request.user.authority_id ?? 'unknown'))
    const objectKey = path.join(dir, `${batchId}${parsed.format === 'xlsx' ? '.xlsx' : '.csv'}`)
    await fs.mkdir(dir, { recursive: true, mode: 0o750 })
    await fs.writeFile(objectKey, file.buffer, { mode: 0o640 })

    try {
      await transact(async (db) => {
        await db.query(
          `INSERT INTO finance.migration_batch
             (id, cutover_id, load_kind, currency, item_side, control_account_id, as_at, original_filename,
              stored_object_key, file_hash, file_size_bytes, headers, column_map, options, rows_total,
              declared_total, uploaded_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15,$16::numeric,$17)`,
          [batchId, request.params.id, kind, currency, itemSide, controlAccountId, asAt,
            String(file.filename).slice(0, 255), objectKey,
            crypto.createHash('sha256').update(file.buffer).digest('hex'), file.buffer.length,
            JSON.stringify(headers), JSON.stringify(columnMap), JSON.stringify(options), dataRows.length,
            declared, request.user.id])
        for (let at = 0; at < dataRows.length; at += 5000) {
          await db.query(
            `INSERT INTO finance.migration_row (batch_id, row_no, raw)
             SELECT $1, $2 + t.ordinality, t.value
               FROM jsonb_array_elements($3::jsonb) WITH ORDINALITY t`,
            [batchId, at, JSON.stringify(dataRows.slice(at, at + 5000))])
        }
      })
    } catch (err) {
      await fs.unlink(objectKey).catch(() => {})
      return refuse(reply, err, 'The file could not be stored.')
    }
    return ok(reply, { batch: describe(await batchOf(pg, batchId)), truncated: parsed.truncated === true }, 201)
  })

  fastify.get('/finance/migration/batches/:id', { ...canView, schema: { params: idParams } }, async (request, reply) => {
    const batch = await batchOf(pg, request.params.id)
    if (!batch) return fail(reply, 404, 'not_found', 'No such file.')
    const { rows: sample } = await pg.query(
      'SELECT row_no, raw FROM finance.migration_row WHERE batch_id = $1 ORDER BY row_no LIMIT 5', [batch.id])
    return ok(reply, { batch: describe(batch), sample, missing_columns: missingColumns(batch) })
  })

  /** Confirm or correct which column feeds which field, and the load's options. Un-checks the file. */
  fastify.patch('/finance/migration/batches/:id', {
    ...canPrepare,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          column_map: { type: 'object', additionalProperties: { type: 'string', maxLength: 200 } },
          category_map: {
            type: 'object',
            additionalProperties: {
              type: 'object', additionalProperties: false,
              properties: {
                root_type: { type: 'string', enum: [...reader.ROOT_TYPES, ''] },
                account_type: { type: 'string', enum: [...reader.ACCOUNT_TYPES, ''] },
              },
            },
          },
          declared_total: { type: 'string', maxLength: 32 },
        },
      },
    },
  }, async (request, reply) => {
    const batch = await batchOf(pg, request.params.id)
    if (!batch) return fail(reply, 404, 'not_found', 'No such file.')
    if (!['uploaded', 'validated'].includes(batch.status)) {
      return fail(reply, 409, 'batch_closed', `This file is ${batch.status} and its mapping can no longer be changed.`)
    }
    const b = request.body
    const known = new Set(LOADS[batch.load_kind].fields.map((f) => f.key))
    const columnMap = { ...batch.column_map }
    for (const [target, header] of Object.entries(b.column_map || {})) {
      if (!known.has(target)) return fail(reply, 400, 'unknown_field', `${target} is not a field of this load.`)
      if (!header) { delete columnMap[target]; continue }
      const hit = batch.headers.find((h) => normaliseHeader(h) === normaliseHeader(header))
      if (!hit) return fail(reply, 400, 'unknown_column', `The file has no column headed "${header}".`)
      columnMap[target] = hit
    }
    const options = { ...batch.options }
    if (batch.load_kind === 'chart') {
      // Categories follow the category column: re-read them when that column changes, keeping
      // every class a person has already confirmed.
      let categoryMap = { ...(options.category_map || {}) }
      if (columnMap.category !== batch.column_map.category) {
        if (!columnMap.category) categoryMap = {}
        else {
          const index = batch.headers.findIndex((h) => normaliseHeader(h) === normaliseHeader(columnMap.category))
          const { rows } = await pg.query(
            'SELECT DISTINCT raw->>$2::int AS category FROM finance.migration_row WHERE batch_id = $1', [batch.id, index])
          categoryMap = { ...reader.suggestCategoryMap(rows.map((r) => r.category)), ...categoryMap }
        }
      }
      for (const [category, cls] of Object.entries(b.category_map || {})) {
        categoryMap[category] = { root_type: cls.root_type || null, account_type: cls.account_type || null, suggested: false }
      }
      options.category_map = categoryMap
    }
    let declared = batch.declared_total
    if (b.declared_total !== undefined) {
      if (b.declared_total === null || b.declared_total === '') declared = null
      else {
        const parsed = parseMoney(b.declared_total)
        if (!parsed.ok) return fail(reply, 400, 'bad_control_total', 'The control total cannot be read as an amount.')
        declared = parsed.value
      }
    }
    try {
      await pg.query(
        `UPDATE finance.migration_batch
            SET column_map = $2::jsonb, options = $3::jsonb, declared_total = $4::numeric, status = 'uploaded', validated_at = NULL
          WHERE id = $1`, [batch.id, JSON.stringify(columnMap), JSON.stringify(options), declared])
    } catch (err) {
      return refuse(reply, err, 'The mapping could not be saved.')
    }
    const updated = await batchOf(pg, batch.id)
    return ok(reply, { batch: describe(updated), missing_columns: missingColumns(updated) })
  })

  /** Read every row of a file against today's chart, register and mapping. Idempotent. */
  async function check(db, batch) {
    const { rows: cut } = await db.query(
      `SELECT ${dateText(null, 'cutover_date')} FROM finance.cutover WHERE id = $1`, [batch.cutover_id])
    const lookups = { seen: new Set() }
    const upper = (v) => normaliseCode(v).toUpperCase()

    if (batch.load_kind === 'chart') {
      const [accounts, mapped] = await Promise.all([
        db.query('SELECT id, code, name, is_group FROM finance.ledger_account WHERE deleted_at IS NULL'),
        db.query('SELECT source_code FROM finance.account_code_map WHERE cutover_id = $1', [batch.cutover_id]),
      ])
      lookups.accountsByCode = new Map(accounts.rows.map((a) => [upper(a.code), a]))
      lookups.accountsById = new Map(accounts.rows.map((a) => [a.id, a]))
      lookups.mappedCodes = new Set(mapped.rows.map((m) => upper(m.source_code)))
    } else if (batch.load_kind === 'parties') {
      const [parties, mapped] = await Promise.all([
        db.query('SELECT id, name, reference, party_type FROM finance.party WHERE deleted_at IS NULL'),
        db.query('SELECT source_kind, source_code FROM finance.party_source_map WHERE cutover_id = $1', [batch.cutover_id]),
      ])
      lookups.partiesById = new Map(parties.rows.map((p) => [p.id, p]))
      lookups.partiesByReference = new Map(parties.rows.filter((p) => p.reference).map((p) => [upper(p.reference), p]))
      lookups.partiesByName = new Map()
      for (const p of parties.rows) {
        const k = String(p.name).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()
        lookups.partiesByName.set(k, [...(lookups.partiesByName.get(k) || []), p])
      }
      lookups.mappedCodes = new Set(mapped.rows.map((m) => `${m.source_kind}:${upper(m.source_code)}`))
    } else if (batch.load_kind === 'open_items') {
      const { rows } = await db.query(
        `SELECT m.source_kind, m.source_code, m.party_id, p.name
           FROM finance.party_source_map m JOIN finance.party p ON p.id = m.party_id
          WHERE m.cutover_id = $1`, [batch.cutover_id])
      lookups.partyMap = new Map(rows.map((m) => [`${m.source_kind}:${upper(m.source_code)}`, m]))
    } else {
      const { rows } = await db.query(
        `SELECT m.source_code, m.disposition, m.ledger_account_id, la.code, la.name, la.status,
                (la.is_postable AND NOT la.is_group AND la.deleted_at IS NULL) AS is_postable
           FROM finance.account_code_map m LEFT JOIN finance.ledger_account la ON la.id = m.ledger_account_id
          WHERE m.cutover_id = $1`, [batch.cutover_id])
      lookups.codeMap = new Map(rows.map((m) => [upper(m.source_code), m]))
    }

    const read = {
      chart: reader.readChartRow,
      parties: reader.readPartyRow,
      opening_balance: reader.readBalanceRow,
      comparison_balance: reader.readBalanceRow,
      open_items: reader.readOpenItemRow,
    }[batch.load_kind]

    const { rows } = await db.query(
      'SELECT id, raw, decision FROM finance.migration_row WHERE batch_id = $1 ORDER BY row_no', [batch.id])
    const out = rows.map((row) => {
      const result = read({
        cells: row.raw, headers: batch.headers, columnMap: batch.column_map, options: batch.options,
        decision: row.decision || {}, lookups, cutoverDate: cut[0].cutover_date,
        allowSetAside: batch.load_kind === 'comparison_balance',
      })
      return { id: row.id, status: result.status, parsed: result.parsed, problems: result.problems }
    })
    for (let at = 0; at < out.length; at += 2000) {
      await db.query(
        `UPDATE finance.migration_row r SET status = x.status, parsed = x.parsed, problems = x.problems
           FROM jsonb_to_recordset($1::jsonb) AS x(id uuid, status text, parsed jsonb, problems jsonb)
          WHERE r.id = x.id`, [JSON.stringify(out.slice(at, at + 2000))])
    }
    await db.query(
      `UPDATE finance.migration_batch b
          SET status = 'validated', validated_at = now(),
              rows_ready = t.ready, rows_problem = t.problem, rows_set_aside = t.aside,
              total_debit = t.debit, total_credit = t.credit
         FROM (SELECT count(*) FILTER (WHERE status = 'ready')::int AS ready,
                      count(*) FILTER (WHERE status = 'problem')::int AS problem,
                      count(*) FILTER (WHERE status = 'set_aside')::int AS aside,
                      sum((parsed->>'debit')::numeric) FILTER (WHERE status = 'ready') AS debit,
                      sum((parsed->>'credit')::numeric) FILTER (WHERE status = 'ready') AS credit
                 FROM finance.migration_row WHERE batch_id = $1) t
        WHERE b.id = $1`, [batch.id])
  }

  fastify.post('/finance/migration/batches/:id/validate', { ...canPrepare, schema: { params: idParams } }, async (request, reply) => {
    const batch = await batchOf(pg, request.params.id)
    if (!batch) return fail(reply, 404, 'not_found', 'No such file.')
    if (!['uploaded', 'validated'].includes(batch.status)) {
      return fail(reply, 409, 'batch_closed', `This file is ${batch.status} and cannot be checked again.`)
    }
    const missing = missingColumns(batch)
    if (missing.length) {
      return fail(reply, 409, 'columns_not_mapped',
        `Say which column of the file holds: ${missing.join('; ')}.`, { missing_columns: missing })
    }
    try {
      await transact((db) => check(db, batch))
    } catch (err) {
      return refuse(reply, err, 'The file could not be checked.')
    }
    return ok(reply, { batch: describe(await batchOf(pg, batch.id)) })
  })

  fastify.get('/finance/migration/batches/:id/rows', {
    ...canView,
    schema: {
      params: idParams,
      querystring: {
        type: 'object',
        properties: {
          status: { type: 'string', enum: ['ready', 'problem', 'set_aside'] },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT r.id, r.row_no, r.raw, r.parsed, r.status, r.problems, r.decision, count(*) OVER()::int AS total
         FROM finance.migration_row r
        WHERE r.batch_id = $1 AND ($2::text IS NULL OR r.status = $2)
        ORDER BY r.row_no LIMIT $3 OFFSET $4`, [request.params.id, q.status || null, q.limit, q.offset])
    return ok(reply, { rows: rows.map(({ total, ...r }) => r), total: rows[0] ? rows[0].total : 0 })
  })

  /**
   * A person's decision about one or more rows, then the whole file is checked again.
   *
   * chart              { action: 'create', root_type, account_type?, new_code? } | { action: 'map',
   *                    ledger_account_id } | { action: 'set_aside', note }
   * parties            { action: 'create', reference? } | { action: 'map', party_id } |
   *                    { action: 'set_aside', note }
   * balances           { action: 'map', ledger_account_id }  — recorded in the account mapping,
   *                    so it holds for every later file; a comparison also takes set_aside + note
   * open_items         { action: 'map', party_id }           — recorded in the party mapping
   * any                { action: 'clear' } undoes an earlier decision
   */
  fastify.post('/finance/migration/batches/:id/decisions', {
    ...canPrepare,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['row_ids', 'decision'],
        properties: {
          row_ids: { type: 'array', minItems: 1, maxItems: 5000, items: uuid },
          decision: {
            type: 'object', additionalProperties: false, required: ['action'],
            properties: {
              action: { type: 'string', enum: ['create', 'map', 'set_aside', 'clear'] },
              root_type: { type: 'string', enum: reader.ROOT_TYPES },
              account_type: { type: 'string', enum: [...reader.ACCOUNT_TYPES, ''] },
              new_code: { type: 'string', maxLength: 60 },
              reference: { type: 'string', maxLength: 60 },
              ledger_account_id: uuid,
              party_id: uuid,
              note: { type: 'string', maxLength: 500 },
            },
          },
        },
      },
    },
  }, async (request, reply) => {
    const batch = await batchOf(pg, request.params.id)
    if (!batch) return fail(reply, 404, 'not_found', 'No such file.')
    if (!['uploaded', 'validated'].includes(batch.status)) {
      return fail(reply, 409, 'batch_closed', `This file is ${batch.status} and its rows can no longer be decided.`)
    }
    const { row_ids: rowIds, decision } = request.body
    const kind = batch.load_kind
    try {
      await transact(async (db) => {
        const { rows } = await db.query(
          'SELECT id, parsed FROM finance.migration_row WHERE batch_id = $1 AND id = ANY($2::uuid[])', [batch.id, rowIds])
        if (decision.action === 'map' && ['opening_balance', 'comparison_balance'].includes(kind)) {
          // The decision is about the old CODE, not this line: it goes in the permanent mapping.
          for (const row of rows) {
            if (!row.parsed.code) continue
            await db.query(
              `INSERT INTO finance.account_code_map
                 (cutover_id, source_code, source_name, disposition, ledger_account_id, note, batch_id, created_by)
               VALUES ($1,$2,$3,'mapped',$4,$5,$6,$7)
               ON CONFLICT (cutover_id, upper(source_code)) DO UPDATE
                 SET disposition = 'mapped', ledger_account_id = EXCLUDED.ledger_account_id,
                     note = COALESCE(EXCLUDED.note, finance.account_code_map.note),
                     updated_by = EXCLUDED.created_by, updated_at = now()`,
              [batch.cutover_id, row.parsed.code, row.parsed.name || null, decision.ledger_account_id,
                decision.note || null, batch.id, request.user.id])
          }
        } else if (decision.action === 'map' && kind === 'open_items') {
          for (const row of rows) {
            if (!row.parsed.party_code) continue
            await db.query(
              `INSERT INTO finance.party_source_map (cutover_id, source_kind, source_code, party_id, batch_id, created_by)
               VALUES ($1,$2,$3,$4,$5,$6)
               ON CONFLICT (cutover_id, source_kind, upper(source_code)) DO UPDATE SET party_id = EXCLUDED.party_id`,
              [batch.cutover_id, row.parsed.source_kind, row.parsed.party_code, decision.party_id, batch.id, request.user.id])
          }
        } else {
          const stored = decision.action === 'clear' ? {} : decision
          await db.query(
            `UPDATE finance.migration_row SET decision = $3::jsonb, decided_by = $4, decided_at = now()
              WHERE batch_id = $1 AND id = ANY($2::uuid[])`,
            [batch.id, rowIds, JSON.stringify(stored), request.user.id])
        }
        await check(db, await batchOf(db, batch.id))
      })
    } catch (err) {
      return refuse(reply, err, 'The decision could not be recorded.')
    }
    return ok(reply, { batch: describe(await batchOf(pg, batch.id)) })
  })

  fastify.post('/finance/migration/batches/:id/commit', { ...canPrepare, schema: { params: idParams } }, async (request, reply) => {
    const batch = await batchOf(pg, request.params.id)
    if (!batch) return fail(reply, 404, 'not_found', 'No such file.')
    const fn = {
      chart: 'commit_chart_batch', parties: 'commit_party_batch',
      opening_balance: 'commit_opening_balance_batch', open_items: 'commit_open_items_batch',
      comparison_balance: 'build_cutover_reconciliation',
    }[batch.load_kind]
    try {
      const result = await transact(async (db) => {
        // Checked again inside the commit's own transaction: the chart or the register may have
        // changed since a person last looked, and a commit must judge today's.
        if (batch.status === 'validated') await check(db, batch)
        const { rows } = await db.query(`SELECT finance.${fn}($1, $2) AS result`, [batch.id, request.user.id])
        return rows[0].result
      })
      const notes = {
        chart: 'The accounts are in the chart and every old number is in the mapping.',
        parties: 'The accounts are in the party register.',
        opening_balance: 'A draft opening voucher has been raised. It reaches the ledger when somebody other than you posts it.',
        open_items: 'A draft voucher has been raised for each open document. They reach the ledger when somebody other than you posts them, after the opening balance is posted.',
        comparison_balance: 'The reconciliation has been drawn up against the ledger at that date.',
      }
      return ok(reply, { batch: describe(await batchOf(pg, batch.id)), result, note: notes[batch.load_kind] })
    } catch (err) {
      return refuse(reply, err, 'The file could not be committed.')
    }
  })

  /** Post the draft vouchers a balance load raised. Never by whoever committed the load. */
  fastify.post('/finance/migration/batches/:id/post', { ...canPost, schema: { params: idParams } }, async (request, reply) => {
    const batch = await batchOf(pg, request.params.id)
    if (!batch) return fail(reply, 404, 'not_found', 'No such file.')
    if (batch.status !== 'committed') return fail(reply, 409, 'not_committed', 'Only a committed load has vouchers to post.')
    if (batch.committed_by === request.user.id) {
      return fail(reply, 409, 'separation_of_duties',
        'You loaded these opening vouchers, so posting them is not yours to do. Posting must come from someone else.')
    }
    try {
      const posted = await transact(async (db) => {
        const { rows } = await db.query(
          `SELECT count(finance.post_voucher(v.id, $2))::int AS n
             FROM (SELECT v.id FROM finance.migration_voucher mv JOIN finance.voucher v ON v.id = mv.voucher_id
                    WHERE mv.batch_id = $1 AND v.status = 'draft' ORDER BY v.voucher_no) v`,
          [batch.id, request.user.id])
        return rows[0].n
      })
      return ok(reply, {
        batch: describe(await batchOf(pg, batch.id)), posted,
        note: `${posted} opening voucher(s) posted. A posted entry is never amended; a correction is a reversal.`,
      })
    } catch (err) {
      if (/is draft and cannot be settled|cannot be settled/.test(err.message || '')) {
        return fail(reply, 409, 'opening_balance_not_posted',
          'Post the opening trial balance for this currency first. The open items are transferred out of it.')
      }
      return refuse(reply, err, 'The opening vouchers could not be posted.')
    }
  })

  fastify.post('/finance/migration/batches/:id/cancel', { ...canPrepare, schema: { params: idParams } }, async (request, reply) => {
    try {
      const { rowCount } = await pg.query(
        `UPDATE finance.migration_batch SET status = 'cancelled' WHERE id = $1 AND status IN ('uploaded', 'validated')`,
        [request.params.id])
      if (!rowCount) return fail(reply, 409, 'batch_closed', 'Only a file that has not been committed can be cancelled.')
      return ok(reply, { cancelled: true })
    } catch (err) {
      return refuse(reply, err, 'The file could not be cancelled.')
    }
  })

  fastify.post('/finance/migration/batches/:id/withdraw', {
    ...canPrepare,
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, required: ['reason'], properties: { reason: { type: 'string', minLength: 3, maxLength: 2000 } } },
    },
  }, async (request, reply) => {
    try {
      const dropped = await transact(async (db) => {
        const { rows } = await db.query('SELECT finance.withdraw_migration_batch($1, $2, $3) AS n',
          [request.params.id, request.user.id, request.body.reason])
        return rows[0].n
      })
      return ok(reply, { withdrawn: true, drafts_discarded: dropped })
    } catch (err) {
      return refuse(reply, err, 'The load could not be withdrawn.')
    }
  })

  // ═══ The account mapping ════════════════════════════════════════════════════════════════════

  fastify.get('/finance/migration/cutovers/:id/account-map', { ...canView, schema: { params: idParams } }, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT m.id, m.source_code, m.source_name, m.source_category, m.disposition, m.ledger_account_id,
              la.code AS account_code, la.name AS account_name, la.root_type, m.note
         FROM finance.account_code_map m LEFT JOIN finance.ledger_account la ON la.id = m.ledger_account_id
        WHERE m.cutover_id = $1 ORDER BY m.source_code`, [request.params.id])
    return ok(reply, { entries: rows })
  })

  fastify.patch('/finance/migration/account-map/:id', {
    ...canPrepare,
    schema: {
      params: idParams,
      body: {
        type: 'object', additionalProperties: false, required: ['disposition'],
        properties: {
          disposition: { type: 'string', enum: ['mapped', 'retired'] },
          ledger_account_id: uuid,
          note: { type: 'string', maxLength: 500 },
        },
      },
    },
  }, async (request, reply) => {
    const b = request.body
    if (b.disposition === 'mapped' && !b.ledger_account_id) return fail(reply, 400, 'missing_account', 'Choose the ledger account this code maps to.')
    if (b.disposition === 'retired' && (!b.note || b.note.trim().length < 3)) return fail(reply, 400, 'missing_reason', 'Retiring an old account needs a reason.')
    try {
      const { rowCount } = await pg.query(
        `UPDATE finance.account_code_map
            SET disposition = $2, ledger_account_id = $3, note = $4, updated_by = $5, updated_at = now()
          WHERE id = $1`,
        [request.params.id, b.disposition, b.disposition === 'mapped' ? b.ledger_account_id : null, b.note || null, request.user.id])
      if (!rowCount) return fail(reply, 404, 'not_found', 'No such mapping entry.')
      return ok(reply, { updated: true })
    } catch (err) {
      return refuse(reply, err, 'The mapping could not be changed.')
    }
  })

  // ═══ The reconciliation ═════════════════════════════════════════════════════════════════════

  /** Draw up (or redraw) the opening reconciliation from a committed opening trial balance. */
  fastify.post('/finance/migration/batches/:id/reconcile', { ...canPrepare, schema: { params: idParams } }, async (request, reply) => {
    try {
      const id = await transact(async (db) => {
        const { rows } = await db.query('SELECT finance.build_cutover_reconciliation($1, $2) AS id', [request.params.id, request.user.id])
        return rows[0].id
      })
      return ok(reply, { reconciliation_id: id }, 201)
    } catch (err) {
      return refuse(reply, err, 'The reconciliation could not be drawn up.')
    }
  })

  fastify.get('/finance/migration/reconciliations/:id', {
    ...canView,
    schema: { params: idParams, querystring: { type: 'object', properties: { only: { type: 'string', enum: ['differences'] } } } },
  }, async (request, reply) => {
    const { rows: head } = await pg.query(
      `SELECT r.id, r.cutover_id, r.batch_id, r.kind, r.currency, ${dateText('r', 'as_at')}, r.refreshed_at,
              b.original_filename
         FROM finance.cutover_reconciliation r JOIN finance.migration_batch b ON b.id = r.batch_id
        WHERE r.id = $1`, [request.params.id])
    if (!head[0]) return fail(reply, 404, 'not_found', 'No such reconciliation.')
    const [lines, totals] = await Promise.all([
      pg.query(
        `SELECT l.id, l.ledger_account_id, la.code AS account_code, la.name AS account_name, l.source_codes,
                l.source_net_debit::text AS source_net_debit, l.ledger_net_debit::text AS ledger_net_debit,
                l.difference::text AS difference, (l.difference <> 0) AS differs, l.explanation,
                (SELECT u.full_name FROM public.users u WHERE u.id = l.explained_by) AS explained_by_name, l.explained_at
           FROM finance.cutover_reconciliation_line l
           LEFT JOIN finance.ledger_account la ON la.id = l.ledger_account_id
          WHERE l.reconciliation_id = $1 AND ($2::boolean IS NOT TRUE OR l.difference <> 0)
          ORDER BY (l.difference <> 0) DESC, la.code NULLS FIRST, l.source_codes`,
        [request.params.id, request.query.only === 'differences']),
      pg.query(
        `SELECT count(*)::int AS lines,
                count(*) FILTER (WHERE difference <> 0)::int AS differences,
                count(*) FILTER (WHERE difference <> 0 AND explanation IS NULL)::int AS unexplained,
                COALESCE(sum(source_net_debit), 0)::text AS source_net, COALESCE(sum(ledger_net_debit), 0)::text AS ledger_net
           FROM finance.cutover_reconciliation_line WHERE reconciliation_id = $1`, [request.params.id]),
    ])
    return ok(reply, { reconciliation: head[0], lines: lines.rows, totals: totals.rows[0] })
  })

  fastify.post('/finance/migration/reconciliations/:id/refresh', { ...canPrepare, schema: { params: idParams } }, async (request, reply) => {
    try {
      const { rows } = await pg.query('SELECT finance.refresh_cutover_reconciliation($1) AS changed', [request.params.id])
      return ok(reply, { changed: rows[0].changed })
    } catch (err) {
      return refuse(reply, err, 'The reconciliation could not be refreshed.')
    }
  })

  fastify.patch('/finance/migration/reconciliation-lines/:id', {
    ...canPrepare,
    schema: {
      params: idParams,
      body: { type: 'object', additionalProperties: false, required: ['explanation'], properties: { explanation: { type: 'string', maxLength: 2000 } } },
    },
  }, async (request, reply) => {
    const explanation = request.body.explanation ? request.body.explanation.trim() : ''
    if (explanation && explanation.length < 3) return fail(reply, 400, 'explanation_too_short', 'An explanation says what the difference is.')
    try {
      const { rowCount } = await pg.query(
        `UPDATE finance.cutover_reconciliation_line
            SET explanation = $2, explained_by = CASE WHEN $2::text IS NULL THEN NULL ELSE $3::uuid END,
                explained_at = CASE WHEN $2::text IS NULL THEN NULL ELSE now() END
          WHERE id = $1`, [request.params.id, explanation || null, request.user.id])
      if (!rowCount) return fail(reply, 404, 'not_found', 'No such reconciliation line.')
      return ok(reply, { updated: true })
    } catch (err) {
      return refuse(reply, err, 'The explanation could not be saved.')
    }
  })
}

module.exports = { financeMigrationRoutes, migrationRefusal, TEMPLATES }
