<script setup lang="ts">
// ─── ConsultationResponsePanel ────────────────────────────────────────────
// The missing half of the technical-circulation loop.
//
// A planner circulates a permit application to specialists (GIS, Environmental
// Health, Inspector, EO). The backend has always been able to record their
// finding — dmApi.respondConsultation → PATCH /consultations/:id/response —
// but nothing in the UI ever called it, so a referral could be raised and
// never closed. The planner console then showed "0/4 referrals responded"
// forever and the statutory clock ran on a circulation that had, in fact,
// been answered (review §6.3 / P1).
//
// This panel is the one place a specialist records that response. It is
// deliberately generic: every referral role uses the same component so the
// vocabulary, the validation and the audit trail are identical whichever desk
// answers.
//
// It writes to the server and re-emits the saved row. It does NOT keep a
// local copy — the consultation record on the permit is the system of record.
import { ref, computed } from 'vue'
import { dmApi, type Consultation } from '@/services/developmentManagementService'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'

const props = withDefaults(defineProps<{
  consultation: Consultation
  /** Hide the form and show the recorded response only. */
  readonly?: boolean
}>(), { readonly: false })

const emit = defineEmits<{
  /** The server accepted the response; parent should refresh its list. */
  (e: 'responded', consultation: Consultation): void
}>()

const fb = useUiFeedback()

// The four outcomes the backend's application_consultation.response_status
// column accepts. 'no_response' exists in the column but is not offered here:
// it describes a referral that timed out, which the planner records, not the
// specialist who is by definition responding.
const OUTCOMES = [
  { value: 'no_objection',         label: 'No objection',
    hint: 'The proposal raises nothing this department needs to control.' },
  { value: 'conditional_approval', label: 'No objection, subject to conditions',
    hint: 'Acceptable only if the conditions below are carried onto the permit.' },
  { value: 'objection',            label: 'Objection',
    hint: 'This department opposes the proposal. State the ground.' },
] as const

type OutcomeValue = typeof OUTCOMES[number]['value']

const outcome = ref<OutcomeValue | ''>('')
const notes   = ref('')
const docUrl  = ref('')
const saving  = ref(false)
const error   = ref('')

/** The referral is already answered — response_status is set and not pending. */
const answered = computed(() => {
  const s = props.consultation.response_status ?? props.consultation.outcome
  return Boolean(s) && s !== 'pending'
})

const recordedStatus = computed(() =>
  props.consultation.response_status ?? props.consultation.outcome ?? 'pending')

const recordedNotes = computed(() =>
  props.consultation.response_notes ?? props.consultation.response ?? '')

const departmentLabel = computed(() =>
  props.consultation.body_name || props.consultation.department || 'Referral')

// An objection or a conditional approval without a stated ground is not a
// usable statutory response — the planner cannot carry "objection, no reason"
// into a determination. A plain no-objection needs no narrative.
const notesRequired = computed(() =>
  outcome.value === 'objection' || outcome.value === 'conditional_approval')

const canSubmit = computed(() =>
  Boolean(outcome.value)
  && (!notesRequired.value || notes.value.trim().length > 0)
  && !saving.value)

