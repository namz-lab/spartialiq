// Generate QGIS styling FROM the web app's canonical symbology registry.
// ---------------------------------------------------------------------------
// masterplanSymbology.ts is the SINGLE SOURCE OF TRUTH for "one symbol = one
// thing". This script reads it and rewrites the statutory zone layers'
// renderers inside the QGIS project so QGIS Server (WMS) and QGIS Desktop
// render the exact same colours the web map uses. Planners consume this
// styling; they do not author it — change a colour here (in the registry),
// re-run this, and every surface conforms.
//
//   masterplanSymbology.ts  ──►  vungu-project.qgs renderers  (QGIS Server + Desktop)
//                           └──►  web map (already reads the registry directly)
//
// Run:  node scripts/generate-qgis-symbology.mjs
import esbuild from 'esbuild'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REGISTRY = resolve(__dirname, '../src/map/masterplanSymbology.ts')
const PROJECT = process.env.QGIS_PROJECT_LOCAL
  || resolve(__dirname, '../../app-backend/qgis-projects/vungu-project.qgs')
const QML_DIR = resolve(dirname(PROJECT), 'canonical-qml')

// Which layers are statutory-categorised, on which real (lowercase) PostGIS
// column, using which canonical map. Only layers whose colours the registry
// actually governs — administrative layers (chiefdoms) and single-symbol
// layers (rivers, boundaries) are left untouched.
const LAYERS = [
  { layer: 'proposed_peri_urban_zones',    attr: 'zone',       map: 'MASTERPLAN_PROPOSED_ZONE_COLORS', fallback: 'MASTERPLAN_PROPOSED_ZONE_FALLBACK' },
  { layer: 'gweru_peri_urban_zone',        attr: 'zone',       map: 'MASTERPLAN_PROPOSED_ZONE_COLORS', fallback: 'MASTERPLAN_PROPOSED_ZONE_FALLBACK' },
  { layer: 'gweru_beyond_periurban_zones', attr: 'settlement', map: 'MASTERPLAN_SETTLEMENT_COLORS',    fallback: 'MASTERPLAN_SETTLEMENT_FALLBACK' },
]

// ---- load the canonical registry (resolves mpColor(...) for real) ----------
async function loadRegistry() {
  const ts = readFileSync(REGISTRY, 'utf-8')
  const js = (await esbuild.transform(ts, { loader: 'ts', format: 'esm' })).code
  const url = 'data:text/javascript;base64,' + Buffer.from(js).toString('base64')
  return import(url)
}

const hexToRgba = (hex) => {
  const h = hex.replace('#', '')
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h
  const r = parseInt(n.slice(0, 2), 16), g = parseInt(n.slice(2, 4), 16), b = parseInt(n.slice(4, 6), 16)
  return `${r},${g},${b},255`
}
const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// One SimpleFill symbol (modern Option format QGIS Server 3.40 parses cleanly).
function fillSymbol(name, rgba) {
  return `<symbol type="fill" name="${name}" alpha="1" clip_to_extent="1" force_rhr="0" frame_rate="10" is_animated="0">
  <layer class="SimpleFill" enabled="1" locked="0" pass="0">
    <Option type="Map">
      <Option type="QString" name="color" value="${rgba}"/>
      <Option type="QString" name="style" value="solid"/>
      <Option type="QString" name="outline_color" value="35,35,35,255"/>
      <Option type="QString" name="outline_width" value="0.26"/>
      <Option type="QString" name="outline_width_unit" value="MM"/>
      <Option type="QString" name="outline_style" value="solid"/>
      <Option type="QString" name="joinstyle" value="bevel"/>
    </Option>
  </layer>
</symbol>`
}

// A full categorised renderer keyed on `attr`, one category per registry entry
// plus a catch-all (empty value = "all other values") on the fallback colour.
function categorizedRenderer(attr, entries, fallbackHex) {
  const cats = [], syms = []
  entries.forEach(([value, hex], i) => {
    cats.push(`<category value="${xmlEsc(value)}" symbol="${i}" label="${xmlEsc(value)}" render="true"/>`)
    syms.push(fillSymbol(String(i), hexToRgba(hex)))
  })
  const fb = entries.length
  cats.push(`<category value="" symbol="${fb}" label="Other" render="true"/>`)
  syms.push(fillSymbol(String(fb), hexToRgba(fallbackHex)))
  return `<renderer-v2 type="categorizedSymbol" attr="${attr}" symbollevels="0" forceraster="0" enableorderby="0" referencescale="-1">
<categories>
${cats.join('\n')}
</categories>
<symbols>
${syms.join('\n')}
</symbols>
</renderer-v2>`
}

function qml(rendererXml) {
  return `<!DOCTYPE qgis PUBLIC 'http://mrcc.com/qgis.dtd' 'SYSTEM'>
<!-- GENERATED from src/map/masterplanSymbology.ts — do not edit by hand.
     Regenerate with: node scripts/generate-qgis-symbology.mjs -->
<qgis version="3.40" styleCategories="Symbology">
${rendererXml}
</qgis>`
}

// ---------------------------------------------------------------------------
;(async () => {
  const reg = await loadRegistry()
  let project = readFileSync(PROJECT, 'utf-8')
  if (!existsSync(QML_DIR)) mkdirSync(QML_DIR, { recursive: true })

  let rewritten = 0
  for (const cfg of LAYERS) {
    const colourMap = reg[cfg.map]
    const fallbackHex = reg[cfg.fallback]
    if (!colourMap) { console.log(`  SKIP ${cfg.layer}: registry has no ${cfg.map}`); continue }
    const entries = Object.entries(colourMap)
    const renderer = categorizedRenderer(cfg.attr, entries, fallbackHex)

    // rewrite the layer's <renderer-v2> inside its <maplayer> block
    const blockRe = new RegExp(`(<maplayer\\b[\\s\\S]*?<layername>${cfg.layer}</layername>[\\s\\S]*?)<renderer-v2\\b[\\s\\S]*?</renderer-v2>([\\s\\S]*?</maplayer>)`)
    if (!blockRe.test(project)) { console.log(`  SKIP ${cfg.layer}: not found in project`); continue }
    project = project.replace(blockRe, (_, pre, post) => pre + renderer + post)

    writeFileSync(join(QML_DIR, `${cfg.layer}.qml`), qml(renderer), 'utf-8')
    console.log(`  ${cfg.layer.padEnd(30)} attr="${cfg.attr}"  ${entries.length} classes + fallback`)
    rewritten++
  }

  writeFileSync(PROJECT, project, 'utf-8')
  console.log(`\ngenerated from src/map/masterplanSymbology.ts`)
  console.log(`  rewrote ${rewritten} layer renderers in ${PROJECT}`)
  console.log(`  wrote QGIS Desktop QML to ${QML_DIR}`)
  console.log(`\nNext: docker restart vungu-qgis-server  (or let the project watcher do it)`)
})().catch((e) => { console.error('generation failed:', e.message); process.exit(1) })
