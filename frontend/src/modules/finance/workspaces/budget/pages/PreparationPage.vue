<script setup lang="ts">
/**
 * Preparation progress by vote: for each department, how many of its budget lines for the year are
 * draft, submitted, returned and approved, spending and revenue apart. From `GET /finance/budget-lines`
 * (every status). Lines are COUNTED here, never summed: money totals are the server's, and a count
 * of lines in two currencies is still a count.
 *
 * Returned lines are listed beneath with the reason the approver gave, so the officer can see what
 * to put right without opening each one.
 */
import { computed, onMounted, ref, watch } from 'vue'
import { RouterLink } from 'vue-router'
import { TableProperties, AlertTriangle, Undo2 } from 'lucide-vue-next'
import { financeApi } from '../../../api/financeApi'
import { messageOf, useFinanceStore } from '../../../stores/finance'
import { formatMoney } from '../../../composables/useMoney'
import type { BudgetLinePerformance } from '../../../models/types'

const PAGE = 500
const MAX_PAGES = 4
const STATES = ['draft', 'submitted', 'returned', 'approved'] as const
type State = typeof STATES[number]
const LABEL: Record<State, string> = { draft: 'Draft', submitted: 'Pending approval', returned: 'Returned', approved: 'Approved' }

const store = useFinanceStore()
const lines = ref<BudgetLinePerformance[]>([])
const total = ref(0)
const loading = ref(false)
const error = ref<string | null>(null)

async function load(): Promise<void> {
  if (!store.selectedYearId) { lines.value = []; total.value = 0; return }
  loading.value = true
  error.value = null
  try {
    const base = { financial_year_id: store.selectedYearId, limit: PAGE, sort: 'code' as const }
    const first = await financeApi.budgetLines({ ...base, offset: 0 })
    const all = [...first.lines]
    for (let page = 1; page < MAX_PAGES && all.length < first.total; page++) {
      const next = await financeApi.budgetLines({ ...base, offset: page * PAGE })
      if (!next.lines.length) break
      all.push(...next.lines)
    }
    lines.value = all
    total.value = first.total
  } catch (err) {
    error.value = messageOf(err, 'The budget lines could not be read.')
  } finally {
    loading.value = false
  }
}
watch(() => store.selectedYearId, load)
onMounted(load)

/** A published line has been approved first, so it counts as approved. */
const stateOf = (l: BudgetLinePerformance): State => (l.status === 'published' ? 'approved' : l.status as State)

interface VoteRow { id: string; code: string; name: string; counts: Record<State, number>; spending: number; revenue: number; total: number }

