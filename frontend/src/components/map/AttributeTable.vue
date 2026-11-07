<script setup lang="ts">
// ─────────────────────────────────────────────────────────────────────────
// AttributeTable — a bottom drawer that lists the features of a chosen PostGIS
// layer as a sortable, filterable table. Clicking a row zooms the map to that
// feature. Backs the "browse the data, not just the picture" GIS workflow.
//
// Source is map.queryRenderedFeatures() over the layer's vector tiles, so it
// reflects what is currently in view (no extra backend round-trip, works
// offline against loaded tiles). It dedupes features split across tile edges.
// ─────────────────────────────────────────────────────────────────────────
import { ref, computed, watch, onMounted } from 'vue'
// @ts-ignore — turf has no separate @types package in this project
import * as turf from '@turf/turf'
import { Table2, X, RefreshCw } from 'lucide-vue-next'
import { getTileLayerCatalog, type TileLayerMeta } from '@/services/vectorTiles'
import { flyTo as flyToRM, fitBounds as fitBoundsRM } from '@/map/tools/camera'

const props = defineProps<{ map: any | null }>()

const open = ref(false)
const layers = ref<TileLayerMeta[]>([])
const layerId = ref('')
const search = ref('')
const loading = ref(false)
const note = ref('')

interface Row {
  id: string
  props: Record<string, any>
  geometry: any
}
const rows = ref<Row[]>([])

// Columns are ordered by planning relevance, then capped so the table stays
// readable. Anything not listed falls in after, alphabetically.
const PRIORITY = [
  'name', 'name_en', 'name_cfu', 'title', 'fclass', 'type', 'use', 'zone',
  'zone_code', 'settlement', 'district', 'province', 'status', 'area_ha',
  'population', 'ref', 'pcode', 'fid',
]
const MAX_COLS = 7
const MAX_ROWS = 1000

onMounted(async () => {
  layers.value = await getTileLayerCatalog()
  if (layers.value.length && !layerId.value) layerId.value = layers.value[0].id
})

const columns = computed<string[]>(() => {
  const keys = new Set<string>()
  for (const r of rows.value) for (const k of Object.keys(r.props || {})) keys.add(k)
  const ordered = [
    ...PRIORITY.filter((k) => keys.has(k)),
    ...[...keys].filter((k) => !PRIORITY.includes(k)).sort(),
  ]
  return ordered.slice(0, MAX_COLS)
})

const filteredRows = computed<Row[]>(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return rows.value
  return rows.value.filter((r) =>
    Object.values(r.props || {}).some((v) => String(v ?? '').toLowerCase().includes(q)),
  )
})

function load() {
  const m = props.map
  if (!m || !layerId.value) return
  const mapLayerId = `vungu-${layerId.value}`
  if (!m.getLayer?.(mapLayerId)) {
    rows.value = []
    note.value = 'That layer is not on the map. Turn it on in the Layers panel.'
    return
  }
  loading.value = true
  note.value = ''
  try {
    const rendered: any[] = m.queryRenderedFeatures({ layers: [mapLayerId] }) || []
    const byId = new Map<string, Row>()
    for (const f of rendered) {
      const key = String(f.id ?? f.properties?.fid ?? JSON.stringify(f.properties))
      if (byId.has(key)) continue
      byId.set(key, { id: key, props: f.properties || {}, geometry: f.geometry })
      if (byId.size >= MAX_ROWS) break
    }
    rows.value = [...byId.values()]
    note.value = rows.value.length
      ? `${rows.value.length} feature${rows.value.length === 1 ? '' : 's'} in view${rows.value.length >= MAX_ROWS ? ' (capped — zoom in to narrow)' : ''}`
      : 'No features in the current view. Pan or zoom in, then refresh.'
  } finally {
    loading.value = false
  }
}

