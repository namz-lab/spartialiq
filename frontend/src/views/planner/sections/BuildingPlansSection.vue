<script setup lang="ts">
// Building plans — revisions per permit and their Annexure 11 appraisal.
//
// The appraisal belongs to a plan REVISION and lives on the server
// (building_plan.appraisal_notes, see planAppraisal.ts), so every officer on
// every machine sees the same sheet. Only the roles the appraisal route
// accepts can record one; everyone else reads it.

import { computed, onMounted, ref, watch } from 'vue'
import {
  dmApi, BUILDING_PLAN_APPRAISERS, isBuildingPlanApproved,
  type PermitApplication, type BuildingPlan, type BuildingPlanStatus,
} from '@/services/developmentManagementService'
import { isPermitApproved, normalizeStatus, caseRef } from '@/composables/useApplicationPipeline'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { useAuthStore } from '@/stores/auth'
import {
  ANNEXURE_11, MIN_REQS, CHECK_TOTAL, checkKey, checkedCount,
  composeAppraisal, parseAppraisal, emptyAppraisal, type Appraisal,
} from '@/views/planner/planAppraisal'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import {
  Building, RefreshCw, Search, CheckCircle2, XCircle, Plus, Save, ExternalLink, Lock,
} from 'lucide-vue-next'

// Optional host binding. The Building Inspector console passes the open case's
// permit and listens for `select`, so this list never holds a second selection
// that disagrees with the rest of that console.
const props = defineProps<{ permitId?: string | null }>()
const emit = defineEmits<{ select: [permit: PermitApplication] }>()

const fb = useUiFeedback()
const auth = useAuthStore()
const canAppraise = computed(() =>
  (BUILDING_PLAN_APPRAISERS as readonly string[]).includes(auth.user?.role ?? ''))

const permits = ref<PermitApplication[]>([])
const plans = ref<BuildingPlan[]>([])
const selectedPermit = ref<PermitApplication | null>(null)
const selectedPlanId = ref<string | null>(null)
const loading = ref(false)
const plansLoading = ref(false)
const saving = ref<BuildingPlanStatus | null>(null)
const search = ref('')

const OPEN: readonly BuildingPlanStatus[] = ['submitted', 'under_appraisal', 'resubmitted']
const selectedPlan = computed(() => plans.value.find(p => p.id === selectedPlanId.value) ?? null)
const editable = computed(() => canAppraise.value && !!selectedPlan.value && OPEN.includes(selectedPlan.value.status))

// ── Appraisal sheet (working copy of the selected revision) ────────────
const sheet = ref<Appraisal>(emptyAppraisal())
const savedText = ref('')
const dirty = computed(() => editable.value && composeAppraisal(sheet.value) !== savedText.value)
const done = computed(() => checkedCount(sheet.value))

function loadSheet(plan: BuildingPlan | null) {
  sheet.value = parseAppraisal(plan?.appraisal_notes)
  // Compare against the canonical form so an untouched sheet is never dirty.
  savedText.value = composeAppraisal(sheet.value)
}

function toggle(section: string, item: string, on: boolean) {
  const k = checkKey(section, item)
  const checked = { ...sheet.value.checked }
  if (on) checked[k] = true; else delete checked[k]
  sheet.value = { ...sheet.value, checked }
}
function toggleSection(section: string, items: readonly string[], on: boolean) {
  const checked = { ...sheet.value.checked }
  for (const it of items) { const k = checkKey(section, it); if (on) checked[k] = true; else delete checked[k] }
  sheet.value = { ...sheet.value, checked }
}
const sectionDone = (section: string, items: readonly string[]) =>
  items.filter(it => sheet.value.checked[checkKey(section, it)]).length

async function leaveSheet(): Promise<boolean> {
  if (!dirty.value) return true
  return fb.confirmAction('Discard unsaved appraisal?',
    'The changes to this checklist have not been saved to the plan.', { confirmLabel: 'Discard' })
}

// ── Loading ─────────────────────────────────────────────────────────────
async function refreshPermits() {
  loading.value = true
  try {
    const all = await dmApi.listAllPermits()
    permits.value = all.filter(p =>
      isPermitApproved(p.status) || normalizeStatus(p.status) === 'under_review')
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'Could not load permits'), 'error')
  } finally {
    loading.value = false
  }
}

