<script setup lang="ts">
/**
 * The accountant's dashboard. Every figure comes from `GET /finance/accounting/dashboard` for the
 * year chosen in the banner, from posted ledger entries only, one figure per currency. The money
 * shown largest is in the year's reporting currency; the other currency is shown under it and is
 * never added to it (decision D4).
 *
 * Verifying or returning a cash-up here is the same act as on Cash-Up Approvals, refused by the
 * database for anyone who counted, closed or witnessed the drawer (control C4).
 */
import { computed, ref } from 'vue'
import { RouterLink, useRouter } from 'vue-router'
import {
  Coins, CreditCard, Scale, Gauge, TriangleAlert, ClipboardList, SquareCheckBig, Zap, BookOpen, FilePlus,
  Landmark, ChartColumn, Lock, Layers, UserRound, Users, Target, ArrowLeftRight, Bell, CircleAlert, Info,
  Eye, Check, X, Circle, ChevronRight, ArrowRight, ArrowUp, ArrowDown, Clock, AlertTriangle, Mail,
} from 'lucide-vue-next'
import { cashApi } from '../../../api/cashApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, type Currency } from '../../../composables/useMoney'
import { centsToText, toCents } from '../../../composables/cashMath'
import ReasonDialog from '../../shared/ReasonDialog.vue'
import { usePortalInbox } from '../../shared/usePortal'
import { useAccountant } from '../useAccountant'
import type { AgeGroup } from '../../../api/accountingApi'

const router = useRouter()
const store = useFinanceStore()
const { state, loadDashboard } = useAccountant()
const { inbox } = usePortalInbox()

const d = computed(() => state.dashboard)
const reporting = computed<Currency>(() => (store.selectedYear?.reporting_currency as Currency | undefined) ?? 'USD')

/** Rows of one per-currency figure with the reporting currency first. */
function ordered<T extends { currency: Currency }>(rows: T[] | undefined): T[] {
  return [...(rows ?? [])].sort((a, b) => Number(b.currency === reporting.value) - Number(a.currency === reporting.value) || a.currency.localeCompare(b.currency))
}
const flows = computed(() => ordered(d.value?.flows))
const budget = computed(() => ordered(d.value?.budget))
const position = computed(() => ordered(d.value?.position))
const bankTotals = computed(() => {
  // One line per currency across the bank accounts: summed by the server per account, grouped here
  // only for display order. Each account's own balance is on the reconciliation panel.
  const by = new Map<Currency, string[]>()
  for (const b of d.value?.banks ?? []) by.set(b.currency, [...(by.get(b.currency) ?? []), b.balance])
  return ordered([...by.entries()].map(([currency, balances]) => ({ currency, balances })))
})

const change = (pct: string | null | undefined) => {
  if (pct === null || pct === undefined) return null
  const n = Number(pct)
  return { text: `${n >= 0 ? '+' : ''}${pct}% vs same period last year`, up: n >= 0 }
}

const GROUPS: { key: AgeGroup; label: string; dot: string }[] = [
  { key: 'current', label: 'Current (0–30 days)', dot: '#1e9e4a' },
  { key: '31_60', label: '31 – 60 days', dot: '#f2c230' },
  { key: '61_90', label: '61 – 90 days', dot: '#ef8a17' },
  { key: 'over_90', label: '> 90 days', dot: '#e53935' },
]
function ageing(rows: { currency: Currency; bucket: AgeGroup; amount: string }[] | undefined) {
  const currencies = [...new Set((rows ?? []).map((r) => r.currency))]
  const currency = currencies.includes(reporting.value) ? reporting.value : currencies[0] ?? reporting.value
  const pick = (k: AgeGroup) => rows?.find((r) => r.currency === currency && r.bucket === k)?.amount ?? '0.00'
  return { currency, others: currencies.filter((c) => c !== currency), rows: GROUPS.map((g) => ({ ...g, amount: pick(g.key) })) }
}
const receivables = computed(() => ageing(d.value?.receivables))
const payables = computed(() => ageing(d.value?.payables))
/** The four groups' total, in exact integer cents; each group's figure is the server's. */
const totalOf = (rows: { amount: string }[]) => centsToText(rows.reduce((t, r) => t + (toCents(r.amount) ?? 0n), 0n))

