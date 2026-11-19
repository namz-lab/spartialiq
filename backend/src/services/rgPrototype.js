/**
 * PROTOTYPE of a Registrar-General identity verification service (migration 258). The Registrar-General's side: it holds
 * the (fictional) population register and answers whether particulars a client sends AGREE with it. It never returns the
 * register's own data. Reached through src/routes/registrar-general-prototype.js, or in-process by the council's client
 * (src/services/registrarGeneral.js) when RG_MODE is 'prototype'.
 */
const crypto = require('node:crypto')

const DOCUMENT_TYPES = ['national_id', 'passport']
const PURPOSES = ['registration', 'verification_at_counter', 'online_verification', 'demonstration']

const normaliseNumber = (v) => (typeof v === 'string' ? v.replace(/[^A-Za-z0-9]/g, '').toUpperCase() : '')
const normaliseName = (v) => (typeof v === 'string' ? v.toUpperCase().replace(/[^A-Z\s'-]/g, ' ').replace(/\s+/g, ' ').trim() : '')
const sha256 = (v) => crypto.createHash('sha256').update(v, 'utf8').digest('hex')

/** Surname: agrees or not. */
function compareSurname(sent, held) {
  if (!sent) return 'not_supplied'
  return normaliseName(sent) === normaliseName(held) ? 'match' : 'no_match'
}

/**
 * First names: 'match' when the same; 'partial' when each name sent is one of the register's, in order, or its initial
 * ("J." for JABULANI, "SIBONGILE" for SIBONGILE THANDEKA); 'no_match' otherwise.
 */
function compareFirstNames(sent, held) {
  if (!sent) return 'not_supplied'
  const s = normaliseName(sent).replace(/['-]/g, ' ').split(' ').filter(Boolean)
  const h = normaliseName(held).replace(/['-]/g, ' ').split(' ').filter(Boolean)
  if (s.join(' ') === h.join(' ')) return 'match'
  let j = 0
  for (const word of s) {
    while (j < h.length && !(h[j] === word || (word.length === 1 && h[j].startsWith(word)))) j++
    if (j >= h.length) return 'no_match'
    j++
  }
  return 'partial'
}

function compareDate(sent, held) {
  if (!sent) return 'not_supplied'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(sent)) return 'no_match'
  // A date column arrives as local midnight: read its own day, never the UTC one (which in Zimbabwe is the day before).
  const d = held instanceof Date
    ? `${held.getFullYear()}-${String(held.getMonth() + 1).padStart(2, '0')}-${String(held.getDate()).padStart(2, '0')}`
    : String(held).slice(0, 10)
  return sent === d ? 'match' : 'no_match'
}

/** Check a request; returns a list of problems in words. */
function problemsOf(b) {
  const out = []
  if (!DOCUMENT_TYPES.includes(b.document_type)) out.push('document_type is national_id or passport.')
  if (!normaliseNumber(b.document_number)) out.push('document_number is required.')
  if (!b.surname || typeof b.surname !== 'string') out.push('surname is required: a document is never looked up without a name to compare.')
  if (b.date_of_birth != null && !/^\d{4}-\d{2}-\d{2}$/.test(b.date_of_birth)) out.push('date_of_birth is YYYY-MM-DD.')
  if (!PURPOSES.includes(b.purpose)) out.push(`purpose is one of ${PURPOSES.join(', ')}.`)
  return out
}

/** The client a key belongs to, or null. */
async function clientFor(db, key) {
  if (typeof key !== 'string' || key.length < 8) return null
  const { rows } = await db.query('SELECT id, name FROM rg_prototype.client WHERE key_sha256 = $1 AND active', [sha256(key)])
  return rows[0] || null
}

/**
 * Verify particulars against the register. `db` is a connection that can read rg_prototype (the system's, never a
 * council officer's). Returns the answer the Registrar-General gives, and logs the question on its side.
 */
async function verify(db, client, b) {
  const number = normaliseNumber(b.document_number)
  let held = null
  let documentStatus = null
  if (b.document_type === 'national_id') {
    held = (await db.query('SELECT * FROM rg_prototype.population_register WHERE national_id = $1', [number])).rows[0] || null
    if (held) documentStatus = held.status
  } else {
    const p = (await db.query(
      `SELECT p.status AS passport_status, p.expires_on, r.surname, r.first_names, r.date_of_birth, r.status AS holder_status
         FROM rg_prototype.passport p JOIN rg_prototype.population_register r ON r.national_id = p.national_id
        WHERE p.passport_no = $1`, [number])).rows[0]
    if (p) {
      held = p
      documentStatus = p.holder_status === 'holder_deceased' ? 'holder_deceased'
        : p.passport_status !== 'valid' ? p.passport_status
          : new Date(p.expires_on) < new Date(new Date().toISOString().slice(0, 10)) ? 'expired' : 'valid'
    }
  }

  let outcome = 'not_found'
  let fields = {}
  if (held) {
    fields = {
      surname: compareSurname(b.surname, held.surname),
      first_names: compareFirstNames(b.first_names, held.first_names),
      date_of_birth: compareDate(b.date_of_birth, held.date_of_birth),
    }
    const values = Object.values(fields)
    outcome = values.includes('no_match') ? 'no_match' : values.every((v) => v === 'match') ? 'match' : 'partial'
  }
  const sent = ['surname', 'first_names', 'date_of_birth'].filter((k) => b[k])
  const seq = (await db.query("SELECT nextval('rg_prototype.verification_no') AS n")).rows[0].n
  const reference = `RGV-${new Date().getFullYear()}-${String(seq).padStart(6, '0')}`
  const { rows } = await db.query(
    `INSERT INTO rg_prototype.verification (reference, client_id, document_type, document_number, particulars_sent, outcome,
                                            document_status, fields, purpose)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING requested_at`,
    [reference, client.id, b.document_type, number, sent, outcome, documentStatus, JSON.stringify(fields), b.purpose])
  return {
    reference,
    checked_at: rows[0].requested_at,
    document_type: b.document_type,
    document_found: !!held,
    document_status: documentStatus,
    fields,
    outcome,
  }
}

module.exports = { verify, clientFor, problemsOf, compareFirstNames, compareSurname, normaliseNumber, sha256, DOCUMENT_TYPES, PURPOSES }
