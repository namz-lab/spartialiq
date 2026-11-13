<script setup lang="ts">
/** Add an audit to the plan, or change one: area, dates, lead, phase and status. */
import { onMounted, reactive, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { internalAuditApi, type AuditEngagement, type EngagementBody } from '../../../api/dashboardsApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { PHASE, STATUS } from '../dashboard'

const props = defineProps<{ engagement?: AuditEngagement | null }>()
const emit = defineEmits<{ (e: 'saved', a: AuditEngagement): void; (e: 'close'): void }>()
const store = useFinanceStore()

const e = props.engagement
const form = reactive<EngagementBody>({
  title: e?.title ?? '', area: e?.area ?? '', phase: e?.phase ?? 'planning', status: e?.status ?? 'not_started',
  planned_start: e?.planned_start ?? null, planned_end: e?.planned_end ?? null, lead_user_id: e?.lead_user_id ?? null,
  notes: e?.notes ?? '', financial_year_id: e ? e.financial_year_id : store.selectedYearId,
})
const auditors = ref<{ id: string; name: string }[]>([])
const busy = ref(false)
const error = ref<string | null>(null)
const AREAS = ['Revenue collection', 'Payments and procurement', 'Payroll and HR', 'Cash office', 'Budget control', 'Capital projects', 'Stock and assets', 'Information systems', 'Governance']

onMounted(async () => { try { auditors.value = await internalAuditApi.auditors() } catch { auditors.value = [] } })

async function submit(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  const body: EngagementBody = { ...form, planned_start: form.planned_start || null, planned_end: form.planned_end || null, lead_user_id: form.lead_user_id || null, notes: form.notes || null }
  try {
    emit('saved', e ? await internalAuditApi.updateEngagement(e.id, body) : await internalAuditApi.createEngagement(body))
  } catch (err) {
    error.value = messageOf(err, 'The audit could not be saved.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="cw-dialog-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form class="cw-dialog cw-dialog--wide" role="dialog" aria-modal="true" :aria-label="e ? 'Change audit' : 'Add an audit to the plan'" @submit.prevent="submit">
      <header>
        <h3>{{ e ? 'Change audit' : 'Add an audit to the plan' }}</h3>
        <button type="button" class="cw-icon-btn" aria-label="Close" @click="emit('close')"><X :size="20" /></button>
      </header>
      <div class="cw-dialog-body ad-grid">
        <label class="cw-field ad-full"><span class="cw-label">Title</span>
          <input v-model="form.title" class="cw-input" required minlength="3" maxlength="200" placeholder="e.g. Revenue Collection Review" /></label>
        <label class="cw-field"><span class="cw-label">Area</span>
          <input v-model="form.area" class="cw-input" required minlength="2" maxlength="120" list="ad-areas" />
          <datalist id="ad-areas"><option v-for="a in AREAS" :key="a" :value="a" /></datalist></label>
        <label class="cw-field"><span class="cw-label">Lead auditor</span>
          <select v-model="form.lead_user_id" class="cw-input"><option :value="null">Not assigned</option>
            <option v-for="a in auditors" :key="a.id" :value="a.id">{{ a.name }}</option></select></label>
        <label class="cw-field"><span class="cw-label">Planned start</span><input v-model="form.planned_start" type="date" class="cw-input" /></label>
        <label class="cw-field"><span class="cw-label">Planned end</span><input v-model="form.planned_end" type="date" class="cw-input" /></label>
        <label class="cw-field"><span class="cw-label">Phase</span>
          <select v-model="form.phase" class="cw-input"><option v-for="(l, v) in PHASE" :key="v" :value="v">{{ l }}</option></select></label>
        <label class="cw-field"><span class="cw-label">Status</span>
          <select v-model="form.status" class="cw-input"><option v-for="(l, v) in STATUS" :key="v" :value="v">{{ l }}</option></select></label>
        <label class="cw-field ad-full"><span class="cw-label">Notes</span><textarea v-model="form.notes" class="cw-textarea" maxlength="2000" /></label>
        <p v-if="error" class="cw-banner-msg cw-banner-msg--neg ad-full" role="alert">{{ error }}</p>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="emit('close')">Back</button>
        <button type="submit" class="cw-btn cw-btn--primary" :disabled="busy">{{ busy ? 'Saving…' : e ? 'Save changes' : 'Add to plan' }}</button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.ad-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
.ad-full { grid-column: 1 / -1; }
@media (max-width: 640px) { .ad-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
