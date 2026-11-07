<script setup lang="ts">
// Planning committee diary — meetings first, agenda on expand.
import { computed, onMounted, ref } from 'vue'
import { dmApi, type AgendaItem, type CommitteeMeeting } from '@/services/developmentManagementService'
import { usePlannerShell } from '@/composables/usePlannerShell'
import { useUiFeedback } from '@/composables/useUiFeedback'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { ChevronDown, RefreshCw } from 'lucide-vue-next'

const shell = usePlannerShell()
const fb = useUiFeedback()
const meetings = ref<CommitteeMeeting[]>([])
const agendaByMeeting = ref<Record<string, AgendaItem[]>>({})
const openId = ref<string | null>(null)
const loading = ref(false)
const agendaLoading = ref(false)

async function refresh() {
  loading.value = true
  try {
    meetings.value = await dmApi.listMeetings()
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not load committee meetings'), 'error')
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

async function toggle(meeting: CommitteeMeeting) {
  if (openId.value === meeting.id) {
    openId.value = null
    return
  }
  openId.value = meeting.id
  if (agendaByMeeting.value[meeting.id]) return
  agendaLoading.value = true
  try {
    agendaByMeeting.value = {
      ...agendaByMeeting.value,
      [meeting.id]: await dmApi.listAgenda(meeting.id),
    }
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not load the agenda'), 'error')
  } finally {
    agendaLoading.value = false
  }
}

function openCase(item: AgendaItem) {
  if (!item.permit_app_id) return
  void shell.openCaseForStand(item.permit_app_id, 'committee')
}

// A sitting whose date has passed but is still "scheduled" has no recorded
// outcome. It used to read as upcoming; it is the one thing on this page that
// needs chasing.
const today = () => new Date().toISOString().slice(0, 10)
const upcoming = computed(() => meetings.value
  .filter(m => m.status === 'scheduled' && m.meeting_date.slice(0, 10) >= today())
  .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date)))
const past = computed(() => meetings.value
  .filter(m => !upcoming.value.includes(m))
  .sort((a, b) => b.meeting_date.localeCompare(a.meeting_date)))
const unrecorded = (m: CommitteeMeeting) => m.status === 'scheduled' && m.meeting_date.slice(0, 10) < today()

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="cm">
    <header class="cm-head">
      <div>
        <h2>Committee</h2>
        <p>Upcoming and past Town Planning Committee sittings. Open an agenda item to work the case.</p>
      </div>
      <UiButton size="sm" :loading="loading" @click="refresh">
        <template #icon><RefreshCw :size="13" /></template>
        Refresh
      </UiButton>
    </header>

    <UiPanel flush>
      <UiEmptyState v-if="!loading && !meetings.length" message="No committee meetings scheduled." />
      <template v-else>
        <template v-for="group in [{ key: 'up', title: 'Upcoming', list: upcoming }, { key: 'past', title: 'Past sittings', list: past }]" :key="group.key">
          <h3 v-if="group.list.length" class="cm-group">{{ group.title }}</h3>
          <ul v-if="group.list.length" class="cm-list">
            <li v-for="m in group.list" :key="m.id">
              <button type="button" class="cm-row" :aria-expanded="openId === m.id" @click="toggle(m)">
                <span class="cm-title">{{ m.title }}</span>
                <span class="cm-date">{{ fmtDate(m.meeting_date) }}<template v-if="m.item_count != null"> · {{ Number(m.item_count) }} item{{ Number(m.item_count) === 1 ? '' : 's' }}</template></span>
                <UiStatusBadge v-if="unrecorded(m)" tone="warning" label="Outcome not recorded" />
                <UiStatusBadge v-else :status="m.status" />
                <ChevronDown :size="16" :class="{ open: openId === m.id }" aria-hidden="true" />
              </button>
              <div v-if="openId === m.id" class="cm-agenda">
                <p v-if="unrecorded(m)" class="cm-warn">This sitting has passed and no resolutions are recorded against it. The committee clerk records the minutes; until then these cases cannot move to a decision.</p>
                <ul>
                  <li v-if="agendaLoading && !agendaByMeeting[m.id]" class="cm-empty">Loading agenda…</li>
                  <li v-else-if="!(agendaByMeeting[m.id] || []).length" class="cm-empty">No items on this agenda.</li>
                  <li v-for="item in agendaByMeeting[m.id] || []" :key="item.id">
                    <button type="button" class="cm-item" @click="openCase(item)">
                      <span class="cm-ref">{{ item.dev_register_no || 'Unregistered' }}</span>
                      <span>{{ item.applicant_name || item.purpose.replace(/_/g, ' ') }}</span>
                      <span class="cm-outcome">{{ item.outcome.replace(/_/g, ' ') }}</span>
                    </button>
                  </li>
                </ul>
              </div>
            </li>
          </ul>
        </template>
      </template>
    </UiPanel>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.cm { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s4); }
