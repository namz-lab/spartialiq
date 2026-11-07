<script setup lang="ts">
// Public notification — RTCP Act [Ch. 29:12] s.26(3).
//
// Three things must be done and evidenced before an application that requires
// notice can be determined: the newspaper advert, written notice to abutting
// owners, and the notice posted on the site. Then the objection period runs,
// objections are considered one by one with reasons, and only then is the case
// ready for determination.
//
// ONE CASE AT A TIME. The previous version loaded every case in the notice
// queue and then, for each of them, fetched the notice record and the
// objections — two requests per case on mount, on a rural link, to render
// cards the officer would read one of. It now reads the queue, and the notice
// and objections for the case that is open.

import { computed, reactive, ref, watch } from 'vue'
import {
  dmApi,
  type Objection, type PublicNotice, type PublicNoticeStep,
} from '@/services/developmentManagementService'
import { statusLabel } from '@/composables/useApplicationPipeline'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { useEoCase } from '@/eo-planner/useEoCase'
import { useEoWorkload } from '@/eo-planner/useEoWorkload'
import { fmtDate, daysUntil, isoDay } from '@/utils/dates'
import UiFeedback from '@/components/UiFeedback.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import CaseRequired from './CaseRequired.vue'
import {
  Megaphone, RefreshCw, CheckCircle2, Circle, Clock, Send, CalendarClock,
  Loader2, AlertTriangle, ShieldCheck, XCircle, Plus, Newspaper, Mail, MapPin,
} from 'lucide-vue-next'
import '@/views/inspector/inspector.css'

const fb = useUiFeedback()
const eoCase = useEoCase()
const workload = useEoWorkload()

// ── The queue ─────────────────────────────────────────────────────────
// Cases on notice come from the shared workload, which the console loads once.
const queue = workload.notification

const { refreshNow } = useStaleRefresh(() => workload.refresh())

// ── The open case ─────────────────────────────────────────────────────
const notice = ref<PublicNotice | null>(null)
const objections = ref<Objection[]>([])
const loading = ref(false)
const busy = ref<string | null>(null)

const period = reactive({ start: '', end: '' })
const advertRef = ref('')

async function loadCase(id: string | null) {
  notice.value = null
  objections.value = []
  if (!id) return
  loading.value = true
  try {
    const [n, o] = await Promise.all([
      dmApi.getPublicNotice(id).catch(() => null),
      dmApi.listObjections(id).catch(() => [] as Objection[]),
    ])
    notice.value = n
    objections.value = o
    advertRef.value = n?.advert_reference ?? ''
    period.start = n?.objection_period_start?.slice(0, 10) ?? ''
    period.end = n?.objection_period_end?.slice(0, 10) ?? ''
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not read the notice record.'), 'error')
  } finally {
    loading.value = false
  }
}
watch(() => eoCase.caseId.value, id => { void loadCase(id) }, { immediate: true })

// ── Statutory steps ───────────────────────────────────────────────────
const STEPS: { key: PublicNoticeStep; label: string; hint: string; icon: typeof Newspaper }[] = [
  { key: 'advert', label: 'Newspaper advert published', icon: Newspaper,
    hint: 'Section 26(3): a notice in a newspaper circulating in the area.' },
  { key: 'abutting_owners', label: 'Abutting owners notified', icon: Mail,
    hint: 'Written notice to the owners of every abutting property, by registered post.' },
  { key: 'site_notice', label: 'Notice posted on the site', icon: MapPin,
    hint: 'A notice displayed on the land itself, legible from a public place.' },
]

function stepDone(step: PublicNoticeStep): boolean {
  const n = notice.value
  if (!n) return false
  if (step === 'advert') return n.advert_verified
  if (step === 'abutting_owners') return n.abutting_owners_verified
  if (step === 'site_notice') return n.site_notice_verified
  return false
}
function stepWhen(step: PublicNoticeStep): string | null {
  const n = notice.value
  if (!n) return null
  if (step === 'advert') return n.advert_verified_at
  if (step === 'abutting_owners') return n.abutting_owners_verified_at
  if (step === 'site_notice') return n.site_notice_verified_at
  return null
}

const allStepsDone = computed(() => STEPS.every(s => stepDone(s.key)))

