<script setup lang="ts">
/**
 * The access log: every change to finance access (audit event FIN_PERMISSION), who made it, for
 * whom, why, and what it changed, read from the before / after state the route records. Refused
 * attempts are listed and marked, because an attempt to dissolve a control is part of the record.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { History, AlertTriangle } from 'lucide-vue-next'
import { financeAccessApi, type AccessEvent } from '../../../api/financeAccessApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDateTime } from '../../../composables/useMoney'
import { adminDash, daysAgo } from '../dashboard'
import { readChange } from '../workspacePreview'

const store = useFinanceStore()
const canRead = computed(() => store.can('finance.audit.view'))
const from = ref(daysAgo(90))
const to = ref('')
const outcome = ref<'all' | 'saved' | 'refused'>('all')
const events = ref<AccessEvent[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  if (!canRead.value) return
  loading.value = true
  error.value = null
  try { events.value = await financeAccessApi.changes({ ...(from.value ? { from: from.value } : {}), ...(to.value ? { to: to.value } : {}) }) }
  catch (err) { error.value = messageOf(err, 'The access log could not be read.') } finally { loading.value = false }
}
onMounted(load)
watch([from, to], () => { void load() })

const names = computed(() => new Map((adminDash.state.data?.list.users ?? []).map((u) => [u.id, u.name])))
const rows = computed(() => events.value.map(readChange).filter((c) => outcome.value === 'all' || (outcome.value === 'refused') === c.refused))
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><History :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Access Log</h2><p>Every change to finance access: who made it, for whom, why, and what changed. Refused attempts are kept too.</p></div>
  </section>

  <p v-if="!canRead" class="cw-banner-msg cw-banner-msg--warn" role="status">The access log is part of the finance audit trail, which your role does not include (it needs <code>finance.audit.view</code>).</p>
  <template v-else>
    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>
    <div class="al-filters">
      <div class="cw-seg" role="group" aria-label="Outcome">
        <button type="button" :aria-pressed="outcome === 'all'" @click="outcome = 'all'">All</button>
        <button type="button" :aria-pressed="outcome === 'saved'" @click="outcome = 'saved'">Saved</button>
        <button type="button" :aria-pressed="outcome === 'refused'" @click="outcome = 'refused'">Refused</button>
      </div>
      <label class="al-date"><span class="cw-label">From</span><input v-model="from" class="cw-input" type="date" /></label>
      <label class="al-date"><span class="cw-label">To</span><input v-model="to" class="cw-input" type="date" /></label>
    </div>
    <section class="cw-card">
      <div class="cw-card-body cw-table-wrap" style="padding-top: 16px">
        <div v-if="loading && !events.length"><span class="cw-skel" /><span class="cw-skel" /></div>
        <p v-else-if="!rows.length" class="cw-empty">No access change is recorded for this selection.</p>
        <table v-else class="cw-table dx-compact">
          <thead><tr><th scope="col">When</th><th scope="col">For</th><th scope="col">What changed</th><th scope="col">Reason</th><th scope="col">Outcome</th><th scope="col">By</th></tr></thead>
          <tbody>
            <tr v-for="c in rows" :key="c.id">
              <td>{{ formatDateTime(c.at) }}</td>
              <td>{{ (c.target && names.get(c.target)) ?? c.target ?? '—' }}</td>
              <td class="dx-wrap"><div v-for="l in c.lines" :key="l">{{ l }}</div><span v-if="!c.lines.length" class="cw-hint">No difference recorded</span></td>
              <td class="dx-wrap">{{ c.reason ?? '—' }}</td>
              <td><span class="cw-pill" :class="c.refused ? 'cw-pill--neg' : 'cw-pill--pos'">{{ c.refused ? `Refused (${c.status})` : 'Saved' }}</span>
                <div v-if="c.refusal" class="cw-hint">{{ c.refusal }}</div></td>
              <td>{{ c.actor }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </template>
</template>

<style scoped>
.al-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: end; margin-bottom: 16px; }
.al-date { display: flex; flex-direction: column; gap: 4px; }
</style>
