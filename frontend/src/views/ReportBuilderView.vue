<script setup lang="ts">
// Ad-hoc report builder — filter the permit register by any criteria, pick
// columns, preview, and export CSV. Real data via dmApi; CSV is built
// client-side (no backend report engine).
import { ref, computed, onMounted } from 'vue'
import { dmApi, type PermitApplication } from '@/services/developmentManagementService'
import { statusLabel } from '@/composables/useApplicationPipeline'
import {
  filterPermits, toCsv, type ReportColumn, type ReportCriteria,
} from '@/composables/useReportBuilder'
import { BarChart3, Download, RefreshCw } from 'lucide-vue-next'

const COLUMNS: ReportColumn[] = [
  { key: 'ref',       label: 'Reference', get: p => p.dev_register_no || p.tpd_reference || p.id.slice(0, 13) },
  { key: 'applicant', label: 'Applicant', get: p => p.applicant_name || '' },
  { key: 'stand',     label: 'Stand',     get: p => p.stand_number || '' },
  { key: 'ward',      label: 'Ward',      get: p => p.suburb_ward || '' },
  { key: 'type',      label: 'Type',      get: p => (p.development_type || '').replace(/_/g, ' ') },
  { key: 'status',    label: 'Status',    get: p => statusLabel(p.status) },
  { key: 'received',  label: 'Received',  get: p => (p.received_at || p.created_at || '').slice(0, 10) },
  { key: 'fee',       label: 'Fee paid',  get: p => (p.fee_paid ? 'Yes' : 'No') },
]
const STATUS_OPTIONS = ['registered', 'acknowledged', 'circulation', 'objection_period',
  'under_review', 'deferred', 'approved', 'approved_with_conditions', 'refused', 'withdrawn']
const TYPE_OPTIONS = ['new_building', 'alteration', 'extension', 'change_of_use',
  'subdivision', 'consolidation', 'rezoning', 'other']

const permits = ref<PermitApplication[]>([])
const loading = ref(false)
const error = ref('')
const criteria = ref<ReportCriteria>({ status: 'all', development_type: 'all', ward: '', from: '', to: '', search: '' })
const selected = ref<Set<string>>(new Set(COLUMNS.map(c => c.key)))

async function load() {
  loading.value = true; error.value = ''
  try {
    const res = await dmApi.listPermits({ limit: 200, offset: 0 })
    permits.value = res.data || []
  } catch {
    error.value = 'Could not load the permit register.'
  } finally {
    loading.value = false
  }
}
onMounted(load)

const filtered = computed(() => filterPermits(permits.value, criteria.value))
const cols = computed(() => COLUMNS.filter(c => selected.value.has(c.key)))

function toggleCol(key: string) {
  const s = new Set(selected.value)
  s.has(key) ? s.delete(key) : s.add(key)
  selected.value = s
}

