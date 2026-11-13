<script setup lang="ts">
/** Record a finding against an audit, or change an open one: risk, agreed action, owner, due date. */
import { reactive, ref } from 'vue'
import { X } from 'lucide-vue-next'
import { internalAuditApi, type AuditEngagement, type AuditFinding, type FindingBody } from '../../../api/dashboardsApi'
import { messageOf } from '../../../stores/finance'
import { RISK } from '../dashboard'

const props = defineProps<{ finding?: AuditFinding | null; engagements: AuditEngagement[] }>()
const emit = defineEmits<{ (e: 'saved', f: AuditFinding): void; (e: 'close'): void }>()

const f = props.finding
const form = reactive<FindingBody>({
  engagement_id: f?.engagement_id ?? props.engagements[0]?.id ?? '', title: f?.title ?? '', detail: f?.detail ?? '',
  risk: f?.risk ?? 'medium', action: f?.action ?? '', action_owner: f?.action_owner ?? '', due_date: f?.due_date ?? null,
})
const busy = ref(false)
const error = ref<string | null>(null)

async function submit(): Promise<void> {
  if (busy.value) return
  busy.value = true
  error.value = null
  const body: FindingBody = {
    title: form.title, risk: form.risk, detail: form.detail || null, action: form.action || null,
    action_owner: form.action_owner || null, due_date: form.due_date || null,
  }
  try {
    emit('saved', f ? await internalAuditApi.updateFinding(f.id, body) : await internalAuditApi.createFinding({ ...body, engagement_id: form.engagement_id }))
  } catch (err) {
    error.value = messageOf(err, 'The finding could not be saved.')
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="cw-dialog-backdrop" @click.self="emit('close')" @keydown.esc="emit('close')">
    <form class="cw-dialog cw-dialog--wide" role="dialog" aria-modal="true" :aria-label="f ? 'Change finding' : 'Record a finding'" @submit.prevent="submit">
      <header>
        <h3>{{ f ? 'Change finding' : 'Record a finding' }}</h3>
        <button type="button" class="cw-icon-btn" aria-label="Close" @click="emit('close')"><X :size="20" /></button>
      </header>
      <div class="cw-dialog-body fd-grid">
        <label v-if="!f" class="cw-field fd-full"><span class="cw-label">Audit</span>
          <select v-model="form.engagement_id" class="cw-input" required>
            <option v-for="e in engagements" :key="e.id" :value="e.id">{{ e.title }} ({{ e.area }})</option></select></label>
        <label class="cw-field fd-full"><span class="cw-label">Finding</span>
          <input v-model="form.title" class="cw-input" required minlength="3" maxlength="200" placeholder="What was found, in one line" /></label>
        <label class="cw-field fd-full"><span class="cw-label">Detail</span><textarea v-model="form.detail" class="cw-textarea" maxlength="4000" /></label>
        <label class="cw-field"><span class="cw-label">Risk</span>
          <select v-model="form.risk" class="cw-input"><option v-for="(l, v) in RISK" :key="v" :value="v">{{ l }}</option></select></label>
        <label class="cw-field"><span class="cw-label">Action due by</span><input v-model="form.due_date" type="date" class="cw-input" /></label>
        <label class="cw-field fd-full"><span class="cw-label">Agreed action</span><textarea v-model="form.action" class="cw-textarea" maxlength="2000" /></label>
        <label class="cw-field fd-full"><span class="cw-label">Action owner</span>
          <input v-model="form.action_owner" class="cw-input" maxlength="160" placeholder="e.g. Revenue Manager" /></label>
        <p v-if="error" class="cw-banner-msg cw-banner-msg--neg fd-full" role="alert">{{ error }}</p>
      </div>
      <footer>
        <button type="button" class="cw-btn" @click="emit('close')">Back</button>
        <button type="submit" class="cw-btn cw-btn--primary" :disabled="busy || !form.engagement_id">{{ busy ? 'Saving…' : f ? 'Save changes' : 'Record finding' }}</button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.fd-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px 16px; }
.fd-full { grid-column: 1 / -1; }
@media (max-width: 640px) { .fd-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
