/**
 * Migration 222: the planning boundary IS the outside figure of the authority area, and the council's wards fill it exactly.
 *
 * Two parts, both against the dev database and both leaving nothing behind:
 *   - a synthetic authority in one rolled-back transaction, so admin.conform_authority_wards() is tested on shapes whose answer
 *     is known (a ward that sticks out is clipped, a strip nobody covers is given to a ward, the result fills the boundary);
 *   - the real Vungu data, read-only, where it is loaded (skipped, and passes, where it is not).
 *
 * Areas are compared in an equal-area projection (EPSG:6933): the geography area of a very large polygon is only good to about 1
 * part in 100,000, which would swamp the differences being checked.
 */
require('dotenv').config()
const { Client } = require('pg')

let client
const q = async (sql, params) => (await client.query(sql, params)).rows
const ha = (g) => `ST_Area(ST_Transform(${g}, 6933)) / 10000`

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
}, 30000)
afterAll(async () => { await client.end() }, 30000)

const box = (x0, y0, x1, y1) => `ST_Multi(ST_MakeEnvelope(${x0}, ${y0}, ${x1}, ${y1}, 4326))`

describe('admin.conform_authority_wards (synthetic authority, rolled back)', () => {
  let id
  beforeAll(async () => {
    await client.query('BEGIN')
    const [a] = await q(`INSERT INTO public.local_authorities (authority_name, code, kind) VALUES ('Jest Area Council', 'JESTAREA', 'rural') RETURNING id`)
    id = a.id
    // Three wards side by side, y 50.00 to 50.09, x 20.00 to 20.30. The boundary is x 20.00 to 20.28 and y 50.00 to 50.10:
    // the third ward sticks out 0.02 east of it, and a strip y 50.09 to 50.10 along the top is in no ward.
    for (const [code, x0, x1] of [['ZJA01', 20.0, 20.1], ['ZJA02', 20.1, 20.2], ['ZJA03', 20.2, 20.3]]) {
      await client.query(`INSERT INTO admin.ward (ward_code, name, source, parent_pcode, geom) VALUES ($1::varchar, $1::text, 'jest', 'ZJESTA', ${box(x0, 50.0, x1, 50.09)})`, [code])
      await client.query(
        `INSERT INTO admin.authority_ward (authority_id, ward_code, valid_from, basis, note) VALUES ($1, $2, current_date - 1, 'interim', 'jest')`, [id, code])
    }
    await client.query(
      `INSERT INTO admin.planning_boundary (authority_id, name, source, geom) VALUES ($1, 'Jest boundary', 'jest', ${box(20.0, 50.0, 20.28, 50.1)})`, [id])
  }, 30000)
  afterAll(async () => { await client.query('ROLLBACK') }, 30000)

  test('reports what it did, and the wards then fill the boundary', async () => {
    const [{ r }] = await q('SELECT admin.conform_authority_wards($1) AS r', [id])
    expect(r.wards_conformed).toBe(3)
    expect(r.gap_parts_filled).toBeGreaterThan(0)
    const [m] = await q(`
      WITH u AS (SELECT ST_UnaryUnion(ST_Collect(geom)) g FROM admin.authority_ward WHERE authority_id = $1), b AS (SELECT geom g FROM admin.planning_boundary WHERE authority_id = $1)
      SELECT ${ha('b.g')} AS boundary_ha, ${ha('u.g')} AS wards_ha, ${ha('ST_SymDifference(u.g, b.g)')} AS mismatch_ha FROM u, b`, [id])
    expect(Math.abs(Number(m.boundary_ha) - Number(m.wards_ha))).toBeLessThan(0.1)
    expect(Number(m.mismatch_ha)).toBeLessThan(0.1)
  })

  test('the ward that stuck out is clipped, and no ward stands outside the boundary', async () => {
    const [o] = await q(`SELECT ${ha('ST_Difference(w.geom, b.geom)')} AS outside_ha FROM (SELECT ST_UnaryUnion(ST_Collect(geom)) geom FROM admin.authority_ward WHERE authority_id = $1) w,
                                admin.planning_boundary b WHERE b.authority_id = $1`, [id])
    expect(Number(o.outside_ha)).toBeLessThan(0.1)
    const [c] = await q(`SELECT ST_XMax(geom) AS xmax FROM admin.authority_ward WHERE authority_id = $1 AND ward_code = 'ZJA03'`, [id])
    expect(Number(c.xmax)).toBeCloseTo(20.28, 5)
  })

  test('the custodian\'s ward polygons are not touched', async () => {
    const [w] = await q(`SELECT ST_XMax(geom) AS xmax, ST_YMax(geom) AS ymax FROM admin.ward WHERE ward_code = 'ZJA03'`)
    expect(Number(w.xmax)).toBeCloseTo(20.3, 6)
    expect(Number(w.ymax)).toBeCloseTo(50.09, 6)
  })

  test('the authority area is the boundary itself, and says so', async () => {
    const [a] = await q(`SELECT outline, boundary_name, wards, ST_Equals(a.geom, b.geom) AS same
                           FROM admin.authority_area a JOIN admin.planning_boundary b USING (authority_id) WHERE authority_id = $1`, [id])
    expect(a).toEqual({ outline: 'planning_boundary', boundary_name: 'Jest boundary', wards: 3, same: true })
  })

  test('the engine\'s ward view reads the conformed shape', async () => {
    await client.query(`SELECT set_config('app.authority_id', $1, true)`, [String(id)])
    const rows = await q(`SELECT v.ward_code, ST_Equals(v.geom, aw.geom) AS conformed
                            FROM spatial_engine.v_authority_ward v JOIN admin.authority_ward aw ON aw.ward_code = v.ward_code AND aw.authority_id = $1 ORDER BY 1`, [id])
    expect(rows).toHaveLength(3)
    for (const r of rows) expect(r.conformed).toBe(true)
  })

  test('without a planning boundary it does nothing, and the area is the union of the wards', async () => {
    await client.query('DELETE FROM admin.planning_boundary WHERE authority_id = $1', [id])
    const [{ r }] = await q('SELECT admin.conform_authority_wards($1) AS r', [id])
    expect(r).toBeNull()
    const [a] = await q('SELECT outline FROM admin.authority_area WHERE authority_id = $1', [id])
    expect(a.outline).toBe('ward_union')
  })
})

