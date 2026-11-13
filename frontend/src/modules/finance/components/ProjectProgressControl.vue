<script setup lang="ts">
/**
 * Record — or take back — a project's physical completion (decision D12).
 *
 * WHY THIS IS A SEPARATE CONTROL AND NOT A FIELD ON THE PROJECT FORM
 * Progress is a periodic report with evidence behind it, not an attribute of the project like its
 * name. The server gives it its own route for the same reason, and that route is the only one able
 * to set the figure back to NULL — `PATCH /finance/projects/:id` updates with COALESCE and so
 * cannot clear a field. "This figure was recorded in error and we do not have another" has to be
 * expressible, or the only way out of a wrong number is a wronger one.
 *
 * NULL IS NOT ZERO, IN BOTH DIRECTIONS
 *   - no recorded figure            → "not recorded"      (never 0 %)
 *   - a recorded 0                  → "nothing built yet" (a reported fact)
 *   - spend_ahead_of_progress NULL  → "not compared"      (never "within tolerance")
 * The last one matters most: a NULL flag means the comparison could not be made — no progress, no
 * execution figure, or no council threshold configured — and a screen that rendered it as a pass
 * would turn an absent control into a clean bill of health.
 *
 * AN UNDATED FIGURE IS DECORATIVE. `progress_recorded_at` is always shown beside the number. The
 * officer who recorded it is named when this screen recorded it; otherwise the surface says the
 * recording officer is in the audit trail rather than inventing a name the endpoint does not serve.
 */
import { computed, ref, watch } from 'vue'
import { AlertTriangle, CheckCircle2, Eraser, Info, Save } from 'lucide-vue-next'
import { financeApi } from '../api/financeApi'
import type { ProjectProgressResult } from '../api/financeApi'
import type { FinanceDocument } from '../models/types'
import { useFinanceStore, messageOf } from '../stores/finance'
import { formatDateTime } from '../composables/useMoney'
import { useFinancePrompt } from '../composables/useFinancePrompt'
import FinancePromptDialog from './FinancePromptDialog.vue'
import { describeProgress, describeSpendVsProgress } from '../composables/useProjectProgress'

const props = defineProps<{
  projectId: string
  reference: string
  physicalProgressPercent: number | null
  progressRecordedAt?: string | null
  progressEvidenceDocumentId?: string | null
  /** As the view serves it: a numeric percentage, or the decimal string SQL returned. */
  executionPercentage?: number | string | null
  spendVsProgressGapPoints?: number | null
  spendAheadOfProgress?: boolean | null
  spendAheadOfProgressThresholdPoints?: number | null
}>()

const emit = defineEmits<{ recorded: [ProjectProgressResult] }>()

const store = useFinanceStore()
const prompt = useFinancePrompt()

const canRecord = computed(() => store.can('finance.project.manage'))
const open = ref(false)
const busy = ref(false)
const error = ref<string | null>(null)
const note = ref<string | null>(null)
const documents = ref<FinanceDocument[]>([])
const documentsRead = ref(false)
/** The last reply, so the figure, its age and its recorder are current without a re-fetch. */
const latest = ref<ProjectProgressResult | null>(null)

const form = ref({ percent: '', evidenceDocumentId: '', note: '' })

const percent = computed(() =>
  latest.value ? latest.value.project.physical_progress_percent : props.physicalProgressPercent)
const recordedAt = computed(() =>
  latest.value ? latest.value.project.progress_recorded_at : (props.progressRecordedAt ?? null))
const evidenceId = computed(() =>
  latest.value
    ? latest.value.project.progress_evidence_document_id
    : (props.progressEvidenceDocumentId ?? null))
const recordedByMe = computed(() =>
  latest.value !== null
  && latest.value.project.progress_recorded_by !== null
  && latest.value.project.progress_recorded_by === (store.identity?.user_id ?? null))

const gap = computed(() => latest.value?.performance
  ? latest.value.performance.spend_vs_progress_gap_points
  : (props.spendVsProgressGapPoints ?? null))