async function toggleStep(step: PublicNoticeStep) {
  const id = eoCase.caseId.value
  if (!id) return
  const current = stepDone(step)
  busy.value = step
  try {
    notice.value = await dmApi.verifyPublicNotice(id, {
      step,
      verified: !current,
      reference: step === 'advert' ? (advertRef.value || undefined) : undefined,
    })
    fb.showToast(current ? 'Verification cleared.' : 'Step verified.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not record that step.'), 'error')
  } finally {
    busy.value = null
  }
}

// ── Objection period ──────────────────────────────────────────────────
const daysLeftInPeriod = computed(() => daysUntil(notice.value?.objection_period_end))

async function setPeriod() {
  const id = eoCase.caseId.value
  if (!id) return
  if (period.start && period.end && period.end < period.start) {
    fb.showToast('The period cannot end before it starts.', 'warning')
    return
  }
  busy.value = 'period'
  try {
    notice.value = await dmApi.verifyPublicNotice(id, {
      step: 'set_period',
      objection_period_start: period.start || undefined,
      objection_period_end: period.end || undefined,
    })
    fb.showToast('Objection period recorded.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not set the period.'), 'error')
  } finally {
    busy.value = null
  }
}

async function closePeriod(close: boolean) {
  const id = eoCase.caseId.value
  if (!id) return
  busy.value = 'close'
  try {
    notice.value = await dmApi.verifyPublicNotice(id, {
      step: 'objection_period_closed', verified: close,
    })
    fb.showToast(close ? 'Objection period closed.' : 'Objection period re-opened.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not update the period.'), 'error')
  } finally {
    busy.value = null
  }
}

// ── Objections ────────────────────────────────────────────────────────
const pending = computed(() => objections.value.filter(o => o.sustained == null))

const notes = reactive<Record<string, string>>({})
const evidence = reactive<Record<string, string>>({})

async function resolve(o: Objection, sustained: boolean) {
  if (!notes[o.id]?.trim()) {
    fb.showToast('An objection is determined with reasons — write the decision note first.', 'warning')
    return
  }
  busy.value = `obj:${o.id}`
  try {
    const updated = await dmApi.considerObjection(o.id, {
      sustained,
      consideration_notes: notes[o.id].trim(),
      resolution_document_url: evidence[o.id]?.trim() || undefined,
    })
    const i = objections.value.findIndex(x => x.id === o.id)
    if (i >= 0) objections.value[i] = { ...objections.value[i], ...updated }
    fb.showToast(sustained ? 'Objection sustained.' : 'Objection dismissed.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not record that determination.'), 'error')
  } finally {
    busy.value = null
  }
}

// Objections arrive on paper at the counter as often as through the portal.
const lodgeOpen = ref(false)
const lodgeForm = reactive({
  objector_name: '', objector_contact: '', objector_address: '',
  grounds: '', grounds_detail: '', received_at: isoDay(), document_url: '',
})

async function lodgeObjection() {
  const id = eoCase.caseId.value
  if (!id) return
  if (!lodgeForm.objector_name.trim() || !lodgeForm.grounds.trim()) {
    fb.showToast('Record who objected and on what grounds.', 'warning')
    return
  }
  busy.value = 'lodge'
  try {
    const created = await dmApi.createObjection(id, {
      objector_name: lodgeForm.objector_name.trim(),
      objector_contact: lodgeForm.objector_contact.trim() || null,
      objector_address: lodgeForm.objector_address.trim() || null,
      grounds: lodgeForm.grounds.trim(),
      grounds_detail: lodgeForm.grounds_detail.trim() || null,
      received_at: lodgeForm.received_at,
      document_url: lodgeForm.document_url.trim() || null,
    })
    objections.value = [created, ...objections.value]
    lodgeOpen.value = false
    Object.assign(lodgeForm, {
      objector_name: '', objector_contact: '', objector_address: '',
      grounds: '', grounds_detail: '', received_at: isoDay(), document_url: '',
    })
    fb.showToast('Objection recorded on the file.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not record the objection.'), 'error')
  } finally {
    busy.value = null
  }
}

// ── Asking the applicant to respond ───────────────────────────────────
const requestMsg = ref('')

