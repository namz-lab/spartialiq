<template>
  <div class="space-y-6">
    <!-- Who is signed in -->
    <div v-if="surveyor"
         class="bg-white border border-gray-200 rounded-lg p-4 flex items-center gap-4">
      <div class="w-12 h-12 rounded-full flex items-center justify-center text-sm font-semibold border bg-blue-50 text-blue-700 border-blue-200">
        {{ initials(surveyor.name) }}
      </div>
      <div>
        <span class="text-sm text-gray-500">Surveyor:</span>
        <span class="text-lg font-bold text-gray-900 ml-2">{{ surveyor.name }}</span>
        <div class="text-sm text-gray-500 mt-0.5">Surveying is done in SurveyPro: open a job there with <strong>Survey in SurveyPro</strong>.</div>
      </div>
    </div>

    <p class="text-sm" style="color:#5a5a5a">
      {{ survey.kpis.value.open }} open
      · {{ survey.kpis.value.inProgress }} in progress
      · {{ dueThisWeek }} due this week
      · {{ completedCount }} completed.
      Claim an unclaimed task to start a survey.
    </p>

    <div v-if="survey.error.value" class="text-sm text-red-600 bg-red-50 border border-red-100 rounded p-3">
      {{ survey.error.value }}
    </div>

    <!-- Bento grid: task table + detail -->
    <div class="grid grid-cols-1 xl:grid-cols-3 gap-6">
      <!-- Task list -->
      <div class="xl:col-span-2 bg-white border border-gray-200 rounded-lg flex flex-col">
        <div class="p-4 border-b border-gray-200 flex flex-wrap justify-between items-center gap-3">
          <h2 class="text-xl font-semibold text-gray-900">Council Tasks</h2>
          <div class="flex items-center gap-2">
            <div class="relative">
              <Search class="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input v-model="q" type="text" placeholder="Search tasks…"
                     class="pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded text-sm focus:border-indigo-500 focus:ring-1 focus:ring-indigo-400 w-40 sm:w-56" />
            </div>
            <button class="p-2 border rounded text-sm transition-colors"
                    :class="unclaimedOnly ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'border-gray-200 text-gray-500 hover:bg-gray-50'"
                    :title="unclaimedOnly ? 'Showing unclaimed only' : 'Filter: unclaimed only'"
                    @click="unclaimedOnly = !unclaimedOnly">
              <Filter class="w-5 h-5" />
            </button>
            <button class="p-2 border border-gray-200 rounded text-gray-500 hover:bg-gray-50 transition-colors"
                    title="Refresh" @click="survey.refresh()">
              <RefreshCw class="w-5 h-5" :class="{ 'animate-spin': survey.loading.value }" />
            </button>
          </div>
        </div>

        <!-- Tabs -->
        <div class="px-4 border-b border-gray-200 flex gap-6">
          <button v-for="t in tabs" :key="t.key" @click="tab = t.key"
                  class="py-3 text-sm border-b-2 -mb-px transition-colors"
                  :class="tab === t.key ? 'border-indigo-600 text-indigo-700 font-semibold' : 'border-transparent text-gray-500 hover:text-indigo-600'">
            {{ t.label }}
            <span class="ml-1 text-xs text-gray-400">{{ countFor(t.key) }}</span>
          </button>
        </div>

        <div class="overflow-x-auto">
          <table class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-gray-50 border-b border-gray-200 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                <th class="p-4">ID</th>
                <th class="p-4">Project / Location</th>
                <th class="p-4">Type</th>
                <th class="p-4">Due Date</th>
                <th class="p-4">Status</th>
              </tr>
            </thead>
            <tbody class="text-sm">
              <tr v-for="t in visibleTasks" :key="t.id"
                  class="border-b border-gray-100 cursor-pointer transition-colors"
                  :class="survey.detail.value?.id === t.id ? 'bg-indigo-50/60' : 'hover:bg-gray-50'"
                  @click="survey.select(t.id)">
                <td class="p-4 font-semibold" :class="survey.detail.value?.id === t.id ? 'text-indigo-700' : 'text-gray-500'">
                  {{ shortId(t) }}
                </td>
                <td class="p-4">
                  <div class="font-medium text-gray-900">{{ t.stand_number ? `Stand ${t.stand_number}` : taskTypeLabel(t.task_type) }}</div>
                  <div v-if="t.suburb_ward" class="text-xs text-gray-500">{{ t.suburb_ward }}</div>
                </td>
                <td class="p-4 text-gray-500">{{ taskTypeLabel(t.task_type) }}</td>
                <td class="p-4 text-gray-500">{{ t.due_date ? new Date(t.due_date).toLocaleDateString() : '—' }}</td>
                <td class="p-4">
                  <span class="px-2 py-1 rounded font-semibold text-[11px] inline-flex items-center gap-1" :class="statusClass(t.status)">
                    <component :is="statusIcon(t.status)" class="w-3.5 h-3.5" />
                    {{ statusLabel(t.status) }}
                  </span>
                </td>
              </tr>
              <tr v-if="!visibleTasks.length && !survey.loading.value">
                <td colspan="5" class="p-10 text-center">
                  <div class="flex flex-col items-center gap-2 text-gray-500">
                    <ClipboardList class="w-10 h-10 text-gray-300" />
                    <p class="text-sm">{{ q || unclaimedOnly ? 'No tasks match your filters.' : emptyLabel }}</p>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Task detail -->
      <div class="xl:col-span-1 bg-white border border-gray-200 rounded-lg flex flex-col relative overflow-hidden">
        <div class="absolute top-0 left-0 w-full h-1 bg-indigo-600"></div>

        <div v-if="!d" class="flex-1 flex flex-col items-center justify-center text-center p-8 text-gray-500 min-h-[300px]">
          <ClipboardList class="w-12 h-12 text-gray-300 mb-3" />
          <p class="text-sm">Select a task to see the instruction and submit your report.</p>
        </div>

        <template v-else>
          <div class="p-4 border-b border-gray-200 flex justify-between items-start">
            <div>
              <h3 class="font-bold text-gray-900">
                {{ d.stand_number ? `Stand ${d.stand_number}` : taskTypeLabel(d.task_type) }}
              </h3>
              <p class="text-sm text-gray-500">{{ shortId(d) }} • {{ taskTypeLabel(d.task_type) }}</p>
            </div>
            <button v-if="!d.assigned_to" class="stm-btn" :disabled="survey.busy.value" @click="survey.claim(d.id)">Claim</button>
          </div>

          <div class="p-4 space-y-4 flex-1 overflow-y-auto">
            <!-- Map thumbnail — live locator centred on the task point -->
            <div class="relative w-full h-36 bg-gray-100 border border-gray-200 rounded overflow-hidden">
              <TaskMapThumb :lng="d.lng" :lat="d.lat" class="absolute inset-0" />
              <RouterLink to="/surveyor"
                class="absolute bottom-2 right-2 bg-white/90 px-2 py-1 rounded text-[11px] font-semibold border border-gray-200 flex items-center gap-1 hover:text-indigo-700">
                <Maximize2 class="w-3.5 h-3.5" /> View Full Map
              </RouterLink>
            </div>

            <!-- Key fields -->
            <div class="space-y-2 text-sm">
              <div class="flex justify-between border-b border-gray-100 pb-2">
                <span class="text-gray-500">Location</span>
                <span class="text-gray-900 font-medium text-right">
                  {{ d.stand_number ? `Stand ${d.stand_number}` : '—' }}<br v-if="d.suburb_ward" />
                  <span v-if="d.suburb_ward" class="font-normal text-gray-500">{{ d.suburb_ward }}</span>
                </span>
              </div>
              <div class="flex justify-between border-b border-gray-100 pb-2">
                <span class="text-gray-500">Requester</span>
                <span class="text-gray-900 text-right">{{ d.applicant_name || 'Planning Dept' }}</span>
              </div>
              <div class="flex justify-between border-b border-gray-100 pb-2">
                <span class="text-gray-500">Priority</span>
                <span class="font-medium capitalize" :class="priorityClass(d.priority)">{{ d.priority }}</span>
              </div>
              <div v-if="d.due_date" class="flex justify-between border-b border-gray-100 pb-2">
                <span class="text-gray-500">Due</span>
                <span class="text-gray-900">{{ new Date(d.due_date).toLocaleDateString() }}</span>
              </div>
            </div>

            <div v-if="d.instructions || d.application_description">
              <span class="text-xs font-semibold text-gray-500 uppercase block mb-1">Description</span>
              <p class="text-sm text-gray-700">{{ d.instructions || d.application_description }}</p>
            </div>

            <!-- Field records -->
            <div class="grid grid-cols-1 gap-3 text-xs pt-2 border-t border-gray-100">
              <div>
                <h4 class="font-semibold text-gray-700 mb-1">Coordinates ({{ d.coordinates.length }})</h4>
                <ul class="space-y-0.5 text-gray-600 max-h-24 overflow-auto">
                  <li v-for="c in d.coordinates" :key="c.id">
                    {{ c.label || '—' }}: {{ c.coord_system }}
                    {{ c.easting != null ? `Y ${c.easting} X ${c.northing}` : `${c.longitude}, ${c.latitude}` }}
                  </li>
                </ul>
                <div class="mt-1 flex gap-1">
                  <input v-model="coord.label" placeholder="Label" class="stm-input w-16" />
                  <input v-model.number="coord.easting" placeholder="Y (E)" class="stm-input flex-1" />
                  <input v-model.number="coord.northing" placeholder="X (N)" class="stm-input flex-1" />
                  <button class="stm-btn subtle" :disabled="survey.busy.value || coord.easting == null" @click="pushCoord">Add</button>
                </div>
              </div>
              <div>
                <h4 class="font-semibold text-gray-700 mb-1">Beacons ({{ d.beacons.length }})</h4>
                <ul class="space-y-0.5 text-gray-600 max-h-24 overflow-auto">
                  <li v-for="b in d.beacons" :key="b.id">
                    {{ b.corner_label || '—' }} · {{ b.beacon_type.replace('_', ' ') }} · {{ b.status }}
                  </li>
                </ul>
                <div class="mt-1 flex gap-1">
                  <input v-model="beacon.corner_label" placeholder="Corner" class="stm-input w-16" />
                  <select v-model="beacon.beacon_type" class="stm-input flex-1">
                    <option value="iron_peg">Iron peg</option>
                    <option value="concrete_beacon">Concrete beacon</option>
                    <option value="survey_nail">Survey nail</option>
                    <option value="witness_beacon">Witness beacon</option>
                  </select>
                  <select v-model="beacon.status" class="stm-input flex-1">
                    <option value="intact">Intact</option>
                    <option value="missing">Missing</option>
                    <option value="damaged">Damaged</option>
                    <option value="replaced">Replaced</option>
                  </select>
                  <button class="stm-btn subtle" :disabled="survey.busy.value" @click="pushBeacon">Add</button>
                </div>
              </div>
            </div>

            <!-- Prior findings -->
            <div v-if="d.findings.length" class="text-xs space-y-1 pt-2 border-t border-gray-100">
              <h4 class="font-semibold text-gray-700">Submitted reports</h4>
              <div v-for="f in d.findings" :key="f.id" class="bg-indigo-50 border border-indigo-100 rounded p-2 text-gray-700">
                <strong>{{ recLabel(f.recommendation) }}</strong> — {{ f.summary }}
                <span class="block text-[10px] text-gray-400">{{ new Date(f.submitted_at).toLocaleString() }}</span>
              </div>
            </div>

            <!-- Report submission -->
            <div v-if="d.status === 'in_progress' || d.status === 'returned'" class="border-t border-gray-100 pt-3 space-y-2">
              <h4 class="text-xs font-semibold text-gray-700">Report on survey</h4>
              <textarea v-model="finding.summary" rows="3" class="stm-input w-full"
                placeholder="Findings summary — what was surveyed, beacon condition, conformity with the approved layout…" />
              <div class="flex gap-2">
                <select v-model="finding.recommendation" class="stm-input flex-1">
                  <option value="no_objection">No objection</option>
                  <option value="approve">Approve</option>
                  <option value="approve_conditions">Approve with conditions</option>
                  <option value="objection">Objection</option>
                  <option value="refuse">Refuse</option>
                  <option value="refer_back">Refer back</option>
                </select>
                <input v-model="finding.conditions" placeholder="Conditions (optional)" class="stm-input flex-1" />
              </div>
            </div>
          </div>

          <!-- Sticky action footer -->
          <div v-if="d.status === 'in_progress' || d.status === 'returned' || d.assigned_to"
               class="p-4 border-t border-gray-200 bg-gray-50 flex flex-col gap-2">
            <button v-if="d.status === 'in_progress' || d.status === 'returned'"
                    class="w-full bg-indigo-600 text-white text-sm font-semibold py-2 rounded hover:bg-indigo-700 transition-colors disabled:opacity-50"
                    :disabled="survey.busy.value || !finding.summary.trim()" @click="pushFinding">
              Submit Data
            </button>
            <button v-if="d.status === 'in_progress'"
                    class="w-full bg-white border border-gray-200 text-gray-700 text-sm font-semibold py-2 rounded hover:bg-gray-50 transition-colors disabled:opacity-50"
                    :disabled="survey.busy.value" @click="survey.release(d.id)">Release to queue</button>
          </div>
        </template>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { storeToRefs } from 'pinia'
