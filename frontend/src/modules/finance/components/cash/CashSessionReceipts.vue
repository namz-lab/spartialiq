<script setup lang="ts">
/**
 * The receipts issued in the till's current session.
 *
 * It is its own card because the counter shows it beside the payment form, and beside the cash-up
 * form while the drawer is being counted. It deliberately shows only what was issued — never a
 * total — because an open till is counted before its takings are compared.
 */
import { Printer, X } from 'lucide-vue-next'
import { formatMoney } from '../../composables/useMoney'
import { methodLabel, type CashReceipt } from '../../models/cashTypes'

defineProps<{ receipts: CashReceipt[]; canCancel: boolean; busy?: boolean }>()
const emit = defineEmits<{
  (e: 'print', receiptId: string): void
  (e: 'cancel', receipt: CashReceipt): void
}>()
</script>

<template>
  <section class="ins-card cash-receipts-card" aria-labelledby="cash-day">
    <div class="ins-card-head">
      <h3 id="cash-day">This session's receipts <span class="ins-count">{{ receipts.length }}</span></h3>
    </div>
    <div v-if="receipts.length === 0" class="ins-card-body">
      <p class="ins-hint">No receipt has been issued in this session yet. Each one appears here the moment it is issued, newest first.</p>
    </div>
    <ul v-else class="cash-receipts">
      <li v-for="r in receipts" :key="r.id" :class="{ 'is-cancelled': r.is_cancelled }">
        <div class="cash-receipt-main">
          <span class="cash-receipt-no">{{ r.receipt_no }}</span>
          <span class="cash-receipt-payer">{{ r.payer_name }}</span>
          <span class="cash-receipt-meta">
            {{ r.source === 'rates' ? 'Rates' : 'Other income' }} · {{ methodLabel(r.method) }}
            <template v-if="r.is_cancelled"> · Cancelled: {{ r.cancel_reason }}</template>
          </span>
        </div>
        <span class="cash-receipt-amount">{{ formatMoney(r.amount, r.currency) }}</span>
        <div class="cash-receipt-acts">
          <button type="button" class="ins-iconbtn" @click="emit('print', r.id)">
            <Printer :size="14" aria-hidden="true" /><span class="sr-only">Print {{ r.receipt_no }}</span>
          </button>
          <button
            v-if="canCancel && !r.is_cancelled && r.source === 'sundry'"
            type="button" class="ins-iconbtn" :disabled="busy" @click="emit('cancel', r)"
          >
            <X :size="14" aria-hidden="true" /><span class="sr-only">Cancel {{ r.receipt_no }}</span>
          </button>
        </div>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.cash-receipts { list-style: none; margin: 0; padding: 0; max-height: 34rem; overflow-y: auto; }
.cash-receipts li {
  display: grid; grid-template-columns: minmax(0, 1fr) auto auto; gap: var(--ent-s3); align-items: center;
  padding: var(--ent-s2) var(--ent-s4); border-bottom: 1px solid var(--ent-line);
}
.cash-receipts li:last-child { border-bottom: 0; }
.cash-receipts li:first-child { animation: cash-arrive 200ms var(--ent-ease); }
.cash-receipt-main { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 0 var(--ent-s2); min-width: 0; }
.cash-receipt-no { font-family: var(--ent-font-mono); font-size: var(--ent-fs-xs); color: var(--ent-text-2); }
.cash-receipt-payer { font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-medium); color: var(--ent-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cash-receipt-meta { grid-column: 1 / -1; font-size: var(--ent-fs-xs); color: var(--ent-text-3); }
.cash-receipt-amount { font-family: var(--ent-font-mono); font-variant-numeric: tabular-nums; font-size: var(--ent-fs-sm); font-weight: var(--ent-fw-semibold); white-space: nowrap; }
.cash-receipt-acts { display: flex; gap: 2px; }
.cash-receipts li.is-cancelled .cash-receipt-amount,
.cash-receipts li.is-cancelled .cash-receipt-payer { text-decoration: line-through; color: var(--ent-text-3); }

.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }

@keyframes cash-arrive { from { opacity: 0; transform: translateY(-4px); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) { .cash-receipts li:first-child { animation: none; } }
@media (max-width: 560px) { .cash-receipts li { padding: var(--ent-s2) var(--ent-s3); } }
</style>
