<script setup lang="ts">
/**
 * The figures a member decides on, for one agenda item. Every amount is the server's decimal string
 * in its own currency; nothing is added, converted or recomputed here (decision D4). A revision is
 * shown as the line's approved figure and the change asked for, not as a sum.
 *
 * A release request also reads its preview (`GET /finance/publications/:id/preview`,
 * finance.publication.review): the counts and totals that would become public.
 */
import { onMounted, ref } from 'vue'
import { financeApi } from '../../../api/financeApi'
import type { BudgetLinePerformance, BudgetRevision, FinanceProject, Publication } from '../../../models/types'
import type { RatesTariff } from '../../../models/ratesTypes'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatDate, formatDateTime, formatMoney, formatPercentage } from '../../../composables/useMoney'
import { isReduction, unsigned, DATASET, type DecisionKind } from '../agenda'

const props = defineProps<{ kind: DecisionKind; item: unknown }>()
const store = useFinanceStore()

const b = props.item as BudgetLinePerformance
const r = props.item as BudgetRevision
const p = props.item as FinanceProject
const pub = props.item as Publication
const t = props.item as RatesTariff & { current?: RatesTariff | null }

const yearLabel = (id: string | null | undefined) => store.years.find((y) => y.id === id)?.label ?? '—'

type Preview = Awaited<ReturnType<typeof financeApi.publicationPreview>>
const preview = ref<Preview | null>(null)
const previewError = ref<string | null>(null)
onMounted(async () => {
  if (props.kind !== 'publication') return
  if (!store.can('finance.publication.review')) return
  try { preview.value = await financeApi.publicationPreview(pub.id) } catch (err) { previewError.value = messageOf(err, 'The preview of this release could not be read.') }
})
const cell = (v: unknown): string => (v === null || v === undefined || v === '' ? '—' : String(v))
const keysOf = (rows: Array<Record<string, unknown>>): string[] => [...new Set(rows.flatMap((row) => Object.keys(row)))]
</script>

