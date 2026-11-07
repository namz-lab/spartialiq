<script setup lang="ts">
// Forward planning — master and local plans (RTCP Act [Ch. 29:12] Part IV).
//
// Prepare → exhibit → consider objections → submit. The planner keeps the
// study of the planning area current, writes the plan, logs consultation,
// runs the exhibition, answers each objection and produces the report on
// objections. Approval and operation belong to the authority (plan.determine,
// held by no application role), so the planner's lifecycle stops at submission.
//
// Persistence: /api/statutory/plans stores the plan as one document (migration
// 101), so every field here is on the server once saved.
import { computed, ref, watch } from 'vue'
import { usePlans } from '@/statutory/composables/usePlans'
import { PLAN_LIFECYCLE, type AnyPlan, type PlanKind } from '@/statutory/types/plans'
import { nowIso } from '@/statutory/types/common'
import { useAuthStore } from '@/stores/auth'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { planGate, studyTopics, isStale, STUDY_TOPICS } from '../forwardPlanning'
import { reportOnObjections, renderDraftPdf } from '../plannerDocuments'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { Plus, RefreshCw, Save, FileDown, ArrowRight, Trash2 } from 'lucide-vue-next'

type Pane = 'study' | 'statement' | 'consultation' | 'exhibition' | 'objections'

const plansApi = usePlans()
const auth = useAuthStore()
const fb = useUiFeedback()
const officer = computed(() => auth.user?.name || auth.user?.email || 'Town Planning Officer')

const register = computed(() => plansApi.plans.value.filter(p => p.kind === 'master' || p.kind === 'local'))
const masters = computed(() => register.value.filter(p => p.kind === 'master'))
const selectedId = ref<string | null>(null)
const plan = computed<AnyPlan | null>(() => register.value.find(p => p.id === selectedId.value) ?? null)
watch(register, (list) => { if (!selectedId.value && list.length) selectedId.value = list[0].id }, { immediate: true })

const pane = ref<Pane>('study')
const dirty = ref(false)
const saving = ref(false)
watch(selectedId, () => { dirty.value = false; pane.value = 'study' })
const touch = () => { dirty.value = true }

async function save(): Promise<boolean> {
  if (!plan.value) return false
  saving.value = true
  try {
    await plansApi.savePlan(plan.value)
    dirty.value = false
    fb.showToast('Plan saved', 'success')
    return true
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not save the plan', message: fb.parseApiError(e, 'The server rejected the plan.') })
    return false
  } finally {
    saving.value = false
  }
}

async function create(kind: PlanKind) {
  try {
    const p = await plansApi.createPlan(kind, { name: kind === 'master' ? 'Vungu District Master Plan' : 'New local plan' })
    selectedId.value = p.id
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not create the plan', message: fb.parseApiError(e, 'The server rejected it.') })
  }
}

// ── Study of the planning area ────────────────────────────────────────────
const topics = computed(() => plan.value ? studyTopics(plan.value) : [])
function editTopic(topic: string, findings: string) {
  const p = plan.value
  if (!p) return
  const list = studyTopics(p)
  const t = list.find(x => x.topic === topic)!
  t.findings = findings
  t.reviewedAt = nowIso()
  p.study = list.filter(x => x.findings.trim())
  touch()
}
const newTopic = ref('')
function addTopic() {
  const name = newTopic.value.trim()
  if (!plan.value || !name) return
  plan.value.study = [...(plan.value.study ?? []), { topic: name, findings: '' }]
  newTopic.value = ''
  touch()
}

// ── Written statement ─────────────────────────────────────────────────────
function addSection() {
  plan.value?.writtenStatement.sections.push({ heading: '', body: '' })
  touch()
}
function removeSection(i: number) {
  plan.value?.writtenStatement.sections.splice(i, 1)
  touch()
}

// ── Consultation ──────────────────────────────────────────────────────────
const consult = ref({ date: new Date().toISOString().slice(0, 10), stakeholder: '', method: 'Meeting', summary: '' })
function addConsultation() {
  const p = plan.value
  const c = consult.value
  if (!p || !c.stakeholder.trim() || !c.summary.trim()) return
  p.consultations = [...(p.consultations ?? []), { id: `c-${Date.now().toString(36)}`, ...c, stakeholder: c.stakeholder.trim(), summary: c.summary.trim() }]
  consult.value = { ...c, stakeholder: '', summary: '' }
  touch()
}