async function requestResponse() {
  const id = eoCase.caseId.value
  if (!id || !requestMsg.value.trim()) {
    fb.showToast('Write the request to the applicant first.', 'warning')
    return
  }
  busy.value = 'request'
  try {
    await dmApi.postMessage(id, {
      body: requestMsg.value.trim(),
      message_type: 'citizen_message',
      visibility: 'citizen',
    })
    requestMsg.value = ''
    fb.showToast('Sent to the applicant.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not send the request.'), 'error')
  } finally {
    busy.value = null
  }
}
</script>

<template>
  <div class="ins-page pn">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">RTCP Act [Ch. 29:12] s.26(3)</span>
        <h2 class="ins-title"><Megaphone :size="18" aria-hidden="true" /> Public notice</h2>
        <p class="ins-lede">
          The advert, the abutting owners, the site notice, and the objections that follow.
          All three notices must be evidenced before the application is determined.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="ins-iconbtn" :disabled="workload.loading.value"
                title="Reload" @click="refreshNow">
          <RefreshCw :size="15" aria-hidden="true" :class="{ 'ins-spin': workload.loading.value }" />
          <span class="ent-sr-only">Reload the notice queue</span>
        </button>
      </div>
    </header>

    <!-- Cases on notice: a way in when nothing is open -->
    <section v-if="!eoCase.caseId.value" class="ins-card">
      <header class="ins-card-head">
        <h3>On public notice</h3>
        <span class="ins-count">{{ queue.length }}</span>
      </header>
      <p v-if="!queue.length" class="pn-msg">
        No application is in the notice period. An application enters it once the notices
        have gone out and the objection period is running.
      </p>
      <ul v-else class="ins-rows">
        <li v-for="p in queue" :key="p.id">
          <button type="button" class="ins-row pn-row" @click="eoCase.open(p.id)">
            <span class="ins-row-main">
              <span class="ins-row-title">
                <span class="ins-mono">{{ p.dev_register_no || p.id.slice(0, 8).toUpperCase() }}</span>
                · {{ p.applicant_name }}
              </span>
              <span class="ins-row-meta">
                Stand {{ p.stand_number }}<template v-if="p.suburb_ward"> · {{ p.suburb_ward }}</template>
                · {{ statusLabel(p.status) }}
              </span>
            </span>
          </button>
        </li>
      </ul>
    </section>

    <CaseRequired v-if="!eoCase.caseId.value" what="The notice record and its objections" />

    <template v-else>
      <p v-if="loading" class="pn-msg">Reading the notice record…</p>

      <template v-else>
        <!-- Statutory notices -->
        <section class="ins-card">
          <header class="ins-card-head">
            <h3>Statutory notification</h3>
            <span class="ins-count">{{ STEPS.filter(s => stepDone(s.key)).length }} of 3 evidenced</span>
          </header>
          <div class="ins-card-body pn-steps">
            <div v-for="s in STEPS" :key="s.key" class="pn-step" :class="{ done: stepDone(s.key) }">
              <button type="button" class="pn-check" :disabled="busy === s.key"
                      :aria-pressed="stepDone(s.key)" @click="toggleStep(s.key)">
                <component :is="busy === s.key ? Loader2 : stepDone(s.key) ? CheckCircle2 : Circle"
                           :size="17" aria-hidden="true" :class="{ 'ins-spin': busy === s.key }" />
              </button>
              <div class="pn-step-text">
                <strong>{{ s.label }}</strong>
                <small>{{ s.hint }}</small>
                <span v-if="stepWhen(s.key)" class="pn-when">
                  Evidenced {{ fmtDate(stepWhen(s.key)) }}
                </span>
              </div>
              <label v-if="s.key === 'advert'" class="ins-field pn-advert">
                <span class="ent-sr-only">Advert reference</span>
                <input v-model="advertRef" class="ins-input"
                       placeholder="Newspaper and date, or the advert reference" />
              </label>
            </div>

            <p v-if="!allStepsDone" class="ins-banner t-warning">
              <AlertTriangle :size="16" aria-hidden="true" />
              <span>
                <strong>Notice is not complete.</strong>
                A determination made before all three notices are evidenced is open to
                challenge on procedure alone.
              </span>
            </p>
          </div>
        </section>

        <!-- Objection period -->
        <section class="ins-card">
          <header class="ins-card-head"><h3>Objection period</h3></header>
          <div class="ins-card-body pn-period">
            <div class="ins-form">
              <label class="ins-field">
                <span class="ins-label">From</span>
                <input v-model="period.start" type="date" class="ins-input" />
              </label>
              <label class="ins-field">
                <span class="ins-label">To</span>
                <input v-model="period.end" type="date" class="ins-input" />
              </label>
              <div class="ins-field pn-period-actions">
                <span class="ins-label">&nbsp;</span>
                <button type="button" class="pn-btn" :disabled="busy === 'period'" @click="setPeriod">
                  <component :is="busy === 'period' ? Loader2 : CalendarClock" :size="14" aria-hidden="true"
                             :class="{ 'ins-spin': busy === 'period' }" />
                  Record the period
                </button>
              </div>
            </div>

            <p v-if="notice?.objection_period_closed" class="ins-banner t-positive">
              <ShieldCheck :size="16" aria-hidden="true" />
              <span>
                <strong>Closed {{ fmtDate(notice.objection_period_closed_at) }}.</strong>
                No further objection can be entertained as of right.
              </span>
              <button type="button" class="pn-btn" :disabled="busy === 'close'" @click="closePeriod(false)">
                Re-open
              </button>
            </p>
            <p v-else-if="notice?.objection_period_end" class="ins-banner"
               :class="(daysLeftInPeriod ?? 0) < 0 ? 't-warning' : 't-info'">
              <Clock :size="16" aria-hidden="true" />
              <span>
                <template v-if="(daysLeftInPeriod ?? 0) < 0">
                  <strong>The period ended {{ Math.abs(daysLeftInPeriod ?? 0) }} day(s) ago.</strong>
                  Close it to record that objections are no longer open.
                </template>
                <template v-else>
                  <strong>{{ daysLeftInPeriod }} day(s) left to object.</strong>
                  Ends {{ fmtDate(notice.objection_period_end) }}.
                </template>
              </span>
              <button type="button" class="pn-btn" :disabled="busy === 'close'" @click="closePeriod(true)">
                <component :is="busy === 'close' ? Loader2 : Clock" :size="14" aria-hidden="true"
                           :class="{ 'ins-spin': busy === 'close' }" />
                Close the period
              </button>
            </p>
          </div>
        </section>

        <!-- Objections -->
        <section class="ins-card">
          <header class="ins-card-head">
            <h3>Objections</h3>
            <span class="ins-count">
              {{ objections.length }} on file · {{ pending.length }} undetermined
            </span>
            <button type="button" class="pn-btn" @click="lodgeOpen = true">
              <Plus :size="14" aria-hidden="true" /> Record one
            </button>
          </header>

          <p v-if="!objections.length" class="pn-msg">
            No objection has been lodged against this application.
          </p>

          <ul v-else class="pn-objections">
            <li v-for="o in objections" :key="o.id">
              <header>
                <strong>{{ o.objector_name }}</strong>
                <span class="pn-meta">lodged {{ fmtDate(o.received_at) }}</span>
                <span class="pn-pill"
                      :class="o.sustained === true ? 't-negative' : o.sustained === false ? 't-positive' : 't-warning'">
                  {{ o.sustained === true ? 'Sustained' : o.sustained === false ? 'Dismissed' : 'Undetermined' }}
                </span>
              </header>
              <p class="pn-grounds">{{ o.grounds_detail || o.grounds }}</p>

              <p v-if="o.consideration_notes" class="pn-determination">
                <strong>Determination:</strong> {{ o.consideration_notes }}
                <a v-if="o.resolution_document_url" :href="o.resolution_document_url"
                   target="_blank" rel="noopener"> · evidence</a>
              </p>

              <div v-else class="pn-resolve">
                <label class="ins-field full">
                  <span class="ins-label">Reasons</span>
                  <textarea class="ins-input" rows="2"
                            :value="notes[o.id] ?? ''"
                            placeholder="Why this objection is sustained or dismissed…"
                            @input="notes[o.id] = ($event.target as HTMLTextAreaElement).value"></textarea>
                </label>
                <label class="ins-field full">
                  <span class="ins-label">Evidence (link, optional)</span>
                  <input class="ins-input" :value="evidence[o.id] ?? ''"
                         @input="evidence[o.id] = ($event.target as HTMLInputElement).value" />
                </label>
                <div class="pn-resolve-actions">
                  <button type="button" class="pn-btn danger" :disabled="busy === `obj:${o.id}`"
                          @click="resolve(o, true)">
                    <component :is="busy === `obj:${o.id}` ? Loader2 : CheckCircle2" :size="14"
                               aria-hidden="true" :class="{ 'ins-spin': busy === `obj:${o.id}` }" />
                    Sustain
                  </button>
                  <button type="button" class="pn-btn" :disabled="busy === `obj:${o.id}`"
                          @click="resolve(o, false)">
                    <XCircle :size="14" aria-hidden="true" /> Dismiss
                  </button>
                </div>
              </div>
            </li>
          </ul>
        </section>

        <!-- Ask the applicant -->
        <section class="ins-card">
          <header class="ins-card-head"><h3>Ask the applicant to respond</h3></header>
          <div class="ins-card-body pn-request">
            <label class="ins-field full">
              <span class="ins-label">Message to the applicant</span>
              <textarea v-model="requestMsg" rows="3" class="ins-input"
                        placeholder="Address the grounds raised, or amend the layout…"></textarea>
              <p class="ins-hint">
                Sent to the applicant through their portal and recorded on the case thread.
              </p>
            </label>
            <button type="button" class="pn-btn primary" :disabled="busy === 'request'"
                    @click="requestResponse">
              <component :is="busy === 'request' ? Loader2 : Send" :size="14" aria-hidden="true"
                         :class="{ 'ins-spin': busy === 'request' }" />
              Send
            </button>
          </div>
        </section>
      </template>
    </template>

    <!-- Record an objection -->
    <UiSheet :open="lodgeOpen" title="Record an objection"
             subtitle="Received at the counter or by post" width="34rem"
             @close="lodgeOpen = false" @update:open="lodgeOpen = $event">
      <form class="ins-form" @submit.prevent="lodgeObjection">
        <label class="ins-field">
          <span class="ins-label">Objector</span>
          <input v-model="lodgeForm.objector_name" class="ins-input" />
        </label>
        <label class="ins-field">
          <span class="ins-label">Received on</span>
          <input v-model="lodgeForm.received_at" type="date" class="ins-input" :max="isoDay()" />
        </label>
        <label class="ins-field">
          <span class="ins-label">Telephone or email</span>
          <input v-model="lodgeForm.objector_contact" class="ins-input" />
        </label>
        <label class="ins-field">
          <span class="ins-label">Address</span>
          <input v-model="lodgeForm.objector_address" class="ins-input" />
        </label>
        <label class="ins-field full">
          <span class="ins-label">Grounds (summary)</span>
          <input v-model="lodgeForm.grounds" class="ins-input"
                 placeholder="Overlooking, access, use incompatible with the zone…" />
        </label>
        <label class="ins-field full">
          <span class="ins-label">Grounds as written</span>
          <textarea v-model="lodgeForm.grounds_detail" rows="4" class="ins-input"></textarea>
        </label>
        <label class="ins-field full">
          <span class="ins-label">Scan of the letter (link)</span>
          <input v-model="lodgeForm.document_url" class="ins-input" />
        </label>
        <div class="pn-sheet-actions full">
          <button type="button" class="pn-btn" @click="lodgeOpen = false">Cancel</button>
          <button type="submit" class="pn-btn primary" :disabled="busy === 'lodge'">
            <component :is="busy === 'lodge' ? Loader2 : Plus" :size="14" aria-hidden="true"
                       :class="{ 'ins-spin': busy === 'lodge' }" />
            Record it
          </button>
        </div>
      </form>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.pn-row { width:100%; background:none; border:0; text-align:left; cursor:pointer; font-family:var(--ent-font); }
