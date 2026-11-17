<script setup lang="ts">
/**
 * The council's financial position for the selected year, for the finance director: cash at bank,
 * budget execution, rates collection, debtors, creditors and the balance sheet, each per currency.
 * Composed from the reads the desks already have (see `../position.ts`); a part this role cannot
 * read says so in a sentence rather than showing a zero.
 */
import { computed, onMounted, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { Scale, Landmark, Gauge, Receipt, Users, Truck, BookOpenCheck, RefreshCw, Info } from 'lucide-vue-next'
import { formatMoney, formatDate, type Currency } from '../../../composables/useMoney'
import { useFinanceStore } from '../../../stores/finance'
import { pctText } from '../../shared/useDashboard'
import { position, loadPosition, dataOf, whyEmpty, ordered, execution, executionTone, over90, PART_NEEDS } from '../position'

const store = useFinanceStore()
const load = () => loadPosition(store.selectedYearId, store.can)
onMounted(load)
watch(() => store.selectedYearId, load)

const ops = computed(() => dataOf(position.operations))
const exe = computed(() => dataOf(position.executive))
const rev = computed(() => dataOf(position.revenue))
const acc = computed(() => dataOf(position.accounting))
const pay = computed(() => dataOf(position.payables))
const ccy = computed<Currency>(() => ops.value?.year.reporting_currency ?? exe.value?.year.reporting_currency ?? 'USD')
const money = (v: string | null | undefined, c: Currency) => formatMoney(v, c)
const yearLabel = computed(() => ops.value?.year.label ?? exe.value?.year.label ?? store.selectedYear?.label ?? '')

const why = (k: keyof typeof PART_NEEDS) => whyEmpty(position[k], PART_NEEDS[k])
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Scale :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Financial Position</h2>
      <p>Where the council stands{{ yearLabel ? ` in ${yearLabel}` : '' }}, one currency at a time. USD and ZWG are never added together.</p></div>
    <span class="cw-spacer" />
    <button type="button" class="cw-btn cw-btn--outline" :disabled="position.loading" @click="load()"><RefreshCw :size="18" aria-hidden="true" /> Read again</button>
  </section>

  <div v-if="position.loading && !ops && !exe" class="cw-card cw-card-body" style="padding-top: 20px" aria-busy="true"><span class="cw-skel" /><span class="cw-skel" /></div>

  <div class="dx-row dx-row--2">
    <section class="cw-card" aria-labelledby="fp-cash">
      <div class="cw-card-head"><h3 id="fp-cash"><Landmark :size="24" class="cw-head-icon" aria-hidden="true" /> Cash at Bank</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="why('accounting')" class="cw-empty">{{ why('accounting') }}</p>
        <p v-else-if="acc && !acc.banks.length" class="cw-empty">No bank account has entries in the ledger.</p>
        <table v-else-if="acc" class="cw-table dx-compact">
          <thead><tr><th scope="col">Account</th><th scope="col">Currency</th><th scope="col" class="r">Ledger balance</th><th scope="col">Reconciled to</th></tr></thead>
          <tbody>
            <tr v-for="b in ordered(acc.banks, ccy)" :key="b.id + b.currency">
              <td>{{ b.code }} — {{ b.name }}</td><td>{{ b.currency }}</td><td class="r num">{{ money(b.balance, b.currency) }}</td>
              <td>
                <span v-if="b.reconciled_to">{{ formatDate(b.reconciled_to) }}</span>
                <span v-else class="cw-pill cw-pill--warn">Never reconciled</span>
                <span v-if="b.unreconciled_entries" class="cw-hint"> · {{ b.unreconciled_entries }} unmatched</span>
              </td>
            </tr>
          </tbody>
        </table>
        <ul v-if="ops?.banks.length" class="dx-kpis" style="margin-top: 8px">
          <li v-for="b in ordered(ops.banks, ccy)" :key="b.currency"><span>All bank accounts, {{ b.currency }}</span><strong class="num">{{ money(b.balance, b.currency) }}</strong></li>
        </ul>
      </div>
    </section>

    <section class="cw-card" aria-labelledby="fp-bud">
      <div class="cw-card-head"><h3 id="fp-bud"><Gauge :size="24" class="cw-head-icon" aria-hidden="true" /> Budget Execution</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="why('executive')" class="cw-empty">{{ why('executive') }}</p>
        <p v-else-if="exe && !exe.totals.length" class="cw-empty">No approved budget for this year yet.</p>
        <table v-else-if="exe" class="cw-table dx-compact">
          <thead><tr><th scope="col">Side</th><th scope="col">Currency</th><th scope="col" class="r">Budget</th><th scope="col" class="r">Actual</th><th scope="col" class="r">Executed</th></tr></thead>
          <tbody>
            <template v-for="k in (['revenue', 'expenditure'] as const)" :key="k">
              <tr v-for="t in ordered(execution(exe, k), ccy)" :key="k + t.currency">
                <td>{{ k === 'revenue' ? 'Revenue' : 'Expenditure' }}</td><td>{{ t.currency }}</td>
                <td class="r num">{{ money(t.budget, t.currency) }}</td><td class="r num">{{ money(t.actual, t.currency) }}</td>
                <td class="r"><span class="dx-pct" :class="executionTone(t.execution, k)">{{ pctText(t.execution) }}</span></td>
              </tr>
            </template>
          </tbody>
        </table>
        <p class="dx-note">Spending above 100 % of its budget is shown in red; revenue below 60 % of its budget is shown in red.</p>
      </div>
    </section>
  </div>

  <div class="dx-row dx-row--2">
    <section class="cw-card" aria-labelledby="fp-rates">
      <div class="cw-card-head"><h3 id="fp-rates"><Receipt :size="24" class="cw-head-icon" aria-hidden="true" /> Rates Collection</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="why('revenue')" class="cw-empty">{{ why('revenue') }}</p>
        <p v-else-if="rev && !rev.collection_rate.length" class="cw-empty">No rates were billed in this year.</p>
        <table v-else-if="rev" class="cw-table dx-compact">
          <thead><tr><th scope="col">Currency</th><th scope="col" class="r">Billed</th><th scope="col" class="r">Received</th><th scope="col" class="r">Collection rate</th><th scope="col" class="r">Arrears</th></tr></thead>
          <tbody>
            <tr v-for="r in ordered(rev.collection_rate, ccy)" :key="r.currency">
              <td>{{ r.currency }}</td><td class="r num">{{ money(r.billed, r.currency) }}</td><td class="r num">{{ money(r.received, r.currency) }}</td>
              <td class="r">{{ pctText(r.rate) }}</td>
              <td class="r num">{{ money(rev.arrears.find((a) => a.currency === r.currency)?.amount ?? '0', r.currency) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="cw-card" aria-labelledby="fp-debt">
      <div class="cw-card-head"><h3 id="fp-debt"><Users :size="24" class="cw-head-icon" aria-hidden="true" /> Debtors</h3></div>
      <div class="cw-card-body">
        <p v-if="why('operations')" class="cw-empty">{{ why('operations') }}</p>
        <p v-else-if="ops && !ops.debtors.length" class="cw-empty">No debtor owes the council anything in the posted ledger.</p>
        <ul v-else-if="ops" class="dx-kpis">
          <li v-for="d in ordered(ops.debtors, ccy)" :key="d.currency"><span>{{ d.n }} debtors owing, {{ d.currency }}</span><strong class="num">{{ money(d.amount, d.currency) }}</strong></li>
          <li v-for="d in ordered(over90(acc?.receivables), ccy)" :key="'o' + d.currency"><span>Of which over 90 days, {{ d.currency }}</span><strong class="num dx-neg">{{ money(d.amount, d.currency) }}</strong></li>
        </ul>
      </div>
    </section>
  </div>

  <div class="dx-row dx-row--2">
    <section class="cw-card" aria-labelledby="fp-cred">
      <div class="cw-card-head"><h3 id="fp-cred"><Truck :size="24" class="cw-head-icon" aria-hidden="true" /> Creditors</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="why('payables')" class="cw-empty">{{ why('payables') }}</p>
        <p v-else-if="pay && !pay.owed.length" class="cw-empty">The council owes no supplier anything in the posted ledger.</p>
        <table v-else-if="pay" class="cw-table dx-compact">
          <thead><tr><th scope="col">Currency</th><th scope="col" class="r">Documents</th><th scope="col" class="r">Outstanding</th><th scope="col" class="r">Overdue</th><th scope="col" class="r">In draft payments</th></tr></thead>
          <tbody>
            <tr v-for="o in ordered(pay.owed, ccy)" :key="o.currency">
              <td>{{ o.currency }}</td><td class="r num">{{ o.documents }}</td><td class="r num">{{ money(o.outstanding, o.currency) }}</td>
              <td class="r num" :class="{ 'cw-neg': Number(o.overdue) > 0 }">{{ money(o.overdue, o.currency) }}</td><td class="r num">{{ money(o.in_draft_payments, o.currency) }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="cw-card" aria-labelledby="fp-bs">
      <div class="cw-card-head"><h3 id="fp-bs"><BookOpenCheck :size="24" class="cw-head-icon" aria-hidden="true" /> Balance Sheet and Books</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="why('accounting')" class="cw-empty">{{ why('accounting') }}</p>
        <template v-else-if="acc">
          <p v-if="!acc.position.length" class="cw-empty">Nothing is posted to the balance sheet yet.</p>
          <table v-else class="cw-table dx-compact">
            <thead><tr><th scope="col">Currency</th><th scope="col" class="r">Assets</th><th scope="col" class="r">Liabilities</th><th scope="col" class="r">Net assets</th><th scope="col">Book</th></tr></thead>
            <tbody>
              <tr v-for="p in ordered(acc.position, ccy)" :key="p.currency">
                <td>{{ p.currency }}</td><td class="r num">{{ money(p.assets, p.currency) }}</td><td class="r num">{{ money(p.liabilities, p.currency) }}</td>
                <td class="r num">{{ money(p.net_assets, p.currency) }}</td>
                <td>
                  <template v-for="b in acc.books.filter((x) => x.currency === p.currency)" :key="b.currency">
                    <span v-if="b.balances" class="cw-pill cw-pill--pos">Balances</span>
                    <span v-else class="cw-pill cw-pill--neg">Out by {{ money(b.difference, b.currency) }}</span>
                  </template>
                </td>
              </tr>
            </tbody>
          </table>
          <p v-if="acc.current_period" class="dx-note">Current period {{ acc.current_period.label }} ends {{ formatDate(acc.current_period.to_date) }}
            ({{ acc.current_period.days_left }} days left).</p>
        </template>
        <p class="dx-note"><Info :size="14" aria-hidden="true" /> The full statements, with drill-down to the entries, are under
          <RouterLink :to="{ name: 'mgr-statements' }" class="cw-link">Statements</RouterLink>.</p>
      </div>
    </section>
  </div>
</template>
