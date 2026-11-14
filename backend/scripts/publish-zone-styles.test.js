/**
 * The zone styles (scripts/publish-zone-styles.js) against the zone files that are loaded (data/reference/vungu/zones),
 * without a database: every zone the files hold is coloured by the council GIS's own QGIS style, except the ones the style
 * never had a colour for, which are listed here on purpose so a new gap is noticed rather than drawn in a default colour.
 */
const fs = require('node:fs')
const path = require('node:path')
const qgisImport = require('../src/services/gis/qgisImport')
const { LAYERS, QML_DIR, renamed } = require('./publish-zone-styles')

const zonesDir = path.join(__dirname, '..', 'data', 'reference', 'vungu', 'zones')
const read = (n) => JSON.parse(fs.readFileSync(path.join(zonesDir, `${n}.geojson`), 'utf8')).features

const styled = (layer) => {
  const imported = qgisImport.importQml(path.join(QML_DIR, layer.qml), { layerId: layer.layerId, geometry: 'polygon' })
  expect(imported.error).toBeUndefined()
  return renamed(imported.doc, layer.renames)
}
const colours = (doc) => Object.fromEntries(doc.renderer.categories.filter((c) => c.value).map((c) => [c.value, c.symbol.fill]))

// Zones in the council's newer file that its QGIS style has no colour for; they take the style's own "other" colour.
const KNOWN_UNSTYLED = ['Densification Zone [MDR]']

describe('zone styles', () => {
  const [peri, beyond] = LAYERS

  test('every peri-urban zone name in the file has a colour, except the known gaps', () => {
    const have = colours(styled(peri))
    const names = new Set(read('peri_urban_zones').map((f) => (f.properties.Zone === 'Cemetry' ? 'Cemetery' : f.properties.Zone)))
    expect([...names].filter((n) => !have[n]).sort()).toEqual(KNOWN_UNSTYLED)
  })

  test('every beyond area has a colour once its settlement category is named as a planning zone', () => {
    const have = colours(styled(beyond))
    const zones = new Set(read('beyond_peri_urban_zones').map((f) => beyond.renames[f.properties.settlement] ?? f.properties.settlement))
    expect([...zones].filter((n) => !have[n])).toEqual([])
  })

  test('the old abbreviations are gone from the styles', () => {
    const have = Object.keys(colours(styled(beyond)))
    for (const old of ['FLSCF', 'FLSCF_A2', 'FLSCF_SSCF_A1', 'SSCF']) expect(have).not.toContain(old)
    expect(Object.keys(colours(styled(peri)))).not.toContain('Cemetry')
  })

  test('the colours are the council GIS\'s own: renaming changes values and labels, never a colour', () => {
    const before = qgisImport.importQml(path.join(QML_DIR, beyond.qml), { layerId: beyond.layerId, geometry: 'polygon' }).doc
    const after = styled(beyond)
    expect(after.renderer.categories.map((c) => c.symbol.fill)).toEqual(before.renderer.categories.map((c) => c.symbol.fill))
  })
})
