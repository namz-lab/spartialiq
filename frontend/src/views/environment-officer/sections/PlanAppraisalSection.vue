<script setup lang="ts">
// Plan appraisal — the EHO's part of the One-Stop-Shop circulation.
//
// Reviews a submitted building plan for ventilation, sanitation, hygiene and
// floor-area compliance, then answers the environmental-health referral the
// planner raised with no objection, objection, or conditional approval.
//
// The checklist is a working draft, kept on this device per permit
// (useHealthCase.openAppraisal) until the response is filed. It used to be
// opened through loadPremises(permitId) — a permit id passed where a premises
// id was expected, which only worked because an unknown premises fell back to
// a blank case.
//
// URL: ?permit=<id>

import { computed, onMounted, ref, watch } from 'vue'
import { dmApi, type PermitApplication, type BuildingPlan } from '@/services/developmentManagementService'
import { isPermitInCirculation, matchesReferralDepartment } from '@/composables/useApplicationPipeline'
import { useHealthCase, MIN_FLOOR_AREAS, type PlanAppraisalCheck } from '@/composables/useHealthCase'
import { useAuthStore } from '@/stores/auth'
import { useEhoNav } from '@/environment-officer/useEhoNav'
import { fmtDate, fmtDateTime, humanise, daysSince } from '@/environment-officer/console'
import { isPersonName } from '@/utils/citizenValidation'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  ClipboardCheck, Search, RefreshCw, CloudOff, Send, FileText, ArrowLeft, Wind, Droplets, Sparkles, Ruler, Info,
} from 'lucide-vue-next'

const hc = useHealthCase()
const fb = useUiFeedback()
const nav = useEhoNav()
const auth = useAuthStore()

const permits = ref<PermitApplication[]>([])
const plans = ref<BuildingPlan[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)
const search = ref('')

async function loadPermits() {
  loading.value = true
  loadError.value = null
  try {
    const r = await dmApi.listPermits({ limit: 200, offset: 0 })
    permits.value = r.data.filter(p => isPermitInCirculation(p.status))
  } catch (err: unknown) {
    loadError.value = fb.parseApiError(err, 'Permits in circulation could not be loaded.')
  } finally {
    loading.value = false
  }
}
onMounted(loadPermits)

const filteredPermits = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return permits.value
  return permits.value.filter(p =>
    `${p.dev_register_no || ''} ${p.applicant_name || ''} ${p.stand_number || ''}`.toLowerCase().includes(q))
})

const selectedId = computed(() => nav.param('permit'))
const selected = computed(() => permits.value.find(p => p.id === selectedId.value) ?? null)
const plansLoading = ref(false)

watch(selectedId, async (id) => {
  plans.value = []
  if (!id) { hc.clear(); return }
  hc.openAppraisal(id)
  prefillReviewer()
  plansLoading.value = true
  try { plans.value = await dmApi.listBuildingPlans(id) } catch { plans.value = [] } finally { plansLoading.value = false }
}, { immediate: true })

const appraisal = computed(() => hc.current.value?.planAppraisal ?? null)
watch(appraisal, () => { hc.save() }, { deep: true })
function prefillReviewer() {
  const a = hc.current.value?.planAppraisal
  if (a && !a.reviewedBy) a.reviewedBy = auth.userName || ''
}

