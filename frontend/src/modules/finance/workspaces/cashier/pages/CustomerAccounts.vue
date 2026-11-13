<script setup lang="ts">
/**
 * Look a customer up and read their account: details, balance per currency (from the posted
 * ledger), every bill with what is still open, and every payment. From here the cashier takes a
 * payment or puts the customer in the queue.
 */
import { onMounted, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Users, Search, X, AlertTriangle, CreditCard, UserPlus, Phone, Mail, MapPin, Landmark } from 'lucide-vue-next'
import { ratesApi } from '../../../api/ratesApi'
import { cashApi } from '../../../api/cashApi'
import { messageOf } from '../../../stores/finance'
import { formatMoney, formatDate } from '../../../composables/useMoney'
import { methodLabel } from '../../../models/cashTypes'
import type { RatesAccount, RatesStatement } from '../../../models/ratesTypes'
import { periodLabel, useCashier } from '../useCashier'

const route = useRoute()
const router = useRouter()
const { loadQueue } = useCashier()

const q = ref('')
const rows = ref<RatesAccount[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)
const statement = ref<RatesStatement | null>(null)
const loadingStatement = ref(false)
const notice = ref<string | null>(null)

async function search(): Promise<void> {
  loading.value = true
  error.value = null
  try {
    const page = await ratesApi.accounts({ ...(q.value.trim() ? { q: q.value.trim() } : {}), limit: 25 })
    rows.value = page.accounts
    total.value = page.total
  } catch (err) {
    error.value = messageOf(err, 'The accounts could not be searched.')
  } finally {
    loading.value = false
  }
}

async function open(id: string): Promise<void> {
  loadingStatement.value = true
  error.value = null
  notice.value = null
  try {
    statement.value = await ratesApi.statement(id)
    void router.replace({ query: { account: id } })
  } catch (err) {
    error.value = messageOf(err, 'The account could not be read.')
  } finally {
    loadingStatement.value = false
  }
}

async function queue(): Promise<void> {
  if (!statement.value) return
  try {
    const t = (await cashApi.addToQueue({ customer_name: statement.value.account.party_name, rates_account_id: statement.value.account.id, service: 'Property rates' })).ticket
    notice.value = `${t.customer_name} is number ${t.ticket_no} in the queue.`
    void loadQueue()
  } catch (err) {
    error.value = messageOf(err, 'The customer could not be added to the queue.')
  }
}

