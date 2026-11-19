/**
 * How sure the council is of who a person is, and whether they are resident (migration 257). One set of rules for every
 * way evidence arrives: the counter (persons.js), an officer approving an uploaded document (documents.js), and the deeds
 * registry check (residency.js).
 *
 *   0 Recorded            a name as given
 *   1 Identity verified   a copy approved by an officer, or the original seen
 *   2 Resident/ratepayer  identity verified and residence proved
 *   3 Original sighted    the original identity document handled at the counter
 *
 * Only the registrar's desks raise a level: the planning clerk, with the cash supervisor and the administrator as back-up.
 * Every change is written to registry.assurance_event.
 */
const registrarGeneral = require('./registrarGeneral')

const VERIFIERS = ['planning_clerk', 'cash_supervisor', 'admin']

const LEVELS = [
  { level: 0, label: 'Recorded', means: 'A name as given; nothing checked.' },
  { level: 1, label: 'Identity verified', means: 'The identity document was checked: a copy approved by an officer, or the original seen.' },
  { level: 2, label: 'Resident or ratepayer', means: 'Identity verified, and residence in the district proved.' },
  { level: 3, label: 'Original sighted', means: 'The original identity document was handled at the counter.' },
]
const levelLabel = (n) => (LEVELS[n] || LEVELS[0]).label

const RESIDENCY_EVIDENCE = {
  title_deed: 'Title deed',
  occupation_certificate: 'Certificate of occupation',
  lodgers_permit: "Lodger's permit",
  settlement_letter: 'Offer or settlement letter',
  proof_of_residence: 'Rates or utility statement',
  chiefs_letter: 'Letter from the councillor, village head, headman or chief',
}

/** The latest Registrar-General check of each of a person's documents; returns the one that blocks, with why, or null. */
async function rgBlock(db, personId) {
  const { rows } = await db.query(
    `SELECT DISTINCT ON (document_type, document_number) document_type, document_number, outcome, document_status, rg_reference, requested_at
       FROM registry.identity_check WHERE person_id = $1 AND outcome <> 'unavailable'
      ORDER BY document_type, document_number, requested_at DESC`, [personId])
  for (const c of rows) {
    const why = registrarGeneral.blocks(c)
    if (why) return { check: c, reason: why }
  }
  return null
}

async function recordEvent(db, personId, { event, method = null, evidence = null, documentId = null, checkId = null, by = null, role = null }) {
  await db.query(
    // The person's own council: the online routes run on the system connection, which has none.
    `INSERT INTO registry.assurance_event (authority_id, person_id, event, method, evidence, document_id, check_id, level_after, recorded_by, recorded_role)
     SELECT p.authority_id, $1, $2, $3, $4, $5, $6, p.assurance_level, $7, $8 FROM registry.person p WHERE p.id = $1`,
    [personId, event, method, evidence, documentId, checkId, by, role])
}

/**
 * Identity verified. `method` 'original_sighted' (the counter) also records the original as seen, which is level 3.
 * Refused (returns a reason) when a Registrar-General check says the document is not theirs or not valid.
 */
async function verifyIdentity(db, personId, { method, how, by, role, documentId = null }) {
  const blocked = await rgBlock(db, personId)
  if (blocked) return { refused: blocked.reason }
  if (method === 'original_sighted') {
    await db.query(
      `UPDATE registry.person SET verified_at = COALESCE(verified_at, now()), verified_by = COALESCE(verified_by, $2),
              verified_how = $3, identity_method = 'original_sighted', original_sighted_at = now(), original_sighted_by = $2,
              updated_at = now(), updated_by = $2
        WHERE id = $1`, [personId, by, how])
    await recordEvent(db, personId, { event: 'original_sighted', method, evidence: how, by, role })
  } else {
    const { rowCount } = await db.query(
      `UPDATE registry.person SET verified_at = now(), verified_by = $2, verified_how = $3, identity_method = 'copy_approved',
              updated_at = now(), updated_by = $2
        WHERE id = $1 AND verified_at IS NULL`, [personId, by, how])
    if (rowCount) await recordEvent(db, personId, { event: 'identity_verified', method, evidence: how, documentId, by, role })
  }
  return { refused: null }
}

/** Residence proved. */
async function verifyResidency(db, personId, { method, evidence, by, role, documentId = null }) {
  const { rowCount } = await db.query(
    `UPDATE registry.person SET residency_verified_at = now(), residency_verified_by = $2, residency_method = $3,
            residency_evidence = $4, residency_document_id = $5, updated_at = now(), updated_by = $2
      WHERE id = $1 AND residency_verified_at IS NULL`, [personId, by, method, evidence, documentId])
  if (rowCount) await recordEvent(db, personId, { event: 'residency_verified', method, evidence, documentId, by, role })
  return rowCount > 0
}

/**
 * An officer approved a document a citizen uploaded (documents.js). Raises the citizen's person when the officer is one
 * of the registrar's desks; says what it did, in words, for the officer.
 */
