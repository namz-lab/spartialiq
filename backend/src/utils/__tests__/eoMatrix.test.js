/**
 * The EO's Vungu matrix translated to our codes (src/utils/eoMatrix.js): pure functions, no database.
 */
const fs = require('fs')
const path = require('path')
const { parseCsv } = require('../zoningMatrixImport')
const eo = require('../eoMatrix')

const eoRows = parseCsv(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'data', 'reference', 'vungu', 'eo-matrix.csv'), 'utf8'))
const built = eo.buildEoRows(eoRows)

describe('EO matrix translation', () => {
  test('the source has 31 uses x 14 columns', () => {
    expect(eoRows).toHaveLength(31 * 14)
  })

  test('matches by description, not by letter: the EO\'s G (storage warehouse) is our H, never our G (wholesale)', () => {
    expect(eo.USE_MAP.find((u) => u.eo === 'G').ours).toBe('H')
    expect(eo.USE_MAP.find((u) => u.eo === 'F').ours).toBe('G')
  })

  test('new uses take unused codes and never one of ours', () => {
    const ours = new Set(eo.USE_MAP.filter((u) => u.ours).map((u) => u.ours))
    const added = eo.USE_MAP.filter((u) => !u.ours).map((u) => u.code)
    expect(new Set(added).size).toBe(added.length)
    for (const c of added) expect(ours.has(c)).toBe(false)
  })

  test('Light and General Industry is one column; the most restrictive control wins', () => {
    expect(eo.mostRestrictive(['permitted', 'special_consent'])).toBe('special_consent')
    expect(eo.mostRestrictive(['permitted', 'prohibited'])).toBe('prohibited')
    const zones = new Set(built.rows.map((r) => r.zone))
    expect(zones.has('Light and General Industry')).toBe(true)
    expect(zones.has('Light and')).toBe(false)
    const dwelling = built.rows.find((r) => r.zone === 'Light and General Industry' && r.group_code === 'A')
    expect(dwelling.control_type).toBe('prohibited') // Light: X, General: P
  })

  test('lists the 17 uses on which the two columns disagree', () => {
    expect(built.conflicts).toHaveLength(17)
    for (const c of built.conflicts) expect(c.light).not.toBe(c.general)
  })

  test('every EO cell is labelled as the EO\'s, every proposal as PROPOSED', () => {
    expect(built.rows.every((r) => r.authority === eo.EO_AUTHORITY)).toBe(true)
    const proposed = eo.buildProposedRows(built.rows)
    expect(proposed.length).toBeGreaterThan(0)
    expect(proposed.every((r) => r.authority === eo.PROPOSED_AUTHORITY && r.notes.startsWith('PROPOSED'))).toBe(true)
  })

  test('proposals never repeat a zone the EO decided, and farm zones prohibit shops and permit farm buildings', () => {
    const eoZones = new Set(built.rows.map((r) => r.zone))
    const proposed = eo.buildProposedRows(built.rows)
    for (const r of proposed) expect(eoZones.has(r.zone)).toBe(false)
    const cell = (zone, code) => proposed.find((r) => r.zone === zone && r.group_code === code).control_type
    expect(cell('Model A1', 'D')).toBe('prohibited')
    expect(cell('Model A1', 'Q')).toBe('permitted')
    expect(cell('Large Scale Commercial Farms', 'M')).toBe('special_consent')
    expect(cell('Small Scale Commercial Farms', 'M')).toBe('prohibited')
  })

  test('an unmapped EO use or column is an error, not silently dropped', () => {
    expect(() => eo.buildEoRows([{ eo_code: 'ZZ', eo_zone: 'Communal', control: 'P', raw: 'P' }])).toThrow(/not in the mapping/)
    expect(() => eo.buildEoRows([{ eo_code: 'A', eo_zone: 'Nowhere', control: 'P', raw: 'P' }])).toThrow(/not in the mapping/)
  })
})
