<script setup lang="ts">
// Livestock GIS — dip tanks, stock pens, watering points (council_ops.livestock_facility).
import { onMounted, ref } from 'vue'
import { councilOpsApi, type LivestockFacility } from '@/services/councilOpsApi'
import { Beef, AlertTriangle, RefreshCw } from 'lucide-vue-next'

const rows = ref<LivestockFacility[]>([])
const note = ref('')
const loading = ref(false)
const error = ref('')
const search = ref('')

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await councilOpsApi.listLivestock({
      search: search.value || undefined,
      limit: 300,
    })
    rows.value = res.data
    note.value = res.meta?.note || ''
  } catch {
    error.value = 'Could not load the livestock facilities register.'
  } finally {
    loading.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="ops">
    <header class="ops-head">
      <div>
        <p class="ops-eyebrow"><Beef :size="14" /> Livestock</p>
        <h1>Dip tanks &amp; stock facilities</h1>
        <p>Council livestock infrastructure. Empty until Agriculture / veterinary inventory is imported.</p>
      </div>
      <button type="button" class="ops-btn" :disabled="loading" @click="load">
        <RefreshCw :size="14" /> Refresh
      </button>
    </header>

    <div v-if="note" class="ops-banner" role="status">
      <AlertTriangle :size="16" />
      <span>{{ note }}</span>
    </div>
    <p v-if="error" class="ops-err">{{ error }}</p>

    <div class="ops-toolbar">
      <input v-model="search" type="search" placeholder="Search name, type, ward…" @keyup.enter="load" />
      <button type="button" class="ops-btn" @click="load">Search</button>
    </div>

    <p v-if="loading" class="ops-muted">Loading…</p>
    <table v-else-if="rows.length" class="ops-table">
      <thead>
        <tr>
          <th>Type</th><th>Name</th><th>Ward</th><th>Lng</th><th>Lat</th><th>Quality</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td>{{ r.facility_type }}</td>
          <td>{{ r.name || '—' }}</td>
          <td>{{ r.ward || '—' }}</td>
          <td class="mono">{{ r.lng != null ? Number(r.lng).toFixed(5) : '—' }}</td>
          <td class="mono">{{ r.lat != null ? Number(r.lat).toFixed(5) : '—' }}</td>
          <td><span class="pill">{{ r.data_quality }}</span></td>
        </tr>
      </tbody>
    </table>
    <p v-else class="ops-empty">
      No livestock facilities yet. Import GeoJSON via
      <code>POST /api/ops/import/livestock</code> when Agriculture delivers the inventory.
    </p>
  </div>
</template>

<style scoped>
.ops { display:flex; flex-direction:column; gap:1rem; max-width:1100px; }
.ops-head { display:flex; justify-content:space-between; gap:1rem; align-items:flex-start; }
.ops-eyebrow { margin:0; display:inline-flex; align-items:center; gap:0.35rem; font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#0b3d3a; }
.ops-head h1 { margin:0.2rem 0 0; font-size:1.35rem; }
.ops-head p { margin:0.35rem 0 0; color:#515c6b; font-size:0.88rem; max-width:40rem; }
.ops-btn { display:inline-flex; align-items:center; gap:0.35rem; border:1px solid #dde2e9; background:#fff; border-radius:0.5rem; padding:0.45rem 0.75rem; cursor:pointer; font:inherit; }
.ops-banner { display:flex; gap:0.55rem; padding:0.75rem 0.9rem; background:#fff8e8; border:1px solid #f0d78c; border-radius:0.65rem; color:#7a5b12; font-size:0.85rem; }
.ops-err { color:#bd2f28; }
.ops-toolbar { display:flex; flex-wrap:wrap; gap:0.45rem; }
.ops-toolbar input {
  padding:0.5rem 0.65rem; border:1px solid #dde2e9; border-radius:0.5rem; font:inherit; min-width:12rem;
}
.ops-table { width:100%; border-collapse:collapse; font-size:0.85rem; }
.ops-table th, .ops-table td { text-align:left; padding:0.55rem 0.4rem; border-bottom:1px solid #e8ecf1; }
.ops-table th { font-size:0.68rem; text-transform:uppercase; color:#7b8797; }
.mono { font-family:ui-monospace,monospace; font-size:0.78rem; }
.pill { font-size:0.68rem; font-weight:700; text-transform:uppercase; padding:0.1rem 0.4rem; border-radius:999px; background:#e8f0f9; color:#1f5aa8; }
.ops-empty, .ops-muted { color:#7b8797; }
</style>
