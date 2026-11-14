<script setup lang="ts">
// "Ward by ward": the spatial engine's measures drawn as a choropleth for the Chief Executive.
//
// The server decides everything that carries meaning (the value, the class, the rank, the breaks and
// how they were chosen); this component only draws it. Rules it keeps:
//   - A ward with no figure, or on a base too small to trust, is drawn "no data" grey, never in the
//     bottom class.
//   - The ward list is provisional while decision D11 is open, and the screen says so.
//   - No canvas is drawn when there are no wards or no computed values: a blank grey district reads
//     as "nothing here". The reason is written instead.
//   - The ranked list beside the map carries the same figures, so the map is never the only way in.
//   - Wards differ greatly in size, so the page says to compare values, not areas.
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { Info, TriangleAlert } from 'lucide-vue-next'
import 'maplibre-gl/dist/maplibre-gl.css'
import { FINANCE_CHOROPLETH, FINANCE_NO_DATA } from '@/map/vunguBasemapStyle'
import { spatialEngineApi, type MapsIndex, type WardMap, type WardFeature } from '@/services/spatialEngine'

const index = ref<MapsIndex | null>(null)
const indexError = ref<string | null>(null)
const key = ref<string>('')
const wardMap = ref<WardMap | null>(null)
const mapError = ref<string | null>(null)
const loading = ref(true)
const selected = ref<string | null>(null)

const host = ref<HTMLElement | null>(null)
const map = shallowRef<any>(null)
let mapReady = false

// ── Loading ────────────────────────────────────────────────────────────
async function loadIndex() {
  loading.value = true
  indexError.value = null
  try {
    index.value = await spatialEngineApi.index()
    key.value = index.value.measures[0]?.measure_key ?? ''
    if (key.value) await loadMap()
  } catch {
    indexError.value = 'The ward maps could not be read. Try again in a moment.'
  } finally {
    loading.value = false
  }
}

async function loadMap() {
  mapError.value = null
  selected.value = null
  try {
    wardMap.value = await spatialEngineApi.map(key.value)
  } catch {
    wardMap.value = null
    mapError.value = 'This map could not be read. Try again in a moment.'
  }
}
onMounted(loadIndex)
watch(key, (k, old) => { if (k && old) void loadMap() })

// ── What is shown ──────────────────────────────────────────────────────
const features = computed<WardFeature[]>(() => wardMap.value?.features ?? [])
const canDraw = computed(() => !!wardMap.value && !wardMap.value.reason && features.value.length > 0)
const provisional = computed(() => {
  const b = (wardMap.value?.ward_register ?? index.value?.ward_register)?.basis
  return !!b && b !== 'proclamation' && b !== 'delimitation'
})

const fmt = (v: number) => new Intl.NumberFormat('en-GB', { maximumSignificantDigits: 3 }).format(v)
const valueText = (v: number | null) => {
  if (v === null) return '—'
  return wardMap.value?.measure.kind === 'share' ? `${new Intl.NumberFormat('en-GB', { maximumFractionDigits: 1 }).format(v)}%` : fmt(v)
}

/** Evenly spaced colours from the council's ramp, so the top class is always the darkest. */
const colours = computed(() => {
  const n = wardMap.value?.classes?.classes ?? 0
  const ramp = FINANCE_CHOROPLETH.slice(1) // the first step is nearly white on the canvas
  if (n < 2) return n === 1 ? [ramp[ramp.length - 1]] : []
  return Array.from({ length: n }, (_, i) => ramp[Math.round((i * (ramp.length - 1)) / (n - 1))])
})

const legend = computed(() => {
  const c = wardMap.value?.classes
  if (!c || c.breaks.length === 0) return []
  const unit = wardMap.value?.measure.kind === 'share' ? '%' : ''
  return colours.value.map((colour, i) => {
    const lo = c.breaks[i - 1]
    const hi = c.breaks[i]
    const label = i === 0 ? `under ${fmt(hi)}${unit}`
      : i === c.breaks.length ? `${fmt(lo)}${unit} or more`
        : `${fmt(lo)}${unit} to under ${fmt(hi)}${unit}`
    return { colour, label }
  })
})

const methodText = computed(() => {
  const c = wardMap.value?.classes
  if (!c) return ''
  if (c.breaks.length === 0) return 'Too few different values to divide into classes, so every ward with a figure is shaded alike.'
  return c.method === 'fixed'
    ? `Classes use fixed thresholds (${c.breaks.map(fmt).join(', ')}), so maps stay comparable over time. The thresholds are provisional defaults.`
    : `Classes hold roughly equal numbers of wards (quantiles: ${c.breaks.map(fmt).join(', ')}).`
})

