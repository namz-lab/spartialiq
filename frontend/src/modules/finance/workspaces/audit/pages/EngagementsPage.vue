<script setup lang="ts">
/**
 * The internal audit plan for the selected year (Audit Plans), or the same audits by who leads them
 * (Audit Assignments, where the lead can be changed in place). Adding and changing audits needs
 * finance.audit.manage; everyone with the trail may read the plan.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute } from 'vue-router'
import { ClipboardList, UserCheck, Plus, Pencil, AlertTriangle } from 'lucide-vue-next'
import { internalAuditApi, type AuditEngagement, type EngagementStatus } from '../../../api/dashboardsApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate } from '../../../composables/useMoney'
import { usePortalRefresh } from '../../shared/useDashboard'
import EngagementDialog from '../components/EngagementDialog.vue'
import { PHASE, STATUS } from '../dashboard'

const route = useRoute()
const store = useFinanceStore()
const refresh = usePortalRefresh()
const mode = computed(() => route.meta.cwMode as 'plan' | 'assignments')
const canManage = computed(() => store.can('finance.audit.manage'))

const rows = ref<AuditEngagement[]>([])
const auditors = ref<{ id: string; name: string }[]>([])
const status = ref<EngagementStatus | ''>('')
const loading = ref(false)
const error = ref<string | null>(null)
const editing = ref<AuditEngagement | null | undefined>(undefined)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    rows.value = await internalAuditApi.engagements({
      ...(store.selectedYearId ? { financial_year_id: store.selectedYearId } : {}), ...(status.value ? { status: status.value } : {}),
    })
  } catch (err) { error.value = messageOf(err, 'The audit plan could not be read.') } finally { loading.value = false }
}
onMounted(async () => {
  void load()
  try { auditors.value = await internalAuditApi.auditors() } catch { auditors.value = [] }
})
watch([() => store.selectedYearId, status], load)

function saved(): void { editing.value = undefined; void load(); refresh() }
async function assign(a: AuditEngagement, lead: string): Promise<void> {
  error.value = null
  try { await internalAuditApi.updateEngagement(a.id, { lead_user_id: lead || null }); void load(); refresh() } catch (err) { error.value = messageOf(err, 'The lead could not be changed.') }
}
const groups = computed(() => {
  const map = new Map<string, AuditEngagement[]>()
  for (const r of rows.value) {
    const k = r.lead_name ?? 'Not assigned'
    map.set(k, [...(map.get(k) ?? []), r])
  }
  return [...map.entries()]
})
const tone = (s: string) => (s === 'completed' ? 'cw-pill--pos' : s === 'in_progress' ? 'cw-pill--info' : s === 'cancelled' ? 'cw-pill--mute' : 'cw-pill--warn')
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><component :is="mode === 'plan' ? ClipboardList : UserCheck" :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>{{ mode === 'plan' ? 'Audit Plans' : 'Audit Assignments' }}</h2>
      <p>{{ mode === 'plan' ? `The audits planned for ${store.selectedYear?.label ?? 'the year'}, and where each stands.` : 'Who leads each audit. Change the lead here.' }}</p>
    </div>
    <span class="cw-spacer" />
    <button v-if="canManage" type="button" class="cw-btn cw-btn--primary" @click="editing = null"><Plus :size="18" aria-hidden="true" /> Add audit</button>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <div class="cw-seg" role="group" aria-label="Status" style="max-width: 720px">
    <button type="button" :aria-pressed="status === ''" @click="status = ''">All</button>
    <button v-for="(l, v) in STATUS" :key="v" type="button" :aria-pressed="status === v" @click="status = v as EngagementStatus">{{ l }}</button>
  </div>

  <section class="cw-card">
    <div class="cw-card-body cw-table-wrap" style="padding-top: 16px">
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!rows.length" class="cw-empty">No audits{{ status ? ` ${STATUS[status].toLowerCase()}` : '' }} on the plan for this year.</p>

      <table v-else-if="mode === 'plan'" class="cw-table dx-compact">
        <thead><tr><th>Audit</th><th>Area</th><th>Planned</th><th>Lead</th><th>Phase</th><th>Status</th><th class="r">Findings (open)</th><th /></tr></thead>
        <tbody>
          <tr v-for="a in rows" :key="a.id">
            <td class="dx-wrap"><strong>{{ a.title }}</strong><div v-if="a.notes" class="cw-hint">{{ a.notes }}</div></td>
            <td>{{ a.area }}</td>
            <td>{{ formatDate(a.planned_start) }} – {{ formatDate(a.planned_end) }}</td>
            <td>{{ a.lead_name ?? '—' }}</td>
            <td>{{ PHASE[a.phase] }}</td>
            <td><span class="cw-pill" :class="tone(a.status)">{{ STATUS[a.status] }}</span></td>
            <td class="r num"><RouterLink v-if="a.findings" :to="{ name: 'aud-findings', query: { engagement: a.id } }" class="cw-link" :aria-label="`${a.findings} findings, ${a.open_findings} open, for ${a.title}`">{{ a.findings }} ({{ a.open_findings }})</RouterLink><template v-else>0</template></td>
            <td><button v-if="canManage" type="button" class="cw-btn cw-btn--small" @click="editing = a"><Pencil :size="15" aria-hidden="true" /> Change</button></td>
          </tr>
        </tbody>
      </table>

      <template v-else>
        <div v-for="[lead, list] in groups" :key="lead" class="ae-group">
          <h3>{{ lead }} <span class="cw-hint">· {{ list.length }} audit{{ list.length === 1 ? '' : 's' }}</span></h3>
          <table class="cw-table dx-compact">
            <thead><tr><th>Audit</th><th>Planned</th><th>Status</th><th>Lead</th></tr></thead>
            <tbody>
              <tr v-for="a in list" :key="a.id">
                <td class="dx-wrap">{{ a.title }} <span class="cw-hint">({{ a.area }})</span></td>
                <td>{{ formatDate(a.planned_start) }} – {{ formatDate(a.planned_end) }}</td>
                <td><span class="cw-pill" :class="tone(a.status)">{{ STATUS[a.status] }}</span></td>
                <td>
                  <select v-if="canManage" class="cw-input ae-lead" :value="a.lead_user_id ?? ''" :aria-label="`Lead for ${a.title}`" @change="assign(a, ($event.target as HTMLSelectElement).value)">
                    <option value="">Not assigned</option><option v-for="u in auditors" :key="u.id" :value="u.id">{{ u.name }}</option>
                  </select>
                  <span v-else>{{ a.lead_name ?? '—' }}</span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </div>
  </section>

  <EngagementDialog v-if="editing !== undefined" :engagement="editing" @saved="saved" @close="editing = undefined" />
</template>

<style scoped>
.ae-group + .ae-group { margin-top: 18px; }
.ae-group h3 { margin: 0 0 8px; font-size: 15px; }
.ae-lead { min-width: 180px; padding-top: 6px; padding-bottom: 6px; }
</style>
