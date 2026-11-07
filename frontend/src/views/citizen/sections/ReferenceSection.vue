<script setup lang="ts">
// Reference — the in-portal planning guidance: the application lifecycle,
// documents required per development type, and the council's fees. Every
// entry renders real data the portal already uses; nothing here pretends to
// be a downloadable file.

import { ref, onMounted } from 'vue'
import {
  APPLICATION_LIFECYCLE, REQUIRED_DOCS_BY_TYPE, DOC_TYPE_LABELS,
  type ApplicationCategory,
} from '@/composables/useCitizenCase'
import { citizenPortalService } from '@/services/citizenPortalService'
import { FileText, ReceiptText, Gavel, ListChecks, ArrowLeft, ChevronRight, Info } from 'lucide-vue-next'

const emit = defineEmits<{ 'open-section': [key: 'new' | 'applications'] }>()

type Kind = 'lifecycle' | 'docs' | 'fees' | 'manual'
const CATALOG = [
  { kind: 'lifecycle', icon: ListChecks, title: 'How an application moves through Council',
    desc: 'Every stage from lodging to the occupation certificate, who holds the file, and what you must do.' },
  { kind: 'docs', icon: FileText, title: 'Documents required by development type',
    desc: 'What to prepare before you apply, so the Planning Clerk can accept the file as complete.' },
  { kind: 'fees', icon: ReceiptText, title: 'Council fees',
    desc: 'The development application fee and how other fees are charged.' },
  { kind: 'manual', icon: Gavel, title: 'Development Management & Control Manual',
    desc: 'The binding regulatory text. Available for inspection at the council office.' },
] as const

const DEV_TYPES: { value: ApplicationCategory; label: string }[] = [
  { value: 'residential', label: 'Residential' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'agricultural', label: 'Agricultural' },
  { value: 'institutional', label: 'Institutional' },
  { value: 'subdivision', label: 'Subdivision' },
  { value: 'change_of_use', label: 'Change of use' },
  { value: 'advertisement', label: 'Advertisement' },
  { value: 'other', label: 'Other' },
]

const ACTOR_LABEL: Record<string, string> = {
  citizen: 'You', clerk: 'Planning Clerk', planner: 'Planner', gis: 'GIS Officer',
  committee: 'Planning Committee', council: 'Full Council', inspector: 'Building Inspector',
  eho: 'Environmental Health', surveyor: 'Surveyor', town_clerk: 'Town Clerk', court: 'Administrative Court',
}

const open = ref<Kind | null>(null)
const devType = ref<ApplicationCategory>('residential')
const applicationFee = ref<number | null>(null)
onMounted(() => {
  citizenPortalService.getCouncil()
    .then(c => { applicationFee.value = Number.isFinite(c.application_fee) ? c.application_fee : null })
    .catch(() => { /* shown as "confirmed at invoice" */ })
})
const current = () => CATALOG.find(c => c.kind === open.value)!
</script>