async function loadPlans(permitId: string, keepPlanId?: string) {
  plansLoading.value = true
  try {
    plans.value = await dmApi.listBuildingPlans(permitId)
    const keep = keepPlanId && plans.value.find(p => p.id === keepPlanId)
    // Default to the latest revision: it is the one awaiting appraisal.
    const pick = keep || plans.value[plans.value.length - 1] || null
    selectedPlanId.value = pick?.id ?? null
    loadSheet(pick)
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'Could not load building plans'), 'error')
    plans.value = []
    selectedPlanId.value = null
    loadSheet(null)
  } finally {
    plansLoading.value = false
  }
}

onMounted(refreshPermits)

async function pick(p: PermitApplication) {
  if (p.id === selectedPermit.value?.id || !(await leaveSheet())) return
  selectedPermit.value = p
  emit('select', p)
}

async function pickPlan(plan: BuildingPlan) {
  if (plan.id === selectedPlanId.value || !(await leaveSheet())) return
  selectedPlanId.value = plan.id
  loadSheet(plan)
}

watch([() => props.permitId, permits], async ([id]) => {
  if (!id || selectedPermit.value?.id === id) return
  selectedPermit.value = permits.value.find(p => p.id === id)
    ?? await dmApi.getPermit(id).catch(() => null)
}, { immediate: true })

watch(selectedPermit, (p) => {
  showSubmitForm.value = false
  if (p) void loadPlans(p.id)
  else { plans.value = []; selectedPlanId.value = null; loadSheet(null) }
})

const filteredPermits = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return permits.value
  return permits.value.filter(p =>
    (p.applicant_name ?? '').toLowerCase().includes(q)
    || (p.stand_number ?? '').toLowerCase().includes(q)
    || (p.dev_register_no ?? '').toLowerCase().includes(q))
})

// ── Record a new revision ───────────────────────────────────────────────
const showSubmitForm = ref(false)
const submitting = ref(false)
const blankRevision = () => ({
  plan_document_url: '', revision_label: '',
  architect_name: '', architect_reg_no: '',
  engineer_name: '', engineer_reg_no: '',
  gross_floor_area_sqm: null as number | null, number_of_storeys: null as number | null,
  building_use: '',
})
const newPlan = ref(blankRevision())
const nextRevision = computed(() => plans.value.reduce((n, p) => Math.max(n, p.revision), 0) + 1)

async function submitPlan() {
  if (!selectedPermit.value) return
  if (!newPlan.value.plan_document_url.trim()) {
    fb.openMessageBox({ kind: 'warn', title: 'Plan document required',
      message: 'Give the file reference or link for the drawings being lodged.' })
    return
  }
  submitting.value = true
  try {
    const body = Object.fromEntries(Object.entries(newPlan.value)
      .map(([k, v]) => [k, typeof v === 'string' ? v.trim() || undefined : v ?? undefined]))
    const created = await dmApi.submitBuildingPlan(selectedPermit.value.id, body as Partial<BuildingPlan>)
    fb.showToast(`Revision ${created.revision} recorded`, 'success')
    showSubmitForm.value = false
    newPlan.value = blankRevision()
    await loadPlans(selectedPermit.value.id, created.id)
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not record the revision',
      message: fb.parseApiError(e, 'The server rejected the submission.') })
  } finally {
    submitting.value = false
  }
}

// ── Appraise ────────────────────────────────────────────────────────────
const DECISION: Partial<Record<BuildingPlanStatus, { title: string; label: string; needsNotes: boolean }>> = {
  approved:                 { title: 'Approve this plan revision?', label: 'Approve', needsNotes: false },
  approved_with_amendments: { title: 'Approve with amendments?', label: 'Approve with amendments', needsNotes: true },
  rejected:                 { title: 'Reject this plan revision?', label: 'Reject', needsNotes: true },
}