const rows = computed(() => [...features.value].sort((a, b) => {
  const ra = a.properties.rank
  const rb = b.properties.rank
  if (ra !== null && rb !== null) return ra - rb || a.properties.name.localeCompare(b.properties.name, 'en', { numeric: true })
  if (ra !== null) return -1
  if (rb !== null) return 1
  return a.properties.name.localeCompare(b.properties.name, 'en', { numeric: true })
}))

const reasonText = computed(() => {
  const r = wardMap.value?.reason
  if (r === 'ward_register_empty') return "The council's wards have not been loaded into the system yet, so the ward maps cannot be drawn."
  if (r === 'not_computed') return 'The ward measures have not been computed yet. The GIS Branch can run them.'
  return null
})

const asOf = computed(() => {
  const t = wardMap.value?.run?.computed_at ?? index.value?.run?.computed_at
  return t ? new Date(t).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''
})
const unlocatedText = computed(() => {
  const r = wardMap.value?.run
  if (!r || r.unlocated === null || r.facts === null || r.unlocated === 0) return ''
  return `${r.unlocated.toLocaleString('en-GB')} of ${r.facts.toLocaleString('en-GB')} records could not be placed in a ward and are left out.`
})
const mapLabel = computed(() => {
  const m = wardMap.value
  if (!m) return ''
  const ranked = features.value.filter((f) => f.properties.rank !== null)
  const top = ranked[0]
  return `Map of ${features.value.length} wards shaded by ${m.measure.label.toLowerCase()}. ${top ? `Ward ${top.properties.name} ranks first.` : 'No ward has a reliable figure.'}`
})

// ── The map ────────────────────────────────────────────────────────────
const SOURCE = 'wards'
function fillColour(): unknown[] {
  // Colour by the server's class, so the map, the legend and the list agree by construction.
  const expr: unknown[] = ['match', ['get', 'class_index']]
  colours.value.forEach((c, i) => expr.push(i, c))
  expr.push(FINANCE_NO_DATA)
  return ['case', ['==', ['get', 'class_index'], null], FINANCE_NO_DATA, expr]
}

function boundsOf(fs: WardFeature[]): [[number, number], [number, number]] | null {
  let w = 180; let s = 90; let e = -180; let n = -90
  const walk = (c: any): void => {
    if (typeof c[0] === 'number') { w = Math.min(w, c[0]); e = Math.max(e, c[0]); s = Math.min(s, c[1]); n = Math.max(n, c[1]); return }
    for (const x of c) walk(x)
  }
  for (const f of fs) walk((f.geometry as any).coordinates)
  return w > e ? null : [[w, s], [e, n]]
}

const reducedMotion = () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

async function draw() {
  if (!canDraw.value || !host.value) return
  if (map.value && map.value.getContainer() !== host.value) {
    try { map.value.remove() } catch { /* torn down */ }
    map.value = null
    mapReady = false
  }
  if (!map.value) {
    const { default: maplibregl } = await import('maplibre-gl')
    if (!host.value) return
    const m = new maplibregl.Map({
      container: host.value,
      style: {
        version: 8, sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f5f3ee' } }],
        glyphs: '/fonts/{fontstack}/{range}.pbf',
      } as any,
      center: [29.6, -19.5], zoom: 8, attributionControl: false,
    })
    map.value = m
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    // The style here is empty, so the map can be loaded before this line runs: set up now if so.
    await new Promise<void>((resolve) => { if (m.loaded()) resolve(); else m.once('load', () => resolve()) })
    m.addSource(SOURCE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'ward_code' })
    m.addLayer({ id: 'wards-fill', type: 'fill', source: SOURCE, paint: { 'fill-color': FINANCE_NO_DATA, 'fill-opacity': 0.92 } })
    m.addLayer({ id: 'wards-line', type: 'line', source: SOURCE, paint: { 'line-color': '#52606d', 'line-width': 0.8 } })
    m.addLayer({
      id: 'wards-selected', type: 'line', source: SOURCE,
      paint: { 'line-color': '#1f2937', 'line-width': 3 }, filter: ['==', ['get', 'ward_code'], ''],
    })
    m.addLayer({
      id: 'wards-label', type: 'symbol', source: SOURCE,
      layout: { 'text-field': ['get', 'name'], 'text-size': 12, 'text-font': ['Noto Sans Regular'] },
      paint: { 'text-color': '#1f2937', 'text-halo-color': '#ffffff', 'text-halo-width': 1.2 },
    })
    m.on('click', 'wards-fill', (e: any) => { const f = e.features?.[0]; if (f) selected.value = f.properties.ward_code })
    m.on('mouseenter', 'wards-fill', () => { m.getCanvas().style.cursor = 'pointer' })
    m.on('mouseleave', 'wards-fill', () => { m.getCanvas().style.cursor = '' })
    mapReady = true
  }
  paint(true)
}

