<script setup lang="ts">
// Shared permit queue used by Referrals, Public participation, and History.
import { caseRef } from '@/composables/useApplicationPipeline'
import { computed, onMounted, ref } from 'vue'
import { dmApi, type PermitApplication, type PermitStatus } from '@/services/developmentManagementService'
import { usePlannerShell } from '@/composables/usePlannerShell'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { filterPermitsForQueue } from '@/views/planner/plannerQueues'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import UiPanel from '@/components/ui/UiPanel.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { ArrowRight, RefreshCw } from 'lucide-vue-next'

const props = defineProps<{
  title: string
  subtitle: string
  empty: string
  statuses: readonly PermitStatus[]
  caseTab: string
  /** When set, skip the status filter and take the most recently updated N. */
  recentLimit?: number
}>()

const shell = usePlannerShell()
const fb = useUiFeedback()
const permits = ref<PermitApplication[]>([])
const loading = ref(false)

async function refresh() {
  loading.value = true
  try {
    const all = await dmApi.listAllPermits()
    if (props.recentLimit) {
      permits.value = [...all]
        .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
        .slice(0, props.recentLimit)
    } else {
      permits.value = filterPermitsForQueue(all, props.statuses)
    }
  } catch (err: unknown) {
    fb.showToast(fb.parseApiError(err, 'Could not load the queue'), 'error')
  } finally {
    loading.value = false
  }
}
onMounted(refresh)

const countLabel = computed(() =>
  `${permits.value.length} case${permits.value.length === 1 ? '' : 's'}`)

function open(p: PermitApplication) {
  void shell.openCaseForStand(p.id, props.caseTab)
}

function fmtDate(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
</script>

<template>
  <div class="pq">
    <header class="pq-head">
      <div>
        <h2>{{ title }}</h2>
        <p>{{ subtitle }} · {{ countLabel }}</p>
      </div>
      <UiButton size="sm" :loading="loading" @click="refresh">
        <template #icon><RefreshCw :size="13" /></template>
        Refresh
      </UiButton>
    </header>

    <UiPanel flush>
      <UiEmptyState v-if="!loading && !permits.length" :message="empty" />
      <ul v-else class="pq-list">
        <li v-for="p in permits" :key="p.id">
          <button type="button" class="pq-row" @click="open(p)">
            <span class="pq-ref">{{ caseRef(p) }}</span>
            <span class="pq-title">{{ p.applicant_name }} · Stand {{ p.stand_number }}</span>
            <UiStatusBadge :status="p.status" />
            <span class="pq-date">{{ fmtDate(p.updated_at) }}</span>
            <ArrowRight :size="14" aria-hidden="true" />
          </button>
        </li>
      </ul>
    </UiPanel>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.pq { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s4); }
.pq-head { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.pq-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); }
.pq-head p { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.pq-head :deep(.ui-btn) { margin-left: auto; }
.pq-list { list-style: none; margin: 0; padding: 0; }
.pq-row {
  display: grid; grid-template-columns: 8rem minmax(0, 1fr) auto auto auto;
  gap: var(--ent-s2); align-items: center; width: 100%;
  min-height: var(--ent-touch-min); padding: var(--ent-s2) var(--ent-s4);
  text-align: left; background: transparent; border: 0; border-top: 1px solid var(--ent-line);
  color: var(--ent-text); font: inherit; cursor: pointer;
}
.pq-list li:first-child .pq-row { border-top: none; }
.pq-row:hover { background: var(--ent-surface-2); }
.pq-row:focus-visible { outline: none; box-shadow: var(--ent-focus-ring); }
.pq-ref { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); }
.pq-title { font-size: var(--ent-fs-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.pq-date { font-size: var(--ent-fs-micro); color: var(--ent-text-3); white-space: nowrap; }
.pq-row > svg { color: var(--ent-text-3); }
@media (max-width: 767px) {
  .pq { padding: var(--ent-s3); }
  .pq-head { flex-direction: column; align-items: stretch; }
  .pq-head :deep(.ui-btn) { margin-left: 0; }
  .pq-row { grid-template-columns: minmax(0, 1fr) auto; }
  .pq-date, .pq-row :deep(.ui-badge) { display: none; }
}
</style>
