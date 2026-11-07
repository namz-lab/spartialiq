<script setup lang="ts">
// Step 5 — Acknowledgement, public notice and objections (RTCP Act s.26(2)–(4)).
//
// The notice record and the objections live on the server (public_notice,
// application_objection); this screen reads and writes them there. The case
// file keeps a mirror of the objections only because the committee report and
// the overview timeline read it.
import { ref, computed, onMounted, reactive, watch } from 'vue'
import { dmApi, type Objection, type PublicNotice } from '@/services/developmentManagementService'
import { usePlannerCase } from '@/composables/usePlannerCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { useAuthStore } from '@/stores/auth'
import { determinationDeadline, objectionDeadline } from '@/statutory/periods'
import { noticeRequirement } from './caseClock'
import { requestInfoLetter, renderDraftPdf } from './plannerDocuments'
import { dueDateFrom } from './referralRules'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { Mail, AlertOctagon, Newspaper, FileWarning } from 'lucide-vue-next'

const { current, save } = usePlannerCase()
const fb = useUiFeedback()
const auth = useAuthStore()
const officer = computed(() => auth.user?.name || auth.user?.email || 'Town Planning Officer')
const permitId = computed(() => current.value?.permitId ?? null)

// ── Acknowledgement / further information ─────────────────────────────────
// The case's acknowledged date is loaded from the server; ackSentAt is only
// set when acknowledged from this screen.
const acknowledgedAt = computed(() => current.value?.acknowledgedDate || current.value?.notices.ackSentAt || null)
function sendAck() {
  if (!current.value) return
  const now = new Date().toISOString()
  current.value.acknowledgedDate = now
  current.value.notices.ackSentAt = now
  current.value.expiryDate = determinationDeadline(now, current.value.proposal.devType) as string
  save()
  fb.showToast('Acknowledgement issued — statutory clock started', 'success')
}

const info = reactive({ open: false, items: '', due: dueDateFrom(14), sending: false })
async function requestInfo() {
  const c = current.value
  const items = info.items.split('\n').map(s => s.trim()).filter(Boolean)
  if (!c?.permitId || !items.length) {
    fb.openMessageBox({ kind: 'warn', title: 'List what is missing', message: 'Write one item per line.' })
    return
  }
  info.sending = true
  try {
    await dmApi.requestCitizenInfo(c.permitId, {
      message: `Further information is required on application ${c.registrationNo}:\n${items.map((x, i) => `${i + 1}. ${x}`).join('\n')}\nPlease submit it by ${info.due}.`,
      due_at: info.due,
    })
    renderDraftPdf(requestInfoLetter(caseRef(), items, info.due, officer.value))
    c.notices.ackReturnedAt = new Date().toISOString()
    save()
    info.open = false
    info.items = ''
    fb.showToast('Request sent to the applicant; letter downloaded', 'success')
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not send the request', message: fb.parseApiError(e, 'The server rejected it.') })
  } finally {
    info.sending = false
  }
}

function caseRef() {
  const c = current.value!
  return {
    reference: c.registrationNo || c.fileRef, applicant: c.applicant.name, standNo: c.property.standNo,
    ward: c.property.ward, proposal: c.proposal.description || c.proposal.devType.replace(/_/g, ' '),
  }
}

// ── Public notice (server record) ─────────────────────────────────────────
const requirement = computed(() => current.value
  ? noticeRequirement(current.value.proposal.devType, current.value.classification)
  : { required: false, why: '' })
const notice = ref<PublicNotice | null>(null)
const noticeForm = reactive({ advertRef: '', start: new Date().toISOString().slice(0, 10), owners: '' })
const periodEnd = computed(() => {
  // s.26(4): objections are received for one month from the date public notice was given
  return objectionDeadline(`${noticeForm.start}T00:00:00.000Z`).slice(0, 10)
})

async function loadNotice() {
  if (!permitId.value) return
  try { notice.value = await dmApi.getPublicNotice(permitId.value) }
  catch { notice.value = null }
}

async function verify(step: 'advert' | 'abutting_owners' | 'site_notice' | 'objection_period_closed' | 'set_period', extra: Record<string, string> = {}) {
  if (!permitId.value) return
  try {
    notice.value = await dmApi.verifyPublicNotice(permitId.value, { step, verified: true, ...extra })
    if (step === 'abutting_owners' && current.value) {
      const owners = noticeForm.owners.split('\n').map(s => s.trim()).filter(Boolean)
      // The abutting step stores only the fact; the list served goes in the notes.
      if (owners.length) {
        notice.value = await dmApi.verifyPublicNotice(permitId.value, {
          step: 'notes', notes: `Adjoining owners notified:\n${owners.join('\n')}`,
        })
      }
      current.value.notices.publicNotice = {
        newspaper: noticeForm.advertRef, publishedAt: noticeForm.start,
        abuttingOwners: owners, proofUploadedAt: null,
      }
      save()
    }
    fb.showToast('Notice record updated', 'success')
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not update the notice record', message: fb.parseApiError(e, 'The server rejected it.') })
  }
}