// ── Exhibition and objections ─────────────────────────────────────────────
function setExhibition(field: 'from' | 'to' | 'place', v: string) {
  const p = plan.value
  if (!p) return
  p.exhibition = { from: p.exhibition?.from ?? '', to: p.exhibition?.to ?? '', place: p.exhibition?.place ?? '', [field]: v }
  touch()
}
const newObj = ref({ objector: '', text: '', representation: false })
function addObjection() {
  const p = plan.value
  const o = newObj.value
  if (!p || !o.objector.trim() || !o.text.trim()) return
  p.objections.push({ id: `obj-${Date.now().toString(36)}`, objector: o.objector.trim(), text: o.text.trim(),
    representation: o.representation, status: 'open', receivedAt: nowIso() })
  newObj.value = { objector: '', text: '', representation: false }
  touch()
}
const objectionsOnly = computed(() => plan.value?.objections.filter(o => !o.representation) ?? [])

async function produceReport() {
  const p = plan.value
  if (!p) return
  const ex = p.exhibition?.from ? `from ${new Date(p.exhibition.from).toLocaleDateString('en-GB')} to ${new Date(p.exhibition.to).toLocaleDateString('en-GB')} at ${p.exhibition.place}` : ''
  renderDraftPdf(reportOnObjections(p.name, p.kind, ex, objectionsOnly.value.map(o => ({
    objector: o.objector, text: o.text, response: o.response ?? '', recommendation: o.recommendation ?? '',
  })), officer.value))
  p.objectionsReportAt = nowIso()
  touch()
  await save()
}

// ── Lifecycle ─────────────────────────────────────────────────────────────
const gate = computed(() => plan.value ? planGate(plan.value) : null)
async function advance() {
  const p = plan.value
  const g = gate.value
  if (!p || !g?.next || g.missing.length) return
  const ok = await fb.confirmAction(`${g.label}?`, `${p.name} moves to "${g.next}". This is recorded on the plan's audit trail.`, { confirmLabel: g.label })
  if (!ok) return
  if (dirty.value && !(await save())) return
  const moved = await plansApi.advanceStatus(p.id, g.next)
  if (moved) {
    p.audit[p.audit.length - 1].actor = officer.value
    p.audit[p.audit.length - 1].role = 'planner'
    await plansApi.savePlan(p)
    fb.showToast(`Plan moved to ${g.next}`, 'success')
  }
}

const fmt = (v?: string) => v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const STATUS_TONE: Record<string, 'neutral' | 'info' | 'warning' | 'positive'> = {
  draft: 'neutral', exhibition: 'info', objections: 'warning', submitted: 'info', approved: 'positive', operative: 'positive',
}
</script>

