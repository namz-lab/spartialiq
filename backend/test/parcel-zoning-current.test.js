/**
 * Parcels keep their zone current (migration 225). Everything runs in one transaction that is rolled back, so the
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
const links = async (fid) => (await client.query(
  "SELECT * FROM parcel_zoning WHERE parcel_layer = 'vungu_parcels' AND parcel_id = $1", [String(fid)])).rows

describe('parcel_zoning is kept current', () => {
  test('a new parcel is linked to the zone it lies in, and the governing zone is marked', async () => {
    const z = await zoneWithPoint()
    const { rows: [p] } = await client.query(`INSERT INTO public.vungu_parcels (name, geom) VALUES ('jest-parcel', ${SQUARE(z.x, z.y)}) RETURNING fid`)
    const rows = await links(p.fid)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.some((r) => r.zone_id === z.id)).toBe(true)
    expect(rows.filter((r) => r.is_governing).length).toBe(new Set(rows.map((r) => r.plan_instrument_id)).size)
  })

  test('moving a parcel out of every zone unlinks it: unzoned, never "permitted"', async () => {
    const z = await zoneWithPoint()
    const { rows: [p] } = await client.query(`INSERT INTO public.vungu_parcels (name, geom) VALUES ('jest-parcel', ${SQUARE(z.x, z.y)}) RETURNING fid`)
    await client.query(`UPDATE public.vungu_parcels SET geom = ${SQUARE(0, 0)} WHERE fid = $1`, [p.fid])
    expect(await links(p.fid)).toEqual([])
  })

  test('deleting a parcel removes its link', async () => {
    const z = await zoneWithPoint()
    const { rows: [p] } = await client.query(`INSERT INTO public.vungu_parcels (name, geom) VALUES ('jest-parcel', ${SQUARE(z.x, z.y)}) RETURNING fid`)
    await client.query('DELETE FROM public.vungu_parcels WHERE fid = $1', [p.fid])
    expect(await links(p.fid)).toEqual([])
  })

  test('re-typing a zone re-links the parcels under it, and a manual assignment keeps its zone but follows the type', async () => {
    const z = await zoneWithPoint()
    const { rows: [other] } = await client.query(
      'SELECT id FROM plan_zone_type WHERE plan_instrument_id = $1 AND id <> $2 LIMIT 1', [z.plan_instrument_id, z.plan_zone_type_id])
    const { rows: [p] } = await client.query(`INSERT INTO public.vungu_parcels (name, geom) VALUES ('jest-parcel', ${SQUARE(z.x, z.y)}) RETURNING fid`)
    await client.query('UPDATE spatial_planning.zone SET plan_zone_type_id = $1 WHERE id = $2', [other.id, z.id])
    expect((await links(p.fid)).find((r) => r.zone_id === z.id).plan_zone_type_id).toBe(other.id)

    await client.query("SELECT set_manual_parcel_zoning('vungu_parcels', $1, $2, 'jest')", [String(p.fid), z.id])
    await client.query('UPDATE spatial_planning.zone SET plan_zone_type_id = $1 WHERE id = $2', [z.plan_zone_type_id, z.id])
    const manual = (await links(p.fid)).find((r) => r.zone_id === z.id)
    expect(manual.method).toBe('manual')
    expect(manual.plan_zone_type_id).toBe(z.plan_zone_type_id)
  })

  test('a bulk load can switch the triggers off for its own transaction', async () => {
    const z = await zoneWithPoint()
    await client.query("SET LOCAL lamis.skip_parcel_zoning = 'on'")
    const { rows: [p] } = await client.query(`INSERT INTO public.vungu_parcels (name, geom) VALUES ('jest-parcel', ${SQUARE(z.x, z.y)}) RETURNING fid`)
    expect(await links(p.fid)).toEqual([])
  })
})
