/**
 * The survey import closes a stand-change proposal (migration 230, services/gms/parcelChangeImport.js), against a throwaway township in the Lo29 belt.
 * What it pins: for each kind (split, merge, new, reshape) the surveyed boundaries are matched to the proposal's items, new parcels are created,
 * boundaries are revised in place, the replaced stands are retired with lineage and history, their offers withdrawn, and the proposal and its survey
 * task are closed, all in the import's one transaction; and that a feature that matches nothing, a missing feature, an overlap with a neighbouring stand,
 * a proposal that is not accepted, or a second import of the same proposal is refused, with nothing changed. An import that names no proposal is untouched.
 */
require('dotenv').config({ quiet: true })
const crypto = require('node:crypto')
const { Pool } = require('pg')
const { importGeneralPlan } = require('../src/services/gms/parcelImport')
const { purgeTownship, loOrigin, LO29 } = require('../scripts/seed-tsamba')

const TOWNSHIP = `JTI${crypto.randomBytes(3).toString('hex').toUpperCase()}`
const SG = `${TOWNSHIP} GP`
const USER = { id: crypto.randomUUID() }
const pool = new Pool({ connectionString: process.env.DATABASE_URL })
let origin
const parcels = {}       // stand_no -> parcel_id
const requestIds = []
const taskIds = []

// A rectangle in Lo29 (Y is positive west, X positive south): `col` is the east-west slot (20 m wide), the stand 30 m deep.
const rect = (col, x0 = 0, x1 = 30, w = 20) => {
  const y = origin.y - col * 20
  const x = origin.x
  return [[y, x + x0], [y - w, x + x0], [y - w, x + x1], [y, x + x1], [y, x + x0]]
}
const feature = (stand_no, ring) => ({ type: 'Feature', properties: { stand_no }, geometry: { type: 'Polygon', coordinates: [ring] } })
const importPlan = (features, extra = {}) => importGeneralPlan(pool, { sg_ref: SG, township_code: TOWNSHIP, source_srid: LO29, features, commit: true, ...extra }, USER)

/** A proposal in the register, as the Survey Section sees it once accepted: parents by stand number, items drawn in Lo29. */
async function mkRequest(kind, parentNos, items, { status = 'accepted' } = {}) {
  const { rows: [t] } = await pool.query(
    `INSERT INTO spatial_planning.survey_task (task_type, stand_number, instructions, authority_id, status)
     VALUES ('subdivision', $1, 'jest', 1, 'assigned') RETURNING id`, [parentNos[0]])
  taskIds.push(t.id)
  const { rows: [r] } = await pool.query(
    `INSERT INTO land.parcel_change_request (kind, status, reason, requested_by, authority_id, survey_task_id) VALUES ($1, $2, 'jest', $3, 1, $4) RETURNING id`,
    [kind, status, USER.id, t.id])
  requestIds.push(r.id)
  for (const no of parentNos) await pool.query('INSERT INTO land.parcel_change_parent (request_id, parcel_id) VALUES ($1, $2)', [r.id, parcels[no]])
  for (const [i, it] of items.entries()) {
    await pool.query(
      `INSERT INTO land.parcel_change_item (request_id, seq, role, label, parent_parcel_id, geom)
       VALUES ($1, $2, $3, $4, $5, ST_Multi(ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON($6), $7::int), 4326)))`,
      [r.id, i + 1, it.role, it.label || null, it.role === 'revised' ? parcels[it.parent] : null,
        JSON.stringify({ type: 'Polygon', coordinates: [it.ring] }), LO29])
  }
  return r.id
}
const one = async (sql, args) => (await pool.query(sql, args)).rows[0]
const stand = (no) => one("SELECT parcel_id, status, valid_to, area_m2, sg_ref FROM land.parcel WHERE township_code = $1 AND stand_no = $2 ORDER BY status", [TOWNSHIP, no])
const codes = (r) => (r.errors || r.report?.errors || []).map((e) => e.code)

beforeAll(async () => {
  await pool.query(
    `INSERT INTO users (id, email, full_name, name, role, active, status, password_hash, authority_id)
     VALUES ($1, $2, 'Jest Import', 'Jest Import', 'gis_data', true, 'active', '$2b$10$jesttestjesttestjesttestjesttestjesttestjesttestjestte', 1)`,
    [USER.id, `jesttest-pci-${USER.id}@example.test`])
  origin = await loOrigin(pool, 29.45, -19.75)
  // the register before: ten stands side by side
  const base = await importPlan(Array.from({ length: 10 }, (_, i) => feature(String(i + 1), rect(i))))
  expect(base.committed).toBe(true)
  const { rows } = await pool.query("SELECT parcel_id, stand_no FROM land.parcel WHERE township_code = $1", [TOWNSHIP])
  for (const r of rows) parcels[r.stand_no] = r.parcel_id
}, 60000)

