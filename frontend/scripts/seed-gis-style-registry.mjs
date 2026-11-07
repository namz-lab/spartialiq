// scripts/seed-gis-style-registry.mjs
// ---------------------------------------------------------------------------
// ONE-TIME migration: populate the enterprise GIS symbology registry
// (backend migration 114) with v1 PUBLISHED styles for every governed layer,
// then verify QGIS and the web compile to the same cartography.
//
// This is Phase 4 of the migration ("import/publish existing styles"). After it
// runs, the registry is the authority and the frontend resolves styles from the
// API instead of from its own tables.
//
// PROVENANCE IS PER LAYER, AND DELIBERATE
// ---------------------------------------
// "QGIS is authoritative" holds for the layers QGIS actually styles. It is NOT
// a blanket rule, because the audit found two hard limits:
//
//   * the QGIS project styles 10 layers; the web renders 24. For roads,
//     landuse, buildings, water, admin boundaries and POIs there is no QGIS
//     style to be authoritative over.
//   * where both exist they can differ in RICHNESS, not just colour. QGIS's
//     `roads` layer is a single flat #b7484b line; the statutory schedule
//     carries the six-class road hierarchy (National -> Primary Distributor ->
//     District -> Local -> Access -> Proposed) over 25 fclass values.
//     Importing QGIS there would delete the hierarchy.
//
// So each layer declares its authoring source, that source is recorded in
// gis_style.source / source_path, and CONFLICTS ARE REPORTED rather than
// silently resolved. Run with --report to audit without writing anything.
//
// Usage:
//   node scripts/seed-gis-style-registry.mjs --report   # audit only, no writes
//   node scripts/seed-gis-style-registry.mjs            # seed + publish v1
//   node scripts/seed-gis-style-registry.mjs --actor=me
// ---------------------------------------------------------------------------

import esbuild from 'esbuild'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve, join, basename } from 'node:path'
import { createRequire } from 'node:module'

const __dirname = dirname(fileURLToPath(import.meta.url))
const FRONTEND = resolve(__dirname, '..')
const BACKEND = process.env.VUNGU_BACKEND || resolve(FRONTEND, '../app-backend')

// The backend owns pg + the registry modules; the frontend owns esbuild + the
// statutory schedule. Bridge by requiring out of the backend's tree.
const backendRequire = createRequire(join(BACKEND, 'package.json'))
const { Client } = backendRequire('pg')
backendRequire('dotenv').config({ path: join(BACKEND, '.env') })

const styleDocMod = backendRequire('./src/services/gis/styleDoc.js')
const qgisImport = backendRequire('./src/services/gis/qgisImport.js')
const registry = backendRequire('./src/services/gis/styleRegistry.js')
const { compareFidelity } = backendRequire('./src/services/gis/compile.js')
const { LAYERS } = backendRequire('./src/config/spatialLayers.js')

const {
  styleDoc, fillSymbol, lineSymbol, markerSymbol, zoomScale, opacityCurve,
  validate, classifyFidelity,
} = styleDocMod

// VUNGU_QGS points at the authoring project. It must be an unzipped .qgs:
// importProject reads plain XML, so a .qgz has to be extracted first.
const QGS = process.env.VUNGU_QGS || join(BACKEND, 'qgis-projects', 'vungu-project.qgs')
const QGS_REL = process.env.VUNGU_QGS ? basename(QGS) : 'qgis-projects/vungu-project.qgs'
const STATUTORY_REL = 'frontend/src/map/masterplanSymbology.ts'

const args = process.argv.slice(2)
const REPORT_ONLY = args.includes('--report')
const ACTOR = (args.find((a) => a.startsWith('--actor=')) || '--actor=seed-migration').split('=')[1]

// ── Load the statutory schedule (resolves mpColor() for real) ───────────────
async function loadStatutory() {
  const ts = readFileSync(join(FRONTEND, 'src/map/masterplanSymbology.ts'), 'utf-8')
  const js = (await esbuild.transform(ts, { loader: 'ts', format: 'esm' })).code
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'))
}

