<script setup lang="ts">
// Appeals (RTCP Act s.38). The planner's duty is the case record: when an
// appeal is lodged, assemble everything the council holds on the application
// for the Administrative Court. Lodging and hearing dates are recorded at the
// counter (clerk) and by the EO; this view reads them.
//
// With `permitId` it is the Application 360 Appeals tab; without, the register.
import { caseRef } from '@/composables/useApplicationPipeline'
import { computed, inject, onMounted, ref, watch } from 'vue'
import { dmApi, type Appeal } from '@/services/developmentManagementService'
import { PLANNER_SHELL_KEY } from '@/composables/usePlannerShell'
import { useAuthStore } from '@/stores/auth'
import { useUiFeedback } from '@/composables/useUiFeedback'
import { downloadAppealRecord } from '../appealRecord'
import UiFeedback from '@/components/UiFeedback.vue'
import UiButton from '@/components/ui/UiButton.vue'
import UiEmptyState from '@/components/ui/UiEmptyState.vue'
import UiStatusBadge from '@/components/ui/UiStatusBadge.vue'
import { RefreshCw, FileDown, ArrowRight } from 'lucide-vue-next'

const props = defineProps<{ permitId?: string | null }>()
const shell = inject(PLANNER_SHELL_KEY, null)
const auth = useAuthStore()
const fb = useUiFeedback()
const officer = computed(() => auth.user?.name || auth.user?.email || 'Town Planning Officer')

const appeals = ref<Appeal[]>([])
const loading = ref(false)
const building = ref<string | null>(null)

async function refresh() {
  loading.value = true
  try {
    appeals.value = await dmApi.listAppeals(props.permitId ? { permit_application_id: props.permitId } : { limit: 200 })
  } catch (e) {
    fb.showToast(fb.parseApiError(e, 'Could not load appeals'), 'error')
  } finally {
    loading.value = false
  }
}
onMounted(refresh)
watch(() => props.permitId, refresh)

const open = computed(() => appeals.value.filter(a => a.status !== 'decided' && a.status !== 'withdrawn'))
const closed = computed(() => appeals.value.filter(a => a.status === 'decided' || a.status === 'withdrawn'))

async function record(a: Appeal) {
  building.value = a.id
  try {
    await downloadAppealRecord(a, officer.value)
    fb.showToast('Case record downloaded', 'success')
  } catch (e) {
    fb.openMessageBox({ kind: 'error', title: 'Could not assemble the case record', message: fb.parseApiError(e, 'A record could not be read from the server.') })
  } finally {
    building.value = null
  }
}

const fmt = (v?: string | null) => v ? new Date(v).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'
const STATUS_LABEL: Record<string, string> = {
  lodged: 'Lodged', acknowledged: 'Acknowledged', hearing_scheduled: 'Hearing set', decided: 'Decided', withdrawn: 'Withdrawn',
}
</script>

<template>
  <div class="ap" :class="{ embedded: !!permitId }">
    <header v-if="!permitId" class="ap-head">
      <div>
        <h2>Appeals</h2>
        <p>Appeals to the Administrative Court (s.38) · prepare the case record for each</p>
      </div>
      <UiButton size="sm" :loading="loading" @click="refresh">
        <template #icon><RefreshCw :size="13" /></template>
        Refresh
      </UiButton>
    </header>

    <p v-if="loading && !appeals.length" class="ap-meta" role="status">Loading appeals…</p>
    <UiEmptyState v-else-if="!appeals.length && !loading" :message="permitId ? 'No appeal lodged against this application.' : 'No appeals lodged.'" />

    <ul v-else class="ap-list">
      <li v-for="a in [...open, ...closed]" :key="a.id" class="ap-item" :class="{ closed: closed.includes(a) }">
        <div class="ap-row">
          <span class="ap-ref">{{ caseRef(a) }}</span>
          <span class="ap-title">{{ a.appellant_name }} <small>({{ a.appellant_type }})</small> · Stand {{ a.stand_number || '—' }}</span>
          <UiStatusBadge :tone="a.status === 'decided' ? 'positive' : a.status === 'withdrawn' ? 'neutral' : 'warning'"
                         :label="STATUS_LABEL[a.status] ?? a.status" />
        </div>
        <p class="ap-grounds">{{ a.grounds }}</p>
        <p class="ap-meta">
          Lodged {{ fmt(a.lodged_at) }}
          <template v-if="a.days_after_decision != null"> · {{ a.days_after_decision }} days after the decision</template>
          <template v-if="a.within_window === false"> · <strong class="ap-late">outside the one-month window</strong></template>
          <template v-if="a.hearing_date"> · hearing {{ fmt(a.hearing_date) }}</template>
          <template v-if="a.decision"> · {{ a.decision }}</template>
        </p>
        <div class="ap-actions">
          <UiButton size="sm" variant="primary" :loading="building === a.id" @click="record(a)">
            <template #icon><FileDown :size="12" /></template>
            Prepare case record
          </UiButton>
          <UiButton v-if="!permitId && shell" size="sm" @click="shell.openCaseForStand(a.permit_application_id, 'appeals')">
            Open case <ArrowRight :size="12" aria-hidden="true" />
          </UiButton>
        </div>
      </li>
    </ul>
    <UiFeedback :feedback="fb" />
  </div>
</template>

<style scoped>
.ap { padding: var(--ent-s4) var(--ent-s5); display: flex; flex-direction: column; gap: var(--ent-s3); }
.ap.embedded { padding: 0; }
.ap-head { display: flex; align-items: flex-start; gap: var(--ent-s2); }
.ap-head > div { flex: 1; }
.ap-head h2 { margin: 0; font-size: var(--ent-fs-lg); font-weight: var(--ent-fw-bold); }
.ap-head p { margin: 4px 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-3); }
.ap-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--ent-s2); }
.ap-item { background: var(--ent-surface); border: 1px solid var(--ent-line); border-radius: var(--ent-r-md); padding: var(--ent-s3); }
.ap-item.closed { opacity: 0.8; }
.ap-row { display: flex; align-items: center; gap: var(--ent-s2); flex-wrap: wrap; }
.ap-ref { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); font-weight: var(--ent-fw-semibold); }
.ap-title { flex: 1; font-size: var(--ent-fs-sm); min-width: 0; }
.ap-title small { color: var(--ent-text-3); }
.ap-grounds { margin: var(--ent-s2) 0 0; font-size: var(--ent-fs-sm); color: var(--ent-text-2); }
.ap-meta { margin: 4px 0 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); }
.ap-late { color: var(--ent-danger); }
.ap-actions { display: flex; gap: var(--ent-s2); flex-wrap: wrap; margin-top: var(--ent-s2); }
@media (max-width: 767px) { .ap { padding: var(--ent-s3); } .ap.embedded { padding: 0; } }
</style>