async function appraise(status: BuildingPlanStatus) {
  const plan = selectedPlan.value
  if (!plan || !selectedPermit.value) return
  const decision = DECISION[status]
  if (decision) {
    if (decision.needsNotes && !sheet.value.notes.trim()) {
      fb.openMessageBox({ kind: 'warn', title: 'Reasons required',
        message: 'State the amendments or reasons in the appraisal notes. The applicant receives them.' })
      return
    }
    const outstanding = CHECK_TOTAL - done.value
    const warn = status === 'approved' && outstanding
      ? ` ${outstanding} plan-content item${outstanding === 1 ? ' is' : 's are'} not checked.` : ''
    const ok = await fb.confirmAction(decision.title,
      `Revision ${plan.revision} · ${selectedPermit.value.dev_register_no || 'Stand ' + selectedPermit.value.stand_number}.${warn} This is final and visible to the applicant.`,
      { confirmLabel: decision.label })
    if (!ok) return
  }
  saving.value = status
  try {
    await dmApi.appraiseBuildingPlan(plan.id, { status, appraisal_notes: composeAppraisal(sheet.value) })
    fb.showToast(decision ? `Revision ${plan.revision}: ${decision.label.toLowerCase()}` : 'Appraisal saved', decision && status === 'rejected' ? 'warn' : 'success')
    await loadPlans(selectedPermit.value.id, plan.id)
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not record the appraisal',
      message: fb.parseApiError(e, 'The server rejected the update.') })
  } finally {
    saving.value = null
  }
}