afterAll(async () => {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    await c.query("SET LOCAL gms.purge = 'on'")
    const ids = (await c.query('SELECT parcel_id FROM land.parcel WHERE township_code = $1', [TOWNSHIP])).rows.map((r) => r.parcel_id)
    await c.query('DELETE FROM land.parcel_change_request WHERE id = ANY($1::uuid[])', [requestIds])
    await c.query('DELETE FROM spatial_planning.survey_task WHERE id = ANY($1::uuid[])', [taskIds])
    await c.query('DELETE FROM land.stand_offer WHERE parcel_id = ANY($1::text[])', [ids])
    await c.query('DELETE FROM land.parcel_event WHERE parcel_id = ANY($1::text[])', [ids])
    await purgeTownship(c, TOWNSHIP, null)
    await c.query('COMMIT')
  } finally { c.release() }
  await pool.query('DELETE FROM users WHERE id = $1', [USER.id])
  await pool.end()
}, 60000)

describe('the survey import closes a stand-change proposal', () => {
  test('a split: the dry run reports the matches and changes nothing; the commit creates the children, retires the parent, writes lineage, closes the proposal and its task', async () => {
    const parent = parcels['2']
    await pool.query("INSERT INTO land.stand_offer (parcel_id, status, authority_id) VALUES ($1, 'available', 1)", [parent])
    const left = rect(1, 0, 15), right = rect(1, 15, 30)
    const id = await mkRequest('split', ['2'], [{ role: 'child', label: 'A', ring: left }, { role: 'child', label: 'B', ring: right }])
    // surveyed a few centimetres off the sketch: it still agrees
    const surveyed = [feature('2A', rect(1, 0.05, 15)), feature('2B', rect(1, 15, 29.98))]

    const dry = await importPlan(surveyed, { change_request_id: id, commit: false })
    expect(dry.ok).toBe(true)
    expect(dry.committed).toBe(false)
    expect(dry.report.change_request.matches.map((m) => m.agreement).every((a) => a > 0.95)).toBe(true)
    expect(dry.report.change_request.retire).toEqual([{ parcel_id: parent, stand_no: '2' }])
    expect((await stand('2')).status).toBe('current')

    const res = await importPlan(surveyed, { change_request_id: id })
    expect(res.committed).toBe(true)
    expect(res.change_request).toMatchObject({ id, retired: [parent] })
    expect(res.change_request.created).toHaveLength(2)

    const old = await one('SELECT status, valid_to FROM land.parcel WHERE parcel_id = $1', [parent])
    expect(old.status).toBe('retired')
    expect(old.valid_to).not.toBeNull()
    expect((await stand('2A')).status).toBe('current')
    expect((await stand('2B')).sg_ref).toBe(SG)
    const lineage = (await pool.query('SELECT child_id, event FROM land.parcel_lineage WHERE parent_id = $1 ORDER BY child_id', [parent])).rows
    expect(lineage).toHaveLength(2)
    expect(lineage.every((l) => l.event === 'subdivision')).toBe(true)
    const ev = await one("SELECT details, previous_geom IS NOT NULL AS had_geom FROM land.parcel_event WHERE parcel_id = $1 AND event = 'retired'", [parent])
    expect(ev.had_geom).toBe(true)
    expect(ev.details.change_request_id).toBe(id)
    expect((await one('SELECT status FROM land.stand_offer WHERE parcel_id = $1', [parent])).status).toBe('withdrawn')
    const req = await one('SELECT status, general_plan_id, applied_by FROM land.parcel_change_request WHERE id = $1', [id])
    expect(req).toMatchObject({ status: 'applied', applied_by: USER.id })
    expect(req.general_plan_id).not.toBeNull()
    expect((await pool.query('SELECT matched_parcel_id FROM land.parcel_change_item WHERE request_id = $1', [id])).rows.every((r) => r.matched_parcel_id)).toBe(true)
    expect((await one('SELECT status FROM spatial_planning.survey_task WHERE id = (SELECT survey_task_id FROM land.parcel_change_request WHERE id = $1)', [id])).status).toBe('accepted')
    const out = await pool.query("SELECT type FROM integration.outbox_event WHERE payload->>'parcel_id' = $1", [parent])
    expect(out.rows.map((r) => r.type)).toContain('ParcelRetired')
    // the retired stand leaves the zone link and the stand view
    expect((await pool.query("SELECT 1 FROM public.parcel_zoning WHERE parcel_layer = 'land.parcel' AND parcel_id = $1", [parent])).rowCount).toBe(0)
    expect((await pool.query('SELECT 1 FROM public.stands WHERE id = $1', [parent])).rowCount).toBe(0)
  }, 60000)

  test('a merge: both parents are retired and each is a parent of the one new stand', async () => {
    const id = await mkRequest('merge', ['3', '4'], [{ role: 'child', label: 'AB', ring: rect(2, 0, 30, 40) }])
    const res = await importPlan([feature('3-4', rect(2, 0, 30, 40))], { change_request_id: id })
    expect(res.committed).toBe(true)
    expect((await stand('3')).status).toBe('retired')
    expect((await stand('4')).status).toBe('retired')
    const child = (await stand('3-4')).parcel_id
    const lineage = (await pool.query('SELECT parent_id, event FROM land.parcel_lineage WHERE child_id = $1', [child])).rows
    expect(lineage.map((l) => l.parent_id).sort()).toEqual([parcels['3'], parcels['4']].sort())
    expect(lineage.every((l) => l.event === 'consolidation')).toBe(true)
  }, 60000)

  test('a new stand cut from a parent: the parent keeps its id with a revised boundary, and the new stand descends from it', async () => {
    const parent = parcels['1']
    const before = (await stand('1')).area_m2
    const id = await mkRequest('new', ['1'], [
      { role: 'revised', parent: '1', label: '1', ring: rect(0, 0, 20) },
      { role: 'child', label: 'new', ring: rect(0, 20, 30) }])
    const res = await importPlan([feature('1', rect(0, 0, 20)), feature('1N', rect(0, 20, 30))], { change_request_id: id })
    expect(res.committed).toBe(true)
    expect(res.change_request.revised).toEqual([parent])
    const after = await stand('1')
    expect(after.parcel_id).toBe(parent)
    expect(after.status).toBe('current')
    expect(Number(after.area_m2)).toBeLessThan(Number(before))
    const ev = await one("SELECT previous_geom IS NOT NULL AS had_geom FROM land.parcel_event WHERE parcel_id = $1 AND event = 'boundary_revised'", [parent])
    expect(ev.had_geom).toBe(true)
    const lineage = await one('SELECT event FROM land.parcel_lineage WHERE parent_id = $1', [parent])
    expect(lineage.event).toBe('subdivision')
  }, 60000)

  test('a boundary correction changes the boundary in place and writes no lineage', async () => {
    const parent = parcels['5']
    const id = await mkRequest('reshape', ['5'], [{ role: 'revised', parent: '5', label: '5', ring: rect(4, 0, 30, 19) }])
    const res = await importPlan([feature('5', rect(4, 0, 30, 19))], { change_request_id: id })
    expect(res.committed).toBe(true)
    expect((await stand('5')).parcel_id).toBe(parent)
    expect(Number((await stand('5')).area_m2)).toBeCloseTo(19 * 30, 0)
    expect((await pool.query('SELECT 1 FROM land.parcel_lineage WHERE parent_id = $1', [parent])).rowCount).toBe(0)
  }, 60000)

  test('a feature that matches no item, and an item with no feature, are refused with nothing changed', async () => {
    const id = await mkRequest('split', ['6'], [{ role: 'child', ring: rect(5, 0, 15) }, { role: 'child', ring: rect(5, 15, 30) }])
    const extra = await importPlan([feature('6A', rect(5, 0, 15)), feature('6B', rect(5, 15, 30)), feature('6C', rect(11, 0, 30))], { change_request_id: id })
    expect(extra.ok).toBe(false)
    expect(codes(extra)).toContain('feature_matches_no_item')
    const missing = await importPlan([feature('6A', rect(5, 0, 15))], { change_request_id: id })
    expect(codes(missing)).toContain('proposal_item_unmatched')
    expect((await stand('6')).status).toBe('current')
    expect((await one("SELECT status FROM land.parcel_change_request WHERE id = $1", [id])).status).toBe('accepted')
  }, 60000)

  test('a surveyed boundary that runs into a neighbouring stand is refused', async () => {
    const id = await mkRequest('split', ['7'], [{ role: 'child', ring: rect(6, 0, 15) }, { role: 'child', ring: rect(6, 15, 30) }])
    // the second child is surveyed 2 m wider than the stand, into stand 8
    const wide = [[origin.y - 120, origin.x + 15], [origin.y - 142, origin.x + 15], [origin.y - 142, origin.x + 30], [origin.y - 120, origin.x + 30], [origin.y - 120, origin.x + 15]]
    const res = await importPlan([feature('7A', rect(6, 0, 15)), feature('7B', wide)], { change_request_id: id })
    expect(res.ok).toBe(false)
    expect(codes(res)).toContain('overlaps_register_parcel')
    expect((await stand('7')).status).toBe('current')
  }, 60000)

  test('a proposal that is not accepted, an unknown one, and one already applied are refused', async () => {
    const draft = await mkRequest('reshape', ['9'], [{ role: 'revised', parent: '9', ring: rect(8, 0, 30, 19) }], { status: 'submitted' })
    expect(codes(await importPlan([feature('9', rect(8, 0, 30, 19))], { change_request_id: draft }))).toEqual(['change_request_not_accepted'])
    expect(codes(await importPlan([feature('9', rect(8, 0, 30, 19))], { change_request_id: crypto.randomUUID() }))).toEqual(['unknown_change_request'])
    expect(codes(await importPlan([feature('9', rect(8, 0, 30, 19))], { change_request_id: 'not-a-uuid' }))).toEqual(['bad_change_request_id'])
    // the split of stand 2 was applied above: a second import against it is refused
    const applied = requestIds[0]
    expect(codes(await importPlan([feature('2A', rect(1, 0, 15))], { change_request_id: applied }))).toEqual(['change_request_not_accepted'])
  }, 60000)

  test('an import that names no proposal behaves as before: a stand number already in the register is refused', async () => {
    const res = await importPlan([feature('10', rect(9))])
    expect(res.ok).toBe(false)
    expect(codes(res)).toContain('stand_no_exists')
  }, 60000)
})