type CheckKey = Exclude<keyof PlanAppraisalCheck, 'verdict' | 'notes' | 'reviewedAt' | 'reviewedBy' | 'conditions'>
const GROUPS: { group: string; icon: typeof Wind; items: { key: CheckKey; label: string; hint?: string }[] }[] = [
  { group: 'Ventilation', icon: Wind, items: [
    { key: 'windowArea10pct',      label: 'Window area at least 10% of floor area' },
    { key: 'windowsOpenable50pct', label: 'At least half the window area openable' },
    { key: 'airBricksAdequate',    label: 'Air bricks — two per room, no more than 2 m apart' },
    { key: 'crossVentilation',     label: 'Cross-ventilation provided', hint: 'Terraced shops: vents on internal walls' },
  ] },
  { group: 'Sanitation', icon: Droplets, items: [
    { key: 'waterSupplyConnected', label: 'Connected to council water, or an approved alternative' },
    { key: 'sewerOrSepticTank',    label: 'Sewer, or a septic tank sized for the occupancy' },
    { key: 'wcRatio',              label: 'At least one WC per 16 persons' },
    { key: 'genderSeparation',     label: 'Separate male and female toilets', hint: 'Not required for family dwellings' },
    { key: 'disabledAccess',       label: 'Public toilets accessible to persons with disabilities' },
    { key: 'refuseReceptacle',     label: 'Approved refuse receptacle area' },
  ] },
  { group: 'Hygiene', icon: Sparkles, items: [
    { key: 'reticulatedWater',     label: 'Reticulated water supply' },
    { key: 'washBasinsPiped',      label: 'Staff wash-hand basins with piped water' },
    { key: 'imperviousSurfaces',   label: 'Food surfaces impervious', hint: 'Stainless steel, concrete or tiled' },
  ] },
  { group: 'Floor area & construction', icon: Ruler, items: [
    { key: 'minFloorAreaMet',      label: 'Minimum floor area for the use class met' },
    { key: 'wallsCompliant',       label: 'Walls 230 mm burnt brick or 150 mm block; plastered for food use' },
    { key: 'floorCompliant',       label: 'Floor 100 mm concrete on 150 mm rammed hard-core' },
    { key: 'roofRainwaterOk',      label: 'Roof weatherproof, rainwater disposed of' },
    { key: 'storeroomsRodentProof', label: 'Rodent-proof food storerooms' },
  ] },
]
const ALL_KEYS = GROUPS.flatMap(g => g.items.map(i => i.key))
const metCount = computed(() => appraisal.value ? ALL_KEYS.filter(k => appraisal.value![k]).length : 0)
const groupMet = (g: typeof GROUPS[number]) => appraisal.value ? g.items.filter(i => appraisal.value![i.key]).length : 0
function setGroup(g: typeof GROUPS[number], v: boolean) {
  if (!appraisal.value) return
  for (const i of g.items) appraisal.value[i.key] = v
}

// A no-objection with checks outstanding is the officer's call, but never an accident.
const verdictWarning = computed(() => {
  const a = appraisal.value
  if (!a) return null
  const outstanding = ALL_KEYS.length - metCount.value
  if (a.verdict === 'no_objection' && outstanding > 0) {
    return `${outstanding} requirement${outstanding === 1 ? ' is' : 's are'} not ticked. A no-objection normally means every requirement is met — consider conditions instead.`
  }
  return null
})

function summariseChecks(): string {
  const a = appraisal.value
  if (!a) return ''
  const lines = GROUPS.map(g => {
    const fails = g.items.filter(i => !a[i.key])
    return fails.length ? `${g.group} — outstanding: ${fails.map(f => f.label).join('; ')}` : `${g.group} — satisfied`
  })
  if (a.conditions) lines.push(`Conditions: ${a.conditions}`)
  return lines.join('\n')
}

const filing = ref(false)
async function fileResponse() {
  if (!selected.value || !appraisal.value) return
  const a = appraisal.value
  if (a.verdict === 'pending') return fb.showToast('Choose a response before filing.', 'warning')
  if (!isPersonName(a.reviewedBy || '')) return fb.showToast('Enter the reviewing officer’s name.', 'warning')
  if (a.verdict === 'conditional' && !(a.conditions || '').trim()) return fb.showToast('A conditional approval needs its conditions in writing.', 'warning')
  if (a.verdict === 'objection' && !(a.notes || '').trim()) return fb.showToast('An objection must give its grounds in the notes.', 'warning')
  const ok = await fb.confirmAction('File environmental health response',
    `File a ${humanise(a.verdict).toLowerCase()} response for ${selected.value.applicant_name}? It is recorded against the permit application and seen by the planner.`,
    { confirmLabel: 'File response' })
  if (!ok) return

  filing.value = true
  try {
    // Answer the referral the planner raised, if there is one. Creating a
    // second environmental_health row would leave the original pending forever
    // and the circulation could never complete (review §6.3).
    const open = await findOpenReferral(selected.value.id)
    if (open) {
      await dmApi.respondConsultation(open.id, {
        response_status: a.verdict === 'conditional' ? 'conditional_approval' : a.verdict,
        response_notes: [summariseChecks(), a.notes].filter(Boolean).join('\n\n'),
        response_received_at: new Date().toISOString(),
      })
    } else {
      await dmApi.createConsultation(selected.value.id, {
        department: 'environmental_health',
        outcome: a.verdict,
        response: summariseChecks(),
        notes: a.notes || null,
      })
    }
    a.reviewedAt = new Date().toISOString()
    hc.save()
    fb.showToast(open ? 'Response filed — the referral is closed.' : 'Response filed against the permit.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The response could not be filed. The draft is kept on this device.'), 'error')
  } finally {
    filing.value = false
  }
}

