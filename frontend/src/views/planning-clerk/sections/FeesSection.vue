<script setup lang="ts">
// Fees — what the council received for planning applications.
//
// SINCE MIGRATION 246 THE CASHIER TAKES THE MONEY. A planning fee is paid at
// the cash office (or online), where the cashier names the application: the
// fee reaches the ledger with every other receipt, is counted and banked, and
// an application fee marks the application paid. The clerk reads those fees
// here. The clerk's own receipt register is kept below as the history of what
// was receipted at this desk before; it takes no new entries.
//
// TWO CURRENCIES, ALWAYS NAMED
// The council keeps books in USD and ZWG at the same time. Every total on
// this screen is per currency and never summed across them — an exchange rate
// applied by a screen is a number nobody can reconcile against a bank
// statement, and the rate that matters is the one on the day of the deposit.

import { computed, onMounted, ref, watch } from 'vue'
import ClerkRegister from '@/components/planning-clerk/ClerkRegister.vue'
import type { ClerkColumn, ClerkField } from '@/planning-clerk/registerSpec'
import { asLabel, formatMoney, formatWhen, toDateTimeInput } from '@/planning-clerk/console'
import { useClerkPreferences } from '@/planning-clerk/useClerkConsole'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { listCashOfficeFees, num, type CashOfficeFee } from '@/services/planningClerk'
import { Banknote, Wallet, Landmark, Search } from 'lucide-vue-next'

const { prefs } = useClerkPreferences()
const overview = useClerkOverview()

const FEE_KINDS = [
  { value: 'application', label: 'Application fee' },
  { value: 'plan_scrutiny', label: 'Plan scrutiny' },
  { value: 'public_notice', label: 'Public notice / advertising' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'occupation', label: 'Occupation certificate' },
  { value: 'appeal', label: 'Appeal' },
  { value: 'search', label: 'Planning search' },
  { value: 'copies', label: 'Certified copies' },
  { value: 'other', label: 'Other' },
] as const

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'ecocash', label: 'EcoCash' },
  { value: 'eft', label: 'Bank transfer (EFT)' },
  { value: 'cheque', label: 'Cheque' },
  { value: 'card', label: 'Card' },
] as const

const columns = computed<ClerkColumn[]>(() => [
  { key: 'receipt_no', label: 'Receipt', mono: true },
  { key: 'paid_at', label: 'Paid', nowrap: true, value: (r) => formatWhen(r.paid_at as string) },
  { key: 'payer_name', label: 'Payer' },
  { key: 'fee_kind', label: 'For', value: (r) => asLabel(r.fee_kind as string) },
  {
    key: 'amount',
    label: 'Amount',
    mono: true,
    nowrap: true,
    value: (r) => formatMoney(r.amount as string, r.currency as string),
  },
  {
    key: 'payment_method',
    label: 'Method',
    value: (r) => asLabel(r.payment_method as string),
    // A bank transfer or card entry is the one a clerk must chase a reference
    // for at reconciliation; cash is settled the moment it is counted.
    tone: (r) => (['eft', 'card'].includes(r.payment_method as string) ? 'info' : null),
    secondary: true,
  },
  { key: 'reference', label: 'Reference', mono: true, secondary: true },
  {
    key: 'tpd_reference',
    label: 'File',
    mono: true,
    value: (r) => (r.tpd_reference as string) || 'No file',
    secondary: true,
  },
  { key: 'issued_by_name', label: 'Receipted by', secondary: true },
])

const fields = computed<ClerkField[]>(() => [
  {
    name: 'receipt_no', label: 'Receipt number', type: 'text', required: true,
    placeholder: 'From the receipt book',
    hint: 'Cannot be changed once written — it is the receipt’s identity.',
  },
  { name: 'fee_kind', label: 'What for', type: 'select', required: true, options: FEE_KINDS, initial: 'application' },
  { name: 'payer_name', label: 'Paid by', type: 'text', required: true },
  {
    name: 'amount', label: 'Amount', type: 'number', required: true, step: '0.01',
    hint: 'Rounded to the cent when written.',
  },
  {
    name: 'currency', label: 'Currency', type: 'select', required: true,
    options: [{ value: 'USD', label: 'USD' }, { value: 'ZWG', label: 'ZWG' }],
    // The counter's usual currency, set once in Preferences rather than
    // re-picked forty times a day.
    initial: () => prefs.value.counterCurrency,
  },
  {
    name: 'payment_method', label: 'Method', type: 'select', required: true,
    options: METHODS, initial: 'cash',
  },
  {
    name: 'paid_at', label: 'Paid at', type: 'datetime',
    initial: () => toDateTimeInput(new Date().toISOString()),
  },
  {
    name: 'reference', label: 'Transaction reference', type: 'text',
    hint: 'Required for a bank transfer or a card — it is what the statement is reconciled against.',
  },
  { name: 'notes', label: 'Notes', type: 'textarea', full: true },
])

