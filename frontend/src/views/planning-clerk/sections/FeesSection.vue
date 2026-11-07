<script setup lang="ts">
// Fees and cashbook — the counter's own receipt register.
//
// This is what came over the desk in cash, EcoCash, a cheque or a card, which
// is a different record from public.payments (what a citizen paid online).
// Both exist and both are real; reconciling them at the end of the day is the
// clerk's job, and it cannot be done if one of them lives in a browser.
//
// TWO CURRENCIES, ALWAYS NAMED
// The council keeps books in USD and ZWG at the same time. Every total on
// this screen is per currency and never summed across them — an exchange rate
// applied by a screen is a number nobody can reconcile against a bank
// statement, and the rate that matters is the one on the day of the deposit.

import { computed, ref } from 'vue'
import ClerkRegister from '@/components/planning-clerk/ClerkRegister.vue'
import type { ClerkColumn, ClerkField } from '@/planning-clerk/registerSpec'
import { asLabel, formatMoney, formatWhen, toDateTimeInput } from '@/planning-clerk/console'
import { useClerkPreferences } from '@/planning-clerk/useClerkConsole'
import { useClerkOverview } from '@/planning-clerk/useClerkOverview'
import { num } from '@/services/planningClerk'
import { Banknote, Wallet } from 'lucide-vue-next'

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
</script>

<template>
  <div class="ins-page">
    <header class="ins-head">
      <div class="ins-head-text">
        <span class="ins-eyebrow">Registers</span>
        <h2 class="ins-title">Fees &amp; cashbook</h2>
        <p class="ins-lede">
          Receipts issued at the counter, in both currencies. Online payments
          are the payments gateway’s record, not this one; reconciling the two
          at the end of the day is what this register is for.
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

    <ClerkRegister
      register="receipts"
      title="Counter receipts"
      add-label="Receipt a payment"
      search-hint="Receipt number, payer or transaction reference"
      :columns="columns"
      :fields="fields"
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

@media (max-width: 767px) {
  .clk-take-value { font-size:var(--ent-fs-xl); }
}
</style>
