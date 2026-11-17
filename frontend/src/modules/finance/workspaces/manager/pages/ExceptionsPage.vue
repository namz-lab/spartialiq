<script setup lang="ts">
/**
 * Exception reports for the finance director, from what the server already computes:
 *   - the needs-attention feed (`GET /finance/overview/attention`), each item with its count and,
 *     where it has one, its money per currency;
 *   - budget lines over budget, nearly exhausted, spent without a budget or carrying a currency
 *     fault (`GET /finance/exceptions/budget`);
 *   - the system alerts from the manager dashboard.
 * A count the server could not compute is shown as such, never as zero.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { ShieldAlert, ChevronRight, CircleAlert, TriangleAlert, Info, RefreshCw } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import type { AttentionItem, BudgetLinePerformance } from '../../../models/types'
import { SECTION_TARGETS } from '../../../shell/targets'
import type { FinanceSectionKey } from '../../../stores/rolePreset'
import { useFinanceNav } from '../../../shell/useFinanceNav'
import { pctText } from '../../shared/useDashboard'
import { managerDash } from '../dashboard'

type ExceptionRow = BudgetLinePerformance & { flag: string; department_code?: string; department_name?: string; account_code?: string; account_name?: string }

const store = useFinanceStore()
const nav = useFinanceNav()
const attention = ref<AttentionItem[]>([])
const attentionError = ref<string | null>(null)
const lines = ref<ExceptionRow[]>([])
const thresholds = ref<{ warn_execution_percentage: number; flag_execution_percentage: number } | null>(null)
const linesError = ref<string | null>(null)
const loading = ref(false)

const FLAG: Record<string, { label: string; tone: string }> = {
  over_budget: { label: 'Over budget', tone: 'cw-pill--neg' },
  spend_without_budget: { label: 'Spent without a budget', tone: 'cw-pill--neg' },
  currency_mismatch: { label: 'Currency fault', tone: 'cw-pill--warn' },
  nearly_exhausted: { label: 'Nearly exhausted', tone: 'cw-pill--warn' },
}

async function load(): Promise<void> {
  const year = store.selectedYearId
  if (!year) { attention.value = []; lines.value = []; return }
  loading.value = true
  attentionError.value = null
  linesError.value = null
  const canBudget = store.can('finance.budget.view')
  await Promise.all([
    canBudget
      ? financeApi.overviewAttention({ financial_year_id: year }).then((f) => { attention.value = f.items })
        .catch((e) => { attentionError.value = messageOf(e, 'The needs-attention list could not be read.') })
      : Promise.resolve(void (attentionError.value = 'Your role cannot read this (it needs finance.budget.view).')),
    canBudget || store.can('finance.actuals.view')
      ? financeApi.budgetExceptions(year).then((r) => { lines.value = r.rows as ExceptionRow[]; thresholds.value = r.thresholds })
        .catch((e) => { linesError.value = messageOf(e, 'The budget exceptions could not be read.') })
      : Promise.resolve(void (linesError.value = 'Your role cannot read budget performance.')),
  ])
  loading.value = false
}
onMounted(load)
watch(() => store.selectedYearId, load)

const open = computed(() => attention.value.filter((a) => a.unavailable || a.count > 0))
const clear = computed(() => attention.value.filter((a) => !a.unavailable && a.count === 0))
function linkOf(a: AttentionItem) {
  const t = SECTION_TARGETS[a.section as FinanceSectionKey]
  if (!t) return null
  const r = nav.resolve(t)
  return r.kind === 'route' ? { name: r.name, query: a.query ?? {} } : null
}
const ALERT_ROUTE: Record<string, string> = { audit: 'mgr-audit', years: 'mgr-periods', imports: 'mgr-integration' }
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><ShieldAlert :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text"><h2>Exceptions</h2><p>What is out of line in the selected year: over-spending, faults in the data and the system's own alerts.</p></div>
    <span class="cw-spacer" />
    <button type="button" class="cw-btn cw-btn--outline" :disabled="loading" @click="load()"><RefreshCw :size="18" aria-hidden="true" /> Read again</button>
  </section>

  <p v-if="!store.selectedYearId" class="cw-banner-msg cw-banner-msg--info" role="status">Choose a financial year to see its exceptions.</p>

  <div class="dx-row dx-row--wide-left">
    <section class="cw-card" aria-labelledby="ex-att">
      <div class="cw-card-head"><h3 id="ex-att">Needs Attention</h3></div>
      <div class="cw-card-body">
        <p v-if="attentionError" class="cw-empty">{{ attentionError }}</p>
        <div v-else-if="loading && !attention.length" aria-busy="true"><span class="cw-skel" /><span class="cw-skel" /></div>
        <p v-else-if="!open.length" class="cw-empty">Nothing in the needs-attention list has a count this year.</p>
        <ul v-else class="dx-list">
          <li v-for="a in open" :key="a.id">
            <component :is="linkOf(a) ? RouterLink : 'div'" :to="linkOf(a) ?? undefined" class="dx-item">
              <CircleAlert v-if="a.severity === 'act'" :size="20" class="dx-neg" aria-hidden="true" />
              <TriangleAlert v-else-if="a.severity === 'watch'" :size="20" class="dx-warn" aria-hidden="true" />
              <Info v-else :size="20" class="dx-info" aria-hidden="true" />
              <span class="dx-grow"><strong>{{ a.label }}</strong><br><span class="cw-hint">{{ a.unavailable ? (a.unavailable_reason || 'Could not be computed.') : a.statement }}</span>
                <span v-for="m in a.amounts ?? []" :key="m.currency" class="cw-hint num"> · {{ formatMoney(m.amount, m.currency) }}</span></span>
              <span v-if="!a.unavailable" class="dx-count">{{ a.count }}</span>
              <ChevronRight v-if="linkOf(a)" :size="18" aria-hidden="true" />
            </component>
          </li>
        </ul>
        <p v-if="clear.length" class="dx-note">Clear this year: {{ clear.map((a) => a.label).join(', ') }}.</p>
      </div>
    </section>

    <section class="cw-card" aria-labelledby="ex-sys">
      <div class="cw-card-head"><h3 id="ex-sys">System Alerts</h3></div>
      <div class="cw-card-body">
        <p v-if="managerDash.state.error" class="cw-empty">{{ managerDash.state.error }}</p>
        <p v-else-if="!managerDash.state.data?.alerts?.length" class="cw-empty">No alerts.</p>
        <ul v-else class="dx-list">
          <li v-for="(a, i) in managerDash.state.data.alerts" :key="i">
            <RouterLink :to="{ name: ALERT_ROUTE[a.key] ?? 'mgr-health' }" class="dx-item">
              <CircleAlert v-if="a.tone === 'neg'" :size="20" class="dx-neg" aria-hidden="true" />
              <TriangleAlert v-else-if="a.tone === 'warn'" :size="20" class="dx-warn" aria-hidden="true" />
              <Info v-else :size="20" class="dx-info" aria-hidden="true" />
              <span class="dx-grow">{{ a.text }}</span><ChevronRight :size="18" aria-hidden="true" />
            </RouterLink>
          </li>
        </ul>
      </div>
    </section>
  </div>

  <section class="cw-card" aria-labelledby="ex-bud">
    <div class="cw-card-head"><h3 id="ex-bud">Budget Lines to Look At</h3><span class="cw-spacer" />
      <span v-if="thresholds" class="cw-hint">Warn at {{ thresholds.warn_execution_percentage }} %, flag at {{ thresholds.flag_execution_percentage }} % (Workflow Setup)</span></div>
    <div class="cw-card-body cw-table-wrap">
      <p v-if="linesError" class="cw-empty">{{ linesError }}</p>
      <p v-else-if="!loading && !lines.length" class="cw-empty">No budget line is over its threshold, spent without a budget or carrying a currency fault.</p>
      <table v-else-if="lines.length" class="cw-table dx-compact">
        <thead><tr><th scope="col">Line</th><th scope="col">Department</th><th scope="col">Flag</th><th scope="col" class="r">Revised budget</th><th scope="col" class="r">Actual</th><th scope="col" class="r">Executed</th></tr></thead>
        <tbody>
          <tr v-for="l in lines" :key="l.budget_line_id">
            <td class="dx-wrap"><span class="num">{{ l.code }}</span> {{ l.description }}</td>
            <td>{{ l.department_name ?? l.department_code ?? '—' }}</td>
            <td><span class="cw-pill" :class="FLAG[l.flag]?.tone ?? 'cw-pill--mute'">{{ FLAG[l.flag]?.label ?? l.flag }}</span></td>
            <td class="r num">{{ formatMoney(l.revised_amount, l.currency) }}</td>
            <td class="r num">{{ formatMoney(l.actual_amount, l.currency) }}</td>
            <td class="r">{{ pctText(l.execution_percentage) }}</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
