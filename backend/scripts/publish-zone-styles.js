#!/usr/bin/env node
/**
 * Publishes the colour-by-zone-type styles for the two zone layers into the GIS symbology registry (migration 114), so
 * every map that draws them (the portal's vector-tile maps and the explorer) colours the zones by type.
 *
 *   node scripts/publish-zone-styles.js [--dry-run]
 *
 * The colours are the council GIS's own, authored in QGIS (qgis-projects/canonical-qml/proposed_peri_urban_zones.qml and
 * gweru_beyond_periurban_zones.qml), imported through the registry's QGIS importer: none is invented here. The only change
 * is that the category VALUES follow the zone names now in the database:
 *
 *   peri-urban layer ('zone')     "Cemetry" -> "Cemetery"
 *   beyond layer ('settlement')   FLSCF -> Large Scale Commercial Farms, FLSCF_A2 -> Model A2,
 *                                 FLSCF_SSCF_A1 -> Model A1, SSCF -> Small Scale Commercial Farms
 *                                 (Communal and Resettlement Area are unchanged)
 *
 * The QGIS label of the peri-urban layer is NOT published. It asks for the font "Segoe UI" at 34 px, which the portal does not serve
 * (it serves Noto Sans and Open Sans); the glyph request fails, and MapLibre then drops the WHOLE tile, so the zones were not drawn
 * at all ("Unimplemented type: 4"). The portal draws its own centroid labels for these layers (vunguBasemap.ts, `-master-label`).
 *
 * Two zones of the council's newer file had no category in the QGIS style and were drawn in the style's "other" colour:
 *   "Light and General Industry"   the QGIS category "Light Industry" under the plan's current name (same colour, the council's own)
 *   "Densification Zone [MDR]"     a colour chosen here, NOT the council's: one step deeper than the Densification Zone [LDR] tan
 *                                  (#efe0b8 -> #e5cc94), so the two densification zones read as one family and stay apart from
 *                                  Medium Density Residential (#f1dd7c). The GIS Branch should confirm or replace it.
 *
 * The registry's lifecycle is draft -> review -> approved -> published, each step audited. This script takes a style through
 * all of it in one go, recording the actor as "MVP demonstration": it is a demonstration shortcut, not a review by the GIS
 * Branch. Re-running is safe (an identical document creates no new version; a published one is left alone). Changing the
 * cartography later means a new version through the registry, as always.
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const path = require('node:path')
const { Pool } = require('pg')
const registry = require('../src/services/gis/styleRegistry')
const qgisImport = require('../src/services/gis/qgisImport')

const QML_DIR = path.join(__dirname, '..', 'qgis-projects', 'canonical-qml')
const ACTOR = 'MVP demonstration'
const ACTOR_ROLE = 'admin'

const LAYERS = [
  {
    layerId: 'vungu_proposed_peri_urban_zones',
    qml: 'proposed_peri_urban_zones.qml',
    displayName: 'Peri-urban zones',
    description: 'The zones of the Vungu RDC peri-urban local plan, coloured by zone type.',
    dataSource: 'public.zones_master',
    qgisLayer: 'proposed_peri_urban_zones',
    renames: { Cemetry: 'Cemetery', 'Light Industry': 'Light and General Industry' },
    // categories the QGIS style lacks: a copy of an existing category's symbol with the colour given (chosen here, see the header)
    extra: [{ value: 'Densification Zone [MDR]', like: 'Densification Zone [LDR]', fill: '#e5cc94' }],
  },
  {
    layerId: 'vungu_beyond_peri_urban_zones',
    qml: 'gweru_beyond_periurban_zones.qml',
    displayName: 'Beyond the peri-urban area',
    description: 'The areas beyond the peri-urban zones, coloured by planning zone.',
    dataSource: 'public.vungu_beyond_peri_urban_zones',
    qgisLayer: 'gweru_beyond_periurban_zones',
    renames: {
      FLSCF: 'Large Scale Commercial Farms',
      FLSCF_A2: 'Model A2',
      FLSCF_SSCF_A1: 'Model A1',
      SSCF: 'Small Scale Commercial Farms',
    },
  },
]

const NEXT = { draft: 'review', review: 'approved', approved: 'published' }
const dryRun = process.argv.includes('--dry-run')

function renamed(doc, renames, extra = []) {
  // Colours only: see the header on why the QGIS label is dropped.
  const categories = doc.renderer.categories.map((c) => {
    const to = renames[c.value]
    return to ? { ...c, value: to, label: to } : c
  })
  for (const x of extra) {
    const at = categories.findIndex((c) => c.value === x.like)
    if (at < 0) throw new Error(`no category "${x.like}" to take the symbol of "${x.value}" from`)
    categories.splice(at + 1, 0, { ...categories[at], value: x.value, label: x.value, symbol: { ...categories[at].symbol, fill: x.fill } })
  }
  return { ...doc, labels: null, renderer: { ...doc.renderer, categories } }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const db = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    for (const l of LAYERS) {
      const imported = qgisImport.importQml(path.join(QML_DIR, l.qml), { layerId: l.layerId, geometry: 'polygon' })
      if (imported.error) throw new Error(`${l.layerId}: ${imported.error}`)
      const doc = renamed(imported.doc, l.renames, l.extra)
      const mapping = doc.renderer.categories.map((c) => `${c.value || '(other)'} ${c.symbol?.fill ?? ''}`)
      console.log(`[zone-styles] ${l.layerId} by "${doc.renderer.attribute}": ${mapping.join('; ')}`)
      if (dryRun) continue

      await registry.upsertLayer(db, {
        layerId: l.layerId, displayName: l.displayName, description: l.description, geometry: 'polygon',
        dataSource: l.dataSource, dataSrid: 4326, qgisProject: 'vungu-project.qgs', qgisLayer: l.qgisLayer,
        owner: 'Planning and Environment', steward: 'GIS Branch',
        accessRoles: ['admin', 'gis_officer', 'planner', 'eo'],
      })
      const { style, unchanged } = await registry.createDraft(db, {
        layerId: l.layerId, doc, styleName: `${l.displayName}: by zone type`, source: 'qgis',
        sourcePath: `qgis-projects/canonical-qml/${l.qml}`, sourceChecksum: imported.checksum,
        changeSummary: `Colours from the council GIS's QGIS style; category values follow the zone names now in the database (${Object.entries(l.renames).map(([a, b]) => `${a} -> ${b}`).join(', ') || 'none renamed'}).${l.extra?.length ? ` Added: ${l.extra.map((x) => `${x.value} ${x.fill}`).join(', ')} (colour chosen, awaiting GIS Branch confirmation).` : ''}`,
        actor: ACTOR, actorRole: ACTOR_ROLE,
      })
      let status = style.status
      while (NEXT[status]) {
        const { style: s } = await registry.transition(db, {
          layerId: l.layerId, version: style.style_version, to: NEXT[status], actor: ACTOR, actorRole: ACTOR_ROLE,
          reason: 'MVP demonstration: zone colours by type',
        })
        status = s.status
      }
      console.log(`[zone-styles] ${l.layerId}: v${style.style_version} ${status}${unchanged ? ` (${unchanged})` : ''}`)
    }
  } finally {
    await db.end()
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('[zone-styles] failed:', err.message); process.exit(1) })
}

module.exports = { LAYERS, QML_DIR, renamed }