<template>
  <div class="rf">
    <header class="rf-header">
      <h1>Reference</h1>
      <p>Planning guidance for Vungu RDC applicants. For certified copies of by-laws and the manual, visit the council office.</p>
    </header>

    <template v-if="open">
      <button type="button" class="rf-back" @click="open = null"><ArrowLeft :size="16" /> All guidance</button>
      <section class="cp-card">
        <div class="cp-card-head">
          <span class="rf-ic"><component :is="current().icon" :size="18" /></span>
          <h2>{{ current().title }}</h2>
        </div>

        <div v-if="open === 'lifecycle'" class="rf-scroll">
          <table class="rf-table">
            <thead><tr><th scope="col">#</th><th scope="col">Stage</th><th scope="col">With</th><th scope="col">What you do</th></tr></thead>
            <tbody>
              <tr v-for="(s, i) in APPLICATION_LIFECYCLE" :key="s.key">
                <td class="mono muted">{{ i + 1 }}</td>
                <td><strong>{{ s.label }}</strong><div class="rf-sub">{{ s.description }}</div></td>
                <td class="rf-nowrap">{{ ACTOR_LABEL[s.actor] ?? s.actor }}</td>
                <td class="muted">{{ s.citizenAction }}</td>
              </tr>
            </tbody>
          </table>
        </div>

        <template v-else-if="open === 'docs'">
          <div class="rf-select">
            <label for="rf-devtype">Development type</label>
            <select id="rf-devtype" v-model="devType">
              <option v-for="t in DEV_TYPES" :key="t.value" :value="t.value">{{ t.label }}</option>
            </select>
          </div>
          <div class="rf-scroll">
            <table class="rf-table">
              <thead><tr><th scope="col">Document</th><th scope="col">Needed</th><th scope="col">Notes</th></tr></thead>
              <tbody>
                <tr v-for="d in REQUIRED_DOCS_BY_TYPE[devType]" :key="d.type">
                  <td><strong>{{ DOC_TYPE_LABELS[d.type] }}</strong></td>
                  <td><span class="pill" :class="d.mandatory ? 'pill-red' : 'pill-gray'">{{ d.mandatory ? 'Required' : 'If applicable' }}</span></td>
                  <td class="muted">{{ d.notes || '—' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <div class="rf-foot">
            <button type="button" class="rf-btn" @click="emit('open-section', 'new')">Start an application</button>
          </div>
        </template>

        <div v-else-if="open === 'fees'" class="rf-body">
          <dl class="rf-fees">
            <div>
              <dt>Development application fee</dt>
              <dd>{{ applicationFee != null ? `USD ${applicationFee.toFixed(2)}` : 'Confirmed at invoice' }}</dd>
            </div>
          </dl>
          <p>Payable online when you submit, in USD or ZWG at the day’s rate. Inspection, occupation certificate
             and appeal fees are set by Council resolution and invoiced when they fall due. Ask the Planning Clerk
             for the current tariff.</p>
        </div>

        <div v-else class="rf-body">
          <p>The Development Management &amp; Control Manual is the binding text for development control in the
             Vungu RDC area. It is not published online. You can read it, or order certified extracts, at the
             council office. The guidance in this portal summarises it and does not replace it.</p>
        </div>
      </section>
    </template>

    <ul v-else class="rf-list">
      <li v-for="c in CATALOG" :key="c.kind">
        <button type="button" class="rf-row" @click="open = c.kind">
          <span class="rf-ic"><component :is="c.icon" :size="20" /></span>
          <span class="rf-row-text">
            <strong>{{ c.title }}</strong>
            <span>{{ c.desc }}</span>
          </span>
          <ChevronRight :size="18" class="rf-chev" />
        </button>
      </li>
    </ul>

    <p class="rf-disclaimer"><Info :size="15" /> Guidance only. Where it differs from the Regional, Town and Country Planning Act or council by-laws, the law applies.</p>
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.rf { padding:1rem; display:flex; flex-direction:column; gap:1rem; max-width:960px; margin:0 auto; width:100%; }
.mono { font-family:var(--cp-mono); }
.muted { color:var(--cp-muted); }
.rf-header h1 { margin:0; font-size:1.25rem; font-weight:700; letter-spacing:-0.01em; color:var(--cp-text); }
.rf-header p { margin:0.2rem 0 0; font-size:0.85rem; color:var(--cp-text-2); max-width:44rem; }

.cp-card { background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); box-shadow:var(--cp-shadow); overflow:hidden; }
.cp-card-head { display:flex; align-items:center; gap:0.6rem; padding:0.85rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.cp-card-head h2 { margin:0; font-size:0.98rem; font-weight:600; color:var(--cp-text); }

.rf-ic { display:inline-flex; align-items:center; justify-content:center; width:38px; height:38px; flex-shrink:0;
  border-radius:var(--cp-radius-sm); background:var(--cp-primary-tint); color:var(--cp-primary); }

.rf-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.6rem; }
.rf-row { display:flex; align-items:center; gap:0.85rem; width:100%; padding:0.9rem 1rem; text-align:left; cursor:pointer;
  background:var(--cp-surface); border:1px solid var(--cp-border); border-radius:var(--cp-radius); color:inherit; font:inherit; }
.rf-row:hover { border-color:var(--cp-border-strong); }
.rf-row-text { flex:1; min-width:0; display:flex; flex-direction:column; gap:0.15rem; }
.rf-row-text strong { font-size:0.9rem; color:var(--cp-text); }
.rf-row-text span { font-size:0.8rem; color:var(--cp-text-2); line-height:1.45; }
.rf-chev { color:var(--cp-faint); flex-shrink:0; }

.rf-back { display:inline-flex; align-items:center; gap:0.4rem; align-self:flex-start; background:none; border:0; padding:0;
  color:var(--cp-primary); font-size:0.84rem; font-weight:600; cursor:pointer; }

.rf-scroll { overflow-x:auto; }
.rf-table { width:100%; border-collapse:collapse; font-size:0.82rem; }
.rf-table th, .rf-table td { padding:0.65rem 1rem; text-align:left; vertical-align:top; border-bottom:1px solid var(--cp-border); }
.rf-table th { font-size:0.62rem; font-weight:700; letter-spacing:0.05em; text-transform:uppercase; color:var(--cp-muted); background:var(--cp-surface-2); }
.rf-table tr:last-child td { border-bottom:0; }
.rf-table strong { color:var(--cp-text); }
.rf-sub { margin-top:0.15rem; font-size:0.74rem; color:var(--cp-muted); }
.rf-nowrap { white-space:nowrap; }

.pill { display:inline-flex; padding:0.15rem 0.55rem; border-radius:var(--cp-radius-pill); font-size:0.64rem; font-weight:700; white-space:nowrap; }
.pill-red  { background:var(--cp-red-bg); color:var(--cp-red-fg); }
.pill-gray { background:var(--cp-surface-2); color:var(--cp-muted); }

.rf-select { display:flex; align-items:center; gap:0.6rem; padding:0.85rem 1.1rem; border-bottom:1px solid var(--cp-border); }
.rf-select label { font-size:0.8rem; font-weight:600; color:var(--cp-text-2); }
.rf-select select { padding:0.4rem 0.6rem; border:1px solid var(--cp-border); border-radius:var(--cp-radius-sm); background:var(--cp-surface); font-size:0.84rem; color:var(--cp-text); }
.rf-foot { padding:0.85rem 1.1rem; border-top:1px solid var(--cp-border); }
.rf-btn { padding:0.5rem 1rem; border:0; border-radius:var(--cp-radius-sm); background:var(--cp-primary); color:var(--cp-on-primary);
  font-size:0.84rem; font-weight:600; cursor:pointer; min-height:40px; }
.rf-btn:hover { background:var(--cp-primary-hover); }

.rf-body { padding:1rem 1.1rem 1.1rem; }
.rf-body p { margin:0; font-size:0.86rem; line-height:1.6; color:var(--cp-text-2); max-width:44rem; }
.rf-fees { margin:0 0 0.85rem; }
.rf-fees div { display:flex; justify-content:space-between; gap:1rem; padding:0.6rem 0; border-bottom:1px solid var(--cp-border); font-size:0.88rem; }
.rf-fees dt { color:var(--cp-text); font-weight:600; }
.rf-fees dd { margin:0; font-family:var(--cp-mono); font-weight:600; color:var(--cp-text); }

.rf-disclaimer { display:flex; align-items:flex-start; gap:0.5rem; margin:0; font-size:0.76rem; color:var(--cp-muted); line-height:1.5; }
.rf-disclaimer :deep(svg) { flex-shrink:0; margin-top:0.1rem; }

@media (min-width: 1024px) { .rf { padding:1.5rem; } }
</style>
