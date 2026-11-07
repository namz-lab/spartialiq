<script setup lang="ts">
// Reference — what an EHO needs to hand on site: the statutes behind each
// action in this console, minimum standards per use, school sanitary ratios,
// water guideline values, outbreak incubation periods, and who to refer to.
//
// One search covers every tab: an officer standing in a butchery types
// "butchery" and should not have to guess which tab holds the answer.
//
// Guidance, not law. Every table says where its figures come from, and the
// outbreak and water tables defer to Ministry of Health direction.

import { computed } from 'vue'
import {
  MIN_FLOOR_AREAS, SCHOOL_SANITARY_RATIOS, SPECIALISED_REFERRALS, HIGH_POLLUTION_INDUSTRIES,
} from '@/composables/useHealthCase'
import { CHLORINE_MIN, CHLORINE_MAX, PH_MIN, PH_MAX } from '@/environment-officer/waterQuality'
import { NOTICE_LABELS } from '@/services/environmentalHealthOps'
import { useEhoNav } from '@/environment-officer/useEhoNav'
import DevelopmentMatrixManager from '@/components/admin/land-use/DevelopmentMatrixManager.vue'
import { Scale, Ruler, Search, Factory, Droplet, Activity, Share2, Table2 } from 'lucide-vue-next'

const nav = useEhoNav()

type Tab = 'acts' | 'standards' | 'water' | 'disease' | 'referrals' | 'matrix'
const TABS: { key: Tab; label: string; icon: typeof Scale }[] = [
  { key: 'acts', label: 'Statutes', icon: Scale },
  { key: 'standards', label: 'Standards', icon: Ruler },
  { key: 'water', label: 'Water', icon: Droplet },
  { key: 'disease', label: 'Outbreaks', icon: Activity },
  { key: 'referrals', label: 'Referrals', icon: Share2 },
  // Licence clearance needs the use to be lawful in the premises' zone.
  { key: 'matrix', label: 'Development matrix', icon: Table2 },
]
const tab = computed<Tab>(() => {
  const t = nav.param('tab')
  return TABS.some(x => x.key === t) ? (t as Tab) : 'acts'
})
const search = computed({
  get: () => nav.param('q') ?? '',
  set: (v: string) => nav.setParam('q', v || null),
})

const ACTS = [
  { ref: 'PHA [Ch. 15:09]', title: 'Public Health Act', gist: 'The EHO\'s principal statute: nuisances, notifiable diseases, unfit premises, food premises, burials.' },
  { ref: 'PHA — notifiable diseases', title: 'Notifiable diseases', gist: 'Cholera, typhoid, dysentery and other notifiable conditions are reported to the health authorities without delay.' },
  { ref: 'PHA — nuisances', title: 'Nuisances', gist: 'Premises or conditions dangerous or injurious to health are a nuisance the local authority may require to be abated.' },
  ...Object.values(NOTICE_LABELS).map(n => ({ ref: n.statute, title: n.label, gist: 'Served from Enforcement. Compliance is established by re-inspection.' })),
  { ref: 'FFSA [Ch. 15:04]', title: 'Food and Food Standards Act', gist: 'Food sold for human consumption must be fit and not adulterated; unfit food may be seized and destroyed.' },
  { ref: 'EMA [Ch. 20:27]', title: 'Environmental Management Act', gist: 'Effluent discharge, solid waste disposal and environmental impact assessment. Refer to the Environmental Management Agency.' },
  { ref: 'Shop Licences Act [Ch. 14:17]', title: 'Shop licences', gist: 'Council health clearance of the premises precedes the grant or renewal of a shop licence.' },
  { ref: 'Liquor Act [Ch. 14:12]', title: 'Liquor licences', gist: 'Licensed premises require sanitary facilities fit for the number of patrons; clearance is sought before licensing.' },
  { ref: 'MBL s. 18', title: 'Minimum room dimensions', gist: 'Habitable rooms: floor area at least 7 m², least dimension 2.1 m, ceiling height at least 2 400 mm.' },
  { ref: 'MBL s. 38', title: 'Drainage and sewerage', gist: 'Soil pipes at least 100 mm; vent pipes to atmosphere; septic tank at least 10 m from any building.' },
  { ref: 'FWA [Ch. 14:08]', title: 'Factories and Works Act', gist: 'Factories ventilated so fumes and dust are rendered harmless so far as practicable. Refer to the Factories Inspectorate.' },
  { ref: 'APPA', title: 'Atmospheric Pollution Prevention', gist: 'Noxious and offensive gas emissions are referred to the Secretary for Health.' },
]
const STANDARDS = [
  ...MIN_FLOOR_AREAS.map(r => ({ use: r.label, rule: r.rule })),
  { use: 'School — water closets', rule: `Boys: ${SCHOOL_SANITARY_RATIOS.wcBoys} · Girls: ${SCHOOL_SANITARY_RATIOS.wcGirls}` },
  { use: 'School — urinals', rule: SCHOOL_SANITARY_RATIOS.urinals },
  { use: 'School — wash basins', rule: `Boys: ${SCHOOL_SANITARY_RATIOS.washBoys} · Girls: ${SCHOOL_SANITARY_RATIOS.washGirls}` },
  { use: 'School — hostel', rule: 'At least 3.75 m² per pupil, separated by sex, hot and cold water; overhead water tank as contingency.' },
  { use: 'Any premises — WCs', rule: 'At least one WC per 16 persons; separate male and female facilities except family dwellings.' },
]
const WATER = [
  { parameter: 'E. coli', value: '0 CFU per 100 ml', note: 'Any detection: not potable. Protect or close the source; notify.' },
  { parameter: 'Faecal coliform', value: '0 CFU per 100 ml', note: 'Same as E. coli — evidence of faecal contamination.' },
  { parameter: 'Free residual chlorine', value: `${CHLORINE_MIN} – ${CHLORINE_MAX} mg/L`, note: 'At the point of use. At least 0.5 mg/L is commonly advised during an outbreak.' },
  { parameter: 'pH', value: `${PH_MIN} – ${PH_MAX}`, note: 'Outside this range chlorination is less effective; resample.' },
]
const DISEASES = [
  { disease: 'Cholera', incubation: '12 hours – 5 days', note: 'Water and food source investigation; chlorinate sources; ORS points.' },
  { disease: 'Typhoid', incubation: '6 – 30 days', note: 'Trace food handlers; exclude carriers from food handling.' },
  { disease: 'Dysentery (shigellosis)', incubation: '1 – 7 days', note: 'Hand-washing facilities; sanitation of the affected area.' },
  { disease: 'Food poisoning', incubation: 'Hours – a few days', note: 'Seize suspect food; inspect the premises; sample for the lab.' },
  { disease: 'Measles', incubation: '7 – 21 days', note: 'Refer to the clinic immunisation programme.' },
  { disease: 'COVID-19', incubation: '2 – 14 days', note: 'Follow current Ministry of Health direction.' },
]

