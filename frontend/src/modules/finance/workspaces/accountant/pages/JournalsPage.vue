<script setup lang="ts">
/**
 * The journals register: five queues (to post, my drafts, posted, all, cancelled), each with its count; All leaves out the cancelled ones, and
 * filters on date, type, book, party and text. Paging is the server's. The queue, the filters and
 * the offset live in the route query, so Back and refresh keep the list.
 *
 * Figures are shown as the server sent them; nothing is added here.
 */
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, BookOpenCheck, Info, Plus } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'
import type { VoucherList, VoucherQueues, VoucherQuery, VoucherSummary } from '../../../models/ledgerTypes'
import PartyPicker from '../kit/PartyPicker.vue'
import Pager from '../kit/Pager.vue'
import DateRange from '../kit/DateRange.vue'
import { useLedgerLists } from '../kit/useLedgerLists'
import { useTabKeys } from '../kit/useTabKeys'
import { VOUCHER_TYPE_LABEL } from './voucherLabels'

type Queue = 'to_post' | 'mine' | 'posted' | 'all' | 'cancelled'
const QUEUES: { key: Queue; label: string }[] = [
  { key: 'to_post', label: 'To post' }, { key: 'mine', label: 'My drafts' },
  { key: 'posted', label: 'Posted' }, { key: 'all', label: 'All' }, { key: 'cancelled', label: 'Cancelled' },
]
const LIMIT = 50

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()
const lists = useLedgerLists()

const list = ref<VoucherList | null>(null)
const queues = ref<VoucherQueues | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)
/** The tab chosen for the person when the address names none; kept so a filter does not choose again. */
const chosen = ref<Queue | null>(null)

const q = (key: string): string => {
  const v = route.query[key]
  return typeof v === 'string' ? v : ''
}
const queue = computed<Queue>(() => {
  const named = q('queue')
  return (QUEUES.some((t) => t.key === named) ? named : chosen.value ?? 'to_post') as Queue
})
const offset = computed(() => Math.max(0, Number(q('offset')) || 0))

/** The filters as typed; Apply writes them to the address. */
const draft = reactive({ from: '', to: '', type: '', book: '', party: '', text: '' })
function readDraft(): void {
  Object.assign(draft, { from: q('from'), to: q('to'), type: q('type'), book: q('book'), party: q('party'), text: q('q') })
}

function params(which: Queue, over: Partial<VoucherQuery> = {}): VoucherQuery {
  const p: VoucherQuery = {
    financial_year_id: store.selectedYearId ?? undefined, limit: LIMIT, offset: offset.value, sort: 'posting_date', direction: 'desc',
  }
  if (which === 'to_post' || which === 'mine') p.queue = which
  if (which === 'posted') p.status = 'posted'
  if (which === 'cancelled') p.status = 'cancelled'
  if (q('type')) p.voucher_type = q('type') as VoucherQuery['voucher_type']
  if (q('book')) p.currency = q('book') as VoucherQuery['currency']
  if (q('from')) p.from = q('from')
  if (q('to')) p.to = q('to')
  if (q('party')) p.party_id = q('party')
  if (q('q')) p.q = q('q')
  return { ...p, ...over }
}

/** Each read takes a number; a slower answer for an earlier tab, filter or page is dropped. */
let reqId = 0
async function load(): Promise<void> {
  const seq = ++reqId
  if (!store.selectedYearId) { loading.value = false; return }
  error.value = null
  loading.value = true
  try {
    let which = queue.value
    let got = await ledgerApi.vouchers(params(which))
    if (seq !== reqId) return
    // Nothing named in the address: open on what waits for this person.
    if (!q('queue') && !chosen.value) {
      const c = got.queues
      const pick: Queue = c.to_post > 0 ? 'to_post' : c.mine > 0 ? 'mine' : 'all'
      if (pick !== which) {
        which = pick
        got = await ledgerApi.vouchers(params(which))
        if (seq !== reqId) return
      }
      chosen.value = pick
    }
    list.value = got
    queues.value = got.queues
  } catch (err) {
    if (seq !== reqId) return
    error.value = messageOf(err, 'The journals could not be read.')
  } finally {
    if (seq === reqId) loading.value = false
  }
}