const utilisation = computed(() => Number(budget.value[0]?.utilisation ?? 0))
const RING = 2 * Math.PI * 54

const TASK_ROUTE: Record<string, string> = {
  cashups: 'acc-cashups', vouchers: 'acc-journals', my_drafts: 'acc-journals', deposits: 'acc-banking',
  billing: 'acc-revenue', rates_receipts: 'acc-revenue', periods: 'acc-close',
}
const ALERT_ROUTE: Record<string, string> = { debtors: 'acc-receivable', cashups: 'acc-cashups', periods: 'acc-close', bank: 'acc-bank' }

const canRecordReceipt = computed(() => store.can('finance.rates.receipt.record'))
const QUICK = computed(() => [
  { label: 'New Journal Entry', icon: BookOpen, to: { name: 'acc-journals' } },
  { label: 'Record Payment', icon: CreditCard, to: { name: 'acc-journals', query: { purpose: 'payment' } } },
  { label: 'Record Receipt', icon: FilePlus, to: { name: 'acc-revenue' }, disabled: !canRecordReceipt.value, why: 'Recording a rates receipt is the revenue office\'s permission, not the accountant\'s.' },
  { label: 'Bank Reconciliation', icon: Landmark, to: { name: 'acc-bank' } },
  { label: 'Generate Report', icon: ChartColumn, to: { name: 'acc-reports' } },
  { label: 'Close Period', icon: Lock, to: { name: 'acc-close' } },
])

function typeOf(r: { voucher_type: string; cash_effect: string }): { label: string; cls: string } {
  if (r.voucher_type === 'receipt') return { label: 'Receipt', cls: 'cw-pill--pos' }
  if (r.voucher_type === 'rates_bill') return { label: 'Bill', cls: 'cw-pill--info' }
  if (r.voucher_type === 'reversal') return { label: 'Reversal', cls: 'cw-pill--mute' }
  if (Number(r.cash_effect) < 0) return { label: 'Payment', cls: 'cw-pill--neg' }
  return { label: r.voucher_type === 'journal' ? 'Journal' : r.voucher_type.replace('_', ' '), cls: 'acc-pill-journal' }
}

// ── Cash-up actions ───────────────────────────────────────────────────────────────────────────
const busy = ref<string | null>(null)
const actionError = ref<string | null>(null)
const notice = ref<string | null>(null)
const returning = ref<{ id: string; session_no: string; cashier_name: string } | null>(null)

async function verify(c: { id: string; session_no: string; cashier_name: string }): Promise<void> {
  if (!window.confirm(`Verify ${c.cashier_name}'s count for ${c.session_no}? Any difference is posted to the cash-difference account.`)) return
  busy.value = c.id
  actionError.value = null
  try {
    const r = await cashApi.verifySession(c.id)
    notice.value = `${c.session_no} verified. ${r.note}`
    await loadDashboard(store.selectedYearId)
  } catch (err) {
    actionError.value = messageOf(err, 'The cash-up could not be verified.')
  } finally {
    busy.value = null
  }
}
async function sendBack(reason: string): Promise<void> {
  if (!returning.value) return
  busy.value = returning.value.id
  actionError.value = null
  try {
    await cashApi.returnSession(returning.value.id, reason)
    notice.value = `${returning.value.session_no} returned to ${returning.value.cashier_name} for a recount.`
    returning.value = null
    await loadDashboard(store.selectedYearId)
  } catch (err) {
    actionError.value = messageOf(err, 'The cash-up could not be returned.')
  } finally {
    busy.value = null
  }
}
const money = (v: string | null | undefined, c: Currency) => formatMoney(v, c)
const shortDate = (iso: string) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
</script>

