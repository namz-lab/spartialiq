<script setup lang="ts">
/**
 * Audit sample selection from the transaction register (`GET /finance/transactions`).
 *
 * The auditor defines a population (year, one currency, side, dates, words, department), reads how
 * many transactions are in it, and draws a sample from a seed: random without replacement, or
 * systematic from a random start. Each sampled item is read from the register by its position in
 * the register's stable order (date, then id), so the same seed over the same population gives the
 * same items. The seed and the population are shown to be copied into the working papers.
 *
 * One currency at a time (decision D4): a population that mixed USD and ZWG would be sampled by
 * count across two books. The sample is not stored by the server; see the report's backend gaps.
 */
import { computed, reactive, ref, watch } from 'vue'
import { Dices, AlertTriangle, Printer, Users } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import type { Currency, FinanceTransaction, TransactionQuery } from '../../../models/types'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatDateTime, formatMoney } from '../../../composables/useMoney'
import { MAX_SAMPLE, newSeed, samplePositions, type SampleMethod } from '../sampling'

const store = useFinanceStore()
const pop = reactive({
  currency: (store.selectedYear?.reporting_currency ?? 'USD') as Currency,
  kind: '' as '' | 'revenue' | 'expenditure',
  department_id: '', from: '', to: '', q: '',
})
const size = ref(25)
const method = ref<SampleMethod>('random')
const seed = ref(newSeed())

const total = ref<number | null>(null)
const counting = ref(false)
const drawing = ref(false)
const error = ref<string | null>(null)
interface Drawn { position: number; row: FinanceTransaction | null }
const sample = ref<Drawn[]>([])
const drawnAt = ref<string | null>(null)
const counterparty = ref(false)

function query(): TransactionQuery {
  return {
    financial_year_id: store.selectedYearId ?? '', currency: pop.currency,
    kind: pop.kind || undefined, department_id: pop.department_id || undefined,
    from: pop.from || undefined, to: pop.to || undefined, q: pop.q.trim() || undefined,
    sort: 'txn_date', direction: 'asc', reversals: 'exclude',
  }
}
const definition = computed(() => {
  const parts = [store.selectedYear?.label ?? 'no year', pop.currency, pop.kind ? `${pop.kind} only` : 'revenue and expenditure']
  const dept = store.departments.find((d) => d.id === pop.department_id)
  if (dept) parts.push(`department ${dept.code} ${dept.name}`)
  if (pop.from || pop.to) parts.push(`dated ${pop.from || 'year start'} to ${pop.to || 'year end'}`)
  if (pop.q.trim()) parts.push(`matching "${pop.q.trim()}"`)
  parts.push('reversals excluded, ordered by date then id')
  return parts.join('; ')
})

// A changed population invalidates the count and any sample drawn from it.
watch([() => ({ ...pop }), () => store.selectedYearId], () => { total.value = null; sample.value = []; drawnAt.value = null }, { deep: true })

async function count(): Promise<void> {
  if (!store.selectedYearId) return
  counting.value = true
  error.value = null
  try {
    const r = await financeApi.transactions({ ...query(), limit: 1, offset: 0 })
    total.value = r.total
    counterparty.value = r.counterparty_visible
  } catch (err) { error.value = messageOf(err, 'The population could not be read.') } finally { counting.value = false }
}