import { Search, Filter, RefreshCw, Maximize2, ClipboardList, Clock, Loader, CheckCircle } from 'lucide-vue-next'
import { useSurveyorTasks, recommendationLabel } from '@/composables/useSurveyorTasks'
import { useAuthStore } from '@/stores/auth'
import TaskMapThumb from '@/components/surveyor/TaskMapThumb.vue'
import type { SurveyRecommendation, SurveyTask, SurveyTaskStatus } from '@/services/surveyor'

const survey = useSurveyorTasks()
const d = computed(() => survey.detail.value)

const { user } = storeToRefs(useAuthStore())
const surveyor = computed(() => (user.value ? { name: user.value.name || user.value.email } : null))

// ── Tabs / filters ──────────────────────────────────────────────────
type TabKey = 'active' | 'completed' | 'archived'
const tabs: { key: TabKey; label: string }[] = [
  { key: 'active', label: 'Active Tasks' },
  { key: 'completed', label: 'Completed' },
  { key: 'archived', label: 'Archived' },
]
const tab = ref<TabKey>('active')
const q = ref('')
const unclaimedOnly = ref(false)

const ACTIVE = new Set<SurveyTaskStatus>(['assigned', 'in_progress', 'returned', 'submitted'])
function inTab(t: SurveyTask, key: TabKey): boolean {
  if (key === 'completed') return t.status === 'accepted'
  if (key === 'archived') return t.status === 'cancelled'
  return ACTIVE.has(t.status)
}
const countFor = (key: TabKey) => survey.sorted.value.filter(t => inTab(t, key)).length

