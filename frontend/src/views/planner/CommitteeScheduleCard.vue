<script setup lang="ts">
// Committee scheduling for the active case (migration 083): table the
// application onto a town-planning committee meeting and record the hearing
// resolution. Backend-backed and shared — the agenda is the system of record.
import { ref, watch } from 'vue'
import { dmApi, type CommitteeMeeting, type PermitMeeting } from '@/services/developmentManagementService'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { CalendarDays, Gavel, RefreshCw, AlertTriangle, CalendarPlus } from 'lucide-vue-next'

const props = defineProps<{ permitId: string | null }>()

const scheduled = ref<PermitMeeting[]>([])
const upcoming  = ref<CommitteeMeeting[]>([])
const loading   = ref(false)
const error     = ref('')
const busy      = ref(false)

const mode = ref<'existing' | 'new'>('existing')
const pickMeetingId = ref('')
const newTitle = ref('')
const newDate  = ref('')
const purpose  = ref('determination')

const OUTCOMES = ['approved', 'approved_with_conditions', 'refused', 'deferred', 'noted']
const draft = ref<Record<string, { outcome: string; resolution: string }>>({})

async function load() {
  if (!props.permitId) { scheduled.value = []; upcoming.value = []; return }
  loading.value = true; error.value = ''
  try {
    const [s, u] = await Promise.all([
      dmApi.listPermitMeetings(props.permitId),
      dmApi.listMeetings('scheduled'),
    ])
    scheduled.value = s
    upcoming.value = u
    if (!pickMeetingId.value && u.length) pickMeetingId.value = u[0].id
    for (const it of s) {
      if (!draft.value[it.agenda_item_id]) {
        draft.value[it.agenda_item_id] = {
          outcome: it.outcome === 'pending' ? 'approved' : it.outcome,
          resolution: it.resolution || '',
        }
      }
    }
  } catch {
    error.value = 'Could not load committee scheduling.'
  } finally {
    loading.value = false
  }
}
watch(() => props.permitId, load, { immediate: true })

async function schedule() {
  if (!props.permitId) return
  busy.value = true; error.value = ''
  try {
    let meetingId = pickMeetingId.value
    if (mode.value === 'new') {
      if (!newTitle.value.trim() || !newDate.value) { error.value = 'Meeting title and date are required.'; return }
      const m = await dmApi.createMeeting({ title: newTitle.value.trim(), meeting_date: newDate.value })
      meetingId = m.id
      newTitle.value = ''; newDate.value = ''
    }
    if (!meetingId) { error.value = 'Pick or create a meeting first.'; return }
    await dmApi.scheduleOnAgenda(meetingId, { permit_app_id: props.permitId, purpose: purpose.value })
    await load()
  } catch (e: any) {
    error.value = e?.response?.data?.error === 'already_scheduled'
      ? 'This application is already on that meeting agenda.'
      : 'Could not schedule the application.'
  } finally {
    busy.value = false
  }
}

async function record(item: PermitMeeting) {
  const d = draft.value[item.agenda_item_id]
  if (!d) return
  busy.value = true; error.value = ''
  try {
    await dmApi.recordAgendaOutcome(item.agenda_item_id, { outcome: d.outcome, resolution: d.resolution })
    await load()
  } catch {
    error.value = 'Could not record the resolution.'
  } finally {
    busy.value = false
  }
}

