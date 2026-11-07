<script setup lang="ts">
// Statutory reference library for the Town Planning Officer of a RURAL
// district council.
//
// Content rules, after the review that found this tab citing the Urban
// Councils Act, a repealed Act, and density/parking figures nobody could
// source:
//   - Only legislation that applies to Vungu RDC. Summaries are orientation;
//     the gazetted text governs, and the tab says so.
//   - No numeric standard appears here unless it comes from a source a
//     planner can cite. Standards come from the operative plan for the site.
//   - Fees and wards are read live from the system, never typed into this
//     file, so the desk reference cannot disagree with what the council bills
//     or maps.
import { computed, onMounted, ref } from 'vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiDataTable from '@/components/ui/UiDataTable.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import { getWards, type WardRecord } from '@/services/vectorTiles'
import { citizenPortalService } from '@/services/citizenPortalService'
import { BookOpen, Scale, DollarSign, Map, FileStack, Search, Info } from 'lucide-vue-next'

type Tab = 'land_use' | 'acts' | 'fees' | 'wards' | 'annexures'
const activeTab = ref<Tab>('acts')

const TABS: { key: Tab; label: string; icon: unknown }[] = [
  { key: 'acts',      label: 'Legislation',  icon: Scale },
  { key: 'land_use',  label: 'Land use',     icon: BookOpen },
  { key: 'fees',      label: 'Fees',         icon: DollarSign },
  { key: 'wards',     label: 'Wards',        icon: Map },
  { key: 'annexures', label: 'Annexures',    icon: FileStack },
]

