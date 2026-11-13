// src/routes/__tests__/gms.inbound-authority.test.js
// The inbound ERP authority contract, against the live DB through the real
// HMAC-authenticated HTTP route.
//
// Needs: the migration chain (172+ for tenanted revenue_link, 167+ for
// admin.authority_ward). It builds everything else itself — parcels, a ward
// mapping, and a second fictional authority — and removes all of it in
// afterAll. No demo users and no Tsamba sample are required.
//
// The contract under test (src/services/gms/inbound.js):
//   * every envelope carries authority_code; missing → 400 bad_envelope
//   * a code that names no active authority → event recorded, outcome rejected
//   * rows are written with the declared authority as a literal — the handler
//     runs on the system connection where app.authority_id() is NULL, which
//     is the production failure (23502) this suite pins as fixed
//   * AccountLinked refuses a parcel already owned by a different authority,
//     whether that ownership comes from the tenancy column or the ward mapping
//   * BillingStatusUpdated never updates an account another council holds
//   * a redelivery is a duplicate, not a second effect

require('dotenv').config()
const crypto = require('node:crypto')
const Fastify = require('fastify')
const { Pool } = require('pg')
const { gmsIntegrationRoutes } = require('../gms-integration')
const { stubAdapter } = require('../../services/gms/erpAdapter')

const SECRET = 'test-inbound-secret'
const SOURCE = 'erp-authority-test'
const OTHER_CODE = `OTHER-${crypto.randomBytes(2).toString('hex').toUpperCase()}`
const MARK = `IBAUTH-${crypto.randomBytes(3).toString('hex').toUpperCase()}`

