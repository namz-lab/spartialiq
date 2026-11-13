<script setup lang="ts">
/**
 * What a budget is built on: the financial years and the votes (departments). Read here; they are
 * set up by the Director of Finance on the finance console, and the budget officer's role holds no
 * configuration permission, so nothing on this page changes them.
 */
import { computed } from 'vue'
import { Settings, Info } from 'lucide-vue-next'
import { useFinanceStore } from '../../../stores/finance'
import { formatDate } from '../../../composables/useMoney'

const store = useFinanceStore()
const years = computed(() => [...store.years].sort((a, b) => b.start_date.localeCompare(a.start_date)))
</script>

<template>
  <section class="cw-pagehead">
    <span class="cw-pagehead-icon"><Settings :size="56" :stroke-width="1.6" aria-hidden="true" /></span>
    <div class="cw-pagehead-text">
      <h2>Budget Settings</h2>
      <p>The financial years and votes every budget line is built on.</p>
    </div>
  </section>

  <p class="cw-banner-msg cw-banner-msg--info"><Info :size="18" aria-hidden="true" />
    Years, votes, programmes and the chart of accounts are set up by the Director of Finance. Ask them to open a year or add a vote.</p>

  <section class="cw-card">
    <div class="cw-card-head"><h3>Financial years</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <table class="cw-table">
        <thead><tr><th>Year</th><th>From</th><th>To</th><th>Reporting currency</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="y in years" :key="y.id">
            <td><strong>{{ y.label }}</strong><span v-if="y.id === store.selectedYearId" class="cw-pill cw-pill--info" style="margin-left: 8px">Selected</span></td>
            <td>{{ formatDate(y.start_date) }}</td><td>{{ formatDate(y.end_date) }}</td><td>{{ y.reporting_currency }}</td>
            <td><span class="cw-pill" :class="y.status === 'open' ? 'cw-pill--pos' : 'cw-pill--mute'">{{ y.status }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>

  <section class="cw-card">
    <div class="cw-card-head"><h3>Votes (departments)</h3></div>
    <div class="cw-card-body cw-table-wrap">
      <table class="cw-table">
        <thead><tr><th>Code</th><th>Name</th><th>Status</th></tr></thead>
        <tbody>
          <tr v-for="dpt in store.departments" :key="dpt.id">
            <td>{{ dpt.code }}</td><td>{{ dpt.name }}</td>
            <td><span class="cw-pill" :class="dpt.status === 'active' ? 'cw-pill--pos' : 'cw-pill--mute'">{{ dpt.status }}</span></td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