function paint(fit: boolean) {
  const m = map.value
  if (!m || !mapReady) return
  ;(m.getSource(SOURCE) as any)?.setData({ type: 'FeatureCollection', features: features.value })
  m.setPaintProperty('wards-fill', 'fill-color', fillColour())
  if (fit) {
    const b = boundsOf(features.value)
    if (b) m.fitBounds(b, { padding: 24, duration: reducedMotion() ? 0 : 400 })
  }
}

// Draw when there is something to draw AND a container to draw it in. Watching the container itself (not just
// the data) is what makes this independent of render order: the block that holds it appears a tick after the
// data arrives. 'post' runs after the DOM has been updated.
watch([wardMap, canDraw, host], async () => {
  if (canDraw.value && host.value) await draw()
}, { flush: 'post' })
watch(selected, (code) => {
  if (map.value && mapReady) map.value.setFilter('wards-selected', ['==', ['get', 'ward_code'], code ?? ''])
})
onBeforeUnmount(() => { try { map.value?.remove() } catch { /* torn down */ } map.value = null; mapReady = false })

const selectedFeature = computed(() => features.value.find((f) => f.properties.ward_code === selected.value) ?? null)
const reliabilityText = (r: string) => (r === 'small_base' ? 'small base, not classified' : r === 'no_data' ? 'no data' : '')
</script>

<template>
  <section class="wm" aria-labelledby="wm-title">
    <header class="wm-head">
      <h2 id="wm-title" class="wm-title">Ward by ward</h2>
      <p v-if="asOf" class="wm-asof">Computed {{ asOf }}</p>
    </header>

    <p v-if="provisional" class="wm-note wm-note--provisional" role="note">
      <Info :size="16" aria-hidden="true" />
      <span>The ward boundaries are provisional. The Council has not yet confirmed its official ward list (decision D11), so these wards are interim reference data, not a Council act.</span>
    </p>

    <p v-if="indexError" class="wm-alert" role="alert">
      <TriangleAlert :size="16" aria-hidden="true" />{{ indexError }}
      <button type="button" class="wm-retry" @click="loadIndex">Try again</button>
    </p>
    <p v-else-if="loading" class="wm-quiet">Reading the ward measures…</p>
    <p v-else-if="index && index.measures.length === 0" class="wm-quiet">No ward measures are defined yet.</p>

    <template v-else-if="index">
      <div class="wm-measures" role="radiogroup" aria-label="Measure to map">
        <label v-for="m in index.measures" :key="m.measure_key" class="wm-measure" :class="{ 'is-on': key === m.measure_key }">
          <input v-model="key" type="radio" name="wm-measure" :value="m.measure_key" class="wm-radio" />
          {{ m.label }}
        </label>
      </div>

      <p v-if="mapError" class="wm-alert" role="alert"><TriangleAlert :size="16" aria-hidden="true" />{{ mapError }}</p>
      <template v-else-if="wardMap">
        <p class="wm-desc">{{ wardMap.measure.description }} <span class="wm-unit">Unit: {{ wardMap.measure.unit }}.</span></p>

        <p v-if="reasonText" class="wm-quiet wm-reason"><Info :size="16" aria-hidden="true" />{{ reasonText }}</p>

        <div v-else class="wm-body">
          <div class="wm-map-col">
            <div ref="host" class="wm-canvas" role="img" :aria-label="mapLabel" />
            <ul class="wm-legend" aria-label="Legend">
              <li v-for="l in legend" :key="l.label"><span class="wm-swatch" :style="{ background: l.colour }" />{{ l.label }}</li>
              <li><span class="wm-swatch wm-swatch--none" />No data or small base</li>
            </ul>
            <p v-if="selectedFeature" class="wm-selected" aria-live="polite">
              <strong>Ward {{ selectedFeature.properties.name }}</strong>:
              {{ valueText(selectedFeature.properties.raw_value) }}
              <template v-if="reliabilityText(selectedFeature.properties.reliability)">({{ reliabilityText(selectedFeature.properties.reliability) }})</template>
            </p>
          </div>

          <div class="wm-list-col">
            <table class="wm-table">
              <caption class="wm-caption">Wards, best first where the measure has a good direction</caption>
              <thead><tr><th scope="col">Rank</th><th scope="col">Ward</th><th scope="col" class="num">Value</th></tr></thead>
              <tbody>
                <tr v-for="r in rows" :key="r.properties.ward_code"
                    :class="{ 'is-selected': selected === r.properties.ward_code }"
                    @click="selected = r.properties.ward_code">
                  <td>{{ r.properties.rank ?? '—' }}</td>
                  <th scope="row">{{ r.properties.name }}</th>
                  <td class="num">
                    {{ valueText(r.properties.raw_value) }}
                    <span v-if="reliabilityText(r.properties.reliability)" class="wm-tag">{{ reliabilityText(r.properties.reliability) }}</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        <footer v-if="!reasonText" class="wm-foot">
          <p>{{ methodText }}</p>
          <p>Source: {{ wardMap.measure.source_note }} Kept by {{ wardMap.measure.owner_dept }}.</p>
          <p v-if="unlocatedText">{{ unlocatedText }}</p>
          <p>Wards differ greatly in size: compare the values, not the areas.</p>
        </footer>
      </template>
    </template>
  </section>
