<script setup lang="ts">
/**
 * The official payment receipt. The same document is the preview before issue (no number yet,
 * marked as a preview), the receipt on screen after issue, the printed page and the PDF.
 */
import { computed } from 'vue'
import { User, Calendar, Clock, UserRound, Calculator, FileText, CircleCheck } from 'lucide-vue-next'
import { formatMoney } from '../../../composables/useMoney'
import { amountInWords, CURRENCY_WORDS } from '../../../composables/cashMath'
import { methodLabel, type ReceiptView } from '../receipt'
import CashierArt from '../../shared/PortalArt.vue'

const props = defineProps<{ view: ReceiptView; copy?: boolean }>()

const issued = computed(() => props.view.issued_at ? new Date(props.view.issued_at) : null)
const dateText = computed(() => (issued.value ?? new Date()).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }))
const timeText = computed(() => (issued.value ? issued.value.toLocaleTimeString('en-GB') : '—'))
const words = computed(() => amountInWords(props.view.total, CURRENCY_WORDS[props.view.currency]))
const money = (v: string | null) => formatMoney(v, props.view.currency)
</script>

<template>
  <article class="rd" :class="{ 'is-preview': !view.receipt_no }" aria-label="Payment receipt">
    <header class="rd-head">
      <CashierArt kind="crest" :size="78" />
      <div class="rd-council">
        <strong>VUNGU</strong>
        <strong>RURAL DISTRICT COUNCIL</strong>
        <span>Local Authority Finance System</span>
      </div>
      <div class="rd-no">
        <span class="rd-no-tag">OFFICIAL RECEIPT</span>
        <span class="rd-no-label">Receipt No.</span>
        <strong v-if="view.receipt_no">{{ view.receipt_no }}</strong>
        <em v-else>Issued on confirmation</em>
      </div>
    </header>
    <div class="rd-rule" />
    <h2 class="rd-title">PAYMENT RECEIPT<span v-if="copy"> — COPY</span></h2>
    <p v-if="!view.receipt_no" class="rd-flag">Preview — not a receipt until it is issued.</p>
    <p v-if="view.is_cancelled" class="rd-flag rd-flag--void">CANCELLED — {{ view.cancel_reason }}</p>

    <section class="rd-grid">
      <div>
        <h3><User :size="17" aria-hidden="true" /> Customer Details</h3>
        <dl class="rd-kv">
          <div><dt>Customer Name:</dt><dd>{{ view.customer_name }}</dd></div>
          <div v-if="view.account_no"><dt>Account No:</dt><dd>{{ view.account_no }}</dd></div>
          <div v-if="view.customer_type"><dt>Customer Type:</dt><dd>{{ view.customer_type }}</dd></div>
          <div v-if="view.contact"><dt>Contact:</dt><dd>{{ view.contact }}</dd></div>
        </dl>
      </div>
      <dl class="rd-kv rd-kv--side">
        <div><dt><Calendar :size="15" aria-hidden="true" /> Date:</dt><dd>{{ dateText }}</dd></div>
        <div><dt><Clock :size="15" aria-hidden="true" /> Time:</dt><dd>{{ timeText }}</dd></div>
        <div><dt><UserRound :size="15" aria-hidden="true" /> Cashier:</dt><dd>{{ view.cashier_name }}</dd></div>
        <div><dt><Calculator :size="15" aria-hidden="true" /> Till No:</dt><dd>{{ view.till }}</dd></div>
      </dl>
    </section>

    <h3><FileText :size="17" aria-hidden="true" /> Payment Breakdown</h3>
    <table class="rd-table">
      <thead><tr><th>Bill / Invoice</th><th>Service</th><th>Period</th><th class="r">Amount</th></tr></thead>
      <tbody>
        <tr v-for="(l, i) in view.lines" :key="i">
          <td>{{ l.ref }}</td><td>{{ l.service }}</td><td>{{ l.period }}</td><td class="r b">{{ money(l.amount) }}</td>
        </tr>
      </tbody>
      <tfoot><tr><th colspan="3">Total Paid</th><td class="r">{{ money(view.total) }}</td></tr></tfoot>
    </table>
    <p class="rd-words">{{ words }}</p>

    <section class="rd-foot">
      <dl class="rd-kv">
        <div><dt>Payment Method:</dt><dd>{{ methodLabel(view.method) }}</dd></div>
        <div v-if="view.method_reference"><dt>Reference:</dt><dd>{{ view.method_reference }}</dd></div>
        <div v-if="view.tendered"><dt>Amount Received:</dt><dd>{{ money(view.tendered) }}</dd></div>
        <div v-if="view.change"><dt>Change Given:</dt><dd>{{ money(view.change) }}</dd></div>
      </dl>
      <div class="rd-verify">
        <strong><CircleCheck :size="18" aria-hidden="true" /> Verify Receipt</strong>
        <p>Quote the receipt number at any council cash office to confirm it is genuine.</p>
      </div>
    </section>

    <p class="rd-thanks"><em>Thank you for your payment.</em><br /><em>Your contribution helps us deliver better services to the Vungu community.</em></p>
    <div class="rd-seal"><CashierArt kind="seal" :size="104" /></div>
  </article>
