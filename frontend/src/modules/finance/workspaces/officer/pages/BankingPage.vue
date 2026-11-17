<script setup lang="ts">
/**
 * Banking for the finance officer: each bank account's cashbook balance and how far it is
 * reconciled (`GET /finance/bank/accounts`), the bank statements captured and where each stands
 * (`GET /finance/bank/statements`), and the till takings carried to the bank (`GET /finance/cash/deposits`).
 *
 * Capturing a statement and matching it is `finance.bank.reconcile`; preparing a deposit is
 * `finance.cash.deposit.prepare`. The page says which of these the person holds rather than
 * offering a button the server would refuse. Each read is made only with its view permission.
 */
import { computed, onMounted, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { Landmark, RefreshCw, Info } from 'lucide-vue-next'
import { bankApi, type BankPosition, type BankStatement } from '../../../api/bankApi'
import { cashApi } from '../../../api/cashApi'
import type { BankDeposit } from '../../../models/cashTypes'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate } from '../../../composables/useMoney'
import { useFinanceNav } from '../../../shell/useFinanceNav'

const store = useFinanceStore()
const nav = useFinanceNav()
const canBank = computed(() => store.can('finance.bank.view'))
const canCash = computed(() => store.can('finance.cash.view'))
const canReconcile = computed(() => store.can('finance.bank.reconcile'))
const canDeposit = computed(() => store.can('finance.cash.deposit.prepare'))

const positions = ref<BankPosition[]>([])
const statements = ref<BankStatement[]>([])
const deposits = ref<BankDeposit[]>([])
const errors = ref<{ bank?: string; deposits?: string }>({})
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  errors.value = {}
  await Promise.all([
    canBank.value
      ? Promise.all([bankApi.overview(), bankApi.statements()])
        .then(([o, s]) => { positions.value = o.positions; statements.value = s })
        .catch((e) => { errors.value.bank = messageOf(e, 'The bank accounts could not be read.') })
      : Promise.resolve(),
    canCash.value
      ? cashApi.deposits({ limit: 50 }).then((r) => { deposits.value = r.deposits })
        .catch((e) => { errors.value.deposits = messageOf(e, 'The deposits could not be read.') })
      : Promise.resolve(),
  ])
  loading.value = false
}
onMounted(load)

