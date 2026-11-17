<script setup lang="ts">
/**
 * The collection list: who owes rates, how much, and how old the oldest bill is, narrowed by ward,
 * age and currency so it can be handed to whoever does the follow-up. Above it, the age analysis
 * per currency, and whether the arrears still agree with the receivable control account.
 *
 * Every figure is the server's (`GET /finance/rates/arrears`, finance.rates.view), which reads the
 * same view as the ledger's debtor ageing, so this list and the books cannot tell different
 * stories. Nothing is summed here: the per-currency buckets come back already totalled, and a
 * figure is never added across USD and ZWG.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ListChecks, Download, AlertTriangle, CircleCheck, Search } from 'lucide-vue-next'
import { ratesApi } from '../../../api/ratesApi'
import { messageOf } from '../../../stores/finance'
import { formatMoney, formatDate, type Currency } from '../../../composables/useMoney'
import type { AgeingBucket } from '../../../models/ledgerTypes'
import type { ArrearsAccount, RatesArrears } from '../../../models/ratesTypes'
import { OWING_BUCKETS, downloadCsv, readAll, toCsv } from '../kit'

const PAGE = 50
const filters = reactive({ q: '', ward_code: '', bucket: '' as AgeingBucket | '', currency: '' as Currency | '' })
const offset = ref(0)
const data = ref<RatesArrears | null>(null)
const loading = ref(false)
const exporting = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const params = () => ({
  q: filters.q.trim() || undefined,
  ward_code: filters.ward_code.trim() || undefined,
  bucket: filters.bucket || undefined,
  currency: filters.currency || undefined,
})

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await ratesApi.arrears({ ...params(), limit: PAGE, offset: offset.value })
  } catch (err) {
    error.value = messageOf(err, 'The arrears could not be read.')
  } finally {
    loading.value = false
  }
}
onMounted(load)

let timer: ReturnType<typeof setTimeout> | undefined
watch(() => [filters.q, filters.ward_code], () => {
  clearTimeout(timer)
  timer = setTimeout(() => { offset.value = 0; void load() }, 300)
})
watch(() => [filters.bucket, filters.currency], () => { offset.value = 0; void load() })

const accounts = computed<ArrearsAccount[]>(() => data.value?.accounts ?? [])
const total = computed(() => data.value?.total ?? 0)
const books = computed(() => (data.value?.books ?? []).map((b) => ({
  currency: b.currency,
  buckets: b.buckets.filter((x) => x.bucket !== 'settled'),
})))
const unreconciled = computed(() => (data.value?.reconciliation ?? []).filter((r) => !r.reconciles))

function page(dir: 1 | -1): void {
  const next = offset.value + dir * PAGE
  if (next < 0 || next >= total.value) return
  offset.value = next
  void load()
}

async function exportCsv(): Promise<void> {
  exporting.value = true
  error.value = null
  notice.value = null
  try {
    const all = await readAll(async (limit, off) => {
      const r = await ratesApi.arrears({ ...params(), limit, offset: off })
      return { rows: r.accounts, total: r.total }
    })
    const head = ['Account No', 'Ratepayer', 'Stand No', 'Parcel', 'Ward', 'Currency', 'Owed', 'Unallocated credit', 'Balance', 'Open bills', 'Oldest (days)']
    const rows = all.rows.map((a) => [a.account_no, a.party_name, a.stand_no, a.parcel_id, a.ward_code, a.currency,
      a.owed, a.unallocated_credit, a.balance, a.open_bills, a.oldest_days])
    downloadCsv(`collection-list-${data.value?.as_at ?? 'today'}.csv`, toCsv(head, rows))
    if (all.truncated) notice.value = `The export holds the first ${all.rows.length} of ${all.total} accounts. Narrow the list to export the rest.`
  } catch (err) {
    error.value = messageOf(err, 'The collection list could not be exported.')
  } finally {
    exporting.value = false
  }
}

const ageTone = (days: number | null): string => (days === null ? '' : days > 180 ? 'cw-neg' : '')
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><ListChecks :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Collection List</h2>
      <p>Who owes rates, how much and for how long, by ward and age, ready to hand on for follow-up.</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <p v-if="notice" class="cw-banner-msg cw-banner-msg--info" role="status">{{ notice }}</p>
  <p v-for="r in unreconciled" :key="r.currency" class="cw-banner-msg cw-banner-msg--warn" role="status">
    <AlertTriangle :size="18" aria-hidden="true" />
    The {{ r.currency }} debtor ageing differs from the receivable control account by {{ formatMoney(r.ledger_difference, r.currency) }}.
    The list below is what the ledger holds; the accountant reconciles the difference.
  </p>

  <section class="cw-card" aria-labelledby="cl-age">
    <div class="cw-card-head">
      <h3 id="cl-age">Age analysis</h3>
      <span class="cw-spacer" />
      <span v-if="data" class="cw-hint">As at {{ formatDate(data.as_at) }}</span>
    </div>
    <div class="cw-card-body cw-table-wrap">
      <div v-if="loading && !data"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!books.length" class="cw-empty">Nothing is owed on any rates account.</p>
      <table v-for="b in books" v-else :key="b.currency" class="cw-table cl-age">
        <caption class="cl-caption">{{ b.currency }}</caption>
        <thead><tr><th>Age</th><th class="r">Documents</th><th class="r">Outstanding</th></tr></thead>
        <tbody>
          <tr v-for="x in b.buckets" :key="x.bucket">
            <td>{{ x.label }}</td><td class="r num">{{ x.documents }}</td>
            <td class="r num" :class="{ 'cw-neg': x.outstanding.startsWith('-') }">{{ formatMoney(x.outstanding, b.currency) }}</td>
          </tr>
        </tbody>
      </table>
      <p v-for="r in data?.reconciliation.filter((x) => x.reconciles) ?? []" :key="r.currency" class="cw-hint cl-ok">
        <CircleCheck :size="15" aria-hidden="true" /> {{ r.currency }}: agrees with the receivable control account.
      </p>
    </div>
  </section>

  <section class="cw-card" aria-labelledby="cl-list">
    <div class="cw-card-head">
      <h3 id="cl-list">Accounts in arrears</h3>
      <span class="cw-spacer" />
      <button type="button" class="cw-btn cw-btn--outline cw-btn--small" :disabled="!total || exporting" @click="exportCsv">
        <Download :size="16" aria-hidden="true" /> {{ exporting ? 'Exporting' : 'Export CSV' }}
      </button>
    </div>
    <div class="cw-card-body">
      <form class="cl-filters" role="search" @submit.prevent="load">
        <label class="cw-field cl-grow"><span class="cw-label">Search</span>
          <span class="cl-search"><Search :size="16" aria-hidden="true" />
            <input v-model="filters.q" class="cw-input" type="search" placeholder="Account, ratepayer or stand number" /></span>
        </label>
        <label class="cw-field"><span class="cw-label">Ward</span><input v-model="filters.ward_code" class="cw-input" maxlength="24" /></label>
        <label class="cw-field"><span class="cw-label">Has a bill aged</span>
          <select v-model="filters.bucket" class="cw-input">
            <option value="">Any age</option>
            <option v-for="b in OWING_BUCKETS" :key="b.value" :value="b.value">{{ b.label }}</option>
          </select>
        </label>
        <label class="cw-field"><span class="cw-label">Currency</span>
          <select v-model="filters.currency" class="cw-input"><option value="">Both</option><option>USD</option><option>ZWG</option></select>
        </label>
      </form>

      <div class="cw-table-wrap">
        <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /><span class="cw-skel" /></div>
        <p v-else-if="!accounts.length" class="cw-empty">No account matches.</p>
        <table v-else class="cw-table">
          <thead>
            <tr><th>Account</th><th>Ratepayer</th><th>Stand</th><th>Ward</th><th class="r">Owed</th><th class="r">Credit</th>
              <th class="r">Balance</th><th class="r">Open bills</th><th class="r">Oldest</th><th><span class="sr-only">Statement</span></th></tr>
          </thead>
          <tbody>
            <tr v-for="a in accounts" :key="a.rates_account_id + a.currency">
              <td class="num">{{ a.account_no }}</td><td>{{ a.party_name }}</td><td>{{ a.stand_no ?? '—' }}</td><td>{{ a.ward_code ?? '—' }}</td>
              <td class="r num">{{ formatMoney(a.owed, a.currency) }}</td>
              <td class="r num">{{ a.unallocated_credit === '0.00' ? '—' : formatMoney(a.unallocated_credit, a.currency) }}</td>
              <td class="r num">{{ formatMoney(a.balance, a.currency) }}</td>
              <td class="r num">{{ a.open_bills }}</td>
              <td class="r num" :class="ageTone(a.oldest_days)">{{ a.oldest_days === null ? '—' : `${a.oldest_days} days` }}</td>
              <td><RouterLink class="cw-link" :to="{ name: 'rev-statement', params: { id: a.rates_account_id } }">Statement<span class="sr-only"> for {{ a.account_no }}</span></RouterLink></td>
            </tr>
          </tbody>
        </table>
      </div>
      <nav v-if="total > PAGE" class="cl-pager" aria-label="Pages">
        <button type="button" class="cw-btn cw-btn--outline cw-btn--small" :disabled="offset === 0 || loading" @click="page(-1)">Previous</button>
        <span class="cw-hint">{{ offset + 1 }} to {{ Math.min(offset + PAGE, total) }} of {{ total }}</span>
        <button type="button" class="cw-btn cw-btn--outline cw-btn--small" :disabled="offset + PAGE >= total || loading" @click="page(1)">Next</button>
      </nav>
      <p v-if="data?.note" class="cw-hint cl-note">{{ data.note }}</p>
    </div>
  </section>
</template>

<style scoped>
.cl-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; margin-bottom: 14px; }
.cl-filters .cw-field { min-width: 150px; }
.cl-grow { flex: 1 1 260px; }
.cl-search { position: relative; display: flex; align-items: center; }
.cl-search svg { position: absolute; left: 10px; color: var(--cw-ink-2); }
.cl-search input { padding-left: 32px; }
.cl-age { margin-bottom: 14px; }
.cl-caption { text-align: left; font-weight: 700; padding: 0 0 6px; color: var(--cw-ink); }
.cl-ok { display: flex; align-items: center; gap: 6px; margin: 4px 0 0; }
.cl-pager { display: flex; gap: 12px; align-items: center; justify-content: flex-end; margin-top: 12px; }
.cl-note { margin-top: 12px; }
</style>