</template>

<style scoped>
.wm { margin-top: 1.5rem; background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: 8px; padding: 1rem 1.125rem; }
.wm-head { display: flex; align-items: baseline; gap: 1rem; flex-wrap: wrap; margin-bottom: 0.5rem; }
.wm-title { margin: 0; font-size: 1rem; font-weight: 600; flex: 1; }
.wm-asof { margin: 0; color: var(--ent-text-3); font-size: 0.8125rem; }

.wm-note { display: flex; gap: 0.5rem; align-items: flex-start; margin: 0 0 0.75rem; padding: 0.5rem 0.75rem; border-radius: 6px; font-size: 0.875rem; }
.wm-note--provisional { background: var(--ent-warning-soft); color: var(--ent-warning); }
.wm-note svg, .wm-reason svg { flex: none; margin-top: 0.125rem; }
.wm-alert { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.75rem; padding: 0.5rem 0.75rem; background: var(--ent-danger-soft); color: var(--ent-danger); border-radius: 6px; }
.wm-retry { margin-left: auto; padding: 0.25rem 0.625rem; border: 1px solid var(--ent-danger); background: var(--ent-surface); color: var(--ent-danger); border-radius: 4px; cursor: pointer; }
.wm-quiet { margin: 0.5rem 0; color: var(--ent-text-2); }
.wm-reason { display: flex; gap: 0.5rem; padding: 0.75rem; background: var(--ent-surface-2); border-radius: 6px; }

.wm-measures { display: flex; flex-wrap: wrap; gap: 0.5rem; margin-bottom: 0.75rem; }
.wm-measure { padding: 0.375rem 0.75rem; border: 1px solid var(--ent-line-strong); border-radius: 999px; cursor: pointer; font-size: 0.875rem; background: var(--ent-surface); }
.wm-measure.is-on { background: var(--ent-accent-soft); border-color: var(--ent-accent); color: var(--ent-accent); font-weight: 600; }
.wm-measure:focus-within { outline: 2px solid var(--ent-accent-ring); outline-offset: 2px; }
.wm-radio { position: absolute; opacity: 0; pointer-events: none; }

.wm-desc { margin: 0 0 0.75rem; color: var(--ent-text-2); max-width: 52rem; }
.wm-unit { color: var(--ent-text-3); }

.wm-body { display: grid; grid-template-columns: minmax(0, 3fr) minmax(16rem, 2fr); gap: 1rem; align-items: start; }
@media (max-width: 52rem) { .wm-body { grid-template-columns: 1fr; } }
.wm-canvas { width: 100%; height: 26rem; border: 1px solid var(--ent-line); border-radius: 6px; overflow: hidden; background: #f5f3ee; }
.wm-legend { list-style: none; display: flex; flex-wrap: wrap; gap: 0.25rem 1rem; margin: 0.5rem 0 0; padding: 0; font-size: 0.8125rem; color: var(--ent-text-2); }
.wm-legend li { display: flex; align-items: center; gap: 0.375rem; }
.wm-swatch { width: 14px; height: 14px; border-radius: 3px; border: 1px solid rgba(0, 0, 0, 0.25); display: inline-block; }
.wm-swatch--none { background: #e8e8e8; }
.wm-selected { margin: 0.5rem 0 0; font-size: 0.875rem; }

.wm-list-col { max-height: 30rem; overflow: auto; border: 1px solid var(--ent-line); border-radius: 6px; }
.wm-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
.wm-caption { text-align: left; padding: 0.5rem 0.75rem; color: var(--ent-text-3); font-size: 0.75rem; }
.wm-table th, .wm-table td { padding: 0.375rem 0.75rem; border-top: 1px solid var(--ent-surface-2); text-align: left; font-weight: 400; }
.wm-table thead th { position: sticky; top: 0; background: var(--ent-surface-2); font-weight: 600; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); }
.wm-table tbody tr { cursor: pointer; }
.wm-table tbody tr:hover, .wm-table tbody tr.is-selected { background: var(--ent-accent-soft); }
.wm-table .num { text-align: right; font-variant-numeric: tabular-nums; }
.wm-tag { display: block; font-size: 0.6875rem; color: var(--ent-text-3); }

.wm-foot { margin-top: 0.75rem; font-size: 0.8125rem; color: var(--ent-text-3); }
.wm-foot p { margin: 0.125rem 0; }
</style>