describe('the real Vungu area (where loaded)', () => {
  let loaded = false
  beforeAll(async () => {
    const [r] = await q(`SELECT count(*)::int AS n FROM admin.planning_boundary pb JOIN public.local_authorities a ON a.id = pb.authority_id WHERE a.code = 'VUNGU'`)
    loaded = r.n === 1
  })

  test('the authority area is the planning boundary, with 19 conformed wards that fill it', async () => {
    if (!loaded) return
    const [a] = await q(`SELECT a.wards, a.outline, ST_Equals(a.geom, b.geom) AS same, ${ha('a.geom')} AS area_ha
                           FROM admin.authority_area a JOIN admin.planning_boundary b USING (authority_id) JOIN public.local_authorities l ON l.id = a.authority_id WHERE l.code = 'VUNGU'`)
    expect(a).toMatchObject({ wards: 19, outline: 'planning_boundary', same: true })
    const [w] = await q(`
      WITH u AS (SELECT ST_UnaryUnion(ST_Collect(aw.geom)) g FROM admin.authority_ward aw JOIN public.local_authorities l ON l.id = aw.authority_id
                  WHERE l.code = 'VUNGU' AND aw.valid_to IS NULL),
           b AS (SELECT pb.geom g FROM admin.planning_boundary pb JOIN public.local_authorities l ON l.id = pb.authority_id WHERE l.code = 'VUNGU')
      SELECT ${ha('u.g')} AS wards_ha, ${ha('b.g')} AS boundary_ha FROM u, b`)
    // "The same area": to within a few hectares in 583,000 (the 1 cm snapping grid), not the 471 ha of slivers there were before.
    expect(Math.abs(Number(w.wards_ha) - Number(w.boundary_ha))).toBeLessThan(5)
  })

  test('every Vungu ward has a conformed shape close to the custodian\'s own', async () => {
    if (!loaded) return
    const rows = await q(`SELECT aw.ward_code, aw.geom IS NOT NULL AS conformed,
                                 ${ha('ST_SymDifference(aw.geom, w.geom)')} / NULLIF(${ha('w.geom')}, 0) AS change
                            FROM admin.authority_ward aw JOIN admin.ward w USING (ward_code) JOIN public.local_authorities l ON l.id = aw.authority_id
                           WHERE l.code = 'VUNGU' AND aw.valid_to IS NULL`)
    expect(rows).toHaveLength(19)
    for (const r of rows) {
      expect(r.conformed).toBe(true)
      expect(Number(r.change)).toBeLessThan(0.02) // a sliver along the edge, never a redrawn ward
    }
  })
})
