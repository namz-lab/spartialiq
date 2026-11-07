<script setup lang="ts">
// Parcel register (GMS phase 1): branch KPIs, search across parcel ID, stand,
// township, ERP account and ward, and the parcel profile when a parcel is
// open (/gis/parcels/:parcelId). Money is never shown: a status band and a
// link into the ERP.
import { ref, onMounted, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search, RefreshCw } from 'lucide-vue-next'
import UiKpi from '@/components/ui/UiKpi.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import ParcelProfile from './ParcelProfile.vue'
import { gmsApi, BAND_LABEL, type Dashboard, type ParcelRow, type StatusBand } from '@/services/gms'

const props = defineProps<{ parcelId?: string }>()
const router = useRouter()

const kpi = ref<Dashboard | null>(null)
const rows = ref<ParcelRow[]>([])
const loading = ref(false)
const error = ref('')
const searched = ref(false)
const form = ref({ q: '', township: '', account: '', ward: '' })

const BAND_TONE: Record<StatusBand, 'positive' | 'warning' | 'neutral' | 'negative'> = {
  current: 'positive', in_arrears: 'warning', no_account: 'neutral', closed: 'neutral', unknown: 'neutral',
}

const columns = [
  { key: 'parcel_id', label: 'Parcel ID', mono: true, sortable: true },
  { key: 'stand_no', label: 'Stand', mono: true, sortable: true },
  { key: 'township_code', label: 'Township', sortable: true },
  { key: 'ward_code', label: 'Ward', hideOnMobile: true },
  { key: 'area_m2', label: 'Area m²', align: 'right', mono: true, sortable: true },
  { key: 'accuracy_class', label: 'Class', align: 'center', hideOnMobile: true },
  { key: 'status', label: 'Status', capitalize: true, hideOnMobile: true },
  { key: 'status_band', label: 'ERP band' },
]

async function loadKpis() {
  try { kpi.value = await gmsApi.dashboard() } catch { kpi.value = null }
}

async function search() {
  loading.value = true
  error.value = ''
  try {
    const f = form.value
    rows.value = await gmsApi.parcels({
      q: f.q.trim() || undefined,
      township: f.township.trim() || undefined,
      account: f.account.trim() || undefined,
      ward: f.ward.trim() || undefined,
      limit: 200,
    })
    searched.value = true
  } catch (e: any) {
    error.value = e?.response?.data?.message || 'The register could not be searched. Try again.'
  } finally {
    loading.value = false
  }
}

const open = (row: ParcelRow) => router.push(`/gis/parcels/${encodeURIComponent(row.parcel_id)}`)
const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 100)} %`)

onMounted(() => { loadKpis(); search() })
// Coming back from a profile refreshes the numbers the profile may have changed.
watch(() => props.parcelId, (id) => { if (!id) loadKpis() })
</script>

<template>
  <div class="reg">
    <ParcelProfile v-if="parcelId" :parcel-id="parcelId" @close="router.push('/gis/parcels')" />

    <template v-else>
      <section class="reg-kpis" aria-label="Register indicators">
        <UiKpi :value="kpi ? kpi.parcels : '—'" label="Current parcels" />
        <UiKpi :value="kpi ? pct(kpi.linked_share) : '—'" label="Linked to an ERP account" tone="info" />
        <UiKpi :value="kpi ? kpi.open_reconciliation : '—'" label="Open reconciliation items"
               :tone="kpi && kpi.open_reconciliation ? 'warning' : 'neutral'" />
        <UiKpi :value="kpi ? kpi.failed_events : '—'" label="Failed ERP events"
               :tone="kpi && kpi.failed_events ? 'negative' : 'neutral'" />
      </section>

      <UiPanel title="Find a parcel" subtitle="Parcel ID, stand number or SG reference; narrow by township, ERP account or ward">
        <form class="reg-form" role="search" @submit.prevent="search">
          <label class="reg-field reg-grow">
            <span>Search</span>
            <input v-model="form.q" type="search" placeholder="P-0000123, 142, SG 1/2026" autocomplete="off" />
          </label>
          <label class="reg-field">
            <span>Township</span>
            <input v-model="form.township" type="text" placeholder="TSAMBA-GP" autocomplete="off" />
          </label>
          <label class="reg-field">
            <span>ERP account</span>
            <input v-model="form.account" type="text" autocomplete="off" />
          </label>
          <label class="reg-field">
            <span>Ward</span>
            <input v-model="form.ward" type="text" autocomplete="off" />
          </label>
          <UiButton type="submit" variant="primary" :loading="loading">
            <template #icon><Search :size="14" aria-hidden="true" /></template>
            Search
          </UiButton>
        </form>
      </UiPanel>

      <p v-if="error" class="reg-error" role="alert">
        {{ error }}
        <UiButton size="sm" variant="ghost" @click="search">
          <template #icon><RefreshCw :size="12" aria-hidden="true" /></template>Retry
        </UiButton>
      </p>

      <UiPanel :title="searched ? `${rows.length} parcel${rows.length === 1 ? '' : 's'}` : 'Parcels'" flush>
        <UiDataTable
          :columns="columns" :rows="rows" row-key="parcel_id" :loading="loading" clickable dense
          empty-message="No parcel matches. Parcels enter the register through an approved Survey Section import."
          mobile-primary="stand_no" mobile-secondary="parcel_id" mobile-status="status_band"
          @row-click="open"
        >
          <template #cell-area_m2="{ value }">{{ Number(value).toLocaleString('en-GB') }}</template>
          <template #cell-status_band="{ value }">
            <UiStatusBadge :tone="BAND_TONE[value as StatusBand]" :label="BAND_LABEL[value as StatusBand]" />
          </template>
        </UiDataTable>
      </UiPanel>
    </template>
  </div>
</template>

<style scoped>
.reg { display:flex; flex-direction:column; gap:var(--ent-s4); padding:var(--ent-s4); max-width:1400px; }
.reg-kpis { display:grid; grid-template-columns:repeat(auto-fit, minmax(180px, 1fr)); gap:var(--ent-s3); }
.reg-form { display:flex; flex-wrap:wrap; align-items:flex-end; gap:var(--ent-s3); }
.reg-field { display:flex; flex-direction:column; gap:var(--ent-s1); min-width:140px; flex:1 1 140px;
  font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-medium); color:var(--ent-text-2); }
.reg-grow { flex:2 1 240px; }
.reg-field input { height:var(--ent-control-h); padding:0 var(--ent-control-px); font:inherit;
  font-size:var(--ent-fs-sm); color:var(--ent-text); background:var(--ent-surface);
  border:1px solid var(--ent-line-strong); border-radius:var(--ent-r-sm); }
.reg-error { display:flex; align-items:center; gap:var(--ent-s2); margin:0; padding:var(--ent-s2) var(--ent-s3);
  color:var(--ent-danger); background:var(--ent-danger-soft); border-radius:var(--ent-r-sm);
  font-size:var(--ent-fs-sm); }
</style>
