<script setup lang="ts">
// PermitDocumentsPanel — read-only list of the application documents the
// citizen uploaded against a permit, for the planner/clerk completeness
// review. Fetches the real document list from the backend (dmApi) instead of
// assuming documents only exist client-side, and flags any missing mandatory
// document types. Reusable across the planner Step 1 intake and the planning
// clerk's application-receipt screen.

import { ref, computed, watch } from 'vue'
import { dmApi, type PermitDocument } from '@/services/developmentManagementService'
import { DOC_TYPE_LABELS, type CitizenDocType } from '@/composables/useCitizenCase'
import { FileText, AlertTriangle, CheckCircle2, ExternalLink, RefreshCw } from 'lucide-vue-next'

const props = withDefaults(defineProps<{
  permitId: string | null
  /** Mandatory document types this application must carry. Defaults to the
   *  core development-control set. */
  requiredTypes?: CitizenDocType[]
}>(), {
  requiredTypes: () => ['title_deed', 'site_plan', 'building_plan'],
})

const docs = ref<PermitDocument[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load() {
  if (!props.permitId) { docs.value = []; return }
  loading.value = true
  error.value = null
  try {
    docs.value = await dmApi.listPermitDocuments(props.permitId)
  } catch {
    error.value = 'Could not load documents for this application.'
    docs.value = []
  } finally {
    loading.value = false
  }
}

watch(() => props.permitId, load, { immediate: true })

const presentTypes = computed(() => new Set(docs.value.map(d => d.doc_type)))
const missingMandatory = computed(() =>
  props.requiredTypes.filter(t => !presentTypes.value.has(t)))

function typeLabel(t: string): string {
  return DOC_TYPE_LABELS[t as CitizenDocType] ?? t
}
function fmtSize(bytes: number | null): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / 1024 / 1024).toFixed(1) + ' MB'
}
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <section class="pdp-card">
    <header class="pdp-head">
      <FileText :size="14" />
      <h3>Application documents</h3>
      <span class="pdp-count">{{ docs.length }}</span>
      <button type="button" class="pdp-refresh" title="Reload documents" @click="load">
        <RefreshCw :size="13" />
      </button>
    </header>

    <p v-if="loading" class="pdp-msg">Loading documents…</p>
    <p v-else-if="error" class="pdp-msg pdp-err">{{ error }}</p>

    <template v-else>
      <div v-if="missingMandatory.length" class="pdp-warn">
        <AlertTriangle :size="14" />
        <span>Missing mandatory document{{ missingMandatory.length === 1 ? '' : 's' }}:
          {{ missingMandatory.map(typeLabel).join(', ') }}</span>
      </div>
      <div v-else-if="docs.length" class="pdp-ok">
        <CheckCircle2 :size="14" />
        <span>All core documents present.</span>
      </div>

      <p v-if="!docs.length" class="pdp-msg">No documents have been uploaded for this application yet.</p>

      <table v-else class="pdp-table">
        <thead>
          <tr><th>Document</th><th>Type</th><th>Uploaded</th><th>Size</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="d in docs" :key="d.id">
            <td class="pdp-name">{{ d.file_name }}</td>
            <td>{{ typeLabel(d.doc_type) }}</td>
            <td>{{ fmtDate(d.uploaded_at) }}</td>
            <td>{{ fmtSize(d.bytes) }}</td>
            <td>
              <a v-if="d.storage_url" :href="d.storage_url" target="_blank" rel="noopener"
                 class="pdp-open" title="Open / download">
                <ExternalLink :size="13" /> Open
              </a>
              <span v-else class="pdp-muted">—</span>
            </td>
          </tr>
        </tbody>
      </table>
    </template>
  </section>
</template>

<style scoped>
.pdp-card { background:#fff; border:1px solid #e2e8f0; border-radius:0.6rem; padding:0.85rem 1rem; }
.pdp-head { display:flex; align-items:center; gap:0.45rem; color:#0f172a; }
.pdp-head h3 { font-size:0.82rem; font-weight:700; margin:0; }
.pdp-count { font-size:0.7rem; font-weight:600; color:#475569;
  background:#f1f5f9; border-radius:9999px; padding:0.05rem 0.5rem; }
.pdp-refresh { margin-left:auto; display:inline-flex; align-items:center; justify-content:center;
  width:1.6rem; height:1.6rem; border:1px solid #e2e8f0; border-radius:0.35rem;
  background:#fff; color:#64748b; cursor:pointer; }
.pdp-refresh:hover { background:#f8fafc; color:#0f172a; }
.pdp-msg { font-size:0.78rem; color:#64748b; margin:0.6rem 0 0; }
.pdp-err { color:#b91c1c; }
.pdp-warn, .pdp-ok { display:flex; align-items:center; gap:0.4rem; margin-top:0.65rem;
  font-size:0.76rem; font-weight:600; padding:0.45rem 0.6rem; border-radius:0.4rem; }
.pdp-warn { color:#92400e; background:#fffbeb; border:1px solid #fde68a; }
.pdp-ok   { color:#166534; background:#f0fdf4; border:1px solid #bbf7d0; }
.pdp-table { width:100%; border-collapse:collapse; margin-top:0.65rem; font-size:0.76rem; }
.pdp-table th { text-align:left; color:#64748b; font-weight:600; padding:0.3rem 0.5rem;
  border-bottom:1px solid #e2e8f0; }
.pdp-table td { padding:0.4rem 0.5rem; border-bottom:1px solid #f1f5f9; color:#0f172a; }
.pdp-name { font-weight:600; }
.pdp-open { display:inline-flex; align-items:center; gap:0.25rem; color:#1d4ed8;
  text-decoration:none; font-weight:600; }
.pdp-open:hover { text-decoration:underline; }
.pdp-muted { color:#94a3b8; }
</style>