// ── Which QGIS layer, if any, authors which tile layer ─────────────────────
// The tile-registry id and the QGIS <layername> differ for the master-plan
// layers (tile ids keep a `vungu_` prefix; see docs/SSOT-spatial.md).
// Keys are tile-registry ids, values are <layername> in the authoring project.
// Names below are from the composite master plan (ver 5); the older
// vungu-project.qgs used short lowercase names, so both are listed per layer
// and the first one present in the loaded project wins.
const QGIS_AUTHORS = {
  vungu_proposed_peri_urban_zones: ['Proposed Land Use Zones', 'proposed_peri_urban_zones'],
  vungu_beyond_peri_urban_zones: ['Vungu_RDC_Master_Plan — beyond_peri_urban_zones', 'gweru_beyond_periurban_zones'],
  vungu_cemeteries: ['Cemetery'],
  vungu_waste_management: ['Waste management'],
  vungu_farm_cadastre: ['Farm Cadastre'],
  wards: ['Gweru Rural Wards'],
  provinces: ['midlands_province'],
  water_areas: ['Dams'],
  waterways: ['Rivers'],
  buildings: ['Gweru Rural Buildings'],
}

// ── The GIS officer's QGIS workspace (.qml sidecars) ───────────────────────
// The authoring workspace holds one .qml per layer, named for the QGIS layer
// rather than the tile-registry id, so the pairing has to be declared. These
// take precedence over the .qgs project: they are the styles the officer
// actually maintains.
//
// ONLY layers whose classification attribute EXISTS in the tile layer are
// listed. A .qml that classifies on a column the vector tile does not carry
// renders every feature in the "no match" bucket, which is worse than the
// statutory fallback -- see QML_UNUSABLE below for the ones that fail this
// test and why.
const QML_DIR = process.env.VUNGU_QML_DIR || join(BACKEND, 'qgis-projects', 'styles')
// `country` is intentionally absent: QGIS_REJECTED already documents why the
// filled zimbabwe polygon cannot drive the always-on base frame.
// A .qml earns authority only when it contributes a CLASSIFICATION the web
// does not already have. Single-symbol sidecars must not be imported, because
// qgisImport does not carry QGIS symbol opacity through the conversion: every
// converted polygon lands at fill-opacity 1. That is correct for a QGIS print
// map, where one layer is viewed at a time, and wrong for a stacked web
// basemap, where an opaque #cccccc admin polygon hides the roads, landuse and
// buildings beneath it. See QML_SINGLE_SYMBOL below.
const QML_AUTHORS = {
  // 6-class categorized renderer on `settlement` -- real cartographic
  // information the statutory schedule does not carry.
  vungu_beyond_peri_urban_zones: 'Vungu_RDC_Master_Plan__beyond_periurban_zones',
  // vungu_proposed_peri_urban_zones is deliberately NOT taken from the
  // sidecar: Vungu_RDC_Master_Plan__proposed_peri_urban_zones.qml is a single
  // symbol, while the .qgs project carries the 11-class categorized renderer.
  // Precedence is "richest usable style", not "newest file".
}

// Single-symbol sidecars that exist and parse, but would replace purpose-built
// web cartography with an opaque QGIS default. Listed so the decision is
// auditable. Re-enable individually only once symbol opacity survives the
// conversion in qgisImport.convertSymbol().
const QML_SINGLE_SYMBOL = {
  provinces: 'midlands_province.qml -> fill #cccccc at opacity 1',
  districts: 'Districts.qml -> fill #cccccc at opacity 1',
  wards: 'Gweru_Rural_Wards.qml -> fill #cccccc at opacity 1',
  buildings: 'Gweru_Rural_Buildings.qml -> fill #000000 at opacity 1',
  water_areas: 'Dams.qml -> fill #0000ee at opacity 1',
  waterways: 'Rivers.qml -> line #0000ee',
  railways: 'Railway.qml -> line #000000',
  vungu_parcels: 'Vungu_RDC_Master_Plan__parcels.qml -> fill #cccccc at opacity 1 (statutory uses Yellow 2 at 0.35)',
  vungu_cemeteries: 'Cemetery.qml -> fill #f0f0f0 at opacity 1 (statutory uses Grey 1.2 at 0.7)',
  vungu_farm_cadastre: 'Zim_gweru_rural_farm_cadastre_wgs_84.qml -> fill #91522d at opacity 1 (statutory uses Yellow-Brown 3 at 0.30)',
}

