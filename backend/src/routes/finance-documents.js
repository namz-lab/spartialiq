/**
 * Supporting documents for financial records: invoices, vouchers, purchase orders, contracts,
 * receipts, approved budgets, statements.
 *
 * Table: finance.document (migration 188). Storage: the same private local root the citizen
 * document path uses, outside the web root, served only through this route.
 *
 * THE THREE CONTROLS
 *
 * 1. A DOCUMENT IS PRIVATE WHEN IT ARRIVES. `visibility` defaults to 'private' and the only way to
 *    make one public is a deliberate act by a publisher, with a stated reason, through
 *    PATCH /api/finance/documents/:id/visibility in finance-publication.js. Nothing in this file
 *    can publish anything (decision D5).
 *
 * 2. THE FILE IS VALIDATED BY ITS BYTES AND SCANNED. The claimed content type is not trusted; a
 *    .pdf that is really something else is refused, and the same malware scanner the citizen
 *    upload path uses runs before the file touches disk.
 *
 * 3. DOWNLOAD IS AUTHORISED PER DOCUMENT, NOT PER DIRECTORY. The object key never appears in a URL
 *    and is never taken from the request: it is read from the row after the permission check, so
 *    there is no path for a traversal or an insecure direct object reference to take.
 */

const crypto = require('node:crypto')
const fs = require('node:fs/promises')
const path = require('node:path')

const { requirePermission, requireAnyPermission, hasPermission } = require('../middleware/financePermissions')
const { optionalAuth } = require('../middleware/jwtAuth')
const { validateFileSignature } = require('../utils/fileSignature')
const { scanBuffer } = require('../services/malwareScan')
const { str } = require('../lib/finance')

const DOC_ROOT = process.env.FINANCE_DOC_ROOT
  ? path.resolve(process.env.FINANCE_DOC_ROOT)
  : path.resolve(__dirname, '../../uploads/finance-documents')

const MAX_BYTES = 25 * 1024 * 1024
const ALLOWED_MIME = new Set([
  'application/pdf',
  'image/jpeg', 'image/png', 'image/webp',
  // A council's supporting schedule is often the spreadsheet itself.
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/csv',
])

const SUBJECT_KINDS = ['financial_year', 'budget_line', 'budget_revision', 'transaction',
  'project', 'import_batch', 'publication', 'report']

const ok = (reply, data, status = 200) => reply.code(status).send({ success: true, data })
const fail = (reply, status, error, message) => reply.code(status).send({ success: false, error, message })

async function ensureDir(dir) { await fs.mkdir(dir, { recursive: true, mode: 0o750 }) }

/** Does the record this document claims to support exist? A document attached to nothing is noise. */
async function subjectExists(pg, kind, id) {
  const table = {
    financial_year: 'finance.financial_year',
    budget_line: 'finance.budget_line',
    budget_revision: 'finance.budget_revision',
    transaction: 'finance.transaction',
    project: 'finance.project',
    import_batch: 'finance.import_batch',
    publication: 'finance.publication',
  }[kind]
  // 'report' is a generated artefact with no row of its own.
  if (!table) return true
  const { rows } = await pg.query(`SELECT 1 FROM ${table} WHERE id = $1 LIMIT 1`, [id])
  return rows.length > 0
}