// ── Legislation ───────────────────────────────────────────────────────────
interface Act { ref: string; name: string; why: string; points: string[] }
const ACT_GROUPS: { title: string; acts: Act[] }[] = [
  {
    title: 'Planning',
    acts: [
      { ref: 'Chapter 29:12', name: 'Regional, Town and Country Planning Act',
        why: 'The Act this office administers. The council is the local planning authority for its area.',
        points: [
          'Part IV: master plans and local plans. Preparation, exhibition, objections and approval.',
          's.24: development needs a permit, unless it complies with an operative plan or is exempt.',
          's.26: applications for permits. Acknowledgement, notice, decision and conditions.',
          's.26(3): special consent. Notice to adjoining owners and the public, then objections.',
          's.27: applications to regularise development already carried out.',
          's.32: enforcement orders. s.34: prohibition orders.',
          's.38: appeals to the Administrative Court against the council\'s decision.',
          's.40: subdivision and consolidation of property need a permit.',
        ] },
      { ref: 'Model Building By-laws, 1977', name: 'Building by-laws',
        why: 'Building plan approval and stage inspections in the council area.',
        points: ['Plan contents and approval', 'Stage inspections', 'Drainage and sanitation standards', 'Certificate of occupation'] },
    ],
  },
  {
    title: 'Local government and land',
    acts: [
      { ref: 'Chapter 29:13', name: 'Rural District Councils Act',
        why: 'Constitutes the council and sets its powers, committees and by-laws.',
        points: ['Establishment and powers of rural district councils', 'Council committees and resolutions', 'By-laws', 'Council land, leases and sale of stands'] },
      { ref: 'Chapter 20:04', name: 'Communal Land Act',
        why: 'Most of the district is communal land. Occupation and use need the council\'s consent.',
        points: ['Occupation and use of communal land with council consent', 'Regard to customary law and the traditional leader', 'Setting land aside for public purposes'] },
      { ref: 'Chapter 29:17', name: 'Traditional Leaders Act',
        why: 'Chiefs, headmen and village heads take part in land allocation in communal areas.',
        points: ['Duties of chiefs and headmen over land in their areas', 'Village assemblies and ward development committees'] },
      { ref: 'Chapter 20:12', name: 'Land Survey Act',
        why: 'Subdivisions need an approved survey before stands can be registered.',
        points: ['Survey diagrams and general plans', 'Approval by the Surveyor-General', 'Beacons'] },
      { ref: 'Chapter 20:05', name: 'Deeds Registries Act',
        why: 'Transfer of subdivided land. The council\'s compliance certificate comes before transfer.',
        points: ['Registration of title', 'Transfer of subdivided portions'] },
    ],
  },
  {
    title: 'Environment and services',
    acts: [
      { ref: 'Chapter 20:27', name: 'Environmental Management Act',
        why: 'Prescribed projects need an EIA certificate from EMA before the council grants a permit. Repealed the Atmospheric Pollution Prevention Act.',
        points: ['Part XI: environmental impact assessment for prescribed projects (First Schedule)', 'Wetlands, stream banks and sand abstraction', 'Air, water and waste standards'] },
      { ref: 'Chapter 15:17', name: 'Public Health Act',
        why: 'Sanitation and health standards for buildings and uses. Replaced Chapter 15:09 in 2018.',
        points: ['Sanitation and water supply', 'Nuisances', 'Health clearance for clinics, food and lodging premises'] },
      { ref: 'Chapter 20:24', name: 'Water Act',
        why: 'Water rights, boreholes and development near public streams. Consult ZINWA.',
        points: ['Permits for water use', 'Protection of public streams'] },
      { ref: 'Chapter 13:18', name: 'Roads Act',
        why: 'Building restriction lines and access along designated roads. Consult the road authority.',
        points: ['Road reserves', 'Access to designated roads'] },
      { ref: 'Chapter 21:05', name: 'Mines and Minerals Act',
        why: 'Mining claims can override surface rights. Check before approving layouts over claims.',
        points: ['Mining claims and surface rights', 'Quarrying'] },
      { ref: 'Chapter 14:08', name: 'Factories and Works Act',
        why: 'Plan approval and registration of industrial premises.',
        points: ['Registration of factories', 'Plans for industrial premises'] },
      { ref: 'Chapter 14:12', name: 'Liquor Act',
        why: 'The council comments on liquor licence applications for premises in its area.',
        points: ['Licensed premises', 'Council comment on applications'] },
    ],
  },
  {
    title: 'Rights and fair process',
    acts: [
      { ref: 'Constitution of Zimbabwe', name: 'Constitution',
        why: 'Every planning decision is administrative action and must respect property rights.',
        points: ['s.68: administrative justice. Lawful, prompt, reasonable, fair, with reasons.', 's.71: property rights', 's.74: freedom from arbitrary eviction and demolition'] },
      { ref: 'Chapter 10:28', name: 'Administrative Justice Act',
        why: 'A refusal or condition must be reasoned. The applicant is entitled to the reasons.',
        points: ['Duty to act lawfully, reasonably and fairly', 'Duty to give reasons', 'Review by the courts'] },
    ],
  },
]

const actQuery = ref('')
const filteredActGroups = computed(() => {
  const q = actQuery.value.trim().toLowerCase()
  if (!q) return ACT_GROUPS
  return ACT_GROUPS
    .map(g => ({ ...g, acts: g.acts.filter(a =>
      [a.ref, a.name, a.why, ...a.points].some(t => t.toLowerCase().includes(q))) }))
    .filter(g => g.acts.length)
})

// ── Land use ──────────────────────────────────────────────────────────────
// Orientation only. The standards that apply (density, coverage, setbacks,
// parking, buffers) are the ones in the operative plan for the site.
const LAND_USES = [
  { name: 'Residential', examples: ['Dwelling house', 'Flats and cluster housing', 'Boarding houses'],
    check: 'Density, coverage and building lines from the operative local or layout plan.' },
  { name: 'Commercial', examples: ['Shops and offices', 'Service stations', 'Markets at growth points and service centres'],
    check: 'Frontage, access to classified roads and parking per the plan. Service stations need an EIA certificate.' },
  { name: 'Industrial', examples: ['Workshops and light industry', 'Warehouses', 'Grinding mills'],
    check: 'Separation from housing per the plan. Factories and Works Act registration. EIA for prescribed processes.' },
  { name: 'Institutional', examples: ['Schools and clinics', 'Places of worship', 'Government offices'],
    check: 'Site reserved in the layout. Health clearance for clinics.' },
  { name: 'Agricultural and communal', examples: ['Farming', 'Homesteads in communal areas', 'Resettlement plots'],
    check: 'Communal Land Act consent and the traditional leader\'s view. Stream banks and wetlands under EMA.' },
  { name: 'Mining and extraction', examples: ['Mining', 'Quarries', 'Sand and gravel abstraction'],
    check: 'Mining claims, the EIA certificate, and restoration of the land afterwards.' },
]

