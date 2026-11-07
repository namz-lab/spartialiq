<script setup lang="ts">
// Enforcement mapping — Section 32 stop-work, demolition, rectification,
// removal and cessation orders plotted on a Council map. Coloured by
// order_type.

import { ref, computed, onMounted, onBeforeUnmount, shallowRef } from 'vue'
import maplibregl from 'maplibre-gl'
import { escapeHtml } from '@/utils/escapeHtml'
import 'maplibre-gl/dist/maplibre-gl.css'
import { addVunguBasemap } from '@/map/vunguBasemap'
import { gisOfficerService } from '@/services/gisOfficerService'
import { dmApi, type EnforcementOrder } from '@/services/developmentManagementService'
import { parseApiError, useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import MapLayerFilters from '@/components/MapLayerFilters.vue'
import { ShieldAlert, RefreshCw, AlertTriangle } from 'lucide-vue-next'

const fb = useUiFeedback()
const container = ref<HTMLDivElement | null>(null)
const map = shallowRef<maplibregl.Map | null>(null)
const loading = ref(true)
const loadError = ref('')
const locations = ref<{ order: EnforcementOrder; lng: number; lat: number }[]>([])
const unlocated = ref(0)

const TYPE_COLOR: Record<string, string> = {
  stop_work:     '#ef4444',
  demolition:    '#7c2d12',
  rectification: '#b45309',
  removal:       '#8b5cf6',
  cessation:     '#dc2626',
  enforcement_notice: '#b91c1c',
  stop_notice: '#dc2626',
  breach_of_condition: '#c2410c',
  retrospective_consent: '#a16207',
  reinstatement: '#7c3aed',
}

async function refresh() {
  loading.value = true
  loadError.value = ''
  try {
    const orders = await dmApi.listEnforcement()
    const list = Array.isArray(orders) ? orders : []
    const plotted = list
      .filter(o => o.latitude != null && o.longitude != null)
      .map(o => ({ order: o, lng: o.longitude as number, lat: o.latitude as number }))
    locations.value = plotted
    unlocated.value = list.length - plotted.length
    updateLayer()
  } catch (e: any) {
    locations.value = []
    unlocated.value = 0
    loadError.value = parseApiError(e, 'Could not load enforcement orders.')
    fb.showToast(loadError.value, 'error')
  } finally {
    loading.value = false
  }
}

function updateLayer() {
  const m = map.value
  if (!m || !m.isStyleLoaded()) return
  const fc = {
    type:'FeatureCollection' as const,
    features: locations.value.map(l => ({
      type:'Feature' as const,
      geometry:{ type:'Point' as const, coordinates:[l.lng, l.lat] },
      properties:{
        ref: l.order.order_reference, type: l.order.order_type,
        stand: l.order.stand_number, owner: l.order.owner_name || l.order.subject_name || '—',
        status: l.order.status,
        color: TYPE_COLOR[l.order.order_type] || '#dc2626',
      },
    })),
  }
  const src = m.getSource('enf') as maplibregl.GeoJSONSource | undefined
  if (src) src.setData(fc as any)
  else {
    m.addSource('enf', { type:'geojson', data: fc as any })
    m.addLayer({ id:'enf-pts', type:'circle', source:'enf',
      paint:{ 'circle-radius':8, 'circle-color':['get','color'],
        'circle-stroke-width':2, 'circle-stroke-color':'#fff' } })
    m.on('click', 'enf-pts', (e) => {
      const f = e.features?.[0]; if (!f?.properties) return
      new maplibregl.Popup({ maxWidth:'280px' })
        .setLngLat((f.geometry as any).coordinates)
        .setHTML(`<div style="font-family:inherit;font-size:12px">
          <div style="font-weight:700;margin-bottom:4px">${escapeHtml(f.properties.ref)}</div>
          <div style="color:#64748b;font-size:11px">${escapeHtml(String(f.properties.type).replace(/_/g, ' ').toUpperCase())}</div>
          <div style="margin-top:4px">Stand ${escapeHtml(f.properties.stand)}</div>
          <div>${escapeHtml(f.properties.owner)}</div>
          <div style="margin-top:4px;color:#dc2626;font-weight:600">${escapeHtml(f.properties.status)}</div>
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

const typeCounts = computed(() => {
  const c: Record<string, number> = {}
  for (const l of locations.value) c[l.order.order_type] = (c[l.order.order_type] || 0) + 1
  return c
})
</script>

<template>
  <div class="ef">
    <header class="ef-head">
      <ShieldAlert :size="14" />
      <h2>Enforcement mapping</h2>
      <span class="ef-sub">{{ locations.length }} order(s) plotted</span>
      <button class="ef-refresh" @click="refresh" :disabled="loading" aria-label="Refresh enforcement orders">
        <RefreshCw :size="12" :class="{ spin: loading }" />
      </button>
    </header>

    <div v-if="loadError" class="ef-banner" role="alert">
      <AlertTriangle :size="14" />
      <span>{{ loadError }}</span>
      <button type="button" @click="refresh">Retry</button>
    </div>

    <div class="ef-body">
      <aside class="ef-legend">
        <h4>Order type</h4>
        <ul>
          <li v-for="(c, k) in TYPE_COLOR" :key="k">
            <span class="ef-dot" :style="{ background: c }"></span>
            <span class="ef-lbl">{{ String(k).replace(/_/g, ' ') }}</span>
            <span class="ef-count">{{ typeCounts[k] || 0 }}</span>
          </li>
        </ul>
        <p v-if="!loading && !loadError && !locations.length" class="ef-empty">
          No enforcement orders with recorded coordinates.
        </p>
        <p v-if="unlocated > 0" class="ef-note">
          {{ unlocated }} order(s) have no lat/lng and are not plotted. Record coordinates on the order to show them here.
        </p>
        <p v-else class="ef-note">
          Only orders with stored latitude and longitude are plotted. Basemap layers can be toggled on the map.
        </p>
      </aside>
      <div class="ef-map-wrap">
        <div ref="container" class="ef-map"></div>
        <MapLayerFilters :map="map" />
      </div>
    </div>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.ef { display:flex; flex-direction:column; height:100%; }
.ef-head { display:flex; align-items:center; gap:0.4rem; padding:0.75rem 1.25rem; }
.ef-head h2 { margin:0; font-size:0.95rem; font-weight:700; }
.ef-sub { color:#94a3b8; font-size:0.7rem; }
.ef-refresh { margin-left:auto; background:none; border:1px solid #e2e8f0; border-radius:0.3rem;
  padding:0.35rem; cursor:pointer; color:#64748b; }
.spin { animation: efspin 0.8s linear infinite; }
@keyframes efspin { to { transform: rotate(360deg); } }

.ef-banner { display:flex; align-items:center; gap:0.5rem; margin:0 1.25rem 0.5rem;
  padding:0.5rem 0.75rem; background:#fef3c7; color:#92400e; border:1px solid #fde68a;
  border-radius:0.4rem; font-size:0.75rem; }
.ef-banner button { margin-left:auto; background:#fff; border:1px solid #fde68a;
  border-radius:0.3rem; padding:0.25rem 0.55rem; font-size:0.7rem; cursor:pointer; color:#92400e; }

.ef-body { flex:1; min-height:0; display:grid; grid-template-columns:18rem 1fr;
  gap:0.65rem; padding:0 1.25rem 1rem 1.25rem; }

.ef-legend { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem;
  padding:0.7rem 0.85rem; overflow-y:auto; }
.ef-legend h4 { margin:0 0 0.45rem; font-size:0.7rem; color:#0e7490; text-transform:uppercase;
  letter-spacing:0.05em; font-weight:700; }
.ef-legend ul { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.25rem; }
.ef-legend li { display:flex; align-items:center; gap:0.45rem; font-size:0.7rem; color:#475569; }
.ef-dot { width:0.7rem; height:0.7rem; border-radius:50%; border:1.5px solid #fff;
  box-shadow:0 0 0 1px #cbd5e1; flex-shrink:0; }
.ef-lbl { flex:1; text-transform:capitalize; }
.ef-count { font-family: ui-monospace, monospace; font-weight:600; color:#0f172a; }

.ef-empty { font-size:0.7rem; color:#64748b; margin:0.6rem 0 0; }
.ef-note { font-size:0.6rem; color:#64748b; padding:0.5rem 0.65rem; background:#f8fafc;
  border:1px solid #e2e8f0; border-radius:0.25rem; margin:0.6rem 0 0; line-height:1.5; }

.ef-map-wrap { position:relative; min-height:16rem; }
.ef-map { width:100%; height:100%; background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:hidden; }

@media (max-width: 1023px) {
  .ef-body { grid-template-columns:1fr; }
  .ef-legend { max-height:14rem; }
  .ef-map-wrap { min-height:20rem; }
}
</style>
