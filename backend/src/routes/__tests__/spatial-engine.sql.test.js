/**
 * The spatial engine's SQL (migration 215), against a real database, in ONE transaction that is rolled back.
 *
 * Test wards are boxes placed far from Zimbabwe, so they never overlap the council's real wards or parcels;
 * assertions are about those wards only, plus the change in what could not be placed. Nothing is committed.
 *
 * What it pins down:
 *   - values: density and share are computed over the facts placed in each ward;
 *   - honesty: a share over nothing is no_data (NULL, never 0); a small base is flagged; a fact outside every
 *     ward is counted unlocated, not spread over wards;
 *   - placement by label: a ward number places a fact only when it names exactly one ward;
 *   - the database refuses a ward_value that is no_data with a number, or a number marked no_data;
 *   - the run records the ward register's basis, and a refresh replaces rather than duplicates.
 */
require('dotenv').config()
const { Client } = require('pg')

let client
const q = async (sql, params) => (await client.query(sql, params)).rows

const BOX = (x, y) => `ST_Multi(ST_MakeEnvelope(${x}, ${y}, ${x + 0.1}, ${y + 0.1}, 4326))`
const PARCEL_COLS = `(stand_no, township_code, geom_source, source_srid, geom_wgs84, area_m2, source, status)`

async function addWard(code, name, x, y) {
  await client.query(
    `INSERT INTO admin.ward (ward_code, name, source, parent_pcode, geom) VALUES ($1, $2, 'jest', 'ZJEST0', ${BOX(x, y)})`, [code, name])
  await client.query(
    `INSERT INTO admin.authority_ward (authority_id, ward_code, valid_from, basis, instrument_ref, note)
     VALUES (1, $1, current_date, 'interim', 'JEST-ROLLED-BACK', 'test')`, [code])
}
// authority: null for a custodian parcel (the register's own), or a council id for one the council owns.
async function addParcel(stand, x, y, authority = null) {
  await client.query(
    `INSERT INTO land.parcel ${PARCEL_COLS}
     VALUES ($1, 'JESTSE', ${BOX(x + 0.02, y + 0.02)}, 4326, ${BOX(x + 0.02, y + 0.02)}, 100, 'jest', 'current')`, [stand])
  if (authority !== null) await client.query(`UPDATE land.parcel SET authority_id = $2 WHERE township_code = 'JESTSE' AND stand_no = $1`, [stand, authority])
  return (await q(`SELECT parcel_id FROM land.parcel WHERE township_code = 'JESTSE' AND stand_no = $1`, [stand]))[0].parcel_id
}
const valuesOf = async (measure) => Object.fromEntries(
  (await q(`SELECT ward_code, numerator, denominator, value, reliability FROM spatial_engine.ward_value WHERE measure_key = $1`, [measure]))
    .map((r) => [r.ward_code, r]))

beforeAll(async () => {
  client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  await client.query('BEGIN')
  await client.query(`SELECT set_config('app.authority_id', '1', false)`)

  // Ward A holds three parcels (two with a rates account); ward B one (no account); ward C none.
  await addWard('ZJEST001', 'JA', 10, 50)
  await addWard('ZJEST002', 'JB', 11, 50)
  await addWard('ZJEST003', 'JC', 12, 50)
  const a1 = await addParcel('JA-1', 10, 50)
  const a2 = await addParcel('JA-2', 10, 50)
  await addParcel('JA-3', 10, 50)
  await addParcel('JB-1', 11, 50)
  await client.query(
    `INSERT INTO revenue_link.account_link (parcel_id, erp_account_no, link_type, verified_by)
     VALUES ($1, 'JEST-1', 'rates', 'jest'), ($2, 'JEST-2', 'rates', 'jest')`, [a1, a2])
}, 60000)

afterAll(async () => {
  await client.query('ROLLBACK')
  await client.end()
}, 30000)

