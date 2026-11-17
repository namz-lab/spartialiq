<script setup lang="ts">
/**
 * A property's financial profile: what Planning records about the stand beside what Finance holds
 * about its account. Opened by clicking a parcel on the finance map or choosing a search result.
 *
 * Read only. A cashier's "Take payment" hands over to the existing Take Payment page with the
 * account and the oldest open bill chosen; the receipt is issued there, under the cash office's
 * controls, and posted by somebody else. Nothing here changes a Planning record.
 */
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import {
  X, MapPin, CreditCard, FileText, Download, Printer, Landmark, User, History, ReceiptText,
  AlertTriangle, CircleCheck, Clock, Info, Crosshair, Building2, PlugZap,
} from 'lucide-vue-next'
import { formatMoney, formatDate } from '../../composables/useMoney'
import { ratesApi } from '../../api/ratesApi'
import { messageOf, useFinanceStore } from '../../stores/finance'
import type { Currency } from '../../models/types'
import { STATUS_COLOURS, LAND_USE_LABELS, type PropertyProfile } from '../../api/propertyApi'

const props = defineProps<{
  profile: PropertyProfile | null
  loading: boolean
  error: string | null
  /** The workspace showing it; decides the actions offered and whether names are shown. */
  mode: string
  canPay: boolean
}>()
const emit = defineEmits<{ close: []; zoom: []; changed: [] }>()
const store = useFinanceStore()
/** Posting is the accountant's act; the server refuses the person who took the payment. */
const canPost = computed(() => store.can('finance.ledger.voucher.post') && props.mode !== 'publisher')
const posting = ref<string | null>(null)
const postMsg = ref<{ tone: 'ok' | 'neg'; text: string } | null>(null)
async function post(id: string, no: string): Promise<void> {
  posting.value = id
  postMsg.value = null
  try {
    await ratesApi.postReceipt(id)
    postMsg.value = { tone: 'ok', text: `Receipt ${no} posted to the ledger. The balance now includes it.` }
    emit('changed')
  } catch (e) {
    postMsg.value = { tone: 'neg', text: messageOf(e, `Receipt ${no} could not be posted.`) }
  } finally {
    posting.value = null
  }
}

type Tab = 'overview' | 'bills' | 'payments' | 'history'
const tab = ref<Tab>('overview')

const p = computed(() => props.profile?.property ?? null)
const anonymous = computed(() => props.mode === 'publisher')
const money = (v: string | null | undefined, c: Currency = 'USD') => formatMoney(v, c)
const num = (v: string | null | undefined) => Number(v ?? 0)
const area = computed(() => {
  const m2 = num(p.value?.area_m2)
  return m2 >= 10000 ? `${(m2 / 10000).toLocaleString('en-GB', { maximumFractionDigits: 1 })} ha` : `${Math.round(m2).toLocaleString('en-GB')} m²`
})
const openBills = computed(() => (props.profile?.bills ?? []).filter((b) => num(b.open_amount) > 0 && b.voucher_status === 'posted'))
const oldestOpen = computed(() => [...openBills.value].sort((a, b) => a.period_from.localeCompare(b.period_from))[0] ?? null)
const pending = computed(() => (props.profile?.receipts ?? []).filter((r) => r.voucher_status === 'draft'))
const usd = computed(() => props.profile?.balances.find((b) => b.currency === 'USD') ?? null)
const zwg = computed(() => props.profile?.balances.find((b) => b.currency === 'ZWG') ?? null)
const isDemo = computed(() => props.profile?.demonstration_data === true)
const statusTone = computed(() => {
  const s = p.value?.financial_status
  if (s === 'paid_up') return 'pos'
  if (s === 'overdue' || s === 'allocated_no_account') return 'neg'
  if (s === 'awaiting_payment' || s === 'partially_paid') return 'warn'
  return 'info'
})
const payLink = computed(() => p.value?.rates_account_id
  ? { name: 'cashier-pay', query: { account: p.value.rates_account_id, parcel: p.value.parcel_id, ...(oldestOpen.value ? { bill: oldestOpen.value.id } : {}) } }
  : null)