<template>
  <div class="fp">
    <header class="fp-head">
      <div>
        <h2>Forward planning</h2>
        <p>Study of the planning area, master and local plans · RTCP Act Part IV</p>
      </div>
      <UiButton size="sm" @click="plansApi.refresh()"><template #icon><RefreshCw :size="13" /></template>Refresh</UiButton>
      <UiButton size="sm" @click="create('master')"><template #icon><Plus :size="13" /></template>Master plan</UiButton>
      <UiButton size="sm" @click="create('local')"><template #icon><Plus :size="13" /></template>Local plan</UiButton>
    </header>
    <p v-if="plansApi.loadError.value" class="fp-error" role="alert">{{ plansApi.loadError.value }}</p>

    <div class="fp-split">
      <nav class="fp-register" aria-label="Plan register">
        <UiEmptyState v-if="!register.length" message="No master or local plans yet." sub="Start with the district master plan." />
        <button v-for="p in register" :key="p.id" type="button" class="fp-plan"
                :class="{ active: p.id === selectedId }" :aria-current="p.id === selectedId ? 'true' : undefined"
                @click="selectedId = p.id">
          <span class="fp-plan-name">{{ p.name }}</span>
          <span class="fp-plan-meta">{{ p.kind }} plan</span>
          <UiStatusBadge :tone="STATUS_TONE[p.status] ?? 'neutral'" :label="p.status" />
        </button>
      </nav>

      <section v-if="plan" class="fp-detail">
        <div class="fp-title">
          <input v-model="plan.name" class="fp-name" aria-label="Plan name" @input="touch" />
          <select v-if="plan.kind === 'local'" v-model="(plan as any).parentMasterPlanId" aria-label="Parent master plan" @change="touch">
            <option :value="undefined">No parent master plan</option>
            <option v-for="m in masters" :key="m.id" :value="m.id">{{ m.name }}</option>
          </select>
          <UiButton size="sm" variant="primary" :loading="saving" :disabled="!dirty" @click="save">
            <template #icon><Save :size="13" /></template>{{ dirty ? 'Save changes' : 'Saved' }}
          </UiButton>
        </div>

        <ol class="fp-life" aria-label="Plan lifecycle">
          <li v-for="s in PLAN_LIFECYCLE" :key="s" :class="{ done: PLAN_LIFECYCLE.indexOf(s) < PLAN_LIFECYCLE.indexOf(plan.status), current: s === plan.status }">{{ s }}</li>
        </ol>

        <div v-if="gate" class="fp-gate" :class="{ ready: gate.next && !gate.missing.length }">
          <strong>{{ gate.label }}</strong>
          <ul v-if="gate.missing.length"><li v-for="m in gate.missing" :key="m">{{ m }}</li></ul>
          <UiButton v-if="gate.next" size="sm" variant="primary" :disabled="gate.missing.length > 0" @click="advance">
            {{ gate.label }} <ArrowRight :size="12" aria-hidden="true" />
          </UiButton>
        </div>

        <nav class="fp-tabs" role="tablist" aria-label="Plan">
          <button v-for="t in ([['study','Study'],['statement','Written statement'],['consultation','Consultation'],['exhibition','Exhibition'],['objections','Objections']] as const)"
                  :key="t[0]" role="tab" :aria-selected="pane === t[0]" :class="{ active: pane === t[0] }" @click="pane = t[0]">{{ t[1] }}</button>
        </nav>

        <!-- Study -->
        <div v-if="pane === 'study'" class="fp-pane">
          <p class="fp-hint">Keep each topic current. A topic not reviewed for twelve months is flagged.</p>
          <div v-for="t in topics" :key="t.topic" class="fp-topic">
            <label :for="`st-${t.topic}`">
              {{ t.topic }}
              <span v-if="isStale(t)" class="fp-stale">{{ t.findings.trim() ? 'Out of date' : 'Not written' }}</span>
              <span v-else class="fp-fresh">Reviewed {{ fmt(t.reviewedAt) }}</span>
            </label>
            <textarea :id="`st-${t.topic}`" :value="t.findings" rows="3"
                      @change="editTopic(t.topic, ($event.target as HTMLTextAreaElement).value)" />
          </div>
          <div class="fp-inline">
            <input v-model="newTopic" placeholder="Add another topic" aria-label="New study topic" />
            <UiButton size="sm" :disabled="!newTopic.trim()" @click="addTopic">Add topic</UiButton>
          </div>
          <p class="fp-hint">{{ topics.filter(t => t.findings.trim()).length }} of {{ Math.max(topics.length, STUDY_TOPICS.length) }} topics written.</p>
        </div>

        <!-- Written statement -->
        <div v-else-if="pane === 'statement'" class="fp-pane">
          <div v-for="(s, i) in plan.writtenStatement.sections" :key="i" class="fp-topic">
            <div class="fp-inline">
              <input v-model="s.heading" :aria-label="`Section ${i + 1} heading`" placeholder="Heading, e.g. Proposals for residential land" @input="touch" />
              <button type="button" class="fp-x" :aria-label="`Remove section ${i + 1}`" @click="removeSection(i)"><Trash2 :size="14" /></button>
            </div>
            <textarea v-model="s.body" rows="5" :aria-label="`Section ${i + 1} text`" @input="touch" />
          </div>
          <UiButton size="sm" @click="addSection"><template #icon><Plus :size="12" /></template>Add section</UiButton>
        </div>

        <!-- Consultation -->
        <div v-else-if="pane === 'consultation'" class="fp-pane">
          <form class="fp-grid" @submit.prevent="addConsultation">
            <label>Date<input v-model="consult.date" type="date" /></label>
            <label>Method
              <select v-model="consult.method">
                <option>Meeting</option><option>Public meeting</option><option>Workshop</option>
                <option>Written submission</option><option>Ward councillor briefing</option>
              </select>
            </label>
            <label class="fp-wide">Stakeholder *<input v-model="consult.stakeholder" placeholder="e.g. Ward 7 residents, ZINWA, traditional leaders" /></label>
            <label class="fp-wide">Summary of views *<textarea v-model="consult.summary" rows="2" /></label>
            <UiButton type="submit" size="sm">Record consultation</UiButton>
          </form>
          <ul class="fp-log">
            <li v-for="c in [...(plan.consultations ?? [])].reverse()" :key="c.id">
              <strong>{{ fmt(c.date) }} · {{ c.stakeholder }}</strong> <span>{{ c.method }}</span>
              <p>{{ c.summary }}</p>
            </li>
          </ul>
        </div>

        <!-- Exhibition -->
        <div v-else-if="pane === 'exhibition'" class="fp-pane">
          <p class="fp-hint">The draft plan must be exhibited for at least one month, with notice of where and when it may be inspected.</p>
          <div class="fp-grid">
            <label>From<input type="date" :value="plan.exhibition?.from?.slice(0, 10)" @change="setExhibition('from', ($event.target as HTMLInputElement).value)" /></label>
            <label>To<input type="date" :value="plan.exhibition?.to?.slice(0, 10)" @change="setExhibition('to', ($event.target as HTMLInputElement).value)" /></label>
            <label class="fp-wide">Place of inspection<input :value="plan.exhibition?.place" placeholder="e.g. Council offices, Gweru Road; ward centres" @change="setExhibition('place', ($event.target as HTMLInputElement).value)" /></label>
          </div>
        </div>

        <!-- Objections -->
        <div v-else class="fp-pane">
          <form class="fp-grid" @submit.prevent="addObjection">
            <label>From *<input v-model="newObj.objector" /></label>
            <label class="fp-check"><input v-model="newObj.representation" type="checkbox" /> Representation in support</label>
            <label class="fp-wide">Objection *<textarea v-model="newObj.text" rows="2" /></label>
            <UiButton type="submit" size="sm">Log</UiButton>
          </form>
          <ul class="fp-log">
            <li v-for="o in plan.objections" :key="o.id">
              <strong>{{ o.objector }}</strong> <span>{{ o.representation ? 'representation' : 'objection' }} · {{ fmt(o.receivedAt) }}</span>
              <p>{{ o.text }}</p>
              <template v-if="!o.representation">
                <label>Planning response<textarea v-model="o.response" rows="2" @input="touch" /></label>
                <label>Recommendation<input v-model="o.recommendation" placeholder="e.g. Amend proposals map: retain the wetland as open space / No change" @input="touch" /></label>
              </template>
            </li>
          </ul>
          <div class="fp-inline">
            <UiButton size="sm" variant="primary" :disabled="!objectionsOnly.length" @click="produceReport">
              <template #icon><FileDown :size="12" /></template>Produce report on objections
            </UiButton>
            <span v-if="plan.objectionsReportAt" class="fp-fresh">Produced {{ fmt(plan.objectionsReportAt) }}</span>
          </div>
        </div>
      </section>
    </div>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.fp { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s3); min-height: 0; height: 100%; }