const q = computed(() => search.value.trim().toLowerCase())
const match = (o: object) => !q.value || Object.values(o).join(' ').toLowerCase().includes(q.value)
const results = computed(() => ({
  acts: ACTS.filter(match),
  standards: STANDARDS.filter(match),
  water: WATER.filter(match),
  disease: DISEASES.filter(match),
  referrals: SPECIALISED_REFERRALS.filter(match),
  industries: HIGH_POLLUTION_INDUSTRIES.filter(i => !q.value || i.toLowerCase().includes(q.value)),
}))
const counts = computed<Record<Tab, number | null>>(() => ({
  acts: results.value.acts.length, standards: results.value.standards.length, water: results.value.water.length,
  disease: results.value.disease.length, referrals: results.value.referrals.length + results.value.industries.length,
  matrix: null, // has its own search
}))
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Guidance, not legal advice</span>
        <h2 class="ins-title">Reference</h2>
        <p class="ins-lede">Statutes, standards and thresholds behind the decisions in this console. One search covers every tab.</p>
      </div>
      <label class="ins-search rf-search"><Search :size="15" aria-hidden="true" /><span class="ent-sr-only">Search the reference</span>
        <input v-model="search" type="search" placeholder="e.g. butchery, septic, cholera, chlorine" /></label>
    </header>

    <div class="ins-seg rf-tabs" role="tablist" aria-label="Reference topics">
      <button v-for="t in TABS" :key="t.key" type="button" role="tab" :aria-selected="tab === t.key"
              @click="nav.setParam('tab', t.key === 'acts' ? null : t.key)">
        <component :is="t.icon" :size="14" aria-hidden="true" /> {{ t.label }}
        <span v-if="q && counts[t.key] != null" class="rf-n">{{ counts[t.key] }}</span>
      </button>
    </div>

    <DevelopmentMatrixManager v-if="tab === 'matrix'" />
    <section v-else class="ins-card rf-card">
      <div class="rf-table-wrap">
        <table v-if="tab === 'acts'" class="rf-table">
          <thead><tr><th scope="col">Reference</th><th scope="col">Subject</th><th scope="col">Substance</th></tr></thead>
          <tbody><tr v-for="s in results.acts" :key="s.ref + s.title">
            <td class="ins-mono rf-code">{{ s.ref }}</td><td><strong>{{ s.title }}</strong></td><td>{{ s.gist }}</td></tr></tbody>
        </table>
        <table v-else-if="tab === 'standards'" class="rf-table">
          <thead><tr><th scope="col">Use</th><th scope="col">Minimum standard</th></tr></thead>
          <tbody><tr v-for="s in results.standards" :key="s.use"><td><strong>{{ s.use }}</strong></td><td>{{ s.rule }}</td></tr></tbody>
        </table>
        <table v-else-if="tab === 'water'" class="rf-table">
          <thead><tr><th scope="col">Parameter</th><th scope="col">Guideline</th><th scope="col">When it fails</th></tr></thead>
          <tbody><tr v-for="w in results.water" :key="w.parameter"><td><strong>{{ w.parameter }}</strong></td><td class="ins-mono">{{ w.value }}</td><td>{{ w.note }}</td></tr></tbody>
        </table>
        <table v-else-if="tab === 'disease'" class="rf-table">
          <thead><tr><th scope="col">Condition</th><th scope="col">Typical incubation</th><th scope="col">First actions</th></tr></thead>
          <tbody><tr v-for="d in results.disease" :key="d.disease"><td><strong>{{ d.disease }}</strong></td><td>{{ d.incubation }}</td><td>{{ d.note }}</td></tr></tbody>
        </table>
        <template v-else>
          <table class="rf-table">
            <thead><tr><th scope="col">Issue</th><th scope="col">Refer to</th><th scope="col">Statute</th></tr></thead>
            <tbody><tr v-for="r in results.referrals" :key="r.issue"><td><strong>{{ r.issue }}</strong></td><td>{{ r.refersTo }}</td><td>{{ r.statute }}</td></tr></tbody>
          </table>
          <div v-if="results.industries.length" class="ins-card-body">
            <h3 class="rf-sub"><Factory :size="15" aria-hidden="true" /> High-pollution industries</h3>
            <ul class="ins-chips rf-ind"><li v-for="i in results.industries" :key="i" class="ins-chip">{{ i }}</li></ul>
            <p class="ins-hint">Automatically referred to the Factories Inspectorate and, for emissions or effluent, the Environmental Management Agency.</p>
          </div>
        </template>
      </div>
      <p v-if="!counts[tab]" class="rf-empty">
        Nothing under this tab matches “{{ search }}”.
        <template v-if="Object.values(counts).some(Boolean)"> Other tabs have matches — their counts are shown above.</template>
      </p>
      <div class="ins-card-foot rf-foot">
        <p class="ins-hint">
          <template v-if="tab === 'acts'">PHA — Public Health Act; MBL — Model Building By-Laws; FWA — Factories and Works Act; APPA — Atmospheric Pollution Prevention Act.</template>
          <template v-else-if="tab === 'water'">Guideline values after the WHO Guidelines for Drinking-water Quality. The console suggests a result from these; the officer decides.</template>
          <template v-else-if="tab === 'disease'">An outbreak is commonly declared over after twice the maximum incubation period with no new case. Follow Ministry of Health direction.</template>
          <template v-else-if="tab === 'standards'">Model Building By-Laws and Ministry of Health minimum requirements for premises.</template>
          <template v-else>Refer in writing and record the referral in the case notes.</template>
        </p>
      </div>
    </section>
  </div>
