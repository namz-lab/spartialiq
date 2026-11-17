<script setup lang="ts">
/**
 * Variance explanations: the lines the council's thresholds flag (`GET /finance/exceptions/budget`),
 * each with the explanations already on record (`GET /finance/budget-lines/:id`) and a form to add
 * one (`POST /finance/variance-explanations`, permission `finance.variance.explain`).
 *
 * Used by Budget Management (every vote) and Department Finance (the server confines the read and
 * the write to the person's own votes). The flags are advisory: nothing is blocked by them, and an
 * explanation is a record for the variance report, not an approval.
 */
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { MessageSquareText, AlertTriangle, ChevronDown, ChevronRight, Info } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney, formatDate } from '../../../composables/useMoney'
import type { BudgetLinePerformance, VarianceExplanation } from '../../../models/types'

type Flagged = BudgetLinePerformance & { flag: string }

const store = useFinanceStore()
const rows = ref<Flagged[]>([])
const thresholds = ref<{ warn_execution_percentage: number; flag_execution_percentage: number } | null>(null)
const which = ref<'explain' | 'all'>('explain')
const loading = ref(false)
const error = ref<string | null>(null)
const notice = ref<string | null>(null)

const open = ref<string | null>(null)
const history = reactive<Record<string, VarianceExplanation[] | 'loading' | 'error'>>({})
const draft = reactive({ explanation: '', period_label: '' })
const saving = ref(false)
const formError = ref<string | null>(null)

const canExplain = computed(() => store.can('finance.variance.explain'))
const writable = computed(() => store.selectedYearAcceptsWrites)

const FLAG: Record<string, string> = {
  over_budget: 'Over budget', spend_without_budget: 'Spending without a budget',
  nearly_exhausted: 'Nearly exhausted', currency_mismatch: 'Currency fault',
}
const NEEDS_EXPLANATION = new Set(['over_budget', 'spend_without_budget'])

async function load(): Promise<void> {
  if (!store.selectedYearId) { rows.value = []; return }
  loading.value = true
  error.value = null
  try {
    const r = await financeApi.budgetExceptions(store.selectedYearId)
    rows.value = r.rows
    thresholds.value = r.thresholds
  } catch (err) {
    error.value = messageOf(err, 'The flagged lines could not be read.')
  } finally {
    loading.value = false
  }
}
watch(() => store.selectedYearId, () => { open.value = null; void load() })
onMounted(load)

const shown = computed(() => (which.value === 'explain' ? rows.value.filter((r) => NEEDS_EXPLANATION.has(r.flag)) : rows.value))

async function toggle(r: Flagged): Promise<void> {
  if (open.value === r.budget_line_id) { open.value = null; return }
  open.value = r.budget_line_id
  draft.explanation = ''
  draft.period_label = ''
  formError.value = null
  notice.value = null
  history[r.budget_line_id] = 'loading'
  try {
    history[r.budget_line_id] = (await financeApi.budgetLine(r.budget_line_id)).explanations
  } catch {
    history[r.budget_line_id] = 'error'
  }
}