// Workspace .qml files that were checked and cannot drive a tile layer,
// recorded so the omission is auditable rather than an oversight.
const QML_UNUSABLE = {
  roads: 'Roads_by_Authority.qml classifies on `authority` (MOTID/RIDA/VUNGU). The roads tile layer carries fclass/ref/oneway and has no `authority` column, so every feature would fall to the no-match bucket.',
  landuse: 'Land_Use_Zones.qml classifies on `settlement` and combined_land_use_zones.qml on `Zone` (tenure classes: Communal/FLSCF/SSCF). The landuse tile layer carries OSM `fclass`, a different taxonomy.',
  vungu_waste_management: 'Waste_management.qml classifies on `USE`; the tile layer exposes `use`. Case-folded attribute matching is not implemented in qgisImport, so this is left on the statutory style.',
}

// Layers where a QGIS style EXISTS but is deliberately not used, with the
// reason recorded so the decision is auditable rather than accidental.
const QGIS_REJECTED = {
  roads: 'QGIS styles roads as a single flat #b7484b line; the statutory schedule carries the six-class road hierarchy (National/Primary/District/Local/Access/Proposed) over 25 fclass values. Importing QGIS here would delete the hierarchy.',
  country: 'The QGIS `zimbabwe` layer is a filled polygon; the web renders the country as a boundary outline only, because it is the always-on reference frame beneath every other layer.',
}

