/**
 * The council's register of persons (migration 256): one record for each person or organisation the council deals with,
 * shared by every department.
 *
 *   GET   /api/persons/search?q=                  find before registering: by national ID, passport or company number
 *                                                (exact), phone (exact digits) or name (every word)
 *   GET   /api/persons/:id                        the person, their identifiers (masked unless ?reveal=1) and where they appear
 *                                                (applications, objections, receipts; user accounts are the system's, not shown)
 *   POST  /api/persons                            register a person (search first: refused if the ID is already registered,
 *                                                and if a person with the same phone or name exists unless confirm_new)
 *   PATCH /api/persons/:id                        correct contact details; record that the identity document was seen
 *   GET   /api/persons/unlinked                   applicants and objectors still recorded only as text
 *   PUT   /api/permit-applications/:id/applicant-person   link an application's applicant to the register
 *   PUT   /api/objections/:id/objector-person             link an objection's objector to the register
 *
 * Who: the posts that meet people at the counter register them (the planning clerk, the cashier, the revenue officer and
 * the planning officers). An identity number is personal information (Cyber and Data Protection Act [Chapter 12:07]): it is
 * shown masked, revealed in full only to the posts that register people, and every reveal is logged.
 * Every query runs as the person asking (row-level security), so each council sees only its own register.
 */
const { requireRole } = require('../middleware/jwtAuth')

const REGISTRARS = ['planning_clerk', 'planner', 'eo', 'cashier', 'cash_supervisor', 'revenue_officer', 'finance_officer', 'admin']
const READERS = [...REGISTRARS, 'accounting_officer', 'engineer', 'civil_technician', 'finance_admin']
const REVEALERS = ['planning_clerk', 'eo', 'cashier', 'cash_supervisor', 'revenue_officer', 'admin']
const LINKERS = ['planning_clerk', 'planner', 'eo', 'admin']

const KINDS = ['individual', 'organisation']
const TITLES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Dr', 'Prof', 'Rev', 'Chief']
const CHANNELS = ['sms', 'email', 'post', 'collect']
const ID_KINDS = ['national_id', 'passport', 'company_registration']

const isUuid = (v) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)
const text = (v, max) => (typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, max) : null)
const normalise = (v) => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '')
const digits = (v) => (typeof v === 'string' ? v.replace(/\D/g, '') : '')
const WELL_FORMED = {
  national_id: /^[0-9]{2}[0-9]{6,7}[A-Z][0-9]{2}$/,
  passport: /^[A-Z0-9]{6,12}$/,
  company_registration: /^[A-Z0-9]{3,20}$/,
}
const wellFormed = (kind, value) => !!WELL_FORMED[kind] && WELL_FORMED[kind].test(normalise(value))

/** 631234567X63 → 63-1234567 X 63; other kinds as stored. */
function formatId(kind, v) {
  if (kind !== 'national_id') return v
  const m = /^([0-9]{2})([0-9]{6,7})([A-Z])([0-9]{2})$/.exec(v)
  return m ? `${m[1]}-${m[2]} ${m[3]} ${m[4]}` : v
}
/** Keep the first two and last three characters: 63-•••••••X63. */
function maskId(kind, v) {
  if (!v) return v
  if (v.length <= 5) return '•'.repeat(v.length)
  const masked = v.slice(0, 2) + '•'.repeat(v.length - 5) + v.slice(-3)
  return kind === 'national_id' ? `${masked.slice(0, 2)}-${masked.slice(2)}` : masked
}

const PERSON_COLS = `p.id, p.kind, p.title, p.surname, p.first_names, p.organisation_name, p.display_name, p.phone, p.alt_phone,
  p.email, p.physical_address, p.postal_address, p.ward_no, p.preferred_channel, p.source, p.verified_at, p.verified_how,
  p.notes, p.status, p.merged_into, p.created_at, p.updated_at`