const isLink = (s?: string | null) => !!s && /^https?:\/\//i.test(s)
function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="bp">
    <header class="bp-head">
      <div>
        <h2>Building plans</h2>
        <p class="bp-sub">Plan revisions and the Annexure 11 appraisal, per permit.</p>
      </div>
      <UiButton size="sm" :loading="loading" @click="refreshPermits">
        <template #icon><RefreshCw :size="13" /></template>
        Refresh
      </UiButton>
    </header>

    <div class="bp-split">
      <aside class="bp-picker" aria-label="Permits">
        <div class="bp-search">
          <Search :size="14" aria-hidden="true" />
          <input v-model="search" name="bp-search" type="search" aria-label="Search permits"
                 placeholder="Register no, applicant, stand" />
        </div>
        <p class="bp-picker-count" aria-live="polite">
          {{ loading ? 'Loading permits…' : `${filteredPermits.length} permit${filteredPermits.length === 1 ? '' : 's'}` }}
        </p>
        <div v-if="!loading && !filteredPermits.length" class="bp-picker-empty">
          {{ search ? 'No permit matches that search.' : 'No approved or under-review permits.' }}
        </div>
        <ul v-else class="bp-permit-list">
          <li v-for="p in filteredPermits" :key="p.id">
            <button type="button" class="bp-permit" :class="{ active: selectedPermit?.id === p.id }"
                    :aria-current="selectedPermit?.id === p.id ? 'true' : undefined" @click="pick(p)">
              <span class="bp-permit-id">{{ caseRef(p) }}</span>
              <span class="bp-permit-app">{{ p.applicant_name }}</span>
              <span class="bp-permit-stand">Stand {{ p.stand_number }}<template v-if="p.suburb_ward"> · {{ p.suburb_ward }}</template></span>
            </button>
          </li>
        </ul>
      </aside>

      <main class="bp-main">
        <UiEmptyState v-if="!selectedPermit" message="Select a permit to see its plan revisions.">
          <template #icon><Building :size="30" /></template>
        </UiEmptyState>

        <template v-else>
          <header class="bp-permit-head">
            <div class="bp-permit-title">
              <strong>{{ selectedPermit.dev_register_no || 'Unregistered' }}</strong>
              <span>{{ selectedPermit.applicant_name }} · Stand {{ selectedPermit.stand_number }}</span>
            </div>
            <UiButton size="sm" :variant="showSubmitForm ? 'ghost' : 'secondary'" @click="showSubmitForm = !showSubmitForm">
              <template v-if="!showSubmitForm" #icon><Plus :size="12" /></template>
              {{ showSubmitForm ? 'Cancel' : 'Record revision' }}
            </UiButton>
          </header>

          <div class="bp-scroll">
            <form v-if="showSubmitForm" class="bp-form" @submit.prevent="submitPlan">
              <h3>Record revision {{ nextRevision }}</h3>
              <div class="bp-form-grid">
                <label class="bp-wide">Plan document <span class="req" aria-hidden="true">*</span>
                  <input v-model="newPlan.plan_document_url" name="bp-doc" required
                         placeholder="File reference or link to the drawings" /></label>
                <label>Label<input v-model="newPlan.revision_label" name="bp-label"
                         :placeholder="`Rev ${String.fromCharCode(64 + nextRevision)}`" /></label>
                <label>Building use<input v-model="newPlan.building_use" name="bp-use" placeholder="e.g. Dwelling house" /></label>
                <label>Architect<input v-model="newPlan.architect_name" name="bp-architect" /></label>
                <label>Architect reg. no<input v-model="newPlan.architect_reg_no" name="bp-architect-reg" /></label>
                <label>Engineer<input v-model="newPlan.engineer_name" name="bp-engineer" /></label>
                <label>Engineer reg. no<input v-model="newPlan.engineer_reg_no" name="bp-engineer-reg" /></label>
                <label>Gross floor area (m²)<input v-model.number="newPlan.gross_floor_area_sqm" name="bp-gfa" type="number" min="0" step="0.01" /></label>
                <label>Storeys<input v-model.number="newPlan.number_of_storeys" name="bp-storeys" type="number" min="1" step="1" /></label>
              </div>
              <UiButton type="submit" variant="primary" :loading="submitting">Record revision</UiButton>
            </form>

            <p v-if="plansLoading" class="bp-loading" aria-live="polite">Loading revisions…</p>
            <UiEmptyState v-else-if="!plans.length"
                          message="No plan revisions lodged for this permit yet." />

            <template v-else>
              <nav class="bp-revs" aria-label="Plan revisions">
                <button v-for="plan in plans" :key="plan.id" type="button" class="bp-rev"
                        :class="{ active: plan.id === selectedPlanId }"
                        :aria-current="plan.id === selectedPlanId ? 'true' : undefined"
                        @click="pickPlan(plan)">
                  <span class="bp-rev-no">Rev {{ plan.revision }}</span>
                  <UiStatusBadge :status="plan.status" />
                </button>
              </nav>

              <section v-if="selectedPlan" class="bp-plan" :aria-label="`Revision ${selectedPlan.revision}`">
                <dl class="bp-facts">
                  <div><dt>Label</dt><dd>{{ selectedPlan.revision_label || '—' }}</dd></div>
                  <div><dt>Lodged</dt><dd>{{ fmtDate(selectedPlan.submitted_at || selectedPlan.created_at) }}</dd></div>
                  <div><dt>Architect</dt><dd>{{ selectedPlan.architect_name || '—' }}<template v-if="selectedPlan.architect_reg_no"> ({{ selectedPlan.architect_reg_no }})</template></dd></div>
                  <div><dt>Engineer</dt><dd>{{ selectedPlan.engineer_name || '—' }}<template v-if="selectedPlan.engineer_reg_no"> ({{ selectedPlan.engineer_reg_no }})</template></dd></div>
                  <div v-if="selectedPlan.building_use"><dt>Use</dt><dd>{{ selectedPlan.building_use }}</dd></div>
                  <div v-if="selectedPlan.gross_floor_area_sqm"><dt>Floor area</dt><dd>{{ selectedPlan.gross_floor_area_sqm }} m²<template v-if="selectedPlan.number_of_storeys"> · {{ selectedPlan.number_of_storeys }} storey{{ selectedPlan.number_of_storeys === 1 ? '' : 's' }}</template></dd></div>
                  <div v-if="selectedPlan.appraised_at"><dt>Appraised</dt><dd>{{ fmtDate(selectedPlan.appraised_at) }}</dd></div>
                  <div class="bp-doc"><dt>Drawings</dt><dd>
                    <a v-if="isLink(selectedPlan.plan_document_url)" :href="selectedPlan.plan_document_url" target="_blank" rel="noopener">
                      Open plan <ExternalLink :size="11" aria-hidden="true" /></a>
                    <span v-else class="mono">{{ selectedPlan.plan_document_url }}</span>
                  </dd></div>
                </dl>

                <div class="bpa">
                  <header class="bpa-head">
                    <h3>Plan contents — Annexure 11</h3>
                    <span class="bpa-count" :class="{ done: done === CHECK_TOTAL }">{{ done }} of {{ CHECK_TOTAL }} checked</span>
                  </header>

                  <p v-if="!editable" class="bpa-readonly">
                    <Lock :size="12" aria-hidden="true" />
                    <template v-if="!canAppraise">The building inspector records the appraisal. This is the record as saved.</template>
                    <template v-else>This revision has been decided. The appraisal is closed.</template>
                  </p>

                  <div class="bpa-grid">
                    <fieldset v-for="s in ANNEXURE_11" :key="s.section" class="bpa-sec" :disabled="!editable">
                      <legend>
                        {{ s.section }}
                        <span class="bpa-sec-count">{{ sectionDone(s.section, s.items) }}/{{ s.items.length }}</span>
                        <button v-if="editable" type="button" class="bpa-all"
                                @click="toggleSection(s.section, s.items, sectionDone(s.section, s.items) < s.items.length)">
                          {{ sectionDone(s.section, s.items) < s.items.length ? 'Check all' : 'Clear' }}
                        </button>
                      </legend>
                      <label v-for="it in s.items" :key="it" class="bpa-item">
                        <input type="checkbox" :checked="!!sheet.checked[checkKey(s.section, it)]"
                               @change="toggle(s.section, it, ($event.target as HTMLInputElement).checked)" />
                        <span>{{ it }}</span>
                      </label>
                    </fieldset>
                  </div>

                  <fieldset class="bpa-reqs" :disabled="!editable">
                    <legend>Minimum requirements</legend>
                    <label v-for="r in MIN_REQS" :key="r" class="bpa-req">
                      <span>{{ r }}</span>
                      <input v-model="sheet.requirements[r]" :name="`bpa-req-${r}`" placeholder="No comment" />
                    </label>
                  </fieldset>

                  <label class="bpa-notes">
                    <span>Appraisal notes <span class="bpa-hint">— reasons, amendments required, conditions. The applicant sees these.</span></span>
                    <textarea v-model="sheet.notes" name="bpa-notes" rows="3" :readonly="!editable" />
                  </label>

                  <footer v-if="editable" class="bpa-actions">
                    <span class="bpa-state" aria-live="polite">{{ dirty ? 'Unsaved changes' : 'Saved' }}</span>
                    <UiButton size="sm" :disabled="!dirty" :loading="saving === 'under_appraisal'" @click="appraise('under_appraisal')">
                      <template #icon><Save :size="12" /></template>
                      Save progress
                    </UiButton>
                    <span class="bpa-sep" aria-hidden="true" />
                    <UiButton size="sm" variant="danger" :loading="saving === 'rejected'" @click="appraise('rejected')">
                      <template #icon><XCircle :size="12" /></template>
                      Reject
                    </UiButton>
                    <UiButton size="sm" :loading="saving === 'approved_with_amendments'" @click="appraise('approved_with_amendments')">
                      Approve with amendments
                    </UiButton>
                    <UiButton size="sm" variant="primary" :loading="saving === 'approved'" @click="appraise('approved')">
                      <template #icon><CheckCircle2 :size="12" /></template>
                      Approve
                    </UiButton>
                  </footer>
                  <p v-else-if="isBuildingPlanApproved(selectedPlan.status)" class="bpa-outcome ok">Approved{{ selectedPlan.status === 'approved_with_amendments' ? ' with amendments' : '' }} on {{ fmtDate(selectedPlan.appraised_at) }}.</p>
                  <p v-else-if="selectedPlan.status === 'rejected'" class="bpa-outcome no">Rejected on {{ fmtDate(selectedPlan.appraised_at) }}. The applicant must lodge a new revision.</p>
                </div>
              </section>
            </template>
          </div>
        </template>
      </main>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.bp { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s3); height: 100%; min-height: 0; }
