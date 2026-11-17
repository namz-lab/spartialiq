<script setup lang="ts">
/**
 * The vote book: budget control as the accountant reads it at the desk. Each vote's budget,
 * commitments, spending and what remains, one book at a time, from the same view the budget
 * officer's dashboard and every budget report read — so the figures cannot disagree.
 *
 * The accountant reads; preparing and revising the budget stay in the Budget workspace with their
 * own permissions. Nothing is added up here, and no figure crosses a book (D4).
 */
import { computed, ref, watch } from 'vue'
import { RouterLink, useRoute, useRouter } from 'vue-router'
import { AlertTriangle, Landmark } from 'lucide-vue-next'
import { accountingApi, type VoteBook as VoteBookData } from '../../../api/accountingApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import type { Currency } from '../../../models/types'
import BookSwitch from '../kit/BookSwitch.vue'

const store = useFinanceStore()
const route = useRoute()
const router = useRouter()

const data = ref<VoteBookData | null>(null)
const loading = ref(true)
const error = ref<string | null>(null)

let reqId = 0
async function load(): Promise<void> {
  const seq = ++reqId
  const year = store.selectedYearId
  if (!year) { loading.value = false; data.value = null; error.value = null; return }
  loading.value = true
  error.value = null
  try {
    const res = await accountingApi.voteBook(year)
    if (seq !== reqId) return
    data.value = res
  } catch (err) {
    if (seq !== reqId) return
    data.value = null
    error.value = messageOf(err, 'The vote book could not be read.')
  } finally {
    if (seq === reqId) loading.value = false
  }
}
watch(() => store.selectedYearId, () => { void load() }, { immediate: true })

const book = computed<Currency>(() => {
  const b = route.query.book
  if (b === 'USD' || b === 'ZWG') return b
  return store.selectedYear?.reporting_currency ?? 'USD'
})
function setBook(c: Currency): void { void router.replace({ query: { ...route.query, book: c } }) }

const dash = '—'
const totals = computed(() => data.value?.totals.find(t => t.currency === book.value) ?? null)
const votes = computed(() => (data.value?.votes ?? []).filter(v => v.currency === book.value))
const overBudget = computed(() => (data.value?.over_budget ?? []).filter(o => o.currency === book.value))
const revenue = computed(() => (data.value?.revenue ?? []).filter(r => r.currency === book.value))

const CLASS_LABEL: Record<string, string> = {
  internally_generated: 'Internally generated', grant: 'Grants', transfer: 'Transfers', other: 'Other income',
}
const classLabel = (c: string): string => CLASS_LABEL[c] ?? c