.pn-row:hover { background:var(--ent-surface-2); }
.pn-row:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.pn-steps { display:flex; flex-direction:column; gap:var(--ent-s4); }
.pn-step { display:flex; align-items:flex-start; gap:var(--ent-s3);
  padding:var(--ent-s3); border:1px solid var(--ent-line); border-radius:var(--ent-r-md); }
.pn-step.done { border-color:var(--ent-tone-positive-line); background:var(--ent-tone-positive-bg); }
.pn-check { flex-shrink:0; display:inline-flex; align-items:center; justify-content:center;
  width:var(--ent-control-h); height:var(--ent-control-h); background:none; border:0;
  color:var(--ent-text-3); cursor:pointer; }
.pn-step.done .pn-check { color:var(--ent-success); }
.pn-check:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); border-radius:var(--ent-r-sm); }
.pn-check:disabled { opacity:0.6; cursor:not-allowed; }
.pn-step-text { flex:1; min-width:0; }
.pn-step-text strong { display:block; font-size:var(--ent-fs-base); font-weight:var(--ent-fw-semibold);
  color:var(--ent-text); }
.pn-step-text small { display:block; margin-top:2px; font-size:var(--ent-fs-xs);
  color:var(--ent-text-2); line-height:var(--ent-lh); }
.pn-when { display:block; margin-top:var(--ent-s1); font-size:var(--ent-fs-micro); color:var(--ent-text-3); }
.pn-advert { flex:0 0 16rem; }

