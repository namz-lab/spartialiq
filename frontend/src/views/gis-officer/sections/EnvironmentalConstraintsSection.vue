<script setup lang="ts">
// Environmental constraints — wetland boundaries, watercourse buffers,
// and council-resolved sensitive areas (scenic-beauty per RTCP s.22).
// Used by EO Planner during due diligence to check whether a permit
// application touches a constraint.

import { ref, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import maplibregl from 'maplibre-gl'
import { escapeHtml } from '@/utils/escapeHtml'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addVunguBasemap } from '@/map/vunguBasemap'
import { gisOfficerService } from '@/services/gisOfficerService'
import MapLayerFilters from '@/components/MapLayerFilters.vue'
import { Trees } from 'lucide-vue-next'

interface ConstraintPoly { id: string; kind: 'wetland'|'watercourse_buffer'|'sensitive_area';
  label: string; color: string; ring: [number, number][] }
const CONSTRAINTS: ConstraintPoly[] = [
  { id:'w-1', kind:'wetland', label:'Vungu wetland (EMA)', color:'#10b981', ring:[
    [29.838,-19.482],[29.852,-19.482],[29.852,-19.498],[29.838,-19.498],[29.838,-19.482]] },
  { id:'wc-1', kind:'watercourse_buffer', label:'River buffer (30 m)', color:'#3b82f6', ring:[
    [29.776,-19.470],[29.852,-19.473],[29.852,-19.479],[29.776,-19.476],[29.776,-19.470]] },
  { id:'sa-1', kind:'sensitive_area', label:'Scenic beauty area · RTCP s.22', color:'#a855f7', ring:[
    [29.784,-19.480],[29.798,-19.480],[29.798,-19.490],[29.784,-19.490],[29.784,-19.480]] },
  { id:'wc-2', kind:'watercourse_buffer', label:'Tributary buffer', color:'#0ea5e9', ring:[
    [29.810,-19.514],[29.838,-19.516],[29.838,-19.520],[29.810,-19.518],[29.810,-19.514]] },
]

const container = ref<HTMLDivElement | null>(null)
const map = shallowRef<maplibregl.Map | null>(null)
const showLabel: Record<ConstraintPoly['kind'], string> = {
  wetland: 'Wetlands',
  watercourse_buffer: 'Watercourse buffers',
  sensitive_area: 'Sensitive areas',
}

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
    m.addSource('env', {
      type:'geojson',
      data:{ type:'FeatureCollection', features: CONSTRAINTS.map(c => ({
        type:'Feature',
        geometry:{ type:'Polygon', coordinates:[c.ring] },
        properties:{ id:c.id, kind:c.kind, label:c.label, color:c.color },
      })) },
    })
    m.addLayer({ id:'env-fill', type:'fill', source:'env',
      paint:{ 'fill-color':['get','color'], 'fill-opacity':0.4 } })
    m.addLayer({ id:'env-line', type:'line', source:'env',
      paint:{ 'line-color':['get','color'], 'line-width':2, 'line-dasharray':[2,2] } })
    m.on('click', 'env-fill', (e) => {
      const f = e.features?.[0]; if (!f?.properties) return
      new maplibregl.Popup({ maxWidth:'240px' })
        .setLngLat(e.lngLat)
        .setHTML(`<div style="font-family:inherit;font-size:12px">
          <div style="font-weight:700">${escapeHtml(f.properties.label)}</div>
          <div style="color:#64748b;font-size:11px">${escapeHtml(String(f.properties.kind).replace(/_/g, ' '))}</div>
          <div style="margin-top:4px;color:#475569">Development within this constraint requires environmental clearance.</div>
        </div>`).addTo(m)
    })
  })
  map.value = m
}

onMounted(initMap)
onBeforeUnmount(() => { map.value?.remove(); map.value = null })
</script>

<template>
  <div class="ec">
    <header class="ec-head">
      <Trees :size="14" />
      <h2>Environmental constraints</h2>
      <span class="ec-sub">Wetlands · watercourse buffers · sensitive areas</span>
    </header>

    <div class="ec-body">
      <aside class="ec-legend">
        <h4>Constraint layers</h4>
        <ul>
          <li v-for="c in CONSTRAINTS" :key="c.id">
            <span class="ec-sq" :style="{ background: c.color }"></span>
            <div>
              <strong>{{ c.label }}</strong>
              <span>{{ showLabel[c.kind] }}</span>
            </div>
          </li>
        </ul>
        <p class="ec-note">
          Any permit application overlapping these polygons must be flagged for environmental
          clearance (EMA referral). Coordinate with the Environmental Officer at consultation.
        </p>
      </aside>
      <div class="ec-map-wrap">
        <div ref="container" class="ec-map"></div>
        <MapLayerFilters :map="map" />
      </div>
    </div>
  </div>
</template>

<style scoped>
.ec { display:flex; flex-direction:column; height:100%; }
.ec-head { display:flex; align-items:center; gap:0.4rem; padding:0.75rem 1.25rem; }
.ec-head h2 { margin:0; font-size:0.95rem; font-weight:700; }
.ec-sub { color:#94a3b8; font-size:0.7rem; margin-left:auto; }

.ec-body { flex:1; min-height:0; display:grid; grid-template-columns:18rem 1fr;
  gap:0.65rem; padding:0 1.25rem 1rem 1.25rem; }

.ec-legend { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; padding:0.7rem 0.85rem;
  overflow-y:auto; }
.ec-legend h4 { margin:0 0 0.45rem; font-size:0.7rem; color:#0e7490; text-transform:uppercase;
  letter-spacing:0.05em; font-weight:700; }
.ec-legend ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.35rem; }
.ec-legend li { display:flex; align-items:flex-start; gap:0.4rem; font-size:0.68rem; color:#475569; }
.ec-sq { width:0.7rem; height:0.7rem; display:inline-block; border-radius:2px;
  border:1px solid rgba(0,0,0,0.15); flex-shrink:0; margin-top:0.15rem; }
.ec-legend strong { display:block; font-size:0.7rem; color:#0f172a; }
.ec-legend span   { display:block; font-size:0.58rem; color:#94a3b8; }

.ec-note { font-size:0.62rem; color:#64748b; padding:0.5rem 0.65rem; background:#f8fafc;
  border:1px solid #e2e8f0; border-radius:0.25rem; margin:0.6rem 0 0; line-height:1.5; }

.ec-map-wrap { position:relative; min-height:16rem; }
.ec-map { width:100%; height:100%; background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:hidden; }

@media (max-width: 1023px) {
  .ec-body { grid-template-columns:1fr; }
  .ec-legend { max-height:14rem; }
}
</style>
