<script setup lang="ts">
// Outbound field referral — Planner, EO Planner, Surveyor, Environment.
// Uses the canonical consultation API. Inspector cannot create enforcement
// orders; an enforcement referral is a consultation to the EO Planner.
import { ref, computed, watch } from 'vue'
import { Send } from 'lucide-vue-next'
import UiButton from '@/components/ui/UiButton.vue'
import { dmApi, type Consultation } from '@/services/developmentManagementService'
import { useUiFeedback } from '@/composables/useUiFeedback'

const props = defineProps<{
  permitId: string | null
  inspectionRef?: string
  stand?: string
  evidenceCount?: number
  disabledReason?: string
  /** Pre-select a desk, e.g. EO Planner when escalating an enforcement order. */
  initialTarget?: ReferralTarget
  /** Pre-fill the reason, e.g. the order reference and what was observed. */
  initialReason?: string
}>()

const emit = defineEmits<{ created: [Consultation] }>()
const fb = useUiFeedback()

export type ReferralTarget = 'planner' | 'eo_review' | 'survey' | 'environmental'

const TARGETS: { id: ReferralTarget; label: string; body: string; hint: string }[] = [
  { id: 'planner',       label: 'Planner',              body: 'Planner',              hint: 'Observed development differs from approved planning permission.' },
  { id: 'eo_review',      label: 'EO Planner',            body: 'EO Planner',            hint: 'Statutory or planning escalation.' },
  { id: 'survey',         label: 'Surveyor',            body: 'Surveyor',             hint: 'Boundary, setback or setting-out discrepancy.' },
  { id: 'environmental',   label: 'Environmental Officer', body: 'Environmental Officer', hint: 'Environmental concern observed on site.' },
]

const target = ref<ReferralTarget>(props.initialTarget ?? 'planner')
const reason = ref(props.initialReason ?? '')
watch(() => [props.initialTarget, props.initialReason] as const, ([t, r]) => {
  if (t) target.value = t
  if (r) reason.value = r
})
const due = ref('')
const priority = ref<NonNullable<Consultation['priority']>>('normal')
const busy = ref(false)

const selected = computed(() => TARGETS.find(t => t.id === target.value)!)
const canSubmit = computed(() =>
  !!props.permitId && reason.value.trim().length >= 12 && !props.disabledReason && !busy.value)

async function submit() {
  if (!props.permitId || !canSubmit.value) return
  busy.value = true
  try {
    const created = await dmApi.createConsultation(props.permitId, {
      body_name: selected.value.body,
      department: selected.value.body,
      task_type: target.value,
      priority: priority.value,
      response_due_at: due.value || undefined,
      response_notes: [
        reason.value.trim(),
        props.inspectionRef ? `Inspection: ${props.inspectionRef}` : '',
        props.stand ? `Stand: ${props.stand}` : '',
        props.evidenceCount ? `Evidence photographs: ${props.evidenceCount}` : '',
      ].filter(Boolean).join('\n'),
      blocking: target.value === 'eo_review',
    })
    reason.value = ''
    due.value = ''
    emit('created', created)
    fb.showToast(`Referral sent to ${selected.value.label}.`, 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Referral could not be created'), 'error')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <form class="irf" @submit.prevent="submit">
    <p v-if="disabledReason" class="irf-blocked">{{ disabledReason }}</p>
    <template v-else>
      <fieldset class="irf-targets">
        <legend class="ins-label">Refer to</legend>
        <div class="ins-chips" role="radiogroup" aria-label="Receiving desk">
          <button v-for="t in TARGETS" :key="t.id" type="button" class="ins-chip" role="radio"
                  :aria-checked="target === t.id" :aria-pressed="target === t.id" @click="target = t.id">
            {{ t.label }}
          </button>
        </div>
        <p class="ins-hint">{{ selected.hint }}</p>
      </fieldset>
      <label class="ins-field">
        <span class="ins-label">What you observed and what you need</span>
        <textarea v-model="reason" class="ins-input" rows="4" required minlength="12"
          :placeholder="selected.hint" />
        <span class="ins-hint">{{ reason.trim().length < 12 ? `At least 12 characters (${reason.trim().length})` : 'Stand, inspection and photo count are attached automatically.' }}</span>
      </label>
      <div class="irf-row">
        <label class="ins-field">
          <span class="ins-label">Priority</span>
          <select v-model="priority" class="ins-input">
            <option value="low">Low</option>
            <option value="normal">Normal</option>
            <option value="high">High</option>
            <option value="urgent">Urgent</option>
          </select>
        </label>
        <label class="ins-field">
          <span class="ins-label">Response due</span>
          <input v-model="due" class="ins-input" type="date" />
        </label>
      </div>
      <p v-if="!permitId" class="ins-hint">Open a permit before creating a referral.</p>
      <UiButton type="submit" variant="primary" class="irf-submit" :loading="busy" :disabled="!canSubmit">
        <template #icon><Send :size="14" /></template>
        Refer to {{ selected.label }}
      </UiButton>
    </template>
  </form>
</template>

<style scoped>
.irf { display:flex; flex-direction:column; gap:var(--ent-s4); }
.irf-targets { border:0; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.irf-row { display:grid; grid-template-columns:1fr 1fr; gap:var(--ent-s3); }
.irf-blocked { margin:0; padding:var(--ent-s3) var(--ent-s4); font-size:var(--ent-fs-sm); color:var(--ent-text-2);
  background:var(--ent-surface-2); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }
.irf-submit { align-self:flex-end; }
@media (max-width: 767px) { .irf-row { grid-template-columns:1fr; } .irf-submit { align-self:stretch; } }
</style>
