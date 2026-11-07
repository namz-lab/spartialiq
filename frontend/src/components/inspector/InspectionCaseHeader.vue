<script setup lang="ts">
/**
 * The one case-context band for the Building Inspector console.
 *
 * Every section renders beneath this, so the inspector always has the same eight
 * answers in the same place regardless of which tab they are on. Derivation lives
 * in src/inspector/caseBrief.ts (pure, tested); this component only renders it.
 *
 * Deliberately one band, not a grid of cards: the ordering IS the hierarchy —
 * identity, then what is blocking, then what to do now, with the supporting
 * record (approved plan, previous stages) available but not competing.
 */
import { computed, ref, watch } from 'vue'
import { MapPin, FileCheck2, History, AlertTriangle, ArrowRight, ChevronDown } from 'lucide-vue-next'
import { useInspectionCase } from '@/composables/useInspectionCase'
import { buildCaseBrief } from '@/inspector/caseBrief'
import {
  dmApi,
  type BuildingPlan, type Consultation,
} from '@/services/developmentManagementService'

const ic = useInspectionCase()

const plans = ref<BuildingPlan[]>([])
const consultations = ref<Consultation[]>([])
// The certificate lives on the shared case, so this band updates the moment one
// is issued instead of waiting for the permit id to change.
const certificate = ic.certificate
const contextError = ref<string | null>(null)
const showDetail = ref(false)

const brief = computed(() => buildCaseBrief({
  permit: ic.current.value?.permit ?? null,
  stages: ic.current.value?.stages ?? null,
  plans: plans.value,
  consultations: consultations.value,
  certificate: certificate.value,
}))

const blocking = computed(() => brief.value.blockers.filter(b => b.severity === 'blocking'))
const warnings = computed(() => brief.value.blockers.filter(b => b.severity === 'warning'))

/**
 * Load the supporting record for a case. A missing certificate is normal (the
 * building is not finished), but a FAILED plans fetch must never be rendered as
 * "no approved plan" — that would invent a blocker out of a network error. It is
 * reported as unknown instead.
 */
watch(() => ic.current.value?.permitId, async (permitId) => {
  plans.value = []
  consultations.value = []
  contextError.value = null
  if (!permitId) return

  const [planRes, consRes] = await Promise.allSettled([
    dmApi.listBuildingPlans(permitId),
    dmApi.listConsultations(permitId),
  ])
  if (planRes.status === 'fulfilled') plans.value = planRes.value
  if (consRes.status === 'fulfilled') consultations.value = consRes.value

  if (planRes.status === 'rejected') {
    contextError.value = 'The approved building plans could not be loaded, so what was approved is '
      + 'unknown for this case. Do not assess the work from memory — retry before inspecting.'
  }
}, { immediate: true })

function fmt(iso: string | null) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function verdictLabel(v: string) {
  return v === 'rework' ? 'conditional pass' : v
}
</script>

<template>
  <section class="ich" aria-label="Case context">
    <!-- WHAT -->
    <div class="ich-idline">
      <template v-if="brief.what">
        <span class="ich-ref">{{ brief.what.reference }}</span>
        <h2 class="ich-title">{{ brief.what.title }}</h2>
        <span class="ich-chip">{{ brief.what.permitStatus.replace(/_/g, ' ') }}</span>
      </template>
      <h2 v-else class="ich-title muted">No case open</h2>
    </div>

    <!-- WHERE -->
    <p v-if="brief.where" class="ich-where">
      <MapPin :size="12" aria-hidden="true" />
      Stand {{ brief.where.stand }} · Ward {{ brief.where.ward }}
      <template v-if="brief.where.address"> · {{ brief.where.address }}</template>
    </p>

    <!-- WHY -->
    <p class="ich-why">{{ brief.why }}</p>

    <!-- WHAT IS BLOCKING ME -->
    <ul v-if="blocking.length || warnings.length || contextError" class="ich-blockers">
      <li v-for="b in blocking" :key="b.code + b.label" class="blocking">
        <AlertTriangle :size="12" aria-hidden="true" />
        <span class="ich-sev">Blocking</span>
        <span><strong>{{ b.label }}</strong> — {{ b.detail }}</span>
      </li>
      <li v-for="b in warnings" :key="b.code + b.label" class="warning">
        <AlertTriangle :size="12" aria-hidden="true" />
        <span class="ich-sev">Advisory</span>
        <span><strong>{{ b.label }}</strong> — {{ b.detail }}</span>
      </li>
      <li v-if="contextError" class="blocking">
        <AlertTriangle :size="12" aria-hidden="true" />
        <span class="ich-sev">Blocking</span>
        <span>{{ contextError }}</span>
      </li>
    </ul>

    <!-- WHAT MUST I DO NOW / WHAT HAPPENS NEXT -->
    <div class="ich-now">
      <div v-if="brief.now" class="ich-nowstage">
        <span class="ich-lbl">Now</span>
        <strong>Stage {{ brief.now.stageNumber }} — {{ brief.now.stageName }}</strong>
      </div>
      <div class="ich-next">
        <ArrowRight :size="12" aria-hidden="true" />
        <span>{{ brief.next }}</span>
      </div>
    </div>

    <!-- Supporting record: available, not competing. -->
    <button
      v-if="brief.what"
      type="button" class="ich-toggle"
      :aria-expanded="showDetail"
      @click="showDetail = !showDetail">
      <ChevronDown :size="12" :class="{ open: showDetail }" aria-hidden="true" />
      {{ showDetail ? 'Hide' : 'Show' }} approved plan and previous stages
    </button>

    <div v-if="showDetail && brief.what" class="ich-detail">
      <div class="ich-detailcol">
        <h3><FileCheck2 :size="12" aria-hidden="true" /> What was approved</h3>
        <p v-if="brief.approved">
          <strong>{{ brief.approved.revisionLabel }}</strong>
          approved {{ fmt(brief.approved.approvedAt) }}
          <template v-if="brief.approved.architect"> · {{ brief.approved.architect }}</template>
        </p>
        <p v-else class="muted">No approved plan revision is on file for this permit.</p>
      </div>

      <div class="ich-detailcol">
        <h3><History :size="12" aria-hidden="true" /> What happened before</h3>
        <ol v-if="brief.history.length" class="ich-history">
          <li v-for="h in brief.history" :key="h.stageNumber">
            <span class="ich-hstage">Stage {{ h.stageNumber }}</span>
            <span class="ich-hname">{{ h.stageName }}</span>
            <span class="ich-hverdict" :class="h.verdict">{{ verdictLabel(h.verdict) }}</span>
            <span class="ich-hdate">{{ fmt(h.inspectedAt) }}</span>
          </li>
        </ol>
        <p v-else class="muted">No stage inspection has been recorded on this permit.</p>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ich {
  display: flex; flex-direction: column; gap: var(--ent-s2);
  padding: var(--ent-s3) var(--ent-s5);
  border-bottom: 1px solid var(--ent-border);
  background: var(--ent-surface-1);
}
.ich-idline { display: flex; align-items: baseline; gap: var(--ent-s3); flex-wrap: wrap; }
.ich-ref {
  font-family: var(--ent-font-mono, monospace);
  font-size: var(--ent-fs-micro); color: var(--ent-text-3);
}
.ich-title { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); }
.ich-title.muted { color: var(--ent-text-3); font-weight: var(--ent-fw-medium, 500); }
.ich-chip {
  padding: 2px 8px; border: 1px solid var(--ent-border); border-radius: 999px;
  font-size: var(--ent-fs-micro); color: var(--ent-text-2); text-transform: capitalize;
}
.ich-where, .ich-why {
  margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2);
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
}
.ich-why { color: var(--ent-text-1); }

