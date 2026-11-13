<script setup lang="ts">
/**
 * The cashier's dashboard: the day's figures, quick actions, the last receipts, the day at a
 * glance and the service queue. Figures come from `GET /finance/cash/dashboard`; while the
 * cashier's drawer is uncounted the money tiles say so instead of showing a total (control C7).
 */
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  Printer, Wallet, FileText, ArrowLeftRight, Coins, ArrowUp, ArrowDown, CreditCard, Search, Users,
  Layers, Clock, ArrowRight, Ellipsis, ChartPie, CircleCheck, CircleX, ChevronRight, Plus, X,
  Banknote, Landmark, Smartphone, AlertTriangle,
} from 'lucide-vue-next'
import { cashApi } from '../../../api/cashApi'
import { messageOf } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import type { CashierDashboard, CashMethod, CashReceipt, QueueTicket } from '../../../models/cashTypes'
import { methodLabel } from '../../../models/cashTypes'
import { timeOf, useCashier } from '../useCashier'
import TillNotice from '../components/TillNotice.vue'
import ReceiptDialog from '../components/ReceiptDialog.vue'
import ReasonDialog from '../../shared/ReasonDialog.vue'
import QueueAddDialog from '../components/QueueAddDialog.vue'

const router = useRouter()
const { state, till, loadQueue, loadDesk } = useCashier()

const data = ref<CashierDashboard | null>(null)
const error = ref<string | null>(null)
const loading = ref(false)

async function load(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    data.value = await cashApi.dashboard()
  } catch (err) {
    error.value = messageOf(err, 'The dashboard could not be read.')
  } finally {
    loading.value = false
  }
}
const closeMenu = (): void => { openMenu.value = null }
onMounted(() => { void load(); void loadQueue(); document.addEventListener('click', closeMenu) })
onBeforeUnmount(() => document.removeEventListener('click', closeMenu))

const today = computed(() => data.value?.counts.today ?? { receipts: 0, transactions: 0, cancelled: 0, pending: 0 })
const yesterday = computed(() => data.value?.counts.yesterday ?? { receipts: 0, transactions: 0, cancelled: 0, pending: 0 })

/** Change on yesterday for a count, as the tile's second line. */
function delta(now: number, before: number): { text: string; dir: 'up' | 'down' | null } {
  if (before === 0) return { text: now ? 'None yesterday' : 'No receipts yet today', dir: null }
  const pct = Math.round(((now - before) / before) * 100)
  return { text: `${pct >= 0 ? '+' : ''}${pct}% vs yesterday`, dir: pct >= 0 ? 'up' : 'down' }
}
function moneyDelta(pct: string | null): { text: string; dir: 'up' | 'down' | null } {
  if (pct === null) return { text: 'None yesterday', dir: null }
  const n = Number(pct)
  return { text: `${n >= 0 ? '+' : ''}${pct}% vs yesterday`, dir: n >= 0 ? 'up' : 'down' }
}

const amounts = computed(() => data.value?.amounts ?? [])
const withheld = computed(() => data.value?.amounts_withheld ?? false)
const cashStatus = computed(() => {
  if (till.value === 'open' || till.value === 'suspended' || till.value === 'stale' || till.value === 'abandoned') return '(Pending Cash Up)'
  if (till.value === 'counted') return '(Counted, awaiting verification)'
  if (till.value === 'verified') return '(Verified)'
  return '(No till open)'
})

const ACTIONS = [
  { label: 'Take Payment', icon: CreditCard, to: { name: 'cashier-pay' }, primary: true },
  { label: 'Issue Receipt', icon: FileText, to: { name: 'cashier-issue' } },
  { label: 'Bill Enquiry', icon: Search, to: { name: 'cashier-bills' } },
  { label: 'Customer Lookup', icon: Users, to: { name: 'cashier-customers' } },
  { label: 'Daily Cash Up', icon: Layers, to: { name: 'cashier-cashup' } },
  { label: 'Reprint Receipt', icon: Printer, to: { name: 'cashier-receipts', query: { reprint: '1' } } },
]