async function findOpenReferral(permitId: string) {
  try {
    const list = await dmApi.listConsultations(permitId)
    return list.find(c => {
      const status = c.response_status ?? c.outcome
      return matchesReferralDepartment(c, ['environmental']) && (!status || status === 'pending')
    }) ?? null
  } catch {
    // A failed lookup must not stop the officer recording a finding.
    return null
  }
}

const VERDICTS: { v: PlanAppraisalCheck['verdict']; l: string; cls: string }[] = [
  { v: 'no_objection', l: 'No objection', cls: 't-positive' },
  { v: 'conditional', l: 'Conditional', cls: '' },
  { v: 'objection', l: 'Objection', cls: 't-negative' },
]
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">One-Stop-Shop circulation · Model Building By-Laws</span>
        <h2 class="ins-title">Plan appraisal</h2>
        <p class="ins-lede">Building plans referred for environmental health comment. The checklist is saved on this device as you work and filed as one response.</p>
      </div>
      <div class="ins-actions">
        <button type="button" class="ins-iconbtn" :disabled="loading" title="Reload" @click="loadPermits">
          <RefreshCw :size="15" :class="{ 'ins-spin': loading }" aria-hidden="true" /><span class="ent-sr-only">Reload permits</span>
        </button>
      </div>
    </header>

    <div class="ins-split" :class="{ 'pa-has-selection': selected }">
      <aside class="ins-card ins-sticky pa-list" aria-label="Permits in circulation">
        <div class="ins-card-body pa-tools">
          <label class="ins-search"><Search :size="15" aria-hidden="true" /><span class="ent-sr-only">Search permits</span>
            <input v-model="search" type="search" placeholder="Register no, applicant, stand" /></label>
        </div>
        <ul v-if="loading" class="ins-rows" aria-busy="true">
          <li v-for="i in 4" :key="i" class="ins-row"><span class="ins-skel" style="width:70%" /></li>
        </ul>
        <p v-else-if="loadError" class="ins-banner t-negative pa-m"><CloudOff :size="15" aria-hidden="true" /><span>{{ loadError }}</span></p>
        <p v-else-if="!filteredPermits.length" class="pa-empty">
          {{ permits.length ? 'No permits match.' : 'No building plans are in circulation.' }}
        </p>
        <ul v-else class="ins-rows pa-scroll">
          <li v-for="p in filteredPermits" :key="p.id">
            <button type="button" class="pa-permit" :class="{ on: p.id === selectedId }" @click="nav.setParam('permit', p.id)">
              <span class="ins-row-main">
                <span class="ins-row-title">{{ p.applicant_name }}</span>
                <span class="ins-row-meta">{{ p.dev_register_no || '—' }} · Stand {{ p.stand_number || '—' }}</span>
              </span>
              <span class="pa-age">{{ daysSince(p.created_at) }}d</span>
            </button>
          </li>
        </ul>
      </aside>

      <section v-if="selected && appraisal" class="pa-work" :aria-label="`Appraisal for ${selected.applicant_name}`">
        <button type="button" class="pa-back" @click="nav.setParam('permit', null)"><ArrowLeft :size="15" aria-hidden="true" /> Permits</button>

        <div class="ins-card">
          <div class="ins-card-head">
            <h3><FileText :size="16" aria-hidden="true" /> {{ selected.applicant_name }}</h3>
            <UiStatusBadge :status="selected.status" />
          </div>
          <div class="ins-card-body">
            <dl class="ins-dl">
              <div><dt>Register no</dt><dd class="ins-mono">{{ selected.dev_register_no || '—' }}</dd></div>
              <div><dt>Stand</dt><dd>{{ selected.stand_number || '—' }}</dd></div>
              <div><dt>Submitted</dt><dd>{{ fmtDate(selected.created_at) }}</dd></div>
              <div><dt>Plans</dt><dd>{{ plansLoading ? 'Loading…' : `${plans.length} revision${plans.length === 1 ? '' : 's'}` }}</dd></div>
            </dl>
            <p v-if="appraisal.reviewedAt" class="ins-banner t-positive pa-mt">
              <Send :size="15" aria-hidden="true" /><span>Response filed {{ fmtDateTime(appraisal.reviewedAt) }}. Filing again answers with the revised checklist.</span>
            </p>
          </div>
        </div>

        <!-- Progress -->
        <div class="ins-card pa-progress">
          <div class="pa-progress-top">
            <strong>{{ metCount }} of {{ ALL_KEYS.length }} requirements met</strong>
            <span class="ins-hint">Draft saved on this device</span>
          </div>
          <div class="ins-bar" :class="{ 't-positive': metCount === ALL_KEYS.length }" role="progressbar"
               :aria-valuenow="metCount" aria-valuemin="0" :aria-valuemax="ALL_KEYS.length" aria-label="Requirements met">
            <span :style="{ '--fill': metCount / ALL_KEYS.length }" />
          </div>
        </div>

        <section v-for="g in GROUPS" :key="g.group" class="ins-card" :aria-label="g.group">
          <div class="ins-card-head">
            <h3><component :is="g.icon" :size="16" aria-hidden="true" /> {{ g.group }}</h3>
            <span class="ins-count">{{ groupMet(g) }}/{{ g.items.length }}</span>
            <button type="button" class="pa-all" @click="setGroup(g, groupMet(g) !== g.items.length)">
              {{ groupMet(g) === g.items.length ? 'Clear all' : 'All met' }}
            </button>
          </div>
          <div class="ins-card-body">
            <ul class="ins-checks">
              <li v-for="i in g.items" :key="i.key">
                <label class="ins-check" :class="{ on: appraisal[i.key] }">
                  <input v-model="appraisal[i.key]" type="checkbox" />
                  <span><strong>{{ i.label }}</strong><small v-if="i.hint">{{ i.hint }}</small></span>
                </label>
              </li>
            </ul>
            <details v-if="g.group.startsWith('Floor')" class="pa-standards">
              <summary><Info :size="13" aria-hidden="true" /> Minimum floor areas by use</summary>
              <ul><li v-for="s in MIN_FLOOR_AREAS" :key="s.use"><strong>{{ s.label }}</strong> — {{ s.rule }}</li></ul>
            </details>
          </div>
        </section>

        <form class="ins-card" aria-label="Response" @submit.prevent="fileResponse">
          <div class="ins-card-head"><h3><ClipboardCheck :size="16" aria-hidden="true" /> Response</h3></div>
          <div class="ins-card-body ins-form">
            <div class="ins-field full"><span class="ins-label">Environmental health response</span>
              <div class="ins-seg" role="radiogroup" aria-label="Response">
                <button v-for="v in VERDICTS" :key="v.v" type="button" role="radio" :class="v.cls"
                        :aria-checked="appraisal.verdict === v.v" @click="appraisal.verdict = v.v">{{ v.l }}</button>
              </div>
              <p v-if="verdictWarning" class="ins-banner t-warning pa-mt"><Info :size="15" aria-hidden="true" /><span>{{ verdictWarning }}</span></p>
            </div>
            <label v-if="appraisal.verdict === 'conditional'" class="ins-field full"><span class="ins-label">Conditions</span>
              <textarea v-model="appraisal.conditions" class="ins-input" rows="3"
                placeholder="Install a grease trap before commissioning; hot water to staff basins; tile the butchery to 1.8 m." /></label>
            <label class="ins-field full"><span class="ins-label">{{ appraisal.verdict === 'objection' ? 'Grounds of objection' : 'Notes' }}</span>
              <textarea v-model="appraisal.notes" class="ins-input" rows="3" placeholder="Observations, queries to the applicant, references to the minimum requirements…" /></label>
            <label class="ins-field"><span class="ins-label">Reviewing officer</span>
              <input v-model="appraisal.reviewedBy" class="ins-input" autocomplete="name" /></label>
          </div>
          <div class="ins-card-foot">
            <UiButton variant="primary" type="submit" :loading="filing"><template #icon><Send :size="15" /></template>File response</UiButton>
          </div>
        </form>
      </section>

      <div v-else class="ins-card pa-placeholder">
        <ClipboardCheck :size="28" aria-hidden="true" />
        <p><strong>Choose a permit</strong></p>
        <p class="ins-hint">Its checklist opens here, resuming any draft saved on this device.</p>
      </div>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.pa-tools { border-bottom:1px solid var(--ent-line); }