// The day's and the month's takings come from the overview endpoint, which
// counts them in the database. Adding the visible page would count only the
// page, and a clerk balancing a drawer would be told the wrong number.
const takings = computed(() => {
  const f = overview.data.value?.fees
  return {
    todayUsd: num(f?.today_usd), todayZwg: num(f?.today_zwg),
    monthUsd: num(f?.month_usd), monthZwg: num(f?.month_zwg),
    count: num(f?.today_count),
  }
})

const showMonth = ref(false)

// ── The fees the cash office and online payments took (migration 246) ─────
const fees = ref<CashOfficeFee[]>([])
const feesTotal = ref(0)
const feesQuery = ref('')
const feesLoading = ref(false)
const feesError = ref<string | null>(null)
async function loadFees() {
  feesLoading.value = true
  feesError.value = null
  try {
    const r = await listCashOfficeFees({ ...(feesQuery.value.trim() ? { q: feesQuery.value.trim() } : {}), limit: 50 })
    fees.value = r.rows
    feesTotal.value = r.total
  } catch {
    feesError.value = 'The fees could not be read. Try again in a moment.'
  } finally {
    feesLoading.value = false
  }
}
let feesTimer: ReturnType<typeof setTimeout> | undefined
watch(feesQuery, () => { clearTimeout(feesTimer); feesTimer = setTimeout(loadFees, 300) })
onMounted(loadFees)

const KIND_LABEL = Object.fromEntries(FEE_KINDS.map((k) => [k.value, k.label])) as Record<string, string>
const STATE_LABEL: Record<CashOfficeFee['state'], string> = {
  awaiting_voucher: 'Paid online, not yet in the books',
  awaiting_posting: 'Paid, waiting for Finance to post',
  posted: 'In the books',
  cancelled: 'Receipt cancelled',
}
const feeFile = (f: CashOfficeFee) => f.tpd_reference || f.dev_register_no || (f.stand_number ? `Stand ${f.stand_number}` : 'No file')
const feeHow = (f: CashOfficeFee) => (f.source === 'counter' ? `Cash office${f.method ? ` · ${asLabel(f.method)}` : ''}` : 'Online')
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Registers</span>
        <h2 class="ins-title">Fees</h2>
        <p class="ins-lede">
          Planning fees are paid at the cash office, where the cashier names the
          application, or online. Both reach the council's books, and an
          application fee marks its application paid. This page shows what came in.
        </p>
      </div>
      <div class="ins-actions">
        <div class="ins-seg" role="group" aria-label="Takings period">
          <button type="button" :aria-pressed="!showMonth" @click="showMonth = false">Today</button>
          <button type="button" :aria-pressed="showMonth" @click="showMonth = true">This month</button>
        </div>
      </div>
    </header>

    <!-- Two currencies side by side and never added together: an exchange rate
         applied by a screen is a number nobody can reconcile. -->
    <section class="ins-kpis" aria-label="Counter takings">
      <div class="clk-take">
        <span class="clk-take-label">
          <Banknote :size="14" aria-hidden="true" />
          {{ showMonth ? 'This month' : 'Today' }} · USD
        </span>
        <strong class="clk-take-value ins-mono">
          {{ formatMoney(showMonth ? takings.monthUsd : takings.todayUsd, 'USD') }}
        </strong>
      </div>
      <div class="clk-take">
        <span class="clk-take-label">
          <Wallet :size="14" aria-hidden="true" />
          {{ showMonth ? 'This month' : 'Today' }} · ZWG
        </span>
        <strong class="clk-take-value ins-mono">
          {{ formatMoney(showMonth ? takings.monthZwg : takings.todayZwg, 'ZWG') }}
        </strong>
      </div>
      <div class="clk-take">
        <span class="clk-take-label">Receipts issued today</span>
        <strong class="clk-take-value ins-mono">{{ takings.count }}</strong>
      </div>
    </section>

    <section class="ins-card" aria-labelledby="clk-fees-h" data-testid="clk-cash-office-fees">
      <header class="ins-card-head">
        <h3 id="clk-fees-h" class="clk-fees-title">
          <Landmark :size="16" aria-hidden="true" /> Fees received
          <span class="ins-count">{{ feesTotal }}</span>
        </h3>
        <label class="clk-fees-search">
          <Search :size="14" aria-hidden="true" />
          <input v-model="feesQuery" type="search" class="ins-input" placeholder="File, stand, payer or receipt"
                 aria-label="Search fees received" />
        </label>
      </header>
      <div class="ins-card-body">
        <p class="clk-fees-note">
          To take a fee, send the applicant to the cash office with the file reference.
          The cashier finds the application, issues the council's receipt, and the fee
          shows here at once.
        </p>
        <p v-if="feesError" class="clk-fees-error" role="alert">{{ feesError }}</p>
        <p v-else-if="feesLoading && !fees.length" class="clk-fees-note">Reading the fees…</p>
        <p v-else-if="!fees.length" class="clk-fees-note">
          {{ feesQuery ? 'No fee matches.' : 'No fee has been received at the cash office or online yet.' }}
        </p>
        <div v-else class="clk-fees-wrap">
          <table class="clk-fees-table">
            <thead>
              <tr><th>Received</th><th>File</th><th>For</th><th>Paid by</th><th>How</th><th class="num">Amount</th><th>Receipt</th><th>Books</th></tr>
            </thead>
            <tbody>
              <tr v-for="f in fees" :key="f.id">
                <td class="ins-mono">{{ f.received_on }}</td>
                <td class="ins-mono">{{ feeFile(f) }}</td>
                <td>{{ KIND_LABEL[f.fee_kind] ?? asLabel(f.fee_kind) }}</td>
                <td>{{ f.payer_name || '—' }}</td>
                <td>{{ feeHow(f) }}</td>
                <td class="num ins-mono">{{ formatMoney(f.amount, f.currency) }}</td>
                <td class="ins-mono">{{ f.receipt_no || f.reference || '—' }}</td>
                <td><span class="clk-fee-state" :class="`is-${f.state}`">{{ STATE_LABEL[f.state] }}</span></td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </section>

    <ClerkRegister
      register="receipts"
      title="Receipts written at this desk before (history)"
      lede="Kept as it was. Planning fees are now receipted at the cash office, so this register takes no new entries."
      search-hint="Receipt number, payer or transaction reference"
      :columns="columns"
      :fields="fields"
      read-only
    />
  </div>
