<script setup lang="ts">
// Citizen home — reception metaphor: greeting, cases waiting on you,
// then the live counters you would walk to in the building.
import { computed } from 'vue'
import { useAuthStore } from '@/stores/auth'
import {
  useCitizenCase,
  lifecycleStage,
  type LifecycleStatus,
} from '@/composables/useCitizenCase'
import {
  citizenPortalService, permitStatusToLifecycle,
} from '@/services/citizenPortalService'
import { liveServices, type CitizenSectionKey } from '@/views/citizen/citizenServices'
import {
  FilePlus, Upload, Megaphone, ClipboardCheck, BadgeCheck,
  BookOpen, AlertTriangle, ChevronRight, Landmark, Map as MapIcon,
  CreditCard, ShieldAlert, LayoutGrid, FolderOpen,
} from 'lucide-vue-next'

type OpenKey = CitizenSectionKey

const emit = defineEmits<{ 'open-section': [key: OpenKey] }>()
const cc = useCitizenCase()
const auth = useAuthStore()

const firstName = computed(() => {
  const n = (auth.userName || '').trim().split(/\s+/)[0]
  return n
})
const greeting = computed(() => {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
})

const myCases = computed(() => cc.applications.value
  .map(p => ({
    permit: p,
    lifecycle: permitStatusToLifecycle(p) as LifecycleStatus,
    deadlineDays: citizenPortalService.daysUntilDeemedRefusal(p),
    flags: citizenPortalService.missingDocuments(p),
  })))

const totals = computed(() => ({
  submitted:    cc.applications.value.length,
  needsAction:  myCases.value.filter(c => lifecycleStage(c.lifecycle).actor === 'citizen').length,
  outstandingFees: cc.applications.value.filter(p => !p.fee_paid).length,
}))

const actionCases = computed(() =>
  myCases.value.filter(c => lifecycleStage(c.lifecycle).actor === 'citizen').slice(0, 5))

const ICON_BY_ID: Record<string, unknown> = {
  'find-stand': MapIcon,
  'dev-permit': FilePlus,
  'track-app': FolderOpen,
  'upload-docs': Upload,
  'public-notice': Megaphone,
  'pay-fees': CreditCard,
  'stage-inspection': ClipboardCheck,
  'occupation-cert': BadgeCheck,
  'building-complaint': ShieldAlert,
  reference: BookOpen,
}

// Every featured service is section-backed, so a tile always opens a tab.
const featured = computed(() => liveServices().filter(s =>
  s.section && ['find-stand', 'dev-permit', 'track-app', 'pay-fees', 'stage-inspection', 'building-complaint'].includes(s.id),
))
</script>

<template>
  <div class="dash">
    <header class="dash-greet">
      <p class="dash-eyebrow"><Landmark :size="14" /> Vungu RDC citizen services</p>
      <h1>{{ greeting }}<template v-if="firstName">, {{ firstName }}</template></h1>
      <p v-if="totals.needsAction">
        {{ totals.needsAction }} {{ totals.needsAction === 1 ? 'case needs' : 'cases need' }} a response from you.
      </p>
      <p v-else-if="totals.submitted">
        {{ totals.submitted }} {{ totals.submitted === 1 ? 'application is' : 'applications are' }} with Council.
        <template v-if="totals.outstandingFees"> {{ totals.outstandingFees }} {{ totals.outstandingFees === 1 ? 'fee is' : 'fees are' }} unpaid.</template>
      </p>
      <p v-else>
        Welcome. Use the reception list below the same way you would at the council building —
        map a stand, lodge a development application, pay a fee, book an inspection, or report illegal building.
      </p>
      <div class="dash-hero-actions">
        <button type="button" class="dash-cta" @click="emit('open-section', 'services')">
          <LayoutGrid :size="15" /> Full reception list
        </button>
        <button type="button" class="dash-cta ghost" @click="emit('open-section', 'map')">
          <MapIcon :size="15" /> Open the map
        </button>
      </div>
    </header>

    <div v-if="totals.needsAction > 0" class="dash-alert" role="status">
      <AlertTriangle :size="18" />
      <div>
        <strong>Action required</strong>
        <span>Council cannot proceed until you respond.</span>
      </div>
    </div>

    <section class="dash-counters">
      <header class="dash-section-head">
        <h2>Popular counters</h2>
        <p>Live online services — more departments on the full list</p>
      </header>
      <div class="dash-grid">
        <button
          v-for="s in featured" :key="s.id" type="button" class="dash-tile"
          @click="emit('open-section', s.section!)"
        >
          <component :is="(ICON_BY_ID[s.id] as any) || FilePlus" :size="18" />
          <strong>{{ s.title }}</strong>
          <span>{{ s.askFor }}</span>
        </button>
      </div>
    </section>

    <div class="dash-main">
      <section class="dash-cases">
        <header class="dash-section-head">
          <h2>Waiting on you</h2>
          <p>Cases that cannot move until you act</p>
        </header>

        <div v-if="!actionCases.length" class="dash-empty">
          <p v-if="totals.submitted">Nothing needs your attention. Open My applications to follow progress.</p>
          <p v-else>You have not submitted an application yet.</p>
          <button v-if="!totals.submitted" type="button" class="dash-empty-cta" @click="emit('open-section', 'new')">
            Start a development application
          </button>
          <button v-else type="button" class="dash-empty-cta ghost" @click="emit('open-section', 'applications')">
            View applications
          </button>
        </div>
        <ul v-else class="dash-case-list">
          <li v-for="c in actionCases" :key="c.permit.id"
              class="dash-case" :class="{ urgent: c.deadlineDays != null && c.deadlineDays < 14 }">
            <div class="dash-case-main">
              <span class="dash-ref">{{ c.permit.dev_register_no || c.permit.id.slice(0, 12) }}</span>
              <span class="dash-where">Stand {{ c.permit.stand_number }} · {{ c.permit.suburb_ward }}</span>
              <button type="button" class="dash-case-action" @click="emit('open-section', 'applications')">
                {{ lifecycleStage(c.lifecycle).citizenAction }}
                <ChevronRight :size="14" />
              </button>
            </div>
          </li>
        </ul>
      </section>
    </div>
  </div>
