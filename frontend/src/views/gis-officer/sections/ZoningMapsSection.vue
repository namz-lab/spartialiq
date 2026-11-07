<script setup lang="ts">
// Zoning Maps — operator view of zoning polygons. Same canonical layer
// that surfaces on the citizen-side map; from here the GIS Officer can
// review the zoning overlay, toggle basemap, and brief downstream users.

import { ref, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addVunguBasemap } from '@/map/vunguBasemap'
import { gisOfficerService } from '@/services/gisOfficerService'
import MapLayerFilters from '@/components/MapLayerFilters.vue'
import { Map as MapIcon } from 'lucide-vue-next'

interface ZonePoly { id: string; zone: 'residential'|'commercial'|'industrial'|'institutional'|'open_space';
  color: string; ring: [number, number][] }
const ZONES: ZonePoly[] = [
  { id:'z-res-n',  zone:'residential',   color:'#22c55e', ring:[
    [29.815,-19.467],[29.832,-19.467],[29.832,-19.478],[29.815,-19.478],[29.815,-19.467]] },
  { id:'z-com-c',  zone:'commercial',    color:'#3b82f6', ring:[
    [29.808,-19.486],[29.820,-19.486],[29.820,-19.494],[29.808,-19.494],[29.808,-19.486]] },
  { id:'z-ind-se', zone:'industrial',    color:'#64748b', ring:[
    [29.826,-19.500],[29.842,-19.500],[29.842,-19.512],[29.826,-19.512],[29.826,-19.500]] },
  { id:'z-inst-s', zone:'institutional', color:'#a855f7', ring:[
    [29.792,-19.504],[29.806,-19.504],[29.806,-19.516],[29.792,-19.516],[29.792,-19.504]] },
  { id:'z-pos-e',  zone:'open_space',    color:'#10b981', ring:[
    [29.832,-19.495],[29.840,-19.495],[29.840,-19.502],[29.832,-19.502],[29.832,-19.495]] },
]

const container = ref<HTMLDivElement | null>(null)
const map = shallowRef<maplibregl.Map | null>(null)

function initMap() {
  if (!container.value || map.value) return
  const m = new maplibregl.Map({
    container: container.value,
    style: { version: 8, sources: {}, layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#f2efe9' } }], glyphs: '/fonts/{fontstack}/{range}.pbf' } as any,
    center: gisOfficerService.vunguCenter(),
    zoom: 12,
    attributionControl: false,
  })
  m.addControl(new maplibregl.NavigationControl(), 'top-right')
  m.addControl(new maplibregl.AttributionControl({ compact: true }))
  m.on('load', () => {
    addVunguBasemap(m)
    m.addSource('zones', {
      type:'geojson',
      data:{ type:'FeatureCollection', features: ZONES.map(z => ({
        type:'Feature',
        geometry:{ type:'Polygon', coordinates:[z.ring] },
        properties:{ id: z.id, zone: z.zone, color: z.color },
      })) },
    })
    m.addLayer({ id:'zone-fill', type:'fill', source:'zones',
      paint:{ 'fill-color': ['get','color'], 'fill-opacity': 0.5 } })
    m.addLayer({ id:'zone-line', type:'line', source:'zones',
      paint:{ 'line-color': ['get','color'], 'line-width': 2 } })
    m.addLayer({ id:'zone-label', type:'symbol', source:'zones',
      layout:{ 'text-field':['get','zone'], 'text-size':12,
        'text-font':['Open Sans Regular','Arial Unicode MS Regular'] },
      paint:{ 'text-color':'#0f172a', 'text-halo-color':'#fff', 'text-halo-width':1.5 } })
  })
  map.value = m
}

onMounted(initMap)
onBeforeUnmount(() => { map.value?.remove(); map.value = null })
</script>

<template>
  <div class="zm">
    <header class="zm-head">
      <MapIcon :size="14" />
      <h2>Zoning maps</h2>
      <span class="zm-sub">Indicative overlay — bind to the Local Plan polygons once shipped</span>
    </header>

    <div class="zm-body">
      <aside class="zm-legend">
        <h4>Zone classes</h4>
        <ul>
          <li v-for="z in ZONES" :key="z.id">
            <span class="zm-sq" :style="{ background: z.color }"></span>
            <span>{{ z.zone.replace(/_/g, ' ') }}</span>
          </li>
        </ul>
        <p class="zm-note">
          Edit polygons in the Spatial Database section to publish a revised zoning overlay.
          Citizen and EO-Planner portals consume the same source layer.
        </p>
      </aside>
      <div class="zm-map-wrap">
        <div ref="container" class="zm-map"></div>
        <MapLayerFilters :map="map" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.zm { display:flex; flex-direction:column; height:100%; }
.zm-head { display:flex; align-items:center; gap:0.4rem; padding:0.75rem 1.25rem; }
.zm-head h2 { margin:0; font-size:0.95rem; font-weight:700; }
.zm-sub { color:#94a3b8; font-size:0.7rem; margin-left:auto; }

.zm-body { flex:1; min-height:0; display:grid; grid-template-columns:16rem 1fr;
  gap:0.65rem; padding:0 1.25rem 1rem 1.25rem; }

.zm-legend { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem;
  padding:0.7rem 0.85rem; }
.zm-legend h4 { margin:0 0 0.45rem; font-size:0.7rem; color:#0e7490; text-transform:uppercase;
  letter-spacing:0.05em; font-weight:700; }
.zm-legend ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.3rem; }
.zm-legend li { display:flex; align-items:center; gap:0.45rem; font-size:0.7rem; color:#475569; text-transform:capitalize; }
.zm-sq { width:0.85rem; height:0.6rem; display:inline-block; border-radius:2px; border:1px solid rgba(0,0,0,0.15); }

.zm-note { font-size:0.62rem; color:#64748b; padding:0.5rem 0.65rem; background:#f8fafc;
  border:1px solid #e2e8f0; border-radius:0.25rem; margin:0.55rem 0 0; line-height:1.5; }

.zm-map-wrap { position:relative; min-height:16rem; }
.zm-map { width:100%; height:100%; background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:hidden; }

@media (max-width: 1023px) {
  .zm-body { grid-template-columns:1fr; }
  .zm-legend { max-height:12rem; }
}
</style>
