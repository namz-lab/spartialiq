<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { housingApi } from './api'

const props = defineProps<{ township?: string; selected?: string | null }>()
const emit = defineEmits<{ (e: 'select', parcelId: string, standNo: string, status: string): void }>()
const host = ref<HTMLDivElement | null>(null)
const err = ref<string | null>(null)
let map: import('maplibre-gl').Map | null = null
let maplibregl: typeof import('maplibre-gl') | null = null

const COLORS: Record<string, string> = {
  vacant: '#c4b5a0', reserved: '#d4a017', offered: '#c45c26',
  sold: '#2f6f4e', occupied: '#1d4e89', leased: '#6b4c9a',
}

async function paint() {
  if (!map || !map.getSource('stands')) return
  const fc = await housingApi.geojson(props.township)
  ;(map.getSource('stands') as import('maplibre-gl').GeoJSONSource).setData(fc)
  const feats = fc?.features || []
  if (feats.length) {
    const b = new maplibregl!.LngLatBounds()
    for (const f of feats) {
      const g = f.geometry
      if (g?.type === 'Polygon') for (const c of g.coordinates[0]) b.extend(c as [number, number])
      if (g?.type === 'MultiPolygon') for (const poly of g.coordinates) for (const c of poly[0]) b.extend(c as [number, number])
    }
    if (!b.isEmpty()) map.fitBounds(b, { padding: 36, maxZoom: 16, duration: 600 })
  }
}

onMounted(async () => {
  if (!host.value) return
  try {
    maplibregl = await import('maplibre-gl')
    map = new maplibregl.Map({
      container: host.value,
      style: {
        version: 8, sources: {},
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f4efe6' } }],
        glyphs: '/fonts/{fontstack}/{range}.pbf',
      } as any,
      center: [29.80, -19.37], zoom: 13, attributionControl: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    await new Promise<void>((resolve) => { if (map!.loaded()) resolve(); else map!.once('load', () => resolve()) })
    map.addSource('stands', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: 'parcel_id' })
    map.addLayer({
      id: 'stands-fill', type: 'fill', source: 'stands',
      paint: {
        'fill-color': [
          'match', ['get', 'status'],
          'vacant', COLORS.vacant, 'reserved', COLORS.reserved, 'offered', COLORS.offered,
          'sold', COLORS.sold, 'occupied', COLORS.occupied, 'leased', COLORS.leased, COLORS.vacant,
        ],
        'fill-opacity': 0.82,
      },
    })
    map.addLayer({ id: 'stands-line', type: 'line', source: 'stands', paint: { 'line-color': '#3f2f23', 'line-width': 0.6 } })
    map.addLayer({
      id: 'stands-sel', type: 'line', source: 'stands',
      paint: { 'line-color': '#8c2f0d', 'line-width': 3 },
      filter: ['==', ['get', 'parcel_id'], props.selected || ''],
    })
    map.on('click', 'stands-fill', (e: any) => {
      const f = e.features?.[0]
      if (f) emit('select', f.properties.parcel_id, f.properties.stand_no, f.properties.status)
    })
    map.on('mouseenter', 'stands-fill', () => { if (map) map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', 'stands-fill', () => { if (map) map.getCanvas().style.cursor = '' })
    await paint()
  } catch {
    err.value = 'The housing map could not be drawn.'
  }
})

watch(() => props.township, paint)
watch(() => props.selected, (id) => {
  if (map?.getLayer('stands-sel')) map.setFilter('stands-sel', ['==', ['get', 'parcel_id'], id || ''])
})
onBeforeUnmount(() => { try { map?.remove() } catch { /* torn down */ } map = null })
</script>

<template>
  <div class="hsg-map">
    <div ref="host" class="hsg-map-canvas map-container" role="img" aria-label="Housing stands on the cadastre" />
    <p v-if="err" class="hsg-map-err">{{ err }}</p>
    <ul class="hsg-legend" aria-label="Stand status">
      <li v-for="(c, k) in { vacant: '#c4b5a0', reserved: '#d4a017', offered: '#c45c26', sold: '#2f6f4e', occupied: '#1d4e89', leased: '#6b4c9a' }" :key="k">
        <i :style="{ background: c }" /><span>{{ k }}</span>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.hsg-map { position: relative; isolation: isolate; height: 100%; min-height: 28rem; }
.hsg-map-canvas { position: relative; inset: auto; width: 100%; height: 100%; border-radius: 1rem; overflow: hidden; border: 1px solid #e4d9cc; }
.hsg-map-err { position: absolute; left: 1rem; top: 1rem; color: #8c2f0d; }
.hsg-legend { position: absolute; right: 0.75rem; bottom: 0.75rem; margin: 0; padding: 0.5rem 0.7rem; list-style: none;
  display: grid; gap: 0.2rem; background: rgba(255,252,247,.92); border-radius: 0.6rem; font-size: 0.72rem; }
.hsg-legend i { display: inline-block; width: 0.7rem; height: 0.7rem; border-radius: 2px; margin-right: 0.4rem; }
.hsg-legend li { display: flex; align-items: center; text-transform: capitalize; color: #4a3f35; }
</style>
