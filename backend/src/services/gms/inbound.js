// src/services/gms/inbound.js
// ─────────────────────────────────────────────────────────────────────────
// ERP -> GMS events. Exactly-once by construction: the inbound_event row and
// the effect commit together, and the row's unique event_id/idempotency_key
// turns a redelivery into a no-op.
//
// AUTHORITY IDENTIFICATION — the inbound contract (2026-11)
// ─────────────────────────────────────────────────────────────────────────
// Every inbound envelope states which council's ERP emitted it:
//
//     authority_code   required, non-empty string, e.g. "VUNGU"
//
// Why the event must say it: this handler runs on the system connection
// (systemOf), where app.authority_id() is NULL by design — the system is not
// a council. Until migration 172 the rows it wrote relied on that session
// default, so since 172 every AccountLinked event has failed with 23502. The
// council identity now arrives explicitly, is resolved against
// public.local_authorities (code, is_active), and is written as a literal
// value — never a session default.
//
// Cross-council guarantees, in the handler itself (the RLS policies remain as
// they are and are not relied on here, because the system connection bypasses
// them):
//   * AccountLinked refuses a parcel that already belongs to a different
//     authority. A parcel's authority is parcel.authority_id, or — because
//     the cadastre is national and a parcel may predate tenancy — the current
//     admin.authority_ward mapping of its ward. A parcel with neither signal
//     is national cadastre: the link is attributed to the declared council,
//     which is the only council whose ERP could have authenticated the event.
//   * BillingStatusUpdated only ever touches rows of the declared authority.
//     An account held by another council is skipped, counted, and named in
//     the note — never updated.
//
// There is deliberately no default authority. An event that cannot name its
// council is refused, not guessed for.
// ─────────────────────────────────────────────────────────────────────────

const { systemOf } = require('../../lib/dbContext')
const crypto = require('node:crypto')

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const BANDS = new Set(['current', 'in_arrears', 'closed'])

/** HMAC-SHA256 of the raw body, sent as `x-erp-signature: sha256=<hex>`. */
function verifySignature(rawBody, header, secret) {
  if (!secret || typeof header !== 'string' || !header.startsWith('sha256=')) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest()
  const given = Buffer.from(header.slice(7), 'hex')
  return given.length === expected.length && crypto.timingSafeEqual(given, expected)
}

// Business rule 5: money stays in the ERP. Whatever the ERP sends, amount
// fields are dropped before the payload is logged or read.
const MONEY_KEY = /amount|balance|owing|outstanding|arrears_value|total_due/i
function stripMoney(v) {
  if (Array.isArray(v)) return v.map(stripMoney)
  if (!v || typeof v !== 'object') return v
  return Object.fromEntries(Object.entries(v)
    .filter(([k]) => !MONEY_KEY.test(k))
    .map(([k, x]) => [k, stripMoney(x)]))
}

function envelopeError(ev) {
  if (!ev || typeof ev !== 'object') return 'body'
  if (!UUID.test(ev.event_id || '')) return 'event_id'
  if (typeof ev.type !== 'string' || !ev.type) return 'type'
  if (!Number.isInteger(ev.version)) return 'version'
  if (Number.isNaN(Date.parse(ev.occurred_at))) return 'occurred_at'
  if (typeof ev.source !== 'string' || !ev.source) return 'source'
  if (typeof ev.idempotency_key !== 'string' || !ev.idempotency_key) return 'idempotency_key'
  if (typeof ev.authority_code !== 'string' || !ev.authority_code.trim()) return 'authority_code'
  if (!ev.payload || typeof ev.payload !== 'object') return 'payload'
  return null
}

/**
 * The authority an event declares, resolved and validated. Returns
 * { id, code } or null — null means the code names no active council, which
 * the caller records as a rejected event (the sender authenticated fine; the
 * fault is in the sender's configuration, and the event row keeps the
 * evidence).
 */
async function resolveAuthority(client, code) {
  const { rows: [authority] } = await client.query(
    'SELECT id FROM public.local_authorities WHERE code = $1 AND is_active', [code.trim()],
  )
  return authority ? { id: authority.id, code: code.trim() } : null
}