describe('spatial_engine.refresh()', () => {
  let baselineUnlocated

  test('refuses to run without a council in the session', async () => {
    await client.query('SAVEPOINT s')
    await client.query(`SELECT set_config('app.authority_id', '', false)`)
    await expect(client.query('SELECT spatial_engine.refresh()')).rejects.toThrow(/app\.authority_id/)
    await client.query('ROLLBACK TO SAVEPOINT s')
    await client.query(`SELECT set_config('app.authority_id', '1', false)`)
  })

  test('records a completed run against the interim ward register', async () => {
    const [{ run }] = await q('SELECT spatial_engine.refresh() AS run')
    const [r] = await q('SELECT status, wards, ward_register_basis, detail FROM spatial_engine.run WHERE id = $1', [run])
    expect(r.status).toBe('completed')
    expect(r.wards).toBeGreaterThanOrEqual(3)
    expect(r.ward_register_basis).toBe('interim')
    baselineUnlocated = r.detail.parcel_density.unlocated
  })

  test('computes parcel density over the ward area', async () => {
    const v = await valuesOf('parcel_density')
    const [{ area_km2 }] = await q(`SELECT area_km2 FROM spatial_engine.v_authority_ward WHERE ward_code = 'ZJEST001'`)
    expect(Number(v.ZJEST001.numerator)).toBe(3)
    expect(Number(v.ZJEST001.value)).toBeCloseTo(3 / Number(area_km2), 3)
    expect(v.ZJEST001.reliability).toBe('ok')
  })

  test('a ward with no parcels has a density of zero, a true zero, because the register is not empty', async () => {
    const v = await valuesOf('parcel_density')
    expect(Number(v.ZJEST003.value)).toBe(0)
    expect(v.ZJEST003.reliability).toBe('ok')
  })

  test('computes the share of parcels with a rates account, and flags a small base', async () => {
    const v = await valuesOf('parcel_account_coverage')
    expect(Number(v.ZJEST001.value)).toBeCloseTo(66.6667, 3)
    expect(Number(v.ZJEST001.denominator)).toBe(3)
    // Three parcels is below the measure's minimum of ten: a number, but flagged and not to be classified.
    expect(v.ZJEST001.reliability).toBe('small_base')
    expect(Number(v.ZJEST002.value)).toBe(0)
    expect(v.ZJEST002.reliability).toBe('small_base')
  })

  test('a share over no parcels is no data, never zero', async () => {
    const v = await valuesOf('parcel_account_coverage')
    expect(v.ZJEST003.value).toBeNull()
    expect(v.ZJEST003.reliability).toBe('no_data')
  })

  test('counts a parcel the council owns but no ward holds as unlocated; a custodian parcel outside every ward is simply out of area', async () => {
    await addParcel('JOUT-OWNED', 40, -20, 1)  // the council's own, nowhere near any ward: unlocated
    await addParcel('JOUT-CUSTODIAN', 41, -20) // the register's, nowhere near any ward: not this council's
    await q('SELECT spatial_engine.refresh()')
    const [r] = await q(`SELECT detail FROM spatial_engine.run WHERE status = 'completed' ORDER BY started_at DESC LIMIT 1`)
    expect(r.detail.parcel_density.unlocated).toBe(baselineUnlocated + 1)
    const v = await valuesOf('parcel_density')
    expect(Number(v.ZJEST001.numerator)).toBe(3)
  })

  test('replaces the current values on every run instead of adding to them', async () => {
    await q('SELECT spatial_engine.refresh()')
    const [{ n }] = await q(
      `SELECT count(*)::int AS n FROM spatial_engine.ward_value WHERE measure_key = 'parcel_density' AND ward_code = 'ZJEST001'`)
    expect(n).toBe(1)
  })
})

describe('spatial_engine.ward_of_label()', () => {
  test('places a ward number only when it names exactly one ward', async () => {
    const [one] = await q(`SELECT spatial_engine.ward_of_label('JA') AS w`)
    expect(one.w).toBe('ZJEST001')
    // A bare ward number places a fact in the ward called "Ward <number>" too, which is how registers carry it.
    await addWard('ZJEST006', 'Ward JX7', 15, 50)
    const [bare] = await q(`SELECT spatial_engine.ward_of_label('JX7') AS w`)
    expect(bare.w).toBe('ZJEST006')
    const [none] = await q(`SELECT spatial_engine.ward_of_label('no such ward') AS w`)
    expect(none.w).toBeNull()
  })

  test('refuses to guess when two wards carry the same label', async () => {
    await addWard('ZJEST004', 'DUP', 13, 50)
    await addWard('ZJEST005', 'DUP', 14, 50)
    const [r] = await q(`SELECT spatial_engine.ward_of_label('DUP') AS w`)
    expect(r.w).toBeNull()
  })
})

describe('ward_value constraints', () => {
  const insert = (value, reliability) => client.query(
    `INSERT INTO spatial_engine.ward_value (measure_key, period, ward_code, value, reliability, run_id)
     SELECT 'parcel_density', 'jest', 'ZJEST001', $1, $2, id FROM spatial_engine.run ORDER BY started_at DESC LIMIT 1`, [value, reliability])

  test('refuses a number marked no_data', async () => {
    await client.query('SAVEPOINT c1')
    await expect(insert(5, 'no_data')).rejects.toThrow(/ward_value_no_data_is_null/)
    await client.query('ROLLBACK TO SAVEPOINT c1')
  })

  test('refuses no number marked ok', async () => {
    await client.query('SAVEPOINT c2')
    await expect(insert(null, 'ok')).rejects.toThrow(/ward_value_no_data_is_null/)
    await client.query('ROLLBACK TO SAVEPOINT c2')
  })
})

