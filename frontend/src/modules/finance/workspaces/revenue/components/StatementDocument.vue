<script setup lang="ts">
/**
 * A ratepayer's statement as it is handed over or posted: the account, each bill with what is still
 * open and how old it is, each payment, and the balance per currency. On screen and on paper alike.
 *
 * The figures are the server's strings (`GET /finance/rates/accounts/:id`); nothing is added here,
 * and the balance is never one figure across USD and ZWG.
 */
import { formatMoney, formatDate } from '../../../composables/useMoney'
import type { RatesStatement } from '../../../models/ratesTypes'
import { bucketLabel } from '../kit'

defineProps<{ statement: RatesStatement; asAt: string }>()

const METHOD: Record<string, string> = {
  cash: 'Cash', bank_transfer: 'Bank transfer', mobile_money: 'Mobile money', cheque: 'Cheque', card: 'Card', other: 'Other',
}
</script>

<template>
  <article class="st-doc" aria-label="Rates statement">
    <header class="st-head">
      <div>
        <p class="st-council">Vungu Rural District Council</p>
        <h3 class="st-title">Statement of rates account</h3>
        <p class="st-asat">As at {{ formatDate(asAt) }}</p>
      </div>
      <dl class="st-kv">
        <dt>Account</dt><dd class="num">{{ statement.account.account_no }}</dd>
        <dt>Ratepayer</dt><dd>{{ statement.account.party_name }}</dd>
        <dt>Stand</dt><dd>{{ statement.account.stand_no ?? '—' }}<template v-if="statement.account.ward_code">, ward {{ statement.account.ward_code }}</template></dd>
        <dt v-if="statement.account.address_text">Address</dt><dd v-if="statement.account.address_text">{{ statement.account.address_text }}</dd>
        <dt>Status</dt><dd>{{ statement.account.status === 'active' ? 'Active' : `Closed ${formatDate(statement.account.closed_on)}` }}</dd>
      </dl>
    </header>

    <section class="st-balances" aria-label="Balance">
      <p v-if="!statement.balances.length" class="st-muted">Nothing has been billed or received on this account.</p>
      <div v-for="b in statement.balances" :key="b.currency" class="st-balance">
        <span class="st-label">Balance {{ b.currency }}</span>
        <strong class="num" :class="{ 'st-credit': b.balance.startsWith('-') }">{{ formatMoney(b.balance, b.currency) }}</strong>
        <span v-if="b.unallocated_credit !== '0.00'" class="st-muted">includes {{ formatMoney(b.unallocated_credit, b.currency) }} received, not yet matched to a bill</span>
      </div>
    </section>

    <h4 class="st-sub">Bills</h4>
    <p v-if="!statement.bills.length" class="st-muted">No bills.</p>
    <table v-else class="st-table">
      <thead><tr><th>Bill</th><th>Period</th><th>Issued</th><th>Due</th><th class="r">Amount</th><th class="r">Outstanding</th><th>Age</th></tr></thead>
      <tbody>
        <tr v-for="b in statement.bills" :key="b.id">
          <td class="num">{{ b.bill_no }}</td>
          <td>{{ formatDate(b.period_from) }} to {{ formatDate(b.period_to) }}</td>
          <td>{{ formatDate(b.issued_on) }}</td><td>{{ formatDate(b.due_on) }}</td>
          <td class="r num">{{ formatMoney(b.amount, b.currency) }}</td>
          <td class="r num">{{ b.outstanding_amount === null ? 'Not yet issued' : formatMoney(b.outstanding_amount, b.currency) }}</td>
          <td>{{ b.voucher_status === 'cancelled' ? 'Cancelled' : bucketLabel(b.ageing_bucket) }}</td>
        </tr>
      </tbody>
    </table>

    <h4 class="st-sub">Payments</h4>
    <p v-if="!statement.receipts.length" class="st-muted">No payments.</p>
    <table v-else class="st-table">
      <thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th>Reference</th><th class="r">Amount</th><th>Status</th></tr></thead>
      <tbody>
        <tr v-for="r in statement.receipts" :key="r.id">
          <td class="num">{{ r.receipt_no }}</td><td>{{ formatDate(r.received_on) }}</td>
          <td>{{ r.method ? METHOD[r.method] ?? r.method : '—' }}</td><td>{{ r.reference ?? '—' }}</td>
          <td class="r num">{{ formatMoney(r.amount, r.currency) }}</td>
          <td>{{ r.voucher_status === 'posted' ? 'Posted' : r.voucher_status === 'draft' ? 'Not yet posted' : 'Cancelled' }}</td>
        </tr>
      </tbody>
    </table>

    <p class="st-foot">{{ statement.note }}</p>
  </article>
</template>

<style scoped>
.st-doc { color: #1f2328; background: #fff; font-size: 14px; }
.st-head { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; border-bottom: 2px solid #1f2328; padding-bottom: 12px; }
.st-council { margin: 0; font-weight: 700; letter-spacing: 0.02em; }
.st-title { margin: 4px 0 0; font-size: 18px; }
.st-asat { margin: 4px 0 0; color: #57606a; }
.st-kv { display: grid; grid-template-columns: auto 1fr; gap: 2px 14px; margin: 0; }
.st-kv dt { color: #57606a; }
.st-kv dd { margin: 0; }
.st-balances { display: flex; flex-wrap: wrap; gap: 24px; padding: 14px 0; border-bottom: 1px solid #d0d7de; }
.st-balance { display: flex; flex-direction: column; gap: 2px; }
.st-label { color: #57606a; font-size: 12.5px; text-transform: uppercase; letter-spacing: 0.05em; }
.st-balance strong { font-size: 20px; }
.st-credit { color: #1a7f37; }
.st-sub { margin: 18px 0 6px; font-size: 15px; }
.st-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.st-table th, .st-table td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #d0d7de; vertical-align: top; }
.st-table th { font-size: 12.5px; color: #57606a; font-weight: 600; }
.st-table .r { text-align: right; }
.st-muted { color: #57606a; margin: 4px 0; }
.st-foot { margin-top: 18px; color: #57606a; font-size: 12.5px; }
</style>