// ── Statutory basemap symbology, transcribed ONCE from the frontend tables ──
// This is the only place the old PALETTE values are read. After seeding, the
// registry is the authority and vunguBasemapStyle.ts stops holding colours.
function statutoryDocs(S) {
  const docs = {}
  const put = (layerId, geometry, renderer, extra = {}) => {
    docs[layerId] = styleDoc({ layerId, geometry, renderer, ...extra })
  }

  const solidFill = (fill, stroke, fillOpacity = 1, strokeWidth = 0.1) =>
    fillSymbol({ fill, stroke, fillOpacity, strokeWidth, strokeUnit: 'px' })

  // --- admin boundaries ----------------------------------------------------
  // Districts are the local-authority boundary: statutory black dot-and-dash.
  // Districts and wards FADE as detail arrives, so they recede instead of
  // fighting the street-level cartography -- preserved exactly as the map
  // renders today, via opacityCurve.
  put('country', 'polygon',
    { type: 'single', symbol: lineSymbol({ stroke: '#9c9cc8', strokeWidth: 2.0, strokeUnit: 'px', strokeDashArray: [3, 1.5] }) })
  put('districts', 'polygon', {
    type: 'single',
    symbol: lineSymbol({ stroke: S.LOCAL_AUTHORITY_BOUNDARY_COLOR, strokeWidth: 0.9, strokeUnit: 'px', strokeDashArray: S.DOT_DASH }),
    opacityCurve: opacityCurve([{ zoom: 5, value: 1 }, { zoom: 13, value: 0.7 }, { zoom: 17, value: 0.35 }]),
  })
  put('wards', 'polygon', {
    type: 'single',
    symbol: lineSymbol({ stroke: '#c4bdd2', strokeWidth: 0.5, strokeUnit: 'px', strokeDashArray: [3, 1.5] }),
    opacityCurve: opacityCurve([{ zoom: 9, value: 1 }, { zoom: 13, value: 0.55 }, { zoom: 16, value: 0.15 }]),
  })

  // Provinces carry a per-province colour WASH at country zoom that fades to
  // nothing by z11. Categorised on name_en, exactly as the map draws today --
  // seeding this as a plain boundary line would have silently deleted the wash.
  const PROVINCE_COLORS = {
    Bulawayo: '#fda4af',
    Harare: '#f9a8d4',
    Manicaland: '#86efac',
    'Mashonaland Central': '#fde68a',
    'Mashonaland East': '#fcd34d',
    'Mashonaland West': '#fed7aa',
    Masvingo: '#c4b5fd',
    'Matabeleland North': '#a5b4fc',
    'Matabeleland South': '#67e8f9',
    Midlands: '#d9f99d',
  }
  put('provinces', 'polygon', {
    type: 'categorized',
    attribute: 'name_en',
    method: 'unique_values',
    categories: Object.entries(PROVINCE_COLORS).map(([value, fill]) => ({
      value, label: value, symbol: fillSymbol({ fill, stroke: null, fillOpacity: 1 }),
    })),
    fallback: { label: 'Other', symbol: fillSymbol({ fill: '#cbd5e1', stroke: null, fillOpacity: 1 }) },
    opacityCurve: opacityCurve([
      { zoom: 0, value: 0.55 }, { zoom: 6, value: 0.45 }, { zoom: 8, value: 0.25 },
      { zoom: 10, value: 0.07 }, { zoom: 11, value: 0 },
    ]),
  })

  // --- landuse: statutory land-use fills keyed on OSM fclass ---------------
  put('landuse', 'polygon', {
    type: 'categorized',
    attribute: 'fclass',
    method: 'unique_values',
    categories: Object.entries(S.OSM_LANDUSE_COLORS).map(([value, fill]) => ({
      value, label: value, symbol: solidFill(fill, 'rgba(0,0,0,0.05)', 0.9),
    })),
    fallback: { label: 'Unused land', symbol: solidFill(S.OSM_LANDUSE_FALLBACK, 'rgba(0,0,0,0.05)', 0.9) },
  })
  put('admin_areas', 'polygon', { type: 'single', symbol: solidFill('#f6f3ec', 'rgba(0,0,0,0.05)', 0.5) })
  put('places_areas', 'polygon', { type: 'single', symbol: solidFill('#f6f3ec', 'rgba(0,0,0,0.06)', 0.5) })

  // --- hydrology / nature --------------------------------------------------
  put('water_areas', 'polygon', { type: 'single', symbol: solidFill('#aad3df', '#6699cc', 1) })
  put('waterways', 'line', { type: 'single', symbol: lineSymbol({ stroke: '#aad3df', strokeWidth: 1.6, strokeUnit: 'px' }) })
  put('protected_areas', 'polygon', { type: 'single', symbol: solidFill(S.mpColor('Green 2.2'), S.mpColor('Green 2'), 0.5) })
  put('natural_areas', 'polygon', { type: 'single', symbol: solidFill(S.mpColor('Green 2.2'), S.mpColor('Green 2'), 0.45) })

  // --- transport: the statutory road hierarchy -----------------------------
  // Widths are the width AT z13; zoomScale reproduces the 1.4x-per-level curve
  // for both MapLibre and QGIS. Casing is the paper halo beneath the ink.
  const FILL_W13 = {
    motorway: 4, motorway_link: 3, trunk: 3, trunk_link: 2.4,
    primary: 3, primary_link: 2.4, secondary: 2.5, secondary_link: 2,
    tertiary: 2, tertiary_link: 1.6,
    residential: 1.5, living_street: 1.5, unclassified: 1.5, service: 1,
    pedestrian: 1, footway: 0.9, path: 0.9, steps: 0.9, bridleway: 0.9, cycleway: 0.9,
    track: 1, track_grade1: 1, track_grade2: 1,
    track_grade3: 0.9, track_grade4: 0.8, track_grade5: 0.7,
  }
  const CASING_W13 = {
    motorway: 6, motorway_link: 4.5, trunk: 5, trunk_link: 4,
    primary: 4.5, primary_link: 3.6, secondary: 4, secondary_link: 3.2,
    tertiary: 3, tertiary_link: 2.4,
    residential: 2.5, living_street: 2.5, unclassified: 2.5, service: 1.5,
    track: 1.6, track_grade1: 1.6, track_grade2: 1.6,
    track_grade3: 1.4, track_grade4: 1.2, track_grade5: 1.1,
  }
  put('roads', 'line', {
    type: 'categorized',
    attribute: 'fclass',
    method: 'unique_values',
    zoomScale: zoomScale({ base: 1.4, refZoom: 13, minZoom: 8, maxZoom: 19 }),
    categories: Object.entries(S.OSM_FCLASS_ROAD_COLORS).map(([value, stroke]) => ({
      value,
      label: value,
      symbol: lineSymbol({
        stroke,
        strokeWidth: FILL_W13[value] ?? 1,
        strokeUnit: 'px',
        casing: { stroke: S.ROAD_CASING_COLOR, strokeWidth: CASING_W13[value] ?? 1.5, strokeUnit: 'px' },
      }),
    })),
    fallback: {
      label: 'Access road',
      symbol: lineSymbol({
        stroke: S.OSM_FCLASS_ROAD_FALLBACK, strokeWidth: 1, strokeUnit: 'px',
        casing: { stroke: S.ROAD_CASING_COLOR, strokeWidth: 1.5, strokeUnit: 'px' },
      }),
    },
  })
  // Rail grey, not blue -- blue reads as a river.
  put('railways', 'line', {
    type: 'single',
    symbol: lineSymbol({ stroke: '#707070', strokeWidth: 1.2, strokeUnit: 'px' }),
  })

  // --- structures ----------------------------------------------------------
  put('buildings', 'polygon', { type: 'single', symbol: solidFill('#d9d0c9', '#b5aca0', 1) })
  put('traffic_areas', 'polygon', { type: 'single', symbol: solidFill('#e9e7e2', '#cfccc4', 0.7) })
  put('transport_areas', 'polygon', { type: 'single', symbol: solidFill('#e6e1d8', '#cbc4b4', 0.75) })
  put('pois_areas', 'polygon', { type: 'single', symbol: solidFill('#f2dad9', '#d9b9b6', 0.6) })
  put('places_of_worship_areas', 'polygon', { type: 'single', symbol: solidFill('#d0cfce', '#aaa9a8', 0.7) })

  // --- points of interest --------------------------------------------------
  // MapLibre circle-radius is a radius; the styleDoc marker `size` is a
  // diameter, so 6px here == the radius-3 dots the map draws today.
  const dot = (fill) => markerSymbol({
    shape: 'circle', fill, size: 6, sizeUnit: 'px',
    stroke: '#ffffff', strokeWidth: 1, strokeUnit: 'px',
  })
  put('places_points', 'point', { type: 'single', symbol: dot('#5b5b5b') })
  put('pois_points', 'point', { type: 'single', symbol: dot('#0092da') })
  put('traffic_points', 'point', { type: 'single', symbol: dot('#cc6644') })
  put('transport_points', 'point', { type: 'single', symbol: dot('#0092da') })
  put('natural_points', 'point', { type: 'single', symbol: dot('#6a9e3f') })
  put('places_of_worship_points', 'point', { type: 'single', symbol: dot('#7b5fa8') })

  // --- Vungu stands register: status-coded so allocation state is legible ---
  // Strengthens as you zoom in, so the register reads at street level.
  put('stands', 'polygon', {
    type: 'categorized',
    attribute: 'status',
    method: 'unique_values',
    categories: [
      { value: 'available', label: 'Available', symbol: solidFill('#22c55e', '#15803d') },
      { value: 'reserved', label: 'Reserved', symbol: solidFill('#f97316', '#c2410c') },
      { value: 'allocated', label: 'Allocated', symbol: solidFill('#3b82f6', '#1d4ed8') },
      { value: 'withdrawn', label: 'Withdrawn', symbol: solidFill('#e5e7eb', '#9ca3af') },
    ],
    fallback: { label: 'Unknown', symbol: solidFill('#94a3b8', '#475569') },
    opacityCurve: opacityCurve([{ zoom: 9, value: 0.35 }, { zoom: 14, value: 0.55 }]),
  })

  // --- Vungu master plan (council overlays) --------------------------------
  put('vungu_cemeteries', 'polygon', { type: 'single', symbol: solidFill(S.mpColor('Grey 1.2'), S.mpColor('Grey 1'), 0.7) })
  put('vungu_waste_management', 'polygon', { type: 'single', symbol: solidFill(S.mpColor('Green-Brown 2'), '#6f724a', 0.7) })
  put('vungu_farm_cadastre', 'polygon', { type: 'single', symbol: solidFill(S.mpColor('Yellow-Brown 3'), '#a8894a', 0.30) })
  put('vungu_parcels', 'polygon', { type: 'single', symbol: solidFill(S.mpColor('Yellow 2'), '#c0a94e', 0.35) })

  return docs
}