const statementLink = computed(() => p.value?.rates_account_id && ['revenue'].includes(props.mode)
  ? { name: 'rev-statement', params: { id: p.value.rates_account_id } } : null)

/** Statement lines in date order with a running balance per currency, from the documents shown. */
const statementLines = computed(() => {
  const pr = props.profile
  if (!pr) return []
  const lines = [
    ...pr.bills.filter((b) => b.voucher_status === 'posted').map((b) => ({
      date: b.issued_on || b.period_from, ref: b.bill_no, text: `Rates ${formatDate(b.period_from)} – ${formatDate(b.period_to)}`,
      currency: b.currency, debit: num(b.amount), credit: 0, state: 'posted',
    })),
    ...pr.receipts.map((r) => ({
      date: r.received_on, ref: r.receipt_no, text: `Payment${r.method ? ` (${r.method.replace('_', ' ')})` : ''}`,
      currency: r.currency, debit: 0, credit: num(r.amount), state: r.voucher_status,
    })),
  ].sort((a, b) => a.date.localeCompare(b.date) || a.ref.localeCompare(b.ref))
  const run: Record<string, number> = {}
  return lines.map((l) => {
    if (l.state === 'posted') run[l.currency] = Math.round(((run[l.currency] ?? 0) + l.debit - l.credit) * 100) / 100
    return { ...l, balance: run[l.currency] ?? 0 }
  })
})