.pa-list { overflow:hidden; }
.pa-scroll { max-height:calc(var(--ent-vh) - 20rem); min-height:10rem; overflow-y:auto; }
.pa-empty { margin:0; padding:var(--ent-s5) var(--ent-s4); font-size:var(--ent-fs-sm); color:var(--ent-text-3); }
.pa-m { margin:var(--ent-s3); }
.pa-mt { margin-top:var(--ent-s3); }

.pa-permit { display:flex; align-items:center; gap:var(--ent-s3); width:100%;
  padding:var(--ent-s3) var(--ent-s4); border:0; border-top:1px solid var(--ent-line); border-left:3px solid transparent;
  background:transparent; text-align:left; cursor:pointer; font-family:var(--ent-font); }
li:first-child > .pa-permit { border-top:0; }
.pa-permit:hover { background:var(--ent-surface-2); }
.pa-permit:focus-visible { outline:none; box-shadow:inset var(--ent-focus-ring); }
.pa-permit.on { background:var(--ent-accent-soft); border-left-color:var(--ent-accent); }
.pa-age { flex-shrink:0; font-size:var(--ent-fs-xs); font-variant-numeric:tabular-nums; color:var(--ent-text-3); }

.pa-work { display:flex; flex-direction:column; gap:var(--ent-s4); min-width:0; }
.pa-back { display:none; }
.pa-progress { padding:var(--ent-s4); display:flex; flex-direction:column; gap:var(--ent-s2); position:sticky; top:0; z-index:var(--ent-z-sticky, 5); }
.pa-progress-top { display:flex; align-items:baseline; justify-content:space-between; gap:var(--ent-s2); font-size:var(--ent-fs-sm); }
.pa-all { border:0; background:none; cursor:pointer; padding:var(--ent-s1) var(--ent-s2); border-radius:var(--ent-r-sm);
  font-family:var(--ent-font); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); color:var(--ent-accent); }
.pa-all:hover { background:var(--ent-accent-soft); }
.pa-all:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.pa-standards { margin-top:var(--ent-s3); font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.pa-standards summary { display:inline-flex; align-items:center; gap:var(--ent-s1); cursor:pointer; color:var(--ent-accent); font-weight:var(--ent-fw-semibold); }
.pa-standards ul { margin:var(--ent-s2) 0 0; padding-left:var(--ent-s5); display:flex; flex-direction:column; gap:var(--ent-s1); }

.pa-placeholder { display:flex; flex-direction:column; align-items:center; justify-content:center; gap:var(--ent-s1);
  min-height:18rem; padding:var(--ent-s6); text-align:center; color:var(--ent-text-3); }
.pa-placeholder p { margin:0; }
.pa-placeholder strong { color:var(--ent-text); }

@media (max-width: 1023px) {
  .pa-has-selection > .pa-list { display:none; }
  .pa-back { display:inline-flex; align-items:center; gap:var(--ent-s1); align-self:flex-start; border:0; background:none; padding:var(--ent-s1) 0;
    cursor:pointer; font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-accent); }
  .pa-scroll { max-height:none; }
  .pa-placeholder { display:none; }
}
</style>
