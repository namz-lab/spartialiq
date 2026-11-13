<script setup lang="ts">
/**
 * One reconciliation: per ledger account, the old package's balance against this ledger's at the
 * same date. A difference is nil or carries a written explanation; the server refuses the sign-off
 * otherwise. Both columns come from Postgres as text and are never added up here.
 */
import { onMounted, reactive, ref, watch } from 'vue'
import { AlertTriangle, RefreshCw } from 'lucide-vue-next'
import { migrationApi, type ReconciliationDetail } from '../../../../api/migrationApi'
import { messageOf } from '../../../../stores/finance'
import { formatMoney, formatDate, formatDateTime } from '../../../../composables/useMoney'

const props = defineProps<{ reconciliationId: string; canPrepare: boolean; closed: boolean }>()
const emit = defineEmits<{ (e: 'changed'): void }>()

const detail = ref<ReconciliationDetail | null>(null)
const onlyDifferences = ref(true)
const error = ref<string | null>(null)
const busy = ref<string | null>(null)
const text = reactive<Record<string, string>>({})

async function load(): Promise<void> {
  error.value = null
  try {
    detail.value = await migrationApi.reconciliation(props.reconciliationId, onlyDifferences.value)
    for (const l of detail.value.lines) text[l.id] = l.explanation ?? ''
  } catch (err) {
    error.value = messageOf(err, 'The reconciliation could not be read.')
  }
}
onMounted(load)
watch([() => props.reconciliationId, onlyDifferences], load)

async function act(name: string, work: () => Promise<void>, fallback: string): Promise<void> {
  if (busy.value) return
  busy.value = name
  error.value = null
  try {
    await work()
    await load()
    emit('changed')
  } catch (err) {
    error.value = messageOf(err, fallback)
  } finally {
    busy.value = null
  }
}
const refresh = () => act('refresh', () => migrationApi.refreshReconciliation(props.reconciliationId), 'The reconciliation could not be refreshed.')
const explain = (id: string) => act(id, () => migrationApi.explain(id, text[id].trim()), 'The explanation could not be saved.')
/** Debit-positive, as the server sends it: a credit balance prints with its sign. */
const money = (v: string) => formatMoney(v, detail.value?.reconciliation.currency ?? 'USD')
</script>

<template>
  <div class="mr">
    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
    <div v-if="!detail && !error"><span class="cw-skel" /><span class="cw-skel" /></div>
    <template v-if="detail">
      <div class="mr-head">
        <div>
          <strong>{{ detail.reconciliation.kind === 'opening' ? 'Opening position' : 'Parallel run' }}, {{ detail.reconciliation.currency }}, at {{ formatDate(detail.reconciliation.as_at) }}</strong>
          <div class="cw-hint">From {{ detail.reconciliation.original_filename }}. Ledger figures read {{ formatDateTime(detail.reconciliation.refreshed_at) }}.</div>
        </div>
        <span class="cw-pill" :class="detail.totals.unexplained ? 'cw-pill--warn' : 'cw-pill--pos'">
          {{ detail.totals.differences === 0 ? 'Agrees on every account' : `${detail.totals.differences} difference(s), ${detail.totals.unexplained} unexplained` }}
        </span>
        <button v-if="canPrepare && !closed" type="button" class="cw-btn cw-btn--small" :disabled="!!busy" @click="refresh"><RefreshCw :size="15" aria-hidden="true" /> Read the ledger again</button>
      </div>
      <label class="mr-filter"><input v-model="onlyDifferences" type="checkbox" class="cw-check" /> Only accounts that differ</label>
      <div class="cw-table-wrap">
        <p v-if="!detail.lines.length" class="cw-empty"><strong>{{ onlyDifferences ? 'No account differs.' : 'No accounts.' }}</strong>The old package and this ledger agree to the cent.</p>
        <table v-else class="cw-table">
          <thead><tr><th>Ledger account</th><th>Old code(s)</th><th class="num">Old package</th><th class="num">This ledger</th><th class="num">Difference</th><th>Explanation</th></tr></thead>
          <tbody>
            <tr v-for="l in detail.lines" :key="l.id">
              <td><template v-if="l.account_code"><strong>{{ l.account_code }}</strong> {{ l.account_name }}</template><em v-else>No account in this ledger</em></td>
              <td>{{ l.source_codes ?? 'Not in the old package\'s file' }}</td>
              <td class="num">{{ money(l.source_net_debit) }}</td>
              <td class="num">{{ money(l.ledger_net_debit) }}</td>
              <td class="num" :class="{ 'cw-neg': l.differs }">{{ money(l.difference) }}</td>
              <td>
                <form v-if="l.differs && canPrepare && !closed" class="mr-explain" @submit.prevent="explain(l.id)">
                  <input v-model="text[l.id]" class="cw-input" :aria-label="`Explanation for ${l.account_code ?? l.source_codes}`" placeholder="What the difference is" />
                  <button type="submit" class="cw-btn cw-btn--small" :disabled="!!busy || text[l.id].trim() === (l.explanation ?? '') || (text[l.id].trim().length > 0 && text[l.id].trim().length < 3)">Save</button>
                </form>
                <template v-else>{{ l.explanation ?? (l.differs ? 'Not explained' : '') }}</template>
                <div v-if="l.explained_by_name" class="cw-hint">{{ l.explained_by_name }}, {{ formatDateTime(l.explained_at) }}</div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p class="cw-hint">Balances are debit-positive: a credit balance shows with a minus sign.</p>
    </template>
  </div>
</template>

<style scoped>
.mr { display: flex; flex-direction: column; gap: 10px; }
.mr-head { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
.mr-head > div { flex: 1 1 260px; }
.mr-filter { display: inline-flex; align-items: center; gap: 8px; font-size: 13.5px; }
.mr-explain { display: flex; gap: 8px; }
.mr-explain .cw-input { flex: 1; min-width: 160px; }
.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
</style>
