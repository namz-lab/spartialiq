<script setup lang="ts">
// The master plan, for the Chief Executive. Read-only: nothing here changes the plan, a decision or a signature.
//
// WHAT IT SHOWS (all of it from GET /api/executive/master-plan, which reads the registers the planner and the workbench keep)
//   - which plan and revision, whether it is in force, and how far its adoption has got (council, four signatures, Minister, gazette);
//   - a map: the plan's zones coloured as the published style colours them, with the facilities, mines and quarries, schemes and railway the sheet shows,
//     each switchable. A click on a zone, a facility or a land feature says what it is;
//   - the zones as a list that carries the same figures as the map (area, share of the plan, parcels, what the plan decides there), so the map is never the
//     only way in;
//   - how much of the register the plan covers, and how it is working in development applications.
//
// HONESTY RULES
//   - A plan that is not gazetted says "Not in force". Decisions that were only affirmed for testing are shown as that, in a banner, never as the council's.
//   - A figure that is zero is shown as zero; a missing register is said to be missing, not drawn as a row of zeros.
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import { RouterLink } from 'vue-router'
import { ArrowLeft, Check, Circle, Info, TriangleAlert } from 'lucide-vue-next'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addVunguBasemap, setBasemapLayerVisible } from '@/map/vunguBasemap'
import { executiveApi, type MasterPlan, type MasterPlanZone } from '@/services/executiveOverview'
import { getPublishedStyle } from '@/services/gisStyles'
import { kindLegend, identityLine } from '@/services/planLegend'

const FACILITY: Record<string, string> = {
  school: 'Schools', health_facility: 'Health facilities', police_post: 'Police posts and prisons', dip_tank: 'Dip tanks', network_booster: 'Network boosters',
  business_centre: 'Business centres', rural_service_centre: 'Rural service centres', growth_point: 'Growth points',
}
const FEATURE: Record<string, string> = {
  mine: 'Mines', quarry: 'Quarries', sand_working: 'Sand workings', irrigation_scheme: 'Irrigation schemes', recreational_site: 'Recreational sites', proposed_new_city: 'Proposed new city',
}
const ONE: Record<string, string> = {
  school: 'School', health_facility: 'Health facility', police_post: 'Police post, station or prison', dip_tank: 'Dip tank', network_booster: 'Network booster',
  business_centre: 'Business centre', rural_service_centre: 'Rural service centre', growth_point: 'Growth point',
  mine: 'Mine', quarry: 'Quarry', sand_working: 'Sand working', irrigation_scheme: 'Irrigation scheme', recreational_site: 'Recreational site', proposed_new_city: 'Proposed new city',
}

const data = ref<MasterPlan | null>(null)
const error = ref<string | null>(null)
const loading = ref(true)
const selected = ref<string | null>(null)
const picked = ref<{ title: string; lines: string[] } | null>(null)
const colours = ref<Record<string, string>>({})

const host = ref<HTMLElement | null>(null)
const map = shallowRef<any>(null)
let resizeObserver: ResizeObserver | undefined

const ZONE_LAYERS = ['vungu-vungu_proposed_peri_urban_zones', 'vungu-vungu_beyond_peri_urban_zones']
const FEATURE_LAYERS = ['vungu-vungu_facilities', 'vungu-vungu_land_features']

// What the map starts with: the plan's zones and what the sheet adds, over the wards and roads. Each group below can be switched off.
const START = new Set([
  'wards', 'roads', 'railways', 'water_areas', 'waterways',
  'vungu_proposed_peri_urban_zones', 'vungu_beyond_peri_urban_zones', 'vungu_facilities', 'vungu_land_features', 'vungu_railway',
])
const toggles = ref([
  { key: 'zones', label: 'Plan zones', ids: ['vungu_proposed_peri_urban_zones', 'vungu_beyond_peri_urban_zones'], on: true },
  { key: 'facilities', label: 'Facilities and business centres', ids: ['vungu_facilities'], on: true },
  { key: 'features', label: 'Mines, quarries, schemes and the new city', ids: ['vungu_land_features'], on: true },
  { key: 'rail', label: 'Railway lines', ids: ['vungu_railway'], on: true },
  { key: 'wards', label: 'Ward boundaries', ids: ['wards'], on: true },
  { key: 'roads', label: 'Roads', ids: ['roads'], on: true },
])
function applyToggle(t: { ids: string[]; on: boolean }) {
  if (!map.value) return
  for (const id of t.ids) { try { setBasemapLayerVisible(map.value, id, t.on) } catch { /* layer absent at this zoom */ } }
}

