/**
 * Parcels keep their zone current (migrations 225, 227): the register, land.parcel, is the only parcel layer cached. Everything runs in one transaction that is rolled back, so the
 * database is left as it was.
 */
require('dotenv').config({ quiet: true })
const { Pool } = require('pg')

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
let client

beforeAll(async () => { client = await pool.connect() }, 30000)
afterAll(async () => { client.release(); await pool.end() })
beforeEach(async () => { await client.query('BEGIN') })
afterEach(async () => { await client.query('ROLLBACK') })

const SQUARE = (x, y) => `ST_Multi(ST_SetSRID(ST_MakeEnvelope(${x}, ${y}, ${x} + 0.0002, ${y} + 0.0002), 4326))`

async function zoneWithPoint() {
  const { rows } = await client.query(
    `SELECT id, plan_instrument_id, plan_zone_type_id, ST_X(ST_PointOnSurface(geom)) AS x, ST_Y(ST_PointOnSurface(geom)) AS y
       FROM spatial_planning.zone WHERE geom IS NOT NULL ORDER BY ST_Area(geom) DESC LIMIT 1`)
  return rows[0]
}
let seq = 0
/** A parcel of the register (kind 'farm', so no township is needed) with the given geometry expression. */
async function insertParcel(geomSql) {
  const id = `JEST-${process.pid}-${++seq}`
  await client.query(
    `INSERT INTO land.parcel (parcel_id, stand_no, geom_source, source_srid, geom_wgs84, area_m2, source, custodian_dept, status, allocation_status,
                              valid_from, parcel_kind, origin)
     SELECT $1, $1, g, 4326, g, GREATEST(ST_Area(g::geography), 1), 'jest', 'Survey Section', 'current', 'unallocated', CURRENT_DATE, 'farm', 'custodian'
       FROM (SELECT ${geomSql} AS g) x`, [id])
  return id
}
const links = async (id) => (await client.query(
  "SELECT * FROM parcel_zoning WHERE parcel_layer = 'land.parcel' AND parcel_id = $1", [id])).rows

describe('parcel_zoning is kept current', () => {
  test('a new parcel is linked to the zone it lies in, and the governing zone is marked', async () => {
    const z = await zoneWithPoint()
    const p = { fid: await insertParcel(SQUARE(z.x, z.y)) }
    const rows = await links(p.fid)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.zone_id === z.id)).toBe(true)
    expect(rows.filter((r) => r.is_governing).length).toBe(new Set(rows.map((r) => r.plan_instrument_id)).size)
  })

  test('moving a parcel out of every zone unlinks it: unzoned, never "permitted"', async () => {
    const z = await zoneWithPoint()
    const p = { fid: await insertParcel(SQUARE(z.x, z.y)) }
    await client.query("SET LOCAL gms.survey_import = 'on'")
    await client.query(`UPDATE land.parcel SET geom_source = ${SQUARE(0, 0)}, geom_wgs84 = ${SQUARE(0, 0)} WHERE parcel_id = $1`, [p.fid])
    expect(await links(p.fid)).toEqual([])
  })

  test('deleting a parcel removes its link', async () => {
    const z = await zoneWithPoint()
    const p = { fid: await insertParcel(SQUARE(z.x, z.y)) }
    await client.query("SET LOCAL gms.purge = 'on'")
    await client.query('DELETE FROM land.parcel WHERE parcel_id = $1', [p.fid])
    expect(await links(p.fid)).toEqual([])
  })

  test('re-typing a zone re-links the parcels under it, and a manual assignment keeps its zone but follows the type', async () => {
    const z = await zoneWithPoint()
    const { rows: [other] } = await client.query(
      'SELECT id FROM plan_zone_type WHERE plan_instrument_id = $1 AND id <> $2 LIMIT 1', [z.plan_instrument_id, z.plan_zone_type_id])
    const p = { fid: await insertParcel(SQUARE(z.x, z.y)) }
    await client.query('UPDATE spatial_planning.zone SET plan_zone_type_id = $1 WHERE id = $2', [other.id, z.id])
    expect((await links(p.fid)).find((r) => r.zone_id === z.id).plan_zone_type_id).toBe(other.id)

    await client.query("SELECT set_manual_parcel_zoning('land.parcel', $1, $2, 'jest')", [p.fid, z.id])
    await client.query('UPDATE spatial_planning.zone SET plan_zone_type_id = $1 WHERE id = $2', [z.plan_zone_type_id, z.id])
    const manual = (await links(p.fid)).find((r) => r.zone_id === z.id)
    expect(manual.method).toBe('manual')
    expect(manual.plan_zone_type_id).toBe(z.plan_zone_type_id)
  })

  test('a bulk load can switch the triggers off for its own transaction', async () => {
    const z = await zoneWithPoint()
    await client.query("SET LOCAL lamis.skip_parcel_zoning = 'on'")
    const p = { fid: await insertParcel(SQUARE(z.x, z.y)) }
    expect(await links(p.fid)).toEqual([])
  })
})