const visibleTasks = computed(() => {
  const term = q.value.trim().toLowerCase()
  return survey.sorted.value.filter(t => {
    if (!inTab(t, tab.value)) return false
    if (unclaimedOnly.value && t.assigned_to) return false
    if (!term) return true
    return [t.stand_number, t.suburb_ward, t.applicant_name, taskTypeLabel(t.task_type)]
      .filter(Boolean).some(v => String(v).toLowerCase().includes(term))
  })
})
const emptyLabel = computed(() =>
  tab.value === 'active' ? 'No active tasks. Planners and EO Planners assign survey work from an application.'
  : tab.value === 'completed' ? 'No completed tasks yet. Submit a report from an in-progress task to close it.'
  : 'Nothing archived.')

// ── Stat cards ──────────────────────────────────────────────────────
const dueThisWeek = computed(() => {
  const now = Date.now(); const week = now + 7 * 864e5
  return survey.tasks.value.filter(t =>
    ACTIVE.has(t.status) && t.due_date && new Date(t.due_date).getTime() <= week).length
})
const completedCount = computed(() => survey.tasks.value.filter(t => t.status === 'accepted').length)

// ── Labels / styling ────────────────────────────────────────────────
const TASK_LABELS: Record<string, string> = {
  verification: 'Verification survey', setting_out: 'Setting-out', pegging: 'Pegging',
  layout: 'Layout survey', encroachment: 'Encroachment investigation',
  beacon_check: 'Beacon check', general: 'General task',
}
const taskTypeLabel = (t: string) => TASK_LABELS[t] || t
const recLabel = (r: SurveyRecommendation | null | undefined) => recommendationLabel(r)
const shortId = (t: SurveyTask) => t.dev_register_no || `#${t.id.slice(0, 8).toUpperCase()}`

