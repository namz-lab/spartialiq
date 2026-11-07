<script setup lang="ts">
// A small non-interactive map of a few geometries over the council basemap:
// a parcel on its profile, the changes in an edit session under review.
// Feature property `role` picks the style: 'current' (published, grey),
// 'proposed' (accent, dashed), 'issue' (danger). Anything else is 'proposed'.
import { ref, shallowRef, watch, onMounted, onUnmounted } from 'vue'
import { prefersReducedMotion } from '@/map/vunguBasemap'
import { SELECTION_COLOUR, ERROR_COLOUR } from '@/map/gmsStyle'

const props = withDefaults(defineProps<{ features: GeoJSON.Feature[]; label: string; height?: string }>(), { height: '340px' })

const host = ref<HTMLElement | null>(null)
const map = shallowRef<any>(null)

function bounds(features: GeoJSON.Feature[]): [[number, number], [number, number]] | null {
  const xs: number[] = []
  const ys: number[] = []
  const walk = (c: unknown): void => {
    if (typeof (c as number[])[0] === 'number') { xs.push((c as number[])[0]); ys.push((c as number[])[1]) } else (c as unknown[]).forEach(walk)
  }
  for (const f of features) if (f.geometry && 'coordinates' in f.geometry) walk(f.geometry.coordinates)
  return xs.length ? [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]] : null
}

function draw() {
  const m = map.value
  if (!m?.getSource('mini')) return
  m.getSource('mini').setData({ type: 'FeatureCollection', features: props.features })
  const b = bounds(props.features)
  if (b) m.fitBounds(b, { padding: 48, maxZoom: 18, duration: prefersReducedMotion() ? 0 : 400 })
}

onMounted(async () => {
  try {
    const [{ default: maplibregl }, { addVunguBasemap }] = await Promise.all([import('maplibre-gl'), import('@/map/vunguBasemap')])
    if (!host.value) return
    const b = bounds(props.features)
    map.value = new maplibregl.Map({
      container: host.value,
      style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f5f3ee' } }], glyphs: '/fonts/{fontstack}/{range}.pbf' } as any,
      ...(b ? { bounds: b, fitBoundsOptions: { padding: 48, maxZoom: 18 } } : { center: [29.8, -19.45], zoom: 10 }),
      attributionControl: false,
    })
    map.value.on('error', () => {})
    map.value.addControl(new maplibregl.ScaleControl({ maxWidth: 100, unit: 'metric' }), 'bottom-left')
    await addVunguBasemap(map.value, { interactive: false, autoTilt: false })
    map.value.addSource('mini', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } })
    const colour = ['match', ['get', 'role'], 'current', '#6b7280', 'issue', ERROR_COLOUR, SELECTION_COLOUR]
    map.value.addLayer({ id: 'mini-fill', type: 'fill', source: 'mini', filter: ['==', '$type', 'Polygon'], paint: { 'fill-color': colour, 'fill-opacity': ['match', ['get', 'role'], 'issue', 0.45, 0.12] } })
    map.value.addLayer({ id: 'mini-line', type: 'line', source: 'mini', filter: ['!=', '$type', 'Point'], paint: { 'line-color': colour, 'line-width': 2,
      'line-dasharray': ['match', ['get', 'role'], 'current', ['literal', [1, 0]], ['literal', [2, 1.5]]] } })
    map.value.addLayer({ id: 'mini-point', type: 'circle', source: 'mini', filter: ['==', '$type', 'Point'], paint: { 'circle-radius': 6, 'circle-color': '#fff', 'circle-stroke-color': colour, 'circle-stroke-width': 2.5 } })
    draw()
  } catch {
    // WebGL unavailable or tiles down: the page still reads without the map.
  }
})
watch(() => props.features, draw, { deep: true })
onUnmounted(() => { try { map.value?.remove() } catch { /* torn down */ } map.value = null })
</script>

<template>
  <div ref="host" class="mini" role="img" :aria-label="label" :style="{ minHeight: height }" />
</template>

<style scoped>
.mini { border:1px solid var(--ent-line); border-radius:var(--ent-r); background:var(--ent-surface-sunken); overflow:hidden; }
</style>
