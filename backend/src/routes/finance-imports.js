/**
 * The repeatable import: upload → map → validate → review exceptions → commit → reconcile.
 *
 * Tables: finance.import_batch, finance.import_row, finance.import_exception,
 * finance.column_mapping (migration 188). Readers: src/lib/spreadsheet.js. Primitives:
 * src/lib/finance.js.
 *
 * THE FIVE CONTROLS THIS FLOW EXISTS TO PROVIDE
 *
 * 1. THE ORIGINAL FILE IS KEPT, BYTE FOR BYTE, and its SHA-256 recorded on the batch. Everything
 *    downstream is derived; when a figure is questioned months later the file that produced it is
 *    still there to be re-read (specification §5.1).
 *
 * 2. VALIDATION IS SEPARATE FROM COMMIT, and commit needs a different permission from upload. A
 *    finance officer uploads and validates; committing is `finance.import.commit`, which the
 *    officer role does not hold. That is the "authorised review before committing a batch" of
 *    §3.8, expressed as a permission rather than as a convention.
 *
 * 3. AN UNMAPPABLE ROW GOES TO THE EXCEPTION QUEUE AND IS NEVER GUESSED AT. There is no default
 *    department, no default account and no fallback date anywhere in this file. §5.3 is explicit
 *    about this and it is the single easiest thing for an import to get quietly wrong: a thousand
 *    rows posted to "Miscellaneous" look like a successful import.
 *
 * 4. COMMIT IS IDEMPOTENT TWICE OVER. The caller's `idempotency_key` makes a retried HTTP request
 *    the same request; the unique index on (authority, source_system, source_ref) makes a row that
 *    is already in the register a skip rather than a duplicate; and the unique index on a committed
 *    file's hash means the same file cannot be committed twice for the same year and dataset at
 *    all. The whole commit is one transaction, so a failure half way leaves nothing behind.
 *
 * 5. RECONCILIATION IS AGAINST WHAT THE COUNCIL SAYS THE SOURCE TOTALS ARE, not against the file.
 *    Comparing a file with itself proves nothing; comparing it with the control total on the
 *    council's own report is what catches a truncated export (§6.5).
 */

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const { requirePermission, requireAnyPermission, financeSetting } = require('../middleware/financePermissions')
const { readTabular } = require('../lib/spreadsheet')
const { parseMoney, parseDate, normaliseCode, normaliseCurrency, resolveColumns, cell, str, dateText } = require('../lib/finance')
const { scanBuffer } = require('../services/malwareScan')

const IMPORT_ROOT = process.env.FINANCE_IMPORT_ROOT
  ? path.resolve(process.env.FINANCE_IMPORT_ROOT)
  : path.resolve(__dirname, '../../uploads/finance-imports')

const DATASETS = ['budget', 'actuals', 'commitments', 'projects']
const uuid = { type: 'string', format: 'uuid' }
const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message, extra = {}) =>
  reply.code(status).send({ success: false, error, message, ...extra })

/**
 * Which mapped fields each dataset cannot do without.
 *
 * Each entry is a group: at least one of its columns must be present. A dataset is refused at
 * MAPPING time when a group is unsatisfied, rather than producing one exception per row for a
 * fault that is the same fault on all of them.
 */
const REQUIRED_COLUMNS = {
  budget:      [['department_code'], ['account_code'], ['amount']],
  actuals:     [['department_code'], ['account_code'], ['amount'], ['txn_date']],
  commitments: [['account_code'], ['amount'], ['reference']],
  projects:    [['reference'], ['name']],
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true, mode: 0o750 })
}

/** The council's classification tables, keyed by code, for mapping a row without a query per row. */
async function loadLookups(pg, financialYearId) {
  const [departments, accounts, programmes, activities, lines, projects, wards] = await Promise.all([
    pg.query('SELECT id, code, status FROM finance.department WHERE deleted_at IS NULL'),
    pg.query('SELECT id, code, kind, is_postable, status FROM finance.account WHERE deleted_at IS NULL'),
    pg.query('SELECT id, code FROM finance.programme WHERE deleted_at IS NULL'),
    pg.query('SELECT id, code FROM finance.activity WHERE deleted_at IS NULL'),
    pg.query('SELECT id, code, currency, department_id, account_id FROM finance.budget_line WHERE financial_year_id = $1 AND deleted_at IS NULL', [financialYearId]),
    pg.query('SELECT id, reference FROM finance.project WHERE deleted_at IS NULL'),
    pg.query('SELECT ward_code AS code FROM admin.ward'),
  ]).catch(async (err) => {
    // admin.ward may be absent or unreadable in a given database; the ward dimension is optional
    // and its absence must not stop an import.
    if (/admin\.ward/.test(err.message || '')) {
      const base = await Promise.all([
        pg.query('SELECT id, code, status FROM finance.department WHERE deleted_at IS NULL'),
        pg.query('SELECT id, code, kind, is_postable, status FROM finance.account WHERE deleted_at IS NULL'),
        pg.query('SELECT id, code FROM finance.programme WHERE deleted_at IS NULL'),
        pg.query('SELECT id, code FROM finance.activity WHERE deleted_at IS NULL'),
        pg.query('SELECT id, code, currency, department_id, account_id FROM finance.budget_line WHERE financial_year_id = $1 AND deleted_at IS NULL', [financialYearId]),
        pg.query('SELECT id, reference FROM finance.project WHERE deleted_at IS NULL'),
      ])
      return [...base, { rows: [] }]
    }
    throw err
  })

  const index = (rows, key) => {
    const m = new Map()
    for (const r of rows) m.set(normaliseCode(r[key]).toUpperCase(), r)
    return m
  }
  return {
    departments: index(departments.rows, 'code'),
    accounts: index(accounts.rows, 'code'),
    programmes: index(programmes.rows, 'code'),
    activities: index(activities.rows, 'code'),
    lines: index(lines.rows, 'code'),
    projects: index(projects.rows, 'reference'),
    wards: index(wards.rows, 'code'),
  }
}

const lookup = (map, raw) => (raw === undefined || raw === null || String(raw).trim() === ''
  ? undefined
  : map.get(normaliseCode(raw).toUpperCase()))

/**
 * Turn one row of cells into the record a commit would write, or into a list of reasons it cannot
 * be written. Pure: no database, no side effects, so it is directly testable row by row.
 *
 * Every rejection names the field and carries a code, because an officer fixing a 4000-row export
 * needs to know which column to look at, not that "row 2817 is invalid".
 */