async function fromApprovedDocument(sys, { userId, docKind, docId, officer }) {
  const person = (await sys.query('SELECT person_id FROM public.users WHERE id = $1', [userId])).rows[0]?.person_id
  if (!person) return 'The citizen is not yet in the register of persons.'
  const isIdentity = ['national_id', 'passport'].includes(docKind)
  const isResidency = !!RESIDENCY_EVIDENCE[docKind]
  if (!isIdentity && !isResidency) return null
  if (!VERIFIERS.includes(officer.role)) return 'Approved. The planning clerk raises the person\'s level in the register.'
  if (isIdentity) {
    const r = await verifyIdentity(sys, person, {
      method: 'copy_approved', how: `Copy of the ${docKind.replace('_', ' ')} approved online`, by: officer.id, role: officer.role, documentId: docId,
    })
    return r.refused ? `Approved, but the person's identity is not verified: ${r.refused}` : 'The person\'s identity is verified in the register.'
  }
  await verifyResidency(sys, person, { method: 'document_review', evidence: RESIDENCY_EVIDENCE[docKind], by: officer.id, role: officer.role, documentId: docId })
  return 'The person\'s residence is verified in the register.'
}

/**
 * A citizen signed up online: they join the register at level 0 (source 'online'), and their account is linked to the
 * person. Their national ID is recorded when well formed and not already someone else's; it is then checked with the
 * Registrar-General when a service is connected. Never makes the sign-up fail: returns what happened, in words.
 * `sys` is the system connection (a citizen's sign-up has no council session).
 */
async function fromOnlineSignUp(sys, pg, user) {
  const authority = (await sys.query(
    `SELECT COALESCE((SELECT authority_id FROM public.users WHERE id = $1), (SELECT id FROM public.local_authorities WHERE code = 'VUNGU')) AS id`,
    [user.id])).rows[0].id
  if (!authority) return { linked: false, note: 'No council to register the person with.' }
  const n = (await sys.query('SELECT (registry.name_parts($1)).*', [user.name || ''])).rows[0]
  if (!n.surname || n.surname.length < 2) return { linked: false, note: 'The name is too short to register.' }
  const nid = user.national_id && (await sys.query(
    `SELECT CASE WHEN registry.identifier_well_formed('national_id', $1) THEN registry.normalise_identifier($1) END AS v`, [user.national_id])).rows[0].v
  const taken = nid && (await sys.query(
    `SELECT 1 FROM registry.person_identifier WHERE authority_id = $1 AND kind = 'national_id' AND value = $2`, [authority, nid])).rows.length
  const client = await sys.connect()
  let personId
  try {
    await client.query('BEGIN')
    personId = (await client.query(
      `INSERT INTO registry.person (authority_id, kind, title, surname, first_names, phone, email, physical_address, source, notes)
       VALUES ($1, 'individual', $2, $3, $4, $5, $6, $7, 'online', $8) RETURNING id`,
      [authority, n.title, n.surname, n.first_names, user.phone || null, user.email || null, user.physical_address || null,
        taken ? 'Signed up online giving a national ID already in the register: to be confirmed at the counter.' : 'Signed up online.'])).rows[0].id
    if (nid && !taken) {
      await client.query(`INSERT INTO registry.person_identifier (authority_id, person_id, kind, value) VALUES ($1, $2, 'national_id', $3)`, [authority, personId, nid])
    }
    await client.query(
      `INSERT INTO registry.assurance_event (authority_id, person_id, event, method, evidence, level_after) VALUES ($1, $2, 'registered', 'online', 'Account signed up online', 0)`,
      [authority, personId])
    await client.query('UPDATE public.users SET person_id = $2 WHERE id = $1', [user.id, personId])
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
  // Ask the Registrar-General about the ID they gave, when a service is connected. The answer is kept for the clerk.
  if (nid && !taken) {
    const a = await registrarGeneral.check(pg, { document_type: 'national_id', document_number: nid, surname: n.surname, first_names: n.first_names, purpose: 'online_verification' })
    if (a.outcome !== 'unavailable') {
      await sys.query(
        `INSERT INTO registry.identity_check (authority_id, person_id, document_type, document_number, sent, outcome, document_status, fields, rg_reference, service, purpose)
         VALUES ($1, $2, 'national_id', $3, $4, $5, $6, $7, $8, $9, 'online_verification')`,
        [authority, personId, nid, JSON.stringify({ surname: true, first_names: !!n.first_names, date_of_birth: false }), a.outcome,
          a.document_status || null, JSON.stringify(a.fields || {}), a.reference || null, a.service])
    }
  }
  return { linked: true, person_id: personId, id_already_registered: !!taken }
}

module.exports = {
  fromOnlineSignUp, VERIFIERS, LEVELS, levelLabel, RESIDENCY_EVIDENCE, rgBlock, recordEvent, verifyIdentity, verifyResidency, fromApprovedDocument }
