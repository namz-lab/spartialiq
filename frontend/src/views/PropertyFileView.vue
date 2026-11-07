<script setup lang="ts">
// Property File — the parcel-centric "land register" dossier (TownSuite-style):
// one place to see a stand's record, owners, zoning-designation history,
// existing uses, and every application/permit on it.
//
// Data sourcing:
//   • Applications & permits on the parcel → dmApi (live).
//   • Cadastre hit → /api/parcels/find + /api/stands (live lookup, no fake geometry).
//   • Property register → /api/properties/:standNo/* (migration 084). Empty
//     fields mean "no register row yet"; registerUnavailable means the API failed.
import { ref, computed, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { dmApi, type PermitApplication } from '@/services/developmentManagementService'
import { statusLabel } from '@/composables/useApplicationPipeline'
import {
  propertyService, type PropertySummary, type PropertyOwner,
  type ZoningDesignation, type ExistingUse, type ParcelLineage, type PropertyAssessment,
} from '@/services/propertyService'
import { findParcels, type FoundParcel } from '@/services/parcels'
import { standsService, type StandProperties } from '@/services/standsService'
import {
  Building2, Search, Users, Map as MapIcon, FileText, History,
  Landmark, AlertTriangle, RefreshCw, ArrowRight, GitBranch, Coins, MapPin,
} from 'lucide-vue-next'

const route = useRoute()
const router = useRouter()

const standNo = computed(() => (route.params.standNo as string | undefined) || '')
const searchInput = ref('')

const summary = ref<PropertySummary | null>(null)
const owners = ref<PropertyOwner[]>([])
const designations = ref<ZoningDesignation[]>([])
const uses = ref<ExistingUse[]>([])
const lineage = ref<ParcelLineage | null>(null)
const assessment = ref<PropertyAssessment | null>(null)
const permits = ref<PermitApplication[]>([])
const cadastreHit = ref<FoundParcel | null>(null)
const standHit = ref<StandProperties | null>(null)
const loading = ref(false)
const registerUnavailable = ref(false)
const cadastreUnavailable = ref(false)

function openStand() {
  const s = searchInput.value.trim()
  if (s) router.push({ name: 'property-file', params: { standNo: s } })
}

function openPermit(p: PermitApplication) {
  router.push({
    name: 'planner',
    query: { pane: 'console', section: 'register', case: p.id },
  })
}

function developmentTypeLabel(p: PermitApplication): string {
  const t = p.development_type
  if (!t) return '—'
  return String(t).replace(/_/g, ' ')
}

async function loadCadastre(stand: string) {
  cadastreUnavailable.value = false
  cadastreHit.value = null
  standHit.value = null
  try {
    const parcels = await findParcels(stand)
    const exact = parcels.find(p =>
      (p.stand_number || '').trim().toLowerCase() === stand.trim().toLowerCase(),
    )
    cadastreHit.value = exact || parcels[0] || null
  } catch {
    cadastreUnavailable.value = true
  }
  try {
    const col = await standsService.list({
      q: stand,
      status: ['available', 'reserved', 'allocated', 'withdrawn'],
    })
    const features = col.features || []
    const match = features.find(f =>
      (f.properties?.standNumber || '').trim().toLowerCase() === stand.trim().toLowerCase(),
    )
    standHit.value = (match || features[0])?.properties || null
  } catch {
    /* stands feed optional — parcels find is enough */
  }
}

async function load(stand: string) {
  if (!stand) return
  loading.value = true
  registerUnavailable.value = false
  // Live data: applications & permits on this parcel.
  try {
    const res = await dmApi.listPermits({ search: stand, limit: 100 })
    permits.value = (res.data || []).filter(p => (p.stand_number || '').trim() === stand.trim())
  } catch {
    permits.value = []
  }
  await loadCadastre(stand)
  // Property register (backend migration 084). Failures → unavailable banner;
  // successful empty payloads → honest empty fields (never fabricate deeds).
  try {
    const [s, o, z, u, lin, asmt] = await Promise.all([
      propertyService.getSummary(stand),
      propertyService.listOwners(stand),
      propertyService.listZoningDesignations(stand),
      propertyService.listExistingUses(stand),
      propertyService.getLineage(stand),
      propertyService.getAssessment(stand),
    ])
    summary.value = s; owners.value = o; designations.value = z; uses.value = u
    lineage.value = lin; assessment.value = asmt
  } catch {
    summary.value = null; owners.value = []; designations.value = []; uses.value = []
    lineage.value = null; assessment.value = null
    registerUnavailable.value = true
  }
  loading.value = false
}

watch(standNo, (s) => { searchInput.value = s; if (s) load(s) }, { immediate: true })

const ward = computed(() =>
  summary.value?.ward
  || standHit.value?.ward
  || cadastreHit.value?.district
  || permits.value[0]?.suburb_ward
  || '—',
)
const address = computed(() => summary.value?.address || null)
const areaLabel = computed(() => {
  if (summary.value?.area_sqm != null) return `${summary.value.area_sqm} m²`
  if (standHit.value?.areaSqm != null) return `${standHit.value.areaSqm} m²`
  if (cadastreHit.value?.area_ha != null) return `${cadastreHit.value.area_ha} ha`
  return null
})

function fmt(d: string | null | undefined): string {
  if (!d) return '—'
  const x = new Date(d)
  return isNaN(x.getTime()) ? '—' : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function heritageFlags(h: PropertySummary['heritage']): string[] {
  if (!h) return []
  const out: string[] = []
  if (h.conservation_district) out.push('Heritage conservation district')
  if (h.municipally_designated) out.push('Municipally designated')
  if (h.provincially_designated) out.push('Nationally designated')
  return out
}

const emptyRegister = 'No register data loaded for this stand.'
</script>

<template>
  <div class="pf">
    <header class="pf-top">
      <div class="pf-brand"><Building2 :size="18" /> <span>Property File</span></div>
      <form class="pf-search" @submit.prevent="openStand">
        <Search :size="14" />
        <input v-model="searchInput" placeholder="Enter stand / erf number…" />
        <button type="submit">Open</button>
      </form>
      <button v-if="standNo" class="pf-refresh" :disabled="loading" @click="load(standNo)">
        <RefreshCw :size="13" :class="{ spin: loading }" />
      </button>
    </header>

    <!-- No stand selected -->
    <div v-if="!standNo" class="pf-prompt">
      <Building2 :size="28" />
      <h2>Open a property file</h2>
      <p>Enter a stand / erf number above to see its record, owners, zoning history,
         existing uses and every application lodged against it.</p>
    </div>

    <div v-else class="pf-body">
      <header class="pf-head">
        <div>
          <h1>Stand {{ standNo }}</h1>
          <p>{{ ward }}<template v-if="address"> · {{ address }}</template></p>
        </div>
        <RouterLink class="pf-maplink" :to="{ name: 'gis-map', query: { stand: standNo } }">
          <MapIcon :size="13" /> View on map
        </RouterLink>
      </header>

      <div v-if="cadastreHit || standHit" class="pf-cadastre">
        <MapPin :size="14" />
        <div>
          <strong>Cadastre</strong>
          <span>
            <template v-if="cadastreHit">Matched stand {{ cadastreHit.stand_number }}</template>
            <template v-if="standHit">
              <template v-if="cadastreHit"> · </template>
              Council stands register: {{ standHit.status }}
              <template v-if="standHit.zoneType"> · {{ standHit.zoneType }}</template>
            </template>
            <template v-if="areaLabel"> · {{ areaLabel }}</template>
          </span>
        </div>
      </div>
      <div v-else-if="cadastreUnavailable" class="pf-banner pf-banner--muted">
        <AlertTriangle :size="14" />
        <div>
          <strong>Cadastre lookup unavailable</strong>
          <span>Could not reach <code>/api/parcels</code> or <code>/api/stands</code>. Permits below still load when the planning API is up.</span>
        </div>
      </div>
      <div v-else-if="!loading" class="pf-banner pf-banner--muted">
        <MapPin :size="14" />
        <div>
          <strong>Stand not found in cadastre</strong>
          <span>No parcel or stands-register match for this number. Import or create the stand in GIS / stands before relying on geometry.</span>
        </div>
      </div>

      <div v-if="registerUnavailable" class="pf-banner">
        <AlertTriangle :size="14" />
        <div>
          <strong>Land register could not be loaded</strong>
          <span>Owners, zoning designations, heritage status and assessments use
            <code>/api/properties</code>. The request failed (auth, network, or migration 084 not applied).
            Applications &amp; permits below are independent and still load when available.</span>
        </div>
      </div>

      <div class="pf-grid">
        <!-- Property record -->
        <section class="pf-card">
          <header><FileText :size="13" /> <strong>Property record</strong></header>
          <dl v-if="summary" class="pf-dl">
            <dt>AAN</dt><dd>{{ summary.aan || '—' }}</dd>
            <dt>PID</dt><dd>{{ summary.pid || '—' }}</dd>
            <dt>Area</dt><dd>{{ summary.area_sqm != null ? summary.area_sqm + ' m²' : (areaLabel || '—') }}</dd>
            <dt>Frontage</dt><dd>{{ summary.frontage_m != null ? summary.frontage_m + ' m' : (standHit?.frontageM != null ? standHit.frontageM + ' m' : '—') }}</dd>
            <dt>Units</dt><dd>{{ summary.units ?? '—' }}</dd>
            <dt>Dwellings</dt><dd>{{ summary.dwellings ?? '—' }}</dd>
            <dt>Corner lot</dt><dd>{{ summary.corner_lot ? 'Yes' : 'No' }}</dd>
            <dt>Follow-up</dt><dd>{{ fmt(summary.follow_up_date) }}</dd>
          </dl>
          <p v-else class="pf-empty">{{ registerUnavailable ? emptyRegister : 'No property register row for this stand yet.' }}</p>
        </section>

        <!-- Heritage -->
        <section class="pf-card">
          <header><Landmark :size="13" /> <strong>Heritage status</strong></header>
          <ul v-if="summary && heritageFlags(summary.heritage).length" class="pf-flags">
            <li v-for="f in heritageFlags(summary.heritage)" :key="f">{{ f }}</li>
          </ul>
          <p v-else class="pf-empty">{{ registerUnavailable ? emptyRegister : 'No heritage designation on file.' }}</p>
        </section>

        <!-- Owners -->
        <section class="pf-card">
          <header><Users :size="13" /> <strong>Owners &amp; occupiers</strong></header>
          <ul v-if="owners.length" class="pf-list">
            <li v-for="o in owners" :key="o.id">
              <span class="pf-owner-name">{{ o.company || o.name }}</span>
              <span class="pf-owner-role">{{ o.role }}</span>
              <span v-if="o.postal_address" class="pf-owner-addr">{{ o.postal_address }}</span>
            </li>
          </ul>
          <p v-else class="pf-empty">{{ registerUnavailable ? emptyRegister : 'No owners recorded for this stand.' }}</p>
        </section>

        <!-- Zoning designations -->
        <section class="pf-card">
          <header><History :size="13" /> <strong>Zoning designations</strong></header>
          <ul v-if="designations.length" class="pf-list">
            <li v-for="z in designations" :key="z.id">
              <span class="pf-zone">{{ z.designation }}</span>
              <span class="pf-zone-date">eff. {{ fmt(z.effective_date) }}</span>
              <span v-if="z.reference" class="pf-zone-ref">{{ z.reference }}</span>
            </li>
          </ul>
          <p v-else class="pf-empty">{{ registerUnavailable ? emptyRegister : 'No designation history on file.' }}</p>
        </section>

        <!-- Existing uses -->
        <section class="pf-card">
          <header><FileText :size="13" /> <strong>Existing uses</strong></header>
          <ul v-if="uses.length" class="pf-list">
            <li v-for="u in uses" :key="u.id">
              <span>{{ u.use }}</span>
              <span class="pf-use-date">{{ fmt(u.recorded_at) }}</span>
            </li>
          </ul>
          <p v-else class="pf-empty">{{ registerUnavailable ? emptyRegister : 'No existing uses recorded.' }}</p>
        </section>

        <!-- Assessment / rates -->
        <section class="pf-card">
          <header><Coins :size="13" /> <strong>Assessment &amp; rates</strong></header>
          <dl v-if="assessment" class="pf-dl">
            <dt>AAN</dt><dd>{{ assessment.aan || '—' }}</dd>
            <dt>Roll no.</dt><dd>{{ assessment.roll_number || '—' }}</dd>
            <dt>Valuation</dt><dd>{{ assessment.valuation != null ? 'USD ' + assessment.valuation.toLocaleString() : '—' }}</dd>
            <dt>Rateable value</dt><dd>{{ assessment.rateable_value != null ? 'USD ' + assessment.rateable_value.toLocaleString() : '—' }}</dd>
            <dt>Rates balance</dt><dd :class="{ 'pf-due': (assessment.rates_balance ?? 0) > 0 }">{{ assessment.rates_balance != null ? 'USD ' + assessment.rates_balance.toLocaleString() : '—' }}</dd>
            <dt>Last paid</dt><dd>{{ fmt(assessment.last_paid_at) }}</dd>
          </dl>
          <p v-else class="pf-empty">{{ registerUnavailable ? emptyRegister : 'No assessment on file.' }}</p>
        </section>

        <!-- Subdivision / consolidation lineage -->
        <section class="pf-card">
          <header><GitBranch :size="13" /> <strong>Parcel lineage</strong></header>
          <div v-if="lineage && (lineage.parent || lineage.children.length)" class="pf-lineage">
            <p v-if="lineage.parent" class="pf-line">
              <span class="pf-line-lbl">Created from</span> Stand {{ lineage.parent.stand_number }}
              <template v-if="lineage.action"> ({{ lineage.action }})</template>
            </p>
            <p v-if="lineage.children.length" class="pf-line-lbl">
              {{ lineage.action === 'consolidation' ? 'Consolidated stands' : 'Resulting lots' }}
            </p>
            <ul v-if="lineage.children.length" class="pf-list">
              <li v-for="c in lineage.children" :key="c.stand_number">
                <RouterLink :to="{ name:'property-file', params:{ standNo: c.stand_number } }" class="pf-childlink">
                  Stand {{ c.stand_number }}
                </RouterLink>
                <span class="pf-use-date">{{ fmt(c.created_at) }}</span>
              </li>
            </ul>
          </div>
          <p v-else class="pf-empty">{{ registerUnavailable ? emptyRegister : 'No subdivision / consolidation history.' }}</p>
        </section>

        <!-- Applications & permits (LIVE) -->
        <section class="pf-card pf-wide">
          <header>
            <FileText :size="13" /> <strong>Applications &amp; permits on this parcel</strong>
            <span class="pf-card-sub">{{ permits.length }} on register · live</span>
          </header>
          <p v-if="loading" class="pf-empty">Loading…</p>
          <p v-else-if="!permits.length" class="pf-empty">No applications lodged against this stand.</p>
          <ul v-else class="pf-permits">
            <li v-for="p in permits" :key="p.id" @click="openPermit(p)">
              <span class="pf-permit-ref">{{ p.dev_register_no || p.tpd_reference || p.id.slice(0, 13) }}</span>
              <span class="pf-permit-type">{{ developmentTypeLabel(p) }}</span>
              <span class="pf-permit-app">{{ p.applicant_name }}</span>
              <span class="pf-permit-status">{{ statusLabel(p.status) }}</span>
              <span class="pf-permit-date">{{ fmt(p.received_at || p.created_at) }}</span>
              <ArrowRight :size="13" class="pf-permit-arrow" />
            </li>
          </ul>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pf { padding:1rem 1.25rem; display:flex; flex-direction:column; gap:1rem; min-height:100%; background:#f1f5f9; }
.pf-top { display:flex; align-items:center; gap:0.75rem; }
.pf-brand { display:flex; align-items:center; gap:0.4rem; font-size:0.95rem; font-weight:700; color:#0f172a; }
.pf-search { display:flex; align-items:center; gap:0.4rem; margin-left:1rem; padding:0.3rem 0.6rem;
  background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; flex:1; max-width:30rem; }
.pf-search input { flex:1; border:none; outline:none; font-size:0.8rem; background:transparent; color:#0f172a; }
.pf-search button { border:none; background:#1d4ed8; color:#fff; font-size:0.72rem; font-weight:600;
  padding:0.25rem 0.7rem; border-radius:0.35rem; cursor:pointer; }
.pf-refresh { display:inline-flex; width:1.9rem; height:1.9rem; align-items:center; justify-content:center;
  border:1px solid #e2e8f0; border-radius:0.4rem; background:#fff; color:#475569; cursor:pointer; }
.spin { animation: pf-spin 1s linear infinite; }
@keyframes pf-spin { to { transform: rotate(360deg); } }

.pf-prompt { margin:auto; text-align:center; color:#94a3b8; max-width:26rem; }
.pf-prompt svg { color:#cbd5e1; }
.pf-prompt h2 { margin:0.5rem 0 0.25rem; font-size:1rem; color:#475569; }
.pf-prompt p { margin:0; font-size:0.8rem; line-height:1.5; }

.pf-head { display:flex; align-items:flex-start; gap:0.75rem; }
.pf-head h1 { margin:0; font-size:1.1rem; font-weight:800; color:#0f172a; }
.pf-head p { margin:0.1rem 0 0; font-size:0.78rem; color:#64748b; }
.pf-maplink { margin-left:auto; display:inline-flex; align-items:center; gap:0.3rem; font-size:0.72rem;
  font-weight:600; color:#1d4ed8; text-decoration:none; padding:0.3rem 0.6rem; border:1px solid #bfdbfe;
  border-radius:0.4rem; background:#eff6ff; }

.pf-banner { display:flex; gap:0.5rem; padding:0.7rem 0.9rem; background:#fffbeb; border:1px solid #fde68a;
  border-radius:0.5rem; color:#92400e; }
.pf-banner--muted { background:#f8fafc; border-color:#e2e8f0; color:#475569; }
.pf-banner strong { display:block; font-size:0.78rem; }
.pf-banner span { display:block; font-size:0.7rem; line-height:1.5; margin-top:0.15rem; }
.pf-banner code { background:#fef3c7; padding:0 0.25rem; border-radius:0.2rem; font-size:0.66rem; }
.pf-banner--muted code { background:#e2e8f0; }

.pf-cadastre { display:flex; gap:0.5rem; padding:0.7rem 0.9rem; background:#eff6ff; border:1px solid #bfdbfe;
  border-radius:0.5rem; color:#1e3a8a; }
.pf-cadastre strong { display:block; font-size:0.78rem; }
.pf-cadastre span { display:block; font-size:0.7rem; line-height:1.5; margin-top:0.15rem; }

.pf-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(280px, 1fr)); gap:0.75rem; }
.pf-card { background:#fff; border:1px solid #e2e8f0; border-radius:0.5rem; overflow:hidden;
  display:flex; flex-direction:column; }
.pf-card.pf-wide { grid-column:1 / -1; }
.pf-card > header { display:flex; align-items:center; gap:0.4rem; padding:0.55rem 0.85rem;
  background:#f8fafc; border-bottom:1px solid #e2e8f0; font-size:0.76rem; color:#0f172a; }
.pf-card-sub { margin-left:auto; font-weight:400; color:#94a3b8; font-size:0.66rem; }
.pf-empty { padding:1rem; color:#94a3b8; font-size:0.74rem; text-align:center; margin:0; }

.pf-dl { display:grid; grid-template-columns:auto 1fr; gap:0.3rem 0.75rem; margin:0; padding:0.75rem 0.9rem; }
.pf-dl dt { font-size:0.68rem; color:#94a3b8; }
.pf-dl dd { margin:0; font-size:0.74rem; font-weight:600; color:#0f172a; text-align:right; }

.pf-flags { list-style:none; margin:0; padding:0.75rem 0.9rem; display:flex; flex-direction:column; gap:0.3rem; }
.pf-flags li { font-size:0.74rem; font-weight:600; color:#92400e; background:#fef3c7;
  padding:0.25rem 0.5rem; border-radius:0.3rem; }

.pf-list { list-style:none; margin:0; padding:0.4rem 0; }
.pf-list li { display:flex; flex-wrap:wrap; gap:0.4rem; align-items:center; padding:0.4rem 0.9rem;
  border-top:1px solid #f1f5f9; font-size:0.74rem; }
.pf-list li:first-child { border-top:none; }
.pf-owner-name, .pf-zone { font-weight:600; color:#0f172a; }
.pf-owner-role { font-size:0.62rem; text-transform:uppercase; letter-spacing:0.04em; color:#1d4ed8; }
.pf-owner-addr, .pf-zone-ref, .pf-zone-date, .pf-use-date { color:#94a3b8; font-size:0.68rem; }
.pf-zone-date { margin-left:auto; }
.pf-use-date { margin-left:auto; }
.pf-due { color:#b91c1c; }
.pf-lineage { padding:0.6rem 0.9rem; }
.pf-line { margin:0 0 0.35rem; font-size:0.74rem; color:#0f172a; }
.pf-line-lbl { font-size:0.62rem; text-transform:uppercase; letter-spacing:0.04em; color:#94a3b8; margin:0 0 0.25rem; }
.pf-childlink { font-weight:600; color:#1d4ed8; text-decoration:none; }
.pf-childlink:hover { text-decoration:underline; }

.pf-permits { list-style:none; margin:0; padding:0.25rem 0; }
.pf-permits li { display:grid; grid-template-columns:9rem 8rem 1fr 9rem 6rem auto; gap:0.5rem;
  align-items:center; padding:0.5rem 0.9rem; border-top:1px solid #f1f5f9; font-size:0.73rem; cursor:pointer; }
.pf-permits li:hover { background:#f8fafc; }
.pf-permit-ref { font-family: ui-monospace, monospace; font-weight:600; color:#0f172a; }
.pf-permit-type { color:#475569; text-transform:capitalize; }
.pf-permit-app { color:#475569; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.pf-permit-status { color:#1d4ed8; font-weight:600; font-size:0.66rem; }
.pf-permit-date { color:#94a3b8; font-size:0.66rem; }
.pf-permit-arrow { color:#cbd5e1; }

@media (max-width: 720px) {
  .pf-permits li { grid-template-columns:1fr auto; }
  .pf-permit-type, .pf-permit-app, .pf-permit-date, .pf-permit-arrow { display:none; }
}
</style>
