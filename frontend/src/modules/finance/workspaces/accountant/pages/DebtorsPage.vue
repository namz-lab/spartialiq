<script setup lang="ts">
/**
 * Debtors: what is owed to the council, by party and by age, in one book at a time. Every figure is
 * the server's, as sent. The reconciliation against the receivable control account is the
 * server's comparison; a difference is shown as an alert, in words.
 */
import CwSkeleton from '../kit/CwSkeleton.vue'
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, CircleCheck, Users } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'
import type { Currency } from '../../../models/types'
import type { AgeingBucket, DebtorAgeingResult } from '../../../models/ledgerTypes'
import BookSwitch from '../kit/BookSwitch.vue'
import '../kit/statement.css'

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()

const BUCKETS: { key: AgeingBucket; label: string }[] = [
  { key: 'current', label: 'Current' }, { key: '31_60', label: '31 to 60 days' }, { key: '61_90', label: '61 to 90 days' },
  { key: '91_180', label: '91 to 180 days' }, { key: '181_365', label: '181 to 365 days' }, { key: 'over_365', label: 'Over 365 days' },
]

const book = computed<Currency>(() => {
  const b = route.query.book
  if (b === 'USD' || b === 'ZWG') return b
  return store.selectedYear?.reporting_currency ?? 'USD'
})

const result = ref<DebtorAgeingResult | null>(null)
const loadedBook = ref<Currency>(book.value)
const loading = ref(true)
const error = ref<string | null>(null)

/** Only the latest request may touch the page: a slow earlier answer is dropped. */
let reqId = 0
async function load(): Promise<void> {
  if (route.name !== 'acc-receivable') return
  const seq = ++reqId
  if (!store.selectedYearId) { loading.value = false; return }
  error.value = null
  loading.value = true
  try {
    const asked = book.value
    const res = await ledgerApi.debtorAgeing({ currency: asked, outstanding_only: true, limit: 500 })
    if (seq !== reqId) return
    result.value = res
    loadedBook.value = asked
  } catch (err) {
    if (seq !== reqId) return
    result.value = null
    error.value = messageOf(err, 'The debtors could not be read.')
  } finally {
    if (seq === reqId) loading.value = false
  }
}
onMounted(() => { void load() })
watch(() => [store.selectedYearId, book.value].join('|'), () => { void load() })

function setBook(c: Currency): void { void router.replace({ query: { ...route.query, book: c } }) }

/** The book the figures were sent in; the headings and links follow the response, not the switch. */
const shown = computed<Currency>(() => loadedBook.value)
/** The server lists at most this many debtors per book. */
const PARTY_CAP = 200
const capped = computed(() => parties.value.length >= PARTY_CAP)
const unlisted = computed(() => !parties.value.length && !!recon.value && Number(recon.value.ageing_total) !== 0)
const parties = computed(() => (result.value?.by_party ?? []).filter(p => p.currency === shown.value))
const cell = (partyId: string | null, bucket: AgeingBucket): string | null =>
  result.value?.by_party_bucket?.find(r => r.currency === shown.value && r.party_id === partyId && r.ageing_bucket === bucket)?.outstanding_amount ?? null
const bucketTotal = (bucket: AgeingBucket): string | null =>
  result.value?.by_bucket.find(r => r.currency === shown.value && r.ageing_bucket === bucket)?.outstanding_amount ?? null
