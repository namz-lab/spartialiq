#!/usr/bin/env node
/**
 * Publishes the symbology of the printed sheet's features into the GIS symbology registry (migration 114), so the portal's maps
 * draw them: facilities and business centres (points, by kind), mines, quarries and the other land features (polygons, by kind),
 * and the plan's railway lines.
 *
 *   node scripts/publish-plan-feature-styles.js [--dry-run]
 *
 * THE COLOURS ARE CHOSEN HERE, NOT THE COUNCIL'S. No QGIS style exists for these layers, so the symbols are a first proposal that the
 * GIS Branch should confirm or replace (a new version through the registry, as always). They keep to a few rules: facilities are
 * round markers coloured by service (health red, schools blue, police indigo, water teal, services grey); business centres are
 * amber to purple by rank; mines and quarries are earth tones, schemes green, the proposed new city a dashed purple outline.
 *
 * The registry's lifecycle is draft -> review -> approved -> published, each step audited. This script takes a style through all of it
 * in one go, recording the actor as "MVP demonstration": a demonstration shortcut, not a review by the GIS Branch. Re-running is safe
 * (an identical document creates no new version).
 */
require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env') })
const { Pool } = require('pg')
const registry = require('../src/services/gis/styleRegistry')
const { styleDoc, markerSymbol, fillSymbol, lineSymbol } = require('../src/services/gis/styleDoc')

const ACTOR = 'MVP demonstration'
const ACTOR_ROLE = 'admin'
const NEXT = { draft: 'review', review: 'approved', approved: 'published' }
const dryRun = process.argv.includes('--dry-run')

const marker = (fill, size) => markerSymbol({ shape: 'circle', fill, size, sizeUnit: 'px', stroke: '#ffffff', strokeWidth: 1, strokeUnit: 'px' })
const poly = (fill, fillOpacity, stroke, extra = {}) => fillSymbol({ fill, fillOpacity, stroke, strokeWidth: 1, strokeUnit: 'px', ...extra })
const cat = (value, label, symbol) => ({ value, label, symbol })

const POINTS = [
  cat('health_facility', 'Health facility', marker('#c0392b', 6)),
  cat('school', 'School', marker('#2f6db5', 5)),
  cat('police_post', 'Police post, station or prison', marker('#3d3d8f', 5)),
  cat('dip_tank', 'Dip tank', marker('#3aa0b5', 4)),
  cat('network_booster', 'Network booster', marker('#7b7b7b', 4)),
  cat('business_centre', 'Business centre', marker('#d98a1f', 6)),
  cat('rural_service_centre', 'Rural service centre', marker('#a05a1c', 7)),
  cat('growth_point', 'Growth point', marker('#6b2d86', 8)),
]
const AREAS = [
  cat('mine', 'Mine', poly('#5b4a3a', 0.65, '#3a2f25')),
  cat('quarry', 'Quarry', poly('#8a8478', 0.7, '#5f5a50')),
  cat('sand_working', 'Sand working', poly('#e0cf94', 0.75, '#a89a63')),
  cat('irrigation_scheme', 'Irrigation scheme', poly('#7fc3a0', 0.55, '#3f8f6a')),
  cat('recreational_site', 'Recreational site', poly('#6fae5a', 0.55, '#3f7f2f')),
  cat('proposed_new_city', 'Proposed new city', poly('#d9a0e0', 0.2, '#7b3f8c', { strokeStyle: 'dash', strokeWidth: 2 })),
]
const fallbackOf = (geometry, symbol) => ({ label: 'Other', symbol })

const LAYERS = [
  {
    layerId: 'vungu_facilities', displayName: 'Facilities and business centres', geometry: 'point', dataSource: 'public.vungu_facilities',
    description: 'Schools, health facilities, police posts, dip tanks, network boosters and business centres, coloured by kind.',
    doc: styleDoc({ layerId: 'vungu_facilities', geometry: 'point', minZoom: 9,
      renderer: { type: 'categorized', method: 'unique_values', attribute: 'kind', categories: POINTS, fallback: fallbackOf('point', marker('#9a9a9a', 4)) } }),
  },
  {
    layerId: 'vungu_land_features', displayName: 'Mines, quarries, schemes and the new city', geometry: 'polygon', dataSource: 'public.vungu_land_features',
    description: 'Mines, quarries, sand workings, irrigation schemes, recreational sites and the proposed new city, coloured by kind.',
    doc: styleDoc({ layerId: 'vungu_land_features', geometry: 'polygon', minZoom: 8,
      renderer: { type: 'categorized', method: 'unique_values', attribute: 'kind', categories: AREAS, fallback: fallbackOf('polygon', poly('#bdbdbd', 0.5, '#7a7a7a')) } }),
  },
  {
    layerId: 'vungu_railway', displayName: 'Railway lines (plan)', geometry: 'line', dataSource: 'public.vungu_railway',
    description: 'The railway lines of the composite master plan.',
    doc: styleDoc({ layerId: 'vungu_railway', geometry: 'line', minZoom: 8,
      renderer: { type: 'single', symbol: lineSymbol({ stroke: '#3a3a3a', strokeWidth: 1.6, strokeUnit: 'px', strokeStyle: 'solid' }) } }),
  },
]

async function main() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required.')
  const db = new Pool({ connectionString: process.env.DATABASE_URL })
  try {
    for (const l of LAYERS) {
      const r = l.doc.renderer
      console.log(`[plan-feature-styles] ${l.layerId}: ${r.type}${r.attribute ? ` by "${r.attribute}"` : ''} ${(r.categories ?? []).map((c) => `${c.value} ${c.symbol.fill}`).join('; ')}`)
      if (dryRun) continue
      await registry.upsertLayer(db, {
        layerId: l.layerId, displayName: l.displayName, description: l.description, geometry: l.geometry,
        dataSource: l.dataSource, dataSrid: 4326, qgisProject: null, qgisLayer: null,
        owner: 'Planning and Environment', steward: 'GIS Branch', accessRoles: ['admin', 'gis_officer', 'planner', 'eo'],
      })
      const { style, unchanged } = await registry.createDraft(db, {
        layerId: l.layerId, doc: l.doc, styleName: `${l.displayName}: by kind`, source: 'manual', sourcePath: 'scripts/publish-plan-feature-styles.js',
        changeSummary: 'First proposal: colours chosen by the developer, not the council GIS (awaiting GIS Branch confirmation).',
        actor: ACTOR, actorRole: ACTOR_ROLE,
      })
      let status = style.status
      while (NEXT[status]) {
        const { style: s } = await registry.transition(db, {
          layerId: l.layerId, version: style.style_version, to: NEXT[status], actor: ACTOR, actorRole: ACTOR_ROLE,
          reason: 'MVP demonstration: first symbology for the printed sheet\'s features',
        })
        status = s.status
      }
      console.log(`[plan-feature-styles] ${l.layerId}: v${style.style_version} ${status}${unchanged ? ` (${unchanged})` : ''}`)
    }
  } finally {
    await db.end()
  }
}

if (require.main === module) {
  main().catch((err) => { console.error('[plan-feature-styles] failed:', err.message); process.exit(1) })
}

module.exports = { LAYERS }