const ahead = computed(() => latest.value?.performance
  ? latest.value.performance.spend_ahead_of_progress
  : (props.spendAheadOfProgress ?? null))
const threshold = computed(() => latest.value?.performance
  ? latest.value.performance.spend_ahead_of_progress_threshold_points
  : (props.spendAheadOfProgressThresholdPoints ?? null))

const progressText = computed(() => describeProgress(percent.value))
const comparison = computed(() => describeSpendVsProgress({
  physicalProgressPercent: percent.value,
  executionPercentage: props.executionPercentage ?? null,
  gapPoints: gap.value,
  aheadOfProgress: ahead.value,
  thresholdPoints: threshold.value,
}))

const evidenceName = computed(() =>
  documents.value.find((d: FinanceDocument) => d.id === evidenceId.value)?.filename ?? null)

const PERCENT = /^\d{1,3}(\.\d{1,2})?$/
const invalid = computed(() => {
  const value = form.value.percent.trim()
  if (!value) return 'Enter the recorded completion, or use "Clear" to take the figure back.'
  if (!PERCENT.test(value)) return 'A percentage with at most two decimal places, for example 42.50.'
  const n = Number(value)
  if (n < 0 || n > 100) return 'Physical completion is between 0 and 100.'
  return null
})

watch(open, async (isOpen) => {
  if (!isOpen) return
  form.value = {
    percent: percent.value === null ? '' : String(percent.value),
    evidenceDocumentId: evidenceId.value ?? '',
    note: '',
  }
  if (documentsRead.value) return
  try {
    const page = await financeApi.documents({ subject_kind: 'project', subject_id: props.projectId })
    documents.value = page.documents
  } catch {
    // The figure can still be recorded; evidence is required by procedure, not by the schema.
    documents.value = []
  } finally {
    documentsRead.value = true
  }
})

async function record(): Promise<void> {
  error.value = null
  note.value = null
  if (invalid.value) return
  busy.value = true
  try {
    const result = await financeApi.recordProjectProgress(props.projectId, {
      physical_progress_percent: Number(form.value.percent.trim()),
      progress_evidence_document_id: form.value.evidenceDocumentId || undefined,
      note: form.value.note.trim() || undefined,
    })
    latest.value = result
    note.value = result.note
    open.value = false
    emit('recorded', result)
  } catch (err) {
    error.value = messageOf(err, 'The progress figure could not be recorded.')
  } finally {
    busy.value = false
  }
}

/**
 * Clear the figure. Sends an EXPLICIT null, which is what the route requires — omitting the key is
 * a 400 and changes nothing, and that distinction is the point of the endpoint.
 */
