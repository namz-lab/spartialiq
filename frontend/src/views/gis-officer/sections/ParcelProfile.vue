<script setup lang="ts">
// Parcel profile: map, identity, survey provenance, ERP status band and
// lineage. Accounts show a band and a link into the ERP, never an amount.
import { ref, computed, watch } from 'vue'
import { ArrowLeft, ExternalLink } from 'lucide-vue-next'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import GeoMiniMap from '@/components/map/GeoMiniMap.vue'
import { gmsApi, BAND_LABEL, type ParcelProfile, type StatusBand } from '@/services/gms'

const props = defineProps<{ parcelId: string }>()
defineEmits<{ close: [] }>()

const p = ref<ParcelProfile | null>(null)
const loading = ref(true)
const error = ref<'' | 'not_found' | 'failed'>('')
const mapFeatures = computed<GeoJSON.Feature[]>(() => (p.value
  ? [{ type: 'Feature', geometry: p.value.geometry, properties: { role: 'proposed' } }] : []))

const BAND_TONE: Record<StatusBand, 'positive' | 'warning' | 'neutral'> = {
  current: 'positive', in_arrears: 'warning', no_account: 'neutral', closed: 'neutral', unknown: 'neutral',
}
const CLASS_LABEL: Record<string, string> = {
  A: 'A — approved survey', B: 'B — GNSS, sub-metre', C: 'C — handheld GPS, 3–5 m', D: 'D — digitised',
}

async function load() {
  loading.value = true
  error.value = ''
  p.value = null
  try {
    p.value = await gmsApi.parcel(props.parcelId)
    loading.value = false
  } catch (e: any) {
    error.value = e?.response?.status === 404 ? 'not_found' : 'failed'
    loading.value = false
  }
}

watch(() => props.parcelId, load, { immediate: true })

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—')
</script>

<template>
  <div class="pp">
    <div class="pp-back">
      <UiButton size="sm" variant="ghost" @click="$emit('close')">
        <template #icon><ArrowLeft :size="14" aria-hidden="true" /></template>
        Parcel register
      </UiButton>
    </div>

    <p v-if="loading" class="pp-note" role="status">Loading parcel {{ parcelId }}…</p>
    <UiEmptyState v-else-if="error === 'not_found'" :message="`No parcel ${parcelId}`"
                  sub="Parcel IDs are never reused. Check the ID, or search the register." />
    <UiEmptyState v-else-if="error" message="The parcel could not be loaded">
      <template #action><UiButton size="sm" @click="load">Try again</UiButton></template>
    </UiEmptyState>

    <template v-else-if="p">
      <header class="pp-head">
        <div>
          <h2 class="pp-title">Stand <span class="pp-mono">{{ p.stand_no }}</span> · {{ p.township_code }}</h2>
          <p class="pp-sub">
            <span class="pp-mono">{{ p.parcel_id }}</span>
            <span v-if="p.status !== 'current'"> · <strong>{{ p.status }}</strong></span>
            · {{ p.allocation_status === 'allocated' ? 'Allocated' : 'Not allocated' }}
          </p>
        </div>
        <UiStatusBadge :tone="BAND_TONE[p.status_band]" :label="`ERP: ${BAND_LABEL[p.status_band]}`" />
      </header>

      <div class="pp-grid">
        <GeoMiniMap :features="mapFeatures" :label="`Map of stand ${p.stand_no}`" />

        <UiPanel title="Parcel">
          <dl class="pp-dl">
            <dt>Area</dt><dd class="pp-mono">{{ p.area_m2.toLocaleString('en-GB') }} m² · {{ p.area_ha }} ha</dd>
            <dt>Ward</dt><dd>{{ p.ward_name || p.ward_code || '—' }}</dd>
            <dt>SG reference</dt><dd class="pp-mono">{{ p.sg_ref || '—' }}</dd>
            <dt>Accuracy</dt><dd>{{ CLASS_LABEL[p.accuracy_class] }}</dd>
            <dt>Source</dt><dd>{{ p.source }}</dd>
            <dt>Custodian</dt><dd>{{ p.custodian_dept }}</dd>
            <dt>Survey CRS</dt><dd class="pp-mono">{{ p.source_crs }}</dd>
            <dt>WGS84 copy</dt>
            <dd>{{ p.transform_method || 'Captured in WGS84' }}<span v-if="p.transform_accuracy_m"> · ±{{ p.transform_accuracy_m }} m</span></dd>
            <dt>Valid from</dt><dd>{{ fmt(p.valid_from) }}<span v-if="p.valid_to"> to {{ fmt(p.valid_to) }}</span></dd>
          </dl>
        </UiPanel>
      </div>

      <UiPanel title="ERP accounts" subtitle="Status band only. Balances and bills are in the ERP.">
        <p v-if="!p.accounts.length" class="pp-note">No ERP account is linked to this parcel.</p>
        <table v-else class="pp-table">
          <thead><tr><th scope="col">Account</th><th scope="col">Link</th><th scope="col">Linked</th><th scope="col">Band</th><th scope="col">As at</th><th scope="col"><span class="ent-sr-only">Open in ERP</span></th></tr></thead>
          <tbody>
            <tr v-for="a in p.accounts" :key="a.erp_account_no">
              <td class="pp-mono">{{ a.erp_account_no }}</td>
              <td>{{ a.link_type }}</td>
              <td>{{ fmt(a.linked_on) }}</td>
              <td><UiStatusBadge :tone="BAND_TONE[a.status_band]" :label="BAND_LABEL[a.status_band]" /></td>
              <td>{{ fmt(a.as_at) }}</td>
              <td>
                <a v-if="a.erp_url" :href="a.erp_url" target="_blank" rel="noopener" class="pp-link">
                  Open in ERP <ExternalLink :size="12" aria-hidden="true" />
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </UiPanel>

      <div class="pp-grid2">
        <UiPanel title="Buildings">
          <p v-if="!p.buildings.length" class="pp-note">No buildings recorded.</p>
          <ul v-else class="pp-list">
            <li v-for="b in p.buildings" :key="b.building_id">
              <span class="pp-mono">{{ b.building_id }}</span> · {{ b.use || 'use not recorded' }}
              <span v-if="b.storeys"> · {{ b.storeys }} storey{{ b.storeys > 1 ? 's' : '' }}</span>
              · class {{ b.accuracy_class }}
            </li>
          </ul>
        </UiPanel>
        <UiPanel title="Lineage" subtitle="Subdivisions and consolidations">
          <p v-if="!p.lineage.parents.length && !p.lineage.children.length" class="pp-note">
            Created by {{ p.general_plan_ref ? `general plan ${p.general_plan_ref}` : 'an earlier record' }}; no subdivision or consolidation since.
          </p>
          <ul v-else class="pp-list">
            <li v-for="l in p.lineage.parents" :key="'p' + l.parcel_id">
              From <RouterLink class="pp-mono pp-link" :to="`/gis/parcels/${l.parcel_id}`">{{ l.parcel_id }}</RouterLink> by {{ l.event }}, {{ fmt(l.event_date) }}
            </li>
            <li v-for="l in p.lineage.children" :key="'c' + l.parcel_id">
              Into <RouterLink class="pp-mono pp-link" :to="`/gis/parcels/${l.parcel_id}`">{{ l.parcel_id }}</RouterLink> by {{ l.event }}, {{ fmt(l.event_date) }}
            </li>
          </ul>
        </UiPanel>
      </div>
    </template>
  </div>