</template>

<style scoped>
.rf-search { flex:0 1 24rem; }
.rf-tabs { flex-wrap:wrap; align-self:flex-start; }
.rf-n { min-width:1.2rem; padding:0 5px; border-radius:var(--ent-r-pill); font-size:var(--ent-fs-micro); line-height:1.2rem;
  font-weight:var(--ent-fw-semibold); color:var(--ent-accent); background:var(--ent-accent-soft); }
.rf-card { overflow:hidden; }
.rf-table-wrap { overflow-x:auto; }
.rf-table { width:100%; border-collapse:collapse; font-size:var(--ent-fs-sm); }
.rf-table th { padding:var(--ent-s2) var(--ent-s4); text-align:left; white-space:nowrap; font-size:var(--ent-fs-micro);
  font-weight:var(--ent-fw-semibold); letter-spacing:0.04em; text-transform:uppercase; color:var(--ent-text-3);
  background:var(--ent-surface-2); border-bottom:1px solid var(--ent-line); }
.rf-table td { padding:var(--ent-s3) var(--ent-s4); border-bottom:1px solid var(--ent-line); vertical-align:top;
  color:var(--ent-text-2); line-height:var(--ent-lh); }
.rf-table td strong { color:var(--ent-text); }
.rf-table tbody tr:last-child td { border-bottom:0; }
.rf-code { white-space:nowrap; color:var(--ent-text); }
.rf-sub { display:flex; align-items:center; gap:var(--ent-s2); margin:0 0 var(--ent-s3); font-size:var(--ent-fs-md); }
.rf-ind { list-style:none; margin:0 0 var(--ent-s3); padding:0; }
.rf-ind .ins-chip { display:inline-flex; align-items:center; cursor:default; }
.rf-empty { margin:0; padding:var(--ent-s5) var(--ent-s4); font-size:var(--ent-fs-sm); color:var(--ent-text-3); }
.rf-foot { justify-content:flex-start; }
.rf-foot p { margin:0; }
@media (max-width: 767px) { .rf-search { flex:1 1 100%; } }
</style>