const daysLeft = computed(() => {
  const end = notice.value?.objection_period_end
  if (!end) return null
  return Math.ceil((new Date(end).getTime() - Date.now()) / 86_400_000)
})

// ── Objections ────────────────────────────────────────────────────────────
const objections = ref<Objection[]>([])
async function refreshObjections() {
  if (!permitId.value || !current.value) return
  try {
    objections.value = await dmApi.listObjections(permitId.value)
    current.value.notices.objections = objections.value.map(o => ({
      id: o.id, objector: o.objector_name, grounds: o.grounds,
      receivedAt: o.received_at, officerView: o.consideration_notes ?? '', resolvedAt: o.considered_at ?? o.resolved_at,
    }))
    save()
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'Could not load objections'), 'error')
  }
}

const newObjection = reactive({ objector: '', address: '', grounds: '' })
async function addObjection() {
  if (!permitId.value || !newObjection.objector.trim() || !newObjection.grounds.trim()) return
  try {
    await dmApi.createObjection(permitId.value, {
      objector_name: newObjection.objector.trim(),
      objector_address: newObjection.address.trim() || null,
      grounds: newObjection.grounds.trim(),
      received_at: new Date().toISOString(),
    })
    Object.assign(newObjection, { objector: '', address: '', grounds: '' })
    await refreshObjections()
    fb.showToast('Objection logged', 'success')
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not log objection', message: fb.parseApiError(e, 'The server rejected the objection.') })
  }
}

async function sendToApplicant(o: Objection) {
  const c = current.value
  if (!c?.permitId) return
  try {
    await dmApi.postMessage(c.permitId, {
      body: `An objection has been received on your application ${c.registrationNo}. Grounds: ${o.grounds}\n`
        + 'You may respond in writing within 14 days. Your response will be considered with the objection.',
      message_type: 'citizen_message', visibility: 'citizen',
    })
    fb.showToast('Objection sent to the applicant for response', 'success')
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not send', message: fb.parseApiError(e, 'The server rejected the message.') })
  }
}

const consider = reactive<Record<string, { applicant: string; view: string }>>({})
const draftFor = (id: string) => (consider[id] ??= { applicant: '', view: '' })
async function decide(o: Objection, sustained: boolean) {
  const d = draftFor(o.id)
  if (!d.view.trim()) {
    fb.openMessageBox({ kind: 'warn', title: 'Record your consideration', message: 'Write the planning view before sustaining or dismissing.' })
    return
  }
  try {
    await dmApi.considerObjection(o.id, {
      sustained,
      consideration_notes: `${d.applicant.trim() ? `Applicant's response: ${d.applicant.trim()}\n` : ''}Planning view: ${d.view.trim()}`,
    })
    await refreshObjections()
    fb.showToast(sustained ? 'Objection sustained' : 'Objection dismissed', 'success')
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not record the consideration', message: fb.parseApiError(e, 'The server rejected it.') })
  }
}

function sendOutcomeLetter() {
  if (!current.value) return
  current.value.notices.outcomeLetterSentAt = new Date().toISOString()
  save()
  fb.showToast('Outcome letter recorded as sent', 'success')
}

onMounted(() => { void loadNotice(); void refreshObjections() })
watch(permitId, () => { void loadNotice(); void refreshObjections() })

const fmt = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
</script>

