<script setup lang="ts">
// Referrals and site-inspection requests on the open case — read from the
// server (application_consultation), not the case file's local copy, so the
// specialist's response actually reaches the planner.
//
// mode="referrals"   technical circulation: roads, EMA, neighbouring
//                    authorities, Engineering Services, Environmental Health.
//                    Follow up overdue replies; record paper replies.
// mode="inspection"  request a site inspection from a Development Control
//                    Officer and review the findings they return.
import { computed, reactive, ref, watch } from 'vue'
import { dmApi, type Consultation } from '@/services/developmentManagementService'
import { useUiFeedback } from '@/composables/useUiFeedback'
import {
  REFERRAL_BODIES, SITE_INSPECTION_BODY, SITE_INSPECTION_TASK, DEFAULT_RESPONSE_DAYS,
  referralState, responseStatus, isSiteInspection, dueDateFrom, RESPONSE_LABEL,
} from '../referralRules'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { Send, BellRing, PenLine } from 'lucide-vue-next'

const props = defineProps<{ permitId: string | null; mode: 'referrals' | 'inspection' }>()
const emit = defineEmits<{ changed: [rows: Consultation[]] }>()

const fb = useUiFeedback()
const all = ref<Consultation[]>([])
const loading = ref(false)
const loadError = ref('')

async function load() {
  if (!props.permitId) { all.value = []; return }
  loading.value = true
  loadError.value = ''
  try {
    all.value = await dmApi.listConsultations(props.permitId)
    emit('changed', all.value)
  } catch (e) {
    loadError.value = fb.parseApiError(e, 'Could not load referrals for this case.')
  } finally {
    loading.value = false
  }
}
watch(() => props.permitId, load, { immediate: true })

const rows = computed(() => all.value
  .filter(c => props.mode === 'inspection' ? isSiteInspection(c) : !isSiteInspection(c))
  .sort((a, b) => (a.circulated_at || a.created_at || '').localeCompare(b.circulated_at || b.created_at || '')))
const overdue = computed(() => rows.value.filter(c => referralState(c) === 'overdue').length)
const sentTo = computed(() => new Set(rows.value.map(c => c.body_name || c.department)))

// ── New referral / inspection request ─────────────────────────────────────
const draft = reactive({
  body: props.mode === 'inspection' ? SITE_INSPECTION_BODY : '',
  customBody: '',
  due: dueDateFrom(props.mode === 'inspection' ? 14 : DEFAULT_RESPONSE_DAYS),
  brief: '',
  priority: 'normal' as NonNullable<Consultation['priority']>,
  blocking: true,
})
const sending = ref(false)

async function send() {
  const body = props.mode === 'inspection' ? SITE_INSPECTION_BODY
    : (draft.body === '__other' ? draft.customBody.trim() : draft.body)
  if (!props.permitId || !body) {
    fb.openMessageBox({ kind: 'warn', title: 'Choose who to refer to', message: 'Select a body, or name one under Other.' })
    return
  }
  if (props.mode === 'inspection' && !draft.brief.trim()) {
    fb.openMessageBox({ kind: 'warn', title: 'Say what to inspect', message: 'Tell the officer what to verify on site.' })
    return
  }
  sending.value = true
  try {
    await dmApi.createConsultation(props.permitId, {
      body_name: body,
      department: body,
      response_due_at: draft.due,
      response_notes: draft.brief.trim() || undefined,
      priority: draft.priority,
      blocking: draft.blocking,
      task_type: props.mode === 'inspection' ? SITE_INSPECTION_TASK : 'referral',
    } as Partial<Consultation>)
    fb.showToast(props.mode === 'inspection' ? 'Site inspection requested' : `Referred to ${body}`, 'success')
    draft.brief = ''
    draft.customBody = ''
    if (props.mode === 'referrals') draft.body = ''
    await load()
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not send', message: fb.parseApiError(e, 'The server rejected the referral.') })
  } finally {
    sending.value = false
  }
}

// ── Follow-up ─────────────────────────────────────────────────────────────
async function chase(c: Consultation) {
  try {
    await dmApi.updateConsultationTask(c.id, { escalate: true, priority: 'high', response_due_at: dueDateFrom(7) })
    fb.showToast(`Reminder recorded for ${c.body_name}. New due date in 7 days.`, 'success')
    await load()
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not record the reminder', message: fb.parseApiError(e, 'The server rejected the update.') })
  }
}