function normaliseRow({ dataset, resolved, row, lookups, defaults, dayFirst }) {
  const issues = []
  const out = {}
  const add = (field, code, message) => issues.push({ field, error_code: code, message })

  const get = (target) => cell(resolved, row, target)

  // ── Classification ──
  if (dataset !== 'projects') {
    const accountCode = get('account_code')
    if (accountCode === undefined || String(accountCode).trim() === '') {
      add('account_code', 'MISSING_ACCOUNT_CODE', 'The account (economic line) is required.')
    } else {
      const account = lookup(lookups.accounts, accountCode)
      if (!account) {
        add('account_code', 'UNKNOWN_ACCOUNT_CODE',
          `Account code "${String(accountCode).trim()}" is not in the council's chart of accounts.`)
      } else if (!account.is_postable) {
        add('account_code', 'ACCOUNT_NOT_POSTABLE',
          `Account "${account.code}" is a heading and cannot carry a transaction.`)
      } else if (account.status !== 'active') {
        add('account_code', 'ACCOUNT_INACTIVE', `Account "${account.code}" is inactive.`)
      } else {
        out.account_id = account.id
        out.account_kind = account.kind
        out.account_code = account.code
      }
    }
  }

  if (dataset === 'budget' || dataset === 'actuals') {
    const deptCode = get('department_code')
    if (deptCode === undefined || String(deptCode).trim() === '') {
      add('department_code', 'MISSING_DEPARTMENT_CODE', 'The department (vote) is required.')
    } else {
      const dept = lookup(lookups.departments, deptCode)
      if (!dept) {
        add('department_code', 'UNKNOWN_DEPARTMENT_CODE',
          `Department code "${String(deptCode).trim()}" is not a council department.`)
      } else if (dept.status !== 'active') {
        add('department_code', 'DEPARTMENT_INACTIVE', `Department "${dept.code}" is inactive.`)
      } else {
        out.department_id = dept.id
        out.department_code = dept.code
      }
    }
  }

  // Optional dimensions. A value that is present but unrecognised is an exception, not a silent
  // null: "ward 99" in the file means something the council has to resolve.
  for (const [target, map, code, field] of [
    ['programme_code', lookups.programmes, 'UNKNOWN_PROGRAMME_CODE', 'programme_id'],
    ['activity_code', lookups.activities, 'UNKNOWN_ACTIVITY_CODE', 'activity_id'],
    ['ward_code', lookups.wards, 'UNKNOWN_WARD_CODE', 'ward_code'],
  ]) {
    const raw = get(target)
    if (raw === undefined || String(raw).trim() === '') continue
    const hit = lookup(map, raw)
    if (!hit) {
      // A ward register that is empty in this database cannot condemn every row, so an unresolved
      // ward is recorded on the row and left out rather than rejected.
      if (target === 'ward_code' && lookups.wards.size === 0) {
        out.unresolved_ward_code = String(raw).trim()
        continue
      }
      add(target, code, `"${String(raw).trim()}" was not recognised.`)
    } else {
      // The ward register is keyed by its code, not by a surrogate id, so the code itself is what
      // the finance tables carry.
      out[field] = target === 'ward_code' ? hit.code : hit.id
    }
  }

  // ── Money ──
  if (dataset !== 'projects' || get('amount') !== undefined) {
    const rawAmount = get('amount')
    const parsed = parseMoney(rawAmount)
    if (!parsed.ok) {
      add('amount', parsed.reason === 'missing' ? 'MISSING_AMOUNT' : 'INVALID_AMOUNT',
        parsed.reason === 'missing'
          ? 'The amount is required.'
          : `"${String(rawAmount ?? '').trim()}" is not an amount this system can store (${parsed.reason}).`)
    } else {
      out.amount = parsed.value
      if (parsed.coerced_from_number) out.amount_coerced_from_number = true
    }
  }

  // Currency. Taken from the row when the file carries it, otherwise from the financial year's
  // reporting currency — which is a council decision already on record, not a guess.
  const rawCurrency = get('currency')
  if (rawCurrency !== undefined && String(rawCurrency).trim() !== '') {
    const c = normaliseCurrency(rawCurrency)
    if (!c) {
      add('currency', 'UNSUPPORTED_CURRENCY',
        `"${String(rawCurrency).trim()}" is not a currency this system stores. Supported: USD, ZWG.`)
    } else {
      out.currency = c
    }
  } else {
    out.currency = defaults.currency
    out.currency_from_financial_year = true
  }

  // ── Dates ──
  if (dataset === 'actuals') {
    const rawDate = get('txn_date')
    const parsed = parseDate(rawDate, { dayFirst })
    if (!parsed.ok) {
      add('txn_date', parsed.reason === 'missing' ? 'MISSING_DATE' : 'INVALID_DATE',
        parsed.reason === 'missing'
          ? 'The transaction date is required.'
          : `"${String(rawDate ?? '').trim()}" is not a date this system can read (${parsed.reason}).`)
    } else {
      out.txn_date = parsed.value
      if (parsed.value < defaults.year_start || parsed.value > defaults.year_end) {
        add('txn_date', 'DATE_OUTSIDE_FINANCIAL_YEAR',
          `${parsed.value} falls outside ${defaults.year_label} (${defaults.year_start} to ${defaults.year_end}).`)
      }
    }
  }
  if (dataset === 'commitments') {
    const rawDate = get('committed_on')
    const parsed = parseDate(rawDate, { dayFirst })
    if (!parsed.ok) {
      add('committed_on', 'INVALID_DATE', `The commitment date could not be read (${parsed.reason}).`)
    } else {
      out.committed_on = parsed.value
    }
  }
  for (const target of ['start_date', 'end_date']) {
    const raw = get(target)
    if (raw === undefined || String(raw).trim() === '') continue
    const parsed = parseDate(raw, { dayFirst })
    if (!parsed.ok) add(target, 'INVALID_DATE', `"${String(raw).trim()}" could not be read as a date.`)
    else out[target] = parsed.value
  }

  // ── The stable source identifier ──
  // Duplicate protection depends entirely on this, so a file without one is not refused: a
  // deterministic identifier is derived from the row's own content and the batch is told that it
  // was derived. A rerun of the same export then still collides, which is the point; a genuinely
  // different row with identical content in every column is indistinguishable from a duplicate and
  // is reported as one rather than posted twice.
  const rawSourceRef = get('source_ref') ?? get('reference')
  if (rawSourceRef !== undefined && String(rawSourceRef).trim() !== '') {
    out.source_ref = String(rawSourceRef).trim().slice(0, 200)
  } else if (dataset === 'actuals' || dataset === 'commitments') {
    const basis = [out.department_code, out.account_code, out.txn_date || out.committed_on,
      out.amount, str(get('description'), 200) || '', str(get('reference'), 120) || ''].join('|')
    out.source_ref = `derived:${crypto.createHash('sha256').update(basis).digest('hex').slice(0, 32)}`
    out.source_ref_derived = true
  }

  // ── Free text ──
  out.description = str(get('description'), 1000) || null
  out.reference = str(get('reference'), 200) || null
  out.record_type = str(get('record_type'), 60) || null
  out.counterparty_ref = str(get('counterparty_ref'), 120) || null
  out.counterparty_name = str(get('counterparty_name'), 300) || null

  // ── Dataset-specific shape ──
  if (dataset === 'budget') {
    out.line_code = str(get('line_code'), 60)
      || [out.department_code, out.account_code].filter(Boolean).join('-') || null
    if (!out.line_code) add('line_code', 'MISSING_LINE_CODE', 'A budget line code could not be formed.')
    if (out.amount && out.amount.startsWith('-')) {
      add('amount', 'NEGATIVE_BUDGET',
        'A budget allocation cannot be negative. Record a reduction as an approved revision.')
    }
  }
  if (dataset === 'projects') {
    out.project_reference = str(get('reference'), 60)
    out.project_name = str(get('name'), 300)
    if (!out.project_reference) add('reference', 'MISSING_PROJECT_REFERENCE', 'The project reference is required.')
    if (!out.project_name) add('name', 'MISSING_PROJECT_NAME', 'The project name is required.')
    out.location_text = str(get('location_text'), 500) || null
    const deptCode = get('department_code')
    if (deptCode !== undefined && String(deptCode).trim() !== '') {
      const dept = lookup(lookups.departments, deptCode)
      if (!dept) add('department_code', 'UNKNOWN_DEPARTMENT_CODE', `Department "${String(deptCode).trim()}" was not recognised.`)
      else out.department_id = dept.id
    }
  }
  if (dataset === 'commitments') {
    if (!out.reference) add('reference', 'MISSING_REFERENCE', 'A commitment needs its order or contract reference.')
    if (!out.committed_on) add('committed_on', 'MISSING_DATE', 'The commitment date is required.')
  }

  // ── The budget line an actual or a commitment belongs to ──
  // Matched on an explicit line code when the file carries one, otherwise on the department and
  // account the row is already classified by. NOT matched by any looser rule: an actual that
  // cannot be tied to a line is still posted (a council may spend on an unbudgeted account, and
  // hiding that would be the worse error) but it is flagged so the unbudgeted spend is visible.
  if (dataset === 'actuals' || dataset === 'commitments') {
    const explicit = get('line_code')
    if (explicit !== undefined && String(explicit).trim() !== '') {
      const line = lookup(lookups.lines, explicit)
      if (!line) add('line_code', 'UNKNOWN_BUDGET_LINE', `Budget line "${String(explicit).trim()}" does not exist for this financial year.`)
      else out.budget_line_id = line.id
    } else if (out.department_id && out.account_id) {
      for (const line of lookups.lines.values()) {
        if (line.department_id === out.department_id && line.account_id === out.account_id) {
          out.budget_line_id = line.id
          break
        }
      }
      if (!out.budget_line_id) out.no_matching_budget_line = true
    }
  }

  // The project an actual belongs to, where the export names one.
  const projectRef = get('project_ref')
  if (projectRef !== undefined && String(projectRef).trim() !== '') {
    const project = lookup(lookups.projects, projectRef)
    if (project) out.project_id = project.id
    else out.unresolved_project_ref = String(projectRef).trim()
  }

  return { out, issues }
}

