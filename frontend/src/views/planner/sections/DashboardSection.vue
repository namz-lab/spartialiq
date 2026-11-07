<script setup lang="ts">
// My Work — the planner's first question: what do I need to do today?
// Clickable queues only. No hero KPI tiles.
import { computed, onMounted, ref } from 'vue'
import { dmApi, isConflictError } from '@/services/developmentManagementService'
import { useAuthStore } from '@/stores/auth'
import { useUiFeedback } from '@/composables/useUiFeedback'
import type { SectionKey } from '@/composables/usePlannerShell'
import { buildMyWork, scopePermits, scopeCounts, type WorkItem, type WorkScope } from '@/views/planner/myWork'
import UiFeedback from '@/components/UiFeedback.vue'
import SlaSummaryCard from '@/views/planner/SlaSummaryCard.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import UiButton from '@/components/ui/UiButton.vue'
import {
  AlertTriangle, ClipboardList, ShieldAlert, Bell, RefreshCw, UserPlus,
} from 'lucide-vue-next'

const emit = defineEmits<{
  'open-section': [key: SectionKey]
  'open-case': [permitId: string]
}>()
const fb = useUiFeedback()
const auth = useAuthStore()
const me = computed(() => (auth.user?.id != null ? String(auth.user.id) : null))

const permits = ref<Awaited<ReturnType<typeof dmApi.listAllPermits>>>([])
const enforcement = ref<Awaited<ReturnType<typeof dmApi.listEnforcement>>>([])
const appeals = ref<Awaited<ReturnType<typeof dmApi.listAppeals>>>([])
const loading = ref(false)

async function refresh() {
  loading.value = true
  try {
    const [p, e, a] = await Promise.all([
      dmApi.listAllPermits(),
      dmApi.listEnforcement({}),
      dmApi.listAppeals({ open: true }),
    ])
    permits.value = p
    enforcement.value = e
    appeals.value = a
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not load today\'s work'), 'error')
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

// ── Scope: whose files ─────────────────────────────────────────────────
const SCOPE_KEY = 'vungu.planner.mywork.scope'
const SCOPES: { key: WorkScope; label: string }[] = [
  { key: 'mine', label: 'Mine' },
  { key: 'unassigned', label: 'Unassigned' },
  { key: 'office', label: 'Whole office' },
]
function readScope(): WorkScope {
  try {
    const v = localStorage.getItem(SCOPE_KEY)
    return v === 'unassigned' || v === 'office' ? v : 'mine'
  } catch { return 'mine' }
}
const scope = ref<WorkScope>(readScope())
function setScope(v: WorkScope) {
  scope.value = v
  try { localStorage.setItem(SCOPE_KEY, v) } catch { /* per-viewer convenience only */ }
}

const counts = computed(() => scopeCounts(permits.value, me.value))
const scoped = computed(() => scopePermits(permits.value, scope.value, me.value))
const queues = computed(() => buildMyWork({ permits: scoped.value, enforcement: enforcement.value, appeals: appeals.value }))
const assigneeOf = computed(() => new Map(permits.value.map(p => [p.id, p.assigned_to ?? null])))

const APPS_TITLE: Record<WorkScope, string> = {
  mine: 'My applications', unassigned: 'Unassigned applications', office: 'Office applications',
}
const APPS_SUBTITLE: Record<WorkScope, string> = {
  mine: 'Live files assigned to you, by stage',
  unassigned: 'Live files nobody holds. Take one to make it yours.',
  office: 'Every live file in the office, by stage',
}

// ── Take a file ─────────────────────────────────────────────────────────
const taking = ref<string | null>(null)
async function take(item: WorkItem) {
  if (item.action.type !== 'case' || !me.value) return
  const id = item.action.permitId
  taking.value = id
  try {
    // The case route requires the revision last read (optimistic lock); the
    // list rows do not carry it, so read the file first.
    const current = await dmApi.getPermit(id)
    if (current.assigned_to && current.assigned_to !== me.value) {
      fb.showToast(`${item.ref} was taken by another officer`, 'warn')
    } else {
      await dmApi.updateCase(id, { assigned_to: me.value, expectedRevision: current.revision ?? 0 })
      fb.showToast(`${item.ref} is now yours`, 'success')
    }
    const p = permits.value.find(x => x.id === id)
    if (p) p.assigned_to = current.assigned_to && current.assigned_to !== me.value ? current.assigned_to : me.value
  } catch (err: unknown) {
    fb.showToast(isConflictError(err)
      ? `${item.ref} changed while you were taking it. Refresh and try again.`
      : fb.parseApiError(err, 'Could not assign the file'), 'error')
  } finally {
    taking.value = null
  }
}