const HANDLERS = {
  async AccountLinked(client, p, ctx) {
    if (!p.parcel_id || !p.erp_account_no) return ['rejected', 'parcel_id and erp_account_no are required']
    // The parcel's own claim on an authority, from either signal the cadastre
    // keeps: the tenancy column, or the current ward mapping.
    const parcel = (await client.query(
      `SELECT status,
              authority_id AS parcel_authority,
              (SELECT aw.authority_id FROM admin.authority_ward aw
                WHERE aw.ward_code = p.ward_code
                  AND current_date >= aw.valid_from
                  AND (aw.valid_to IS NULL OR current_date <= aw.valid_to)
                ORDER BY aw.valid_from DESC
                LIMIT 1) AS ward_authority
         FROM land.parcel p
        WHERE p.parcel_id = $1
        FOR UPDATE OF p`,
      [p.parcel_id],
    )).rows[0]
    if (!parcel) return ['rejected', `unknown parcel ${p.parcel_id}`]
    if (parcel.status === 'retired') return ['rejected', `parcel ${p.parcel_id} is retired`]
    const owner = parcel.parcel_authority ?? parcel.ward_authority ?? null
    if (owner !== null && owner !== ctx.authority.id) {
      return ['rejected',
        `parcel ${p.parcel_id} belongs to authority ${owner}; the event declares ${ctx.authority.code}`]
    }
    await client.query(
      `INSERT INTO revenue_link.account_link (parcel_id, erp_account_no, linked_on, verified_by, authority_id)
       VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), 'ERP', $4)
       ON CONFLICT (parcel_id, erp_account_no) DO NOTHING`,
      [p.parcel_id, String(p.erp_account_no), p.allocation_date || null, ctx.authority.id],
    )
    await client.query(
      `UPDATE land.parcel SET allocation_status = 'allocated' WHERE parcel_id = $1`, [p.parcel_id],
    )
    return ['applied', null]
  },

  // Nightly. One account or a batch under `accounts`. Only the band and its
  // date are read: amounts in the payload are dropped, never stored (rule 5).
  async BillingStatusUpdated(client, p, ctx) {
    const items = Array.isArray(p.accounts) ? p.accounts : [p]
    let applied = 0
    let foreign = 0
    for (const it of items) {
      if (!it?.erp_account_no || !BANDS.has(it.status_band) || Number.isNaN(Date.parse(it.as_at))) continue
      // An account another council already holds is not ours to update: skip,
      // count, name it. The upsert's WHERE carries the same test so the guard
      // holds even if this pre-check is ever removed.
      const { rows: [held] } = await client.query(
        'SELECT authority_id FROM revenue_link.billing_status WHERE erp_account_no = $1',
        [String(it.erp_account_no)],
      )
      if (held && held.authority_id !== ctx.authority.id) { foreign++; continue }
      const up = await client.query(
        `INSERT INTO revenue_link.billing_status (erp_account_no, status_band, as_at, authority_id)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (erp_account_no) DO UPDATE
           SET status_band = EXCLUDED.status_band, as_at = EXCLUDED.as_at
           WHERE revenue_link.billing_status.authority_id = EXCLUDED.authority_id
             AND revenue_link.billing_status.as_at <= EXCLUDED.as_at`,
        [String(it.erp_account_no), it.status_band, it.as_at, ctx.authority.id],
      )
      if (up.rowCount > 0) applied++
    }
    if (!applied && !foreign) return ['rejected', 'no valid accounts']
    const note = `${applied} of ${items.length} accounts`
      + (foreign ? `, ${foreign} held by another authority and left untouched` : '')
    return applied ? ['applied', note] : ['rejected', note]
  },
}

/**
 * Returns { duplicate: true } for a redelivery, otherwise the outcome.
 * Types without a handler yet are kept as 'ignored' so a later phase can
 * replay them from integration.inbound_event.
 */
async function handleInbound(pg, raw) {
  const ev = { ...raw, payload: stripMoney(raw.payload) }
  const client = await systemOf(pg).connect()
  try {
    await client.query('BEGIN')
    const inserted = await client.query(
      `INSERT INTO integration.inbound_event
         (event_id, type, version, occurred_at, source, idempotency_key, payload, outcome)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'ignored')
       ON CONFLICT DO NOTHING RETURNING event_id`,
      [ev.event_id, ev.type, ev.version, ev.occurred_at, ev.source, ev.idempotency_key,
        JSON.stringify(ev.payload)],
    )
    if (inserted.rowCount === 0) {
      await client.query('ROLLBACK')
      return { duplicate: true }
    }

    const authority = await resolveAuthority(client, ev.authority_code)
    let outcome, note
    if (!authority) {
      outcome = 'rejected'
      note = `unknown authority_code "${ev.authority_code}": no active local authority has that code`
    } else {
      const handler = HANDLERS[ev.type]
      ;[outcome, note] = handler
        ? await handler(client, ev.payload, { authority })
        : ['ignored', `no handler for ${ev.type} yet`]
    }
    await client.query(
      'UPDATE integration.inbound_event SET outcome = $2, note = $3 WHERE event_id = $1',
      [ev.event_id, outcome, note],
    )
    await client.query('COMMIT')
    return { duplicate: false, outcome, note }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    client.release()
  }
}

module.exports = { handleInbound, verifySignature, envelopeError, stripMoney }
