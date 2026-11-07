<script setup lang="ts">
// Reference library — the static technical knowledge the Building
// Inspector must have at hand: Model Building By-Laws (1977),
// RTCP Act [Ch. 29:12], the Annexure suite, minimum standards
// per inspection stage, and the joint-inspection coordination matrix.

import { computed, ref } from 'vue'
import { INSPECTION_STAGES_STATIC } from '@/composables/useInspectionCase'
import {
  Scale, FileText, Users, Ruler, Search, Table2,
} from 'lucide-vue-next'
import DevelopmentMatrixManager from '@/components/admin/land-use/DevelopmentMatrixManager.vue'

type Tab = 'bylaws' | 'annexures' | 'standards' | 'coordination' | 'matrix'
const tab = ref<Tab>('bylaws')
const search = ref('')

interface BylawSec { code: string; title: string; gist: string }
const bylaws: BylawSec[] = [
  { code: 'Sec 7',  title: 'Approved plan to be kept on site',
    gist: 'A stamped copy of the approved plan must be available for inspection at all times during construction.' },
  { code: 'Sec 14', title: 'Notice of stage inspection',
    gist: 'Owner must give the Inspector ≥ 48 hours notice before work reaches a statutory inspection stage.' },
  { code: 'Sec 18', title: 'Minimum room dimensions',
    gist: 'Habitable rooms: floor area ≥ 7 m², minimum dimension 2.1 m. Ceiling height ≥ 2 400 mm.' },
  { code: 'Sec 21', title: 'Wall thickness & materials',
    gist: 'External load-bearing walls ≥ 230 mm. Burnt clay brick, cement block, or approved equivalent.' },
  { code: 'Sec 24', title: 'Foundations',
    gist: 'Trench depth ≥ 700 mm or to firm strata. Footing width ≥ 3× wall thickness. Concrete mix 1:3:6.' },
  { code: 'Sec 27', title: 'Damp-proof course',
    gist: 'DPC at plinth level, ≥ 150 mm above ground; bituminous felt, polythene, or engineering brick.' },
  { code: 'Sec 29', title: 'Wall plate & roof anchorage',
    gist: 'Wall plate bolted at ≤ 1.2 m centres; rafters secured with hoop iron or proprietary straps.' },
  { code: 'Sec 32', title: 'Stop-work orders',
    gist: 'Inspector may order works to cease immediately where construction is dangerous, non-compliant, or unauthorised.' },
  { code: 'Sec 34', title: 'Prohibition orders',
    gist: 'After non-compliance with a stop-work order, the Inspector may issue a prohibition against further building or occupation.' },
  { code: 'Sec 38', title: 'Drainage & sewerage',
    gist: 'Soil pipes ≥ 100 mm diameter; vent pipes to atmosphere; septic tank ≥ 10 m from any building.' },
  { code: 'Sec 41', title: 'Setbacks & building lines',
    gist: 'Front: 7.5 m; side: 3 m; rear: 3 m unless varied by approved plan or council policy.' },
  { code: 'Sec 46', title: 'Certificate of occupation',
    gist: 'No building may be occupied without an Annexure 13 certificate signed by the Building Inspector.' },
]

interface Annex { ref: string; title: string; purpose: string }
const annexures: Annex[] = [
  { ref: 'Annexure 7',  title: 'Conditions of approval',
    purpose: 'Standard conditions attached to development permits — referenced when verifying site compliance.' },
  { ref: 'Annexure 12', title: 'Stage inspection card',
    purpose: 'The stamp the Inspector applies to certify a stage has passed. Each stage requires a signed entry.' },
  { ref: 'Annexure 13', title: 'Certificate of occupation',
    purpose: 'Final certificate issued by the Building Inspector after all 9 stages have passed and joint inspection is complete.' },
  { ref: 'Annexure 14', title: 'Inspection checklist',
    purpose: 'The full per-stage checklist of items the Inspector must verify in person before stamping the card.' },
  { ref: 'Annexure 15', title: 'Enforcement notice',
    purpose: 'Form used to issue stop-work, rectification, or demolition orders under Sections 32 & 34.' },
]

