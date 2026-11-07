<script setup lang="ts">
// GeoJSON import into council_ops registers — validated, no silent overwrite.
import { ref } from 'vue'
import { councilOpsApi } from '@/services/councilOpsApi'
import { Upload, AlertTriangle } from 'lucide-vue-next'

const register = ref<'wash' | 'roads' | 'livestock' | 'assets'>('wash')
const dryRun = ref(true)
const fileName = ref('')
const raw = ref<unknown>(null)
const busy = ref(false)
const error = ref('')
const result = ref<string>('')

function onFile(ev: Event) {
  error.value = ''
  result.value = ''
  const input = ev.target as HTMLInputElement
  const file = input.files?.[0]
  if (!file) return
  fileName.value = file.name
  const reader = new FileReader()
  reader.onload = () => {
    try {
      raw.value = JSON.parse(String(reader.result || ''))
      if ((raw.value as { type?: string })?.type !== 'FeatureCollection') {
        error.value = 'File must be a GeoJSON FeatureCollection.'
        raw.value = null
      }
    } catch {
      error.value = 'Invalid JSON.'
      raw.value = null
    }
  }
  reader.readAsText(file)
}

async function runImport() {
  if (!raw.value) { error.value = 'Choose a GeoJSON FeatureCollection first.'; return }
  busy.value = true
  error.value = ''
  result.value = ''
  try {
    const res = await councilOpsApi.importGeoJson(register.value, raw.value, dryRun.value)
    const d = res?.data || res
    result.value = dryRun.value
      ? `Dry run: would insert ${d.would_insert ?? d.inserted ?? 0} feature(s); errors ${d.errors?.length ?? 0}.`
      : `Inserted ${d.inserted ?? 0} into ${register.value}; errors ${d.errors?.length ?? 0}.`
  } catch {
    error.value = 'Import failed. Check geometry types match the register (points for WASH, lines for roads).'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="imp">
    <header>
      <p class="imp-eyebrow"><Upload :size="14" /> Data import</p>
      <h1>Import Council asset GeoJSON</h1>
      <p>
        Loads authoritative features into <code>council_ops</code>. Always dry-run first.
        Never invents coordinates — only imports what you supply.
      </p>
    </header>

    <div class="imp-banner" role="note">
      <AlertTriangle :size="16" />
      <span>CRS must be WGS 84 (EPSG:4326). Max 2000 features. &gt;50% row errors rolls back the batch.</span>
    </div>

    <label>Target register
      <select v-model="register">
        <option value="wash">WASH (points)</option>
        <option value="roads">Roads (lines)</option>
        <option value="livestock">Livestock facilities (points)</option>
        <option value="assets">Council assets</option>
      </select>
    </label>

    <label class="imp-file">
      GeoJSON file
      <input type="file" accept=".json,.geojson,application/geo+json,application/json" @change="onFile" />
      <span v-if="fileName">{{ fileName }}</span>
    </label>

    <label class="imp-check">
      <input v-model="dryRun" type="checkbox" />
      Dry run (validate only — do not write)
    </label>

    <button type="button" class="imp-btn" :disabled="busy || !raw" @click="runImport">
      {{ busy ? 'Working…' : (dryRun ? 'Validate import' : 'Commit import') }}
    </button>

    <p v-if="error" class="imp-err">{{ error }}</p>
    <p v-if="result" class="imp-ok">{{ result }}</p>
  </div>
</template>

<style scoped>
.imp { display:flex; flex-direction:column; gap:0.85rem; max-width:560px; }
.imp-eyebrow { margin:0; display:inline-flex; gap:0.35rem; align-items:center; font-size:0.72rem; font-weight:700; text-transform:uppercase; color:#0b3d3a; }
.imp h1 { margin:0; font-size:1.3rem; }
.imp header p { margin:0.35rem 0 0; color:#515c6b; font-size:0.88rem; line-height:1.4; }
.imp-banner { display:flex; gap:0.5rem; padding:0.7rem 0.85rem; background:#fff8e8; border:1px solid #f0d78c; border-radius:0.65rem; color:#7a5b12; font-size:0.82rem; }
.imp label { display:flex; flex-direction:column; gap:0.35rem; font-size:0.8rem; font-weight:600; color:#515c6b; }
.imp select, .imp input[type="file"] { font:inherit; }
.imp select { padding:0.5rem 0.65rem; border:1px solid #dde2e9; border-radius:0.5rem; }
.imp-check { flex-direction:row; align-items:center; gap:0.5rem; font-weight:500; }
.imp-btn { align-self:flex-start; border:0; background:#0b3d3a; color:#fff; border-radius:0.5rem; padding:0.55rem 0.9rem; font:inherit; font-weight:700; cursor:pointer; }
.imp-btn:disabled { opacity:0.55; cursor:not-allowed; }
.imp-err { color:#bd2f28; margin:0; }
.imp-ok { color:#1a5c56; margin:0; }
</style>
