<script setup lang="ts">
// Abutting owners — PostGIS parcels within 100 m of the subject stand
// (ST_DWithin), used for Section 26(3) registered-post notification.

import { ref } from 'vue'
import { findParcels, parcelsNearby, type FoundParcel, type NearbyParcel } from '@/services/parcels'
import { isPersonName, sanitizeInteger } from '@/utils/citizenValidation'
import { useGISOfficerWorkspace } from '@/composables/useGISOfficerWorkspace'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import { Users, Search, FileDown, Send } from 'lucide-vue-next'

const gis = useGISOfficerWorkspace()
const fb = useUiFeedback()

const stand = ref('')
const requestedBy = ref('EO Planner')
const loading = ref(false)
const subject = ref<FoundParcel | null>(null)
const abutters = ref<NearbyParcel[]>([])
const radiusM = ref(100)
const lookedUp = ref(false)

async function lookup() {
  const q = stand.value.trim()
  if (!q) {
    fb.showToast('Enter a stand number first.', 'warning')
    return
  }
  loading.value = true
  lookedUp.value = true
  subject.value = null
  abutters.value = []
  try {
    const found = await findParcels(q)
    const site = found[0] || null
    subject.value = site
    if (!site?.centroid) {
      fb.showToast('That stand is not in the cadastre, so abutters cannot be computed.', 'warning')
      return
    }
    const [lng, lat] = site.centroid
    const r = Math.min(2000, Math.max(50, Number(sanitizeInteger(String(radiusM.value))) || 100))
    radiusM.value = r
    const nearby = await parcelsNearby(lng, lat, r)
    abutters.value = nearby.parcels.filter(p =>
      p.stand_number.toLowerCase() !== site.stand_number.toLowerCase())
  } catch (err: any) {
    fb.showToast(fb.parseApiError(err, 'Could not query abutting parcels'), 'error')
  } finally {
    loading.value = false
  }
}

