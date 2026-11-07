<script setup lang="ts">
// Application Mapping — interactive map of every permit application
// recorded in dmApi, coloured by status. Only permits with stored
// latitude/longitude are plotted.

import { ref, computed, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import maplibregl from 'maplibre-gl'
import { escapeHtml } from '@/utils/escapeHtml'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addVunguBasemap } from '@/map/vunguBasemap'
import { gisOfficerService, type PermitLocation } from '@/services/gisOfficerService'
import { dmApi } from '@/services/developmentManagementService'
import { normalizeStatus, statusLabel } from '@/composables/useApplicationPipeline'
import { parseApiError, useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import MapLayerFilters from '@/components/MapLayerFilters.vue'
import { MapPin, RefreshCw, AlertTriangle } from 'lucide-vue-next'

const fb = useUiFeedback()
const container = ref<HTMLDivElement | null>(null)
const map = shallowRef<maplibregl.Map | null>(null)
const loading = ref(true)
const loadError = ref('')
const locations = ref<PermitLocation[]>([])

const STATUS_COLOR: Record<string, string> = {
  pending_payment:          '#94a3b8',
  registered:               '#94a3b8',
  acknowledged:             '#6366f1',
  circulation:              '#8b5cf6',
  objection_period:         '#f59e0b',
  under_review:             '#3b82f6',
  awaiting_eo_decision:     '#2563eb',
  deferred:                 '#f59e0b',
  approved:                 '#10b981',
  approved_with_conditions: '#0d9488',
  refused:                  '#ef4444',
  withdrawn:                '#64748b',
  appealed:                 '#7c3aed',
}

async function refresh() {
  loading.value = true
  loadError.value = ''
  try {
    const r = await dmApi.listPermits({ limit: 500, offset: 0 })
    const rows = Array.isArray(r?.data) ? r.data : []
    locations.value = rows
      .filter(p => p.lng != null && p.lat != null)
      .map(p => ({ permit: p, lng: p.lng as number, lat: p.lat as number }))
    updateLayer()
    if (!locations.value.length && rows.length) {
      loadError.value = `${rows.length} permit(s) loaded, none have recorded coordinates.`
    }
  } catch (e: any) {
    locations.value = []
    loadError.value = parseApiError(e, 'Could not load permit locations.')
    fb.showToast(loadError.value, 'error')
  } finally {
    loading.value = false
  }
}

function updateLayer() {
  const m = map.value
  if (!m || !m.isStyleLoaded()) return
  const fc = {
    type: 'FeatureCollection' as const,
    features: locations.value.map(l => ({
      type:'Feature' as const,
      geometry:{ type:'Point' as const, coordinates:[l.lng, l.lat] },
      properties:{
        id: l.permit.id, ref: l.permit.dev_register_no || l.permit.id.slice(0, 10),
        stand: l.permit.stand_number, ward: l.permit.suburb_ward,
        applicant: l.permit.applicant_name, status: l.permit.status,
        color: STATUS_COLOR[normalizeStatus(l.permit.status)] || '#64748b',
      },
    })),
  }
  const src = m.getSource('permits') as maplibregl.GeoJSONSource | undefined
  if (src) src.setData(fc as any)
  else {
    m.addSource('permits', { type:'geojson', data: fc as any })
    m.addLayer({
      id:'permits-pts', type:'circle', source:'permits',
      paint:{
        'circle-radius': 7,
        'circle-color': ['get', 'color'],
        'circle-stroke-width': 2,
        'circle-stroke-color': '#fff',
      },
    })
    m.on('mouseenter', 'permits-pts', () => { m.getCanvas().style.cursor = 'pointer' })
    m.on('mouseleave', 'permits-pts', () => { m.getCanvas().style.cursor = '' })
    m.on('click', 'permits-pts', (e) => {
      const f = e.features?.[0]; if (!f?.properties) return
      new maplibregl.Popup({ maxWidth:'260px' })
        .setLngLat((f.geometry as any).coordinates)
        .setHTML(`<div style="font-family:inherit;font-size:12px">
          <div style="font-weight:700;margin-bottom:4px">${escapeHtml(f.properties.ref)}</div>
          <div>${escapeHtml(f.properties.applicant)}</div>
          <div style="color:#64748b;font-size:11px">Stand ${escapeHtml(f.properties.stand)} · ${escapeHtml(f.properties.ward)}</div>
          <div style="margin-top:4px"><strong>Status:</strong> ${escapeHtml(statusLabel(f.properties.status))}</div>
        </div>`).addTo(m as any)
    })
  }
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
  m.on('load', () => { addVunguBasemap(m); map.value = m; refresh() })
}

onMounted(initMap)
onBeforeUnmount(() => { map.value?.remove(); map.value = null })

const statusCounts = computed(() => {
  const counts: Record<string, number> = {}
  for (const l of locations.value) counts[l.permit.status] = (counts[l.permit.status] || 0) + 1
  return counts
})
</script>

<template>
  <div class="am">
    <header class="am-head">
      <MapPin :size="14" />
      <h2>Application mapping</h2>
      <span class="am-sub">{{ locations.length }} permit application(s) plotted</span>
      <button class="am-refresh" @click="refresh" :disabled="loading" aria-label="Refresh permit locations">
        <RefreshCw :size="12" :class="{ spin: loading }" />
      </button>
    </header>

    <div v-if="loadError" class="am-banner" role="alert">
      <AlertTriangle :size="14" />
      <span>{{ loadError }}</span>
      <button type="button" @click="refresh">Retry</button>
    </div>

    <div class="am-body">
      <aside class="am-legend">
        <h4>Status legend</h4>
        <ul>
          <li v-for="(c, k) in STATUS_COLOR" :key="k">
            <span class="am-dot" :style="{ background: c }"></span>
            <span class="am-lbl">{{ String(k).replace(/_/g, ' ') }}</span>
            <span class="am-count">{{ statusCounts[k] || 0 }}</span>
          </li>
        </ul>
        <p v-if="!loading && !locations.length && !loadError" class="am-note">
          No permits with stored coordinates. Applications without a location are omitted rather than invented.
        </p>
        <p v-else class="am-note">
          Points use the permit’s stored latitude and longitude. Basemap layers can be toggled on the map.
        </p>
      </aside>
      <div class="am-map-wrap">
        <div ref="container" class="am-map"></div>
        <MapLayerFilters :map="map" />
      </div>
    </div>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.am { display:flex; flex-direction:column; height:100%; }
.am-head { display:flex; align-items:center; gap:0.4rem; padding:0.75rem 1.25rem; }
.am-head h2 { margin:0; font-size:0.95rem; font-weight:700; }
.am-sub { color:#94a3b8; font-size:0.7rem; }
.am-refresh { margin-left:auto; background:none; border:1px solid #e2e8f0; border-radius:0.3rem;
  padding:0.35rem; cursor:pointer; color:#64748b; }
.spin { animation: amspin 0.8s linear infinite; }
@keyframes amspin { to { transform: rotate(360deg); } }

.am-body { flex:1; min-height:0; display:grid; grid-template-columns:18rem 1fr;
  gap:0.65rem; padding:0 1.25rem 1rem 1.25rem; }

.am-legend { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem;
  padding:0.7rem 0.85rem; display:flex; flex-direction:column; gap:0.4rem; overflow-y:auto; }
.am-legend h4 { margin:0; font-size:0.7rem; color:#0e7490; text-transform:uppercase;
  letter-spacing:0.05em; font-weight:700; }
.am-legend ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.25rem; }
.am-legend li { display:flex; align-items:center; gap:0.45rem; font-size:0.7rem; color:#475569; }
.am-dot { width:0.7rem; height:0.7rem; border-radius:50%; border:1.5px solid #fff;
  box-shadow:0 0 0 1px #cbd5e1; flex-shrink:0; }
.am-lbl { flex:1; text-transform:capitalize; }
.am-count { font-family: ui-monospace, monospace; font-weight:600; color:#0f172a; }
.am-banner { display:flex; align-items:center; gap:0.5rem; margin:0 1.25rem 0.5rem;
  padding:0.5rem 0.75rem; background:#fef3c7; color:#92400e; border:1px solid #fde68a;
  border-radius:0.4rem; font-size:0.75rem; }
.am-banner button { margin-left:auto; background:#fff; border:1px solid #fde68a;
  border-radius:0.3rem; padding:0.25rem 0.55rem; font-size:0.7rem; cursor:pointer; color:#92400e; }
.am-note { font-size:0.6rem; color:#64748b; padding:0.4rem 0.5rem; background:#f8fafc;
  border:1px solid #e2e8f0; border-radius:0.25rem; margin:0; line-height:1.5; }

.am-map-wrap { position:relative; min-height:16rem; }
.am-map { width:100%; height:100%; background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:hidden; }

@media (max-width: 1023px) {
  .am-body { grid-template-columns:1fr; }
  .am-legend { max-height:14rem; }
}
</style>