<template>
  <dl v-if="kind === 'budget'" class="cw-kv cm-kv">
    <div><dt>Vote</dt><dd>{{ b.department_code }} {{ b.department_name }}</dd></div>
    <div><dt>Account</dt><dd>{{ b.account_code }} {{ b.account_name }} · {{ b.account_kind === 'revenue' ? 'Revenue' : 'Expenditure' }}</dd></div>
    <div v-if="b.programme_name"><dt>Programme</dt><dd>{{ b.programme_code }} {{ b.programme_name }}</dd></div>
    <div><dt>Year</dt><dd>{{ yearLabel(b.financial_year_id) }}</dd></div>
    <div><dt>Amount asked for</dt><dd class="num"><strong>{{ formatMoney(b.original_amount, b.currency) }}</strong></dd></div>
    <div><dt>Revised to date</dt><dd class="num">{{ formatMoney(b.revised_amount, b.currency) }}</dd></div>
    <div><dt>Actual so far</dt><dd class="num">{{ formatMoney(b.actual_amount, b.currency) }} · {{ formatPercentage(b.execution_percentage, { undefinedLabel: 'no revised budget' }) }}</dd></div>
    <div v-if="b.ward_code"><dt>Ward</dt><dd>{{ b.ward_code }}</dd></div>
    <div v-if="b.returned_note"><dt>Returned before</dt><dd>{{ b.returned_note }}</dd></div>
  </dl>

  <dl v-else-if="kind === 'revision'" class="cw-kv cm-kv">
    <div><dt>Budget line</dt><dd>{{ r.budget_line_code }} {{ r.budget_line_description }}</dd></div>
    <div><dt>Vote</dt><dd>{{ r.department_name ?? '—' }}</dd></div>
    <div><dt>Line as approved</dt><dd class="num">{{ r.original_amount ? formatMoney(r.original_amount, r.currency) : '—' }}</dd></div>
    <div><dt>{{ isReduction(r.amount_delta) ? 'Reduction asked for' : 'Supplementary asked for' }}</dt>
      <dd class="num"><strong>{{ isReduction(r.amount_delta) ? '−' : '+' }}{{ formatMoney(unsigned(r.amount_delta), r.currency) }}</strong></dd></div>
    <div><dt>Revision</dt><dd>No. {{ r.revision_no }}<template v-if="r.effective_date"> · effective {{ formatDate(r.effective_date) }}</template></dd></div>
    <div><dt>Requested by</dt><dd>{{ r.requested_by_name ?? '—' }} · {{ formatDateTime(r.requested_at) }}</dd></div>
    <div><dt>Reason given</dt><dd>{{ r.reason }}</dd></div>
  </dl>

  <dl v-else-if="kind === 'project'" class="cw-kv cm-kv">
    <div><dt>Project</dt><dd>{{ p.reference }} {{ p.name }}</dd></div>
    <div v-if="p.description"><dt>Description</dt><dd>{{ p.description }}</dd></div>
    <div><dt>Vote</dt><dd>{{ p.department_code ?? '' }} {{ p.department_name ?? '—' }}</dd></div>
    <div><dt>Budget asked for</dt><dd class="num"><strong>{{ formatMoney(p.approved_budget, p.currency) }}</strong></dd></div>
    <div><dt>Allocated from budget lines</dt><dd class="num">{{ formatMoney(p.allocated_total, p.currency) }}</dd></div>
    <div><dt>Spent to date</dt><dd class="num">{{ formatMoney(p.actual_spend, p.currency) }}</dd></div>
    <div v-if="p.other_currency_allocations && Object.keys(p.other_currency_allocations).length"><dt>Other currencies</dt>
      <dd>Allocations held in {{ Object.keys(p.other_currency_allocations).join(', ') }} are shown on the project, not added here.</dd></div>
    <div><dt>Where</dt><dd>{{ p.ward_code ? `Ward ${p.ward_code}` : '—' }}<template v-if="p.location_text"> · {{ p.location_text }}</template></dd></div>
    <div><dt>Dates</dt><dd>{{ formatDate(p.start_date) }} to {{ formatDate(p.end_date) }}</dd></div>
  </dl>

  <div v-else-if="kind === 'publication'">
    <dl class="cw-kv cm-kv">
      <div><dt>Dataset</dt><dd>{{ DATASET[pub.dataset] ?? pub.dataset }}, version {{ pub.version }}</dd></div>
      <div><dt>Year</dt><dd>{{ pub.financial_year_label ?? '—' }}</dd></div>
      <div><dt>Period</dt><dd>{{ pub.reporting_period_label ?? '—' }}<template v-if="pub.data_as_at"> · data as at {{ formatDate(pub.data_as_at) }}</template></dd></div>
      <div v-if="pub.import_filename"><dt>Source file</dt><dd>{{ pub.import_filename }} · reconciliation {{ pub.import_reconciliation_status ?? 'not recorded' }}</dd></div>
      <div><dt>Requested</dt><dd>{{ formatDateTime(pub.created_at) }}</dd></div>
    </dl>
    <p v-if="previewError" class="cw-banner-msg cw-banner-msg--warn" role="status">{{ previewError }}</p>
    <template v-else-if="preview">
      <p v-if="preview.warning" class="cw-banner-msg cw-banner-msg--warn" role="status">{{ preview.warning }}</p>
      <div v-if="preview.summary.length" class="cw-table-wrap">
        <table class="cw-table dx-compact">
          <caption class="cm-caption">What would become public</caption>
          <thead><tr><th v-for="k in keysOf(preview.summary)" :key="k" scope="col">{{ k.replace(/_/g, ' ') }}</th></tr></thead>
          <tbody><tr v-for="(row, i) in preview.summary" :key="i"><td v-for="k in keysOf(preview.summary)" :key="k" class="num">{{ cell(row[k]) }}</td></tr></tbody>
        </table>
      </div>
      <p v-if="preview.withheld_from_public.length" class="cw-hint">Withheld from the public: {{ preview.withheld_from_public.join(', ') }}.</p>
      <p class="cw-hint">{{ preview.note }}</p>
    </template>
  </div>

  <dl v-else-if="kind === 'tariff'" class="cw-kv cm-kv">
    <div><dt>Category</dt><dd>{{ t.category_code }} {{ t.category_name }}</dd></div>
    <div><dt>Year and currency</dt><dd>{{ t.financial_year_label }} · {{ t.currency }}</dd></div>
    <div><dt>Rate in the dollar proposed</dt><dd class="num"><strong>{{ t.rate_in_dollar }}</strong></dd></div>
    <div><dt>Rate in force now</dt><dd class="num">
      <template v-if="t.current">{{ t.current.rate_in_dollar }} · resolution {{ t.current.resolution_reference ?? 'not recorded' }}</template>
      <template v-else>None approved for this category, year and currency</template></dd></div>
    <div><dt>Fixed charge</dt><dd class="num">{{ t.fixed_charge ? formatMoney(t.fixed_charge, t.currency) : 'None recorded' }}</dd></div>
    <div><dt>Minimum charge</dt><dd class="num">{{ t.minimum_charge ? formatMoney(t.minimum_charge, t.currency) : 'None recorded' }}</dd></div>
    <div><dt>Revenue account</dt><dd>{{ t.revenue_account_code ? `${t.revenue_account_code} ${t.revenue_account_name ?? ''}` : 'Not set' }}</dd></div>
    <div><dt>Drafted by</dt><dd>{{ t.created_by_name ?? '—' }} · {{ formatDateTime(t.created_at) }}</dd></div>
    <div v-if="t.notes"><dt>Notes</dt><dd>{{ t.notes }}</dd></div>
  </dl>
</template>

<style scoped>
.cm-kv { max-width: 760px; font-size: 14px; }
.cm-kv dt { color: var(--cw-ink-2); padding-right: 20px; }
.cm-caption { text-align: left; font-weight: 600; padding: 12px 0 6px; }
</style>
