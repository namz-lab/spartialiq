<script setup lang="ts">
// Committee — the sitting, not just the report.
//
// A committee resolution is only worth the paper it is minuted on if the
// meeting was quorate, and until now the product recorded outcomes with no
// record of who sat: migration 104 added the roster, attendance and the quorum
// figure, and nothing in the frontend ever called those routes. This section
// is the sitting itself — the diary, the agenda, who attended, whether the
// meeting was quorate, and the resolution against each item.
//
// Two tabs, because they are two different jobs at two different times:
//   sittings   the diary, agendas, attendance and resolutions
//   report     the officer's report to members on the OPEN CASE, which is
//              written days before the meeting
//
// The report tab is the existing Step3CommitteeReport, which reads the same
// planner case file the console keeps open.

import { computed, ref, watch } from 'vue'
import {
  dmApi,
  type CommitteeMeeting, type AgendaItem, type CommitteeMember,
  type MeetingAttendance, type AttendanceStatus,
} from '@/services/developmentManagementService'
import { useEoNav } from '@/eo-planner/useEoNav'
import { useEoCase } from '@/eo-planner/useEoCase'
import { useEoWorkload } from '@/eo-planner/useEoWorkload'
import { useStaleRefresh } from '@/composables/useStaleRefresh'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { statusLabel } from '@/composables/useApplicationPipeline'
import { fmtDate, humanise, isoDay } from '@/utils/dates'
import UiFeedback from '@/components/UiFeedback.vue'
import UiSheet from '@/components/ui/UiSheet.vue'
import Step3CommitteeReport from '@/views/planner/Step3CommitteeReport.vue'
import CaseRequired from './CaseRequired.vue'
import {
  Users, CalendarPlus, RefreshCw, Plus, Trash2, Gavel, UserPlus, AlertTriangle,
  CheckCircle2, Loader2, FileText, CalendarDays,
} from 'lucide-vue-next'
import '@/views/inspector/inspector.css'

const fb = useUiFeedback()
const nav = useEoNav()
const eoCase = useEoCase()
const workload = useEoWorkload()

type Tab = 'sittings' | 'report'
const tab = computed<Tab>(() => (nav.param('tab') === 'report' ? 'report' : 'sittings'))
function setTab(t: Tab) { nav.setParam('tab', t === 'sittings' ? null : t) }

// ── The diary ─────────────────────────────────────────────────────────
const meetings = ref<CommitteeMeeting[]>([])
const members = ref<CommitteeMember[]>([])
const loading = ref(false)
const loadError = ref<string | null>(null)

const selectedId = ref<string | null>(null)
const agenda = ref<AgendaItem[]>([])
const attendance = ref<MeetingAttendance[]>([])
const detailLoading = ref(false)
const busy = ref<string | null>(null)

async function refresh() {
  loading.value = true
  loadError.value = null
  try {
    const [m, r] = await Promise.all([
      dmApi.listMeetings(),
      dmApi.listCommitteeMembers().catch(() => [] as CommitteeMember[]),
    ])
    meetings.value = m
    members.value = r
    // Keep the open sitting open across a refresh; otherwise start on the next
    // one, which is what the officer is preparing for.
    if (!selectedId.value && m.length) void selectMeeting(m[0])
    else if (selectedId.value) void loadDetail(selectedId.value)
  } catch (err: unknown) {
    loadError.value = fb.parseApiError(err, 'Could not load the committee diary.')
  } finally {
    loading.value = false
  }
}
const { refreshNow } = useStaleRefresh(refresh)

async function loadDetail(id: string) {
  detailLoading.value = true
  try {
    const [items, att] = await Promise.all([
      dmApi.listAgenda(id),
      dmApi.listAttendance(id).catch(() => [] as MeetingAttendance[]),
    ])
    agenda.value = items
    attendance.value = att
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not load the agenda.'), 'error')
  } finally {
    detailLoading.value = false
  }
}

async function selectMeeting(m: CommitteeMeeting) {
  selectedId.value = m.id
  agenda.value = []
  attendance.value = []
  await loadDetail(m.id)
}

const selected = computed(() => meetings.value.find(m => m.id === selectedId.value) ?? null)

// ── Quorum ────────────────────────────────────────────────────────────
const presentCount = computed(() => attendance.value.filter(a => a.status === 'present').length)
const quorum = computed(() => selected.value?.quorum ?? null)
const quorate = computed(() => quorum.value == null ? null : presentCount.value >= quorum.value)

