<script setup lang="ts">
/**
 * The financial-year selector, and the sentence that says what state the year is in.
 *
 * It appears in the header of every finance section because nearly every finance figure is "this,
 * for this reporting period" — and an officer who cannot see which period they are looking at is
 * one tab-switch away from putting the wrong year's number in a committee paper.
 *
 * A closed year is selectable. It is readable and reportable; it simply accepts no writes, and the
 * banner says so rather than the controls failing silently when pressed.
 */
import { computed } from 'vue'
import { useFinanceStore } from '../stores/finance'
import { formatDate } from '../composables/useMoney'
import { Lock, CalendarRange } from 'lucide-vue-next'

const store = useFinanceStore()

const year = computed(() => store.selectedYear)

const stateSentence = computed(() => {
  const y = year.value
  if (!y) return null
  if (y.status === 'open') return null
  if (y.status === 'draft') {
    return 'This year is still a draft. Open it before entering budgets or importing figures.'
  }
  return `${y.label} is ${y.status}. Its figures can be read, reported and exported; nothing further can be posted to it.`
})
</script>

<template>
  <div class="fin-year">
    <label class="ins-label" for="fin-year-select">
      <CalendarRange :size="13" aria-hidden="true" /> Financial year
    </label>
    <select
      id="fin-year-select"
      class="ins-input"
      :value="store.selectedYearId ?? ''"
      :disabled="store.years.length === 0"
      @change="store.selectYear(($event.target as HTMLSelectElement).value || null)"
    >
      <option v-if="store.years.length === 0" value="">No financial year yet</option>
      <option v-for="y in store.years" :key="y.id" :value="y.id">
        {{ y.label }} — {{ y.status }}
      </option>
    </select>

    <p v-if="year" class="fin-year-dates">
      {{ formatDate(year.start_date) }} to {{ formatDate(year.end_date) }}
      · reported in {{ year.reporting_currency }}
    </p>

    <p v-if="stateSentence" class="fin-readonly" role="status">
      <Lock :size="15" aria-hidden="true" />
      <span>{{ stateSentence }}</span>
    </p>
  </div>
</template>

<style scoped>
.fin-year { display: flex; flex-direction: column; gap: var(--ent-s1); min-width: 13rem; }
.fin-year-dates { margin: 0; font-size: var(--ent-fs-micro); color: var(--ent-text-3); font-variant-numeric: tabular-nums; }
.fin-year .fin-readonly { margin-top: var(--ent-s2); }
.ins-label { display: inline-flex; align-items: center; gap: 4px; }
</style>
