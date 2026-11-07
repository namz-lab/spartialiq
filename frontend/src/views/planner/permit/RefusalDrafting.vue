<script setup lang="ts">
// Refusal with reasons. The planner drafts; the EO determines (the backend
// 403s a planner-set 'refused'), so submitting hands the case up as
// awaiting_eo_decision carrying the reasons, exactly as Step 4 does for a permit.
import { computed, ref, watch } from 'vue'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useAuthStore } from '@/stores/auth'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { dmApi, isConflictError } from '@/services/developmentManagementService'
import { refusalLetter, renderDraftPdf } from '../plannerDocuments'
import UiButton from '@/components/ui/UiButton.vue'
import UiFeedback from '@/components/UiFeedback.vue'
import { FileDown, Send, Plus, X } from 'lucide-vue-next'

const STANDARD_REASONS = [
  'The proposal conflicts with the use zoning of the operative master / local plan.',
  'The proposal does not comply with the building line, coverage or density controls for the zone.',
  'The site lacks adequate and safe access to a public road.',
  'Water, sewerage or drainage services are inadequate for the proposed development.',
  'The proposal would harm the amenity of neighbouring properties, as raised in sustained objections.',
  'The Environmental Management Agency has objected and its requirements have not been met.',
  'The proposal would breach the conditions of title.',
  'The application does not contain sufficient information to allow a proper assessment.',
]

const { current, save } = usePlannerCase()
const auth = useAuthStore()
const fb = useUiFeedback()
const officer = computed(() => auth.user?.name || auth.user?.email || 'Town Planning Officer')

const reasons = ref<string[]>([])
watch(() => current.value?.permitId, () => {
  const text = current.value?.committeeReport.recommendationReasons ?? ''
  reasons.value = text.split(/\n+/).map(s => s.trim()).filter(Boolean)
  if (!reasons.value.length) reasons.value = ['']
}, { immediate: true })

function persist() {
  if (!current.value) return
  current.value.committeeReport.recommendationReasons = reasons.value.map(r => r.trim()).filter(Boolean).join('\n')
  save()
}
function add(text = '') { reasons.value.push(text); persist() }
function remove(i: number) { reasons.value.splice(i, 1); if (!reasons.value.length) reasons.value.push(''); persist() }

const clean = computed(() => reasons.value.map(r => r.trim()).filter(Boolean))
const submitted = computed(() => current.value?.status === 'awaiting_eo_decision')
const decided = computed(() => ['refused', 'approved', 'approved_with_conditions'].includes(current.value?.status ?? ''))

function caseRef() {
  const c = current.value!
  return {
    reference: c.registrationNo || c.fileRef, applicant: c.applicant.name, standNo: c.property.standNo,
    ward: c.property.ward, proposal: c.proposal.description || c.proposal.devType.replace(/_/g, ' '),
  }
}

function download() {
  if (!clean.value.length) {
    fb.openMessageBox({ kind: 'warn', title: 'No reasons', message: 'A refusal must state at least one planning reason.' })
    return
  }
  renderDraftPdf(refusalLetter(caseRef(), clean.value, officer.value))
}

const sending = ref(false)
async function submit() {
  const c = current.value
  if (!c?.permitId || !clean.value.length) return
  const ok = await fb.confirmAction('Submit the refusal for determination?',
    `The case moves to the EO with ${clean.value.length} reason${clean.value.length === 1 ? '' : 's'}. The EO signs the refusal.`,
    { confirmLabel: 'Submit' })
  if (!ok) return
  sending.value = true
  try {
    persist()
    const updated = await dmApi.setPermitStatus(c.permitId, 'awaiting_eo_decision', {
      expectedRevision: c.revision,
      notes: `Recommendation: REFUSE.${c.committeeReport.resolutionText ? ` Resolution: ${c.committeeReport.resolutionText}.` : ''}\nReasons:\n`
        + clean.value.map((r, i) => `${i + 1}. ${r}`).join('\n'),
    })
    c.revision = updated.revision ?? c.revision + 1
    c.status = updated.status
    save()
    fb.showToast('Refusal submitted to the EO for determination', 'success')
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not submit',
      message: isConflictError(e) ? 'Another officer changed this case. Reload it before submitting.'
        : fb.parseApiError(e, 'The server rejected the submission.') })
  } finally {
    sending.value = false
  }
}
</script>