function openItem(item: WorkItem) {
  if (item.action.type === 'case') emit('open-case', item.action.permitId)
  else emit('open-section', item.action.section)
}

function daysLabel(item: WorkItem): string {
  if (item.daysRemaining == null) return ''
  if (item.daysRemaining <= 0) return 'Overdue'
  if (item.daysRemaining === 1) return '1 day'
  return `${item.daysRemaining} days`
}

const appBuckets: Array<{ key: keyof ReturnType<typeof buildMyWork>['applications']; title: string }> = [
  { key: 'newlyAssigned', title: 'New files' },
  { key: 'inAssessment', title: 'In assessment' },
  { key: 'awaitingInformation', title: 'Awaiting information' },
  { key: 'awaitingReferrals', title: 'Awaiting referrals' },
  { key: 'awaitingObjections', title: 'Awaiting objections' },
  { key: 'readyForRecommendation', title: 'Ready for recommendation' },
  { key: 'awaitingDecision', title: 'Awaiting decision' },
]

/** Only stages with files in them. Seven "nothing waiting" boxes said nothing. */
const liveBuckets = computed(() => appBuckets.filter(b => queues.value.applications[b.key].length))
const SEVERITY_LABEL: Record<WorkItem['severity'], string> = {
  critical: 'Overdue', urgent: 'Urgent', caution: 'Due soon', info: 'Note',
}
</script>