const METHOD_ICON: Record<CashMethod, unknown> = {
  cash: Banknote, card: CreditCard, bank_transfer: Landmark, mobile_money: Smartphone, cheque: FileText,
}

// ── Row actions on recent receipts ────────────────────────────────────────────────────────────
const openMenu = ref<string | null>(null)
const viewing = ref<string | null>(null)
const cancelling = ref<CashReceipt | null>(null)
const cancelError = ref<string | null>(null)
const cancelBusy = ref(false)

async function cancelReceipt(reason: string): Promise<void> {
  if (!cancelling.value) return
  cancelBusy.value = true
  cancelError.value = null
  try {
    await cashApi.cancelReceipt(cancelling.value.id, reason)
    cancelling.value = null
    await Promise.all([load(), loadDesk()])
  } catch (err) {
    cancelError.value = messageOf(err, 'The receipt could not be cancelled.')
  } finally {
    cancelBusy.value = false
  }
}

// ── Queue ─────────────────────────────────────────────────────────────────────────────────────
const adding = ref(false)
const removing = ref<QueueTicket | null>(null)
const removeError = ref<string | null>(null)
const removeBusy = ref(false)

function serve(t: QueueTicket): void {
  void router.push({ name: 'cashier-pay', query: { ticket: t.id, ...(t.rates_account_id ? { account: t.rates_account_id } : { name: t.customer_name }) } })
}
async function removeTicket(reason: string): Promise<void> {
  if (!removing.value) return
  removeBusy.value = true
  removeError.value = null
  try {
    await cashApi.removeTicket(removing.value.id, reason)
    removing.value = null
    await loadQueue()
  } catch (err) {
    removeError.value = messageOf(err, 'The ticket could not be removed.')
  } finally {
    removeBusy.value = false
  }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Printer :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Cashier Dashboard</h2>
      <p>Receive payments, issue receipts and manage daily cash transactions.</p>
    </div>
  </section>

  <TillNotice />
  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}
    <button type="button" class="cw-btn cw-btn--small" @click="load">Retry</button></p>

  <!-- ── Figures ────────────────────────────────────────────────────────────────────────── -->
  <div class="cw-tiles" :aria-busy="loading">
    <RouterLink :to="{ name: 'cashier-receipts' }" class="cw-tile cw-tile--violet">
      <span class="cw-tile-icon"><Wallet :size="34" aria-hidden="true" /></span>
      <div>
        <p class="cw-tile-label">Today's Collections</p>
        <template v-if="withheld">
          <p class="cw-tile-value cw-tile-value--muted">Shown after your count</p>
          <p class="cw-tile-sub">Your drawer is counted first</p>
        </template>
        <template v-else-if="amounts.length">
          <p class="cw-tile-value num">{{ formatMoney(amounts[0].collected_today, amounts[0].currency) }}</p>
          <p v-for="a in amounts.slice(1)" :key="a.currency" class="cw-tile-value-2 num">{{ formatMoney(a.collected_today, a.currency) }}</p>
          <p class="cw-tile-sub" :class="moneyDelta(amounts[0].change_pct).dir === 'up' ? 'is-up' : moneyDelta(amounts[0].change_pct).dir === 'down' ? 'is-down' : ''">
            <ArrowUp v-if="moneyDelta(amounts[0].change_pct).dir === 'up'" :size="17" aria-hidden="true" />
            <ArrowDown v-else-if="moneyDelta(amounts[0].change_pct).dir === 'down'" :size="17" aria-hidden="true" />
            {{ moneyDelta(amounts[0].change_pct).text }}
          </p>
        </template>
        <template v-else>
          <p class="cw-tile-value num">0.00</p>
          <p class="cw-tile-sub">No receipts yet today</p>
        </template>
      </div>
    </RouterLink>

    <RouterLink :to="{ name: 'cashier-receipts' }" class="cw-tile cw-tile--blue">
      <span class="cw-tile-icon"><FileText :size="34" aria-hidden="true" /></span>
      <div>
        <p class="cw-tile-label">Receipts Issued</p>
        <p class="cw-tile-value num">{{ today.receipts }}</p>
        <p class="cw-tile-sub" :class="{ 'is-up': delta(today.receipts, yesterday.receipts).dir === 'up', 'is-down': delta(today.receipts, yesterday.receipts).dir === 'down' }">
          <ArrowUp v-if="delta(today.receipts, yesterday.receipts).dir === 'up'" :size="17" aria-hidden="true" />
          <ArrowDown v-else-if="delta(today.receipts, yesterday.receipts).dir === 'down'" :size="17" aria-hidden="true" />
          {{ delta(today.receipts, yesterday.receipts).text }}
        </p>
      </div>
    </RouterLink>

    <RouterLink :to="{ name: 'cashier-receipts' }" class="cw-tile cw-tile--green">
      <span class="cw-tile-icon"><ArrowLeftRight :size="34" aria-hidden="true" /></span>
      <div>
        <p class="cw-tile-label">Transactions</p>
        <p class="cw-tile-value num">{{ today.transactions }}</p>
        <p class="cw-tile-sub" :class="{ 'is-up': delta(today.transactions, yesterday.transactions).dir === 'up', 'is-down': delta(today.transactions, yesterday.transactions).dir === 'down' }">
          <ArrowUp v-if="delta(today.transactions, yesterday.transactions).dir === 'up'" :size="17" aria-hidden="true" />
          <ArrowDown v-else-if="delta(today.transactions, yesterday.transactions).dir === 'down'" :size="17" aria-hidden="true" />
          {{ delta(today.transactions, yesterday.transactions).text }}
        </p>
      </div>
    </RouterLink>

    <RouterLink :to="{ name: 'cashier-cashup' }" class="cw-tile cw-tile--amber">
      <span class="cw-tile-icon"><Coins :size="34" aria-hidden="true" /></span>
      <div>
        <p class="cw-tile-label">Cash on Hand</p>
        <p v-if="withheld" class="cw-tile-value cw-tile-value--muted">Counted at cash-up</p>
        <template v-else-if="amounts.length">
          <p class="cw-tile-value num">{{ formatMoney(amounts[0].cash_today, amounts[0].currency) }}</p>
          <p v-for="a in amounts.slice(1)" :key="a.currency" class="cw-tile-value-2 num">{{ formatMoney(a.cash_today, a.currency) }}</p>
        </template>
        <p v-else class="cw-tile-value num">0.00</p>
        <p class="cw-tile-sub">{{ cashStatus }}</p>
      </div>
    </RouterLink>
  </div>
  <p v-if="data?.note" class="cw-hint" style="margin: -6px 4px 0">{{ data.note }}</p>

  <div class="dash-grid">
    <div class="dash-col">
      <!-- ── Quick actions ──────────────────────────────────────────────────────────────── -->
      <section class="cw-card" aria-labelledby="qa-h">
        <div class="cw-card-head"><h3 id="qa-h">Quick Actions</h3></div>
        <div class="cw-card-body">
          <div class="cw-actions">
            <RouterLink v-for="a in ACTIONS" :key="a.label" :to="a.to" class="cw-action" :class="{ 'is-primary': a.primary }">
              <component :is="a.icon" :size="34" :stroke-width="1.6" aria-hidden="true" />
              <span>{{ a.label }}</span>
            </RouterLink>
          </div>
        </div>
      </section>

      <!-- ── Recent transactions ────────────────────────────────────────────────────────── -->
      <section class="cw-card" aria-labelledby="rt-h">
        <div class="cw-card-head">
          <h3 id="rt-h"><Clock :size="24" class="cw-head-icon" aria-hidden="true" /> Recent Transactions</h3>
          <span class="cw-spacer" />
          <RouterLink :to="{ name: 'cashier-receipts' }" class="cw-link">View All <ArrowRight :size="17" aria-hidden="true" /></RouterLink>
        </div>
        <div class="cw-card-body cw-table-wrap">
          <div v-if="loading && !data"><span class="cw-skel" /><span class="cw-skel" /><span class="cw-skel" /></div>
          <p v-else-if="!data?.recent.length" class="cw-empty"><strong>No receipts yet.</strong>Receipts you issue appear here.</p>
          <table v-else class="cw-table">
            <thead><tr><th>Receipt No.</th><th>Customer</th><th>Service / Bill</th><th class="r">Amount</th><th>Payment Method</th><th>Time</th><th><span class="sr-only">Actions</span></th></tr></thead>
            <tbody>
              <tr v-for="r in data.recent" :key="r.id">
                <td><button type="button" class="cw-receipt-no" @click="viewing = r.id">{{ r.receipt_no }}</button></td>
                <td>{{ r.payer_name }}</td>
                <td>{{ r.service ?? '—' }}<span v-if="r.is_cancelled" class="cw-pill cw-pill--neg" style="margin-left: 6px">Cancelled</span></td>
                <td class="amt" :style="r.is_cancelled ? 'text-decoration: line-through; color: var(--cw-ink-3)' : ''">{{ formatMoney(r.amount, r.currency) }}</td>
                <td><span class="cw-method" :class="`cw-method--${r.method}`"><component :is="METHOD_ICON[r.method ?? 'cash']" :size="15" aria-hidden="true" />{{ methodLabel(r.method) }}</span></td>
                <td class="num">{{ timeOf(r.created_at) }}</td>
                <td style="position: relative">
                  <button type="button" class="cw-icon-btn" :aria-label="`Actions for ${r.receipt_no}`" :aria-expanded="openMenu === r.id" @click.stop="openMenu = openMenu === r.id ? null : r.id"><Ellipsis :size="20" /></button>
                  <div v-if="openMenu === r.id" class="cw-menu" role="menu" @click="openMenu = null">
                    <button type="button" role="menuitem" @click="viewing = r.id"><FileText :size="16" aria-hidden="true" /> View / reprint</button>
                    <button v-if="r.source === 'sundry' && !r.is_cancelled" type="button" role="menuitem" @click="cancelling = r; cancelError = null"><X :size="16" aria-hidden="true" /> Cancel receipt</button>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>

    <div class="dash-col">
      <!-- ── Today at a glance ──────────────────────────────────────────────────────────── -->
      <section class="cw-card" aria-labelledby="tg-h">
        <div class="cw-card-head"><h3 id="tg-h"><ChartPie :size="24" class="cw-head-icon" aria-hidden="true" /> Today at a Glance</h3></div>
        <div class="cw-card-body">
          <ul class="glance">
            <li><CircleCheck :size="22" class="cw-pos" aria-hidden="true" /><span>Paid</span><strong class="num">{{ today.receipts }}</strong></li>
            <li><Clock :size="22" style="color: #d38b00" aria-hidden="true" /><span>Pending Payments</span><strong class="num">{{ today.pending }}</strong></li>
            <li><CircleX :size="22" class="cw-neg" aria-hidden="true" /><span>Voided / Cancelled</span><strong class="num">{{ today.cancelled }}</strong></li>
          </ul>
          <p class="cw-hint" style="margin: 8px 0 0">Pending: card, transfer and mobile-money payments not yet confirmed at verification.</p>
        </div>
      </section>

      <!-- ── Service queue ──────────────────────────────────────────────────────────────── -->
      <section class="cw-card" aria-labelledby="sq-h">
        <div class="cw-card-head">
          <h3 id="sq-h"><Users :size="24" class="cw-head-icon" aria-hidden="true" /> Service Queue</h3>
          <span class="cw-spacer" />
          <button type="button" class="cw-icon-btn" aria-label="Add a customer to the queue" @click="adding = true"><Plus :size="20" /></button>
          <span class="cw-count-pill" :aria-label="`${state.queue.length} waiting`">{{ state.queue.length }}</span>
        </div>
        <div class="cw-card-body">
          <p v-if="state.queueError" class="cw-banner-msg cw-banner-msg--neg" role="alert">{{ state.queueError }}</p>
          <p v-else-if="!state.queue.length" class="cw-empty"><strong>Nobody is waiting.</strong>Add a customer with the + button as they arrive.</p>
          <ol v-else class="queue">
            <li v-for="(t, i) in state.queue" :key="t.id" :class="{ 'is-next': i === 0 }">
              <button type="button" class="queue-main" :aria-label="`Serve ticket ${t.ticket_no}, ${t.customer_name}`" @click="serve(t)">
                <span class="queue-no">{{ t.ticket_no }}</span>
                <span class="queue-text"><strong>{{ t.customer_name }}</strong><span>{{ t.service ?? 'Payment' }}<template v-if="t.account_no"> · {{ t.account_no }}</template></span></span>
                <ChevronRight :size="22" aria-hidden="true" />
              </button>
              <button type="button" class="cw-icon-btn" :aria-label="`Remove ticket ${t.ticket_no} from the queue`" @click="removing = t; removeError = null"><X :size="16" /></button>
            </li>
          </ol>
        </div>
      </section>
    </div>
  </div>

  <ReceiptDialog v-if="viewing" :receipt-id="viewing" @close="viewing = null" />
  <ReasonDialog
    v-if="cancelling" :title="`Cancel receipt ${cancelling.receipt_no}`"
    :message="`${formatMoney(cancelling.amount, cancelling.currency)} from ${cancelling.payer_name}. The receipt stays on the record as cancelled, with your reason, and its number is not used again.`"
    label="Why is it being cancelled?" submit-label="Cancel receipt" danger :busy="cancelBusy" :error="cancelError"
    @submit="cancelReceipt" @close="cancelling = null"
  />
  <ReasonDialog
    v-if="removing" :title="`Remove ticket ${removing.ticket_no}`" :message="`${removing.customer_name} leaves the queue. The ticket is kept with your reason.`"
    label="Why is it being removed?" :min-length="3" submit-label="Remove from queue" danger :busy="removeBusy" :error="removeError"
    @submit="removeTicket" @close="removing = null"
  />
  <QueueAddDialog v-if="adding" @close="adding = false" @added="adding = false; loadQueue()" />