// ── Creating a sitting ────────────────────────────────────────────────
const newOpen = ref(false)
const creating = ref(false)
const draft = ref({
  title: 'Works & Planning Committee',
  meeting_date: isoDay(),
  location: '',
  quorum: 3,
  notes: '',
})

async function createMeeting() {
  if (!draft.value.title.trim() || !draft.value.meeting_date) {
    fb.showToast('A sitting needs a title and a date.', 'warning')
    return
  }
  creating.value = true
  try {
    const m = await dmApi.createMeeting({
      title: draft.value.title.trim(),
      meeting_date: draft.value.meeting_date,
      location: draft.value.location.trim() || undefined,
      notes: draft.value.notes.trim() || undefined,
      quorum: draft.value.quorum > 0 ? draft.value.quorum : undefined,
    })
    meetings.value = [m, ...meetings.value]
    newOpen.value = false
    await selectMeeting(m)
    fb.showToast('Sitting scheduled.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not schedule the sitting.'), 'error')
  } finally {
    creating.value = false
  }
}

async function removeMeeting(m: CommitteeMeeting) {
  if (!window.confirm(`Cancel “${m.title}” on ${fmtDate(m.meeting_date)}? The agenda goes with it.`)) return
  busy.value = m.id
  try {
    await dmApi.deleteMeeting(m.id)
    meetings.value = meetings.value.filter(x => x.id !== m.id)
    if (selectedId.value === m.id) {
      selectedId.value = null
      agenda.value = []
      attendance.value = []
    }
    fb.showToast('Sitting removed from the diary.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not remove the sitting.'), 'error')
  } finally {
    busy.value = null
  }
}

// ── The agenda ────────────────────────────────────────────────────────
const addOpen = ref(false)
const addPurpose = ref<AgendaItem['purpose']>('determination')
const addCaseId = ref('')

// Cases the committee would sit on: everything with a recommendation on file,
// plus whatever the console has open.
const candidates = computed(() => {
  const onAgenda = new Set(agenda.value.map(a => a.permit_app_id))
  return workload.cases.value.filter(c => !onAgenda.has(c.id))
})

function openAdd() {
  addCaseId.value = eoCase.caseId.value ?? ''
  addPurpose.value = 'determination'
  addOpen.value = true
}

async function addToAgenda() {
  if (!selectedId.value || !addCaseId.value) {
    fb.showToast('Choose the application to table.', 'warning')
    return
  }
  busy.value = 'add'
  try {
    await dmApi.scheduleOnAgenda(selectedId.value, {
      permit_app_id: addCaseId.value,
      purpose: addPurpose.value,
    })
    await loadDetail(selectedId.value)
    addOpen.value = false
    fb.showToast('Tabled for the sitting.', 'success')
  } catch (err: unknown) {
    const msg = fb.parseApiError(err, 'Could not table the application.')
    fb.showToast(msg === 'already_scheduled' ? 'That application is already on this agenda.' : msg, 'error')
  } finally {
    busy.value = null
  }
}

const OUTCOMES: { value: AgendaItem['outcome']; label: string }[] = [
  { value: 'approved', label: 'Approved' },
  { value: 'approved_with_conditions', label: 'Approved with conditions' },
  { value: 'refused', label: 'Refused' },
  { value: 'deferred', label: 'Deferred' },
  { value: 'noted', label: 'Noted' },
]

const resolutionDraft = ref<Record<string, string>>({})

async function recordOutcome(item: AgendaItem, outcome: AgendaItem['outcome']) {
  const resolution = (resolutionDraft.value[item.id] ?? item.resolution ?? '').trim()
  if (!resolution) {
    fb.showToast('Minute the resolution before recording the outcome.', 'warning')
    return
  }
  busy.value = item.id
  try {
    const updated = await dmApi.recordAgendaOutcome(item.id, { outcome, resolution })
    const i = agenda.value.findIndex(a => a.id === item.id)
    if (i >= 0) agenda.value[i] = { ...agenda.value[i], ...updated }
    fb.showToast('Resolution recorded.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not record the resolution.'), 'error')
  } finally {
    busy.value = null
  }
}