// Migration 216: the two measures that belong to Engineering and to Social Services.
describe('unit measures (migration 216)', () => {
  const premises = (ref, x, y, expiry) => client.query(
    `INSERT INTO spatial_planning.health_premises (reference, name, premises_type, location, fitness_certificate_expiry)
     VALUES ($1, $1, 'tea_room', ST_SetSRID(ST_MakePoint($2, $3), 4326), $4)`, [ref, x, y, expiry])

  beforeAll(async () => {
    // A road that runs through wards A and B, cut at their edges; a road with no geometry, which is not counted.
    await client.query(
      `INSERT INTO council_ops.road_asset (asset_code, name, status, geom)
       VALUES ('JEST-RD-1', 'Jest road', 'active', ST_Multi(ST_SetSRID(ST_MakeLine(ST_MakePoint(10.05, 50.05), ST_MakePoint(11.05, 50.05)), 4326)))`)
    await client.query(`INSERT INTO council_ops.road_asset (asset_code, name, status) VALUES ('JEST-RD-2', 'Jest road, no geometry', 'active')`)
    // Ward A: two certified and one expired premises. Ward B: none.
    await premises('JEST-HP-1', 10.02, 50.02, '2099-01-01')
    await premises('JEST-HP-2', 10.03, 50.03, '2099-01-01')
    await premises('JEST-HP-3', 10.04, 50.04, '2000-01-01')
    await q('SELECT spatial_engine.refresh()')
  })

  test('each measure belongs to a unit', async () => {
    const rows = await q(`SELECT measure_key, unit_key FROM spatial_engine.measure WHERE measure_key IN ('road_density', 'premises_certified')`)
    expect(Object.fromEntries(rows.map((r) => [r.measure_key, r.unit_key]))).toEqual({ road_density: 'engineering', premises_certified: 'social_admin' })
  })

  test('road density shares a road between the wards it crosses, and counts nothing without geometry', async () => {
    const v = await valuesOf('road_density')
    expect(Number(v.ZJEST001.numerator)).toBeGreaterThan(0)
    expect(Number(v.ZJEST002.numerator)).toBeGreaterThan(0)
    expect(Number(v.ZJEST003.numerator)).toBe(0) // a ward the road does not reach: a true zero for a count
    expect(Math.abs(Number(v.ZJEST001.numerator) - Number(v.ZJEST002.numerator))).toBeLessThan(0.01)
    expect(v.ZJEST001.reliability).toBe('ok')
  })

  test('premises certified is a share over the premises placed in the ward, and no_data where there are none', async () => {
    const v = await valuesOf('premises_certified')
    expect(Number(v.ZJEST001.numerator)).toBe(2)
    expect(Number(v.ZJEST001.denominator)).toBe(3)
    expect(Number(v.ZJEST001.value)).toBeCloseTo(66.6667, 3)
    expect(v.ZJEST002.value).toBeNull() // never 0: no premises, no figure
    expect(v.ZJEST002.reliability).toBe('no_data')
  })
})