</template>

<style scoped>
.pp { display:flex; flex-direction:column; gap:var(--ent-s4); }
.pp-back { margin-bottom:calc(var(--ent-s2) * -1); }
.pp-head { display:flex; align-items:flex-start; justify-content:space-between; gap:var(--ent-s3); flex-wrap:wrap; }
.pp-title { margin:0; font-size:var(--ent-fs-lg); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.pp-sub { margin:var(--ent-s1) 0 0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.pp-mono { font-family:var(--ent-font-mono); font-variant-numeric:tabular-nums; }
.pp-grid { display:grid; grid-template-columns:minmax(0, 3fr) minmax(280px, 2fr); gap:var(--ent-s4); }
.pp-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:var(--ent-s4); }
.pp-dl { display:grid; grid-template-columns:max-content 1fr; gap:var(--ent-s2) var(--ent-s3); margin:0; font-size:var(--ent-fs-sm); }
.pp-dl dt { color:var(--ent-text-3); }
.pp-dl dd { margin:0; color:var(--ent-text); min-width:0; overflow-wrap:anywhere; }
.pp-note { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.pp-table { width:100%; border-collapse:collapse; font-size:var(--ent-fs-sm); }
.pp-table th { text-align:left; font-weight:var(--ent-fw-medium); color:var(--ent-text-3); padding:var(--ent-s2); border-bottom:1px solid var(--ent-line); }
.pp-table td { padding:var(--ent-s2); border-bottom:1px solid var(--ent-line); }
.pp-list { margin:0; padding-left:1.1rem; display:flex; flex-direction:column; gap:var(--ent-s1); font-size:var(--ent-fs-sm); }
.pp-link { color:var(--ent-accent); display:inline-flex; align-items:center; gap:var(--ent-s1); }
@media (max-width: 1023px) {
  .pp-grid, .pp-grid2 { grid-template-columns:1fr; }
  .pp-table { display:block; overflow-x:auto; }
}
</style>