<template>
  <div class="mw">
    <header class="mw-head">
      <div>
        <h2>What do I need to do today?</h2>
        <p class="mw-sub">Open a row to continue the case. Enforcement and appeals are shown office-wide.</p>
      </div>
      <div class="mw-scope" role="radiogroup" aria-label="Whose applications">
        <button v-for="s in SCOPES" :key="s.key" type="button" role="radio" class="mw-scope-btn"
                :class="{ active: scope === s.key }" :aria-checked="scope === s.key" @click="setScope(s.key)">
          {{ s.label }} <span class="mw-scope-n">{{ counts[s.key] }}</span>
        </button>
      </div>
      <UiButton size="sm" :loading="loading" @click="refresh">
        <template #icon><RefreshCw :size="13" /></template>
        {{ loading ? 'Loading' : 'Refresh' }}
      </UiButton>
    </header>

    <div class="mw-grid">
      <!-- Two independent columns: what must be acted on (left) and the
           officer's files by stage (right). In one grid row the taller apps
           panel used to push Enforcement down, leaving a blank band. -->
      <div class="mw-stack">
        <UiPanel flush title="Urgent" subtitle="Deadlines, overdue clocks, matters that cannot wait">
          <template #icon><AlertTriangle :size="15" /></template>
          <UiEmptyState v-if="!queues.urgent.length" message="Nothing overdue or close to a statutory deadline." />
          <ul v-else class="mw-list">
            <li v-for="item in queues.urgent" :key="item.id + item.reason">
              <button type="button" class="mw-row" :class="item.severity" @click="openItem(item)">
                <span class="mw-ref" :class="{ unreg: item.ref === 'Unregistered' }">{{ item.ref }}</span>
                <span class="mw-side">
                  <span class="mw-pill" :class="item.severity">{{ daysLabel(item) || SEVERITY_LABEL[item.severity] }}</span>
                </span>
                <span class="mw-title">{{ item.title }}</span>
                <span class="mw-reason">{{ item.reason }}</span>
              </button>
            </li>
          </ul>
        </UiPanel>

        <UiPanel flush title="Enforcement" subtitle="Orders waiting on the planner">
          <template #icon><ShieldAlert :size="15" /></template>
          <UiEmptyState v-if="!queues.enforcement.length" message="No orders waiting on you." />
          <ul v-else class="mw-list">
            <li v-for="item in queues.enforcement" :key="item.id">
              <button type="button" class="mw-row urgent" @click="openItem(item)">
                <span class="mw-ref">{{ item.ref || 'Order' }}</span>
                <span class="mw-title">{{ item.title }}</span>
                <span class="mw-reason">{{ item.reason }}</span>
              </button>
            </li>
          </ul>
        </UiPanel>

        <UiPanel flush title="Alerts" subtitle="Unpaid fees on live files">
          <template #icon><Bell :size="15" /></template>
          <UiEmptyState v-if="!queues.alerts.length" message="No unpaid fees on live files." />
          <ul v-else class="mw-list">
            <li v-for="item in queues.alerts" :key="item.id + item.reason">
              <button type="button" class="mw-row caution" @click="openItem(item)">
                <span class="mw-ref" :class="{ unreg: item.ref === 'Unregistered' }">{{ item.ref }}</span>
                <span class="mw-title">{{ item.title }}</span>
                <span class="mw-reason">{{ item.reason }}</span>
              </button>
            </li>
          </ul>
        </UiPanel>

        <SlaSummaryCard :permits="scoped" />
      </div>

      <UiPanel flush :title="APPS_TITLE[scope]" :subtitle="APPS_SUBTITLE[scope]">
        <template #icon><ClipboardList :size="15" /></template>
        <p v-if="scope === 'mine' && !counts.mine && !loading" class="mw-hint">
          No live files are assigned to you.
          <button v-if="counts.unassigned" type="button" class="mw-link" @click="setScope('unassigned')">
            {{ counts.unassigned }} unassigned file{{ counts.unassigned === 1 ? '' : 's' }} waiting
          </button>
        </p>
        <UiEmptyState v-else-if="!liveBuckets.length && !loading" message="No live files in this view." />
        <div v-else class="mw-buckets">
          <section v-for="bucket in liveBuckets" :key="bucket.key" class="mw-bucket">
            <h3>{{ bucket.title }} <span>{{ queues.applications[bucket.key].length }}</span></h3>
            <ul class="mw-list">
              <li v-for="item in queues.applications[bucket.key]" :key="item.id" class="mw-item">
                <button type="button" class="mw-row" @click="openItem(item)">
                  <span class="mw-ref" :class="{ unreg: item.ref === 'Unregistered' }">{{ item.ref }}</span>
                  <span class="mw-title">{{ item.title }}</span>
                  <span class="mw-reason">{{ item.reason }}</span>
                </button>
                <UiButton v-if="scope !== 'mine' && item.action.type === 'case' && !assigneeOf.get(item.id)"
                          size="sm" variant="ghost" class="mw-take" :loading="taking === item.id"
                          :aria-label="`Take ${item.ref}`" @click="take(item)">
                  <template #icon><UserPlus :size="13" /></template>
                  Take
                </UiButton>
              </li>
            </ul>
          </section>
        </div>
      </UiPanel>
    </div>

    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.mw { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s4); }
.mw-head { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.mw-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); color: var(--ent-text); letter-spacing: -0.01em; }
.mw-sub { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); max-width: 62ch; }
.mw-head :deep(.ui-btn) { margin-left: var(--ent-s2); }
.mw-head > div:first-child { flex: 1; }

.mw-scope { display: inline-flex; padding: 2px; gap: 2px; border: 1px solid var(--ent-line-strong); border-radius: var(--ent-r); background: var(--ent-surface-2); }
.mw-scope-btn { all: unset; box-sizing: border-box; display: inline-flex; align-items: center; gap: var(--ent-s1); cursor: pointer; white-space: nowrap;
  min-height: calc(var(--ent-control-h) - 6px); padding: 0 var(--ent-s3); border-radius: calc(var(--ent-r) - 2px);
  font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.mw-scope-btn:hover { color: var(--ent-text); }
.mw-scope-btn:focus-visible { box-shadow: var(--ent-focus-ring); }
.mw-scope-btn.active { background: var(--ent-surface); color: var(--ent-text); font-weight: var(--ent-fw-semibold); box-shadow: 0 1px 2px rgb(0 0 0 / 0.08); }
.mw-scope-n { font-size: var(--ent-fs-micro); color: var(--ent-text-3); font-variant-numeric: tabular-nums; }

.mw-hint { margin: 0; padding: var(--ent-s3) var(--ent-s4); font-size: var(--ent-fs-sm); color: var(--ent-text-2); border-bottom: 1px solid var(--ent-line); }
.mw-link { all: unset; cursor: pointer; color: var(--ent-accent); text-decoration: underline; text-underline-offset: 2px; }
.mw-link:focus-visible { box-shadow: var(--ent-focus-ring); border-radius: 2px; }
.mw-item { display: flex; align-items: center; border-top: 1px solid var(--ent-line); }
.mw-list li.mw-item:first-child { border-top: none; }
.mw-item .mw-row { border-top: none; flex: 1; min-width: 0; }
.mw-take { flex-shrink: 0; margin-right: var(--ent-s2); }

.mw-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(380px, 100%), 1fr)); gap: var(--ent-s3); align-items: start; }
.mw-stack { display: flex; flex-direction: column; gap: var(--ent-s3); min-width: 0; }