function csv(): void {
  const pr = props.profile
  if (!pr) return
  const rows = [['Date', 'Reference', 'Description', 'Currency', 'Charge', 'Payment', 'Balance', 'State']]
  for (const l of statementLines.value) rows.push([l.date, l.ref, l.text, l.currency, l.debit ? l.debit.toFixed(2) : '', l.credit ? l.credit.toFixed(2) : '', l.balance.toFixed(2), l.state === 'draft' ? 'awaiting posting' : l.state])
  const body = rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n')
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([body], { type: 'text/csv' }))
  a.download = `statement-${pr.property.account_no ?? pr.property.parcel_id}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}

function printStatement(): void {
  const pr = props.profile
  if (!pr) return
  const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
  const rows = statementLines.value.map((l) => `<tr><td>${esc(formatDate(l.date))}</td><td>${esc(l.ref)}</td><td>${esc(l.text)}${l.state === 'draft' ? ' <em>(awaiting posting)</em>' : ''}</td>
    <td class="n">${l.debit ? esc(money(l.debit.toFixed(2), l.currency)) : ''}</td><td class="n">${l.credit ? esc(money(l.credit.toFixed(2), l.currency)) : ''}</td>
    <td class="n">${esc(money(l.balance.toFixed(2), l.currency))}</td></tr>`).join('')
  const bal = pr.balances.map((b) => `${esc(money(b.balance, b.currency))}`).join(' · ') || 'Nil'
  const w = window.open('', '_blank', 'width=900,height=1000')
  if (!w) return
  w.document.write(`<!doctype html><html><head><title>Statement ${esc(pr.property.account_no)}</title>
  <style>body{font:13px/1.45 system-ui,sans-serif;color:#1a2430;margin:32px}h1{font-size:20px;margin:0}h2{font-size:14px;margin:18px 0 6px}
  table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border-bottom:1px solid #dde2e9;padding:6px 8px;text-align:left}th{background:#f1f4f9}
  .n{text-align:right;font-variant-numeric:tabular-nums}.meta{display:grid;grid-template-columns:repeat(2,1fr);gap:4px 24px;margin-top:12px}
  .note{color:#515c6b;font-size:12px;margin-top:16px}.demo{border:1px solid #a35b00;color:#a35b00;padding:6px 10px;border-radius:6px;display:inline-block;margin-top:10px}</style></head><body>
  <h1>Vungu Rural District Council — Account Statement</h1>
  <div>Printed ${esc(new Date().toLocaleString('en-GB'))}</div>
  ${isDemo.value ? '<div class="demo">Demonstration data — not a council record</div>' : ''}
  <div class="meta"><div><b>Account</b> ${esc(pr.property.account_no)}</div><div><b>Account holder</b> ${esc(pr.property.party_name)}</div>
  <div><b>Stand</b> ${esc(pr.property.township_code ?? '')} ${esc(pr.property.stand_no)} (${esc(pr.property.parcel_id)})</div><div><b>Ward</b> ${esc(pr.property.ward_name ?? '—')}</div>
  <div><b>Land use</b> ${esc(pr.property.land_use ?? '—')}</div><div><b>Balance</b> ${bal}</div></div>
  <h2>Transactions</h2><table><thead><tr><th>Date</th><th>Reference</th><th>Description</th><th class="n">Charge</th><th class="n">Payment</th><th class="n">Balance</th></tr></thead><tbody>${rows}</tbody></table>
  <p class="note">${esc(pr.basis)}</p><script>window.onload=()=>window.print()<\/script></body></html>`)
  w.document.close()
}
</script>

<template>
  <aside class="pp" aria-label="Property financial profile" :aria-busy="loading">
    <header class="pp-head">
      <div class="pp-head-text">
        <p class="pp-eyebrow"><MapPin :size="14" aria-hidden="true" /> {{ p?.parcel_kind === 'farm' ? 'Farm parcel' : 'Stand' }}<template v-if="p?.township_code"> · {{ p.township_code }}</template></p>
        <h3>{{ p ? (p.parcel_kind === 'stand' ? `Stand ${p.stand_no}` : p.stand_no) : (loading ? 'Loading…' : 'Property') }}</h3>
        <p v-if="p" class="pp-sub">{{ p.parcel_id }}<template v-if="p.ward_name"> · Ward {{ p.ward_name }}</template></p>
      </div>
      <button type="button" class="pp-icon-btn" title="Zoom to property" aria-label="Zoom to property" @click="emit('zoom')"><Crosshair :size="18" /></button>
      <button type="button" class="pp-icon-btn" aria-label="Close profile" @click="emit('close')"><X :size="18" /></button>
    </header>

    <p v-if="error" class="pp-msg pp-msg--neg" role="alert"><AlertTriangle :size="16" aria-hidden="true" />{{ error }}</p>
    <div v-else-if="loading && !profile" class="pp-skel" aria-hidden="true"><span /><span /><span /><span /></div>

    <template v-if="profile && p">
      <div class="pp-status" :data-tone="statusTone">
        <span class="pp-dot" :style="{ background: STATUS_COLOURS[p.financial_status] }" aria-hidden="true" />
        <div>
          <strong>{{ p.financial_status_label }}</strong>
          <small v-if="p.payment_pending_posting"><Clock :size="12" aria-hidden="true" /> A payment is receipted and waiting for the accountant to post it.</small>
          <small v-else-if="p.oldest_days && num(p.usd_balance) > 0">Oldest unpaid bill {{ p.oldest_days }} days</small>
        </div>
      </div>
      <p v-if="isDemo" class="pp-demo"><Info :size="14" aria-hidden="true" /> Boundary from the Planning register; account, charges and payments are demonstration data.</p>

      <div class="pp-figs">
        <div><span>Outstanding</span><strong class="num" :class="{ neg: num(usd?.owed) > 0 }">{{ money(usd?.owed ?? '0') }}</strong>
          <small v-if="num(p.usd_pending) > 0" class="pp-after">{{ money(Math.max(0, num(usd?.owed) - num(p.usd_pending)).toFixed(2)) }} once posted</small></div>
        <div><span>Overdue</span><strong class="num">{{ money(usd?.overdue ?? '0') }}</strong></div>
        <div><span>Paid to date</span><strong class="num">{{ money(p.usd_paid) }}</strong></div>
        <div><span>Billed to date</span><strong class="num">{{ money(p.usd_billed) }}</strong></div>
      </div>
      <p v-if="zwg" class="pp-zwg">ZWG account: balance {{ money(zwg.balance, 'ZWG') }}<template v-if="num(zwg.overdue) > 0">, overdue {{ money(zwg.overdue, 'ZWG') }}</template></p>
      <p v-if="pending.length" class="pp-msg pp-msg--info"><Clock :size="16" aria-hidden="true" />
        {{ pending.length }} receipt{{ pending.length === 1 ? '' : 's' }} for {{ money(p.usd_pending) }} taken and awaiting posting. The balance changes when the accountant posts {{ pending.length === 1 ? 'it' : 'them' }}.</p>

      <div class="pp-actions">
        <RouterLink v-if="canPay && payLink" :to="payLink" class="pp-btn pp-btn--primary" data-action="take-payment">
          <CreditCard :size="16" aria-hidden="true" /> Take payment
        </RouterLink>
        <RouterLink v-if="statementLink" :to="statementLink" class="pp-btn"><FileText :size="16" aria-hidden="true" /> Rates statement</RouterLink>
        <button v-if="p.rates_account_id && !anonymous" type="button" class="pp-btn" @click="printStatement"><Printer :size="16" aria-hidden="true" /> Print statement</button>
        <button v-if="p.rates_account_id && !anonymous" type="button" class="pp-btn" @click="csv"><Download :size="16" aria-hidden="true" /> CSV</button>
      </div>

      <div class="pp-tabs" role="tablist">
        <button v-for="t in ([['overview', 'Overview'], ['bills', `Invoices (${profile.bills.length})`], ['payments', `Payments (${profile.receipts.length})`], ['history', 'History']] as const)"
          :key="t[0]" type="button" role="tab" :aria-selected="tab === t[0]" :class="{ on: tab === t[0] }" @click="tab = t[0]">{{ t[1] }}</button>
      </div>

      <section v-if="tab === 'overview'" class="pp-sec">
        <h4><Building2 :size="15" aria-hidden="true" /> Property <small>Planning register</small></h4>
        <dl class="pp-dl">
          <dt>Stand number</dt><dd>{{ p.stand_no }}</dd>
          <dt>Property reference</dt><dd>{{ p.parcel_id }}</dd>
          <dt>Suburb / township</dt><dd>{{ p.township_code ?? 'Rural' }}</dd>
          <dt>Ward</dt><dd>{{ p.ward_name ? `Ward ${p.ward_name}` : '—' }}<small v-if="p.ward_derived"> (from location)</small></dd>
          <dt>Size</dt><dd>{{ area }}</dd>
          <dt>Land use</dt><dd>{{ p.land_use ?? LAND_USE_LABELS[p.land_use_class] }}</dd>
          <dt>Planning status</dt><dd>{{ p.offer_status ? `On offer: ${p.offer_status}` : 'Not offered for sale' }}</dd>
          <dt>Allocation</dt><dd>{{ p.is_allocated ? (p.allocation_reference ? `Allocated · ${p.allocation_reference}` : 'Allocated') : 'Not allocated' }}</dd>
          <template v-if="!anonymous"><dt>Allottee (Planning)</dt><dd>{{ p.allottee_name ?? '—' }}</dd></template>
        </dl>
        <h4><User :size="15" aria-hidden="true" /> Account <small>Finance</small></h4>
        <dl v-if="p.rates_account_id" class="pp-dl">
          <dt>Account number</dt><dd><strong>{{ p.account_no }}</strong></dd>
          <template v-if="!anonymous">
            <dt>Account holder</dt><dd>{{ p.party_name }}</dd>
            <dt>Customer number</dt><dd>{{ profile.party?.reference ?? '—' }}</dd>
            <dt v-if="profile.party?.national_id">National ID</dt><dd v-if="profile.party?.national_id">{{ profile.party.national_id }}</dd>
            <dt v-if="profile.party?.contact_phone">Phone</dt><dd v-if="profile.party?.contact_phone">{{ profile.party.contact_phone }}</dd>
          </template>
          <dt>Opened</dt><dd>{{ formatDate(p.opened_on) }}</dd>
          <dt>Last payment</dt><dd>{{ formatDate(p.last_paid_on) }}</dd>
        </dl>
        <p v-else class="pp-msg pp-msg--warn"><PlugZap :size="16" aria-hidden="true" />
          {{ p.is_allocated ? 'Allocated in Planning but no finance account is open yet. The Planning integration opens it on its next run.' : 'No finance account: nothing is billed on this property.' }}</p>
        <h4><Landmark :size="15" aria-hidden="true" /> Charges</h4>
        <dl class="pp-dl">
          <dt>Purchase price</dt><dd>{{ profile.purchase ? money(profile.purchase.price_usd) : '—' }}</dd>
          <dt>Rates and service charges</dt><dd>{{ money(p.usd_billed) }} billed</dd>
          <dt>Capital charges, levies</dt><dd>None billed</dd>
          <dt>Penalties and interest</dt><dd>None billed</dd>
          <dt>Total outstanding</dt><dd><strong>{{ money(usd?.owed ?? '0') }}</strong></dd>
          <dt v-if="num(usd?.unallocated_credit) > 0">Unallocated payments</dt><dd v-if="num(usd?.unallocated_credit) > 0">{{ money(usd?.unallocated_credit) }} in credit</dd>
        </dl>
        <p v-if="profile.purchase" class="pp-note">{{ profile.purchase.note }}</p>
      </section>

      <section v-else-if="tab === 'bills'" class="pp-sec">
        <p v-if="!profile.bills.length" class="pp-empty">No invoice has been raised on this property.</p>
        <table v-else class="pp-table">
          <thead><tr><th>Invoice</th><th>Period</th><th class="n">Amount</th><th class="n">Open</th></tr></thead>
          <tbody>
            <tr v-for="b in profile.bills" :key="b.id" :class="{ open: num(b.open_amount) > 0 }">
              <td>{{ b.bill_no }}<small v-if="b.voucher_status !== 'posted'"> {{ b.voucher_status }}</small></td>
              <td>{{ formatDate(b.period_from) }}<small v-if="b.days_outstanding && num(b.open_amount) > 0"> · {{ b.days_outstanding }}d</small></td>
              <td class="n num">{{ money(b.amount, b.currency) }}</td>
              <td class="n num">{{ num(b.open_amount) > 0 ? money(b.open_amount, b.currency) : 'Settled' }}</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-else-if="tab === 'payments'" class="pp-sec">
        <p v-if="postMsg" class="pp-msg" :class="postMsg.tone === 'ok' ? 'pp-msg--ok' : 'pp-msg--neg'" role="status">{{ postMsg.text }}</p>
        <p v-if="!profile.receipts.length" class="pp-empty">No payment has been received on this property.</p>
        <table v-else class="pp-table">
          <thead><tr><th>Receipt</th><th>Date</th><th class="n">Amount</th><th>State</th></tr></thead>
          <tbody>
            <tr v-for="r in profile.receipts" :key="r.id">
              <td>{{ r.receipt_no }}<small v-if="r.method"> · {{ r.method.replace('_', ' ') }}</small></td>
              <td>{{ formatDate(r.received_on) }}</td>
              <td class="n num">{{ money(r.amount, r.currency) }}</td>
              <td><span class="pp-pill" :data-s="r.voucher_status">{{ r.voucher_status === 'draft' ? 'Awaiting posting' : 'Posted' }}</span>
                <button v-if="canPost && r.voucher_status === 'draft'" type="button" class="pp-post" :disabled="posting === r.id" @click="post(r.id, r.receipt_no)">{{ posting === r.id ? 'Posting…' : 'Post' }}</button></td>
            </tr>
          </tbody>
        </table>
      </section>

      <section v-else class="pp-sec">
        <ol class="pp-timeline">
          <li v-for="a in profile.allocations" :key="a.id"><History :size="14" aria-hidden="true" />
            <div><strong>{{ a.status === 'revoked' ? 'Allocation revoked' : 'Allocated' }}</strong> {{ formatDate(a.allocated_at?.slice(0, 10)) }} · {{ a.reference_no }}
              <small v-if="!anonymous">{{ a.allocated_to_name || a.allottee_name }} · {{ a.purpose }}</small>
              <small v-if="a.revoked_at">Revoked {{ formatDate(a.revoked_at.slice(0, 10)) }}: {{ a.revoke_reason }}</small></div></li>
          <li v-for="ac in profile.accounts" :key="ac.id"><User :size="14" aria-hidden="true" />
            <div><strong>Account {{ ac.account_no }} {{ ac.status === 'closed' ? 'closed' : 'opened' }}</strong> {{ formatDate(ac.status === 'closed' ? ac.closed_on : ac.opened_on) }}
              <small v-if="!anonymous">{{ ac.party_name }}<template v-if="ac.party_reference"> · {{ ac.party_reference }}</template></small>
              <small v-if="ac.notes">{{ ac.notes }}</small></div></li>
          <li v-for="e in profile.events" :key="e.id"><PlugZap :size="14" aria-hidden="true" />
            <div><strong>{{ e.event_type }}</strong> · {{ e.status }} · {{ formatDate(e.detected_at.slice(0, 10)) }}
              <small>{{ e.outcome || e.last_error }}</small></div></li>
          <li v-for="r in profile.receipts.slice(0, 5)" :key="r.id"><ReceiptText :size="14" aria-hidden="true" />
            <div><strong>Payment {{ money(r.amount, r.currency) }}</strong> {{ formatDate(r.received_on) }} · {{ r.receipt_no }}<small v-if="r.taken_by">Taken by {{ r.taken_by }}<template v-if="r.session_no"> · {{ r.session_no }}</template></small></div></li>
        </ol>
        <p v-if="!profile.allocations.length && !profile.accounts.length && !profile.events.length" class="pp-empty">No allocation, account or integration event is recorded.</p>
      </section>

      <p class="pp-basis"><CircleCheck :size="13" aria-hidden="true" /> {{ profile.basis }}</p>
    </template>
  </aside>
</template>

<style scoped>
.pp { display: flex; flex-direction: column; gap: 10px; padding: 14px 16px 18px; background: var(--cw-surface, #fff); height: 100%; overflow-y: auto; }
.pp-head { display: flex; align-items: flex-start; gap: 6px; }
.pp-head-text { flex: 1; min-width: 0; }
.pp-eyebrow { margin: 0; font-size: 12px; font-weight: 600; color: var(--cw-ink-3, #5c6775); display: flex; align-items: center; gap: 4px; text-transform: uppercase; letter-spacing: 0.04em; }
.pp h3 { margin: 2px 0 0; font-size: 20px; font-weight: 700; letter-spacing: -0.01em; }
.pp-sub { margin: 2px 0 0; font-size: 12.5px; color: var(--cw-ink-2, #515c6b); }
.pp-icon-btn { border: 1px solid var(--cw-line, #dde2e9); background: #fff; border-radius: 8px; width: 34px; height: 34px; display: grid; place-items: center; cursor: pointer; color: var(--cw-ink-2); }
.pp-icon-btn:hover { background: var(--cw-row-hover, #f5f8fc); }
.pp-status { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border-radius: 10px; background: var(--cw-info-soft, #e5f0fd); }
.pp-status[data-tone='pos'] { background: var(--cw-pos-soft, #e3f6e9); }
.pp-status[data-tone='neg'] { background: var(--cw-neg-soft, #fde8e8); }
.pp-status[data-tone='warn'] { background: var(--cw-warn-soft, #fff3df); }
.pp-status strong { display: block; font-size: 14.5px; }
.pp-status small { display: flex; gap: 4px; align-items: center; color: var(--cw-ink-2); font-size: 12.5px; margin-top: 2px; }
.pp-dot { width: 14px; height: 14px; border-radius: 4px; flex: none; margin-top: 3px; box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15); }
.pp-demo { margin: 0; font-size: 12px; color: var(--cw-warn, #a35b00); display: flex; gap: 6px; align-items: flex-start; border: 1px dashed #e2b56b; border-radius: 8px; padding: 6px 8px; }
.pp-figs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.pp-figs div { border: 1px solid var(--cw-card-line, #e3e8ee); border-radius: 9px; padding: 8px 10px; }
.pp-figs span { display: block; font-size: 12px; color: var(--cw-ink-3); font-weight: 600; }
.pp-figs strong { font-size: 17px; font-weight: 700; }
.pp-figs strong.neg { color: var(--cw-neg, #c62828); }
.pp-after { display: block; font-size: 12px; font-weight: 600; color: var(--cw-info, #1559b3); }
.pp-zwg { margin: 0; font-size: 12.5px; color: var(--cw-ink-2); }
.pp-actions { display: flex; flex-wrap: wrap; gap: 8px; }
.pp-btn { display: inline-flex; align-items: center; gap: 6px; border: 1px solid var(--cw-line-2, #808b99); background: #fff; color: var(--cw-ink); border-radius: 8px; padding: 7px 11px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; text-decoration: none; }
.pp-btn:hover { background: var(--cw-row-hover); }
.pp-btn--primary { background: var(--cw-accent, #1f5aa8); border-color: var(--cw-accent); color: #fff; }
.pp-btn--primary:hover { background: var(--cw-accent-2, #194a8c); }
.pp-tabs { display: flex; gap: 2px; border-bottom: 1px solid var(--cw-line); margin-top: 4px; }
.pp-tabs button { border: 0; background: none; padding: 8px 10px; font: inherit; font-size: 13px; font-weight: 600; color: var(--cw-ink-3); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -1px; }
.pp-tabs button.on { color: var(--cw-accent); border-bottom-color: var(--cw-accent); }
.pp-sec h4 { margin: 12px 0 6px; font-size: 13.5px; display: flex; align-items: center; gap: 6px; }
.pp-sec h4 small { font-weight: 500; color: var(--cw-ink-3); font-size: 12px; }
.pp-dl { display: grid; grid-template-columns: minmax(120px, 42%) 1fr; gap: 5px 10px; margin: 0; font-size: 13px; }
.pp-dl dt { color: var(--cw-ink-3); }
.pp-dl dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.pp-dl small { color: var(--cw-ink-3); }
.pp-note, .pp-basis { font-size: 12px; color: var(--cw-ink-3); margin: 8px 0 0; display: flex; gap: 6px; align-items: flex-start; }
.pp-msg { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; border-radius: 8px; padding: 8px 10px; margin: 0; }
.pp-msg--neg { background: var(--cw-neg-soft); color: var(--cw-neg); }
.pp-msg--info { background: var(--cw-info-soft); color: var(--cw-info); }
.pp-msg--ok { background: var(--cw-pos-soft); color: var(--cw-pos); margin-bottom: 8px; }
.pp-post { margin-left: 6px; border: 1px solid var(--cw-accent); background: #fff; color: var(--cw-accent); border-radius: 6px; font: inherit; font-size: 11.5px; font-weight: 700; padding: 1px 8px; cursor: pointer; }
.pp-post:disabled { opacity: 0.6; }
.pp-msg--warn { background: var(--cw-warn-soft); color: var(--cw-warn); }
.pp-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
.pp-table th { text-align: left; background: var(--cw-thead, #f1f4f9); padding: 6px 8px; font-weight: 600; color: var(--cw-ink-2); }
.pp-table td { padding: 6px 8px; border-bottom: 1px solid var(--cw-line); }
.pp-table td small { color: var(--cw-ink-3); }
.pp-table .n { text-align: right; }
.pp-table tr.open td:last-child { color: var(--cw-neg); font-weight: 600; }
.pp-pill { font-size: 11.5px; font-weight: 600; padding: 2px 7px; border-radius: 99px; background: var(--cw-pos-soft); color: var(--cw-pos); white-space: nowrap; }
.pp-pill[data-s='draft'] { background: var(--cw-warn-soft); color: var(--cw-warn); }
.pp-timeline { list-style: none; margin: 0; padding: 0; display: grid; gap: 10px; font-size: 13px; }
.pp-timeline li { display: flex; gap: 8px; align-items: flex-start; }
.pp-timeline li > svg { margin-top: 3px; color: var(--cw-accent); flex: none; }
.pp-timeline small { display: block; color: var(--cw-ink-3); font-size: 12px; }
.pp-empty { color: var(--cw-ink-3); font-size: 13px; }
.pp-skel { display: grid; gap: 10px; }
.pp-skel span { height: 46px; border-radius: 9px; background: linear-gradient(90deg, #eef1f5, #f6f8fa, #eef1f5); background-size: 200% 100%; animation: pp-sh 1.2s infinite linear; }
@keyframes pp-sh { to { background-position: -200% 0; } }
@media (prefers-reduced-motion: reduce) { .pp-skel span { animation: none; } }
</style>