.fp-head { display: flex; align-items: flex-start; gap: var(--ent-s2); flex-wrap: wrap; }
.fp-head > div { flex: 1; min-width: 14rem; }
.fp-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); }
.fp-head p { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.fp-error { margin: 0; color: var(--ent-danger); font-size: var(--ent-fs-sm); }
.fp-split { display: grid; grid-template-columns: 16rem minmax(0, 1fr); gap: var(--ent-s4); flex: 1; min-height: 0; }
.fp-register { display: flex; flex-direction: column; gap: var(--ent-s1); overflow-y: auto; }
.fp-plan { display: grid; grid-template-columns: 1fr auto; gap: 2px var(--ent-s2); text-align: left; padding: var(--ent-s2) var(--ent-s3);
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); background: var(--ent-surface); font: inherit; color: var(--ent-text); cursor: pointer; }
.fp-plan.active { border-color: var(--ent-accent); box-shadow: inset 3px 0 0 var(--ent-accent); }
.fp-plan:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.fp-plan-name { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); grid-column: 1; }
.fp-plan-meta { font-size: var(--ent-fs-micro); color: var(--ent-text-3); grid-column: 1; text-transform: capitalize; }
.fp-plan :deep(.ui-badge) { grid-column: 2; grid-row: 1 / span 2; align-self: center; }
.fp-detail { display: flex; flex-direction: column; gap: var(--ent-s3); overflow-y: auto; min-height: 0; }
.fp-title { display: flex; gap: var(--ent-s2); align-items: center; flex-wrap: wrap; }
.fp-name { flex: 1; min-width: 12rem; font: inherit; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-bold); padding: var(--ent-s2); border: 1px solid transparent; border-radius: var(--ent-r-sm); background: transparent; color: var(--ent-text); }
.fp-name:hover, .fp-name:focus { border-color: var(--ent-line-strong); outline: none; background: var(--ent-surface); }
.fp-title select { font: inherit; font-size: var(--ent-fs-sm); padding: var(--ent-s2); border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); background: var(--ent-surface); color: var(--ent-text); }
.fp-life { list-style: none; margin: 0; padding: 0; display: flex; gap: 2px; flex-wrap: wrap; }
.fp-life li { flex: 1; min-width: 5.5rem; text-align: center; padding: var(--ent-s1) var(--ent-s2); font-size: var(--ent-fs-xs); text-transform: capitalize;
  background: var(--ent-surface-sunken); color: var(--ent-text-3); }
