<script setup lang="ts">
// Field programmes — the recurring public-health work of a rural district:
//
//   Waste        refuse collection rounds, illegal dump clearance, disposal site checks
//   Sanitation   VIP / Blair latrine construction, water point maintenance
//   Vector       indoor residual spraying, larviciding, rodent control
//   Education    health education campaigns
//
// Each round is planned with a target in a stated unit (households sprayed,
// latrines built) and closed with what was achieved. Coverage — achieved over
// target, per programme, for the year — is what the Ministry return asks for,
// so it is shown here rather than reconstructed from paper at year end.
//
// Online only: a round is planned at the office. Its completion can be
// recorded from the field, but a failed save says so and keeps the form open.
//
// URL: ?tab=waste|sanitation|vector|education

import { computed, onMounted, ref, watch } from 'vue'
import {
  ehoOpsApi, PROGRAMME_LABELS, PROGRAMME_DEFAULT_UNITS, PROGRAMME_GROUPS,
  type FieldProgramme, type ProgrammeType, type ProgrammeGroup, type ProgrammeStatus,
} from '@/services/environmentalHealthOps'
import { useAuthStore } from '@/stores/auth'
import { useEhoNav } from '@/environment-officer/useEhoNav'
import { fmtDate, humanise, isoDay, daysUntil, wardLabel } from '@/environment-officer/console'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import {
  Trash2, Droplets, Bug, Megaphone, Plus, RefreshCw, CloudOff, Play, CheckCircle2, Ban, Users, MapPin,
} from 'lucide-vue-next'

const fb = useUiFeedback()
const nav = useEhoNav()
const auth = useAuthStore()

const GROUPS: { key: ProgrammeGroup; label: string; icon: typeof Trash2; lede: string }[] = [
  { key: 'waste', label: 'Waste', icon: Trash2, lede: 'Refuse collection, illegal dumping and the disposal site.' },
  { key: 'sanitation', label: 'Sanitation', icon: Droplets, lede: 'Household latrines and community water points.' },
  { key: 'vector', label: 'Vector control', icon: Bug, lede: 'Indoor residual spraying, larviciding and rodent control.' },
  { key: 'education', label: 'Health education', icon: Megaphone, lede: 'Campaigns in schools, clinics and villages.' },
]
const tab = computed<ProgrammeGroup>(() => {
  const t = nav.param('tab')
  return GROUPS.some(g => g.key === t) ? (t as ProgrammeGroup) : 'waste'
})
function setTab(t: ProgrammeGroup) { nav.setParam('tab', t === 'waste' ? null : t) }
const group = computed(() => GROUPS.find(g => g.key === tab.value)!)
const groupTypes = computed<readonly ProgrammeType[]>(() => PROGRAMME_GROUPS[tab.value])