const pad = (s, n) => String(s ?? '').padEnd(n)

;(async () => {
  const S = await loadStatutory()
  const statutory = statutoryDocs(S)

  if (!existsSync(QGS)) {
    console.error(`QGIS project not found at ${QGS}\nSet VUNGU_BACKEND if the backend lives elsewhere.`)
    process.exit(1)
  }
  const qgisLayers = new Map(qgisImport.importProject(QGS).map((l) => [l.layerId, l]))

  console.log('\n═══ GIS symbology provenance audit ═══\n')
  console.log(`  tile-registry layers : ${LAYERS.length}`)
  console.log(`  QGIS project layers  : ${qgisLayers.size}  (${QGS_REL})`)
  console.log(`  statutory schedule   : ${Object.keys(statutory).length} layers  (${STATUTORY_REL})`)

  // Decide provenance per layer.
  const plan = []
  for (const layer of LAYERS) {
    // QGIS_AUTHORS lists candidate <layername>s per tile layer; take the first
    // that the loaded project actually contains, so one mapping table serves
    // both the composite master plan and the older vungu-project.qgs.
    const candidates = QGIS_AUTHORS[layer.id]
      ? (Array.isArray(QGIS_AUTHORS[layer.id]) ? QGIS_AUTHORS[layer.id] : [QGIS_AUTHORS[layer.id]])
      : []
    const qgisName = candidates.find((n) => qgisLayers.has(n)) || null
    const fromQgis = qgisName ? qgisLayers.get(qgisName) : null
    const rejected = QGIS_REJECTED[layer.id]
    const fallbackDoc = statutory[layer.id]

    // The officer's workspace .qml outranks the .qgs project: it is the style
    // actually being maintained. Same rejection rules apply.
    const qmlName = QML_AUTHORS[layer.id]
    let fromQml = null
    if (qmlName && !rejected) {
      const qmlPath = join(QML_DIR, `${qmlName}.qml`)
      if (existsSync(qmlPath)) {
        try {
          fromQml = qgisImport.importQml(qmlPath, {
            layerId: layer.id,
            geometry: layer.geomType,
          })
        } catch (e) {
          fromQml = { error: e.message }
        }
      }
    }

    // A categorized/graduated renderer classifies on an attribute. QGIS keeps
    // the source-file capitalisation ("Zone", "USE"); PostGIS folds unquoted
    // identifiers to lower case, so the vector tile carries "zone"/"use". Fold
    // the attribute onto the tile's own spelling, and reject the style outright
    // when the tile has no such column at all -- every feature would otherwise
    // land in the no-match bucket and the layer would render blank.
    const reconcileAttribute = (imported, qgisLayerName) => {
      if (!imported || imported.error) return imported
      const attr = imported.doc?.renderer?.attribute
      if (!attr) return imported
      const match = (layer.attributes || []).find(
        (a) => a.toLowerCase() === String(attr).toLowerCase(),
      )
      if (!match) {
        return { error: `renderer classifies on "${attr}", which the ${layer.id} tile layer does not carry (has: ${(layer.attributes || []).join(', ')})` }
      }
      if (match === attr) return imported
      return {
        ...imported,
        doc: { ...imported.doc, renderer: { ...imported.doc.renderer, attribute: match } },
        attributeFolded: `${attr} -> ${match}`,
        qgisLayerName,
      }
    }

    const qgisResolved = reconcileAttribute(fromQgis, qgisName)

    let decision
    if (fromQml && !fromQml.error) {
      decision = {
        source: 'qgis',
        sourcePath: `${QML_DIR}/${qmlName}.qml`,
        qgisLayer: qmlName,
        doc: { ...fromQml.doc, layerId: layer.id },
        why: `QGIS workspace sidecar authors this layer (${qmlName}.qml)`,
      }
    } else if (qgisResolved && !qgisResolved.error && !rejected) {
      decision = {
        source: 'qgis',
        sourcePath: QGS_REL,
        qgisLayer: qgisName,
        doc: { ...qgisResolved.doc, layerId: layer.id },
        why: `QGIS authors this layer (<layername>${qgisName}</layername>)`
          + (qgisResolved.attributeFolded ? `; attribute folded ${qgisResolved.attributeFolded}` : ''),
      }
    } else if (fallbackDoc) {
      decision = {
        source: 'statutory_schedule',
        sourcePath: STATUTORY_REL,
        qgisLayer: qgisName || null,
        doc: fallbackDoc,
        why: rejected
          ? `QGIS style rejected: ${rejected}`
          : (qgisResolved?.error
            ? `QGIS layer present but unusable: ${qgisResolved.error}`
            : 'no QGIS style exists for this layer'),
      }
    } else {
      plan.push({ layer, error: 'no style available from either source' })
      continue
    }

    // Scale range comes from the tile registry: it is the data authority for
    // where a layer is served at all.
    decision.doc = {
      ...decision.doc,
      layerId: layer.id,
      scale: {
        minZoom: decision.doc.scale?.minZoom ?? layer.minzoom ?? null,
        maxZoom: decision.doc.scale?.maxZoom ?? layer.maxzoom ?? null,
      },
    }
    plan.push({ layer, ...decision })
  }

  console.log('\n─── provenance decision per layer ───\n')
  console.log(`  ${pad('layer', 32)}${pad('geom', 8)}${pad('source', 20)}${pad('renderer', 13)}${pad('classes', 8)}fidelity`)
  console.log(`  ${'-'.repeat(94)}`)
  for (const p of plan) {
    if (p.error) { console.log(`  ${pad(p.layer.id, 32)}${pad(p.layer.geomType, 8)}!! ${p.error}`); continue }
    const r = p.doc.renderer
    const n = r.categories?.length ?? r.ranges?.length ?? 1
    console.log(`  ${pad(p.layer.id, 32)}${pad(p.doc.geometry, 8)}${pad(p.source, 20)}${pad(r.type, 13)}${pad(n, 8)}${classifyFidelity(p.doc).level}`)
  }

  const conflicts = plan.filter((p) => p.layer && QGIS_REJECTED[p.layer.id])
  if (conflicts.length) {
    console.log('\n─── conflicts (QGIS style present but NOT used) ───\n')
    for (const c of conflicts) console.log(`  ${c.layer.id}\n    ${c.why}\n`)
  }

  const webIds = new Set(LAYERS.map((l) => l.id))
  const mappedQgis = new Set(Object.values(QGIS_AUTHORS))
  const qgisOnly = [...qgisLayers.keys()].filter((n) => !mappedQgis.has(n) && !webIds.has(n))
  if (qgisOnly.length) {
    console.log('─── QGIS layers with no vector-tile counterpart ───')
    console.log('    (styled in QGIS, reaching the web via QGIS Server WMS only)\n')
    for (const n of qgisOnly) {
      const l = qgisLayers.get(n)
      console.log(`  ${pad(n, 34)}${l.error ? '!! ' + l.error : l.doc.renderer.type}`)
    }
    console.log()
  }

  const invalid = plan.filter((p) => p.doc && !validate(p.doc).valid)
  if (invalid.length) {
    console.log('─── VALIDATION FAILURES (these cannot be published) ───\n')
    for (const p of invalid) {
      console.log(`  ${p.layer.id}`)
      validate(p.doc).errors.forEach((e) => console.log(`    - ${e}`))
    }
    console.log()
  }

  const warned = plan.filter((p) => p.doc && validate(p.doc).warnings.length)
  if (warned.length) {
    console.log('─── warnings ───\n')
    for (const p of warned) {
      console.log(`  ${p.layer.id}`)
      validate(p.doc).warnings.forEach((w) => console.log(`    ! ${w}`))
    }
    console.log()
  }

  console.log('─── fidelity: QGIS vs web ───\n')
  let match = 0
  let mismatch = 0
  for (const p of plan) {
    if (!p.doc) continue
    const cmp = compareFidelity(p.doc)
    if (cmp.match) { match++; continue }
    mismatch++
    console.log(`  MISMATCH ${p.layer.id}`)
    cmp.checks.filter((c) => !c.match).forEach((c) =>
      console.log(`    ${c.property}: qgis=${c.qgis} web=${c.web}`))
  }
  console.log(`  ${match} layers match, ${mismatch} mismatch\n`)

  if (REPORT_ONLY) {
    console.log('--report given: nothing written.\n')
    process.exit(mismatch || invalid.length ? 1 : 0)
  }
  if (invalid.length) {
    console.error('refusing to seed while any style fails validation.\n')
    process.exit(1)
  }

  // ── Write ────────────────────────────────────────────────────────────────
  const db = new Client(
    process.env.DATABASE_URL
      ? { connectionString: process.env.DATABASE_URL }
      : {
          host: process.env.PGHOST || 'localhost',
          user: process.env.PGUSER,
          password: process.env.PGPASSWORD,
          database: process.env.PGDATABASE,
          port: process.env.PGPORT || 5432,
        },
  )
  await db.connect()
  // styleRegistry expects a pool-like `connect()`; a single Client IS its own
  // connection, so hand back a wrapper whose release() is a no-op.
  const dbAdapter = {
    query: (...a) => db.query(...a),
    connect: async () => ({ query: (...a) => db.query(...a), release: () => {} }),
  }

  console.log('─── seeding ───\n')
  let created = 0
  let published = 0
  let skipped = 0

  for (const p of plan) {
    if (!p.doc) continue
    const { layer } = p

    await registry.upsertLayer(dbAdapter, {
      layerId: layer.id,
      displayName: layer.title || layer.id,
      description: `${layer.group} layer served as MVT from ${layer.table}`,
      geometry: p.doc.geometry,
      dataSource: layer.table,
      dataSrid: layer.srid || 4326,
      qgisProject: p.qgisLayer ? QGS_REL : null,
      qgisLayer: p.qgisLayer,
      owner: 'Vungu Rural District Council',
      steward: 'GIS Officer',
      minZoom: layer.minzoom ?? null,
      maxZoom: layer.maxzoom ?? null,
      metadata: { group: layer.group, tileAttributes: layer.attributes },
    })

    const draft = await registry.createDraft(dbAdapter, {
      layerId: layer.id,
      doc: p.doc,
      styleName: `${layer.title || layer.id} v1`,
      source: p.source,
      sourcePath: p.sourcePath,
      changeSummary: `Initial registry import. ${p.why}`,
      actor: ACTOR,
      actorRole: 'admin',
      metadata: { seededBy: 'seed-gis-style-registry.mjs', provenanceReason: p.why },
    })

    if (draft.unchanged) {
      // The registry de-duplicates on checksum against ANY version, whatever
      // its status. When the match is a deprecated version, a later version is
      // still the published one and re-running this script would silently
      // leave the wrong cartography live. Roll the match back so "unchanged"
      // means "the published style already matches the source", not merely
      // "these bytes exist somewhere in the history".
      const matched = draft.style
      if (matched && matched.status !== 'published') {
        await registry.rollback(dbAdapter, {
          layerId: layer.id,
          toVersion: matched.style_version,
          actor: ACTOR,
          actorRole: 'admin',
          reason: `re-publishing v${matched.style_version}: it matches the authored source, a later version had superseded it`,
        })
        published++
        console.log(`  ^ ${pad(layer.id, 32)}rolled back to v${matched.style_version} (was ${matched.status})`)
        continue
      }
      skipped++
      console.log(`  = ${pad(layer.id, 32)}${draft.unchanged}`)
      continue
    }
    created++

    const v = draft.style.style_version
    for (const to of ['review', 'approved', 'published']) {
      await registry.transition(dbAdapter, {
        layerId: layer.id, version: v, to, actor: ACTOR, actorRole: 'admin',
        reason: to === 'approved'
          ? 'initial import: reproduces the cartography already in production'
          : 'initial import',
      })
    }
    published++
    console.log(`  + ${pad(layer.id, 32)}v${v} published  (${p.source}, fidelity ${draft.fidelity.level})`)
  }

  const layers = await registry.listLayers(dbAdapter)
  const withStyle = layers.filter((l) => l.style_id).length

  console.log(`\n  ${created} versions created, ${published} published, ${skipped} unchanged`)
  console.log(`  registry now governs ${layers.length} layers; ${withStyle} have a published style\n`)

  const report = await registry.fidelityReport(dbAdapter)
  console.log('─── fidelity report ───')
  console.log(`  MATCH ${report.matched} / ${report.total}`)
  console.log(`  by strategy : ${JSON.stringify(report.byStrategy)}`)
  console.log(`  by fidelity : ${JSON.stringify(report.byFidelity)}`)
  if (report.unstyledLayers.length) {
    console.log(`  unstyled    : ${report.unstyledLayers.map((l) => l.layer_id).join(', ')}`)
  }
  console.log()

  await db.end()
  process.exit(report.mismatched ? 1 : 0)
})().catch((e) => { console.error('\nseed failed:', e.message, '\n', e.stack); process.exit(1) })