async function submit() {
  if (!canSubmit.value || !outcome.value) return
  saving.value = true
  error.value = ''
  try {
    const saved = await dmApi.respondConsultation(props.consultation.id, {
      response_status: outcome.value,
      response_notes: notes.value.trim() || undefined,
      // Server-side default would also do, but sending it makes the recorded
      // moment explicit in the audit trail.
      response_received_at: new Date().toISOString(),
      response_document_url: docUrl.value.trim() || undefined,
    })
    fb.showToast('Response recorded. The referral is now closed.', 'success')
    emit('responded', saved)
  } catch (err) {
    // Left on screen rather than a toast: the officer's typed reasoning is
    // still in the form and must not look as though it saved.
    error.value = fb.parseApiError(err, 'Could not record the response')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="crp" :aria-label="`Referral response — ${departmentLabel}`">
    <header class="crp-head">
      <div class="crp-head-l">
        <h3 class="crp-title">{{ departmentLabel }}</h3>
        <p class="crp-sub">
          Circulated
          <time v-if="consultation.circulated_at || consultation.contacted_at"
                :datetime="consultation.circulated_at || consultation.contacted_at">
            {{ new Date(consultation.circulated_at || consultation.contacted_at).toLocaleDateString() }}
          </time>
          <span v-else>—</span>
          <template v-if="consultation.response_due_at">
            · due {{ new Date(consultation.response_due_at).toLocaleDateString() }}
          </template>
        </p>
      </div>
      <UiStatusBadge :status="recordedStatus" />
    </header>

    <!-- Already answered: show the record, not a form that would overwrite it. -->
    <div v-if="answered" class="crp-recorded">
      <p v-if="recordedNotes" class="crp-recorded-notes">{{ recordedNotes }}</p>
      <p v-else class="crp-recorded-notes crp-muted">No further comment was recorded.</p>
      <p v-if="consultation.response_received_at" class="crp-meta">
        Recorded {{ new Date(consultation.response_received_at).toLocaleString() }}
      </p>
      <a v-if="consultation.response_document_url"
         class="crp-doc" :href="consultation.response_document_url"
         target="_blank" rel="noopener noreferrer">Supporting document</a>
    </div>

    <p v-else-if="readonly" class="crp-muted">
      Awaiting this department's response.
    </p>

    <form v-else class="crp-form" @submit.prevent="submit">
      <fieldset class="crp-outcomes" :disabled="saving">
        <legend class="crp-legend">Response</legend>
        <label v-for="o in OUTCOMES" :key="o.value" class="crp-outcome">
          <input
            type="radio"
            name="crp-outcome"
            :value="o.value"
            v-model="outcome"
          />
          <span class="crp-outcome-body">
            <span class="crp-outcome-label">{{ o.label }}</span>
            <span class="crp-outcome-hint">{{ o.hint }}</span>
          </span>
        </label>
      </fieldset>

      <label class="crp-field">
        <span class="crp-label">
          Comments
          <span v-if="notesRequired" class="crp-req">(required for this response)</span>
        </span>
        <textarea
          v-model="notes"
          class="crp-textarea"
          rows="4"
          :disabled="saving"
          :aria-invalid="notesRequired && !notes.trim()"
          placeholder="State the department's finding precisely enough that the planner can carry it into the determination."
        />
      </label>

      <label class="crp-field">
        <span class="crp-label">Supporting document link (optional)</span>
        <input
          v-model="docUrl"
          class="crp-input"
          type="url"
          :disabled="saving"
          placeholder="https://…"
        />
      </label>

      <p v-if="error" class="crp-error" role="alert">{{ error }}</p>

      <div class="crp-actions">
        <UiButton
          type="submit"
          variant="primary"
          :disabled="!canSubmit"
          :loading="saving"
        >Record response</UiButton>
      </div>
    </form>
  </section>
</template>

<style scoped>
/* --ent-* only: this panel appears in four different role workspaces and must
   look the same in all of them. */
.crp {
  border: 1px solid var(--ent-border);
  border-radius: var(--ent-radius-md, 6px);
  background: var(--ent-surface);
  padding: var(--ent-space-4, 1rem);
  display: flex; flex-direction: column; gap: var(--ent-space-3, 0.75rem);
}
.crp-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; }
.crp-title { margin: 0; font-size: var(--ent-text-base, 0.95rem); font-weight: 600; color: var(--ent-text); }
.crp-sub { margin: 0.15rem 0 0; font-size: var(--ent-text-xs, 0.75rem); color: var(--ent-text-muted); }
.crp-muted { color: var(--ent-text-muted); font-size: var(--ent-text-sm, 0.85rem); margin: 0; }

.crp-recorded { display: flex; flex-direction: column; gap: 0.3rem; }
.crp-recorded-notes { margin: 0; font-size: var(--ent-text-sm, 0.85rem); color: var(--ent-text); white-space: pre-wrap; }
.crp-meta { margin: 0; font-size: var(--ent-text-xs, 0.75rem); color: var(--ent-text-muted); }
.crp-doc { font-size: var(--ent-text-xs, 0.75rem); color: var(--ent-accent); }

.crp-form { display: flex; flex-direction: column; gap: var(--ent-space-3, 0.75rem); }
.crp-outcomes { border: 0; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.4rem; }
.crp-legend { font-size: var(--ent-text-xs, 0.75rem); font-weight: 600; color: var(--ent-text-muted);
  text-transform: uppercase; letter-spacing: 0.06em; padding: 0; }
.crp-outcome { display: flex; gap: 0.6rem; align-items: flex-start; padding: 0.5rem;
  border: 1px solid var(--ent-border); border-radius: var(--ent-radius-sm, 4px); cursor: pointer; }
.crp-outcome:focus-within { outline: 2px solid var(--ent-accent); outline-offset: 1px; }
.crp-outcome-body { display: flex; flex-direction: column; gap: 0.1rem; }
.crp-outcome-label { font-size: var(--ent-text-sm, 0.85rem); font-weight: 600; color: var(--ent-text); }
.crp-outcome-hint { font-size: var(--ent-text-xs, 0.75rem); color: var(--ent-text-muted); }

.crp-field { display: flex; flex-direction: column; gap: 0.25rem; }
.crp-label { font-size: var(--ent-text-xs, 0.75rem); font-weight: 600; color: var(--ent-text-muted); }
.crp-req { font-weight: 400; text-transform: none; letter-spacing: 0; }
.crp-textarea, .crp-input {
  font: inherit; font-size: var(--ent-text-sm, 0.85rem);
  padding: 0.5rem 0.6rem; border: 1px solid var(--ent-border);
  border-radius: var(--ent-radius-sm, 4px); background: var(--ent-surface);
  color: var(--ent-text); width: 100%;
}
.crp-textarea:focus, .crp-input:focus { outline: 2px solid var(--ent-accent); outline-offset: -1px; }
.crp-error { margin: 0; color: var(--ent-tone-negative-fg, #b91c1c); font-size: var(--ent-text-sm, 0.85rem); }
.crp-actions { display: flex; justify-content: flex-end; }

/* Touch targets stay at the 44px floor on coarse pointers. */
@media (pointer: coarse) {
  .crp-outcome { min-height: 44px; }
}
</style>