.ich-blockers { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.ich-blockers li {
  display: flex; align-items: baseline; gap: 8px;
  font-size: var(--ent-fs-sm); padding: 2px 0;
}
/*
 * Severity is spelled out in the `.ich-sev` label, so it never depends on colour
 * alone — both severities use the same warning glyph, which on its own could not
 * tell them apart. Colour reinforces the word rather than carrying the meaning.
 */
.ich-sev {
  flex: none; min-width: 4.5rem;
  font-size: var(--ent-fs-micro); text-transform: uppercase;
  letter-spacing: .06em; font-weight: var(--ent-fw-medium, 500);
}
.ich-blockers li.blocking .ich-sev { color: var(--ent-danger); }
.ich-blockers li.warning  .ich-sev { color: var(--ent-warning, #a8620a); }
.ich-blockers li.blocking svg { color: var(--ent-danger); }
.ich-blockers li.warning  svg { color: var(--ent-warning, #a8620a); }

.ich-now { display: flex; align-items: center; gap: var(--ent-s4); flex-wrap: wrap; padding-top: 2px; }
.ich-nowstage { display: flex; align-items: baseline; gap: 6px; }
.ich-lbl {
  font-size: var(--ent-fs-micro); text-transform: uppercase;
  letter-spacing: .06em; color: var(--ent-text-3);
}
.ich-next { display: flex; align-items: center; gap: 6px; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }

.ich-toggle {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 6px;
  min-height: 32px; padding: 4px 0;
  border: none; background: none; cursor: pointer;
  font-size: var(--ent-fs-micro); color: var(--ent-accent);
}
.ich-toggle:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.ich-toggle svg { transition: transform .15s ease; }
.ich-toggle svg.open { transform: rotate(180deg); }
@media (prefers-reduced-motion: reduce) { .ich-toggle svg { transition: none; } }

.ich-detail {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
  gap: var(--ent-s4); padding-top: var(--ent-s2);
}
.ich-detailcol h3 {
  margin: 0 0 4px; display: flex; align-items: center; gap: 6px;
  font-size: var(--ent-fs-micro); text-transform: uppercase;
  letter-spacing: .06em; color: var(--ent-text-3); font-weight: var(--ent-fw-medium, 500);
}
.ich-detailcol p { margin: 0; font-size: var(--ent-fs-sm); }
.ich-detailcol .muted { color: var(--ent-text-3); }

.ich-history { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; }
.ich-history li {
  display: grid; grid-template-columns: auto 1fr auto auto; gap: 8px;
  align-items: baseline; font-size: var(--ent-fs-sm);
}
.ich-hstage { font-family: var(--ent-font-mono, monospace); font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.ich-hname { color: var(--ent-text-2); }
.ich-hverdict { font-size: var(--ent-fs-micro); text-transform: uppercase; letter-spacing: .04em; }
.ich-hverdict.pass { color: var(--ent-success, #166534); }
.ich-hverdict.fail { color: var(--ent-danger); }
.ich-hverdict.rework { color: var(--ent-warning, #a8620a); }
.ich-hdate { font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
</style>