.cm-head { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.cm-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); }
.cm-head p { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.cm-head :deep(.ui-btn) { margin-left: auto; }
.cm-list { list-style: none; margin: 0; padding: 0; }
.cm-group { margin: 0; padding: var(--ent-s2) var(--ent-s4); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); letter-spacing: 0.06em; text-transform: uppercase; color: var(--ent-text-3); background: var(--ent-surface-2); border-top: 1px solid var(--ent-line); }
.cm-group:first-child { border-top: none; }
.cm-warn { margin: 0; padding: var(--ent-s2) var(--ent-s4); font-size: var(--ent-fs-sm); color: var(--ent-text); background: var(--ent-warning-soft); border-top: 1px solid var(--ent-line); }
.cm-agenda ul { list-style: none; margin: 0; padding: 0; }
.cm-ref { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); }
.cm-outcome { font-size: var(--ent-fs-xs); color: var(--ent-text-2); text-transform: capitalize; }
.cm-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto auto; gap: var(--ent-s2);
  align-items: center; width: 100%; min-height: var(--ent-touch-min);
  padding: var(--ent-s2) var(--ent-s4); text-align: left; background: transparent;
  border: 0; border-top: 1px solid var(--ent-line); color: var(--ent-text); font: inherit; cursor: pointer;
}
.cm-list > li:first-child > .cm-row { border-top: none; }
.cm-row:hover { background: var(--ent-surface-2); }
.cm-row:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.cm-title { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cm-date { font-size: var(--ent-fs-micro); color: var(--ent-text-3); white-space: nowrap; }
.cm-row svg { color: var(--ent-text-3); transition: transform var(--ent-dur) var(--ent-ease); }
.cm-row svg.open { transform: rotate(180deg); }
.cm-agenda { padding: 0 0 var(--ent-s2); background: var(--ent-surface-sunken); }
.cm-item {
  display: grid; grid-template-columns: 11rem minmax(0, 1fr) auto; gap: var(--ent-s2);
  align-items: center; width: 100%; min-height: var(--ent-touch-min);
  padding: var(--ent-s2) var(--ent-s4); text-align: left; background: transparent;
  border: 0; border-top: 1px solid var(--ent-line); color: var(--ent-text); font: inherit; cursor: pointer;
}
.cm-item:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.cm-empty { padding: var(--ent-s3) var(--ent-s4); font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
@media (prefers-reduced-motion: reduce) {
  .cm-row svg { transition: none; }
}
@media (max-width: 767px) {
  .cm { padding: var(--ent-s3); }
  .cm-head { flex-direction: column; align-items: stretch; }
  .cm-head :deep(.ui-btn) { margin-left: 0; }
  .cm-row { grid-template-columns: minmax(0, 1fr) auto; }
  .cm-date { display: none; }
  .cm-item { grid-template-columns: minmax(0, 1fr); }
}
</style>