function fmt(d: string | null) {
  if (!d) return '—'
  const x = new Date(d)
  return isNaN(x.getTime()) ? '—' : x.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
function label(s: string) { return s.replace(/_/g, ' ') }

// Outcome → the canonical badge tone + label. UiStatusBadge already maps the
// permit-lifecycle keys; 'pending' and 'noted' are agenda-only, so they are
// given an explicit tone here. Colour never carries the meaning alone — the
// label text is always rendered.
const OUTCOME_BADGE: Record<string, { tone: 'neutral' | 'info' | 'positive' | 'warning' | 'negative'; label: string }> = {
  pending:                  { tone: 'info',     label: 'Pending' },
  approved:                 { tone: 'positive', label: 'Approved' },
  approved_with_conditions: { tone: 'positive', label: 'Approved with conditions' },
  refused:                  { tone: 'negative', label: 'Refused' },
  deferred:                 { tone: 'warning',  label: 'Deferred' },
  noted:                    { tone: 'neutral',  label: 'Noted' },
}
function badgeFor(outcome: string) {
  return OUTCOME_BADGE[outcome] ?? { tone: 'neutral' as const, label: label(outcome) }
}

// The workflow position of this agenda item, in the officer's own words.
function workflowStatus(it: PermitMeeting): string {
  if (it.outcome === 'pending') return it.meeting_status === 'held' ? 'Heard — awaiting resolution' : 'Scheduled'
  if (it.outcome === 'deferred') return 'Deferred'
  if (it.outcome === 'refused')  return 'Refused'
  return 'Resolution recorded'
}
</script>

<template>
  <UiPanel class="cs" title="Committee review" subtitle="Statutory committee agenda and resolution">
    <template #icon><Gavel :size="15" /></template>
    <template #actions>
      <UiButton
        v-if="permitId" variant="ghost" size="sm"
        :disabled="loading" aria-label="Refresh committee scheduling" title="Refresh"
        @click="load"
      >
        <template #icon><RefreshCw :size="13" :class="{ spin: loading }" /></template>
      </UiButton>
    </template>

    <p v-if="!permitId" class="cs-muted">
      Register the application first — then table it to a committee.
    </p>

    <template v-else>
      <div v-if="error" class="cs-error" role="alert">
        <AlertTriangle :size="14" aria-hidden="true" /> <span>{{ error }}</span>
      </div>

      <!-- ── Tabled meetings ─────────────────────────────────────────────── -->
      <section v-if="scheduled.length" class="cs-block">
        <h5 class="cs-eyebrow">Committee status</h5>

        <article v-for="it in scheduled" :key="it.agenda_item_id" class="cs-item">
          <div class="cs-item-head">
            <div class="cs-item-id">
              <span class="cs-meeting">{{ it.title }}</span>
              <span class="cs-facts">
                <span class="cs-mono">{{ fmt(it.meeting_date) }}</span>
                <span class="cs-dot" aria-hidden="true">·</span>
                <span class="cs-purpose">{{ label(it.purpose) }}</span>
                <span class="cs-dot" aria-hidden="true">·</span>
                <span>{{ workflowStatus(it) }}</span>
              </span>
            </div>
            <UiStatusBadge :tone="badgeFor(it.outcome).tone" :label="badgeFor(it.outcome).label" />
          </div>

          <p v-if="it.resolution" class="cs-res">{{ it.resolution }}</p>

          <!-- Record resolution — only while the outcome is pending -->
          <div v-if="it.outcome === 'pending' && draft[it.agenda_item_id]" class="cs-record">
            <h6 class="cs-eyebrow sub">Record committee resolution</h6>
            <div class="cs-fields">
              <div class="cs-field">
                <label :for="`out-${it.agenda_item_id}`">Outcome</label>
                <select :id="`out-${it.agenda_item_id}`" v-model="draft[it.agenda_item_id].outcome" class="cs-input">
                  <option v-for="o in OUTCOMES" :key="o" :value="o">{{ badgeFor(o).label }}</option>
                </select>
              </div>
              <div class="cs-field grow">
                <label :for="`res-${it.agenda_item_id}`">Resolution / minute note</label>
                <input
                  :id="`res-${it.agenda_item_id}`"
                  v-model="draft[it.agenda_item_id].resolution"
                  class="cs-input"
                  placeholder="Minute reference and the committee's wording"
                />
              </div>
              <UiButton variant="primary" size="sm" :loading="busy" @click="record(it)">
                <template #icon><Gavel :size="13" /></template>
                Record resolution
              </UiButton>
            </div>
          </div>
        </article>
      </section>

      <p v-else-if="!loading" class="cs-muted">Not yet tabled to a committee.</p>

      <!-- ── Table application ───────────────────────────────────────────── -->
      <section class="cs-block cs-form">
        <h5 class="cs-eyebrow">Table application</h5>

        <div class="cs-fields">
          <div class="cs-field">
            <span class="cs-lbl" id="cs-mode-lbl">Meeting</span>
            <div class="cs-seg" role="radiogroup" aria-labelledby="cs-mode-lbl">
              <label :class="{ on: mode === 'existing' }">
                <input type="radio" name="cs-mode" value="existing" v-model="mode" />
                <CalendarDays :size="12" aria-hidden="true" /> Existing
              </label>
              <label :class="{ on: mode === 'new' }">
                <input type="radio" name="cs-mode" value="new" v-model="mode" />
                <CalendarPlus :size="12" aria-hidden="true" /> New
              </label>
            </div>
          </div>

          <template v-if="mode === 'existing'">
            <div class="cs-field grow">
              <label for="cs-pick">Scheduled meeting</label>
              <select v-if="upcoming.length" id="cs-pick" v-model="pickMeetingId" class="cs-input">
                <option v-for="m in upcoming" :key="m.id" :value="m.id">{{ m.title }} — {{ fmt(m.meeting_date) }}</option>
              </select>
              <p v-else class="cs-hint">No scheduled meetings yet — switch to “New”.</p>
            </div>
          </template>

          <template v-else>
            <div class="cs-field grow">
              <label for="cs-new-title">Meeting title</label>
              <input id="cs-new-title" v-model="newTitle" class="cs-input" placeholder="e.g. TPC — June 2026" />
            </div>
            <div class="cs-field">
              <label for="cs-new-date">Meeting date</label>
              <input id="cs-new-date" v-model="newDate" type="date" class="cs-input" />
            </div>
          </template>

          <div class="cs-field">
            <label for="cs-purpose">Purpose</label>
            <select id="cs-purpose" v-model="purpose" class="cs-input">
              <option value="determination">Determination</option>
              <option value="consideration">Consideration</option>
              <option value="deputation">Deputation</option>
              <option value="noting">Noting</option>
            </select>
          </div>

          <UiButton variant="primary" :loading="busy" @click="schedule">
            <template #icon><Gavel :size="13" /></template>
            Table application
          </UiButton>
        </div>
      </section>
    </template>
  </UiPanel>
</template>

<style scoped>
.spin { animation: cs-spin 1s linear infinite; }
@keyframes cs-spin { to { transform: rotate(360deg); } }

.cs-muted { margin: 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.cs-mono { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; }

.cs-error {
  display: flex; align-items: center; gap: var(--ent-s2);
  margin-bottom: var(--ent-s3); padding: var(--ent-s2) var(--ent-s3);
  border-radius: var(--ent-r-sm);
  background: var(--ent-tone-negative-bg); border: 1px solid var(--ent-tone-negative-line);
  font-size: var(--ent-fs-sm); color: var(--ent-danger);
}

.cs-block + .cs-block { margin-top: var(--ent-s4); padding-top: var(--ent-s4); border-top: 1px solid var(--ent-line); }
.cs-form { margin-top: var(--ent-s4); padding-top: var(--ent-s4); border-top: 1px solid var(--ent-line); }

.cs-eyebrow {
  margin: 0 0 var(--ent-s2);
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold);
  text-transform: uppercase; letter-spacing: 0.06em; color: var(--ent-text-2);
}
.cs-eyebrow.sub { color: var(--ent-text-3); margin-bottom: var(--ent-s2); }

/* ── Agenda item: a record row, not a card inside a card ─────────────────── */
.cs-item { padding: var(--ent-s2) 0; border-bottom: 1px solid var(--ent-line); }
.cs-item:last-child { border-bottom: none; padding-bottom: 0; }
.cs-item-head { display: flex; align-items: flex-start; gap: var(--ent-s3); }
.cs-item-id { min-width: 0; }
.cs-meeting {
  display: block; font-size: var(--ent-fs-base); font-weight: var(--ent-fw-semibold);
  color: var(--ent-text); line-height: var(--ent-lh-tight);
}
.cs-facts {
  display: flex; flex-wrap: wrap; align-items: center; gap: var(--ent-s1);
  margin-top: 2px; font-size: var(--ent-fs-micro); color: var(--ent-text-3);
}
.cs-purpose { text-transform: capitalize; }
.cs-dot { color: var(--ent-line-strong); }

.cs-res {
  margin: var(--ent-s2) 0 0; padding: var(--ent-s2) var(--ent-s3);
  border-left: 2px solid var(--ent-line-strong); background: var(--ent-surface-2);
  border-radius: 0 var(--ent-r-sm) var(--ent-r-sm) 0;
  font-size: var(--ent-fs-sm); color: var(--ent-text-2); line-height: var(--ent-lh);
  overflow-wrap: anywhere;
}

.cs-record {
  margin-top: var(--ent-s3); padding: var(--ent-s3);
  background: var(--ent-surface-2); border: 1px solid var(--ent-line); border-radius: var(--ent-r-sm);
}

/* ── Fields ─────────────────────────────────────────────────────────────── */
.cs-fields { display: flex; flex-wrap: wrap; align-items: flex-end; gap: var(--ent-s2) var(--ent-s3); }
.cs-field { display: flex; flex-direction: column; gap: var(--ent-s1); min-width: 9rem; }
.cs-field.grow { flex: 1 1 14rem; min-width: 0; }
.cs-field label, .cs-lbl {
  font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-semibold); color: var(--ent-text-2);
}