.bp-head { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.bp-head > div { flex: 1; }
.bp-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); color: var(--ent-text); letter-spacing: -0.01em; }
.bp-sub { margin: 2px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }

.bp-split { flex: 1; min-height: 0; display: grid; grid-template-columns: 18rem 1fr; gap: var(--ent-s3); }

.bp-picker { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md);
  display: flex; flex-direction: column; overflow: hidden; }
.bp-search { display: flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s2) var(--ent-s3); border-bottom: 1px solid var(--ent-line); background: var(--ent-surface-2); color: var(--ent-text-3); }
.bp-search:focus-within { box-shadow: inset 0 -2px 0 var(--ent-accent); }
.bp-search input { flex: 1; min-width: 0; border: none; outline: none; background: transparent;
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text); }
.bp-picker-count { margin: 0; padding: var(--ent-s1) var(--ent-s3); font-size: var(--ent-fs-micro); color: var(--ent-text-3); border-bottom: 1px solid var(--ent-line); }
.bp-picker-empty { padding: var(--ent-s5); color: var(--ent-text-3); font-size: var(--ent-fs-sm); text-align: center; }
.bp-permit-list { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
.bp-permit-list li + li { border-top: 1px solid var(--ent-line); }
.bp-permit { all: unset; box-sizing: border-box; width: 100%; display: grid; grid-template-columns: 7rem 1fr; gap: 2px var(--ent-s2);
  padding: var(--ent-s2) var(--ent-s3); cursor: pointer; font-size: var(--ent-fs-sm); color: var(--ent-text); }
.bp-permit:hover { background: var(--ent-surface-2); }
.bp-permit:focus-visible { outline: none; box-shadow: inset var(--ent-focus-ring); }
.bp-permit.active { background: var(--ent-accent-soft); box-shadow: inset 3px 0 0 var(--ent-accent); }
.bp-permit-id { font-family: var(--ent-font-mono); font-weight: var(--ent-fw-semibold); }
.bp-permit-app { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bp-permit-stand { color: var(--ent-text-3); grid-column: 1 / -1; font-size: var(--ent-fs-micro); }

.bp-main { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md);
  display: flex; flex-direction: column; overflow: hidden; min-width: 0; }
.bp-permit-head { display: flex; align-items: center; gap: var(--ent-s2);
  padding: var(--ent-s3) var(--ent-s4); border-bottom: 1px solid var(--ent-line); background: var(--ent-surface-2); }
.bp-permit-title { flex: 1; min-width: 0; display: flex; flex-wrap: wrap; align-items: baseline; gap: 0 var(--ent-s2); font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.bp-permit-title strong { font-family: var(--ent-font-mono); font-size: var(--ent-fs-base); color: var(--ent-text); }
.bp-scroll { flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; }
.bp-loading { margin: 0; padding: var(--ent-s5); color: var(--ent-text-3); font-size: var(--ent-fs-sm); }

.bp-form { padding: var(--ent-s3) var(--ent-s4); background: var(--ent-surface-2); border-bottom: 1px solid var(--ent-line); }
.bp-form h3 { margin: 0 0 var(--ent-s2); font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.bp-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ent-s2) var(--ent-s3); margin-bottom: var(--ent-s3); }
.bp-form-grid label { display: flex; flex-direction: column; gap: var(--ent-s1); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.bp-wide { grid-column: 1 / -1; }
.req { color: var(--ent-danger); }
.bp-form-grid input, .bpa-req input, .bpa-notes textarea {
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text);
  padding: var(--ent-s2) var(--ent-s3); border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); outline: none; background: var(--ent-surface); }
