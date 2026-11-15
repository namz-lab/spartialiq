/**
 * Plan revisions keep their shapes, and a plan is adopted before it is approved (migration 232). Built on scratch plans inside a rolled-back transaction.
 */
require('dotenv').config({ quiet: true })
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
let client
beforeAll(async () => { client = await pool.connect() }, 30000)
afterAll(async () => { client.release(); await pool.end() })
beforeEach(async () => { await client.query('BEGIN') })
afterEach(async () => { await client.query('ROLLBACK') })

const BOX = (x0, y0, x1, y1) => `ST_Multi(ST_SetSRID(ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}), 4326))`
const ACTOR = null

async function gazettedPlan(authorityCode = 'VUNGU') {
  const { rows: [p] } = await client.query(
    `INSERT INTO plan_instrument (title, status, is_template, profile_id, authority_id, plan_type, gazette_ref, effective_from, version)
     SELECT 'jest revision plan', 'draft', false, i.profile_id, a.id, i.plan_type, 'SI 1 of 2020', DATE '2020-01-01', 1
       FROM plan_instrument i, local_authorities a
      WHERE i.title = 'Vungu RDC peri-urban local plan (as mapped)' AND a.code = $1 RETURNING id, authority_id`, [authorityCode])
  await client.query("SET LOCAL lamis.skip_parcel_zoning = 'on'")
  await client.query(`INSERT INTO spatial_planning.zone (zone, plan_instrument_id, geom, is_active) VALUES ('Alpha', $1, ${BOX(0, 0, 0.02, 0.02)}, true), ('Beta', $1, ${BOX(0.03, 0, 0.05, 0.02)}, true)`, [p.id])
  await client.query('SELECT spatial_planning.refresh_zone_effective($1)', [p.id])
  await client.query("UPDATE plan_instrument SET status = 'gazetted' WHERE id = $1", [p.id])
  return p
}
const zones = async (plan) => (await client.query(
  'SELECT zone FROM spatial_planning.zone WHERE plan_instrument_id = $1 ORDER BY zone', [plan])).rows.map((r) => r.zone)
const governs = async (plan) => (await client.query('SELECT public.plan_governs($1) AS g', [plan])).rows[0].g
const status = async (plan) => (await client.query('SELECT status FROM plan_instrument WHERE id = $1', [plan])).rows[0].status
const setStatus = (plan, to, ref, from) => client.query('SELECT set_plan_status($1, $2, $3, $4, $5, $6)', [plan, to, ACTOR, 'admin', ref ?? null, from ?? null])
const refused = async (fn, pattern) => {
  await client.query('SAVEPOINT s')
  let err
  try { await fn() } catch (e) { err = e }
  await client.query('ROLLBACK TO SAVEPOINT s')
  expect(err).toBeDefined()
  expect(err.message).toMatch(pattern)
}

describe('plan revisions', () => {
  test('a new revision is a full copy, shapes included, and does not govern while it is a draft', async () => {
    const p1 = await gazettedPlan()
    const { rows: [{ id: p2 }] } = await client.query('SELECT new_plan_version($1, $2, $3) AS id', [p1.id, ACTOR, 'admin'])
    expect(await zones(p2)).toEqual(['Alpha', 'Beta'])
    expect(await zones(p1.id)).toEqual(['Alpha', 'Beta'])
    const { rows: [e] } = await client.query('SELECT count(*)::int AS n FROM spatial_planning.zone_effective WHERE plan_instrument_id = $1', [p2])
    expect(e.n).toBe(2)
    expect(await governs(p1.id)).toBe(true)
    expect(await governs(p2)).toBe(false)
  }, 60000)

  test('the changes between revisions name the zones added, removed and reshaped', async () => {
    const p1 = await gazettedPlan()
    const { rows: [{ id: p2 }] } = await client.query('SELECT new_plan_version($1, $2, $3) AS id', [p1.id, ACTOR, 'admin'])
    await client.query("SET LOCAL lamis.skip_parcel_zoning = 'on'")
    await client.query('DELETE FROM spatial_planning.zone WHERE plan_instrument_id = $1 AND zone = $2', [p2, 'Beta'])
    await client.query(`UPDATE spatial_planning.zone SET geom = ${BOX(0, 0, 0.03, 0.02)} WHERE plan_instrument_id = $1 AND zone = $2`, [p2, 'Alpha'])
    await client.query(`INSERT INTO spatial_planning.zone (zone, plan_instrument_id, geom, is_active) VALUES ('Gamma', $1, ${BOX(0.06, 0, 0.07, 0.01)}, true)`, [p2])
    const { rows } = await client.query("SELECT zone_type_code, change FROM plan_revision_changes($1, $2) WHERE kind = 'zone' ORDER BY 1", [p1.id, p2])
    const by = Object.fromEntries(rows.map((r) => [r.zone_type_code, r.change]))
    expect(by).toMatchObject({ Alpha: 'reshaped', Beta: 'removed', Gamma: 'added' })
  }, 60000)

  test('the shapes of an approved or gazetted plan cannot be edited; a draft revision can', async () => {
    const p1 = await gazettedPlan()
    await refused(() => client.query('UPDATE spatial_planning.zone SET zone_description = $2 WHERE plan_instrument_id = $1', [p1.id, 'x']), /new revision/)
    await refused(() => client.query('DELETE FROM spatial_planning.zone WHERE plan_instrument_id = $1', [p1.id]), /new revision/)
    const { rows: [{ id: p2 }] } = await client.query('SELECT new_plan_version($1, $2, $3) AS id', [p1.id, ACTOR, 'admin'])
    await client.query("SET LOCAL lamis.skip_parcel_zoning = 'on'")
    await client.query('UPDATE spatial_planning.zone SET zone_description = $2 WHERE plan_instrument_id = $1', [p2, 'edited'])
  }, 60000)
})