interface CoordPartner {
  role: string; whenInvolved: string; statutoryBasis: string
}
const coordination: CoordPartner[] = [
  { role: 'Environmental Health Officer (EHO)',
    whenInvolved: 'Stage 7 (drainage) + Stage 9 (occupation) — joint sanitary inspection.',
    statutoryBasis: 'Public Health Act [Ch. 15:17] + By-Laws Sec 38.' },
  { role: 'Plumbing Inspector',
    whenInvolved: 'Stages 7 (drainage) & 8 (sanitary fittings) + Stage 9 joint inspection.',
    statutoryBasis: 'Water & Sanitation By-Laws + By-Laws Sec 38.' },
  { role: 'Town Planning Officer',
    whenInvolved: 'When deviations from approved plan are observed; setback queries.',
    statutoryBasis: 'RTCP Act [Ch. 29:12] Section 26.' },
  { role: 'Electrical Inspector',
    whenInvolved: 'Stage 8 — wiring, earthing, switchboard before certificate.',
    statutoryBasis: 'Electricity Act + relevant SI.' },
  { role: 'Fire Officer',
    whenInvolved: 'Public/assembly/industrial buildings — Stage 8 evacuation & fire-fighting check.',
    statutoryBasis: 'Fire Brigades Act + By-Laws.' },
  { role: 'Surveyor-General representative',
    whenInvolved: 'Pre-construction (Stage 1) where cadastral peg disputes arise.',
    statutoryBasis: 'Land Survey Act [Ch. 20:12].' },
]

function filterRows<T extends object>(arr: T[]): T[] {
  const q = search.value.trim().toLowerCase()
  if (!q) return arr
  return arr.filter(r => Object.values(r).join(' ').toLowerCase().includes(q))
}

const TABS: ReadonlyArray<{ id: Tab; label: string; icon: typeof Scale }> = [
  { id: 'bylaws', label: 'Model Building By-Laws', icon: Scale },
  { id: 'annexures', label: 'Annexure suite', icon: FileText },
  { id: 'standards', label: 'Per-stage standards', icon: Ruler },
  { id: 'coordination', label: 'Coordination matrix', icon: Users },
  { id: 'matrix', label: 'Development matrix', icon: Table2 },
]

/** Searching should never leave the officer staring at an unexplained empty tab. */
const hits = computed<Record<Tab, number | null>>(() => ({
  bylaws: filterRows(bylaws).length,
  annexures: filterRows(annexures).length,
  standards: INSPECTION_STAGES_STATIC.length,
  coordination: filterRows(coordination).length,
  matrix: null, // has its own search
}))
</script>