<template>
  <div v-if="current" class="step5">
    <section class="s5-card">
      <header><Mail :size="13" aria-hidden="true" /> Acknowledgement (s.26(2))</header>
      <div v-if="acknowledgedAt" class="s5-done">Acknowledged {{ fmt(acknowledgedAt) }}. Statutory clock running.</div>
      <div v-if="current.notices.ackReturnedAt" class="s5-warn">Further information requested {{ fmt(current.notices.ackReturnedAt) }}.</div>
      <div class="s5-actions">
        <UiButton v-if="!acknowledgedAt" size="sm" variant="primary" @click="sendAck">Acknowledge receipt</UiButton>
        <UiButton size="sm" @click="info.open = !info.open">Request further information</UiButton>
      </div>
      <form v-if="info.open" class="s5-form" @submit.prevent="requestInfo">
        <label>What is missing (one item per line)<textarea v-model="info.items" rows="3" /></label>
        <label>Reply by<input v-model="info.due" type="date" /></label>
        <UiButton type="submit" size="sm" variant="primary" :loading="info.sending" :disabled="!permitId">Send and download letter</UiButton>
      </form>
    </section>

    <section class="s5-card">
      <header><Newspaper :size="13" aria-hidden="true" /> Public notice and adjoining owners (s.26(3))</header>
      <p class="s5-rec" :class="{ req: requirement.required }">
        <strong>{{ requirement.required ? 'Notice required.' : 'Notice not normally required.' }}</strong> {{ requirement.why }}
      </p>
      <p v-if="!permitId" class="s5-empty">Register the application before recording notice.</p>
      <div v-else class="s5-steps">
        <div class="s5-step">
          <span>Newspaper notice</span>
          <UiStatusBadge v-if="notice?.advert_verified" tone="positive" :label="`Published · ${notice.advert_reference || ''}`" />
          <template v-else>
            <input v-model="noticeForm.advertRef" placeholder="Newspaper and date, e.g. The Herald 12 Oct" aria-label="Newspaper and date" />
            <UiButton size="sm" @click="verify('advert', { reference: noticeForm.advertRef })">Record</UiButton>
          </template>
        </div>
        <div class="s5-step">
          <span>Site notice</span>
          <UiStatusBadge v-if="notice?.site_notice_verified" tone="positive" :label="`Posted ${fmt(notice.site_notice_verified_at)}`" />
          <UiButton v-else size="sm" @click="verify('site_notice')">Confirm posted</UiButton>
        </div>
        <div class="s5-step s5-step--col">
          <span>Adjoining owners</span>
          <template v-if="notice?.abutting_owners_verified">
            <UiStatusBadge tone="positive" :label="`Notified ${fmt(notice.abutting_owners_verified_at)}`" />
            <p v-if="notice.notes" class="s5-view">{{ notice.notes }}</p>
          </template>
          <template v-else>
            <textarea v-model="noticeForm.owners" rows="3" placeholder="One owner and stand per line" aria-label="Adjoining owners" />
            <UiButton size="sm" @click="verify('abutting_owners')">Record notices served</UiButton>
          </template>
        </div>
        <div class="s5-step">
          <span>Objection period</span>
          <template v-if="notice?.objection_period_end">
            <span class="s5-period">{{ fmt(notice.objection_period_start) }} – {{ fmt(notice.objection_period_end) }}</span>
            <UiStatusBadge v-if="notice.objection_period_closed" tone="neutral" label="Closed" />
            <template v-else>
              <UiStatusBadge :tone="(daysLeft ?? 0) > 0 ? 'info' : 'warning'" :label="(daysLeft ?? 0) > 0 ? `${daysLeft} days left` : 'Period has run'" />
              <UiButton size="sm" :disabled="(daysLeft ?? 1) > 0" @click="verify('objection_period_closed')">Close period</UiButton>
            </template>
          </template>
          <template v-else>
            <input v-model="noticeForm.start" type="date" aria-label="Period starts" />
            <span class="s5-period">to {{ fmt(periodEnd) }}</span>
            <UiButton size="sm" @click="verify('set_period', { objection_period_start: noticeForm.start, objection_period_end: periodEnd })">Start one-month period</UiButton>
          </template>
        </div>
      </div>
    </section>

    <section class="s5-card">
      <header><FileWarning :size="13" aria-hidden="true" /> Objections ({{ objections.length }})</header>
      <ul v-if="objections.length" class="s5-obj-list">
        <li v-for="o in objections" :key="o.id">
          <div class="s5-obj-head">
            <strong>{{ o.objector_name }}</strong>
            <span class="s5-obj-meta">received {{ fmt(o.received_at) }}</span>
            <UiStatusBadge v-if="o.considered_at || o.sustained != null"
                           :tone="o.sustained ? 'warning' : 'neutral'" :label="o.sustained ? 'Sustained' : 'Dismissed'" />
          </div>
          <p>{{ o.grounds }}</p>
          <p v-if="o.consideration_notes" class="s5-view">{{ o.consideration_notes }}</p>
          <div v-else class="s5-form">
            <UiButton size="sm" @click="sendToApplicant(o)">Send to applicant for response</UiButton>
            <label>Applicant's response<textarea v-model="draftFor(o.id).applicant" rows="2" /></label>
            <label>Planning view *<textarea v-model="draftFor(o.id).view" rows="2" /></label>
            <div class="s5-actions s5-actions--flush">
              <UiButton size="sm" @click="decide(o, false)">Dismiss objection</UiButton>
              <UiButton size="sm" variant="danger" @click="decide(o, true)">Sustain objection</UiButton>
            </div>
          </div>
        </li>
      </ul>
      <div v-else class="s5-empty">No objections recorded.</div>
      <form class="s5-form" @submit.prevent="addObjection">
        <label>Objector *<input v-model="newObjection.objector" /></label>
        <label>Address<input v-model="newObjection.address" /></label>
        <label>Grounds *<textarea v-model="newObjection.grounds" rows="2" /></label>
        <UiButton type="submit" size="sm" :disabled="!permitId || !newObjection.objector.trim() || !newObjection.grounds.trim()">Log objection</UiButton>
      </form>
    </section>

    <section class="s5-card">
      <header><AlertOctagon :size="13" aria-hidden="true" /> Outcome letter</header>
      <div v-if="current.notices.outcomeLetterSentAt" class="s5-done">Sent {{ fmt(current.notices.outcomeLetterSentAt) }}</div>
      <div v-else class="s5-actions">
        <UiButton size="sm" :disabled="!current.committeeReport.resolutionAt" @click="sendOutcomeLetter">Record outcome letter sent</UiButton>
        <span v-if="!current.committeeReport.resolutionAt" class="s5-hint">Record the decision in Committee first.</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.step5 { display: flex; flex-direction: column; gap: var(--ent-s3); padding: var(--ent-s3); }
