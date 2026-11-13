<script setup lang="ts">
/**
 * The findings register in three views:
 *   Findings      every finding, recorded, changed and closed here (closing needs a note)
 *   Risk Register the open findings by risk level, highest first
 *   Compliance    actions that fell due: the overdue ones, and whether each closed one was on time
 * A closed finding is not reopened; if the matter comes back it is recorded again.
 */
import { computed, onMounted, ref } from 'vue'
import { useRoute } from 'vue-router'
import { Search, TriangleAlert, ListChecks, Plus, Pencil, CircleCheck, AlertTriangle } from 'lucide-vue-next'
import { internalAuditApi, type AuditEngagement, type AuditFinding, type FindingRisk } from '../../../api/dashboardsApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate } from '../../../composables/useMoney'
import { pctText, usePortalRefresh } from '../../shared/useDashboard'
import ReasonDialog from '../../shared/ReasonDialog.vue'
import FindingDialog from '../components/FindingDialog.vue'
import { auditDash, RISK } from '../dashboard'

const route = useRoute()
const store = useFinanceStore()
const refresh = usePortalRefresh()
const mode = computed(() => route.meta.cwMode as 'findings' | 'risks' | 'compliance')
const canManage = computed(() => store.can('finance.audit.manage'))

const all = ref<AuditFinding[]>([])
const engagements = ref<AuditEngagement[]>([])
const status = ref<'open' | 'closed' | 'overdue' | ''>('open')
const risk = ref<FindingRisk | ''>('')
const loading = ref(false)
const error = ref<string | null>(null)
const editing = ref<AuditFinding | null | undefined>(undefined)
const closing = ref<AuditFinding | null>(null)
const busy = ref(false)
const closeError = ref<string | null>(null)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    ;[all.value, engagements.value] = await Promise.all([internalAuditApi.findings(), internalAuditApi.engagements()])
  } catch (err) { error.value = messageOf(err, 'The findings could not be read.') } finally { loading.value = false }
}
onMounted(load)

const shown = computed(() => all.value.filter((f) =>
  (!status.value || (status.value === 'overdue' ? f.overdue : f.status === status.value)) && (!risk.value || f.risk === risk.value)))
const openByRisk = computed(() => (['high', 'medium', 'low'] as FindingRisk[]).map((r) => ({ risk: r, list: all.value.filter((f) => f.status === 'open' && f.risk === r) })))
const today = new Date().toISOString().slice(0, 10)
const overdue = computed(() => all.value.filter((f) => f.overdue))
const fellDue = computed(() => all.value.filter((f) => f.status === 'closed' && f.due_date && f.due_date < today))
const onTime = (f: AuditFinding) => Boolean(f.closed_at && f.due_date && f.closed_at.slice(0, 10) <= f.due_date)
const openEngagements = computed(() => engagements.value.filter((e) => e.status !== 'cancelled'))