const recording = ref<string | null>(null)
const reply = reactive({ status: 'no_objection', notes: '', received: new Date().toISOString().slice(0, 10) })
function startReply(c: Consultation) {
  recording.value = c.id
  Object.assign(reply, { status: 'no_objection', notes: '', received: new Date().toISOString().slice(0, 10) })
}
async function saveReply(c: Consultation) {
  if (reply.status !== 'no_objection' && !reply.notes.trim()) {
    fb.openMessageBox({ kind: 'warn', title: 'Record the substance', message: 'An objection or conditions must be written down.' })
    return
  }
  try {
    await dmApi.respondConsultation(c.id, {
      response_status: reply.status, response_notes: reply.notes.trim() || undefined, response_received_at: reply.received,
    })
    recording.value = null
    fb.showToast('Response recorded', 'success')
    await load()
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not record the response', message: fb.parseApiError(e, 'The server rejected it.') })
  }
}

async function accept(c: Consultation, taskStatus: 'accepted' | 'returned') {
  try {
    await dmApi.updateConsultationTask(c.id, { task_status: taskStatus })
    fb.showToast(taskStatus === 'accepted' ? 'Findings accepted' : 'Returned to the officer', 'success')
    await load()
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not update', message: fb.parseApiError(e, 'The server rejected it.') })
  }
}

function fmtDate(v?: string | null) {
  return v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
}
const STATE_TONE = { responded: 'positive', overdue: 'negative', awaiting: 'info', cancelled: 'neutral' } as const
const STATE_LABEL = { responded: 'Responded', overdue: 'Overdue', awaiting: 'Awaiting', cancelled: 'Cancelled' } as const
</script>

<template>
  <div class="cr">
    <p v-if="!permitId" class="cr-hint">Register the application first; referrals attach to the permit record.</p>
    <template v-else>
      <form class="cr-form" @submit.prevent="send">
        <h3>{{ mode === 'inspection' ? 'Request a site inspection' : 'Refer the application' }}</h3>
        <div class="cr-grid">
          <label v-if="mode === 'referrals'" class="cr-wide">Refer to
            <select v-model="draft.body">
              <option value="" disabled>Choose a body</option>
              <option v-for="b in REFERRAL_BODIES" :key="b" :value="b">{{ b }}{{ sentTo.has(b) ? ' — already referred' : '' }}</option>
              <option value="__other">Other…</option>
            </select>
          </label>
          <label v-if="mode === 'referrals' && draft.body === '__other'" class="cr-wide">Name of body
            <input v-model="draft.customBody" />
          </label>
          <label>Reply due<input v-model="draft.due" type="date" /></label>
          <label>Priority
            <select v-model="draft.priority">
              <option value="low">Low</option><option value="normal">Normal</option>
              <option value="high">High</option><option value="urgent">Urgent</option>
            </select>
          </label>
          <label class="cr-wide">{{ mode === 'inspection' ? 'What to verify on site *' : 'Covering note' }}
            <textarea v-model="draft.brief" rows="2"
              :placeholder="mode === 'inspection' ? 'e.g. confirm existing structures, building lines, access and any work already started' : 'Points you want the body to address'" />
          </label>
          <label class="cr-check"><input v-model="draft.blocking" type="checkbox" /> Decision waits for this reply</label>
        </div>
        <UiButton type="submit" variant="primary" size="sm" :loading="sending">
          <template #icon><Send :size="13" /></template>
          {{ mode === 'inspection' ? 'Send request' : 'Send referral' }}
        </UiButton>
      </form>

      <p v-if="loadError" class="cr-error" role="alert">{{ loadError }}</p>
      <p v-else-if="overdue" class="cr-warn" role="status">{{ overdue }} {{ overdue === 1 ? 'reply is' : 'replies are' }} overdue. Send a reminder or record a paper reply.</p>

      <UiEmptyState v-if="!rows.length && !loading && !loadError"
        :message="mode === 'inspection' ? 'No site inspection requested on this case.' : 'Not yet referred to any body.'" />
      <ul v-else class="cr-list">
        <li v-for="c in rows" :key="c.id" class="cr-item" :class="referralState(c)">
          <div class="cr-head">
            <strong>{{ c.body_name || c.department }}</strong>
            <UiStatusBadge :tone="STATE_TONE[referralState(c)]" :label="STATE_LABEL[referralState(c)]" />
          </div>
          <p class="cr-meta">
            Sent {{ fmtDate(c.circulated_at || c.contacted_at) }} · due {{ fmtDate(c.response_due_at) }}
            <template v-if="c.escalated_at"> · reminded {{ fmtDate(c.escalated_at) }}</template>
            <template v-if="c.blocking"> · decision waits</template>
          </p>
          <p v-if="responseStatus(c) !== 'pending'" class="cr-response">
            <strong>{{ RESPONSE_LABEL[responseStatus(c)] ?? responseStatus(c) }}</strong>
            <template v-if="c.response_received_at"> · received {{ fmtDate(c.response_received_at) }}</template>
          </p>
          <p v-if="c.response_notes" class="cr-notes">{{ c.response_notes }}</p>

          <form v-if="recording === c.id" class="cr-grid cr-reply" @submit.prevent="saveReply(c)">
            <label>Reply
              <select v-model="reply.status">
                <option value="no_objection">No objection</option>
                <option value="conditional_approval">No objection, with conditions</option>
                <option value="objection">Objection</option>
                <option value="no_response">No response received</option>
              </select>
            </label>
            <label>Received<input v-model="reply.received" type="date" /></label>
            <label class="cr-wide">Substance of the reply<textarea v-model="reply.notes" rows="2" /></label>
            <div class="cr-actions cr-wide">
              <UiButton type="submit" size="sm" variant="primary">Save reply</UiButton>
              <UiButton size="sm" variant="ghost" @click="recording = null">Cancel</UiButton>
            </div>
          </form>

          <div v-else class="cr-actions">
            <template v-if="referralState(c) === 'overdue' || referralState(c) === 'awaiting'">
              <UiButton size="sm" @click="chase(c)">
                <template #icon><BellRing :size="12" /></template>
                Send reminder
              </UiButton>
              <UiButton v-if="mode === 'referrals'" size="sm" @click="startReply(c)">
                <template #icon><PenLine :size="12" /></template>
                Record paper reply
              </UiButton>
            </template>
            <template v-if="mode === 'inspection' && referralState(c) === 'responded' && c.task_status === 'responded'">
              <UiButton size="sm" variant="primary" @click="accept(c, 'accepted')">Accept findings</UiButton>
              <UiButton size="sm" @click="accept(c, 'returned')">Return for more work</UiButton>
            </template>
            <span v-if="c.task_status === 'accepted'" class="cr-accepted">Findings accepted</span>
          </div>
        </li>
      </ul>
    </template>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.cr { display: flex; flex-direction: column; gap: var(--ent-s3); }