.cs-input {
  height: var(--ent-control-h); width: 100%; box-sizing: border-box;
  padding: 0 var(--ent-s2);
  font-family: var(--ent-font); font-size: var(--ent-fs-sm); color: var(--ent-text);
  background: var(--ent-surface);
  border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm);
  outline: none;
}
.cs-input::placeholder { color: var(--ent-text-3); }
.cs-input:focus-visible { border-color: var(--ent-accent); box-shadow: var(--ent-focus-ring); }
input.cs-input[type="date"] { font-family: var(--ent-font-mono); }

/* Segmented existing / new meeting selector */
.cs-seg { display: inline-flex; height: var(--ent-control-h); border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r-sm); overflow: hidden; }
.cs-seg label {
  display: inline-flex; align-items: center; gap: var(--ent-s1);
  padding: 0 var(--ent-s3); cursor: pointer;
  font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-medium); color: var(--ent-text-2);
  background: var(--ent-surface);
  transition: background-color var(--ent-dur) var(--ent-ease), color var(--ent-dur) var(--ent-ease);
}
.cs-seg label + label { border-left: 1px solid var(--ent-line-strong); }
.cs-seg label:hover { background: var(--ent-surface-2); }
.cs-seg label.on { background: var(--ent-accent-soft); color: var(--ent-accent); font-weight: var(--ent-fw-semibold); }
.cs-seg input { position: absolute; opacity: 0; width: 1px; height: 1px; }
.cs-seg label:focus-within { box-shadow: inset var(--ent-focus-ring); }

.cs-hint { margin: 0; padding-top: var(--ent-s1); font-size: var(--ent-fs-micro); color: var(--ent-text-3); }

@media (max-width: 720px) {
  .cs-fields { flex-direction: column; align-items: stretch; }
  .cs-field, .cs-field.grow { min-width: 0; width: 100%; }
  .cs-item-head { flex-direction: column; gap: var(--ent-s2); }
}
@media (prefers-reduced-motion: reduce) {
  .spin { animation: none; }
  .cs-seg label { transition: none; }
}
</style>