const STATUS_LABELS: Record<string, string> = {
  assigned: 'Open', in_progress: 'In Progress', submitted: 'Submitted',
  accepted: 'Accepted', returned: 'Returned', cancelled: 'Cancelled',
}
const statusLabel = (s: string) => STATUS_LABELS[s] || s
function statusClass(s: string): string {
  return {
    assigned: 'bg-gray-100 text-gray-600',
    in_progress: 'bg-indigo-100 text-indigo-700',
    submitted: 'bg-amber-100 text-amber-700',
    accepted: 'bg-green-100 text-green-700',
    returned: 'bg-red-100 text-red-700',
    cancelled: 'bg-gray-100 text-gray-400',
  }[s] || 'bg-gray-100 text-gray-600'
}
const statusIcon = (s: string) =>
  s === 'in_progress' ? Loader : s === 'accepted' ? CheckCircle : Clock
function priorityClass(p: string): string {
  return { urgent: 'text-red-600', high: 'text-amber-600', normal: 'text-gray-700', low: 'text-gray-500' }[p] || 'text-gray-700'
}

// ── Surveyor banner helpers ─────────────────────────────────────────
const initials = (name: string) => name.split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase()

// ── Field capture (unchanged behaviour) ─────────────────────────────
const coord = ref<{ label: string; easting: number | null; northing: number | null }>({ label: '', easting: null, northing: null })
const beacon = ref({ corner_label: '', beacon_type: 'iron_peg', status: 'intact' })
const finding = ref<{ summary: string; recommendation: SurveyRecommendation; conditions: string }>({
  summary: '', recommendation: 'no_objection', conditions: '',
})