/** A width for the utilisation bar, clamped so an over-spent vote does not break the layout. */
const widthOf = (pct: string | null): number => (pct === null ? 0 : Math.min(100, Number(pct)))
const toneOf = (pct: string | null): string => {
  if (pct === null) return 'var(--cw-ink-3, #9dbce6)'
  const n = Number(pct)
  if (n > 100) return '#b4371f'
  if (n >= 90) return '#c07c1d'
  return '#1e9e4a'
}
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Landmark :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Vote Book</h2>
      <p>Budget control by vote: what each arm of the council was voted, what it has committed, what it has spent, and what remains.</p>
    </div>
  </section>

  <p class="vb-standing">Every figure is the budget system's own, read from the view its reports use, so this page and the budget reports cannot disagree. Reading is all the accountant does here: preparing and revising the budget belong to the Budget workspace.</p>

  <section v-if="!store.selectedYearId" class="cw-card">
    <p class="cw-empty"><strong>Choose a financial year in the banner above.</strong>The vote book is read one financial year at a time.</p>
  </section>

  <template v-else>
    <section v-if="loading" class="cw-card" aria-busy="true" aria-label="Loading the vote book">
      <span class="cw-skel"></span><span class="cw-skel"></span><span class="cw-skel"></span>
    </section>

    <p v-else-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert">
      <AlertTriangle :size="18" aria-hidden="true" />{{ error }}
      <button type="button" class="cw-btn" @click="load">Retry</button>
    </p>

    <section v-else-if="!votes.length && !revenue.length" class="cw-card">
      <p class="cw-empty"><strong>No approved or published budget line exists for this year.</strong>
        Until the year's budget is approved nothing is under control, and this page stays empty rather than guessing.</p>
    </section>

    <template v-else>
      <section class="cw-card vb-bar" aria-label="Book">
        <BookSwitch :model-value="book" label="Book" @update:model-value="setBook" />
        <p v-if="data && data.lines_not_yet_approved > 0" class="vb-say">
          {{ data.lines_not_yet_approved }} budget line{{ data.lines_not_yet_approved === 1 ? ' is' : 's are' }} still draft, submitted or returned, and is not controlled here.
        </p>
      </section>

      <!-- Expenditure by vote -->
      <section class="cw-card" aria-labelledby="vb-votes">
        <div class="cw-card-head"><h3 id="vb-votes">Expenditure by vote, {{ book }} book</h3></div>
        <div class="cw-card-body cw-table-wrap">
          <table v-if="votes.length" class="cw-table">
            <caption class="vb-cap">Each vote's budget, commitments, spending and what remains, in the {{ book }} book</caption>
            <thead>
              <tr>
                <th scope="col">Vote</th><th scope="col" class="r">Budget</th><th scope="col" class="r">Committed</th>
                <th scope="col" class="r">Spent</th><th scope="col" class="r">Available</th><th scope="col" class="r">Variance</th>
                <th scope="col" class="r">Utilisation</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="v in votes" :key="`${v.code}-${v.name}`">
                <th scope="row">{{ v.code }} — {{ v.name }}<span v-if="v.vote_number !== null" class="cw-hint"> Vote {{ v.vote_number }}</span></th>
                <td class="amt">{{ formatMoney(v.budget, book) }}</td>
                <td class="amt">{{ formatMoney(v.committed, book) }}</td>
                <td class="amt">{{ formatMoney(v.actual, book) }}</td>
                <td class="amt">{{ formatMoney(v.available, book) }}</td>
                <td class="amt" :class="{ 'vb-neg': Number(v.variance) < 0 }">{{ formatMoney(v.variance, book) }}</td>
                <td class="amt vb-util">
                  <span v-if="v.utilisation !== null">{{ v.utilisation }}%</span><span v-else>{{ dash }}</span>
                  <span class="vb-bar" role="img" :aria-label="`${v.utilisation ?? 0} percent of the vote spent`"><span :style="{ width: `${widthOf(v.committed_utilisation ?? v.utilisation)}%`, background: toneOf(v.committed_utilisation ?? v.utilisation) }" /></span>
                  <span v-if="v.committed_utilisation !== null && v.committed_utilisation !== v.utilisation" class="cw-hint">{{ v.committed_utilisation }}% with commitments</span>
                </td>
              </tr>
            </tbody>
            <tfoot v-if="totals">
              <tr>
                <th scope="row">All votes</th>
                <td class="amt">{{ formatMoney(totals.budget, book) }}</td>
                <td class="amt">{{ formatMoney(totals.committed, book) }}</td>
                <td class="amt">{{ formatMoney(totals.actual, book) }}</td>
                <td class="amt">{{ formatMoney(totals.available, book) }}</td>
                <td class="amt">{{ dash }}</td>
                <td class="amt">
                  <span v-if="totals.utilisation !== null">{{ totals.utilisation }}%</span><span v-else>{{ dash }}</span>
                  <span v-if="totals.committed_utilisation !== null && totals.committed_utilisation !== totals.utilisation" class="cw-hint">{{ totals.committed_utilisation }}% with commitments</span>
                </td>
              </tr>
            </tfoot>
          </table>
          <p v-else class="cw-empty">No expenditure budget line exists in the {{ book }} book.</p>
        </div>
      </section>

      <!-- Over budget -->
      <section v-if="overBudget.length" class="cw-card" aria-labelledby="vb-over">
        <div class="cw-card-head"><h3 id="vb-over">Lines over budget, {{ book }} book</h3></div>
        <div class="cw-card-body cw-table-wrap">
          <table class="cw-table">
            <caption class="vb-cap">Budget lines whose spending and open commitments exceed the voted budget, in the {{ book }} book</caption>
            <thead><tr><th scope="col">Line</th><th scope="col">Vote</th><th scope="col" class="r">Budget</th><th scope="col" class="r">Spent</th><th scope="col" class="r">Committed</th><th scope="col" class="r">Over by</th></tr></thead>
            <tbody>
              <tr v-for="o in overBudget" :key="`${o.department_code}-${o.line_code}`">
                <th scope="row">{{ o.line_code }}<span v-if="o.line_description" class="cw-hint">{{ o.line_description }}</span></th>
                <td>{{ o.department_code }} — {{ o.department_name }}</td>
                <td class="amt">{{ formatMoney(o.budget, book) }}</td>
                <td class="amt">{{ formatMoney(o.spent, book) }}</td>
                <td class="amt">{{ formatMoney(o.committed, book) }}</td>
                <td class="amt vb-neg">{{ formatMoney(o.over_by, book) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <!-- Revenue by class -->
      <section class="cw-card" aria-labelledby="vb-rev">
        <div class="cw-card-head"><h3 id="vb-rev">Revenue by class, {{ book }} book</h3></div>
        <div class="cw-card-body cw-table-wrap">
          <table v-if="revenue.length" class="cw-table">
            <caption class="vb-cap">Budgeted income by the class the chart gives it, against what has actually come in, in the {{ book }} book</caption>
            <thead><tr><th scope="col">Class</th><th scope="col" class="r">Budget</th><th scope="col" class="r">Actual</th><th scope="col" class="r">Variance</th></tr></thead>
            <tbody>
              <tr v-for="r in revenue" :key="r.revenue_class">
                <th scope="row">{{ classLabel(r.revenue_class) }}</th>
                <td class="amt">{{ formatMoney(r.budget, book) }}</td>
                <td class="amt">{{ formatMoney(r.actual, book) }}</td>
                <td class="amt" :class="{ 'vb-neg': Number(r.variance) < 0 }">{{ formatMoney(r.variance, book) }}</td>
              </tr>
            </tbody>
          </table>
          <p v-else class="cw-empty">No revenue budget line exists in the {{ book }} book.</p>
        </div>
      </section>

      <p class="vb-standing">Spending means the actuals the budget system holds for approved and published expenditure lines. What the ledger has posted is read on the <RouterLink class="cw-link" :to="{ name: 'acc-reports' }">financial statements</RouterLink>.</p>
    </template>
  </template>
</template>

<style scoped>
.vb-standing { margin: 0 0 12px; color: var(--cw-ink-2, #4d5b6b); font-size: 13.5px; }
.vb-bar { display: flex; flex-wrap: wrap; gap: 10px 24px; align-items: center; padding: 12px 16px; margin-bottom: 12px; }
.vb-say { margin: 0; color: var(--cw-ink-2, #4d5b6b); font-size: 13.5px; }
.vb-cap { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
.vb-neg { color: #b4371f; }
.vb-util .vb-bar { display: block; height: 7px; margin-top: 4px; border-radius: 4px; background: #e5e9ee; overflow: hidden; }
.vb-util .vb-bar span { display: block; height: 100%; border-radius: 4px; }
</style>