</template>

<style scoped>
.clk-take { display:flex; flex-direction:column; gap:var(--ent-s1);
  padding:var(--ent-s3) var(--ent-s4);
  background:var(--ent-surface); border:1px solid var(--ent-line);
  border-radius:var(--ent-r-md); box-shadow:var(--ent-e1); }
.clk-take-label { display:inline-flex; align-items:center; gap:var(--ent-s2);
  font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold);
  letter-spacing:0.05em; text-transform:uppercase; color:var(--ent-text-3); }
.clk-take-value { font-size:var(--ent-fs-num); font-weight:var(--ent-fw-bold);
  line-height:var(--ent-lh-tight); color:var(--ent-text);
  font-variant-numeric:tabular-nums; }

.clk-fees-title { display:inline-flex; align-items:center; gap:var(--ent-s2); margin:0; }
.clk-fees-search { position:relative; display:inline-flex; align-items:center; margin-left:auto; }
.clk-fees-search svg { position:absolute; left:var(--ent-s2); color:var(--ent-text-3); }
.clk-fees-search input { padding-left:calc(var(--ent-s2) + 18px); min-width:16rem; }
.clk-fees-note { margin:0 0 var(--ent-s3); color:var(--ent-text-2); }
.clk-fees-error { margin:0; color:var(--ent-danger); }
.clk-fees-wrap { overflow-x:auto; }
.clk-fees-table { width:100%; border-collapse:collapse; font-size:var(--ent-fs-sm); }
.clk-fees-table th, .clk-fees-table td { padding:var(--ent-s2) var(--ent-s3); border-bottom:1px solid var(--ent-line); text-align:left; vertical-align:top; }
.clk-fees-table th { font-size:var(--ent-fs-micro); text-transform:uppercase; letter-spacing:0.05em; color:var(--ent-text-3); }
.clk-fees-table .num { text-align:right; white-space:nowrap; }
.clk-fee-state { display:inline-block; padding:1px var(--ent-s2); border-radius:999px; font-size:var(--ent-fs-micro); font-weight:var(--ent-fw-semibold); background:var(--ent-surface-2); color:var(--ent-text-2); }
.clk-fee-state.is-posted { background:var(--ent-success-soft); color:var(--ent-success); }
.clk-fee-state.is-awaiting_voucher { background:var(--ent-warning-soft); color:var(--ent-warning); }
.clk-fee-state.is-cancelled { text-decoration:line-through; }

@media (max-width: 767px) {
  .clk-take-value { font-size:var(--ent-fs-xl); }
  .clk-fees-search { margin-left:0; width:100%; }
  .clk-fees-search input { min-width:0; width:100%; }
}
</style>
