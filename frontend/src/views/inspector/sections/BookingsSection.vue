<script setup lang="ts">
// Bookings — the owner's side of the stage-inspection loop.
//
// Under Sec 14 of the By-Laws the owner gives notice (and pays the fee) before
// work reaches an inspection stage. Those requests land here: a waitlist of
// paid requests that need a date, and the inspector's own dated schedule, where
// a visit is rescheduled, recorded as passed or failed, or cancelled. Every
// change notifies the owner from the server.
//
// Nothing here is optimistic. A date or result is shown as recorded only after
// the server accepts it, and a failed load is never presented as an empty
// schedule.
import { computed, ref } from 'vue'
import {
  CalendarClock, CalendarPlus, RefreshCw, AlertTriangle, Clock, CheckCircle2, XCircle,
  Inbox, CalendarX2, FolderOpen, StickyNote, Timer,
} from 'lucide-vue-next'
import { inspectionsService, type InspectionBooking } from '@/services/inspectionsService'
import { dmApi, type PermitApplication } from '@/services/developmentManagementService'
import { groupAgenda, daysWaiting, noticeElapsed, localDateTime } from '@/inspector/bookingAgenda'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import { useInspectorWorkload } from '@/composables/useInspectorWorkload'
import { useInspectionCase } from '@/composables/useInspectionCase'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import UiKpi from '@/components/ui/UiKpi.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'

const emit = defineEmits<{ 'open-section': [key: 'stages'] }>()

const fb = useUiFeedback()
const { refreshWorkload } = useInspectorWorkload()
const ic = useInspectionCase()

const assigned = ref<InspectionBooking[]>([])
const waitlist = ref<InspectionBooking[]>([])
const permits = ref<Record<string, PermitApplication | null>>({})
const loading = ref(false)
const loaded = ref(false)
const error = ref<string | null>(null)

async function refresh() {
  loading.value = true
  error.value = null
  try {
    const q = await inspectionsService.inspectorQueue()
    assigned.value = q.assigned
    waitlist.value = q.waitlist
    loaded.value = true
    void resolveProperties([...q.assigned, ...q.waitlist])
  } catch (err: unknown) {
    error.value = fb.parseApiError(err, 'The booking queue could not be loaded.')
  } finally {
    loading.value = false
    // Keep the rail's count in step with this page, which may just have
    // changed it; otherwise the badge beside it lags until the next re-read.
    void refreshWorkload()
  }
}
// The agenda is judged against the clock — "Today", "overdue", hours of notice
// elapsed — so a list left cached across a morning of site visits is not merely
// old, it is wrong. Re-read it when the inspector returns to the section or
// wakes the phone.
useStaleRefresh(refresh)

/**
 * A booking carries only its application id. Where that id is a permit on the
 * register, show the stand and owner so the inspector knows where they are
 * going; otherwise say plainly that the property is not linked.
 */
async function resolveProperties(rows: InspectionBooking[]) {
  const ids = [...new Set(rows.map(r => r.applicationId))].filter(id => !(id in permits.value))
  const settled = await Promise.allSettled(ids.map(id => dmApi.getPermit(id)))
  settled.forEach((s, i) => { permits.value[ids[i]] = s.status === 'fulfilled' ? s.value : null })
}

function place(b: InspectionBooking): string {
  const p = permits.value[b.applicationId]
  if (p) return `Stand ${p.stand_number}${p.suburb_ward ? ` · ${p.suburb_ward}` : ''} · ${p.applicant_name}`
  if (p === null) return `Application ${b.applicationId.slice(0, 8).toUpperCase()} · property not linked to a permit`
  return 'Locating property…'
}

const agenda = computed(() => groupAgenda(assigned.value))
const inProgress = computed(() => assigned.value.filter(b => b.status === 'in_progress'))
const todayCount = computed(() => agenda.value.find(d => d.label === 'Today')?.bookings.length ?? 0)
const overdueCount = computed(() => agenda.value.find(d => d.overdue)?.bookings.length ?? 0)
const dueWaiting = computed(() => waitlist.value.filter(b => noticeElapsed(b)).length)

function time(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}
function dateTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// ── Schedule / reschedule ──────────────────────────────────────────────
type SheetMode = 'schedule' | 'reschedule' | 'outcome'
const sheet = ref<{ mode: SheetMode; booking: InspectionBooking } | null>(null)
const sheetOpen = computed({
  get: () => sheet.value !== null,
  set: (v) => { if (!v) sheet.value = null },
})
const busy = ref(false)