// ── Load the year ───────────────────────────────────────────────────
const year = new Date().getFullYear()
const rounds = ref<FieldProgramme[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

async function load() {
  loading.value = true
  loadError.value = null
  try {
    rounds.value = await ehoOpsApi.listProgrammes({ from: `${year}-01-01`, to: `${year + 1}-12-31`, limit: 500 })
  } catch (err: unknown) {
    loadError.value = fb.parseApiError(err, 'Programme rounds could not be loaded.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

const inGroup = computed(() => rounds.value.filter(r => groupTypes.value.includes(r.programmeType)))

const statusFilter = ref<'active' | 'completed' | 'all'>('active')
const ward = ref('')
const wards = computed(() => [...new Set(inGroup.value.map(r => r.ward))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })))

const shown = computed(() => {
  let arr = inGroup.value
  if (statusFilter.value === 'active') arr = arr.filter(r => r.status === 'planned' || r.status === 'in_progress')
  else if (statusFilter.value === 'completed') arr = arr.filter(r => r.status === 'completed' || r.status === 'cancelled')
  if (ward.value) arr = arr.filter(r => r.ward === ward.value)
  // Active work soonest first; history newest first.
  return [...arr].sort((a, b) => statusFilter.value === 'active'
    ? a.scheduledFor.localeCompare(b.scheduledFor)
    : b.scheduledFor.localeCompare(a.scheduledFor))
})

const tabCounts = computed(() => Object.fromEntries(GROUPS.map(g => [
  g.key,
  rounds.value.filter(r => (PROGRAMME_GROUPS[g.key] as readonly string[]).includes(r.programmeType)
    && (r.status === 'planned' || r.status === 'in_progress') && (daysUntil(r.scheduledFor) ?? 1) <= 0).length,
])) as Record<ProgrammeGroup, number>)

// ── Coverage (this year, per programme type) ────────────────────────
interface Coverage { type: ProgrammeType; unit: string; target: number; achieved: number; completed: number; planned: number }
const coverage = computed<Coverage[]>(() => groupTypes.value.map(type => {
  const rs = inGroup.value.filter(r => r.programmeType === type && r.scheduledFor.startsWith(String(year)) && r.status !== 'cancelled')
  // Coverage is only summed within one unit; a round counted in a different
  // unit is not added to the total, because the sum would mean nothing.
  const unit = rs.find(r => r.quantityUnit)?.quantityUnit ?? PROGRAMME_DEFAULT_UNITS[type]
  const same = rs.filter(r => (r.quantityUnit ?? unit) === unit)
  return {
    type, unit,
    target: same.reduce((s, r) => s + (r.targetQuantity ?? 0), 0),
    achieved: same.filter(r => r.status === 'completed').reduce((s, r) => s + (r.achievedQuantity ?? 0), 0),
    completed: rs.filter(r => r.status === 'completed').length,
    planned: rs.length,
  }
}))
const pct = (c: Coverage) => (c.target > 0 ? Math.min(1, c.achieved / c.target) : 0)

// ── Plan a round ────────────────────────────────────────────────────
const planOpen = ref(false)
const saving = ref(false)
const blankPlan = () => {
  const type = groupTypes.value[0]
  return {
    programmeType: type as ProgrammeType, title: '', titleTouched: false, ward: '', villageOrArea: '',
    scheduledFor: isoDay(), target: '' as string | number, quantityUnit: PROGRAMME_DEFAULT_UNITS[type],
    teamLead: auth.userName || '', teamSize: '' as string | number, notes: '',
  }
}
const plan = ref(blankPlan())
watch(() => plan.value.programmeType, (t) => { plan.value.quantityUnit = PROGRAMME_DEFAULT_UNITS[t] })
// Suggest a title until the officer writes their own.
watch(() => [plan.value.programmeType, plan.value.ward, plan.value.villageOrArea], () => {
  if (plan.value.titleTouched) return
  const where = [plan.value.ward && wardLabel(plan.value.ward), plan.value.villageOrArea].filter(Boolean).join(', ')
  plan.value.title = where ? `${PROGRAMME_LABELS[plan.value.programmeType]} — ${where}` : ''
})
function openPlan() { plan.value = blankPlan(); planOpen.value = true }

async function submitPlan() {
  const f = plan.value
  if (!f.ward.trim()) return fb.showToast('Which ward is the round in?', 'warning')
  if (!f.title.trim()) return fb.showToast('Give the round a title.', 'warning')
  if (!f.scheduledFor) return fb.showToast('Choose the date the round is scheduled for.', 'warning')
  const target = f.target === '' ? null : Number(f.target)
  if (target !== null && (!Number.isInteger(target) || target < 0)) return fb.showToast('The target must be a whole number.', 'warning')
  if (target !== null && !f.quantityUnit.trim()) return fb.showToast('Say what the target counts — households, latrines, people.', 'warning')
  const size = f.teamSize === '' ? null : Number(f.teamSize)
  if (size !== null && (!Number.isInteger(size) || size < 0 || size > 500)) return fb.showToast('Team size must be 0–500.', 'warning')

  saving.value = true
  try {
    const r = await ehoOpsApi.createProgramme({
      programmeType: f.programmeType, title: f.title.trim(), ward: f.ward.trim(),
      villageOrArea: f.villageOrArea.trim() || null, scheduledFor: f.scheduledFor,
      targetQuantity: target, quantityUnit: target !== null ? f.quantityUnit.trim() : null,
      teamLead: f.teamLead.trim() || null, teamSize: size, notes: f.notes.trim() || null,
    })
    rounds.value = [r, ...rounds.value]
    planOpen.value = false
    fb.showToast(`${r.reference} planned for ${fmtDate(r.scheduledFor)}.`, 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The round could not be saved.'), 'error')
  } finally {
    saving.value = false
  }
}

// ── Progress a round ────────────────────────────────────────────────
const acting = ref<FieldProgramme | null>(null)
const actMode = ref<'complete' | 'cancel'>('complete')
const act = ref({ achieved: '' as string | number, executedOn: isoDay(), notes: '', reason: '' })

async function update(r: FieldProgramme, body: Parameters<typeof ehoOpsApi.updateProgramme>[1], done: string) {
  saving.value = true
  try {
    const updated = await ehoOpsApi.updateProgramme(r.id, body)
    rounds.value = rounds.value.map(x => (x.id === r.id ? updated : x))
    acting.value = null
    fb.showToast(done, 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The round could not be updated.'), 'error')
  } finally {
    saving.value = false
  }
}
function start(r: FieldProgramme) { void update(r, { status: 'in_progress' }, 'Round started.') }
function openComplete(r: FieldProgramme) {
  acting.value = r; actMode.value = 'complete'
  act.value = { achieved: r.targetQuantity ?? '', executedOn: isoDay(), notes: r.notes ?? '', reason: '' }
}
function openCancel(r: FieldProgramme) {
  acting.value = r; actMode.value = 'cancel'
  act.value = { achieved: '', executedOn: isoDay(), notes: '', reason: '' }
}
function submitAct() {
  const r = acting.value
  if (!r) return
  if (actMode.value === 'cancel') {
    if (act.value.reason.trim().length < 5) return fb.showToast('A cancelled round must say why — the report states it.', 'warning')
    return void update(r, { status: 'cancelled', cancelledReason: act.value.reason.trim() }, 'Round cancelled.')
  }
  const achieved = act.value.achieved === '' ? null : Number(act.value.achieved)
  if (achieved !== null && (!Number.isInteger(achieved) || achieved < 0)) return fb.showToast('Achieved must be a whole number.', 'warning')
  if (act.value.executedOn > isoDay()) return fb.showToast('A round cannot be completed on a future date.', 'warning')
  void update(r, {
    status: 'completed', achievedQuantity: achieved,
    quantityUnit: achieved !== null ? (r.quantityUnit ?? PROGRAMME_DEFAULT_UNITS[r.programmeType]) : undefined,
    executedAt: new Date(`${act.value.executedOn}T12:00:00`).toISOString(),
    notes: act.value.notes.trim() || null,
  }, 'Round completed.')
}

const STATUS_TONE: Record<ProgrammeStatus, 'info' | 'warning' | 'positive' | 'neutral'> =
  { planned: 'info', in_progress: 'warning', completed: 'positive', cancelled: 'neutral' }
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">District programmes · {{ year }}</span>
        <h2 class="ins-title">Field programmes</h2>
        <p class="ins-lede">{{ group.lede }} Plan each round with a target, close it with what was achieved.</p>
      </div>
      <div class="ins-actions">
        <button type="button" class="ins-iconbtn" :disabled="loading" title="Reload" @click="load">
          <RefreshCw :size="15" :class="{ 'ins-spin': loading }" aria-hidden="true" /><span class="ent-sr-only">Reload rounds</span>
        </button>
        <UiButton variant="primary" @click="openPlan"><template #icon><Plus :size="15" /></template>Plan round</UiButton>
      </div>
    </header>

    <div class="ins-seg ep-tabs" role="tablist" aria-label="Programme groups">
      <button v-for="g in GROUPS" :key="g.key" type="button" role="tab" :aria-selected="tab === g.key" @click="setTab(g.key)">
        <component :is="g.icon" :size="14" aria-hidden="true" /> {{ g.label }}
        <span v-if="tabCounts[g.key]" class="ep-pill">{{ tabCounts[g.key] }}</span>
      </button>
    </div>

    <p v-if="loadError" class="ins-banner t-negative">
      <CloudOff :size="16" aria-hidden="true" /><span><strong>{{ loadError }}</strong> Rounds are not shown as empty while the server is unreachable.</span>
    </p>

    <!-- Coverage -->
    <section v-if="!loadError" class="ep-coverage" aria-label="Coverage this year">
      <div v-for="c in coverage" :key="c.type" class="ins-card ep-cov">
        <span class="ep-cov-label">{{ PROGRAMME_LABELS[c.type] }}</span>
        <template v-if="loading"><span class="ins-skel" style="width:50%;height:22px" /></template>
        <template v-else>
          <span class="ep-cov-num">
            {{ c.achieved.toLocaleString('en-GB') }}
            <small v-if="c.target">of {{ c.target.toLocaleString('en-GB') }} {{ c.unit }}</small>
            <small v-else>{{ c.unit }}</small>
          </span>
          <div v-if="c.target" class="ins-bar" :class="{ 't-positive': pct(c) >= 1 }" role="progressbar"
               :aria-valuenow="Math.round(pct(c) * 100)" aria-valuemin="0" aria-valuemax="100"
               :aria-label="`${PROGRAMME_LABELS[c.type]} coverage`">
            <span :style="{ '--fill': pct(c) }" />
          </div>
          <span class="ep-cov-meta">{{ c.completed }} of {{ c.planned }} round{{ c.planned === 1 ? '' : 's' }} completed</span>
        </template>
      </div>
    </section>

    <!-- Rounds -->
    <section class="ins-card" aria-label="Rounds">
      <div class="ins-card-head ep-head">
        <div class="ins-chips" role="group" aria-label="Show">
          <button type="button" class="ins-chip" :aria-pressed="statusFilter === 'active'" @click="statusFilter = 'active'">Planned &amp; running</button>
          <button type="button" class="ins-chip" :aria-pressed="statusFilter === 'completed'" @click="statusFilter = 'completed'">Closed</button>
          <button type="button" class="ins-chip" :aria-pressed="statusFilter === 'all'" @click="statusFilter = 'all'">All</button>
        </div>
        <select v-if="wards.length > 1" v-model="ward" class="ins-input ep-ward" aria-label="Ward">
          <option value="">All wards</option>
          <option v-for="w in wards" :key="w" :value="w">{{ wardLabel(w) }}</option>
        </select>
      </div>

      <ul v-if="loading && !rounds.length" class="ins-rows" aria-busy="true">
        <li v-for="i in 3" :key="i" class="ins-row"><span class="ins-skel" style="width:60%" /></li>
      </ul>
      <p v-else-if="!shown.length && !loadError" class="ep-empty">
        <template v-if="statusFilter === 'active'">No {{ group.label.toLowerCase() }} rounds planned. Plan the next one so it appears on the dashboard the day it is due.</template>
        <template v-else>No rounds match.</template>
      </p>
      <ul v-else class="ins-rows">
        <li v-for="r in shown" :key="r.id" class="ins-row ep-row" :class="{ due: (r.status === 'planned' || r.status === 'in_progress') && (daysUntil(r.scheduledFor) ?? 1) <= 0 }">
          <div class="ep-date" aria-hidden="true">
            <strong>{{ new Date(r.scheduledFor).getDate() }}</strong>
            <span>{{ new Date(r.scheduledFor).toLocaleDateString('en-GB', { month: 'short' }) }}</span>
          </div>
          <div class="ins-row-main">
            <span class="ins-row-title">{{ r.title }}</span>
            <span class="ins-row-meta ep-meta">
              <span>{{ PROGRAMME_LABELS[r.programmeType] }}</span>
              <span><MapPin :size="11" aria-hidden="true" /> {{ wardLabel(r.ward) }}<template v-if="r.villageOrArea">, {{ r.villageOrArea }}</template></span>
              <span v-if="r.teamLead"><Users :size="11" aria-hidden="true" /> {{ r.teamLead }}<template v-if="r.teamSize"> +{{ r.teamSize }}</template></span>
              <span class="ins-mono">{{ r.reference }}</span>
            </span>
            <span v-if="r.targetQuantity != null || r.achievedQuantity != null" class="ep-qty">
              <template v-if="r.status === 'completed'">{{ r.achievedQuantity ?? 0 }} of {{ r.targetQuantity ?? '—' }} {{ r.quantityUnit }}</template>
              <template v-else>Target {{ r.targetQuantity }} {{ r.quantityUnit }}</template>
            </span>
            <span v-if="r.cancelledReason" class="ep-qty">Cancelled: {{ r.cancelledReason }}</span>
          </div>
          <UiStatusBadge :tone="STATUS_TONE[r.status]" :label="humanise(r.status)" />
          <div class="ep-actions">
            <UiButton v-if="r.status === 'planned'" size="sm" @click="start(r)"><template #icon><Play :size="13" /></template>Start</UiButton>
            <UiButton v-if="r.status === 'planned' || r.status === 'in_progress'" size="sm" variant="primary" @click="openComplete(r)">
              <template #icon><CheckCircle2 :size="13" /></template>Complete</UiButton>
            <button v-if="r.status === 'planned' || r.status === 'in_progress'" type="button" class="ins-iconbtn" title="Cancel round" @click="openCancel(r)">
              <Ban :size="14" aria-hidden="true" /><span class="ent-sr-only">Cancel round</span>
            </button>
          </div>
        </li>
      </ul>
    </section>

    <!-- Plan -->
    <UiSheet :open="planOpen" title="Plan round" :subtitle="group.label" width="38rem" @update:open="planOpen = $event">
      <form id="ep-plan" class="ins-form" @submit.prevent="submitPlan">
        <div class="ins-field full"><span class="ins-label">Programme</span>
          <div class="ins-chips" role="radiogroup" aria-label="Programme">
            <button v-for="t in groupTypes" :key="t" type="button" class="ins-chip" role="radio"
                    :aria-checked="plan.programmeType === t" :aria-pressed="plan.programmeType === t"
                    @click="plan.programmeType = t">{{ PROGRAMME_LABELS[t] }}</button>
          </div></div>
        <label class="ins-field"><span class="ins-label">Ward</span><input v-model="plan.ward" class="ins-input" placeholder="e.g. 7" /></label>
        <label class="ins-field"><span class="ins-label">Village or area</span><input v-model="plan.villageOrArea" class="ins-input" /></label>
        <label class="ins-field full"><span class="ins-label">Title</span>
          <input v-model="plan.title" class="ins-input" @input="plan.titleTouched = true" /></label>
        <label class="ins-field"><span class="ins-label">Scheduled for</span><input v-model="plan.scheduledFor" type="date" class="ins-input" /></label>
        <div class="ins-field ep-target">
          <label class="ins-field"><span class="ins-label">Target</span><input v-model="plan.target" inputmode="numeric" class="ins-input" placeholder="Optional" /></label>
          <label class="ins-field"><span class="ins-label">Counted in</span><input v-model="plan.quantityUnit" class="ins-input" /></label>
        </div>
        <label class="ins-field"><span class="ins-label">Team lead</span><input v-model="plan.teamLead" class="ins-input" /></label>
        <label class="ins-field"><span class="ins-label">Team size</span><input v-model="plan.teamSize" inputmode="numeric" class="ins-input" /></label>
        <label class="ins-field full"><span class="ins-label">Notes</span><textarea v-model="plan.notes" class="ins-input" rows="2" placeholder="Chemicals, transport, village heads informed…" /></label>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="planOpen = false">Cancel</UiButton>
        <UiButton variant="primary" type="submit" form="ep-plan" :loading="saving">Plan round</UiButton>
      </template>
    </UiSheet>

    <!-- Complete / cancel -->
    <UiSheet :open="!!acting" :title="actMode === 'complete' ? 'Complete round' : 'Cancel round'" :subtitle="acting?.title"
             width="32rem" @update:open="v => { if (!v) acting = null }">
      <form id="ep-act" class="ins-form" @submit.prevent="submitAct">
        <template v-if="actMode === 'complete' && acting">
          <label class="ins-field"><span class="ins-label">Achieved ({{ acting.quantityUnit || PROGRAMME_DEFAULT_UNITS[acting.programmeType] }})</span>
            <input v-model="act.achieved" inputmode="numeric" class="ins-input" /></label>
          <label class="ins-field"><span class="ins-label">Carried out on</span>
            <input v-model="act.executedOn" type="date" :max="isoDay()" class="ins-input" /></label>
          <label class="ins-field full"><span class="ins-label">Notes</span>
            <textarea v-model="act.notes" class="ins-input" rows="3" placeholder="Refusals, households absent, stock used…" /></label>
        </template>
        <label v-else class="ins-field full"><span class="ins-label">Why the round did not run</span>
          <textarea v-model="act.reason" class="ins-input" rows="3" placeholder="No transport; chemicals not delivered; rains…" /></label>
      </form>
      <template #footer>
        <UiButton variant="ghost" @click="acting = null">Back</UiButton>
        <UiButton :variant="actMode === 'complete' ? 'primary' : 'danger'" type="submit" form="ep-act" :loading="saving">
          {{ actMode === 'complete' ? 'Complete round' : 'Cancel round' }}</UiButton>
      </template>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.ep-tabs { flex-wrap:wrap; }
.ep-pill { min-width:1.2rem; padding:0 5px; border-radius:var(--ent-r-pill); font-size:var(--ent-fs-micro);
  font-weight:var(--ent-fw-semibold); line-height:1.2rem; color:var(--ent-tone-warning-fg); background:var(--ent-tone-warning-bg); }

.ep-coverage { display:grid; grid-template-columns:repeat(auto-fit, minmax(min(100%, 15rem), 1fr)); gap:var(--ent-s3); }
.ep-cov { display:flex; flex-direction:column; gap:var(--ent-s2); padding:var(--ent-s4); box-shadow:none; }
.ep-cov-label { font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); color:var(--ent-text-2); }
.ep-cov-num { font-size:var(--ent-fs-lg); font-weight:var(--ent-fw-bold); font-variant-numeric:tabular-nums; color:var(--ent-text); }
.ep-cov-num small { margin-left:var(--ent-s1); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-medium); color:var(--ent-text-3); }
.ep-cov-meta { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }

.ep-head { justify-content:space-between; }
.ep-ward { width:auto; min-height:30px; font-size:var(--ent-fs-sm); }
.ep-empty { margin:0; padding:var(--ent-s5) var(--ent-s4); font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }

.ep-row { align-items:flex-start; flex-wrap:wrap; border-left:3px solid transparent; }
.ep-row.due { border-left-color:var(--ent-warning); }
.ep-date { display:flex; flex-direction:column; align-items:center; justify-content:center; flex-shrink:0;
  width:3rem; padding:var(--ent-s1) 0; border:1px solid var(--ent-line); border-radius:var(--ent-r); background:var(--ent-surface-2); }
.ep-date strong { font-size:var(--ent-fs-md); line-height:1.1; font-variant-numeric:tabular-nums; color:var(--ent-text); }
.ep-date span { font-size:var(--ent-fs-micro); text-transform:uppercase; letter-spacing:0.04em; color:var(--ent-text-3); }
.ep-meta { display:flex; flex-wrap:wrap; gap:var(--ent-s1) var(--ent-s3); white-space:normal; }
.ep-meta > span { display:inline-flex; align-items:center; gap:3px; }
.ep-qty { display:block; margin-top:var(--ent-s1); font-size:var(--ent-fs-xs); font-weight:var(--ent-fw-semibold); color:var(--ent-text-2); }
.ep-actions { display:flex; align-items:center; gap:var(--ent-s2); }
.ep-target { display:grid; grid-template-columns:1fr 1.4fr; gap:var(--ent-s2); }

@media (max-width: 767px) {
  .ep-actions { width:100%; justify-content:flex-end; }
}
</style>