function go(over: Record<string, string | undefined>): void {
  const query: Record<string, string> = {}
  for (const [k, v] of Object.entries({ ...route.query, ...over })) if (typeof v === 'string' && v !== '') query[k] = v
  void router.replace({ query })
}
function pick(t: Queue): void { go({ queue: t, offset: undefined }) }
const onTabKey = useTabKeys(() => QUEUES.map(t => t.key), () => queue.value, pick)
function apply(): void {
  go({ from: draft.from, to: draft.to, type: draft.type, book: draft.book, party: draft.party, q: draft.text.trim(), offset: undefined })
}
function clear(): void {
  Object.assign(draft, { from: '', to: '', type: '', book: '', party: '', text: '' })
  apply()
}
const filtered = computed(() => ['from', 'to', 'type', 'book', 'party', 'q'].some((k) => q(k)))

onMounted(() => {
  readDraft()
  void load()
  if (store.selectedYearId) void lists.loadParties()
})
watch(() => route.query, () => { readDraft(); void load() })
watch(() => store.selectedYearId, () => { chosen.value = null; void load() })

function state(v: VoucherSummary): { label: string; tone: string }[] {
  const out: { label: string; tone: string }[] = []
  if (v.status === 'draft') {
    out.push({ label: 'Draft', tone: 'cw-pill--warn' })
    if (v.debit_total !== v.credit_total) out.push({ label: 'does not balance', tone: 'cw-pill--neg' })
  } else if (v.status === 'posted') out.push({ label: 'Posted', tone: 'cw-pill--pos' })
  else out.push({ label: 'Cancelled', tone: 'cw-pill--mute' })
  if (v.pending_reversal_no) out.push({ label: `reversal ${v.pending_reversal_no} waiting to be posted`, tone: 'cw-pill--warn' })
  if (v.reversed_by_voucher_no) out.push({ label: `reversed by ${v.reversed_by_voucher_no}`, tone: 'cw-pill--mute' })
  if (v.reverses_voucher_no) out.push({ label: `reverses ${v.reverses_voucher_no}`, tone: 'cw-pill--info' })
  return out
}
const countOf = (k: Queue): string => (queues.value ? ` ${queues.value[k]}` : '')
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><BookOpenCheck :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Journals</h2>
      <p>Prepare journals and post the ones others prepared. A posted voucher is corrected by a reversal, never edited.</p>
    </div>
    <RouterLink v-if="store.can('finance.ledger.voucher.prepare')" :to="{ name: 'acc-journal-new' }" class="cw-btn cw-btn--primary"><Plus :size="18" aria-hidden="true" /> New journal</RouterLink>
  </section>

  <section v-if="!store.selectedYearId" class="cw-card">
    <p class="cw-empty"><strong>Choose a financial year in the banner above.</strong>The journals are listed one year at a time.</p>
  </section>

  <template v-else>
    <div class="cw-seg jr-tabs" role="tablist" aria-label="Journal queues" @keydown="onTabKey">
      <button v-for="t in QUEUES" :key="t.key" type="button" role="tab" :id="`jr-tab-${t.key}`" aria-controls="jr-panel" :aria-selected="queue === t.key ? 'true' : 'false'" :tabindex="queue === t.key ? 0 : -1" @click="pick(t.key)">{{ t.label }}{{ countOf(t.key) }}</button>
    </div>

    <div id="jr-panel" role="tabpanel" :aria-labelledby="`jr-tab-${queue}`">
    <form class="cw-card jr-filters" aria-label="Filter the journals" @submit.prevent="apply">
      <DateRange v-model:from="draft.from" v-model:to="draft.to" />
      <div class="cw-field">
        <label class="cw-label" for="jr-type">Type</label>
        <select id="jr-type" v-model="draft.type" class="cw-select">
          <option value="">All types</option>
          <option v-for="(label, type) in VOUCHER_TYPE_LABEL" :key="type" :value="type">{{ label }}</option>
        </select>
      </div>
      <div class="cw-field">
        <label class="cw-label" for="jr-book">Book</label>
        <select id="jr-book" v-model="draft.book" class="cw-select">
          <option value="">Both</option><option value="USD">USD</option><option value="ZWG">ZWG</option>
        </select>
      </div>
      <div class="cw-field jr-party"><PartyPicker v-model="draft.party" :parties="lists.parties.value" label="Party" placeholder="Any party" /></div>
      <div class="cw-field">
        <label class="cw-label" for="jr-text">Search</label>
        <input id="jr-text" v-model="draft.text" class="cw-input" type="search" placeholder="Number, narration or reference" />
      </div>
      <div class="jr-buttons">
        <button type="submit" class="cw-btn cw-btn--primary">Apply</button>
        <button v-if="filtered" type="button" class="cw-btn" @click="clear">Clear filters</button>
      </div>
    </form>

    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

    <CwSkeleton v-if="loading" label="the journals" />

    <section v-else-if="list && !list.vouchers.length" class="cw-card">
      <p class="cw-empty"><strong>{{ filtered ? 'No journal matches these filters.' : queue === 'cancelled' ? 'No draft has been cancelled in this year.' : 'There are no journals in this list.' }}</strong>
        <template v-if="filtered">Clear the filters or choose another tab.</template>
        <template v-else-if="queue === 'cancelled'">A draft its preparer cancels is kept here with its number and the reason.</template>
        <template v-else-if="store.can('finance.ledger.voucher.prepare')">Use New journal to prepare one.</template>
        <template v-else>Journals prepared by others appear here.</template></p>
    </section>

    <section v-else-if="list" class="cw-card" aria-label="Journals">
      <p v-if="queue === 'to_post' && !store.can('finance.ledger.voucher.post')" class="cw-banner-msg cw-banner-msg--info"><Info :size="18" aria-hidden="true" />Holders of the posting permission post these.</p>
      <div class="cw-card-body cw-table-wrap">
        <table class="cw-table">
          <caption class="sr-only">Journals, {{ QUEUES.find(t => t.key === queue)?.label }}</caption>
          <thead><tr>
            <th>Number</th><th>Type</th><th>Date</th><th>Book</th><th class="r">Debits</th><th class="r">Credits</th><th>State</th><th>Prepared by</th><th>Posted by</th>
          </tr></thead>
          <tbody>
            <tr v-for="v in list.vouchers" :key="v.id">
              <th scope="row"><RouterLink class="cw-link" :to="{ name: 'acc-voucher', params: { id: v.id } }">{{ v.voucher_no }}</RouterLink>
                <div v-if="v.narration" class="cw-hint">{{ v.narration }}</div>
                <div v-if="v.status === 'cancelled'" class="cw-hint">Cancelled<template v-if="v.cancelled_at"> on {{ formatDate(v.cancelled_at) }}</template>: {{ v.cancel_reason ?? 'no reason recorded' }}</div></th>
              <td>{{ VOUCHER_TYPE_LABEL[v.voucher_type] ?? v.voucher_type }}</td>
              <td>{{ formatDate(v.posting_date) }}</td>
              <td>{{ v.currency }}</td>
              <td class="amt">{{ formatMoney(v.debit_total, v.currency, { bare: true }) }}</td>
              <td class="amt">{{ formatMoney(v.credit_total, v.currency, { bare: true }) }}</td>
              <td><span v-for="s in state(v)" :key="s.label" class="cw-pill" :class="s.tone">{{ s.label }}</span></td>
              <td>{{ v.prepared_by_name ?? '—' }}</td>
              <td>{{ v.posted_by_name ?? '—' }}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div class="cw-card-body"><Pager :total="list.total" :limit="LIMIT" :offset="offset" @update:offset="(o) => go({ offset: o ? String(o) : undefined })" /></div>
    </section>
    </div>
  </template>
</template>

<style scoped>
.jr-tabs { margin: 12px 0; }
.jr-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-end; padding: 14px 16px; margin-bottom: 12px; }
.jr-filters .cw-field { min-width: 150px; }
.jr-party { min-width: 220px; flex: 1; }
.jr-buttons { display: flex; gap: 8px; }
.cw-pill { margin-right: 4px; }
@media (max-width: 640px) { .jr-tabs { grid-auto-flow: row; grid-template-columns: 1fr 1fr; } }
</style>