const votes = computed<VoteRow[]>(() => {
  const by = new Map<string, VoteRow>()
  for (const l of lines.value) {
    let v = by.get(l.department_id)
    if (!v) {
      v = { id: l.department_id, code: l.department_code ?? '', name: l.department_name ?? '', counts: { draft: 0, submitted: 0, returned: 0, approved: 0 }, spending: 0, revenue: 0, total: 0 }
      by.set(l.department_id, v)
    }
    const s = stateOf(l)
    if (s in v.counts) v.counts[s]++
    if (l.account_kind === 'revenue') v.revenue++
    else v.spending++
    v.total++
  }
  return [...by.values()].sort((a, b) => a.code.localeCompare(b.code))
})
const counts = computed(() => {
  const c: Record<State, number> = { draft: 0, submitted: 0, returned: 0, approved: 0 }
  for (const l of lines.value) { const s = stateOf(l); if (s in c) c[s]++ }
  return c
})
const ready = (v: VoteRow) => v.total > 0 && v.counts.approved === v.total
const returned = computed(() => lines.value.filter((l) => l.status === 'returned'))
const shortName = (n: string) => n.replace(/\s*\(demo\)\s*$/i, '')
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><TableProperties :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Preparation by Vote</h2>
      <p>How far each vote's budget has come: lines in draft, waiting for approval, returned and approved. {{ store.selectedYear?.label ?? '' }}</p>
    </div>
  </section>

  <p v-if="error" class="cw-banner-msg cw-banner-msg--neg" role="alert"><AlertTriangle :size="18" aria-hidden="true" />{{ error }}</p>
  <p v-if="total > lines.length" class="cw-banner-msg cw-banner-msg--warn" role="status"><AlertTriangle :size="18" aria-hidden="true" />
    Counted the first {{ lines.length }} of {{ total }} lines.</p>

  <div v-if="loading" class="cw-card cw-card-body" style="padding-top: 20px"><span class="cw-skel" /><span class="cw-skel" /></div>
  <template v-else>
    <nav class="pp-states" aria-label="Lines by workflow state">
      <RouterLink v-for="s in STATES" :key="s" :to="{ name: 'bud-approval', query: { status: s } }" class="pp-state" :class="`is-${s}`">
        <strong class="num">{{ counts[s] }}</strong><span>{{ LABEL[s] }}</span>
      </RouterLink>
    </nav>

    <section class="cw-card">
      <div class="cw-card-head"><h3>Votes</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="!votes.length" class="cw-empty">No budget lines have been prepared for this year. Start on Budget Planning.</p>
        <table v-else class="cw-table pp-table">
          <thead><tr><th scope="col">Vote</th><th scope="col" class="r">Spending lines</th><th scope="col" class="r">Revenue lines</th>
            <th v-for="s in STATES" :key="s" scope="col" class="r">{{ LABEL[s] }}</th><th scope="col">Stage</th></tr></thead>
          <tbody>
            <tr v-for="v in votes" :key="v.id">
              <td>{{ v.code }} – {{ shortName(v.name) }}</td>
              <td class="r num">{{ v.spending }}</td><td class="r num">{{ v.revenue }}</td>
              <td v-for="s in STATES" :key="s" class="r num" :class="{ 'cw-neg': s === 'returned' && v.counts.returned > 0 }">{{ v.counts[s] }}</td>
              <td>
                <span v-if="ready(v)" class="cw-pill cw-pill--pos">All approved</span>
                <span v-else-if="v.counts.returned" class="cw-pill cw-pill--neg">Has returned lines</span>
                <span v-else-if="v.counts.draft" class="cw-pill cw-pill--mute">Being prepared</span>
                <span v-else class="cw-pill cw-pill--info">With the approver</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <section class="cw-card">
      <div class="cw-card-head"><h3><Undo2 :size="20" class="cw-head-icon" aria-hidden="true" /> Returned for revision</h3></div>
      <div class="cw-card-body cw-table-wrap">
        <p v-if="!returned.length" class="cw-empty">No line is waiting to be put right.</p>
        <table v-else class="cw-table">
          <thead><tr><th scope="col">Line</th><th scope="col">Vote</th><th scope="col" class="r">Original</th><th scope="col">Why it was returned</th></tr></thead>
          <tbody>
            <tr v-for="l in returned" :key="l.budget_line_id">
              <td><strong>{{ l.code }}</strong> {{ l.description }}</td><td>{{ l.department_code }}</td>
              <td class="r num">{{ formatMoney(l.original_amount, l.currency) }}</td>
              <td>{{ l.returned_note || 'No reason recorded.' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-if="returned.length" class="cw-hint"><RouterLink :to="{ name: 'bud-approval', query: { status: 'returned' } }">Open the returned lines to revise them</RouterLink></p>
      </div>
    </section>
  </template>
</template>

<style scoped>
.pp-states { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
.pp-state { display: flex; flex-direction: column; gap: 2px; padding: 14px 16px; border-radius: 12px; border: 1px solid var(--cw-line); background: var(--cw-surface); color: var(--cw-ink); text-decoration: none; }
.pp-state strong { font-size: 24px; }
.pp-state:focus-visible { outline: 2px solid var(--cw-accent); outline-offset: 2px; }
.pp-state.is-returned strong { color: var(--cw-neg); }
.pp-state.is-approved strong { color: var(--cw-pos); }
.pp-table td { white-space: nowrap; }
@media (max-width: 760px) { .pp-states { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
</style>