async function removeItem(item: AgendaItem) {
  busy.value = item.id
  try {
    await dmApi.removeAgendaItem(item.id)
    agenda.value = agenda.value.filter(a => a.id !== item.id)
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not remove the item.'), 'error')
  } finally {
    busy.value = null
  }
}

// ── The roster ────────────────────────────────────────────────────────
const rosterOpen = ref(false)
const newMember = ref({ full_name: '', title: 'Councillor' })

async function addMember() {
  if (!newMember.value.full_name.trim()) return
  busy.value = 'member'
  try {
    const m = await dmApi.addCommitteeMember({
      full_name: newMember.value.full_name.trim(),
      title: newMember.value.title.trim() || null,
    })
    members.value = [...members.value, m].sort((a, b) => a.full_name.localeCompare(b.full_name))
    newMember.value = { full_name: '', title: 'Councillor' }
    fb.showToast('Added to the roster.', 'success')
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not add the member.'), 'error')
  } finally {
    busy.value = null
  }
}

async function retireMember(m: CommitteeMember) {
  if (!window.confirm(`Retire ${m.full_name} from the roster? Past attendance is kept.`)) return
  busy.value = m.id
  try {
    await dmApi.retireCommitteeMember(m.id)
    members.value = members.value.filter(x => x.id !== m.id)
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not retire the member.'), 'error')
  } finally {
    busy.value = null
  }
}

function attendanceOf(memberId: string): AttendanceStatus | null {
  return attendance.value.find(a => a.member_id === memberId)?.status ?? null
}

async function mark(member: CommitteeMember, status: AttendanceStatus) {
  if (!selectedId.value) return
  busy.value = member.id
  try {
    const row = await dmApi.recordAttendance(selectedId.value, { member_id: member.id, status })
    const i = attendance.value.findIndex(a => a.member_id === member.id)
    const merged = { ...row, full_name: member.full_name, title: member.title }
    if (i >= 0) attendance.value[i] = merged
    else attendance.value.push(merged)
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not record attendance.'), 'error')
  } finally {
    busy.value = null
  }
}

watch(() => eoCase.caseId.value, (id) => { if (id && addOpen.value) addCaseId.value = id })

function itemRef(a: AgendaItem): string {
  return a.dev_register_no || a.permit_app_id.slice(0, 8).toUpperCase()
}
</script>