.bp-form-grid input:focus, .bpa-req input:focus, .bpa-notes textarea:focus { border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }

.bp-revs { display: flex; gap: var(--ent-s1); padding: var(--ent-s3) var(--ent-s4) 0; overflow-x: auto; border-bottom: 1px solid var(--ent-line); }
.bp-rev { all: unset; box-sizing: border-box; display: flex; align-items: center; gap: var(--ent-s2); cursor: pointer; white-space: nowrap;
  padding: var(--ent-s2) var(--ent-s3); border-radius: var(--ent-r-sm) var(--ent-r-sm) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2);
  border-bottom: 2px solid transparent; margin-bottom: -1px; }
.bp-rev:hover { color: var(--ent-text); background: var(--ent-surface-2); }
.bp-rev:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.bp-rev.active { color: var(--ent-text); border-bottom-color: var(--ent-accent); }
.bp-rev-no { font-weight: var(--ent-fw-semibold); }

.bp-plan { padding: var(--ent-s3) var(--ent-s4) var(--ent-s4); display: flex; flex-direction: column; gap: var(--ent-s3); }
.bp-facts { margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(11rem, 1fr)); gap: var(--ent-s2) var(--ent-s4); }
.bp-facts dt { font-size: var(--ent-fs-micro); color: var(--ent-text-3); text-transform: uppercase; letter-spacing: 0.04em; }
.bp-facts dd { margin: 2px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text); overflow-wrap: anywhere; }
.bp-doc a { color: var(--ent-accent); display: inline-flex; align-items: center; gap: 3px; }
.mono { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); }

.bpa { border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); overflow: hidden; }
.bpa-head { display: flex; align-items: center; justify-content: space-between; gap: var(--ent-s2); padding: var(--ent-s2) var(--ent-s3);
  background: var(--ent-surface-2); border-bottom: 1px solid var(--ent-line); }