onMounted(async () => {
  const id = typeof route.query.account === 'string' ? route.query.account : null
  await Promise.all([search(), id ? open(id) : Promise.resolve()])
})
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Users :size="58" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Customer Accounts</h2>
      <p>Find a ratepayer and read their account before taking a payment.</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>

  <div class="ca-grid">
    <section class="cw-card" aria-label="Accounts">
      <div class="cw-card-body" style="padding-top: 20px; display: flex; flex-direction: column; gap: 12px">
        <form class="cw-search" role="search" @submit.prevent="search">
          <Search :size="22" aria-hidden="true" />
          <input v-model="q" class="cw-input" placeholder="Name, account or stand number" aria-label="Search accounts" />
          <button v-if="q" type="button" class="cw-search-clear" aria-label="Clear" @click="q = ''; search()"><X :size="20" /></button>
        </form>
        <div v-if="loading && !rows.length"><span class="cw-skel" /><span class="cw-skel" /></div>
        <p v-else-if="!rows.length" class="cw-empty"><strong>No accounts found.</strong>Rates accounts are opened by the revenue office.</p>
        <ul v-else class="ca-list">
          <li v-for="a in rows" :key="a.id">
            <button type="button" :aria-current="statement?.account.id === a.id ? 'true' : undefined" @click="open(a.id)">
              <strong>{{ a.party_name }}</strong>
              <span>{{ a.account_no }}<template v-if="a.stand_no"> · Stand {{ a.stand_no }}</template></span>
              <span v-if="a.status !== 'active'" class="cw-pill cw-pill--mute" style="align-self: flex-start">Closed</span>
            </button>
          </li>
        </ul>
        <p v-if="total > rows.length" class="cw-hint">{{ rows.length }} of {{ total }}. Search to narrow the list.</p>
      </div>
    </section>

    <div class="ca-detail">
      <p v-if="loadingStatement" class="cw-empty" role="status">Reading the account…</p>
      <p v-else-if="!statement" class="cw-card cw-empty" style="padding: 40px"><strong>Choose an account.</strong>Its balance, bills and payments appear here.</p>
      <template v-else>
        <section class="cw-card">
          <div class="cw-card-head">
            <span class="ca-icon"><Landmark :size="30" aria-hidden="true" /></span>
            <div style="flex: 1">
              <h3>{{ statement.account.party_name }}</h3>
              <span class="cw-hint">Account {{ statement.account.account_no }} · Parcel {{ statement.account.parcel_id }}<template v-if="statement.account.stand_no"> · Stand {{ statement.account.stand_no }}</template></span>
            </div>
            <button type="button" class="cw-btn cw-btn--outline cw-btn--small" @click="queue"><UserPlus :size="16" aria-hidden="true" /> Add to queue</button>
            <button type="button" class="cw-btn cw-btn--primary cw-btn--small" @click="router.push({ name: 'cashier-pay', query: { account: statement.account.id } })"><CreditCard :size="16" aria-hidden="true" /> Take payment</button>
          </div>
          <div class="cw-card-body">
            <p v-if="notice" class="cw-banner-msg cw-banner-msg--pos" role="status">{{ notice }}</p>
            <ul class="ca-contact">
              <li v-if="statement.account.contact_phone"><Phone :size="17" aria-hidden="true" />{{ statement.account.contact_phone }}</li>
              <li v-if="statement.account.contact_email"><Mail :size="17" aria-hidden="true" />{{ statement.account.contact_email }}</li>
              <li v-if="statement.account.address_text"><MapPin :size="17" aria-hidden="true" />{{ statement.account.address_text }}</li>
            </ul>
            <div class="ca-balances">
              <div v-for="b in statement.balances" :key="b.currency" class="ca-balance">
                <span>Balance ({{ b.currency }})</span>
                <strong class="num" :class="{ 'cw-neg': !b.balance.startsWith('-') && b.balance !== '0.00' }">{{ formatMoney(b.owed, b.currency) }}</strong>
                <span v-if="b.unallocated_credit !== '0.00'" class="cw-hint">Credit {{ formatMoney(b.unallocated_credit, b.currency) }}</span>
              </div>
              <p v-if="!statement.balances.length" class="cw-hint">Nothing owed.</p>
            </div>
            <p class="cw-hint">{{ statement.note }}</p>
          </div>
        </section>

        <section class="cw-card">
          <div class="cw-card-head"><h3>Bills</h3></div>
          <div class="cw-card-body cw-table-wrap">
            <p v-if="!statement.bills.length" class="cw-empty">No bills.</p>
            <table v-else class="cw-table">
              <thead><tr><th>Bill</th><th>Period</th><th>Due</th><th class="r">Amount</th><th class="r">Open</th><th>Status</th></tr></thead>
              <tbody>
                <tr v-for="b in statement.bills" :key="b.id">
                  <td>{{ b.bill_no }}</td><td>{{ periodLabel(b.period_from) }}</td><td>{{ formatDate(b.due_on) }}</td>
                  <td class="amt">{{ formatMoney(b.amount, b.currency) }}</td>
                  <td class="amt">{{ formatMoney(b.open_amount, b.currency) }}</td>
                  <td>
                    <span v-if="b.voucher_status !== 'posted'" class="cw-pill cw-pill--mute">{{ b.voucher_status }}</span>
                    <span v-else-if="b.open_amount === '0.00'" class="cw-pill cw-pill--pos">Paid</span>
                    <span v-else-if="(b.days_outstanding ?? 0) > 0" class="cw-pill cw-pill--neg">{{ b.days_outstanding }} days</span>
                    <span v-else class="cw-pill cw-pill--info">Current</span>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="cw-card">
          <div class="cw-card-head"><h3>Payments</h3></div>
          <div class="cw-card-body cw-table-wrap">
            <p v-if="!statement.receipts.length" class="cw-empty">No payments recorded.</p>
            <table v-else class="cw-table">
              <thead><tr><th>Receipt</th><th>Date</th><th>Method</th><th class="r">Amount</th></tr></thead>
              <tbody>
                <tr v-for="r in statement.receipts" :key="r.id">
                  <td>{{ r.receipt_no }}</td><td>{{ formatDate(r.received_on) }}</td><td>{{ methodLabel(r.method) }}</td>
                  <td class="amt" :style="r.voucher_status === 'cancelled' ? 'text-decoration: line-through' : ''">{{ formatMoney(r.amount, r.currency) }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
.ca-grid { display: grid; grid-template-columns: minmax(280px, 380px) minmax(0, 1fr); gap: 18px; align-items: start; }
.ca-detail { display: flex; flex-direction: column; gap: 18px; min-width: 0; }
.ca-list { list-style: none; margin: 0; padding: 0; max-height: 62vh; overflow: auto; }
.ca-list li + li { border-top: 1px solid var(--cw-line); }
.ca-list button { display: flex; flex-direction: column; gap: 2px; width: 100%; padding: 11px 10px; border: 0; border-radius: 10px; background: none; color: inherit; font: inherit; text-align: left; cursor: pointer; }
.ca-list button:hover, .ca-list button[aria-current='true'] { background: var(--cw-accent-softer); }
.ca-list span { color: var(--cw-ink-2); font-size: 14px; }
.ca-icon { width: 54px; height: 54px; border-radius: 14px; background: var(--cw-accent-soft); color: var(--cw-accent); display: grid; place-items: center; flex: none; }
.ca-contact { list-style: none; margin: 0 0 12px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px 20px; }
.ca-contact li { display: flex; align-items: center; gap: 8px; }
.ca-contact svg { color: var(--cw-accent); }
.ca-balances { display: flex; flex-wrap: wrap; gap: 12px; }
.ca-balance { display: flex; flex-direction: column; gap: 2px; padding: 14px 18px; border-radius: 12px; background: var(--cw-tile-violet); min-width: 200px; }
.ca-balance strong { font-size: 20px; }
@media (max-width: 1023px) { .ca-grid { grid-template-columns: minmax(0, 1fr); } }
</style>
