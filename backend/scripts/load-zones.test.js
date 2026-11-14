/**
 * The two zone files scripts/load-zones.js loads (data/reference/vungu/zones), checked without a database: shape and
 * the attributes the loader relies on. If a file is replaced these are the numbers to re-check.
 */
const fs = require('node:fs')
const path = require('node:path')

const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'reference', 'vungu', 'zones', `${name}.geojson`), 'utf8')).features

describe('data/reference/vungu/zones', () => {
  test('peri-urban zones: 61 polygons in 12 named zones, every one with a name', () => {
    const f = read('peri_urban_zones')
    expect(f).toHaveLength(61)
    for (const x of f) {
      expect(x.geometry.type).toBe('MultiPolygon')
      expect(String(x.properties.Zone ?? '').trim()).not.toBe('')
    }
    expect(new Set(f.map((x) => x.properties.Zone)).size).toBe(12)
  })

  test('the one misspelled zone name is the one the loader corrects', () => {
    const names = new Set(read('peri_urban_zones').map((x) => x.properties.Zone))
    expect(names.has('Cemetry')).toBe(true)
    expect(names.has('Cemetery')).toBe(false)
  })

  test('beyond zones: 16 polygons, each with a settlement category, a land-use code and a ward', () => {
    const f = read('beyond_peri_urban_zones')
    expect(f).toHaveLength(16)
    for (const x of f) {
      expect(x.geometry.type).toBe('MultiPolygon')
      expect(String(x.properties.settlement ?? '').trim()).not.toBe('')
      expect(x.properties.zone_code).toMatch(/^lu\d{3}$/)
      expect(String(x.properties.ADM3_EN ?? '').trim()).not.toBe('')
    }
  })

  test('each beyond settlement category maps to one land-use code', () => {
    const pairs = new Map()
    for (const x of read('beyond_peri_urban_zones')) {
      const codes = pairs.get(x.properties.settlement) ?? new Set()
      codes.add(x.properties.zone_code)
      pairs.set(x.properties.settlement, codes)
    }
    for (const [settlement, codes] of pairs) expect([settlement, codes.size]).toEqual([settlement, 1])
  })

  test('every settlement category has a planning zone, as the council named it', () => {
    const expected = {
      Communal: 'Communal', 'Resettlement Area': 'Resettlement Area', FLSCF: 'Large Scale Commercial Farms',
      FLSCF_A2: 'Model A2', SSCF: 'Small Scale Commercial Farms', FLSCF_SSCF_A1: 'Model A1',
    }
    expect([...new Set(read('beyond_peri_urban_zones').map((x) => x.properties.settlement))].sort()).toEqual(Object.keys(expected).sort())
  })

  test('no geometry carries a non-finite coordinate', () => {
    const finite = (c) => (typeof c[0] === 'number' ? c.every(Number.isFinite) : c.every(finite))
    for (const n of ['peri_urban_zones', 'beyond_peri_urban_zones']) for (const x of read(n)) expect(finite(x.geometry.coordinates)).toBe(true)
  })
})