describe('adoption record', () => {
  async function toNotice() {
    const p1 = await gazettedPlan()
    const { rows: [{ id: p2 }] } = await client.query('SELECT new_plan_version($1, $2, $3) AS id', [p1.id, ACTOR, 'admin'])
    await setStatus(p2, 'public_notice')
    return { p1: p1.id, p2 }
  }
  const sign = (plan, code) => client.query('SELECT sign_off_plan($1, $2, $3, $4, $5, $6)', [plan, ACTOR, `Signer ${code}`, 'admin', null, code])
  const ROLES = ['district_planner', 'district_engineer', 'chief_executive', 'council_chairman']

  test('approval is refused without the council adoption, then without every signature', async () => {
    const { p2 } = await toNotice()
    await refused(() => setStatus(p2, 'approved'), /Full Council/)
    await client.query('SELECT record_council_adoption($1, DATE $2, $3, $4, $5)'.replace('DATE $2', '$2::date'), [p2, '2026-08-01', 'Res 12/2026', ACTOR, 'admin'])
    await refused(() => setStatus(p2, 'approved'), /missing: District Planner, District Engineer, Chief Executive Officer, Council Chairman/)
    for (const r of ROLES.slice(0, 3)) await sign(p2, r)
    await refused(() => setStatus(p2, 'approved'), /missing: Council Chairman/)
    const { rows } = await client.query('SELECT code FROM plan_signoffs_missing($1)', [p2])
    expect(rows.map((r) => r.code)).toEqual(['council_chairman'])
  }, 60000)

  test('a signature names a configured role', async () => {
    const { p2 } = await toNotice()
    await refused(() => sign(p2, 'the_mayor'), /signed by: district_planner/)
  }, 60000)

  test('an edit after signing makes every signature stale', async () => {
    const { p2 } = await toNotice()
    await client.query('SELECT record_council_adoption($1, $2::date, $3, $4, $5)', [p2, '2026-08-01', 'Res 12/2026', ACTOR, 'admin'])
    for (const r of ROLES) await sign(p2, r)
    expect((await client.query('SELECT count(*)::int AS n FROM plan_signoffs_missing($1)', [p2])).rows[0].n).toBe(0)
    await client.query("SET LOCAL lamis.skip_parcel_zoning = 'on'")
    await client.query(`UPDATE spatial_planning.zone SET geom = ${BOX(0, 0, 0.025, 0.02)} WHERE plan_instrument_id = $1 AND zone = 'Alpha'`, [p2])
    expect((await client.query('SELECT count(*)::int AS n FROM plan_signoffs_missing($1)', [p2])).rows[0].n).toBe(4)
    await refused(() => setStatus(p2, 'approved'), /missing/)
  }, 60000)

  test('the whole path: adopt, sign, approve, Minister, gazette; the old revision is kept and stops governing', async () => {
    const { p1, p2 } = await toNotice()
    await client.query('SELECT record_council_adoption($1, $2::date, $3, $4, $5)', [p2, '2026-08-01', 'Res 12/2026', ACTOR, 'admin'])
    for (const r of ROLES) await sign(p2, r)
    await setStatus(p2, 'approved')
    expect(await status(p2)).toBe('approved')
    await refused(() => setStatus(p2, 'gazetted', 'SI 9 of 2026', '2026-09-01'), /Minister/)
    await client.query('SELECT record_ministerial_approval($1, $2, $3::date, $4, $5, $6)', [p2, 'MLG/2026/17', '2026-08-20', 'Minister of Local Government', ACTOR, 'admin'])
    await setStatus(p2, 'gazetted', 'SI 9 of 2026', '2026-09-01')
    expect(await status(p2)).toBe('gazetted')
    expect(await status(p1)).toBe('superseded')
    expect(await zones(p1)).toEqual(['Alpha', 'Beta'])   // kept, not moved
    expect(await zones(p2)).toEqual(['Alpha', 'Beta'])
    expect(await governs(p1)).toBe(false)
    expect(await governs(p2)).toBe(true)
    const { rows: [ev] } = await client.query("SELECT count(*)::int AS n FROM plan_event WHERE plan_instrument_id = $1 AND event_type IN ('council_adopted', 'ministerial_approval', 'signed_off')", [p2])
    expect(ev.n).toBe(6)
  }, 120000)

  test('an authority with no signatory roles keeps the earlier rules', async () => {
    const { rows: [a] } = await client.query("INSERT INTO local_authorities (authority_name, kind) VALUES ('jest informal authority', 'rural') RETURNING id")
    const { rows: [p] } = await client.query(
      `INSERT INTO plan_instrument (title, status, is_template, profile_id, authority_id, plan_type)
       SELECT 'jest informal plan', 'public_notice', false, profile_id, $1, plan_type FROM plan_instrument
        WHERE title = 'Vungu RDC peri-urban local plan (as mapped)' RETURNING id`, [a.id])
    await refused(() => setStatus(p.id, 'approved'), /current sign-off/)
    await client.query('SELECT sign_off_plan($1, $2, $3, $4)', [p.id, ACTOR, 'The Clerk', 'admin'])
    await setStatus(p.id, 'approved')
    expect(await status(p.id)).toBe('approved')
  }, 60000)
})