<template>
  <div class="ins-page cm">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Works &amp; Planning Committee</span>
        <h2 class="ins-title"><Users :size="18" aria-hidden="true" /> Committee</h2>
        <p class="ins-lede">
          The diary, the agenda, who sat, and the resolution against each item. A resolution
          carried at a sitting that was not quorate is open to challenge, so attendance is
          recorded here rather than remembered.
        </p>
      </div>
      <div class="ins-actions">
        <button type="button" class="cm-btn" @click="rosterOpen = true">
          <UserPlus :size="14" aria-hidden="true" /> Roster
        </button>
        <button type="button" class="cm-btn primary" @click="newOpen = true">
          <CalendarPlus :size="14" aria-hidden="true" /> Schedule a sitting
        </button>
        <button type="button" class="ins-iconbtn" :disabled="loading" title="Reload"
                @click="refreshNow">
          <RefreshCw :size="15" aria-hidden="true" :class="{ 'ins-spin': loading }" />
          <span class="ent-sr-only">Reload the diary</span>
        </button>
      </div>
    </header>

    <div class="ins-seg cm-tabs" role="tablist" aria-label="Committee views">
      <button type="button" role="tab" :aria-selected="tab === 'sittings'" @click="setTab('sittings')">
        <CalendarDays :size="14" aria-hidden="true" /> Sittings
      </button>
      <button type="button" role="tab" :aria-selected="tab === 'report'" @click="setTab('report')">
        <FileText :size="14" aria-hidden="true" /> Report on the open case
      </button>
    </div>

    <!-- ── Sittings ─────────────────────────────────────────────── -->
    <template v-if="tab === 'sittings'">
      <div v-if="loadError" class="ins-banner t-negative" role="alert">
        <AlertTriangle :size="16" aria-hidden="true" />
        <div><strong>The diary could not be read.</strong><p>{{ loadError }}</p></div>
        <button type="button" class="cm-btn" @click="refreshNow">Try again</button>
      </div>

      <div class="ins-split">
        <section class="ins-card">
          <header class="ins-card-head">
            <h3>Diary</h3>
            <span class="ins-count">{{ meetings.length }}</span>
          </header>
          <p v-if="loading && !meetings.length" class="cm-msg">Reading the diary…</p>
          <p v-else-if="!meetings.length" class="cm-msg">
            No sitting is in the diary. Schedule one before tabling an application.
          </p>
          <ul v-else class="ins-rows">
            <li v-for="m in meetings" :key="m.id">
              <div class="ins-row cm-meeting" :class="{ on: m.id === selectedId }">
                <button type="button" class="cm-meeting-main" @click="selectMeeting(m)">
                  <span class="ins-row-title">{{ m.title }}</span>
                  <span class="ins-row-meta">
                    {{ fmtDate(m.meeting_date) }}
                    <template v-if="m.location"> · {{ m.location }}</template>
                    · {{ m.item_count ?? 0 }} item(s)
                    <template v-if="m.quorum"> · quorum {{ m.quorum }}</template>
                  </span>
                </button>
                <span class="cm-pill" :class="`s-${m.status}`">{{ humanise(m.status) }}</span>
                <button type="button" class="ins-iconbtn" :disabled="busy === m.id"
                        :title="`Remove ${m.title}`" @click="removeMeeting(m)">
                  <Trash2 :size="14" aria-hidden="true" />
                  <span class="ent-sr-only">Remove this sitting</span>
                </button>
              </div>
            </li>
          </ul>
        </section>

        <section v-if="selected" class="ins-card">
          <header class="ins-card-head">
            <h3>{{ selected.title }} · {{ fmtDate(selected.meeting_date) }}</h3>
            <button type="button" class="cm-btn" @click="openAdd">
              <Plus :size="14" aria-hidden="true" /> Table an application
            </button>
          </header>

          <div class="ins-card-body cm-body">
            <!-- Quorum -->
            <p class="ins-banner" :class="quorate === null ? 't-info' : quorate ? 't-positive' : 't-warning'">
              <component :is="quorate === false ? AlertTriangle : CheckCircle2" :size="16" aria-hidden="true" />
              <span>
                <template v-if="quorum === null">
                  <strong>No quorum set for this sitting.</strong>
                  {{ presentCount }} member(s) recorded present. Set a quorum when scheduling and
                  the console will check it for you.
                </template>
                <template v-else-if="quorate">
                  <strong>Quorate — {{ presentCount }} of {{ quorum }} required.</strong>
                  Resolutions carried at this sitting stand.
                </template>
                <template v-else>
                  <strong>Not quorate — {{ presentCount }} present, {{ quorum }} required.</strong>
                  A resolution recorded now is open to challenge. Record the attendance first if
                  members have not been marked.
                </template>
              </span>
            </p>

            <!-- Attendance -->
            <section class="cm-block">
              <h4>Attendance</h4>
              <p v-if="!members.length" class="cm-msg-sm">
                The roster is empty. Add the standing members once, in Roster, and they appear at
                every sitting.
              </p>
              <ul v-else class="cm-att">
                <li v-for="mem in members" :key="mem.id">
                  <span class="cm-att-name">
                    {{ mem.full_name }}<small v-if="mem.title"> · {{ mem.title }}</small>
                  </span>
                  <span class="ins-seg cm-att-seg" role="group" :aria-label="`Attendance for ${mem.full_name}`">
                    <button type="button" class="t-positive" :aria-checked="attendanceOf(mem.id) === 'present'"
                            role="radio" :disabled="busy === mem.id" @click="mark(mem, 'present')">Present</button>
                    <button type="button" :aria-checked="attendanceOf(mem.id) === 'apology'"
                            role="radio" :disabled="busy === mem.id" @click="mark(mem, 'apology')">Apology</button>
                    <button type="button" class="t-negative" :aria-checked="attendanceOf(mem.id) === 'absent'"
                            role="radio" :disabled="busy === mem.id" @click="mark(mem, 'absent')">Absent</button>
                  </span>
                </li>
              </ul>
            </section>

            <!-- Agenda -->
            <section class="cm-block">
              <h4>Agenda <span>{{ agenda.length }} item(s)</span></h4>
              <p v-if="detailLoading" class="cm-msg-sm">Loading the agenda…</p>
              <p v-else-if="!agenda.length" class="cm-msg-sm">
                Nothing tabled yet. An application with an officer's recommendation on file is
                what a committee sits on.
              </p>
              <ol v-else class="cm-agenda">
                <li v-for="(item, i) in agenda" :key="item.id">
                  <header>
                    <span class="cm-item-no">{{ i + 1 }}</span>
                    <button type="button" class="cm-item-ref" @click="eoCase.open(item.permit_app_id)">
                      <span class="ins-mono">{{ itemRef(item) }}</span>
                      <small>
                        {{ item.applicant_name }}
                        <template v-if="item.stand_number"> · Stand {{ item.stand_number }}</template>
                        · {{ humanise(item.purpose) }}
                      </small>
                    </button>
                    <span class="cm-pill" :class="item.outcome === 'pending' ? 's-scheduled' : 's-held'">
                      {{ humanise(item.outcome) }}
                    </span>
                    <button type="button" class="ins-iconbtn" :disabled="busy === item.id"
                            title="Remove from the agenda" @click="removeItem(item)">
                      <Trash2 :size="13" aria-hidden="true" />
                      <span class="ent-sr-only">Remove item {{ i + 1 }}</span>
                    </button>
                  </header>

                  <p v-if="item.resolution" class="cm-resolution">
                    <strong>Resolved:</strong> {{ item.resolution }}
                    <small v-if="item.heard_at"> · heard {{ fmtDate(item.heard_at) }}</small>
                  </p>

                  <div class="cm-record">
                    <label class="ins-field full">
                      <span class="ent-sr-only">Resolution for item {{ i + 1 }}</span>
                      <textarea class="ins-input" rows="2"
                                :value="resolutionDraft[item.id] ?? item.resolution ?? ''"
                                placeholder="Minute the resolution as carried…"
                                @input="resolutionDraft[item.id] = ($event.target as HTMLTextAreaElement).value"></textarea>
                    </label>
                    <div class="cm-outcomes">
                      <button v-for="o in OUTCOMES" :key="o.value" type="button" class="cm-btn"
                              :disabled="busy === item.id" @click="recordOutcome(item, o.value)">
                        <component :is="busy === item.id ? Loader2 : Gavel" :size="13" aria-hidden="true"
                                   :class="{ 'ins-spin': busy === item.id }" />
                        {{ o.label }}
                      </button>
                    </div>
                  </div>
                </li>
              </ol>
            </section>
          </div>
        </section>

        <section v-else class="ins-card">
          <div class="cm-empty">
            <CalendarDays :size="22" aria-hidden="true" />
            <p>Choose a sitting to work its agenda and attendance.</p>
          </div>
        </section>
      </div>
    </template>

    <!-- ── Report on the open case ──────────────────────────────── -->
    <template v-else>
      <CaseRequired v-if="!eoCase.caseId.value" what="The officer's report to members" />
      <Step3CommitteeReport v-else />
    </template>

    <!-- Schedule a sitting -->
    <UiSheet :open="newOpen" title="Schedule a sitting" subtitle="Works &amp; Planning Committee"
             width="32rem" @close="newOpen = false" @update:open="newOpen = $event">
      <form class="ins-form" @submit.prevent="createMeeting">
        <label class="ins-field full">
          <span class="ins-label">Title</span>
          <input v-model="draft.title" class="ins-input" />
        </label>
        <label class="ins-field">
          <span class="ins-label">Date</span>
          <input v-model="draft.meeting_date" type="date" class="ins-input" />
        </label>
        <label class="ins-field">
          <span class="ins-label">Quorum</span>
          <input v-model.number="draft.quorum" type="number" min="0" max="30" class="ins-input" />
          <p class="ins-hint">Members who must be present for a resolution to stand. 0 to leave it unset.</p>
        </label>
        <label class="ins-field full">
          <span class="ins-label">Venue</span>
          <input v-model="draft.location" class="ins-input" placeholder="Council chamber" />
        </label>
        <label class="ins-field full">
          <span class="ins-label">Notes</span>
          <textarea v-model="draft.notes" rows="3" class="ins-input"></textarea>
        </label>
        <div class="cm-actions full">
          <button type="button" class="cm-btn" @click="newOpen = false">Cancel</button>
          <button type="submit" class="cm-btn primary" :disabled="creating">
            <component :is="creating ? Loader2 : CalendarPlus" :size="14" aria-hidden="true"
                       :class="{ 'ins-spin': creating }" />
            {{ creating ? 'Scheduling…' : 'Schedule' }}
          </button>
        </div>
      </form>
    </UiSheet>

    <!-- Table an application -->
    <UiSheet :open="addOpen" title="Table an application" subtitle="Onto this agenda"
             width="34rem" @close="addOpen = false" @update:open="addOpen = $event">
      <form class="ins-form" @submit.prevent="addToAgenda">
        <label class="ins-field full">
          <span class="ins-label">Application</span>
          <select v-model="addCaseId" class="ins-input" size="8">
            <option value="">— choose —</option>
            <option v-for="c in candidates" :key="c.id" :value="c.id">
              {{ c.dev_register_no || c.tpd_reference || c.id.slice(0, 8).toUpperCase() }} ·
              Stand {{ c.stand_number }} · {{ c.applicant_name }} · {{ statusLabel(c.status) }}
            </option>
          </select>
          <p class="ins-hint">
            Applications still in progress. One already on this agenda is not offered twice.
          </p>
        </label>
        <label class="ins-field full">
          <span class="ins-label">Purpose</span>
          <select v-model="addPurpose" class="ins-input">
            <option value="determination">Determination</option>
            <option value="consideration">Consideration</option>
            <option value="deputation">Deputation</option>
            <option value="noting">Noting</option>
          </select>
        </label>
        <div class="cm-actions full">
          <button type="button" class="cm-btn" @click="addOpen = false">Cancel</button>
          <button type="submit" class="cm-btn primary" :disabled="busy === 'add'">
            <component :is="busy === 'add' ? Loader2 : Plus" :size="14" aria-hidden="true"
                       :class="{ 'ins-spin': busy === 'add' }" />
            Table it
          </button>
        </div>
      </form>
    </UiSheet>

    <!-- Roster -->
    <UiSheet :open="rosterOpen" title="Committee roster" subtitle="Standing members"
             width="32rem" @close="rosterOpen = false" @update:open="rosterOpen = $event">
      <div class="cm-roster">
        <ul v-if="members.length" class="cm-members">
          <li v-for="m in members" :key="m.id">
            <span>{{ m.full_name }}<small v-if="m.title"> · {{ m.title }}</small></span>
            <button type="button" class="ins-iconbtn" :disabled="busy === m.id"
                    :title="`Retire ${m.full_name}`" @click="retireMember(m)">
              <Trash2 :size="14" aria-hidden="true" />
              <span class="ent-sr-only">Retire {{ m.full_name }}</span>
            </button>
          </li>
        </ul>
        <p v-else class="cm-msg-sm">
          No members on the roster. Councillors do not need an account on this system to sit.
        </p>

        <form class="ins-form" @submit.prevent="addMember">
          <label class="ins-field">
            <span class="ins-label">Name</span>
            <input v-model="newMember.full_name" class="ins-input" placeholder="T. Ncube" />
          </label>
          <label class="ins-field">
            <span class="ins-label">Title</span>
            <input v-model="newMember.title" class="ins-input" />
          </label>
          <div class="cm-actions full">
            <button type="submit" class="cm-btn primary" :disabled="busy === 'member'">
              <UserPlus :size="14" aria-hidden="true" /> Add to roster
            </button>
          </div>
        </form>
      </div>
    </UiSheet>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.cm-tabs { align-self:flex-start; }
