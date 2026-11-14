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
