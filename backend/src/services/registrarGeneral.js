/**
 * The council's client for the Registrar-General's identity verification service (registry.identity_check, migration 257).
 *
 * RG_MODE
 *   off        no service: a check answers 'unavailable' and says so. The default in production, until the Registrar-General
 *              provides a real service. The live system runs this way.
 *   prototype  the in-house PROTOTYPE (migration 258, src/services/rgPrototype.js), called in-process with the council's
 *              demonstration key. The default elsewhere when the prototype is installed.
 *   http       a service at RG_API_URL (the prototype served by another LAMIS, or the real one), with RG_CLIENT_KEY.
 *
 * The answer is recorded on the council's side as an identity_check: what was sent, the outcome and the reference.
 */
const { systemOf } = require('../lib/dbContext')
const rgPrototype = require('./rgPrototype')

const PROTOTYPE_KEY = 'rg-prototype-vungu-demo-key'
const TIMEOUT_MS = 8000

function mode(env = process.env) {
  const m = String(env.RG_MODE || '').trim().toLowerCase()
  if (['off', 'prototype', 'http'].includes(m)) return m
  return env.NODE_ENV === 'production' ? 'off' : 'prototype'
}

/** Is a check possible here, and how is it made? For the screens. */
async function status(pg, env = process.env) {
  const m = mode(env)
  if (m === 'off') return { available: false, mode: m, label: 'The Registrar-General check is not connected on this system.' }
  if (m === 'http') return { available: !!env.RG_API_URL, mode: m, label: env.RG_API_URL ? 'Registrar-General service' : 'RG_API_URL is not set.' }
  const ok = (await systemOf(pg).query(`SELECT to_regclass('rg_prototype.population_register') IS NOT NULL AS ok`)).rows[0].ok
  return { available: ok, mode: m, prototype: true, label: ok ? 'Registrar-General PROTOTYPE (fictional register, for demonstration)' : 'The prototype is not installed.' }
}

/**
 * Ask the Registrar-General. Never throws for a service that does not answer: the result is 'unavailable', with why.
 * @returns {{ outcome, document_status, fields, reference, service, message? }}
 */
async function check(pg, { document_type, document_number, surname, first_names, date_of_birth, purpose }, env = process.env) {
  const m = mode(env)
  const body = { document_type, document_number, surname, first_names: first_names || undefined, date_of_birth: date_of_birth || undefined, purpose }
  if (m === 'off') return { outcome: 'unavailable', service: 'off', fields: {}, message: 'The Registrar-General check is not connected on this system.' }
  if (m === 'prototype') {
    const st = await status(pg, env)
    if (!st.available) return { outcome: 'unavailable', service: 'prototype', fields: {}, message: st.label }
    const sys = systemOf(pg)
    const client = await rgPrototype.clientFor(sys, PROTOTYPE_KEY)
    if (!client) return { outcome: 'unavailable', service: 'prototype', fields: {}, message: 'The council has no key for the prototype.' }
    const a = await rgPrototype.verify(sys, client, body)
    return { outcome: a.outcome, document_status: a.document_status, fields: a.fields, reference: a.reference, service: 'prototype' }
  }
  // http
  if (!env.RG_API_URL) return { outcome: 'unavailable', service: 'http', fields: {}, message: 'RG_API_URL is not set.' }
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`${env.RG_API_URL.replace(/\/$/, '')}/verifications`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-rg-client-key': env.RG_CLIENT_KEY || '' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    })
    const a = await res.json().catch(() => ({}))
    if (!res.ok) return { outcome: 'unavailable', service: env.RG_API_URL, fields: {}, message: a.message || `The service answered ${res.status}.` }
    return { outcome: a.outcome, document_status: a.document_status, fields: a.fields || {}, reference: a.reference, service: env.RG_API_URL }
  } catch (err) {
    return { outcome: 'unavailable', service: env.RG_API_URL, fields: {}, message: err.name === 'AbortError' ? 'The service did not answer in time.' : 'The service could not be reached.' }
  } finally {
    clearTimeout(timer)
  }
}

/** Does this check stop the document being used to verify identity? Returns the reason in words, or null. */
function blocks(c) {
  if (!c) return null
  if (c.outcome === 'not_found') return 'The Registrar-General has no such document.'
  if (c.outcome === 'no_match') return 'The Registrar-General says the particulars do not agree with the document.'
  if (c.document_status && c.document_status !== 'valid') {
    return {
      expired: 'The Registrar-General says the document has expired.',
      cancelled: 'The Registrar-General says the document has been cancelled.',
      reported_lost_or_stolen: 'The Registrar-General says the document was reported lost or stolen.',
      holder_deceased: 'The Registrar-General records the holder as deceased.',
    }[c.document_status] || 'The Registrar-General says the document is not valid.'
  }
  return null
}

module.exports = { mode, status, check, blocks }
