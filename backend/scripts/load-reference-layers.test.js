/**
 * The files scripts/load-reference-layers.js loads (data/reference/vungu), checked without a database: their shape,
 * counts and the one fact the voter denominator rests on (the polling areas' voters add up to the roll for Vungu).
 * If a file is re-cut from the sources these numbers are what to re-check.
 */
const fs = require('node:fs')
const path = require('node:path')

const read = (name) => JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'reference', 'vungu', `${name}.geojson`), 'utf8')).features

describe('data/reference/vungu', () => {
  test('polling areas: 115 in 19 wards, unique codes, every one with voters', () => {
    const f = read('polling_areas')
    expect(f).toHaveLength(115)
    expect(new Set(f.map((x) => x.properties.polling_code)).size).toBe(115)
    expect(new Set(f.map((x) => x.properties.ward_number)).size).toBe(19)
    for (const x of f) {
      expect(x.geometry.type).toMatch(/Polygon/)
      expect(Number.isInteger(x.properties.voters)).toBe(true)
    }
    expect(f.reduce((s, x) => s + x.properties.voters, 0)).toBe(50062)
  })

  test('polling stations match the areas one to one, by code', () => {
    const codes = (n) => read(n).map((x) => x.properties.polling_code).sort()
    expect(codes('polling_stations')).toEqual(codes('polling_areas'))
  })

  test('five chiefdoms, each with a chief and a ward number', () => {
    const f = read('chiefdoms')
    expect(f.map((x) => x.properties.chief).sort()).toEqual(['Bunina', 'Chiwundura', 'Gambiza', 'Lukuluva', 'Sogwala'])
    for (const x of f) expect(x.properties.ward_number).toBeGreaterThan(0)
  })

  test('business centres use the source\'s own sector codes only', () => {
    for (const x of read('business_centres')) expect([null, 'BC', 'RSC', 'GP']).toContain(x.properties.sector ?? null)
  })

  test('no river or other geometry carries a non-finite coordinate', () => {
    const finite = (c) => (typeof c[0] === 'number' ? c.every(Number.isFinite) : c.every(finite))
    for (const n of ['rivers', 'business_centres', 'chiefdoms', 'polling_areas', 'polling_stations']) {
      for (const x of read(n)) expect(finite(x.geometry.coordinates)).toBe(true)
    }
  })
})

describe('data/reference/vungu: roads and the planning boundary', () => {
  test('roads: 1,207 centrelines, each tagged with a road authority, none one-way in reverse', () => {
    const f = read('roads')
    expect(f).toHaveLength(1207)
    for (const x of f) {
      expect(x.geometry.type).toBe('MultiLineString')
      expect(['RIDA', 'MOTID', 'VUNGU']).toContain(x.properties.authority)
      expect(x.properties.oneway).not.toBe('T') // the loader keeps no reverse direction and refuses it
    }
    const by = (a) => f.filter((x) => x.properties.authority === a).length
    expect([by('VUNGU'), by('RIDA'), by('MOTID')]).toEqual([1059, 106, 42])
  })

  test('the council inventory (VUNGU roads) holds no trunk road', () => {
    expect(read('roads').filter((x) => x.properties.authority === 'VUNGU' && x.properties.fclass === 'trunk')).toEqual([])
  })

  test('planning boundary: one polygon, Gweru Rural, ZW1704, with the city cut out as a hole', () => {
    const f = read('planning_boundary')
    expect(f).toHaveLength(1)
    expect(f[0].properties).toMatchObject({ ADM2_EN: 'Gweru Rural', ADM2_PCODE: 'ZW1704' })
    expect(f[0].geometry.type).toBe('MultiPolygon')
    expect(f[0].geometry.coordinates[0].length).toBeGreaterThan(1) // an outer ring and at least one hole
  })

  test('no coordinate is non-finite', () => {
    const finite = (c) => (typeof c[0] === 'number' ? c.every(Number.isFinite) : c.every(finite))
    for (const n of ['roads', 'planning_boundary']) for (const x of read(n)) expect(finite(x.geometry.coordinates)).toBe(true)
  })
})