.bpa-head h3 { margin: 0; font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.bpa-count { font-size: var(--ent-fs-micro); padding: 1px var(--ent-s2); border-radius: var(--ent-r-pill);
  background: var(--ent-tone-neutral-bg); color: var(--ent-tone-neutral-fg); font-weight: var(--ent-fw-semibold); font-variant-numeric: tabular-nums; }
.bpa-count.done { background: var(--ent-success-soft); color: var(--ent-success); }
.bpa-readonly { margin: 0; display: flex; align-items: center; gap: var(--ent-s1); padding: var(--ent-s2) var(--ent-s3);
  font-size: var(--ent-fs-xs); color: var(--ent-text-2); background: var(--ent-surface-2); border-bottom: 1px solid var(--ent-line); }

.bpa-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ent-s3) var(--ent-s4); padding: var(--ent-s3); }
fieldset { border: none; margin: 0; padding: 0; min-width: 0; }
.bpa-sec legend { display: flex; align-items: center; gap: var(--ent-s2); width: 100%; padding: 0; margin-bottom: var(--ent-s1);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); }
.bpa-sec-count { font-weight: var(--ent-fw-normal); color: var(--ent-text-3); font-variant-numeric: tabular-nums; }
.bpa-all { all: unset; margin-left: auto; cursor: pointer; text-transform: none; letter-spacing: 0; font-weight: var(--ent-fw-normal); color: var(--ent-accent); font-size: var(--ent-fs-micro); }
.bpa-all:hover { text-decoration: underline; }
.bpa-all:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); border-radius: 2px; }
.bpa-item { display: flex; align-items: center; gap: var(--ent-s2); min-height: 1.75rem; font-size: var(--ent-fs-sm); color: var(--ent-text); cursor: pointer; }
.bpa-item input { accent-color: var(--ent-accent); width: 1rem; height: 1rem; margin: 0; }
fieldset:disabled .bpa-item { cursor: default; color: var(--ent-text-2); }

.bpa-reqs { padding: var(--ent-s3); border-top: 1px solid var(--ent-line); }
.bpa-reqs legend { float: left; width: 100%; padding: 0; margin-bottom: var(--ent-s2); font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold); text-transform: uppercase; letter-spacing: 0.04em; color: var(--ent-text-2); }
.bpa-req { clear: both; display: grid; grid-template-columns: 12rem 1fr; gap: var(--ent-s2); align-items: center; font-size: var(--ent-fs-sm); color: var(--ent-text-2); margin-bottom: var(--ent-s1); }
.bpa-req input { padding: var(--ent-s1) var(--ent-s2); }
.bpa-req input:disabled { background: var(--ent-surface-2); color: var(--ent-text); }
.bpa-notes { display: flex; flex-direction: column; gap: var(--ent-s1); padding: var(--ent-s3); font-size: var(--ent-fs-sm); color: var(--ent-text); border-top: 1px solid var(--ent-line); }
.bpa-notes textarea { resize: vertical; min-height: 4.5rem; }
.bpa-notes textarea:read-only { background: var(--ent-surface-2); }
.bpa-hint { color: var(--ent-text-3); font-size: var(--ent-fs-xs); }

.bpa-actions { display: flex; align-items: center; flex-wrap: wrap; gap: var(--ent-s2); padding: var(--ent-s2) var(--ent-s3);
  border-top: 1px solid var(--ent-line); background: var(--ent-surface-2); }
.bpa-state { margin-right: auto; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.bpa-sep { width: 1px; align-self: stretch; background: var(--ent-line); }
.bpa-outcome { margin: 0; padding: var(--ent-s2) var(--ent-s3); border-top: 1px solid var(--ent-line); font-size: var(--ent-fs-sm); }
.bpa-outcome.ok { color: var(--ent-success); background: var(--ent-success-soft); }
.bpa-outcome.no { color: var(--ent-danger); background: var(--ent-danger-soft); }

@media (max-width: 1023px) {
  .bp { padding: var(--ent-s3); }
  .bp-split { grid-template-columns: 1fr; }
  .bp-picker { max-height: 14rem; }
}
@media (max-width: 767px) {
  .bpa-grid, .bp-form-grid { grid-template-columns: 1fr; }
  .bpa-req { grid-template-columns: 1fr; gap: 2px; }
  .bpa-sep { display: none; }
  .bpa-state { flex-basis: 100%; }
}
</style>