// ── Fees (live) ───────────────────────────────────────────────────────────
const council = ref<{ name: string; application_fee: number } | null>(null)
const feesState = ref<'loading' | 'ready' | 'error'>('loading')
async function loadFees() {
  feesState.value = 'loading'
  try {
    council.value = await citizenPortalService.getCouncil()
    feesState.value = 'ready'
  } catch {
    feesState.value = 'error'
  }
}
const money = (n: number) => `USD ${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ── Wards (live, council area) ────────────────────────────────────────────
const wards = ref<WardRecord[]>([])
const wardsState = ref<'loading' | 'ready'>('loading')
const wardQuery = ref('')
async function loadWards() {
  wardsState.value = 'loading'
  wards.value = await getWards() // [] on failure; the empty state says so
  wardsState.value = 'ready'
}
const filteredWards = computed(() => {
  const q = wardQuery.value.trim().toLowerCase()
  return q ? wards.value.filter(w => w.name.toLowerCase().includes(q) || (w.pcode ?? '').toLowerCase().includes(q)) : wards.value
})
const WARD_COLS = [
  { key: 'name', label: 'Ward' },
  { key: 'pcode', label: 'P-code', mono: true, width: '9rem' },
  { key: 'center', label: 'Centre (lat, lon)', mono: true, width: '12rem', align: 'right' },
]

onMounted(() => { void loadFees(); void loadWards() })

// ── Annexures ─────────────────────────────────────────────────────────────
const ANNEXURES = [
  { code: 'Annexure 1',  title: 'Application form',                   purpose: 'Application intake' },
  { code: 'Annexure 2',  title: 'Development Register',               purpose: 'Register entry for every application' },
  { code: 'Annexure 3',  title: 'Acknowledgement letter',             purpose: 'Acknowledgement of receipt, s.26(2)' },
  { code: 'Annexure 4',  title: 'Special consent notice',             purpose: 'Newspaper and adjoining-owner notice, s.26(3)' },
  { code: 'Annexure 5',  title: 'Committee report cover',             purpose: 'Submission to the planning committee' },
  { code: 'Annexure 6',  title: 'Development permit',                 purpose: 'Permit document' },
  { code: 'Annexure 7',  title: 'Permit notes',                       purpose: 'Appeal rights, amendments, expiry' },
  { code: 'Annexure 8',  title: 'Enforcement order',                  purpose: 'Enforcement, s.32' },
  { code: 'Annexure 9',  title: 'Prohibition order',                  purpose: 'Prohibition, s.34' },
  { code: 'Annexure 10', title: 'Certificate of occupation',          purpose: 'Final occupation clearance' },
  { code: 'Annexure 11', title: 'Building plan contents',             purpose: 'Plan appraisal checklist' },
]
const ANNEX_COLS = [
  { key: 'code', label: 'Annexure', mono: true, width: '8rem' },
  { key: 'title', label: 'Title' },
  { key: 'purpose', label: 'Purpose' },
]
</script>

<template>
  <div class="rf">
    <header class="rf-head">
      <h2>Reference library</h2>
      <span class="rf-sub">Desk reference for the Town Planning Officer, Vungu Rural District Council</span>
    </header>

    <nav class="rf-tabs" role="tablist" aria-label="Reference">
      <button v-for="t in TABS" :key="t.key" type="button" role="tab"
              :aria-selected="activeTab === t.key" :class="{ active: activeTab === t.key }" @click="activeTab = t.key">
        <component :is="t.icon" :size="13" aria-hidden="true" /> {{ t.label }}
      </button>
    </nav>

    <!-- Legislation -->
    <section v-if="activeTab === 'acts'" class="rf-body" aria-label="Legislation">
      <div class="rf-toolbar">
        <label class="rf-search">
          <Search :size="14" aria-hidden="true" />
          <span class="ent-sr-only">Search legislation</span>
          <input v-model="actQuery" type="search" name="rf-act-search" placeholder="Search, e.g. subdivision, EIA, communal" />
        </label>
        <p class="rf-caveat"><Info :size="13" aria-hidden="true" /> Summaries for orientation. The gazetted text governs.</p>
      </div>
      <UiEmptyState v-if="!filteredActGroups.length" message="No legislation matches that search." />
      <div v-for="g in filteredActGroups" :key="g.title" class="rf-group">
        <h3>{{ g.title }}</h3>
        <div class="rf-acts">
          <article v-for="a in g.acts" :key="a.ref" class="rf-act">
            <header>
              <strong>{{ a.name }}</strong>
              <span class="rf-ref">{{ a.ref }}</span>
            </header>
            <p class="rf-why">{{ a.why }}</p>
            <ul class="rf-bullets">
              <li v-for="pt in a.points" :key="pt">{{ pt }}</li>
            </ul>
          </article>
        </div>
      </div>
    </section>

    <!-- Land use -->
    <section v-else-if="activeTab === 'land_use'" class="rf-body" aria-label="Land use">
      <p class="rf-caveat"><Info :size="13" aria-hidden="true" /> The standards that apply to a site are the ones in its operative master, local or layout plan. Check the plan, then the list below.</p>
      <div class="rf-grid">
        <UiPanel v-for="u in LAND_USES" :key="u.name" flush :title="u.name">
          <ul class="rf-bullets">
            <li v-for="ex in u.examples" :key="ex">{{ ex }}</li>
          </ul>
          <p class="rf-check"><strong>Check:</strong> {{ u.check }}</p>
        </UiPanel>
      </div>
    </section>

    <!-- Fees -->
    <section v-else-if="activeTab === 'fees'" class="rf-body" aria-label="Fees">
      <p v-if="feesState === 'loading'" class="rf-muted" aria-live="polite">Loading the council's fees…</p>
      <UiEmptyState v-else-if="feesState === 'error'" message="Could not read the council's fees from the server. Try again later." />
      <template v-else>
        <div class="rf-fee-card">
          <span class="rf-fee-label">Application fee, development permit</span>
          <span class="rf-fee-amount">{{ council?.application_fee ? money(council.application_fee) : 'Not set' }}</span>
          <span class="rf-muted">As charged to applicants by {{ council?.name || 'the council' }}.</span>
        </div>
        <p class="rf-caveat"><Info :size="13" aria-hidden="true" /> Inspection, occupation certificate and appeal fees are set by council resolution and quoted on the payment screen. They are not stored as a schedule in the system yet, so they are not listed here.</p>
      </template>
    </section>

    <!-- Wards -->
    <section v-else-if="activeTab === 'wards'" class="rf-body" aria-label="Wards">
      <div class="rf-toolbar">
        <label class="rf-search">
          <Search :size="14" aria-hidden="true" />
          <span class="ent-sr-only">Search wards</span>
          <input v-model="wardQuery" type="search" name="rf-ward-search" placeholder="Ward number or p-code" />
        </label>
        <span class="rf-muted" aria-live="polite">{{ wardsState === 'loading' ? 'Loading…' : `${filteredWards.length} of ${wards.length} wards` }}</span>
      </div>
      <UiDataTable :columns="WARD_COLS" :rows="filteredWards" row-key="fid" :loading="wardsState === 'loading'"
                   :empty-message="wards.length ? 'No ward matches that search.' : 'The ward boundaries could not be read from the map server.'">
        <template #cell-pcode="{ row }">{{ row.pcode || '—' }}</template>
        <template #cell-center="{ row }">{{ row.center[1].toFixed(4) }}, {{ row.center[0].toFixed(4) }}</template>
      </UiDataTable>
    </section>

    <!-- Annexures -->
    <section v-else class="rf-body" aria-label="Annexures">
      <p class="rf-muted">Annexure index, Development Management Handbook 2021.</p>
      <UiDataTable :columns="ANNEX_COLS" :rows="ANNEXURES" row-key="code" />
    </section>
  </div>
</template>

<style scoped>
.rf { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s3); }
.rf-head { display: flex; align-items: baseline; flex-wrap: wrap; gap: var(--ent-s1) var(--ent-s2); }
.rf-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); color: var(--ent-text); letter-spacing: -0.01em; }
.rf-sub { color: var(--ent-text-3); font-size: var(--ent-fs-xs); }

.rf-tabs { display: flex; gap: var(--ent-s1); border-bottom: 1px solid var(--ent-line); overflow-x: auto; overflow-y: hidden; } /* the tabs' -1px margin tripped a vertical scrollbar */
.rf-tabs button { display: inline-flex; align-items: center; gap: var(--ent-s1); white-space: nowrap;
  padding: var(--ent-s2) var(--ent-s3); font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text-2);
  background: none; border: none; border-bottom: 2px solid transparent; cursor: pointer; margin-bottom: -1px; }
.rf-tabs button:hover { color: var(--ent-text); }
.rf-tabs button:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); border-radius: var(--ent-r-sm) var(--ent-r-sm) 0 0; }
.rf-tabs button.active { color: var(--ent-accent); border-bottom-color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }

.rf-body { display: flex; flex-direction: column; gap: var(--ent-s3); }
.rf-toolbar { display: flex; align-items: center; gap: var(--ent-s3); flex-wrap: wrap; }
.rf-search { display: inline-flex; align-items: center; gap: var(--ent-s2); height: var(--ent-control-h); padding: 0 var(--ent-s3);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r); background: var(--ent-surface); color: var(--ent-text-3);
  flex: 1; max-width: 24rem; }
.rf-search:focus-within { border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
.rf-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent; font: inherit; font-size: var(--ent-fs-sm); color: var(--ent-text); }
.rf-caveat { margin: 0; display: flex; align-items: flex-start; gap: var(--ent-s1); font-size: var(--ent-fs-xs); color: var(--ent-text-2); max-width: 72ch; }
.rf-caveat svg { flex-shrink: 0; margin-top: 2px; color: var(--ent-text-3); }
.rf-muted { margin: 0; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }

.rf-group h3 { margin: 0 0 var(--ent-s2); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ent-text-3); }
.rf-acts { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(22rem, 100%), 1fr)); gap: var(--ent-s2); }
.rf-act { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); padding: var(--ent-s3) var(--ent-s4); }
.rf-act header { display: flex; align-items: baseline; justify-content: space-between; gap: var(--ent-s2); flex-wrap: wrap; }
.rf-act strong { font-size: var(--ent-fs-base); color: var(--ent-text); }
.rf-ref { font-family: var(--ent-font-mono); font-size: var(--ent-fs-micro); color: var(--ent-text-3); white-space: nowrap; }
.rf-why { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }

.rf-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(280px, 100%), 1fr)); gap: var(--ent-s3); align-items: start; }
.rf-bullets { margin: var(--ent-s2) 0 0; padding-left: var(--ent-s4); font-size: var(--ent-fs-sm); color: var(--ent-text); }
.rf-grid .rf-bullets { padding: var(--ent-s3) var(--ent-s4) 0 calc(var(--ent-s4) * 2); margin: 0; }
.rf-bullets li { margin: 3px 0; }
.rf-check { margin: 0; padding: var(--ent-s3) var(--ent-s4); font-size: var(--ent-fs-sm); color: var(--ent-text-2); }

.rf-fee-card { display: flex; flex-direction: column; gap: 2px; max-width: 26rem; padding: var(--ent-s4);
  background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); }
.rf-fee-label { font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.rf-fee-amount { font-family: var(--ent-font-mono); font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); color: var(--ent-text); font-variant-numeric: tabular-nums; }

@media (max-width: 767px) {
  .rf { padding: var(--ent-s3); }
  .rf-search { max-width: none; flex-basis: 100%; }
}
</style>