const plan = computed(() => data.value?.plan ?? null)
const zones = computed(() => data.value?.zones ?? [])
const standing = computed(() => {
  const p = plan.value
  if (!p) return ''
  if (p.in_force) return p.effective_from ? `In force since ${new Date(p.effective_from).toLocaleDateString('en-GB')}` : 'In force'
  return 'Not in force'
})
const identity = computed(() => (plan.value ? identityLine(plan.value) : ''))
const coveragePct = computed(() => {
  const c = data.value?.coverage
  return c && c.parcels ? Math.round((1000 * c.zoned) / c.parcels) / 10 : null
})
const chosenZone = computed<MasterPlanZone | null>(() => zones.value.find((z) => z.zone === selected.value) ?? null)
const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
const n = (v: number) => v.toLocaleString('en-GB')
const ha = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 1 })

// ── The map ──────────────────────────────────────────────────────────────
const blankStyle = {
  version: 8 as const,
  sources: { 'osm-fallback': { type: 'raster' as const, tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap', maxzoom: 19 } },
  layers: [
    { id: 'background', type: 'background' as const, paint: { 'background-color': '#f5f3ee' } },
    { id: 'osm-fallback', type: 'raster' as const, source: 'osm-fallback', paint: { 'raster-opacity': 0.25 } },
  ],
  glyphs: '/fonts/{fontstack}/{range}.pbf',
}

function selectZone(name: string | null, fit = true) {
  selected.value = name
  picked.value = null
  const z = zones.value.find((x) => x.zone === name)
  if (z && fit && map.value) map.value.fitBounds([[z.bbox[0], z.bbox[1]], [z.bbox[2], z.bbox[3]]], { padding: 40, duration: 600, maxZoom: 14 })
}

function onMapClick(e: any) {
  const m = map.value
  if (!m) return
  const at = (layers: string[]) => m.queryRenderedFeatures(e.point, { layers: layers.filter((l) => m.getLayer(l)) })
  const f = at(FEATURE_LAYERS)[0]
  if (f) {
    const p = f.properties ?? {}
    selected.value = null
    const lines = [ONE[p.kind] ?? p.kind]
    if (p.subtype) lines.push(String(p.subtype))
    if (p.grade) lines.push(`Grant class ${p.grade}`)
    if (p.status) lines.push(String(p.status))
    if (p.worked) lines.push(`Worked for: ${p.worked}`)
    picked.value = { title: p.name || ONE[p.kind] || 'Feature', lines }
    return
  }
  const z = at(ZONE_LAYERS)[0]
  const name = z?.properties?.zone ?? z?.properties?.settlement
  if (name && zones.value.some((x) => x.zone === name)) selectZone(String(name), false)
}

async function startMap() {
  if (!host.value || map.value) return
  const m = new maplibregl.Map({ container: host.value, style: blankStyle as any, center: [29.75, -19.4], zoom: 8.6, minZoom: 5, maxZoom: 20, attributionControl: false })
  map.value = m
  m.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
  m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  m.on('load', async () => {
    try { await addVunguBasemap(m, { defaultVisible: START, autoTilt: false }) } catch { /* the OSM base is still usable */ }
    for (const t of toggles.value) applyToggle(t)
    m.on('click', onMapClick)
    m.on('mousemove', (e: any) => {
      const hit = [...ZONE_LAYERS, ...FEATURE_LAYERS].filter((l) => m.getLayer(l)).length ? m.queryRenderedFeatures(e.point, { layers: [...ZONE_LAYERS, ...FEATURE_LAYERS].filter((l) => m.getLayer(l)) }).length > 0 : false
      m.getCanvas().style.cursor = hit ? 'pointer' : ''
    })
  })
  resizeObserver = new ResizeObserver(() => m.resize())
  resizeObserver.observe(host.value)
}

async function load() {
  loading.value = true
  error.value = null
  try {
    data.value = await executiveApi.masterPlan()
  } catch {
    error.value = 'The master plan could not be read. Try again in a moment.'
  } finally {
    loading.value = false
  }
  // swatches for the zone list, from the same published styles the map is drawn with
  try {
    const styles = await Promise.all(['vungu_proposed_peri_urban_zones', 'vungu_beyond_peri_urban_zones'].map((l) => getPublishedStyle(l)))
    for (const s of styles) for (const k of kindLegend(s as never, 'area')) colours.value[k.label] = k.fill
  } catch { /* the list works without swatches */ }
  await nextTick()
  if (data.value?.plan) void startMap()
}

onMounted(load)
onBeforeUnmount(() => { resizeObserver?.disconnect(); map.value?.remove(); map.value = null })
</script>

<template>
  <div class="mp-root">
    <header class="mp-header">
      <RouterLink to="/executive" class="mp-back"><ArrowLeft :size="16" aria-hidden="true" /> Chief Executive's Overview</RouterLink>
      <div class="mp-brand">
        <span class="mp-council">Vungu Rural District Council</span>
        <h1 class="mp-title">Master plan</h1>
      </div>
      <p v-if="data" class="mp-asof">As at {{ when(data.as_of) }}</p>
    </header>

    <main class="mp-main">
      <p v-if="loading" class="mp-note">Reading the plan…</p>
      <p v-else-if="error" class="mp-alert" role="alert"><TriangleAlert :size="16" aria-hidden="true" /> {{ error }} <button type="button" class="mp-retry" @click="load">Try again</button></p>
      <p v-else-if="!plan" class="mp-note" data-testid="mp-no-plan"><Info :size="16" aria-hidden="true" /> The council has no master plan on record yet.</p>

      <template v-else>
        <section class="mp-card mp-plan" aria-labelledby="mp-plan-h">
          <div class="mp-plan-head">
            <div>
              <h2 id="mp-plan-h" class="mp-h2">{{ plan.title }}</h2>
              <p class="mp-sub" data-testid="mp-identity">{{ identity }}<template v-if="identity && plan.authority"> · </template>{{ plan.authority }}</p>
            </div>
            <span class="mp-badge" :class="plan.in_force ? 'is-ok' : 'is-warn'" data-testid="mp-standing">{{ standing }}</span>
          </div>

          <p v-if="data?.decisions?.tested_on_affirmation" class="mp-testing" role="note" data-testid="mp-testing">
            <TriangleAlert :size="16" aria-hidden="true" />
            <span>Decisions affirmed for testing. {{ n(data.decisions.affirmed_for_testing) }} of the plan's {{ n(data.decisions.decided) }} decisions were proposed best practice and have been taken as agreed for testing only. They are not the council's decisions and are to be revisited.</span>
          </p>

          <div class="mp-adopt">
            <h3 class="mp-h3">Adoption: {{ data?.adoption?.done }} of {{ data?.adoption?.of }} steps</h3>
            <ol class="mp-steps" data-testid="mp-steps">
              <li v-for="s in data?.adoption?.steps" :key="s.code" :class="{ done: s.done, stale: s.stale }">
                <Check v-if="s.done" :size="14" aria-hidden="true" /><Circle v-else :size="14" aria-hidden="true" />
                <span>{{ s.label }}<small v-if="s.done && s.detail"> ({{ s.detail }})</small><small v-else-if="s.stale"> signed, then the plan changed</small></span>
              </li>
            </ol>
          </div>
        </section>

        <div class="mp-split">
          <section class="mp-card mp-mapcard" aria-label="Map of the master plan">
            <div class="mp-toggles">
              <label v-for="t in toggles" :key="t.key" class="mp-toggle">
                <input v-model="t.on" type="checkbox" @change="applyToggle(t)" /> {{ t.label }}
              </label>
            </div>
            <div ref="host" class="mp-map" data-testid="mp-map" role="img" aria-label="Map of the plan's zones, facilities and land features"></div>
            <div v-if="picked" class="mp-picked" data-testid="mp-picked">
              <strong>{{ picked.title }}</strong>
              <span v-for="l in picked.lines" :key="l">{{ l }}</span>
            </div>
          </section>

          <section class="mp-card mp-zones" aria-labelledby="mp-zones-h">
            <h2 id="mp-zones-h" class="mp-h2">Zones <small>{{ zones.length }} zone types, {{ n(data?.total_hectares ?? 0) }} ha</small></h2>
            <div v-if="chosenZone" class="mp-detail" data-testid="mp-zone-detail">
              <h3 class="mp-h3">{{ chosenZone.zone }}</h3>
              <dl class="mp-dl">
                <div><dt>Area</dt><dd>{{ ha(chosenZone.hectares) }} ha ({{ chosenZone.share_pct }}% of the plan)</dd></div>
                <div><dt>Parcels in it</dt><dd>{{ n(chosenZone.parcels) }}</dd></div>
                <div><dt>Permitted uses</dt><dd>{{ chosenZone.permitted }}</dd></div>
                <div><dt>By special consent</dt><dd>{{ chosenZone.special_consent }}</dd></div>
                <div><dt>Not allowed</dt><dd>{{ chosenZone.prohibited }}</dd></div>
                <div v-if="chosenZone.not_decided"><dt>Not decided</dt><dd class="is-warn">{{ chosenZone.not_decided }}</dd></div>
              </dl>
            </div>
            <ul class="mp-zonelist" data-testid="mp-zonelist">
              <li v-for="z in zones" :key="z.zone">
                <button type="button" class="mp-zonebtn" :class="{ on: z.zone === selected }" @click="selectZone(z.zone)">
                  <span class="mp-sw" :style="{ background: colours[z.zone] || '#efeadf' }"></span>
                  <span class="mp-zname">{{ z.zone }}</span>
                  <span class="mp-zfig">{{ ha(z.hectares) }} ha · {{ n(z.parcels) }} parcels</span>
                </button>
              </li>
            </ul>
          </section>
        </div>

        <div class="mp-grid">
          <section class="mp-card" aria-labelledby="mp-cov-h">
            <h2 id="mp-cov-h" class="mp-h2">Register coverage</h2>
            <dl class="mp-dl" data-testid="mp-coverage">
              <div><dt>Parcels on the register</dt><dd>{{ n(data?.coverage?.parcels ?? 0) }}</dd></div>
              <div><dt>Under a zone of the plan</dt><dd>{{ n(data?.coverage?.zoned ?? 0) }}<template v-if="coveragePct !== null"> ({{ coveragePct }}%)</template></dd></div>
              <div><dt>Not under any zone</dt><dd :class="{ 'is-warn': (data?.coverage?.unzoned ?? 0) > 0 }">{{ n(data?.coverage?.unzoned ?? 0) }}</dd></div>
            </dl>
          </section>

          <section class="mp-card" aria-labelledby="mp-app-h">
            <h2 id="mp-app-h" class="mp-h2">The plan in applications</h2>
            <dl class="mp-dl" data-testid="mp-applications">
              <div><dt>Applications lodged under the plan</dt><dd>{{ n(data?.applications?.lodged_under_plan ?? 0) }}</dd></div>
              <div><dt>Decided</dt><dd>{{ n(data?.applications?.decided ?? 0) }}</dd></div>
              <div><dt>In progress</dt><dd>{{ n(data?.applications?.in_progress ?? 0) }}</dd></div>
              <div><dt>Approved against the plan</dt><dd :class="{ 'is-warn': (data?.applications?.departures ?? 0) > 0 }">{{ n(data?.applications?.departures ?? 0) }}</dd></div>
              <div><dt>Approved on a rule not yet agreed</dt><dd>{{ n(data?.applications?.proposed_rule_accepted ?? 0) }}</dd></div>
              <div><dt>Decided without applying the plan</dt><dd>{{ n(data?.applications?.decided_without_the_plan ?? 0) }}</dd></div>
            </dl>
          </section>

          <section class="mp-card" aria-labelledby="mp-held-h">
            <h2 id="mp-held-h" class="mp-h2">Held beside the plan</h2>
            <dl class="mp-dl" data-testid="mp-held">
              <div v-for="f in data?.held?.facilities" :key="f.kind"><dt>{{ FACILITY[f.kind] ?? f.kind }}</dt><dd>{{ n(f.n) }}</dd></div>
              <div v-for="f in data?.held?.land_features" :key="f.kind"><dt>{{ FEATURE[f.kind] ?? f.kind }}</dt><dd>{{ n(f.n) }}</dd></div>
              <div><dt>Railway lines</dt><dd>{{ n(data?.held?.railway_lines ?? 0) }}</dd></div>
              <div><dt>Targeted farms</dt><dd>{{ n(data?.held?.targeted_farms.targeted ?? 0) }} ({{ n(data?.held?.targeted_farms.linked ?? 0) }} linked to the register)</dd></div>
              <div><dt>Retained zones</dt><dd>{{ n(data?.held?.retained_zones ?? 0) }}</dd></div>
            </dl>
          </section>
        </div>
      </template>
    </main>
  </div>
</template>

<style scoped>
.mp-root { min-height: var(--ent-vh, 100vh); background: var(--ent-canvas); color: var(--ent-text); font-family: var(--ent-font); }
.mp-header { display: flex; align-items: center; gap: 1rem; padding: 0.75rem 1.25rem; background: var(--ent-surface); border-bottom: 1px solid var(--ent-line); flex-wrap: wrap; }
.mp-back { display: inline-flex; align-items: center; gap: 0.25rem; color: var(--ent-accent); font-size: 0.875rem; text-decoration: none; }
.mp-back:hover { text-decoration: underline; }
.mp-brand { display: flex; flex-direction: column; flex: 1 1 12rem; }
.mp-council { font-size: var(--ent-fs-micro, 0.6875rem); text-transform: uppercase; letter-spacing: 0.06em; color: var(--ent-text-3); }
.mp-title { margin: 0; font-size: 1.25rem; font-weight: 600; }
.mp-asof { margin: 0; color: var(--ent-text-3); font-size: 0.8125rem; }
.mp-main { max-width: 80rem; margin: 0 auto; padding: 1.25rem; display: flex; flex-direction: column; gap: 1rem; }
.mp-note, .mp-alert { display: flex; align-items: center; gap: 0.5rem; margin: 0; padding: 0.625rem 0.875rem; background: var(--ent-surface-2); border-radius: 6px; color: var(--ent-text-2); }
.mp-alert { background: var(--ent-danger-soft); color: var(--ent-danger); }
.mp-retry { margin-left: auto; padding: 0.25rem 0.625rem; border: 1px solid var(--ent-danger); background: var(--ent-surface); color: var(--ent-danger); border-radius: 4px; cursor: pointer; }
.mp-card { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: 8px; padding: 1rem 1.125rem; }
.mp-h2 { margin: 0 0 0.5rem; font-size: 1rem; font-weight: 600; }
.mp-h2 small { font-weight: 400; color: var(--ent-text-3); font-size: 0.8125rem; margin-left: 0.5rem; }
.mp-h3 { margin: 0 0 0.375rem; font-size: 0.75rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); }
.mp-sub { margin: 0.125rem 0 0; color: var(--ent-text-3); font-size: 0.875rem; }
.mp-plan-head { display: flex; justify-content: space-between; gap: 1rem; align-items: flex-start; flex-wrap: wrap; }
.mp-plan-head .mp-h2 { margin: 0; }
.mp-badge { padding: 0.25rem 0.625rem; border-radius: 999px; font-size: 0.8125rem; font-weight: 600; }
.mp-badge.is-ok { background: var(--ent-success-soft, #e6f4ea); color: var(--ent-success); }
.mp-badge.is-warn { background: var(--ent-warning-soft); color: var(--ent-warning); }
.mp-testing { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0.75rem 0 0; padding: 0.625rem 0.75rem; border: 1px dashed var(--ent-warning); border-radius: 6px; background: var(--ent-warning-soft); color: var(--ent-warning); font-size: 0.875rem; }
.mp-testing svg { flex: none; margin-top: 0.125rem; }
.mp-adopt { margin-top: 0.875rem; }
.mp-steps { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(15rem, 1fr)); gap: 0.25rem 1rem; }
.mp-steps li { display: flex; gap: 0.5rem; align-items: center; color: var(--ent-text-3); font-size: 0.875rem; }
.mp-steps li.done { color: var(--ent-text); }
.mp-steps li.done svg { color: var(--ent-success); }
.mp-steps li.stale { color: var(--ent-warning); }
.mp-steps small { color: var(--ent-text-3); }
.mp-split { display: grid; grid-template-columns: minmax(0, 2fr) minmax(18rem, 1fr); gap: 1rem; align-items: start; }
@media (max-width: 62rem) { .mp-split { grid-template-columns: 1fr; } }
.mp-mapcard { position: relative; padding: 0.75rem; }
.mp-toggles { display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; margin-bottom: 0.5rem; font-size: 0.8125rem; color: var(--ent-text-2); }
.mp-toggle { display: inline-flex; gap: 0.375rem; align-items: center; cursor: pointer; }
.mp-map { height: 34rem; border-radius: 6px; overflow: hidden; background: #f5f3ee; }
.mp-picked { position: absolute; left: 1.25rem; bottom: 1.25rem; display: flex; flex-direction: column; gap: 0.125rem; padding: 0.5rem 0.75rem; background: var(--ent-surface); border: 1px solid var(--ent-line-strong, var(--ent-line)); border-radius: 6px; box-shadow: 0 2px 8px rgb(0 0 0 / 0.15); font-size: 0.8125rem; max-width: 16rem; }
.mp-picked span { color: var(--ent-text-3); }
.mp-zones { max-height: 40.5rem; overflow: auto; }
.mp-detail { margin-bottom: 0.75rem; padding: 0.625rem 0.75rem; background: var(--ent-surface-2); border-radius: 6px; }
.mp-zonelist { list-style: none; margin: 0; padding: 0; }
.mp-zonebtn { display: grid; grid-template-columns: auto 1fr; gap: 0 0.5rem; align-items: center; width: 100%; padding: 0.4375rem 0.375rem; border: 0; border-bottom: 1px solid var(--ent-surface-2); background: none; text-align: left; cursor: pointer; color: inherit; font: inherit; }
.mp-zonebtn:hover, .mp-zonebtn.on { background: var(--ent-surface-2); }
.mp-zonebtn:focus-visible { outline: 2px solid var(--ent-accent); outline-offset: -2px; }
.mp-sw { width: 0.875rem; height: 0.875rem; border-radius: 3px; border: 1px solid var(--ent-line); grid-row: span 2; }
.mp-zname { font-size: 0.875rem; font-weight: 500; }
.mp-zfig { grid-column: 2; font-size: 0.75rem; color: var(--ent-text-3); font-variant-numeric: tabular-nums; }
.mp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(19rem, 1fr)); gap: 1rem; align-items: start; }
.mp-dl { margin: 0; display: grid; gap: 0.25rem; }
.mp-dl > div { display: flex; justify-content: space-between; gap: 1rem; padding: 0.3125rem 0; border-bottom: 1px solid var(--ent-surface-2); }
.mp-dl > div:last-child { border-bottom: 0; }
.mp-dl dt { color: var(--ent-text-2); font-size: 0.875rem; }
.mp-dl dd { margin: 0; font-weight: 600; text-align: right; font-variant-numeric: tabular-nums; }
.mp-dl dd.is-warn { color: var(--ent-warning); }
</style>