<template>
  <div class="ins-page rf">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Office</span>
        <h2 class="ins-title">Reference</h2>
        <p class="ins-lede">The standards an inspector is expected to know on site: By-Laws, the Annexure suite, per-stage minimums and who else must attend.</p>
      </div>
      <label class="ins-search rf-search">
        <Search :size="15" aria-hidden="true" />
        <span class="ent-sr-only">Search references</span>
        <input v-model="search" type="search" placeholder="Search sections, standards, partners" />
      </label>
    </header>

    <nav class="rf-tabs" aria-label="Reference sections">
      <button v-for="t in TABS" :key="t.id" type="button"
              :class="{ active: tab === t.id }"
              :aria-current="tab === t.id ? 'page' : undefined"
              @click="tab = t.id">
        <component :is="t.icon" :size="15" aria-hidden="true" />
        {{ t.label }}
        <span v-if="search && hits[t.id] != null" class="rf-n">{{ hits[t.id] }}</span>
      </button>
    </nav>

    <section v-if="tab === 'bylaws'" class="ins-card rf-pane" aria-label="Model Building By-Laws">
      <div class="ent-scroll-x">
        <table>
          <thead><tr><th scope="col">Section</th><th scope="col">Title</th><th scope="col">Substance</th></tr></thead>
          <tbody>
            <tr v-for="sec in filterRows(bylaws)" :key="sec.code">
              <td><span class="rf-code">{{ sec.code }}</span></td>
              <th scope="row">{{ sec.title }}</th>
              <td class="rf-gist">{{ sec.gist }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!filterRows(bylaws).length" class="rf-empty">No section matches &ldquo;{{ search }}&rdquo;.</p>
      <p class="rf-note">Source: Model Building By-Laws, 1977 (as amended) — read together with the
        Regional, Town &amp; Country Planning Act [Ch. 29:12]. Figures here are a working aid, not the instrument itself.</p>
    </section>

    <section v-else-if="tab === 'annexures'" class="ins-card rf-pane" aria-label="Annexure suite">
      <ul class="rf-list">
        <li v-for="a in filterRows(annexures)" :key="a.ref">
          <span class="rf-code">{{ a.ref }}</span>
          <div>
            <strong>{{ a.title }}</strong>
            <p>{{ a.purpose }}</p>
          </div>
        </li>
      </ul>
      <p v-if="!filterRows(annexures).length" class="rf-empty">No annexure matches &ldquo;{{ search }}&rdquo;.</p>
    </section>

    <section v-else-if="tab === 'standards'" class="ins-card rf-pane" aria-label="Per-stage standards">
      <ol class="rf-stages">
        <li v-for="st in INSPECTION_STAGES_STATIC" :key="st.n">
          <span class="rf-num">{{ st.n }}</span>
          <div>
            <strong>{{ st.name }}</strong>
            <p>{{ st.desc }}</p>
          </div>
        </li>
      </ol>
      <p class="rf-note">Each stage requires a passing Annexure 12 stamp before the next may commence.
        Stage 9 is the joint Certificate of Occupation inspection (Annexure 13).</p>
    </section>

    <DevelopmentMatrixManager v-else-if="tab === 'matrix'" />

    <section v-else class="ins-card rf-pane" aria-label="Coordination matrix">
      <div class="ent-scroll-x">
        <table>
          <thead><tr><th scope="col">Partner</th><th scope="col">When involved</th><th scope="col">Statutory basis</th></tr></thead>
          <tbody>
            <tr v-for="c in filterRows(coordination)" :key="c.role">
              <th scope="row">{{ c.role }}</th>
              <td>{{ c.whenInvolved }}</td>
              <td class="rf-gist">{{ c.statutoryBasis }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p v-if="!filterRows(coordination).length" class="rf-empty">No partner matches &ldquo;{{ search }}&rdquo;.</p>
      <p class="rf-note">The inspector convenes the joint inspection. Every partner must sign before the
        building may lawfully be occupied.</p>
    </section>
  </div>
</template>

<style scoped>
.rf-search { width:min(20rem, 100%); }

.rf-tabs { display:flex; gap:var(--ent-s1); border-bottom:1px solid var(--ent-line); overflow-x:auto; scrollbar-width:none; }
.rf-tabs::-webkit-scrollbar { display:none; }
.rf-tabs button {
  display:inline-flex; align-items:center; gap:var(--ent-s2); flex-shrink:0;
  min-height:40px; padding:0 var(--ent-s3); background:none; border:0; cursor:pointer; white-space:nowrap;
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium); color:var(--ent-text-2);
  box-shadow:inset 0 -2px 0 transparent; transition:color var(--ent-dur) var(--ent-ease), box-shadow var(--ent-dur) var(--ent-ease);
}
.rf-tabs button:hover { color:var(--ent-text); }
.rf-tabs button.active { color:var(--ent-accent); box-shadow:inset 0 -2px 0 var(--ent-accent); font-weight:var(--ent-fw-semibold); }
.rf-tabs button:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.rf-n { padding:0 6px; border-radius:var(--ent-r-pill); background:var(--ent-surface-sunken); color:var(--ent-text-2); font-size:var(--ent-fs-micro); font-variant-numeric:tabular-nums; }

.rf-pane { overflow:hidden; }
.rf-pane table { width:100%; border-collapse:collapse; font-size:var(--ent-fs-sm); }
.rf-pane th, .rf-pane td { padding:var(--ent-s3) var(--ent-s4); text-align:left; vertical-align:top; border-top:1px solid var(--ent-line); }
.rf-pane thead th {
  position:sticky; top:0; z-index:1; border-top:0; background:var(--ent-surface-2);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); letter-spacing:0.04em; text-transform:uppercase; color:var(--ent-text-3);
}
.rf-pane tbody th { font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.rf-pane td { color:var(--ent-text); }
.rf-code {
  display:inline-block; padding:1px var(--ent-s2); border-radius:var(--ent-r-sm);
  font-family:var(--ent-font-mono); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold);
  color:var(--ent-accent); background:var(--ent-accent-soft); white-space:nowrap;
}
.rf-gist { color:var(--ent-text-2); line-height:var(--ent-lh); }

.rf-list, .rf-stages { list-style:none; margin:0; padding:var(--ent-s3); display:flex; flex-direction:column; gap:var(--ent-s2); }
.rf-list li, .rf-stages li { display:flex; align-items:flex-start; gap:var(--ent-s3);
  padding:var(--ent-s3) var(--ent-s4); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }
.rf-list strong, .rf-stages strong { display:block; font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.rf-list p, .rf-stages p { margin:2px 0 0; font-size:var(--ent-fs-sm); color:var(--ent-text-2); line-height:var(--ent-lh); }
.rf-num { width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  border-radius:var(--ent-r-pill); background:var(--ent-accent-soft); color:var(--ent-accent);
  font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-bold); font-variant-numeric:tabular-nums; }

.rf-empty { margin:0; padding:var(--ent-s6) var(--ent-s4); text-align:center; font-size:var(--ent-fs-sm); color:var(--ent-text-3); }
.rf-note { margin:0; padding:var(--ent-s3) var(--ent-s4); font-size:var(--ent-fs-xs); color:var(--ent-text-2);
  background:var(--ent-surface-2); border-top:1px solid var(--ent-line); line-height:var(--ent-lh); }

@media (prefers-reduced-motion: reduce) { .rf-tabs button { transition:none; } }
</style>
