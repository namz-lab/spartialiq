<script setup lang="ts">
// Master Plan GIS theme catalogue — honest availability from PostGIS.
import { onMounted, computed, ref } from 'vue'
import { councilOpsApi, type MasterTheme } from '@/services/councilOpsApi'
import api from '@/services/api'
import { Layers, RefreshCw } from 'lucide-vue-next'

const themes = ref<MasterTheme[]>([])
const loading = ref(false)
const error = ref('')
const filter = ref('All')
const wardName = ref('')
const wardLoading = ref(false)
const wardError = ref('')

const categories = computed(() => ['All', ...new Set(themes.value.map(t => t.category))])
const visible = computed(() =>
  themes.value.filter(t => filter.value === 'All' || t.category === filter.value),
)

async function load() {
  loading.value = true
  error.value = ''
  try {
    themes.value = await councilOpsApi.masterThemes()
  } catch {
    error.value = 'Could not load the master theme catalogue.'
  } finally {
    loading.value = false
  }
}

async function downloadWardProfile() {
  wardError.value = ''
  const w = wardName.value.trim()
  if (!w) { wardError.value = 'Enter a ward name (as stored in the wards layer).'; return }
  wardLoading.value = true
  try {
    const r = await api.post('/ops/ward-profile-report', { ward: w }, { responseType: 'blob' })
    const blob = new Blob([r.data], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `VRDC-Ward-Profile-${w.replace(/\s+/g, '_')}.pdf`
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    wardError.value = 'Could not generate the ward profile PDF.'
  } finally {
    wardLoading.value = false
  }
}

const mapLoading = ref(false)
async function downloadCouncilMap() {
  mapLoading.value = true
  error.value = ''
  try {
    const r = await api.post('/ops/council-map-report', { subject: 'All Vungu — theme schedule' }, { responseType: 'blob' })
    const blob = new Blob([r.data], { type: 'application/pdf' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = 'VRDC-Council-Map-Schedule.pdf'
    a.click()
    URL.revokeObjectURL(url)
  } catch {
    error.value = 'Could not generate the council map schedule PDF.'
  } finally {
    mapLoading.value = false
  }
}

onMounted(load)

const STATUS_LABEL: Record<string, string> = {
  live: 'Live',
  reference_osm: 'Reference (OSM)',
  schema_ready: 'Schema ready',
  unavailable: 'Unavailable',
  partial: 'Partial',
}
</script>

<template>
  <div class="mt">
    <header class="mt-head">
      <div>
        <p class="mt-eyebrow"><Layers :size="14" /> Master Plan study catalogue</p>
        <h1>Vungu spatial themes</h1>
        <p>
          Themes from the Master Plan / Report of Study. Missing data is marked unavailable —
          nothing is fabricated.
        </p>
      </div>
      <button type="button" class="mt-btn" :disabled="loading" @click="load"><RefreshCw :size="14" /> Refresh</button>
      <button type="button" class="mt-btn" :disabled="mapLoading" @click="downloadCouncilMap">
        {{ mapLoading ? 'Generating…' : 'Generate council map PDF' }}
      </button>
    </header>

    <div class="mt-ward">
      <label>Ward spatial profile PDF</label>
      <div class="mt-ward-row">
        <input v-model="wardName" placeholder="e.g. Ward 7" @keyup.enter="downloadWardProfile" />
        <button type="button" class="mt-btn" :disabled="wardLoading" @click="downloadWardProfile">
          {{ wardLoading ? 'Generating…' : 'Generate ward PDF' }}
        </button>
      </div>
      <p v-if="wardError" class="mt-err">{{ wardError }}</p>
    </div>

    <div class="mt-filters">
      <button
        v-for="c in categories" :key="c" type="button"
        :class="{ on: filter === c }"
        @click="filter = c"
      >{{ c }}</button>
    </div>

    <p v-if="error" class="mt-err">{{ error }}</p>
    <p v-else-if="loading" class="mt-muted">Loading…</p>

    <ul v-else class="mt-list">
      <li v-for="t in visible" :key="t.id" class="mt-card" :data-status="t.status">
        <div class="mt-card-top">
          <strong>{{ t.theme }}</strong>
          <span class="mt-pill">{{ STATUS_LABEL[t.status] || t.status }}</span>
        </div>
        <p class="mt-dept">{{ t.department }} · {{ t.category }}</p>
        <p class="mt-note">{{ t.note }}</p>
        <p v-if="t.layersPresent.length" class="mt-layers">
          Layers: <code v-for="id in t.layersPresent" :key="id">{{ id }}</code>
        </p>
      </li>
    </ul>
  </div>
</template>

<style scoped>
.mt { display:flex; flex-direction:column; gap:1rem; max-width:960px; }
.mt-head { display:flex; justify-content:flex-end; flex-wrap:wrap; gap:0.5rem; align-items:flex-start; }
.mt-head > div:first-child { flex:1; min-width:14rem; margin-right:auto; }
.mt-eyebrow { margin:0; display:inline-flex; gap:0.35rem; align-items:center; font-size:0.72rem; font-weight:700; text-transform:uppercase; color:#0b3d3a; }
.mt-head h1 { margin:0.2rem 0 0; font-size:1.35rem; }
.mt-head p { margin:0.35rem 0 0; color:#515c6b; font-size:0.88rem; max-width:40rem; }
.mt-btn { display:inline-flex; gap:0.35rem; align-items:center; border:1px solid #dde2e9; background:#fff; border-radius:0.5rem; padding:0.45rem 0.75rem; cursor:pointer; font:inherit; }
.mt-ward { display:flex; flex-direction:column; gap:0.35rem; padding:0.85rem 1rem; border:1px solid #dde2e9; border-radius:0.75rem; background:#fff; }
.mt-ward label { font-size:0.72rem; font-weight:700; text-transform:uppercase; letter-spacing:0.04em; color:#7b8797; }
.mt-ward-row { display:flex; gap:0.45rem; flex-wrap:wrap; }
.mt-ward-row input { flex:1; min-width:12rem; padding:0.5rem 0.7rem; border:1px solid #dde2e9; border-radius:0.5rem; font:inherit; }
.mt-filters { display:flex; flex-wrap:wrap; gap:0.35rem; }
.mt-filters button { border:1px solid #dde2e9; background:#fff; border-radius:999px; padding:0.3rem 0.7rem; font-size:0.75rem; font-weight:600; cursor:pointer; }
.mt-filters button.on { background:#0b3d3a; color:#fff; border-color:#0b3d3a; }
.mt-list { list-style:none; margin:0; padding:0; display:grid; gap:0.65rem; }
.mt-card { border:1px solid #dde2e9; border-radius:0.75rem; padding:0.85rem 1rem; background:#fffcf7; }
.mt-card[data-status="unavailable"] { opacity:0.85; }
.mt-card[data-status="live"] { border-color:#9bc4b8; }
.mt-card-top { display:flex; justify-content:space-between; gap:0.75rem; }
.mt-pill { flex:none; font-size:0.65rem; font-weight:700; text-transform:uppercase; padding:0.15rem 0.45rem; border-radius:999px; background:#e8f0f9; color:#1f5aa8; }
.mt-card[data-status="unavailable"] .mt-pill { background:#f0e8e8; color:#8a3a3a; }
.mt-card[data-status="schema_ready"] .mt-pill { background:#f8efdd; color:#a8620a; }
.mt-card[data-status="reference_osm"] .mt-pill { background:#eee; color:#515c6b; }
.mt-dept { margin:0.25rem 0; font-size:0.75rem; color:#7b8797; }
.mt-note { margin:0; font-size:0.82rem; color:#515c6b; line-height:1.4; }
.mt-layers { margin:0.4rem 0 0; font-size:0.75rem; }
.mt-layers code { margin-right:0.35rem; background:#eef2f6; padding:0.1rem 0.35rem; border-radius:0.3rem; }
.mt-err { color:#bd2f28; }
.mt-muted { color:#7b8797; }
</style>