function saved(): void { editing.value = undefined; void load(); refresh() }
async function close(note: string): Promise<void> {
  if (!closing.value) return
  busy.value = true
  closeError.value = null
  try { await internalAuditApi.closeFinding(closing.value.id, note); closing.value = null; void load(); refresh() } catch (err) { closeError.value = messageOf(err, 'The finding could not be closed.') } finally { busy.value = false }
}
const riskTone = (r: string) => (r === 'high' ? 'cw-pill--neg' : r === 'medium' ? 'cw-pill--warn' : 'cw-pill--pos')
const TITLE = { findings: 'Findings', risks: 'Risk Register', compliance: 'Compliance' }
const LEAD = {
  findings: 'What each audit found, the action agreed with management, who owns it and by when.',
  risks: 'The open findings by risk level, highest first.',
  compliance: 'Agreed actions that have fallen due: the ones still open, and whether each closed one was closed on time.',
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><component :is="mode === 'findings' ? Search : mode === 'risks' ? TriangleAlert : ListChecks" :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>{{ TITLE[mode] }}</h2><p>{{ LEAD[mode] }}</p></div>
    <span class="cw-spacer" />
    <button v-if="canManage && mode === 'findings'" type="button" class="cw-btn cw-btn--primary" :disabled="!openEngagements.length"
      :title="openEngagements.length ? '' : 'Add an audit to the plan first'" @click="editing = null"><Plus :size="18" aria-hidden="true" /> Record finding</button>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <div v-if="loading && !all.length" class="cw-card cw-card-body" style="padding-top: 18px"><span class="cw-skel" /><span class="cw-skel" /></div>

  <!-- Findings -->
  <template v-else-if="mode === 'findings'">
    <div class="fp-filters">
      <div class="cw-seg" role="group" aria-label="Status">
        <button v-for="s in [['open', 'Open'], ['overdue', 'Overdue'], ['closed', 'Closed'], ['', 'All']]" :key="s[0]" type="button" :aria-pressed="status === s[0]" @click="status = s[0] as typeof status">{{ s[1] }}</button>
      </div>
      <div class="cw-seg" role="group" aria-label="Risk">
        <button type="button" :aria-pressed="risk === ''" @click="risk = ''">Any risk</button>
        <button v-for="(l, v) in RISK" :key="v" type="button" :aria-pressed="risk === v" @click="risk = v as FindingRisk">{{ l }}</button>
      </div>
    </div>
    <section class="cw-card">
      <div class="cw-card-body cw-table-wrap" style="padding-top: 16px">
        <p v-if="!shown.length" class="cw-empty">No findings match.</p>
        <table v-else class="cw-table dx-compact">
          <thead><tr><th>Finding</th><th>Audit</th><th>Risk</th><th>Action and owner</th><th>Due</th><th>Status</th><th /></tr></thead>
          <tbody>
            <tr v-for="f in shown" :key="f.id">
              <td class="dx-wrap"><strong>{{ f.title }}</strong><div v-if="f.detail" class="cw-hint">{{ f.detail }}</div></td>
              <td class="dx-wrap">{{ f.engagement_title }}</td>
              <td><span class="cw-pill" :class="riskTone(f.risk)">{{ RISK[f.risk] }}</span></td>
              <td class="dx-wrap">{{ f.action ?? '—' }}<div v-if="f.action_owner" class="cw-hint">{{ f.action_owner }}</div></td>
              <td :class="{ 'cw-neg': f.overdue }">{{ formatDate(f.due_date) }}</td>
              <td>
                <span v-if="f.status === 'closed'" class="cw-pill cw-pill--pos">Closed {{ formatDate(f.closed_at) }}</span>
                <span v-else-if="f.overdue" class="cw-pill cw-pill--neg">Overdue</span>
                <span v-else class="cw-pill cw-pill--warn">Open</span>
                <div v-if="f.closure_note" class="cw-hint">{{ f.closure_note }}</div>
              </td>
              <td class="fp-acts">
                <template v-if="canManage && f.status === 'open'">
                  <button type="button" class="cw-btn cw-btn--small" @click="editing = f"><Pencil :size="15" aria-hidden="true" /> Change</button>
                  <button type="button" class="cw-btn cw-btn--small" @click="closing = f; closeError = null"><CircleCheck :size="15" aria-hidden="true" /> Close</button>
                </template>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>

  <!-- Risk register -->
  <template v-else-if="mode === 'risks'">
    <div class="cw-tiles dx-tiles">
      <div v-for="g in openByRisk" :key="g.risk" class="cw-tile" :class="g.risk === 'high' ? 'cw-tile--red' : g.risk === 'medium' ? 'cw-tile--amber' : 'cw-tile--green'">
        <span class="cw-tile-icon"><TriangleAlert :size="30" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">{{ RISK[g.risk] }} risk</p><p class="cw-tile-value num">{{ g.list.length }}</p><p class="cw-tile-sub">open findings</p></div>
      </div>
    </div>
    <section v-for="g in openByRisk" :key="g.risk" class="cw-card">
      <div class="cw-card-head"><h3>{{ RISK[g.risk] }} risk</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="!g.list.length" class="cw-empty">No open {{ g.risk }}-risk findings.</p>
        <table v-else class="cw-table dx-compact">
          <thead><tr><th>Finding</th><th>Area</th><th>Owner</th><th>Due</th></tr></thead>
          <tbody><tr v-for="f in g.list" :key="f.id"><td class="dx-wrap">{{ f.title }}</td><td>{{ f.area }}</td><td>{{ f.action_owner ?? '—' }}</td>
            <td :class="{ 'cw-neg': f.overdue }">{{ formatDate(f.due_date) }}{{ f.overdue ? ' (overdue)' : '' }}</td></tr></tbody>
        </table>
      </div>
    </section>
  </template>

  <!-- Compliance -->
  <template v-else>
    <div class="cw-tiles dx-tiles">
      <div class="cw-tile cw-tile--green"><span class="cw-tile-icon"><ListChecks :size="30" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Compliance</p><p class="cw-tile-value num">{{ pctText(auditDash.state.data?.compliance.pct) }}</p>
          <p class="cw-tile-sub">actions closed by their due date</p></div></div>
      <div class="cw-tile cw-tile--red"><span class="cw-tile-icon"><TriangleAlert :size="30" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Overdue actions</p><p class="cw-tile-value num">{{ overdue.length }}</p></div></div>
      <div class="cw-tile cw-tile--blue"><span class="cw-tile-icon"><CircleCheck :size="30" aria-hidden="true" /></span>
        <div><p class="cw-tile-label">Closed on time</p><p class="cw-tile-value num">{{ fellDue.filter(onTime).length }}</p><p class="cw-tile-sub">of {{ fellDue.length }} closed after falling due</p></div></div>
    </div>
    <section class="cw-card">
      <div class="cw-card-head"><h3>Overdue actions</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="!overdue.length" class="cw-empty">No agreed action is past its date.</p>
        <table v-else class="cw-table dx-compact">
          <thead><tr><th>Finding</th><th>Action</th><th>Owner</th><th>Due</th><th>Risk</th></tr></thead>
          <tbody><tr v-for="f in overdue" :key="f.id"><td class="dx-wrap">{{ f.title }}</td><td class="dx-wrap">{{ f.action ?? '—' }}</td><td>{{ f.action_owner ?? '—' }}</td>
            <td class="cw-neg">{{ formatDate(f.due_date) }}</td><td><span class="cw-pill" :class="riskTone(f.risk)">{{ RISK[f.risk] }}</span></td></tr></tbody>
        </table>
      </div>
    </section>
    <section class="cw-card">
      <div class="cw-card-head"><h3>Closed actions that had fallen due</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="!fellDue.length" class="cw-empty">None yet.</p>
        <table v-else class="cw-table dx-compact">
          <thead><tr><th>Finding</th><th>Due</th><th>Closed</th><th>On time</th></tr></thead>
          <tbody><tr v-for="f in fellDue" :key="f.id"><td class="dx-wrap">{{ f.title }}</td><td>{{ formatDate(f.due_date) }}</td><td>{{ formatDate(f.closed_at) }}</td>
            <td><span class="cw-pill" :class="onTime(f) ? 'cw-pill--pos' : 'cw-pill--neg'">{{ onTime(f) ? 'Yes' : 'Late' }}</span></td></tr></tbody>
        </table>
      </div>
    </section>
  </template>

  <FindingDialog v-if="editing !== undefined" :finding="editing" :engagements="openEngagements" @saved="saved" @close="editing = undefined" />
  <ReasonDialog v-if="closing" title="Close finding" :message="closing.title" label="How was it resolved?" :min-length="3"
    submit-label="Close finding" :busy="busy" :error="closeError" @submit="close" @close="closing = null" />
</template>

<style scoped>
.fp-filters { display: flex; flex-wrap: wrap; gap: 12px; }
.fp-filters .cw-seg { max-width: 520px; }
.fp-acts { display: flex; gap: 6px; flex-wrap: wrap; }
</style>