async function pushCoord() {
  if (!d.value) return
  await survey.addCoordinate(d.value.id, {
    label: coord.value.label || null, coord_system: 'Lo31',
    easting: coord.value.easting, northing: coord.value.northing,
  })
  coord.value = { label: '', easting: null, northing: null }
}
async function pushBeacon() {
  if (!d.value) return
  await survey.addBeacon(d.value.id, { ...beacon.value, corner_label: beacon.value.corner_label || null })
  beacon.value = { corner_label: '', beacon_type: 'iron_peg', status: 'intact' }
}
async function pushFinding() {
  if (!d.value) return
  await survey.submitFinding(d.value.id, {
    summary: finding.value.summary,
    recommendation: finding.value.recommendation,
    conditions: finding.value.conditions || undefined,
  })
  finding.value = { summary: '', recommendation: 'no_objection', conditions: '' }
}

onMounted(() => survey.refresh())
</script>

<style scoped>
.stm-input { border: 1px solid #cbd5e1; border-radius: 0.3rem; padding: 0.3rem 0.45rem; font-size: 0.72rem; }
.stm-btn { background: #4f46e5; color: #fff; font-size: 0.72rem; font-weight: 600;
  border: none; border-radius: 0.35rem; padding: 0.4rem 0.8rem; cursor: pointer; }
.stm-btn:disabled { opacity: 0.5; cursor: default; }
.stm-btn.subtle { background: #f1f5f9; color: #334155; }
</style>