const recon = computed(() => result.value?.reconciliation.find(r => r.currency === shown.value) ?? null)
const money = (v: string | null): string => (v === null ? '' : formatMoney(v, shown.value, { bare: true }))
const labelOf = (key: AgeingBucket, fallback: string): string => result.value?.buckets?.find(b => b.key === key)?.label ?? fallback
const hasUnallocated = computed(() => !!result.value?.by_party_bucket?.some(r => r.currency === shown.value && r.ageing_bucket === 'unallocated'))
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Users :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Debtors</h2>
      <p>What ratepayers and other debtors owe the council, and for how long, from the posted ledger. Open a debtor for the statement of account.</p>
    </div>
  </section>

  <section v-if="!store.selectedYearId" class="cw-card">
    <p class="cw-empty"><strong>Choose a financial year in the banner above.</strong>Debtors are read once a financial year is chosen.</p>
  </section>

  <template v-else>
    <section class="cw-card db-toolbar" aria-label="Book">
      <BookSwitch :model-value="book" label="Book" @update:model-value="setBook" />
      <span v-if="result" class="cw-hint">Aged as at {{ formatDate(result.as_at) }}, {{ shown }} book.</span>
    </section>

    <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

    <CwSkeleton v-if="loading" label="the debtors" />

    <template v-else-if="result">
      <p v-if="recon && recon.agrees" class="cw-banner-msg"><CircleCheck :size="18" aria-hidden="true" />Agrees with the control account {{ recon.control_codes ?? '' }}.</p>
      <p v-else-if="recon" class="cw-banner-msg cw-banner-msg--neg"><AlertTriangle :size="18" aria-hidden="true" />Differs from the control account {{ recon.control_codes ?? '' }} by {{ formatMoney(recon.difference, shown) }}.</p>

      <section v-if="unlisted" class="cw-card">
        <p class="cw-empty" role="alert"><strong>The debtors in this book could not be listed.</strong>The control account shows {{ formatMoney(recon!.ageing_total, shown) }} owed, but no debtor rows came back. Reload the page, or choose the other book.</p>
      </section>

      <section v-else-if="!parties.length" class="cw-card">
        <p class="cw-empty"><strong>Nobody owes the council in the {{ shown }} book.</strong>Debts appear here once a bill is posted to a receivable account. Choose the other book to see its debtors.</p>
      </section>

      <section v-else class="cw-card" aria-label="Debtors by age">
        <p v-if="capped" class="cw-hint" style="padding: 12px 16px 0">The {{ parties.length }} largest debtors are listed; the totals row covers every debtor in this book.</p>
        <div class="cw-card-body cw-table-wrap">
          <table class="st-table db-table">
            <caption class="db-caption">{{ shown }} book, aged as at {{ formatDate(result.as_at) }}</caption>
            <thead><tr>
              <th>Debtor</th>
              <th v-for="b in BUCKETS" :key="b.key" class="st-num">{{ labelOf(b.key, b.label) }}</th>
              <th v-if="hasUnallocated" class="st-num">Unallocated receipts</th>
              <th class="st-num">Total</th>
            </tr></thead>
            <tbody>
              <tr v-for="p in parties" :key="p.party_id ?? 'none'">
                <th scope="row">
                  <RouterLink v-if="p.party_id" class="cw-link" :to="{ name: 'acc-debtor', params: { partyId: p.party_id }, query: { book: shown } }">{{ p.party_name ?? 'Unnamed debtor' }}</RouterLink>
                  <span v-else>No party recorded</span>
                  <div v-if="p.party_reference" class="cw-hint">{{ p.party_reference }}</div>
                </th>
                <td v-for="b in BUCKETS" :key="b.key" class="st-num">{{ money(cell(p.party_id, b.key)) }}</td>
                <td v-if="hasUnallocated" class="st-num">{{ money(cell(p.party_id, 'unallocated')) }}</td>
                <td class="st-num"><strong>{{ money(p.outstanding_amount) }}</strong></td>
              </tr>
              <tr class="st-total">
                <th scope="row">All debtors</th>
                <td v-for="b in BUCKETS" :key="b.key" class="st-num">{{ money(bucketTotal(b.key)) }}</td>
                <td v-if="hasUnallocated" class="st-num">{{ money(bucketTotal('unallocated')) }}</td>
                <td class="st-num">{{ recon ? money(recon.ageing_total) : '' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </template>
  </template>
</template>

<style scoped>
.db-toolbar { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: center; padding: 14px 16px; margin-bottom: 12px; }
.db-caption { text-align: left; padding: 10px 12px; font-size: 12.5px; color: var(--cw-ink-3); caption-side: top; }
.db-table { min-width: 860px; }
</style>