function exportCsv() {
  const csv = toCsv(filtered.value, cols.value)
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `vungu-permit-report-${new Date().toISOString().slice(0, 10)}.csv`
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<template>
  <div class="rb">
    <header class="rb-top">
      <div class="rb-brand"><BarChart3 :size="18" /> <span>Report builder</span></div>
      <button class="rb-refresh" :disabled="loading" @click="load">
        <RefreshCw :size="13" :class="{ spin: loading }" /> Refresh
      </button>
      <button class="rb-export" :disabled="!filtered.length" @click="exportCsv">
        <Download :size="13" /> Export CSV ({{ filtered.length }})
      </button>
    </header>

    <section class="rb-filters">
      <label>Status
        <select v-model="criteria.status">
          <option value="all">All</option>
          <option v-for="s in STATUS_OPTIONS" :key="s" :value="s">{{ statusLabel(s) }}</option>
        </select>
      </label>
      <label>Type
        <select v-model="criteria.development_type">
          <option value="all">All</option>
          <option v-for="t in TYPE_OPTIONS" :key="t" :value="t">{{ t.replace(/_/g, ' ') }}</option>
        </select>
      </label>
      <label>Ward <input v-model="criteria.ward" placeholder="contains…" /></label>
      <label>Received from <input v-model="criteria.from" type="date" /></label>
      <label>to <input v-model="criteria.to" type="date" /></label>
      <label>Search <input v-model="criteria.search" placeholder="ref / stand / applicant" /></label>
    </section>

    <section class="rb-cols">
      <span class="rb-cols-lbl">Columns:</span>
      <label v-for="c in COLUMNS" :key="c.key">
        <input type="checkbox" :checked="selected.has(c.key)" @change="toggleCol(c.key)" /> {{ c.label }}
      </label>
    </section>

    <div v-if="error" class="rb-error">{{ error }}</div>
    <div v-else-if="loading" class="rb-empty">Loading register…</div>
    <div v-else-if="!filtered.length" class="rb-empty">No applications match these criteria.</div>
    <div v-else class="rb-table-wrap">
      <table class="rb-table">
        <thead>
          <tr><th v-for="c in cols" :key="c.key">{{ c.label }}</th></tr>
        </thead>
        <tbody>
          <tr v-for="p in filtered.slice(0, 200)" :key="p.id">
            <td v-for="c in cols" :key="c.key">{{ c.get(p) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-if="filtered.length > 200" class="rb-note">Showing first 200 rows; export includes all {{ filtered.length }}.</p>
    </div>
  </div>
</template>

<style scoped>
.rb { padding:1rem 1.25rem; display:flex; flex-direction:column; gap:0.85rem; min-height:100%; background:#f1f5f9; }
.rb-top { display:flex; align-items:center; gap:0.6rem; }
.rb-brand { display:flex; align-items:center; gap:0.4rem; font-size:0.95rem; font-weight:700; color:#0f172a; flex:1; }
.rb-refresh, .rb-export { display:inline-flex; align-items:center; gap:0.3rem; font-size:0.74rem;
  padding:0.35rem 0.7rem; border:1px solid #e2e8f0; border-radius:0.4rem; background:#fff; color:#475569; cursor:pointer; }
.rb-export { background:#1d4ed8; color:#fff; border-color:#1d4ed8; font-weight:600; }
.rb-export:disabled { opacity:0.5; cursor:not-allowed; }
.spin { animation: rb-spin 1s linear infinite; }
@keyframes rb-spin { to { transform: rotate(360deg); } }

.rb-filters { display:flex; flex-wrap:wrap; gap:0.6rem; padding:0.7rem 0.85rem; background:#fff;
  border:1px solid #e2e8f0; border-radius:0.5rem; }
.rb-filters label { display:flex; flex-direction:column; gap:0.2rem; font-size:0.66rem; color:#64748b; }
.rb-filters select, .rb-filters input { padding:0.3rem 0.45rem; border:1px solid #e2e8f0; border-radius:0.35rem;
  font-size:0.74rem; color:#0f172a; }

.rb-cols { display:flex; flex-wrap:wrap; align-items:center; gap:0.75rem; padding:0 0.2rem; font-size:0.72rem; color:#475569; }
.rb-cols-lbl { font-weight:600; color:#0f172a; }
.rb-cols label { display:inline-flex; align-items:center; gap:0.25rem; }

.rb-empty, .rb-error { padding:1.5rem; text-align:center; font-size:0.78rem; color:#94a3b8;
  background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; }
.rb-error { color:#b91c1c; }

.rb-table-wrap { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:auto; }
.rb-table { width:100%; border-collapse:collapse; font-size:0.72rem; }
.rb-table th { text-align:left; padding:0.5rem 0.7rem; background:#f8fafc; border-bottom:1px solid #e2e8f0;
  color:#475569; position:sticky; top:0; white-space:nowrap; }
.rb-table td { padding:0.45rem 0.7rem; border-bottom:1px solid #f1f5f9; color:#0f172a; white-space:nowrap; }
.rb-note { margin:0; padding:0.5rem 0.7rem; font-size:0.68rem; color:#94a3b8; }
</style>