async function record(r: Flagged): Promise<void> {
  if (!store.selectedYearId) return
  const text = draft.explanation.trim()
  if (text.length < 10) { formError.value = 'Write at least ten characters: what caused the variance and what is being done.'; return }
  saving.value = true
  formError.value = null
  try {
    const saved = await financeApi.explainVariance({
      financial_year_id: store.selectedYearId, budget_line_id: r.budget_line_id, explanation: text,
      ...(draft.period_label.trim() ? { period_label: draft.period_label.trim() } : {}),
    })
    const list = history[r.budget_line_id]
    history[r.budget_line_id] = [saved, ...(Array.isArray(list) ? list : [])]
    draft.explanation = ''
    draft.period_label = ''
    notice.value = `Explanation recorded for ${r.code}.`
  } catch (err) {
    formError.value = messageOf(err, 'The explanation could not be recorded.')
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><MessageSquareText :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Variance Explanations</h2>
      <p>Lines over or near their budget, and why. Explanations recorded here go into the variance report. {{ store.selectedYear?.label ?? '' }}</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <p v-if="notice" class="cw-banner-msg cw-banner-msg--info" role="status"><Info :size="18" aria-hidden="true" />{{ notice }}</p>
  <p v-if="!canExplain" class="cw-banner-msg cw-banner-msg--info"><Info :size="18" aria-hidden="true" />Your role reads explanations but does not record them.</p>
  <p v-else-if="!writable" class="cw-banner-msg cw-banner-msg--info"><Info :size="18" aria-hidden="true" />The selected year accepts no new records, so explanations can be read but not added.</p>

  <section class="cw-card">
    <div class="cw-card-head">
      <h3>{{ shown.length }} {{ shown.length === 1 ? 'line' : 'lines' }}</h3>
      <span class="cw-spacer" />
      <div class="cw-seg vp-seg" role="group" aria-label="Which lines">
        <button type="button" :aria-pressed="which === 'explain'" @click="which = 'explain'">Needing an explanation</button>
        <button type="button" :aria-pressed="which === 'all'" @click="which = 'all'">Every flagged line</button>
      </div>
    </div>
    <div class="cw-card-body">
      <p v-if="thresholds" class="cw-hint" style="margin-top: 0">Flagged at {{ thresholds.warn_execution_percentage }}% spent (nearly exhausted) and {{ thresholds.flag_execution_percentage }}% (over budget), from the council's finance settings. Flags are advisory.</p>
      <div v-if="loading"><span class="cw-skel" /><span class="cw-skel" /></div>
      <p v-else-if="!shown.length" class="cw-empty">{{ which === 'explain' ? 'No line is over its budget.' : 'No line is flagged.' }}</p>
      <ul v-else class="vp-list">
        <li v-for="r in shown" :key="r.budget_line_id" class="vp-item">
          <button type="button" class="vp-row" :aria-expanded="open === r.budget_line_id" :aria-controls="`vp-${r.budget_line_id}`" @click="toggle(r)">
            <component :is="open === r.budget_line_id ? ChevronDown : ChevronRight" :size="18" aria-hidden="true" />
            <span class="vp-name"><strong>{{ r.code }}</strong> {{ r.description }}
              <span class="cw-hint vp-sub">{{ r.department_name }}</span></span>
            <span class="vp-fig num">{{ formatMoney(r.actual_amount, r.currency) }} <span class="cw-hint">of {{ formatMoney(r.revised_amount, r.currency) }}</span></span>
            <span class="vp-fig"><strong>{{ r.execution_percentage === null ? '—' : `${r.execution_percentage}%` }}</strong></span>
            <span class="cw-pill" :class="NEEDS_EXPLANATION.has(r.flag) ? 'cw-pill--neg' : 'cw-pill--warn'">{{ FLAG[r.flag] ?? r.flag }}</span>
          </button>
          <div v-if="open === r.budget_line_id" :id="`vp-${r.budget_line_id}`" class="vp-detail">
            <h4>On record</h4>
            <p v-if="history[r.budget_line_id] === 'loading'"><span class="cw-skel" /></p>
            <p v-else-if="history[r.budget_line_id] === 'error'" class="cw-hint">The explanations on record could not be read.</p>
            <p v-else-if="!(history[r.budget_line_id] as VarianceExplanation[]).length" class="cw-hint">No explanation recorded yet.</p>
            <ul v-else class="vp-history">
              <li v-for="e in (history[r.budget_line_id] as VarianceExplanation[])" :key="e.id">
                <p>{{ e.explanation }}</p>
                <p class="cw-hint">{{ formatDate(e.recorded_at.slice(0, 10)) }}<template v-if="e.recorded_by_name"> · {{ e.recorded_by_name }}</template><template v-if="e.period_label"> · {{ e.period_label }}</template></p>
              </li>
            </ul>
            <form v-if="canExplain && writable" class="vp-form" @submit.prevent="record(r)">
              <label class="cw-field"><span class="cw-label">Explanation <span class="req" aria-hidden="true">*</span></span>
                <textarea v-model="draft.explanation" class="cw-textarea" required minlength="10" maxlength="4000"
                  :aria-invalid="!!formError" aria-describedby="vp-help" /></label>
              <p id="vp-help" class="cw-hint">What caused the variance, and what is being done about it. At least ten characters.</p>
              <label class="cw-field vp-period"><span class="cw-label">Period (optional)</span>
                <input v-model="draft.period_label" class="cw-input" maxlength="60" placeholder="For example, Quarter 2" /></label>
              <p v-if="formError" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ formError }}</p>
              <div><button type="submit" class="cw-btn cw-btn--primary" :disabled="saving">{{ saving ? 'Recording…' : 'Record explanation' }}</button></div>
            </form>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>

<style scoped>
.vp-seg { min-width: 360px; }
.vp-list, .vp-history { list-style: none; margin: 0; padding: 0; }
.vp-item { border-bottom: 1px solid var(--cw-line); }
.vp-row { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto 70px auto; align-items: center; gap: 12px; width: 100%; padding: 10px 4px; border: 0; background: none; font: inherit; color: inherit; text-align: left; cursor: pointer; }
.vp-row:hover { background: var(--cw-accent-softer); }
.vp-row:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
.vp-sub { display: block; }
.vp-fig { text-align: right; white-space: nowrap; }
.vp-detail { padding: 6px 12px 16px 36px; }
.vp-detail h4 { margin: 4px 0 8px; font-size: 14px; }
.vp-history li { padding: 8px 0; border-bottom: 1px dashed var(--cw-line); }
.vp-history p { margin: 0 0 4px; }
.vp-form { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; max-width: 680px; }
.vp-period { max-width: 280px; }
@media (max-width: 760px) {
  .vp-seg { min-width: 0; width: 100%; }
  .vp-row { grid-template-columns: 20px minmax(0, 1fr); }
  .vp-row > :nth-child(n + 3) { grid-column: 2; text-align: left; }
}
</style>
