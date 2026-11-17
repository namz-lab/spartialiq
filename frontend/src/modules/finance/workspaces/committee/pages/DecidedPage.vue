<script setup lang="ts">
/**
 * Decided: the committee's decision register. Who decided what, when, with which resolution and
 * reason, read from the audit trail (decisions.ts). Attempts the server refused (approving one's own
 * submission, a closed year) are listed too and marked as refused, because they are part of the
 * record.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { History, AlertTriangle } from 'lucide-vue-next'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDateTime } from '../../../composables/useMoney'
import { KINDS, kindMeta, type DecisionKind } from '../agenda'
import { loadDecisions, OUTCOME_LABEL, type Decision } from '../decisions'

const store = useFinanceStore()
const canRead = computed(() => store.can('finance.audit.view'))
const kinds = computed(() => KINDS.filter((m) => store.can(m.permission)).map((m) => m.kind))

const rows = ref<Decision[]>([])
const loading = ref(false)
const error = ref<string | null>(null)
const kind = ref<DecisionKind | ''>('')
const whose = ref<'all' | 'mine'>('all')
const from = ref('')
const to = ref('')

async function load(): Promise<void> {
  if (!canRead.value || !kinds.value.length) return
  loading.value = true
  error.value = null
  try {
    rows.value = await loadDecisions(kinds.value, { ...(from.value ? { from: from.value } : {}), ...(to.value ? { to: to.value } : {}) })
  } catch (err) { error.value = messageOf(err, 'The decision register could not be read.') } finally { loading.value = false }
}
onMounted(load)
watch([from, to], () => { void load() })

const shown = computed(() => rows.value.filter((d) =>
  (!kind.value || d.kind === kind.value) && (whose.value === 'all' || d.actor_id === store.identity?.user_id)))
const tone = (d: Decision) => (d.refused ? 'cw-pill--mute' : d.outcome === 'approved' ? 'cw-pill--pos' : 'cw-pill--warn')
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><History :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Decided</h2><p>Every committee decision on the kinds you decide: the outcome, the resolution, the reason, who and when.</p></div>
  </section>

  <p v-if="!canRead" class="cw-banner-msg cw-banner-msg--warn" role="status">
    The decision register is read from the finance audit trail, which your role does not include (it needs <code>finance.audit.view</code>).
  </p>
  <template v-else>
    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

    <div class="cd-filters">
      <div class="cw-seg" role="group" aria-label="Kind of decision">
        <button type="button" :aria-pressed="kind === ''" @click="kind = ''">All kinds</button>
        <button v-for="k in kinds" :key="k" type="button" :aria-pressed="kind === k" @click="kind = k">{{ kindMeta(k).label }}</button>
      </div>
      <div class="cw-seg" role="group" aria-label="Whose decisions">
        <button type="button" :aria-pressed="whose === 'all'" @click="whose = 'all'">Whole committee</button>
        <button type="button" :aria-pressed="whose === 'mine'" @click="whose = 'mine'">Mine</button>
      </div>
      <label class="cd-date"><span class="cw-label">From</span><input v-model="from" class="cw-input" type="date" /></label>
      <label class="cd-date"><span class="cw-label">To</span><input v-model="to" class="cw-input" type="date" /></label>
    </div>

    <section class="cw-card">
      <div class="cw-card-body cw-table-wrap" style="padding-top: 16px">
        <div v-if="loading && !rows.length"><span class="cw-skel" /><span class="cw-skel" /></div>
        <p v-else-if="!shown.length" class="cw-empty">No decision is recorded for this selection.</p>
        <table v-else class="cw-table dx-compact">
          <thead><tr><th scope="col">When</th><th scope="col">Kind</th><th scope="col">Item</th><th scope="col">Outcome</th><th scope="col">Resolution</th>
            <th scope="col">Figure</th><th scope="col">Reason</th><th scope="col">Decided by</th></tr></thead>
          <tbody>
            <tr v-for="d in shown" :key="d.id">
              <td>{{ formatDateTime(d.at) }}</td>
              <td>{{ kindMeta(d.kind).label }}</td>
              <td class="dx-wrap">{{ d.subject }}</td>
              <td><span class="cw-pill" :class="tone(d)">{{ d.refused ? `Refused by the system (${d.status})` : OUTCOME_LABEL[d.outcome] }}</span>
                <div v-if="d.refused" class="cw-hint">{{ OUTCOME_LABEL[d.outcome] }} was attempted</div></td>
              <td class="num">{{ d.resolution ?? '—' }}</td>
              <td class="num">{{ d.figure ?? '—' }}</td>
              <td class="dx-wrap">{{ d.note ?? '—' }}</td>
              <td>{{ d.actor }}</td>
            </tr>
          </tbody>
        </table>
        <p class="dx-note">Budget-line and project approvals keep who and when, but no written reason or resolution: the server does not record one for them yet.</p>
      </div>
    </section>
  </template>
</template>

<style scoped>
.cd-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
.cd-date { display: flex; flex-direction: column; gap: 4px; }
</style>