.s5-card { border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); background: var(--ent-surface); }
.s5-card > header { display: flex; align-items: center; gap: var(--ent-s1); padding: var(--ent-s2) var(--ent-s3);
  border-bottom: 1px solid var(--ent-line); background: var(--ent-surface-2);
  font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.s5-done { padding: var(--ent-s2) var(--ent-s3); font-size: var(--ent-fs-sm); color: var(--ent-success); background: var(--ent-success-soft); }
.s5-warn { padding: var(--ent-s2) var(--ent-s3); font-size: var(--ent-fs-sm); color: var(--ent-warning); background: var(--ent-warning-soft); }
.s5-rec { margin: 0; padding: var(--ent-s2) var(--ent-s3); font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.s5-rec.req strong { color: var(--ent-accent); }
.s5-actions { padding: var(--ent-s2) var(--ent-s3); display: flex; gap: var(--ent-s2); align-items: center; flex-wrap: wrap; }
.s5-actions--flush { padding: 0; }
.s5-form { padding: var(--ent-s2) var(--ent-s3); display: flex; flex-direction: column; gap: var(--ent-s2); align-items: flex-start; }
.s5-form label { display: flex; flex-direction: column; gap: var(--ent-s1); font-size: var(--ent-fs-xs); color: var(--ent-text-2); align-self: stretch; }
.s5-form input, .s5-form textarea, .s5-step input, .s5-step textarea {
  font: inherit; font-size: var(--ent-fs-sm); padding: var(--ent-s1) var(--ent-s2); color: var(--ent-text);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); background: var(--ent-surface); }
.s5-form input:focus, .s5-form textarea:focus, .s5-step input:focus, .s5-step textarea:focus { outline: none; border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
.s5-steps { display: flex; flex-direction: column; }
.s5-step { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap;
  padding: var(--ent-s2) var(--ent-s3); border-top: 1px solid var(--ent-line); font-size: var(--ent-fs-sm); }
.s5-step > span:first-child { min-width: 9rem; font-weight: var(--ent-fw-semibold); }
.s5-step input:not([type=date]) { flex: 1; min-width: 12rem; }
.s5-step--col textarea { flex: 1; min-width: 12rem; }
.s5-period { color: var(--ent-text-2); }
.s5-obj-list { list-style: none; margin: 0; padding: 0; }
.s5-obj-list li { padding: var(--ent-s2) var(--ent-s3); border-bottom: 1px solid var(--ent-line); font-size: var(--ent-fs-sm); }
.s5-obj-list p { margin: 4px 0; color: var(--ent-text-2); }
.s5-obj-head { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.s5-obj-meta { color: var(--ent-text-3); font-size: var(--ent-fs-micro); }
.s5-view { white-space: pre-wrap; background: var(--ent-surface-2); padding: var(--ent-s2); border-radius: var(--ent-r-sm); }
.s5-empty { padding: var(--ent-s2) var(--ent-s3); font-size: var(--ent-fs-sm); color: var(--ent-text-3); margin: 0; }
.s5-hint { font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
</style>