</template>

<style scoped>
/* Tokens (--cp-*) inherited from .cp-root */
.dash { display:flex; flex-direction:column; gap:1.5rem; max-width:1040px; margin:0 auto; width:100%; padding:1.25rem 1rem 2rem; }
.dash-eyebrow {
  margin:0 0 0.35rem; display:inline-flex; align-items:center; gap:0.35rem;
  font-size:0.72rem; font-weight:700; letter-spacing:0.06em; text-transform:uppercase; color:var(--cp-muted);
}
.dash-greet h1 { margin:0; font-size:1.6rem; font-weight:700; letter-spacing:-0.02em; color:var(--cp-text); }
.dash-greet > p { margin:0.4rem 0 0; color:var(--cp-text-2); line-height:1.5; max-width:40rem; }
.dash-hero-actions { display:flex; flex-wrap:wrap; gap:0.5rem; margin-top:1rem; }
.dash-cta {
  display:inline-flex; align-items:center; gap:0.4rem; min-height:40px; padding:0 1rem;
  border:1px solid transparent; border-radius:var(--cp-radius-sm);
  background:var(--cp-primary); color:var(--cp-on-primary); font-size:0.85rem; font-weight:600; cursor:pointer;
}
.dash-cta:hover { background:var(--cp-primary-hover); }
.dash-cta.ghost { background:var(--cp-surface); color:var(--cp-text); border-color:var(--cp-border); }
.dash-cta.ghost:hover { background:var(--cp-surface-2); }
.dash-alert {
  display:flex; gap:0.65rem; align-items:flex-start; padding:0.85rem 1rem;
  background:var(--cp-amber-bg); color:var(--cp-amber-fg); border-radius:var(--cp-radius);
}
.dash-alert strong { display:block; }
.dash-section-head h2 { margin:0; font-size:1rem; font-weight:600; color:var(--cp-text); }
.dash-section-head p { margin:0.2rem 0 0.75rem; font-size:0.8rem; color:var(--cp-muted); }
.dash-grid { display:grid; grid-template-columns:repeat(auto-fill, minmax(14rem, 1fr)); gap:0.65rem; }
.dash-tile {
  text-align:left; border:1px solid var(--cp-border); background:var(--cp-surface); border-radius:var(--cp-radius);
  padding:0.9rem; display:flex; flex-direction:column; gap:0.35rem; cursor:pointer; color:inherit;
  transition:border-color var(--cp-dur) var(--cp-ease);
}
.dash-tile:hover { border-color:var(--cp-border-strong); }
.dash-tile > :deep(svg) { color:var(--cp-primary); }
.dash-tile strong { font-size:0.88rem; color:var(--cp-text); }
.dash-tile span { font-size:0.76rem; color:var(--cp-text-2); line-height:1.4; }
.dash-empty { padding:1rem; border:1px dashed var(--cp-border-strong); border-radius:var(--cp-radius); color:var(--cp-text-2); }
.dash-empty p { margin:0; }
.dash-empty-cta {
  margin-top:0.75rem; min-height:40px; padding:0 1rem; border:1px solid transparent; border-radius:var(--cp-radius-sm);
  background:var(--cp-primary); color:var(--cp-on-primary); font-weight:600; cursor:pointer;
}
.dash-empty-cta.ghost { background:var(--cp-surface); color:var(--cp-text); border-color:var(--cp-border); }
.dash-case-list { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:0.5rem; }
.dash-case { border:1px solid var(--cp-border); border-radius:var(--cp-radius); padding:0.8rem 0.95rem; background:var(--cp-surface); }
.dash-case.urgent { border-color:var(--cp-amber-fg); }
.dash-ref { display:block; font-family:var(--cp-mono); font-size:0.78rem; font-weight:700; color:var(--cp-text); }
.dash-where { display:block; font-size:0.8rem; color:var(--cp-muted); margin:0.15rem 0 0.5rem; }
.dash-case-action {
  display:inline-flex; align-items:center; gap:0.25rem; border:0; background:var(--cp-primary-tint);
  color:var(--cp-primary); border-radius:var(--cp-radius-sm); padding:0.4rem 0.7rem; font-size:0.78rem; font-weight:600; cursor:pointer;
}
@media (min-width: 1024px) { .dash { padding:1.75rem 1.5rem 2.5rem; } }
</style>