describe('inbound ERP authority contract', () => {
  let app
  let pool
  let otherAuthorityId
  let vunguId

  const signed = (event) => {
    const body = JSON.stringify(event)
    const sig = crypto.createHmac('sha256', SECRET).update(body).digest('hex')
    return app.inject({
      method: 'POST', url: '/api/integration/inbound', payload: body,
      headers: { 'content-type': 'application/json', 'x-erp-signature': `sha256=${sig}` },
    })
  }
  const erpEvent = (key, payload, authorityCode = 'VUNGU') => ({
    event_id: crypto.randomUUID(), type: 'AccountLinked', version: 1,
    occurred_at: new Date().toISOString(), source: SOURCE,
    idempotency_key: `${MARK}:${key}`, authority_code: authorityCode, payload,
  })

  /** A small current parcel, attributed the way the test needs. */
  async function makeParcel(stand, { authorityId = null, wardCode = null } = {}) {
    const g = `ST_MakeEnvelope(29.0, -19.0, 29.001, -18.999, 4326)`
    const { rows: [p] } = await pool.query(
      `INSERT INTO land.parcel (stand_no, township_code, ward_code, geom_source, source_srid,
                                geom_wgs84, area_m2, source, authority_id)
       VALUES ($1, $2, $3, ST_Multi(${g}), 4326, ${g}, 600, $4, $5)
       RETURNING parcel_id`,
      [stand, MARK, wardCode, `${SOURCE} (${MARK})`, authorityId],
    )
    return p.parcel_id
  }

  beforeAll(async () => {
    process.env.ERP_INBOUND_SECRET = SECRET
    app = Fastify({ logger: false })
    await app.register(require('@fastify/postgres'), { connectionString: process.env.DATABASE_URL })
    await app.register(gmsIntegrationRoutes, {
      prefix: '/api', erpAdapter: stubAdapter(), worker: false,
    })
    await app.ready()
    pool = new Pool({ connectionString: process.env.DATABASE_URL })

    const { rows: [vungu] } = await pool.query(
      `SELECT id FROM public.local_authorities WHERE code = 'VUNGU'`)
    vunguId = vungu.id
    const { rows: [other] } = await pool.query(
      `INSERT INTO public.local_authorities (authority_name, kind, code)
       VALUES ($1, 'rural', $2) RETURNING id`,
      [`Neighbour Council (${MARK}, fictional)`, OTHER_CODE],
    )
    otherAuthorityId = other.id
  })

  afterAll(async () => {
    if (pool) {
      // SET LOCAL only applies inside a transaction, and the parcel guard
      // refuses deletes without the purge hatch — so the cleanup is one block.
      await pool.query('BEGIN')
      try {
        await pool.query(`SET LOCAL gms.purge = 'on'`)
        const ids = (await pool.query(
          'SELECT parcel_id FROM land.parcel WHERE township_code = $1', [MARK],
        )).rows.map((r) => r.parcel_id)
        if (ids.length) {
          await pool.query('DELETE FROM revenue_link.account_link WHERE parcel_id = ANY($1)', [ids])
          await pool.query('DELETE FROM land.parcel WHERE parcel_id = ANY($1)', [ids])
        }
        await pool.query('DELETE FROM revenue_link.billing_status WHERE erp_account_no LIKE $1', [`${MARK}-%`])
        await pool.query('DELETE FROM admin.authority_ward WHERE ward_code LIKE $1', [`${MARK}-%`])
        await pool.query('DELETE FROM admin.ward WHERE ward_code LIKE $1', [`${MARK}-%`])
        await pool.query('DELETE FROM integration.inbound_event WHERE source = $1', [SOURCE])
        await pool.query('DELETE FROM public.local_authorities WHERE code = $1', [OTHER_CODE])
        await pool.query('COMMIT')
      } catch (err) {
        await pool.query('ROLLBACK').catch(() => {})
        throw err
      }
    }
    await app?.close()
    await pool?.end()
  })

  test('a valid event writes the link stamped with the declared authority', async () => {
    const parcel = await makeParcel(`${MARK}-1`)
    const res = await signed(erpEvent('valid', {
      parcel_id: parcel, erp_account_no: `${MARK}-ACC-1`,
    }))
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ duplicate: false, outcome: 'applied' })

    const { rows } = await pool.query(
      'SELECT authority_id FROM revenue_link.account_link WHERE parcel_id = $1', [parcel])
    expect(rows).toHaveLength(1)
    expect(rows[0].authority_id).toBe(vunguId)

    const { rows: [p] } = await pool.query(
      'SELECT allocation_status FROM land.parcel WHERE parcel_id = $1', [parcel])
    expect(p.allocation_status).toBe('allocated')
  })

  test('an envelope without authority_code is refused at the boundary', async () => {
    const event = erpEvent('missing', { parcel_id: 'P-0000001', erp_account_no: `${MARK}-ACC-X` })
    delete event.authority_code
    const res = await signed(event)
    expect(res.statusCode).toBe(400)
    expect(res.json()).toMatchObject({ error: 'bad_envelope', field: 'authority_code' })
  })

  test('an unknown authority code is recorded as rejected, and writes nothing', async () => {
    const parcel = await makeParcel(`${MARK}-2`)
    const res = await signed(erpEvent('unknown', {
      parcel_id: parcel, erp_account_no: `${MARK}-ACC-2`,
    }, 'NO-SUCH-COUNCIL'))
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.outcome).toBe('rejected')
    expect(body.note).toContain('NO-SUCH-COUNCIL')

    const { rows } = await pool.query(
      'SELECT * FROM revenue_link.account_link WHERE parcel_id = $1', [parcel])
    expect(rows).toHaveLength(0)
    const { rows: [recorded] } = await pool.query(
      `SELECT outcome FROM integration.inbound_event WHERE idempotency_key = $1`,
      [`${MARK}:unknown`])
    expect(recorded.outcome).toBe('rejected')
  })

  test('a redelivery of the same event is a duplicate, not a second effect', async () => {
    const parcel = await makeParcel(`${MARK}-3`)
    const event = erpEvent('dup', { parcel_id: parcel, erp_account_no: `${MARK}-ACC-3` })
    expect((await signed(event)).json()).toMatchObject({ duplicate: false, outcome: 'applied' })
    expect((await signed(event)).json()).toMatchObject({ duplicate: true })

    const { rows } = await pool.query(
      'SELECT count(*)::int AS n FROM revenue_link.account_link WHERE parcel_id = $1', [parcel])
    expect(rows[0].n).toBe(1)
  })

  test('an event for a parcel owned by another council is refused', async () => {
    const parcel = await makeParcel(`${MARK}-4`, { authorityId: otherAuthorityId })
    const res = await signed(erpEvent('cross', {
      parcel_id: parcel, erp_account_no: `${MARK}-ACC-4`,
    }))
    expect(res.json().outcome).toBe('rejected')
    expect(res.json().note).toContain('belongs to authority')

    const { rows } = await pool.query(
      'SELECT * FROM revenue_link.account_link WHERE parcel_id = $1', [parcel])
    expect(rows).toHaveLength(0)
    const { rows: [p] } = await pool.query(
      'SELECT allocation_status FROM land.parcel WHERE parcel_id = $1', [parcel])
    expect(p.allocation_status).toBe('unallocated')
  })

  test('ward membership carries the same protection as the tenancy column', async () => {
    const ward = `${MARK}-W1`
    await pool.query(
      `INSERT INTO admin.ward (ward_code, name, source, geom)
       VALUES ($1, $2, $3, ST_Multi(ST_MakeEnvelope(29.0, -19.0, 29.01, -18.99, 4326)))`,
      [ward, `Ward ${MARK} (fictional)`, MARK])
    // The ward is mapped to the OTHER council: a Vungu event must be refused.
    await pool.query(
      `INSERT INTO admin.authority_ward (authority_id, ward_code, valid_from, basis)
       VALUES ($1, $2, current_date, 'interim')`,
      [otherAuthorityId, ward])

    const parcel = await makeParcel(`${MARK}-5`, { wardCode: ward })
    const res = await signed(erpEvent('cross-ward', {
      parcel_id: parcel, erp_account_no: `${MARK}-ACC-5`,
    }))
    expect(res.json().outcome).toBe('rejected')

    // The same parcel under an event from the ward's actual council is applied.
    const ok = await signed(erpEvent('ward-ok', {
      parcel_id: parcel, erp_account_no: `${MARK}-ACC-5B`,
    }, OTHER_CODE))
    expect(ok.json()).toMatchObject({ outcome: 'applied' })
    const { rows } = await pool.query(
      'SELECT authority_id FROM revenue_link.account_link WHERE parcel_id = $1', [parcel])
    expect(rows.map((r) => r.authority_id)).toEqual([otherAuthorityId])
  })

  test('a billing update never touches an account another council holds', async () => {
    const mine = `${MARK}-ACC-MINE`
    const theirs = `${MARK}-ACC-THEIRS`
    await pool.query(
      `INSERT INTO revenue_link.billing_status (erp_account_no, status_band, as_at, authority_id)
       VALUES ($1, 'current', now(), $2), ($3, 'in_arrears', now(), $4)`,
      [mine, vunguId, theirs, otherAuthorityId])

    const event = {
      ...erpEvent('billing', {
        accounts: [
          { erp_account_no: mine, status_band: 'in_arrears', as_at: new Date().toISOString() },
          { erp_account_no: theirs, status_band: 'current', as_at: new Date().toISOString() },
        ],
      }),
      type: 'BillingStatusUpdated',
    }
    const res = await signed(event)
    expect(res.json()).toMatchObject({ outcome: 'applied' })
    expect(res.json().note).toContain('held by another authority')

    const { rows: [m] } = await pool.query(
      'SELECT status_band FROM revenue_link.billing_status WHERE erp_account_no = $1', [mine])
    expect(m.status_band).toBe('in_arrears') // ours: updated
    const { rows: [t] } = await pool.query(
      `SELECT status_band, authority_id FROM revenue_link.billing_status WHERE erp_account_no = $1`,
      [theirs])
    expect(t.status_band).toBe('in_arrears') // theirs: untouched
    expect(t.authority_id).toBe(otherAuthorityId)
  })
})