/** Check a person's details; returns the problems found, in words for the officer, and the clean values. */
function readPerson(b, { partial = false } = {}) {
  const out = {}
  const problems = []
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k)
  if (!partial || has('kind')) {
    out.kind = b.kind === undefined && !partial ? 'individual' : b.kind
    if (!KINDS.includes(out.kind)) problems.push('Say whether this is an individual or an organisation.')
  }
  if (has('title')) {
    out.title = b.title === null || b.title === '' ? null : b.title
    if (out.title !== null && !TITLES.includes(out.title)) problems.push(`The title is one of ${TITLES.join(', ')}.`)
  }
  for (const [k, max] of [['surname', 120], ['first_names', 160], ['organisation_name', 200], ['physical_address', 500],
    ['postal_address', 500], ['notes', 2000]]) if (has(k)) out[k] = text(b[k], max)
  for (const k of ['phone', 'alt_phone']) {
    if (!has(k)) continue
    out[k] = text(b[k], 40)
    if (out[k] && digits(out[k]).length < 7) problems.push('A phone number has at least 7 digits.')
  }
  if (has('email')) {
    out.email = text(b.email, 255)
    if (out.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(out.email)) problems.push('The email address is not one that can be written to.')
  }
  if (has('ward_no')) {
    out.ward_no = b.ward_no === null || b.ward_no === '' ? null : Number(b.ward_no)
    if (out.ward_no !== null && !(Number.isInteger(out.ward_no) && out.ward_no >= 1 && out.ward_no <= 99)) problems.push('The ward is a number from 1 to 99.')
  }
  if (has('preferred_channel') || !partial) {
    out.preferred_channel = b.preferred_channel ?? 'post'
    if (!CHANNELS.includes(out.preferred_channel)) problems.push('Say how letters reach them: SMS, email, post, or collected at the office.')
    // A correction is checked against the whole record by the caller; a new record here.
    if (!partial && out.preferred_channel === 'email' && !out.email) problems.push('Letters by email need an email address.')
    if (!partial && out.preferred_channel === 'sms' && !out.phone) problems.push('Letters by SMS need a phone number.')
  }
  if (!partial) {
    if (out.kind === 'individual' && !(out.surname && out.surname.length >= 2)) problems.push('An individual is registered with a surname.')
    if (out.kind === 'organisation' && !(out.organisation_name && out.organisation_name.length >= 2)) problems.push('An organisation is registered with its name.')
    if (out.kind === 'organisation') out.title = null
  }
  return { values: out, problems }
}

function readIdentifiers(list) {
  const problems = []
  const ids = []
  if (list === undefined || list === null) return { ids, problems }
  if (!Array.isArray(list) || list.length > 5) return { ids, problems: ['The identity numbers are a list of at most five.'] }
  for (const i of list) {
    if (!i || !ID_KINDS.includes(i.kind)) { problems.push('Each identity number is a national ID, a passport or a company registration.'); continue }
    if (!wellFormed(i.kind, i.value)) {
      problems.push(i.kind === 'national_id'
        ? 'The national ID does not read as one: two digits, six or seven digits, a letter and two digits (63-123456 X 27).'
        : `The ${i.kind === 'passport' ? 'passport' : 'company registration'} number cannot be read.`)
      continue
    }
    if (ids.some((x) => x.kind === i.kind)) { problems.push('Give each kind of identity number once.'); continue }
    ids.push({ kind: i.kind, value: normalise(i.value) })
  }
  return { ids, problems }
}