.cr-hint { margin: 0; color: var(--ent-text-3); font-size: var(--ent-fs-sm); }
.cr-form { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); padding: var(--ent-s3); }
.cr-form h3 { margin: 0 0 var(--ent-s2); font-size: var(--ent-fs-md); font-weight: var(--ent-fw-semibold); }
.cr-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: var(--ent-s2) var(--ent-s3); margin-bottom: var(--ent-s3); }
.cr-grid label { display: flex; flex-direction: column; gap: var(--ent-s1); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.cr-grid .cr-wide { grid-column: 1 / -1; }
.cr-grid .cr-check { flex-direction: row; align-items: center; gap: var(--ent-s2); grid-column: 1 / -1; font-size: var(--ent-fs-sm); }
.cr-grid input:not([type=checkbox]), .cr-grid select, .cr-grid textarea {
  font: inherit; font-size: var(--ent-fs-sm); color: var(--ent-text); padding: var(--ent-s2) var(--ent-s3);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); background: var(--ent-surface); }
.cr-grid input:focus, .cr-grid select:focus, .cr-grid textarea:focus { outline: none; border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
.cr-error { margin: 0; color: var(--ent-danger); font-size: var(--ent-fs-sm); }
.cr-warn { margin: 0; padding: var(--ent-s2) var(--ent-s3); border-radius: var(--ent-r-sm);
  background: var(--ent-danger-soft); color: var(--ent-danger); font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); }
.cr-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }
.cr-item { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); padding: var(--ent-s3); }
.cr-head { display: flex; align-items: center; gap: var(--ent-s2); justify-content: space-between; }
.cr-meta { margin: 4px 0 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.cr-response { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-sm); }
.cr-notes { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); white-space: pre-wrap; }
.cr-reply { margin: var(--ent-s2) 0 0; }
.cr-actions { display: flex; gap: var(--ent-s2); flex-wrap: wrap; margin-top: var(--ent-s2); align-items: center; }
.cr-accepted { font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); color: var(--ent-success); }
@media (max-width: 767px) { .cr-grid { grid-template-columns: 1fr; } }
</style>