async function clear(): Promise<void> {
  error.value = null
  note.value = null
  const reason = await prompt.ask({
    title: `Clear the progress figure for ${props.reference}`,
    message: 'The project will read "progress not recorded" again — not 0 %. The evidence link is '
      + 'removed with it, and the change is audited with what the figure was.',
    label: 'Why is it being cleared? (optional, kept with the audit record)',
    kind: 'textarea',
    submitLabel: 'Clear the figure',
    danger: true,
  })
  if (reason === null) return
  busy.value = true
  try {
    const result = await financeApi.recordProjectProgress(props.projectId, {
      physical_progress_percent: null,
      note: reason || undefined,
    })
    latest.value = result
    note.value = result.note
    open.value = false
    emit('recorded', result)
  } catch (err) {
    error.value = messageOf(err, 'The progress figure could not be cleared.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="ppc">
    <FinancePromptDialog :controller="prompt" />

    <dl class="ppc-facts">
      <dt>Physical progress</dt>
      <dd :class="{ 'ppc-absent': percent === null }">{{ progressText }}</dd>
      <dt>Recorded</dt>
      <dd>
        <template v-if="percent === null">—</template>
        <template v-else-if="recordedAt">
          {{ formatDateTime(recordedAt) }}
          <template v-if="recordedByMe"> · by you</template>
          <template v-else> · recording officer in the audit trail</template>
        </template>
        <template v-else>date not recorded</template>
      </dd>
      <dt>Evidence</dt>
      <dd>
        <template v-if="!evidenceId">none attached</template>
        <template v-else>{{ evidenceName ?? 'attached document' }}</template>
      </dd>
      <dt>Spend vs progress</dt>
      <dd :class="{ 'ppc-absent': ahead === null }">{{ comparison.label }}</dd>
    </dl>
    <p class="ins-hint ppc-why">{{ comparison.why }}</p>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="15" aria-hidden="true" /><span>{{ error }}</span>
    </div>
    <p v-if="note" class="ins-banner t-positive" role="status">
      <CheckCircle2 :size="15" aria-hidden="true" /><span>{{ note }}</span>
    </p>

    <p v-if="!canRecord" class="ins-hint">
      {{ store.whyUnavailable('finance.project.manage') }}
    </p>

    <template v-else>
      <div v-if="!open" class="ppc-actions">
        <button type="button" class="fin-btn small" @click="open = true">
          <Save :size="13" aria-hidden="true" />
          {{ percent === null ? 'Record physical progress' : 'Update the figure' }}
        </button>
        <button v-if="percent !== null" type="button" class="fin-btn small"
                :disabled="busy" @click="clear">
          <Eraser :size="13" aria-hidden="true" /> Clear
        </button>
      </div>

      <form v-else class="ppc-form" @submit.prevent="record">
        <label>
          <span class="ins-label">Physical completion (%)</span>
          <input v-model="form.percent" class="ins-input" inputmode="decimal" placeholder="40.00" />
          <span class="ins-hint">
            What has been built, as reported — not time elapsed. A recorded 0 means nothing has been
            built yet, which is different from no report at all.
          </span>
          <span v-if="invalid" class="ppc-error">{{ invalid }}</span>
        </label>
        <label>
          <span class="ins-label">Evidence document</span>
          <select v-model="form.evidenceDocumentId" class="ins-input">
            <option value="">None attached</option>
            <option v-for="d in documents" :key="d.id" :value="d.id">
              {{ d.filename }}{{ d.document_type ? ` · ${d.document_type}` : '' }}
            </option>
          </select>
          <span class="ins-hint">
            <Info :size="12" aria-hidden="true" />
            The progress report behind the figure. Upload it against this project in Documents
            first; evidence cannot be attached while a figure is being cleared.
          </span>
        </label>
        <label class="ppc-note">
          <span class="ins-label">Note for the record (optional)</span>
          <textarea v-model="form.note" class="ins-input" rows="2"
                    placeholder="e.g. monthly site report, week 14"></textarea>
        </label>
        <div class="ppc-actions">
          <button type="submit" class="fin-btn" :disabled="busy || !!invalid">
            <Save :size="14" aria-hidden="true" /> {{ busy ? 'Recording…' : 'Record' }}
          </button>
          <button type="button" class="fin-btn small" :disabled="busy" @click="open = false">
            Cancel
          </button>
        </div>
      </form>
    </template>
  </div>
</template>

<style scoped>
.ppc { display: flex; flex-direction: column; gap: 8px; }
.ppc-facts {
  display: grid; grid-template-columns: auto 1fr; gap: 3px 12px; margin: 0; font-size: 13px;
}
.ppc-facts dt { color: var(--ent-text-muted, rgba(15, 42, 74, 0.72)); }
.ppc-facts dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
/* An absent figure is set apart typographically as well as in words: italic plus the sentence,
   never a colour on its own. */
.ppc-absent { font-style: italic; color: var(--ent-text-muted, rgba(15, 42, 74, 0.72)); }
.ppc-why { margin: 0; }
.ppc-form { display: grid; gap: 8px; }
.ppc-form label { display: flex; flex-direction: column; gap: 3px; }
.ppc-form .ins-hint { display: flex; align-items: flex-start; gap: 4px; }
.ppc-error { font-size: 11.5px; color: var(--ent-tone-negative-fg, #9b2c2c); }
.ppc-actions { display: flex; gap: 8px; flex-wrap: wrap; }
</style>