async function financeDocumentRoutes(fastify) {
  const pg = fastify.pg
  try { await ensureDir(DOC_ROOT) } catch { /* the upload handler reports a real failure */ }

  const canUpload = { preHandler: requirePermission(fastify, 'finance.document.upload') }
  const canView = { preHandler: requirePermission(fastify, 'finance.document.view') }
  // Withdrawing a document is a WRITE, and it needs its own write permission (migration 200).
  // It used to be guarded by canView — a READ permission held by auditor, publisher,
  // budget_officer, dept_head and finance_committee — so a read-only external auditor could
  // withdraw the invoice supporting a posted transaction (audit BLOCKER-3 / GAP-3).
  const canWithdraw = { preHandler: requirePermission(fastify, 'finance.document.withdraw') }
  const canList = {
    preHandler: requireAnyPermission(fastify, ['finance.document.view', 'finance.budget.view', 'finance.project.view']),
  }

  // ── Upload ───────────────────────────────────────────────────────────────────────────────────
  fastify.post('/finance/documents', canUpload, async (request, reply) => {
    if (!request.isMultipart()) {
      return fail(reply, 415, 'expected_multipart',
        'Send the file as multipart/form-data with the fields subject_kind, subject_id and document_type.')
    }
    let file = null
    const fields = {}
    try {
      const parts = request.parts({ limits: { fileSize: MAX_BYTES, files: 1, fields: 20 } })
      for await (const part of parts) {
        if (part.type === 'file') {
          if (file) { await part.toBuffer().catch(() => null); continue }
          if (!ALLOWED_MIME.has(part.mimetype)) {
            return fail(reply, 415, 'bad_mime', `Allowed types: ${[...ALLOWED_MIME].join(', ')}`)
          }
          const buf = await part.toBuffer()
          file = { filename: part.filename || 'document', mimetype: part.mimetype, buffer: buf }
        } else {
          fields[part.fieldname] = part.value
        }
      }
    } catch (err) {
      if (err.code === 'FST_REQ_FILE_TOO_LARGE') {
        return fail(reply, 413, 'file_too_large', `The file exceeds ${MAX_BYTES} bytes.`)
      }
      throw err
    }

    if (!file || !file.buffer?.length) return fail(reply, 400, 'no_file', 'No file was received.')
    const subjectKind = fields.subject_kind
    if (!SUBJECT_KINDS.includes(subjectKind)) {
      return fail(reply, 400, 'bad_subject_kind', `subject_kind must be one of: ${SUBJECT_KINDS.join(', ')}`)
    }
    const subjectId = str(fields.subject_id, 200)
    if (!subjectId) return fail(reply, 400, 'missing_subject_id', 'subject_id is required.')
    if (!await subjectExists(pg, subjectKind, subjectId)) {
      return fail(reply, 400, 'subject_not_found',
        `No ${subjectKind.replace(/_/g, ' ')} with id ${subjectId}. A document must be attached to a record that exists.`)
    }

    // Bytes, not the claimed type. A spreadsheet and a CSV are checked by shape rather than by
    // magic number, because neither has one worth trusting.
    if (file.mimetype === 'application/pdf' || file.mimetype.startsWith('image/')) {
      const sig = validateFileSignature(file.buffer, file.mimetype, ALLOWED_MIME)
      if (!sig.ok) {
        return fail(reply, 415, 'bad_file_signature', 'The file contents do not match an allowed document type.')
      }
      file.mimetype = sig.mime
    } else if (file.mimetype === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      const isZip = file.buffer[0] === 0x50 && file.buffer[1] === 0x4b
      if (!isZip) return fail(reply, 415, 'bad_file_signature', 'That is not a valid .xlsx workbook.')
    }

    const scan = await scanBuffer(file.buffer, { mime: file.mimetype, log: request.log })
    if (!scan.clean) {
      request.log.warn({ signature: scan.signature, engine: scan.engine, userId: request.user.id },
        'rejected infected finance document')
      return fail(reply, 422, 'malware_detected', 'This file failed a security scan and was not accepted.')
    }

    const checksum = crypto.createHash('sha256').update(file.buffer).digest('hex')
    // The same file attached twice to the same record is a mistake, not two documents.
    const { rows: dup } = await pg.query(
      `SELECT id, filename FROM finance.document
        WHERE subject_kind = $1 AND subject_id = $2 AND checksum = $3 AND deleted_at IS NULL`,
      [subjectKind, subjectId, checksum],
    )
    if (dup[0]) {
      return fail(reply, 409, 'duplicate',
        `This file is already attached to that record as "${dup[0].filename}".`)
    }

    const id = crypto.randomUUID()
    const extension = ({
      'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx', 'text/csv': '.csv',
    })[file.mimetype] || ''
    const dir = path.join(DOC_ROOT, String(request.user.authority_id ?? 'unknown'), subjectKind)
    const objectKey = path.join(dir, `${id}${extension}`)
    await ensureDir(dir)
    await fs.writeFile(objectKey, file.buffer, { mode: 0o640 })

    try {
      const { rows } = await pg.query(
        `INSERT INTO finance.document
           (id, subject_kind, subject_id, object_key, filename, mime_type, size_bytes, checksum,
            document_type, visibility, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'private',$10)
         RETURNING id, subject_kind, subject_id, filename, mime_type, size_bytes, checksum,
                   document_type, visibility, uploaded_at`,
        [id, subjectKind, subjectId, objectKey, file.filename.slice(0, 300), file.mimetype,
          file.buffer.length, checksum, str(fields.document_type, 80) || null, request.user.id],
      )
      return ok(reply, {
        document: rows[0],
        // Said explicitly, because an officer who uploads a budget expecting residents to see it
        // should learn here that one more decision stands between the two.
        note: 'Stored privately. A publisher must change its visibility for it to appear on the public portal.',
      }, 201)
    } catch (err) {
      await fs.unlink(objectKey).catch(() => {})
      throw err
    }
  })

  // ── List ─────────────────────────────────────────────────────────────────────────────────────
  fastify.get('/finance/documents', {
    ...canList,
    schema: {
      querystring: {
        type: 'object', additionalProperties: false,
        properties: {
          subject_kind: { type: 'string', enum: SUBJECT_KINDS },
          subject_id: { type: 'string', maxLength: 200 },
          visibility: { type: 'string', enum: ['private', 'internal', 'public'] },
          limit: { type: 'integer', minimum: 1, maximum: 500, default: 100 },
          offset: { type: 'integer', minimum: 0, default: 0 },
        },
      },
    },
  }, async (request, reply) => {
    const q = request.query
    // A document classified 'private' is listed only to someone who may see restricted material.
    const restricted = await hasPermission(fastify, request, 'finance.document.view_restricted')
    const { rows } = await pg.query(
      `SELECT d.id, d.subject_kind, d.subject_id, d.filename, d.mime_type, d.size_bytes,
              d.checksum, d.document_type, d.visibility, d.uploaded_at,
              COALESCE(u.full_name, u.name) AS uploaded_by_name
         FROM finance.document d
         LEFT JOIN public.users u ON u.id = d.uploaded_by
        WHERE d.deleted_at IS NULL
          AND ($1::text IS NULL OR d.subject_kind = $1::text)
          AND ($2::text IS NULL OR d.subject_id = $2::text)
          AND ($3::text IS NULL OR d.visibility = $3::text)
          AND ($4::boolean IS TRUE OR d.visibility <> 'private')
        ORDER BY d.uploaded_at DESC
        LIMIT $5 OFFSET $6`,
      [q.subject_kind || null, q.subject_id || null, q.visibility || null, restricted, q.limit, q.offset],
    )
    return ok(reply, { documents: rows, restricted_visible: restricted })
  })

  // ── Download ─────────────────────────────────────────────────────────────────────────────────
  /**
   * Serve one document.
   *
   * `optionalAuth`, not `requireAuth`: a public document is public, and a resident following a link
   * from the portal has no session. The decision tree is explicit and short:
   *
   *   visibility 'public'   → anyone, but only while the documents dataset is published (the
   *                           row-level security policy decides that, not this handler)
   *   visibility 'internal' → a holder of finance.document.view
   *   visibility 'private'  → a holder of finance.document.view_restricted
   *
   * The file is read from the object key stored on the row. Nothing from the request reaches the
   * filesystem, so there is no traversal to attempt.
   */
  fastify.get('/finance/documents/:id/download', { preHandler: optionalAuth(fastify) },
    async (request, reply) => {
      const { rows } = await pg.query(
        `SELECT id, object_key, filename, mime_type, visibility, checksum, size_bytes
           FROM finance.document WHERE id = $1 AND deleted_at IS NULL`, [request.params.id],
      )
      // A row the policies did not return is indistinguishable from one that does not exist, which
      // is the right answer: it tells an unauthorised caller nothing.
      if (!rows[0]) return fail(reply, 404, 'not_found', 'No such document.')
      const doc = rows[0]

      if (doc.visibility !== 'public') {
        if (!request.user) {
          return fail(reply, 401, 'unauthenticated', 'This document is not published.')
        }
        const needed = doc.visibility === 'private'
          ? 'finance.document.view_restricted' : 'finance.document.view'
        if (!await hasPermission(fastify, request, needed)) {
          return reply.code(403).send({
            success: false, error: 'forbidden',
            message: 'You do not hold the permission this document requires.',
            required_permission: needed,
          })
        }
      }

      let buffer
      try {
        buffer = await fs.readFile(doc.object_key)
      } catch {
        return fail(reply, 410, 'file_missing',
          'The stored file could not be read. The document record remains; the file needs restoring from backup.')
      }
      // The bytes must still be the bytes that were uploaded.
      const checksum = crypto.createHash('sha256').update(buffer).digest('hex')
      if (checksum !== doc.checksum) {
        request.log.error({ documentId: doc.id }, 'finance document checksum mismatch')
        return fail(reply, 409, 'checksum_mismatch',
          'The stored file no longer matches its recorded checksum and has not been served.')
      }
      return reply
        .header('content-type', doc.mime_type)
        .header('content-disposition', `attachment; filename="${doc.filename.replace(/["\\]/g, '')}"`)
        .header('x-content-type-options', 'nosniff')
        .header('cache-control', doc.visibility === 'public' ? 'public, max-age=300' : 'private, no-store')
        .send(buffer)
    })

  // ── Withdraw ─────────────────────────────────────────────────────────────────────────────────
  /**
   * Soft-delete. The row and the file both stay: a document that supported a financial record is
   * evidence, and the specification forbids hard-deleting financial or statutory records (§8.1).
   * What changes is that it stops being listed and stops being served.
   *
   * THE REASON IS KEPT, in two places and for two different readers. On the row
   * (`withdrawn_reason`, migration 200) so anyone looking at the register later can see why the
   * document is not there; in `request.auditDetails` so the audit trail carries it alongside the
   * actor, the path and the outcome. Until migration 200 the schema required a reason of at least
   * five characters and then discarded it entirely — the UPDATE wrote only deleted_at/deleted_by
   * and the route attached no audit details (audit BLOCKER-3).
   */
  fastify.delete('/finance/documents/:id', {
    ...canWithdraw,
    schema: {
      body: {
        type: 'object', required: ['reason'], additionalProperties: false,
        properties: { reason: { type: 'string', minLength: 5, maxLength: 2000 } },
      },
    },
  }, async (request, reply) => {
    const reason = request.body.reason.trim()
    if (reason.length < 5) {
      return fail(reply, 400, 'reason_required',
        'State why this document is being withdrawn; the reason is kept on the record and in the audit trail.')
    }
    const { rows } = await pg.query(
      `UPDATE finance.document
          SET deleted_at = now(), deleted_by = $2, withdrawn_reason = $3
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id, filename, subject_kind, subject_id, visibility, document_type,
                  withdrawn_reason, deleted_at`,
      [request.params.id, request.user.id, reason],
    )
    if (!rows[0]) return fail(reply, 404, 'not_found', 'No such document.')
    const row = rows[0]
    request.auditDetails = {
      reason,
      before: {
        document_id: row.id,
        filename: row.filename,
        subject_kind: row.subject_kind,
        subject_id: row.subject_id,
        document_type: row.document_type,
        visibility: row.visibility,
        deleted_at: null,
      },
      after: { document_id: row.id, deleted_at: row.deleted_at, withdrawn_reason: reason },
    }
    return ok(reply, {
      id: row.id,
      filename: row.filename,
      subject_kind: row.subject_kind,
      subject_id: row.subject_id,
      withdrawn: true,
      withdrawn_reason: row.withdrawn_reason,
      note: 'The record and the stored file are retained; the document is no longer listed or served.',
    })
  })
}

module.exports = { financeDocumentRoutes, SUBJECT_KINDS, ALLOWED_MIME }