.cm-body { display:flex; flex-direction:column; gap:var(--ent-s5); }
.cm-block h4 { display:flex; align-items:baseline; gap:var(--ent-s2); margin:0 0 var(--ent-s3);
  font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-semibold); color:var(--ent-text); }
.cm-block h4 span { font-weight:var(--ent-fw-normal); color:var(--ent-text-3); font-size:var(--ent-fs-xs); }

.cm-meeting { gap:var(--ent-s2); }
.cm-meeting.on { background:var(--ent-accent-soft); }
.cm-meeting-main { flex:1; min-width:0; text-align:left; background:none; border:0;
  cursor:pointer; font-family:var(--ent-font); padding:0; }
.cm-meeting-main:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }

.cm-pill { flex-shrink:0; padding:1px 8px; border-radius:var(--ent-r-pill);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg); }
.cm-pill.s-scheduled { background:var(--ent-tone-info-bg); color:var(--ent-tone-info-fg); }
.cm-pill.s-held { background:var(--ent-tone-positive-bg); color:var(--ent-tone-positive-fg); }
.cm-pill.s-cancelled { background:var(--ent-tone-neutral-bg); color:var(--ent-tone-neutral-fg); }

.cm-att { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s2); }
.cm-att li { display:flex; align-items:center; gap:var(--ent-s3); flex-wrap:wrap; }
.cm-att-name { flex:1; min-width:10rem; font-size:var(--ent-fs-sm); color:var(--ent-text); }
.cm-att-name small { color:var(--ent-text-3); }
.cm-att-seg { flex-shrink:0; }

