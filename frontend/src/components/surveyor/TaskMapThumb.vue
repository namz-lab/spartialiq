<script setup lang="ts">
// Non-interactive locator thumbnail for a survey task. Renders a small
// OpenFreeMap positron basemap (the app's existing vector style) centred on
// the task point with a marker. No pan/zoom/animation — purely a "where is
// this" glance; the detail panel links out to the full MapView for real work.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { MapPin } from 'lucide-vue-next'

const props = defineProps<{ lng: number | null; lat: number | null }>()

const el = ref<HTMLDivElement | null>(null)
let map: maplibregl.Map | null = null
let marker: maplibregl.Marker | null = null

const hasCoords = () => props.lng != null && props.lat != null

function render() {
  if (!el.value || !hasCoords()) return
  const center: [number, number] = [props.lng as number, props.lat as number]
  if (!map) {
    map = new maplibregl.Map({
      container: el.value,
      style: 'https://tiles.openfreemap.org/styles/positron',
      center, zoom: 15, interactive: false, attributionControl: false,
    })
    marker = new maplibregl.Marker({ color: '#4f46e5' }).setLngLat(center).addTo(map)
  } else {
    map.jumpTo({ center, zoom: 15 })   // no animation → reduced-motion safe
    marker?.setLngLat(center)
  }
}

onMounted(render)
watch(() => [props.lng, props.lat], render)
onBeforeUnmount(() => { map?.remove(); map = null; marker = null })
</script>

<template>
  <div v-if="hasCoords()" ref="el" class="w-full h-full"></div>
  <div v-else class="w-full h-full flex items-center justify-center text-gray-400">
    <MapPin class="w-8 h-8" />
  </div>
</template>