.fp-life li.done { background: var(--ent-success-soft); color: var(--ent-success); }
.fp-life li.current { background: var(--ent-accent); color: var(--ent-text-on-accent); font-weight: var(--ent-fw-semibold); }
.fp-gate { padding: var(--ent-s3); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); background: var(--ent-surface); display: flex; flex-direction: column; gap: var(--ent-s2); align-items: flex-start; font-size: var(--ent-fs-sm); }
.fp-gate ul { margin: 0; padding-left: 1.1rem; color: var(--ent-text-2); }
.fp-gate.ready { border-color: var(--ent-success); }
.fp-tabs { display: flex; gap: var(--ent-s1); border-bottom: 1px solid var(--ent-line); overflow-x: auto; overflow-y: hidden; }
.fp-tabs button { white-space: nowrap; min-height: var(--ent-touch-min); padding: var(--ent-s2) var(--ent-s3); font: inherit; font-size: var(--ent-fs-sm); color: var(--ent-text-2);
  background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; cursor: pointer; }
.fp-tabs button.active { color: var(--ent-accent); border-bottom-color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.fp-tabs button:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.fp-detail > * { flex-shrink: 0; }
.fp-pane { display: flex; flex-direction: column; gap: var(--ent-s3); }
.fp-hint { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.fp-topic { display: flex; flex-direction: column; gap: var(--ent-s1); }
.fp-topic label { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); display: flex; gap: var(--ent-s2); align-items: center; }
.fp-stale { font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); color: var(--ent-warning); }
.fp-fresh { font-size: var(--ent-fs-micro); color: var(--ent-text-3); font-weight: normal; }
.fp textarea, .fp input:not([type=checkbox]), .fp-grid select {
  font: inherit; font-size: var(--ent-fs-sm); padding: var(--ent-s2); color: var(--ent-text);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); background: var(--ent-surface); }
.fp textarea:focus, .fp input:focus, .fp-grid select:focus { outline: none; border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
.fp-inline { display: flex; gap: var(--ent-s2); align-items: center; flex-wrap: wrap; }
.fp-inline input { flex: 1; min-width: 12rem; }
.fp-x { min-width: var(--ent-touch-min); min-height: var(--ent-touch-min); display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm); background: var(--ent-surface); color: var(--ent-text-3); cursor: pointer; }
.fp-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ent-s2) var(--ent-s3); align-items: end; }
.fp-grid label { display: flex; flex-direction: column; gap: var(--ent-s1); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.fp-grid .fp-wide { grid-column: 1 / -1; }
.fp-grid .fp-check { flex-direction: row; align-items: center; gap: var(--ent-s2); }
.fp-log { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }
.fp-log li { padding: var(--ent-s3); background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); font-size: var(--ent-fs-sm); display: flex; flex-direction: column; gap: var(--ent-s1); }
.fp-log li span { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.fp-log li p { margin: 0; color: var(--ent-text-2); }
.fp-log label { display: flex; flex-direction: column; gap: 2px; font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
@media (max-width: 1023px) { .fp-split { grid-template-columns: 1fr; } .fp-register { max-height: 12rem; } }
@media (max-width: 767px) { .fp { padding: var(--ent-s3); } .fp-grid { grid-template-columns: 1fr; } }
</style>