.cm-agenda { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s4); }
.cm-agenda > li { border:1px solid var(--ent-line); border-radius:var(--ent-r-md);
  padding:var(--ent-s3); background:var(--ent-surface); }
.cm-agenda > li > header { display:flex; align-items:center; gap:var(--ent-s3); }
.cm-item-no { display:inline-flex; align-items:center; justify-content:center; flex-shrink:0;
  width:1.5rem; height:1.5rem; border-radius:var(--ent-r-pill);
  background:var(--ent-surface-2); color:var(--ent-text-2);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); }
.cm-item-ref { flex:1; min-width:0; text-align:left; background:none; border:0; padding:0;
  cursor:pointer; font-family:var(--ent-font); color:var(--ent-text); }
.cm-item-ref:hover { color:var(--ent-accent); }
.cm-item-ref:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.cm-item-ref small { display:block; font-size:var(--ent-fs-xs); color:var(--ent-text-3); }

.cm-resolution { margin:var(--ent-s3) 0 0; padding:var(--ent-s2) var(--ent-s3);
  background:var(--ent-tone-positive-bg); border-left:3px solid var(--ent-success);
  border-radius:var(--ent-r-sm); font-size:var(--ent-fs-sm); color:var(--ent-text-2); }
.cm-resolution small { color:var(--ent-text-3); }

