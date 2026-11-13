<script setup lang="ts">
/**
 * Each bank account's balance in the ledger, from the accounting read
 * (`GET /finance/accounting/dashboard`, finance.ledger.view). Statement matching is not built, so
 * every balance is shown as unreconciled rather than implied to be checked.
 */
import { onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { Landmark, AlertTriangle } from 'lucide-vue-next'
import { accountingApi, type AccountingDashboard } from '../../../api/accountingApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate } from '../../../composables/useMoney'

const store = useFinanceStore()
const banks = ref<AccountingDashboard['banks']>([])
const error = ref<string | null>(null)
const loading = ref(false)
async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try { banks.value = (await accountingApi.dashboard(store.selectedYearId)).banks } catch (err) { error.value = messageOf(err, 'The bank balances could not be read.') } finally { loading.value = false }
}
onMounted(load)
watch(() => store.selectedYearId, load)
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Landmark :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Banking</h2><p>What each bank account holds in the ledger.</p></div>
  </section>
  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ error }}</p>
  <section class="cw-card">
    <div class="cw-card-body cw-table-wrap" style="padding-top: 18px">
      <p class="cw-banner-msg cw-banner-msg--warn" style="margin: 0 0 12px"><AlertTriangle :size="18" aria-hidden="true" />
        Statement matching is not built yet, so these balances are unreconciled. Deposits from the tills are prepared and posted by the accountant.</p>
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!banks.length" class="cw-empty">No bank account has entries.</p>
      <table v-else class="cw-table">
        <thead><tr><th>Account</th><th>Currency</th><th class="r">Ledger balance</th><th>Last entry</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="b in banks" :key="b.id + b.currency">
            <td>{{ b.code }} — {{ b.name }}</td><td>{{ b.currency }}</td><td class="amt">{{ formatMoney(b.balance, b.currency) }}</td>
            <td>{{ formatDate(b.last_entry) }}</td><td><span class="cw-pill cw-pill--warn">Unreconciled</span></td>
          </tr>
        </tbody>
      </table>
      <p class="dx-note">Entries on an account: <RouterLink :to="{ name: 'ofc-ledger' }" class="cw-link">General Ledger</RouterLink></p>
    </div>
  </section>
</template>