// Migration 218: a rate over registered voters (not population).
describe('rate over registered voters (migration 218)', () => {
  beforeAll(async () => {
    // Ward A: two working water points and 2,000 registered voters; ward B: voters but no water point; ward C: no voters loaded.
    for (const [code, x] of [['JEST-WP-1', 10.02], ['JEST-WP-2', 10.04]]) {
      await client.query(
        `INSERT INTO council_ops.wash_asset (asset_code, asset_type, name, operational, geom)
         VALUES ($1::varchar, 'borehole', $1::text, 'working', ST_SetSRID(ST_MakePoint($2, 50.05), 4326))`, [code, x])
    }
    await client.query(
      `INSERT INTO spatial_engine.ward_denominator (ward_code, kind, as_of_year, value, source)
       VALUES ('ZJEST001', 'registered_voters', 2023, 2000, 'jest'), ('ZJEST002', 'registered_voters', 2023, 3000, 'jest')`)
    // These tests are about the rate, not about the register: it counts as complete here (the incomplete case is below).
    await client.query(
      `INSERT INTO spatial_engine.register_status (authority_id, register, complete, note, source) VALUES (1, 'water_points', true, 'complete for this test', 'jest')
       ON CONFLICT (authority_id, register) DO UPDATE SET complete = true`)
    await q('SELECT spatial_engine.refresh()')
  })

  test('the database accepts a registered-voter denominator and refuses an unknown kind', async () => {
    await client.query('SAVEPOINT s')
    await expect(client.query(
      `INSERT INTO spatial_engine.ward_denominator (ward_code, kind, as_of_year, value, source) VALUES ('ZJEST003', 'residents', 2023, 5, 'jest')`))
      .rejects.toThrow(/ward_denominator_kind_known/)
    await client.query('ROLLBACK TO SAVEPOINT s')
  })

  test('scales the count to 10,000 voters', async () => {
    const v = await valuesOf('water_points_per_voters')
    expect(Number(v.ZJEST001.numerator)).toBe(2)
    expect(Number(v.ZJEST001.denominator)).toBe(2000)
    expect(Number(v.ZJEST001.value)).toBeCloseTo(10, 3)
  })

  test('a ward with voters and no working water point is a true zero', async () => {
    const v = await valuesOf('water_points_per_voters')
    expect(Number(v.ZJEST002.value)).toBe(0)
    expect(v.ZJEST002.reliability).toBe('ok')
  })

  test('a ward with no voters loaded is no_data, never 0', async () => {
    const v = await valuesOf('water_points_per_voters')
    expect(v.ZJEST003.value).toBeNull()
    expect(v.ZJEST003.reliability).toBe('no_data')
  })
})

// Migration 223: a register the council has said is incomplete does not say "zero".
describe('an incomplete register (migration 223)', () => {
  const setComplete = (complete) => client.query(
    `INSERT INTO spatial_engine.register_status (authority_id, register, complete, note, source) VALUES (1, 'water_points', $1, 'set by the test', 'jest')
     ON CONFLICT (authority_id, register) DO UPDATE SET complete = $1`, [complete])

  beforeAll(async () => {
    // Ward A: a working point and a broken one recorded; ward B: one recorded point, broken; ward C: nothing recorded.
    for (const [code, x, state] of [['JEST-IR-1', 10.02, 'working'], ['JEST-IR-2', 10.03, 'broken'], ['JEST-IR-3', 11.02, 'broken']]) {
      await client.query(
        `INSERT INTO council_ops.wash_asset (asset_code, asset_type, name, operational, geom)
         VALUES ($1::varchar, 'borehole', $1::text, $2, ST_SetSRID(ST_MakePoint($3, 50.05), 4326))`, [code, state, x])
    }
    await client.query(`INSERT INTO spatial_engine.ward_denominator (ward_code, kind, as_of_year, value, source)
                         VALUES ('ZJEST001', 'registered_voters', 2023, 2000, 'jest'), ('ZJEST002', 'registered_voters', 2023, 2000, 'jest'),
                                ('ZJEST003', 'registered_voters', 2023, 2000, 'jest') ON CONFLICT DO NOTHING`)
  })

  test('while it is incomplete, a ward with nothing recorded is no data and a ward with a recorded point keeps its figure', async () => {
    await setComplete(false)
    await q('SELECT spatial_engine.refresh()')
    const v = await valuesOf('water_points_per_voters')
    expect(Number(v.ZJEST001.value)).toBeGreaterThan(0) // one working point recorded
    expect(Number(v.ZJEST002.value)).toBe(0) // a point is recorded and does not work: a real zero
    expect(v.ZJEST002.reliability).toBe('ok')
    expect(v.ZJEST003.value).toBeNull() // nothing recorded: not zero
    expect(v.ZJEST003.reliability).toBe('no_data')
  })

  test('once the register is complete, the same ward is a true zero', async () => {
    await setComplete(true)
    await q('SELECT spatial_engine.refresh()')
    const v = await valuesOf('water_points_per_voters')
    expect(Number(v.ZJEST003.value)).toBe(0)
    expect(v.ZJEST003.reliability).toBe('ok')
  })

  test('a measure that names no register is unaffected', async () => {
    await setComplete(false)
    await q('SELECT spatial_engine.refresh()')
    const v = await valuesOf('parcel_density')
    expect(Number(v.ZJEST003.value)).toBe(0) // an empty ward in a complete-by-default register is still a true zero
  })

  test('the database refuses a status with no name for what is known', async () => {
    await client.query('SAVEPOINT s')
    await expect(client.query(`INSERT INTO spatial_engine.register_status (authority_id, register, complete, note, source) VALUES (1, 'x_register', false, 'short', 'jest')`))
      .rejects.toThrow(/register_status_note_named/)
    await client.query('ROLLBACK TO SAVEPOINT s')
  })
})