<template>
  <section v-if="current" class="rf">
    <header class="rf-head">
      <h3>Refusal with reasons</h3>
      <p>Each reason must be a planning reason the applicant can answer on appeal (s.38).</p>
    </header>

    <ol class="rf-list">
      <li v-for="(r, i) in reasons" :key="i">
        <textarea v-model="reasons[i]" rows="2" :aria-label="`Reason ${i + 1}`" :disabled="decided" @change="persist" />
        <button type="button" class="rf-x" :disabled="decided" :aria-label="`Remove reason ${i + 1}`" @click="remove(i)"><X :size="14" /></button>
      </li>
    </ol>

    <div v-if="!decided" class="rf-lib">
      <UiButton size="sm" @click="add()"><template #icon><Plus :size="12" /></template>Add a reason</UiButton>
      <details>
        <summary>Standard reasons</summary>
        <ul>
          <li v-for="s in STANDARD_REASONS" :key="s">
            <button type="button" :disabled="reasons.includes(s)" @click="add(s)">{{ s }}</button>
          </li>
        </ul>
      </details>
    </div>

    <div class="rf-actions">
      <UiButton size="sm" @click="download"><template #icon><FileDown :size="12" /></template>Download refusal notice</UiButton>
      <UiButton v-if="!submitted && !decided" size="sm" variant="primary" :loading="sending" :disabled="!clean.length" @click="submit">
        <template #icon><Send :size="12" /></template>Submit to EO for determination
      </UiButton>
      <span v-else-if="submitted" class="rf-state">Awaiting the EO's determination</span>
      <span v-else class="rf-state">Determined: {{ current.status?.replace(/_/g, ' ') }}</span>
    </div>
    <UiFeedback :feedback="fb" />
  </section>
</template>

<style scoped>
.rf { margin: var(--ent-s3); padding: var(--ent-s4); background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); display: flex; flex-direction: column; gap: var(--ent-s3); }
.rf-head h3 { margin: 0; font-size: var(--ent-fs-md); font-weight: var(--ent-fw-bold); }
.rf-head p { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.rf-list { margin: 0; padding-left: 1.4rem; display: flex; flex-direction: column; gap: var(--ent-s2); }
.rf-list li { display: flex; gap: var(--ent-s2); align-items: flex-start; }
.rf-list textarea { flex: 1; font: inherit; font-size: var(--ent-fs-sm); padding: var(--ent-s2); border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); color: var(--ent-text); background: var(--ent-surface); resize: vertical; }
.rf-list textarea:focus { outline: none; border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
.rf-x { min-width: var(--ent-touch-min); min-height: var(--ent-touch-min); display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--ent-line); background: var(--ent-surface); color: var(--ent-text-3); border-radius: var(--ent-r-sm); cursor: pointer; }
.rf-x:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.rf-lib { display: flex; flex-direction: column; gap: var(--ent-s2); align-items: flex-start; }
.rf-lib summary { cursor: pointer; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.rf-lib ul { list-style: none; margin: var(--ent-s2) 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
.rf-lib ul button { text-align: left; width: 100%; font: inherit; font-size: var(--ent-fs-sm); padding: var(--ent-s2); border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm); background: var(--ent-surface-2); color: var(--ent-text); cursor: pointer; }
.rf-lib ul button:disabled { opacity: 0.5; cursor: default; }
.rf-lib ul button:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.rf-actions { display: flex; gap: var(--ent-s2); align-items: center; flex-wrap: wrap; }
.rf-state { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text-2); }
</style>