function exportList() {
  if (!abutters.value.length) {
    fb.showToast('No abutters to export.', 'warning')
    return
  }
  const lines = [
    `Abutting-owner list for Stand ${subject.value?.stand_number || stand.value}`,
    `Generated: ${new Date().toLocaleString('en-GB')}`,
    `Requested by: ${requestedBy.value}`,
    `Radius: ${radiusM.value} m (PostGIS ST_DWithin)`,
    '',
    'Stand No.\tDistrict\tArea (ha)\tDistance (m)',
    ...abutters.value.map(a =>
      `${a.stand_number}\t${a.status || '—'}\t${a.area_ha ?? '—'}\t${a.dist_m}`),
  ]
  const blob = new Blob([lines.join('\n')], { type:'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `abutters-${stand.value}.txt`
  a.click()
  URL.revokeObjectURL(url)
  fb.showToast('Abutter list downloaded.', 'success')
}

function logRequest() {
  if (!stand.value.trim()) {
    fb.showToast('Enter a stand number first.', 'warning')
    return
  }
  if (!isPersonName(requestedBy.value) && requestedBy.value.trim()) {
    fb.showToast('Requested-by must be a person’s name, or left blank.', 'warning')
    return
  }
  gis.addRequest({
    request_type:'abutting_owners',
    permit_application_id: null,
    stand_number: stand.value.trim(),
    requested_by: requestedBy.value.trim() || 'GIS Officer',
    requested_at: new Date().toISOString(),
    status:'completed',
    delivered_at: new Date().toISOString(),
    output_url:'',
    notes:`${abutters.value.length} abutter(s) identified within ${radiusM.value} m`,
  })
  fb.showToast('Request logged in the GIS request register.', 'success')
}
</script>

<template>
  <div class="ab">
    <header class="ab-head">
      <Users :size="14" />
      <h2>Abutting owners</h2>
      <span class="ab-sub">Section 26(3) · parcels within {{ radiusM }} m</span>
    </header>

    <section class="ab-input">
      <div class="ab-search">
        <Search :size="12" />
        <input v-model="stand" placeholder="Stand number"
               @keydown.enter.prevent="lookup" />
      </div>
      <input v-model.number="radiusM" type="number" min="50" max="2000" step="50"
             class="ab-by" aria-label="Search radius in metres" title="Radius (m)" />
      <input v-model="requestedBy" placeholder="Requested by" class="ab-by" />
      <button type="button" class="ab-btn primary" @click="lookup" :disabled="loading">
        {{ loading ? 'Searching…' : 'Find abutters' }}
      </button>
      <button type="button" class="ab-btn ghost" @click="exportList" :disabled="!abutters.length">
        <FileDown :size="11" /> Export
      </button>
      <button type="button" class="ab-btn ghost" @click="logRequest">
        <Send :size="11" /> Log request
      </button>
    </section>

    <section v-if="subject" class="ab-subject">
      <h4>Subject stand</h4>
      <p><strong>Stand {{ subject.stand_number }}</strong>
         · {{ subject.district || '—' }}
         · {{ subject.area_ha != null ? subject.area_ha + ' ha' : 'area unknown' }}</p>
    </section>
    <section v-else-if="lookedUp && !loading && !subject" class="ab-warn">
      Stand <strong>{{ stand }}</strong> is not in the cadastre. Check the spelling, or ask the Surveyor to register it.
    </section>

    <section class="ab-results">
      <header><strong>Abutting properties</strong>
        <span class="ab-sub-r">{{ abutters.length }} identified</span></header>
      <div v-if="!lookedUp" class="ab-empty">Enter a stand number and find abutters. The list comes from the cadastre, not a guess.</div>
      <div v-else-if="loading" class="ab-empty">Querying parcels within {{ radiusM }} m…</div>
      <div v-else-if="!abutters.length" class="ab-empty">No other parcels sit within {{ radiusM }} m of this stand.</div>
      <table v-else class="ab-table">
        <thead><tr><th>Stand</th><th>Status</th><th>Area (ha)</th><th>Distance (m)</th></tr></thead>
        <tbody>
          <tr v-for="a in abutters" :key="a.fid">
            <td><strong>{{ a.stand_number }}</strong></td>
            <td>{{ a.status || '—' }}</td>
            <td>{{ a.area_ha ?? '—' }}</td>
            <td>{{ a.dist_m }}</td>
          </tr>
        </tbody>
      </table>
      <p class="ab-note">
        Distances are measured on the live cadastre (PostGIS). Land-register owners appear on the
        site-inspector map when the parcel has a title record; copy this list into the planner’s
        Section 26(3) notice pack.
      </p>
    </section>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.ab { padding:1rem 1.25rem; display:flex; flex-direction:column; gap:0.85rem; height:100%; overflow-y:auto; }
.ab-head { display:flex; align-items:center; gap:0.4rem; }
.ab-head h2 { margin:0; font-size:0.95rem; font-weight:700; }
.ab-sub { color:#94a3b8; font-size:0.7rem; margin-left:auto; }
.ab-sub-r { color:#94a3b8; font-size:0.65rem; font-weight:400; margin-left:auto; }

.ab-input { display:flex; align-items:center; gap:0.45rem; flex-wrap:wrap; }
.ab-search { display:flex; align-items:center; gap:0.3rem; flex:1; min-width:14rem;
  padding:0.4rem 0.55rem; background:#fff; border:1px solid #e2e8f0; border-radius:0.3rem; }
.ab-search input { flex:1; border:none; outline:none; font-size:0.72rem; }
.ab-by { padding:0.4rem 0.55rem; border:1px solid #e2e8f0; border-radius:0.3rem; font-size:0.7rem; min-width:10rem; }
.ab-btn { display:inline-flex; align-items:center; gap:0.3rem;
  padding:0.4rem 0.75rem; border:1px solid #e2e8f0; border-radius:0.3rem;
  background:#fff; color:#475569; font-size:0.66rem; font-weight:600; cursor:pointer; }
.ab-btn.primary { background:var(--ent-accent); color:#fff; border-color:var(--ent-accent); }
.ab-btn.primary:hover:not(:disabled) { background:var(--ent-accent-hover); }
.ab-btn.primary:disabled { background:#cbd5e1; cursor:not-allowed; }
.ab-btn.ghost { background:#fff; }

.ab-subject { background:var(--ent-accent-soft); border:1px solid var(--ent-accent-line); border-radius:0.4rem;
  padding:0.65rem 0.85rem; }
.ab-subject h4 { margin:0 0 0.25rem; font-size:0.65rem; color:var(--ent-accent); text-transform:uppercase;
  letter-spacing:0.05em; font-weight:700; }
.ab-subject p { margin:0; font-size:0.75rem; color:var(--ent-text); }

.ab-warn { padding:0.65rem 0.85rem; background:var(--ent-warn-soft, #fef3c7);
  border-radius:0.25rem; font-size:0.7rem; color:#92400e; }

.ab-results { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:hidden; }
.ab-results > header { display:flex; align-items:center; gap:0.4rem;
  padding:0.55rem 0.85rem; background:#f8fafc; border-bottom:1px solid #e2e8f0;
  font-size:0.75rem; color:#0f172a; }
.ab-empty { padding:1.5rem; text-align:center; color:#94a3b8; font-size:0.72rem; }

.ab-table { width:100%; border-collapse:collapse; font-size:0.7rem; }
.ab-table th, .ab-table td { padding:0.45rem 0.85rem; text-align:left; border-bottom:1px solid #f1f5f9; }
.ab-table th { font-size:0.58rem; color:#94a3b8; text-transform:uppercase; letter-spacing:0.04em;
  background:#fafbfc; }
.ab-table strong { color:var(--ent-accent); font-family: ui-monospace, monospace; }

.ab-note { margin:0.65rem 0.85rem 0.85rem; padding:0.55rem 0.75rem; font-size:0.62rem;
  color:#64748b; background:#f8fafc; border-radius:0.25rem; line-height:1.5; }
.ab-note code { font-family: ui-monospace, monospace; background:#e2e8f0; padding:0 0.25rem; border-radius:0.2rem; }
</style>