.cm-record { margin-top:var(--ent-s3); display:flex; flex-direction:column; gap:var(--ent-s2); }
.cm-outcomes { display:flex; gap:var(--ent-s2); flex-wrap:wrap; }

.cm-actions { display:flex; justify-content:flex-end; gap:var(--ent-s2); }
.cm-roster { display:flex; flex-direction:column; gap:var(--ent-s4); }
.cm-members { list-style:none; margin:0; padding:0; display:flex; flex-direction:column; gap:var(--ent-s1); }
.cm-members li { display:flex; align-items:center; justify-content:space-between; gap:var(--ent-s2);
  padding:var(--ent-s2); border-bottom:1px solid var(--ent-line); font-size:var(--ent-fs-sm); }
.cm-members small { color:var(--ent-text-3); }

.cm-btn { display:inline-flex; align-items:center; gap:var(--ent-s2);
  min-height:var(--ent-control-h); padding:0 var(--ent-control-px);
  font-family:var(--ent-font); font-size:var(--ent-fs-sm); font-weight:var(--ent-fw-medium);
  color:var(--ent-text); background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r); cursor:pointer; }
.cm-btn:hover:not(:disabled) { background:var(--ent-surface-2); }
.cm-btn:focus-visible { outline:none; box-shadow:var(--ent-focus-ring); }
.cm-btn:disabled { opacity:0.55; cursor:not-allowed; }
.cm-btn.primary { background:var(--ent-accent); border-color:var(--ent-accent); color:var(--ent-text-on-accent); }
.cm-btn.primary:hover:not(:disabled) { background:var(--ent-accent-hover); }

.cm-msg { margin:0; padding:var(--ent-s6) var(--ent-s4); text-align:center;
  font-size:var(--ent-fs-sm); color:var(--ent-text-3); line-height:var(--ent-lh); }
.cm-msg-sm { margin:0; font-size:var(--ent-fs-xs); color:var(--ent-text-3); line-height:var(--ent-lh); }
.cm-empty { display:flex; flex-direction:column; align-items:center; justify-content:center;
  gap:var(--ent-s3); padding:var(--ent-s8) var(--ent-s4); color:var(--ent-text-3);
  text-align:center; font-size:var(--ent-fs-sm); }

@media (max-width: 1023px) {
  .ins-split { grid-template-columns: minmax(0, 1fr); }
}
</style>