async function personsRoutes(fastify) {
  const pg = fastify.pg

  async function identifiersOf(db, personIds) {
    if (!personIds.length) return new Map()
    const { rows } = await db.query(
      'SELECT person_id, kind, value FROM registry.person_identifier WHERE person_id = ANY($1::uuid[]) ORDER BY kind', [personIds])
    const map = new Map()
    for (const r of rows) {
      if (!map.has(r.person_id)) map.set(r.person_id, [])
      map.get(r.person_id).push(r)
    }
    return map
  }
  const shownIds = (rows, reveal) => (rows || []).map((r) => ({
    kind: r.kind, value: reveal ? formatId(r.kind, r.value) : maskId(r.kind, r.value), masked: !reveal,
  }))

  /** The people who might be this one: same identifier, same phone, or the same name. */
  async function candidates(db, { ids = [], phone = null, surname = null, firstNames = null, organisation = null }) {
    const found = new Map()
    const add = (rows, reason) => { for (const r of rows) if (!found.has(r.id)) found.set(r.id, { ...r, match: reason }) }
    for (const i of ids) {
      add((await db.query(
        `SELECT ${PERSON_COLS} FROM registry.person p JOIN registry.person_identifier i ON i.person_id = p.id
          WHERE i.kind = $1 AND i.value = $2`, [i.kind, i.value])).rows, i.kind)
    }
    const d = digits(phone || '')
    if (d.length >= 7) {
      add((await db.query(
        `SELECT ${PERSON_COLS} FROM registry.person p
          WHERE p.status = 'active' AND (right(regexp_replace(p.phone, '[^0-9]', '', 'g'), 9) = right($1, 9)
             OR right(regexp_replace(p.alt_phone, '[^0-9]', '', 'g'), 9) = right($1, 9)) LIMIT 10`, [d])).rows, 'phone')
    }
    if (surname) {
      add((await db.query(
        `SELECT ${PERSON_COLS} FROM registry.person p
          WHERE p.status = 'active' AND lower(p.surname) = lower($1)
            AND ($2::text IS NULL OR p.first_names IS NULL OR lower(left(p.first_names, 1)) = lower(left($2, 1))) LIMIT 10`,
        [surname, firstNames])).rows, 'name')
    }
    if (organisation) {
      add((await db.query(
        `SELECT ${PERSON_COLS} FROM registry.person p WHERE p.status = 'active' AND lower(p.organisation_name) = lower($1) LIMIT 10`,
        [organisation])).rows, 'name')
    }
    return [...found.values()]
  }

  /** Where each person appears: applications, objections, receipts. */
  async function linkCounts(db, personIds) {
    if (!personIds.length) return new Map()
    const { rows } = await db.query(
      `SELECT id,
              (SELECT count(*)::int FROM spatial_planning.permit_application a WHERE a.applicant_person_id = x.id) AS applications,
              (SELECT count(*)::int FROM spatial_planning.application_objection o WHERE o.objector_person_id = x.id) AS objections,
              (SELECT count(*)::int FROM registry.receipt_payer r WHERE r.person_id = x.id) AS receipts
         FROM unnest($1::uuid[]) AS x(id)`, [personIds])
    return new Map(rows.map((r) => [r.id, r]))
  }

  async function present(db, rows, reveal = false) {
    const ids = rows.map((r) => r.id)
    const [idents, counts] = await Promise.all([identifiersOf(db, ids), linkCounts(db, ids)])
    return rows.map((r) => {
      const c = counts.get(r.id) || {}
      return {
        ...r,
        verified: !!r.verified_at,
        identifiers: shownIds(idents.get(r.id), reveal),
        appears_as: { applications: c.applications || 0, objections: c.objections || 0, receipts: c.receipts || 0 },
      }
    })
  }

  fastify.get('/persons/search', { preHandler: requireRole(fastify, READERS) }, async (request, reply) => {
    const q = text(request.query.q, 120)
    if (!q || q.length < 2) return reply.code(400).send({ success: false, error: 'query_too_short', message: 'Type at least two characters: a name, a phone number or an ID number.' })
    const n = normalise(q)
    // A name is not an identity number: a number has digits in it.
    const ids = /[0-9]/.test(n) ? ID_KINDS.filter((k) => wellFormed(k, q)).map((k) => ({ kind: k, value: n })) : []
    const d = digits(q)
    const found = new Map()
    const add = (rows, reason) => { for (const r of rows) if (!found.has(r.id)) found.set(r.id, { ...r, match: reason }) }
    for (const r of await candidates(pg, { ids, phone: d.length >= 7 && d.length === q.replace(/[\s+()-]/g, '').length ? q : null })) add([r], r.match)
    const words = q.toLowerCase().split(' ').filter((w) => w.length >= 2 && !/^(mr|mrs|ms|miss|dr|prof|rev)\.?$/.test(w)).slice(0, 4)
    if (words.length && !/^[0-9]/.test(q)) {
      const params = words.map((w) => `%${w.replace(/[%_\\]/g, '\\$&')}%`)
      const where = params.map((_, i) => `lower(p.display_name) LIKE $${i + 1}`).join(' AND ')
      add((await pg.query(
        `SELECT ${PERSON_COLS} FROM registry.person p WHERE p.status = 'active' AND ${where}
          ORDER BY p.surname NULLS LAST, p.first_names NULLS LAST, p.organisation_name LIMIT 20`, params)).rows, 'name')
    }
    const rows = [...found.values()].slice(0, 20)
    return reply.send({ success: true, data: { persons: await present(pg, rows), searched_as: ids.length ? ids[0].kind : (d.length >= 7 ? 'phone' : 'name') } })
  })

  fastify.get('/persons/unlinked', { preHandler: requireRole(fastify, LINKERS) }, async (request, reply) => {
    const role = ['applicant', 'objector'].includes(request.query.role) ? request.query.role : null
    const { rows } = await pg.query(
      `SELECT role, record_id, name_as_written, (id_number_as_written IS NOT NULL) AS has_id_number, phone_as_written, reference, recorded_at
         FROM registry.v_unlinked WHERE ($1::text IS NULL OR role = $1)
        ORDER BY recorded_at DESC LIMIT 200`, [role])
    const { rows: [t] } = await pg.query('SELECT count(*)::int AS n FROM registry.v_unlinked WHERE ($1::text IS NULL OR role = $1)', [role])
    return reply.send({ success: true, data: { total: t.n, records: rows } })
  })

  fastify.get('/persons/:id', { preHandler: requireRole(fastify, READERS) }, async (request, reply) => {
    if (!isUuid(request.params.id)) return reply.code(400).send({ success: false, error: 'bad_id' })
    const reveal = request.query.reveal === '1' || request.query.reveal === 'true'
    if (reveal && !REVEALERS.includes(request.user.role)) {
      return reply.code(403).send({ success: false, error: 'not_allowed', message: 'Your post sees identity numbers masked.' })
    }
    const row = (await pg.query(`SELECT ${PERSON_COLS} FROM registry.person p WHERE p.id = $1`, [request.params.id])).rows[0]
    if (!row) return reply.code(404).send({ success: false, error: 'not_found', message: 'No person with that reference in this council\'s register.' })
    const [person] = await present(pg, [row], reveal)
    const [applications, objections, receipts] = await Promise.all([
      pg.query(
        `SELECT id, tpd_reference, dev_register_no, stand_number, development_type, status, received_at
           FROM spatial_planning.permit_application WHERE applicant_person_id = $1 ORDER BY received_at DESC NULLS LAST LIMIT 50`, [row.id]),
      pg.query(
        `SELECT o.id, o.received_at, o.sustained, p.id AS permit_app_id, p.tpd_reference, p.stand_number
           FROM spatial_planning.application_objection o JOIN spatial_planning.permit_application p ON p.id = o.permit_app_id
          WHERE o.objector_person_id = $1 ORDER BY o.received_at DESC LIMIT 50`, [row.id]),
      // A receipt is the cash office's: a post that cannot read receipts sees how many, not what.
      pg.query(
        `SELECT r.id, r.receipt_no, r.amount, r.currency, r.received_on
           FROM registry.receipt_payer x JOIN finance.cash_receipt r ON r.id = x.receipt_id
          WHERE x.person_id = $1 ORDER BY r.received_on DESC LIMIT 50`, [row.id]).catch(() => ({ rows: null })),
    ])
    if (reveal) {
      request.auditDetails = { action: 'person_identity_revealed', person_id: row.id }
      request.log.info({ person_id: row.id, user_id: request.user.id }, 'person identity number revealed')
    }
    return reply.send({
      success: true,
      data: { person, applications: applications.rows, objections: objections.rows, receipts: receipts.rows },
    })
  })

  fastify.post('/persons', { preHandler: requireRole(fastify, REGISTRARS) }, async (request, reply) => {
    const b = request.body || {}
    const { values, problems } = readPerson(b)
    const { ids, problems: idProblems } = readIdentifiers(b.identifiers)
    const verified = b.verified === true
    const verifiedHow = text(b.verified_how, 200)
    if (verified && !(verifiedHow && verifiedHow.length >= 3)) problems.push('Say which identity document was seen.')
    if (verified && !ids.length) problems.push('A person whose identity document was seen is registered with its number.')
    const all = [...problems, ...idProblems]
    if (all.length) return reply.code(400).send({ success: false, error: 'incomplete', message: all.join(' '), problems: all })

    const same = await candidates(pg, {
      ids, phone: values.phone, surname: values.kind === 'individual' ? values.surname : null,
      firstNames: values.first_names, organisation: values.kind === 'organisation' ? values.organisation_name : null,
    })
    const byId = same.filter((c) => ID_KINDS.includes(c.match))
    if (byId.length) {
      return reply.code(409).send({
        success: false, error: 'already_registered',
        message: `That identity number is already registered, to ${byId[0].display_name}. Use that record.`,
        data: { persons: await present(pg, byId) },
      })
    }
    if (same.length && b.confirm_new !== true) {
      return reply.code(409).send({
        success: false, error: 'possible_duplicate',
        message: 'A person with the same phone number or name is already registered. If none of them is this person, register them as new.',
        data: { persons: await present(pg, same) },
      })
    }

    let created
    try {
      created = await pg.transact(async (client) => {
        const row = (await client.query(
          `INSERT INTO registry.person (kind, title, surname, first_names, organisation_name, phone, alt_phone, email, physical_address,
                                        postal_address, ward_no, preferred_channel, source, verified_at, verified_by, verified_how,
                                        notes, created_by, updated_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'counter',$13,$14,$15,$16,$17,$17)
           RETURNING id`,
          [values.kind, values.title ?? null, values.kind === 'individual' ? values.surname : null,
            values.kind === 'individual' ? values.first_names ?? null : null,
            values.kind === 'organisation' ? values.organisation_name : null,
            values.phone ?? null, values.alt_phone ?? null, values.email ?? null, values.physical_address ?? null,
            values.postal_address ?? null, values.ward_no ?? null, values.preferred_channel,
            verified ? new Date() : null, verified ? request.user.id : null, verified ? verifiedHow : null,
            values.notes ?? null, request.user.id])).rows[0]
        for (const i of ids) {
          await client.query(
            'INSERT INTO registry.person_identifier (person_id, kind, value, created_by) VALUES ($1, $2, $3, $4)',
            [row.id, i.kind, i.value, request.user.id])
        }
        return (await client.query(`SELECT ${PERSON_COLS} FROM registry.person p WHERE p.id = $1`, [row.id])).rows[0]
      })
    } catch (err) {
      if (err.code === '23505') return reply.code(409).send({ success: false, error: 'already_registered', message: 'That identity number was registered a moment ago. Search again.' })
      throw err
    }
    request.auditDetails = { action: 'person_registered', person_id: created.id, verified, identifiers: ids.map((i) => i.kind) }
    const [person] = await present(pg, [created], REVEALERS.includes(request.user.role))
    return reply.code(201).send({ success: true, data: { person } })
  })

  fastify.patch('/persons/:id', { preHandler: requireRole(fastify, REGISTRARS) }, async (request, reply) => {
    if (!isUuid(request.params.id)) return reply.code(400).send({ success: false, error: 'bad_id' })
    const b = request.body || {}
    const current = (await pg.query(`SELECT ${PERSON_COLS} FROM registry.person p WHERE p.id = $1`, [request.params.id])).rows[0]
    if (!current) return reply.code(404).send({ success: false, error: 'not_found', message: 'No person with that reference in this council\'s register.' })
    if (current.status === 'merged') return reply.code(409).send({ success: false, error: 'merged', message: 'This record was merged into another. Correct that one.' })
    // A person's kind is fixed once registered: an individual does not become an organisation.
    const { kind: _kind, ...changes } = b
    const { values, problems } = readPerson(changes, { partial: true })
    const { ids, problems: idProblems } = readIdentifiers(b.identifiers)
    const verify = b.verified === true
    const verifiedHow = text(b.verified_how, 200)
    if (verify && !(verifiedHow && verifiedHow.length >= 3)) problems.push('Say which identity document was seen.')
    const merged = { ...current, ...values }
    if (merged.kind === 'individual' && !(merged.surname && merged.surname.length >= 2)) problems.push('An individual keeps a surname.')
    if (merged.kind === 'organisation' && !(merged.organisation_name && merged.organisation_name.length >= 2)) problems.push('An organisation keeps its name.')
    if (merged.preferred_channel === 'email' && !merged.email) problems.push('Letters by email need an email address.')
    if (merged.preferred_channel === 'sms' && !merged.phone) problems.push('Letters by SMS need a phone number.')
    const all = [...problems, ...idProblems]
    if (all.length) return reply.code(400).send({ success: false, error: 'incomplete', message: all.join(' '), problems: all })

    const sets = Object.keys(values)
    let updated
    try {
      updated = await pg.transact(async (client) => {
        const params = sets.map((k) => values[k])
        const assigns = sets.map((k, i) => `${k} = $${i + 2}`)
        if (verify) {
          params.push(request.user.id, verifiedHow)
          assigns.push(`verified_at = now(), verified_by = $${params.length}, verified_how = $${params.length + 1}`)
        }
        params.push(request.user.id)
        assigns.push(`updated_at = now(), updated_by = $${params.length + 1}`)
        await client.query(`UPDATE registry.person SET ${assigns.join(', ')} WHERE id = $1`, [current.id, ...params])
        for (const i of ids) {
          const has = (await client.query('SELECT value FROM registry.person_identifier WHERE person_id = $1 AND kind = $2', [current.id, i.kind])).rows[0]
          if (has && has.value !== i.value) {
            const e = new Error('identifier_differs')
            e.userMessage = 'This person already has a different number of that kind. Ask the system administrator to correct it.'
            throw e
          }
          if (!has) await client.query('INSERT INTO registry.person_identifier (person_id, kind, value, created_by) VALUES ($1,$2,$3,$4)', [current.id, i.kind, i.value, request.user.id])
        }
        if (verify && !(await client.query('SELECT 1 FROM registry.person_identifier WHERE person_id = $1', [current.id])).rows.length) {
          const e = new Error('verify_without_id')
          e.userMessage = 'Record the number of the identity document that was seen.'
          throw e
        }
        return (await client.query(`SELECT ${PERSON_COLS} FROM registry.person p WHERE p.id = $1`, [current.id])).rows[0]
      })
    } catch (err) {
      if (err.userMessage) return reply.code(409).send({ success: false, error: err.message, message: err.userMessage })
      if (err.code === '23505') return reply.code(409).send({ success: false, error: 'already_registered', message: 'That identity number is registered to someone else.' })
      throw err
    }
    request.auditDetails = { action: 'person_updated', person_id: current.id, fields: sets, verified: verify, identifiers_added: ids.map((i) => i.kind) }
    const [person] = await present(pg, [updated], REVEALERS.includes(request.user.role))
    return reply.send({ success: true, data: { person } })
  })

  /** Link a record's person. The text on the record stays as written; the link says who it is. */
  async function link(request, reply, { table, column, label }) {
    if (!isUuid(request.params.id)) return reply.code(400).send({ success: false, error: 'bad_id' })
    const personId = request.body?.person_id
    if (personId !== null && !isUuid(personId)) return reply.code(400).send({ success: false, error: 'bad_person', message: 'Choose a person from the register.' })
    if (personId) {
      const p = (await pg.query('SELECT status FROM registry.person WHERE id = $1', [personId])).rows[0]
      if (!p) return reply.code(404).send({ success: false, error: 'person_not_found', message: 'No person with that reference in this council\'s register.' })
      if (p.status === 'merged') return reply.code(409).send({ success: false, error: 'merged', message: 'That record was merged into another. Choose the other one.' })
    }
    const { rows } = await pg.query(`UPDATE ${table} SET ${column} = $2 WHERE id = $1 RETURNING id, ${column}`, [request.params.id, personId])
    if (!rows.length) return reply.code(404).send({ success: false, error: 'not_found', message: `No ${label} with that reference.` })
    request.auditDetails = { action: `${label}_person_linked`, record_id: request.params.id, person_id: personId }
    return reply.send({ success: true, data: rows[0] })
  }
  fastify.put('/permit-applications/:id/applicant-person', { preHandler: requireRole(fastify, LINKERS) },
    (request, reply) => link(request, reply, { table: 'spatial_planning.permit_application', column: 'applicant_person_id', label: 'application' }))
  fastify.put('/objections/:id/objector-person', { preHandler: requireRole(fastify, LINKERS) },
    (request, reply) => link(request, reply, { table: 'spatial_planning.application_objection', column: 'objector_person_id', label: 'objection' }))
}

module.exports = { personsRoutes, maskId, formatId, wellFormed, normalise, REGISTRARS, REVEALERS }