function isoDate(d: Date) {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const todayIso = isoDate(new Date())
const form = ref({ date: todayIso, time: '09:00', notes: '', passed: null as boolean | null })
const SLOTS = Array.from({ length: 19 }, (_, i) => {
  const mins = 7 * 60 + i * 30
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`
})

function openSheet(mode: SheetMode, booking: InspectionBooking) {
  const base = booking.scheduledFor ? new Date(booking.scheduledFor) : new Date(Date.now() + 86_400_000)
  const future = base.getTime() < Date.now() ? new Date(Date.now() + 86_400_000) : base
  form.value = {
    date: isoDate(future),
    time: booking.scheduledFor ? time(booking.scheduledFor) : '09:00',
    notes: '',
    passed: null,
  }
  if (!SLOTS.includes(form.value.time)) form.value.time = '09:00'
  sheet.value = { mode, booking }
}

const whenError = computed(() => {
  if (!sheet.value || sheet.value.mode === 'outcome') return null
  const when = localDateTime(form.value.date, form.value.time)
  if (!when) return 'Choose a valid date and time.'
  if (when.getTime() < Date.now()) return 'That time has already passed.'
  return null
})
const weekendNote = computed(() => {
  const when = localDateTime(form.value.date, form.value.time)
  return when && (when.getDay() === 0 || when.getDay() === 6) ? 'This is a weekend visit. Confirm the owner and site will be available.' : null
})

async function submitSheet() {
  const s = sheet.value
  if (!s || busy.value) return
  busy.value = true
  try {
    if (s.mode === 'outcome') {
      if (form.value.passed === null) { fb.showToast('Record whether the stage passed or failed.', 'warning'); return }
      if (form.value.passed === false && form.value.notes.trim().length < 10) {
        fb.showToast('Describe what failed and what the owner must correct.', 'warning'); return
      }
      await inspectionsService.complete(s.booking.id, form.value.passed, form.value.notes.trim() || undefined)
      fb.showToast(form.value.passed
        ? `Stage ${s.booking.stageNumber} recorded as passed. The owner has been notified.`
        : `Stage ${s.booking.stageNumber} recorded as failed. The owner has been notified.`, 'success')
    } else {
      if (whenError.value) { fb.showToast(whenError.value, 'warning'); return }
      const when = localDateTime(form.value.date, form.value.time)!.toISOString()
      if (s.mode === 'schedule') {
        await inspectionsService.schedule(s.booking.id, when, { inspectorNotes: form.value.notes.trim() || undefined })
      } else {
        await inspectionsService.reschedule(s.booking.id, when)
      }
      fb.showToast(`${s.mode === 'schedule' ? 'Scheduled' : 'Moved'} to ${dateTime(when)}. The owner has been notified.`, 'success')
    }
    sheet.value = null
    await refresh()
  } catch (err: unknown) {
    const code = (err as { response?: { data?: { error?: string } } })?.response?.data?.error
    const msg = code === 'date_in_past' ? 'That time has already passed.'
      : code === 'unpaid' ? 'The owner has not paid the inspection fee, so it cannot be scheduled.'
      : code === 'not_scheduled' ? 'Only a scheduled visit can be moved. Refresh the queue.'
      : fb.parseApiError(err, 'The booking was not updated.')
    fb.showToast(msg, 'error')
  } finally {
    busy.value = false
  }
}

async function cancel(b: InspectionBooking) {
  const ok = await fb.confirmAction(
    'Cancel this inspection?',
    `Stage ${b.stageNumber} — ${b.stageName}. The owner is notified and must book again.`,
    { confirmLabel: 'Cancel inspection', cancelLabel: 'Keep it', danger: true },
  )
  if (!ok) return
  try {
    await inspectionsService.cancel(b.id)
    fb.showToast('Inspection cancelled.', 'success')
    await refresh()
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'The inspection was not cancelled.'), 'error')
  }
}

async function openCase(b: InspectionBooking) {
  const p = permits.value[b.applicationId]
  if (!p) return
  try {
    await ic.loadPermit(p.id)
    emit('open-section', 'stages')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not open the case.'), 'error')
  }
}

const sheetTitle = computed(() => {
  const s = sheet.value
  if (!s) return ''
  return s.mode === 'schedule' ? 'Schedule inspection' : s.mode === 'reschedule' ? 'Move inspection' : 'Record outcome'
})
</script>

<template>
  <div class="ins-page bk">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Field work</span>
        <h2 class="ins-title">Bookings</h2>
        <p class="ins-lede">Owners request a stage inspection once work is ready and the fee is paid. Give each request a date, then record the outcome after the visit.</p>
      </div>
      <div class="ins-actions">
        <UiButton size="sm" :loading="loading" @click="refresh">
          <template #icon><RefreshCw :size="14" /></template>
          Refresh
        </UiButton>
      </div>
    </header>

    <div v-if="error" class="ins-banner t-negative" role="alert">
      <AlertTriangle :size="16" aria-hidden="true" />
      <div>
        <strong>The booking queue could not be loaded.</strong>
        <p>{{ error }} {{ loaded ? 'The lists below are from the last successful load.' : 'No bookings are being shown, which does not mean there are none.' }}</p>
      </div>
      <UiButton size="sm" @click="refresh">Retry</UiButton>
    </div>

    <div class="ins-kpis" aria-label="Booking workload">
      <UiKpi :value="loaded ? todayCount : '—'" label="Visits today" tone="info">
        <template #icon><CalendarClock :size="17" /></template>
      </UiKpi>
      <UiKpi :value="loaded ? overdueCount : '—'" label="Overdue visits" :tone="overdueCount ? 'negative' : 'neutral'">
        <template #icon><Clock :size="17" /></template>
      </UiKpi>
      <UiKpi :value="loaded ? waitlist.length : '—'" label="Awaiting a date" :tone="dueWaiting ? 'warning' : 'neutral'">
        <template #icon><Inbox :size="17" /></template>
      </UiKpi>
      <UiKpi :value="loaded ? inProgress.length : '—'" label="On site now">
        <template #icon><Timer :size="17" /></template>
      </UiKpi>
    </div>

    <div class="bk-cols">
      <!-- WAITLIST -->
      <section class="ins-card" aria-labelledby="bk-wait-h">
        <header class="ins-card-head">
          <h3 id="bk-wait-h"><Inbox :size="16" aria-hidden="true" /> Awaiting a date <span class="ins-count">{{ waitlist.length }}</span></h3>
        </header>

        <div v-if="loading && !loaded" class="bk-skel" aria-busy="true">
          <span v-for="n in 3" :key="n" class="ins-skel" />
        </div>
        <p v-else-if="loaded && !waitlist.length" class="bk-empty">
          <CheckCircle2 :size="20" aria-hidden="true" />
          No paid requests are waiting. New bookings appear here when an owner pays the inspection fee.
        </p>
        <ul v-else class="bk-list">
          <li v-for="b in waitlist" :key="b.id" class="bk-item" :class="{ due: noticeElapsed(b) }">
            <div class="bk-item-top">
              <span class="bk-stage">Stage {{ b.stageNumber }}</span>
              <strong>{{ b.stageName }}</strong>
              <span class="bk-wait" :class="{ due: noticeElapsed(b) }">
                {{ daysWaiting(b) === 0 ? 'Today' : `${daysWaiting(b)} d waiting` }}
              </span>
            </div>
            <p class="bk-place">{{ place(b) }}</p>
            <p v-if="b.citizenNotes" class="bk-note"><StickyNote :size="13" aria-hidden="true" /> {{ b.citizenNotes }}</p>
            <div class="bk-item-actions">
              <UiButton size="sm" variant="primary" @click="openSheet('schedule', b)">
                <template #icon><CalendarPlus :size="14" /></template>
                Schedule
              </UiButton>
              <UiButton v-if="permits[b.applicationId]" size="sm" variant="ghost" @click="openCase(b)">
                <template #icon><FolderOpen :size="14" /></template>
                Open case
              </UiButton>
            </div>
          </li>
        </ul>
      </section>

      <!-- SCHEDULE -->
      <section class="ins-card" aria-labelledby="bk-sched-h">
        <header class="ins-card-head">
          <h3 id="bk-sched-h"><CalendarClock :size="16" aria-hidden="true" /> My schedule <span class="ins-count">{{ assigned.length }}</span></h3>
        </header>

        <div v-if="loading && !loaded" class="bk-skel" aria-busy="true">
          <span v-for="n in 4" :key="n" class="ins-skel" />
        </div>
        <p v-else-if="loaded && !agenda.length" class="bk-empty">
          <CalendarX2 :size="20" aria-hidden="true" />
          Nothing scheduled. Pick a request from the waitlist to give it a date.
        </p>
        <div v-else class="bk-agenda">
          <section v-for="day in agenda" :key="day.key" class="bk-day" :class="{ overdue: day.overdue }">
            <h4>{{ day.label }} <span>{{ day.bookings.length }}</span></h4>
            <ol class="bk-list">
              <li v-for="b in day.bookings" :key="b.id" class="bk-item timed">
                <time class="bk-time" :datetime="b.scheduledFor ?? undefined">
                  {{ day.overdue ? new Date(b.scheduledFor!).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : time(b.scheduledFor) }}
                </time>
                <div class="bk-item-body">
                  <div class="bk-item-top">
                    <span class="bk-stage">Stage {{ b.stageNumber }}</span>
                    <strong>{{ b.stageName }}</strong>
                    <UiStatusBadge v-if="b.status !== 'scheduled'" :status="b.status"
                                   :tone="b.status === 'in_progress' ? 'info' : 'warning'"
                                   :label="b.status === 'in_progress' ? 'On site' : 'Rescheduled'" />
                  </div>
                  <p class="bk-place">{{ place(b) }}</p>
                  <p v-if="b.citizenNotes" class="bk-note"><StickyNote :size="13" aria-hidden="true" /> {{ b.citizenNotes }}</p>
                  <div class="bk-item-actions">
                    <UiButton size="sm" variant="primary" @click="openSheet('outcome', b)">
                      <template #icon><CheckCircle2 :size="14" /></template>
                      Record outcome
                    </UiButton>
                    <UiButton v-if="b.status !== 'in_progress'" size="sm" @click="openSheet('reschedule', b)">
                      Move
                    </UiButton>
                    <UiButton v-if="permits[b.applicationId]" size="sm" variant="ghost" @click="openCase(b)">
                      <template #icon><FolderOpen :size="14" /></template>
                      Case
                    </UiButton>
                    <UiButton size="sm" variant="ghost" class="bk-cancel" @click="cancel(b)">Cancel</UiButton>
                  </div>
                </div>
              </li>
            </ol>
          </section>
        </div>
      </section>
    </div>

    <UiSheet v-model:open="sheetOpen" :title="sheetTitle"
             :subtitle="sheet ? `Stage ${sheet.booking.stageNumber} — ${sheet.booking.stageName}` : undefined">
      <form v-if="sheet" id="bk-form" class="bk-form" @submit.prevent="submitSheet">
        <p class="ins-hint">{{ place(sheet.booking) }}</p>

        <template v-if="sheet.mode !== 'outcome'">
          <div class="ins-form">
            <label class="ins-field">
              <span class="ins-label">Date</span>
              <input v-model="form.date" class="ins-input" type="date" :min="todayIso" required />
            </label>
            <label class="ins-field">
              <span class="ins-label">Time</span>
              <select v-model="form.time" class="ins-input">
                <option v-for="t in SLOTS" :key="t" :value="t">{{ t }}</option>
              </select>
            </label>
          </div>
          <p v-if="whenError" class="bk-err" role="alert">{{ whenError }}</p>
          <p v-else-if="weekendNote" class="ins-hint">{{ weekendNote }}</p>
          <label v-if="sheet.mode === 'schedule'" class="ins-field">
            <span class="ins-label">Note to file (optional)</span>
            <textarea v-model="form.notes" class="ins-input" rows="3" maxlength="2000"
                      placeholder="Access instructions, who will meet you on site"></textarea>
          </label>
        </template>

        <template v-else>
          <fieldset class="bk-outcome">
            <legend class="ins-label">Result</legend>
            <div class="ins-seg" role="radiogroup" aria-label="Inspection result">
              <button type="button" role="radio" class="t-positive" :aria-checked="form.passed === true" @click="form.passed = true">
                <CheckCircle2 :size="15" aria-hidden="true" /> Passed
              </button>
              <button type="button" role="radio" class="t-negative" :aria-checked="form.passed === false" @click="form.passed = false">
                <XCircle :size="15" aria-hidden="true" /> Failed
              </button>
            </div>
          </fieldset>
          <label class="ins-field">
            <span class="ins-label">{{ form.passed === false ? 'What failed and what must be corrected' : 'Notes (optional)' }}</span>
            <textarea v-model="form.notes" class="ins-input" rows="4" maxlength="4000"
                      :placeholder="form.passed === false ? 'e.g. Trench depth 560 mm against 700 mm minimum. Deepen and re-book.' : 'Observations on site'"></textarea>
          </label>
          <p class="ins-hint">For a full Annexure 14 checklist with scores and photographs, use Open case and record the stage in Inspections.</p>
        </template>
      </form>

      <template #footer>
        <UiButton @click="sheet = null">Close</UiButton>
        <UiButton variant="primary" type="submit" form="bk-form" :loading="busy"
                  :disabled="sheet?.mode !== 'outcome' && !!whenError">
          {{ sheet?.mode === 'schedule' ? 'Schedule' : sheet?.mode === 'reschedule' ? 'Move visit' : 'Record outcome' }}
        </UiButton>
      </template>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.bk-cols { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: var(--ent-s4); align-items: start; }

.bk-skel { display: flex; flex-direction: column; gap: var(--ent-s3); padding: var(--ent-s4); }
.bk-skel .ins-skel { height: 56px; }
.bk-empty { display: flex; align-items: center; gap: var(--ent-s3); margin: 0; padding: var(--ent-s5) var(--ent-s4); font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.bk-empty svg { flex-shrink: 0; color: var(--ent-text-3); }

.bk-list { list-style: none; margin: 0; padding: 0; }
.bk-item { padding: var(--ent-s3) var(--ent-s4); border-top: 1px solid var(--ent-line); transition: background-color var(--ent-dur) var(--ent-ease); }
.bk-list > .bk-item:first-child { border-top: 0; }
.bk-item:hover { background: var(--ent-surface-2); }
.bk-item.due { box-shadow: inset 3px 0 0 var(--ent-warning); }
.bk-item.timed { display: grid; grid-template-columns: 4.25rem minmax(0, 1fr); gap: var(--ent-s3); }
.bk-time { padding-top: 2px; font-family: var(--ent-font-mono); font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); color: var(--ent-text); font-variant-numeric: tabular-nums; }
.bk-day.overdue .bk-time { color: var(--ent-danger); }
.bk-item-body { min-width: 0; }

.bk-item-top { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.bk-item-top strong { font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold); color: var(--ent-text); }
.bk-stage {
  padding: 1px var(--ent-s2); border-radius: var(--ent-r-sm);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold); letter-spacing: 0.03em;
  color: var(--ent-accent); background: var(--ent-accent-soft);
}
.bk-wait { margin-left: auto; font-size: var(--ent-fs-xs); color: var(--ent-text-3); font-variant-numeric: tabular-nums; }
.bk-wait.due { color: var(--ent-warning); font-weight: var(--ent-fw-semibold); }
.bk-place { margin: var(--ent-s1) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.bk-note { display: flex; gap: var(--ent-s2); margin: var(--ent-s2) 0 0; padding: var(--ent-s2) var(--ent-s3); font-size: var(--ent-fs-sm); color: var(--ent-text); background: var(--ent-surface-2); border-radius: var(--ent-r); }
.bk-note svg { flex-shrink: 0; margin-top: 2px; color: var(--ent-text-3); }
.bk-item-actions { display: flex; flex-wrap: wrap; gap: var(--ent-s2); margin-top: var(--ent-s3); }
.bk-cancel { margin-left: auto; color: var(--ent-danger); }

.bk-agenda { display: flex; flex-direction: column; }
.bk-day h4 {
  position: sticky; top: 0; z-index: 1; display: flex; align-items: center; gap: var(--ent-s2); margin: 0;
  padding: var(--ent-s2) var(--ent-s4); background: var(--ent-surface-2);
  border-top: 1px solid var(--ent-line); border-bottom: 1px solid var(--ent-line);
  font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-bold); letter-spacing: 0.04em; text-transform: uppercase; color: var(--ent-text-2);
}
.bk-day:first-child h4 { border-top: 0; }
.bk-day h4 span { color: var(--ent-text-3); font-weight: var(--ent-fw-medium); }
.bk-day.overdue h4 { color: var(--ent-danger); background: var(--ent-danger-soft); }

.bk-form { display: flex; flex-direction: column; gap: var(--ent-s4); }
.bk-err { margin: calc(-1 * var(--ent-s2)) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-danger); }
.bk-outcome { border: 0; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }

@media (max-width: 1023px) { .bk-cols { grid-template-columns: minmax(0, 1fr); } }
@media (max-width: 767px) { .bk-item.timed { grid-template-columns: 3.5rem minmax(0, 1fr); } }
@media (prefers-reduced-motion: reduce) { .bk-item { transition: none; } }
</style>