async function financeImportRoutes(fastify) {
  const pg = fastify.pg
  try { await ensureDir(IMPORT_ROOT) } catch { /* the upload handler reports a real failure */ }

  const canUpload = { preHandler: requirePermission(fastify, 'finance.import.upload') }
  const canValidate = { preHandler: requirePermission(fastify, 'finance.import.validate') }
  const canCommit = { preHandler: requirePermission(fastify, 'finance.import.commit') }
  const canResolve = { preHandler: requirePermission(fastify, 'finance.import.exception.resolve') }
  const canRead = {
    preHandler: requireAnyPermission(fastify, [
      'finance.import.upload', 'finance.import.validate', 'finance.import.commit',
      'finance.audit.view', 'finance.budget.view',
    ]),
  }

  // ── Upload ───────────────────────────────────────────────────────────────────────────────────
  /**
   * Multipart: one file plus fields. The file is scanned, hashed, written to disk unchanged, and a
   * batch row is created in 'uploaded'. Nothing is parsed into the register yet — the response
   * carries the detected headers and how they mapped, which is the preview an officer approves
   * before validation runs.
   */
  fastify.post('/finance/imports', canUpload, async (request, reply) => {
    if (!request.isMultipart()) {
      return fail(reply, 415, 'expected_multipart',
        'Send the file as multipart/form-data with the fields dataset, financial_year_id and idempotency_key.')
    }
    const maxBytes = Number(await financeSetting(fastify, request.user.authority_id, 'import.max_file_bytes', 52428800)) || 52428800
    const maxRows = Number(await financeSetting(fastify, request.user.authority_id, 'import.max_rows', 200000)) || 200000

    let file = null
    const fields = {}
    try {
      const parts = request.parts({ limits: { fileSize: maxBytes, files: 1, fields: 20 } })
      for await (const part of parts) {
        if (part.type === 'file') {
          if (file) { await part.toBuffer().catch(() => null); continue }
          const buf = await part.toBuffer()
          file = { filename: part.filename || 'upload', mimetype: part.mimetype || '', buffer: buf }
        } else {
          fields[part.fieldname] = part.value
        }
      }
    } catch (err) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
        return fail(reply, 413, 'file_too_large', `The file exceeds the council's limit of ${maxBytes} bytes.`)
      }
      throw err
    }

    if (!file || !file.buffer || file.buffer.length === 0) return fail(reply, 400, 'no_file', 'No file was received.')
    const dataset = fields.dataset
    if (!DATASETS.includes(dataset)) {
      return fail(reply, 400, 'bad_dataset', `dataset must be one of: ${DATASETS.join(', ')}`)
    }
    const financialYearId = str(fields.financial_year_id, 64)
    if (!financialYearId) return fail(reply, 400, 'missing_financial_year', 'financial_year_id is required.')
    const idempotencyKey = str(fields.idempotency_key, 200)
    if (!idempotencyKey) {
      return fail(reply, 400, 'missing_idempotency_key',
        'Send an idempotency_key so a retried upload is recognised as the same upload.')
    }

    // A retry of the same upload returns the batch that already exists rather than making a second
    // one. This is what makes the client safe to retry on a timeout.
    const { rows: existing } = await pg.query(
      'SELECT * FROM finance.import_batch WHERE idempotency_key = $1 AND deleted_at IS NULL',
      [idempotencyKey],
    )
    if (existing[0]) {
      return ok(reply, { batch: existing[0], already_existed: true }, 200)
    }

    const { rows: year } = await pg.query(
      `SELECT id, label, status, reporting_currency, ${dateText(null, 'start_date', 'end_date')}
         FROM finance.financial_year WHERE id = $1 AND deleted_at IS NULL`,
      [financialYearId],
    )
    if (!year[0]) return fail(reply, 400, 'unknown_financial_year', 'No such financial year.')
    if (year[0].status !== 'open') {
      return fail(reply, 409, 'year_not_open',
        `Financial year ${year[0].label} is ${year[0].status}. Only an open year accepts imports.`)
    }

    // Scan before anything touches disk. A council's finance export is a plausible vehicle for a
    // macro-bearing workbook, and this is the same scanner the citizen document path uses.
    const scan = await scanBuffer(file.buffer, { mime: file.mimetype, log: request.log })
    if (!scan.clean) {
      request.log.warn({ signature: scan.signature, engine: scan.engine, userId: request.user.id },
        'rejected infected finance import')
      return fail(reply, 422, 'malware_detected', 'This file failed a security scan and was not accepted.')
    }

    // Read it now so a file that is not a spreadsheet at all is refused before a batch exists.
    let parsed
    try {
      parsed = await readTabular(file.buffer, file.filename, { maxRows })
    } catch (err) {
      const message = {
        legacy_xls_not_supported: 'This is an old binary .xls file. Save it as .xlsx or .csv and upload it again.',
        not_a_valid_xlsx: 'The file is named .xlsx but its contents are not a valid workbook.',
        empty_file: 'The file is empty.',
        file_too_large: 'The file is too large to read.',
        not_an_xlsx_workbook: 'The workbook could not be read.',
        workbook_has_no_sheets: 'The workbook contains no worksheets.',
        workbook_has_no_worksheet_part: 'The workbook contains no readable worksheet.',
      }[err.message]
      return fail(reply, 400, err.message || 'unreadable_file',
        message || `The file could not be read: ${err.message}`)
    }
    if (parsed.headers.length === 0 || parsed.headers.every((h) => h === '')) {
      return fail(reply, 400, 'no_header_row', 'The first row of the file carries no column names.')
    }

    const fileHash = crypto.createHash('sha256').update(file.buffer).digest('hex')

    // The same bytes already committed for this year and dataset: refuse here with the batch that
    // did it, which is a far clearer answer than the unique-index violation at commit time. This
    // is the first of the specification's critical test scenarios (§13.1).
    const { rows: priorCommit } = await pg.query(
      `SELECT id, committed_at, original_filename, rows_valid FROM finance.import_batch
        WHERE financial_year_id = $1 AND dataset = $2 AND file_hash = $3 AND status = 'committed'`,
      [financialYearId, dataset, fileHash],
    )
    if (priorCommit[0]) {
      return fail(reply, 409, 'already_committed',
        `This exact file was already committed on ${new Date(priorCommit[0].committed_at).toISOString().slice(0, 10)} as batch ${priorCommit[0].id} (${priorCommit[0].rows_valid} rows). To correct it, upload a corrected file as a new batch.`,
        { existing_batch_id: priorCommit[0].id })
    }

    // Which mapping to use: the one named, else the council's default for this dataset.
    let mappingRow = null
    if (str(fields.mapping_id, 64)) {
      const { rows } = await pg.query(
        'SELECT * FROM finance.column_mapping WHERE id = $1 AND deleted_at IS NULL AND dataset = $2',
        [fields.mapping_id, dataset],
      )
      if (!rows[0]) return fail(reply, 400, 'unknown_mapping', 'No such column mapping for this dataset.')
      mappingRow = rows[0]
    } else {
      const { rows } = await pg.query(
        `SELECT * FROM finance.column_mapping
          WHERE dataset = $1 AND deleted_at IS NULL ORDER BY is_default DESC, created_at LIMIT 1`,
        [dataset],
      )
      mappingRow = rows[0] || null
    }

    let overrides = {}
    if (fields.column_overrides) {
      try { overrides = JSON.parse(fields.column_overrides) } catch {
        return fail(reply, 400, 'bad_overrides', 'column_overrides must be JSON of { target_field: "Header" }.')
      }
    }

    const { resolved, unmatchedTargets, unusedHeaders } =
      resolveColumns(mappingRow?.mapping || {}, parsed.headers, overrides)

    // Control totals, declared by the officer from the council's own report.
    const declaredCount = fields.declared_control_count !== undefined && fields.declared_control_count !== ''
      ? Number(fields.declared_control_count) : null
    const declaredTotalParsed = fields.declared_control_total ? parseMoney(fields.declared_control_total) : null
    if (declaredTotalParsed && !declaredTotalParsed.ok) {
      return fail(reply, 400, 'bad_control_total', `declared_control_total: ${declaredTotalParsed.reason}`)
    }
    if (declaredCount !== null && (!Number.isInteger(declaredCount) || declaredCount < 0)) {
      return fail(reply, 400, 'bad_control_count', 'declared_control_count must be a whole number.')
    }

    const batchId = crypto.randomUUID()
    const extension = parsed.format === 'xlsx' ? '.xlsx' : '.csv'
    const dir = path.join(IMPORT_ROOT, String(request.user.authority_id ?? 'unknown'))
    const objectKey = path.join(dir, `${batchId}${extension}`)
    await ensureDir(dir)
    // The original bytes, unmodified. Everything else is derived from this file.
    await fs.writeFile(objectKey, file.buffer, { mode: 0o640 })

    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.import_batch
           (id, financial_year_id, dataset, original_filename, stored_object_key, file_hash,
            file_size_bytes, mime_type, mapping_id, idempotency_key, status,
            declared_control_count, declared_control_total, declared_control_currency,
            rows_total, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::numeric,$14,$15,$16)
         RETURNING *`,
        [batchId, financialYearId, dataset, file.filename, objectKey, fileHash,
          file.buffer.length, file.mimetype || null, mappingRow?.id || null, idempotencyKey,
          mappingRow ? 'mapped' : 'uploaded',
          declaredCount, declaredTotalParsed?.value ?? null,
          normaliseCurrency(fields.declared_control_currency) || null,
          parsed.rows.length, request.user.id],
      )
      return ok(reply, {
        batch: rows[0],
        // The preview the officer confirms before validation: which column fed which field, what
        // the file's first rows look like, and what was left unmapped.
        file: {
          format: parsed.format, sheet_name: parsed.sheetName,
          delimiter: parsed.delimiter ?? null, truncated: parsed.truncated,
          header_row: parsed.headers, row_count: parsed.rows.length,
        },
        mapping: {
          id: mappingRow?.id ?? null,
          name: mappingRow?.name ?? null,
          resolved: Object.fromEntries(Object.entries(resolved).map(([k, v]) => [k, v.header])),
          unmatched_targets: unmatchedTargets,
          unused_headers: unusedHeaders,
          missing_required: REQUIRED_COLUMNS[dataset]
            .filter((group) => !group.some((t) => resolved[t]))
            .map((group) => group.join(' | ')),
        },
        sample_rows: parsed.rows.slice(0, 10),
      }, 201)
    } catch (err) {
      await fs.unlink(objectKey).catch(() => {})
      if (err.code === '23505') {
        return fail(reply, 409, 'duplicate_idempotency_key', 'That idempotency key is already in use.')
      }
      throw err
    }
  })

  // ── List and inspect ─────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/imports', {
    ...canRead,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          financial_year_id: uuid,
          dataset: { type: 'string', enum: DATASETS },
          status: { type: 'string' },
          limit: { type: 'integer', minimum: 1, maximum: 200, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT b.*, y.label AS financial_year_label,
              COALESCE(uu.full_name, uu.name) AS uploaded_by_name,
              COALESCE(cu.full_name, cu.name) AS committed_by_name,
              (SELECT count(*) FROM finance.import_exception e
                WHERE e.batch_id = b.id AND e.resolved_at IS NULL) AS open_exceptions
         FROM finance.import_batch b
         JOIN finance.financial_year y ON y.id = b.financial_year_id
         LEFT JOIN public.users uu ON uu.id = b.uploaded_by
         LEFT JOIN public.users cu ON cu.id = b.committed_by
        WHERE b.deleted_at IS NULL
          AND ($1::uuid IS NULL OR b.financial_year_id = $1::uuid)
          AND ($2::text IS NULL OR b.dataset = $2::text)
          AND ($3::text IS NULL OR b.status = $3::text)
        ORDER BY b.uploaded_at DESC
        LIMIT $4 OFFSET $5`,
      [q.financial_year_id || null, q.dataset || null, q.status || null, q.limit, q.offset],
    )
    return ok(reply, rows)
  })

  fastify.get('/finance/imports/:id', canRead, async (request, reply) => {
    const { rows } = await pg.query(
      `SELECT b.*, y.label AS financial_year_label, y.status AS year_status,
              ${dateText('y', 'start_date', 'end_date')},
              m.name AS mapping_name, m.mapping,
              COALESCE(uu.full_name, uu.name) AS uploaded_by_name
         FROM finance.import_batch b
         JOIN finance.financial_year y ON y.id = b.financial_year_id
         LEFT JOIN finance.column_mapping m ON m.id = b.mapping_id
         LEFT JOIN public.users uu ON uu.id = b.uploaded_by
        WHERE b.id = $1 AND b.deleted_at IS NULL`, [request.params.id],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such import batch.')
    const { rows: exceptionSummary } = await pg.query(
      `SELECT error_code, field, count(*)::int AS rows, min(row_number) AS first_row
         FROM finance.import_exception
        WHERE batch_id = $1 AND resolved_at IS NULL
        GROUP BY error_code, field ORDER BY rows DESC`, [request.params.id],
    )
    return ok(reply, { batch: rows[0], exception_summary: exceptionSummary })
  })

  // ── Validate ─────────────────────────────────────────────────────────────────────────────────
  /**
   * Re-read the preserved file, normalise every row, and record what came of each one. Writes
   * finance.import_row for all rows and finance.import_exception for every fault, then compares the
   * valid rows against the declared control totals.
   *
   * Re-runnable: a second validation of the same batch clears the first one's rows and exceptions
   * first, so an officer who adds the missing account codes and validates again gets a clean
   * answer rather than two generations of errors side by side.
   */
  fastify.post('/finance/imports/:id/validate', {
    ...canValidate,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          column_overrides: { type: 'object', additionalProperties: { type: 'string', maxLength: 200 } },
          // Day-first is the Zimbabwean and Excel en-ZW convention and is the default. An export
          // written month-first must say so, and the choice is recorded on the batch.
          date_order: { type: 'string', enum: ['day_first', 'month_first'], default: 'day_first' },
        },
      },
    },
  }, async (request, reply) => {
    const { rows: batchRows } = await pg.query(
      `SELECT b.*, y.label AS year_label, y.status AS year_status,
              y.start_date::text AS start_date, y.end_date::text AS end_date,
              y.reporting_currency, m.mapping
         FROM finance.import_batch b
         JOIN finance.financial_year y ON y.id = b.financial_year_id
         LEFT JOIN finance.column_mapping m ON m.id = b.mapping_id
        WHERE b.id = $1 AND b.deleted_at IS NULL`, [request.params.id],
    )
    const batch = batchRows[0]
    if (!batch) return fail(reply, 404, 'not_found', 'No such import batch.')
    if (batch.status === 'committed') {
      return fail(reply, 409, 'already_committed', 'This batch is committed and cannot be revalidated.')
    }
    if (batch.status === 'cancelled') return fail(reply, 409, 'cancelled', 'This batch was cancelled.')

    let buffer
    try {
      buffer = await fs.readFile(batch.stored_object_key)
    } catch {
      return fail(reply, 500, 'source_file_missing',
        'The preserved source file could not be read. The batch cannot be validated without it.')
    }
    // The file on disk must still be the file that was uploaded.
    const hash = crypto.createHash('sha256').update(buffer).digest('hex')
    if (hash !== batch.file_hash) {
      return fail(reply, 409, 'source_file_changed',
        'The stored file no longer matches the hash recorded at upload. The batch has been left untouched.')
    }

    const maxRows = Number(await financeSetting(fastify, request.user.authority_id, 'import.max_rows', 200000)) || 200000
    const parsed = await readTabular(buffer, batch.original_filename, { maxRows })
    const overrides = request.body?.column_overrides || {}
    const { resolved } = resolveColumns(batch.mapping || {}, parsed.headers, overrides)

    const missingRequired = REQUIRED_COLUMNS[batch.dataset]
      .filter((group) => !group.some((t) => resolved[t]))
      .map((group) => group.join(' | '))
    if (missingRequired.length) {
      // A missing column is one fault about the file, not one fault per row.
      return fail(reply, 400, 'required_columns_unmapped',
        `These fields could not be matched to a column in the file: ${missingRequired.join(', ')}. Map them with column_overrides and validate again.`,
        { missing_required: missingRequired, header_row: parsed.headers })
    }

    const lookups = await loadLookups(pg, batch.financial_year_id)
    const dayFirst = (request.body?.date_order || 'day_first') === 'day_first'
    const defaults = {
      currency: batch.reporting_currency,
      // Text from the database (see dateText in src/lib/finance.js), so this is already the
      // date the council's year starts and ends on, not an instant in some time zone.
      year_start: String(batch.start_date).slice(0, 10),
      year_end: String(batch.end_date).slice(0, 10),
      year_label: batch.year_label,
    }

    // Duplicates WITHIN the file, and against what is already in the register.
    const seenInFile = new Map()
    const client = await pg.connect()
    let valid = 0
    let rejected = 0
    let duplicates = 0
    try {
      await client.query('BEGIN')
      await client.query('UPDATE finance.import_batch SET status = $2 WHERE id = $1', [batch.id, 'validating'])
      await client.query('DELETE FROM finance.import_exception WHERE batch_id = $1', [batch.id])
      await client.query('DELETE FROM finance.import_row WHERE batch_id = $1', [batch.id])

      const existingRefs = new Set()
      if (batch.dataset === 'actuals') {
        const { rows } = await client.query(
          'SELECT source_ref FROM finance.transaction WHERE source_system = $1 AND deleted_at IS NULL',
          [`import:${batch.dataset}`],
        )
        for (const r of rows) existingRefs.add(r.source_ref)
      } else if (batch.dataset === 'commitments') {
        const { rows } = await client.query(
          'SELECT source_ref FROM finance.commitment WHERE source_system = $1 AND deleted_at IS NULL',
          [`import:${batch.dataset}`],
        )
        for (const r of rows) existingRefs.add(r.source_ref)
      }

      for (let i = 0; i < parsed.rows.length; i += 1) {
        // Row 1 is the header, so the first data row is row 2 — the number the officer sees in
        // their spreadsheet.
        const rowNumber = i + 2
        const raw = parsed.rows[i]
        if (!raw || raw.every((v) => v === null || String(v).trim() === '')) continue

        const { out, issues } = normaliseRow({
          dataset: batch.dataset, resolved, row: raw, lookups, defaults, dayFirst,
        })

        let status = issues.length ? 'rejected' : 'valid'
        if (status === 'valid' && out.source_ref) {
          if (seenInFile.has(out.source_ref)) {
            status = 'skipped_duplicate'
            issues.push({
              field: 'source_ref', error_code: 'DUPLICATE_WITHIN_FILE',
              message: `Source reference "${out.source_ref}" also appears on row ${seenInFile.get(out.source_ref)} of this file.`,
            })
          } else if (existingRefs.has(out.source_ref)) {
            status = 'skipped_duplicate'
            issues.push({
              field: 'source_ref', error_code: 'ALREADY_IN_REGISTER',
              message: `Source reference "${out.source_ref}" is already recorded. This row will be skipped, not posted twice.`,
            })
          } else {
            seenInFile.set(out.source_ref, rowNumber)
          }
        }

        await client.query(
          `INSERT INTO finance.import_row (batch_id, row_number, raw, normalised, status)
           VALUES ($1,$2,$3::jsonb,$4::jsonb,$5)`,
          [batch.id, rowNumber,
            JSON.stringify(Object.fromEntries(parsed.headers.map((h, j) => [h || `col${j + 1}`, raw[j] ?? null]))),
            JSON.stringify(out), status],
        )
        for (const issue of issues) {
          await client.query(
            `INSERT INTO finance.import_exception (batch_id, row_number, field, error_code, message, raw)
             VALUES ($1,$2,$3,$4,$5,$6::jsonb)`,
            [batch.id, rowNumber, issue.field, issue.error_code, issue.message, JSON.stringify(raw)],
          )
        }
        if (status === 'valid') valid += 1
        else if (status === 'skipped_duplicate') duplicates += 1
        else rejected += 1
      }

      // Reconciliation. Summed in SQL over NUMERIC, never in JavaScript.
      const { rows: totals } = await client.query(
        `SELECT count(*)::int AS n,
                COALESCE(sum((normalised->>'amount')::numeric), 0) AS total,
                array_agg(DISTINCT normalised->>'currency') AS currencies
           FROM finance.import_row
          WHERE batch_id = $1 AND status = 'valid' AND normalised ? 'amount'`,
        [batch.id],
      )
      const reconciledCount = totals[0].n
      const reconciledTotal = totals[0].total
      const currencies = (totals[0].currencies || []).filter(Boolean)

      let reconciliation = 'not_declared'
      const notes = []
      if (batch.declared_control_count !== null || batch.declared_control_total !== null) {
        let matched = true
        if (batch.declared_control_count !== null && batch.declared_control_count !== reconciledCount) {
          matched = false
          notes.push(`Row count: the council declared ${batch.declared_control_count}, the file yielded ${reconciledCount} valid rows.`)
        }
        if (batch.declared_control_total !== null) {
          if (currencies.length > 1) {
            matched = false
            notes.push(`The file mixes ${currencies.join(' and ')}. A single control total cannot be reconciled against more than one currency; declare one total per currency.`)
          } else {
            const { rows: cmp } = await client.query(
              'SELECT ($1::numeric = $2::numeric) AS eq', [batch.declared_control_total, reconciledTotal],
            )
            if (!cmp[0].eq) {
              matched = false
              notes.push(`Total: the council declared ${batch.declared_control_total}, the file yielded ${reconciledTotal}.`)
            }
          }
        }
        reconciliation = matched ? 'matched' : 'mismatched'
      } else {
        notes.push('No control totals were declared, so the import cannot be reconciled to the source. Declare them before committing.')
      }

      const { rows: updated } = await client.query(
        `UPDATE finance.import_batch
            SET status = 'validated', validated_at = now(),
                rows_total = $2, rows_valid = $3, rows_rejected = $4,
                reconciled_count = $5, reconciled_total = $6::numeric,
                reconciliation_status = $7, error_summary = $8
          WHERE id = $1 RETURNING *`,
        [batch.id, parsed.rows.length, valid, rejected, reconciledCount, reconciledTotal,
          reconciliation, notes.length ? notes.join(' ') : null],
      )
      await client.query('COMMIT')

      const { rows: summary } = await pg.query(
        `SELECT error_code, field, count(*)::int AS rows, min(row_number) AS first_row
           FROM finance.import_exception WHERE batch_id = $1 AND resolved_at IS NULL
          GROUP BY error_code, field ORDER BY rows DESC`, [batch.id],
      )
      return ok(reply, {
        batch: updated[0],
        counts: { total: parsed.rows.length, valid, rejected, duplicates },
        currencies_in_file: currencies,
        reconciliation: { status: reconciliation, notes },
        exception_summary: summary,
        date_order: dayFirst ? 'day_first' : 'month_first',
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      await pg.query('UPDATE finance.import_batch SET status = $2, error_summary = $3 WHERE id = $1',
        [batch.id, 'failed', String(err.message).slice(0, 2000)]).catch(() => {})
      throw err
    } finally {
      client.release()
    }
  })

  // ── Preview and exceptions ───────────────────────────────────────────────────────────────────
  fastify.get('/finance/imports/:id/rows', {
    ...canRead,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          status: { type: 'string', enum: ['pending', 'valid', 'rejected', 'committed', 'skipped_duplicate'] },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 50 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT r.row_number, r.status, r.raw, r.normalised,
              COALESCE(json_agg(json_build_object('field', e.field, 'error_code', e.error_code, 'message', e.message))
                       FILTER (WHERE e.id IS NOT NULL), '[]'::json) AS issues
         FROM finance.import_row r
         LEFT JOIN finance.import_exception e
                ON e.batch_id = r.batch_id AND e.row_number = r.row_number AND e.resolved_at IS NULL
        WHERE r.batch_id = $1 AND ($2::text IS NULL OR r.status = $2::text)
        GROUP BY r.row_number, r.status, r.raw, r.normalised
        ORDER BY r.row_number
        LIMIT $3 OFFSET $4`,
      [request.params.id, q.status || null, q.limit, q.offset],
    )
    return ok(reply, rows)
  })

  fastify.get('/finance/imports/:id/exceptions', {
    ...canRead,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          open_only: { type: 'boolean', default: true },
          error_code: { type: 'string', maxLength: 60 },
          limit: { type: 'integer', minimum: 1, maximum: 1000, default: 200 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    const { rows } = await pg.query(
      `SELECT e.*, COALESCE(u.full_name, u.name) AS resolved_by_name
         FROM finance.import_exception e
         LEFT JOIN public.users u ON u.id = e.resolved_by
        WHERE e.batch_id = $1
          AND ($2::boolean IS NOT TRUE OR e.resolved_at IS NULL)
          AND ($3::text IS NULL OR e.error_code = $3::text)
        ORDER BY e.row_number, e.id
        LIMIT $4 OFFSET $5`,
      [request.params.id, q.open_only, q.error_code || null, q.limit, q.offset],
    )
    return ok(reply, rows)
  })

  /**
   * Record what was done about an exception.
   *
   * Resolving an exception does NOT make the row valid. The row becomes valid when the underlying
   * fault is fixed — the account code added to the chart, the file corrected at source — and the
   * batch is validated again. This endpoint records the decision and keeps the queue honest; it is
   * not a way to wave a row through. `row_excluded` is the one resolution that changes an outcome,
   * and it excludes the row rather than inventing values for it.
   */
  fastify.patch('/finance/imports/:id/exceptions/:exceptionId', {
    ...canResolve,
    schema: {
      body: {
        type: 'object', required: ['resolution'], additionalProperties: false,
        properties: {
          resolution: { type: 'string', enum: ['corrected_at_source', 'mapping_added', 'row_excluded', 'accepted_as_is'] },
          note: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const { rows } = await pg.query(
      `UPDATE finance.import_exception
          SET resolved_at = now(), resolved_by = $3, resolution = $4, resolution_note = $5
        WHERE id = $1 AND batch_id = $2 AND resolved_at IS NULL
        RETURNING *`,
      [request.params.exceptionId, request.params.id, request.user.id,
        request.body.resolution, request.body.note || null],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such open exception on this batch.')
    if (request.body.resolution === 'row_excluded') {
      await pg.query(
        `UPDATE finance.import_row SET status = 'skipped_duplicate'
          WHERE batch_id = $1 AND row_number = $2 AND status <> 'committed'`,
        [request.params.id, rows[0].row_number],
      )
    }
    return ok(reply, rows[0])
  })

  // ── Commit ───────────────────────────────────────────────────────────────────────────────────
  /**
   * Write the valid rows into the register, in one transaction.
   *
   * Preconditions, all of them refusals rather than warnings:
   *   - the batch is validated (not uploaded, not already committed, not cancelled);
   *   - the financial year is still open;
   *   - the control totals reconcile, unless the caller explicitly overrides with a stated reason;
   *   - the caller holds finance.import.commit, which the preparing roles do not.
   *
   * A row whose source reference is already in the register is skipped and counted. The batch's
   * own `idempotency_key` makes a retried HTTP call return the first call's result.
   */
  fastify.post('/finance/imports/:id/commit', {
    ...canCommit,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: {
          // Committing a batch that did not reconcile is a decision someone has to own and explain.
          override_reconciliation: { type: 'boolean', default: false },
          override_reason: { type: 'string', maxLength: 2000 },
        },
      },
    },
  }, async (request, reply) => {
    const { rows: batchRows } = await pg.query(
      `SELECT b.*, y.status AS year_status, y.label AS year_label, y.reporting_currency
         FROM finance.import_batch b
         JOIN finance.financial_year y ON y.id = b.financial_year_id
        WHERE b.id = $1 AND b.deleted_at IS NULL`, [request.params.id],
    )
    const batch = batchRows[0]
    if (!batch) return fail(reply, 404, 'not_found', 'No such import batch.')
    if (batch.status === 'committed') {
      // Idempotent: the same call again is not an error, it is the same answer.
      return ok(reply, { batch, already_committed: true,
        committed_rows: batch.rows_valid, committed_at: batch.committed_at })
    }
    if (batch.status !== 'validated') {
      return fail(reply, 409, 'not_validated',
        `This batch is ${batch.status}. Validate it before committing.`)
    }
    if (batch.year_status !== 'open') {
      return fail(reply, 409, 'year_not_open', `Financial year ${batch.year_label} is ${batch.year_status}.`)
    }
    if (batch.reconciliation_status !== 'matched' && !request.body?.override_reconciliation) {
      return fail(reply, 409, 'not_reconciled',
        `This batch is ${batch.reconciliation_status.replace('_', ' ')} against the declared control totals. ${batch.error_summary || ''} Commit it anyway only with override_reconciliation and a stated reason.`,
        { reconciliation_status: batch.reconciliation_status, notes: batch.error_summary })
    }
    if (request.body?.override_reconciliation && !str(request.body.override_reason, 2000)) {
      return fail(reply, 400, 'override_reason_required',
        'Committing an unreconciled batch requires override_reason, which is kept on the batch and in the audit trail.')
    }

    const client = await pg.connect()
    let written = 0
    let skipped = 0
    try {
      await client.query('BEGIN')
      // Claim the batch. A second request that arrives while this one is working finds it
      // 'committing' rather than 'validated' and is refused, so two officers cannot both commit.
      const { rows: claimed } = await client.query(
        `UPDATE finance.import_batch SET status = 'committing'
          WHERE id = $1 AND status = 'validated' RETURNING id`, [batch.id],
      )
      if (!claimed[0]) {
        await client.query('ROLLBACK')
        return fail(reply, 409, 'already_in_progress', 'Another commit of this batch is already running.')
      }

      const { rows: validRows } = await client.query(
        `SELECT row_number, normalised FROM finance.import_row
          WHERE batch_id = $1 AND status = 'valid' ORDER BY row_number`, [batch.id],
      )
      const sourceSystem = `import:${batch.dataset}`

      for (const r of validRows) {
        const n = r.normalised
        if (batch.dataset === 'actuals') {
          const { rows: inserted } = await client.query(
            `INSERT INTO finance.transaction
               (financial_year_id, account_id, department_id, programme_id, activity_id, ward_code,
                budget_line_id, txn_date, amount, currency, description, reference, record_type,
                counterparty_ref, counterparty_name, source_system, source_ref, import_batch_id,
                posted_at, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::numeric,$10,$11,$12,$13,$14,$15,$16,$17,$18,now(),$19)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [batch.financial_year_id, n.account_id, n.department_id, n.programme_id || null,
              n.activity_id || null, n.ward_code || null, n.budget_line_id || null,
              n.txn_date, n.amount, n.currency, n.description, n.reference, n.record_type,
              n.counterparty_ref, n.counterparty_name, sourceSystem, n.source_ref, batch.id,
              request.user.id],
          )
          if (!inserted[0]) {
            skipped += 1
            await client.query(
              `UPDATE finance.import_row SET status = 'skipped_duplicate' WHERE batch_id = $1 AND row_number = $2`,
              [batch.id, r.row_number])
            continue
          }
          // The project association, where the export named a project this council already has.
          if (n.project_id) {
            await client.query(
              `INSERT INTO finance.project_transaction (project_id, transaction_id, association, share, created_by)
               VALUES ($1,$2,'direct',1,$3) ON CONFLICT DO NOTHING`,
              [n.project_id, inserted[0].id, request.user.id])
          }
          await client.query(
            `UPDATE finance.import_row SET status = 'committed', target_id = $3 WHERE batch_id = $1 AND row_number = $2`,
            [batch.id, r.row_number, inserted[0].id])
          written += 1
        } else if (batch.dataset === 'budget') {
          // An imported budget line arrives as a DRAFT. An import is not an approval: the
          // allocation becomes official through the submit/approve path in finance-budget.js, by a
          // person who holds finance.budget.approve.
          const { rows: inserted } = await client.query(
            `INSERT INTO finance.budget_line
               (financial_year_id, department_id, account_id, programme_id, activity_id, ward_code,
                code, description, currency, original_amount, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::numeric,'draft',$11)
             ON CONFLICT DO NOTHING
             RETURNING id`,
            [batch.financial_year_id, n.department_id, n.account_id, n.programme_id || null,
              n.activity_id || null, n.ward_code || null, n.line_code,
              n.description || `${n.department_code} ${n.account_code}`, n.currency, n.amount,
              request.user.id],
          )
          if (!inserted[0]) {
            skipped += 1
            await client.query(
              `UPDATE finance.import_row SET status = 'skipped_duplicate' WHERE batch_id = $1 AND row_number = $2`,
              [batch.id, r.row_number])
            continue
          }
          await client.query(
            `UPDATE finance.import_row SET status = 'committed', target_id = $3 WHERE batch_id = $1 AND row_number = $2`,
            [batch.id, r.row_number, inserted[0].id])
          written += 1
        } else if (batch.dataset === 'commitments') {
          if (!n.budget_line_id) {
            // A commitment with no budget line has nothing to reduce. It is reported rather than
            // attached to an arbitrary line.
            skipped += 1
            await client.query(
              `INSERT INTO finance.import_exception (batch_id, row_number, field, error_code, message)
               VALUES ($1,$2,'line_code','NO_BUDGET_LINE','A commitment must name the budget line it encumbers.')`,
              [batch.id, r.row_number])
            await client.query(
              `UPDATE finance.import_row SET status = 'rejected' WHERE batch_id = $1 AND row_number = $2`,
              [batch.id, r.row_number])
            continue
          }
          const { rows: inserted } = await client.query(
            `INSERT INTO finance.commitment
               (budget_line_id, reference, amount, currency, committed_on, description,
                source_system, source_ref, import_batch_id, created_by)
             VALUES ($1,$2,$3::numeric,$4,$5,$6,$7,$8,$9,$10)
             ON CONFLICT DO NOTHING RETURNING id`,
            [n.budget_line_id, n.reference, n.amount, n.currency, n.committed_on,
              n.description, sourceSystem, n.source_ref, batch.id, request.user.id],
          )
          if (!inserted[0]) {
            skipped += 1
            await client.query(
              `UPDATE finance.import_row SET status = 'skipped_duplicate' WHERE batch_id = $1 AND row_number = $2`,
              [batch.id, r.row_number])
            continue
          }
          await client.query(
            `UPDATE finance.import_row SET status = 'committed', target_id = $3 WHERE batch_id = $1 AND row_number = $2`,
            [batch.id, r.row_number, inserted[0].id])
          written += 1
        } else if (batch.dataset === 'projects') {
          // Imported projects arrive 'proposed'. Approval and publication are separate acts.
          const { rows: inserted } = await client.query(
            `INSERT INTO finance.project
               (reference, name, description, department_id, ward_code, location_text,
                start_date, end_date, currency, approved_budget, status, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10::numeric,0),'proposed',$11)
             ON CONFLICT DO NOTHING RETURNING id`,
            [n.project_reference, n.project_name, n.description, n.department_id || null,
              n.ward_code || null, n.location_text, n.start_date || null, n.end_date || null,
              n.currency, n.amount || null, request.user.id],
          )
          if (!inserted[0]) {
            skipped += 1
            await client.query(
              `UPDATE finance.import_row SET status = 'skipped_duplicate' WHERE batch_id = $1 AND row_number = $2`,
              [batch.id, r.row_number])
            continue
          }
          await client.query(
            `UPDATE finance.import_row SET status = 'committed', target_id = $3 WHERE batch_id = $1 AND row_number = $2`,
            [batch.id, r.row_number, inserted[0].id])
          written += 1
        }
      }

      const { rows: final } = await client.query(
        `UPDATE finance.import_batch
            SET status = 'committed', committed_at = now(), committed_by = $2,
                error_summary = CASE WHEN $3::text IS NULL THEN error_summary
                                     ELSE concat_ws(' ', error_summary, $3::text) END
          WHERE id = $1 RETURNING *`,
        [batch.id, request.user.id,
          request.body?.override_reconciliation
            ? `Committed despite ${batch.reconciliation_status} reconciliation. Reason given: ${request.body.override_reason}`
            : null],
      )
      await client.query('COMMIT')
      request.auditDetails = {
        ...(request.body?.override_reconciliation
          ? { reason: request.body.override_reason, override_reconciliation: true }
          : {}),
        before: { status: batch.status, reconciliation_status: batch.reconciliation_status },
        after: { status: final[0].status, written, skipped_as_duplicate: skipped },
      }
      return ok(reply, {
        batch: final[0],
        written,
        skipped_as_duplicate: skipped,
        // Stated plainly: what an import does and does not do.
        note: batch.dataset === 'budget'
          ? 'Imported budget lines are drafts. They become the approved allocation only through submission and approval.'
          : batch.dataset === 'projects'
            ? 'Imported projects are proposals. Approval and publication are separate decisions.'
            : undefined,
      })
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {})
      await pg.query(
        `UPDATE finance.import_batch SET status = 'validated', error_summary = $2 WHERE id = $1`,
        [batch.id, `Commit failed and was rolled back: ${String(err.message).slice(0, 1500)}`],
      ).catch(() => {})
      if (/accepts no further financial records/.test(err.message || '')) {
        return fail(reply, 409, 'year_closed', err.message)
      }
      throw err
    } finally {
      client.release()
    }
  })

  /**
   * Cancel an uncommitted batch. The batch row and its exceptions stay — an abandoned import is
   * part of the record — and the preserved source file is kept too.
   */
  fastify.post('/finance/imports/:id/cancel', {
    ...canUpload,
    schema: {
      body: {
        type: 'object', additionalProperties: false,
        properties: { reason: { type: 'string', maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    const { rows } = await pg.query(
      `UPDATE finance.import_batch
          SET status = 'cancelled',
              error_summary = concat_ws(' ', error_summary, $2::text)
        WHERE id = $1 AND deleted_at IS NULL
          AND status IN ('uploaded', 'mapped', 'validating', 'validated', 'failed')
        RETURNING *`,
      [request.params.id, request.body?.reason ? `Cancelled: ${request.body.reason}` : 'Cancelled.'],
    )
    if (!rows[0]) {
      return fail(reply, 409, 'not_cancellable', 'Only an uncommitted batch can be cancelled.')
    }
    return ok(reply, rows[0])
  })

  /**
   * The reconciliation statement for a committed batch: what the council declared, what the file
   * yielded, and what actually reached the register. All three, because the third can differ from
   * the second when rows were skipped as duplicates — and that difference is exactly what a
   * reconciliation is for.
   */
  fastify.get('/finance/imports/:id/reconciliation', canRead, async (request, reply) => {
    const { rows: batchRows } = await pg.query(
      'SELECT * FROM finance.import_batch WHERE id = $1 AND deleted_at IS NULL', [request.params.id],
    )
    const batch = batchRows[0]
    if (!batch) return fail(reply, 404, 'not_found', 'No such import batch.')

    const table = batch.dataset === 'actuals' ? 'finance.transaction'
      : batch.dataset === 'commitments' ? 'finance.commitment'
        : batch.dataset === 'budget' ? 'finance.budget_line' : 'finance.project'
    const amountColumn = batch.dataset === 'budget' ? 'original_amount'
      : batch.dataset === 'projects' ? 'approved_budget' : 'amount'

    const { rows: posted } = await pg.query(
      `SELECT currency, count(*)::int AS rows, COALESCE(sum(${amountColumn}), 0) AS total
         FROM ${table} WHERE import_batch_id = $1 AND deleted_at IS NULL
        GROUP BY currency ORDER BY currency`,
      [request.params.id],
    ).catch(() => ({ rows: [] }))

    const { rows: rowStatus } = await pg.query(
      `SELECT status, count(*)::int AS rows FROM finance.import_row
        WHERE batch_id = $1 GROUP BY status ORDER BY status`, [request.params.id],
    )

    return ok(reply, {
      batch_id: batch.id,
      dataset: batch.dataset,
      source_file: {
        filename: batch.original_filename,
        sha256: batch.file_hash,
        size_bytes: Number(batch.file_size_bytes),
        uploaded_at: batch.uploaded_at,
      },
      declared_by_council: {
        count: batch.declared_control_count,
        total: batch.declared_control_total,
        currency: batch.declared_control_currency,
      },
      yielded_by_file: { count: batch.reconciled_count, total: batch.reconciled_total },
      // Per currency, never summed across currencies.
      posted_to_register: posted,
      rows_by_status: rowStatus,
      reconciliation_status: batch.reconciliation_status,
      notes: batch.error_summary,
    })
  })
}

module.exports = { financeImportRoutes, normaliseRow, REQUIRED_COLUMNS }