<template>
  <p v-if="state.error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ state.error }}
    <button type="button" class="cw-btn cw-btn--small" @click="loadDashboard(store.selectedYearId)">Retry</button></p>
  <p v-if="actionError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ actionError }}</p>
  <p v-if="notice" class="cw-banner-msg cw-banner-msg--pos" role="status">{{ notice }}</p>

  <div v-if="!d && state.loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /><span class="cw-skel" /></div>

  <template v-else-if="d">
    <!-- ── Figures ──────────────────────────────────────────────────────────────────────── -->
    <div class="acc-tiles">
      <RouterLink :to="{ name: 'acc-ledger' }" class="cw-tile cw-tile--violet">
        <span class="cw-tile-icon"><Coins :size="32" aria-hidden="true" /></span>
        <div>
          <p class="cw-tile-label">Total Collections (YTD)</p>
          <template v-if="flows.length">
            <p class="cw-tile-value num">{{ money(flows[0].collections, flows[0].currency) }}</p>
            <p v-for="f in flows.slice(1)" :key="f.currency" class="cw-tile-value-2 num">{{ money(f.collections, f.currency) }}</p>
            <p class="cw-tile-sub" :class="{ 'is-up': change(flows[0].collections_change_pct)?.up, 'is-down': change(flows[0].collections_change_pct) && !change(flows[0].collections_change_pct)?.up }">
              <template v-if="change(flows[0].collections_change_pct)"><ArrowUp v-if="change(flows[0].collections_change_pct)?.up" :size="16" aria-hidden="true" /><ArrowDown v-else :size="16" aria-hidden="true" />{{ change(flows[0].collections_change_pct)?.text }}</template>
              <template v-else>No earlier year to compare</template>
            </p>
          </template>
          <p v-else class="cw-tile-value num">0.00</p>
        </div>
      </RouterLink>

      <RouterLink :to="{ name: 'acc-ledger' }" class="cw-tile cw-tile--green">
        <span class="cw-tile-icon"><CreditCard :size="32" aria-hidden="true" /></span>
        <div>
          <p class="cw-tile-label">Total Payments (YTD)</p>
          <template v-if="flows.length">
            <p class="cw-tile-value num">{{ money(flows[0].payments, flows[0].currency) }}</p>
            <p v-for="f in flows.slice(1)" :key="f.currency" class="cw-tile-value-2 num">{{ money(f.payments, f.currency) }}</p>
            <p class="cw-tile-sub">
              <template v-if="change(flows[0].payments_change_pct)">{{ change(flows[0].payments_change_pct)?.text }}</template>
              <template v-else>Out of the bank and tills</template>
            </p>
          </template>
          <p v-else class="cw-tile-value num">0.00</p>
        </div>
      </RouterLink>

      <RouterLink :to="{ name: 'acc-bank' }" class="cw-tile cw-tile--blue">
        <span class="cw-tile-icon"><Scale :size="32" aria-hidden="true" /></span>
        <div>
          <p class="cw-tile-label">Current Bank Balance</p>
          <template v-if="bankTotals.length">
            <template v-for="(b, i) in bankTotals" :key="b.currency">
              <p v-for="bal in b.balances" :key="bal" :class="i === 0 ? 'cw-tile-value num' : 'cw-tile-value-2 num'">{{ money(bal, b.currency) }}</p>
            </template>
          </template>
          <p v-else class="cw-tile-value num">0.00</p>
          <p class="cw-tile-sub">(All Bank Accounts)</p>
        </div>
      </RouterLink>

      <RouterLink :to="{ name: 'acc-budget' }" class="cw-tile cw-tile--amber">
        <span class="cw-tile-icon"><Gauge :size="32" aria-hidden="true" /></span>
        <div style="flex: 1">
          <p class="cw-tile-label">Budget Utilisation</p>
          <p class="cw-tile-value num">{{ budget[0]?.utilisation ?? '—' }}<template v-if="budget[0]?.utilisation">%</template></p>
          <div class="acc-bar" role="progressbar" :aria-valuenow="utilisation" aria-valuemin="0" aria-valuemax="100" :aria-label="`Budget utilisation ${budget[0]?.utilisation ?? 0} percent`">
            <span :style="{ width: `${Math.min(100, utilisation)}%` }" />
          </div>
          <p v-if="budget.length > 1" class="cw-tile-sub">{{ budget.slice(1).map((b) => `${b.currency} ${b.utilisation ?? '—'}%`).join(' · ') }}</p>
        </div>
      </RouterLink>

      <a href="#acc-tasks" class="cw-tile acc-tile--red">
        <span class="cw-tile-icon"><TriangleAlert :size="32" aria-hidden="true" /></span>
        <div>
          <p class="cw-tile-label">Items Requiring Action</p>
          <p class="cw-tile-value num acc-red">{{ d.items_requiring_action }}</p>
        </div>
      </a>
    </div>

    <!-- ── Approvals, tasks, quick actions ──────────────────────────────────────────────── -->
    <div class="acc-row acc-row--2">
      <section class="cw-card" aria-labelledby="ac-cu">
        <div class="cw-card-head">
          <h3 id="ac-cu"><ClipboardList :size="26" class="cw-head-icon" aria-hidden="true" /> Cash-Up Approvals</h3>
          <span v-if="d.cashups.length" class="cw-pill cw-pill--neg acc-pending">{{ d.cashups.length }} Pending</span>
          <span class="cw-spacer" />
          <RouterLink :to="{ name: 'acc-cashups' }" class="cw-link">View All <ArrowRight :size="16" aria-hidden="true" /></RouterLink>
        </div>
        <div class="cw-card-body cw-table-wrap">
          <p v-if="!d.cashups.length" class="cw-empty"><strong>No cash-up is waiting for you.</strong><template v-if="d.own_cashups">{{ d.own_cashups }} you counted or witnessed wait for somebody else.</template><template v-else>Counts declared by cashiers appear here.</template></p>
          <table v-else class="cw-table acc-compact">
            <thead><tr><th>Till</th><th>Cashier</th><th>Business Date</th><th class="r">Amount</th><th class="r">Difference</th><th class="r">Action</th></tr></thead>
            <tbody>
              <tr v-for="c in d.cashups" :key="c.id">
                <td>{{ c.cash_point_code }}</td>
                <td>{{ c.cashier_name }}</td>
                <td>{{ shortDate(c.business_date) }}</td>
                <td class="amt"><div v-for="n in c.counts" :key="n.currency">{{ money(n.expected, n.currency) }}</div></td>
                <td class="r"><div v-for="n in c.counts" :key="n.currency"><span class="acc-diff" :class="Number(n.variance) === 0 ? 'is-zero' : 'is-off'">{{ formatMoney(n.variance, n.currency, { bare: true }) }}</span></div></td>
                <td class="r" style="white-space: nowrap">
                  <button type="button" class="acc-act acc-act--view" :aria-label="`View ${c.session_no}`" @click="router.push({ name: 'acc-cashups', query: { session: c.id } })"><Eye :size="16" /></button>
                  <button type="button" class="acc-act acc-act--ok" :aria-label="`Verify ${c.session_no}`" :disabled="busy === c.id" @click="verify(c)"><Check :size="16" /></button>
                  <button type="button" class="acc-act acc-act--no" :aria-label="`Return ${c.session_no} for recount`" :disabled="busy === c.id" @click="returning = c"><X :size="16" /></button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section id="acc-tasks" class="cw-card" aria-labelledby="ac-pt">
        <div class="cw-card-head">
          <h3 id="ac-pt"><SquareCheckBig :size="26" class="cw-head-icon" aria-hidden="true" /> Pending Tasks</h3>
          <span class="cw-spacer" />
          <span class="cw-count-pill">{{ d.tasks.length }}</span>
        </div>
        <div class="cw-card-body">
          <p v-if="!d.tasks.length" class="cw-empty"><strong>Nothing is waiting.</strong>New work appears here as it arrives.</p>
          <ul v-else class="acc-tasks">
            <li v-for="(t, i) in d.tasks" :key="t.key">
              <RouterLink :to="{ name: TASK_ROUTE[t.key] ?? 'acc-dashboard' }" :class="{ 'is-first': i === 0 }">
                <Circle :size="18" aria-hidden="true" /><span>{{ t.text }}</span><ChevronRight :size="18" aria-hidden="true" />
              </RouterLink>
            </li>
          </ul>
        </div>
      </section>

      <section class="cw-card acc-quick" aria-labelledby="ac-qa">
        <div class="cw-card-head"><h3 id="ac-qa"><Zap :size="26" class="cw-head-icon" aria-hidden="true" /> Quick Actions</h3></div>
        <div class="cw-card-body">
          <div class="acc-quick-grid">
            <template v-for="q in QUICK" :key="q.label">
              <span v-if="q.disabled" class="cw-action acc-qa is-disabled" :title="q.why" aria-disabled="true"><component :is="q.icon" :size="28" :stroke-width="1.6" aria-hidden="true" /><span>{{ q.label }}</span></span>
              <RouterLink v-else :to="q.to" class="cw-action acc-qa"><component :is="q.icon" :size="28" :stroke-width="1.6" aria-hidden="true" /><span>{{ q.label }}</span></RouterLink>
            </template>
          </div>
        </div>
      </section>
    </div>

    <!-- ── Position, debtors, creditors, budget ─────────────────────────────────────────── -->
    <div class="acc-row acc-row--4">
      <section class="cw-card" aria-labelledby="ac-fp">
        <div class="cw-card-head"><h3 id="ac-fp"><Layers :size="26" class="cw-head-icon" aria-hidden="true" /> Financial Position</h3></div>
        <div class="cw-card-body">
          <p v-if="!position.length" class="cw-empty">Nothing posted in {{ d.year.label }}.</p>
          <template v-for="(p, i) in position" :key="p.currency">
            <p v-if="position.length > 1" class="acc-ccy">{{ p.currency }}</p>
            <dl class="cw-kv acc-kv" :class="{ 'acc-kv--second': i > 0 }">
              <div><dt>Total Assets</dt><dd>{{ money(p.assets, p.currency) }}</dd></div>
              <div><dt>Total Liabilities</dt><dd>{{ money(p.liabilities, p.currency) }}</dd></div>
              <div class="acc-net"><dt>Net Assets / Equity</dt><dd>{{ money(p.net_assets, p.currency) }}</dd></div>
            </dl>
          </template>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="ac-ar">
        <div class="cw-card-head">
          <span class="acc-head-icon"><UserRound :size="26" aria-hidden="true" /></span>
          <div><h3 id="ac-ar">Aged Receivables (Debtors)</h3><p class="acc-total">Total: <strong>{{ money(totalOf(receivables.rows), receivables.currency) }}</strong></p></div>
        </div>
        <div class="cw-card-body">
          <ul class="acc-ageing">
            <li v-for="r in receivables.rows" :key="r.key"><span class="acc-dot" :style="{ background: r.dot }" />{{ r.label }}<strong class="num">{{ money(r.amount, receivables.currency) }}</strong></li>
          </ul>
          <p v-if="receivables.others.length" class="cw-hint">{{ receivables.others.join(', ') }} on Accounts Receivable.</p>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="ac-ap">
        <div class="cw-card-head">
          <span class="acc-head-icon"><Users :size="26" aria-hidden="true" /></span>
          <div><h3 id="ac-ap">Accounts Payable (Creditors)</h3><p class="acc-total">Total: <strong>{{ money(totalOf(payables.rows), payables.currency) }}</strong></p></div>
        </div>
        <div class="cw-card-body">
          <ul class="acc-ageing">
            <li v-for="r in payables.rows" :key="r.key"><span class="acc-dot" :style="{ background: r.dot }" />{{ r.label }}<strong class="num">{{ money(r.amount, payables.currency) }}</strong></li>
          </ul>
          <p v-if="!d.payables_configured" class="cw-hint">No payable control account is in the chart yet, so no supplier invoice can be captured.</p>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="ac-bp">
        <div class="cw-card-head">
          <span class="acc-head-icon"><Target :size="26" aria-hidden="true" /></span>
          <div><h3 id="ac-bp">Budget Performance (YTD)</h3><p class="acc-total">Overall Utilisation: <strong>{{ budget[0]?.utilisation ?? '—' }}%</strong></p></div>
        </div>
        <div class="cw-card-body acc-donut-wrap">
          <svg viewBox="0 0 140 140" width="132" height="132" role="img" :aria-label="`${budget[0]?.utilisation ?? 0} percent of the budget spent`">
            <circle cx="70" cy="70" r="54" fill="none" stroke="#e2edfb" stroke-width="20" />
            <circle cx="70" cy="70" r="54" fill="none" stroke="#1e9e4a" stroke-width="20" stroke-linecap="butt"
              :stroke-dasharray="`${(Math.min(100, utilisation) / 100) * RING} ${RING}`" transform="rotate(-90 70 70)" />
            <text x="70" y="77" text-anchor="middle" font-size="21" font-weight="800" fill="#1a2430">{{ budget[0]?.utilisation ?? '—' }}%</text>
          </svg>
          <dl v-if="budget[0]" class="acc-legend">
            <div><dt><span class="acc-dot" style="background: #1e9e4a" />Spent</dt><dd>{{ money(budget[0].spent, budget[0].currency) }}</dd></div>
            <div><dt><span class="acc-dot" style="background: #9dbce6" />Remaining</dt><dd>{{ money(budget[0].remaining, budget[0].currency) }}</dd></div>
            <div><dt><span class="acc-dot" style="background: transparent" />Budget</dt><dd>{{ money(budget[0].budget, budget[0].currency) }}</dd></div>
          </dl>
          <p v-else class="cw-hint">No approved expenditure budget for this year.</p>
        </div>
      </section>
    </div>

    <!-- ── Transactions, bank, alerts ───────────────────────────────────────────────────── -->
    <div class="acc-row acc-row--3">
      <section class="cw-card" aria-labelledby="ac-rt">
        <div class="cw-card-head">
          <h3 id="ac-rt"><ArrowLeftRight :size="26" class="cw-head-icon" aria-hidden="true" /> Recent Transactions</h3>
          <span class="cw-spacer" />
          <RouterLink :to="{ name: 'acc-journals' }" class="cw-link">View All <ArrowRight :size="16" aria-hidden="true" /></RouterLink>
        </div>
        <div class="cw-card-body cw-table-wrap">
          <p v-if="!d.recent.length" class="cw-empty">Nothing posted yet in {{ d.year.label }}.</p>
          <table v-else class="cw-table acc-compact">
            <thead><tr><th>Date</th><th>Reference</th><th>Description</th><th>Type</th><th class="r">Amount</th></tr></thead>
            <tbody>
              <tr v-for="r in d.recent" :key="r.id">
                <td style="white-space: nowrap">{{ shortDate(r.posting_date) }}</td>
                <td style="white-space: nowrap">{{ r.voucher_no }}</td>
                <td class="acc-desc">{{ r.description || '—' }}</td>
                <td><span class="cw-pill" :class="typeOf(r).cls">{{ typeOf(r).label }}</span></td>
                <td class="amt" :class="{ 'cw-neg': Number(r.cash_effect) < 0 }">{{ Number(r.cash_effect) < 0 ? `(${money(r.amount, r.currency)})` : money(r.amount, r.currency) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="ac-br">
        <div class="cw-card-head">
          <h3 id="ac-br"><Landmark :size="26" class="cw-head-icon" aria-hidden="true" /> Bank Reconciliation</h3>
          <span class="cw-spacer" />
          <RouterLink :to="{ name: 'acc-bank' }" class="cw-link">View Details <ArrowRight :size="16" aria-hidden="true" /></RouterLink>
        </div>
        <div class="cw-card-body">
          <p v-if="!d.banks.length" class="cw-empty">No bank account has entries.</p>
          <ul v-else class="acc-banks">
            <li v-for="b in d.banks" :key="b.id + b.currency">
              <span>{{ b.name }} – {{ b.currency }}</span>
              <strong class="num">{{ money(b.balance, b.currency) }}</strong>
              <span class="acc-recon"><Clock :size="14" aria-hidden="true" /> Unreconciled</span>
            </li>
          </ul>
          <p class="cw-hint" style="margin: 10px 0 0">Ledger balances. Matching them to bank statements is not built yet.</p>
        </div>
      </section>

      <section class="cw-card" aria-labelledby="ac-al">
        <div class="cw-card-head">
          <h3 id="ac-al"><Bell :size="26" class="cw-head-icon" aria-hidden="true" /> Alerts &amp; Notifications</h3>
          <span class="cw-spacer" />
          <span class="acc-alert-count">{{ d.alerts.length + (inbox.unread ? 1 : 0) }}</span>
        </div>
        <div class="cw-card-body">
          <ul class="acc-alerts">
            <li v-if="inbox.unread">
              <RouterLink :to="{ name: 'acc-messages' }"><Mail :size="19" class="acc-tone-info" aria-hidden="true" /><span>{{ inbox.unread }} unread message{{ inbox.unread === 1 ? '' : 's' }}</span><ChevronRight :size="18" aria-hidden="true" /></RouterLink>
            </li>
            <li v-for="(a, i) in d.alerts" :key="i">
              <RouterLink :to="{ name: ALERT_ROUTE[a.key] ?? 'acc-dashboard' }">
                <CircleAlert v-if="a.tone === 'neg'" :size="19" class="acc-tone-neg" aria-hidden="true" />
                <TriangleAlert v-else-if="a.tone === 'warn'" :size="19" class="acc-tone-warn" aria-hidden="true" />
                <Info v-else :size="19" class="acc-tone-info" aria-hidden="true" />
                <span>{{ a.text }}</span><ChevronRight :size="18" aria-hidden="true" />
              </RouterLink>
            </li>
            <li v-if="!d.alerts.length && !inbox.unread" class="cw-empty">Nothing needs your attention.</li>
          </ul>
        </div>
      </section>
    </div>
  </template>

  <ReasonDialog
    v-if="returning" :title="`Return ${returning.session_no} for recount`"
    :message="`${returning.cashier_name} is asked to count the drawer again. Your reason is kept with the session.`"
    label="Why is it being returned?" submit-label="Return for recount" danger :busy="!!busy" :error="actionError"
    @submit="sendBack" @close="returning = null"
  />
</template>

<style scoped>
.acc-tiles { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 14px; }
.acc-tiles .cw-tile { min-height: 118px; padding: 18px 14px; gap: 12px; }
.acc-tiles .cw-tile-icon { width: 56px; height: 56px; }
.acc-tiles .cw-tile-value { font-size: 21px; white-space: nowrap; }
.acc-tiles .cw-tile-value-2 { white-space: nowrap; }
.acc-tiles .cw-tile > div { min-width: 0; }
.acc-tiles .cw-tile-label { font-size: 15px; }
.acc-tiles .cw-tile-sub { font-size: 14px; }
.acc-tile--red { background: #fdeaea; }
.acc-tile--red .cw-tile-icon { background: #fbd3d3; color: #d32f2f; }
.acc-red { color: #d32f2f; font-size: 24px !important; }
.acc-bar { height: 9px; margin-top: 10px; border-radius: 5px; background: #e5e9ee; overflow: hidden; }
.acc-bar span { display: block; height: 100%; border-radius: 5px; background: #1e9e4a; }

.acc-row { display: grid; gap: 16px; align-items: stretch; }
.acc-row--2 { grid-template-columns: minmax(0, 1.9fr) minmax(0, 1.05fr) minmax(0, 1fr); }
.acc-compact td, .acc-compact th { white-space: nowrap; }
.acc-row--4 { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.acc-row--3 { grid-template-columns: minmax(0, 1.55fr) minmax(0, 1.25fr) minmax(0, 1.15fr); }
.acc-row .cw-card-head h3 { font-size: 15.5px; }
.acc-pending { font-size: 13px; }
.acc-compact { font-size: 14px; }
.acc-compact td, .acc-compact thead th { padding: 9px 7px; }
.acc-kv dd { white-space: nowrap; }
.acc-diff { display: inline-block; min-width: 72px; padding: 3px 10px; border-radius: 7px; text-align: center; font-weight: 700; font-variant-numeric: tabular-nums; }
.acc-diff.is-zero { background: var(--cw-pos-soft); color: var(--cw-pos); }
.acc-diff.is-off { background: var(--cw-neg-soft); color: var(--cw-neg); }
.acc-act { width: 28px; height: 28px; margin-left: 3px; border-radius: 7px; border: 1.5px solid; background: #fff; display: inline-grid; place-items: center; cursor: pointer; }
.acc-act:disabled { opacity: 0.5; cursor: wait; }
.acc-act--view { border-color: #bdd4f3; color: var(--cw-accent); }
.acc-act--ok { border-color: #a6dcb8; color: var(--cw-pos); }
.acc-act--no { border-color: #f0b4b4; color: var(--cw-neg); }
.acc-tasks { list-style: none; margin: 0; padding: 0; }
.acc-tasks a { display: flex; align-items: center; gap: 12px; padding: 9px 10px; border-bottom: 1px solid var(--cw-line); color: inherit; text-decoration: none; font-size: 15px; border-radius: 8px; }
.acc-tasks a span { flex: 1; }
.acc-tasks a:hover, .acc-tasks a.is-first { background: var(--cw-accent-softer); }
.acc-tasks a.is-first { background: #e8f0f9; }
.acc-tasks svg { color: var(--cw-ink-2); flex: none; }
.acc-quick { background: #f5f8fd; }
.acc-quick-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.acc-qa { min-height: 68px; font-size: 12.5px; background: #fff; gap: 6px; }
.acc-qa.is-disabled { opacity: 0.5; cursor: not-allowed; }
.acc-head-icon { color: var(--cw-accent); align-self: flex-start; padding-top: 2px; }
.acc-total { margin: 2px 0 0; font-size: 15px; color: var(--cw-ink-2); }
.acc-total strong { color: var(--cw-accent-ink); }
.acc-ccy { margin: 6px 0 2px; font-size: 13px; font-weight: 700; color: var(--cw-ink-3); }
.acc-kv dt, .acc-kv dd { padding: 9px 4px; font-size: 15px; }
.acc-kv--second dt, .acc-kv--second dd { padding: 5px 4px; font-size: 13.5px; }
.acc-net dt, .acc-net dd { background: #e8f0f9; color: var(--cw-accent-ink); font-weight: 700 !important; }
.acc-ageing { list-style: none; margin: 0; padding: 0; }
.acc-ageing li { display: flex; align-items: center; gap: 10px; padding: 8px 2px; border-bottom: 1px solid var(--cw-line); font-size: 15px; }
.acc-ageing li:last-child { border-bottom: 0; }
.acc-ageing strong { margin-left: auto; font-size: 15px; white-space: nowrap; }
.acc-dot { width: 12px; height: 12px; border-radius: 50%; display: inline-block; flex: none; }
.acc-donut-wrap { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
.acc-legend { flex: 1; min-width: 160px; margin: 0; display: grid; grid-template-columns: auto 1fr; gap: 8px 10px; font-size: 14px; }
.acc-legend > div { display: contents; }
.acc-legend dt { display: flex; align-items: center; gap: 6px; }
.acc-legend dd { margin: 0; text-align: right; font-weight: 600; font-variant-numeric: tabular-nums; }
.acc-desc { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
:deep(.acc-pill-journal) { background: #e8f0f9; color: var(--cw-accent-ink); }
.acc-banks { list-style: none; margin: 0; padding: 0; }
.acc-banks li { display: grid; grid-template-columns: 1fr auto; gap: 2px 10px; padding: 10px 2px; border-bottom: 1px solid var(--cw-line); font-size: 15px; }
.acc-banks strong { text-align: right; }
.acc-recon { grid-column: 1 / -1; display: inline-flex; align-items: center; gap: 5px; justify-self: start; padding: 2px 9px; border-radius: 7px; background: var(--cw-warn-soft); color: var(--cw-warn); font-size: 13px; font-weight: 600; }
.acc-alert-count { min-width: 30px; height: 30px; border-radius: 15px; background: #e53935; color: #fff; display: grid; place-items: center; font-weight: 700; }
.acc-alerts { list-style: none; margin: 0; padding: 0; }
.acc-alerts a { display: flex; align-items: center; gap: 10px; padding: 9px 4px; border-bottom: 1px solid var(--cw-line); color: inherit; text-decoration: none; font-size: 15px; }
.acc-alerts a:hover { background: var(--cw-accent-softer); }
.acc-alerts a span { flex: 1; }
.acc-tone-neg { color: #d32f2f; flex: none; }
.acc-tone-warn { color: #ef8a17; flex: none; }
.acc-tone-info { color: #1b5fae; flex: none; }
@media (max-width: 1400px) {
  .acc-tiles { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .acc-row--2, .acc-row--3 { grid-template-columns: minmax(0, 1fr) minmax(0, 1fr); }
  .acc-row--2 > :first-child, .acc-row--3 > :first-child { grid-column: 1 / -1; }
  .acc-row--4 { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
@media (max-width: 760px) {
  .acc-tiles, .acc-row--2, .acc-row--3, .acc-row--4 { grid-template-columns: minmax(0, 1fr); }
}
</style>
