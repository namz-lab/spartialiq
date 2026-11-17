<script setup lang="ts">
/**
 * Cash and bank position for the accounting officer (`GET /finance/ledger/cash-accounts`): each
 * bank and cash account's balance in the posted ledger at the year end (or today, within the open
 * year), when it was last reconciled and what is not yet matched to a statement. One table per
 * currency; nothing is added across currencies, and no total is computed in the browser.
 * Read-only: reconciling is the accountant's work.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { Landmark, AlertTriangle } from 'lucide-vue-next'
import { ledgerApi } from '../../../api/ledgerApi'
import type { CashAccountRow } from '../../../models/ledgerTypes'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatMoney } from '../../../composables/useMoney'

const store = useFinanceStore()
const rows = ref<CashAccountRow[]>([])
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  const year = store.selectedYearId
  if (!year) return
  loading.value = true
  error.value = null
  try { rows.value = (await ledgerApi.cashAccounts(year)).accounts } catch (err) {
    error.value = messageOf(err, 'The cash and bank position could not be read.')
    rows.value = []
  } finally { loading.value = false }
}
onMounted(load)
watch(() => store.selectedYearId, load)

const first = computed(() => store.selectedYear?.reporting_currency ?? 'USD')
const currencies = computed(() => [...new Set(rows.value.map((r) => r.currency))].sort((a, b) => Number(b === first.value) - Number(a === first.value) || a.localeCompare(b)))
/** A bank or cash account in credit is overdrawn; said in words, not only by a sign. */
const balanceText = (r: CashAccountRow) => `${formatMoney(r.balance.amount, r.currency)}${r.balance.side === 'Cr' && !/^[-+]?0*(\.0*)?$/.test(r.balance.amount) ? ' overdrawn' : ''}`
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Landmark :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Cash and Bank</h2>
      <p>Each bank and cash account's balance in the posted ledger, {{ store.selectedYear?.label ?? '' }}, and how far it is reconciled.</p></div>
  </section>

  <p v-if="!store.selectedYearId" class="cw-banner-msg cw-banner-msg--warn" role="status"><AlertTriangle :size="18" aria-hidden="true" />Choose a financial year.</p>
  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>
  <div v-if="loading" class="cw-card cw-card-body" style="padding-top: 18px"><span class="cw-skel" /><span class="cw-skel" /></div>
  <p v-else-if="store.selectedYearId && !error && !rows.length" class="cw-empty">No bank or cash account is set up in the chart of accounts.</p>

  <section v-for="c in currencies" :key="c" class="cw-card" :aria-labelledby="`cp-${c}`">
    <div class="cw-card-head"><h3 :id="`cp-${c}`">{{ c }} accounts</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <table class="cw-table dx-compact">
        <caption class="sr-only">{{ c }} bank and cash accounts</caption>
        <thead><tr><th scope="col">Account</th><th scope="col">Type</th><th scope="col" class="r">Ledger balance</th><th scope="col">Last entry</th>
          <th scope="col">Reconciled to</th><th scope="col" class="r">Not yet matched</th></tr></thead>
        <tbody>
          <tr v-for="r in rows.filter((x) => x.currency === c)" :key="r.id">
            <td><strong>{{ r.code }}</strong> {{ r.name }}</td>
            <td>{{ r.account_type === 'bank' ? 'Bank' : 'Cash' }}</td>
            <td class="r num">{{ balanceText(r) }}</td>
            <td>{{ formatDate(r.last_entry) }}</td>
            <td>{{ r.account_type === 'cash' ? 'Not applicable' : r.reconciled_to ? `${formatDate(r.reconciled_to)} (${formatMoney(r.reconciled_balance, c)})` : 'Never reconciled' }}</td>
            <td class="r num">{{ r.unreconciled ? `${r.unreconciled.entries} entries` : '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
  <p v-if="rows.length" class="dx-note">Balances are from the posted ledger. A bank balance not reconciled to a statement is the council's record, not yet the bank's.</p>
</template>