async function draw(): Promise<void> {
  if (total.value === null || drawing.value) return
  drawing.value = true
  error.value = null
  const positions = samplePositions(total.value, Math.min(size.value, MAX_SAMPLE), seed.value, method.value)
  const out: Drawn[] = positions.map((position) => ({ position, row: null }))
  try {
    for (let i = 0; i < out.length; i += 6) {
      await Promise.all(out.slice(i, i + 6).map(async (d) => {
        const r = await financeApi.transactions({ ...query(), limit: 1, offset: d.position })
        d.row = r.transactions[0] ?? null
        if (r.total !== total.value) throw new Error('changed')
      }))
    }
    sample.value = out
    drawnAt.value = new Date().toISOString()
  } catch (err) {
    error.value = (err as Error).message === 'changed'
      ? 'The register changed while the sample was being drawn. Read the population again and redraw.'
      : messageOf(err, 'The sample could not be drawn.')
    sample.value = []
  } finally { drawing.value = false }
}
function print(): void { window.print() }
const sizeValid = computed(() => size.value >= 1 && size.value <= MAX_SAMPLE)
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Dices :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Sample Selection</h2>
      <p>Define a population from the transaction register, then draw a reproducible sample from a seed.</p>
    </div>
  </section>

  <p v-if="!store.selectedYearId" class="cw-banner-msg cw-banner-msg--warn" role="status"><AlertTriangle :size="18" aria-hidden="true" />Choose a financial year first.</p>

  <form v-else class="cw-card cw-card-body sm-form" aria-label="Population" @submit.prevent="count">
    <label class="cw-field"><span class="cw-label">Currency</span>
      <select v-model="pop.currency" class="cw-input"><option value="USD">USD</option><option value="ZWG">ZWG</option></select></label>
    <label class="cw-field"><span class="cw-label">Side</span>
      <select v-model="pop.kind" class="cw-input"><option value="">Revenue and expenditure</option><option value="revenue">Revenue</option><option value="expenditure">Expenditure</option></select></label>
    <label class="cw-field"><span class="cw-label">Department</span>
      <select v-model="pop.department_id" class="cw-input"><option value="">All departments</option>
        <option v-for="d in store.departments" :key="d.id" :value="d.id">{{ d.code }} {{ d.name }}</option></select></label>
    <label class="cw-field"><span class="cw-label">From</span><input v-model="pop.from" type="date" class="cw-input" /></label>
    <label class="cw-field"><span class="cw-label">To</span><input v-model="pop.to" type="date" class="cw-input" /></label>
    <label class="cw-field"><span class="cw-label">Description or reference contains</span><input v-model="pop.q" class="cw-input" maxlength="200" /></label>
    <div class="sm-acts"><button type="submit" class="cw-btn cw-btn--primary" :disabled="counting"><Users :size="17" aria-hidden="true" /> {{ counting ? 'Reading…' : 'Read population' }}</button></div>
    <p class="cw-hint sm-full">Population: {{ definition }}.</p>
  </form>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <form v-if="total !== null" class="cw-card cw-card-body sm-form" aria-label="Sample" @submit.prevent="draw">
    <p class="sm-full sm-pop"><strong class="num">{{ total }}</strong> transactions in the population.</p>
    <template v-if="total">
      <label class="cw-field"><span class="cw-label">Sample size (1 to {{ MAX_SAMPLE }})</span>
        <input v-model.number="size" type="number" min="1" :max="MAX_SAMPLE" class="cw-input" :class="{ 'is-invalid': !sizeValid }" /></label>
      <label class="cw-field"><span class="cw-label">Method</span>
        <select v-model="method" class="cw-input"><option value="random">Random, without replacement</option><option value="systematic">Systematic, from a random start</option></select></label>
      <label class="cw-field"><span class="cw-label">Seed</span>
        <span class="sm-seed"><input v-model.number="seed" type="number" min="0" class="cw-input" /><button type="button" class="cw-btn cw-btn--small" @click="seed = newSeed()">New seed</button></span></label>
      <div class="sm-acts"><button type="submit" class="cw-btn cw-btn--primary" :disabled="drawing || !sizeValid"><Dices :size="17" aria-hidden="true" /> {{ drawing ? 'Drawing…' : 'Draw sample' }}</button></div>
    </template>
    <p v-else class="cw-empty sm-full">Nothing to sample. Widen the population.</p>
  </form>

  <section v-if="sample.length" class="cw-card sm-result" aria-labelledby="sm-res">
    <div class="cw-card-head"><h3 id="sm-res">Sample of {{ sample.length }} from {{ total }}</h3><span class="cw-spacer" />
      <button type="button" class="cw-btn cw-btn--small" @click="print"><Printer :size="15" aria-hidden="true" /> Print</button></div>
    <div class="cw-card-body cw-table-wrap">
      <dl class="sm-def">
        <dt>Population</dt><dd>{{ definition }}</dd>
        <dt>Method</dt><dd>{{ method === 'random' ? 'Random, without replacement' : 'Systematic, from a random start' }}</dd>
        <dt>Seed</dt><dd class="num">{{ seed }}</dd>
        <dt>Drawn</dt><dd>{{ formatDateTime(drawnAt) }}</dd>
      </dl>
      <table class="cw-table dx-compact">
        <caption class="sr-only">Sampled transactions</caption>
        <thead><tr><th scope="col" class="r">Item</th><th scope="col" class="r">Position</th><th scope="col">Date</th><th scope="col">Reference</th><th scope="col">Description</th><th scope="col">Account</th><th scope="col">Department</th>
          <th v-if="counterparty" scope="col">Counterparty</th><th scope="col" class="r">Amount</th></tr></thead>
        <tbody>
          <tr v-for="(d, i) in sample" :key="d.position">
            <td class="r num">{{ i + 1 }}</td><td class="r num">{{ d.position + 1 }}</td>
            <template v-if="d.row">
              <td>{{ formatDate(d.row.txn_date) }}</td><td>{{ d.row.reference ?? '—' }}</td><td class="dx-wrap">{{ d.row.description ?? '—' }}</td>
              <td>{{ d.row.account_code }} {{ d.row.account_name }}</td><td>{{ d.row.department_code ?? '—' }}</td>
              <td v-if="counterparty">{{ d.row.counterparty_name ?? '—' }}</td>
              <td class="r num">{{ formatMoney(d.row.amount, d.row.currency) }}</td>
            </template>
            <td v-else :colspan="counterparty ? 7 : 6" class="cw-hint">Not returned by the register.</td>
          </tr>
        </tbody>
      </table>
      <p class="dx-note">Copy the population, method and seed into the working papers. Drawing again with the same seed over the same population gives the same items while the register is unchanged. The sample is not stored by the system.</p>
    </div>
  </section>
</template>

<style scoped>
.sm-form { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px 16px; padding-top: 16px; align-items: end; }
.sm-full { grid-column: 1 / -1; margin: 0; }
.sm-pop { font-size: 15px; }
.sm-acts { display: flex; gap: 8px; }
.sm-seed { display: flex; gap: 8px; align-items: center; }
.sm-def { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 16px; margin: 0 0 14px; }
.sm-def dt { font-weight: 600; }
.sm-def dd { margin: 0; }
</style>