</template>

<style scoped>
.dash-grid { display: grid; grid-template-columns: minmax(0, 1fr) minmax(300px, 380px); gap: 18px; align-items: start; }
.dash-col { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.glance { list-style: none; margin: 0; padding: 0; }
.glance li { display: flex; align-items: center; gap: 10px; padding: 8px 4px; border-bottom: 1px solid var(--cw-line); font-size: 13.5px; }
.glance li:last-child { border-bottom: 0; }
.glance span { flex: 1; }
.glance strong { font-size: 15px; }
.queue { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
.queue li { display: flex; align-items: center; gap: 4px; border-radius: 12px; border-bottom: 1px solid var(--cw-line); }
.queue li.is-next { background: var(--cw-accent-softer); border-bottom-color: transparent; }
.queue-main { flex: 1; display: flex; align-items: center; gap: 14px; padding: 10px 8px; border: 0; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; border-radius: 12px; }
.queue-main:hover { background: #f1f6fd; }
.queue-no { width: 36px; height: 36px; border-radius: 50%; background: #e8eff8; color: var(--cw-ink); display: grid; place-items: center; font-size: 17px; font-weight: 700; flex: none; }
.is-next .queue-no { background: #d7e7fb; color: var(--cw-accent-ink); }
.queue-text { flex: 1; display: flex; flex-direction: column; line-height: 1.25; }
.queue-text strong { font-size: 14px; }
.queue-text span { color: var(--cw-ink-2); font-size: 15px; }
@media (max-width: 1180px) { .dash-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