.pn-period { display:flex; flex-direction:column; gap:var(--ent-s4); }
.pn-period-actions { justify-content:flex-end; }

.pn-objections { list-style:none; margin:0; padding:0; }
.pn-objections > li { padding:var(--ent-s4); border-top:1px solid var(--ent-line); }
.pn-objections > li > header { display:flex; align-items:baseline; gap:var(--ent-s3);
  flex-wrap:wrap; margin-bottom:var(--ent-s2); }
.pn-objections strong { font-size:var(--ent-fs-base); color:var(--ent-text); }
.pn-meta { font-size:var(--ent-fs-xs); color:var(--ent-text-3); }
.pn-pill { margin-left:auto; padding:1px 8px; border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); }
.pn-pill.t-positive { background:var(--ent-tone-positive-bg); color:var(--ent-tone-positive-fg); }
.pn-pill.t-negative { background:var(--ent-tone-negative-bg); color:var(--ent-tone-negative-fg); }
.pn-pill.t-warning { background:var(--ent-tone-warning-bg); color:var(--ent-tone-warning-fg); }
.pn-grounds { margin:0; font-size:var(--ent-fs-sm); color:var(--ent-text-2);
  line-height:var(--ent-lh); white-space:pre-wrap; }
.pn-determination { margin:var(--ent-s3) 0 0; padding:var(--ent-s2) var(--ent-s3);
  background:var(--ent-surface-2); border-left:3px solid var(--ent-accent);
  border-radius:var(--ent-r-sm); font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.pn-determination a { color:var(--ent-accent); }
.pn-resolve { display:flex; flex-direction:column; gap:var(--ent-s2); margin-top:var(--ent-s3);
  padding-top:var(--ent-s3); border-top:1px dashed var(--ent-line); }
.pn-resolve-actions { display:flex; gap:var(--ent-s2); justify-content:flex-end; }

.pn-request { display:flex; flex-direction:column; gap:var(--ent-s3); align-items:flex-start; }
.pn-request .ins-field { width:100%; }
.pn-sheet-actions { display:flex; justify-content:flex-end; gap:var(--ent-s2); }

.pn-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r); cursor:pointer; white-space:nowrap; }
.pn-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.pn-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.pn-btn:disabled { opacity:0.55; cursor:not-allowed; }
.pn-btn.primary { background:var(--ent-accent); border-color:var(--ent-accent); color:var(--ent-text-on-accent); }
.pn-btn.primary:hover:not(:disabled) { background:var(--ent-accent-hover); }
.pn-btn.danger { border-color:var(--ent-tone-negative-line); color:var(--ent-danger); }
.pn-btn.danger:hover:not(:disabled) { background:var(--ent-tone-negative-bg); }

.pn-msg { margin:0; padding:var(--ent-s6) var(--ent-s4); text-align:center;
  font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }

@media (max-width: 767px) {
  .pn-step { flex-wrap:wrap; }
  .pn-advert { flex:1 1 100%; }
}
</style>