</template>

<style scoped>
.rd { position: relative; color: #1a2430; background: #fff; padding: 22px 24px 26px; font-family: 'Geist', ui-sans-serif, system-ui, sans-serif; font-size: 14px; line-height: 1.4; }
.rd-head { display: flex; align-items: center; gap: 14px; }
.rd-council { flex: 1; display: flex; flex-direction: column; line-height: 1.12; }
.rd-council strong { font-size: 24px; font-weight: 800; letter-spacing: 0.01em; color: #1a2430; }
.rd-council strong + strong { font-size: 19px; }
.rd-council span { margin-top: 6px; font-size: 15px; color: #515c6b; }
.rd-no { display: flex; flex-direction: column; align-items: center; min-width: 180px; border-radius: 8px; overflow: hidden; background: #e8f0f9; }
.rd-no-tag { align-self: stretch; padding: 6px 12px; background: #0f2c52; color: #fff; font-weight: 700; font-size: 15px; text-align: center; letter-spacing: 0.02em; }
.rd-no-label { margin-top: 6px; font-size: 14px; }
.rd-no strong { margin: 2px 0 8px; font-size: 26px; font-weight: 800; color: #194a8c; }
.rd-no em { margin: 4px 10px 10px; font-size: 13px; color: #66717f; text-align: center; }
.rd-rule { height: 5px; margin: 14px 0 10px; background: linear-gradient(90deg, #2a5bc4 0 40%, #f2c230 40% 70%, #2f7d32 70%); border-radius: 2px; }
.rd-title { margin: 6px 0 8px; text-align: center; font-size: 21px; font-weight: 800; letter-spacing: 0.02em; }
.rd-flag { margin: 0 0 10px; padding: 6px 10px; border: 1.5px dashed #9bb5d6; border-radius: 6px; text-align: center; font-weight: 600; color: #194a8c; }
.rd-flag--void { border-style: solid; border-color: #c62828; color: #c62828; }
h3 { display: flex; align-items: center; gap: 8px; margin: 10px 0 6px; font-size: 16.5px; font-weight: 700; }
h3 svg { color: #1f5aa8; }
.rd-grid { display: grid; grid-template-columns: 1.2fr 1fr; gap: 20px; }
.rd-kv { margin: 0; display: grid; grid-template-columns: auto 1fr; }
.rd-kv > div { display: contents; }
.rd-kv dt, .rd-kv dd { padding: 5px 0; border-bottom: 1px solid #dde2e9; }
.rd-kv dt { display: flex; align-items: center; gap: 6px; padding-right: 12px; }
.rd-kv dt svg { color: #1f5aa8; }
.rd-kv dd { margin: 0; text-align: right; font-weight: 500; }
.rd-kv--side { padding-left: 18px; border-left: 1px solid #dde2e9; align-self: start; margin-top: 30px; }
.rd-table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.rd-table th, .rd-table td { padding: 8px 12px; text-align: left; }
.rd-table thead th { background: #f1f4f9; font-weight: 700; }
.rd-table tbody td { border-bottom: 1px solid #dde2e9; }
.rd-table .r { text-align: right; }
.rd-table .b { font-weight: 700; white-space: nowrap; }
.rd-table tfoot th, .rd-table tfoot td { background: #e8f0f9; font-size: 19px; font-weight: 800; }
.rd-table tfoot td { color: #194a8c; white-space: nowrap; }
.rd-words { margin: 6px 2px 0; font-style: italic; color: #515c6b; text-transform: capitalize; }
.rd-foot { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 14px; padding-top: 12px; border-top: 1px solid #dde2e9; }
.rd-verify { padding-left: 18px; border-left: 1px solid #dde2e9; }
.rd-verify strong { display: flex; align-items: center; gap: 8px; color: #157a3e; font-size: 15.5px; }
.rd-verify p { margin: 4px 0 0; color: #515c6b; }
.rd-thanks { margin: 18px 0 0; text-align: center; color: #515c6b; padding-right: 100px; }
.rd-seal { position: absolute; right: 22px; bottom: 16px; opacity: 0.85; transform: rotate(-8deg); }
.is-preview .rd-seal { opacity: 0.25; }
@media (max-width: 640px) {
  .rd { padding: 16px; }
  .rd-head { flex-wrap: wrap; }
  .rd-grid, .rd-foot { grid-template-columns: minmax(0, 1fr); }
  .rd-kv--side, .rd-verify { padding-left: 0; border-left: 0; margin-top: 0; }
  .rd-thanks { padding-right: 0; }
  .rd-seal { position: static; text-align: right; }
}
</style>