/* Long queues scroll inside their panel instead of stretching the page. */
.mw-list { list-style: none; margin: 0; padding: 0; }
.mw-grid :deep(.ui-panel-body) { max-height: 34rem; overflow-y: auto; }

/* Two lines: reference + status on the first, what it is + why on the second.
   The previous single five-column line squeezed the title to "S…" at
   one-third width and broke references across two lines. */
.mw-row {
  display: grid; grid-template-columns: minmax(0, 1fr) auto; grid-template-areas: "ref side" "title reason";
  column-gap: var(--ent-s3); row-gap: 2px; align-items: baseline; width: 100%;
  padding: var(--ent-s2) var(--ent-s4); text-align: left;
  background: transparent; border: 0; border-top: 1px solid var(--ent-line);
  color: var(--ent-text); font: inherit; cursor: pointer;
}
.mw-list li:first-child .mw-row { border-top: none; }
.mw-row:hover { background: var(--ent-surface-2); }
.mw-row:focus-visible { outline: none; box-shadow: inset var(--ent-focus-ring); }
.mw-row.critical { box-shadow: inset 3px 0 0 var(--ent-danger); }
.mw-row.urgent { box-shadow: inset 3px 0 0 var(--ent-warning); }
.mw-ref { grid-area: ref; font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.mw-ref.unreg { font-family: var(--ent-font); font-weight: var(--ent-fw-normal); font-style: italic; color: var(--ent-text-3); }
.mw-side { grid-area: side; justify-self: end; }
.mw-title { grid-area: title; font-size: var(--ent-fs-sm); color: var(--ent-text-2); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mw-reason { grid-area: reason; justify-self: end; font-size: var(--ent-fs-micro); color: var(--ent-text-3); text-align: right; max-width: 16rem; }
.mw-row:not(:has(.mw-side)) { grid-template-areas: "ref reason" "title reason"; align-items: center; }
.mw-pill {
  display: inline-block; min-width: 3.4rem; padding: 1px var(--ent-s2); border-radius: var(--ent-r-pill);
  text-align: center; font-size: var(--ent-fs-micro); font-weight: var(--ent-fw-bold); white-space: nowrap;
  color: var(--ent-text-2); background: var(--ent-tone-neutral-bg);
}
.mw-pill.critical { color: var(--ent-danger); background: var(--ent-danger-soft); }
.mw-pill.urgent, .mw-pill.caution { color: var(--ent-warning); background: var(--ent-warning-soft); }

.mw-buckets { display: flex; flex-direction: column; }
.mw-bucket { border-top: 1px solid var(--ent-line); }
.mw-bucket:first-child { border-top: none; }
.mw-bucket h3 {
  position: sticky; top: 0; z-index: 1; background: var(--ent-surface-2);
  margin: 0; padding: var(--ent-s2) var(--ent-s4); font-size: var(--ent-fs-xs);
  font-weight: var(--ent-fw-semibold); letter-spacing: 0.04em; text-transform: uppercase;
  color: var(--ent-text-3); display: flex; justify-content: space-between;
}
@media (max-width: 767px) {
  .mw { padding: var(--ent-s3); }
  .mw-head { flex-direction: column; align-items: stretch; }
  .mw-head :deep(.ui-btn) { margin-left: 0; }
  .mw-scope { width: 100%; }
  .mw-scope-btn { flex: 1; justify-content: center; min-height: var(--ent-touch-min); }
  .mw-grid { grid-template-columns: minmax(0, 1fr); }
  .mw-row { min-height: var(--ent-touch-min); }
  /* One scroll on a phone: nested scrollers trap the thumb. */
  .mw-grid :deep(.ui-panel-body) { max-height: none; overflow: visible; }
  .mw-reason { display: none; }
}
</style>
