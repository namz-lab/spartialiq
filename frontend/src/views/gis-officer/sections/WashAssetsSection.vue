<script setup lang="ts">
// WASH — DSSWC water & sanitation asset register (council_ops.wash_asset).
import { onMounted, ref } from 'vue'
import { councilOpsApi, type WashAsset } from '@/services/councilOpsApi'
import { Droplets, AlertTriangle, RefreshCw, Plus } from 'lucide-vue-next'

const rows = ref<WashAsset[]>([])
const note = ref('')
const loading = ref(false)
const error = ref('')
const search = ref('')
const typeFilter = ref('')
const showForm = ref(false)
const form = ref({
  asset_type: 'borehole',
  name: '',
  ward: '',
  lng: '',
  lat: '',
  asset_code: '',
})
const saving = ref(false)

async function load() {
  loading.value = true
  error.value = ''
  try {
    const res = await councilOpsApi.listWash({
      search: search.value || undefined,
      type: typeFilter.value || undefined,
      limit: 300,
    })
    rows.value = res.data
    note.value = res.meta?.note || ''
  } catch {
    error.value = 'Could not load the WASH register.'
  } finally {
    loading.value = false
  }
}

async function create() {
  saving.value = true
  error.value = ''
  try {
    await councilOpsApi.createWash({
      asset_type: form.value.asset_type,
      name: form.value.name || null,
      ward: form.value.ward || null,
      asset_code: form.value.asset_code || null,
      lng: Number(form.value.lng),
      lat: Number(form.value.lat),
      data_quality: 'unverified',
      source: 'manual_entry',
    } as any)
    showForm.value = false
    form.value = { asset_type: 'borehole', name: '', ward: '', lng: '', lat: '', asset_code: '' }
    await load()
  } catch {
    error.value = 'Could not save the asset. Check coordinates and type.'
  } finally {
    saving.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="ops">
    <header class="ops-head">
      <div>
        <p class="ops-eyebrow"><Droplets :size="14" /> DSSWC / WASH</p>
        <h1>Water &amp; sanitation assets</h1>
        <p>Boreholes, schemes, tanks and sanitation facilities. Empty until DSSWC inventory is imported.</p>
      </div>
      <div class="ops-actions">
        <button type="button" class="ops-btn" @click="showForm = !showForm"><Plus :size="14" /> Add point</button>
        <button type="button" class="ops-btn" :disabled="loading" @click="load"><RefreshCw :size="14" /> Refresh</button>
      </div>
    </header>

    <div v-if="note" class="ops-banner" role="status">
      <AlertTriangle :size="16" />
      <span>{{ note }}</span>
    </div>
    <p v-if="error" class="ops-err">{{ error }}</p>

    <form v-if="showForm" class="ops-form" @submit.prevent="create">
      <select v-model="form.asset_type">
        <option value="borehole">Borehole</option>
        <option value="well">Well</option>
        <option value="water_point">Water point</option>
        <option value="tank">Tank</option>
        <option value="reservoir">Reservoir</option>
        <option value="scheme">Scheme</option>
        <option value="toilet">Toilet</option>
        <option value="waste_site">Waste site</option>
        <option value="other">Other</option>
      </select>
      <input v-model="form.name" placeholder="Name" />
      <input v-model="form.ward" placeholder="Ward" />
      <input v-model="form.asset_code" placeholder="Asset code" />
      <input v-model="form.lng" placeholder="Longitude" required />
      <input v-model="form.lat" placeholder="Latitude" required />
      <button type="submit" class="ops-btn primary" :disabled="saving">{{ saving ? 'Saving…' : 'Save asset' }}</button>
    </form>

    <div class="ops-toolbar">
      <input v-model="search" type="search" placeholder="Search…" @keyup.enter="load" />
      <select v-model="typeFilter" @change="load">
        <option value="">All types</option>
        <option value="borehole">Borehole</option>
        <option value="well">Well</option>
        <option value="water_point">Water point</option>
        <option value="scheme">Scheme</option>
        <option value="toilet">Toilet</option>
      </select>
      <button type="button" class="ops-btn" @click="load">Filter</button>
    </div>

    <table v-if="rows.length" class="ops-table">
      <thead>
        <tr><th>Code</th><th>Type</th><th>Name</th><th>Ward</th><th>Status</th><th>Lng</th><th>Lat</th><th>Quality</th></tr>
      </thead>
      <tbody>
        <tr v-for="r in rows" :key="r.id">
          <td class="mono">{{ r.asset_code || '—' }}</td>
          <td>{{ r.asset_type }}</td>
          <td>{{ r.name || '—' }}</td>
          <td>{{ r.ward || '—' }}</td>
          <td>{{ r.operational || '—' }}</td>
          <td class="mono">{{ r.lng?.toFixed?.(5) ?? '—' }}</td>
          <td class="mono">{{ r.lat?.toFixed?.(5) ?? '—' }}</td>
          <td><span class="pill">{{ r.data_quality }}</span></td>
        </tr>
      </tbody>
    </table>
    <p v-else-if="!loading" class="ops-empty">No WASH assets yet. Add a verified field point or import GeoJSON via <code>POST /api/ops/import/wash</code>.</p>
  </div>
</template>

<style scoped>
.ops { display:flex; flex-direction:column; gap:1rem; max-width:1100px; }
.ops-head { display:flex; justify-content:space-between; gap:1rem; align-items:flex-start; }
.ops-actions { display:flex; gap:0.4rem; }
.ops-eyebrow { margin:0; display:inline-flex; align-items:center; gap:0.35rem; font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.05em; color:#0b3d3a; }
.ops-head h1 { margin:0.2rem 0 0; font-size:1.35rem; }
.ops-head p { margin:0.35rem 0 0; color:#515c6b; font-size:0.88rem; max-width:40rem; }
.ops-btn { display:inline-flex; align-items:center; gap:0.35rem; border:1px solid #dde2e9; background:#fff; border-radius:0.5rem; padding:0.45rem 0.75rem; cursor:pointer; font:inherit; }
.ops-btn.primary { background:#0b3d3a; color:#fff; border-color:#0b3d3a; }
.ops-banner { display:flex; gap:0.55rem; padding:0.75rem 0.9rem; background:#fff8e8; border:1px solid #f0d78c; border-radius:0.65rem; color:#7a5b12; font-size:0.85rem; }
.ops-err { color:#bd2f28; }
.ops-form, .ops-toolbar { display:flex; flex-wrap:wrap; gap:0.45rem; }
.ops-form input, .ops-form select, .ops-toolbar input, .ops-toolbar select {
  padding:0.5rem 0.65rem; border:1px solid #dde2e9; border-radius:0.5rem; font:inherit; min-width:8rem;
}
.ops-table { width:100%; border-collapse:collapse; font-size:0.85rem; }
.ops-table th, .ops-table td { text-align:left; padding:0.55rem 0.4rem; border-bottom:1px solid #e8ecf1; }
.ops-table th { font-size:0.68rem; text-transform:uppercase; color:#7b8797; }
.mono { font-family:ui-monospace,monospace; font-size:0.78rem; }
.pill { font-size:0.68rem; font-weight:700; text-transform:uppercase; padding:0.1rem 0.4rem; border-radius:999px; background:#e8f0f9; color:#1f5aa8; }
.ops-empty { color:#7b8797; }
</style>