function selectRow(r: Row) {
  const m = props.map
  if (!m || !r.geometry) return
  try {
    const bbox = turf.bbox(r.geometry) as [number, number, number, number]
    const isPoint = bbox[0] === bbox[2] && bbox[1] === bbox[3]
    if (isPoint) {
      flyToRM(m, { center: [bbox[0], bbox[1]], zoom: Math.max(m.getZoom?.() ?? 14, 16) })
    } else {
      fitBoundsRM(m, [[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 80, maxZoom: 18 })
    }
  } catch {
    /* unparseable geometry — leave the map where it is */
  }
}

function toggle() {
  open.value = !open.value
  if (open.value) load()
}

// Reload when the layer changes while open.
watch(layerId, () => { if (open.value) load() })
// First time the map arrives while the drawer is already open.
watch(() => props.map, (m) => { if (m && open.value) load() })

function fmt(v: any): string {
  if (v == null) return ''
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  return String(v)
}
function layerTitle(id: string): string {
  return layers.value.find((l) => l.id === id)?.title || id
}
</script>

<template>
  <!-- collapsed handle -->
  <button v-if="!open" class="attr-tab" type="button" @click="toggle" aria-label="Open attribute table">
    <Table2 :size="15" />
    <span>Attributes</span>
  </button>

  <!-- expanded drawer -->
  <div v-else class="attr-drawer" role="region" aria-label="Attribute table">
    <div class="attr-head">
      <div class="attr-head-left">
        <Table2 :size="16" />
        <select v-model="layerId" class="layer-select" aria-label="Choose layer">
          <option v-for="l in layers" :key="l.id" :value="l.id">{{ l.title }}</option>
        </select>
        <input v-model="search" class="attr-search" type="text" placeholder="Filter rows…" aria-label="Filter rows" />
        <button class="attr-icon" type="button" :disabled="loading" @click="load" aria-label="Refresh">
          <RefreshCw :size="15" />
        </button>
      </div>
      <div class="attr-head-right">
        <span class="attr-note">{{ note }}</span>
        <button class="attr-icon" type="button" @click="toggle" aria-label="Close attribute table"><X :size="16" /></button>
      </div>
    </div>

    <div class="attr-body">
      <table v-if="filteredRows.length" class="attr-table">
        <thead>
          <tr>
            <th v-for="c in columns" :key="c">{{ c.replace(/_/g, ' ') }}</th>
            <th class="zoom-col" aria-label="Zoom"></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="r in filteredRows" :key="r.id" @click="selectRow(r)">
            <td v-for="c in columns" :key="c" :title="fmt(r.props[c])">{{ fmt(r.props[c]) }}</td>
            <td class="zoom-col">→</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="attr-empty">
        {{ loading ? 'Loading…' : `No rows for ${layerTitle(layerId)}. Make sure the layer is visible and in view, then refresh.` }}
      </p>
    </div>
  </div>
</template>

<style scoped>
.attr-tab {
  position: absolute;
  bottom: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 6;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 7px 14px;
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 10px;
  box-shadow: 0 4px 16px rgba(15, 23, 42, 0.12);
  font-family: inherit;
  font-size: 13px;
  font-weight: 600;
  color: #3c4043;
  cursor: pointer;
}
.attr-tab:hover { background: #f5f3ee; }
.attr-tab:focus-visible { outline: 2px solid #1a73e8; outline-offset: 2px; }

.attr-drawer {
  position: absolute;
  left: 12px;
  right: 12px;
  bottom: 12px;
  z-index: 6;
  height: 280px;
  display: flex;
  flex-direction: column;
  background: #ffffff;
  border: 1px solid #dadce0;
  border-radius: 12px;
  box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
  overflow: hidden;
  font-family: inherit;
  color: #3c4043;
}
.attr-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 8px 12px;
  border-bottom: 1px solid #eceff1;
  background: #f8f9fa;
}
.attr-head-left { display: flex; align-items: center; gap: 8px; min-width: 0; }
.attr-head-right { display: flex; align-items: center; gap: 10px; }
.layer-select {
  padding: 6px 8px;
  border: 1px solid #dadce0;
  border-radius: 8px;
  font-size: 13px;
  color: #202124;
  background: #fff;
  max-width: 180px;
}
.attr-search {
  padding: 6px 9px;
  border: 1px solid #dadce0;
  border-radius: 8px;
  font-size: 13px;
  color: #202124;
  width: 160px;
}
.layer-select:focus, .attr-search:focus { outline: 2px solid #1a73e8; outline-offset: 0; border-color: #1a73e8; }
.attr-icon {
  display: inline-flex;
  border: none;
  background: transparent;
  color: #5f6368;
  cursor: pointer;
  padding: 4px;
  border-radius: 6px;
}
.attr-icon:hover { background: #eceff1; color: #202124; }
.attr-icon:disabled { opacity: 0.5; cursor: default; }
.attr-note { font-size: 11px; color: #5f6368; white-space: nowrap; }

.attr-body { flex: 1; overflow: auto; }
.attr-table { width: 100%; border-collapse: collapse; font-size: 12px; }
.attr-table thead th {
  position: sticky;
  top: 0;
  background: #fff;
  text-align: left;
  padding: 7px 10px;
  border-bottom: 1px solid #dadce0;
  color: #5f6368;
  font-weight: 600;
  text-transform: capitalize;
  white-space: nowrap;
}
.attr-table tbody td {
  padding: 6px 10px;
  border-bottom: 1px solid #f1f3f4;
  color: #202124;
  max-width: 220px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.attr-table tbody tr { cursor: pointer; }
.attr-table tbody tr:hover { background: #f5f9ff; }
.zoom-col { width: 28px; text-align: center; color: #1a73e8; }
.attr-empty { padding: 24px; text-align: center; color: #5f6368; font-size: 13px; }

/* Shorter drawer on small / landscape-phone viewports so it doesn't swallow
   the map. */
@media (max-height: 560px) {
  .attr-drawer { height: 200px; }
}
@media (max-width: 480px) {
  .layer-select { max-width: 120px; }
  .attr-search { width: 100px; }
}
</style>