/** The reconciliation screen, if one of the person's workspaces serves it. */
const reconcileLink = computed(() => {
  const r = nav.resolve('cash.banking')
  return r.kind === 'route' ? { name: r.name } : null
})
const STATE: Record<BankStatement['status'], { label: string; cls: string }> = {
  open: { label: 'Being matched', cls: 'cw-pill--warn' },
  reconciled: { label: 'Reconciled', cls: 'cw-pill--pos' },
  cancelled: { label: 'Cancelled', cls: 'cw-pill--mute' },
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Landmark :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Banking</h2><p>What each bank account holds in the cashbook, how far it is reconciled to the bank's statement, and the takings carried to the bank.</p></div>
    <span class="cw-spacer" />
    <button type="button" class="cw-btn cw-btn--outline" :disabled="loading" @click="load()"><RefreshCw :size="18" aria-hidden="true" /> Read again</button>
  </section>

  <p v-if="!canReconcile || !canDeposit" class="cw-banner-msg cw-banner-msg--info" role="status"><Info :size="18" aria-hidden="true" />
    <span>
      <template v-if="!canReconcile">Capturing and matching bank statements is done by whoever holds bank reconciliation (finance.bank.reconcile).</template>
      <template v-if="!canDeposit"> Deposits of till takings are prepared in the Cash Office and posted by the accountant.</template>
      <template v-if="canReconcile && reconcileLink"> <RouterLink :to="reconcileLink" class="cw-link">Open bank reconciliation</RouterLink>.</template>
    </span></p>

  <section class="cw-card" aria-labelledby="bk-acc">
    <div class="cw-card-head"><h3 id="bk-acc">Bank Accounts</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <p v-if="!canBank" class="cw-empty">Your role cannot read the bank accounts (it needs finance.bank.view).</p>
      <p v-else-if="errors.bank" class="cw-empty" role="alert">{{ errors.bank }}</p>
      <div v-else-if="loading && !positions.length" aria-busy="true"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!positions.length" class="cw-empty">No bank account has entries.</p>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th scope="col">Account</th><th scope="col">Currency</th><th scope="col" class="r">Cashbook balance</th><th scope="col">Last entry</th>
          <th scope="col">Reconciled to</th><th scope="col" class="r">Reconciled balance</th><th scope="col" class="r">Unmatched entries</th></tr></thead>
        <tbody>
          <tr v-for="b in positions" :key="b.id + b.currency">
            <td>{{ b.code }} — {{ b.name }}</td><td>{{ b.currency }}</td><td class="r num">{{ formatMoney(b.cashbook_balance, b.currency) }}</td>
            <td>{{ formatDate(b.last_entry) }}</td>
            <td><span v-if="b.reconciled_to">{{ formatDate(b.reconciled_to) }}</span><span v-else class="cw-pill cw-pill--warn">Never reconciled</span></td>
            <td class="r num">{{ b.reconciled_balance === null ? '—' : formatMoney(b.reconciled_balance, b.currency) }}</td>
            <td class="r num">{{ b.unmatched_entries }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section v-if="canBank && !errors.bank" class="cw-card" aria-labelledby="bk-st">
    <div class="cw-card-head"><h3 id="bk-st">Bank Statements</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <p v-if="!statements.length" class="cw-empty">No bank statement has been captured yet.</p>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th scope="col">Account</th><th scope="col">Period</th><th scope="col">Reference</th><th scope="col" class="r">Opening</th><th scope="col" class="r">Closing</th>
          <th scope="col" class="r">Lines unmatched</th><th scope="col">State</th><th scope="col">Captured by</th></tr></thead>
        <tbody>
          <tr v-for="s in statements" :key="s.id">
            <td>{{ s.account_code }} — {{ s.account_name }}</td><td>{{ formatDate(s.from_date) }} to {{ formatDate(s.to_date) }}</td>
            <td>{{ s.statement_ref ?? s.original_filename ?? '—' }}</td>
            <td class="r num">{{ formatMoney(s.opening_balance, s.currency) }}</td><td class="r num">{{ formatMoney(s.closing_balance, s.currency) }}</td>
            <td class="r num">{{ s.lines_unmatched ?? '—' }}</td>
            <td><span class="cw-pill" :class="STATE[s.status].cls">{{ STATE[s.status].label }}</span></td>
            <td>{{ s.imported_by_name ?? '—' }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="cw-card" aria-labelledby="bk-dep">
    <div class="cw-card-head"><h3 id="bk-dep">Deposits from the Tills</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <p v-if="!canCash" class="cw-empty">Your role cannot read the cash office (it needs finance.cash.view).</p>
      <p v-else-if="errors.deposits" class="cw-empty" role="alert">{{ errors.deposits }}</p>
      <p v-else-if="!deposits.length" class="cw-empty">No deposit has been prepared.</p>
      <table v-else class="cw-table dx-compact">
        <thead><tr><th scope="col">Deposit</th><th scope="col">Deposited</th><th scope="col">From</th><th scope="col">To account</th><th scope="col">Slip</th><th scope="col" class="r">Amount</th><th scope="col">Voucher</th></tr></thead>
        <tbody>
          <tr v-for="d in deposits" :key="d.id">
            <td class="num">{{ d.deposit_no }}</td><td>{{ formatDate(d.deposited_on) }}</td><td>{{ d.cash_point_name }}</td>
            <td>{{ d.bank_account_code }} — {{ d.bank_account_name }}</td><td>{{ d.slip_reference }}</td>
            <td class="r num">{{ formatMoney(d.amount, d.currency) }}</td>
            <td><span class="cw-pill" :class="d.voucher_status === 'posted' ? 'cw-pill--pos' : 'cw-pill--warn'">{{ d.voucher_status === 'posted' ? 'Posted' : 'Waiting to be posted' }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
